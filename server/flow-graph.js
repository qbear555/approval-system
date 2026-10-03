/**
 * 流程圖（v2）↔ 線性關卡。
 * 進行中單據仍用 steps_snapshot，這裡只影響流程範本。
 */

function clone(v) {
  return JSON.parse(JSON.stringify(v || null));
}

function sanitizeFlow(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const nodes = Array.isArray(src.nodes) ? src.nodes : [];
  const edges = Array.isArray(src.edges) ? src.edges : [];
  return {
    version: 2,
    nodes: nodes.map((n) => ({
      id: String(n.id || ''),
      type: String(n.type || 'approval'),
      name: n.name != null ? String(n.name) : '',
      assignType: n.assignType || 'users',
      formFieldId: n.formFieldId || 'agent',
      department: n.department || '',
      approverIds: Array.isArray(n.approverIds)
        ? n.approverIds.map(Number).filter(Boolean)
        : [],
      mode: n.mode === 'all' ? 'all' : 'any',
      approverFields: Array.isArray(n.approverFields) ? n.approverFields : [],
      skipIfNoApprover: !!n.skipIfNoApprover,
      rejectTo: n.rejectTo || 'requester',
      ui: n.ui && typeof n.ui === 'object' ? { x: Number(n.ui.x) || 0, y: Number(n.ui.y) || 0 } : { x: 0, y: 0 },
    })).filter((n) => n.id),
    edges: edges
      .map((e) => {
        const out = { from: String(e.from || ''), to: String(e.to || '') };
        if (e.condition && e.condition.fieldId) {
          out.condition = {
            fieldId: String(e.condition.fieldId),
            operator: String(e.condition.operator || '=='),
            value: e.condition.value != null ? String(e.condition.value) : '',
          };
        }
        return out;
      })
      .filter((e) => e.from && e.to),
  };
}

function validateGraph(g) {
  const errs = [];
  const nodes = g.nodes || [];
  const edges = g.edges || [];
  const starts = nodes.filter((n) => n.type === 'start');
  const ends = nodes.filter((n) => n.type === 'end');
  if (starts.length !== 1) errs.push(`必須且只能有一個開始節點（目前 ${starts.length} 個）`);
  if (!ends.length) errs.push('必須至少有一個結束節點');
  if (!nodes.some((n) => n.type === 'approval')) errs.push('流程至少要有一個簽核關卡');

  const out = new Map(nodes.map((n) => [n.id, []]));
  const inn = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    if (out.has(e.from)) out.get(e.from).push(e);
    if (inn.has(e.to)) inn.get(e.to).push(e);
  }
  const needApprovers = ['users', 'users_pick'];
  for (const n of nodes) {
    const label = n.name || n.id;
    if (n.type !== 'start' && !(inn.get(n.id) || []).length) {
      errs.push(`「${label}」沒有任何連入路徑`);
    }
    if (n.type !== 'end' && !(out.get(n.id) || []).length) {
      errs.push(`「${label}」沒有任何連出路徑`);
    }
    if (n.type === 'join' && (inn.get(n.id) || []).length < 2) {
      errs.push('匯合節點至少需要兩條連入路徑');
    }
    if (n.type === 'approval' && needApprovers.includes(n.assignType) && !(n.approverIds || []).length) {
      errs.push(
        n.assignType === 'users_pick'
          ? `「${label}」是申請人自選，但可選名單是空的`
          : `「${label}」尚未指定簽核人`
      );
    }
    if (n.type === 'approval' && n.assignType === 'department' && !String(n.department || '').trim()) {
      errs.push(`「${label}」請指定簽核單位／部門`);
    }
  }
  if (starts.length === 1) {
    const seen = new Set();
    const stack = [starts[0].id];
    while (stack.length) {
      const c = stack.pop();
      if (seen.has(c)) continue;
      seen.add(c);
      for (const e of out.get(c) || []) stack.push(e.to);
    }
    for (const n of nodes) {
      if (!seen.has(n.id)) errs.push(`「${n.name || n.id}」從開始節點無法到達`);
    }
  }
  const color = new Map(nodes.map((n) => [n.id, 0]));
  let cyc = false;
  const visit = (id) => {
    if (cyc) return;
    color.set(id, 1);
    for (const e of out.get(id) || []) {
      if (color.get(e.to) === 1) {
        cyc = true;
        errs.push('流程有循環，簽核會無法結束');
        return;
      }
      if (color.get(e.to) === 0) visit(e.to);
    }
    color.set(id, 2);
  };
  for (const n of nodes) if (color.get(n.id) === 0) visit(n.id);
  return errs;
}

