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
      <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
        <button type="button" class="btn sm outline" style="display: inline-flex; align-items: center; gap: 4px;" @click="addRow">
          <span>➕</span> 新增一列
        </button>
        <button
          type="button"
          class="btn sm outline"
          style="display: inline-flex; align-items: center; gap: 4px; border-color: #818cf8; color: #4338ca; background: #eef2ff; font-weight: 500;"
          title="上傳發票/收據圖檔或貼上內容，由 AI 自動解析品項與金額帶入表格"
          @click="openOcrModal"
        >
          <span>🧾✨</span> AI 發票/收據辨識帶入
        </button>
      </div>
      <div v-if="grandTotal != null" class="grand-total-banner" style="font-size: 0.95rem; font-weight: 600; color: #1e3a8a; background: #eff6ff; padding: 4px 12px; border-radius: 6px; border: 1px solid #bfdbfe;">
        總計金額：NT$ {{ formatNumber(grandTotal) }}
      </div>
    </div>

    <!-- AI 發票/憑證辨識彈窗 -->
    <Teleport to="body">
      <div v-if="showOcrModal" class="ai-ocr-modal-backdrop" @click.self="showOcrModal = false">
        <div class="ai-ocr-modal-card">
          <div class="ai-ocr-modal-header">
            <div style="display:flex;align-items:center;gap:8px">
              <span style="font-size:1.3rem">🧾✨</span>
              <div>
                <h3 style="margin:0;font-size:1.05rem">AI 發票／收據明細自動辨識</h3>
                <span class="muted" style="font-size:0.82rem">支援電子發票、統編收據、高鐵機票與支出憑證</span>
              </div>
            </div>
            <button type="button" class="btn sm outline" @click="showOcrModal = false">✕</button>
          </div>

          <div class="ai-ocr-modal-body">
            <!-- 來源選擇標籤 -->
            <div style="display:flex;gap:8px;margin-bottom:12px">
              <button
                type="button"
                class="btn sm"
                :class="ocrTab === 'file' ? 'primary' : 'outline'"
                @click="ocrTab = 'file'"
              >
                📁 上傳發票圖檔/PDF
              </button>
              <button
                type="button"
                class="btn sm"
                :class="ocrTab === 'text' ? 'primary' : 'outline'"
                @click="ocrTab = 'text'"
              >
                📝 貼上發票文字
              </button>
            </div>

            <!-- 檔案上傳區 -->
            <div v-if="ocrTab === 'file'">
              <div
                class="ai-drop-zone"
                @click="fileInputRef?.click()"
                @dragover.prevent
                @drop.prevent="onDropFile"
              >
                <input
                  ref="fileInputRef"
                  type="file"
                  accept=".jpg,.jpeg,.png,.pdf"
                  class="hidden"
                  @change="onFileSelected"
                />
                <div v-if="!selectedFile" style="text-align:center">
                  <div style="font-size:1.8rem;margin-bottom:4px">📄</div>
                  <strong style="color:#4338ca">點擊選取或拖曳發票/收據檔案至此</strong>
                  <div class="muted" style="font-size:0.8rem;margin-top:4px">支援 JPG, PNG, PDF 憑證圖檔</div>
                </div>
                <div v-else style="text-align:center">
                  <span style="font-size:1.4rem">📎</span>
                  <div style="font-weight:600;margin-top:2px">{{ selectedFile.name }}</div>
                  <div class="muted" style="font-size:0.8rem">{{ (selectedFile.size / 1024).toFixed(1) }} KB</div>
                  <button type="button" class="btn sm outline" style="margin-top:6px" @click.stop="selectedFile = null">重選檔案</button>
                </div>
              </div>
            </div>

            <!-- 文字貼上區 -->
            <div v-else>
              <textarea
                v-model="pasteText"
                rows="4"
                style="width:100%;border:1px solid #cbd5e1;border-radius:8px;padding:8px;font-size:0.88rem"
                placeholder="例如：統一發票 AA-88991234 日期 2026-10-25 賣方順發3C 統編23891024 1.螢幕x2 $9000 2.傳輸線x2 $600 總計 10080"
              ></textarea>
            </div>

            <!-- 辨識中進度 -->
            <div v-if="parsing" style="text-align:center;padding:16px;background:#f8fafc;border-radius:8px;margin-top:12px">
              <div class="spinner-sm" style="margin:0 auto 8px"></div>
              <strong style="color:#4338ca">RTX 5080 AI 智慧分析發票憑證中…</strong>
              <div class="muted" style="font-size:0.82rem;margin-top:4px">正在辨識品項明細、單價數量與稅額</div>
            </div>

            <!-- 辨識成果預覽 -->
            <div v-if="parsedResult && !parsing" style="margin-top:14px">
              <div class="ai-invoice-card">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                  <strong style="color:#1e40af;font-size:0.95rem">
                    {{ parsedResult.sellerName || '憑證品項' }}
                  </strong>
                  <span class="tag" style="background:#dbeafe;color:#1e40af;font-weight:600">
                    {{ parsedResult.invoiceNo || '無發票號' }}
                  </span>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:0.84rem;color:#475569">
                  <div><strong>開立日期：</strong>{{ parsedResult.date || '未標註' }}</div>
                  <div><strong>賣方統編：</strong>{{ parsedResult.sellerTaxId || '無' }}</div>
                  <div><strong>未稅金額：</strong>NT$ {{ formatNumber(parsedResult.subtotal) }}</div>
                  <div><strong>營業稅：</strong>NT$ {{ formatNumber(parsedResult.tax) }}</div>
                </div>
                <div style="margin-top:6px;padding-top:6px;border-top:1px dashed #cbd5e1;font-weight:600;color:#0f172a;display:flex;justify-content:space-between">
                  <span>總計金額</span>
                  <span style="color:#2563eb">NT$ {{ formatNumber(parsedResult.total) }}</span>
                </div>
              </div>

              <div style="margin-top:12px">
                <strong style="font-size:0.88rem">品項明細（{{ parsedResult.rows?.length || 0 }} 筆）：</strong>
                <div style="max-height:160px;overflow-y:auto;border:1px solid #e2e8f0;border-radius:6px;margin-top:4px">
                  <table class="data" style="margin:0;font-size:0.82rem">
                    <thead>
                      <tr><th>品名</th><th>數量</th><th>單價</th><th>小計</th></tr>
                    </thead>
                    <tbody>
                      <tr v-for="(item, idx) in parsedResult.items || []" :key="idx">
                        <td>{{ item.item }}</td>
                        <td>{{ item.qty }}</td>
                        <td>{{ formatNumber(item.price) }}</td>
                        <td>{{ formatNumber(item.amount) }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          <div class="ai-ocr-modal-footer">
            <button
              v-if="!parsedResult"
              type="button"
              class="btn primary"
              style="width:100%"
              :disabled="parsing || (!selectedFile && !pasteText.trim())"
              @click="startParse"
            >
              {{ parsing ? '辨識中…' : '✨ 開始 AI 辨識' }}
            </button>
            <template v-else>
              <button type="button" class="btn outline" @click="parsedResult = null">
                重新選取
              </button>
              <div style="display:flex;gap:8px">
                <button type="button" class="btn outline" @click="applyInvoiceRows(false)">
                  ➕ 追加至清單
                </button>
                <button type="button" class="btn primary" @click="applyInvoiceRows(true)">
                  🔄 替換表格內容
                </button>
              </div>
            </template>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { useFormCtx } from '@/lib/form/context';
import { apiRequest } from '@/api/client';
import { useToastStore } from '@/stores/toast';

const props = defineProps({
  field: { type: Object, required: true },
});

const ctx = useFormCtx();
const toast = useToastStore();

const showOcrModal = ref(false);
const ocrTab = ref('file');
const fileInputRef = ref(null);
const selectedFile = ref(null);
const pasteText = ref('');
const parsing = ref(false);
const parsedResult = ref(null);

function openOcrModal() {
  showOcrModal.value = true;
  parsedResult.value = null;
  selectedFile.value = null;
  pasteText.value = '';
}

function onFileSelected(e) {
  const f = e.target.files?.[0];
  if (f) selectedFile.value = f;
}

function onDropFile(e) {
  const f = e.dataTransfer.files?.[0];
  if (f) selectedFile.value = f;
}

async function startParse() {
  parsing.value = true;
  try {
    let imageBase64 = null;
    let textContent = pasteText.value.trim();

    if (selectedFile.value) {
      imageBase64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(selectedFile.value);
      });
    }

    const res = await apiRequest('/api/ai/parse-invoice', {
      method: 'POST',
      body: {
        imageBase64,
        textContent,
        columns: columns.value,
      },
    });

    if (res && res.success) {
      parsedResult.value = res;
      toast.success(`發票辨識成功！共識別 ${res.rows?.length || 0} 個品項`);
    } else {
      throw new Error(res.error || '未能識別發票內容');
    }
  } catch (err) {
    toast.error(err.message || '發票辨識失敗');
  } finally {
    parsing.value = false;
  }
}

