/**
 * 簽核執行期共用函式（由 index.js 載入後傳入路由 ctx）
 */
const tz = require('./tz');
const path = require('path');
const db = require('./db');
const {
  normalizeUsername,
  isBuiltinAdminUsername,
  isBuiltinAdminUser,
  hashPassword,
  generateBootstrapPassword,
  parseCookies,
} = require('./auth');
const { contentDispositionAttachment } = require('./pdf');
const mail = require('./mail');
const lineNotify = require('./line-notify');
const flowGraph = require('./flow-graph');
const flowEngineFactory = require('./flow-engine');
const labor = require('./labor');
const systemSettings = require('./system-settings');
const fs = require('fs');
const os = require('os');
const multer = require('multer');
const crypto = require('crypto');

const TRUST_PROXY = /^(1|true|yes)$/i.test(String(process.env.TRUST_PROXY || ''));

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

/** 設定包 JSON 上傳（落到 data/tmp，上限 1GB） */
const uploadPackage = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
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
          return cb(null, dir);
        } catch {
          /* try next */
        }
      }
      cb(null, os.tmpdir());
    },
    filename: (_req, _file, cb) =>
      cb(null, `pkg_${Date.now()}_${crypto.randomBytes(8).toString('hex')}.json`),
  }),
  limits: { fileSize: 1024 * 1024 * 1024 },
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


const devices = require('./runtime/devices');
const perms = require('./runtime/perms');
const notify = require('./runtime/notify');
const flow = require('./runtime/flow');
const { getUserDepartments, parsePermissions } = perms;
const {
  parseFormFields,
  loadStepsForRequest,
  parseSteps,
  formatUserLabels,
  parseCosignIds,
  flowEngine,
} = flow;
const { enrichFinalNotifyUsers, loadFinalNotifyReceiptsForRequest } = notify;
const workflowModule = require('./workflow-module');

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

function getRequestDetail(id, opts = {}) {
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
  if (row.deleted_at && !opts.includeDeleted) return null;

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

module.exports = {
  ALLOWED_MIME,
  UPLOAD_DIR,
  decodeUploadFilename,
  safeUploadExt,
  upload,
  uploadPackage,
  saveAttachments,
  getAttachments,
  getRequestDetail,
  ...devices,
  ...perms,
  ...notify,
  ...flow,
};
