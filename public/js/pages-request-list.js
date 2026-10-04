function openBulkApproveModal({ selectedRequests = [], onCompleted = null } = {}) {
  if (!selectedRequests || !selectedRequests.length) return;
  const count = selectedRequests.length;

  const itemsHtml = selectedRequests
    .map(
      (r) => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--border,#e2e8f0);font-size:0.9rem">
      <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-right:12px">
        <strong>#${r.id}</strong>
        <span style="margin:0 4px;color:var(--text-muted,#64748b)">|</span>
        <span title="${esc(r.title || '')}">${esc(r.title || '')}</span>
        ${
          r.is_proxy_pending
            ? `<span class="tag" style="background:#fef3c7;color:#92400e;font-size:0.75rem;margin-left:4px">代簽${
                r.proxy_principal_name ? `·${esc(r.proxy_principal_name)}` : ''
              }</span>`
            : ''
        }
      </div>
      <div style="color:var(--text-muted,#64748b);font-size:0.85rem;white-space:nowrap">
        ${esc(r.requester_name || '')} · ${esc(r.workflow_name || '')}
      </div>
    </div>`
    )
    .join('');

  const modalHtml = `
    <div class="modal-box" style="max-width:580px;width:100%">
      <div class="modal-head" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h3 style="margin:0;font-size:1.25rem">✅ 批次簽核核准（共 ${count} 筆）</h3>
        <button type="button" class="btn ghost sm" data-close-modal style="font-size:1.2rem;line-height:1">✕</button>
      </div>

      <div style="margin-bottom:14px;max-height:180px;overflow-y:auto;border:1px solid var(--border,#e2e8f0);border-radius:6px;padding:8px 12px;background:var(--bg-subtle,#f8fafc)">
        ${itemsHtml}
      </div>

      <div class="field" style="margin-bottom:14px">
        <label style="font-weight:600;display:block;margin-bottom:6px">簽核意見</label>
        ${typeof commentPhraseButtonsHtml === 'function' ? commentPhraseButtonsHtml('bulk-approve-comment') : ''}
        <textarea id="bulk-approve-comment" rows="3" style="width:100%;box-sizing:border-box" placeholder="請輸入批次簽核意見…">同意</textarea>
      </div>

      <div style="font-size:0.85rem;color:var(--text-muted,#64748b);background:#eff6ff;padding:10px 12px;border-radius:6px;margin-bottom:16px;border-left:4px solid #3b82f6">
        💡 <strong>貼心提醒：</strong> 若選取單據包含需填寫專屬欄位（如人事特休核算、資訊查檢表、授信額度）的關卡，系統將安全略過並主動提示，不會遺漏任何表單資訊。
      </div>

      <div class="form-actions" style="display:flex;justify-content:flex-end;gap:10px;margin:0">
        <button type="button" class="btn outline" data-close-modal>取消</button>
        <button type="button" class="btn success" id="btn-confirm-bulk-approve">確認核准 (${count} 筆)</button>
      </div>
    </div>
  `;

  openModal(modalHtml);

  if (typeof bindCommentPhraseChips === 'function') {
    bindCommentPhraseChips(document);
  } else {
    document.querySelectorAll('.btn-quick-opinion').forEach((btn) => {
      btn.onclick = () => {
        const textarea = document.getElementById('bulk-approve-comment');
        if (textarea) textarea.value = btn.dataset.val || '';
      };
    });
  }

  const confirmBtn = document.getElementById('btn-confirm-bulk-approve');
  if (confirmBtn) {
    confirmBtn.onclick = async () => {
      confirmBtn.disabled = true;
      confirmBtn.textContent = '核准處理中…';
      const comment = (document.getElementById('bulk-approve-comment')?.value || '').trim();
      const ids = selectedRequests.map((r) => r.id);
      try {
        const res = await api('/api/requests/bulk-approve', {
          method: 'POST',
          body: { ids, comment },
        });
        closeModal();
        if (res.failureCount > 0) {
          const failMsg = res.failures
            .map((f) => `• #${f.id} (${f.title || ''}): ${f.error}`)
            .join('\n');
          toast(`已核准 ${res.successCount} 筆，${res.failureCount} 筆需個別開啟審核`, 'warning');
          alert(`批次簽核結果：\n\n成功核准：${res.successCount} 筆\n需個別審核：${res.failureCount} 筆\n\n${failMsg}`);
        } else {
          toast(`已成功批次核准 ${res.successCount} 筆單據！`, 'success');
        }
        if (typeof onCompleted === 'function') {
          onCompleted();
        }
      } catch (err) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = `確認核准 (${count} 筆)`;
        toast(err.message || '批次簽核失敗', 'error');
      }
    };
  }
}
if (typeof window !== 'undefined') {
  window.openBulkApproveModal = openBulkApproveModal;
}

