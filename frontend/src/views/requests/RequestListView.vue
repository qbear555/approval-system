<template>
  <div class="request-list-page">
    <div class="header-card card">
      <div class="header-info">
        <h3>{{ pageTitle }}</h3>
        <p class="muted">{{ pageSubtitle }}</p>
      </div>
      <router-link to="/new-request" class="btn primary">
        新增申請
      </router-link>
    </div>

    <!-- Filters Bar (僅簽核紀錄或需要時顯示) -->
    <div class="filters-card card">
      <div class="search-box">
        <input v-model="filterKeyword" type="text" placeholder="搜尋申請單號、同仁姓名、流程名稱..." class="form-control" />
      </div>
      <div class="select-box">
        <select v-model="filterWorkflow" class="form-control">
          <option value="">全部表單類別</option>
          <option v-for="w in workflowOptions" :key="w" :value="w">{{ w }}</option>
        </select>
      </div>
      <div v-if="filterType === 'records'" class="select-box">
        <select v-model="filterStatus" class="form-control">
          <option value="">全部審核狀態</option>
          <option value="pending">審核中</option>
          <option value="approved">已核准</option>
          <option value="rejected">已駁回</option>
          <option value="cancelled">已撤回</option>
        </select>
      </div>
    </div>

    <!-- Table Card -->
    <div class="card list-card">
      <div v-if="loading" class="text-center p-4 muted">載入簽核案件中...</div>

      <div v-else-if="filteredRequests.length === 0" class="empty-state text-center p-4">
        <p>{{ emptyMessage }}</p>
      </div>

      <table v-else class="data-table">
        <thead>
          <tr>
            <th>單號</th>
            <th>流程名稱</th>
            <th>申請人</th>
            <th>部門</th>
            <th>申請時間</th>
            <th>當前狀態</th>
            <th class="text-right">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in filteredRequests" :key="r.id">
            <td class="font-mono font-bold">{{ r.serial_no || '#' + r.id }}</td>
            <td>{{ r.workflow_name }}</td>
            <td>{{ r.applicant_name }}</td>
            <td>{{ r.applicant_dept || '—' }}</td>
            <td>{{ formatDate(r.created_at) }}</td>
            <td>
              <span :class="['badge', getStatusBadgeClass(r.status)]">
                {{ getStatusLabel(r.status) }}
              </span>
            </td>
            <td class="text-right">
              <router-link :to="'/requests/' + r.id" class="btn primary sm">
                {{ filterType === 'inbox' ? '前往簽核' : '查看明細' }}
              </router-link>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { apiRequest } from '@/api/client';
import { useToastStore } from '@/stores/toast';

const route = useRoute();
const toast = useToastStore();

const requests = ref([]);
const loading = ref(true);
const filterKeyword = ref('');
const filterWorkflow = ref('');
const filterStatus = ref('');

const filterType = computed(() => {
  if (route.name === 'Inbox') return 'inbox';
  if (route.name === 'Mine') return 'mine';
  return 'records';
});

const pageTitle = computed(() => {
  if (filterType.value === 'inbox') return '待我簽核';
  if (filterType.value === 'mine') return '我的申請';
  return '簽核紀錄';
});

const pageSubtitle = computed(() => {
  if (filterType.value === 'inbox') return '目前指派給您、等待您批核或轉簽的表單文件。';
  if (filterType.value === 'mine') return '您本人發起的所有簽核申請案件與最新進度。';
  return '查詢檢視所有已結案、進行中或歸檔的表單歷史紀錄。';
});

const emptyMessage = computed(() => {
  if (filterType.value === 'inbox') return '太棒了！目前沒有待您簽核的案件。';
  if (filterType.value === 'mine') return '您目前尚未發起任何簽核申請。';
  return '查無任何符合條件的簽核紀錄。';
});

onMounted(() => {
  loadRequests();
});

watch(filterType, () => {
  loadRequests();
});

async function loadRequests() {
  loading.value = true;
  let apiFilter = 'related';
  if (filterType.value === 'inbox') apiFilter = 'pending_me';
  if (filterType.value === 'mine') apiFilter = 'mine';
  if (filterType.value === 'records') apiFilter = 'all';

  try {
    const res = await apiRequest(`/api/requests?filter=${apiFilter}`);
    requests.value = res.requests || [];
  } catch (err) {
    toast.error('載入簽核列表失敗: ' + err.message);
  } finally {
    loading.value = false;
  }
}

const workflowOptions = computed(() => {
  const set = new Set();
  requests.value.forEach((r) => {
    if (r.workflow_name) set.add(r.workflow_name);
  });
  return [...set].sort();
});

const filteredRequests = computed(() => {
  return requests.value.filter((r) => {
    if (filterKeyword.value) {
      const q = filterKeyword.value.toLowerCase();
      const matchSerial = String(r.serial_no || r.id).toLowerCase().includes(q);
      const matchName = String(r.applicant_name || '').toLowerCase().includes(q);
      const matchWf = String(r.workflow_name || '').toLowerCase().includes(q);
      if (!matchSerial && !matchName && !matchWf) return false;
    }
    if (filterWorkflow.value && r.workflow_name !== filterWorkflow.value) {
      return false;
    }
    if (filterStatus.value && r.status !== filterStatus.value) {
      return false;
    }
    return true;
  });
});

function getStatusLabel(status) {
  const map = {
    pending: '審核中',
    approved: '已核准',
    rejected: '已駁回',
    cancelled: '已撤回',
  };
  return map[status] || status;
}

function getStatusBadgeClass(status) {
  const map = {
    pending: 'warning',
    approved: 'success',
    rejected: 'danger',
    cancelled: 'outline',
  };
  return map[status] || 'outline';
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    return iso;
  }
}
</script>

<style scoped>
.request-list-page {
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

.text-right {
  text-align: right;
}

.font-mono {
  font-family: monospace;
}
.font-bold {
  font-weight: 600;
}

.empty-state {
  padding: 48px 20px;
}
.empty-icon {
  font-size: 2.8rem;
  margin-bottom: 8px;
}
</style>
