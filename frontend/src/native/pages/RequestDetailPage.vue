<template>
  <div v-if="loading" class="muted">載入中…</div>
  <div v-else-if="error" class="error-msg">{{ error }}</div>
  <div v-else class="detail-main" v-html="mainHtml"></div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick, watch } from 'vue';
import { L } from '@/native/bridge';

const props = defineProps({
  params: { type: Object, default: () => ({}) },
  page: { type: String, default: 'detail' },
});

const reqId = props.params?.id || (L.state?.pageParams && L.state.pageParams.id);
const loading = ref(true);
const error = ref('');
const mainHtml = ref('');
let detailData = null;

async function loadData() {
  if (!reqId) {
    error.value = '未指定申請單編號';
    loading.value = false;
    return;
  }
  try {
    detailData = await L.fetchRequestDetailData(reqId);
    mainHtml.value = L.buildRequestDetailMainHtml(detailData);
    loading.value = false;
  } catch (e) {
    error.value = e.message || '載入失敗';
    loading.value = false;
  }
}

async function bindAll() {
  if (!detailData) return;
  await nextTick();
  const pageTitle = document.getElementById('page-title');
  if (pageTitle && detailData.request) {
    pageTitle.textContent = `簽核詳情 #${detailData.request.id}${
      detailData.request.status === 'draft' ? '（草稿）' : ''
    }`;
  }
  const pageActions = document.getElementById('page-actions');
  if (pageActions) {
    pageActions.innerHTML = L.buildRequestDetailActionsHtml(detailData);
  }
  const body = document.getElementById('page-body');
  if (body) {
    L.bindRequestDetailEvents(body, detailData, loadData);
  }
}

watch(mainHtml, () => {
  bindAll();
});

await loadData();

onMounted(async () => {
  await bindAll();
});

onBeforeUnmount(() => {
  const pageActions = document.getElementById('page-actions');
  if (pageActions) pageActions.innerHTML = '';
});
</script>
