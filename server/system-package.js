/**
 * 系統設定完整包：匯出／匯入
 * 包含：部門、成員（含密碼雜湊與權限）、簽核流程、Email 設定
 * 可選：歷史申請單、簽核歷程、附件實體檔
 */
const tz = require('./tz');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const mail = require('./mail');
const { importPayload } = require('./import-workflows');

const DATA_DIR = path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const FORMAT = 'approval-system-config-package';
const VERSION = 1;

function safeJsonParse(s, fallback) {
  try {
    return JSON.parse(s || '');
  } catch {
    return fallback;
  }
}

function getUserDepartments(userId) {
  return db
    .prepare(
      `SELECT department FROM user_departments WHERE user_id = ? ORDER BY department COLLATE NOCASE`
    )
    .all(userId)
    .map((r) => r.department);
}

/** 建置匯出內容 */
function buildPackage({ includeHistory = false, includeMailSecrets = true } = {}) {
  const departments = db
    .prepare(
      `SELECT id, name, sort_order, active FROM departments WHERE active = 1 ORDER BY sort_order, id`
    )
    .all()
    .map((d) => ({
      exportId: d.id,
      name: d.name,
      sort_order: d.sort_order,
      active: d.active,
    }));

  const users = db
    .prepare(
      `SELECT id, username, password_hash, name, email, phone, extension, department,
              role, active, permissions_json, email_notify, hire_date
       FROM users ORDER BY id`
    )
    .all()
    .map((u) => ({
      exportId: u.id,
      username: u.username,
      password_hash: u.password_hash,
      name: u.name,
      email: u.email || '',
      phone: u.phone || '',
      extension: u.extension || '',
      department: u.department || '',
      departments: getUserDepartments(u.id),
      role: u.role === 'admin' ? 'admin' : 'user',
      active: u.active ? 1 : 0,
      permissions: safeJsonParse(u.permissions_json, []),
      email_notify: u.email_notify === 0 ? 0 : 1,
      hire_date: u.hire_date || null,
    }));

  const workflows = db
    .prepare(
      `SELECT * FROM workflows WHERE IFNULL(purged, 0) = 0 ORDER BY id`
    )
    .all()
    .map((row) => {
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
        const approverIds = Array.isArray(s.approverIds)
          ? s.approverIds.map(Number).filter(Boolean)
          : [];
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
      return {
        exportId: row.id,
        name: row.name,
        description: row.description || '',
        active: row.active ? 1 : 0,
        formFields,
        steps: stepsEnriched,
      };
    });

  let mailConfig = null;
  try {
    const cfg = mail.loadConfig();
    mailConfig = {
      enabled: Boolean(cfg.enabled),
      host: cfg.host || '',
      port: Number(cfg.port) || 587,
      secure: Boolean(cfg.secure),
      user: cfg.user || '',
      from: cfg.from || '',
      fromName: cfg.fromName || '線上簽核系統',
      baseUrl: cfg.baseUrl || '',
    };
    if (includeMailSecrets && cfg.pass) {
      mailConfig.pass = cfg.pass;
    } else {
      mailConfig.hasPass = Boolean(cfg.pass);
    }
  } catch (e) {
    mailConfig = null;
  }

  let history = null;
  if (includeHistory) {
    const requests = db
      .prepare(`SELECT * FROM approval_requests ORDER BY id`)
      .all()
      .map((r) => ({
        exportId: r.id,
        workflow_export_id: r.workflow_id,
        title: r.title,
        content: r.content || '',
        form_data: r.form_data || '{}',
        form_schema_json: r.form_schema_json || '[]',
        steps_snapshot_json: r.steps_snapshot_json || null,
        approver_data_json: r.approver_data_json || '{}',
        requester_export_id: r.requester_id,
        status: r.status,
        current_step: r.current_step,
        notify_email: r.notify_email,
        last_remind_at: r.last_remind_at || null,
        created_at: r.created_at,
        updated_at: r.updated_at,
        completed_at: r.completed_at || null,
      }));

    const actions = db
      .prepare(`SELECT * FROM approval_actions ORDER BY id`)
      .all()
      .map((a) => ({
        exportId: a.id,
        request_export_id: a.request_id,
        step_order: a.step_order,
        step_name: a.step_name || '',
        actor_export_id: a.actor_id,
        action: a.action,
        comment: a.comment || '',
        form_data: a.form_data || '{}',
        created_at: a.created_at,
      }));

    const attachments = db
      .prepare(`SELECT * FROM request_attachments ORDER BY id`)
      .all()
      .map((att) => {
        const item = {
          exportId: att.id,
          request_export_id: att.request_id,
          original_name: att.original_name,
          stored_name: att.stored_name,
          mime_type: att.mime_type || '',
          size_bytes: att.size_bytes || 0,
          uploaded_by_export_id: att.uploaded_by,
          step_order: att.step_order,
          created_at: att.created_at,
          contentBase64: null,
        };
        const abs = path.join(UPLOAD_DIR, att.stored_name);
        if (att.stored_name && fs.existsSync(abs)) {
          try {
            const buf = fs.readFileSync(abs);
            // 單檔超過 15MB 略過內容（仍保留中繼資料）
            if (buf.length <= 15 * 1024 * 1024) {
              item.contentBase64 = buf.toString('base64');
            } else {
              item.contentSkipped = true;
              item.contentSkipReason = 'file too large (>15MB)';
            }
          } catch (e) {
            item.contentSkipped = true;
            item.contentSkipReason = e.message;
          }
        }
        return item;
      });

    history = {
      requests,
      actions,
      attachments,
      counts: {
        requests: requests.length,
        actions: actions.length,
        attachments: attachments.length,
        attachmentsWithFile: attachments.filter((a) => a.contentBase64).length,
      },
    };
  }

  return {
    format: FORMAT,
    version: VERSION,
    exportedAt: tz.nowIso(),
    includeHistory: Boolean(includeHistory),
    includeMailSecrets: Boolean(includeMailSecrets && mailConfig && mailConfig.pass),
    summary: {
      departments: departments.length,
      users: users.length,
      workflows: workflows.length,
      requests: history ? history.counts.requests : 0,
      attachments: history ? history.counts.attachments : 0,
    },
    departments,
    users,
    workflows,
    mailConfig,
    history,
  };
}

