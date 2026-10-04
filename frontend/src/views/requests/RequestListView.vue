<template>
  <div class="request-list-page">
    <div v-if="finConfirmList.length" class="card" style="background:#ecfdf5;border-color:#6ee7b7;margin-bottom:16px;padding:16px">
      <div class="card-head" style="margin-bottom:8px">
        <h3 style="color:#065f46;margin:0">📊 待財務部授信額度建檔確認（{{ finConfirmList.length }} 筆）</h3>
      </div>
      <p style="margin:0 0 12px;font-size:0.88rem;color:#047857">
        總經理已完成核定。請於 ERP 完成授信額度設定後，點選單據開啟詳情並點擊「確認完成額度建檔」。
      </p>
      <RequestTable :items="finConfirmList" empty-title="尚無待建檔單據" />
    </div>

    <div v-if="finalNotifyList.length" class="card" style="background:#eff6ff;border-color:#93c5fd;margin-bottom:14px;padding:14px">
      <h3 style="color:#1e40af;margin:0">🔔 最終核准完成通知（{{ finalNotifyList.length }} 筆待您確認收到）</h3>
      <p style="margin:6px 0 0;font-size:0.88rem;color:#1d4ed8">
        請開啟單據後點「確認收到通知」。此為系統內通知，非 Email。
      </p>
    </div>

    <div class="card">
      <p v-if="filterType === 'inbox'" class="muted" style="margin:0 0 12px">
        僅顯示目前待您簽核的單據（含您以<strong>代理人身份可代簽</strong>的待辦，會標示「代簽」）。
      </p>
      <p v-else-if="filterType === 'mine'" class="muted" style="margin:0 0 12px">
        <template v-if="mineStatus">
          僅顯示您本人送出、狀態為<strong>「{{ mineStatusLabel }}」</strong>的申請。
          <router-link to="/mine" class="btn outline sm">查看全部我的申請</router-link>
        </template>
        <template v-else>
          僅顯示您本人送出的申請，以及您<strong>代申請</strong>的單據。
        </template>
        {{ authStore.isAdmin ? '系統管理員可刪除任何狀態的申請單。' : '可刪除尚未核准的單據（已核准不可刪）。' }}
      </p>
      <p v-else class="muted" style="margin:0 0 12px">
        僅顯示與您登入帳號相關的單據（本人申請、待您簽核或您曾簽核）。
        <template v-if="authStore.isAdmin || authStore.hasPerm('records_all')">具備「查看全部」權限者可看所有人單據。</template>
        <template v-if="authStore.isAdmin"> <strong>系統管理員可刪除任何狀態的申請單</strong>（含已核准／駁回／簽核中／已取消）。</template>
      </p>

      <form v-if="showSearch" class="req-filter-bar" style="margin-bottom:14px" @submit.prevent="applyQuery">
        <div class="form-grid two" style="gap:10px">
          <div class="field" style="margin:0">
            <label>關鍵字</label>
            <input v-model="query.q" type="search" placeholder="單號、主旨、申請人、類別…" autocomplete="off" />
          </div>
          <div class="field" style="margin:0">
            <label>申請類別</label>
            <select v-model="query.workflow">
              <option value="">全部類別</option>
              <option v-for="c in categoryOptions" :key="c" :value="c">{{ c }}</option>
            </select>
          </div>
          <div class="field" style="margin:0">
            <label>狀態</label>
            <select v-model="query.status">
              <option v-for="o in statusOpts" :key="o.v" :value="o.v">{{ o.t }}</option>
            </select>
          </div>
          <div class="field" style="margin:0">
            <label>更新日期（起～迄）</label>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <input v-model="query.dateFrom" type="date" style="flex:1;min-width:120px" />
              <span class="muted">～</span>
              <input v-model="query.dateTo" type="date" style="flex:1;min-width:120px" />
            </div>
          </div>
        </div>
        <div class="form-actions" style="margin-top:10px;flex-wrap:wrap">
          <button type="submit" class="btn primary sm">查詢</button>
          <button type="button" class="btn outline sm" @click="clearQuery">清除條件</button>
          <button type="button" class="btn outline sm" :disabled="exportBusy" @click="exportExcel">
            {{ exportBusy ? '匯出中…' : '匯出 Excel' }}
          </button>
          <span class="muted" style="font-size:0.85rem">共 <strong>{{ paged.total }}</strong> 筆{{ paged.pages > 1 ? '，每頁 20 筆' : '' }}</span>
        </div>
      </form>

      <div v-if="allowBatchApprove" class="form-actions" style="margin-bottom:12px;flex-wrap:wrap;align-items:center;gap:10px">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
          <input type="checkbox" :checked="allVisibleSelected" @change="toggleAll($event.target.checked)" /> 全選
        </label>
        <button type="button" class="btn success sm" :disabled="!selectedIds.length" @click="showBulk = true">
          {{ selectedIds.length ? `✅ 批次核准 (${selectedIds.length} 筆)` : '✅ 批次核准' }}
        </button>
        <span class="muted">已選 {{ selectedIds.length }} 筆</span>
      </div>
      <div v-else-if="anyDeletable" class="form-actions" style="margin-bottom:12px;flex-wrap:wrap">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
          <input type="checkbox" :checked="allVisibleSelected" @change="toggleAll($event.target.checked)" /> 全選
        </label>
        <button type="button" class="btn danger sm" @click="bulkDelete">刪除選取</button>
        <span class="muted">已選 {{ selectedIds.length }} 筆</span>
      </div>

      <div v-if="loading" class="muted" style="padding:24px;text-align:center">載入簽核案件中...</div>
      <RequestTable
        v-else
        :items="paged.items"
        :empty-title="emptyTitle"
        :empty-desc="emptyDesc"
        :allow-delete="allowDelete"
        :allow-batch-approve="allowBatchApprove"
        :admin-mode="adminMode"
        :selected-ids="selectedIds"
        :is-admin="authStore.isAdmin"
        :has-leave-delete="authStore.hasPerm('leave_delete')"
        :has-records-delete="authStore.hasPerm('records_delete')"
        :user-id="authStore.user?.id"
        @select="selectedIds = $event"
        @delete="deleteOne"
      >
        <template #actions>
          <button v-if="hasActiveQuery" type="button" class="btn outline" @click="clearQuery">清除條件</button>
          <router-link v-if="mineStatus" to="/mine" class="btn outline">查看全部我的申請</router-link>
          <router-link v-if="filterType !== 'inbox' || !hasActiveQuery" to="/new-request" class="btn primary">＋ 新增申請</router-link>
          <router-link v-if="filterType === 'inbox' && !hasActiveQuery" to="/dashboard" class="btn outline">回總覽</router-link>
          <router-link v-if="filterType === 'records' && !hasActiveQuery" to="/inbox" class="btn outline">查看待簽核</router-link>
        </template>
      </RequestTable>

      <div v-if="showSearch && paged.pages > 1" class="form-actions" style="margin-top:14px;justify-content:center;gap:8px">
        <button type="button" class="btn outline sm" :disabled="paged.page <= 1" @click="goPage(paged.page - 1)">上一頁</button>
        <span class="muted">第 {{ paged.page }} / {{ paged.pages }} 頁</span>
        <button type="button" class="btn outline sm" :disabled="paged.page >= paged.pages" @click="goPage(paged.page + 1)">下一頁</button>
      </div>
    </div>

    <div v-if="showBulk" class="modal">
      <div class="modal-backdrop" @click="showBulk = false"></div>
      <div class="modal-panel" style="max-width:580px;width:100%">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h3 style="margin:0;font-size:1.25rem">✅ 批次簽核核准（共 {{ selectedRequests.length }} 筆）</h3>
          <button type="button" class="btn ghost sm" @click="showBulk = false">✕</button>
        </div>
        <div style="margin-bottom:14px;max-height:180px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;padding:8px 12px;background:#f8fafc">
          <div
            v-for="r in selectedRequests"
            :key="r.id"
            style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--border);font-size:0.9rem"
          >
            <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-right:12px">
              <strong>#{{ r.id }}</strong>
              <span style="margin:0 4px;color:var(--muted)">|</span>
              <span>{{ r.title }}</span>
            </div>
            <div class="muted" style="white-space:nowrap">{{ r.requester_name }} · {{ r.workflow_name }}</div>
          </div>
        </div>
        <div class="field" style="margin-bottom:14px">
          <label style="font-weight:600;display:block;margin-bottom:6px">簽核意見</label>
          <div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">
            <button v-for="op in bulkPhrases" :key="op" type="button" class="btn outline xs" @click="bulkComment = op">{{ op }}</button>
          </div>
          <textarea v-model="bulkComment" rows="3" style="width:100%;box-sizing:border-box" placeholder="請輸入批次簽核意見…"></textarea>
        </div>
        <p class="muted" style="font-size:0.85rem;background:#eff6ff;padding:10px 12px;border-radius:6px;margin-bottom:16px;border-left:4px solid #3b82f6">
          💡 若選取單據包含需填寫專屬欄位的關卡，系統將安全略過並主動提示。
        </p>
        <div class="form-actions" style="justify-content:flex-end;gap:10px;margin:0">
          <button type="button" class="btn outline" @click="showBulk = false">取消</button>
          <button type="button" class="btn success" :disabled="bulkBusy" @click="confirmBulkApprove">
            {{ bulkBusy ? '核准處理中…' : `確認核准 (${selectedRequests.length} 筆)` }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { apiRequest } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { useSystemStore } from '@/stores/system';
import { useToastStore } from '@/stores/toast';
import { normalizeRequestStatus, statusLabel } from '@/lib/status';
import { resolveCommentPhrases } from '@/lib/comment-phrases';
import { canDeleteRequestRow } from '@/lib/request-access';
import RequestTable from '@/components/requests/RequestTable.vue';

const PAGE_SIZE = 20;
const statusOpts = [
  { v: '', t: '全部狀態' },
  { v: 'pending', t: '簽核中' },
  { v: 'approved', t: '已核准' },
  { v: 'rejected', t: '已駁回' },
  { v: 'cancelled', t: '已取消' },
  { v: 'voided', t: '已作廢' },
  { v: 'draft', t: '草稿' },
];

const route = useRoute();
const authStore = useAuthStore();
const systemStore = useSystemStore();
const toast = useToastStore();

const loading = ref(true);
const allRequests = ref([]);
const categories = ref([]);
const selectedIds = ref([]);
const finConfirmList = ref([]);
const query = ref({ q: '', workflow: '', status: '', dateFrom: '', dateTo: '', page: 1 });
const showBulk = ref(false);
const bulkComment = ref('同意');
const bulkBusy = ref(false);
const exportBusy = ref(false);
const bulkPhrases = ref(resolveCommentPhrases(authStore.user));

const filterType = computed(() => {
  if (route.name === 'Inbox') return 'inbox';
  if (route.name === 'Mine') return 'mine';
  return 'records';
});

const apiFilter = computed(() => {
  if (filterType.value === 'inbox') return 'pending_me';
  if (filterType.value === 'mine') return 'mine';
  return 'related';
});

const showSearch = computed(() => filterType.value === 'records');
const mineStatus = computed(() => (filterType.value === 'mine' ? normalizeRequestStatus(route.query.status) : ''));
const mineStatusLabel = computed(() => (mineStatus.value ? statusLabel(mineStatus.value) : ''));

const hasActiveQuery = computed(() =>
  showSearch.value && !!(query.value.q || query.value.workflow || query.value.status || query.value.dateFrom || query.value.dateTo)
);

const adminMode = computed(() => {
  const f = apiFilter.value;
  return (authStore.isAdmin || authStore.hasPerm('records_delete') || authStore.hasPerm('leave_delete'))
    && (f === 'related' || f === 'all' || f === 'done' || f === 'mine');
});

const allowDelete = computed(() => {
  const f = apiFilter.value;
  return f === 'mine' || adminMode.value || authStore.hasPerm('leave_delete') || authStore.isAdmin;
});

function rowDeletable(r) {
  return canDeleteRequestRow(r, {
    isAdmin: authStore.isAdmin,
    hasLeaveDelete: authStore.hasPerm('leave_delete'),
    hasRecordsDelete: authStore.hasPerm('records_delete'),
    userId: authStore.user?.id,
    adminMode: adminMode.value,
  });
}

const anyDeletable = computed(() => allowDelete.value && allRequests.value.some(rowDeletable));
const allowBatchApprove = computed(() => apiFilter.value === 'pending_me' && allRequests.value.length > 0);

const paged = computed(() => {
  const list = allRequests.value;
  if (!showSearch.value) {
    return { page: 1, pages: 1, total: list.length, items: list };
  }
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE) || 1);
  const page = Math.min(pages, Math.max(1, Number(query.value.page) || 1));
  const start = (page - 1) * PAGE_SIZE;
  return { page, pages, total: list.length, items: list.slice(start, start + PAGE_SIZE) };
});

