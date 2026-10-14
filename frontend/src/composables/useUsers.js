import { onMounted } from 'vue';
import { useUsersStore } from '@/stores/users';

export function useUsers({ immediate = true } = {}) {
  const store = useUsersStore();
  if (immediate) {
    onMounted(() => {
      store.fetch();
    });
  }
  return store;
}
