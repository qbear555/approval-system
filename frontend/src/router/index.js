import { createRouter, createWebHistory } from 'vue-router';
import LegacyHost from '@/views/legacy/LegacyHost.vue';

/**
 * v2 所有功能（總覽、簽核、流程設計、成員、部門、備份、稽核、LINE、系統設定…）
 * 皆由 LegacyHost 載入經典模組化前端；頁面切換沿用經典 hash 路由（#/inbox 等）。
 */
const router = createRouter({
  history: createWebHistory('/v2/'),
  routes: [{ path: '/:pathMatch(.*)*', name: 'App', component: LegacyHost }],
});

export default router;
