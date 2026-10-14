<template>
  <div class="field field-full" data-col-span="full">
    <label>
      {{ field.label }}
      <span v-if="field.required"> *</span>
    </label>
    <div class="re-toolbar">
      <div class="re-toolbar-row">
        <button type="button" class="re-btn" title="粗體" @mousedown.prevent="cmd('bold')"><b>B</b></button>
        <button type="button" class="re-btn" title="斜體" @mousedown.prevent="cmd('italic')"><i>I</i></button>
        <button type="button" class="re-btn" title="底線" @mousedown.prevent="cmd('underline')"><u>U</u></button>
        <select class="re-size" title="字級" @change="cmd('fontSize', $event.target.value); $event.target.value = ''">
          <option value="">字級</option>
          <option value="2">小</option>
          <option value="3">標準</option>
          <option value="4">稍大</option>
          <option value="5">大</option>
        </select>
        <button v-for="c in COLORS" :key="c" type="button" class="re-color" :style="{ background: c }" :title="c" @mousedown.prevent="cmd('foreColor', c)"></button>
        <button type="button" class="re-btn" title="插入表格" @mousedown.prevent="insertTable">表格</button>
      </div>
      <div class="re-toolbar-hint">可從 Word／Excel 直接貼上（會保留粗體、顏色、字級、表格與段落）</div>
    </div>
    <div
      ref="surface"
      class="re-surface"
      contenteditable="true"
      :data-placeholder="field.placeholder || '可輸入文字、設定顏色／字級、插入或貼上表格…'"
      @input="sync"
      @paste="onPaste"
    ></div>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useFormCtx } from '@/lib/form/context';
import { normalizeFormTable } from '@/lib/form/table';
import { plainToRichHtml, sanitizeRichHtml } from '@/lib/form/rich';

const props = defineProps({
  field: { type: Object, required: true },
});
const ctx = useFormCtx();
const surface = ref(null);
const COLORS = ['#111827', '#b91c1c', '#c2410c', '#15803d', '#1d4ed8', '#7e22ce'];
let applying = false;

function initialHtml() {
  let initial = ctx.data.value[props.field.id] != null ? String(ctx.data.value[props.field.id]) : '';
  const legacy = ctx.data.value[`${props.field.id}__table`];
  const t = normalizeFormTable(legacy);
  if (t && !/<table/i.test(initial)) {
    const rows = t.cells
      .map(
        (row, ri) =>
          `<tr>${(row || [])
            .map((c) => {
              const tag = ri === 0 ? 'th' : 'td';
              return `<${tag} style="border:1px solid #94a3b8;padding:6px 8px">${String(c ?? '')}</${tag}>`;
            })
            .join('')}</tr>`
      )
      .join('');
    const tbl = `<table border="1" style="border-collapse:collapse;width:100%"><tbody>${rows}</tbody></table>`;
    initial = initial ? initial + tbl : tbl;
  }
  return plainToRichHtml(initial) || '<div><br></div>';
}

function currentHtml() {
  return sanitizeRichHtml(surface.value?.innerHTML || '');
}

function sync() {
  if (applying || !surface.value) return;
  ctx.set(props.field.id, currentHtml());
}

function cmd(command, value) {
  surface.value?.focus();
  document.execCommand(command, false, value);
  sync();
}

function insertTable() {
  cmd(
    'insertHTML',
    '<table border="1" style="border-collapse:collapse;width:100%"><tbody><tr><th style="border:1px solid #94a3b8;padding:6px">欄1</th><th style="border:1px solid #94a3b8;padding:6px">欄2</th></tr><tr><td style="border:1px solid #94a3b8;padding:6px"> </td><td style="border:1px solid #94a3b8;padding:6px"> </td></tr></tbody></table><div><br></div>'
  );
}

function onPaste(e) {
  const html = e.clipboardData?.getData('text/html');
  const text = e.clipboardData?.getData('text/plain');
  if (!html && !text) return;
  e.preventDefault();
  const clean = html ? sanitizeRichHtml(html) : plainToRichHtml(text);
  document.execCommand('insertHTML', false, clean);
  sync();
}

onMounted(() => {
  if (surface.value) surface.value.innerHTML = initialHtml();
});

watch(
  () => ctx.data.value[props.field.id],
  (v) => {
    if (!surface.value) return;
    const next = plainToRichHtml(v == null ? '' : String(v));
    if (sanitizeRichHtml(surface.value.innerHTML) === sanitizeRichHtml(next)) return;
    applying = true;
    surface.value.innerHTML = next || '<div><br></div>';
    applying = false;
  }
);

onBeforeUnmount(sync);
</script>

<style scoped>
.re-surface {
  min-height: 140px;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  background: #fff;
  line-height: 1.55;
}
.re-surface:focus { outline: 2px solid #93c5fd; }
.re-color { width: 16px; height: 16px; border: 1px solid #cbd5e1; border-radius: 3px; padding: 0; cursor: pointer; }
</style>
