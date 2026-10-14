<template>
  <div class="modal">
    <div class="modal-backdrop" @click="$emit('close')"></div>
    <div class="modal-panel">
      <h3 style="margin-top:0">{{ title }}</h3>
      <p class="muted">請在下方白板以滑鼠或觸控筆簽名。</p>
      <canvas
        ref="canvasEl"
        width="460"
        height="200"
        style="width:100%;max-width:460px;height:200px;background:#fff;border:1px solid #e2e8f0;border-radius:8px;cursor:crosshair;touch-action:none"
        @pointerdown="start"
        @pointermove="move"
        @pointerup="end"
        @pointerleave="end"
      ></canvas>
      <div class="form-actions">
        <button type="button" class="btn outline" @click="clear">清除重寫</button>
        <button type="button" class="btn primary" @click="save">確定儲存</button>
        <button type="button" class="btn ghost" @click="$emit('close')">取消</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { useToastStore } from '@/stores/toast';

const props = defineProps({
  title: { type: String, default: '手寫電子簽名' },
  initialImage: { type: String, default: '' },
});
const emit = defineEmits(['close', 'save']);
const toast = useToastStore();
const canvasEl = ref(null);
let drawing = false;
let hasDrawn = false;

function ctx() {
  const c = canvasEl.value.getContext('2d');
  c.lineWidth = 3;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.strokeStyle = '#0f172a';
  return c;
}
function pos(e) {
  const canvas = canvasEl.value;
  const r = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) * (canvas.width / r.width),
    y: (e.clientY - r.top) * (canvas.height / r.height),
  };
}
function start(e) {
  drawing = true;
  const p = pos(e);
  const c = ctx();
  c.beginPath();
  c.moveTo(p.x, p.y);
}
function move(e) {
  if (!drawing) return;
  const p = pos(e);
  const c = ctx();
  c.lineTo(p.x, p.y);
  c.stroke();
  hasDrawn = true;
}
function end() {
  drawing = false;
}
function clear() {
  const canvas = canvasEl.value;
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  hasDrawn = false;
}
function save() {
  if (!hasDrawn) return toast.error('請先簽名');
  emit('save', canvasEl.value.toDataURL('image/png'));
}

onMounted(() => {
  if (!props.initialImage) return;
  const img = new Image();
  img.onload = () => {
    ctx().drawImage(img, 0, 0, canvasEl.value.width, canvasEl.value.height);
    hasDrawn = true;
  };
  img.src = props.initialImage;
});
</script>
