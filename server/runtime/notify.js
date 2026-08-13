/**
 * Email／LINE／最終核准通知
 */
const db = require('../db');
const mail = require('../mail');
const lineNotify = require('../line-notify');
const systemSettings = require('../system-settings');
const workflowModule = require('../workflow-module');
const { logAudit } = require('./devices');
function findStepByOrder(...a) {
  return require('./flow').findStepByOrder(...a);
}
function getPendingApproverIds(...a) {
  return require('./flow').getPendingApproverIds(...a);
}
function resolveUserIdList(...a) {
  return require('./flow').resolveUserIdList(...a);
}
function flowConst(name) {
  return require('./flow')[name];
}

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
    const fromMail = String(cfg.baseUrl || '')
      .trim()
      .replace(/\/$/, '');
    if (fromMail) return fromMail;
  } catch {
    /* fall through */
  }
  const port = process.env.PORT || 3847;
  return `http://127.0.0.1:${port}`;
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
         AND ${flowConst('REQUEST_NOT_DELETED')}
       ORDER BY fn.created_at DESC`
    )
    .all(Number(userId));
}

/** 待財務部額度建檔確認的已核准信用額度單 */

function getPendingFinanceConfirmRequests() {
  return db
    .prepare(
      `${flowConst('REQUEST_LIST_SELECT')}
       WHERE r.status = 'approved'
         AND ${flowConst('REQUEST_NOT_DELETED')}
         AND ${flowConst('CREDIT_LIMIT_COND')}
         AND r.id NOT IN (
           SELECT request_id FROM approval_actions WHERE step_name = ?
         )
       ORDER BY r.completed_at DESC, r.updated_at DESC`
    )
    .all(flowConst('STEP_FINANCE_CONFIRM'));
}

/** 財務已建檔、待申請人確認收到的信用額度單 */

function getPendingApplicantAckRequests(userId) {
  return db
    .prepare(
      `${flowConst('REQUEST_LIST_SELECT')}
       WHERE r.status = 'approved'
         AND ${flowConst('REQUEST_NOT_DELETED')}
         AND r.requester_id = ?
         AND ${flowConst('CREDIT_LIMIT_COND')}
         AND r.id IN (
           SELECT request_id FROM approval_actions WHERE step_name = ?
         )
         AND r.id NOT IN (
           SELECT request_id FROM approval_actions WHERE step_name = ?
         )
       ORDER BY r.completed_at DESC, r.updated_at DESC`
    )
    .all(Number(userId), flowConst('STEP_FINANCE_CONFIRM'), flowConst('STEP_APPLICANT_ACK'));
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


module.exports = {
  handleP2ApprovedSideEffects,
  getUserEmailsByIds,
  diagnoseApproverEmails,
  fireAndForgetMail,
  fireAndForgetLine,
  getAppBaseUrl,
  getUsernameById,
  getUsernamesByIds,
  notifyCurrentApprovers,
  resolveFinalNotifyJson,
  createFinalNotifyReceipts,
  getPendingFinalNotifyCount,
  getPendingFinalNotifyRequests,
  getPendingFinanceConfirmRequests,
  getPendingApplicantAckRequests,
  loadFinalNotifyReceiptsForRequest,
  enrichUserListFromDb,
  enrichFinalNotifyUsers,
};
