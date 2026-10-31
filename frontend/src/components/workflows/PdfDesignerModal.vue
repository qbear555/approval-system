<template>
  <Teleport to="body">
    <div class="pdf-designer" tabindex="-1" @keydown="onKey">
      <header class="pdf-designer-bar">
        <div class="pdf-designer-title">
          <strong>{{ mode === 'objects' ? '🧩 可編輯畫布設計器' : '📄 紙本表單畫布設計器' }}</strong>
          <span class="chip">{{ workflowName || '自訂版面' }}</span>
          <span class="file-name">{{ statusLine }}</span>
        </div>
        <div class="pdf-designer-tools">
          <template v-if="mode === 'paper'">
            <label class="tool-btn">
              📁 上傳底圖
              <input type="file" accept=".pdf,.png,.jpg,.jpeg" class="hidden" @change="onUpload" />
            </label>
            <button type="button" class="tool-btn accent" :disabled="scanning" :title="'利用 AI 辨識紙本底圖中的欄位與簽章，並推薦排版與 Schema'" @click="scan">
              {{ scanning ? '🤖 AI 分析排版中…' : '🤖✨ AI 智慧掃描' }}
            </button>
            <button v-if="aiScanResult" type="button" class="tool-btn" style="background:#e0e7ff;color:#3730a3;font-weight:600" title="查看最近一次 AI 掃描建議與匯出" @click="showAiScanModal = true">
              📋 查看 AI 建議
            </button>
            <button type="button" class="tool-btn" :disabled="page <= 1" @click="changePage(-1)">◀</button>
            <span class="zoom-val">第 {{ page }} / {{ pageCount }} 頁</span>
            <button type="button" class="tool-btn" :disabled="page >= pageCount" @click="changePage(1)">▶</button>
          </template>
          <button type="button" class="tool-btn" @click="setZoom(zoom - 0.15)">−</button>
          <span class="zoom-val">{{ Math.round(zoom * 100) }}%</span>
          <button type="button" class="tool-btn" @click="setZoom(zoom + 0.15)">＋</button>
          <button type="button" class="tool-btn" @click="fitZoom">適應</button>
          <button type="button" class="tool-btn save" @click="save">✓ 儲存並套用</button>
          <button type="button" class="tool-btn" @click="$emit('close')">關閉</button>
        </div>
      </header>
      <div class="pdf-designer-body">
        <div ref="scrollEl" class="pdf-designer-stage">
          <div ref="wrapEl" class="pdf-designer-page" :style="{ transform: `scale(${zoom})` }">
            <canvas ref="canvasEl"></canvas>
            <div
              ref="overlayEl"
              class="pdf-designer-overlay"
              @mousedown="onOverlayDown"
            >
              <div
                v-for="item in visibleItems"
                :key="item.id"
                class="designer-box"
                :class="{ selected: item.id === selectedId }"
                :style="boxStyle(item)"
                @mousedown.stop="onBoxDown($event, item)"
              >
                <div class="box-badge">{{ item.badge }}</div>
                <template v-if="mode === 'objects' && item.kind === 'table'">
                  <table class="obj-table">
                    <tr v-for="(row, ri) in item.rows || []" :key="ri">
                      <td
                        v-for="(cell, ci) in row.cells || []"
                        :key="ci"
                        :style="{ width: cellWidth(row, cell) }"
                        @mousedown.stop="selectCell(item, ri, ci)"
                      >
                        <div class="cell-inner">
                          <div v-if="cell.label" class="cell-label">{{ cell.label }}</div>
                          <div class="cell-value">{{ cell.text || (cell.bind ? `〔${cell.bind}〕` : '') }}</div>
                        </div>
                      </td>
                    </tr>
                  </table>
                </template>
                <div
                  v-else-if="mode === 'objects' && item.kind !== 'rect'"
                  class="obj-text"
                  :style="textStyle(item)"
                >
                  {{ item.text || (item.bind || item.fieldId ? `〔${item.bind || item.fieldId}〕` : '') }}
                </div>
                <div v-if="item.id === selectedId" class="handles">
                  <i v-for="d in DIRS" :key="d" class="handle" :data-dir="d" :style="handleStyle(d)" @mousedown.stop="onResizeDown($event, item, d)"></i>
                </div>
              </div>
              <div v-if="rubber" class="rubber" :style="rubberStyle"></div>
            </div>
          </div>
        </div>
        <aside class="pdf-designer-side">
          <div class="add-grid">
            <template v-if="mode === 'objects'">
              <button type="button" @click="addKind('text')">📝 文字</button>
              <button type="button" @click="addKind('table')">▦ 表格</button>
              <button type="button" @click="addKind('field')">🔖 欄位</button>
              <button type="button" @click="addKind('note')">📌 說明列</button>
              <button type="button" class="wide" @click="addKind('signature')">🖋️ 簽章格</button>
            </template>
            <template v-else>
              <button v-for="t in PAPER_TYPES" :key="t.type" type="button" @click="addPaper(t.type)">{{ t.label }}</button>
            </template>
          </div>
          <div v-if="!selected" class="empty-side">點選畫布上的物件即可改字、移動或調整大小。</div>
          <div v-else class="prop-form">
            <div class="prop-head">
              <strong>屬性</strong>
              <button type="button" class="danger" @click="removeSelected">刪除</button>
            </div>
            <template v-if="mode === 'objects'">
              <label>類型<input :value="kindLabel(selected.kind)" disabled /></label>
              <label v-if="selected.kind !== 'rect' && selected.kind !== 'table'">
                文字內容
                <textarea v-model="selected.text" rows="3"></textarea>
              </label>
              <label v-if="selected.kind === 'field'">
                欄位名稱
                <input v-model="selected.name" />
              </label>
              <label>
                綁定欄位
                <input v-model="bindModel" placeholder="leave_type、__requester_name" />
              </label>
              <div class="two">
                <label>字級<input v-model.number="selected.fontSize" type="number" min="8" max="36" /></label>
                <label>對齊
                  <select v-model="selected.align">
                    <option value="left">靠左</option>
                    <option value="center">置中</option>
                    <option value="right">靠右</option>
                  </select>
                </label>
              </div>
              <div v-if="selected.kind === 'table'" class="table-tools">
                <div>表格編輯</div>
                <div class="two">
                  <button type="button" @click="addRow">＋ 列</button>
                  <button type="button" @click="delRow">− 列</button>
                  <button type="button" @click="addCol">＋ 欄</button>
                  <button type="button" @click="delCol">− 欄</button>
                </div>
                <template v-if="activeCell">
                  <label>儲存格標籤<input v-model="activeCell.label" /></label>
                  <label>儲存格文字<input v-model="activeCell.text" /></label>
                  <label>儲存格綁定<input v-model="cellBind" placeholder="欄位 id" /></label>
                </template>
              </div>
            </template>
            <template v-else>
              <label>欄位名稱<input v-model="selected.name" /></label>
              <label>類型
                <select v-model="selected.type">
                  <option v-for="t in PAPER_TYPES" :key="t.type" :value="t.type">{{ t.label }}</option>
                </select>
              </label>
              <label class="check"><input v-model="selected.required" type="checkbox" /> 必填</label>
            </template>
            <div class="coords">
              <label>X %<input type="number" step="0.1" :value="pct(selected.rx)" @change="setPct('rx', $event)" /></label>
              <label>Y %<input type="number" step="0.1" :value="pct(selected.ry)" @change="setPct('ry', $event)" /></label>
              <label>寬 %<input type="number" step="0.1" :value="pct(selected.rw)" @change="setPct('rw', $event)" /></label>
              <label>高 %<input type="number" step="0.1" :value="pct(selected.rh)" @change="setPct('rh', $event)" /></label>
            </div>
          </div>
        </aside>
      </div>

      <!-- AI 掃描建議預覽彈窗 -->
      <div v-if="showAiScanModal" class="ai-scan-modal-backdrop" @click.self="showAiScanModal = false">
        <div class="ai-scan-modal-card">
          <div class="ai-scan-modal-header">
            <div style="display:flex;align-items:center;gap:8px">
              <span style="font-size:1.4rem">🤖✨</span>
              <div>
                <h3 style="margin:0;font-size:1.1rem">AI 智慧掃描排版結果</h3>
                <span class="muted" style="font-size:0.85rem">
                  已識別出 {{ aiScanResult?.fields?.length || 0 }} 個欄位與簽章格
                </span>
              </div>
            </div>
            <button type="button" class="btn sm outline" @click="showAiScanModal = false">✕</button>
          </div>

          <div class="ai-scan-modal-body">
            <div class="ai-meta-banner">
              <div><strong>建議表單名稱：</strong>{{ aiScanResult?.workflowName || '自訂表單' }}</div>
              <div><strong>建議表單分類：</strong><span class="field-type-tag">{{ aiScanResult?.category || '一般簽呈' }}</span></div>
              <div v-if="aiScanResult?.description" class="muted" style="margin-top:4px;font-size:0.85rem">
                說明：{{ aiScanResult.description }}
              </div>
            </div>

            <div style="margin-top:14px">
              <strong style="font-size:0.9rem">識別欄位與簽核格清單：</strong>
              <div class="ai-fields-list">
                <div v-for="(f, i) in aiScanResult?.fields || []" :key="i" class="ai-field-chip">
                  <span class="ai-field-seq">{{ i + 1 }}</span>
                  <span class="ai-field-name">{{ f.name }}</span>
                  <span class="ai-field-type" :class="'type-' + f.type">{{ f.type }}</span>
                  <span v-if="f.required" style="color:#ef4444;font-size:0.75rem">*必填</span>
                </div>
              </div>
            </div>
          </div>

          <div class="ai-scan-modal-footer">
            <button type="button" class="btn outline" style="display:inline-flex;align-items:center;gap:4px" @click="exportAiScanResult">
              <span>📥</span> 匯出 AI 建議排版 (JSON)
            </button>
            <div style="display:flex;gap:8px">
              <button type="button" class="btn outline" @click="applyAiScanResult(false)">
                ➕ 追加至現有畫布
              </button>
              <button type="button" class="btn primary" @click="applyAiScanResult(true)">
                ✨ 覆蓋套用至畫布
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { apiRequest } from '@/api/client';
import { useToastStore } from '@/stores/toast';
import { getPdfjs } from '@/lib/pdfjs';
import {
  PAGE_W,
  PAGE_H,
  kindLabel,
  loadCanvasLayouts,
  newCanvasObject,
  newPaperField,
  applyDrag,
  applyResize,
  clampBox,
  formFieldsFromObjects,
  formFieldsFromPaper,
  buildCanvasLayout,
  buildPaperLayout,
  templateFileUrl,
  detectGridBoxes,
  detectPdfWidgets,
} from '@/lib/canvas-designer';

