<template>
  <div class="workflows-page">
    <div class="header-card card">
      <div class="header-info">
        <h3>簽核流程範本管理</h3>
        <p class="muted">檢視與管理各項表單之多層審核關卡、主管審批規則與自訂欄位。</p>
      </div>
    </div>

    <div v-if="loading" class="card text-center p-4 muted">載入簽核流程範本中...</div>

    <div v-else class="wf-list">
      <div v-for="wf in workflows" :key="wf.id" class="wf-item-card card">
        <div class="wf-top">
          <div class="wf-title-box">
            <div>
              <h4 class="wf-name">{{ wf.name }}</h4>
              <p class="wf-desc">{{ wf.description || '無詳細說明' }}</p>
            </div>
          </div>
          <div class="wf-actions">
            <span :class="['badge', wf.active !== 0 ? 'success' : 'outline']">
              {{ wf.active !== 0 ? '啟用中' : '已停用' }}
            </span>
            <button
              type="button"
              class="btn outline sm"
              @click="toggleActive(wf)"
            >
              {{ wf.active !== 0 ? '停用此流程' : '啟用流程' }}
            </button>
          </div>
        </div>

        <div class="steps-flow">
          <div class="flow-label">審批流轉關卡：</div>
          <div class="steps-container">
            <div
              v-for="(st, idx) in parseSteps(wf.steps)"
              :key="idx"
              class="step-node"
            >
              <span class="step-num">{{ idx + 1 }}</span>
              <span class="step-txt">{{ st.name || st.step_name || '主管審核' }}</span>
              <span v-if="idx < parseSteps(wf.steps).length - 1" class="step-arrow">→</span>
            </div>
            <div v-if="parseSteps(wf.steps).length === 0" class="muted-small">
              無設定關卡
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { apiRequest } from '@/api/client';
import { useToastStore } from '@/stores/toast';

const toast = useToastStore();

const workflows = ref([]);
const loading = ref(true);

onMounted(() => {
  loadWorkflows();
});

async function loadWorkflows() {
  loading.value = true;
  try {
    const res = await apiRequest('/api/workflows');
    workflows.value = res.workflows || [];
  } catch (err) {
    toast.error('載入流程失敗: ' + err.message);
  } finally {
    loading.value = false;
  }
}

function parseSteps(steps) {
  if (Array.isArray(steps)) return steps;
  try {
    return JSON.parse(steps || '[]');
  } catch {
    return [];
  }
}

async function toggleActive(wf) {
  const newStatus = wf.active !== 0 ? 0 : 1;
  try {
    await apiRequest(`/api/workflows/${wf.id}`, {
      method: 'PUT',
      body: JSON.stringify({ active: newStatus }),
    });
    toast.success(`流程【${wf.name}】已${newStatus ? '啟用' : '停用'}`);
    await loadWorkflows();
  } catch (err) {
    toast.error('操作失敗: ' + err.message);
  }
}
</script>

<style scoped>
.workflows-page {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.header-card {
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

.wf-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.wf-item-card {
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.wf-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.wf-title-box {
  display: flex;
  align-items: center;
  gap: 12px;
}

.wf-badge-icon {
  font-size: 1.8rem;
}

.wf-name {
  font-size: 1.15rem;
  font-weight: 700;
  margin-bottom: 4px;
}

.wf-desc {
  font-size: 0.88rem;
  color: var(--text-muted);
}

.wf-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.steps-flow {
  background: #f8fafc;
  padding: 12px 16px;
  border-radius: 6px;
  font-size: 0.88rem;
}

.flow-label {
  font-weight: 600;
  color: var(--text-muted);
  margin-bottom: 8px;
}

.steps-container {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.step-node {
  display: flex;
  align-items: center;
  gap: 6px;
  background: #ffffff;
  border: 1px solid var(--border);
  padding: 4px 10px;
  border-radius: 4px;
}

.step-num {
  width: 18px;
  height: 18px;
  background: var(--primary);
  color: white;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  font-weight: 700;
}

.step-txt {
  font-weight: 500;
}

.step-arrow {
  color: #94a3b8;
  font-weight: 700;
}

.muted-small {
  color: #94a3b8;
}
</style>
