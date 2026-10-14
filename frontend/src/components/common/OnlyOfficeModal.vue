<template>
  <div v-if="visible" class="modal modal-oo-open" style="display:flex;z-index:1100;">
    <div class="modal-backdrop" @click="closeEditor"></div>
    <div class="modal-panel modal-panel-oo">
      <div class="oo-editor-shell">
        <!-- 頂部工具列 -->
        <div class="oo-editor-bar">
          <div class="oo-title-group" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <span class="oo-icon" style="font-size:1.2rem">📄</span>
            <strong style="font-size:1.05rem;color:#0f172a">{{ fileName || '線上文件' }}</strong>
            <span
              v-if="canEdit"
              class="tag"
              style="background:#dcfce7;color:#15803d;border:1px solid #86efac;font-size:0.8rem;padding:2px 8px;border-radius:999px"
            >
              線上編輯 · 儲存後自動回寫
            </span>
            <span
              v-else
              class="tag"
              style="background:#f1f5f9;color:#475569;border:1px solid #cbd5e1;font-size:0.8rem;padding:2px 8px;border-radius:999px"
            >
              唯讀檢視
            </span>
            <span class="muted" style="font-size:0.85rem">
              {{ canEdit ? '請於編輯器內儲存後再關閉' : '唯讀模式，僅供線上預覽' }}
            </span>
          </div>

          <div class="oo-action-group" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <button
              v-if="attachmentId"
              type="button"
              class="btn outline sm"
              @click="downloadFile"
              title="下載檔案至本機"
            >
              下載
            </button>
            <button
              type="button"
              class="btn outline sm"
              @click="closeEditor"
              title="關閉編輯器"
            >
              ✕ 關閉
            </button>
          </div>
        </div>

        <!-- 狀態區：載入中 -->
        <div v-if="loading" class="oo-status-box">
          <div class="spinner"></div>
          <div style="font-weight:500;color:#334155;margin-top:12px">正在啟動 OnlyOffice 文件編輯器…</div>
          <div class="muted" style="font-size:0.85rem;margin-top:4px">正在載入文件與連線至 Document Server，請稍候</div>
        </div>

        <!-- 狀態區：錯誤訊息 -->
        <div v-else-if="error" class="oo-status-box error-box">
          <div style="font-size:1.8rem;margin-bottom:8px">⚠️</div>
          <div style="font-weight:600;color:#dc2626;margin-bottom:6px">{{ error }}</div>
          <div class="muted" style="font-size:0.88rem;max-width:480px;margin-bottom:16px">
            可能由於 Document Server 尚未啟動、伺服器代理中斷或該附件格式不支援。您可嘗試重新載入或下載原始檔。
          </div>
          <div style="display:flex;gap:10px">
            <button type="button" class="btn primary sm" @click="retry">重新整理</button>
            <button v-if="attachmentId" type="button" class="btn outline sm" @click="downloadFile">下載檔案</button>
            <button type="button" class="btn outline sm" @click="closeEditor">關閉</button>
          </div>
        </div>

        <!-- 編輯器放置容器 -->
        <div
          v-show="!loading && !error"
          ref="editorHostRef"
          class="oo-editor-host"
        >
          <div id="onlyoffice-placeholder" style="width:100%;height:100%"></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { apiRequest } from '@/api/client';
import { registerUi } from '@/lib/app-services';
import { useToastStore } from '@/stores/toast';

const toast = useToastStore();

const visible = ref(false);
const loading = ref(false);
const error = ref('');
const attachmentId = ref(null);
const requestId = ref(null);
const fileName = ref('');
const canEdit = ref(false);
const editorHostRef = ref(null);

let docEditorInstance = null;
let scriptLoadingPromise = null;
let onCloseCallback = null;

function loadOnlyOfficeScript(src) {
  if (typeof window !== 'undefined' && window.DocsAPI && window.DocsAPI.DocEditor) {
    return Promise.resolve();
  }
  if (scriptLoadingPromise) return scriptLoadingPromise;

  scriptLoadingPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-onlyoffice-script]');
    if (existing) {
      if (window.DocsAPI && window.DocsAPI.DocEditor) {
        return resolve();
      }
      existing.remove();
    }

    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.dataset.onlyofficeScript = 'true';
    s.onload = () => {
      if (window.DocsAPI && window.DocsAPI.DocEditor) {
        resolve();
      } else {
        scriptLoadingPromise = null;
        reject(new Error('OnlyOffice 腳本載入成功，但 DocsAPI 未初始化'));
      }
    };
    s.onerror = () => {
      scriptLoadingPromise = null;
      reject(new Error('無法連線載入 OnlyOffice 腳本，請確認 Document Server 服務狀態'));
    };
    document.head.appendChild(s);
  });
  return scriptLoadingPromise;
}

