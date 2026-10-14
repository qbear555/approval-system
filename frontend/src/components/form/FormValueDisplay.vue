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

const kind = computed(() => {
  if (props.field?.type === 'table' || props.field?.id === 'welfare_items') return 'welfare';
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
