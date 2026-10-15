<template>
  <div class="new-request-page">
    <div v-if="loading" class="card muted" style="padding:28px;text-align:center">載入流程中…</div>

    <div v-else-if="!workflows.length" class="card" style="padding:36px;text-align:center">
      <div style="font-size:2rem;margin-bottom:8px">📋</div>
      <h3 style="margin:0 0 6px">尚無可用的簽核流程</h3>
      <p class="muted">
        {{ auth.hasPerm('workflows') ? '請先建立簽核流程，才能讓同仁送出申請。' : '目前沒有已啟用的流程，請洽系統管理員建立或啟用。' }}
      </p>
      <div style="margin-top:12px;display:flex;gap:8px;justify-content:center">
        <router-link v-if="auth.hasPerm('workflows')" to="/workflows" class="btn primary">前往簽核流程</router-link>
        <router-link v-else to="/dashboard" class="btn outline">回總覽</router-link>
      </div>
    </div>

    <template v-else>
      <!-- 表單目錄 -->
      <div v-show="view === 'catalog'" class="card" id="form-catalog-card">
        <div class="catalog-header">
          <h2>選擇申請表單</h2>
          <p>請點選欲申請的表單項目，或利用上方搜尋框與分類頁籤快速篩選。</p>
        </div>

        <div class="catalog-search-wrap">
          <span class="catalog-search-icon">🔍</span>
          <input
            v-model="catalogSearch"
            type="text"
            class="catalog-search-input"
            placeholder="搜尋表單名稱、說明或關鍵字（例如：請假、報支、報修、請購、出差、加班...）"
            autocomplete="off"
          />
          <button
            v-if="catalogSearch"
            type="button"
            class="catalog-search-clear"
            title="清除搜尋"
            @click="catalogSearch = ''"
          >
            ✕
          </button>
        </div>

        <div class="catalog-tabs">
          <button
            type="button"
            class="catalog-tab"
            :class="{ active: catalogCat === '全部' }"
            @click="catalogCat = '全部'"
          >
            全部 <span class="catalog-tab-count">{{ workflows.length }}</span>
          </button>
          <button
            v-for="cat in categories"
            :key="cat"
            type="button"
            class="catalog-tab"
            :class="{ active: catalogCat === cat }"
            @click="catalogCat = cat"
          >
            {{ cat }}
            <span class="catalog-tab-count">{{ countByCat(cat) }}</span>
          </button>
        </div>

        <div class="catalog-grid">
          <div
            v-for="w in filteredWorkflows"
            :key="w.id"
            class="catalog-card"
            @click="selectWorkflow(w.id)"
          >
            <div class="catalog-card-header">
              <div class="catalog-icon-box" :class="getCategoryClass(w.category)">
                {{ getWorkflowIcon(w.name, w.category) }}
              </div>
              <div style="display:flex;align-items:center;gap:6px">
                <span class="catalog-category-tag" :class="getCategoryClass(w.category)">{{
                  normalizeWorkflowCategory(w)
                }}</span>
                <button
                  type="button"
                  class="catalog-fav-btn"
                  :class="{ active: favIds.includes(w.id) }"
                  :title="favIds.includes(w.id) ? '已在常用表單（點擊取消）' : '加入常用表單'"
                  @click.stop="toggleFav(w)"
                >
                  {{ favIds.includes(w.id) ? '★' : '☆' }}
                </button>
              </div>
            </div>
            <div class="catalog-card-body">
              <h4 class="catalog-card-title">{{ w.name }}</h4>
              <p class="catalog-card-desc">
                {{ w.description || (fieldCount(w) ? `包含 ${fieldCount(w)} 個欄位` : '點擊立即發起申請') }}
              </p>
            </div>
            <div class="catalog-card-footer">
              <span class="catalog-card-steps" :title="stepsText(w)">{{ stepsText(w) }}</span>
              <span class="catalog-card-btn">填寫申請 →</span>
            </div>
          </div>
          <div v-if="!filteredWorkflows.length" class="catalog-empty">
            <div class="catalog-empty-icon">🔍</div>
            <div class="catalog-empty-title">查無符合的申請表單</div>
            <p>請嘗試其他關鍵字，或切換上方分類頁籤查看。</p>
          </div>
        </div>
      </div>

      <!-- 填寫表單 -->
      <div v-show="view === 'form'" class="card" id="req-form-card">
        <div class="wf-nav-banner">
          <button type="button" class="btn outline sm" @click="backToCatalog">← 重新選擇表單</button>
          <div class="wf-nav-current">
            <span class="muted">目前表單：</span>
            <span class="field-type-tag" :class="getCategoryClass(selected?.category)">{{
              selected ? normalizeWorkflowCategory(selected) : '一般簽呈'
            }}</span>
            <strong>{{ selected?.name || '請選擇流程' }}</strong>
          </div>
        </div>

        <form class="form-grid" @submit.prevent="submitRequest(false)">
          <div
            v-if="cloneBanner"
            style="grid-column:1/-1;margin-bottom:12px;padding:12px 14px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;display:flex;align-items:center;gap:10px;font-size:0.92rem;color:#1e40af"
          >
            <span>📑</span>
            <div v-html="cloneBanner"></div>
          </div>

          <div class="field">
            <label>簽核流程 *</label>
            <select v-model="workflowId" required @change="onWorkflowSelectChange">
              <option value="">請選擇流程…</option>
              <optgroup v-for="cat in categories" :key="cat" :label="cat">
                <option v-for="w in workflows.filter((x) => normalizeWorkflowCategory(x) === cat)" :key="w.id" :value="String(w.id)">
                  {{ w.name }}
                </option>
              </optgroup>
            </select>
          </div>

          <div id="wf-preview" class="muted">
            <template v-if="selected">
              <div v-if="isVoidWorkflow(selected)">
                {{ selected.description || '請先選擇欲作廢的已核准申請單，簽核人將依原單帶入。' }}
              </div>
              <template v-else>
                <div style="margin-bottom:8px">
                  簽核層級：{{
                    proxyPickedName
                      ? `代理人送出（代 ${proxyPickedName}）→ 下列步驟依序簽核`
                      : '申請人送出 → 下列步驟依序簽核'
                  }}
                </div>
                <div v-if="skipExecTeamPath" style="margin:0 0 8px;color:#9a3412">
                  申請人為經營團隊：略過部門主管、副總經理，經代理人、人事單位後送總經理。
                </div>
                <div class="new-req-steps">
                  <span class="new-req-step">{{ proxyPickedName ? `申請人（代 ${proxyPickedName}）` : '申請人' }}</span>
                  <template v-for="(s, i) in previewSteps" :key="i">
                    <span class="new-req-step-arrow">→</span>
                    <span class="new-req-step">{{ s.name }}</span>
                  </template>
                </div>
                <div style="margin-top:6px">
                  {{
                    isLeaveWorkflow(selected)
                      ? leavePathDescription(previewSteps, proxyPickedName)
                      : selected.description || ''
                  }}
                </div>
              </template>
            </template>
          </div>

          <div v-if="leaveMode" class="field">
            <label>申請人（代申請請假）</label>
            <select v-model="proxyFor">
              <option value="">本人申請</option>
              <option v-for="p in leavePrincipals" :key="p.id" :value="String(p.id)">
                {{ p.name }}{{ p.department ? `（${p.department}）` : '' }}
              </option>
            </select>
            <p class="muted" style="font-size:0.8rem;margin:4px 0 0">
              預設為本人申請。可改選任何同仁代其申請請假：申請人＝被代申請人，簽核流程依其身分解析；您為實際送出人。
              表單「代理人」為<strong>職務代理人</strong>（可填本人或其他同仁），於請假起迄期間可代申請人簽核其他待辦。
            </p>
          </div>

          <div v-if="needTitle" class="field">
            <label>{{ isExpenseWorkflow(selected) ? '主旨 *（費用報支）' : '主旨 *（一般簽呈）' }}</label>
            <input
              v-model="title"
              maxlength="200"
              :placeholder="isExpenseWorkflow(selected) ? '請填寫報支主旨' : '請填寫簽呈主旨'"
            />
            <p class="muted" style="font-size:0.8rem;margin:4px 0 0">一般簽呈、費用報支需填主旨；其餘流程由系統依表單自動產生。</p>
          </div>

          <div v-if="selected" id="custom-form-area">
            <div class="form-section-title">
              <strong>流程表單</strong><span class="muted">依所選流程自動顯示</span>
            </div>
            <PdfFillViewer
              v-if="pdfTemplate"
              :template-file="pdfTemplate.templateFile"
              :fields="pdfTemplate.fields || []"
              :form-data="formData"
              @change="onPdfFieldChange"
            />
            <div class="custom-form-block" :class="{ 'form-fields-ot': otMode }">
              <FormFields
                v-model="formData"
                :fields="displayFields"
                :steps="previewSteps"
                :enable-rich="enableRich"
                :compact="otMode"
              />
            </div>
            <div v-if="leaveMode" id="leave-days-hint" class="muted" style="font-size:0.82rem;margin-top:8px;line-height:1.4">
              <div v-if="leaveBreakdown" class="leave-breakdown-card">
                <div class="leave-breakdown-title">
                  <span>
                    🗓️ 請假試算：<strong>{{ leaveBreakdown.days }} 天</strong>
                    <template v-if="!leaveBreakdown.special">
                      （共 <strong>{{ leaveBreakdown.hours }} 小時</strong>）
                    </template>
                  </span>
                  <span class="muted" style="font-size:0.8rem;font-weight:normal;margin-left:auto">【{{ leaveBreakdown.ruleText }}】</span>
                </div>
                <div class="leave-breakdown-tags">
                  <span class="leave-breakdown-tag lunch">☕ 自動扣除午休 12:30~13:30</span>
                  <span v-if="!leaveBreakdown.special" class="leave-breakdown-tag">⏱️ 實際請假 {{ leaveBreakdown.hours }} 小時</span>
                  <span v-if="leaveBreakdown.weekends" class="leave-breakdown-tag holiday">🏖️ 排除例假日 {{ leaveBreakdown.weekends }} 天</span>
                  <span v-if="leaveBreakdown.holidays" class="leave-breakdown-tag holiday">🎌 排除國定假日 {{ leaveBreakdown.holidays }} 天</span>
                </div>
              </div>
              <template v-else>{{ leaveHintText }}</template>
            </div>
            <div v-if="otMode && otHint" class="muted" style="font-size:0.82rem;margin-top:8px">{{ otHint }}</div>
          </div>

          <div class="field" id="attach-area">
            <label>附件（選填，可多檔上傳或附加已核准申請單）</label>
            <div v-if="attachCount" style="margin:0 0 10px;padding:10px 12px;background:#f8fafc;border:1px solid var(--border);border-radius:10px">
              <div style="font-size:0.92rem;margin-bottom:6px">
                <strong>附件清單</strong>
                <span class="muted" style="font-weight:400">（{{ attachCount }} 個，送出前可移除）</span>
              </div>
              <div v-if="draftAttachments.length" style="font-size:0.9rem;margin:0 0 4px;color:#166534">
                <strong>已保存在草稿</strong>
              </div>
              <ul v-if="draftAttachments.length" style="margin:0 0 8px;padding-left:18px">
                <li
                  v-for="a in draftAttachments"
                  :key="a.id"
                  style="margin:5px 0;display:flex;flex-wrap:wrap;align-items:center;gap:8px"
                >
                  <button type="button" class="linkish" @click="openSavedAtt(a)">{{ a.original_name || `附件#${a.id}` }}</button>
                  <button
                    v-if="isPreviewableName(a.original_name, a.mime_type)"
                    type="button"
                    class="btn sm outline"
                    @click="openSavedAtt(a)"
                  >
                    線上檢視
                  </button>
                  <span class="muted" style="font-size:0.82rem">{{ a.size_bytes ? fmtAttSize(a.size_bytes) : '' }}</span>
                  <button type="button" class="btn sm outline" @click="removeSavedAtt(a)">移除</button>
                </li>
              </ul>
              <div v-if="pendingFiles.length" style="font-size:0.9rem;margin:0 0 4px;color:#1d4ed8">
                <strong>已選、尚未送出</strong>
              </div>
              <ul v-if="pendingFiles.length" style="margin:0 0 8px;padding-left:18px">
                <li
                  v-for="(f, i) in pendingFiles"
                  :key="f.name + f.size + i"
                  style="margin:5px 0;display:flex;flex-wrap:wrap;align-items:center;gap:8px"
                >
                  <span>{{ f.name }}</span>
                  <span class="muted" style="font-size:0.82rem">{{ fmtAttSize(f.size) }}</span>
                  <button
                    v-if="isPreviewableName(f.name, f.type)"
                    type="button"
                    class="btn sm outline"
                    @click="previewLocal(f)"
                  >
                    預覽
                  </button>
                  <button type="button" class="btn sm outline" @click="pendingFiles.splice(i, 1)">移除</button>
                </li>
              </ul>
              <div v-if="linkedRequests.length" style="font-size:0.9rem;margin:0 0 4px;color:#047857">
                <strong>已選已核准申請單</strong>
              </div>
              <ul v-if="linkedRequests.length" style="margin:0;padding-left:18px">
                <li
                  v-for="(r, i) in linkedRequests"
                  :key="r.id"
                  style="margin:5px 0;display:flex;flex-wrap:wrap;align-items:center;gap:8px"
                >
                  <span>{{ formatApprovedRequestLabel(r) }}</span>
                  <button type="button" class="btn sm outline" @click="previewLinked(r)">預覽</button>
                  <button type="button" class="btn sm outline" @click="linkedRequests.splice(i, 1)">移除</button>
                </li>
              </ul>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">
              <input
                type="file"
                multiple
                accept=".pdf,.png,.jpg,.jpeg,.gif,.doc,.docx,.xls,.xlsx,.txt,image/*"
                @change="onPickFiles"
              />
              <button type="button" class="btn outline sm" @click="showPicker = true">附加已核准申請單</button>
            </div>
            <div class="muted" style="font-size:0.82rem;margin-top:4px">
              可一次選取多個檔案（Ctrl／Shift 多選），或從已簽核完成的申請單帶入 PDF。最多 20 個、每個檔案上限 10MB。送出前可預覽、移除。
            </div>
          </div>

          <div class="field" id="notify-prefs-box">
            <label style="white-space:nowrap">
              Email 提醒通知
              <span v-if="auth.user?.email" class="muted" style="font-weight:400">（{{ auth.user.email }}）</span>
              <span v-else style="color:#b45309;font-weight:400">（尚未設定 Email）</span>
            </label>
            <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px" :style="{ opacity: notifyOn ? 1 : 0.5 }">
              <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;margin:0;white-space:nowrap">
                <input v-model="notifyOn" type="checkbox" @change="onNotifyMaster" />
                開啟通知
              </label>
              <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;margin:0;white-space:nowrap">
                <input v-model="notifyAll" type="checkbox" :disabled="!notifyOn" @change="onNotifyAll" />
                全部（核准／駁回／下一步）
              </label>
              <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;margin:0;white-space:nowrap">
                <input v-model="notifyApproved" type="checkbox" :disabled="!notifyOn" />
                核准
              </label>
              <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;margin:0;white-space:nowrap">
                <input v-model="notifyRejected" type="checkbox" :disabled="!notifyOn" />
                駁回
              </label>
              <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;margin:0;white-space:nowrap">
                <input v-model="notifyStep" type="checkbox" :disabled="!notifyOn" />
                下一步
              </label>
            </div>
          </div>

          <div class="form-actions" style="flex-wrap:wrap;gap:8px">
            <button type="button" class="btn outline" :disabled="busy" @click="submitRequest(true)">儲存草稿</button>
            <button
              v-if="editingDraftId"
              type="button"
              class="btn outline"
              :disabled="busy"
              title="線上檢視此草稿產生的 PDF 表單"
              @click="viewDraftPdf"
            >
              📄 PDF 檢視
            </button>
            <button type="submit" class="btn primary" :disabled="busy">
              {{ busy ? '處理中…' : '送出申請' }}
            </button>
            <span class="muted" style="font-size:0.85rem;align-self:center">{{ draftHint }}</span>
          </div>
        </form>
      </div>
    </template>

    <ApprovedRequestPicker
      :visible="showPicker"
      :exclude-ids="editingDraftId ? [editingDraftId] : []"
      :already-selected="alreadyLinkedIds"
      @close="showPicker = false"
      @confirm="onPickedApproved"
    />
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { createRequest, deleteAttachment, fetchLeavePrincipals, fetchRequest, fetchRequestPdf, updateRequest } from '@/api/requests';
import FormFields from '@/components/form/FormFields.vue';
import PdfFillViewer from '@/components/form/PdfFillViewer.vue';
import ApprovedRequestPicker from '@/components/requests/ApprovedRequestPicker.vue';
import { openAttachmentBlob, openAttachmentViewer } from '@/composables/useApprovalActions';
import { collectFormPayload, initFormData, validateFormData } from '@/composables/useFormModel';
import {
  calcOvertimeHours,
  isSpecialLeaveType,
  leaveUnitHintText,
  snapHalfUnit,
} from '@/lib/form';
import { getFavWorkflowIds, saveFavWorkflowIds } from '@/lib/favorites';
import { getCategoryClass, getWorkflowIcon } from '@/lib/format';
import {
  cleanLoadedTitle,
  composeSubmitTitle,
  displayFormFields,
  fmtAttSize,
  formatApprovedRequestLabel,
  isExpenseWorkflow,
  isItRepairWorkflow,
  isLeaveWorkflow,
  isOtWorkflow,
  isPdfTemplateMode,
  isPreviewableName,
  isVoidWorkflow,
  leavePathDescription,
  leaveStepsForApplicant,
  normalizeWorkflowCategory,
  recalcLeaveFields,
  showTitleField,
  sortedWorkflowCategories,
  workflowPdfLayout,
} from '@/lib/new-request';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import { useUsersStore } from '@/stores/users';
import { useWorkflowsStore, workflowFormFields, workflowSteps } from '@/stores/workflows';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const toast = useToastStore();
const usersStore = useUsersStore();
const wfStore = useWorkflowsStore();

