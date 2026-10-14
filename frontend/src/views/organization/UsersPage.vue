<template>
  <EmptyState
    v-if="!canLabor"
    title="無權限"
    desc="需「成員休假已休管理」權限或系統管理員，才可查看成員名單。"
  />
  <div v-else class="card">
    <p class="muted" style="margin-top:0" v-html="summaryHtml"></p>
    <div v-if="canFull" class="form-actions" style="margin-bottom:12px;flex-wrap:wrap">
      <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
        <input type="checkbox" id="chk-all-users" :checked="isAllChecked" @change="onToggleAll" /> 全選
      </label>
      <button type="button" class="btn outline sm" id="btn-export-selected" @click="onExportSelected">匯出選取</button>
      <button type="button" class="btn outline sm" id="btn-export-selected-pwd" @click="onExportSelectedPwd">匯出選取（重設密碼）</button>
      <button type="button" class="btn danger sm" id="btn-bulk-del" @click="onBulkDel">刪除選取</button>
      <span class="muted" id="sel-count">已選 {{ selectedIds.length }} 人</span>
    </div>
    <div class="table-wrap">
      <table class="data">
        <thead>
          <tr>
            <th v-if="canFull" style="width:40px"></th>
            <th>姓名</th>
            <th>帳號</th>
            <th>部門</th>
            <th v-if="canLabor">休假（可休／已休／剩餘）</th>
            <th>角色／權限</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in users" :key="u.id" :data-user-row="u.id">
            <td v-if="canFull">
              <input
                type="checkbox"
                data-user-check
                :value="u.id"
                :disabled="isCheckDisabled(u)"
                :title="getCheckDisabledTitle(u)"
                :checked="selectedIds.includes(u.id)"
                @change="onToggleUser(u.id)"
              />
            </td>
            <td><strong>{{ u.name }}</strong></td>
            <td>{{ u.username }}</td>
            <td>
              {{ u.department || '—' }}
              <div v-if="u.departments && u.departments.length > 1" class="muted" style="font-size:0.8rem">
                {{ u.departments.join('、') }}
              </div>
            </td>
            <td v-if="canLabor" v-html="laborCell(u)"></td>
            <td>
              <span v-if="u.role === 'admin'" class="tag draft">最高權限 · 系統管理員</span>
              <template v-else>
                <span class="tag">一般使用者</span>
                <div class="muted" style="font-size:0.82rem;margin-top:4px">{{ formatPerms(u) }}</div>
              </template>
            </td>
            <td>
              <div style="display:flex;flex-wrap:wrap;gap:6px">
                <button v-if="canFull" type="button" class="btn sm primary" :data-edit-user="u.id" @click="onEditUser(u)">編輯資料</button>
                <button v-else-if="canLabor" type="button" class="btn sm primary" :data-edit-leave="u.id" @click="onEditLeave(u)">編輯已休</button>

                <button v-if="canLabor" type="button" class="btn sm outline" :data-labor-user="u.id" @click="onLaborDetail(u)">休假明細</button>

                <template v-if="canFull">
                  <button
                    type="button"
                    class="btn sm outline"
                    :data-perm-edit="u.id"
                    :disabled="isBuiltinAdminUser(u) && !isBuiltinAdmin()"
                    @click="onPermEdit(u)"
                  >
                    權限
                  </button>
                  <button type="button" class="btn sm outline" :data-reset-pw="u.id" @click="onResetPw(u)">密碼</button>
                  <span v-if="isSelfOrBuiltinAdmin(u)" :class="{ muted: isBuiltinAdminUser(u) }" :style="isBuiltinAdminUser(u) ? 'font-size:0.78rem' : ''">
                    <template v-if="isBuiltinAdminUser(u)">內建帳號不可刪</template>
                  </span>
                  <button v-else type="button" class="btn sm danger" :data-del-user="u.id" @click="onDelUser(u)">刪除</button>
                </template>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
  <UserFormModal
    v-if="editor"
    :mode="editor.mode"
    :user="editor.user"
    :defs="defs"
    @close="editor = null"
    @saved="onEditorSaved"
  />
  <UserPermModal v-if="permUser" :user="permUser" :defs="defs" @close="permUser = null" @saved="onEditorSaved" />
  <UserPasswordModal v-if="pwUser" :user="pwUser" @close="pwUser = null" @saved="pwUser = null" />
  <LaborDetailModal v-if="laborView" :user="laborView.user" :labor="laborView.labor" @close="laborView = null" />
