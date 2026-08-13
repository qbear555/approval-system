// 時區必須最先載入：它會設定 process.env.TZ，
// 之後 db 的 datetime('now','localtime') 才會是台灣時間
const tz = require('./tz');
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
  isWeakPlainPassword,
  hashMatchesWeakPassword,
  generateBootstrapPassword,
  signToken,
  authMiddleware,
  setAuthCookie,
  clearAuthCookie,
  adminOnly,
  builtinAdminOnly,
  JWT_SECRET_SOURCE,
} = require('./auth');
const loginRateLimit = require('./login-rate-limit');
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
} = require('./backup');
const mail = require('./mail');
const lineNotify = require('./line-notify');
const { importPayload } = require('./import-workflows');
const workflowModule = require('./workflow-module');
const flowGraph = require('./flow-graph');
const flowEngineFactory = require('./flow-engine');
const systemPackage = require('./system-package');
const labor = require('./labor');
const leaveReport = require('./leave-report');
const twCalendar = require('./tw-calendar');
const systemSettings = require('./system-settings');
const pdfSign = require('./pdf-sign');
const appVersion = require('./version');
const deployLog = require('./deploy-log');
const onlyoffice = require('./onlyoffice');
const fs = require('fs');
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

/** 設定包 JSON 上傳（記憶體，上限約 100MB） */
const uploadPackage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const name = decodeUploadFilename(file.originalname || '').toLowerCase();
    if (name.endsWith('.json') || file.mimetype === 'application/json' || file.mimetype === 'text/plain') {
      return cb(null, true);
    }
    cb(new Error('請上傳 .json 設定包'));
  },
});

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
              a.uploaded_by, u.name AS uploader_name
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

/** 取得請求端 IP：未設 TRUST_PROXY 時不採信 X-Forwarded-For */
function getClientIp(req) {
  if (!req) return '127.0.0.1';
  const raw = TRUST_PROXY
    ? req.ip || req.socket?.remoteAddress
    : req.socket?.remoteAddress || req.connection?.remoteAddress;
  return String(raw || '127.0.0.1').replace(/^::ffff:/, '');
}

/** 寫入系統進階稽核日誌 (P3-1) */
function logAudit(req, { action_type, category = 'general', description, target_id = null, detail = {} }) {
  try {
    const user = req?.user;
    const userId = user?.id || null;
    const userName = user?.name || (userId ? '' : '系統/訪客');
    const userUsername = user?.username || '';
    const ip = getClientIp(req);

    db.prepare(`
      INSERT INTO system_audit_logs (user_id, user_name, user_username, action_type, category, description, ip_address, target_id, detail_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      userName,
      userUsername,
      String(action_type || 'unknown'),
      String(category || 'general'),
      String(description || ''),
      ip,
      target_id ? Number(target_id) : null,
      JSON.stringify(detail || {})
    );
  } catch (e) {
    console.error('[audit-log] record failed:', e.message);
  }
}

/**
 * P2-1: 處理最終核准時的自動連動 (銷假單扣回 & 加班轉補休)
 */
function handleP2ApprovedSideEffects(detail, req = null) {
  if (!detail || detail.status !== 'approved') return;

  try {
    const title = String(detail.title || '').trim();
    const wfName = String(detail.workflow_name || '').trim();
    const formData = typeof detail.form_data === 'string' ? JSON.parse(detail.form_data || '{}') : (detail.form_data || {});
    const requesterId = Number(detail.requester_id);

    if (!requesterId) return;

    // 1. 銷假連動 (銷假申請單 / Title包含銷假 / form_data 有 cancel_target_id / leave_request_id)
    const isCancelLeave = title.includes('銷假') || wfName.includes('銷假') || formData.is_cancel_leave || formData.cancel_target_id;
    if (isCancelLeave) {
      const targetRequestId = Number(formData.cancel_target_id || formData.target_request_id || formData.leave_request_id);
      let returnedDays = Number(formData.days || formData.cancel_days || 0);
      let returnedHours = Number(formData.hours || formData.cancel_hours || 0);
      const leaveType = String(formData.leave_type || formData.leave_name || '特別休假（特休）').trim();

      // 若有指定原請假單號，查詢原單據資訊
      if (targetRequestId) {
        const targetReq = db.prepare(`SELECT * FROM approval_requests WHERE id = ?`).get(targetRequestId);
        if (targetReq) {
          const tFormData = JSON.parse(targetReq.form_data || '{}');
          if (!returnedDays && !returnedHours) {
            returnedDays = Number(tFormData.days || 0);
            returnedHours = Number(tFormData.hours || 0);
          }
          // 將原單據標記為已銷假
          db.prepare(`UPDATE approval_requests SET status = 'cancelled', updated_at = datetime('now', 'localtime') WHERE id = ?`)
            .run(targetRequestId);
        }
      }

      // 將銷假扣回的天數／小時加回使用者的可休／手動餘額
      const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(requesterId);
      if (user) {
        let entitledMap = {};
        try { entitledMap = JSON.parse(user.leave_entitled_json || '{}'); } catch {}
        
        const curEntitled = Number(entitledMap[leaveType] || 0);
        const addEntitled = returnedDays + (returnedHours / 7.5);
        entitledMap[leaveType] = Math.round((curEntitled + addEntitled) * 100) / 100;

        db.prepare(`UPDATE users SET leave_entitled_json = ? WHERE id = ?`)
          .run(JSON.stringify(entitledMap), requesterId);

        logAudit(req, {
          action_type: 'leave_cancel_returned',
          category: 'approval',
          description: `銷假單 #${detail.id} 核准完成，自動歸還 ${user.name} 假別「${leaveType}」${returnedDays ? `${returnedDays} 天` : ''}${returnedHours ? `${returnedHours} 小時` : ''}`,
          target_id: detail.id,
        });
      }
    }

    // 2. 加班轉補休連動 (加班申請單 / 延長工時 / Title包含加班 / form_data 選擇轉補休)
    const isOvertime = title.includes('加班') || title.includes('延長工時') || wfName.includes('加班') || wfName.includes('延長工時') || formData.is_overtime;
    const isConvertToComp = String(formData.convert_type || formData.type || formData.overtime_action || formData.convert_to || '').includes('補休') || formData.convert_to_comp === true || formData.convert_to_comp === 'true';

    if (isOvertime && isConvertToComp) {
      const otHours = Number(formData.hours || formData.overtime_hours || formData.total_hours || 0);
      if (otHours > 0) {
        let compHours = otHours;
        if (formData.use_rate_calc) {
          if (otHours <= 2) {
            compHours = Math.round(otHours * 1.34 * 100) / 100;
          } else {
            compHours = Math.round((2 * 1.34 + (otHours - 2) * 1.67) * 100) / 100;
          }
        }

        const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(requesterId);
        if (user) {
          let entitledMap = {};
          try { entitledMap = JSON.parse(user.leave_entitled_json || '{}'); } catch {}
          
          const compKey = '補休';
          const curComp = Number(entitledMap[compKey] || 0);
          entitledMap[compKey] = Math.round((curComp + compHours / 7.5) * 100) / 100;

          db.prepare(`UPDATE users SET leave_entitled_json = ? WHERE id = ?`)
            .run(JSON.stringify(entitledMap), requesterId);

          logAudit(req, {
            action_type: 'overtime_to_comp',
            category: 'approval',
            description: `加班單 #${detail.id} 核准完成，自動核給同仁 ${user.name} 補休 ${compHours} 小時`,
            target_id: detail.id,
          });
        }
      }
    }
  } catch (err) {
    console.error('[P2-1 side effects error]', err.message);
  }
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
    description: '人事：選擇人員與日期範圍，匯出請假 Excel（各假別與特休剩餘）',
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
  {
    id: 'audit_logs',
    label: '系統稽核日誌',
    description: '查看及匯出系統維運、全站登入與操作行為之進階稽核軌跡。系統管理員預設具備。',
  },
  {
    id: 'line_settings',
    label: 'LINE 通知設定',
    description:
      '可設定 LINE 推播服務網址／API 金鑰／事件（當「誰可設定 LINE」選「指定權限」時生效）。系統管理員預設具備。',
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
  if (!user || !user.id) return false;
  // 系統管理員／總經理 role=admin 不自動算財務
  if (user.role === 'admin') return false;
  return userHasPermission(user.id, 'finance_confirm');
}

function isCreditLimitRequestRow(rowOrDetail) {
  if (!rowOrDetail) return false;
  const name = String(rowOrDetail.workflow_name || '');
  const title = String(rowOrDetail.title || '');
  return /信用額度|授信額度|額度申請/.test(name) || /信用額度|授信額度/.test(title);
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
    signature_image: row.signature_image || null,
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

function fireAndForgetLine(label, promise) {
  lineNotify.fireAndForget(label, promise);
}

/** 信內／LINE 內連結用系統網址（與 Email baseUrl 共用） */
function getAppBaseUrl() {
  try {
    const cfg = mail.loadConfig();
    return String(cfg.baseUrl || '')
      .trim()
      .replace(/\/$/, '');
  } catch {
    return '';
  }
}

function getUsernameById(id) {
  if (id == null) return null;
  const row = db.prepare(`SELECT username FROM users WHERE id = ?`).get(id);
  return row?.username || null;
}

function getUsernamesByIds(ids) {
  const list = (ids || []).map(Number).filter(Boolean);
  if (!list.length) return [];
  const out = [];
  for (const id of list) {
    const u = getUsernameById(id);
    if (u) out.push(u);
  }
  return out;
}

/**
 * 是否可設定 LINE 通知
 * configAccess: builtin_admin | any_admin | permission
 */
function canConfigureLineSettings(user) {
  if (!user) return false;
  const access = lineNotify.loadConfig().configAccess || 'builtin_admin';
  if (access === 'builtin_admin') return isBuiltinAdminUsername(user.username);
  if (access === 'any_admin') return user.role === 'admin' || isBuiltinAdminUsername(user.username);
  if (access === 'permission') {
    return (
      user.role === 'admin' ||
      isBuiltinAdminUsername(user.username) ||
      userHasPermission(user.id, 'line_settings')
    );
  }
  return isBuiltinAdminUsername(user.username);
}

function lineSettingsOnly(req, res, next) {
  if (!req.user) return res.status(401).json({ error: '未登入' });
  if (!canConfigureLineSettings(req.user)) {
    return res.status(403).json({ error: '您沒有 LINE 通知設定權限' });
  }
  next();
}

/** 以數字比對步驟 order（避免 JSON 字串 / SQLite 整數不一致） */
function findStepByOrder(steps, order) {
  const o = Number(order);
  if (!Array.isArray(steps) || !Number.isFinite(o)) return null;
  return steps.find((s) => Number(s.order) === o) || null;
}

/** 取得某步驟尚未核准的簽核人 id（會簽 mode=all 用） */
function getPendingApproverIds(requestId, step) {
  if (!step) return [];
  const ids = (step.approverIds || []).map(Number).filter(Boolean);
  if (!ids.length) return [];
  if (step.mode !== 'all') return ids;
  return ids.filter((aid) => {
    const row = db
      .prepare(
        `SELECT id FROM approval_actions
         WHERE request_id = ? AND step_order = ? AND actor_id = ? AND action = 'approve'`
      )
      .get(requestId, step.order, aid);
    return !row;
  });
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
  const targetIds =
    kind === 'remind' || step.mode !== 'all'
      ? step.approverIds || []
      : getPendingApproverIds(detail.id, step);
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
  // LINE：依 username 推播（成員需先在 LINE 官方帳號綁定簽核帳號）
  const usernames = getUsernamesByIds(targetIds);
  if (usernames.length) {
    fireAndForgetLine(
      kind === 'remind' ? 'remind' : 'approver',
      lineNotify.notifyApproversLine(detail, usernames, kind, {
        actorName: fromName,
        baseUrl: getAppBaseUrl(),
      })
    );
  }
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

// Ensure admin exists on first boot（不使用公開弱密碼）
(function ensureAdmin() {
  const c = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (c !== 0) return;
  const pwd = generateBootstrapPassword();
  db.prepare(
    `INSERT INTO users (username, password_hash, name, email, department, role)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    normalizeUsername('admin'),
    hashPassword(pwd),
    '系統管理員',
    'admin@example.com',
    '管理部',
    'admin'
  );
  const bootFile = path.join(__dirname, '..', 'data', '.admin-bootstrap.txt');
  try {
    fs.writeFileSync(
      bootFile,
      [
        `username=Admin`,
        `password=${pwd}`,
        `created=${tz.nowStamp()}`,
        '請登入後立刻修改密碼，並刪除此檔。',
        '',
      ].join('\n'),
      { encoding: 'utf8', mode: 0o600 }
    );
    console.log('[seed] 已建立內建 Admin。初始密碼寫入 data/.admin-bootstrap.txt（勿提交、登入後請改密並刪檔）');
  } catch (e) {
    console.error('[seed] 無法寫入 data/.admin-bootstrap.txt：', e.message);
    console.error('[seed] 請刪除空資料庫後重試，或手動重設 Admin 密碼');
  }
})();

/** 舊版用部門／姓名判斷財務：補上 finance_confirm，之後只看權限 */
(function migrateFinanceConfirmPermission() {
  try {
    const rows = db
      .prepare(
        `SELECT id, username, name, department, role, permissions_json
         FROM users WHERE active = 1 AND role != 'admin'`
      )
      .all();
    let n = 0;
    for (const u of rows) {
      const uname = String(u.username || '');
      let depts = [];
      try {
        depts = getUserDepartments(u.id);
      } catch {
        depts = [];
      }
      const legacy =
        u.department === '財務部' ||
        depts.includes('財務部') ||
        /^gigi$/i.test(uname) ||
        /^joan$/i.test(uname) ||
        u.name === '張美雯' ||
        u.name === '詹慈敏';
      if (!legacy) continue;
      const perms = parsePermissions(u.permissions_json);
      if (perms.includes('finance_confirm')) continue;
      perms.push('finance_confirm');
      db.prepare(`UPDATE users SET permissions_json = ? WHERE id = ?`).run(
        JSON.stringify(perms),
        u.id
      );
      n += 1;
    }
    if (n > 0) {
      console.log(`[migrate] 已為 ${n} 位既有財務人員補上 finance_confirm 權限`);
    }
  } catch (e) {
    console.warn('[migrate] finance_confirm', e.message);
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
const TRUST_PROXY = /^(1|true|yes)$/i.test(String(process.env.TRUST_PROXY || ''));
const CORS_ORIGINS = String(process.env.CORS_ORIGIN || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// 直連 3847/3848 時勿信任 X-Forwarded-*（否則稽核 IP 可被偽造）
if (TRUST_PROXY) app.set('trust proxy', 1);

if (CORS_ORIGINS.length) {
  app.use(cors({ origin: CORS_ORIGINS, credentials: true }));
}
// OnlyOffice 靜態資源同源代理（須在 static 之前，避免 HTTPS 混合內容）
app.use(onlyoffice.createDocsProxy());
app.use(express.json({ limit: '2mb' }));

/** 探活（無需登入；勿改打業務 API） */
app.get(['/health', '/api/health'], (req, res) => {
  try {
    db.prepare('SELECT 1 AS ok').get();
    res.json({ ok: true, status: 'ok' });
  } catch (e) {
    res.status(503).json({ ok: false, status: 'db_error' });
  }
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

app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------- helpers ----------
const FIELD_TYPES = ['text', 'textarea', 'number', 'date', 'datetime', 'select', 'checkbox', 'user'];

/** 申請單列表共用的 SELECT／JOIN（後面接 WHERE／ORDER BY） */
const REQUEST_LIST_SELECT = `SELECT r.*, w.name AS workflow_name, w.steps_json, r.steps_snapshot_json,
              u.name AS requester_name
       FROM approval_requests r
       JOIN workflows w ON w.id = r.workflow_id
       JOIN users u ON u.id = r.requester_id`;

/** 信用額度單判定（流程名稱或主旨含「信用額度」） */
const CREDIT_LIMIT_COND = `(IFNULL(w.name, '') LIKE '%信用額度%' OR r.title LIKE '%信用額度%')`;
/** 信用額度單的兩段建檔確認步驟名稱 */
const STEP_FINANCE_CONFIRM = '財務部額度建檔確認';
const STEP_APPLICANT_ACK = '申請人建檔確認';

/** 出勤可選時間範圍（請假起迄與前端一致） */
const WORK_TIME_START_MIN = 9 * 60; // 09:00
const WORK_TIME_END_MIN = 17 * 60 + 30; // 17:30
/** 延長工時／實際工時可選：17:30～24:00（每 30 分鐘） */
const OT_TIME_START_MIN = 17 * 60 + 30; // 17:30
const OT_TIME_END_MIN = 24 * 60; // 24:00

/**
 * 正規化並驗證「日期+時間」且分鐘僅能 00 或 30
 * @param {string} val
 * @param {{ workHoursOnly?: boolean, overtimeHoursOnly?: boolean }} opts
 *   workHoursOnly：09:00～17:30（請假）
 *   overtimeHoursOnly：17:30～24:00（延長工時；允許 24:00）
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
        error: '時間須在 17:30～24:00 之間（每 30 分鐘）',
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

/**
 * 解析使用者更新時的到職日：未帶欄位沿用原值、空值清除、格式錯誤回報
 * @returns {{ ok: true, value: string|null } | { ok: false, error: string }}
 */
function resolveNextHireDate(hireDate, current) {
  if (hireDate === undefined) return { ok: true, value: current || null };
  if (hireDate === null || hireDate === '') return { ok: true, value: null };
  const hd = labor.toDateOnly(hireDate);
  if (!hd) return { ok: false, error: '到職日格式須為 YYYY-MM-DD' };
  return { ok: true, value: hd };
}

/** 使用者 id 陣列 → 「姓名（部門）」顯示字串；查無此人顯示 #id */
function formatUserLabels(ids) {
  return ids
    .map((uid) => {
      const u = db.prepare(`SELECT name, department FROM users WHERE id = ?`).get(uid);
      if (!u) return `#${uid}`;
      return u.department ? `${u.name}（${u.department}）` : u.name;
    })
    .join('、');
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
        // 關卡條件式動態分支。舊版此處未保留 condition，編輯器設定完存檔即被
        // 靜默丟棄，導致條件式分支永遠無法生效（正式環境 0 個流程啟用）。
        condition: parseStepCondition(s.condition),
        // v2 圖模型的節點 id；v1 流程為 undefined
        nodeId: s.nodeId ? String(s.nodeId).trim().slice(0, 60) : undefined,
      };
    });
  } catch {
    return null;
  }
}