function ensureDept(name, sortOrder = 0) {
  const n = String(name || '').trim();
  if (!n) return null;
  const existing = db
    .prepare(`SELECT id, active FROM departments WHERE name = ?`)
    .get(n);
  if (existing) {
    if (!existing.active) {
      db.prepare(
        `UPDATE departments SET active = 1, sort_order = ? WHERE id = ?`
      ).run(sortOrder, existing.id);
    }
    return existing.id;
  }
  const info = db
    .prepare(`INSERT INTO departments (name, sort_order, active) VALUES (?, ?, 1)`)
    .run(n, sortOrder);
  return Number(info.lastInsertRowid);
}

function setUserDepartments(userId, deptNames, primary) {
  db.prepare(`DELETE FROM user_departments WHERE user_id = ?`).run(userId);
  const set = new Set();
  for (const d of deptNames || []) {
    const name = String(d || '').trim();
    if (!name) continue;
    ensureDept(name);
    set.add(name);
  }
  const prim = String(primary || '').trim();
  if (prim) {
    ensureDept(prim);
    set.add(prim);
  }
  for (const name of set) {
    db.prepare(
      `INSERT OR IGNORE INTO user_departments (user_id, department) VALUES (?, ?)`
    ).run(userId, name);
  }
  if (prim) {
    db.prepare(`UPDATE users SET department = ? WHERE id = ?`).run(prim, userId);
  } else if (set.size) {
    const first = [...set][0];
    db.prepare(`UPDATE users SET department = ? WHERE id = ?`).run(first, userId);
  }
}

/**
 * 匯入完整包（合併／更新，不刪除既有未出現在包中的資料）
 * @param {object} pack
 * @param {{ importMail?: boolean, importHistory?: boolean }} options
 */
