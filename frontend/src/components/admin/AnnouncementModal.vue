<template>
  <div class="modal" @click.self="$emit('close')">
    <div class="modal-backdrop" @click="$emit('close')"></div>
    <div class="modal-panel wide announcement-modal-panel" style="max-width: 1180px; width: 95vw; height: 92vh; max-height: 94vh; display: flex; flex-direction: column;">
      <!-- Header -->
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px; gap: 14px; padding-bottom: 12px; border-bottom: 1px solid var(--border, #e2e8f0);">
        <div>
          <h3 style="margin: 0 0 6px 0; color: var(--text-heading, #0f172a); font-size: 1.5rem; font-weight: 700;">
            📢 {{ announcement.title || '公司公告' }}
          </h3>
          <span v-if="announcement.updatedAt" class="muted" style="font-size: 0.9rem;">
            發布時間：{{ formatDateTime(announcement.updatedAt) }}
          </span>
        </div>
        <button type="button" class="btn ghost sm" style="font-size: 1.4rem; line-height: 1; padding: 4px 10px;" @click="$emit('close')">✕</button>
      </div>

      <!-- Body & Content (Scrollable) -->
      <div style="overflow-y: auto; flex: 1; padding-right: 6px; display: flex; flex-direction: column;">
        <p v-if="announcement.body" style="white-space: pre-wrap; line-height: 1.8; margin: 0 0 16px 0; color: var(--text-main, #334155); font-size: 1.08rem;">
          {{ announcement.body }}
        </p>
        <p v-else class="muted" style="margin: 0 0 16px 0; font-size: 1.02rem;">（無內文）</p>

        <!-- Attachment Box -->
        <div v-if="announcement.hasFile" class="announcement-attachment-box" style="background: #f8fafc; border: 1px solid var(--border, #e2e8f0); border-radius: 12px; padding: 16px 20px; margin-bottom: 16px; flex: 1; display: flex; flex-direction: column;">
          <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 12px;">
            <div style="display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1;">
              <span style="font-size: 1.75rem; line-height: 1;">{{ getFileIcon(fileName) }}</span>
              <strong style="word-break: break-all; color: var(--text-heading, #0f172a); font-size: 1.1rem;">
                {{ fileName }}
              </strong>
            </div>
            <div style="display: flex; gap: 8px; align-items: center;">
              <button
                v-if="canPreview"
                type="button"
                class="btn primary sm"
                :disabled="loading"
                @click="loadPreview(true)"
              >
                {{ loading ? '載入中...' : (previewUrl ? '重新整理預覽' : '線上檢視') }}
              </button>
              <button
                v-if="previewUrl"
                type="button"
                class="btn outline sm"
                title="在新分頁開啟"
                @click="openInNewTab"
              >
                另開分頁 ↗
              </button>
              <button
                type="button"
                class="btn outline sm"
                :disabled="downloading"
                @click="downloadFile"
              >
                {{ downloading ? '下載中...' : '下載檔案 ⬇' }}
              </button>
            </div>
          </div>

          <!-- Preview Frame / Image -->
          <div v-if="loading" style="text-align: center; padding: 36px; color: var(--text-muted, #64748b);">
            <div style="font-size: 2rem; margin-bottom: 8px;">⏳</div>
            <div style="font-size: 1.05rem;">正在讀取附件內容，請稍候...</div>
          </div>

          <div v-else-if="previewUrl" style="margin-top: 10px; flex: 1; display: flex; flex-direction: column; min-height: 600px;">
            <iframe
              v-if="isPdf"
              :src="previewUrl"
              title="附件預覽"
              style="width: 100%; height: 100%; min-height: 620px; flex: 1; border: 1px solid var(--border, #cbd5e1); border-radius: 8px; background: #fff;"
            ></iframe>
            <div v-else-if="isImg" style="text-align: center; background: #fff; padding: 16px; border-radius: 8px; border: 1px solid var(--border, #cbd5e1); flex: 1; display: flex; align-items: center; justify-content: center;">
              <img :src="previewUrl" alt="附件預覽" style="max-width: 100%; max-height: 72vh; border-radius: 6px; display: inline-block; object-fit: contain;" />
            </div>
          </div>

          <div v-else-if="!canPreview" class="muted" style="font-size: 0.95rem; margin-top: 8px; padding: 8px 0;">
            💡 此檔案格式（{{ fileExt }}）建議直接點擊「下載檔案」檢視。
          </div>
          <div v-else-if="previewError" class="text-danger" style="font-size: 0.95rem; margin-top: 8px;">
            ⚠️ {{ previewError }}
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="form-actions" style="justify-content: flex-end; margin-top: 14px; padding-top: 10px; border-top: 1px solid var(--border, #e2e8f0);">
        <button type="button" class="btn primary" @click="$emit('close')">關閉</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { apiRequest } from '@/api/client';
import { useToastStore } from '@/stores/toast';
import { formatDateTime } from '@/lib/format';

const props = defineProps({
  announcement: { type: Object, required: true },
});
defineEmits(['close']);

const toast = useToastStore();
const previewUrl = ref('');
const isPdf = ref(false);
const isImg = ref(false);
const loading = ref(false);
const downloading = ref(false);
const previewError = ref('');

const fileName = computed(() => {
  return props.announcement.originalName || props.announcement.file || '公告附件';
});

const fileExt = computed(() => {
  const parts = String(fileName.value).split('.');
  return parts.length > 1 ? parts.pop().toUpperCase() : '檔案';
});

const canPreview = computed(() => {
  const name = String(fileName.value).toLowerCase();
  return /\.pdf$/i.test(name) || /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(name);
});

function getFileIcon(name = '') {
  const ext = (String(name).split('.').pop() || '').toLowerCase();
  if (ext === 'pdf') return '📕';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return '📊';
  if (['doc', 'docx'].includes(ext)) return '📘';
  if (['ppt', 'pptx'].includes(ext)) return '📙';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return '🖼️';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '🗜️';
  if (['txt', 'md'].includes(ext)) return '📄';
  return '📎';
}

async function loadPreview(isUserClick = false) {
  if (!props.announcement.hasFile) return;
  try {
    loading.value = true;
    previewError.value = '';
    const slot = Number(props.announcement.slot) || 0;
    const meta = await apiRequest(`/api/announcement/file?inline=1&slot=${slot}`, {
      expectBlob: true,
      returnMeta: true,
    });
    if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
    previewUrl.value = URL.createObjectURL(meta.blob);

    const name = String(meta.filename || fileName.value || '');
    const ct = String(meta.blob?.type || '').toLowerCase();
    isPdf.value = ct.includes('pdf') || /\.pdf$/i.test(name);
    isImg.value = ct.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(name);

    if (!isPdf.value && !isImg.value && isUserClick) {
      window.open(previewUrl.value, '_blank', 'noopener');
    }
  } catch (err) {
    previewError.value = err.message || '附件載入失敗';
    if (isUserClick) {
      toast.error(err.message || '附件載入失敗');
    }
  } finally {
    loading.value = false;
  }
}

function openInNewTab() {
  if (previewUrl.value) {
    window.open(previewUrl.value, '_blank', 'noopener');
  } else {
    loadPreview(true);
  }
}

async function downloadFile() {
  try {
    downloading.value = true;
    const slot = Number(props.announcement.slot) || 0;
    const meta = await apiRequest(`/api/announcement/file?slot=${slot}`, {
      expectBlob: true,
      returnMeta: true,
    });
    const url = URL.createObjectURL(meta.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = meta.filename || fileName.value || '公告附件';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    toast.error(err.message || '下載失敗');
  } finally {
    downloading.value = false;
  }
}

onMounted(() => {
  // 自動載入 PDF 或圖片的預覽
  if (props.announcement.hasFile && canPreview.value) {
    loadPreview(false);
  }
});

onBeforeUnmount(() => {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
});
</script>
