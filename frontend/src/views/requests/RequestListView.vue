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

      <!-- 待我簽核檢視模式切換器與批次按鈕 -->
      <div v-if="filterType === 'inbox' && allRequests.length" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px">
        <div class="inbox-view-switcher">
          <button type="button" :class="['inbox-view-btn', inboxViewMode === 'table' ? 'active' : '']" @click="setInboxView('table')">
            📋 表格清單
          </button>
          <button type="button" :class="['inbox-view-btn', inboxViewMode === 'split' ? 'active' : '']" @click="setInboxView('split')">
            🖥️ 雙欄審批
          </button>
        </div>
        <div v-if="allowBatchApprove && inboxViewMode === 'table'" class="form-actions" style="margin:0;flex-wrap:wrap;align-items:center;gap:10px">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
            <input type="checkbox" :checked="allVisibleSelected" @change="toggleAll($event.target.checked)" /> 全選
          </label>
          <button type="button" class="btn success sm" :disabled="!selectedIds.length" @click="showBulk = true">
            {{ selectedIds.length ? `✅ 批次核准 (${selectedIds.length} 筆)` : '✅ 批次核准' }}
          </button>
          <span class="muted">已選 {{ selectedIds.length }} 筆</span>
        </div>
      </div>
      <div v-else-if="allowBatchApprove" class="form-actions" style="margin-bottom:12px;flex-wrap:wrap;align-items:center;gap:10px">
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

      <!-- 雙欄審批模式 -->
      <div v-else-if="filterType === 'inbox' && inboxViewMode === 'split' && allRequests.length" class="split-review-container">
        <div class="split-master-pane">
          <div class="split-master-header">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <strong style="color:#1e293b;font-size:0.95rem">待審公文清單</strong>
              <span class="muted" style="font-size:0.82rem">共 {{ filteredPendingRequests.length }} 筆待簽</span>
            </div>
            <input v-model="splitSearch" type="search" class="split-search-input" placeholder="快速搜尋待簽案件…" autocomplete="off" />
          </div>
          <div class="split-cards-list">
            <div
              v-for="r in filteredPendingRequests"
              :key="r.id"
              :class="['split-card', splitSelectedId === r.id ? 'active' : '']"
              @click="selectSplitItem(r.id)"
            >
              <div class="sc-header">
                <span class="sc-id">#{{ r.id }}</span>
                <span class="sc-wf" :title="r.workflow_name">{{ r.workflow_name || '一般簽核' }}</span>
                <span class="sc-time">{{ formatElapsed(r.created_at) }}</span>
              </div>
              <div class="sc-title" :title="r.title">{{ r.title || '（無主旨）' }}</div>
              <div class="sc-footer">
                <span>👤 {{ r.requester_name }}{{ r.requester_dept ? `（${r.requester_dept}）` : '' }}</span>
                <span v-if="r.actingAsProxy" class="tag" style="background:#fef3c7;color:#92400e;font-size:0.75rem">代簽</span>
              </div>
            </div>
            <div v-if="!filteredPendingRequests.length" class="muted" style="padding:24px;text-align:center">
              無符合條件的待審案件
            </div>
          </div>
        </div>
        <div class="split-detail-pane">
          <div ref="splitDetailHost" id="split-detail-host" style="min-height:300px">
            <div class="muted" style="padding:40px;text-align:center">正在載入單據詳情…</div>
          </div>
        </div>
      </div>

      <RequestTable
        v-else
        :items="paged.items"
        :empty-title="emptyTitle"
        :empty-desc="emptyDesc"
        :allow-delete="allowDelete"
        :allow-batch-approve="allowBatchApprove && inboxViewMode === 'table'"
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
import { ref, computed, watch, onMounted, nextTick, onUnmounted } from 'vue';
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
  { v: 'returned', t: '退回修改' },
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

const splitDetailHost = ref(null);
const splitSelectedId = ref(0);
const splitSearch = ref('');
const inboxViewMode = ref(localStorage.getItem('approval_inbox_view') || 'table');

const SCRIPTS = [
  '/vendor/pdfjs/pdf.min.js',
  '/js/tw-calendar.js',
  '/js/rich-editor.js',
  '/js/ui-helpers.js',
  '/js/pdf-form-designer.js',
  '/js/flow-editor.js',
  '/js/app.js',
  '/js/pages-dashboard.js',
  '/js/pages-request-fields.js',
  '/js/pages-request-table.js',
  '/js/pages-request-view.js',
  '/js/pages-request-list.js',
  '/js/pages-request-new.js',
  '/js/pages-request-detail.js',
  '/js/pages-workflows.js',
  '/js/pages-backups.js',
  '/js/pages-leave-report.js',
  '/js/pages-users.js',
  '/js/pages-departments.js',
  '/js/pages-audit.js',
  '/js/pages-settings.js',
  '/js/pages-line.js',
  '/js/pages-system.js',
];

