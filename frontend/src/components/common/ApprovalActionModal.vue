<template>
  <div v-if="visible" class="action-modal-overlay" @click.self="close">
    <div class="action-modal-panel">
      <!-- 頂部標題與關閉 -->
      <div class="action-modal-header">
        <h3 class="action-modal-title">
          <span class="action-icon">{{ modalIcon }}</span>
          {{ modalTitle }}
        </h3>
        <button type="button" class="btn-close-sm" @click="close" title="關閉">✕</button>
      </div>

      <p class="action-modal-desc muted">{{ modalDesc }}</p>

      <form @submit.prevent="handleSubmit" class="action-modal-form">
        <!-- 1. 加簽表單 -->
        <template v-if="actionType === 'cosign'">
          <div class="field">
            <label>加簽同仁 *</label>
            <select v-model="targetUserId" required class="form-select">
              <option value="">請選擇加簽同仁…</option>
              <option v-for="u in candidateUsers" :key="u.id" :value="u.id">
                {{ u.name }}（{{ u.department || '未設部門' }}）
              </option>
            </select>
          </div>
          <div class="field">
            <label>加簽順序模式</label>
            <select v-model="cosignPosition" class="form-select">
              <option value="current">先經加簽同仁簽核（再回傳原步驟）</option>
              <option value="after">於本關核准後，插入下一步驟</option>
            </select>
          </div>
          <div class="field">
            <label>加簽說明 / 請託意見</label>
            <textarea
              v-model="comment"
              rows="3"
              class="form-textarea"
              placeholder="請填寫加簽說明或請同仁協助說明的項目…"
            ></textarea>
          </div>
        </template>

        <!-- 2. 轉簽表單 -->
        <template v-else-if="actionType === 'forward'">
          <div class="field">
            <label>轉簽改派對象 *</label>
            <select v-model="targetUserId" required class="form-select">
              <option value="">請選擇轉簽對象…</option>
              <option v-for="u in candidateUsers" :key="u.id" :value="u.id">
                {{ u.name }}（{{ u.department || '未設部門' }}）
              </option>
            </select>
          </div>
          <div class="field">
            <label>轉簽說明 / 理由</label>
            <textarea
              v-model="comment"
              rows="3"
              class="form-textarea"
              placeholder="請填寫轉簽改派原因或注意事項…"
            ></textarea>
          </div>
        </template>

        <!-- 3. 退回關卡表單 -->
        <template v-else-if="actionType === 'return'">
          <div class="field">
            <label class="field-title">1. 選擇退回目標 *</label>
            <div class="return-targets-list">
              <!-- 退回申請人 -->
              <label class="return-option" :class="{ active: returnTarget === 'applicant' }">
                <input type="radio" v-model="returnTarget" value="applicant" />
                <div class="return-option-info">
                  <div class="return-option-title">👤 退回給申請人（{{ requesterName }}）修改</div>
                  <div class="return-option-desc">單據將進入「退回修改」狀態，由申請人修正補件後再送出審核。</div>
                </div>
              </label>

              <!-- 退回至先前關卡 -->
              <label
                v-for="(s, idx) in priorSteps"
                :key="s.order"
                class="return-option"
                :class="{ active: returnTarget === String(s.order) }"
              >
                <input type="radio" v-model="returnTarget" :value="String(s.order)" />
                <div class="return-option-info">
                  <div class="return-option-title">
                    📋 退回至步驟 {{ s.order }}：{{ s.name || `步驟 ${s.order}` }}
                    <span v-if="idx === 0" class="tag-prev">上一關</span>
                  </div>
                  <div class="return-option-desc">單據將退回該關卡簽核人，重新進行審核。</div>
                </div>
              </label>
            </div>
          </div>

          <div class="field" style="margin-top: 14px">
            <label class="field-title">2. 退回意見／修正說明 *</label>
            <textarea
              v-model="comment"
              rows="3"
              required
              class="form-textarea"
              placeholder="請詳細敘述退回原因或需補充之資料（例如：請補齊採購廠商報價單、請修正金額…）"
            ></textarea>
          </div>
        </template>

        <!-- 操作按鈕 -->
        <div class="action-modal-footer">
          <button
            type="submit"
            :class="['btn', submitBtnClass]"
            :disabled="submitting"
          >
            <span v-if="submitting" class="spinner-sm"></span>
            {{ submitBtnText }}
          </button>
          <button type="button" class="btn outline" @click="close" :disabled="submitting">
            取消
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';

