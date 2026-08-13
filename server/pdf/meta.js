const tz = require('../tz');

const STATUS_LABEL = {
  draft: '草稿',
  pending: '簽核中',
  approved: '已核准',
  rejected: '已駁回',
  cancelled: '已取消',
};

const ACTION_LABEL = {
  submit: '送出申請',
  approve: '核准',
  reject: '駁回',
  cancel: '取消',
  return: '退回',
  comment: '留言',
  cosign: '加簽請託',
  forward: '轉簽改派',
  // v1 只有條件跳關，v2 還有匯合與路徑判定，統一用中性標籤，
  // 具體發生什麼由「意見」欄的內容說明
  system: '系統',
};

const AD_LABELS = {
  hr_leave_type: '假別（人事核定）',
  remaining_special_leave_days: '剩餘特休日數',
  hr_note: '人事備註',
  pc_acquired_date: '原電腦取得日期',
  check_os: '作業系統（Windows10）',
  check_memory: '記憶體（4G 以上）',
  check_disk: '硬碟（SSD 500G 以上）',
  check_3dmark: '3DMARK 分數（500 分以上）',
  check_email: '電子郵件定期清理',
  check_backup: '重要資料定期備份',
  check_battery: '電池容量（70% 以下）',
  handle_result: '電腦處理情形',
  handle_note: '處理說明／其他',
  actual_start: '實際工時開始',
  actual_end: '實際工時結束',
  actual_hours: '實際總計（小時）',
  comp_leave_balance: '目前累計可用時數（補休）',
};

/** 假別短名（PDF 標籤用） */
function shortLeaveTypeNamePdf(type) {
  const s = String(type || '').trim();
  if (!s) return '假別';
  if (/特別休假|特休/.test(s) && !/不休假|代金/.test(s)) return '特休';
  const m = s.match(/（([^）]+)）/);
  if (m) return m[1];
  return s;
}

function isSpecialLeaveTypePdf(type) {
  const t = String(type || '');
  return /特別休假|特休/.test(t) && !/不休假|代金/.test(t);
}

/**
 * 依人事核定假別產生標籤
 * 例：祭儀假 → 剩餘祭儀假日數（目前）；特休 → 剩餘特休日數（核准後）
 */
function hrLeaveLabelsPdf(hrLeaveType) {
  const t = String(hrLeaveType || '').trim();
  const shortName = shortLeaveTypeNamePdf(t);
  const isSpecial = isSpecialLeaveTypePdf(t);
  return {
    hr_leave_type: '假別（人事核定）',
    remaining_special_leave_days: t
      ? isSpecial
        ? `剩餘${shortName}日數（核准後）`
        : `剩餘${shortName}日數（目前）`
      : '剩餘日數',
    // 表格短標籤（特休僅以日顯示，不換算小時）
    remDaysShort: t ? `剩餘${shortName}日` : '剩餘日數',
    hr_note: '人事備註',
  };
}

/** 簽核單位欄位標籤（含人事假別動態） */
function adLabelPdf(key, adFlat) {
  const hr = hrLeaveLabelsPdf(adFlat?.hr_leave_type || adFlat?.假別 || '');
  if (hr[key]) return hr[key];
  return AD_LABELS[key] || key;
}

function formatDisplayValue(val) {
  if (val == null || val === '') return '—';
  if (typeof val === 'boolean') return val ? '是' : '否';
  if (typeof val === 'object') {
    // 自繪表格物件不直接 JSON 顯示
    if (Array.isArray(val.cells)) return '（見附表）';
    try {
      return JSON.stringify(val);
    } catch {
      return String(val);
    }
  }
  let s = String(val);
  // 富文字 HTML → 純文字（表格改由欄位下方繪製，此處只留文字）
  if (/<\/?(p|div|br|table|span|b|strong|font|u|i|em)\b/i.test(s)) {
    s = /<table/i.test(s) ? richHtmlBodyPlain(s) : richHtmlToPlain(s);
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
    return s.replace('T', ' ').slice(0, 16);
  }
  return s;
}

