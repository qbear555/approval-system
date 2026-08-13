/**
 * Import accounts from 帳號密碼清冊.xlsx
 * Usage:
 *   node scripts/import-accounts-xlsx.js [xlsxPath] [dbPath]
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const { generateBootstrapPassword } = require('../server/auth');

const xlsxPath =
  process.argv[2] ||
  path.join('D:\\線上簽核系統_安裝包', '帳號密碼清冊.xlsx');
const dbPath =
  process.argv[3] || path.join(__dirname, '..', 'data', 'approval.db');

function hashPassword(p) {
  return bcrypt.hashSync(String(p), 10);
}

function splitDepts(text) {
  return String(text || '')
    .split(/[、,，;；\/]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_departments (
      user_id INTEGER NOT NULL,
      department TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      PRIMARY KEY (user_id, department),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
}

function main() {
  if (!fs.existsSync(xlsxPath)) {
    console.error('XLSX not found:', xlsxPath);
    process.exit(1);
  }
  if (!fs.existsSync(dbPath)) {
    console.error('DB not found:', dbPath);
    process.exit(1);
  }

  // Checkpoint existing WAL if any
  try {
    const pre = new DatabaseSync(dbPath);
    pre.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    pre.close();
  } catch {
    /* ignore */
  }

  const wb = XLSX.readFile(xlsxPath);
  const sheet = wb.Sheets['帳號密碼'] || wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  console.log('Import file:', xlsxPath);
  console.log('Database:', dbPath);
  console.log('Rows:', rows.length);

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  ensureSchema(db);

  const findByUsername = db.prepare(
    `SELECT * FROM users WHERE lower(username) = lower(?)`
  );
  const findByName = db.prepare(
    `SELECT * FROM users WHERE name = ? AND active = 1 AND username NOT LIKE '%__del_%'`
  );
  const insertUser = db.prepare(
    `INSERT INTO users (username, password_hash, name, email, department, role, active)
     VALUES (?, ?, ?, ?, ?, ?, 1)`
  );
  const updateUser = db.prepare(
    `UPDATE users SET
       username = ?,
       password_hash = ?,
       name = ?,
       email = ?,
       department = ?,
       role = ?,
       active = 1
     WHERE id = ?`
  );
  const insertDept = db.prepare(
    `INSERT OR IGNORE INTO departments (name, sort_order) VALUES (?, ?)`
  );
  const maxSort = db.prepare(`SELECT COALESCE(MAX(sort_order), 0) AS m FROM departments`);
  const clearUserDepts = db.prepare(`DELETE FROM user_departments WHERE user_id = ?`);
  const insertUserDept = db.prepare(
    `INSERT OR IGNORE INTO user_departments (user_id, department) VALUES (?, ?)`
  );

  let created = 0;
  let updated = 0;
  let sortBase = maxSort.get().m || 0;

  db.exec('BEGIN');
  try {
    for (const row of rows) {
      const name = String(row['姓名'] || '').trim();
      const username = String(row['帳號'] || '').trim();
      const password = String(row['密碼'] || '').trim() || generateBootstrapPassword();
      const email = String(row['Email'] || row['email'] || '').trim() || null;
      const roleLabel = String(row['角色'] || '').trim();
      const role = /管理/.test(roleLabel) ? 'admin' : 'user';
      const primary =
        String(row['主部門'] || '').trim() ||
        splitDepts(row['部門'])[0] ||
        '';
      const depts = splitDepts(row['部門']);
      if (primary && !depts.includes(primary)) depts.unshift(primary);
      const uniqueDepts = [...new Set(depts)];

      if (!name || !username) {
        console.warn('Skip incomplete row:', row);
        continue;
      }

      for (const d of uniqueDepts) {
        const exists = db
          .prepare(`SELECT id FROM departments WHERE name = ?`)
          .get(d);
        if (!exists) {
          sortBase += 1;
          insertDept.run(d, sortBase);
          console.log('  + department', d);
        }
      }

      let user = findByUsername.get(username);
      if (!user) {
        // match by display name (prefer non-deleted)
        const byName = findByName.all(name);
        user = byName[0] || null;
      }

      const hash = hashPassword(password);
      if (user) {
        // if renaming username and target already taken by another id, keep old username
        let finalUsername = username;
        const clash = findByUsername.get(username);
        if (clash && clash.id !== user.id) {
          console.warn(
            `  ! username ${username} already used by #${clash.id}, keep ${user.username} for ${name}`
          );
          finalUsername = user.username;
        }
        updateUser.run(
          finalUsername,
          hash,
          name,
          email,
          primary,
          role,
          user.id
        );
        clearUserDepts.run(user.id);
        for (const d of uniqueDepts) insertUserDept.run(user.id, d);
        updated += 1;
        console.log(
          `UPDATE #${user.id} ${finalUsername} / ${name} / ${primary} / ${role}`
        );
      } else {
        const info = insertUser.run(
          username,
          hash,
          name,
          email,
          primary,
          role
        );
        const id = Number(info.lastInsertRowid);
        for (const d of uniqueDepts) insertUserDept.run(id, d);
        created += 1;
        console.log(`CREATE #${id} ${username} / ${name} / ${primary} / ${role}`);
      }
    }
    db.exec('COMMIT');
  } catch (e) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw e;
  }
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  db.close();

  console.log('---');
  console.log(`Done. created=${created} updated=${updated}`);
}

main();
