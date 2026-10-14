import { defineStore } from 'pinia';
import { fetchUsers } from '@/api/users';

export const useUsersStore = defineStore('users', {
  state: () => ({
    list: [],
    loaded: false,
    loading: false,
  }),

  getters: {
    active: (state) => state.list.filter((u) => u.active !== 0),
  },

  actions: {
    byId(id) {
      return this.list.find((u) => Number(u.id) === Number(id)) || null;
    },

    async fetch(force = false) {
      if (this.loaded && !force) return this.list;
      if (this.loading) return this.list;
      this.loading = true;
      try {
        const res = await fetchUsers();
        this.list = res.users || [];
        this.loaded = true;
        return this.list;
      } finally {
        this.loading = false;
      }
    },
  },
});
