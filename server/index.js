const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const {
  normalizeUsername,
  BUILTIN_ADMIN_USERNAME,
  isBuiltinAdminUsername,
  isBuiltinAdminUser,
  hashPassword,
  verifyPassword,
  signToken,
  authMiddleware,
  adminOnly,
  builtinAdminOnly,
} = require('./auth');
const {
  generateApprovalPdf,
  writeApprovalPdf,
  buildApprovalPdfFileName,
  buildApprovalZipFileName,
  contentDispositionAttachment,
  getChineseFontPath,
} = require('./pdf');
const archiver = require('archiver');
const { PassThrough } = require('stream');
const {
  runBackupJob,
  listBackups,
  getBackupMeta,
  getBackupById,
  resolveBackupAbsPath,
  backupOneRequest,
  deleteBackup,
  deleteBackups,
  isZipBackup,
  listLeaveRequestIds,
} = require('./backup');
const { hashPassword: hp } = require('./auth');
const mail = require('./mail');
const { importPayload } = require('./import-workflows');
const workflowModule = require('./workflow-module');
const systemPackage = require('./system-package');
const labor = require('./labor');
const leaveReport = require('./leave-report');
const requestExport = require('./request-export');
const commentPhrases = require('./comment-phrases');
const twCalendar = require('./tw-calendar');
const systemSettings = require('./system-settings');
const pdfSign = require('./pdf-sign');
const appVersion = require('./version');
const deployLog = require('./deploy-log');
const onlyoffice = require('./onlyoffice');
const agents = require('./agents');
const registerDepartmentRoutes = require('./routes/departments');
const registerMailRoutes = require('./routes/mail-settings');
const registerSystemAdminRoutes = require('./routes/system-admin');
const registerReportRoutes = require('./routes/reports');
const registerWorkflowRoutes = require('./routes/workflows');
const registerBackupRoutes = require('./routes/backups');
const fs = require('fs');
const os = require('os');
const multer = require('multer');
const crypto = require('crypto');

const UPLOAD_DIR = path.join(__dirname, '..', 'data', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
]);

/**
 * 修正 Multer/Busboy 中文檔名亂碼。
 * 瀏覽器以 UTF-8 傳送檔名時，部分環境會被當成 Latin-1 解碼；
 * 還原：latin1 bytes → utf8 字串。已是正確中文則不轉換。
 */
function decodeUploadFilename(name) {
  if (name == null || name === '') return 'file';
  let s = String(name);
  s = s.replace(/^.*[\\/]/, '');
  if (!s) return 'file';

  const hasCjk = (t) => /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/.test(t);
  const hasMojibakeHint = (t) =>
    /[\u00c0-\u024f]/.test(t) || /Ã.|Â.|å.|æ.|ç.|è.|é./.test(t);

  try {
    if (hasCjk(s) && !hasMojibakeHint(s)) {
      return s.slice(0, 200);
    }
    const fixed = Buffer.from(s, 'latin1').toString('utf8');
    if (fixed && fixed !== s) {
      if (hasCjk(fixed) || (!hasMojibakeHint(fixed) && hasMojibakeHint(s))) {
        if (!fixed.includes('\uFFFD')) {
          return fixed.slice(0, 200);
        }
      }
    }
  } catch {
    /* keep original */
  }
  return s.slice(0, 200);
}

function safeUploadExt(originalName) {
  const decoded = decodeUploadFilename(originalName);
  let ext = path.extname(decoded || '').slice(0, 20);
  if (ext && !/^\.[A-Za-z0-9._+-]+$/.test(ext)) {
    ext = '';
  }
  return ext;
}

/** 設定包 JSON 上傳（可寫目錄，上限 1GB；含歷史＋附件 base64 會很大） */
const PACKAGE_MAX_BYTES = 1024 * 1024 * 1024;
function ensurePkgTmpDir() {
  const candidates = [
    path.join(__dirname, '..', 'data', 'tmp'),
    path.join(os.tmpdir(), 'approval-pkg'),
  ];
  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const probe = path.join(dir, `.w-${process.pid}`);
      fs.writeFileSync(probe, 'ok');
      fs.unlinkSync(probe);
      return dir;
    } catch {
      /* 目錄可能是 root 建的，改試下一處 */
    }
  }
  return os.tmpdir();
}
const PKG_TMP_DIR = ensurePkgTmpDir();

const uploadPackage = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, ensurePkgTmpDir()),
    filename: (_req, _file, cb) =>
      cb(null, `pkg_${Date.now()}_${crypto.randomBytes(8).toString('hex')}.json`),
  }),
  limits: { fileSize: PACKAGE_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    const name = decodeUploadFilename(file.originalname || '').toLowerCase();
    if (name.endsWith('.json') || file.mimetype === 'application/json' || file.mimetype === 'text/plain') {
      return cb(null, true);
    }
    cb(new Error('請上傳 .json 設定包'));
  },
});

function packageUploadError(err) {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return '設定包檔案太大（上限 1GB）。請改匯出不含歷史的設定包，或向系統管理員確認檔案大小。';
  }
  return (err && err.message) || '上傳失敗';
}

function parseUploadedPackage(req) {
  if (req.file?.path) {
    try {
      const text = fs.readFileSync(req.file.path, 'utf8').replace(/^\uFEFF/, '');
      return JSON.parse(text);
    } finally {
      try {
        fs.unlinkSync(req.file.path);
      } catch {
        /* ignore */
      }
    }
  }
  if (req.file?.buffer) {
    return JSON.parse(req.file.buffer.toString('utf8').replace(/^\uFEFF/, ''));
  }
  if (req.body?.package) {
    return typeof req.body.package === 'string'
      ? JSON.parse(req.body.package)
      : req.body.package;
  }
  if (req.body && req.body.format) return req.body;
  return null;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const ext = safeUploadExt(file.originalname || '');
      cb(null, `${Date.now()}_${crypto.randomBytes(8).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 20 },
  fileFilter: (_req, file, cb) => {
    // 允許常見文件；未知類型仍接受但標註
    if (!file.mimetype || ALLOWED_MIME.has(file.mimetype) || file.mimetype.startsWith('image/')) {
      return cb(null, true);
    }
    // 仍允許其他類型（如 .msg），但限制大小
    return cb(null, true);
  },
});

function saveAttachments(requestId, userId, files, stepOrder = null) {
  if (!files || !files.length) return [];
  const step =
    stepOrder === null || stepOrder === undefined || stepOrder === ''
      ? null
      : Number(stepOrder);
  const ins = db.prepare(
    `INSERT INTO request_attachments
      (request_id, original_name, stored_name, mime_type, size_bytes, uploaded_by, step_order)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const saved = [];
  for (const f of files) {
    const original = decodeUploadFilename(f.originalname || 'file');
    const r = ins.run(
      requestId,
      original,
      f.filename,
      f.mimetype || '',
      f.size || 0,
      userId,
      Number.isFinite(step) ? step : null
    );
    saved.push({
      id: Number(r.lastInsertRowid),
      original_name: original,
      size_bytes: f.size || 0,
      mime_type: f.mimetype || '',
      step_order: Number.isFinite(step) ? step : null,
    });
  }
  return saved;
}

function getAttachments(requestId) {
  return db
    .prepare(
      `SELECT a.id, a.original_name, a.mime_type, a.size_bytes, a.created_at, a.step_order,
              a.uploaded_by, a.source_request_id, u.name AS uploader_name
       FROM request_attachments a
       LEFT JOIN users u ON u.id = a.uploaded_by
       WHERE a.request_id = ?
       ORDER BY a.id ASC`
    )
    .all(requestId)
    .map((a) => ({
      ...a,
      original_name: decodeUploadFilename(a.original_name || 'file'),
    }));
}

/** 是否為流程最後一個簽核步驟（最終審核者） */
function isFinalApprovalStep(steps, step) {
  if (!step || !Array.isArray(steps) || !steps.length) return false;
  const maxOrder = Math.max(...steps.map((s) => Number(s.order) || 0));
  return Number(step.order) === maxOrder;
}

/** 目前使用者可否在簽核中補充附件（非最終審核步驟） */
function canUserAttachOnStep(userId, detail) {
  if (!detail || detail.status !== 'pending') return false;
  const steps = detail.steps || [];
  const step = findStepByOrder(steps, detail.current_step);
  if (!canUserApproveStep(userId, step, detail.id)) return false;
  if (isFinalApprovalStep(steps, step)) return false;
  return true;
}

/**
 * 是否已有簽署人核准過（含會簽已有人簽、或已進入第 2 關以後）
 * 一旦成立，申請單不可取消／刪除
 */
function hasApproverSigned(requestId, detail = null) {
  const id = Number(requestId);
  if (!id) return false;
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM approval_actions
       WHERE request_id = ? AND action = 'approve'`
    )
    .get(id);
  if ((row?.c || 0) > 0) return true;
  const stepOrder =
    detail && detail.current_step != null
      ? Number(detail.current_step)
      : Number(
          db
            .prepare(`SELECT current_step FROM approval_requests WHERE id = ?`)
            .get(id)?.current_step || 0
        );
  // 已前進到下一關（預設第一關 order 多為 1）
  if (Number.isFinite(stepOrder) && stepOrder > 1) return true;
  return false;
}

const MSG_LOCKED_AFTER_SIGN =
  '下一位簽署人已簽核，此申請單無法取消或刪除';

/** 可指派給成員的功能權限（系統管理員 role=admin 預設擁有全部） */
const PERMISSION_DEFS = [
  { id: 'workflows', label: '管理簽核流程', description: '建立／編輯／停用簽核流程模板' },
  { id: 'backups', label: '備份資料', description: '執行 PDF 備份與查詢下載' },
  { id: 'records_all', label: '查看全部簽核紀錄', description: '可查看所有人的簽核單（不受本人限制）' },
  {
    id: 'records_delete',
    label: '刪除簽核紀錄',
    description:
      '可刪除簽核紀錄中的申請單（含他人單據）；已有簽署人核准的單據仍不可刪。系統管理員預設具備。',
  },
  {
    id: 'leave_delete',
    label: '刪除請假申請',
    description:
      '人事：可刪除所有人的請假申請（含簽核進行中、已有人簽核者）。系統管理員預設具備。',
  },
  {
    id: 'leave_report',
    label: '請假報表匯出',
    description:
      '人事：匯出請假 Excel；亦可於「備份資料」條件查詢並勾選下載請假申請單 PDF（ZIP）',
  },
  {
    id: 'users_leave',
    label: '成員休假已休管理',
    description: '可查看成員名單與休假試算，並編輯各假別手動已休天數／小時（不可改帳號權限）',
  },
  {
    id: 'finance_confirm',
    label: '財務部授信額度建檔確認',
    description: '財務部：可於總覽／待簽核檢視待建檔信用額度申請單，並進行建檔登記',
  },
];
const ALL_PERM_IDS = PERMISSION_DEFS.map((p) => p.id);

/**
 * 是否為財務建檔人員（僅財務）
 * 注意：系統管理員／總經理 role=admin 不會自動算財務，
 * 避免總經理簽核完立刻看到「確認完成額度建檔」。
 * 用於：建檔確認按鈕、待建檔列表、核准後 Email 通知對象。
 */
function isFinanceUser(user) {
  if (!user) return false;
  if (user.department === '財務部') return true;
  try {
    const depts = getUserDepartments(user.id);
    if (depts.includes('財務部')) return true;
  } catch {
    /* ignore */
  }
  const uname = String(user.username || '');
  if (/^gigi$/i.test(uname) || user.name === '張美雯') return true;
  if (/^joan$/i.test(uname) || user.name === '詹慈敏') return true;
  // 一般帳號有 finance_confirm；admin 的 userHasPermission 會全開，故排除 admin
  if (user.role !== 'admin' && userHasPermission(user.id, 'finance_confirm')) {
    return true;
  }
  return false;
}

function isCreditLimitRequestRow(rowOrDetail) {
  if (!rowOrDetail) return false;
  const name = String(rowOrDetail.workflow_name || '');
  const title = String(rowOrDetail.title || '');
  return /信用額度|授信額度|額度申請/.test(name) || /信用額度|授信額度/.test(title);
}

/** 信用額度：副總核決上限（元，含本數）。超過須總經理核定（100 萬元 = 1,000,000 元） */
const CREDIT_VGM_MAX_YUAN = 1_000_000;

function isCreditVgmStep(step) {
  return /副總/.test(String(step?.name || ''));
}

function isCreditGmStep(step) {
  return /總經理/.test(String(step?.name || ''));
}

/**
 * 信用額度輸入 → 元（整數）
 * - 字串含「萬」：25萬 → 250000
 * - 純數字：視為元
 * - 若明顯誤填「萬」為數字（相對參考額度約 1/10000），自動 ×10000
 */
function parseCreditAmountToYuan(raw, referenceYuan = null) {
  if (raw == null || raw === '') return null;
  const s0 = String(raw).trim();
  if (!s0) return null;
  const hasWan = /萬/.test(s0);
  const n = Number(s0.replace(/[,，\s元萬]/g, ''));
  if (!Number.isFinite(n) || n < 0) return null;
  let yuan = Math.round(hasWan ? n * 10000 : n);
  // 誤把「萬」當「元」填：例 申請 250000、建議填 25 → 校正為 250000
  const ref = Number(referenceYuan);
  if (
    !hasWan &&
    Number.isFinite(ref) &&
    ref >= 10000 &&
    yuan > 0 &&
    yuan < 10000
  ) {
    const times = ref / yuan;
    if (
      Math.round(ref / 10000) === yuan ||
      (times >= 9000 && times <= 11000)
    ) {
      yuan = Math.round(yuan * 10000);
    }
  }
  return yuan;
}

/** 核決／表單額度欄位鍵 */
const CREDIT_LIMIT_FIELD_IDS = new Set([
  'requested_credit_limit',
  'sales_requested_limit',
  'vp_suggested_limit',
  'gm_approved_limit',
  'finance_suggested_limit',
  'finance_established_limit',
  'credit_limit_current',
  'accounts_receivable',
  'notes_receivable',
  'credit_balance',
  'credit_limit_yuan',
]);

/**
 * 正規化步驟表單中的信用額度欄位為「元」字串
 * @returns {{ data: object, corrections: string[] }}
 */
function normalizeCreditStepFormData(data, detail) {
  const out = { ...(data || {}) };
  const corrections = [];
  const ad =
    detail?.approver_data && typeof detail.approver_data === 'object'
      ? detail.approver_data
      : {};
  const fd =
    detail?.form_data && typeof detail.form_data === 'object' ? detail.form_data : {};
  // 參考額度：業務申請優先
  const ref =
    parseCreditAmountToYuan(ad.requested_credit_limit) ??
    parseCreditAmountToYuan(out.requested_credit_limit) ??
    parseCreditAmountToYuan(fd.credit_limit_current);

  for (const key of Object.keys(out)) {
    if (!CREDIT_LIMIT_FIELD_IDS.has(key) && !/_limit$/.test(key)) continue;
    if (/條件|原由|備註|note|condition|reason/i.test(key)) continue;
    const raw = out[key];
    if (raw == null || raw === '') continue;
    const before = Number(String(raw).replace(/[,，\s元萬]/g, ''));
    const yuan = parseCreditAmountToYuan(raw, ref);
    if (yuan == null) continue;
    out[key] = String(yuan);
    if (Number.isFinite(before) && before !== yuan && before * 10000 === yuan) {
      corrections.push(`${key}: ${before}→${yuan}（已依「萬→元」校正）`);
    }
  }
  return { data: out, corrections };
}

/**
 * 解析信用額度金額（元）
 * 優先：副總建議額度 → 業務申請額度 → 總經理核定 → 表單欄位
 */
function resolveCreditLimitYuan(detail, extraData) {
  const ad =
    detail?.approver_data && typeof detail.approver_data === 'object'
      ? detail.approver_data
      : {};
  const fd =
    detail?.form_data && typeof detail.form_data === 'object' ? detail.form_data : {};
  const extra = extraData && typeof extraData === 'object' ? extraData : {};
  const ref =
    parseCreditAmountToYuan(extra.requested_credit_limit) ??
    parseCreditAmountToYuan(ad.requested_credit_limit) ??
    parseCreditAmountToYuan(fd.credit_limit_current);
  const candidates = [
    extra.vp_suggested_limit,
    ad.vp_suggested_limit,
    extra.requested_credit_limit,
    ad.requested_credit_limit,
    ad.sales_requested_limit,
    extra.gm_approved_limit,
    ad.gm_approved_limit,
    fd.requested_credit_limit,
    fd.credit_limit_current,
    fd.credit_limit_yuan,
  ];
  for (const c of candidates) {
    if (c == null || c === '') continue;
    const n = parseCreditAmountToYuan(c, ref);
    if (n != null && n >= 0) return n;
  }
  return null;
}

/**
 * 信用額度：副總核決後，若額度 ≤ 1,000,000 元（含）則略過後續「總經理」關
 * @returns {{ skipGm: boolean, yuan: number|null, nextIndex: number }}
 */
function creditLimitNextAfterVgm(steps, vgmIdx, detail, stepFormData) {
  const yuan = resolveCreditLimitYuan(detail, stepFormData);
  let nextIndex = vgmIdx + 1;
  let skipGm = false;
  if (yuan != null && yuan <= CREDIT_VGM_MAX_YUAN) {
    // 略過連續的總經理步驟
    while (nextIndex < steps.length && isCreditGmStep(steps[nextIndex])) {
      skipGm = true;
      nextIndex += 1;
    }
  }
  return { skipGm, yuan, nextIndex };
}

/** 是否可刪除簽核紀錄（管理員或具備 records_delete） */
function canDeleteApprovalRecords(userOrId) {
  if (userOrId == null) return false;
  if (typeof userOrId === 'object') {
    if (userOrId.role === 'admin') return true;
    const id = Number(userOrId.id);
    return id ? userHasPermission(id, 'records_delete') : false;
  }
  return userHasPermission(Number(userOrId), 'records_delete');
}

/** 是否為請假類申請（流程名或主旨含「請假」） */
function isLeaveApprovalRequest(rowOrDetail) {
  if (!rowOrDetail) return false;
  const name = String(rowOrDetail.workflow_name || '');
  const title = String(rowOrDetail.title || '');
  return /請假/.test(name) || /請假/.test(title);
}

/** 人事：可刪除所有人請假申請（含簽核中） */
function canDeleteLeaveRequests(userOrId) {
  if (userOrId == null) return false;
  if (typeof userOrId === 'object') {
    if (userOrId.role === 'admin') return true;
    const id = Number(userOrId.id);
    return id ? userHasPermission(id, 'leave_delete') : false;
  }
  return userHasPermission(Number(userOrId), 'leave_delete');
}

function parsePermissions(json) {
  try {
    const arr = typeof json === 'string' ? JSON.parse(json || '[]') : json;
    if (!Array.isArray(arr)) return [];
    return arr.map(String).filter((id) => ALL_PERM_IDS.includes(id));
  } catch {
    return [];
  }
}

function getPermissionsForUser(userRow) {
  if (!userRow) return [];
  if (userRow.role === 'admin') return [...ALL_PERM_IDS];
  return parsePermissions(userRow.permissions_json);
}

function getUserDepartments(userId) {
  return db
    .prepare(
      `SELECT department FROM user_departments WHERE user_id = ? ORDER BY department COLLATE NOCASE`
    )
    .all(userId)
    .map((r) => r.department);
}

function publicUser(row, { withLabor = false } = {}) {
  if (!row) return null;
  const departments = getUserDepartments(row.id);
  // 主要顯示：users.department，若空則取多部門第一個
  const primary =
    (row.department && String(row.department).trim()) || departments[0] || '';
  const hireDate = labor.toDateOnly(row.hire_date) || null;
  const leaveUsedMap = labor.parseLeaveUsedManual(row);
  const leaveEntitledMap = labor.parseLeaveEntitledManual(row);
  const slUsedDays = labor.snapHalf(leaveUsedMap.special?.days || 0);
  const slUsedHours = labor.snapHalf(leaveUsedMap.special?.hours || 0);
  const base = {
    id: row.id,
    // 顯示／API 一律首字母大寫（與庫存正規化一致）
    username: normalizeUsername(row.username),
    name: row.name,
    email: row.email || '',
    phone: row.phone || '',
    extension: row.extension || '',
    email_notify: row.email_notify === 0 || row.email_notify === false ? 0 : 1,
    hire_date: hireDate,
    sl_used_days: slUsedDays,
    sl_used_hours: slUsedHours,
    leave_used: leaveUsedMap,
    leave_entitled: leaveEntitledMap,
    department: primary,
    departments,
    role: row.role,
    active: row.active,
    created_at: row.created_at,
    permissions: getPermissionsForUser(row),
    comment_phrases: commentPhrases.parsePhrasesJson(row.comment_phrases_json),
  };
  if (withLabor) {
    base.labor = labor.buildLaborSummary({
      ...row,
      hire_date: hireDate,
      id: row.id,
      sl_used_days: slUsedDays,
      sl_used_hours: slUsedHours,
      leave_used_json:
        row.leave_used_json ||
        JSON.stringify(leaveUsedMap),
      leave_entitled_json:
        row.leave_entitled_json ||
        JSON.stringify(leaveEntitledMap),
    });
  } else {
    // 輕量：名單列表用（可休改為手動，不依年資）
    const ent = labor.snapHalf(leaveEntitledMap.special?.days || 0);
    base.special_leave_entitled = ent;
    if (hireDate) {
      base.seniority_label = labor.calcSeniority(hireDate).label;
    }
  }
  return base;
}

/** 取得使用者有效 Email 列表（略過 example.local 等測試信箱） */
function getUserEmailsByIds(ids) {
  const list = [...new Set((ids || []).map(Number).filter(Boolean))];
  if (!list.length) return [];
  const emails = [];
  const skipped = [];
  for (const id of list) {
    const u = db
      .prepare(`SELECT id, name, email FROM users WHERE id = ? AND active = 1`)
      .get(id);
    if (!u?.email || !String(u.email).trim()) {
      skipped.push({ id, name: u?.name, reason: '未設定 Email' });
      continue;
    }
    const email = String(u.email).trim();
    if (mail.isPlaceholderEmail && mail.isPlaceholderEmail(email)) {
      skipped.push({ id, name: u.name, email, reason: '測試／無效信箱' });
      continue;
    }
    emails.push(email);
  }
  return [...new Set(emails)];
}

/** 目前步驟簽核人 Email 診斷（含無效信箱說明） */
function diagnoseApproverEmails(ids) {
  const list = [...new Set((ids || []).map(Number).filter(Boolean))];
  const rows = [];
  for (const id of list) {
    const u = db
      .prepare(`SELECT id, name, username, email, active FROM users WHERE id = ?`)
      .get(id);
    if (!u) {
      rows.push({ id, ok: false, reason: '找不到使用者' });
      continue;
    }
    if (!u.active) {
      rows.push({ id, name: u.name, ok: false, reason: '帳號已停用' });
      continue;
    }
    const email = u.email ? String(u.email).trim() : '';
    if (!email) {
      rows.push({ id, name: u.name, username: u.username, ok: false, reason: '未設定 Email' });
      continue;
    }
    if (mail.isPlaceholderEmail(email)) {
      rows.push({
        id,
        name: u.name,
        username: u.username,
        email,
        ok: false,
        reason: '測試／無效信箱（如 example.local），無法真正寄達',
      });
      continue;
    }
    rows.push({ id, name: u.name, username: u.username, email, ok: true });
  }
  return rows;
}

/** 非同步寄信，失敗不影響主流程 */
function fireAndForgetMail(label, promise) {
  Promise.resolve(promise)
    .then((r) => {
      if (r && !r.ok && !r.skipped) console.warn(`[mail:${label}]`, r.error || r);
      else if (r?.ok) console.log(`[mail:${label}]`, r.mode, (r.to || []).join(','));
    })
    .catch((e) => console.error(`[mail:${label}]`, e.message));
}

/** 以數字比對步驟 order（避免 JSON 字串 / SQLite 整數不一致） */
function findStepByOrder(steps, order) {
  const o = Number(order);
  if (!Array.isArray(steps) || !Number.isFinite(o)) return null;
  return steps.find((s) => Number(s.order) === o) || null;
}

/**
 * 最近一次「退回」動作 id（之後的核准才算有效，退回上一位後需重新簽）
 */
function getLastReturnActionId(requestId) {
  const row = db
    .prepare(
      `SELECT id FROM approval_actions
       WHERE request_id = ? AND action = 'return'
       ORDER BY id DESC LIMIT 1`
    )
    .get(Number(requestId));
  return row?.id ? Number(row.id) : 0;
}

/**
 * 某正職簽核人在此步驟是否已核准（本人簽或被代簽皆算；僅計退回後）
 */
function hasApprovalForPrincipal(requestId, step, principalId) {
  if (!step || !principalId) return false;
  const afterId = getLastReturnActionId(requestId);
  const pid = Number(principalId);
  // 相容舊資料：尚無 on_behalf_of 欄時僅比 actor_id
  try {
    const row = db
      .prepare(
        `SELECT id FROM approval_actions
         WHERE request_id = ? AND step_order = ? AND action = 'approve' AND id > ?
           AND (actor_id = ? OR IFNULL(on_behalf_of, 0) = ?)
         LIMIT 1`
      )
      .get(requestId, Number(step.order), afterId, pid, pid);
    return !!row;
  } catch {
    const row = db
      .prepare(
        `SELECT id FROM approval_actions
         WHERE request_id = ? AND step_order = ? AND actor_id = ? AND action = 'approve' AND id > ?
         LIMIT 1`
      )
      .get(requestId, Number(step.order), pid, afterId);
    return !!row;
  }
}

/** 取得某步驟尚未核准的簽核人 id（會簽 mode=all 用；忽略退回前的舊核准） */
function getPendingApproverIds(requestId, step) {
  if (!step) return [];
  const ids = (step.approverIds || []).map(Number).filter(Boolean);
  if (!ids.length) return [];
  if (step.mode !== 'all') {
    // any：若任一人已核准則無 pending（isStepComplete 另判斷）
    const anyDone = ids.some((aid) => hasApprovalForPrincipal(requestId, step, aid));
    return anyDone ? [] : ids;
  }
  return ids.filter((aid) => !hasApprovalForPrincipal(requestId, step, aid));
}

/** 依單據目前步驟通知簽核人 */
function notifyCurrentApprovers(detail, kind, fromName) {
  if (!detail || detail.status !== 'pending') {
    console.warn('[mail:approver] skip: not pending', detail?.id, detail?.status);
    return;
  }
  const steps = detail.steps || [];
  const step = findStepByOrder(steps, detail.current_step);
  if (!step) {
    console.warn(
      '[mail:approver] skip: step not found',
      detail.id,
      'current_step=',
      detail.current_step,
      'orders=',
      steps.map((s) => s.order)
    );
    return;
  }
  // 會簽中：只通知尚未核准者；進入新步驟時全員都尚未核准
  // 另併入有效「可代簽」代理人 Email（不改 steps_snapshot，僅多發通知）
  let targetIds =
    kind === 'remind' || step.mode !== 'all'
      ? [...(step.approverIds || [])]
      : getPendingApproverIds(detail.id, step);
  targetIds = targetIds.map(Number).filter(Boolean);
  const agentExtra = new Set();
  for (const pid of targetIds) {
    try {
      const rows = db
        .prepare(
          `SELECT * FROM user_agents
           WHERE principal_id = ? AND active = 1 AND can_approve = 1`
        )
        .all(pid);
      for (const row of rows) {
        if (agents.isRowEffective(row)) agentExtra.add(Number(row.agent_id));
      }
      // 請假職務代理人：申請人請假期間可代簽
      for (const aid of agents.getLeaveDutyAgentIdsForPrincipal(pid)) {
        agentExtra.add(Number(aid));
      }
    } catch {
      /* ignore */
    }
  }
  for (const aid of agentExtra) {
    if (!targetIds.includes(aid)) targetIds.push(aid);
  }
  const emails = getUserEmailsByIds(targetIds);
  if (!emails.length) {
    console.warn(
      '[mail:approver] skip: no emails',
      detail.id,
      'step',
      step.order,
      step.name,
      'ids',
      targetIds
    );
  }
  fireAndForgetMail(
    kind === 'remind' ? 'remind' : 'approver',
    mail.sendApproverMails(detail, step, emails, kind, fromName)
  );
}

/** 將使用者加入部門（可同時隸屬多個部門） */
function addUserToDepartment(userId, departmentName) {
  const dept = String(departmentName || '').trim();
  if (!dept || !isValidDepartment(dept)) {
    throw new Error('無效的部門');
  }
  const user = db.prepare(`SELECT id, department FROM users WHERE id = ? AND active = 1`).get(userId);
  if (!user) throw new Error('找不到使用者');
  db.prepare(
    `INSERT OR IGNORE INTO user_departments (user_id, department) VALUES (?, ?)`
  ).run(userId, dept);
  // 若主部門空白，設為目前部門
  if (!user.department || !String(user.department).trim()) {
    db.prepare(`UPDATE users SET department = ? WHERE id = ?`).run(dept, userId);
  }
}

/** 將使用者移出某一部門（帳號保留；可仍屬其他部門） */
function removeUserFromDepartment(userId, departmentName) {
  const dept = String(departmentName || '').trim();
  db.prepare(
    `DELETE FROM user_departments WHERE user_id = ? AND department = ?`
  ).run(userId, dept);
  const user = db.prepare(`SELECT id, department FROM users WHERE id = ?`).get(userId);
  if (user && user.department === dept) {
    const rest = getUserDepartments(userId);
    db.prepare(`UPDATE users SET department = ? WHERE id = ?`).run(rest[0] || '', userId);
  }
}

function userHasPermission(userId, permId) {
  const row = db
    .prepare(`SELECT role, permissions_json FROM users WHERE id = ? AND active = 1`)
    .get(userId);
  if (!row) return false;
  if (row.role === 'admin') return true;
  return parsePermissions(row.permissions_json).includes(permId);
}

/** 需要系統管理員，或具備指定權限 */
function requirePerm(permId) {
  return (req, res, next) => {
    if (req.user?.role === 'admin' || userHasPermission(req.user.id, permId)) {
      return next();
    }
    return res.status(403).json({ error: '權限不足，請洽系統管理員' });
  };
}

/** 人事：下載請假申請單（leave_report／leave_delete／backups／admin） */
function canDownloadLeaveForms(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return (
    userHasPermission(user.id, 'leave_report') ||
    userHasPermission(user.id, 'leave_delete') ||
    userHasPermission(user.id, 'backups')
  );
}

function requireLeaveFormsDownload(req, res, next) {
  if (canDownloadLeaveForms(req.user)) return next();
  return res
    .status(403)
    .json({ error: '需具備人事請假報表／刪除請假或備份資料權限' });
}

// Ensure admin exists on first boot
(function ensureAdmin() {
  const c = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (c === 0) {
    db.prepare(
      `INSERT INTO users (username, password_hash, name, email, department, role)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      normalizeUsername('admin'),
      hp('admin123'),
      '系統管理員',
      'admin@example.com',
      '管理部',
      'admin'
    );
    console.log('[seed] 已建立預設管理員 Admin / admin123（部門：管理部；登入不分大小寫）');
  }
})();

