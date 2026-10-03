<template>
  <div v-if="finConfirmCardHtml" v-html="finConfirmCardHtml" @click="onCardClick"></div>
  <div v-if="finalNotifyListBanner" v-html="finalNotifyListBanner"></div>
  <div class="card" v-html="cardHtml" @click="onCardClick"></div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUpdated } from 'vue';
import { L } from '@/native/bridge';

const props = defineProps({
  params: { type: Object, default: () => ({}) },
  page: { type: String, default: 'inbox' },
});

const filter = computed(() => {
  if (props.page === 'inbox') return 'pending_me';
  if (props.page === 'mine') return 'mine';
  return 'related';
});

const showSearch = computed(() => {
  const f = filter.value;
  return f === 'related' || f === 'all' || f === 'done';
});

const mineStatus = computed(() => {
  if (filter.value !== 'mine') return '';
  const s = props.params?.status;
  if (typeof L.normalizeRequestStatus === 'function') return L.normalizeRequestStatus(s);
  return s || '';
});

const mineStatusLabel = computed(() => {
  if (!mineStatus.value) return '';
  const STATUS = L.STATUS || {};
  return STATUS[mineStatus.value]?.label || mineStatus.value;
});

const prevQuery = (L.state?.requestListQuery && L.state.requestListQuery._filter === filter.value)
  ? L.state.requestListQuery
  : {};

const query = reactive({
  q: showSearch.value ? (prevQuery.q || '') : '',
  workflow: showSearch.value ? (prevQuery.workflow || '') : '',
  status: showSearch.value ? (prevQuery.status || '') : '',
  dateFrom: showSearch.value ? (prevQuery.dateFrom || '') : '',
  dateTo: showSearch.value ? (prevQuery.dateTo || '') : '',
  page: showSearch.value && Number(prevQuery.page) > 0 ? Number(prevQuery.page) : 1,
});

const statusOpts = [
  { v: '', t: '全部狀態' },
  { v: 'pending', t: '簽核中' },
  { v: 'approved', t: '已核准' },
  { v: 'rejected', t: '已駁回' },
  { v: 'cancelled', t: '已取消' },
  { v: 'voided', t: '已作廢' },
  { v: 'draft', t: '草稿' },
];

const allRequests = ref([]);
const requests = ref([]);
const categories = ref([]);
const paged = ref({ page: 1, pages: 1, total: 0, pageSize: 20, items: [] });
const finConfirmCardHtml = ref('');
const finalNotifyListBanner = ref('');
const selectedIds = ref([]);