function destroyDocEditor() {
  if (docEditorInstance) {
    try {
      if (typeof docEditorInstance.destroyEditor === 'function') {
        docEditorInstance.destroyEditor();
      }
    } catch (e) {
      console.warn('[OnlyOffice] destroyEditor error:', e);
    }
    docEditorInstance = null;
  }
}

async function open(attId, reqId = null, onDone = null) {
  attachmentId.value = attId;
  requestId.value = reqId;
  onCloseCallback = onDone;
  fileName.value = '';
  canEdit.value = false;
  error.value = '';
  loading.value = true;
  visible.value = true;

  destroyDocEditor();

  try {
    const data = await apiRequest(`/api/onlyoffice/editor/${attId}`);
    if (!data?.ok && !data?.config) {
      throw new Error(data?.error || '無法取得編輯器設定');
    }

    fileName.value = data.fileName || '線上文件';
    canEdit.value = !!data.canEdit;

    // 判斷 Document Server 腳本網址：
    // HTTPS 頁面或同源代理時，改走同源 /web-apps/apps/api/documents/api.js 避免混合內容或連線埠問題
    let scriptUrl = data.docsApiScript;
    if (
      typeof location !== 'undefined' &&
      (location.protocol === 'https:' || /^http:\/\//i.test(scriptUrl) || data.sameOriginProxy)
    ) {
      if (location.protocol === 'https:' || location.origin !== data.docsUrl) {
        scriptUrl = `${location.origin}/web-apps/apps/api/documents/api.js`;
      }
    }

    await loadOnlyOfficeScript(scriptUrl);

    await nextTick();

    // 確保 host 容器乾淨且有 placeholder
    if (editorHostRef.value) {
      editorHostRef.value.innerHTML = '<div id="onlyoffice-placeholder" style="width:100%;height:100%"></div>';
    }

    const host = document.getElementById('onlyoffice-placeholder');
    if (!host) {
      throw new Error('找不到 OnlyOffice 容器節點');
    }

    const cfg = {
      ...data.config,
      width: '100%',
      height: '100%',
      type: 'desktop',
      events: {
        onAppReady: () => {
          loading.value = false;
        },
        onError: (err) => {
          console.error('[OnlyOffice] editor error event:', err);
          toast.error(err?.data || 'OnlyOffice 編輯器發生異常');
        },
        onWarning: (w) => {
          console.warn('[OnlyOffice] warning event:', w);
        },
      },
    };

    if (cfg.editorConfig) {
      cfg.editorConfig = {
        ...cfg.editorConfig,
        customization: {
          ...(cfg.editorConfig.customization || {}),
          compactHeader: true,
          zoom: 100,
        },
      };
    }

    docEditorInstance = new window.DocsAPI.DocEditor('onlyoffice-placeholder', cfg);
    setTimeout(() => {
      if (loading.value) loading.value = false;
    }, 1500);

  } catch (err) {
    console.error('[OnlyOffice] open error:', err);
    loading.value = false;
    error.value = err.message || '無法啟動 OnlyOffice 編輯器';
    toast.error(error.value);
  }
}

function closeEditor() {
  destroyDocEditor();
  visible.value = false;
  loading.value = false;
  error.value = '';
  if (typeof onCloseCallback === 'function') {
    try {
      onCloseCallback();
    } catch (e) {
      console.warn('onCloseCallback error:', e);
    }
  }
}

function retry() {
  if (attachmentId.value) {
    open(attachmentId.value, requestId.value, onCloseCallback);
  }
}

function downloadFile() {
  if (attachmentId.value) {
    window.location.href = `/api/attachments/${attachmentId.value}`;
  }
}

function handleKeyDown(e) {
  if (visible.value && e.key === 'Escape') {
    closeEditor();
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown);
  registerUi({
    onlyOffice: (attId, reqId, onDone) => open(attId, reqId, onDone),
  });
  window.openOnlyOfficeEditor = (attId, reqId, onDone) => open(attId, reqId, onDone);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeyDown);
  registerUi({ onlyOffice: null });
  if (window.openOnlyOfficeEditor) {
    try { delete window.openOnlyOfficeEditor; } catch {}
  }
  destroyDocEditor();
});

defineExpose({ open, close: closeEditor });
</script>

<style scoped>
.oo-status-box {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  text-align: center;
  background: #f8fafc;
}

.spinner {
  width: 36px;
  height: 36px;
  border: 3px solid rgba(59, 130, 246, 0.2);
  border-top-color: #3b82f6;
  border-radius: 50%;
  animation: oo-spin 0.8s linear infinite;
}

@keyframes oo-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