/**
 * 依表單名稱配色，讓不同申請表單在 PDF 上容易辨識。
 * 常見表單固定色；其餘依名稱穩定雜湊選色。
 */
const FORM_THEME_PALETTE = [
  {
    // 深藍
    primary: '#1e3a5f',
    headerBg: '#1e3a5f',
    sectionBg: '#e2eaf5',
    labelBg: '#e8eef6',
    rowAlt: '#f1f5f9',
    border: '#94a3b8',
    accentSoft: '#cbd5e1',
    companyText: '#e2e8f0',
    metaText: '#cbd5e1',
  },
  {
    // 葉綠（請假類）
    primary: '#166534',
    headerBg: '#166534',
    sectionBg: '#dcfce7',
    labelBg: '#e8f8ee',
    rowAlt: '#f0fdf4',
    border: '#86efac',
    accentSoft: '#bbf7d0',
    companyText: '#dcfce7',
    metaText: '#bbf7d0',
  },
  {
    // 琥珀橘（請購／費用）
    primary: '#9a3412',
    headerBg: '#c2410c',
    sectionBg: '#ffedd5',
    labelBg: '#fff1e6',
    rowAlt: '#fff7ed',
    border: '#fdba74',
    accentSoft: '#fed7aa',
    companyText: '#ffedd5',
    metaText: '#fed7aa',
  },
  {
    // 靛紫
    primary: '#5b21b6',
    headerBg: '#6d28d9',
    sectionBg: '#ede9fe',
    labelBg: '#f1edfe',
    rowAlt: '#f5f3ff',
    border: '#c4b5fd',
    accentSoft: '#ddd6fe',
    companyText: '#ede9fe',
    metaText: '#ddd6fe',
  },
  {
    // 青綠
    primary: '#0f766e',
    headerBg: '#0f766e',
    sectionBg: '#ccfbf1',
    labelBg: '#e0faf5',
    rowAlt: '#f0fdfa',
    border: '#5eead4',
    accentSoft: '#99f6e4',
    companyText: '#ccfbf1',
    metaText: '#99f6e4',
  },
  {
    // 薔薇紅
    primary: '#9f1239',
    headerBg: '#be123c',
    sectionBg: '#ffe4e6',
    labelBg: '#ffecee',
    rowAlt: '#fff1f2',
    border: '#fda4af',
    accentSoft: '#fecdd3',
    companyText: '#ffe4e6',
    metaText: '#fecdd3',
  },
  {
    // 天藍
    primary: '#075985',
    headerBg: '#0369a1',
    sectionBg: '#e0f2fe',
    labelBg: '#e8f6fe',
    rowAlt: '#f0f9ff',
    border: '#7dd3fc',
    accentSoft: '#bae6fd',
    companyText: '#e0f2fe',
    metaText: '#bae6fd',
  },
  {
    // 酒紅
    primary: '#7f1d1d',
    headerBg: '#991b1b',
    sectionBg: '#fee2e2',
    labelBg: '#feecec',
    rowAlt: '#fef2f2',
    border: '#fca5a5',
    accentSoft: '#fecaca',
    companyText: '#fee2e2',
    metaText: '#fecaca',
  },
  {
    // 橄欖
    primary: '#3f6212',
    headerBg: '#4d7c0f',
    sectionBg: '#ecfccb',
    labelBg: '#f2fde0',
    rowAlt: '#f7fee7',
    border: '#bef264',
    accentSoft: '#d9f99d',
    companyText: '#ecfccb',
    metaText: '#d9f99d',
  },
  {
    // 石板
    primary: '#334155',
    headerBg: '#334155',
    sectionBg: '#e2e8f0',
    labelBg: '#e9eef4',
    rowAlt: '#f8fafc',
    border: '#94a3b8',
    accentSoft: '#cbd5e1',
    companyText: '#e2e8f0',
    metaText: '#cbd5e1',
  },
];

