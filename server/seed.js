/**
 * Create default admin if no users exist.
 * Usage: npm run init-admin
 */
const db = require('./db');
const { hashPassword } = require('./auth');

const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
if (count > 0) {
  console.log(`已有 ${count} 位使用者，略過建立。`);
  process.exit(0);
}

const info = db
  .prepare(
    `INSERT INTO users (username, password_hash, name, email, department, role)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
  .run('admin', hashPassword('admin123'), '系統管理員', 'admin@example.com', '管理部', 'admin');

console.log('已建立預設管理員帳號：');
console.log('  帳號: admin');
console.log('  密碼: admin123');
console.log('  請登入後立即修改密碼。');
console.log(`  user id: ${info.lastInsertRowid}`);
