/**
 * 匯入簽核流程 JSON（單一或全部包）
 * 含：表單欄位 + 簽核步驟 + PDF 排版（workflow-module）
 * 不含：系統設定、Email、使用者、歷史單據
 * 用法：node server/import-workflows.js <json路徑>
 */
const db = require('./db');
const fs = require('fs');
const path = require('path');
const {
  normalizePdfLayout,
  pdfLayoutToJson,
  normalizeFinalNotify,
  finalNotifyToJson,
} = require('./workflow-module');

function parseJsonFile(p) {
  const raw = fs.readFileSync(p, 'utf8');
  return JSON.parse(raw);
}

function resolveApproverIds(step) {
  const ids = new Set();
  if (Array.isArray(step.approverIds)) {
    for (const id of step.approverIds) {
      const n = Number(id);
      if (n && db.prepare(`SELECT id FROM users WHERE id = ? AND active = 1`).get(n)) {
        ids.add(n);
      }
    }
  }
  if (Array.isArray(step.approvers)) {
    for (const a of step.approvers) {
      if (a?.username) {
        const u = db
          .prepare(`SELECT id FROM users WHERE username = ? COLLATE NOCASE AND active = 1`)
          .get(String(a.username).trim());
        if (u) ids.add(u.id);
      } else if (a?.id) {
        const u = db.prepare(`SELECT id FROM users WHERE id = ? AND active = 1`).get(Number(a.id));
        if (u) ids.add(u.id);
      }
    }
  }
  return [...ids];
}

function cleanSteps(steps) {
  if (!Array.isArray(steps)) return [];
  return steps.map((s, i) => {
    const order = s.order != null ? Number(s.order) : i + 1;
    const assignType = s.assignType || 'users';
    const cleaned = {
      order,
      name: String(s.name || `步驟${order}`).trim(),
      assignType,
      mode: s.mode === 'all' ? 'all' : 'any',
      formFieldId: s.formFieldId || '',
      department: s.department || '',
      approverIds:
        assignType === 'users' || assignType === 'users_pick'
          ? resolveApproverIds(s)
          : [],
      approverFields: Array.isArray(s.approverFields) ? s.approverFields : [],
      skipIfNoApprover: Boolean(s.skipIfNoApprover),
    };
    return cleaned;
  });
}

function cleanFields(fields) {
  if (!Array.isArray(fields)) return [];
  return fields.map((f) => ({
    id: String(f.id || '').trim() || `f_${Math.random().toString(36).slice(2, 8)}`,
    label: String(f.label || f.id || '欄位').trim(),
    type: f.type || 'text',
    required: Boolean(f.required),
    placeholder: f.placeholder || '',
    options: Array.isArray(f.options) ? f.options : [],
  }));
}

function getAdminId() {
  const a = db.prepare(`SELECT id FROM users WHERE role = 'admin' AND active = 1 ORDER BY id LIMIT 1`).get();
  return a?.id || 1;
}

