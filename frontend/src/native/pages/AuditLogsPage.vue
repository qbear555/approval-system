<template>
  <div class="card">
    <form id="audit-filter-form" class="req-filter-bar" style="margin-bottom:16px;padding:16px 18px" @submit.prevent="onSubmit">
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:14px;align-items:end">
        <div class="field" style="margin:0">
          <label>關鍵字搜尋</label>
          <input v-model="form.q" type="search" name="q" placeholder="使用者姓名、帳號、IP、說明關鍵字…" autocomplete="off" />
        </div>
        <div class="field" style="margin:0">
          <label>日誌分類</label>
          <select v-model="form.category" name="category">
            <option value="">全部分類</option>
            <option v-for="(label, k) in categoryLabels" :key="k" :value="k">{{ label }}</option>
          </select>
        </div>
        <div class="field" style="margin:0">
          <label>發生日期（起～迄）</label>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:nowrap">
            <input v-model="form.dateFrom" type="date" name="dateFrom" style="flex:1;min-width:120px" />
            <span class="muted" style="flex-shrink:0">～</span>
            <input v-model="form.dateTo" type="date" name="dateTo" style="flex:1;min-width:120px" />
          </div>
        </div>
      </div>
      <div class="form-actions" style="margin-top:14px;display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px">
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <button type="submit" class="btn primary sm">查詢日誌</button>
          <button type="button" class="btn outline sm" id="btn-audit-clear" @click.prevent="onClear">清除條件</button>
          <span class="muted" style="font-size:0.85rem">共 <strong>{{ data.totalCount || 0 }}</strong> 筆日誌</span>
        </div>
        <button type="button" class="btn outline sm" id="btn-audit-export" @click="onExport">📥 匯出 CSV 報告</button>
      </div>
    </form>

    <EmptyState v-if="!data.logs || !data.logs.length" title="尚無稽核日誌" desc="目前沒有符合篩選條件的系統稽核紀錄。" />
    <template v-else>
      <div class="table-wrap">
        <table class="data" style="width:100%;min-width:1040px;table-layout:fixed">
          <thead>
            <tr>
              <th style="width:150px;white-space:nowrap">時間</th>
              <th style="width:175px;white-space:nowrap">分類</th>
              <th style="width:130px;white-space:nowrap">執行人員</th>
              <th style="width:150px;white-space:nowrap">IP 位址</th>
              <th style="min-width:320px">說明詳情</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(l, i) in data.logs" :key="i" style="vertical-align:top">
              <td class="muted" style="white-space:nowrap">{{ l.created_at }}</td>
              <td style="white-space:nowrap">
                <span class="tag draft" style="font-size:0.75rem">{{ categoryLabels[l.category] || l.category || '一般' }}</span>
              </td>
              <td style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                <strong>{{ l.user_name || '系統/訪客' }}</strong>
                <span v-if="l.user_username" class="muted" style="font-size:0.78rem">(@{{ l.user_username }})</span>
              </td>
              <td style="white-space:nowrap"><code>{{ l.ip_address || '—' }}</code></td>
              <td style="white-space:normal;word-break:break-word;line-height:1.5;color:#334155">{{ L.htmlToPlainText(l.description) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="data.totalPages > 1" class="pagination">
        <button type="button" class="page-btn" id="btn-audit-prev" :disabled="page <= 1" @click="go(page - 1)">上一頁</button>
        <span style="font-size:0.88rem;color:#475569;font-weight:600;padding:0 6px">第 {{ page }} / {{ data.totalPages }} 頁</span>
        <button type="button" class="page-btn" id="btn-audit-next" :disabled="page >= data.totalPages" @click="go(page + 1)">下一頁</button>
      </div>
    </template>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue';
import { L } from '@/native/bridge';
import EmptyState from '@/native/components/EmptyState.vue';

const categoryLabels = {
  auth: '🔒 帳號身份與登入',
  approval: '📝 流程與簽核動作',
  user_management: '👥 成員與權限變更',
  workflow: '⚙️ 簽核流程範本',
  system: '🛠️ 系統維運與設定',
};

const query = L.state.auditListQuery || {};
const page = ref(Number(query.page) || 1);
const form = reactive({
  q: String(query.q || '').trim(),
  category: String(query.category || '').trim(),
  dateFrom: String(query.dateFrom || '').trim(),
  dateTo: String(query.dateTo || '').trim(),
});
const data = ref({ logs: [], totalCount: 0, totalPages: 1 });

/** 目前套用中的篩選（存在全域 state，切頁後仍保留） */
function currentParams() {
  const q = L.state.auditListQuery || {};
  const p = new URLSearchParams({ page: Number(q.page) || 1, limit: 30 });
  if (String(q.q || '').trim()) p.set('q', String(q.q).trim());
  if (String(q.category || '').trim()) p.set('category', String(q.category).trim());
  if (String(q.dateFrom || '').trim()) p.set('dateFrom', String(q.dateFrom).trim());
  if (String(q.dateTo || '').trim()) p.set('dateTo', String(q.dateTo).trim());
  return p;
}

async function load() {
  page.value = Number((L.state.auditListQuery || {}).page) || 1;
  try {
    data.value = await L.api(`/api/system/audit-logs?${currentParams().toString()}`);
  } catch (err) {
    L.toast(err.message, 'error');
    data.value = { logs: [], totalCount: 0, totalPages: 1 };
  }
}

function onSubmit() {
  L.state.auditListQuery = {
    q: form.q.trim(),
    category: form.category.trim(),
    dateFrom: form.dateFrom.trim(),
    dateTo: form.dateTo.trim(),
    page: 1,
  };
  return load();
}

function onClear() {
  L.state.auditListQuery = {};
  Object.assign(form, { q: '', category: '', dateFrom: '', dateTo: '' });
  return load();
}

function go(n) {
  L.state.auditListQuery = { ...L.state.auditListQuery, page: n };
  return load();
}

async function onExport() {
  try {
    const blob = await L.api(`/api/system/audit-logs/export?${currentParams().toString()}`, { expectBlob: true });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    L.toast(err.message, 'error');
  }
}

await load();
</script>
