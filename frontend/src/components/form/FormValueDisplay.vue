<template>
  <div v-if="kind === 'welfare'" class="form-value-block" v-html="welfareHtml"></div>
  <div v-else-if="kind === 'followup'" class="form-value-block">
    <table v-if="followupRows.length" class="form-view-table followup-ledger">
      <thead>
        <tr>
          <th>後續交辦事項</th>
          <th>承辦人</th>
          <th>完成期限</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(it, i) in followupRows" :key="i">
          <td>{{ it.item }}</td>
          <td>{{ it.owner }}</td>
          <td>{{ it.due }}</td>
        </tr>
      </tbody>
    </table>
    <span v-else>—</span>
  </div>
  <div v-else-if="kind === 'dynamic_grid'" class="form-value-block">
    <div style="overflow-x: auto;">
      <table class="form-view-table dynamic-grid-view">
        <thead>
          <tr>
            <th style="width: 2.5rem; text-align: center;">#</th>
            <th
              v-for="col in gridColumns"
              :key="col.id"
              :style="{ textAlign: isColNumeric(col) ? 'right' : 'left' }"
            >
              {{ col.label }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, ri) in gridRows" :key="ri">
            <td style="text-align: center; color: #64748b; font-size: 0.85rem;">{{ ri + 1 }}</td>
            <td
              v-for="col in gridColumns"
              :key="col.id"
              :style="{ textAlign: isColNumeric(col) ? 'right' : 'left' }"
            >
              {{ isColNumeric(col) ? formatGridNumber(row[col.id]) : (row[col.id] || '—') }}
            </td>
          </tr>
        </tbody>
        <tfoot v-if="hasGridSums">
          <tr style="background: #f8fafc; font-weight: 600;">
            <td colspan="2" style="text-align: center; color: #475569;">合計</td>
            <td
              v-for="col in gridColumns.slice(1)"
              :key="'sum-' + col.id"
              :style="{ textAlign: isColNumeric(col) ? 'right' : 'left' }"
            >
              <span v-if="shouldSumGridCol(col)">
                {{ formatGridNumber(gridSums[col.id]) }}
              </span>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>
  <div v-else-if="kind === 'rich'" class="rich-view" v-html="richHtml"></div>
  <div v-else-if="kind === 'table'" class="form-value-block">
    <table class="form-view-table">
      <tbody>
        <tr v-for="(row, ri) in table.cells" :key="ri">
          <component :is="table.header && ri === 0 ? 'th' : 'td'" v-for="(cell, ci) in row" :key="ci">
            {{ cell }}
          </component>
        </tr>
      </tbody>
    </table>
  </div>
  <div v-else-if="kind === 'pre'" class="form-value-pre">{{ text }}</div>
  <template v-else>{{ text }}</template>
</template>

<script setup>
import { computed } from 'vue';
import {
  escapeHtml,
  formatFormValue,
  formatWelfareAmt,
  isProbablyHtml,
  isRichDisplayField,
  normalizeFormTable,
  parseFollowupItems,
  parseWelfareItems,
  summarizeWelfare,
  welfareAmtNum,
  welfareAutoOpeningSummary,
  welfareCurrentRocYear,
} from '@/lib/form';
import { renderRichView } from '@/lib/form/rich';

const props = defineProps({
  field: { type: Object, default: null },
  value: { default: null },
  formData: { type: Object, default: () => ({}) },
  users: { type: Array, default: () => [] },
});

const followupRows = computed(() => parseFollowupItems(props.value));
const table = computed(() => normalizeFormTable(props.formData?.[`${props.field?.id}__table`]));

const gridRows = computed(() => {
  const val = props.value;
  if (Array.isArray(val)) return val;
  if (typeof val === 'string' && val.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }
  return [];
});

const DEFAULT_GRID_COLUMNS = [
  { id: 'item', label: '項目/品名', type: 'text' },
  { id: 'spec', label: '規格/說明', type: 'text' },
  { id: 'qty', label: '數量', type: 'number' },
  { id: 'price', label: '單價', type: 'number' },
  { id: 'subtotal', label: '小計', type: 'calc' },
];

const gridColumns = computed(() => {
  if (Array.isArray(props.field?.columns) && props.field.columns.length > 0) {
    return props.field.columns;
  }
  const first = gridRows.value[0];
  if (first && typeof first === 'object') {
    return Object.keys(first).map((k) => ({
      id: k,
      label: k,
      type: typeof first[k] === 'number' ? 'number' : 'text',
    }));
  }
  return DEFAULT_GRID_COLUMNS;
});

function isColNumeric(col) {
  return col.type === 'number' || col.type === 'calc' || !!col.formula;
}

