/**
 * 帳號設定／手寫簽名
 * 依賴 app.js 掛到 window 的 state、$、api、esc、toast、navigate 等。
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
