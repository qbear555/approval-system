function prepareNewRequestWorkflows(workflows) {
  // 正規化 category 並排序
  workflows.forEach((w) => {
    w.category = String(w.category || '').trim() || '一般簽呈';
  });

  const CAT_ORDER = ['人事差勤', '財務採購', '資訊總務', '業務行政', '一般簽呈'];
  const catsSet = new Set(workflows.map((w) => w.category));
  const sortedCats = [...catsSet].sort((a, b) => {
    const ia = CAT_ORDER.indexOf(a);
    const ib = CAT_ORDER.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });

  const optgroupsHtml = sortedCats
    .map((cat) => {
      const items = workflows.filter((w) => w.category === cat);
      if (!items.length) return '';
      return `<optgroup label="${esc(cat)}">
        ${items.map((w) => `<option value="${w.id}">${esc(w.name)}</option>`).join('')}
      </optgroup>`;
    })
    .join('');

  return { sortedCats, optgroupsHtml };
}

function getNewRequestCatalogInnerHtml(workflows, sortedCats) {
  const favIdSet = new Set(getFavWorkflowIds(workflows));
  const cardsHtml = workflows
    .map((w) => {
      const icon = getWorkflowIcon(w.name, w.category);
      const catCls = getCategoryClass(w.category);
      const isFav = favIdSet.has(w.id);
      const steps = (w.steps || []).map((s) => s.name).filter(Boolean);
      const stepsText = steps.length
        ? `申請人 → ${steps.join(' → ')}`
        : (w.description || '點擊填寫');
      const fieldCount = (w.formFields || []).length;
      const searchHaystack = `${w.name} ${w.category} ${w.description || ''} ${(w.formFields || []).map((f) => f.label).join(' ')}`.toLowerCase();
      return `
    <div class="catalog-card" data-wf-id="${w.id}" data-category="${esc(w.category)}"
         data-search-text="${esc(searchHaystack)}">
      <div class="catalog-card-header">
        <div class="catalog-icon-box ${catCls}">${icon}</div>
        <div style="display:flex;align-items:center;gap:6px">
          <span class="catalog-category-tag ${catCls}">${esc(w.category)}</span>
          <button type="button" class="catalog-fav-btn ${isFav ? 'active' : ''}" data-toggle-fav="${w.id}" title="${isFav ? '已在常用表單（點擊取消）' : '加入常用表單'}">${isFav ? '★' : '☆'}</button>
        </div>
      </div>
      <div class="catalog-card-body">
        <h4 class="catalog-card-title">${esc(w.name)}</h4>
        <p class="catalog-card-desc">${esc(w.description || (fieldCount ? `包含 ${fieldCount} 個欄位` : '點擊立即發起申請'))}</p>
      </div>
      <div class="catalog-card-footer">
        <span class="catalog-card-steps" title="${esc(stepsText)}">${esc(stepsText)}</span>
        <span class="catalog-card-btn">填寫申請 →</span>
      </div>
    </div>`;
    })
    .join('');

  return `
      <div class="catalog-header">
        <h2>選擇申請表單</h2>
        <p>請點選欲申請的表單項目，或利用上方搜尋框與分類頁籤快速篩選。</p>
      </div>

      <div class="catalog-search-wrap">
        <span class="catalog-search-icon">🔍</span>
        <input type="text" id="catalog-search-inp" class="catalog-search-input"
          placeholder="搜尋表單名稱、說明或關鍵字（例如：請假、報支、報修、請購、出差、加班...）" autocomplete="off" />
        <button type="button" id="catalog-search-clear" class="catalog-search-clear hidden" title="清除搜尋">✕</button>
      </div>

      <div class="catalog-tabs" id="catalog-tabs-bar">
        <button type="button" class="catalog-tab active" data-cat="全部">
          全部 <span class="catalog-tab-count">${workflows.length}</span>
        </button>
        ${sortedCats
          .map(
            (cat) => `
          <button type="button" class="catalog-tab" data-cat="${esc(cat)}">
            ${esc(cat)} <span class="catalog-tab-count">${
              workflows.filter((w) => w.category === cat).length
            }</span>
          </button>`
          )
          .join('')}
      </div>

      <div class="catalog-grid" id="catalog-grid">
        ${cardsHtml}
        <div id="catalog-no-results" class="catalog-empty hidden">
          <div class="catalog-empty-icon">🔍</div>
          <div class="catalog-empty-title">查無符合的申請表單</div>
          <p>請嘗試其他關鍵字，或切換上方分類頁籤查看。</p>
        </div>
      </div>
  `;
}

function getNewRequestFormInnerHtml(optgroupsHtml, user) {
  const userObj = user || (typeof state !== 'undefined' ? state.user : null);
  return `
      <div class="wf-nav-banner">
        <button type="button" class="btn outline sm" id="btn-back-to-catalog">← 重新選擇表單</button>
        <div class="wf-nav-current">
          <span class="muted">目前表單：</span>
          <span class="field-type-tag" id="current-wf-cat-tag">一般簽呈</span>
          <strong id="current-wf-name-text">請選擇流程</strong>
        </div>
      </div>

      <form id="req-form" class="form-grid">
        <div id="clone-banner" class="hidden" style="grid-column:1/-1;margin-bottom:12px;padding:12px 14px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;display:flex;align-items:center;gap:10px;font-size:0.92rem;color:#1e40af"></div>
        <div class="field">
          <label>簽核流程 *</label>
          <select name="workflow_id" required>
            <option value="">請選擇流程…</option>
            ${optgroupsHtml}
          </select>
        </div>
        <div id="wf-preview" class="muted"></div>
        <div class="field hidden" id="leave-proxy-wrap">
          <label>申請人（代申請請假）</label>
          <select name="proxy_for" id="leave-proxy-select">
            <option value="">本人申請</option>
          </select>
          <p class="muted" style="font-size:0.8rem;margin:4px 0 0">
            預設為本人申請。可改選任何同仁代其申請請假：申請人＝被代申請人，
            簽核流程依其身分解析；您為實際送出人。
            表單「代理人」為<strong>職務代理人</strong>（可填本人或其他同仁），於請假起迄期間可代申請人簽核其他待辦。
          </p>
        </div>
        <div class="field hidden" id="title-field-wrap">
          <label id="req-title-label">主旨 *</label>
          <input name="title" id="req-title" maxlength="200" placeholder="請填寫主旨" />
          <p class="muted" id="req-title-hint" style="font-size:0.8rem;margin:4px 0 0">一般簽呈、費用報支需填主旨；其餘流程由系統依表單自動產生。</p>
        </div>
        <div id="custom-form-area" class="hidden">
          <div class="form-section-title"><strong>流程表單</strong><span class="muted">依所選流程自動顯示</span></div>
          <div class="custom-form-block form-preview-grid form-fields-multi" id="custom-form-fields"></div>
        </div>
        <div class="field" id="attach-area">
          <label>附件（選填，可多檔上傳或附加已核准申請單）</label>
          <div id="req-existing-attachments" class="hidden"></div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">
            <input type="file" id="req-attachments" name="attachments" multiple
              accept=".pdf,.png,.jpg,.jpeg,.gif,.doc,.docx,.xls,.xlsx,.txt,image/*" />
            <button type="button" class="btn outline sm" id="btn-pick-approved-req">附加已核准申請單</button>
          </div>
          <div class="muted" style="font-size:0.82rem;margin-top:4px">可一次選取多個檔案（Ctrl／Shift 多選），或從已簽核完成的申請單帶入 PDF。最多 20 個、每個檔案上限 10MB。送出前可預覽、移除。</div>
        </div>
        <div class="field" id="notify-prefs-box">
          <label style="white-space:nowrap">Email 提醒通知${
            userObj?.email
              ? ` <span class="muted" style="font-weight:400">（${esc(userObj.email)}）</span>`
              : ` <span style="color:#b45309;font-weight:400">（尚未設定 Email）</span>`
          }</label>
          <div id="notify-prefs-detail" style="display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px">
            <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;margin:0;white-space:nowrap">
              <input type="checkbox" name="notify_email" id="notify-email-cb" value="1"
                ${userObj?.email_notify !== 0 ? 'checked' : ''} />
              開啟通知
            </label>
            <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;margin:0;white-space:nowrap">
              <input type="checkbox" id="notify-all-cb" />
              全部（核准／駁回／下一步）
            </label>
            <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;margin:0;white-space:nowrap">
              <input type="checkbox" id="notify-approved-cb" class="notify-event-cb" data-event="approved" checked />
              核准
            </label>
            <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;margin:0;white-space:nowrap">
              <input type="checkbox" id="notify-rejected-cb" class="notify-event-cb" data-event="rejected" />
              駁回
            </label>
            <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;margin:0;white-space:nowrap">
              <input type="checkbox" id="notify-step-cb" class="notify-event-cb" data-event="step" />
              下一步
            </label>
          </div>
        </div>
        <div class="form-actions" style="flex-wrap:wrap;gap:8px">
          <button type="button" class="btn outline" id="btn-save-draft">儲存草稿</button>
          <button type="submit" class="btn primary" id="btn-submit-request">送出申請</button>
          <span class="muted" style="font-size:0.85rem;align-self:center" id="draft-status-hint"></span>
        </div>
      </form>
  `;
}

