<template>
  <div class="auth-wrap">
    <div class="auth-card">
      <div class="auth-brand">
        <img :src="systemStore.logoUrl" alt="Logo" class="brand-logo brand-logo-auth" width="1048" height="289" decoding="async" />
        <div class="company-name">{{ systemStore.companyName }}</div>
        <h1>線上簽核</h1>
        <p>自訂流程 · 紀錄留存 · PDF 匯出</p>
        <div class="app-version">{{ systemStore.version }}</div>
      </div>

      <form @submit.prevent="handleSubmit" class="auth-form">
        <label>帳號
          <input
            v-model="username"
            type="text"
            required
            autocomplete="username"
            placeholder="請輸入帳號"
          />
        </label>
        <label>密碼
          <input
            v-model="password"
            type="password"
            required
            autocomplete="current-password"
            placeholder="請輸入密碼"
          />
        </label>
        <div v-if="error" class="error-msg">{{ error }}</div>
        <button type="submit" class="btn primary block" :disabled="authStore.loading">
          {{ authStore.loading ? '登入中...' : '登入' }}
        </button>
      </form>

      <div class="auth-version-foot muted app-version">
        {{ systemStore.companyName }} · {{ systemStore.version }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useSystemStore } from '@/stores/system';

const router = useRouter();
const route = useRoute();
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
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/dashboard';
    router.push(redirect || '/dashboard');
  } catch (err) {
    error.value = err.message || '帳號或密碼錯誤';
  }
}
</script>
