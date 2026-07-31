/** 一般簽呈會簽步驟 mode=all */
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const dbPath = process.argv[2] || path.join(__dirname, '..', 'data', 'approval.db');
const db = new DatabaseSync(dbPath);
const rows = db
  .prepare(
    `SELECT id, name, steps_json FROM workflows WHERE IFNULL(purged,0)=0 AND name LIKE '%一般簽呈%'`
  )
  .all();
for (const row of rows) {
  const steps = JSON.parse(row.steps_json || '[]').map((s) => {
    if (s.assignType === 'cosign_pick' || /會簽/.test(String(s.name || ''))) {
      return { ...s, mode: 'all', assignType: 'cosign_pick' };
    }
    return s;
  });
  db.prepare(
    `UPDATE workflows SET steps_json=?, description=?, updated_at=datetime('now','localtime') WHERE id=?`
  ).run(
    JSON.stringify(steps),
    '申請人 → 部門主管（可略過）→ 會簽人員（可多選、皆須核准）→ 副總經理 → 總經理',
    row.id
  );
  console.log('ok', row.id, steps.find((s) => s.assignType === 'cosign_pick'));
}
db.close();
