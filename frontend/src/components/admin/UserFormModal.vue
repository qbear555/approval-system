<template>
  <div class="modal">
    <div class="modal-backdrop" @click="$emit('close')"></div>
    <div class="modal-panel wide">
      <h3 style="margin-top:0">
        {{ title }}
        <span v-if="builtin" class="muted" style="font-size:0.85rem">（系統內建 Admin）</span>
      </h3>
      <form class="form-grid" @submit.prevent="save">
        <template v-if="mode !== 'leave'">
          <div class="form-grid two">
            <div class="field">
              <label>帳號 *</label>
              <input v-model="form.username" required minlength="3" :readonly="builtin" :disabled="builtin" autocomplete="off" />
            </div>
            <div class="field">
              <label>姓名 *</label>
              <input v-model="form.name" required />
            </div>
          </div>
          <div class="form-grid two">
            <div class="field">
              <label>Email</label>
              <input v-model="form.email" type="email" />
            </div>
            <div class="field">
              <label>到職日（選填）</label>
              <input v-model="form.hire_date" type="date" />
            </div>
          </div>
        </template>
        <div v-else class="field">
          <label>到職日（選填）</label>
          <input v-model="form.hire_date" type="date" />
          <div class="muted" style="font-size:0.8rem;margin-top:4px">僅供顯示；可休日數不依年資計算</div>
        </div>
        <LeaveUsedFields ref="leaveRef" :user="user" />
        <template v-if="mode === 'edit'">
          <div class="form-grid two">
            <div class="field">
              <label>電話 / 分機</label>
              <div style="display:flex;gap:8px">
                <input v-model="form.phone" placeholder="電話" style="flex:1" />
                <input v-model="form.extension" placeholder="分機" style="width:90px" />
              </div>
            </div>
            <div class="field">
              <label>主部門</label>
              <select v-model="form.department">
                <option value="">（未指定）</option>
                <option v-for="d in departments" :key="d.id || d.name" :value="d.name">{{ d.name }}</option>
              </select>
            </div>
          </div>
          <div class="field">
            <label>隸屬部門（可多選）</label>
            <div class="approver-list">
              <label v-for="d in departments" :key="'m-' + d.name">
                <input v-model="form.departments" type="checkbox" :value="d.name" />
                {{ d.name }}
              </label>
              <span v-if="!departments.length" class="muted">尚無部門</span>
            </div>
          </div>
          <div class="field">
            <label>權限等級</label>
            <select v-model="form.role" :disabled="builtin">
              <option value="user">一般使用者</option>
              <option value="admin">最高權限（系統管理員）</option>
            </select>
          </div>
          <div class="field">
            <label>一般使用者額外權限</label>
            <div class="approver-list">
              <label v-for="p in defs" :key="p.id">
                <input v-model="form.permissions" type="checkbox" :value="p.id" :disabled="form.role === 'admin'" />
                {{ p.label }}
              </label>
            </div>
          </div>
          <div class="field">
            <label>重設密碼（選填）</label>
            <input v-model="form.password" type="password" minlength="6" autocomplete="new-password" placeholder="空白＝不變更" />
          </div>
        </template>
        <template v-else-if="mode === 'add'">
          <div class="field">
            <label>密碼 *</label>
            <input v-model="form.password" type="password" required minlength="6" autocomplete="new-password" />
          </div>
          <div class="field">
            <label>部門</label>
            <select v-model="form.department">
              <option value="">請選擇部門…</option>
              <option v-for="d in departments" :key="d.id || d.name" :value="d.name">{{ d.name }}</option>
            </select>
          </div>
          <div class="field">
            <label>權限等級</label>
            <select v-model="form.role">
              <option value="user">一般使用者</option>
              <option value="admin">最高權限（系統管理員）</option>
            </select>
          </div>
          <div class="field">
            <label>一般使用者額外權限</label>
            <div class="approver-list">
              <label v-for="p in defs" :key="p.id">
                <input v-model="form.permissions" type="checkbox" :value="p.id" :disabled="form.role === 'admin'" />
                {{ p.label }}
              </label>
            </div>
          </div>
        </template>
        <div class="form-actions">
          <button type="submit" class="btn primary" :disabled="saving">{{ saving ? '儲存中…' : submitLabel }}</button>
          <button type="button" class="btn outline" @click="$emit('close')">取消</button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { apiRequest } from '@/api/client';
