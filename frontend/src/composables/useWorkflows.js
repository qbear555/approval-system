import { onMounted } from 'vue';
import { useWorkflowsStore } from '@/stores/workflows';

export function useWorkflows({ immediate = true, all = false } = {}) {
  const store = useWorkflowsStore();
  if (immediate) {
    onMounted(() => {
      store.fetch(false, { all });
    });
  }
  return store;
}