const COND_OPERATORS = ['>=', '>', '<=', '<', '==', '!=', 'contains'];

/** 正規化關卡條件；無效或未啟用一律回傳 { enabled: false } */
function parseStepCondition(c) {
  if (!c || typeof c !== 'object' || !c.enabled) return { enabled: false };
  const fieldId = String(c.fieldId || '').trim().slice(0, 40);
  const operator = COND_OPERATORS.includes(c.operator) ? c.operator : '';
  // 條件不完整就視同未啟用，避免存進半套設定後執行期行為難以預期
  if (!fieldId || !operator) return { enabled: false };
  return {
    enabled: true,
    fieldId,
    operator,
    value: c.value != null ? String(c.value).trim().slice(0, 100) : '',
    action: c.action === 'skip' ? 'skip' : 'require',
  };
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

/** 假別下拉的後備選項（表單未自訂 options 時使用；不含「曠職」） */
const LEAVE_TYPE_FALLBACK_OPTIONS = [
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

/** 由表單欄位取假別選項；表單沒定義就用後備清單 */
function resolveLeaveTypeOptions(formFields) {
  const lf = (formFields || []).find(
    (f) => f.id === 'leave_type' || /假別/.test(String(f.label || ''))
  );
  if (Array.isArray(lf?.options) && lf.options.length) {
    return lf.options.map((o) => String(o).trim()).filter(Boolean);
  }
  return [...LEAVE_TYPE_FALLBACK_OPTIONS];
}

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

function validateFormData(fields, raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  const cleaned = {};
  for (const f of fields) {
    let val = data[f.id];
    if (f.type === 'checkbox') {
      val = val === true || val === 'true' || val === 1 || val === '1' || val === 'on';
      cleaned[f.id] = val;
      if (f.required && !val) {
        return { error: `請勾選「${f.label}」` };
      }
      continue;
    }
    if (val == null) val = '';
    val = String(val).trim();
    if (f.required && !val) {
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
      // 請假：09:00～17:30；延長工時／實際工時：17:30～24:00
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
      return { error: norm.error || '請假天數／小時不符合最小單位' };
    }
    // 有填起迄或假別時才強制寫回（避免無關表單）
    if (leaveType || cleaned.start_date || cleaned.end_date) {
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

/**
 * 合併「申請人自選簽核人」欄位（如副總經理）
 * 欄位鍵：users_pick_{步驟序}
 * 值：'all' | 單一 userId | '1,2,3'（勾選多位）
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
    const pool = new Set(
      (step?.approverIds || []).map(Number).filter(Boolean)
    );
    const val = raw[key] !== undefined ? raw[key] : merged[key];
    if (val === undefined || val === null || val === '') {
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
  // 每個 users_pick 步驟都必須有值
  for (const s of pickSteps) {
    const key = `users_pick_${s.order}`;
    if (merged[key] === undefined || merged[key] === null || merged[key] === '') {
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

/**
 * 部門 active 成員（含 user_departments 多部門隸屬）
 * @param {string} dept 已正規化的部門名稱
 * @param {boolean} adminLast true 時把 admin 排到最後（挑部門主管用）
 */
function queryDepartmentUsers(dept, adminLast = false) {
  const order = adminLast
    ? `CASE WHEN u.role = 'admin' THEN 1 ELSE 0 END, u.id ASC`
    : `u.id ASC`;
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
       ORDER BY ${order}`
    )
    .all(dept, dept);
}

/** 部門主管：同部門 active 使用者（含多部門隸屬），優先非 admin，再依 id */
function getDeptHead(department) {
  const dept = String(department || '').trim();
  if (!dept) return null;
  return queryDepartmentUsers(dept, true)[0] || null;
}

function resolveUnitName(name) {
  const raw = String(name || '').trim();
  if (!raw) return '';
  return UNIT_ALIASES[raw] || raw;
}

function getUsersInDepartment(department) {
  const dept = resolveUnitName(department);
  if (!dept) return [];
  return queryDepartmentUsers(dept);
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
      const pool = (s.approverIds || []).map(Number).filter(Boolean);
      if (!pool.length) {
        return { error: `步驟「${s.name}」尚未設定可選簽核人` };
      }
      const fieldId = `users_pick_${s.order}`;
      const raw = formData?.[fieldId];
      if (raw === undefined || raw === null || raw === '') {
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
        ids = [...new Set(ids)];
        if (!ids.length) {
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
      if (u.id === requester.id) {
        return { error: `步驟「${s.name}」不可選擇申請人本人` };
      }
      approverIds = [u.id];
      resolveNote = `表單指定：${u.name}`;
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
        name: s.name,
        assignType: s.assignType,
        formFieldId: s.formFieldId,
        department: s.department,
        mode: approverIds.length > 1 ? 'all' : s.mode === 'all' ? 'all' : 'any',
        approverIds,
        resolveNote,
        approverFields: Array.isArray(s.approverFields) ? s.approverFields : [],
        // 條件式分支必須帶進 snapshot：執行引擎讀的是 snapshot 而非流程定義
        condition: s.condition && s.condition.enabled ? s.condition : { enabled: false },
        nodeId: s.nodeId,
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
      name: s.name,
      assignType: s.assignType,
      formFieldId: s.formFieldId,
      department: s.department,
      mode: s.mode,
      approverIds,
      resolveNote,
      approverFields: Array.isArray(s.approverFields) ? s.approverFields : [],
      // 條件式分支必須帶進 snapshot：執行引擎讀的是 snapshot 而非流程定義
      condition: s.condition && s.condition.enabled ? s.condition : { enabled: false },
      nodeId: s.nodeId,
    });
  }

  if (!resolved.length) {
    return { error: '無法建立簽核步驟（可能缺少可用的簽核人）' };
  }
  // 重新編號，避免略過非必填步驟後 order 不連續
  const renumbered = resolved.map((s, i) => ({ ...s, order: i + 1 }));
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
      `SELECT COUNT(*) AS c FROM final_notify_receipts
       WHERE user_id = ? AND acked_at IS NULL`
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

/** 待財務部額度建檔確認的已核准信用額度單 */
function getPendingFinanceConfirmRequests() {
  return db
    .prepare(
      `${REQUEST_LIST_SELECT}
       WHERE r.status = 'approved'
         AND ${CREDIT_LIMIT_COND}
         AND r.id NOT IN (
           SELECT request_id FROM approval_actions WHERE step_name = ?
         )
       ORDER BY r.completed_at DESC, r.updated_at DESC`
    )
    .all(STEP_FINANCE_CONFIRM);
}

/** 財務已建檔、待申請人確認收到的信用額度單 */
function getPendingApplicantAckRequests(userId) {
  return db
    .prepare(
      `${REQUEST_LIST_SELECT}
       WHERE r.status = 'approved'
         AND r.requester_id = ?
         AND ${CREDIT_LIMIT_COND}
         AND r.id IN (
           SELECT request_id FROM approval_actions WHERE step_name = ?
         )
         AND r.id NOT IN (
           SELECT request_id FROM approval_actions WHERE step_name = ?
         )
       ORDER BY r.completed_at DESC, r.updated_at DESC`
    )
    .all(Number(userId), STEP_FINANCE_CONFIRM, STEP_APPLICANT_ACK);
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
  // v2 圖模型：flow_json 為真相來源；steps 仍供既有 UI／PDF 使用
  const flowVersion = Number(r.flow_version) === 2 ? 2 : 1;
  const flow =
    flowVersion === 2 ? flowGraph.normalizeGraph(r.flow_json) : null;
  return {
    ...r,
    steps: parseSteps(r.steps_json) || [],
    formFields: parseFormFields(r.form_fields_json),
    pdfLayout,
    finalNotify,
    flowVersion,
    flow,
    steps_json: undefined,
    form_fields_json: undefined,
    pdf_layout_json: undefined,
    final_notify_json: undefined,
    flow_json: undefined,
  };
}

/** 依 flow_version 取出可執行的流程圖（v1 自動轉成直線圖） */
function getWorkflowGraph(row) {
  if (Number(row.flow_version) === 2) {
    const g = flowGraph.normalizeGraph(row.flow_json);
    if (g) return g;
  }
  return flowGraph.linearToGraph(parseSteps(row.steps_json) || []);
}

/**
 * 把「已解析出實際簽核人」的結果寫回流程圖節點。
 * 動態指派（部門主管、表單人員、申請人自選…）在送單當下才知道是誰，
 * 沿用既有 resolveStepsForRequest 的解析結果，再依 nodeId 對回節點。
 */
function buildResolvedGraph(wfRow, resolvedSteps) {
  const graph = getWorkflowGraph(wfRow);
  const byNodeId = new Map();
  for (const s of resolvedSteps || []) {
    if (s.nodeId) byNodeId.set(s.nodeId, s);
  }
  // v1 轉出的圖節點 id 為 n<order>，解析結果沒有 nodeId 時用 order 對應
  const byOrder = new Map((resolvedSteps || []).map((s) => [Number(s.order), s]));

  const nodes = graph.nodes.map((n) => {
    if (n.type !== 'approval') return n;
    const r =
      byNodeId.get(n.id) ||
      (n.legacyOrder != null ? byOrder.get(Number(n.legacyOrder)) : null);
    if (!r) return n;
    return {
      ...n,
      approverIds: Array.isArray(r.approverIds) ? r.approverIds : n.approverIds,
      mode: r.mode || n.mode,
      resolveNote: r.resolveNote || '',
      approverFields: r.approverFields || n.approverFields,
    };
  });
  return flowGraph.normalizeGraph({ version: 2, nodes, edges: graph.edges });
}

/**
 * 取單據當下應使用的流程圖：送單時凍結的快照。
 * getRequestDetail 已把 flow_snapshot_json 正規化成 detail.flow，
 * 並將原始欄位設為 undefined，故這裡讀 detail.flow。
 */
function getRequestGraph(detail) {
  if (detail?.flow) {
    const g = flowGraph.normalizeGraph(detail.flow);
    if (g) return g;
  }
  if (detail?.flow_snapshot_json) {
    return flowGraph.normalizeGraph(detail.flow_snapshot_json);
  }
  return null;
}

/** 此單據是否走 v2 圖引擎 */
function isGraphRequest(detail) {
  return !!getRequestGraph(detail);
}

/**
 * 找出這位使用者目前實際可簽的關卡。
 * v1：就是 current_step 指到的那一關。
 * v2：可能有多個並行待簽節點，取這位使用者有權簽的那個；
 *     都沒有權限時退回 current_step，讓後續權限檢查給出正確錯誤訊息。
 */
function resolveActionableStep(detail, steps, userId, requestId) {
  const fallback = findStepByOrder(steps, detail.current_step);
  const graph = getRequestGraph(detail);
  if (!graph) return fallback;

  const pending = flowEngine.pendingNodes(requestId);
  if (!pending.length) return fallback;

  const idx = flowEngine.indexGraph(graph);
  const candidates = pending
    .map((nid) => {
      const node = idx.byId.get(nid);
      if (!node || node.type !== 'approval') return null;
      // 轉成 v1 step 形狀，讓既有的權限檢查／簽核流程完全沿用
      const legacy = steps.find((s) => s.nodeId === nid);
      return {
        order: legacy?.order ?? node.legacyOrder ?? 0,
        name: node.name,
        assignType: node.assignType,
        formFieldId: node.formFieldId,
        department: node.department,
        approverIds: node.approverIds || [],
        mode: node.mode,
        approverFields: node.approverFields || [],
        nodeId: nid,
      };
    })
    .filter(Boolean);

  for (const c of candidates) {
    if (checkUserApprovalRight(userId, c, requestId).canApprove) return c;
  }
  return candidates[0] || fallback;
}

const flowEngine = flowEngineFactory.makeEngine(db);

function getRequestDetail(id) {
  const row = db
    .prepare(
      `SELECT r.*, w.name AS workflow_name, w.steps_json, w.form_fields_json, w.pdf_layout_json,
              w.final_notify_json,
              u.name AS requester_name, u.department AS requester_dept,
              u.username AS requester_username, u.email AS requester_email
       FROM approval_requests r
       JOIN workflows w ON w.id = r.workflow_id
       JOIN users u ON u.id = r.requester_id
       WHERE r.id = ?`
    )
    .get(id);
  if (!row) return null;

  const actions = db
    .prepare(
      // LEFT JOIN：系統動作（條件式跳關）沒有操作者，actor_id 為 NULL，
      // 用 INNER JOIN 會讓這些稽核紀錄整筆消失
      `SELECT a.*, u.name AS actor_name, u.username AS actor_username,
              du.name AS delegated_for_name, du.username AS delegated_for_username
       FROM approval_actions a
       LEFT JOIN users u ON u.id = a.actor_id
       LEFT JOIN users du ON du.id = a.delegated_for_id
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
    const labels = formatUserLabels(ids);
    formDataDisplay[`${key}__name`] = labels;
    formDataDisplay[`${key}__label`] = labels;
  }
  // 會簽人員 cosign_N（可多位：1,2,3）
  for (const key of Object.keys(form_data)) {
    if (!/^cosign_\d+$/.test(key)) continue;
    const ids = parseCosignIds(form_data[key]);
    if (!ids || !ids.length) {
      formDataDisplay[`${key}__label`] = '略過（無會簽）';
      continue;
    }
    const labels = formatUserLabels(ids);
    formDataDisplay[`${key}__label`] = labels;
    formDataDisplay[`${key}__name`] = labels;
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
    let sigImg = a.signature_image || null;
    if (!sigImg && a.actor_id && a.action === 'approve') {
      const uSig = db.prepare(`SELECT signature_image FROM users WHERE id = ?`).get(a.actor_id);
      if (uSig?.signature_image) sigImg = uSig.signature_image;
    }
    return {
      ...a,
      form_data: fd,
      signature_image: sigImg,
      delegated_for_name: a.delegated_for_name || null,
    };
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

  // v2 圖模型：附上凍結的流程圖與各節點實際狀態，供前端畫流程圖
  const graph = row.flow_snapshot_json
    ? flowGraph.normalizeGraph(row.flow_snapshot_json)
    : null;

  return {
    ...row,
    form_data: formDataDisplay,
    formFields,
    steps,
    actions: actionsEnriched,
    approver_data,
    attachments: getAttachments(id),
    notify_prefs,
    pdfLayout,
    finalNotify,
    finalNotifyReceipts,
    flow: graph,
    nodeStates: graph ? flowEngine.nodeStates(id) : null,
    form_schema_json: undefined,
    form_fields_json: undefined,
    pdf_layout_json: undefined,
    final_notify_json: undefined,
    steps_snapshot_json: undefined,
    flow_snapshot_json: undefined,
    approver_data_json: undefined,
    notify_prefs_json: undefined,
  };
}

/** 檢查使用者目前是否有生效中的簽核代理人設定 */
function getActiveDelegationForUser(grantorUserId) {
  const row = db
    .prepare(
      `SELECT d.*, u.name AS delegate_name, u.username AS delegate_username
       FROM user_delegations d
       JOIN users u ON u.id = d.delegate_user_id
       WHERE d.user_id = ? AND d.active = 1
       ORDER BY d.id DESC LIMIT 1`
    )
    .get(Number(grantorUserId));
  if (!row) return null;
  const now = tz.nowMinute();
  if (row.start_time && row.start_time > now) return null;
  if (row.end_time && row.end_time < now) return null;
  return row;
}

/** 取得某代理人 (delegateUserId) 目前代理授權發起人 ID 清單 */
function getGrantorUserIdsForDelegate(delegateUserId) {
  const rows = db
    .prepare(
      `SELECT d.user_id, d.start_time, d.end_time, u.name AS grantor_name, u.username AS grantor_username
       FROM user_delegations d
       JOIN users u ON u.id = d.user_id
       WHERE d.delegate_user_id = ? AND d.active = 1 AND u.active = 1`
    )
    .all(Number(delegateUserId));
  const now = tz.nowMinute();
  const activeList = [];
  for (const r of rows) {
    if (r.start_time && r.start_time > now) continue;
    if (r.end_time && r.end_time < now) continue;
    activeList.push(r);
  }
  return activeList;
}

/**
 * 判斷使用者是否可簽核某步驟（支援直接簽核與代理簽核）
 * @returns {{ canApprove: boolean, isDelegated: boolean, delegatedFor?: { id: number, name: string } }}
 */
function checkUserApprovalRight(userId, step, requestId) {
  if (!step || !Array.isArray(step.approverIds)) return { canApprove: false, isDelegated: false };
  const ids = step.approverIds.map(Number);
  const uid = Number(userId);

  // 1. 本人直接為簽核人
  if (ids.includes(uid)) {
    if (step.mode !== 'all') return { canApprove: true, isDelegated: false };
    const already = db
      .prepare(
        `SELECT id FROM approval_actions
         WHERE request_id = ? AND step_order = ? AND actor_id = ? AND action = 'approve'`
      )
      .get(requestId, Number(step.order), uid);
    if (!already) return { canApprove: true, isDelegated: false };
  }

  // 2. 作為代理人代簽
  const grantors = getGrantorUserIdsForDelegate(uid);
  for (const g of grantors) {
    if (ids.includes(Number(g.user_id))) {
      if (step.mode !== 'all') {
        return {
          canApprove: true,
          isDelegated: true,
          delegatedFor: { id: g.user_id, name: g.grantor_name, username: g.grantor_username },
        };
      }
      const alreadyG = db
        .prepare(
          `SELECT id FROM approval_actions
           WHERE request_id = ? AND step_order = ? AND (actor_id = ? OR actor_id = ? OR delegated_for_id = ?) AND action = 'approve'`
        )
        .get(requestId, Number(step.order), Number(g.user_id), uid, Number(g.user_id));
      if (!alreadyG) {
        return {
          canApprove: true,
          isDelegated: true,
          delegatedFor: { id: g.user_id, name: g.grantor_name, username: g.grantor_username },
        };
      }
    }
  }

  return { canApprove: false, isDelegated: false };
}

function canUserApproveStep(userId, step, requestId) {
  return checkUserApprovalRight(userId, step, requestId).canApprove;
}

function isStepComplete(requestId, step) {
  if (!step) return false;
  const stepOrder = Number(step.order);
  if (step.mode !== 'all') {
    const row = db
      .prepare(
        `SELECT id FROM approval_actions
         WHERE request_id = ? AND step_order = ? AND action = 'approve' LIMIT 1`
      )
      .get(requestId, stepOrder);
    return !!row;
  }
  // all：全部簽核人皆需核准
  for (const aid of step.approverIds || []) {
    const row = db
      .prepare(
        `SELECT id FROM approval_actions
         WHERE request_id = ? AND step_order = ? AND actor_id = ? AND action = 'approve'`
      )
      .get(requestId, stepOrder, Number(aid));
    if (!row) return false;
  }
  return (step.approverIds || []).length > 0;
}

/**
 * 評估關卡條件式動態分支 (Conditional Routing)
 */
function evaluateStepCondition(step, detail) {
  if (!step?.condition || !step.condition.enabled) return { required: true };
  const { fieldId, operator, value, action } = step.condition;
  if (!fieldId || !operator) return { required: true };

  const formData = detail?.form_data || {};
  let rawVal = formData[fieldId];
  if (rawVal == null || rawVal === '') {
    if (fieldId === 'days' || fieldId === 'hours' || fieldId === 'amount' || fieldId === 'total_amount') {
      rawVal = formData[fieldId] ?? formData['days'] ?? formData['hours'] ?? formData['金額'] ?? formData['總金額'] ?? 0;
    } else {
      rawVal = '';
    }
  }

  const numVal = Number(rawVal);
  const numTarget = Number(value);
  const isNumeric = !Number.isNaN(numVal) && !Number.isNaN(numTarget);

  let matched = false;
  if (isNumeric) {
    if (operator === '>') matched = numVal > numTarget;
    else if (operator === '>=') matched = numVal >= numTarget;
    else if (operator === '<') matched = numVal < numTarget;
    else if (operator === '<=') matched = numVal <= numTarget;
    else if (operator === '==') matched = numVal === numTarget;
    else if (operator === '!=') matched = numVal !== numTarget;
  } else {
    const strVal = String(rawVal ?? '').trim();
    const strTarget = String(value ?? '').trim();
    if (operator === '==') matched = strVal === strTarget;
    else if (operator === '!=') matched = strVal !== strTarget;
    else if (operator === 'contains') matched = strVal.includes(strTarget);
  }

  const fieldLabel = fieldId === 'days' ? '天數' : fieldId === 'hours' ? '小時' : fieldId === 'amount' ? '金額' : fieldId;

  if (action === 'skip') {
    // skip = 符合條件時跳過
    return {
      required: !matched,
      reason: matched
        ? `符合跳關條件 (${fieldLabel} ${operator} ${value})，動態自動跳過關卡`
        : `未達跳關條件 (${fieldLabel} ${operator} ${value})，進行簽核`,
    };
  } else {
    // require (預設) = 符合條件才需要簽核，未符合則自動跳過
    return {
      required: matched,
      reason: matched
        ? `符合簽核條件 (${fieldLabel} ${operator} ${value})，進入本關簽核`
        : `未達簽核門檻 (${fieldLabel} ${operator} ${value})，動態自動跳過關卡`,
    };
  }
}

/**
 * 推進至下一個符合條件的簽核步驟 (可連續跳過多個不符合條件的關卡)
 */
function advanceToNextEligibleStep(id, detail, steps, currentStep) {
  let idx = steps.findIndex((s) => Number(s.order) === Number(currentStep.order));
  let nextIdx = idx < 0 ? 0 : idx + 1;
  let finalNextStep = null;

  while (nextIdx < steps.length) {
    const candidate = steps[nextIdx];
    const cond = evaluateStepCondition(candidate, detail);
    if (cond.required) {
      finalNextStep = candidate;
      break;
    } else {
      // 記錄系統自動略過動作（actor_id 為 NULL：非人為操作，
      // 舊版寫 0 會違反 users 外鍵，加上 CHECK 不含 'system'，跳關必定拋例外）
      db.prepare(
        `INSERT INTO approval_actions (request_id, step_order, step_name, actor_id, action, comment, form_data)
         VALUES (?, ?, ?, NULL, 'system', ?, '{}')`
      ).run(id, Number(candidate.order), candidate.name, `[動態條件跳關] ${cond.reason}`);
      nextIdx++;
    }
  }

  if (finalNextStep) {
    db.prepare(
      `UPDATE approval_requests SET current_step = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`
    ).run(finalNextStep.order, id);
    return {
      mailEvent: 'step',
      nextStepName: finalNextStep.name || `步驟 ${finalNextStep.order}`,
      nextStep: finalNextStep,
    };
  } else {
    db.prepare(
      `UPDATE approval_requests SET status = 'approved', completed_at = datetime('now', 'localtime'),
       updated_at = datetime('now', 'localtime') WHERE id = ?`
    ).run(id);
    return { mailEvent: 'approved', nextStepName: '', nextStep: null };
  }
}

function isValidDepartment(name) {
  if (!name) return true; // optional
  const row = db
    .prepare(`SELECT id FROM departments WHERE name = ? AND active = 1`)
    .get(String(name).trim());
  return !!row;
}

// ---------- Departments ----------
/**
 * 台灣國定假日／補班（請假試算用）
 * GET：需登入；POST refresh：管理員強制從遠端更新
 */
app.get('/api/tw-calendar', authMiddleware, (req, res) => {
  res.json(twCalendar.getPublic());
});

app.get('/api/tw-calendar/detail', authMiddleware, adminOnly, (req, res) => {
  res.json(twCalendar.getDetail());
});

app.post('/api/tw-calendar/refresh', authMiddleware, adminOnly, async (req, res) => {
  try {
    const data = await twCalendar.refresh({ force: true });
    res.json({ ok: true, ...data });
  } catch (e) {
    res.status(500).json({ error: e.message || '更新失敗' });
  }
});

app.get('/api/departments', authMiddleware, (req, res) => {
  const departments = db
    .prepare(
      `SELECT id, name, sort_order FROM departments WHERE active = 1 ORDER BY sort_order ASC, id ASC`
    )
    .all();
  res.json({ departments });
});

app.get('/api/departments/stats', authMiddleware, (req, res) => {
  const departments = db
    .prepare(
      `SELECT d.id, d.name, d.sort_order,
              (
                SELECT COUNT(DISTINCT u.id) FROM users u
                WHERE u.active = 1 AND (
                  u.department = d.name
                  OR EXISTS (
                    SELECT 1 FROM user_departments ud
                    WHERE ud.user_id = u.id AND ud.department = d.name
                  )
                )
              ) AS member_count
       FROM departments d
       WHERE d.active = 1
       ORDER BY d.sort_order ASC, d.id ASC`
    )
    .all()
    .map((d) => {
      const members = db
        .prepare(
          `SELECT DISTINCT u.id, u.username, u.name, u.role, u.email, u.department
           FROM users u
           WHERE u.active = 1 AND (
             u.department = ?
             OR EXISTS (
               SELECT 1 FROM user_departments ud
               WHERE ud.user_id = u.id AND ud.department = ?
             )
           )
           ORDER BY
             CASE WHEN u.role = 'admin' THEN 0 ELSE 1 END,
             u.name COLLATE NOCASE`
        )
        .all(d.name, d.name)
        .map((m) => ({
          ...m,
          departments: getUserDepartments(m.id),
        }));
      return { ...d, members };
    });
  res.json({ departments });
});

/** 將已註冊成員加入部門（可同時隸屬多個部門） */
app.post('/api/departments/:id/members', authMiddleware, adminOnly, (req, res) => {
  const id = Number(req.params.id);
  const dept = db.prepare(`SELECT * FROM departments WHERE id = ? AND active = 1`).get(id);
  if (!dept) return res.status(404).json({ error: '找不到部門' });

  let userIds = req.body?.user_ids;
  if (!Array.isArray(userIds)) userIds = [];
  userIds = userIds.map(Number).filter(Boolean);
  if (!userIds.length) {
    return res.status(400).json({ error: '請選擇至少一位已註冊成員' });
  }

  const added = [];
  const skipped = [];
  for (const uid of userIds) {
    try {
      const already = db
        .prepare(
          `SELECT 1 FROM user_departments WHERE user_id = ? AND department = ?`
        )
        .get(uid, dept.name);
      if (already) {
        skipped.push(uid);
        continue;
      }
      addUserToDepartment(uid, dept.name);
      added.push(uid);
    } catch (e) {
      skipped.push(uid);
    }
  }
  res.json({
    ok: true,
    department: dept.name,
    added_count: added.length,
    skipped_count: skipped.length,
    added,
    skipped,
  });
});

/** 移出部門成員（僅移出該部門，帳號保留，其他部門隸屬保留） */
app.delete(
  '/api/departments/:id/members/:userId',
  authMiddleware,
  adminOnly,
  (req, res) => {
    const id = Number(req.params.id);
    const userId = Number(req.params.userId);
    const dept = db.prepare(`SELECT * FROM departments WHERE id = ? AND active = 1`).get(id);
    if (!dept) return res.status(404).json({ error: '找不到部門' });
    removeUserFromDepartment(userId, dept.name);
    res.json({ ok: true });
  }
);

/** 系統管理員新增部門 */
app.post('/api/departments', authMiddleware, adminOnly, (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: '請輸入部門名稱' });
  if (name.length > 40) return res.status(400).json({ error: '部門名稱請勿超過 40 字' });

  const existing = db
    .prepare(`SELECT id, active FROM departments WHERE name = ?`)
    .get(name);
  if (existing) {
    if (existing.active) {
      return res.status(400).json({ error: '此部門名稱已存在' });
    }
    // 重新啟用已刪除的同名部門
    const maxSort = db.prepare(`SELECT COALESCE(MAX(sort_order), 0) AS m FROM departments`).get().m;
    db.prepare(
      `UPDATE departments SET active = 1, sort_order = ? WHERE id = ?`
    ).run(maxSort + 1, existing.id);
    const row = db
      .prepare(`SELECT id, name, sort_order, active FROM departments WHERE id = ?`)
      .get(existing.id);
    return res.status(201).json({ department: row });
  }

  try {
    const maxSort = db.prepare(`SELECT COALESCE(MAX(sort_order), 0) AS m FROM departments`).get().m;
    const info = db
      .prepare(`INSERT INTO departments (name, sort_order, active) VALUES (?, ?, 1)`)
      .run(name, maxSort + 1);
    const row = db
      .prepare(`SELECT id, name, sort_order, active FROM departments WHERE id = ?`)
      .get(info.lastInsertRowid);
    res.status(201).json({ department: row });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return res.status(400).json({ error: '此部門名稱已存在' });
    }
    console.error(e);
    res.status(500).json({ error: '新增部門失敗' });
  }
});

/** 系統管理員修改部門名稱（同步更新成員所屬部門） */
app.put('/api/departments/:id', authMiddleware, adminOnly, (req, res) => {
  const id = Number(req.params.id);
  const newName = String(req.body?.name || '').trim();
  if (!newName) return res.status(400).json({ error: '請輸入部門名稱' });
  if (newName.length > 40) return res.status(400).json({ error: '部門名稱請勿超過 40 字' });

  const dept = db.prepare(`SELECT * FROM departments WHERE id = ? AND active = 1`).get(id);
  if (!dept) return res.status(404).json({ error: '找不到部門' });
  if (dept.name === newName) {
    return res.json({
      department: { id: dept.id, name: dept.name, sort_order: dept.sort_order, active: dept.active },
    });
  }

  const clash = db
    .prepare(`SELECT id, active FROM departments WHERE name = ? AND id != ?`)
    .get(newName, id);
  if (clash && clash.active) {
    return res.status(400).json({ error: '此部門名稱已存在' });
  }
  // 若有停用的同名部門，先改掉其名稱以免 UNIQUE 衝突
  if (clash && !clash.active) {
    db.prepare(`UPDATE departments SET name = ? WHERE id = ?`).run(
      `${newName}__old_${clash.id}`,
      clash.id
    );
  }

  const oldName = dept.name;
  try {
    db.prepare(`UPDATE departments SET name = ? WHERE id = ?`).run(newName, id);
    // 同步成員主部門、多部門隸屬、備份索引
    db.prepare(`UPDATE users SET department = ? WHERE department = ?`).run(newName, oldName);
    db.prepare(`UPDATE user_departments SET department = ? WHERE department = ?`).run(
      newName,
      oldName
    );
    try {
      db.prepare(`UPDATE backup_files SET department = ? WHERE department = ?`).run(
        newName,
        oldName
      );
    } catch {
      /* backup table may be empty / ignore */
    }
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return res.status(400).json({ error: '此部門名稱已存在' });
    }
    console.error(e);
    return res.status(500).json({ error: '修改部門名稱失敗' });
  }

  const row = db
    .prepare(`SELECT id, name, sort_order, active FROM departments WHERE id = ?`)
    .get(id);
  res.json({ department: row, renamed_from: oldName });
});

/** 系統管理員刪除部門（軟刪除；有成員時不可刪） */
app.delete('/api/departments/:id', authMiddleware, adminOnly, (req, res) => {
  const id = Number(req.params.id);
  const dept = db.prepare(`SELECT * FROM departments WHERE id = ? AND active = 1`).get(id);
  if (!dept) return res.status(404).json({ error: '找不到部門' });

  const memberCount = db
    .prepare(
      `SELECT COUNT(DISTINCT u.id) AS c FROM users u
       WHERE u.active = 1 AND (
         u.department = ?
         OR EXISTS (
           SELECT 1 FROM user_departments ud
           WHERE ud.user_id = u.id AND ud.department = ?
         )
       )`
    )
    .get(dept.name, dept.name).c;
  if (memberCount > 0) {
    return res.status(400).json({
      error: `「${dept.name}」尚有 ${memberCount} 位成員，請先將成員「移出部門」後再刪`,
    });
  }

  db.prepare(`UPDATE departments SET active = 0 WHERE id = ?`).run(id);
  res.json({ ok: true, id });
});

// ---------- Auth ----------
/** 不開放自行註冊；帳號僅能由管理員在「成員名單」建立 */
app.post('/api/auth/register', (req, res) => {
  logAudit(req, {
    action_type: 'register_blocked',
    category: 'auth',
    description: '拒絕公開自行註冊',
  });
  return res.status(403).json({ error: '不開放自行註冊，請洽系統管理員建立帳號' });
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

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: '請輸入帳號與密碼' });
  }
  const uStr = String(username).trim();
  const pStr = String(password);
  const pTrim = pStr.trim();
  const ip = getClientIp(req);
  const limited = loginRateLimit.checkLogin(ip, uStr);
  if (limited.blocked) {
    const msg = loginRateLimit.lockMessage(limited.remainingSec);
    res.setHeader('Retry-After', String(limited.remainingSec || 60));
    logAudit(req, {
      action_type: 'login_rate_limited',
      category: 'auth',
      description: `登入次數過多已鎖定（帳號：${uStr}）`,
    });
    return res.status(429).json({ error: msg });
  }
  const user = findUserByUsername(uStr, { activeOnly: true });
  if (!user || (!verifyPassword(pStr, user.password_hash) && !verifyPassword(pTrim, user.password_hash))) {
    const after = loginRateLimit.recordFail(ip, uStr);
    logAudit(req, { action_type: 'login_fail', category: 'auth', description: `登入失敗（帳號：${uStr}）` });
    if (after.blocked) {
      const msg = loginRateLimit.lockMessage(after.remainingSec);
      res.setHeader('Retry-After', String(after.remainingSec || 60));
      logAudit(req, {
        action_type: 'login_rate_limited',
        category: 'auth',
        description: `登入失敗達上限已鎖定（帳號：${uStr}）`,
      });
      return res.status(429).json({ error: msg });
    }
    return res.status(401).json({ error: '帳號或密碼錯誤' });
  }
  loginRateLimit.recordSuccess(ip, uStr);
  const safe = publicUser(user);
  const token = signToken(safe);
  setAuthCookie(req, res, token);
  const mustChangePassword = hashMatchesWeakPassword(user.password_hash);
  logAudit(req, { action_type: 'login', category: 'auth', description: `使用者 ${safe.name} (${safe.username}) 登入成功` });
  res.json({
    ok: true,
    user: safe,
    permissionDefs: PERMISSION_DEFS,
    mustChangePassword,
  });
});

