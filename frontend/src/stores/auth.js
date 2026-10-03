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
    userName: (state) => state.user?.name || state.user?.username || '',
  },

  actions: {
    async login(username, password) {
      this.loading = true;
      try {
        const res = await apiRequest('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ username, password }),
        });
        this.token = res.token;
        this.user = res.user;
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
      } catch (err) {
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
