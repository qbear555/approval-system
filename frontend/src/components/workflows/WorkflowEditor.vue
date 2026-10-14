<template>
  <div class="card wf-editor">
    <h3 style="margin-top:0">{{ workflow?.id ? '編輯流程' : '建立簽核流程' }}</h3>
    <form class="form-grid" @submit.prevent="save">
      <div class="field">
        <label>流程名稱 *</label>
        <input v-model="name" required placeholder="例如：請假申請、請購申請" />
        <p class="muted" style="font-size:0.8rem;margin:4px 0 0">若名稱為路徑格式，增刪步驟時會自動同步更新。</p>
      </div>
      <div class="field">
        <label>表單分類 *</label>
        <select v-model="categorySelect" style="width:100%">
          <option v-for="c in categoryOptions" :key="c" :value="c">{{ c }}</option>
          <option value="__custom__">➕ 自訂新分類...</option>
        </select>
        <div v-show="categorySelect === '__custom__'" style="margin-top:6px">
          <input v-model="categoryCustom" type="text" placeholder="請輸入新分類名稱，例如：倉儲物流、品保管理" style="width:100%" />
        </div>
        <p class="muted" style="font-size:0.8rem;margin:4px 0 0">供「新增申請」表單中心分類瀏覽；可直接選擇或自訂新分類。</p>
      </div>
      <div class="field">
        <label>說明（簽核路徑，隨步驟自動更新）</label>
        <input v-model="description" placeholder="申請人 → …" />
      </div>
      <div class="field">
        <label>啟用狀態</label>
        <label class="switch" style="margin-top:8px">
          <input v-model="active" type="checkbox" />
          <span class="switch-slider"></span>
          <span class="switch-text">{{ active ? '啟用' : '停用' }}</span>
        </label>
        <p class="muted" style="font-size:0.8rem;margin:6px 0 0">開啟＝可在「新增申請」中選擇；關閉＝停用（歷史單據仍可查）。</p>
      </div>

      <div class="field">
        <label>申請單 PDF 排版 *</label>
        <select v-model="pdfLayoutType" @change="onPdfLayoutTypeChange">
          <option v-for="o in PDF_LAYOUT_OPTIONS" :key="o.type" :value="o.type">{{ o.label }}</option>
        </select>
        <div v-show="pdfLayoutType === 'pdf_template'" style="margin-top:10px;padding:12px 14px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
            <div>
              <strong style="color:#1e3a5f;">📄 紙本底圖套印設定</strong>
              <div class="muted" style="margin-top:2px;">{{ templateStatus }}</div>
            </div>
            <button type="button" class="btn sm primary" @click="openPdfDesigner">🎨 開啟畫布設計器</button>
          </div>
        </div>
        <div v-show="pdfLayoutType === 'canvas_objects'" style="margin-top:10px;padding:12px 14px;background:#f0fdf4;border:1px solid #86efac;border-radius:8px;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
            <div>
              <strong style="color:#166534;">🧩 可編輯畫布版面</strong>
              <div class="muted" style="margin-top:2px;">{{ canvasStatus }}</div>
            </div>
            <button type="button" class="btn sm primary" @click="openCanvasDesigner">🎨 開啟畫布編輯</button>
          </div>
        </div>
        <div v-show="isBuiltinPdf" style="margin-top:10px;padding:12px 14px;background:#fff7ed;border:1px solid #fdba74;border-radius:8px;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
            <div>
              <strong style="color:#9a3412;">內建排版可轉成可編輯物件</strong>
              <div class="muted" style="margin-top:2px;">目前為固定程式排版。轉成畫布後，表格與文字可拖曳、改字、增刪列欄。</div>
            </div>
            <button type="button" class="btn sm" style="background:#ea580c;color:#fff;" @click="convertBuiltinToCanvas">轉成可編輯畫布</button>
          </div>
        </div>
        <p class="muted" style="font-size:0.8rem;margin:6px 0 0">與簽核流程一體：匯出／匯入時會一併帶出 PDF 排版，不影響系統設定、Email、使用者。</p>
      </div>

      <div class="field" style="grid-column:1/-1">
        <label>目前簽核路徑</label>
        <div style="padding:10px 12px;background:#f8fafc;border:1px solid var(--border);border-radius:8px;color:#1e3a5f;line-height:1.5">
          <div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px">
            <span class="field-type-tag">申請人</span>
            <template v-for="(s, i) in steps" :key="'path-' + i">
              <span class="muted">→</span>
              <span class="field-type-tag">{{ s.name || `步驟 ${i + 1}` }}</span>
            </template>
          </div>
          <div class="muted" style="margin-top:6px">{{ description || '申請人' }}</div>
        </div>
      </div>

      <div style="grid-column:1/-1;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;background:#f8fafc">
        <div class="form-section-title" style="margin:0 0 8px">
          <strong>最終核准完成通知（系統內）</strong>
          <span class="field-type-tag">流程模組</span>
        </div>
        <p class="muted" style="margin:0 0 12px;font-size:0.85rem;line-height:1.5" v-html="finalNotifyHint"></p>
        <label class="switch" style="margin-bottom:10px">
          <input v-model="fnEnabled" type="checkbox" @change="onFnEnabledChange" />
          <span class="switch-slider"></span>
          <span class="switch-text">{{ fnSwitchLabel }}</span>
        </label>
        <div v-show="fnEnabled">
          <div class="field" style="margin-bottom:10px">
            <label>{{ isLeave ? '被通知人員說明（顯示在待確認畫面）' : '通知說明（顯示在待確認畫面）' }}</label>
            <input v-model="fnLabel" type="text" :placeholder="isLeave ? '設定 Email 自動回覆' : '例如：人資歸檔、財務部建檔'" />
            <p v-if="isLeave" class="muted" style="font-size:0.8rem;margin:6px 0 0">
              請假預設說明：提醒被通知人員為請假同仁設定／確認 <strong>Email 自動回覆</strong>。
            </p>
          </div>
          <div class="field" style="margin-bottom:12px">
            <label>哪些申請人的單據需要此通知模組？</label>
            <div style="display:flex;flex-wrap:wrap;gap:16px;margin:6px 0 8px">
              <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
                <input v-model="fnApplicantMode" type="radio" value="all" />
                全部申請人
              </label>
              <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
                <input v-model="fnApplicantMode" type="radio" value="selected" />
                僅下列申請人（可多選）
              </label>
            </div>
            <div v-show="fnApplicantMode === 'selected'">
              <div class="wf-user-grid">
                <label v-for="u in activeUsers" :key="'app-' + u.id">
                  <input type="checkbox" :checked="fnApplicantIds.includes(Number(u.id))" @change="toggleId(fnApplicantIds, u.id, $event.target.checked)" />
                  <span>{{ u.name || u.username }}<span v-if="u.department" class="muted">（{{ u.department }}）</span></span>
                </label>
                <span v-if="!activeUsers.length" class="muted">尚無可選使用者</span>
              </div>
              <p class="muted" style="font-size:0.8rem;margin:6px 0 0">
                例：請假流程只勾「特定同仁」→ 僅這些人送的假單，最後核准後才通知下方「通知對象」。
              </p>
            </div>
          </div>
          <div class="field">
            <label>{{ isLeave ? '最終被通知人員（請設定 Email 自動回覆）' : '通知對象（收件人，可多選）' }}</label>
            <div class="wf-user-grid">
              <label v-for="u in activeUsers" :key="'fn-' + u.id">
                <input type="checkbox" :checked="fnUserIds.includes(Number(u.id))" @change="toggleId(fnUserIds, u.id, $event.target.checked)" />
                <span>{{ u.name || u.username }}<span v-if="u.department" class="muted">（{{ u.department }}）</span></span>
              </label>
              <span v-if="!activeUsers.length" class="muted">尚無可選使用者</span>
            </div>
            <p class="muted" style="font-size:0.8rem;margin:6px 0 0" v-html="fnRecipientsHint"></p>
          </div>
        </div>
      </div>

      <div style="grid-column:1/-1">
        <div class="form-section-title">
          <strong>自訂表單欄位</strong>
          <button type="button" class="btn sm outline" @click="addField">＋ 新增欄位</button>
        </div>
        <p class="muted" style="margin:0 0 8px;font-size:0.85rem">
          建立流程時可一併設計申請表單（文字、數字、日期、下拉、核取等）。
          可用<strong>上移／下移</strong>調整申請單顯示順序（儲存後生效）。
        </p>
        <div class="steps-builder">
          <div v-if="!formFields.length" class="muted" style="padding:8px 0">尚未新增表單欄位。一般簽呈需填主旨；其餘流程主旨由系統自動產生。</div>
          <div v-for="(f, i) in formFields" :key="f.id || i" class="step-card">
            <div class="step-head">
              <div style="display:flex;align-items:center;gap:10px">
                <span class="step-num">{{ i + 1 }}</span>
                <strong>表單欄位</strong>
                <span class="field-type-tag">{{ FIELD_TYPE_LABEL[f.type] || f.type }}</span>
              </div>
              <div style="display:flex;gap:6px;flex-wrap:wrap">
                <button type="button" class="btn sm outline" :disabled="i === 0" @click="moveItem(formFields, i, -1)">上移</button>
                <button type="button" class="btn sm outline" :disabled="i >= formFields.length - 1" @click="moveItem(formFields, i, 1)">下移</button>
                <button type="button" class="btn sm outline" @click="formFields.splice(i, 1)">移除</button>
              </div>
            </div>
            <div class="form-grid two">
              <div class="field">
                <label>欄位名稱 *</label>
                <input v-model="f.label" placeholder="例如：請假起日、金額" />
              </div>
              <div class="field">
                <label>欄位類型</label>
                <select v-model="f.type">
                  <option v-for="(lab, k) in FIELD_TYPE_LABEL" :key="k" :value="k">{{ lab }}</option>
                </select>
              </div>
              <div class="field">
                <label>提示文字</label>
                <input v-model="f.placeholder" placeholder="選填" />
              </div>
              <div class="field" style="display:flex;align-items:end;padding-bottom:8px">
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
                  <input v-model="f.required" type="checkbox" />
                  必填
                </label>
              </div>
            </div>
            <div v-show="f.type === 'select'" class="field" style="margin-top:8px">
              <label>下拉選項（每行一個，或用逗號分隔）</label>
              <textarea v-model="f.optionsText" rows="3" placeholder="事假&#10;病假&#10;特休"></textarea>
            </div>
          </div>
        </div>
      </div>

      <div style="grid-column:1/-1">
        <div class="form-section-title">
          <strong>簽核步驟（依序）</strong>
          <button type="button" class="btn sm outline" @click="addBlankStep">＋ 空白步驟</button>
        </div>
        <p class="muted" style="margin:0 0 8px;font-size:0.85rem">
          標準層級：<strong>申請人</strong> → 代理人 → 部門主管 → 人事單位 → <strong>副總經理</strong> → <strong>總經理</strong>。<br />
          下方可<strong>自行新增任何層級</strong>、調整順序、或改簽核人來源；人事單位對應管理部。
        </p>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">
          <button
            v-for="(p, i) in presets"
            :key="p.label + i"
            type="button"
            class="btn sm outline"
            @click="applyPreset(p)"
          >
            ＋ {{ p.label }}
          </button>
        </div>
        <div class="steps-builder">
          <div v-for="(s, i) in steps" :key="'step-' + i" class="step-card">
            <div class="step-head">
              <div style="display:flex;align-items:center;gap:10px">
                <span class="step-num">{{ i + 1 }}</span>
                <strong>簽核步驟</strong>
                <span class="field-type-tag">{{ ASSIGN_TYPE_LABEL[s.assignType] || s.assignType }}</span>
              </div>
              <div style="display:flex;gap:6px;flex-wrap:wrap">
                <button type="button" class="btn sm outline" :disabled="i === 0" @click="moveItem(steps, i, -1); syncFlowPath()">上移</button>
                <button type="button" class="btn sm outline" :disabled="i >= steps.length - 1" @click="moveItem(steps, i, 1); syncFlowPath()">下移</button>
                <button type="button" class="btn sm outline" :disabled="steps.length <= 1" @click="removeStep(i)">移除</button>
              </div>
            </div>
            <div class="form-grid two">
              <div class="field">
                <label>步驟名稱</label>
                <input v-model="s.name" placeholder="例如：代理人、部門主管、副總經理" @input="syncFlowPath" />
              </div>
              <div class="field">
                <label>核准模式</label>
                <select v-model="s.mode">
                  <option value="any">任一簽核人核准即可</option>
                  <option value="all">需全部簽核人核准</option>
                </select>
              </div>
              <div class="field">
                <label>簽核人來源 *</label>
                <select v-model="s.assignType">
                  <option v-for="(lab, k) in ASSIGN_TYPE_LABEL" :key="k" :value="k">{{ lab }}</option>
                </select>
              </div>
              <div v-show="s.assignType === 'form_user'" class="field">
                <label>對應表單人員欄位</label>
                <select v-model="s.formFieldId">
                  <option v-if="!userFields.length" value="agent">代理人（請先新增「人員選擇」欄位，id=agent）</option>
                  <option v-for="f in userFields" :key="f.id" :value="f.id">{{ f.label }}（{{ f.id }}）</option>
                </select>
              </div>
              <div v-show="s.assignType === 'department'" class="field">
                <label>簽核單位／部門</label>
                <select v-model="s.department">
                  <option value="">請選擇…</option>
                  <option v-for="d in deptNames" :key="d" :value="d">{{ d }}</option>
                </select>
              </div>
            </div>
            <div v-show="s.assignType === 'users' || s.assignType === 'users_pick'" class="field" style="margin-top:8px">
              <label>{{
                s.assignType === 'users_pick'
                  ? '可選簽核人名單 *（申請人送出時從中擇一或選全部）'
                  : '指定簽核人 *（勾選＝新增、取消勾選＝刪除）'
              }}</label>
              <div class="approver-list">
                <label v-for="u in users" :key="'ap-' + i + '-' + u.id">
                  <input
                    type="checkbox"
                    :checked="(s.approverIds || []).includes(u.id) || (s.approverIds || []).includes(Number(u.id))"
                    @change="toggleApprover(s, u.id, $event.target.checked)"
                  />
                  {{ u.name }}{{ u.department ? `（${u.department}）` : '' }}
                </label>
              </div>
              <p class="muted" style="font-size:0.8rem;margin:6px 0 0">
                {{
                  s.assignType === 'users_pick'
                    ? '申請人從名單勾選一位或多位；若下方勾選「非必填」則可不選（略過此步驟）。'
                    : '可隨時增刪指定人員；儲存流程後生效。新申請單會依最新設定解析簽核人。'
                }}
              </p>
            </div>
            <label
              v-if="s.assignType === 'users_pick'"
              style="display:flex;align-items:center;gap:8px;margin-top:10px;font-size:0.9rem"
            >
              <input v-model="s.skipIfNoApprover" type="checkbox" />
              <span>非必填（申請人可不選，略過「{{ s.name || '此步驟' }}」）</span>
            </label>
            <p v-if="s.assignType === 'dept_head'" class="muted" style="margin:8px 0 0;font-size:0.85rem">
              申請時由<strong>申請人自行選擇</strong>同部門（或任一）成員作為此步驟簽核人；
              亦可選擇<strong>不需要經過部門主管</strong>（略過此步驟）。
            </p>
            <p v-else-if="s.assignType === 'users_pick'" class="muted" style="margin:8px 0 0;font-size:0.85rem">
              <template v-if="s.skipIfNoApprover">申請人<strong>可不選</strong>（略過）；或勾選名單中的一位／多位。</template>
              <template v-else>申請人<strong>必選</strong>名單中的一位，或選<strong>全部</strong>。</template>
            </p>
            <p v-else-if="s.assignType === 'cosign_pick'" class="muted" style="margin:8px 0 0;font-size:0.85rem">
              申請時可<strong>勾選多位</strong>會簽人員（皆須核准）；可不選（略過會簽步驟）。
            </p>
          </div>
        </div>
      </div>

      <div class="form-actions" style="grid-column:1/-1">
        <button type="submit" class="btn primary" :disabled="saving">{{ saving ? '儲存中…' : '儲存' }}</button>
        <button type="button" class="btn outline" @click="$emit('cancel')">取消</button>
      </div>
    </form>
    <PdfDesignerModal
      v-if="designerOpen"
      :mode="designerMode"
      :workflow-name="name"
      :layout="pdfLayout"
      @close="designerOpen = false"
      @save="onDesignerSave"
    />
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useToastStore } from '@/stores/toast';
import { createWorkflow, updateWorkflow, fetchCanvasPreset } from '@/api/workflows';
import { loadCanvasLayouts } from '@/lib/canvas-designer';
import PdfDesignerModal from '@/components/workflows/PdfDesignerModal.vue';
import {
  ASSIGN_TYPE_LABEL,
  FIELD_TYPE_LABEL,
  PDF_LAYOUT_OPTIONS,
  BUILTIN_PDF_TYPES,
  newFormField,
  cloneSteps,
  cloneFormFields,
  clonePdfLayout,
  defaultFinalNotify,
  isLeaveWorkflowName,
  suggestCreditFinanceNotify,
  isFinanceLikeUser,
  collectWorkflowDeptNames,
  buildStepPresets,
  resolvePresetStep,
  buildFlowPathText,
  shouldAutoSyncName,
} from '@/lib/workflow-meta';

