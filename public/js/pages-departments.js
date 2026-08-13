/**
 * 部門
 * 依賴 app.js 掛到 window 的 state、$、api、esc、toast、navigate 等。
 */
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
