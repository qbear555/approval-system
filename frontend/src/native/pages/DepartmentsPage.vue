<template>
  <EmptyState
    v-if="!isAdmin"
    title="無權限"
    desc="僅系統管理員可查看與管理部門。"
  />
  <EmptyState
    v-else-if="!departments.length"
    title="尚無部門資料"
    desc="請先新增部門，再將成員加入各部門。"
  />
  <div v-else class="card">
    <h3 style="margin-top:0">部門與成員</h3>
    <p class="muted" style="margin-top:0">
      成員可<strong>同時隸屬多個部門</strong>。「從成員名單加入」可重複把同一人加到不同部門；「移出部門」只移出該部門，不刪帳號。
    </p>
    <div
      v-for="d in departments"
      :key="d.id"
      style="border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:14px;background:#fff"
    >
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <strong style="font-size:1.1rem">{{ d.name }}</strong>
          <span class="tag approved">{{ (d.members || []).length }} 位成員</span>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          <button type="button" class="btn sm outline" @click="onRenameDept(d)">修改名稱</button>
          <button type="button" class="btn sm primary" @click="onAddMember(d)">＋ 從成員名單加入</button>
          <button type="button" class="btn sm danger" @click="onDeleteDept(d)">刪除部門</button>
        </div>
      </div>
      <div v-if="(d.members || []).length" class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th>姓名</th>
              <th>帳號</th>
              <th>角色</th>
              <th>隸屬部門</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in d.members" :key="m.id">
              <td><strong>{{ m.name }}</strong></td>
              <td><code>{{ m.username }}</code></td>
              <td>
                <span v-if="m.role === 'admin'" class="tag draft">系統管理員</span>
                <template v-else>一般使用者</template>
              </td>
              <td style="font-size:0.88rem">{{ getDeptLabel(m) }}</td>
              <td>
                <button type="button" class="btn sm outline" @click="onRemoveFromDept(d, m)">移出此部門</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else class="empty" style="padding:8px 0">
        此部門尚無成員，可點「從成員名單加入」
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { L } from '@/native/bridge';
import EmptyState from '@/native/components/EmptyState.vue';

const isAdmin = L.isAdmin();
const departments = ref([]);
let allUsers = [];

function getDeptLabel(m) {
  const depts = Array.isArray(m.departments) ? m.departments : [];
  return depts.length > 0 ? depts.join('、') : m.department || '—';
}

async function loadData() {
  if (!isAdmin) return;
  try {
    const res = await L.api('/api/departments/stats');
    departments.value = res.departments || [];
  } catch (err) {
    L.toast(err.message || '載入部門資料失敗', 'error');
  }

  try {
    const data = await L.api('/api/users');
    allUsers = data.users || [];
    if (L.state) L.state.users = allUsers;
  } catch {
    allUsers = L.state?.users || [];
  }
}

function updatePageActions() {
  const actionsEl = document.getElementById('page-actions');
  if (actionsEl && isAdmin) {
    actionsEl.innerHTML = `<button type="button" class="btn primary" id="btn-add-dept">＋ 新增部門</button>`;
    const btn = document.getElementById('btn-add-dept');
    if (btn) btn.onclick = () => onOpenAddDept();
  }
}

function onOpenAddDept() {
  if (typeof L.openAddDeptModal === 'function') {
    L.openAddDeptModal(async () => {
      await loadData();
    });
  } else {
    L.toast('未找到新增部門視窗函式', 'error');
  }
}

function onRenameDept(d) {
  if (typeof L.openRenameDeptModal === 'function') {
    L.openRenameDeptModal({ id: d.id, name: d.name }, async () => {
      await loadData();
    });
  }
}

async function onAddMember(d) {
  let list = allUsers;
  try {
    const data = await L.api('/api/users');
    list = data.users || [];
    if (L.state) L.state.users = list;
  } catch {
    /* fallback to cached */
  }
  if (typeof L.openAddUserToDeptModal === 'function') {
    L.openAddUserToDeptModal({ id: d.id, name: d.name }, list, async () => {
      await loadData();
    });
  }
}

async function onDeleteDept(d) {
  const count = Number((d.members || []).length);
  if (count > 0) {
    L.toast(`「${d.name}」尚有 ${count} 位成員，請先將成員「移出此部門」`, 'error');
    return;
  }
  if (!confirm(`確定刪除部門「${d.name}」？`)) return;
  try {
    await L.api(`/api/departments/${d.id}`, { method: 'DELETE' });
    L.toast('部門已刪除', 'success');
    if (typeof L.refreshDeptLists === 'function') await L.refreshDeptLists();
    await loadData();
  } catch (err) {
    L.toast(err.message, 'error');
  }
}

async function onRemoveFromDept(d, m) {
  if (!confirm(`確定將「${m.name}」移出「${d.name}」？\n帳號保留；若還隸屬其他部門，其他部門不受影響。`)) {
    return;
  }
  try {
    await L.api(`/api/departments/${d.id}/members/${m.id}`, { method: 'DELETE' });
    L.toast(`已將「${m.name}」移出「${d.name}」`, 'success');
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
