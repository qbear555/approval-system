import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { minePageTitle } from '@/lib/status';

const AppLayout = () => import('@/components/layout/AppLayout.vue');
const LoginView = () => import('@/views/auth/LoginView.vue');
const DashboardView = () => import('@/views/dashboard/DashboardView.vue');
const RequestListView = () => import('@/views/requests/RequestListView.vue');
const RequestDetailView = () => import('@/views/requests/RequestDetailView.vue');
const NewRequestView = () => import('@/views/requests/NewRequestView.vue');
const WorkflowsView = () => import('@/views/workflows/WorkflowsView.vue');
const BackupsPage = () => import('@/views/system/BackupsPage.vue');
const LeaveReportPage = () => import('@/views/reports/LeaveReportPage.vue');
const AuditLogsPage = () => import('@/views/system/AuditLogsPage.vue');
const UsersPage = () => import('@/views/organization/UsersPage.vue');
const DepartmentsPage = () => import('@/views/organization/DepartmentsPage.vue');
const SettingsPage = () => import('@/views/user/SettingsPage.vue');
const LineSettingsView = () => import('@/views/system/LineSettingsView.vue');
const SystemSettingsPage = () => import('@/views/system/SystemSettingsPage.vue');
const NotFoundView = () => import('@/views/NotFoundView.vue');

const router = createRouter({
  history: createWebHistory('/'),
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
        {
          path: 'detail/:id',
          name: 'Detail',
          component: RequestDetailView,
          meta: { title: '簽核詳情' },
        },
        {
          path: 'new-request',
          name: 'NewRequest',
          component: NewRequestView,
          meta: { title: '新增申請' },
        },
        {
          path: 'workflows',
          name: 'Workflows',
          component: WorkflowsView,
          meta: { title: '簽核流程' },
        },
        {
          path: 'backups',
          name: 'Backups',
          component: BackupsPage,
          meta: { title: '備份資料' },
        },
        {
          path: 'leave-report',
          name: 'LeaveReport',
          component: LeaveReportPage,
          meta: { title: '請假報表' },
        },
        {
          path: 'audit-logs',
          name: 'AuditLogs',
          component: AuditLogsPage,
          meta: { title: '稽核日誌' },
        },
        {
          path: 'users',
          name: 'Users',
          component: UsersPage,
          meta: { title: '成員名單' },
        },
        {
          path: 'departments',
          name: 'Departments',
          component: DepartmentsPage,
          meta: { title: '部門' },
        },
        {
          path: 'settings',
          name: 'Settings',
          component: SettingsPage,
          meta: { title: '帳號設定' },
        },
        {
          path: 'line-settings',
          name: 'LineSettings',
          component: LineSettingsView,
          meta: { title: 'LINE 通知' },
        },
        {
          path: 'system-settings',
          name: 'SystemSettings',
          component: SystemSettingsPage,
          meta: { title: '系統設定' },
        },
        {
          path: ':pathMatch(.*)*',
          name: 'NotFound',
          component: NotFoundView,
          meta: { title: '找不到頁面' },
        },
      ],
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
