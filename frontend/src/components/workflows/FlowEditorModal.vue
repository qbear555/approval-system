<template>
  <div class="fe">
    <header class="fe-bar">
      <strong>流程圖編輯器{{ workflowName ? ' — ' + workflowName : '' }}</strong>
      <div class="fe-tools">
        <button type="button" class="btn sm" @click="addNode('approval')">＋ 簽核關卡</button>
        <button type="button" class="btn sm" @click="addNode('join')">＋ 匯合節點</button>
        <button type="button" class="btn sm" @click="addNode('end')">＋ 結束節點</button>
        <button type="button" class="btn sm outline" :class="{ on: linkMode }" @click="toggleLink">🔗 連線模式</button>
        <button type="button" class="btn sm outline" @click="tidy">⇄ 自動排版</button>
        <button type="button" class="btn sm outline danger" @click="removeSelected">刪除選取</button>
        <button type="button" class="btn sm primary" @click="save">儲存流程圖</button>
        <button type="button" class="btn sm" @click="$emit('close')">取消</button>
      </div>
    </header>
    <div class="fe-body">
      <div class="fe-canvas-wrap" @mousedown="clearIfEmpty">
        <div class="fe-canvas" :style="{ width: canvasW + 'px', height: canvasH + 'px' }">
          <svg class="fe-edges">
            <line
              v-for="(e, i) in graph.edges"
              :key="i"
              :x1="center(e.from).x"
              :y1="center(e.from).y"
              :x2="center(e.to).x"
              :y2="center(e.to).y"
              :class="{ sel: selected?.kind === 'edge' && selected.index === i }"
              @click.stop="selected = { kind: 'edge', index: i }"
            />
            <text
              v-for="(e, i) in graph.edges"
              :key="'t' + i"
              :x="(center(e.from).x + center(e.to).x) / 2"
              :y="(center(e.from).y + center(e.to).y) / 2 - 8"
            >
              {{ edgeLabel(e) }}
            </text>
          </svg>
          <div
            v-for="n in graph.nodes"
            :key="n.id"
            class="fe-node"
            :class="[n.type, { sel: selected?.kind === 'node' && selected.id === n.id }]"
            :style="{ left: (n.ui?.x || 0) + 'px', top: (n.ui?.y || 0) + 'px' }"
            @mousedown.stop="onNodeDown($event, n)"
          >
            <div class="fe-title">{{ nodeTitle(n) }}</div>
            <div v-if="n.type === 'approval'" class="fe-sub">{{ assignHint(n) }}</div>
          </div>
        </div>
      </div>
      <aside class="fe-side">
        <p v-if="!selected" class="muted">點選節點或連線以編輯。建立分支：先點來源節點，再按連線模式，然後點目標節點。</p>
        <template v-else-if="selected.kind === 'edge' && currentEdge">
          <h4>連線：{{ nodeTitle(byId(currentEdge.from)) }} → {{ nodeTitle(byId(currentEdge.to)) }}</h4>
          <label class="check"><input type="checkbox" :checked="!!currentEdge.condition" @change="toggleCond" /> 設定條件（成立才走這條）</label>
          <div v-if="currentEdge.condition" class="fe-row">
            <input v-model="currentEdge.condition.fieldId" placeholder="欄位 id" />
            <select v-model="currentEdge.condition.operator">
              <option v-for="op in FLOW_OPS" :key="op" :value="op">{{ flowOpLabel(op) }}</option>
            </select>
            <input v-model="currentEdge.condition.value" placeholder="值" />
          </div>
        </template>
        <template v-else-if="currentNode && (currentNode.type === 'start' || currentNode.type === 'end')">
          <h4>{{ nodeTitle(currentNode) }}</h4>
          <p class="muted">起訖節點沒有可設定的屬性。</p>
        </template>
        <template v-else-if="currentNode && currentNode.type === 'join'">
          <h4>匯合節點</h4>
          <label>匯合條件
            <select v-model="currentNode.mode">
              <option value="all">所有連入分支都完成才繼續</option>
              <option value="any">任一分支完成即繼續</option>
            </select>
          </label>
        </template>
        <template v-else-if="currentNode && currentNode.type === 'approval'">
          <h4>簽核關卡</h4>
          <label>關卡名稱<input v-model="currentNode.name" /></label>
          <label>指派方式
            <select v-model="currentNode.assignType">
              <option value="users">指定人員</option>
              <option value="users_pick">申請人自選</option>
              <option value="cosign_pick">會簽（選填）</option>
              <option value="dept_head">部門主管／可略過</option>
              <option value="department">指定單位</option>
              <option value="form_user">表單欄位指定</option>
            </select>
          </label>
          <label>簽核方式
            <select v-model="currentNode.mode">
              <option value="any">任一人核准</option>
              <option value="all">全部都要核准</option>
            </select>
          </label>
          <label v-if="currentNode.assignType === 'department'">單位
            <select v-model="currentNode.department">
              <option value="">請選擇…</option>
              <option v-for="d in deptNames" :key="d" :value="d">{{ d }}</option>
            </select>
          </label>
          <label v-if="currentNode.assignType === 'form_user'">表單欄位
            <input v-model="currentNode.formFieldId" />
          </label>
          <label>駁回退回
            <select v-model="currentNode.rejectTo">
              <option value="requester">退回申請人（整單駁回）</option>
              <option v-for="o in otherApprovals" :key="o.id" :value="o.id">退回「{{ o.name }}」重簽</option>
            </select>
          </label>
          <div v-if="currentNode.assignType === 'users' || currentNode.assignType === 'users_pick'" class="fe-approvers">
            <label v-for="u in activeUsers" :key="u.id">
              <input type="checkbox" :checked="hasApprover(u.id)" @change="toggleApprover(u.id, $event.target.checked)" />
              {{ u.name }}<span v-if="u.department" class="muted">（{{ u.department }}）</span>
            </label>
          </div>
        </template>
        <ul v-if="errors.length" class="fe-errs">
          <li v-for="(err, i) in errors" :key="i">{{ err }}</li>
        </ul>
      </aside>
    </div>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue';
