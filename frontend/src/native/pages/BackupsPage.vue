<template>
  <div v-if="!canAccess" class="error-msg">您沒有備份資料或人事請假相關權限</div>
  <template v-else>
    <div
      v-if="canLeaveDl"
      class="card"
      style="margin-bottom:16px;border-color:#bfdbfe;background:#f8fbff"
    >
      <h3 style="margin-top:0">人事：查詢／下載請假申請單</h3>
      <p class="muted" style="margin-top:0;line-height:1.55">
        條件查詢<strong>僅請假申請</strong>，勾選後下載 PDF ZIP；亦可全選後一次下載。單次最多 500 筆。
      </p>
      <form id="leave-forms-query-form" class="form-grid two" @submit.prevent="onQueryLeaveForms">
        <div class="field">
          <label>請假期間起 *</label>
          <input type="date" name="date_from" required v-model="leaveQueryForm.date_from" />
        </div>
        <div class="field">
          <label>請假期間迄 *</label>
          <input type="date" name="date_to" required v-model="leaveQueryForm.date_to" />
        </div>
        <div class="field">
          <label>狀態</label>
          <select name="status" v-model="leaveQueryForm.status">
            <option v-for="[v, l] in STATUS_OPT" :key="v" :value="v">{{ l }}</option>
          </select>
        </div>
        <div class="field">
          <label>部門（選填）</label>
          <select name="department" v-model="leaveQueryForm.department">
            <option value="">全部部門</option>
            <option v-for="d in meta.departments" :key="d" :value="d">{{ d }}</option>
          </select>
        </div>
        <div class="field">
          <label>假別（選填）</label>
          <input name="leave_type" placeholder="例如：事假、特休" maxlength="40" v-model="leaveQueryForm.leave_type" />
        </div>
        <div class="field">
          <label>關鍵字（選填）</label>
          <input name="keyword" placeholder="姓名／帳號／單號／主旨" maxlength="80" v-model="leaveQueryForm.keyword" />
        </div>
        <div class="form-actions" style="grid-column:1/-1;flex-wrap:wrap;gap:8px">
          <button type="submit" class="btn primary" id="btn-leave-forms-query" :disabled="loadingLeaveQuery">查詢請假單</button>
          <button type="button" class="btn outline" id="btn-leave-forms-reset" @click="onResetLeaveQuery">清除條件</button>
        </div>
      </form>
      <div id="leave-forms-list" style="margin-top:14px">
        <div v-if="leaveQueried === null" class="muted">請先設定條件後按「查詢請假單」。</div>
        <div v-else-if="loadingLeaveQuery" class="muted">查詢中…</div>
        <div v-else-if="leaveQueryError" class="error-msg">{{ leaveQueryError }}</div>
        <EmptyState
          v-else-if="!leaveItems.length"
          title="沒有符合條件的請假單"
          desc="請調整期間、部門、狀態或關鍵字後再查詢。"
        />
        <template v-else>
          <div class="form-actions" style="margin-bottom:10px;flex-wrap:wrap;align-items:center;gap:8px">
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
              <input type="checkbox" id="chk-all-leave-forms" :checked="isAllLeaveChecked" :indeterminate="isLeaveIndeterminate" @change="onToggleAllLeave" /> 全選
            </label>
            <button type="button" class="btn primary sm" id="btn-leave-dl-selected" :disabled="downloadingLeave" @click="onDownloadSelectedLeave">下載選取（ZIP）</button>
            <button type="button" class="btn outline sm" id="btn-leave-dl-all" :disabled="downloadingLeave" @click="onDownloadAllLeave">下載本頁全部</button>
            <span class="muted" id="leave-sel-count">已選 {{ selectedLeaveIds.length }} / {{ leaveItems.length }} 筆</span>
          </div>
          <div class="table-wrap">
            <table class="data">
              <thead>
                <tr>
                  <th style="width:40px"></th>
                  <th>單號</th><th>申請人</th><th>部門</th><th>假別</th>
                  <th>請假起</th><th>請假迄</th><th>天／時</th><th>狀態</th><th>主旨</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in leaveItems" :key="r.id">
                  <td><input type="checkbox" data-leave-check :value="r.id" :checked="selectedLeaveIds.includes(r.id)" @change="onToggleLeaveItem(r.id)" /></td>
                  <td>#{{ r.id }}</td>
                  <td>{{ r.requester_name || '' }}</td>
                  <td>{{ r.requester_dept || '—' }}</td>
                  <td>{{ r.leave_type || '—' }}</td>
                  <td style="white-space:nowrap">{{ r.leave_start || '—' }}</td>
                  <td style="white-space:nowrap">{{ r.leave_end || '—' }}</td>
                  <td style="white-space:nowrap">{{ formatLeaveDaysHours(r) }}</td>
                  <td>{{ STATUS_LEAVE[r.status] || r.status || '' }}</td>
                  <td :title="r.title || ''">{{ formatTitle40(r.title) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p class="muted" style="margin-top:8px">共 {{ leaveItems.length }} 筆請假申請。勾選後按「下載選取」；或「下載本頁全部」。</p>
        </template>
      </div>
      <div id="leave-forms-dl-result" class="muted" style="margin-top:8px">{{ leaveDlResult }}</div>
    </div>

    <p v-if="!canFullBackup && canLeaveDl" class="muted">
      您目前僅有人事請假權限，可使用上方「查詢／下載請假申請單」。完整備份需「備份資料」權限。
    </p>

    <template v-if="canFullBackup">
      <div class="card">
        <h3 style="margin-top:0">執行備份</h3>
        <p class="muted" style="margin-top:0" v-html="encNoteHtml"></p>
        <form id="backup-run-form" class="form-grid two" @submit.prevent="onRunBackup">
          <div class="field">
            <label>備份狀態</label>
            <select name="status" v-model="runForm.status">
              <option v-for="[v, l] in STATUS_OPT" :key="v" :value="v">{{ l }}</option>
            </select>
          </div>
          <div class="field">
            <label>部門（選填）</label>
            <select name="department" v-model="runForm.department">
              <option value="">全部部門</option>
              <option v-for="d in meta.departments" :key="d" :value="d">{{ d }}</option>
            </select>
          </div>
          <div class="field">
            <label>申請表單類別（選填）</label>
            <select name="workflow_name" v-model="runForm.workflow_name">
              <option value="">全部表單</option>
              <option v-for="w in meta.workflows" :key="w" :value="w">{{ w }}</option>
            </select>
          </div>
          <div class="field">
            <label>強制覆寫既有備份</label>
            <label style="display:flex;align-items:center;gap:8px;margin-top:8px;cursor:pointer">
              <input type="checkbox" name="force" v-model="runForm.force" /> 是（重新產生 PDF）
            </label>
          </div>
          <div class="field">
            <label>起始日期（選填）</label>
            <input type="date" name="date_from" v-model="runForm.date_from" />
          </div>
          <div class="field">
            <label>結束日期（選填）</label>
            <input type="date" name="date_to" v-model="runForm.date_to" />
          </div>
          <div class="form-actions" style="grid-column:1/-1">
            <button type="submit" class="btn primary" id="btn-run-backup" :disabled="runningBackup">開始備份</button>
          </div>
        </form>
        <div id="backup-run-result" class="muted" style="margin-top:8px" v-html="runResultHtml"></div>
      </div>

      <div class="card" style="margin-top:16px">
        <h3 style="margin-top:0">查詢備份</h3>
        <form id="backup-query-form" class="form-grid two" @submit.prevent="onQueryBackups">
          <div class="field">
            <label>部門</label>
            <select name="department" v-model="queryForm.department">
              <option value="">全部</option>
              <option v-for="d in meta.departments" :key="d" :value="d">{{ d }}</option>
            </select>
          </div>
          <div class="field">
            <label>申請表單類別</label>
            <select name="workflow_name" v-model="queryForm.workflow_name">
              <option value="">全部</option>
              <option v-for="w in meta.workflows" :key="w" :value="w">{{ w }}</option>
            </select>
          </div>
          <div class="field">
            <label>年</label>
            <select name="year" v-model="queryForm.year">
              <option value="">全部</option>
              <option v-for="y in meta.years" :key="y" :value="y">{{ y }}</option>
            </select>
          </div>
          <div class="field">
            <label>月</label>
            <select name="month" v-model="queryForm.month">
              <option value="">全部</option>
              <option v-for="m in monthOpts" :key="m" :value="m">{{ m }}</option>
            </select>
          </div>
          <div class="field" style="grid-column:1/-1">
            <label>關鍵字（主旨／申請人／單號）</label>
            <input name="keyword" placeholder="例如：請假、張祖銘、6" v-model="queryForm.keyword" />
          </div>
          <div class="form-actions" style="grid-column:1/-1">
            <button type="submit" class="btn primary">查詢</button>
            <button type="button" class="btn outline" id="btn-backup-reset" @click="onResetQuery">清除條件</button>
          </div>
        </form>
        <div id="backup-list" style="margin-top:12px">
          <div v-if="loadingList" class="muted">載入中…</div>
          <div v-else-if="listError" class="error-msg">{{ listError }}</div>
          <EmptyState
            v-else-if="!backups.length"
            title="沒有符合條件的備份"
            desc="請調整篩選條件，或先執行備份作業產生檔案。"
          />
          <template v-else>
            <div v-if="canDeleteBackup" class="form-actions" style="margin-bottom:10px;flex-wrap:wrap">
              <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
                <input type="checkbox" id="chk-all-backups" :checked="isAllBackupsChecked" @change="onToggleAllBackups" /> 全選
              </label>
              <button type="button" class="btn danger sm" id="btn-bulk-del-backups" @click="onBulkDelete">刪除選取</button>
              <span class="muted" id="backup-sel-count">已選 {{ selectedBackupIds.length }} 筆</span>
            </div>
            <div class="table-wrap">
              <table class="data">
                <thead>
                  <tr>
                    <th v-if="canDeleteBackup" style="width:40px"></th>
                    <th>單號</th><th>部門</th><th>表單類別</th><th>年月</th>
                    <th>主旨</th><th>申請人</th><th>狀態</th><th>備份時間</th><th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="b in backups" :key="b.id">
                    <td v-if="canDeleteBackup">
                      <input type="checkbox" data-backup-check :value="b.id" :checked="selectedBackupIds.includes(b.id)" @change="onToggleBackupItem(b.id)" />
                    </td>
                    <td>#{{ b.request_id }}</td>
                    <td>{{ b.department }}</td>
                    <td>{{ b.workflow_name }}</td>
                    <td>{{ b.period_year }}-{{ b.period_month }}</td>
                    <td>{{ b.title }}</td>
                    <td>{{ b.requester_name }}</td>
                    <td>{{ STATUS_MAP[b.status] || b.status }}</td>
                    <td class="muted">{{ b.created_at }}</td>
                    <td style="white-space:nowrap">
                      <button
                        type="button"
                        class="btn sm primary"
                        :data-dl="b.id"
                        :data-fname="b.file_name || ''"
                        @click="onDownloadBackup(b)"
                      >
                        {{ isZipFile(b.file_name) ? '下載 ZIP' : '下載 PDF' }}
                      </button>
                      <button
                        v-if="canDeleteBackup"
                        type="button"
                        class="btn sm danger"
                        :data-del-backup="b.id"
                        @click="onDeleteBackup(b)"
                      >
                        刪除
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p class="muted" style="margin-top:8px">
              路徑規則：部門 / 表單類別 / 年月 / 檔名.pdf（共 {{ backups.length }} 筆）{{ canDeleteBackup ? '。系統管理員可刪除備份。' : '' }}
            </p>
          </template>
        </div>
      </div>
    </template>
  </template>
</template>

<script setup>
import { ref, reactive, computed } from 'vue';
import { L } from '@/native/bridge';
import EmptyState from '@/native/components/EmptyState.vue';

const canAccess = computed(() => {
  if (typeof L.canAccessBackupsPage === 'function') return L.canAccessBackupsPage();
  return L.hasPerm('backups') || L.hasPerm('leave_report') || L.hasPerm('leave_delete');
});

const canFullBackup = computed(() => L.hasPerm('backups'));
const canLeaveDl = computed(() => {
  if (typeof L.canDownloadLeaveForms === 'function') return L.canDownloadLeaveForms();
  return L.hasPerm('leave_report') || L.hasPerm('leave_delete') || L.hasPerm('backups');
});
const canDeleteBackup = computed(() => L.isAdmin());

const STATUS_OPT = [
  ['approved', '已核准'],
  ['all', '全部狀態'],
  ['pending', '簽核中'],
  ['rejected', '已駁回'],
  ['cancelled', '已取消'],
  ['voided', '已作廢'],
];

const STATUS_MAP = {
  draft: '草稿',
  pending: '簽核中',
  approved: '已核准',
  rejected: '已駁回',
  cancelled: '已取消',
  voided: '已作廢',
};

const STATUS_LEAVE = {
  draft: '草稿',
  pending: '簽核中',
  approved: '已核准',
  rejected: '已駁回',
  cancelled: '已取消',
  voided: '已作廢',
};

const monthOpts = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));