/** 常見表單關鍵字 → 調色盤索引（固定色，方便辨識） */
const FORM_THEME_KEYWORDS = [
  { re: /請假|休假|特休|病假|事假|喪假|產假|婚假/, idx: 1 }, // 綠
  { re: /請購|採購|訂購/, idx: 2 }, // 橘
  { re: /費用|報支|報銷|核銷|請款/, idx: 5 }, // 薔薇紅
  { re: /加班|補休|工時|延長/, idx: 3 }, // 紫
  { re: /出差|公差|旅費/, idx: 4 }, // 青綠
  { re: /電腦|資訊|IT|設備|報修/, idx: 6 }, // 天藍
  { re: /用印|印章|合約|契約|簽呈/, idx: 0 }, // 深藍
  { re: /離職|到職|人事|任用/, idx: 7 }, // 酒紅
  { re: /交通|車輛/, idx: 8 }, // 橄欖
];

function hashString(s) {
  let h = 0;
  const str = String(s || '');
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return h;
}

/**
 * 依 workflow 名稱／id 取得 PDF 主題色
 */
function resolveFormTheme(request) {
  const name = String(
    request?.workflow_name || request?.form_name || '簽核申請'
  ).trim();
  let idx = -1;
  for (const item of FORM_THEME_KEYWORDS) {
    if (item.re.test(name)) {
      idx = item.idx;
      break;
    }
  }
  if (idx < 0) {
    const key = request?.workflow_id != null ? `id:${request.workflow_id}` : name;
    idx = hashString(key) % FORM_THEME_PALETTE.length;
  }
  const base = FORM_THEME_PALETTE[idx] || FORM_THEME_PALETTE[0];
  return {
    ...base,
    text: '#0f172a',
    muted: '#475569',
    white: '#ffffff',
    themeIndex: idx,
    formName: name,
  };
}

/**
 * 解析 PDF 版面類型（優先流程模組 pdfLayout，否則依名稱推斷）
 * @returns {'leave'|'credit_limit'|'purchase'|'expense'|'travel'|'it_repair'|'overtime'|'general'}
 */
function resolvePdfLayoutType(request) {
  const pl = request?.pdfLayout;
  if (pl) {
    const t = String(pl.resolvedType || pl.type || '').trim();
    if (t && t !== 'auto') return t;
  }
  try {
    const { detectPdfLayoutType } = require('./workflow-module');
    return detectPdfLayoutType(
      request?.workflow_name || request?.form_name || request?.title || ''
    );
  } catch {
    /* fall through name heuristics below */
  }
  const name = String(request?.workflow_name || request?.form_name || request?.title || '');
  if (/請假|休假|leave/i.test(name)) return 'leave';
  if (/信用額度|授信額度|額度申請/i.test(name)) return 'credit_limit';
  if (/請購|採購|訂購|purchase|payment/i.test(name)) return 'purchase';
  if (/費用|報支|報銷|請款|expense/i.test(name)) return 'expense';
  if (/出差|公出|差旅|travel|business.?trip/i.test(name)) return 'travel';
  if (/電腦|報修|資訊設備/i.test(name)) return 'it_repair';
  if (/加班|延長工時|超時|overtime/i.test(name)) return 'overtime';
  if (/簽呈/.test(name)) return 'general';
  return 'general';
}

/**
 * 流程模組已明確指定 pdfLayout.type（非 auto）時，以該類型為準。
 * type=auto 或無 pdfLayout 時：先看 resolved／名稱推斷，再退回欄位啟發式。
 */
function hasExplicitPdfLayout(request) {
  const pl = request?.pdfLayout;
  if (!pl) return false;
  const t = String(pl.type || '').trim();
  return Boolean(t && t !== 'auto');
}

