'use strict';

const { translateColumnSpec } = require('./dialect');

const SQLITE_DDL = `
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
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    permissions_json TEXT NOT NULL DEFAULT '[]',
    email_notify INTEGER NOT NULL DEFAULT 1,
    hire_date TEXT,
    sl_used_days REAL NOT NULL DEFAULT 0,
    sl_used_hours REAL NOT NULL DEFAULT 0,
    leave_used_json TEXT NOT NULL DEFAULT '{}',
    leave_entitled_json TEXT NOT NULL DEFAULT '{}',
    signature_image TEXT
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
    purged INTEGER NOT NULL DEFAULT 0,
    pdf_layout_json TEXT NOT NULL DEFAULT '{"type":"auto"}',
    final_notify_json TEXT NOT NULL DEFAULT '{"enabled":false,"userIds":[]}',
    flow_json TEXT,
    flow_version INTEGER NOT NULL DEFAULT 1,
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
      CHECK(status IN ('draft', 'pending', 'approved', 'rejected', 'cancelled', 'voided')),
    current_step INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    completed_at TEXT,
    steps_snapshot_json TEXT,
    notify_email INTEGER NOT NULL DEFAULT 1,
    notify_prefs_json TEXT DEFAULT NULL,
    last_remind_at TEXT,
    approver_data_json TEXT DEFAULT '{}',
    flow_snapshot_json TEXT,
    deleted_at TEXT,
    FOREIGN KEY (workflow_id) REFERENCES workflows(id),
    FOREIGN KEY (requester_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS approval_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER NOT NULL,
    step_order INTEGER,
    step_name TEXT NOT NULL DEFAULT '',
    actor_id INTEGER,
    action TEXT NOT NULL CHECK(action IN
      ('submit', 'approve', 'reject', 'cancel', 'return', 'comment',
       'system', 'cosign', 'forward', 'void')),
    comment TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    form_data TEXT DEFAULT '{}',
    signature_image TEXT,
    delegated_for_id INTEGER,
    node_id TEXT,
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

  CREATE TABLE IF NOT EXISTS user_departments (
    user_id INTEGER NOT NULL,
    department TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    PRIMARY KEY (user_id, department),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

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

  CREATE TABLE IF NOT EXISTS final_notify_receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    label TEXT DEFAULT '最終核准完成通知',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    acked_at TEXT,
    UNIQUE(request_id, user_id)
  );

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

  CREATE TABLE IF NOT EXISTS request_node_states (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER NOT NULL,
    node_id TEXT NOT NULL,
    state TEXT NOT NULL
      CHECK(state IN ('pending', 'approved', 'rejected', 'skipped')),
    entered_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    completed_at TEXT,
    ad_hoc INTEGER NOT NULL DEFAULT 0,
    UNIQUE(request_id, node_id),
    FOREIGN KEY (request_id) REFERENCES approval_requests(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS user_devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    device_token TEXT NOT NULL UNIQUE,
    label TEXT DEFAULT '',
    ip_address TEXT DEFAULT '',
    user_agent TEXT DEFAULT '',
    last_seen_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`;

const MYSQL_TABLE_OPTS = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';