app.post('/api/auth/logout', (req, res) => {
  clearAuthCookie(req, res);
  res.json({ ok: true });
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
    mustChangePassword: hashMatchesWeakPassword(user.password_hash),
  });
});

app.put('/api/auth/password', authMiddleware, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword || String(newPassword).length < 6) {
    return res.status(400).json({ error: '請提供正確的舊密碼，且新密碼至少 6 字元' });
  }
  if (isWeakPlainPassword(newPassword)) {
    return res.status(400).json({ error: '新密碼過於常見，請改用更安全的密碼' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(currentPassword, user.password_hash)) {
    return res.status(400).json({ error: '舊密碼不正確' });
  }
  if (String(currentPassword) === String(newPassword)) {
    return res.status(400).json({ error: '新密碼不可與舊密碼相同' });
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), req.user.id);
  res.json({ ok: true, mustChangePassword: false });
});

/** 任何登入成員可自行修改：姓名、Email、分機、電話、Email 通知偏好 */
app.put('/api/auth/profile', authMiddleware, (req, res) => {
  const { name, email, phone, extension, email_notify } = req.body || {};
  if (name == null || !String(name).trim()) {
    return res.status(400).json({ error: '姓名為必填' });
  }
  const trimmedName = String(name).trim();
  if (trimmedName.length > 80) {
    return res.status(400).json({ error: '姓名過長（最多 80 字）' });
  }
  const emailVal = email != null ? String(email).trim() : '';
  if (emailVal && emailVal.length > 120) {
    return res.status(400).json({ error: 'Email 過長' });
  }
  if (emailVal && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
    return res.status(400).json({ error: 'Email 格式不正確' });
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

// ---------- 簽核代理人 ----------
app.get('/api/delegations/my', authMiddleware, (req, res) => {
  const activeDelegation = getActiveDelegationForUser(req.user.id);
  const rawDelegation = db
    .prepare(
      `SELECT d.*, u.name AS delegate_name, u.username AS delegate_username
       FROM user_delegations d
       JOIN users u ON u.id = d.delegate_user_id
       WHERE d.user_id = ?
       ORDER BY d.id DESC LIMIT 1`
    )
    .get(req.user.id);
  const grantors = getGrantorUserIdsForDelegate(req.user.id);
  res.json({
    activeDelegation,
    delegation: rawDelegation || null,
    grantors,
  });
});

app.post('/api/delegations/my', authMiddleware, (req, res) => {
  const { delegate_user_id, start_time, end_time, active } = req.body || {};
  const delegateId = Number(delegate_user_id);
  if (!delegateId) {
    return res.status(400).json({ error: '請選擇代理對象' });
  }
  if (delegateId === req.user.id) {
    return res.status(400).json({ error: '不能指定自己為代理人' });
  }
  const targetUser = db.prepare(`SELECT id, name FROM users WHERE id = ? AND active = 1`).get(delegateId);
  if (!targetUser) {
    return res.status(400).json({ error: '代理人帳號不存在或已停用' });
  }

  const startVal = start_time ? String(start_time).trim() : null;
  const endVal = end_time ? String(end_time).trim() : null;
  const isActive = active === false || active === 0 || active === '0' ? 0 : 1;

  // 將舊的代理設定設為停用
  db.prepare(`UPDATE user_delegations SET active = 0 WHERE user_id = ?`).run(req.user.id);

  db.prepare(
    `INSERT INTO user_delegations (user_id, delegate_user_id, start_time, end_time, active)
     VALUES (?, ?, ?, ?, ?)`
  ).run(req.user.id, delegateId, startVal, endVal, isActive);

  const current = getActiveDelegationForUser(req.user.id);
  res.json({ ok: true, delegation: current, message: `已成功設定 ${targetUser.name} 為您的簽核代理人` });
});

app.delete('/api/delegations/my', authMiddleware, (req, res) => {
  db.prepare(`UPDATE user_delegations SET active = 0 WHERE user_id = ?`).run(req.user.id);
  res.json({ ok: true, message: '已取消簽核代理設定' });
});

// ---------- 電子簽名檔 ----------
app.get('/api/users/me/signature', authMiddleware, (req, res) => {
  const row = db.prepare(`SELECT signature_image FROM users WHERE id = ?`).get(req.user.id);
  res.json({ signature_image: row?.signature_image || null });
});

app.post('/api/users/me/signature', authMiddleware, (req, res) => {
  const sig = req.body?.signature_image || req.body?.signature;
  if (!sig || !String(sig).startsWith('data:image/')) {
    return res.status(400).json({ error: '請提供有效的圖檔 Base64 簽名資料' });
  }
  db.prepare(`UPDATE users SET signature_image = ? WHERE id = ?`).run(String(sig), req.user.id);
  res.json({ ok: true, signature_image: String(sig), message: '已儲存個人預設手寫簽名檔' });
});

app.delete('/api/users/me/signature', authMiddleware, (req, res) => {
  db.prepare(`UPDATE users SET signature_image = NULL WHERE id = ?`).run(req.user.id);
  res.json({ ok: true, message: '已清除個人預設手寫簽名檔' });
});

// ---------- LINE 通知設定 ----------
app.get('/api/line/config', authMiddleware, (req, res) => {
  const pub = lineNotify.publicConfig();
  const canConfigure = canConfigureLineSettings(req.user);
  if (!canConfigure) {
    return res.json({
      enabled: pub.enabled,
      ready: pub.ready,
      canConfigure: false,
      configAccess: pub.configAccess,
    });
  }
  res.json({ ...pub, canConfigure: true });
});

app.put('/api/line/config', authMiddleware, lineSettingsOnly, (req, res) => {
  const body = req.body || {};
  const partial = {
    enabled: body.enabled,
    serviceUrl: body.serviceUrl,
    events: body.events,
    configAccess: body.configAccess,
  };
  // 空字串＝不變更 API Key（與 mail 密碼相同）
  if (body.apiKey != null && String(body.apiKey).trim() !== '') {
    partial.apiKey = String(body.apiKey).trim();
  } else {
    partial.apiKey = '';
  }
  // 僅內建 Admin 可變更「誰可設定 LINE」，避免權限被下放後失控
  if (!isBuiltinAdminUsername(req.user.username)) {
    delete partial.configAccess;
  }
  const saved = lineNotify.saveConfig(partial);
  res.json({
    ok: true,
    config: { ...lineNotify.publicConfig(saved), canConfigure: true },
  });
});

app.post('/api/line/test', authMiddleware, lineSettingsOnly, async (req, res) => {
  const username = String(req.body?.username || req.user.username || '').trim();
  const lineUserId = String(req.body?.lineUserId || '').trim();
  const text = String(req.body?.text || '').trim();
  if (!username && !lineUserId) {
    return res.status(400).json({ error: '請指定簽核帳號或 LINE userId' });
  }
  if (!lineNotify.isReady()) {
    return res.status(400).json({
      error: '請先啟用 LINE 通知並填寫服務網址與 API 金鑰後儲存',
    });
  }
  const result = await lineNotify.testPush({
    username: username || undefined,
    lineUserId: lineUserId || undefined,
    text: text || undefined,
  });
  if (!result.ok) {
    return res.status(400).json({ error: result.error || '測試推播失敗', result });
  }
  res.json({ ok: true, result });
});

app.get('/api/line/health', authMiddleware, lineSettingsOnly, async (req, res) => {
  const result = await lineNotify.healthCheck();
  res.json(result);
});

app.get('/api/line/bindings', authMiddleware, lineSettingsOnly, async (req, res) => {
  const result = await lineNotify.fetchBindings();
  if (!result.ok) {
    return res.status(400).json({ error: result.error || '無法取得綁定列表' });
  }
  res.json(result);
});

// ---------- Mail settings ----------
app.get('/api/mail/config', authMiddleware, (req, res) => {
  // 所有登入者可見是否啟用；完整 SMTP 僅管理員
  const pub = mail.publicConfig();
  if (req.user.role !== 'admin') {
    return res.json({
      enabled: pub.enabled,
      ready: pub.ready,
      fromName: pub.fromName,
    });
  }
  res.json(pub);
});

app.put('/api/mail/config', authMiddleware, builtinAdminOnly, (req, res) => {
  const body = req.body || {};
  const saved = mail.saveConfig({
    enabled: body.enabled,
    host: body.host,
    port: body.port,
    secure: body.secure,
    ignoreTLS: body.ignoreTLS,
    requireTLS: body.requireTLS,
    tlsRejectUnauthorized: body.tlsRejectUnauthorized,
    user: body.user,
    pass: body.pass,
    from: body.from,
    fromName: body.fromName,
    baseUrl: body.baseUrl,
  });
  res.json({ ok: true, config: mail.publicConfig(saved) });
});

app.post('/api/mail/test', authMiddleware, builtinAdminOnly, async (req, res) => {
  const to = String(req.body?.to || '').trim() || req.user.email;
  // 從 DB 取管理員 email
  const me = db.prepare(`SELECT email, name FROM users WHERE id = ?`).get(req.user.id);
  const target = to || me?.email;
  if (!target) {
    return res.status(400).json({ error: '請指定測試收件 Email，或先在帳號設定填寫自己的 Email' });
  }
  if (!mail.isEnabled()) {
    return res.status(400).json({ error: '請先啟用 Email 提醒並儲存設定' });
  }
  const result = await mail.sendMail({
    to: target,
    subject: '【簽核系統】Email 測試信',
    text: `您好 ${me?.name || ''}，\n\n這是線上簽核系統的測試信件。若您收到此信，表示 SMTP 設定正常。\n`,
    html: `<p>您好 <strong>${me?.name || ''}</strong>，</p><p>這是線上簽核系統的測試信件。若您收到此信，表示 SMTP 設定正常。</p>`,
    meta: { type: 'test' },
  });
  if (!result.ok) {
    return res.status(400).json({ error: result.error || '寄送失敗', result });
  }
  res.json({ ok: true, result });
});

// ---------- 系統設定（僅內建 Admin 帳號，其他最高權限亦不可見）----------
const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
});

/** 公開：登入頁品牌（公司名／Logo／版本），不含部門與簽章狀態 */
app.get('/api/system/branding', (req, res) => {
  res.json(systemSettings.getBrandingSettings());
});

/** 已登入：公司名稱／Logo／版本／是否啟用 PDF 簽章 */
app.get('/api/system/settings', authMiddleware, (req, res) => {
  res.json(systemSettings.getPublicSettings());
});

/** 已登入：應用程式版本宣告 */
app.get('/api/system/version', authMiddleware, (req, res) => {
  res.json(appVersion.getVersionInfo());
});

/** 內建 Admin：自動部署／修改紀錄 */
app.get('/api/system/deploy-log', authMiddleware, builtinAdminOnly, (req, res) => {
  const limit = req.query.limit || 30;
  res.json({
    ok: true,
    latest: deployLog.getLatest(),
    ...deployLog.listHistory(limit),
  });
});

/** 公開：自訂 Logo 圖檔（無自訂則 404，前端改用預設） */
app.get('/api/system/logo', (req, res) => {
  const filePath = systemSettings.getLogoFilePath();
  if (!filePath) return res.status(404).end();
  res.sendFile(filePath);
});

/** 內建 Admin：完整系統設定（含 PDF 簽章狀態，不含明文密碼） */
app.get('/api/system/settings/admin', authMiddleware, builtinAdminOnly, (req, res) => {
  const settings = systemSettings.getAdminSettings();
  const sign = pdfSign.getSigningStatus();
  res.json({
    ...settings,
    pdfSign: { ...(settings.pdfSign || {}), ...sign },
  });
});

app.put('/api/system/settings', authMiddleware, builtinAdminOnly, (req, res) => {
  try {
    const body = req.body || {};
    systemSettings.updateSettings({
      companyName: body.companyName,
      pdfSignEnabled: body.pdfSignEnabled,
      pdfSignOnlyApproved: body.pdfSignOnlyApproved,
      pdfSignReason: body.pdfSignReason,
      pdfSignLocation: body.pdfSignLocation,
      pdfSignContact: body.pdfSignContact,
      pdfSignSignerName: body.pdfSignSignerName,
      pdfSignPass: body.pdfSignPass,
      pdfSignPassClear: body.pdfSignPassClear,
      backupEncryptEnabled: body.backupEncryptEnabled,
      backupEncryptPass: body.backupEncryptPass,
      backupEncryptPassClear: body.backupEncryptPassClear,
      ...(Object.prototype.hasOwnProperty.call(body, 'backupDir') ? { backupDir: body.backupDir } : {}),
    });
    res.json({
      ok: true,
      settings: systemSettings.getAdminSettings(),
      pdfSign: pdfSign.getSigningStatus(),
    });
  } catch (e) {
    res.status(400).json({ error: e.message || '儲存失敗' });
  }
});

app.post(
  '/api/system/logo',
  authMiddleware,
  builtinAdminOnly,
  logoUpload.single('logo'),
  (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: '請選擇 Logo 圖檔' });
      const settings = systemSettings.saveLogoFile({
        buffer: req.file.buffer,
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
      });
      res.json({ ok: true, settings });
    } catch (e) {
      res.status(400).json({ error: e.message || '上傳失敗' });
    }
  }
);