const categoryOptions = computed(() => {
  const set = new Set(categories.value);
  for (const r of allRequests.value) {
    if (r.workflow_name) set.add(String(r.workflow_name));
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
});

const adminMode = computed(() => {
  const f = filter.value;
  const isAdm = L.isAdmin();
  const canDelRec = typeof L.canDeleteRecordsPerm === 'function' ? L.canDeleteRecordsPerm() : false;
  const canDelLeave = typeof L.canDeleteLeavePerm === 'function' ? L.canDeleteLeavePerm() : false;
  return (isAdm || canDelRec || canDelLeave) && (f === 'related' || f === 'all' || f === 'done' || f === 'mine');
});

const allowDelete = computed(() => {
  const f = filter.value;
  const canDelLeave = typeof L.canDeleteLeavePerm === 'function' ? L.canDeleteLeavePerm() : false;
  return f === 'mine' || adminMode.value || canDelLeave || L.isAdmin();
});

const anyDeletable = computed(() => {
  if (!allowDelete.value) return false;
  return allRequests.value.some((r) => {
    if (typeof L.canDeleteRequestRow === 'function') {
      return L.canDeleteRequestRow(r, { adminMode: adminMode.value });
    }
    return false;
  });
});

const isPendingMe = computed(() => filter.value === 'pending_me');
const allowBatchApprove = computed(() => isPendingMe.value && requests.value.length > 0);

const hasActiveQuery = computed(() => {
  return showSearch.value && Boolean(query.q || query.workflow || query.status || query.dateFrom || query.dateTo);
});

const hintHtml = computed(() => {
  const f = filter.value;
  const isAdm = L.isAdmin();
  const canDelLeave = typeof L.canDeleteLeavePerm === 'function' ? L.canDeleteLeavePerm() : false;
  const canDelRec = typeof L.canDeleteRecordsPerm === 'function' ? L.canDeleteRecordsPerm() : false;
  if (f === 'related' || f === 'all') {
    return `<p class="muted" style="margin:0 0 12px">僅顯示與您登入帳號相關的單據（本人申請、待您簽核或您曾簽核）。${
      isAdm || L.hasPerm('records_all') ? '具備「查看全部」權限者可看所有人單據。' : ''
    }${
      isAdm ? ' <strong>系統管理員可刪除任何狀態的申請單</strong>（含已核准／駁回／簽核中／已取消）。' : ''
    }${
      !isAdm && canDelLeave ? ' 具備「刪除請假申請」者可查看並刪除<strong>所有人的請假單</strong>（含簽核進行中）。' : ''
    }${
      !isAdm && canDelRec ? ' 具備「刪除簽核紀錄」者可刪除尚未有簽署人核准的單據。' : ''
    }</p>`;
  }
  if (f === 'mine') {
    return `<p class="muted" style="margin:0 0 12px">${
      mineStatus.value
        ? `僅顯示您本人送出、狀態為<strong>「${L.esc(mineStatusLabel.value)}」</strong>的申請。 <button type="button" class="btn outline sm" data-go="mine">查看全部我的申請</button>`
        : '僅顯示您本人送出的申請，以及您<strong>代申請</strong>的單據。'
    }${
      isAdm ? '系統管理員可刪除任何狀態的申請單。' : '可刪除<strong>尚未核准</strong>的單據（已核准不可刪）。'
    }</p>`;
  }
  if (f === 'pending_me') {
    return '<p class="muted" style="margin:0 0 12px">僅顯示目前待您簽核的單據（含您以<strong>代理人身份可代簽</strong>的待辦，會標示「代簽」）。</p>';
  }
  return '';
});

const emptyByFilter = computed(() => ({
  pending_me: {
    title: hasActiveQuery.value ? '沒有符合條件的待簽核' : '目前沒有待您簽核的單據',
    desc: hasActiveQuery.value
      ? '請調整查詢條件後再試。'
      : '新申請送達且輪到您時會出現在此。您也可以主動提出新申請。',
    actions: hasActiveQuery.value
      ? [{ label: '清除條件', id: 'btn-req-clear', outline: true }]
      : [
          { label: '＋ 新增申請', go: 'new-request', primary: true },
          { label: '回總覽', go: 'dashboard', outline: true },
        ],
  },
  mine: {
    title: mineStatus.value
      ? `目前沒有${mineStatusLabel.value}的申請`
      : hasActiveQuery.value
        ? '沒有符合條件的申請'
        : '尚無我的申請',
    desc: mineStatus.value
      ? `沒有狀態為「${mineStatusLabel.value}」的申請。可查看全部我的申請，或新增一筆。`
      : hasActiveQuery.value
        ? '請調整查詢條件後再試。'
        : '您還沒有申請或草稿。可從「新增申請」填寫並「儲存草稿」或「送出申請」。',
    actions: mineStatus.value
      ? [
          { label: '查看全部我的申請', go: 'mine', outline: true },
          { label: '＋ 新增申請', go: 'new-request', primary: true },
          { label: '回總覽', go: 'dashboard', outline: true },
        ]
      : hasActiveQuery.value
        ? [{ label: '清除條件', id: 'btn-req-clear', outline: true }]
        : [{ label: '＋ 新增申請', go: 'new-request', primary: true }],
  },
  related: {
    title: hasActiveQuery.value ? '沒有符合條件的紀錄' : '尚無相關簽核紀錄',
    desc: hasActiveQuery.value
      ? '請調整申請類別、狀態、日期或關鍵字後再查詢。'
      : '與您有關的申請、待簽或曾簽核的單據會列在這裡。',
    actions: hasActiveQuery.value
      ? [{ label: '清除條件', id: 'btn-req-clear', outline: true }]
      : [
          { label: '查看待簽核', go: 'inbox', outline: true },
          { label: '＋ 新增申請', go: 'new-request', primary: true },
        ],
  },
  all: {
    title: hasActiveQuery.value ? '沒有符合條件的紀錄' : '尚無簽核紀錄',
    desc: hasActiveQuery.value
      ? '請調整查詢條件後再試。'
      : '系統中尚無相關單據。',
    actions: hasActiveQuery.value
      ? [{ label: '清除條件', id: 'btn-req-clear', outline: true }]
      : [{ label: '＋ 新增申請', go: 'new-request', primary: true }],
  },
  done: {
    title: hasActiveQuery.value ? '沒有符合條件的紀錄' : '尚無已完成紀錄',
    desc: hasActiveQuery.value
      ? '請調整查詢條件後再試。'
      : '已核准或結案的單據會顯示於此。',
    actions: hasActiveQuery.value
      ? [{ label: '清除條件', id: 'btn-req-clear', outline: true }]
      : [{ label: '回總覽', go: 'dashboard', outline: true }],
  },
}));

async function loadData() {
  const f = filter.value;
  const p = new URLSearchParams({ filter: f });
  if (showSearch.value) {
    if (query.q) p.set('q', query.q);
    if (query.workflow) p.set('workflow', query.workflow);
    if (query.status) p.set('status', query.status);
    if (query.dateFrom) p.set('dateFrom', query.dateFrom);
    if (query.dateTo) p.set('dateTo', query.dateTo);
  } else if (mineStatus.value) {
    p.set('status', mineStatus.value);
  }

  try {
    const data = await L.api(`/api/requests?${p.toString()}`);
    allRequests.value = data.requests || [];
    categories.value = Array.isArray(data.categories) ? data.categories : [];

    if (showSearch.value) {
      if (typeof L.paginateItems === 'function') {
        paged.value = L.paginateItems(allRequests.value, query.page, 20);
      } else {
        paged.value = {
          page: 1,
          pages: 1,
          total: allRequests.value.length,
          pageSize: 20,
          items: allRequests.value,
        };
      }
    } else {
      paged.value = {
        page: 1,
        pages: 1,
        total: allRequests.value.length,
        pageSize: allRequests.value.length || 20,
        items: allRequests.value,
      };
    }
    requests.value = paged.value.items;
  } catch (err) {
    L.toast(err.message, 'error');
    allRequests.value = [];
    requests.value = [];
  }

  // Pending filter specific notices
  if (f === 'pending_me') {
    const fnList = requests.value.filter((r) => r.needsFinalNotifyAck);
    if (fnList.length) {
      finalNotifyListBanner.value = `
        <div class="card" style="background:#eff6ff;border-color:#93c5fd;margin-bottom:14px;padding:14px">
          <h3 style="color:#1e40af;margin:0">🔔 最終核准完成通知（${fnList.length} 筆待您確認收到）</h3>
          <p style="margin:6px 0 0;font-size:0.88rem;color:#1d4ed8">
            請開啟單據後點「確認收到通知」。此為系統內通知，非 Email。
          </p>
        </div>`;
    } else {
      finalNotifyListBanner.value = '';
    }

    if (typeof L.isFinanceStaffUser === 'function' && L.isFinanceStaffUser()) {
      try {
        const finRes = await L.api('/api/requests?filter=pending_finance_confirm');
        const finReqs = finRes.requests || [];
        if (finReqs.length > 0 && typeof L.requestTable === 'function') {
          finConfirmCardHtml.value = `
            <div class="card" style="background:#ecfdf5;border-color:#6ee7b7;margin-bottom:16px;padding:16px">
              <div class="card-head" style="margin-bottom:8px">
                <h3 style="color:#065f46;margin:0">📊 待財務部授信額度建檔確認（${finReqs.length} 筆）</h3>
              </div>
              <p style="margin:0 0 12px;font-size:0.88rem;color:#047857">
                總經理已完成核定。請於 ERP 完成授信額度設定後，點選單據開啟詳情並點擊「確認完成額度建檔」。
              </p>
              ${L.requestTable(finReqs, { empty: { title: '尚無待建檔單據' } })}
            </div>`;
        } else {
          finConfirmCardHtml.value = '';
        }
      } catch {
        finConfirmCardHtml.value = '';
      }
    } else {
      finConfirmCardHtml.value = '';
    }
  } else {
    finalNotifyListBanner.value = '';
    finConfirmCardHtml.value = '';
  }
}

await loadData();

const cardHtml = computed(() => {
  const f = filter.value;
  const h = hintHtml.value;
  const search = showSearch.value
    ? `
      <form id="req-filter-form" class="req-filter-bar" style="margin-bottom:14px">
        <div class="form-grid two" style="gap:10px">
          <div class="field" style="margin:0">
            <label>關鍵字</label>
            <input type="search" name="q" value="${L.esc(query.q)}"
              placeholder="單號、主旨、申請人、類別…" autocomplete="off" />
          </div>
          <div class="field" style="margin:0">
            <label>申請類別</label>
            <select name="workflow">
              <option value="">全部類別</option>
              ${categoryOptions.value
                .map(
                  (c) =>
                    `<option value="${L.esc(c)}" ${
                      query.workflow === c ? 'selected' : ''
                    }>${L.esc(c)}</option>`
                )
                .join('')}
            </select>
          </div>
          <div class="field" style="margin:0">
            <label>狀態</label>
            <select name="status">
              ${statusOpts
                .map(
                  (o) =>
                    `<option value="${L.esc(o.v)}" ${
                      query.status === o.v ? 'selected' : ''
                    }>${L.esc(o.t)}</option>`
                )
                .join('')}
            </select>
          </div>
          <div class="field" style="margin:0">
            <label>更新日期（起～迄）</label>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <input type="date" name="dateFrom" value="${L.esc(query.dateFrom)}" style="flex:1;min-width:120px" />
              <span class="muted">～</span>
              <input type="date" name="dateTo" value="${L.esc(query.dateTo)}" style="flex:1;min-width:120px" />
            </div>
          </div>
        </div>
        <div class="form-actions" style="margin-top:10px;flex-wrap:wrap">
          <button type="submit" class="btn primary sm">查詢</button>
          <button type="button" class="btn outline sm" id="btn-req-clear">清除條件</button>
          <span class="muted" style="font-size:0.85rem">共 <strong>${paged.value.total}</strong> 筆${
            paged.value.pages > 1 ? `，每頁 20 筆` : ''
          }</span>
        </div>
      </form>`
    : '';

  const del = allowBatchApprove.value
    ? `
      <div class="form-actions" style="margin-bottom:12px;flex-wrap:wrap;align-items:center;gap:10px">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
          <input type="checkbox" id="chk-all-reqs" /> 全選
        </label>
        <button type="button" class="btn success sm" id="btn-bulk-approve-reqs" disabled>✅ 批次核准</button>
        <span class="muted" id="req-sel-count">已選 0 筆</span>
      </div>`
    : anyDeletable.value
      ? `
        <div class="form-actions" style="margin-bottom:12px;flex-wrap:wrap">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
            <input type="checkbox" id="chk-all-reqs" /> 全選
          </label>
          <button type="button" class="btn danger sm" id="btn-bulk-del-reqs">刪除選取</button>
          <span class="muted" id="req-sel-count">已選 0 筆</span>
        </div>`
      : '';

  const tbl =
    typeof L.requestTable === 'function'
      ? L.requestTable(requests.value, {
          allowDelete: allowDelete.value,
          adminMode: adminMode.value,
          allowBatchApprove: allowBatchApprove.value,
          empty: emptyByFilter.value[f] || {
            title: '尚無資料',
            desc: '目前沒有符合條件的簽核單據。',
          },
        })
      : '';

  const pager =
    showSearch.value && typeof L.requestListPagerHtml === 'function'
      ? L.requestListPagerHtml(paged.value)
      : '';

  return `${h}${search}${del}${tbl}${pager}`;
});

function bindEvents() {
  const form = document.getElementById('req-filter-form');
  if (form) {
    form.onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      query.q = String(fd.get('q') || '').trim();
      query.workflow = String(fd.get('workflow') || '').trim();
      query.status = String(fd.get('status') || '').trim();
      query.dateFrom = String(fd.get('dateFrom') || '').trim();
      query.dateTo = String(fd.get('dateTo') || '').trim();
      query.page = 1;
      if (L.state) L.state.requestListQuery = { ...query, _filter: filter.value };
      loadData();
    };
  }

  const clearBtn = document.getElementById('btn-req-clear');
  if (clearBtn) {
    clearBtn.onclick = (e) => {
      e.preventDefault();
      query.q = '';
      query.workflow = '';
      query.status = '';
      query.dateFrom = '';
      query.dateTo = '';
      query.page = 1;
      if (L.state) L.state.requestListQuery = { _filter: filter.value };
      loadData();
    };
  }

  const chkAll = document.getElementById('chk-all-reqs');
  if (chkAll) {
    chkAll.onchange = (e) => {
      document.querySelectorAll('input[data-req-check]').forEach((c) => {
        c.checked = e.target.checked;
      });
      updateCount();
    };
  }

  document.querySelectorAll('input[data-req-check]').forEach((c) => {
    c.onchange = updateCount;
  });

  const btnBulkDel = document.getElementById('btn-bulk-del-reqs');
  if (btnBulkDel) {
    btnBulkDel.onclick = onBulkDel;
  }

  const btnBulkApprove = document.getElementById('btn-bulk-approve-reqs');
  if (btnBulkApprove) {
    btnBulkApprove.onclick = onBulkApprove;
  }
}