/** @returns {boolean|null} true/false=已決定；null=交給啟發式 */
function matchPdfLayout(request, type) {
  if (hasExplicitPdfLayout(request)) {
    return resolvePdfLayoutType(request) === type;
  }
  // auto：resolved 命中專用版面時直接 true；general 不強制，避免誤用簽呈版面
  const resolved = resolvePdfLayoutType(request);
  if (resolved === type && type !== 'general') return true;
  return null;
}

/** 是否為請假類表單（使用專用請假單版面） */
function isLeaveRequest(request) {
  const m = matchPdfLayout(request, 'leave');
  if (m !== null) return m;
  const name = String(request?.workflow_name || request?.form_name || '');
  if (/請假|休假|leave/i.test(name)) return true;
  const fields = request?.formFields || [];
  const ids = new Set(fields.map((f) => f.id));
  return ids.has('leave_type') && (ids.has('start_date') || ids.has('days'));
}

/** 信用額度申請表 */
function isCreditLimitRequest(request) {
  const m = matchPdfLayout(request, 'credit_limit');
  if (m !== null) return m;
  const name = String(request?.workflow_name || request?.form_name || request?.title || '');
  if (/信用額度|授信額度|額度申請/i.test(name)) return true;
  const fields = request?.formFields || [];
  const ids = new Set(fields.map((f) => f.id));
  return (
    ids.has('requested_credit_limit') ||
    ids.has('customer_name') ||
    ids.has('sales_credit_limit') ||
    ids.has('credit_limit')
  );
}

/** 請購／支付類表單 */
function isPurchaseRequest(request) {
  const m = matchPdfLayout(request, 'purchase');
  if (m !== null) return m;
  const name = String(request?.workflow_name || request?.form_name || '');
  if (/請購|採購|支付|付款|purchase|payment/i.test(name)) return true;
  const fields = request?.formFields || [];
  const ids = new Set(fields.map((f) => f.id));
  return (
    (ids.has('item_name') || ids.has('vendor')) &&
    (ids.has('amount') || ids.has('currency'))
  );
}

/** 費用報支 */
function isExpenseRequest(request) {
  const m = matchPdfLayout(request, 'expense');
  if (m !== null) return m;
  const name = String(request?.workflow_name || request?.form_name || '');
  if (/費用|報支|報銷|核銷|請款|expense/i.test(name)) return true;
  const fields = request?.formFields || [];
  const ids = new Set(fields.map((f) => f.id));
  return (
    ids.has('expense_type') ||
    (ids.has('expense_date') && ids.has('amount') && !ids.has('item_name'))
  );
}

/** 出差申請 */
function isTravelRequest(request) {
  const m = matchPdfLayout(request, 'travel');
  if (m !== null) return m;
  const name = String(request?.workflow_name || request?.form_name || '');
  if (/出差|公差|旅費|travel|business.?trip/i.test(name)) return true;
  const fields = request?.formFields || [];
  const ids = new Set(fields.map((f) => f.id));
  return ids.has('destination') && (ids.has('purpose') || ids.has('budget'));
}

/** 電腦異常報修 */
function isItRepairRequest(request) {
  const m = matchPdfLayout(request, 'it_repair');
  if (m !== null) return m;
  const name = String(request?.workflow_name || request?.form_name || '');
  if (/電腦|報修|資訊設備/i.test(name)) return true;
  const fields = request?.formFields || [];
  const ids = new Set(fields.map((f) => f.id));
  return ids.has('issue_desc') && ids.has('computer_spec');
}

/** 延長工時／加班 */
function isOvertimeRequest(request) {
  const m = matchPdfLayout(request, 'overtime');
  if (m !== null) return m;
  const name = String(request?.workflow_name || request?.form_name || '');
  if (/加班|延長工時|延時|overtime/i.test(name)) return true;
  const fields = request?.formFields || [];
  const ids = new Set(fields.map((f) => f.id));
  return ids.has('ot_start') || ids.has('ot_end') || ids.has('ot_option');
}

