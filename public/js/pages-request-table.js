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
  root.querySelectorAll('[data-welfare-table]').forEach((wrap) => {
    syncWelfareLedger(wrap);
  });
  root.querySelectorAll('[data-followup-table]').forEach((wrap) => {
    syncFollowupTable(wrap);
  });
  const data = {};
  const cosignBuckets = {}; // cosign_N → id[]
  const usersPickBuckets = {}; // users_pick_N → id[]
  const attendeeBuckets = {};
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
    if (el.dataset.type === 'attendee_pick' && el.type === 'checkbox') {
      if (!attendeeBuckets[id]) attendeeBuckets[id] = [];
      if (el.checked) attendeeBuckets[id].push(Number(el.value));
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
  // 申請人自選簽核人：逗號分隔 id；非必填且未勾選 → skip
  for (const [id, ids] of Object.entries(usersPickBuckets)) {
    const clean = [...new Set(ids.filter((n) => n > 0))];
    if (clean.length) {
      data[id] = clean.join(',');
    } else {
      const box = root.querySelector(`[data-users-pick-chooser="${id}"]`);
      data[id] = box?.dataset?.usersPickOptional === '1' ? 'skip' : '';
    }
  }
  for (const [id, ids] of Object.entries(attendeeBuckets)) {
    data[id] = [...new Set(ids.filter((n) => n > 0))].join(',');
  }
  // 無 checkbox 被掃到時（名單空）仍寫 skip，避免後端當必填缺漏
  root.querySelectorAll('[data-users-pick-chooser]').forEach((box) => {
    const id = box.dataset.usersPickChooser;
    if (data[id] === undefined || data[id] === null || data[id] === '') {
      if (box.dataset.usersPickOptional === '1') data[id] = 'skip';
    }
  });
  return data;
}