const props = defineProps({
  mode: { type: String, default: 'objects' },
  workflowName: { type: String, default: '' },
  layout: { type: Object, default: () => ({}) },
});
const emit = defineEmits(['close', 'save']);
const toast = useToastStore();

const DIRS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const PAPER_TYPES = [
  { type: 'text', label: '文字' },
  { type: 'textarea', label: '多行' },
  { type: 'number', label: '數字' },
  { type: 'date', label: '日期' },
  { type: 'select', label: '下拉' },
  { type: 'checkbox', label: '核取' },
  { type: 'signature', label: '簽章' },
];

const scrollEl = ref(null);
const wrapEl = ref(null);
const canvasEl = ref(null);
const overlayEl = ref(null);
const zoom = ref(1);
const page = ref(1);
const pageCount = ref(1);
const scanning = ref(false);
const fileLabel = ref('');
const showAiScanModal = ref(false);
const aiScanResult = ref(null);
const objects = reactive([]);
const fields = reactive([]);
const selectedId = ref('');
const selectedCell = ref(null);
const rubber = ref(null);
const srcLayout = reactive(JSON.parse(JSON.stringify(props.layout || {})));
let pdfPage = null;
let pdfViewport = null;

const visibleItems = computed(() => {
  if (props.mode === 'objects') {
    return objects.map((o) => ({ ...o, badge: kindLabel(o.kind) }));
  }
  return fields
    .filter((f) => (Number(f.page) || 1) === page.value)
    .map((f) => ({ ...f, badge: f.name || f.type }));
});

