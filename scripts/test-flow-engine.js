/**
 * 簽核流程引擎回歸測試（本機）
 *
 * 用法：
 *   1. 先啟動本機服務：npm run dev
 *   2. node scripts/test-flow-engine.js
 *
 * 測試會自行建立帳號／流程／申請單，結束後全部清除。
 * 僅適用開發環境，請勿對正式資料庫執行。
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const db = require(path.join(ROOT, 'server', 'db'));
const { hashPassword } = require(path.join(ROOT, 'server', 'auth'));

const BASE = process.env.TEST_BASE || 'http://127.0.0.1:3847';
const PREFIX = '__flowtest__';
// LIKE 中 _ 是萬用字元，DELETE 前必須跳脫，否則比對範圍會超出預期
const likePrefix = () => PREFIX.replace(/_/g, '\\_') + '%';
const PW = 'FlowTest!2026';

let pass = 0;
let fail = 0;
const failures = [];

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    pass++;
    console.log(`    ✅ ${label}`);
  } else {
    fail++;
    failures.push(`${label}：預期 ${JSON.stringify(expected)}，實際 ${JSON.stringify(actual)}`);
    console.log(`    ❌ ${label}  預期 ${JSON.stringify(expected)}，實際 ${JSON.stringify(actual)}`);
  }
}

async function api(pathname, opts = {}, token) {
  const r = await fetch(BASE + pathname, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(opts.headers || {}),
    },
  });
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!r.ok) throw new Error(`${pathname} → HTTP ${r.status}: ${text.slice(0, 300)}`);
  return json;
}

function mkUser(suffix, name, role = 'user') {
  const username = PREFIX + suffix;
  db.prepare('DELETE FROM users WHERE username = ?').run(username);
  const r = db
    .prepare(
      `INSERT INTO users (username, password_hash, name, email, department, role)
       VALUES (?, ?, ?, NULL, '管理部', ?)`
    )
    .run(username, hashPassword(PW), name, role);
  return { id: Number(r.lastInsertRowid), username };
}

const login = async (username) =>
  (await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password: PW }) }))
    .token;

function cleanup() {
  const ids = db
    .prepare(`SELECT id FROM approval_requests WHERE title LIKE ? ESCAPE '\\'`)
    .all(likePrefix())
    .map((r) => r.id);
  for (const id of ids) {
    db.prepare('DELETE FROM approval_actions WHERE request_id = ?').run(id);
    db.prepare('DELETE FROM request_attachments WHERE request_id = ?').run(id);
    try {
      db.prepare('DELETE FROM request_node_states WHERE request_id = ?').run(id);
    } catch {
      /* Phase 1 之前沒有這張表 */
    }
    db.prepare('DELETE FROM approval_requests WHERE id = ?').run(id);
  }
  db.prepare(`DELETE FROM workflows WHERE name LIKE ? ESCAPE '\\'`).run(likePrefix());
  db.prepare(`DELETE FROM users WHERE username LIKE ? ESCAPE '\\'`).run(likePrefix());
  return ids.length;
}

/** 建流程 → 送單 → 依序核准，回傳過程狀態 */
async function runScenario({ label, steps, formFields, formData, approvals }) {
  console.log(`\n  ${label}`);
  const admin = mkUser('_admin', '測試管理', 'admin');
  const actors = {};
  for (const s of steps) {
    for (const key of s._actorKeys || []) {
      if (!actors[key]) actors[key] = mkUser('_' + key, '簽核人' + key);
    }
  }
  const realSteps = steps.map((s) => {
    const { _actorKeys, ...rest } = s;
    return { ...rest, approverIds: (_actorKeys || []).map((k) => actors[k].id) };
  });

  const token = await login(admin.username);
  const wf = await api(
    '/api/workflows',
    {
      method: 'POST',
      body: JSON.stringify({ name: PREFIX + label, description: '測試', steps: realSteps, formFields }),
    },
    token
  );
  const wfId = wf.workflow?.id || wf.id;

  const sub = await api(
    '/api/requests',
    {
      method: 'POST',
      body: JSON.stringify({
        workflow_id: wfId,
        title: PREFIX + label,
        content: '測試',
        form_data: formData,
      }),
    },
    token
  );
  const reqId = sub.request?.id || sub.id;

  const trace = [];
  const snap = () => db.prepare('SELECT current_step, status FROM approval_requests WHERE id = ?').get(reqId);
  trace.push({ at: '送出後', ...snap() });

  for (const key of approvals || []) {
    const t = await login(actors[key].username);
    await api(
      `/api/requests/${reqId}/action`,
      { method: 'POST', body: JSON.stringify({ action: 'approve', comment: '同意' }) },
      t
    );
    trace.push({ at: `${key} 核准後`, ...snap() });
  }

  const acts = db
    .prepare('SELECT step_order, action FROM approval_actions WHERE request_id = ? ORDER BY id')
    .all(reqId);
  return { reqId, trace, acts, skipped: acts.filter((a) => a.action === 'system').map((a) => a.step_order) };
}

