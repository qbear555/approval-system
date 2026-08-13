/**
 * Create default admin if no users exist.
 * Usage: npm run init-admin
 */
const fs = require('fs');
const path = require('path');
const db = require('./db');
const { hashPassword, generateBootstrapPassword } = require('./auth');

const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
if (count > 0) {
  console.log(`已有 ${count} 位使用者，略過建立。`);
  process.exit(0);
}

const pwd = generateBootstrapPassword();
const info = db
  .prepare(
    `INSERT INTO users (username, password_hash, name, email, department, role)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
  .run('Admin', hashPassword(pwd), '系統管理員', 'admin@example.com', '管理部', 'admin');

const bootFile = path.join(__dirname, '..', 'data', '.admin-bootstrap.txt');
fs.writeFileSync(
  bootFile,
  [`username=Admin`, `password=${pwd}`, '請登入後立刻修改密碼，並刪除此檔。', ''].join('\n'),
  { encoding: 'utf8', mode: 0o600 }
);

console.log('已建立內建管理員帳號 Admin。');
console.log('初始密碼已寫入 data/.admin-bootstrap.txt（勿提交 Git）。');
console.log('請登入後立刻改密並刪除該檔。');
console.log(`  user id: ${info.lastInsertRowid}`);