const props = defineProps({
  workflow: { type: Object, default: null },
  users: { type: Array, default: () => [] },
  departments: { type: Array, default: () => [] },
  knownCategories: { type: Array, default: () => [] },
  autoOpenDesigner: { type: Boolean, default: false },
});

const emit = defineEmits(['saved', 'cancel']);
const toast = useToastStore();

const users = computed(() => props.users || []);
const activeUsers = computed(() => users.value.filter((u) => u.active !== 0));

const name = ref(props.workflow?.name || '');
const description = ref(props.workflow?.description || '');
const active = ref(!props.workflow || !!props.workflow.active);
const categorySelect = ref(props.workflow?.category || '一般簽呈');
const categoryCustom = ref('');
const steps = reactive(cloneSteps(props.workflow));
const formFields = reactive(cloneFormFields(props.workflow));
const pdfLayout = ref(clonePdfLayout(props.workflow));
const pdfLayoutType = ref(pdfLayout.value.type || 'auto');
const saving = ref(false);
const designerOpen = ref(false);
const designerMode = ref('paper');

const isLeave = isLeaveWorkflowName(props.workflow?.name);
const suggestCredit = suggestCreditFinanceNotify(props.workflow);

const initFn = props.workflow?.finalNotify || defaultFinalNotify();
const fnEnabled = ref(!!initFn.enabled || suggestCredit);
const fnLabel = ref(
  initFn.label ||
    (suggestCredit ? '財務部（授信額度建檔）' : isLeave ? '設定 Email 自動回覆' : '最終核准完成通知')
);
const fnApplicantMode = ref(initFn.applicantMode === 'selected' ? 'selected' : 'all');
const fnApplicantIds = reactive((initFn.applicantUserIds || []).map(Number).filter(Boolean));
const fnUserIds = reactive((initFn.userIds || []).map(Number).filter(Boolean));