function graphToSteps(g) {
  const nodes = g.nodes || [];
  const edges = g.edges || [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = new Map(nodes.map((n) => [n.id, []]));
  const inn = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    if (out.has(e.from)) out.get(e.from).push(e);
    if (inn.has(e.to)) inn.get(e.to).push(e);
  }
  const indeg = new Map(nodes.map((n) => [n.id, (inn.get(n.id) || []).length]));
  const q = nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);
  const order = [];
  while (q.length) {
    const id = q.shift();
    order.push(id);
    for (const e of out.get(id) || []) {
      indeg.set(e.to, indeg.get(e.to) - 1);
      if (indeg.get(e.to) === 0) q.push(e.to);
    }
  }
  const steps = [];
  for (const id of order) {
    const n = byId.get(id);
    if (!n || n.type !== 'approval') continue;
    const incoming = inn.get(id) || [];
    const condEdge = incoming.find((e) => e.condition && e.condition.fieldId);
    const step = {
      name: n.name || `關卡 ${steps.length + 1}`,
      assignType: n.assignType || 'users',
      formFieldId: n.formFieldId || 'agent',
      department: n.department || '',
      approverIds: n.approverIds || [],
      mode: n.mode === 'all' ? 'all' : 'any',
      approverFields: n.approverFields || [],
      skipIfNoApprover: !!n.skipIfNoApprover,
    };
    if (condEdge) {
      step.condition = {
        enabled: true,
        fieldId: condEdge.condition.fieldId,
        operator: condEdge.condition.operator,
        value: condEdge.condition.value,
        action: 'include',
      };
    }
    steps.push(step);
  }
  return steps;
}

function stepsToGraph(steps) {
  const list = Array.isArray(steps) ? steps : [];
  const idOf = (s, i) => 'n' + (s.order != null ? s.order : i + 1);
  const nodes = [
    { id: 'start', type: 'start', ui: { x: 40, y: 300 } },
    ...list.map((s, i) => ({
      id: idOf(s, i),
      type: 'approval',
      name: s.name || `關卡 ${i + 1}`,
      assignType: s.assignType || 'users',
      formFieldId: s.formFieldId || 'agent',
      department: s.department || '',
      approverIds: s.approverIds || [],
      mode: s.mode === 'all' ? 'all' : 'any',
      approverFields: s.approverFields || [],
      skipIfNoApprover: !!s.skipIfNoApprover,
      rejectTo: 'requester',
      ui: { x: 230 + i * 200, y: 300 },
    })),
    { id: 'end', type: 'end', ui: { x: 230 + list.length * 200, y: 300 } },
  ];
  const seq = ['start'].concat(list.map(idOf), ['end']);
  const edges = [];
  for (let i = 0; i < seq.length - 1; i++) edges.push({ from: seq[i], to: seq[i + 1] });
  return { version: 2, nodes, edges };
}

function parseFlowJson(raw) {
  if (!raw) return null;
  try {
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!obj || !Array.isArray(obj.nodes) || !obj.nodes.length) return null;
    return sanitizeFlow(obj);
  } catch {
    return null;
  }
}

module.exports = {
  clone,
  sanitizeFlow,
  validateGraph,
  graphToSteps,
  stepsToGraph,
  parseFlowJson,
};
