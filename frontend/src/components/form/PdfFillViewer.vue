<template>
  <div class="field" style="grid-column:1/-1;margin-bottom:16px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;padding:8px 12px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:6px;gap:8px;flex-wrap:wrap">
      <div>
        <strong style="color:#0369a1">📄 紙本表單填寫區</strong>
        <span class="muted" style="font-size:0.85rem;margin-left:6px">請直接在下方原紙本底圖的框線中輸入或勾選</span>
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        <button v-if="pageCount > 1" type="button" class="btn sm outline" :disabled="page <= 1" @click="page--">◀</button>
        <span class="tag info" style="font-size:0.8rem">第 {{ page }} / {{ pageCount }} 頁</span>
        <button v-if="pageCount > 1" type="button" class="btn sm outline" :disabled="page >= pageCount" @click="page++">▶</button>
      </div>
    </div>
    <div v-if="error" class="error-msg" style="padding:12px">{{ error }}</div>
    <div v-else class="pdf-fill-stage">
      <div class="pdf-fill-page">
        <canvas ref="canvasEl"></canvas>
        <div class="pdf-fill-overlay">
          <div
            v-for="f in pageFields"
            :key="f.id || f.name"
            class="pdf-fill-box"
            :style="boxStyle(f)"
          >
            <textarea
              v-if="f.type === 'textarea'"
              :value="textValue(f)"
              :placeholder="f.name || ''"
              :required="!!f.required"
              :style="inputStyle(f)"
              @input="emit('change', f.id, $event.target.value)"
            ></textarea>
            <input
              v-else-if="f.type === 'checkbox'"
              type="checkbox"
              :checked="isChecked(f)"
              @change="emit('change', f.id, $event.target.checked)"
            />
            <select
              v-else-if="f.type === 'select'"
              :value="textValue(f)"
              :style="inputStyle(f)"
              @change="emit('change', f.id, $event.target.value)"
            >
              <option value="">請選擇…</option>
              <option v-for="o in f.options || []" :key="o" :value="o">{{ o }}</option>
            </select>
            <div v-else-if="f.type === 'signature' || f.isStamp" class="pdf-stamp">{{ f.name || '簽核蓋章處' }}</div>
            <input
              v-else
              :type="f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'"
              :value="textValue(f)"
              :placeholder="f.name || ''"
              :required="!!f.required"
              :style="inputStyle(f)"
              @input="emit('change', f.id, $event.target.value)"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { templateFileUrl } from '@/lib/canvas-designer';
import { getPdfjs } from '@/lib/pdfjs';

const props = defineProps({
  templateFile: { type: String, required: true },
  fields: { type: Array, default: () => [] },
  formData: { type: Object, default: () => ({}) },
});
const emit = defineEmits(['change']);

const canvasEl = ref(null);
const error = ref('');
const page = ref(1);
const pageCount = ref(1);

const pageFields = computed(() =>
  (props.fields || []).filter((f) => (Number(f.page) || 1) === page.value)
);

function textValue(f) {
  const v = props.formData?.[f.id];
  if (v !== undefined && v !== null && v !== '') return v;
  return props.formData?.[f.name] || '';
}
function isChecked(f) {
  const v = props.formData?.[f.id];
  return v === true || v === 'true' || v === 1 || v === '1';
}
function boxStyle(f) {
  return {
    left: `${(Number(f.rx) || 0) * 100}%`,
    top: `${(Number(f.ry) || 0) * 100}%`,
    width: `${(Number(f.rw) || 0.1) * 100}%`,
    height: `${(Number(f.rh) || 0.04) * 100}%`,
  };
}
function inputStyle(f) {
  return {
    fontSize: `${f.fontSize || 12}px`,
    textAlign: f.align || 'left',
  };
}

async function draw() {
  const canvas = canvasEl.value;
  if (!canvas || !props.templateFile) return;
  error.value = '';
  const file = props.templateFile;
  const url = templateFileUrl(file);
  const token = localStorage.getItem('approval_token') || '';
  const authed = url.includes('token=') ? url : url + (url.includes('?') ? '&' : '?') + `token=${encodeURIComponent(token)}`;
  try {
    if (/\.pdf(\?.*)?$/i.test(file)) {
      const pdfjsLib = await getPdfjs();
      const pdf = await pdfjsLib.getDocument({
        url: authed,
        httpHeaders: token ? { Authorization: `Bearer ${token}` } : {},
      }).promise;
      pageCount.value = pdf.numPages || 1;
      if (page.value > pageCount.value) page.value = 1;
      const pg = await pdf.getPage(page.value);
      const viewport = pg.getViewport({ scale: 1.5 });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await pg.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    } else {
      await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          canvas.width = img.width || 800;
          canvas.height = img.height || 1130;
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          pageCount.value = 1;
          resolve();
        };
        img.onerror = () => reject(new Error('底圖載入失敗'));
        img.src = authed;
      });
    }
  } catch (e) {
    error.value = e.message || '紙本底圖載入失敗';
  }
}

onMounted(draw);
watch(() => [props.templateFile, page.value], draw);
</script>

<style scoped>
.pdf-fill-stage { overflow: auto; background: #fff; border: 1px solid #cbd5e1; border-radius: 8px; }
.pdf-fill-page { position: relative; display: inline-block; }
.pdf-fill-page canvas { display: block; max-width: 100%; height: auto; }
.pdf-fill-overlay { position: absolute; inset: 0; }
.pdf-fill-box { position: absolute; display: flex; align-items: center; box-sizing: border-box; }
.pdf-fill-box input, .pdf-fill-box textarea, .pdf-fill-box select {
  width: 100%;
  height: 100%;
  background: rgba(255,255,255,.85);
  border: 1px solid #93c5fd;
  border-radius: 3px;
  padding: 2px 4px;
}
.pdf-fill-box textarea { resize: none; }
.pdf-stamp {
  width: 100%;
  height: 100%;
  border: 1px dashed #94a3b8;
  color: #94a3b8;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  border-radius: 3px;
}
</style>
