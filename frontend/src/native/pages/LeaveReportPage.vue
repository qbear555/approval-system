<template>
  <div v-if="!allowed" class="error-msg">您沒有「請假報表匯出」權限（請洽系統管理員於成員權限中開啟）</div>
  <div v-else class="card" style="max-width:960px">
    <h3 style="margin-top:0">請假資料匯出（Excel）</h3>
    <p class="muted" style="margin-top:0;line-height:1.55">
      供<strong>人事單位</strong>匯出：可勾選<strong>多人</strong>、指定日期範圍。
      僅統計<strong>已核准</strong>請假。
      報表為<strong>一人一列</strong>：各有上限假別的<strong>應有／已請／剩餘／可請</strong>（天數），方便多人比對。
    </p>
    <div class="form-grid two" style="margin-bottom:12px">
      <div class="field">
        <label>日期起 *</label>
        <input v-model="dateFrom" type="date" id="lr-from" required />
      </div>
      <div class="field">
        <label>日期迄 *</label>
        <input v-model="dateTo" type="date" id="lr-to" required />
      </div>
    </div>
    <div class="field" style="margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <label style="margin:0">選擇人員 *（{{ users.length }} 人）</label>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="btn outline sm" id="lr-all" @click="selected = users.map((u) => u.id)">全選</button>
          <button type="button" class="btn outline sm" id="lr-none" @click="selected = []">全不選</button>
          <span class="muted" id="lr-count">已選 {{ selected.length }} 人</span>
        </div>
      </div>
      <div
        class="approver-list"
        id="lr-user-list"
        style="margin-top:8px;max-height:280px;overflow:auto;border:1px solid var(--border);border-radius:10px;padding:10px"
      >
        <label v-for="u in users" :key="u.id" style="display:flex;align-items:center;gap:8px;padding:4px 0">
          <input v-model="selected" type="checkbox" :value="u.id" />
          <span>
            <strong>{{ u.name }}</strong>
            <span class="muted">（{{ u.username }}）</span>
            <span v-if="u.department" class="muted">· {{ u.department }}</span>
          </span>
        </label>
        <div v-if="!users.length" class="muted">尚無成員</div>
      </div>
    </div>
    <div class="form-actions" style="margin-top:16px">
      <button type="button" class="btn primary" id="lr-export" :disabled="busy" @click="doExport">匯出 Excel</button>
    </div>
    <p class="muted" style="font-size:0.82rem;margin-top:12px;line-height:1.45">
      Excel：
      <strong>人員餘額</strong>（一人一列 · 特休／事假／病假／祭儀等 · 應有／已請／剩餘／可請天數）、
      <strong>請假明細</strong>（期間已核准）、
      <strong>說明</strong>。
    </p>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { L } from '@/native/bridge';

const allowed = L.hasPerm('leave_report');
const users = ref([]);
const selected = ref([]);
const busy = ref(false);

const t = new Date();
const y = t.getFullYear();
const dateTo = ref(`${y}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`);
const dateFrom = ref(`${y}-01-01`);

if (allowed) {
  await L.loadUsers();
  users.value = (L.state.users || []).filter((u) => u.active !== 0);
}

async function doExport() {
  const userIds = selected.value.map(Number);
  if (!userIds.length) return L.toast('請至少選擇一位人員', 'error');
  if (!dateFrom.value || !dateTo.value) return L.toast('請選擇日期範圍', 'error');
  if (dateFrom.value > dateTo.value) return L.toast('起始日期不可晚於結束日期', 'error');
  busy.value = true;
  try {
    // 一律僅匯出已核准
    const blob = await L.api('/api/reports/leave-export', {
      method: 'POST',
      body: { userIds, dateFrom: dateFrom.value, dateTo: dateTo.value },
      expectBlob: true,
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `請假報表_${dateFrom.value}_${dateTo.value}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
    L.toast('Excel 已開始下載', 'success');
  } catch (e) {
    L.toast(e.message || '匯出失敗', 'error');
  } finally {
    busy.value = false;
  }
}
</script>
