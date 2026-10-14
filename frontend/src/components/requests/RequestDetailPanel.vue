<template>
  <div class="request-detail-panel">
    <div v-if="loading" class="muted" style="padding:24px;text-align:center">載入簽核詳情中…</div>
    <div v-else-if="error" class="error-msg">{{ error }}</div>
    <template v-else-if="request">
      <Teleport v-if="!embedded && actionsTargetReady" to="#page-actions">
        <div class="detail-actions">
          <button v-for="btn in headerButtons" :key="btn.id" type="button" :class="btn.cls" :title="btn.title" :disabled="busy" @click="btn.run">
            {{ btn.label }}
          </button>
        </div>
      </Teleport>

      <div v-if="embedded" class="detail-actions" style="margin-bottom:12px;display:flex;flex-wrap:wrap;gap:8px">
        <button type="button" class="btn outline sm" @click="$emit('popout', request.id)">↗ 獨立頁開啟</button>
        <button v-for="btn in headerButtons" :key="btn.id" type="button" :class="btn.cls" :title="btn.title" :disabled="busy" @click="btn.run">
          {{ btn.label }}
        </button>
      </div>

      <!-- banners -->
      <div v-if="canApprove && detail.actingAsProxy?.principal" class="card" style="background:#eef2ff;border-color:#a5b4fc;margin-bottom:12px">
        <strong style="color:#3730a3">代簽模式</strong>
        <div class="muted" style="margin-top:6px;font-size:0.9rem">
          您正以代理人身份，代 <strong>{{ detail.actingAsProxy.principal.name || '#' + detail.actingAsProxy.principal_id }}</strong> 處理此關簽核。
          核准／駁回／退回後，歷程會註記「代理 …」。
        </div>
      </div>

      <div v-if="request.status === 'returned'" class="card" style="background:#fffbeb;border:1.5px solid #fde68a;border-left:5px solid #d97706;margin-bottom:14px;padding:14px 16px">
        <strong style="color:#b45309">⚠️ 本申請單已被退回修改</strong>
        <div style="margin-top:6px;color:#92400e;font-size:0.92rem;line-height:1.5">
          <template v-if="lastReturnAction">
            退回審核人：<strong>{{ lastReturnAction.actor_name || '審核主管' }}</strong><br />
            退回意見：「{{ htmlToPlain(lastReturnAction.comment) || '請修正單據資料後再重新送出' }}」
          </template>
          <template v-else>請修正申請單資料後重新送出審核。</template>
        </div>
      </div>

      <div v-if="request.status === 'voided'" class="card" style="background:#faf5ff;border-color:#d8b4fe;margin-bottom:12px">
        <strong style="color:#6b21a8">此申請已作廢</strong>
        <div class="muted" style="margin-top:6px;font-size:0.9rem">
          <template v-if="voidAction?.comment">原因：{{ htmlToPlain(voidAction.comment) }}<br /></template>
          <template v-if="voidAction?.actor_name">操作人：{{ voidAction.actor_name }}</template>
          <template v-if="voidAction?.created_at">　時間：{{ String(voidAction.created_at).slice(0, 16) }}</template>
          <br />歷程與附件仍保留；請假已休不再計入。
        </div>
      </div>

      <div v-if="detail.pendingVoidRequest && request.status === 'approved'" class="card" style="background:#fff7ed;border-color:#fdba74;margin-bottom:12px">
        <strong>作廢申請進行中</strong>
        <div class="muted" style="margin-top:6px;font-size:0.9rem">
          已送出作廢申請
          <router-link :to="'/detail/' + detail.pendingVoidRequest.id">#{{ detail.pendingVoidRequest.id }}</router-link>
          「{{ detail.pendingVoidRequest.title || '' }}」。原單簽核人全部通過後，此單會自動改為已作廢。
        </div>
      </div>

      <div v-if="detail.voidOfRequest" class="card" style="background:#faf5ff;border-color:#d8b4fe;margin-bottom:12px">
        <strong style="color:#6b21a8">此為作廢申請</strong>
        <div class="muted" style="margin-top:6px;font-size:0.9rem">
          通過後將自動作廢原單
          <router-link :to="'/detail/' + detail.voidOfRequest.id">#{{ detail.voidOfRequest.id }}</router-link>
          「{{ detail.voidOfRequest.title || '' }}」（目前：{{ statusLabel(detail.voidOfRequest.status) }}）。
        </div>
      </div>

      <div v-if="coApproverBanner" class="card" style="background:#fff7ed;border-color:#fdba74;margin-bottom:12px">
        <strong>會簽進行中</strong>
        <div class="muted" style="margin-top:6px;font-size:0.9rem">此步驟需<strong>全部</strong>簽核人核准後，才會通知下一步。</div>
        <div style="margin-top:8px;font-size:0.9rem">
          已簽：{{ (detail.coApprovers.approved || []).map((p) => p.name).join('、') || '尚無' }}<br />
          待簽：{{ (detail.coApprovers.pending || []).map((p) => p.name).join('、') }}
        </div>
      </div>

      <div v-if="needFinalNotifyAck" class="card" style="background:#eff6ff;border-color:#93c5fd;margin-bottom:14px;padding:16px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div>
          <strong style="color:#1e40af">🔔 {{ isLeaveReq ? '請假核准 — 請設定 Email 自動回覆（待確認）' : '最終核准完成通知（待您確認收到）' }}</strong>
          <p class="muted" style="margin:4px 0 0;color:#1d4ed8">
            此單已完成最終核定。通知說明：{{ fnLabelText }}<br />
            通知時間：{{ myFinalReceipt.created_at }}
          </p>
        </div>
        <button type="button" class="btn primary" :disabled="busy" @click="ackFinalNotify">
          {{ isLeaveReq ? '✅ 已設定自動回覆／確認收到' : '✅ 確認收到通知' }}
        </button>
      </div>
      <div v-else-if="myFinalReceipt?.acked_at" class="card" style="background:#f0fdf4;border-color:#86efac;margin-bottom:14px;padding:14px">
        <strong style="color:#166534">{{ isLeaveReq ? '已確認（設定 Email 自動回覆）' : '您已確認收到最終核准通知' }}</strong>
        <div class="muted" style="font-size:0.88rem;margin-top:2px">確認時間：{{ myFinalReceipt.acked_at }}</div>
      </div>
      <div v-else-if="request.status === 'approved' && (request.finalNotifyReceipts || []).length" class="card" style="background:#f8fafc;margin-bottom:14px;padding:14px">
        <strong>最終核准系統通知收執</strong>
        <ul style="margin:8px 0 0;padding-left:1.2rem;font-size:0.88rem">
          <li v-for="r in request.finalNotifyReceipts" :key="r.user_id">
            {{ r.user_name || r.user_username || r.user_id }}：
            <template v-if="r.acked_at">已確認（{{ r.acked_at }}）</template>
            <span v-else style="color:#b45309">待確認</span>
          </li>
        </ul>
      </div>

      <div v-if="financeBanner === 'ack'" class="card" style="background:#f0fdf4;border-color:#86efac;margin-bottom:14px;padding:16px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div>
          <strong style="color:#166534">📊 財務部授信額度建檔完成（待您點選確認）</strong>
          <div style="font-size:0.9rem;color:#15803d;margin-top:4px">
            {{ finConfirmedAction.actor_name || '財務部' }} 已於 {{ finConfirmedAction.created_at }} 完成授信額度系統建檔登記。
          </div>
        </div>
        <button type="button" class="btn success" :disabled="busy" @click="ackApplicant">✅ 我知道了（完成確認）</button>
      </div>
      <div v-else-if="financeBanner === 'staff'" class="card" style="background:#ecfdf5;border-color:#6ee7b7;margin-bottom:14px;padding:16px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div>
          <strong style="color:#065f46">📊 財務部授信額度建檔確認</strong>
          <p style="margin:4px 0 0;font-size:0.88rem;color:#047857">總經理已核定通過。請於 ERP 完成授信額度設定後再確認。</p>
        </div>
        <button type="button" class="btn success" :disabled="busy" @click="confirmFinance">✅ 確認完成額度建檔</button>
      </div>
      <div v-else-if="financeBanner === 'waiting'" class="card" style="background:#fffbeb;border-color:#fde68a;margin-bottom:14px;padding:16px">
        <strong style="color:#92400e">⏳ 已通知財務部進行授信額度建檔</strong>
        <div style="font-size:0.88rem;color:#b45309;margin-top:2px">建檔確認作業僅財務部同仁可操作。</div>
      </div>
      <div v-else-if="financeBanner === 'done'" class="card" style="background:#f0fdf4;border-color:#86efac;margin-bottom:14px;padding:16px">
        <strong style="color:#166534">財務部授信額度建檔完成</strong>
      </div>

      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:start;gap:12px;flex-wrap:wrap">
          <div>
            <h3 style="margin:0 0 8px">{{ request.title }}</h3>
            <span :class="['tag', statusTagClass(request.status)]">{{ statusLabel(request.status) }}</span>
            <span v-if="isProxySubmit" class="tag" style="background:#e0e7ff;color:#3730a3;margin-left:6px">代申請</span>
            <span v-if="canApprove && detail.actingAsProxy" class="tag" style="background:#fef3c7;color:#92400e;margin-left:6px">代簽</span>
          </div>
        </div>

        <ol v-if="steps.length" class="vue-flow-steps">
          <li
            v-for="s in steps"
            :key="s.order"
            :class="{
              current: Number(s.order) === Number(request.current_step),
              done: s.status === 'approved' || s.action === 'approve',
            }"
          >
            <span class="vfs-order">{{ s.order }}</span>
            <strong>{{ s.name || '步驟 ' + s.order }}</strong>
            <span class="muted">{{ stepAssigneeLabel(s, userName) }}</span>
          </li>
        </ol>

        <dl class="kv" style="margin-top:16px">
          <dt>流程</dt><dd>{{ request.workflow_name }}</dd>
          <dt>申請人</dt>
          <dd>
            {{ request.requester_name }}<template v-if="request.requester_dept">（{{ request.requester_dept }}）</template>
            <span v-if="isProxySubmit" class="muted" style="font-size:0.85rem"> · 由 {{ submittedByLabel }} 代申請</span>
          </dd>
          <dt>建立時間</dt><dd>{{ request.created_at }}</dd>
          <dt v-if="request.completed_at">完成時間</dt>
          <dd v-if="request.completed_at">{{ request.completed_at }}</dd>
          <dt v-if="currentStep">目前步驟</dt>
          <dd v-if="currentStep">{{ currentStep.name }}</dd>
          <dt>Email 通知</dt><dd>{{ emailNotifyText(request) }}</dd>
        </dl>

        <div v-if="usePdfFormView" class="pdf-form-view">
          <div class="pdf-form-toolbar">
            <strong>申請單（PDF）</strong>
            <span class="muted" style="font-size:0.82rem">簽核中以正式 PDF 版面檢視</span>
            <button type="button" class="btn outline sm" style="margin-left:auto" @click="loadPdfPreview">重新載入</button>
            <button type="button" class="btn outline sm" :disabled="!pdfObjectUrl" @click="openPdfTab">新分頁開啟</button>
          </div>
          <div class="pdf-preview-wrap">
            <iframe v-if="pdfObjectUrl" class="pdf-frame" title="申請單 PDF 預覽" :src="pdfObjectUrl + '#toolbar=1&navpanes=0&view=FitH'"></iframe>
            <div v-else-if="pdfError" class="error-msg" style="margin:12px">{{ pdfError }}</div>
            <div v-else class="muted" style="padding:24px;text-align:center">正在產生 PDF 預覽…</div>
          </div>
          <details class="pdf-form-fallback">
            <summary class="muted" style="cursor:pointer;font-size:0.9rem">顯示網頁表單內容（備援）</summary>
            <div style="margin-top:10px;padding:0 12px 12px">
              <FormDataViewer :fields="formFields" :form-data="formData" :steps="steps" :template-steps="templateSteps" :users="usersStore.list" />
              <ApproverDataBlock :data="request.approver_data" />
            </div>
          </details>
        </div>
        <template v-else>
          <FormDataViewer :fields="formFields" :form-data="formData" :steps="steps" :template-steps="templateSteps" :users="usersStore.list" />
          <ApproverDataBlock :data="request.approver_data" />
        </template>

        <AttachmentList
          :attachments="request.attachments || []"
          :request-status="request.status"
          :only-office-enabled="onlyOfficeEnabled"
          @office="openOffice"
        />
      </div>

      <RequestTimeline :request="request" />

      <div v-if="canApprove" class="card">
        <h3>
          簽核處理 — {{ currentStep?.name || '' }}
          <span v-if="detail.actingAsProxy?.principal?.name" class="muted" style="font-weight:500;font-size:0.9rem">
            （代理 {{ detail.actingAsProxy.principal.name }}）
          </span>
        </h3>
        <LaborBanner
          v-if="showLaborBanner"
          :labor="detail.applicantLabor"
          :request="request"
        />
        <template v-if="approverFields.length">
          <FormFields v-model="stepFormData" :fields="approverFields" compact />
          <p class="muted" style="font-size:0.85rem;margin:0 0 12px">{{ approverHint }}</p>
        </template>
        <div v-if="canAttach" class="field" style="margin-bottom:12px">
          <label>補充附件（選填，可多檔）</label>
          <input ref="fileInput" type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.gif,.doc,.docx,.xls,.xlsx,.txt,image/*" />
          <div class="muted" style="font-size:0.82rem;margin-top:4px">中間簽核步驟可一次多選新增附件（最多 20 個）。最終審核者不可上傳。</div>
          <div class="form-actions" style="margin-top:8px;display:flex;flex-wrap:wrap;gap:8px">
            <button type="button" class="btn outline sm" :disabled="busy" @click="uploadStepFiles">僅上傳附件</button>
            <button type="button" class="btn outline sm" :disabled="busy" @click="showPickApproved = true">附加已核准申請單</button>
          </div>
        </div>
        <p v-else-if="detail.isFinalStep" class="muted" style="font-size:0.85rem;margin:0 0 12px">此為最終審核步驟，不可新增附件。</p>
        <div class="field">
          <label>簽核意見</label>
          <div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">
            <button v-for="p in phrases" :key="p" type="button" class="btn outline xs" @click="comment = p">{{ p }}</button>
          </div>
          <textarea v-model="comment" rows="3" placeholder="選填意見（駁回／退回時建議填寫）…"></textarea>
        </div>
        <div class="approval-action-bar">
          <button type="button" class="btn success" :disabled="busy" @click="doAction('approve')">核准</button>
          <button type="button" class="btn danger" :disabled="busy" @click="doAction('reject')">駁回</button>
          <button type="button" class="btn outline" :disabled="busy" @click="openCosign">➕ 加簽</button>
          <button type="button" class="btn outline" :disabled="busy" @click="openForward">↗️ 轉簽</button>
          <button v-if="canReturn" type="button" class="btn warning" :disabled="busy" @click="openReturn">↩ 退回…</button>
        </div>
        <p v-if="canReturn" class="muted" style="font-size:0.85rem;margin:10px 0 0;line-height:1.45">
          點擊「退回」可選擇退回給<strong>申請人修改補件</strong>，或退回給先前的<strong>特定簽核關卡</strong>重新審查。
        </p>
      </div>
    </template>

    <div v-if="showPickApproved" class="action-modal-overlay" @click.self="showPickApproved = false">
      <div class="action-modal-panel" style="max-width:560px">
        <h3>附加已核准申請單</h3>
        <p class="muted">勾選後會把該單 PDF 附加到此申請。</p>
        <div v-if="pickLoading" class="muted">載入中…</div>
        <div v-else style="max-height:320px;overflow:auto">
          <label v-for="r in pickList" :key="r.id" class="check-row" style="display:flex;gap:8px;padding:6px 0">
            <input type="checkbox" :value="r.id" v-model="pickIds" />
            <span>#{{ r.id }} {{ r.title }}（{{ r.workflow_name }}）</span>
          </label>
          <div v-if="!pickList.length" class="muted">沒有可附加的已核准單據</div>
        </div>
        <div class="form-actions" style="margin-top:12px;justify-content:flex-end">
          <button type="button" class="btn outline" @click="showPickApproved = false">取消</button>
          <button type="button" class="btn primary" :disabled="busy || !pickIds.length" @click="attachApproved">附加</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  fetchRequest,
  fetchRequests,
  postRequestAction,
  updateRequest,
  deleteRequest,
  remindRequest,
  voidApplyRequest,
  voidRequest,
  financeConfirmRequest,
  applicantAckRequest,
  finalNotifyAckRequest,
  uploadRequestAttachments,
  fetchRequestPdf,
  fetchOnlyOfficeStatus,
} from '@/api/requests';
import { apiRequest } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { useUsersStore } from '@/stores/users';
import { useToastStore } from '@/stores/toast';
import { useSystemStore } from '@/stores/system';
import { statusLabel } from '@/lib/status';
import { resolveCommentPhrases } from '@/lib/comment-phrases';
import { initFormData, collectFormPayload, validateFormData } from '@/composables/useFormModel';
import { stripSpecialLeaveHoursFields } from '@/lib/form';
import {
  htmlToPlain,
  creditStepPrefill,
  isCreditLimitRequest,
  emailNotifyText,
  statusTagClass,
  voidStepsPathText,
  stepAssigneeLabel,
} from '@/lib/request-detail';
import { openCosignModal, openForwardModal, openReturnModal } from '@/composables/useApprovalActions';
import FormDataViewer from '@/components/form/FormDataViewer.vue';
import FormFields from '@/components/form/FormFields.vue';
import AttachmentList from '@/components/form/AttachmentList.vue';
import LaborBanner from '@/components/form/LaborBanner.vue';
import RequestTimeline from './RequestTimeline.vue';
import ApproverDataBlock from './ApproverDataBlock.vue';

const props = defineProps({
  requestId: { type: [Number, String], default: null },
  embedded: { type: Boolean, default: false },
});
const emit = defineEmits(['action-completed', 'popout', 'loaded']);

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const usersStore = useUsersStore();
const toast = useToastStore();
const systemStore = useSystemStore();

const loading = ref(true);
const error = ref('');
const detail = ref({});
const busy = ref(false);
const comment = ref('');
const stepFormData = ref({});
const fileInput = ref(null);
const onlyOfficeEnabled = ref(false);
const pdfObjectUrl = ref('');
const pdfError = ref('');
const actionsTargetReady = ref(false);
const showPickApproved = ref(false);
const pickLoading = ref(false);
const pickList = ref([]);
const pickIds = ref([]);
const phrases = ref(resolveCommentPhrases(auth.user));

const requestId = computed(() => Number(props.requestId || route.params.id || 0));
const request = computed(() => detail.value.request || null);
const canApprove = computed(() => !!detail.value.canApprove);
const currentStep = computed(() => detail.value.currentStep || null);
const steps = computed(() => request.value?.steps || []);
const formFields = computed(() => request.value?.formFields || []);
const templateSteps = computed(() => request.value?.templateSteps || []);
const formData = computed(() => {
  const raw = request.value?.form_data;
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
});

const previousStep = computed(() => {
  if (detail.value.previousStep) return detail.value.previousStep;
  const list = steps.value;
  const idx = list.findIndex((s) => Number(s.order) === Number(request.value?.current_step));
  if (idx > 0) {
    return { order: list[idx - 1].order, name: list[idx - 1].name || `步驟 ${list[idx - 1].order}` };
  }
  return null;
});
const canReturn = computed(
  () => !!canApprove.value && request.value?.status === 'pending' && !!(detail.value.canReturn || previousStep.value)
);
const canAttach = computed(() => !!detail.value.canAttach);

const uid = computed(() => Number(auth.user?.id || 0));
const isOwner = computed(() => {
  const r = request.value;
  if (!r) return false;
  return Number(r.requester_id) === uid.value || Number(r.submitted_by) === uid.value || auth.isAdmin;
});
const isOwnDraft = computed(() => rStatus('draft') && isOwner.value);
const isOwnReturned = computed(() => rStatus('returned') && isOwner.value);
function rStatus(s) {
  return request.value?.status === s;
}

const isProxySubmit = computed(() => {
  const r = request.value;
  return r?.submitted_by && Number(r.submitted_by) !== Number(r.requester_id);
});
const submittedByLabel = computed(() => {
  const r = request.value;
  if (!r) return '';
  if (r.submitted_by_name) return r.submitted_by_name;
  return userName(r.submitted_by);
});

const lastReturnAction = computed(() =>
  [...(request.value?.actions || [])].reverse().find((a) => a.action === 'return')
);
const voidAction = computed(() =>
  [...(request.value?.actions || [])].reverse().find((a) => a.action === 'void')
);

const coApproverBanner = computed(() => {
  const c = detail.value.coApprovers;
  return (
    c &&
    c.mode === 'all' &&
    (c.pending || []).length > 0 &&
    request.value?.status === 'pending'
  );
});

const myFinalReceipt = computed(() =>
  (request.value?.finalNotifyReceipts || []).find((r) => Number(r.user_id) === uid.value)
);
const needFinalNotifyAck = computed(() => myFinalReceipt.value && !myFinalReceipt.value.acked_at);
const isLeaveReq = computed(() => {
  const r = request.value;
  return (
    /請假|休假|leave/i.test(String(r?.workflow_name || '')) ||
    /請假|休假/i.test(String(r?.title || '')) ||
    /自動回覆|Email/i.test(String(myFinalReceipt.value?.label || ''))
  );
});
const fnLabelText = computed(
  () => myFinalReceipt.value?.label || (isLeaveReq.value ? '設定 Email 自動回覆' : '最終核准完成通知')
);

const finConfirmedAction = computed(() =>
  (request.value?.actions || []).find((a) => a.step_name === '財務部額度建檔確認')
);
const applicantAckAction = computed(() =>
  (request.value?.actions || []).find((a) => a.step_name === '申請人建檔確認')
);
const financeBanner = computed(() => {
  const r = request.value;
  if (!r || !isCreditLimitRequest(r) || r.status !== 'approved') return '';
  if (finConfirmedAction.value) {
    if (!applicantAckAction.value && (Number(r.requester_id) === uid.value || auth.isAdmin)) return 'ack';
    return 'done';
  }
  if (auth.isFinanceStaff) return 'staff';
  return 'waiting';
});

const usePdfFormView = computed(() => {
  const r = request.value;
  if (!r) return false;
  return r.status === 'pending' || r.pdfLayout?.type === 'pdf_template';
});

const approverFields = computed(() =>
  stripSpecialLeaveHoursFields(currentStep.value?.approverFields || [])
);
const showLaborBanner = computed(() => {
  const labor = detail.value.applicantLabor;
  const step = currentStep.value;
  if (!labor || !canApprove.value) return false;
  if (/代理/.test(String(step?.name || ''))) return false;
  if (step?.assignType === 'form_user') return false;
  return true;
});
const approverHint = computed(() => {
  const name = String(currentStep.value?.name || '');
  if (detail.value.applicantLabor) {
    return '切換「假別（人事核定）」時，標籤會改為對應假別。僅特休自動帶入剩餘日數。';
  }
  if (/人事/.test(name)) return '人事單位：請選擇假別；特休請確認剩餘日數。';
  if (/管理部/.test(name)) return '管理部：請依檢核標準填寫上方欄位。';
  if (/財務/.test(name)) return '財務人員：請填寫銷貨收入、銷貨成本、銷貨毛利。';
  if (/業務/.test(name)) return '業務人員：請填寫「申請信用額度（元）」。';
  if (/副總/.test(name)) return '副總經理：請填寫「建議額度（元）」。';
  if (/總經理/.test(name)) return '總經理：請填「核定額度（元）」。';
  return `${currentStep.value?.name || '簽核單位'}：請填寫上方欄位。`;
});

const headerButtons = computed(() => {
  const r = request.value;
  if (!r) return [];
  const out = [];
  const proxyHint = detail.value.actingAsProxy?.principal?.name
    ? `（代理 ${detail.value.actingAsProxy.principal.name}）`
    : '';
  if (isOwnDraft.value) {
    out.push({ id: 'edit-draft', label: '繼續編輯草稿', cls: 'btn primary', run: editDraft });
    out.push({ id: 'submit-draft', label: '送出申請', cls: 'btn success', run: submitDraft });
  }
  if (isOwnReturned.value) {
    out.push({ id: 'edit-ret', label: '✏️ 修改並重新送審', cls: 'btn warning', run: editDraft });
    out.push({ id: 'cancel-ret', label: '取消申請', cls: 'btn danger outline', run: () => doAction('cancel') });
  }
  if (canApprove.value) {
    out.push({ id: 'approve', label: `核准${proxyHint}`, cls: 'btn success', run: () => doAction('approve') });
    out.push({ id: 'reject', label: '駁回', cls: 'btn danger', run: () => doAction('reject') });
    out.push({ id: 'cosign', label: '➕ 加簽', cls: 'btn outline', title: '臨時邀請其他同仁加簽', run: openCosign });
    out.push({ id: 'forward', label: '↗️ 轉簽', cls: 'btn outline', title: '將目前簽核關卡轉交給其他人', run: openForward });
    if (canReturn.value) {
      out.push({ id: 'return', label: '↩ 退回…', cls: 'btn warning', run: openReturn });
    }
  }
  if (isOwner.value && r.status === 'pending') {
    out.push({ id: 'remind', label: 'Email 催辦簽核人', cls: 'btn outline', run: remind });
  }
  if (detail.value.canCancel) {
    out.push({ id: 'cancel', label: '取消申請', cls: 'btn outline', run: () => doAction('cancel') });
  }
  if (detail.value.canVoidApply) {
    out.push({ id: 'void-apply', label: '申請作廢', cls: 'btn warning', run: voidApply });
  }
  if (detail.value.canVoid) {
    out.push({ id: 'void', label: '直接作廢', cls: 'btn outline', run: voidDirect });
  }
  if (r.status !== 'draft' || isOwner.value) {
    const attCount = (r.attachments || []).length;
    const zipDl = r.status === 'approved' && attCount > 0;
    out.push({
      id: 'pdf',
      label: zipDl ? `下載 PDF＋附件（${attCount}）` : '下載 PDF',
      cls: 'btn primary',
      run: downloadPdf,
    });
  }
  if (r.status !== 'draft') {
    out.push({ id: 'clone', label: '📑 複製為新申請', cls: 'btn outline', run: cloneRequest });
  }
  if (detail.value.canDelete) {
    out.push({ id: 'del', label: '刪除申請', cls: 'btn danger', run: delRequest });
  }
  return out;
});

function userName(id) {
  const u = usersStore.byId(id);
  return u ? u.name : id ? `#${id}` : '—';
}

async function loadDetail() {
  const id = requestId.value;
  if (!id) {
    error.value = '未指定申請單編號';
    loading.value = false;
    return;
  }
  loading.value = true;
  error.value = '';
  try {
    await usersStore.fetch();
    const data = await fetchRequest(id);
    let oo = false;
    try {
      const st = await fetchOnlyOfficeStatus();
      oo = !!st.enabled;
    } catch {
      oo = false;
    }
    data.onlyOfficeEnabled = oo;
    onlyOfficeEnabled.value = oo;
    detail.value = data;
    resetStepForm();
    applyTitle();
    emit('loaded', data);
    if (usePdfFormView.value) await loadPdfPreview();
    else revokePdf();
  } catch (e) {
    error.value = e.message || '載入失敗';
    detail.value = {};
  } finally {
    loading.value = false;
  }
}

function resetStepForm() {
  const fields = stripSpecialLeaveHoursFields(detail.value.currentStep?.approverFields || []);
  const pre = {
    ...(detail.value.applicantLabor?.fieldPrefill || {}),
    ...creditStepPrefill(detail.value.currentStep, detail.value.request?.approver_data),
  };
  stepFormData.value = initFormData(fields, [], pre);
  comment.value = '';
}

function applyTitle() {
  if (props.embedded) return;
  const el = document.getElementById('page-title');
  const r = request.value;
  if (el && r) {
    el.textContent = `簽核詳情 #${r.id}${r.status === 'draft' ? '（草稿）' : ''}`;
  }
}

function afterAction(arg) {
  const stay = !!(arg && typeof arg === 'object' && arg.stay);
  const nextId = arg && typeof arg === 'object' ? arg.id : arg;
  systemStore.fetchStats().catch(() => {});
  if (props.embedded && !stay) {
    emit('action-completed', { id: nextId || request.value?.id, request: request.value });
    return;
  }
  if (nextId && Number(nextId) !== requestId.value) {
    router.push(`/detail/${nextId}`);
    return;
  }
  loadDetail();
}

async function doAction(action) {
  const r = request.value;
  if (!r) return;
  if (action === 'reject' && !String(comment.value || '').trim()) {
    if (!confirm('確定要駁回嗎？（建議填寫意見）')) return;
  }
  if (action === 'cancel' && !confirm('確定取消此申請？')) return;
  let step_form_data = {};
  if (action === 'approve' && approverFields.value.length) {
    const err = validateFormData(approverFields.value, [], stepFormData.value);
    if (err) {
      toast.error(err);
      return;
    }
    step_form_data = collectFormPayload(stepFormData.value, approverFields.value);
  }
  const files = fileInput.value?.files ? [...fileInput.value.files] : [];
  if (files.length > 20) {
    toast.error('附件最多 20 個');
    return;
  }
  if (files.length && detail.value.isFinalStep) {
    toast.error('最終審核步驟不可新增附件');
    return;
  }
  const attachFiles = action === 'approve' ? files : [];
  busy.value = true;
  try {
    const body = new FormData();
    body.append('action', action);
    body.append('comment', comment.value || '');
    body.append('step_form_data', JSON.stringify(step_form_data || {}));
    attachFiles.forEach((f) => body.append('attachments', f));
    const result = await postRequestAction(r.id, body);
    const msg =
      result?.message ||
      (action === 'approve'
        ? '已核准'
        : action === 'reject'
          ? '已駁回'
          : action === 'return'
            ? '已退回'
            : action === 'cancel'
              ? '已取消'
              : '已完成');
    toast.success(msg);
    afterAction();
  } catch (e) {
    toast.error(e.message || '操作失敗');
  } finally {
    busy.value = false;
  }
}

function openCosign() {
  openCosignModal(request.value, () => afterAction({ stay: true }));
}
function openForward() {
  openForwardModal(request.value, afterAction);
}
function openReturn() {
  openReturnModal(request.value, detail.value, afterAction);
}

function editDraft() {
  router.push({ path: '/new-request', query: { draftId: String(request.value.id) } });
}
function cloneRequest() {
  router.push({ path: '/new-request', query: { cloneFrom: String(request.value.id) } });
}

async function submitDraft() {
  const r = request.value;
  if (!confirm('確定以目前草稿內容送出簽核？\n送出後將進入簽核流程，無法再當草稿編輯。')) return;
  busy.value = true;
  try {
    const body = new FormData();
    body.append('workflow_id', String(r.workflow_id));
    body.append('title', r.title || '');
    body.append('content', '');
    body.append('form_data', JSON.stringify(r.form_data || {}));
    body.append('submit', '1');
    body.append('as_draft', '0');
    if (r.submitted_by && Number(r.submitted_by) === uid.value && Number(r.requester_id) !== uid.value) {
      body.append('proxy_for', String(r.requester_id));
      body.append('on_behalf_of_user_id', String(r.requester_id));
    }
    if (r.notify_prefs) {
      body.append('notify_prefs', JSON.stringify(r.notify_prefs));
      body.append('notify_email', r.notify_email === 0 ? '0' : '1');
    }
    const data = await updateRequest(r.id, body);
    toast.success(data.message || '申請已送出');
    afterAction(r.id);
  } catch (e) {
    toast.error(e.message);
  } finally {
    busy.value = false;
  }
}

async function remind() {
  if (!confirm('確定寄送 Email 催辦目前步驟簽核人？\n（同一單據 10 分鐘內僅能催辦一次）')) return;
  busy.value = true;
  try {
    const data = await remindRequest(request.value.id);
    const extra = data.warning ? `（${data.warning}）` : '';
    const toList = Array.isArray(data.emails) ? data.emails.join('、') : '';
    toast.success(`已寄送催辦信給 ${data.sentTo || 0} 位${toList ? `：${toList}` : ''}${extra}`);
    afterAction({ stay: true });
  } catch (e) {
    toast.error(e.message || '催辦失敗');
  } finally {
    busy.value = false;
  }
}

async function voidApply() {
  const path = voidStepsPathText(detail.value.voidPreviewSteps || []);
  const reason = prompt(`請輸入作廢原因（必填）。\n送出後將由原單簽核人再簽：\n${path || '（依原單簽核人）'}`);
  if (reason === null) return;
  if (!String(reason).trim()) {
    toast.error('請填寫作廢原因');
    return;
  }
  if (!confirm(`確定提出作廢申請？\n原單：#${request.value.id}「${request.value.title}」`)) return;
  busy.value = true;
  try {
    const data = await voidApplyRequest(request.value.id, String(reason).trim());
    toast.success(data.message || '作廢申請已送出');
    afterAction(data.request?.id || request.value.id);
  } catch (e) {
    toast.error(e.message || '送出失敗');
  } finally {
    busy.value = false;
  }
}

async function voidDirect() {
  const reason = prompt('請輸入作廢原因（必填）。\n此為直接作廢，不會再走原單簽核人流程。');
  if (reason === null) return;
  if (!String(reason).trim()) {
    toast.error('請填寫作廢原因');
    return;
  }
  if (!confirm(`確定直接作廢 #${request.value.id}「${request.value.title}」？`)) return;
  busy.value = true;
  try {
    const data = await voidRequest(request.value.id, String(reason).trim());
    toast.success(data.message || '申請已作廢');
    afterAction();
  } catch (e) {
    toast.error(e.message || '作廢失敗');
  } finally {
    busy.value = false;
  }
}

async function downloadPdf() {
  busy.value = true;
  try {
    const { blob, filename } = await fetchRequestPdf(request.value.id, { returnMeta: true });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const hasAtt = !!(request.value.attachments || []).length;
    const isZip = blob.type.includes('zip') || (request.value.status === 'approved' && hasAtt);
    a.download = filename || `request-${request.value.id}${isZip ? '.zip' : '.pdf'}`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(isZip ? '已下載 ZIP' : 'PDF 已開始下載');
  } catch (e) {
    toast.error(e.message);
  } finally {
    busy.value = false;
  }
}

function revokePdf() {
  if (pdfObjectUrl.value) {
    try {
      URL.revokeObjectURL(pdfObjectUrl.value);
    } catch {
      /* ignore */
    }
    pdfObjectUrl.value = '';
  }
}

