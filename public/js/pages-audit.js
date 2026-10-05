async function renderAuditLogs(body) {
  const query = state.auditListQuery || {};
  const page = Number(query.page) || 1;
  const q = String(query.q || '').trim();
  const category = String(query.category || '').trim();
  const dateFrom = String(query.dateFrom || '').trim();
  const dateTo = String(query.dateTo || '').trim();

  const params = new URLSearchParams({ page, limit: 30 });
  if (q) params.set('q', q);
  if (category) params.set('category', category);
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);

  let data = { logs: [], totalCount: 0, totalPages: 1 };
  try {
    data = await api(`/api/system/audit-logs?${params.toString()}`);
  } catch (err) {
    toast(err.message, 'error');
  }

  const categoryLabels = {
    auth: '🔒 帳號身份與登入',
    approval: '📝 流程與簽核動作',
    user_management: '👥 成員與權限變更',
    workflow: '⚙️ 簽核流程範本',
    system: '🛠️ 系統維運與設定',
    general: '📌 一般紀錄',
  };

  body.innerHTML = `
    <div class="card">
      <form id="audit-filter-form" class="req-filter-bar" style="margin-bottom:16px;padding:16px 18px">
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:14px;align-items:end">
          <div class="field" style="margin:0">
            <label>關鍵字搜尋</label>
            <input type="search" name="q" value="${esc(q)}" placeholder="使用者姓名、帳號、IP、說明關鍵字…" autocomplete="off" />
          </div>
          <div class="field" style="margin:0">
            <label>日誌分類</label>
            <select name="category">
              <option value="">全部分類</option>
              ${Object.entries(categoryLabels)
                .map(([k, v]) => `<option value="${k}" ${category === k ? 'selected' : ''}>${v}</option>`)
                .join('')}
            </select>
          </div>
          <div class="field" style="margin:0">
            <label>發生日期（起～迄）</label>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:nowrap">
              <input type="date" name="dateFrom" value="${esc(dateFrom)}" style="flex:1;min-width:120px" />
              <span class="muted" style="flex-shrink:0">～</span>
              <input type="date" name="dateTo" value="${esc(dateTo)}" style="flex:1;min-width:120px" />
            </div>
          </div>
        </div>
        <div class="form-actions" style="margin-top:14px;display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px">
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            <button type="submit" class="btn primary sm">查詢日誌</button>
            <button type="button" class="btn outline sm" id="btn-audit-clear">清除條件</button>
            <span class="muted" style="font-size:0.85rem">共 <strong>${data.totalCount || 0}</strong> 筆日誌</span>
          </div>
          <button type="button" class="btn outline sm" id="btn-audit-export">📥 匯出 CSV 報告</button>
        </div>
      </form>
      ${
        !data.logs || !data.logs.length
          ? emptyState({ title: '尚無稽核日誌', desc: '目前沒有符合篩選條件的系統稽核紀錄。' })
          : `
            <div class="table-wrap">
              <table class="data" style="width:100%;min-width:1040px;table-layout:fixed">
                <thead>
                  <tr>
                    <th style="width:150px;white-space:nowrap">時間</th>
                    <th style="width:175px;white-space:nowrap">分類</th>
                    <th style="width:130px;white-space:nowrap">執行人員</th>
                    <th style="width:150px;white-space:nowrap">IP 位址</th>
                    <th style="min-width:320px">說明詳情</th>
                  </tr>
                </thead>
                <tbody>
                  ${data.logs
                    .map(
                      (l) => `
                    <tr style="vertical-align:top">
                      <td class="muted" style="white-space:nowrap">${esc(l.created_at)}</td>
                      <td style="white-space:nowrap">
                        <span class="tag draft" style="font-size:0.75rem">${esc(categoryLabels[l.category] || l.category || '一般')}</span>
                      </td>
                      <td style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                        <strong>${esc(l.user_name || '系統/訪客')}</strong>
                        ${l.user_username ? `<span class="muted" style="font-size:0.78rem">(@${esc(l.user_username)})</span>` : ''}
                      </td>
                      <td style="white-space:nowrap"><code>${esc(l.ip_address || '—')}</code></td>
                      <td style="white-space:normal;word-break:break-word;line-height:1.5;color:#334155">${esc(htmlToPlainText(l.description))}</td>
                    </tr>`
                    )
                    .join('')}
                </tbody>
              </table>
            </div>
            ${
              data.totalPages > 1
                ? `<div class="pagination">
                    <button type="button" class="page-btn" id="btn-audit-prev" ${page <= 1 ? 'disabled' : ''}>上一頁</button>
                    <span style="font-size:0.88rem;color:#475569;font-weight:600;padding:0 6px">第 ${page} / ${data.totalPages} 頁</span>
                    <button type="button" class="page-btn" id="btn-audit-next" ${page >= data.totalPages ? 'disabled' : ''}>下一頁</button>
                  </div>`
                : ''
            }
          `
      }
    </div>
  `;

  $('#audit-filter-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    state.auditListQuery = {
      q: String(fd.get('q') || '').trim(),
      category: String(fd.get('category') || '').trim(),
      dateFrom: String(fd.get('dateFrom') || '').trim(),
      dateTo: String(fd.get('dateTo') || '').trim(),
      page: 1,
    };
    renderAuditLogs(body);
  });
  $('#btn-audit-clear')?.addEventListener('click', (e) => {
    e.preventDefault();
    state.auditListQuery = {};
    renderAuditLogs(body);
  });
  $('#btn-audit-prev')?.addEventListener('click', () => {
    if (page > 1) {
      state.auditListQuery = { ...state.auditListQuery, page: page - 1 };
      renderAuditLogs(body);
    }
  });
  $('#btn-audit-next')?.addEventListener('click', () => {
    if (page < data.totalPages) {
      state.auditListQuery = { ...state.auditListQuery, page: page + 1 };
      renderAuditLogs(body);
    }
  });
  $('#btn-audit-export')?.addEventListener('click', async () => {
    try {
      const blob = await api(`/api/system/audit-logs/export?${params.toString()}`, {
        expectBlob: true,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}
