<template>
  <div v-if="!canManage" class="error-msg">您沒有管理簽核流程的權限（請洽系統管理員）</div>
  <div v-else-if="!workflows.length" v-html="emptyHtml" @click="onEmptyClick"></div>
  <div v-else class="card" v-html="tableHtml"></div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { L } from '@/native/bridge';

const workflows = ref([]);
const canManage = computed(() => L.hasPerm('workflows'));

async function loadData() {
  if (!canManage.value) return;
  workflows.value = await L.loadWorkflows(true);
  await L.loadUsers();
}

await loadData();

const emptyHtml = computed(() => {
  if (typeof L.getWorkflowsEmptyHtml === 'function') {
    return L.getWorkflowsEmptyHtml();
  }
  return '';
});

const tableHtml = computed(() => {
  if (typeof L.getWorkflowsTableInnerHtml === 'function') {
    return L.getWorkflowsTableInnerHtml(workflows.value);
  }
  return '';
});

function onEmptyClick(e) {
  const b = e.target.closest('#btn-new-wf-empty');
  if (b && typeof L.openWorkflowEditor === 'function') {
    L.openWorkflowEditor();
    return;
  }
  const bi = e.target.closest('#btn-import-wf-empty');
  if (bi) {
    const importFile = document.getElementById('wf-import-file');
    if (importFile) importFile.click();
  }
}

function bindAll() {
  const pageActions = document.getElementById('page-actions');
  if (pageActions && typeof L.getWorkflowsActionsHtml === 'function') {
    pageActions.innerHTML = L.getWorkflowsActionsHtml();
    L.bindWorkflowsActions(pageActions, loadData);
  }

  const body = document.getElementById('page-body');
  if (body && workflows.value.length && typeof L.bindWorkflowsTable === 'function') {
    L.bindWorkflowsTable(body, workflows.value, loadData);
  }
}

onMounted(() => {
  bindAll();
});

onBeforeUnmount(() => {
  const pageActions = document.getElementById('page-actions');
  if (pageActions) pageActions.innerHTML = '';
});
</script>