const MYSQL_DDL = `
  CREATE TABLE IF NOT EXISTS users (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(64) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(128) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(64),
    extension VARCHAR(32),
    department VARCHAR(100) DEFAULT '',
    role VARCHAR(16) NOT NULL DEFAULT 'user',
    active TINYINT NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    permissions_json TEXT NOT NULL DEFAULT ('[]'),
    email_notify TINYINT NOT NULL DEFAULT 1,
    hire_date VARCHAR(32),
    sl_used_days DOUBLE NOT NULL DEFAULT 0,
    sl_used_hours DOUBLE NOT NULL DEFAULT 0,
    leave_used_json TEXT NOT NULL DEFAULT ('{}'),
    leave_entitled_json TEXT NOT NULL DEFAULT ('{}'),
    signature_image MEDIUMTEXT,
    CONSTRAINT chk_users_role CHECK (role IN ('admin', 'user'))
  ) ${MYSQL_TABLE_OPTS};

  CREATE TABLE IF NOT EXISTS workflows (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(191) NOT NULL,
    description TEXT,
    created_by INT NOT NULL,
    steps_json MEDIUMTEXT NOT NULL,
    form_fields_json MEDIUMTEXT NOT NULL DEFAULT ('[]'),
    active TINYINT NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    purged TINYINT NOT NULL DEFAULT 0,
    pdf_layout_json TEXT NOT NULL DEFAULT ('{"type":"auto"}'),
    final_notify_json TEXT NOT NULL DEFAULT ('{"enabled":false,"userIds":[]}'),
    flow_json MEDIUMTEXT,
    flow_version INT NOT NULL DEFAULT 1,
    CONSTRAINT fk_wf_created_by FOREIGN KEY (created_by) REFERENCES users(id)
  ) ${MYSQL_TABLE_OPTS};

  CREATE TABLE IF NOT EXISTS approval_requests (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    workflow_id INT NOT NULL,
    title VARCHAR(500) NOT NULL,
    content MEDIUMTEXT NOT NULL DEFAULT (''),
    form_data MEDIUMTEXT,
    form_schema_json MEDIUMTEXT,
    requester_id INT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'pending',
    current_step INT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    steps_snapshot_json MEDIUMTEXT,
    notify_email TINYINT NOT NULL DEFAULT 1,
    notify_prefs_json TEXT,
    last_remind_at DATETIME,
    approver_data_json MEDIUMTEXT,
    flow_snapshot_json MEDIUMTEXT,
    deleted_at DATETIME,
    CONSTRAINT chk_req_status CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'cancelled', 'voided')),
    CONSTRAINT fk_req_wf FOREIGN KEY (workflow_id) REFERENCES workflows(id),
    CONSTRAINT fk_req_user FOREIGN KEY (requester_id) REFERENCES users(id)
  ) ${MYSQL_TABLE_OPTS};

  CREATE TABLE IF NOT EXISTS approval_actions (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    request_id INT NOT NULL,
    step_order INT,
    step_name VARCHAR(191) NOT NULL DEFAULT '',
    actor_id INT,
    action VARCHAR(32) NOT NULL,
    \`comment\` TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    form_data MEDIUMTEXT,
    signature_image MEDIUMTEXT,
    delegated_for_id INT,
    node_id VARCHAR(64),
    CONSTRAINT chk_act_action CHECK (action IN
      ('submit', 'approve', 'reject', 'cancel', 'return', 'comment',
       'system', 'cosign', 'forward', 'void')),
    CONSTRAINT fk_act_req FOREIGN KEY (request_id) REFERENCES approval_requests(id) ON DELETE CASCADE,
    CONSTRAINT fk_act_actor FOREIGN KEY (actor_id) REFERENCES users(id)
  ) ${MYSQL_TABLE_OPTS};

  CREATE TABLE IF NOT EXISTS departments (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    sort_order INT NOT NULL DEFAULT 0,
    active TINYINT NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ${MYSQL_TABLE_OPTS};

  CREATE TABLE IF NOT EXISTS backup_files (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    request_id INT NOT NULL,
    department VARCHAR(100) NOT NULL DEFAULT '',
    workflow_name VARCHAR(191) NOT NULL DEFAULT '',
    period_year VARCHAR(8) NOT NULL DEFAULT '',
    period_month VARCHAR(8) NOT NULL DEFAULT '',
    file_rel_path VARCHAR(500) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    title VARCHAR(500) DEFAULT '',
    requester_name VARCHAR(128) DEFAULT '',
    status VARCHAR(32) DEFAULT '',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by INT,
    UNIQUE KEY uk_backup_request (request_id)
  ) ${MYSQL_TABLE_OPTS};

  CREATE TABLE IF NOT EXISTS user_departments (
    user_id INT NOT NULL,
    department VARCHAR(100) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, department),
    CONSTRAINT fk_ud_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ${MYSQL_TABLE_OPTS};

  CREATE TABLE IF NOT EXISTS request_attachments (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    request_id INT NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    stored_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(128) DEFAULT '',
    size_bytes INT NOT NULL DEFAULT 0,
    uploaded_by INT,
    step_order INT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_att_req FOREIGN KEY (request_id) REFERENCES approval_requests(id) ON DELETE CASCADE,
    CONSTRAINT fk_att_user FOREIGN KEY (uploaded_by) REFERENCES users(id)
  ) ${MYSQL_TABLE_OPTS};

  CREATE TABLE IF NOT EXISTS final_notify_receipts (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    request_id INT NOT NULL,
    user_id INT NOT NULL,
    label VARCHAR(191) DEFAULT '最終核准完成通知',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    acked_at DATETIME,
    UNIQUE KEY uk_fnr (request_id, user_id)
  ) ${MYSQL_TABLE_OPTS};

  CREATE TABLE IF NOT EXISTS user_delegations (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    delegate_user_id INT NOT NULL,
    start_time VARCHAR(32),
    end_time VARCHAR(32),
    active TINYINT NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_del_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_del_delegate FOREIGN KEY (delegate_user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ${MYSQL_TABLE_OPTS};

  CREATE TABLE IF NOT EXISTS system_audit_logs (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id INT,
    user_name VARCHAR(128) DEFAULT '',
    user_username VARCHAR(64) DEFAULT '',
    action_type VARCHAR(64) NOT NULL,
    category VARCHAR(64) DEFAULT 'general',
    description TEXT NOT NULL,
    ip_address VARCHAR(64) DEFAULT '',
    target_id INT,
    detail_json MEDIUMTEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ${MYSQL_TABLE_OPTS};

  CREATE TABLE IF NOT EXISTS request_node_states (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    request_id INT NOT NULL,
    node_id VARCHAR(64) NOT NULL,
    state VARCHAR(32) NOT NULL,
    entered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    ad_hoc TINYINT NOT NULL DEFAULT 0,
    UNIQUE KEY uk_node_state (request_id, node_id),
    CONSTRAINT chk_node_state CHECK (state IN ('pending', 'approved', 'rejected', 'skipped')),
    CONSTRAINT fk_ns_req FOREIGN KEY (request_id) REFERENCES approval_requests(id) ON DELETE CASCADE
  ) ${MYSQL_TABLE_OPTS};

  CREATE TABLE IF NOT EXISTS user_devices (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    device_token VARCHAR(191) NOT NULL UNIQUE,
    label VARCHAR(191) DEFAULT '',
    ip_address VARCHAR(64) DEFAULT '',
    user_agent TEXT,
    last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_dev_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ${MYSQL_TABLE_OPTS};
`;

