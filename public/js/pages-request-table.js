/**
 * 表單表格編輯與收集
 * 依賴 app.js 掛到 window 的 state、$、api、esc、toast、navigate 等。
 */
function normalizeFormTable(raw) {
  if (!raw) return null;
  let obj = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== 'object') return null;
  let cells = obj.cells;
  if (!Array.isArray(cells) || !cells.length) return null;
  cells = cells.map((row) =>
    (Array.isArray(row) ? row : []).map((c) => String(c ?? ''))
  );
  const cols = Math.max(
    1,
    ...cells.map((r) => r.length),
    Number(obj.cols) || 0
  );
  cells = cells.map((r) => {
    const next = r.slice(0, cols);
    while (next.length < cols) next.push('');
    return next;
  });
  // 全空白表格視為無
  const hasContent = cells.some((r) => r.some((c) => String(c).trim()));
  if (!hasContent) return null;
  return {
    rows: cells.length,
    cols,
    header: obj.header !== false,
    cells,
  };
}

function emptyFormTable(rows = 3, cols = 3) {
  const r = Math.min(20, Math.max(1, Number(rows) || 3));
  const c = Math.min(10, Math.max(1, Number(cols) || 3));
  return {
    rows: r,
    cols: c,
    header: true,
    cells: Array.from({ length: r }, () => Array.from({ length: c }, () => '')),
  };
}