</template>

<script setup>
import { apiRequest } from '@/api/client';
import { escapeHtml } from '@/lib/form/html';
import { useToastStore } from '@/stores/toast';
import { downloadUsersExcel } from '@/lib/admin-runtime';
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useAuthStore } from '@/stores/auth';
import EmptyState from '@/components/common/EmptyState.vue';
import UserFormModal from '@/components/admin/UserFormModal.vue';
import UserPermModal from '@/components/admin/UserPermModal.vue';
import UserPasswordModal from '@/components/admin/UserPasswordModal.vue';
import LaborDetailModal from '@/components/admin/LaborDetailModal.vue';
const toast = useToastStore();

const auth = useAuthStore();
const canFull = computed(() => auth.isAdmin);
const canLabor = computed(() => auth.hasPerm('users_leave'));

const users = ref([]);
const defs = ref([]);
const selectedIds = ref([]);
const editor = ref(null);
const permUser = ref(null);
const pwUser = ref(null);
const laborView = ref(null);

const PERM_LABEL = {
  workflows: '管理簽核流程',
  backups: '備份資料',
  records_all: '查看全部簽核紀錄',
  records_delete: '刪除簽核紀錄',
  leave_delete: '刪除請假申請',
  leave_report: '請假報表匯出',
  users_leave: '成員休假已休管理',
  finance_confirm: '財務部授信額度建檔確認',
};

function formatPerms(u) {
  if (u.role === 'admin') return '全部權限（系統管理員）';
  const list = u.permissions || [];
  if (!list.length) return '一般（僅本人簽核）';
  return list.map((p) => PERM_LABEL[p] || p).join('、');
}

function isBuiltinAdminUser(u) {
  return !!(u && (u.isBuiltinAdmin || String(u.username || '').trim().toLowerCase() === 'admin'));
}

function isBuiltinAdmin() {
  return auth.isBuiltinAdmin;
}

function isSelfOrBuiltinAdmin(u) {
  return u.id === auth.user?.id || isBuiltinAdminUser(u);
}

function isCheckDisabled(u) {
  return u.id === auth.user?.id || isBuiltinAdminUser(u);
}

function getCheckDisabledTitle(u) {
  if (isBuiltinAdminUser(u)) return '內建 Admin 不可刪除';
  if (u.id === auth.user?.id) return '不可選取自己';
  return undefined;
}

const summaryHtml = computed(() => {
  return `
        目前成員 <strong>${users.value.length}</strong> 人。
        ${
          canLabor.value
            ? `各假別<strong>可休天數一律手動設定</strong>（不依年資自動計算）。
        統計年度採<strong>曆年制</strong>（每年 1/1～12/31）。
        剩餘＝可休 −（<strong>手動已休</strong>＋系統已核准）。
        <strong>特休以日計算</strong>（不顯示小時）。
        ${
          canFull.value
            ? '管理員可於「編輯資料」填寫各假別可休與已休天數。'
            : '您可使用「編輯已休」填寫各假別可休與已休。'
        }`
            : ''
        }
      `;
});

