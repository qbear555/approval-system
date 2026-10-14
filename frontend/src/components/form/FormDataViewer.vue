<template>
  <div v-if="rows.length" class="form-data-viewer">
    <h3 v-if="title" style="margin-top:20px">{{ title }}</h3>
    <dl class="kv">
      <template v-for="row in rows" :key="row.key">
        <dt :style="row.nowrap ? 'white-space:nowrap' : undefined">{{ row.label }}</dt>
        <dd :style="row.nowrap ? 'white-space:nowrap' : undefined">
          <FormValueDisplay
            v-if="row.field"
            :field="row.field"
            :value="row.value"
            :form-data="formData"
            :users="users"
          />
          <template v-else>{{ row.text }}</template>
        </dd>
      </template>
    </dl>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { formatUserIds, formatYuanWanStyle, isMoneyFormField, leaveDisplayForForm, userLabel, findUser, welfareCurrentRocYear } from '@/lib/form';
import FormValueDisplay from './FormValueDisplay.vue';

const props = defineProps({
  fields: { type: Array, default: () => [] },
  formData: { type: Object, default: () => ({}) },
  steps: { type: Array, default: () => [] },
  templateSteps: { type: Array, default: () => [] },
  users: { type: Array, default: () => [] },
  title: { type: String, default: '表單資料' },
});

function stepForFormKey(n, assignType) {
  const num = Number(n);
  const tpl = Array.isArray(props.templateSteps) ? props.templateSteps : [];
  const fromWfSame = tpl.find((s) => Number(s.order) === num && s.assignType === assignType);
  if (fromWfSame) return fromWfSame;
  const fromWfOrder = tpl.find((s) => Number(s.order) === num);
  if (fromWfOrder) return fromWfOrder;
  const list = Array.isArray(props.steps) ? props.steps : [];
  const byTpl = list.find(
    (s) => Number(s.templateOrder) === num && (!assignType || s.assignType === assignType)
  );
  if (byTpl) return byTpl;
  const byOrderType = list.find((s) => Number(s.order) === num && s.assignType === assignType);
  if (byOrderType) return byOrderType;
  const same = list.filter((s) => s.assignType === assignType);
  if (same.length === 1) return same[0];
  return list.find((s) => Number(s.order) === num) || null;
}

function labelForFormKey(n, assignType, fallback) {
  const step = stepForFormKey(n, assignType);
  const name = String(step?.name || '').trim();
  if (!name) return fallback;
  const tpl = Array.isArray(props.templateSteps) ? props.templateSteps : [];
  const dup = tpl.filter((s) => String(s.name || '').trim() === name).length > 1;
  return dup ? `${name}（第${Number(n)}關）` : name;
}

function peopleText(raw, skipText) {
  const v = raw;
  if (v === 'skip' || v === '' || v == null || v === '0') return skipText;
  return formatUserIds(v, props.users) || skipText;
}

const rows = computed(() => {
  const data = props.formData || {};
  const personalDisp = leaveDisplayForForm(data);
  const out = [];

  const pushPeople = (prefix, assignType, fallback, skipText) => {
    const re = new RegExp(`^${prefix}_(\\d+)$`);
    Object.keys(data)
      .filter((k) => re.test(k))
      .forEach((k) => {
        const n = k.slice(prefix.length + 1);
        let text = data[`${k}__label`];
        if (!text) {
          if (assignType === 'dept_head') {
            if (!data[k] || data[k] === 'skip' || !Number(data[k])) text = '略過';
            else text = userLabel(findUser(props.users, data[k]), { fallbackId: data[k] });
          } else {
            text = peopleText(data[k], skipText);
          }
        }
        out.push({
          key: k,
          label: labelForFormKey(n, assignType, fallback),
          text,
          nowrap: assignType === 'users_pick',
        });
      });
  };

  const fields = props.fields || [];
  if (!fields.length) {
    Object.keys(data)
      .filter(
        (k) =>
          !k.includes('__') &&
          !/^dept_head_\d+$/.test(k) &&
          !/^users_pick_\d+$/.test(k) &&
          !/^cosign_\d+$/.test(k)
      )
      .forEach((k) => {
        if (k === 'attendee_ids') return;
        if (k === 'attendees') {
          out.push({ key: k, label: '出席人員', text: String(data[k] || '—') });
          return;
        }
        if (personalDisp && k === 'hours') return;
        if (personalDisp && k === 'days') {
          out.push({ key: k, label: k, text: personalDisp.text });
          return;
        }
        const shown = isMoneyFormField(null, k) ? formatYuanWanStyle(data[k]) : String(data[k] ?? '—');
        out.push({ key: k, label: k, text: shown });
      });
  } else {
    for (const f of fields) {
      if (personalDisp && f.id === 'days') {
        out.push({ key: f.id, label: f.label, text: personalDisp.text });
        continue;
      }
      if (personalDisp && f.id === 'hours') continue;
      if (f.id === 'period_roc_year') continue;
      if (f.id === 'period_month') {
        const y = welfareCurrentRocYear(data);
        const m = String(data[f.id] || '').replace(/[^\d]/g, '');
        const text = m ? `民國 ${y} 年 ${Number(m)} 月` : '—';
        out.push({ key: f.id, label: '所屬月份', text });
        continue;
      }
      if (f.id === 'submit_month') {
        const m = String(data[f.id] || '').replace(/[^\d]/g, '');
        out.push({ key: f.id, label: f.label, text: m ? `${Number(m)}月` : '—' });
        continue;
      }
      if (f.id === 'stats_start') {
        const fmt = (d) => {
          const s = String(d || '').trim();
          const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
          if (!m) return s || '—';
          const y = Number(m[1]);
          const roc = y > 1911 ? y - 1911 : y;
          return `民國 ${roc} 年 ${Number(m[2])} 月 ${Number(m[3])} 日`;
        };
        const a = fmt(data.stats_start);
        const b = fmt(data.stats_end);
        const text = a !== '—' && b !== '—' ? `${a} ～ ${b}` : a !== '—' ? a : '—';
        out.push({ key: 'stats_start', label: '統計時間', text });
        continue;
      }
      if (f.id === 'stats_end') continue;
      if (f.id === 'attendee_ids') continue;
      if (f.id === 'attendees') {
        out.push({ key: f.id, label: '出席人員', text: String(data.attendees || '—') });
        continue;
      }
      out.push({ key: f.id, label: f.label, field: f, value: data[f.id] });
    }
  }

  pushPeople('dept_head', 'dept_head', '部門主管', '略過');
  pushPeople('cosign', 'cosign_pick', '會簽人員', '略過（無會簽）');
  pushPeople('users_pick', 'users_pick', '自選簽核人', '略過');
  return out;
});
</script>