const categoryOptions = computed(() => {
  const set = new Set(props.knownCategories || []);
  if (props.workflow?.category) set.add(props.workflow.category);
  return [...set];
});

const deptNames = computed(() =>
  collectWorkflowDeptNames({
    departments: props.departments,
    users: users.value,
    extra: steps.map((s) => s.department),
  })
);

const presets = computed(() => buildStepPresets(deptNames.value));
const userFields = computed(() => formFields.filter((f) => f.type === 'user'));
const isBuiltinPdf = computed(() => BUILTIN_PDF_TYPES.includes(pdfLayoutType.value));

const templateStatus = computed(() => {
  const pl = pdfLayout.value || {};
  return pl.templateFile
    ? `已綁定底圖：${pl.templateMeta?.originalName || pl.templateFile}（${(pl.fields || []).length} 個套印欄位）`
    : '尚未上傳底圖或設計套印欄位';
});

const canvasStatus = computed(() => {
  const pl = pdfLayout.value || {};
  const n = (pl.objects || []).length;
  return n
    ? `已有 ${n} 個物件${pl.sourceType ? `（來源：${pl.sourceType}）` : ''}，可拖曳改字、改表格`
    : '尚未建立物件。可從內建排版轉入，或開啟畫布自行新增文字與表格。';
});

