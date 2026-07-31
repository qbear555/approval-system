/**
 * 新增「延長工時申請」「電腦異常報修申請」流程與表單
 * 用法：node scripts/create-overtime-it-workflows.js [dbPath]
 */
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const dbPath = process.argv[2] || path.join(__dirname, '..', 'data', 'approval.db');
const db = new DatabaseSync(dbPath);

function getAdminId() {
  const a = db
    .prepare(`SELECT id FROM users WHERE role='admin' AND active=1 ORDER BY id LIMIT 1`)
    .get();
  return a?.id || 1;
}

function findUsersByUsernames(names) {
  const ids = [];
  for (const n of names) {
    const u = db
      .prepare(`SELECT id FROM users WHERE lower(username)=lower(?) AND active=1`)
      .get(n);
    if (u) ids.push(u.id);
  }
  return ids;
}

function upsertWorkflow({ name, description, formFields, steps }) {
  const adminId = getAdminId();
  const fieldsJson = JSON.stringify(formFields);
  const stepsJson = JSON.stringify(steps);
  const existing = db
    .prepare(
      `SELECT id FROM workflows WHERE name = ? AND IFNULL(purged,0)=0 ORDER BY id DESC LIMIT 1`
    )
    .get(name);
  if (existing) {
    db.prepare(
      `UPDATE workflows SET description=?, form_fields_json=?, steps_json=?, active=1,
       updated_at=datetime('now','localtime') WHERE id=?`
    ).run(description, fieldsJson, stepsJson, existing.id);
    console.log('updated', existing.id, name);
    return existing.id;
  }
  const info = db
    .prepare(
      `INSERT INTO workflows (name, description, created_by, steps_json, form_fields_json, active)
       VALUES (?, ?, ?, ?, ?, 1)`
    )
    .run(name, description, adminId, stepsJson, fieldsJson);
  console.log('created', info.lastInsertRowid, name);
  return Number(info.lastInsertRowid);
}

// 副總／總經理／人事（與現有請假流程對齊）
const vgmIds = findUsersByUsernames(['luis', 'danny']);
const gmIds = findUsersByUsernames(['martin']);
const hrIds = findUsersByUsernames(['claire', 'betty']);
// 管理部成員（電腦報修）
const mgmtIds = db
  .prepare(
    `SELECT DISTINCT u.id FROM users u
     WHERE u.active=1 AND (
       u.department='管理部'
       OR EXISTS (SELECT 1 FROM user_departments ud WHERE ud.user_id=u.id AND ud.department='管理部')
     )
     ORDER BY u.id`
  )
  .all()
  .map((r) => r.id);

console.log('vgm', vgmIds, 'gm', gmIds, 'hr', hrIds, 'mgmt', mgmtIds);

// ========== 延長工時申請 ==========
// 流程：申請人→部門主管→副總經理→人事單位核算→總經理
// （紙本中「申請人確認」與雙重簽核簡化為實務可執行路徑）
const overtimeFields = [
  {
    id: 'reason',
    label: '事由',
    type: 'textarea',
    required: true,
    placeholder: '請說明延長工時原因',
  },
  {
    id: 'ot_start',
    label: '延長工時開始',
    type: 'datetime',
    required: true,
    placeholder: '17:30～24:00，每 30 分鐘',
  },
  {
    id: 'ot_end',
    label: '延長工時結束',
    type: 'datetime',
    required: true,
    placeholder: '17:30～24:00，每 30 分鐘',
  },
  {
    id: 'hours',
    label: '申請時數（小時）',
    type: 'number',
    required: true,
    placeholder: '依起迄自動換算（最小 0.5 小時）',
  },
  {
    id: 'ot_option',
    label: '選擇項目',
    type: 'select',
    required: true,
    options: ['補休', '誤餐費', '其他'],
    placeholder: '',
  },
  {
    id: 'ot_option_other',
    label: '其他說明',
    type: 'text',
    required: false,
    placeholder: '選擇「其他」時請填寫',
  },
];

const overtimeHrFields = [
  {
    id: 'actual_start',
    label: '實際工時開始',
    type: 'datetime',
    required: true,
    placeholder: '17:30～24:00，每 30 分鐘',
  },
  {
    id: 'actual_end',
    label: '實際工時結束',
    type: 'datetime',
    required: true,
    placeholder: '17:30～24:00，每 30 分鐘',
  },
  {
    id: 'actual_hours',
    label: '實際總計（小時）',
    type: 'number',
    required: true,
    placeholder: '依起迄自動換算（最小 0.5 小時）',
  },
  {
    id: 'comp_leave_balance',
    label: '目前累計可用時數（補休）',
    type: 'number',
    required: false,
    placeholder: '補休累計（最多 40 小時）',
  },
  {
    id: 'hr_note',
    label: '人事備註',
    type: 'textarea',
    required: false,
    placeholder: '選填',
  },
];

