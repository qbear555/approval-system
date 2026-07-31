/** 請假申請：起始／結束改為日期+時間（30 分鐘單位） */
const db = require('./db');

const w = db.prepare(`SELECT id, form_fields_json FROM workflows WHERE name = '請假申請'`).get();
if (!w) {
  console.error('找不到請假申請流程');
  process.exit(1);
}

let fields = [];
try {
  fields = JSON.parse(w.form_fields_json || '[]');
} catch {
  fields = [];
}

const byId = Object.fromEntries(fields.map((f) => [f.id, f]));

function upsertField(def) {
  if (byId[def.id]) {
    Object.assign(byId[def.id], def);
  } else {
    fields.push(def);
    byId[def.id] = def;
  }
}

upsertField({
  id: 'agent',
  label: '代理人',
  type: 'user',
  required: true,
  placeholder: '請選擇代理人',
});
upsertField({
  id: 'leave_type',
  label: '假別',
  type: 'select',
  required: true,
  placeholder: '',
  options: ['事假', '病假', '特休', '公假', '婚假', '喪假'],
});
upsertField({
  id: 'start_date',
  label: '起始日／時間',
  type: 'datetime',
  required: true,
  placeholder: '日期 + 時間（30 分鐘）',
});
upsertField({
  id: 'end_date',
  label: '結束日／時間',
  type: 'datetime',
  required: true,
  placeholder: '日期 + 時間（30 分鐘）',
});
upsertField({
  id: 'days',
  label: '天數',
  type: 'number',
  required: true,
  placeholder: '可依起迄時間自動試算',
});
upsertField({
  id: 'reason',
  label: '事由',
  type: 'textarea',
  required: false,
  placeholder: '',
});
upsertField({
  id: 'agree',
  label: '已告知代理人',
  type: 'checkbox',
  required: true,
  placeholder: '',
});

// 依固定順序輸出
const order = ['agent', 'leave_type', 'start_date', 'end_date', 'days', 'reason', 'agree'];
const ordered = order.map((id) => byId[id]).filter(Boolean);

db.prepare(
  `UPDATE workflows SET form_fields_json = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`
).run(JSON.stringify(ordered), w.id);

console.log('已更新請假申請表單欄位：');
ordered.forEach((f) => console.log(`  - ${f.label} (${f.type})`));
