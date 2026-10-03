const db = require('./db');
const { hashPassword } = require('./auth');

const users = [
  { username: 'tsuming', password: 'pass1234', name: '張祖銘', department: '管理部' },
  { username: 'chenza', password: 'pass1234', name: '陳子安', department: '工程部' },
  { username: 'linls', password: 'pass1234', name: '林麗淑', department: '採購部' },
  { username: 'linxm', password: 'pass1234', name: '林秀美', department: '倉管部' },
  { username: 'chenzh', password: 'pass1234', name: '陳政宏', department: '業務部' },
];

const find = db.prepare('SELECT id, username, name, department FROM users WHERE username = ?');
const upd = db.prepare(
  'UPDATE users SET name = ?, department = ?, password_hash = ? WHERE username = ?'
);
const ins = db.prepare(
  `INSERT INTO users (username, password_hash, name, email, department, role)
   VALUES (?, ?, ?, NULL, ?, 'user')`
);

for (const u of users) {
  const existing = find.get(u.username);
  if (existing) {
    upd.run(u.name, u.department, hashPassword(u.password), u.username);
    console.log('UPDATED', u.username, u.name, u.department);
  } else {
    const r = ins.run(u.username, hashPassword(u.password), u.name, u.department);
    console.log('CREATED', u.username, u.name, u.department, 'id=' + r.lastInsertRowid);
  }
}

console.log('--- all users ---');
for (const row of db
  .prepare('SELECT id, username, name, department, role FROM users ORDER BY id')
  .all()) {
  console.log(
    `#${row.id}  ${row.username.padEnd(12)}  ${row.name}  ${row.department || '—'}  (${row.role})`
  );
}
