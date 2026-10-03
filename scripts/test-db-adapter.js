/**
 * 雙後端適配層測試（不碰正式 data/approval.db）
 *
 *   node scripts/test-db-adapter.js
 *   若本機有 MySQL：DB_CLIENT=mysql MYSQL_HOST=127.0.0.1 MYSQL_USER=... node scripts/test-db-adapter.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { translateSql } = require('../server/db-adapter/dialect');
const { createDatabase } = require('../server/db-adapter');

let pass = 0;
let fail = 0;
const failures = [];

function check(label, actual, expected) {
  const ok =
    expected !== undefined
      ? JSON.stringify(actual) === JSON.stringify(expected)
      : !!actual;
  if (ok) {
    pass++;
    console.log('  ok  ' + label);
  } else {
    fail++;
    failures.push(label);
    console.log('  FAIL  ' + label);
    if (expected !== undefined) {
      console.log('       expected', expected);
      console.log('       actual  ', actual);
    }
  }
}

function testDialect() {
  console.log('\n[dialect]');
  const sql = translateSql(
    `UPDATE t SET updated_at = datetime('now','localtime') WHERE id = ?`,
    'mysql'
  );
  check(
    'datetime → DATE_FORMAT(NOW())',
    sql.includes("DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s')")
  );
  const monthSql = translateSql(
    `SELECT COUNT(*) AS c FROM approval_requests WHERE created_at >= date('now', 'start of month', 'localtime')`,
    'mysql'
  );
  check('date start of month', monthSql.includes("DATE_FORMAT(NOW(), '%Y-%m-01')"));
  check('不含殘留 start of month', !/start of month/i.test(monthSql));
  const jd = translateSql(
    `SELECT AVG(julianday(completed_at) - julianday(created_at)) AS d FROM approval_requests`,
    'mysql'
  );
  check('julianday 差 → UNIX_TIMESTAMP', /UNIX_TIMESTAMP\(\s*completed_at\s*\)/.test(jd));
  check('julianday 已移除', !/julianday/i.test(jd));
  check(
    'INSERT OR IGNORE',
    translateSql('INSERT OR IGNORE INTO departments (name, sort_order) VALUES (?, ?)', 'mysql'),
    'INSERT IGNORE INTO departments (name, sort_order) VALUES (?, ?)'
  );
  const upsert = translateSql(
    `INSERT INTO backup_files (request_id, department, created_at)
     VALUES (?, ?, datetime('now','localtime'))
     ON CONFLICT(request_id) DO UPDATE SET
       department = excluded.department,
       created_at = datetime('now','localtime')`,
    'mysql'
  );
  check('ON CONFLICT → ON DUPLICATE KEY', /ON DUPLICATE KEY UPDATE/i.test(upsert));
  check('excluded.x → VALUES(x)', upsert.includes('VALUES(department)'));
  check(
    '未指定 mysql 時不翻譯',
    translateSql('INSERT OR IGNORE INTO t (a) VALUES (1)', 'sqlite'),
    'INSERT OR IGNORE INTO t (a) VALUES (1)'
  );
  const quoted = translateSql(
    `INSERT INTO approval_actions (action, comment) VALUES ('comment', ?)`,
    'mysql'
  );
  check('欄位 comment 加反引號', quoted.includes('`comment`'));
  check('字串 comment 不加反引號', quoted.includes("'comment'"));
  check('COLLATE NOCASE 移除', !/COLLATE/i.test(
    translateSql(`ORDER BY name COLLATE NOCASE`, 'mysql')
  ));
}

function exercise(db, label) {
  console.log('\n[' + label + ']');
  const info = db
    .prepare(
      `INSERT INTO users (username, password_hash, name, email, department, role)
       VALUES (?, ?, ?, NULL, '管理部', 'user')`
    )
    .run('__dbtest__u', 'x', '測試');
  check('lastInsertRowid', Number(info.lastInsertRowid) > 0);
  const uid = Number(info.lastInsertRowid);
  const u = db.prepare(`SELECT id, name, active FROM users WHERE id = ?`).get(uid);
  check('get 使用者', u && u.name === '測試');
  check('active 為 1', Number(u.active) === 1);

  db.prepare(`INSERT OR IGNORE INTO departments (name, sort_order) VALUES (?, ?)`).run(
    '__dbtest__dept',
    99
  );
  const n1 = db.prepare(`SELECT COUNT(*) AS c FROM departments WHERE name = ?`).get(
    '__dbtest__dept'
  ).c;
  db.prepare(`INSERT OR IGNORE INTO departments (name, sort_order) VALUES (?, ?)`).run(
    '__dbtest__dept',
    99
  );
  const n2 = db.prepare(`SELECT COUNT(*) AS c FROM departments WHERE name = ?`).get(
    '__dbtest__dept'
  ).c;
  check('INSERT OR IGNORE 不重複', Number(n1) === 1 && Number(n2) === 1);

  const wf = db
    .prepare(
      `INSERT INTO workflows (name, created_by, steps_json, form_fields_json)
       VALUES (?, ?, '[]', '[]')`
    )
    .run('__dbtest__wf', uid);
  const wid = Number(wf.lastInsertRowid);
  const req = db
    .prepare(
      `INSERT INTO approval_requests (workflow_id, title, content, requester_id, status)
       VALUES (?, ?, '', ?, 'pending')`
    )
    .run(wid, '__dbtest__req', uid);
  const rid = Number(req.lastInsertRowid);
  db.prepare(
    `INSERT INTO approval_actions (request_id, step_order, step_name, actor_id, action, comment, form_data)
     VALUES (?, 0, '送出', ?, 'submit', '送出', '{}')`
  ).run(rid, uid);
  const act = db
    .prepare(`SELECT action, comment FROM approval_actions WHERE request_id = ?`)
    .get(rid);
  check('comment 欄位', act && act.comment === '送出' && act.action === 'submit');

  db.prepare(
    `UPDATE approval_requests SET updated_at = datetime('now','localtime') WHERE id = ?`
  ).run(rid);
  const after = db.prepare(`SELECT updated_at FROM approval_requests WHERE id = ?`).get(rid);
  check('datetime 寫入', after && String(after.updated_at).length >= 16);

  db.prepare(
    `INSERT INTO backup_files (
       request_id, department, workflow_name, period_year, period_month,
       file_rel_path, file_name, title, requester_name, status, created_by, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))
     ON CONFLICT(request_id) DO UPDATE SET
       department = excluded.department,
       workflow_name = excluded.workflow_name,
       period_year = excluded.period_year,
       period_month = excluded.period_month,
       file_rel_path = excluded.file_rel_path,
       file_name = excluded.file_name,
       title = excluded.title,
       requester_name = excluded.requester_name,
       status = excluded.status,
       created_by = excluded.created_by,
       created_at = datetime('now','localtime')`
  ).run(rid, '管理部', '測試', '2026', '08', 'x.pdf', 'x.pdf', 't', '測試', 'approved', uid);
  db.prepare(
    `INSERT INTO backup_files (
       request_id, department, workflow_name, period_year, period_month,
       file_rel_path, file_name, title, requester_name, status, created_by, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))
     ON CONFLICT(request_id) DO UPDATE SET
       department = excluded.department,
       workflow_name = excluded.workflow_name,
       period_year = excluded.period_year,
       period_month = excluded.period_month,
       file_rel_path = excluded.file_rel_path,
       file_name = excluded.file_name,
       title = excluded.title,
       requester_name = excluded.requester_name,
       status = excluded.status,
       created_by = excluded.created_by,
       created_at = datetime('now','localtime')`
  ).run(rid, '業務部', '測試', '2026', '08', 'y.pdf', 'y.pdf', 't2', '測試', 'approved', uid);
  const bak = db.prepare(`SELECT department, file_name FROM backup_files WHERE request_id = ?`).get(
    rid
  );
  check('ON CONFLICT upsert', bak && bak.department === '業務部' && bak.file_name === 'y.pdf');

  const cols = db.prepare(`PRAGMA table_info(users)`).all();
  check('PRAGMA table_info', cols.some((c) => c.name === 'username'));

  db.prepare(`SELECT 1 AS ok`).get();
  check('SELECT 1', true);

  db.prepare('DELETE FROM backup_files WHERE request_id = ?').run(rid);
  db.prepare('DELETE FROM approval_actions WHERE request_id = ?').run(rid);
  db.prepare('DELETE FROM approval_requests WHERE id = ?').run(rid);
  db.prepare('DELETE FROM workflows WHERE id = ?').run(wid);
  db.prepare("DELETE FROM departments WHERE name = '__dbtest__dept'").run();
  db.prepare('DELETE FROM user_departments WHERE user_id = ?').run(uid);
  db.prepare('DELETE FROM users WHERE id = ?').run(uid);
}

function testMigrateSqliteToSqlite() {
  console.log('\n[migrate sqlite→sqlite]');
  check('empty datetime → null', emptyToNull('created_at', ''), null);
  check('empty 文字欄不轉 null', emptyToNull('title', ''), '');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'approval-mig-'));
  const srcFile = path.join(dir, 'src.db');
  const destFile = path.join(dir, 'dest.db');
  const src = createDatabase({ client: 'sqlite', filename: srcFile });
  const dest = createDatabase({ client: 'sqlite', filename: destFile });
  try {
    const u = src
      .prepare(
        `INSERT INTO users (username, password_hash, name, department, role)
         VALUES ('__mig__', 'x', '遷移', '管理部', 'user')`
      )
      .run();
    const uid = Number(u.lastInsertRowid);
    const w = src
      .prepare(
        `INSERT INTO workflows (name, created_by, steps_json) VALUES ('__migwf__', ?, '[]')`
      )
      .run(uid);
    src
      .prepare(
        `INSERT INTO approval_requests (workflow_id, title, content, requester_id, status, completed_at)
         VALUES (?, '單', '', ?, 'approved', '')`
      )
      .run(Number(w.lastInsertRowid), uid);
    copyAllTables(src, dest, { wipe: true });
    const cmp = compareCounts(src, dest);
    check(
      '各表列數相同',
      cmp.every((r) => r.ok)
    );
    const name = dest.prepare(`SELECT name FROM users WHERE username = '__mig__'`).get();
    check('使用者列複製', name && name.name === '遷移');
    const req = dest.prepare(`SELECT title, completed_at FROM approval_requests WHERE title = '單'`).get();
    check('空 completed_at 變 null', req && req.title === '單' && req.completed_at == null);
  } finally {
    src.close();
    dest.close();
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

function testSqlite() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'approval-db-'));
  const filename = path.join(dir, 't.db');
  const db = createDatabase({ client: 'sqlite', filename });
  try {
    exercise(db, 'sqlite');
  } finally {
    db.close();
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

function testMysql() {
  const client = String(process.env.DB_CLIENT || '').toLowerCase();
  const hasHost = !!(process.env.MYSQL_HOST || process.env.DATABASE_URL);
  if (client !== 'mysql' && client !== 'mariadb' && !hasHost) {
    console.log('\n[mysql] 略過（未設定 DB_CLIENT=mysql 或 MYSQL_HOST）');
    return;
  }
  const db = createDatabase({ client: 'mysql' });
  try {
    exercise(db, 'mysql');
  } finally {
    db.close();
  }
}

testDialect();
try {
  testMysql();
} catch (e) {
  fail++;
  failures.push('mysql: ' + e.message);
  console.log('  FAIL  mysql', e.message);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) {
  console.log(failures.join('\n'));
  process.exit(1);
}
