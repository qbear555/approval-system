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
                  <table class="data">
                    <thead>
                      <tr>
                        <th>姓名</th><th>帳號</th><th>角色</th><th>隸屬部門</th>
                        ${canManage ? '<th>操作</th>' : ''}
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

function openCosignModal(request, onDone) {
  const me = state.user?.id;
  const users = (state.users || []).filter((u) => u.active !== 0 && u.id !== me);
  openModal(`
    <h3>➕ 簽核加簽請託</h3>
    <p class="muted" style="margin-top:0">
      臨時邀請其他同仁加簽。只會改這一張單的簽核路徑，其他進行中單據不受影響。
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
          <option value="current" selected>先經加簽同仁簽核（再回到原步驟）</option>
          <option value="after">於本關核准後，插入下一步驟</option>
        </select>
      </div>
      <div class="field">
        <label>加簽說明 / 請託意見</label>
        <textarea name="comment" rows="3" placeholder="請填寫加簽說明或請同仁協助的項目…"></textarea>
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
      將目前步驟的簽核權限轉交給指定同仁（您將不再為此步驟簽核人）。只改這一張單。
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

function openSignaturePadModal(opts = {}) {
  const { title = '手寫電子簽名', initialImage = null, onSave } = opts;
  const html = `
    <div style="max-width:520px;width:100%;margin:0 auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <h3 style="margin:0">${esc(title)}</h3>
        <button type="button" class="btn ghost sm" data-close-modal>✕</button>
      </div>
      <p class="muted" style="margin:0 0 12px;font-size:0.88rem">
        請在下方白板處以滑鼠或手指／觸控筆畫出您的簽名：
      </p>
      <div style="border:2px dashed #94a3b8;border-radius:12px;background:#fff;padding:6px;text-align:center;touch-action:none">
        <canvas id="sig-pad-canvas" width="460" height="200" style="width:100%;max-width:460px;height:200px;display:block;margin:0 auto;cursor:crosshair;background:#ffffff;border-radius:8px;border:1px solid #e2e8f0"></canvas>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:14px;gap:10px;flex-wrap:wrap">
        <div>
          <button type="button" class="btn outline sm" id="btn-sig-clear">🧹 清除重寫</button>
        </div>
        <div style="display:flex;gap:8px">
          <button type="button" class="btn ghost sm" data-close-modal>取消</button>
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

  function stopDraw() {
    isDrawing = false;
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
