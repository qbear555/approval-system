<template>
  <div class="card compliance-radar-card" style="margin-bottom:20px;border:1px solid #fed7aa;background:linear-gradient(180deg, #fffaf5 0%, #ffffff 100%);padding:20px;box-shadow:0 4px 14px rgba(234,88,12,0.06)">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:16px">
      <div>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:1.35rem">🚨</span>
          <h3 style="margin:0;font-size:1.15rem;color:#7c2d12">AI 智慧合規異常與拆單稽核雷達</h3>
          <span class="badge" style="background:#ffedd5;color:#c2410c;font-weight:600;font-size:0.75rem;padding:2px 8px">內控防線</span>
        </div>
        <p style="margin:4px 0 0;font-size:0.88rem;color:#78350f">
          自動穿透歷史單據，即時稽核「刻意拆單避審」、「重複發票報銷」、「嚴重超時卡關」與「非工作時間送件」等合規風險。
        </p>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <select v-model="scanDays" style="padding:6px 12px;border:1px solid #fdba74;border-radius:6px;font-size:0.85rem;background:#fff;color:#7c2d12;font-weight:500">
          <option :value="7">掃描近 7 天單據</option>
          <option :value="30">掃描近 30 天單據</option>
          <option :value="90">掃描近 90 天單據</option>
        </select>
        <button
          type="button"
          class="btn primary"
          :disabled="loading"
          style="background:#ea580c;border-color:#ea580c;font-weight:600;padding:6px 16px"
          @click="runScan"
        >
          {{ loading ? '雷達掃描中…' : '執行全域合規掃描 🔍' }}
        </button>
      </div>
    </div>

    <!-- 載入中 -->
    <div v-if="loading" style="padding:24px;text-align:center;background:#fff7ed;border-radius:8px">
      <div style="font-size:1.8rem;margin-bottom:8px">⚡</div>
      <div style="font-weight:600;color:#9a3412">AI 合規稽核雷達掃描中…</div>
      <div style="font-size:0.85rem;color:#c2410c;margin-top:4px">
        正在比對近 {{ scanDays }} 天內所有簽核單據之核決門檻、發票號碼、時間戳記與關卡停留耗時…
      </div>
    </div>

    <!-- 錯誤提示 -->
    <div v-if="errorMessage" style="padding:12px 16px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:#991b1b;margin-bottom:14px;font-size:0.9rem">
      <strong>⚠️ 掃描提示：</strong> {{ errorMessage }}
    </div>

    <!-- 掃描結果 -->
    <template v-if="report && !loading">
      <!-- 4 大核心合規指標卡 -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:12px;margin-bottom:16px">
        <div class="radar-stat-box" :class="{ alert: report.counts.splitOrders > 0 }" @click="activeTab = 'split'">
          <div class="radar-stat-title">🔀 疑似拆單避審</div>
          <div class="radar-stat-val">{{ report.counts.splitOrders }}</div>
          <div class="radar-stat-desc">同人7日內同流程累積逾5萬</div>
        </div>
        <div class="radar-stat-box" :class="{ alert: report.counts.duplicateInvoices > 0 }" @click="activeTab = 'invoices'">
          <div class="radar-stat-title">🧾 重複發票報銷</div>
          <div class="radar-stat-val">{{ report.counts.duplicateInvoices }}</div>
          <div class="radar-stat-desc">同發票號碼跨單申報</div>
        </div>
        <div class="radar-stat-box" :class="{ warn: report.counts.stalledRequests > 0 }" @click="activeTab = 'stalled'">
          <div class="radar-stat-title">⏳ 嚴重超時卡關</div>
          <div class="radar-stat-val">{{ report.counts.stalledRequests }}</div>
          <div class="radar-stat-desc">關卡停滯逾 5 天未核</div>
        </div>
        <div class="radar-stat-box" :class="{ info: report.counts.offHours > 0 }" @click="activeTab = 'offhours'">
          <div class="radar-stat-title">🌙 離峰送件</div>
          <div class="radar-stat-val">{{ report.counts.offHours }}</div>
          <div class="radar-stat-desc">深夜或假日非工作時間送件</div>
        </div>
      </div>

      <!-- AI 稽核總評報告 -->
      <div v-if="report.executiveReport" style="padding:14px 18px;background:#fff7ed;border-left:4px solid #ea580c;border-radius:6px;font-size:0.92rem;line-height:1.7;color:#7c2d12;margin-bottom:16px">
        <div style="font-weight:700;color:#9a3412;margin-bottom:6px;display:flex;align-items:center;gap:6px">
          <span>📋 AI 稽核主管摘要意見</span>
        </div>
        <div style="white-space:pre-wrap">{{ report.executiveReport }}</div>
      </div>

      <!-- 詳細清單切換標籤 -->
      <div style="display:flex;gap:6px;border-bottom:1px solid #e2e8f0;padding-bottom:8px;margin-bottom:12px;overflow-x:auto">
        <button
          type="button"
          class="btn sm"
          :class="activeTab === 'split' ? 'primary' : 'outline'"
          @click="activeTab = 'split'"
        >
          疑似拆單群組 ({{ report.suspectedSplitOrders?.length || 0 }})
        </button>
        <button
          type="button"
          class="btn sm"
          :class="activeTab === 'invoices' ? 'primary' : 'outline'"
          @click="activeTab = 'invoices'"
        >
          重複發票 ({{ report.duplicateInvoices?.length || 0 }})
        </button>
        <button
          type="button"
          class="btn sm"
          :class="activeTab === 'stalled' ? 'primary' : 'outline'"
          @click="activeTab = 'stalled'"
        >
          超時卡關 ({{ report.stalledRequests?.length || 0 }})
        </button>
        <button
          type="button"
          class="btn sm"
          :class="activeTab === 'offhours' ? 'primary' : 'outline'"
          @click="activeTab = 'offhours'"
        >
          離峰送件 ({{ report.offHoursRequests?.length || 0 }})
        </button>
      </div>

      <!-- 疑似拆單清單 -->
      <div v-if="activeTab === 'split'">
        <div v-if="!report.suspectedSplitOrders?.length" class="muted" style="padding:16px;text-align:center">
          ✅ 未偵測到 7 日內刻意拆單規避主管核決門檻之情事。
        </div>
        <div v-else style="display:flex;flex-direction:column;gap:10px">
          <div
            v-for="(grp, idx) in report.suspectedSplitOrders"
            :key="idx"
            style="padding:12px 14px;background:#fef2f2;border:1px solid #fecaca;border-radius:6px;font-size:0.88rem"
          >
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:6px">
              <strong style="color:#991b1b">
                👤 申請人：{{ grp.applicantName }} · 流程：{{ grp.workflowName }}
              </strong>
              <span class="tag alert">
                7日內合計 {{ grp.count }} 筆 · 總額 NT$ {{ (grp.totalAmount || 0).toLocaleString() }}
              </span>
            </div>
            <div style="font-size:0.82rem;color:#7f1d1d">
              涉及單號：
              <router-link
                v-for="reqId in grp.requestIds"
                :key="reqId"
                :to="`/request/${reqId}`"
                class="tag xs"
                style="margin-right:6px;background:#fee2e2;color:#991b1b;text-decoration:underline"
              >
                #{{ reqId }}
              </router-link>
            </div>
          </div>
        </div>
      </div>

      <!-- 重複發票清單 -->
      <div v-if="activeTab === 'invoices'">
        <div v-if="!report.duplicateInvoices?.length" class="muted" style="padding:16px;text-align:center">
          ✅ 未發現重複報銷之發票或收據號碼。
        </div>
        <div v-else style="display:flex;flex-direction:column;gap:10px">
          <div
            v-for="(inv, idx) in report.duplicateInvoices"
            :key="idx"
            style="padding:12px 14px;background:#fef2f2;border:1px solid #fecaca;border-radius:6px;font-size:0.88rem"
          >
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:6px">
              <strong style="color:#991b1b">🧾 發票號碼：{{ inv.invoiceNumber }}</strong>
              <span class="tag alert">重複出現 {{ inv.count }} 次</span>
            </div>
            <div style="font-size:0.82rem;color:#7f1d1d">
              涉及單號：
              <router-link
                v-for="reqId in inv.requestIds"
                :key="reqId"
                :to="`/request/${reqId}`"
                class="tag xs"
                style="margin-right:6px;background:#fee2e2;color:#991b1b;text-decoration:underline"
              >
                #{{ reqId }}
              </router-link>
            </div>
          </div>
        </div>
      </div>

      <!-- 超時卡關清單 -->
      <div v-if="activeTab === 'stalled'">
        <div v-if="!report.stalledRequests?.length" class="muted" style="padding:16px;text-align:center">
          ✅ 目前無超過 5 天嚴重卡關之滯留單據。
        </div>
        <div v-else style="display:flex;flex-direction:column;gap:10px">
          <div
            v-for="st in report.stalledRequests"
            :key="st.id"
            style="padding:10px 14px;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;font-size:0.88rem;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px"
          >
            <div>
              <router-link :to="`/request/${st.id}`" style="font-weight:600;color:#92400e;text-decoration:underline">
                #{{ st.id }} {{ st.title }}
              </router-link>
              <div style="font-size:0.8rem;color:#b45309;margin-top:2px">
                申請人：{{ st.applicant_name }} · 流程：{{ st.workflow_name }}
              </div>
            </div>
            <span class="tag warn">已停留 {{ st.pendingDays }} 天</span>
          </div>
        </div>
      </div>

      <!-- 離峰送件清單 -->
      <div v-if="activeTab === 'offhours'">
        <div v-if="!report.offHoursRequests?.length" class="muted" style="padding:16px;text-align:center">
          ✅ 近期無異常離峰（深夜或週末）大量送件情事。
        </div>
        <div v-else style="display:flex;flex-direction:column;gap:10px">
          <div
            v-for="oh in report.offHoursRequests"
            :key="oh.id"
            style="padding:10px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;font-size:0.88rem;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px"
          >
            <div>
              <router-link :to="`/request/${oh.id}`" style="font-weight:600;color:#1e293b;text-decoration:underline">
                #{{ oh.id }} {{ oh.title }}
              </router-link>
              <div style="font-size:0.8rem;color:#64748b;margin-top:2px">
                申請人：{{ oh.applicant_name }} · 送件時間：{{ oh.created_at }}
              </div>
            </div>
            <span class="tag info">{{ oh.reason }}</span>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { fetchAiComplianceAnomalies } from '@/api/requests';

