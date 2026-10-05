<template>
  <div v-if="visible" class="att-viewer-modal att-viewer-overlay" @click.self="close">
    <div class="att-viewer-panel">
      <!-- 頂部標題與操作按鈕 -->
      <div class="att-viewer-header">
        <div class="att-header-info">
          <h3 class="att-header-title">附件檢視</h3>
          <p class="att-header-filename" :title="fileName">{{ fileName || '檔案預覽' }}</p>
        </div>
        <div class="att-header-actions">
          <button
            v-if="isPdf && directUrl"
            type="button"
            class="btn outline sm"
            @click="openInNewTab"
            title="在新分頁以完整瀏覽器模式開啟"
          >
            在新分頁開啟
          </button>
          <button
            v-if="isPdf"
            type="button"
            class="btn outline sm"
            @click="toggleMode"
            title="在瀏覽器原生檢視與 PDF.js 高畫質畫布檢視間切換"
          >
            {{ mode === 'canvas' ? '切換原生檢視' : '切換畫布檢視' }}
          </button>
          <button type="button" class="btn outline sm" @click="downloadFile">
            下載
          </button>
          <button type="button" class="btn outline sm att-close-btn" @click="close" data-close-modal>
            ✕ 關閉
          </button>
        </div>
      </div>

      <!-- 內容展示區 -->
      <div class="att-viewer-body">
        <div v-if="loading" class="att-state-box muted">
          <div class="spinner"></div>
          <div>載入中…</div>
        </div>

        <div v-else-if="error" class="att-state-box error-msg">
          <p>{{ error }}</p>
          <button type="button" class="btn primary sm" @click="downloadFile">改用下載開啟</button>
        </div>

        <!-- PDF 畫布模式 (PDF.js) -->
        <div
          v-else-if="isPdf && mode === 'canvas'"
          ref="canvasContainerRef"
          class="att-canvas-container"
        >
          <div v-if="renderingCanvas" class="att-state-box muted" style="min-height: 200px">
            正在透過 PDF.js 解析並繪製高畫質頁面…
          </div>
        </div>

        <!-- PDF 原生 iframe 模式 -->
        <iframe
          v-else-if="isPdf && mode === 'iframe'"
          class="att-preview-iframe"
          :title="fileName"
          :src="blobUrl + '#toolbar=1&navpanes=0&view=FitH'"
        ></iframe>

        <!-- 圖片檢視 -->
        <div v-else-if="isImg" class="att-img-container">
          <img :src="blobUrl" :alt="fileName" class="att-preview-img" />
        </div>

        <!-- 不支援內嵌的檔案格式 -->
        <div v-else class="att-state-box muted">
          <p>此格式不支援瀏覽器內嵌預覽，請使用右上角「下載」至本機開啟。</p>
          <button type="button" class="btn primary" @click="downloadFile">立即下載</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue';

const visible = ref(false);
const loading = ref(false);
const renderingCanvas = ref(false);
const error = ref('');
const attId = ref(null);
const fileName = ref('');
const blobUrl = ref('');
const directUrl = ref('');
const isPdf = ref(false);
const isImg = ref(false);
const mode = ref('canvas'); // 'canvas' | 'iframe'
const canvasContainerRef = ref(null);

let activeBlob = null;
let currentRenderPromise = null;

function getAuthToken() {
  return localStorage.getItem('approval_token') || '';
}

async function fetchAttachment(id) {
  const token = getAuthToken();
  const res = await fetch(`/api/attachments/${id}?inline=1`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    let errMsg = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      if (data.error) errMsg = data.error;
    } catch {}
    throw new Error(errMsg);
  }
  const ct = res.headers.get('content-type') || '';
  const cd = res.headers.get('content-disposition') || '';
  const blob = await res.blob();
  return { blob, contentType: ct, contentDisposition: cd };
}

async function renderPdfWithPdfJs(blob, container) {
  if (!window.pdfjsLib) {
    container.innerHTML = '<div class="error-msg" style="margin:16px;text-align:center">PDF.js 函式庫尚未載入，請按上方「切換原生檢視」或「下載」。</div>';
    return;
  }
  if (!window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.js';
  }

  try {
    renderingCanvas.value = true;
    container.innerHTML = '';
    const arrayBuffer = await blob.arrayBuffer();
    const loadingTask = window.pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      if (!visible.value) break;
      const page = await pdf.getPage(pageNum);
      const containerWidth = Math.max(container.clientWidth - 32, 320);
      const unscaledViewport = page.getViewport({ scale: 1.0 });
      const scale = containerWidth / unscaledViewport.width;
      const viewport = page.getViewport({ scale: Math.min(Math.max(scale, 0.8), 2.2) });

      const pageWrap = document.createElement('div');
      pageWrap.className = 'att-pdfjs-page-wrap';

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const outputScale = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = Math.floor(viewport.width) + 'px';
      canvas.style.height = Math.floor(viewport.height) + 'px';

      const renderContext = {
        canvasContext: ctx,
        transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null,
        viewport: viewport,
      };

      const infoTag = document.createElement('div');
      infoTag.className = 'att-pdfjs-page-num muted';
      infoTag.textContent = `第 ${pageNum} / ${pdf.numPages} 頁`;

      pageWrap.appendChild(canvas);
      pageWrap.appendChild(infoTag);
      container.appendChild(pageWrap);

      await page.render(renderContext).promise;
    }
  } catch (err) {
    console.error('PDF.js render error:', err);
    mode.value = 'iframe';
  } finally {
    renderingCanvas.value = false;
  }
}

