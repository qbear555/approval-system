/**
 * 權限、成員公開資料、部門歸屬
 */
const db = require('../db');
const labor = require('../labor');
const { isBuiltinAdminUser, isBuiltinAdminUsername } = require('../auth');

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

function isValidDepartment(name) {
  if (!name) return true; // optional
  const row = db
    .prepare(`SELECT id FROM departments WHERE name = ? AND active = 1`)
    .get(String(name).trim());
  return !!row;
}

module.exports = {
  PERMISSION_DEFS,
  ALL_PERM_IDS,
  isFinanceUser,
  isCreditLimitRequestRow,
  canDeleteApprovalRecords,
  isLeaveApprovalRequest,
  canDeleteLeaveRequests,
  parsePermissions,
  getPermissionsForUser,
  getUserDepartments,
  publicUser,
  canConfigureLineSettings,
  lineSettingsOnly,
  addUserToDepartment,
  removeUserFromDepartment,
  userHasPermission,
  requirePerm,
  isValidDepartment,
};
