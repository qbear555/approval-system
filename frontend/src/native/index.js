/**
 * 已改寫為 Vue 的頁面清單。
 * key = 經典路由 page 名稱；沒登記的頁面仍由經典 pages-*.js 渲染。
 * 要把頁面退回經典版，只要刪掉對應一行即可。
 */
import { mountNative, unmountNativePage } from './bridge';
import LeaveReportPage from './pages/LeaveReportPage.vue';
import AuditLogsPage from './pages/AuditLogsPage.vue';
import DepartmentsPage from './pages/DepartmentsPage.vue';
import SettingsPage from './pages/SettingsPage.vue';
import BackupsPage from './pages/BackupsPage.vue';
import UsersPage from './pages/UsersPage.vue';
import SystemSettingsPage from './pages/SystemSettingsPage.vue';
import DashboardPage from './pages/DashboardPage.vue';
import RequestListPage from './pages/RequestListPage.vue';
import NewRequestPage from './pages/NewRequestPage.vue';
import WorkflowsPage from './pages/WorkflowsPage.vue';
import RequestDetailPage from './pages/RequestDetailPage.vue';

export function registerNativePages() {
  window.__unmountNativePage = unmountNativePage;
  window.__nativePages = {
    'leave-report': mountNative(LeaveReportPage),
    'audit-logs': mountNative(AuditLogsPage),
    'departments': mountNative(DepartmentsPage),
    'settings': mountNative(SettingsPage),
    'backups': mountNative(BackupsPage),
    'users': mountNative(UsersPage),
    'system-settings': mountNative(SystemSettingsPage),
    'dashboard': mountNative(DashboardPage),
    'inbox': mountNative(RequestListPage),
    'mine': mountNative(RequestListPage),
    'records': mountNative(RequestListPage),
    'new-request': mountNative(NewRequestPage),
    'workflows': mountNative(WorkflowsPage),
    'detail': mountNative(RequestDetailPage),
  };
}
