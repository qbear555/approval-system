<template>
  <div v-if="visible" class="att-viewer-overlay" @click.self="close">
    <div class="att-viewer-panel" style="max-width:820px;height:auto;max-height:90vh">
      <div class="att-viewer-header">
        <div class="att-header-info">
          <h3 class="att-header-title">附加已核准申請單</h3>
          <p class="att-header-filename">選擇已簽核完成的申請單，送出後會以 PDF 作為本單附件。</p>
        </div>
        <div class="att-header-actions">
          <button type="button" class="btn outline sm" @click="close">取消</button>
        </div>
      </div>
      <div class="att-viewer-body" style="padding:16px;overflow:auto">
        <div class="field" style="margin-bottom:8px">
          <input v-model="query" type="search" placeholder="搜尋單號、主旨、流程、申請人…" autocomplete="off" />
        </div>
        <div class="appr-pick-list">
          <div v-if="loading" class="muted" style="padding:16px">載入中…</div>
          <div v-else-if="error" class="error-msg" style="padding:16px">{{ error }}</div>
          <div v-else-if="!visibleRows.length" class="muted" style="padding:16px">沒有符合的已核准申請單</div>
          <template v-else>
            <div v-for="r in visibleRows" :key="r.id" class="appr-pick-row">
              <label class="appr-pick-check">
                <input
                  type="checkbox"
                  :value="r.id"
                  :checked="picked.has(Number(r.id)) || already.has(Number(r.id))"
                  :disabled="already.has(Number(r.id))"
                  @change="toggle(r, $event.target.checked)"
                />
                <span>
                  <strong>#{{ r.id }}</strong>
                  <span v-if="r.workflow_name" class="tag" style="margin-left:6px">{{ r.workflow_name }}</span>
                  <div style="margin-top:2px">{{ r.title || '' }}</div>
                  <div class="muted" style="font-size:0.8rem">
                    {{ r.requester_name || '' }}
                    <template v-if="r.completed_at"> · {{ String(r.completed_at).replace('T', ' ').slice(0, 16) }}</template>
                    <template v-if="already.has(Number(r.id))"> · 已加入</template>
                  </div>
                </span>
              </label>
              <button type="button" class="btn outline sm" @click="preview(r)">
                {{ previewId === r.id ? '收合預覽' : '預覽' }}
              </button>
            </div>
            <div v-if="previewUrl" class="appr-pick-iframe-wrap">
              <iframe class="appr-pick-iframe" :title="previewTitle" :src="previewUrl + '#toolbar=1&navpanes=0&view=FitH'"></iframe>
            </div>
          </template>
        </div>
        <div class="modal-actions" style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <button type="button" class="btn primary" :disabled="!picked.size" @click="confirm">加入附件</button>
          <button type="button" class="btn outline" @click="close">取消</button>
          <span class="muted" style="font-size:0.85rem">{{ picked.size ? `已選 ${picked.size} 張` : '' }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { fetchApprovedForAttach, fetchRequestPdf } from '@/api/requests';
import { useToastStore } from '@/stores/toast';
import { formatApprovedRequestLabel } from '@/lib/new-request';

const props = defineProps({
  visible: { type: Boolean, default: false },
  excludeIds: { type: Array, default: () => [] },
  alreadySelected: { type: Array, default: () => [] },
});
const emit = defineEmits(['close', 'confirm']);

const toast = useToastStore();
const query = ref('');
const loading = ref(false);
const error = ref('');
const rows = ref([]);
const picked = ref(new Set());
const previewId = ref(0);
const previewUrl = ref('');
const previewTitle = ref('');
let debounce = null;
let previewObjectUrl = '';

const exclude = computed(() => new Set((props.excludeIds || []).map(Number).filter((n) => n > 0)));
const already = computed(() => new Set((props.alreadySelected || []).map(Number).filter((n) => n > 0)));
const visibleRows = computed(() => rows.value.filter((r) => !exclude.value.has(Number(r.id))));

function revokePreview() {
  if (previewObjectUrl) {
    try {
      URL.revokeObjectURL(previewObjectUrl);
    } catch {
      /* ignore */
    }
    previewObjectUrl = '';
  }
  previewUrl.value = '';
  previewId.value = 0;
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const params = { limit: 80 };
    if (query.value.trim()) params.q = query.value.trim();
    if (exclude.value.size === 1) params.exclude_id = [...exclude.value][0];
    const data = await fetchApprovedForAttach(params);
    rows.value = data.requests || [];
  } catch (e) {
    error.value = e.message || '載入失敗';
  } finally {
    loading.value = false;
  }
}

function toggle(r, on) {
  const next = new Set(picked.value);
  if (on) next.add(Number(r.id));
  else next.delete(Number(r.id));
  picked.value = next;
}

async function preview(r) {
  if (previewId.value === r.id) {
    revokePreview();
    return;
  }
  try {
    const blob = await fetchRequestPdf(r.id, { preview: true });
    revokePreview();
    const pdfBlob =
      String(blob.type || '').includes('pdf') || !blob.type
        ? blob
        : new Blob([await blob.arrayBuffer()], { type: 'application/pdf' });
    previewObjectUrl = URL.createObjectURL(pdfBlob);
    previewUrl.value = previewObjectUrl;
    previewId.value = r.id;
    previewTitle.value = formatApprovedRequestLabel(r);
  } catch (e) {
    toast.error(e.message || '預覽失敗');
  }
}

function confirm() {
  const selected = rows.value.filter((r) => picked.value.has(Number(r.id)) && !already.value.has(Number(r.id)));
  emit('confirm', selected);
  close();
}

function close() {
  emit('close');
}

watch(
  () => props.visible,
  (on) => {
    if (on) {
      query.value = '';
      picked.value = new Set();
      revokePreview();
      load();
    } else {
      revokePreview();
    }
  }
);

watch(query, () => {
  if (!props.visible) return;
  clearTimeout(debounce);
  debounce = setTimeout(load, 280);
});
</script>
