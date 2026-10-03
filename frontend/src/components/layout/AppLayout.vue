<template>
  <div class="layout-container">
    <Sidebar />
    <div class="layout-main">
      <Header :title="currentTitle">
        <template #actions>
          <div id="header-portal"></div>
        </template>
      </Header>
      <main class="page-content">
        <ErrorBoundary :key="$route.fullPath">
          <router-view />
        </ErrorBoundary>
      </main>
    </div>
    <Toast />
  </div>
</template>

<script setup>
import { computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import Sidebar from './Sidebar.vue';
import Header from './Header.vue';
import ErrorBoundary from '@/components/common/ErrorBoundary.vue';
import Toast from '@/components/common/Toast.vue';
import { useSystemStore } from '@/stores/system';

const route = useRoute();
const systemStore = useSystemStore();

const currentTitle = computed(() => {
  return route.meta?.title || '線上簽核';
});

onMounted(() => {
  systemStore.fetchPublicSettings();
  systemStore.fetchStats();
});
</script>

<style scoped>
.layout-container {
  display: flex;
  min-height: 100vh;
}

.layout-main {
  margin-left: var(--sidebar-w);
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.page-content {
  flex: 1;
  padding: 24px 28px;
  background: var(--bg-app);
}
</style>