const selected = computed(() => {
  const list = props.mode === 'objects' ? objects : fields;
  return list.find((x) => x.id === selectedId.value) || null;
});

const activeCell = computed(() => {
  const obj = selected.value;
  const c = selectedCell.value;
  if (!obj || obj.kind !== 'table' || !c || c.objId !== obj.id) return null;
  return obj.rows?.[c.row]?.cells?.[c.col] || null;
});

const bindModel = computed({
  get() {
    const o = selected.value;
    return o ? o.bind || o.fieldId || '' : '';
  },
  set(v) {
    const o = selected.value;
    if (!o) return;
    o.bind = v;
    if (o.kind === 'field') o.fieldId = v || o.fieldId;
  },
});

const cellBind = computed({
  get() {
    return activeCell.value?.bind || activeCell.value?.field || '';
  },
  set(v) {
    if (!activeCell.value) return;
    activeCell.value.bind = v;
    activeCell.value.field = v;
  },
});

const statusLine = computed(() => {
  if (props.mode === 'paper') {
    return fileLabel.value || srcLayout.templateMeta?.originalName || srcLayout.templateFile || '尚未上傳底圖';
  }
  const n = objects.length;
  return n ? `${n} 個物件` : '空白 A4 · 文字與表格皆可直接改';
});

