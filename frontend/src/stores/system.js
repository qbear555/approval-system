import { defineStore } from 'pinia';
import { apiRequest } from '@/api/client';

export const useSystemStore = defineStore('system', {
  state: () => ({
    companyName: '線上簽核系統',
    logoUrl: '/img/argo-logo.png',
    version: 'v1.2.0',
    pendingCount: 0,
    stats: null,
  }),

  actions: {
    async fetchPublicSettings() {
      try {
        let res = null;
        try {
          res = await apiRequest('/api/system/settings');
        } catch {
          res = await apiRequest('/api/system/branding');
        }
        if (res) {
          if (res.companyName) this.companyName = res.companyName;
          if (res.logoUrl) this.logoUrl = res.logoUrl;
          if (res.versionLabel) this.version = res.versionLabel;
          else if (res.fullVersion) this.version = res.fullVersion;
          else if (res.version) this.version = `v${res.version}`;
          this.applyBranding(res);
        } else {
          this.applyBranding();
        }
      } catch {
        this.applyBranding();
      }
    },

    applyBranding(settings = {}) {
      if (settings.companyName) this.companyName = settings.companyName;
      if (settings.logoUrl) this.logoUrl = settings.logoUrl;
      const href = this.logoUrl || '/img/argo-logo.png';
      ['app-favicon', 'app-favicon-shortcut', 'app-favicon-apple'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) {
          el.href = href;
          el.type = 'image/png';
        }
      });
    },

    async fetchStats() {
      try {
        const res = await apiRequest('/api/stats');
        this.stats = res.stats || {};
        this.pendingCount = Number(this.stats.pendingMe || 0);
      } catch (err) {
        console.warn('載入統計數據失敗', err);
      }
    },
  },
});
