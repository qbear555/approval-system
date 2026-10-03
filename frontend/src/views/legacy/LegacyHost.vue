<template>
  <!--
    v2 功能宿主：在 Vue 外殼內載入經典模組化前端（public/js/pages-*.js）。
    外觀與功能 100% 等同經典介面；每個功能仍是獨立的 pages-*.js 檔案。
  -->
  <div v-once id="legacy-root">
    <div id="auth-view" class="auth-wrap">
      <div class="auth-card">
        <div class="auth-brand">
          <img class="brand-logo brand-logo-auth" :src="LOGO" alt="ARGO" width="1048" height="289" decoding="async" />
          <div class="company-name">線上簽核系統</div>
          <h1>線上簽核</h1>
          <p>自訂流程 · 紀錄留存 · PDF 匯出</p>
          <div class="app-version" id="auth-version" title="系統版本">v—</div>
        </div>
        <form id="login-form" class="auth-form">
          <label>帳號<input name="username" autocomplete="username" required placeholder="請輸入帳號" value="" /></label>
          <label>密碼<input name="password" type="password" autocomplete="current-password" required placeholder="請輸入密碼" value="" /></label>
          <button type="submit" class="btn primary block">登入</button>
        </form>
        <div id="auth-error" class="error-msg hidden"></div>
        <div class="auth-version-foot muted app-version" id="auth-version-foot">線上簽核系統</div>
      </div>
    </div>

    <div id="main-view" class="main-layout hidden">
      <aside class="sidebar">
        <div class="sidebar-brand">
          <img class="brand-logo brand-logo-side" :src="LOGO" alt="ARGO" width="1048" height="289" decoding="async" />
          <div class="sidebar-brand-text">
            <strong>線上簽核</strong>
            <span class="muted company-name-sm">線上簽核系統</span>
          </div>
        </div>
        <nav class="nav">
          <button type="button" class="nav-item active" data-page="dashboard">總覽</button>
          <button type="button" class="nav-item" data-page="inbox">待我簽核 <span id="badge-pending" class="badge hidden">0</span></button>
          <button type="button" class="nav-item" data-page="mine">我的申請</button>
          <button type="button" class="nav-item" data-page="records">簽核紀錄</button>
          <button type="button" class="nav-item" data-page="new-request">新增申請</button>
          <button type="button" class="nav-item perm-nav hidden" data-perm="workflows" data-page="workflows">簽核流程</button>
          <button type="button" class="nav-item perm-nav hidden" data-perm="backups" data-page="backups">備份資料</button>
          <button type="button" class="nav-item perm-nav hidden" data-perm="leave_report" data-page="leave-report">請假報表</button>
          <button type="button" class="nav-item perm-nav hidden" data-perm="audit_logs" data-page="audit-logs">稽核日誌</button>
          <button type="button" class="nav-item perm-nav hidden" data-perm="users_leave" data-page="users">成員名單</button>
          <button type="button" class="nav-item admin-only hidden" data-page="departments">部門</button>
          <button type="button" class="nav-item" data-page="settings">帳號設定</button>
          <button type="button" class="nav-item hidden" id="nav-line-settings" data-page="line-settings">LINE 通知</button>
          <button type="button" class="nav-item hidden" data-page="system-settings">系統設定</button>
        </nav>
        <div class="sidebar-user">
          <div class="avatar" id="user-avatar">U</div>
          <div class="user-meta">
            <div id="user-name">—</div>
            <div class="muted" id="user-role">—</div>
          </div>
          <button type="button" id="btn-logout" class="btn ghost sm" title="登出">登出</button>
        </div>
        <div class="sidebar-version app-version" id="sidebar-version" title="系統版本">v—</div>
      </aside>

      <main class="content">
        <header class="page-header">
          <h2 id="page-title">總覽</h2>
          <div id="page-actions"></div>
        </header>
        <div id="page-body" class="page-body"></div>
      </main>
    </div>

    <div id="modal" class="modal hidden">
      <div class="modal-backdrop" data-close-modal></div>
      <div class="modal-panel" id="modal-panel"></div>
    </div>

    <div id="toast" class="toast hidden"></div>
  </div>
</template>

<script setup>
import { onMounted, onBeforeUnmount } from 'vue';
import { registerNativePages } from '@/native';

const V = '20261003_v2';
const LOGO = '/img/argo-logo.png'; // 以變數引用，避免 Vite 打包時解析

/** 與 public/index.html 相同的載入順序（app.js 為核心，pages-* 為各功能獨立檔案） */
const SCRIPTS = [
  '/vendor/pdfjs/pdf.min.js',
  '/js/tw-calendar.js',
  '/js/rich-editor.js',
  '/js/ui-helpers.js',
  '/js/pdf-form-designer.js',
  '/js/flow-editor.js',
  '/js/app.js',
  '/js/pages-dashboard.js',
  '/js/pages-request-fields.js',
  '/js/pages-request-table.js',
  '/js/pages-request-view.js',
  '/js/pages-request-list.js',
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

let styleEl = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `${src}?v=${V}`;
    s.async = false;
    s.dataset.legacy = '1';
    s.onload = resolve;
    s.onerror = () => reject(new Error(`載入失敗：${src}`));
    document.body.appendChild(s);
  });
}

onMounted(async () => {
  styleEl = document.createElement('link');
  styleEl.rel = 'stylesheet';
  styleEl.href = `/css/style.css?v=${V}`;
  document.head.appendChild(styleEl);

  // 經典腳本為全域 const/function，只能載入一次
  if (window.__legacyLoaded) {
    window.boot?.();
    return;
  }
  registerNativePages(); // 已改寫成 Vue 的頁面（navigate 時優先使用）
  window.__legacyManualBoot = true; // 由宿主在所有腳本載入後才呼叫 boot()
  try {
    for (const src of SCRIPTS) await loadScript(src);
    window.__legacyLoaded = true;
    window.boot?.();
  } catch (e) {
    console.error('[legacy-host]', e);
    const el = document.getElementById('auth-error');
    if (el) {
      el.textContent = e.message;
      el.classList.remove('hidden');
    }
  }
});

onBeforeUnmount(() => {
  styleEl?.remove();
});
</script>


