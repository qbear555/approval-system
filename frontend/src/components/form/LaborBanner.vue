<template>
  <div v-if="labor" class="card" style="background:#f0fdf4;border-color:#86efac;margin-bottom:12px;padding:12px">
    <strong>申請人特休（成員名單手動可休）</strong>
    <div style="margin-top:8px;font-size:0.9rem;line-height:1.55">
      <div>
        申請人：{{ request.requester_name || '' }}
        <template v-if="request.requester_dept">（{{ request.requester_dept }}）</template>
      </div>
      <div>
        到職日：{{ labor.hireDate || '未設定' }}
        <template v-if="labor.seniority?.label"> · 年資：{{ labor.seniority.label }}（僅顯示）</template>
      </div>
      <div>統計年度：{{ sl.yearLabel || '—' }}</div>
      <div>
        可休 <strong>{{ entitled }}</strong> 日（手動）· 已休 {{ sl.used ?? '—' }} 日
        <template v-if="sl.manualUsedDays">（含手動 {{ sl.manualUsedDays || 0 }} 日）</template>
        · 目前剩餘
        <strong style="color:#15803d">{{ labor.remainingBefore != null ? labor.remainingBefore : sl.remaining ?? '—' }}</strong>
        日
      </div>
      <div v-if="entitled === 0" class="muted" style="margin-top:4px">
        可休為 0：請至「成員名單」手動填寫特休可休天數。
      </div>
      <div v-if="labor.thisIsSpecial && thisDays != null">
        本單特休申請 <strong>{{ thisDays }}</strong> 日 → 核准後剩餘
        <strong :style="{ color: warnAfter ? '#b91c1c' : '#15803d' }">{{ after }}</strong> 日
        {{ warnAfter ? '（已超休，請確認）' : '（已自動填入下方「剩餘特休日數」）' }}
      </div>
      <div v-else-if="labor.leaveType">
        本單假別：{{ labor.leaveType }}
        <template v-if="thisDays != null"> · {{ thisDays }} 日</template>
        （非特休時，剩餘欄位可留白）
      </div>
    </div>
    <p class="muted" style="margin:8px 0 0;font-size:0.8rem">
      特休以<strong>日</strong>計算（不換算小時）。可休日數由成員名單手動設定；統計年度為曆年制（1/1～12/31）。實際給假以人事核定為準。
    </p>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  labor: { type: Object, default: null },
  request: { type: Object, default: () => ({}) },
});

const sl = computed(() => props.labor?.specialLeave || {});
const thisDays = computed(() => props.labor?.thisLeaveDays);
const after = computed(() =>
  props.labor?.remainingAfter != null ? props.labor.remainingAfter : props.labor?.suggestRemainingDays
);
const warnAfter = computed(() => after.value != null && after.value < 0);
const entitled = computed(() => sl.value.entitled ?? 0);
</script>