const overtimeSteps = [
  {
    order: 1,
    name: '部門主管',
    assignType: 'dept_head',
    mode: 'any',
    formFieldId: 'agent',
    department: '',
    approverIds: [],
    approverFields: [],
  },
  {
    order: 2,
    name: '副總經理',
    assignType: 'users_pick',
    mode: 'any',
    formFieldId: '',
    department: '',
    approverIds: vgmIds.length ? vgmIds : [],
    approverFields: [],
  },
  {
    order: 3,
    name: '人事單位',
    assignType: 'users',
    mode: 'any',
    formFieldId: '',
    department: '管理部',
    approverIds: hrIds.length ? hrIds : mgmtIds,
    approverFields: overtimeHrFields,
  },
  {
    order: 4,
    name: '總經理',
    assignType: 'users',
    mode: 'any',
    formFieldId: '',
    department: '',
    approverIds: gmIds.length ? gmIds : [],
    approverFields: [],
  },
];

upsertWorkflow({
  name: '延長工時申請',
  description:
    '延長工時（加班）申請。誤餐費與補休僅可擇一；補休最多累計 40 小時且限一年內休完。流程：申請人→部門主管→副總經理→人事核算→總經理。',
  formFields: overtimeFields,
  steps: overtimeSteps,
});

// ========== 電腦異常報修申請 ==========
// 流程：申請人→管理部檢修→副總經理→總經理
const itFields = [
  {
    id: 'issue_desc',
    label: '設備異常說明',
    type: 'textarea',
    required: true,
    placeholder: '請描述異常現象、發生時間與影響',
  },
  {
    id: 'computer_spec',
    label: '電腦規格（申請人填寫）',
    type: 'textarea',
    required: false,
    placeholder: '型號、配備等（選填）',
  },
];

const itMgmtFields = [
  {
    id: 'pc_acquired_date',
    label: '原電腦取得日期',
    type: 'date',
    required: true,
    placeholder: '由管理部填寫',
  },
  {
    id: 'check_os',
    label: '作業系統（Windows10）',
    type: 'select',
    required: true,
    options: ['符合', '不符合'],
  },
  {
    id: 'check_memory',
    label: '記憶體（4G 以上）',
    type: 'select',
    required: true,
    options: ['符合', '不符合'],
  },
  {
    id: 'check_disk',
    label: '硬碟（SSD 500G 以上）',
    type: 'select',
    required: true,
    options: ['符合', '不符合'],
  },
  {
    id: 'check_3dmark',
    label: '3DMARK 分數（500 分以上）',
    type: 'select',
    required: true,
    options: ['符合', '不符合'],
  },
  {
    id: 'check_email',
    label: '電子郵件定期清理',
    type: 'select',
    required: true,
    options: ['符合', '不符合'],
  },
  {
    id: 'check_backup',
    label: '重要資料定期備份',
    type: 'select',
    required: true,
    options: ['符合', '不符合'],
  },
  {
    id: 'check_battery',
    label: '電池容量（70% 以下）',
    type: 'select',
    required: true,
    options: ['符合', '不符合'],
  },
  {
    id: 'handle_result',
    label: '電腦處理情形',
    type: 'select',
    required: true,
    options: [
      '升級部分零件，更換整備品相容零件，若無則需購置',
      '無法使用，購置新電腦',
      '其他',
    ],
  },
  {
    id: 'handle_note',
    label: '處理說明／其他',
    type: 'textarea',
    required: false,
    placeholder: '零件項目、估價、建議等',
  },
];

const itSteps = [
  {
    order: 1,
    name: '管理部檢修',
    assignType: mgmtIds.length ? 'users' : 'department',
    mode: 'any',
    formFieldId: '',
    department: '管理部',
    approverIds: mgmtIds,
    approverFields: itMgmtFields,
  },
  {
    order: 2,
    name: '副總經理',
    assignType: 'users_pick',
    mode: 'any',
    formFieldId: '',
    department: '',
    approverIds: vgmIds.length ? vgmIds : [],
    approverFields: [],
  },
  {
    order: 3,
    name: '總經理',
    assignType: 'users',
    mode: 'any',
    formFieldId: '',
    department: '',
    approverIds: gmIds.length ? gmIds : [],
    approverFields: [],
  },
];

upsertWorkflow({
  name: '電腦異常報修申請',
  description:
    '電腦異常報修申請。管理部依檢核標準（2024年3月核定）檢修後，陳核副總經理、總經理。流程：申請人→管理部檢修→副總經理→總經理。',
  formFields: itFields,
  steps: itSteps,
});

const list = db
  .prepare(
    `SELECT id, name, active FROM workflows WHERE IFNULL(purged,0)=0 ORDER BY id`
  )
  .all();
console.log('workflows now:');
for (const w of list) console.log(' ', w.id, w.active ? 'ON' : 'off', w.name);
db.close();
console.log('OK', dbPath);