/**
 * 將既有帳號第一個字母改為大寫（顯示用）；登入仍不區分大小寫。
 * 一併修正流程步驟內嵌的 username 顯示字串。
 */
(function migrateUsernamesFirstLetterUpper() {
  try {
    const rows = db.prepare(`SELECT id, username FROM users`).all();
    const upd = db.prepare(`UPDATE users SET username = ? WHERE id = ?`);
    /** @type {Map<string, string>} old exact -> new */
    const renamed = new Map();
    let n = 0;
    for (const r of rows) {
      const next = normalizeUsername(r.username);
      if (!next || next === r.username) continue;
      const clash = db
        .prepare(`SELECT id FROM users WHERE username = ? AND id != ?`)
        .get(next, r.id);
      if (clash) {
        console.warn(
          `[username] 略過 #${r.id}「${r.username}」→「${next}」（與 #${clash.id} 衝突）`
        );
        continue;
      }
      try {
        upd.run(next, r.id);
        renamed.set(r.username, next);
        n += 1;
      } catch (e) {
        console.warn(`[username] 更新失敗 #${r.id} ${r.username}:`, e.message);
      }
    }
    if (n > 0) {
      // 流程模板／快照內嵌的 approvers.username 一併更新（僅顯示用）
      const patchJsonUsernames = (jsonStr) => {
        if (!jsonStr || typeof jsonStr !== 'string') return { text: jsonStr, changed: false };
        let changed = false;
        let text = jsonStr;
        for (const [oldU, newU] of renamed) {
          // 替換 JSON 字串值 "username":"old"
          const re = new RegExp(
            `("username"\\s*:\\s*")${oldU.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(")`,
            'g'
          );
          const next = text.replace(re, `$1${newU}$2`);
          if (next !== text) {
            text = next;
            changed = true;
          }
        }
        return { text, changed };
      };
      try {
        const wfs = db.prepare(`SELECT id, steps_json FROM workflows`).all();
        const uw = db.prepare(`UPDATE workflows SET steps_json = ? WHERE id = ?`);
        for (const w of wfs) {
          const { text, changed } = patchJsonUsernames(w.steps_json);
          if (changed) uw.run(text, w.id);
        }
      } catch (e) {
        console.warn('[username] 流程 username 同步略過', e.message);
      }
      try {
        const reqs = db
          .prepare(
            `SELECT id, steps_snapshot_json FROM approval_requests WHERE steps_snapshot_json IS NOT NULL AND steps_snapshot_json != ''`
          )
          .all();
        const ur = db.prepare(`UPDATE approval_requests SET steps_snapshot_json = ? WHERE id = ?`);
        for (const r of reqs) {
          const { text, changed } = patchJsonUsernames(r.steps_snapshot_json);
          if (changed) ur.run(text, r.id);
        }
      } catch (e) {
        console.warn('[username] 簽核快照 username 同步略過', e.message);
      }
      console.log(`[username] 已將 ${n} 個帳號改為首字母大寫（登入仍不分大小寫）`);
    }
  } catch (e) {
    console.warn('[username] 遷移失敗', e.message);
  }
})();

const app = express();
const PORT = process.env.PORT || 3847;

// 反向代理／HTTPS 時正確辨識 req.protocol（OnlyOffice 同源腳本用）
app.set('trust proxy', 1);

app.use(cors());

/** 安全標頭（內網也套用；OnlyOffice 啟用時放行文件伺服器） */
const OO_DOCS_URL = String(process.env.ONLYOFFICE_DOCS_URL || '').replace(/\/$/, '');
function onlyOfficeCspExtras(docsUrl) {
  const out = [];
  const raw = String(docsUrl || '').replace(/\/$/, '');
  if (!raw) return out;
  out.push(raw);
  try {
    const u = new URL(raw);
    out.push(`ws://${u.host}`, `wss://${u.host}`);
  } catch {
    /* ignore */
  }
  return out;
}
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // Document Server 自己的 HTML／JS 不能套簽核 CSP（缺 unsafe-eval／wasm 會空白）
  if (onlyoffice.isEnabled() && onlyoffice.isDocsProxyPath(req.url || req.path)) {
    return next();
  }
  const extras = onlyOfficeCspExtras(OO_DOCS_URL);
  const extra = extras.length ? ` ${extras.join(' ')}` : '';
  const ooScript = onlyoffice.isEnabled()
    ? " 'unsafe-eval' 'wasm-unsafe-eval' blob:"
    : '';
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${ooScript}${extra}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data: blob:",
      `connect-src 'self' blob:${extra}`,
      `frame-src 'self' blob:${extra}`,
      `child-src 'self' blob:${extra}`,
      `worker-src 'self' blob:${extra}`,
      "object-src 'self' blob:",
    ].join('; ')
  );
  next();
});

// OnlyOffice 靜態資源同源代理（須在 static 之前，避免 HTTPS 混合內容）
app.use(onlyoffice.createDocsProxy());
app.use(express.json({ limit: '2mb' }));

app.get(['/health', '/api/health'], (req, res) => {
  try {
    db.prepare('SELECT 1 AS ok').get();
    res.json({ ok: true, status: 'ok' });
  } catch (e) {
    res.status(503).json({ ok: false, status: 'db_error' });
  }
});

app.get('/api/system/branding', (req, res) => {
  res.json({
    env: process.env.APP_ENV || (fs.existsSync('/app/data') ? 'NAS' : 'local'),
    ...systemSettings.getPublicSettings(),
  });
});

/** 瀏覽器預設請求 /favicon.ico → 使用公司 Logo（自訂或預設 ARGO） */
app.get(['/favicon.ico', '/favicon.png'], (req, res) => {
  try {
    const custom = systemSettings.getLogoFilePath();
    if (custom) return res.sendFile(custom);
  } catch {
    /* fall through */
  }
  res.sendFile(path.join(__dirname, '..', 'public', 'img', 'argo-logo.png'));
});

// 舊版 /v2 路徑自動轉址至根路徑
app.get(['/v2', '/v2/*'], (req, res) => {
  const subPath = req.path.replace(/^\/v2/, '') || '/';
  const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  res.redirect(301, subPath + query);
});

app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------- helpers ----------
const FIELD_TYPES = ['text', 'textarea', 'number', 'date', 'datetime', 'select', 'checkbox', 'user'];

/** 出勤可選時間範圍（請假起迄與前端一致） */
const WORK_TIME_START_MIN = 9 * 60; // 09:00
const WORK_TIME_END_MIN = 17 * 60 + 30; // 17:30
/** 延長工時／實際工時可選：00:00～24:00（全日 24 小時，每 30 分鐘） */
const OT_TIME_START_MIN = 0; // 00:00
const OT_TIME_END_MIN = 24 * 60; // 24:00

/**
 * 正規化並驗證「日期+時間」且分鐘僅能 00 或 30
 * @param {string} val
 * @param {{ workHoursOnly?: boolean, overtimeHoursOnly?: boolean }} opts
 *   workHoursOnly：09:00～17:30（請假）
 *   overtimeHoursOnly：00:00～24:00（延長工時全日；允許 24:00）
 */
function normalizeDateTime30(val, opts = {}) {
  if (val == null || val === '') return { ok: true, value: '' };
  let s = String(val).trim().replace(' ', 'T');
  // 接受 YYYY-MM-DDTHH:mm 或 YYYY-MM-DDTHH:mm:ss（含 24:00）
  let m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::\d{2})?$/);
  if (!m) return { ok: false, error: '格式須為 日期 + 時間（例如 2026-07-20 17:30）' };
  const date = m[1];
  let hh = Number(m[2]);
  let mm = Number(m[3]);
  if (Number.isNaN(hh) || Number.isNaN(mm)) {
    return { ok: false, error: '時間格式無效' };
  }
  // 允許 24:00（僅整點，表示當日結束）
  if (hh === 24) {
    if (mm !== 0) return { ok: false, error: '24:00 僅能為整點' };
  } else if (hh < 0 || hh > 23 || mm < 0 || mm > 59) {
    return { ok: false, error: '小時須為 00–23（或 24:00）' };
  }
  // 四捨五入到最近 30 分鐘（24:00 不需再對齊）
  if (!(hh === 24 && mm === 0) && mm !== 0 && mm !== 30) {
    if (mm < 15) mm = 0;
    else if (mm < 45) mm = 30;
    else {
      mm = 0;
      hh += 1;
      if (hh > 24 || (hh === 24 && mm !== 0)) {
        return { ok: false, error: '時間不可超過 24:00' };
      }
    }
  }
  let mins = hh * 60 + mm;
  if (opts.workHoursOnly) {
    if (mins < WORK_TIME_START_MIN || mins > WORK_TIME_END_MIN) {
      return {
        ok: false,
        error: '時間須在 09:00～17:30 之間（每 30 分鐘）',
      };
    }
  }
  if (opts.overtimeHoursOnly) {
    if (mins < OT_TIME_START_MIN || mins > OT_TIME_END_MIN) {
      return {
        ok: false,
        error: '時間須在 00:00～24:00 之間（全日，每 30 分鐘）',
      };
    }
  }
  const value = `${date}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  return { ok: true, value };
}
/** 簽核步驟指派類型 */
const ASSIGN_TYPES = [
  'users',
  'form_user',
  'dept_head',
  'department',
  'users_pick',
  'cosign_pick', // 申請人自選會簽（可多位勾選、非必填，可略過）
];

/** 解析會簽欄位：'skip' | userId | '1,2,3' | [1,2,3] → number[] 或 null（略過） */
function parseCosignIds(val) {
  if (val === undefined || val === null || val === '' || val === 'skip' || val === '0') {
    return null;
  }
  if (Array.isArray(val)) {
    const ids = val.map(Number).filter((n) => n > 0 && Number.isFinite(n));
    return ids.length ? [...new Set(ids)] : null;
  }
  if (typeof val === 'number') {
    return val > 0 ? [val] : null;
  }
  const s = String(val).trim();
  if (!s || s === 'skip') return null;
  const ids = s
    .split(/[,，\s]+/)
    .map(Number)
    .filter((n) => n > 0 && Number.isFinite(n));
  return ids.length ? [...new Set(ids)] : null;
}
/** 單位別名 → 實際部門名稱（人事由管理部代理） */
const UNIT_ALIASES = {
  人事: '管理部',
  人事單位: '管理部',
  人資: '管理部',
  財務: '財務部',
  財務單位: '財務部',
  採購: '採購部',
  採購單位: '採購部',
  倉管: '倉管部',
  倉管單位: '倉管部',
  工程: '工程部',
  業務: '業務部',
  管理: '管理部',
  管理單位: '管理部',
};

function parseSteps(json) {
  try {
    const steps = typeof json === 'string' ? JSON.parse(json) : json;
    if (!Array.isArray(steps) || !steps.length) throw new Error('empty');
    return steps.map((s, i) => {
      const assignType = ASSIGN_TYPES.includes(s.assignType) ? s.assignType : 'users';
      // 簽核人在此步驟可填寫的欄位（如人事：剩餘特休）
      let approverFields = [];
      try {
        approverFields = parseFormFields(s.approverFields || s.approver_fields || []);
      } catch {
        approverFields = [];
      }
      return {
        order: i + 1,
        name: String(s.name || `步驟 ${i + 1}`).trim(),
        assignType,
        formFieldId: s.formFieldId ? String(s.formFieldId).trim().slice(0, 40) : 'agent',
        department: s.department ? String(s.department).trim() : '',
        approverIds: Array.isArray(s.approverIds)
          ? s.approverIds.map(Number).filter(Boolean)
          : [],
        mode: s.mode === 'all' ? 'all' : 'any',
        approverFields,
        // 申請人自選（users_pick）等：無人／不選時可略過此步驟
        skipIfNoApprover: Boolean(s.skipIfNoApprover),
      };
    });
  } catch {
    return null;
  }
}

/** 台灣勞基法／性別工作平等法常見假別 */
const TW_LEAVE_TYPES = [
  '特別休假（特休）',
  '事假',
  '普通傷病假（病假）',
  '住院傷病假',
  '公傷病假',
  '婚假',
  '喪假',
  '祭儀假',
  '產假',
  '產檢假',
  '安胎休養',
  '陪產檢及陪產假',
  '生理假',
  '家庭照顧假',
  '公假',
  '補休',
  '曠職',
  '其他',
];

function validateStepTemplate(step) {
  if (!step.name) return '步驟名稱不可空白';
  if (
    (step.assignType === 'users' || step.assignType === 'users_pick') &&
    !step.approverIds.length
  ) {
    return `步驟「${step.name}」尚未指定可選簽核人`;
  }
  if (step.assignType === 'form_user' && !step.formFieldId) {
    return `步驟「${step.name}」請指定表單人員欄位（如代理人）`;
  }
  if (step.assignType === 'department' && !step.department) {
    return `步驟「${step.name}」請指定簽核單位／部門`;
  }
  return null;
}

/** 電腦異常報修：有不符合時可填寫說明（不改既有檢核下拉） */
function isItRepairWorkflowName(name) {
  return /電腦異常|異常報修|報修申請/.test(String(name || ''));
}

const IT_REPAIR_CHECK_IDS = [
  'check_os',
  'check_memory',
  'check_disk',
  'check_3dmark',
  'check_email',
  'check_backup',
  'check_battery',
];

function isItRepairNoncompliantValue(val) {
  const s = String(val == null ? '' : val);
  return s.includes('不符合') || /低於\s*70/.test(s);
}

function itRepairNoteId(checkId) {
  return `${checkId}_note`;
}

function itRepairNoteLabel(field) {
  const raw = String(field?.label || field?.id || '項目');
  const short = raw.replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '').trim() || '項目';
  return `${short}不符合說明`;
}

function ensureItRepairApproverFields(fields) {
  if (!Array.isArray(fields)) return fields;
  const checkIds = new Set(IT_REPAIR_CHECK_IDS);
  const drop = new Set([
    'check_noncompliant_note',
    ...IT_REPAIR_CHECK_IDS.map((id) => itRepairNoteId(id)),
  ]);
  const src = fields.filter((f) => f && !drop.has(f.id));
  if (!src.some((f) => checkIds.has(f.id))) return src;
  const out = [];
  for (const f of src) {
    out.push(f);
    if (checkIds.has(f.id)) {
      out.push({
        id: itRepairNoteId(f.id),
        label: itRepairNoteLabel(f),
        type: 'textarea',
        required: false,
        placeholder: '請填寫實際規格／不符合原因',
      });
    }
  }
  return out;
}



/** Custom form field definitions attached to a workflow */
function parseFormFields(json) {
  try {
    const fields = typeof json === 'string' ? JSON.parse(json || '[]') : json;
    if (!Array.isArray(fields)) return [];
    return fields
      .map((f, i) => {
        const type = FIELD_TYPES.includes(f.type) ? f.type : 'text';
        const id =
          String(f.id || `f_${i + 1}`)
            .trim()
            .replace(/[^\w\-]/g, '_')
            .slice(0, 40) || `f_${i + 1}`;
        const label = String(f.label || `欄位 ${i + 1}`).trim().slice(0, 80);
        const field = {
          id,
          label,
          type,
          required: !!f.required,
          placeholder: f.placeholder ? String(f.placeholder).slice(0, 120) : '',
        };
        if (type === 'select') {
          const opts = Array.isArray(f.options)
            ? f.options.map((o) => String(o).trim()).filter(Boolean)
            : String(f.optionsText || '')
                .split(/[\n,]/)
                .map((o) => o.trim())
                .filter(Boolean);
          field.options = opts.slice(0, 50);
        }
        return field;
      })
      .filter((f) => f.label);
  } catch {
    return [];
  }
}

/**
 * 合併說明欄「自繪表格」：鍵名 fieldId__table（validateFormData 會丢掉未知鍵）
 * 格式：{ rows, cols, header, cells: string[][] }
 */
function mergeFormTables(baseData, rawFormData) {
  const merged = { ...(baseData || {}) };
  const raw = rawFormData && typeof rawFormData === 'object' ? rawFormData : {};
  for (const [key, val] of Object.entries(raw)) {
    if (!/__table$/.test(key)) continue;
    let obj = val;
    if (typeof val === 'string') {
      try {
        obj = JSON.parse(val || 'null');
      } catch {
        continue;
      }
    }
    if (!obj || typeof obj !== 'object' || !Array.isArray(obj.cells)) continue;
    const cells = obj.cells
      .map((row) =>
        (Array.isArray(row) ? row : []).map((c) => String(c ?? '').slice(0, 500))
      )
      .slice(0, 20)
      .map((row) => row.slice(0, 10));
    if (!cells.length) continue;
    const cols = Math.max(1, ...cells.map((r) => r.length));
    const normalized = cells.map((r) => {
      const next = r.slice(0, cols);
      while (next.length < cols) next.push('');
      return next;
    });
    const hasContent = normalized.some((r) => r.some((c) => String(c).trim()));
    if (!hasContent) continue;
    merged[key] = {
      rows: normalized.length,
      cols,
      header: obj.header !== false,
      cells: normalized,
    };
  }
  return merged;
}

/**
 * @param {Array} fields
 * @param {object} raw
 * @param {{ skipRequired?: boolean }} [opts] 草稿：略過必填
 */
function validateFormData(fields, raw, opts = {}) {
  const skipRequired = !!opts.skipRequired;
  const data = raw && typeof raw === 'object' ? raw : {};
  const cleaned = {};
  for (const f of fields) {
    let val = data[f.id];
    if (f.type === 'checkbox') {
      val = val === true || val === 'true' || val === 1 || val === '1' || val === 'on';
      cleaned[f.id] = val;
      if (f.required && !val && !skipRequired) {
        return { error: `請勾選「${f.label}」` };
      }
      continue;
    }
    if (val == null) val = '';
    val = String(val).trim();
    if (f.required && !val && !skipRequired) {
      return { error: `請填寫「${f.label}」` };
    }
    if (f.type === 'number' && val !== '') {
      if (Number.isNaN(Number(val))) {
        return { error: `「${f.label}」須為數字` };
      }
      // 天數／小時：請假表單依假別最小單位（見下方 leave_type 合併驗證）；
      // 其餘（剩餘特休、延長工時等）仍為 0.5
      const isLeaveDaysHours = f.id === 'days' || f.id === 'hours';
      const isHalfUnit =
        f.id === 'remaining_special_leave_days' ||
        f.id === 'remaining_special_leave_hours' ||
        f.id === 'actual_hours' ||
        f.id === 'comp_leave_balance' ||
        (/小時|天數|時數/.test(String(f.label || '')) && !isLeaveDaysHours);
      if (isLeaveDaysHours) {
        const n = Number(val);
        if (n < 0) return { error: `「${f.label}」不可為負數` };
        // 先暫存原始數字，假別齊全後再 normalizeLeaveDaysHours
        cleaned[f.id] = n;
        continue;
      }
      if (isHalfUnit) {
        const n = Number(val);
        if (n < 0) return { error: `「${f.label}」不可為負數` };
        const snapped = Math.round(n * 2) / 2;
        if (Math.abs(n - snapped) > 1e-9) {
          return { error: `「${f.label}」最小單位為 0.5（例如 0、0.5、1、3.5、7.5）` };
        }
        cleaned[f.id] = snapped;
        continue;
      }
    }
    if (f.type === 'datetime' && val !== '') {
      // 請假：09:00～17:30；延長工時／實際工時：00:00～24:00（全日）
      const workHoursOnly =
        f.id === 'start_date' ||
        f.id === 'end_date' ||
        (/請假/.test(String(f.label || '')) &&
          /起始|開始|結束|迄/.test(String(f.label || '')));
      const overtimeHoursOnly =
        f.id === 'ot_start' ||
        f.id === 'ot_end' ||
        f.id === 'actual_start' ||
        f.id === 'actual_end' ||
        /延長工時|實際工時/.test(String(f.label || ''));
      const n = normalizeDateTime30(val, {
        workHoursOnly: workHoursOnly && !overtimeHoursOnly,
        overtimeHoursOnly,
      });
      if (!n.ok) return { error: `「${f.label}」${n.error}` };
      cleaned[f.id] = n.value;
      continue;
    }
    if (f.type === 'select' && val) {
      const opts = Array.isArray(f.options)
        ? f.options.map((o) => String(o).trim())
        : [];
      // 無 options 定義時不擋；有 options 時比對 trim 後字串
      if (opts.length && !opts.includes(val) && !opts.includes(String(val).trim())) {
        // 人事假別：允許申請表單已選假別／合理文字，避免快照 options 過舊擋核准
        const isHrLeave =
          f.id === 'hr_leave_type' || /假別/.test(String(f.label || ''));
        if (!isHrLeave) {
          return { error: `「${f.label}」選項無效` };
        }
      }
    }
    if (f.type === 'user' && val) {
      const uid = Number(val);
      if (!uid || Number.isNaN(uid)) {
        return { error: `「${f.label}」請選擇有效人員` };
      }
      const u = db
        .prepare(`SELECT id FROM users WHERE id = ? AND active = 1`)
        .get(uid);
      if (!u) return { error: `「${f.label}」所選人員不存在或已停用` };
      cleaned[f.id] = uid;
      continue;
    }
    cleaned[f.id] = val;
  }

  // 請假：依假別最小計算單位正規化／驗證天數與小時
  const hasLeaveFields = fields.some(
    (f) => f.id === 'days' || f.id === 'hours' || f.id === 'leave_type'
  );
  if (hasLeaveFields && (cleaned.days != null || cleaned.hours != null)) {
    const leaveType =
      cleaned.leave_type ||
      cleaned.假別 ||
      data.leave_type ||
      data.假別 ||
      '';
    const norm = labor.normalizeLeaveDaysHours(
      leaveType,
      cleaned.days != null ? cleaned.days : data.days,
      cleaned.hours != null ? cleaned.hours : data.hours
    );
    if (!norm.ok) {
      if (skipRequired) {
        // 草稿：保留已填數字，不強制對齊
      } else {
        return { error: norm.error || '請假天數／小時不符合最小單位' };
      }
    } else if (leaveType || cleaned.start_date || cleaned.end_date) {
      // 有填起迄或假別時才強制寫回（避免無關表單）
      cleaned.days = norm.days;
      cleaned.hours = norm.hours;
    }
  }

  return { data: cleaned };
}

/**
 * 合併「部門主管」自選欄位（不在 workflow formFields 內，validateFormData 會丢掉）
 * 欄位鍵：dept_head_{步驟序}
 */
function mergeDeptHeadFormData(baseData, rawFormData, templateSteps) {
  const merged = { ...(baseData || {}) };
  const raw = rawFormData && typeof rawFormData === 'object' ? rawFormData : {};
  const orders = new Set(
    (templateSteps || [])
      .filter((s) => s.assignType === 'dept_head')
      .map((s) => Number(s.order))
      .filter((n) => Number.isFinite(n) && n > 0)
  );
  // 接受所有 dept_head_N，或流程中宣告的步驟
  const keys = new Set([
    ...Object.keys(raw).filter((k) => /^dept_head_\d+$/.test(k)),
    ...[...orders].map((o) => `dept_head_${o}`),
  ]);
  for (const key of keys) {
    if (!(key in raw) && !(key in merged)) continue;
    const val = raw[key] !== undefined ? raw[key] : merged[key];
    if (val === undefined || val === null || val === '' || val === 'skip') {
      merged[key] = 'skip';
      continue;
    }
    const uid = Number(val);
    if (!uid || Number.isNaN(uid)) {
      merged[key] = 'skip';
      continue;
    }
    const u = db.prepare(`SELECT id FROM users WHERE id = ? AND active = 1`).get(uid);
    if (!u) {
      return { error: `部門主管所選人員無效（${key}）` };
    }
    merged[key] = uid;
  }
  return { data: merged };
}

function isMeetingAttendeePickStep(s) {
  return (
    !!s &&
    s.assignType === 'users_pick' &&
    (/與會/.test(String(s.name || '')) ||
      String(s.formFieldId || '') === 'attendee_ids')
  );
}

function allActiveUserIdsExcept(userId) {
  const uid = Number(userId) || 0;
  return db
    .prepare(`SELECT id FROM users WHERE active = 1 AND id != ? ORDER BY id`)
    .all(uid)
    .map((r) => Number(r.id));
}

function fillMeetingAttendeeNames(formData, requester) {
  const data = formData && typeof formData === 'object' ? { ...formData } : {};
  const ids = String(data.attendee_ids || '')
    .split(/[,，\s]+/)
    .map(Number)
    .filter((n) => n > 0);
  const names = [];
  const seen = new Set();
  const push = (n) => {
    const s = String(n || '').trim();
    if (!s || seen.has(s)) return;
    seen.add(s);
    names.push(s);
  };
  push(requester?.name);
  if (ids.length) {
    const ph = ids.map(() => '?').join(',');
    const rows = db
      .prepare(`SELECT id, name FROM users WHERE id IN (${ph})`)
      .all(...ids);
    const map = new Map(rows.map((r) => [Number(r.id), r.name]));
    for (const id of ids) push(map.get(id));
  }
  data.attendees = names.join('、');
  return data;
}

/**
 * 合併「申請人自選簽核人」欄位（如副總經理）
 * 欄位鍵：users_pick_{步驟序}
 * 值：'all' | 單一 userId | '1,2,3'（勾選多位）| 'skip'（非必填略過）
 * 步驟 skipIfNoApprover=true 時可不選（略過該關）
 */
function mergeUsersPickFormData(baseData, rawFormData, templateSteps) {
  const merged = { ...(baseData || {}) };
  const raw = rawFormData && typeof rawFormData === 'object' ? rawFormData : {};
  const pickSteps = (templateSteps || []).filter(
    (s) => s.assignType === 'users_pick'
  );
  const keys = new Set([
    ...Object.keys(raw).filter((k) => /^users_pick_\d+$/.test(k)),
    ...pickSteps.map((s) => `users_pick_${s.order}`),
  ]);
  for (const key of keys) {
    const m = key.match(/^users_pick_(\d+)$/);
    if (!m) continue;
    const order = Number(m[1]);
    const step =
      pickSteps.find((s) => Number(s.order) === order) ||
      (templateSteps || []).find(
        (s) => s.assignType === 'users_pick' && Number(s.order) === order
      );
    const optional = Boolean(step?.skipIfNoApprover);
    const pool = new Set(
      (step?.approverIds || []).map(Number).filter(Boolean)
    );
    let val = raw[key] !== undefined ? raw[key] : merged[key];
    const attendeeRaw = raw.attendee_ids !== undefined ? raw.attendee_ids : merged.attendee_ids;
    if (
      isMeetingAttendeePickStep(step) &&
      (val === undefined ||
        val === null ||
        val === '' ||
        val === 'skip' ||
        val === '0') &&
      attendeeRaw
    ) {
      val = attendeeRaw;
    }
    if (
      val === undefined ||
      val === null ||
      val === '' ||
      val === 'skip' ||
      val === '0'
    ) {
      if (optional) {
        merged[key] = 'skip';
        continue;
      }
      return {
        error: `請勾選「${step?.name || '簽核人'}」（至少一位）`,
      };
    }
    if (String(val) === 'all') {
      if (!pool.size) {
        return { error: `步驟「${step?.name || key}」尚未設定可選簽核人` };
      }
      merged[key] = 'all';
      continue;
    }
    // 支援多選：陣列、逗號分隔、或單一 id
    let ids = [];
    if (Array.isArray(val)) {
      ids = val.map(Number).filter((n) => n > 0 && Number.isFinite(n));
    } else if (typeof val === 'number') {
      ids = val > 0 ? [val] : [];
    } else {
      ids = String(val)
        .split(/[,，\s]+/)
        .map(Number)
        .filter((n) => n > 0 && Number.isFinite(n));
    }
    ids = [...new Set(ids)];
    if (!ids.length) {
      if (optional) {
        merged[key] = 'skip';
        continue;
      }
      return { error: `請勾選「${step?.name || '簽核人'}」（至少一位）` };
    }
    for (const uid of ids) {
      if (pool.size && !pool.has(uid)) {
        return { error: `「${step?.name || '簽核人'}」所選人員不在可選名單內` };
      }
      const u = db.prepare(`SELECT id FROM users WHERE id = ? AND active = 1`).get(uid);
      if (!u) {
        return { error: `「${step?.name || '簽核人'}」所選人員無效（#${uid}）` };
      }
    }
    merged[key] = ids.length === 1 ? ids[0] : ids.join(',');
  }
  // 必填的 users_pick 必須有值；非必填則寫 skip
  for (const s of pickSteps) {
    const key = `users_pick_${s.order}`;
    if (merged[key] === undefined || merged[key] === null || merged[key] === '') {
      if (s.skipIfNoApprover) {
        merged[key] = 'skip';
        continue;
      }
      return { error: `請勾選「${s.name || '簽核人'}」（至少一位）` };
    }
  }
  return { data: merged };
}

/**
 * 合併「會簽人員」自選欄位（非必填，可多位）
 * 欄位鍵：cosign_{步驟序} 值：'skip' | 單一 id | '1,2,3'
 */
function mergeCosignFormData(baseData, rawFormData, templateSteps) {
  const merged = { ...(baseData || {}) };
  const raw = rawFormData && typeof rawFormData === 'object' ? rawFormData : {};
  const cosignSteps = (templateSteps || []).filter(
    (s) => s.assignType === 'cosign_pick'
  );
  const keys = new Set([
    ...Object.keys(raw).filter((k) => /^cosign_\d+$/.test(k)),
    ...cosignSteps.map((s) => `cosign_${s.order}`),
  ]);
  for (const key of keys) {
    if (!(key in raw) && !(key in merged)) {
      if (cosignSteps.some((s) => `cosign_${s.order}` === key)) {
        merged[key] = 'skip';
      }
      continue;
    }
    const val = raw[key] !== undefined ? raw[key] : merged[key];
    const ids = parseCosignIds(val);
    if (!ids || !ids.length) {
      merged[key] = 'skip';
      continue;
    }
    for (const uid of ids) {
      const u = db.prepare(`SELECT id FROM users WHERE id = ? AND active = 1`).get(uid);
      if (!u) {
        return { error: `會簽所選人員無效（#${uid}）` };
      }
    }
    merged[key] = ids.join(',');
  }
  for (const s of cosignSteps) {
    const key = `cosign_${s.order}`;
    if (merged[key] === undefined) merged[key] = 'skip';
  }
  return { data: merged };
}

/** 部門主管：同部門 active 使用者（含多部門隸屬），優先非 admin，再依 id */
function getDeptHead(department) {
  const dept = String(department || '').trim();
  if (!dept) return null;
  const users = db
    .prepare(
      `SELECT DISTINCT u.id, u.name, u.department, u.role FROM users u
       WHERE u.active = 1 AND (
         u.department = ?
         OR EXISTS (
           SELECT 1 FROM user_departments ud
           WHERE ud.user_id = u.id AND ud.department = ?
         )
       )
       ORDER BY CASE WHEN u.role = 'admin' THEN 1 ELSE 0 END, u.id ASC`
    )
    .all(dept, dept);
  return users[0] || null;
}

function resolveUnitName(name) {
  const raw = String(name || '').trim();
  if (!raw) return '';
  return UNIT_ALIASES[raw] || raw;
}