(async () => {
  console.log('簽核流程引擎回歸測試');
  console.log('='.repeat(58));
  cleanup();

  try {
    const amountField = [{ id: 'amount', label: '金額', type: 'number', required: true }];
    const condStep = (action, value = '100000') => ({
      enabled: true,
      fieldId: 'amount',
      operator: '>=',
      value,
      action,
    });

    console.log('\n[1] 條件式分支：action=require');
    {
      const steps = [
        { order: 1, name: '一', assignType: 'users', mode: 'any', _actorKeys: ['a1'] },
        { order: 2, name: '財務', assignType: 'users', mode: 'any', _actorKeys: ['a2'], condition: condStep('require') },
        { order: 3, name: '總', assignType: 'users', mode: 'any', _actorKeys: ['a3'] },
      ];
      const low = await runScenario({
        label: '1a_require_未達門檻', steps, formFields: amountField,
        formData: { amount: 50000 }, approvals: ['a1'],
      });
      check('未達門檻 → 跳過第 2 關，直達第 3 關', low.trace.at(-1).current_step, 3);
      check('有記錄跳關稽核', low.skipped, [2]);
      cleanup();

      const high = await runScenario({
        label: '1b_require_達門檻', steps, formFields: amountField,
        formData: { amount: 150000 }, approvals: ['a1'],
      });
      check('達門檻 → 正常進入第 2 關', high.trace.at(-1).current_step, 2);
      check('沒有跳關紀錄', high.skipped, []);
      cleanup();
    }

    console.log('\n[2] 條件式分支：action=skip（符合則跳過）');
    {
      const steps = [
        { order: 1, name: '一', assignType: 'users', mode: 'any', _actorKeys: ['a1'] },
        { order: 2, name: '小額免簽', assignType: 'users', mode: 'any', _actorKeys: ['a2'], condition: condStep('skip') },
        { order: 3, name: '總', assignType: 'users', mode: 'any', _actorKeys: ['a3'] },
      ];
      const matched = await runScenario({
        label: '2a_skip_符合條件', steps, formFields: amountField,
        formData: { amount: 150000 }, approvals: ['a1'],
      });
      check('符合跳關條件 → 跳過第 2 關', matched.trace.at(-1).current_step, 3);
      cleanup();

      const unmatched = await runScenario({
        label: '2b_skip_不符條件', steps, formFields: amountField,
        formData: { amount: 50000 }, approvals: ['a1'],
      });
      check('不符跳關條件 → 正常簽核第 2 關', unmatched.trace.at(-1).current_step, 2);
      cleanup();
    }

    console.log('\n[3] 送出時即跳過第一關');
    {
      const steps = [
        { order: 1, name: '財務', assignType: 'users', mode: 'any', _actorKeys: ['a1'], condition: condStep('require') },
        { order: 2, name: '總', assignType: 'users', mode: 'any', _actorKeys: ['a2'] },
      ];
      const r = await runScenario({
        label: '3a_首關即跳過', steps, formFields: amountField,
        formData: { amount: 50000 }, approvals: [],
      });
      check('送出後直接落在第 2 關', r.trace[0].current_step, 2);
      check('有記錄首關跳關', r.skipped, [1]);
      cleanup();
    }

    console.log('\n[4] 連續跳關後直接結案');
    {
      const steps = [
        { order: 1, name: '一', assignType: 'users', mode: 'any', _actorKeys: ['a1'] },
        { order: 2, name: '跳A', assignType: 'users', mode: 'any', _actorKeys: ['a2'], condition: condStep('require') },
        { order: 3, name: '跳B', assignType: 'users', mode: 'any', _actorKeys: ['a3'], condition: condStep('require') },
      ];
      const r = await runScenario({
        label: '4a_連續跳關結案', steps, formFields: amountField,
        formData: { amount: 1000 }, approvals: ['a1'],
      });
      check('後續全跳過 → 狀態為 approved', r.trace.at(-1).status, 'approved');
      check('兩關都有跳關紀錄', r.skipped, [2, 3]);
      cleanup();
    }

    console.log('\n[5] 無條件流程不受影響（回歸）');
    {
      const steps = [
        { order: 1, name: '一', assignType: 'users', mode: 'any', _actorKeys: ['a1'] },
        { order: 2, name: '二', assignType: 'users', mode: 'any', _actorKeys: ['a2'] },
      ];
      const r = await runScenario({
        label: '5a_一般流程', steps, formFields: amountField,
        formData: { amount: 50000 }, approvals: ['a1', 'a2'],
      });
      check('兩關簽完 → approved', r.trace.at(-1).status, 'approved');
      check('沒有任何跳關', r.skipped, []);
      cleanup();
    }
  } catch (e) {
    fail++;
    failures.push('測試執行中斷：' + e.message);
    console.error('\n❌ 測試中斷：', e.message);
  } finally {
    const n = cleanup();
    console.log('\n' + '='.repeat(58));
    console.log(`清除殘留測試單據 ${n} 筆`);
    console.log(`結果：通過 ${pass}　失敗 ${fail}`);
    if (failures.length) {
      console.log('\n失敗項目：');
      failures.forEach((f) => console.log('  - ' + f));
    }
    process.exit(fail ? 1 : 0);
  }
})();
