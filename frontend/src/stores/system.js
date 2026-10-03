import { defineStore } from 'pinia';
import { apiRequest } from '@/api/client';

export const useSystemStore = defineStore('system', {
  state: () => ({
    companyName: '線上簽核系統',
    logoUrl: '/img/argo-logo.png',
    version: 'v1.1.0',
    pendingCount: 0,
    stats: null,
  }),

  actions: {
    async fetchPublicSettings() {
      try {
        const res = await apiRequest('/api/system/settings');
        if (res) {
          if (res.companyName) this.companyName = res.companyName;
          if (res.logoUrl) this.logoUrl = res.logoUrl;
          if (res.versionLabel) this.version = res.versionLabel;
        }
      } catch (err) {
        // Fallback default
      }
    },

    async fetchStats() {
      try {
        const res = await apiRequest('/api/stats');
        this.stats = res.stats || {};
        this.pendingCount = this.stats.pendingApproval || 0;
      } catch (err) {
        console.warn('載入統計數據失敗', err);
      }
    },
  },
});
