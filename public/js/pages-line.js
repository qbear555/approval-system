/**
 * LINE 通知設定
 * 依賴 app.js 掛到 window 的 state、$、api、esc、toast、navigate 等。
 */
/** LINE 設定表單 HTML（側欄頁與系統設定共用） */
function lineSettingsFormHtml(cfg = {}, opts = {}) {
  const adminOnly = cfg.adminOnly !== false;
  const showAccess = !adminOnly && opts.showAccess !== false && isBuiltinAdmin();
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
      目前<strong>僅內建 Admin</strong>可設定與收推播；其他人即使已綁定也不會收到。
      Admin 請對官方帳號傳送 <code>綁定 Admin</code>。
      LINE Developers 的 Webhook 必須是<strong>公網 HTTPS</strong>，例如 <code>https://catshome.tw:3848/line/webhook</code>。
      解除可傳 <code>解除綁定</code>，或在下方列表按「解除」。
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
          .slice(0, 50)
          .map((b) => {
            const uname = String(b.username || '');
            return `<tr>
              <td>${esc(uname || '—')}</td>
              <td style="font-family:monospace;font-size:0.8rem">${esc(
                String(b.lineUserId || b.userId || '').slice(0, 24)
              )}</td>
              <td><button type="button" class="btn ghost sm" data-line-unbind="${esc(uname)}">解除</button></td>
            </tr>`;
          })
          .join('');
        box.innerHTML = `
          <strong>已綁定帳號（${list.length} 筆）</strong>
          <table class="data" style="margin-top:8px;font-size:0.85rem;width:100%">
            <thead><tr><th>簽核帳號</th><th>LINE userId</th><th></th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
          <p class="muted" style="margin:8px 0 0;font-size:0.82rem">成員也可在 LINE 傳「解除綁定」自行取消。</p>`;
        box.querySelectorAll('[data-line-unbind]').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const uname = btn.getAttribute('data-line-unbind') || '';
            if (!uname || !confirm(`確定解除「${uname}」的 LINE 綁定？`)) return;
            try {
              await api(`/api/line/bindings/${encodeURIComponent(uname)}`, { method: 'DELETE' });
              toast(`已解除 ${uname} 的 LINE 綁定`, 'success');
              btn.closest('tr')?.remove();
            } catch (err) {
              toast(err.message || '解除失敗', 'error');
            }
          });
        });
      })
      .catch(() => {
        box.innerHTML = '無法載入綁定列表（服務未就緒或 API 金鑰不符）';
      });
  }
}
