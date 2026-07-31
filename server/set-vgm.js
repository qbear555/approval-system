/** 設定副總經理為陳牧晨 */
const db = require('./db');
const { hashPassword } = require('./auth');

const name = '陳牧晨';
const username = 'chenmc';
const password = 'pass1234';
const department = '管理部';

let user = db.prepare(`SELECT id FROM users WHERE username = ?`).get(username);
if (!user) {
  user = db.prepare(`SELECT id FROM users WHERE name = ?`).get(name);
}
if (!user) {
  // 沿用舊 vgm 帳號 id
  user = db.prepare(`SELECT id FROM users WHERE username = 'vgm'`).get();
}

let vgmId;
if (user) {
  db.prepare(
    `UPDATE users SET username = ?, name = ?, department = ?, password_hash = ?, active = 1 WHERE id = ?`
  ).run(username, name, department, hashPassword(password), user.id);
  vgmId = user.id;
  console.log(`已更新 #${vgmId} ${username} / ${name}`);
} else {
  const r = db
    .prepare(
      `INSERT INTO users (username, password_hash, name, email, department, role)
       VALUES (?, ?, ?, NULL, ?, 'user')`
    )
    .run(username, hashPassword(password), name, department);
  vgmId = Number(r.lastInsertRowid);
  console.log(`已建立 #${vgmId} ${username} / ${name}`);
}

// 停用舊的「副總經理」占位帳號（若 username 仍是 vgm 且 id 不同）
const legacy = db.prepare(`SELECT id FROM users WHERE username = 'vgm' AND id != ?`).get(vgmId);
if (legacy) {
  db.prepare(`UPDATE users SET active = 0 WHERE id = ?`).run(legacy.id);
  console.log(`已停用舊帳號 vgm #${legacy.id}`);
}

// 所有流程「副總經理」步驟改指陳牧晨
const wfs = db.prepare(`SELECT id, name, steps_json FROM workflows WHERE active = 1`).all();
for (const w of wfs) {
  const steps = JSON.parse(w.steps_json);
  let changed = false;
  for (const s of steps) {
    if (s.name === '副總經理') {
      s.assignType = 'users';
      s.approverIds = [vgmId];
      s.mode = s.mode || 'any';
      changed = true;
    }
  }
  if (changed) {
    db.prepare(
      `UPDATE workflows SET steps_json = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`
    ).run(JSON.stringify(steps), w.id);
    console.log(`流程已更新 #${w.id} ${w.name} → 副總經理=${name}`);
  }
}

console.log('完成。登入：chenmc / pass1234');
