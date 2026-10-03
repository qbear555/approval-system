import { defineStore } from 'pinia';

export const useToastStore = defineStore('toast', {
  state: () => ({
    message: '',
    type: 'success', // 'success' | 'error' | 'info'
    visible: false,
    timer: null,
  }),

  actions: {
    show(message, type = 'success', duration = 3000) {
      if (this.timer) clearTimeout(this.timer);
      this.message = message;
      this.type = type;
      this.visible = true;

      this.timer = setTimeout(() => {
        this.visible = false;
      }, duration);
    },

    success(msg) {
      this.show(msg, 'success');
    },

    error(msg) {
      this.show(msg, 'error', 4500);
    },

    info(msg) {
      this.show(msg, 'info');
    },
  },
});
