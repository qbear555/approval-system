<template>
  <div v-if="!items.length" class="empty-state">
    <div class="empty-title">{{ emptyTitle }}</div>
    <p class="empty-desc muted">{{ emptyDesc }}</p>
    <div v-if="$slots.actions" class="form-actions" style="justify-content: center; margin-top: 12px">
      <slot name="actions" />
    </div>
  </div>
  <div v-else class="table-wrap">
    <table class="data">
      <thead>
        <tr>
          <th v-if="showCheckbox" style="width: 40px"></th>
          <th>單號</th>
          <th>主旨</th>
          <th>流程</th>
          <th>申請人</th>
          <th>狀態</th>
          <th>更新時間</th>
          <th v-if="showDeleteCol">操作</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="r in items"
          :key="r.id"
          class="clickable"
          @click="onRowClick($event, r)"
        >
          <td v-if="showCheckbox" @click.stop>
            <input
              v-if="isRowCheckable(r)"
              type="checkbox"
              :value="r.id"
              :checked="selectedIds.includes(Number(r.id))"
              @change="toggleOne(r, $event.target.checked)"
            />
          </td>
          <td>#{{ r.id }}</td>
          <td>
            <strong>{{ r.title || '—' }}</strong>
            <span v-if="r.is_proxy_pending" class="tag" style="background:#fef3c7;color:#92400e;font-size:0.75rem;margin-left:4px">
              代簽{{ r.proxy_principal_name ? '·' + r.proxy_principal_name : '' }}
            </span>
            <span v-if="r.is_proxy_submit" class="tag" style="background:#e0e7ff;color:#3730a3;font-size:0.75rem;margin-left:4px">代申請</span>
          </td>
          <td>{{ r.workflow_name || '—' }}</td>
          <td>
            {{ r.requester_name || '—' }}
            <div v-if="r.is_proxy_submit && r.submitted_by_name" class="muted" style="font-size:0.78rem">
              代申請：{{ r.submitted_by_name }}
            </div>
          </td>
          <td><span class="tag" :class="statusClass(r.status)">{{ statusLabel(r.status) }}</span></td>
          <td class="muted">{{ formatDateTime(r.updated_at) }}</td>
          <td v-if="showDeleteCol" @click.stop>
            <button
              v-if="canDelete(r)"
              type="button"
              class="btn sm danger"
              @click="$emit('delete', r)"
            >刪除</button>
            <span v-else-if="r.approver_signed || r.can_delete === false" class="muted" style="font-size:0.82rem">已簽核不可刪</span>
            <span v-else-if="r.status === 'approved'" class="muted" style="font-size:0.82rem">已核准不可刪</span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { statusLabel, statusClass } from '@/lib/status';
import { formatDateTime } from '@/lib/format';
import { canDeleteRequestRow } from '@/lib/request-access';

const props = defineProps({
  items: { type: Array, default: () => [] },
  emptyTitle: { type: String, default: '尚無資料' },
  emptyDesc: { type: String, default: '目前沒有符合條件的簽核單據。' },
  allowDelete: { type: Boolean, default: false },
  allowBatchApprove: { type: Boolean, default: false },
  adminMode: { type: Boolean, default: false },
  selectedIds: { type: Array, default: () => [] },
  isAdmin: { type: Boolean, default: false },
  hasLeaveDelete: { type: Boolean, default: false },
  hasRecordsDelete: { type: Boolean, default: false },
  userId: { type: [Number, String], default: null },
});

const emit = defineEmits(['select', 'delete']);
const router = useRouter();

function canDelete(r) {
  if (!props.allowDelete) return false;
  return canDeleteRequestRow(r, {
    isAdmin: props.isAdmin,
    hasLeaveDelete: props.hasLeaveDelete,
    hasRecordsDelete: props.hasRecordsDelete,
    userId: props.userId,
    adminMode: props.adminMode,
  });
}

const anyDeletable = computed(() => props.allowDelete && props.items.some((r) => canDelete(r)));
const showCheckbox = computed(() => anyDeletable.value || (props.allowBatchApprove && props.items.length > 0));
const showDeleteCol = computed(() => anyDeletable.value);

function isRowCheckable(r) {
  if (props.allowBatchApprove && r.status === 'pending') return true;
  return canDelete(r);
}

function toggleOne(r, checked) {
  const id = Number(r.id);
  const next = checked
    ? [...new Set([...props.selectedIds, id])]
    : props.selectedIds.filter((x) => x !== id);
  emit('select', next);
}

function onRowClick(e, r) {
  if (e.target.closest('input,button,a,label')) return;
  router.push(`/detail/${r.id}`);
}
</script>
