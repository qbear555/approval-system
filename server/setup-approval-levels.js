/**
 * 設定所有表單的簽核層級
 * 標準：申請人 → 代理人 → 部門主管 → … → 人事／單位 → 副總經理 → 總經理
 * 執行：node server/setup-approval-levels.js
 */
const db = require('./db');
const { hashPassword } = require('./auth');

function ensureUser({ username, password, name, department, role = 'user' }) {
  const find = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (find) {
    db.prepare(
      `UPDATE users SET name = ?, department = ?, password_hash = ?, role = ?, active = 1 WHERE username = ?`
    ).run(name, department, hashPassword(password), role, username);
    console.log(`帳號更新：${username} ${name}`);
    return find.id;
  }
  const r = db
    .prepare(
      `INSERT INTO users (username, password_hash, name, email, department, role)
       VALUES (?, ?, ?, NULL, ?, ?)`
    )
    .run(username, hashPassword(password), name, department, role);
  console.log(`帳號建立：${username} ${name} id=${r.lastInsertRowid}`);
  return Number(r.lastInsertRowid);
}

// 副總／總經職稱帳號（可於流程中改指定其他人）
const vgmId = ensureUser({
  username: 'chenmc',
  password: 'pass1234',
  name: '陳牧晨',
  department: '管理部',
});
const gmId = ensureUser({
  username: 'chenmy',
  password: 'pass1234',
  name: '陳明耀',
  department: '管理部',
});
// 相容舊占位帳號
try {
  for (const [user, keepId] of [
    ['vgm', vgmId],
    ['gm', gmId],
  ]) {
    const legacy = db.prepare(`SELECT id FROM users WHERE username = ?`).get(user);
    if (legacy && legacy.id !== keepId) {
      db.prepare(`UPDATE users SET active = 0 WHERE id = ?`).run(legacy.id);
    }
  }
} catch {
  /* ignore */
}

function agentField(required = true) {
  return {
    id: 'agent',
    label: '代理人',
    type: 'user',
    required,
    placeholder: '請選擇代理人',
  };
}

const STEP = {
  agent: {
    name: '代理人',
    assignType: 'form_user',
    formFieldId: 'agent',
    department: '',
    approverIds: [],
    mode: 'any',
  },
  deptHead: {
    name: '部門主管',
    assignType: 'dept_head',
    formFieldId: 'agent',
    department: '',
    approverIds: [],
    mode: 'any',
  },
  hr: {
    name: '人事單位',
    assignType: 'department',
    formFieldId: 'agent',
    department: '人事單位',
    approverIds: [],
    mode: 'any',
  },
  purchase: {
    name: '採購單位',
    assignType: 'department',
    formFieldId: 'agent',
    department: '採購部',
    approverIds: [],
    mode: 'any',
  },
  finance: {
    name: '財務單位',
    assignType: 'department',
    formFieldId: 'agent',
    department: '財務部',
    approverIds: [],
    mode: 'any',
  },
  management: {
    name: '管理部',
    assignType: 'department',
    formFieldId: 'agent',
    department: '管理部',
    approverIds: [],
    mode: 'any',
  },
  vgm: {
    name: '副總經理',
    assignType: 'users',
    formFieldId: 'agent',
    department: '',
    approverIds: [vgmId],
    mode: 'any',
  },
  gm: {
    name: '總經理',
    assignType: 'users',
    formFieldId: 'agent',
    department: '',
    approverIds: [gmId],
    mode: 'any',
  },
};

/** 最終高階核准：副總 → 總經 */
const TOP = [STEP.vgm, STEP.gm];

function renumber(steps) {
  return steps.map((s, i) => ({ ...s, order: i + 1 }));
}

function upsertWorkflow({ name, description, steps, formFields }) {
  const existing = db.prepare(`SELECT id FROM workflows WHERE name = ?`).get(name);
  const stepsJson = JSON.stringify(renumber(steps));
  const fieldsJson = JSON.stringify(formFields);
  if (existing) {
    db.prepare(
      `UPDATE workflows
       SET description = ?, steps_json = ?, form_fields_json = ?, active = 1,
           updated_at = datetime('now', 'localtime')
       WHERE id = ?`
    ).run(description, stepsJson, fieldsJson, existing.id);
    console.log(`已更新 #${existing.id} ${name}`);
    return existing.id;
  }
  const r = db
    .prepare(
      `INSERT INTO workflows (name, description, created_by, steps_json, form_fields_json, active)
       VALUES (?, ?, 1, ?, ?, 1)`
    )
    .run(name, description, stepsJson, fieldsJson);
  console.log(`已建立 #${r.lastInsertRowid} ${name}`);
  return r.lastInsertRowid;
}

db.prepare(
  `UPDATE workflows SET active = 0, updated_at = datetime('now', 'localtime')
   WHERE name IN ('1111', '222', '請假申請表')`
).run();