const now = new Date();
const ytdFrom = `${now.getFullYear()}-01-01`;
const ytdTo = [
  now.getFullYear(),
  String(now.getMonth() + 1).padStart(2, '0'),
  String(now.getDate()).padStart(2, '0'),
].join('-');

const meta = ref({ departments: [], workflows: [], years: [], total: 0, encrypt: {} });

async function loadMeta() {
  if (canFullBackup.value) {
    try {
      const data = await L.api('/api/backups/meta');
      meta.value = data.meta || meta.value;
    } catch (e) {
      L.toast(e.message, 'error');
    }
  } else if (canLeaveDl.value) {
    try {
      const data = await L.api('/api/backups/leave-forms-meta');
      meta.value.departments = data.departments || [];
    } catch (e) {
      L.toast(e.message, 'error');
    }
  }
}

const encNoteHtml = computed(() => {
  const enc = meta.value.encrypt || {};
  let encText = '';
  if (enc.ready) {
    encText = '<span style="color:#15803d">已啟用 AES-256 加密</span>（一律存加密 ZIP；請用 7-Zip 等工具以系統設定密碼解壓）';
  } else if (enc.enabled && !enc.hasPass) {
    encText = '<span style="color:#b45309">已勾選加密但尚未設定密碼</span> — 請至「系統設定 → 備份加密」設定後再備份';
  } else {
    encText = '未加密。可於「系統設定 → 備份加密」啟用 AES-256 密碼保護';
  }
  return `
        備份目錄：<strong>部門 / 申請表單類別 / 年月</strong>。<br/>
        無附件時存 <strong>PDF</strong>；有上傳附件時存 <strong>ZIP</strong>（簽核單 PDF + 附件資料夾）。<br/>
        加密：${encText}。<br/>
        目前已備份 <strong>${meta.value.total || 0}</strong> 筆。
      `;
});

