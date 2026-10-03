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
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { L } from '@/native/bridge';
import EmptyState from '@/native/components/EmptyState.vue';

const canFull = computed(() => L.isAdmin());
const canLabor = computed(() => L.hasPerm('users_leave'));

const users = ref([]);
const defs = ref([]);
const selectedIds = ref([]);

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
  if (typeof L.isBuiltinAdminUser === 'function') return L.isBuiltinAdminUser(u);
  return !!(u && (u.isBuiltinAdmin || String(u.username || '').toLowerCase() === 'admin'));
}

function isBuiltinAdmin() {
  if (typeof L.isBuiltinAdmin === 'function') return L.isBuiltinAdmin();
  return String(L.state?.user?.username || '').toLowerCase() === 'admin';
}

function isSelfOrBuiltinAdmin(u) {
  return u.id === L.state?.user?.id || isBuiltinAdminUser(u);
}

function isCheckDisabled(u) {
  return u.id === L.state?.user?.id || isBuiltinAdminUser(u);
}

function getCheckDisabledTitle(u) {
  if (isBuiltinAdminUser(u)) return '內建 Admin 不可刪除';
  if (u.id === L.state?.user?.id) return '不可選取自己';
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
        ${lab.hireDate ? `<div>到職：${L.esc(lab.hireDate)}${lab.seniority?.label ? ` · ${L.esc(lab.seniority.label)}` : ''}</div>` : `<div class="muted">到職日未設定</div>`}
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
               <div class="muted" style="font-size:0.78rem">${L.esc(sl.yearLabel || '')} · 特休以日計</div>`
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
    const data = await L.api('/api/users?labor=1');
    users.value = data.users || [];
    if (L.state) L.state.users = users.value;
    defs.value = data.permissionDefs || [
      { id: 'workflows', label: PERM_LABEL.workflows },
      { id: 'backups', label: PERM_LABEL.backups },
      { id: 'records_all', label: PERM_LABEL.records_all },
      { id: 'leave_report', label: PERM_LABEL.leave_report },
      { id: 'users_leave', label: PERM_LABEL.users_leave },
    ];
    if (L.state) L.state.permissionDefs = defs.value;
  } catch (err) {
    L.toast(err.message || '載入成員資料失敗', 'error');
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
    const blob = await L.api('/api/users/export-template', { expectBlob: true });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '成員名單_匯入範本.xlsx';
    a.click();
    URL.revokeObjectURL(url);
    L.toast('已下載範本', 'success');
  } catch (err) {
    L.toast(err.message, 'error');
  }
}

async function onExportAll() {
  try {
    const reset = confirm(
      '是否在匯出時重設密碼並寫入 Excel？\n\n「確定」＝重設（admin→admin123，其餘→pass1234）並寫入密碼欄\n「取消」＝僅匯出名單，密碼欄空白（保留原密碼）'
    );
    if (typeof L.downloadUsersExcel === 'function') {
      await L.downloadUsersExcel([], { resetPasswords: reset });
    }
    L.toast('已匯出全部成員', 'success');
  } catch (err) {
    L.toast(err.message, 'error');
  }
}

async function onImportFile(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  const fd = new FormData();
  fd.append('file', file);
  try {
    const data = await L.api('/api/users/import', { method: 'POST', body: fd });
    L.toast(data.message || '匯入完成', 'success');
    if (data.errors?.length) {
      alert(`部分列有問題：\n${data.errors.slice(0, 12).join('\n')}`);
    }
    await loadData();
  } catch (err) {
    L.toast(err.message, 'error');
  }
}

function onAddUser() {
  if (typeof L.openAddUserModal === 'function') {
    L.openAddUserModal(defs.value);
  }
}

function onEditUser(u) {
  if (typeof L.openMemberEditor === 'function') {
    L.openMemberEditor(u, defs.value);
  }
}

function onEditLeave(u) {
  if (typeof L.openUserLeaveEditor === 'function') {
    L.openUserLeaveEditor(u);
  }
}

async function onLaborDetail(u) {
  try {
    const data = await L.api(`/api/users/${u.id}/labor`);
    if (typeof L.openLaborDetailModal === 'function') {
      L.openLaborDetailModal(data.user, data.labor);
    }
  } catch (err) {
    L.toast(err.message, 'error');
  }
}

function onPermEdit(u) {
  if (typeof L.openUserPermissionEditor === 'function') {
    L.openUserPermissionEditor(u, defs.value);
  }
}

function onResetPw(u) {
  if (typeof L.openAdminResetPasswordModal === 'function') {
    L.openAdminResetPasswordModal(u);
  }
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
    await L.api(`/api/users/${u.id}`, { method: 'DELETE' });
    L.toast('已刪除成員', 'success');
    await loadData();
  } catch (err) {
    L.toast(err.message, 'error');
  }
}

async function onExportSelected() {
  if (!selectedIds.value.length) {
    L.toast('請先勾選要匯出的成員', 'error');
    return;
  }
  try {
    if (typeof L.downloadUsersExcel === 'function') {
      await L.downloadUsersExcel(selectedIds.value, { resetPasswords: false });
    }
    L.toast(`已匯出 ${selectedIds.value.length} 人`, 'success');
  } catch (err) {
    L.toast(err.message, 'error');
  }
}

async function onExportSelectedPwd() {
  if (!selectedIds.value.length) {
    L.toast('請先勾選要匯出的成員', 'error');
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
    if (typeof L.downloadUsersExcel === 'function') {
      await L.downloadUsersExcel(selectedIds.value, { resetPasswords: true });
    }
    L.toast(`已重設並匯出 ${selectedIds.value.length} 人`, 'success');
  } catch (err) {
    L.toast(err.message, 'error');
  }
}

async function onBulkDel() {
  if (!selectedIds.value.length) {
    L.toast('請先勾選要刪除的成員', 'error');
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
    const data = await L.api('/api/users/bulk-delete', {
      method: 'POST',
      body: { ids: selectedIds.value },
    });
    L.toast(data.message || '已批次刪除', 'success');
    selectedIds.value = [];
    await loadData();
  } catch (err) {
    L.toast(err.message, 'error');
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
