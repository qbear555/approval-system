import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { minePageTitle } from '@/lib/status';

const AppLayout = () => import('@/components/layout/AppLayout.vue');
const LoginView = () => import('@/views/auth/LoginView.vue');
const DashboardView = () => import('@/views/dashboard/DashboardView.vue');
const RequestListView = () => import('@/views/requests/RequestListView.vue');
const LegacyHost = () => import('@/views/legacy/LegacyHost.vue');

const router = createRouter({
  history: createWebHistory('/v2/'),
  routes: [
    {
      path: '/login',
      name: 'Login',
      component: LoginView,
      meta: { public: true, title: '登入' },
    },
    {
      path: '/',
      component: AppLayout,
      meta: { requiresAuth: true },
      children: [
        { path: '', redirect: '/dashboard' },
        {
          path: 'dashboard',
          name: 'Dashboard',
          component: DashboardView,
          meta: { title: '總覽' },
        },
        {
          path: 'inbox',
          name: 'Inbox',
          component: RequestListView,
          meta: { title: '待我簽核', listType: 'inbox' },
        },
        {
          path: 'mine',
          name: 'Mine',
          component: RequestListView,
          meta: { title: '我的申請', listType: 'mine' },
        },
        {
          path: 'records',
          name: 'Records',
          component: RequestListView,
          meta: { title: '簽核紀錄', listType: 'records' },
        },
      ],
    },
    {
      path: '/detail/:id',
      name: 'Detail',
      component: LegacyHost,
      meta: { requiresAuth: true, title: '簽核詳情', legacyPage: 'detail' },
    },
    {
      path: '/new-request',
      name: 'NewRequest',
      component: LegacyHost,
      meta: { requiresAuth: true, title: '新增申請', legacyPage: 'new-request' },
    },
    {
      path: '/workflows',
      name: 'Workflows',
      component: LegacyHost,
      meta: { requiresAuth: true, title: '簽核流程', legacyPage: 'workflows' },
    },
    {
      path: '/backups',
      name: 'Backups',
      component: LegacyHost,
      meta: { requiresAuth: true, title: '備份資料', legacyPage: 'backups' },
    },
    {
      path: '/leave-report',
      name: 'LeaveReport',
      component: LegacyHost,
      meta: { requiresAuth: true, title: '請假報表', legacyPage: 'leave-report' },
    },
    {
      path: '/audit-logs',
      name: 'AuditLogs',
      component: LegacyHost,
      meta: { requiresAuth: true, title: '稽核日誌', legacyPage: 'audit-logs' },
    },
    {
      path: '/users',
      name: 'Users',
      component: LegacyHost,
      meta: { requiresAuth: true, title: '成員名單', legacyPage: 'users' },
    },
    {
      path: '/departments',
      name: 'Departments',
      component: LegacyHost,
      meta: { requiresAuth: true, title: '部門', legacyPage: 'departments' },
    },
    {
      path: '/settings',
      name: 'Settings',
      component: LegacyHost,
      meta: { requiresAuth: true, title: '帳號設定', legacyPage: 'settings' },
    },
    {
      path: '/line-settings',
      name: 'LineSettings',
      component: LegacyHost,
      meta: { requiresAuth: true, title: 'LINE 通知', legacyPage: 'line-settings' },
    },
    {
      path: '/system-settings',
      name: 'SystemSettings',
      component: LegacyHost,
      meta: { requiresAuth: true, title: '系統設定', legacyPage: 'system-settings' },
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'Legacy',
      component: LegacyHost,
      meta: { requiresAuth: true, title: '線上簽核' },
    },
  ],
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();

  if (to.meta.public) {
    if (auth.token) {
      if (!auth.initialized) await auth.fetchMe();
      if (auth.user) return { path: '/dashboard' };
    }
    return true;
  }

  if (!auth.token) {
    return { path: '/login', query: { redirect: to.fullPath } };
  }

  if (!auth.initialized) await auth.fetchMe();
  if (!auth.user) {
    return { path: '/login', query: { redirect: to.fullPath } };
  }

  return true;
});

router.afterEach((to) => {
  let title = to.meta?.title || '線上簽核';
  if (to.name === 'Mine') title = minePageTitle(to.query.status);
  document.title = `${title} · 線上簽核`;
});

export default router;
