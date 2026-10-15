<template>
  <div class="field field-full dynamic-grid-field" data-col-span="full">
    <div class="grid-header-row">
      <label class="grid-title">
        {{ field.label || '明細清單' }}
        <span v-if="field.required" class="required-star"> *</span>
      </label>
      <span v-if="field.hint" class="muted grid-hint">{{ field.hint }}</span>
    </div>

    <div class="table-responsive">
      <table class="form-view-table dynamic-grid-table">
        <thead>
          <tr>
            <th class="seq-col" style="width: 3rem; text-align: center;">#</th>
            <th
              v-for="col in columns"
              :key="col.id"
              :style="{ width: col.width || 'auto', textAlign: isNumericCol(col) ? 'right' : 'left' }"
            >
              {{ col.label }}
              <span v-if="col.required" style="color: #ef4444;">*</span>
            </th>
            <th class="action-col" style="width: 4.5rem; text-align: center;">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, rIndex) in rows" :key="rIndex">
            <td class="seq-cell" style="text-align: center; color: #64748b; font-size: 0.85rem;">
              {{ rIndex + 1 }}
            </td>
            <td v-for="col in columns" :key="col.id" :style="{ textAlign: isNumericCol(col) ? 'right' : 'left' }">
              <!-- 計算欄位 (自動計算唯讀) -->
              <template v-if="col.type === 'calc' || col.formula">
                <span class="calc-val font-mono" style="font-weight: 600; color: #1e293b;">
                  {{ formatNumber(getRowCalc(row, col)) }}
                </span>
              </template>

              <!-- 下拉選單 -->
              <select
                v-else-if="col.type === 'select'"
                class="grid-input"
                :value="row[col.id]"
                :required="col.required"
                @change="updateCell(rIndex, col.id, $event.target.value)"
              >
                <option value="">請選擇…</option>
                <option v-for="opt in col.options || []" :key="opt" :value="opt">{{ opt }}</option>
              </select>

              <!-- 日期選取 -->
              <input
                v-else-if="col.type === 'date'"
                type="date"
                class="grid-input"
                :value="row[col.id]"
                :required="col.required"
                @input="updateCell(rIndex, col.id, $event.target.value)"
              />

              <!-- 數值輸入 -->
              <input
                v-else-if="col.type === 'number'"
                type="number"
                :step="col.step || '1'"
                :min="col.min != null ? col.min : 0"
                inputmode="decimal"
                class="grid-input text-right font-mono"
                style="text-align: right;"
                :value="row[col.id]"
                :placeholder="col.placeholder || '0'"
                :required="col.required"
                @input="updateCell(rIndex, col.id, $event.target.value)"
              />

              <!-- 一般文字輸入 -->
              <input
                v-else
                type="text"
                class="grid-input"
                :value="row[col.id]"
                :placeholder="col.placeholder || ''"
                :required="col.required"
                @input="updateCell(rIndex, col.id, $event.target.value)"
              />
            </td>
            <td style="text-align: center; white-space: nowrap;">
              <button
                type="button"
                class="btn sm outline btn-del-row"
                style="color: #ef4444; border-color: #fca5a5; padding: 2px 8px; font-size: 0.8rem;"
                title="刪除此列"
                :disabled="rows.length <= (field.minRows || 1)"
                @click="removeRow(rIndex)"
              >
                刪除
              </button>
            </td>
          </tr>
        </tbody>
        <tfoot v-if="hasSummaryCols">
          <tr class="grid-summary-row" style="background: #f8fafc; font-weight: 600;">
            <td colspan="2" style="text-align: center; color: #475569;">合計</td>
            <td
              v-for="col in columns.slice(1)"
              :key="'sum-' + col.id"
              :style="{ textAlign: isNumericCol(col) ? 'right' : 'left' }"
            >
              <span v-if="shouldSumCol(col)" class="font-mono" style="color: #0f172a;">
                {{ formatNumber(colSums[col.id] || 0) }}
              </span>
            </td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>

    <div class="grid-toolbar" style="margin-top: 10px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
      <button type="button" class="btn sm outline" style="display: inline-flex; align-items: center; gap: 4px;" @click="addRow">
        <span>➕</span> 新增一列
      </button>
      <div v-if="grandTotal != null" class="grand-total-banner" style="font-size: 0.95rem; font-weight: 600; color: #1e3a8a; background: #eff6ff; padding: 4px 12px; border-radius: 6px; border: 1px solid #bfdbfe;">
        總計金額：NT$ {{ formatNumber(grandTotal) }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, watch } from 'vue';
import { useFormCtx } from '@/lib/form/context';

const props = defineProps({
  field: { type: Object, required: true },
});

const ctx = useFormCtx();

// 預設欄位定義（採購/品項標準明細表）
const DEFAULT_COLUMNS = [
  { id: 'item', label: '項目/品名', type: 'text', width: '25%', required: true },
  { id: 'spec', label: '規格/型號/說明', type: 'text', width: '25%' },
  { id: 'qty', label: '數量', type: 'number', width: '12%', step: '1', min: 0, required: true },
  { id: 'price', label: '單價', type: 'number', width: '15%', step: 'any', min: 0, required: true },
  { id: 'subtotal', label: '小計', type: 'calc', formula: 'qty * price', width: '18%' },
];