/** 送出前檢查必填的 users_pick 至少勾選一位（skipIfNoApprover 略過） */
function validateUsersPickRequired(root) {
  const choosers = root.querySelectorAll('[data-users-pick-chooser]');
  for (const box of choosers) {
    if (box.dataset.usersPickOptional === '1') continue;
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

/**
 * 金額顯示（元，只一種格式）：
 * - 未滿 10 萬：12,406 元
 * - ≥ 10 萬：100萬1000元（整萬則 25萬元）
 */
function formatYuanWanStyle(val) {
  if (val == null || val === '') return '—';
  const n = Number(String(val).replace(/[,，\s元萬]/g, ''));
  if (!Number.isFinite(n)) return String(val);
  const neg = n < 0;
  const abs = Math.round(Math.abs(n));
  const sign = neg ? '-' : '';
  if (abs < 100000) return `${sign}${abs.toLocaleString('zh-TW')} 元`;
  const wan = Math.floor(abs / 10000);
  const rest = abs % 10000;
  if (rest === 0) return `${sign}${wan}萬元`;
  return `${sign}${wan}萬${rest}元`;
}

function isForeignCurrency(cur) {
  const s = String(cur || '').trim().toUpperCase();
  if (!s) return false;
  return !/^(NTD|TWD|NT\$|NTD\$|新台幣|新臺幣|台幣|臺幣)$/.test(s);
}

function formatForeignAmount(val) {
  if (val == null || val === '') return '—';
  const n = Number(String(val).replace(/[,，\s元萬]/g, ''));
  if (!Number.isFinite(n)) return String(val);
  const rounded = Math.round(n * 10000) / 10000;
  return rounded.toLocaleString('zh-TW', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

function isMoneyFormField(field, key) {
  const id = String(field?.id || key || '');
  const label = String(field?.label || '');
  const blob = `${id} ${label}`;
  // 說明／事由等文字欄不可當金額（例：費用說明）
  if (
    /說明|事由|備註|內容|原由|條件|note|desc|reason|purpose|comment/i.test(blob)
  ) {
    return false;
  }
  if (/數量|qty|quantity|天數|小時|days|hours/i.test(blob)) return false;
  if (
    /credit_limit|accounts_receivable|notes_receivable|credit_balance|requested_credit|_limit$|handling_fee|^amount$|^budget$|sales_revenue|sales_cost|sales_gross_profit/.test(
      id
    )
  ) {
    return true;
  }
  if (/金額|總價|額度|帳款|票據|餘額|手續費|（元）|\(元\)/.test(label)) {
    return true;
  }
  return false;
}

function formatFormValue(field, value, formData) {
  if (field?.type === 'checkbox') return value ? '是' : '否';
  if (field?.type === 'datetime') return formatDateTimeDisplay(value);
  if (field?.id === 'void_target_id' && formData?.[`${field.id}__label`]) {
    return formData[`${field.id}__label`];
  }
  if (field?.type === 'user') {
    if (formData?.[`${field.id}__label`]) return formData[`${field.id}__label`];
    if (formData?.[`${field.id}__name`]) return formData[`${field.id}__name`];
    const u = (state.users || []).find((x) => x.id === Number(value));
    if (u) return u.department ? `${u.name}（${u.department}）` : u.name;
  }
  if (value == null || value === '') return '—';
  if (isMoneyFormField(field)) {
    const rawNum = Number(String(value).replace(/[,，\s元萬]/g, ''));
    if (!Number.isFinite(rawNum)) return String(value);
    const cur = formData?.currency || formData?.幣別 || '';
    if (
      isForeignCurrency(cur) &&
      !/信用|授信|額度|帳款|票據|餘額/.test(
        String(field?.label || '') + String(field?.id || '')
      )
    ) {
      const fx = formatForeignAmount(value);
      return fx === '—' ? '—' : `${fx} ${String(cur).trim()}`.trim();
    }
    const wanText = formatYuanWanStyle(value);
    if (wanText === '—') return '—';
    if (
      cur &&
      !/信用|授信|額度|帳款|票據|餘額/.test(
        String(field?.label || '') + String(field?.id || '')
      )
    ) {
      return `${wanText.replace(/\s*元$/, '')} ${cur}`.trim();
    }
    return wanText;
  }
  return String(value);
}

/** 詳情頁：渲染自繪表格 */
function renderFormTableHtml(table) {
  const t = normalizeFormTable(table);
  if (!t) return '';
  let html = '<table class="form-view-table"><tbody>';
  t.cells.forEach((row, ri) => {
    html += '<tr>';
    row.forEach((cell) => {
      const tag = t.header && ri === 0 ? 'th' : 'td';
      html += `<${tag}>${esc(cell) || '&nbsp;'}</${tag}>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  return html;
}

/**
 * 表單欄位顯示：富文字 HTML／分行格式；相容舊版 __table
 */
function renderFormValueHtml(field, value, formData) {
  if (field?.type === 'table' || field?.id === 'welfare_items') {
    return renderWelfareItemsViewHtml(value, formData);
  }
  const raw = value == null || value === '' ? '' : String(value);
  const isRichField =
    field?.type === 'textarea' ||
    field?.id === 'subject' ||
    /主旨|說明|事由|內容|備註|異常|規格/.test(String(field?.label || ''));

  // 富文字 HTML
  if (
    isRichField &&
    typeof RichEditor !== 'undefined' &&
    (RichEditor.isProbablyHtml(raw) || formData?.[`${field?.id}__table`])
  ) {
    let html = raw;
    const legacy = formData?.[`${field?.id}__table`];
    if (legacy && !/<table/i.test(html)) {
      const t = normalizeFormTable(legacy);
      if (t) {
        const rows = t.cells
          .map(
            (row, ri) =>
              `<tr>${row
                .map((c) => {
                  const tag = t.header && ri === 0 ? 'th' : 'td';
                  return `<${tag} style="border:1px solid #94a3b8;padding:6px 8px">${esc(c)}</${tag}>`;
                })
                .join('')}</tr>`
          )
          .join('');
        html =
          (html
            ? RichEditor.isProbablyHtml(html)
              ? html
              : RichEditor.plainToHtml(html)
            : '') +
          `<table border="1" style="border-collapse:collapse;width:100%"><tbody>${rows}</tbody></table>`;
      }
    }
    return RichEditor.renderViewHtml(html || raw);
  }

  const text = formatFormValue(field, value, formData);
  const escaped = esc(text);
  const multiline =
    isRichField ||
    String(text).includes('\n') ||
    String(text).includes('\r');
  const tableHtml = renderFormTableHtml(formData?.[`${field?.id}__table`]);
  let body = '';
  if (multiline && text !== '—') {
    body = `<div class="form-value-pre">${escaped}</div>`;
  } else if (text !== '—' || !tableHtml) {
    body = escaped;
  }
  if (tableHtml) body += tableHtml;
  return body || '—';
}

function renderPlainValueHtml(val) {
  const text = val == null || val === '' ? '—' : String(val);
  const escaped = esc(text);
  if (text !== '—' && (text.includes('\n') || text.includes('\r'))) {
    return `<div class="form-value-pre">${escaped}</div>`;
  }
  return escaped;
}