function updateCount() {
  const n = [...document.querySelectorAll('input[data-req-check]:checked')].length;
  const el = document.getElementById('req-sel-count');
  if (el) el.textContent = `已選 ${n} 筆`;
  const btnApprove = document.getElementById('btn-bulk-approve-reqs');
  if (btnApprove) {
    btnApprove.disabled = n === 0;
    btnApprove.textContent = n > 0 ? `✅ 批次核准 (${n} 筆)` : '✅ 批次核准';
  }
}

function onBulkApprove() {
  const ids = [...document.querySelectorAll('input[data-req-check]:checked')].map((c) => Number(c.value)).filter(Boolean);
  if (!ids.length) {
    L.toast('請先勾選欲核准的單據', 'warning');
    return;
  }
  const selectedRequests = requests.value.filter((r) => ids.includes(Number(r.id)));
  if (typeof L.openBulkApproveModal === 'function') {
    L.openBulkApproveModal({
      selectedRequests,
      onCompleted: () => {
        loadData();
        if (typeof L.refreshBadge === 'function') L.refreshBadge();
      },
    });
  }
}

function onCardClick(e) {
  // Page buttons
  const btnPage = e.target.closest('[data-req-page]');
  if (btnPage && btnPage.dataset.reqPage && !btnPage.disabled) {
    query.page = Number(btnPage.dataset.reqPage);
    if (L.state) L.state.requestListQuery = { ...query, _filter: filter.value };
    loadData();
    return;
  }

  // Delete single
  const delBtn = e.target.closest('[data-del-req]');
  if (delBtn) {
    e.stopPropagation();
    const id = Number(delBtn.dataset.delReq);
    doDeleteSingle(id);
    return;
  }

  // Clear button inside empty state
  const clearBtn = e.target.closest('#btn-req-clear');
  if (clearBtn) {
    e.preventDefault();
    query.q = '';
    query.workflow = '';
    query.status = '';
    query.dateFrom = '';
    query.dateTo = '';
    query.page = 1;
    if (L.state) L.state.requestListQuery = { _filter: filter.value };
    loadData();
    return;
  }

  // Checkbox: stop row click
  const chk = e.target.closest('input[data-req-check]');
  if (chk) {
    updateCount();
    return;
  }

  // Clickable row
  const tr = e.target.closest('tr.clickable[data-id]');
  if (tr && tr.dataset.id) {
    if (typeof L.navigate === 'function') L.navigate('detail', { id: Number(tr.dataset.id) });
    return;
  }

  // data-go
  const btnGo = e.target.closest('[data-go]');
  if (btnGo && btnGo.dataset.go) {
    const params = {};
    if (btnGo.dataset.status) params.status = btnGo.dataset.status;
    if (btnGo.dataset.id) params.id = Number(btnGo.dataset.id);
    if (typeof L.navigate === 'function') L.navigate(btnGo.dataset.go, params);
  }
}