const fnSwitchLabel = computed(() => {
  if (!fnEnabled.value) return '不通知（關閉）';
  return isLeave ? '啟用（設定 Email 自動回覆通知）' : '啟用系統內最終通知';
});

const finalNotifyHint = computed(() =>
  isLeave
    ? '請假單<strong>最後一步核准</strong>後，以<strong>系統內通知</strong>提醒選定人員<strong>設定 Email 自動回覆</strong>，並請對方點「確認收到」。可再限定哪些申請人的假單才觸發。隨流程匯出／匯入。'
    : '當<strong>最後一步</strong>（例如總經理）核定通過時，在<strong>系統內</strong>通知選定人員，並請對方點<strong>「確認收到通知」</strong>（非 Email）。可指定只有特定申請人的單據才觸發。隨流程匯出／匯入。'
);

const fnRecipientsHint = computed(() =>
  isLeave
    ? '假單最終核准後，這些人員會在系統收到待確認，請其<strong>設定 Email 自動回覆</strong>後點「確認收到」。'
    : '收件人登入後會看到待確認；點「確認收到通知」後才從待辦移除。'
);

function toggleId(list, id, checked) {
  const n = Number(id);
  const idx = list.indexOf(n);
  if (checked && idx < 0) list.push(n);
  if (!checked && idx >= 0) list.splice(idx, 1);
}

