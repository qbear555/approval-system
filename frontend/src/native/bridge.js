/**
 * 經典前端 ↔ Vue 頁面橋接。
 * - 經典 app.js 以全域 function/const 提供 api、toast、state…；Vue 模組透過這裡取用。
 * - 已改寫為 Vue 的頁面註冊在 window.__nativePages，由經典 navigate() 呼叫掛載。
 */
import { createApp, h, Suspense } from 'vue';

export const L = new Proxy(
  {
    get state() {
      return window.appState || window.state;
    },
  },
  {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'state') return window.appState || window.state;
      return window[prop];
    },
  }
);

let current = null;

export function unmountNativePage() {
  if (current) {
    try {
      current.unmount();
    } catch (e) {
      console.error('[native] unmount', e);
    }
    current = null;
  }
}

/** 產生給 window.__nativePages 用的掛載函式 */
export function mountNative(Component) {
  return async (body, params = {}, page = '') => {
    unmountNativePage();
    body.innerHTML = '';
    const app = createApp({
      render: () =>
        h(Suspense, null, {
          default: () => h(Component, { params, page }),
          fallback: () => h('div', { class: 'muted' }, '載入中…'),
        }),
    });
    app.config.errorHandler = (err) => {
      console.error('[native page]', err);
      body.innerHTML = `<div class="error-msg">${L.esc(err?.message || String(err))}</div>`;
    };
    app.mount(body);
    current = app;
  };
}
