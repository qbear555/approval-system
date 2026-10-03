<template>
  <div class="dashboard-page">
    <!-- Announcement Banner -->
    <div v-if="announcement && announcement.active" class="announcement-card card">
      <div class="announcement-tag">公司公告</div>
      <div class="announcement-title">{{ announcement.title || '最新公告' }}</div>
      <p class="announcement-body">{{ announcement.body }}</p>
    </div>

    <!-- Quick Stats Grid -->
    <div class="stats-grid">
      <div class="stat-card card highlight">
        <div class="stat-info">
          <div class="stat-label">待我簽核</div>
          <div class="stat-value text-primary">{{ stats.pendingApproval || 0 }}</div>
        </div>
        <router-link to="/inbox" class="stat-link">立即處理 →</router-link>
      </div>

      <div class="stat-card card">
        <div class="stat-info">
          <div class="stat-label">我的申請（審核中）</div>
          <div class="stat-value text-warning">{{ stats.myPending || 0 }}</div>
        </div>
        <router-link to="/mine" class="stat-link">查看清單 →</router-link>
      </div>

      <div class="stat-card card">
        <div class="stat-info">
          <div class="stat-label">已核准結案</div>
          <div class="stat-value text-success">{{ stats.approvedCount || 0 }}</div>
        </div>
        <router-link to="/records" class="stat-link">紀錄查閱 →</router-link>
      </div>

      <div class="stat-card card">
        <div class="stat-info">
          <div class="stat-label">本月申請件數</div>
          <div class="stat-value">{{ stats.thisMonthCount || 0 }}</div>
        </div>
        <router-link to="/new-request" class="stat-link">發起新單 →</router-link>
      </div>
    </div>

    <!-- Pending Table Section -->
    <div class="recent-section card">
      <div class="section-header">
        <div class="section-title">
          <h3>待處理簽核文件</h3>
          <span class="muted-tag">即時同步</span>
        </div>
        <router-link to="/inbox" class="btn outline sm">查看全部</router-link>
      </div>

      <div v-if="loading" class="loading-state">
        載入簽核案件中...
      </div>

      <div v-else-if="requests.length === 0" class="empty-state">
        <p>目前沒有待簽核的案件。</p>
      </div>

      <table v-else class="data-table">
        <thead>
          <tr>
            <th>單號</th>
            <th>流程名稱</th>
            <th>申請人</th>
            <th>部門</th>
            <th>申請時間</th>
            <th class="text-right">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="req in requests" :key="req.id">
            <td class="font-mono font-bold">{{ req.serial_no || '#' + req.id }}</td>
            <td>{{ req.workflow_name }}</td>
            <td>{{ req.applicant_name }}</td>
            <td>{{ req.applicant_dept || '—' }}</td>
            <td>{{ formatDate(req.created_at) }}</td>
            <td class="text-right">
              <router-link :to="'/inbox/' + req.id" class="btn primary sm">簽核</router-link>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { apiRequest } from '@/api/client';

const stats = ref({});
const requests = ref([]);
const announcement = ref(null);
const loading = ref(true);

onMounted(async () => {
  try {
    const [statsRes, reqsRes, annRes] = await Promise.allSettled([
      apiRequest('/api/stats'),
      apiRequest('/api/requests?filter=pending_me'),
      apiRequest('/api/announcement'),
    ]);

    if (statsRes.status === 'fulfilled') {
      stats.value = statsRes.value?.stats || {};
    }
    if (reqsRes.status === 'fulfilled') {
      const all = reqsRes.value?.requests || [];
      requests.value = all.slice(0, 6);
    }
    if (annRes.status === 'fulfilled') {
      announcement.value = annRes.value?.announcement || null;
    }
  } finally {
    loading.value = false;
  }
});

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
.dashboard-page {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.announcement-card {
  background: #fffbeb;
  border-color: #fde68a;
  padding: 16px 20px;
}
.announcement-tag {
  font-weight: 700;
  color: #b45309;
  font-size: 0.85rem;
  margin-bottom: 4px;
}
.announcement-title {
  font-size: 1.05rem;
  font-weight: 600;
  color: #92400e;
  margin-bottom: 4px;
}
.announcement-body {
  font-size: 0.9rem;
  color: #78350f;
  line-height: 1.5;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px;
}

.stat-card {
  display: flex;
  flex-direction: column;
  position: relative;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.stat-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}
.stat-card.highlight {
  border-left: 4px solid var(--primary);
}

.stat-label {
  font-size: 0.88rem;
  color: var(--text-muted);
  font-weight: 500;
}

.stat-value {
  font-size: 1.8rem;
  font-weight: 700;
  line-height: 1.2;
  margin: 4px 0 12px;
}
.text-primary { color: var(--primary); }
.text-warning { color: var(--warning); }
.text-success { color: var(--success); }

.stat-link {
  font-size: 0.82rem;
  color: var(--primary);
  text-decoration: none;
  font-weight: 500;
  align-self: flex-start;
}
.stat-link:hover {
  text-decoration: underline;
}

.recent-section {
  padding: 20px;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 10px;
}
.section-title h3 {
  font-size: 1.1rem;
  font-weight: 700;
}
.muted-tag {
  font-size: 0.75rem;
  background: #f1f5f9;
  color: var(--text-muted);
  padding: 2px 8px;
  border-radius: 4px;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
}

.data-table th, .data-table td {
  padding: 12px;
  text-align: left;
  border-bottom: 1px solid var(--border);
  font-size: 0.9rem;
}

.data-table th {
  background: #f8fafc;
  font-weight: 600;
  color: var(--text-muted);
}

.text-right {
  text-align: right !important;
}

.font-mono {
  font-family: monospace;
}
.font-bold {
  font-weight: 600;
}

.empty-state {
  text-align: center;
  padding: 40px 20px;
  color: var(--text-muted);
}
.empty-icon {
  font-size: 2.5rem;
  margin-bottom: 8px;
}

.loading-state {
  text-align: center;
  padding: 30px;
  color: var(--text-muted);
}
</style>