async function loadPdfPreview() {
  pdfError.value = '';
  revokePdf();
  try {
    const blob = await fetchRequestPdf(request.value.id, { preview: true });
    const type = String(blob?.type || '').toLowerCase();
    if (type && !type.includes('pdf') && !type.includes('octet-stream')) {
      throw new Error(`伺服器回傳 ${type || '非 PDF'}。請展開下方網頁表單或下載檔案。`);
    }
    const pdfBlob =
      type.includes('pdf') || !type ? blob : new Blob([await blob.arrayBuffer()], { type: 'application/pdf' });
    pdfObjectUrl.value = URL.createObjectURL(pdfBlob);
  } catch (e) {
    pdfError.value = `PDF 預覽失敗：${e.message || '未知錯誤'}。請展開下方「網頁表單內容」或按「下載 PDF」。`;
  }
}
function openPdfTab() {
  if (pdfObjectUrl.value) window.open(pdfObjectUrl.value, '_blank', 'noopener');
}

async function ackFinalNotify() {
  busy.value = true;
  try {
    await finalNotifyAckRequest(request.value.id);
    toast.success('已確認收到最終核准通知');
    afterAction({ stay: true });
  } catch (e) {
    toast.error(e.message);
  } finally {
    busy.value = false;
  }
}
async function ackApplicant() {
  busy.value = true;
  try {
    await applicantAckRequest(request.value.id);
    toast.success('已確認財務部建檔完成！');
    afterAction({ stay: true });
  } catch (e) {
    toast.error(e.message);
  } finally {
    busy.value = false;
  }
}
async function confirmFinance() {
  busy.value = true;
  try {
    await financeConfirmRequest(request.value.id);
    toast.success('已完成財務部額度建檔登記，並發送通知至申請人');
    afterAction({ stay: true });
  } catch (e) {
    toast.error(e.message);
  } finally {
    busy.value = false;
  }
}