// 人事請假單查詢
const leaveQueryForm = reactive({
  date_from: ytdFrom,
  date_to: ytdTo,
  status: 'approved',
  department: '',
  leave_type: '',
  keyword: '',
});

const leaveQueried = ref(null);
const loadingLeaveQuery = ref(false);
const leaveQueryError = ref('');
const leaveItems = ref([]);
const selectedLeaveIds = ref([]);
const downloadingLeave = ref(false);
const leaveDlResult = ref('');

const isAllLeaveChecked = computed(() => {
  return leaveItems.value.length > 0 && selectedLeaveIds.value.length === leaveItems.value.length;
});

const isLeaveIndeterminate = computed(() => {
  const n = selectedLeaveIds.value.length;
  return n > 0 && n < leaveItems.value.length;
});

function formatLeaveDaysHours(r) {
  return (
    [
      r.days != null ? `${r.days} 日` : '',
      r.hours != null && Number(r.hours) > 0 ? `${r.hours} 時` : '',
    ]
      .filter(Boolean)
      .join(' / ') || '—'
  );
}

function formatTitle40(title) {
  const s = String(title || '');
  return s.length > 40 ? s.slice(0, 40) + '…' : s;
}

function onToggleAllLeave(e) {
  if (e.target.checked) {
    selectedLeaveIds.value = leaveItems.value.map((r) => r.id);
  } else {
    selectedLeaveIds.value = [];
  }
}

