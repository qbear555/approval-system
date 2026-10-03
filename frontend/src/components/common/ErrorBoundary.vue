<template>
  <div v-if="hasError" class="error-boundary card">
    <div class="error-header">
      <span class="error-icon">⚠️</span>
      <strong>此模組載入或執行發生異常</strong>
    </div>
    <p class="error-msg">{{ errorMessage }}</p>
    <div class="error-actions">
      <button type="button" class="btn outline" @click="retry">重新整理此模組</button>
      <button type="button" class="btn primary" @click="goHome">返回總覽</button>
    </div>
  </div>
  <slot v-else></slot>
</template>

<script setup>
import { ref, onErrorCaptured } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();
const hasError = ref(false);
const errorMessage = ref('');

onErrorCaptured((err, instance, info) => {
  console.error('[Module Error Boundary Intercepted]:', err, info);
  hasError.value = true;
  errorMessage.value = err?.message || '發生未預期的組件錯誤';
  // 回傳 false 阻止錯誤向上傳遞，徹底隔離模組錯誤！
  return false;
});

function retry() {
  hasError.value = false;
  errorMessage.value = '';
}

function goHome() {
  hasError.value = false;
  errorMessage.value = '';
  router.push('/dashboard');
}
</script>

<style scoped>
.error-boundary {
  border: 1px solid #fecaca;
  background-color: #fff1f2;
  padding: 24px;
  border-radius: 8px;
  margin: 16px 0;
}
.error-header {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #991b1b;
  font-size: 1.1rem;
  margin-bottom: 8px;
}
.error-icon {
  font-size: 1.3rem;
}
.error-msg {
  color: #b91c1c;
  font-size: 0.95rem;
  margin-bottom: 16px;
  font-family: monospace;
  background: #fee2e2;
  padding: 8px 12px;
  border-radius: 4px;
}
.error-actions {
  display: flex;
  gap: 12px;
}
</style>
