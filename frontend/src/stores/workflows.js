import { defineStore } from 'pinia';
import { fetchWorkflows, fetchWorkflow } from '@/api/workflows';

export function parseJsonField(raw, fallback) {
  if (raw == null || raw === '') return fallback;
  if (Array.isArray(raw) || (typeof raw === 'object' && !Array.isArray(raw))) return raw;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

export function workflowFormFields(wf) {
  return parseJsonField(wf?.form_fields ?? wf?.formFields, []) || [];
}

export function workflowSteps(wf) {
  return parseJsonField(wf?.steps, []) || [];
}

export const useWorkflowsStore = defineStore('workflows', {
  state: () => ({
    list: [],
    loaded: false,
    loading: false,
  }),

  getters: {
    active: (state) => state.list.filter((w) => w.active !== 0),
  },

  actions: {
    byId(id) {
      return this.list.find((w) => Number(w.id) === Number(id)) || null;
    },

    async fetch(force = false, { all = false } = {}) {
      if (this.loaded && !force && !all) return this.list;
      this.loading = true;
      try {
        const res = await fetchWorkflows({ all });
        this.list = res.workflows || [];
        this.loaded = true;
        return this.list;
      } finally {
        this.loading = false;
      }
    },

    async fetchOne(id) {
      const cached = this.byId(id);
      if (cached && (cached.form_fields || cached.steps)) return cached;
      const res = await fetchWorkflow(id);
      const wf = res.workflow || res;
      if (wf?.id) {
        const idx = this.list.findIndex((w) => Number(w.id) === Number(wf.id));
        if (idx >= 0) this.list[idx] = { ...this.list[idx], ...wf };
        else this.list.push(wf);
      }
      return wf;
    },
  },
});
