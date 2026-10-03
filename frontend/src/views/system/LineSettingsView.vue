<template>
  <div class="line-settings-page">
    <div class="card section-card">
      <div class="card-header">
        <div>
          <h3 class="section-title">LINE 官方推播通知服務</h3>
          <p class="section-desc">串接 LINE Messaging API 獨立推播微服務，即時通知表單簽核狀態。</p>
        </div>
        <div class="status-badge">
          <span :class="['badge', isReady ? 'success' : isEnabled ? 'warning' : 'danger']">
            {{ statusText }}
          </span>
        </div>
      </div>

      <form @submit.prevent="saveConfig" class="settings-form">
        <div class="form-group checkbox-group">
          <label class="check-label">
            <input v-model="form.enabled" type="checkbox" />
            <span><strong>啟用 LINE 推播通知</strong></span>
          </label>
        </div>

        <div class="form-group">
          <label>LINE 微服務網址</label>
          <div class="input-with-btn">
            <input v-model="form.serviceUrl" type="text" class="form-control" placeholder="http://192.168.99.220:3850" />
            <button type="button" class="btn outline sm" :disabled="checking" @click="checkHealth">
              {{ checking ? '檢查中...' : '測試連線' }}
            </button>
          </div>
        </div>

        <div class="form-group">
          <label>內部 API 金鑰 (API Key)</label>
          <input v-model="form.apiKey" type="password" class="form-control" placeholder="輸入 line-notify 內部金鑰" />
        </div>

        <div class="form-group">
          <label>推播觸發事件</label>
          <div class="event-grid">
            <label class="check-label"><input v-model="form.events.pending" type="checkbox" /> <span>待簽核指派通知</span></label>
            <label class="check-label"><input v-model="form.events.submitted" type="checkbox" /> <span>送出申請確認</span></label>
            <label class="check-label"><input v-model="form.events.approved" type="checkbox" /> <span>核准結案通知</span></label>
            <label class="check-label"><input v-model="form.events.rejected" type="checkbox" /> <span>退回駁回通知</span></label>
            <label class="check-label"><input v-model="form.events.step" type="checkbox" /> <span>階段流轉通知</span></label>
            <label class="check-label"><input v-model="form.events.remind" type="checkbox" /> <span>逾期未簽催簽提醒</span></label>
          </div>
        </div>

        <div class="actions-bar">
          <button type="button" class="btn outline" :disabled="testing" @click="sendTestMessage">
            {{ testing ? '發送中...' : '發送測試推播' }}
          </button>
          <button type="submit" class="btn primary" :disabled="saving">
            {{ saving ? '儲存中...' : '儲存 LINE 設定' }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { apiRequest } from '@/api/client';
import { useToastStore } from '@/stores/toast';

const toast = useToastStore();

const loading = ref(true);
const saving = ref(false);
const checking = ref(false);
const testing = ref(false);

const form = ref({
  enabled: false,
  serviceUrl: 'http://192.168.99.220:3850',
  apiKey: '',
  events: {
    pending: true,
    submitted: true,
    approved: true,
    rejected: true,
    step: false,
    remind: true,
  },
});

const isReady = ref(false);
const isEnabled = computed(() => form.value.enabled);

const statusText = computed(() => {
  if (isReady.value) return '服務連線就緒';
  if (form.value.enabled) return '已啟用但尚未就緒';
  return '未啟用';
});

onMounted(() => {
  loadConfig();
});

async function loadConfig() {
  loading.value = true;
  try {
    const res = await apiRequest('/api/line/config');
    if (res && res.config) {
      const c = res.config;
      form.value.enabled = !!c.enabled;
      form.value.serviceUrl = c.serviceUrl || 'http://192.168.99.220:3850';
      form.value.apiKey = c.apiKey || '';
      if (c.events) form.value.events = { ...form.value.events, ...c.events };
      isReady.value = !!c.ready;
    }
  } catch (err) {
    console.warn(err);
  } finally {
    loading.value = false;
  }
}

async function saveConfig() {
  saving.value = true;
  try {
    await apiRequest('/api/line/config', {
      method: 'PUT',
      body: JSON.stringify(form.value),
    });
    toast.success('LINE 設定已成功更新！');
    await loadConfig();
  } catch (err) {
    toast.error('儲存失敗: ' + err.message);
  } finally {
    saving.value = false;
  }
}

async function checkHealth() {
  checking.value = true;
  try {
    const res = await apiRequest('/api/line/health');
    if (res && res.ok) {
      toast.success('LINE 服務狀態正常！');
      isReady.value = true;
    } else {
      toast.error('LINE 服務狀態異常');
    }
  } catch (err) {
    toast.error('無法連線至 LINE 服務: ' + err.message);
  } finally {
    checking.value = false;
  }
}

async function sendTestMessage() {
  testing.value = true;
  try {
    await apiRequest('/api/line/test', { method: 'POST' });
    toast.success('測試推播已發出，請檢查 LINE！');
  } catch (err) {
    toast.error('測試推播失敗: ' + err.message);
  } finally {
    testing.value = false;
  }
}
</script>

<style scoped>
.line-settings-page {
  max-width: 800px;
  margin: 0 auto;
}

.section-card {
  padding: 24px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 20px;
}

.section-title {
  font-size: 1.15rem;
  font-weight: 700;
  margin-bottom: 4px;
}

.section-desc {
  font-size: 0.88rem;
  color: var(--text-muted);
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

.form-control {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 0.95rem;
}

.input-with-btn {
  display: flex;
  gap: 10px;
}

.event-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px;
  padding: 12px;
  background: #f8fafc;
  border-radius: 6px;
}

.check-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 0.9rem;
}

.actions-bar {
  display: flex;
  justify-content: space-between;
  margin-top: 24px;
}
</style>