import { useToastStore } from '@/stores/toast';
import {
  FLOW_OPS,
  flowOpLabel,
  flowUid,
  graphFromWorkflow,
  validateGraph,
  autoLayout,
  nodeTitle,
} from '@/lib/flow-graph';
import { collectWorkflowDeptNames } from '@/lib/workflow-meta';

const props = defineProps({
  workflow: { type: Object, required: true },
  users: { type: Array, default: () => [] },
  departments: { type: Array, default: () => [] },
});
const emit = defineEmits(['close', 'save']);
const toast = useToastStore();

const NW = 150;
const NH = 56;
const graph = reactive(graphFromWorkflow(props.workflow));
const selected = ref(null);
const linkMode = ref(false);
const linkFrom = ref('');
const errors = ref([]);

const workflowName = computed(() => props.workflow?.name || '');
const activeUsers = computed(() => (props.users || []).filter((u) => u.active !== 0));
const deptNames = computed(() =>
  collectWorkflowDeptNames({
    departments: props.departments,
    users: props.users,
    extra: graph.nodes.map((n) => n.department),
  })
);
const currentNode = computed(() =>
  selected.value?.kind === 'node' ? graph.nodes.find((n) => n.id === selected.value.id) : null
);
const currentEdge = computed(() =>
  selected.value?.kind === 'edge' ? graph.edges[selected.value.index] : null
);
const otherApprovals = computed(() =>
  graph.nodes.filter((n) => n.type === 'approval' && n.id !== currentNode.value?.id)
);
const canvasW = computed(() => Math.max(1200, ...graph.nodes.map((n) => (n.ui?.x || 0) + 220)));
const canvasH = computed(() => Math.max(640, ...graph.nodes.map((n) => (n.ui?.y || 0) + 160)));

function byId(id) {
  return graph.nodes.find((n) => n.id === id);
}
function center(id) {
  const n = byId(id);
  return { x: (n?.ui?.x || 0) + NW / 2, y: (n?.ui?.y || 0) + NH / 2 };
}
function edgeLabel(e) {
  if (!e.condition) return '';
  return `${e.condition.fieldId || ''} ${flowOpLabel(e.condition.operator)} ${e.condition.value || ''}`;
}
function assignHint(n) {
  if (n.assignType === 'department') return n.department || '單位';
  if (n.assignType === 'form_user') return '表單：' + (n.formFieldId || 'agent');
  if (n.assignType === 'dept_head') return '部門主管';
  if (n.assignType === 'cosign_pick') return '會簽';
  return (n.approverIds || []).length ? `${n.approverIds.length} 人` : '未指定';
}
function hasApprover(id) {
  return (currentNode.value?.approverIds || []).some((x) => Number(x) === Number(id));
}
function toggleApprover(id, on) {
  const n = currentNode.value;
  if (!n) return;
  const list = n.approverIds || (n.approverIds = []);
  const i = list.findIndex((x) => Number(x) === Number(id));
  if (on && i < 0) list.push(id);
  if (!on && i >= 0) list.splice(i, 1);
}
function onNodeDown(ev, n) {
  if (linkMode.value) {
    if (!linkFrom.value) {
      linkFrom.value = n.id;
      selected.value = { kind: 'node', id: n.id };
      return;
    }
    if (linkFrom.value !== n.id && !graph.edges.some((e) => e.from === linkFrom.value && e.to === n.id)) {
      graph.edges.push({ from: linkFrom.value, to: n.id });
    }
    linkFrom.value = '';
    linkMode.value = false;
    selected.value = { kind: 'node', id: n.id };
    return;
  }
  selected.value = { kind: 'node', id: n.id };
  const sx = ev.clientX;
  const sy = ev.clientY;
  const ox = n.ui?.x || 0;
  const oy = n.ui?.y || 0;
  const move = (e) => {
    n.ui = { x: Math.max(0, ox + e.clientX - sx), y: Math.max(0, oy + e.clientY - sy) };
  };
  const up = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}
