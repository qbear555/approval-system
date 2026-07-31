/**
 * 請假申請以外的流程：移除代理人步驟與代理人表單欄位
 */
const db = require('./db');

const KEEP_AGENT = new Set(['請假申請']);

function stripAgent(steps) {
  return (steps || [])
    .filter((s) => {
      const name = String(s.name || '');
      // 僅移除「代理人」步驟本身，勿因 formFieldId 預設值誤刪其他步驟
      const isAgentStep =
        name.includes('代理人') ||
        (s.assignType === 'form_user' && (s.formFieldId === 'agent' || name.includes('代理')));
      return !isAgentStep;
    })
    .map((s, i) => ({
      ...s,
      order: i + 1,
      // 非 form_user 步驟不需綁定 agent 欄位
      formFieldId: s.assignType === 'form_user' ? s.formFieldId || 'agent' : '',
    }));
}

function stripAgentField(fields) {
  return (fields || []).filter((f) => f.id !== 'agent' && f.label !== '代理人');
}

const rows = db
  .prepare(
    `SELECT id, name, steps_json, form_fields_json, active
     FROM workflows
     WHERE IFNULL(purged, 0) = 0`
  )
  .all();

for (const w of rows) {
  if (KEEP_AGENT.has(w.name)) {
    console.log(`保留代理人: #${w.id} ${w.name}`);
    continue;
  }

  let steps = [];
  let fields = [];
  try {
    steps = JSON.parse(w.steps_json || '[]');
  } catch {
    steps = [];
  }
  try {
    fields = JSON.parse(w.form_fields_json || '[]');
  } catch {
    fields = [];
  }

  const newSteps = stripAgent(steps);
  const newFields = stripAgentField(fields);

  if (!newSteps.length) {
    console.log(`略過（移除後無步驟）: #${w.id} ${w.name}`);
    continue;
  }

  // description 清理
  let desc = '';
  const cur = db.prepare(`SELECT description FROM workflows WHERE id = ?`).get(w.id);
  desc = (cur?.description || '')
    .replace(/申請人\s*→\s*代理人\s*→/g, '申請人 → ')
    .replace(/→\s*代理人\s*→/g, ' → ')
    .replace(/代理人\s*→\s*/g, '')
    .replace(/（需代理人）/g, '');

  db.prepare(
    `UPDATE workflows
     SET steps_json = ?,
         form_fields_json = ?,
         description = ?,
         updated_at = datetime('now', 'localtime')
     WHERE id = ?`
  ).run(JSON.stringify(newSteps), JSON.stringify(newFields), desc, w.id);

  console.log(
    `已更新 #${w.id} ${w.name}: 步驟 ${steps.length}→${newSteps.length}, 欄位 ${fields.length}→${newFields.length}`
  );
  console.log(`  步驟: ${newSteps.map((s) => s.name).join(' → ')}`);
}

console.log('完成。僅「請假申請」保留代理人。');
