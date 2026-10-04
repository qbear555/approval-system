<template>
  <div class="dashboard-page">
    <div v-if="authStore.isFinanceStaff && stats.pendingFinanceConfirm > 0" class="card" style="background:#ecfdf5;border-color:#6ee7b7;margin-bottom:16px;padding:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
        <div>
          <strong style="color:#065f46;font-size:1.05rem">📊 待財務部授信額度建檔確認（{{ stats.pendingFinanceConfirm }} 筆）</strong>
          <p style="margin:4px 0 0;font-size:0.88rem;color:#047857">
            總經理已完成核定。請於 ERP 完成授信額度設定後，點擊「前往處理」進行建檔確認。
          </p>
        </div>
        <router-link to="/inbox" class="btn success" style="white-space:nowrap;font-weight:600">
          前往處理 ({{ stats.pendingFinanceConfirm }})
        </router-link>
      </div>
    </div>

    <div v-if="stats.pendingApplicantAck > 0" class="card" style="background:#f0fdf4;border-color:#86efac;margin-bottom:16px;padding:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
        <div>
          <strong style="color:#166534;font-size:1.05rem">📊 財務部已完成授信額度建檔（{{ stats.pendingApplicantAck }} 筆待您確認）</strong>
          <p style="margin:4px 0 0;font-size:0.88rem;color:#15803d">
            財務部已完成您申請的授信額度建檔。請點擊「前往確認」並點選「我知道了」。
          </p>
        </div>
        <router-link to="/inbox" class="btn success" style="white-space:nowrap;font-weight:600">
          前往確認 ({{ stats.pendingApplicantAck }})
        </router-link>
      </div>
    </div>

    <div v-if="stats.pendingFinalNotify > 0" class="card" style="background:#eff6ff;border-color:#93c5fd;margin-bottom:16px;padding:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
        <div>
          <strong style="color:#1e40af;font-size:1.05rem">🔔 最終核准通知（{{ stats.pendingFinalNotify }} 筆待確認）</strong>
          <p style="margin:4px 0 0;font-size:0.88rem;color:#1d4ed8">
            有申請單已最終核准。請假相關請<strong>設定 Email 自動回覆</strong>後，開啟單據點確認。
          </p>
        </div>
        <router-link to="/inbox" class="btn primary" style="white-space:nowrap;font-weight:600">
          前往確認 ({{ stats.pendingFinalNotify }})
        </router-link>
      </div>
    </div>

    <div v-if="activeAnnouncements.length" class="card announcement-card">
      <div class="announcement-card-title">
        <span class="announcement-card-bar" aria-hidden="true"></span>
        公告
      </div>
      <ol class="announcement-list">
        <li v-for="(ann, idx) in activeAnnouncements" :key="ann.slot || idx" class="announcement-list-item">
          <button
            type="button"
            class="announcement-open ann-item"
            :class="`ann-item-${(idx % 2) + 1}`"
            @click="openAnn = ann"
          >
            <span v-if="activeAnnouncements.length > 1" class="ann-item-badge" aria-hidden="true">{{ idx + 1 }}</span>
            <div class="ann-item-body">
              <strong class="ann-item-title">{{ ann.title || '公司公告' }}</strong>
              <p v-if="ann.body" class="ann-item-text">{{ ann.body }}</p>
            </div>
            <span class="btn outline sm ann-item-btn">查看</span>
          </button>
        </li>
      </ol>
    </div>

    <div class="stats-grid">
      <button type="button" class="stat-card stat-card-clickable stat-card-rose" @click="router.push('/inbox')">
        <div class="label">待我簽核</div>
        <div class="value">{{ stats.pendingMe ?? 0 }}</div>
        <div class="stat-hint">前往待簽核列表</div>
      </button>
      <button
        v-if="authStore.isFinanceStaff"
        type="button"
        class="stat-card stat-card-clickable stat-card-green"
        @click="router.push('/inbox')"
      >
        <div class="label">待財務建檔</div>
        <div class="value">{{ stats.pendingFinanceConfirm ?? 0 }}</div>
        <div class="stat-hint">待財務部額度建檔確認</div>
      </button>
      <button
        v-if="stats.pendingApplicantAck > 0"
        type="button"
        class="stat-card stat-card-clickable stat-card-teal"
        @click="router.push('/inbox')"
      >
        <div class="label">待確認建檔</div>
        <div class="value">{{ stats.pendingApplicantAck ?? 0 }}</div>
        <div class="stat-hint">待您確認財務建檔結果</div>
      </button>
      <button type="button" class="stat-card stat-card-clickable stat-card-blue" @click="router.push({ path: '/mine', query: { status: 'pending' } })">
        <div class="label">我的進行中</div>
        <div class="value">{{ stats.minePending ?? 0 }}</div>
        <div class="stat-hint">查看簽核中的申請</div>
      </button>
      <button type="button" class="stat-card stat-card-clickable stat-card-purple" @click="router.push({ path: '/mine', query: { status: 'approved' } })">
        <div class="label">我已完成</div>
        <div class="value">{{ stats.mineDone ?? 0 }}</div>
        <div class="stat-hint">查看已核准的申請</div>
      </button>
      <component
        :is="authStore.hasPerm('workflows') ? 'button' : 'div'"
        type="button"
        class="stat-card stat-card-indigo"
        :class="authStore.hasPerm('workflows') ? 'stat-card-clickable' : 'stat-card-disabled'"
        @click="authStore.hasPerm('workflows') && router.push('/workflows')"
      >
        <div class="label">啟用中流程</div>
        <div class="value">{{ stats.workflows ?? 0 }}</div>
        <div class="stat-hint">{{ authStore.hasPerm('workflows') ? '管理簽核流程' : '需流程管理權限' }}</div>
      </component>
    </div>

    <div class="card dashboard-pending-card">
      <div class="card-head">
        <h3>待辦簽核</h3>
        <router-link v-if="pendingList.length" to="/inbox" class="btn outline sm">查看全部</router-link>
      </div>
      <RequestTable
        :items="pendingList"
        empty-title="目前沒有待簽核項目"
        empty-desc="有單據輪到您時會顯示於此。"
      >
        <template #actions>
          <router-link to="/new-request" class="btn primary">＋ 新增申請</router-link>
          <router-link to="/mine" class="btn outline">我的申請</router-link>
        </template>
      </RequestTable>
    </div>

    <div class="card dashboard-common-forms-card">
      <div class="card-head">
        <div style="display:flex;align-items:center;gap:8px">
          <h3 style="margin:0">⭐ 常用申請表單</h3>
          <span class="muted" style="font-size:0.82rem">點擊直接開始填寫</span>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          <button type="button" class="btn outline sm" title="勾選自訂常用表單" @click="showFavModal = true">⚙️ 自訂常用</button>
          <router-link to="/new-request" class="btn outline sm">全部表單 ({{ workflows.length }}) →</router-link>
        </div>
      </div>
      <div v-if="commonForms.length" class="dash-common-grid">
        <div
          v-for="w in commonForms"
          :key="w.id"
          class="dash-form-card"
          role="button"
          tabindex="0"
          :title="`填寫「${w.name}」`"
          @click="router.push({ path: '/new-request', query: { workflowId: String(w.id) } })"
          @keydown.enter.space.prevent="router.push({ path: '/new-request', query: { workflowId: String(w.id) } })"
        >
          <button type="button" class="dash-form-remove" title="從常用表單移除" @click.stop="removeFav(w)">✕</button>
          <div class="dash-form-icon" :class="getCategoryClass(w.category)">{{ getWorkflowIcon(w.name, w.category) }}</div>
          <div class="dash-form-info">
            <div class="dash-form-name">{{ w.name }}</div>
            <div class="dash-form-cat">
              <span class="catalog-category-tag" :class="getCategoryClass(w.category)">{{ w.category || '一般簽呈' }}</span>
            </div>
          </div>
          <span class="dash-form-arrow" aria-hidden="true">→</span>
        </div>
      </div>
      <div v-else class="dash-common-empty" style="text-align:center;padding:24px 16px;background:#f8fafc;border:1px dashed var(--border);border-radius:10px;margin-top:10px">
        <div style="font-size:1.6rem;margin-bottom:6px">📋</div>
        <div style="font-weight:600;color:var(--text-heading);margin-bottom:4px">尚未設定常用申請表單</div>
        <p class="muted" style="font-size:0.85rem;margin:0 0 12px">您可以自行挑選最常使用的表單，建立專屬快捷清單。</p>
        <div style="display:flex;justify-content:center;gap:8px">
          <button type="button" class="btn primary sm" @click="showFavModal = true">＋ 選擇常用表單</button>
          <button type="button" class="btn outline sm" @click="resetFav">恢復預設推薦</button>
        </div>
      </div>
    </div>

    <div class="card">
      <h3>快速開始</h3>
      <div class="form-actions">
        <router-link to="/new-request" class="btn primary">＋ 新增申請</router-link>
        <router-link v-if="authStore.hasPerm('workflows')" to="/workflows" class="btn outline">管理簽核流程</router-link>
        <router-link v-if="authStore.hasPerm('backups')" to="/backups" class="btn outline">備份資料</router-link>
        <router-link v-if="authStore.isAdmin" to="/users" class="btn outline">成員權限</router-link>
        <router-link v-else-if="authStore.hasPerm('users_leave')" to="/users" class="btn outline">成員休假</router-link>
        <router-link to="/inbox" class="btn outline">查看待簽核</router-link>
      </div>
    </div>

    <div v-if="openAnn" class="modal" @click.self="openAnn = null">
      <div class="modal-backdrop" @click="openAnn = null"></div>
      <div class="modal-panel" style="max-width:560px;width:100%">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <h3 style="margin:0">{{ openAnn.title || '公司公告' }}</h3>
          <button type="button" class="btn ghost sm" @click="openAnn = null">✕</button>
        </div>
        <p style="white-space:pre-wrap;line-height:1.6">{{ openAnn.body || '（無內容）' }}</p>
        <div class="form-actions" style="justify-content:flex-end">
          <button type="button" class="btn primary" @click="openAnn = null">關閉</button>
        </div>
      </div>
    </div>

    <div v-if="showFavModal" class="modal">
      <div class="modal-backdrop" @click="showFavModal = false"></div>
      <div class="modal-panel" style="max-width:560px;width:100%">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <h3 style="margin:0">⭐ 自訂常用申請表單</h3>
          <button type="button" class="btn ghost sm" @click="showFavModal = false">✕</button>
        </div>
        <p class="muted" style="margin:0 0 12px;font-size:0.85rem">勾選您平時最常送出的表單，將置頂顯示於「總覽」常用表單區。</p>
        <input v-model="favSearch" type="search" placeholder="🔍 搜尋表單名稱或分類..." style="width:100%;margin-bottom:10px" />
        <div style="max-height:360px;overflow-y:auto;border:1px solid var(--border);border-radius:10px;padding:6px">
          <label
            v-for="w in filteredWorkflows"
            :key="w.id"
            style="display:flex;align-items:center;gap:8px;padding:8px;border-radius:8px;cursor:pointer"
          >
            <input type="checkbox" :checked="draftFavIds.includes(w.id)" @change="toggleFavDraft(w.id, $event.target.checked)" />
            <span>{{ getWorkflowIcon(w.name, w.category) }}</span>
            <span style="flex:1">{{ w.name }}</span>
            <span class="muted" style="font-size:0.8rem">{{ w.category || '一般簽呈' }}</span>
          </label>
        </div>
        <div class="form-actions" style="justify-content:space-between;margin-top:14px">
          <button type="button" class="btn outline sm" @click="resetFav">恢復系統預設推薦</button>
          <div style="display:flex;gap:8px">
            <button type="button" class="btn outline" @click="showFavModal = false">取消</button>
            <button type="button" class="btn primary" @click="saveFav">儲存</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import { apiRequest } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { useSystemStore } from '@/stores/system';
