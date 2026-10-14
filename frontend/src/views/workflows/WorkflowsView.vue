<template>
  <div class="workflows-page">
    <Teleport v-if="actionsReady && canManage && !editing" to="#page-actions">
      <button type="button" class="btn success" style="font-weight:600" title="上傳紙本 PDF 或掃描圖檔，在線上畫布自訂拖拉欄位與簽章格" @click="openPaper">
        📄 匯入紙本文件建立流程
      </button>
      <button type="button" class="btn outline" title="含表單欄位、簽核步驟、PDF 排版；不含系統設定" @click="exportAll">
        匯出全部流程模組
      </button>
      <button type="button" class="btn outline" title="匯入流程＋表單＋PDF 排版；不影響系統設定" @click="triggerImport">
        匯入流程模組 (.json)
      </button>
      <button type="button" class="btn primary" @click="openCreate">＋ 建立簽核流程</button>
    </Teleport>

    <Teleport v-if="actionsReady && editing" to="#page-actions">
      <button type="button" class="btn outline" @click="editing = null">取消</button>
      <button type="button" class="btn primary" @click="editorRef?.save()">儲存</button>
    </Teleport>

    <input ref="importInput" type="file" accept=".json,application/json" class="hidden" @change="onImportFile" />

    <div v-if="!canManage" class="error-msg">您沒有管理簽核流程的權限（請洽系統管理員）</div>

    <WorkflowEditor
      v-else-if="editing"
      :key="editorKey"
      ref="editorRef"
      :workflow="editing._new ? null : editing"
      :auto-open-designer="!!editing._autoOpenDesigner"
      :users="users"
      :departments="departments"
      :known-categories="knownCategories"
      @saved="onSaved"
      @cancel="editing = null"
    />

    <div v-else-if="loading" class="card muted" style="padding:28px;text-align:center">載入簽核流程中…</div>

    <div v-else-if="!workflows.length" class="empty empty-state">
      <div class="empty-icon" aria-hidden="true">◇</div>
      <div class="empty-title">尚無簽核流程</div>
      <div class="empty-desc">建立第一個流程後，同仁即可在「新增申請」選擇表單送出。也可匯入流程模組（含 PDF 排版）。</div>
      <div class="empty-actions form-actions" style="justify-content:center;margin-top:14px">
        <button type="button" class="btn primary" @click="openCreate">＋ 建立第一個流程</button>
        <button type="button" class="btn outline" @click="triggerImport">匯入流程模組 JSON</button>
      </div>
    </div>

    <div v-else class="card">
      <p class="muted" style="margin-top:0">
        每個申請表單可<strong>啟用</strong>或<strong>停用</strong>：停用後「新增申請」不會出現，歷史單據仍可查閱。
        亦可<strong>建立／編輯</strong>步驟與表單，或<strong>匯出／匯入</strong> JSON。
        不需要的表單可先停用；確認無用再<strong>永久刪除</strong>。
      </p>
      <div class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th>名稱</th>
              <th>分類</th>
              <th>簽核步驟</th>
              <th>PDF 排版</th>
              <th>最終核准通知</th>
              <th>建立者</th>
              <th>狀態</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="w in workflows" :key="w.id">
              <td>
                <strong>{{ w.name }}</strong>
                <div class="muted">{{ w.description || '' }}</div>
                <div class="muted" style="margin-top:4px">表單 {{ fieldCount(w) }} 個欄位</div>
              </td>
              <td style="white-space:nowrap">
                <span class="field-type-tag">{{ w.category || '一般簽呈' }}</span>
              </td>
              <td style="max-width:420px;font-size:0.88rem;line-height:1.45">{{ stepsText(w) }}</td>
              <td style="font-size:0.85rem;white-space:nowrap" :title="pdfMeta(w).type">
                {{ pdfMeta(w).label }}{{ pdfMeta(w).resolved }}
              </td>
              <td style="font-size:0.85rem;white-space:nowrap" :title="w.finalNotify?.label || ''">
                {{ finalNotifyListText(w.finalNotify || {}) }}
              </td>
              <td>{{ w.creator_name }}</td>
              <td>
                <label class="switch" :title="isOn(w) ? '點擊停用' : '點擊啟用'">
                  <input
                    type="checkbox"
                    :checked="isOn(w)"
                    :disabled="busyId === w.id"
                    @change="toggleActive(w, $event)"
                  />
                  <span class="switch-slider"></span>
                  <span class="switch-text">{{ isOn(w) ? '啟用' : '停用' }}</span>
                </label>
              </td>
              <td>
                <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">
                  <button type="button" class="btn sm outline" @click="openEdit(w)">編輯</button>
                  <button type="button" class="btn sm outline" title="以流程圖方式編輯關卡順序與連線" @click="openFlow(w)">
                    🔀 流程圖
                  </button>
                  <button type="button" class="btn sm outline" @click="exportOne(w)">匯出</button>
                  <button
                    v-if="!isOn(w)"
                    type="button"
                    class="btn sm danger"
                    :disabled="busyId === w.id"
                    @click="purgeOne(w)"
                  >
                    永久刪除
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    <FlowEditorModal
      v-if="flowTarget"
      :workflow="flowTarget"
      :users="users"
      :departments="departments"
      @close="flowTarget = null"
      @save="onFlowSaved"
    />
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onBeforeUnmount, ref } from 'vue';
import { useToastStore } from '@/stores/toast';
import { useUsersStore } from '@/stores/users';
import { useWorkflowsStore, workflowFormFields, workflowSteps } from '@/stores/workflows';
import { usePermissions } from '@/composables/usePermissions';
import {
  fetchWorkflows,
  deactivateWorkflow,
  restoreWorkflow,
  purgeWorkflow,
  exportWorkflows,
  exportWorkflow,
  importWorkflows,
  updateWorkflow,
} from '@/api/workflows';
import { fetchDepartments } from '@/api/departments';
import WorkflowEditor from '@/components/workflows/WorkflowEditor.vue';
import FlowEditorModal from '@/components/workflows/FlowEditorModal.vue';
import {
  describeStepForList,
  pdfLayoutListLabel,
  finalNotifyListText,
  collectKnownCategories,
  formatTaiwanDateOnly,
  safeFilename,
  downloadBlob,
} from '@/lib/workflow-meta';

