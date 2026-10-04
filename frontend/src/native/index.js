/**
 * 已改寫為 Vue 的頁面清單（供 LegacyHost 內的經典 navigate 使用）。
 * 總覽／待我簽核／我的申請／簽核紀錄已改為獨立 Vue 路由，不再由此掛載。
 */
import { mountNative, unmountNativePage } from './bridge';
import LeaveReportPage from './pages/LeaveReportPage.vue';
import AuditLogsPage from './pages/AuditLogsPage.vue';
import DepartmentsPage from './pages/DepartmentsPage.vue';
import SettingsPage from './pages/SettingsPage.vue';
import BackupsPage from './pages/BackupsPage.vue';
import UsersPage from './pages/UsersPage.vue';
import SystemSettingsPage from './pages/SystemSettingsPage.vue';
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
    'new-request': mountNative(NewRequestPage),
    'workflows': mountNative(WorkflowsPage),
    'detail': mountNative(RequestDetailPage),
  };
}