async function renderRequestList(body, filter) {
  // 查詢列僅「簽核紀錄」等紀錄頁；待我簽核／我的申請不顯示、也不帶查詢參數
  const showSearch =
    filter === 'related' || filter === 'all' || filter === 'done';
  const mineStatus =
    filter === 'mine' ? normalizeRequestStatus(state.pageParams && state.pageParams.status) : '';
  const mineStatusLabel = mineStatus ? (STATUS[mineStatus]?.label || mineStatus) : '';

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
        page: Number(prev.page) > 0 ? Number(prev.page) : 1,
      }
    : { q: '', workflow: '', status: '', dateFrom: '', dateTo: '', page: 1 };

  const params = new URLSearchParams({ filter });
  if (showSearch) {
    if (query.q) params.set('q', query.q);
    if (query.workflow) params.set('workflow', query.workflow);
    if (query.status) params.set('status', query.status);
    if (query.dateFrom) params.set('dateFrom', query.dateFrom);
    if (query.dateTo) params.set('dateTo', query.dateTo);
  } else if (mineStatus) {
    params.set('status', mineStatus);
  }

  const data = await api(`/api/requests?${params.toString()}`);
  const allRequests = data.requests || [];
  const paged = showSearch
    ? paginateItems(allRequests, query.page, REQUEST_LIST_PAGE_SIZE)
    : {
        page: 1,
        pages: 1,
        total: allRequests.length,
        pageSize: allRequests.length || 20,
        items: allRequests,
        from: allRequests.length ? 1 : 0,
        to: allRequests.length,
      };
  query.page = paged.page;
  const requests = paged.items;
  const categories = Array.isArray(data.categories) ? data.categories : [];
  // 類別下拉：後端回傳＋本頁資料
  const catSet = new Set(categories);
  for (const r of allRequests) {
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
    allRequests.some((r) => canDeleteRequestRow(r, { adminMode }));
  const isPendingMe = filter === 'pending_me';
  const allowBatchApprove = isPendingMe && requests.length > 0;
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
        ? `<p class="muted" style="margin:0 0 12px">${
            mineStatus
              ? `僅顯示您本人送出、狀態為<strong>「${esc(mineStatusLabel)}」</strong>的申請。 <button type="button" class="btn outline sm" data-go="mine">查看全部我的申請</button>`
              : '僅顯示您本人送出的申請，以及您<strong>代申請</strong>的單據。'
          }${
            isAdmin()
              ? '系統管理員可刪除任何狀態的申請單。'
              : '可刪除<strong>尚未核准</strong>的單據（已核准不可刪）。'
          }</p>`
        : filter === 'pending_me'
          ? `<p class="muted" style="margin:0 0 12px">僅顯示目前待您簽核的單據（含您以<strong>代理人身份可代簽</strong>的待辦，會標示「代簽」）。</p>`
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
      title: mineStatus
        ? `目前沒有${mineStatusLabel}的申請`
        : hasActiveQuery
          ? '沒有符合條件的申請'
          : '尚無我的申請',
      desc: mineStatus
        ? `沒有狀態為「${mineStatusLabel}」的申請。可查看全部我的申請，或新增一筆。`
        : hasActiveQuery
          ? '請調整查詢條件後再試。'
          : '您還沒有申請或草稿。可從「新增申請」填寫並「儲存草稿」或「送出申請」。',
      actions: mineStatus
        ? [
            { label: '查看全部我的申請', go: 'mine', outline: true },
            { label: '＋ 新增申請', go: 'new-request', primary: true },
            { label: '回總覽', go: 'dashboard', outline: true },
          ]
        : hasActiveQuery
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
    { v: 'voided', t: '已作廢' },
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
                <button type="button" class="btn outline sm" id="btn-req-export">匯出 Excel</button>
                <span class="muted" style="font-size:0.85rem">共 <strong>${paged.total}</strong> 筆${
                  paged.pages > 1 ? `，每頁 ${REQUEST_LIST_PAGE_SIZE} 筆` : ''
                }</span>
              </div>
            </form>`
          : ''
      }
      ${
        allowBatchApprove
          ? `<div class="form-actions" style="margin-bottom:12px;flex-wrap:wrap;align-items:center;gap:10px">
              <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
                <input type="checkbox" id="chk-all-reqs" /> 全選
              </label>
              <button type="button" class="btn success sm" id="btn-bulk-approve-reqs" disabled>✅ 批次核准</button>
              <span class="muted" id="req-sel-count">已選 0 筆</span>
            </div>`
          : anyDeletable
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
        allowBatchApprove,
        empty: emptyByFilter[filter] || {
          title: '尚無資料',
          desc: '目前沒有符合條件的簽核單據。',
        },
      })}
      ${showSearch ? requestListPagerHtml(paged) : ''}
    </div>`;
  bindDataGo(body);
  bindRequestRows(body);

  const applyQueryAndReload = (next) => {
    state.requestListQuery = { ...next, _filter: filter };
    navigate(state.page || 'records');
  };
  body.querySelectorAll('[data-req-page]').forEach((btn) => {
    btn.onclick = () => {
      const page = Number(btn.dataset.reqPage);
      if (!page || btn.disabled) return;
      applyQueryAndReload({ ...query, page });
    };
  });
  $('#req-filter-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    applyQueryAndReload({
      q: String(fd.get('q') || '').trim(),
      workflow: String(fd.get('workflow') || '').trim(),
      status: String(fd.get('status') || '').trim(),
      dateFrom: String(fd.get('dateFrom') || '').trim(),
      dateTo: String(fd.get('dateTo') || '').trim(),
      page: 1,
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

  $('#btn-req-export')?.addEventListener('click', async () => {
    const btn = $('#btn-req-export');
    if (btn) btn.disabled = true;
    try {
      const blob = await api('/api/reports/requests-export', {
        method: 'POST',
        body: {
          q: query.q,
          workflow: query.workflow,
          status: query.status,
          dateFrom: query.dateFrom,
          dateTo: query.dateTo,
          kind: 'all',
        },
        expectBlob: true,
      });
      const range =
        query.dateFrom || query.dateTo
          ? `_${query.dateFrom || '起'}_${query.dateTo || '迄'}`
          : '';
      downloadBlobFile(blob, `單據報表${range}.xlsx`);
      toast('Excel 已開始下載', 'success');
    } catch (e) {
      toast(e.message || '匯出失敗', 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  if (!anyDeletable && !allowBatchApprove) return;

  const updateCount = () => {
    const n = getSelectedRequestIds(body).length;
    const el = $('#req-sel-count');
    if (el) el.textContent = `已選 ${n} 筆`;
    const btnApprove = $('#btn-bulk-approve-reqs');
    if (btnApprove) {
      btnApprove.disabled = n === 0;
      btnApprove.textContent = n > 0 ? `✅ 批次核准 (${n} 筆)` : '✅ 批次核准';
    }
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

  $('#btn-bulk-approve-reqs')?.addEventListener('click', () => {
    const selectedIds = getSelectedRequestIds(body);
    if (!selectedIds.length) {
      toast('請先勾選欲核准的單據', 'warning');
      return;
    }
    const selectedRequests = requests.filter((r) => selectedIds.includes(Number(r.id)));
    openBulkApproveModal({
      selectedRequests,
      onCompleted: () => {
        renderRequestList(body, filter);
        refreshBadge();
      },
    });
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
        ? '\n（系統管理員：將永久刪除此單，含已簽核／任何狀態）'
        : '';
      if (
        !confirm(
          `確定刪除申請 #${id}${r ? `「${r.title}」` : ''}？\n將永久刪除單據、歷程、附件與相關備份，無法復原。${adminWarn}`
        )
      ) {
        return;
      }
      try {
        await api(`/api/requests/${id}`, { method: 'DELETE' });
        toast('已刪除申請', 'success');
        navigate(state.page || 'mine', state.pageParams || {});
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
      navigate(state.page || 'mine', state.pageParams || {});
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

async function loadUsers() {
  const { users } = await api('/api/users');
  state.users = users;
  return users;
}

async function loadWorkflows(all = false) {
  // 完整管理列表需 workflows 權限；一般使用者只取啟用中流程（送出申請用）
  if (all && !hasPerm('workflows')) {
    throw new Error('您沒有管理簽核流程的權限');
  }
  const { workflows } = await api(`/api/workflows${all ? '?all=1' : ''}`);
  state.workflows = workflows;
  return workflows;
}

const FIELD_TYPE_LABEL = {
  text: '單行文字',
  textarea: '多行文字',
  number: '數字',
  date: '日期',
  datetime: '日期時間（30分）',
  select: '下拉選單',
  checkbox: '核取方塊',
  user: '人員選擇',
  table: '明細表',
};

/** 出勤可選時間：09:00～17:30（每 30 分鐘） */
const WORK_TIME_START = '09:00';
const WORK_TIME_END = '17:30';
/** 延長工時可選時間：00:00～24:00（全日 24 小時，每 30 分鐘） */
const OT_TIME_START = '00:00';
const OT_TIME_END = '24:00';
/** 延長工時預設起迄（僅預填，不限制可選範圍） */
const OT_DEFAULT_START = '18:00';
const OT_DEFAULT_END = '21:00';

function timeToMinutes(t) {
  const [h, m] = String(t || '0:0').split(':').map(Number);
  // 支援 24:00
  if (Number(h) === 24 && (Number(m) || 0) === 0) return 24 * 60;
  return (h || 0) * 60 + (m || 0);
}

function minutesToTime(mins) {
  if (mins >= 24 * 60) return '24:00';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 將時間對齊 30 分，並限制在指定範圍（預設出勤 09:00～17:30） */
function clampWorkTime(time, fallback = WORK_TIME_START, rangeStart = WORK_TIME_START, rangeEnd = WORK_TIME_END) {
  let t = time || fallback;
  const [hh0, mm0] = String(t).split(':').map(Number);
  let hh = Number.isFinite(hh0) ? hh0 : 9;
  let mm = Number.isFinite(mm0) ? mm0 : 0;
  if (mm !== 0 && mm !== 30) {
    if (mm < 15) mm = 0;
    else if (mm < 45) mm = 30;
    else {
      mm = 0;
      hh += 1;
    }
  }
  let mins = hh * 60 + mm;
  const minM = timeToMinutes(rangeStart);
  const maxM = timeToMinutes(rangeEnd);
  if (mins < minM) mins = minM;
  if (mins > maxM) mins = maxM;
  return minutesToTime(mins);
}

/**
 * 產生半小時時間選項
 * @param {string} selected
 * @param {{ start?: string, end?: string }} range 預設 09:00～17:30
 */
function halfHourTimeOptions(selected = '', range = {}) {
  const rStart = range.start || WORK_TIME_START;
  const rEnd = range.end || WORK_TIME_END;
  const startM = timeToMinutes(rStart);
  const endM = timeToMinutes(rEnd);
  const sel = clampWorkTime(
    selected || rStart,
    rStart,
    rStart,
    rEnd
  );
  const opts = [];
  for (let mins = startM; mins <= endM; mins += 30) {
    const t = minutesToTime(mins);
    opts.push(
      `<option value="${t}" ${sel === t ? 'selected' : ''}>${t}</option>`
    );
  }
  return opts.join('');
}

function parseDateTimeParts(val, defaultTime = WORK_TIME_START) {
  if (!val) return { date: '', time: clampWorkTime(defaultTime) };
  const s = String(val).replace(' ', 'T');
  const m = s.match(/^(\d{4}-\d{2}-\d{2})T?(\d{2}:\d{2})?/);
  if (!m) return { date: '', time: clampWorkTime(defaultTime) };
  let time = m[2] || defaultTime;
  time = clampWorkTime(time, defaultTime);
  return { date: m[1], time };
}

function formatDateTimeDisplay(val) {
  if (!val) return '—';
  const s = String(val).replace('T', ' ');
  return s.length >= 16 ? s.slice(0, 16) : s;
}

const ASSIGN_TYPE_LABEL = {
  users: '指定人員',
  form_user: '表單人員（如代理人）',
  dept_head: '部門主管（申請人自選／可略過）',
  department: '指定單位／部門',
  users_pick: '申請人自選（可多位勾選）',
  cosign_pick: '會簽人員（申請人可多位勾選，非必填）',
};

function flowOpSymbol(op) {
  return (
    {
      '>=': '≥',
      '>': '>',
      '<=': '≤',
      '<': '<',
      '==': '=',
      '!=': '≠',
      contains: '包含',
      not_contains: '不包含',
    }[op] || op
  );
}

function stepAssignLabel(s) {
  if (!s) return '';
  if (s.assignType === 'form_user') return `表單：${s.formFieldId || 'agent'}`;
  if (s.assignType === 'dept_head') return '自選成員／可略過';
  if (s.assignType === 'department') return `單位：${s.department || '—'}`;
  if (s.assignType === 'users_pick') {
    const n = (s.approverIds || []).length;
    const opt = s.skipIfNoApprover ? '選填可略過' : '必填';
    return n ? `申請人自選（${n} 位・${opt}）` : `申請人自選（${opt}）`;
  }
  if (s.assignType === 'cosign_pick') return '會簽（選填）';
  const n = (s.approverIds || []).length;
  return n ? `指定 ${n} 人` : '指定人員';
}

/** 條件式分支 → 人看得懂的說明文字 */
function flowConditionText(s) {
  const c = s && s.condition;
  if (!c || !c.enabled) return '';
  const op = flowOpSymbol(c.operator);
  const cond = `${c.fieldId || ''} ${op} ${c.value != null ? c.value : ''}`.trim();
  return c.action === 'skip' ? `符合「${cond}」則跳過` : `僅當「${cond}」才需簽核`;
}

/** 單一步驟 → 標籤陣列（會簽／自選／條件式…） */
function flowStepTags(s) {
  const tags = [];
  const condText = flowConditionText(s);
  if (condText) tags.push({ cls: 'cond', text: '🔀 條件式', title: condText });
  if (s.assignType === 'cosign_pick') {
    tags.push({ cls: 'cosign', text: '會簽', title: '申請時可勾選多位會簽人員，皆須核准' });
    tags.push({ cls: 'optional', text: '可略過', title: '未勾選任何人時跳過此關卡' });
  } else if (s.mode === 'all' && (s.approverIds || []).length > 1) {
    tags.push({ cls: 'cosign', text: '需全簽', title: '此關卡所有簽核人都核准後才進入下一關' });
  } else if ((s.approverIds || []).length > 1) {
    tags.push({ cls: '', text: '任一人簽', title: '任一位簽核人核准即可進入下一關' });
  }
  if (s.assignType === 'dept_head') {
    tags.push({ cls: 'optional', text: '可略過', title: '由簽核人自選成員，或直接略過此關卡' });
  }
  if (s.assignType === 'users_pick') {
    tags.push({ cls: '', text: '申請人自選', title: '送出申請時由申請人挑選簽核人' });
  }
  if (s.assignType === 'form_user') {
    tags.push({ cls: '', text: '表單指定', title: '簽核人取自表單欄位的填寫內容' });
  }
  return tags;
}

/** 步驟的簽核人描述（優先顯示實際簽核者） */
function flowStepWho(s, ctx) {
  const nameOf =
    ctx.userName ||
    ((id) => {
      const u = (state.users || []).find((x) => x.id === Number(id));
      return u ? u.name : `#${id}`;
    });
  const acted = (ctx.actionsByStep && ctx.actionsByStep.get(Number(s.order))) || [];
  const approved = acted.filter((a) => a.action === 'approve' || a.action === 'reject');
  if (approved.length) {
    return approved
      .map((a) =>
        a.on_behalf_of_name
          ? `${a.actor_name}（代理 ${a.on_behalf_of_name}）`
          : a.actor_name
      )
      .join('、');
  }
  const ids = s.approverIds || [];
  if (ids.length) {
    const names = ids.map(nameOf);
    return names.length > 3
      ? `${names.slice(0, 3).join('、')} 等 ${names.length} 人`
      : names.join('、');
  }
  if (s.assignType === 'department') return `單位：${s.department || '未指定'}`;
  if (s.assignType === 'form_user') return `表單「${s.formFieldId || 'agent'}」欄位`;
  return '';
}

function flowGraphLayers(graph) {
  const nodes = graph.nodes || [];
  const edges = graph.edges || [];
  const inMap = new Map(nodes.map((n) => [n.id, []]));
  const outMap = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    if (inMap.has(e.to)) inMap.get(e.to).push(e);
    if (outMap.has(e.from)) outMap.get(e.from).push(e);
  }
  const depth = new Map();
  const visit = (id, seen) => {
    if (depth.has(id)) return depth.get(id);
    if (seen.has(id)) return 0;
    seen.add(id);
    const ins = inMap.get(id) || [];
    const d = ins.length ? Math.max(...ins.map((e) => visit(e.from, seen) + 1)) : 0;
    depth.set(id, d);
    return d;
  };
  for (const n of nodes) visit(n.id, new Set());
  const maxD = Math.max(0, ...[...depth.values()]);
  const layers = Array.from({ length: maxD + 1 }, () => []);
  for (const n of nodes) layers[depth.get(n.id) || 0].push(n);
  return { layers, inMap, outMap };
}

function flowGraphNodeState(node, states, request) {
  const st = states ? states[node.id] : null;
  if (node.type === 'start') return { cls: 'is-start is-done', icon: '✓' };
  if (node.type === 'end') {
    if (request?.status === 'rejected') return { cls: 'is-end is-rejected', icon: '✕' };
    if (request?.status === 'voided') return { cls: 'is-end is-voided', icon: '⊘' };
    if (st?.state === 'approved' || request?.status === 'approved') {
      return { cls: 'is-end is-done', icon: '✓' };
    }
    return { cls: 'is-end is-todo', icon: '🏁' };
  }
  if (node.type === 'join') {
    return { cls: st?.state === 'approved' ? 'is-join is-done' : 'is-join is-todo', icon: '⋈' };
  }
  if (!st) return { cls: 'is-todo', icon: '' };
  if (st.state === 'approved') return { cls: 'is-done', icon: '✓' };
  if (st.state === 'rejected') return { cls: 'is-rejected', icon: '✕' };
  if (st.state === 'skipped') return { cls: 'is-skipped', icon: '⤳' };
  return { cls: 'is-current', icon: '' };
}

function flowGraphHtml(graph, opts = {}) {
  if (!graph || !Array.isArray(graph.nodes) || !graph.nodes.length) return '';
  const states = opts.nodeStates || null;
  const request = opts.request || null;
  const { layers, inMap } = flowGraphLayers(graph);
  const nameOf =
    opts.userName ||
    ((id) => {
      const u = (state.users || []).find((x) => x.id === Number(id));
      return u ? u.name : `#${id}`;
    });

  const nodeHtml = (node) => {
    const { cls, icon } = flowGraphNodeState(node, states, request);
    const st = states ? states[node.id] : null;
    if (node.type === 'start') {
      return `<div class="flow-node ${cls}">
        <div class="fn-head"><span class="fn-no">${icon}</span><span class="fn-name">申請人</span></div>
        ${request?.requester_name ? `<div class="fn-who">${esc(request.requester_name)}</div>` : ''}
      </div>`;
    }
    if (node.type === 'end') {
      const label =
        request?.status === 'rejected'
          ? '已駁回'
          : request?.status === 'cancelled'
            ? '已取消'
            : request?.status === 'voided'
              ? '已作廢'
              : '完成';
      return `<div class="flow-node ${cls}">
        <div class="fn-head"><span class="fn-no">${icon}</span><span class="fn-name">${esc(label)}</span></div>
        ${request?.completed_at ? `<div class="fn-who">${esc(String(request.completed_at).slice(0, 16))}</div>` : ''}
      </div>`;
    }
    if (node.type === 'join') {
      const n = (inMap.get(node.id) || []).length;
      const title =
        node.mode === 'any' ? `任一分支完成即繼續（共 ${n} 條）` : `${n} 條分支全部完成才繼續`;
      return `<div class="flow-node ${cls}" title="${esc(title)}">
        <div class="fn-head"><span class="fn-no">${icon}</span><span class="fn-name">匯合${node.mode === 'any' ? '（任一）' : '（全部）'}</span></div>
      </div>`;
    }
    const ids = node.approverIds || [];
    let who = '';
    if (ids.length) {
      const names = ids.map(nameOf);
      who = names.length > 3 ? `${names.slice(0, 3).join('、')} 等 ${names.length} 人` : names.join('、');
    } else if (node.assignType === 'department') {
      who = `單位：${node.department || '未指定'}`;
    } else if (node.assignType === 'form_user') {
      who = `表單「${node.formFieldId || 'agent'}」欄位`;
    }
    const tags = flowStepTags({
      assignType: node.assignType,
      mode: node.mode,
      approverIds: ids,
    });
    const metaBits = [];
    if (st?.completed_at) metaBits.push(esc(String(st.completed_at).slice(0, 16)));
    if (st?.state === 'skipped') metaBits.push('已略過');
    return `<div class="flow-node ${cls}">
      <div class="fn-head">
        <span class="fn-no">${esc(icon || String(node.name || '').slice(0, 1))}</span>
        <span class="fn-name">${esc(node.name || node.id)}</span>
      </div>
      ${who ? `<div class="fn-who">${esc(who)}</div>` : ''}
      ${
        tags.length
          ? `<div class="fn-tags">${tags
              .map((t) => `<span class="flow-tag ${t.cls}"${t.title ? ` title="${esc(t.title)}"` : ''}>${esc(t.text)}</span>`)
              .join('')}</div>`
          : ''
      }
      ${metaBits.length ? `<div class="fn-meta">${metaBits.join('　')}</div>` : ''}
    </div>`;
  };

  const parts = [];
  layers.forEach((layer, li) => {
    if (li > 0) {
      const incoming = layer.flatMap((n) => inMap.get(n.id) || []);
      const conds = incoming.filter((e) => e.condition);
      const allDone =
        states &&
        incoming.length > 0 &&
        incoming.every((e) => {
          const s = states[e.from];
          return s && (s.state === 'approved' || s.state === 'skipped');
        });
      const label =
        conds.length === 1
          ? `${conds[0].condition.fieldId} ${flowOpSymbol(conds[0].condition.operator)} ${conds[0].condition.value}`
          : conds.length > 1
            ? `${conds.length} 個條件`
            : '';
      parts.push(
        `<div class="flow-link ${allDone ? 'is-done' : ''} ${conds.length ? 'is-cond' : ''}"${
          label ? ` title="${esc(label)}"` : ''
        }>${label ? `<span class="flow-edge-label">${esc(label)}</span>` : ''}</div>`
      );
    }
    parts.push(
      `<div class="flow-layer ${layer.length > 1 ? 'is-parallel' : ''}">${layer.map(nodeHtml).join('')}</div>`
    );
  });

  const legend = opts.showLegend
    ? `<div class="flow-legend">
        <span><i class="done"></i>已完成</span>
        <span><i class="current"></i>簽核中</span>
        <span><i class="todo"></i>未開始</span>
        <span><i class="skipped"></i>已略過</span>
        <span><i class="rejected"></i>駁回</span>
      </div>`
    : '';
  return `<div class="flow-graph">${parts.join('')}</div>${legend}`;
}

function flowChartHtml(steps, opts = {}) {
  const graph = opts.flow || opts.request?.flow || null;
  if (graph && Array.isArray(graph.nodes) && graph.nodes.length) {
    return flowGraphHtml(graph, {
      ...opts,
      nodeStates: opts.nodeStates || opts.request?.nodeStates || null,
    });
  }
  return flowChartLinearHtml(steps, opts);
}

function flowChartLinearHtml(steps, opts = {}) {
  const list = Array.isArray(steps) ? steps : [];
  const req = opts.request || null;
  const status = req ? String(req.status || '') : '';
  const curStep = req ? Number(req.current_step) : NaN;
  const actionsByStep = new Map();
  for (const a of (req && req.actions) || []) {
    const k = Number(a.step_order);
    if (!actionsByStep.has(k)) actionsByStep.set(k, []);
    actionsByStep.get(k).push(a);
  }
  const ctx = { actionsByStep, userName: opts.userName };
  const parts = [];
  const startDone = !req || status !== 'draft';
  parts.push(`
    <div class="flow-node is-start ${startDone ? 'is-done' : 'is-todo'}">
      <div class="fn-head"><span class="fn-no">${startDone ? '✓' : '0'}</span><span class="fn-name">申請人</span></div>
      ${req ? `<div class="fn-who">${esc(req.requester_name || '')}</div>` : ''}
    </div>`);

  list.forEach((s, i) => {
    const order = Number(s.order != null ? s.order : i + 1);
    const acted = actionsByStep.get(order) || [];
    const hasApprove = acted.some((a) => a.action === 'approve');
    const hasReject = acted.some((a) => a.action === 'reject');
    let cls = 'is-todo';
    let icon = String(order);
    if (!req) {
      cls = 'is-todo';
    } else if (hasReject) {
      cls = 'is-rejected';
      icon = '✕';
    } else if (status === 'approved' || order < curStep) {
      cls = hasApprove ? 'is-done' : 'is-skipped';
      icon = hasApprove ? '✓' : '⤳';
    } else if (status === 'pending' && order === curStep) {
      cls = 'is-current';
    } else if (status === 'rejected' && order === curStep) {
      cls = 'is-rejected';
      icon = '✕';
    }
    const arrowDone = req && (status === 'approved' || order <= curStep);
    const arrowCond = !!(s.condition && s.condition.enabled);
    parts.push(
      `<div class="flow-arrow ${arrowDone ? 'is-done' : ''} ${arrowCond ? 'is-cond' : ''}"${
        arrowCond ? ` title="${esc(flowConditionText(s))}"` : ''
      }></div>`
    );
    const who = flowStepWho(s, ctx);
    const tags = flowStepTags(s);
    const lastAct = [...acted].reverse().find((a) => a.action === 'approve' || a.action === 'reject');
    const metaBits = [];
    if (lastAct && lastAct.created_at) metaBits.push(esc(String(lastAct.created_at).slice(0, 16)));
    if (cls === 'is-skipped') metaBits.push('已略過');
    parts.push(`
      <div class="flow-node ${cls}"${flowConditionText(s) ? ` title="${esc(flowConditionText(s))}"` : ''}>
        <div class="fn-head">
          <span class="fn-no">${esc(icon)}</span>
          <span class="fn-name">${esc(s.name || `關卡 ${order}`)}</span>
        </div>
        ${who ? `<div class="fn-who">${esc(who)}</div>` : ''}
        ${
          tags.length
            ? `<div class="fn-tags">${tags
                .map((t) => `<span class="flow-tag ${t.cls}"${t.title ? ` title="${esc(t.title)}"` : ''}>${esc(t.text)}</span>`)
                .join('')}</div>`
            : ''
        }
        ${metaBits.length ? `<div class="fn-meta">${metaBits.join('　')}</div>` : ''}
      </div>`);
  });

  const endDone = status === 'approved';
  const endRejected = status === 'rejected';
  const endCancelled = status === 'cancelled';
  const endVoided = status === 'voided';
  const endCls = endDone
    ? 'is-done'
    : endRejected
      ? 'is-rejected'
      : endVoided
        ? 'is-voided'
        : 'is-todo';
  const endText = endRejected
    ? '已駁回'
    : endCancelled
      ? '已取消'
      : endVoided
        ? '已作廢'
        : '完成';
  const endIcon = endDone ? '✓' : endRejected ? '✕' : endVoided ? '⊘' : '🏁';
  parts.push(
    `<div class="flow-arrow ${endDone ? 'is-done' : ''}"></div>`,
    `<div class="flow-node is-end ${endCls}">
      <div class="fn-head"><span class="fn-no">${endIcon}</span><span class="fn-name">${esc(endText)}</span></div>
      ${req && req.completed_at ? `<div class="fn-who">${esc(String(req.completed_at).slice(0, 16))}</div>` : ''}
    </div>`
  );
  const legend = opts.showLegend
    ? `<div class="flow-legend">
        <span><i class="done"></i>已完成</span>
        <span><i class="current"></i>簽核中</span>
        <span><i class="todo"></i>未開始</span>
        <span><i class="skipped"></i>已略過</span>
        <span><i class="rejected"></i>駁回</span>
      </div>`
    : '';
  return `<div class="flow-chart">${parts.join('')}</div>${legend}`;
}

/** 申請人同部門成員 + 其他人員（供部門主管自選） */
function splitUsersForDeptHeadChooser() {
  const me = state.user;
  const myDepts = new Set(
    [me?.department, ...(me?.departments || [])].filter(Boolean).map(String)
  );
  const all = (state.users || []).filter((u) => u.active !== 0 && u.id !== me?.id);
  const inDept = (u) => {
    const ud = [u.department, ...(u.departments || [])].filter(Boolean).map(String);
    return ud.some((d) => myDepts.has(d));
  };
  if (!myDepts.size) {
    return { deptMembers: [], others: all, myDeptLabel: '' };
  }
  const deptMembers = all.filter(inDept);
  const others = all.filter((u) => !inDept(u));
  return {
    deptMembers,
    others,
    myDeptLabel: [...myDepts].join('、'),
  };
}