const INDEXES = [
  { name: 'idx_requests_status', table: 'approval_requests', cols: 'status' },
  { name: 'idx_requests_requester', table: 'approval_requests', cols: 'requester_id' },
  { name: 'idx_actions_request', table: 'approval_actions', cols: 'request_id' },
  { name: 'idx_backup_dept', table: 'backup_files', cols: 'department' },
  { name: 'idx_backup_wf', table: 'backup_files', cols: 'workflow_name' },
  { name: 'idx_backup_period', table: 'backup_files', cols: 'period_year, period_month' },
  { name: 'idx_user_depts_dept', table: 'user_departments', cols: 'department' },
  { name: 'idx_user_depts_user', table: 'user_departments', cols: 'user_id' },
  { name: 'idx_attachments_request', table: 'request_attachments', cols: 'request_id' },
  { name: 'idx_final_notify_user_pending', table: 'final_notify_receipts', cols: 'user_id, acked_at' },
  { name: 'idx_user_delegations_user', table: 'user_delegations', cols: 'user_id' },
  { name: 'idx_user_delegations_delegate', table: 'user_delegations', cols: 'delegate_user_id' },
  { name: 'idx_audit_created', table: 'system_audit_logs', cols: 'created_at' },
  { name: 'idx_audit_user', table: 'system_audit_logs', cols: 'user_id' },
  { name: 'idx_audit_action', table: 'system_audit_logs', cols: 'action_type' },
  { name: 'idx_node_states_request', table: 'request_node_states', cols: 'request_id' },
  { name: 'idx_node_states_pending', table: 'request_node_states', cols: 'request_id, state' },
  { name: 'idx_user_devices_user', table: 'user_devices', cols: 'user_id' },
];