function applyInvoiceRows(overwrite = false) {
  if (!parsedResult.value || !Array.isArray(parsedResult.value.rows)) return;
  const newRows = parsedResult.value.rows;

  if (overwrite) {
    rows.value = newRows;
  } else {
    if (rows.value.length === 1 && !rows.value[0].item && !rows.value[0].price) {
      rows.value = newRows;
    } else {
      rows.value.push(...newRows);
    }
  }

  showOcrModal.value = false;
  toast.success(`已帶入 ${newRows.length} 筆明細至表格！`);
}

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

/* AI OCR Modal */
.ai-ocr-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.65);
  backdrop-filter: blur(4px);
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
.ai-ocr-modal-card {
  background: #ffffff;
  border-radius: 12px;
  width: 100%;
  max-width: 580px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.2);
  overflow: hidden;
  color: #1e293b;
}
.ai-ocr-modal-header {
  padding: 14px 18px;
  border-bottom: 1px solid #e2e8f0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #f8fafc;
}
.ai-ocr-modal-body {
  padding: 16px 18px;
  overflow-y: auto;
}
.ai-drop-zone {
  border: 2px dashed #818cf8;
  background: #f5f3ff;
  border-radius: 10px;
  padding: 24px 16px;
  cursor: pointer;
  transition: all 0.2s ease;
}
.ai-drop-zone:hover {
  background: #ede9fe;
  border-color: #6366f1;
}
.ai-invoice-card {
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 8px;
  padding: 12px 14px;
}
.ai-ocr-modal-footer {
  padding: 12px 18px;
  border-top: 1px solid #e2e8f0;
  background: #f8fafc;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.hidden {
  display: none;
}
.spinner-sm {
  width: 24px;
  height: 24px;
  border: 3px solid #e2e8f0;
  border-top-color: #6366f1;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
