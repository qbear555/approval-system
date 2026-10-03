<template>
  <div class="departments-page">
    <div class="header-card card">
      <div class="header-info">
        <h3>部門組織架構</h3>
        <p class="muted">管理公司部門層級與所屬主管。成員可同時隸屬於多個部門。</p>
      </div>
      <button type="button" class="btn primary" @click="openAddModal">
        新增部門
      </button>
    </div>

    <div v-if="loading" class="card text-center p-4 muted">載入部門清單中...</div>

    <div v-else-if="departments.length === 0" class="card empty-state text-center p-4">
      <p>目前尚無部門資料，點擊上方按鈕建立第一個部門。</p>
    </div>

    <div v-else class="dept-grid">
      <div v-for="dept in departments" :key="dept.id" class="dept-card card">
        <div class="dept-header">
          <div class="dept-title-box">
            <h4 class="dept-name">{{ dept.name }}</h4>
          </div>
          <div class="dept-actions">
            <button type="button" class="btn outline sm" @click="openRenameModal(dept)">編輯</button>
            <button type="button" class="btn danger sm" @click="deleteDept(dept)">刪除</button>
          </div>
        </div>

        <div class="dept-meta">
          <div class="meta-item">
            <span class="label">部門主管：</span>
            <span class="val font-bold text-primary">{{ getManagerName(dept.manager_id) || '尚未指派' }}</span>
          </div>
          <div class="meta-item">
            <span class="label">部門人數：</span>
            <span class="val">{{ getDeptMemberCount(dept.name) }} 人</span>
          </div>
        </div>

        <div class="dept-members">
          <div class="members-title">部門成員清單：</div>
          <div class="members-chips">
            <span v-for="m in getDeptMembers(dept.name)" :key="m.id" class="chip">
              {{ m.name }}
            </span>
            <span v-if="getDeptMembers(dept.name).length === 0" class="muted-small">
              暫無成員
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Modal: 新增 / 編輯部門 -->
    <div v-if="showModal" class="modal-backdrop">
      <div class="modal-card card">
        <h3 class="modal-title">{{ isEditing ? '修改部門名稱' : '新增部門' }}</h3>
        <form @submit.prevent="saveDept" class="modal-form">
          <div class="form-group">
            <label>部門名稱 *</label>
            <input v-model="modalName" type="text" class="form-control" required placeholder="如：人資部、研發部" />
          </div>

          <div class="form-group">
            <label>部門主管 (審批流轉預設主管)</label>
            <select v-model="modalManagerId" class="form-control">
              <option value="">-- 無主管 / 尚未指派 --</option>
              <option v-for="u in allUsers" :key="u.id" :value="u.id">
                {{ u.name }} ({{ u.username }})
              </option>
            </select>
          </div>

          <div class="modal-actions">
            <button type="button" class="btn outline" @click="closeModal">取消</button>
            <button type="submit" class="btn primary" :disabled="modalSaving">
              {{ modalSaving ? '處理中...' : '確認儲存' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { apiRequest } from '@/api/client';
import { useToastStore } from '@/stores/toast';

const toast = useToastStore();

const departments = ref([]);
const allUsers = ref([]);
const loading = ref(true);

const showModal = ref(false);
const isEditing = ref(false);
const currentDept = ref(null);
const modalName = ref('');
const modalManagerId = ref('');
const modalSaving = ref(false);

onMounted(() => {
  loadData();
});

async function loadData() {
  loading.value = true;
  try {
    const [deptRes, userRes] = await Promise.allSettled([
      apiRequest('/api/departments'),
      apiRequest('/api/users'),
    ]);

    if (deptRes.status === 'fulfilled') {
      departments.value = deptRes.value?.departments || [];
    }
    if (userRes.status === 'fulfilled') {
      allUsers.value = userRes.value?.users || [];
    }
  } catch (err) {
    toast.error('載入部門資料失敗: ' + err.message);
  } finally {
    loading.value = false;
  }
}

function getManagerName(mgrId) {
  if (!mgrId) return '';
  const u = allUsers.value.find((x) => x.id === mgrId);
  return u ? u.name : '';
}

function getDeptMembers(deptName) {
  return allUsers.value.filter((u) => {
    const depts = Array.isArray(u.departments) ? u.departments : [u.department];
    return depts.includes(deptName);
  });
}

function getDeptMemberCount(deptName) {
  return getDeptMembers(deptName).length;
}

function openAddModal() {
  isEditing.value = false;
  currentDept.value = null;
  modalName.value = '';
  modalManagerId.value = '';
  showModal.value = true;
}

function openRenameModal(dept) {
  isEditing.value = true;
  currentDept.value = dept;
  modalName.value = dept.name;
  modalManagerId.value = dept.manager_id || '';
  showModal.value = true;
}

function closeModal() {
  showModal.value = false;
}

async function saveDept() {
  modalSaving.value = true;
  try {
    if (isEditing.value && currentDept.value) {
      await apiRequest(`/api/departments/${currentDept.value.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: modalName.value,
          manager_id: modalManagerId.value || null,
        }),
      });
      toast.success('部門已更新！');
    } else {
      await apiRequest('/api/departments', {
        method: 'POST',
        body: JSON.stringify({
          name: modalName.value,
          manager_id: modalManagerId.value || null,
        }),
      });
      toast.success('部門已成功新增！');
    }
    closeModal();
    await loadData();
  } catch (err) {
    toast.error('儲存失敗: ' + err.message);
  } finally {
    modalSaving.value = false;
  }
}

async function deleteDept(dept) {
  if (!confirm(`確定要刪除「${dept.name}」部門嗎？`)) return;
  try {
    await apiRequest(`/api/departments/${dept.id}`, { method: 'DELETE' });
    toast.success('已刪除部門');
    await loadData();
  } catch (err) {
    toast.error('刪除失敗: ' + err.message);
  }
}
</script>

<style scoped>
.departments-page {
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

.header-info h3 {
  font-size: 1.15rem;
  margin-bottom: 4px;
}

.muted {
  font-size: 0.88rem;
  color: var(--text-muted);
}

.dept-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 18px;
}

.dept-card {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.dept-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

.dept-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border);
}

.dept-title-box {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dept-icon {
  font-size: 1.3rem;
}

.dept-name {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--text-main);
}

.dept-actions {
  display: flex;
  gap: 6px;
}

.dept-meta {
  display: flex;
  justify-content: space-between;
  font-size: 0.88rem;
  background: #f8fafc;
  padding: 8px 12px;
  border-radius: 6px;
}

.meta-item .label {
  color: var(--text-muted);
}

.dept-members {
  font-size: 0.85rem;
}

.members-title {
  color: var(--text-muted);
  font-weight: 500;
  margin-bottom: 8px;
}

.members-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chip {
  background: #eff6ff;
  color: #1d4ed8;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.8rem;
  font-weight: 500;
}

.muted-small {
  color: #94a3b8;
  font-size: 0.8rem;
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
  max-width: 440px;
  padding: 24px;
  background: #ffffff;
}

.modal-title {
  font-size: 1.15rem;
  font-weight: 700;
  margin-bottom: 16px;
}

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  font-size: 0.88rem;
  font-weight: 600;
  margin-bottom: 6px;
}

.form-control {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 0.95rem;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 20px;
}
</style>