app.delete('/api/system/logo', authMiddleware, builtinAdminOnly, (req, res) => {
  try {
    const settings = systemSettings.clearLogo();
    res.json({ ok: true, settings });
  } catch (e) {
    res.status(400).json({ error: e.message || '清除失敗' });
  }
});

/** 登入使用者：讀取總覽公告（未啟用則 active=false） */
app.get('/api/announcement', authMiddleware, (req, res) => {
  res.json({ announcement: systemSettings.getAnnouncementPublic() });
});

/** 下載／檢視公告附件（需登入；未啟用或無檔則 404） */
app.get('/api/announcement/file', authMiddleware, (req, res) => {
  try {
    const ann = systemSettings.getAnnouncementPublic();
    if (!ann.active || !ann.hasFile) {
      return res.status(404).json({ error: '目前沒有可下載的公告附件' });
    }
    const info = systemSettings.getAnnouncementFilePath();
    if (!info) return res.status(404).json({ error: '附件不存在' });
    const inline = String(req.query.inline || '') === '1';
    const ext = path.extname(info.originalName || '').toLowerCase();
    const mimeMap = {
      '.pdf': 'application/pdf',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.txt': 'text/plain; charset=utf-8',
      '.csv': 'text/csv; charset=utf-8',
    };
    const mime = mimeMap[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    if (inline && mimeMap[ext]) {
      res.setHeader(
        'Content-Disposition',
        contentDispositionAttachment(info.originalName, info.storedName).replace(
          /^attachment/i,
          'inline'
        )
      );
    } else {
      res.setHeader(
        'Content-Disposition',
        contentDispositionAttachment(info.originalName, info.storedName)
      );
    }
    fs.createReadStream(info.fullPath).pipe(res);
  } catch (e) {
    res.status(400).json({ error: e.message || '下載失敗' });
  }
});

/** 內建 Admin：更新公告文字／啟用 */
app.put('/api/system/announcement', authMiddleware, builtinAdminOnly, (req, res) => {
  try {
    const body = req.body || {};
    const announcement = systemSettings.updateAnnouncement({
      enabled: body.enabled,
      title: body.title,
      body: body.body,
      startAt: body.startAt,
      endAt: body.endAt,
    });
    res.json({
      ok: true,
      announcement,
      settings: systemSettings.getAdminSettings(),
    });
  } catch (e) {
    res.status(400).json({ error: e.message || '儲存失敗' });
  }
});

const announceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
});

/** 內建 Admin：上傳公告附件 */
app.post(
  '/api/system/announcement/file',
  authMiddleware,
  builtinAdminOnly,
  (req, res, next) => {
    announceUpload.single('file')(req, res, (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: '附件請小於 15MB' });
        }
        return res.status(400).json({ error: err.message || '上傳失敗' });
      }
      next();
    });
  },
  (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: '請選擇附件檔案' });
      // 修正中文檔名（multer 預設 latin1）
      let originalname = req.file.originalname || 'attachment';
      try {
        originalname = Buffer.from(originalname, 'latin1').toString('utf8');
      } catch {
        /* keep */
      }
      const announcement = systemSettings.saveAnnouncementFile({
        buffer: req.file.buffer,
        originalname,
        mimetype: req.file.mimetype,
      });
      res.json({
        ok: true,
        announcement,
        settings: systemSettings.getAdminSettings(),
      });
    } catch (e) {
      res.status(400).json({ error: e.message || '上傳失敗' });
    }
  }
);

/** 內建 Admin：移除公告附件 */
app.delete('/api/system/announcement/file', authMiddleware, builtinAdminOnly, (req, res) => {
  try {
    const announcement = systemSettings.clearAnnouncementFile();
    res.json({
      ok: true,
      announcement,
      settings: systemSettings.getAdminSettings(),
    });
  } catch (e) {
    res.status(400).json({ error: e.message || '移除失敗' });
  }
});

const certUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

/** 上傳公司 PDF 數位簽章憑證（.p12 / .pfx） */
app.post(
  '/api/system/pdf-sign/cert',
  authMiddleware,
  builtinAdminOnly,
  certUpload.single('cert'),
  (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: '請選擇 .p12 或 .pfx 憑證檔' });
      const settings = systemSettings.savePdfSignCert({
        buffer: req.file.buffer,
        originalname: req.file.originalname,
      });
      // 若同表單有帶密碼一併更新
      if (req.body && req.body.passphrase != null && String(req.body.passphrase) !== '') {
        systemSettings.updateSettings({ pdfSignPass: req.body.passphrase });
      }
      res.json({
        ok: true,
        settings: systemSettings.getAdminSettings(),
        pdfSign: pdfSign.getSigningStatus(),
      });
    } catch (e) {
      res.status(400).json({ error: e.message || '上傳失敗' });
    }
  }
);

app.delete('/api/system/pdf-sign/cert', authMiddleware, builtinAdminOnly, (req, res) => {
  try {
    const settings = systemSettings.clearPdfSignCert();
    res.json({
      ok: true,
      settings,
      pdfSign: pdfSign.getSigningStatus(),
    });
  } catch (e) {
    res.status(400).json({ error: e.message || '清除失敗' });
  }
});

/**
 * 製作公司自簽數位簽章憑證（.p12）
 * 必填：commonName、organization、country、passphrase（與確認密碼）
 */
app.post('/api/system/pdf-sign/create', authMiddleware, builtinAdminOnly, (req, res) => {
  try {
    const result = systemSettings.createSelfSignedPdfSignCert(req.body || {});
    res.json({
      ok: true,
      message: '已製作並儲存自簽公司憑證',
      meta: result.meta,
      settings: result.settings,
      pdfSign: pdfSign.getSigningStatus(),
    });
  } catch (e) {
    console.error('[pdf-sign create]', e);
    res.status(400).json({ error: e.message || '製作憑證失敗' });
  }
});

