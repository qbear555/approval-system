<template>
  <div v-if="actions.length || request.status === 'pending' || request.status === 'returned'" class="card timeline-card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <h4 style="margin:0;display:flex;align-items:center;gap:8px">
        <span>📜</span> 簽核歷程軌跡（共 {{ actions.length }} 次紀錄）
      </h4>
      <span class="muted" style="font-size:0.82rem">由舊至新時間順序排列</span>
    </div>
    <div class="timeline-feed">
      <div v-for="(a, idx) in actions" :key="idx" :class="['tl-item', 'is-' + info(a).cls]">
        <div class="tl-dot"></div>
        <div class="tl-header">
          <span class="tl-actor">{{ a.actor_name || a.actor_username || '審核人' }}</span>
          <span v-if="a.on_behalf_of_name" class="tl-proxy-tag" title="受託代理簽核">🏷️ 代 {{ a.on_behalf_of_name }}</span>
          <span :class="['tl-action-badge', info(a).cls]">{{ info(a).icon }} {{ info(a).label }}</span>
          <span style="font-size:0.84rem;color:#475569;font-weight:500">{{ stepLabel(a) }}</span>
          <span class="tl-time">{{ timeStr(a.created_at) }}</span>
        </div>
        <div v-if="commentOf(a)" class="tl-comment-box has-comment">
          <strong>意見：</strong>{{ commentOf(a) }}
        </div>
        <div v-if="a.signature_image">
          <img class="tl-sig-thumb" :src="a.signature_image" alt="簽名檔" title="數位手寫簽名" />
        </div>
      </div>

      <div v-if="request.status === 'pending'" class="tl-item is-pending">
        <div class="tl-dot"></div>
        <div class="tl-header">
          <span class="tl-actor" style="color:#2563eb">⏳ 審核中關卡</span>
          <span class="tl-action-badge pending">審批中</span>
          <span style="font-size:0.84rem;color:#2563eb;font-weight:600">【{{ currentStepName }}】</span>
          <span v-if="elapsedStr" class="tl-time" style="color:#f59e0b;font-weight:600">{{ elapsedStr }}</span>
        </div>
        <div class="tl-comment-box" style="border-left-color:#3b82f6;color:#64748b">
          此步驟正在等候指定主管／審核人簽署，完成後將自動推進至下一步。
        </div>
      </div>

      <div v-else-if="request.status === 'returned'" class="tl-item is-return">
        <div class="tl-dot" style="background:#f59e0b;border-color:#d97706"></div>
        <div class="tl-header">
          <span class="tl-actor" style="color:#b45309">⚠️ 待修改重新送審</span>
          <span class="tl-action-badge return">退回修改中</span>
          <span style="font-size:0.84rem;color:#b45309;font-weight:600">【申請人處理】</span>
        </div>
        <div class="tl-comment-box" style="border-left-color:#f59e0b;background:#fffbeb;color:#92400e">
          單據已被主管退回，目前等候申請人補齊資料或修正後重新送審。
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { TIMELINE_ACTIONS, htmlToPlain } from '@/lib/request-detail';

const props = defineProps({
  request: { type: Object, required: true },
});

const actions = computed(() => (Array.isArray(props.request.actions) ? props.request.actions : []));

function info(a) {
  return TIMELINE_ACTIONS[a.action] || { label: a.action || '簽核作業', cls: 'pending', icon: '🔹' };
}
function stepLabel(a) {
  if (a.step_name) return `【${a.step_name}】`;
  if (a.action === 'submit') return '【提出申請】';
  return '';
}
function timeStr(t) {
  return t ? String(t).slice(0, 16) : '';
}
function commentOf(a) {
  return a.comment ? htmlToPlain(a.comment) : '';
}

const currentStepName = computed(() => {
  const curStepOrder = Number(props.request.current_step);
  const steps = Array.isArray(props.request.steps) ? props.request.steps : [];
  const cur = steps.find((s) => Number(s.order) === curStepOrder) || steps[curStepOrder - 1];
  return cur?.name || `步驟 ${curStepOrder}`;
});

const elapsedStr = computed(() => {
  const last = actions.value[actions.value.length - 1];
  const baseTime = last?.created_at || props.request.created_at;
  if (!baseTime) return '';
  const diffMs = Date.now() - new Date(baseTime).getTime();
  if (isNaN(diffMs) || diffMs <= 0) return '';
  const hours = Math.floor(diffMs / 3600000);
  const days = Math.floor(hours / 24);
  return days > 0 ? `已等待 ${days} 天 ${hours % 24} 小時` : `已等待 ${Math.max(1, hours)} 小時`;
});
</script>
