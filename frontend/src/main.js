import { createApp } from 'vue';
import { createPinia } from 'pinia';
import router from './router';
import App from './App.vue';

const app = createApp(App);

app.config.errorHandler = (err, vm, info) => {
  console.error('[Global Vue Error Handler]:', err, info);
};

app.use(createPinia());
app.use(router);

app.mount('#app');
