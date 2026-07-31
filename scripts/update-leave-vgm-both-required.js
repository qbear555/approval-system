/**
 * 請假申請：副總改為固定兩人且 mode=all（都必簽），取消申請人自選
 * 用法：node scripts/update-leave-vgm-both-required.js [dbPath]
 */
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const dbPath = process.argv[2] || path.join(__dirname, '..', 'data', 'approval.db');
const db = new DatabaseSync(dbPath);

function findIdsByUsernames(names) {
  const ids = [];
  for (const n of names) {
    const u = db
      .prepare(`SELECT id FROM users WHERE lower(username)=lower(?) AND active=1`)
      .get(n);
    if (u) ids.push(u.id);
  }
  return ids;
}

const vgmIds = findIdsByUsernames(['luis', 'danny']);
if (!vgmIds.length) {
  console.error('No VGM users found (luis/danny)');
  process.exit(1);
}
console.log('VGM ids', vgmIds);

const rows = db
  .prepare(
    `SELECT id, name, steps_json, description FROM workflows
     WHERE IFNULL(purged,0)=0 AND name LIKE '%請假%'`
  )
  .all();

if (!rows.length) {
  console.error('No leave workflows found');
  process.exit(1);
}

for (const row of rows) {
  let steps;
  try {
    steps = JSON.parse(row.steps_json || '[]');
  } catch {
    console.warn('skip bad json', row.id);
    continue;
  }
  let changed = false;
  const next = steps.map((s, i) => {
    const name = String(s.name || '');
    if (!/副總/.test(name)) return s;
    changed = true;
    const existing = Array.isArray(s.approverIds)
      ? s.approverIds.map(Number).filter(Boolean)
      : [];
    const approverIds = existing.length >= 2 ? existing : vgmIds;
    return {
      ...s,
      order: s.order != null ? s.order : i + 1,
      assignType: 'users',
      mode: 'all',
      approverIds,
      approverFields: Array.isArray(s.approverFields) ? s.approverFields : [],
    };
  });
  if (!changed) {
    console.log('no VGM step', row.id, row.name);
    continue;
  }
  let desc = row.description || '';
  if (desc && !/兩位副總|副總皆簽|全部副總/.test(desc)) {
    desc = desc.replace(/副總經理/, '副總經理（兩位皆須核准）');
  }
  db.prepare(
    `UPDATE workflows SET steps_json = ?, description = ?, updated_at = datetime('now','localtime') WHERE id = ?`
  ).run(JSON.stringify(next), desc || row.description, row.id);
  const vgm = next.find((s) => /副總/.test(String(s.name || '')));
  console.log(
    'updated',
    row.id,
    row.name,
    '→',
    vgm && `${vgm.assignType} mode=${vgm.mode} ids=${(vgm.approverIds || []).join(',')}`
  );
}

db.close();
console.log('OK', dbPath);
