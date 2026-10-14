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
            <button type="button" class="tool-btn accent" :disabled="scanning" @click="scan">
              {{ scanning ? '掃描中…' : '✨ 智慧掃描' }}
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
    </div>
  </Teleport>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { apiRequest } from '@/api/client';
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
    let found = [];
    if (pdfPage && pdfViewport) found = await detectPdfWidgets(pdfPage, pdfViewport, page.value);
    if (!found.length && canvasEl.value) {
      found = detectGridBoxes(canvasEl.value).map((b) => newPaperField({ ...b, page: page.value }));
    }
    if (!found.length) {
      fileLabel.value = '沒有掃到可建立的欄位';
      return;
    }
    fields.push(...found);
    selectedId.value = found[found.length - 1].id;
    fileLabel.value = `已掃描 ${found.length} 個欄位`;
  } finally {
    scanning.value = false;
  }
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
</style>