function toggleApprover(step, id, checked) {
  if (!Array.isArray(step.approverIds)) step.approverIds = [];
  const n = Number(id);
  const idx = step.approverIds.findIndex((x) => Number(x) === n);
  if (checked && idx < 0) step.approverIds.push(n);
  if (!checked && idx >= 0) step.approverIds.splice(idx, 1);
}

function moveItem(arr, i, dir) {
  const j = i + dir;
  if (j < 0 || j >= arr.length) return;
  const tmp = arr[i];
  arr[i] = arr[j];
  arr[j] = tmp;
}

function removeStep(i) {
  if (steps.length <= 1) return;
  steps.splice(i, 1);
  syncFlowPath();
}

function addField() {
  formFields.push(newFormField());
}

function addBlankStep() {
  steps.push({
    name: `步驟 ${steps.length + 1}`,
    assignType: 'users',
    formFieldId: 'agent',
    department: '',
    approverIds: [],
    mode: 'any',
    skipIfNoApprover: false,
    approverFields: [],
  });
  syncFlowPath();
}

function applyPreset(p) {
  if (p.ensureAgentField && !formFields.some((f) => f.id === 'agent' || f.type === 'user')) {
    formFields.unshift({
      id: 'agent',
      label: '代理人',
      type: 'user',
      required: true,
      placeholder: '請選擇代理人',
      options: [],
      optionsText: '',
    });
  }
  steps.push(resolvePresetStep(p, users.value));
  syncFlowPath();
}