async function doDeleteSingle(id) {
  const r = requests.value.find((x) => x.id === id);
  const isAdm = L.isAdmin();
  const canDelRec = typeof L.canDeleteRecordsPerm === 'function' ? L.canDeleteRecordsPerm() : false;
  const canDelLeave = typeof L.canDeleteLeavePerm === 'function' ? L.canDeleteLeavePerm() : false;
  const isLeave = typeof L.isLeaveRequestRow === 'function' ? L.isLeaveRequestRow(r) : false;

  if (r && typeof L.canDeleteRequestRow === 'function' && !L.canDeleteRequestRow(r, { adminMode: adminMode.value })) {
    L.toast(
      r.approver_signed || r.can_delete === false
        ? '下一位簽署人已簽核，此申請單無法刪除'
        : '此申請單不可刪除',
      'error'
    );
    return;
  }
  if (r?.status === 'approved' && !isAdm && !canDelRec && !(isLeave && canDelLeave)) {
    L.toast('已核准的申請不可刪除', 'error');
    return;
  }
  const adminWarn = isAdm ? '\n（系統管理員：將永久刪除此單，含已簽核／任何狀態）' : '';
  if (!confirm(`確定刪除申請 #${id}${r ? `「${r.title}」` : ''}？\n將永久刪除單據、歷程、附件與相關備份，無法復原。${adminWarn}`)) {
    return;
  }
  try {
    await L.api(`/api/requests/${id}`, { method: 'DELETE' });
    L.toast('已刪除申請', 'success');
    await loadData();
  } catch (err) {
    L.toast(err.message, 'error');
  }
}

async function onBulkDel() {
  const ids = [...document.querySelectorAll('input[data-req-check]:checked')].map((c) => Number(c.value));
  if (!ids.length) {
    L.toast('請先勾選要刪除的紀錄', 'error');
    return;
  }
  const isAdm = L.isAdmin();
  const adminWarn = isAdm ? '\n（系統管理員：將永久刪除選取的所有單據，含已核准／任何狀態）' : '';
  if (!confirm(`確定刪除選取的 ${ids.length} 筆簽核申請？\n將永久刪除單據、歷程、附件與備份，無法復原。${adminWarn}`)) {
    return;
  }
  try {
    const data = await L.api('/api/requests/bulk-delete', {
      method: 'POST',
      body: { ids },
    });
    L.toast(data.message || '已批次刪除', 'success');
    await loadData();
  } catch (err) {
    L.toast(err.message, 'error');
  }
}

onMounted(() => {
  bindEvents();
});

onUpdated(() => {
  bindEvents();
});
</script>
