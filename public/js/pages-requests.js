/**
 * 申請／待簽／詳情頁
 * 依賴 app.js 掛到 window 的 state、$、api、esc、toast、navigate 等。
 */
async function renderRequestList(body, filter) {
  // 查詢列僅「簽核紀錄」等紀錄頁；待我簽核／我的申請不顯示、也不帶查詢參數
  const showSearch =
    filter === 'related' || filter === 'all' || filter === 'done';

  // 查詢條件（僅紀錄頁、同 filter 間保留）
  const prev =
    showSearch &&
    state.requestListQuery &&
    state.requestListQuery._filter === filter
      ? state.requestListQuery
      : {};
  const query = showSearch
    ? {
        q: prev.q || '',
        workflow: prev.workflow || '',
        status: prev.status || '',
        dateFrom: prev.dateFrom || '',
        dateTo: prev.dateTo || '',
      }
    : { q: '', workflow: '', status: '', dateFrom: '', dateTo: '' };

  const params = new URLSearchParams({ filter });
  if (showSearch) {
    if (query.q) params.set('q', query.q);
    if (query.workflow) params.set('workflow', query.workflow);
    if (query.status) params.set('status', query.status);
    if (query.dateFrom) params.set('dateFrom', query.dateFrom);
    if (query.dateTo) params.set('dateTo', query.dateTo);
  }

  const data = await api(`/api/requests?${params.toString()}`);
  const requests = data.requests || [];
  const categories = Array.isArray(data.categories) ? data.categories : [];
  // 類別下拉：後端回傳＋本頁資料
  const catSet = new Set(categories);
  for (const r of requests) {
    if (r.workflow_name) catSet.add(String(r.workflow_name));
  }
  const categoryOptions = [...catSet].sort((a, b) => a.localeCompare(b, 'zh-Hant'));

  // 我的申請：可刪除非已核准；admin 可刪任何狀態；records_delete／leave_delete 在紀錄列表可刪
  const adminMode =
    (isAdmin() || canDeleteRecordsPerm() || canDeleteLeavePerm()) &&
    (filter === 'related' || filter === 'all' || filter === 'done' || filter === 'mine');
  const allowDelete =
    filter === 'mine' || adminMode || canDeleteLeavePerm() || isAdmin();
  const anyDeletable =
    allowDelete &&
    requests.some((r) => canDeleteRequestRow(r, { adminMode }));
  const hasActiveQuery =
    showSearch &&
    !!(query.q || query.workflow || query.status || query.dateFrom || query.dateTo);
  const hint =
    filter === 'related' || filter === 'all'
      ? `<p class="muted" style="margin:0 0 12px">僅顯示與您登入帳號相關的單據（本人申請、待您簽核或您曾簽核）。${
          isAdmin() || hasPerm('records_all')
            ? '具備「查看全部」權限者可看所有人單據。'
            : ''
        }${
          isAdmin()
            ? ' <strong>系統管理員可刪除任何狀態的申請單</strong>（含已核准／駁回／簽核中／已取消）。'
            : ''
        }${
          !isAdmin() && canDeleteLeavePerm()
            ? ' 具備「刪除請假申請」者可查看並刪除<strong>所有人的請假單</strong>（含簽核進行中）。'
            : ''
        }${
          !isAdmin() && canDeleteRecordsPerm()
            ? ' 具備「刪除簽核紀錄」者可刪除尚未有簽署人核准的單據。'
            : ''
        }</p>`
      : filter === 'mine'
        ? `<p class="muted" style="margin:0 0 12px">僅顯示您本人送出的申請。${
            isAdmin()
              ? '系統管理員可刪除任何狀態的申請單。'
              : '可刪除<strong>尚未核准</strong>的單據（已核准不可刪）。'
          }</p>`
        : filter === 'pending_me'
          ? `<p class="muted" style="margin:0 0 12px">僅顯示目前待您簽核的單據。</p>`
          : '';
  const emptyByFilter = {
    pending_me: {
      title: hasActiveQuery ? '沒有符合條件的待簽核' : '目前沒有待您簽核的單據',
      desc: hasActiveQuery
        ? '請調整查詢條件後再試。'
        : '新申請送達且輪到您時會出現在此。您也可以主動提出新申請。',
      actions: hasActiveQuery
        ? [{ label: '清除條件', id: 'btn-req-clear', outline: true }]
        : [
            { label: '＋ 新增申請', go: 'new-request', primary: true },
            { label: '回總覽', go: 'dashboard', outline: true },
          ],
    },
    mine: {
      title: hasActiveQuery ? '沒有符合條件的申請' : '尚無我的申請',
      desc: hasActiveQuery
        ? '請調整查詢條件後再試。'
        : '您還沒有送出任何申請。可從「新增申請」選擇流程開始。',
      actions: hasActiveQuery
        ? [{ label: '清除條件', id: 'btn-req-clear', outline: true }]
        : [{ label: '＋ 新增申請', go: 'new-request', primary: true }],
    },
    related: {
      title: hasActiveQuery ? '沒有符合條件的紀錄' : '尚無相關簽核紀錄',
      desc: hasActiveQuery
        ? '請調整申請類別、狀態、日期或關鍵字後再查詢。'
        : '與您有關的申請、待簽或曾簽核的單據會列在這裡。',
      actions: hasActiveQuery
        ? [{ label: '清除條件', id: 'btn-req-clear', outline: true }]
        : [
            { label: '查看待簽核', go: 'inbox', outline: true },
            { label: '＋ 新增申請', go: 'new-request', primary: true },
          ],
    },
    all: {
      title: hasActiveQuery ? '沒有符合條件的紀錄' : '尚無簽核紀錄',
      desc: hasActiveQuery
        ? '請調整查詢條件後再試。'
        : '系統中尚無相關單據。',
      actions: hasActiveQuery
        ? [{ label: '清除條件', id: 'btn-req-clear', outline: true }]
        : [{ label: '＋ 新增申請', go: 'new-request', primary: true }],
    },
    done: {
      title: hasActiveQuery ? '沒有符合條件的紀錄' : '尚無已完成紀錄',
      desc: hasActiveQuery
        ? '請調整查詢條件後再試。'
        : '已核准或結案的單據會顯示於此。',
      actions: hasActiveQuery
        ? [{ label: '清除條件', id: 'btn-req-clear', outline: true }]
        : [{ label: '回總覽', go: 'dashboard', outline: true }],
    },
  };

  const statusOpts = [
    { v: '', t: '全部狀態' },
    { v: 'pending', t: '簽核中' },
    { v: 'approved', t: '已核准' },
    { v: 'rejected', t: '已駁回' },
    { v: 'cancelled', t: '已取消' },
    { v: 'draft', t: '草稿' },
  ];

  let finConfirmCardHtml = '';
  // 最終核准系統通知待確認（列表上方提示）
  let finalNotifyListBanner = '';
  if (filter === 'pending_me') {
    const fnList = (requests || []).filter((r) => r.needsFinalNotifyAck);
    if (fnList.length) {
      finalNotifyListBanner = `
        <div class="card" style="background:#eff6ff;border-color:#93c5fd;margin-bottom:14px;padding:14px">
          <h3 style="color:#1e40af;margin:0">🔔 最終核准完成通知（${fnList.length} 筆待您確認收到）</h3>
          <p style="margin:6px 0 0;font-size:0.88rem;color:#1d4ed8">
            請開啟單據後點「確認收到通知」。此為系統內通知，非 Email。
          </p>
        </div>`;
    }
  }

  if (filter === 'pending_me' && isFinanceStaffUser()) {
    try {
      const finRes = await api('/api/requests?filter=pending_finance_confirm');
      const finReqs = finRes.requests || [];
      if (finReqs.length > 0) {
        finConfirmCardHtml = `
          <div class="card" style="background:#ecfdf5;border-color:#6ee7b7;margin-bottom:16px;padding:16px">
            <div class="card-head" style="margin-bottom:8px">
              <h3 style="color:#065f46;margin:0">📊 待財務部授信額度建檔確認（${finReqs.length} 筆）</h3>
            </div>
            <p style="margin:0 0 12px;font-size:0.88rem;color:#047857">
              總經理已完成核定。請於 ERP 完成授信額度設定後，點選單據開啟詳情並點擊「確認完成額度建檔」。
            </p>
            ${requestTable(finReqs, { empty: { title: '尚無待建檔單據' } })}
          </div>`;
      }
    } catch {
      /* ignore */
    }
  }

  body.innerHTML = `
    ${finConfirmCardHtml}
    ${finalNotifyListBanner}
    <div class="card">
      ${hint}
      ${
        showSearch
          ? `<form id="req-filter-form" class="req-filter-bar" style="margin-bottom:14px">
              <div class="form-grid two" style="gap:10px">
                <div class="field" style="margin:0">
                  <label>關鍵字</label>
                  <input type="search" name="q" value="${esc(query.q)}"
                    placeholder="單號、主旨、申請人、類別…" autocomplete="off" />
                </div>
                <div class="field" style="margin:0">
                  <label>申請類別</label>
                  <select name="workflow">
                    <option value="">全部類別</option>
                    ${categoryOptions
                      .map(
                        (c) =>
                          `<option value="${esc(c)}" ${
                            query.workflow === c ? 'selected' : ''
                          }>${esc(c)}</option>`
                      )
                      .join('')}
                  </select>
                </div>
                <div class="field" style="margin:0">
                  <label>狀態</label>
                  <select name="status">
                    ${statusOpts
                      .map(
                        (o) =>
                          `<option value="${esc(o.v)}" ${
                            query.status === o.v ? 'selected' : ''
                          }>${esc(o.t)}</option>`
                      )
                      .join('')}
                  </select>
                </div>
                <div class="field" style="margin:0">
                  <label>更新日期（起～迄）</label>
                  <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                    <input type="date" name="dateFrom" value="${esc(query.dateFrom)}" style="flex:1;min-width:120px" />
                    <span class="muted">～</span>
                    <input type="date" name="dateTo" value="${esc(query.dateTo)}" style="flex:1;min-width:120px" />
                  </div>
                </div>
              </div>
              <div class="form-actions" style="margin-top:10px;flex-wrap:wrap">
                <button type="submit" class="btn primary sm">查詢</button>
                <button type="button" class="btn outline sm" id="btn-req-clear">清除條件</button>
                <span class="muted" style="font-size:0.85rem">共 <strong>${requests.length}</strong> 筆</span>
              </div>
            </form>`
          : ''
      }
      ${
        filter === 'pending_me' && requests.length > 0
          ? `<div class="form-actions" style="margin-bottom:12px;flex-wrap:wrap;align-items:center;justify-content:space-between;background:#f8fafc;padding:10px 14px;border:1px solid var(--border);border-radius:10px">
              <div style="display:flex;align-items:center;gap:10px">
                <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-weight:600">
                  <input type="checkbox" id="chk-all-batch-reqs" /> 全選本頁待簽項目
                </label>
                <span class="muted" id="batch-req-sel-count">已勾選 0 筆</span>
              </div>
              <div style="display:flex;gap:8px;align-items:center">
                <button type="button" class="btn primary sm" id="btn-batch-approve-reqs" disabled>⚡ 批次核准 (0)</button>
                <button type="button" class="btn danger sm" id="btn-batch-reject-reqs" disabled>❌ 批次駁回 (0)</button>
              </div>
            </div>`
          : ''
      }
      ${
        anyDeletable
          ? `<div class="form-actions" style="margin-bottom:12px;flex-wrap:wrap">
              <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
                <input type="checkbox" id="chk-all-reqs" /> 全選
              </label>
              <button type="button" class="btn danger sm" id="btn-bulk-del-reqs">刪除選取</button>
              <span class="muted" id="req-sel-count">已選 0 筆</span>
            </div>`
          : ''
      }
      ${requestTable(requests, {
        allowDelete,
        adminMode,
        allowBatchSelect: filter === 'pending_me' && requests.length > 0,
        empty: emptyByFilter[filter] || {
          title: '尚無資料',
          desc: '目前沒有符合條件的簽核單據。',
        },
      })}
    </div>`;
  bindDataGo(body);
  bindRequestRows(body);

  const applyQueryAndReload = (next) => {
    state.requestListQuery = { ...next, _filter: filter };
    navigate(state.page || 'records');
  };
  $('#req-filter-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    applyQueryAndReload({
      q: String(fd.get('q') || '').trim(),
      workflow: String(fd.get('workflow') || '').trim(),
      status: String(fd.get('status') || '').trim(),
      dateFrom: String(fd.get('dateFrom') || '').trim(),
      dateTo: String(fd.get('dateTo') || '').trim(),
    });
  });
  const clearBtn = (e) => {
    e?.preventDefault?.();
    state.requestListQuery = { _filter: filter };
    navigate(state.page || 'records');
  };
  $('#btn-req-clear')?.addEventListener('click', clearBtn);
  body.querySelectorAll('#btn-req-clear').forEach((b) => {
    b.onclick = clearBtn;
  });

  if (filter === 'pending_me' && requests.length > 0) {
    const updateBatchBtnState = () => {
      const selectedIds = getSelectedBatchRequestIds(body);
      const count = selectedIds.length;
      const countEl = $('#batch-req-sel-count');
      const approveBtn = $('#btn-batch-approve-reqs');
      const rejectBtn = $('#btn-batch-reject-reqs');

      if (countEl) countEl.textContent = `已勾選 ${count} 筆`;
      if (approveBtn) {
        approveBtn.disabled = count === 0;
        approveBtn.textContent = `⚡ 批次核准 (${count})`;
      }
      if (rejectBtn) {
        rejectBtn.disabled = count === 0;
        rejectBtn.textContent = `❌ 批次駁回 (${count})`;
      }
    };

    $('#chk-all-batch-reqs')?.addEventListener('change', (e) => {
      body.querySelectorAll('input[data-batch-check]').forEach((c) => {
        c.checked = e.target.checked;
      });
      updateBatchBtnState();
    });

    body.querySelectorAll('input[data-batch-check]').forEach((c) => {
      c.onchange = updateBatchBtnState;
    });

    $('#btn-batch-approve-reqs')?.addEventListener('click', () => {
      const selectedIds = getSelectedBatchRequestIds(body);
      if (!selectedIds.length) return toast('請先勾選要簽核的單據', 'error');
      openBatchApprovalModal(selectedIds, 'approve', () => renderRequestList(body, 'pending_me'));
    });

    $('#btn-batch-reject-reqs')?.addEventListener('click', () => {
      const selectedIds = getSelectedBatchRequestIds(body);
      if (!selectedIds.length) return toast('請先勾選要駁回的單據', 'error');
      openBatchApprovalModal(selectedIds, 'reject', () => renderRequestList(body, 'pending_me'));
    });
  }

  if (!anyDeletable) return;

  const updateCount = () => {
    const n = getSelectedRequestIds(body).length;
    const el = $('#req-sel-count');
    if (el) el.textContent = `已選 ${n} 筆`;
  };
  $('#chk-all-reqs')?.addEventListener('change', (e) => {
    body.querySelectorAll('input[data-req-check]').forEach((c) => {
      c.checked = e.target.checked;
    });
    updateCount();
  });
  body.querySelectorAll('input[data-req-check]').forEach((c) => {
    c.onchange = updateCount;
  });

  body.querySelectorAll('[data-del-req]').forEach((btn) => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const id = Number(btn.dataset.delReq);
      const r = requests.find((x) => x.id === id);
      if (r && !canDeleteRequestRow(r, { adminMode })) {
        toast(
          r.approver_signed || r.can_delete === false
            ? '下一位簽署人已簽核，此申請單無法刪除'
            : '此申請單不可刪除',
          'error'
        );
        return;
      }
      if (
        r?.status === 'approved' &&
        !isAdmin() &&
        !canDeleteRecordsPerm() &&
        !(isLeaveRequestRow(r) && canDeleteLeavePerm())
      ) {
        toast('已核准的申請不可刪除', 'error');
        return;
      }
      const adminWarn = isAdmin()
        ? '\n（系統管理員：將從所有人列表隱藏，檔案仍保留）'
        : '';
      if (
        !confirm(
          `確定刪除申請 #${id}${r ? `「${r.title}」` : ''}？\n將從列表隱藏；單據、附件與備份仍保留供稽核。${adminWarn}`
        )
      ) {
        return;
      }
      try {
        await api(`/api/requests/${id}`, { method: 'DELETE' });
        toast('已刪除申請', 'success');
        navigate(state.page || 'mine');
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  });

  $('#btn-bulk-del-reqs')?.addEventListener('click', async () => {
    const ids = getSelectedRequestIds(body);
    if (!ids.length) {
      toast('請先勾選要刪除的紀錄', 'error');
      return;
    }
    // 僅送出可刪者；已簽核鎖定的會被後端拒絕
    const locked = ids.filter((id) => {
      const r = requests.find((x) => x.id === id);
      return r && !canDeleteRequestRow(r, { adminMode });
    });
    if (locked.length) {
      toast(
        `有 ${locked.length} 筆已有簽署人簽核，無法刪除（將略過）`,
        'error'
      );
    }
    const okIds = ids.filter((id) => {
      const r = requests.find((x) => x.id === id);
      return !r || canDeleteRequestRow(r, { adminMode });
    });
    if (!okIds.length) {
      toast('選取的申請皆不可刪除', 'error');
      return;
    }
    if (
      !confirm(
        isAdmin()
          ? `確定刪除選取的 ${okIds.length} 筆申請？\n將永久刪除單據、歷程、附件與相關備份，無法復原。\n（系統管理員可刪除任何狀態，含已核准／駁回／簽核中／已取消）`
          : `確定刪除選取的 ${okIds.length} 筆申請？\n將永久刪除單據、歷程、附件與相關備份，無法復原。\n（一般單據：已簽署／已核准不可刪；請假單若具備「刪除請假申請」權限可刪）`
      )
    ) {
      return;
    }
    try {
      const data = await api('/api/requests/bulk-delete', {
        method: 'POST',
        body: { ids: okIds },
      });
      toast(data.message || '已批次刪除', 'success');
      navigate(state.page || 'mine');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}


function renderDeptHeadChooserHtml(step) {
  const fieldId = `dept_head_${step.order}`;
  const { deptMembers, others, myDeptLabel } = splitUsersForDeptHeadChooser();
  const opt = (u) =>
    `<option value="${u.id}">${esc(u.name)}${
      u.department ? `（${esc(u.department)}）` : ''
    }</option>`;
  let groups = '';
  if (deptMembers.length) {
    groups += `<optgroup label="同部門成員${myDeptLabel ? `（${esc(myDeptLabel)}）` : ''}">${deptMembers
      .map(opt)
      .join('')}</optgroup>`;
  }
  if (others.length) {
    groups += `<optgroup label="${deptMembers.length ? '其他人員' : '全體人員'}">${others
      .map(opt)
      .join('')}</optgroup>`;
  }
  if (!deptMembers.length && !others.length) {
    groups = `<option value="" disabled>尚無可選人員</option>`;
  }
  return `
    <div class="field" data-dept-head-chooser="${esc(fieldId)}" style="grid-column:1/-1">
      <label style="white-space:nowrap">${esc(step.name || '部門主管簽核')}
        <span class="muted" style="font-weight:400">（可指定成員或略過）</span>
      </label>
      <select name="ff_${esc(fieldId)}" data-ff="${esc(fieldId)}" data-type="dept_head">
        <option value="skip" selected>不需要經過部門主管（略過此步驟）</option>
        ${groups}
      </select>
    </div>`;
}

/**
 * 會簽人員：申請人可多位勾選，非必填（不勾＝略過）
 * 名單為全體啟用成員（排除本人）
 */
function renderCosignChooserHtml(step) {
  const fieldId = `cosign_${step.order}`;
  const me = state.user?.id;
  const all = (state.users || []).filter((u) => u.active !== 0 && u.id !== me);
  const checks = all
    .map(
      (u) => `
      <label class="member-pick-row">
        <input type="checkbox" data-ff="${esc(fieldId)}" data-type="cosign_pick"
          value="${u.id}" />
        <span>${esc(u.name)}${u.department ? `（${esc(u.department)}）` : ''}</span>
      </label>`
    )
    .join('');
  return `
    <div class="field" data-cosign-chooser="${esc(fieldId)}" style="grid-column:1/-1">
      <label style="white-space:nowrap">${esc(step.name || '會簽人員')}
        <span class="muted" style="font-weight:400">（選填・可多選・不勾則略過）</span>
      </label>
      <div class="approver-list" style="margin-top:6px;max-height:220px">
        ${
          checks ||
          '<span class="muted">尚無可選人員</span>'
        }
      </div>
    </div>`;
}

/**
 * 申請人自選簽核人（如副總）：勾選方式（可多位，至少一位）
 * 候選名單來自步驟 approverIds
 */
function renderUsersPickChooserHtml(step) {
  const fieldId = `users_pick_${step.order}`;
  const poolIds = (step.approverIds || []).map(Number).filter(Boolean);
  const me = state.user?.id;
  let candidates = (state.users || []).filter(
    (u) => u.active !== 0 && poolIds.includes(u.id) && u.id !== me
  );
  // 若 pool 在 state.users 對不到，仍顯示 id
  if (!candidates.length && poolIds.length) {
    candidates = poolIds
      .filter((id) => id !== me)
      .map((id) => ({ id, name: `使用者 #${id}`, department: '' }));
  }
  const modeHintText =
    candidates.length > 1
      ? (step.mode || 'any') === 'all'
        ? '多位需全部核准'
        : '多位任一核准即可'
      : '';
  const stepLabel = step.name || '副總經理簽核';
  const checks = candidates
    .map(
      (u) => `
      <label class="member-pick-row">
        <input type="checkbox" name="ff_${esc(fieldId)}" data-ff="${esc(fieldId)}"
          data-type="users_pick" value="${u.id}" />
        <span>${esc(u.name)}${u.department ? `（${esc(u.department)}）` : ''}</span>
      </label>`
    )
    .join('');
  return `
    <div class="field" data-users-pick-chooser="${esc(fieldId)}" style="grid-column:1/-1">
      <label style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;white-space:normal;margin-bottom:6px">
        <span style="white-space:nowrap">${esc(stepLabel)} <span style="color:#b91c1c">*</span></span>
        <span class="muted" style="font-weight:400;font-size:0.82rem;white-space:nowrap">必填・可勾選多位${modeHintText ? '・' + modeHintText : ''}</span>
        <button type="button" class="btn sm outline" data-users-pick-all="${esc(fieldId)}">全選</button>
        <button type="button" class="btn sm outline" data-users-pick-none="${esc(fieldId)}">取消全選</button>
      </label>
      <div class="approver-list" style="margin-top:0;max-height:280px">
        ${
          candidates.length
            ? checks
            : `<span class="muted">尚無可選簽核人，請聯絡管理員設定流程</span>`
        }
      </div>
    </div>`;
}

/** 綁定副總等 users_pick 全選／取消全選 */
function bindUsersPickChooser(root) {
  root.querySelectorAll('[data-users-pick-all]').forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.usersPickAll;
      root
        .querySelectorAll(`input[data-type="users_pick"][data-ff="${id}"]`)
        .forEach((cb) => {
          cb.checked = true;
        });
    };
  });
  root.querySelectorAll('[data-users-pick-none]').forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.usersPickNone;
      root
        .querySelectorAll(`input[data-type="users_pick"][data-ff="${id}"]`)
        .forEach((cb) => {
          cb.checked = false;
        });
    };
  });
}