const loading = ref(true);
const view = ref('catalog');
const catalogSearch = ref('');
const catalogCat = ref('全部');
const favIds = ref([]);
const workflowId = ref('');
const formData = ref({});
const title = ref('');
const proxyFor = ref('');
const leavePrincipals = ref([]);
const pendingFiles = ref([]);
const linkedRequests = ref([]);
const draftAttachments = ref([]);
const editingDraftId = ref(0);
const isReturned = ref(false);
const cloneBanner = ref('');
const draftHint = ref('');
const busy = ref(false);
const showPicker = ref(false);
const leaveBreakdown = ref(null);
const otHint = ref('');

const notifyOn = ref(true);
const notifyApproved = ref(true);
const notifyRejected = ref(false);
const notifyStep = ref(false);

const workflows = computed(() => wfStore.active);
const categories = computed(() => sortedWorkflowCategories(workflows.value));
const selected = computed(() => wfStore.byId(workflowId.value));
const leaveMode = computed(() => isLeaveWorkflow(selected.value));
const otMode = computed(() => isOtWorkflow(selected.value));
const needTitle = computed(() => showTitleField(selected.value));
const enableRich = computed(() => {
  const w = selected.value;
  if (!w) return true;
  return !(isLeaveWorkflow(w) || isItRepairWorkflow(w) || isVoidWorkflow(w));
});
const displayFields = computed(() => (selected.value ? displayFormFields(selected.value) : []));
const applicantUser = computed(() => {
  if (leaveMode.value && proxyFor.value) return usersStore.byId(proxyFor.value) || null;
  return auth.user;
});
const previewSteps = computed(() => (selected.value ? leaveStepsForApplicant(selected.value, applicantUser.value) : []));
const skipExecTeamPath = computed(
  () => leaveMode.value && applicantUser.value && /經營團隊/.test(
    [applicantUser.value.department, ...(applicantUser.value.departments || [])].filter(Boolean).join(' ')
  )
);
const proxyPickedName = computed(() => {
  if (!leaveMode.value || !proxyFor.value) return '';
  const p = leavePrincipals.value.find((x) => Number(x.id) === Number(proxyFor.value));
  return p ? String(p.name || '').trim() : '';
});
const pdfTemplate = computed(() => {
  const w = selected.value;
  if (!isPdfTemplateMode(w)) return null;
  const pl = workflowPdfLayout(w);
  return { templateFile: pl.templateFile, fields: pl.fields || [] };
});
const attachCount = computed(
  () => draftAttachments.value.length + pendingFiles.value.length + linkedRequests.value.length
);
const alreadyLinkedIds = computed(() => [
  ...linkedRequests.value.map((x) => x.id),
  ...draftAttachments.value.map((a) => a.source_request_id).filter((n) => Number(n) > 0),
]);
const leaveHintText = computed(() => leaveUnitHintText(formData.value.leave_type || ''));
const notifyAll = computed({
  get: () => notifyApproved.value && notifyRejected.value && notifyStep.value,
  set: (v) => {
    notifyApproved.value = v;
    notifyRejected.value = v;
    notifyStep.value = v;
  },
});

