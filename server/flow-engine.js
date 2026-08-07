/**
 * 圖模型簽核執行引擎（v2）
 *
 * 與 v1 線性引擎的根本差異：
 *   v1 用 approval_requests.current_step 一個整數當游標，只能表達
 *   「單一位置在一條直線上移動」。並行分支（同時停在兩個關卡）裝不下。
 *
 *   v2 改用 request_node_states 每節點一列，state=pending 可同時多筆，
 *   current_step 降級為顯示用（相容舊 UI 與 PDF 排版）。
 *
 * 本模組只讀 nodes / edges，**絕不讀 node.ui**：畫布座標與執行語意分離。
 */

const flowGraph = require('./flow-graph');

/* ────────────────────────────────────────────────────────────
   條件求值
   ──────────────────────────────────────────────────────────── */

/** 取表單欄位值，沿用 v1 對金額／天數的別名容錯 */
function readField(formData, fieldId) {
  const fd = formData || {};
  let v = fd[fieldId];
  if (v == null || v === '') {
    if (['days', 'hours', 'amount', 'total_amount'].includes(fieldId)) {
      v = fd[fieldId] ?? fd.days ?? fd.hours ?? fd['金額'] ?? fd['總金額'] ?? 0;
    } else {
      v = '';
    }
  }
  return v;
}

/** 邊上的條件是否成立；無條件的邊恆成立 */
function evaluateEdge(edge, formData) {
  const c = edge && edge.condition;
  if (!c) return true;

  const raw = readField(formData, c.fieldId);
  const numVal = Number(raw);
  const numTarget = Number(c.value);
  const numeric = !Number.isNaN(numVal) && !Number.isNaN(numTarget) && String(raw).trim() !== '';

  if (numeric) {
    switch (c.operator) {
      case '>':  return numVal > numTarget;
      case '>=': return numVal >= numTarget;
      case '<':  return numVal < numTarget;
      case '<=': return numVal <= numTarget;
      case '==': return numVal === numTarget;
      case '!=': return numVal !== numTarget;
      default: break;
    }
  }
  const s = String(raw ?? '').trim();
  const t = String(c.value ?? '').trim();
  switch (c.operator) {
    case '==': return s === t;
    case '!=': return s !== t;
    case 'contains': return s.includes(t);
    case 'not_contains': return !s.includes(t);
    // 數值運算子碰到非數值資料：無法判定，一律視為不成立，
    // 避免把不該走的路徑打開
    default: return false;
  }
}

function describeCondition(c) {
  if (!c) return '無條件';
  const opText = {
    '>=': '≥', '>': '>', '<=': '≤', '<': '<',
    '==': '=', '!=': '≠', contains: '包含', not_contains: '不包含',
  };
  return `${c.fieldId} ${opText[c.operator] || c.operator} ${c.value}`;
}

/* ────────────────────────────────────────────────────────────
   節點狀態存取
   ──────────────────────────────────────────────────────────── */

