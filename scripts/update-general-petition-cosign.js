/**
 * 一般簽呈：部門主管之後新增「會簽人員」（cosign_pick，下拉、非必填）
 * 用法：node scripts/update-general-petition-cosign.js [dbPath]
 */
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const dbPath = process.argv[2] || path.join(__dirname, '..', 'data', 'approval.db');
const db = new DatabaseSync(dbPath);

const rows = db
  .prepare(
    `SELECT id, name, steps_json, description FROM workflows
     WHERE IFNULL(purged,0)=0 AND (name = '一般簽呈' OR name LIKE '%一般簽呈%')`
  )
  .all();

if (!rows.length) {
  console.error('No 一般簽呈 workflow');
  process.exit(1);
}

for (const row of rows) {
  let steps;
  try {
    steps = JSON.parse(row.steps_json || '[]');
  } catch {
    console.warn('bad json', row.id);
    continue;
  }
  if (!Array.isArray(steps)) continue;

  // 已有會簽步驟則略過
  if (steps.some((s) => s.assignType === 'cosign_pick' || /會簽/.test(String(s.name || '')))) {
    console.log('already has cosign', row.id, row.name);
    continue;
  }

  // 找部門主管步驟位置，插在其後；若無則插在最前
  let insertAt = 0;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s.assignType === 'dept_head' || /部門主管/.test(String(s.name || ''))) {
      insertAt = i + 1;
      break;
    }
  }

  const cosignStep = {
    order: insertAt + 1,
    name: '會簽人員',
    assignType: 'cosign_pick',
    mode: 'all', // 多位會簽時皆須核准
    formFieldId: '',
    department: '',
    approverIds: [],
    approverFields: [],
  };

  const next = [...steps];
  next.splice(insertAt, 0, cosignStep);
  // 重新編號
  const renumbered = next.map((s, i) => ({
    ...s,
    order: i + 1,
  }));

  const desc =
    '申請人 → 部門主管（可略過）→ 會簽人員（選填）→ 副總經理 → 總經理';

  db.prepare(
    `UPDATE workflows SET steps_json = ?, description = ?, updated_at = datetime('now','localtime') WHERE id = ?`
  ).run(JSON.stringify(renumbered), desc, row.id);

  console.log(
    'updated',
    row.id,
    row.name,
    renumbered.map((s) => `${s.order}.${s.name}(${s.assignType})`).join(' → ')
  );
}

db.close();
console.log('OK', dbPath);
