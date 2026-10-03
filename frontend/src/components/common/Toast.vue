<template>
  <transition name="toast-fade">
    <div v-if="toastStore.visible" :class="['toast-box', toastStore.type]">
      <span class="icon">{{ icon }}</span>
      <span class="msg">{{ toastStore.message }}</span>
    </div>
  </transition>
</template>

<script setup>
import { computed } from 'vue';
import { useToastStore } from '@/stores/toast';

const toastStore = useToastStore();

const icon = computed(() => {
  if (toastStore.type === 'success') return '✅';
  if (toastStore.type === 'error') return '❌';
  return 'ℹ️';
});
</script>

<style scoped>
.toast-box {
  position: fixed;
  bottom: 28px;
  right: 28px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 20px;
  border-radius: 8px;
  font-size: 0.92rem;
  font-weight: 500;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
  z-index: 9999;
}

.toast-box.success {
  background: #15803d;
  color: #ffffff;
}

.toast-box.error {
  background: #b91c1c;
  color: #ffffff;
}

.toast-box.info {
  background: #1e293b;
  color: #ffffff;
}

.toast-fade-enter-active,
.toast-fade-leave-active {
  transition: all 0.25s ease;
}

.toast-fade-enter-from,
.toast-fade-leave-to {
  opacity: 0;
  transform: translateY(12px);
}
</style>
