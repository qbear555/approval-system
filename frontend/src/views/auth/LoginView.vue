<template>
  <div class="auth-wrap">
    <div class="auth-card card">
      <div class="auth-brand">
        <img :src="systemStore.logoUrl" alt="Logo" class="brand-logo" />
        <div class="company-name">{{ systemStore.companyName }}</div>
        <h1>線上簽核</h1>
        <p class="subtitle">自訂流程 · 紀錄留存 · PDF 匯出</p>
      </div>

      <form @submit.prevent="handleSubmit" class="auth-form">
        <div class="form-group">
          <label>帳號</label>
          <input
            v-model="username"
            type="text"
            required
            autocomplete="username"
            placeholder="請輸入帳號"
            class="form-control"
          />
        </div>

        <div class="form-group">
          <label>密碼</label>
          <input
            v-model="password"
            type="password"
            required
            autocomplete="current-password"
            placeholder="請輸入密碼"
            class="form-control"
          />
        </div>

        <div v-if="error" class="error-banner">
          {{ error }}
        </div>

        <button type="submit" class="btn primary block submit-btn" :disabled="authStore.loading">
          {{ authStore.loading ? '登入中...' : '登入' }}
        </button>
      </form>

      <div class="auth-footer">
        {{ systemStore.companyName }} · {{ systemStore.version }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useSystemStore } from '@/stores/system';

const router = useRouter();
const authStore = useAuthStore();
const systemStore = useSystemStore();

const username = ref('');
const password = ref('');
const error = ref('');

onMounted(() => {
  systemStore.fetchPublicSettings();
});

async function handleSubmit() {
  error.value = '';
  try {
    await authStore.login(username.value, password.value);
    router.push('/dashboard');
  } catch (err) {
    error.value = err.message || '帳號或密碼錯誤';
  }
}
</script>

<style scoped>
.auth-wrap {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #f0f4f8 0%, #d9e2ec 100%);
  padding: 20px;
}

.auth-card {
  width: 100%;
  max-width: 400px;
  background: #ffffff;
  border-radius: 12px;
  padding: 36px 32px;
  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
}

.auth-brand {
  text-align: center;
  margin-bottom: 28px;
}

.brand-logo {
  height: 48px;
  max-width: 160px;
  object-fit: contain;
  margin-bottom: 8px;
}

.company-name {
  font-size: 0.85rem;
  color: var(--text-muted);
  margin-bottom: 6px;
}

h1 {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--text-main);
  margin-bottom: 4px;
}

.subtitle {
  font-size: 0.85rem;
  color: var(--text-muted);
}

.form-group {
  margin-bottom: 18px;
}

.form-group label {
  display: block;
  font-size: 0.88rem;
  font-weight: 500;
  color: var(--text-main);
  margin-bottom: 6px;
}

.form-control {
  width: 100%;
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 0.95rem;
  outline: none;
  transition: border-color 0.15s ease;
}

.form-control:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
}

.error-banner {
  background: #fee2e2;
  color: #991b1b;
  padding: 10px 12px;
  border-radius: 6px;
  font-size: 0.85rem;
  margin-bottom: 16px;
}

.submit-btn {
  width: 100%;
  padding: 11px;
  font-size: 1rem;
}

.auth-footer {
  text-align: center;
  margin-top: 24px;
  font-size: 0.75rem;
  color: var(--text-muted);
}
</style>