const rubberStyle = computed(() => {
  const r = rubber.value;
  if (!r) return { display: 'none' };
  const x = Math.min(r.x, r.x2);
  const y = Math.min(r.y, r.y2);
  return {
    left: `${x * 100}%`,
    top: `${y * 100}%`,
    width: `${Math.abs(r.x2 - r.x) * 100}%`,
    height: `${Math.abs(r.y2 - r.y) * 100}%`,
  };
});

function pct(n) {
  return ((Number(n) || 0) * 100).toFixed(1);
}

function setPct(key, ev) {
  const o = selected.value;
  if (!o) return;
  o[key] = Math.max(0, Math.min(1, Number(ev.target.value) / 100));
  Object.assign(o, clampBox(o));
}

function boxStyle(item) {
  const sel = item.id === selectedId.value;
  const fill =
    item.kind === 'rect' || item.kind === 'note'
      ? item.fill || '#fffbeb'
      : item.kind === 'signature' || item.type === 'signature'
        ? 'rgba(245,158,11,0.18)'
        : props.mode === 'paper'
          ? 'rgba(14,165,233,0.18)'
          : 'transparent';
  return {
    left: `${(item.rx * 100).toFixed(3)}%`,
    top: `${(item.ry * 100).toFixed(3)}%`,
    width: `${(item.rw * 100).toFixed(3)}%`,
    height: `${(item.rh * 100).toFixed(3)}%`,
    border: sel ? '2px solid #34d399' : '1px solid #94a3b8',
    background: fill,
    zIndex: sel ? 50 : 10,
  };
}

function textStyle(item) {
  return {
    textAlign: item.align || 'left',
    fontSize: `${item.fontSize || 12}px`,
    color: item.color || '#0f172a',
    fontWeight: item.bold ? '700' : '400',
  };
}

function cellWidth(row, cell) {
  const sum = (row.cells || []).reduce((a, c) => a + (Number(c.w) || 1), 0) || 1;
  return `${(((Number(cell.w) || 1) / sum) * 100).toFixed(2)}%`;
}

function handleStyle(dir) {
  const map = {
    nw: { top: '-5px', left: '-5px', cursor: 'nwse-resize' },
    n: { top: '-5px', left: 'calc(50% - 5px)', cursor: 'ns-resize' },
    ne: { top: '-5px', right: '-5px', cursor: 'nesw-resize' },
    e: { top: 'calc(50% - 5px)', right: '-5px', cursor: 'ew-resize' },
    se: { bottom: '-5px', right: '-5px', cursor: 'nwse-resize' },
    s: { bottom: '-5px', left: 'calc(50% - 5px)', cursor: 'ns-resize' },
    sw: { bottom: '-5px', left: '-5px', cursor: 'nesw-resize' },
    w: { top: 'calc(50% - 5px)', left: '-5px', cursor: 'ew-resize' },
  };
  return map[dir];
}

function setZoom(z) {
  zoom.value = Math.max(0.4, Math.min(2.5, Math.round(z * 100) / 100));
}

function fitZoom() {
  const canvas = canvasEl.value;
  const scroll = scrollEl.value;
  if (!canvas || !scroll || !canvas.width) return;
  setZoom((scroll.clientWidth - 80) / canvas.width);
}

function paintBlank() {
  const canvas = canvasEl.value;
  if (!canvas) return;
  canvas.width = Math.round(PAGE_W * 1.5);
  canvas.height = Math.round(PAGE_H * 1.5);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#e2e8f0';
  ctx.strokeRect(0.5, 0.5, canvas.width - 1, canvas.height - 1);
}

function pointerRatio(ev) {
  const r = overlayEl.value.getBoundingClientRect();
  return {
    x: (ev.clientX - r.left) / (r.width || 1),
    y: (ev.clientY - r.top) / (r.height || 1),
    dx(from) {
      return (ev.clientX - from) / (r.width || 1);
    },
    dy(from) {
      return (ev.clientY - from) / (r.height || 1);
    },
    rect: r,
  };
}

function onBoxDown(ev, item) {
  if (ev.target.classList?.contains('handle')) return;
  selectedId.value = item.id;
  const live = (props.mode === 'objects' ? objects : fields).find((x) => x.id === item.id);
  if (!live) return;
  const start = { rx: live.rx, ry: live.ry, rw: live.rw, rh: live.rh };
  const sx = ev.clientX;
  const sy = ev.clientY;
  const move = (e) => {
    const r = overlayEl.value.getBoundingClientRect();
    Object.assign(live, applyDrag(start, (e.clientX - sx) / (r.width || 1), (e.clientY - sy) / (r.height || 1)));
  };
  const up = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}

