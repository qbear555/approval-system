<template>
  <div class="field field-full" data-col-span="full">
    <label>
      {{ field.label }}
      <span v-if="field.required"> *</span>
    </label>
    <select
      :value="model"
      :required="field.required"
      :disabled="loading"
      @change="onChange($event.target.value)"
    >
      <option value="">{{ loading ? '載入已核准申請單…' : emptyLabel }}</option>
      <option v-for="r in list" :key="r.id" :value="String(r.id)">{{ optionLabel(r) }}</option>
    </select>
    <p class="muted" style="font-size:0.82rem;margin:4px 0 0">
      選定後，簽核流程會改為該單<strong>實際簽核人</strong>依序再簽；全部通過後原單自動改為已作廢。
    </p>
    <div v-if="error" class="error-msg">{{ error }}</div>
    <div v-else-if="previewHtml" class="muted" style="margin-top:10px" v-html="previewHtml"></div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useFormCtx } from '@/lib/form/context';
import { fetchVoidPreview, fetchVoidTargets } from '@/api/requests';
import { escapeHtml } from '@/lib/form';

const props = defineProps({
  field: { type: Object, required: true },
});

const ctx = useFormCtx();
const list = ref([]);
const loading = ref(false);
const error = ref('');
const previewHtml = ref('');
const model = computed(() => String(ctx.data.value.void_target_id || ''));
const emptyLabel = computed(() => (list.value.length ? '請選擇已核准申請單…' : '目前沒有可作廢的已核准申請'));

function optionLabel(r) {
  const when = String(r.completed_at || '').slice(0, 16);
  return `#${r.id}　${r.title}${r.requester_name ? `（${r.requester_name}）` : ''}${when ? `　${when}` : ''}`;
}

function voidStepsPathText(steps) {
  const names = (steps || []).map((s) => String(s.name || '').trim()).filter(Boolean);
  return names.length ? `申請人送出 → ${names.join(' → ')} → 原單自動作廢` : '';
}

async function loadList() {
  loading.value = true;
  error.value = '';
  try {
    const data = await fetchVoidTargets();
    list.value = data.requests || [];
  } catch (e) {
    error.value = e.message || '載入失敗';
  } finally {
    loading.value = false;
  }
}

async function loadPreview(id) {
  if (!id) {
    previewHtml.value = '';
    return;
  }
  try {
    const p = await fetchVoidPreview(id);
    const steps = p.steps || [];
    const chart =
      typeof window !== 'undefined' && typeof window.flowChartHtml === 'function'
        ? window.flowChartHtml(steps, { showLegend: false })
        : '';
    previewHtml.value = `
      <div class="muted" style="margin-bottom:6px">此作廢申請將由原單簽核人依序核准：</div>
      ${chart}
      <div class="muted" style="margin-top:6px">${escapeHtml(voidStepsPathText(steps))}</div>`;
  } catch (e) {
    previewHtml.value = `<div class="error-msg">${escapeHtml(e.message || '無法預覽')}</div>`;
  }
}

function onChange(v) {
  ctx.set('void_target_id', v);
}

watch(model, (v) => loadPreview(Number(v) || 0));
onMounted(async () => {
  await loadList();
  if (model.value) loadPreview(Number(model.value));
});
</script>