/** 一般簽呈 */
function isGeneralMemoRequest(request) {
  const m = matchPdfLayout(request, 'general');
  if (m !== null) return m;
  const name = String(request?.workflow_name || request?.form_name || '');
  if (/簽呈/.test(name)) return true;
  const fields = request?.formFields || [];
  const ids = new Set(fields.map((f) => f.id));
  return ids.has('subject') && ids.has('category');
}

/**
 * 各申請單專用色系（抬頭／標籤／區塊／框線）
 * 請假：綠｜請購：橘｜費用：薔薇紅｜報修：藍｜加班：紫｜簽呈：深藍
 */
const FORM_UI_THEMES = {
  leave: {
    header: '#0f766e',
    headerSoft: '#ccfbf1',
    labelBg: '#f0fdfa',
    sectionBg: '#99f6e4',
    line: '#5eead4',
    lineDark: '#0f766e',
    softLine: '#99f6e4',
    softInk: '#115e59',
    altBg: '#f0fdfa',
  },
  purchase: {
    header: '#c2410c',
    headerSoft: '#ffedd5',
    labelBg: '#fff7ed',
    sectionBg: '#fed7aa',
    line: '#fdba74',
    lineDark: '#ea580c',
    softLine: '#fdba74',
    softInk: '#9a3412',
    altBg: '#fffbeb',
  },
  it: {
    header: '#0369a1',
    headerSoft: '#e0f2fe',
    labelBg: '#f0f9ff',
    sectionBg: '#bae6fd',
    line: '#7dd3fc',
    lineDark: '#0284c7',
    softLine: '#7dd3fc',
    softInk: '#075985',
    altBg: '#f0f9ff',
  },
  overtime: {
    header: '#6d28d9',
    headerSoft: '#ede9fe',
    labelBg: '#f5f3ff',
    sectionBg: '#ddd6fe',
    line: '#c4b5fd',
    lineDark: '#7c3aed',
    softLine: '#c4b5fd',
    softInk: '#5b21b6',
    altBg: '#faf5ff',
  },
  memo: {
    header: '#1e3a5f',
    headerSoft: '#e2e8f0',
    labelBg: '#f1f5f9',
    sectionBg: '#cbd5e1',
    line: '#94a3b8',
    lineDark: '#334155',
    softLine: '#94a3b8',
    softInk: '#1e293b',
    altBg: '#f8fafc',
  },
  expense: {
    header: '#be123c',
    headerSoft: '#ffe4e6',
    labelBg: '#fff1f2',
    sectionBg: '#fecdd3',
    line: '#fda4af',
    lineDark: '#e11d48',
    softLine: '#fda4af',
    softInk: '#9f1239',
    altBg: '#fff1f2',
  },
  travel: {
    header: '#4d7c0f',
    headerSoft: '#ecfccb',
    labelBg: '#f7fee7',
    sectionBg: '#d9f99d',
    line: '#a3e635',
    lineDark: '#65a30d',
    softLine: '#bef264',
    softInk: '#3f6212',
    altBg: '#f7fee7',
  },
};

module.exports = {
  STATUS_LABEL,
  ACTION_LABEL,
  AD_LABELS,
  shortLeaveTypeNamePdf,
  isSpecialLeaveTypePdf,
  hrLeaveLabelsPdf,
  adLabelPdf,
  formatDisplayValue,
  FORM_THEME_PALETTE,
  FORM_THEME_KEYWORDS,
  hashString,
  resolveFormTheme,
  resolvePdfLayoutType,
  hasExplicitPdfLayout,
  matchPdfLayout,
  isLeaveRequest,
  isCreditLimitRequest,
  isPurchaseRequest,
  isExpenseRequest,
  isTravelRequest,
  isItRepairRequest,
  isOvertimeRequest,
  isGeneralMemoRequest,
  FORM_UI_THEMES,
};
