/**
 * 簽核流程模組（流程步驟 + 申請表單欄位 + PDF 排版 + 最終核准通知）
 * 匯出／匯入一體；不包含系統設定、Email 帳密、使用者帳號本體、歷史單據。
 *
 * pdfLayout.type 對應 server/pdf.js 版面：
 *   leave | credit_limit | welfare | dept_meeting | purchase | expense | travel | it_repair | overtime | general | auto
 *
 * finalNotify：最終一步（如總經理）核定通過、單據變「已核准」後，
 * 可選擇通知的額外人員（**系統內通知**，非 Email；需點「確認收到通知」）。
 * 申請人本人仍依既有 notify_prefs／Email 偏好通知，與此設定分開。
 */
const PDF_LAYOUT_TYPES = [
  'leave',
  'credit_limit',
  'welfare',
  'purchase',
  'expense',
  'travel',
  'it_repair',
  'overtime',
  'dept_meeting',
  'general',
  'pdf_template',
  'auto',
];

const TYPE_META = {
  leave: { label: '請假單版面', match: /請假|休假|leave/i },
  credit_limit: { label: '信用額度申請表版面', match: /信用額度|授信額度|額度申請/i },
  welfare: { label: '福利金明細月報表版面', match: /福利金/i },
  purchase: { label: '請購申請版面', match: /請購|採購|訂購|支付|付款|purchase|payment/i },
  expense: { label: '費用報支版面', match: /費用|報支|報銷|請款|expense/i },
  travel: { label: '出差申請版面', match: /出差|公出|差旅|travel|business.?trip/i },
  it_repair: { label: '電腦異常報修版面', match: /電腦|報修|資訊設備/i },
  overtime: { label: '延長工時版面', match: /加班|延長工時|超時|overtime/i },
  dept_meeting: { label: '會議記錄版面', match: /部門月會|會議記錄/ },
  general: { label: '一般簽呈版面', match: /簽呈/i },
  pdf_template: { label: '紙本底圖套印版面', match: null },
  auto: { label: '依流程名稱自動判斷', match: null },
};

/**
 * 依流程名稱推斷 PDF 版面類型（未指定或 auto 時使用）
 */
function detectPdfLayoutType(workflowName) {
  const name = String(workflowName || '');
  const order = [
    'leave',
    'credit_limit',
    'welfare',
    'purchase',
    'expense',
    'travel',
    'it_repair',
    'overtime',
    'dept_meeting',
    'general',
  ];
  for (const t of order) {
    const m = TYPE_META[t]?.match;
    if (m && m.test(name)) return t;
  }
  return 'general';
}

/**
 * 正規化 pdfLayout 物件
 * @returns {{ type: string, label?: string, options?: object, templateFile?: string, templateMeta?: object, fields?: Array }}
 */
function normalizePdfLayout(raw, workflowName) {
  let obj = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      obj = { type: raw };
    }
  }
  if (!obj || typeof obj !== 'object') obj = {};
  let type = String(obj.type || obj.layoutType || 'auto').trim() || 'auto';
  if (!PDF_LAYOUT_TYPES.includes(type)) type = 'auto';
  const resolved = type === 'auto' ? detectPdfLayoutType(workflowName) : type;
  const res = {
    type,
    resolvedType: resolved,
    label: obj.label || TYPE_META[resolved]?.label || TYPE_META[type]?.label || type,
    options: obj.options && typeof obj.options === 'object' ? obj.options : {},
  };
  if (type === 'pdf_template' || obj.templateFile) {
    res.templateFile = obj.templateFile || '';
    res.templateMeta = obj.templateMeta && typeof obj.templateMeta === 'object' ? obj.templateMeta : {};
    res.fields = Array.isArray(obj.fields) ? obj.fields : [];
    res.formMode = obj.formMode || 'paper'; // 'paper' (電子紙) or 'split' (對照)
  }
  return res;
}