/** 測試數位簽章（產生最小 PDF 並簽署；使用中文字型避免亂碼） */
app.post('/api/system/pdf-sign/test', authMiddleware, builtinAdminOnly, async (req, res) => {
  try {
    const PDFDocument = require('pdfkit');
    const { PassThrough } = require('stream');
    const chunks = [];
    const pass = new PassThrough();
    pass.on('data', (c) => chunks.push(c));
    const done = new Promise((resolve, reject) => {
      pass.on('end', resolve);
      pass.on('error', reject);
    });
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    doc.pipe(pass);

    // 註冊中文字型（與正式簽核 PDF 相同）
    let useCjk = false;
    const fontPath = getChineseFontPath();
    if (fontPath) {
      try {
        doc.registerFont('CJK', fontPath);
        doc.font('CJK');
        useCjk = true;
      } catch (e) {
        console.warn('[pdf-sign test] font register failed', e.message);
      }
    }
    const text = (str, opts) => {
      if (useCjk) {
        try {
          doc.font('CJK');
        } catch {
          /* ignore */
        }
      }
      doc.text(str, opts);
    };

    const company = systemSettings.getCompanyName();
    const now = new Date().toLocaleString('zh-TW', { hour12: false });
    doc.fontSize(18);
    text('PDF 數位簽章測試', { align: 'center' });
    doc.moveDown(1.2);
    doc.fontSize(12);
    text(`公司名稱：${company}`);
    text(`產生時間：${now}`);
    text('簽署者：' + (systemSettings.getPdfSignConfig().signerName || company));
    doc.moveDown(0.8);
    text('說明：若可正常開啟本檔，並在 Acrobat「簽名」面板看到簽章資訊，表示公司憑證設定正確。');
    doc.moveDown(0.5);
    text('注意：自簽憑證可能顯示「簽發者不被信任」，屬正常現象；內部使用不影響防竄改驗證。');
    doc.end();
    await done;
    let buf = Buffer.concat(chunks);
    // 測試時強制簽署（略過 onlyApproved）
    const cfg = systemSettings.getPdfSignConfig();
    if (!cfg.hasCert) throw new Error('請先上傳 .p12 / .pfx 憑證');
    buf = await pdfSign.signPdfBuffer(buf, {
      force: true,
      request: { id: 'TEST', workflow_name: '簽章測試' },
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      contentDispositionAttachment('簽章測試.pdf', 'pdf-sign-test.pdf')
    );
    res.send(buf);
  } catch (e) {
    console.error('[pdf-sign test]', e);
    res.status(400).json({ error: e.message || '測試簽署失敗' });
  }
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
    const hireDateRes = resolveNextHireDate(hire_date, user.hire_date);
    if (!hireDateRes.ok) return res.status(400).json({ error: hireDateRes.error });
    const nextHireDate = hireDateRes.value;
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
  const hireDateRes = resolveNextHireDate(hire_date, user.hire_date);
  if (!hireDateRes.ok) return res.status(400).json({ error: hireDateRes.error });
  const nextHireDate = hireDateRes.value;
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
    ['密碼', '選填；空白＝不變更既有密碼；新帳號空白則自動產生隨機密碼'],
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
      const pwd = generateBootstrapPassword();
      upd.run(hashPassword(pwd), u.id);
      passwordMap[u.id] = pwd;
    }
  }

  const wb = buildUsersWorkbook(users, {
    includePasswords: resetPasswords,
    passwordMap,
  });
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const fname = `成員名單_${tz.today()}.xlsx`;
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
      密碼: '',
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
                hashPassword(generateBootstrapPassword()),
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
            const pwd = passwordRaw || generateBootstrapPassword();
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

// ---------- Workflow export / import（流程＋表單＋PDF 排版一體模組）----------
// workflowModule 已於檔案頂部 require；匯出／匯入不碰系統設定、Email、使用者

function buildWorkflowExportItem(row) {
  let formFields = [];
  let steps = [];
  try {
    formFields = JSON.parse(row.form_fields_json || '[]') || [];
  } catch {
    formFields = [];
  }
  try {
    steps = JSON.parse(row.steps_json || '[]') || [];
  } catch {
    steps = [];
  }
  const stepsEnriched = (steps || []).map((s, i) => {
    const approverIds = Array.isArray(s.approverIds) ? s.approverIds.map(Number).filter(Boolean) : [];
    const approvers = approverIds.map((id) => {
      const u = db.prepare(`SELECT id, username, name FROM users WHERE id = ?`).get(id);
      return u
        ? { id: u.id, username: u.username, name: u.name }
        : { id, username: null, name: null };
    });
    return {
      order: s.order != null ? s.order : i + 1,
      name: s.name || `步驟${i + 1}`,
      assignType: s.assignType || 'users',
      mode: s.mode || 'any',
      formFieldId: s.formFieldId || '',
      department: s.department || '',
      approverIds,
      approvers,
      approverFields: Array.isArray(s.approverFields) ? s.approverFields : [],
      skipIfNoApprover: Boolean(s.skipIfNoApprover),
    };
  });
  const pdfLayout = workflowModule.parsePdfLayoutJson(row.pdf_layout_json, row.name);
  const finalNotify = enrichFinalNotifyUsers(
    workflowModule.parseFinalNotifyJson(row.final_notify_json)
  );
  return workflowModule.buildExportModule({
    id: row.id,
    name: row.name,
    description: row.description || '',
    formFields,
    steps: stepsEnriched,
    pdfLayout,
    finalNotify,
    exportedAt: tz.nowIso(),
  });
}

/** PDF 排版類型清單（流程編輯用） */
app.get('/api/workflows/pdf-layout-types', authMiddleware, requirePerm('workflows'), (req, res) => {
  res.json({ types: workflowModule.listPdfLayoutTypes() });
});

/** 匯出全部啟用中流程（一個 JSON 包：流程＋表單＋PDF 排版；不含系統設定） */
app.get('/api/workflows/export', authMiddleware, requirePerm('workflows'), (req, res) => {
  const rows = db
    .prepare(
      `SELECT * FROM workflows WHERE active = 1 AND IFNULL(purged, 0) = 0 ORDER BY id`
    )
    .all();
  const pack = {
    format: 'approval-system-workflows',
    version: 2,
    module: 'workflow+form+pdfLayout+finalNotify',
    note: '僅含簽核流程模組（表單欄位＋步驟＋PDF 排版＋最終核准通知）；不含系統設定／Email／使用者／歷史單據',
    exportedAt: tz.nowIso(),
    count: rows.length,
    workflows: rows.map(buildWorkflowExportItem),
  };
  const fname = `全部簽核流程_可匯入_${tz.today()}.json`;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="workflows-export.json"; filename*=UTF-8''${encodeURIComponent(fname)}`
  );
  res.send(JSON.stringify(pack, null, 2));
});

/** 匯出單一流程 */
app.get('/api/workflows/:id/export', authMiddleware, requirePerm('workflows'), (req, res) => {
  const row = db.prepare(`SELECT * FROM workflows WHERE id = ?`).get(Number(req.params.id));
  if (!row || row.purged) return res.status(404).json({ error: '找不到流程' });
  const item = buildWorkflowExportItem(row);
  const safe = String(row.name || 'workflow').replace(/[<>:"/\\|?*]/g, '_').slice(0, 40);
  const fname = `${safe}.json`;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="workflow.json"; filename*=UTF-8''${encodeURIComponent(fname)}`
  );
  res.send(JSON.stringify(item, null, 2));
});

/** 匯入流程 JSON（單一或全部包） */
app.post('/api/workflows/import', authMiddleware, requirePerm('workflows'), (req, res) => {
  try {
    let data = req.body;
    // 允許 body 直接是字串 JSON
    if (typeof data === 'string') {
      data = JSON.parse(data);
    }
    if (data && data.payload && typeof data.payload === 'object') {
      data = data.payload;
    }
    if (!data || typeof data !== 'object') {
      return res.status(400).json({ error: '請提供有效的 JSON 內容' });
    }
    const results = importPayload(data);
    res.json({
      ok: true,
      imported: results.length,
      results,
      message: `已匯入 ${results.length} 個流程（新增或更新）`,
    });
  } catch (e) {
    console.error('workflow import', e);
    res.status(400).json({ error: e.message || '匯入失敗' });
  }
});

// ---------- 系統設定完整包（僅系統管理員）----------
/**
 * 匯出系統設定完整包
 * query: includeHistory=1 含歷史申請與附件
 * 含 SMTP 密碼須同時 includeMailSecrets=1 且 confirmMailSecrets=1（預設不含）
 */
app.get('/api/system/package/export', authMiddleware, builtinAdminOnly, (req, res) => {
  try {
    const includeHistory =
      req.query.includeHistory === '1' ||
      req.query.includeHistory === 'true' ||
      req.query.history === '1';
    const wantMailSecrets =
      req.query.includeMailSecrets === '1' || req.query.includeMailSecrets === 'true';
    const confirmMailSecrets =
      req.query.confirmMailSecrets === '1' || req.query.confirmMailSecrets === 'true';
    const includeMailSecrets = wantMailSecrets && confirmMailSecrets;
    if (wantMailSecrets && !confirmMailSecrets) {
      return res.status(400).json({
        error: '匯出 SMTP 密碼須再確認（confirmMailSecrets=1）',
      });
    }
    const pack = systemPackage.buildPackage({ includeHistory, includeMailSecrets });
    const tag = includeHistory ? '完整含歷史' : '設定';
    const fname = `簽核系統_${tag}包_${tz.today()}.json`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="approval-config-package.json"; filename*=UTF-8''${encodeURIComponent(fname)}`
    );
    res.send(JSON.stringify(pack, null, 2));
  } catch (e) {
    console.error('system package export', e);
    res.status(500).json({ error: e.message || '匯出失敗' });
  }
});

/** 設定包上傳（multipart 檔案或 JSON body 皆可） */
function uploadPackageMiddleware(req, res, next) {
  uploadPackage.single('package')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || '上傳失敗' });
    next();
  });
}

/** 從上傳檔案／body 取出設定包 JSON；無法解析回傳 null */
function readPackagePayload(req) {
  // 以記事本另存的 JSON 可能含 BOM，需先去除才能 parse
  if (req.file?.buffer) {
    const text = req.file.buffer.toString('utf8').replace(/^\uFEFF/, '');
    return JSON.parse(text);
  }
  if (req.body?.package) {
    return typeof req.body.package === 'string'
      ? JSON.parse(req.body.package)
      : req.body.package;
  }
  if (req.body && req.body.format) return req.body;
  return null;
}

/** 預覽設定包摘要（不上傳寫入） */
app.post(
  '/api/system/package/preview',
  authMiddleware,
  builtinAdminOnly,
  uploadPackageMiddleware,
  (req, res) => {
    try {
      const data = readPackagePayload(req);
      if (!data || !systemPackage.isConfigPackage(data)) {
        return res.status(400).json({
          error: '不是有效的系統設定完整包（format 不符）',
        });
      }
      res.json({
        ok: true,
        format: data.format,
        version: data.version,
        exportedAt: data.exportedAt,
        includeHistory: Boolean(data.includeHistory),
        summary: data.summary || {
          departments: (data.departments || []).length,
          users: (data.users || []).length,
          workflows: (data.workflows || []).length,
        },
        hasMail: Boolean(data.mailConfig),
        hasMailPass: Boolean(data.mailConfig?.pass),
      });
    } catch (e) {
      res.status(400).json({ error: e.message || '無法解析設定包' });
    }
  }
);

/** 匯入系統設定完整包 */
app.post(
  '/api/system/package/import',
  authMiddleware,
  builtinAdminOnly,
  uploadPackageMiddleware,
  (req, res) => {
    try {
      const data = readPackagePayload(req);
      if (!data || !systemPackage.isConfigPackage(data)) {
        return res.status(400).json({
          error: '不是有效的系統設定完整包。請使用「帳號設定 → 系統設定完整包」匯出的 JSON。',
        });
      }

      const importMail =
        req.body?.importMail === '1' ||
        req.body?.importMail === 'true' ||
        req.body?.importMail === true ||
        req.body?.importMail === undefined; // 預設匯入 mail（若包內有）
      // 若 body 明確傳 0/false 則略過
      const skipMail =
        req.body?.importMail === '0' ||
        req.body?.importMail === 'false' ||
        req.body?.importMail === false;
      const importHistory =
        req.body?.importHistory === '1' ||
        req.body?.importHistory === 'true' ||
        req.body?.importHistory === true;

      const result = systemPackage.importPackage(data, {
        importMail: !skipMail && importMail !== false,
        importHistory,
      });

      const parts = [
        `部門 +${result.departments.created}/更新${result.departments.updated}`,
        `成員 +${result.users.created}/更新${result.users.updated}`,
        `流程 ${result.workflows.length} 個`,
      ];
      if (result.mail?.ok) parts.push('Email 設定已套用');
      if (result.history) {
        parts.push(
          `歷史：申請 ${result.history.requests}、歷程 ${result.history.actions}、附件 ${result.history.attachments}`
        );
      }

      res.json({
        ok: true,
        result,
        message: `匯入完成：${parts.join('；')}`,
      });
    } catch (e) {
      console.error('system package import', e);
      res.status(400).json({ error: e.message || '匯入失敗' });
    }
  }
);

// ---------- Workflows（僅系統管理員可管理；一般使用者僅可讀取「啟用中」流程以送出申請）----------
app.get('/api/workflows', authMiddleware, (req, res) => {
  const wantAll = req.query.all === '1';
  if (wantAll && req.user.role !== 'admin' && !userHasPermission(req.user.id, 'workflows')) {
    return res.status(403).json({ error: '僅具備「管理簽核流程」權限者可查看全部流程' });
  }
  const onlyActive = !wantAll;
  // 永久刪除（purged）的流程不出現在任何列表
  const where = onlyActive
    ? 'WHERE w.active = 1 AND IFNULL(w.purged, 0) = 0'
    : 'WHERE IFNULL(w.purged, 0) = 0';
  const rows = db
    .prepare(
      `SELECT w.*, u.name AS creator_name
       FROM workflows w
       JOIN users u ON u.id = w.created_by
       ${where}
       ORDER BY w.updated_at DESC`
    )
    .all();
  // 管理列表回傳完整設定；一般使用者送出申請時也需 steps／formFields
  const workflows = rows.map((r) => serializeWorkflow(r));
  res.json({ workflows });
});

app.get('/api/workflows/:id', authMiddleware, (req, res) => {
  const r = db
    .prepare(
      `SELECT w.*, u.name AS creator_name FROM workflows w
       JOIN users u ON u.id = w.created_by WHERE w.id = ?`
    )
    .get(Number(req.params.id));
  if (!r) return res.status(404).json({ error: '找不到流程' });
  // 非管理員不可讀取停用流程、亦不可當管理用途讀取（僅啟用中可供申請）
  if (req.user.role !== 'admin' && !r.active) {
    return res.status(403).json({ error: '僅系統管理員可查看此流程' });
  }
  res.json({ workflow: serializeWorkflow(r) });
});

/**
 * 若請求帶了 v2 流程圖，驗證並回傳 { graph, steps }。
 * steps 由圖線性化而來，供既有 UI／PDF 排版沿用。
 * 回傳 { error } 代表驗證失敗。
 */
function acceptFlowGraph(body) {
  if (!body || body.flow == null) return null;
  const graph = flowGraph.normalizeGraph(body.flow);
  if (!graph) return { error: '流程圖格式無效' };
  const errs = flowGraph.validateGraph(graph);
  if (errs.length) return { error: '流程圖驗證未通過：' + errs.join('；') };
  return { graph, steps: flowGraph.graphToLinear(graph) };
}

app.post('/api/workflows', authMiddleware, requirePerm('workflows'), (req, res) => {
  const { name, description, formFields } = req.body || {};
  let { steps } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: '請輸入流程名稱' });
  }
  // v2：以流程圖為準，steps 由圖推導
  const fromGraph = acceptFlowGraph(req.body);
  if (fromGraph?.error) return res.status(400).json({ error: fromGraph.error });
  if (fromGraph) steps = fromGraph.steps;

  const parsed = parseSteps(steps);
  if (!parsed) {
    return res.status(400).json({ error: '請至少設定一個簽核步驟' });
  }
  for (const s of parsed) {
    const err = validateStepTemplate(s);
    if (err) return res.status(400).json({ error: err });
  }
  const fields = parseFormFields(formFields);
  for (const f of fields) {
    if (f.type === 'select' && (!f.options || !f.options.length)) {
      return res.status(400).json({ error: `表單欄位「${f.label}」請至少設定一個選項` });
    }
  }
  // 動態步驟「表單人員」需對應到 user 類型欄位
  for (const s of parsed) {
    if (s.assignType === 'form_user') {
      const ff = fields.find((f) => f.id === s.formFieldId);
      if (!ff) {
        return res.status(400).json({
          error: `步驟「${s.name}」的表單欄位「${s.formFieldId}」不存在，請先新增「人員選擇」欄位`,
        });
      }
      if (ff.type !== 'user') {
        return res.status(400).json({
          error: `步驟「${s.name}」對應欄位「${ff.label}」類型須為「人員選擇」`,
        });
      }
    }
  }
  const wfName = String(name).trim();
  const pdfLayoutBody = (req.body || {}).pdfLayout;
  const pdfLayoutJson = workflowModule.pdfLayoutToJson(
    pdfLayoutBody || { type: 'auto' },
    wfName
  );
  const finalNotifyJson = resolveFinalNotifyJson((req.body || {}).finalNotify);
  const info = db
    .prepare(
      `INSERT INTO workflows (name, description, created_by, steps_json, form_fields_json,
                              pdf_layout_json, final_notify_json, flow_json, flow_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      wfName,
      description ? String(description).trim() : '',
      req.user.id,
      JSON.stringify(parsed),
      JSON.stringify(fields),
      pdfLayoutJson,
      finalNotifyJson,
      fromGraph ? JSON.stringify(fromGraph.graph) : null,
      fromGraph ? 2 : 1
    );
  const workflow = db.prepare('SELECT * FROM workflows WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ workflow: serializeWorkflow(workflow) });
});

app.put('/api/workflows/:id', authMiddleware, requirePerm('workflows'), (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM workflows WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: '找不到流程' });
  const { name, description, formFields, active, pdfLayout, finalNotify } =
    req.body || {};
  let { steps } = req.body || {};
  // v2：以流程圖為準，steps 由圖推導
  const fromGraph = acceptFlowGraph(req.body);
  if (fromGraph?.error) return res.status(400).json({ error: fromGraph.error });
  if (fromGraph) steps = fromGraph.steps;
  let stepsJson = existing.steps_json;
  let fieldsJson = existing.form_fields_json || '[]';
  let pdfLayoutJson =
    existing.pdf_layout_json || JSON.stringify({ type: 'auto' });
  let finalNotifyJson =
    existing.final_notify_json ||
    JSON.stringify({ enabled: false, userIds: [] });
  if (formFields !== undefined) {
    const fields = parseFormFields(formFields);
    for (const f of fields) {
      if (f.type === 'select' && (!f.options || !f.options.length)) {
        return res.status(400).json({ error: `表單欄位「${f.label}」請至少設定一個選項` });
      }
    }
    fieldsJson = JSON.stringify(fields);
  }
  if (steps !== undefined) {
    const parsed = parseSteps(steps);
    if (!parsed) return res.status(400).json({ error: '簽核步驟格式不正確' });
    for (const s of parsed) {
      const err = validateStepTemplate(s);
      if (err) return res.status(400).json({ error: err });
    }
    const fields = parseFormFields(fieldsJson);
    for (const s of parsed) {
      if (s.assignType === 'form_user') {
        const ff = fields.find((f) => f.id === s.formFieldId);
        if (!ff) {
          return res.status(400).json({
            error: `步驟「${s.name}」的表單欄位「${s.formFieldId}」不存在，請先新增「人員選擇」欄位`,
          });
        }
        if (ff.type !== 'user') {
          return res.status(400).json({
            error: `步驟「${s.name}」對應欄位「${ff.label}」類型須為「人員選擇」`,
          });
        }
      }
    }
    stepsJson = JSON.stringify(parsed);
  }
  const finalName =
    name != null ? String(name).trim() : existing.name;
  if (pdfLayout !== undefined) {
    pdfLayoutJson = workflowModule.pdfLayoutToJson(pdfLayout, finalName);
  } else if (name != null) {
    // 改名時若版面為 auto，重新正規化 label
    const cur = workflowModule.parsePdfLayoutJson(pdfLayoutJson, finalName);
    pdfLayoutJson = workflowModule.pdfLayoutToJson(cur, finalName);
  }
  if (finalNotify !== undefined) {
    finalNotifyJson = resolveFinalNotifyJson(finalNotify);
  }
  db.prepare(
    `UPDATE workflows SET
      name = COALESCE(?, name),
      description = COALESCE(?, description),
      steps_json = ?,
      form_fields_json = ?,
      pdf_layout_json = ?,
      final_notify_json = ?,
      flow_json = COALESCE(?, flow_json),
      flow_version = COALESCE(?, flow_version),
      active = COALESCE(?, active),
      updated_at = datetime('now', 'localtime')
     WHERE id = ?`
  ).run(
    name != null ? String(name).trim() : null,
    description != null ? String(description).trim() : null,
    stepsJson,
    fieldsJson,
    pdfLayoutJson,
    finalNotifyJson,
    fromGraph ? JSON.stringify(fromGraph.graph) : null,
    fromGraph ? 2 : null,
    typeof active === 'number' || typeof active === 'boolean' ? (active ? 1 : 0) : null,
    id
  );
  const workflow = db.prepare('SELECT * FROM workflows WHERE id = ?').get(id);
  res.json({ workflow: serializeWorkflow(workflow) });
});

