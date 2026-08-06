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
        const id = a.id ? ` id="${_esc(a.id)}"` : '';
        return `<button type="button" class="${cls}"${go}${id}>${_esc(a.label)}</button>`;
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
   * @param {{ label: string, value: string|number, go?: string, hint?: string, disabled?: boolean }} opts
   */
  function statCardHtml(opts) {
    const o = opts || {};
    const clickable = o.go && !o.disabled;
    const tag = clickable ? 'button' : 'div';
    const type = clickable ? ' type="button"' : '';
    const go = clickable ? ` data-go="${_esc(o.go)}"` : '';
    const label = String(o.label || '');

    let colorCls = ' total';
    if (label.includes('待我') || label.includes('待辦') || label.includes('待簽')) colorCls = ' pending';
    else if (label.includes('完成') || label.includes('核准')) colorCls = ' approved';
    else if (label.includes('駁回') || label.includes('失敗')) colorCls = ' rejected';
    else if (label.includes('進行') || label.includes('審核')) colorCls = ' pending';

    const cls = `stat-card${colorCls}${clickable ? ' stat-card-clickable' : ''}${o.disabled ? ' stat-card-disabled' : ''}`;
    const hint =
      o.hint != null
        ? o.hint
        : clickable
          ? '點擊查看'
          : '';
    return `
      <${tag} class="${cls}"${type}${go}${clickable ? ` title="${_esc(hint || o.label)}"` : ''}>
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
          global.navigate(btn.dataset.go);
        }
      };
    });
  }

  global.emptyState = emptyState;
  global.statCardHtml = statCardHtml;
  global.bindDataGo = bindDataGo;
})(typeof window !== 'undefined' ? window : globalThis);