function parsePdfLayoutJson(json, workflowName) {
  if (json == null || json === '') {
    return normalizePdfLayout({ type: 'auto' }, workflowName);
  }
  try {
    const o = typeof json === 'string' ? JSON.parse(json) : json;
    return normalizePdfLayout(o, workflowName);
  } catch {
    return normalizePdfLayout({ type: 'auto' }, workflowName);
  }
}

function pdfLayoutToJson(layout, workflowName) {
  const n = normalizePdfLayout(layout || { type: 'auto' }, workflowName);
  const out = {
    type: n.type,
    label: n.label,
    options: n.options || {},
  };
  if (n.type === 'pdf_template' || n.templateFile) {
    out.templateFile = n.templateFile;
    out.templateMeta = n.templateMeta;
    out.fields = n.fields;
    out.formMode = n.formMode;
  }
  return JSON.stringify(out);
}

/**
 * 最終核准完成通知設定（系統內）
 * - userIds：要通知的對象（收件人，需確認收到）
 * - applicantMode / applicantUserIds：哪些「申請人」的單據才啟用此通知
 *   all＝全部申請人；selected＝僅勾選的申請人（例：請假流程只對特定同仁通知）
 * @returns {{
 *   enabled: boolean,
 *   userIds: number[],
 *   users: Array<{id?:number, username?:string, name?:string}>,
 *   applicantMode: 'all'|'selected',
 *   applicantUserIds: number[],
 *   applicants: Array<{id?:number, username?:string, name?:string}>,
 *   label: string
 * }}
 */
function collectUserList(rawList, idArrays) {
  const ids = [];
  const seen = new Set();
  const users = [];
  const pushId = (v) => {
    const n = Number(v);
    if (n && !seen.has(n)) {
      seen.add(n);
      ids.push(n);
    }
  };
  for (const arr of idArrays || []) {
    if (Array.isArray(arr)) arr.forEach(pushId);
  }
  if (Array.isArray(rawList)) {
    for (const u of rawList) {
      if (!u || typeof u !== 'object') continue;
      if (u.id) pushId(u.id);
      users.push({
        id: u.id != null ? Number(u.id) || undefined : undefined,
        username: u.username ? String(u.username) : undefined,
        name: u.name ? String(u.name) : undefined,
      });
    }
  }
  return { ids, users };
}

function normalizeFinalNotify(raw) {
  let obj = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      obj = {};
    }
  }
  if (!obj || typeof obj !== 'object') obj = {};

  const enabled = Boolean(obj.enabled ?? obj.enable ?? obj.on);
  const label = String(obj.label || obj.deptName || '最終核准完成通知').trim() || '最終核准完成通知';

  const notify = collectUserList(obj.users, [
    obj.userIds,
    obj.approverIds,
    obj.notifyUserIds,
  ]);
  if (Array.isArray(obj.usernames)) {
    for (const un of obj.usernames) {
      const s = String(un || '').trim();
      if (s) notify.users.push({ username: s });
    }
  }

  // 申請人範圍：all | selected
  let applicantMode = String(obj.applicantMode || obj.forApplicants || 'all').toLowerCase();
  if (applicantMode !== 'selected' && applicantMode !== 'all') {
    // 舊資料若有 applicantUserIds 且非空，視為 selected
    applicantMode =
      Array.isArray(obj.applicantUserIds) && obj.applicantUserIds.length
        ? 'selected'
        : 'all';
  }
  if (obj.applicantAll === true || obj.allApplicants === true) applicantMode = 'all';
  if (obj.applicantAll === false || obj.onlySelectedApplicants === true) {
    applicantMode = 'selected';
  }

  const applicants = collectUserList(obj.applicants || obj.applicantUsers, [
    obj.applicantUserIds,
    obj.requesterIds,
    obj.applicantIds,
  ]);
  if (Array.isArray(obj.applicantUsernames)) {
    for (const un of obj.applicantUsernames) {
      const s = String(un || '').trim();
      if (s) applicants.users.push({ username: s });
    }
  }

  return {
    enabled,
    userIds: notify.ids,
    users: notify.users,
    applicantMode,
    applicantUserIds: applicants.ids,
    applicants: applicants.users,
    label,
  };
}

