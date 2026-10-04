import { registerNativePages } from '@/native';

export const CORE_SCRIPTS_VERSION = '20261005_v3_core';

export const CORE_SCRIPTS = [
  '/vendor/pdfjs/pdf.min.js',
  '/js/tw-calendar.js',
  '/js/rich-editor.js',
  '/js/ui-helpers.js',
  '/js/app.js',
  '/js/shared-helpers.js',
  '/js/pdf-form-designer.js',
  '/js/flow-editor.js',
  '/js/pages-request-fields.js',
  '/js/pages-request-table.js',
  '/js/pages-request-view.js',
  '/js/pages-request-new.js',
  '/js/pages-request-detail.js',
  '/js/pages-workflows.js',
  '/js/pages-backups.js',
  '/js/pages-leave-report.js',
  '/js/pages-users.js',
  '/js/pages-departments.js',
  '/js/pages-audit.js',
  '/js/pages-settings.js',
  '/js/pages-line.js',
  '/js/pages-system.js',
];

export function loadCoreScript(src) {
  return new Promise((resolve, reject) => {
    const wanted = `${src}?v=${CORE_SCRIPTS_VERSION}`;
    const existing =
      document.querySelector(`script[data-core-src="${src}"]`) ||
      document.querySelector(`script[src^="${src}"]`);
    if (existing) {
      const cur = existing.getAttribute('src') || '';
      if (cur.includes(`v=${CORE_SCRIPTS_VERSION}`)) return resolve();
      existing.remove();
    }
    const s = document.createElement('script');
    s.src = wanted;
    s.async = false;
    s.dataset.host = '1';
    s.dataset.coreSrc = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`載入失敗：${src}`));
    document.body.appendChild(s);
  });
}

let loadPromise = null;

export async function ensureCoreScriptsLoaded(authStore) {
  if (window.__hostLoaded || window.__legacyLoaded) {
    if (authStore && window.appState) {
      window.appState.token = authStore.token;
      window.appState.user = authStore.user;
    }
    return true;
  }
  if (!loadPromise) {
    loadPromise = (async () => {
      registerNativePages();
      window.__hostManualBoot = true;
      window.__legacyManualBoot = true;
      for (const src of CORE_SCRIPTS) {
        await loadCoreScript(src);
      }
      window.__hostLoaded = true;
      return true;
    })();
  }
  await loadPromise;
  if (authStore && window.appState) {
    window.appState.token = authStore.token;
    window.appState.user = authStore.user;
  }
  return true;
}
