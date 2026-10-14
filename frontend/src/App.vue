<template>
  <router-view />
  <AttachmentViewerModal />
  <OnlyOfficeModal />
  <ApprovalActionModal />
  <Toast />
</template>

<script setup>
import { useRouter } from 'vue-router';
import { bindRouter } from '@/lib/app-services';
import AttachmentViewerModal from '@/components/common/AttachmentViewerModal.vue';
import OnlyOfficeModal from '@/components/common/OnlyOfficeModal.vue';
import ApprovalActionModal from '@/components/common/ApprovalActionModal.vue';
import Toast from '@/components/common/Toast.vue';

bindRouter(useRouter());
</script>
