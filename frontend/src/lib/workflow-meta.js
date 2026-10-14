/**
 * 簽核流程編輯器共用常數與純函式（對齊經典 pages-workflows.js）。
 */

export const ASSIGN_TYPE_LABEL = {
  users: '指定人員',
  form_user: '表單人員（如代理人）',
  dept_head: '部門主管（申請人自選／可略過）',
  department: '指定單位／部門',
  users_pick: '申請人自選（可多位勾選）',
  cosign_pick: '會簽人員（申請人可多位勾選，非必填）',
};

export const FIELD_TYPE_LABEL = {
  text: '單行文字',
  textarea: '多行文字',
  number: '數字',
  date: '日期',
  datetime: '日期時間（30分）',
  select: '下拉選單',
  checkbox: '核取方塊',
  user: '人員選擇',
  table: '明細表',
};

export const PDF_LAYOUT_OPTIONS = [
  { type: 'auto', label: '依流程名稱自動判斷' },
  { type: 'canvas_objects', label: '🧩 可編輯畫布版面（表格／文字物件）' },
  { type: 'pdf_template', label: '📄 紙本底圖套印版面（畫布拖拉設計）' },
  { type: 'leave', label: '請假單版面' },
  { type: 'credit_limit', label: '信用額度申請表版面' },
  { type: 'welfare', label: '福利金明細月報表版面' },
  { type: 'purchase', label: '請購申請版面' },
  { type: 'expense', label: '費用報支版面' },
  { type: 'travel', label: '出差申請版面' },
  { type: 'it_repair', label: '電腦異常報修版面' },
  { type: 'overtime', label: '延長工時版面' },
  { type: 'dept_meeting', label: '會議記錄版面' },
  { type: 'general', label: '一般簽呈版面' },
];

export const BUILTIN_PDF_TYPES = [
  'leave',
  'credit_limit',
  'welfare',
  'purchase',
  'expense',
  'travel',
  'it_repair',
  'overtime',
  'dept_meeting',
  'general',
];

export const DEFAULT_CATEGORIES = ['人事差勤', '財務採購', '資訊總務', '業務行政', '一般簽呈'];