function initNewRequestInteractions(body, workflows) {

  const sel = body.querySelector('[name=workflow_id]');
  const preview = $('#wf-preview');
  const formArea = $('#custom-form-area');
  const formFieldsBox = $('#custom-form-fields');
  const cloneFromId = Number(state.pageParams?.cloneFrom || 0) || 0;
  /** 正在編輯的草稿 id（有則更新，無則新建；複製模式下一律新建） */
  let editingDraftId = cloneFromId ? 0 : (Number(state.pageParams?.draftId || state.pageParams?.id || 0) || 0);
  /** 草稿已存在伺服器的附件（重新編輯時顯示） */
  let draftAttachments = [];
  /** 尚未送出、僅存在本機選取區的附件（可逐筆移除） */
  let pendingLocalFiles = [];
  /** 已選、尚未寫入伺服器的已核准申請單 */
  let pendingLinkedRequests = [];
  /** 草稿表單預設值（渲染欄位時帶入，避免富文字事由載入後空白） */
  let draftFormDefaults = {};
  /** 可代申請請假的對象（選擇請假流程時顯示） */
  let leavePrincipals = [];
  /** 草稿還原用的代申請對象 id */
  let draftProxyForId = 0;
  const draftHint = $('#draft-status-hint');
  const setDraftHint = (msg) => {
    if (draftHint) draftHint.textContent = msg || '';
  };
  if (editingDraftId) {
    setDraftHint(`編輯草稿 #${editingDraftId}`);
  }

  const fillLeaveProxySelect = () => {
    const selProxy = $('#leave-proxy-select');
    if (!selProxy) return;
    const cur = selProxy.value || (draftProxyForId ? String(draftProxyForId) : '');
    selProxy.innerHTML =
      `<option value="">本人申請</option>` +
      leavePrincipals
        .map(
          (p) =>
            `<option value="${p.id}">${esc(p.name)}${
              p.department ? `（${esc(p.department)}）` : ''
            }</option>`
        )
        .join('');
    if (cur && [...selProxy.options].some((o) => o.value === String(cur))) {
      selProxy.value = String(cur);
    }
  };

  // 載入可代申請對象（所有啟用同仁；請假流程中顯示）
  (async () => {
    try {
      const data = await api('/api/agents/leave-principals');
      leavePrincipals = Array.isArray(data.principals) ? data.principals : [];
      fillLeaveProxySelect();
      if (sel?.value) refreshWorkflowUi();
    } catch {
      // 後備：用已載入的 users 名單
      leavePrincipals = (state.users || []).filter(
        (x) => x.active !== 0 && Number(x.id) !== Number(state.user?.id)
      );
      fillLeaveProxySelect();
    }
  })();

  const fmtAttSize = (n) => {
    if (!n) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  };

  const totalAttachCount = () =>
    (Array.isArray(draftAttachments) ? draftAttachments.length : 0) +
    pendingLocalFiles.length +
    pendingLinkedRequests.length;

  /** 送出前附件清單：已存草稿 + 剛選尚未送出的檔，皆可移除 */
  const renderDraftAttachmentsUi = () => {
    const box = $('#req-existing-attachments');
    if (!box) return;
    const saved = Array.isArray(draftAttachments) ? draftAttachments : [];
    const pending = pendingLocalFiles;
    const linked = pendingLinkedRequests;
    if (!saved.length && !pending.length && !linked.length) {
      box.innerHTML = '';
      box.classList.add('hidden');
      return;
    }
    box.classList.remove('hidden');
    const savedHtml = saved.length
      ? `<div style="font-size:0.9rem;margin:0 0 4px;color:#166534"><strong>已保存在草稿</strong></div>
        <ul style="margin:0 0 8px;padding-left:18px">
          ${saved
            .map(
              (a) => `
            <li style="margin:5px 0;display:flex;flex-wrap:wrap;align-items:center;gap:8px">
              <button type="button" class="linkish" data-draft-dl-att="${a.id}"
                data-dl-name="${esc(a.original_name || '')}">${esc(a.original_name || `附件#${a.id}`)}</button>
              <span class="muted" style="font-size:0.82rem">${
                a.size_bytes ? fmtAttSize(a.size_bytes) : ''
              }</span>
              <button type="button" class="btn sm outline" data-draft-rm-att="${a.id}">移除</button>
            </li>`
            )
            .join('')}
        </ul>`
      : '';
    const pendingHtml = pending.length
      ? `<div style="font-size:0.9rem;margin:${saved.length ? '6px' : '0'} 0 4px;color:#1d4ed8"><strong>已選、尚未送出</strong></div>
        <ul style="margin:0;padding-left:18px">
          ${pending
            .map(
              (f, i) => `
            <li style="margin:5px 0;display:flex;flex-wrap:wrap;align-items:center;gap:8px">
              <span>${esc(f.name || `檔案${i + 1}`)}</span>
              <span class="muted" style="font-size:0.82rem">${fmtAttSize(f.size)}</span>
              <button type="button" class="btn sm outline" data-pending-rm="${i}">移除</button>
            </li>`
            )
            .join('')}
        </ul>`
      : '';
    const linkedHtml = linked.length
      ? `<div style="font-size:0.9rem;margin:${
          saved.length || pending.length ? '6px' : '0'
        } 0 4px;color:#047857"><strong>已選已核准申請單</strong></div>
        <ul style="margin:0;padding-left:18px">
          ${linked
            .map(
              (r, i) => `
            <li style="margin:5px 0;display:flex;flex-wrap:wrap;align-items:center;gap:8px">
              <span>${esc(formatApprovedRequestLabel(r))}</span>
              <button type="button" class="btn sm outline" data-linked-preview="${r.id}" data-linked-title="${esc(
                formatApprovedRequestLabel(r)
              )}">預覽</button>
              <button type="button" class="btn sm outline" data-linked-rm="${i}">移除</button>
            </li>`
            )
            .join('')}
        </ul>`
      : '';
    box.innerHTML = `
      <div style="margin:0 0 10px;padding:10px 12px;background:#f8fafc;border:1px solid var(--border);border-radius:10px">
        <div style="font-size:0.92rem;margin-bottom:6px">
          <strong>附件清單</strong>
          <span class="muted" style="font-weight:400">（${totalAttachCount()} 個，送出前可移除）</span>
        </div>
        ${savedHtml}
        ${pendingHtml}
        ${linkedHtml}
      </div>`;
    box.querySelectorAll('[data-draft-dl-att]').forEach((btn) => {
      btn.onclick = async () => {
        const name = btn.dataset.dlName || `attachment-${btn.dataset.draftDlAtt}`;
        if (isPreviewableAttachmentName(name)) {
          await openAttachmentPreview(btn.dataset.draftDlAtt, name);
          return;
        }
        try {
          const blob = await api(`/api/attachments/${btn.dataset.draftDlAtt}`, {
            expectBlob: true,
          });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = name;
          a.click();
          URL.revokeObjectURL(url);
        } catch (e) {
          toast(e.message || '開啟失敗', 'error');
        }
      };
    });
    box.querySelectorAll('[data-draft-rm-att]').forEach((btn) => {
      btn.onclick = async () => {
        const attId = Number(btn.dataset.draftRmAtt);
        if (!attId) return;
        if (!confirm('確定移除此附件？')) return;
        try {
          await api(`/api/attachments/${attId}`, { method: 'DELETE' });
          draftAttachments = draftAttachments.filter((x) => Number(x.id) !== attId);
          renderDraftAttachmentsUi();
          toast('已移除附件', 'success');
        } catch (e) {
          toast(e.message || '移除失敗', 'error');
        }
      };
    });
    box.querySelectorAll('[data-pending-rm]').forEach((btn) => {
      btn.onclick = () => {
        const idx = Number(btn.dataset.pendingRm);
        if (!Number.isFinite(idx)) return;
        pendingLocalFiles = pendingLocalFiles.filter((_, i) => i !== idx);
        renderDraftAttachmentsUi();
      };
    });
    box.querySelectorAll('[data-linked-preview]').forEach((btn) => {
      btn.onclick = () =>
        openRequestPdfPreview(btn.dataset.linkedPreview, btn.dataset.linkedTitle);
    });
    box.querySelectorAll('[data-linked-rm]').forEach((btn) => {
      btn.onclick = () => {
        const idx = Number(btn.dataset.linkedRm);
        if (!Number.isFinite(idx)) return;
        pendingLinkedRequests = pendingLinkedRequests.filter((_, i) => i !== idx);
        renderDraftAttachmentsUi();
      };
    });
  };

  $('#btn-pick-approved-req')?.addEventListener('click', async () => {
    const already = [
      ...pendingLinkedRequests.map((x) => x.id),
      ...draftAttachments
        .map((a) => a.source_request_id)
        .filter((n) => Number(n) > 0),
    ];
    await openApprovedRequestPicker({
      excludeIds: editingDraftId ? [editingDraftId] : [],
      alreadySelected: already,
      onConfirm: (picked) => {
        if (!picked?.length) return;
        const have = new Set([
          ...pendingLinkedRequests.map((x) => Number(x.id)),
          ...draftAttachments.map((a) => Number(a.source_request_id)).filter((n) => n > 0),
        ]);
        const next = [...pendingLinkedRequests];
        for (const r of picked) {
          if (have.has(Number(r.id))) continue;
          next.push(r);
        }
        if (draftAttachments.length + pendingLocalFiles.length + next.length > 20) {
          toast('附件最多 20 個（含草稿已存檔）', 'error');
          return;
        }
        pendingLinkedRequests = next;
        renderDraftAttachmentsUi();
        toast(`已加入 ${picked.length} 張已核准申請單`, 'success');
      },
    });
  });

  $('#req-attachments')?.addEventListener('change', (ev) => {
    const input = ev.target;
    const picked = input?.files ? [...input.files] : [];
    if (!picked.length) return;
    const next = [...pendingLocalFiles];
    for (const f of picked) {
      if (f.size > 10 * 1024 * 1024) {
        toast(`「${f.name}」超過 10MB，已略過`, 'error');
        continue;
      }
      const dup = next.some(
        (x) => x.name === f.name && x.size === f.size && x.lastModified === f.lastModified
      );
      if (!dup) next.push(f);
    }
    if (draftAttachments.length + pendingLinkedRequests.length + next.length > 20) {
      toast('附件最多 20 個（含草稿已存檔）', 'error');
      input.value = '';
      return;
    }
    pendingLocalFiles = next;
    input.value = '';
    renderDraftAttachmentsUi();
  });

  // Email 通知：全部／個別勾選連動
  const bindNotifyPrefsUi = () => {
    const master = $('#notify-email-cb');
    const allCb = $('#notify-all-cb');
    const detail = $('#notify-prefs-detail');
    const events = [
      $('#notify-approved-cb'),
      $('#notify-rejected-cb'),
      $('#notify-step-cb'),
    ].filter(Boolean);
    if (!master || !allCb || !events.length) return;

    const syncAllFromEvents = () => {
      const every = events.every((c) => c.checked);
      const some = events.some((c) => c.checked);
      allCb.checked = every;
      allCb.indeterminate = some && !every;
    };
    const setEventsEnabled = (on) => {
      allCb.disabled = !on;
      events.forEach((c) => {
        c.disabled = !on;
      });
      if (detail) detail.style.opacity = on ? '1' : '0.5';
    };
    const onMaster = () => {
      const on = master.checked;
      setEventsEnabled(on);
      if (on) {
        // 開啟時若全無勾選，預設僅「核准」
        if (!events.some((c) => c.checked)) {
          events.forEach((c) => {
            c.checked = c.id === 'notify-approved-cb' || c.dataset?.event === 'approved';
          });
        }
      }
      syncAllFromEvents();
    };
    master.addEventListener('change', onMaster);
    allCb.addEventListener('change', () => {
      const on = allCb.checked;
      events.forEach((c) => {
        c.checked = on;
      });
      allCb.indeterminate = false;
      if (on && !master.checked) {
        master.checked = true;
        setEventsEnabled(true);
      }
    });
    events.forEach((c) => {
      c.addEventListener('change', () => {
        syncAllFromEvents();
        // 若個別有勾選，確保主開關開啟
        if (events.some((x) => x.checked) && !master.checked) {
          master.checked = true;
          setEventsEnabled(true);
        }
      });
    });
    onMaster();
  };
  bindNotifyPrefsUi();

  const isLeaveWorkflow = (w) => {
    const n = String(w?.name || '');
    return /請假/.test(n);
  };
  const isExecTeamApplicantUser = (user) => {
    if (!user) return false;
    const depts = [user.department, ...(user.departments || [])].filter(Boolean);
    return depts.some((d) => /經營團隊/.test(String(d)));
  };
  const leaveStepsForApplicant = (w, applicant) => {
    const steps = [...(w.steps || [])];
    if (!isLeaveWorkflow(w) || !isExecTeamApplicantUser(applicant)) return steps;
    return steps.filter(
      (s) => !/副總/.test(String(s.name || '')) && s.assignType !== 'dept_head' && !/部門主管/.test(String(s.name || ''))
    );
  };
  const leavePathDescription = (steps, proxyPicked) => {
    const names = (steps || [])
      .map((s) => String(s.name || '').trim())
      .filter(Boolean);
    const start = proxyPicked ? `申請人（代 ${proxyPicked}）` : '申請人';
    return names.length ? `${start} → ${names.join(' → ')}` : start;
  };
  /** 延長工時／加班申請：表單採多欄緊湊版面 */
  const isOtWorkflow = (w) => {
    const n = String(w?.name || '');
    return /延長工時|加班/.test(n);
  };
  /** 一般簽呈 */
  const isGeneralMemoWorkflow = (w) => {
    const n = String(w?.name || '');
    return /一般簽呈|簽呈/.test(n) && !/信用額度|請假|請購|支付|報支|出差|加班|報修/.test(n);
  };
  /** 費用報支 */
  const isExpenseWorkflow = (w) => /費用|報支|報銷|請款/.test(String(w?.name || ''));
  const isVoidWorkflow = (w) => /作廢申請/.test(String(w?.name || ''));
  /** 是否顯示主旨輸入（一般簽呈、費用報支） */
  const showTitleField = (w) => isGeneralMemoWorkflow(w) || isExpenseWorkflow(w);

  /** 電腦異常報修：不使用說明欄富文字／自繪 */
  const isItRepairWorkflow = (w) => {
    const n = String(w?.name || '');
    return /電腦異常|異常報修|報修申請|IT.?Repair/i.test(n);
  };

  /** 請假申請：自動產生主旨 */
  const buildLeaveTitle = (formEl) => {
    const data = collectFormData(formEl);
    const type = data.leave_type || data.假別 || '';
    const days = data.days != null && data.days !== '' ? `${data.days}日` : '';
    const hours =
      data.hours != null && data.hours !== '' && Number(data.hours) > 0
        ? `${data.hours}小時`
        : '';
    const proxySel = formEl?.querySelector?.('#leave-proxy-select');
    const proxyId = proxySel?.value ? Number(proxySel.value) : 0;
    const proxyName =
      proxyId && proxySel?.selectedOptions?.[0]
        ? String(proxySel.selectedOptions[0].textContent || '')
            .replace(/（.*）$/, '')
            .trim()
        : '';
    const parts = proxyId
      ? [`代申請請假${proxyName ? `（${proxyName}）` : ''}`]
      : ['請假申請'];
    if (type) parts.push(String(type));
    const period = formatLeaveTitlePeriodClient(data.start_date, data.end_date);
    if (period) parts.push(period);
    if (/事假/.test(String(type))) {
      const disp = computePersonalLeaveDisplay(data);
      if (disp?.text) parts.push(disp.text);
      else {
        if (days) parts.push(days);
        if (hours) parts.push(hours);
      }
    } else if (isSickLeaveTypeClient(type)) {
      const disp = computeSickLeaveDisplay(data);
      if (disp?.text) parts.push(disp.text);
      else if (days) parts.push(days);
      else if (hours) parts.push(hours);
    } else if (isSpecialLeaveTypeClient(type)) {
      if (days) parts.push(days);
    } else {
      if (days) parts.push(days);
      if (hours) parts.push(hours);
    }
    return parts.join(' · ').slice(0, 200);
  };

  /**
   * 非一般簽呈：不顯示主旨欄，依表單＋流程名稱自動組成（列表／搜尋仍用 title）
   */
  const buildAutoTitle = (w, formEl) => {
    if (isLeaveWorkflow(w)) return buildLeaveTitle(formEl);
    const data = collectFormData(formEl) || {};
    const wfName = String(w?.name || '申請').trim() || '申請';
    if (/福利金/.test(wfName)) {
      const y = welfareCurrentRocYear(data);
      const m = String(data.period_month || '').replace(/[^\d]/g, '');
      if (m) return `${wfName} · ${y}年${Number(m)}月`.slice(0, 200);
      return wfName.slice(0, 200);
    }
    const pick = [
      data.subject,
      data.item_name,
      data.purpose,
      data.reason,
      data.destination,
      data.customer_name,
      data.issue_desc,
      data.expense_type,
      data.desc,
      data.ot_option,
      data.trading_products,
    ]
      .map((v) => (v == null ? '' : String(v).trim()))
      .filter(Boolean)
      .map((s) => s.replace(/\s+/g, ' ').slice(0, 80));
    if (pick.length) return `${wfName} · ${pick[0]}`.slice(0, 200);
    return wfName.slice(0, 200);
  };

  const refreshWorkflowUi = () => {
    const w = workflows.find((x) => x.id === Number(sel.value));
    const titleWrap = $('#title-field-wrap');
    const titleInp = $('#req-title');
    if (!w) {
      preview.innerHTML = '';
      formArea.classList.add('hidden');
      formFieldsBox.innerHTML = '';
      formFieldsBox.classList.remove('form-fields-ot');
      // 未選流程：先隱藏主旨，選定後再依類型顯示
      if (titleWrap) titleWrap.classList.add('hidden');
      if (titleInp) {
        titleInp.required = false;
        titleInp.value = '';
      }
      return;
    }

    const leaveMode = isLeaveWorkflow(w);
    const otMode = isOtWorkflow(w);
    const needTitle = showTitleField(w);
    const plainTextMode = leaveMode || isItRepairWorkflow(w) || isVoidWorkflow(w);
    if (titleWrap) titleWrap.classList.toggle('hidden', !needTitle);
    if (titleInp) {
      titleInp.required = needTitle;
      if (!needTitle) titleInp.value = '';
      else {
        titleInp.placeholder = isExpenseWorkflow(w)
          ? '請填寫報支主旨'
          : '請填寫簽呈主旨';
      }
    }
    const titleLabel = $('#req-title-label');
    if (titleLabel) {
      titleLabel.textContent = isExpenseWorkflow(w)
        ? '主旨 *（費用報支）'
        : '主旨 *（一般簽呈）';
    }
    // 請假流程：一律顯示「本人／代申請」選擇
    const proxyWrap = $('#leave-proxy-wrap');
    if (proxyWrap) {
      proxyWrap.classList.toggle('hidden', !leaveMode);
      if (!leaveMode) {
        const ps = $('#leave-proxy-select');
        if (ps) ps.value = '';
      } else {
        fillLeaveProxySelect();
      }
    }

    const proxySel = $('#leave-proxy-select');
    const proxyPicked =
      leaveMode && proxySel?.value
        ? String(proxySel.selectedOptions?.[0]?.textContent || '')
            .replace(/（.*）$/, '')
            .trim()
        : '';
    const applicantUser =
      leaveMode && proxySel?.value
        ? (state.users || []).find((u) => Number(u.id) === Number(proxySel.value)) ||
          null
        : state.user;
    const previewSteps = leaveStepsForApplicant(w, applicantUser);
    const skipExecTeamPath = leaveMode && isExecTeamApplicantUser(applicantUser);
    const voidMode = isVoidWorkflow(w);

    preview.innerHTML = voidMode
      ? `<div class="muted">${esc(
          w.description || '請先選擇欲作廢的已核准申請單，簽核人將依原單帶入。'
        )}</div>`
      : `
      <div class="muted" style="margin-bottom:8px">簽核層級：${
        proxyPicked
          ? `代理人送出（代 ${esc(proxyPicked)}）→ 下列步驟依序簽核`
          : '申請人送出 → 下列步驟依序簽核'
      }</div>
      ${
        skipExecTeamPath
          ? `<div class="muted" style="margin:0 0 8px;color:#9a3412">申請人為經營團隊：略過部門主管、副總經理，經代理人、人事單位後送總經理。</div>`
          : ''
      }
      ${flowChartHtml(previewSteps, {
        showLegend: false,
        flow: skipExecTeamPath ? null : w.flow || null,
      })}
      <div class="muted" style="margin-top:6px">${esc(
        leaveMode ? leavePathDescription(previewSteps, proxyPicked) : w.description || ''
      )}</div>`;
    // 請假表單：確保有「小時」欄（接在天數後）
    let fields = [...(w.formFields || [])];
    if (leaveMode && !fields.some((f) => f.id === 'hours')) {
      const daysIdx = fields.findIndex((f) => f.id === 'days');
      const hoursField = {
        id: 'hours',
        label: '小時',
        type: 'number',
        required: false,
        placeholder: '依起迄自動試算（最小 0.5；全日＝7.5 小時）',
      };
      if (daysIdx >= 0) fields.splice(daysIdx + 1, 0, hoursField);
      else fields.push(hoursField);
    }
    // 天數欄位提示更新
    fields = fields.map((f) => {
      if (f.id === 'days') {
        return {
          ...f,
          placeholder: f.placeholder || '全日 09:00～17:30＝1 日',
        };
      }
      // 請假「代理人」= 職務代理人：請假期間可代申請人簽核
      if (leaveMode && (f.id === 'agent' || /代理/.test(String(f.label || '')))) {
        return {
          ...f,
          label: f.label && !/職務/.test(String(f.label))
            ? `${f.label}（職務代理人）`
            : f.label || '代理人（職務代理人）',
          hint:
            f.hint ||
            '可填寫本人或其他同仁。於請假起迄期間，職務代理人可代申請人簽核其他待辦。',
        };
      }
      return f;
    });
    const deptHeadSteps = skipExecTeamPath
      ? []
      : (w.steps || []).filter((s) => s.assignType === 'dept_head');
    const cosignSteps = (w.steps || []).filter((s) => s.assignType === 'cosign_pick');
    const hasAttendeeField = (w.formFields || []).some(
      (f) => f.id === 'attendee_ids'
    );
    const usersPickSteps = (w.steps || []).filter((s) => {
      if (s.assignType !== 'users_pick') return false;
      if (hasAttendeeField && /與會/.test(String(s.name || ''))) return false;
      return true;
    });
    const hasDeptHead = deptHeadSteps.length > 0;
    const hasCosign = cosignSteps.length > 0;
    const hasUsersPick = usersPickSteps.length > 0;
    if (fields.length || hasDeptHead || hasCosign || hasUsersPick) {
      formArea.classList.remove('hidden');
      const deptHeadHtml = deptHeadSteps.map(renderDeptHeadChooserHtml).join('');
      const cosignHtml = cosignSteps.map(renderCosignChooserHtml).join('');
      const usersPickHtml = usersPickSteps.map(renderUsersPickChooserHtml).join('');
      const isPdfTemplateMode =
        w.pdfLayout?.type === 'pdf_template' && !!w.pdfLayout?.templateFile;
      let pdfTemplateHeaderHtml = '';
      if (isPdfTemplateMode) {
        pdfTemplateHeaderHtml = `
          <div class="field" style="grid-column:1/-1;margin-bottom:16px;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;padding:8px 12px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:6px;">
              <div>
                <strong style="color:#0369a1;">📄 紙本表單填寫區</strong>
                <span class="muted" style="font-size:0.85rem;margin-left:6px;">請直接在下方原紙本底圖的框線中輸入或勾選</span>
              </div>
              <span class="tag info" style="font-size:0.8rem;">原樣套印版面</span>
            </div>
            <div id="pdf-interactive-canvas-viewer" style="background:#fff;border:1px solid #cbd5e1;border-radius:8px;box-shadow:0 2px 4px rgba(0,0,0,0.04);overflow:hidden;"></div>
          </div>
        `;
      }
      // 不另開分段標題：標籤與選項同一列／同一區塊橫向顯示
      formFieldsBox.classList.toggle('form-fields-ot', otMode);
      formFieldsBox.innerHTML =
        pdfTemplateHeaderHtml +
        fields
          .map((f) =>
            renderDynamicFieldHtml(f, draftFormDefaults || {}, {
              enableRich: !plainTextMode,
              compactTextarea: otMode,
              compactHints: otMode,
            })
          )
          .join('') +
        deptHeadHtml +
        cosignHtml +
        usersPickHtml;
      bindDateTimeFields(formFieldsBox);
      if (isPdfTemplateMode && window.PdfFormDesigner) {
        const viewerHost = formFieldsBox.querySelector('#pdf-interactive-canvas-viewer');
        if (viewerHost) {
          window.PdfFormDesigner.renderPdfFormViewer(viewerHost, {
            templateFile: w.pdfLayout.templateFile,
            fields: w.pdfLayout.fields || [],
            formData: draftFormDefaults || {},
            mode: 'fill',
            onFieldChange: (fieldId, val) => {
              let inp = formFieldsBox.querySelector(`[data-ff="${fieldId}"]`);
              if (inp) {
                if (inp.type === 'checkbox') {
                  inp.checked = !!val;
                } else {
                  inp.value = val;
                }
                inp.dispatchEvent(new Event('input', { bubbles: true }));
                inp.dispatchEvent(new Event('change', { bubbles: true }));
              } else {
                let hidden = formFieldsBox.querySelector(`input[name="ff_${fieldId}"]`);
                if (!hidden) {
                  hidden = document.createElement('input');
                  hidden.type = 'hidden';
                  hidden.name = `ff_${fieldId}`;
                  hidden.dataset.ff = fieldId;
                  formFieldsBox.appendChild(hidden);
                }
                hidden.value = val;
              }
            },
          });
        }
      }
      bindUsersPickChooser(formFieldsBox);
      bindAttendeePickChooser(formFieldsBox);
      bindHandlingFeeMode(formFieldsBox);
      if (typeof bindAmountCalculators === 'function') bindAmountCalculators(formFieldsBox);
      bindWelfareLedger(formFieldsBox);
      bindFollowupTable(formFieldsBox);
      layoutWelfarePeriodRow(formFieldsBox);
      bindWelfarePeriodFields(formFieldsBox);
      if (
        /福利金/.test(String(w.name || '')) &&
        !formFieldsBox.querySelector('[data-ff="period_roc_year"]')
      ) {
        const y = draftFormDefaults.period_roc_year || welfareCurrentRocYear();
        formFieldsBox.insertAdjacentHTML(
          'beforeend',
          `<input type="hidden" name="ff_period_roc_year" data-ff="period_roc_year" value="${esc(String(y))}" />`
        );
      }
      bindVoidTargetPicker(formFieldsBox, preview, w);
      // 草稿預填：bind 後再同步一次富文字表面（textarea 已有 initial）
      syncRichEditorSurfacesFromTextareas(formFieldsBox);
      // 請假、電腦異常報修不綁定富文字／自繪
      if (!plainTextMode) {
        if (typeof RichEditor !== 'undefined') {
          RichEditor.bindAll(formFieldsBox);
        } else {
          bindFormTableEditors(formFieldsBox);
        }
      }
      // 請購：支付方式切換時，更新支付說明提示
      const payMethodSel = formFieldsBox.querySelector('[data-ff="payment_method"]');
      const payNoteInp = formFieldsBox.querySelector('[data-ff="payment_note"]');
      if (payMethodSel && payNoteInp) {
        const payNoteField = payNoteInp.closest('.field');
        const payNoteLabel = payNoteField?.querySelector('label');
        const syncPayNoteHint = () => {
          const m = payMethodSel.value || '';
          if (m === '期票') {
            payNoteInp.placeholder = '請註明期票到期日（例如：115/08/31）';
            if (payNoteLabel) {
              payNoteLabel.childNodes[0].textContent = '期票到期日';
            }
            payNoteField?.classList.remove('hidden');
          } else if (m === '其他') {
            payNoteInp.placeholder = '請說明其他支付方式';
            if (payNoteLabel) {
              payNoteLabel.childNodes[0].textContent = '其他支付說明';
            }
            payNoteField?.classList.remove('hidden');
          } else if (m === '現金') {
            payNoteInp.placeholder = '現金支付可不填';
            if (payNoteLabel) {
              payNoteLabel.childNodes[0].textContent = '支付說明（選填）';
            }
          } else {
            payNoteInp.placeholder = '選「期票」請填到期日；選「其他」請說明';
            if (payNoteLabel) {
              payNoteLabel.childNodes[0].textContent =
                '支付說明（期票到期日／其他說明）';
            }
          }
        };
        payMethodSel.addEventListener('change', syncPayNoteHint);
        syncPayNoteHint();
      }
      const curSel = formFieldsBox.querySelector('[data-ff="currency"]');
      const amtInp = formFieldsBox.querySelector('[data-amount-fx="1"]');
      if (curSel && amtInp) {
        const hint = formFieldsBox.querySelector('[data-amount-fx-hint]');
        const syncAmtStep = () => {
          const foreign = isForeignCurrency(curSel.value);
          amtInp.step = foreign ? '0.0001' : '1';
          amtInp.placeholder = foreign
            ? '外幣可至小數 4 位，例如 1234.5678'
            : '請輸入金額（配合上方幣別）';
          if (hint) {
            hint.style.display = foreign ? '' : 'none';
          }
        };
        curSel.addEventListener('change', syncAmtStep);
        syncAmtStep();
      }
      // 請假：起始／結束變更時試算天數＋小時（依假別最小單位）
      const startDate = formFieldsBox.querySelector('[data-ff-date="start_date"]');
      const startTime = formFieldsBox.querySelector('[data-ff-time="start_date"]');
      const endDate = formFieldsBox.querySelector('[data-ff-date="end_date"]');
      const endTime = formFieldsBox.querySelector('[data-ff-time="end_date"]');
      const daysInp = formFieldsBox.querySelector('[data-ff="days"]');
      const hoursInp = formFieldsBox.querySelector('[data-ff="hours"]');
      const leaveTypeSel = formFieldsBox.querySelector('[data-ff="leave_type"]');
      // 試算說明列
      let leaveHint = formFieldsBox.querySelector('#leave-days-hint');
      const hintHost = hoursInp?.parentElement || daysInp?.parentElement;
      if (leaveMode && hintHost && !leaveHint) {
        leaveHint = document.createElement('div');
        leaveHint.id = 'leave-days-hint';
        leaveHint.className = 'muted';
        leaveHint.style.cssText = 'font-size:0.82rem;margin-top:4px;line-height:1.4';
        leaveHint.textContent =
          '試算：全日＝1 日／7.5 小時；事假不自動換算天數與小時。最小單位：病假／公假／公傷／補休＝0.5 小時；特休＝0.5 日；產假／喪假／曠職＝1 日';
        hintHost.appendChild(leaveHint);
      }
      const syncLeaveFieldSteps = () => {
        if (!leaveMode) return;
        const lt = leaveTypeSel?.value || '';
        const rule = getLeaveMinUnitClient(lt);
        if (daysInp) {
          daysInp.step = rule.unit === 'day' ? String(rule.step) : 'any';
          daysInp.min = '0';
          if (rule.noConvert || rule.id === 'personal') {
            daysInp.placeholder = '自行填寫（不由小時換算）';
          } else if (rule.unit === 'day' && rule.step === 1) {
            daysInp.placeholder = '整日（最小 1 日）';
          } else if (rule.unit === 'day') {
            daysInp.placeholder = '最小 0.5 日（全日＝1）';
          } else {
            daysInp.placeholder = '由小時換算（最小 0.5 小時）';
          }
        }
        if (hoursInp) {
          const hoursWrap = hoursInp.closest('.field');
          // 特休：隱藏小時欄（以日為準，不換算小時）
          if (rule.id === 'special') {
            if (hoursWrap) hoursWrap.classList.add('hidden');
            hoursInp.value = '';
            hoursInp.required = false;
          } else {
            if (hoursWrap) hoursWrap.classList.remove('hidden');
            hoursInp.step = rule.unit === 'hour' ? String(rule.step) : 'any';
            hoursInp.min = '0';
            if (rule.noConvert || rule.id === 'personal') {
              hoursInp.placeholder = '自行填寫（不換算天數）';
            } else if (rule.unit === 'hour') {
              hoursInp.placeholder = '最小 0.5 小時（全日＝7.5）';
            } else if (rule.step === 1) {
              hoursInp.placeholder = '整日假＝天數×7.5 小時';
            } else {
              hoursInp.placeholder = '依起迄自動試算';
            }
          }
        }
        if (leaveHint && !startDate?.value) {
          leaveHint.textContent = leaveUnitHintText(lt);
        }
      };
      const maybeFillDays = () => {
        if (!startDate?.value || !endDate?.value) {
          syncLeaveFieldSteps();
          return;
        }
        syncDateTimeHidden(formFieldsBox, 'start_date');
        syncDateTimeHidden(formFieldsBox, 'end_date');
        const a = formFieldsBox.querySelector('[data-ff="start_date"]')?.value;
        const b = formFieldsBox.querySelector('[data-ff="end_date"]')?.value;
        if (!a || !b) return;
        const leaveType = leaveTypeSel?.value || '';
        let rawDays = 0;
        let rawHours = 0;
        if (typeof TwCalendar === 'undefined' || !TwCalendar.calcLeaveDays) {
          const t0 = new Date(a.replace(' ', 'T')).getTime();
          const t1 = new Date(b.replace(' ', 'T')).getTime();
          if (Number.isNaN(t0) || Number.isNaN(t1) || t1 < t0) return;
          const sameDay = a.slice(0, 10) === b.slice(0, 10);
          const st = a.slice(11, 16);
          const et = b.slice(11, 16);
          let h = Math.max(0, (t1 - t0) / 3600000);
          h = Math.round(h * 2) / 2;
          if (h > 0 && h < 0.5) h = 0.5;
          let d = 0;
          if (sameDay && st === '09:00' && et === '12:30') d = 0.5;
          else if (sameDay && st >= '13:30' && et === '17:30') d = 0.5;
          else if (sameDay && st === '09:00' && et === '17:30') {
            d = 1;
            h = 7.5;
          }
          rawDays = d;
          rawHours = h;
        } else {
          const result = TwCalendar.calcLeaveDays(a, b);
          rawDays = result.days > 0 ? result.days : 0;
          rawHours = result.hours > 0 ? result.hours : 0;
        }
        const aligned = applyLeaveMinUnitClient(leaveType, rawDays, rawHours);
        if (daysInp) daysInp.value = String(aligned.days);
        if (hoursInp) {
          if (aligned.rule?.id === 'special') {
            hoursInp.value = '';
          } else {
            hoursInp.value = String(aligned.hours);
          }
        }
        if (leaveHint) {
          const isSpecial = aligned.rule?.id === 'special';
          const ruleText = isSpecial
            ? '特休假以「日」為單位'
            : aligned.rule?.noConvert || aligned.rule?.id === 'personal'
              ? '事假不強制換算'
              : leaveUnitHintText(leaveType);

          const result = typeof TwCalendar !== 'undefined' && TwCalendar.calcLeaveDays ? TwCalendar.calcLeaveDays(a, b) : null;
          const skipWeekendCount = (result?.skippedWeekends || []).length;
          const skipHolidayCount = (result?.skippedHolidays || []).length;

          let tagsHtml = `
            <span class="leave-breakdown-tag lunch">☕ 自動扣除午休 12:30~13:30</span>
            <span class="leave-breakdown-tag">⏱️ 實際請假 ${aligned.hours} 小時</span>
          `;
          if (skipWeekendCount > 0) {
            tagsHtml += `<span class="leave-breakdown-tag holiday">🏖️ 排除例假日 ${skipWeekendCount} 天</span>`;
          }
          if (skipHolidayCount > 0) {
            tagsHtml += `<span class="leave-breakdown-tag holiday">🎌 排除國定假日 ${skipHolidayCount} 天</span>`;
          }

          leaveHint.innerHTML = `
            <div class="leave-breakdown-card">
              <div class="leave-breakdown-title">
                <span>🗓️ 請假試算：<strong>${aligned.days} 天</strong>${!isSpecial ? `（共 <strong>${aligned.hours} 小時</strong>）` : ''}</span>
                <span class="muted" style="font-size:0.8rem;font-weight:normal;margin-left:auto">【${esc(ruleText)}】</span>
              </div>
              <div class="leave-breakdown-tags">${tagsHtml}</div>
            </div>
          `;
        }
        syncLeaveFieldSteps();
      };
      if (leaveMode) {
        [startDate, startTime, endDate, endTime].forEach((el) => {
          if (el) el.addEventListener('change', maybeFillDays);
        });
        if (leaveTypeSel) {
          leaveTypeSel.addEventListener('change', () => {
            // 切換假別：若已有起迄則重算；否則只更新提示與 step
            if (startDate?.value && endDate?.value) maybeFillDays();
            else syncLeaveFieldSteps();
          });
        }
        syncLeaveFieldSteps();
      }
      // 延長工時：起迄 → 申請時數自動換算
      if (
        formFieldsBox.querySelector('[data-ff-date="ot_start"]') ||
        formFieldsBox.querySelector('[data-ff-time="ot_start"]')
      ) {
        bindHoursAutoCalc(formFieldsBox, {
          startId: 'ot_start',
          endId: 'ot_end',
          hoursId: 'hours',
          hintId: 'ot-hours-hint',
          hintText:
            '申請時數依延長工時開始／結束自動換算（00:00～24:00 全日，最小 0.5 小時）',
        });
      }
      // 手動修改小時／天數時對齊單位（請假依假別；其餘 0.5）
      formFieldsBox.querySelectorAll('[data-half-step]').forEach((inp) => {
        if (inp.readOnly) return;
        const snap = () => {
          if (inp.value === '' || inp.value == null) return;
          const ff = inp.getAttribute('data-ff') || '';
          if (leaveMode && (ff === 'days' || ff === 'hours')) {
            const lt = leaveTypeSel?.value || '';
            const d =
              ff === 'days'
                ? inp.value
                : formFieldsBox.querySelector('[data-ff="days"]')?.value;
            const h =
              ff === 'hours'
                ? inp.value
                : formFieldsBox.querySelector('[data-ff="hours"]')?.value;
            const aligned = applyLeaveMinUnitClient(lt, d, h);
            const daysEl = formFieldsBox.querySelector('[data-ff="days"]');
            const hoursEl = formFieldsBox.querySelector('[data-ff="hours"]');
            if (daysEl) daysEl.value = String(aligned.days);
            if (hoursEl) hoursEl.value = String(aligned.hours);
            return;
          }
          inp.value = snapHalfUnit(inp.value);
        };
        inp.addEventListener('change', snap);
        inp.addEventListener('blur', snap);
      });
    } else {
      formArea.classList.add('hidden');
      formFieldsBox.innerHTML = '';
    }
  };

  sel.onchange = refreshWorkflowUi;
  // 切換「本人／代申請」時更新預覽標示
  $('#leave-proxy-select')?.addEventListener('change', () => {
    if (sel.value) refreshWorkflowUi();
  });

  /** 組裝申請 FormData（asDraft 時略過部分前端必填檢查） */
  async function buildRequestFormData(formEl, { asDraft }) {
    if (!asDraft) {
      const pickErr = validateUsersPickRequired(formEl);
      if (pickErr) throw new Error(pickErr);
    }
    const fd = new FormData(formEl);
    const fileInput = $('#req-attachments');
    const extra = fileInput?.files ? [...fileInput.files] : [];
    const files = [...pendingLocalFiles];
    for (const f of extra) {
      if (!files.some((x) => x.name === f.name && x.size === f.size && x.lastModified === f.lastModified)) {
        files.push(f);
      }
    }
    if (draftAttachments.length + files.length + pendingLinkedRequests.length > 20) {
      throw new Error('附件最多 20 個');
    }

    const w = workflows.find((x) => x.id === Number(fd.get('workflow_id')));
    if (!w) throw new Error('請選擇簽核流程');

    const proxyFor = formEl.querySelector('#leave-proxy-select')?.value;
    if (proxyFor && !isLeaveWorkflow(w)) {
      throw new Error('代申請僅支援請假流程');
    }

    let title = String(fd.get('title') || '').trim();
    if (!showTitleField(w)) {
      title = buildAutoTitle(w, formEl) || (asDraft ? `草稿 · ${w.name || '申請'}` : '');
    } else if (asDraft && !title) {
      title = `草稿 · ${w.name || '申請'}`;
    } else if (isExpenseWorkflow(w) && title && !/^草稿\s*·/.test(title)) {
      const wfLabel = String(w.name || '費用報支').trim() || '費用報支';
      if (title !== wfLabel && !title.startsWith(`${wfLabel} ·`) && !/^費用報支(\s*·|$)/.test(title)) {
        title = `${wfLabel} · ${title}`.slice(0, 200);
      }
    }
    if (!asDraft && !title) {
      throw new Error(showTitleField(w) ? '請填寫主旨' : '無法產生主旨，請檢查表單');
    }

    const body = new FormData();
    body.append('workflow_id', String(fd.get('workflow_id')));
    body.append('title', title || `草稿 · ${w.name || '申請'}`);
    body.append('content', '');
    body.append('form_data', JSON.stringify(collectFormData(formEl)));
    const notifyOn = !!formEl.querySelector('#notify-email-cb')?.checked;
    const nApproved = !!formEl.querySelector('#notify-approved-cb')?.checked;
    const nRejected = !!formEl.querySelector('#notify-rejected-cb')?.checked;
    const nStep = !!formEl.querySelector('#notify-step-cb')?.checked;
    const anyEvent = nApproved || nRejected || nStep;
    body.append('notify_email', notifyOn && anyEvent ? '1' : '0');
    body.append(
      'notify_prefs',
      JSON.stringify({
        enabled: notifyOn && anyEvent,
        approved: notifyOn && nApproved,
        rejected: notifyOn && nRejected,
        step: notifyOn && nStep,
        submitted: notifyOn && anyEvent,
        cancelled: notifyOn && anyEvent,
      })
    );
    if (asDraft) {
      body.append('as_draft', '1');
    } else if (editingDraftId) {
      body.append('submit', '1');
      body.append('as_draft', '0');
    }
    // 代申請請假：被代理人 id（僅請假流程且非本人時；後端再驗證授權）
    if (proxyFor && isLeaveWorkflow(w)) {
      body.append('proxy_for', String(proxyFor));
      body.append('on_behalf_of_user_id', String(proxyFor));
    }
    files.forEach((f) => body.append('attachments', f));
    if (pendingLinkedRequests.length) {
      body.append(
        'linked_request_ids',
        JSON.stringify(pendingLinkedRequests.map((x) => x.id))
      );
    }
    return body;
  }

  $('#btn-save-draft')?.addEventListener('click', async () => {
    const formEl = $('#req-form');
    if (!formEl) return;
    const btn = $('#btn-save-draft');
    if (btn) btn.disabled = true;
    try {
      const body = await buildRequestFormData(formEl, { asDraft: true });
      let data;
      if (editingDraftId) {
        data = await api(`/api/requests/${editingDraftId}`, {
          method: 'PUT',
          body,
        });
      } else {
        data = await api('/api/requests', { method: 'POST', body });
        if (data.request?.id) editingDraftId = data.request.id;
      }
      setDraftHint(`草稿 #${editingDraftId} 已儲存`);
      toast(data.message || '草稿已儲存', 'success');
      // 清空附件 input（已上傳的在伺服器；避免重複上傳同檔）
      const fileInput = $('#req-attachments');
      if (fileInput) fileInput.value = '';
      pendingLocalFiles = [];
      pendingLinkedRequests = [];
      // 同步顯示伺服器上已有附件
      const req = data.request || data;
      if (Array.isArray(req?.attachments)) {
        draftAttachments = req.attachments;
      } else if (editingDraftId) {
        try {
          const fresh = await api(`/api/requests/${editingDraftId}`);
          draftAttachments = fresh.request?.attachments || fresh.attachments || [];
        } catch {
          /* keep previous list */
        }
      }
      renderDraftAttachmentsUi();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  $('#req-form').onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('#btn-submit-request');
    if (btn) btn.disabled = true;
    try {
      const body = await buildRequestFormData(e.target, { asDraft: false });
      let data;
      if (editingDraftId) {
        data = await api(`/api/requests/${editingDraftId}`, {
          method: 'PUT',
          body,
        });
      } else {
        data = await api('/api/requests', { method: 'POST', body });
      }
      toast(data.message || '申請已送出', 'success');
      navigate('detail', { id: data.request.id });
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  };

  // 載入既有草稿
  if (editingDraftId) {
    (async () => {
      try {
        const data = await api(`/api/requests/${editingDraftId}`);
        const req = data.request || data;
        if (!req || (req.status !== 'draft' && req.status !== 'returned')) {
          toast('此單據非草稿或退回狀態，無法在此編輯', 'error');
          editingDraftId = 0;
          setDraftHint('');
          return;
        }
        const canEditThisDraft =
          Number(req.requester_id) === Number(state.user?.id) ||
          Number(req.submitted_by) === Number(state.user?.id) ||
          isAdmin();
        if (!canEditThisDraft) {
          toast('無權編輯此草稿', 'error');
          editingDraftId = 0;
          return;
        }
        // 代申請草稿：還原被代理人
        if (
          req.submitted_by &&
          Number(req.submitted_by) === Number(state.user?.id) &&
          Number(req.requester_id) !== Number(state.user?.id)
        ) {
          draftProxyForId = Number(req.requester_id) || 0;
        } else {
          draftProxyForId = 0;
        }
        // 先帶入草稿預設再渲染（事由等富文字才能在 bind 時就有內容）
        draftFormDefaults =
          req.form_data && typeof req.form_data === 'object' ? { ...req.form_data } : {};
        if (sel) {
          sel.value = String(req.workflow_id || '');
          refreshWorkflowUi();
          fillLeaveProxySelect();
        }
        const populateFormFields = (formEl, formData, title, opts = {}) => {
          if (!formEl) return;
          const titleInp = formEl.querySelector('[name=title]');
          if (titleInp && title) {
            if (opts.isClone) {
              const cleanTitle = String(title)
                .replace(/^草稿\s*·\s*/, '')
                .replace(/^(費用報支|費用申請)\s*·\s*/, '')
                .trim();
              titleInp.value = cleanTitle.startsWith('[複製]') ? cleanTitle : `[複製] ${cleanTitle}`;
            } else if (!String(title).startsWith('草稿')) {
              titleInp.value = String(title)
                .replace(/^(費用報支|費用申請)\s*·\s*/, '')
                .trim();
            } else {
              titleInp.value = String(title)
                .replace(/^草稿\s*·\s*/, '')
                .replace(/^(費用報支|費用申請)\s*·\s*/, '')
                .trim();
            }
          }
          // 動態欄位（含 datetime：須同時填回 date／time 可見欄，不可只寫 hidden）
          const fillDateTimeField = (fid, val) => {
            const dEl = formEl.querySelector(`[data-ff-date="${fid}"]`);
            const tEl = formEl.querySelector(`[data-ff-time="${fid}"]`);
            const hidden = formEl.querySelector(
              `input[data-ff="${fid}"][data-type="datetime"]`
            );
            if (!dEl && !tEl && !hidden) return false;
            const s = String(val ?? '').trim();
            if (!s) {
              if (dEl) dEl.value = '';
              if (tEl) tEl.value = tEl.getAttribute('data-default-time') || '';
              if (hidden) hidden.value = '';
              return true;
            }
            const m = s.match(
              /^(\d{4}-\d{2}-\d{2})[ T]?(\d{2}:\d{2})(?::\d{2})?/
            );
            if (m) {
              if (dEl) dEl.value = m[1];
              if (tEl && m[2]) {
                const opt = [...(tEl.options || [])].find(
                  (o) => o.value === m[2]
                );
                tEl.value = opt ? m[2] : m[2];
              }
              if (hidden) {
                hidden.value = `${m[1]}T${m[2] || tEl?.value || '00:00'}`;
              }
            } else if (hidden) {
              hidden.value = s;
            }
            return true;
          };
          Object.keys(formData || {}).forEach((fid) => {
            if (fid.includes('__')) return;
            const val = formData[fid];
            if (fillDateTimeField(fid, val)) return;
            if (
              /^users_pick_\d+$/.test(fid) ||
              /^cosign_\d+$/.test(fid) ||
              fid === 'attendee_ids'
            ) {
              const type = /^cosign_/.test(fid)
                ? 'cosign_pick'
                : fid === 'attendee_ids'
                  ? 'attendee_pick'
                  : 'users_pick';
              let ids = [];
              if (val === 'all' && fid !== 'attendee_ids') {
                formEl
                  .querySelectorAll(`input[data-type="${type}"][data-ff="${fid}"]`)
                  .forEach((cb) => {
                    cb.checked = true;
                  });
                return;
              }
              if (val === 'skip' || val === '' || val == null) {
                formEl
                  .querySelectorAll(`input[data-type="${type}"][data-ff="${fid}"]`)
                  .forEach((cb) => {
                    cb.checked = false;
                  });
                return;
              }
              if (Array.isArray(val)) ids = val.map(Number);
              else {
                ids = String(val)
                  .split(/[,，\s]+/)
                  .map(Number)
                  .filter((n) => n > 0);
              }
              const idSet = new Set(ids);
              formEl
                .querySelectorAll(`input[data-type="${type}"][data-ff="${fid}"]`)
                .forEach((cb) => {
                  cb.checked = idSet.has(Number(cb.value));
                });
              return;
            }
            const el = formEl.querySelector(`[data-ff="${fid}"]`);
            if (!el) return;
            if (
              el.type === 'checkbox' &&
              el.dataset.type !== 'users_pick' &&
              el.dataset.type !== 'attendee_pick' &&
              el.dataset.type !== 'cosign_pick'
            ) {
              el.checked = !!val;
            } else if (
              el.tagName === 'SELECT' ||
              el.tagName === 'INPUT' ||
              el.tagName === 'TEXTAREA'
            ) {
              el.value = val == null ? '' : String(val);
            }
          });
          // 再同步一次 hidden（與 collect 格式一致）
          formEl.querySelectorAll('[data-datetime-field]').forEach((row) => {
            const id = row.getAttribute('data-datetime-field');
            if (id) syncDateTimeHidden(formEl, id);
          });
          // 手續費內扣／外加勾選同步
          bindHandlingFeeMode(formEl);
          if (typeof bindAmountCalculators === 'function') bindAmountCalculators(formEl);
          formEl.querySelectorAll('[data-welfare-table]').forEach((wrap) => {
            hydrateWelfareLedger(wrap);
          });
          bindWelfareLedger(formEl);
          bindFollowupTable(formEl);
          bindAttendeePickChooser(formEl);
          layoutWelfarePeriodRow(formEl);
          bindWelfarePeriodFields(formEl);
          // 關鍵：富文字事由等 — 把 textarea 值推回編輯表面
          syncRichEditorSurfacesFromTextareas(formEl);
          // 觸發請假天數重算提示（若有起迄）
          formEl
            .querySelector('[data-ff-date="start_date"]')
            ?.dispatchEvent(new Event('change', { bubbles: true }));
        };

        // 等待 DOM 欄位
        setTimeout(() => {
          const formEl = $('#req-form');
          populateFormFields(formEl, req.form_data, req.title, { isClone: false });
          // 顯示已上傳附件（file input 無法回填既有檔，改以列表呈現）
          draftAttachments = Array.isArray(req.attachments) ? req.attachments : [];
          renderDraftAttachmentsUi();
          const isRet = req.status === 'returned';
          setDraftHint(
            isRet
              ? `⚠️ 編輯退回修改單據 #${editingDraftId}（修改後送出重新簽核）${
                  draftAttachments.length ? ` · 附件 ${draftAttachments.length} 個` : ''
                }`
              : `編輯草稿 #${editingDraftId}${
                  draftAttachments.length ? ` · 附件 ${draftAttachments.length} 個` : ''
                }`
          );
          toast(
            isRet
              ? '已載入退回修改單據，請修改後送出重新簽核'
              : draftAttachments.length
                ? `已載入草稿（含 ${draftAttachments.length} 個附件）`
                : '已載入草稿，可繼續填寫後送出或再存草稿',
            'success'
          );
          showFormView(req.workflow_id);
        }, 120);
      } catch (e) {
        toast(e.message || '載入草稿失敗', 'error');
        editingDraftId = 0;
      }
    })();
  }

  // 載入被複製單據（建立新申請）
  if (cloneFromId) {
    (async () => {
      try {
        const data = await api(`/api/requests/${cloneFromId}`);
        const req = data.request || data;
        if (!req) {
          toast('找不到欲複製的單據', 'error');
          return;
        }
        draftFormDefaults =
          req.form_data && typeof req.form_data === 'object' ? { ...req.form_data } : {};
        if (sel) {
          sel.value = String(req.workflow_id || '');
          showFormView(sel.value);
          refreshWorkflowUi();
          fillLeaveProxySelect();
        }
        setTimeout(() => {
          const formEl = $('#req-form');
          if (typeof populateFormFields === 'function') {
            populateFormFields(formEl, req.form_data, req.title, { isClone: true });
          } else {
            // 後備：若在非同步內需調用基本欄位填充
            const titleInp = formEl?.querySelector('[name=title]');
            if (titleInp && req.title) {
              const orig = String(req.title).trim();
              titleInp.value = orig.startsWith('[複製]') ? orig : `[複製] ${orig}`;
            }
          }
          draftAttachments = [];
          renderDraftAttachmentsUi();
          const banner = $('#clone-banner');
          if (banner) {
            banner.innerHTML = `<span>📑</span><div>此申請單內容複製自<strong>「單號 #${req.id} ${esc(req.title || '')}」</strong>。請確認並修改各欄位資料（附件未複製，請重新上傳），確認無誤即可送出。</div>`;
            banner.classList.remove('hidden');
          }
          setDraftHint(`📑 複製自單號 #${req.id}（${req.title || ''}），送出將建立新申請`);
          toast(`已複製單號 #${req.id} 內容，請確認並更新資料後送出`, 'info');
        }, 120);
      } catch (err) {
        toast(`複製單據失敗：${err.message}`, 'error');
      }
    })();
  }

  // ---------- 表單導航中心與填寫模式連動 ----------
  const catalogCard = $('#form-catalog-card');
  const formCard = $('#req-form-card');
  let currentCategoryFilter = '全部';

  function updateNavBanner(wfId) {
    const w = workflows.find((x) => x.id === Number(wfId));
    if (w) {
      const tag = $('#current-wf-cat-tag');
      const nameEl = $('#current-wf-name-text');
      if (tag) {
        tag.textContent = w.category || '一般簽呈';
        tag.className = `field-type-tag ${getCategoryClass(w.category)}`;
      }
      if (nameEl) nameEl.textContent = w.name;
    }
  }

  function filterCards() {
    const q = ($('#catalog-search-inp')?.value || '').trim().toLowerCase();
    const cards = body.querySelectorAll('.catalog-card');
    let visibleCount = 0;
    cards.forEach((c) => {
      const cat = c.dataset.category || '';
      const text = c.dataset.searchText || '';
      const matchCat = currentCategoryFilter === '全部' || cat === currentCategoryFilter;
      const matchSearch = !q || text.includes(q);
      const show = matchCat && matchSearch;
      c.classList.toggle('hidden', !show);
      if (show) visibleCount++;
    });
    const emptyEl = $('#catalog-no-results');
    if (emptyEl) {
      emptyEl.classList.toggle('hidden', visibleCount > 0);
    }
    const clearBtn = $('#catalog-search-clear');
    if (clearBtn) {
      clearBtn.classList.toggle('hidden', !q);
    }
  }

  $('#catalog-search-inp')?.addEventListener('input', filterCards);
  $('#catalog-search-clear')?.addEventListener('click', () => {
    const inp = $('#catalog-search-inp');
    if (inp) {
      inp.value = '';
      inp.focus();
      filterCards();
    }
  });

  body.querySelectorAll('.catalog-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      body.querySelectorAll('.catalog-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      currentCategoryFilter = tab.dataset.cat || '全部';
      filterCards();
    });
  });

  function showCatalogView() {
    catalogCard?.classList.remove('hidden');
    formCard?.classList.add('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function showFormView(wfId) {
    catalogCard?.classList.add('hidden');
    formCard?.classList.remove('hidden');
    if (wfId && sel && String(sel.value) !== String(wfId)) {
      sel.value = String(wfId);
      refreshWorkflowUi();
    }
    updateNavBanner(sel?.value || wfId);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  body.querySelectorAll('.catalog-card').forEach((card) => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-toggle-fav]')) return;
      const id = card.dataset.wfId;
      if (!id) return;
      showFormView(id);
    });
  });

  body.querySelectorAll('[data-toggle-fav]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const wfId = Number(btn.dataset.toggleFav);
      const w = workflows.find((x) => x.id === wfId);
      let curFavs = getFavWorkflowIds(workflows);
      const exists = curFavs.includes(wfId);
      if (exists) {
        curFavs = curFavs.filter((id) => id !== wfId);
        btn.classList.remove('active');
        btn.textContent = '☆';
        btn.title = '加入常用表單';
        toast(`已從常用表單移除「${w ? w.name : ''}」`, 'info');
      } else {
        curFavs.push(wfId);
        btn.classList.add('active');
        btn.textContent = '★';
        btn.title = '已在常用表單（點擊取消）';
        toast(`已將「${w ? w.name : ''}」加入常用表單`, 'success');
      }
      saveFavWorkflowIds(curFavs);
    });
  });

  $('#btn-back-to-catalog')?.addEventListener('click', () => {
    showCatalogView();
  });

  sel?.addEventListener('change', () => {
    updateNavBanner(sel.value);
  });

  // 初始進入判斷：若為編輯草稿或複製單據或帶有指定流程參數，直接顯示表單填寫；否則預設顯示表單中心
  const initialWfId = state.pageParams?.workflowId || state.pageParams?.wfId;
  if (editingDraftId || cloneFromId) {
    showFormView(sel?.value);
  } else if (initialWfId) {
    showFormView(initialWfId);
  } else {
    showCatalogView();
  }
}

