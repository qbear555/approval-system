<template>
  <div class="field field-full" data-col-span="full" data-welfare-table="1">
    <label>
      {{ field.label || '收支明細' }}
      <span v-if="field.required"> *</span>
    </label>
    <div style="overflow:auto">
      <table class="form-view-table welfare-ledger">
        <thead>
          <tr>
            <th style="width:9rem">日期</th>
            <th>摘要</th>
            <th style="width:8.5rem">存入</th>
            <th style="width:8.5rem">支出</th>
            <th style="width:7.5rem">餘額</th>
            <th style="width:3.2rem"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(it, i) in rows" :key="i">
            <td><input type="date" :value="it.date" @input="patch(i, 'date', $event.target.value)" /></td>
            <td>
              <input
                type="text"
                maxlength="80"
                :value="it.summary"
                placeholder="例如：薪資提撥、住院慰問金"
                @input="patch(i, 'summary', $event.target.value)"
              />
            </td>
            <td>
              <input
                type="number"
                step="1"
                min="0"
                inputmode="decimal"
                :value="it.deposit"
                @input="patch(i, 'deposit', $event.target.value)"
              />
            </td>
            <td>
              <input
                type="number"
                step="1"
                min="0"
                inputmode="decimal"
                :value="it.withdraw"
                @input="patch(i, 'withdraw', $event.target.value)"
              />
            </td>
            <td class="welfare-bal" style="text-align:right;padding:6px 8px;white-space:nowrap">
              {{ formatWelfareAmt(summary.rows[i]?.balance, false) }}
            </td>
            <td>
              <button type="button" class="btn sm outline" @click="remove(i)">刪</button>
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td></td>
            <td><strong>合計</strong></td>
            <td style="text-align:right">{{ formatWelfareAmt(summary.sumIn, false) }}</td>
            <td style="text-align:right">{{ formatWelfareAmt(summary.sumOut, false) }}</td>
            <td style="text-align:right">{{ formatWelfareAmt(summary.closing, false) }}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>
    <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <button type="button" class="btn sm outline" @click="addRow">＋ 新增一列</button>
      <span class="muted" style="font-size:0.82rem">餘額＝上月結轉＋存入−支出，會自動計算。</span>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useFormCtx } from '@/lib/form/context';
import { emptyWelfareRows, formatWelfareAmt, parseWelfareItems, summarizeWelfare, welfareAmtNum } from '@/lib/form';

const props = defineProps({
  field: { type: Object, required: true },
});

const ctx = useFormCtx();

const rows = computed(() => {
  const parsed = parseWelfareItems(ctx.data.value[props.field.id]);
  return parsed.length ? parsed : emptyWelfareRows(3);
});

const opening = computed(() => welfareAmtNum(ctx.data.value.opening_balance));
const summary = computed(() => summarizeWelfare(rows.value, opening.value));

function write(next) {
  ctx.set(props.field.id, next);
}

function patch(i, key, val) {
  const next = rows.value.map((r) => ({ ...r }));
  next[i] = { ...next[i], [key]: val };
  write(next);
}

function addRow() {
  write([...rows.value, { date: '', summary: '', deposit: '', withdraw: '' }]);
}

function remove(i) {
  const next = rows.value.filter((_, idx) => idx !== i);
  write(next.length ? next : emptyWelfareRows(1));
}
</script>
