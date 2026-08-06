const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'approval.db');
const db = new DatabaseSync(dbPath);

// node:sqlite supports exec for PRAGMA / DDL
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    extension TEXT,
    department TEXT DEFAULT '',
    role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin', 'user')),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS workflows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    created_by INTEGER NOT NULL,
    steps_json TEXT NOT NULL,
    form_fields_json TEXT NOT NULL DEFAULT '[]',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (created_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS approval_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workflow_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    form_data TEXT DEFAULT '{}',
    form_schema_json TEXT DEFAULT '[]',
    requester_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK(status IN ('draft', 'pending', 'approved', 'rejected', 'cancelled')),
    current_step INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    completed_at TEXT,
    FOREIGN KEY (workflow_id) REFERENCES workflows(id),
    FOREIGN KEY (requester_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS approval_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER NOT NULL,
    step_order INTEGER NOT NULL,
    step_name TEXT NOT NULL DEFAULT '',
    actor_id INTEGER NOT NULL,
    action TEXT NOT NULL CHECK(action IN ('submit', 'approve', 'reject', 'cancel', 'return', 'comment')),
    comment TEXT DEFAULT '',
    form_data TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (request_id) REFERENCES approval_requests(id) ON DELETE CASCADE,
    FOREIGN KEY (actor_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS departments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE INDEX IF NOT EXISTS idx_requests_status ON approval_requests(status);
  CREATE INDEX IF NOT EXISTS idx_requests_requester ON approval_requests(requester_id);
  CREATE INDEX IF NOT EXISTS idx_actions_request ON approval_actions(request_id);

  CREATE TABLE IF NOT EXISTS backup_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER NOT NULL,
    department TEXT NOT NULL DEFAULT '',
    workflow_name TEXT NOT NULL DEFAULT '',
    period_year TEXT NOT NULL DEFAULT '',
    period_month TEXT NOT NULL DEFAULT '',
    file_rel_path TEXT NOT NULL,
    file_name TEXT NOT NULL,
    title TEXT DEFAULT '',
    requester_name TEXT DEFAULT '',
    status TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    created_by INTEGER,
    UNIQUE(request_id)
  );
  CREATE INDEX IF NOT EXISTS idx_backup_dept ON backup_files(department);
  CREATE INDEX IF NOT EXISTS idx_backup_wf ON backup_files(workflow_name);
  CREATE INDEX IF NOT EXISTS idx_backup_period ON backup_files(period_year, period_month);

  -- 成員可同時隸屬多個部門
  CREATE TABLE IF NOT EXISTS user_departments (
    user_id INTEGER NOT NULL,
    department TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    PRIMARY KEY (user_id, department),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_user_depts_dept ON user_departments(department);
  CREATE INDEX IF NOT EXISTS idx_user_depts_user ON user_departments(user_id);

  CREATE TABLE IF NOT EXISTS request_attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER NOT NULL,
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    mime_type TEXT DEFAULT '',
    size_bytes INTEGER NOT NULL DEFAULT 0,
    uploaded_by INTEGER,
    step_order INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (request_id) REFERENCES approval_requests(id) ON DELETE CASCADE,
    FOREIGN KEY (uploaded_by) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_attachments_request ON request_attachments(request_id);
`);

// Migrations for existing databases
(function migrateSchema() {
  const wfCols = db.prepare(`PRAGMA table_info(workflows)`).all().map((c) => c.name);
  if (!wfCols.includes('form_fields_json')) {
    db.exec(`ALTER TABLE workflows ADD COLUMN form_fields_json TEXT NOT NULL DEFAULT '[]'`);
  }
  const attCols = db.prepare(`PRAGMA table_info(request_attachments)`).all().map((c) => c.name);
  if (!attCols.includes('step_order')) {
    db.exec(`ALTER TABLE request_attachments ADD COLUMN step_order INTEGER`);
  }
  const reqCols = db.prepare(`PRAGMA table_info(approval_requests)`).all().map((c) => c.name);
  if (!reqCols.includes('form_schema_json')) {
    db.exec(`ALTER TABLE approval_requests ADD COLUMN form_schema_json TEXT DEFAULT '[]'`);
  }
  // Snapshot of resolved approval steps at submit time (dynamic roles)
  if (!reqCols.includes('steps_snapshot_json')) {
    db.exec(`ALTER TABLE approval_requests ADD COLUMN steps_snapshot_json TEXT`);
  }
  const userCols = db.prepare(`PRAGMA table_info(users)`).all().map((c) => c.name);
  if (!userCols.includes('permissions_json')) {
    db.exec(`ALTER TABLE users ADD COLUMN permissions_json TEXT NOT NULL DEFAULT '[]'`);
  }
  if (!userCols.includes('phone')) {
    db.exec(`ALTER TABLE users ADD COLUMN phone TEXT`);
  }
  if (!userCols.includes('extension')) {
    db.exec(`ALTER TABLE users ADD COLUMN extension TEXT`);
  }
  // 預設接收簽核 Email 通知（1=是）
  if (!userCols.includes('email_notify')) {
    db.exec(`ALTER TABLE users ADD COLUMN email_notify INTEGER NOT NULL DEFAULT 1`);
  }
  // 到職日（YYYY-MM-DD，僅顯示年資；可休日數改為手動 leave_entitled_json）
  if (!userCols.includes('hire_date')) {
    db.exec(`ALTER TABLE users ADD COLUMN hire_date TEXT`);
  }
  // 特休已休（人資手動填寫基準：天數／小時；系統再加已核准請假；與 leave_used_json.special 同步）
  if (!userCols.includes('sl_used_days')) {
    db.exec(`ALTER TABLE users ADD COLUMN sl_used_days REAL NOT NULL DEFAULT 0`);
  }
  if (!userCols.includes('sl_used_hours')) {
    db.exec(`ALTER TABLE users ADD COLUMN sl_used_hours REAL NOT NULL DEFAULT 0`);
  }
  // 各有上限假別之手動已休（JSON：{ special:{days,hours}, personal:{…}, … }）
  if (!userCols.includes('leave_used_json')) {
    db.exec(`ALTER TABLE users ADD COLUMN leave_used_json TEXT NOT NULL DEFAULT '{}'`);
  }
  // 各假別「可休／應休」天數（手動設定，不再依年資自動計算）
  // JSON：{ special:{days}, personal:{days}, … }
  if (!userCols.includes('leave_entitled_json')) {
    db.exec(
      `ALTER TABLE users ADD COLUMN leave_entitled_json TEXT NOT NULL DEFAULT '{}'`
    );
  }
  const reqColsMail = db.prepare(`PRAGMA table_info(approval_requests)`).all().map((c) => c.name);
  // 此單據是否以 Email 通知申請人
  if (!reqColsMail.includes('notify_email')) {
    db.exec(`ALTER TABLE approval_requests ADD COLUMN notify_email INTEGER NOT NULL DEFAULT 1`);
  }
  // 申請人 Email 細項：核准／駁回／下一步等
  if (!reqColsMail.includes('notify_prefs_json')) {
    db.exec(
      `ALTER TABLE approval_requests ADD COLUMN notify_prefs_json TEXT DEFAULT NULL`
    );
  }
  // 申請人上次催辦時間（節流）
  if (!reqColsMail.includes('last_remind_at')) {
    db.exec(`ALTER TABLE approval_requests ADD COLUMN last_remind_at TEXT`);
  }
  const workflowCols = db.prepare(`PRAGMA table_info(workflows)`).all().map((c) => c.name);
  if (!workflowCols.includes('purged')) {
    db.exec(`ALTER TABLE workflows ADD COLUMN purged INTEGER NOT NULL DEFAULT 0`);
  }
  // 流程模組：PDF 排版類型（與 form_fields / steps 一併匯出匯入）
  if (!workflowCols.includes('pdf_layout_json')) {
    db.exec(
      `ALTER TABLE workflows ADD COLUMN pdf_layout_json TEXT NOT NULL DEFAULT '{"type":"auto"}'`
    );
  }
  // 流程模組：最終核准完成通知（選定人員；可開關）
  if (!workflowCols.includes('final_notify_json')) {
    db.exec(
      `ALTER TABLE workflows ADD COLUMN final_notify_json TEXT NOT NULL DEFAULT '{"enabled":false,"userIds":[]}'`
    );
  }
  // 系統內最終核准通知收執（非 Email）：待確認／已確認
  db.exec(`
    CREATE TABLE IF NOT EXISTS final_notify_receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      label TEXT DEFAULT '最終核准完成通知',
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      acked_at TEXT,
      UNIQUE(request_id, user_id)
    )
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_final_notify_user_pending
     ON final_notify_receipts(user_id, acked_at)`
  );
  // 既有流程若尚未指定版面，依名稱寫入推斷結果（僅補 auto／空值）
  try {
    const { detectPdfLayoutType, pdfLayoutToJson } = require('./workflow-module');
    const rows = db
      .prepare(
        `SELECT id, name, pdf_layout_json FROM workflows WHERE COALESCE(purged, 0) = 0`
      )
      .all();
    const upd = db.prepare(`UPDATE workflows SET pdf_layout_json = ? WHERE id = ?`);
    for (const r of rows) {
      let cur = {};
      try {
        cur = JSON.parse(r.pdf_layout_json || '{}');
      } catch {
        cur = {};
      }
      const t = String(cur.type || 'auto');
      if (!t || t === 'auto') {
        const detected = detectPdfLayoutType(r.name);
        upd.run(
          pdfLayoutToJson({ type: detected === 'general' ? 'auto' : detected }, r.name),
          r.id
        );
      }
    }
  } catch (e) {
    console.warn('[db] pdf_layout_json migrate', e.message);
  }
  // 電子手寫簽名檔（Base64 PNG/JPEG）
  if (!userCols.includes('signature_image')) {
    db.exec(`ALTER TABLE users ADD COLUMN signature_image TEXT`);
  }
  const actionCols = db.prepare(`PRAGMA table_info(approval_actions)`).all().map((c) => c.name);
  if (!actionCols.includes('form_data')) {
    db.exec(`ALTER TABLE approval_actions ADD COLUMN form_data TEXT DEFAULT '{}'`);
  }
  if (!actionCols.includes('signature_image')) {
    db.exec(`ALTER TABLE approval_actions ADD COLUMN signature_image TEXT`);
  }
  if (!actionCols.includes('delegated_for_id')) {
    db.exec(`ALTER TABLE approval_actions ADD COLUMN delegated_for_id INTEGER`);
  }

  // 簽核代理人設定表
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_delegations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      delegate_user_id INTEGER NOT NULL,
      start_time TEXT,
      end_time TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (delegate_user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_user_delegations_user ON user_delegations(user_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_user_delegations_delegate ON user_delegations(delegate_user_id);`);

  // 系統進階稽核日誌表 (P3-1)
  db.exec(`
    CREATE TABLE IF NOT EXISTS system_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      user_name TEXT DEFAULT '',
      user_username TEXT DEFAULT '',
      action_type TEXT NOT NULL,
      category TEXT DEFAULT 'general',
      description TEXT NOT NULL,
      ip_address TEXT DEFAULT '',
      target_id INTEGER,
      detail_json TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_created ON system_audit_logs(created_at);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_user ON system_audit_logs(user_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_action ON system_audit_logs(action_type);`);

  const reqCols2 = db.prepare(`PRAGMA table_info(approval_requests)`).all().map((c) => c.name);
  if (!reqCols2.includes('approver_data_json')) {
    db.exec(`ALTER TABLE approval_requests ADD COLUMN approver_data_json TEXT DEFAULT '{}'`);
  }

  // 將 users.department 既有資料匯入多對多表（可重複隸屬）
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_departments (
      user_id INTEGER NOT NULL,
      department TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      PRIMARY KEY (user_id, department),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  try {
    db.exec(`
      INSERT OR IGNORE INTO user_departments (user_id, department)
      SELECT id, department FROM users
      WHERE active = 1 AND department IS NOT NULL AND TRIM(department) != ''
    `);
  } catch {
    /* ignore */
  }
})();