// 請假：申請人 → 代理人 → 人事 → 副總 → 總經（部門主管非必填，不列入）
upsertWorkflow({
  name: '請假申請',
  description: '申請人 → 代理人 → 人事單位 → 副總經理 → 總經理（部門主管非必填）',
  steps: [STEP.agent, STEP.hr, ...TOP],
  formFields: [
    agentField(true),
    {
      id: 'leave_type',
      label: '假別',
      type: 'select',
      required: true,
      placeholder: '',
      options: ['事假', '病假', '特休', '公假', '婚假', '喪假'],
    },
    {
      id: 'start_date',
      label: '起始日／時間',
      type: 'datetime',
      required: true,
      placeholder: '日期 + 時間（30 分鐘）',
    },
    {
      id: 'end_date',
      label: '結束日／時間',
      type: 'datetime',
      required: true,
      placeholder: '日期 + 時間（30 分鐘）',
    },
    { id: 'days', label: '天數', type: 'number', required: true, placeholder: '可依起迄時間自動試算' },
    { id: 'reason', label: '事由', type: 'textarea', required: false, placeholder: '' },
    { id: 'agree', label: '已告知代理人', type: 'checkbox', required: true, placeholder: '' },
  ],
});

// 出差：不需要代理人；部門主管非必填
upsertWorkflow({
  name: '出差申請',
  description: '申請人 → 人事單位 → 副總經理 → 總經理（部門主管非必填）',
  steps: [STEP.hr, ...TOP],
  formFields: [
    { id: 'destination', label: '出差地點', type: 'text', required: true, placeholder: '' },
    {
      id: 'start_date',
      label: '起始日／時間',
      type: 'datetime',
      required: true,
      placeholder: '日期 + 時間（30 分鐘）',
    },
    {
      id: 'end_date',
      label: '結束日／時間',
      type: 'datetime',
      required: true,
      placeholder: '日期 + 時間（30 分鐘）',
    },
    { id: 'purpose', label: '出差事由', type: 'textarea', required: true, placeholder: '' },
    { id: 'budget', label: '預估費用', type: 'number', required: false, placeholder: '' },
  ],
});

// 請購：不需要代理人；部門主管非必填
upsertWorkflow({
  name: '請購申請',
  description: '申請人 → 採購單位 → 財務單位 → 管理部 → 副總經理 → 總經理（部門主管非必填）',
  steps: [STEP.purchase, STEP.finance, STEP.management, ...TOP],
  formFields: [
    { id: 'item_name', label: '品名/項目', type: 'text', required: true, placeholder: '' },
    { id: 'qty', label: '數量', type: 'number', required: true, placeholder: '' },
    { id: 'amount', label: '預估金額', type: 'number', required: true, placeholder: '' },
    { id: 'vendor', label: '建議廠商', type: 'text', required: false, placeholder: '' },
    { id: 'reason', label: '請購事由', type: 'textarea', required: true, placeholder: '' },
    { id: 'need_date', label: '需用日期', type: 'date', required: false, placeholder: '' },
  ],
});

// 一般簽呈：不需要代理人；部門主管非必填
upsertWorkflow({
  name: '一般簽呈',
  description: '申請人 → 管理部 → 副總經理 → 總經理（部門主管非必填）',
  steps: [STEP.management, ...TOP],
  formFields: [
    { id: 'subject', label: '主旨說明', type: 'textarea', required: true, placeholder: '' },
    {
      id: 'category',
      label: '類別',
      type: 'select',
      required: true,
      placeholder: '',
      options: ['人事', '行政', '業務', '其他'],
    },
    { id: 'urgent', label: '急件', type: 'checkbox', required: false, placeholder: '' },
  ],
});

// 費用報支：不需要代理人；部門主管非必填
upsertWorkflow({
  name: '費用報支',
  description: '申請人 → 財務單位 → 管理部 → 副總經理 → 總經理（部門主管非必填）',
  steps: [STEP.finance, STEP.management, ...TOP],
  formFields: [
    {
      id: 'expense_type',
      label: '費用類別',
      type: 'select',
      required: true,
      placeholder: '',
      options: ['差旅', '交際', '辦公用品', '雜支', '其他'],
    },
    { id: 'amount', label: '金額', type: 'number', required: true, placeholder: '' },
    { id: 'expense_date', label: '發生日期', type: 'date', required: true, placeholder: '' },
    { id: 'desc', label: '費用說明', type: 'textarea', required: true, placeholder: '' },
  ],
});

console.log('\n=== 目前啟用中的簽核流程 ===');
for (const w of db
  .prepare(`SELECT id, name, description, steps_json FROM workflows WHERE active = 1 ORDER BY id`)
  .all()) {
  const steps = JSON.parse(w.steps_json);
  console.log(`\n#${w.id} ${w.name}`);
  console.log(`  ${w.description}`);
  console.log('  申請人送出');
  for (const s of steps) {
    let who = s.assignType;
    if (s.assignType === 'form_user') who = `表單「${s.formFieldId}」`;
    if (s.assignType === 'dept_head') who = '部門主管（自動）';
    if (s.assignType === 'department') who = `單位「${s.department}」`;
    if (s.assignType === 'users') {
      const names = (s.approverIds || [])
        .map((id) => db.prepare('SELECT name FROM users WHERE id=?').get(id)?.name || id)
        .join('、');
      who = `指定：${names}`;
    }
    console.log(`  → ${s.name}  [${who}]`);
  }
}

console.log('\n副總帳號 vgm / pass1234；總經帳號 gm / pass1234（可於流程編輯改指定人）');
console.log('完成。可在「簽核流程」自由新增／調整任何層級。');
