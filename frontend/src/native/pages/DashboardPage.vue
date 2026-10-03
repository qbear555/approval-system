<template>
  <div v-if="isFinanceStaff && stats.pendingFinanceConfirm > 0" class="card" style="background:#ecfdf5;border-color:#6ee7b7;margin-bottom:16px;padding:16px">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
      <div>
        <strong style="color:#065f46;font-size:1.05rem">📊 待財務部授信額度建檔確認（{{ stats.pendingFinanceConfirm }} 筆）</strong>
        <p style="margin:4px 0 0;font-size:0.88rem;color:#047857">
          總經理已完成核定。請於 ERP 完成授信額度設定後，點擊「前往處理」進行建檔確認。
        </p>
      </div>
      <button type="button" class="btn success" style="white-space:nowrap;font-weight:600" @click="go('inbox')">
        前往處理 ({{ stats.pendingFinanceConfirm }})
      </button>
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
      <button type="button" class="btn success" style="white-space:nowrap;font-weight:600" @click="go('inbox')">
        前往確認 ({{ stats.pendingApplicantAck }})
      </button>
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
      <button type="button" class="btn primary" style="white-space:nowrap;font-weight:600" @click="go('inbox')">
        前往確認 ({{ stats.pendingFinalNotify }})
      </button>
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
          :data-ann-slot="Number(ann.slot) || idx"
          @click="openAnn(ann)"
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

  <div class="stats-grid" v-html="statsGridHtml" @click="onStatsClick"></div>

  <div class="card dashboard-pending-card" v-html="pendingCardHtml" @click="onPendingTableClick"></div>

  <div class="card dashboard-common-forms-card">
    <div class="card-head">
      <div style="display:flex;align-items:center;gap:8px">
        <h3 style="margin:0">⭐ 常用申請表單</h3>
        <span class="muted" style="font-size:0.82rem">點擊直接開始填寫</span>
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <button type="button" class="btn outline sm" id="btn-custom-common-forms" title="勾選自訂常用表單" @click="onCustomCommonForms">
          ⚙️ 自訂常用
        </button>
        <button type="button" class="btn outline sm" @click="go('new-request')">
          全部表單 ({{ workflows.length }}) →
        </button>
      </div>
    </div>
    <div v-if="commonForms.length" class="dash-common-grid">
      <div
        v-for="w in commonForms"
        :key="w.id"
        class="dash-form-card"
        :data-dash-wf="w.id"
        role="button"
        tabindex="0"
        :title="`填寫「${w.name}」`"
        @click="onSelectWf(w.id)"
        @keydown.enter.space.prevent="onSelectWf(w.id)"
      >
        <button type="button" class="dash-form-remove" title="從常用表單移除" @click.stop="onRemoveFav(w.id)">✕</button>
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
        <button type="button" class="btn primary sm" id="btn-empty-custom-fav" @click="onCustomCommonForms">＋ 選擇常用表單</button>
        <button type="button" class="btn outline sm" id="btn-empty-reset-fav" @click="onResetFav">恢復預設推薦</button>
      </div>
    </div>
  </div>

  <div class="card">
    <h3>快速開始</h3>
    <div class="form-actions">
      <button type="button" class="btn primary" @click="go('new-request')">＋ 新增申請</button>
      <button v-if="canWf" type="button" class="btn outline" @click="go('workflows')">管理簽核流程</button>
      <button v-if="canBackups" type="button" class="btn outline" @click="go('backups')">備份資料</button>
      <button v-if="isAdmin" type="button" class="btn outline" @click="go('users')">成員權限</button>
      <button v-else-if="canUsers" type="button" class="btn outline" @click="go('users')">成員休假</button>
      <button type="button" class="btn outline" @click="go('inbox')">查看待簽核</button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { L } from '@/native/bridge';

const stats = ref({});
const requests = ref([]);
const announcements = ref([]);
const workflows = ref([]);

const canWf = computed(() => L.hasPerm('workflows'));
const canUsers = computed(() => L.hasPerm('users_leave'));
const canBackups = computed(() => L.hasPerm('backups'));
const isAdmin = computed(() => L.isAdmin());
const isFinanceStaff = computed(() => {
  if (typeof L.isFinanceStaffUser === 'function') return L.isFinanceStaffUser();
  const u = L.state?.user;
  if (!u) return false;
  if (u.department === '財務部') return true;
  if (Array.isArray(u.departments) && u.departments.includes('財務部')) return true;
  return false;
});

async function loadData() {
  try {
    const sData = await L.api('/api/stats');
    stats.value = sData.stats || {};
  } catch {
    stats.value = {};
  }

  try {
    const rData = await L.api('/api/requests?filter=pending_me');
    requests.value = rData.requests || [];
  } catch {
    requests.value = [];
  }

  try {
    const annRes = await L.api('/api/announcement');
    announcements.value = Array.isArray(annRes.announcements)
      ? annRes.announcements
      : annRes.announcement
        ? [annRes.announcement]
        : [];
  } catch {
    announcements.value = [];
  }

  try {
    if (typeof L.loadWorkflows === 'function') {
      workflows.value = await L.loadWorkflows(false);
    } else {
      const wfRes = await L.api('/api/workflows');
      workflows.value = wfRes.workflows || [];
    }
  } catch {
    workflows.value = [];
  }
}

