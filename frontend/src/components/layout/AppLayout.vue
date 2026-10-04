<template>
  <div class="main-layout">
    <Sidebar />
    <main class="content">
      <header class="page-header">
        <h2>{{ currentTitle }}</h2>
        <div id="page-actions"></div>
      </header>
      <div class="page-body">
        <ErrorBoundary :key="$route.fullPath">
          <router-view />
        </ErrorBoundary>
      </div>
    </main>
    <Toast />
    <div id="modal" class="modal hidden">
      <div class="modal-backdrop" data-close-modal></div>
      <div class="modal-panel" id="modal-panel"></div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import Sidebar from './Sidebar.vue';
import ErrorBoundary from '@/components/common/ErrorBoundary.vue';
import Toast from '@/components/common/Toast.vue';
import { useSystemStore } from '@/stores/system';
import { minePageTitle } from '@/lib/status';

const route = useRoute();
const systemStore = useSystemStore();

const currentTitle = computed(() => {
  if (route.name === 'Mine') return minePageTitle(route.query.status);
  return route.meta?.title || '線上簽核';
});

onMounted(() => {
  systemStore.fetchPublicSettings();
  systemStore.fetchStats();
});
</script>
