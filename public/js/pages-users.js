/**
 * 成員名單
 * 依賴 app.js 掛到 window 的 state、$、api、esc、toast、navigate 等。
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