function getUsersInDepartment(department) {
  const dept = resolveUnitName(department);
  if (!dept) return [];
  return db
    .prepare(
      `SELECT DISTINCT u.id, u.name, u.department, u.role FROM users u
       WHERE u.active = 1 AND (
         u.department = ?
         OR EXISTS (
           SELECT 1 FROM user_departments ud
           WHERE ud.user_id = u.id AND ud.department = ?
         )
       )
       ORDER BY u.id ASC`
    )
    .all(dept, dept);
}

/**
 * 依申請人、表單資料，將流程模板步驟解析成實際簽核人
 * 申請人送出本身視為第 0 層（不在 steps 內）
 */
function resolveStepsForRequest(requester, formData, templateSteps) {
  const resolved = [];
  for (const s of templateSteps) {
    let approverIds = [];
    let resolveNote = '';

    if (s.assignType === 'users') {
      approverIds = [...s.approverIds];
      resolveNote = '指定人員';
    } else if (s.assignType === 'users_pick') {
      // 申請人自選：勾選一位或多位，或選全部（候選名單＝步驟 approverIds）
      // skipIfNoApprover：可不選，略過此步驟（例：請購副總經理非必填）
      let pool = (s.approverIds || []).map(Number).filter(Boolean);
      if (!pool.length && isMeetingAttendeePickStep(s)) {
        pool = allActiveUserIdsExcept(requester.id);
      }
      if (!pool.length) {
        if (s.skipIfNoApprover) continue;
        return { error: `步驟「${s.name}」尚未設定可選簽核人` };
      }
      const fieldId = `users_pick_${s.order}`;
      let raw = formData?.[fieldId];
      const attendeeRaw = formData?.attendee_ids;
      const emptyPick0 =
        raw === undefined ||
        raw === null ||
        raw === '' ||
        raw === 'skip' ||
        raw === '0';
      if (emptyPick0 && isMeetingAttendeePickStep(s) && attendeeRaw) {
        raw = attendeeRaw;
      }
      const emptyPick =
        raw === undefined ||
        raw === null ||
        raw === '' ||
        raw === 'skip' ||
        raw === '0';
      if (emptyPick) {
        if (s.skipIfNoApprover) continue;
        return { error: `請勾選「${s.name}」（至少一位）` };
      }
      if (String(raw) === 'all') {
        approverIds = [...pool];
        const names = pool
          .map((id) => db.prepare(`SELECT name FROM users WHERE id = ?`).get(id)?.name || `#${id}`)
          .join('、');
        resolveNote = `申請人勾選全部：${names}`;
      } else {
        let ids = [];
        if (Array.isArray(raw)) {
          ids = raw.map(Number).filter((n) => n > 0 && Number.isFinite(n));
        } else {
          ids = String(raw)
            .split(/[,，\s]+/)
            .map(Number)
            .filter((n) => n > 0 && Number.isFinite(n));
        }
        ids = [...new Set(ids)].filter((uid) => uid !== requester.id);
        if (!ids.length) {
          if (s.skipIfNoApprover) continue;
          return { error: `請勾選「${s.name}」（至少一位）` };
        }
        const names = [];
        for (const uid of ids) {
          if (!pool.includes(uid)) {
            return { error: `步驟「${s.name}」所選人員不在可選名單內` };
          }
          if (uid === requester.id) {
            return { error: `步驟「${s.name}」不可選擇申請人本人` };
          }
          const u = db
            .prepare(`SELECT id, name FROM users WHERE id = ? AND active = 1`)
            .get(uid);
          if (!u) return { error: `步驟「${s.name}」所選人員無效` };
          names.push(u.name);
        }
        approverIds = ids;
        resolveNote =
          ids.length === 1
            ? `申請人勾選：${names[0]}`
            : `申請人勾選 ${ids.length} 位：${names.join('、')}`;
      }
    } else if (s.assignType === 'form_user') {
      const uid = Number(formData?.[s.formFieldId]);
      if (!uid) {
        return { error: `請在表單選擇「${s.name}」對應人員（欄位：${s.formFieldId}）` };
      }
      const u = db.prepare(`SELECT id, name FROM users WHERE id = ? AND active = 1`).get(uid);
      if (!u) return { error: `步驟「${s.name}」所選人員無效` };
      // 請假職務代理人（formFieldId=agent／步驟名含代理）允許選申請人本人
      const isDutyAgentField =
        s.formFieldId === 'agent' ||
        /代理/.test(String(s.formFieldId || '')) ||
        /代理/.test(String(s.name || ''));
      if (u.id === requester.id && !isDutyAgentField) {
        return { error: `步驟「${s.name}」不可選擇申請人本人` };
      }
      approverIds = [u.id];
      resolveNote =
        u.id === requester.id
          ? `表單指定：${u.name}（申請人自任職務代理人）`
          : `表單指定：${u.name}`;
    } else if (s.assignType === 'dept_head') {
      // 申請人自行選擇部門成員，或選擇略過此步驟
      // 表單欄位鍵：dept_head_{步驟序}（與前端申請單一致）
      const fieldId = `dept_head_${s.order}`;
      const raw = formData?.[fieldId];
      const skip =
        raw === undefined ||
        raw === null ||
        raw === '' ||
        raw === 'skip' ||
        raw === '0' ||
        Number(raw) === 0 ||
        Number.isNaN(Number(raw));
      if (skip) {
        // 申請人選擇不需要經過部門主管
        continue;
      }
      const uid = Number(raw);
      const u = db
        .prepare(`SELECT id, name, department FROM users WHERE id = ? AND active = 1`)
        .get(uid);
      if (!u) {
        return { error: `步驟「${s.name}」所選人員無效` };
      }
      if (u.id === requester.id) {
        return { error: `步驟「${s.name}」不可選擇申請人本人` };
      }
      approverIds = [u.id];
      resolveNote = `申請人指定：${u.name}${u.department ? `（${u.department}）` : ''}`;
    } else if (s.assignType === 'cosign_pick') {
      // 申請人自選會簽（可多位勾選、非必填）；略過則不進入此步驟
      const fieldId = `cosign_${s.order}`;
      const raw = formData?.[fieldId];
      const ids = parseCosignIds(raw);
      if (!ids || !ids.length) {
        continue;
      }
      const names = [];
      approverIds = [];
      for (const uid of ids) {
        if (uid === requester.id) {
          return { error: `步驟「${s.name}」不可選擇申請人本人` };
        }
        const u = db
          .prepare(`SELECT id, name, department FROM users WHERE id = ? AND active = 1`)
          .get(uid);
        if (!u) {
          return { error: `步驟「${s.name}」所選會簽人員無效（#${uid}）` };
        }
        approverIds.push(u.id);
        names.push(u.department ? `${u.name}（${u.department}）` : u.name);
      }
      // 多位會簽：強制全部核准（mode=all）
      resolveNote = `會簽：${names.join('、')}`;
      resolved.push({
        order: s.order,
        templateOrder: s.order,
        name: s.name,
        assignType: s.assignType,
        formFieldId: s.formFieldId,
        department: s.department,
        mode: approverIds.length > 1 ? 'all' : s.mode === 'all' ? 'all' : 'any',
        approverIds,
        resolveNote,
        approverFields: Array.isArray(s.approverFields) ? s.approverFields : [],
      });
      continue;
    } else if (s.assignType === 'department') {
      let members = getUsersInDepartment(s.department).filter((m) => m.id !== requester.id);
      // 若單位僅申請人自己，仍保留該單位其他人；若無人則允許含本人以外的 fallback 管理部
      if (!members.length) {
        members = getUsersInDepartment('管理部').filter((m) => m.id !== requester.id);
      }
      if (!members.length) {
        return {
          error: `步驟「${s.name}」對應單位「${resolveUnitName(s.department) || s.department}」尚無可用簽核人`,
        };
      }
      approverIds = members.map((m) => m.id);
      resolveNote = `單位：${resolveUnitName(s.department)}（${members.map((m) => m.name).join('、')}）`;
    }

    if (!approverIds.length) {
      // 非必填步驟或無人可簽：略過
      continue;
    }

    resolved.push({
      order: s.order,
      templateOrder: s.order,
      name: s.name,
      assignType: s.assignType,
      formFieldId: s.formFieldId,
      department: s.department,
      mode: s.mode,
      approverIds,
      resolveNote,
      approverFields: Array.isArray(s.approverFields) ? s.approverFields : [],
    });
  }

  if (!resolved.length) {
    return { error: '無法建立簽核步驟（可能缺少可用的簽核人）' };
  }
  // 重新編號，避免略過非必填步驟後 order 不連續
  // 保留 templateOrder，表單 users_pick_N／dept_head_N 仍對應模板序
  const renumbered = resolved.map((s, i) => ({
    ...s,
    templateOrder: s.templateOrder || s.order,
    order: i + 1,
  }));
  return { steps: renumbered };
}

function loadStepsForRequest(row) {
  if (row.steps_snapshot_json) {
    try {
      const snap = JSON.parse(row.steps_snapshot_json);
      if (Array.isArray(snap) && snap.length) return snap;
    } catch {
      /* fall through */
    }
  }
  return parseSteps(row.steps_json) || [];
}

/** 解析 userIds + users(username) → 有效帳號列表 */
function resolveUserIdList(userIds, usersMeta) {
  const ids = new Set();
  const users = [];
  for (const id of userIds || []) {
    const u = db
      .prepare(`SELECT id, username, name FROM users WHERE id = ? AND active = 1`)
      .get(Number(id));
    if (u && !ids.has(u.id)) {
      ids.add(u.id);
      users.push({ id: u.id, username: u.username, name: u.name });
    }
  }
  for (const u of usersMeta || []) {
    if (!u) continue;
    if (u.id && ids.has(Number(u.id))) continue;
    let row = null;
    if (u.username) {
      row = db
        .prepare(`SELECT id, username, name FROM users WHERE username = ? AND active = 1`)
        .get(String(u.username).trim());
    } else if (u.id) {
      row = db
        .prepare(`SELECT id, username, name FROM users WHERE id = ? AND active = 1`)
        .get(Number(u.id));
    }
    if (row && !ids.has(row.id)) {
      ids.add(row.id);
      users.push({ id: row.id, username: row.username, name: row.name });
    }
  }
  return { ids: [...ids], users };
}

/** 將前端／匯入的 finalNotify 正規化並寫入 DB JSON（僅保留有效使用者） */
function resolveFinalNotifyJson(raw) {
  const n = workflowModule.normalizeFinalNotify(raw || {});
  const notify = resolveUserIdList(n.userIds, n.users);
  const applicants = resolveUserIdList(n.applicantUserIds, n.applicants);
  let applicantMode = n.applicantMode === 'selected' ? 'selected' : 'all';
  // 選了「指定申請人」但沒勾任何人 → 改回全部（避免誤關）
  if (applicantMode === 'selected' && !applicants.ids.length) {
    applicantMode = 'all';
  }
  return workflowModule.finalNotifyToJson({
    enabled: n.enabled,
    userIds: notify.ids,
    users: notify.users,
    applicantMode,
    applicantUserIds: applicants.ids,
    applicants: applicants.users,
    label: n.label,
  });
}

/** 最終核准後寫入系統內通知收執（待收件人點「確認收到」） */
function createFinalNotifyReceipts(requestId, finalNotify, actorId, requesterId) {
  const n = workflowModule.normalizeFinalNotify(finalNotify || {});
  if (!n.enabled) return { created: 0, userIds: [], skipped: true, reason: 'disabled' };
  // 僅特定申請人需要通知模組時，檢查申請人
  if (!workflowModule.shouldApplyFinalNotify(n, requesterId)) {
    return {
      created: 0,
      userIds: [],
      skipped: true,
      reason: 'applicant_not_in_scope',
    };
  }
  const label = n.label || '最終核准完成通知';
  // 注意：本專案 db 為 node:sqlite 包裝，無 better-sqlite3 的 db.transaction()
  const ins = db.prepare(
    `INSERT OR IGNORE INTO final_notify_receipts (request_id, user_id, label, created_at)
     VALUES (?, ?, ?, datetime('now', 'localtime'))`
  );
  const selUser = db.prepare(`SELECT id FROM users WHERE id = ? AND active = 1`);
  const createdIds = [];
  for (const uid of n.userIds || []) {
    try {
      const u = selUser.get(Number(uid));
      if (!u) continue;
      const info = ins.run(requestId, u.id, label);
      const changes = info && (info.changes != null ? info.changes : info.changeCount);
      // INSERT OR IGNORE：已存在也視為已建立
      if (changes > 0 || changes === undefined) {
        const exists = db
          .prepare(
            `SELECT id FROM final_notify_receipts WHERE request_id = ? AND user_id = ?`
          )
          .get(requestId, u.id);
        if (exists && !createdIds.includes(u.id)) createdIds.push(u.id);
      }
    } catch (e) {
      console.warn('[final-notify] insert receipt failed', uid, e.message);
    }
  }
  if (createdIds.length) {
    try {
      // 避免重複寫歷程（重試核准時）
      const already = db
        .prepare(
          `SELECT id FROM approval_actions
           WHERE request_id = ? AND step_name = '最終核准系統通知' LIMIT 1`
        )
        .get(requestId);
      if (!already) {
        const actor = Number(actorId) || createdIds[0];
        db.prepare(
          `INSERT INTO approval_actions (request_id, step_order, step_name, actor_id, action, comment, form_data)
           VALUES (?, 0, '最終核准系統通知', ?, 'comment', ?, ?)`
        ).run(
          requestId,
          actor,
          `已對 ${createdIds.length} 位選定人員發出系統內通知，待對方確認收到`,
          JSON.stringify({
            type: 'final_notify_created',
            userIds: createdIds,
            label,
          })
        );
      }
    } catch (e) {
      console.warn('[final-notify] audit log', e.message);
    }
  }
  return { created: createdIds.length, userIds: createdIds, label };
}

function getPendingFinalNotifyCount(userId) {
  return db
    .prepare(
      `SELECT COUNT(*) AS c FROM final_notify_receipts fn
       WHERE fn.user_id = ? AND fn.acked_at IS NULL
         AND EXISTS (SELECT 1 FROM approval_requests r WHERE r.id = fn.request_id)`
    )
    .get(Number(userId)).c;
}

function getPendingFinalNotifyRequests(userId) {
  return db
    .prepare(
      `SELECT r.*, w.name AS workflow_name, w.steps_json, r.steps_snapshot_json,
              u.name AS requester_name,
              fn.id AS final_notify_receipt_id,
              fn.label AS final_notify_label,
              fn.created_at AS final_notify_at
       FROM final_notify_receipts fn
       JOIN approval_requests r ON r.id = fn.request_id
       JOIN workflows w ON w.id = r.workflow_id
       JOIN users u ON u.id = r.requester_id
       WHERE fn.user_id = ? AND fn.acked_at IS NULL
       ORDER BY fn.created_at DESC`
    )
    .all(Number(userId));
}

function loadFinalNotifyReceiptsForRequest(requestId) {
  return db
    .prepare(
      `SELECT fn.*, u.name AS user_name, u.username AS user_username
       FROM final_notify_receipts fn
       JOIN users u ON u.id = fn.user_id
       WHERE fn.request_id = ?
       ORDER BY fn.created_at ASC, fn.id ASC`
    )
    .all(Number(requestId));
}

function enrichUserListFromDb(idList, metaList) {
  const users = [];
  const seen = new Set();
  const userIds = [...(idList || [])];
  for (const id of userIds) {
    const u = db
      .prepare(`SELECT id, username, name, email, active FROM users WHERE id = ?`)
      .get(id);
    if (u && !seen.has(u.id)) {
      seen.add(u.id);
      users.push({
        id: u.id,
        username: u.username,
        name: u.name,
        email: u.email || '',
        active: u.active,
      });
    }
  }
  for (const u of metaList || []) {
    if (u?.id && seen.has(Number(u.id))) continue;
    if (u?.username) {
      const row = db
        .prepare(`SELECT id, username, name, email, active FROM users WHERE username = ?`)
        .get(String(u.username).trim());
      if (row && !seen.has(row.id)) {
        seen.add(row.id);
        users.push({
          id: row.id,
          username: row.username,
          name: row.name,
          email: row.email || '',
          active: row.active,
        });
        if (!userIds.includes(row.id)) userIds.push(row.id);
      } else if (!u.id) {
        users.push({ username: u.username, name: u.name || u.username });
      }
    }
  }
  return { userIds, users };
}

function enrichFinalNotifyUsers(finalNotify) {
  const n = workflowModule.normalizeFinalNotify(finalNotify || {});
  const notify = enrichUserListFromDb(n.userIds, n.users);
  const applicants = enrichUserListFromDb(n.applicantUserIds, n.applicants);
  return {
    enabled: n.enabled,
    userIds: notify.userIds,
    users: notify.users,
    applicantMode: n.applicantMode || 'all',
    applicantUserIds: applicants.userIds,
    applicants: applicants.users,
    label: n.label,
  };
}

function serializeWorkflow(r) {
  const pdfLayout = workflowModule.parsePdfLayoutJson(r.pdf_layout_json, r.name);
  const finalNotify = enrichFinalNotifyUsers(
    workflowModule.parseFinalNotifyJson(r.final_notify_json)
  );
  return {
    ...r,
    category: r.category || '一般簽呈',
    steps: (() => {
      let steps = parseSteps(r.steps_json) || [];
      if (isItRepairWorkflowName(r.name)) {
        steps = steps.map((st) => ({
          ...st,
          approverFields: ensureItRepairApproverFields(st.approverFields),
        }));
      }
      return steps;
    })(),
    formFields: parseFormFields(r.form_fields_json),
    pdfLayout,
    finalNotify,
    steps_json: undefined,
    form_fields_json: undefined,
    pdf_layout_json: undefined,
    final_notify_json: undefined,
  };
}

function getRequestDetail(id) {
  const row = db
    .prepare(
      `SELECT r.*, w.name AS workflow_name, w.steps_json, w.form_fields_json, w.pdf_layout_json,
              w.final_notify_json,
              u.name AS requester_name, u.department AS requester_dept,
              u.username AS requester_username, u.email AS requester_email,
              sb.name AS submitted_by_name, sb.username AS submitted_by_username
       FROM approval_requests r
       JOIN workflows w ON w.id = r.workflow_id
       JOIN users u ON u.id = r.requester_id
       LEFT JOIN users sb ON sb.id = r.submitted_by
       WHERE r.id = ?`
    )
    .get(id);
  if (!row) return null;

  const actions = db
    .prepare(
      `SELECT a.*, u.name AS actor_name, u.username AS actor_username,
              p.name AS on_behalf_of_name, p.username AS on_behalf_of_username
       FROM approval_actions a
       JOIN users u ON u.id = a.actor_id
       LEFT JOIN users p ON p.id = a.on_behalf_of
       WHERE a.request_id = ?
       ORDER BY a.created_at ASC, a.id ASC`
    )
    .all(id);

  let form_data = {};
  try {
    form_data = JSON.parse(row.form_data || '{}');
  } catch {
    form_data = {};
  }

  // Prefer snapshot schema at submit time; fall back to current workflow fields
  let formFields = parseFormFields(row.form_schema_json);
  if (!formFields.length) {
    formFields = parseFormFields(row.form_fields_json);
  }

  // Prefer resolved step snapshot (dynamic roles); fall back to workflow template
  let steps = loadStepsForRequest(row);
  // 補上模板中的 approverFields（舊快照可能沒有）
  // 注意：略過部門主管後 steps 會重新編號，不可只靠 order 對模板，
  // 否則「總經理」可能被誤套「人事單位」的填寫欄位。
  const templateSteps = parseSteps(row.steps_json) || [];
  steps = steps.map((s) => {
    // 快照已明確帶 approverFields（含空陣列＝此步不需填寫）則沿用
    if (Array.isArray(s.approverFields)) return s;
    const t =
      templateSteps.find((x) => x.name && x.name === s.name) ||
      templateSteps.find((x) => x.order === s.order);
    return {
      ...s,
      approverFields: t?.approverFields || [],
    };
  });
  if (isItRepairWorkflowName(row.workflow_name)) {
    steps = steps.map((st) => ({
      ...st,
      approverFields: ensureItRepairApproverFields(st.approverFields),
    }));
  }

  // Enrich form_data user fields with display names for UI/PDF
  const formDataDisplay = { ...form_data };
  for (const f of formFields) {
    if (f.type === 'user' && form_data[f.id]) {
      const u = db
        .prepare(`SELECT name, department FROM users WHERE id = ?`)
        .get(Number(form_data[f.id]));
      if (u) {
        formDataDisplay[`${f.id}__name`] = u.name;
        formDataDisplay[`${f.id}__label`] = u.department
          ? `${u.name}（${u.department}）`
          : u.name;
      }
    }
  }
  // 部門主管自選欄位
  for (const key of Object.keys(form_data)) {
    if (!/^dept_head_\d+$/.test(key)) continue;
    const uid = Number(form_data[key]);
    if (!uid) {
      formDataDisplay[`${key}__label`] = '略過（不經部門主管）';
      continue;
    }
    const u = db.prepare(`SELECT name, department FROM users WHERE id = ?`).get(uid);
    if (u) {
      formDataDisplay[`${key}__name`] = u.name;
      formDataDisplay[`${key}__label`] = u.department
        ? `${u.name}（${u.department}）`
        : u.name;
    }
  }
  // 申請人自選簽核人（副總等）users_pick_N（可多位勾選：1,2,3）
  for (const key of Object.keys(form_data)) {
    if (!/^users_pick_\d+$/.test(key)) continue;
    const val = form_data[key];
    if (String(val) === 'all') {
      formDataDisplay[`${key}__label`] = '全部';
      continue;
    }
    let ids = [];
    if (Array.isArray(val)) {
      ids = val.map(Number).filter((n) => n > 0);
    } else {
      ids = String(val || '')
        .split(/[,，\s]+/)
        .map(Number)
        .filter((n) => n > 0);
    }
    if (!ids.length) continue;
    const labels = [];
    for (const uid of ids) {
      const u = db.prepare(`SELECT name, department FROM users WHERE id = ?`).get(uid);
      if (u) {
        labels.push(u.department ? `${u.name}（${u.department}）` : u.name);
      } else {
        labels.push(`#${uid}`);
      }
    }
    formDataDisplay[`${key}__name`] = labels.join('、');
    formDataDisplay[`${key}__label`] = labels.join('、');
  }
  // 會簽人員 cosign_N（可多位：1,2,3）
  for (const key of Object.keys(form_data)) {
    if (!/^cosign_\d+$/.test(key)) continue;
    const ids = parseCosignIds(form_data[key]);
    if (!ids || !ids.length) {
      formDataDisplay[`${key}__label`] = '略過（無會簽）';
      continue;
    }
    const labels = [];
    for (const uid of ids) {
      const u = db.prepare(`SELECT name, department FROM users WHERE id = ?`).get(uid);
      if (u) {
        labels.push(u.department ? `${u.name}（${u.department}）` : u.name);
      } else {
        labels.push(`#${uid}`);
      }
    }
    formDataDisplay[`${key}__label`] = labels.join('、');
    formDataDisplay[`${key}__name`] = labels.join('、');
  }

  let approver_data = {};
  try {
    approver_data = JSON.parse(row.approver_data_json || '{}');
  } catch {
    approver_data = {};
  }

  const actionsEnriched = actions.map((a) => {
    let fd = {};
    try {
      fd = JSON.parse(a.form_data || '{}');
    } catch {
      fd = {};
    }
    return { ...a, form_data: fd };
  });

  const notify_prefs = mail.parseNotifyPrefs
    ? mail.parseNotifyPrefs(row)
    : {
        enabled: row.notify_email !== 0,
        approved: row.notify_email !== 0,
        rejected: row.notify_email !== 0,
        step: row.notify_email !== 0,
      };

  const pdfLayout = workflowModule.parsePdfLayoutJson(
    row.pdf_layout_json,
    row.workflow_name
  );
  const finalNotify = enrichFinalNotifyUsers(
    workflowModule.parseFinalNotifyJson(row.final_notify_json)
  );
  const finalNotifyReceipts = loadFinalNotifyReceiptsForRequest(id);

  return {
    ...row,
    form_data: formDataDisplay,
    formFields,
    steps,
    templateSteps: parseSteps(row.steps_json) || [],
    actions: actionsEnriched,
    approver_data,
    attachments: getAttachments(id),
    notify_prefs,
    pdfLayout,
    finalNotify,
    finalNotifyReceipts,
    form_schema_json: undefined,
    form_fields_json: undefined,
    pdf_layout_json: undefined,
    final_notify_json: undefined,
    steps_snapshot_json: undefined,
    approver_data_json: undefined,
    notify_prefs_json: undefined,
  };
}

function canUserApproveStep(userId, step, requestId) {
  if (!step || !Array.isArray(step.approverIds)) return false;
  const cap = agents.getApproveCapacity(
    userId,
    step,
    requestId,
    hasApprovalForPrincipal
  );
  if (cap.asSelf) return true;
  if (cap.principalIds && cap.principalIds.length) return true;
  return false;
}

/**
 * 解析此次核准是「本人」還是「代理誰」
 * @returns {{ onBehalfOf: number|null, error?: string }}
 */
function resolveApproveBehalf(userId, step, requestId) {
  const cap = agents.getApproveCapacity(
    userId,
    step,
    requestId,
    hasApprovalForPrincipal
  );
  if (cap.asSelf) return { onBehalfOf: null };
  if (cap.principalIds && cap.principalIds.length) {
    // 同一關可代多人時，一次只代第一位尚未簽的（mode=all 常見）
    return { onBehalfOf: Number(cap.principalIds[0]) };
  }
  return { error: '您不是目前步驟的簽核人，或已簽核過' };
}

function isStepComplete(requestId, step) {
  if (!step) return false;
  const ids = (step.approverIds || []).map(Number).filter(Boolean);
  if (!ids.length) return false;
  if (step.mode !== 'all') {
    return ids.some((aid) => hasApprovalForPrincipal(requestId, step, aid));
  }
  // all：全部簽核人皆需核准（本人或被代簽皆算；僅計退回後）
  for (const aid of ids) {
    if (!hasApprovalForPrincipal(requestId, step, aid)) return false;
  }
  return (step.approverIds || []).length > 0;
}

/** 目前步驟在流程中的上一步（無則 null） */
function getPreviousStep(steps, currentStep) {
  if (!Array.isArray(steps) || !currentStep) return null;
  const idx = steps.findIndex(
    (s) => Number(s.order) === Number(currentStep.order)
  );
  if (idx <= 0) return null;
  return steps[idx - 1] || null;
}

function isValidDepartment(name) {
  if (!name) return true; // optional
  const row = db
    .prepare(`SELECT id FROM departments WHERE name = ? AND active = 1`)
    .get(String(name).trim());
  return !!row;
}

// ---------- Departments & TwCalendar (Modular Route) ----------
registerDepartmentRoutes(app, {
  db,
  twCalendar,
  authMiddleware,
  adminOnly,
  getUserDepartments,
  addUserToDepartment,
  removeUserFromDepartment,
});

// ---------- Auth ----------
/**
 * 公開自我註冊已關閉（資安）。
 * 成員請由管理員於「成員名單」新增。
 * 緊急開放：環境變數 ALLOW_PUBLIC_REGISTER=1（不建議）
 */
app.post('/api/auth/register', (req, res) => {
  const allow =
    process.env.ALLOW_PUBLIC_REGISTER === '1' ||
    process.env.ALLOW_PUBLIC_REGISTER === 'true';
  if (!allow) {
    return res.status(403).json({
      error: '已關閉公開註冊，請洽管理員於「成員名單」建立帳號',
      code: 'REGISTER_DISABLED',
    });
  }
  // 僅在明確開啟 ALLOW_PUBLIC_REGISTER 時才允許（後備／測試）
  const { username, password, name, email, department } = req.body || {};
  if (!username || !password || !name) {
    return res.status(400).json({ error: '帳號、密碼、姓名為必填' });
  }
  if (String(username).length < 3) {
    return res.status(400).json({ error: '帳號至少 3 個字元' });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: '密碼至少 6 字元' });
  }
  const deptName = department ? String(department).trim() : '';
  if (deptName && !isValidDepartment(deptName)) {
    return res.status(400).json({ error: '請選擇有效的部門' });
  }

  const total = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (total >= 50) {
    return res.status(400).json({ error: '使用者數量已達上限（50）' });
  }
  const uname = normalizeUsername(username);
  if (uname.length < 3) {
    return res.status(400).json({ error: '帳號至少 3 個字元' });
  }
  if (findUserByUsername(uname, { activeOnly: false })) {
    return res.status(400).json({ error: '此帳號已被使用' });
  }

  try {
    const info = db
      .prepare(
        `INSERT INTO users (username, password_hash, name, email, department, role)
         VALUES (?, ?, ?, ?, ?, 'user')`
      )
      .run(
        uname,
        hashPassword(password),
        String(name).trim(),
        email ? String(email).trim() : null,
        deptName
      );
    const user = db
      .prepare(
        `SELECT id, username, name, email, department, role, active, created_at, permissions_json
         FROM users WHERE id = ?`
      )
      .get(info.lastInsertRowid);
    const safe = publicUser(user);
    const token = signToken(safe);
    res.json({ token, user: safe, permissionDefs: PERMISSION_DEFS });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return res.status(400).json({ error: '此帳號已被使用' });
    }
    console.error(e);
    res.status(500).json({ error: '註冊失敗' });
  }
});

/** 依帳號查詢（不區分大小寫；優先精確相符） */
function findUserByUsername(username, { activeOnly = true } = {}) {
  const uname = String(username || '').trim();
  if (!uname) return null;
  const activeSql = activeOnly ? ' AND active = 1' : '';
  // 1) 精確相符
  let user = db
    .prepare(`SELECT * FROM users WHERE username = ?${activeSql}`)
    .get(uname);
  if (user) return user;
  // 2) 不區分大小寫（admin / Admin / ADMIN 皆可登入）
  user = db
    .prepare(`SELECT * FROM users WHERE username = ? COLLATE NOCASE${activeSql}`)
    .get(uname);
  return user || null;
}

/** 登入失敗鎖定：同一帳號+來源 IP，連續錯誤達上限後暫時鎖定 */
const LOGIN_MAX_FAILS = Math.max(
  3,
  Number(process.env.LOGIN_MAX_FAILS) || 5
);
const LOGIN_LOCK_MS = Math.max(
  60 * 1000,
  Number(process.env.LOGIN_LOCK_MINUTES || 15) * 60 * 1000
);
/** @type {Map<string, { fails: number, lockedUntil: number }>} */
const loginAttemptMap = new Map();

function clientIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '')
    .split(',')[0]
    .trim();
  return xf || req.socket?.remoteAddress || req.ip || 'unknown';
}

function loginAttemptKey(username, req) {
  const u = String(username || '')
    .trim()
    .toLowerCase() || '_empty';
  return `${u}|${clientIp(req)}`;
}

function getLoginAttempt(key) {
  const e = loginAttemptMap.get(key);
  if (!e) return null;
  const now = Date.now();
  // 鎖定期已過：整筆清除
  if (e.lockedUntil && now >= e.lockedUntil) {
    loginAttemptMap.delete(key);
    return null;
  }
  return e;
}

