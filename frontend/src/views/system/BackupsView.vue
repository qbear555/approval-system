<template>
  <div class="backups-page">
    <div class="header-card card">
      <div class="header-info">
        <h3>資料庫安全備份</h3>
        <p class="muted">定期產生 SQL 完整備份檔（含表結構與所有簽核資料）。支援一鍵下載與歷史查閱。</p>
      </div>
      <button type="button" class="btn primary" :disabled="creating" @click="createBackup">
        {{ creating ? '備份中，請稍候...' : '立即建立備份' }}
      </button>
    </div>

    <div class="card list-card">
      <div v-if="loading" class="text-center p-4 muted">載入備份清單中...</div>

      <div v-else-if="backups.length === 0" class="empty-state text-center p-4">
        <p>目前尚無備份紀錄，可點擊上方按鈕建立第一份備份。</p>
      </div>

      <table v-else class="data-table">
        <thead>
          <tr>
            <th>備份檔名</th>
            <th>檔案大小</th>
            <th>建立時間</th>
            <th class="text-right">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="b in backups" :key="b.id || b.name">
            <td class="font-mono font-bold">{{ b.name || b.filename }}</td>
            <td>{{ formatSize(b.size) }}</td>
            <td>{{ formatDate(b.createdAt || b.time) }}</td>
            <td class="text-right actions-cell">
              <a :href="'/api/backups/' + (b.id || b.name) + '/download'" class="btn outline sm" download>
                下載
              </a>
              <button type="button" class="btn danger sm" @click="deleteBackup(b.id || b.name)">
                刪除
              </button>
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
import { useToastStore } from '@/stores/toast';

const toast = useToastStore();
const backups = ref([]);
const loading = ref(true);
const creating = ref(false);

onMounted(() => {
  loadBackups();
});

async function loadBackups() {
  loading.value = true;
  try {
    const res = await apiRequest('/api/backups');
    backups.value = res.backups || res.items || [];
  } catch (err) {
    toast.error('載入備份失敗: ' + err.message);
  } finally {
    loading.value = false;
  }
}

async function createBackup() {
  creating.value = true;
  try {
    await apiRequest('/api/backups', { method: 'POST' });
    toast.success('資料庫備份成功建立！');
    await loadBackups();
  } catch (err) {
    toast.error('建立備份失敗: ' + err.message);
  } finally {
    creating.value = false;
  }
}

async function deleteBackup(id) {
  if (!confirm(`確定要刪除備份檔 ${id} 嗎？此動作無法復原。`)) return;
  try {
    await apiRequest(`/api/backups/${id}`, { method: 'DELETE' });
    toast.success('已刪除備份檔');
    await loadBackups();
  } catch (err) {
    toast.error('刪除失敗: ' + err.message);
  }
}

function formatSize(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
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
.backups-page {
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

.actions-cell {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
