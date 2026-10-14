<template>
  <div class="modal">
    <div class="modal-backdrop" @click="$emit('close')"></div>
    <div class="modal-panel">
      <h3 style="margin-top:0">修改密碼 — {{ user.name }}</h3>
      <p class="muted" style="margin-top:0">帳號：<strong>{{ user.username }}</strong>　部門：{{ user.department || '—' }}</p>
      <form class="form-grid" @submit.prevent="save">
        <div class="field">
          <label>新密碼 *</label>
          <input v-model="password" type="password" required minlength="6" autocomplete="new-password" />
        </div>
        <div class="field">
          <label>確認新密碼 *</label>
          <input v-model="confirm" type="password" required minlength="6" autocomplete="new-password" />
        </div>
        <div class="form-actions">
          <button type="submit" class="btn primary" :disabled="saving">儲存密碼</button>
          <button type="button" class="btn outline" @click="$emit('close')">取消</button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { apiRequest } from '@/api/client';
import { useToastStore } from '@/stores/toast';

const props = defineProps({ user: { type: Object, required: true } });
const emit = defineEmits(['close', 'saved']);
const toast = useToastStore();
const password = ref('');
const confirm = ref('');
const saving = ref(false);

async function save() {
  if (password.value.length < 6) return toast.error('新密碼至少 6 字元');
  if (password.value !== confirm.value) return toast.error('兩次輸入的密碼不一致');
  saving.value = true;
  try {
    const data = await apiRequest(`/api/users/${props.user.id}/password`, {
      method: 'PUT',
      body: { password: password.value, confirmPassword: confirm.value },
    });
    toast.success(data.message || `已更新「${props.user.name}」的密碼`);
    emit('saved');
  } catch (err) {
    toast.error(err.message || '儲存失敗');
  } finally {
    saving.value = false;
  }
}
</script>
