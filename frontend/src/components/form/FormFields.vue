<template>
  <div class="form-fields-multi vue-form-fields">
    <template v-for="item in layoutItems" :key="item.key">
      <div v-if="item.kind === 'period'" class="welfare-period-row">
        <FormField v-if="item.summary" :field="item.summary" :compact="compact" />
        <FormField v-if="item.month" :field="item.month" :compact="compact" />
      </div>
      <PeoplePickField
        v-else-if="item.kind === 'dept_head'"
        mode="dept_head"
        :field-id="item.fieldId"
        :title="item.step.name || '部門主管簽核'"
      />
      <PeoplePickField
        v-else-if="item.kind === 'cosign'"
        mode="cosign"
        :field-id="item.fieldId"
        :title="item.step.name || '會簽人員'"
        optional
      />
      <PeoplePickField
        v-else-if="item.kind === 'users_pick'"
        mode="users_pick"
        :field-id="item.fieldId"
        :title="item.step.name || '副總經理簽核'"
        :required="!item.step.skipIfNoApprover"
        :optional="!!item.step.skipIfNoApprover"
        :pool-ids="item.step.approverIds || []"
        :step-mode="item.step.mode || 'any'"
        :open-pool="item.openPool"
      />
      <FormField v-else-if="item.kind === 'field' && isVisible(item.field)" :field="item.field" :compact="compact" />
    </template>
  </div>
</template>

<script setup>
import { computed, provide, toRef, watch } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { useUsersStore } from '@/stores/users';
import { FORM_CTX } from '@/lib/form/context';
import { isItRepairNoncompliant, isItRepairNoteField, isSpecialLeaveType, shouldHideField } from '@/lib/form';
import FormField from './FormField.vue';
import PeoplePickField from './fields/PeoplePickField.vue';

const props = defineProps({
  fields: { type: Array, default: () => [] },
  steps: { type: Array, default: () => [] },
  enableRich: { type: Boolean, default: true },
  compact: { type: Boolean, default: false },
});

const formData = defineModel({ type: Object, required: true });

const auth = useAuthStore();
const usersStore = useUsersStore();
usersStore.fetch();

const enableRichRef = toRef(props, 'enableRich');

function set(id, val) {
  if (formData.value[id] === val) return;
  formData.value[id] = val;
}

provide(FORM_CTX, {
  data: formData,
  set,
  users: computed(() => usersStore.list),
  me: computed(() => auth.user),
  enableRich: enableRichRef,
});

function isVisible(field) {
  if (shouldHideField(field)) return false;
  if (field.id === 'period_roc_year') return false;
  if (field.id === 'hours' && isSpecialLeaveType(formData.value.leave_type)) return false;
  if (isItRepairNoteField(field.id)) {
    const checkId = field.id.replace(/_note$/, '');
    return isItRepairNoncompliant(formData.value[checkId]);
  }
  return true;
}

const layoutItems = computed(() => {
  const fields = props.fields || [];
  const items = [];
  const used = new Set();
  const summary = fields.find((f) => f.id === 'opening_summary');
  const month = fields.find((f) => f.id === 'period_month');
  if (summary && month) {
    items.push({ kind: 'period', key: 'welfare-period', summary, month });
    used.add('opening_summary');
    used.add('period_month');
  }
  for (const f of fields) {
    if (used.has(f.id)) continue;
    items.push({ kind: 'field', key: `f-${f.id}`, field: f });
  }
  const hasAttendeeField = fields.some((f) => f.id === 'attendee_ids');
  for (const step of props.steps || []) {
    if (step.assignType === 'dept_head') {
      items.push({
        kind: 'dept_head',
        key: `dh-${step.order}`,
        fieldId: `dept_head_${step.order}`,
        step,
      });
    } else if (step.assignType === 'cosign_pick') {
      items.push({
        kind: 'cosign',
        key: `cs-${step.order}`,
        fieldId: `cosign_${step.order}`,
        step,
      });
    } else if (step.assignType === 'users_pick') {
      if (hasAttendeeField && /與會/.test(String(step.name || ''))) continue;
      items.push({
        kind: 'users_pick',
        key: `up-${step.order}`,
        fieldId: `users_pick_${step.order}`,
        step,
        openPool: !(step.approverIds || []).length && /與會/.test(String(step.name || '')),
      });
    }
  }
  return items;
});

watch(
  () => formData.value.period_roc_year,
  (v) => {
    if (!v) set('period_roc_year', String(new Date().getFullYear() - 1911));
  },
  { immediate: true }
);
</script>

<style>
.vue-form-fields > .field-full,
.vue-form-fields > [data-col-span='full'],
.vue-form-fields > .field-span-2,
.vue-form-fields > [data-col-span='2'] {
  grid-column: 1 / -1;
}
</style>
