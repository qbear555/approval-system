import { createApp } from 'vue';
import { createPinia } from 'pinia';
import router from './router';
import App from './App.vue';

// 外觀統一使用經典 /css/style.css（由 LegacyHost 載入），不再引入 v2 main.css

const app = createApp(App);

// 全域未捕捉異常防護（防止全域崩潰）
app.config.errorHandler = (err, vm, info) => {
  console.error('[Global Vue Error Handler]:', err, info);
};

app.use(createPinia());
app.use(router);

app.mount('#app');