const visible = ref(false);
const submitting = ref(false);
const actionType = ref(''); // 'cosign' | 'forward' | 'return'
const currentRequest = ref(null);
const currentDetailData = ref(null);
let onDoneCallback = null;

// 表單狀態
const targetUserId = ref('');
const cosignPosition = ref('current');
const comment = ref('');
const returnTarget = ref('applicant');

const modalIcon = computed(() => {
  if (actionType.value === 'cosign') return '➕';
  if (actionType.value === 'forward') return '↗️';
  if (actionType.value === 'return') return '↩';
  return '⚙️';
});

const modalTitle = computed(() => {
  const idStr = currentRequest.value?.id ? ` #${currentRequest.value.id}` : '';
  if (actionType.value === 'cosign') return `簽核關卡加簽請託${idStr}`;
  if (actionType.value === 'forward') return `簽核關卡轉簽改派${idStr}`;
  if (actionType.value === 'return') return `退回簽核單${idStr}`;
  return '簽核操作';
});

const modalDesc = computed(() => {
  if (actionType.value === 'cosign') {
    return '您可以臨時邀請其他同仁進行會簽／並簽。完成後將依序繼續進行簽核流程。';
  }
  if (actionType.value === 'forward') {
    return '將目前步驟的簽核權限轉交給指定同仁／主管辦理（您將不再為此步驟簽核人）。';
  }
  if (actionType.value === 'return') {
    return '請選擇退回的目標關卡，並填寫退回原因，以利後續人員理解與修正。';
  }
  return '';
});

const submitBtnText = computed(() => {
  if (submitting.value) return '處理中…';
  if (actionType.value === 'cosign') return '送出加簽';
  if (actionType.value === 'forward') return '確認轉簽';
  if (actionType.value === 'return') return '確認退回';
  return '送出';
});

const submitBtnClass = computed(() => {
  if (actionType.value === 'return') return 'warning';
  return 'primary';
});

const candidateUsers = computed(() => {
  const users = window.appState?.users || window.state?.users || [];
  const myId = Number(window.appState?.user?.id || window.state?.user?.id || 0);
  return users.filter((u) => u.active !== 0 && Number(u.id) !== myId);
});

const requesterName = computed(() => {
  return (
    currentDetailData.value?.request?.requester_name ||
    currentRequest.value?.requester_name ||
    '原申請人'
  );
});

const priorSteps = computed(() => {
  const steps =
    currentDetailData.value?.request?.steps || currentRequest.value?.steps || [];
  const curStep =
    currentDetailData.value?.currentStep ||
    steps.find(
      (s) => Number(s.order) === Number(currentRequest.value?.current_step)
    );
  const curOrder = curStep ? Number(curStep.order) : 1;
  const filtered = steps.filter((s) => Number(s.order) < curOrder);
  return [...filtered].reverse();
});

function getAuthToken() {
  return localStorage.getItem('approval_token') || '';
}

async function apiCall(url, opts = {}) {
  const token = getAuthToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(opts.headers || {}),
  };
  const res = await fetch(url, {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `請求失敗 (${res.status})`);
  }
  return data;
}

function showToast(msg, type = 'info') {
  if (typeof window.__v2Toast === 'function') {
    window.__v2Toast(msg, type);
  } else if (typeof window.toast === 'function') {
    window.toast(msg, type);
  }
}

function openCosign(request, onDone) {
  actionType.value = 'cosign';
  currentRequest.value = request;
  currentDetailData.value = null;
  targetUserId.value = '';
  cosignPosition.value = 'current';
  comment.value = '';
  submitting.value = false;
  onDoneCallback = onDone;
  visible.value = true;
}

function openForward(request, onDone) {
  actionType.value = 'forward';
  currentRequest.value = request;
  currentDetailData.value = null;
  targetUserId.value = '';
  comment.value = '';
  submitting.value = false;
  onDoneCallback = onDone;
  visible.value = true;
}

function openReturn(request, detailData, onDone) {
  actionType.value = 'return';
  currentRequest.value = request;
  currentDetailData.value = detailData;
  returnTarget.value = 'applicant';
  comment.value = '';
  submitting.value = false;
  onDoneCallback = onDone;
  visible.value = true;
}

function close() {
  if (submitting.value) return;
  visible.value = false;
  actionType.value = '';
  currentRequest.value = null;
  currentDetailData.value = null;
  onDoneCallback = null;
}