const toast = useToastStore();
const { hasPerm } = usePermissions();
const usersStore = useUsersStore();
const wfStore = useWorkflowsStore();

const canManage = computed(() => hasPerm('workflows'));
const loading = ref(true);
const editing = ref(null);
const editorKey = ref(0);
const editorRef = ref(null);
const importInput = ref(null);
const actionsReady = ref(false);
const departments = ref([]);
const busyId = ref(null);
const workflows = ref([]);
const flowTarget = ref(null);

const users = computed(() => usersStore.list || []);
const knownCategories = computed(() => collectKnownCategories(workflows.value));

function isOn(w) {
  return w.active !== 0;
}

function fieldCount(w) {
  return workflowFormFields(w).length;
}

function stepsText(w) {
  const steps = ['申請人', ...workflowSteps(w).map((s) => describeStepForList(s, users.value))];
  return steps.join(' → ') || '—';
}

function pdfMeta(w) {
  return pdfLayoutListLabel(w.pdfLayout || {});
}

function openCreate() {
  editing.value = { _new: true };
  editorKey.value += 1;
}

function openPaper() {
  editing.value = {
    name: '紙本表單簽核流程',
    pdfLayout: { type: 'pdf_template', fields: [] },
    _autoOpenDesigner: true,
  };
  editorKey.value += 1;
}

function openEdit(w) {
  editing.value = w;
  editorKey.value += 1;
}

