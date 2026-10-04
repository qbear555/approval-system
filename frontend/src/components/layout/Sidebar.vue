<template>
  <aside class="sidebar">
    <div class="sidebar-brand">
      <img :src="systemStore.logoUrl" alt="Logo" class="brand-logo brand-logo-side" />
      <div class="sidebar-brand-text">
        <strong>線上簽核</strong>
        <span class="muted company-name-sm">{{ systemStore.companyName }}</span>
      </div>
    </div>

    <nav class="nav">
      <router-link to="/dashboard" class="nav-item" active-class="active">總覽</router-link>
      <router-link to="/inbox" class="nav-item" active-class="active">
        <span>待我簽核</span>
        <span v-if="systemStore.pendingCount > 0" class="badge">{{ systemStore.pendingCount }}</span>
      </router-link>
      <router-link to="/mine" class="nav-item" active-class="active">我的申請</router-link>
      <router-link to="/records" class="nav-item" active-class="active">簽核紀錄</router-link>
      <router-link to="/new-request" class="nav-item" active-class="active">新增申請</router-link>

      <router-link v-if="authStore.hasPerm('workflows')" to="/workflows" class="nav-item" active-class="active">簽核流程</router-link>
      <router-link v-if="authStore.hasPerm('backups')" to="/backups" class="nav-item" active-class="active">備份資料</router-link>
      <router-link v-if="authStore.hasPerm('leave_report')" to="/leave-report" class="nav-item" active-class="active">請假報表</router-link>
      <router-link v-if="authStore.isBuiltinAdmin" to="/audit-logs" class="nav-item" active-class="active">稽核日誌</router-link>
      <router-link v-if="authStore.hasPerm('users_leave')" to="/users" class="nav-item" active-class="active">成員名單</router-link>
      <router-link v-if="authStore.isAdmin" to="/departments" class="nav-item" active-class="active">部門</router-link>
      <router-link to="/settings" class="nav-item" active-class="active">帳號設定</router-link>
      <router-link v-if="authStore.isBuiltinAdmin" to="/line-settings" class="nav-item" active-class="active">LINE 通知</router-link>
      <router-link v-if="authStore.isBuiltinAdmin" to="/system-settings" class="nav-item" active-class="active">系統設定</router-link>
    </nav>

    <div class="sidebar-user">
      <div class="avatar">{{ userInitial }}</div>
      <div class="user-meta">
        <div id="user-name">{{ authStore.userName }}</div>
        <div class="muted" id="user-role">{{ roleText }}</div>
      </div>
      <button type="button" id="btn-logout" class="btn ghost sm" title="登出" @click="handleLogout">登出</button>
    </div>
    <div class="sidebar-version app-version" :title="systemStore.version">{{ systemStore.version }}</div>
  </aside>
</template>

<script setup>
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useSystemStore } from '@/stores/system';

const router = useRouter();
const authStore = useAuthStore();
const systemStore = useSystemStore();

const userInitial = computed(() => {
  const name = authStore.userName;
  return name ? name.charAt(0).toUpperCase() : 'U';
});

const roleText = computed(() => {
  if (authStore.isAdmin) return '管理員';
  return authStore.user?.department || authStore.user?.role || '一般同仁';
});

function handleLogout() {
  authStore.logout();
  router.push('/login');
}
</script>

<style scoped>
a.nav-item {
  text-decoration: none;
}
.nav-item.router-link-active {
  /* 沿用經典 .nav-item.active */
}
</style>
