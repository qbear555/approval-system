<template>
  <div class="field" data-handling-fee-field="1">
    <label>
      {{ field.label || '手續費' }}
      <span v-if="field.required"> *</span>
    </label>
    <div class="handling-fee-row" style="display:flex;flex-wrap:wrap;gap:10px;align-items:center">
      <input
        type="text"
        :value="fee"
        :required="field.required"
        :placeholder="field.placeholder || '金額或說明'"
        style="flex:1 1 7rem;min-width:6rem"
        @input="ctx.set('handling_fee', $event.target.value)"
      />
      <label style="display:inline-flex;align-items:center;gap:4px;margin:0;cursor:pointer;white-space:nowrap">
        <input type="checkbox" :checked="mode === '內扣'" @change="setMode('內扣', $event.target.checked)" />
        內扣
      </label>
      <label style="display:inline-flex;align-items:center;gap:4px;margin:0;cursor:pointer;white-space:nowrap">
        <input type="checkbox" :checked="mode === '外加'" @change="setMode('外加', $event.target.checked)" />
        外加
      </label>
    </div>
    <div class="muted field-hint">可填金額／說明，並勾選內扣或外加（二選一）</div>
    <div v-if="summary" class="fee-calc-summary-badge" style="display:flex">{{ summary }}</div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useFormCtx } from '@/lib/form/context';
import { parseAmountNumber } from '@/lib/form';

const props = defineProps({
  field: { type: Object, required: true },
});

const ctx = useFormCtx();
const fee = computed(() => ctx.data.value.handling_fee ?? '');
const mode = computed(() => {
  const raw = String(ctx.data.value.handling_fee_mode || '');
  if (raw === '內扣' || raw === '外加') return raw;
  if (/內扣/.test(raw)) return '內扣';
  if (/外加/.test(raw)) return '外加';
  return '';
});

const summary = computed(() => {
  const amt = parseAmountNumber(ctx.data.value.amount);
  const feeNum = parseAmountNumber(fee.value);
  const m = mode.value;
  if (!(amt > 0 && feeNum > 0 && (m === '內扣' || m === '外加'))) return '';
  if (m === '內扣') {
    const net = Math.max(0, amt - feeNum);
    return `💡 支付算定：申請金額 $${amt.toLocaleString()} － 內扣手續費 $${feeNum.toLocaleString()} ＝ 實付撥款 $${net.toLocaleString()}`;
  }
  const total = amt + feeNum;
  return `💡 支付算定：受款金額 $${amt.toLocaleString()} ＋ 外加手續費 $${feeNum.toLocaleString()} ＝ 公司支出總計 $${total.toLocaleString()}`;
});

function setMode(next, checked) {
  ctx.set('handling_fee_mode', checked ? next : '');
}
</script>