async function renderNewRequest(body) {
  await loadUsers();
  const workflows = await loadWorkflows(false);
  if (!workflows.length) {
    body.innerHTML = emptyState({
      title: '尚無可用的簽核流程',
      desc: hasPerm('workflows')
        ? '請先建立簽核流程，才能讓同仁送出申請。'
        : '目前沒有已啟用的流程，請洽系統管理員建立或啟用。',
      actions: hasPerm('workflows')
        ? [{ label: '前往簽核流程', go: 'workflows', primary: true }]
        : [{ label: '回總覽', go: 'dashboard', outline: true }],
    });
    bindDataGo(body);
    return;
  }

  const { sortedCats, optgroupsHtml } = prepareNewRequestWorkflows(workflows);
  body.innerHTML = `
    <!-- 1. 表單導航中心（Catalog） -->
    <div class="card" id="form-catalog-card">${getNewRequestCatalogInnerHtml(workflows, sortedCats)}</div>

    <!-- 2. 表單填寫卡片（Form） -->
    <div class="card hidden" id="req-form-card">${getNewRequestFormInnerHtml(optgroupsHtml, state.user)}</div>
  `;

  initNewRequestInteractions(body, workflows);
}

if (typeof window !== 'undefined') {
  window.prepareNewRequestWorkflows = prepareNewRequestWorkflows;
  window.getNewRequestCatalogInnerHtml = getNewRequestCatalogInnerHtml;
  window.getNewRequestFormInnerHtml = getNewRequestFormInnerHtml;
  window.initNewRequestInteractions = initNewRequestInteractions;
}
