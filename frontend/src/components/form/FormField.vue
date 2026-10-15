<template>
  <input v-if="field.id === 'period_roc_year'" type="hidden" :value="model" />

  <VoidTargetField v-else-if="field.id === 'void_target_id'" :field="field" />
  <FollowupItemsField v-else-if="field.id === 'followup_items'" :field="field" />
  <PeoplePickField
    v-else-if="field.id === 'attendee_ids'"
    mode="attendee"
    field-id="attendee_ids"
    title="與會人員"
  />
  <WelfareLedgerField v-else-if="field.id === 'welfare_items'" :field="field" />
  <DynamicGridField v-else-if="field.type === 'table' || field.type === 'grid'" :field="field" />
  <HandlingFeeField v-else-if="field.id === 'handling_fee'" :field="field" />
  <RichTextField v-else-if="field.type === 'textarea' && useRich" :field="field" />
  <DateTimeField v-else-if="field.type === 'datetime'" :field="field" />

  <div v-else-if="field.type === 'textarea'" class="field field-full" data-col-span="full">
    <label>{{ displayLabel }}<span v-if="field.required"> *</span></label>
    <textarea
      :value="model"
      :required="field.required"
      :placeholder="displayPlaceholder"
      :rows="compact ? 2 : 3"
      @input="set($event.target.value)"
    />
  </div>

  <div v-else-if="field.type === 'select'" class="field" :class="{ 'welfare-month-field': field.id === 'period_month' }">
    <label>{{ field.label }}<span v-if="field.required"> *</span></label>
    <select :value="model" :required="field.required" @change="set($event.target.value)">
      <option value="">請選擇…</option>
      <option v-for="o in field.options || []" :key="o" :value="o">{{ o }}</option>
    </select>
  </div>

  <div v-else-if="field.type === 'user'" class="field">
    <label>{{ field.label }}<span v-if="field.required"> *</span></label>
    <select :value="model" :required="field.required" @change="set($event.target.value)">
      <option value="">請選擇人員…</option>
      <option v-for="u in userOptions" :key="u.id" :value="String(u.id)">
        {{ userLabel(u) }}{{ allowSelf && Number(u.id) === Number(me?.id) ? '（本人）' : '' }}
      </option>
    </select>
  </div>

  <div v-else-if="field.type === 'checkbox'" class="field">
    <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
      <input type="checkbox" :checked="!!model" :required="field.required" @change="set($event.target.checked)" />
      {{ field.label }}<span v-if="field.required"> *</span>
    </label>
  </div>

  <div v-else class="field" :class="{ 'welfare-summary-field': field.id === 'opening_summary' }">
    <label>{{ displayLabel }}<span v-if="field.required"> *</span></label>
    <input
      :type="inputType"
      :value="model"
      :required="field.required"
      :placeholder="displayPlaceholder"
      :step="numberStep"
      :min="halfStep ? 0 : undefined"
      :readonly="!!field.readOnly"
      :inputmode="field.type === 'number' ? 'decimal' : undefined"
      @input="onNumberOrText($event.target.value)"
      @change="onHalfSnap"
      @blur="onHalfSnap"
    />
    <div v-if="halfStep && !field.hint" class="muted field-hint">最小單位 0.5（例：0、0.5、1、3.5、7.5、22.5）</div>
    <div v-else-if="field.hint" class="muted field-hint">{{ field.hint }}</div>
    <template v-if="amountFx">
      <div v-if="foreignCur" class="muted field-hint">外幣可至小數 4 位</div>
      <div v-if="cnPreview" class="amount-cn-preview">{{ cnPreview }}</div>
      <div class="tax-calc-toolbar">
        <button type="button" class="tax-btn tax-btn-add" title="以目前金額為未稅，加 5% 營業稅換算為含稅總額" @click="tax('add')">
          🧮 ＋5% 稅 (含稅)
        </button>
        <button type="button" class="tax-btn tax-btn-sub" title="以目前金額為含稅，反推 5% 營業稅算出未稅金額" @click="tax('sub')">
          🧮 －5% 稅 (未稅)
        </button>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useFormCtx } from '@/lib/form/context';
import {
  applyTax,
  isAmountFxField,
  isForeignCurrency,
  isHalfStepNumber,
  numberToChineseCurrency,
  parseAmountNumber,
  shouldUseRich,
  snapHalfUnit,
  userLabel,
} from '@/lib/form';
import DateTimeField from './fields/DateTimeField.vue';
import FollowupItemsField from './fields/FollowupItemsField.vue';
import HandlingFeeField from './fields/HandlingFeeField.vue';
import PeoplePickField from './fields/PeoplePickField.vue';
import RichTextField from './fields/RichTextField.vue';
import VoidTargetField from './fields/VoidTargetField.vue';
import WelfareLedgerField from './fields/WelfareLedgerField.vue';
import DynamicGridField from './fields/DynamicGridField.vue';

const props = defineProps({
  field: { type: Object, required: true },
  compact: { type: Boolean, default: false },
});

const ctx = useFormCtx();
const me = computed(() => ctx.me.value);
const model = computed(() => ctx.data.value[props.field.id]);
const useRich = computed(() => shouldUseRich(props.field, { enableRich: ctx.enableRich.value }));
const halfStep = computed(() => isHalfStepNumber(props.field));
const amountFx = computed(() => isAmountFxField(props.field));
const foreignCur = computed(() => isForeignCurrency(ctx.data.value.currency));
const inputType = computed(() => (['number', 'date'].includes(props.field.type) ? props.field.type : 'text'));
const numberStep = computed(() => {
  if (halfStep.value) return '0.5';
  if (amountFx.value) return foreignCur.value ? '0.0001' : '1';
  if (props.field.type === 'number') return 'any';
  return undefined;
});
const cnPreview = computed(() => (amountFx.value ? numberToChineseCurrency(parseAmountNumber(model.value)) : ''));

const payNoteMeta = computed(() => {
  if (props.field.id !== 'payment_note') return null;
  const m = String(ctx.data.value.payment_method || '');
  if (m === '期票') return { label: '期票到期日', placeholder: '請註明期票到期日（例如：115/08/31）' };
  if (m === '其他') return { label: '其他支付說明', placeholder: '請說明其他支付方式' };
  if (m === '現金') return { label: '支付說明（選填）', placeholder: '現金支付可不填' };
  return { label: '支付說明（期票到期日／其他說明）', placeholder: '選「期票」請填到期日；選「其他」請說明' };
});
const displayLabel = computed(() => payNoteMeta.value?.label || props.field.label);
const displayPlaceholder = computed(() => payNoteMeta.value?.placeholder || props.field.placeholder || '');

const allowSelf = computed(
  () => props.field.id === 'agent' || /代理/.test(String(props.field.label || '') + String(props.field.id || ''))
);
const userOptions = computed(() =>
  (ctx.users.value || []).filter((u) => u.active !== 0 && (allowSelf.value || Number(u.id) !== Number(me.value?.id)))
);

function set(v) {
  ctx.set(props.field.id, v);
}

function onNumberOrText(v) {
  set(v);
}

function onHalfSnap() {
  if (!halfStep.value || props.field.readOnly) return;
  if (model.value === '' || model.value == null) return;
  const snapped = snapHalfUnit(model.value);
  if (snapped !== '' && snapped !== String(model.value)) set(snapped);
}

function tax(action) {
  const next = applyTax(model.value, action);
  if (next !== '') set(next);
}
</script>