const V = '20261004_split';
function loadLegacyScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src^="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = `${src}?v=${V}`;
    s.async = false;
    s.dataset.legacy = '1';
    s.onload = resolve;
    s.onerror = () => reject(new Error(`載入失敗：${src}`));
    document.body.appendChild(s);
  });
}

let scriptsLoadingPromise = null;
async function ensureDetailScripts() {
  if (window.renderDetailEmbedded) return true;
  if (!scriptsLoadingPromise) {
    scriptsLoadingPromise = (async () => {
      for (const src of SCRIPTS) {
        await loadLegacyScript(src);
      }
      return true;
    })();
  }
  return scriptsLoadingPromise;
}

const filteredPendingRequests = computed(() => {
  if (filterType.value !== 'inbox') return [];
  const list = allRequests.value;
  const kw = (splitSearch.value || '').trim().toLowerCase();
  if (!kw) return list;
  return list.filter((r) => {
    const text = `${r.id} ${r.title || ''} ${r.requester_name || ''} ${r.workflow_name || ''} ${r.requester_dept || ''}`.toLowerCase();
    return text.includes(kw);
  });
});

function formatElapsed(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  if (isNaN(diff) || diff < 0) return '';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `等待 ${Math.max(1, mins)} 分鐘`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `等待 ${hours} 小時`;
  const days = Math.floor(hours / 24);
  return `等待 ${days} 天`;
}

function setInboxView(mode) {
  inboxViewMode.value = mode;
  localStorage.setItem('approval_inbox_view', mode);
  if (mode === 'split') {
    nextTick(() => {
      if (!splitSelectedId.value && filteredPendingRequests.value.length) {
        selectSplitItem(filteredPendingRequests.value[0].id);
      } else if (splitSelectedId.value) {
        mountSelectedDetail(splitSelectedId.value);
      }
    });
  }
}

async function mountSelectedDetail(id) {
  splitSelectedId.value = id;
  if (!id || !splitDetailHost.value) return;
  splitDetailHost.value.innerHTML = '<div class="muted" style="padding:40px;text-align:center">正在載入單據詳情…</div>';
  await ensureDetailScripts();
  if (typeof window.renderDetailEmbedded === 'function') {
    window.renderDetailEmbedded(splitDetailHost.value, id, {
      onActionCompleted: (actedReq) => {
        toast.success(`單據 #${actedReq.id} 已完成簽核！`);
        allRequests.value = allRequests.value.filter((r) => r.id !== actedReq.id);
        const remaining = filteredPendingRequests.value;
        if (remaining.length) {
          selectSplitItem(remaining[0].id);
        } else {
          splitSelectedId.value = 0;
          if (splitDetailHost.value) {
            splitDetailHost.value.innerHTML = `
              <div class="card" style="text-align:center;padding:50px 20px;margin:20px">
                <div style="font-size:3rem;margin-bottom:12px">🎉</div>
                <h3 style="margin:0 0 8px;color:#166534">太棒了！所有待簽核案件已全部處理完畢</h3>
                <p class="muted" style="margin:0 0 16px">您已清空待辦案件。</p>
              </div>
            `;
          }
        }
        if (typeof authStore.fetchStats === 'function') authStore.fetchStats();
      },
    });
  }
}

function selectSplitItem(id) {
  splitSelectedId.value = id;
  mountSelectedDetail(id);
}

function handleKeydown(e) {
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
  if (filterType.value !== 'inbox' || inboxViewMode.value !== 'split') return;
  const list = filteredPendingRequests.value;
  if (!list.length) return;
  if (e.key === 'j' || e.key === 'J' || e.key === 'ArrowDown') {
    const idx = list.findIndex((r) => r.id === splitSelectedId.value);
    if (idx !== -1 && idx < list.length - 1) {
      e.preventDefault();
      selectSplitItem(list[idx + 1].id);
    }
  } else if (e.key === 'k' || e.key === 'K' || e.key === 'ArrowUp') {
    const idx = list.findIndex((r) => r.id === splitSelectedId.value);
    if (idx > 0) {
      e.preventDefault();
      selectSplitItem(list[idx - 1].id);
    }
  }
}

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

  if (filterType.value === 'inbox' && inboxViewMode.value === 'split' && allRequests.value.length) {
    nextTick(() => {
      if (!splitSelectedId.value || !allRequests.value.some((r) => r.id === splitSelectedId.value)) {
        selectSplitItem(allRequests.value[0].id);
      } else {
        mountSelectedDetail(splitSelectedId.value);
      }
    });
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

onMounted(() => {
  loadRequests();
  window.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown);
});
</script>
