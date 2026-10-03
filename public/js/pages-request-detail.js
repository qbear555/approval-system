async function fetchRequestDetailData(id) {
  await loadUsers();
  const data = await api(`/api/requests/${id}`);
  let onlyOfficeEnabled = false;
  try {
    const oo = await api('/api/onlyoffice/status');
    onlyOfficeEnabled = !!oo.enabled;
  } catch {
    onlyOfficeEnabled = false;
  }
  data.onlyOfficeEnabled = onlyOfficeEnabled;
  return data;
}

function buildRequestDetailActionsHtml(detailData) {
  const {
    request,
    canApprove,
    canReturn: canReturnApi,
    previousStep: previousStepApi,
    currentStep,
    canAttach,
    isFinalStep,
    canCancel,
    canDelete,
    canVoid,
    canVoidApply,
    pendingVoidRequest,
    voidOfRequest,
    voidPreviewSteps,
    approverSigned,
    coApprovers,
    applicantLabor,
    actingAsProxy,
  } = detailData;

  // 前端備援：依流程步驟推算「上一關」（避免 API 欄位被舊快取／代理省略）
  const reqSteps = Array.isArray(request?.steps) ? request.steps : [];
  const curStepIdx = reqSteps.findIndex(
    (s) => Number(s.order) === Number(request?.current_step)
  );
  const previousStepClient =
    curStepIdx > 0
      ? {
          order: reqSteps[curStepIdx - 1].order,
          name: reqSteps[curStepIdx - 1].name || `步驟 ${reqSteps[curStepIdx - 1].order}`,
        }
      : null;
  const previousStep = previousStepApi || previousStepClient;
  const canReturn =
    !!canApprove &&
    request?.status === 'pending' &&
    !!(canReturnApi || previousStep);

  const actionsHtml = [];
  const isOwnDraft =
    request.status === 'draft' &&
    (Number(request.requester_id) === Number(state.user?.id) ||
      Number(request.submitted_by) === Number(state.user?.id) ||
      isAdmin());
  if (isOwnDraft) {
    actionsHtml.push(`
      <button type="button" class="btn primary" id="btn-edit-draft">繼續編輯草稿</button>
      <button type="button" class="btn success" id="btn-submit-draft">送出申請</button>
    `);
  }
  if (canApprove) {
    const proxyHint = actingAsProxy?.principal?.name
      ? `（代理 ${actingAsProxy.principal.name}）`
      : '';
    actionsHtml.push(`
      <button type="button" class="btn success" id="btn-approve">核准${proxyHint}</button>
      <button type="button" class="btn danger" id="btn-reject">駁回</button>
      <button type="button" class="btn outline" id="btn-cosign" title="臨時邀請其他同仁加簽">➕ 加簽</button>
      <button type="button" class="btn outline" id="btn-forward" title="將目前簽核關卡轉交給其他人">↗️ 轉簽</button>
    `);
    if (canReturn && previousStep) {
      actionsHtml.push(`
      <button type="button" class="btn warning" id="btn-return"
        title="退回「${esc(previousStep.name || '上一關')}」重新簽核">
        ↩ 退回上一位
      </button>
    `);
    }
  }
  if (
    (Number(request.requester_id) === Number(state.user.id) ||
      Number(request.submitted_by) === Number(state.user.id) ||
      state.user.role === 'admin') &&
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
  if (canVoidApply) {
    actionsHtml.push(
      `<button type="button" class="btn warning" id="btn-void-apply" title="提出作廢申請，由原單簽核人再簽，全部通過後原單自動作廢">申請作廢</button>`
    );
  }
  if (canVoid) {
    actionsHtml.push(
      `<button type="button" class="btn outline" id="btn-void" title="略過作廢流程，立即將此單改為已作廢並通知相關人員">直接作廢</button>`
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
  // 複製為新申請：任何有權限查看此單者（非草稿）皆可基於此單複製新申請
  if (request.status !== 'draft') {
    actionsHtml.push(
      `<button type="button" class="btn outline" id="btn-clone-request" title="以此單內容建立新申請單">📑 複製為新申請</button>`
    );
  }
  // 伺服器判定：已有簽署人簽核則不可刪除
  if (canDelete) {
    actionsHtml.push(
      `<button type="button" class="btn danger" id="btn-del-request" title="刪除此申請">刪除申請</button>`
    );
  }
  return actionsHtml.join(' ');
}

function buildRequestDetailMainHtml(detailData) {
  const {
    request,
    canApprove,
    canReturn: canReturnApi,
    previousStep: previousStepApi,
    currentStep,
    canAttach,
    isFinalStep,
    canCancel,
    canDelete,
    canVoid,
    canVoidApply,
    pendingVoidRequest,
    voidOfRequest,
    voidPreviewSteps,
    approverSigned,
    coApprovers,
    applicantLabor,
    actingAsProxy,
    onlyOfficeEnabled,
  } = detailData;

  const reqSteps = Array.isArray(request?.steps) ? request.steps : [];
  const curStepIdx = reqSteps.findIndex(
    (s) => Number(s.order) === Number(request?.current_step)
  );
  const previousStepClient =
    curStepIdx > 0
      ? {
          order: reqSteps[curStepIdx - 1].order,
          name: reqSteps[curStepIdx - 1].name || `步驟 ${reqSteps[curStepIdx - 1].order}`,
        }
      : null;
  const previousStep = previousStepApi || previousStepClient;
  const canReturn =
    !!canApprove &&
    request?.status === 'pending' &&
    !!(canReturnApi || previousStep);

  const steps = request.steps || [];
  const userName = (id) => {
    const u = (state.users || []).find((x) => x.id === Number(id));
    return u ? u.name : `#${id}`;
  };
  const progress = flowChartHtml(steps, {
    request,
    userName,
    showLegend: true,
    flow: request.flow || null,
  });

  const voidAction = [...(request.actions || [])]
    .reverse()
    .find((a) => a.action === 'void');
  const voidedBanner =
    request.status === 'voided'
      ? `<div class="card" style="background:#faf5ff;border-color:#d8b4fe;margin-bottom:12px">
          <strong style="color:#6b21a8">此申請已作廢</strong>
          <div class="muted" style="margin-top:6px;font-size:0.9rem">
            ${
              voidAction?.comment
                ? `原因：${esc(htmlToPlainText(voidAction.comment))}<br/>`
                : ''
            }
            ${voidAction?.actor_name ? `操作人：${esc(voidAction.actor_name)}` : ''}
            ${
              voidAction?.created_at
                ? `　時間：${esc(String(voidAction.created_at).slice(0, 16))}`
                : ''
            }
            <br/>歷程與附件仍保留；請假已休不再計入。
          </div>
        </div>`
      : '';
  const pendingVoidBanner =
    pendingVoidRequest && request.status === 'approved'
      ? `<div class="card" style="background:#fff7ed;border-color:#fdba74;margin-bottom:12px">
          <strong>作廢申請進行中</strong>
          <div class="muted" style="margin-top:6px;font-size:0.9rem">
            已送出作廢申請 <a href="#detail/${pendingVoidRequest.id}">#${pendingVoidRequest.id}</a>
            「${esc(pendingVoidRequest.title || '')}」。原單簽核人全部通過後，此單會自動改為已作廢。
          </div>
        </div>`
      : '';
  const voidOfBanner =
    voidOfRequest
      ? `<div class="card" style="background:#faf5ff;border-color:#d8b4fe;margin-bottom:12px">
          <strong style="color:#6b21a8">此為作廢申請</strong>
          <div class="muted" style="margin-top:6px;font-size:0.9rem">
            通過後將自動作廢原單
            <a href="#detail/${voidOfRequest.id}">#${voidOfRequest.id}</a>
            「${esc(voidOfRequest.title || '')}」（目前：${esc(
              STATUS[voidOfRequest.status]?.label || voidOfRequest.status || ''
            )}）。
            <br/>簽核人為原單實際核准過的人員。
          </div>
        </div>`
      : '';
  const voidBanner = `${voidedBanner}${pendingVoidBanner}${voidOfBanner}`;
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
      const fdObj = (() => {
        const raw = finConfirmedAction.form_data;
        if (raw && typeof raw === 'object') return raw;
        try {
          return JSON.parse(raw || '{}') || {};
        } catch {
          return {};
        }
      })();
      const fdNote =
        String(fdObj.finance_establishment_extra_note || '').trim() ||
        String(finConfirmedAction.comment || '').trim() ||
        String(fdObj.finance_establishment_note || '').trim();
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
                總經理已核定通過。請於 ERP 完成授信額度設定後，點擊下方按鈕完成登記（備註自動帶入「已於ERP系統完成授信額度設定」）並通知申請人。
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

  // 信用額度簽核步驟：預填額度（一律「元」）
  const creditStepPrefill = (() => {
    if (!canApprove || !currentStep) return {};
    const ad = request.approver_data || {};
    const name = String(currentStep.name || '');
    const pre = {};
    if (/業務/.test(name)) {
      if (ad.requested_credit_limit != null && ad.requested_credit_limit !== '') {
        pre.requested_credit_limit = ad.requested_credit_limit;
      }
    } else if (/副總/.test(name)) {
      pre.vp_suggested_limit =
        ad.vp_suggested_limit != null && ad.vp_suggested_limit !== ''
          ? ad.vp_suggested_limit
          : ad.requested_credit_limit != null && ad.requested_credit_limit !== ''
            ? ad.requested_credit_limit
            : '';
    } else if (/總經理/.test(name)) {
      pre.gm_approved_limit =
        ad.gm_approved_limit != null && ad.gm_approved_limit !== ''
          ? ad.gm_approved_limit
          : ad.vp_suggested_limit != null && ad.vp_suggested_limit !== ''
            ? ad.vp_suggested_limit
            : ad.requested_credit_limit != null && ad.requested_credit_limit !== ''
              ? ad.requested_credit_limit
              : '';
    }
    return pre;
  })();

  // 簽核中：申請單以 PDF 呈現（其餘狀態維持表單區塊，仍可下載 PDF）
  // 若為紙本套印版面（pdf_template），一律以原樣 PDF 呈現
  const isPdfTemplateReq = request.pdfLayout?.type === 'pdf_template';
  const usePdfFormView = request.status === 'pending' || isPdfTemplateReq;

  const proxyApproveBanner =
    canApprove && actingAsProxy?.principal
      ? `<div class="card" style="background:#eef2ff;border-color:#a5b4fc;margin-bottom:12px">
          <strong style="color:#3730a3">代簽模式</strong>
          <div class="muted" style="margin-top:6px;font-size:0.9rem">
            您正以代理人身份，代 <strong>${esc(
              actingAsProxy.principal.name || '#' + actingAsProxy.principal_id
            )}</strong> 處理此關簽核。
            核准／駁回／退回後，歷程會註記「代理 …」。
            <br/><span style="font-size:0.85rem">（既有簽核步驟快照不變；僅依目前有效代理人設定判斷）</span>
          </div>
        </div>`
      : '';

  const isProxySubmit =
    request.submitted_by &&
    Number(request.submitted_by) !== Number(request.requester_id);
  const submittedByLabel =
    request.submitted_by_name ||
    (request.submitted_by
      ? (state.users || []).find((u) => Number(u.id) === Number(request.submitted_by))
          ?.name
      : '') ||
    (request.submitted_by ? `#${request.submitted_by}` : '');

  return `
      ${proxyApproveBanner}
      ${voidBanner}
      ${coApproverBanner}
      ${finalNotifyBanner}
      ${financeConfirmBanner}
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:start;gap:12px;flex-wrap:wrap">
          <div>
            <h3 style="margin:0 0 8px">${esc(request.title)}</h3>
            ${statusTag(request.status)}
            ${
              isProxySubmit
                ? `<span class="tag" style="background:#e0e7ff;color:#3730a3;margin-left:6px">代申請</span>`
                : ''
            }
            ${
              canApprove && actingAsProxy
                ? `<span class="tag" style="background:#fef3c7;color:#92400e;margin-left:6px">代簽</span>`
                : ''
            }
          </div>
        </div>
        <div class="flow-chart-wrap" style="margin-top:14px">${progress}</div>
        <dl class="kv" style="margin-top:16px">
          <dt>流程</dt><dd>${esc(request.workflow_name)}</dd>
          <dt>申請人</dt><dd>${esc(request.requester_name)}${request.requester_dept ? `（${esc(request.requester_dept)}）` : ''}${
            isProxySubmit
              ? ` <span class="muted" style="font-size:0.85rem">· 由 ${esc(
                  submittedByLabel
                )} 代申請</span>`
              : ''
          }</dd>
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
            ? `<div class="pdf-form-view">
                <div class="pdf-form-toolbar">
                  <strong>申請單（PDF）</strong>
                  <span class="muted" style="font-size:0.82rem">簽核中以正式 PDF 版面檢視 · 可捲動縮放</span>
                  <button type="button" class="btn outline sm" id="btn-pdf-reload" style="margin-left:auto">重新載入</button>
                  <button type="button" class="btn outline sm" id="btn-pdf-newtab" title="在新分頁全螢幕開啟">新分頁開啟</button>
                </div>
                <div id="pdf-preview-wrap" class="pdf-preview-wrap">
                  <div class="muted" style="padding:24px;text-align:center">正在產生 PDF 預覽…</div>
                </div>
                <details class="pdf-form-fallback">
                  <summary class="muted" style="cursor:pointer;font-size:0.9rem">顯示網頁表單內容（備援）</summary>
                  <div style="margin-top:10px;padding:0 12px 12px">
                    ${renderFormDataBlock(request.formFields, request.form_data, request.steps, request.templateSteps)}
                    ${renderApproverDataBlock(request.approver_data)}
                  </div>
                </details>
              </div>`
            : `${renderFormDataBlock(request.formFields, request.form_data, request.steps, request.templateSteps)}
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
              <h3>簽核處理 — ${esc(currentStep?.name || '')}${
                actingAsProxy?.principal?.name
                  ? ` <span class="muted" style="font-weight:500;font-size:0.9rem">（代理 ${esc(
                      actingAsProxy.principal.name
                    )}）</span>`
                  : ''
              }</h3>
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
                  ? `<div id="step-form-fields" class="form-grid form-fields-multi${
                      /實際工時|actual_|ot_|comp_leave|延長工時/.test(
                        (currentStep.approverFields || [])
                          .map((x) => `${x.id || ''} ${x.label || ''}`)
                          .join(' ')
                      )
                        ? ' form-fields-ot'
                        : ''
                    }" style="margin-bottom:12px">
                      ${stripSpecialLeaveHoursFields(
                        currentStep.approverFields || []
                      )
                        .map((f) =>
                          renderDynamicFieldHtml(
                            f,
                            {
                              ...(applicantLabor?.fieldPrefill || {}),
                              ...(creditStepPrefill || {}),
                            },
                            {
                              compactHints: /actual_|ot_|comp_leave|實際|時數|小時/.test(
                                String(f.id || '') + String(f.label || '')
                              ),
                              compactTextarea: true,
                            }
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
                              : /財務/.test(String(currentStep?.name || ''))
                                ? '財務人員：請填寫銷貨收入、銷貨成本、銷貨毛利；毛利差異說明、備註說明可選填。毛利會依「收入−成本」自動帶入，可再調整。'
                              : /業務/.test(String(currentStep?.name || ''))
                                ? '業務人員：請填寫「申請信用額度（元）」（例：25 萬請填 <strong>250000</strong>）；「業務員要求條件」可選填。（「增加額度原由」由申請人填寫）'
                                : /副總/.test(String(currentStep?.name || ''))
                                  ? '副總經理：請填寫「建議額度（元）」（例：25 萬＝250000；已預填業務申請額）。核決：≤1,000,000 元結案，超過須總經理。「要求條件」可選填。'
                                  : /總經理/.test(String(currentStep?.name || ''))
                                    ? '總經理：額度超過副總權限（1,000,000 元）。請填「核定額度（元）」（例：250000）；「要求條件」可選填。'
                                    : `${esc(currentStep?.name || '簽核單位')}：請填寫上方欄位。`
                      }
                    </p>`
                  : ''
              }
              ${
                canApprove && SIGNATURE_SETTINGS_ENABLED
                  ? `<div class="field" style="margin-bottom:12px;border:1px solid #e2e8f0;border-radius:10px;padding:12px;background:#f8fafc">
                <label style="font-weight:600;margin-bottom:6px;display:block">✍️ 電子簽名檔選擇</label>
                <p class="muted" style="margin:0 0 8px;font-size:0.85rem">預設使用「個人預設簽名」；核准時若未另選現場手寫，將自動套用帳號設定中的簽名。</p>
                <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
                  <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
                    <input type="radio" name="sig_mode" value="default" checked />
                    <span>使用預設個人簽名 ${state.user?.has_signature || state.user?.signature_image ? '✅' : '（尚未設定，請至帳號設定）'}</span>
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
                      : `<span class="muted" style="font-size:0.85rem">尚未載入預設簽名；可至「帳號設定」建立，或改選現場手寫。</span>`
                  }
                </div>
                <div id="draw-sig-wrap" style="margin-top:10px;display:none">
                  <button type="button" class="btn outline sm" id="btn-open-spot-sig">✏️ 點此開始手寫簽名</button>
                  <div id="spot-sig-preview" style="margin-top:8px"></div>
                </div>
              </div>`
                  : ''
              }
              ${
                canAttach
                  ? `<div class="field" style="margin-bottom:12px">
                      <label>補充附件（選填，可多檔上傳或附加已核准申請單）</label>
                      <input type="file" id="step-attachments" multiple
                        accept=".pdf,.png,.jpg,.jpeg,.gif,.doc,.docx,.xls,.xlsx,.txt,image/*" />
                      <div class="muted" style="font-size:0.82rem;margin-top:4px">
                        中間簽核步驟可一次多選新增附件（Ctrl／Shift 多選，最多 20 個），或附加已簽核完成的申請單 PDF。亦可先按「僅上傳附件」再核准。最終審核者不可上傳。
                      </div>
                      <div class="form-actions" style="margin-top:8px;display:flex;flex-wrap:wrap;gap:8px">
                        <button type="button" class="btn outline sm" id="btn-upload-step-att">僅上傳附件</button>
                        <button type="button" class="btn outline sm" id="btn-pick-approved-step">附加已核准申請單</button>
                      </div>
                    </div>`
                  : isFinalStep
                    ? `<p class="muted" style="font-size:0.85rem;margin:0 0 12px">此為最終審核步驟，不可新增附件。</p>`
                    : ''
              }
              <div class="field"><label>簽核意見</label><textarea id="action-comment" placeholder="選填意見（駁回／退回上一位時建議填寫）…"></textarea></div>
              <div class="approval-action-bar">
                <button type="button" class="btn success" id="btn-approve-card">核准</button>
                <button type="button" class="btn danger" id="btn-reject-card">駁回</button>
                <button type="button" class="btn outline" id="btn-cosign-card" title="臨時邀請其他同仁加簽">➕ 加簽</button>
                <button type="button" class="btn outline" id="btn-forward-card" title="將目前簽核關卡轉交給其他人">↗️ 轉簽</button>
                ${
                  canReturn && previousStep
                    ? `<button type="button" class="btn warning" id="btn-return-card"
                        title="退回「${esc(previousStep.name || '上一關')}」">
                        ↩ 退回上一位（${esc(previousStep.name || '上一關')}）
                      </button>`
                    : canApprove
                      ? `<span class="muted" style="font-size:0.85rem">此為第一關，無法退回上一位（需退件請用「駁回」）</span>`
                      : ''
                }
              </div>
              ${
                canReturn && previousStep
                  ? `<p class="muted" style="font-size:0.85rem;margin:10px 0 0;line-height:1.45">
                      「退回上一位」會將單據退至 <strong>${esc(previousStep.name || '上一關')}</strong>，
                      該關簽署人需<strong>重新簽核</strong>；歷程會留下退回紀錄。
                    </p>`
                  : ''
              }
            </div>`
          : ''
      }
    `;
}

function bindRequestDetailEvents(body, detailData, onRefresh) {
  const {
    request,
    canApprove,
    canReturn: canReturnApi,
    previousStep: previousStepApi,
    currentStep,
    canAttach,
    isFinalStep,
    canCancel,
    canDelete,
    canVoid,
    canVoidApply,
    pendingVoidRequest,
    voidOfRequest,
    voidPreviewSteps,
    approverSigned,
    coApprovers,
    applicantLabor,
    actingAsProxy,
    onlyOfficeEnabled,
  } = detailData;

  const id = request.id;
  const reqSteps = Array.isArray(request?.steps) ? request.steps : [];
  const curStepIdx = reqSteps.findIndex(
    (s) => Number(s.order) === Number(request?.current_step)
  );
  const previousStepClient =
    curStepIdx > 0
      ? {
          order: reqSteps[curStepIdx - 1].order,
          name: reqSteps[curStepIdx - 1].name || `步驟 ${reqSteps[curStepIdx - 1].order}`,
        }
      : null;
  const previousStep = previousStepApi || previousStepClient;
  const canReturn =
    !!canApprove &&
    request?.status === 'pending' &&
    !!(canReturnApi || previousStep);

  const isPdfTemplateReq = request.pdfLayout?.type === 'pdf_template';
  const usePdfFormView = request.status === 'pending' || isPdfTemplateReq;

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
    sigRadios.forEach((r) => r.addEventListener('change', syncSigModeUi));
    syncSigModeUi();
    (async () => {
      try {
        const sigRes = await api('/api/users/me/signature');
        if (sigRes?.signature_image) {
          state.user = {
            ...(state.user || {}),
            signature_image: sigRes.signature_image,
            has_signature: true,
          };
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
              </div>`;
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
          '實際總計依實際工時開始／結束自動換算（00:00～24:00 全日，最小 0.5 小時）',
      });
    }
    // 人事：假別（人事核定）切換 → 剩餘日數／小時自動調整
    bindHrLeaveTypeAutoRemain(stepBox, applicantLabor);
    bindSalesGrossAutoCalc(stepBox);
    bindItRepairNoncompliantNote(stepBox);
  }

  body.querySelectorAll('[data-dl-att]').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.dataset.dlAtt;
      const name = btn.dataset.dlName || `attachment-${id}`;
      if (btn.dataset.attView === '1' || isPreviewableAttachmentName(name)) {
        await openAttachmentPreview(id, name);
        return;
      }
      try {
        const blob = await api(`/api/attachments/${id}`, {
          expectBlob: true,
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        URL.revokeObjectURL(url);
      } catch (e) {
        toast(e.message, 'error');
      }
    };
  });
  body.querySelectorAll('[data-view-att]').forEach((btn) => {
    btn.onclick = () =>
      openAttachmentPreview(btn.dataset.viewAtt, btn.dataset.dlName || '');
  });
  body.querySelectorAll('[data-oo-edit]').forEach((btn) => {
    btn.onclick = () => openOnlyOfficeEditor(btn.dataset.ooEdit, request.id);
  });

  const doAction = async (action) => {
    const comment = $('#action-comment')?.value || '';
    if (action === 'reject' && !comment.trim()) {
      if (!confirm('確定要駁回嗎？（建議填寫意見）')) return;
    }
    if (action === 'return') {
      const prevName = previousStep?.name || '上一關';
      if (
        !confirm(
          `確定退回「${prevName}」？\n\n上一位簽署人需重新簽核；請填寫退回原因以便對方了解。`
        )
      ) {
        return;
      }
      if (!comment.trim()) {
        if (!confirm('尚未填寫簽核意見，仍要退回上一位嗎？')) return;
      }
    }
    let step_form_data = {};
    if (action === 'approve' && (currentStep?.approverFields || []).length) {
      const box = $('#step-form-fields');
      if (box) {
        for (const cid of IT_REPAIR_CHECK_IDS) {
          const sel = box.querySelector(`[data-ff="${cid}"]`);
          const note = box.querySelector(`[data-ff="${cid}_note"]`);
          if (sel && isItRepairNoncompliantValue(sel.value) && note && !String(note.value || '').trim()) {
            const lab = note.closest('.field')?.querySelector('label')?.dataset?.baseLabel
              || note.closest('.field')?.querySelector('label')?.textContent
              || '不符合說明';
            toast(`${String(lab).replace(/\s*\*\s*$/, '').trim()}為必填`, 'error');
            return;
          }
        }
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
    // 退回／駁回／取消不帶附件
    const attachFiles =
      action === 'approve' ? files : action === 'return' || action === 'reject' ? [] : files;
    let finalSignatureImage = null;
    if (action === 'approve' && SIGNATURE_SETTINGS_ENABLED) {
      const selectedMode = body.querySelector('input[name=sig_mode]:checked')?.value || 'default';
      if (selectedMode === 'draw') {
        if (!spotSignatureImage) {
          toast('請先點擊「點此開始手寫簽名」完成現場簽名', 'error');
          return;
        }
        finalSignatureImage = spotSignatureImage;
      } else {
        finalSignatureImage = state.user?.signature_image || null;
        if (!finalSignatureImage) {
          try {
            const sigRes = await api('/api/users/me/signature');
            finalSignatureImage = sigRes?.signature_image || null;
            if (finalSignatureImage) {
              state.user = {
                ...(state.user || {}),
                signature_image: finalSignatureImage,
                has_signature: true,
              };
            }
          } catch {
            /* ignore */
          }
        }
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
      attachFiles.forEach((f) => body.append('attachments', f));
      const result = await api(`/api/requests/${id}/action`, {
        method: 'POST',
        body,
      });
      const msg =
        result?.message ||
        (action === 'approve'
          ? '已核准'
          : action === 'reject'
            ? '已駁回'
            : action === 'return'
              ? '已退回上一位'
              : '已取消');
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

  $('#btn-pick-approved-step')?.addEventListener('click', async () => {
    const already = (request.attachments || [])
      .map((a) => a.source_request_id)
      .filter((n) => Number(n) > 0);
    await openApprovedRequestPicker({
      excludeIds: [id],
      alreadySelected: already,
      onConfirm: async (picked) => {
        if (!picked?.length) return;
        const fd = new FormData();
        fd.append('linked_request_ids', JSON.stringify(picked.map((x) => x.id)));
        try {
          const data = await api(`/api/requests/${id}/attachments`, {
            method: 'POST',
            body: fd,
          });
          toast(data.message || '已附加已核准申請單', 'success');
          navigate('detail', { id });
        } catch (e) {
          toast(e.message, 'error');
        }
      },
    });
  });

  const bindActionBtn = (sel, action) => {
    document.querySelectorAll(sel).forEach((btn) => {
      btn.addEventListener('click', () => doAction(action));
    });
  };
  bindActionBtn('#btn-approve, #btn-approve-card', 'approve');
  bindActionBtn('#btn-reject, #btn-reject-card', 'reject');
  bindActionBtn('#btn-return, #btn-return-card', 'return');
  const goDetail = () => navigate('detail', { id });
  document.querySelectorAll('#btn-cosign, #btn-cosign-card').forEach((btn) => {
    btn.addEventListener('click', () => openCosignModal(request, goDetail));
  });
  document.querySelectorAll('#btn-forward, #btn-forward-card').forEach((btn) => {
    btn.addEventListener('click', () => openForwardModal(request, goDetail));
  });
  $('#btn-cancel')?.addEventListener('click', () => {
    if (confirm('確定取消此申請？')) doAction('cancel');
  });
  $('#btn-void-apply')?.addEventListener('click', async () => {
    const path = voidStepsPathText(voidPreviewSteps || []);
    const reason = prompt(
      `請輸入作廢原因（必填）。\n送出後將由原單簽核人再簽：\n${path || '（依原單簽核人）'}`
    );
    if (reason === null) return;
    if (!String(reason).trim()) {
      toast('請填寫作廢原因', 'error');
      return;
    }
    if (
      !confirm(
        `確定提出作廢申請？\n原單：#${id}「${request.title}」\n流程：${
          path || '原單簽核人依序簽核'
        }\n全部通過後，原單才會自動改為已作廢。`
      )
    ) {
      return;
    }
    const btn = $('#btn-void-apply');
    if (btn) btn.disabled = true;
    try {
      const data = await api(`/api/requests/${id}/void-apply`, {
        method: 'POST',
        body: { reason: String(reason).trim() },
      });
      toast(data.message || '作廢申請已送出', 'success');
      navigate('detail', { id: data.request?.id || id });
    } catch (e) {
      toast(e.message || '送出失敗', 'error');
      if (btn) btn.disabled = false;
    }
  });
  $('#btn-void')?.addEventListener('click', async () => {
    const reason = prompt(
      '請輸入作廢原因（必填）。\n此為直接作廢，不會再走原單簽核人流程。'
    );
    if (reason === null) return;
    if (!String(reason).trim()) {
      toast('請填寫作廢原因', 'error');
      return;
    }
    if (
      !confirm(
        `確定直接作廢 #${id}「${request.title}」？\n狀態立即改為已作廢，歷程保留；將通知申請人與所有簽核人。`
      )
    ) {
      return;
    }
    const btn = $('#btn-void');
    if (btn) btn.disabled = true;
    try {
      const data = await api(`/api/requests/${id}/void`, {
        method: 'POST',
        body: { reason: String(reason).trim() },
      });
      toast(data.message || '申請已作廢', 'success');
      navigate('detail', { id });
    } catch (e) {
      toast(e.message || '作廢失敗', 'error');
      if (btn) btn.disabled = false;
    }
  });
  $('#btn-edit-draft')?.addEventListener('click', () => {
    navigate('new-request', { draftId: request.id });
  });
  $('#btn-submit-draft')?.addEventListener('click', async () => {
    if (
      !confirm(
        '確定以目前草稿內容送出簽核？\n送出後將進入簽核流程，無法再當草稿編輯。'
      )
    ) {
      return;
    }
    try {
      const body = new FormData();
      body.append('workflow_id', String(request.workflow_id));
      body.append('title', request.title || '');
      body.append('content', '');
      body.append(
        'form_data',
        JSON.stringify(request.form_data || {})
      );
      body.append('submit', '1');
      body.append('as_draft', '0');
      // 代申請草稿：帶入被代理人，避免送出後變成以本人為申請人
      if (
        request.submitted_by &&
        Number(request.submitted_by) === Number(state.user?.id) &&
        Number(request.requester_id) !== Number(state.user?.id)
      ) {
        body.append('proxy_for', String(request.requester_id));
        body.append('on_behalf_of_user_id', String(request.requester_id));
      }
      // 沿用草稿上的通知設定（若有）
      if (request.notify_prefs) {
        body.append(
          'notify_prefs',
          JSON.stringify(request.notify_prefs)
        );
        body.append(
          'notify_email',
          request.notify_email === 0 ? '0' : '1'
        );
      }
      const data = await api(`/api/requests/${request.id}`, {
        method: 'PUT',
        body,
      });
      toast(data.message || '申請已送出', 'success');
      navigate('detail', { id: request.id });
    } catch (e) {
      toast(e.message, 'error');
    }
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
      // FitH：寬度撐滿；toolbar=1 保留瀏覽器 PDF 工具列（縮放）
      wrap.innerHTML = `<iframe class="pdf-frame" title="申請單 PDF 預覽" src="${pdfPreviewObjectUrl}#toolbar=1&navpanes=0&view=FitH"></iframe>`;
      const newTabBtn = $('#btn-pdf-newtab');
      if (newTabBtn) {
        newTabBtn.onclick = () => {
          window.open(pdfPreviewObjectUrl, '_blank', 'noopener');
        };
      }
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

  $('#btn-clone-request')?.addEventListener('click', () => {
    navigate('new-request', { cloneFrom: id });
  });
  const finConfirmBtn = $('#btn-finance-confirm');
  if (finConfirmBtn) {
    finConfirmBtn.onclick = async () => {
      try {
        await api(`/api/requests/${id}/finance-confirm`, {
          method: 'POST',
          body: { note: '已於ERP系統完成授信額度設定' },
        });
        toast('已完成財務部額度建檔登記，並發送通知至申請人', 'success');
        if (typeof onRefresh === 'function') onRefresh();
        else renderDetail(body, id);
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
        if (typeof onRefresh === 'function') onRefresh();
        else renderDetail(body, id);
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
        if (typeof onRefresh === 'function') onRefresh();
        else renderDetail(body, id);
        refreshBadge();
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }

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
        `確定刪除申請 #${id}「${request.title}」？\n將一併刪除歷程、附件與相關備份，無法復原。`
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

async function renderDetail(body, id) {
  const detailData = await fetchRequestDetailData(id);
  $('#page-title').textContent = `簽核詳情 #${detailData.request.id}${
    detailData.request.status === 'draft' ? '（草稿）' : ''
  }`;
  $('#page-actions').innerHTML = buildRequestDetailActionsHtml(detailData);
  body.innerHTML = `
    <div class="detail-main">
      ${buildRequestDetailMainHtml(detailData)}
    </div>`;
  bindRequestDetailEvents(body, detailData, () => renderDetail(body, id));
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

if (typeof window !== 'undefined') {
  window.fetchRequestDetailData = fetchRequestDetailData;
  window.buildRequestDetailActionsHtml = buildRequestDetailActionsHtml;
  window.buildRequestDetailMainHtml = buildRequestDetailMainHtml;
  window.bindRequestDetailEvents = bindRequestDetailEvents;
  window.openCosignModal = openCosignModal;
  window.openForwardModal = openForwardModal;
}

function userLabelById(id) {
  const u = (state.users || []).find((x) => x.id === Number(id));
  return u ? u.name : `#${id}`;
}

function describeStepForList(s) {
  if (!s) return '';
  if (s.assignType === 'form_user') return `${s.name}（表單指定）`;
  if (s.assignType === 'dept_head') return `${s.name}（自選／可略過）`;
  if (s.assignType === 'cosign_pick') return `${s.name}（會簽選填）`;
  if (s.assignType === 'users_pick') return `${s.name}（申請人自選）`;
  if (s.assignType === 'department') return `${s.name}（${s.department || '單位'}）`;
  if (s.assignType === 'users' || (s.approverIds && s.approverIds.length)) {
    const names = (s.approverIds || []).map(userLabelById).join('、');
    return names ? `${s.name}（${names}）` : s.name;
  }
  return s.name;
}
