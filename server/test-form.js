/** Quick API smoke test for custom form fields */
const base = 'http://localhost:3847';

async function main() {
  const loginRes = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  const login = await loginRes.json();
  if (!login.token) throw new Error('login failed: ' + JSON.stringify(login));
  const h = {
    Authorization: `Bearer ${login.token}`,
    'Content-Type': 'application/json',
  };

  const usersRes = await fetch(`${base}/api/users`, { headers: h });
  const { users } = await usersRes.json();
  const approver = users.find((u) => u.username === 'tsuming') || users[0];

  const wfRes = await fetch(`${base}/api/workflows`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({
      name: '請假申請表',
      description: '含自訂表單',
      steps: [{ name: '主管審核', approverIds: [approver.id], mode: 'any' }],
      formFields: [
        { id: 'leave_type', label: '假別', type: 'select', required: true, options: ['事假', '病假', '特休'] },
        { id: 'start_date', label: '起始日', type: 'date', required: true },
        { id: 'days', label: '天數', type: 'number', required: true },
        { id: 'reason', label: '事由', type: 'textarea', required: false },
        { id: 'agree', label: '已告知代理人', type: 'checkbox', required: true },
      ],
    }),
  });
  const wfBody = await wfRes.json();
  if (!wfRes.ok) throw new Error('wf create: ' + JSON.stringify(wfBody));
  console.log('workflow ok', wfBody.workflow.id, 'fields', wfBody.workflow.formFields.length);

  // missing required -> fail
  const bad = await fetch(`${base}/api/requests`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({
      workflow_id: wfBody.workflow.id,
      title: '測試缺欄位',
      content: '',
      form_data: { leave_type: '事假' },
    }),
  });
  const badBody = await bad.json();
  console.log('validation', bad.status, badBody.error);

  const ok = await fetch(`${base}/api/requests`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({
      workflow_id: wfBody.workflow.id,
      title: '7/25 特休一天',
      content: '家庭事務',
      form_data: {
        leave_type: '特休',
        start_date: '2026-07-25',
        days: '1',
        reason: '家庭事務',
        agree: true,
      },
    }),
  });
  const okBody = await ok.json();
  if (!ok.ok) throw new Error('request: ' + JSON.stringify(okBody));
  console.log('request ok', okBody.request.id);
  console.log(
    'formFields labels',
    okBody.request.formFields.map((f) => f.label).join(', ')
  );
  console.log('form_data', JSON.stringify(okBody.request.form_data));
  console.log('ALL GOOD');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
