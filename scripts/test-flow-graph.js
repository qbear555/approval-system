/**
 * 圖模型執行引擎單元測試（不經 HTTP，直接驅動 flow-engine）
 * 用法：node scripts/test-flow-graph.js
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const db = require(path.join(ROOT, 'server', 'db'));
const fg = require(path.join(ROOT, 'server', 'flow-graph'));
const { makeEngine } = require(path.join(ROOT, 'server', 'flow-engine'));

const engine = makeEngine(db);
const PREFIX = '__graphtest__';
// LIKE 中 _ 是萬用字元，DELETE 前必須跳脫，否則比對範圍會超出預期
const likePrefix = () => PREFIX.replace(/_/g, '\\_') + '%';
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

function mkRequest() {
  const u = db.prepare('SELECT id FROM users LIMIT 1').get();
  const w = db.prepare('SELECT id FROM workflows LIMIT 1').get();
  const r = db.prepare(
    `INSERT INTO approval_requests (workflow_id, title, content, requester_id, status, current_step)
     VALUES (?, ?, '', ?, 'pending', 1)`
  ).run(w.id, PREFIX + Date.now(), u.id);
  return Number(r.lastInsertRowid);
}

function cleanup() {
  const ids = db.prepare(`SELECT id FROM approval_requests WHERE title LIKE ? ESCAPE '\\'`).all(likePrefix()).map(r => r.id);
  for (const id of ids) {
    db.prepare('DELETE FROM request_node_states WHERE request_id = ?').run(id);
    db.prepare('DELETE FROM approval_actions WHERE request_id = ?').run(id);
    db.prepare('DELETE FROM approval_requests WHERE id = ?').run(id);
  }
  return ids.length;
}

const approvalNode = (id, name, extra = {}) => ({
  id, type: 'approval', name, assignType: 'users', mode: 'any',
  approverIds: [1], approverFields: [], ui: { x: 0, y: 0 }, ...extra,
});

const statusOf = (rid) => db.prepare('SELECT status, current_step FROM approval_requests WHERE id = ?').get(rid);
/** 系統稽核紀錄：斷言用 node_id 而非文字內容，避免改文案就壞測試 */
const sysActions = (rid) =>
  db.prepare(
    `SELECT node_id, step_name, comment FROM approval_actions
     WHERE request_id = ? AND action='system' ORDER BY id`
  ).all(rid);
const sysForNode = (rid, nodeId) => sysActions(rid).filter((a) => a.node_id === nodeId);

cleanup();
console.log('圖模型執行引擎測試');
console.log('='.repeat(58));

