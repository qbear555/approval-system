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

  let userSig = u.signature_image || null;
  try {
    const sigRes = await api('/api/users/me/signature');
    userSig = sigRes.signature_image || userSig;
    if (userSig) {
      state.user = { ...(state.user || {}), signature_image: userSig, has_signature: true };
    }
  } catch {
    /* ignore */
  }

  // 一般使用者不可改姓名／Email（僅系統管理員 role=admin 可改）
  const canEditIdentity = isAdmin();
  const roAttr = 'readonly disabled tabindex="-1"';
  body.innerHTML = `
    <div class="card" style="max-width:560px">
      <h3>我的資料</h3>
      <p class="muted" style="margin-top:0">${
        canEditIdentity
          ? '管理員可修改姓名、Email、分機與電話。帳號與部門請於「成員名單」管理。'
          : '一般使用者<strong>無法修改姓名與 Email</strong>（由系統管理員設定）。您可更新分機、電話、通知偏好與密碼。'
      }</p>
      <form id="profile-form" class="form-grid">
        <div class="field">
          <label>帳號</label>
          <input type="text" value="${esc(u.username || '')}" disabled class="input-readonly" />
        </div>
        <div class="field">
          <label>部門</label>
          <input type="text" value="${esc(depts)}" disabled class="input-readonly" />
        </div>
        <div class="field">
          <label>角色</label>
          <input type="text" value="${u.role === 'admin' ? '系統管理員' : '使用者'}" disabled class="input-readonly" />
        </div>
        <div class="field">
          <label>姓名${canEditIdentity ? ' *' : ''}</label>
          <input name="name" maxlength="80" value="${esc(u.name || '')}" placeholder="顯示名稱"
            ${canEditIdentity ? 'required' : roAttr + ' class="input-readonly"'} />
          ${
            canEditIdentity
              ? ''
              : '<div class="muted" style="font-size:0.82rem;margin-top:4px">僅供檢視；如需更正請聯絡系統管理員</div>'
          }
        </div>
        <div class="field">
          <label>Email</label>
          <input name="email" type="email" maxlength="120" value="${esc(u.email || '')}" placeholder="選填，例：name@company.com"
            ${canEditIdentity ? '' : roAttr + ' class="input-readonly"'} />
          <div class="muted" style="font-size:0.82rem;margin-top:4px">${
            canEditIdentity
              ? '用於接收簽核結果與待簽核提醒'
              : '僅供檢視；用於通知。如需變更請聯絡系統管理員'
          }</div>
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
          </button>`;
        }).join('')}
      </div>
      <div class="form-actions" style="margin-top:14px">
        <button type="button" class="btn primary" id="btn-save-theme">🎨 儲存並套用主題</button>
        <button type="button" class="btn outline" id="btn-reset-theme">還原預設藍調</button>
      </div>
    </div>
    <div class="card" style="max-width:560px" id="agent-settings-card">
      <h3 style="margin-top:0">我的代理人</h3>
      <p class="muted" style="margin-top:0;font-size:0.9rem">
        此設定用於<strong>可代簽您的待辦</strong>。
        <strong>代簽不含財務部發出的簽核</strong>（申請人或代申請人隸屬財務部者，代理人看不到、也不能代簽；仍須您本人處理）。
        另：請假單表單「代理人」即<strong>職務代理人</strong>，於您請假起迄期間可代您簽核（同樣不含財務部發出的單）。
        「代申請請假」無需此授權（任何人皆可於請假流程代同仁送出）。
        不會更動已在簽核中的舊單據。
      </p>
      <div id="agent-settings-body" class="muted">載入中…</div>
    </div>
    ${
      SIGNATURE_SETTINGS_ENABLED
        ? `<div class="card" style="max-width:560px">
      <h3>✍️ 個人電子簽名檔</h3>
      <p class="muted" style="margin-top:0">
        可先設定個人手寫簽名。核准時預設套用此簽名；亦可選擇現場手寫。簽名會出現在簽核歷程與 PDF。
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
    </div>`
        : ''
    }
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
        ${
          canEditIdentity
            ? '請在上方填寫 Email 並勾選通知偏好。'
            : 'Email 由管理員設定；請確認上方信箱正確並勾選通知偏好。'
        }
        申請送出後，可在簽核詳情點「Email 催辦簽核人」。
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
  document.querySelectorAll('.theme-card').forEach((card) => {
    card.addEventListener('click', () => {
      selectedThemeId = card.dataset.themeId;
      document.querySelectorAll('.theme-card').forEach((c) => {
        c.classList.remove('active', 'primary');
        c.removeAttribute('style');
        const themeObj = THEMES.find((t) => t.id === c.dataset.themeId);
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
  $('#btn-save-theme')?.addEventListener('click', () => {
    applyUserTheme(selectedThemeId, true);
    const themeObj = THEMES.find((t) => t.id === selectedThemeId) || THEMES[0];
    toast(`已成功套用「${themeObj.name}」客製化主題！`, 'success');
  });
  $('#btn-reset-theme')?.addEventListener('click', () => {
    selectedThemeId = 'navy';
    applyUserTheme('navy', true);
    document.querySelectorAll('.theme-card').forEach((c) => {
      c.classList.toggle('active', c.dataset.themeId === 'navy');
    });
    toast('已還原為預設經典藍調主題！', 'success');
  });

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
          state.user = { ...state.user, signature_image: dataUrl, has_signature: true };
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
        state.user = { ...state.user, signature_image: dataUrl, has_signature: true };
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
      state.user = { ...state.user, signature_image: null, has_signature: false };
      toast(res.message || '簽名檔已清除', 'success');
      navigate('settings');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  $('#profile-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = {
      extension: fd.get('extension') || '',
      phone: fd.get('phone') || '',
      email_notify: e.target.querySelector('#email-notify-pref')?.checked ? 1 : 0,
    };
    if (canEditIdentity) {
      payload.name = fd.get('name');
      payload.email = fd.get('email') || '';
    } else {
      payload.name = u.name || '';
      payload.email = u.email || '';
    }
    try {
      const data = await api('/api/auth/profile', {
        method: 'PUT',
        body: payload,
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

  // 我的代理人
  (async () => {
    const box = $('#agent-settings-body');
    if (!box) return;
    try {
      await loadUsers();
      const data = await api('/api/agents/me');
      const cur = data.myAgent;
      const asFor = data.asAgentFor || [];
      const users = (state.users || []).filter(
        (x) => x.active !== 0 && x.id !== state.user?.id
      );
      const curId = cur?.agent_id || '';
      box.innerHTML = `
        <form id="agent-form" class="form-grid">
          <div class="field">
            <label>代理人</label>
            <select name="agent_id" id="agent-select">
              <option value="">（不設定）</option>
              ${users
                .map(
                  (x) =>
                    `<option value="${x.id}" ${
                      Number(curId) === Number(x.id) ? 'selected' : ''
                    }>${esc(x.name)}${
                      x.department ? `（${esc(x.department)}）` : ''
                    }</option>`
                )
                .join('')}
            </select>
          </div>
          <div class="field">
            <label>生效起（選填）</label>
            <input type="datetime-local" name="start_at" value="${
              cur?.start_at
                ? esc(String(cur.start_at).replace(' ', 'T').slice(0, 16))
                : ''
            }" />
          </div>
          <div class="field">
            <label>生效迄（選填）</label>
            <input type="datetime-local" name="end_at" value="${
              cur?.end_at
                ? esc(String(cur.end_at).replace(' ', 'T').slice(0, 16))
                : ''
            }" />
          </div>
          <div class="field">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" name="can_approve" ${
                !cur || cur.can_approve ? 'checked' : ''
              } />
              可代簽（處理我的待簽核；不含財務部發出的簽核）
            </label>
          </div>
          <div class="field hidden">
            <!-- 代申請請假已全面開放，不再依此勾選限制；保留欄位相容後端 -->
            <input type="checkbox" name="can_submit_leave" checked />
          </div>
          <div class="field">
            <label>備註</label>
            <input name="note" maxlength="200" value="${esc(cur?.note || '')}" placeholder="選填" />
          </div>
          <div class="form-actions" style="gap:8px">
            <button type="submit" class="btn primary">儲存代理人</button>
            <button type="button" class="btn outline" id="btn-clear-agent">清除</button>
          </div>
        </form>
        ${
          asFor.length
            ? `<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border)">
                <strong style="font-size:0.92rem">我目前可代理</strong>
                <ul style="margin:8px 0 0;padding-left:18px">
                  ${asFor
                    .map(
                      (a) =>
                        `<li style="margin:4px 0">${esc(
                          a.principal?.name || '#' + a.principal_id
                        )}
                        <span class="muted" style="font-size:0.82rem">
                          ${
                            a.source === 'leave_duty'
                              ? '·請假職務代理'
                              : `${a.can_approve ? '·代簽' : ''}${
                                  a.can_submit_leave ? '·代請假' : ''
                                }`
                          }
                          ${
                            a.start_at || a.end_at
                              ? `（${esc(
                                  [a.start_at, a.end_at]
                                    .filter(Boolean)
                                    .map((x) => String(x).slice(0, 16))
                                    .join('～')
                                )}）`
                              : ''
                          }
                        </span></li>`
                    )
                    .join('')}
                </ul>
              </div>`
            : ''
        }`;
      $('#agent-form').onsubmit = async (ev) => {
        ev.preventDefault();
        const f = new FormData(ev.target);
        const agentId = f.get('agent_id');
        if (!agentId) {
          toast('請選擇代理人，或按「清除」', 'error');
          return;
        }
        try {
          await api('/api/agents/me', {
            method: 'PUT',
            body: {
              agent_id: Number(agentId),
              start_at: f.get('start_at') || null,
              end_at: f.get('end_at') || null,
              can_approve: !!ev.target.querySelector('[name=can_approve]')?.checked,
              can_submit_leave: !!ev.target.querySelector('[name=can_submit_leave]')
                ?.checked,
              note: f.get('note') || '',
            },
          });
          toast('代理人已儲存', 'success');
          navigate('settings');
        } catch (err) {
          toast(err.message, 'error');
        }
      };
      $('#btn-clear-agent').onclick = async () => {
        if (!confirm('確定清除代理人設定？')) return;
        try {
          await api('/api/agents/me', { method: 'DELETE' });
          toast('已清除代理人', 'success');
          navigate('settings');
        } catch (err) {
          toast(err.message, 'error');
        }
      };
    } catch (err) {
      box.innerHTML = `<div class="error-msg">${esc(err.message || '載入失敗')}</div>`;
    }
  })();

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