function onResizeDown(ev, item, dir) {
  const live = (props.mode === 'objects' ? objects : fields).find((x) => x.id === item.id);
  if (!live) return;
  const start = { rx: live.rx, ry: live.ry, rw: live.rw, rh: live.rh };
  const sx = ev.clientX;
  const sy = ev.clientY;
  const move = (e) => {
    const r = overlayEl.value.getBoundingClientRect();
    Object.assign(live, applyResize(start, dir, (e.clientX - sx) / (r.width || 1), (e.clientY - sy) / (r.height || 1)));
  };
  const up = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}

function onOverlayDown(ev) {
  if (props.mode !== 'paper') {
    if (ev.target === overlayEl.value) {
      selectedId.value = '';
      selectedCell.value = null;
    }
    return;
  }
  if (ev.target !== overlayEl.value) return;
  const start = pointerRatio(ev);
  rubber.value = { x: start.x, y: start.y, x2: start.x, y2: start.y };
  const move = (e) => {
    const p = pointerRatio(e);
    if (rubber.value) {
      rubber.value.x2 = p.x;
      rubber.value.y2 = p.y;
    }
  };
  const up = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    const r = rubber.value;
    rubber.value = null;
    if (!r) return;
    const rw = Math.abs(r.x2 - r.x);
    const rh = Math.abs(r.y2 - r.y);
    if (rw < 0.02 || rh < 0.012) {
      selectedId.value = '';
      return;
    }
    const f = newPaperField({
      page: page.value,
      rx: Math.min(r.x, r.x2),
      ry: Math.min(r.y, r.y2),
      rw,
      rh,
      name: '新欄位',
    });
    fields.push(f);
    selectedId.value = f.id;
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}

function addKind(kind) {
  const obj = newCanvasObject(kind, objects[objects.length - 1]);
  objects.push(obj);
  selectedId.value = obj.id;
  selectedCell.value = null;
}

function addPaper(type) {
  const f = newPaperField({
    type,
    page: page.value,
    name: PAPER_TYPES.find((t) => t.type === type)?.label || '欄位',
    isStamp: type === 'signature',
    ry: 0.15 + (fields.filter((x) => (x.page || 1) === page.value).length % 8) * 0.06,
  });
  fields.push(f);
  selectedId.value = f.id;
}

function selectCell(item, ri, ci) {
  selectedId.value = item.id;
  selectedCell.value = { objId: item.id, row: ri, col: ci };
}

function removeSelected() {
  const list = props.mode === 'objects' ? objects : fields;
  const i = list.findIndex((x) => x.id === selectedId.value);
  if (i >= 0) list.splice(i, 1);
  selectedId.value = '';
  selectedCell.value = null;
}

function addRow() {
  const obj = selected.value;
  if (!obj || obj.kind !== 'table') return;
  const last = obj.rows[obj.rows.length - 1];
  obj.rows.push({
    h: last?.h || 30,
    cells: (last?.cells || [{ w: 1 }]).map((c) => ({ w: c.w || 1, label: c.label || '', text: '', labelW: c.labelW, bind: '' })),
  });
  obj.rh = Math.min(0.7, obj.rh + 0.035);
}

function delRow() {
  const obj = selected.value;
  if (!obj || obj.kind !== 'table' || obj.rows.length <= 1) return;
  const idx = selectedCell.value?.objId === obj.id ? selectedCell.value.row : obj.rows.length - 1;
  obj.rows.splice(Math.max(0, idx), 1);
  selectedCell.value = null;
}

function addCol() {
  const obj = selected.value;
  if (!obj || obj.kind !== 'table') return;
  obj.rows.forEach((row) => row.cells.push({ w: 0.2, text: '', label: '新欄' }));
}

function delCol() {
  const obj = selected.value;
  if (!obj || obj.kind !== 'table') return;
  const ci = selectedCell.value?.objId === obj.id ? selectedCell.value.col : null;
  obj.rows.forEach((row) => {
    if (row.cells.length <= 1) return;
    row.cells.splice(ci != null ? ci : row.cells.length - 1, 1);
  });
  selectedCell.value = null;
}

function onKey(e) {
  if (e.key === 'Escape') emit('close');
  if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId.value && !['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) {
    e.preventDefault();
    removeSelected();
  }
}