app.delete('/api/workflows/:id', authMiddleware, requirePerm('workflows'), (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM workflows WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: '找不到流程' });

  // 支援 query 與 JSON body
  let bodyPermanent = false;
  try {
    if (req.body && typeof req.body === 'object') bodyPermanent = !!req.body.permanent;
  } catch {
    /* ignore */
  }
  const permanent =
    req.query.permanent === '1' ||
    req.query.permanent === 'true' ||
    bodyPermanent;

  if (permanent) {
    const pending = db
      .prepare(
        `SELECT COUNT(*) AS c FROM approval_requests
         WHERE workflow_id = ? AND status IN ('pending', 'draft')`
      )
      .get(id).c;
    if (pending > 0) {
      return res.status(400).json({
        error: `此流程尚有 ${pending} 筆進行中的申請，無法永久刪除。請先處理完申請，或使用「刪除」（停用）即可。`,
      });
    }

    const totalReqs = db
      .prepare(`SELECT COUNT(*) AS c FROM approval_requests WHERE workflow_id = ?`)
      .get(id).c;

    if (totalReqs === 0) {
      // 無任何單據：可直接從資料庫刪除
      try {
        db.prepare(`DELETE FROM workflows WHERE id = ?`).run(id);
        return res.json({ ok: true, permanent: true, mode: 'hard' });
      } catch (e) {
        console.error('workflow hard delete', e);
        // fall through to purge flag
      }
    }

    // 有歷史單據：因外鍵不能物理刪除，標記 purged 並從列表隱藏
    db.prepare(
      `UPDATE workflows
       SET active = 0,
           purged = 1,
           name = CASE
             WHEN name LIKE '%（已永久刪除）' THEN name
             ELSE name || '（已永久刪除）'
           END,
           updated_at = datetime('now', 'localtime')
       WHERE id = ?`
    ).run(id);
    return res.json({ ok: true, permanent: true, mode: 'purged' });
  }

  // 軟刪除：停用，申請頁不再顯示（列表仍可見，可復原）
  db.prepare(
    `UPDATE workflows SET active = 0, purged = 0, updated_at = datetime('now', 'localtime') WHERE id = ?`
  ).run(id);
  res.json({ ok: true, permanent: false });
});

/** 復原已停用的流程 */
app.post('/api/workflows/:id/restore', authMiddleware, requirePerm('workflows'), (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM workflows WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: '找不到流程' });
  db.prepare(
    `UPDATE workflows SET active = 1, updated_at = datetime('now', 'localtime') WHERE id = ?`
  ).run(id);
  const workflow = db.prepare('SELECT * FROM workflows WHERE id = ?').get(id);
  res.json({ workflow: serializeWorkflow(workflow) });
});

// ---------- 人事：請假報表 Excel ----------
/**
 * POST body: { userIds: number[], dateFrom, dateTo }
 * 一律僅統計已核准請假單（不接受其他狀態）
 * 權限：admin 或 leave_report
 */
app.post(
  '/api/reports/leave-export',
  authMiddleware,
  requirePerm('leave_report'),
  (req, res) => {
    try {
      const body = req.body || {};
      let userIds = Array.isArray(body.userIds)
        ? body.userIds.map(Number).filter(Boolean)
        : [];
      // 未指定則全部啟用中成員
      if (!userIds.length) {
        userIds = db
          .prepare(`SELECT id FROM users WHERE active = 1 ORDER BY id`)
          .all()
          .map((u) => u.id);
      }
      const dateFrom = body.dateFrom || body.from || body.start;
      const dateTo = body.dateTo || body.to || body.end;

      const { buffer, meta } = leaveReport.buildLeaveReportWorkbook({
        userIds,
        dateFrom,
        dateTo,
        statuses: ['approved'],
      });

      const fname = `請假報表_${meta.dateFrom}_${meta.dateTo}.xlsx`;
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="leave-report.xlsx"; filename*=UTF-8''${encodeURIComponent(fname)}`
      );
      res.send(buffer);
    } catch (e) {
      console.error('leave-export', e);
      res.status(400).json({ error: e.message || '匯出失敗' });
    }
  }
);

// ---------- Approval requests ----------
/** 單據是否與登入使用者有關（申請人、歷程簽核人、步驟指定簽核人、或財務部對信用額度單） */
function isRequestRelatedToUser(row, userId) {
  const uid = Number(userId);
  if (!row || !uid) return false;
  if (Number(row.requester_id) === uid) return true;
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
  for (const s of steps) {
    if ((s.approverIds || []).map(Number).includes(uid)) return true;
  }
  return false;
}

app.get('/api/requests', authMiddleware, (req, res) => {
  const filter = req.query.filter || 'related'; // related | mine | pending_me | done | all
  const uid = req.user.id;
  let rows;

  if (filter === 'mine') {
    // 僅本人申請
    rows = db
      .prepare(
        `SELECT r.*, w.name AS workflow_name, u.name AS requester_name
         FROM approval_requests r
         JOIN workflows w ON w.id = r.workflow_id
         JOIN users u ON u.id = r.requester_id
         WHERE r.requester_id = ?
         ORDER BY r.updated_at DESC`
      )
      .all(uid);
  } else if (filter === 'pending_finance_confirm') {
    // 待財務部授信額度建檔確認（總經理已核准，財務部尚未點確認）
    rows = getPendingFinanceConfirmRequests();
  } else if (filter === 'pending_me') {
    // 待我簽核（使用送出時步驟快照，勿用流程模板）
    const allPending = db
      .prepare(
        `${REQUEST_LIST_SELECT}
         WHERE r.status = 'pending'
         ORDER BY r.updated_at DESC`
      )
      .all();
    rows = [];
    for (const r of allPending) {
      const steps = loadStepsForRequest(r);
      const step = findStepByOrder(steps, r.current_step);
      const check = checkUserApprovalRight(uid, step, r.id);
      if (check.canApprove) {
        if (check.isDelegated) {
          rows.push({
            ...r,
            is_delegated: true,
            delegated_for_name: check.delegatedFor.name,
          });
        } else {
          rows.push(r);
        }
      }
    }

    // 財務部：併入待建檔確認的已核准信用額度單
    if (isFinanceUser(req.user)) {
      const finReqs = getPendingFinanceConfirmRequests();
      const existingIds = new Set(rows.map((x) => x.id));
      for (const fr of finReqs) {
        if (!existingIds.has(fr.id)) rows.push(fr);
      }
    }

    // 申請人待確認財務建檔
    const ackReqs = getPendingApplicantAckRequests(uid);
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
        `${REQUEST_LIST_SELECT}
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
        `${REQUEST_LIST_SELECT}
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
  const list = rows.map(({ steps_json, steps_snapshot_json, ...rest }) => {
    const signed = hasApproverSigned(rest.id, rest);
    const isOwner = Number(rest.requester_id) === Number(uid);
    const isLeave = isLeaveApprovalRequest(rest);
    // 系統管理員：可刪任何狀態；請假＋leave_delete：可刪；其餘：已簽署鎖定
    const can_delete =
      isAdminUser ||
      (isLeave && canDeleteLeave) ||
      (!signed &&
        (canDeleteRecords || (isOwner && rest.status !== 'approved')));
    return {
      ...rest,
      approver_signed: signed,
      is_leave: isLeave,
      can_delete,
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
  if (!seeAll && !seeLeave && !isRequestRelatedToUser(detail, req.user.id)) {
    return res.status(403).json({ error: '無權查看此簽核單（僅顯示與您相關的紀錄）' });
  }
  const steps = detail.steps;
  const current = findStepByOrder(steps, detail.current_step);
  const canApprove =
    detail.status === 'pending' && canUserApproveStep(req.user.id, current, detail.id);
  const canAttach = canUserAttachOnStep(req.user.id, detail);
  const isFinalStep = current ? isFinalApprovalStep(detail.steps || [], current) : false;
  const approverSigned = hasApproverSigned(detail.id, detail);
  // 草稿可取消；簽核中僅「尚無簽署人核准」可取消
  const canCancel =
    (detail.requester_id === req.user.id || req.user.role === 'admin') &&
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
    return resolveLeaveTypeOptions(d.formFields);
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

  res.json({
    request: detail,
    canApprove,
    canAttach,
    isFinalStep,
    canCancel,
    canDelete,
    approverSigned,
    currentStep: currentStepOut,
    coApprovers,
    applicantLabor,
  });
});

/** 簽核過程補充附件（非最終審核步驟） */
app.post(
  '/api/requests/:id/attachments',
  authMiddleware,
  upload.array('attachments', 20),
  (req, res) => {
    const id = Number(req.params.id);
    const detail = getRequestDetail(id);
    if (!detail) return res.status(404).json({ error: '找不到簽核單' });
    if (!canUserAttachOnStep(req.user.id, detail)) {
      return res.status(403).json({
        error: '僅非最終審核步驟的目前簽核人可新增附件',
      });
    }
    if (!req.files?.length) {
      return res.status(400).json({ error: '請選擇要上傳的檔案' });
    }
    const step = (detail.steps || []).find((s) => s.order === detail.current_step);
    const saved = saveAttachments(id, req.user.id, req.files, step?.order ?? detail.current_step);
    db.prepare(
      `INSERT INTO approval_actions (request_id, step_order, step_name, actor_id, action, comment, form_data)
       VALUES (?, ?, ?, ?, 'comment', ?, '{}')`
    ).run(
      id,
      step?.order ?? detail.current_step,
      step?.name || '補充附件',
      req.user.id,
      `上傳附件 ${saved.length} 個：${saved.map((s) => s.original_name).join('、')}`
    );
    db.prepare(
      `UPDATE approval_requests SET updated_at = datetime('now', 'localtime') WHERE id = ?`
    ).run(id);
    res.status(201).json({
      ok: true,
      attachments: getAttachments(id),
      saved,
      message: `已上傳 ${saved.length} 個附件`,
    });
  }
);

app.post('/api/requests', authMiddleware, upload.array('attachments', 20), (req, res) => {
  // 支援 JSON 與 multipart（含附件）
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
      return res.status(400).json({ error: '表單資料格式錯誤' });
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
    return res.status(400).json({ error: '請選擇流程' });
  }
  const wf = db.prepare('SELECT * FROM workflows WHERE id = ? AND active = 1').get(Number(workflow_id));
  if (!wf) return res.status(400).json({ error: '流程不存在或已停用' });
  const templateSteps = parseSteps(wf.steps_json);
  if (!templateSteps?.length) return res.status(400).json({ error: '流程未設定簽核步驟' });

  const formFields = parseFormFields(wf.form_fields_json);
  const validated = validateFormData(formFields, form_data);
  if (validated.error) return res.status(400).json({ error: validated.error });

  // 合併部門主管自選（不在 formFields 定義內，不可被 validate 丟掉）
  const withDept = mergeDeptHeadFormData(validated.data, form_data, templateSteps);
  if (withDept.error) return res.status(400).json({ error: withDept.error });
  const withPick = mergeUsersPickFormData(
    withDept.data || validated.data,
    form_data,
    templateSteps
  );
  if (withPick.error) return res.status(400).json({ error: withPick.error });
  const withCosign = mergeCosignFormData(
    withPick.data || withDept.data || validated.data,
    form_data,
    templateSteps
  );
  if (withCosign.error) return res.status(400).json({ error: withCosign.error });
  const fullFormData = mergeFormTables(
    withCosign.data || withPick.data || withDept.data || validated.data || {},
    form_data
  );

  // 主旨：僅「一般簽呈」需申請人填寫；其餘流程由系統依表單自動產生
  const wfName = String(wf.name || '');
  const isLeave = /請假/.test(wfName);
  const isGeneralMemo =
    /一般簽呈|簽呈/.test(wfName) &&
    !/信用額度|請假|請購|報支|出差|加班|報修/.test(wfName);
  if (!isGeneralMemo) {
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
      const parts = ['請假申請'];
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
      title = (pick.length ? `${base} · ${pick[0]}` : base).slice(0, 200);
    }
  }
  // 所有申請一律不使用「申請內容」欄
  content = '';
  if (!title || !String(title).trim()) {
    return res.status(400).json({
      error: isGeneralMemo ? '請填寫主旨' : '無法產生主旨，請檢查表單內容',
    });
  }

  const requester = db
    .prepare(`SELECT id, name, department, role, email, email_notify FROM users WHERE id = ?`)
    .get(req.user.id);
  if (!requester) return res.status(400).json({ error: '申請人資料異常' });

  const resolved = resolveStepsForRequest(requester, fullFormData, templateSteps);
  if (resolved.error) return res.status(400).json({ error: resolved.error });

  // 預設：帳號有開 email_notify 且有填 email 則開啟
  let notifyFlag = 1;
  if (notify_email === 0 || notify_email === false || notify_email === '0' || notify_email === 'false') {
    notifyFlag = 0;
  } else if (notify_email === 1 || notify_email === true || notify_email === '1' || notify_email === 'true') {
    notifyFlag = 1;
  } else {
    notifyFlag = requester.email_notify === 0 ? 0 : 1;
  }

  // 細項：核准／駁回／下一步（可全選或個別勾選）
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
    // 缺漏鍵＝false（僅勾「核准」時，下一步／駁回必須關閉）
    const flag = (k) => {
      const v = notify_prefs[k];
      if (v === true || v === 1 || v === '1' || v === 'true') return true;
      if (v === false || v === 0 || v === '0' || v === 'false') return false;
      return false;
    };
    const approved = flag('approved');
    const rejected = flag('rejected');
    const step = flag('step');
    // 若三項皆關，視為整筆關閉
    const any = approved || rejected || step;
    prefsObj = {
      enabled: any,
      approved,
      rejected,
      step,
      // 送出／取消：僅在「開啟通知」時通知，不強制等於 any
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
  const prefsJson = JSON.stringify(prefsObj);

  const formJson = JSON.stringify(fullFormData || {});
  const schemaJson = JSON.stringify(formFields);
  const snapshotJson = JSON.stringify(resolved.steps);
  const info = db
    .prepare(
      `INSERT INTO approval_requests
        (workflow_id, title, content, form_data, form_schema_json, steps_snapshot_json,
         requester_id, status, current_step, notify_email, notify_prefs_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 1, ?, ?)`
    )
    .run(
      wf.id,
      String(title).trim(),
      content ? String(content) : '',
      formJson,
      schemaJson,
      snapshotJson,
      req.user.id,
      notifyFlag,
      prefsJson
    );

  const requestId = info.lastInsertRowid;
  db.prepare(
    `INSERT INTO approval_actions (request_id, step_order, step_name, actor_id, action, comment, form_data)
     VALUES (?, 0, '申請人送出', ?, 'submit', ?, '{}')`
  ).run(requestId, req.user.id, '送出簽核申請');

  // 附件
  try {
    saveAttachments(requestId, req.user.id, req.files || []);
  } catch (e) {
    console.error('save attachments', e);
  }

  let detail = getRequestDetail(requestId);

  if (Number(wf.flow_version) === 2) {
    // ── v2 圖模型 ──
    // 送單時把「已解析出實際簽核人」的圖凍結進 flow_snapshot_json，
    // 之後改流程定義不影響進行中的單據（與 steps_snapshot_json 同一設計）
    const graph = buildResolvedGraph(wf, resolved.steps);
    db.prepare(`UPDATE approval_requests SET flow_snapshot_json = ? WHERE id = ?`).run(
      JSON.stringify(graph),
      requestId
    );
    flowEngine.start(requestId, graph, fullFormData || {});
    detail = getRequestDetail(requestId);
  } else {
    // ── v1 線性引擎（既有行為完全不變）──
    const initialSteps = detail.steps || [];
    if (initialSteps.length > 0) {
      const firstStep = initialSteps[0];
      const cond = evaluateStepCondition(firstStep, detail);
      if (!cond.required) {
        advanceToNextEligibleStep(requestId, detail, initialSteps, { order: 0 });
        detail = getRequestDetail(requestId);
      }
    }
  }
  // Email／LINE：通知目前步驟簽核人；申請人確認送出（若有開通知）
  notifyCurrentApprovers(detail, 'pending', requester.name);
  if (notifyFlag) {
    fireAndForgetMail(
      'applicant-submit',
      mail.notifyApplicant(detail, 'submitted', { actorName: requester.name })
    );
    fireAndForgetLine(
      'applicant-submit',
      lineNotify.notifyApplicantLine(detail, 'submitted', {
        actorName: requester.name,
        baseUrl: getAppBaseUrl(),
        getUsernameById,
      })
    );
  }

  logAudit(req, {
    action_type: 'submit_request',
    category: 'approval',
    description: `送出簽核申請 #${requestId}「${detail.title}」`,
    target_id: requestId,
  });

  res.status(201).json({ request: detail });
});

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
  if (detail.requester_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: '僅申請人或管理員可寄送催辦信' });
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
  const INLINE_PREVIEW_MIME = new Set([
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
  ]);
  const inline = String(req.query.inline || '') === '1';
  const disposition = contentDispositionAttachment(downloadName, `file-${att.id}`);
  res.setHeader(
    'Content-Disposition',
    inline && INLINE_PREVIEW_MIME.has(att.mime_type)
      ? disposition.replace(/^attachment/i, 'inline')
      : disposition
  );
  if (att.mime_type) res.setHeader('Content-Type', att.mime_type);
  fs.createReadStream(abs).pipe(res);
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