await loadData();

const activeAnnouncements = computed(() => announcements.value.filter((a) => a && a.active));
const pendingList = computed(() => requests.value.slice(0, 4));

const favIds = computed(() => {
  if (typeof L.getFavWorkflowIds === 'function') return L.getFavWorkflowIds(workflows.value);
  return [];
});

const commonForms = computed(() => {
  return favIds.value.map((id) => workflows.value.find((w) => w.id === id)).filter(Boolean);
});

function getWorkflowIcon(name, category) {
  if (typeof L.getWorkflowIcon === 'function') return L.getWorkflowIcon(name, category);
  return '📝';
}

function getCategoryClass(cat) {
  if (typeof L.getCategoryClass === 'function') return L.getCategoryClass(cat);
  return 'cat-default';
}

function go(page, params = {}) {
  if (typeof L.navigate === 'function') L.navigate(page, params);
}

function openAnn(ann) {
  if (typeof L.openAnnouncementModal === 'function') {
    L.openAnnouncementModal(ann);
  }
}

function onSelectWf(id) {
  go('new-request', { workflowId: id });
}

function onRemoveFav(wfId) {
  const curIds = favIds.value.filter((id) => id !== wfId);
  if (typeof L.saveFavWorkflowIds === 'function') L.saveFavWorkflowIds(curIds);
  const w = workflows.value.find((x) => x.id === wfId);
  L.toast(`已將「${w ? w.name : '表單'}」從常用表單移除`, 'info');
  loadData();
}

function onCustomCommonForms() {
  if (typeof L.openCustomizeCommonFormsModal === 'function') {
    L.openCustomizeCommonFormsModal(workflows.value, () => loadData());
  }
}

function onResetFav() {
  if (typeof L.resetFavWorkflowIds === 'function') L.resetFavWorkflowIds();
  L.toast('已恢復系統預設推薦選項', 'success');
  loadData();
}

const statsGridHtml = computed(() => {
  const s = stats.value;
  let html = '';
  if (typeof L.statCardHtml === 'function') {
    html += L.statCardHtml({
      label: '待我簽核',
      value: s.pendingMe ?? 0,
      go: 'inbox',
      hint: '前往待簽核列表',
      tone: 'rose',
    });
    if (isFinanceStaff.value) {
      html += L.statCardHtml({
        label: '待財務建檔',
        value: s.pendingFinanceConfirm ?? 0,
        go: 'inbox',
        hint: '待財務部額度建檔確認',
        tone: 'green',
      });
    }
    if (s.pendingApplicantAck > 0) {
      html += L.statCardHtml({
        label: '待確認建檔',
        value: s.pendingApplicantAck ?? 0,
        go: 'inbox',
        hint: '待您確認財務建檔結果',
        tone: 'teal',
      });
    }
    html += L.statCardHtml({
      label: '我的進行中',
      value: s.minePending ?? 0,
      go: 'mine',
      status: 'pending',
      hint: '查看簽核中的申請',
      tone: 'blue',
    });
    html += L.statCardHtml({
      label: '我已完成',
      value: s.mineDone ?? 0,
      go: 'mine',
      status: 'approved',
      hint: '查看已核准的申請',
      tone: 'purple',
    });
    html += L.statCardHtml({
      label: '啟用中流程',
      value: s.workflows ?? 0,
      go: canWf.value ? 'workflows' : undefined,
      hint: canWf.value ? '管理簽核流程' : '需流程管理權限',
      disabled: !canWf.value,
      tone: 'indigo',
    });
  }
  return html;
});

const pendingCardHtml = computed(() => {
  const btn = pendingList.value.length
    ? '<button type="button" class="btn outline sm" data-go="inbox">查看全部</button>'
    : '';
  const table =
    typeof L.requestTable === 'function'
      ? L.requestTable(pendingList.value, {
          empty: {
            title: '目前沒有待簽核項目',
            desc: '有單據輪到您時會顯示於此。',
            actions: [
              { label: '＋ 新增申請', go: 'new-request', primary: true },
              { label: '我的申請', go: 'mine', outline: true },
            ],
          },
        })
      : '';
  return `
      <div class="card-head">
        <h3>待辦簽核</h3>
        ${btn}
      </div>
      ${table}
  `;
});

function onPendingTableClick(e) {
  const tr = e.target.closest('tr.clickable[data-id]');
  if (tr && tr.dataset.id) {
    go('detail', { id: Number(tr.dataset.id) });
    return;
  }
  const btnGo = e.target.closest('[data-go]');
  if (btnGo && btnGo.dataset.go) {
    const params = {};
    if (btnGo.dataset.status) params.status = btnGo.dataset.status;
    if (btnGo.dataset.id) params.id = Number(btnGo.dataset.id);
    go(btnGo.dataset.go, params);
  }
}

function onStatsClick(e) {
  const btn = e.target.closest('[data-go]');
  if (btn && btn.dataset.go) {
    e.preventDefault();
    const params = {};
    if (btn.dataset.status) params.status = btn.dataset.status;
    if (btn.dataset.id) params.id = Number(btn.dataset.id);
    go(btn.dataset.go, params);
  }
}
</script>