try {
  /* ── 1. 線性流程 ─────────────────────────────────── */
  console.log('\n[1] 線性流程 start → A → B → end');
  {
    const g = fg.normalizeGraph({
      version: 2,
      nodes: [{ id: 'start', type: 'start' }, approvalNode('A', '關卡A'), approvalNode('B', '關卡B'), { id: 'end', type: 'end' }],
      edges: [{ from: 'start', to: 'A' }, { from: 'A', to: 'B' }, { from: 'B', to: 'end' }],
    });
    check('圖驗證通過', fg.validateGraph(g), []);
    const rid = mkRequest();
    let r = engine.start(rid, g, {});
    check('送出後停在 A', r.pending, ['A']);
    r = engine.approve(rid, g, 'A', {});
    check('A 核准後停在 B', r.pending, ['B']);
    r = engine.approve(rid, g, 'B', {});
    check('B 核准後結案', r.status, 'approved');
    check('資料庫狀態同步', statusOf(rid).status, 'approved');
  }

  /* ── 2. 條件式分支 ───────────────────────────────── */
  console.log('\n[2] 條件式分支：金額 >= 10 萬才走財務');
  {
    const g = fg.normalizeGraph({
      version: 2,
      nodes: [{ id: 'start', type: 'start' }, approvalNode('A', '部門主管'),
              approvalNode('F', '財務'), approvalNode('G', '總經理'), { id: 'end', type: 'end' }],
      edges: [
        { from: 'start', to: 'A' },
        { from: 'A', to: 'F', condition: { fieldId: 'amount', operator: '>=', value: '100000' } },
        { from: 'A', to: 'G', condition: { fieldId: 'amount', operator: '<', value: '100000' } },
        { from: 'F', to: 'G' }, { from: 'G', to: 'end' },
      ],
    });
    const big = mkRequest();
    engine.start(big, g, { amount: 500000 });
    let r = engine.approve(big, g, 'A', { amount: 500000 });
    check('大額 → 進財務', r.pending, ['F']);

    const small = mkRequest();
    engine.start(small, g, { amount: 5000 });
    r = engine.approve(small, g, 'A', { amount: 5000 });
    check('小額 → 跳過財務直達總經理', r.pending, ['G']);
    check('A 有留下路徑判定的稽核紀錄', sysForNode(small, 'A').length, 1);
  }

  /* ── 3. 並行分支與匯合 ───────────────────────────── */
  console.log('\n[3] 並行：A 之後同時進法務與財務，兩邊都完成才繼續');
  {
    const g = fg.normalizeGraph({
      version: 2,
      nodes: [{ id: 'start', type: 'start' }, approvalNode('A', '申請確認'),
              approvalNode('L', '法務'), approvalNode('F', '財務'),
              { id: 'J', type: 'join', mode: 'all' }, approvalNode('G', '總經理'), { id: 'end', type: 'end' }],
      edges: [
        { from: 'start', to: 'A' }, { from: 'A', to: 'L' }, { from: 'A', to: 'F' },
        { from: 'L', to: 'J' }, { from: 'F', to: 'J' }, { from: 'J', to: 'G' }, { from: 'G', to: 'end' },
      ],
    });
    check('圖驗證通過', fg.validateGraph(g), []);
    const rid = mkRequest();
    engine.start(rid, g, {});
    let r = engine.approve(rid, g, 'A', {});
    check('A 後同時停在法務與財務', r.pending.sort(), ['F', 'L']);
    r = engine.approve(rid, g, 'L', {});
    check('只完成法務 → 仍停在財務（未匯合）', r.pending, ['F']);
    check('尚未結案', statusOf(rid).status, 'pending');
    r = engine.approve(rid, g, 'F', {});
    check('兩邊都完成 → 通過匯合到總經理', r.pending, ['G']);
    check('匯合節點有留下稽核紀錄', sysForNode(rid, 'J').length, 1);
    check('匯合紀錄的步驟名稱不是內部 id', sysForNode(rid, 'J')[0].step_name, '匯合（全部）');
    r = engine.approve(rid, g, 'G', {});
    check('總經理核准 → 結案', r.status, 'approved');
  }

  /* ── 4. join mode=any ────────────────────────────── */
  console.log('\n[4] 匯合 mode=any：任一分支完成即可繼續');
  {
    const g = fg.normalizeGraph({
      version: 2,
      nodes: [{ id: 'start', type: 'start' }, approvalNode('A', '起'),
              approvalNode('X', 'X'), approvalNode('Y', 'Y'),
              { id: 'J', type: 'join', mode: 'any' }, approvalNode('Z', 'Z'), { id: 'end', type: 'end' }],
      edges: [
        { from: 'start', to: 'A' }, { from: 'A', to: 'X' }, { from: 'A', to: 'Y' },
        { from: 'X', to: 'J' }, { from: 'Y', to: 'J' }, { from: 'J', to: 'Z' }, { from: 'Z', to: 'end' },
      ],
    });
    const rid = mkRequest();
    engine.start(rid, g, {});
    engine.approve(rid, g, 'A', {});
    const r = engine.approve(rid, g, 'X', {});
    check('X 完成即通過匯合，Y 仍在進行', r.pending.sort(), ['Y', 'Z']);
  }

  /* ── 5. 駁回 ────────────────────────────────────── */
  console.log('\n[5] 駁回');
  {
    const gReq = fg.normalizeGraph({
      version: 2,
      nodes: [{ id: 'start', type: 'start' }, approvalNode('A', 'A'), approvalNode('B', 'B'), { id: 'end', type: 'end' }],
      edges: [{ from: 'start', to: 'A' }, { from: 'A', to: 'B' }, { from: 'B', to: 'end' }],
    });
    const rid = mkRequest();
    engine.start(rid, gReq, {});
    const r = engine.reject(rid, gReq, 'A');
    check('駁回 → 整單 rejected', r.status, 'rejected');
    check('資料庫狀態同步', statusOf(rid).status, 'rejected');

    // rejectTo 指定節點：退回重簽
    const gBack = fg.normalizeGraph({
      version: 2,
      nodes: [{ id: 'start', type: 'start' }, approvalNode('A', 'A'),
              approvalNode('B', 'B', { rejectTo: 'A' }), { id: 'end', type: 'end' }],
      edges: [{ from: 'start', to: 'A' }, { from: 'A', to: 'B' }, { from: 'B', to: 'end' }],
    });
    const rid2 = mkRequest();
    engine.start(rid2, gBack, {});
    engine.approve(rid2, gBack, 'A', {});
    const r2 = engine.reject(rid2, gBack, 'B');
    check('rejectTo=A → 退回 A 重簽', r2.pending, ['A']);
    check('單據仍在進行中', statusOf(rid2).status, 'pending');
  }

  /* ── 6. v1 流程轉圖後行為等價 ───────────────────── */
  console.log('\n[6] v1 線性流程轉圖後行為等價');
  {
    const v1 = [
      { order: 1, name: '一', assignType: 'users', mode: 'any', approverIds: [1] },
      { order: 2, name: '財務', assignType: 'users', mode: 'any', approverIds: [1],
        condition: { enabled: true, fieldId: 'amount', operator: '>=', value: '100000', action: 'require' } },
      { order: 3, name: '總', assignType: 'users', mode: 'any', approverIds: [1] },
    ];
    const g = fg.linearToGraph(v1);
    check('轉出的圖驗證通過', fg.validateGraph(g), []);
    const rid = mkRequest();
    engine.start(rid, g, { amount: 50000 });
    const r = engine.approve(rid, g, 'n1', { amount: 50000 });
    check('未達門檻 → 跳過財務（與 v1 引擎一致）', r.pending, ['n3']);
    check('current_step 同步為 3（顯示相容）', statusOf(rid).current_step, 3);
  }

  /* ── 7. 圖驗證錯誤偵測 ──────────────────────────── */
  console.log('\n[7] 圖驗證');
  {
    const cyclic = fg.normalizeGraph({
      version: 2,
      nodes: [{ id: 'start', type: 'start' }, approvalNode('A', 'A'), approvalNode('B', 'B'), { id: 'end', type: 'end' }],
      edges: [{ from: 'start', to: 'A' }, { from: 'A', to: 'B' }, { from: 'B', to: 'A' }, { from: 'B', to: 'end' }],
    });
    check('偵測到循環', fg.validateGraph(cyclic).some(e => /循環/.test(e)), true);

    const orphan = fg.normalizeGraph({
      version: 2,
      nodes: [{ id: 'start', type: 'start' }, approvalNode('A', 'A'), approvalNode('Z', '孤兒'), { id: 'end', type: 'end' }],
      edges: [{ from: 'start', to: 'A' }, { from: 'A', to: 'end' }],
    });
    check('偵測到孤立節點', fg.validateGraph(orphan).some(e => /無法到達|沒有任何連入/.test(e)), true);

    const twoStart = fg.normalizeGraph({
      version: 2,
      nodes: [{ id: 's1', type: 'start' }, { id: 's2', type: 'start' }, approvalNode('A', 'A'), { id: 'end', type: 'end' }],
      edges: [{ from: 's1', to: 'A' }, { from: 's2', to: 'A' }, { from: 'A', to: 'end' }],
    });
    check('偵測到多個開始節點', fg.validateGraph(twoStart).some(e => /開始節點/.test(e)), true);
  }
} catch (e) {
  fail++; failures.push('測試中斷：' + e.message);
  console.error('\n❌ 測試中斷：', e.message, '\n', e.stack);
} finally {
  const n = cleanup();
  console.log('\n' + '='.repeat(58));
  console.log(`清除測試單據 ${n} 筆`);
  console.log(`結果：通過 ${pass}　失敗 ${fail}`);
  if (failures.length) { console.log('\n失敗項目：'); failures.forEach(f => console.log('  - ' + f)); }
  process.exit(fail ? 1 : 0);
}