const ADD_COLUMNS = [
  ['workflows', 'form_fields_json', `TEXT NOT NULL DEFAULT '[]'`],
  ['request_attachments', 'step_order', 'INTEGER'],
  ['approval_requests', 'form_schema_json', `TEXT DEFAULT '[]'`],
  ['approval_requests', 'steps_snapshot_json', 'TEXT'],
  ['users', 'permissions_json', `TEXT NOT NULL DEFAULT '[]'`],
  ['users', 'phone', 'TEXT'],
  ['users', 'extension', 'TEXT'],
  ['users', 'email_notify', 'INTEGER NOT NULL DEFAULT 1'],
  ['users', 'hire_date', 'TEXT'],
  ['users', 'sl_used_days', 'REAL NOT NULL DEFAULT 0'],
  ['users', 'sl_used_hours', 'REAL NOT NULL DEFAULT 0'],
  ['users', 'leave_used_json', `TEXT NOT NULL DEFAULT '{}'`],
  ['users', 'leave_entitled_json', `TEXT NOT NULL DEFAULT '{}'`],
  ['users', 'signature_image', 'TEXT'],
  ['approval_requests', 'notify_email', 'INTEGER NOT NULL DEFAULT 1'],
  ['approval_requests', 'notify_prefs_json', 'TEXT DEFAULT NULL'],
  ['approval_requests', 'last_remind_at', 'TEXT'],
  ['workflows', 'purged', 'INTEGER NOT NULL DEFAULT 0'],
  ['workflows', 'pdf_layout_json', `TEXT NOT NULL DEFAULT '{"type":"auto"}'`],
  ['workflows', 'final_notify_json', `TEXT NOT NULL DEFAULT '{"enabled":false,"userIds":[]}'`],
  ['approval_actions', 'form_data', `TEXT DEFAULT '{}'`],
  ['approval_actions', 'signature_image', 'TEXT'],
  ['approval_actions', 'delegated_for_id', 'INTEGER'],
  ['approval_requests', 'approver_data_json', `TEXT DEFAULT '{}'`],
  ['workflows', 'flow_json', 'TEXT'],
  ['workflows', 'flow_version', 'INTEGER NOT NULL DEFAULT 1'],
  ['approval_requests', 'flow_snapshot_json', 'TEXT'],
  ['approval_actions', 'node_id', 'TEXT'],
  ['approval_requests', 'deleted_at', 'TEXT'],
  ['approval_requests', 'submitted_by', 'INTEGER'],
  ['approval_requests', 'void_of_request_id', 'INTEGER'],
];

function listColumns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

function ensureColumn(db, table, name, spec) {
  const cols = listColumns(db, table);
  if (cols.includes(name)) return;
  const ddl = translateColumnSpec(spec, db.client);
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
}

function ensureIndexes(db) {
  for (const idx of INDEXES) {
    if (db.client === 'sqlite') {
      db.exec(`CREATE INDEX IF NOT EXISTS ${idx.name} ON ${idx.table} (${idx.cols})`);
      continue;
    }
    const row = db
      .prepare(
        `SELECT COUNT(*) AS c FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE() AND INDEX_NAME = ?`
      )
      .get(idx.name);
    if (row && Number(row.c) > 0) continue;
    try {
      db.execRaw(`CREATE INDEX ${idx.name} ON ${idx.table} (${idx.cols})`);
    } catch (e) {
      if (!/Duplicate|exists/i.test(e.message || '')) {
        console.warn('[db] index', idx.name, e.message);
      }
    }
  }
}

function mysqlFillJsonDefaults(db) {
  if (db.client !== 'mysql') return;
  try {
    db.exec(`UPDATE users SET permissions_json = '[]' WHERE permissions_json IS NULL OR permissions_json = ''`);
    db.exec(`UPDATE users SET leave_used_json = '{}' WHERE leave_used_json IS NULL OR leave_used_json = ''`);
    db.exec(`UPDATE users SET leave_entitled_json = '{}' WHERE leave_entitled_json IS NULL OR leave_entitled_json = ''`);
    db.exec(`UPDATE workflows SET form_fields_json = '[]' WHERE form_fields_json IS NULL OR form_fields_json = ''`);
    db.exec(`UPDATE workflows SET pdf_layout_json = '{"type":"auto"}' WHERE pdf_layout_json IS NULL OR pdf_layout_json = ''`);
    db.exec(
      `UPDATE workflows SET final_notify_json = '{"enabled":false,"userIds":[]}' WHERE final_notify_json IS NULL OR final_notify_json = ''`
    );
  } catch (e) {
    console.warn('[db] mysql json defaults', e.message);
  }
}

