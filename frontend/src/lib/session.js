import { stopPendingWatcher } from '@/lib/admin-runtime';

/** 登出處理：停止待簽輪詢、清除 Token，並導向登入頁。 */
export function clearGlobalSession() {
  try {
    stopPendingWatcher();
  } catch {
    /* ignore */
  }
  localStorage.removeItem('approval_token');
}

export function goToVueLogin(router) {
  const path = String(window.location.pathname || '');
  if (path === '/login') return;
  if (router) {
    router.replace('/login').catch(() => {
      window.location.assign('/login');
    });
    return;
  }
  window.location.assign('/login');
}

export function performVueLogout(authStore, router) {
  if (authStore && typeof authStore.logout === 'function') authStore.logout();
  else localStorage.removeItem('approval_token');
  clearGlobalSession();
  goToVueLogin(router);
}
