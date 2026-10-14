import { computed } from 'vue';
import { useAuthStore } from '@/stores/auth';

export function usePermissions() {
  const auth = useAuthStore();

  return {
    auth,
    user: computed(() => auth.user),
    isAdmin: computed(() => auth.isAdmin),
    isBuiltinAdmin: computed(() => auth.isBuiltinAdmin),
    isFinanceStaff: computed(() => auth.isFinanceStaff),
    hasPerm: (perm) => auth.hasPerm(perm),
  };
}
