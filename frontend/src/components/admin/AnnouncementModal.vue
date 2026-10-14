<template>
  <div class="modal">
    <div class="modal-backdrop" @click="$emit('close')"></div>
    <div class="modal-panel wide">
      <h3 style="margin-top:0">📢 {{ announcement.title || '公司公告' }}</h3>
      <p v-if="announcement.body" style="white-space:pre-wrap">{{ announcement.body }}</p>
      <p v-else class="muted">（無內文）</p>
      <div v-if="announcement.hasFile" style="padding:14px;background:#f8fafc;border:1px solid var(--border);border-radius:10px">
        <strong>{{ announcement.originalName || '附件' }}</strong>
        <div class="form-actions">
          <button type="button" class="btn primary sm" @click="viewFile">開啟檢視</button>
        </div>
        <iframe v-if="previewUrl && isPdf" :src="previewUrl" title="附件預覽" style="width:100%;height:420px;border:0"></iframe>
        <img v-else-if="previewUrl && isImg" :src="previewUrl" alt="附件預覽" style="max-width:100%" />
      </div>
      <div class="form-actions"><button type="button" class="btn outline" @click="$emit('close')">關閉</button></div>
    </div>
  </div>
</template>

<script setup>
import { onBeforeUnmount, ref } from 'vue';
import { apiRequest } from '@/api/client';
import { useToastStore } from '@/stores/toast';

const props = defineProps({
  announcement: { type: Object, required: true },
});
defineEmits(['close']);
const toast = useToastStore();
const previewUrl = ref('');
const isPdf = ref(false);
const isImg = ref(false);

async function viewFile() {
  try {
    const slot = Number(props.announcement.slot) || 0;
    const meta = await apiRequest(`/api/announcement/file?inline=1&slot=${slot}`, {
      expectBlob: true,
      returnMeta: true,
    });
    if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
    previewUrl.value = URL.createObjectURL(meta.blob);
    const name = String(meta.filename || props.announcement.originalName || '');
    const ct = String(meta.blob?.type || '').toLowerCase();
    isPdf.value = ct.includes('pdf') || /\.pdf$/i.test(name);
    isImg.value = ct.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(name);
    if (!isPdf.value && !isImg.value) window.open(previewUrl.value, '_blank', 'noopener');
  } catch (err) {
    toast.error(err.message || '附件開啟失敗');
  }
}

onBeforeUnmount(() => {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
});
</script>
