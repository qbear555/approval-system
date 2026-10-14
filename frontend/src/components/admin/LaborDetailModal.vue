<template>
  <div class="modal">
    <div class="modal-backdrop" @click="$emit('close')"></div>
    <div class="modal-panel wide">
      <h3 style="margin-top:0">休假明細 — {{ user?.name || '' }}</h3>
      <div class="kv" style="margin-bottom:12px">
        <dt>到職日</dt><dd>{{ labor.hireDate || '未設定' }}（僅供參考）</dd>
        <dt>年資</dt><dd>{{ labor.seniority?.label || '—' }}（不影響可休日數）</dd>
        <template v-if="sl">
          <dt>統計年度</dt><dd>{{ sl.yearLabel || labor.leaveBalanceYearLabel || '—' }}</dd>
          <dt>特休可休</dt><dd><strong>{{ sl.entitled ?? 0 }}</strong> 日（手動，以日計）</dd>
          <dt>合計已休</dt><dd>{{ sl.used }} 日（手動 {{ sl.manualUsedDays ?? 0 }} ＋ 系統 {{ sl.systemUsed ?? 0 }}）</dd>
          <dt>剩餘特休</dt><dd><strong>{{ sl.remaining ?? 0 }}</strong> 日</dd>
        </template>
      </div>
      <div v-if="balances.length" class="table-wrap">
        <table class="data">
          <thead>
            <tr><th>假別</th><th style="text-align:right">可休</th><th style="text-align:right">已休</th><th style="text-align:right">剩餘</th></tr>
          </thead>
          <tbody>
            <tr v-for="b in balances" :key="b.id || b.name">
              <td><strong>{{ b.name }}</strong><div class="muted" style="font-size:0.75rem">{{ b.law }}</div></td>
              <td style="text-align:right">{{ b.entitledLabel || '—' }}</td>
              <td style="text-align:right">{{ b.used != null ? b.used + ' 日' : '—' }}</td>
              <td style="text-align:right">{{ b.remainingLabel || '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <h4 v-if="details.length" style="margin:16px 0 6px">休假明細（系統已核准）</h4>
      <div v-if="details.length" class="table-wrap">
        <table class="data">
          <thead><tr><th>單號</th><th>假別</th><th>起迄</th><th>天數</th></tr></thead>
          <tbody>
            <tr v-for="d in details" :key="d.requestId + (d.leaveType || '')">
              <td><router-link :to="'/detail/' + d.requestId" @click="$emit('close')">#{{ d.requestId }}</router-link></td>
              <td>{{ d.leaveType || '—' }}</td>
              <td>{{ d.start || '' }}{{ d.end && d.end !== d.start ? ' ～ ' + d.end : '' }}</td>
              <td style="text-align:right">{{ d.days != null ? d.days : '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="muted">本年度尚無已核准之請假申請（系統）。</p>
      <div class="form-actions"><button type="button" class="btn outline" @click="$emit('close')">關閉</button></div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  user: { type: Object, default: null },
  labor: { type: Object, default: () => ({}) },
});
const sl = computed(() => props.labor?.specialLeave || null);
const balances = computed(() => (Array.isArray(props.labor?.leaveBalances) ? props.labor.leaveBalances : []));
const details = computed(() => {
  const L = props.labor || {};
  if (Array.isArray(L.leaveUsedDetails) && L.leaveUsedDetails.length) return L.leaveUsedDetails;
  return sl.value?.usedDetails || [];
});
</script>