function loginLockStatus(key) {
  const e = getLoginAttempt(key);
  if (e?.lockedUntil && Date.now() < e.lockedUntil) {
    const remainMs = e.lockedUntil - Date.now();
    const mins = Math.max(1, Math.ceil(remainMs / 60000));
    return {
      locked: true,
      mins,
      remainMs,
      lockedUntil: e.lockedUntil,
    };
  }
  return { locked: false, fails: e?.fails || 0 };
}

function recordLoginFailure(key) {
  const now = Date.now();
  let e = loginAttemptMap.get(key);
  if (e?.lockedUntil && now < e.lockedUntil) {
    return { ...e, justLocked: false, alreadyLocked: true };
  }
  if (!e || (e.lockedUntil && now >= e.lockedUntil)) {
    e = { fails: 0, lockedUntil: 0 };
  }
  e.fails = (e.fails || 0) + 1;
  let justLocked = false;
  if (e.fails >= LOGIN_MAX_FAILS) {
    e.lockedUntil = now + LOGIN_LOCK_MS;
    e.fails = 0;
    justLocked = true;
  }
  loginAttemptMap.set(key, e);
  // 防止 map 無限成長
  if (loginAttemptMap.size > 5000) {
    for (const [k, v] of loginAttemptMap) {
      if (v.lockedUntil && v.lockedUntil < now) loginAttemptMap.delete(k);
    }
  }
  return { ...e, justLocked };
}

function clearLoginFailures(key) {
  loginAttemptMap.delete(key);
}

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  console.log('[login attempt]', { username, passwordLength: password ? password.length : 0, ip: req.ip });
  if (!username || !password) {
    return res.status(400).json({ error: '請輸入帳號與密碼' });
  }
  const attemptKey = loginAttemptKey(username, req);
  const lock = loginLockStatus(attemptKey);
  if (lock.locked) {
    return res.status(429).json({
      error: `登入失敗次數過多，請約 ${lock.mins} 分鐘後再試`,
      code: 'LOGIN_LOCKED',
      retryAfterMinutes: lock.mins,
    });
  }

  // 帳號大小寫皆可登入（Admin / admin / ADMIN 相同）；回傳的 username 為庫內正規寫法（首字母大寫）
  const user = findUserByUsername(username, { activeOnly: true });
  if (!user || !verifyPassword(password, user.password_hash)) {
    const rec = recordLoginFailure(attemptKey);
    console.log('[login FAILED]', {
      username,
      userFound: !!user,
      active: user?.active,
      hashMatch: user ? verifyPassword(password, user.password_hash) : false,
      userHashPrefix: user?.password_hash?.slice(0, 10),
    });
    if (rec.justLocked) {
      const mins = Math.max(1, Math.ceil(LOGIN_LOCK_MS / 60000));
      return res.status(429).json({
        error: `登入失敗次數過多，帳號已暫時鎖定約 ${mins} 分鐘`,
        code: 'LOGIN_LOCKED',
        retryAfterMinutes: mins,
      });
    }
    const left = Math.max(0, LOGIN_MAX_FAILS - (rec.fails || 0));
    return res.status(401).json({
      error:
        left > 0 && left <= 2
          ? `帳號或密碼錯誤（還可嘗試 ${left} 次）`
          : '帳號或密碼錯誤',
      code: 'LOGIN_FAILED',
      attemptsLeft: left,
    });
  }
  console.log('[login SUCCESS]', { username: user.username, role: user.role });
  clearLoginFailures(attemptKey);
  // 同一帳號其他 IP 的失敗紀錄不在此清（避免誤清攻擊者鎖定狀態影響面較小）
  const safe = publicUser(user);
  res.json({ token: signToken(safe), user: safe, permissionDefs: PERMISSION_DEFS });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  // 含到職日／年資／特休摘要
  const user = db
    .prepare(`SELECT * FROM users WHERE id = ? AND active = 1`)
    .get(req.user.id);
  if (!user) return res.status(401).json({ error: '使用者不存在' });
  res.json({
    user: publicUser(user, { withLabor: true }),
    permissionDefs: PERMISSION_DEFS,
  });
});

app.put('/api/auth/password', authMiddleware, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword || String(newPassword).length < 6) {
    return res.status(400).json({ error: '請提供正確的舊密碼，且新密碼至少 6 字元' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(currentPassword, user.password_hash)) {
    return res.status(400).json({ error: '舊密碼不正確' });
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), req.user.id);
  res.json({ ok: true });
});

/**
 * 登入成員可自行修改：分機、電話、Email 通知偏好
 * 姓名、Email：一般成員唯讀（僅管理員可改）
 */
// ---------- 統一代理人（代簽 + 代申請請假）----------
app.get('/api/agents/me', authMiddleware, (req, res) => {
  const mine = agents.listMyAgents(req.user.id);
  const asAgentForSetting = agents.listWhereIAmAgent(req.user.id);
  const asLeaveDuty = agents.listWhereIAmLeaveDutyAgent(req.user.id);
  // 合併：設定代理人 + 請假職務代理人（同 principal 去重，設定優先）
  const seen = new Set(asAgentForSetting.map((a) => Number(a.principal_id)));
  const asAgentFor = [
    ...asAgentForSetting,
    ...asLeaveDuty.filter((a) => !seen.has(Number(a.principal_id))),
  ];
  res.json({
    // 我指定的代理人（通常 0～1 位 active）
    myAgent: mine.find((a) => a.effective) || mine[0] || null,
    myAgents: mine,
    // 誰指定我為代理人（有效中）／我目前為其請假職務代理人
    asAgentFor,
    asLeaveDutyAgentFor: asLeaveDuty,
  });
});

app.put('/api/agents/me', authMiddleware, (req, res) => {
  const result = agents.setMyAgent(req.user.id, req.body || {}, req.user.id);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ ok: true, agent: result.agent, message: '代理人已設定' });
});

app.delete('/api/agents/me', authMiddleware, (req, res) => {
  agents.clearMyAgent(req.user.id);
  res.json({ ok: true, message: '已清除代理人' });
});

/**
 * 代申請請假可選對象：任何啟用中的同仁（不含自己）
 * 政策：任何人皆可代他人申請請假（僅限請假流程；代簽仍走代理人設定）
 */
app.get('/api/agents/leave-principals', authMiddleware, (req, res) => {
  const list = db
    .prepare(
      `SELECT id, username, name, department, active
       FROM users
       WHERE active = 1 AND id != ?
       ORDER BY name COLLATE NOCASE, id ASC`
    )
    .all(Number(req.user.id));
  res.json({ principals: list });
});

app.put('/api/auth/profile', authMiddleware, (req, res) => {
  const { name, email, phone, extension, email_notify } = req.body || {};
  const isAdminUser = req.user.role === 'admin';
  const existing = db
    .prepare(`SELECT * FROM users WHERE id = ? AND active = 1`)
    .get(req.user.id);
  if (!existing) return res.status(401).json({ error: '使用者不存在' });

  let trimmedName = existing.name || '';
  let emailVal = existing.email ? String(existing.email).trim() : '';

  if (isAdminUser) {
    if (name == null || !String(name).trim()) {
      return res.status(400).json({ error: '姓名為必填' });
    }
    trimmedName = String(name).trim();
    if (trimmedName.length > 80) {
      return res.status(400).json({ error: '姓名過長（最多 80 字）' });
    }
    emailVal = email != null ? String(email).trim() : '';
    if (emailVal && emailVal.length > 120) {
      return res.status(400).json({ error: 'Email 過長' });
    }
    if (emailVal && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
      return res.status(400).json({ error: 'Email 格式不正確' });
    }
  } else if (
    (name != null && String(name).trim() !== String(existing.name || '').trim()) ||
    (email != null &&
      String(email).trim() !== String(existing.email || '').trim())
  ) {
    return res.status(403).json({
      error: '姓名與 Email 僅能由系統管理員修改，請聯絡管理員',
    });
  }

  const phoneVal = phone != null ? String(phone).trim() : '';
  const extVal = extension != null ? String(extension).trim() : '';
  if (phoneVal.length > 40) {
    return res.status(400).json({ error: '電話過長' });
  }
  if (extVal.length > 20) {
    return res.status(400).json({ error: '分機過長' });
  }
  const notifyVal =
    email_notify === 0 || email_notify === false || email_notify === '0' ? 0 : 1;

  db.prepare(
    `UPDATE users SET
      name = ?,
      email = ?,
      phone = ?,
      extension = ?,
      email_notify = ?
     WHERE id = ? AND active = 1`
  ).run(
    trimmedName,
    emailVal || null,
    phoneVal || null,
    extVal || null,
    notifyVal,
    req.user.id
  );

  const user = db.prepare(`SELECT * FROM users WHERE id = ? AND active = 1`).get(req.user.id);
  if (!user) return res.status(401).json({ error: '使用者不存在' });
  res.json({ user: publicUser(user) });
});

app.get('/api/me/comment-phrases', authMiddleware, (req, res) => {
  const row = db.prepare(`SELECT comment_phrases_json FROM users WHERE id = ?`).get(req.user.id);
  if (!row) return res.status(401).json({ error: '使用者不存在' });
  res.json({
    phrases: commentPhrases.parsePhrasesJson(row.comment_phrases_json),
    defaults: commentPhrases.DEFAULT_COMMENT_PHRASES,
    max: commentPhrases.MAX_PHRASES,
    maxLen: commentPhrases.MAX_LEN,
  });
});

app.put('/api/me/comment-phrases', authMiddleware, (req, res) => {
  const body = req.body || {};
  const reset = body.reset === true || body.reset === 1 || body.reset === '1';
  const phrases = reset
    ? commentPhrases.DEFAULT_COMMENT_PHRASES.slice()
    : commentPhrases.normalizePhrases(body.phrases);
  if (!phrases.length) {
    return res.status(400).json({ error: '請至少保留一則常用片語，或使用還原預設' });
  }
  db.prepare(`UPDATE users SET comment_phrases_json = ? WHERE id = ?`).run(
    JSON.stringify(phrases),
    req.user.id
  );
  const user = db.prepare(`SELECT * FROM users WHERE id = ? AND active = 1`).get(req.user.id);
  res.json({
    ok: true,
    phrases,
    user: publicUser(user),
    message: reset ? '已還原預設片語' : '常用片語已儲存',
  });
});

// ---------- Mail & Notification settings (Modular Route) ----------
registerMailRoutes(app, {
  db,
  mail,
  lineNotify: require('./line-notify'),
  authMiddleware,
  builtinAdminOnly,
  adminOnly,
});

// ---------- 系統設定（Admin、公告、安全政策、數位簽章、稽核日誌 - Modular Route）----------
registerSystemAdminRoutes(app, {
  systemSettings,
  appVersion,
  deployLog,
  pdfSign,
  authMiddleware,
  adminOnly,
  builtinAdminOnly,
  uploadPackage,
  packageUploadError,
  parseUploadedPackage,
});

// ---------- Users ----------
/** 非內建 Admin 不可看見內建 Admin 帳號（含其他最高權限） */
function canViewerSeeUser(viewer, targetUser) {
  if (!targetUser) return false;
  if (isBuiltinAdminUser(targetUser) && !isBuiltinAdminUsername(viewer?.username)) {
    return false;
  }
  return true;
}

app.get('/api/users', authMiddleware, (req, res) => {
  const isAdminUser = req.user.role === 'admin';
  const canLabor =
    isAdminUser || userHasPermission(req.user.id, 'users_leave');
  const viewerIsBuiltin = isBuiltinAdminUsername(req.user.username);
  // 特休／年資：管理員或「成員休假已休管理」權限
  const withLabor =
    canLabor && (req.query.labor === '1' || req.query.labor === 'true');
  const users = db
    .prepare(`SELECT * FROM users WHERE active = 1 ORDER BY name COLLATE NOCASE`)
    .all()
    .filter((u) => canViewerSeeUser(req.user, u))
    .map((u) => {
      const pu = publicUser(u, { withLabor });
      // 無權限者：名單不回傳到職／特休相關欄位（保護隱私）
      if (!canLabor) {
        delete pu.hire_date;
        delete pu.sl_used_days;
        delete pu.sl_used_hours;
        delete pu.leave_used;
        delete pu.leave_entitled;
        delete pu.labor;
        delete pu.seniority_label;
        delete pu.special_leave_entitled;
      }
      // 前端標記：內建 Admin 不可刪、不可改帳號
      if (isBuiltinAdminUser(u)) {
        pu.isBuiltinAdmin = true;
        pu.lockedUsername = true;
        pu.undeletable = true;
      }
      return pu;
    });
  res.json({
    users,
    permissionDefs: PERMISSION_DEFS,
    viewerIsBuiltinAdmin: viewerIsBuiltin,
    canUsersLeave: canLabor,
    canUsersFull: isAdminUser,
  });
});

/** 單一成員勞動摘要（年資／特休） */
app.get('/api/users/:id/labor', authMiddleware, (req, res) => {
  const id = Number(req.params.id);
  const canLabor =
    req.user.role === 'admin' || userHasPermission(req.user.id, 'users_leave');
  // 本人、管理員、或有成員休假權限可查看
  if (req.user.id !== id && !canLabor) {
    return res.status(403).json({ error: '無權查看此成員勞動資料' });
  }
  const user = db.prepare(`SELECT * FROM users WHERE id = ? AND active = 1`).get(id);
  if (!user) return res.status(404).json({ error: '找不到使用者' });
  if (!canViewerSeeUser(req.user, user) && req.user.id !== id) {
    return res.status(404).json({ error: '找不到使用者' });
  }
  res.json({
    user: publicUser(user, { withLabor: true }),
    labor: labor.buildLaborSummary(user),
  });
});

app.get('/api/permissions', authMiddleware, adminOnly, (req, res) => {
  res.json({ permissionDefs: PERMISSION_DEFS });
});

app.put('/api/users/:id', authMiddleware, (req, res) => {
  const id = Number(req.params.id);
  const isAdminUser = req.user.role === 'admin';
  const canLaborOnly =
    !isAdminUser && userHasPermission(req.user.id, 'users_leave');
  if (!isAdminUser && !canLaborOnly) {
    return res.status(403).json({ error: '需要管理員權限' });
  }

  const {
    username,
    name,
    email,
    phone,
    extension,
    department,
    departments,
    role,
    active,
    permissions,
    password,
    hire_date,
    sl_used_days,
    sl_used_hours,
    leave_used,
    leave_used_json,
    leave_entitled,
    leave_entitled_json,
  } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: '找不到使用者' });
  if (!user.active) {
    return res.status(400).json({ error: '此帳號已停用，無法修改' });
  }
  // 內建 Admin：僅本人（內建 Admin）可維護；其他最高權限不可見、不可改
  if (isBuiltinAdminUser(user)) {
    if (!isBuiltinAdminUsername(req.user.username)) {
      return res.status(403).json({ error: '無權修改系統內建 Admin 帳號' });
    }
  }

  // 僅「成員休假已休管理」：到職日／手動可休／手動已休
  if (canLaborOnly) {
    if (!canViewerSeeUser(req.user, user)) {
      return res.status(404).json({ error: '找不到使用者' });
    }
    let nextHireDate = user.hire_date || null;
    if (hire_date !== undefined) {
      if (hire_date === null || hire_date === '') {
        nextHireDate = null;
      } else {
        const hd = labor.toDateOnly(hire_date);
        if (!hd) return res.status(400).json({ error: '到職日格式須為 YYYY-MM-DD' });
        nextHireDate = hd;
      }
    }
    const leaveMerged = labor.mergeLeaveUsedFromRequest(
      { leave_used, leave_used_json, sl_used_days, sl_used_hours },
      user
    );
    if (!leaveMerged.ok) {
      return res.status(400).json({ error: leaveMerged.error });
    }
    const entMerged = labor.mergeLeaveEntitledFromRequest(
      { leave_entitled, leave_entitled_json },
      user
    );
    if (!entMerged.ok) {
      return res.status(400).json({ error: entMerged.error });
    }
    try {
      db.prepare(
        `UPDATE users SET hire_date = ?, sl_used_days = ?, sl_used_hours = ?, leave_used_json = ?, leave_entitled_json = ? WHERE id = ?`
      ).run(
        nextHireDate,
        leaveMerged.specialDays,
        leaveMerged.specialHours,
        leaveMerged.json,
        entMerged.json,
        id
      );
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: '更新失敗' });
    }
    const updated = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
    return res.json({
      user: publicUser(updated, { withLabor: true }),
      laborOnly: true,
    });
  }

  if (department != null && department !== '' && !isValidDepartment(department)) {
    return res.status(400).json({ error: '請選擇有效的部門' });
  }
  let nextHireDate = user.hire_date || null;
  if (hire_date !== undefined) {
    if (hire_date === null || hire_date === '') {
      nextHireDate = null;
    } else {
      const hd = labor.toDateOnly(hire_date);
      if (!hd) return res.status(400).json({ error: '到職日格式須為 YYYY-MM-DD' });
      nextHireDate = hd;
    }
  }
  // 各有上限假別：手動可休＋手動已休（leave_entitled / leave_used）＋相容 sl_used_*
  const leaveMerged = labor.mergeLeaveUsedFromRequest(
    { leave_used, leave_used_json, sl_used_days, sl_used_hours },
    user
  );
  if (!leaveMerged.ok) {
    return res.status(400).json({ error: leaveMerged.error });
  }
  const entMerged = labor.mergeLeaveEntitledFromRequest(
    { leave_entitled, leave_entitled_json },
    user
  );
  if (!entMerged.ok) {
    return res.status(400).json({ error: entMerged.error });
  }
  const nextSlDays = leaveMerged.specialDays;
  const nextSlHours = leaveMerged.specialHours;
  const nextLeaveUsedJson = leaveMerged.json;
  const nextLeaveEntitledJson = entMerged.json;

  let nextUsername = user.username;
  if (username != null && String(username).trim() !== '') {
    const uname = normalizeUsername(username);
    // 內建 Admin 帳號名稱鎖定，不可修改
    if (isBuiltinAdminUser(user)) {
      if (!isBuiltinAdminUsername(uname)) {
        return res.status(400).json({ error: '系統內建 Admin 帳號名稱不可修改' });
      }
      nextUsername = BUILTIN_ADMIN_USERNAME;
    } else {
      if (uname.length < 3) {
        return res.status(400).json({ error: '帳號至少 3 個字元' });
      }
      if (!/^[A-Za-z0-9._@-]+$/.test(uname)) {
        return res.status(400).json({ error: '帳號僅可使用英數、. _ @ -' });
      }
      // 不可搶用內建 admin 名稱
      if (isBuiltinAdminUsername(uname)) {
        return res.status(400).json({ error: 'Admin 為系統保留帳號，請使用其他帳號' });
      }
      const clash = findUserByUsername(uname, { activeOnly: false });
      if (clash && clash.id !== id) {
        return res.status(400).json({ error: '此帳號已被使用' });
      }
      nextUsername = uname;
    }
  }

  let nextRole = user.role;
  if (role === 'admin' || role === 'user') {
    nextRole = role;
  }
  // 內建 Admin 永遠保持系統管理員
  if (isBuiltinAdminUser(user)) {
    nextRole = 'admin';
  }

  // 不可取消最後一位系統管理員
  if (user.role === 'admin' && nextRole !== 'admin') {
    const adminCount = db
      .prepare(`SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND active = 1`)
      .get().c;
    if (adminCount <= 1) {
      return res.status(400).json({ error: '系統至少需保留一位系統管理員' });
    }
  }
  // 不可停用自己；內建 Admin 不可停用
  if (id === req.user.id && (active === 0 || active === false)) {
    return res.status(400).json({ error: '不可停用目前登入的帳號' });
  }
  if (isBuiltinAdminUser(user) && (active === 0 || active === false)) {
    return res.status(400).json({ error: '系統內建 Admin 帳號不可停用' });
  }

  let permJson = user.permissions_json || '[]';
  if (permissions !== undefined) {
    const cleaned = parsePermissions(permissions);
    permJson = JSON.stringify(cleaned);
  }
  // 系統管理員不需個別權限位元（一律全開）
  if (nextRole === 'admin') {
    permJson = '[]';
  }

  const nextActive =
    typeof active === 'number' || typeof active === 'boolean' ? (active ? 1 : 0) : user.active;

  let nextPasswordHash = null;
  if (password != null && String(password).trim() !== '') {
    if (String(password).length < 6) {
      return res.status(400).json({ error: '新密碼至少 6 字元' });
    }
    nextPasswordHash = hashPassword(String(password));
  }

  // 多部門
  let nextPrimary =
    department != null ? String(department).trim() : user.department || '';
  let nextDepts = null;
  if (Array.isArray(departments)) {
    nextDepts = [
      ...new Set(
        departments
          .map((d) => String(d || '').trim())
          .filter(Boolean)
      ),
    ];
    for (const d of nextDepts) {
      if (!isValidDepartment(d)) {
        return res.status(400).json({ error: `無效的部門：${d}` });
      }
    }
    if (!nextPrimary && nextDepts.length) nextPrimary = nextDepts[0];
    if (nextPrimary && !nextDepts.includes(nextPrimary)) {
      nextDepts = [nextPrimary, ...nextDepts];
    }
  }

  try {
    db.prepare(
      `UPDATE users SET
        username = ?,
        name = COALESCE(?, name),
        email = COALESCE(?, email),
        phone = COALESCE(?, phone),
        extension = COALESCE(?, extension),
        department = COALESCE(?, department),
        role = ?,
        active = ?,
        permissions_json = ?,
        password_hash = COALESCE(?, password_hash),
        hire_date = ?,
        sl_used_days = ?,
        sl_used_hours = ?,
        leave_used_json = ?,
        leave_entitled_json = ?
       WHERE id = ?`
    ).run(
      nextUsername,
      name != null ? String(name).trim() : null,
      email != null ? String(email).trim() : null,
      phone != null ? String(phone).trim() : null,
      extension != null ? String(extension).trim() : null,
      department != null ? String(department).trim() : null,
      nextRole,
      nextActive,
      permJson,
      nextPasswordHash,
      nextHireDate,
      nextSlDays,
      nextSlHours,
      nextLeaveUsedJson,
      nextLeaveEntitledJson,
      id
    );

    if (nextDepts) {
      db.prepare(`DELETE FROM user_departments WHERE user_id = ?`).run(id);
      const ins = db.prepare(
        `INSERT OR IGNORE INTO user_departments (user_id, department) VALUES (?, ?)`
      );
      for (const d of nextDepts) ins.run(id, d);
      if (nextPrimary) {
        db.prepare(`UPDATE users SET department = ? WHERE id = ?`).run(nextPrimary, id);
      }
    } else if (department != null && String(department).trim()) {
      // 僅更新主部門時，確保多部門表有此部門
      try {
        addUserToDepartment(id, String(department).trim());
      } catch {
        /* ignore */
      }
    }
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return res.status(400).json({ error: '此帳號已被使用' });
    }
    console.error(e);
    return res.status(500).json({ error: '更新失敗' });
  }

  const updated = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
  // 若改了自己的帳號，回傳新 username 供前端刷新 token 提示
  res.json({
    user: publicUser(updated, { withLabor: true }),
    selfUsernameChanged:
      id === req.user.id && nextUsername !== user.username ? nextUsername : null,
  });
});

/**
 * 系統管理員重設／修改任一成員密碼（不需舊密碼）
 * body: { password, confirmPassword? }
 */
app.put('/api/users/:id/password', authMiddleware, adminOnly, (req, res) => {
  const id = Number(req.params.id);
  const { password, newPassword, confirmPassword } = req.body || {};
  const pwd = password != null ? password : newPassword;
  if (pwd == null || !String(pwd)) {
    return res.status(400).json({ error: '請輸入新密碼' });
  }
  if (String(pwd).length < 6) {
    return res.status(400).json({ error: '新密碼至少 6 字元' });
  }
  if (confirmPassword != null && String(confirmPassword) !== String(pwd)) {
    return res.status(400).json({ error: '兩次輸入的密碼不一致' });
  }
  const user = db.prepare(`SELECT id, username, name, active FROM users WHERE id = ?`).get(id);
  if (!user) return res.status(404).json({ error: '找不到使用者' });
  if (!user.active) {
    return res.status(400).json({ error: '此帳號已停用，無法修改密碼' });
  }
  // 內建 Admin 密碼僅本人可改（其他最高權限不可改 Admin 密碼）
  if (isBuiltinAdminUser(user) && !isBuiltinAdminUsername(req.user.username)) {
    return res.status(403).json({ error: '無權修改系統內建 Admin 密碼' });
  }
  db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(hashPassword(String(pwd)), id);
  res.json({
    ok: true,
    message: `已更新「${user.name}」（${user.username}）的密碼`,
    userId: id,
    username: user.username,
  });
});

/** 系統管理員新增成員 */
app.post('/api/users', authMiddleware, adminOnly, (req, res) => {
  const {
    username,
    password,
    name,
    email,
    department,
    role,
    permissions,
    hire_date,
    sl_used_days,
    sl_used_hours,
    leave_used,
    leave_used_json,
    leave_entitled,
    leave_entitled_json,
  } = req.body || {};
  if (!username || !password || !name) {
    return res.status(400).json({ error: '帳號、密碼、姓名為必填' });
  }
  const uname = normalizeUsername(username);
  if (uname.length < 3) {
    return res.status(400).json({ error: '帳號至少 3 個字元' });
  }
  if (!/^[A-Za-z0-9._@-]+$/.test(uname)) {
    return res.status(400).json({ error: '帳號僅可使用英數、. _ @ -' });
  }
  if (isBuiltinAdminUsername(uname)) {
    return res.status(400).json({ error: 'Admin 為系統保留帳號，請使用其他帳號' });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: '密碼至少 6 字元' });
  }
  const deptName = department ? String(department).trim() : '';
  if (deptName && !isValidDepartment(deptName)) {
    return res.status(400).json({ error: '請選擇有效的部門' });
  }
  let hireDate = null;
  if (hire_date) {
    hireDate = labor.toDateOnly(hire_date);
    if (!hireDate) return res.status(400).json({ error: '到職日格式須為 YYYY-MM-DD' });
  }
  const leaveMerged = labor.mergeLeaveUsedFromRequest(
    { leave_used, leave_used_json, sl_used_days, sl_used_hours },
    null
  );
  if (!leaveMerged.ok) {
    return res.status(400).json({ error: leaveMerged.error });
  }
  const entMerged = labor.mergeLeaveEntitledFromRequest(
    { leave_entitled, leave_entitled_json },
    null
  );
  if (!entMerged.ok) {
    return res.status(400).json({ error: entMerged.error });
  }
  const slDays = leaveMerged.specialDays;
  const slHours = leaveMerged.specialHours;
  const leaveUsedJson = leaveMerged.json;
  const leaveEntitledJson = entMerged.json;
  const nextRole = role === 'admin' ? 'admin' : 'user';
  const permJson =
    nextRole === 'admin' ? '[]' : JSON.stringify(parsePermissions(permissions || []));

  // 帳號不區分大小寫；儲存首字母大寫
  if (findUserByUsername(uname, { activeOnly: false })) {
    return res.status(400).json({ error: '此帳號已被使用' });
  }

  try {
    const info = db
      .prepare(
        `INSERT INTO users (username, password_hash, name, email, department, role, permissions_json, active, hire_date, sl_used_days, sl_used_hours, leave_used_json, leave_entitled_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`
      )
      .run(
        uname,
        hashPassword(password),
        String(name).trim(),
        email ? String(email).trim() : null,
        deptName,
        nextRole,
        permJson,
        hireDate,
        slDays,
        slHours,
        leaveUsedJson,
        leaveEntitledJson
      );
    const created = db.prepare(`SELECT * FROM users WHERE id = ?`).get(info.lastInsertRowid);
    res.status(201).json({ user: publicUser(created, { withLabor: true }) });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return res.status(400).json({ error: '此帳號已被使用' });
    }
    console.error(e);
    res.status(500).json({ error: '新增成員失敗' });
  }
});

/** 軟刪除單一成員 */
function softDeleteUser(id, actorId) {
  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
  if (!user || !user.active) {
    return { ok: false, error: '找不到使用者或已刪除' };
  }
  if (id === actorId) {
    return { ok: false, error: '不可刪除目前登入的帳號' };
  }
  // 系統內建 Admin 永遠不可刪除
  if (isBuiltinAdminUser(user)) {
    return { ok: false, error: '系統內建 Admin 帳號不可刪除' };
  }
  if (user.role === 'admin') {
    const adminCount = db
      .prepare(`SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND active = 1`)
      .get().c;
    if (adminCount <= 1) {
      return { ok: false, error: '不可刪除最後一位系統管理員' };
    }
  }
  const stamp = Date.now().toString(36) + '_' + id;
  const newUsername = `${user.username}__del_${stamp}`.slice(0, 80);
  db.prepare(`UPDATE users SET active = 0, username = ? WHERE id = ?`).run(newUsername, id);
  return { ok: true, id, name: user.name, username: user.username };
}

/** 系統管理員刪除成員（軟刪除：停用，帳號加後綴避免占用） */
app.delete('/api/users/:id', authMiddleware, adminOnly, (req, res) => {
  const id = Number(req.params.id);
  const result = softDeleteUser(id, req.user.id);
  if (!result.ok) {
    return res.status(400).json({ error: result.error });
  }
  res.json({ ok: true, id });
});

/** 批次刪除成員 */
app.post('/api/users/bulk-delete', authMiddleware, adminOnly, (req, res) => {
  const ids = Array.isArray(req.body?.ids)
    ? [...new Set(req.body.ids.map(Number).filter(Boolean))]
    : [];
  if (!ids.length) {
    return res.status(400).json({ error: '請選擇至少一位成員' });
  }
  const deleted = [];
  const failed = [];
  for (const id of ids) {
    const r = softDeleteUser(id, req.user.id);
    if (r.ok) deleted.push({ id: r.id, name: r.name, username: r.username });
    else failed.push({ id, error: r.error });
  }
  res.json({
    ok: true,
    deleted: deleted.length,
    failed: failed.length,
    deletedUsers: deleted,
    failures: failed,
    message: `已刪除 ${deleted.length} 人${failed.length ? `，${failed.length} 人略過` : ''}`,
  });
});

// ---------- Users Excel import / export ----------
const XLSX = require('xlsx');