async function handleSubmit() {
  if (submitting.value || !currentRequest.value) return;
  submitting.value = true;

  const reqId = currentRequest.value.id;

  try {
    if (actionType.value === 'cosign') {
      if (!targetUserId.value) throw new Error('請選擇加簽同仁');
      const res = await apiCall(`/api/requests/${reqId}/cosign`, {
        method: 'POST',
        body: {
          target_user_id: Number(targetUserId.value),
          position: cosignPosition.value || 'current',
          comment: String(comment.value || '').trim(),
        },
      });
      showToast(res.message || '已成功送出加簽請託', 'success');
      close();
      if (typeof onDoneCallback === 'function') onDoneCallback({ stay: true });
    } else if (actionType.value === 'forward') {
      if (!targetUserId.value) throw new Error('請選擇轉簽對象');
      const res = await apiCall(`/api/requests/${reqId}/forward`, {
        method: 'POST',
        body: {
          target_user_id: Number(targetUserId.value),
          comment: String(comment.value || '').trim(),
        },
      });
      showToast(res.message || '已成功轉簽改派', 'success');
      close();
      if (typeof onDoneCallback === 'function') onDoneCallback();
    } else if (actionType.value === 'return') {
      if (!String(comment.value || '').trim()) {
        throw new Error('請填寫退回原因');
      }
      const res = await apiCall(`/api/requests/${reqId}/action`, {
        method: 'POST',
        body: {
          action: 'return',
          target_step: returnTarget.value,
          comment: String(comment.value || '').trim(),
        },
      });
      showToast(res.message || '已成功退回', 'success');
      close();
      if (typeof onDoneCallback === 'function') onDoneCallback(res);
      else if (typeof window.navigate === 'function') {
        window.navigate('detail', { id: reqId });
      }
    }
  } catch (err) {
    showToast(err.message, 'error');
    submitting.value = false;
  }
}

function handleKeyDown(e) {
  if (visible.value && e.key === 'Escape' && !submitting.value) {
    close();
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown);
  if (typeof window !== 'undefined') {
    window.__openVueCosignModal = (req, done) => openCosign(req, done);
    window.__openVueForwardModal = (req, done) => openForward(req, done);
    window.__openVueReturnModal = (req, detail, done) => openReturn(req, detail, done);
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeyDown);
});

defineExpose({ openCosign, openForward, openReturn, close });
</script>

<style scoped>
.action-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1040;
  background: rgba(15, 23, 42, 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  animation: modalFadeIn 0.15s ease-out;
}

.action-modal-panel {
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.25), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
  width: 100%;
  max-width: 560px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 24px;
}

.action-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.action-modal-title {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 700;
  color: #0f172a;
  display: flex;
  align-items: center;
  gap: 8px;
}

.btn-close-sm {
  background: transparent;
  border: none;
  font-size: 1.2rem;
  color: #94a3b8;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
}
.btn-close-sm:hover {
  background: #f1f5f9;
  color: #334155;
}

.action-modal-desc {
  margin: 0 0 16px;
  font-size: 0.88rem;
  line-height: 1.5;
  color: #64748b;
}

.action-modal-form {
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field label {
  font-size: 0.88rem;
  font-weight: 600;
  color: #334155;
}

.form-select,
.form-textarea {
  width: 100%;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 0.92rem;
  color: #1e293b;
  outline: none;
  transition: border-color 0.15s;
}
.form-select:focus,
.form-textarea:focus {
  border-color: #2563eb;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.15);
}

.return-targets-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 240px;
  overflow-y: auto;
  padding: 2px;
}

.return-option {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 10px 14px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s;
  background: #f8fafc;
}
.return-option:hover {
  border-color: #cbd5e1;
  background: #f1f5f9;
}
.return-option.active {
  border-color: #f59e0b;
  background: #fffbeb;
}

.return-option input[type='radio'] {
  margin-top: 3px;
  accent-color: #d97706;
}

.return-option-info {
  flex: 1;
}

.return-option-title {
  font-weight: 600;
  font-size: 0.92rem;
  color: #1e293b;
  display: flex;
  align-items: center;
  gap: 6px;
}

.tag-prev {
  background: #e0f2fe;
  color: #0369a1;
  font-size: 0.72rem;
  padding: 2px 6px;
  border-radius: 4px;
}

.return-option-desc {
  font-size: 0.8rem;
  color: #64748b;
  margin-top: 2px;
}

.action-modal-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 10px;
  padding-top: 14px;
  border-top: 1px solid #e2e8f0;
}

.spinner-sm {
  width: 14px;
  height: 14px;
  border: 2px solid #ffffff;
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  display: inline-block;
  margin-right: 6px;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes modalFadeIn {
  from {
    opacity: 0;
    transform: scale(0.98);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
</style>
