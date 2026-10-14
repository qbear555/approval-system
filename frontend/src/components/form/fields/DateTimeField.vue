<template>
  <div class="field" :class="{ 'field-span-2': span === 2 }" :data-col-span="span">
    <label>
      {{ field.label }}
      <span v-if="field.required" class="req"> *</span>
    </label>
    <div class="datetime-row">
      <input
        type="date"
        :value="parts.date"
        :required="field.required"
        title="日期"
        @change="onDate($event.target.value)"
      />
      <select
        :value="parts.time"
        :required="field.required"
        :title="`時間 ${range.tStart}～${range.tEnd}（每 30 分鐘）`"
        @change="onTime($event.target.value)"
      >
        <option v-for="t in times" :key="t" :value="t">{{ t }}</option>
      </select>
    </div>
    <div class="muted field-hint">{{ range.tStart }}～{{ range.tEnd }} · 每 30 分</div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useFormCtx } from '@/lib/form/context';
import { combineDateTime, datetimeRangeForField, halfHourTimes, parseDateTimeParts } from '@/lib/form';

const props = defineProps({
  field: { type: Object, required: true },
});

const ctx = useFormCtx();
const range = computed(() => datetimeRangeForField(props.field));
const times = computed(() => halfHourTimes({ start: range.value.tStart, end: range.value.tEnd }));
const span = computed(() => range.value.span);

const parts = computed(() => {
  const raw = ctx.data.value[props.field.id];
  return parseDateTimeParts(raw, range.value.defaultTime);
});

function emitValue(date, time) {
  ctx.set(props.field.id, combineDateTime(date, time, range.value.defaultTime));
}

function onDate(date) {
  emitValue(date, parts.value.time || range.value.defaultTime);
}

function onTime(time) {
  emitValue(parts.value.date, time);
}
</script>
