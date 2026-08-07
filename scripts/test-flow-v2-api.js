/**
 * v2 圖模型端對端測試（走真實 HTTP API）
 * 用法：先 npm run dev，再 node scripts/test-flow-v2-api.js
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const db = require(path.join(ROOT, 'server', 'db'));
const { hashPassword } = require(path.join(ROOT, 'server', 'auth'));

const BASE = process.env.TEST_BASE || 'http://127.0.0.1:3847';
const PREFIX = '__v2test__';
// LIKE 中 _ 是萬用字元，DELETE 前必須跳脫，否則比對範圍會超出預期
const likePrefix = () => PREFIX.replace(/_/g, '\\_') + '%';
const PW = 'V2Test!2026';
let pass = 0, fail = 0;
const failures = [];

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log(`    ✅ ${label}`); }
  else {
    fail++; failures.push(`${label}：預期 ${JSON.stringify(expected)}，實際 ${JSON.stringify(actual)}`);
    console.log(`    ❌ ${label}  預期 ${JSON.stringify(expected)}，實際 ${JSON.stringify(actual)}`);
  }
}

async function api(p, opts = {}, token) {
  const r = await fetch(BASE + p, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(opts.headers || {}) },
  });
  const text = await r.text();
  let j; try { j = JSON.parse(text); } catch { j = { raw: text }; }
  if (!r.ok) throw new Error(`${p} → HTTP ${r.status}: ${text.slice(0, 300)}`);
  return j;
}

function mkUser(suffix, name, role = 'user') {
  const username = PREFIX + suffix;
  db.prepare('DELETE FROM users WHERE username = ?').run(username);
  const r = db.prepare(
    `INSERT INTO users (username, password_hash, name, email, department, role)
     VALUES (?, ?, ?, NULL, '管理部', ?)`
  ).run(username, hashPassword(PW), name, role);
  return { id: Number(r.lastInsertRowid), username };
}
const login = async (u) => (await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: u, password: PW }) })).token;

function cleanup() {
  const ids = db.prepare(`SELECT id FROM approval_requests WHERE title LIKE ? ESCAPE '\\'`).all(likePrefix()).map(r => r.id);
  for (const id of ids) {
    db.prepare('DELETE FROM request_node_states WHERE request_id = ?').run(id);
    db.prepare('DELETE FROM approval_actions WHERE request_id = ?').run(id);
    db.prepare('DELETE FROM request_attachments WHERE request_id = ?').run(id);
    db.prepare('DELETE FROM approval_requests WHERE id = ?').run(id);
  }
  db.prepare(`DELETE FROM workflows WHERE name LIKE ? ESCAPE '\\'`).run(likePrefix());
  db.prepare(`DELETE FROM users WHERE username LIKE ? ESCAPE '\\'`).run(likePrefix());
  return ids.length;
}

(async () => {
  console.log('v2 圖模型端對端測試（HTTP API）');
  console.log('='.repeat(58));
  cleanup();

  try {
    const admin = mkUser('_admin', 'v2管理', 'admin');
    const L = mkUser('_L', '法務');
    const F = mkUser('_F', '財務');
    const G = mkUser('_G', '總經理');
    const tAdmin = await login(admin.username);

    console.log('\n[1] 建立含並行分支的 v2 流程');
    const flow = {
      version: 2,
      nodes: [
        { id: 'start', type: 'start', ui: { x: 0, y: 100 } },
        { id: 'legal', type: 'approval', name: '法務審核', assignType: 'users', mode: 'any', approverIds: [L.id], ui: { x: 200, y: 20 } },
        { id: 'fin', type: 'approval', name: '財務審核', assignType: 'users', mode: 'any', approverIds: [F.id], ui: { x: 200, y: 180 } },
        { id: 'j', type: 'join', mode: 'all', ui: { x: 400, y: 100 } },
        { id: 'gm', type: 'approval', name: '總經理', assignType: 'users', mode: 'any', approverIds: [G.id], ui: { x: 560, y: 100 } },
        { id: 'end', type: 'end', ui: { x: 720, y: 100 } },
      ],
      edges: [
        { from: 'start', to: 'legal' }, { from: 'start', to: 'fin' },
        { from: 'legal', to: 'j' }, { from: 'fin', to: 'j' },
        { from: 'j', to: 'gm' }, { from: 'gm', to: 'end' },
      ],
    };
    const wf = await api('/api/workflows', {
      method: 'POST',
      body: JSON.stringify({ name: PREFIX + '並行流程', description: '測試', flow, formFields: [] }),
    }, tAdmin);
    const wfId = wf.workflow.id;
    check('flow_version 存為 2', wf.workflow.flowVersion, 2);
    check('圖有回傳', !!wf.workflow.flow, true);
    check('由圖推導出 3 個線性步驟（供舊 UI／PDF）', wf.workflow.steps.length, 3);

    console.log('\n[2] 送出申請 → 應同時開啟兩個並行關卡');
    const sub = await api('/api/requests', {
      method: 'POST',
      body: JSON.stringify({ workflow_id: wfId, title: PREFIX + '並行單', content: 'x', form_data: {} }),
    }, tAdmin);
    const rid = sub.request.id;
    const pending = () => db.prepare(`SELECT node_id FROM request_node_states WHERE request_id=? AND state='pending' ORDER BY node_id`).all(rid).map(r => r.node_id);
    check('同時停在法務與財務', pending(), ['fin', 'legal']);

    console.log('\n[3] 兩位簽核人各自簽核（v1 的 current_step 做不到這件事）');
    const tL = await login(L.username);
    await api(`/api/requests/${rid}/action`, { method: 'POST', body: JSON.stringify({ action: 'approve', comment: '法務同意' }) }, tL);
    check('法務簽完 → 仍停在財務', pending(), ['fin']);
    const st1 = db.prepare('SELECT status FROM approval_requests WHERE id=?').get(rid);
    check('尚未結案', st1.status, 'pending');

    const tF = await login(F.username);
    await api(`/api/requests/${rid}/action`, { method: 'POST', body: JSON.stringify({ action: 'approve', comment: '財務同意' }) }, tF);
    check('兩邊都簽完 → 通過匯合進總經理', pending(), ['gm']);

    console.log('\n[4] 詳情 API 是否帶出圖與節點狀態');
    const detail = await api(`/api/requests/${rid}`, {}, tAdmin);
    check('回傳 flow', !!detail.request.flow, true);
    check('回傳 nodeStates', !!detail.request.nodeStates, true);
    check('法務為 approved', detail.request.nodeStates.legal.state, 'approved');
    check('總經理為 pending', detail.request.nodeStates.gm.state, 'pending');

    console.log('\n[5] 完成流程');
    const tG = await login(G.username);
    await api(`/api/requests/${rid}/action`, { method: 'POST', body: JSON.stringify({ action: 'approve', comment: '核准' }) }, tG);
    const st2 = db.prepare('SELECT status FROM approval_requests WHERE id=?').get(rid);
    check('總經理核准 → 結案', st2.status, 'approved');

    console.log('\n[6] 圖驗證會擋下有問題的流程');
    try {
      await api('/api/workflows', {
        method: 'POST',
        body: JSON.stringify({
          name: PREFIX + '壞流程',
          flow: {
            version: 2,
            nodes: [{ id: 'start', type: 'start' }, { id: 'a', type: 'approval', name: 'A', approverIds: [L.id] },
                    { id: 'b', type: 'approval', name: 'B', approverIds: [L.id] }, { id: 'end', type: 'end' }],
            edges: [{ from: 'start', to: 'a' }, { from: 'a', to: 'b' }, { from: 'b', to: 'a' }, { from: 'b', to: 'end' }],
          },
          formFields: [],
        }),
      }, tAdmin);
      check('循環流程應被拒絕', 'accepted', 'rejected');
    } catch (e) {
      check('循環流程被拒絕', /循環/.test(e.message), true);
    }

    console.log('\n[7] v1 流程完全不受影響');
    const v1wf = await api('/api/workflows', {
      method: 'POST',
      body: JSON.stringify({
        name: PREFIX + 'v1流程',
        steps: [{ order: 1, name: '一', assignType: 'users', mode: 'any', approverIds: [L.id] }],
        formFields: [],
      }),
    }, tAdmin);
    check('未帶 flow → flow_version 維持 1', v1wf.workflow.flowVersion, 1);
    const v1sub = await api('/api/requests', {
      method: 'POST',
      body: JSON.stringify({ workflow_id: v1wf.workflow.id, title: PREFIX + 'v1單', content: 'x', form_data: {} }),
    }, tAdmin);
    const v1rid = v1sub.request.id;
    const v1states = db.prepare('SELECT COUNT(*) c FROM request_node_states WHERE request_id=?').get(v1rid).c;
    check('v1 單據不建立節點狀態（走舊引擎）', v1states, 0);
    await api(`/api/requests/${v1rid}/action`, { method: 'POST', body: JSON.stringify({ action: 'approve' }) }, tL);
    check('v1 單據正常結案', db.prepare('SELECT status FROM approval_requests WHERE id=?').get(v1rid).status, 'approved');
    console.log('\n[8] PUT 升級：v1 流程改存流程圖後變成 v2');
    {
      const w1 = await api('/api/workflows', { method: 'POST', body: JSON.stringify({
        name: PREFIX + '待升級', steps: [
          { order: 1, name: '甲', assignType: 'users', mode: 'any', approverIds: [L.id] },
          { order: 2, name: '乙', assignType: 'users', mode: 'any', approverIds: [F.id] }],
        formFields: [] }) }, tAdmin);
      check('初始為 v1', w1.workflow.flowVersion, 1);
      const g = {
        version: 2,
        nodes: [{ id: 'start', type: 'start' },
                { id: 'a', type: 'approval', name: '甲', assignType: 'users', mode: 'any', approverIds: [L.id] },
                { id: 'b', type: 'approval', name: '乙', assignType: 'users', mode: 'any', approverIds: [F.id] },
                { id: 'end', type: 'end' }],
        edges: [{ from: 'start', to: 'a' }, { from: 'a', to: 'b' }, { from: 'b', to: 'end' }],
      };
      const up = await api('/api/workflows/' + w1.workflow.id, { method: 'PUT', body: JSON.stringify({ flow: g }) }, tAdmin);
      check('PUT 後升級為 v2', up.workflow.flowVersion, 2);
      check('圖已儲存', (up.workflow.flow.nodes || []).length, 4);
      check('steps 由圖同步推導', up.workflow.steps.map(s => s.name), ['甲', '乙']);

      const s2 = await api('/api/requests', { method: 'POST', body: JSON.stringify({
        workflow_id: w1.workflow.id, title: PREFIX + '升級後單', content: 'x', form_data: {} }) }, tAdmin);
      const rid2 = s2.request.id;
      const ns = db.prepare(`SELECT node_id FROM request_node_states WHERE request_id=? AND state='pending'`).all(rid2).map(r => r.node_id);
      check('升級後新單走圖引擎', ns, ['a']);
    }

  } catch (e) {
    fail++; failures.push('測試中斷：' + e.message);
    console.error('\n❌ 測試中斷：', e.message);
  } finally {
    const n = cleanup();
    console.log('\n' + '='.repeat(58));
    console.log(`清除測試單據 ${n} 筆`);
    console.log(`結果：通過 ${pass}　失敗 ${fail}`);
    if (failures.length) { console.log('\n失敗項目：'); failures.forEach(f => console.log('  - ' + f)); }
    process.exit(fail ? 1 : 0);
  }
})();
