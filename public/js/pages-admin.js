/**
 * 管理／帳號／系統設定頁面（從 app.js 抽出）
 * 依賴 app.js 掛到 window 的全域：state、$、api、esc、toast、navigate…
 */
async function renderUsers(body) {
  const canFull = isAdmin();
  const canLabor = hasPerm('users_leave');
  if (!canLabor) {
    body.innerHTML = emptyState({
      title: '無權限',
      desc: '需「成員休假已休管理」權限或系統管理員，才可查看成員名單。',
      actions: [{ label: '回總覽', go: 'dashboard', outline: true }],
    });
    bindDataGo(body);
    return;
  }
  const canEdit = canFull; // 完整管理（新增／刪除／權限／密碼）
  // 特休／年資：有 users_leave 或管理員
  const data = await api('/api/users?labor=1');
  const users = data.users || [];
  state.users = users;
  const defs = data.permissionDefs || [
    { id: 'workflows', label: PERM_LABEL.workflows },
    { id: 'backups', label: PERM_LABEL.backups },
    { id: 'records_all', label: PERM_LABEL.records_all },
    { id: 'leave_report', label: PERM_LABEL.leave_report },
    { id: 'users_leave', label: PERM_LABEL.users_leave },
  ];
  state.permissionDefs = defs;

  if (canFull) {
    $('#page-actions').innerHTML = `
      <button type="button" class="btn outline" id="btn-tpl-user">下載範本</button>
      <button type="button" class="btn outline" id="btn-import-user">Excel 匯入</button>
      <button type="button" class="btn outline" id="btn-export-all-user">匯出全部</button>
      <button type="button" class="btn primary" id="btn-add-user">＋ 新增成員</button>
      <input type="file" id="user-import-file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" class="hidden" />
    `;
  } else {
    $('#page-actions').innerHTML = `
      <span class="muted" style="font-size:0.88rem">您可查看成員並編輯<strong>可休／已休</strong>（特休以日計；其他假別可填小時）</span>
    `;
  }

  const laborCell = (u) => {
    const L = u.labor;
    const sl = L?.specialLeave;
    if (!L) {
      return `<span class="muted" style="font-size:0.82rem">尚無休假資料</span>`;
    }
    return `
      <div style="font-size:0.85rem;line-height:1.45">
        ${L.hireDate ? `<div>到職：${esc(L.hireDate)}${L.seniority?.label ? ` · ${esc(L.seniority.label)}` : ''}</div>` : `<div class="muted">到職日未設定</div>`}
        ${
          sl
            ? `<div>特休可休 <strong>${sl.entitled ?? 0}</strong> 日（手動）</div>
               <div>已休 ${sl.used ?? 0} 日
                 ${
                   sl.manualUsedDays
                     ? `<span class="muted">（手動 ${sl.manualUsedDays || 0} 日${
                         sl.systemUsed ? `＋系統 ${sl.systemUsed} 日` : ''
                       }）</span>`
                     : sl.systemUsed
                       ? `<span class="muted">（系統 ${sl.systemUsed} 日）</span>`
                       : ''
                 }
               </div>
               <div>剩餘 <strong style="color:${
                 (sl.remaining ?? 0) > 0 ? '#15803d' : '#b45309'
               }">${sl.remaining ?? 0}</strong> 日</div>
               <div class="muted" style="font-size:0.78rem">${esc(sl.yearLabel || '')} · 特休以日計</div>`
            : `<div class="muted">請於編輯設定各假別可休天數</div>`
        }
      </div>`;
  };

  body.innerHTML = `
    <div class="card">
      <p class="muted" style="margin-top:0">
        目前成員 <strong>${users.length}</strong> 人。
        ${
          canLabor
            ? `各假別<strong>可休天數一律手動設定</strong>（不依年資自動計算）。
        統計年度採<strong>曆年制</strong>（每年 1/1～12/31）。
        剩餘＝可休 −（<strong>手動已休</strong>＋系統已核准）。
        <strong>特休以日計算</strong>（不顯示小時）。
        ${
          canFull
            ? '管理員可於「編輯資料」填寫各假別可休與已休天數。'
            : '您可使用「編輯已休」填寫各假別可休與已休。'
        }`
            : ''
        }
      </p>
      ${
        canFull
          ? `<div class="form-actions" style="margin-bottom:12px;flex-wrap:wrap">
              <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
                <input type="checkbox" id="chk-all-users" /> 全選
              </label>
              <button type="button" class="btn outline sm" id="btn-export-selected">匯出選取</button>
              <button type="button" class="btn outline sm" id="btn-export-selected-pwd">匯出選取（重設密碼）</button>
              <button type="button" class="btn danger sm" id="btn-bulk-del">刪除選取</button>
              <span class="muted" id="sel-count">已選 0 人</span>
            </div>`
          : ''
      }
      <div class="table-wrap">
        <table class="data" style="width:100%;min-width:880px;table-layout:fixed">
          <thead>
            <tr>
              ${canFull ? '<th style="width:36px;text-align:center"></th>' : ''}
              <th style="width:110px;white-space:nowrap">姓名</th>
              <th style="width:120px;white-space:nowrap">帳號</th>
              <th style="width:130px">部門</th>
              ${canLabor ? '<th style="min-width:180px">休假（可休／已休／剩餘）</th>' : ''}
              <th style="min-width:160px">角色／權限</th>
              <th style="width:160px;text-align:center;white-space:nowrap">操作</th>
            </tr>
          </thead>
          <tbody>
            ${users
              .map(
                (u) => `
              <tr data-user-row="${u.id}">
                ${
                  canFull
                    ? `<td>
                        <input type="checkbox" data-user-check value="${u.id}"
                          ${
                            u.id === state.user?.id || isBuiltinAdminUser(u)
                              ? 'disabled title="' +
                                (isBuiltinAdminUser(u) ? '內建 Admin 不可刪除' : '不可選取自己') +
                                '"'
                              : ''
                          } />
                      </td>`
                    : ''
                }
                <td><strong>${esc(u.name)}</strong></td>
                <td>${esc(u.username)}</td>
                <td>
                  ${esc(u.department || '—')}
                  ${
                    u.departments && u.departments.length > 1
                      ? `<div class="muted" style="font-size:0.8rem">${esc(u.departments.join('、'))}</div>`
                      : ''
                  }
                </td>
                ${canLabor ? `<td style="white-space:normal;word-break:break-word">${laborCell(u)}</td>` : ''}
                <td style="white-space:normal;word-break:break-word">
                  ${
                    u.role === 'admin'
                      ? '<span class="tag draft">最高權限 · 系統管理員</span>'
                      : `<span class="tag">一般使用者</span>
                         <div class="muted" style="font-size:0.82rem;margin-top:4px">${esc(formatPerms(u))}</div>`
                  }
                </td>
                <td>
                  <div style="display:flex;flex-wrap:wrap;gap:6px">
                    ${
                      canFull
                        ? `<button type="button" class="btn sm primary" data-edit-user="${u.id}">編輯資料</button>`
                        : canLabor
                          ? `<button type="button" class="btn sm primary" data-edit-leave="${u.id}">編輯已休</button>`
                          : ''
                    }
                    ${
                      canLabor
                        ? `<button type="button" class="btn sm outline" data-labor-user="${u.id}">休假明細</button>`
                        : ''
                    }
                    ${
                      canFull
                        ? `<button type="button" class="btn sm outline" data-perm-edit="${u.id}"
                            ${isBuiltinAdminUser(u) && !isBuiltinAdmin() ? 'disabled' : ''}>權限</button>
                          <button type="button" class="btn sm outline" data-reset-pw="${u.id}">密碼</button>
                          ${
                            u.id === state.user?.id || isBuiltinAdminUser(u)
                              ? isBuiltinAdminUser(u)
                                ? '<span class="muted" style="font-size:0.78rem">內建帳號不可刪</span>'
                                : ''
                              : `<button type="button" class="btn sm danger" data-del-user="${u.id}">刪除</button>`
                          }`
                        : ''
                    }
                  </div>
                </td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </div>`;

  // 休假明細：管理員與休假權限皆可
  body.querySelectorAll('[data-labor-user]').forEach((btn) => {
    btn.onclick = async () => {
      try {
        const data = await api(`/api/users/${btn.dataset.laborUser}/labor`);
        openLaborDetailModal(data.user, data.labor);
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  });
  // 僅休假權限：編輯手動已休
  body.querySelectorAll('[data-edit-leave]').forEach((btn) => {
    btn.onclick = () => {
      const u = users.find((x) => x.id === Number(btn.dataset.editLeave));
      if (u) openUserLeaveEditor(u);
    };
  });

  if (!canFull) return;

  const updateSelCount = () => {
    const n = getSelectedUserIds(body).length;
    const el = $('#sel-count');
    if (el) el.textContent = `已選 ${n} 人`;
  };

  const addBtn = $('#btn-add-user');
  if (addBtn) addBtn.onclick = () => openAddUserModal(defs);

  $('#btn-tpl-user')?.addEventListener('click', async () => {
    try {
      const blob = await api('/api/users/export-template', { expectBlob: true });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = '成員名單_匯入範本.xlsx';
      a.click();
      URL.revokeObjectURL(url);
      toast('已下載範本', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  $('#btn-export-all-user')?.addEventListener('click', async () => {
    try {
      const reset = confirm(
        '是否在匯出時重設密碼並寫入 Excel？\n\n「確定」＝為每位成員產生隨機密碼並寫入密碼欄\n「取消」＝僅匯出名單，密碼欄空白（保留原密碼）'
      );
      await downloadUsersExcel([], { resetPasswords: reset });
      toast('已匯出全部成員', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  $('#btn-export-selected')?.addEventListener('click', async () => {
    const ids = getSelectedUserIds(body);
    if (!ids.length) {
      toast('請先勾選要匯出的成員', 'error');
      return;
    }
    try {
      await downloadUsersExcel(ids, { resetPasswords: false });
      toast(`已匯出 ${ids.length} 人`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  $('#btn-export-selected-pwd')?.addEventListener('click', async () => {
    const ids = getSelectedUserIds(body);
    if (!ids.length) {
      toast('請先勾選要匯出的成員', 'error');
      return;
    }
    if (
      !confirm(
        `確定重設並匯出 ${ids.length} 人的密碼？\n（每人一組隨機密碼，將寫入 Excel）`
      )
    ) {
      return;
    }
    try {
      await downloadUsersExcel(ids, { resetPasswords: true });
      toast(`已重設並匯出 ${ids.length} 人`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  $('#btn-import-user')?.addEventListener('click', () => $('#user-import-file')?.click());
  $('#user-import-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      const data = await api('/api/users/import', { method: 'POST', body: fd });
      toast(data.message || '匯入完成', 'success');
      if (data.errors?.length) {
        console.warn('import errors', data.errors);
        alert(`部分列有問題：\n${data.errors.slice(0, 12).join('\n')}`);
      }
      navigate('users');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  $('#chk-all-users')?.addEventListener('change', (e) => {
    body.querySelectorAll('input[data-user-check]:not(:disabled)').forEach((c) => {
      c.checked = e.target.checked;
    });
    updateSelCount();
  });
  body.querySelectorAll('input[data-user-check]').forEach((c) => {
    c.onchange = updateSelCount;
  });

  $('#btn-bulk-del')?.addEventListener('click', async () => {
    const ids = getSelectedUserIds(body);
    if (!ids.length) {
      toast('請先勾選要刪除的成員', 'error');
      return;
    }
    const names = ids
      .map((id) => users.find((u) => u.id === id))
      .filter(Boolean)
      .map((u) => `${u.name}（${u.username}）`)
      .slice(0, 15);
    if (
      !confirm(
        `確定刪除選取的 ${ids.length} 位成員？\n\n${names.join('\n')}${ids.length > 15 ? '\n…' : ''}\n\n刪除後無法登入（歷史簽核紀錄仍保留）。`
      )
    ) {
      return;
    }
    try {
      const data = await api('/api/users/bulk-delete', {
        method: 'POST',
        body: { ids },
      });
      toast(data.message || '已批次刪除', 'success');
      navigate('users');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  body.querySelectorAll('[data-edit-user]').forEach((btn) => {
    btn.onclick = () => {
      const u = users.find((x) => x.id === Number(btn.dataset.editUser));
      if (u) openMemberEditor(u, defs);
    };
  });
  body.querySelectorAll('[data-labor-user]').forEach((btn) => {
    btn.onclick = async () => {
      try {
        const data = await api(`/api/users/${btn.dataset.laborUser}/labor`);
        openLaborDetailModal(data.user, data.labor);
      } catch (e) {
        toast(e.message, 'error');
      }
    };
  });

  body.querySelectorAll('[data-perm-edit]').forEach((btn) => {
    btn.onclick = () => {
      const u = users.find((x) => x.id === Number(btn.dataset.permEdit));
      if (u) openUserPermissionEditor(u, defs);
    };
  });

  body.querySelectorAll('[data-reset-pw]').forEach((btn) => {
    btn.onclick = () => {
      const u = users.find((x) => x.id === Number(btn.dataset.resetPw));
      if (u) openAdminResetPasswordModal(u);
    };
  });

  body.querySelectorAll('[data-del-user]').forEach((btn) => {
    btn.onclick = async () => {
      const id = Number(btn.dataset.delUser);
      const u = users.find((x) => x.id === id);
      if (!u) return;
      if (
        !confirm(
          `確定刪除成員「${u.name}」（${u.username}）？\n刪除後無法以此帳號登入（歷史簽核紀錄仍會保留姓名）。`
        )
      ) {
        return;
      }
      try {
        await api(`/api/users/${id}`, { method: 'DELETE' });
        toast('已刪除成員', 'success');
        navigate('users');
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  });
}

/**
 * 系統進階稽核日誌 (P3-1)
 */
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
  };

  const exportUrl = `/api/system/audit-logs/export?${params.toString()}`;

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
          <a href="${exportUrl}" download class="btn outline sm" style="display:inline-flex;align-items:center;gap:4px">
            📥 匯出 CSV 報告
          </a>
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
                        <span class="tag draft" style="font-size:0.75rem;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block;vertical-align:middle" title="${esc(categoryLabels[l.category] || l.category || '一般')}">${esc(categoryLabels[l.category] || l.category || '一般')}</span>
                      </td>
                      <td style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(l.user_name || '系統/訪客')}${l.user_username ? ` (@${esc(l.user_username)})` : ''}">
                        <strong>${esc(l.user_name || '系統/訪客')}</strong>
                        ${l.user_username ? `<span class="muted" style="font-size:0.78rem">(@${esc(l.user_username)})</span>` : ''}
                      </td>
                      <td style="white-space:nowrap"><code style="display:inline-block;max-width:100%;overflow:hidden;text-overflow:ellipsis;vertical-align:middle" title="${esc(l.ip_address || '127.0.0.1')}">${esc(l.ip_address || '127.0.0.1')}</code></td>
                      <td style="white-space:normal;word-break:break-word;line-height:1.5;color:#334155">${esc(l.description)}</td>
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
}

/**
 * 畫面動態防偽浮水印（依需求：僅套用到 PDF，畫面網頁不顯示）
 */
function updateAppWatermark() {
  const overlay = document.getElementById('app-watermark-overlay');
  if (overlay) overlay.remove();
}

/** 休假明細（可休／已休皆手動） */
/**
 * 僅編輯到職日 + 各假別可休／已休（給「成員休假已休管理」權限使用）
 */
function openUserLeaveEditor(user) {
  const hireVal = user.hire_date || user.labor?.hireDate || '';
  openModal(`
    <h3>編輯休假設定 — ${esc(user.name)}</h3>
    <p class="muted" style="margin-top:0">帳號：${esc(user.username)}　部門：${esc(user.department || '—')}</p>
    <form id="leave-edit-form" class="form-grid">
      <div class="field">
        <label>到職日（選填）</label>
        <input name="hire_date" type="date" value="${esc(hireVal)}" />
        <div class="muted" style="font-size:0.8rem;margin-top:4px">僅供顯示；可休日數不依年資計算</div>
      </div>
      ${renderManualLeaveUsedFields(user)}
      <div class="form-actions">
        <button type="submit" class="btn primary">儲存休假設定</button>
        <button type="button" class="btn outline" data-close-modal>取消</button>
      </div>
    </form>
  `);
  $('#modal-panel')?.classList.add('wide');
  $('#leave-edit-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const leavePayload = collectLeaveUsedFromForm(fd);
    try {
      await api(`/api/users/${user.id}`, {
        method: 'PUT',
        body: {
          hire_date: String(fd.get('hire_date') || '').trim(),
          leave_used: leavePayload.leave_used,
          leave_entitled: leavePayload.leave_entitled,
          sl_used_days: leavePayload.sl_used_days,
          sl_used_hours: leavePayload.sl_used_hours,
        },
      });
      closeModal();
      toast('休假可休／已休已更新', 'success');
      navigate('users');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

function openLaborDetailModal(user, laborInfo) {
  const L = laborInfo || user?.labor || {};
  const sl = L.specialLeave;
  const balances = Array.isArray(L.leaveBalances) ? L.leaveBalances : [];
  const balanceRows = balances
    .map((b) => {
      const remColor =
        b.remaining == null
          ? '#64748b'
          : b.remaining < 0
            ? '#b91c1c'
            : b.remaining === 0
              ? '#b45309'
              : '#15803d';
      const usedDetail =
        b.used != null
          ? `${b.used} 日${
              b.canTrackManual || b.manualUsed != null || b.systemUsed != null
                ? `<div class="muted" style="font-size:0.72rem;font-weight:400">手動 ${b.manualUsed ?? 0} ＋ 系統 ${b.systemUsed ?? 0}</div>`
                : ''
            }`
          : '—';
      return `<tr>
        <td>
          <div style="font-weight:600">${esc(b.name)}</div>
          <div class="muted" style="font-size:0.75rem;line-height:1.35;margin-top:2px">${esc(b.law || '')}</div>
          ${b.note ? `<div class="muted" style="font-size:0.72rem;margin-top:2px">${esc(b.note)}</div>` : ''}
        </td>
        <td style="text-align:right;white-space:nowrap">${esc(b.entitledLabel || '—')}</td>
        <td style="text-align:right;white-space:nowrap">${usedDetail}</td>
        <td style="text-align:right;white-space:nowrap;font-weight:600;color:${remColor}">${esc(b.remainingLabel || '—')}</td>
      </tr>`;
    })
    .join('');

  // 優先使用「全部假別」單號明細；舊資料才回退特休 usedDetails
  const allDetails =
    Array.isArray(L.leaveUsedDetails) && L.leaveUsedDetails.length
      ? L.leaveUsedDetails
      : sl?.usedDetails || [];
  const usedRows = allDetails
    .map(
      (d) =>
        `<tr>
          <td><a href="#/detail/${d.requestId}" class="linkish" data-open-request="${d.requestId}">#${d.requestId}</a></td>
          <td>${esc(d.leaveType || '—')}</td>
          <td>${esc(d.start || '')}${d.end && d.end !== d.start ? ` ～ ${esc(d.end)}` : ''}</td>
          <td style="text-align:right">${d.days != null ? d.days : '—'}</td>
        </tr>`
    )
    .join('');

  openModal(`
    <h3>休假明細 — ${esc(user?.name || '')}</h3>
    <div class="kv" style="margin-bottom:12px">
      <dt>到職日</dt><dd>${esc(L.hireDate || '未設定')}（僅供參考）</dd>
      <dt>年資</dt><dd>${esc(L.seniority?.label || '—')}（不影響可休日數）</dd>
      ${
        sl
          ? `
      <dt>統計年度</dt><dd>${esc(sl.yearLabel || L.leaveBalanceYearLabel || '—')}</dd>
      <dt>特休可休</dt><dd><strong>${sl.entitled ?? 0}</strong> 日（<strong>手動設定</strong>，以日計）</dd>
      <dt>手動已休</dt><dd>${sl.manualUsedDays ?? 0} 日</dd>
      <dt>系統已休</dt><dd>${sl.systemUsed ?? 0} 日（本年度已核准特休）</dd>
      <dt>合計已休</dt><dd>${sl.used} 日</dd>
      <dt>剩餘特休</dt><dd><strong style="color:${(sl.remaining ?? 0) > 0 ? '#15803d' : '#b45309'}">${sl.remaining ?? 0}</strong> 日</dd>
      `
          : `<dt>說明</dt><dd class="muted">${esc(L.note || '請於編輯設定各假別可休天數')}</dd>`
      }
    </div>
    ${
      balanceRows
        ? `<h4 style="margin:12px 0 6px;font-size:0.95rem">各假別可休／已休／剩餘（全部手動可休）</h4>
           <p class="muted" style="margin:0 0 8px;font-size:0.82rem">統計年度：${esc(L.leaveBalanceYearLabel || sl?.yearLabel || '本年度')}；可休由成員名單手動設定；已休＝手動已休＋本系統已核准請假；特休以日計</p>
           <div class="table-wrap"><table class="data">
           <thead><tr>
             <th style="min-width:160px">假別</th>
             <th style="text-align:right">可休（手動）</th>
             <th style="text-align:right">本年度已休</th>
             <th style="text-align:right">剩餘</th>
           </tr></thead>
           <tbody>${balanceRows}</tbody></table></div>`
        : ''
    }
    ${
      usedRows
        ? `<h4 style="margin:16px 0 6px;font-size:0.95rem">休假明細（系統已核准 · 各假別單號）</h4>
           <div class="table-wrap"><table class="data">
           <thead><tr><th>單號</th><th>假別</th><th>起迄</th><th>天數</th></tr></thead>
           <tbody>${usedRows}</tbody></table></div>`
        : `<p class="muted" style="font-size:0.9rem;margin-top:12px">本年度尚無已核准之請假申請（系統）。</p>`
    }
    <p class="muted" style="font-size:0.8rem;margin-top:12px;line-height:1.5">
      <strong>說明</strong>：各假別<strong>可休日數一律由人事於成員名單手動填寫</strong>，系統<strong>不再依年資</strong>自動計算特休。
      已休＝手動已休＋本系統已核准請假；統計年度為曆年制（1/1～12/31）；<strong>特休以日計算，不換算小時</strong>。
    </p>
    <div class="form-actions">
      <button type="button" class="btn outline" data-close-modal>關閉</button>
    </div>
  `);
  $('#modal-panel')?.classList.add('wide');
  // 單號可點擊開啟申請詳情
  $('#modal-panel')?.querySelectorAll('[data-open-request]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const id = Number(el.dataset.openRequest);
      if (!id) return;
      closeModal();
      navigate('detail', { id });
    });
  });
}

/** 系統管理員編輯成員完整資料（含帳號） */
async function openMemberEditor(user, defs) {
  if (!state.departments?.length) {
    try {
      await loadDepartmentOptions();
    } catch {
      /* ignore */
    }
  }
  const depts = state.departments || [];
  const userDepts = new Set(user.departments || (user.department ? [user.department] : []));
  const perms = new Set(user.permissions || []);
  const hireVal = user.hire_date || user.labor?.hireDate || '';
  const sl = user.labor?.specialLeave;

  const builtin = isBuiltinAdminUser(user);
  openModal(`
    <h3>編輯成員 — ${esc(user.name)}${builtin ? ' <span class="muted" style="font-size:0.85rem">（系統內建 Admin）</span>' : ''}</h3>
    <form id="edit-member-form" class="form-grid">
      <div class="form-grid two">
        <div class="field">
          <label>帳號 *</label>
          <input name="username" required minlength="3" value="${esc(user.username)}" autocomplete="off"
            ${builtin ? 'readonly disabled' : ''} />
          ${
            builtin
              ? '<div class="muted" style="font-size:0.78rem;margin-top:4px">內建 Admin 帳號名稱鎖定，不可修改；可於下方重設密碼</div>'
              : ''
          }
        </div>
        <div class="field">
          <label>姓名 *</label>
          <input name="name" required value="${esc(user.name)}" />
        </div>
      </div>
      <div class="form-grid two">
        <div class="field">
          <label>Email</label>
          <input name="email" type="email" value="${esc(user.email || '')}" />
        </div>
        <div class="field">
          <label>到職日（選填）</label>
          <input name="hire_date" type="date" value="${esc(hireVal)}" />
          <div class="muted" style="font-size:0.8rem;margin-top:4px">僅供顯示；可休日數不依年資計算</div>
        </div>
      </div>
      ${renderManualLeaveUsedFields(user)}
      <div class="form-grid two">
        <div class="field">
          <label>電話 / 分機</label>
          <div style="display:flex;gap:8px">
            <input name="phone" value="${esc(user.phone || '')}" placeholder="電話" style="flex:1" />
            <input name="extension" value="${esc(user.extension || '')}" placeholder="分機" style="width:90px" />
          </div>
        </div>
        <div class="field">
          ${
            sl
              ? `<label>特休餘額（儲存後更新）</label>
                 <div style="font-size:0.9rem;padding:8px 0;line-height:1.5">
                   可休 <strong>${sl.entitled ?? 0}</strong> 日（手動）<br/>
                   已休 ${sl.used ?? 0} 日
                   <span class="muted">（手動＋系統）</span><br/>
                   剩餘 <strong style="color:${(sl.remaining ?? 0) > 0 ? '#15803d' : '#b45309'}">${sl.remaining ?? 0}</strong> 日
                   <div class="muted" style="font-size:0.78rem;margin-top:2px">特休以日計算，不換算小時</div>
                 </div>`
              : `<label class="muted">特休餘額</label>
                 <div class="muted" style="font-size:0.85rem;padding:8px 0">請於上方填寫「可休天數」後儲存</div>`
          }
        </div>
      </div>
      <div class="field">
        <label>主部門</label>
        <select name="department">
          <option value="">（未指定）</option>
          ${depts
            .map(
              (d) =>
                `<option value="${esc(d.name)}" ${user.department === d.name ? 'selected' : ''}>${esc(d.name)}</option>`
            )
            .join('')}
        </select>
      </div>
      <div class="field">
        <label>隸屬部門（可多選）</label>
        <div class="approver-list" style="margin-top:8px;max-height:160px">
          ${depts
            .map(
              (d) => `
            <label>
              <input type="checkbox" name="dept" value="${esc(d.name)}"
                ${userDepts.has(d.name) ? 'checked' : ''} />
              ${esc(d.name)}
            </label>`
            )
            .join('') || '<span class="muted">尚無部門</span>'}
        </div>
      </div>
      <div class="field">
        <label>權限等級</label>
        <select name="role" id="edit-member-role" ${builtin ? 'disabled' : ''}>
          <option value="user" ${user.role !== 'admin' ? 'selected' : ''}>一般使用者</option>
          <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>最高權限（系統管理員）</option>
        </select>
        ${builtin ? '<div class="muted" style="font-size:0.78rem;margin-top:4px">內建 Admin 固定為系統管理員</div>' : ''}
      </div>
      <div class="field" id="edit-perm-wrap">
        <label>一般使用者額外權限</label>
        <div class="approver-list" style="margin-top:8px">
          ${(defs || [])
            .map(
              (p) => `
            <label>
              <input type="checkbox" name="perm" value="${esc(p.id)}"
                ${perms.has(p.id) || user.role === 'admin' ? 'checked' : ''} />
              ${esc(p.label)}
            </label>`
            )
            .join('')}
        </div>
      </div>
      <div class="field">
        <label>重設密碼（選填）</label>
        <input name="password" type="password" minlength="6" autocomplete="new-password"
          placeholder="空白＝不變更密碼；填寫則重設（至少 6 字元）" />
      </div>
      <div class="form-actions">
        <button type="submit" class="btn primary">儲存</button>
        <button type="button" class="btn outline" data-close-modal>取消</button>
      </div>
    </form>
  `);
  $('#modal-panel')?.classList.add('wide');

  const roleSel = $('#edit-member-role');
  const syncPerm = () => {
    const isAdm = roleSel?.value === 'admin';
    $$('#edit-perm-wrap input[name=perm]').forEach((cb) => {
      cb.disabled = isAdm;
      if (isAdm) cb.checked = true;
    });
  };
  if (roleSel) roleSel.onchange = syncPerm;
  syncPerm();

  $('#edit-member-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const role = fd.get('role') || 'user';
    const departments = [...document.querySelectorAll('#edit-member-form input[name=dept]:checked')].map(
      (c) => c.value
    );
    const permissions =
      role === 'admin'
        ? []
        : [...document.querySelectorAll('#edit-perm-wrap input[name=perm]:checked')].map(
            (c) => c.value
          );
    const password = String(fd.get('password') || '').trim();
    const leavePayload = collectLeaveUsedFromForm(fd);
    const body = {
      // 內建 Admin 不送帳號變更（欄位 disabled 時 FormData 可能沒有值）
      username: isBuiltinAdminUser(user)
        ? user.username
        : formatUsername(fd.get('username')),
      name: String(fd.get('name') || '').trim(),
      email: String(fd.get('email') || '').trim(),
      phone: String(fd.get('phone') || '').trim(),
      extension: String(fd.get('extension') || '').trim(),
      hire_date: String(fd.get('hire_date') || '').trim(),
      leave_used: leavePayload.leave_used,
      leave_entitled: leavePayload.leave_entitled,
      sl_used_days: leavePayload.sl_used_days,
      sl_used_hours: leavePayload.sl_used_hours,
      department: String(fd.get('department') || '').trim(),
      departments,
      role: isBuiltinAdminUser(user) ? 'admin' : role,
      permissions: isBuiltinAdminUser(user) ? [] : permissions,
    };
    if (password) body.password = password;
    try {
      const data = await api(`/api/users/${user.id}`, { method: 'PUT', body });
      if (user.id === state.user?.id) {
        const { user: me } = await api('/api/auth/me');
        state.user = me;
        applyRoleUi();
        if (data.selfUsernameChanged) {
          toast(`帳號已改為 ${data.selfUsernameChanged}，請記得使用新帳號登入`, 'success');
        }
      }
      closeModal();
      toast('成員資料已更新', 'success');
      navigate('users');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

async function openAddUserModal(defs) {
  if (!state.departments?.length) {
    try {
      await loadDepartmentOptions();
    } catch {
      /* ignore */
    }
  }
  const depts = state.departments || [];
  openModal(`
    <h3>新增成員</h3>
    <form id="add-user-form" class="form-grid">
      <div class="field">
        <label>帳號 *</label>
        <input name="username" required minlength="3" placeholder="至少 3 字元；顯示首字母大寫，登入不分大小寫" autocomplete="off" />
      </div>
      <div class="field">
        <label>姓名 *</label>
        <input name="name" required placeholder="顯示名稱" />
      </div>
      <div class="field">
        <label>到職日</label>
        <input name="hire_date" type="date" />
        <div class="muted" style="font-size:0.8rem;margin-top:4px">選填；僅供顯示年資，可休日數不依年資計算</div>
      </div>
      ${renderManualLeaveUsedFields(null)}
      <div class="field">
        <label>密碼 *</label>
        <input name="password" type="password" required minlength="6" placeholder="至少 6 字元" autocomplete="new-password" />
      </div>
      <div class="field">
        <label>部門</label>
        <select name="department">
          <option value="">請選擇部門…</option>
          ${depts.map((d) => `<option value="${esc(d.name)}">${esc(d.name)}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label>Email</label>
        <input name="email" type="email" placeholder="選填" />
      </div>
      <div class="field">
        <label>權限等級</label>
        <select name="role" id="add-user-role">
          <option value="user" selected>一般使用者</option>
          <option value="admin">最高權限（系統管理員）</option>
        </select>
      </div>
      <div class="field" id="add-perm-wrap">
        <label>一般使用者額外權限</label>
        <div class="approver-list" style="margin-top:8px">
          ${(defs || [])
            .map(
              (p) => `
            <label>
              <input type="checkbox" name="perm" value="${esc(p.id)}" />
              <span>${esc(p.label)}</span>
            </label>`
            )
            .join('')}
        </div>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn primary">建立成員</button>
        <button type="button" class="btn outline" data-close-modal>取消</button>
      </div>
    </form>
  `);

  const roleSel = $('#add-user-role');
  const sync = () => {
    const isAdm = roleSel.value === 'admin';
    $$('#add-perm-wrap input[name=perm]').forEach((cb) => {
      cb.disabled = isAdm;
      if (isAdm) cb.checked = false;
    });
  };
  if (roleSel) roleSel.onchange = sync;
  sync();
  $('#modal-panel')?.classList.add('wide');

  $('#add-user-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const role = fd.get('role') || 'user';
    const permissions =
      role === 'admin'
        ? []
        : [...document.querySelectorAll('#add-perm-wrap input[name=perm]:checked')].map(
            (c) => c.value
          );
    try {
      const leavePayload = collectLeaveUsedFromForm(fd);
      await api('/api/users', {
        method: 'POST',
        body: {
          username: formatUsername(fd.get('username')),
          name: fd.get('name'),
          password: fd.get('password'),
          department: fd.get('department') || '',
          email: fd.get('email') || '',
          hire_date: fd.get('hire_date') || '',
          leave_used: leavePayload.leave_used,
          leave_entitled: leavePayload.leave_entitled,
          sl_used_days: leavePayload.sl_used_days,
          sl_used_hours: leavePayload.sl_used_hours,
          role,
          permissions,
        },
      });
      closeModal();
      toast('成員已新增', 'success');
      navigate('users');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

/** 系統管理員修改任一成員密碼 */
function openAdminResetPasswordModal(user) {
  openModal(`
    <h3>修改密碼 — ${esc(user.name)}</h3>
    <p class="muted" style="margin-top:0">
      帳號：<strong>${esc(user.username)}</strong>
      　部門：${esc(user.department || '—')}<br/>
      系統管理員可直接設定新密碼，不需對方舊密碼。修改後請通知對方以新密碼登入。
    </p>
    <form id="admin-reset-pw-form" class="form-grid">
      <div class="field">
        <label>新密碼 *</label>
        <input name="password" type="password" required minlength="6" autocomplete="new-password"
          placeholder="至少 6 字元" />
      </div>
      <div class="field">
        <label>確認新密碼 *</label>
        <input name="confirmPassword" type="password" required minlength="6" autocomplete="new-password"
          placeholder="再輸入一次" />
      </div>
      <div class="form-actions">
        <button type="submit" class="btn primary">儲存密碼</button>
        <button type="button" class="btn outline" data-close-modal>取消</button>
      </div>
    </form>
  `);

  $('#admin-reset-pw-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const password = String(fd.get('password') || '');
    const confirmPassword = String(fd.get('confirmPassword') || '');
    if (password.length < 6) {
      toast('新密碼至少 6 字元', 'error');
      return;
    }
    if (password !== confirmPassword) {
      toast('兩次輸入的密碼不一致', 'error');
      return;
    }
    try {
      const data = await api(`/api/users/${user.id}/password`, {
        method: 'PUT',
        body: { password, confirmPassword },
      });
      closeModal();
      toast(data.message || `已更新「${user.name}」的密碼`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

function openUserPermissionEditor(user, defs) {
  const isSelf = user.id === state.user?.id;
  const perms = new Set(user.permissions || []);
  openModal(`
    <h3>設定權限 — ${esc(user.name)}</h3>
    <p class="muted" style="margin-top:0">帳號：${esc(user.username)}　部門：${esc(user.department || '—')}</p>
    <form id="perm-form" class="form-grid">
      <div class="field" style="text-align:left">
        <label style="text-align:left">權限等級 *</label>
        <div id="role-level-list" style="margin-top:8px;display:flex;flex-direction:column;flex-wrap:nowrap;align-items:stretch;justify-content:flex-start;gap:10px;text-align:left">
          <label style="display:flex;align-items:flex-start;justify-content:flex-start;gap:10px;border:1px solid var(--border);border-radius:10px;padding:12px;cursor:pointer;background:#f8fafc;margin:0;width:100%;box-sizing:border-box;text-align:left;white-space:normal">
            <input type="radio" name="role_level" value="admin" ${user.role === 'admin' ? 'checked' : ''}
              style="margin:3px 0 0;flex-shrink:0;width:16px;height:16px" />
            <span style="flex:1;min-width:0;text-align:left">
              <strong style="color:#1e3a5f;display:block;line-height:1.35;text-align:left">最高權限（系統管理員）</strong>
              <span class="muted" style="display:block;font-size:0.85rem;margin-top:6px;line-height:1.45;text-align:left;white-space:normal">
                可管理簽核流程、備份資料、成員權限、查看全部紀錄等全部功能。
              </span>
            </span>
          </label>
          <label style="display:flex;align-items:flex-start;justify-content:flex-start;gap:10px;border:1px solid var(--border);border-radius:10px;padding:12px;cursor:pointer;background:#f8fafc;margin:0;width:100%;box-sizing:border-box;text-align:left;white-space:normal">
            <input type="radio" name="role_level" value="user" ${user.role !== 'admin' ? 'checked' : ''}
              style="margin:3px 0 0;flex-shrink:0;width:16px;height:16px" />
            <span style="flex:1;min-width:0;text-align:left">
              <strong style="display:block;line-height:1.35;text-align:left">一般使用者</strong>
              <span class="muted" style="display:block;font-size:0.85rem;margin-top:6px;line-height:1.45;text-align:left;white-space:normal">
                僅本人簽核相關功能；可再勾選下方額外權限。
              </span>
            </span>
          </label>
        </div>
      </div>
      <div class="field" id="perm-checks-wrap">
        <label>一般使用者的額外功能權限</label>
        <div class="approver-list" style="margin-top:8px">
          ${defs
            .map(
              (p) => `
            <label>
              <input type="checkbox" name="perm" value="${esc(p.id)}"
                ${perms.has(p.id) || user.role === 'admin' ? 'checked' : ''}
                ${user.role === 'admin' ? 'disabled' : ''} />
              <span><strong>${esc(p.label)}</strong>
                ${p.description ? `<span class="muted"> — ${esc(p.description)}</span>` : ''}
              </span>
            </label>`
            )
            .join('')}
        </div>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn primary">儲存</button>
        <button type="button" class="btn outline" data-close-modal>取消</button>
      </div>
    </form>
  `);

  const syncChecks = () => {
    const isAdm = document.querySelector('input[name=role_level]:checked')?.value === 'admin';
    $$('#perm-checks-wrap input[name=perm]').forEach((cb) => {
      cb.disabled = isAdm;
      if (isAdm) cb.checked = true;
    });
  };
  $$('input[name=role_level]').forEach((r) => {
    r.onchange = syncChecks;
  });
  syncChecks();

  $('#perm-form').onsubmit = async (e) => {
    e.preventDefault();
    const role = document.querySelector('input[name=role_level]:checked')?.value || 'user';
    const permissions =
      role === 'admin'
        ? []
        : [...document.querySelectorAll('#perm-checks-wrap input[name=perm]:checked')].map(
            (c) => c.value
          );
    try {
      await api(`/api/users/${user.id}`, {
        method: 'PUT',
        body: { role, permissions },
      });
      if (isSelf) {
        const { user: me } = await api('/api/auth/me');
        state.user = me;
        applyRoleUi();
      }
      closeModal();
      toast(
        role === 'admin' ? '已設為最高權限（系統管理員）' : '權限已更新',
        'success'
      );
      navigate('users');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

async function refreshDeptLists() {
  try {
    await loadDepartmentOptions();
  } catch {
    /* ignore */
  }
}

function openAddDeptModal() {
  openModal(`
    <h3>新增部門</h3>
    <form id="add-dept-form" class="form-grid">
      <div class="field">
        <label>部門名稱 *</label>
        <input name="name" required maxlength="40" placeholder="例如：人資部、品保部" />
      </div>
      <div class="form-actions">
        <button type="submit" class="btn primary">建立</button>
        <button type="button" class="btn outline" data-close-modal>取消</button>
      </div>
    </form>
  `);
  $('#add-dept-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/api/departments', { method: 'POST', body: { name: fd.get('name') } });
      closeModal();
      toast('部門已新增', 'success');
      await refreshDeptLists();
      navigate('departments');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

function openRenameDeptModal(dept) {
  openModal(`
    <h3>修改部門名稱</h3>
    <p class="muted" style="margin-top:0">原名稱：${esc(dept.name)}</p>
    <form id="rename-dept-form" class="form-grid">
      <div class="field">
        <label>新部門名稱 *</label>
        <input name="name" required maxlength="40" value="${esc(dept.name)}" />
      </div>
      <p class="muted" style="font-size:0.85rem;margin:0">修改後，此部門下所有成員的「所屬部門」會一併更新。</p>
      <div class="form-actions">
        <button type="submit" class="btn primary">儲存</button>
        <button type="button" class="btn outline" data-close-modal>取消</button>
      </div>
    </form>
  `);
  $('#rename-dept-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api(`/api/departments/${dept.id}`, {
        method: 'PUT',
        body: { name: fd.get('name') },
      });
      closeModal();
      toast('部門名稱已更新', 'success');
      await refreshDeptLists();
      navigate('departments');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

/**
 * 從「已註冊成員名單」勾選後加入部門
 * 同一人可同時隸屬多個部門（可重複加入不同部門）
 */
function openAddUserToDeptModal(dept, allUsers) {
  const deptName = dept.name;
  const deptId = dept.id;
  const inDept = (u) => {
    const list = Array.isArray(u.departments) ? u.departments : [];
    return list.includes(deptName) || u.department === deptName;
  };
  // 可選：尚未在此部門的已註冊成員（即使已在其他部門也可選）
  const candidates = (allUsers || [])
    .filter((u) => u.active !== 0 && !inDept(u))
    .slice()
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hant'));

  if (!candidates.length) {
    toast('沒有可加入的已註冊成員（可能都已在此部門，或請先到「成員名單」新增帳號）', 'error');
    return;
  }

  openModal(`
    <h3>從成員名單加入「${esc(deptName)}」</h3>
    <p class="muted" style="margin-top:0">
      勾選<strong>已註冊成員</strong>加入此部門（不新建帳號）。<br/>
      <strong>同一人可同時隸屬多個部門</strong>；已在其他部門的人也可再加入這裡。
    </p>
    <form id="add-user-form" class="form-grid">
      <div class="field">
        <label>搜尋成員</label>
        <input type="search" id="member-search" placeholder="輸入姓名或帳號篩選…" autocomplete="off" />
      </div>
      <div class="field">
        <label>成員名單 *（可多選）</label>
        <div style="display:flex;gap:8px;margin:6px 0 8px">
          <button type="button" class="btn sm outline" id="sel-all-members">全選</button>
          <button type="button" class="btn sm outline" id="sel-none-members">取消全選</button>
        </div>
        <div class="approver-list" id="member-pick-list" style="max-height:300px;overflow:auto;border:1px solid var(--border);border-radius:10px;padding:10px">
          ${candidates
            .map((u) => {
              const depts = Array.isArray(u.departments) ? u.departments : [];
              const deptText =
                depts.length > 0
                  ? depts.join('、')
                  : u.department
                    ? u.department
                    : '尚未分部門';
              return `
            <label class="member-pick-row" data-search="${esc((u.name + ' ' + u.username).toLowerCase())}">
              <input type="checkbox" name="user_ids" value="${u.id}" />
              <span>
                <strong>${esc(u.name)}</strong>
                <span class="muted">（${esc(u.username)}）</span>
                <span class="muted"> · 目前隸屬：${esc(deptText)}</span>
              </span>
            </label>`;
            })
            .join('')}
        </div>
        <div class="muted" style="font-size:0.82rem;margin-top:6px">共 ${candidates.length} 位可選</div>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn primary">確認加入部門</button>
        <button type="button" class="btn outline" data-close-modal>取消</button>
      </div>
    </form>
  `);
  $('#modal-panel').classList.add('wide');

  const filterList = () => {
    const q = ($('#member-search')?.value || '').trim().toLowerCase();
    $$('#member-pick-list .member-pick-row').forEach((row) => {
      const hay = row.dataset.search || '';
      row.style.display = !q || hay.includes(q) ? '' : 'none';
    });
  };
  const search = $('#member-search');
  if (search) search.oninput = filterList;

  const selAll = $('#sel-all-members');
  const selNone = $('#sel-none-members');
  if (selAll) {
    selAll.onclick = () => {
      $$('#member-pick-list .member-pick-row').forEach((row) => {
        if (row.style.display === 'none') return;
        const cb = row.querySelector('input[type=checkbox]');
        if (cb) cb.checked = true;
      });
    };
  }
  if (selNone) {
    selNone.onclick = () => {
      $$('#member-pick-list input[name=user_ids]').forEach((cb) => {
        cb.checked = false;
      });
    };
  }

  $('#add-user-form').onsubmit = async (e) => {
    e.preventDefault();
    const ids = [...document.querySelectorAll('#member-pick-list input[name=user_ids]:checked')].map(
      (c) => Number(c.value)
    );
    if (!ids.length) {
      toast('請從成員名單至少勾選一位', 'error');
      return;
    }
    try {
      const result = await api(`/api/departments/${deptId}/members`, {
        method: 'POST',
        body: { user_ids: ids },
      });
      closeModal();
      toast(
        `已加入 ${result.added_count || ids.length} 人到「${deptName}」` +
          (result.skipped_count ? `（略過 ${result.skipped_count} 位已在部門內）` : ''),
        'success'
      );
      navigate('departments');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

async function renderDepartments(body) {
  if (!isAdmin()) {
    body.innerHTML = emptyState({
      title: '無權限',
      desc: '僅系統管理員可查看與管理部門。',
      actions: [{ label: '回總覽', go: 'dashboard', outline: true }],
    });
    bindDataGo(body);
    return;
  }
  const { departments } = await api('/api/departments/stats');
  const canManage = true;
  // 載入全部已註冊成員（供加入部門使用）
  let allUsers = [];
  if (canManage) {
    try {
      const data = await api('/api/users');
      allUsers = data.users || [];
      state.users = allUsers;
    } catch {
      allUsers = state.users || [];
    }
  }

  if (canManage) {
    $('#page-actions').innerHTML =
      `<button type="button" class="btn primary" id="btn-add-dept">＋ 新增部門</button>`;
    const addBtn = $('#btn-add-dept');
    if (addBtn) addBtn.onclick = () => openAddDeptModal();
  }

  if (!departments?.length) {
    body.innerHTML = emptyState({
      title: '尚無部門資料',
      desc: canManage
        ? '請先新增部門，再將成員加入各部門。'
        : '管理員尚未建立部門。',
      actions: canManage
        ? [{ label: '＋ 新增部門', id: 'btn-add-dept-empty', primary: true }]
        : [],
    });
    const addEmpty = $('#btn-add-dept-empty');
    if (addEmpty) addEmpty.onclick = () => openAddDeptModal();
    return;
  }

  body.innerHTML = `
    <div class="card">
      <h3 style="margin-top:0">部門與成員</h3>
      <p class="muted" style="margin-top:0">
        ${
          canManage
            ? '成員可<strong>同時隸屬多個部門</strong>。「從成員名單加入」可重複把同一人加到不同部門；「移出部門」只移出該部門，不刪帳號。'
            : '以下列出每個部門的成員。'
        }
      </p>
      ${departments
        .map((d) => {
          const members = Array.isArray(d.members) ? d.members : [];
          return `
        <div style="border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:14px;background:#fff">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
              <strong style="font-size:1.1rem">${esc(d.name)}</strong>
              <span class="tag approved">${members.length} 位成員</span>
            </div>
            ${
              canManage
                ? `<div style="display:flex;flex-wrap:wrap;gap:6px">
                    <button type="button" class="btn sm outline" data-rename-dept="${d.id}" data-dept-name="${esc(d.name)}">修改名稱</button>
                    <button type="button" class="btn sm primary" data-add-member-dept-id="${d.id}" data-add-member-dept-name="${esc(d.name)}">＋ 從成員名單加入</button>
                    <button type="button" class="btn sm danger" data-del-dept="${d.id}" data-dept-name="${esc(d.name)}" data-member-count="${members.length}">刪除部門</button>
                  </div>`
                : ''
            }
          </div>
          ${
            members.length
              ? `<div class="table-wrap">
                  <table class="data" style="width:100%;min-width:600px;table-layout:fixed">
                    <thead>
                      <tr>
                        <th style="width:120px;white-space:nowrap">姓名</th>
                        <th style="width:140px;white-space:nowrap">帳號</th>
                        <th style="width:120px;white-space:nowrap">角色</th>
                        <th style="min-width:160px">隸屬部門</th>
                        ${canManage ? '<th style="width:140px;text-align:center;white-space:nowrap">操作</th>' : ''}
                      </tr>
                    </thead>
                    <tbody>
                      ${members
                        .map((m) => {
                          const depts = Array.isArray(m.departments) ? m.departments : [];
                          const deptLabel =
                            depts.length > 0 ? depts.join('、') : m.department || '—';
                          return `
                        <tr>
                          <td><strong>${esc(m.name)}</strong></td>
                          <td><code>${esc(m.username)}</code></td>
                          <td>${
                            m.role === 'admin'
                              ? '<span class="tag draft">系統管理員</span>'
                              : '一般使用者'
                          }</td>
                          <td style="font-size:0.88rem">${esc(deptLabel)}</td>
                          ${
                            canManage
                              ? `<td>
                                  <button type="button" class="btn sm outline" data-remove-from-dept="${m.id}" data-user-name="${esc(m.name)}" data-dept-id="${d.id}" data-dept-name="${esc(d.name)}">移出此部門</button>
                                </td>`
                              : ''
                          }
                        </tr>`;
                        })
                        .join('')}
                    </tbody>
                  </table>
                </div>`
              : `<div class="empty" style="padding:8px 0">此部門尚無成員
                  ${canManage ? '，可點「從成員名單加入」' : ''}
                </div>`
          }
        </div>`;
        })
        .join('')}
    </div>`;

  if (!canManage) return;

  body.querySelectorAll('[data-rename-dept]').forEach((btn) => {
    btn.onclick = () => {
      openRenameDeptModal({
        id: Number(btn.dataset.renameDept),
        name: btn.dataset.deptName,
      });
    };
  });

  body.querySelectorAll('[data-add-member-dept-id]').forEach((btn) => {
    btn.onclick = async () => {
      let list = allUsers;
      try {
        const data = await api('/api/users');
        list = data.users || [];
        state.users = list;
      } catch {
        /* use cached */
      }
      openAddUserToDeptModal(
        {
          id: Number(btn.dataset.addMemberDeptId),
          name: btn.getAttribute('data-add-member-dept-name') || btn.dataset.addMemberDeptName,
        },
        list
      );
    };
  });

  body.querySelectorAll('[data-del-dept]').forEach((btn) => {
    btn.onclick = async () => {
      const id = Number(btn.dataset.delDept);
      const name = btn.dataset.deptName || '此部門';
      const count = Number(btn.dataset.memberCount || 0);
      if (count > 0) {
        toast(`「${name}」尚有 ${count} 位成員，請先將成員「移出此部門」`, 'error');
        return;
      }
      if (!confirm(`確定刪除部門「${name}」？`)) return;
      try {
        await api(`/api/departments/${id}`, { method: 'DELETE' });
        toast('部門已刪除', 'success');
        await refreshDeptLists();
        navigate('departments');
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  });

  // 僅移出「此」部門，其他部門隸屬與帳號保留
  body.querySelectorAll('[data-remove-from-dept]').forEach((btn) => {
    btn.onclick = async () => {
      const userId = Number(btn.dataset.removeFromDept);
      const name = btn.dataset.userName || '此成員';
      const deptId = Number(btn.dataset.deptId);
      const deptName = btn.dataset.deptName || '';
      if (
        !confirm(
          `確定將「${name}」移出「${deptName}」？\n帳號保留；若還隸屬其他部門，其他部門不受影響。`
        )
      ) {
        return;
      }
      try {
        await api(`/api/departments/${deptId}/members/${userId}`, { method: 'DELETE' });
        toast(`已將「${name}」移出「${deptName}」`, 'success');
        navigate('departments');
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  });
}

/**
 * 彈出手寫簽名視窗 (Signature Canvas Modal)
 */
function openSignaturePadModal(opts = {}) {
  const { title = '手寫電子簽名', initialImage = null, onSave } = opts;
  const html = `
    <div style="max-width:520px;width:100%;margin:0 auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <h3 style="margin:0">${esc(title)}</h3>
        <button type="button" class="btn ghost sm" onclick="closeModal()">✕</button>
      </div>
      <p class="muted" style="margin:0 0 12px;font-size:0.88rem">
        請在下方白板處以滑鼠或手指/觸控筆畫出您的簽名：
      </p>
      <div style="border:2px dashed #94a3b8;border-radius:12px;background:#fff;padding:6px;text-align:center;touch-action:none">
        <canvas id="sig-pad-canvas" width="460" height="200" style="width:100%;max-width:460px;height:200px;display:block;margin:0 auto;cursor:crosshair;background:#ffffff;border-radius:8px;border:1px solid #e2e8f0"></canvas>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:14px;gap:10px;flex-wrap:wrap">
        <div>
          <button type="button" class="btn outline sm" id="btn-sig-clear">🧹 清除重寫</button>
        </div>
        <div style="display:flex;gap:8px">
          <button type="button" class="btn ghost sm" onclick="closeModal()">取消</button>
          <button type="button" class="btn primary sm" id="btn-sig-save">💾 確定儲存</button>
        </div>
      </div>
    </div>
  `;
  openModal(html);

  const canvas = $('#sig-pad-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#0f172a';

  let isDrawing = false;
  let hasDrawn = false;
  let lastX = 0;
  let lastY = 0;

  if (initialImage) {
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      hasDrawn = true;
    };
    img.src = initialImage;
  }

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if (e.touches && e.touches[0]) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  function startDraw(e) {
    e.preventDefault();
    isDrawing = true;
    const p = getPos(e);
    lastX = p.x;
    lastY = p.y;
  }

  function drawMove(e) {
    if (!isDrawing) return;
    e.preventDefault();
    const p = getPos(e);
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lastX = p.x;
    lastY = p.y;
    hasDrawn = true;
  }

  function stopDraw(e) {
    if (isDrawing) {
      isDrawing = false;
    }
  }

  canvas.addEventListener('mousedown', startDraw);
  canvas.addEventListener('mousemove', drawMove);
  canvas.addEventListener('mouseup', stopDraw);
  canvas.addEventListener('mouseleave', stopDraw);

  canvas.addEventListener('touchstart', startDraw, { passive: false });
  canvas.addEventListener('touchmove', drawMove, { passive: false });
  canvas.addEventListener('touchend', stopDraw);

  $('#btn-sig-clear').onclick = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasDrawn = false;
  };

  $('#btn-sig-save').onclick = () => {
    if (!hasDrawn && !initialImage) {
      toast('請先在白板上手寫簽名', 'error');
      return;
    }
    const dataUrl = canvas.toDataURL('image/png');
    closeModal();
    if (typeof onSave === 'function') onSave(dataUrl);
  };
}

async function renderSettings(body) {
  const u = state.user || {};
  const depts =
    Array.isArray(u.departments) && u.departments.length
      ? u.departments.join('、')
      : u.department || '—';

  let mailCfg = null;
  try {
    mailCfg = await api('/api/mail/config');
  } catch {
    mailCfg = { enabled: false, ready: false };
  }

  await loadUsers();
  const allUsers = (state.users || []).filter((x) => x.active !== 0 && x.id !== u.id);

  let delegationInfo = { activeDelegation: null, delegation: null, grantors: [] };
  try {
    delegationInfo = await api('/api/delegations/my');
  } catch {
    /* ignore */
  }

  let userSig = u.signature_image || null;
  try {
    const sigRes = await api('/api/users/me/signature');
    userSig = sigRes.signature_image || userSig;
  } catch {
    /* ignore */
  }

  const activeDel = delegationInfo.activeDelegation;
  const rawDel = delegationInfo.delegation;
  const grantors = delegationInfo.grantors || [];

  const grantorText = grantors.length
    ? grantors.map((g) => `<strong>${esc(g.grantor_name)}</strong>`).join('、')
    : '';

  let myDevices = [];
  let accessCfg = {};
  try {
    const d = await api('/api/devices/my');
    myDevices = d.devices || [];
    accessCfg = d.access || {};
  } catch {
    /* ignore */
  }

  body.innerHTML = `
    <div class="card" style="max-width:560px">
      <h3>我的資料</h3>
      <p class="muted" style="margin-top:0">每位成員皆可自行修改姓名、Email、分機與電話。帳號與部門由管理員管理。</p>
      <form id="profile-form" class="form-grid">
        <div class="field">
          <label>帳號</label>
          <input type="text" value="${esc(u.username || '')}" disabled />
        </div>
        <div class="field">
          <label>部門</label>
          <input type="text" value="${esc(depts)}" disabled />
        </div>
        <div class="field">
          <label>角色</label>
          <input type="text" value="${u.role === 'admin' ? '系統管理員' : '使用者'}" disabled />
        </div>
        <div class="field">
          <label>姓名 *</label>
          <input name="name" required maxlength="80" value="${esc(u.name || '')}" placeholder="顯示名稱" />
        </div>
        <div class="field">
          <label>Email</label>
          <input name="email" type="email" maxlength="120" value="${esc(u.email || '')}" placeholder="選填，例：name@company.com" />
          <div class="muted" style="font-size:0.82rem;margin-top:4px">用於接收簽核結果與待簽核提醒</div>
        </div>
        <div class="field">
          <label>到職日</label>
          <input type="text" value="${esc(u.hire_date || u.labor?.hireDate || '未設定')}" disabled />
          <div class="muted" style="font-size:0.82rem;margin-top:4px">
            ${
              u.labor?.specialLeave
                ? `特休可休 ${u.labor.specialLeave.entitled ?? 0} 日（手動）· 剩餘 ${u.labor.specialLeave.remaining ?? '—'} 日${
                    u.labor?.seniority?.label ? `；年資 ${esc(u.labor.seniority.label)}（僅顯示）` : ''
                  }`
                : '特休可休由管理員於「成員名單」手動設定（不依年資）'
            }
          </div>
        </div>
        <div class="field">
          <label>分機</label>
          <input name="extension" maxlength="20" value="${esc(u.extension || '')}" placeholder="選填，例：123" />
        </div>
        <div class="field">
          <label>電話</label>
          <input name="phone" maxlength="40" value="${esc(u.phone || '')}" placeholder="選填，例：0912-345-678" />
        </div>
        <div class="field" style="border:1px solid var(--border);border-radius:10px;padding:12px;background:#f8fafc">
          <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;margin:0">
            <input type="checkbox" name="email_notify" id="email-notify-pref" value="1"
              ${u.email_notify !== 0 ? 'checked' : ''} style="margin-top:3px" />
            <span>
              <strong>預設以 Email 通知我的申請進度</strong>
              <div class="muted" style="font-size:0.85rem;margin-top:4px">送出申請時可再單次調整；需先填寫上方 Email。</div>
            </span>
          </label>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn primary">儲存資料</button>
        </div>
      </form>
    </div>

    <!-- 客製化佈景主題 -->
    <div class="card" style="max-width:560px">
      <h3>🎨 客製化佈景主題</h3>
      <p class="muted" style="margin-top:0">點選下方主題即可即時預覽畫面效果，儲存後於此裝置自動持久化套用。</p>
      
      <div id="theme-selector-grid" class="theme-grid">
        ${THEMES.map((t) => {
          const isSelected = t.id === (localStorage.getItem('approval_user_theme') || 'navy');
          const activeStyle = isSelected
            ? `background: linear-gradient(135deg, ${t.vars['--primary']} 0%, ${t.vars['--primary-hover']} 100%) !important; color: #ffffff !important; border-color: ${t.vars['--primary-hover']} !important; box-shadow: 0 4px 14px ${t.vars['--primary']}55 !important;`
            : '';
          return `
          <button type="button" class="btn ${isSelected ? 'primary active' : ''} theme-card" data-theme-id="${t.id}" style="${activeStyle}">
            <span class="theme-color-dot" style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${isSelected ? '#ffffff' : t.vars['--primary']};box-shadow:0 0 0 1.5px rgba(255,255,255,0.6);"></span>
            <span>${t.name}</span>
          </button>
        `;
        }).join('')}
      </div>

      <div class="form-actions" style="margin-top:14px">
        <button type="button" class="btn primary" id="btn-save-theme">🎨 儲存並套用主題</button>
        <button type="button" class="btn outline" id="btn-reset-theme">還原預設藍調</button>
      </div>
    </div>

    <!-- 簽核代理人設定 -->
    <div class="card" style="max-width:560px">
      <h3>🔄 簽核代理人機制</h3>
      <p class="muted" style="margin-top:0">
        出差或休假時，可設定代理同仁。代理期間到達後，原屬於您的待簽核單據將會自動出現在代理人的「待我簽核」清單中，並記錄代理簽核日誌。
      </p>
      ${
        grantorText
          ? `<div class="card" style="background:#eff6ff;border-color:#93c5fd;margin-bottom:14px;padding:12px">
              <strong style="color:#1d4ed8">⚡ 代理授權通知</strong>
              <div style="font-size:0.88rem;color:#1e40af;margin-top:4px">
                下列同仁目前已將您設為簽核代理人：${grantorText}。<br/>
                當對方有待簽核單據時，您可進入該單進行代理簽核。
              </div>
            </div>`
          : ''
      }
      <form id="delegation-form" class="form-grid">
        <div class="field">
          <label>指定代理同仁 *</label>
          <select name="delegate_user_id" required>
            <option value="">請選擇代理同仁…</option>
            ${allUsers
              .map(
                (usr) =>
                  `<option value="${usr.id}" ${
                    rawDel && rawDel.delegate_user_id === usr.id ? 'selected' : ''
                  }>${esc(usr.name)}（${esc(usr.department || '未設部門')}）</option>`
              )
              .join('')}
          </select>
        </div>
        <div class="field">
          <label>代理開始時間（選填，留白即刻生效）</label>
          <input type="datetime-local" name="start_time" value="${esc(
            rawDel?.start_time ? String(rawDel.start_time).replace(' ', 'T') : ''
          )}" />
        </div>
        <div class="field">
          <label>代理結束時間（選填，留白永久生效）</label>
          <input type="datetime-local" name="end_time" value="${esc(
            rawDel?.end_time ? String(rawDel.end_time).replace(' ', 'T') : ''
          )}" />
        </div>
        <div class="field" style="border:1px solid var(--border);border-radius:10px;padding:12px;background:#f8fafc">
          <label style="display:flex;align-items:center;gap:10px;cursor:pointer;margin:0">
            <input type="checkbox" name="active" value="1" ${
              !rawDel || rawDel.active ? 'checked' : ''
            } />
            <span>
              <strong>啟用代理簽核功能</strong>
              <div class="muted" style="font-size:0.85rem;margin-top:2px">取消勾選可暫停代理授權</div>
            </span>
          </label>
        </div>
        <div class="form-actions" style="display:flex;gap:10px">
          <button type="submit" class="btn primary">儲存代理設定</button>
          ${
            rawDel && rawDel.active
              ? `<button type="button" class="btn danger outline" id="btn-cancel-delegation">取消代理設定</button>`
              : ''
          }
        </div>
      </form>
    </div>

    <!-- 個人電子簽名檔 -->
    <div class="card" style="max-width:560px">
      <h3>✍️ 個人電子簽名檔</h3>
      <p class="muted" style="margin-top:0">
        您可以先預設個人手寫電子簽名，簽核時系統將自動套用至簽核單與 exported PDF 檔案中；亦可選擇現場手寫。
      </p>
      <div style="border:1px dashed #cbd5e1;border-radius:10px;padding:16px;background:#f8fafc;text-align:center;margin-bottom:14px">
        <div id="sig-preview-box">
          ${
            userSig
              ? `<img src="${userSig}" style="max-height:90px;max-width:100%;object-fit:contain;background:#fff;padding:4px;border:1px solid #e2e8f0;border-radius:6px" alt="個人電子簽名" />`
              : `<div class="muted" style="padding:20px 0">尚未設定個人電子簽名檔</div>`
          }
        </div>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button type="button" class="btn primary sm" id="btn-draw-signature">✍️ 白板手寫簽名</button>
        <button type="button" class="btn outline sm" id="btn-upload-sig-file">📁 上傳簽名圖檔</button>
        <input type="file" id="sig-file-input" accept="image/*" class="hidden" />
        ${
          userSig
            ? `<button type="button" class="btn danger outline sm" id="btn-clear-signature">🗑️ 清除預設簽名</button>`
            : ''
        }
      </div>
    </div>
    <div class="card" style="max-width:560px">
      <h3>變更密碼</h3>
      <form id="pw-form" class="form-grid">
        <div class="field"><label>目前密碼</label><input type="password" name="currentPassword" required autocomplete="current-password" /></div>
        <div class="field"><label>新密碼（至少 6 字元）</label><input type="password" name="newPassword" required minlength="6" autocomplete="new-password" /></div>
        <div class="form-actions">
          <button type="submit" class="btn primary">更新密碼</button>
        </div>
      </form>
    </div>
    <div class="card" style="max-width:560px">
      <h3>Email 提醒</h3>
      <p class="muted" style="margin:0">系統 Email 功能目前：
        <strong>${mailCfg.enabled ? '已啟用' : '未啟用'}</strong>
        ${mailCfg.enabled && !mailCfg.ready ? '（管理員尚未完成 SMTP）' : ''}
      </p>
      <p class="muted" style="margin:8px 0 0;font-size:0.9rem;line-height:1.5">
        請在上方填寫 Email 並勾選通知偏好。申請送出後，可在簽核詳情點「Email 催辦簽核人」。
        ${
          isBuiltinAdmin()
            ? 'SMTP 與公司品牌請至<strong>系統設定</strong>管理（僅內建 Admin）。'
            : ''
        }
      </p>
    </div>
    <div class="card" style="max-width:560px">
      <h3>桌面通知設定</h3>
      <p class="muted" style="margin-top:0;line-height:1.5">
        登入後系統會定期檢查「待我簽核」。有新件時可透過瀏覽器桌面通知提醒（本機偏好，不跟著帳號同步）。
      </p>
      ${(() => {
        const dn = getDesktopNotifyPrefs();
        const perm = desktopNotifyPermissionLabel();
        const supported = 'Notification' in window;
        return `
      <div style="border:1px solid var(--border);border-radius:10px;padding:12px;background:#f8fafc;margin-bottom:12px">
        <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px">
          <span>瀏覽器權限：</span>
          <span class="tag ${esc(perm.cls)}">${esc(perm.text)}</span>
          ${
            supported
              ? `<button type="button" class="btn outline sm" id="btn-dn-permission">允許桌面通知</button>
                 <button type="button" class="btn outline sm" id="btn-dn-test">發送測試通知</button>`
              : ''
          }
        </div>
      </div>
      <form id="desktop-notify-form" class="form-grid">
        <div class="field dn-check-field">
          <label>
            <input type="checkbox" id="dn-enabled" ${dn.enabled ? 'checked' : ''} />
            <span>
              <strong>啟用桌面通知</strong>
              <div class="muted" style="font-size:0.85rem;margin-top:4px">待簽核件數增加時推送系統通知</div>
            </span>
          </label>
        </div>
        <div class="field dn-check-field">
          <label>
            <input type="checkbox" id="dn-foreground" ${dn.foreground ? 'checked' : ''} />
            <span>
              <strong>分頁在前景也顯示通知</strong>
              <div class="muted" style="font-size:0.85rem;margin-top:4px">關閉後僅在瀏覽器縮到背景／其他分頁時推送</div>
            </span>
          </label>
        </div>
        <div class="field dn-check-field">
          <label>
            <input type="checkbox" id="dn-title-flash" ${dn.titleFlash ? 'checked' : ''} />
            <span>
              <strong>背景時閃爍分頁標題</strong>
              <div class="muted" style="font-size:0.85rem;margin-top:4px">標題交替顯示「【待簽核】…」提醒</div>
            </span>
          </label>
        </div>
        <div class="field">
          <label>檢查間隔（秒）</label>
          <input type="number" id="dn-poll-sec" min="10" max="120" step="5" value="${esc(String(dn.pollSec))}" />
          <div class="muted" style="font-size:0.82rem;margin-top:4px">建議 15～30 秒；過短會增加伺服器負擔</div>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn primary">儲存桌面通知設定</button>
        </div>
      </form>
      <p class="muted" style="font-size:0.82rem;margin:12px 0 0;line-height:1.5">
        • 需使用 <strong>Chrome / Edge</strong>。完整步驟見文件 <strong>docs/桌面通知使用說明.md</strong>。<br/>
        • 顯示<strong>已封鎖</strong>：網址列左側圖示 → 通知 → 允許；或 Edge 開啟
          <code style="font-size:0.78rem">edge://settings/content/notifications</code> 把本站改允許後重新整理。<br/>
        • 網站為 <strong>http://</strong>（非 HTTPS）時，瀏覽器可能強制封鎖。暫用：
          <code style="font-size:0.78rem">edge://flags</code> 搜尋
          <em>Insecure origins treated as secure</em>，填入本站完整網址 → Enabled → 重啟瀏覽器後再按「允許」。長期建議改 HTTPS。<br/>
        • 仍無通知：Windows 設定 → 系統 → 通知 → Microsoft Edge 須開啟，並關閉勿擾模式後測試。
      </p>`;
      })()}
    </div>`;

  let selectedThemeId = localStorage.getItem('approval_user_theme') || 'navy';

  // 點擊主題卡片即時切換與預覽（動態套用該主題專屬底色與白字）
  document.querySelectorAll('.theme-card').forEach((card) => {
    card.addEventListener('click', () => {
      selectedThemeId = card.dataset.themeId;
      document.querySelectorAll('.theme-card').forEach((c) => {
        c.classList.remove('active', 'primary');
        c.removeAttribute('style');
        const themeId = c.dataset.themeId;
        const themeObj = THEMES.find((t) => t.id === themeId);
        const dot = c.querySelector('.theme-color-dot');
        if (dot && themeObj) dot.style.background = themeObj.vars['--primary'];
      });

      card.classList.add('active', 'primary');
      const curThemeObj = THEMES.find((t) => t.id === selectedThemeId) || THEMES[0];
      card.style.cssText = `background: linear-gradient(135deg, ${curThemeObj.vars['--primary']} 0%, ${curThemeObj.vars['--primary-hover']} 100%) !important; color: #ffffff !important; border-color: ${curThemeObj.vars['--primary-hover']} !important; box-shadow: 0 4px 14px ${curThemeObj.vars['--primary']}55 !important;`;
      const activeDot = card.querySelector('.theme-color-dot');
      if (activeDot) activeDot.style.background = '#ffffff';

      applyUserTheme(selectedThemeId, false);
    });
  });

  // 儲存主題
  $('#btn-save-theme')?.addEventListener('click', () => {
    applyUserTheme(selectedThemeId, true);
    const themeObj = THEMES.find((t) => t.id === selectedThemeId) || THEMES[0];
    toast(`已成功套用「${themeObj.name}」客製化主題！`, 'success');
  });

  // 還原預設主題
  $('#btn-reset-theme')?.addEventListener('click', () => {
    selectedThemeId = 'navy';
    applyUserTheme('navy', true);
    document.querySelectorAll('.theme-card').forEach((c) => {
      c.classList.toggle('active', c.dataset.themeId === 'navy');
    });
    toast('已還原為預設經典藍調主題！', 'success');
  });

  if (accessCfg.deviceBindEnabled) {
    const box = document.createElement('div');
    box.className = 'card';
    box.style.maxWidth = '560px';
    box.style.marginTop = '16px';
    box.innerHTML = `
      <h3>已綁定的電腦</h3>
      <p class="muted" style="margin-top:0">此帳號最多 ${esc(String(accessCfg.deviceBindMax || 3))} 台。解除後需在該電腦重新登入才會再綁定。</p>
      ${
        myDevices.length
          ? `<ul class="muted" style="padding-left:18px">${myDevices
              .map(
                (d) =>
                  `<li style="margin:8px 0">${esc(d.label || '瀏覽器')} · ${esc(d.ip_address || '')} · 上次 ${esc(
                    String(d.last_seen_at || '').replace('T', ' ')
                  )} <button type="button" class="btn ghost sm" data-unbind="${d.id}">解除</button></li>`
              )
              .join('')}</ul>`
          : '<p class="muted">尚無綁定紀錄（下次登入會登記此電腦）</p>'
      }`;
    body.appendChild(box);
    box.querySelectorAll('[data-unbind]').forEach((btn) => {
      btn.onclick = async () => {
        if (!confirm('解除此電腦綁定？')) return;
        try {
          await api(`/api/devices/my/${btn.dataset.unbind}`, { method: 'DELETE' });
          toast('已解除', 'success');
          navigate('settings');
        } catch (err) {
          toast(err.message, 'error');
        }
      };
    });
  }

  $('#profile-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const data = await api('/api/auth/profile', {
        method: 'PUT',
        body: {
          name: fd.get('name'),
          email: fd.get('email') || '',
          extension: fd.get('extension') || '',
          phone: fd.get('phone') || '',
          email_notify: e.target.querySelector('#email-notify-pref')?.checked ? 1 : 0,
        },
      });
      if (data.user) {
        state.user = { ...state.user, ...data.user };
        $('#user-name').textContent = data.user.name;
        $('#user-avatar').textContent = (data.user.name || 'U').slice(0, 1);
      }
      toast('個人資料已更新', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  // 簽核代理人表單
  $('#delegation-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const delegateId = Number(fd.get('delegate_user_id'));
    if (!delegateId) {
      toast('請選擇代理同仁', 'error');
      return;
    }
    const startTime = fd.get('start_time') ? String(fd.get('start_time')).replace('T', ' ') : null;
    const endTime = fd.get('end_time') ? String(fd.get('end_time')).replace('T', ' ') : null;
    const active = !!e.target.querySelector('input[name=active]')?.checked;

    try {
      const res = await api('/api/delegations/my', {
        method: 'POST',
        body: { delegate_user_id: delegateId, start_time: startTime, end_time: endTime, active },
      });
      toast(res.message || '代理設定已儲存', 'success');
      navigate('settings');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  $('#btn-cancel-delegation')?.addEventListener('click', async () => {
    if (!confirm('確定取消簽核代理設定？')) return;
    try {
      const res = await api('/api/delegations/my', { method: 'DELETE' });
      toast(res.message || '已取消簽核代理設定', 'success');
      navigate('settings');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // 電子簽名檔
  $('#btn-draw-signature')?.addEventListener('click', () => {
    openSignaturePadModal({
      title: '手寫個人電子簽名檔',
      initialImage: userSig,
      onSave: async (dataUrl) => {
        try {
          const res = await api('/api/users/me/signature', {
            method: 'POST',
            body: { signature_image: dataUrl },
          });
          state.user = { ...state.user, signature_image: dataUrl };
          toast(res.message || '手寫電子簽名已儲存', 'success');
          navigate('settings');
        } catch (err) {
          toast(err.message, 'error');
        }
      },
    });
  });

  $('#btn-upload-sig-file')?.addEventListener('click', () => {
    $('#sig-file-input')?.click();
  });

  $('#sig-file-input')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast('請上傳圖檔（PNG / JPG）', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = async (evt) => {
      const dataUrl = evt.target.result;
      try {
        const res = await api('/api/users/me/signature', {
          method: 'POST',
          body: { signature_image: dataUrl },
        });
        state.user = { ...state.user, signature_image: dataUrl };
        toast(res.message || '簽名圖檔上傳成功', 'success');
        navigate('settings');
      } catch (err) {
        toast(err.message, 'error');
      }
    };
    reader.readAsDataURL(file);
  });

  $('#btn-clear-signature')?.addEventListener('click', async () => {
    if (!confirm('確定清除預設電子簽名檔？')) return;
    try {
      const res = await api('/api/users/me/signature', { method: 'DELETE' });
      state.user = { ...state.user, signature_image: null };
      toast(res.message || '簽名檔已清除', 'success');
      navigate('settings');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // 桌面通知設定
  $('#desktop-notify-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const prefs = saveDesktopNotifyPrefs({
      enabled: !!$('#dn-enabled')?.checked,
      foreground: !!$('#dn-foreground')?.checked,
      titleFlash: !!$('#dn-title-flash')?.checked,
      pollSec: Number($('#dn-poll-sec')?.value) || 20,
    });
    // 立即套用輪詢間隔
    if (state.token) {
      startPendingWatcher({ requestPermission: false });
    }
    toast(
      prefs.enabled
        ? `桌面通知已儲存（每 ${prefs.pollSec} 秒檢查）`
        : '已關閉桌面通知（仍顯示角標與站內提示）',
      'success'
    );
    navigate('settings');
  });
  $('#btn-dn-permission')?.addEventListener('click', async () => {
    const ok = await ensureNotifyPermission(true);
    if (ok) {
      saveDesktopNotifyPrefs({ enabled: true });
      toast('已允許桌面通知', 'success');
    } else if (!('Notification' in window)) {
      toast('此瀏覽器不支援桌面通知', 'error');
    } else if (Notification.permission === 'denied') {
      toast('通知已被封鎖，請至瀏覽器網站設定改為「允許」', 'error');
    } else {
      toast('未取得通知權限', 'error');
    }
    navigate('settings');
  });
  $('#btn-dn-test')?.addEventListener('click', async () => {
    const ok = await ensureNotifyPermission(true);
    if (!ok) {
      toast('請先允許桌面通知權限', 'error');
      return;
    }
    const prefs = getDesktopNotifyPrefs();
    if (!prefs.enabled) {
      toast('請先勾選「啟用桌面通知」並儲存', 'error');
      return;
    }
    showDesktopNotification(
      '線上簽核系統 · 測試',
      '這是一則測試桌面通知。點擊可回到待簽核列表。',
      () => navigate('inbox')
    );
    toast('已發送測試通知（若沒看到請檢查系統勿擾模式）', 'success');
  });

  $('#pw-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/api/auth/password', {
        method: 'PUT',
        body: {
          currentPassword: fd.get('currentPassword'),
          newPassword: fd.get('newPassword'),
        },
      });
      e.target.reset();
      toast('密碼已更新', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

/** LINE 設定表單 HTML（側欄頁與系統設定共用） */
function lineSettingsFormHtml(cfg = {}, opts = {}) {
  const showAccess = opts.showAccess !== false && isBuiltinAdmin();
  const ev = cfg.events || {};
  const access = cfg.configAccess || 'builtin_admin';
  const statusText = cfg.ready
    ? '已就緒（啟用且已設定服務網址與 API 金鑰）'
    : cfg.enabled
      ? '已啟用但尚未就緒（請檢查服務網址／API 金鑰）'
      : '未啟用';
  return `
    <p class="muted" style="margin-top:0;line-height:1.55">
      透過獨立服務 <code>line-notify</code>（預設埠 3850）推播 Messaging API。
      Channel Token 只放在 LINE 專案 <code>.env</code>；此處只填<strong>服務網址</strong>與<strong>內部 API 金鑰</strong>。
      成員需先對官方帳號傳送：<code>綁定 簽核帳號</code>。
    </p>
    <p style="margin:0 0 12px">
      狀態：
      <strong style="color:${cfg.ready ? '#15803d' : '#b45309'}">${esc(statusText)}</strong>
      ${cfg.updatedAt ? `<span class="muted" style="margin-left:8px;font-size:0.85rem">更新：${esc(String(cfg.updatedAt).replace('T', ' ').replace(/\.\d+Z$/, ''))}</span>` : ''}
    </p>
    <form id="${esc(opts.formId || 'line-form')}" class="form-grid">
      <div class="field check-row-box">
        <label class="check-row">
          <input type="checkbox" name="enabled" id="${esc((opts.formId || 'line-form') + '-enabled')}" ${cfg.enabled ? 'checked' : ''} />
          <span><strong>啟用 LINE 推播通知</strong></span>
        </label>
      </div>
      <div class="field">
        <label>LINE 服務網址</label>
        <input name="serviceUrl" value="${esc(cfg.serviceUrl || 'http://192.168.99.220:3850')}"
          placeholder="http://192.168.99.220:3850" autocomplete="off" />
        <span class="field-hint" style="color:#6b7280;font-size:0.82rem">正式 NAS 建議：http://192.168.99.220:3850（容器內可用 http://line-notify:3850）</span>
      </div>
      <div class="field">
        <label>內部 API 金鑰（= line-notify 的 INTERNAL_API_KEY）</label>
        <input name="apiKey" type="password" value="" autocomplete="new-password"
          placeholder="${cfg.hasApiKey ? '已設定（留空則不變更）' : '尚未設定'}" />
      </div>
      ${
        showAccess
          ? `<div class="field">
        <label>誰可以設定 LINE</label>
        <select name="configAccess">
          <option value="builtin_admin" ${access === 'builtin_admin' ? 'selected' : ''}>僅內建 Admin</option>
          <option value="any_admin" ${access === 'any_admin' ? 'selected' : ''}>所有系統管理員</option>
          <option value="permission" ${access === 'permission' ? 'selected' : ''}>具備「LINE 通知設定」權限者</option>
        </select>
        <span class="field-hint" style="color:#6b7280;font-size:0.82rem">僅內建 Admin 可變更此項</span>
      </div>`
          : ''
      }
      <div class="field">
        <strong class="check-group-title" style="display:block;margin-bottom:8px">通知事件</strong>
        <div class="check-group-box" style="background:#f8fafc">
          <label class="check-row"><input type="checkbox" name="ev_pending" ${ev.pending !== false ? 'checked' : ''} /><span>待簽核（通知簽核人）</span></label>
          <label class="check-row"><input type="checkbox" name="ev_submitted" ${ev.submitted !== false ? 'checked' : ''} /><span>申請已送出（通知申請人）</span></label>
          <label class="check-row"><input type="checkbox" name="ev_approved" ${ev.approved !== false ? 'checked' : ''} /><span>已核准</span></label>
          <label class="check-row"><input type="checkbox" name="ev_rejected" ${ev.rejected !== false ? 'checked' : ''} /><span>已駁回</span></label>
          <label class="check-row"><input type="checkbox" name="ev_step" ${ev.step !== false ? 'checked' : ''} /><span>關卡進度更新</span></label>
          <label class="check-row"><input type="checkbox" name="ev_remind" ${ev.remind !== false ? 'checked' : ''} /><span>催辦</span></label>
        </div>
      </div>
      <div class="form-actions" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <button type="submit" class="btn primary">儲存 LINE 設定</button>
        <button type="button" class="btn outline" id="${esc((opts.formId || 'line-form') + '-health')}">檢查服務</button>
        <button type="button" class="btn outline" id="${esc((opts.formId || 'line-form') + '-test')}">測試推播給自己</button>
      </div>
    </form>
    <div id="${esc((opts.formId || 'line-form') + '-bindings')}" class="muted" style="margin-top:14px;font-size:0.88rem;line-height:1.5"></div>
  `;
}

function bindLineSettingsForm(opts = {}) {
  const formId = opts.formId || 'line-form';
  const form = document.getElementById(formId);
  if (!form) return;

  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = {
      enabled: !!e.target.querySelector(`#${formId}-enabled`)?.checked,
      serviceUrl: String(fd.get('serviceUrl') || '').trim(),
      apiKey: String(fd.get('apiKey') || ''),
      events: {
        pending: !!e.target.querySelector('[name="ev_pending"]')?.checked,
        submitted: !!e.target.querySelector('[name="ev_submitted"]')?.checked,
        approved: !!e.target.querySelector('[name="ev_approved"]')?.checked,
        rejected: !!e.target.querySelector('[name="ev_rejected"]')?.checked,
        step: !!e.target.querySelector('[name="ev_step"]')?.checked,
        remind: !!e.target.querySelector('[name="ev_remind"]')?.checked,
      },
    };
    if (isBuiltinAdmin() && fd.get('configAccess')) {
      body.configAccess = String(fd.get('configAccess'));
    }
    try {
      const data = await api('/api/line/config', { method: 'PUT', body });
      const cfg = data.config || data;
      state.lineCanConfigure = true;
      state.lineConfigAccess = cfg.configAccess || state.lineConfigAccess;
      state.lineReady = !!cfg.ready;
      state.lineEnabled = !!cfg.enabled;
      applyRoleUi();
      toast('LINE 設定已儲存', 'success');
      if (typeof opts.onSaved === 'function') opts.onSaved(cfg);
    } catch (err) {
      toast(err.message || '儲存失敗', 'error');
    }
  };

  document.getElementById(`${formId}-health`)?.addEventListener('click', async () => {
    try {
      const h = await api('/api/line/health');
      if (h.ok) {
        toast(
          `服務正常${h.data?.version ? ' v' + h.data.version : ''}${
            h.data?.lineConfigured === false ? '（Channel 尚未設定）' : ''
          }`,
          'success'
        );
      } else {
        toast(h.error || `服務異常 HTTP ${h.status || ''}`, 'error');
      }
    } catch (err) {
      toast(err.message || '無法連線 LINE 服務', 'error');
    }
  });

  document.getElementById(`${formId}-test`)?.addEventListener('click', async () => {
    try {
      await api('/api/line/test', {
        method: 'POST',
        body: { username: state.user?.username || '' },
      });
      toast('已送出測試推播（請確認 LINE 已綁定簽核帳號）', 'success');
    } catch (err) {
      toast(err.message || '測試推播失敗', 'error');
    }
  });

  // 綁定列表（選用）
  const box = document.getElementById(`${formId}-bindings`);
  if (box) {
    api('/api/line/bindings')
      .then((data) => {
        const list = data.bindings || [];
        if (!list.length) {
          box.innerHTML =
            '尚無綁定紀錄。請成員對 LINE 官方帳號傳送：<code>綁定 您的簽核帳號</code>';
          return;
        }
        const rows = list
          .slice(0, 30)
          .map(
            (b) =>
              `<tr><td>${esc(b.username || '—')}</td><td style="font-family:monospace;font-size:0.8rem">${esc(
                String(b.lineUserId || b.userId || '').slice(0, 24)
              )}</td></tr>`
          )
          .join('');
        box.innerHTML = `
          <strong>已綁定帳號（前 ${Math.min(list.length, 30)} 筆）</strong>
          <table class="data" style="margin-top:8px;font-size:0.85rem;width:100%">
            <thead><tr><th>簽核帳號</th><th>LINE userId</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>`;
      })
      .catch(() => {
        box.innerHTML = '無法載入綁定列表（服務未就緒或 API 金鑰不符）';
      });
  }
}

/** 側欄「LINE 通知」完整設定頁 */
async function renderLineSettings(body) {
  if (!canConfigureLine()) {
    body.innerHTML = `<div class="error-msg">您沒有 LINE 通知設定權限</div>`;
    return;
  }
  let cfg = {
    enabled: false,
    ready: false,
    serviceUrl: 'http://192.168.99.220:3850',
    hasApiKey: false,
    configAccess: 'builtin_admin',
    events: {},
  };
  try {
    const data = await api('/api/line/config');
    if (!data.canConfigure) {
      body.innerHTML = `<div class="error-msg">您沒有 LINE 通知設定權限</div>`;
      return;
    }
    cfg = { ...cfg, ...data };
    state.lineCanConfigure = true;
    state.lineConfigAccess = cfg.configAccess;
    state.lineReady = !!cfg.ready;
    state.lineEnabled = !!cfg.enabled;
  } catch (e) {
    body.innerHTML = `<div class="error-msg">${esc(e.message || '無法載入 LINE 設定')}</div>`;
    return;
  }

  body.innerHTML = `
    <div class="system-settings-page">
      <div class="card">
        <h3>💬 LINE 通知設定</h3>
        ${lineSettingsFormHtml(cfg, { formId: 'line-form', showAccess: true })}
      </div>
      <div class="card">
        <h3>使用說明</h3>
        <ol style="margin:0;padding-left:1.2rem;line-height:1.7;color:#334155">
          <li>確認 LINE 服務在 NAS 執行：<code>http://192.168.99.220:3850/health</code></li>
          <li>API 金鑰須與 <code>D:\\Line 專案</code>（或 NAS line-notify）的 <code>INTERNAL_API_KEY</code> 相同</li>
          <li>Webhook 需公網 HTTPS 才能綁定（Messaging API）</li>
          <li>成員私訊官方帳號：<code>綁定 帳號</code> 後才收得到推播</li>
        </ol>
      </div>
    </div>`;

  bindLineSettingsForm({
    formId: 'line-form',
    onSaved: () => navigate('line-settings'),
  });
}

/** 系統設定（僅內建 Admin 帳號） */
async function renderSystemSettings(body) {
  if (!isBuiltinAdmin()) {
    body.innerHTML = `<div class="error-msg">僅系統內建 Admin 帳號可進入系統設定（其他最高權限使用者亦無法存取）</div>`;
    return;
  }

  let brand = state.systemSettings || {};
  let pdfSign = {
    enabled: false,
    hasCert: false,
    hasPass: false,
    onlyApproved: true,
    ready: false,
    reason: '線上簽核系統正式產出文件',
    location: 'Taiwan',
    contactInfo: '',
    signerName: '',
    libsReady: true,
  };
  let backupEncrypt = {
    enabled: false,
    hasPass: false,
    ready: false,
  };
  let backupDir = '';
  let announcement = {
    enabled: false,
    active: false,
    title: '',
    body: '',
    hasFile: false,
    originalName: null,
    startAt: null,
    endAt: null,
    withinPeriod: true,
    scheduleStatus: 'open',
    updatedAt: null,
  };
  let accessCfgAdmin = {
    intranetOnly: true,
    loginCidrs: '192.168.99.0/24,172.16.0.0/12,127.0.0.1,::1',
    deviceBindEnabled: true,
    deviceBindMax: 3,
  };
  try {
    const adminCfg = await api('/api/system/settings/admin');
    brand = adminCfg;
    state.systemSettings = adminCfg;
    pdfSign = { ...pdfSign, ...(adminCfg.pdfSign || {}) };
    backupEncrypt = { ...backupEncrypt, ...(adminCfg.backupEncrypt || {}) };
    backupDir = adminCfg.backupDir || '';
    announcement = { ...announcement, ...(adminCfg.announcement || {}) };
    accessCfgAdmin = { ...accessCfgAdmin, ...(adminCfg.access || {}) };
  } catch {
    try {
      brand = await api('/api/system/settings');
      state.systemSettings = brand;
    } catch {
      /* keep cache */
    }
  }

  let mailCfg = {};
  try {
    mailCfg = await api('/api/mail/config');
  } catch {
    mailCfg = { enabled: false, ready: false };
  }

  let lineCfg = {
    enabled: false,
    ready: false,
    serviceUrl: 'http://192.168.99.220:3850',
    hasApiKey: false,
    configAccess: 'any_admin',
    events: {},
    canConfigure: true,
  };
  try {
    const lc = await api('/api/line/config');
    lineCfg = { ...lineCfg, ...lc };
    state.lineCanConfigure = !!lc.canConfigure;
    state.lineConfigAccess = lc.configAccess || state.lineConfigAccess;
    state.lineReady = !!lc.ready;
    state.lineEnabled = !!lc.enabled;
  } catch {
    /* keep defaults */
  }

  const logoUrl = brand.logoUrl || '/img/argo-logo.png';
  const signStatusText = pdfSign.ready
    ? '已就緒（下載／備份 PDF 將加蓋公司數位簽章）'
    : !pdfSign.libsReady
      ? `套件未就緒${pdfSign.libsError ? '：' + pdfSign.libsError : ''}`
      : !pdfSign.hasCert
        ? '尚未上傳憑證'
        : !pdfSign.enabled
          ? '已上傳憑證，尚未啟用'
          : '尚未就緒';
  const backupEncryptStatusText = backupEncrypt.ready
    ? '已就緒（備份將以 AES-256 加密 ZIP 儲存）'
    : backupEncrypt.enabled && !backupEncrypt.hasPass
      ? '已啟用但尚未設定密碼（無法執行備份）'
      : !backupEncrypt.enabled
        ? '未啟用（備份為一般 PDF／ZIP）'
        : '尚未就緒';
  const verLabel = brand.versionLabel || (brand.version ? `v${brand.version}` : '—');
  const verFull =
    brand.versionLabelFull ||
    (brand.fullVersion ? `v${brand.fullVersion}` : verLabel);
  const verBanner = brand.versionBanner || `線上簽核系統 ${verLabel}`;
  const builtAt = brand.versionBuiltAt
    ? String(brand.versionBuiltAt).replace('T', ' ').replace(/\.\d+Z$/, ' UTC')
    : '—';

  let deployLogHtml = `<p class="muted" style="margin:0">載入自動部署紀錄中…</p>`;
  try {
    const logData = await api('/api/system/deploy-log?limit=15');
    const entries = logData.entries || [];
    if (!entries.length) {
      deployLogHtml = `<p class="muted" style="margin:0">尚無部署紀錄（下次有程式變更並重啟後會自動寫入）。</p>`;
    } else {
      deployLogHtml = `
        <p class="muted" style="margin:0 0 10px;font-size:0.85rem;line-height:1.45">
          伺服器每次啟動會比對程式指紋；有變更時寫入
          <code>data/修改紀錄-自動.md</code> 與 <code>data/deploy-history.json</code>。
          純重啟（檔案未改）不重複記一筆。
        </p>
        <div style="max-height:320px;overflow:auto;border:1px solid var(--border);border-radius:10px">
          <table class="data" style="margin:0;font-size:0.85rem;width:100%;table-layout:fixed">
            <thead>
              <tr>
                <th style="width:150px;white-space:nowrap">時間</th>
                <th style="width:160px;white-space:nowrap">版本</th>
                <th style="width:110px;white-space:nowrap">類型</th>
                <th style="min-width:180px">變更檔</th>
              </tr>
            </thead>
            <tbody>
              ${entries
                .map((e) => {
                  const ch = e.changes || {};
                  const cnt = `改${ch.modifiedCount || 0}/新${ch.addedCount || 0}/刪${ch.removedCount || 0}`;
                  const files = [
                    ...(ch.modified || []).slice(0, 3),
                    ...(ch.added || []).slice(0, 2),
                  ]
                    .map((f) => f.replace(/^server\//, 's/').replace(/^public\//, 'p/'))
                    .join(', ');
                  const tip = [
                    ...(ch.modified || []).map((f) => `改 ${f}`),
                    ...(ch.added || []).map((f) => `新 ${f}`),
                    ...(ch.removed || []).map((f) => `刪 ${f}`),
                  ]
                    .slice(0, 20)
                    .join('\n');
                  return `<tr title="${esc(tip)}">
                    <td style="white-space:nowrap">${esc(e.atLocal || e.at || '')}</td>
                    <td><code>${esc(e.label || '')}</code></td>
                    <td>${esc(e.typeLabel || e.type || '')}</td>
                    <td>${esc(cnt)}${files ? `<div class="muted" style="font-size:0.78rem">${esc(files)}</div>` : ''}</td>
                  </tr>`;
                })
                .join('')}
            </tbody>
          </table>
        </div>`;
    }
  } catch {
    deployLogHtml = `<p class="muted" style="margin:0">無法載入部署紀錄（需內建 Admin）。</p>`;
  }

  body.innerHTML = `
    <div class="system-settings-page">
    <div class="card" style="background:#eff6ff;border-color:#bfdbfe">
      <h3 style="margin-top:0">系統版本（自動）</h3>
      <p style="margin:0;font-size:1.35rem;font-weight:700;color:#1d4ed8;letter-spacing:0.04em">${esc(verLabel)}</p>
      <p class="muted" style="margin:8px 0 0;line-height:1.55;font-size:0.9rem">
        完整版號：<strong style="color:#1e3a5f">${esc(verFull)}</strong><br/>
        建置指紋：<code>${esc(brand.versionBuild || '—')}</code>
        　·　原始檔時間：${esc(builtAt)}<br/>
        ${esc(verBanner)}<br/>
        <span style="color:#0369a1">主版號來自 package.json；掃描 server／public 產生指紋，
        <strong>修改並重新部署／重啟後會自動變更</strong>，並寫入部署修改紀錄。</span>
      </p>
    </div>

    <div class="card">
      <h3 style="margin-top:0">自動部署修改紀錄</h3>
      ${deployLogHtml}
    </div>

    <div class="card">
      <h3 style="margin-top:0">公司品牌</h3>
      <p class="muted" style="margin-top:0">設定後將顯示於登入頁、側欄與 PDF 抬頭。僅系統管理員可修改。</p>
      <form id="brand-form" class="form-grid">
        <div class="field">
          <label>公司名稱 *</label>
          <input name="companyName" required maxlength="80"
            value="${esc(brand.companyName || '線上簽核系統')}"
            placeholder="顯示於系統標題與 PDF" />
        </div>
        <div class="field">
          <label>公司 Logo</label>
          <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-top:8px">
            <div style="background:#f8fafc;border:1px solid var(--border);border-radius:12px;padding:12px 16px">
              <img id="brand-logo-preview" src="${esc(logoUrl)}" alt="Logo 預覽"
                style="display:block;max-width:220px;max-height:64px;width:auto;height:auto;object-fit:contain" />
            </div>
            <div style="display:flex;flex-direction:column;gap:8px">
              <label class="btn outline sm" style="cursor:pointer;margin:0;display:inline-flex;align-items:center">
                上傳 Logo
                <input type="file" id="brand-logo-file" accept="image/png,image/jpeg,image/gif,image/webp" class="hidden" />
              </label>
              <button type="button" class="btn sm outline" id="btn-logo-reset"
                ${brand.hasCustomLogo ? '' : 'disabled'}>還原預設 Logo</button>
              <span class="muted" style="font-size:0.78rem">PNG／JPG／GIF／WEBP，建議 2MB 以內；依比例縮放</span>
            </div>
          </div>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn primary">儲存公司名稱</button>
        </div>
      </form>
    </div>

    <div class="card">
      <h3 style="margin-top:0">內網與電腦綁定</h3>
      <p class="muted" style="margin-top:0;line-height:1.55">
        限制只能從公司網段登入；並把帳號綁在常用電腦。本機 <code>127.0.0.1</code> 永遠允許，以免管理端鎖死。
      </p>
      <form id="access-form" class="form-grid">
        <div class="field check-row-box" style="grid-column:1/-1">
          <label class="check-row">
            <input type="checkbox" name="intranetOnly" ${accessCfgAdmin.intranetOnly !== false ? 'checked' : ''} />
            <span><strong>僅限內網存取</strong></span>
          </label>
        </div>
        <div class="field" style="grid-column:1/-1">
          <label>允許網段（CIDR，逗號分隔）</label>
          <input name="loginCidrs" value="${esc(accessCfgAdmin.loginCidrs || '192.168.99.0/24,172.16.0.0/12,127.0.0.1,::1')}" />
        </div>
        <div class="field check-row-box">
          <label class="check-row">
            <input type="checkbox" name="deviceBindEnabled" ${accessCfgAdmin.deviceBindEnabled !== false ? 'checked' : ''} />
            <span><strong>綁定登入電腦</strong></span>
          </label>
        </div>
        <div class="field">
          <label>每帳號最多幾台</label>
          <input name="deviceBindMax" type="number" min="1" max="10" value="${esc(String(accessCfgAdmin.deviceBindMax || 3))}" />
        </div>
        <div class="form-actions" style="grid-column:1/-1">
          <button type="submit" class="btn primary">儲存存取限制</button>
        </div>
      </form>
    </div>

    <div class="card">
      <h3 style="margin-top:0">總覽公告</h3>
      <p class="muted" style="margin-top:0;line-height:1.55">
        於<strong>總覽</strong>顯示一則公司公告卡。可上傳附件；同仁點「查看」可讀全文並開啟／下載附件。
        可設定<strong>公布期間</strong>，超過結束時間自動下架（總覽不再顯示）。
        部署不覆蓋 <code>data/</code> 內公告內容與附件。
      </p>
      <p class="muted" style="margin:0 0 12px;font-size:0.9rem">
        狀態：
        <strong style="color:${
          announcement.active
            ? '#15803d'
            : announcement.enabled
              ? '#b45309'
              : 'inherit'
        }">
          ${esc(formatAnnouncementStatus(announcement))}
        </strong>
        ${
          announcement.updatedAt
            ? ` · 更新 ${esc(String(announcement.updatedAt).replace('T', ' ').replace(/\.\d+Z$/, ''))}`
            : ''
        }
      </p>
      <form id="announcement-form" class="form-grid two">
        <div class="field check-row-box" style="grid-column:1/-1">
          <label class="check-row">
            <input type="checkbox" name="enabled" id="announcement-enabled"
              ${announcement.enabled ? 'checked' : ''} />
            <span><strong>啟用公告</strong>（須同時在公布期間內才會顯示於總覽）</span>
          </label>
        </div>
        <div class="field">
          <label>公布開始時間</label>
          <input type="datetime-local" name="startAt"
            value="${esc(toDatetimeLocalValue(announcement.startAt))}" />
          <span class="muted" style="font-size:0.78rem;display:block;margin-top:4px">留空＝立即（不限制開始）</span>
        </div>
        <div class="field">
          <label>公布結束時間</label>
          <input type="datetime-local" name="endAt"
            value="${esc(toDatetimeLocalValue(announcement.endAt))}" />
          <span class="muted" style="font-size:0.78rem;display:block;margin-top:4px">留空＝不自動下架；有填則到期後總覽不顯示</span>
        </div>
        <div class="field" style="grid-column:1/-1">
          <label>公告標題</label>
          <input name="title" maxlength="120"
            value="${esc(announcement.title || '')}"
            placeholder="例如：系統維護通知" />
        </div>
        <div class="field" style="grid-column:1/-1">
          <label>公告內容</label>
          <textarea name="body" rows="6" maxlength="8000"
            placeholder="支援多行文字…">${esc(announcement.body || '')}</textarea>
        </div>
        <div class="field" style="grid-column:1/-1">
          <label>附件（選填，總覽不顯示檔名，僅「查看」時可下載）</label>
          <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:6px">
            <label class="btn outline sm" style="cursor:pointer;margin:0;display:inline-flex">
              上傳附件
              <input type="file" id="announcement-file" class="hidden"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv,.zip,.7z" />
            </label>
            <button type="button" class="btn sm outline" id="btn-announcement-file-clear"
              ${announcement.hasFile ? '' : 'disabled'}>移除附件</button>
            <button type="button" class="btn sm outline" id="btn-announcement-preview">預覽查看</button>
          </div>
          <span class="muted" style="font-size:0.78rem;display:block;margin-top:6px">
            ${
              announcement.hasFile
                ? `目前附件：${esc(announcement.originalName || '')}`
                : '尚未上傳。允許 PDF／Office／圖片／TXT／CSV／ZIP，最大 15MB。'
            }
          </span>
        </div>
        <div class="form-actions" style="grid-column:1/-1">
          <button type="submit" class="btn primary">儲存公告</button>
        </div>
      </form>
    </div>

    <div class="card">
      <h3>PDF 數位簽章（公司憑證）</h3>
      <p class="muted" style="margin-top:0;line-height:1.55">
        使用公司 <strong>PKCS#12（.p12／.pfx）</strong> 憑證對下載／備份的 PDF 做數位簽章，
        可用 Acrobat 等軟體驗證並偵測竄改。
      </p>
      <p class="muted" style="margin:0 0 12px;font-size:0.9rem">
        狀態：<strong style="color:${pdfSign.ready ? '#15803d' : '#b45309'}">${esc(signStatusText)}</strong>
        ${pdfSign.certFileName ? ` · 憑證檔：${esc(pdfSign.certFileName)}` : ''}
        ${!pdfSign.libsReady && pdfSign.libsError ? `<br/><span style="color:#b45309">套件：${esc(pdfSign.libsError)}</span>` : ''}
      </p>

      <div style="border:1px solid #bfdbfe;background:#eff6ff;border-radius:12px;padding:14px 16px;margin-bottom:16px">
        <h4 style="margin:0 0 8px;color:#1e40af">製作數位簽章（自簽憑證）</h4>
        <p class="muted" style="margin:0 0 12px;font-size:0.85rem;line-height:1.5">
          無正式公司憑證時，可在此<strong>產生自簽 .p12</strong>並立即用於 PDF 簽章（僅供內部）。
          標示 <strong style="color:#b45309">*</strong> 為必填。
          <br/>CN／O 可填中文公司名稱；密碼請妥善保管。
        </p>
        <form id="pdf-sign-create-form" class="form-grid two">
          <div class="field">
            <label>通用名稱 CN *</label>
            <input name="commonName" required maxlength="64"
              value="${esc(brand.companyName || '')}"
              placeholder="例如：CatsHome Inc. 或公司全名" />
          </div>
          <div class="field">
            <label>組織／公司名稱 O *</label>
            <input name="organization" required maxlength="64"
              value="${esc(brand.companyName || '')}"
              placeholder="與營業登記或對外名稱一致" />
          </div>
          <div class="field">
            <label>單位／部門 OU（選填）</label>
            <input name="organizationalUnit" maxlength="64" placeholder="例如：資訊部" />
          </div>
          <div class="field">
            <label>國家代碼 C *</label>
            <input name="country" required maxlength="2" value="TW" placeholder="TW"
              style="text-transform:uppercase" />
          </div>
          <div class="field">
            <label>縣市／省 ST（選填）</label>
            <input name="province" maxlength="64" placeholder="例如：Taipei" />
          </div>
          <div class="field">
            <label>地區 L（選填）</label>
            <input name="locality" maxlength="64" placeholder="例如：Taipei City" />
          </div>
          <div class="field">
            <label>聯絡 Email（選填）</label>
            <input name="email" type="email" maxlength="80" placeholder="admin@example.com" />
          </div>
          <div class="field">
            <label>有效年數 *</label>
            <input name="validYears" type="number" required min="1" max="30" value="5" />
          </div>
          <div class="field">
            <label>憑證密碼 *</label>
            <input name="passphrase" type="password" required minlength="4" autocomplete="new-password"
              placeholder="至少 4 字元（請妥善保管）" />
          </div>
          <div class="field">
            <label>確認憑證密碼 *</label>
            <input name="passphraseConfirm" type="password" required minlength="4" autocomplete="new-password"
              placeholder="再輸入一次" />
          </div>
          <div class="field">
            <label>簽署者顯示名稱（選填）</label>
            <input name="signerName" maxlength="80"
              value="${esc(pdfSign.signerName || brand.companyName || '')}"
              placeholder="預設＝通用名稱 CN" />
          </div>
          <div class="field">
            <label>簽署原因（選填）</label>
            <input name="reason" maxlength="200"
              value="${esc(pdfSign.reason || '線上簽核系統正式產出文件')}" />
          </div>
          <div class="field" style="grid-column:1/-1">
            <label class="check-row" style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" name="enableAfterCreate" checked />
              <span>製作完成後<strong>自動啟用</strong> PDF 數位簽章</span>
            </label>
          </div>
          <div class="field" style="grid-column:1/-1">
            <label class="check-row" style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" name="onlyApproved" ${
                pdfSign.onlyApproved !== false ? 'checked' : ''
              } />
              <span>僅對<strong>已核准</strong>單據加簽（建議勾選）</span>
            </label>
          </div>
          <div class="form-actions" style="grid-column:1/-1">
            <button type="submit" class="btn primary" id="btn-pdf-sign-create">製作並儲存憑證</button>
          </div>
        </form>
        <p class="muted" style="font-size:0.78rem;margin:10px 0 0;line-height:1.45">
          注意：若已有憑證，製作新憑證會<strong>覆蓋</strong>現有 .p12。自簽憑證在 Acrobat 可能顯示「簽發者不被信任」，內部防竄改仍有效。
        </p>
      </div>

      <form id="pdf-sign-form" class="form-grid">
        <div class="field check-row-box">
          <label class="check-row">
            <input type="checkbox" name="pdfSignEnabled" id="pdf-sign-enabled"
              ${pdfSign.enabled ? 'checked' : ''} />
            <span><strong>啟用 PDF 數位簽章</strong></span>
          </label>
        </div>
        <div class="field check-row-box">
          <label class="check-row">
            <input type="checkbox" name="pdfSignOnlyApproved" id="pdf-sign-only-approved"
              ${pdfSign.onlyApproved !== false ? 'checked' : ''} />
            <span>僅對<strong>已核准</strong>單據加簽（建議勾選）</span>
          </label>
        </div>
        <div class="field">
          <label>或上傳既有公司憑證（.p12 / .pfx）</label>
          <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:6px">
            <label class="btn outline sm" style="cursor:pointer;margin:0;display:inline-flex">
              上傳憑證
              <input type="file" id="pdf-sign-cert-file" accept=".p12,.pfx,application/x-pkcs12" class="hidden" />
            </label>
            <button type="button" class="btn sm outline" id="btn-pdf-sign-cert-clear"
              ${pdfSign.hasCert ? '' : 'disabled'}>移除憑證</button>
          </div>
          <span class="muted" style="font-size:0.78rem;display:block;margin-top:6px">
            若已由 IT 核發正式 PKCS#12，可直接上傳；私鑰勿外流。
          </span>
        </div>
        <div class="field">
          <label>憑證密碼</label>
          <input name="pdfSignPass" type="password" value="" autocomplete="new-password"
            placeholder="${pdfSign.hasPass ? '已設定（留空則不變更）' : 'PKCS#12 密碼（可為空）'}" />
        </div>
        <div class="field">
          <label>簽署者顯示名稱</label>
          <input name="pdfSignSignerName" maxlength="80"
            value="${esc(pdfSign.signerName || brand.companyName || '')}"
            placeholder="預設＝公司名稱" />
        </div>
        <div class="field">
          <label>簽署原因</label>
          <input name="pdfSignReason" maxlength="200"
            value="${esc(pdfSign.reason || '線上簽核系統正式產出文件')}" />
        </div>
        <div class="field">
          <label>地點</label>
          <input name="pdfSignLocation" maxlength="80"
            value="${esc(pdfSign.location || 'Taiwan')}" />
        </div>
        <div class="field">
          <label>聯絡資訊（選填）</label>
          <input name="pdfSignContact" maxlength="120"
            value="${esc(pdfSign.contactInfo || '')}"
            placeholder="例如公司 Email" />
        </div>
        <div class="form-actions" style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="submit" class="btn primary">儲存簽章設定</button>
          <button type="button" class="btn outline" id="btn-pdf-sign-test">下載測試簽章 PDF</button>
        </div>
      </form>
      <p class="muted" style="font-size:0.8rem;margin:12px 0 0;line-height:1.5">
        驗章方式：以 Adobe Acrobat 開啟 PDF → 簽名面板應顯示簽章資訊。
      </p>
    </div>

    <div class="card">
      <h3>備份加密（AES-256）</h3>
      <p class="muted" style="margin-top:0;line-height:1.55">
        啟用後，<strong>備份資料</strong>一律以 <strong>AES-256 加密 ZIP</strong> 儲存（含僅 PDF、無附件的單據）。
        解壓時請使用支援 AES-256 的工具（如 7-Zip、WinZip、Bandizip）。
        Windows 檔案總管可能無法直接開啟 AES ZIP。
      </p>
      <p class="muted" style="margin:0 0 12px;font-size:0.9rem">
        狀態：<strong style="color:${backupEncrypt.ready ? '#15803d' : backupEncrypt.enabled ? '#b45309' : 'inherit'}">${esc(backupEncryptStatusText)}</strong>
      </p>
      <form id="backup-encrypt-form" class="form-grid">
        <div class="field check-row-box">
          <label class="check-row">
            <input type="checkbox" name="backupEncryptEnabled" id="backup-encrypt-enabled"
              ${backupEncrypt.enabled ? 'checked' : ''} />
            <span><strong>啟用備份 ZIP 加密</strong></span>
          </label>
        </div>
        <div class="field">
          <label>備份密碼</label>
          <input name="backupEncryptPass" type="password" value="" autocomplete="new-password"
            placeholder="${backupEncrypt.hasPass ? '已設定（留空則不變更）' : '設定加密密碼（請妥善保存）'}" />
        </div>
        <div class="field">
          <label>確認密碼</label>
          <input name="backupEncryptPassConfirm" type="password" value="" autocomplete="new-password"
            placeholder="再次輸入新密碼（僅在變更時）" />
        </div>
        <div class="form-actions" style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="submit" class="btn primary">儲存備份加密設定</button>
          <button type="button" class="btn outline" id="btn-backup-encrypt-clear-pass"
            ${backupEncrypt.hasPass ? '' : 'disabled'}>清除密碼</button>
        </div>
      </form>
      <p class="muted" style="font-size:0.8rem;margin:12px 0 0;line-height:1.5">
        密碼僅存於伺服器端，介面不會顯示。若遺失密碼，已加密的舊備份將無法解壓。<br/>
        變更密碼後，請勾選「強制覆寫」重新備份，既有檔案不會自動重加密。
      </p>
    </div>

    <div class="card">
      <h3>備份儲存目錄</h3>
      <p class="muted" style="margin-top:0;line-height:1.55">
        設定備份檔案的儲存根目錄。留空則使用預設路徑（<code>data/backups</code>）。
        Docker 環境請填寫容器內絕對路徑（如 <code>/mnt/nas-share/backups</code>）。
      </p>
      <form id="backup-dir-form" class="form-grid">
        <div class="field">
          <label for="backup-dir-input">備份目錄路徑</label>
          <input id="backup-dir-input" name="backupDir" type="text"
            value="${esc(backupDir)}"
            placeholder="留空使用預設：data/backups" style="font-family:monospace" />
          <span class="field-hint" style="color:#6b7280;font-size:0.82rem">
            目前：<code>${esc(backupDir || '（預設）data/backups')}</code>
          </span>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn primary" id="btn-backup-dir-save">儲存備份目錄</button>
          <button type="button" class="btn outline" id="btn-backup-dir-reset">恢復預設</button>
        </div>
      </form>
      <p class="muted" style="font-size:0.8rem;margin:12px 0 0;line-height:1.5">
        ⚠️ 變更目錄後，<strong>已備份的歷史紀錄仍指向舊路徑</strong>，新備份才會寫入新目錄。<br/>
        確認目錄存在且伺服器程序有寫入權限。不可使用 <code>..</code> 路徑穿越。
      </p>
    </div>

    <div class="card">
      <h3>💬 LINE 通知設定</h3>
      ${lineSettingsFormHtml(lineCfg, { formId: 'sys-line-form', showAccess: true })}
      <p class="muted" style="margin:12px 0 0;font-size:0.85rem">
        亦可從側欄「LINE 通知」進入同一套設定。
      </p>
    </div>

    <div class="card">
      <h3>Email 設定（SMTP）</h3>
      <p class="muted" style="margin-top:0">設定 SMTP 後，申請人可收到進度通知，並可對簽核人寄送催辦信。</p>
      <form id="mail-form" class="form-grid">
        <div class="field check-row-box">
          <label class="check-row">
            <input type="checkbox" name="enabled" id="mail-enabled" ${mailCfg.enabled ? 'checked' : ''} />
            <span><strong>啟用 Email 提醒</strong>
              <span class="muted" style="margin-left:8px;font-size:0.85rem">${
                mailCfg.ready ? 'SMTP 已就緒' : '尚未完成 SMTP 設定'
              }</span>
            </span>
          </label>
        </div>
        <div class="field"><label>SMTP 主機</label>
          <input name="host" value="${esc(mailCfg.host || '')}" placeholder="例如 smtp.gmail.com 或 mail.公司網域" /></div>
        <div class="field" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div><label>連接埠</label>
            <input name="port" type="number" id="mail-port" value="${esc(String(mailCfg.port || 587))}" /></div>
          <div class="check-row-stack">
            <label class="check-row">
              <input type="checkbox" name="secure" id="mail-secure" ${mailCfg.secure ? 'checked' : ''} />
              <span>SSL（埠 465）</span>
            </label>
            <label class="check-row">
              <input type="checkbox" name="ignoreTLS" id="mail-ignore-tls" ${
                mailCfg.ignoreTLS || Number(mailCfg.port) === 25 ? 'checked' : ''
              } />
              <span>略過 TLS（埠 25 明文請勾選）</span>
            </label>
            <label class="check-row">
              <input type="checkbox" name="requireTLS" id="mail-require-tls" ${
                mailCfg.requireTLS || Number(mailCfg.port) === 587 ? 'checked' : ''
              } />
              <span>要求 STARTTLS（埠 587）</span>
            </label>
          </div>
        </div>
        <p class="muted" style="font-size:0.82rem;margin:0 0 8px;line-height:1.45">
          常見設定：<strong>587</strong>＋STARTTLS（不勾 SSL）；<strong>465</strong>＋SSL；
          內網 <strong>25</strong>＋略過 TLS。
        </p>
        <div class="field"><label>SMTP 帳號</label>
          <input name="user" value="${esc(mailCfg.user || '')}" placeholder="完整信箱" autocomplete="off" /></div>
        <div class="field"><label>SMTP 密碼</label>
          <input name="pass" type="password" value="" placeholder="${mailCfg.hasPass ? '已設定（留空則不變更）' : '尚未設定'}" autocomplete="new-password" /></div>
        <div class="field"><label>寄件者 Email</label>
          <input name="from" type="email" value="${esc(mailCfg.from || '')}" placeholder="顯示的寄件信箱" /></div>
        <div class="field"><label>寄件者名稱</label>
          <input name="fromName" value="${esc(mailCfg.fromName || brand.companyName || '線上簽核系統')}" /></div>
        <div class="field"><label>系統網址（信內連結）</label>
          <input name="baseUrl" value="${esc(mailCfg.baseUrl || 'http://127.0.0.1:8080')}" placeholder="http://公司IP:端口" /></div>
        <div class="form-actions" style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="submit" class="btn primary">儲存 Email 設定</button>
          <button type="button" class="btn outline" id="btn-mail-test">寄送測試信</button>
        </div>
      </form>
    </div>

    <div class="card">
      <h3>系統設定完整包</h3>
      <p class="muted" style="margin-top:0;line-height:1.55">
        一次匯出／匯入：部門、成員、簽核流程與申請表、Email 設定。
      </p>
      <div class="check-group-box" style="margin-bottom:12px;background:#f8fafc">
        <strong class="check-group-title">匯出</strong>
        <label class="check-row">
          <input type="checkbox" id="pkg-export-history" />
          <span>包含歷史申請單、簽核歷程與附件</span>
        </label>
        <label class="check-row">
          <input type="checkbox" id="pkg-export-mail-pass" />
          <span>包含 SMTP 密碼（明文寫入 JSON，預設不匯出）</span>
        </label>
        <button type="button" class="btn primary" id="btn-pkg-export" style="margin-top:4px">下載設定完整包（JSON）</button>
      </div>
      <div class="check-group-box" style="background:#fff">
        <strong class="check-group-title">匯入</strong>
        <label class="check-row">
          <input type="checkbox" id="pkg-import-mail" checked />
          <span>套用 Email／SMTP 設定</span>
        </label>
        <label class="check-row">
          <input type="checkbox" id="pkg-import-history" />
          <span>匯入歷史申請</span>
        </label>
        <button type="button" class="btn outline" id="btn-pkg-import" style="margin-top:4px">選擇 JSON 並匯入…</button>
        <input type="file" id="pkg-import-file" accept=".json,application/json" class="hidden" />
        <div id="pkg-import-result" class="muted" style="margin-top:10px;font-size:0.9rem;white-space:pre-wrap"></div>
      </div>
    </div>
    </div>`;

  // 公司名稱
  $('#access-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/api/system/settings', {
        method: 'PUT',
        body: {
          intranetOnly: fd.get('intranetOnly') === 'on',
          loginCidrs: fd.get('loginCidrs'),
          deviceBindEnabled: fd.get('deviceBindEnabled') === 'on',
          deviceBindMax: Number(fd.get('deviceBindMax') || 3),
        },
      });
      toast('存取限制已儲存', 'success');
      navigate('system-settings');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  $('#brand-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const data = await api('/api/system/settings', {
        method: 'PUT',
        body: { companyName: fd.get('companyName') },
      });
      state.systemSettings = data.settings || data;
      applySystemBranding(state.systemSettings);
      toast('公司名稱已儲存', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  // Logo 上傳
  $('#brand-logo-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const fd = new FormData();
    fd.append('logo', file);
    try {
      const data = await api('/api/system/logo', { method: 'POST', body: fd });
      state.systemSettings = data.settings || data;
      applySystemBranding(state.systemSettings);
      const prev = $('#brand-logo-preview');
      if (prev && state.systemSettings.logoUrl) {
        prev.src = state.systemSettings.logoUrl;
      }
      toast('Logo 已更新', 'success');
      navigate('system-settings');
    } catch (err) {
      toast(err.message || '上傳失敗', 'error');
    }
  });

  $('#btn-logo-reset')?.addEventListener('click', async () => {
    if (!confirm('確定還原為預設 Logo？')) return;
    try {
      const data = await api('/api/system/logo', { method: 'DELETE' });
      state.systemSettings = data.settings || data;
      applySystemBranding(state.systemSettings);
      toast('已還原預設 Logo', 'success');
      navigate('system-settings');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // 總覽公告
  $('#announcement-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const startRaw = String(fd.get('startAt') || '').trim();
    const endRaw = String(fd.get('endAt') || '').trim();
    if (startRaw && endRaw && new Date(startRaw) > new Date(endRaw)) {
      toast('公布開始時間不可晚於結束時間', 'error');
      return;
    }
    try {
      const data = await api('/api/system/announcement', {
        method: 'PUT',
        body: {
          enabled: !!e.target.querySelector('#announcement-enabled')?.checked,
          title: String(fd.get('title') || '').trim(),
          body: String(fd.get('body') || ''),
          // 空字串＝清除該端限制
          startAt: startRaw || null,
          endAt: endRaw || null,
        },
      });
      state.systemSettings = data.settings || state.systemSettings;
      toast('公告已儲存', 'success');
      navigate('system-settings');
    } catch (err) {
      toast(err.message || '儲存失敗', 'error');
    }
  });

  $('#announcement-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      await api('/api/system/announcement/file', { method: 'POST', body: fd });
      toast('附件已上傳', 'success');
      navigate('system-settings');
    } catch (err) {
      toast(err.message || '上傳失敗', 'error');
    }
  });

  $('#btn-announcement-file-clear')?.addEventListener('click', async () => {
    if (!confirm('確定移除公告附件？')) return;
    try {
      await api('/api/system/announcement/file', { method: 'DELETE' });
      toast('已移除附件', 'success');
      navigate('system-settings');
    } catch (err) {
      toast(err.message || '移除失敗', 'error');
    }
  });

  $('#btn-announcement-preview')?.addEventListener('click', () => {
    const a = {
      ...announcement,
      active: true,
      _forcePreview: true,
      title: String($('#announcement-form [name="title"]')?.value || announcement.title || ''),
      body: String($('#announcement-form [name="body"]')?.value || announcement.body || ''),
    };
    if (!a.title && !a.body && !a.hasFile) {
      toast('請先填寫公告或上傳附件', 'error');
      return;
    }
    openAnnouncementModal(a);
  });

  // PDF 數位簽章 — 製作自簽憑證
  $('#pdf-sign-create-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const passphrase = String(fd.get('passphrase') || '');
    const passphraseConfirm = String(fd.get('passphraseConfirm') || '');
    if (!String(fd.get('commonName') || '').trim()) {
      toast('請填寫通用名稱（CN）', 'error');
      return;
    }
    if (!String(fd.get('organization') || '').trim()) {
      toast('請填寫組織／公司名稱（O）', 'error');
      return;
    }
    if (!String(fd.get('country') || '').trim()) {
      toast('請填寫國家代碼（C）', 'error');
      return;
    }
    if (passphrase.length < 4) {
      toast('憑證密碼至少 4 個字元', 'error');
      return;
    }
    if (passphrase !== passphraseConfirm) {
      toast('兩次輸入的憑證密碼不一致', 'error');
      return;
    }
    if (
      pdfSign.hasCert &&
      !confirm('已有公司憑證，確定以新製作的憑證覆蓋？')
    ) {
      return;
    }
    const btn = $('#btn-pdf-sign-create');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '製作中…';
    }
    try {
      const data = await api('/api/system/pdf-sign/create', {
        method: 'POST',
        body: {
          commonName: String(fd.get('commonName') || '').trim(),
          organization: String(fd.get('organization') || '').trim(),
          organizationalUnit: String(fd.get('organizationalUnit') || '').trim(),
          country: String(fd.get('country') || 'TW').trim(),
          province: String(fd.get('province') || '').trim(),
          locality: String(fd.get('locality') || '').trim(),
          email: String(fd.get('email') || '').trim(),
          validYears: Number(fd.get('validYears') || 5),
          passphrase,
          passphraseConfirm,
          signerName: String(fd.get('signerName') || '').trim(),
          reason: String(fd.get('reason') || '').trim(),
          enableAfterCreate: !!e.target.querySelector('[name="enableAfterCreate"]')
            ?.checked,
          onlyApproved: !!e.target.querySelector('[name="onlyApproved"]')?.checked,
        },
      });
      const until = data.meta?.notAfter
        ? String(data.meta.notAfter).slice(0, 10)
        : '';
      toast(
        until
          ? `已製作憑證（有效至 ${until}），可下載測試 PDF 驗證`
          : '已製作並儲存自簽憑證',
        'success'
      );
      navigate('system-settings');
    } catch (err) {
      const msg = err && err.message ? String(err.message) : '製作失敗';
      toast(msg.length > 120 ? msg.slice(0, 120) + '…' : msg, 'error');
      console.error('[pdf-sign create]', err);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '製作並儲存憑證';
      }
    }
  });

  // PDF 數位簽章 — 儲存設定
  $('#pdf-sign-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/api/system/settings', {
        method: 'PUT',
        body: {
          pdfSignEnabled: !!e.target.querySelector('#pdf-sign-enabled')?.checked,
          pdfSignOnlyApproved: !!e.target.querySelector('#pdf-sign-only-approved')
            ?.checked,
          pdfSignReason: fd.get('pdfSignReason') || '',
          pdfSignLocation: fd.get('pdfSignLocation') || '',
          pdfSignContact: fd.get('pdfSignContact') || '',
          pdfSignSignerName: fd.get('pdfSignSignerName') || '',
          pdfSignPass: fd.get('pdfSignPass') || '',
        },
      });
      toast('PDF 簽章設定已儲存', 'success');
      navigate('system-settings');
    } catch (err) {
      toast(err.message || '儲存失敗', 'error');
    }
  });

  $('#pdf-sign-cert-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const fd = new FormData();
    fd.append('cert', file);
    const pass = document.querySelector('#pdf-sign-form [name="pdfSignPass"]')?.value;
    if (pass) fd.append('passphrase', pass);
    try {
      await api('/api/system/pdf-sign/cert', { method: 'POST', body: fd });
      toast('憑證已上傳', 'success');
      navigate('system-settings');
    } catch (err) {
      toast(err.message || '憑證上傳失敗', 'error');
    }
  });

  $('#btn-pdf-sign-cert-clear')?.addEventListener('click', async () => {
    if (!confirm('確定移除公司簽章憑證？')) return;
    try {
      await api('/api/system/pdf-sign/cert', { method: 'DELETE' });
      toast('已移除憑證', 'success');
      navigate('system-settings');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  $('#btn-pdf-sign-test')?.addEventListener('click', async () => {
    try {
      const blob = await api('/api/system/pdf-sign/test', {
        method: 'POST',
        body: {},
        expectBlob: true,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = '簽章測試.pdf';
      a.click();
      URL.revokeObjectURL(url);
      toast('已下載測試 PDF，請用 Acrobat 檢查簽章', 'success');
    } catch (err) {
      toast(err.message || '測試失敗', 'error');
    }
  });

  // 備份加密
  $('#backup-encrypt-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const enabled = !!e.target.querySelector('#backup-encrypt-enabled')?.checked;
    const pass = String(fd.get('backupEncryptPass') || '');
    const confirm = String(fd.get('backupEncryptPassConfirm') || '');
    if (pass || confirm) {
      if (pass !== confirm) {
        toast('兩次輸入的備份密碼不一致', 'error');
        return;
      }
      if (pass.length < 4) {
        toast('備份密碼至少 4 個字元', 'error');
        return;
      }
    }
    if (enabled && !backupEncrypt.hasPass && !pass) {
      toast('啟用加密時請設定備份密碼', 'error');
      return;
    }
    try {
      await api('/api/system/settings', {
        method: 'PUT',
        body: {
          backupEncryptEnabled: enabled,
          backupEncryptPass: pass || '',
        },
      });
      toast('備份加密設定已儲存', 'success');
      navigate('system-settings');
    } catch (err) {
      toast(err.message || '儲存失敗', 'error');
    }
  });

  $('#btn-backup-encrypt-clear-pass')?.addEventListener('click', async () => {
    if (
      !confirm(
        '確定清除備份密碼？\n若仍啟用加密，將無法執行新備份；已加密的舊檔仍需原密碼才能解壓。'
      )
    ) {
      return;
    }
    try {
      await api('/api/system/settings', {
        method: 'PUT',
        body: {
          backupEncryptPassClear: true,
          backupEncryptEnabled: false,
        },
      });
      toast('已清除備份密碼並關閉加密', 'success');
      navigate('system-settings');
    } catch (err) {
      toast(err.message || '清除失敗', 'error');
    }
  });

  // 備份目錄
  $('#backup-dir-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const dir = String(fd.get('backupDir') || '').trim();
    if (dir && dir.includes('..')) {
      toast('備份目錄不可包含「..」路徑穿越', 'error');
      return;
    }
    try {
      await api('/api/system/settings', {
        method: 'PUT',
        body: { backupDir: dir },
      });
      toast('備份目錄已儲存' + (dir ? `：${dir}` : '（已恢復預設）'), 'success');
      navigate('system-settings');
    } catch (err) {
      toast(err.message || '儲存失敗', 'error');
    }
  });

  $('#btn-backup-dir-reset')?.addEventListener('click', async () => {
    try {
      await api('/api/system/settings', {
        method: 'PUT',
        body: { backupDir: '' },
      });
      toast('備份目錄已恢復為預設（data/backups）', 'success');
      navigate('system-settings');
    } catch (err) {
      toast(err.message || '清除失敗', 'error');
    }
  });

  // LINE（系統設定內嵌）
  bindLineSettingsForm({
    formId: 'sys-line-form',
    onSaved: () => navigate('system-settings'),
  });

  // Mail
  const mailForm = $('#mail-form');
  if (mailForm) {
    mailForm.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await api('/api/mail/config', {
          method: 'PUT',
          body: {
            enabled: !!e.target.querySelector('#mail-enabled')?.checked,
            host: fd.get('host') || '',
            port: Number(fd.get('port')) || 587,
            secure: !!e.target.querySelector('#mail-secure')?.checked,
            ignoreTLS: !!e.target.querySelector('#mail-ignore-tls')?.checked,
            requireTLS: !!e.target.querySelector('#mail-require-tls')?.checked,
            user: fd.get('user') || '',
            pass: fd.get('pass') || '',
            from: fd.get('from') || '',
            fromName: fd.get('fromName') || brand.companyName || '線上簽核系統',
            baseUrl: fd.get('baseUrl') || 'http://127.0.0.1:8080',
          },
        });
        toast('Email 設定已儲存', 'success');
        navigate('system-settings');
      } catch (err) {
        toast(err.message, 'error');
      }
    };
    $('#mail-port')?.addEventListener('change', () => {
      const p = Number($('#mail-port')?.value) || 587;
      const sec = $('#mail-secure');
      const ign = $('#mail-ignore-tls');
      const req = $('#mail-require-tls');
      if (p === 465 && sec) sec.checked = true;
      if (p === 25) {
        if (sec) sec.checked = false;
        if (ign) ign.checked = true;
        if (req) req.checked = false;
      }
      if (p === 587) {
        if (sec) sec.checked = false;
        if (ign) ign.checked = false;
        if (req) req.checked = true;
      }
    });
    $('#btn-mail-test')?.addEventListener('click', async () => {
      try {
        const data = await api('/api/mail/test', { method: 'POST', body: {} });
        const mode =
          data.result?.mode === 'outbox' ? '（僅寫入 outbox，未真正寄出）' : '';
        toast(`測試信已寄出${mode}`, 'success');
      } catch (err) {
        toast(err.message || '測試信寄送失敗', 'error');
      }
    });
  }

  // Package
  $('#btn-pkg-export')?.addEventListener('click', async () => {
    const history = $('#pkg-export-history')?.checked ? '1' : '0';
    const mailSecrets = $('#pkg-export-mail-pass')?.checked ? '1' : '0';
    if (mailSecrets === '1') {
      const ok = confirm(
        '將把 SMTP 密碼以明文寫入 JSON 設定包。\n檔案請勿放入一鍵安裝包或 Git。\n確定仍要匯出密碼？'
      );
      if (!ok) return;
    }
    try {
      const confirmMail = mailSecrets === '1' ? '1' : '0';
      const blob = await api(
        `/api/system/package/export?includeHistory=${history}&includeMailSecrets=${mailSecrets}&confirmMailSecrets=${confirmMail}`,
        { expectBlob: true }
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `簽核系統_${history === '1' ? '完整含歷史' : '設定'}包_${twToday()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast('設定完整包已下載', 'success');
    } catch (err) {
      toast(err.message || '匯出失敗', 'error');
    }
  });
  $('#btn-pkg-import')?.addEventListener('click', () => {
    $('#pkg-import-file')?.click();
  });
  $('#pkg-import-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const importMail = $('#pkg-import-mail')?.checked;
    const importHistory = $('#pkg-import-history')?.checked;
    if (
      !confirm(
        `確定匯入「${file.name}」？\n將合併更新部門、成員、流程` +
          (importMail ? '、Email' : '') +
          (importHistory ? '，並匯入歷史' : '')
      )
    ) {
      return;
    }
    const fd = new FormData();
    fd.append('package', file);
    fd.append('importMail', importMail ? '1' : '0');
    fd.append('importHistory', importHistory ? '1' : '0');
    const resultEl = $('#pkg-import-result');
    if (resultEl) resultEl.textContent = '匯入中…';
    try {
      const data = await api('/api/system/package/import', { method: 'POST', body: fd });
      toast(data.message || '匯入完成', 'success');
      if (resultEl) resultEl.textContent = JSON.stringify(data.result || data, null, 2);
      try {
        await loadUsers(true);
        await loadWorkflows(true);
        await loadSystemSettings();
      } catch {
        /* ignore */
      }
    } catch (err) {
      toast(err.message || '匯入失敗', 'error');
      if (resultEl) resultEl.textContent = err.message || '匯入失敗';
    }
  });
}

if (typeof boot === 'function') {
  boot();
}