function syncFlowPath() {
  const path = buildFlowPathText(steps);
  description.value = path;
  if (shouldAutoSyncName(name.value)) name.value = path;
}

function parseOptions(text) {
  return String(text || '')
    .split(/[\n,]/)
    .map((o) => o.trim())
    .filter(Boolean);
}

function mergeConvertedFormFields(incoming) {
  if (!Array.isArray(incoming) || !incoming.length) return;
  incoming.forEach((cf) => {
    if (!cf || !cf.id) return;
    const exist = formFields.find((f) => f.id === cf.id);
    if (!exist) {
      formFields.push({
        id: cf.id,
        label: cf.label || cf.id,
        type: cf.type || 'text',
        required: !!cf.required,
        placeholder: cf.placeholder || '',
        options: cf.options || [],
        optionsText: Array.isArray(cf.options) ? cf.options.join('\n') : '',
      });
    } else {
      exist.label = cf.label || exist.label;
      exist.type = cf.type || exist.type;
      exist.required = !!cf.required;
      if (cf.options) {
        exist.options = cf.options;
        exist.optionsText = cf.options.join('\n');
      }
    }
  });
}

function onFnEnabledChange() {
  if (fnEnabled.value && isLeave) {
    const cur = String(fnLabel.value || '').trim();
    if (!cur || /^(最終核准完成通知|請假核准完成通知)$/.test(cur)) {
      fnLabel.value = '設定 Email 自動回覆';
    }
  }
}

