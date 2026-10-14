<template>
  <div class="modal">
    <div class="modal-backdrop" @click="$emit('close')"></div>
    <div class="modal-panel">
      <h3 style="margin-top:0">設定權限 — {{ user.name }}</h3>
      <p class="muted" style="margin-top:0">帳號：{{ user.username }}　部門：{{ user.department || '—' }}</p>
      <form class="form-grid" @submit.prevent="save">
        <div class="field">
          <label>權限等級 *</label>
          <label class="role-card"><input v-model="role" type="radio" value="admin" /> <span><strong>最高權限（系統管理員）</strong><span class="muted">可管理流程、備份、成員與全部紀錄。</span></span></label>
          <label class="role-card"><input v-model="role" type="radio" value="user" /> <span><strong>一般使用者</strong><span class="muted">僅本人簽核；可再勾選額外權限。</span></span></label>
        </div>
        <div class="field">
          <label>一般使用者的額外功能權限</label>
          <div class="approver-list">
            <label v-for="p in defs" :key="p.id">
              <input v-model="permissions" type="checkbox" :value="p.id" :disabled="role === 'admin'" />
              <span><strong>{{ p.label }}</strong><span v-if="p.description" class="muted"> — {{ p.description }}</span></span>
            </label>
          </div>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn primary" :disabled="saving">儲存</button>
          <button type="button" class="btn outline" @click="$emit('close')">取消</button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';
import { apiRequest } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';

const props = defineProps({
  user: { type: Object, required: true },
  defs: { type: Array, default: () => [] },
});
const emit = defineEmits(['close', 'saved']);
const auth = useAuthStore();
const toast = useToastStore();
const role = ref(props.user.role === 'admin' ? 'admin' : 'user');
const permissions = ref([...(props.user.permissions || [])]);
const saving = ref(false);

watch(role, (v) => {
  if (v === 'admin') permissions.value = props.defs.map((p) => p.id);
});

async function save() {
  saving.value = true;
  try {
    await apiRequest(`/api/users/${props.user.id}`, {
      method: 'PUT',
      body: { role: role.value, permissions: role.value === 'admin' ? [] : permissions.value },
    });
    if (Number(props.user.id) === Number(auth.user?.id)) await auth.fetchMe();
    toast.success(role.value === 'admin' ? '已設為最高權限（系統管理員）' : '權限已更新');
    emit('saved');
  } catch (err) {
    toast.error(err.message || '儲存失敗');
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.role-card {
  display: flex;
  gap: 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 12px;
  margin-top: 8px;
  background: #f8fafc;
}
.role-card span { display: flex; flex-direction: column; gap: 4px; }
</style>