async function uploadStepFiles() {
  const files = fileInput.value?.files ? [...fileInput.value.files] : [];
  if (!files.length) {
    toast.error('請先選擇檔案');
    return;
  }
  if (files.length > 20) {
    toast.error('附件最多 20 個');
    return;
  }
  const fd = new FormData();
  files.forEach((f) => fd.append('attachments', f));
  busy.value = true;
  try {
    const data = await uploadRequestAttachments(request.value.id, fd);
    toast.success(data.message || '附件已上傳');
    afterAction({ stay: true });
  } catch (e) {
    toast.error(e.message);
  } finally {
    busy.value = false;
  }
}

watch(showPickApproved, async (open) => {
  if (!open) return;
  pickLoading.value = true;
  pickIds.value = [];
  try {
    const res = await fetchRequests({ filter: 'mine', status: 'approved' });
    const already = (request.value?.attachments || []).map((a) => Number(a.source_request_id)).filter(Boolean);
    pickList.value = (res.requests || res.items || []).filter(
      (r) => Number(r.id) !== request.value.id && !already.includes(Number(r.id))
    );
  } catch (e) {
    toast.error(e.message || '無法載入已核准單據');
    pickList.value = [];
  } finally {
    pickLoading.value = false;
  }
});

async function attachApproved() {
  if (!pickIds.value.length) return;
  const fd = new FormData();
  fd.append('linked_request_ids', JSON.stringify(pickIds.value.map(Number)));
  busy.value = true;
  try {
    const data = await uploadRequestAttachments(request.value.id, fd);
    toast.success(data.message || '已附加已核准申請單');
    showPickApproved.value = false;
    afterAction({ stay: true });
  } catch (e) {
    toast.error(e.message);
  } finally {
    busy.value = false;
  }
}