function onToggleLeaveItem(id) {
  const idx = selectedLeaveIds.value.indexOf(id);
  if (idx >= 0) {
    selectedLeaveIds.value.splice(idx, 1);
  } else {
    selectedLeaveIds.value.push(id);
  }
}

async function onQueryLeaveForms() {
  if (!leaveQueryForm.date_from || !leaveQueryForm.date_to) {
    L.toast('請指定請假期間起迄', 'error');
    return;
  }
  loadingLeaveQuery.value = true;
  leaveQueryError.value = '';
  try {
    const data = await L.api('/api/backups/leave-forms-query', {
      method: 'POST',
      body: {
        date_from: leaveQueryForm.date_from,
        date_to: leaveQueryForm.date_to,
        status: leaveQueryForm.status || 'approved',
        department: leaveQueryForm.department || '',
        leave_type: String(leaveQueryForm.leave_type || '').trim(),
        keyword: String(leaveQueryForm.keyword || '').trim(),
      },
    });
    leaveItems.value = data.items || [];
    selectedLeaveIds.value = leaveItems.value.map((r) => r.id);
    leaveQueried.value = true;
    L.toast(`查詢完成：${data.total || 0} 筆`, 'success');
  } catch (err) {
    leaveQueryError.value = err.message || '查詢失敗';
    L.toast(err.message, 'error');
  } finally {
    loadingLeaveQuery.value = false;
  }
}

