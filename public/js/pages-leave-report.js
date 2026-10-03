/** 人事：請假報表匯出 */
async function renderLeaveReport(body) {
  if (!hasPerm('leave_report')) {
    body.innerHTML = `<div class="error-msg">您沒有「請假報表匯出」權限（請洽系統管理員於成員權限中開啟）</div>`;
    return;
  }
  await loadUsers();
  const users = (state.users || []).filter((u) => u.active !== 0);
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  const defaultTo = `${y}-${m}-${d}`;
  const defaultFrom = `${y}-01-01`;

  body.innerHTML = `
    <div class="card" style="max-width:960px">
      <h3 style="margin-top:0">請假資料匯出（Excel）</h3>
      <p class="muted" style="margin-top:0;line-height:1.55">
        供<strong>人事單位</strong>匯出：可勾選<strong>多人</strong>、指定日期範圍。
        僅統計<strong>已核准</strong>請假。
        報表為<strong>一人一列</strong>：各有上限假別的<strong>應有／已請／剩餘／可請</strong>（天數），方便多人比對。
      </p>
      <div class="form-grid two" style="margin-bottom:12px">
        <div class="field">
          <label>日期起 *</label>
          <input type="date" id="lr-from" value="${defaultFrom}" required />
        </div>
        <div class="field">
          <label>日期迄 *</label>
          <input type="date" id="lr-to" value="${defaultTo}" required />
        </div>
      </div>
      <div class="field" style="margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <label style="margin:0">選擇人員 *（${users.length} 人）</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button type="button" class="btn outline sm" id="lr-all">全選</button>
            <button type="button" class="btn outline sm" id="lr-none">全不選</button>
            <span class="muted" id="lr-count">已選 0 人</span>
          </div>
        </div>
        <div class="approver-list" id="lr-user-list" style="margin-top:8px;max-height:280px;overflow:auto;border:1px solid var(--border);border-radius:10px;padding:10px">
          ${users
            .map(
              (u) => `
            <label style="display:flex;align-items:center;gap:8px;padding:4px 0">
              <input type="checkbox" data-lr-user value="${u.id}" />
              <span>
                <strong>${esc(u.name)}</strong>
                <span class="muted">（${esc(u.username)}）</span>
                ${u.department ? `<span class="muted">· ${esc(u.department)}</span>` : ''}
              </span>
            </label>`
            )
            .join('') || '<div class="muted">尚無成員</div>'}
        </div>
      </div>
      <div class="form-actions" style="margin-top:16px">
        <button type="button" class="btn primary" id="lr-export">匯出 Excel</button>
      </div>
      <p class="muted" style="font-size:0.82rem;margin-top:12px;line-height:1.45">
        Excel：
        <strong>人員餘額</strong>（一人一列 · 特休／事假／病假／祭儀等 · 應有／已請／剩餘／可請天數）、
        <strong>請假明細</strong>（期間已核准）、
        <strong>說明</strong>。
      </p>
    </div>`;

  const updateCount = () => {
    const n = body.querySelectorAll('input[data-lr-user]:checked').length;
    const el = $('#lr-count');
    if (el) el.textContent = `已選 ${n} 人`;
  };
  body.querySelectorAll('input[data-lr-user]').forEach((cb) => {
    cb.addEventListener('change', updateCount);
  });
  $('#lr-all')?.addEventListener('click', () => {
    body.querySelectorAll('input[data-lr-user]').forEach((cb) => {
      cb.checked = true;
    });
    updateCount();
  });
  $('#lr-none')?.addEventListener('click', () => {
    body.querySelectorAll('input[data-lr-user]').forEach((cb) => {
      cb.checked = false;
    });
    updateCount();
  });

  $('#lr-export')?.addEventListener('click', async () => {
    const userIds = [...body.querySelectorAll('input[data-lr-user]:checked')].map((c) =>
      Number(c.value)
    );
    const dateFrom = $('#lr-from')?.value;
    const dateTo = $('#lr-to')?.value;
    if (!userIds.length) {
      toast('請至少選擇一位人員', 'error');
      return;
    }
    if (!dateFrom || !dateTo) {
      toast('請選擇日期範圍', 'error');
      return;
    }
    if (dateFrom > dateTo) {
      toast('起始日期不可晚於結束日期', 'error');
      return;
    }
    const btn = $('#lr-export');
    if (btn) btn.disabled = true;
    try {
      // 一律僅匯出已核准
      const blob = await api('/api/reports/leave-export', {
        method: 'POST',
        body: { userIds, dateFrom, dateTo },
        expectBlob: true,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `請假報表_${dateFrom}_${dateTo}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      toast('Excel 已開始下載', 'success');
    } catch (e) {
      toast(e.message || '匯出失敗', 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}
