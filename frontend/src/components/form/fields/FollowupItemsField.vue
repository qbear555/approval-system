<template>
  <div class="field field-full" data-col-span="full">
    <label>
      {{ field.label || '後續交辦事項' }}
      <span v-if="field.required"> *</span>
    </label>
    <div style="overflow:auto">
      <table class="form-view-table followup-ledger">
        <thead>
          <tr>
            <th>後續交辦事項</th>
            <th style="width:8rem">承辦人</th>
            <th style="width:9rem">完成期限</th>
            <th style="width:3.2rem"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(it, i) in rows" :key="i">
            <td>
              <input type="text" :value="it.item" placeholder="交辦事項" @input="patch(i, 'item', $event.target.value)" />
            </td>
            <td>
              <input type="text" :value="it.owner" placeholder="承辦人" @input="patch(i, 'owner', $event.target.value)" />
            </td>
            <td>
              <input type="date" :value="it.due" @input="patch(i, 'due', $event.target.value)" />
            </td>
            <td>
              <button type="button" class="btn sm outline" @click="remove(i)">刪</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div style="margin-top:8px">
      <button type="button" class="btn sm outline" @click="addRow">＋ 新增一列</button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useFormCtx } from '@/lib/form/context';
import { emptyFollowupRows, parseFollowupItems } from '@/lib/form';

const props = defineProps({
  field: { type: Object, required: true },
});

const ctx = useFormCtx();
const rows = computed(() => {
  const parsed = parseFollowupItems(ctx.data.value[props.field.id]);
  return parsed.length ? parsed : emptyFollowupRows(2);
});

function write(next) {
  ctx.set(props.field.id, next);
}

function patch(i, key, val) {
  const next = rows.value.map((r) => ({ ...r }));
  next[i] = { ...next[i], [key]: val };
  write(next);
}

function addRow() {
  write([...rows.value, { item: '', owner: '', due: '' }]);
}

function remove(i) {
  const next = rows.value.filter((_, idx) => idx !== i);
  write(next.length ? next : emptyFollowupRows(1));
}
</script>