function laborCell(u) {
  const lab = u.labor;
  const sl = lab?.specialLeave;
  if (!lab) {
    return `<span class="muted" style="font-size:0.82rem">尚無休假資料</span>`;
  }
  return `
      <div style="font-size:0.85rem;line-height:1.45">
        ${lab.hireDate ? `<div>到職：${escapeHtml(lab.hireDate)}${lab.seniority?.label ? ` · ${escapeHtml(lab.seniority.label)}` : ''}</div>` : `<div class="muted">到職日未設定</div>`}
        ${
          sl
            ? `<div>特休可休 <strong>${sl.entitled ?? 0}</strong> 日（手動）</div>
               <div>已休 ${sl.used ?? 0} 日
                 ${
                   sl.manualUsedDays
                     ? `<span class="muted">（手動 ${sl.manualUsedDays || 0} 日${
                         sl.systemUsed ? `＋系統 ${sl.systemUsed} 日` : ''
                       }）</span>`
                     : sl.systemUsed
                       ? `<span class="muted">（系統 ${sl.systemUsed} 日）</span>`
                       : ''
                 }
               </div>
               <div>剩餘 <strong style="color:${
                 (sl.remaining ?? 0) > 0 ? '#15803d' : '#b45309'
               }">${sl.remaining ?? 0}</strong> 日</div>
               <div class="muted" style="font-size:0.78rem">${escapeHtml(sl.yearLabel || '')} · 特休以日計</div>`
            : `<div class="muted">請於編輯設定各假別可休天數</div>`
        }
      </div>`;
}

const selectableUsers = computed(() => users.value.filter((u) => !isCheckDisabled(u)));
const isAllChecked = computed(
  () => selectableUsers.value.length > 0 && selectedIds.value.length === selectableUsers.value.length
);

function onToggleAll(e) {
  if (e.target.checked) {
    selectedIds.value = selectableUsers.value.map((u) => u.id);
  } else {
    selectedIds.value = [];
  }
}

function onToggleUser(id) {
  const idx = selectedIds.value.indexOf(id);
  if (idx >= 0) selectedIds.value.splice(idx, 1);
  else selectedIds.value.push(id);
}

async function loadData() {
  if (!canLabor.value) return;
  try {
    const data = await apiRequest('/api/users?labor=1');
    users.value = data.users || [];
    defs.value = data.permissionDefs || [
      { id: 'workflows', label: PERM_LABEL.workflows },
      { id: 'backups', label: PERM_LABEL.backups },
      { id: 'records_all', label: PERM_LABEL.records_all },
      { id: 'leave_report', label: PERM_LABEL.leave_report },
      { id: 'users_leave', label: PERM_LABEL.users_leave },
    ];

  } catch (err) {
    toast.error(err.message || '載入成員資料失敗');
  }
}

function updatePageActions() {
  const actionsEl = document.getElementById('page-actions');
  if (!actionsEl) return;
  if (canFull.value) {
    actionsEl.innerHTML = `
      <button type="button" class="btn outline" id="btn-tpl-user">下載範本</button>
      <button type="button" class="btn outline" id="btn-import-user">Excel 匯入</button>
      <button type="button" class="btn outline" id="btn-export-all-user">匯出全部</button>
      <button type="button" class="btn primary" id="btn-add-user">＋ 新增成員</button>
      <input type="file" id="user-import-file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" class="hidden" />
    `;
    const btnTpl = document.getElementById('btn-tpl-user');
    if (btnTpl) btnTpl.onclick = onDownloadTemplate;

    const btnImp = document.getElementById('btn-import-user');
    const fileInput = document.getElementById('user-import-file');
    if (btnImp && fileInput) {
      btnImp.onclick = () => fileInput.click();
      fileInput.onchange = onImportFile;
    }

    const btnExportAll = document.getElementById('btn-export-all-user');
    if (btnExportAll) btnExportAll.onclick = onExportAll;

    const btnAdd = document.getElementById('btn-add-user');
    if (btnAdd) btnAdd.onclick = onAddUser;
  } else {
    actionsEl.innerHTML = `
      <span class="muted" style="font-size:0.88rem">您可查看成員並編輯<strong>可休／已休</strong>（特休以日計；其他假別可填小時）</span>
    `;
  }
}

async function onDownloadTemplate() {
  try {
    const blob = await apiRequest('/api/users/export-template', { expectBlob: true });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '成員名單_匯入範本.xlsx';
    a.click();
    URL.revokeObjectURL(url);
    toast.success('已下載範本');
  } catch (err) {
    toast.error(err.message);
  }
}

