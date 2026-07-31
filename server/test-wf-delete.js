const db = require('./db');
const wfs = db.prepare('SELECT id, name, active FROM workflows ORDER BY id').all();
console.log('workflows count', wfs.length);
for (const w of wfs) {
  const c = db
    .prepare(
      'SELECT status, COUNT(*) AS c FROM approval_requests WHERE workflow_id = ? GROUP BY status'
    )
    .all(w.id);
  const total = db
    .prepare('SELECT COUNT(*) AS c FROM approval_requests WHERE workflow_id = ?')
    .get(w.id).c;
  console.log(`#${w.id} active=${w.active} totalReqs=${total} ${w.name}`, c);
}

// probe FK without committing permanent damage: try delete in transaction then rollback
const probe = wfs[0];
if (probe) {
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM workflows WHERE id = ?').run(probe.id);
    console.log('PROBE: hard delete would SUCCEED for', probe.id);
  } catch (e) {
    console.log('PROBE: hard delete would FAIL:', e.message);
  }
  db.exec('ROLLBACK');
  const still = db.prepare('SELECT id FROM workflows WHERE id = ?').get(probe.id);
  console.log('after rollback still exists:', !!still);
}
