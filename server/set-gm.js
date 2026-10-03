/** 設定總經理為陳明耀 */
const db = require('./db');
const { hashPassword } = require('./auth');

const name = '陳明耀';
const username = 'chenmy';
const password = 'pass1234';
const department = '管理部';

let user = db.prepare(`SELECT id FROM users WHERE username = ?`).get(username);
if (!user) {
  user = db.prepare(`SELECT id FROM users WHERE name = ?`).get(name);
}
if (!user) {
  user = db.prepare(`SELECT id FROM users WHERE username = 'gm'`).get();
}

let gmId;
if (user) {
  db.prepare(
    `UPDATE users SET username = ?, name = ?, department = ?, password_hash = ?, active = 1 WHERE id = ?`
  ).run(username, name, department, hashPassword(password), user.id);
  gmId = user.id;
  console.log(`已更新 #${gmId} ${username} / ${name}`);
} else {
  const r = db
    .prepare(
      `INSERT INTO users (username, password_hash, name, email, department, role)
       VALUES (?, ?, ?, NULL, ?, 'user')`
    )
    .run(username, hashPassword(password), name, department);
  gmId = Number(r.lastInsertRowid);
  console.log(`已建立 #${gmId} ${username} / ${name}`);
}

const legacy = db.prepare(`SELECT id FROM users WHERE username = 'gm' AND id != ?`).get(gmId);
if (legacy) {
  db.prepare(`UPDATE users SET active = 0 WHERE id = ?`).run(legacy.id);
  console.log(`已停用舊帳號 gm #${legacy.id}`);
}

const wfs = db.prepare(`SELECT id, name, steps_json FROM workflows WHERE active = 1`).all();
for (const w of wfs) {
  const steps = JSON.parse(w.steps_json);
  let changed = false;
  for (const s of steps) {
    if (s.name === '總經理') {
      s.assignType = 'users';
      s.approverIds = [gmId];
      s.mode = s.mode || 'any';
      changed = true;
    }
  }
  if (changed) {
    db.prepare(
      `UPDATE workflows SET steps_json = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`
    ).run(JSON.stringify(steps), w.id);
    console.log(`流程已更新 #${w.id} ${w.name} → 總經理=${name}`);
  }
}

console.log('完成。登入：chenmy / pass1234');