import { useToastStore } from '@/stores/toast';
import { getWorkflowIcon, getCategoryClass } from '@/lib/format';
import { getFavWorkflowIds, saveFavWorkflowIds, resetFavWorkflowIds } from '@/lib/favorites';
import RequestTable from '@/components/requests/RequestTable.vue';

const router = useRouter();
const authStore = useAuthStore();
const systemStore = useSystemStore();
const toast = useToastStore();

const stats = ref({});
const requests = ref([]);
const announcements = ref([]);
const workflows = ref([]);
const openAnn = ref(null);
const showFavModal = ref(false);
const favSearch = ref('');
const draftFavIds = ref([]);
const favTick = ref(0);

const activeAnnouncements = computed(() => announcements.value.filter((a) => a && a.active));
const pendingList = computed(() => requests.value.slice(0, 4));

const commonForms = computed(() => {
  favTick.value;
  const ids = getFavWorkflowIds(authStore.user?.id, workflows.value);
  return ids.map((id) => workflows.value.find((w) => w.id === id)).filter(Boolean);
});

const filteredWorkflows = computed(() => {
  const q = favSearch.value.trim().toLowerCase();
  const list = [...workflows.value].sort(
    (a, b) => String(a.category || '').localeCompare(String(b.category || ''), 'zh-Hant')
      || String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hant')
  );
  if (!q) return list;
  return list.filter((w) => `${w.name} ${w.category || ''}`.toLowerCase().includes(q));
});

