/**
 * 單據 Excel／報表匯出（費用報支、請購請款、簽核紀錄）
 */
'use strict';

const XLSX = require('xlsx');

const STATUS_LABEL = {
  pending: '簽核中',
  approved: '已核准',
  rejected: '已駁回',
  cancelled: '已取消',
  draft: '草稿',
  voided: '已作廢',
};

function parseFormJson(s) {
  try {
    return typeof s === 'string' ? JSON.parse(s || '{}') : s || {};
  } catch {
    return {};
  }
}

function statusLabel(s) {
  return STATUS_LABEL[s] || s || '';
}

function dateOnly(v) {
  if (!v) return '';
  return String(v).replace('T', ' ').slice(0, 10);
}

function dateTime(v) {
  if (!v) return '';
  return String(v).replace('T', ' ').slice(0, 16);
}

function pickField(fd, ad, keys) {
  for (const k of keys) {
    const v = (ad && ad[k] != null && ad[k] !== '' ? ad[k] : null) ?? (fd && fd[k] != null ? fd[k] : null);
    if (v != null && String(v).trim() !== '') return v;
  }
  return '';
}

function pickAmount(fd, ad) {
  const raw = pickField(fd, ad, [
    'amount',
    'total_amount',
    'total',
    'est_amount',
    '金額',
    '預估金額',
    '請款金額',
    '報支金額',
  ]);
  if (raw === '' || raw == null) return null;
  const n = Number(String(raw).replace(/[,，\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function pickCurrency(fd, ad) {
  const c = String(
    pickField(fd, ad, ['currency', '幣別', 'curr']) || ''
  ).trim();
  return c;
}

function isExpenseKind(row, fd) {
  const hay = `${row.workflow_name || ''} ${row.title || ''}`;
  if (/費用報支|報銷|報支/.test(hay)) return true;
  if (fd && (fd.expense_type || fd.expense_date)) return true;
  return false;
}

function isPurchaseKind(row, fd) {
  const hay = `${row.workflow_name || ''} ${row.title || ''}`;
  if (/請購|請款/.test(hay)) return true;
  if (fd && (fd.item_name || fd.vendor || fd.qty)) return true;
  return false;
}

function classifyKind(row, fd) {
  if (isExpenseKind(row, fd)) return 'expense';
  if (isPurchaseKind(row, fd)) return 'purchase';
  return 'other';
}

function matchKind(kind, rowKind) {
  const k = String(kind || 'all').toLowerCase();
  if (!k || k === 'all') return true;
  if (k === 'finance' || k === 'expense_purchase') {
    return rowKind === 'expense' || rowKind === 'purchase';
  }
  return rowKind === k;
}

function sheetFromRows(rows, emptyNote) {
  return XLSX.utils.json_to_sheet(rows.length ? rows : [{ 說明: emptyNote || '無資料' }]);
}

function setColWidths(ws, widths) {
  ws['!cols'] = widths.map((wch) => ({ wch }));
}

function toListRow(r, i, fd, ad) {
  const amount = pickAmount(fd, ad);
  const currency = pickCurrency(fd, ad);
  return {
    序號: i + 1,
    單號: r.id,
    申請人: r.requester_name || '',
    帳號: r.requester_username || '',
    部門: r.requester_dept || '',
    流程: r.workflow_name || '',
    主旨: r.title || '',
    狀態: statusLabel(r.status),
    金額: amount == null ? '' : amount,
    幣別: currency,
    申請日: dateOnly(r.created_at),
    核准日: r.status === 'approved' ? dateOnly(r.completed_at) : '',
    最後更新: dateTime(r.updated_at || r.completed_at || r.created_at),
  };
}

function toExpenseRow(r, i, fd, ad) {
  const base = toListRow(r, i, fd, ad);
  return {
    ...base,
    費用類別: String(pickField(fd, ad, ['expense_type', '費用類別']) || ''),
    發生日期: dateOnly(pickField(fd, ad, ['expense_date', '發生日期'])),
    費用說明: String(pickField(fd, ad, ['desc', 'description', 'reason', '費用說明', '說明']) || ''),
  };
}

function toPurchaseRow(r, i, fd, ad) {
  const base = toListRow(r, i, fd, ad);
  return {
    ...base,
    品名: String(pickField(fd, ad, ['item_name', '品名', '項目']) || ''),
    數量: pickField(fd, ad, ['qty', 'quantity', '數量']) || '',
    建議廠商: String(pickField(fd, ad, ['vendor', '建議廠商', '廠商']) || ''),
    用途: String(pickField(fd, ad, ['purpose', 'desc', 'description', '用途', '說明']) || ''),
  };
}

function buildSummarySheets(enriched) {
  const byWf = new Map();
  const byStatus = new Map();
  const byDept = new Map();

  function bump(map, key, amount, currency) {
    if (!map.has(key)) map.set(key, { count: 0, ntd: 0, usd: 0, other: 0 });
    const row = map.get(key);
    row.count += 1;
    const cur = String(currency || '').toUpperCase();
    const n = Number(amount);
    if (!Number.isFinite(n)) return;
    if (cur === 'USD') row.usd += n;
    else if (!cur || cur === 'NTD' || cur === 'TWD' || cur === 'NT$') row.ntd += n;
    else row.other += n;
  }

  for (const e of enriched) {
    bump(byWf, e.workflow_name || '（未分類）', e.amount, e.currency);
    bump(byStatus, statusLabel(e.status), e.amount, e.currency);
    bump(byDept, e.requester_dept || '（未填）', e.amount, e.currency);
  }

  const fmt = (map, labelKey) =>
    [...map.entries()].map(([k, v]) => ({
      [labelKey]: k,
      筆數: v.count,
      '金額合計_NTD': Math.round(v.ntd * 100) / 100,
      '金額合計_USD': Math.round(v.usd * 100) / 100,
    }));

  return {
    byWorkflow: fmt(byWf, '流程'),
    byStatus: fmt(byStatus, '狀態'),
    byDept: fmt(byDept, '部門'),
  };
}

/**
 * @param {{ rows: object[], kind?: string, dateFrom?: string, dateTo?: string, generatedBy?: string }} opts
 */
function buildRequestsExportWorkbook(opts) {
  const kind = String(opts.kind || 'all').toLowerCase() || 'all';
  const source = Array.isArray(opts.rows) ? opts.rows : [];

  const enriched = [];
  for (const r of source) {
    const fd = parseFormJson(r.form_data);
    const ad = parseFormJson(r.approver_data_json);
    const rowKind = classifyKind(r, fd);
    if (!matchKind(kind, rowKind)) continue;
    enriched.push({
      row: r,
      fd,
      ad,
      kind: rowKind,
      amount: pickAmount(fd, ad),
      currency: pickCurrency(fd, ad),
      workflow_name: r.workflow_name,
      status: r.status,
      requester_dept: r.requester_dept,
    });
  }

  const listRows = enriched.map((e, i) => toListRow(e.row, i, e.fd, e.ad));
  const expenseRows = enriched
    .filter((e) => e.kind === 'expense')
    .map((e, i) => toExpenseRow(e.row, i, e.fd, e.ad));
  const purchaseRows = enriched
    .filter((e) => e.kind === 'purchase')
    .map((e, i) => toPurchaseRow(e.row, i, e.fd, e.ad));

  const wb = XLSX.utils.book_new();
  const includeAll = kind === 'all';
  const includeExpense = includeAll || kind === 'expense' || kind === 'finance' || kind === 'expense_purchase';
  const includePurchase = includeAll || kind === 'purchase' || kind === 'finance' || kind === 'expense_purchase';

  if (includeAll || (!includeExpense && !includePurchase)) {
    const ws = sheetFromRows(listRows, '此條件下沒有單據');
    setColWidths(ws, [6, 8, 10, 10, 12, 16, 28, 10, 12, 8, 12, 12, 16]);
    XLSX.utils.book_append_sheet(wb, ws, '單據清單');
  }

  if (includeExpense) {
    const ws = sheetFromRows(expenseRows, '此條件下沒有費用報支單據');
    setColWidths(ws, [6, 8, 10, 10, 12, 16, 28, 10, 12, 8, 12, 12, 16, 12, 12, 28]);
    XLSX.utils.book_append_sheet(wb, ws, '費用報支');
  }
  if (includePurchase) {
    const ws = sheetFromRows(purchaseRows, '此條件下沒有請購／請款單據');
    setColWidths(ws, [6, 8, 10, 10, 12, 16, 28, 10, 12, 8, 12, 12, 16, 18, 8, 16, 24]);
    XLSX.utils.book_append_sheet(wb, ws, '請購請款');
  }

  const summary = buildSummarySheets(enriched);
  const wsSumWf = sheetFromRows(summary.byWorkflow, '無彙總');
  setColWidths(wsSumWf, [20, 8, 14, 14]);
  XLSX.utils.book_append_sheet(wb, wsSumWf, '彙總_流程');
  const wsSumSt = sheetFromRows(summary.byStatus, '無彙總');
  setColWidths(wsSumSt, [12, 8, 14, 14]);
  XLSX.utils.book_append_sheet(wb, wsSumSt, '彙總_狀態');
  const wsSumDp = sheetFromRows(summary.byDept, '無彙總');
  setColWidths(wsSumDp, [16, 8, 14, 14]);
  XLSX.utils.book_append_sheet(wb, wsSumDp, '彙總_部門');

  const rangeLabel =
    opts.dateFrom || opts.dateTo
      ? `${opts.dateFrom || '（不限）'} ～ ${opts.dateTo || '（不限）'}`
      : '不限';
  const kindLabel =
    kind === 'expense' ? '費用報支' : kind === 'purchase' ? '請購／請款' : kind === 'finance' || kind === 'expense_purchase' ? '費用＋請購請款' : '全部單據';
  const note = XLSX.utils.aoa_to_sheet([
    ['單據報表', kindLabel],
    ['產生時間', new Date().toLocaleString('zh-TW', { hour12: false })],
    ['查詢期間', rangeLabel],
    ['匯出筆數', String(enriched.length)],
    ['費用報支', String(expenseRows.length)],
    ['請購請款', String(purchaseRows.length)],
    ['產生者', opts.generatedBy || ''],
    [''],
    ['說明', '金額／幣別取自表單欄位 amount、currency（含預估金額、報支金額等別名）。'],
    ['權限', '一般使用者僅能匯出與本人相關單據；具備查看全部／請假報表／財務建檔權限者可匯出全公司。'],
    ['注意', '系統匯出供對帳與統計，實際入帳以財務／ERP 為準。'],
  ]);
  note['!cols'] = [{ wch: 12 }, { wch: 64 }];
  XLSX.utils.book_append_sheet(wb, note, '說明');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return {
    buffer,
    meta: {
      count: enriched.length,
      expenseCount: expenseRows.length,
      purchaseCount: purchaseRows.length,
      kind,
      dateFrom: opts.dateFrom || '',
      dateTo: opts.dateTo || '',
    },
  };
}

module.exports = {
  buildRequestsExportWorkbook,
  parseFormJson,
  isExpenseKind,
  isPurchaseKind,
};
