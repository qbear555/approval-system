/**
 * 部門主管改為非必填：
 * 1) 從各流程移除「部門主管」步驟
 * 2) 若模板仍含 dept_head，送出時可略過（見 index.js resolve）
 */
const db = require('./db');

function stripDeptHead(steps) {
  return (steps || [])
    .filter((s) => {
      const name = String(s.name || '');
      if (s.assignType === 'dept_head') return false;
      if (name.includes('部門主管') || name === '單位主管') return false;
      return true;
    })
    .map((s, i) => ({ ...s, order: i + 1 }));
}

const rows = db
  .prepare(
    `SELECT id, name, steps_json, description
     FROM workflows
     WHERE IFNULL(purged, 0) = 0`
  )
  .all();

for (const w of rows) {
  let steps = [];
  try {
    steps = JSON.parse(w.steps_json || '[]');
  } catch {
    steps = [];
  }
  const before = steps.length;
  const newSteps = stripDeptHead(steps);
  if (newSteps.length === before) {
    console.log(`無部門主管步驟: #${w.id} ${w.name}`);
    continue;
  }
  if (!newSteps.length) {
    console.log(`略過（移除後無步驟）: #${w.id} ${w.name}`);
    continue;
  }

  let desc = String(w.description || '')
    .replace(/→\s*部門主管\s*→/g, ' → ')
    .replace(/部門主管\s*→\s*/g, '')
    .replace(/\s*→\s*部門主管/g, '')
    .replace(/申請人\s*→\s*部門主管\s*→/g, '申請人 → ');

  db.prepare(
    `UPDATE workflows
     SET steps_json = ?, description = ?, updated_at = datetime('now', 'localtime')
     WHERE id = ?`
  ).run(JSON.stringify(newSteps), desc, w.id);

  console.log(
    `已更新 #${w.id} ${w.name}: ${before}→${newSteps.length} 步驟`
  );
  console.log(`  ${newSteps.map((s) => s.name).join(' → ')}`);
}

console.log('完成：部門主管已自各流程移除（非必填）。');
