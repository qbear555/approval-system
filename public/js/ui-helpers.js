/**
 * 共用 UI 小元件（P2：空狀態、可點統計卡、導覽綁定）
 * 依賴全域 esc()（由 app.js 提供）；若尚未定義則內建簡易跳脫。
 */
(function (global) {
  function _esc(s) {
    if (typeof global.esc === 'function') return global.esc(s);
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * 統一空狀態區塊
   * @param {{ title: string, desc?: string, actions?: Array<{label:string, go?:string, id?:string, primary?:boolean, outline?:boolean}> }} opts
   */
  function emptyState(opts) {
    const o = opts || {};
    const title = o.title || '尚無資料';
    const desc = o.desc || '';
    const actions = Array.isArray(o.actions) ? o.actions : [];
    const actionHtml = actions
      .map((a) => {
        const cls = a.primary ? 'btn primary' : a.outline !== false ? 'btn outline' : 'btn';
        const go = a.go ? ` data-go="${_esc(a.go)}"` : '';
        const status = a.status ? ` data-status="${_esc(a.status)}"` : '';
        const id = a.id ? ` id="${_esc(a.id)}"` : '';
        return `<button type="button" class="${cls}"${go}${status}${id}>${_esc(a.label)}</button>`;
      })
      .join('');
    return `
      <div class="empty empty-state">
        <div class="empty-icon" aria-hidden="true">◇</div>
        <div class="empty-title">${_esc(title)}</div>
        ${desc ? `<div class="empty-desc">${_esc(desc)}</div>` : ''}
        ${actionHtml ? `<div class="empty-actions form-actions" style="justify-content:center;margin-top:14px">${actionHtml}</div>` : ''}
      </div>`;
  }

  /**
   * 總覽統計卡（可點）
   * @param {{ label: string, value: string|number, go?: string, status?: string, hint?: string, disabled?: boolean, tone?: string }} opts
   * tone: amber | blue | green | teal | purple | indigo | slate | rose
   */
  function statCardHtml(opts) {
    const o = opts || {};
    const clickable = o.go && !o.disabled;
    const tag = clickable ? 'button' : 'div';
    const type = clickable ? ' type="button"' : '';
    const go = clickable ? ` data-go="${_esc(o.go)}"` : '';
    const status = clickable && o.status ? ` data-status="${_esc(o.status)}"` : '';
    const tone = String(o.tone || '')
      .toLowerCase()
      .replace(/[^a-z]/g, '');
    const toneCls = tone ? ` stat-card-${tone}` : '';
    const cls = `stat-card${toneCls}${clickable ? ' stat-card-clickable' : ''}${o.disabled ? ' stat-card-disabled' : ''}`;
    const hint =
      o.hint != null
        ? o.hint
        : clickable
          ? '點擊查看'
          : '';
    return `
      <${tag} class="${cls}"${type}${go}${status}${clickable ? ` title="${_esc(hint || o.label)}"` : ''}>
        <div class="label">${_esc(o.label)}</div>
        <div class="value">${_esc(String(o.value ?? '—'))}</div>
        ${hint ? `<div class="stat-hint">${_esc(hint)}</div>` : ''}
      </${tag}>`;
  }

  /** 綁定 [data-go] 導覽（需全域 navigate） */
  function bindDataGo(root) {
    const el = root || document;
    el.querySelectorAll('[data-go]').forEach((btn) => {
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof global.navigate === 'function') {
          const params = {};
          if (btn.dataset.status) params.status = btn.dataset.status;
          if (btn.dataset.id) params.id = Number(btn.dataset.id);
          global.navigate(btn.dataset.go, params);
        }
      };
    });
  }

  global.emptyState = emptyState;
  global.statCardHtml = statCardHtml;
  global.bindDataGo = bindDataGo;
})(typeof window !== 'undefined' ? window : globalThis);