async function drawTemplate() {
  const canvas = canvasEl.value;
  const file = srcLayout.templateFile;
  if (!canvas) return;
  if (!file) {
    paintBlank();
    pdfPage = null;
    return;
  }
  const url = templateFileUrl(file);
  const token = localStorage.getItem('approval_token') || '';
  const authed = url + (url.includes('?') ? '&' : '?') + `token=${encodeURIComponent(token)}`;
  if (/\.pdf(\?.*)?$/i.test(file)) {
    const pdfjsLib = await getPdfjs();
    const task = pdfjsLib.getDocument({
      url: authed,
      httpHeaders: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const pdf = await task.promise;
    pageCount.value = pdf.numPages || 1;
    page.value = Math.min(Math.max(1, page.value), pageCount.value);
    const pg = await pdf.getPage(page.value);
    const viewport = pg.getViewport({ scale: 1.5 });
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await pg.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    pdfPage = pg;
    pdfViewport = viewport;
  } else {
    await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        canvas.width = img.width || Math.round(PAGE_W * 1.5);
        canvas.height = img.height || Math.round(PAGE_H * 1.5);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        pageCount.value = 1;
        pdfPage = null;
        resolve();
      };
      img.onerror = () => reject(new Error('底圖載入失敗'));
      img.src = authed;
    });
  }
}

async function changePage(delta) {
  page.value = Math.min(pageCount.value, Math.max(1, page.value + delta));
  await drawTemplate();
}

async function onUpload(ev) {
  const file = ev.target.files?.[0];
  ev.target.value = '';
  if (!file) return;
  const fd = new FormData();
  fd.append('file', file);
  fileLabel.value = '正在上傳底圖…';
  try {
    const data = await apiRequest('/api/workflows/upload-template', { method: 'POST', body: fd });
    srcLayout.templateFile = data.templateFile;
    srcLayout.templateMeta = { originalName: data.originalName, size: data.size, mimeType: data.mimeType };
    fileLabel.value = `${data.originalName} (${(data.size / 1024).toFixed(1)} KB)`;
    page.value = 1;
    await drawTemplate();
  } catch (err) {
    fileLabel.value = err.message || '上傳失敗';
  }
}

async function scan() {
  scanning.value = true;
  try {
    // 1. 優先使用地端 AI 進行視覺與文字結構排版分析
    let textItems = [];
    if (pdfPage) {
      try {
        const textContent = await pdfPage.getTextContent();
        textItems = (textContent.items || [])
          .map((item) => ({
            text: String(item.str || '').trim(),
            x: Math.round(item.transform[4]),
            y: Math.round(item.transform[5]),
            w: Math.round(item.width),
            h: Math.round(item.height),
          }))
          .filter((it) => it.text);
      } catch (err) {
        console.warn('[AI] 提取 PDF 文字結構失敗:', err);
      }
    }

    let imageBase64 = null;
    if (canvasEl.value) {
      try {
        imageBase64 = canvasEl.value.toDataURL('image/jpeg', 0.85);
      } catch (e) {
        console.warn('[AI] 擷取畫布底圖失敗:', e);
      }
    }

    if (imageBase64 || textItems.length > 0) {
      try {
        const aiRes = await apiRequest('/api/ai/scan-form', {
          method: 'POST',
          body: {
            imageBase64,
            textItems,
            width: canvasEl.value?.width || 595,
            height: canvasEl.value?.height || 842,
            page: page.value,
          },
        });

        if (aiRes && aiRes.success && Array.isArray(aiRes.fields) && aiRes.fields.length > 0) {
          aiScanResult.value = aiRes;
          showAiScanModal.value = true;
          fileLabel.value = `AI 識別 ${aiRes.fields.length} 個欄位/簽章`;
          toast.success(`AI 掃描完成！識別出 ${aiRes.fields.length} 個欄位`);
          return;
        }
      } catch (aiErr) {
        console.warn('[AI] 智慧掃描失敗，回退至本地特徵檢測:', aiErr);
      }
    }

    // 2. 本地回退檢測
    let found = [];
    if (pdfPage && pdfViewport) found = await detectPdfWidgets(pdfPage, pdfViewport, page.value);
    if (!found.length && canvasEl.value) {
      found = detectGridBoxes(canvasEl.value).map((b) => newPaperField({ ...b, page: page.value }));
    }
    if (!found.length) {
      fileLabel.value = '沒有掃到可建立的欄位';
      toast.warning('未能自動識別欄位，您可使用右側面板手動新增');
      return;
    }
    fields.push(...found);
    selectedId.value = found[found.length - 1].id;
    fileLabel.value = `已掃描 ${found.length} 個欄位`;
    toast.success(`已檢測並建立 ${found.length} 個欄位`);
  } catch (err) {
    toast.error(err.message || '掃描失敗');
  } finally {
    scanning.value = false;
  }
}

