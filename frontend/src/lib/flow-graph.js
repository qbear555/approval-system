/** 流程圖資料與驗證（對齊 flow-editor.js／後端 validateGraph）。 */

const NEG = { '>=': '<', '>': '<=', '<=': '>', '<': '>=', '==': '!=', '!=': '==', contains: 'not_contains' };

export const FLOW_OPS = ['>=', '>', '<=', '<', '==', '!=', 'contains', 'not_contains'];

export function flowOpLabel(op) {
  return (
    { '>=': '≥', '>': '>', '<=': '≤', '<': '<', '==': '=', '!=': '≠', contains: '包含', not_contains: '不包含' }[op] ||
    op
  );
}

export function flowUid(prefix) {
  return prefix + '_' + Math.random().toString(36).slice(2, 8);
}

export function graphFromWorkflow(workflow) {
  if (workflow && workflow.flow && Array.isArray(workflow.flow.nodes) && workflow.flow.nodes.length) {
    return JSON.parse(JSON.stringify(workflow.flow));
  }
  const steps = (workflow && workflow.steps) || [];
  const idOf = (s, i) => 'n' + (s.order != null ? s.order : i + 1);
  const nodes = [
    { id: 'start', type: 'start', ui: { x: 40, y: 300 } },
    ...steps.map((s, i) => ({
      id: idOf(s, i),
      type: 'approval',
      name: s.name || '關卡 ' + (i + 1),
      assignType: s.assignType || 'users',
      formFieldId: s.formFieldId || 'agent',
      department: s.department || '',
      approverIds: s.approverIds || [],
      mode: s.mode === 'all' ? 'all' : 'any',
      approverFields: s.approverFields || [],
      rejectTo: 'requester',
      ui: { x: 230 + i * 200, y: 300 },
    })),
    { id: 'end', type: 'end', ui: { x: 230 + steps.length * 200, y: 300 } },
  ];
  const seq = ['start'].concat(steps.map(idOf), ['end']);
  const edges = [];
  for (let i = 0; i < seq.length - 1; i++) edges.push({ from: seq[i], to: seq[i + 1] });
  steps.forEach((s, i) => {
    const c = s.condition;
    if (!c || !c.enabled || !c.fieldId || !c.operator) return;
    const nodeId = idOf(s, i);
    const at = seq.indexOf(nodeId);
    const prevId = seq[at - 1];
    const nextId = seq[at + 1];
    const e = edges.find((x) => x.from === prevId && x.to === nodeId);
    if (!e) return;
    const enter =
      c.action === 'skip'
        ? { fieldId: c.fieldId, operator: NEG[c.operator] || c.operator, value: c.value }
        : { fieldId: c.fieldId, operator: c.operator, value: c.value };
    const bypass =
      c.action === 'skip'
        ? { fieldId: c.fieldId, operator: c.operator, value: c.value }
        : { fieldId: c.fieldId, operator: NEG[c.operator] || c.operator, value: c.value };
    e.condition = enter;
    edges.push({ from: prevId, to: nextId, condition: bypass });
  });
  return { version: 2, nodes, edges };
}

export function validateGraph(g) {
  const errs = [];
  const nodes = g.nodes || [];
  const edges = g.edges || [];
  const starts = nodes.filter((n) => n.type === 'start');
  const ends = nodes.filter((n) => n.type === 'end');
  if (starts.length !== 1) errs.push('必須且只能有一個開始節點（目前 ' + starts.length + ' 個）');
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
    if (n.type !== 'start' && !(inn.get(n.id) || []).length) errs.push('「' + label + '」沒有任何連入路徑');
    if (n.type !== 'end' && !(out.get(n.id) || []).length) errs.push('「' + label + '」沒有任何連出路徑');
    if (n.type === 'join' && (inn.get(n.id) || []).length < 2) errs.push('匯合節點至少需要兩條連入路徑');
    if (n.type === 'approval' && needApprovers.includes(n.assignType) && !(n.approverIds || []).length) {
      errs.push(
        n.assignType === 'users_pick'
          ? '「' + label + '」是申請人自選，但可選名單是空的，請至少勾選一位候選簽核人'
          : '「' + label + '」尚未指定簽核人'
      );
    }
    if (n.type === 'approval' && n.assignType === 'department' && !String(n.department || '').trim()) {
      errs.push('「' + label + '」請指定簽核單位／部門');
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
    for (const n of nodes) if (!seen.has(n.id)) errs.push('「' + (n.name || n.id) + '」從開始節點無法到達');
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

export function autoLayout(g) {
  const inn = new Map(g.nodes.map((n) => [n.id, []]));
  for (const e of g.edges) if (inn.has(e.to)) inn.get(e.to).push(e);
  const depth = new Map();
  const dep = (id, seen) => {
    if (depth.has(id)) return depth.get(id);
    if (seen.has(id)) return 0;
    seen.add(id);
    const ins = inn.get(id) || [];
    const d = ins.length ? Math.max(...ins.map((e) => dep(e.from, seen) + 1)) : 0;
    depth.set(id, d);
    return d;
  };
  for (const n of g.nodes) dep(n.id, new Set());
  const byLayer = new Map();
  for (const n of g.nodes) {
    const d = depth.get(n.id) || 0;
    if (!byLayer.has(d)) byLayer.set(d, []);
    byLayer.get(d).push(n);
  }
  byLayer.forEach((list, d) => {
    list.forEach((n, i) => {
      n.ui = { x: 40 + d * 210, y: 70 + i * 115 };
    });
  });
}

export function nodeTitle(n) {
  if (!n) return '';
  if (n.type === 'start') return '開始';
  if (n.type === 'end') return '結束';
  if (n.type === 'join') return '匯合';
  return n.name || '關卡';
}
