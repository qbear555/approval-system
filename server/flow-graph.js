/**
 * 簽核流程圖（v2）格式定義與轉換層
 *
 * 設計原則：編輯器與執行引擎分離
 *   - 畫布只負責產生／編輯這份 JSON，node.ui 為畫布專用座標
 *   - 執行引擎只讀 nodes / edges，**絕不讀 node.ui**
 *     改座標不影響任何執行語意，也就不需要重新驗證流程
 *
 * 與 v1（線性 steps_json）的關係：
 *   - v1 流程可用 linearToGraph() 轉成「一條直線的圖」，行為完全等價
 *   - v2 圖若為單一路徑，可用 graphToLinear() 還原成 v1 陣列，
 *     供既有 UI、PDF 排版等尚未圖形化的地方繼續使用
 *
 * 節點 id 為字串且永不重用：改名、搬位置、插入節點都不影響進行中的單據
 * （v1 的整數 order 做不到這點）。
 */

const NODE_TYPES = ['start', 'approval', 'join', 'end'];
const JOIN_MODES = ['all', 'any'];
// not_contains 由 negate() 產生（v1 的 skip 語意轉成邊條件時需要反相），
// 必須列入白名單，否則 sanitizeCondition 會把旁路邊的條件丟掉
const COND_OPERATORS = ['>=', '>', '<=', '<', '==', '!=', 'contains', 'not_contains'];
const ASSIGN_TYPES = [
  'users',
  'users_pick',
  'cosign_pick',
  'dept_head',
  'department',
  'form_user',
];

const FLOW_VERSION = 2;

/* ────────────────────────────────────────────────────────────
   正規化
   ──────────────────────────────────────────────────────────── */

function sanitizeCondition(c) {
  if (!c || typeof c !== 'object') return null;
  const fieldId = String(c.fieldId || '').trim().slice(0, 40);
  const operator = COND_OPERATORS.includes(c.operator) ? c.operator : '';
  if (!fieldId || !operator) return null;
  return {
    fieldId,
    operator,
    value: c.value != null ? String(c.value).trim().slice(0, 100) : '',
  };
}

function sanitizeUi(ui) {
  const x = Number(ui?.x);
  const y = Number(ui?.y);
  return {
    x: Number.isFinite(x) ? Math.round(x) : 0,
    y: Number.isFinite(y) ? Math.round(y) : 0,
  };
}

function sanitizeNode(n, idx) {
  const type = NODE_TYPES.includes(n?.type) ? n.type : 'approval';
  const id = String(n?.id || '').trim().slice(0, 60) || `n${idx}`;
  const base = { id, type, ui: sanitizeUi(n?.ui) };

  if (type === 'start' || type === 'end') return base;

  if (type === 'join') {
    return { ...base, mode: JOIN_MODES.includes(n?.mode) ? n.mode : 'all' };
  }

  // approval
  const assignType = ASSIGN_TYPES.includes(n?.assignType) ? n.assignType : 'users';
  return {
    ...base,
    name: String(n?.name || `關卡 ${idx}`).trim().slice(0, 60),
    assignType,
    formFieldId: n?.formFieldId ? String(n.formFieldId).trim().slice(0, 40) : 'agent',
    department: n?.department ? String(n.department).trim().slice(0, 60) : '',
    approverIds: Array.isArray(n?.approverIds) ? n.approverIds.map(Number).filter(Boolean) : [],
    mode: n?.mode === 'all' ? 'all' : 'any',
    approverFields: Array.isArray(n?.approverFields) ? n.approverFields : [],
    // 駁回落點：'requester' 退回申請人；節點 id 則退回該節點
    rejectTo: n?.rejectTo ? String(n.rejectTo).trim().slice(0, 60) : 'requester',
  };
}

function sanitizeEdge(e) {
  const from = String(e?.from || '').trim().slice(0, 60);
  const to = String(e?.to || '').trim().slice(0, 60);
  if (!from || !to) return null;
  const edge = { from, to };
  const cond = sanitizeCondition(e?.condition);
  if (cond) edge.condition = cond;
  return edge;
}

/** 正規化任意輸入為合法 v2 圖；輸入無效時回傳 null */
function normalizeGraph(input) {
  let g = input;
  if (typeof g === 'string') {
    try {
      g = JSON.parse(g);
    } catch {
      return null;
    }
  }
  if (!g || typeof g !== 'object') return null;
  if (!Array.isArray(g.nodes) || !Array.isArray(g.edges)) return null;

  const nodes = g.nodes.map((n, i) => sanitizeNode(n, i));
  const ids = new Set(nodes.map((n) => n.id));
  if (ids.size !== nodes.length) return null; // 節點 id 重複

  const edges = g.edges.map(sanitizeEdge).filter(Boolean).filter((e) => ids.has(e.from) && ids.has(e.to));

  return { version: FLOW_VERSION, nodes, edges };
}