function clearIfEmpty(ev) {
  if (ev.target.classList?.contains('fe-canvas-wrap') || ev.target.classList?.contains('fe-canvas')) {
    selected.value = null;
    linkFrom.value = '';
  }
}
function toggleLink() {
  linkMode.value = !linkMode.value;
  linkFrom.value = selected.value?.kind === 'node' ? selected.value.id : '';
}
function addNode(type) {
  const id = flowUid(type === 'approval' ? 'n' : type);
  const base = { id, type, ui: { x: 360, y: 120 + (graph.nodes.length % 6) * 40 } };
  if (type === 'approval') {
    Object.assign(base, {
      name: '新關卡',
      assignType: 'users',
      mode: 'any',
      approverIds: [],
      department: '',
      formFieldId: 'agent',
      rejectTo: 'requester',
    });
  }
  if (type === 'join') base.mode = 'all';
  graph.nodes.push(base);
  selected.value = { kind: 'node', id };
}
function tidy() {
  autoLayout(graph);
}
function removeSelected() {
  if (!selected.value) return toast.error('請先選取要刪除的節點或連線');
  if (selected.value.kind === 'edge') {
    graph.edges.splice(selected.value.index, 1);
    selected.value = null;
    return;
  }
  const n = byId(selected.value.id);
  if (n?.type === 'start') return toast.error('開始節點不可刪除');
  graph.nodes.splice(
    graph.nodes.findIndex((x) => x.id === selected.value.id),
    1
  );
  graph.edges = graph.edges.filter((e) => e.from !== n.id && e.to !== n.id);
  selected.value = null;
}
function toggleCond(ev) {
  const e = currentEdge.value;
  if (!e) return;
  if (ev.target.checked) e.condition = { fieldId: 'amount', operator: '>=', value: '' };
  else delete e.condition;
}
function save() {
  const errs = validateGraph(graph);
  errors.value = errs;
  if (errs.length) {
    toast.error('流程尚有問題，請先修正');
    return;
  }
  emit('save', JSON.parse(JSON.stringify(graph)));
}
</script>

<style scoped>
.fe { position: fixed; inset: 0; z-index: 80; background: #0f172a; color: #e2e8f0; display: flex; flex-direction: column; }
.fe-bar { display: flex; justify-content: space-between; gap: 12px; align-items: center; padding: 10px 14px; background: #1e293b; flex-wrap: wrap; }
.fe-tools { display: flex; gap: 6px; flex-wrap: wrap; }
.fe-tools .on { outline: 2px solid #38bdf8; }
.fe-body { flex: 1; display: flex; min-height: 0; }
.fe-canvas-wrap { flex: 1; overflow: auto; background: #0b1220; }
.fe-canvas { position: relative; }
.fe-edges { position: absolute; inset: 0; width: 100%; height: 100%; }
.fe-edges line { stroke: #94a3b8; stroke-width: 2; cursor: pointer; }
.fe-edges line.sel { stroke: #38bdf8; stroke-width: 3; }
.fe-edges text { fill: #fbbf24; font-size: 11px; text-anchor: middle; pointer-events: none; }
.fe-node { position: absolute; width: 150px; min-height: 56px; border-radius: 10px; background: #1e293b; border: 1px solid #475569; padding: 8px 10px; cursor: grab; }
.fe-node.sel { border-color: #38bdf8; box-shadow: 0 0 0 2px rgba(56,189,248,.35); }
.fe-node.start { background: #14532d; }
.fe-node.end { background: #7f1d1d; }
.fe-node.join { background: #3f3f46; }
.fe-title { font-weight: 700; }
.fe-sub { font-size: 0.75rem; color: #cbd5e1; }
.fe-side { width: 320px; background: #111827; border-left: 1px solid #334155; overflow: auto; padding: 14px; display: flex; flex-direction: column; gap: 8px; }
.fe-side label { display: flex; flex-direction: column; gap: 4px; font-size: 0.85rem; }
.fe-side input, .fe-side select { background: #0f172a; color: #f8fafc; border: 1px solid #334155; border-radius: 6px; padding: 6px; }
.fe-row { display: flex; gap: 6px; flex-wrap: wrap; }
.fe-approvers { max-height: 220px; overflow: auto; display: flex; flex-direction: column; gap: 4px; }
.fe-approvers label { flex-direction: row; align-items: center; }
.check { flex-direction: row !important; align-items: center; }
.fe-errs { color: #fecaca; font-size: 0.82rem; padding-left: 18px; }
.danger { color: #fecaca; }
</style>