app.post(
  '/api/requests/:id/action',
  authMiddleware,
  upload.array('attachments', 20),
  (req, res) => {
  const id = Number(req.params.id);
  let { action, comment, step_form_data: stepFormData, signature_image: signatureImage } = req.body || {};
  if (typeof stepFormData === 'string') {
    try {
      stepFormData = JSON.parse(stepFormData || '{}');
    } catch {
      stepFormData = {};
    }
  }
  const allowed = ['approve', 'reject', 'cancel'];
  if (!allowed.includes(action)) {
    return res.status(400).json({ error: '不支援的操作' });
  }

  const detail = getRequestDetail(id);
  if (!detail) return res.status(404).json({ error: '找不到簽核單' });

  if (action === 'cancel') {
    if (detail.requester_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: '僅申請人或管理員可取消' });
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
    fireAndForgetLine(
      'applicant-cancel',
      lineNotify.notifyApplicantLine(after, 'cancelled', {
        actorName: actor?.name,
        comment: comment || '取消申請',
        baseUrl: getAppBaseUrl(),
        getUsernameById,
      })
    );
    return res.json({ request: after });
  }

  if (detail.status !== 'pending') {
    return res.status(400).json({ error: '此單據不在簽核中' });
  }

  const steps = detail.steps;
  // v2 並行分支時可能同時有多個待簽關卡，current_step 只指得到其中一個，
  // 必須改由「這位使用者實際待簽的節點」決定，否則另一條分支的簽核人會被擋
  const step = resolveActionableStep(detail, steps, req.user.id, id);
  const check = checkUserApprovalRight(req.user.id, step, id);
  if (!check.canApprove) {
    return res.status(403).json({ error: '您不是目前步驟的簽核人，或已簽核過' });
  }

  const delegatedForId = check.isDelegated ? check.delegatedFor.id : null;
  let finalComment = comment != null ? String(comment).trim() : '';
  if (check.isDelegated) {
    const proxyTag = `(代理 ${check.delegatedFor.name} 簽核)`;
    if (!finalComment.includes(proxyTag)) {
      finalComment = finalComment ? `${finalComment} ${proxyTag}` : proxyTag;
    }
  } else if (!finalComment) {
    finalComment = action === 'approve' ? '同意' : '駁回';
  }

  // 簽名檔處置：優先本次上傳；否則一律帶入「個人預設簽名」（JWT 無簽名欄，須查 DB）
  let sigImgToSave = signatureImage || null;
  if (sigImgToSave && typeof sigImgToSave === 'string') {
    sigImgToSave = String(sigImgToSave).trim() || null;
  } else {
    sigImgToSave = null;
  }
  if (!sigImgToSave) {
    try {
      const uSig = db
        .prepare(`SELECT signature_image FROM users WHERE id = ?`)
        .get(req.user.id);
      if (uSig?.signature_image) sigImgToSave = uSig.signature_image;
    } catch {
      /* ignore */
    }
  }

  // 中間步驟可隨簽核一併上傳附件；最終審核者不可
  if (req.files?.length) {
    if (isFinalApprovalStep(steps, step)) {
      return res.status(400).json({ error: '最終審核步驟不可新增附件' });
    }
    saveAttachments(id, req.user.id, req.files, step?.order);
  }

  // 簽核步驟附加表單（如人事：剩餘特休）
  let actionFormJson = '{}';
  if (action === 'approve') {
    let fields = Array.isArray(step?.approverFields) ? step.approverFields : [];
    if (fields.length) {
      // 請假人事：非特休時「剩餘日數／小時」可不填（留白）
      const rawStep = stepFormData || {};
      const hrType = String(
        rawStep.hr_leave_type || rawStep.假別 || ''
      ).trim();

      // 假別選項：與詳情頁一致，帶入申請表單全部假別
      const leaveFieldOpts = resolveLeaveTypeOptions(detail.formFields);

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
      if (validated.error) return res.status(400).json({ error: validated.error });
      actionFormJson = JSON.stringify(validated.data || {});
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
        data: validated.data || {},
        by: req.user.id,
        at: tz.nowIso(),
      };
      Object.assign(merged, validated.data || {});
      db.prepare(
        `UPDATE approval_requests SET approver_data_json = ?, updated_at = datetime('now','localtime') WHERE id = ?`
      ).run(JSON.stringify(merged), id);
    }
  }

  const reqGraph = getRequestGraph(detail);

  if (action === 'reject') {
    if (reqGraph) {
      // v2：由引擎決定是整單駁回或退回指定節點
      flowEngine.reject(id, reqGraph, step.nodeId || `n${step.order}`);
    } else {
      db.prepare(
        `UPDATE approval_requests SET status = 'rejected', completed_at = datetime('now', 'localtime'),
         updated_at = datetime('now', 'localtime') WHERE id = ?`
      ).run(id);
    }
    db.prepare(
      `INSERT INTO approval_actions (request_id, step_order, node_id, step_name, actor_id, action, comment, form_data, signature_image, delegated_for_id)
       VALUES (?, ?, ?, ?, ?, 'reject', ?, ?, ?, ?)`
    ).run(id, step.order, step.nodeId || null, step.name, req.user.id, finalComment, actionFormJson, sigImgToSave, delegatedForId);
    const after = getRequestDetail(id);
    const actor = db.prepare(`SELECT name FROM users WHERE id = ?`).get(req.user.id);
    fireAndForgetMail(
      'applicant-reject',
      mail.notifyApplicant(after, 'rejected', {
        actorName: actor?.name,
        comment: finalComment,
      })
    );
    fireAndForgetLine(
      'applicant-reject',
      lineNotify.notifyApplicantLine(after, 'rejected', {
        actorName: actor?.name,
        comment: finalComment,
        baseUrl: getAppBaseUrl(),
        getUsernameById,
      })
    );
    return res.json({ request: after });
  }

  // approve
  db.prepare(
    `INSERT INTO approval_actions (request_id, step_order, node_id, step_name, actor_id, action, comment, form_data, signature_image, delegated_for_id)
     VALUES (?, ?, ?, ?, ?, 'approve', ?, ?, ?, ?)`
  ).run(id, step.order, step.nodeId || null, step.name, req.user.id, finalComment, actionFormJson, sigImgToSave, delegatedForId);

  let mailEvent = null; // approved | step | waiting_co
  let nextStepName = '';
  if (isStepComplete(id, step)) {
    if (reqGraph) {
      // v2：圖引擎推進，可能同時開啟多個並行關卡
      const r = flowEngine.approve(id, reqGraph, step.nodeId || `n${step.order}`, detail.form_data || {});
      mailEvent = r.status === 'approved' ? 'approved' : 'step';
      const idx = flowEngine.indexGraph(reqGraph);
      nextStepName = (r.pending || [])
        .map((nid) => idx.byId.get(nid)?.name || nid)
        .join('、');
    } else {
      const adv = advanceToNextEligibleStep(id, detail, steps, step);
      mailEvent = adv.mailEvent;
      nextStepName = adv.nextStepName;
    }
  } else {
    db.prepare(
      `UPDATE approval_requests SET updated_at = datetime('now', 'localtime') WHERE id = ?`
    ).run(id);
    mailEvent = 'waiting_co';
  }

  let after = getRequestDetail(id);
  const actor = db.prepare(`SELECT name FROM users WHERE id = ?`).get(req.user.id);
  let message = '已核准';
  if (mailEvent === 'approved') {
    const isCredit = isCreditLimitRequestRow(after);
    // 流程模組：最終核准完成後通知選定人員（可開關）
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
        ? `總經理已完成核定，表單正式「已核准」！系統將通知 ${finalNotifyCount} 位選定人員。`
        : `已核准，簽核流程完成；將系統通知 ${finalNotifyCount} 位選定人員`;
    } else if (finalNotifyOn && !finalNotifyApplies) {
      message = isCredit
        ? '總經理已完成核定，表單正式「已核准」！（此申請人不在最終通知範圍）'
        : '已核准，簽核流程完成（此申請人不在最終通知範圍）';
    } else if (isCredit) {
      message =
        '總經理已完成核定，表單正式「已核准」！系統將通知財務部建檔。';
    } else {
      message = '已核准，簽核流程完成';
    }

    handleP2ApprovedSideEffects(after, req);

    fireAndForgetMail(
      'applicant-approved',
      mail.notifyApplicant(after, 'approved', {
        actorName: actor?.name,
        comment: comment || '同意',
      })
    );
    fireAndForgetLine(
      'applicant-approved',
      lineNotify.notifyApplicantLine(after, 'approved', {
        actorName: actor?.name,
        comment: comment || '同意',
        baseUrl: getAppBaseUrl(),
        getUsernameById,
      })
    );

    // 1) 流程模組：最終核准 → 系統內通知選定人員（需點「確認收到通知」；非 Email）
    // 注意：單據此時已是 approved，通知失敗不可讓整支 API 500
    // 僅當申請人在「需要通知模組」範圍內才寫入
    if (finalNotifyApplies) {
      try {
        const created = createFinalNotifyReceipts(
          id,
          finalNotify,
          req.user.id,
          after.requester_id
        );
        if (created.created > 0) {
          message = isCredit
            ? `總經理已完成核定，表單正式「已核准」！已在系統通知 ${created.created} 位選定人員（待確認收到）。`
            : `已核准，簽核流程完成；已在系統通知 ${created.created} 位選定人員（待確認收到）`;
        } else if (created.skipped && created.reason === 'applicant_not_in_scope') {
          message = isCredit
            ? '總經理已完成核定，表單正式「已核准」！（此申請人不在最終通知對象範圍內）'
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

    // 2) 相容：信用額度未啟用模組通知時，仍 Email 抄送財務（舊行為；建檔確認仍走系統內按鈕）
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
    fireAndForgetLine(
      'applicant-step',
      lineNotify.notifyApplicantLine(after, 'step', {
        actorName: actor?.name,
        comment: comment || '',
        baseUrl: getAppBaseUrl(),
        getUsernameById,
      })
    );
    // 進入下一步（含最終審核步驟）一律通知該步簽核人
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
    // 提醒尚未核准的會簽人（若已啟用 Email）
    notifyCurrentApprovers(after, 'pending', actor?.name);
  }

  res.json({ request: after, message, mailEvent, nextStepName });
});

/**
 * 加簽請託 (Ad-hoc Co-signer)
 * POST /api/requests/:id/cosign
 * Body: { target_user_id: number, comment: string, position: 'current' | 'after' }
 */
app.post('/api/requests/:id/cosign', authMiddleware, (req, res) => {
  try {
    const id = Number(req.params.id);
    const { target_user_id, comment, position = 'current' } = req.body || {};
    const targetId = Number(target_user_id);

    if (!targetId) return res.status(400).json({ error: '請選擇加簽同仁' });
    if (targetId === req.user.id) return res.status(400).json({ error: '不能加簽給自己' });

    const targetUser = db.prepare(`SELECT id, name, username, email FROM users WHERE id = ? AND active = 1`).get(targetId);
    if (!targetUser) return res.status(400).json({ error: '加簽對象不存在或已停用' });

    const detail = getRequestDetail(id);
    if (!detail) return res.status(404).json({ error: '找不到簽核單' });
    if (detail.status !== 'pending') return res.status(400).json({ error: '此單據不在簽核中' });

    const steps = detail.steps || [];
    // 並行分支下 current_step 只指得到其中一關，改用這位使用者實際待簽的關卡
    const currentStep = resolveActionableStep(detail, steps, req.user.id, id);
    if (!canUserApproveStep(req.user.id, currentStep, id)) {
      return res.status(403).json({ error: '您不是目前步驟的簽核人，無法進行加簽' });
    }

    // ── v2 圖模型：改這張單凍結的圖，不動流程定義 ──
    const cosignGraph = getRequestGraph(detail);
    if (cosignGraph) {
      const anchorId = currentStep.nodeId || `n${currentStep.order}`;
      const newNode = {
        id: `cosign_${Date.now().toString(36)}`,
        type: 'approval',
        name: `加簽：${targetUser.name}`,
        assignType: 'users',
        mode: 'any',
        approverIds: [targetId],
        approverFields: [],
        rejectTo: 'requester',
      };
      // v1 的 position=current 語意是「加簽者先簽，簽完才輪到原關卡」
      const pos = position === 'after' ? 'after' : 'before';
      const nextGraph = flowEngine.insertAdHoc(id, cosignGraph, anchorId, newNode, pos);
      if (!nextGraph) return res.status(400).json({ error: '加簽失敗：流程圖更新錯誤' });

      db.prepare(
        `UPDATE approval_requests SET flow_snapshot_json = ?, updated_at = datetime('now','localtime') WHERE id = ?`
      ).run(JSON.stringify(nextGraph), id);
      flowEngine.syncCurrentStep(id, nextGraph);

      db.prepare(
        `INSERT INTO approval_actions (request_id, step_order, node_id, step_name, actor_id, action, comment, form_data)
         VALUES (?, ?, ?, '加簽請託', ?, 'cosign', ?, '{}')`
      ).run(
        id, currentStep.order ?? null, anchorId, req.user.id,
        `${req.user.name} 加簽給 ${targetUser.name}${comment ? `：${String(comment).trim()}` : ''}`
      );

      const afterG = getRequestDetail(id);
      notifyCurrentApprovers(afterG, 'pending', req.user.name);
      logAudit(req, {
        action_type: 'cosign_request',
        category: 'approval',
        description: `加簽請託給 ${targetUser.name} (單號 #${id})`,
        target_id: id,
      });
      return res.json({ ok: true, message: `已成功加簽給 ${targetUser.name}`, request: afterG });
    }

    const curOrder = Number(detail.current_step);
    const updatedSteps = [];
    const cosignName = `加簽：${targetUser.name}`;
    let insertedOrder = curOrder;

    if (position === 'after') {
      insertedOrder = curOrder + 1;
      for (const s of steps) {
        const sOrd = Number(s.order);
        if (sOrd <= curOrder) {
          updatedSteps.push(s);
        } else {
          updatedSteps.push({ ...s, order: sOrd + 1 });
        }
      }
      updatedSteps.push({
        order: insertedOrder,
        name: cosignName,
        approverIds: [targetId],
        mode: 'any',
        assignType: 'users',
        is_cosign: true,
      });
      updatedSteps.sort((a, b) => Number(a.order) - Number(b.order));
    } else {
      // position === 'current'
      for (const s of steps) {
        const sOrd = Number(s.order);
        if (sOrd < curOrder) {
          updatedSteps.push(s);
        } else {
          updatedSteps.push({ ...s, order: sOrd + 1 });
        }
      }
      updatedSteps.push({
        order: curOrder,
        name: cosignName,
        approverIds: [targetId],
        mode: 'any',
        assignType: 'users',
        is_cosign: true,
      });
      updatedSteps.sort((a, b) => Number(a.order) - Number(b.order));
    }

    db.prepare(`UPDATE approval_requests SET steps_snapshot_json = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`)
      .run(JSON.stringify(updatedSteps), id);

    const logComment = `${req.user.name} 加簽給 ${targetUser.name}${comment ? `：${String(comment).trim()}` : ''}`;
    db.prepare(
      `INSERT INTO approval_actions (request_id, step_order, step_name, actor_id, action, comment, form_data)
       VALUES (?, ?, '加簽請託', ?, 'cosign', ?, '{}')`
    ).run(id, curOrder, req.user.id, logComment);

    const after = getRequestDetail(id);
    notifyCurrentApprovers(after, 'pending', req.user.name);

    logAudit(req, {
      action_type: 'cosign_request',
      category: 'approval',
      description: `加簽請託給 ${targetUser.name} (單號 #${id})`,
      target_id: id,
    });

    res.json({ ok: true, message: `已成功加簽給 ${targetUser.name}`, request: after });
  } catch (e) {
    console.error('cosign error', e);
    res.status(500).json({ error: e.message || '加簽失敗' });
  }
});

/**
 * 轉簽改派 (Forwarding / Re-assign)
 * POST /api/requests/:id/forward
 * Body: { target_user_id: number, comment: string }
 */