/**
 * 此申請人的單據是否需觸發最終通知模組
 */
function shouldApplyFinalNotify(finalNotify, requesterId) {
  const n = normalizeFinalNotify(finalNotify || {});
  if (!n.enabled) return false;
  if (!n.userIds || !n.userIds.length) return false;
  if (n.applicantMode !== 'selected') return true;
  const rid = Number(requesterId);
  if (!rid) return false;
  return (n.applicantUserIds || []).map(Number).includes(rid);
}

function parseFinalNotifyJson(json) {
  if (json == null || json === '') {
    return normalizeFinalNotify({ enabled: false, userIds: [], applicantMode: 'all' });
  }
  try {
    const o = typeof json === 'string' ? JSON.parse(json) : json;
    return normalizeFinalNotify(o);
  } catch {
    return normalizeFinalNotify({ enabled: false, userIds: [], applicantMode: 'all' });
  }
}

/**
 * 寫入 DB 用（精簡，不含完整 users 列表亦可；匯出時再補）
 */
function finalNotifyToJson(raw) {
  const n = normalizeFinalNotify(raw || {});
  return JSON.stringify({
    enabled: n.enabled,
    userIds: n.userIds,
    label: n.label,
    applicantMode: n.applicantMode || 'all',
    applicantUserIds: n.applicantUserIds || [],
    // 匯出／跨站匯入用：保留 username
    users: (n.users || [])
      .filter((u) => u && (u.username || u.id))
      .map((u) => ({
        id: u.id,
        username: u.username || undefined,
        name: u.name || undefined,
      })),
    applicants: (n.applicants || [])
      .filter((u) => u && (u.username || u.id))
      .map((u) => ({
        id: u.id,
        username: u.username || undefined,
        name: u.name || undefined,
      })),
  });
}

/**
 * 組出可匯出的一體模組（單一流程）
 */
function buildExportModule({
  id,
  name,
  category,
  description,
  formFields,
  steps,
  pdfLayout,
  finalNotify,
  exportedAt,
}) {
  const layout = normalizePdfLayout(pdfLayout || { type: 'auto' }, name);
  const notify = normalizeFinalNotify(finalNotify || { enabled: false });
  return {
    format: 'approval-system-workflow',
    version: 2,
    module: 'workflow+form+pdfLayout+finalNotify',
    sourceId: id != null ? id : undefined,
    name: name || '',
    category: category || '一般簽呈',
    description: description || '',
    formFields: Array.isArray(formFields) ? formFields : [],
    steps: Array.isArray(steps) ? steps : [],
    pdfLayout: {
      type: layout.type,
      resolvedType: layout.resolvedType,
      label: layout.label,
      options: layout.options || {},
    },
    finalNotify: {
      enabled: notify.enabled,
      userIds: notify.userIds,
      users: notify.users || [],
      applicantMode: notify.applicantMode || 'all',
      applicantUserIds: notify.applicantUserIds || [],
      applicants: notify.applicants || [],
      label: notify.label,
    },
    exportedAt: exportedAt || new Date().toISOString(),
  };
}

function listPdfLayoutTypes() {
  return PDF_LAYOUT_TYPES.map((type) => ({
    type,
    label: TYPE_META[type]?.label || type,
  }));
}

module.exports = {
  PDF_LAYOUT_TYPES,
  TYPE_META,
  detectPdfLayoutType,
  normalizePdfLayout,
  parsePdfLayoutJson,
  pdfLayoutToJson,
  normalizeFinalNotify,
  shouldApplyFinalNotify,
  parseFinalNotifyJson,
  finalNotifyToJson,
  buildExportModule,
  listPdfLayoutTypes,
};
