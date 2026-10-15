import { createApp } from 'vue';
import { createPinia } from 'pinia';
import router from './router';
import App from './App.vue';
import { loadFormKernel } from '@/components/form/preload';

window.__loadFormKernel = loadFormKernel;

const app = createApp(App);

app.config.errorHandler = (err, vm, info) => {
  console.error('[Global Vue Error Handler]:', err, info);
};

app.use(createPinia());
app.use(router);

app.mount('#app');

if (typeof window !== 'undefined' && 'serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[PWA] SW register failed:', err);
    });
  });
}
