/**
 * 統一 API 請求客戶端
 * - 自動注入 JWT Token
 * - 統一錯誤處理與 401 攔截
 */
const LOGIN_PATH = '/login';

export async function apiRequest(endpoint, options = {}) {
  const token = localStorage.getItem('approval_token');
  const headers = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  const { expectBlob, ...rest } = options;
  let body = rest.body;
  if (body instanceof FormData) {
    delete headers['Content-Type'];
  } else if (body != null && typeof body === 'object' && !(body instanceof Blob)) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    body = JSON.stringify(body);
  } else if (typeof body === 'string' && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const config = {
    ...rest,
    headers,
    body,
  };

  try {
    const res = await fetch(endpoint, config);

    if (res.status === 401) {
      localStorage.removeItem('approval_token');
      const path = window.location.pathname || '';
      if (!path.startsWith(LOGIN_PATH) && path !== '/login') {
        window.location.href = LOGIN_PATH;
      }
      throw new Error('登入憑證已過期，請重新登入');
    }

    if (expectBlob) {
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || data?.message || `請求失敗 (HTTP ${res.status})`);
      }
      return res.blob();
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