async function delRequest() {
  const r = request.value;
  if (!confirm(`確定刪除申請 #${r.id}「${r.title}」？\n將一併刪除歷程、附件與相關備份，無法復原。`)) return;
  busy.value = true;
  try {
    await deleteRequest(r.id);
    toast.success('已刪除申請');
    if (props.embedded) {
      emit('action-completed', { id: r.id, deleted: true });
    } else {
      router.push(Number(r.requester_id) === uid.value ? '/mine' : '/records');
    }
  } catch (e) {
    toast.error(e.message);
  } finally {
    busy.value = false;
  }
}

async function openOffice(att) {
  try {
    if (typeof window.openOnlyOfficeEditor === 'function') {
      await window.openOnlyOfficeEditor(att.id, request.value.id);
      return;
    }
    await apiRequest(`/api/onlyoffice/editor/${att.id}`);
    toast.info('請先至其他管理頁載入編輯器，或改以下載後開啟');
  } catch (e) {
    toast.error(e.message || '無法開啟 OnlyOffice');
  }
}

watch(requestId, () => loadDetail());

onMounted(async () => {
  actionsTargetReady.value = !!document.getElementById('page-actions');
  try {
    const res = await apiRequest('/api/me/comment-phrases');
    if (Array.isArray(res.phrases) && res.phrases.length) phrases.value = res.phrases;
  } catch {
    /* keep defaults */
  }
  await loadDetail();
});

onBeforeUnmount(() => {
  revokePdf();
});
</script>

<style scoped>
.detail-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}
.vue-flow-steps {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 14px 0 0;
  padding: 0;
}
.vue-flow-steps li {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: 1px solid var(--border, #cbd5e1);
  border-radius: 8px;
  background: #f8fafc;
  font-size: 0.85rem;
}
.vue-flow-steps li.current {
  border-color: #3b82f6;
  background: #eff6ff;
}
.vue-flow-steps li.done {
  border-color: #86efac;
  background: #f0fdf4;
}
.vfs-order {
  display: inline-flex;
  width: 20px;
  height: 20px;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #e2e8f0;
  font-size: 0.75rem;
  font-weight: 700;
}
.action-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 80;
}
.action-modal-panel {
  background: var(--surface, #fff);
  border-radius: 12px;
  padding: 20px;
  width: min(560px, 92vw);
}
</style>