const columns = computed(() => {
  if (Array.isArray(props.field.columns) && props.field.columns.length > 0) {
    return props.field.columns;
  }
  return DEFAULT_COLUMNS;
});

function isNumericCol(col) {
  return col.type === 'number' || col.type === 'calc' || !!col.formula;
}

function shouldSumCol(col) {
  if (col.sum === false) return false;
  return col.type === 'number' || col.type === 'calc' || !!col.formula || col.sum === true;
}

function createEmptyRow() {
  const row = {};
  for (const c of columns.value) {
    row[c.id] = c.default != null ? c.default : (c.type === 'number' ? 0 : '');
  }
  return row;
}

function parseInitialRows(raw) {
  if (Array.isArray(raw) && raw.length > 0) return raw;
  if (typeof raw === 'string' && raw.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {}
  }
  const minRows = Math.max(Number(props.field.minRows) || 1, 1);
  return Array.from({ length: minRows }, () => createEmptyRow());
}

const rows = computed(() => {
  const val = ctx.data.value?.[props.field.id];
  return parseInitialRows(val);
});

function evalFormula(formula, row) {
  if (!formula) return 0;
  try {
    const expr = formula.replace(/[A-Za-z0-9_]+/g, (k) => {
      const v = Number(row[k]);
      return Number.isFinite(v) ? v : 0;
    });
    if (!/^[0-9+\-*/().\s]+$/.test(expr)) return 0;
    const res = Function(`"use strict"; return (${expr})`)();
    return Number.isFinite(res) ? Math.round(res * 100) / 100 : 0;
  } catch {
    return 0;
  }
}

function getRowCalc(row, col) {
  if (col.formula) {
    const val = evalFormula(col.formula, row);
    row[col.id] = val;
    return val;
  }
  return Number(row[col.id]) || 0;
}

function formatNumber(num) {
  const n = Number(num);
  if (!Number.isFinite(n)) return '0';
  return new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 2 }).format(n);
}

function updateCell(rowIndex, colId, value) {
  const nextRows = rows.value.map((r, i) => (i === rowIndex ? { ...r, [colId]: value } : { ...r }));
  commitRows(nextRows);
}

function addRow() {
  const nextRows = [...rows.value, createEmptyRow()];
  commitRows(nextRows);
}

function removeRow(index) {
  if (rows.value.length <= (Number(props.field.minRows) || 1)) return;
  const nextRows = rows.value.filter((_, i) => i !== index);
  commitRows(nextRows);
}

function commitRows(nextRows) {
  // 自動更新所有計算欄位數值
  for (const r of nextRows) {
    for (const c of columns.value) {
      if (c.type === 'calc' || c.formula) {
        r[c.id] = evalFormula(c.formula, r);
      }
    }
  }
  ctx.set(props.field.id, nextRows);
}

// 欄位小計與總和
const colSums = computed(() => {
  const sums = {};
  for (const c of columns.value) {
    if (shouldSumCol(c)) {
      sums[c.id] = rows.value.reduce((acc, r) => {
        const val = c.formula ? evalFormula(c.formula, r) : Number(r[c.id] || 0);
        return acc + (Number.isFinite(val) ? val : 0);
      }, 0);
    }
  }
  return sums;
});

const hasSummaryCols = computed(() => {
  return columns.value.some((c) => shouldSumCol(c));
});

// 若有總金額欄（如 subtotal 或 amount），計算整體大寫/總計
const grandTotal = computed(() => {
  // 優先查找名為 subtotal 或 amount 或 total 的合計
  const targetCol = columns.value.find((c) => ['subtotal', 'amount', 'total', 'price'].includes(c.id) && shouldSumCol(c));
  if (targetCol) {
    return colSums.value[targetCol.id] || 0;
  }
  return null;
});

// 當明細總額改變，若流程表單配置有 totalField（例如 amount），自動同步主表金額
watch(grandTotal, (newTotal) => {
  if (newTotal != null && props.field.totalField) {
    ctx.set(props.field.totalField, newTotal);
  }
}, { immediate: true });
</script>

<style scoped>
.dynamic-grid-field {
  margin-top: 10px;
  margin-bottom: 14px;
}
.grid-header-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 6px;
}
.grid-title {
  font-weight: 600;
  color: #1e293b;
  font-size: 0.95rem;
}
.required-star {
  color: #ef4444;
}
.grid-hint {
  font-size: 0.82rem;
  color: #64748b;
}
.table-responsive {
  overflow-x: auto;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #ffffff;
}
.dynamic-grid-table {
  width: 100%;
  border-collapse: collapse;
}
.dynamic-grid-table th {
  background: #f1f5f9;
  color: #334155;
  font-weight: 600;
  font-size: 0.85rem;
  padding: 8px 10px;
  border-bottom: 1px solid #cbd5e1;
}
.dynamic-grid-table td {
  padding: 6px 8px;
  border-bottom: 1px solid #f1f5f9;
  vertical-align: middle;
}
.grid-input {
  width: 100%;
  box-sizing: border-box;
  padding: 5px 8px;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  font-size: 0.88rem;
  transition: border-color 0.15s ease-in-out;
}
.grid-input:focus {
  border-color: #3b82f6;
  outline: none;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.15);
}
.text-right {
  text-align: right;
}
.font-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
</style>
