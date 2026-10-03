<template>
  <aside class="sidebar">
    <div class="sidebar-brand">
      <img :src="systemStore.logoUrl" alt="Logo" class="brand-logo" />
      <div class="brand-text">
        <strong>線上簽核</strong>
        <span class="company-name">{{ systemStore.companyName }}</span>
      </div>
    </div>

    <nav class="nav">
      <router-link to="/dashboard" class="nav-item" active-class="active">
        總覽
      </router-link>
      <router-link to="/inbox" class="nav-item" active-class="active">
        待我簽核
        <span v-if="systemStore.pendingCount > 0" class="badge danger">{{ systemStore.pendingCount }}</span>
      </router-link>
      <router-link to="/mine" class="nav-item" active-class="active">
        我的申請
      </router-link>
      <router-link to="/records" class="nav-item" active-class="active">
        簽核紀錄
      </router-link>
      <router-link to="/new-request" class="nav-item" active-class="active">
        新增申請
      </router-link>

      <div class="nav-divider" v-if="authStore.hasPerm('workflows') || authStore.hasPerm('users_leave')"></div>

      <router-link v-if="authStore.hasPerm('workflows')" to="/workflows" class="nav-item" active-class="active">
        簽核流程
      </router-link>
      <router-link v-if="authStore.hasPerm('users_leave')" to="/users" class="nav-item" active-class="active">
        成員名單
      </router-link>
      <router-link v-if="authStore.isAdmin" to="/departments" class="nav-item" active-class="active">
        部門
      </router-link>
      <router-link v-if="authStore.hasPerm('backups')" to="/backups" class="nav-item" active-class="active">
        備份資料
      </router-link>
      <router-link v-if="authStore.isAdmin" to="/system-settings" class="nav-item" active-class="active">
        系統設定
      </router-link>
      <router-link v-if="authStore.isAdmin" to="/line-settings" class="nav-item" active-class="active">
        LINE 通知
      </router-link>
      <router-link to="/settings" class="nav-item" active-class="active">
        帳號設定
      </router-link>
    </nav>

    <div class="sidebar-footer">
      <div class="user-info">
        <div class="avatar">{{ userInitial }}</div>
        <div class="meta">
          <div class="name">{{ authStore.userName }}</div>
          <div class="role">{{ roleText }}</div>
        </div>
      </div>
      <button type="button" class="btn outline sm block logout-btn" @click="handleLogout">登出</button>
      <div class="version">{{ systemStore.version }}</div>
    </div>
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
  return authStore.user?.role || '一般同仁';
});

function handleLogout() {
  authStore.logout();
  router.push('/login');
}
</script>

<style scoped>
.sidebar {
  width: var(--sidebar-w);
  height: 100vh;
  position: fixed;
  left: 0;
  top: 0;
  background: #ffffff;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  z-index: 50;
}

.sidebar-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  border-bottom: 1px solid var(--border);
}

.brand-logo {
  height: 36px;
  max-width: 90px;
  object-fit: contain;
}

.brand-text strong {
  display: block;
  font-size: 1.05rem;
  color: var(--text-main);
}

.company-name {
  font-size: 0.75rem;
  color: var(--text-muted);
}

.nav {
  flex: 1;
  overflow-y: auto;
  padding: 12px 8px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  color: #475569;
  text-decoration: none;
  border-radius: 6px;
  font-size: 0.92rem;
  margin-bottom: 3px;
  transition: background 0.15s ease, color 0.15s ease;
}

.nav-item:hover {
  background: #f1f5f9;
  color: var(--primary);
}

.nav-item.active {
  background: var(--primary-light);
  color: var(--primary);
  font-weight: 600;
}

.nav-item .icon {
  font-size: 1.05rem;
}

.nav-item .badge {
  margin-left: auto;
}

.nav-divider {
  height: 1px;
  background: var(--border);
  margin: 8px 4px;
}

.sidebar-footer {
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  background: #fafafa;
}

.user-info {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.avatar {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: var(--primary);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 0.9rem;
}

.meta .name {
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--text-main);
}

.meta .role {
  font-size: 0.75rem;
  color: var(--text-muted);
}

.logout-btn {
  width: 100%;
  font-size: 0.82rem;
  padding: 5px;
}

.version {
  font-size: 0.7rem;
  color: #94a3b8;
  text-align: center;
  margin-top: 6px;
}
</style>