/* ────────────────────────────────────────────────────────────
   驗證
   ──────────────────────────────────────────────────────────── */

/** 回傳錯誤訊息陣列；空陣列代表通過 */
function validateGraph(g) {
  const errs = [];
  if (!g) return ['流程圖格式無效'];

  const starts = g.nodes.filter((n) => n.type === 'start');
  const ends = g.nodes.filter((n) => n.type === 'end');
  if (starts.length !== 1) errs.push(`必須且只能有一個開始節點（目前 ${starts.length} 個）`);
  if (ends.length < 1) errs.push('必須至少有一個結束節點');

  const approvals = g.nodes.filter((n) => n.type === 'approval');
  if (!approvals.length) errs.push('流程至少要有一個簽核關卡');

  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const out = new Map(g.nodes.map((n) => [n.id, []]));
  const inn = new Map(g.nodes.map((n) => [n.id, []]));
  for (const e of g.edges) {
    out.get(e.from).push(e);
    inn.get(e.to).push(e);
  }

  for (const n of g.nodes) {
    if (n.type !== 'start' && inn.get(n.id).length === 0) {
      errs.push(`節點「${n.name || n.id}」沒有任何連入路徑`);
    }
    if (n.type !== 'end' && out.get(n.id).length === 0) {
      errs.push(`節點「${n.name || n.id}」沒有任何連出路徑`);
    }
    if (n.type === 'join' && inn.get(n.id).length < 2) {
      errs.push(`匯合節點「${n.id}」至少需要兩條連入路徑`);
    }
  }

  // 從 start 出發的可達性
  if (starts.length === 1) {
    const seen = new Set();
    const stack = [starts[0].id];
    while (stack.length) {
      const cur = stack.pop();
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const e of out.get(cur) || []) stack.push(e.to);
    }
    for (const n of g.nodes) {
      if (!seen.has(n.id)) errs.push(`節點「${n.name || n.id}」從開始節點無法到達`);
    }
    if (!ends.some((e) => seen.has(e.id))) errs.push('沒有任何結束節點是可到達的');
  }

  // 循環偵測（DFS 三色標記）
  const color = new Map(g.nodes.map((n) => [n.id, 0])); // 0 未訪 1 訪問中 2 完成
  let cyclic = false;
  const visit = (id) => {
    if (cyclic) return;
    color.set(id, 1);
    for (const e of out.get(id) || []) {
      const c = color.get(e.to);
      if (c === 1) {
        cyclic = true;
        const n = byId.get(e.to);
        errs.push(`流程有循環：回到「${n?.name || e.to}」`);
        return;
      }
      if (c === 0) visit(e.to);
    }
    color.set(id, 2);
  };
  for (const n of g.nodes) if (color.get(n.id) === 0) visit(n.id);

  return errs;
}

/* ────────────────────────────────────────────────────────────
   v1 ⇄ v2 轉換
   ──────────────────────────────────────────────────────────── */

/**
 * v1 線性 steps 陣列 → v2 直線圖（行為等價）
 * v1 的 step.condition 有 action: require|skip 兩種語意，
 * 轉成 edge 條件時統一為「條件成立才走這條邊」：
 *   - require：條件原樣掛在「進入該關卡」的邊上
 *   - skip：條件反相後掛上（符合則跳過 = 不符合才進入）
 * 同時補一條繞過該關卡的旁路邊，兩條邊互斥。
 */
function linearToGraph(steps) {
  const list = Array.isArray(steps) ? steps : [];
  const nodeIdFor = (s, i) => `n${s?.order != null ? s.order : i + 1}`;

  const nodes = [
    { id: 'start', type: 'start', ui: { x: 40, y: 120 } },
    ...list.map((s, i) => ({
      id: nodeIdFor(s, i),
      type: 'approval',
      name: s.name || `關卡 ${i + 1}`,
      assignType: s.assignType || 'users',
      formFieldId: s.formFieldId || 'agent',
      department: s.department || '',
      approverIds: Array.isArray(s.approverIds) ? s.approverIds : [],
      mode: s.mode === 'all' ? 'all' : 'any',
      approverFields: Array.isArray(s.approverFields) ? s.approverFields : [],
      rejectTo: 'requester',
      ui: { x: 40 + (i + 1) * 200, y: 120 },
      // 保留來源 order，供 v1 相容顯示與 PDF 排版使用
      legacyOrder: s.order != null ? Number(s.order) : i + 1,
    })),
    { id: 'end', type: 'end', ui: { x: 40 + (list.length + 1) * 200, y: 120 } },
  ];

  // 主幹：start → 各關卡 → end
  const seq = ['start', ...list.map(nodeIdFor), 'end'];
  const edges = [];
  for (let i = 0; i < seq.length - 1; i++) {
    edges.push({ from: seq[i], to: seq[i + 1] });
  }

  // 條件式關卡：把條件掛到「進入該關卡」的邊，並補一條互斥的旁路邊
  list.forEach((s, i) => {
    const c = s.condition;
    if (!c || !c.enabled || !c.fieldId || !c.operator) return;
    const nodeId = nodeIdFor(s, i);
    const prevId = i === 0 ? 'start' : nodeIdFor(list[i - 1], i - 1);
    const nextId = i === list.length - 1 ? 'end' : nodeIdFor(list[i + 1], i + 1);

    const enterEdge = edges.find((e) => e.from === prevId && e.to === nodeId);
    if (!enterEdge) return;

    if (c.action === 'skip') {
      // 符合則跳過 → 進入條件為「不符合」
      enterEdge.condition = { fieldId: c.fieldId, operator: negate(c.operator), value: c.value };
      edges.push({
        from: prevId,
        to: nextId,
        condition: { fieldId: c.fieldId, operator: c.operator, value: c.value },
      });
    } else {
      enterEdge.condition = { fieldId: c.fieldId, operator: c.operator, value: c.value };
      edges.push({
        from: prevId,
        to: nextId,
        condition: { fieldId: c.fieldId, operator: negate(c.operator), value: c.value },
      });
    }
  });

  return normalizeGraph({ version: FLOW_VERSION, nodes, edges });
}

