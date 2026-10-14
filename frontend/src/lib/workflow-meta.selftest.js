import {
  newFormField,
  describeStepForList,
  collectWorkflowDeptNames,
  shouldAutoSyncName,
  buildFlowPathText,
  viceGmApproverIds,
  gmApproverIds,
  isLeaveWorkflowName,
  suggestCreditFinanceNotify,
  finalNotifyListText,
} from './workflow-meta.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const f = newFormField();
assert(/^f_/.test(f.id) && f.type === 'text', 'newFormField');

assert(
  describeStepForList({ name: '代理人', assignType: 'form_user' }) === '代理人（表單指定）',
  'describe form_user'
);
assert(
  describeStepForList({ name: '財務部', assignType: 'department', department: '財務部' }) === '財務部（財務部）',
  'describe department'
);
assert(
  describeStepForList({ name: '指定', assignType: 'users', approverIds: [1] }, [{ id: 1, name: '王小明' }]) ===
    '指定（王小明）',
  'describe users'
);

const depts = collectWorkflowDeptNames({
  departments: [{ name: '財務部' }],
  users: [{ department: '資訊部', departments: ['管理部'] }],
  extra: ['採購部'],
});
assert(depts[0] === '人事單位', '人事單位 first');
assert(depts.includes('財務部') && depts.includes('資訊部') && depts.includes('管理部'), 'dept merge');

assert(shouldAutoSyncName(''), 'empty name sync');
assert(shouldAutoSyncName('申請人 → 部門主管'), 'path name sync');
assert(!shouldAutoSyncName('請假申請'), 'proper name keep');

assert(buildFlowPathText([{ name: '部門主管' }, { name: '總經理' }]) === '申請人 → 部門主管 → 總經理', 'path text');

assert(
  viceGmApproverIds([{ id: 1, name: '張副總', username: 'x' }, { id: 2, username: 'luis', name: 'L' }]).join(',') ===
    '1,2',
  'vice gm'
);
assert(gmApproverIds([{ id: 9, username: 'martin', name: 'M' }]).join(',') === '9', 'gm');

assert(isLeaveWorkflowName('請假申請'), 'leave name');
assert(suggestCreditFinanceNotify({ name: '信用額度申請' }), 'credit suggest');
assert(!suggestCreditFinanceNotify({ name: '信用額度申請', finalNotify: { enabled: false } }), 'credit already set');

assert(finalNotifyListText({ enabled: false }) === '關閉', 'fn off');
assert(finalNotifyListText({ enabled: true, userIds: [1, 2] }) === '通知 2 人／全部申請人', 'fn all');

console.log('workflow-meta selftest ok');