async function open(id, name = '') {
  attId.value = id;
  fileName.value = name || `附件 #${id}`;
  visible.value = true;
  loading.value = true;
  error.value = '';
  renderingCanvas.value = false;

  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent || ''
  ) || window.innerWidth < 768;

  // 預設模式：行動端一律畫布，桌機優先使用畫布保障跨瀏覽器排版相容
  mode.value = 'canvas';

  try {
    const { blob, contentType } = await fetchAttachment(id);
    const ct = String(contentType || blob.type || '').toLowerCase();
    const fname = String(name).toLowerCase();
    isPdf.value = ct.includes('pdf') || fname.endsWith('.pdf');
    isImg.value = ct.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(fname);

    let finalBlob = blob;
    if (isPdf.value && (!finalBlob.type || !finalBlob.type.includes('pdf'))) {
      finalBlob = new Blob([await blob.arrayBuffer()], { type: 'application/pdf' });
    }
    activeBlob = finalBlob;
    if (blobUrl.value) URL.revokeObjectURL(blobUrl.value);
    blobUrl.value = URL.createObjectURL(finalBlob);

    const token = getAuthToken();
    directUrl.value = `/api/attachments/${id}?inline=1${token ? `&token=${encodeURIComponent(token)}` : ''}`;

    loading.value = false;

    if (isPdf.value && mode.value === 'canvas') {
      await nextTick();
      if (canvasContainerRef.value) {
        await renderPdfWithPdfJs(finalBlob, canvasContainerRef.value);
      }
    }
  } catch (err) {
    loading.value = false;
    error.value = err.message || '無法開啟附件';
  }
}

function close() {
  visible.value = false;
  loading.value = false;
  error.value = '';
  if (blobUrl.value) {
    URL.revokeObjectURL(blobUrl.value);
    blobUrl.value = '';
  }
  activeBlob = null;
}

function openInNewTab() {
  const url = directUrl.value || blobUrl.value;
  if (url) window.open(url, '_blank', 'noopener');
}

async function toggleMode() {
  if (mode.value === 'canvas') {
    mode.value = 'iframe';
  } else {
    mode.value = 'canvas';
    await nextTick();
    if (activeBlob && canvasContainerRef.value) {
      await renderPdfWithPdfJs(activeBlob, canvasContainerRef.value);
    }
  }
}

function downloadFile() {
  if (!activeBlob && !attId.value) return;
  if (activeBlob) {
    const url = URL.createObjectURL(activeBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName.value || `attachment-${attId.value}`;
    a.click();
    URL.revokeObjectURL(url);
  } else {
    window.location.href = `/api/attachments/${attId.value}`;
  }
}

function handleKeyDown(e) {
  if (visible.value && e.key === 'Escape') {
    close();
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown);
  if (typeof window !== 'undefined') {
    window.__openVueAttachmentModal = (id, name) => open(id, name);
    window.__closeVueAttachmentModal = () => close();
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeyDown);
  if (blobUrl.value) URL.revokeObjectURL(blobUrl.value);
});

defineExpose({ open, close });
</script>

<style scoped>
.att-viewer-overlay {
  position: fixed;
  inset: 0;
  z-index: 1050;
  background: rgba(15, 23, 42, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  animation: attFadeIn 0.15s ease-out;
}

.att-viewer-panel {
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.25), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
  width: 96vw;
  max-width: 1140px;
  height: 92vh;
  max-height: 940px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}

.att-viewer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 18px;
  border-bottom: 1px solid #e2e8f0;
  background: #f8fafc;
  flex-shrink: 0;
}

.att-header-info {
  min-width: 0;
  flex: 1;
}

.att-header-title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
  color: #0f172a;
}

.att-header-filename {
  margin: 2px 0 0;
  font-size: 0.85rem;
  color: #64748b;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.att-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  flex-shrink: 0;
}

.att-viewer-body {
  flex: 1;
  overflow: auto;
  position: relative;
  background: #f1f5f9;
  display: flex;
  flex-direction: column;
}

.att-preview-iframe {
  width: 100%;
  height: 100%;
  border: none;
  background: #ffffff;
  display: block;
}

.att-canvas-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px;
  gap: 16px;
  overflow-y: auto;
}

:deep(.att-pdfjs-page-wrap) {
  background: #ffffff;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.05);
  border-radius: 4px;
  padding: 4px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

:deep(.att-pdfjs-page-num) {
  font-size: 0.75rem;
  color: #94a3b8;
  margin-top: 6px;
  padding-bottom: 4px;
}

.att-img-container {
  padding: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100%;
}

.att-preview-img {
  max-width: 100%;
  max-height: 100%;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  background: #ffffff;
}

.att-state-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 40px;
  height: 100%;
  text-align: center;
}

@keyframes attFadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
</style>