watch(showFavModal, (open) => {
  if (open) {
    draftFavIds.value = getFavWorkflowIds(authStore.user?.id, workflows.value);
    favSearch.value = '';
  }
});

async function loadData() {
  try {
    const sData = await apiRequest('/api/stats');
    stats.value = sData.stats || {};
    systemStore.stats = stats.value;
    systemStore.pendingCount = Number(stats.value.pendingMe || 0);
  } catch {
    stats.value = {};
  }

  try {
    const rData = await apiRequest('/api/requests?filter=pending_me');
    requests.value = rData.requests || [];
  } catch {
    requests.value = [];
  }

  try {
    const annRes = await apiRequest('/api/announcement');
    announcements.value = Array.isArray(annRes.announcements)
      ? annRes.announcements
      : annRes.announcement
        ? [annRes.announcement]
        : [];
  } catch {
    announcements.value = [];
  }

  try {
    const wfRes = await apiRequest('/api/workflows');
    workflows.value = wfRes.workflows || [];
  } catch {
    workflows.value = [];
  }
}

function removeFav(w) {
  const cur = getFavWorkflowIds(authStore.user?.id, workflows.value).filter((id) => id !== w.id);
  saveFavWorkflowIds(authStore.user?.id, cur);
  favTick.value += 1;
  toast.info(`已將「${w.name}」從常用表單移除`);
}

function resetFav() {
  resetFavWorkflowIds(authStore.user?.id);
  draftFavIds.value = getFavWorkflowIds(authStore.user?.id, workflows.value);
  favTick.value += 1;
  toast.success('已恢復系統預設推薦');
}

function toggleFavDraft(id, checked) {
  if (checked) {
    if (!draftFavIds.value.includes(id)) draftFavIds.value = [...draftFavIds.value, id];
  } else {
    draftFavIds.value = draftFavIds.value.filter((x) => x !== id);
  }
}

function saveFav() {
  saveFavWorkflowIds(authStore.user?.id, draftFavIds.value);
  favTick.value += 1;
  showFavModal.value = false;
  toast.success('已更新常用申請表單');
}

onMounted(loadData);
</script>
