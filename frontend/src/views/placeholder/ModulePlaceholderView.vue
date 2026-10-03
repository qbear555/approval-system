<template>
  <div class="placeholder-card card">
    <div class="placeholder-icon">🛠️</div>
    <h2>{{ title }} 模組獨立開發中</h2>
    <p class="desc">
      此功能正進行獨立模組化抽離（Scoped CSS 與單一元件隔離）。
      您可以隨時切換至舊版界面使用完整功能，或在此測試新架構。
    </p>
    <div class="meta-box">
      <div><strong>路由名稱：</strong> {{ $route.name }}</div>
      <div><strong>模組路徑：</strong> {{ $route.path }}</div>
    </div>
    <div class="actions">
      <a href="/" class="btn outline">前往舊版完整系統</a>
      <router-link to="/dashboard" class="btn primary">返回新版總覽</router-link>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';

const route = useRoute();
const title = computed(() => route.meta?.title || '功能');
</script>

<style scoped>
.placeholder-card {
  max-width: 600px;
  margin: 40px auto;
  text-align: center;
  padding: 40px 30px;
}
.placeholder-icon {
  font-size: 3rem;
  margin-bottom: 12px;
}
h2 {
  font-size: 1.3rem;
  margin-bottom: 8px;
  color: var(--text-main);
}
.desc {
  color: var(--text-muted);
  font-size: 0.95rem;
  line-height: 1.6;
  margin-bottom: 24px;
}
.meta-box {
  background: #f1f5f9;
  border-radius: 6px;
  padding: 12px;
  font-size: 0.85rem;
  color: #475569;
  text-align: left;
  margin-bottom: 24px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.actions {
  display: flex;
  justify-content: center;
  gap: 12px;
}
</style>
