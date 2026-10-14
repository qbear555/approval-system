<template>
  <div v-if="list.length" class="attachment-list">
    <h3 v-if="title" style="margin-top:20px">{{ title }}</h3>
    <p v-if="onlyOfficeEnabled" class="muted" style="font-size:0.82rem;margin:0 0 8px">
      {{ canEdit ? 'Word／Excel 可「線上編輯」後自動回存（需 OnlyOffice）。' : '簽核已完成，附件僅供「線上檢視」，無法再修改。' }}
    </p>
    <ul style="margin:0;padding-left:18px">
      <li v-for="a in list" :key="a.id" style="margin:6px 0;display:flex;flex-wrap:wrap;align-items:center;gap:8px">
        <button type="button" class="linkish" @click="open(a)">{{ a.original_name }}</button>
        <span v-if="a.source_request_id" class="tag" style="background:#ecfdf5;color:#047857">
          已核准申請單 #{{ a.source_request_id }}
        </span>
        <button v-if="isPreviewable(a)" type="button" class="btn outline sm" @click="open(a)">線上檢視</button>
        <button v-if="onlyOfficeEnabled && isOffice(a.original_name)" type="button" class="btn outline sm" @click="$emit('office', a)">
          {{ canEdit ? '線上編輯' : '線上檢視' }}
        </button>
        <span class="muted" style="font-size:0.82rem">
          {{ a.size_bytes ? ` · ${fmtSize(a.size_bytes)}` : '' }}
          {{ a.uploader_name ? ` · ${a.uploader_name}` : '' }}
          {{ a.step_order != null && a.step_order !== '' ? ` · 步驟 ${a.step_order}` : ' · 申請時' }}
        </span>
      </li>
    </ul>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { openAttachmentViewer } from '@/composables/useApprovalActions';

const props = defineProps({
  attachments: { type: Array, default: () => [] },
  requestStatus: { type: String, default: '' },
  onlyOfficeEnabled: { type: Boolean, default: false },
  title: { type: String, default: '附件' },
});

const emit = defineEmits(['office']);

const list = computed(() => props.attachments || []);
const canEdit = computed(() => props.requestStatus === 'pending' || props.requestStatus === 'draft');

function isOffice(name) {
  return /\.(docx?|xlsx?|pptx?|odt|ods|odp|csv|rtf)$/i.test(String(name || ''));
}

function isPreviewable(a) {
  const n = String(a.original_name || '');
  const m = String(a.mime_type || '').toLowerCase();
  return m.includes('pdf') || /\.pdf$/i.test(n) || m.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(n);
}

function fmtSize(n) {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function open(a) {
  if (props.onlyOfficeEnabled && isOffice(a.original_name)) {
    emit('office', a);
    return;
  }
  if (!openAttachmentViewer(a.id, a.original_name || '')) {
    window.open(`/api/attachments/${a.id}`, '_blank', 'noopener');
  }
}
</script>
