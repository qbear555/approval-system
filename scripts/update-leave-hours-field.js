/** 請假申請表單：在「天數」後新增「小時」欄位 */
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const dbPath = process.argv[2] || path.join(__dirname, '..', 'data', 'approval.db');
const db = new DatabaseSync(dbPath);

const rows = db
  .prepare(
    `SELECT id, name, form_fields_json FROM workflows
     WHERE name LIKE '%請假%' AND IFNULL(purged,0)=0`
  )
  .all();

const hoursField = {
  id: 'hours',
  label: '小時',
  type: 'number',
  required: false,
  placeholder: '依起迄自動試算（全日 09:00～17:30＝8 小時）',
};

for (const row of rows) {
  let fields = [];
  try {
    fields = JSON.parse(row.form_fields_json || '[]') || [];
  } catch {
    fields = [];
  }
  if (fields.some((f) => f.id === 'hours')) {
    console.log('skip has hours', row.id, row.name);
    continue;
  }
  const daysIdx = fields.findIndex((f) => f.id === 'days');
  if (daysIdx >= 0) {
    fields[daysIdx] = {
      ...fields[daysIdx],
      label: fields[daysIdx].label || '天數',
      placeholder: '全日 09:00～17:30＝1 日',
    };
    fields.splice(daysIdx + 1, 0, hoursField);
  } else {
    fields.push(hoursField);
  }
  db.prepare(
    `UPDATE workflows SET form_fields_json = ?, updated_at = datetime('now','localtime') WHERE id = ?`
  ).run(JSON.stringify(fields), row.id);
  console.log('updated', row.id, row.name, 'fields=', fields.map((f) => f.id).join(','));
}

console.log('OK', dbPath);
db.close();
