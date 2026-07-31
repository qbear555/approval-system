/**
 * 將所有流程中的「副總經理」步驟改為申請人自選（users_pick）
 * 候選：luis、danny（或步驟既有 approverIds）
 * 用法：node scripts/update-vgm-users-pick.js [dbPath]
 */
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const dbPath = process.argv[2] || path.join(__dirname, '..', 'data', 'approval.db');
const db = new DatabaseSync(dbPath);

function findIdsByUsernames(names) {
  const ids = [];
  for (const n of names) {
    const u = db
      .prepare(
        `SELECT id FROM users WHERE lower(username)=lower(?) AND active=1`
      )
      .get(n);
    if (u) ids.push(u.id);
  }
  return ids;
}

const defaultVgm = findIdsByUsernames(['luis', 'danny']);
// 若帳號找不到，改用姓名含「副總」
const byName = db
  .prepare(
    `SELECT id FROM users WHERE active=1 AND (name LIKE '%副總%' OR name LIKE '%副總經理%') ORDER BY id`
  )
  .all()
  .map((r) => r.id);
const pool = defaultVgm.length ? defaultVgm : byName;
console.log('VGM pool ids', pool);

const rows = db
  .prepare(
    `SELECT id, name, steps_json FROM workflows WHERE IFNULL(purged,0)=0`
  )
  .all();

let updated = 0;
for (const row of rows) {
  // 請假申請：固定兩位副總皆簽，不改為申請人自選
  if (/請假/.test(String(row.name || ''))) {
    console.log('skip leave workflow (both VGM required)', row.id, row.name);
    continue;
  }
  let steps;
  try {
    steps = JSON.parse(row.steps_json || '[]');
  } catch {
    continue;
  }
  if (!Array.isArray(steps) || !steps.length) continue;
  let changed = false;
  const next = steps.map((s, i) => {
    const name = String(s.name || '');
    const isVgm = /副總/.test(name);
    if (!isVgm) return s;
    const existing = Array.isArray(s.approverIds)
      ? s.approverIds.map(Number).filter(Boolean)
      : [];
    const approverIds = existing.length ? existing : [...pool];
    if (
      s.assignType === 'users_pick' &&
      JSON.stringify(existing) === JSON.stringify(approverIds)
    ) {
      return s;
    }
    changed = true;
    return {
      ...s,
      order: s.order != null ? s.order : i + 1,
      assignType: 'users_pick',
      mode: s.mode === 'all' ? 'all' : 'any',
      approverIds,
    };
  });
  if (!changed) {
    // still ensure assignType if already pick
    console.log('skip (already ok or no VGM step)', row.id, row.name);
    continue;
  }
  db.prepare(
    `UPDATE workflows SET steps_json = ?, updated_at = datetime('now','localtime') WHERE id = ?`
  ).run(JSON.stringify(next), row.id);
  updated++;
  console.log(
    'updated',
    row.id,
    row.name,
    next
      .filter((s) => /副總/.test(String(s.name || '')))
      .map((s) => `${s.assignType}:${(s.approverIds || []).join(',')}`)
      .join(' | ')
  );
}

console.log('OK updated', updated, 'workflows; db=', dbPath);
db.close();