function rebuildApprovalActionsSqlite(db) {
  if (db.client !== 'sqlite') return;
  const actionsSql =
    db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='approval_actions'`).get()
      ?.sql || '';
  if (actionsSql && !/'cosign'/.test(actionsSql)) {
    db.exec('PRAGMA foreign_keys = OFF');
    try {
      db.exec('BEGIN');
      db.exec(`
        CREATE TABLE approval_actions_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          request_id INTEGER NOT NULL,
          step_order INTEGER,
          step_name TEXT NOT NULL DEFAULT '',
          actor_id INTEGER,
          action TEXT NOT NULL CHECK(action IN
            ('submit', 'approve', 'reject', 'cancel', 'return', 'comment',
             'system', 'cosign', 'forward')),
          comment TEXT DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
          form_data TEXT DEFAULT '{}',
          signature_image TEXT,
          delegated_for_id INTEGER,
          node_id TEXT,
          FOREIGN KEY (request_id) REFERENCES approval_requests(id) ON DELETE CASCADE,
          FOREIGN KEY (actor_id) REFERENCES users(id)
        );
      `);
      db.exec(`
        INSERT INTO approval_actions_new
          (id, request_id, step_order, step_name, actor_id, action, comment,
           created_at, form_data, signature_image, delegated_for_id, node_id)
        SELECT id, request_id, step_order, step_name, actor_id, action, comment,
               created_at, form_data, signature_image, delegated_for_id, node_id
        FROM approval_actions;
      `);
      db.exec(`DROP TABLE approval_actions;`);
      db.exec(`ALTER TABLE approval_actions_new RENAME TO approval_actions;`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_actions_request ON approval_actions(request_id);`);
      db.exec('COMMIT');
      console.log('[db] approval_actions 已重建：放寬 action 約束、actor_id 可空、保留 node_id');
    } catch (e) {
      try {
        db.exec('ROLLBACK');
      } catch {
        /* ignore */
      }
      console.error('[db] approval_actions 重建失敗，維持原結構：', e.message);
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
  }
}

function migrateMysqlChecks(db) {
  if (db.client !== 'mysql') return;
  const swaps = [
    [
      'approval_requests',
      'chk_req_status',
      `CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'cancelled', 'voided'))`,
    ],
    [
      'approval_actions',
      'chk_act_action',
      `CHECK (action IN ('submit', 'approve', 'reject', 'cancel', 'return', 'comment', 'system', 'cosign', 'forward', 'void'))`,
    ],
  ];
  for (const [table, name, expr] of swaps) {
    try {
      db.execRaw(`ALTER TABLE ${table} DROP CONSTRAINT ${name}`);
    } catch (e) {
      if (!/Unknown constraint|doesn't exist|check constraint/i.test(e.message || '')) {
        console.warn('[db] drop check', table, name, e.message);
      }
    }
    try {
      db.execRaw(`ALTER TABLE ${table} ADD CONSTRAINT ${name} ${expr}`);
    } catch (e) {
      console.warn('[db] add check', table, name, e.message);
    }
  }
}

function applySchema(db) {
  if (db.client === 'mysql') db.execRaw(MYSQL_DDL);
  else db.exec(SQLITE_DDL);
  mysqlFillJsonDefaults(db);

  for (const [table, name, spec] of ADD_COLUMNS) {
    try {
      ensureColumn(db, table, name, spec);
    } catch (e) {
      console.warn('[db] add column', table + '.' + name, e.message);
    }
  }

  ensureIndexes(db);
  rebuildApprovalActionsSqlite(db);
  migrateMysqlChecks(db);

  try {
    const { detectPdfLayoutType, pdfLayoutToJson } = require('../workflow-module');
    const rows = db
      .prepare(`SELECT id, name, pdf_layout_json FROM workflows WHERE COALESCE(purged, 0) = 0`)
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

  try {
    db.exec(`
      INSERT OR IGNORE INTO user_departments (user_id, department)
      SELECT id, department FROM users
      WHERE active = 1 AND department IS NOT NULL AND TRIM(department) != ''
    `);
  } catch {
    /* ignore */
  }

  const DEFAULT_DEPARTMENTS = ['管理部', '工程部', '採購部', '業務部', '財務部', '倉管部'];
  const insertDept = db.prepare(`INSERT OR IGNORE INTO departments (name, sort_order) VALUES (?, ?)`);
  DEFAULT_DEPARTMENTS.forEach((name, i) => {
    insertDept.run(name, i + 1);
  });
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
    /* ignore */
  }
}

const TABLE_ORDER = [
  'users',
  'departments',
  'workflows',
  'approval_requests',
  'approval_actions',
  'backup_files',
  'user_departments',
  'request_attachments',
  'final_notify_receipts',
  'user_delegations',
  'system_audit_logs',
  'request_node_states',
  'user_devices',
];

const DATETIME_COLS = new Set([
  'created_at',
  'updated_at',
  'completed_at',
  'last_remind_at',
  'deleted_at',
  'acked_at',
  'entered_at',
  'last_seen_at',
]);

module.exports = {
  applySchema,
  listColumns,
  SQLITE_DDL,
  MYSQL_DDL,
  TABLE_ORDER,
  DATETIME_COLS,
};
