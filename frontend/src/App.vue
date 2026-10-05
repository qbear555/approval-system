<template>
  <router-view />
  <AttachmentViewerModal />
  <Toast />
</template>

<script setup>
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import { performVueLogout } from '@/lib/session';
import AttachmentViewerModal from '@/components/common/AttachmentViewerModal.vue';
import Toast from '@/components/common/Toast.vue';

const router = useRouter();
const authStore = useAuthStore();
const toastStore = useToastStore();

window.__v2GoLogin = () => {
  performVueLogout(authStore, router);
};

window.__v2Toast = (msg, type = 'info') => {
  if (type === 'success') toastStore.success(msg);
  else if (type === 'error') toastStore.error(msg);
  else toastStore.info(msg);
};

window.__v2Navigate = (page, params = {}) => {
  let dest = '/dashboard';
  if (page === 'dashboard') dest = '/dashboard';
  else if (page === 'inbox') dest = '/inbox';
  else if (page === 'mine') dest = params.status ? { path: '/mine', query: { status: params.status } } : '/mine';
  else if (page === 'records') dest = '/records';
  else if (page === 'detail' && params.id) dest = `/detail/${params.id}`;
  else if (page === 'new-request') {
    const query = {};
    if (params.workflowId) query.workflowId = String(params.workflowId);
    if (params.cloneFrom) query.cloneFrom = String(params.cloneFrom);
    if (params.draftId) query.draftId = String(params.draftId);
    dest = Object.keys(query).length ? { path: '/new-request', query } : '/new-request';
  } else if (page) dest = `/${page}`;
  router.push(dest).catch(() => {});
  return true;
};
</script>