function importPackage(pack, options = {}) {
  if (!pack || typeof pack !== 'object') {
    throw new Error('無效的設定包');
  }
  if (pack.format !== FORMAT) {
    throw new Error(
      `無法辨識的格式（需要 ${FORMAT}）。若為流程 JSON，請至「簽核流程」匯入。`
    );
  }

  const importMail = options.importMail !== false;
  const importHistory =
    options.importHistory === true && pack.includeHistory && pack.history;

  const result = {
    departments: { created: 0, updated: 0 },
    users: { created: 0, updated: 0 },
    workflows: [],
    mail: null,
    history: null,
  };

  // 1) 部門
  for (const d of pack.departments || []) {
    const name = String(d.name || '').trim();
    if (!name) continue;
    const existing = db.prepare(`SELECT id, active FROM departments WHERE name = ?`).get(name);
    if (existing) {
      db.prepare(
        `UPDATE departments SET active = 1, sort_order = COALESCE(?, sort_order) WHERE id = ?`
      ).run(d.sort_order != null ? Number(d.sort_order) : null, existing.id);
      result.departments.updated++;
    } else {
      ensureDept(name, Number(d.sort_order) || 0);
      result.departments.created++;
    }
  }

  // 2) 使用者（先建帳號，才能對應流程簽核人）
  /** @type {Map<number, number>} exportId -> newId */
  const userIdMap = new Map();
  /** @type {Map<string, number>} username lower -> newId */
  const userByName = new Map();

  const { normalizeUsername } = require('./auth');
  for (const u of pack.users || []) {
    const username = normalizeUsername(u.username || '');
    if (!username) continue;
    const name = String(u.name || username).trim();
    const role = u.role === 'admin' ? 'admin' : 'user';
    const active = u.active === 0 ? 0 : 1;
    const email = u.email ? String(u.email).trim() : null;
    const phone = u.phone ? String(u.phone).trim() : null;
    const extension = u.extension ? String(u.extension).trim() : null;
    const department = u.department ? String(u.department).trim() : '';
    const permissions = Array.isArray(u.permissions)
      ? u.permissions
      : safeJsonParse(u.permissions_json, []);
    const emailNotify = u.email_notify === 0 ? 0 : 1;
    const hash = u.password_hash ? String(u.password_hash) : null;
    const hireDate = u.hire_date ? String(u.hire_date).slice(0, 10) : null;

    const depts = Array.isArray(u.departments) ? u.departments : department ? [department] : [];
    for (const d of depts) ensureDept(d);
    if (department) ensureDept(department);

    const existing = db
      .prepare(
        `SELECT id FROM users WHERE lower(username) = lower(?) LIMIT 1`
      )
      .get(username);

    let newId;
    if (existing) {
      newId = existing.id;
      if (hash) {
        db.prepare(
          `UPDATE users SET
            password_hash = ?, name = ?, email = ?, phone = ?, extension = ?,
            department = ?, role = ?, active = ?, permissions_json = ?, email_notify = ?,
            hire_date = COALESCE(?, hire_date)
           WHERE id = ?`
        ).run(
          hash,
          name,
          email,
          phone,
          extension,
          department,
          role,
          active,
          JSON.stringify(permissions),
          emailNotify,
          hireDate,
          newId
        );
      } else {
        db.prepare(
          `UPDATE users SET
            name = ?, email = ?, phone = ?, extension = ?,
            department = ?, role = ?, active = ?, permissions_json = ?, email_notify = ?,
            hire_date = COALESCE(?, hire_date)
           WHERE id = ?`
        ).run(
          name,
          email,
          phone,
          extension,
          department,
          role,
          active,
          JSON.stringify(permissions),
          emailNotify,
          hireDate,
          newId
        );
      }
      if (hireDate) {
        db.prepare(`UPDATE users SET hire_date = ? WHERE id = ?`).run(hireDate, newId);
      }
      result.users.updated++;
    } else {
      if (!hash) {
        // 無雜湊時給臨時密碼 pass1234
        const bcrypt = require('bcryptjs');
        const tempHash = bcrypt.hashSync('pass1234', 10);
        const info = db
          .prepare(
            `INSERT INTO users
              (username, password_hash, name, email, phone, extension, department, role, active, permissions_json, email_notify, hire_date)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            username,
            tempHash,
            name,
            email,
            phone,
            extension,
            department,
            role,
            active,
            JSON.stringify(permissions),
            emailNotify,
            hireDate
          );
        newId = Number(info.lastInsertRowid);
      } else {
        const info = db
          .prepare(
            `INSERT INTO users
              (username, password_hash, name, email, phone, extension, department, role, active, permissions_json, email_notify, hire_date)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            username,
            hash,
            name,
            email,
            phone,
            extension,
            department,
            role,
            active,
            JSON.stringify(permissions),
            emailNotify,
            hireDate
          );
        newId = Number(info.lastInsertRowid);
      }
      result.users.created++;
    }

    setUserDepartments(newId, depts, department);
    if (u.exportId != null) userIdMap.set(Number(u.exportId), newId);
    userByName.set(username.toLowerCase(), newId);
  }

  // 補齊現有使用者 map（流程簽核人可能只在目標庫）
  for (const row of db.prepare(`SELECT id, username FROM users`).all()) {
    userByName.set(String(row.username).toLowerCase(), row.id);
  }

  // 3) 流程（先以 username 解析 approvers，再 importPayload）
  const workflowItems = (pack.workflows || []).map((w) => {
    const steps = (w.steps || []).map((s) => {
      const approvers = Array.isArray(s.approvers) ? s.approvers : [];
      // 若 approvers 缺 username，用 exportId 對應
      const fixedApprovers = approvers.map((a) => {
        if (a && a.username) return a;
        if (a && a.id && userIdMap.has(Number(a.id))) {
          const nid = userIdMap.get(Number(a.id));
          const u = db.prepare(`SELECT username, name FROM users WHERE id = ?`).get(nid);
          return { id: nid, username: u?.username, name: u?.name };
        }
        return a;
      });
      // 也從 approverIds (export ids) 補
      if ((!fixedApprovers.length || !fixedApprovers.some((x) => x?.username)) && Array.isArray(s.approverIds)) {
        for (const eid of s.approverIds) {
          const nid = userIdMap.get(Number(eid));
          if (!nid) continue;
          const u = db.prepare(`SELECT username, name FROM users WHERE id = ?`).get(nid);
          if (u) fixedApprovers.push({ id: nid, username: u.username, name: u.name });
        }
      }
      return { ...s, approvers: fixedApprovers };
    });
    return {
      format: 'approval-system-workflow',
      version: 1,
      name: w.name,
      description: w.description || '',
      formFields: w.formFields || [],
      steps,
      active: w.active,
    };
  });

  if (workflowItems.length) {
    result.workflows = importPayload({
      format: 'approval-system-workflows',
      version: 1,
      workflows: workflowItems,
    });
    // 同步 active 狀態
    for (const w of pack.workflows || []) {
      if (w.active === 0) {
        db.prepare(
          `UPDATE workflows SET active = 0, updated_at = datetime('now','localtime')
           WHERE name = ? AND IFNULL(purged,0)=0`
        ).run(String(w.name || '').trim());
      }
    }
  }

  /** workflow exportId -> new id */
  const wfIdMap = new Map();
  for (const w of pack.workflows || []) {
    if (w.exportId == null) continue;
    const row = db
      .prepare(
        `SELECT id FROM workflows WHERE name = ? AND IFNULL(purged,0)=0 ORDER BY id DESC LIMIT 1`
      )
      .get(String(w.name || '').trim());
    if (row) wfIdMap.set(Number(w.exportId), row.id);
  }

  // 4) Email
  if (importMail && pack.mailConfig && typeof pack.mailConfig === 'object') {
    const mc = pack.mailConfig;
    const partial = {
      enabled: Boolean(mc.enabled),
      host: mc.host || '',
      port: Number(mc.port) || 587,
      secure: Boolean(mc.secure),
      user: mc.user || '',
      from: mc.from || '',
      fromName: mc.fromName || '線上簽核系統',
      baseUrl: mc.baseUrl || '',
    };
    if (mc.pass) partial.pass = mc.pass;
    mail.saveConfig(partial);
    result.mail = { ok: true, enabled: partial.enabled, host: partial.host };
  } else {
    result.mail = { ok: false, skipped: true };
  }

  // 5) 歷史單據
  if (importHistory && pack.history) {
    const hist = pack.history;
    let reqCreated = 0;
    let actCreated = 0;
    let attCreated = 0;
    const reqIdMap = new Map();
    /** 已存在而略過的 exportId：不再重複寫入歷程／附件 */
    const skippedReqExports = new Set();

    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

    for (const r of hist.requests || []) {
      const wfId = wfIdMap.get(Number(r.workflow_export_id));
      const requesterId = userIdMap.get(Number(r.requester_export_id));
      if (!wfId || !requesterId) continue;

      // 避免重複：同 title + requester + created_at 已存在則略過
      const dup = db
        .prepare(
          `SELECT id FROM approval_requests
           WHERE title = ? AND requester_id = ? AND created_at = ? LIMIT 1`
        )
        .get(r.title, requesterId, r.created_at);
      if (dup) {
        reqIdMap.set(Number(r.exportId), dup.id);
        skippedReqExports.add(Number(r.exportId));
        continue;
      }

      // 重寫 steps_snapshot 內的 approverIds
      let snapshot = r.steps_snapshot_json;
      if (snapshot) {
        try {
          const steps = JSON.parse(snapshot);
          if (Array.isArray(steps)) {
            for (const s of steps) {
              if (Array.isArray(s.approverIds)) {
                s.approverIds = s.approverIds
                  .map((id) => userIdMap.get(Number(id)) || null)
                  .filter(Boolean);
              }
            }
            snapshot = JSON.stringify(steps);
          }
        } catch {
          /* keep */
        }
      }

      const info = db
        .prepare(
          `INSERT INTO approval_requests
            (workflow_id, title, content, form_data, form_schema_json, steps_snapshot_json,
             approver_data_json, requester_id, status, current_step, notify_email,
             last_remind_at, created_at, updated_at, completed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          wfId,
          r.title,
          r.content || '',
          r.form_data || '{}',
          r.form_schema_json || '[]',
          snapshot,
          r.approver_data_json || '{}',
          requesterId,
          r.status || 'pending',
          r.current_step || 1,
          r.notify_email === 0 ? 0 : 1,
          r.last_remind_at || null,
          r.created_at || null,
          r.updated_at || null,
          r.completed_at || null
        );
      const newReqId = Number(info.lastInsertRowid);
      reqIdMap.set(Number(r.exportId), newReqId);
      reqCreated++;
    }

    for (const a of hist.actions || []) {
      const expReq = Number(a.request_export_id);
      if (skippedReqExports.has(expReq)) continue;
      const requestId = reqIdMap.get(expReq);
      const actorId = userIdMap.get(Number(a.actor_export_id));
      if (!requestId || !actorId) continue;
      db.prepare(
        `INSERT INTO approval_actions
          (request_id, step_order, step_name, actor_id, action, comment, form_data, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        requestId,
        a.step_order,
        a.step_name || '',
        actorId,
        a.action,
        a.comment || '',
        a.form_data || '{}',
        a.created_at || null
      );
      actCreated++;
    }

    for (const att of hist.attachments || []) {
      const expReq = Number(att.request_export_id);
      if (skippedReqExports.has(expReq)) continue;
      const requestId = reqIdMap.get(expReq);
      if (!requestId) continue;
      let stored = att.stored_name || `imp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      // 避免檔名衝突
      let dest = path.join(UPLOAD_DIR, stored);
      if (fs.existsSync(dest) && att.contentBase64) {
        stored = `imp_${Date.now()}_${path.basename(stored)}`;
        dest = path.join(UPLOAD_DIR, stored);
      }
      if (att.contentBase64) {
        try {
          fs.writeFileSync(dest, Buffer.from(att.contentBase64, 'base64'));
        } catch (e) {
          console.warn('write attachment', e.message);
        }
      }
      const uploader = att.uploaded_by_export_id
        ? userIdMap.get(Number(att.uploaded_by_export_id)) || null
        : null;
      db.prepare(
        `INSERT INTO request_attachments
          (request_id, original_name, stored_name, mime_type, size_bytes, uploaded_by, step_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        requestId,
        att.original_name || 'file',
        stored,
        att.mime_type || '',
        att.size_bytes || 0,
        uploader,
        att.step_order != null ? att.step_order : null,
        att.created_at || null
      );
      attCreated++;
    }

    result.history = {
      requests: reqCreated,
      actions: actCreated,
      attachments: attCreated,
      skippedExisting: (hist.requests || []).length - reqCreated,
    };
  }

  return result;
}

function isConfigPackage(data) {
  return data && data.format === FORMAT;
}

module.exports = {
  FORMAT,
  VERSION,
  buildPackage,
  importPackage,
  isConfigPackage,
};
