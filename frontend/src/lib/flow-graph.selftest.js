import { graphFromWorkflow, validateGraph } from './flow-graph.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const g = graphFromWorkflow({
  steps: [
    { name: '部門主管', assignType: 'dept_head', mode: 'any' },
    { name: '總經理', assignType: 'users', approverIds: [1], mode: 'any' },
  ],
});
assert(g.nodes[0].type === 'start' && g.nodes.at(-1).type === 'end', 'ends');
assert(g.edges.length === 3, 'linear edges');
assert(validateGraph(g).length === 0, 'valid linear');

const bad = graphFromWorkflow({ steps: [{ name: '指定', assignType: 'users', approverIds: [] }] });
assert(validateGraph(bad).some((e) => e.includes('尚未指定')), 'need approvers');

console.log('flow-graph selftest ok');