function upsertWorkflow(item, adminId) {
  const name = String(item.name || '').trim();
  if (!name) throw new Error('流程名稱不可空白');
  const description = String(item.description || '').trim();
  const formFields = cleanFields(item.formFields || item.form_fields || []);
  const steps = cleanSteps(item.steps || []);
  if (!steps.length) throw new Error(`「${name}」沒有簽核步驟`);

  const pdfLayout = normalizePdfLayout(
    item.pdfLayout || item.pdf_layout || { type: 'auto' },
    name
  );
  const pdfLayoutJson = pdfLayoutToJson(pdfLayout, name);

  // 最終核准通知：以 userIds + username 對應本機帳號
  const rawNotify = normalizeFinalNotify(
    item.finalNotify || item.final_notify || { enabled: false, userIds: [] }
  );
  const notifyIds = new Set();
  const notifyUsers = [];
  for (const id of rawNotify.userIds || []) {
    const u = db
      .prepare(`SELECT id, username, name FROM users WHERE id = ? AND active = 1`)
      .get(Number(id));
    if (u && !notifyIds.has(u.id)) {
      notifyIds.add(u.id);
      notifyUsers.push({ id: u.id, username: u.username, name: u.name });
    }
  }
  for (const a of rawNotify.users || []) {
    if (!a) continue;
    let u = null;
    if (a.username) {
      u = db
        .prepare(`SELECT id, username, name FROM users WHERE username = ? AND active = 1`)
        .get(String(a.username).trim());
    } else if (a.id) {
      u = db
        .prepare(`SELECT id, username, name FROM users WHERE id = ? AND active = 1`)
        .get(Number(a.id));
    }
    if (u && !notifyIds.has(u.id)) {
      notifyIds.add(u.id);
      notifyUsers.push({ id: u.id, username: u.username, name: u.name });
    }
  }
  // 申請人範圍（哪些申請人的單據才需要最終通知模組）
  const applicantIds = new Set();
  const applicantUsers = [];
  for (const id of rawNotify.applicantUserIds || []) {
    const u = db
      .prepare(`SELECT id, username, name FROM users WHERE id = ? AND active = 1`)
      .get(Number(id));
    if (u && !applicantIds.has(u.id)) {
      applicantIds.add(u.id);
      applicantUsers.push({ id: u.id, username: u.username, name: u.name });
    }
  }
  for (const a of rawNotify.applicants || []) {
    if (!a) continue;
    let u = null;
    if (a.username) {
      u = db
        .prepare(`SELECT id, username, name FROM users WHERE username = ? AND active = 1`)
        .get(String(a.username).trim());
    } else if (a.id) {
      u = db
        .prepare(`SELECT id, username, name FROM users WHERE id = ? AND active = 1`)
        .get(Number(a.id));
    }
    if (u && !applicantIds.has(u.id)) {
      applicantIds.add(u.id);
      applicantUsers.push({ id: u.id, username: u.username, name: u.name });
    }
  }
  let applicantMode = rawNotify.applicantMode === 'selected' ? 'selected' : 'all';
  if (applicantMode === 'selected' && !applicantIds.size) applicantMode = 'all';

  const finalNotifyJson = finalNotifyToJson({
    enabled: rawNotify.enabled,
    userIds: [...notifyIds],
    users: notifyUsers,
    applicantMode,
    applicantUserIds: [...applicantIds],
    applicants: applicantUsers,
    label: rawNotify.label,
  });

  const existing = db
    .prepare(`SELECT id, category FROM workflows WHERE name = ? AND COALESCE(purged, 0) = 0 ORDER BY id DESC LIMIT 1`)
    .get(name);

  const category = String(item.category || '').trim();
  const stepsJson = JSON.stringify(steps);
  const fieldsJson = JSON.stringify(formFields);

  if (existing) {
    db.prepare(
      `UPDATE workflows SET
        description = ?,
        category = CASE WHEN ? != '' THEN ? ELSE category END,
        steps_json = ?,
        form_fields_json = ?,
        pdf_layout_json = ?,
        final_notify_json = ?,
        active = 1,
        updated_at = datetime('now', 'localtime')
       WHERE id = ?`
    ).run(
      description,
      category,
      category,
      stepsJson,
      fieldsJson,
      pdfLayoutJson,
      finalNotifyJson,
      existing.id
    );
    return {
      action: 'updated',
      id: existing.id,
      name,
      steps: steps.length,
      fields: formFields.length,
      pdfLayout: pdfLayout.type,
      finalNotify: rawNotify.enabled ? notifyIds.size : 0,
    };
  }

  const info = db
    .prepare(
      `INSERT INTO workflows (name, description, category, created_by, steps_json, form_fields_json, pdf_layout_json, final_notify_json, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`
    )
    .run(
      name,
      description,
      category || '一般簽呈',
      adminId,
      stepsJson,
      fieldsJson,
      pdfLayoutJson,
      finalNotifyJson
    );
  return {
    action: 'created',
    id: Number(info.lastInsertRowid),
    name,
    steps: steps.length,
    fields: formFields.length,
    pdfLayout: pdfLayout.type,
    finalNotify: rawNotify.enabled ? notifyIds.size : 0,
  };
}

function importPayload(data) {
  const adminId = getAdminId();
  let list = [];
  if (data.format === 'approval-system-workflows' && Array.isArray(data.workflows)) {
    list = data.workflows;
  } else if (data.format === 'approval-system-workflow' || data.name) {
    list = [data];
  } else if (Array.isArray(data.workflows)) {
    list = data.workflows;
  } else if (Array.isArray(data)) {
    list = data;
  } else {
    throw new Error('無法辨識的 JSON 格式（請使用匯出的流程檔）');
  }

  const results = [];
  for (const item of list) {
    results.push(upsertWorkflow(item, adminId));
  }
  return results;
}

// CLI
if (require.main === module) {
  const file = process.argv[2];
  if (!file) {
    console.error('用法: node server/import-workflows.js <json路徑>');
    process.exit(1);
  }
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) {
    console.error('找不到檔案:', abs);
    process.exit(1);
  }
  const data = parseJsonFile(abs);
  const results = importPayload(data);
  console.log('IMPORT OK', results.length);
  for (const r of results) {
    console.log(
      `  [${r.action}] #${r.id} ${r.name}  steps=${r.steps} fields=${r.fields} pdfLayout=${r.pdfLayout || 'auto'} finalNotify=${r.finalNotify ?? 'off'}`
    );
  }
}

module.exports = { importPayload, upsertWorkflow, cleanSteps, cleanFields };
