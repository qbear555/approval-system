<template>
  <div class="main-layout">
    <Sidebar />
    <main class="content">
      <header class="page-header">
        <!-- 標題用 textContent 寫入，避免 Vue 插值蓋掉詳情頁「簽核詳情 #123」 -->
        <h2 id="page-title"></h2>
        <div id="page-actions"></div>
      </header>
      <div class="page-body">
        <ErrorBoundary :key="$route.fullPath">
          <Suspense>
            <router-view />
            <template #fallback>
              <div class="muted" style="padding:28px;text-align:center">載入中…</div>
            </template>
          </Suspense>
        </ErrorBoundary>
      </div>
    </main>
    <div id="modal" class="modal hidden">
      <div class="modal-backdrop" data-close-modal></div>
      <div class="modal-panel" id="modal-panel"></div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import Sidebar from './Sidebar.vue';
import ErrorBoundary from '@/components/common/ErrorBoundary.vue';
import { useSystemStore } from '@/stores/system';
import { minePageTitle } from '@/lib/status';
import { applyUserTheme } from '@/lib/theme';
import { startPendingWatcher } from '@/lib/admin-runtime';

const route = useRoute();
const systemStore = useSystemStore();

const currentTitle = computed(() => {
  if (route.name === 'Mine') return minePageTitle(route.query.status);
  return route.meta?.title || '線上簽核';
});

function applyTitle(t) {
  const el = document.getElementById('page-title');
  if (el) el.textContent = t;
}

watch(currentTitle, applyTitle, { flush: 'post' });

onMounted(() => {
  applyTitle(currentTitle.value);
  applyUserTheme(localStorage.getItem('approval_user_theme') || 'navy', false);
  systemStore.fetchPublicSettings();
  systemStore.fetchStats();
  startPendingWatcher();
});
</script>
