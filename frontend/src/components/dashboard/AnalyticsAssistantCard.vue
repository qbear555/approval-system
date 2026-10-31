<template>
  <div class="card analytics-ai-card" style="margin-bottom:20px;border:1px solid #c7d2fe;background:linear-gradient(180deg, #f8faff 0%, #ffffff 100%);box-shadow:0 4px 12px rgba(99,102,241,0.06);padding:20px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:14px">
      <div>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:1.35rem">🧠</span>
          <h3 style="margin:0;font-size:1.15rem;color:#1e1b4b">企業簽核戰情 AI 智慧問答</h3>
          <span class="badge" style="background:#e0e7ff;color:#4338ca;font-weight:600;font-size:0.75rem;padding:2px 8px">Text-to-SQL & BI</span>
        </div>
        <p style="margin:4px 0 0;font-size:0.88rem;color:#475569">
          直接輸入自然語言問題，由地端 AI 自動查詢簽核資料庫並產出統計表格與經營決策洞察報告。
        </p>
      </div>
      <div v-if="historyData" style="font-size:0.8rem;color:#64748b;text-align:right">
        <span>耗時 {{ executionTime }} 秒 · 取得 {{ totalRows }} 筆數據</span>
      </div>
    </div>

    <!-- 常用問答推薦 Pill -->
    <div class="quick-prompts-bar" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
      <button
        v-for="(p, idx) in quickPrompts"
        :key="idx"
        type="button"
        class="prompt-pill"
        :disabled="loading"
        @click="selectPrompt(p)"
      >
        {{ p }}
      </button>
    </div>

    <!-- 提問輸入框 -->
    <form class="query-form" style="display:flex;gap:10px;margin-bottom:14px" @submit.prevent="runQuery">
      <input
        v-model="questionInput"
        type="text"
        class="query-input"
        placeholder="例如：本月各部門請款總額？ 或 卡關停留最久的待辦單據有哪些？"
        :disabled="loading"
        style="flex:1;padding:10px 14px;border:1px solid #cbd5e1;border-radius:8px;font-size:0.95rem;background:#fff"
      />
      <button
        type="submit"
        class="btn primary"
        :disabled="loading || !questionInput.trim()"
        style="padding:0 22px;white-space:nowrap;font-weight:600;background:#4f46e5;border-color:#4f46e5"
      >
        {{ loading ? '戰情分析中…' : '戰情分析 ⚡' }}
      </button>
    </form>

    <!-- 載入中動畫 -->
    <div v-if="loading" style="padding:24px;text-align:center;background:#f8fafc;border-radius:8px;margin-bottom:14px">
      <div style="font-size:1.8rem;margin-bottom:8px;animation:ai-spin 2s infinite linear">🧠</div>
      <div style="font-weight:600;color:#334155;font-size:0.95rem">AI 正在進行戰情分析…</div>
      <div style="font-size:0.85rem;color:#64748b;margin-top:4px">
        正在解析自然語言問題、生成安全讀取 SQL 並調度地端模型產出管理洞察…
      </div>
    </div>

    <!-- 錯誤訊息 -->
    <div v-if="errorMessage" style="padding:12px 16px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:#991b1b;margin-bottom:14px;font-size:0.9rem">
      <strong>⚠️ 戰情查詢提示：</strong> {{ errorMessage }}
    </div>

    <!-- 結果展示 -->
    <div v-if="historyData && !loading" class="analytics-results" style="display:flex;flex-direction:column;gap:14px">
      <!-- 洞察報告區 -->
      <div v-if="displaySummary" class="insight-box" style="padding:14px 18px;background:#eef2ff;border-left:4px solid #6366f1;border-radius:6px;font-size:0.92rem;line-height:1.7;color:#1e1b4b">
        <div style="font-weight:700;color:#3730a3;margin-bottom:6px;display:flex;align-items:center;gap:6px">
          <span>📊 戰情決策洞察</span>
        </div>
        <div style="white-space:pre-wrap">{{ displaySummary }}</div>
      </div>

      <!-- 數據表格 -->
      <div v-if="historyData.rows && historyData.rows.length" class="table-wrap" style="max-height:360px;overflow:auto;border:1px solid #e2e8f0;border-radius:6px">
        <table class="data" style="width:100%;margin:0;font-size:0.88rem">
          <thead>
            <tr style="background:#f1f5f9;position:sticky;top:0;z-index:2">
              <th v-for="col in displayColumns" :key="col" style="padding:8px 12px;font-weight:600;color:#334155;border-bottom:1px solid #cbd5e1">
                {{ formatColumnTitle(col) }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, rIdx) in historyData.rows" :key="rIdx" :style="rIdx % 2 === 1 ? 'background:#f8fafc' : ''">
              <td v-for="col in displayColumns" :key="col" style="padding:8px 12px;border-bottom:1px solid #f1f5f9;color:#1e293b">
                {{ formatCellValue(row[col]) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else-if="!historyData.error" class="muted" style="text-align:center;padding:16px;background:#f8fafc;border-radius:6px;font-size:0.88rem">
        查詢成功，但無符合條件的數據記錄。
      </div>

      <!-- 產生的安全 SQL 顯示（支援折疊收合與一鍵複製） -->
      <div v-if="cleanedSql" style="border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;overflow:hidden">
        <div
          style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;cursor:pointer;user-select:none"
          @click="showSqlDetails = !showSqlDetails"
        >
          <div style="display:flex;align-items:center;gap:6px;font-size:0.85rem">
            <span style="font-weight:600;color:#475569">安全讀取 SQL</span>
            <span style="font-size:0.75rem;color:#6366f1">
              {{ showSqlDetails ? '▴ 收起' : '▾ 查看查詢指令' }}
            </span>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <button
              type="button"
              class="btn outline xs"
              style="padding:2px 8px;font-size:0.75rem"
              title="複製 SQL 查詢語句"
              @click.stop="copySql"
            >
              {{ copied ? '已複製 ✓' : '📋 複製 SQL' }}
            </button>
            <span class="tag xs" style="background:#e0f2fe;color:#0369a1">唯讀查詢保護</span>
          </div>
        </div>
        <div v-if="showSqlDetails" style="padding:10px 14px;border-top:1px solid #e2e8f0;background:#ffffff">
          <code style="display:block;white-space:pre-wrap;word-break:break-all;font-family:Consolas, Monaco, monospace;font-size:0.82rem;color:#0f172a;line-height:1.5">
            {{ cleanedSql }}
          </code>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { askAiAnalytics } from '@/api/requests';

const quickPrompts = [
  '📊 各部門待簽核單據數與逾期統計',
  '⏱️ 各流程關卡平均審核耗時排行',
  '🚨 卡關停留超過 5 天的未結單據',
  '📈 近 30 天申請量最高的流程排行',
  '💰 本季核准之採購與請款總額',
];

const questionInput = ref('');
const loading = ref(false);
const errorMessage = ref('');
const historyData = ref(null);
const executionTime = ref(0);
const totalRows = ref(0);
const showSqlDetails = ref(false);
const copied = ref(false);

const cleanedSql = computed(() => {
  let s = historyData.value?.sql || '';
  // 繁體台灣慣用語防呆：替換「程序名稱」為「流程名稱」
  return s.replace(/程序名稱/g, '流程名稱').replace(/程序/g, '流程');
});

const displayColumns = computed(() => {
  return historyData.value?.columns || [];
});

const displaySummary = computed(() => {
  let s = historyData.value?.summary || historyData.value?.insightText || '';
  return s.replace(/程序名稱/g, '流程名稱').replace(/程序/g, '流程');
});

function formatColumnTitle(col) {
  if (col === '程序名稱' || col === '程序') return '流程名稱';
  return col;
}

function selectPrompt(p) {
  questionInput.value = p.replace(/^[^\s]+\s*/, '');
  runQuery();
}

async function runQuery() {
  const q = questionInput.value.trim();
  if (!q) return;
  loading.value = true;
  errorMessage.value = '';
  const startTime = Date.now();
  try {
    const res = await askAiAnalytics(q);
    historyData.value = res;
    executionTime.value = Number(((Date.now() - startTime) / 1000).toFixed(1));
    totalRows.value = Array.isArray(res?.rows) ? res.rows.length : 0;
  } catch (err) {
    errorMessage.value = err.message || 'AI 戰情分析服務暫時無法回應，請確認 AI 服務設定。';
  } finally {
    loading.value = false;
  }
}

function formatCellValue(val) {
  if (val === null || val === undefined) return '—';
  if (typeof val === 'number') {
    return val.toLocaleString();
  }
  return String(val);
}

function copySql() {
  if (!cleanedSql.value) return;
  navigator.clipboard.writeText(cleanedSql.value).then(() => {
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 2000);
  });
}
</script>

<style scoped>
.prompt-pill {
  border: 1px solid #e0e7ff;
  background: #ffffff;
  color: #4338ca;
  padding: 5px 12px;
  border-radius: 999px;
  font-size: 0.82rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease-in-out;
}
.prompt-pill:hover:not(:disabled) {
  background: #eef2ff;
  border-color: #c7d2fe;
  transform: translateY(-1px);
}
@keyframes ai-spin {
  0% { transform: rotate(0deg); }
  50% { transform: scale(1.15); }
  100% { transform: rotate(360deg); }
}
</style>