function negate(op) {
  switch (op) {
    case '>=':
      return '<';
    case '>':
      return '<=';
    case '<=':
      return '>';
    case '<':
      return '>=';
    case '==':
      return '!=';
    case '!=':
      return '==';
    case 'contains':
      return 'not_contains';
    default:
      return op;
  }
}

/**
 * v2 圖 → v1 線性 steps（供既有 UI／PDF 排版沿用）
 * 圖若有分支，取拓撲排序後的順序做「最佳努力」線性化：
 * 順序正確，但表達不出並行語意——僅供顯示，不可用於執行。
 */
function graphToLinear(g) {
  const graph = normalizeGraph(g);
  if (!graph) return [];
  const order = topoSort(graph);
  const steps = [];
  let n = 0;
  for (const id of order) {
    const node = graph.nodes.find((x) => x.id === id);
    if (!node || node.type !== 'approval') continue;
    n++;
    steps.push({
      order: n,
      name: node.name,
      assignType: node.assignType,
      formFieldId: node.formFieldId,
      department: node.department,
      approverIds: node.approverIds,
      mode: node.mode,
      approverFields: node.approverFields,
      condition: edgeConditionToStepCondition(graph, id),
      nodeId: node.id,
    });
  }
  return steps;
}

/** 把「進入某節點」的邊條件還原成 v1 的 step.condition（僅單一入邊時可還原） */
function edgeConditionToStepCondition(graph, nodeId) {
  const ins = graph.edges.filter((e) => e.to === nodeId);
  if (ins.length !== 1 || !ins[0].condition) return { enabled: false };
  const c = ins[0].condition;
  if (!COND_OPERATORS.includes(c.operator)) return { enabled: false };
  return {
    enabled: true,
    fieldId: c.fieldId,
    operator: c.operator,
    value: c.value,
    action: 'require',
  };
}

/** Kahn 拓撲排序；有循環時回傳已排出的部分 */
function topoSort(graph) {
  const indeg = new Map(graph.nodes.map((n) => [n.id, 0]));
  const out = new Map(graph.nodes.map((n) => [n.id, []]));
  for (const e of graph.edges) {
    indeg.set(e.to, (indeg.get(e.to) || 0) + 1);
    out.get(e.from).push(e.to);
  }
  const queue = graph.nodes.filter((n) => (indeg.get(n.id) || 0) === 0).map((n) => n.id);
  const result = [];
  while (queue.length) {
    const cur = queue.shift();
    result.push(cur);
    for (const to of out.get(cur) || []) {
      indeg.set(to, indeg.get(to) - 1);
      if (indeg.get(to) === 0) queue.push(to);
    }
  }
  return result;
}

/** 圖是否為單一路徑（無分支、無並行） */
function isLinearGraph(g) {
  const graph = normalizeGraph(g);
  if (!graph) return false;
  if (graph.nodes.some((n) => n.type === 'join')) return false;
  const outCount = new Map(graph.nodes.map((n) => [n.id, 0]));
  const inCount = new Map(graph.nodes.map((n) => [n.id, 0]));
  for (const e of graph.edges) {
    outCount.set(e.from, outCount.get(e.from) + 1);
    inCount.set(e.to, inCount.get(e.to) + 1);
  }
  return graph.nodes.every(
    (n) => outCount.get(n.id) <= 1 && inCount.get(n.id) <= 1
  );
}

module.exports = {
  FLOW_VERSION,
  NODE_TYPES,
  COND_OPERATORS,
  normalizeGraph,
  validateGraph,
  linearToGraph,
  graphToLinear,
  isLinearGraph,
  topoSort,
};
