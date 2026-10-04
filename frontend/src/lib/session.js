/** Vue /v2 登出：清 token 並回到真正的登入頁，不走經典 auth-view stub。 */

export function clearClassicSession() {
  try {
    if (typeof window.stopPendingWatcher === 'function') window.stopPendingWatcher();
  } catch {
    /* ignore */
  }
  try {
    if (window.appState) {
      window.appState.token = '';
      window.appState.user = null;
    }
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
  clearClassicSession();
  goToVueLogin(router);
}