const scanDays = ref(30);
const loading = ref(false);
const errorMessage = ref('');
const report = ref(null);
const activeTab = ref('split');

async function runScan() {
  loading.value = true;
  errorMessage.value = '';
  try {
    const res = await fetchAiComplianceAnomalies(scanDays.value);
    report.value = res;
    if (res.counts.splitOrders > 0) activeTab.value = 'split';
    else if (res.counts.duplicateInvoices > 0) activeTab.value = 'invoices';
    else if (res.counts.stalledRequests > 0) activeTab.value = 'stalled';
    else activeTab.value = 'offhours';
  } catch (err) {
    errorMessage.value = err.message || 'AI 稽核雷達掃描失敗，請檢查 AI 服務連線狀況。';
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  // 自動載入近 30 天掃描結果
  runScan();
});
</script>

<style scoped>
.radar-stat-box {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 12px 14px;
  cursor: pointer;
  transition: all 0.15s ease-in-out;
}
.radar-stat-box:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 10px rgba(0,0,0,0.05);
}
.radar-stat-box.alert {
  border-color: #fca5a5;
  background: #fef2f2;
}
.radar-stat-box.warn {
  border-color: #fde68a;
  background: #fffbeb;
}
.radar-stat-box.info {
  border-color: #bfdbfe;
  background: #eff6ff;
}
.radar-stat-title {
  font-size: 0.82rem;
  font-weight: 600;
  color: #475569;
}
.radar-stat-val {
  font-size: 1.6rem;
  font-weight: 700;
  color: #0f172a;
  line-height: 1.2;
  margin: 4px 0;
}
.radar-stat-box.alert .radar-stat-val { color: #dc2626; }
.radar-stat-box.warn .radar-stat-val { color: #d97706; }
.radar-stat-box.info .radar-stat-val { color: #2563eb; }
.radar-stat-desc {
  font-size: 0.75rem;
  color: #64748b;
}
</style>