function exportAiScanResult() {
  if (!aiScanResult.value) return;
  const jsonStr = JSON.stringify(aiScanResult.value, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `AI掃描建議排版_${aiScanResult.value.workflowName || '表單'}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast.success('已匯出 AI 建議排版 JSON 檔案');
}

function applyAiScanResult(overwrite = false) {
  if (!aiScanResult.value) return;
  const newFields = (aiScanResult.value.fields || []).map((f) =>
    newPaperField({
      name: f.name,
      type: f.type,
      rx: f.rx,
      ry: f.ry,
      rw: f.rw,
      rh: f.rh,
      required: f.required,
      options: f.options,
      page: page.value,
    })
  );

  if (props.mode === 'objects') {
    if (overwrite) {
      objects.splice(0, objects.length, ...(aiScanResult.value.canvasObjects || []));
    } else {
      objects.push(...(aiScanResult.value.canvasObjects || []));
    }
  } else {
    if (overwrite) {
      fields.splice(0, fields.length, ...newFields);
    } else {
      fields.push(...newFields);
    }
    if (newFields.length) selectedId.value = newFields[newFields.length - 1].id;
  }

  showAiScanModal.value = false;
  toast.success(`已套用 AI 建議排版（共 ${newFields.length} 個欄位與簽章格）`);
}

function save() {
  if (props.mode === 'objects') {
    emit('save', {
      pdfLayout: buildCanvasLayout(srcLayout, JSON.parse(JSON.stringify(objects))),
      formFields: formFieldsFromObjects(objects),
    });
    return;
  }
  if (!srcLayout.templateFile && !fields.length) {
    fileLabel.value = '請先上傳紙本底圖或新增欄位';
    return;
  }
  emit('save', {
    pdfLayout: buildPaperLayout(srcLayout, JSON.parse(JSON.stringify(fields)), srcLayout.templateFile),
    formFields: formFieldsFromPaper(fields),
  });
}

onMounted(async () => {
  if (props.mode === 'objects') {
    const incoming = Array.isArray(srcLayout.objects) ? srcLayout.objects : [];
    if (incoming.length) objects.push(...JSON.parse(JSON.stringify(incoming)));
    else {
      const layouts = await loadCanvasLayouts();
      const src = srcLayout.sourceType || 'general';
      const preset = layouts?.builtinToCanvasLayout?.(src) || null;
      if (preset?.objects?.length) {
        objects.push(...JSON.parse(JSON.stringify(preset.objects)));
        srcLayout.sourceType = preset.sourceType;
        srcLayout.page = preset.page;
        srcLayout.label = preset.label;
      }
    }
    paintBlank();
  } else {
    if (Array.isArray(srcLayout.fields)) fields.push(...JSON.parse(JSON.stringify(srcLayout.fields)));
    fileLabel.value = srcLayout.templateMeta?.originalName || srcLayout.templateFile || '';
    try {
      await drawTemplate();
    } catch (err) {
      paintBlank();
      fileLabel.value = err.message || '底圖載入失敗';
    }
  }
  fitZoom();
});
</script>

<style scoped>
.pdf-designer {
  position: fixed;
  inset: 0;
  z-index: 99999;
  display: flex;
  flex-direction: column;
  background: #0b0f19;
  color: #f8fafc;
  font-family: system-ui, "Noto Sans TC", sans-serif;
}
.pdf-designer-bar {
  min-height: 56px;
  background: #1e293b;
  border-bottom: 1px solid #334155;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 16px;
  flex-wrap: wrap;
}
.pdf-designer-title, .pdf-designer-tools { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.chip, .file-name { color: #94a3b8; font-size: 0.82rem; }
.chip { background: #0f172a; border: 1px solid #334155; border-radius: 4px; padding: 3px 8px; }
.tool-btn, .add-grid button, .table-tools button, .danger {
  background: #334155;
  color: #fff;
  border: 1px solid #475569;
  border-radius: 6px;
  padding: 4px 10px;
  cursor: pointer;
  font-size: 0.82rem;
}
.tool-btn.accent { background: linear-gradient(135deg, #7c3aed, #4f46e5); border: none; }
.tool-btn.save { background: #059669; border-color: #047857; font-weight: 700; }
.tool-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.zoom-val { min-width: 52px; text-align: center; color: #34d399; font-size: 0.82rem; }
.pdf-designer-body { flex: 1; display: flex; min-height: 0; }
.pdf-designer-stage {
  flex: 1;
  overflow: auto;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 36px;
  background: #080c14;
}
.pdf-designer-page {
  position: relative;
  background: #fff;
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.6);
  transform-origin: top center;
}
.pdf-designer-page canvas { display: block; }
.pdf-designer-overlay { position: absolute; inset: 0; }
.designer-box { position: absolute; box-sizing: border-box; cursor: move; overflow: visible; }
.box-badge {
  position: absolute;
  top: -16px;
  left: 0;
  font-size: 10px;
  background: #334155;
  color: #fff;
  padding: 1px 6px;
  border-radius: 4px;
  pointer-events: none;
}
.selected .box-badge { background: #047857; }
.obj-text { width: 100%; height: 100%; overflow: hidden; padding: 2px 4px; pointer-events: none; }
.obj-table { width: 100%; height: 100%; border-collapse: collapse; font-size: 11px; color: #0f172a; background: #fff; }
.obj-table td { border: 1px solid #94a3b8; vertical-align: top; }
.cell-inner { display: flex; min-height: 18px; }
.cell-label { background: #f1f5f9; padding: 2px 4px; color: #475569; }
.cell-value { padding: 2px 4px; flex: 1; }
.handle { position: absolute; width: 10px; height: 10px; background: #fff; border: 2px solid #34d399; border-radius: 2px; z-index: 5; }
.rubber { position: absolute; border: 1px dashed #38bdf8; background: rgba(56, 189, 248, 0.15); pointer-events: none; }
.pdf-designer-side {
  width: 320px;
  background: #1e293b;
  border-left: 1px solid #334155;
  overflow: auto;
  padding: 14px;
  flex-shrink: 0;
}
.add-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 12px; }
.add-grid .wide { grid-column: 1 / -1; }
.empty-side { color: #64748b; text-align: center; margin-top: 28px; line-height: 1.6; font-size: 0.85rem; }
.prop-form { display: flex; flex-direction: column; gap: 8px; font-size: 0.84rem; }
.prop-form label { display: flex; flex-direction: column; gap: 4px; color: #94a3b8; }
.prop-form input, .prop-form textarea, .prop-form select {
  background: #0f172a;
  color: #f8fafc;
  border: 1px solid #334155;
  border-radius: 6px;
  padding: 6px 8px;
}
.prop-head, .two, .coords { display: grid; gap: 8px; }
.prop-head { grid-template-columns: 1fr auto; align-items: center; }
.two, .coords { grid-template-columns: 1fr 1fr; }
.danger { background: #dc2626; border-color: #b91c1c; }
.table-tools { background: #0f172a; border: 1px solid #334155; border-radius: 6px; padding: 8px; display: flex; flex-direction: column; gap: 8px; }
.check { flex-direction: row !important; align-items: center; }
.hidden { display: none; }

/* AI Scan Modal */
.ai-scan-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.65);
  backdrop-filter: blur(4px);
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
.ai-scan-modal-card {
  background: #ffffff;
  border-radius: 12px;
  width: 100%;
  max-width: 620px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 8px 10px -6px rgba(0, 0, 0, 0.2);
  overflow: hidden;
  color: #1e293b;
}
.ai-scan-modal-header {
  padding: 14px 18px;
  border-bottom: 1px solid var(--border, #e2e8f0);
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #f8fafc;
}
.ai-scan-modal-body {
  padding: 16px 18px;
  overflow-y: auto;
}
.ai-meta-banner {
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 0.9rem;
  color: #166534;
}
.ai-fields-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
  max-height: 220px;
  overflow-y: auto;
  padding: 4px;
}
.ai-field-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: #f8fafc;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 0.85rem;
}
.ai-field-seq {
  color: #64748b;
  font-weight: 600;
  font-size: 0.78rem;
}
.ai-field-name {
  font-weight: 500;
}
.ai-field-type {
  font-size: 0.75rem;
  padding: 1px 6px;
  border-radius: 4px;
  background: #e2e8f0;
  color: #334155;
}
.ai-field-type.type-signature {
  background: #fef3c7;
  color: #92400e;
  font-weight: 600;
}
.ai-field-type.type-date {
  background: #e0f2fe;
  color: #0369a1;
}
.ai-field-type.type-number {
  background: #dcfce7;
  color: #15803d;
}
.ai-scan-modal-footer {
  padding: 12px 18px;
  border-top: 1px solid var(--border, #e2e8f0);
  background: #f8fafc;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
</style>