function renderDynamicFieldHtml(f, defaults = {}, opts = {}) {
  const req = f.required ? ' *' : '';
  const reqAttr = f.required ? 'required' : '';
  const ph = f.placeholder ? esc(f.placeholder) : '';
  const name = `ff_${esc(f.id)}`;
  const defVal =
    defaults[f.id] != null && defaults[f.id] !== ''
      ? String(defaults[f.id])
      : '';
  // 請假／電腦異常報修：不使用富文字／自繪表格
  const allowRich = opts.enableRich !== false;
  if (f.type === 'textarea') {
    // 說明／事由等：Word 式富文字（顏色、字級、表格、可貼上）
    // 請假、電腦異常報修整份表單關閉（enableRich: false）
    const useRich =
      allowRich &&
      (/說明|事由|用途|內容|備註|主旨|廠商/.test(String(f.label || '')) ||
        f.id === 'subject' ||
        f.id === 'reason' ||
        f.id === 'purpose' ||
        f.id === 'desc');
    // 舊版 __table 物件轉提示（合併顯示於初始 HTML）
    let initial = defVal;
    const legacyTable = defaults[`${f.id}__table`];
    if (
      useRich &&
      legacyTable &&
      typeof legacyTable === 'object' &&
      Array.isArray(legacyTable.cells)
    ) {
      const rows = legacyTable.cells
        .map(
          (row, ri) =>
            `<tr>${(row || [])
              .map((c) => {
                const tag = ri === 0 ? 'th' : 'td';
                return `<${tag} style="border:1px solid #94a3b8;padding:6px 8px">${esc(c)}</${tag}>`;
              })
              .join('')}</tr>`
        )
        .join('');
      const tbl = `<table border="1" style="border-collapse:collapse;width:100%"><tbody>${rows}</tbody></table>`;
      if (initial && !/<table/i.test(initial)) {
        initial =
          (typeof RichEditor !== 'undefined'
            ? RichEditor.plainToHtml(initial)
            : esc(initial).replace(/\n/g, '<br>')) + tbl;
      } else if (!initial) {
        initial = tbl;
      }
    }
    // 請假等純文字：若誤存 HTML，顯示為純文字
    if (!useRich && typeof RichEditor !== 'undefined' && RichEditor.isProbablyHtml(initial)) {
      initial = RichEditor.htmlToPlain(initial);
    }
    return `<div class="field" style="grid-column:1/-1">
      <label>${esc(f.label)}${req}</label>
      <textarea name="${name}" data-ff="${esc(f.id)}" ${useRich ? 'data-rich="1"' : ''}
        ${reqAttr} placeholder="${
          useRich
            ? ph || '可輸入文字、設定顏色／字級、插入或貼上表格…'
            : ph || ''
        }"
        rows="${useRich ? 5 : 3}">${esc(initial)}</textarea>
      ${
        useRich
          ? `<div class="muted" style="font-size:0.78rem;margin-top:4px">支援粗體／顏色／字級／插入表格；可從 Word、Excel 直接貼上</div>`
          : ''
      }
    </div>`;
  }
  if (f.type === 'select') {
    const opts = (f.options || [])
      .map(
        (o) =>
          `<option value="${esc(o)}" ${defVal === String(o) ? 'selected' : ''}>${esc(o)}</option>`
      )
      .join('');
    return `<div class="field"><label>${esc(f.label)}${req}</label>
      <select name="${name}" data-ff="${esc(f.id)}" ${reqAttr}>
        <option value="">請選擇…</option>${opts}
      </select></div>`;
  }
  if (f.type === 'user') {
    const me = state.user?.id;
    const opts = (state.users || [])
      .filter((u) => u.active !== 0 && u.id !== me)
      .map(
        (u) =>
          `<option value="${u.id}" ${defVal === String(u.id) ? 'selected' : ''}>${esc(u.name)}${
            u.department ? `（${esc(u.department)}）` : ''
          }</option>`
      )
      .join('');
    return `<div class="field"><label>${esc(f.label)}${req}</label>
      <select name="${name}" data-ff="${esc(f.id)}" data-type="user" ${reqAttr}>
        <option value="">請選擇人員…</option>${opts}
      </select></div>`;
  }
  if (f.type === 'datetime') {
    // 請假：09:00～17:30；延長工時／實際工時：17:30～24:00；其餘：00:00～23:30
    const isLeaveRange = f.id === 'start_date' || f.id === 'end_date';
    const isOtRange =
      f.id === 'ot_start' ||
      f.id === 'ot_end' ||
      f.id === 'actual_start' ||
      f.id === 'actual_end' ||
      /延長工時|實際工時/.test(String(f.label || ''));
    const isEnd =
      f.id === 'end_date' ||
      f.id === 'ot_end' ||
      f.id === 'actual_end' ||
      /結束|迄/.test(String(f.label || ''));
    const tStart = isLeaveRange
      ? WORK_TIME_START
      : isOtRange
        ? OT_TIME_START
        : '00:00';
    const tEnd = isLeaveRange
      ? WORK_TIME_END
      : isOtRange
        ? OT_TIME_END
        : '23:30';
    const defaultTime = isEnd
      ? isLeaveRange
        ? WORK_TIME_END
        : isOtRange
          ? '21:00'
          : '18:00'
      : isLeaveRange
        ? WORK_TIME_START
        : isOtRange
          ? OT_TIME_START
          : '18:00';
    const parts = parseDateTimeParts('', defaultTime);
    const selTime = clampWorkTime(parts.time, defaultTime, tStart, tEnd);
    // 日期時間佔一欄（與其他短欄並排）
    return `<div class="field">
      <label>${esc(f.label)}${req}</label>
      <div class="datetime-row" data-datetime-field="${esc(f.id)}">
        <input type="date" data-ff-date="${esc(f.id)}" ${reqAttr} title="日期" />
        <select data-ff-time="${esc(f.id)}" ${reqAttr}
          title="時間 ${tStart}～${tEnd}（每 30 分鐘）"
          data-default-time="${defaultTime}">
          ${halfHourTimeOptions(selTime, { start: tStart, end: tEnd })}
        </select>
      </div>
      <input type="hidden" name="${name}" data-ff="${esc(f.id)}" data-type="datetime" value="" />
      <div class="muted" style="font-size:0.8rem;margin-top:4px">
        可選時間 ${tStart}～${tEnd}（每 30 分鐘）
      </div>
    </div>`;
  }
  if (f.type === 'checkbox') {
    return `<div class="field">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
        <input type="checkbox" name="${name}" data-ff="${esc(f.id)}" data-type="checkbox" ${reqAttr} />
        ${esc(f.label)}${req}
      </label></div>`;
  }
  const type = ['number', 'date'].includes(f.type) ? f.type : 'text';
  const valAttr = defVal !== '' ? ` value="${esc(defVal)}"` : '';
  // 天數／小時：最小單位 0.5（避免瀏覽器 step 預設為 1 導致 22.5 被拒）
  const isHalfStep =
    f.type === 'number' &&
    (f.id === 'hours' ||
      f.id === 'days' ||
      f.id === 'actual_hours' ||
      f.id === 'comp_leave_balance' ||
      f.id === 'remaining_special_leave_days' ||
      f.id === 'remaining_special_leave_hours' ||
      /小時|天數|時數/.test(String(f.label || '')));
  const halfHint = isHalfStep
    ? `<div class="muted" style="font-size:0.78rem;margin-top:4px">最小單位 0.5（例：0、0.5、1、3.5、7.5、22.5）</div>`
    : '';

  const isWide =
    /主旨|標題|地址|說明|內容|備註|事由/.test(String(f.label || '')) ||
    f.id === 'subject' ||
    f.id === 'title' ||
    f.id === 'address';
  const fieldStyle = isWide ? 'style="grid-column:1/-1"' : '';

  if (type === 'number' && isHalfStep) {
    return `<div class="field" ${fieldStyle}><label>${esc(f.label)}${req}</label>
      <input type="number" name="${name}" data-ff="${esc(f.id)}" data-half-step="1"
        step="0.5" min="0" inputmode="decimal" ${reqAttr}
        placeholder="${ph}"${valAttr} />
      ${halfHint}
    </div>`;
  }
  return `<div class="field" ${fieldStyle}><label>${esc(f.label)}${req}</label>
    <input type="${type}" name="${name}" data-ff="${esc(f.id)}" ${reqAttr}
      placeholder="${ph}"${valAttr}${type === 'number' ? ' step="any"' : ''} />
    ${halfHint}
  </div>`;
}