async function onPdfLayoutTypeChange() {
  const t = pdfLayoutType.value;
  const cur = pdfLayout.value || {};
  if (t === 'pdf_template' && cur.type !== 'pdf_template') {
    pdfLayout.value = { type: 'pdf_template', fields: [] };
    return;
  }
  if (t === 'canvas_objects' && cur.type !== 'canvas_objects') {
    const src = BUILTIN_PDF_TYPES.includes(cur.type) ? cur.type : 'general';
    try {
      const layouts = await loadCanvasLayouts();
      pdfLayout.value = layouts?.builtinToCanvasLayout
        ? layouts.builtinToCanvasLayout(src)
        : { type: 'canvas_objects', sourceType: src, objects: [] };
    } catch {
      pdfLayout.value = { type: 'canvas_objects', sourceType: src, objects: [] };
    }
    return;
  }
  if (t !== 'pdf_template' && t !== 'canvas_objects') {
    pdfLayout.value = { type: t };
  }
}

function openPdfDesigner() {
  designerMode.value = 'paper';
  designerOpen.value = true;
}

function openCanvasDesigner() {
  designerMode.value = 'objects';
  designerOpen.value = true;
}

function onDesignerSave(res) {
  pdfLayout.value = res.pdfLayout;
  pdfLayoutType.value = res.pdfLayout?.type || pdfLayoutType.value;
  mergeConvertedFormFields(res.formFields);
  designerOpen.value = false;
  toast.success(pdfLayoutType.value === 'canvas_objects' ? '可編輯畫布版面已更新' : '紙本底圖模版與欄位已更新');
}

async function convertBuiltinToCanvas() {
  const src = pdfLayoutType.value || 'general';
  const apply = (layout, fields) => {
    pdfLayout.value = layout;
    pdfLayoutType.value = 'canvas_objects';
    mergeConvertedFormFields(fields);
    toast.success('已轉成可編輯畫布，可再開啟畫布調整表格與文字');
    openCanvasDesigner();
  };
  try {
    const data = await fetchCanvasPreset(src);
    apply(data.pdfLayout, data.formFields);
  } catch (err) {
    try {
      const layouts = await loadCanvasLayouts();
      if (layouts?.builtinToCanvasLayout) {
        const layout = layouts.builtinToCanvasLayout(src);
        apply(layout, layouts.extractFormFields(layout));
        return;
      }
    } catch {
      /* fall through */
    }
    toast.error(err.message || '轉換失敗');
  }
}