app.post('/api/requests/:id/forward', authMiddleware, (req, res) => {
  try {
    const id = Number(req.params.id);
    const { target_user_id, comment } = req.body || {};
    const targetId = Number(target_user_id);

    if (!targetId) return res.status(400).json({ error: '請選擇轉簽對象' });
    if (targetId === req.user.id) return res.status(400).json({ error: '不能轉簽給自己' });

    const targetUser = db.prepare(`SELECT id, name, username, email FROM users WHERE id = ? AND active = 1`).get(targetId);
    if (!targetUser) return res.status(400).json({ error: '轉簽對象不存在或已停用' });

    const detail = getRequestDetail(id);
    if (!detail) return res.status(404).json({ error: '找不到簽核單' });
    if (detail.status !== 'pending') return res.status(400).json({ error: '此單據不在簽核中' });

    const steps = detail.steps || [];
    const curOrder = Number(detail.current_step);
    // 並行分支下 current_step 只指得到其中一關，改用這位使用者實際待簽的關卡
    const currentStep = resolveActionableStep(detail, steps, req.user.id, id);
    if (!canUserApproveStep(req.user.id, currentStep, id)) {
      return res.status(403).json({ error: '您不是目前步驟的簽核人，無法進行轉簽' });
    }

    // ── v2 圖模型：轉簽不改流程結構，只換該節點的簽核人 ──
    const fwdGraph = getRequestGraph(detail);
    if (fwdGraph) {
      const anchorId = currentStep.nodeId || `n${currentStep.order}`;
      const nextGraph = {
        ...fwdGraph,
        nodes: fwdGraph.nodes.map((n) =>
          n.id === anchorId
            ? {
                ...n,
                approverIds: [targetId],
                mode: 'any',
                name: /改派:/.test(n.name || '') ? n.name : `${n.name} (改派: ${targetUser.name})`,
              }
            : n
        ),
      };
      db.prepare(
        `UPDATE approval_requests SET flow_snapshot_json = ?, updated_at = datetime('now','localtime') WHERE id = ?`
      ).run(JSON.stringify(nextGraph), id);

      db.prepare(
        `INSERT INTO approval_actions (request_id, step_order, node_id, step_name, actor_id, action, comment, form_data)
         VALUES (?, ?, ?, '轉簽改派', ?, 'forward', ?, '{}')`
      ).run(
        id, currentStep.order ?? null, anchorId, req.user.id,
        `${req.user.name} 轉簽改派給 ${targetUser.name}${comment ? `：${String(comment).trim()}` : ''}`
      );

      const afterG = getRequestDetail(id);
      notifyCurrentApprovers(afterG, 'pending', req.user.name);
      logAudit(req, {
        action_type: 'forward_request',
        category: 'approval',
        description: `轉簽改派給 ${targetUser.name} (單號 #${id})`,
        target_id: id,
      });
      return res.json({ ok: true, message: `已成功轉簽給 ${targetUser.name}`, request: afterG });
    }

    const updatedSteps = steps.map((s) => {
      if (Number(s.order) === curOrder) {
        return {
          ...s,
          approverIds: [targetId],
          name: `${s.name} (改派: ${targetUser.name})`,
        };
      }
      return s;
    });

    db.prepare(`UPDATE approval_requests SET steps_snapshot_json = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`)
      .run(JSON.stringify(updatedSteps), id);

    const logComment = `${req.user.name} 轉簽改派給 ${targetUser.name}${comment ? `：${String(comment).trim()}` : ''}`;
    db.prepare(
      `INSERT INTO approval_actions (request_id, step_order, step_name, actor_id, action, comment, form_data)
       VALUES (?, ?, '轉簽改派', ?, 'forward', ?, '{}')`
    ).run(id, curOrder, req.user.id, logComment);

    const after = getRequestDetail(id);
    notifyCurrentApprovers(after, 'pending', req.user.name);

    logAudit(req, {
      action_type: 'forward_request',
      category: 'approval',
      description: `轉簽改派給 ${targetUser.name} (單號 #${id})`,
      target_id: id,
    });

    res.json({ ok: true, message: `已成功轉簽給 ${targetUser.name}`, request: after });
  } catch (e) {
    console.error('forward error', e);
    res.status(500).json({ error: e.message || '轉簽失敗' });
  }
});

/**
 * 批次簽核 (P2-2)
 * POST /api/requests/bulk-action
 * Body: { ids: number[], action: 'approve' | 'reject', comment?: string, signature_image?: string }
 */
app.post('/api/requests/bulk-action', authMiddleware, async (req, res) => {
  const { ids, action = 'approve', comment, signature_image } = req.body || {};
  const reqIds = Array.isArray(ids) ? ids.map(Number).filter(Boolean) : [];

  if (!reqIds.length) {
    return res.status(400).json({ error: '請選擇至少一筆簽核單' });
  }

  const successIds = [];
  const failedItems = [];

  for (const id of reqIds) {
    try {
      const detail = getRequestDetail(id);
      if (!detail) {
        failedItems.push({ id, reason: '找不到簽核單' });
        continue;
      }
      if (detail.status !== 'pending') {
        failedItems.push({ id, reason: '此單據不在簽核中' });
        continue;
      }

      const steps = detail.steps || [];
      const step = findStepByOrder(steps, detail.current_step);
      if (!canUserApproveStep(req.user.id, step, id)) {
        failedItems.push({ id, reason: '您非目前步驟簽核人' });
        continue;
      }

      const stepOrder = Number(detail.current_step);
      const stepName = step?.name || `步驟 ${stepOrder}`;
      const defaultComment = action === 'approve' ? '批次同意核准' : '批次駁回';
      const finalComment = comment ? String(comment).trim() : defaultComment;

      if (action === 'approve') {
        // 批次核准：優先本次簽名，否則個人預設簽名（查 DB）
        let sigImg = signature_image ? String(signature_image).trim() : '';
        if (!sigImg) {
          const uSig = db
            .prepare(`SELECT signature_image FROM users WHERE id = ?`)
            .get(req.user.id);
          if (uSig?.signature_image) sigImg = uSig.signature_image;
        }
        db.prepare(
          `INSERT INTO approval_actions (request_id, step_order, step_name, actor_id, action, comment, form_data, signature_image)
           VALUES (?, ?, ?, ?, 'approve', ?, '{}', ?)`
        ).run(id, stepOrder, stepName, req.user.id, finalComment, sigImg || null);

        advanceToNextEligibleStep(id, detail, steps, step);
        const after = getRequestDetail(id);

        if (after.status === 'approved') {
          handleP2ApprovedSideEffects(after, req);
        }

        logAudit(req, {
          action_type: 'bulk_approve_request',
          category: 'approval',
          description: `批次核准申請單 #${id}「${detail.title}」`,
          target_id: id,
        });

        successIds.push(id);
      } else if (action === 'reject') {
        db.prepare(
          `INSERT INTO approval_actions (request_id, step_order, step_name, actor_id, action, comment, form_data)
           VALUES (?, ?, ?, ?, 'reject', ?, '{}')`
        ).run(id, stepOrder, stepName, req.user.id, finalComment);

        db.prepare(`UPDATE approval_requests SET status = 'rejected', updated_at = datetime('now', 'localtime') WHERE id = ?`)
          .run(id);

        logAudit(req, {
          action_type: 'bulk_reject_request',
          category: 'approval',
          description: `批次駁回申請單 #${id}「${detail.title}」`,
          target_id: id,
        });

        successIds.push(id);
      }
    } catch (e) {
      failedItems.push({ id, reason: e.message || '簽核失敗' });
    }
  }

  res.json({
    ok: true,
    processedCount: successIds.length,
    failedCount: failedItems.length,
    successIds,
    failedItems,
    message: `批次處理完成：成功 ${successIds.length} 筆${failedItems.length ? `，失敗 ${failedItems.length} 筆` : ''}`,
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
        `SELECT id FROM approval_actions WHERE request_id = ? AND step_name = ?`
      )
      .get(id, STEP_FINANCE_CONFIRM);
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
       VALUES (?, 4, ?, ?, 'comment', ?, ?)`
    ).run(
      id,
      STEP_FINANCE_CONFIRM,
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
          deptName: STEP_FINANCE_CONFIRM,
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
        `SELECT id FROM approval_actions WHERE request_id = ? AND step_name = ?`
      )
      .get(id, STEP_FINANCE_CONFIRM);
    if (!finDone) {
      return res.status(400).json({ error: '財務部尚未完成建檔確認' });
    }
    const existing = db
      .prepare(
        `SELECT id FROM approval_actions WHERE request_id = ? AND step_name = ?`
      )
      .get(id, STEP_APPLICANT_ACK);
    if (existing) {
      return res.status(400).json({ error: '已點選過確認，請勿重複送出' });
    }

    db.prepare(
      `INSERT INTO approval_actions (request_id, step_order, step_name, actor_id, action, comment, form_data)
       VALUES (?, 5, ?, ?, 'comment', '申請人已確認財務部授信額度建檔完成', '{}')`
    ).run(id, STEP_APPLICANT_ACK, req.user.id);

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

  // 草稿僅申請人／管理員可預覽 PDF
  if (
    detail.status === 'draft' &&
    detail.requester_id !== req.user.id &&
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

    const clientIp = getClientIp(req);
    const nowStr = tz.nowMinute();
    const watermarkText = `檢視防偽：${req.user.name} (${req.user.username}) · ${nowStr} · IP: ${clientIp}`;
    const detailEnriched = { ...detail, watermarkText };

    logAudit(req, {
      action_type: preview ? 'preview_pdf' : 'download_pdf',
      category: 'approval',
      description: `${preview ? '預覽' : '下載'}簽核單 PDF #${detail.id}「${detail.title}」`,
      target_id: detail.id,
    });

    // 產生 PDF（若系統設定啟用公司憑證則數位簽章；僅已核准通常才加簽）
    const pdfBuf = await pdfSign.buildApprovalPdfBuffer(detailEnriched, writeApprovalPdf);
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

// ---------- 管理員：PDF 備份與查詢 ----------
app.get('/api/backups/meta', authMiddleware, requirePerm('backups'), (req, res) => {
  res.json({ meta: getBackupMeta() });
});

app.get('/api/backups', authMiddleware, requirePerm('backups'), (req, res) => {
  const items = listBackups({
    department: req.query.department || '',
    workflow_name: req.query.workflow_name || '',
    year: req.query.year || '',
    month: req.query.month || '',
    keyword: req.query.keyword || '',
    status: req.query.status || '',
    limit: req.query.limit || 200,
  });
  res.json({ backups: items });
});

app.post('/api/backups/run', authMiddleware, requirePerm('backups'), async (req, res) => {
  try {
    const body = req.body || {};
    const result = await runBackupJob(
      {
        status: body.status || 'approved',
        department: body.department || '',
        workflow_name: body.workflow_name || '',
        date_from: body.date_from || '',
        date_to: body.date_to || '',
        force: !!body.force,
      },
      (id) => getRequestDetail(id),
      req.user.id
    );
    res.json({ ok: true, result });
  } catch (e) {
    console.error('backup run error', e);
    res.status(500).json({ error: e.message || '備份失敗' });
  }
});

app.post('/api/backups/request/:id', authMiddleware, requirePerm('backups'), async (req, res) => {
  try {
    const detail = getRequestDetail(Number(req.params.id));
    if (!detail) return res.status(404).json({ error: '找不到簽核單' });
    const item = await backupOneRequest(detail, req.user.id);
    res.json({ ok: true, backup: item });
  } catch (e) {
    console.error('backup one error', e);
    res.status(500).json({ error: e.message || '備份失敗' });
  }
});

app.get('/api/backups/:id/download', authMiddleware, requirePerm('backups'), (req, res) => {
  const row = getBackupById(req.params.id);
  if (!row) return res.status(404).json({ error: '找不到備份' });
  const abs = resolveBackupAbsPath(row);
  if (!abs) return res.status(404).json({ error: '備份檔案不存在，請重新執行備份' });
  const zip = isZipBackup(row);
  res.setHeader('Content-Type', zip ? 'application/zip' : 'application/pdf');
  const nameHint = String(row.file_name || '');
  const ascii = zip
    ? nameHint.includes('含附件')
      ? `backup-${row.request_id}-with-attachments.zip`
      : `backup-${row.request_id}.zip`
    : `backup-${row.request_id}.pdf`;
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(row.file_name || ascii)}`
  );
  fs.createReadStream(abs).pipe(res);
});

/** 系統管理員刪除單筆備份（含 PDF 檔） */
app.delete('/api/backups/:id', authMiddleware, adminOnly, (req, res) => {
  const result = deleteBackup(req.params.id);
  if (!result.ok) return res.status(404).json({ error: result.error });
  res.json({ ok: true, ...result });
});

/** 系統管理員批次刪除備份 */
app.post('/api/backups/bulk-delete', authMiddleware, adminOnly, (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  if (!ids.length) return res.status(400).json({ error: '請選擇至少一筆備份' });
  const { deleted, failed } = deleteBackups(ids);
  res.json({
    ok: true,
    deleted: deleted.length,
    failed: failed.length,
    deletedItems: deleted,
    failures: failed,
    message: `已刪除 ${deleted.length} 筆備份${failed.length ? `，${failed.length} 筆失敗` : ''}`,
  });
});

/**
 * 稽核日誌查詢條件 → WHERE 子句與參數（查詢與匯出共用）
 * @param {{ q?: string, category?: string, user_id?: string|number, dateFrom?: string, dateTo?: string }} query
 */
function buildAuditLogFilter(query = {}) {
  const { q, category, user_id, dateFrom, dateTo } = query || {};
  const where = [];
  const params = [];

  if (q && String(q).trim()) {
    const kw = `%${String(q).trim()}%`;
    where.push(
      `(user_name LIKE ? OR user_username LIKE ? OR description LIKE ? OR ip_address LIKE ? OR action_type LIKE ?)`
    );
    params.push(kw, kw, kw, kw, kw);
  }
  if (category && String(category).trim()) {
    where.push(`category = ?`);
    params.push(String(category).trim());
  }
  if (user_id) {
    where.push(`user_id = ?`);
    params.push(Number(user_id));
  }
  if (dateFrom && String(dateFrom).trim()) {
    where.push(`created_at >= ?`);
    params.push(`${String(dateFrom).trim()} 00:00:00`);
  }
  if (dateTo && String(dateTo).trim()) {
    where.push(`created_at <= ?`);
    params.push(`${String(dateTo).trim()} 23:59:59`);
  }

  return { whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

/**
 * 取得系統進階稽核日誌 (P3-1)
 * GET /api/system/audit-logs
 * Query: { q, category, user_id, dateFrom, dateTo, page, limit }
 */
app.get('/api/system/audit-logs', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin' && !userHasPermission(req.user.id, 'audit_logs')) {
    return res.status(403).json({ error: '需要系統稽核日誌權限' });
  }

  const { page = 1, limit = 50 } = req.query || {};
  const p = Math.max(1, Number(page) || 1);
  const l = Math.min(200, Math.max(10, Number(limit) || 50));
  const offset = (p - 1) * l;

  const { whereSql, params } = buildAuditLogFilter(req.query);

  const totalCount = db.prepare(`SELECT COUNT(*) AS c FROM system_audit_logs ${whereSql}`).get(...params)?.c || 0;
  const logs = db.prepare(`SELECT * FROM system_audit_logs ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...params, l, offset);

  const categories = ['auth', 'approval', 'user_management', 'workflow', 'system'];

  res.json({
    logs,
    totalCount,
    totalPages: Math.ceil(totalCount / l),
    page: p,
    limit: l,
    categories,
  });
});

/**
 * 匯出系統進階稽核日誌 CSV (P3-1)
 * GET /api/system/audit-logs/export
 */
app.get('/api/system/audit-logs/export', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin' && !userHasPermission(req.user.id, 'audit_logs')) {
    return res.status(403).json({ error: '需要系統稽核日誌權限' });
  }

  const { whereSql, params } = buildAuditLogFilter(req.query);
  const logs = db.prepare(`SELECT * FROM system_audit_logs ${whereSql} ORDER BY id DESC LIMIT 5000`).all(...params);

  // UTF-8 BOM CSV output for Excel compatibility
  const BOM = '\uFEFF';
  const headers = ['ID', '時間', '分類', '動作類型', '使用者', '帳號', 'IP 位址', '目標 ID', '說明詳情'];
  const rows = logs.map((l) => [
    l.id,
    l.created_at,
    l.category || '',
    l.action_type || '',
    l.user_name || '',
    l.user_username || '',
    l.ip_address || '',
    l.target_id || '',
    (l.description || '').replace(/"/g, '""'),
  ]);

  const csvContent = BOM + [headers.join(','), ...rows.map((r) => r.map((cell) => `"${cell}"`).join(','))].join('\r\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="system_audit_logs_${tz.today()}.csv"`);
  res.send(csvContent);
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
             AND ${CREDIT_LIMIT_COND}
             AND r.id NOT IN (
               SELECT request_id FROM approval_actions WHERE step_name = ?
             )`
        )
        .get(STEP_FINANCE_CONFIRM).c
    : 0;
  const pendingApplicantAck = db
    .prepare(
      `SELECT COUNT(*) AS c FROM approval_requests r
       JOIN workflows w ON w.id = r.workflow_id
       WHERE r.status = 'approved'
         AND r.requester_id = ?
         AND ${CREDIT_LIMIT_COND}
         AND r.id IN (
           SELECT request_id FROM approval_actions WHERE step_name = ?
         )
         AND r.id NOT IN (
           SELECT request_id FROM approval_actions WHERE step_name = ?
         )`
    )
    .get(uid, STEP_FINANCE_CONFIRM, STEP_APPLICANT_ACK).c;

  const pendingFinalNotify = getPendingFinalNotifyCount(uid);

  const monthlyRequests = db
    .prepare(
      `SELECT COUNT(*) AS c FROM approval_requests
       WHERE requester_id = ? AND created_at >= date('now', 'start of month', 'localtime')`
    )
    .get(uid).c;
  const avgRow = db
    .prepare(
      `SELECT AVG(julianday(completed_at) - julianday(created_at)) AS d
       FROM approval_requests
       WHERE requester_id = ? AND status = 'approved' AND completed_at IS NOT NULL`
    )
    .get(uid);
  const avgApprovalDays =
    avgRow?.d != null ? Math.round(avgRow.d * 10) / 10 : null;

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
      monthlyRequests,
      avgApprovalDays,
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
    console.log(`  JWT: ${JWT_SECRET_SOURCE === 'env' ? '環境變數' : JWT_SECRET_SOURCE === 'file' ? 'data/.jwt-secret' : '本次新產生'}`);
    console.log(`  時間: ${tz.nowStamp()}（台灣時間）`);
    // 主機時區不是 UTC+8 時大聲提醒：資料庫寫入的時間會錯，且只能在啟動前修正
    tz.warnIfHostTzMismatch();
    console.log('內建管理員帳號: Admin（首次安裝請看 data/.admin-bootstrap.txt，並立刻改密）');
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
