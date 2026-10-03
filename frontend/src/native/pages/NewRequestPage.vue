<template>
  <div v-if="!workflows.length" v-html="emptyHtml" @click="onEmptyClick"></div>
  <template v-else>
    <div class="card" id="form-catalog-card" v-html="catalogHtml"></div>
    <div class="card hidden" id="req-form-card" v-html="formHtml"></div>
  </template>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { L } from '@/native/bridge';

const workflows = ref([]);
const emptyHtml = ref('');
const catalogHtml = ref('');
const formHtml = ref('');

await L.loadUsers();
const wfList = await L.loadWorkflows(false);
workflows.value = wfList || [];

if (!wfList || !wfList.length) {
  emptyHtml.value = L.emptyState({
    title: '尚無可用的簽核流程',
    desc: L.hasPerm('workflows')
      ? '請先建立簽核流程，才能讓同仁送出申請。'
      : '目前沒有已啟用的流程，請洽系統管理員建立或啟用。',
    actions: L.hasPerm('workflows')
      ? [{ label: '前往簽核流程', go: 'workflows', primary: true }]
      : [{ label: '回總覽', go: 'dashboard', outline: true }],
  });
} else {
  const { sortedCats, optgroupsHtml } = L.prepareNewRequestWorkflows(wfList);
  catalogHtml.value = L.getNewRequestCatalogInnerHtml(wfList, sortedCats);
  formHtml.value = L.getNewRequestFormInnerHtml(optgroupsHtml, L.state.user);
}

function onEmptyClick(e) {
  const btn = e.target.closest('[data-go]');
  if (btn && btn.dataset.go) {
    L.navigate(btn.dataset.go);
  }
}

onMounted(() => {
  const body = document.getElementById('page-body');
  if (body && workflows.value.length && typeof L.initNewRequestInteractions === 'function') {
    L.initNewRequestInteractions(body, workflows.value);
  }
});
</script>