function buildPayload() {
  for (const f of formFields) {
    f.options = f.type === 'select' ? parseOptions(f.optionsText) : f.options || [];
    if (!String(f.label || '').trim()) throw new Error('請填寫所有表單欄位名稱');
    if (f.type === 'select' && !(f.options && f.options.length)) {
      throw new Error(`「${f.label}」請至少設定一個下拉選項`);
    }
  }
  for (const s of steps) {
    if (!String(s.name || '').trim()) throw new Error('請填寫所有簽核步驟名稱');
    if ((s.assignType === 'users' || s.assignType === 'users_pick') && !(s.approverIds && s.approverIds.length)) {
      throw new Error(
        s.assignType === 'users_pick'
          ? `步驟「${s.name}」請勾選可選簽核人名單（申請人將從中選擇）`
          : `步驟「${s.name}」請指定簽核人`
      );
    }
    if (s.assignType === 'department' && !s.department) {
      throw new Error(`步驟「${s.name}」請選擇單位／部門`);
    }
    if (s.assignType === 'form_user') {
      let ff = formFields.find((f) => f.id === s.formFieldId);
      if (!ff) {
        const targetId = s.formFieldId || 'agent';
        const targetLabel = s.name || '指定人員';
        formFields.push({
          id: targetId,
          label: targetLabel,
          type: 'user',
          required: false,
          placeholder: `請選擇${targetLabel}`,
          options: [],
          optionsText: '',
        });
      } else if (ff.type !== 'user') {
        ff.type = 'user';
      }
    }
  }
  syncFlowPath();
  const pathDesc = buildFlowPathText(steps);
  const nameVal = String(name.value || '').trim() || pathDesc;

  let categoryVal = categorySelect.value === '__custom__' ? String(categoryCustom.value || '').trim() : String(categorySelect.value || '').trim();
  if (categorySelect.value === '__custom__' && !categoryVal) {
    throw new Error('請輸入自訂分類名稱');
  }
  if (!categoryVal) categoryVal = '一般簽呈';

  if (fnEnabled.value && !fnUserIds.length) {
    throw new Error('已啟用最終核准通知，請至少勾選一位「通知對象」');
  }
  if (fnEnabled.value && fnApplicantMode.value === 'selected' && !fnApplicantIds.length) {
    throw new Error('已選「僅下列申請人」，請至少勾選一位申請人');
  }

  const pl = pdfLayout.value || {};
  const t = pdfLayoutType.value || 'auto';
  return {
    name: nameVal,
    category: categoryVal,
    description: pathDesc,
    steps: steps.map((s) => ({
      name: s.name,
      mode: s.mode === 'all' ? 'all' : 'any',
      assignType: s.assignType || 'users',
      formFieldId: s.formFieldId || 'agent',
      department: s.department || '',
      approverIds: s.assignType === 'users' || s.assignType === 'users_pick' ? s.approverIds || [] : [],
      approverFields: Array.isArray(s.approverFields) ? s.approverFields : [],
      skipIfNoApprover: s.assignType === 'users_pick' ? !!s.skipIfNoApprover : false,
    })),
    formFields: formFields.map((f) => ({
      id: f.id,
      label: f.label,
      type: f.type,
      required: !!f.required,
      placeholder: f.placeholder || '',
      options: f.type === 'select' ? f.options || [] : undefined,
    })),
    pdfLayout:
      t === 'pdf_template'
        ? {
            type: 'pdf_template',
            templateFile: pl.templateFile || '',
            templateMeta: pl.templateMeta || null,
            fields: pl.fields || [],
            formMode: pl.formMode || 'paper',
          }
        : t === 'canvas_objects'
          ? {
              type: 'canvas_objects',
              sourceType: pl.sourceType || '',
              page: pl.page || {},
              objects: pl.objects || [],
              label: pl.label || '可編輯畫布版面',
            }
          : { type: String(t || 'auto') },
    finalNotify: {
      enabled: !!fnEnabled.value,
      userIds: [...fnUserIds],
      applicantMode: fnApplicantMode.value,
      applicantUserIds: fnApplicantMode.value === 'selected' ? [...fnApplicantIds] : [],
      label: String(fnLabel.value || '').trim() || (isLeave ? '設定 Email 自動回覆' : '最終核准完成通知'),
    },
    active: active.value ? 1 : 0,
  };
}

async function save() {
  saving.value = true;
  try {
    const payload = buildPayload();
    if (props.workflow?.id) {
      await updateWorkflow(props.workflow.id, payload);
    } else {
      await createWorkflow(payload);
    }
    toast.success('流程已儲存');
    emit('saved');
  } catch (err) {
    toast.error(err.message || '儲存失敗');
  } finally {
    saving.value = false;
  }
}

watch(
  () => steps.map((s) => s.name).join('\0'),
  () => syncFlowPath()
);

watch(
  activeUsers,
  (list) => {
    if (!suggestCredit || fnUserIds.length) return;
    list.filter(isFinanceLikeUser).forEach((u) => {
      const n = Number(u.id);
      if (!fnUserIds.includes(n)) fnUserIds.push(n);
    });
  },
  { immediate: true }
);

onMounted(() => {
  if (!description.value) syncFlowPath();
  if (props.autoOpenDesigner) {
    setTimeout(() => openPdfDesigner(), 150);
  }
});

defineExpose({ save });
</script>

<style scoped>
.wf-editor {
  padding: 20px 24px 28px;
}
.wf-user-grid {
  max-height: 180px;
  overflow: auto;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 8px;
  background: #fff;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 4px 12px;
}
.wf-user-grid label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.88rem;
  cursor: pointer;
}
</style>
