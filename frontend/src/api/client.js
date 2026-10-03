/**
 * 統一 API 請求客戶端
 * - 自動注入 JWT Token
 * - 統一錯誤處理與 401 攔截
 */
export async function apiRequest(endpoint, options = {}) {
  const token = localStorage.getItem('approval_token');
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  // 若發送 FormData 則不設定 Content-Type，讓瀏覽器自動加上 boundary
  if (options.body instanceof FormData) {
    delete headers['Content-Type'];
  }

  const config = {
    ...options,
    headers,
  };

  try {
    const res = await fetch(endpoint, config);

    if (res.status === 401) {
      localStorage.removeItem('approval_token');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
      throw new Error('登入憑證已過期，請重新登入');
    }

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      const msg = data?.error || data?.message || `請求失敗 (HTTP ${res.status})`;
      throw new Error(msg);
    }

    return data;
  } catch (err) {
    console.error(`[API Error] ${endpoint}:`, err);
    throw err;
  }
}