function makeEngine(db) {
  const q = {
    getStates: db.prepare(
      `SELECT node_id, state, entered_at, completed_at, ad_hoc
       FROM request_node_states WHERE request_id = ?`
    ),
    getState: db.prepare(
      `SELECT node_id, state FROM request_node_states WHERE request_id = ? AND node_id = ?`
    ),
    insertState: db.prepare(
      `INSERT OR IGNORE INTO request_node_states (request_id, node_id, state, ad_hoc)
       VALUES (?, ?, ?, ?)`
    ),
    setState: db.prepare(
      `UPDATE request_node_states
       SET state = ?, completed_at = CASE WHEN ? IN ('approved','rejected','skipped')
                                          THEN datetime('now','localtime') ELSE NULL END
       WHERE request_id = ? AND node_id = ?`
    ),
    sysAction: db.prepare(
      `INSERT INTO approval_actions
         (request_id, step_order, node_id, step_name, actor_id, action, comment, form_data)
       VALUES (?, ?, ?, ?, NULL, 'system', ?, '{}')`
    ),
    setCurrentStep: db.prepare(
      `UPDATE approval_requests SET current_step = ?, updated_at = datetime('now','localtime')
       WHERE id = ?`
    ),
    setStatus: db.prepare(
      `UPDATE approval_requests
       SET status = ?, completed_at = CASE WHEN ? IN ('approved','rejected')
                                           THEN datetime('now','localtime') ELSE NULL END,
           updated_at = datetime('now','localtime')
       WHERE id = ?`
    ),
  };

  /** 節點索引 */
  function indexGraph(graph) {
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const outEdges = new Map(graph.nodes.map((n) => [n.id, []]));
    const inEdges = new Map(graph.nodes.map((n) => [n.id, []]));
    for (const e of graph.edges) {
      if (outEdges.has(e.from)) outEdges.get(e.from).push(e);
      if (inEdges.has(e.to)) inEdges.get(e.to).push(e);
    }
    return { byId, outEdges, inEdges };
  }

  const stateMap = (requestId) => {
    const m = new Map();
    for (const r of q.getStates.all(requestId)) m.set(r.node_id, r);
    return m;
  };

  /** 目前待簽的節點 id 陣列（可多個 = 並行中） */
  function pendingNodes(requestId) {
    return q.getStates
      .all(requestId)
      .filter((r) => r.state === 'pending')
      .map((r) => r.node_id);
  }

  /** current_step 僅供顯示：取第一個待簽節點的 legacyOrder（或索引） */
  function syncCurrentStep(requestId, graph) {
    const pend = pendingNodes(requestId);
    if (!pend.length) return;
    const approvals = graph.nodes.filter((n) => n.type === 'approval');
    let best = null;
    for (const id of pend) {
      const idx = approvals.findIndex((n) => n.id === id);
      if (idx < 0) continue;
      const ord = approvals[idx].legacyOrder != null ? Number(approvals[idx].legacyOrder) : idx + 1;
      if (best == null || ord < best) best = ord;
    }
    if (best != null) q.setCurrentStep.run(best, requestId);
  }

  /**
   * 啟用一個節點。回傳是否真的產生了待簽關卡。
   * join 節點會檢查匯合條件；end 節點回報流程可結束。
   */
  function activate(requestId, graph, idx, nodeId, formData, visited) {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);

    const node = idx.byId.get(nodeId);
    if (!node) return;

    if (node.type === 'end') {
      // 標記抵達，實際是否結案由 settle() 判斷（可能還有並行分支在跑）
      q.insertState.run(requestId, nodeId, 'approved', 0);
      return;
    }

    if (node.type === 'join') {
      // 所有連入節點都已完成（approved 或 skipped）才放行；
      // mode=any 則任一完成即可
      const states = stateMap(requestId);
      const sources = idx.inEdges.get(nodeId).map((e) => e.from);
      const done = sources.filter((s) => {
        const st = states.get(s);
        return st && (st.state === 'approved' || st.state === 'skipped');
      });
      const satisfied = node.mode === 'any' ? done.length >= 1 : done.length === sources.length;
      if (!satisfied) return; // 等其他分支

      q.insertState.run(requestId, nodeId, 'approved', 0);
      q.sysAction.run(
        requestId, null, nodeId, '匯合',
        `[匯合] ${done.length}/${sources.length} 條分支已完成，繼續後續流程`
      );
      traverseFrom(requestId, graph, idx, nodeId, formData, visited);
      return;
    }

    // approval：建立待簽狀態
    q.insertState.run(requestId, nodeId, 'pending', 0);
  }

  /** 從某節點沿出邊前進，依條件決定走哪些路徑 */
  function traverseFrom(requestId, graph, idx, nodeId, formData, visited) {
    const outs = idx.outEdges.get(nodeId) || [];
    const passed = outs.filter((e) => evaluateEdge(e, formData));
    const hadConditions = outs.some((e) => e.condition);

    if (hadConditions) {
      const taken = passed.map((e) => `${e.to}${e.condition ? `（${describeCondition(e.condition)}）` : ''}`);
      const skipped = outs
        .filter((e) => !passed.includes(e))
        .map((e) => `${e.to}（${describeCondition(e.condition)} 不成立）`);
      q.sysAction.run(
        requestId, null, nodeId, idx.byId.get(nodeId)?.name || nodeId,
        `[條件分支] 走：${taken.join('、') || '無'}` +
          (skipped.length ? `；未走：${skipped.join('、')}` : '')
      );
    }

    if (!passed.length && outs.length) {
      // 所有出邊條件都不成立 → 這條分支走不下去，視為結束
      q.sysAction.run(
        requestId, null, nodeId, idx.byId.get(nodeId)?.name || nodeId,
        '[條件分支] 所有後續路徑條件皆不成立，此分支結束'
      );
      return;
    }

    for (const e of passed) {
      activate(requestId, graph, idx, e.to, formData, visited);
    }
  }

  /**
   * 判斷流程是否已結束。
   * 沒有任何 pending 節點 = 全部分支跑完 → approved
   */
  function settle(requestId, graph) {
    const pend = pendingNodes(requestId);
    if (pend.length) {
      syncCurrentStep(requestId, graph);
      return { done: false, status: 'pending', pending: pend };
    }
    q.setStatus.run('approved', 'approved', requestId);
    return { done: true, status: 'approved', pending: [] };
  }

  /* ── 對外 API ───────────────────────────────────────────── */

  /** 送出申請：從 start 開始推進 */
  function start(requestId, graph, formData) {
    const idx = indexGraph(graph);
    const startNode = graph.nodes.find((n) => n.type === 'start');
    if (!startNode) return { done: false, status: 'pending', pending: [], error: '流程缺少開始節點' };
    q.insertState.run(requestId, startNode.id, 'approved', 0);
    traverseFrom(requestId, graph, idx, startNode.id, formData, new Set());
    return settle(requestId, graph);
  }

  /** 核准某節點並推進 */
  function approve(requestId, graph, nodeId, formData) {
    const idx = indexGraph(graph);
    const st = q.getState.get(requestId, nodeId);
    if (!st || st.state !== 'pending') {
      return { done: false, status: 'pending', pending: pendingNodes(requestId), error: '此關卡不在待簽狀態' };
    }
    q.setState.run('approved', 'approved', requestId, nodeId);
    traverseFrom(requestId, graph, idx, nodeId, formData, new Set());
    return settle(requestId, graph);
  }

  /**
   * 駁回某節點。
   * node.rejectTo = 'requester'（預設）→ 整張單駁回
   * node.rejectTo = 其他節點 id → 退回該節點重簽，並清掉其下游狀態
   */
  function reject(requestId, graph, nodeId) {
    const idx = indexGraph(graph);
    const node = idx.byId.get(nodeId);
    q.setState.run('rejected', 'rejected', requestId, nodeId);

    const target = node?.rejectTo || 'requester';
    if (target === 'requester' || !idx.byId.has(target)) {
      // 整單駁回：其餘進行中的並行關卡一併終止
      for (const id of pendingNodes(requestId)) {
        q.setState.run('rejected', 'rejected', requestId, id);
      }
      q.setStatus.run('rejected', 'rejected', requestId);
      return { done: true, status: 'rejected', pending: [] };
    }

    // 退回指定節點：清除該節點與其下游的既有狀態
    const downstream = reachableFrom(idx, target);
    const del = db.prepare(
      `DELETE FROM request_node_states WHERE request_id = ? AND node_id = ?`
    );
    for (const id of downstream) del.run(requestId, id);
    q.insertState.run(requestId, target, 'pending', 0);
    q.sysAction.run(
      requestId, null, nodeId, node?.name || nodeId,
      `[駁回退件] 退回「${idx.byId.get(target)?.name || target}」重新簽核`
    );
    syncCurrentStep(requestId, graph);
    return { done: false, status: 'pending', pending: pendingNodes(requestId) };
  }

  function reachableFrom(idx, startId) {
    const seen = new Set();
    const stack = [startId];
    while (stack.length) {
      const cur = stack.pop();
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const e of idx.outEdges.get(cur) || []) stack.push(e.to);
    }
    return [...seen];
  }

  /** 取整張單的節點狀態，供前端流程圖顯示 */
  function nodeStates(requestId) {
    const out = {};
    for (const r of q.getStates.all(requestId)) {
      out[r.node_id] = {
        state: r.state,
        entered_at: r.entered_at,
        completed_at: r.completed_at,
        ad_hoc: !!r.ad_hoc,
      };
    }
    return out;
  }

  /** 執行期動態插入節點（加簽／轉簽用） */
  function insertAdHoc(requestId, graph, afterNodeId, node) {
    const clean = flowGraph.normalizeGraph({
      version: 2,
      nodes: [...graph.nodes, node],
      edges: [...graph.edges, { from: afterNodeId, to: node.id }],
    });
    if (!clean) return null;
    q.insertState.run(requestId, node.id, 'pending', 1);
    return clean;
  }

  return {
    start,
    approve,
    reject,
    settle,
    pendingNodes,
    nodeStates,
    insertAdHoc,
    evaluateEdge,
    indexGraph,
    syncCurrentStep,
  };
}

module.exports = { makeEngine, evaluateEdge, describeCondition };
