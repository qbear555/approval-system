/**
 * 申請詳情／簽核／轉簽
 * 依賴 app.js 掛到 window 的 state、$、api、esc、toast、navigate 等。
 */
async function renderDetail(body, id) {
  await loadUsers();
  const {
    request,
    canApprove,
    currentStep,
    canAttach,
    isFinalStep,
    canCancel,
    canDelete,
    canRestore,
    approverSigned,
    coApprovers,
    applicantLabor,
  } = await api(`/api/requests/${id}`);
  $('#page-title').textContent = `簽核詳情 #${request.id}`;
  const actionsHtml = [];
  if (canApprove) {
    actionsHtml.push(`
      <button type="button" class="btn success" id="btn-approve">核准</button>
      <button type="button" class="btn danger" id="btn-reject">駁回</button>
      <button type="button" class="btn outline" id="btn-cosign" title="臨時邀請其他同仁會簽">➕ 加簽</button>
      <button type="button" class="btn outline" id="btn-forward" title="將目前簽核關卡轉交給其他主管">↗️ 轉簽</button>
    `);
  }
  if (
    (request.requester_id === state.user.id || state.user.role === 'admin') &&
    request.status === 'pending'
  ) {
    actionsHtml.push(
      `<button type="button" class="btn outline" id="btn-remind" title="以 Email 催辦目前步驟簽核人">Email 催辦簽核人</button>`
    );
  }
  // 伺服器判定：已有簽署人簽核則不可取消
  if (canCancel) {
    actionsHtml.push(
      `<button type="button" class="btn outline" id="btn-cancel">取消申請</button>`
    );
  }
  // 簽核中／已結案皆可下載 PDF；已核准且有附件時打包 ZIP
  if (request.status !== 'draft' || request.requester_id === state.user.id || isAdmin()) {
    const attCount = (request.attachments || []).length;
    const zipDl = request.status === 'approved' && attCount > 0;
    actionsHtml.push(
      `<button type="button" class="btn primary" id="btn-pdf" title="${
        zipDl ? '含簽核單 PDF 與附件（ZIP）' : '下載簽核單 PDF'
      }">${zipDl ? `下載 PDF＋附件（${attCount}）` : '下載 PDF'}</button>`
    );
  }
  // 伺服器判定：已有簽署人簽核則不可刪除
  if (canRestore) {
    actionsHtml.push(
      `<button type="button" class="btn outline" id="btn-restore-request" title="還原此申請">還原申請</button>`
    );
  }
  if (canDelete) {
    actionsHtml.push(
      `<button type="button" class="btn danger" id="btn-del-request" title="刪除此申請">刪除申請</button>`
    );
  }
  $('#page-actions').innerHTML = actionsHtml.join(' ');

  const steps = request.steps || [];
  const userName = (id) => {
    const u = (state.users || []).find((x) => x.id === Number(id));
    return u ? u.name : `#${id}`;
  };
  // 簽核流程圖（含實際進度：已完成／簽核中／已略過／駁回）
  const progress = flowChartHtml(steps, {
    request,
    userName,
    showLegend: true,
  });

  const deletedBanner = request.deleted_at
    ? `<div class="card" style="background:#fef2f2;border-color:#fecaca;margin-bottom:12px">
          <strong style="color:#b91c1c">此申請已刪除</strong>
          <div class="muted" style="margin-top:6px;font-size:0.9rem">
            已從一般列表隱藏；單據、附件與備份仍保留。管理員可按上方「還原申請」。
          </div>
        </div>`
    : '';

  const coApproverBanner =
    coApprovers &&
    coApprovers.mode === 'all' &&
    (coApprovers.pending || []).length > 0 &&
    request.status === 'pending'
      ? `<div class="card" style="background:#fff7ed;border-color:#fdba74;margin-bottom:12px">
          <strong>會簽進行中</strong>
          <div class="muted" style="margin-top:6px;font-size:0.9rem">
            此步驟需<strong>全部</strong>簽核人核准後，才會通知下一步（含最終審核者）。
          </div>
          <div style="margin-top:8px;font-size:0.9rem">
            已簽：${
              (coApprovers.approved || []).length
                ? coApprovers.approved.map((p) => esc(p.name)).join('、')
                : '尚無'
            }
            <br/>
            待簽：${coApprovers.pending.map((p) => esc(p.name)).join('、')}
          </div>
        </div>`
      : '';

  const isCreditLimitReq =
    /信用額度/.test(String(request.workflow_name || '')) ||
    /信用額度/.test(String(request.title || ''));
  const finConfirmedAction = (request.actions || []).find(
    (a) => a.step_name === '財務部額度建檔確認'
  );
  const applicantAckAction = (request.actions || []).find(
    (a) => a.step_name === '申請人建檔確認'
  );
  const isFinanceStaff = isFinanceStaffUser();
  const isApplicantSelf =
    Number(request.requester_id) === Number(state.user?.id);

  // 最終核准系統通知：我是否待確認
  const myUid = Number(state.user?.id);
  const myFinalReceipt = (request.finalNotifyReceipts || []).find(
    (r) => Number(r.user_id) === myUid
  );
  const needFinalNotifyAck = myFinalReceipt && !myFinalReceipt.acked_at;
  let finalNotifyBanner = '';
  const isLeaveReq =
    /請假|休假|leave/i.test(String(request.workflow_name || '')) ||
    /請假|休假/i.test(String(request.title || '')) ||
    /自動回覆|Email/i.test(String(myFinalReceipt?.label || ''));
  const fnLabelText =
    myFinalReceipt?.label ||
    (isLeaveReq ? '設定 Email 自動回覆' : '最終核准完成通知');

  if (needFinalNotifyAck) {
    finalNotifyBanner = `
      <div class="card" style="background:#eff6ff;border-color:#93c5fd;margin-bottom:14px;padding:16px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
          <div>
            <strong style="color:#1e40af;font-size:1.05rem">🔔 ${
              isLeaveReq
                ? '請假核准 — 請設定 Email 自動回覆（待確認）'
                : '最終核准完成通知（待您確認收到）'
            }</strong>
            <p style="margin:4px 0 0;font-size:0.88rem;color:#1d4ed8;line-height:1.5">
              此單已完成最終核定（狀態：已核准）。
              ${
                isLeaveReq
                  ? `請為請假同仁<strong>設定 Email 自動回覆</strong>後再確認。<br/>說明：${esc(fnLabelText)}`
                  : `通知說明：${esc(fnLabelText)}`
              }<br/>
              通知時間：${esc(myFinalReceipt.created_at || '')}
            </p>
          </div>
          <button type="button" class="btn primary" id="btn-final-notify-ack" style="white-space:nowrap;padding:8px 18px;font-weight:600">${
            isLeaveReq ? '✅ 已設定自動回覆／確認收到' : '✅ 確認收到通知'
          }</button>
        </div>
      </div>`;
  } else if (myFinalReceipt && myFinalReceipt.acked_at) {
    finalNotifyBanner = `
      <div class="card" style="background:#f0fdf4;border-color:#86efac;margin-bottom:14px;padding:14px">
        <div style="display:flex;align-items:center;gap:12px">
          <span style="font-size:1.4rem">✅</span>
          <div>
            <strong style="color:#166534">${
              isLeaveReq
                ? '已確認（設定 Email 自動回覆）'
                : '您已確認收到最終核准通知'
            }</strong>
            <div class="muted" style="font-size:0.88rem;margin-top:2px">確認時間：${esc(myFinalReceipt.acked_at)}</div>
          </div>
        </div>
      </div>`;
  } else if (
    request.status === 'approved' &&
    (request.finalNotifyReceipts || []).length
  ) {
    // 其他人可看收執狀態摘要
    const receipts = request.finalNotifyReceipts || [];
    const pendingN = receipts.filter((r) => !r.acked_at).length;
    const doneN = receipts.length - pendingN;
    finalNotifyBanner = `
      <div class="card" style="background:#f8fafc;border-color:#e2e8f0;margin-bottom:14px;padding:14px">
        <strong style="color:#334155">最終核准系統通知收執</strong>
        <div class="muted" style="font-size:0.88rem;margin-top:4px">
          已通知 ${receipts.length} 人；已確認 ${doneN}、待確認 ${pendingN}
        </div>
        <ul style="margin:8px 0 0;padding-left:1.2rem;font-size:0.88rem">
          ${receipts
            .map(
              (r) =>
                `<li>${esc(r.user_name || r.user_username || r.user_id)}：${
                  r.acked_at
                    ? `已確認（${esc(r.acked_at)}）`
                    : '<span style="color:#b45309">待確認</span>'
                }</li>`
            )
            .join('')}
        </ul>
      </div>`;
  }

  let financeConfirmBanner = '';
  if (isCreditLimitReq && request.status === 'approved') {
    if (finConfirmedAction) {
      const fdNote =
        finConfirmedAction.form_data?.finance_establishment_note ||
        (typeof finConfirmedAction.form_data === 'string'
          ? (() => {
              try {
                return JSON.parse(finConfirmedAction.form_data || '{}')
                  .finance_establishment_note;
              } catch {
                return '';
              }
            })()
          : '');
      if (!applicantAckAction && (isApplicantSelf || isAdmin())) {
        financeConfirmBanner = `
          <div class="card" style="background:#f0fdf4;border-color:#86efac;margin-bottom:14px;padding:16px">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
              <div>
                <strong style="color:#166534;font-size:1.05rem">📊 財務部授信額度建檔完成（待您點選確認）</strong>
                <div style="font-size:0.9rem;color:#15803d;margin-top:4px">
                  ${esc(finConfirmedAction.actor_name || '財務部')} 已於 ${esc(finConfirmedAction.created_at)} 完成授信額度系統建檔登記。${
                    fdNote ? `<br/>建檔備註：${esc(fdNote)}` : ''
                  }
                </div>
              </div>
              <button type="button" class="btn success" id="btn-applicant-ack" style="white-space:nowrap;padding:8px 18px;font-weight:600">✅ 我知道了（完成確認）</button>
            </div>
          </div>`;
      } else {
        financeConfirmBanner = `
          <div class="card" style="background:#f0fdf4;border-color:#86efac;margin-bottom:14px;padding:16px">
            <div style="display:flex;align-items:center;gap:12px">
              <span style="font-size:1.5rem">✅</span>
              <div>
                <strong style="color:#166534;font-size:1.05rem">財務部授信額度建檔完成 ${applicantAckAction ? '（申請人已確認）' : ''}</strong>
                <div style="font-size:0.9rem;color:#15803d;margin-top:2px">
                  ${esc(finConfirmedAction.actor_name || '財務部')} 已於 ${esc(finConfirmedAction.created_at)} 完成核准額度建檔登記。${
                    fdNote ? `<br/>建檔備註：${esc(fdNote)}` : ''
                  }
                  ${
                    applicantAckAction
                      ? `<br/>申請人確認時間：${esc(applicantAckAction.created_at)}`
                      : ''
                  }
                </div>
              </div>
            </div>
          </div>`;
      }
    } else if (isFinanceStaff) {
      // 僅財務帳號顯示「確認完成額度建檔」
      financeConfirmBanner = `
        <div class="card" style="background:#ecfdf5;border-color:#6ee7b7;margin-bottom:14px;padding:16px">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
            <div>
              <strong style="color:#065f46;font-size:1.05rem">📊 財務部授信額度建檔確認</strong>
              <p style="margin:4px 0 0;font-size:0.88rem;color:#047857">
                總經理已核定通過。請於 ERP 完成授信額度建檔後，點擊下方按鈕完成登記並通知申請人。
              </p>
            </div>
            <button type="button" class="btn success" id="btn-finance-confirm" style="white-space:nowrap;padding:8px 18px;font-weight:600">✅ 確認完成額度建檔</button>
          </div>
        </div>`;
    } else {
      // 總經理／申請人／其他人：僅顯示狀態，不提供建檔確認按鈕
      financeConfirmBanner = `
        <div class="card" style="background:#fffbeb;border-color:#fde68a;margin-bottom:14px;padding:16px">
          <div style="display:flex;align-items:center;gap:12px">
            <span style="font-size:1.5rem">⏳</span>
            <div>
              <strong style="color:#92400e;font-size:1.02rem">已通知財務部進行授信額度建檔</strong>
              <div style="font-size:0.88rem;color:#b45309;margin-top:2px">
                總經理已完成核定。系統已通知財務部；建檔確認作業僅財務部同仁可操作。
              </div>
            </div>
          </div>
        </div>`;
    }
  }

  // 簽核中：申請單以 PDF 呈現（其餘狀態維持表單區塊，仍可下載 PDF）
  const usePdfFormView = request.status === 'pending';

  // OnlyOffice 狀態（可選）
  let onlyOfficeEnabled = false;
  try {
    const oo = await api('/api/onlyoffice/status');
    onlyOfficeEnabled = !!oo.enabled;
  } catch {
    onlyOfficeEnabled = false;
  }

  body.innerHTML = `
    <div class="detail-main">
      ${deletedBanner}
      ${coApproverBanner}
      ${finalNotifyBanner}
      ${financeConfirmBanner}
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:start;gap:12px;flex-wrap:wrap">
          <div>
            <h3 style="margin:0 0 8px">${esc(request.title)}</h3>
            ${statusTag(request.status)}
          </div>
        </div>
        ${progress}
        <dl class="kv" style="margin-top:16px">
          <dt>流程</dt><dd>${esc(request.workflow_name)}</dd>
          <dt>申請人</dt><dd>${esc(request.requester_name)}${request.requester_dept ? `（${esc(request.requester_dept)}）` : ''}</dd>
          <dt>建立時間</dt><dd>${esc(request.created_at)}</dd>
          ${request.completed_at ? `<dt>完成時間</dt><dd>${esc(request.completed_at)}</dd>` : ''}
          ${currentStep ? `<dt>目前步驟</dt><dd>${esc(currentStep.name)}</dd>` : ''}
          <dt>Email 通知</dt><dd>${
            (() => {
              const mailHint = request.requester_email
                ? `（${esc(request.requester_email)}）`
                : '（申請人未填 Email）';
              if (!request.notify_email) return `未開啟${mailHint}`;
              const p = request.notify_prefs || {};
              const shown = [];
              // 有細項物件時只列 true；舊單據無細項則視為全部
              if (
                p &&
                (Object.prototype.hasOwnProperty.call(p, 'approved') ||
                  Object.prototype.hasOwnProperty.call(p, 'rejected') ||
                  Object.prototype.hasOwnProperty.call(p, 'step'))
              ) {
                if (p.approved) shown.push('核准');
                if (p.rejected) shown.push('駁回');
                if (p.step) shown.push('下一步');
              } else {
                shown.push('核准', '駁回', '下一步');
              }
              if (!shown.length) return `未開啟${mailHint}`;
              return `已開啟：${shown.join('、')}${mailHint}`;
            })()
          }</dd>
        </dl>
        ${
          usePdfFormView
            ? `<div class="pdf-form-view" style="margin-top:16px">
                <div class="pdf-form-toolbar">
                  <strong>申請單（PDF）</strong>
                  <span class="muted" style="font-size:0.82rem">簽核中以正式 PDF 版面檢視</span>
                  <button type="button" class="btn outline sm" id="btn-pdf-reload" style="margin-left:auto">重新載入</button>
                </div>
                <div id="pdf-preview-wrap" class="pdf-preview-wrap">
                  <div class="muted" style="padding:24px;text-align:center">正在產生 PDF 預覽…</div>
                </div>
                <details class="pdf-form-fallback" style="margin-top:12px">
                  <summary class="muted" style="cursor:pointer;font-size:0.9rem">顯示網頁表單內容（備援）</summary>
                  <div style="margin-top:10px">
                    ${renderFormDataBlock(request.formFields, request.form_data)}
                    ${renderApproverDataBlock(request.approver_data)}
                  </div>
                </details>
              </div>`
            : `${renderFormDataBlock(request.formFields, request.form_data)}
               ${renderApproverDataBlock(request.approver_data)}`
        }
        ${renderAttachmentsBlock(request.attachments || [], {
          onlyOfficeEnabled,
          requestStatus: request.status,
        })}
      </div>
      ${
        canApprove
          ? `<div class="card">
              <h3>簽核處理 — ${esc(currentStep?.name || '')}</h3>
              ${
                // 僅人事步驟顯示申請人特休（代理人不顯示）
                applicantLabor &&
                !/代理/.test(String(currentStep?.name || '')) &&
                currentStep?.assignType !== 'form_user'
                  ? renderApplicantLaborBanner(applicantLabor, request)
                  : ''
              }
              ${
                stripSpecialLeaveHoursFields(currentStep?.approverFields || [])
                  .length
                  ? `<div id="step-form-fields" class="form-grid form-fields-multi" style="margin-bottom:12px">
                      ${stripSpecialLeaveHoursFields(
                        currentStep.approverFields || []
                      )
                        .map((f) =>
                          renderDynamicFieldHtml(
                            f,
                            applicantLabor?.fieldPrefill || {}
                          )
                        )
                        .join('')}
                    </div>
                    <p class="muted" style="font-size:0.85rem;margin:0 0 12px">
                      此步驟需填寫上方欄位後再核准。
                      ${
                        applicantLabor
                          ? '切換「假別（人事核定）」時，標籤會改為對應假別（例：剩餘祭儀假日數）。<strong>僅特休</strong>自動帶入剩餘<strong>日數</strong>（核准後，不換算小時）；其他假別數值<strong>留白</strong>。'
                          : /人事/.test(String(currentStep?.name || ''))
                            ? '人事單位：請選擇假別；特休請確認剩餘日數（不換算小時），其他假別可留白。'
                            : /管理部/.test(String(currentStep?.name || ''))
                              ? '管理部：請依檢核標準填寫上方欄位。'
                              : `${esc(currentStep?.name || '簽核單位')}：請填寫上方欄位。`
                      }
                    </p>`
                  : ''
              }
              ${
                canAttach
                  ? `<div class="field" style="margin-bottom:12px">
                      <label>補充附件（選填，可多檔上傳）</label>
                      <input type="file" id="step-attachments" multiple
                        accept=".pdf,.png,.jpg,.jpeg,.gif,.doc,.docx,.xls,.xlsx,.txt,image/*" />
                      <div class="muted" style="font-size:0.82rem;margin-top:4px">
                        中間簽核步驟可一次多選新增附件（Ctrl／Shift 多選，最多 20 個）；亦可先按「僅上傳附件」再核准。最終審核者不可上傳。
                      </div>
                      <div class="form-actions" style="margin-top:8px">
                        <button type="button" class="btn outline sm" id="btn-upload-step-att">僅上傳附件</button>
                      </div>
                    </div>`
                  : isFinalStep
                    ? `<p class="muted" style="font-size:0.85rem;margin:0 0 12px">此為最終審核步驟，不可新增附件。</p>`
                    : ''
              }
              <div class="field" style="margin-bottom:12px;border:1px solid #e2e8f0;border-radius:10px;padding:12px;background:#f8fafc">
                <label style="font-weight:600;margin-bottom:6px;display:block">✍️ 電子簽名檔選擇</label>
                <p class="muted" style="margin:0 0 8px;font-size:0.85rem">預設使用「個人預設簽名」；核准時若未另選現場手寫，將自動套用帳號設定中的簽名。</p>
                <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
                  <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
                    <input type="radio" name="sig_mode" value="default" checked />
                    <span>使用預設個人簽名 ${state.user?.signature_image ? '✅' : '（尚未設定，請至帳號設定）'}</span>
                  </label>
                  <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
                    <input type="radio" name="sig_mode" value="draw" />
                    <span>現場白板手寫簽名</span>
                  </label>
                </div>
                <div id="default-sig-preview" style="margin-top:10px">
                  ${
                    state.user?.signature_image
                      ? `<img src="${state.user.signature_image}" alt="預設簽名" style="max-height:70px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;padding:2px" />`
                      : `<span class="muted" style="font-size:0.85rem">尚未設定個人簽名，可至「帳號設定」建立，或改選現場手寫。</span>`
                  }
                </div>
                <div id="draw-sig-wrap" style="margin-top:10px;display:none">
                  <button type="button" class="btn outline sm" id="btn-open-spot-sig">✏️ 點此開始手寫簽名</button>
                  <div id="spot-sig-preview" style="margin-top:8px"></div>
                </div>
              </div>
              <div class="field"><label>簽核意見</label><textarea id="action-comment" placeholder="選填意見…"></textarea></div>
            </div>`
          : ''
      }
    </div>`;

  let spotSignatureImage = null;

  if (canApprove) {
    const sigRadios = body.querySelectorAll('input[name=sig_mode]');
    const drawWrap = $('#draw-sig-wrap');
    const defaultPrev = $('#default-sig-preview');
    const spotPreview = $('#spot-sig-preview');
    const syncSigModeUi = () => {
      const mode = body.querySelector('input[name=sig_mode]:checked')?.value || 'default';
      if (drawWrap) drawWrap.style.display = mode === 'draw' ? '' : 'none';
      if (defaultPrev) defaultPrev.style.display = mode === 'default' ? '' : 'none';
    };
    sigRadios.forEach((r) => {
      r.addEventListener('change', syncSigModeUi);
    });
    syncSigModeUi();
    // 進詳情時確保個人預設簽名是最新（登入 token 不含簽名圖）
    (async () => {
      try {
        const sigRes = await api('/api/users/me/signature');
        if (sigRes?.signature_image) {
          state.user = { ...(state.user || {}), signature_image: sigRes.signature_image };
          if (defaultPrev && body.querySelector('input[name=sig_mode][value=default]')?.checked) {
            defaultPrev.innerHTML = `<img src="${sigRes.signature_image}" alt="預設簽名" style="max-height:70px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;padding:2px" />`;
          }
        }
      } catch {
        /* ignore */
      }
    })();
    $('#btn-open-spot-sig')?.addEventListener('click', () => {
      openSignaturePadModal({
        title: '現場手寫簽名',
        initialImage: spotSignatureImage,
        onSave: (dataUrl) => {
          spotSignatureImage = dataUrl;
          if (spotPreview) {
            spotPreview.innerHTML = `
              <div style="display:flex;align-items:center;gap:10px">
                <img src="${dataUrl}" style="max-height:65px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;padding:2px" alt="手寫簽名" />
                <span style="color:#15803d;font-size:0.85rem">✅ 已儲存現場簽名</span>
              </div>
            `;
          }
        },
      });
    });
  }

  if (canApprove && (currentStep?.approverFields || []).length) {
    const stepBox = $('#step-form-fields') || body;
    bindDateTimeFields(stepBox);
    // 人事：實際工時起迄 → 實際總計自動換算
    if (
      stepBox.querySelector('[data-ff-date="actual_start"]') ||
      stepBox.querySelector('[data-ff-time="actual_start"]')
    ) {
      bindHoursAutoCalc(stepBox, {
        startId: 'actual_start',
        endId: 'actual_end',
        hoursId: 'actual_hours',
        hintId: 'actual-hours-hint',
        hintText:
          '實際總計依實際工時開始／結束自動換算（17:30～24:00，最小 0.5 小時）',
      });
    }
    // 人事：假別（人事核定）切換 → 剩餘日數／小時自動調整
    bindHrLeaveTypeAutoRemain(stepBox, applicantLabor);
  }

  body.querySelectorAll('[data-dl-att]').forEach((btn) => {
    btn.onclick = async () => {
      try {
        const blob = await api(`/api/attachments/${btn.dataset.dlAtt}`, {
          expectBlob: true,
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = btn.dataset.dlName || `attachment-${btn.dataset.dlAtt}`;
        a.click();
        URL.revokeObjectURL(url);
      } catch (e) {
        toast(e.message, 'error');
      }
    };
  });
  body.querySelectorAll('[data-preview-att]').forEach((btn) => {
    btn.onclick = () =>
      openAttachmentPreviewModal(btn.dataset.previewAtt, btn.dataset.previewName);
  });
  body.querySelectorAll('[data-oo-edit]').forEach((btn) => {
    btn.onclick = () => openOnlyOfficeEditor(btn.dataset.ooEdit, request.id);
  });

  const doAction = async (action) => {
    const comment = $('#action-comment')?.value || '';
    if (action === 'reject' && !comment.trim()) {
      if (!confirm('確定要駁回嗎？（建議填寫意見）')) return;
    }
    let step_form_data = {};
    if (action === 'approve' && (currentStep?.approverFields || []).length) {
      const box = $('#step-form-fields');
      if (box) {
        step_form_data = collectFormData(box);
      }
    }
    const fileInput = $('#step-attachments');
    const files = fileInput?.files ? [...fileInput.files] : [];
    if (files.length > 20) {
      toast('附件最多 20 個', 'error');
      return;
    }
    if (files.length && isFinalStep) {
      toast('最終審核步驟不可新增附件', 'error');
      return;
    }

    let finalSignatureImage = null;
    if (action === 'approve') {
      // 預設一律用個人預設簽名；僅明確選「現場手寫」才用白板
      const selectedMode = body.querySelector('input[name=sig_mode]:checked')?.value || 'default';
      if (selectedMode === 'draw') {
        if (!spotSignatureImage) {
          toast('請先點擊「點此開始手寫簽名」完成現場簽名', 'error');
          return;
        }
        finalSignatureImage = spotSignatureImage;
      } else {
        // default：優先記憶體中的個人簽名，否則再拉一次 API
        finalSignatureImage = state.user?.signature_image || null;
        if (!finalSignatureImage) {
          try {
            const sigRes = await api('/api/users/me/signature');
            finalSignatureImage = sigRes?.signature_image || null;
            if (finalSignatureImage) {
              state.user = { ...(state.user || {}), signature_image: finalSignatureImage };
            }
          } catch {
            /* ignore */
          }
        }
        // 未設定時仍可核准；後端也會再從 DB 套用預設簽名
      }
    }

    try {
      // 有附件時用 FormData；無附件仍可用 FormData 以統一 multipart 路由
      const body = new FormData();
      body.append('action', action);
      body.append('comment', comment || '');
      body.append('step_form_data', JSON.stringify(step_form_data || {}));
      if (finalSignatureImage) {
        body.append('signature_image', finalSignatureImage);
      }
      files.forEach((f) => body.append('attachments', f));
      const result = await api(`/api/requests/${id}/action`, {
        method: 'POST',
        body,
      });
      const msg =
        result?.message ||
        (action === 'approve' ? '已核准' : action === 'reject' ? '已駁回' : '已取消');
      toast(msg, 'success');
      navigate('detail', { id });
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  $('#btn-upload-step-att')?.addEventListener('click', async () => {
    const fileInput = $('#step-attachments');
    const files = fileInput?.files ? [...fileInput.files] : [];
    if (!files.length) {
      toast('請先選擇檔案', 'error');
      return;
    }
    if (files.length > 20) {
      toast('附件最多 20 個', 'error');
      return;
    }
    const fd = new FormData();
    files.forEach((f) => fd.append('attachments', f));
    try {
      const data = await api(`/api/requests/${id}/attachments`, {
        method: 'POST',
        body: fd,
      });
      toast(data.message || '附件已上傳', 'success');
      navigate('detail', { id });
    } catch (e) {
      toast(e.message, 'error');
    }
  });

  $('#btn-approve')?.addEventListener('click', () => doAction('approve'));
  $('#btn-reject')?.addEventListener('click', () => doAction('reject'));
  $('#btn-cosign')?.addEventListener('click', () => openCosignModal(request, () => navigate('detail', { id })));
  $('#btn-forward')?.addEventListener('click', () => openForwardModal(request, () => navigate('detail', { id })));
  $('#btn-cancel')?.addEventListener('click', () => {
    if (confirm('確定取消此申請？')) doAction('cancel');
  });
  $('#btn-remind')?.addEventListener('click', async () => {
    if (
      !confirm(
        '確定寄送 Email 催辦目前步驟簽核人？\n（同一單據 10 分鐘內僅能催辦一次）'
      )
    ) {
      return;
    }
    const btn = $('#btn-remind');
    if (btn) btn.disabled = true;
    try {
      const data = await api(`/api/requests/${id}/remind`, { method: 'POST', body: {} });
      const extra = data.warning ? `（${data.warning}）` : '';
      const toList = Array.isArray(data.emails) ? data.emails.join('、') : '';
      toast(
        `已寄送催辦信給 ${data.sentTo || 0} 位${toList ? `：${toList}` : ''}${extra}`,
        'success'
      );
      navigate('detail', { id });
    } catch (e) {
      toast(e.message || '催辦失敗', 'error');
      if (btn) btn.disabled = false;
    }
  });
  // 簽核中：嵌入 PDF 預覽
  let pdfPreviewObjectUrl = null;
  async function loadRequestPdfPreview() {
    const wrap = $('#pdf-preview-wrap');
    if (!wrap) return;
    wrap.innerHTML =
      '<div class="muted" style="padding:24px;text-align:center">正在產生 PDF 預覽…</div>';
    try {
      const blob = await api(`/api/requests/${id}/pdf?preview=1`, {
        expectBlob: true,
      });
      const type = String(blob?.type || '').toLowerCase();
      if (type && !type.includes('pdf') && !type.includes('octet-stream')) {
        throw new Error(
          `伺服器回傳 ${type || '非 PDF'}（簽核中預覽需 PDF）。請聯絡管理員更新後端，或展開下方網頁表單／下載檔案。`
        );
      }
      // octet-stream：仍嘗試當 PDF 開啟
      const pdfBlob =
        type.includes('pdf') || !type
          ? blob
          : new Blob([await blob.arrayBuffer()], { type: 'application/pdf' });
      if (pdfPreviewObjectUrl) {
        try {
          URL.revokeObjectURL(pdfPreviewObjectUrl);
        } catch {
          /* ignore */
        }
      }
      pdfPreviewObjectUrl = URL.createObjectURL(pdfBlob);
      wrap.innerHTML = `<iframe class="pdf-frame" title="申請單 PDF 預覽" src="${pdfPreviewObjectUrl}#view=FitH"></iframe>`;
    } catch (e) {
      wrap.innerHTML = `<div class="error-msg" style="margin:12px">PDF 預覽失敗：${esc(
        e.message || '未知錯誤'
      )}。請展開下方「網頁表單內容」或按「下載 PDF」。</div>`;
    }
  }
  if (usePdfFormView) {
    loadRequestPdfPreview();
    $('#btn-pdf-reload')?.addEventListener('click', () => loadRequestPdfPreview());
  }

  $('#btn-pdf')?.addEventListener('click', async () => {
    try {
      const { blob, filename } = await api(`/api/requests/${id}/pdf`, {
        returnMeta: true,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const hasAtt = !!(request.attachments && request.attachments.length > 0);
      const isZip =
        blob.type.includes('zip') ||
        (request.status === 'approved' && hasAtt) ||
        /\.zip$/i.test(filename || '');
      // 優先使用伺服器 Content-Disposition；否則依規則組檔名
      a.download =
        filename ||
        buildApprovalDownloadFileName(request, {
          zip: isZip,
          hasAttachments: hasAtt && request.status === 'approved',
        });
      a.click();
      URL.revokeObjectURL(url);
      toast(
        isZip
          ? hasAtt
            ? '已下載 ZIP（含 PDF 與附件）'
            : '已下載 ZIP'
          : 'PDF 已開始下載',
        'success'
      );
    } catch (e) {
      toast(e.message, 'error');
    }
  });
  const finConfirmBtn = $('#btn-finance-confirm');
  if (finConfirmBtn) {
    finConfirmBtn.onclick = async () => {
      const note = prompt(
        '請輸入財務部建檔備註（選填，例如：已於 ERP 系統完成授信額度設定）：'
      );
      if (note === null) return;
      try {
        await api(`/api/requests/${id}/finance-confirm`, {
          method: 'POST',
          body: { note: String(note || '').trim() },
        });
        toast('已完成財務部額度建檔登記，並發送通知至申請人', 'success');
        renderDetail(body, id);
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }
  const applicantAckBtn = $('#btn-applicant-ack');
  if (applicantAckBtn) {
    applicantAckBtn.onclick = async () => {
      try {
        await api(`/api/requests/${id}/applicant-ack`, { method: 'POST' });
        toast('已確認財務部建檔完成！', 'success');
        renderDetail(body, id);
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }
  const finalNotifyAckBtn = $('#btn-final-notify-ack');
  if (finalNotifyAckBtn) {
    finalNotifyAckBtn.onclick = async () => {
      try {
        await api(`/api/requests/${id}/final-notify-ack`, { method: 'POST' });
        toast('已確認收到最終核准通知', 'success');
        renderDetail(body, id);
        refreshBadge();
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }

  $('#btn-restore-request')?.addEventListener('click', async () => {
    if (
      !confirm(
        `確定還原申請 #${id}「${request.title}」？\n還原後會重新出現在一般列表。`
      )
    ) {
      return;
    }
    try {
      await api(`/api/requests/${id}/restore`, { method: 'POST' });
      toast('已還原申請', 'success');
      navigate('records');
    } catch (e) {
      toast(e.message, 'error');
    }
  });

  $('#btn-del-request')?.addEventListener('click', async () => {
    const isLeave =
      /請假/.test(String(request.workflow_name || '')) ||
      /請假/.test(String(request.title || ''));
    if (
      request.status === 'approved' &&
      !canDeleteRecordsPerm() &&
      !(isLeave && canDeleteLeavePerm())
    ) {
      toast('已核准的申請不可刪除', 'error');
      return;
    }
    if (
      !confirm(
        `確定刪除申請 #${id}「${request.title}」？\n將從列表隱藏；單據、附件與備份仍保留供稽核。`
      )
    ) {
      return;
    }
    try {
      await api(`/api/requests/${id}`, { method: 'DELETE' });
      toast('已刪除申請', 'success');
      navigate(
        Number(request.requester_id) === Number(state.user?.id)
          ? 'mine'
          : 'records'
      );
    } catch (e) {
      toast(e.message, 'error');
    }
  });
}

function openCosignModal(request, onDone) {
  const me = state.user?.id;
  const users = (state.users || []).filter((u) => u.active !== 0 && u.id !== me);
  openModal(`
    <h3>➕ 簽核加簽請託</h3>
    <p class="muted" style="margin-top:0">
      您可以臨時邀請其他同仁進行加簽。加簽同仁簽核完成後，將依位置繼續進行簽核。
    </p>
    <form id="cosign-form" class="form-grid">
      <div class="field">
        <label>加簽對象 *</label>
        <select name="target_user_id" required>
          <option value="">請選擇加簽同仁…</option>
          ${users.map((u) => `<option value="${u.id}">${esc(u.name)}（${esc(u.department || '未設部門')}）</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label>加簽順序</label>
        <select name="position">
          <option value="current" selected>先經加簽同仁簽核（再回傳原步驟）</option>
          <option value="after">於本關核准後，插入下一步驟</option>
        </select>
      </div>
      <div class="field">
        <label>加簽說明 / 請託意見</label>
        <textarea name="comment" rows="3" placeholder="請填寫加簽說明或請同仁協助說明的項目…"></textarea>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn primary">送出加簽</button>
        <button type="button" class="btn outline" data-close-modal>取消</button>
      </div>
    </form>
  `);

  $('#cosign-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const target_user_id = Number(fd.get('target_user_id'));
    if (!target_user_id) {
      toast('請選擇加簽同仁', 'error');
      return;
    }
    try {
      const res = await api(`/api/requests/${request.id}/cosign`, {
        method: 'POST',
        body: {
          target_user_id,
          position: fd.get('position') || 'current',
          comment: String(fd.get('comment') || '').trim(),
        },
      });
      closeModal();
      toast(res.message || '已成功送出加簽請託', 'success');
      if (typeof onDone === 'function') onDone();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

function openForwardModal(request, onDone) {
  const me = state.user?.id;
  const users = (state.users || []).filter((u) => u.active !== 0 && u.id !== me);
  openModal(`
    <h3>↗️ 簽核關卡轉簽改派</h3>
    <p class="muted" style="margin-top:0">
      將目前步驟的簽核權限轉交給指定同仁／主管辦理（您將不再為此步驟簽核人）。
    </p>
    <form id="forward-form" class="form-grid">
      <div class="field">
        <label>轉簽改派對象 *</label>
        <select name="target_user_id" required>
          <option value="">請選擇轉簽對象…</option>
          ${users.map((u) => `<option value="${u.id}">${esc(u.name)}（${esc(u.department || '未設部門')}）</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label>轉簽說明 / 理由</label>
        <textarea name="comment" rows="3" placeholder="請填寫轉簽改派原因或注意事項…"></textarea>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn primary">確認轉簽</button>
        <button type="button" class="btn outline" data-close-modal>取消</button>
      </div>
    </form>
  `);

  $('#forward-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const target_user_id = Number(fd.get('target_user_id'));
    if (!target_user_id) {
      toast('請選擇轉簽對象', 'error');
      return;
    }
    try {
      const res = await api(`/api/requests/${request.id}/forward`, {
        method: 'POST',
        body: {
          target_user_id,
          comment: String(fd.get('comment') || '').trim(),
        },
      });
      closeModal();
      toast(res.message || '已成功轉簽改派', 'success');
      if (typeof onDone === 'function') onDone();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}