import { useToastStore } from '@/stores/toast';
import { useAuthStore } from '@/stores/auth';
import { collectLeavePayload, formatUsername } from '@/lib/leave-track';
import LeaveUsedFields from './LeaveUsedFields.vue';

const props = defineProps({
  mode: { type: String, default: 'add' },
  user: { type: Object, default: null },
  defs: { type: Array, default: () => [] },
});
const emit = defineEmits(['close', 'saved']);
const toast = useToastStore();
const auth = useAuthStore();
const leaveRef = ref(null);
const saving = ref(false);
const departments = ref([]);

const builtin = computed(() => String(props.user?.username || '').toLowerCase() === 'admin');
const title = computed(() => {
  if (props.mode === 'add') return '新增成員';
  if (props.mode === 'leave') return `編輯休假設定 — ${props.user?.name || ''}`;
  return `編輯成員 — ${props.user?.name || ''}`;
});
const submitLabel = computed(() => (props.mode === 'add' ? '建立成員' : props.mode === 'leave' ? '儲存休假設定' : '儲存'));

const form = reactive({
  username: props.user?.username || '',
  name: props.user?.name || '',
  email: props.user?.email || '',
  phone: props.user?.phone || '',
  extension: props.user?.extension || '',
  hire_date: props.user?.hire_date || props.user?.labor?.hireDate || '',
  department: props.user?.department || '',
  departments: [...(props.user?.departments || (props.user?.department ? [props.user.department] : []))],
  role: props.user?.role === 'admin' ? 'admin' : 'user',
  permissions: [...(props.user?.permissions || [])],
  password: '',
});

watch(
  () => form.role,
  (role) => {
    if (role === 'admin') form.permissions = props.defs.map((p) => p.id);
  }
);

onMounted(async () => {
  if (props.mode === 'leave') return;
  try {
    const res = await apiRequest('/api/departments');
    departments.value = res.departments || [];
  } catch {
    departments.value = [];
  }
});

async function save() {
  saving.value = true;
  try {
    const leave = collectLeavePayload(leaveRef.value?.rows || {});
    if (props.mode === 'leave') {
      await apiRequest(`/api/users/${props.user.id}`, {
        method: 'PUT',
        body: { hire_date: String(form.hire_date || '').trim(), ...leave },
      });
      toast.success('休假可休／已休已更新');
    } else if (props.mode === 'add') {
      await apiRequest('/api/users', {
        method: 'POST',
        body: {
          username: formatUsername(form.username),
          name: form.name,
          password: form.password,
          department: form.department || '',
          email: form.email || '',
          hire_date: form.hire_date || '',
          role: form.role,
          permissions: form.role === 'admin' ? [] : form.permissions,
          ...leave,
        },
      });
      toast.success('成員已新增');
    } else {
      const body = {
        username: builtin.value ? props.user.username : formatUsername(form.username),
        name: String(form.name || '').trim(),
        email: String(form.email || '').trim(),
        phone: String(form.phone || '').trim(),
        extension: String(form.extension || '').trim(),
        hire_date: String(form.hire_date || '').trim(),
        department: String(form.department || '').trim(),
        departments: form.departments,
        role: builtin.value ? 'admin' : form.role,
        permissions: builtin.value || form.role === 'admin' ? [] : form.permissions,
        ...leave,
      };
      if (String(form.password || '').trim()) body.password = String(form.password).trim();
      const data = await apiRequest(`/api/users/${props.user.id}`, { method: 'PUT', body });
      if (Number(props.user.id) === Number(auth.user?.id)) await auth.fetchMe();
      if (data.selfUsernameChanged) toast.success(`帳號已改為 ${data.selfUsernameChanged}，請記得使用新帳號登入`);
      else toast.success('成員資料已更新');
    }
    emit('saved');
  } catch (err) {
    toast.error(err.message || '儲存失敗');
  } finally {
    saving.value = false;
  }
}
</script>