function splitDeptNames(text) {
  return String(text || '')
    .split(/[、,，;；\/|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function ensureDepartmentExists(name) {
  const n = String(name || '').trim();
  if (!n) return false;
  const row = db.prepare(`SELECT id FROM departments WHERE name = ? AND active = 1`).get(n);
  if (row) return true;
  const max = db.prepare(`SELECT COALESCE(MAX(sort_order), 0) AS m FROM departments`).get().m;
  db.prepare(`INSERT OR IGNORE INTO departments (name, sort_order, active) VALUES (?, ?, 1)`).run(
    n,
    max + 1
  );
  return true;
}

function setUserDepartmentsList(userId, deptList, primary) {
  const list = [...new Set((deptList || []).map((d) => String(d).trim()).filter(Boolean))];
  for (const d of list) ensureDepartmentExists(d);
  db.prepare(`DELETE FROM user_departments WHERE user_id = ?`).run(userId);
  const ins = db.prepare(
    `INSERT OR IGNORE INTO user_departments (user_id, department) VALUES (?, ?)`
  );
  for (const d of list) ins.run(userId, d);
  const main = (primary && String(primary).trim()) || list[0] || '';
  if (main) {
    ensureDepartmentExists(main);
    db.prepare(`UPDATE users SET department = ? WHERE id = ?`).run(main, userId);
    ins.run(userId, main);
  }
}

function buildUsersWorkbook(userRows, { includePasswords = false, passwordMap = {} } = {}) {
  const trackRules = labor.getManualLeaveTrackRules();
  const rows = userRows.map((u, i) => {
    const depts = getUserDepartments(u.id);
    const deptDisplay = depts.length ? depts.join('、') : u.department || '';
    const lab = labor.buildLaborSummary(u);
    const manual = lab.leaveUsedManual || labor.parseLeaveUsedManual(u);
    const row = {
      序號: i + 1,
      姓名: u.name,
      帳號: u.username,
      密碼: includePasswords ? passwordMap[u.id] || passwordMap[u.username] || '' : '',
      部門: deptDisplay,
      主部門: u.department || '',
      Email: u.email || '',
      電話: u.phone || '',
      分機: u.extension || '',
      到職日: lab.hireDate || u.hire_date || '',
      年資: lab.seniority?.label || '',
      特休應有天數: lab.specialLeave?.entitled ?? '',
      特休已休天數: lab.specialLeave?.used ?? '',
      特休剩餘天數: lab.specialLeave?.remaining ?? '',
      特休年度: lab.specialLeave?.yearLabel || '',
      角色: u.role === 'admin' ? '系統管理員' : '一般使用者',
      建立時間: u.created_at || '',
    };
    // 各有上限假別：手動已休天數／小時（匯入可寫回）
    for (const r of trackRules) {
      const m = manual[r.id] || { days: 0, hours: 0 };
      row[`${r.name}_手動已休天數`] = m.days ?? 0;
      row[`${r.name}_手動已休小時`] = m.hours ?? 0;
      const bal = (lab.leaveBalances || []).find((b) => b.id === r.id);
      if (bal) {
        row[`${r.name}_合計已休`] = bal.used ?? 0;
        row[`${r.name}_剩餘`] = bal.remaining != null ? bal.remaining : '';
      }
    }
    row.備註 = includePasswords
      ? '密碼欄已填寫之值可直接登入；空白表示未重設'
      : '匯出時密碼欄空白＝保留原密碼；匯入時填寫「假別_手動已休天數／小時」可更新系統外已休；已休合計＝手動＋系統核准';
    return row;
  });
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [
    { wch: 6 },
    { wch: 12 },
    { wch: 14 },
    { wch: 12 },
    { wch: 28 },
    { wch: 12 },
    { wch: 24 },
    { wch: 12 },
    { wch: 8 },
    { wch: 12 },
    { wch: 12 },
    { wch: 10 },
    { wch: 10 },
    { wch: 10 },
    { wch: 24 },
    { wch: 12 },
    { wch: 20 },
    { wch: 40 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, '成員名單');
  const note = XLSX.utils.aoa_to_sheet([
    ['線上簽核系統 — 成員名單 Excel'],
    ['產生時間', new Date().toLocaleString('zh-TW', { hour12: false })],
    ['人數', String(rows.length)],
    [''],
    ['匯入欄位說明'],
    ['姓名', '必填'],
    ['帳號', '必填；英文數字，至少 3 字元'],
    ['密碼', '選填；空白＝不變更既有密碼；新帳號空白則預設 pass1234'],
    ['部門', '可多個，以「、」分隔'],
    ['主部門', '主要顯示部門'],
    ['Email', '選填'],
    ['到職日', '選填；格式 YYYY-MM-DD（例 2020-03-15），供年資／特休試算'],
    ['角色', '系統管理員 或 一般使用者'],
    [''],
    ['注意'],
    ['1. 以「帳號」對應既有成員；不存在則新增。'],
    ['2. 請妥善保管含密碼的匯出檔。'],
  ]);
  note['!cols'] = [{ wch: 12 }, { wch: 56 }];
  XLSX.utils.book_append_sheet(wb, note, '說明');
  return wb;
}

/** 匯出成員 Excel（可指定 ids；可選擇重設並寫入密碼） */
app.post('/api/users/export', authMiddleware, adminOnly, (req, res) => {
  const ids = Array.isArray(req.body?.ids)
    ? [...new Set(req.body.ids.map(Number).filter(Boolean))]
    : [];
  const resetPasswords = !!req.body?.resetPasswords;
  const defaultPwd = String(req.body?.defaultPassword || 'pass1234');

  let users;
  if (ids.length) {
    users = ids
      .map((id) => db.prepare(`SELECT * FROM users WHERE id = ? AND active = 1`).get(id))
      .filter(Boolean);
  } else {
    users = db
      .prepare(`SELECT * FROM users WHERE active = 1 ORDER BY name COLLATE NOCASE`)
      .all();
  }
  // 非內建 Admin 匯出時隱藏 Admin 帳號
  users = users.filter((u) => canViewerSeeUser(req.user, u));
  if (!users.length) {
    return res.status(400).json({ error: '沒有可匯出的成員' });
  }

  const passwordMap = {};
  if (resetPasswords) {
    const upd = db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`);
    for (const u of users) {
      // 非內建 Admin 不可重設 Admin 密碼（已過濾）；內建可重設自己
      if (isBuiltinAdminUser(u) && !isBuiltinAdminUsername(req.user.username)) continue;
      const pwd = isBuiltinAdminUser(u) ? 'admin123' : defaultPwd;
      upd.run(hashPassword(pwd), u.id);
      passwordMap[u.id] = pwd;
    }
  }

  const wb = buildUsersWorkbook(users, {
    includePasswords: resetPasswords,
    passwordMap,
  });
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const fname = `成員名單_${new Date().toISOString().slice(0, 10)}.xlsx`;
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${encodeURIComponent(fname)}"; filename*=UTF-8''${encodeURIComponent(fname)}`
  );
  res.send(Buffer.from(buf));
});

/** 下載空白匯入範本 */
app.get('/api/users/export-template', authMiddleware, adminOnly, (req, res) => {
  const wb = XLSX.utils.book_new();
  const sample = [
    {
      姓名: '王小明',
      帳號: 'wangxm',
      密碼: 'pass1234',
      部門: '業務部',
      主部門: '業務部',
      Email: 'wang@example.com',
      到職日: '2020-03-15',
      角色: '一般使用者',
    },
  ];
  const ws = XLSX.utils.json_to_sheet(sample);
  XLSX.utils.book_append_sheet(wb, ws, '成員名單');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="members-template.xlsx"`
  );
  res.send(Buffer.from(buf));
});

/** Excel 匯入成員（新增或更新） */
app.post(
  '/api/users/import',
  authMiddleware,
  adminOnly,
  upload.single('file'),
  (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: '請上傳 Excel 檔（.xlsx）' });
    }
    try {
      const wb = XLSX.readFile(req.file.path);
      const sheetName =
        wb.SheetNames.find((n) => /成員|帳號|密碼/.test(n)) || wb.SheetNames[0];
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' });
      if (!rows.length) {
        return res.status(400).json({ error: 'Excel 沒有資料列' });
      }

      let created = 0;
      let updated = 0;
      const errors = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const name = String(row['姓名'] || row.name || '').trim();
        const username = normalizeUsername(row['帳號'] || row.username || '');
        const passwordRaw = String(row['密碼'] || row.password || '').trim();
        const email = String(row['Email'] || row['email'] || row.email || '').trim();
        const phone = String(row['電話'] || row.phone || '').trim();
        const extension = String(row['分機'] || row.extension || '').trim();
        const roleLabel = String(row['角色'] || row.role || '').trim();
        const role = /管理|admin/i.test(roleLabel) ? 'admin' : 'user';
        const primary =
          String(row['主部門'] || '').trim() || splitDeptNames(row['部門'])[0] || '';
        const depts = splitDeptNames(row['部門'] || row['主部門'] || '');
        if (primary && !depts.includes(primary)) depts.unshift(primary);
        // Excel 日期可能是序號或字串
        let hireRaw = row['到職日'] ?? row['hire_date'] ?? row.hire_date ?? '';
        if (typeof hireRaw === 'number' && XLSX.SSF) {
          try {
            const parsed = XLSX.SSF.parse_date_code(hireRaw);
            if (parsed) {
              hireRaw = `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
            }
          } catch {
            /* keep */
          }
        }
        const hireDate = hireRaw ? labor.toDateOnly(String(hireRaw)) : null;
        if (hireRaw && !hireDate) {
          errors.push(`第 ${i + 2} 列：到職日格式錯誤（請用 YYYY-MM-DD）`);
          continue;
        }

        if (!name && !username) continue;
        if (!name || !username) {
          errors.push(`第 ${i + 2} 列：姓名與帳號為必填`);
          continue;
        }
        if (username.length < 3) {
          errors.push(`第 ${i + 2} 列：帳號「${username}」至少 3 字元`);
          continue;
        }

        try {
          for (const d of depts) ensureDepartmentExists(d);
          if (primary) ensureDepartmentExists(primary);

          // Excel 各假別手動已休：欄名「{假別}_手動已休天數／小時」
          const leaveUsedFromExcel = {};
          let hasLeaveUsedCols = false;
          for (const rule of labor.getManualLeaveTrackRules()) {
            const dKey = `${rule.name}_手動已休天數`;
            const hKey = `${rule.name}_手動已休小時`;
            const hasD = row[dKey] !== undefined && String(row[dKey]).trim() !== '';
            const hasH = row[hKey] !== undefined && String(row[hKey]).trim() !== '';
            if (hasD || hasH) {
              hasLeaveUsedCols = true;
              leaveUsedFromExcel[rule.id] = {
                days: hasD ? row[dKey] : 0,
                hours: hasH ? row[hKey] : 0,
              };
            }
          }
          // 相容舊範本：僅有「特休已休天數」且無 special 手動欄時，視為特休手動天數
          if (
            !leaveUsedFromExcel.special &&
            row['特休手動已休天數'] !== undefined &&
            String(row['特休手動已休天數']).trim() !== ''
          ) {
            hasLeaveUsedCols = true;
            leaveUsedFromExcel.special = {
              days: row['特休手動已休天數'],
              hours: row['特休手動已休小時'] || 0,
            };
          }

          const applyLeaveUsed = (uid, existing) => {
            if (!hasLeaveUsedCols) return;
            const merged = labor.mergeLeaveUsedFromRequest(
              { leave_used: leaveUsedFromExcel },
              existing || null
            );
            if (!merged.ok) {
              errors.push(`第 ${i + 2} 列（${username}）：${merged.error}`);
              return;
            }
            db.prepare(
              `UPDATE users SET leave_used_json = ?, sl_used_days = ?, sl_used_hours = ? WHERE id = ?`
            ).run(merged.json, merged.specialDays, merged.specialHours, uid);
          };

          let user = findUserByUsername(username, { activeOnly: false });
          if (user && !user.active) {
            // 復用已軟刪的帳號：重新啟用並改回原帳號名
            db.prepare(
              `UPDATE users SET active = 1, username = ?, name = ?, email = ?, phone = ?, extension = ?, department = ?, role = ?, hire_date = COALESCE(?, hire_date) WHERE id = ?`
            ).run(
              username,
              name,
              email || null,
              phone || null,
              extension || null,
              primary || '',
              role,
              hireDate,
              user.id
            );
            if (passwordRaw) {
              if (passwordRaw.length < 6) {
                errors.push(`第 ${i + 2} 列：密碼至少 6 字元`);
                continue;
              }
              db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(
                hashPassword(passwordRaw),
                user.id
              );
            } else {
              db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(
                hashPassword('pass1234'),
                user.id
              );
            }
            setUserDepartmentsList(user.id, depts, primary);
            applyLeaveUsed(user.id, user);
            updated += 1;
            continue;
          }

          if (user) {
            db.prepare(
              `UPDATE users SET name = ?, email = ?, phone = ?, extension = ?, department = ?, role = ?, active = 1, hire_date = COALESCE(?, hire_date) WHERE id = ?`
            ).run(
              name,
              email || null,
              phone || null,
              extension || null,
              primary || user.department || '',
              role,
              hireDate,
              user.id
            );
            // 若 Excel 有填到職日則覆寫
            if (hireDate) {
              db.prepare(`UPDATE users SET hire_date = ? WHERE id = ?`).run(hireDate, user.id);
            }
            if (passwordRaw) {
              if (passwordRaw.length < 6) {
                errors.push(`第 ${i + 2} 列（${username}）：密碼至少 6 字元`);
              } else {
                db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(
                  hashPassword(passwordRaw),
                  user.id
                );
              }
            }
            setUserDepartmentsList(user.id, depts.length ? depts : [primary].filter(Boolean), primary);
            applyLeaveUsed(user.id, user);
            updated += 1;
          } else {
            const pwd = passwordRaw || 'pass1234';
            if (pwd.length < 6) {
              errors.push(`第 ${i + 2} 列（${username}）：密碼至少 6 字元`);
              continue;
            }
            const info = db
              .prepare(
                `INSERT INTO users (username, password_hash, name, email, phone, extension, department, role, permissions_json, active, hire_date, sl_used_days, sl_used_hours, leave_used_json)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', 1, ?, 0, 0, '{}')`
              )
              .run(
                username,
                hashPassword(pwd),
                name,
                email || null,
                phone || null,
                extension || null,
                primary || '',
                role,
                hireDate
              );
            const newId = Number(info.lastInsertRowid);
            setUserDepartmentsList(newId, depts.length ? depts : [primary].filter(Boolean), primary);
            applyLeaveUsed(newId, null);
            created += 1;
          }
        } catch (e) {
          errors.push(`第 ${i + 2} 列（${username}）：${e.message || '失敗'}`);
        }
      }

      // cleanup uploaded temp file
      try {
        fs.unlinkSync(req.file.path);
      } catch {
        /* ignore */
      }

      res.json({
        ok: true,
        created,
        updated,
        errors,
        message: `匯入完成：新增 ${created}、更新 ${updated}${errors.length ? `、${errors.length} 筆錯誤` : ''}`,
      });
    } catch (e) {
      console.error(e);
      try {
        if (req.file?.path) fs.unlinkSync(req.file.path);
      } catch {
        /* ignore */
      }
      res.status(500).json({ error: '匯入失敗：' + (e.message || '未知錯誤') });
    }
  }
);

// ---------- Workflows（流程定義、範本匯入匯出、PDF底圖模版 - Modular Route）----------
registerWorkflowRoutes(app, {
  db,
  authMiddleware,
  requirePerm,
  userHasPermission,
  serializeWorkflow,
  parseSteps,
  validateStepTemplate,
  parseFormFields,
  resolveFinalNotifyJson,
  enrichFinalNotifyUsers,
});

// ---------- 報表匯出（請假 Excel、單據多維度 Excel - Modular Route）----------
registerReportRoutes(app, {
  db,
  authMiddleware,
  requirePerm,
  userHasPermission,
  canDeleteLeaveRequests,
  isRequestRelatedToUser,
  isLeaveApprovalRequest,
  isDraftOwner,
});

// ---------- Approval requests ----------
/** 單據是否與登入使用者有關（申請人、歷程簽核人、步驟指定簽核人、或財務部對信用額度單） */
function isDraftOwner(row, userId) {
  const uid = Number(userId);
  if (!row || !uid) return false;
  if (Number(row.requester_id) === uid) return true;
  if (row.submitted_by && Number(row.submitted_by) === uid) return true;
  return false;
}

function isRequestRelatedToUser(row, userId) {
  const uid = Number(userId);
  if (!row || !uid) return false;
  if (Number(row.requester_id) === uid) return true;
  if (row.submitted_by && Number(row.submitted_by) === uid) return true;
  // 草稿尚未送出：不可依流程模板簽核人名單公開（會議記錄與會人員池會讓全公司看到）
  if (String(row.status) === 'draft') return false;
  // 曾對此單操作
  const acted = db
    .prepare(
      `SELECT id FROM approval_actions WHERE request_id = ? AND actor_id = ? LIMIT 1`
    )
    .get(row.id, uid);
  if (acted) return true;

  // 財務部同仁或具建檔確認權限者，對信用額度申請單預設具備查看權限
  if (isCreditLimitRequestRow(row)) {
    const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(uid);
    if (isFinanceUser(user)) return true;
  }

  // 最終核准系統通知收件人
  const fn = db
    .prepare(
      `SELECT id FROM final_notify_receipts WHERE request_id = ? AND user_id = ? LIMIT 1`
    )
    .get(row.id, uid);
  if (fn) return true;

  // 步驟：優先已解析的 steps，否則由快照／流程模板載入
  const steps = Array.isArray(row.steps) && row.steps.length
    ? row.steps
    : loadStepsForRequest(row);
  const status = String(row.status || '');
  const cur = Number(row.current_step) || 0;
  // 進行中／駁回／取消：尚未輪到的關卡人員不可看簽核紀錄
  const hideFuture =
    status === 'pending' || status === 'rejected' || status === 'cancelled';
  for (const s of steps) {
    if (hideFuture && Number(s.order) > cur) continue;
    if ((s.approverIds || []).map(Number).includes(uid)) return true;
  }
  // 目前步驟可代簽 → 相關
  if (status === 'pending') {
    const step = findStepByOrder(steps, row.current_step);
    if (canUserApproveStep(uid, step, row.id)) return true;
  }
  return false;
}

app.get('/api/requests', authMiddleware, (req, res) => {
  const filter = req.query.filter || 'related'; // related | mine | pending_me | done | all
  const uid = req.user.id;
  let rows;

  if (filter === 'mine') {
    // 本人申請或我代申請的單
    rows = db
      .prepare(
        `SELECT r.*, w.name AS workflow_name, u.name AS requester_name
         FROM approval_requests r
         JOIN workflows w ON w.id = r.workflow_id
         JOIN users u ON u.id = r.requester_id
         WHERE r.requester_id = ? OR r.submitted_by = ?
         ORDER BY r.updated_at DESC`
      )
      .all(uid, uid);
  } else if (filter === 'pending_finance_confirm') {
    // 待財務部授信額度建檔確認（總經理已核准，財務部尚未點確認）
    rows = db
      .prepare(
        `SELECT r.*, w.name AS workflow_name, w.steps_json, r.steps_snapshot_json,
                u.name AS requester_name
         FROM approval_requests r
         JOIN workflows w ON w.id = r.workflow_id
         JOIN users u ON u.id = r.requester_id
         WHERE r.status = 'approved'
           AND (IFNULL(w.name, '') LIKE '%信用額度%' OR r.title LIKE '%信用額度%')
           AND r.id NOT IN (
             SELECT request_id FROM approval_actions WHERE step_name = '財務部額度建檔確認'
           )
         ORDER BY r.completed_at DESC, r.updated_at DESC`
      )
      .all();
  } else if (filter === 'pending_me') {
    // 待我簽核（使用送出時步驟快照，勿用流程模板）
    const allPending = db
      .prepare(
        `SELECT r.*, w.name AS workflow_name, w.steps_json, r.steps_snapshot_json,
                u.name AS requester_name
         FROM approval_requests r
         JOIN workflows w ON w.id = r.workflow_id
         JOIN users u ON u.id = r.requester_id
         WHERE r.status = 'pending'
         ORDER BY r.updated_at DESC`
      )
      .all();
    rows = allPending.filter((r) => {
      const steps = loadStepsForRequest(r);
      const step = findStepByOrder(steps, r.current_step);
      return canUserApproveStep(uid, step, r.id);
    });

    // 財務部：併入待建檔確認的已核准信用額度單
    if (isFinanceUser(req.user)) {
      const finReqs = db
        .prepare(
          `SELECT r.*, w.name AS workflow_name, w.steps_json, r.steps_snapshot_json,
                  u.name AS requester_name
           FROM approval_requests r
           JOIN workflows w ON w.id = r.workflow_id
           JOIN users u ON u.id = r.requester_id
           WHERE r.status = 'approved'
             AND (IFNULL(w.name, '') LIKE '%信用額度%' OR r.title LIKE '%信用額度%')
             AND r.id NOT IN (
               SELECT request_id FROM approval_actions WHERE step_name = '財務部額度建檔確認'
             )
           ORDER BY r.completed_at DESC, r.updated_at DESC`
        )
        .all();
      const existingIds = new Set(rows.map((x) => x.id));
      for (const fr of finReqs) {
        if (!existingIds.has(fr.id)) rows.push(fr);
      }
    }

    // 申請人待確認財務建檔
    const ackReqs = db
      .prepare(
        `SELECT r.*, w.name AS workflow_name, w.steps_json, r.steps_snapshot_json,
                u.name AS requester_name
         FROM approval_requests r
         JOIN workflows w ON w.id = r.workflow_id
         JOIN users u ON u.id = r.requester_id
         WHERE r.status = 'approved'
           AND r.requester_id = ?
           AND (IFNULL(w.name, '') LIKE '%信用額度%' OR r.title LIKE '%信用額度%')
           AND r.id IN (
             SELECT request_id FROM approval_actions WHERE step_name = '財務部額度建檔確認'
           )
           AND r.id NOT IN (
             SELECT request_id FROM approval_actions WHERE step_name = '申請人建檔確認'
           )
         ORDER BY r.completed_at DESC, r.updated_at DESC`
      )
      .all(uid);
    const existingIdsAck = new Set(rows.map((x) => x.id));
    for (const ar of ackReqs) {
      if (!existingIdsAck.has(ar.id)) rows.push(ar);
    }

    // 最終核准系統通知：待我確認收到
    const fnReqs = getPendingFinalNotifyRequests(uid);
    const existingIdsFn = new Set(rows.map((x) => x.id));
    for (const fr of fnReqs) {
      if (!existingIdsFn.has(fr.id)) {
        rows.push({
          ...fr,
          needsFinalNotifyAck: true,
          final_notify_label: fr.final_notify_label,
        });
      } else {
        const hit = rows.find((x) => x.id === fr.id);
        if (hit) {
          hit.needsFinalNotifyAck = true;
          hit.final_notify_label = fr.final_notify_label;
        }
      }
    }
  } else if (filter === 'pending_final_notify') {
    rows = getPendingFinalNotifyRequests(uid).map((fr) => ({
      ...fr,
      needsFinalNotifyAck: true,
      final_notify_label: fr.final_notify_label,
    }));
  } else if (filter === 'done') {
    // 已結案：預設僅本人相關；records_all／leave_delete（請假）／管理員可擴大範圍
    const allDone = db
      .prepare(
        `SELECT r.*, w.name AS workflow_name, w.steps_json, r.steps_snapshot_json,
                u.name AS requester_name
         FROM approval_requests r
         JOIN workflows w ON w.id = r.workflow_id
         JOIN users u ON u.id = r.requester_id
         WHERE r.status IN ('approved', 'rejected', 'cancelled')
         ORDER BY r.completed_at DESC, r.updated_at DESC
         LIMIT 800`
      )
      .all();
    const seeAll =
      req.user.role === 'admin' || userHasPermission(uid, 'records_all');
    const seeAllLeave = canDeleteLeaveRequests(req.user);
    rows = seeAll
      ? allDone
      : allDone.filter(
          (r) =>
            isRequestRelatedToUser(r, uid) ||
            (seeAllLeave && isLeaveApprovalRequest(r))
        );
  } else {
    // related / all：預設僅本人相關；records_all／leave_delete（請假）／管理員可擴大範圍
    const candidates = db
      .prepare(
        `SELECT r.*, w.name AS workflow_name, w.steps_json, r.steps_snapshot_json,
                u.name AS requester_name
         FROM approval_requests r
         JOIN workflows w ON w.id = r.workflow_id
         JOIN users u ON u.id = r.requester_id
         ORDER BY r.updated_at DESC
         LIMIT 800`
      )
      .all();
    const seeAll =
      req.user.role === 'admin' || userHasPermission(uid, 'records_all');
    const seeAllLeave = canDeleteLeaveRequests(req.user);
    rows = seeAll
      ? candidates
      : candidates.filter(
          (r) =>
            isRequestRelatedToUser(r, uid) ||
            (seeAllLeave && isLeaveApprovalRequest(r))
        );
  }

  // 草稿僅申請人／代申請人可見；系統管理員除外
  if (req.user.role !== 'admin') {
    rows = rows.filter(
      (r) => String(r.status) !== 'draft' || isDraftOwner(r, uid)
    );
  }

  // ---- 進階查詢：申請類別／狀態／關鍵字／日期 ----
  const q = String(req.query.q || req.query.keyword || '')
    .trim()
    .toLowerCase();
  const workflowId = Number(req.query.workflow_id) || 0;
  const workflowName = String(
    req.query.workflow || req.query.workflow_name || req.query.category || ''
  ).trim();
  const statusQ = String(req.query.status || '')
    .trim()
    .toLowerCase();
  const dateFrom = labor.toDateOnly(req.query.dateFrom || req.query.from || '');
  const dateTo = labor.toDateOnly(req.query.dateTo || req.query.to || '');

  if (workflowId > 0) {
    rows = rows.filter((r) => Number(r.workflow_id) === workflowId);
  }
  if (workflowName) {
    rows = rows.filter((r) => String(r.workflow_name || '') === workflowName);
  }
  if (statusQ && statusQ !== 'all') {
    // 支援逗號多狀態：approved,rejected
    const statuses = statusQ.split(/[,|]/).map((s) => s.trim()).filter(Boolean);
    if (statuses.length === 1) {
      rows = rows.filter((r) => String(r.status) === statuses[0]);
    } else if (statuses.length > 1) {
      rows = rows.filter((r) => statuses.includes(String(r.status)));
    }
  }
  if (q) {
    rows = rows.filter((r) => {
      const hay = [
        r.id,
        r.title,
        r.requester_name,
        r.workflow_name,
        r.status,
      ]
        .map((x) => String(x || '').toLowerCase())
        .join(' ');
      return hay.includes(q);
    });
  }
  if (dateFrom || dateTo) {
    rows = rows.filter((r) => {
      const raw = String(r.updated_at || r.created_at || r.completed_at || '').slice(0, 10);
      const d = labor.toDateOnly(raw);
      if (!d) return false;
      if (dateFrom && d < dateFrom) return false;
      if (dateTo && d > dateTo) return false;
      return true;
    });
  }

  // 申請類別選項（目前結果集＋系統啟用流程，供前端下拉）
  const categorySet = new Set();
  for (const r of rows) {
    if (r.workflow_name) categorySet.add(String(r.workflow_name));
  }
  try {
    const wfs = db
      .prepare(
        `SELECT name FROM workflows WHERE active = 1 AND IFNULL(purged,0)=0 ORDER BY name COLLATE NOCASE`
      )
      .all();
    for (const w of wfs) if (w.name) categorySet.add(String(w.name));
  } catch {
    /* ignore */
  }

  const isAdminUser = req.user.role === 'admin';
  const canDeleteRecords = canDeleteApprovalRecords(req.user);
  const canDeleteLeave = canDeleteLeaveRequests(req.user);
  const list = rows.map((raw) => {
    const { steps_json, steps_snapshot_json, ...rest } = raw;
    const signed = hasApproverSigned(rest.id, rest);
    const isOwner = Number(rest.requester_id) === Number(uid);
    const isProxySubmitter =
      rest.submitted_by && Number(rest.submitted_by) === Number(uid);
    const isLeave = isLeaveApprovalRequest(rest);
    // 系統管理員：可刪任何狀態；請假＋leave_delete：可刪；其餘：已簽署鎖定
    const can_delete =
      isAdminUser ||
      (isLeave && canDeleteLeave) ||
      (!signed &&
        (canDeleteRecords ||
          ((isOwner || isProxySubmitter) && rest.status !== 'approved')));

    let is_proxy_pending = false;
    let proxy_principal_name = '';
    if (String(rest.status) === 'pending' && filter === 'pending_me') {
      try {
        const steps = loadStepsForRequest(raw);
        const step = findStepByOrder(steps, rest.current_step);
        const cap = agents.getApproveCapacity(
          uid,
          step,
          rest.id,
          hasApprovalForPrincipal
        );
        if (!cap.asSelf && cap.principalIds?.length) {
          is_proxy_pending = true;
          const p = agents.userBrief(cap.principalIds[0]);
          proxy_principal_name = p?.name || '';
        }
      } catch {
        /* ignore */
      }
    }

    let submitted_by_name = rest.submitted_by_name || null;
    if (rest.submitted_by && !submitted_by_name) {
      submitted_by_name = agents.userBrief(rest.submitted_by)?.name || null;
    }

    return {
      ...rest,
      approver_signed: signed,
      is_leave: isLeave,
      can_delete,
      is_proxy_pending,
      proxy_principal_name,
      is_proxy_submit: !!(
        rest.submitted_by &&
        Number(rest.submitted_by) !== Number(rest.requester_id)
      ),
      submitted_by_name,
    };
  });
  res.json({
    requests: list,
    filters: {
      q: q || '',
      workflow_id: workflowId || '',
      workflow: workflowName || '',
      status: statusQ || '',
      dateFrom: dateFrom || '',
      dateTo: dateTo || '',
    },
    categories: [...categorySet].sort((a, b) => a.localeCompare(b, 'zh-Hant')),
  });
});

/** 將指定的已核准單據 PDF 轉存為目標單據的附件 */
async function attachApprovedRequests(targetRequestId, userId, linkedIds, stepOrder = null) {
  if (!Array.isArray(linkedIds) || !linkedIds.length) return [];
  const validIds = linkedIds.map(Number).filter((n) => n > 0);
  if (!validIds.length) return [];

  const saved = [];
  for (const srcId of validIds) {
    try {
      const srcDetail = getRequestDetail(srcId);
      if (!srcDetail || srcDetail.status !== 'approved') continue;

      const pdfBuf = await pdfSign.buildApprovalPdfBuffer(srcDetail, writeApprovalPdf);
      if (!pdfBuf || !pdfBuf.length) continue;

      const pdfName = buildApprovalPdfFileName(srcDetail);
      const originalName = `已核准_${pdfName}`;
      const storedName = `${Date.now()}_linked_${srcId}_${crypto.randomBytes(6).toString('hex')}.pdf`;
      const filePath = path.join(UPLOAD_DIR, storedName);

      fs.writeFileSync(filePath, pdfBuf);

      const r = db.prepare(
        `INSERT INTO request_attachments
          (request_id, original_name, stored_name, mime_type, size_bytes, uploaded_by, step_order, source_request_id)
         VALUES (?, ?, ?, 'application/pdf', ?, ?, ?, ?)`
      ).run(
        targetRequestId,
        originalName,
        storedName,
        pdfBuf.length,
        userId,
        stepOrder != null ? Number(stepOrder) : null,
        srcId
      );

      saved.push({
        id: Number(r.lastInsertRowid),
        original_name: originalName,
        size_bytes: pdfBuf.length,
        mime_type: 'application/pdf',
        step_order: stepOrder != null ? Number(stepOrder) : null,
        source_request_id: srcId,
      });
    } catch (err) {
      console.error(`Failed to attach approved request #${srcId}:`, err);
    }
  }
  return saved;
}