function renderFormTableEditorHtml(fieldId, table) {
  const t = normalizeFormTable(table) || emptyFormTable(3, 3);
  const head = t.header;
  let html = `<table class="form-draw-table" data-table-grid="${esc(fieldId)}"><tbody>`;
  t.cells.forEach((row, ri) => {
    html += '<tr>';
    row.forEach((cell, ci) => {
      const tag = head && ri === 0 ? 'th' : 'td';
      html += `<${tag} contenteditable="true" data-r="${ri}" data-c="${ci}" spellcheck="false">${esc(cell)}</${tag}>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  html += `<div class="muted" style="font-size:0.78rem;margin-top:6px">表格 ${t.rows} 列 × ${t.cols} 欄${head ? '（首列為表頭）' : ''}</div>`;
  return html;
}

function readFormTableFromDom(root, fieldId) {
  const grid = root.querySelector(`[data-table-grid="${fieldId}"]`);
  if (!grid) return null;
  const rows = [...grid.querySelectorAll('tr')];
  if (!rows.length) return null;
  const cells = rows.map((tr) =>
    [...tr.querySelectorAll('th,td')].map((td) =>
      (td.innerText || td.textContent || '').replace(/\u00a0/g, ' ').trimEnd()
    )
  );
  return normalizeFormTable({ cells, header: true });
}

function syncFormTableHidden(root, fieldId) {
  const hidden = root.querySelector(
    `input[data-table-for="${fieldId}"][data-type="form_table"]`
  );
  if (!hidden) return;
  const t = readFormTableFromDom(root, fieldId);
  hidden.value = t ? JSON.stringify(t) : '';
  const tools = root.querySelector(`[data-table-tools="${fieldId}"]`);
  const wrap = root.querySelector(`[data-table-wrap="${fieldId}"]`);
  const has = !!t || (wrap && !wrap.classList.contains('hidden') && wrap.querySelector('table'));
  if (tools) {
    tools.querySelectorAll('button[data-table-add-row],button[data-table-add-col],button[data-table-del-row],button[data-table-del-col],button[data-table-clear]').forEach((btn) => {
      btn.disabled = !wrap || wrap.classList.contains('hidden');
    });
  }
  return has;
}

function mountFormTable(root, fieldId, table) {
  const wrap = root.querySelector(`[data-table-wrap="${fieldId}"]`);
  const hidden = root.querySelector(
    `input[data-table-for="${fieldId}"][data-type="form_table"]`
  );
  if (!wrap || !hidden) return;
  const t = normalizeFormTable(table) || emptyFormTable(3, 3);
  wrap.classList.remove('hidden');
  wrap.innerHTML = renderFormTableEditorHtml(fieldId, t);
  hidden.value = JSON.stringify(t);
  syncFormTableHidden(root, fieldId);
  // 編輯時即時寫入 hidden
  wrap.querySelectorAll('[contenteditable]').forEach((cell) => {
    cell.addEventListener('input', () => syncFormTableHidden(root, fieldId));
    cell.addEventListener('blur', () => syncFormTableHidden(root, fieldId));
  });
}

function mutateFormTable(root, fieldId, action) {
  const wrap = root.querySelector(`[data-table-wrap="${fieldId}"]`);
  if (!wrap || wrap.classList.contains('hidden')) return;
  let t = readFormTableFromDom(root, fieldId) || emptyFormTable(3, 3);
  const cells = t.cells.map((r) => r.slice());
  const cols = t.cols;
  if (action === 'add-row') {
    if (cells.length >= 20) return toast('表格最多 20 列', 'error');
    cells.push(Array.from({ length: cols }, () => ''));
  } else if (action === 'add-col') {
    if (cols >= 10) return toast('表格最多 10 欄', 'error');
    cells.forEach((r) => r.push(''));
  } else if (action === 'del-row') {
    if (cells.length <= 1) return toast('至少保留 1 列', 'error');
    cells.pop();
  } else if (action === 'del-col') {
    if (cols <= 1) return toast('至少保留 1 欄', 'error');
    cells.forEach((r) => r.pop());
  } else if (action === 'clear') {
    wrap.classList.add('hidden');
    wrap.innerHTML = '';
    const hidden = root.querySelector(
      `input[data-table-for="${fieldId}"][data-type="form_table"]`
    );
    if (hidden) hidden.value = '';
    syncFormTableHidden(root, fieldId);
    return;
  }
  mountFormTable(root, fieldId, { cells, header: true });
}

/** 綁定說明欄位自繪表格工具列 */
function bindFormTableEditors(root) {
  if (!root) return;
  // 還原既有表格
  root.querySelectorAll('input[data-type="form_table"]').forEach((hidden) => {
    const fieldId = hidden.dataset.tableFor;
    if (!fieldId) return;
    const t = normalizeFormTable(hidden.value);
    if (t) mountFormTable(root, fieldId, t);
    else syncFormTableHidden(root, fieldId);
  });

  root.querySelectorAll('[data-table-insert]').forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.tableInsert;
      const wrap = root.querySelector(`[data-table-wrap="${id}"]`);
      if (wrap && !wrap.classList.contains('hidden') && wrap.querySelector('table')) {
        if (!confirm('已有表格，要重新建立嗎？（內容會清空）')) return;
      }
      const rc = prompt('請輸入列數,欄數（例如 3,4）', '3,3');
      if (rc == null) return;
      const parts = String(rc).split(/[,，xX*／/]/).map((s) => Number(String(s).trim()));
      const rows = parts[0] > 0 ? parts[0] : 3;
      const cols = parts[1] > 0 ? parts[1] : 3;
      mountFormTable(root, id, emptyFormTable(rows, cols));
    };
  });
  const actions = [
    ['data-table-add-row', 'add-row'],
    ['data-table-add-col', 'add-col'],
    ['data-table-del-row', 'del-row'],
    ['data-table-del-col', 'del-col'],
    ['data-table-clear', 'clear'],
  ];
  for (const [attr, action] of actions) {
    root.querySelectorAll(`[${attr}]`).forEach((btn) => {
      btn.onclick = () => {
        const id = btn.getAttribute(attr);
        mutateFormTable(root, id, action);
      };
    });
  }
}

function collectFormData(root) {
  // 先同步所有日期時間隱藏欄位
  root.querySelectorAll('[data-datetime-field]').forEach((wrap) => {
    syncDateTimeHidden(root, wrap.dataset.datetimeField);
  });
  // 同步富文字編輯器 → textarea
  root.querySelectorAll('textarea[data-rich="1"]').forEach((ta) => {
    const surface = root.querySelector(
      `.rich-editor[data-rich-for="${ta.dataset.ff}"] .re-surface`
    );
    if (surface && typeof RichEditor !== 'undefined') {
      ta.value = RichEditor.sanitizeHtml(surface.innerHTML);
      const plain = RichEditor.htmlToPlain(ta.value).trim();
      if (!plain && !/<table/i.test(ta.value)) ta.value = '';
    }
  });
  // 同步舊版自繪表格（相容）
  root.querySelectorAll('input[data-type="form_table"]').forEach((hidden) => {
    const id = hidden.dataset.tableFor;
    if (id) syncFormTableHidden(root, id);
  });
  const data = {};
  const cosignBuckets = {}; // cosign_N → id[]
  const usersPickBuckets = {}; // users_pick_N → id[]
  root.querySelectorAll('[data-ff]').forEach((el) => {
    const id = el.dataset.ff;
    // 會簽多選 checkbox
    if (el.dataset.type === 'cosign_pick' && el.type === 'checkbox') {
      if (!cosignBuckets[id]) cosignBuckets[id] = [];
      if (el.checked) cosignBuckets[id].push(Number(el.value));
      return;
    }
    // 副總等申請人自選：勾選多位
    if (el.dataset.type === 'users_pick' && el.type === 'checkbox') {
      if (!usersPickBuckets[id]) usersPickBuckets[id] = [];
      if (el.checked) usersPickBuckets[id].push(Number(el.value));
      return;
    }
    // 自繪表格：存物件
    if (el.dataset.type === 'form_table') {
      const t = normalizeFormTable(el.value);
      if (t) data[id] = t;
      return;
    }
    // radio：只取 checked
    if (el.type === 'radio') {
      if (el.checked) data[id] = el.value;
      return;
    }
    if (el.dataset.type === 'checkbox' || el.type === 'checkbox') {
      data[id] = !!el.checked;
    } else {
      data[id] = el.value;
    }
  });
  // 會簽：無勾選＝skip；有勾選＝逗號分隔 id
  for (const [id, ids] of Object.entries(cosignBuckets)) {
    const clean = ids.filter((n) => n > 0);
    data[id] = clean.length ? clean.join(',') : 'skip';
  }
  // 申請人自選簽核人：逗號分隔 id（至少一位由送出驗證）
  for (const [id, ids] of Object.entries(usersPickBuckets)) {
    const clean = [...new Set(ids.filter((n) => n > 0))];
    data[id] = clean.length ? clean.join(',') : '';
  }
  return data;
}

/** 送出前檢查 users_pick 至少勾選一位 */
function validateUsersPickRequired(root) {
  const choosers = root.querySelectorAll('[data-users-pick-chooser]');
  for (const box of choosers) {
    const fieldId = box.dataset.usersPickChooser;
    const checked = box.querySelectorAll(
      `input[data-type="users_pick"][data-ff="${fieldId}"]:checked`
    );
    if (!checked.length) {
      const label =
        box.querySelector('label')?.textContent?.replace(/\s*\*\s*$/, '').trim() || '簽核人';
      return `請勾選至少一位「${label}」`;
    }
  }
  return null;
}

function formatFormValue(field, value, formData) {
  if (field?.type === 'checkbox') return value ? '是' : '否';
  if (field?.type === 'datetime') return formatDateTimeDisplay(value);
  if (field?.type === 'user') {
    if (formData?.[`${field.id}__label`]) return formData[`${field.id}__label`];
    if (formData?.[`${field.id}__name`]) return formData[`${field.id}__name`];
    const label = userLabelById(value, '');
    if (label) return label;
  }
  if (value == null || value === '') return '—';
  // 金額＋幣別（請購等）
  if (
    field?.id === 'amount' ||
    (field?.type === 'number' && /金額|總價|費用/.test(String(field?.label || '')))
  ) {
    const cur = formData?.currency || formData?.幣別 || '';
    const num = Number(value);
    const numText = Number.isFinite(num)
      ? num.toLocaleString('en-US', { maximumFractionDigits: 4 })
      : String(value);
    return cur ? `${numText} ${cur}` : numText;
  }
  return String(value);
}
