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
              <td style="white-space:normal;word-break:break-word;line-height:1.5;color:#334155">{{ htmlToPlain(l.description) }}</td>
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
import { apiRequest } from '@/api/client';
import { htmlToPlain } from '@/lib/form/html';
import { useToastStore } from '@/stores/toast';
import { reactive, ref } from 'vue';
import { auditListQuery } from '@/lib/audit-list-query';
import EmptyState from '@/components/common/EmptyState.vue';
const toast = useToastStore();

const categoryLabels = {
  auth: '🔒 帳號身份與登入',
  approval: '📝 流程與簽核動作',
  user_management: '👥 成員與權限變更',
  workflow: '⚙️ 簽核流程範本',
  system: '🛠️ 系統維運與設定',
};

const page = ref(Number(auditListQuery.page) || 1);
const form = reactive({
  q: String(auditListQuery.q || '').trim(),
  category: String(auditListQuery.category || '').trim(),
  dateFrom: String(auditListQuery.dateFrom || '').trim(),
  dateTo: String(auditListQuery.dateTo || '').trim(),
});
const data = ref({ logs: [], totalCount: 0, totalPages: 1 });

function currentParams() {
  const p = new URLSearchParams({ page: Number(auditListQuery.page) || 1, limit: 30 });
  if (String(auditListQuery.q || '').trim()) p.set('q', String(auditListQuery.q).trim());
  if (String(auditListQuery.category || '').trim()) p.set('category', String(auditListQuery.category).trim());
  if (String(auditListQuery.dateFrom || '').trim()) p.set('dateFrom', String(auditListQuery.dateFrom).trim());
  if (String(auditListQuery.dateTo || '').trim()) p.set('dateTo', String(auditListQuery.dateTo).trim());
  return p;
}

async function load() {
  page.value = Number(auditListQuery.page) || 1;
  try {
    data.value = await apiRequest(`/api/system/audit-logs?${currentParams().toString()}`);
  } catch (err) {
    toast.error(err.message);
    data.value = { logs: [], totalCount: 0, totalPages: 1 };
  }
}

function onSubmit() {
  auditListQuery.q = form.q.trim();
  auditListQuery.category = form.category.trim();
  auditListQuery.dateFrom = form.dateFrom.trim();
  auditListQuery.dateTo = form.dateTo.trim();
  auditListQuery.page = 1;
  return load();
}

function onClear() {
  auditListQuery.q = '';
  auditListQuery.category = '';
  auditListQuery.dateFrom = '';
  auditListQuery.dateTo = '';
  auditListQuery.page = 1;
  Object.assign(form, { q: '', category: '', dateFrom: '', dateTo: '' });
  return load();
}

function go(n) {
  auditListQuery.page = n;
  return load();
}

async function onExport() {
  try {
    const blob = await apiRequest(`/api/system/audit-logs/export?${currentParams().toString()}`, { expectBlob: true });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    toast.error(err.message);
  }
}

await load();
</script>
