<template>
  <div v-if="nameOpen" class="modal">
    <div class="modal-backdrop" @click="nameOpen = false"></div>
    <div class="modal-panel">
      <h3 style="margin-top:0">{{ renaming ? '修改部門名稱' : '新增部門' }}</h3>
      <p v-if="renaming" class="muted" style="margin-top:0">原名稱：{{ renaming.name }}。修改後，此部門成員的所屬部門會一併更新。</p>
      <form class="form-grid" @submit.prevent="saveName">
        <div class="field">
          <label>部門名稱 *</label>
          <input v-model="name" required maxlength="40" />
        </div>
        <div class="form-actions">
          <button type="submit" class="btn primary" :disabled="saving">{{ renaming ? '儲存' : '建立' }}</button>
          <button type="button" class="btn outline" @click="nameOpen = false">取消</button>
        </div>
      </form>
    </div>
  </div>
  <div v-if="membersDept" class="modal">
    <div class="modal-backdrop" @click="membersDept = null"></div>
    <div class="modal-panel wide">
      <h3 style="margin-top:0">加入成員 — {{ membersDept.name }}</h3>
      <div class="approver-list" style="max-height:320px">
        <label v-for="u in users" :key="u.id">
          <input v-model="picked" type="checkbox" :value="u.id" />
          {{ u.name }}（{{ u.department || '未設部門' }}）
        </label>
      </div>
      <div class="form-actions">
        <button type="button" class="btn primary" :disabled="saving" @click="addMembers">加入</button>
        <button type="button" class="btn outline" @click="membersDept = null">取消</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { apiRequest } from '@/api/client';
import { useToastStore } from '@/stores/toast';

const emit = defineEmits(['saved']);
const toast = useToastStore();
const nameOpen = ref(false);
const renaming = ref(null);
const name = ref('');
const membersDept = ref(null);
const users = ref([]);
const picked = ref([]);
const saving = ref(false);

function openAdd() {
  renaming.value = null;
  name.value = '';
  nameOpen.value = true;
}
function openRename(dept) {
  renaming.value = dept;
  name.value = dept.name || '';
  nameOpen.value = true;
}
function openMembers(dept, list) {
  membersDept.value = dept;
  users.value = list || [];
  picked.value = [];
}

async function saveName() {
  saving.value = true;
  try {
    if (renaming.value) {
      await apiRequest(`/api/departments/${renaming.value.id}`, { method: 'PUT', body: { name: name.value } });
      toast.success('部門名稱已更新');
    } else {
      await apiRequest('/api/departments', { method: 'POST', body: { name: name.value } });
      toast.success('部門已新增');
    }
    nameOpen.value = false;
    emit('saved');
  } catch (err) {
    toast.error(err.message || '儲存失敗');
  } finally {
    saving.value = false;
  }
}

async function addMembers() {
  if (!picked.value.length) return toast.error('請從成員名單至少勾選一位');
  saving.value = true;
  try {
    const result = await apiRequest(`/api/departments/${membersDept.value.id}/members`, {
      method: 'POST',
      body: { user_ids: picked.value.map(Number) },
    });
    toast.success(
      `已加入 ${result.added_count || picked.value.length} 人到「${membersDept.value.name}」` +
        (result.skipped_count ? `（略過 ${result.skipped_count} 位已在部門內）` : '')
    );
    membersDept.value = null;
    emit('saved');
  } catch (err) {
    toast.error(err.message || '加入失敗');
  } finally {
    saving.value = false;
  }
}

defineExpose({ openAdd, openRename, openMembers });
</script>
