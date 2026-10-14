<template>
  <div class="field" style="margin-top:4px">
    <label>各假別可休／已休（全部手動）</label>
    <p class="muted" style="margin:4px 0 8px;font-size:0.8rem;line-height:1.45">
      <strong>可休天數</strong>由人事手動設定（<strong>不依年資自動計算</strong>）。
      <strong>特休</strong>以<strong>日</strong>計算（不填小時）；其他假別可填已休天數／小時。
    </p>
    <div class="table-wrap" style="max-height:320px;overflow:auto;border:1px solid var(--border);border-radius:8px">
      <table class="data" style="margin:0">
        <thead>
          <tr>
            <th style="text-align:left">假別</th>
            <th style="text-align:right;width:100px">可休天數</th>
            <th style="text-align:right;width:100px">已休天數</th>
            <th style="text-align:right;width:100px">已休小時</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="t in MANUAL_LEAVE_TRACK" :key="t.id">
            <td style="font-size:0.88rem;padding:6px 8px">
              {{ t.name }}
              <div v-if="t.id === 'special'" class="muted" style="font-size:0.72rem">以日計算，不換算小時</div>
            </td>
            <td><input v-model.number="rows[t.id].entitled" type="number" min="0" step="0.5" style="width:88px;text-align:right" /></td>
            <td><input v-model.number="rows[t.id].days" type="number" min="0" step="0.5" style="width:88px;text-align:right" /></td>
            <td>
              <span v-if="t.id === 'special'" class="muted">—（以日計）</span>
              <input v-else v-model.number="rows[t.id].hours" type="number" min="0" step="0.5" style="width:88px;text-align:right" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { reactive } from 'vue';
import { MANUAL_LEAVE_TRACK, leaveUsedMap, leaveEntitledMap } from '@/lib/leave-track';

const props = defineProps({
  user: { type: Object, default: null },
});

const rows = reactive({});
const used = leaveUsedMap(props.user);
const ent = leaveEntitledMap(props.user);
for (const t of MANUAL_LEAVE_TRACK) {
  rows[t.id] = {
    entitled: ent[t.id]?.days ?? 0,
    days: used[t.id]?.days ?? 0,
    hours: t.id === 'special' ? 0 : used[t.id]?.hours ?? 0,
  };
}

defineExpose({ rows });
</script>