// Seed default departments (idempotent)
const DEFAULT_DEPARTMENTS = [
  '管理部',
  '工程部',
  '採購部',
  '業務部',
  '財務部',
  '倉管部',
];
const insertDept = db.prepare(
  `INSERT OR IGNORE INTO departments (name, sort_order) VALUES (?, ?)`
);
DEFAULT_DEPARTMENTS.forEach((name, i) => {
  insertDept.run(name, i + 1);
});
// Rename legacy typo 昌管部 → 倉管部 (if present)
try {
  const legacy = db.prepare(`SELECT id FROM departments WHERE name = '昌管部'`).get();
  const correct = db.prepare(`SELECT id FROM departments WHERE name = '倉管部'`).get();
  if (legacy && !correct) {
    db.prepare(`UPDATE departments SET name = '倉管部' WHERE name = '昌管部'`).run();
  } else if (legacy && correct) {
    db.prepare(`UPDATE users SET department = '倉管部' WHERE department = '昌管部'`).run();
    db.prepare(`DELETE FROM departments WHERE name = '昌管部'`).run();
  }
  db.prepare(`UPDATE users SET department = '倉管部' WHERE department = '昌管部'`).run();
} catch {
  /* ignore migration errors on first create */
}

/** Normalize statement.run result so .lastInsertRowid works like better-sqlite3 */
function wrapDb(database) {
  const originalPrepare = database.prepare.bind(database);
  database.prepare = (sql) => {
    const stmt = originalPrepare(sql);
    const originalRun = stmt.run.bind(stmt);
    stmt.run = (...args) => {
      const result = originalRun(...args);
      // Node sqlite returns { changes, lastInsertRowid }
      if (result && typeof result === 'object') {
        return {
          changes: result.changes ?? 0,
          lastInsertRowid: Number(result.lastInsertRowid ?? 0),
        };
      }
      // Fallback
      const row = database.prepare('SELECT last_insert_rowid() AS id, changes() AS c').get();
      return { changes: row?.c ?? 0, lastInsertRowid: Number(row?.id ?? 0) };
    };
    return stmt;
  };
  return database;
}

module.exports = wrapDb(db);