function onResetLeaveQuery() {
  leaveQueryForm.date_from = ytdFrom;
  leaveQueryForm.date_to = ytdTo;
  leaveQueryForm.status = 'approved';
  leaveQueryForm.department = '';
  leaveQueryForm.leave_type = '';
  leaveQueryForm.keyword = '';
  leaveItems.value = [];
  selectedLeaveIds.value = [];
  leaveQueried.value = null;
  leaveQueryError.value = '';
  leaveDlResult.value = '';
}

async function downloadLeaveIds(ids) {
  if (!ids.length) {
    L.toast('請至少勾選一筆請假單', 'error');
    return;
  }
  downloadingLeave.value = true;
  leaveDlResult.value = `正在打包 ${ids.length} 筆請假 PDF，請稍候…`;
  try {
    const metaDl = await L.api('/api/backups/leave-forms-download', {
      method: 'POST',
      body: { ids },
      expectBlob: true,
      returnMeta: true,
    });
    const blob = metaDl.blob || metaDl;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = metaDl.filename || `請假申請單_${ids.length}筆.zip`;
    a.click();
    URL.revokeObjectURL(url);
    leaveDlResult.value = `已開始下載 ZIP（${ids.length} 筆）。`;
    L.toast(`請假申請單 ZIP 已開始下載（${ids.length} 筆）`, 'success');
  } catch (err) {
    leaveDlResult.value = '';
    L.toast(err.message, 'error');
  } finally {
    downloadingLeave.value = false;
  }
}

function onDownloadSelectedLeave() {
  downloadLeaveIds(selectedLeaveIds.value);
}

function onDownloadAllLeave() {
  selectedLeaveIds.value = leaveItems.value.map((r) => r.id);
  downloadLeaveIds(leaveItems.value.map((r) => r.id));
}

// 執行備份
const runForm = reactive({
  status: 'approved',
  department: '',
  workflow_name: '',
  force: false,
  date_from: '',
  date_to: '',
});

const runningBackup = ref(false);
const runResultHtml = ref('');