const filteredWorkflows = computed(() => {
  const q = catalogSearch.value.trim().toLowerCase();
  return workflows.value.filter((w) => {
    const cat = normalizeWorkflowCategory(w);
    if (catalogCat.value !== '全部' && cat !== catalogCat.value) return false;
    if (!q) return true;
    const hay = `${w.name} ${cat} ${w.description || ''} ${(workflowFormFields(w) || []).map((f) => f.label).join(' ')}`.toLowerCase();
    return hay.includes(q);
  });
});

function countByCat(cat) {
  return workflows.value.filter((w) => normalizeWorkflowCategory(w) === cat).length;
}
function fieldCount(w) {
  return (workflowFormFields(w) || []).length;
}
function stepsText(w) {
  const steps = (workflowSteps(w) || []).map((s) => s.name).filter(Boolean);
  return steps.length ? `申請人 → ${steps.join(' → ')}` : w.description || '點擊填寫';
}

function resetForm(defaults = {}) {
  const w = selected.value;
  const fields = w ? displayFormFields(w) : [];
  const steps = w ? leaveStepsForApplicant(w, applicantUser.value) : [];
  formData.value = initFormData(fields, steps, defaults);
}

function selectWorkflow(id, defaults = {}) {
  workflowId.value = String(id || '');
  view.value = 'form';
  if (!leaveMode.value) proxyFor.value = '';
  resetForm(defaults);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function onWorkflowSelectChange() {
  if (!workflowId.value) return;
  resetForm();
  if (!needTitle.value) title.value = '';
}

function backToCatalog() {
  view.value = 'catalog';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function toggleFav(w) {
  let cur = [...favIds.value];
  const exists = cur.includes(w.id);
  if (exists) {
    cur = cur.filter((id) => id !== w.id);
    toast.info(`已從常用表單移除「${w.name}」`);
  } else {
    cur.push(w.id);
    toast.success(`已將「${w.name}」加入常用表單`);
  }
  favIds.value = cur;
  saveFavWorkflowIds(auth.user?.id, cur);
}

function onNotifyMaster() {
  if (notifyOn.value && !notifyApproved.value && !notifyRejected.value && !notifyStep.value) {
    notifyApproved.value = true;
  }
}
function onNotifyAll() {
  if (notifyAll.value && !notifyOn.value) notifyOn.value = true;
}

watch([notifyApproved, notifyRejected, notifyStep], () => {
  if ((notifyApproved.value || notifyRejected.value || notifyStep.value) && !notifyOn.value) {
    notifyOn.value = true;
  }
});

function onPdfFieldChange(fieldId, val) {
  formData.value[fieldId] = val;
}

function onPickFiles(ev) {
  const picked = ev.target?.files ? [...ev.target.files] : [];
  if (!picked.length) return;
  const next = [...pendingFiles.value];
  for (const f of picked) {
    if (f.size > 10 * 1024 * 1024) {
      toast.error(`「${f.name}」超過 10MB，已略過`);
      continue;
    }
    const dup = next.some((x) => x.name === f.name && x.size === f.size && x.lastModified === f.lastModified);
    if (!dup) next.push(f);
  }
  if (draftAttachments.value.length + linkedRequests.value.length + next.length > 20) {
    toast.error('附件最多 20 個（含草稿已存檔）');
    ev.target.value = '';
    return;
  }
  pendingFiles.value = next;
  ev.target.value = '';
}

function onPickedApproved(picked) {
  if (!picked?.length) return;
  const have = new Set(alreadyLinkedIds.value.map(Number));
  const next = [...linkedRequests.value];
  for (const r of picked) {
    if (have.has(Number(r.id))) continue;
    next.push(r);
  }
  if (draftAttachments.value.length + pendingFiles.value.length + next.length > 20) {
    toast.error('附件最多 20 個（含草稿已存檔）');
    return;
  }
  linkedRequests.value = next;
  toast.success(`已加入 ${picked.length} 張已核准申請單`);
}

function openSavedAtt(a) {
  if (!openAttachmentViewer(a.id, a.original_name || '')) {
    window.open(`/api/attachments/${a.id}`, '_blank', 'noopener');
  }
}

async function removeSavedAtt(a) {
  if (!confirm('確定移除此附件？')) return;
  try {
    await deleteAttachment(a.id);
    draftAttachments.value = draftAttachments.value.filter((x) => Number(x.id) !== Number(a.id));
    toast.success('已移除附件');
  } catch (e) {
    toast.error(e.message || '移除失敗');
  }
}

function previewLocal(file) {
  openAttachmentBlob(file, file.name);
}

async function previewLinked(r) {
  try {
    const blob = await fetchRequestPdf(r.id, { preview: true });
    openAttachmentBlob(blob, formatApprovedRequestLabel(r));
  } catch (e) {
    toast.error(e.message || '預覽失敗');
  }
}

watch(
  () => [leaveMode.value, formData.value.start_date, formData.value.end_date, formData.value.leave_type],
  () => {
    if (!leaveMode.value) {
      leaveBreakdown.value = null;
      return;
    }
    const start = formData.value.start_date;
    const end = formData.value.end_date;
    if (!start || !end) {
      leaveBreakdown.value = null;
      return;
    }
    const { aligned, raw } = recalcLeaveFields(formData.value);
    formData.value.days = aligned.days ? String(aligned.days) : '0';
    if (aligned.rule?.id === 'special' || isSpecialLeaveType(formData.value.leave_type)) {
      formData.value.hours = '';
    } else {
      formData.value.hours = aligned.hours ? String(aligned.hours) : '0';
    }
    leaveBreakdown.value = {
      days: aligned.days,
      hours: aligned.hours,
      special: aligned.rule?.id === 'special',
      ruleText:
        aligned.rule?.id === 'special'
          ? '特休假以「日」為單位'
          : aligned.rule?.noConvert || aligned.rule?.id === 'personal'
            ? '事假不強制換算'
            : leaveUnitHintText(formData.value.leave_type),
      weekends: raw?.skippedWeekends?.length || 0,
      holidays: raw?.skippedHolidays?.length || 0,
    };
  }
);

watch(
  () => [otMode.value, formData.value.ot_start, formData.value.ot_end],
  () => {
    if (!otMode.value) {
      otHint.value = '';
      return;
    }
    const a = formData.value.ot_start;
    const b = formData.value.ot_end;
    if (!a || !b) {
      formData.value.hours = '';
      otHint.value = '申請時數依延長工時開始／結束自動換算（00:00～24:00 全日，最小 0.5 小時）';
      return;
    }
    const h = calcOvertimeHours(a, b);
    if (h == null) {
      formData.value.hours = '';
      otHint.value = '結束時間須晚於開始時間，才能換算時數';
      return;
    }
    formData.value.hours = String(snapHalfUnit(h));
    const st = String(a).slice(11, 16);
    const et = String(b).slice(11, 16);
    const sameDay = String(a).slice(0, 10) === String(b).slice(0, 10);
    otHint.value = sameDay
      ? `自動換算：${st}～${et}＝${h} 小時（最小單位 0.5）`
      : `自動換算：${String(a).slice(0, 16).replace('T', ' ')}～${String(b).slice(0, 16).replace('T', ' ')}＝${h} 小時`;
  }
);

function buildBody({ asDraft }) {
  const w = selected.value;
  if (!w) throw new Error('請選擇簽核流程');
  if (proxyFor.value && !isLeaveWorkflow(w)) throw new Error('代申請僅支援請假流程');
  if (attachCount.value > 20) throw new Error('附件最多 20 個');

  const fields = displayFields.value;
  const steps = previewSteps.value;
  if (!asDraft) {
    const err = validateFormData(fields, steps, formData.value);
    if (err) throw new Error(err);
  }

  const payload = collectFormPayload(formData.value, fields);
  let finalTitle = composeSubmitTitle(w, title.value, payload, {
    asDraft,
    proxyName: proxyPickedName.value,
  });
  if (!asDraft && !String(finalTitle || '').trim()) {
    throw new Error(needTitle.value ? '請填寫主旨' : '無法產生主旨，請檢查表單');
  }

  const anyEvent = notifyApproved.value || notifyRejected.value || notifyStep.value;
  const enabled = notifyOn.value && anyEvent;
  const body = new FormData();
  body.append('workflow_id', String(w.id));
  body.append('title', finalTitle || `草稿 · ${w.name || '申請'}`);
  body.append('content', '');
  body.append('form_data', JSON.stringify(payload));
  body.append('notify_email', enabled ? '1' : '0');
  body.append(
    'notify_prefs',
    JSON.stringify({
      enabled,
      approved: notifyOn.value && notifyApproved.value,
      rejected: notifyOn.value && notifyRejected.value,
      step: notifyOn.value && notifyStep.value,
      submitted: enabled,
      cancelled: enabled,
    })
  );
  if (asDraft) body.append('as_draft', '1');
  else if (editingDraftId.value) {
    body.append('submit', '1');
    body.append('as_draft', '0');
  }
  if (proxyFor.value && isLeaveWorkflow(w)) {
    body.append('proxy_for', String(proxyFor.value));
    body.append('on_behalf_of_user_id', String(proxyFor.value));
  }
  pendingFiles.value.forEach((f) => body.append('attachments', f));
  if (linkedRequests.value.length) {
    body.append('linked_request_ids', JSON.stringify(linkedRequests.value.map((x) => x.id)));
  }
  return body;
}

async function submitRequest(asDraft, opts = {}) {
  busy.value = true;
  try {
    const body = buildBody({ asDraft });
    let data;
    if (editingDraftId.value) {
      data = await updateRequest(editingDraftId.value, body);
    } else {
      data = await createRequest(body);
      if (asDraft && data.request?.id) editingDraftId.value = data.request.id;
    }
    if (asDraft) {
      if (data.request?.id) editingDraftId.value = data.request.id;
      draftHint.value = `草稿 #${editingDraftId.value} 已儲存`;
      if (!opts.silentToast) {
        toast.success(data.message || '草稿已儲存');
      }
      pendingFiles.value = [];
      linkedRequests.value = [];
      const req = data.request || data;
      if (Array.isArray(req?.attachments)) draftAttachments.value = req.attachments;
      else if (editingDraftId.value) {
        try {
          const fresh = await fetchRequest(editingDraftId.value);
          draftAttachments.value = fresh.request?.attachments || fresh.attachments || [];
        } catch {
          /* keep */
        }
      }
      router.replace({ path: '/new-request', query: { draftId: String(editingDraftId.value) } }).catch(() => {});
      return data;
    } else {
      toast.success(data.message || '申請已送出');
      const id = data.request?.id;
      if (id) router.push(`/detail/${id}`);
      else router.push('/mine');
      return data;
    }
  } catch (e) {
    toast.error(e.message || (asDraft ? '儲存草稿失敗' : '送出申請失敗'));
    return null;
  } finally {
    busy.value = false;
  }
}

async function viewDraftPdf() {
  if (busy.value) return;
  try {
    const res = await submitRequest(true, { silentToast: true });
    if (!res || !editingDraftId.value) return;

    busy.value = true;
    toast.info('正在產生草稿 PDF 預覽…');
    const blob = await fetchRequestPdf(editingDraftId.value, { preview: true });
    const name = `${title.value || selected.value?.name || '申請單'}_草稿#${editingDraftId.value}.pdf`;
    openAttachmentBlob(blob, name);
  } catch (e) {
    toast.error(e.message || '草稿 PDF 載入失敗');
  } finally {
    busy.value = false;
  }
}

function applyNotifyPrefs(req) {
  const prefs = req?.notify_prefs;
  if (prefs && typeof prefs === 'object') {
    notifyOn.value = prefs.enabled !== false && req.notify_email !== 0;
    notifyApproved.value = prefs.approved !== false;
    notifyRejected.value = !!prefs.rejected;
    notifyStep.value = !!prefs.step;
    return;
  }
  notifyOn.value = req?.notify_email !== 0 && auth.user?.email_notify !== 0;
}

async function loadDraft(id) {
  const data = await fetchRequest(id);
  const req = data.request || data;
  if (!req || (req.status !== 'draft' && req.status !== 'returned')) {
    toast.error('此單據非草稿或退回狀態，無法在此編輯');
    return;
  }
  const uid = Number(auth.user?.id);
  const canEdit =
    Number(req.requester_id) === uid || Number(req.submitted_by) === uid || auth.isAdmin;
  if (!canEdit) {
    toast.error('無權編輯此草稿');
    return;
  }
  editingDraftId.value = Number(req.id);
  isReturned.value = req.status === 'returned';
  if (req.submitted_by && Number(req.submitted_by) === uid && Number(req.requester_id) !== uid) {
    proxyFor.value = String(req.requester_id);
  }
  const defaults = req.form_data && typeof req.form_data === 'object' ? { ...req.form_data } : {};
  selectWorkflow(req.workflow_id, defaults);
  title.value = cleanLoadedTitle(req.title, { isClone: false });
  applyNotifyPrefs(req);
  draftAttachments.value = Array.isArray(req.attachments) ? req.attachments : [];
  const nAtt = draftAttachments.value.length;
  draftHint.value = isReturned.value
    ? `⚠️ 編輯退回修改單據 #${req.id}（修改後送出重新簽核）${nAtt ? ` · 附件 ${nAtt} 個` : ''}`
    : `編輯草稿 #${req.id}${nAtt ? ` · 附件 ${nAtt} 個` : ''}`;
  toast.success(
    isReturned.value
      ? '已載入退回修改單據，請修改後送出重新簽核'
      : nAtt
        ? `已載入草稿（含 ${nAtt} 個附件）`
        : '已載入草稿，可繼續填寫後送出或再存草稿'
  );
}

async function loadClone(id) {
  const data = await fetchRequest(id);
  const req = data.request || data;
  if (!req) {
    toast.error('找不到欲複製的單據');
    return;
  }
  editingDraftId.value = 0;
  const defaults = req.form_data && typeof req.form_data === 'object' ? { ...req.form_data } : {};
  selectWorkflow(req.workflow_id, defaults);
  title.value = cleanLoadedTitle(req.title, { isClone: true });
  draftAttachments.value = [];
  cloneBanner.value = `此申請單內容複製自<strong>「單號 #${req.id} ${escapeHtml(req.title || '')}」</strong>。請確認並修改各欄位資料（附件未複製，請重新上傳），確認無誤即可送出。`;
  draftHint.value = `📑 複製自單號 #${req.id}（${req.title || ''}），送出將建立新申請`;
  toast.info(`已複製單號 #${req.id} 內容，請確認並更新資料後送出`);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

onMounted(async () => {
  loading.value = true;
  notifyOn.value = auth.user?.email_notify !== 0;
  try {
    await Promise.all([wfStore.fetch(), usersStore.fetch()]);
    favIds.value = getFavWorkflowIds(auth.user?.id, workflows.value);
    try {
      const data = await fetchLeavePrincipals();
      leavePrincipals.value = Array.isArray(data.principals) ? data.principals : [];
    } catch {
      leavePrincipals.value = usersStore.active.filter((x) => Number(x.id) !== Number(auth.user?.id));
    }

    const q = route.query || {};
    const draftId = Number(q.draftId || q.id || 0) || 0;
    const cloneFrom = Number(q.cloneFrom || 0) || 0;
    const wfId = Number(q.workflowId || q.wfId || 0) || 0;
    if (cloneFrom) await loadClone(cloneFrom);
    else if (draftId) await loadDraft(draftId);
    else if (wfId && wfStore.byId(wfId)) selectWorkflow(wfId);
    else view.value = 'catalog';
  } catch (e) {
    toast.error(e.message || '載入失敗');
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.new-req-steps {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin: 4px 0 8px;
}
.new-req-step {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 999px;
  color: #1e40af;
  font-size: 0.85rem;
  font-weight: 600;
}
.new-req-step-arrow {
  color: #94a3b8;
  font-size: 0.85rem;
}
</style>
