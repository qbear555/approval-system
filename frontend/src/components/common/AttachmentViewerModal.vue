<template>
  <div v-if="visible" class="att-viewer-modal att-viewer-overlay" @click.self="close">
    <div class="att-viewer-panel">
      <!-- 頂部標題與操作按鈕 -->
      <div class="att-viewer-header">
        <div class="att-header-info">
          <div style="display:flex;align-items:center;gap:8px">
            <h3 class="att-header-title">附件檢視</h3>
            <span v-if="isSheet" class="tag" style="background:#ecfdf5;color:#047857;border:1px solid #a7f3d0">試算表</span>
            <span v-else-if="isPdf" class="tag" style="background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe">PDF 文件</span>
            <span v-else-if="isImg" class="tag" style="background:#faf5ff;color:#7e22ce;border:1px solid #e9d5ff">圖片</span>
          </div>
          <p class="att-header-filename" :title="fileName">{{ fileName || '檔案預覽' }}</p>
        </div>
        <div class="att-header-actions">
          <!-- 試算表與 PDF 檢視切換 (若兩者皆可用) -->
          <button
            v-if="isSheet && hasPdfVersion"
            type="button"
            class="btn outline sm"
            @click="toggleSheetPdfMode"
            :title="mode === 'sheet' ? '切換為高畫質向量排版 PDF' : '切換為互動表格網格'"
          >
            {{ mode === 'sheet' ? '📑 切換 PDF 排版' : '📊 切換試算表格' }}
          </button>

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
            v-if="isPdf && mode !== 'sheet'"
            type="button"
            class="btn outline sm"
            @click="toggleMode"
            title="在瀏覽器原生檢視與 PDF.js 高畫質畫布檢視間切換"
          >
            {{ mode === 'canvas' ? '原生檢視' : '畫布檢視' }}
          </button>
          <button
            v-if="isOfficeName(fileName) && attId"
            type="button"
            class="btn outline sm"
            @click="openInOnlyOffice"
            title="以 OnlyOffice 完整編輯器開啟"
          >
            📄 OnlyOffice 開啟
          </button>
          <button type="button" class="btn outline sm" @click="downloadFile">
            ⬇️ 下載
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
          <div>{{ loadingText || '載入中…' }}</div>
        </div>

        <div v-else-if="error" class="att-state-box error-msg">
          <div style="font-size:1.8rem;margin-bottom:8px">⚠️</div>
          <p style="font-weight:600;margin-bottom:4px">{{ error }}</p>
          <p class="muted" style="font-size:0.85rem;margin-bottom:16px">您可嘗試改用下方按鈕以完整模式開啟或下載至本機。</p>
          <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
            <button
              v-if="isOfficeName(fileName) && attId"
              type="button"
              class="btn primary sm"
              @click="openInOnlyOffice"
            >
              📄 使用 OnlyOffice 線上開啟
            </button>
            <button type="button" class="btn outline sm" @click="downloadFile">改用下載開啟</button>
          </div>
        </div>

        <!-- 1. 試算表模式 (SheetJS 即時分頁格線檢視) -->
        <div v-else-if="mode === 'sheet' && sheetData" class="att-sheet-container">
          <!-- 分頁標籤 -->
          <div v-if="sheetData.sheets?.length > 1" class="sheet-tabs-bar">
            <button
              v-for="(s, idx) in sheetData.sheets"
              :key="idx"
              type="button"
              class="sheet-tab-btn"
              :class="{ active: activeSheetIdx === idx }"
              @click="activeSheetIdx = idx"
            >
              📊 {{ s.name }} ({{ s.totalRows }} 列)
            </button>
          </div>

          <!-- 工具列 (搜尋與統計) -->
          <div class="sheet-toolbar">
            <div style="display:flex;align-items:center;gap:8px;flex:1;max-width:420px">
              <input
                v-model="sheetSearch"
                type="search"
                class="sheet-search-input"
                placeholder="🔍 在此工作表搜尋關鍵字…"
              />
            </div>
            <div class="sheet-info-pill">
              {{ currentSheet?.name || '工作表' }} · 顯示 {{ currentSheetFilteredRows.length }} / {{ currentSheet?.totalRows || 0 }} 列
              <span v-if="currentSheet?.truncated" style="color:#d97706;margin-left:4px">（已截錄前 500 列）</span>
            </div>
          </div>

          <!-- 資料表格 -->
          <div class="sheet-table-scroll">
            <table class="sheet-grid-table">
              <thead>
                <tr>
                  <th class="row-num-col">#</th>
                  <th v-for="(col, cIdx) in currentSheetHeader" :key="cIdx">
                    {{ col || `欄 ${cIdx + 1}` }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(r, rIdx) in currentSheetFilteredRows" :key="rIdx">
                  <td class="row-num-cell">{{ rIdx + 1 }}</td>
                  <td
                    v-for="(cell, cIdx) in r"
                    :key="cIdx"
                    :class="{ 'num-cell': isNumeric(cell) }"
                  >
                    {{ cell }}
                  </td>
                </tr>
                <tr v-if="!currentSheetFilteredRows.length">
                  <td :colspan="(currentSheetHeader.length || 1) + 1" style="text-align:center;padding:32px" class="muted">
                    沒有符合搜尋條件的資料
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- 2. PDF 畫布模式 (PDF.js) -->
        <div
          v-else-if="isPdf && mode === 'canvas'"
          ref="canvasContainerRef"
          class="att-canvas-container"
        >
          <div v-if="renderingCanvas" class="att-state-box muted" style="min-height: 200px">
            <div class="spinner"></div>
            <div>正在透過 PDF.js 解析並繪製高畫質頁面…</div>
          </div>
        </div>

        <!-- 3. PDF 原生 iframe 模式 -->
        <iframe
          v-else-if="isPdf && mode === 'iframe'"
          class="att-preview-iframe"
          :title="fileName"
          :src="blobUrl + '#toolbar=1&navpanes=0&view=FitH'"
        ></iframe>

        <!-- 4. 圖片檢視 -->
        <div v-else-if="isImg" class="att-img-container">
          <img :src="blobUrl" :alt="fileName" class="att-preview-img" />
        </div>

        <!-- 5. 不支援內嵌的檔案格式 -->
        <div v-else class="att-state-box muted">
          <p>此格式不支援直接預覽，請使用右上角「下載」至本機開啟。</p>
          <div style="display:flex;gap:10px;justify-content:center;margin-top:10px">
            <button
              v-if="isOfficeName(fileName) && attId"
              type="button"
              class="btn primary"
              @click="openInOnlyOffice"
            >
              📄 使用 OnlyOffice 線上開啟
            </button>
            <button type="button" class="btn outline" @click="downloadFile">立即下載</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { getPdfjs } from '@/lib/pdfjs';
import { registerUi, openOnlyOffice } from '@/lib/app-services';

const visible = ref(false);
const loading = ref(false);
const loadingText = ref('');
const renderingCanvas = ref(false);
const error = ref('');
const attId = ref(null);
const fileName = ref('');
const blobUrl = ref('');
const directUrl = ref('');
const isPdf = ref(false);
const isImg = ref(false);
const isSheet = ref(false);
const hasPdfVersion = ref(false);
const sheetData = ref(null);
const activeSheetIdx = ref(0);
const sheetSearch = ref('');
const mode = ref('canvas'); // 'canvas' | 'iframe' | 'sheet'
const canvasContainerRef = ref(null);

let activeBlob = null;

function getAuthToken() {
  return localStorage.getItem('approval_token') || '';
}

function ensurePdfJs() {
  return getPdfjs();
}

function isOfficeName(name) {
  return /\.(docx?|xlsx?|pptx?|odt|ods|odp|csv|rtf)$/i.test(String(name || ''));
}

function isNumeric(val) {
  if (val == null || val === '') return false;
  return !isNaN(Number(String(val).replace(/,/g, '')));
}

const currentSheet = computed(() => {
  if (!sheetData.value?.sheets?.length) return null;
  return sheetData.value.sheets[activeSheetIdx.value] || sheetData.value.sheets[0];
});

const currentSheetHeader = computed(() => {
  const s = currentSheet.value;
  if (!s || !s.rows?.length) return [];
  return s.rows[0] || [];
});

const currentSheetFilteredRows = computed(() => {
  const s = currentSheet.value;
  if (!s || !s.rows?.length) return [];
  const bodyRows = s.rows.slice(1);
  const q = String(sheetSearch.value || '').trim().toLowerCase();
  if (!q) return bodyRows;
  return bodyRows.filter((row) =>
    row.some((cell) => String(cell || '').toLowerCase().includes(q))
  );
});

async function fetchAttachment(id, inline = true) {
  const token = getAuthToken();
  const res = await fetch(`/api/attachments/${id}${inline ? '?inline=1' : ''}`, {
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
  const pdfjsLib = await ensurePdfJs();
  try {
    renderingCanvas.value = true;
    container.innerHTML = '';
    const arrayBuffer = await blob.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
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
  loadingText.value = '正在檢測檔案格式並載入預覽…';
  error.value = '';
  renderingCanvas.value = false;
  isSheet.value = false;
  hasPdfVersion.value = false;
  sheetData.value = null;
  activeSheetIdx.value = 0;
  sheetSearch.value = '';

  const fname = String(name || '').toLowerCase();
  const token = getAuthToken();

  // 1. 若為試算表 (xlsx, xls, ods, csv)，優先取得 SheetJS 解析之網格
  if (/\.(xlsx?|ods|csv)$/i.test(fname)) {
    try {
      loadingText.value = '正在解析試算表工作表與格線…';
      const sRes = await fetch(`/api/attachments/${id}/sheet-data`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (sRes.ok) {
        const sData = await sRes.json();
        if (sData.ok && sData.sheets?.length) {
          sheetData.value = sData;
          isSheet.value = true;
          mode.value = 'sheet';
          loading.value = false;
          // 檢查是否也有 PDF 轉換快取
          checkPdfAvailable(id);
          return;
        }
      }
    } catch (e) {
      console.warn('Sheet data fetch failed, fallback to preview stream:', e);
    }
  }

  // 2. 請求即時預覽串流 (/api/attachments/:id/preview)
  try {
    loadingText.value = '正在載入文件預覽…';
    const pRes = await fetch(`/api/attachments/${id}/preview`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

    const ct = String(pRes.headers.get('content-type') || '').toLowerCase();

    if (pRes.ok && (ct.includes('pdf') || ct.startsWith('image/'))) {
      const blob = await pRes.blob();
      isPdf.value = ct.includes('pdf');
      isImg.value = ct.startsWith('image/');

      let finalBlob = blob;
      if (isPdf.value && (!finalBlob.type || !finalBlob.type.includes('pdf'))) {
        finalBlob = new Blob([await blob.arrayBuffer()], { type: 'application/pdf' });
      }
      activeBlob = finalBlob;
      if (blobUrl.value) URL.revokeObjectURL(blobUrl.value);
      blobUrl.value = URL.createObjectURL(finalBlob);
      directUrl.value = blobUrl.value;
      mode.value = 'canvas';
      loading.value = false;

      if (isPdf.value) {
        await ensurePdfJs();
        await nextTick();
        if (canvasContainerRef.value) {
          await renderPdfWithPdfJs(finalBlob, canvasContainerRef.value);
        }
      }
      return;
    }

    // 若回傳為 JSON (如轉為 sheet 或通知需 fallback)
    if (ct.includes('json')) {
      const jData = await pRes.json();
      if (jData.type === 'sheet' && jData.sheets?.length) {
        sheetData.value = jData;
        isSheet.value = true;
        mode.value = 'sheet';
        loading.value = false;
        return;
      }
      if (jData.error) {
        throw new Error(jData.error);
      }
    }

    // 3. 一般下載/檢視降級
    const { blob, contentType } = await fetchAttachment(id, true);
    const fallbackCt = String(contentType || blob.type || '').toLowerCase();
    isPdf.value = fallbackCt.includes('pdf') || fname.endsWith('.pdf');
    isImg.value = fallbackCt.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(fname);

    let finalBlob = blob;
    if (isPdf.value && (!finalBlob.type || !finalBlob.type.includes('pdf'))) {
      finalBlob = new Blob([await blob.arrayBuffer()], { type: 'application/pdf' });
    }
    activeBlob = finalBlob;
    if (blobUrl.value) URL.revokeObjectURL(blobUrl.value);
    blobUrl.value = URL.createObjectURL(finalBlob);
    directUrl.value = `/api/attachments/${id}?inline=1${token ? `&token=${encodeURIComponent(token)}` : ''}`;
    mode.value = 'canvas';
    loading.value = false;

    if (isPdf.value) {
      await ensurePdfJs();
      await nextTick();
      if (canvasContainerRef.value) {
        await renderPdfWithPdfJs(finalBlob, canvasContainerRef.value);
      }
    }
  } catch (err) {
    loading.value = false;
    error.value = err.message || '無法開啟附件預覽';
  }
}

async function checkPdfAvailable(id) {
  try {
    const token = getAuthToken();
    const res = await fetch(`/api/attachments/${id}/preview-info`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (res.ok) {
      const info = await res.json();
      if (info.hasPdfCache || info.onlyOfficeEnabled) {
        hasPdfVersion.value = true;
      }
    }
  } catch {}
}

async function toggleSheetPdfMode() {
  if (mode.value === 'sheet') {
    loading.value = true;
    loadingText.value = '正在轉換高畫質向量 PDF…';
    try {
      const token = getAuthToken();
      const pRes = await fetch(`/api/attachments/${attId.value}/preview`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (pRes.ok) {
        const blob = await pRes.blob();
        activeBlob = new Blob([await blob.arrayBuffer()], { type: 'application/pdf' });
        if (blobUrl.value) URL.revokeObjectURL(blobUrl.value);
        blobUrl.value = URL.createObjectURL(activeBlob);
        directUrl.value = blobUrl.value;
        isPdf.value = true;
        mode.value = 'canvas';
        loading.value = false;
        await ensurePdfJs();
        await nextTick();
        if (canvasContainerRef.value) {
          await renderPdfWithPdfJs(activeBlob, canvasContainerRef.value);
        }
      } else {
        throw new Error('無法載入 PDF 版本');
      }
    } catch (e) {
      loading.value = false;
      error.value = e.message;
    }
  } else {
    mode.value = 'sheet';
  }
}

async function openBlob(blob, name = '') {
  attId.value = null;
  fileName.value = name || '檔案預覽';
  visible.value = true;
  loading.value = true;
  error.value = '';
  renderingCanvas.value = false;
  mode.value = 'canvas';

  try {
    const fname = String(name || '').toLowerCase();
    const ct = String(blob?.type || '').toLowerCase();
    isPdf.value = ct.includes('pdf') || fname.endsWith('.pdf');
    isImg.value = ct.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(fname);

    let finalBlob = blob;
    if (isPdf.value && (!finalBlob.type || !finalBlob.type.includes('pdf'))) {
      finalBlob = new Blob([await blob.arrayBuffer()], { type: 'application/pdf' });
    }
    activeBlob = finalBlob;
    if (blobUrl.value) URL.revokeObjectURL(blobUrl.value);
    blobUrl.value = URL.createObjectURL(finalBlob);
    directUrl.value = blobUrl.value;
    loading.value = false;

    if (isPdf.value && mode.value === 'canvas') {
      await ensurePdfJs();
      await nextTick();
      if (canvasContainerRef.value) {
        await renderPdfWithPdfJs(finalBlob, canvasContainerRef.value);
      }
    }
  } catch (err) {
    loading.value = false;
    error.value = err.message || '無法預覽檔案';
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
  if (activeBlob && !isSheet.value) {
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

function openInOnlyOffice() {
  if (!attId.value) return;
  const targetId = attId.value;
  close();
  openOnlyOffice(targetId);
}

function handleKeyDown(e) {
  if (visible.value && e.key === 'Escape') {
    close();
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown);
  registerUi({
    attachment: (id, name) => open(id, name),
    attachmentBlob: (blob, name) => openBlob(blob, name),
  });
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeyDown);
  registerUi({ attachment: null, attachmentBlob: null });
  if (blobUrl.value) URL.revokeObjectURL(blobUrl.value);
});

defineExpose({ open, openBlob, close });
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
  max-width: 1180px;
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

/* 試算表樣式 */
.att-sheet-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #ffffff;
}

.sheet-tabs-bar {
  display: flex;
  gap: 4px;
  padding: 8px 14px 0;
  background: #f1f5f9;
  border-bottom: 1px solid #cbd5e1;
  overflow-x: auto;
  flex-shrink: 0;
}

.sheet-tab-btn {
  padding: 6px 14px;
  border: 1px solid #cbd5e1;
  border-bottom: none;
  background: #e2e8f0;
  border-radius: 6px 6px 0 0;
  font-size: 0.84rem;
  font-weight: 500;
  color: #475569;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;
}

.sheet-tab-btn:hover {
  background: #f8fafc;
  color: #0f172a;
}

.sheet-tab-btn.active {
  background: #ffffff;
  color: #047857;
  font-weight: 700;
  border-color: #cbd5e1;
  border-top: 2px solid #059669;
}

.sheet-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  background: #ffffff;
  border-bottom: 1px solid #e2e8f0;
  gap: 12px;
  flex-wrap: wrap;
  flex-shrink: 0;
}

.sheet-search-input {
  width: 100%;
  padding: 5px 12px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  font-size: 0.85rem;
  outline: none;
}

.sheet-search-input:focus {
  border-color: #059669;
  box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.15);
}

.sheet-info-pill {
  font-size: 0.82rem;
  color: #64748b;
  font-weight: 500;
}

.sheet-table-scroll {
  flex: 1;
  overflow: auto;
  position: relative;
}

.sheet-grid-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
}

.sheet-grid-table th {
  position: sticky;
  top: 0;
  background: #f8fafc;
  border: 1px solid #cbd5e1;
  padding: 6px 10px;
  font-weight: 600;
  color: #334155;
  text-align: left;
  white-space: nowrap;
  z-index: 2;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

.sheet-grid-table td {
  border: 1px solid #e2e8f0;
  padding: 6px 10px;
  color: #1e293b;
  white-space: nowrap;
}

.sheet-grid-table tr:nth-child(even) td {
  background: #f8fafc;
}

.sheet-grid-table tr:hover td {
  background: #f0fdf4;
}

.row-num-col,
.row-num-cell {
  width: 48px;
  text-align: center !important;
  color: #94a3b8 !important;
  background: #f1f5f9 !important;
  font-weight: 500;
  user-select: none;
}

.num-cell {
  text-align: right;
  font-family: monospace;
}

/* PDF & 圖片檢視樣式 */
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

@media (max-width: 768px) {
  .att-viewer-overlay {
    padding: 0;
  }
  .att-viewer-panel {
    width: 100vw;
    height: 100vh;
    max-width: 100vw;
    max-height: 100vh;
    border-radius: 0;
  }
  .att-viewer-header {
    padding: 10px 12px;
  }
}
</style>
