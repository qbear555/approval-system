<template>
  <div class="request-detail-page">
    <div v-if="loading" class="card text-center p-4 muted">載入簽核詳情中...</div>

    <div v-else-if="!request" class="card text-center p-4 muted">查無此簽核申請案件。</div>

    <div v-else class="detail-container">
      <!-- 頂部資訊列與操作按鈕 -->
      <div class="header-card card">
        <div class="header-main">
          <div class="title-row">
            <h2>{{ request.workflow_name }}</h2>
            <span class="serial-tag font-mono">{{ request.serial_no || '#' + request.id }}</span>
            <span :class="['badge', getStatusBadgeClass(request.status)]">
              {{ getStatusLabel(request.status) }}
            </span>
          </div>
          <div class="meta-row">
            <span>申請人：<strong>{{ request.applicant_name }}</strong></span>
            <span>所屬部門：{{ request.applicant_dept || '—' }}</span>
            <span>申請時間：{{ formatDate(request.created_at) }}</span>
          </div>
        </div>

        <div class="header-actions">
          <a :href="'/api/requests/' + request.id + '/pdf'" class="btn outline" download>
            下載 PDF
          </a>

          <!-- 簽核者專屬審批按鈕 -->
          <template v-if="canApprove">
            <button type="button" class="btn success" @click="openApproveModal">
              核准
            </button>
            <button type="button" class="btn danger" @click="openRejectModal">
              駁回
            </button>
          </template>
        </div>
      </div>

      <div class="content-grid">
        <!-- 左側：表單填寫內容 -->
        <div class="card form-content-card">
          <h3 class="section-title">申請表單資訊</h3>
          <div class="fields-list">
            <div v-for="(val, key) in parsedFormData" :key="key" class="field-item">
              <span class="field-label">{{ getFieldLabel(key) }}</span>
              <span class="field-value">{{ formatFieldValue(val) }}</span>
            </div>
            <div v-if="Object.keys(parsedFormData).length === 0" class="muted">
              無填寫欄位資料
            </div>
          </div>

          <!-- 附件清單 -->
          <div v-if="request.attachments && request.attachments.length" class="attachments-section">
            <h4 class="sub-title">附加檔案 ({{ request.attachments.length }})</h4>
            <div class="att-list">
              <a
                v-for="att in request.attachments"
                :key="att.id"
                :href="'/uploads/' + att.filename"
                class="att-item"
                target="_blank"
                download
              >
                {{ att.original_name || att.filename }}
              </a>
            </div>
          </div>
        </div>

        <!-- 右側：簽核流程與關卡歷程 -->
        <div class="card workflow-timeline-card">
          <h3 class="section-title">簽核關卡與歷程</h3>

          <div class="timeline">
            <div
              v-for="(step, idx) in workflowSteps"
              :key="idx"
              :class="['timeline-item', getStepClass(step)]"
            >
              <div class="timeline-indicator">
                <span class="dot"></span>
                <span v-if="idx < workflowSteps.length - 1" class="line"></span>
              </div>
              <div class="timeline-content">
                <div class="step-head">
                  <strong class="step-name">{{ step.step_name || '關卡 ' + (idx + 1) }}</strong>
                  <span :class="['badge sm', getStepBadgeClass(step.status)]">
                    {{ getStepStatusText(step.status) }}
                  </span>
                </div>
                <div class="step-meta">
                  審核人：{{ step.approver_name || '系統自動指定' }}
                </div>
                <div v-if="step.comment" class="step-comment">
                  意見：{{ step.comment }}
                </div>
                <div v-if="step.action_time" class="step-time">
                  {{ formatDate(step.action_time) }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Modal: 核准確認 -->
    <div v-if="showApproveModal" class="modal-backdrop">
      <div class="modal-card card">
        <h3 class="modal-title">確認核准此簽核單</h3>
        <form @submit.prevent="submitApprove">
          <div class="form-group">
            <label>核准意見 (選填)</label>
            <textarea v-model="actionComment" class="form-control" rows="3" placeholder="請填寫簽核附註或建議事項..."></textarea>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn outline" @click="showApproveModal = false">取消</button>
            <button type="submit" class="btn success" :disabled="submittingAction">
              {{ submittingAction ? '處理中...' : '確認核准' }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- Modal: 駁回確認 -->
    <div v-if="showRejectModal" class="modal-backdrop">
      <div class="modal-card card">
        <h3 class="modal-title">駁回此簽核單</h3>
        <form @submit.prevent="submitReject">
          <div class="form-group">
            <label>駁回原因說明 *</label>
            <textarea v-model="actionComment" class="form-control" rows="3" required placeholder="請明確填寫退件或駁回原因..."></textarea>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn outline" @click="showRejectModal = false">取消</button>
            <button type="submit" class="btn danger" :disabled="submittingAction">
              {{ submittingAction ? '處理中...' : '確認駁回' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { apiRequest } from '@/api/client';
import { useToastStore } from '@/stores/toast';

const route = useRoute();
const toast = useToastStore();

const requestId = route.params.id;
const request = ref(null);
const canApprove = ref(false);
const workflowSteps = ref([]);
const loading = ref(true);

const showApproveModal = ref(false);
const showRejectModal = ref(false);
const actionComment = ref('');
const submittingAction = ref(false);

onMounted(() => {
  loadDetail();
});

async function loadDetail() {
  loading.value = true;
  try {
    const res = await apiRequest(`/api/requests/${requestId}`);
    if (res && res.request) {
      request.value = res.request;
      canApprove.value = !!res.canApprove;
      workflowSteps.value = res.request.steps || res.steps || [];
    }
  } catch (err) {
    toast.error('載入詳情失敗: ' + err.message);
  } finally {
    loading.value = false;
  }
}

const parsedFormData = computed(() => {
  if (!request.value) return {};
  const raw = request.value.form_data;
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
});

function getFieldLabel(key) {
  return key;
}

function formatFieldValue(val) {
  if (val === true) return '已確認 / 是';
  if (val === false) return '否';
  if (val == null || val === '') return '—';
  return String(val);
}

function getStepClass(step) {
  if (step.status === 'approved') return 'step-approved';
  if (step.status === 'rejected') return 'step-rejected';
  if (step.status === 'pending') return 'step-current';
  return 'step-waiting';
}

function getStepBadgeClass(status) {
  if (status === 'approved') return 'success';
  if (status === 'rejected') return 'danger';
  if (status === 'pending') return 'warning';
  return 'outline';
}

function getStepStatusText(status) {
  if (status === 'approved') return '已核准';
  if (status === 'rejected') return '已駁回';
  if (status === 'pending') return '進行中';
  return '等待中';
}

function getStatusLabel(status) {
  const map = { pending: '審核中', approved: '已核准', rejected: '已駁回', cancelled: '已撤回' };
  return map[status] || status;
}

function getStatusBadgeClass(status) {
  const map = { pending: 'warning', approved: 'success', rejected: 'danger', cancelled: 'outline' };
  return map[status] || 'outline';
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    return iso;
  }
}

function openApproveModal() {
  actionComment.value = '';
  showApproveModal.value = true;
}

function openRejectModal() {
  actionComment.value = '';
  showRejectModal.value = true;
}

async function submitApprove() {
  submittingAction.value = true;
  try {
    await apiRequest(`/api/requests/${requestId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ comment: actionComment.value }),
    });
    toast.success('簽核案件已成功核准！');
    showApproveModal.value = false;
    await loadDetail();
  } catch (err) {
    toast.error('核准失敗: ' + err.message);
  } finally {
    submittingAction.value = false;
  }
}

async function submitReject() {
  submittingAction.value = true;
  try {
    await apiRequest(`/api/requests/${requestId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ comment: actionComment.value }),
    });
    toast.success('簽核案件已駁回！');
    showRejectModal.value = false;
    await loadDetail();
  } catch (err) {
    toast.error('駁回失敗: ' + err.message);
  } finally {
    submittingAction.value = false;
  }
}
</script>

<style scoped>
.request-detail-page {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.header-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 24px;
}

.title-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}
.title-row h2 {
  font-size: 1.35rem;
  font-weight: 700;
}
.serial-tag {
  background: #f1f5f9;
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 0.85rem;
}