/** 供「附加已核准申請單」挑選清單使用 */
app.get('/api/requests/approved-for-attach', authMiddleware, (req, res) => {
  const uid = req.user.id;
  const q = String(req.query.q || '').trim().toLowerCase();
  const limit = Math.min(Math.max(Number(req.query.limit) || 80, 1), 200);
  const excludeId = Number(req.query.exclude_id) || 0;

  const seeAll = req.user.role === 'admin' || userHasPermission(uid, 'records_all');
  const seeLeave = canDeleteLeaveRequests(req.user);

  let sql = `
    SELECT r.id, r.workflow_id, r.requester_id, r.title, r.status, r.created_at, r.updated_at, r.completed_at,
           w.name AS workflow_name, u.name AS requester_name, u.department AS requester_dept
    FROM approval_requests r
    JOIN workflows w ON w.id = r.workflow_id
    JOIN users u ON u.id = r.requester_id
    WHERE r.status = 'approved' AND (r.deleted_at IS NULL OR r.deleted_at = '')
  `;
  const params = [];
  if (excludeId > 0) {
    sql += ` AND r.id <> ?`;
    params.push(excludeId);
  }
  sql += ` ORDER BY r.completed_at DESC, r.id DESC LIMIT 500`;

  let rows = db.prepare(sql).all(...params);

  // 權限過濾：管理員或 records_all 可看全部已核准；一般使用者可選本人、同一部門、或相關單據
  if (!seeAll) {
    const userDept = req.user.department || '';
    rows = rows.filter((r) => {
      if (seeLeave && isLeaveApprovalRequest(r)) return true;
      if (userDept && r.requester_dept === userDept) return true;
      return isRequestRelatedToUser(r, uid);
    });
  }

  // 搜尋過濾（單號、主旨、流程名、申請人、部門）
  if (q) {
    rows = rows.filter((r) => {
      const text = `${r.id} ${r.title || ''} ${r.workflow_name || ''} ${r.requester_name || ''} ${r.requester_dept || ''}`.toLowerCase();
      return text.includes(q);
    });
  }

  if (rows.length > limit) {
    rows = rows.slice(0, limit);
  }

  res.json({ requests: rows });
});

app.get('/api/requests/:id', authMiddleware, (req, res) => {
  const detail = getRequestDetail(Number(req.params.id));
  if (!detail) return res.status(404).json({ error: '找不到簽核單' });
  const isLeaveReq =
    isLeaveApprovalRequest(detail) ||
    !!(
      detail.form_data &&
      (detail.form_data.leave_type ||
        detail.form_data.假別 ||
        detail.form_data.days != null)
    );
  // 詳情：本人相關，或管理員／全部紀錄／請假刪除權限（僅請假單）
  const seeAll =
    req.user.role === 'admin' || userHasPermission(req.user.id, 'records_all');
  const seeLeave = isLeaveReq && canDeleteLeaveRequests(req.user);
  if (String(detail.status) === 'draft') {
    if (!isDraftOwner(detail, req.user.id) && req.user.role !== 'admin') {
      return res.status(403).json({ error: '草稿僅申請人可查看' });
    }
  } else if (!seeAll && !seeLeave && !isRequestRelatedToUser(detail, req.user.id)) {
    return res.status(403).json({ error: '無權查看此簽核單（僅顯示與您相關的紀錄）' });
  }
  const steps = detail.steps;
  const current = findStepByOrder(steps, detail.current_step);
  const canApprove =
    detail.status === 'pending' && canUserApproveStep(req.user.id, current, detail.id);
  let actingAsProxy = null;
  if (canApprove && current) {
    const cap = agents.getApproveCapacity(
      req.user.id,
      current,
      detail.id,
      hasApprovalForPrincipal
    );
    if (!cap.asSelf && cap.principalIds?.length) {
      const pid = cap.principalIds[0];
      actingAsProxy = {
        principal_id: pid,
        principal: agents.userBrief(pid),
      };
    }
  }
  const previousStep = getPreviousStep(steps, current);
  // 目前簽核人可退回（第一關可退回申請人修改，後續關卡可退回申請人或前置關卡）
  const canReturn =
    canApprove && detail.status === 'pending';
  const canAttach = canUserAttachOnStep(req.user.id, detail);
  const isFinalStep = current ? isFinalApprovalStep(detail.steps || [], current) : false;
  const approverSigned = hasApproverSigned(detail.id, detail);
  // 草稿可取消；簽核中僅「尚無簽署人核准」可取消
  const canCancel =
    (detail.requester_id === req.user.id ||
      detail.submitted_by === req.user.id ||
      req.user.role === 'admin') &&
    (detail.status === 'draft' ||
      (detail.status === 'pending' && !approverSigned));
  // 刪除：系統管理員可刪任何狀態；請假＋leave_delete 可刪；其餘已簽署則不可
  // 具備「刪除簽核紀錄」：可刪他人／非鎖定單據；申請人可刪自己的未核准單
  const canDelete =
    req.user.role === 'admin' ||
    (isLeaveReq && canDeleteLeaveRequests(req.user)) ||
    (!approverSigned &&
      (canDeleteApprovalRecords(req.user) ||
        (detail.requester_id === req.user.id && detail.status !== 'approved')));
  // 會簽進度：目前步驟已簽 / 未簽人員
  let coApprovers = null;
  if (current && detail.status === 'pending') {
    const pendingIds = getPendingApproverIds(detail.id, current);
    const allIds = (current.approverIds || []).map(Number);
    const doneIds = allIds.filter((id) => !pendingIds.includes(id));
    const nameOf = (id) => {
      const u = db.prepare(`SELECT name FROM users WHERE id = ?`).get(id);
      return u?.name || `#${id}`;
    };
    coApprovers = {
      mode: current.mode === 'all' ? 'all' : 'any',
      all: allIds.map((id) => ({ id, name: nameOf(id) })),
      approved: doneIds.map((id) => ({ id, name: nameOf(id) })),
      pending: pendingIds.map((id) => ({ id, name: nameOf(id) })),
    };
  }

  // 人事步驟：帶入申請人年資與特休剩餘（代理人等步驟不顯示特休狀態）
  let applicantLabor = null;
  const stepFields = Array.isArray(current?.approverFields) ? current.approverFields : [];
  const isAgentStep =
    /代理/.test(String(current?.name || '')) ||
    current?.assignType === 'form_user';
  const isHrStep =
    !isAgentStep &&
    (/人事/.test(String(current?.name || '')) ||
      stepFields.some((f) =>
        /remaining_special|hr_leave|剩餘特休|假別/.test(
          String(f.id || '') + String(f.label || '')
        )
      ));

  /** 申請表單全部假別選項（人事核定下拉用） */
  function getLeaveTypeOptionsFromDetail(d) {
    const fields = d.formFields || [];
    const lf = fields.find(
      (f) => f.id === 'leave_type' || /假別/.test(String(f.label || ''))
    );
    if (Array.isArray(lf?.options) && lf.options.length) {
      return lf.options.map((o) => String(o).trim()).filter(Boolean);
    }
    // 後備完整清單
    return [
      '特別休假（特休）',
      '事假',
      '普通傷病假（病假）',
      '住院傷病假',
      '公傷病假',
      '婚假',
      '喪假',
      '產假',
      '產檢假',
      '安胎休養',
      '陪產檢及陪產假',
      '生理假',
      '家庭照顧假',
      '公假',
      '補休',
      '祭儀假',
      '其他',
    ];
  }

  /** 依人事核定假別計算剩餘日／小時建議值（僅特休自動帶入數字；其他假別留白） */
  function suggestRemainByLeaveType(lab, leaveType, thisLeaveDays) {
    const remainingBefore = lab.specialLeave ? lab.specialLeave.remaining : null;
    const remainingHoursBefore = lab.specialLeave
      ? lab.specialLeave.remainingHours
      : null;
    // 僅依「人事選定／表單假別」判斷是否特休，不用標題強制（避免誤判）
    const isSpecial = labor.isSpecialLeaveType(leaveType);
    let remainingAfter = null;
    let prefillDays = '';
    let prefillHours = '';
    if (isSpecial && lab.specialLeave) {
      if (Number.isFinite(thisLeaveDays) && thisLeaveDays > 0) {
        remainingAfter = labor.snapHalf(remainingBefore - thisLeaveDays);
      }
      const suggestRemain =
        remainingAfter != null
          ? remainingAfter
          : remainingBefore != null
            ? remainingBefore
            : null;
      if (suggestRemain != null) {
        prefillDays = String(Math.max(0, suggestRemain));
        prefillHours = String(
          labor.snapHalf(Math.max(0, suggestRemain) * labor.WORK_DAY_HOURS)
        );
      } else if (remainingHoursBefore != null) {
        prefillHours = String(remainingHoursBefore);
      }
    }
    // 非特休：不帶入數字（表格留白）
    return {
      isSpecial,
      remainingBefore,
      remainingHoursBefore,
      remainingAfter,
      suggestRemain: isSpecial
        ? remainingAfter != null
          ? remainingAfter
          : remainingBefore
        : null,
      prefillDays,
      prefillHours,
    };
  }

  // 請假：人事「假別（人事核定）」下拉帶入申請表單全部假別；移除特休小時欄
  let currentStepOut = current || null;
  if (currentStepOut && isLeaveReq) {
    const leaveOpts = getLeaveTypeOptionsFromDetail(detail);
    currentStepOut = {
      ...currentStepOut,
      approverFields: (currentStepOut.approverFields || [])
        .filter(
          (f) =>
            f &&
            f.id !== 'remaining_special_leave_hours' &&
            !/剩餘.*特休.*小時|特休.*小時/.test(String(f.label || ''))
        )
        .map((f) => {
          if (
            f.id === 'hr_leave_type' ||
            (/假別/.test(String(f.label || '')) &&
              (f.type === 'select' || f.id === 'hr_leave_type'))
          ) {
            return {
              ...f,
              type: 'select',
              options: leaveOpts.length ? leaveOpts : f.options || [],
            };
          }
          if (f.id === 'remaining_special_leave_days') {
            return {
              ...f,
              placeholder:
                f.placeholder || '例如：7 或 7.5（以日為單位，不換算小時）',
            };
          }
          return f;
        }),
    };
  }

  // 僅人事核定步驟帶入特休／假別試算；代理人簽核不顯示申請人特休狀態
  if (canApprove && isHrStep) {
    const requester = db
      .prepare(`SELECT * FROM users WHERE id = ?`)
      .get(detail.requester_id);
    if (requester) {
      const lab = labor.buildLaborSummary(requester);
      const fd = detail.form_data || {};
      const leaveType = String(fd.leave_type || fd.假別 || '').trim();
      // 本單請假量：天數與小時是同一段期間的兩種單位，不可相加
      // 優先用 days；僅當未填天數時才以 hours÷7.5 換算
      const thisDaysRaw = Number(fd.days);
      const thisHoursRaw = Number(fd.hours);
      let thisLeaveDays = null;
      if (Number.isFinite(thisDaysRaw) && thisDaysRaw > 0) {
        thisLeaveDays = labor.snapHalf(thisDaysRaw);
      } else if (Number.isFinite(thisHoursRaw) && thisHoursRaw > 0) {
        thisLeaveDays = labor.snapHalf(thisHoursRaw / labor.WORK_DAY_HOURS);
      }
      if (!(thisLeaveDays > 0)) thisLeaveDays = null;

      const calc = suggestRemainByLeaveType(lab, leaveType, thisLeaveDays);
      const leaveTypeOptions = getLeaveTypeOptionsFromDetail(detail);

      applicantLabor = {
        ...lab,
        leaveType,
        leaveTypeOptions,
        thisLeaveDays,
        thisIsSpecial: calc.isSpecial,
        remainingBefore: calc.remainingBefore,
        remainingHoursBefore: calc.remainingHoursBefore,
        remainingAfter: calc.remainingAfter,
        suggestRemainingDays: calc.suggestRemain,
        workDayHours: labor.WORK_DAY_HOURS,
        fieldPrefill: {
          hr_leave_type: leaveType || '',
          remaining_special_leave_days: calc.prefillDays,
          // 特休不再換算／帶入小時
        },
        // 前端切換假別時可本地重算（僅日數）
        remainByLeaveType: leaveTypeOptions.reduce((acc, opt) => {
          const c = suggestRemainByLeaveType(lab, opt, thisLeaveDays);
          acc[opt] = {
            days: c.prefillDays,
            isSpecial: c.isSpecial,
          };
          return acc;
        }, {}),
      };
    }
  }

  const priorSteps = (steps || [])
    .filter((s) => Number(s.order) < Number(current?.order))
    .map((s) => ({
      id: s.order,
      order: s.order,
      name: s.name || `步驟 ${s.order}`,
      label: `步驟 ${s.order}：${s.name || `第 ${s.order} 關`}`,
      type: 'step',
    }));

  const returnTargets = [
    {
      id: 'applicant',
      label: `申請人（${detail.requester_name || '原申請人'}）- 退回修改`,
      type: 'applicant',
    },
    ...priorSteps,
  ];

  res.json({
    request: detail,
    canApprove,
    canReturn,
    returnTargets,
    previousStep: previousStep
      ? {
          order: previousStep.order,
          name: previousStep.name || `步驟 ${previousStep.order}`,
        }
      : null,
    canAttach,
    isFinalStep,
    canCancel,
    canDelete,
    approverSigned,
    currentStep: currentStepOut,
    coApprovers,
    applicantLabor,
    actingAsProxy,
  });
});

/** 簽核過程補充附件（非最終審核步驟，支援檔案上傳與已核准單據關聯） */
app.post(
  '/api/requests/:id/attachments',
  authMiddleware,
  upload.array('attachments', 20),
  async (req, res) => {
    const id = Number(req.params.id);
    const detail = getRequestDetail(id);
    if (!detail) return res.status(404).json({ error: '找不到簽核單' });
    if (!canUserAttachOnStep(req.user.id, detail)) {
      return res.status(403).json({
        error: '僅非最終審核步驟的目前簽核人可新增附件',
      });
    }

    let linkedIds = [];
    try {
      linkedIds = typeof req.body?.linked_request_ids === 'string'
        ? JSON.parse(req.body.linked_request_ids || '[]')
        : (req.body?.linked_request_ids || []);
    } catch {
      linkedIds = [];
    }

    if (!req.files?.length && (!Array.isArray(linkedIds) || !linkedIds.length)) {
      return res.status(400).json({ error: '請選擇要上傳的檔案或已核准單據' });
    }
    const step = (detail.steps || []).find((s) => s.order === detail.current_step);
    const stepOrder = step?.order ?? detail.current_step;
    const saved = saveAttachments(id, req.user.id, req.files || [], stepOrder);
    const linkedSaved = await attachApprovedRequests(id, req.user.id, linkedIds, stepOrder);
    const allSaved = [...saved, ...linkedSaved];

    if (allSaved.length > 0) {
      db.prepare(
        `INSERT INTO approval_actions (request_id, step_order, step_name, actor_id, action, comment, form_data)
         VALUES (?, ?, ?, ?, 'comment', ?, '{}')`
      ).run(
        id,
        stepOrder,
        step?.name || '補充附件',
        req.user.id,
        `附加檔案 ${allSaved.length} 個：${allSaved.map((s) => s.original_name).join('、')}`
      );
      db.prepare(
        `UPDATE approval_requests SET updated_at = datetime('now', 'localtime') WHERE id = ?`
      ).run(id);
    }
    res.status(201).json({
      ok: true,
      attachments: getAttachments(id),
      saved: allSaved,
      message: `已附加 ${allSaved.length} 個附件`,
    });
  }
);

/**
 * 解析建立／更新申請的共用欄位
 * @returns {{ error?: string, asDraft?: boolean, wf?, fullFormData?, title?, content?, formFields?, templateSteps?, requester?, resolved?, notifyFlag?, prefsJson? }}
 */
function prepareRequestPayload(req, opts = {}) {
  const asDraft =
    opts.forceDraft === true ||
    req.body?.as_draft === true ||
    req.body?.as_draft === '1' ||
    req.body?.as_draft === 1 ||
    req.body?.status === 'draft';

  let workflow_id = req.body?.workflow_id;
  let title = req.body?.title;
  let content = req.body?.content;
  let form_data = req.body?.form_data;
  let notify_email = req.body?.notify_email;
  let notify_prefs = req.body?.notify_prefs;
  if (typeof form_data === 'string') {
    try {
      form_data = JSON.parse(form_data || '{}');
    } catch {
      return { error: '表單資料格式錯誤' };
    }
  }
  if (typeof notify_prefs === 'string') {
    try {
      notify_prefs = JSON.parse(notify_prefs || 'null');
    } catch {
      notify_prefs = null;
    }
  }

  if (!workflow_id) {
    return { error: '請選擇流程' };
  }
  const wf = db
    .prepare('SELECT * FROM workflows WHERE id = ? AND active = 1')
    .get(Number(workflow_id));
  if (!wf) return { error: '流程不存在或已停用' };
  const templateSteps = parseSteps(wf.steps_json);
  if (!templateSteps?.length) return { error: '流程未設定簽核步驟' };

  const formFields = parseFormFields(wf.form_fields_json);
  const validated = validateFormData(formFields, form_data, {
    skipRequired: asDraft,
  });
  if (validated.error) return { error: validated.error };

  // 合併部門主管／自選簽核（草稿時錯誤不擋）
  let fullFormData = validated.data || {};
  const withDept = mergeDeptHeadFormData(fullFormData, form_data, templateSteps);
  if (withDept.error && !asDraft) return { error: withDept.error };
  if (!withDept.error) fullFormData = withDept.data || fullFormData;

  const withPick = mergeUsersPickFormData(fullFormData, form_data, templateSteps);
  if (withPick.error && !asDraft) return { error: withPick.error };
  if (!withPick.error) fullFormData = withPick.data || fullFormData;

  const withCosign = mergeCosignFormData(fullFormData, form_data, templateSteps);
  if (withCosign.error && !asDraft) return { error: withCosign.error };
  if (!withCosign.error) fullFormData = withCosign.data || fullFormData;

  fullFormData = mergeFormTables(fullFormData, form_data);
  if (
    /會議記錄|部門月會/.test(String(wf.name || '')) ||
    formFields.some((f) => f.id === 'meeting_subject')
  ) {
    fullFormData = fillMeetingAttendeeNames(fullFormData, req.user);
  }

  const wfName = String(wf.name || '');
  const isLeave = /請假/.test(wfName);
  const isExpense = /費用|報支|報銷|請款/.test(wfName);
  const isGeneralMemo =
    /一般簽呈|簽呈/.test(wfName) &&
    !/信用額度|請假|請購|報支|出差|加班|報修/.test(wfName);
  // 一般簽呈、費用報支：使用申請人填寫的主旨（費用報支空白時才自動組成）
  if (isExpense) {
    const userTitle = String(title || '').trim();
    if (userTitle && !/^草稿\s*·/.test(userTitle)) {
      title = userTitle.slice(0, 200);
    } else if (asDraft && !userTitle) {
      title = `草稿 · ${wfName || '費用報支'}`;
    } else if (!userTitle) {
      const fd = fullFormData || {};
      const pick = [fd.subject, fd.expense_type, fd.desc]
        .map((v) => (v == null ? '' : String(v).trim()))
        .filter(Boolean)
        .map((s) => s.replace(/\s+/g, ' ').slice(0, 80));
      const base = wfName.trim() || '費用報支';
      title = (pick.length ? `${base} · ${pick[0]}` : base).slice(0, 200);
    }
  } else if (!isGeneralMemo) {
    const fd = fullFormData || {};
    if (isLeave) {
      const type = fd.leave_type || '';
      const start = String(fd.start_date || '').slice(0, 16);
      const end = String(fd.end_date || '').slice(0, 16);
      const days = fd.days != null && fd.days !== '' ? `${fd.days}日` : '';
      const hours =
        fd.hours != null && fd.hours !== '' && Number(fd.hours) > 0
          ? `${fd.hours}小時`
          : '';
      const parts = [asDraft ? '草稿 · 請假申請' : '請假申請'];
      if (type) parts.push(String(type));
      if (start || end) parts.push([start, end].filter(Boolean).join('～'));
      if (days) parts.push(days);
      if (hours) parts.push(hours);
      title = parts.join(' · ').slice(0, 200);
    } else {
      const pick = [
        fd.subject,
        fd.item_name,
        fd.purpose,
        fd.reason,
        fd.destination,
        fd.customer_name,
        fd.issue_desc,
        fd.expense_type,
        fd.desc,
        fd.ot_option,
        fd.trading_products,
      ]
        .map((v) => (v == null ? '' : String(v).trim()))
        .filter(Boolean)
        .map((s) => s.replace(/\s+/g, ' ').slice(0, 80));
      const base = wfName.trim() || '申請';
      const prefix = asDraft ? `草稿 · ${base}` : base;
      title = (pick.length ? `${prefix} · ${pick[0]}` : prefix).slice(0, 200);
    }
  } else if (asDraft && (!title || !String(title).trim())) {
    title = `草稿 · ${wfName || '一般簽呈'}`;
  }

  content = '';
  if (!title || !String(title).trim()) {
    if (asDraft) {
      title = `草稿 · ${wfName || '申請'}`;
    } else {
      return {
        error: isGeneralMemo ? '請填寫主旨' : '無法產生主旨，請檢查表單內容',
      };
    }
  }

  // 代申請：on_behalf_of_user_id / proxy_for_user_id = 被代理人（申請人）
  // 僅新建／草稿送出時生效；絕不改寫已在簽核中的 steps_snapshot
  const proxyForRaw =
    req.body?.on_behalf_of_user_id ??
    req.body?.proxy_for_user_id ??
    req.body?.proxy_for ??
    form_data?.on_behalf_of_user_id ??
    null;
  let proxyForId = Number(proxyForRaw) || 0;
  // 草稿更新未帶 proxy_for 時：若原本為代申請且仍由代申請人操作，沿用既有被代理人
  if (
    !proxyForId &&
    opts.existing &&
    opts.existing.submitted_by &&
    Number(opts.existing.submitted_by) === Number(req.user.id) &&
    Number(opts.existing.requester_id) !== Number(req.user.id)
  ) {
    proxyForId = Number(opts.existing.requester_id) || 0;
  }
  let submittedById = null;
  let requesterId = req.user.id;

  if (proxyForId && proxyForId !== Number(req.user.id)) {
    const wfNameCheck = String(wf.name || '');
    if (!/請假/.test(wfNameCheck)) {
      return { error: '目前僅支援「代申請請假」；其他流程請本人申請' };
    }
    // 政策：任何人皆可代任何啟用中同仁申請請假（不需代理人授權）
    const targetUser = db
      .prepare(`SELECT id, name, active FROM users WHERE id = ?`)
      .get(proxyForId);
    if (!targetUser || Number(targetUser.active) === 0) {
      return { error: '被代申請人帳號不存在或已停用' };
    }
    // 職務代理人可填申請人本人或代申請人；不另限制
    requesterId = proxyForId;
    submittedById = req.user.id;
  } else {
    proxyForId = 0;
  }

  const requester = db
    .prepare(
      `SELECT id, name, department, role, email, email_notify, active FROM users WHERE id = ?`
    )
    .get(requesterId);
  if (!requester || Number(requester.active) === 0) {
    return { error: '申請人資料異常或已停用' };
  }

  let resolved = { steps: templateSteps };
  if (!asDraft) {
    resolved = resolveStepsForRequest(requester, fullFormData, templateSteps);
    if (resolved.error) return { error: resolved.error };
  } else {
    // 草稿：盡量解析步驟；失敗仍用模板
    try {
      const r = resolveStepsForRequest(requester, fullFormData, templateSteps);
      if (!r.error && r.steps?.length) resolved = r;
    } catch {
      /* use template */
    }
  }

  let notifyFlag = 1;
  if (
    notify_email === 0 ||
    notify_email === false ||
    notify_email === '0' ||
    notify_email === 'false'
  ) {
    notifyFlag = 0;
  } else if (
    notify_email === 1 ||
    notify_email === true ||
    notify_email === '1' ||
    notify_email === 'true'
  ) {
    notifyFlag = 1;
  } else {
    notifyFlag = requester.email_notify === 0 ? 0 : 1;
  }

  let prefsObj = null;
  if (notifyFlag === 0) {
    prefsObj = {
      enabled: false,
      approved: false,
      rejected: false,
      step: false,
      submitted: false,
      cancelled: false,
    };
  } else if (notify_prefs && typeof notify_prefs === 'object') {
    const flag = (k) => {
      const v = notify_prefs[k];
      if (v === true || v === 1 || v === '1' || v === 'true') return true;
      if (v === false || v === 0 || v === '0' || v === 'false') return false;
      return false;
    };
    const approved = flag('approved');
    const rejected = flag('rejected');
    const step = flag('step');
    const any = approved || rejected || step;
    prefsObj = {
      enabled: any,
      approved,
      rejected,
      step,
      submitted: flag('submitted') || false,
      cancelled: flag('cancelled') || false,
    };
    if (!any) notifyFlag = 0;
  } else {
    prefsObj = {
      enabled: true,
      approved: true,
      rejected: true,
      step: true,
      submitted: true,
      cancelled: true,
    };
  }

  return {
    asDraft,
    wf,
    fullFormData,
    title: String(title).trim(),
    content: content ? String(content) : '',
    formFields,
    submittedById,
    isProxySubmit: !!submittedById,
    templateSteps,
    requester,
    resolved,
    notifyFlag,
    prefsJson: JSON.stringify(prefsObj),
  };
}

