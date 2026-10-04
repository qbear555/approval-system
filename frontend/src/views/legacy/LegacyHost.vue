<template>
  <!--
    尚未改寫為 Vue 的功能（詳情、新增申請、流程、設定…）仍由經典 pages-*.js 承載。
    總覽／待我簽核／我的申請／簽核紀錄已改走獨立 Vue 路由。
  -->
  <div v-once id="legacy-root">
    <div id="auth-view" class="auth-wrap hidden">
      <div class="auth-card">
        <div class="auth-brand">
          <img class="brand-logo brand-logo-auth" :src="LOGO" alt="ARGO" width="1048" height="289" decoding="async" />
          <div class="company-name">線上簽核系統</div>
          <h1>線上簽核</h1>
          <p>自訂流程 · 紀錄留存 · PDF 匯出</p>
        </div>
        <div class="muted" style="text-align:center;padding:12px">載入中…</div>
      </div>
    </div>

    <div id="main-view" class="main-layout">
      <aside class="sidebar">
        <div class="sidebar-brand">
          <img class="brand-logo brand-logo-side" :src="LOGO" alt="ARGO" width="1048" height="289" decoding="async" />
          <div class="sidebar-brand-text">
            <strong>線上簽核</strong>
            <span class="muted company-name-sm">{{ companyName }}</span>
          </div>
        </div>
        <nav class="nav" @click="handleNavClick">
          <button type="button" class="nav-item" data-page="dashboard">總覽</button>
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
          <div class="avatar" id="user-avatar">{{ userInitial }}</div>
          <div class="user-meta">
            <div id="user-name">{{ userName }}</div>
            <div class="muted" id="user-role">{{ userRole }}</div>
          </div>
          <button type="button" id="btn-logout" class="btn ghost sm" title="登出" @click="handleLogout">登出</button>
        </div>
        <div class="sidebar-version app-version" id="sidebar-version" :title="appVersion">{{ appVersion }}</div>
      </aside>

      <main class="content">
        <header class="page-header">
          <h2 id="page-title">載入中</h2>
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
import { computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { registerNativePages } from '@/native';
import { useAuthStore } from '@/stores/auth';
import { useSystemStore } from '@/stores/system';

const V = '20261004_v2fix';
const LOGO = '/img/argo-logo.png';
const VUE_PAGES = new Set(['dashboard', 'inbox', 'mine', 'records']);

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

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const systemStore = useSystemStore();

const companyName = computed(() => systemStore.companyName || '線上簽核系統');
const appVersion = computed(() => systemStore.version || '線上簽核');
const userName = computed(() => authStore.userName || '—');
const userInitial = computed(() => {
  const n = authStore.userName;
  return n ? n.charAt(0).toUpperCase() : 'U';
});
const userRole = computed(() => {
  if (authStore.isAdmin) return '系統管理員';
  return authStore.user?.department || '一般使用者';
});

function handleLogout() {
  if (typeof window.logout === 'function') {
    window.logout();
  } else {
    authStore.logout();
    router.push('/login');
  }
}

function handleNavClick(e) {
  const btn = e.target.closest('.nav-item');
  if (!btn || !btn.dataset.page) return;
  e.preventDefault();
  const page = btn.dataset.page;
  if (typeof window.navigate === 'function') {
    window.navigate(page);
  }
}

function pathSegments() {
  const raw = route.params.pathMatch;
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (typeof raw === 'string' && raw) return raw.split('/').filter(Boolean);
  return [];
}

function legacyTarget() {
  if (route.meta?.legacyPage) {
    const page = route.meta.legacyPage;
    const params = { ...route.query };
    if (page === 'detail' && route.params.id) params.id = Number(route.params.id);
    if (route.query.workflowId) params.workflowId = Number(route.query.workflowId);
    if (route.query.cloneFrom) params.cloneFrom = Number(route.query.cloneFrom);
    return { page, params };
  }
  const segs = pathSegments();
  const page = segs[0] || 'dashboard';
  const params = { ...route.query };
  if (page === 'detail' && segs[1]) params.id = Number(segs[1]);
  if (route.query.workflowId) params.workflowId = Number(route.query.workflowId);
  if (route.query.cloneFrom) params.cloneFrom = Number(route.query.cloneFrom);
  return { page, params };
}

function desiredHash(target) {
  if (target.page === 'detail' && target.params.id) return `#detail?id=${target.params.id}`;
  const q = new URLSearchParams();
  Object.entries(target.params || {}).forEach(([k, v]) => {
    if (v != null && v !== '' && k !== 'id') q.set(k, String(v));
  });
  const qs = q.toString();
  return qs ? `#${target.page}?${qs}` : `#${target.page}`;
}

function vuePathFor(page, params = {}) {
  if (page === 'dashboard') return '/dashboard';
  if (page === 'inbox') return '/inbox';
  if (page === 'mine') {
    return params.status ? { path: '/mine', query: { status: params.status } } : '/mine';
  }
  if (page === 'records') return '/records';
  if (page === 'detail' && params.id) return `/detail/${params.id}`;
  if (page === 'new-request') {
    const query = {};
    if (params.workflowId) query.workflowId = String(params.workflowId);
    if (params.cloneFrom) query.cloneFrom = String(params.cloneFrom);
    return Object.keys(query).length ? { path: '/new-request', query } : '/new-request';
  }
  return `/${page}`;
}

function patchNavigate() {
  if (window.__navigatePatched) return;
  const orig = window.__origNavigate || window.navigate;
  window.__origNavigate = orig;
  window.__navigatePatched = true;

  window.navigate = (page, params = {}, navOpts = {}) => {
    // 1. Vue 3 獨立頁面直接切換路由
    if (VUE_PAGES.has(page)) {
      router.push(vuePathFor(page, params));
      return;
    }

    // 2. LegacyHost 承載頁面
    const nextPath = vuePathFor(page, params);
    const targetUrl = typeof nextPath === 'string' ? nextPath : nextPath.path;
    const currentUrl = route.path;

    // 若已經在目標路徑上，或是由 showLegacyPage() 內部呼叫（skipHashSync / fromHost），直接執行原生的 render 函式
    if (navOpts.skipHashSync || navOpts.fromHost || currentUrl === targetUrl) {
      if (typeof orig === 'function') {
        return orig(page, params, navOpts);
      }
    } else {
      router.push(nextPath);
    }
  };
}

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

async function showLegacyPage() {
  const target = legacyTarget();
  const hash = desiredHash(target);
  if (`#${String(location.hash || '').replace(/^#/, '')}` !== hash) {
    try {
      history.replaceState(null, '', `${location.pathname}${location.search}${hash}`);
    } catch {
      location.hash = hash;
    }
  }
  const renderFn = window.__origNavigate || window.navigate;
  if (typeof renderFn === 'function') {
    renderFn(target.page, target.params, { skipHashSync: true, fromHost: true });
  }
}

onMounted(async () => {
  const target = legacyTarget();
  const hash = desiredHash(target);
  if (`#${String(location.hash || '').replace(/^#/, '')}` !== hash) {
    try {
      history.replaceState(null, '', `${location.pathname}${location.search}${hash}`);
    } catch {
      location.hash = hash;
    }
  }

  if (window.__legacyLoaded) {
    patchNavigate();
    window.boot?.();
    if (typeof window.applyRoleUi === 'function') window.applyRoleUi();
    showLegacyPage();
    return;
  }

  registerNativePages();
  window.__legacyManualBoot = true;
  try {
    for (const src of SCRIPTS) await loadScript(src);
    window.__legacyLoaded = true;
    patchNavigate();
    window.boot?.();
    if (typeof window.applyRoleUi === 'function') window.applyRoleUi();
    showLegacyPage();
  } catch (e) {
    console.error('[legacy-host]', e);
    const body = document.getElementById('page-body');
    if (body) body.innerHTML = `<div class="error-msg">${e.message}</div>`;
  }
});

onBeforeUnmount(() => {
  if (typeof window.__unmountNativePage === 'function') {
    window.__unmountNativePage();
  }
});

watch(
  () => route.fullPath,
  () => {
    if (window.__legacyLoaded) showLegacyPage();
  }
);
</script>