.meta-row {
  display: flex;
  gap: 20px;
  font-size: 0.88rem;
  color: var(--text-muted);
}

.header-actions {
  display: flex;
  gap: 10px;
}

.content-grid {
  display: grid;
  grid-template-columns: 3fr 2fr;
  gap: 20px;
}

.section-title {
  font-size: 1.1rem;
  font-weight: 700;
  margin-bottom: 16px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
}

.fields-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.field-item {
  display: flex;
  padding: 8px 12px;
  background: #f8fafc;
  border-radius: 6px;
}
.field-label {
  width: 140px;
  font-weight: 600;
  color: var(--text-muted);
  font-size: 0.9rem;
}
.field-value {
  flex: 1;
  font-size: 0.92rem;
  color: var(--text-main);
}

.attachments-section {
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}
.sub-title {
  font-size: 0.95rem;
  margin-bottom: 10px;
}
.att-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.att-item {
  display: inline-block;
  padding: 6px 10px;
  background: #eff6ff;
  color: #1d4ed8;
  text-decoration: none;
  border-radius: 4px;
  font-size: 0.85rem;
}

/* Timeline */
.timeline {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.timeline-item {
  display: flex;
  gap: 12px;
}

.timeline-indicator {
  display: flex;
  flex-direction: column;
  align-items: center;
}
.dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #cbd5e1;
  margin-top: 4px;
}
.line {
  flex: 1;
  width: 2px;
  background: #e2e8f0;
  margin: 4px 0;
}

.step-approved .dot { background: var(--success); }
.step-current .dot  { background: var(--warning); }
.step-rejected .dot { background: var(--danger); }

.timeline-content {
  flex: 1;
  background: #f8fafc;
  padding: 10px 14px;
  border-radius: 6px;
}

.step-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}
.step-meta {
  font-size: 0.82rem;
  color: var(--text-muted);
}
.step-comment {
  font-size: 0.85rem;
  margin-top: 4px;
  color: #0f172a;
}
.step-time {
  font-size: 0.75rem;
  color: #94a3b8;
  margin-top: 4px;
}

/* Modal */
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 999;
}
.modal-card {
  width: 100%;
  max-width: 480px;
  padding: 24px;
  background: #ffffff;
}
.modal-title {
  font-size: 1.15rem;
  font-weight: 700;
  margin-bottom: 16px;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 20px;
}
</style>