async function loadAll() {
  if (!canManage.value) {
    loading.value = false;
    return;
  }
  loading.value = true;
  try {
    const [wfRes] = await Promise.all([
      fetchWorkflows({ all: true }),
      usersStore.fetch(),
      fetchDepartments()
        .then((res) => {
          departments.value = res.departments || [];
        })
        .catch(() => {
          departments.value = [];
        }),
    ]);
    workflows.value = wfRes.workflows || [];
    wfStore.fetch(true).catch(() => {});
  } catch (e) {
    toast.error(e.message || '載入流程失敗');
  } finally {
    loading.value = false;
  }
}

async function onSaved() {
  editing.value = null;
  await loadAll();
}

async function toggleActive(w, ev) {
  const wantOn = ev.target.checked;
  if (!wantOn) {
    if (
      !confirm(
        `確定停用申請表單「${w.name}」？\n停用後「新增申請」將無法再選擇此表單。\n歷史簽核紀錄仍可查閱，之後可再開啟開關啟用。`
      )
    ) {
      ev.target.checked = true;
      return;
    }
  }
  busyId.value = w.id;
  try {
    if (wantOn) {
      await restoreWorkflow(w.id);
      toast.success(`「${w.name}」已啟用`);
    } else {
      await deactivateWorkflow(w.id);
      toast.success(`「${w.name}」已停用`);
    }
    await loadAll();
  } catch (e) {
    ev.target.checked = !wantOn;
    toast.error(e.message || '操作失敗');
  } finally {
    busyId.value = null;
  }
}

async function purgeOne(w) {
  if (
    !confirm(
      `確定【永久刪除】流程「${w.name}」？\n刪除後列表中不再顯示，無法復原。\n若仍有「進行中」的申請將無法刪除。`
    )
  ) {
    return;
  }
  busyId.value = w.id;
  try {
    await purgeWorkflow(w.id);
    toast.success('流程已永久刪除');
    await loadAll();
  } catch (e) {
    toast.error(e.message || '永久刪除失敗');
  } finally {
    busyId.value = null;
  }
}

async function exportAll() {
  try {
    const blob = await exportWorkflows();
    downloadBlob(blob, `全部簽核流程_可匯入_${formatTaiwanDateOnly(new Date())}.json`);
    toast.success('已匯出流程模組（表單＋步驟＋PDF 排版；不含系統設定）');
  } catch (e) {
    toast.error(e.message || '匯出失敗');
  }
}

async function exportOne(w) {
  try {
    const blob = await exportWorkflow(w.id);
    downloadBlob(blob, `${safeFilename(w.name)}.json`);
    toast.success(`已匯出「${w.name}」（含 PDF 排版）`);
  } catch (e) {
    toast.error(e.message || '匯出失敗');
  }
}

function triggerImport() {
  importInput.value?.click();
}

async function onImportFile(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    const data = await importWorkflows(payload);
    toast.success(data.message || `已匯入 ${data.imported} 個流程模組（含 PDF 排版；未變更系統設定）`);
    await loadAll();
  } catch (err) {
    toast.error(err.message || '匯入失敗（請確認 JSON 格式）');
  }
}

function openFlow(w) {
  flowTarget.value = w;
}

async function onFlowSaved(graph) {
  const w = flowTarget.value;
  if (!w) return;
  try {
    await updateWorkflow(w.id, { flow: graph });
    flowTarget.value = null;
    toast.success('流程圖已儲存，並同步更新簽核關卡。進行中單據不受影響。');
    await loadAll();
  } catch (e) {
    toast.error(e.message || '儲存失敗');
  }
}

onMounted(async () => {
  actionsReady.value = !!document.getElementById('page-actions');
  await loadAll();
  await nextTick();
  actionsReady.value = !!document.getElementById('page-actions');
});

onBeforeUnmount(() => {
  const actions = document.getElementById('page-actions');
  if (actions) actions.innerHTML = '';
  if (typeof window.closeModal === 'function') {
    try {
      window.closeModal();
    } catch {
      /* ignore */
    }
  }
});
</script>
