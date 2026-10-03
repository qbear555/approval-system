/**
 * 統一代理人（代簽 + 代申請請假 + 請假職務代理人代簽）
 * - 不修改既有簽核中單據的步驟快照
 * - 僅影響新授權、新代申請、以及「可代簽」的待辦判斷
 * - 請假單表單「代理人」= 職務代理人：於申請人請假起迄期間可代其簽核
 */
const db = require('./db');

function nowLocalSql() {
  // SQLite datetime('now','localtime') 比對用：以字串 YYYY-MM-DD HH:MM:SS
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  // 以本機時間
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function normalizeDt(s) {
  if (s == null || s === '') return null;
  const t = String(s).trim().replace('T', ' ').replace(/\.\d+Z?$/, '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return `${t} 00:00:00`;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(t)) return `${t}:00`;
  return t.slice(0, 19);
}

/** 結束時間：若僅日期，算到當日 23:59:59 */
function normalizeEndDt(s) {
  if (s == null || s === '') return null;
  const t = String(s).trim().replace('T', ' ').replace(/\.\d+Z?$/, '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return `${t} 23:59:59`;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(t)) return `${t}:00`;
  return t.slice(0, 19);
}

/** 現在是否落在請假表單起迄內 */
function isWithinLeavePeriod(formData, at = null) {
  const fd = formData && typeof formData === 'object' ? formData : {};
  const now = at || nowLocalSql();
  const start = normalizeDt(fd.start_date || fd.start || fd.begin_date || '');
  const end = normalizeEndDt(fd.end_date || fd.end || fd.finish_date || '');
  if (!start && !end) return false;
  if (start && now < start) return false;
  if (end && now > end) return false;
  return true;
}

function parseFormDataJson(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw || '{}') || {};
  } catch {
    return {};
  }
}

function isLeaveRequestRow(row) {
  const n = String(row?.workflow_name || row?.title || '');
  return /請假|休假|leave/i.test(n);
}

/**
 * 請假單職務代理人：目前可代簽的 principal（請假申請人）id 列表
 * - 表單欄位 agent（代理人）= 職務代理人
 * - 狀態 pending／approved（已送出、未駁回／取消）
 * - 現在時間落在 start_date～end_date
 */
function getLeaveDutyPrincipalRows(agentId, at = null) {
  const aid = Number(agentId);
  if (!aid) return [];
  let rows = [];
  try {
    rows = db
      .prepare(
        `SELECT r.id, r.requester_id, r.status, r.form_data, r.title,
                w.name AS workflow_name
         FROM approval_requests r
         JOIN workflows w ON w.id = r.workflow_id
         WHERE r.status IN ('pending', 'approved')
           AND r.requester_id != ?
         ORDER BY r.id DESC
         LIMIT 800`
      )
      .all(aid);
  } catch {
    return [];
  }
  const now = at || nowLocalSql();
  const out = [];
  const seen = new Set();
  for (const r of rows) {
    if (!isLeaveRequestRow(r)) continue;
    const fd = parseFormDataJson(r.form_data);
    const duty = Number(fd.agent || fd.代理人 || 0);
    if (duty !== aid) continue;
    if (!isWithinLeavePeriod(fd, now)) continue;
    const pid = Number(r.requester_id);
    if (!pid || seen.has(pid)) continue;
    seen.add(pid);
    out.push({
      principal_id: pid,
      leave_request_id: r.id,
      start_at: normalizeDt(fd.start_date || fd.start || ''),
      end_at: normalizeEndDt(fd.end_date || fd.end || ''),
      principal: userBrief(pid),
    });
  }
  return out;
}

function getPrincipalIdsFromLeaveDuty(agentId, at = null) {
  return getLeaveDutyPrincipalRows(agentId, at).map((x) => x.principal_id);
}

/**
 * 某 principal 目前有效的請假職務代理人 id 列表（給通知用）
 */
function getLeaveDutyAgentIdsForPrincipal(principalId, at = null) {
  const pid = Number(principalId);
  if (!pid) return [];
  let rows = [];
  try {
    rows = db
      .prepare(
        `SELECT r.id, r.requester_id, r.status, r.form_data, r.title,
                w.name AS workflow_name
         FROM approval_requests r
         JOIN workflows w ON w.id = r.workflow_id
         WHERE r.status IN ('pending', 'approved')
           AND r.requester_id = ?
         ORDER BY r.id DESC
         LIMIT 200`
      )
      .all(pid);
  } catch {
    return [];
  }
  const now = at || nowLocalSql();
  const agentsSet = new Set();
  for (const r of rows) {
    if (!isLeaveRequestRow(r)) continue;
    const fd = parseFormDataJson(r.form_data);
    if (!isWithinLeavePeriod(fd, now)) continue;
    const duty = Number(fd.agent || fd.代理人 || 0);
    if (duty && duty !== pid) agentsSet.add(duty);
  }
  return [...agentsSet];
}

/** 列是否在有效期間內 */
function isRowEffective(row, at = null) {
  if (!row || !row.active) return false;
  const now = at || nowLocalSql();
  const start = normalizeDt(row.start_at);
  const end = normalizeDt(row.end_at);
  if (start && now < start) return false;
  if (end && now > end) return false;
  return true;
}

function userInFinanceDept(userId) {
  const uid = Number(userId);
  if (!uid) return false;
  const u = db
    .prepare(`SELECT id, department FROM users WHERE id = ?`)
    .get(uid);
  if (!u) return false;
  if (String(u.department || '').trim() === '財務部') return true;
  try {
    const hit = db
      .prepare(
        `SELECT 1 FROM user_departments WHERE user_id = ? AND department = '財務部' LIMIT 1`
      )
      .get(uid);
    return !!hit;
  } catch {
    return false;
  }
}

/** 財務部發出：申請人或代申請人隸屬財務部 */
function isFinanceIssuedRequest(requestId) {
  const id = Number(requestId);
  if (!id) return false;
  const r = db
    .prepare(
      `SELECT requester_id, submitted_by FROM approval_requests WHERE id = ?`
    )
    .get(id);
  if (!r) return false;
  if (userInFinanceDept(r.requester_id)) return true;
  if (r.submitted_by && userInFinanceDept(r.submitted_by)) return true;
  return false;
}

function userBrief(id) {
  if (!id) return null;
  const u = db
    .prepare(
      `SELECT id, username, name, department, active FROM users WHERE id = ?`
    )
    .get(Number(id));
  return u || null;
}

function serializeAgentRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    principal_id: row.principal_id,
    agent_id: row.agent_id,
    principal: userBrief(row.principal_id),
    agent: userBrief(row.agent_id),
    start_at: row.start_at || null,
    end_at: row.end_at || null,
    can_approve: row.can_approve !== 0,
    can_submit_leave: row.can_submit_leave !== 0,
    active: row.active !== 0,
    note: row.note || '',
    effective: isRowEffective(row),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** 我設定的代理人（我是 principal） */
function listMyAgents(principalId) {
  const rows = db
    .prepare(
      `SELECT * FROM user_agents
       WHERE principal_id = ? AND active = 1
       ORDER BY id DESC`
    )
    .all(Number(principalId));
  return rows.map(serializeAgentRow);
}

/** 誰指定我為代理人（我是 agent）— user_agents 設定 */
function listWhereIAmAgent(agentId) {
  const rows = db
    .prepare(
      `SELECT * FROM user_agents
       WHERE agent_id = ? AND active = 1
       ORDER BY id DESC`
    )
    .all(Number(agentId));
  return rows.map(serializeAgentRow).filter((r) => r.effective);
}

/**
 * 誰因請假職務代理人而可被我代簽（併入設定頁「我目前可代理」）
 */
function listWhereIAmLeaveDutyAgent(agentId) {
  return getLeaveDutyPrincipalRows(agentId).map((x) => ({
    id: `leave-${x.leave_request_id}`,
    principal_id: x.principal_id,
    agent_id: Number(agentId),
    principal: x.principal,
    agent: userBrief(agentId),
    start_at: x.start_at,
    end_at: x.end_at,
    can_approve: true,
    can_submit_leave: false,
    active: true,
    note: '請假職務代理人',
    effective: true,
    source: 'leave_duty',
    leave_request_id: x.leave_request_id,
  }));
}

/**
 * 取得 agent 目前可代簽的 principal id 列表
 * （user_agents 可代簽 + 請假職務代理人期間）
 */
function getPrincipalIdsForApprover(agentId) {
  const rows = db
    .prepare(
      `SELECT * FROM user_agents
       WHERE agent_id = ? AND active = 1 AND can_approve = 1`
    )
    .all(Number(agentId));
  const fromSetting = rows
    .filter((r) => isRowEffective(r))
    .map((r) => Number(r.principal_id));
  const fromLeave = getPrincipalIdsFromLeaveDuty(agentId);
  return [...new Set([...fromSetting, ...fromLeave].filter(Boolean))];
}

/**
 * agent 是否可代 principal 申請請假
 */
function canSubmitLeaveFor(agentId, principalId) {
  if (Number(agentId) === Number(principalId)) return true; // 本人
  const rows = db
    .prepare(
      `SELECT * FROM user_agents
       WHERE agent_id = ? AND principal_id = ? AND active = 1 AND can_submit_leave = 1`
    )
    .all(Number(agentId), Number(principalId));
  return rows.some((r) => isRowEffective(r));
}

/**
 * agent 是否可代 principal 簽核
 * （user_agents 可代簽 或 請假職務代理人期間）
 */
function canApproveFor(agentId, principalId) {
  if (Number(agentId) === Number(principalId)) return true;
  const rows = db
    .prepare(
      `SELECT * FROM user_agents
       WHERE agent_id = ? AND principal_id = ? AND active = 1 AND can_approve = 1`
    )
    .all(Number(agentId), Number(principalId));
  if (rows.some((r) => isRowEffective(r))) return true;
  return getPrincipalIdsFromLeaveDuty(agentId).includes(Number(principalId));
}

/**
 * 設定／更新我的代理人（初版：同時僅一位有效代理人）
 * 會停用同 principal 其他 active 列
 */
function setMyAgent(principalId, payload, createdBy) {
  const agentId = Number(payload.agent_id);
  if (!agentId) return { error: '請選擇代理人' };
  if (agentId === Number(principalId)) return { error: '不可指定自己為代理人' };
  const u = db
    .prepare(`SELECT id, active FROM users WHERE id = ?`)
    .get(agentId);
  if (!u || !u.active) return { error: '代理人帳號不存在或已停用' };

  const startAt = normalizeDt(payload.start_at) || null;
  const endAt = normalizeDt(payload.end_at) || null;
  if (startAt && endAt && startAt > endAt) {
    return { error: '結束時間不可早於開始時間' };
  }
  const canApprove =
    payload.can_approve === false || payload.can_approve === 0 || payload.can_approve === '0'
      ? 0
      : 1;
  const canSubmitLeave =
    payload.can_submit_leave === false ||
    payload.can_submit_leave === 0 ||
    payload.can_submit_leave === '0'
      ? 0
      : 1;
  if (!canApprove && !canSubmitLeave) {
    return { error: '請至少啟用「可代簽」或「可代申請請假」之一' };
  }
  const note = String(payload.note || '').slice(0, 200);

  // 停用既有
  db.prepare(
    `UPDATE user_agents SET active = 0, updated_at = datetime('now','localtime')
     WHERE principal_id = ? AND active = 1`
  ).run(Number(principalId));

  const r = db
    .prepare(
      `INSERT INTO user_agents
        (principal_id, agent_id, start_at, end_at, can_approve, can_submit_leave, active, note, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`
    )
    .run(
      Number(principalId),
      agentId,
      startAt,
      endAt,
      canApprove,
      canSubmitLeave,
      note,
      Number(createdBy) || Number(principalId)
    );

  const row = db.prepare(`SELECT * FROM user_agents WHERE id = ?`).get(r.lastInsertRowid);
  return { agent: serializeAgentRow(row) };
}

function clearMyAgent(principalId) {
  db.prepare(
    `UPDATE user_agents SET active = 0, updated_at = datetime('now','localtime')
     WHERE principal_id = ? AND active = 1`
  ).run(Number(principalId));
  return { ok: true };
}

/**
 * 步驟上，userId 可「以本人身分」或「代理某 principal」簽核的對象
 * 回傳 { asSelf, principalIds[] } principalIds 為可代簽且尚未完成核准的正職 id
 */
function getApproveCapacity(userId, step, requestId, hasApprovalForPrincipalFn) {
  if (!step || !Array.isArray(step.approverIds)) {
    return { asSelf: false, principalIds: [] };
  }
  const uid = Number(userId);
  const ids = step.approverIds.map(Number).filter(Boolean);
  const asSelf = ids.includes(uid);
  // 本人在名單內：優先本人簽，不走代簽
  if (asSelf) {
    const already = hasApprovalForPrincipalFn(requestId, step, uid);
    return { asSelf: !already, principalIds: [] };
  }
  if (isFinanceIssuedRequest(requestId)) {
    return { asSelf: false, principalIds: [] };
  }
  const principals = getPrincipalIdsForApprover(uid).filter((pid) => ids.includes(pid));
  const pending = principals.filter(
    (pid) => !hasApprovalForPrincipalFn(requestId, step, pid)
  );
  return { asSelf: false, principalIds: pending };
}

module.exports = {
  nowLocalSql,
  isRowEffective,
  isWithinLeavePeriod,
  listMyAgents,
  listWhereIAmAgent,
  listWhereIAmLeaveDutyAgent,
  getPrincipalIdsForApprover,
  getPrincipalIdsFromLeaveDuty,
  getLeaveDutyPrincipalRows,
  getLeaveDutyAgentIdsForPrincipal,
  canSubmitLeaveFor,
  canApproveFor,
  setMyAgent,
  clearMyAgent,
  getApproveCapacity,
  serializeAgentRow,
  userBrief,
  userInFinanceDept,
  isFinanceIssuedRequest,
};