app.post('/api/requests', authMiddleware, upload.array('attachments', 20), async (req, res) => {
  const prep = prepareRequestPayload(req);
  if (prep.error) return res.status(400).json({ error: prep.error });

  const {
    asDraft,
    wf,
    fullFormData,
    title,
    content,
    formFields,
    requester,
    resolved,
    notifyFlag,
    prefsJson,
    submittedById,
    isProxySubmit,
  } = prep;

  const formJson = JSON.stringify(fullFormData || {});
  const schemaJson = JSON.stringify(formFields);
  const snapshotJson = JSON.stringify(resolved.steps || []);
  const status = asDraft ? 'draft' : 'pending';
  const currentStep = asDraft ? 0 : 1;

  const info = db
    .prepare(
      `INSERT INTO approval_requests
        (workflow_id, title, content, form_data, form_schema_json, steps_snapshot_json,
         requester_id, submitted_by, status, current_step, notify_email, notify_prefs_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      wf.id,
      title,
      content,
      formJson,
      schemaJson,
      snapshotJson,
      requester.id,
      submittedById || null,
      status,
      currentStep,
      notifyFlag,
      prefsJson
    );

  const requestId = info.lastInsertRowid;

  if (!asDraft) {
    const submitComment = isProxySubmit
      ? `代理 ${requester.name} 送出簽核申請`
      : '送出簽核申請';
    const submitStepName = isProxySubmit ? '代理申請人送出' : '申請人送出';
    db.prepare(
      `INSERT INTO approval_actions
        (request_id, step_order, step_name, actor_id, action, comment, form_data, on_behalf_of)
       VALUES (?, 0, ?, ?, 'submit', ?, '{}', ?)`
    ).run(
      requestId,
      submitStepName,
      req.user.id,
      submitComment,
      isProxySubmit ? requester.id : null
    );
  }

  try {
    saveAttachments(requestId, req.user.id, req.files || []);
    let linkedIds = [];
    try {
      linkedIds = typeof req.body?.linked_request_ids === 'string'
        ? JSON.parse(req.body.linked_request_ids || '[]')
        : (req.body?.linked_request_ids || []);
    } catch {
      linkedIds = [];
    }
    if (Array.isArray(linkedIds) && linkedIds.length) {
      await attachApprovedRequests(requestId, req.user.id, linkedIds, 0);
    }
  } catch (e) {
    console.error('save attachments', e);
  }

  const detail = getRequestDetail(requestId);
  if (!asDraft) {
    notifyCurrentApprovers(detail, 'pending', requester.name);
    if (notifyFlag) {
      fireAndForgetMail(
        'applicant-submit',
        mail.notifyApplicant(detail, 'submitted', { actorName: requester.name })
      );
    }
  }

  res.status(201).json({
    request: detail,
    message: asDraft ? '草稿已儲存' : '申請已送出',
    isDraft: asDraft,
  });
});

/**
 * 更新草稿／從草稿送出
 * body.as_draft=1 或省略且不 submit → 仍為草稿
 * body.submit=1 或 as_draft=0 → 正式送出
 */
app.put(
  '/api/requests/:id',
  authMiddleware,
  upload.array('attachments', 20),
  async (req, res) => {
    const id = Number(req.params.id);
    const existing = db
      .prepare(`SELECT * FROM approval_requests WHERE id = ?`)
      .get(id);
    if (!existing) return res.status(404).json({ error: '找不到簽核單' });
    const isDraftStatus = existing.status === 'draft';
    const isReturnedStatus = existing.status === 'returned';
    if (!isDraftStatus && !isReturnedStatus) {
      return res.status(400).json({ error: '僅草稿或退回修改單據可修改或由此送出' });
    }
    const canEditDraft =
      existing.requester_id === req.user.id ||
      existing.submitted_by === req.user.id ||
      req.user.role === 'admin';
    if (!canEditDraft) {
      return res.status(403).json({ error: '僅申請人、代申請人或管理員可編輯此單據' });
    }

    const wantSubmit =
      req.body?.submit === true ||
      req.body?.submit === '1' ||
      req.body?.submit === 1 ||
      req.body?.as_draft === false ||
      req.body?.as_draft === '0' ||
      req.body?.as_draft === 0;

    // 未傳 workflow_id 時沿用草稿原流程
    if (req.body && (req.body.workflow_id == null || req.body.workflow_id === '')) {
      req.body.workflow_id = existing.workflow_id;
    }

    const prep = prepareRequestPayload(req, {
      forceDraft: !wantSubmit,
      existing,
    });
    if (prep.error) return res.status(400).json({ error: prep.error });

    const {
      asDraft,
      wf,
      fullFormData,
      title,
      content,
      formFields,
      requester,
      resolved,
      notifyFlag,
      prefsJson,
      submittedById,
      isProxySubmit,
    } = prep;

    db.prepare(
      `UPDATE approval_requests SET
         workflow_id = ?,
         title = ?,
         content = ?,
         form_data = ?,
         form_schema_json = ?,
         steps_snapshot_json = ?,
         requester_id = ?,
         submitted_by = ?,
         status = ?,
         current_step = ?,
         notify_email = ?,
         notify_prefs_json = ?,
         updated_at = datetime('now', 'localtime')
       WHERE id = ?`
    ).run(
      wf.id,
      title,
      content,
      JSON.stringify(fullFormData || {}),
      JSON.stringify(formFields),
      JSON.stringify(resolved.steps || []),
      requester.id,
      submittedById || null,
      asDraft ? 'draft' : 'pending',
      asDraft ? 0 : 1,
      notifyFlag,
      prefsJson,
      id
    );

    if (!asDraft) {
      const isReturnedResubmit = existing.status === 'returned';
      const submitComment = isProxySubmit
        ? `代理 ${requester.name} ${isReturnedResubmit ? '重新送出簽核申請（退回修改後）' : '送出簽核申請（由草稿）'}`
        : isReturnedResubmit
          ? '重新送出簽核申請（退回修改後）'
          : '送出簽核申請（由草稿）';
      const submitStepName = isProxySubmit ? '代理申請人送出' : '申請人送出';
      db.prepare(
        `INSERT INTO approval_actions
          (request_id, step_order, step_name, actor_id, action, comment, form_data, on_behalf_of)
         VALUES (?, 0, ?, ?, 'submit', ?, '{}', ?)`
      ).run(
        id,
        submitStepName,
        req.user.id,
        submitComment,
        isProxySubmit ? requester.id : null
      );
    }

    try {
      if (req.files?.length) {
        saveAttachments(id, req.user.id, req.files);
      }
      let linkedIds = [];
      try {
        linkedIds = typeof req.body?.linked_request_ids === 'string'
          ? JSON.parse(req.body.linked_request_ids || '[]')
          : (req.body?.linked_request_ids || []);
      } catch {
        linkedIds = [];
      }
      if (Array.isArray(linkedIds) && linkedIds.length) {
        await attachApprovedRequests(id, req.user.id, linkedIds, 0);
      }
    } catch (e) {
      console.error('save attachments', e);
    }

    const detail = getRequestDetail(id);
    if (!asDraft) {
      notifyCurrentApprovers(detail, 'pending', requester.name);
      if (notifyFlag) {
        fireAndForgetMail(
          'applicant-submit',
          mail.notifyApplicant(detail, 'submitted', {
            actorName: requester.name,
          })
        );
      }
    }

    const wasReturned = existing.status === 'returned';
    res.json({
      request: detail,
      message: asDraft ? '單據已暫存' : wasReturned ? '單據已修正並重新送審' : '申請已送出',
      isDraft: asDraft,
    });
  }
);

/**
 * 申請人 Email 催辦目前步驟簽核人
 * 節流：同一單據 10 分鐘內僅能催辦一次
 */
app.post('/api/requests/:id/remind', authMiddleware, async (req, res) => {
  const id = Number(req.params.id);
  const detail = getRequestDetail(id);
  if (!detail) return res.status(404).json({ error: '找不到簽核單' });
  if (detail.status !== 'pending') {
    return res.status(400).json({ error: '僅簽核中的單據可催辦' });
  }
  if (
    detail.requester_id !== req.user.id &&
    Number(detail.submitted_by) !== Number(req.user.id) &&
    req.user.role !== 'admin'
  ) {
    return res.status(403).json({ error: '僅申請人、代申請人或管理員可寄送催辦信' });
  }
  if (!mail.isEnabled()) {
    return res.status(400).json({
      error: '系統尚未啟用 Email 提醒，請洽管理員於「帳號設定 → Email 設定」啟用',
    });
  }

  // 節流
  if (detail.last_remind_at) {
    const last = new Date(String(detail.last_remind_at).replace(' ', 'T')).getTime();
    if (!Number.isNaN(last) && Date.now() - last < 10 * 60 * 1000) {
      const waitMin = Math.ceil((10 * 60 * 1000 - (Date.now() - last)) / 60000);
      return res.status(400).json({
        error: `請稍候再催辦（約 ${waitMin} 分鐘後可再次寄送）`,
      });
    }
  }

  const steps = detail.steps || [];
  const step = findStepByOrder(steps, detail.current_step);
  if (!step) return res.status(400).json({ error: '找不到目前簽核步驟' });

  const targetIds =
    step.mode === 'all' ? getPendingApproverIds(id, step) : step.approverIds || [];
  const diag = diagnoseApproverEmails(targetIds);
  const emails = diag.filter((d) => d.ok).map((d) => d.email);
  const bad = diag.filter((d) => !d.ok);
  if (!emails.length) {
    const detailBad = bad
      .map((d) => `${d.name || d.id}：${d.reason}${d.email ? `（${d.email}）` : ''}`)
      .join('；');
    return res.status(400).json({
      error: `目前簽核人無可寄送的 Email。${detailBad || '請至帳號設定填寫真實信箱'}`,
      diagnose: diag,
    });
  }

  const actor = db.prepare(`SELECT name FROM users WHERE id = ?`).get(req.user.id);
  const result = await mail.sendApproverMails(
    detail,
    step,
    emails,
    'remind',
    actor?.name || detail.requester_name
  );

  if (!result.ok) {
    return res.status(400).json({
      error: result.error || '催辦信寄送失敗（SMTP 未成功，信未送達）',
      result,
      diagnose: diag,
    });
  }

  db.prepare(
    `UPDATE approval_requests SET last_remind_at = datetime('now', 'localtime'),
     updated_at = datetime('now', 'localtime') WHERE id = ?`
  ).run(id);

  const warnBad =
    bad.length > 0
      ? `；略過 ${bad.length} 人無有效信箱`
      : '';
  db.prepare(
    `INSERT INTO approval_actions (request_id, step_order, step_name, actor_id, action, comment, form_data)
     VALUES (?, ?, ?, ?, 'comment', ?, '{}')`
  ).run(
    id,
    step.order,
    step.name || '催辦',
    req.user.id,
    `已寄送 Email 催辦簽核人（${emails.length} 位：${emails.join('、')}${warnBad}）`
  );

  res.json({
    ok: true,
    sentTo: emails.length,
    emails,
    mode: result.mode,
    messageId: result.messageId,
    warning:
      [result.warning, bad.length ? `以下簽核人未寄出：${bad.map((b) => b.name || b.id).join('、')}` : '']
        .filter(Boolean)
        .join('；') || null,
    diagnose: diag,
    request: getRequestDetail(id),
  });
});

/** 下載附件 */
app.get('/api/attachments/:id', authMiddleware, (req, res) => {
  const att = db
    .prepare(`SELECT * FROM request_attachments WHERE id = ?`)
    .get(Number(req.params.id));
  if (!att) return res.status(404).json({ error: '找不到附件' });

  const detail = getRequestDetail(att.request_id);
  if (!detail) return res.status(404).json({ error: '找不到簽核單' });
  const seeAll =
    req.user.role === 'admin' || userHasPermission(req.user.id, 'records_all');
  if (!seeAll && !isRequestRelatedToUser(detail, req.user.id)) {
    return res.status(403).json({ error: '無權下載此附件' });
  }

  const abs = path.join(UPLOAD_DIR, att.stored_name);
  if (!fs.existsSync(abs)) return res.status(404).json({ error: '附件檔案不存在' });

  const downloadName = decodeUploadFilename(att.original_name || `file-${att.id}`);
  const ext = path.extname(String(downloadName || att.stored_name || '')).toLowerCase();
  const mime = String(att.mime_type || '').toLowerCase();
  const canInline =
    mime.includes('pdf') ||
    ext === '.pdf' ||
    mime.startsWith('image/') ||
    /\.(png|jpe?g|gif|webp|bmp)$/i.test(ext);
  const wantInline = String(req.query.inline || '') === '1';
  const disp = contentDispositionAttachment(downloadName, `file-${att.id}`);
  if (wantInline && canInline) {
    res.setHeader('Content-Disposition', disp.replace(/^attachment/i, 'inline'));
  } else {
    res.setHeader('Content-Disposition', disp);
  }
  if (att.mime_type) {
    res.setHeader('Content-Type', att.mime_type);
  } else if (ext === '.pdf') {
    res.setHeader('Content-Type', 'application/pdf');
  }
  fs.createReadStream(abs).pipe(res);
});

/**
 * 草稿階段：申請人可移除已上傳附件（重新編輯草稿時）
 */
app.delete('/api/attachments/:id', authMiddleware, (req, res) => {
  const attId = Number(req.params.id);
  const att = db
    .prepare(`SELECT * FROM request_attachments WHERE id = ?`)
    .get(attId);
  if (!att) return res.status(404).json({ error: '找不到附件' });

  const row = db
    .prepare(`SELECT id, status, requester_id, submitted_by FROM approval_requests WHERE id = ?`)
    .get(Number(att.request_id));
  if (!row) return res.status(404).json({ error: '找不到簽核單' });
  if (String(row.status) !== 'draft') {
    return res.status(400).json({ error: '僅草稿可移除附件；簽核中請於詳情頁操作' });
  }
  const canRemoveDraftAtt =
    Number(row.requester_id) === Number(req.user.id) ||
    Number(row.submitted_by) === Number(req.user.id) ||
    req.user.role === 'admin';
  if (!canRemoveDraftAtt) {
    return res.status(403).json({ error: '僅申請人或代申請人可移除此草稿附件' });
  }

  try {
    const abs = path.join(UPLOAD_DIR, att.stored_name);
    if (fs.existsSync(abs)) {
      try {
        fs.unlinkSync(abs);
      } catch (e) {
        console.warn('[attachments] unlink failed', abs, e.message);
      }
    }
    // 舊檔備份若存在一併刪
    try {
      const bak = `${abs}.bak`;
      if (fs.existsSync(bak)) fs.unlinkSync(bak);
    } catch {
      /* ignore */
    }
  } catch (e) {
    console.warn('[attachments] delete file error', e.message);
  }

  db.prepare(`DELETE FROM request_attachments WHERE id = ?`).run(attId);
  db.prepare(
    `UPDATE approval_requests SET updated_at = datetime('now', 'localtime') WHERE id = ?`
  ).run(row.id);

  res.json({
    ok: true,
    message: '已從草稿移除附件',
    attachments: getAttachments(row.id),
  });
});

// ---------- OnlyOffice 線上編輯 Word／Excel ----------
app.get('/api/onlyoffice/status', authMiddleware, (req, res) => {
  res.json(onlyoffice.publicStatus(req));
});

/**
 * 開啟編輯器設定
 * 可編輯：簽核中且為目前步驟簽核人（或管理員）
 * 可檢視：其餘有權限看單據者
 */
app.get('/api/onlyoffice/editor/:attachmentId', authMiddleware, (req, res) => {
  try {
    if (!onlyoffice.isEnabled()) {
      return res.status(503).json({
        error:
          'OnlyOffice 未啟用。請在 docker-compose 啟動 onlyoffice 服務，並設定 ONLYOFFICE_ENABLED=1',
      });
    }
    const att = db
      .prepare(`SELECT * FROM request_attachments WHERE id = ?`)
      .get(Number(req.params.attachmentId));
    if (!att) return res.status(404).json({ error: '找不到附件' });
    if (!onlyoffice.isOfficeAttachment(att)) {
      return res.status(400).json({ error: '僅 Word／Excel 等 Office 附件可線上編輯' });
    }
    const detail = getRequestDetail(att.request_id);
    if (!detail) return res.status(404).json({ error: '找不到簽核單' });
    const seeAll =
      req.user.role === 'admin' || userHasPermission(req.user.id, 'records_all');
    if (!seeAll && !isRequestRelatedToUser(detail, req.user.id)) {
      return res.status(403).json({ error: '無權開啟此附件' });
    }
    const abs = onlyoffice.resolveAttachmentPath(att);
    if (!abs) return res.status(404).json({ error: '附件檔案不存在' });

    const steps = detail.steps || [];
    const current = findStepByOrder(steps, detail.current_step);
    const isCurrentApprover =
      detail.status === 'pending' &&
      canUserApproveStep(req.user.id, current, detail.id);
    // 僅「簽核中／草稿」可編輯回存；已核准／駁回／取消 → 一律唯讀（含管理員）
    // 簽核中：目前簽核人、管理員、或申請人（非最後關）
    const canEdit =
      detail.status === 'draft'
        ? detail.requester_id === req.user.id || req.user.role === 'admin'
        : detail.status === 'pending' &&
          (isCurrentApprover ||
            req.user.role === 'admin' ||
            (detail.requester_id === req.user.id &&
              !isFinalApprovalStep(steps, current)));

    const editor = onlyoffice.buildEditorConfig({
      att: {
        ...att,
        original_name: decodeUploadFilename(att.original_name || 'file'),
      },
      user: { id: req.user.id, name: req.user.name },
      canEdit,
      requestId: detail.id,
      req,
    });
    res.json({ ok: true, ...editor, requestStatus: detail.status });
  } catch (e) {
    console.error('onlyoffice editor config', e);
    res.status(400).json({ error: e.message || '無法開啟編輯器' });
  }
});

/** Document Server 下載原始檔（token，無需使用者 JWT） */
app.get('/api/onlyoffice/file/:token', (req, res) => {
  try {
    const payload = onlyoffice.verifyFileToken(req.params.token);
    const att = db
      .prepare(`SELECT * FROM request_attachments WHERE id = ?`)
      .get(Number(payload.attachmentId));
    if (!att) return res.status(404).json({ error: '找不到附件' });
    const abs = onlyoffice.resolveAttachmentPath(att);
    if (!abs) return res.status(404).json({ error: '檔案不存在' });
    const name = decodeUploadFilename(att.original_name || `file-${att.id}`);
    res.setHeader(
      'Content-Disposition',
      contentDispositionAttachment(name, `file-${att.id}`)
    );
    if (att.mime_type) res.setHeader('Content-Type', att.mime_type);
    else res.setHeader('Content-Type', 'application/octet-stream');
    fs.createReadStream(abs).pipe(res);
  } catch (e) {
    res.status(403).json({ error: '檔案連結無效或已過期' });
  }
});

/**
 * OnlyOffice 儲存 callback
 * 必須回傳 { error: 0 } JSON
 */
app.post('/api/onlyoffice/callback', express.json({ limit: '2mb' }), async (req, res) => {
  const respond = (error = 0) => res.json({ error });
  try {
    const token = req.query.token || req.body?.token;
    if (!token) {
      console.warn('[onlyoffice] callback missing token');
      return respond(1);
    }
    let payload;
    try {
      payload = onlyoffice.verifyCallbackToken(String(token));
    } catch (e) {
      console.warn('[onlyoffice] callback token invalid', e.message);
      return respond(1);
    }
    const result = await onlyoffice.handleCallback(req.body || {}, payload, db);
    if (!result.handled || result.error) {
      console.warn('[onlyoffice] callback fail', result.error);
      return respond(1);
    }
    return respond(0);
  } catch (e) {
    console.error('[onlyoffice] callback error', e);
    return respond(1);
  }
});

function executeSingleApproveCore(id, actorUser, { comment = '', stepFormData = {}, files = [] } = {}) {
  const detail = getRequestDetail(id);
  if (!detail) return { error: '找不到簽核單', status: 404 };
  if (detail.status !== 'pending') return { error: '此單據不在簽核中', status: 400 };

  const steps = detail.steps;
  const step = findStepByOrder(steps, detail.current_step);
  if (!canUserApproveStep(actorUser.id, step, id)) {
    return { error: '您不是目前步驟的簽核人，或已簽核過', status: 403 };
  }
  const behalf = resolveApproveBehalf(actorUser.id, step, id);
  if (behalf.error) {
    return { error: behalf.error, status: 403 };
  }
  const onBehalfOf = behalf.onBehalfOf || null;

  // 中間步驟可隨簽核一併上傳附件；最終審核者不可
  if (files?.length) {
    if (isFinalApprovalStep(steps, step)) {
      return { error: '最終審核步驟不可新增附件', status: 400 };
    }
    saveAttachments(id, actorUser.id, files, step?.order);
  }

  // 簽核步驟附加表單（如人事：剩餘特休、IT報修查檢表、信用額度核定）
  let actionFormJson = '{}';
  let fields = Array.isArray(step?.approverFields) ? step.approverFields : [];
  if (isItRepairWorkflowName(detail.workflow_name)) {
    fields = ensureItRepairApproverFields(fields);
  }
  if (fields.length) {
    const rawStep = (stepFormData && typeof stepFormData === 'object') ? { ...stepFormData } : {};
    const hrType = String(
      rawStep.hr_leave_type || rawStep.假別 || ''
    ).trim();

    // 假別選項：與詳情頁一致，帶入申請表單全部假別
    const leaveFieldOpts = (() => {
      const ff = detail.formFields || [];
      const lf = ff.find(
        (f) => f.id === 'leave_type' || /假別/.test(String(f.label || ''))
      );
      if (Array.isArray(lf?.options) && lf.options.length) {
        return lf.options.map((o) => String(o).trim()).filter(Boolean);
      }
      return [
        '特別休假（特休）',
        '事假',
        '普通傷病假（病假）',
        '住院傷病假',
        '公傷病假',
        '婚假',
        '喪假',
        '產假',
        '產檢假',
        '安胎休養',
        '陪產檢及陪產假',
        '生理假',
        '家庭照顧假',
        '公假',
        '補休',
        '祭儀假',
        '其他',
      ];
    })();

    // 特休不以小時計算：略過剩餘特休小時欄
    fields = fields
      .filter(
        (f) =>
          f &&
          f.id !== 'remaining_special_leave_hours' &&
          !(/剩餘.*特休.*小時|特休.*換算.*小時/.test(String(f.label || '')))
      )
      .map((f) => {
        let next = { ...f };
        if (
          f.id === 'hr_leave_type' ||
          (/假別/.test(String(f.label || '')) && f.type === 'select')
        ) {
          const merged = [
            ...new Set(
              [
                ...(Array.isArray(f.options) ? f.options.map(String) : []),
                ...leaveFieldOpts,
                String(detail.form_data?.leave_type || '').trim(),
                hrType,
              ].filter(Boolean)
            ),
          ];
          next = { ...next, type: 'select', options: merged };
        }
        if (
          hrType &&
          !labor.isSpecialLeaveType(hrType) &&
          (f.id === 'remaining_special_leave_days' ||
            /剩餘.*日數/.test(String(f.label || '')))
        ) {
          next = { ...next, required: false };
        }
        return next;
      });

    // 提交時去掉殘留的小時欄
    if (rawStep && typeof rawStep === 'object') {
      delete rawStep.remaining_special_leave_hours;
    }

    const validated = validateFormData(fields, rawStep);
    if (validated.error) {
      return {
        error: `步驟「${step.name || step.order}」需填寫審核欄位：${validated.error}`,
        status: 400,
        requiresFields: true,
      };
    }
    let stepData = validated.data || {};
    if (isItRepairWorkflowName(detail.workflow_name)) {
      for (const cid of IT_REPAIR_CHECK_IDS) {
        if (!isItRepairNoncompliantValue(rawStep[cid] || stepData[cid])) continue;
        const note = String(
          stepData[itRepairNoteId(cid)] || rawStep[itRepairNoteId(cid)] || ''
        ).trim();
        if (!note) {
          const f = (fields || []).find((x) => x && x.id === cid);
          const item = itRepairNoteLabel(f || { id: cid, label: cid }).replace(/不符合說明$/, '');
          return {
            error: `「${item}」不符合時，請填寫不符合說明`,
            status: 400,
            requiresFields: true,
          };
        }
      }
    }
    // 信用額度：核決欄位一律正規化為「元」（防止把萬誤當元）
    if (isCreditLimitRequestRow(detail)) {
      const norm = normalizeCreditStepFormData(stepData, detail);
      stepData = norm.data;
      const limitKeys = [
        'requested_credit_limit',
        'vp_suggested_limit',
        'gm_approved_limit',
      ];
      for (const k of limitKeys) {
        if (stepData[k] == null || stepData[k] === '') continue;
        const yuan = Number(stepData[k]);
        const ref = parseCreditAmountToYuan(
          detail.approver_data?.requested_credit_limit ||
            stepData.requested_credit_limit
        );
        if (
          Number.isFinite(yuan) &&
          yuan > 0 &&
          yuan < 1000 &&
          ref != null &&
          ref >= 10000 &&
          yuan * 10000 !== ref &&
          Math.round(ref / 10000) !== yuan
        ) {
          return {
            error: `「${k.includes('vp') ? '建議' : k.includes('gm') ? '核定' : '申請'}額度」請以「元」填寫（例：25 萬元請填 250000）。目前值 ${yuan} 元過低，疑似誤用「萬」為單位。`,
            status: 400,
            requiresFields: true,
          };
        }
      }
    }
    actionFormJson = JSON.stringify(stepData);
    // 合併到申請單的 approver_data_json
    let merged = {};
    try {
      merged = JSON.parse(
        db.prepare(`SELECT approver_data_json FROM approval_requests WHERE id = ?`).get(id)
          ?.approver_data_json || '{}'
      );
    } catch {
      merged = {};
    }
    merged[`step_${step.order}`] = {
      step_name: step.name,
      data: stepData,
      by: actorUser.id,
      at: new Date().toISOString(),
    };
    Object.assign(merged, stepData);
    db.prepare(
      `UPDATE approval_requests SET approver_data_json = ?, updated_at = datetime('now','localtime') WHERE id = ?`
    ).run(JSON.stringify(merged), id);
  }

  // approve（代簽時 on_behalf_of＝被代理人／正職簽核人）
  let approveComment = comment || '同意';
  if (onBehalfOf) {
    const principal = agents.userBrief(onBehalfOf);
    const pName = principal?.name || `#${onBehalfOf}`;
    approveComment = `代理 ${pName} 核准${comment ? `：${comment}` : ''}`;
  }
  db.prepare(
    `INSERT INTO approval_actions
      (request_id, step_order, step_name, actor_id, action, comment, form_data, on_behalf_of)
     VALUES (?, ?, ?, ?, 'approve', ?, ?, ?)`
  ).run(
    id,
    step.order,
    step.name,
    actorUser.id,
    approveComment,
    actionFormJson,
    onBehalfOf
  );

  let mailEvent = null; // approved | step | waiting_co
  let nextStepName = '';
  /** 信用額度：副總 ≤1,000,000 元略過總經理 */
  let creditSkipGmNote = '';
  let creditFinalByVgm = false;
  if (isStepComplete(id, step)) {
    const idx = steps.findIndex((s) => Number(s.order) === Number(step.order));
    let next = idx >= 0 ? steps[idx + 1] : null;

    if (
      next &&
      isCreditLimitRequestRow(detail) &&
      isCreditVgmStep(step)
    ) {
      let stepData = {};
      try {
        stepData = JSON.parse(actionFormJson || '{}') || {};
      } catch {
        stepData = {};
      }
      let adFresh = {};
      try {
        adFresh = JSON.parse(
          db
            .prepare(`SELECT approver_data_json FROM approval_requests WHERE id = ?`)
            .get(id)?.approver_data_json || '{}'
        );
      } catch {
        adFresh = {};
      }
      const { skipGm, yuan, nextIndex } = creditLimitNextAfterVgm(
        steps,
        idx,
        { ...detail, approver_data: adFresh },
        stepData
      );
      const fmtYuan = (n) =>
        Number.isFinite(n)
          ? `${Number(n).toLocaleString('zh-TW')} 元`
          : '';
      if (skipGm) {
        creditSkipGmNote =
          yuan != null
            ? `核決條件：建議／申請額度 ${fmtYuan(yuan)} ≤ ${fmtYuan(CREDIT_VGM_MAX_YUAN)}，略過總經理核定，流程結案`
            : `核決條件：額度在副總核決權限內（≤ ${fmtYuan(CREDIT_VGM_MAX_YUAN)}），略過總經理核定，流程結案`;
        db.prepare(
          `INSERT INTO approval_actions (request_id, step_order, step_name, actor_id, action, comment, form_data)
           VALUES (?, ?, ?, ?, 'comment', ?, '{}')`
        ).run(
          id,
          step.order,
          '核決條件',
          actorUser.id,
          creditSkipGmNote
        );
        next = nextIndex < steps.length ? steps[nextIndex] : null;
        if (!next) creditFinalByVgm = true;
      } else if (yuan != null && yuan > CREDIT_VGM_MAX_YUAN && isCreditGmStep(next)) {
        creditSkipGmNote = `核決條件：額度 ${fmtYuan(yuan)} > ${fmtYuan(CREDIT_VGM_MAX_YUAN)}，進入總經理核定`;
      }
    }

    if (next) {
      db.prepare(
        `UPDATE approval_requests SET current_step = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`
      ).run(next.order, id);
      mailEvent = 'step';
      nextStepName = next.name || `步驟 ${next.order}`;
    } else {
      db.prepare(
        `UPDATE approval_requests SET status = 'approved', completed_at = datetime('now', 'localtime'),
         updated_at = datetime('now', 'localtime') WHERE id = ?`
      ).run(id);
      mailEvent = 'approved';
    }
  } else {
    db.prepare(
      `UPDATE approval_requests SET updated_at = datetime('now', 'localtime') WHERE id = ?`
    ).run(id);
    mailEvent = 'waiting_co';
  }

  let after = getRequestDetail(id);
  const actor = db.prepare(`SELECT name FROM users WHERE id = ?`).get(actorUser.id);
  let message = '已核准';
  if (mailEvent === 'step' && creditSkipGmNote && /總經理/.test(nextStepName)) {
    message = `已核示。${creditSkipGmNote}`;
  } else if (mailEvent === 'step' && nextStepName) {
    message = `已核准，進入下一步：${nextStepName}`;
  }
  if (mailEvent === 'approved') {
    const isCredit = isCreditLimitRequestRow(after);
    const finalNotify = enrichFinalNotifyUsers(
      after.finalNotify ||
        workflowModule.parseFinalNotifyJson(
          db
            .prepare(`SELECT final_notify_json FROM workflows WHERE id = ?`)
            .get(after.workflow_id)?.final_notify_json
        )
    );
    const finalNotifyOn = Boolean(finalNotify.enabled);
    const finalNotifyCount = (finalNotify.userIds || []).length;
    const finalNotifyApplies = workflowModule.shouldApplyFinalNotify(
      finalNotify,
      after.requester_id
    );

    if (finalNotifyApplies && finalNotifyCount) {
      message = isCredit
        ? creditFinalByVgm
          ? `副總經理已核決完成（≤1,000,000 元無須總經理），表單正式「已核准」！系統將通知 ${finalNotifyCount} 位選定人員。`
          : `總經理已完成核定，表單正式「已核准」！系統將通知 ${finalNotifyCount} 位選定人員。`
        : `已核准，簽核流程完成；將系統通知 ${finalNotifyCount} 位選定人員`;
    } else if (finalNotifyOn && !finalNotifyApplies) {
      message = isCredit
        ? creditFinalByVgm
          ? `副總經理已核決完成（≤1,000,000 元無須總經理），表單正式「已核准」！（此申請人不在最終通知範圍）`
          : '總經理已完成核定，表單正式「已核准」！（此申請人不在最終通知範圍）'
        : '已核准，簽核流程完成（此申請人不在最終通知範圍）';
    } else if (isCredit) {
      message = creditFinalByVgm
        ? `副總經理已核決完成（≤1,000,000 元無須總經理），表單正式「已核准」！系統將通知財務部建檔。`
        : '總經理已完成核定，表單正式「已核准」！系統將通知財務部建檔。';
    } else {
      message = '已核准，簽核流程完成';
    }

    fireAndForgetMail(
      'applicant-approved',
      mail.notifyApplicant(after, 'approved', {
        actorName: actor?.name,
        comment: comment || '同意',
      })
    );

    if (finalNotifyApplies) {
      try {
        const created = createFinalNotifyReceipts(
          id,
          finalNotify,
          actorUser.id,
          after.requester_id
        );
        if (created.created > 0) {
          message = isCredit
            ? creditFinalByVgm
              ? `副總經理已核決完成（≤1,000,000 元無須總經理），表單正式「已核准」！已在系統通知 ${created.created} 位選定人員（待確認收到）。`
              : `總經理已完成核定，表單正式「已核准」！已在系統通知 ${created.created} 位選定人員（待確認收到）。`
            : `已核准，簽核流程完成；已在系統通知 ${created.created} 位選定人員（待確認收到）`;
        } else if (created.skipped && created.reason === 'applicant_not_in_scope') {
          message = isCredit
            ? creditFinalByVgm
              ? `副總經理已核決完成（≤1,000,000 元無須總經理），表單正式「已核准」！（此申請人不在最終通知對象範圍內）`
              : '總經理已完成核定，表單正式「已核准」！（此申請人不在最終通知對象範圍內）'
            : '已核准，簽核流程完成（此申請人不在最終通知對象範圍內）';
        }
        after = getRequestDetail(id);
      } catch (fnErr) {
        console.error('[final-notify] create receipts failed', fnErr);
        message = isCredit
          ? '總經理已完成核定，表單正式「已核准」！（系統通知寫入失敗，請管理員檢查）'
          : '已核准，簽核流程完成（系統通知寫入失敗，請管理員檢查）';
      }
    }

    if (isCredit && !finalNotifyOn && mail.sendCcNotice) {
      const finUsers = db
        .prepare(`SELECT * FROM users WHERE active = 1`)
        .all()
        .filter((u) => isFinanceUser(u) && u.role !== 'admin');
      const targets = finUsers.length
        ? finUsers
        : db
            .prepare(`SELECT * FROM users WHERE active = 1`)
            .all()
            .filter((u) => isFinanceUser(u));
      for (const fu of targets) {
        const email = String(fu.email || '').trim();
        if (!email || (mail.isPlaceholderEmail && mail.isPlaceholderEmail(email))) {
          continue;
        }
        fireAndForgetMail(
          'finance-cc-credit',
          mail.sendCcNotice({
            to: email,
            toName: fu.name,
            request: after,
            deptName: '財務部（授信額度建檔）',
            actorName: actor?.name,
            kind: 'final_approved',
          })
        );
      }
    }
  } else if (mailEvent === 'step') {
    message = `已核准，已進入下一步「${nextStepName}」並通知簽核人`;
    fireAndForgetMail(
      'applicant-step',
      mail.notifyApplicant(after, 'step', {
        actorName: actor?.name,
        comment: comment || '',
      })
    );
    notifyCurrentApprovers(after, 'pending', actor?.name);
  } else if (mailEvent === 'waiting_co') {
    const pendingIds = getPendingApproverIds(id, step);
    const names = pendingIds.map((aid) => {
      const u = db.prepare(`SELECT name FROM users WHERE id = ?`).get(aid);
      return u?.name || `#${aid}`;
    });
    message = names.length
      ? `已核准；此步驟為會簽，尚待：${names.join('、')}`
      : '已核准；此步驟尚待其他簽核人';
  }

  return { ok: true, request: after, message, mailEvent, nextStepName };
}

app.post(
  '/api/requests/:id/action',
  authMiddleware,
  upload.array('attachments', 20),
  (req, res) => {
  const id = Number(req.params.id);
  let { action, comment, step_form_data: stepFormData } = req.body || {};
  if (typeof stepFormData === 'string') {
    try {
      stepFormData = JSON.parse(stepFormData || '{}');
    } catch {
      stepFormData = {};
    }
  }
  const allowed = ['approve', 'reject', 'cancel', 'return'];
  if (!allowed.includes(action)) {
    return res.status(400).json({ error: '不支援的操作' });
  }

  const detail = getRequestDetail(id);
  if (!detail) return res.status(404).json({ error: '找不到簽核單' });

  if (action === 'cancel') {
    if (
      detail.requester_id !== req.user.id &&
      detail.submitted_by !== req.user.id &&
      req.user.role !== 'admin'
    ) {
      return res.status(403).json({ error: '僅申請人、代申請人或管理員可取消' });
    }
    if (!['pending', 'draft'].includes(detail.status)) {
      return res.status(400).json({ error: '此單據無法取消' });
    }
    // 簽核中且已有簽署人核准 → 不可取消
    if (detail.status === 'pending' && hasApproverSigned(id, detail)) {
      return res.status(400).json({ error: MSG_LOCKED_AFTER_SIGN });
    }
    db.prepare(
      `UPDATE approval_requests SET status = 'cancelled', completed_at = datetime('now', 'localtime'),
       updated_at = datetime('now', 'localtime') WHERE id = ?`
    ).run(id);
    db.prepare(
      `INSERT INTO approval_actions (request_id, step_order, step_name, actor_id, action, comment, form_data)
       VALUES (?, ?, '取消', ?, 'cancel', ?, '{}')`
    ).run(id, detail.current_step, req.user.id, comment || '取消申請');
    const after = getRequestDetail(id);
    const actor = db.prepare(`SELECT name FROM users WHERE id = ?`).get(req.user.id);
    fireAndForgetMail(
      'applicant-cancel',
      mail.notifyApplicant(after, 'cancelled', {
        actorName: actor?.name,
        comment: comment || '取消申請',
      })
    );
    return res.json({ request: after });
  }

  if (action === 'approve') {
    const result = executeSingleApproveCore(id, req.user, {
      comment,
      stepFormData,
      files: req.files,
    });
    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    return res.json(result);
  }

  if (detail.status !== 'pending') {
    return res.status(400).json({ error: '此單據不在簽核中' });
  }

  const steps = detail.steps;
  const step = findStepByOrder(steps, detail.current_step);
  if (!canUserApproveStep(req.user.id, step, id)) {
    return res.status(403).json({ error: '您不是目前步驟的簽核人，或已簽核過' });
  }
  const behalf = resolveApproveBehalf(req.user.id, step, id);
  if (behalf.error) {
    return res.status(403).json({ error: behalf.error });
  }
  const onBehalfOf = behalf.onBehalfOf || null;

  // 中間步驟可隨簽核一併上傳附件；最終審核者不可
  if (req.files?.length) {
    if (isFinalApprovalStep(steps, step)) {
      return res.status(400).json({ error: '最終審核步驟不可新增附件' });
    }
    saveAttachments(id, req.user.id, req.files, step?.order);
  }

  if (action === 'reject') {
    db.prepare(
      `UPDATE approval_requests SET status = 'rejected', completed_at = datetime('now', 'localtime'),
       updated_at = datetime('now', 'localtime') WHERE id = ?`
    ).run(id);
    let rejectComment = comment || '駁回';
    if (onBehalfOf) {
      const pName = agents.userBrief(onBehalfOf)?.name || `#${onBehalfOf}`;
      rejectComment = `代理 ${pName} 駁回${comment ? `：${comment}` : ''}`;
    }
    db.prepare(
      `INSERT INTO approval_actions
        (request_id, step_order, step_name, actor_id, action, comment, form_data, on_behalf_of)
       VALUES (?, ?, ?, ?, 'reject', ?, '{}', ?)`
    ).run(
      id,
      step.order,
      step.name,
      req.user.id,
      rejectComment,
      onBehalfOf
    );
    const after = getRequestDetail(id);
    const actor = db.prepare(`SELECT name FROM users WHERE id = ?`).get(req.user.id);
    fireAndForgetMail(
      'applicant-reject',
      mail.notifyApplicant(after, 'rejected', {
        actorName: actor?.name,
        comment: comment || '駁回',
      })
    );
    return res.json({ request: after });
  }

  // return：退回上一位、指定關卡或退回申請人修改
  if (action === 'return') {
    const targetStepParam = req.body?.target_step;
    const isToApplicant =
      targetStepParam === 'applicant' ||
      targetStepParam === 0 ||
      targetStepParam === '0';

    const actor = db.prepare(`SELECT name FROM users WHERE id = ?`).get(req.user.id);

    if (isToApplicant) {
      let note = String(comment || '').trim() || '退回申請人修改';
      if (onBehalfOf) {
        const pName = agents.userBrief(onBehalfOf)?.name || `#${onBehalfOf}`;
        note = `代理 ${pName}：${note}`;
      }
      db.prepare(
        `INSERT INTO approval_actions
          (request_id, step_order, step_name, actor_id, action, comment, form_data, on_behalf_of)
         VALUES (?, ?, ?, ?, 'return', ?, '{}', ?)`
      ).run(id, step.order, step.name || '', req.user.id, note, onBehalfOf);

      db.prepare(
        `UPDATE approval_requests SET status = 'returned', current_step = 1, updated_at = datetime('now', 'localtime')
         WHERE id = ?`
      ).run(id);

      const after = getRequestDetail(id);
      fireAndForgetMail(
        'applicant-return',
        mail.notifyApplicant(after, 'returned', {
          actorName: actor?.name,
          comment: note,
        })
      );
      return res.json({
        request: after,
        message: '已退回申請人修改，申請人修正後可重新送出',
        returnedTo: 'applicant',
      });
    }

    // 退回指定步驟
    let targetStep = null;
    if (targetStepParam != null && targetStepParam !== '') {
      const tOrder = Number(targetStepParam);
      targetStep = (steps || []).find((s) => Number(s.order) === tOrder);
      if (!targetStep || Number(targetStep.order) >= Number(step.order)) {
        return res.status(400).json({ error: '無效的退回目標關卡' });
      }
    } else {
      // 未指定時退回上一關
      targetStep = getPreviousStep(steps, step);
    }

    if (!targetStep) {
      return res.status(400).json({
        error: '已是第一關簽核，無法退回上一位（若需退件請選擇退回申請人修改，或使用「駁回」）',
      });
    }

    let note =
      String(comment || '').trim() ||
      `退回至「${targetStep.name || `步驟 ${targetStep.order}`}」`;
    if (onBehalfOf) {
      const pName = agents.userBrief(onBehalfOf)?.name || `#${onBehalfOf}`;
      note = `代理 ${pName}：${note}`;
    }

    db.prepare(
      `INSERT INTO approval_actions
        (request_id, step_order, step_name, actor_id, action, comment, form_data, on_behalf_of)
       VALUES (?, ?, ?, ?, 'return', ?, '{}', ?)`
    ).run(id, step.order, step.name || '', req.user.id, note, onBehalfOf);

    db.prepare(
      `UPDATE approval_requests SET current_step = ?, updated_at = datetime('now', 'localtime')
       WHERE id = ?`
    ).run(targetStep.order, id);

    const after = getRequestDetail(id);
    fireAndForgetMail(
      'applicant-return',
      mail.notifyApplicant(after, 'returned', {
        actorName: actor?.name,
        comment: note,
      })
    );
    notifyCurrentApprovers(after, 'step', actor?.name || '');
    return res.json({
      request: after,
      message: `已退回「${targetStep.name || `步驟 ${targetStep.order}`}」`,
      previousStep: { order: targetStep.order, name: targetStep.name },
      targetStep: { order: targetStep.order, name: targetStep.name },
    });
  }

  return res.status(400).json({ error: '不支援的操作' });
});

/** 批次簽核核准 */
app.post('/api/requests/bulk-approve', authMiddleware, (req, res) => {
  const ids = Array.isArray(req.body?.ids)
    ? [...new Set(req.body.ids.map(Number).filter(Boolean))]
    : [];
  const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim() : '同意';

  if (!ids.length) {
    return res.status(400).json({ error: '請提供要批次簽核的單號清單' });
  }
  if (ids.length > 50) {
    return res.status(400).json({ error: '單次批次簽核上限為 50 筆' });
  }

  const successes = [];
  const failures = [];

  for (const id of ids) {
    try {
      const detail = getRequestDetail(id);
      const title = detail?.title || `單號 #${id}`;
      const serialNo = detail?.serial_no || '';

      const r = executeSingleApproveCore(id, req.user, {
        comment,
        stepFormData: {},
        files: [],
      });

      if (r.error) {
        failures.push({
          id,
          title,
          serial_no: serialNo,
          error: r.error,
          requiresFields: !!r.requiresFields,
        });
      } else {
        successes.push({
          id,
          title,
          serial_no: serialNo,
          message: r.message || '已核准',
        });
      }
    } catch (err) {
      console.error(`[bulk-approve] error on request ${id}:`, err);
      failures.push({
        id,
        title: `單號 #${id}`,
        error: err.message || '簽核處理失敗',
      });
    }
  }

  res.json({
    ok: true,
    total: ids.length,
    successCount: successes.length,
    failureCount: failures.length,
    successes,
    failures,
    message: `已完成批次核准：成功 ${successes.length} 筆${failures.length ? `，失敗 ${failures.length} 筆` : ''}`,
  });
});

/** 最終核准系統通知：確認收到 */
app.post('/api/requests/:id/final-notify-ack', authMiddleware, (req, res) => {
  try {
    const id = Number(req.params.id);
    const uid = req.user.id;
    const detail = getRequestDetail(id);
    if (!detail) return res.status(404).json({ error: '找不到該單據' });

    const receipt = db
      .prepare(
        `SELECT * FROM final_notify_receipts WHERE request_id = ? AND user_id = ?`
      )
      .get(id, uid);
    if (!receipt) {
      return res.status(403).json({ error: '您不是此單的最終核准通知對象' });
    }
    if (receipt.acked_at) {
      return res.json({
        ok: true,
        already: true,
        message: '您已確認收到此通知',
        request: getRequestDetail(id),
      });
    }

    db.prepare(
      `UPDATE final_notify_receipts SET acked_at = datetime('now', 'localtime')
       WHERE id = ?`
    ).run(receipt.id);

    db.prepare(
      `INSERT INTO approval_actions (request_id, step_order, step_name, actor_id, action, comment, form_data)
       VALUES (?, 0, '最終核准通知確認', ?, 'comment', ?, ?)`
    ).run(
      id,
      uid,
      `已確認收到最終核准通知（${receipt.label || '最終核准完成通知'}）`,
      JSON.stringify({
        type: 'final_notify_ack',
        receipt_id: receipt.id,
        label: receipt.label,
      })
    );

    res.json({
      ok: true,
      message: '已確認收到通知',
      request: getRequestDetail(id),
    });
  } catch (e) {
    console.error('[final-notify-ack]', e);
    res.status(500).json({ error: '確認失敗：' + (e.message || '未知錯誤') });
  }
});

/** 財務部授信額度建檔確認 API */
app.post('/api/requests/:id/finance-confirm', authMiddleware, (req, res) => {
  try {
    const id = Number(req.params.id);
    const { note } = req.body || {};
    const detail = getRequestDetail(id);
    if (!detail) return res.status(404).json({ error: '找不到該單據' });
    if (!isFinanceUser(req.user)) {
      return res
        .status(403)
        .json({ error: '您沒有財務部授信額度建檔確認之權限（請洽系統管理員設定權限）' });
    }
    if (detail.status !== 'approved') {
      return res.status(400).json({ error: '該單據尚未完全核准' });
    }
    if (!isCreditLimitRequestRow(detail)) {
      return res.status(400).json({ error: '此單據類型非信用額度申請單' });
    }

    const existing = db
      .prepare(
        `SELECT id FROM approval_actions WHERE request_id = ? AND step_name = '財務部額度建檔確認'`
      )
      .get(id);
    if (existing) {
      return res.status(400).json({ error: '財務部已完成額度建檔確認，請勿重複送出' });
    }

    // 合併總經理核定額度至 approver_data，供 PDF「財務部建立額度」顯示
    let adMerged = {};
    try {
      adMerged = JSON.parse(
        db
          .prepare(`SELECT approver_data_json FROM approval_requests WHERE id = ?`)
          .get(id)?.approver_data_json || '{}'
      );
    } catch {
      adMerged = {};
    }
    if (!adMerged || typeof adMerged !== 'object') adMerged = {};
    const gmLimit =
      adMerged.gm_approved_limit ??
      adMerged.step_3?.data?.gm_approved_limit ??
      null;
    adMerged.limit_established_status = '已完成建立';
    adMerged.finance_establishment_note = '已建立完成';
    if (gmLimit != null && gmLimit !== '') {
      adMerged.finance_established_limit = gmLimit;
    }
    if (note && String(note).trim()) {
      // 備註仍存於歷程；PDF 建檔備註固定顯示「已建立完成」
      adMerged.finance_establishment_extra_note = String(note).trim();
    }

    db.prepare(
      `INSERT INTO approval_actions (request_id, step_order, step_name, actor_id, action, comment, form_data)
       VALUES (?, 4, '財務部額度建檔確認', ?, 'comment', ?, ?)`
    ).run(
      id,
      req.user.id,
      note ? `已完成核准額度建檔登記：${note}` : '已完成核准額度建檔登記',
      JSON.stringify({
        limit_established_status: '已完成建立',
        finance_establishment_note: '已建立完成',
        finance_established_limit: gmLimit,
        gm_approved_limit: gmLimit,
        finance_establishment_extra_note: note ? String(note).trim() : '',
      })
    );

    db.prepare(
      `UPDATE approval_requests SET approver_data_json = ?, updated_at = datetime('now','localtime') WHERE id = ?`
    ).run(JSON.stringify(adMerged), id);

    const updated = getRequestDetail(id);

    // 寄送建檔完成通知給申請人
    const requester = db
      .prepare(`SELECT id, name, email FROM users WHERE id = ?`)
      .get(updated.requester_id);
    const reqEmail = String(requester?.email || updated.requester_email || '').trim();
    if (
      reqEmail &&
      !(mail.isPlaceholderEmail && mail.isPlaceholderEmail(reqEmail)) &&
      mail.sendCcNotice
    ) {
      fireAndForgetMail(
        'finance-confirmed',
        mail.sendCcNotice({
          to: reqEmail,
          toName: requester?.name || updated.requester_name,
          request: updated,
          deptName: '財務部額度建檔確認',
          actorName: req.user.name,
        })
      );
    }

    res.json({
      ok: true,
      message: '已完成財務部額度建檔登記並通知申請人！',
      request: updated,
    });
  } catch (e) {
    console.error('[finance-confirm error]', e);
    res.status(500).json({ error: '建檔確認失敗：' + e.message });
  }
});

/** 申請人點選確認財務建檔完成 API */
app.post('/api/requests/:id/applicant-ack', authMiddleware, (req, res) => {
  try {
    const id = Number(req.params.id);
    const detail = getRequestDetail(id);
    if (!detail) return res.status(404).json({ error: '找不到該單據' });
    if (
      Number(detail.requester_id) !== Number(req.user.id) &&
      req.user.role !== 'admin'
    ) {
      return res.status(403).json({ error: '僅本單申請人可點選確認' });
    }
    if (!isCreditLimitRequestRow(detail)) {
      return res.status(400).json({ error: '此單據類型非信用額度申請單' });
    }
    const finDone = db
      .prepare(
        `SELECT id FROM approval_actions WHERE request_id = ? AND step_name = '財務部額度建檔確認'`
      )
      .get(id);
    if (!finDone) {
      return res.status(400).json({ error: '財務部尚未完成建檔確認' });
    }
    const existing = db
      .prepare(
        `SELECT id FROM approval_actions WHERE request_id = ? AND step_name = '申請人建檔確認'`
      )
      .get(id);
    if (existing) {
      return res.status(400).json({ error: '已點選過確認，請勿重複送出' });
    }

    db.prepare(
      `INSERT INTO approval_actions (request_id, step_order, step_name, actor_id, action, comment, form_data)
       VALUES (?, 5, '申請人建檔確認', ?, 'comment', '申請人已確認財務部授信額度建檔完成', '{}')`
    ).run(id, req.user.id);

    const updated = getRequestDetail(id);
    res.json({
      ok: true,
      message: '已確認財務部建檔完成並移出待簽核！',
      request: updated,
    });
  } catch (e) {
    console.error('[applicant-ack error]', e);
    res.status(500).json({ error: '確認失敗：' + e.message });
  }
});

/** 安全的壓縮檔內檔名 */
function safeZipEntryName(name, fallback = 'file') {
  const base = String(name || fallback)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return base || fallback;
}

/**
 * 下載／預覽簽核單 PDF
 * - 與單據相關者、records_all、管理員可存取
 * - preview=1：一律 PDF、inline（詳情頁嵌入；簽核中亦可用）
 * - 已核准且有附件、非 preview：ZIP（PDF＋附件）
 */
app.get('/api/requests/:id/pdf', authMiddleware, async (req, res) => {
  const detail = getRequestDetail(Number(req.params.id));
  if (!detail) return res.status(404).json({ error: '找不到簽核單' });

  const seeAll =
    req.user.role === 'admin' || userHasPermission(req.user.id, 'records_all');
  if (!seeAll && !isRequestRelatedToUser(detail, req.user.id)) {
    return res.status(403).json({ error: '無權下載或預覽此文件' });
  }

  const preview =
    req.query.preview === '1' ||
    req.query.inline === '1' ||
    String(req.query.disposition || '').toLowerCase() === 'inline';

  // 草稿僅申請人／代申請人／管理員可預覽 PDF
  if (
    detail.status === 'draft' &&
    !isDraftOwner(detail, req.user.id) &&
    req.user.role !== 'admin'
  ) {
    return res.status(400).json({ error: '草稿僅申請人可預覽 PDF' });
  }

  try {
    const atts = db
      .prepare(
        `SELECT id, original_name, stored_name FROM request_attachments WHERE request_id = ? ORDER BY id ASC`
      )
      .all(detail.id);

    // 產生 PDF（若系統設定啟用公司憑證則數位簽章；僅已核准通常才加簽）
    const pdfBuf = await pdfSign.buildApprovalPdfBuffer(detail, writeApprovalPdf);
    if (pdfBuf && pdfBuf._pdfSignSkipped) {
      res.setHeader('X-Pdf-Sign', 'skipped');
      if (pdfBuf._pdfSignError) {
        res.setHeader(
          'X-Pdf-Sign-Error',
          encodeURIComponent(String(pdfBuf._pdfSignError).slice(0, 200))
        );
      }
    }

    const pdfName = buildApprovalPdfFileName(detail);
    const pdfNameSafe = safeZipEntryName(pdfName, `approval-${detail.id}.pdf`);

    // 預覽、或尚未核准、或無附件 → 純 PDF
    const asZip =
      !preview && detail.status === 'approved' && atts.length > 0;

    if (!asZip) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        preview
          ? `inline; filename="approval-${detail.id}.pdf"; filename*=UTF-8''${encodeURIComponent(pdfName)}`
          : contentDispositionAttachment(pdfName, `approval-${detail.id}.pdf`)
      );
      // 預覽時避免快取舊版（簽核中內容可能更新）
      if (preview) {
        res.setHeader('Cache-Control', 'private, no-store');
      }
      return res.send(pdfBuf);
    }

    // 已核准且有附件：ZIP = 簽核單 PDF + 附件/
    const zipName = buildApprovalZipFileName(detail, { hasAttachments: true });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      contentDispositionAttachment(
        zipName,
        `approval-${detail.id}-with-attachments.zip`
      )
    );

    const archive = archiver('zip', { zlib: { level: 8 } });
    archive.on('error', (err) => {
      console.error('zip error', err);
      if (!res.headersSent) res.status(500).json({ error: '壓縮失敗' });
      else res.end();
    });
    archive.pipe(res);

    archive.append(pdfBuf, { name: pdfNameSafe });

    const usedNames = new Set([pdfNameSafe.toLowerCase()]);
    for (const att of atts) {
      const abs = path.join(UPLOAD_DIR, att.stored_name);
      if (!fs.existsSync(abs)) continue;
      let entry = safeZipEntryName(att.original_name, `附件-${att.id}`);
      // 避免同名覆蓋
      let finalName = entry;
      let n = 1;
      while (usedNames.has(finalName.toLowerCase())) {
        const ext = path.extname(entry);
        const stem = ext ? entry.slice(0, -ext.length) : entry;
        finalName = `${stem}_${n}${ext}`;
        n += 1;
      }
      usedNames.add(finalName.toLowerCase());
      archive.file(abs, { name: `附件/${finalName}` });
    }

    await archive.finalize();
  } catch (e) {
    console.error('PDF/ZIP error', e);
    if (!res.headersSent) {
      const msg = e && e.message ? String(e.message) : 'PDF 產生失敗';
      res.status(500).json({
        error: msg.includes('數位簽章') || msg.includes('PKCS')
          ? msg
          : `PDF 產生失敗：${msg}`,
      });
    }
  }
});

