<template>
  <div v-if="keys.length" class="form-data-viewer">
    <h3 style="margin-top:20px">{{ title }}</h3>
    <dl class="kv">
      <template v-for="k in keys" :key="k">
        <dt>{{ APPROVER_FIELD_LABELS[k] || k }}</dt>
        <dd>{{ display(k) }}</dd>
      </template>
    </dl>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { flattenApproverData, APPROVER_FIELD_LABELS, approverSectionTitle } from '@/lib/request-detail';

const props = defineProps({
  data: { type: Object, default: () => ({}) },
});

const flat = computed(() => flattenApproverData(props.data));
const keys = computed(() => Object.keys(flat.value).filter((k) => k !== 'remaining_special_leave_hours'));
const title = computed(() => approverSectionTitle(flat.value));

function display(k) {
  const v = flat.value[k];
  return v == null || v === '' ? '—' : v;
}
</script>