async function onExportAll() {
  try {
    const reset = confirm(
      '是否在匯出時重設密碼並寫入 Excel？\n\n「確定」＝重設（admin→admin123，其餘→pass1234）並寫入密碼欄\n「取消」＝僅匯出名單，密碼欄空白（保留原密碼）'
    );
    await downloadUsersExcel([], { resetPasswords: reset });
    toast.success('已匯出全部成員');
  } catch (err) {
    toast.error(err.message);
  }
}

async function onImportFile(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  const fd = new FormData();
  fd.append('file', file);
  try {
    const data = await apiRequest('/api/users/import', { method: 'POST', body: fd });
    toast.success(data.message || '匯入完成');
    if (data.errors?.length) {
      alert(`部分列有問題：\n${data.errors.slice(0, 12).join('\n')}`);
    }
    await loadData();
  } catch (err) {
    toast.error(err.message);
  }
}

function onAddUser() {
  editor.value = { mode: 'add', user: null };
}
function onEditUser(u) {
  editor.value = { mode: 'edit', user: u };
}
function onEditLeave(u) {
  editor.value = { mode: 'leave', user: u };
}
async function onLaborDetail(u) {
  try {
    const data = await apiRequest(`/api/users/${u.id}/labor`);
    laborView.value = { user: data.user || u, labor: data.labor || {} };
  } catch (err) {
    toast.error(err.message);
  }
}
function onPermEdit(u) {
  permUser.value = u;
}
function onResetPw(u) {
  pwUser.value = u;
}
async function onEditorSaved() {
  editor.value = null;
  permUser.value = null;
  await loadData();
}

async function onDelUser(u) {
  if (
    !confirm(
      `確定刪除成員「${u.name}」（${u.username}）？\n刪除後無法以此帳號登入（歷史簽核紀錄仍會保留姓名）。`
    )
  ) {
    return;
  }
  try {
    await apiRequest(`/api/users/${u.id}`, { method: 'DELETE' });
    toast.success('已刪除成員');
    await loadData();
  } catch (err) {
    toast.error(err.message);
  }
}

async function onExportSelected() {
  if (!selectedIds.value.length) {
    toast.error('請先勾選要匯出的成員');
    return;
  }
  try {
    await downloadUsersExcel(selectedIds.value, { resetPasswords: false });
    toast.success(`已匯出 ${selectedIds.value.length} 人`);
  } catch (err) {
    toast.error(err.message);
  }
}

async function onExportSelectedPwd() {
  if (!selectedIds.value.length) {
    toast.error('請先勾選要匯出的成員');
    return;
  }
  if (
    !confirm(
      `確定重設並匯出 ${selectedIds.value.length} 人的密碼？\n（admin 為 admin123，其餘為 pass1234）`
    )
  ) {
    return;
  }
  try {
    await downloadUsersExcel(selectedIds.value, { resetPasswords: true });
    toast.success(`已重設並匯出 ${selectedIds.value.length} 人`);
  } catch (err) {
    toast.error(err.message);
  }
}

async function onBulkDel() {
  if (!selectedIds.value.length) {
    toast.error('請先勾選要刪除的成員');
    return;
  }
  const names = selectedIds.value
    .map((id) => users.value.find((u) => u.id === id))
    .filter(Boolean)
    .map((u) => `${u.name}（${u.username}）`)
    .slice(0, 15);
  if (
    !confirm(
      `確定刪除選取的 ${selectedIds.value.length} 位成員？\n\n${names.join('\n')}${selectedIds.value.length > 15 ? '\n…' : ''}\n\n刪除後無法登入（歷史簽核紀錄仍保留）。`
    )
  ) {
    return;
  }
  try {
    const data = await apiRequest('/api/users/bulk-delete', {
      method: 'POST',
      body: { ids: selectedIds.value },
    });
    toast.success(data.message || '已批次刪除');
    selectedIds.value = [];
    await loadData();
  } catch (err) {
    toast.error(err.message);
  }
}

await loadData();

onMounted(() => {
  updatePageActions();
});

onBeforeUnmount(() => {
  const actionsEl = document.getElementById('page-actions');
  if (actionsEl) actionsEl.innerHTML = '';
});
</script>