function shouldSumGridCol(col) {
  if (col.sum === false) return false;
  return col.type === 'number' || col.type === 'calc' || !!col.formula || col.sum === true;
}

function formatGridNumber(num) {
  const n = Number(num);
  if (!Number.isFinite(n)) return '0';
  return new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 2 }).format(n);
}

const gridSums = computed(() => {
  const sums = {};
  for (const c of gridColumns.value) {
    if (shouldSumGridCol(c)) {
      sums[c.id] = gridRows.value.reduce((acc, r) => {
        const val = Number(r[c.id] || 0);
        return acc + (Number.isFinite(val) ? val : 0);
      }, 0);
    }
  }
  return sums;
});

const hasGridSums = computed(() => {
  return gridColumns.value.some((c) => shouldSumGridCol(c));
});

const kind = computed(() => {
  if (props.field?.id === 'welfare_items') return 'welfare';
  if (
    props.field?.type === 'table' ||
    props.field?.type === 'grid' ||
    Array.isArray(props.value) ||
    (typeof props.value === 'string' && props.value.trim().startsWith('[') && props.value.includes('{'))
  ) {
    if (gridRows.value.length > 0) return 'dynamic_grid';
  }
  if (props.field?.id === 'followup_items') return 'followup';
  const raw = props.value == null || props.value === '' ? '' : String(props.value);
  if (
    isRichDisplayField(props.field) &&
    (isProbablyHtml(raw) || props.formData?.[`${props.field?.id}__table`])
  ) {
    return 'rich';
  }
  if (table.value && !isRichDisplayField(props.field)) return 'table';
  const formatted = formatFormValue(props.field, props.value, props.formData, props.users);
  if (formatted !== '—' && (String(formatted).includes('\n') || String(formatted).includes('\r'))) {
    return 'pre';
  }
  return 'text';
});

const text = computed(() => formatFormValue(props.field, props.value, props.formData, props.users));

const welfareHtml = computed(() => {
  const items = parseWelfareItems(props.value);
  const opening = welfareAmtNum(props.formData?.opening_balance);
  let openingSummary = String(props.formData?.opening_summary || '').trim();
  const year = welfareCurrentRocYear(props.formData);
  const month = String(props.formData?.period_month || '').replace(/[^\d]/g, '');
  if (!openingSummary && month) openingSummary = welfareAutoOpeningSummary(month, year);
  const sum = summarizeWelfare(items, opening);
  const rows = sum.rows
    .map(
      (it) => `<tr>
        <td>${escapeHtml(it.date || '')}</td>
        <td>${escapeHtml(it.summary || '')}</td>
        <td style="text-align:right">${escapeHtml(formatWelfareAmt(it.deposit))}</td>
        <td style="text-align:right">${escapeHtml(formatWelfareAmt(it.withdraw))}</td>
        <td style="text-align:right">${escapeHtml(formatWelfareAmt(it.balance, false))}</td>
      </tr>`
    )
    .join('');
  return `<table class="form-view-table" style="width:100%;min-width:420px">
    <thead><tr><th>日期</th><th>摘要</th><th>存入</th><th>支出</th><th>餘額</th></tr></thead>
    <tbody>
      <tr>
        <td></td>
        <td>${escapeHtml(openingSummary || '上月結轉')}</td>
        <td></td><td></td>
        <td style="text-align:right">${escapeHtml(formatWelfareAmt(opening, false))}</td>
      </tr>
      ${rows}
      <tr>
        <td></td><td><strong>合計</strong></td>
        <td style="text-align:right"><strong>${escapeHtml(formatWelfareAmt(sum.sumIn, false))}</strong></td>
        <td style="text-align:right"><strong>${escapeHtml(formatWelfareAmt(sum.sumOut, false))}</strong></td>
        <td style="text-align:right"><strong>${escapeHtml(formatWelfareAmt(sum.closing, false))}</strong></td>
      </tr>
    </tbody>
  </table>`;
});

const richHtml = computed(() => {
  let html = props.value == null ? '' : String(props.value);
  const legacy = normalizeFormTable(props.formData?.[`${props.field?.id}__table`]);
  if (legacy && !/<table/i.test(html)) {
    const rows = legacy.cells
      .map(
        (row, ri) =>
          `<tr>${row
            .map((c) => {
              const tag = legacy.header && ri === 0 ? 'th' : 'td';
              return `<${tag} style="border:1px solid #94a3b8;padding:6px 8px">${escapeHtml(c)}</${tag}>`;
            })
            .join('')}</tr>`
      )
      .join('');
    html += `<table border="1" style="border-collapse:collapse;width:100%"><tbody>${rows}</tbody></table>`;
  }
  return renderRichView(html);
});
</script>
