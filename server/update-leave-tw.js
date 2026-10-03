/**
 * 更新請假申請：
 * - 假別依台灣勞基法／性別工作平等法
 * - 人事單位步驟可填剩餘特休
 * - 步驟指定人員可於流程編輯器增刪
 */
const db = require('./db');

const TW_LEAVE_TYPES = [
  '特別休假（特休）',
  '事假',
  '普通傷病假（病假）',
  '住院傷病假',
  '公傷病假',
  '婚假',
  '喪假',
  '產假',
  '產檢假',
  '安胎休養',
  '陪產檢及陪產假',
  '生理假',
  '家庭照顧假',
  '公假',
  '補休',
  '其他',
];

const HR_FIELDS = [
  {
    id: 'hr_leave_type',
    label: '假別（人事核定）',
    type: 'select',
    required: true,
    placeholder: '',
    options: TW_LEAVE_TYPES,
  },
  {
    id: 'remaining_special_leave_days',
    label: '剩餘特休日數',
    type: 'number',
    required: true,
    placeholder: '例如：7 或 7.5',
  },
  {
    id: 'remaining_special_leave_hours',
    label: '剩餘特休小時',
    type: 'number',
    required: true,
    placeholder: '0～8，可填 0.5 小時',
  },
  {
    id: 'leave_month_days',
    label: '本月累計日數',
    type: 'number',
    required: false,
    placeholder: '本月已請假天數（含本次）',
  },
  {
    id: 'leave_month_hours',
    label: '本月累計時數',
    type: 'number',
    required: false,
    placeholder: '不足一日之小時（可 0.5）',
  },
  {
    id: 'leave_year_days',
    label: '本年累計日數',
    type: 'number',
    required: false,
    placeholder: '本年已請假天數（含本次）',
  },
  {
    id: 'leave_year_hours',
    label: '本年累計時數',
    type: 'number',
    required: false,
    placeholder: '不足一日之小時（可 0.5）',
  },
  {
    id: 'hr_note',
    label: '人事備註',
    type: 'textarea',
    required: false,
    placeholder: '選填',
  },
];

const formFields = [
  {
    id: 'agent',
    label: '代理人',
    type: 'user',
    required: true,
    placeholder: '請選擇代理人',
  },
  {
    id: 'leave_type',
    label: '假別',
    type: 'select',
    required: true,
    placeholder: '',
    options: TW_LEAVE_TYPES,
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
  {
    id: 'days',
    label: '天數',
    type: 'number',
    required: true,
    placeholder: '可依起迄時間自動試算',
  },
  {
    id: 'reason',
    label: '事由',
    type: 'textarea',
    required: false,
    placeholder: '',
  },
  {
    id: 'agree',
    label: '已告知代理人',
    type: 'checkbox',
    required: true,
    placeholder: '',
  },
];

// 載入現有步驟，保留指定人員設定，為人事單位加上 approverFields
const w = db.prepare(`SELECT id, steps_json FROM workflows WHERE name = '請假申請' AND IFNULL(purged,0)=0`).get();
if (!w) {
  console.error('找不到請假申請流程');
  process.exit(1);
}

let steps = [];
try {
  steps = JSON.parse(w.steps_json || '[]');
} catch {
  steps = [];
}

if (!steps.length) {
  steps = [
    {
      order: 1,
      name: '代理人',
      assignType: 'form_user',
      formFieldId: 'agent',
      department: '',
      approverIds: [],
      mode: 'any',
      approverFields: [],
    },
    {
      order: 2,
      name: '人事單位',
      assignType: 'department',
      formFieldId: 'agent',
      department: '人事單位',
      approverIds: [],
      mode: 'any',
      approverFields: HR_FIELDS,
    },
    {
      order: 3,
      name: '副總經理',
      assignType: 'users',
      formFieldId: 'agent',
      department: '',
      approverIds: [],
      mode: 'any',
      approverFields: [],
    },
    {
      order: 4,
      name: '總經理',
      assignType: 'users',
      formFieldId: 'agent',
      department: '',
      approverIds: [],
      mode: 'any',
      approverFields: [],
    },
  ];
} else {
  // 部門主管非必填：從模板移除
  steps = steps.filter(
    (s) => s.assignType !== 'dept_head' && !(s.name || '').includes('部門主管')
  );
  steps = steps.map((s, i) => {
    const name = s.name || '';
    const isHr =
      name.includes('人事') ||
      s.department === '人事單位' ||
      s.department === '人事' ||
      s.department === '人資';
    return {
      ...s,
      order: i + 1,
      approverFields: isHr ? HR_FIELDS : s.approverFields || [],
    };
  });
  // 若沒有人事步驟，插入在副總前或最後
  const hasHr = steps.some(
    (s) =>
      (s.name || '').includes('人事') ||
      s.department === '人事單位' ||
      s.department === '人事'
  );
  if (!hasHr) {
    const insertAt = Math.max(0, steps.findIndex((s) => (s.name || '').includes('副總')));
    const idx = insertAt >= 0 ? insertAt : steps.length;
    steps.splice(idx, 0, {
      order: idx + 1,
      name: '人事單位',
      assignType: 'department',
      formFieldId: 'agent',
      department: '人事單位',
      approverIds: [],
      mode: 'any',
      approverFields: HR_FIELDS,
    });
    steps = steps.map((s, i) => ({ ...s, order: i + 1 }));
  }
}

db.prepare(
  `UPDATE workflows
   SET form_fields_json = ?,
       steps_json = ?,
       description = ?,
       updated_at = datetime('now', 'localtime')
   WHERE id = ?`
).run(
  JSON.stringify(formFields),
  JSON.stringify(steps),
  '申請人 → 代理人 → 人事單位（填假別／剩餘特休）→ 副總 → 總經；假別依勞基法；部門主管非必填',
  w.id
);

console.log('已更新請假申請 #', w.id);
console.log('假別選項:', TW_LEAVE_TYPES.join('、'));
console.log(
  '步驟:',
  steps.map((s) => `${s.order}.${s.name}(指定類型:${s.assignType}, 簽核表單:${(s.approverFields || []).length})`).join(' | ')
);
