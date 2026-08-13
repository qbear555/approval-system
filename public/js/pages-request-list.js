/**
 * 申請列表（待簽／我的申請／紀錄）
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
