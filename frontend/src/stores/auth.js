import { defineStore } from 'pinia';
import { apiRequest } from '@/api/client';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem('approval_token') || '',
    user: null,
    loading: false,
    initialized: false,
  }),

  getters: {
    isAuthenticated: (state) => !!state.token,
    isAdmin: (state) => state.user?.role === 'admin',
    isBuiltinAdmin: (state) => String(state.user?.username || '').trim().toLowerCase() === 'admin',
    userName: (state) => state.user?.name || state.user?.username || '',
    isFinanceStaff: (state) => {
      const u = state.user;
      if (!u) return false;
      if (u.department === '財務部') return true;
      if (Array.isArray(u.departments) && u.departments.includes('財務部')) return true;
      if (u.username === 'Gigi' || u.name === '張美雯') return true;
      if (u.username === 'Joan' || u.name === '詹慈敏') return true;
      if (u.role !== 'admin') {
        const perms = u.permissions || [];
        return perms.includes('finance_confirm');
      }
      return false;
    },
  },

  actions: {
    async login(username, password) {
      this.loading = true;
      try {
        const res = await apiRequest('/api/auth/login', {
          method: 'POST',
          body: { username, password },
        });
        this.token = res.token;
        this.user = res.user;
        this.initialized = true;
        localStorage.setItem('approval_token', res.token);
        return res;
      } finally {
        this.loading = false;
      }
    },

    async fetchMe() {
      if (!this.token) {
        this.initialized = true;
        return null;
      }
      try {
        const res = await apiRequest('/api/auth/me');
        this.user = res.user;
        return this.user;
      } catch {
        this.logout();
        return null;
      } finally {
        this.initialized = true;
      }
    },

    logout() {
      this.token = '';
      this.user = null;
      localStorage.removeItem('approval_token');
    },

    hasPerm(perm) {
      if (!this.user) return false;
      if (this.isAdmin) return true;
      const perms = this.user.permissions || [];
      return perms.includes(perm);
    },
  },
});
