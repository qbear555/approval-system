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
  parseCookies,
} = require('./auth');
const loginRateLimit = require('./login-rate-limit');
const accessControl = require('./access-control');
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

function setDeviceCookie(req, res, token) {
  res.cookie(DEVICE_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: DEVICE_COOKIE_MS,
    secure: !!(req && req.secure),
  });
}

function bindOrCheckDevice(req, res, user) {
  const cfg = systemSettings.getAccessControl();
  if (!cfg.deviceBindEnabled) return { ok: true };
  const cookies = parseCookies(req);
  let token = String(cookies[DEVICE_COOKIE] || '').trim();
  if (token) {
    const row = db
      .prepare(`SELECT id FROM user_devices WHERE user_id = ? AND device_token = ?`)
      .get(user.id, token);
    if (row) {
      db.prepare(
        `UPDATE user_devices SET last_seen_at = datetime('now','localtime'), ip_address = ? WHERE id = ?`
      ).run(getClientIp(req), row.id);
      setDeviceCookie(req, res, token);
      return { ok: true };
    }
  }
  const count = db.prepare(`SELECT COUNT(*) AS c FROM user_devices WHERE user_id = ?`).get(user.id).c;
  const max = cfg.deviceBindMax || 3;
  if (count >= max && !isBuiltinAdminUser(user)) {
    return {
      ok: false,
      error: `此電腦尚未綁定（本帳號已達 ${max} 台）。請洽系統管理員在成員名單解除舊裝置。`,
    };
  }
  token = crypto.randomBytes(16).toString('hex');
  const ua = String(req.headers['user-agent'] || '').slice(0, 180);
  db.prepare(
    `INSERT INTO user_devices (user_id, device_token, label, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?)`
  ).run(user.id, token, ua.slice(0, 80) || '瀏覽器', getClientIp(req), ua);
  setDeviceCookie(req, res, token);
  return { ok: true };
}

function listUserDevices(userId) {
  return db
    .prepare(
      `SELECT id, label, ip_address, last_seen_at, created_at FROM user_devices WHERE user_id = ? ORDER BY last_seen_at DESC`
    )
    .all(userId);
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

/** 內網限制：探活／品牌／Logo 除外 */
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();
  if (
    req.path === '/api/health' ||
    req.path === '/api/system/branding' ||
    req.path === '/api/system/logo'
  ) {
    return next();
  }
  const cfg = systemSettings.getAccessControl();
  if (!cfg.intranetOnly) return next();
  const ip = getClientIp(req);
  if (accessControl.ipAllowed(ip, cfg.loginCidrs)) return next();
  logAudit(req, {
    action_type: 'intranet_blocked',
    category: 'auth',
    description: `拒絕非內網存取（IP：${ip}）`,
  });
  return res.status(403).json({ error: '僅限公司內網存取' });
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
const REQUEST_NOT_DELETED = `(IFNULL(r.deleted_at,'') = '')`;
const DEVICE_COOKIE = 'approval_device';
const DEVICE_COOKIE_MS = 400 * 24 * 60 * 60 * 1000;

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
         AND ${REQUEST_NOT_DELETED}
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
         AND ${REQUEST_NOT_DELETED}
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
         AND ${REQUEST_NOT_DELETED}
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
  if (row.deleted_at) return null;

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

require('./routes/bind-routes')({
  app, db, fs, path, crypto, multer, express, tz, mail, labor, leaveReport, twCalendar,
  systemSettings, pdfSign, appVersion, deployLog, onlyoffice, systemPackage,
  workflowModule, flowGraph, flowEngine, importPayload, lineNotify,
  archiver, PassThrough, XLSX: require('xlsx'),
  authMiddleware, adminOnly, builtinAdminOnly, requirePerm, lineSettingsOnly,
  normalizeUsername, isBuiltinAdminUsername, isBuiltinAdminUser,
  hashPassword, verifyPassword, isWeakPlainPassword, hashMatchesWeakPassword,
  generateBootstrapPassword, signToken, setAuthCookie, clearAuthCookie,
  parseCookies, loginRateLimit, accessControl,
  generateApprovalPdf, writeApprovalPdf, buildApprovalPdfFileName,
  buildApprovalZipFileName, contentDispositionAttachment, getChineseFontPath,
  runBackupJob, listBackups, getBackupMeta, getBackupById, resolveBackupAbsPath,
  backupOneRequest, deleteBackup, deleteBackups, isZipBackup,
  decodeUploadFilename, safeUploadExt, saveAttachments, getAttachments,
  isFinalApprovalStep, canUserAttachOnStep, setDeviceCookie, bindOrCheckDevice,
  listUserDevices, getClientIp, logAudit, handleP2ApprovedSideEffects,
  hasApproverSigned, isFinanceUser, isCreditLimitRequestRow,
  canDeleteApprovalRecords, isLeaveApprovalRequest, canDeleteLeaveRequests,
  parsePermissions, getPermissionsForUser, getUserDepartments, publicUser,
  getUserEmailsByIds, diagnoseApproverEmails, fireAndForgetMail, fireAndForgetLine,
  getAppBaseUrl, getUsernameById, getUsernamesByIds, canConfigureLineSettings,
  findStepByOrder, getPendingApproverIds, notifyCurrentApprovers,
  addUserToDepartment, removeUserFromDepartment, userHasPermission,
  normalizeDateTime30, parseCosignIds, resolveNextHireDate, formatUserLabels,
  parseSteps, parseStepCondition, resolveLeaveTypeOptions, validateStepTemplate,
  parseFormFields, mergeFormTables, validateFormData, mergeDeptHeadFormData,
  mergeUsersPickFormData, mergeCosignFormData, queryDepartmentUsers, getDeptHead,
  resolveUnitName, getUsersInDepartment, resolveStepsForRequest, loadStepsForRequest,
  resolveUserIdList, resolveFinalNotifyJson, createFinalNotifyReceipts,
  getPendingFinalNotifyCount, getPendingFinalNotifyRequests,
  getPendingFinanceConfirmRequests, getPendingApplicantAckRequests,
  loadFinalNotifyReceiptsForRequest, enrichUserListFromDb, enrichFinalNotifyUsers,
  serializeWorkflow, getWorkflowGraph, buildResolvedGraph, getRequestGraph,
  isGraphRequest, resolveActionableStep, getRequestDetail,
  getActiveDelegationForUser, getGrantorUserIdsForDelegate,
  checkUserApprovalRight, canUserApproveStep, isStepComplete,
  evaluateStepCondition, advanceToNextEligibleStep, isValidDepartment,
  upload, uploadPackage,
  FIELD_TYPES, REQUEST_LIST_SELECT, REQUEST_NOT_DELETED, DEVICE_COOKIE, DEVICE_COOKIE_MS,
  CREDIT_LIMIT_COND, STEP_FINANCE_CONFIRM, STEP_APPLICANT_ACK, PERMISSION_DEFS,
  ALL_PERM_IDS, UPLOAD_DIR, MSG_LOCKED_AFTER_SIGN,
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
