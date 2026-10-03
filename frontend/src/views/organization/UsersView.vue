<template>
  <div class="users-page">
    <div class="header-card card">
      <div class="header-info">
        <h3>成員名單</h3>
        <p class="muted">管理同仁帳號、指派所屬部門、設定角色權限與勞基法特休可休/已休額度。</p>
      </div>
      <div class="header-actions">
        <a href="/api/users/export" class="btn outline" download>匯出成員清單</a>
        <button type="button" class="btn primary" @click="openAddModal">新增成員</button>
      </div>
    </div>

    <!-- Filters Bar -->
    <div class="filters-card card">
      <div class="search-box">
        <input v-model="filterText" type="text" placeholder="搜尋同仁姓名、帳號..." class="form-control" />
      </div>
      <div class="select-box">
        <select v-model="filterDept" class="form-control">
          <option value="">全部所屬部門</option>
          <option v-for="d in departments" :key="d.id" :value="d.name">{{ d.name }}</option>
        </select>
      </div>
      <div class="select-box">
        <select v-model="filterRole" class="form-control">
          <option value="">全部角色身分</option>
          <option value="admin">系統管理員 (Admin)</option>
          <option value="user">一般同仁</option>
          <option value="auditor">稽核員</option>
        </select>
      </div>
    </div>

    <!-- Members Table -->
    <div class="card list-card">
      <div v-if="loading" class="text-center p-4 muted">載入同仁名單中...</div>

      <div v-else-if="filteredUsers.length === 0" class="text-center p-4 muted">
        無符合篩選條件的同仁資料。
      </div>

      <table v-else class="data-table">
        <thead>
          <tr>
            <th>姓名 / 帳號</th>
            <th>所屬部門</th>
            <th>身分權限</th>
            <th>出勤與特休 (到職日)</th>
            <th>帳號狀態</th>
            <th class="text-right">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in filteredUsers" :key="u.id">
            <td>
              <div class="user-cell">
                <div class="avatar-sm">{{ u.name ? u.name.charAt(0) : 'U' }}</div>
                <div>
                  <div class="font-bold">{{ u.name }}</div>
                  <div class="muted-small font-mono">{{ u.username }}</div>
                </div>
              </div>
            </td>
            <td>
              <span class="dept-badge">{{ getDeptDisplay(u) }}</span>
            </td>
            <td>
              <div class="role-cell">
                <span :class="['badge', u.role === 'admin' ? 'primary' : 'outline']">
                  {{ u.role === 'admin' ? '管理員' : '一般同仁' }}
                </span>
                <div v-if="u.permissions && u.permissions.length" class="perm-tags">
                  <span v-for="p in u.permissions" :key="p" class="perm-tag">{{ p }}</span>
                </div>
              </div>
            </td>
            <td>
              <div class="labor-info">
                <div v-if="u.labor?.hireDate" class="hire-date">到職：{{ u.labor.hireDate }}</div>
                <div v-else class="muted-small">未設到職日</div>
                <div v-if="u.labor?.specialLeave" class="leave-stat">
                  特休可休 <strong>{{ u.labor.specialLeave.entitled || 0 }}</strong> 日 · 已休 {{ u.labor.specialLeave.used || 0 }} 日
                </div>
              </div>
            </td>
            <td>
              <span :class="['badge', u.active !== 0 ? 'success' : 'danger']">
                {{ u.active !== 0 ? '啟用中' : '已停用' }}
              </span>
            </td>
            <td class="text-right actions-cell">
              <button type="button" class="btn outline sm" @click="openEditModal(u)">編輯</button>
              <button type="button" class="btn outline sm" @click="openResetPwdModal(u)">改密碼</button>
              <button v-if="u.role !== 'admin'" type="button" class="btn danger sm" @click="deleteUser(u)">刪除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Modal: 新增成員 -->
    <div v-if="showAddModal" class="modal-backdrop">
      <div class="modal-card card">
        <h3 class="modal-title">新增成員帳號</h3>
        <form @submit.prevent="createUser" class="modal-form">
          <div class="form-row">
            <div class="form-group col">
              <label>帳號 (帳號登入用) *</label>
              <input v-model="addForm.username" type="text" class="form-control" required placeholder="如：david" />
            </div>
            <div class="form-group col">
              <label>姓名 *</label>
              <input v-model="addForm.name" type="text" class="form-control" required placeholder="如：王大明" />
            </div>
          </div>

          <div class="form-row">
            <div class="form-group col">
              <label>預設密碼 *</label>
              <input v-model="addForm.password" type="password" class="form-control" required minlength="6" />
            </div>
            <div class="form-group col">
              <label>電子信箱</label>
              <input v-model="addForm.email" type="email" class="form-control" placeholder="user@company.com" />
            </div>
          </div>

          <div class="form-row">
            <div class="form-group col">
              <label>所屬部門</label>
              <select v-model="addForm.department" class="form-control">
                <option value="">-- 請選擇部門 --</option>
                <option v-for="d in departments" :key="d.id" :value="d.name">{{ d.name }}</option>
              </select>
            </div>
            <div class="form-group col">
              <label>身分角色</label>
              <select v-model="addForm.role" class="form-control">
                <option value="user">一般同仁</option>
                <option value="admin">系統管理員 (Admin)</option>
              </select>
            </div>
          </div>

          <div class="form-group">
            <label>到職日期 (特休計算依據)</label>
            <input v-model="addForm.hireDate" type="date" class="form-control" />
          </div>

          <div class="modal-actions">
            <button type="button" class="btn outline" @click="showAddModal = false">取消</button>
            <button type="submit" class="btn primary" :disabled="formSubmitting">
              {{ formSubmitting ? '建立中...' : '建立成員' }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- Modal: 編輯成員 -->
    <div v-if="showEditModal" class="modal-backdrop">
      <div class="modal-card card">
        <h3 class="modal-title">編輯成員資訊 ({{ currentUser?.name }})</h3>
        <form @submit.prevent="updateUser" class="modal-form">
          <div class="form-group">
            <label>姓名 *</label>
            <input v-model="editForm.name" type="text" class="form-control" required />
          </div>

          <div class="form-group">
            <label>所屬部門</label>
            <select v-model="editForm.department" class="form-control">
              <option value="">-- 未分部門 --</option>
              <option v-for="d in departments" :key="d.id" :value="d.name">{{ d.name }}</option>
            </select>
          </div>

          <div class="form-row">
            <div class="form-group col">
              <label>身分角色</label>
              <select v-model="editForm.role" class="form-control">
                <option value="user">一般同仁</option>
                <option value="admin">系統管理員</option>
              </select>
            </div>
            <div class="form-group col">
              <label>帳號啟用狀態</label>
              <select v-model="editForm.active" class="form-control">
                <option :value="1">正常啟用</option>
                <option :value="0">停用停權</option>
              </select>
            </div>
          </div>

          <div class="modal-actions">
            <button type="button" class="btn outline" @click="showEditModal = false">取消</button>
            <button type="submit" class="btn primary" :disabled="formSubmitting">
              {{ formSubmitting ? '儲存中...' : '儲存變更' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { apiRequest } from '@/api/client';
import { useToastStore } from '@/stores/toast';

const toast = useToastStore();

const users = ref([]);
const departments = ref([]);
const loading = ref(true);

const filterText = ref('');
const filterDept = ref('');
const filterRole = ref('');

const showAddModal = ref(false);
const showEditModal = ref(false);
const formSubmitting = ref(false);
const currentUser = ref(null);

const addForm = ref({
  username: '',
  name: '',
  password: '',
  email: '',
  department: '',
  role: 'user',
  hireDate: '',
});

const editForm = ref({
  name: '',
  department: '',
  role: 'user',
  active: 1,
});

onMounted(() => {
  loadData();
});

async function loadData() {
  loading.value = true;
  try {
    const [uRes, dRes] = await Promise.allSettled([
      apiRequest('/api/users?labor=1'),
      apiRequest('/api/departments'),
    ]);
    if (uRes.status === 'fulfilled') {
      users.value = uRes.value?.users || [];
    }
    if (dRes.status === 'fulfilled') {
      departments.value = dRes.value?.departments || [];
    }
  } catch (err) {
    toast.error('載入失敗: ' + err.message);
  } finally {
    loading.value = false;
  }
}

const filteredUsers = computed(() => {
  return users.value.filter((u) => {
    if (filterText.value) {
      const q = filterText.value.toLowerCase();
      const matchName = String(u.name || '').toLowerCase().includes(q);
      const matchUser = String(u.username || '').toLowerCase().includes(q);
      if (!matchName && !matchUser) return false;
    }
    if (filterDept.value) {
      const depts = Array.isArray(u.departments) ? u.departments : [u.department];
      if (!depts.includes(filterDept.value)) return false;
    }
    if (filterRole.value) {
      if (u.role !== filterRole.value) return false;
    }
    return true;
  });
});

function getDeptDisplay(u) {
  if (Array.isArray(u.departments) && u.departments.length > 0) {
    return u.departments.join(', ');
  }
  return u.department || '未指派';
}

function openAddModal() {
  addForm.value = {
    username: '',
    name: '',
    password: '',
    email: '',
    department: '',
    role: 'user',
    hireDate: '',
  };
  showAddModal.value = true;
}

function openEditModal(u) {
  currentUser.value = u;
  editForm.value = {
    name: u.name,
    department: u.department || '',
    role: u.role || 'user',
    active: u.active !== 0 ? 1 : 0,
  };
  showEditModal.value = true;
}

async function createUser() {
  formSubmitting.value = true;
  try {
    await apiRequest('/api/users', {
      method: 'POST',
      body: JSON.stringify(addForm.value),
    });
    toast.success('成員已成功建立！');
    showAddModal.value = false;
    await loadData();
  } catch (err) {
    toast.error('建立失敗: ' + err.message);
  } finally {
    formSubmitting.value = false;
  }
}

async function updateUser() {
  if (!currentUser.value) return;
  formSubmitting.value = true;
  try {
    await apiRequest(`/api/users/${currentUser.value.id}`, {
      method: 'PUT',
      body: JSON.stringify(editForm.value),
    });
    toast.success('成員資訊已更新！');
    showEditModal.value = false;
    await loadData();
  } catch (err) {
    toast.error('更新失敗: ' + err.message);
  } finally {
    formSubmitting.value = false;
  }
}

async function openResetPwdModal(u) {
  const newPass = prompt(`請輸入同仁【${u.name}】的新密碼 (至少 6 碼)：`);
  if (!newPass) return;
  if (newPass.length < 6) return alert('密碼長度至少需 6 碼');

  try {
    await apiRequest(`/api/users/${u.id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ password: newPass }),
    });
    toast.success(`已成功重設【${u.name}】的登入密碼！`);
  } catch (err) {
    toast.error('重設失敗: ' + err.message);
  }
}

async function deleteUser(u) {
  if (!confirm(`確定要刪除同仁【${u.name}】嗎？此動作將移除其帳號。`)) return;
  try {
    await apiRequest(`/api/users/${u.id}`, { method: 'DELETE' });
    toast.success(`已刪除同仁 ${u.name}`);
    await loadData();
  } catch (err) {
    toast.error('刪除失敗: ' + err.message);
  }
}
</script>

<style scoped>
.users-page {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.header-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px;
}

.header-actions {
  display: flex;
  gap: 10px;
}

.header-info h3 {
  font-size: 1.15rem;
  margin-bottom: 4px;
}

.muted {
  font-size: 0.88rem;
  color: var(--text-muted);
}

.filters-card {
  display: flex;
  gap: 16px;
  padding: 16px 20px;
}

.search-box {
  flex: 2;
}
.select-box {
  flex: 1;
}

.form-control {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 0.92rem;
}

.list-card {
  padding: 0;
  overflow: hidden;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
}

.data-table th, .data-table td {
  padding: 14px 18px;
  text-align: left;
  border-bottom: 1px solid var(--border);
  font-size: 0.92rem;
}

.data-table th {
  background: #f8fafc;
  font-weight: 600;
  color: var(--text-muted);
}

.user-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}

.avatar-sm {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--primary);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 0.85rem;
}

.dept-badge {
  background: #f1f5f9;
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 0.82rem;
  color: #334155;
}

.labor-info {
  font-size: 0.82rem;
}
.leave-stat {
  color: #15803d;
}

.perm-tags {
  display: flex;
  gap: 4px;
  margin-top: 4px;
}
.perm-tag {
  font-size: 0.72rem;
  background: #e0f2fe;
  color: #0369a1;
  padding: 1px 5px;
  border-radius: 3px;
}

.font-mono { font-family: monospace; }
.font-bold { font-weight: 600; }
.muted-small { font-size: 0.75rem; color: var(--text-muted); }
.text-right { text-align: right; }

.actions-cell {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

/* Modal */
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 999;
}

.modal-card {
  width: 100%;
  max-width: 520px;
  padding: 24px;
  background: #ffffff;
}

.modal-title {
  font-size: 1.15rem;
  font-weight: 700;
  margin-bottom: 16px;
}

.form-group {
  margin-bottom: 14px;
}

.form-group label {
  display: block;
  font-size: 0.88rem;
  font-weight: 600;
  margin-bottom: 5px;
}

.form-row {
  display: flex;
  gap: 14px;
}
.form-row .col {
  flex: 1;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 20px;
}
</style>