/** 對齊 0.5 單位（小時／天數） */
function snapHalfUnit(val) {
  const n = Number(val);
  if (!Number.isFinite(n) || n < 0) return '';
  return String(Math.round(n * 2) / 2);
}

/**
 * 請假最小計算單位（與後端 labor.getLeaveMinUnit 一致）
 * 補休／公假／公傷／病假／事假 → 0.5 小時
 * 特休 → 0.5 日
 * 產假／喪假／曠職 → 1 日
 */
const LEAVE_MIN_UNIT_BY_ID = {
  personal: { unit: 'hour', step: 0.5 },
  sick: { unit: 'hour', step: 0.5 },
  occupational: { unit: 'hour', step: 0.5 },
  official: { unit: 'hour', step: 0.5 },
  comp: { unit: 'hour', step: 0.5 },
  special: { unit: 'day', step: 0.5 },
  maternity: { unit: 'day', step: 1 },
  funeral: { unit: 'day', step: 1 },
  absence: { unit: 'day', step: 1 },
};
const WORK_DAY_HOURS_CLIENT = 7.5;

function matchLeaveTypeIdClient(typeName) {
  const t = String(typeName || '').trim();
  if (!t) return 'other';
  if (/特別休假|特休/.test(t) && !/不休假|代金/.test(t)) return 'special';
  if (/曠職/.test(t)) return 'absence';
  // 公傷須先於病假（避免「公傷病假」命中病假）
  if (/公傷/.test(t)) return 'occupational';
  if (/住院/.test(t)) return 'hospital';
  if (/普通傷病|病假/.test(t)) return 'sick';
  if (/事假/.test(t)) return 'personal';
  if (/婚假/.test(t)) return 'marriage';
  if (/祭儀/.test(t)) return 'ritual';
  if (/喪假|喪葬/.test(t)) return 'funeral';
  if (/產假|分娩/.test(t) && !/陪產|產檢/.test(t)) return 'maternity';
  if (/產檢/.test(t) && !/陪產/.test(t)) return 'prenatal';
  if (/安胎/.test(t)) return 'tocolysis';
  if (/陪產/.test(t)) return 'paternity';
  if (/生理/.test(t)) return 'menstrual';
  if (/家庭照顧|家照/.test(t)) return 'family';
  if (/公假/.test(t)) return 'official';
  if (/補休|調休/.test(t)) return 'comp';
  return 'other';
}

