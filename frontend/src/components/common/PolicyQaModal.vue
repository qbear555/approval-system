<template>
  <div v-if="isOpen" class="modal-backdrop" @click="close">
    <div class="modal-panel policy-modal-panel" style="max-width:760px;width:92%;max-height:88vh;display:flex;flex-direction:column;padding:0;overflow:hidden" @click.stop>
      <!-- 標題欄 -->
      <div style="padding:16px 20px;background:linear-gradient(135deg, #0284c7 0%, #0369a1 100%);color:#fff;display:flex;justify-content:space-between;align-items:center">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:1.4rem">📜</span>
          <div>
            <h3 style="margin:0;font-size:1.15rem;font-weight:600;color:#fff">公司簽核規章政策問答小助手</h3>
            <span style="font-size:0.8rem;opacity:0.9">精準引用差旅、特休、請購與各級主管核決權限 (SOA) 規範</span>
          </div>
        </div>
        <button type="button" class="btn ghost sm" style="color:#fff;font-size:1.2rem;line-height:1" @click="close">✕</button>
      </div>

      <!-- 內容區 -->
      <div style="padding:20px;overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:16px">
        <!-- 推薦查詢 Pill -->
        <div>
          <div style="font-size:0.82rem;font-weight:600;color:#64748b;margin-bottom:8px">💡 常見規章查詢：</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button
              v-for="(p, idx) in quickPrompts"
              :key="idx"
              type="button"
              class="policy-pill"
              :disabled="loading"
              @click="selectPrompt(p)"
            >
              {{ p }}
            </button>
          </div>
        </div>

        <!-- 提問輸入框 -->
        <form style="display:flex;gap:10px" @submit.prevent="runPolicyQuery">
          <input
            v-model="questionInput"
            type="text"
            placeholder="請輸入欲查詢之規章問題，例如：高鐵車票出差如何報銷？ 或 採購多少金額需總經理核准？"
            :disabled="loading"
            style="flex:1;padding:10px 14px;border:1px solid #cbd5e1;border-radius:8px;font-size:0.92rem"
          />
          <button
            type="submit"
            class="btn primary"
            :disabled="loading || !questionInput.trim()"
            style="padding:0 20px;white-space:nowrap;font-weight:600;background:#0284c7;border-color:#0284c7"
          >
            {{ loading ? '查詢中…' : '規章查詢 🔍' }}
          </button>
        </form>

        <!-- 載入中 -->
        <div v-if="loading" style="padding:20px;text-align:center;background:#f0f9ff;border-radius:8px">
          <div style="font-size:1.6rem;margin-bottom:6px">⚡</div>
          <div style="font-weight:600;color:#0369a1;font-size:0.92rem">AI 正在檢索公司規章與核決權限表…</div>
          <div style="font-size:0.82rem;color:#0284c7;margin-top:4px">
            比對差旅辦法、出勤請假細則、請購採購規範與 SOA 核決授權矩陣中…
          </div>
        </div>

        <!-- 錯誤提示 -->
        <div v-if="errorMessage" style="padding:12px 16px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:#991b1b;font-size:0.88rem">
          <strong>⚠️ 查詢失敗：</strong> {{ errorMessage }}
        </div>

        <!-- AI 回答展示 -->
        <div v-if="answerData && !loading" style="display:flex;flex-direction:column;gap:12px">
          <!-- 核心回答區 -->
          <div style="padding:16px 18px;background:#f8fafc;border:1px solid #e2e8f0;border-left:4px solid #0284c7;border-radius:6px;font-size:0.92rem;line-height:1.75;color:#0f172a">
            <div style="font-weight:700;color:#0369a1;margin-bottom:8px;display:flex;align-items:center;gap:6px">
              <span>📖 規章答覆與合規建議</span>
            </div>
            <div style="white-space:pre-wrap">{{ answerData.answer }}</div>
          </div>

          <!-- 引用條文清單 -->
          <div v-if="answerData.citations && answerData.citations.length" style="padding:12px 16px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;font-size:0.85rem">
            <strong style="color:#166534;display:block;margin-bottom:6px">📌 引用規章與條文依據：</strong>
            <ul style="margin:0;padding-left:18px;color:#15803d;line-height:1.6">
              <li v-for="(c, cIdx) in answerData.citations" :key="cIdx">
                {{ c }}
              </li>
            </ul>
          </div>
        </div>
      </div>

      <!-- 底部關閉按鈕 -->
      <div style="padding:12px 20px;background:#f8fafc;border-top:1px solid #e2e8f0;display:flex;justify-content:flex-end">
        <button type="button" class="btn outline" @click="close">關閉</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { askAiPolicyQa } from '@/api/requests';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
});
const emit = defineEmits(['update:modelValue']);

const isOpen = ref(false);
const quickPrompts = [
  '🚄 國內出差搭乘高鐵與住宿費如何報帳？',
  '🏖️ 特休未休完天數可以遞延或發放工資嗎？',
  '🛒 物品請購超過多少金額需要總經理審核？',
  '🤝 業務交際費請款需要附哪些憑證？',
  '⏰ 員工請假應於何時完成手續與代理人設定？',
];

const questionInput = ref('');
const loading = ref(false);
const errorMessage = ref('');
const answerData = ref(null);

function selectPrompt(p) {
  questionInput.value = p.replace(/^[^\s]+\s*/, '');
  runPolicyQuery();
}

async function runPolicyQuery() {
  const q = questionInput.value.trim();
  if (!q) return;
  loading.value = true;
  errorMessage.value = '';
  try {
    const res = await askAiPolicyQa(q);
    answerData.value = res;
  } catch (err) {
    errorMessage.value = err.message || '規章小助手查詢暫時無法回應，請確認 AI 服務設定。';
  } finally {
    loading.value = false;
  }
}

function open() {
  isOpen.value = true;
  emit('update:modelValue', true);
}

function close() {
  isOpen.value = false;
  emit('update:modelValue', false);
}

defineExpose({ open, close });
</script>

<style scoped>
.policy-pill {
  border: 1px solid #bae6fd;
  background: #f0f9ff;
  color: #0369a1;
  padding: 5px 12px;
  border-radius: 999px;
  font-size: 0.82rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease-in-out;
}
.policy-pill:hover:not(:disabled) {
  background: #e0f2fe;
  border-color: #7dd3fc;
  transform: translateY(-1px);
}
</style>
