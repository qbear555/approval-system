<template>
  <div class="field field-full" style="grid-column:1/-1" :data-col-span="'full'">
    <label style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;white-space:normal;margin-bottom:6px">
      <span style="white-space:nowrap">
        {{ title }}
        <span v-if="required" style="color:#b91c1c"> *</span>
      </span>
      <span class="muted" style="font-weight:400;font-size:0.82rem">{{ hint }}</span>
      <button v-if="mode !== 'dept_head'" type="button" class="btn sm outline" @click="selectAll">全選</button>
      <button v-if="mode !== 'dept_head'" type="button" class="btn sm outline" @click="selectNone">
        {{ noneLabel }}
      </button>
    </label>

    <select v-if="mode === 'dept_head'" :value="modelStr" @change="onDeptHead($event.target.value)">
      <option value="skip">不需要經過部門主管（略過此步驟）</option>
      <optgroup v-if="split.deptMembers.length" :label="`同部門成員${split.myDeptLabel ? `（${split.myDeptLabel}）` : ''}`">
        <option v-for="u in split.deptMembers" :key="u.id" :value="String(u.id)">{{ userLabel(u) }}</option>
      </optgroup>
      <optgroup v-if="split.others.length" :label="split.deptMembers.length ? '其他人員' : '全體人員'">
        <option v-for="u in split.others" :key="u.id" :value="String(u.id)">{{ userLabel(u) }}</option>
      </optgroup>
      <option v-if="!split.deptMembers.length && !split.others.length" value="" disabled>尚無可選人員</option>
    </select>

    <div v-else class="approver-list" style="margin-top:0;max-height:280px">
      <label v-if="mode === 'attendee'" class="member-pick-row" style="opacity:0.85">
        <input type="checkbox" checked disabled />
        <span>{{ selfLabel }}（申請人）</span>
      </label>
      <label v-for="u in candidates" :key="u.id" class="member-pick-row">
        <input type="checkbox" :value="u.id" :checked="selected.has(Number(u.id))" @change="toggle(u.id, $event.target.checked)" />
        <span>{{ userLabel(u) }}</span>
      </label>
      <span v-if="!candidates.length" class="muted">{{ emptyText }}</span>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useFormCtx } from '@/lib/form/context';
import { activeUsersExceptMe, parseIdList, splitUsersForDeptHead, userLabel } from '@/lib/form';

const props = defineProps({
  mode: { type: String, required: true },
  fieldId: { type: String, required: true },
  title: { type: String, default: '' },
  required: { type: Boolean, default: false },
  optional: { type: Boolean, default: false },
  poolIds: { type: Array, default: () => [] },
  stepMode: { type: String, default: 'any' },
  openPool: { type: Boolean, default: false },
});

const ctx = useFormCtx();
const users = computed(() => ctx.users.value || []);
const me = computed(() => ctx.me.value);

const modelStr = computed(() => String(ctx.data.value[props.fieldId] ?? ''));
const selected = computed(() => new Set(parseIdList(modelStr.value === 'skip' ? '' : modelStr.value)));

const split = computed(() => splitUsersForDeptHead(users.value, me.value));

const candidates = computed(() => {
  if (props.mode === 'attendee' || props.mode === 'cosign') {
    return activeUsersExceptMe(users.value, me.value);
  }
  const poolIds = (props.poolIds || []).map(Number).filter(Boolean);
  const meId = Number(me.value?.id);
  let list = (users.value || []).filter(
    (u) => u.active !== 0 && Number(u.id) !== meId && (props.openPool || !poolIds.length || poolIds.includes(Number(u.id)))
  );
  if (!list.length && poolIds.length) {
    list = poolIds.filter((id) => id !== meId).map((id) => ({ id, name: `使用者 #${id}`, department: '' }));
  }
  return list;
});

const hint = computed(() => {
  if (props.mode === 'dept_head') return '（可指定成員或略過）';
  if (props.mode === 'cosign') return '選填・可多選・不勾則略過';
  if (props.mode === 'attendee') return '申請人固定出席；勾選的人列入出席並須簽核';
  const modeHint =
    candidates.value.length > 1
      ? props.stepMode === 'all'
        ? '多位需全部核准'
        : '多位任一核准即可'
      : '';
  return props.optional
    ? `選填・可不勾選（略過此步驟）・可勾選多位${modeHint ? '・' + modeHint : ''}`
    : `必填・可勾選多位${modeHint ? '・' + modeHint : ''}`;
});

const noneLabel = computed(() =>
  props.mode === 'users_pick' && props.optional ? '不需此步驟' : '取消全選'
);
const emptyText = computed(() =>
  props.mode === 'users_pick' ? '尚無可選簽核人，請聯絡管理員設定流程' : '尚無可選人員'
);
const selfLabel = computed(() => {
  const u = me.value;
  if (!u) return '申請人';
  return userLabel(u);
});

function writeIds(ids) {
  const clean = [...new Set(ids.filter((n) => n > 0))];
  if (clean.length) {
    ctx.set(props.fieldId, clean.join(','));
    return;
  }
  if (props.mode === 'cosign' || (props.mode === 'users_pick' && props.optional)) {
    ctx.set(props.fieldId, 'skip');
  } else {
    ctx.set(props.fieldId, '');
  }
}

function toggle(id, checked) {
  const next = new Set(selected.value);
  if (checked) next.add(Number(id));
  else next.delete(Number(id));
  writeIds([...next]);
}

function selectAll() {
  writeIds(candidates.value.map((u) => Number(u.id)));
}

function selectNone() {
  writeIds([]);
}

function onDeptHead(v) {
  ctx.set(props.fieldId, v || 'skip');
}
</script>
