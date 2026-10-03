<template>
  <div class="new-request-page">
    <div class="header-card card">
      <div class="header-info">
        <h3>新增簽核申請</h3>
        <p class="muted">選擇所需的表單流程，填妥申請資訊後送出進入審批。</p>
      </div>
      <button v-if="selectedWorkflow" type="button" class="btn outline" @click="resetSelection">
        ← 重新選擇流程
      </button>
    </div>

    <!-- 步驟 1：選擇簽核流程範本 -->
    <div v-if="!selectedWorkflow" class="workflow-selection">
      <div v-if="loadingWf" class="card text-center p-4 muted">載入流程範本中...</div>
      <div v-else class="wf-grid">
        <div
          v-for="wf in activeWorkflows"
          :key="wf.id"
          class="wf-card card"
          @click="selectWorkflow(wf)"
        >
          <h4 class="wf-title">{{ wf.name }}</h4>
          <p class="wf-desc">{{ wf.description || '點擊填寫並發起申請' }}</p>
          <div class="wf-meta">
            <span class="badge primary">{{ (wf.steps || []).length }} 道審批關卡</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 步驟 2：填寫表單內容 -->
    <div v-else class="form-section card">
      <div class="selected-wf-banner">
        <strong>正在申請：{{ selectedWorkflow.name }}</strong>
        <span class="muted">{{ selectedWorkflow.description }}</span>
      </div>

      <form @submit.prevent="submitRequest" class="request-form">
        <!-- 動態欄位 -->
        <div v-for="field in formFields" :key="field.id" class="form-group">
          <label>
            {{ field.label }}
            <span v-if="field.required" class="required-star">*</span>
          </label>

          <!-- Text Input -->
          <input
            v-if="field.type === 'text'"
            v-model="formData[field.id]"
            type="text"
            class="form-control"
            :required="field.required"
            :placeholder="field.placeholder || ''"
          />

          <!-- Textarea -->
          <textarea
            v-else-if="field.type === 'textarea'"
            v-model="formData[field.id]"
            class="form-control"
            rows="3"
            :required="field.required"
            :placeholder="field.placeholder || ''"
          ></textarea>

          <!-- Number -->
          <input
            v-else-if="field.type === 'number'"
            v-model.number="formData[field.id]"
            type="number"
            class="form-control"
            :required="field.required"
          />

          <!-- Date -->
          <input
            v-else-if="field.type === 'date'"
            v-model="formData[field.id]"
            type="date"
            class="form-control"
            :required="field.required"
          />

          <!-- Datetime -->
          <input
            v-else-if="field.type === 'datetime'"
            v-model="formData[field.id]"
            type="datetime-local"
            class="form-control"
            :required="field.required"
          />

          <!-- Select -->
          <select
            v-else-if="field.type === 'select'"
            v-model="formData[field.id]"
            class="form-control"
            :required="field.required"
          >
            <option value="">-- 請選擇 --</option>
            <option v-for="opt in field.options" :key="opt" :value="opt">{{ opt }}</option>
          </select>

          <!-- Checkbox -->
          <div v-else-if="field.type === 'checkbox'" class="check-box">
            <label class="check-label">
              <input v-model="formData[field.id]" type="checkbox" />
              <span>確認勾選</span>
            </label>
          </div>
        </div>

        <!-- 檔案附件上傳 -->
        <div class="form-group file-group">
          <label>附件上傳 (可多選)</label>
          <input type="file" multiple class="form-control" @change="handleFiles" />
          <div v-if="files.length" class="file-list">
            <span v-for="f in files" :key="f.name" class="file-tag">
              {{ f.name }} ({{ (f.size / 1024).toFixed(0) }} KB)
            </span>
          </div>
        </div>

        <div class="submit-actions">
          <button type="button" class="btn outline" @click="resetSelection">取消</button>
          <button type="submit" class="btn primary" :disabled="submitting">
            {{ submitting ? '送出簽核中...' : '確認送出申請' }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { apiRequest } from '@/api/client';
import { useToastStore } from '@/stores/toast';

const router = useRouter();
const toast = useToastStore();

const workflows = ref([]);
const loadingWf = ref(true);
const selectedWorkflow = ref(null);
const formData = ref({});
const files = ref([]);
const submitting = ref(false);

const activeWorkflows = computed(() => {
  return workflows.value.filter((w) => w.active !== 0);
});

const formFields = computed(() => {
  if (!selectedWorkflow.value) return [];
  const fields = selectedWorkflow.value.form_fields;
  if (Array.isArray(fields)) return fields;
  try {
    return JSON.parse(fields || '[]');
  } catch {
    return [];
  }
});

onMounted(async () => {
  loadingWf.value = true;
  try {
    const res = await apiRequest('/api/workflows');
    workflows.value = res.workflows || [];
  } catch (err) {
    toast.error('載入流程失敗: ' + err.message);
  } finally {
    loadingWf.value = false;
  }
});

function selectWorkflow(wf) {
  selectedWorkflow.value = wf;
  formData.value = {};
  files.value = [];
  formFields.value.forEach((f) => {
    formData.value[f.id] = f.type === 'checkbox' ? false : '';
  });
}

function resetSelection() {
  selectedWorkflow.value = null;
  formData.value = {};
  files.value = [];
}

function handleFiles(e) {
  files.value = Array.from(e.target.files || []);
}

async function submitRequest() {
  submitting.value = true;
  try {
    const fd = new FormData();
    fd.append('workflow_id', selectedWorkflow.value.id);
    fd.append('form_data', JSON.stringify(formData.value));
    files.value.forEach((file) => {
      fd.append('attachments', file);
    });

    const res = await apiRequest('/api/requests', {
      method: 'POST',
      body: fd,
    });

    toast.success('申請案件已成功送出！');
    const newId = res.request?.id || res.id;
    if (newId) {
      router.push(`/requests/${newId}`);
    } else {
      router.push('/mine');
    }
  } catch (err) {
    toast.error('送出申請失敗: ' + err.message);
  } finally {
    submitting.value = false;
  }
}
</script>

<style scoped>
.new-request-page {
  max-width: 820px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.header-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px;
}

.header-info h3 {
  font-size: 1.15rem;
  margin-bottom: 4px;
}

.muted {
  font-size: 0.88rem;
  color: var(--text-muted);
}

.wf-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 16px;
}

.wf-card {
  padding: 20px;
  cursor: pointer;
  transition: all 0.15s ease;
  display: flex;
  flex-direction: column;
}
.wf-card:hover {
  transform: translateY(-3px);
  border-color: var(--primary);
  box-shadow: 0 4px 14px rgba(37, 99, 235, 0.12);
}

.wf-icon {
  font-size: 2rem;
  margin-bottom: 8px;
}

.wf-title {
  font-size: 1.1rem;
  font-weight: 700;
  margin-bottom: 6px;
}

.wf-desc {
  font-size: 0.85rem;
  color: var(--text-muted);
  flex: 1;
  margin-bottom: 12px;
}

.form-section {
  padding: 28px;
}

.selected-wf-banner {
  padding: 12px 16px;
  background: var(--primary-light);
  border-radius: 6px;
  margin-bottom: 24px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: var(--primary);
}

.form-group {
  margin-bottom: 18px;
}

.form-group label {
  display: block;
  font-size: 0.9rem;
  font-weight: 600;
  margin-bottom: 6px;
}

.required-star {
  color: var(--danger);
}

.form-control {
  width: 100%;
  padding: 9px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 0.95rem;
}

.file-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}
.file-tag {
  background: #f1f5f9;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.8rem;
}

.submit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 28px;
}
</style>