function getLeaveMinUnitClient(typeName) {
  const id = matchLeaveTypeIdClient(typeName);
  const base = LEAVE_MIN_UNIT_BY_ID[id] || { unit: 'day', step: 0.5 };
  const label =
    base.unit === 'hour' ? `${base.step} 小時` : `${base.step} 日`;
  return { id, unit: base.unit, step: base.step, label };
}

function snapToStepClient(n, step) {
  const x = Number(n);
  const s = Number(step);
  if (!Number.isFinite(x) || x < 0) return 0;
  if (!Number.isFinite(s) || s <= 0) return x;
  return Math.round((Math.round(x / s) * s) * 1000) / 1000;
}

/** 依假別對齊天數／小時（試算與手動修改） */
function applyLeaveMinUnitClient(leaveType, daysIn, hoursIn) {
  const rule = getLeaveMinUnitClient(leaveType);
  let days = Number(daysIn);
  let hours = Number(hoursIn);
  if (!Number.isFinite(days) || days < 0) days = 0;
  if (!Number.isFinite(hours) || hours < 0) hours = 0;

  if (rule.unit === 'hour') {
    let h = hours > 0 ? hours : days * WORK_DAY_HOURS_CLIENT;
    h = snapToStepClient(h, rule.step);
    if (h > 0 && h < rule.step) h = rule.step;
    return {
      days: Math.round((h / WORK_DAY_HOURS_CLIENT) * 1000) / 1000,
      hours: h,
      rule,
    };
  }
  let d = days > 0 ? days : hours / WORK_DAY_HOURS_CLIENT;
  d = snapToStepClient(d, rule.step);
  if (d > 0 && d < rule.step) d = rule.step;
  // 特休：只以日計，不換算／填寫小時
  if (rule.id === 'special') {
    return { days: d, hours: 0, rule };
  }
  return {
    days: d,
    hours: snapToStepClient(d * WORK_DAY_HOURS_CLIENT, 0.5),
    rule,
  };
}

function leaveUnitHintText(leaveType) {
  const rule = getLeaveMinUnitClient(leaveType);
  if (rule.id === 'special') {
    return `此假別（特休）最小單位 0.5 日，以日計算，不換算小時`;
  }
  if (rule.unit === 'hour') {
    return `此假別最小單位 ${rule.label}（以小時為準；全日＝7.5 小時）。例：0.5、1、1.5、3.5、7.5 小時`;
  }
  if (rule.step === 1) {
    return `此假別最小單位 1 日（僅能請整天，不可半日／小時）`;
  }
  return `此假別最小單位 0.5 日（例：0.5、1、1.5 日；全日＝7.5 小時）`;
}

/**
 * 解析日期時間（支援 24:00＝當日結束／次日 00:00）
 * @returns {Date|null}
 */
