import { createApp } from 'vue';
import { createPinia } from 'pinia';
import router from './router';
import App from './App.vue';
import { loadFormKernel } from '@/components/form/preload';

import { useSystemStore } from '@/stores/system';

window.__loadFormKernel = loadFormKernel;

const app = createApp(App);

app.config.errorHandler = (err, vm, info) => {
  console.error('[Global Vue Error Handler]:', err, info);
};

const pinia = createPinia();
app.use(pinia);
app.use(router);

// 頁面啟動時即刻獲取並套用品牌設定與頁簽圖標
try {
  useSystemStore(pinia).fetchPublicSettings();
} catch (e) {
  /* ignore */
}

app.mount('#app');

if (typeof window !== 'undefined' && 'serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[PWA] SW register failed:', err);
    });
  });
}
