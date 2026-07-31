const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const dbPath = path.join(__dirname, '..', 'data', 'approval.db');
const db = new DatabaseSync(dbPath, { readOnly: true });
console.log('db:', dbPath);
for (const u of db
  .prepare('SELECT id, username, name, department, active FROM users ORDER BY id')
  .all()) {
  console.log(`#${u.id} ${u.username} ${u.name} ${u.department} active=${u.active}`);
}
console.log('--- top steps ---');
for (const w of db.prepare('SELECT id, name, steps_json FROM workflows WHERE active=1').all()) {
  const steps = JSON.parse(w.steps_json);
  for (const s of steps) {
    if (s.name === '副總經理' || s.name === '總經理') {
      console.log(w.name, s.name, '->', s.approverIds);
    }
  }
}