const categoryOptions = computed(() => {
  const set = new Set(categories.value);
  for (const r of allRequests.value) {
    if (r.workflow_name) set.add(String(r.workflow_name));
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
});

const selectedRequests = computed(() => allRequests.value.filter((r) => selectedIds.value.includes(Number(r.id))));
const allVisibleSelected = computed(() => {
  const ids = paged.value.items.filter((r) => allowBatchApprove.value || rowDeletable(r)).map((r) => Number(r.id));
  return ids.length > 0 && ids.every((id) => selectedIds.value.includes(id));
});

const finalNotifyList = computed(() =>
  apiFilter.value === 'pending_me' ? allRequests.value.filter((r) => r.needsFinalNotifyAck) : []
);

const emptyTitle = computed(() => {
  if (apiFilter.value === 'pending_me') return hasActiveQuery.value ? '沒有符合條件的待簽核' : '目前沒有待您簽核的單據';
  if (apiFilter.value === 'mine') {
    if (mineStatus.value) return `目前沒有${mineStatusLabel.value}的申請`;
    return hasActiveQuery.value ? '沒有符合條件的申請' : '尚無我的申請';
  }
  return hasActiveQuery.value ? '沒有符合條件的紀錄' : '尚無相關簽核紀錄';
});

const emptyDesc = computed(() => {
  if (apiFilter.value === 'pending_me') {
    return hasActiveQuery.value ? '請調整查詢條件後再試。' : '新申請送達且輪到您時會出現在此。您也可以主動提出新申請。';
  }
  if (apiFilter.value === 'mine') {
    if (mineStatus.value) return `沒有狀態為「${mineStatusLabel.value}」的申請。可查看全部我的申請，或新增一筆。`;
    return hasActiveQuery.value ? '請調整查詢條件後再試。' : '您還沒有申請或草稿。可從「新增申請」填寫並「儲存草稿」或「送出申請」。';
  }
  return hasActiveQuery.value ? '請調整申請類別、狀態、日期或關鍵字後再查詢。' : '與您有關的申請、待簽或曾簽核的單據會列在這裡。';
});

async function loadRequests() {
  loading.value = true;
  selectedIds.value = [];
  const params = new URLSearchParams({ filter: apiFilter.value });
  if (showSearch.value) {
    if (query.value.q) params.set('q', query.value.q);
    if (query.value.workflow) params.set('workflow', query.value.workflow);
    if (query.value.status) params.set('status', query.value.status);
    if (query.value.dateFrom) params.set('dateFrom', query.value.dateFrom);
    if (query.value.dateTo) params.set('dateTo', query.value.dateTo);
  } else if (mineStatus.value) {
    params.set('status', mineStatus.value);
  }

  try {
    const data = await apiRequest(`/api/requests?${params.toString()}`);
    allRequests.value = data.requests || [];
    categories.value = Array.isArray(data.categories) ? data.categories : [];
  } catch (err) {
    toast.error('載入簽核列表失敗: ' + err.message);
    allRequests.value = [];
  } finally {
    loading.value = false;
  }

  finConfirmList.value = [];
  if (apiFilter.value === 'pending_me' && authStore.isFinanceStaff) {
    try {
      const finRes = await apiRequest('/api/requests?filter=pending_finance_confirm');
      finConfirmList.value = finRes.requests || [];
    } catch {
      finConfirmList.value = [];
    }
  }

  systemStore.fetchStats();
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function exportExcel() {
  exportBusy.value = true;
  try {
    const blob = await apiRequest('/api/reports/requests-export', {
      method: 'POST',
      body: {
        q: query.value.q,
        workflow: query.value.workflow,
        status: query.value.status,
        dateFrom: query.value.dateFrom,
        dateTo: query.value.dateTo,
        kind: 'all',
      },
      expectBlob: true,
    });
    const range =
      query.value.dateFrom || query.value.dateTo
        ? `_${query.value.dateFrom || '起'}_${query.value.dateTo || '迄'}`
        : '';
    downloadBlob(blob, `單據報表${range}.xlsx`);
    toast.success('Excel 已開始下載');
  } catch (err) {
    toast.error(err.message || '匯出失敗');
  } finally {
    exportBusy.value = false;
  }
}

function applyQuery() {
  query.value.page = 1;
  loadRequests();
}

function clearQuery() {
  query.value = { q: '', workflow: '', status: '', dateFrom: '', dateTo: '', page: 1 };
  loadRequests();
}

function goPage(page) {
  query.value.page = page;
}

function toggleAll(checked) {
  const ids = paged.value.items
    .filter((r) => (allowBatchApprove.value && r.status === 'pending') || rowDeletable(r))
    .map((r) => Number(r.id));
  if (checked) selectedIds.value = [...new Set([...selectedIds.value, ...ids])];
  else selectedIds.value = selectedIds.value.filter((id) => !ids.includes(id));
}

async function deleteOne(r) {
  if (!rowDeletable(r)) {
    toast.error(r.approver_signed || r.can_delete === false ? '下一位簽署人已簽核，此申請單無法刪除' : '此申請單不可刪除');
    return;
  }
  const adminWarn = authStore.isAdmin ? '\n（系統管理員：將永久刪除此單，含已簽核／任何狀態）' : '';
  if (!confirm(`確定刪除申請 #${r.id}${r.title ? `「${r.title}」` : ''}？\n將永久刪除單據、歷程、附件與相關備份，無法復原。${adminWarn}`)) {
    return;
  }
  try {
    await apiRequest(`/api/requests/${r.id}`, { method: 'DELETE' });
    toast.success('已刪除申請');
    await loadRequests();
  } catch (err) {
    toast.error(err.message);
  }
}

async function bulkDelete() {
  if (!selectedIds.value.length) {
    toast.error('請先勾選要刪除的紀錄');
    return;
  }
  const adminWarn = authStore.isAdmin ? '\n（系統管理員：將永久刪除選取的所有單據，含已核准／任何狀態）' : '';
  if (!confirm(`確定刪除選取的 ${selectedIds.value.length} 筆簽核申請？\n將永久刪除單據、歷程、附件與備份，無法復原。${adminWarn}`)) {
    return;
  }
  try {
    const data = await apiRequest('/api/requests/bulk-delete', {
      method: 'POST',
      body: { ids: selectedIds.value },
    });
    toast.success(data.message || '已批次刪除');
    await loadRequests();
  } catch (err) {
    toast.error(err.message);
  }
}

async function confirmBulkApprove() {
  bulkBusy.value = true;
  try {
    const res = await apiRequest('/api/requests/bulk-approve', {
      method: 'POST',
      body: { ids: selectedIds.value, comment: (bulkComment.value || '').trim() },
    });
    showBulk.value = false;
    if (res.failureCount > 0) {
      const failMsg = (res.failures || []).map((f) => `• #${f.id} (${f.title || ''}): ${f.error}`).join('\n');
      toast.info(`已核准 ${res.successCount} 筆，${res.failureCount} 筆需個別開啟審核`);
      alert(`批次簽核結果：\n\n成功核准：${res.successCount} 筆\n需個別審核：${res.failureCount} 筆\n\n${failMsg}`);
    } else {
      toast.success(`已成功批次核准 ${res.successCount} 筆單據！`);
    }
    await loadRequests();
  } catch (err) {
    toast.error(err.message || '批次簽核失敗');
  } finally {
    bulkBusy.value = false;
  }
}

watch(showBulk, async (open) => {
  if (!open) return;
  try {
    const res = await apiRequest('/api/me/comment-phrases');
    if (Array.isArray(res.phrases) && res.phrases.length) {
      bulkPhrases.value = res.phrases;
      if (authStore.user) authStore.user.comment_phrases = res.phrases;
    }
  } catch {
    bulkPhrases.value = resolveCommentPhrases(authStore.user);
  }
});

watch(
  () => [route.name, route.query.status],
  () => {
    query.value = { q: '', workflow: '', status: '', dateFrom: '', dateTo: '', page: 1 };
    loadRequests();
  }
);

onMounted(loadRequests);
</script>