async function onRunBackup() {
  runningBackup.value = true;
  runResultHtml.value = '備份進行中，請稍候…';
  try {
    const { result } = await L.api('/api/backups/run', {
      method: 'POST',
      body: {
        status: runForm.status,
        department: runForm.department || '',
        workflow_name: runForm.workflow_name || '',
        date_from: runForm.date_from || '',
        date_to: runForm.date_to || '',
        force: Boolean(runForm.force),
      },
    });
    let html = `完成：成功 <strong>${result.success}</strong>、略過（已存在） <strong>${result.skipped}</strong>、失敗 <strong>${result.failed}</strong>（共掃描 ${result.total} 筆）`;
    if (result.errors?.length) {
      html += `<div class="error-msg" style="margin-top:8px">${result.errors
        .slice(0, 5)
        .map((x) => `#${x.request_id}: ${L.esc(x.error)}`)
        .join('<br/>')}</div>`;
    }
    runResultHtml.value = html;
    L.toast('備份作業完成', 'success');
    await loadBackupsList();
    await loadMeta();
  } catch (err) {
    runResultHtml.value = '';
    L.toast(err.message, 'error');
  } finally {
    runningBackup.value = false;
  }
}

// 查詢備份
const queryForm = reactive({
  department: '',
  workflow_name: '',
  year: '',
  month: '',
  keyword: '',
});

const backups = ref([]);
const loadingList = ref(false);
const listError = ref('');
const selectedBackupIds = ref([]);

const isAllBackupsChecked = computed(() => {
  return backups.value.length > 0 && selectedBackupIds.value.length === backups.value.length;
});

function isZipFile(fname) {
  return /\.zip$/i.test(fname || '');
}

function onToggleAllBackups(e) {
  if (e.target.checked) {
    selectedBackupIds.value = backups.value.map((b) => b.id);
  } else {
    selectedBackupIds.value = [];
  }
}

function onToggleBackupItem(id) {
  const idx = selectedBackupIds.value.indexOf(id);
  if (idx >= 0) {
    selectedBackupIds.value.splice(idx, 1);
  } else {
    selectedBackupIds.value.push(id);
  }
}

async function loadBackupsList(params = {}) {
  loadingList.value = true;
  listError.value = '';
  selectedBackupIds.value = [];
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v) q.set(k, v);
  });
  try {
    const res = await L.api(`/api/backups?${q.toString()}`);
    backups.value = res.backups || [];
  } catch (err) {
    listError.value = err.message || '載入失敗';
  } finally {
    loadingList.value = false;
  }
}

function onQueryBackups() {
  loadBackupsList({
    department: queryForm.department,
    workflow_name: queryForm.workflow_name,
    year: queryForm.year,
    month: queryForm.month,
    keyword: queryForm.keyword,
  });
}

function onResetQuery() {
  queryForm.department = '';
  queryForm.workflow_name = '';
  queryForm.year = '';
  queryForm.month = '';
  queryForm.keyword = '';
  loadBackupsList({});
}

async function onDownloadBackup(b) {
  try {
    const blob = await L.api(`/api/backups/${b.id}/download`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const fname = b.file_name || '';
    const isZip = isZipFile(fname) || blob.type.includes('zip');
    a.download = fname || (isZip ? `backup-${b.id}.zip` : `backup-${b.id}.pdf`);
    a.click();
    URL.revokeObjectURL(url);
    L.toast(isZip ? 'ZIP 已開始下載（含 PDF 與附件）' : 'PDF 已開始下載', 'success');
  } catch (e) {
    L.toast(e.message, 'error');
  }
}

async function onDeleteBackup(b) {
  if (!confirm('確定刪除此備份 PDF？\n（不會刪除原始簽核單據）')) return;
  try {
    await L.api(`/api/backups/${b.id}`, { method: 'DELETE' });
    L.toast('已刪除備份', 'success');
    await loadBackupsList({
      department: queryForm.department,
      workflow_name: queryForm.workflow_name,
      year: queryForm.year,
      month: queryForm.month,
      keyword: queryForm.keyword,
    });
    await loadMeta();
  } catch (e) {
    L.toast(e.message, 'error');
  }
}

async function onBulkDelete() {
  if (!selectedBackupIds.value.length) {
    L.toast('請先勾選要刪除的備份', 'error');
    return;
  }
  if (!confirm(`確定刪除選取的 ${selectedBackupIds.value.length} 筆備份 PDF？`)) return;
  try {
    const data = await L.api('/api/backups/bulk-delete', {
      method: 'POST',
      body: { ids: selectedBackupIds.value },
    });
    L.toast(data.message || '已批次刪除', 'success');
    await loadBackupsList({
      department: queryForm.department,
      workflow_name: queryForm.workflow_name,
      year: queryForm.year,
      month: queryForm.month,
      keyword: queryForm.keyword,
    });
    await loadMeta();
  } catch (e) {
    L.toast(e.message, 'error');
  }
}

if (canAccess.value) {
  await loadMeta();
  if (canFullBackup.value) {
    await loadBackupsList({});
  }
}
</script>