// ---------- 管理員：PDF 備份與查詢 (Modular Route) ----------
registerBackupRoutes(app, {
  db,
  authMiddleware,
  adminOnly,
  requirePerm,
  getRequestDetail,
  requireLeaveFormsDownload,
});

/**
 * 硬刪除簽核紀錄（單據、歷程、附件、相關備份）
 * @param {number|string} requestId
 * @param {{ actor: { id: number, role: string } }} opts
 * - 系統管理員：可刪任何狀態（已核准／駁回／簽核中／已取消／已簽署）
 * - 「刪除簽核紀錄」：可刪他人單據（仍受「已簽署鎖定」限制）
 * - 「刪除請假申請」：可刪所有人請假單（含簽核進行中、已簽署）
 * - 申請人本人：可刪除「非已核准」的自己單據
 */
function deleteApprovalRequestHard(requestId, opts = {}) {
  const id = Number(requestId);
  const row = db
    .prepare(
      `SELECT r.id, r.title, r.status, r.requester_id, r.current_step,
              w.name AS workflow_name
       FROM approval_requests r
       LEFT JOIN workflows w ON w.id = r.workflow_id
       WHERE r.id = ?`
    )
    .get(id);
  if (!row) return { ok: false, error: '找不到簽核單' };

  const actor = opts.actor;
  const isAdminActor = !!(actor && actor.role === 'admin');
  // 系統管理員：無限制刪除
  if (isAdminActor) {
    // fall through to hard delete
  } else {
    const isLeave = isLeaveApprovalRequest(row);
    const leavePrivileged = actor && isLeave && canDeleteLeaveRequests(actor);
    const recordsPrivileged = actor && canDeleteApprovalRecords(actor);

    // 已有簽署人核准 → 一般不可刪；請假＋leave_delete 可刪
    if (!leavePrivileged && hasApproverSigned(id, row)) {
      return { ok: false, error: MSG_LOCKED_AFTER_SIGN };
    }

    if (actor) {
      const isOwner = Number(row.requester_id) === Number(actor.id);
      if (!leavePrivileged && !recordsPrivileged) {
        if (!isOwner) {
          return { ok: false, error: '只能刪除自己的申請' };
        }
        if (row.status === 'approved') {
          return { ok: false, error: '已核准的申請不可刪除' };
        }
      }
    }
  }

  // 附件實體檔
  const atts = db
    .prepare(`SELECT stored_name FROM request_attachments WHERE request_id = ?`)
    .all(id);
  for (const a of atts) {
    if (!a.stored_name) continue;
    const p = path.join(UPLOAD_DIR, a.stored_name);
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch (e) {
      console.warn('[delete request] attach unlink', p, e.message);
    }
  }

  // 相關備份 PDF
  const backups = db.prepare(`SELECT id FROM backup_files WHERE request_id = ?`).all(id);
  for (const b of backups) {
    deleteBackup(b.id);
  }

  db.prepare(`DELETE FROM request_attachments WHERE request_id = ?`).run(id);
  db.prepare(`DELETE FROM approval_actions WHERE request_id = ?`).run(id);
  // 最終核准通知回執：刪單據時一併清除，避免總覽殘留「待確認」
  db.prepare(`DELETE FROM final_notify_receipts WHERE request_id = ?`).run(id);
  db.prepare(`DELETE FROM approval_requests WHERE id = ?`).run(id);

  return { ok: true, id, title: row.title, status: row.status };
}

app.delete('/api/requests/:id', authMiddleware, (req, res) => {
  const result = deleteApprovalRequestHard(req.params.id, { actor: req.user });
  if (!result.ok) {
    const code =
      result.error === '找不到簽核單'
        ? 404
        : result.error === '已核准的申請不可刪除' ||
            result.error === '只能刪除自己的申請' ||
            result.error === MSG_LOCKED_AFTER_SIGN
          ? 403
          : 400;
    return res.status(code).json({ error: result.error });
  }
  res.json({ ok: true, ...result });
});

app.post('/api/requests/bulk-delete', authMiddleware, (req, res) => {
  const ids = Array.isArray(req.body?.ids)
    ? [...new Set(req.body.ids.map(Number).filter(Boolean))]
    : [];
  if (!ids.length) return res.status(400).json({ error: '請選擇至少一筆簽核紀錄' });
  const deleted = [];
  const failed = [];
  for (const id of ids) {
    const r = deleteApprovalRequestHard(id, { actor: req.user });
    if (r.ok) deleted.push({ id: r.id, title: r.title });
    else failed.push({ id, error: r.error });
  }
  res.json({
    ok: true,
    deleted: deleted.length,
    failed: failed.length,
    deletedItems: deleted,
    failures: failed,
    message: `已刪除 ${deleted.length} 筆簽核紀錄${failed.length ? `，${failed.length} 筆失敗` : ''}`,
  });
});

// Dashboard stats
app.get('/api/stats', authMiddleware, (req, res) => {
  const uid = req.user.id;
  const minePending = db
    .prepare(`SELECT COUNT(*) AS c FROM approval_requests WHERE requester_id = ? AND status = 'pending'`)
    .get(uid).c;
  const mineDone = db
    .prepare(`SELECT COUNT(*) AS c FROM approval_requests WHERE requester_id = ? AND status = 'approved'`)
    .get(uid).c;
  // 必須用 steps_snapshot（實際解析後簽核人），不可只用流程模板
  const allPending = db
    .prepare(
      `SELECT r.*, w.steps_json, r.steps_snapshot_json FROM approval_requests r
       JOIN workflows w ON w.id = r.workflow_id WHERE r.status = 'pending'`
    )
    .all();
  const pendingMe = allPending.filter((r) => {
    const steps = loadStepsForRequest(r);
    const step = findStepByOrder(steps, r.current_step);
    return canUserApproveStep(uid, step, r.id);
  }).length;
  const users = db.prepare(`SELECT COUNT(*) AS c FROM users WHERE active = 1`).get().c;
  const workflows = db.prepare(`SELECT COUNT(*) AS c FROM workflows WHERE active = 1`).get().c;
  const isFinance = isFinanceUser(req.user);
  const pendingFinanceConfirm = isFinance
    ? db
        .prepare(
          `SELECT COUNT(*) AS c FROM approval_requests r
           JOIN workflows w ON w.id = r.workflow_id
           WHERE r.status = 'approved'
             AND (w.name LIKE '%信用額度%' OR r.title LIKE '%信用額度%')
             AND r.id NOT IN (
               SELECT request_id FROM approval_actions WHERE step_name = '財務部額度建檔確認'
             )`
        )
        .get().c
    : 0;
  const pendingApplicantAck = db
    .prepare(
      `SELECT COUNT(*) AS c FROM approval_requests r
       JOIN workflows w ON w.id = r.workflow_id
       WHERE r.status = 'approved'
         AND r.requester_id = ?
         AND (w.name LIKE '%信用額度%' OR r.title LIKE '%信用額度%')
         AND r.id IN (
           SELECT request_id FROM approval_actions WHERE step_name = '財務部額度建檔確認'
         )
         AND r.id NOT IN (
           SELECT request_id FROM approval_actions WHERE step_name = '申請人建檔確認'
         )`
    )
    .get(uid).c;

  const pendingFinalNotify = getPendingFinalNotifyCount(uid);

  res.json({
    stats: {
      minePending,
      mineDone,
      pendingMe:
        pendingMe +
        (isFinance ? pendingFinanceConfirm : 0) +
        pendingApplicantAck +
        pendingFinalNotify,
      pendingFinanceConfirm,
      pendingApplicantAck,
      pendingFinalNotify,
      users,
      workflows,
    },
  });
});

// SPA fallback
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// 同時支援 IPv4 / IPv6；HTTP 預設 3847，HTTPS 預設 3848（entrypoint 產生憑證）
const http = require('http');
const https = require('https');

function listenDual(server, port, label, urls) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.off('error', onError);
      if (err.code === 'EADDRINUSE' || err.code === 'EAFNOSUPPORT') {
        server.listen(Number(port), '0.0.0.0', () => {
          console.log(`${label} (IPv4):`);
          for (const u of urls) console.log(`  ${u}`);
          resolve('ipv4');
        });
        server.once('error', reject);
      } else {
        reject(err);
      }
    };
    server.once('error', onError);
    server.listen({ port: Number(port), host: '::', ipv6Only: false }, () => {
      server.off('error', onError);
      console.log(`${label}:`);
      for (const u of urls) console.log(`  ${u}`);
      resolve('dual');
    });
  });
}

const server = http.createServer(app);
// OnlyOffice 同源 WebSocket 代理（編輯器 /doc/.../c/ 需要）
try {
  onlyoffice.attachDocsWsProxy(server);
} catch (e) {
  console.warn('[onlyoffice] attachDocsWsProxy failed', e.message);
}
// 台灣辦公日曆：讀快取 + 背景自動更新（每日）
try {
  twCalendar.startAutoRefresh();
} catch (e) {
  console.warn('[tw-calendar] 啟動失敗', e.message);
}

listenDual(server, PORT, '線上簽核系統 HTTP', [
  `http://127.0.0.1:${PORT}/`,
  `http://localhost:${PORT}/`,
])
  .then(() => {
    const ver = appVersion.getVersionInfo();
    console.log(`${ver.banner} 已啟動`);
    console.log(`  版本: ${ver.labelFull || ver.label}`);
    console.log(`  建置: ${ver.build} · 原始檔 ${ver.sourceFiles || 0} 個`);
    console.log(`預設管理員: admin / admin123（若為首次啟動）`);
    try {
      deployLog.recordOnStartup();
    } catch (e) {
      console.warn('[deploy-log] 記錄失敗', e.message);
    }
  })
  .catch((err) => {
    console.error('[server] HTTP listen error:', err.message);
    process.exit(1);
  });

const HTTPS_PORT = process.env.HTTPS_PORT || '3848';
const SSL_KEY_PATH =
  process.env.SSL_KEY_PATH || path.join(__dirname, '..', 'data', 'certs', 'key.pem');
const SSL_CERT_PATH =
  process.env.SSL_CERT_PATH || path.join(__dirname, '..', 'data', 'certs', 'cert.pem');
const httpsEnabled =
  String(process.env.HTTPS_ENABLED || '1') !== '0' &&
  Number(HTTPS_PORT) > 0 &&
  fs.existsSync(SSL_KEY_PATH) &&
  fs.existsSync(SSL_CERT_PATH);

if (httpsEnabled) {
  try {
    const httpsServer = https.createServer(
      {
        key: fs.readFileSync(SSL_KEY_PATH),
        cert: fs.readFileSync(SSL_CERT_PATH),
      },
      app
    );
    try {
      onlyoffice.attachDocsWsProxy(httpsServer);
    } catch (e) {
      /* optional */
    }
    listenDual(httpsServer, HTTPS_PORT, '線上簽核系統 HTTPS', [
      `https://127.0.0.1:${HTTPS_PORT}/`,
      `https://localhost:${HTTPS_PORT}/`,
    ]).catch((err) => {
      console.error('[server] HTTPS listen error:', err.message);
    });
  } catch (err) {
    console.error('[server] HTTPS 啟動失敗:', err.message);
  }
} else if (String(process.env.HTTPS_ENABLED || '1') !== '0') {
  console.log(
    `[server] 找不到 SSL 憑證（${SSL_CERT_PATH}），略過 HTTPS。` +
      `請用 docker-entrypoint 自動產生，或設定 SSL_KEY_PATH / SSL_CERT_PATH。`
  );
}