export function newFormField() {
  return {
    id: `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    label: '',
    type: 'text',
    required: false,
    placeholder: '',
    options: [],
    optionsText: '',
  };
}

export function parseJsonField(raw, fallback) {
  if (raw == null || raw === '') return fallback;
  if (Array.isArray(raw) || (typeof raw === 'object' && !Array.isArray(raw))) return raw;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

export function workflowFormFields(wf) {
  return parseJsonField(wf?.formFields ?? wf?.form_fields, []) || [];
}

export function workflowSteps(wf) {
  return parseJsonField(wf?.steps, []) || [];
}

export function cloneSteps(workflow) {
  const raw = workflowSteps(workflow);
  if (raw && raw.length) {
    return JSON.parse(JSON.stringify(raw)).map((s) => ({
      assignType: 'users',
      formFieldId: 'agent',
      department: '',
      approverIds: [],
      mode: 'any',
      skipIfNoApprover: false,
      approverFields: [],
      ...s,
      approverIds: Array.isArray(s.approverIds) ? s.approverIds.map(Number).filter(Boolean) : [],
    }));
  }
  return [
    {
      name: '部門主管',
      assignType: 'dept_head',
      formFieldId: '',
      department: '',
      approverIds: [],
      mode: 'any',
      skipIfNoApprover: false,
      approverFields: [],
    },
  ];
}

export function cloneFormFields(workflow) {
  const raw = workflowFormFields(workflow);
  if (!raw.length) return [];
  return JSON.parse(JSON.stringify(raw)).map((f) => ({
    ...f,
    options: Array.isArray(f.options) ? f.options : [],
    optionsText: Array.isArray(f.options) ? f.options.join('\n') : String(f.optionsText || ''),
  }));
}

export function clonePdfLayout(workflow) {
  if (workflow?.pdfLayout) return JSON.parse(JSON.stringify(workflow.pdfLayout));
  return { type: 'auto' };
}

export function defaultFinalNotify() {
  return {
    enabled: false,
    userIds: [],
    applicantMode: 'all',
    applicantUserIds: [],
    label: '最終核准完成通知',
  };
}

export function isLeaveWorkflowName(name) {
  return /請假|休假|leave/i.test(String(name || ''));
}

export function suggestCreditFinanceNotify(workflow) {
  return (
    !workflow?.finalNotify &&
    /信用額度|授信額度|額度申請/i.test(String(workflow?.name || ''))
  );
}

export function isFinanceLikeUser(u) {
  return (
    /財務|會計|授信/.test(String(u?.department || '')) ||
    /財務|會計/.test(String(u?.name || ''))
  );
}

export function userLabelById(id, users = []) {
  const u = (users || []).find((x) => Number(x.id) === Number(id));
  return u ? u.name : `#${id}`;
}

export function describeStepForList(s, users = []) {
  if (!s) return '';
  if (s.assignType === 'form_user') return `${s.name}（表單指定）`;
  if (s.assignType === 'dept_head') return `${s.name}（自選／可略過）`;
  if (s.assignType === 'cosign_pick') return `${s.name}（會簽選填）`;
  if (s.assignType === 'users_pick') return `${s.name}（申請人自選）`;
  if (s.assignType === 'department') return `${s.name}（${s.department || '單位'}）`;
  if (s.assignType === 'users' || (s.approverIds && s.approverIds.length)) {
    const names = (s.approverIds || []).map((id) => userLabelById(id, users)).join('、');
    return names ? `${s.name}（${names}）` : s.name;
  }
  return s.name;
}

export function collectWorkflowDeptNames({ departments = [], users = [], extra = [] } = {}) {
  const fromApi = (departments || [])
    .map((d) => (d && typeof d === 'object' ? d.name : d))
    .map((n) => String(n || '').trim())
    .filter(Boolean);
  const fromUsers = (users || [])
    .flatMap((u) => {
      const list = Array.isArray(u.departments) ? u.departments.slice() : [];
      if (u.department) list.push(u.department);
      return list;
    })
    .map((n) => String(n || '').trim())
    .filter(Boolean);
  const extraNames = (Array.isArray(extra) ? extra : [])
    .map((n) => String(n || '').trim())
    .filter(Boolean);
  return [...new Set(['人事單位', ...fromApi, ...fromUsers, ...extraNames])];
}

export function viceGmApproverIds(users = []) {
  return (users || [])
    .filter(
      (u) =>
        /副總/.test(String(u.department || '')) ||
        /副總/.test(String(u.name || '')) ||
        ['luis', 'danny'].includes(String(u.username || '').toLowerCase())
    )
    .map((u) => u.id);
}

export function gmApproverIds(users = []) {
  return (users || [])
    .filter(
      (u) =>
        /總經理/.test(String(u.department || '')) ||
        /總經理/.test(String(u.name || '')) ||
        String(u.username || '').toLowerCase() === 'martin'
    )
    .map((u) => u.id);
}

export function buildStepPresets(deptNames = []) {
  const base = [
    {
      label: '代理人',
      ensureAgentField: true,
      step: {
        name: '代理人',
        assignType: 'form_user',
        formFieldId: 'agent',
        department: '',
        approverIds: [],
        mode: 'any',
      },
    },
    {
      label: '部門主管',
      step: {
        name: '部門主管',
        assignType: 'dept_head',
        formFieldId: 'agent',
        department: '',
        approverIds: [],
        mode: 'any',
      },
    },
    {
      label: '人事單位',
      step: {
        name: '人事單位',
        assignType: 'department',
        formFieldId: 'agent',
        department: '人事單位',
        approverIds: [],
        mode: 'any',
      },
    },
    {
      label: '採購單位',
      step: {
        name: '採購單位',
        assignType: 'department',
        formFieldId: 'agent',
        department: '採購部',
        approverIds: [],
        mode: 'any',
      },
    },
    {
      label: '財務單位',
      step: {
        name: '財務單位',
        assignType: 'department',
        formFieldId: 'agent',
        department: '財務部',
        approverIds: [],
        mode: 'any',
      },
    },
    {
      label: '管理部',
      step: {
        name: '管理部',
        assignType: 'department',
        formFieldId: 'agent',
        department: '管理部',
        approverIds: [],
        mode: 'any',
      },
    },
    {
      label: '會簽人員（選填）',
      step: {
        name: '會簽人員',
        assignType: 'cosign_pick',
        formFieldId: '',
        department: '',
        approverIds: [],
        mode: 'any',
      },
    },
    {
      label: '副總經理（申請人自選）',
      resolveApproverIds: 'viceGm',
      step: {
        name: '副總經理',
        assignType: 'users_pick',
        formFieldId: 'agent',
        department: '',
        approverIds: [],
        mode: 'any',
      },
    },
    {
      label: '總經理',
      resolveApproverIds: 'gm',
      step: {
        name: '總經理',
        assignType: 'users',
        formFieldId: 'agent',
        department: '',
        approverIds: [],
        mode: 'any',
      },
    },
    {
      label: '指定人員',
      step: {
        name: '指定簽核',
        assignType: 'users',
        formFieldId: 'agent',
        department: '',
        approverIds: [],
        mode: 'any',
      },
    },
  ];

  const presetDeptSet = new Set(
    base.filter((p) => p.step.assignType === 'department').map((p) => p.step.department)
  );
  const extraDeptPresets = (deptNames || [])
    .filter((name) => name && name !== '人事單位' && !presetDeptSet.has(name))
    .sort((a, b) => String(a).localeCompare(String(b), 'zh-Hant'))
    .map((name) => ({
      label: name,
      step: {
        name,
        assignType: 'department',
        formFieldId: 'agent',
        department: name,
        approverIds: [],
        mode: 'any',
      },
    }));
  const insertAt = base.findIndex((p) => p.label === '會簽人員（選填）');
  if (insertAt >= 0) base.splice(insertAt, 0, ...extraDeptPresets);
  else base.push(...extraDeptPresets);
  return base;
}

export function resolvePresetStep(preset, users = []) {
  const step = JSON.parse(JSON.stringify(preset.step));
  if (preset.resolveApproverIds === 'viceGm') step.approverIds = viceGmApproverIds(users);
  if (preset.resolveApproverIds === 'gm') step.approverIds = gmApproverIds(users);
  return step;
}

export function buildFlowPathText(steps = []) {
  const names = (steps || []).map((s) => String(s.name || '').trim()).filter(Boolean);
  return names.length ? `申請人 → ${names.join(' → ')}` : '申請人';
}

export function shouldAutoSyncName(name) {
  const cur = String(name || '').trim();
  return !cur || cur.startsWith('申請人') || cur.includes(' → ');
}

export function pdfLayoutListLabel(pl = {}) {
  const type = pl.type || 'auto';
  const opt = PDF_LAYOUT_OPTIONS.find((o) => o.type === type);
  const label = pl.label || opt?.label || type || '自動';
  const resolved =
    type === 'auto' && pl.resolvedType ? `（${pl.resolvedType}）` : '';
  return { label, resolved, type };
}

export function finalNotifyListText(fn = {}) {
  if (!fn.enabled) return '關閉';
  const recv = (fn.userIds || fn.users || []).length;
  const mode = fn.applicantMode === 'selected' ? 'selected' : 'all';
  const appN = (fn.applicantUserIds || fn.applicants || []).length;
  return `通知 ${recv} 人${mode === 'selected' ? `／限 ${appN} 位申請人` : '／全部申請人'}`;
}

export function formatTaiwanDateOnly(d = new Date()) {
  const date = d instanceof Date ? d : new Date(d);
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function safeFilename(name, fallback = 'workflow') {
  return String(name || fallback).replace(/[<>:"/\\|?*]/g, '_');
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function collectKnownCategories(workflows = [], current = '') {
  return Array.from(
    new Set([...DEFAULT_CATEGORIES, ...(workflows || []).map((w) => w.category).filter(Boolean), current].filter(Boolean))
  );
}

export function flowOpSymbol(op) {
  return (
    {
      '>=': '≥',
      '>': '>',
      '<=': '≤',
      '<': '<',
      '==': '=',
      '!=': '≠',
      contains: '包含',
      not_contains: '不包含',
    }[op] || op
  );
}

export function stepAssignLabel(s) {
  if (!s) return '';
  if (s.assignType === 'form_user') return `表單：${s.formFieldId || 'agent'}`;
  if (s.assignType === 'dept_head') return '自選成員／可略過';
  if (s.assignType === 'department') return `單位：${s.department || '—'}`;
  if (s.assignType === 'users_pick') {
    const n = (s.approverIds || []).length;
    const opt = s.skipIfNoApprover ? '選填可略過' : '必填';
    return n ? `申請人自選（${n} 位・${opt}）` : `申請人自選（${opt}）`;
  }
  if (s.assignType === 'cosign_pick') return '會簽（選填）';
  const n = (s.approverIds || []).length;
  return n ? `指定 ${n} 人` : '指定人員';
}