function parseOtDateTime(val) {
  if (!val) return null;
  const m = String(val)
    .trim()
    .replace(' ', 'T')
    .match(/^(\d{4}-\d{2}-\d{2})T?(\d{2}):(\d{2})/);
  if (!m) return null;
  const y = Number(m[1].slice(0, 4));
  const mo = Number(m[1].slice(5, 7)) - 1;
  const d = Number(m[1].slice(8, 10));
  let hh = Number(m[2]);
  let mm = Number(m[3]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  // 24:00 → 次日 00:00
  if (hh === 24 && mm === 0) {
    const dt = new Date(y, mo, d + 1, 0, 0, 0, 0);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  const dt = new Date(y, mo, d, hh, mm, 0, 0);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/**
 * 延長工時時數：結束−開始，對齊 0.5 小時
 * @returns {number|null} 無效或結束≤開始時回傳 null
 */
function calcOvertimeHours(startStr, endStr) {
  const a = parseOtDateTime(startStr);
  const b = parseOtDateTime(endStr);
  if (!a || !b) return null;
  if (b.getTime() <= a.getTime()) return null;
  let h = (b.getTime() - a.getTime()) / 3600000;
  h = Math.round(h * 2) / 2;
  if (h > 0 && h < 0.5) h = 0.5;
  return h;
}

/**
 * 綁定起迄時間 → 時數自動換算
 * @param {HTMLElement} root
 * @param {{ startId: string, endId: string, hoursId: string, hintId?: string, hintText?: string }} cfg
 */
function bindHoursAutoCalc(root, cfg) {
  if (!root || !cfg) return;
  const { startId, endId, hoursId, hintId, hintText } = cfg;
  const startDate = root.querySelector(`[data-ff-date="${startId}"]`);
  const startTime = root.querySelector(`[data-ff-time="${startId}"]`);
  const endDate = root.querySelector(`[data-ff-date="${endId}"]`);
  const endTime = root.querySelector(`[data-ff-time="${endId}"]`);
  const hoursInp = root.querySelector(`[data-ff="${hoursId}"]`);
  if (!hoursInp || (!startDate && !startTime && !endDate && !endTime)) return;

  // 時數改為唯讀自動帶入（仍可後端驗證）
  hoursInp.readOnly = true;
  hoursInp.title = '依起迄時間自動換算（最小 0.5 小時）';
  hoursInp.placeholder = '依起迄自動換算';
  if (hoursInp.hasAttribute('required')) {
    // 保持 required，送出前會寫入值
  }

  let hint = hintId ? root.querySelector(`#${hintId}`) : null;
  const hintHost = hoursInp.parentElement;
  if (hintHost && hintId && !hint) {
    hint = document.createElement('div');
    hint.id = hintId;
    hint.className = 'muted';
    hint.style.cssText = 'font-size:0.82rem;margin-top:4px;line-height:1.4';
    hint.textContent =
      hintText ||
      '時數依開始／結束自動換算（17:30～24:00，最小 0.5 小時／30 分鐘）';
    hintHost.appendChild(hint);
  }

  const recalc = () => {
    syncDateTimeHidden(root, startId);
    syncDateTimeHidden(root, endId);
    const a = root.querySelector(`[data-ff="${startId}"]`)?.value;
    const b = root.querySelector(`[data-ff="${endId}"]`)?.value;
    if (!a || !b) {
      hoursInp.value = '';
      if (hint) {
        hint.textContent =
          hintText ||
          '時數依開始／結束自動換算（17:30～24:00，最小 0.5 小時／30 分鐘）';
      }
      return;
    }
    const h = calcOvertimeHours(a, b);
    if (h == null) {
      hoursInp.value = '';
      if (hint) {
        hint.textContent = '結束時間須晚於開始時間，才能換算時數';
        hint.style.color = '#b45309';
      }
      return;
    }
    hoursInp.value = snapHalfUnit(h);
    if (hint) {
      hint.style.color = '';
      const st = a.slice(11, 16);
      const et = b.slice(11, 16);
      const sameDay = a.slice(0, 10) === b.slice(0, 10);
      hint.textContent = sameDay
        ? `自動換算：${st}～${et}＝${h} 小時（最小單位 0.5）`
        : `自動換算：${a.slice(0, 16).replace('T', ' ')}～${b
            .slice(0, 16)
            .replace('T', ' ')}＝${h} 小時`;
    }
  };

  [startDate, startTime, endDate, endTime].forEach((el) => {
    if (el) el.addEventListener('change', recalc);
  });
  // 初次若已有值則試算
  recalc();
}

/** 假別顯示用短名：祭儀假、病假、特休… */
function shortLeaveTypeLabel(type) {
  const s = String(type || '').trim();
  if (!s) return '假別';
  if (/特別休假|特休/.test(s) && !/不休假|代金/.test(s)) return '特休';
  const m = s.match(/（([^）]+)）/);
  if (m) return m[1];
  return s;
}

function isSpecialLeaveTypeClient(type) {
  const t = String(type || '');
  return /特別休假|特休/.test(t) && !/不休假|代金/.test(t);
}

/** 更新欄位 label，保留必填 * 標記 */
function setFieldLabelText(inputEl, text) {
  const lab = inputEl?.closest('.field')?.querySelector('label');
  if (!lab) return;
  const hadReq = !!lab.querySelector('.req') || !!inputEl?.required;
  lab.textContent = '';
  lab.appendChild(document.createTextNode(text));
  if (hadReq) {
    lab.appendChild(document.createTextNode(' '));
    const sp = document.createElement('span');
    sp.className = 'req';
    sp.textContent = '*';
    lab.appendChild(sp);
  }
}

/**
 * 人事簽核：假別（人事核定）變更時
 * - 標籤改為「剩餘{假別}日數（目前／核准後）」
 * - 特休：自動帶入剩餘日數（核准後＝目前−本單）；不再使用／換算小時
 * - 非特休：數值留白，不帶入
 * - 隱藏「剩餘特休小時」欄（若流程定義仍殘留）
 */
function bindHrLeaveTypeAutoRemain(root, labor) {
  if (!root || !labor) return;
  const typeSel = root.querySelector('[data-ff="hr_leave_type"]');
  const daysInp = root.querySelector('[data-ff="remaining_special_leave_days"]');
  const hoursInp = root.querySelector(
    '[data-ff="remaining_special_leave_hours"]'
  );
  // 特休不以小時計算：隱藏殘留的小時欄
  if (hoursInp) {
    const wrap = hoursInp.closest('.field');
    if (wrap) wrap.classList.add('hidden');
    hoursInp.required = false;
    hoursInp.value = '';
    hoursInp.removeAttribute('name');
  }
  if (!typeSel || !daysInp) return;

  // 確保下拉含全部假別選項
  const opts =
    Array.isArray(labor.leaveTypeOptions) && labor.leaveTypeOptions.length
      ? labor.leaveTypeOptions
      : labor.remainByLeaveType
        ? Object.keys(labor.remainByLeaveType)
        : [];
  if (opts.length && typeSel.tagName === 'SELECT') {
    const cur = typeSel.value || labor.leaveType || '';
    const existing = new Set(
      [...typeSel.options].map((o) => o.value).filter(Boolean)
    );
    opts.forEach((opt) => {
      if (!existing.has(opt)) {
        const o = document.createElement('option');
        o.value = opt;
        o.textContent = opt;
        typeSel.appendChild(o);
      }
    });
    if (cur && !existing.has(cur) && !opts.includes(cur)) {
      const o = document.createElement('option');
      o.value = cur;
      o.textContent = cur;
      typeSel.appendChild(o);
    }
    if (cur) typeSel.value = cur;
  }

  const applyRemain = () => {
    const t = typeSel.value || '';
    const isSpecial = isSpecialLeaveTypeClient(t);
    const shortName = shortLeaveTypeLabel(t);
    let days = '';

    if (isSpecial) {
      const map = labor.remainByLeaveType || {};
      if (map[t] && map[t].days !== '' && map[t].days != null) {
        days = map[t].days ?? '';
      } else {
        const before = Number(labor.remainingBefore);
        const thisDays = Number(labor.thisLeaveDays);
        let remain = Number.isFinite(before) ? before : null;
        if (remain != null && Number.isFinite(thisDays) && thisDays > 0) {
          remain = Math.round((remain - thisDays) * 2) / 2;
        }
        if (remain != null) {
          remain = Math.max(0, remain);
          days = String(remain);
        }
      }
    }
    // 非特休：強制留白

    if (daysInp) {
      daysInp.value = isSpecial ? days : '';
      daysInp.required = isSpecial;
      daysInp.placeholder = isSpecial
        ? '例如：7 或 7.5（核准後剩餘日數）'
        : '非特休可留白';
      daysInp.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // 標籤依假別變動（僅日數，不換算小時）
    const dayLabel = isSpecial
      ? `剩餘${shortName}日數（核准後）`
      : `剩餘${shortName}日數（目前）`;
    if (daysInp) setFieldLabelText(daysInp, dayLabel);
  };

  typeSel.addEventListener('change', applyRemain);
  applyRemain();
}

/** 人事簽核：申請人特休剩餘提示區塊 */
let leaveBalanceReqSeq = 0;

/** 新增申請頁：選到請假類流程時，載入並顯示我的請假餘額（僅供參考，實際以人事核定為準） */
async function loadAndRenderLeaveBalance(box) {
  if (!box) return;
  const seq = ++leaveBalanceReqSeq;
  box.innerHTML = `<div class="muted" style="font-size:0.85rem">載入請假餘額中…</div>`;
  try {
    const me = state.user?.id;
    if (!me) {
      box.innerHTML = '';
      return;
    }
    const res = await api(`/api/users/${me}/labor`);
    if (seq !== leaveBalanceReqSeq) return; // 使用者已切換流程，捨棄此結果
    const balances = (res?.labor?.leaveBalances || []).filter(
      (b) => b && (b.hasFixedQuota || b.canTrackManual)
    );
    if (!balances.length) {
      box.innerHTML = '';
      return;
    }
    box.innerHTML = `
      <div class="card" style="background:#f0fdf4;border-color:#86efac;margin-bottom:12px;padding:12px">
        <strong>我的請假餘額</strong>
        <div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:8px 18px;font-size:0.88rem">
          ${balances
            .map(
              (b) =>
                `<span>${esc(b.name)}：剩餘 <strong style="color:#15803d">${esc(
                  String(b.remainingLabel ?? b.remaining ?? '—')
                )}</strong></span>`
            )
            .join('')}
        </div>
        <p class="muted" style="margin:6px 0 0;font-size:0.78rem">僅供參考；實際可休天數與扣除以人事核定為準。</p>
      </div>`;
  } catch (e) {
    if (seq !== leaveBalanceReqSeq) return;
    box.innerHTML = '';
  }
}

function renderApplicantLaborBanner(labor, request) {
  if (!labor) return '';
  const sl = labor.specialLeave || {};
  const thisDays = labor.thisLeaveDays;
  const after =
    labor.remainingAfter != null
      ? labor.remainingAfter
      : labor.suggestRemainingDays;
  const warnAfter = after != null && after < 0;
  const entitled = sl.entitled ?? 0;
  return `
    <div class="card" style="background:#f0fdf4;border-color:#86efac;margin-bottom:12px;padding:12px">
      <strong>申請人特休（成員名單手動可休）</strong>
      <div style="margin-top:8px;font-size:0.9rem;line-height:1.55">
        <div>申請人：${esc(request.requester_name || '')}${
          request.requester_dept ? `（${esc(request.requester_dept)}）` : ''
        }</div>
        <div>到職日：${esc(labor.hireDate || '未設定')}${
          labor.seniority?.label ? ` · 年資：${esc(labor.seniority.label)}（僅顯示）` : ''
        }</div>
        <div>統計年度：${esc(sl.yearLabel || '—')}</div>
        <div>
          可休 <strong>${entitled}</strong> 日（手動）·
          已休 ${sl.used ?? '—'} 日
          ${
            sl.manualUsedDays
              ? `（含手動 ${sl.manualUsedDays || 0} 日）`
              : ''
          } ·
          目前剩餘 <strong style="color:#15803d">${
            labor.remainingBefore != null ? labor.remainingBefore : sl.remaining ?? '—'
          }</strong> 日
        </div>
        ${
          entitled === 0
            ? `<div class="muted" style="margin-top:4px">可休為 0：請至「成員名單」手動填寫特休可休天數。</div>`
            : ''
        }
        ${
          labor.thisIsSpecial && thisDays != null
            ? `<div>
                本單特休申請 <strong>${thisDays}</strong> 日 →
                核准後剩餘
                <strong style="color:${warnAfter ? '#b91c1c' : '#15803d'}">${after}</strong> 日
                ${warnAfter ? '（已超休，請確認）' : '（已自動填入下方「剩餘特休日數」）'}
              </div>`
            : labor.leaveType
              ? `<div>本單假別：${esc(labor.leaveType)}${
                  thisDays != null ? ` · ${thisDays} 日` : ''
                }（非特休時，剩餘欄位可留白）</div>`
              : ''
        }
      </div>
      <p class="muted" style="margin:8px 0 0;font-size:0.8rem">
        特休以<strong>日</strong>計算（不換算小時）。可休日數由成員名單手動設定；統計年度為曆年制（1/1～12/31）。實際給假以人事核定為準。
      </p>
    </div>`;
}

function syncDateTimeHidden(root, fieldId) {
  const dateEl = root.querySelector(`[data-ff-date="${fieldId}"]`);
  const timeEl = root.querySelector(`[data-ff-time="${fieldId}"]`);
  const hidden = root.querySelector(`[data-ff="${fieldId}"][data-type="datetime"]`);
  if (!dateEl || !timeEl || !hidden) return;
  if (dateEl.value && timeEl.value) {
    hidden.value = `${dateEl.value}T${timeEl.value}`;
  } else {
    hidden.value = '';
  }
}

function bindDateTimeFields(root) {
  root.querySelectorAll('[data-datetime-field]').forEach((wrap) => {
    const id = wrap.dataset.datetimeField;
    const dateEl = wrap.querySelector(`[data-ff-date="${id}"]`);
    const timeEl = wrap.querySelector(`[data-ff-time="${id}"]`);
    const onChange = () => syncDateTimeHidden(root, id);
    if (dateEl) dateEl.addEventListener('change', onChange);
    if (timeEl) timeEl.addEventListener('change', onChange);
    onChange();
  });
}

/** 正規化自繪表格資料 */
function normalizeFormTable(raw) {
  if (!raw) return null;
  let obj = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== 'object') return null;
  let cells = obj.cells;
  if (!Array.isArray(cells) || !cells.length) return null;
  cells = cells.map((row) =>
    (Array.isArray(row) ? row : []).map((c) => String(c ?? ''))
  );
  const cols = Math.max(
    1,
    ...cells.map((r) => r.length),
    Number(obj.cols) || 0
  );
  cells = cells.map((r) => {
    const next = r.slice(0, cols);
    while (next.length < cols) next.push('');
    return next;
  });
  // 全空白表格視為無
  const hasContent = cells.some((r) => r.some((c) => String(c).trim()));
  if (!hasContent) return null;
  return {
    rows: cells.length,
    cols,
    header: obj.header !== false,
    cells,
  };
}

function emptyFormTable(rows = 3, cols = 3) {
  const r = Math.min(20, Math.max(1, Number(rows) || 3));
  const c = Math.min(10, Math.max(1, Number(cols) || 3));
  return {
    rows: r,
    cols: c,
    header: true,
    cells: Array.from({ length: r }, () => Array.from({ length: c }, () => '')),
  };
}

function renderFormTableEditorHtml(fieldId, table) {
  const t = normalizeFormTable(table) || emptyFormTable(3, 3);
  const head = t.header;
  let html = `<table class="form-draw-table" data-table-grid="${esc(fieldId)}"><tbody>`;
  t.cells.forEach((row, ri) => {
    html += '<tr>';
    row.forEach((cell, ci) => {
      const tag = head && ri === 0 ? 'th' : 'td';
      html += `<${tag} contenteditable="true" data-r="${ri}" data-c="${ci}" spellcheck="false">${esc(cell)}</${tag}>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  html += `<div class="muted" style="font-size:0.78rem;margin-top:6px">表格 ${t.rows} 列 × ${t.cols} 欄${head ? '（首列為表頭）' : ''}</div>`;
  return html;
}

function readFormTableFromDom(root, fieldId) {
  const grid = root.querySelector(`[data-table-grid="${fieldId}"]`);
  if (!grid) return null;
  const rows = [...grid.querySelectorAll('tr')];
  if (!rows.length) return null;
  const cells = rows.map((tr) =>
    [...tr.querySelectorAll('th,td')].map((td) =>
      (td.innerText || td.textContent || '').replace(/\u00a0/g, ' ').trimEnd()
    )
  );
  return normalizeFormTable({ cells, header: true });
}

function syncFormTableHidden(root, fieldId) {
  const hidden = root.querySelector(
    `input[data-table-for="${fieldId}"][data-type="form_table"]`
  );
  if (!hidden) return;
  const t = readFormTableFromDom(root, fieldId);
  hidden.value = t ? JSON.stringify(t) : '';
  const tools = root.querySelector(`[data-table-tools="${fieldId}"]`);
  const wrap = root.querySelector(`[data-table-wrap="${fieldId}"]`);
  const has = !!t || (wrap && !wrap.classList.contains('hidden') && wrap.querySelector('table'));
  if (tools) {
    tools.querySelectorAll('button[data-table-add-row],button[data-table-add-col],button[data-table-del-row],button[data-table-del-col],button[data-table-clear]').forEach((btn) => {
      btn.disabled = !wrap || wrap.classList.contains('hidden');
    });
  }
  return has;
}

function mountFormTable(root, fieldId, table) {
  const wrap = root.querySelector(`[data-table-wrap="${fieldId}"]`);
  const hidden = root.querySelector(
    `input[data-table-for="${fieldId}"][data-type="form_table"]`
  );
  if (!wrap || !hidden) return;
  const t = normalizeFormTable(table) || emptyFormTable(3, 3);
  wrap.classList.remove('hidden');
  wrap.innerHTML = renderFormTableEditorHtml(fieldId, t);
  hidden.value = JSON.stringify(t);
  syncFormTableHidden(root, fieldId);
  // 編輯時即時寫入 hidden
  wrap.querySelectorAll('[contenteditable]').forEach((cell) => {
    cell.addEventListener('input', () => syncFormTableHidden(root, fieldId));
    cell.addEventListener('blur', () => syncFormTableHidden(root, fieldId));
  });
}

function mutateFormTable(root, fieldId, action) {
  const wrap = root.querySelector(`[data-table-wrap="${fieldId}"]`);
  if (!wrap || wrap.classList.contains('hidden')) return;
  let t = readFormTableFromDom(root, fieldId) || emptyFormTable(3, 3);
  const cells = t.cells.map((r) => r.slice());
  const cols = t.cols;
  if (action === 'add-row') {
    if (cells.length >= 20) return toast('表格最多 20 列', 'error');
    cells.push(Array.from({ length: cols }, () => ''));
  } else if (action === 'add-col') {
    if (cols >= 10) return toast('表格最多 10 欄', 'error');
    cells.forEach((r) => r.push(''));
  } else if (action === 'del-row') {
    if (cells.length <= 1) return toast('至少保留 1 列', 'error');
    cells.pop();
  } else if (action === 'del-col') {
    if (cols <= 1) return toast('至少保留 1 欄', 'error');
    cells.forEach((r) => r.pop());
  } else if (action === 'clear') {
    wrap.classList.add('hidden');
    wrap.innerHTML = '';
    const hidden = root.querySelector(
      `input[data-table-for="${fieldId}"][data-type="form_table"]`
    );
    if (hidden) hidden.value = '';
    syncFormTableHidden(root, fieldId);
    return;
  }
  mountFormTable(root, fieldId, { cells, header: true });
}

/** 綁定說明欄位自繪表格工具列 */
function bindFormTableEditors(root) {
  if (!root) return;
  // 還原既有表格
  root.querySelectorAll('input[data-type="form_table"]').forEach((hidden) => {
    const fieldId = hidden.dataset.tableFor;
    if (!fieldId) return;
    const t = normalizeFormTable(hidden.value);
    if (t) mountFormTable(root, fieldId, t);
    else syncFormTableHidden(root, fieldId);
  });

  root.querySelectorAll('[data-table-insert]').forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.tableInsert;
      const wrap = root.querySelector(`[data-table-wrap="${id}"]`);
      if (wrap && !wrap.classList.contains('hidden') && wrap.querySelector('table')) {
        if (!confirm('已有表格，要重新建立嗎？（內容會清空）')) return;
      }
      const rc = prompt('請輸入列數,欄數（例如 3,4）', '3,3');
      if (rc == null) return;
      const parts = String(rc).split(/[,，xX*／/]/).map((s) => Number(String(s).trim()));
      const rows = parts[0] > 0 ? parts[0] : 3;
      const cols = parts[1] > 0 ? parts[1] : 3;
      mountFormTable(root, id, emptyFormTable(rows, cols));
    };
  });
  const actions = [
    ['data-table-add-row', 'add-row'],
    ['data-table-add-col', 'add-col'],
    ['data-table-del-row', 'del-row'],
    ['data-table-del-col', 'del-col'],
    ['data-table-clear', 'clear'],
  ];
  for (const [attr, action] of actions) {
    root.querySelectorAll(`[${attr}]`).forEach((btn) => {
      btn.onclick = () => {
        const id = btn.getAttribute(attr);
        mutateFormTable(root, id, action);
      };
    });
  }
}

function collectFormData(root) {
  // 先同步所有日期時間隱藏欄位
  root.querySelectorAll('[data-datetime-field]').forEach((wrap) => {
    syncDateTimeHidden(root, wrap.dataset.datetimeField);
  });
  // 同步富文字編輯器 → textarea
  root.querySelectorAll('textarea[data-rich="1"]').forEach((ta) => {
    const surface = root.querySelector(
      `.rich-editor[data-rich-for="${ta.dataset.ff}"] .re-surface`
    );
    if (surface && typeof RichEditor !== 'undefined') {
      ta.value = RichEditor.sanitizeHtml(surface.innerHTML);
      const plain = RichEditor.htmlToPlain(ta.value).trim();
      if (!plain && !/<table/i.test(ta.value)) ta.value = '';
    }
  });
  // 同步舊版自繪表格（相容）
  root.querySelectorAll('input[data-type="form_table"]').forEach((hidden) => {
    const id = hidden.dataset.tableFor;
    if (id) syncFormTableHidden(root, id);
  });
  const data = {};
  const cosignBuckets = {}; // cosign_N → id[]
  const usersPickBuckets = {}; // users_pick_N → id[]
  root.querySelectorAll('[data-ff]').forEach((el) => {
    const id = el.dataset.ff;
    // 會簽多選 checkbox
    if (el.dataset.type === 'cosign_pick' && el.type === 'checkbox') {
      if (!cosignBuckets[id]) cosignBuckets[id] = [];
      if (el.checked) cosignBuckets[id].push(Number(el.value));
      return;
    }
    // 副總等申請人自選：勾選多位
    if (el.dataset.type === 'users_pick' && el.type === 'checkbox') {
      if (!usersPickBuckets[id]) usersPickBuckets[id] = [];
      if (el.checked) usersPickBuckets[id].push(Number(el.value));
      return;
    }
    // 自繪表格：存物件
    if (el.dataset.type === 'form_table') {
      const t = normalizeFormTable(el.value);
      if (t) data[id] = t;
      return;
    }
    // radio：只取 checked
    if (el.type === 'radio') {
      if (el.checked) data[id] = el.value;
      return;
    }
    if (el.dataset.type === 'checkbox' || el.type === 'checkbox') {
      data[id] = !!el.checked;
    } else {
      data[id] = el.value;
    }
  });
  // 會簽：無勾選＝skip；有勾選＝逗號分隔 id
  for (const [id, ids] of Object.entries(cosignBuckets)) {
    const clean = ids.filter((n) => n > 0);
    data[id] = clean.length ? clean.join(',') : 'skip';
  }
  // 申請人自選簽核人：逗號分隔 id（至少一位由送出驗證）
  for (const [id, ids] of Object.entries(usersPickBuckets)) {
    const clean = [...new Set(ids.filter((n) => n > 0))];
    data[id] = clean.length ? clean.join(',') : '';
  }
  return data;
}

/** 送出前檢查 users_pick 至少勾選一位 */
function validateUsersPickRequired(root) {
  const choosers = root.querySelectorAll('[data-users-pick-chooser]');
  for (const box of choosers) {
    const fieldId = box.dataset.usersPickChooser;
    const checked = box.querySelectorAll(
      `input[data-type="users_pick"][data-ff="${fieldId}"]:checked`
    );
    if (!checked.length) {
      const label =
        box.querySelector('label')?.textContent?.replace(/\s*\*\s*$/, '').trim() || '簽核人';
      return `請勾選至少一位「${label}」`;
    }
  }
  return null;
}

function formatFormValue(field, value, formData) {
  if (field?.type === 'checkbox') return value ? '是' : '否';
  if (field?.type === 'datetime') return formatDateTimeDisplay(value);
  if (field?.type === 'user') {
    if (formData?.[`${field.id}__label`]) return formData[`${field.id}__label`];
    if (formData?.[`${field.id}__name`]) return formData[`${field.id}__name`];
    const label = userLabelById(value, '');
    if (label) return label;
  }
  if (value == null || value === '') return '—';
  // 金額＋幣別（請購等）
  if (
    field?.id === 'amount' ||
    (field?.type === 'number' && /金額|總價|費用/.test(String(field?.label || '')))
  ) {
    const cur = formData?.currency || formData?.幣別 || '';
    const num = Number(value);
    const numText = Number.isFinite(num)
      ? num.toLocaleString('en-US', { maximumFractionDigits: 4 })
      : String(value);
    return cur ? `${numText} ${cur}` : numText;
  }
  return String(value);
}

/** 詳情頁：渲染自繪表格 */
function renderFormTableHtml(table) {
  const t = normalizeFormTable(table);
  if (!t) return '';
  let html = '<table class="form-view-table"><tbody>';
  t.cells.forEach((row, ri) => {
    html += '<tr>';
    row.forEach((cell) => {
      const tag = t.header && ri === 0 ? 'th' : 'td';
      html += `<${tag}>${esc(cell) || '&nbsp;'}</${tag}>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  return html;
}

/**
 * 表單欄位顯示：富文字 HTML／分行格式；相容舊版 __table
 */
function renderFormValueHtml(field, value, formData) {
  const raw = value == null || value === '' ? '' : String(value);
  const isRichField =
    field?.type === 'textarea' ||
    field?.id === 'subject' ||
    /主旨|說明|事由|內容|備註|異常|規格/.test(String(field?.label || ''));

  // 富文字 HTML
  if (
    isRichField &&
    typeof RichEditor !== 'undefined' &&
    (RichEditor.isProbablyHtml(raw) || formData?.[`${field?.id}__table`])
  ) {
    let html = raw;
    const legacy = formData?.[`${field?.id}__table`];
    if (legacy && !/<table/i.test(html)) {
      const t = normalizeFormTable(legacy);
      if (t) {
        const rows = t.cells
          .map(
            (row, ri) =>
              `<tr>${row
                .map((c) => {
                  const tag = t.header && ri === 0 ? 'th' : 'td';
                  return `<${tag} style="border:1px solid #94a3b8;padding:6px 8px">${esc(c)}</${tag}>`;
                })
                .join('')}</tr>`
          )
          .join('');
        html =
          (html
            ? RichEditor.isProbablyHtml(html)
              ? html
              : RichEditor.plainToHtml(html)
            : '') +
          `<table border="1" style="border-collapse:collapse;width:100%"><tbody>${rows}</tbody></table>`;
      }
    }
    return RichEditor.renderViewHtml(html || raw);
  }

  const text = formatFormValue(field, value, formData);
  const escaped = esc(text);
  const multiline =
    isRichField ||
    String(text).includes('\n') ||
    String(text).includes('\r');
  const tableHtml = renderFormTableHtml(formData?.[`${field?.id}__table`]);
  let body = '';
  if (multiline && text !== '—') {
    body = `<div class="form-value-pre">${escaped}</div>`;
  } else if (text !== '—' || !tableHtml) {
    body = escaped;
  }
  if (tableHtml) body += tableHtml;
  return body || '—';
}

function renderPlainValueHtml(val) {
  const text = val == null || val === '' ? '—' : String(val);
  const escaped = esc(text);
  if (text !== '—' && (text.includes('\n') || text.includes('\r'))) {
    return `<div class="form-value-pre">${escaped}</div>`;
  }
  return escaped;
}

/** 依 id 取「姓名（部門）」顯示字串；查無此人回傳 fallback */
function userLabelById(id, fallback) {
  const u = (state.users || []).find((x) => x.id === Number(id));
  if (!u) return fallback;
  return u.department ? `${u.name}（${u.department}）` : u.name;
}

/** 「1,2,3」→「姓名（部門）、…」；沒有有效 id 時回傳空字串 */
function userLabelsFromIds(val) {
  return String(val)
    .split(/[,，\s]+/)
    .map(Number)
    .filter((n) => n > 0)
    .map((id) => userLabelById(id, `#${id}`))
    .join('、');
}

function renderFormDataBlock(formFields, formData) {
  const fields = formFields || [];
  const data = formData || {};
  // 部門主管自選欄位（dept_head_N）
  const deptHeadRows = Object.keys(data)
    .filter((k) => /^dept_head_\d+$/.test(k))
    .map((k) => {
      const v = data[k];
      let label = '部門主管';
      let display = '略過';
      if (v && v !== 'skip' && Number(v)) {
        display = userLabelById(
          v,
          data[`${k}__label`] || data[`${k}__name`] || `#${v}`
        );
      }
      return `<dt>${esc(label)}</dt><dd>${esc(display)}</dd>`;
    })
    .join('');
  // 申請人自選簽核人（users_pick_N，如副總；可多位勾選）
  const usersPickRows = Object.keys(data)
    .filter((k) => /^users_pick_\d+$/.test(k))
    .map((k) => {
      const v = data[k];
      let display = data[`${k}__label`] || '—';
      if (data[`${k}__label`]) {
        display = data[`${k}__label`];
      } else if (String(v) === 'all') {
        display = '全部';
      } else if (v) {
        const labels = userLabelsFromIds(v);
        if (labels) display = labels;
      }
      return `<dt style="white-space:nowrap">副總經理簽核</dt><dd style="white-space:nowrap">${esc(display)}</dd>`;
    })
    .join('');
  // 會簽人員 cosign_N（可多位 1,2,3）
  const cosignRows = Object.keys(data)
    .filter((k) => /^cosign_\d+$/.test(k))
    .map((k) => {
      const v = data[k];
      let display = '略過（無會簽）';
      if (data[`${k}__label`]) {
        display = data[`${k}__label`];
      } else if (v && v !== 'skip') {
        const labels = userLabelsFromIds(v);
        if (labels) display = labels;
      }
      return `<dt>會簽人員</dt><dd>${esc(display)}</dd>`;
    })
    .join('');
  if (!fields.length) {
    const keys = Object.keys(data).filter(
      (k) =>
        !k.includes('__') &&
        !/^dept_head_\d+$/.test(k) &&
        !/^users_pick_\d+$/.test(k) &&
        !/^cosign_\d+$/.test(k)
    );
    if (!keys.length && !deptHeadRows && !usersPickRows && !cosignRows) return '';
    return `
      <h3 style="margin-top:20px">表單資料</h3>
      <dl class="kv">
        ${keys.map((k) => `<dt>${esc(k)}</dt><dd>${renderPlainValueHtml(data[k])}</dd>`).join('')}
        ${deptHeadRows}
        ${cosignRows}
        ${usersPickRows}
      </dl>`;
  }
  return `
    <h3 style="margin-top:20px">表單資料</h3>
    <dl class="kv">
      ${fields
        .map(
          (f) =>
            `<dt>${esc(f.label)}</dt><dd>${renderFormValueHtml(f, data[f.id], data)}</dd>`
        )
        .join('')}
      ${deptHeadRows}
      ${cosignRows}
      ${usersPickRows}
    </dl>`;
}

function isOfficeFileName(name) {
  return /\.(docx?|xlsx?|pptx?|odt|ods|odp|csv|rtf)$/i.test(String(name || ''));
}

function isPreviewableAttachmentName(name) {
  return /\.(pdf|png|jpe?g|gif|webp)$/i.test(String(name || ''));
}

function renderAttachmentsBlock(attachments, opts = {}) {
  const list = attachments || [];
  if (!list.length) return '';
  const ooOn = !!opts.onlyOfficeEnabled;
  // 簽核中／草稿可編輯；已核准等完成狀態僅檢視
  const reqStatus = String(opts.requestStatus || '');
  const ooCanEdit = reqStatus === 'pending' || reqStatus === 'draft';
  const fmtSize = (n) => {
    if (!n) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  };
  return `
    <h3 style="margin-top:20px">附件</h3>
    ${
      ooOn
        ? `<p class="muted" style="font-size:0.82rem;margin:0 0 8px">${
            ooCanEdit
              ? 'Word／Excel 可「線上編輯」後自動回存（需 OnlyOffice）。'
              : '簽核已完成，附件僅供「線上檢視」，無法再修改。'
          }</p>`
        : ''
    }
    <ul style="margin:0;padding-left:18px">
      ${list
        .map((a) => {
          const office = ooOn && isOfficeFileName(a.original_name);
          const previewable = isPreviewableAttachmentName(a.original_name);
          return `
        <li style="margin:6px 0;display:flex;flex-wrap:wrap;align-items:center;gap:8px">
          <button type="button" class="linkish" data-dl-att="${a.id}" data-dl-name="${esc(a.original_name || '')}">${esc(a.original_name)}</button>
          ${
            previewable
              ? `<button type="button" class="btn outline sm" data-preview-att="${a.id}" data-preview-name="${esc(a.original_name || '')}">預覽</button>`
              : ''
          }
          ${
            office
              ? `<button type="button" class="btn outline sm" data-oo-edit="${a.id}">${
                  ooCanEdit ? '線上編輯' : '線上檢視'
                }</button>`
              : ''
          }
          <span class="muted" style="font-size:0.82rem">
            ${a.size_bytes ? ` · ${fmtSize(a.size_bytes)}` : ''}
            ${a.uploader_name ? ` · ${esc(a.uploader_name)}` : ''}
            ${
              a.step_order != null && a.step_order !== ''
                ? ` · 步驟 ${esc(String(a.step_order))}`
                : ' · 申請時'
            }
          </span>
        </li>`;
        })
        .join('')}
    </ul>`;
}

async function openAttachmentPreviewModal(attId, attName) {
  openModal(`
    <h3 style="margin-top:0">📎 ${esc(attName || '附件預覽')}</h3>
    <div id="att-preview-box" class="muted" style="font-size:0.9rem">載入中…</div>
    <div class="modal-actions" style="margin-top:16px">
      <button type="button" class="btn outline" data-close-modal>關閉</button>
    </div>
  `);
  $('#modal-panel')?.classList.add('wide');
  const box = $('#att-preview-box');
  try {
    const meta = await api(`/api/attachments/${attId}?inline=1`, {
      expectBlob: true,
      returnMeta: true,
    });
    const url = URL.createObjectURL(meta.blob);
    const ct = String(meta.contentType || meta.blob.type || '').toLowerCase();
    const name = String(meta.filename || attName || '');
    const isPdf = ct.includes('pdf') || /\.pdf$/i.test(name);
    if (box) {
      if (isPdf) {
        box.innerHTML = `<iframe src="${url}" title="附件預覽" style="width:100%;height:min(70vh,560px);border:1px solid var(--border);border-radius:8px;background:#fff"></iframe>`;
      } else {
        box.innerHTML = `<img src="${url}" alt="附件預覽" style="max-width:100%;max-height:min(70vh,560px);border-radius:8px;display:block;margin:0 auto" />`;
      }
    }
    setTimeout(() => URL.revokeObjectURL(url), 120_000);
  } catch (err) {
    if (box) box.innerHTML = '';
    toast(err.message || '附件預覽失敗', 'error');
  }
}

let onlyOfficeScriptPromise = null;
let onlyOfficeEditorInstance = null;

function loadOnlyOfficeScript(src) {
  if (window.DocsAPI) return Promise.resolve();
  if (onlyOfficeScriptPromise) return onlyOfficeScriptPromise;
  onlyOfficeScriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      onlyOfficeScriptPromise = null;
      reject(
        new Error(
          '無法載入 OnlyOffice 腳本，請確認 Document Server 已啟動且 ONLYOFFICE_DOCS_URL 正確'
        )
      );
    };
    document.head.appendChild(s);
  });
  return onlyOfficeScriptPromise;
}

function closeOnlyOfficeEditor(reloadDetailId) {
  try {
    if (onlyOfficeEditorInstance && typeof onlyOfficeEditorInstance.destroyEditor === 'function') {
      onlyOfficeEditorInstance.destroyEditor();
    }
  } catch {
    /* ignore */
  }
  onlyOfficeEditorInstance = null;
  closeModal();
  if (reloadDetailId) {
    navigate('detail', { id: Number(reloadDetailId) });
  }
}

async function openOnlyOfficeEditor(attachmentId, requestId) {
  try {
    const data = await api(`/api/onlyoffice/editor/${attachmentId}`);
    if (!data?.config || !data.docsApiScript) {
      throw new Error(data?.error || '無法取得編輯器設定');
    }
    // HTTPS 頁面不可載入 http:// 腳本（混合內容）；改走同源 /web-apps
    let scriptUrl = data.docsApiScript;
    if (
      typeof location !== 'undefined' &&
      location.protocol === 'https:' &&
      /^http:\/\//i.test(scriptUrl)
    ) {
      scriptUrl = `${location.origin}/web-apps/apps/api/documents/api.js`;
    }
    await loadOnlyOfficeScript(scriptUrl);
    if (!window.DocsAPI || !window.DocsAPI.DocEditor) {
      throw new Error('OnlyOffice DocsAPI 未就緒');
    }

    openModal(`
      <div class="oo-editor-shell">
        <div class="oo-editor-bar">
          <div>
            <strong>${esc(data.fileName || '線上編輯')}</strong>
            <span class="muted" style="margin-left:8px;font-size:0.85rem">
              ${data.canEdit ? '可編輯 · 儲存後自動回寫附件' : '唯讀檢視'}
              · 請於編輯器內儲存後再關閉
            </span>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button type="button" class="btn outline sm" id="btn-oo-close">關閉</button>
          </div>
        </div>
        <div id="onlyoffice-placeholder" class="oo-editor-host"></div>
      </div>
    `);
    const modal = $('#modal');
    const panel = $('#modal-panel');
    if (modal) modal.classList.add('modal-oo-open');
    if (panel) {
      panel.classList.add('modal-panel-oo');
      panel.classList.remove('wide', 'modal-panel-wide');
    }

    // 高度由 CSS 的 flex 撐滿（.oo-editor-host { flex:1 }），
    // 這裡量實際可用高度傳給 DocsAPI —— 它需要明確的 px 值。
    // 原本用 window.innerHeight 沒扣掉標題列，會超出視窗高度。
    const host = document.getElementById('onlyoffice-placeholder');
    const barH = document.querySelector('.oo-editor-bar')?.offsetHeight || 52;
    const editorH = Math.max(480, (host?.clientHeight || window.innerHeight - barH));
    if (host) host.style.width = '100%';

    const cfg = {
      ...data.config,
      width: '100%',
      height: `${editorH}px`,
      type: 'desktop',
      events: {
        onDocumentStateChange: () => {},
        onError: (e) => {
          console.error('OnlyOffice error', e);
          toast(e?.data || 'OnlyOffice 編輯器錯誤', 'error');
        },
        onWarning: (e) => console.warn('OnlyOffice warning', e),
      },
    };
    if (cfg.editorConfig) {
      cfg.editorConfig = {
        ...cfg.editorConfig,
        customization: {
          ...(cfg.editorConfig.customization || {}),
          compactHeader: true,
          zoom: 100,
        },
      };
    }

    onlyOfficeEditorInstance = new window.DocsAPI.DocEditor(
      'onlyoffice-placeholder',
      cfg
    );

    $('#btn-oo-close')?.addEventListener('click', () => {
      closeOnlyOfficeEditor(requestId);
    });
  } catch (e) {
    toast(e.message || '無法開啟線上編輯', 'error');
  }
}

/**
 * 人事核定假別 → 顯示用標籤（副總／總經理詳情、簽核歷程共用）
 * 例：祭儀假 → 剩餘祭儀假日數（目前）；特休 → 剩餘特休日數（核准後）
 */
function hrLeaveFieldLabels(hrLeaveType) {
  const t = String(hrLeaveType || '').trim();
  const shortName = shortLeaveTypeLabel(t);
  const isSpecial = isSpecialLeaveTypeClient(t);
  return {
    hr_leave_type: '假別（人事核定）',
    remaining_special_leave_days: t
      ? isSpecial
        ? `剩餘${shortName}日數（核准後）`
        : `剩餘${shortName}日數（目前）`
      : '剩餘日數',
    hr_note: '人事備註',
  };
}

/** 請假／人事：排除特休「換算小時」欄位 */
function stripSpecialLeaveHoursFields(fields) {
  if (!Array.isArray(fields)) return fields || [];
  return fields.filter((f) => {
    if (!f) return false;
    const id = String(f.id || '');
    const label = String(f.label || '');
    if (id === 'remaining_special_leave_hours') return false;
    if (/剩餘.*特休.*小時|特休.*小時/.test(label) && /剩餘|換算/.test(label)) {
      return false;
    }
    if (id === 'remaining_special_leave_hours') return false;
    return true;
  });
}

function labelForApproverField(key, flatOrFd) {
  const hrLabels = hrLeaveFieldLabels(
    flatOrFd?.hr_leave_type || flatOrFd?.假別 || ''
  );
  if (hrLabels[key]) return hrLabels[key];
  const staticLabels = {
    pc_acquired_date: '原電腦取得日期',
    check_os: '作業系統（Windows10）',
    check_memory: '記憶體（4G 以上）',
    check_disk: '硬碟（SSD 500G 以上）',
    check_3dmark: '3DMARK 分數（500 分以上）',
    check_email: '電子郵件定期清理',
    check_backup: '重要資料定期備份',
    check_battery: '電池容量（70% 以下）',
    handle_result: '電腦處理情形',
    handle_note: '處理說明／其他',
    actual_start: '實際工時開始',
    actual_end: '實際工時結束',
    actual_hours: '實際總計（小時）',
    comp_leave_balance: '目前累計可用時數（補休）',
  };
  return staticLabels[key] || key;
}

function renderApproverDataBlock(approverData) {
  const data = approverData || {};
  const flat = {};
  for (const [k, v] of Object.entries(data)) {
    if (k.startsWith('step_') && v && typeof v === 'object' && v.data) {
      Object.assign(flat, v.data);
    } else if (!k.startsWith('step_') && typeof v !== 'object') {
      flat[k] = v;
    }
  }
  const keys = Object.keys(flat);
  if (!keys.length) return '';
  const isIt =
    flat.pc_acquired_date != null ||
    flat.check_os != null ||
    flat.handle_result != null;
  const sectionTitle = isIt
    ? '管理部／簽核單位填寫'
    : flat.hr_leave_type != null || flat.remaining_special_leave_days != null
      ? '人事／簽核單位填寫'
      : '簽核單位填寫';
  // 顯示順序：假別 → 剩餘日 → 備註 → 其他（不再顯示特休小時）
  const order = ['hr_leave_type', 'remaining_special_leave_days', 'hr_note'];
  const orderedKeys = [
    ...order.filter((k) => keys.includes(k)),
    ...keys.filter(
      (k) =>
        !order.includes(k) &&
        k !== 'remaining_special_leave_hours' &&
        !/特休.*小時|剩餘.*小時/.test(String(k))
    ),
  ];
  return `
    <h3 style="margin-top:20px">${sectionTitle}</h3>
    <dl class="kv">
      ${orderedKeys
        .map((k) => {
          let val = flat[k];
          if (k === 'remaining_special_leave_days' && (val === '' || val == null)) {
            val = '—';
          }
          return `<dt>${esc(labelForApproverField(k, flat))}</dt><dd>${esc(
            val
          )}</dd>`;
        })
        .join('')}
    </dl>`;
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
  body.innerHTML = `
    <div class="card">
      <form id="req-form" class="form-grid">
        <div class="field">
          <label>簽核流程 *</label>
          <select name="workflow_id" required>
            <option value="">請選擇…</option>
            ${workflows
              .map((w) => `<option value="${w.id}">${esc(w.name)}</option>`)
              .join('')}
          </select>
        </div>
        <div id="wf-preview" class="muted"></div>
        <div id="leave-balance-box"></div>
        <div class="field hidden" id="title-field-wrap">
          <label>主旨 *（僅一般簽呈）</label>
          <input name="title" id="req-title" maxlength="200" placeholder="請填寫簽呈主旨" />
          <p class="muted" style="font-size:0.8rem;margin:4px 0 0">其他申請表單不顯示主旨，送出時由系統依表單內容自動產生。</p>
        </div>
        <div id="custom-form-area" class="hidden">
          <div class="form-section-title"><strong>流程表單</strong><span class="muted">依所選流程自動顯示</span></div>
          <div class="custom-form-block form-preview-grid form-fields-multi" id="custom-form-fields"></div>
        </div>
        <div class="field" id="attach-area">
          <label>附件（選填，可多檔上傳）</label>
          <input type="file" id="req-attachments" name="attachments" multiple
            accept=".pdf,.png,.jpg,.jpeg,.gif,.doc,.docx,.xls,.xlsx,.txt,image/*" />
          <div class="muted" style="font-size:0.82rem;margin-top:4px">可一次選取多個檔案上傳（按住 Ctrl／Shift 多選），最多 20 個檔，每個上限 10MB（PDF／圖片／Word／Excel 等）</div>
        </div>
        <div class="field" id="notify-prefs-box">
          <label style="white-space:nowrap">Email 提醒通知${
            state.user?.email
              ? ` <span class="muted" style="font-weight:400">（${esc(state.user.email)}）</span>`
              : ` <span style="color:#b45309;font-weight:400">（尚未設定 Email）</span>`
          }</label>
          <div id="notify-prefs-detail" style="display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px">
            <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;margin:0;white-space:nowrap">
              <input type="checkbox" name="notify_email" id="notify-email-cb" value="1"
                ${state.user?.email_notify !== 0 ? 'checked' : ''} />
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
        <div class="form-actions">
          <button type="submit" class="btn primary">送出申請</button>
        </div>
      </form>
    </div>`;

  const sel = body.querySelector('[name=workflow_id]');
  const preview = $('#wf-preview');
  const formArea = $('#custom-form-area');
  const formFieldsBox = $('#custom-form-fields');

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
  /** 一般簽呈：唯一需手動填寫系統「主旨」的流程 */
  const isGeneralMemoWorkflow = (w) => {
    const n = String(w?.name || '');
    return /一般簽呈|簽呈/.test(n) && !/信用額度|請假|請購|報支|出差|加班|報修/.test(n);
  };
  /** 是否顯示主旨輸入（僅一般簽呈） */
  const showTitleField = (w) => isGeneralMemoWorkflow(w);

  /** 電腦異常報修：不使用說明欄富文字／自繪 */
  const isItRepairWorkflow = (w) => {
    const n = String(w?.name || '');
    return /電腦異常|異常報修|報修申請|IT.?Repair/i.test(n);
  };

  /** 請假申請：自動產生主旨 */
  const buildLeaveTitle = (formEl) => {
    const data = collectFormData(formEl);
    const type = data.leave_type || data.假別 || '';
    const start = (data.start_date || '').toString().slice(0, 16);
    const end = (data.end_date || '').toString().slice(0, 16);
    const days = data.days != null && data.days !== '' ? `${data.days}日` : '';
    const hours =
      data.hours != null && data.hours !== '' && Number(data.hours) > 0
        ? `${data.hours}小時`
        : '';
    const parts = ['請假申請'];
    if (type) parts.push(String(type));
    if (start || end) parts.push([start, end].filter(Boolean).join('～'));
    if (days) parts.push(days);
    if (hours) parts.push(hours);
    return parts.join(' · ').slice(0, 200);
  };

  /**
   * 非一般簽呈：不顯示主旨欄，依表單＋流程名稱自動組成（列表／搜尋仍用 title）
   */
  const buildAutoTitle = (w, formEl) => {
    if (isLeaveWorkflow(w)) return buildLeaveTitle(formEl);
    const data = collectFormData(formEl) || {};
    const wfName = String(w?.name || '申請').trim() || '申請';
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
    const leaveBox = $('#leave-balance-box');
    if (!w) {
      preview.innerHTML = '';
      formArea.classList.add('hidden');
      formFieldsBox.innerHTML = '';
      if (leaveBox) leaveBox.innerHTML = '';
      leaveBalanceReqSeq += 1;
      // 未選流程：先隱藏主旨，選定後再依類型顯示
      if (titleWrap) titleWrap.classList.add('hidden');
      if (titleInp) {
        titleInp.required = false;
        titleInp.value = '';
      }
      return;
    }

    const leaveMode = isLeaveWorkflow(w);
    if (leaveBox) {
      if (leaveMode) {
        loadAndRenderLeaveBalance(leaveBox);
      } else {
        leaveBox.innerHTML = '';
        leaveBalanceReqSeq += 1;
      }
    }
    const needTitle = showTitleField(w);
    const plainTextMode = leaveMode || isItRepairWorkflow(w);
    if (titleWrap) titleWrap.classList.toggle('hidden', !needTitle);
    if (titleInp) {
      titleInp.required = needTitle;
      if (!needTitle) titleInp.value = '';
      else {
        titleInp.placeholder = '請填寫簽呈主旨';
      }
    }

    preview.innerHTML = `
      <div class="muted" style="margin-bottom:8px">簽核層級：申請人送出 → 下列步驟依序簽核</div>
      ${flowChartHtml(w.steps || [], { showLegend: false, flow: w.flow || null })}
      <div class="muted">${esc(w.description || '')}</div>`;
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
      return f;
    });
    const deptHeadSteps = (w.steps || []).filter((s) => s.assignType === 'dept_head');
    const cosignSteps = (w.steps || []).filter((s) => s.assignType === 'cosign_pick');
    const usersPickSteps = (w.steps || []).filter((s) => s.assignType === 'users_pick');
    const hasDeptHead = deptHeadSteps.length > 0;
    const hasCosign = cosignSteps.length > 0;
    const hasUsersPick = usersPickSteps.length > 0;
    if (fields.length || hasDeptHead || hasCosign || hasUsersPick) {
      formArea.classList.remove('hidden');
      const deptHeadHtml = deptHeadSteps.map(renderDeptHeadChooserHtml).join('');
      const cosignHtml = cosignSteps.map(renderCosignChooserHtml).join('');
      const usersPickHtml = usersPickSteps.map(renderUsersPickChooserHtml).join('');
      // 不另開分段標題：標籤與選項同一列／同一區塊橫向顯示
      formFieldsBox.innerHTML =
        fields
          .map((f) =>
            renderDynamicFieldHtml(f, {}, { enableRich: !plainTextMode })
          )
          .join('') +
        deptHeadHtml +
        cosignHtml +
        usersPickHtml;
      bindDateTimeFields(formFieldsBox);
      bindUsersPickChooser(formFieldsBox);
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
          '試算：全日＝1 日／7.5 小時；最小單位依假別（事假／病假／公假／公傷／補休＝0.5 小時；特休＝0.5 日；產假／喪假／曠職＝1 日）';
        hintHost.appendChild(leaveHint);
      }
      const syncLeaveFieldSteps = () => {
        if (!leaveMode) return;
        const lt = leaveTypeSel?.value || '';
        const rule = getLeaveMinUnitClient(lt);
        if (daysInp) {
          daysInp.step = rule.unit === 'day' ? String(rule.step) : 'any';
          daysInp.min = '0';
          if (rule.unit === 'day' && rule.step === 1) {
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
            if (rule.unit === 'hour') {
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
          leaveHint.textContent =
            aligned.rule?.id === 'special'
              ? `試算：${aligned.days} 日（特休以日計算，不換算小時）`
              : `試算：${aligned.days} 日、${aligned.hours} 小時（${leaveUnitHintText(leaveType)}）`;
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
            '申請時數依延長工時開始／結束自動換算（17:30～24:00，最小 0.5 小時）',
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

  $('#req-form').onsubmit = async (e) => {
    e.preventDefault();
    const pickErr = validateUsersPickRequired(e.target);
    if (pickErr) {
      toast(pickErr, 'error');
      return;
    }
    const fd = new FormData(e.target);
    const fileInput = $('#req-attachments');
    const files = fileInput?.files ? [...fileInput.files] : [];
    if (files.length > 20) {
      toast('附件最多 20 個', 'error');
      return;
    }
    try {
      const w = workflows.find((x) => x.id === Number(fd.get('workflow_id')));
      let title = String(fd.get('title') || '').trim();
      // 僅一般簽呈需手動填主旨；其餘（含請假）自動組成
      if (!showTitleField(w)) {
        title = buildAutoTitle(w, e.target);
      }
      if (!title) {
        toast(showTitleField(w) ? '請填寫主旨' : '無法產生主旨，請檢查表單', 'error');
        return;
      }
      // 一律用 FormData，方便帶附件（不再送申請內容）
      const body = new FormData();
      body.append('workflow_id', String(fd.get('workflow_id')));
      body.append('title', title);
      body.append('content', '');
      body.append('form_data', JSON.stringify(collectFormData(e.target)));
      const notifyOn = !!e.target.querySelector('#notify-email-cb')?.checked;
      const nApproved = !!e.target.querySelector('#notify-approved-cb')?.checked;
      const nRejected = !!e.target.querySelector('#notify-rejected-cb')?.checked;
      const nStep = !!e.target.querySelector('#notify-step-cb')?.checked;
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
      files.forEach((f) => body.append('attachments', f));
      const { request } = await api('/api/requests', {
        method: 'POST',
        body,
      });
      toast('申請已送出', 'success');
      navigate('detail', { id: request.id });
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

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

