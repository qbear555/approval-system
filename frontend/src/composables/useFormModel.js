import { reactive, watch } from 'vue';
import {
  compactFollowupItems,
  compactWelfareItems,
  isAutoOpeningSummary,
  isHalfStepNumber,
  isItRepairNoncompliant,
  itRepairNoteId,
  IT_REPAIR_CHECK_IDS,
  parseFollowupItems,
  parseWelfareItems,
  shouldHideField,
  snapHalfUnit,
  welfareAutoOpeningSummary,
  welfareCurrentRocYear,
} from '@/lib/form';
import { workflowFormFields, workflowSteps } from '@/stores/workflows';

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

export function initFormData(fields = [], steps = [], defaults = {}) {
  const data = { ...defaults };

  for (const f of fields) {
    if (data[f.id] != null && data[f.id] !== '') continue;
    if (f.type === 'checkbox') data[f.id] = false;
    else if (f.id === 'period_roc_year') data[f.id] = welfareCurrentRocYear(defaults);
    else if (f.id === 'report_date') data[f.id] = todayIso();
    else if (f.id === 'opening_summary') {
      data[f.id] = welfareAutoOpeningSummary(
        defaults.period_month || String(new Date().getMonth() + 1),
        welfareCurrentRocYear(defaults)
      );
    } else if (f.id === 'period_month' || f.id === 'submit_month') {
      const m = String(new Date().getMonth() + 1);
      const opts = (f.options || []).map(String);
      data[f.id] = opts.includes(`${m}月`) ? `${m}月` : opts.includes(m) ? m : m;
    } else if (f.id === 'submit_year') {
      const yAd = String(new Date().getFullYear());
      const yRoc = String(new Date().getFullYear() - 1911);
      const opts = (f.options || []).map(String);
      data[f.id] = opts.includes(yAd) ? yAd : opts.includes(yRoc) ? yRoc : yAd;
    } else if (f.type === 'table' || f.id === 'welfare_items') {
      data[f.id] = parseWelfareItems(defaults[f.id]);
    } else if (f.id === 'followup_items') {
      data[f.id] = parseFollowupItems(defaults[f.id]);
    } else {
      data[f.id] = '';
    }
  }

  if (!data.period_roc_year) data.period_roc_year = welfareCurrentRocYear(data);

  for (const step of steps || []) {
    const order = step.order;
    if (step.assignType === 'dept_head') {
      const k = `dept_head_${order}`;
      if (data[k] == null || data[k] === '') data[k] = 'skip';
    }
    if (step.assignType === 'cosign_pick') {
      const k = `cosign_${order}`;
      if (data[k] == null || data[k] === '') data[k] = 'skip';
    }
    if (step.assignType === 'users_pick') {
      const k = `users_pick_${order}`;
      if ((data[k] == null || data[k] === '') && step.skipIfNoApprover) data[k] = 'skip';
    }
  }

  return data;
}

export function collectFormPayload(data, fields = []) {
  const out = { ...data };
  for (const f of fields) {
    if (f.type === 'table' || f.id === 'welfare_items') {
      out[f.id] = compactWelfareItems(parseWelfareItems(out[f.id]));
    }
    if (f.id === 'followup_items') {
      out[f.id] = compactFollowupItems(parseFollowupItems(out[f.id]));
    }
    if (isHalfStepNumber(f) && out[f.id] !== '' && out[f.id] != null) {
      const snapped = snapHalfUnit(out[f.id]);
      if (snapped !== '') out[f.id] = snapped;
    }
  }
  return out;
}

export function validateFormData(fields = [], steps = [], data = {}) {
  for (const f of fields) {
    if (shouldHideField(f)) continue;
    if (f.id === 'period_roc_year') continue;
    if (IT_REPAIR_CHECK_IDS.some((id) => itRepairNoteId(id) === f.id)) {
      const checkId = f.id.replace(/_note$/, '');
      if (isItRepairNoncompliant(data[checkId]) && !String(data[f.id] || '').trim()) {
        return `請填寫「${f.label}」`;
      }
      continue;
    }
    if (!f.required) continue;
    const v = data[f.id];
    if (f.type === 'checkbox') continue;
    if (f.type === 'table' || f.id === 'welfare_items') {
      if (!compactWelfareItems(parseWelfareItems(v)).length) return `請填寫「${f.label}」`;
      continue;
    }
    if (f.id === 'followup_items') {
      if (!compactFollowupItems(parseFollowupItems(v)).length) return `請填寫「${f.label}」`;
      continue;
    }
    if (v == null || String(v).trim() === '') return `請填寫「${f.label}」`;
  }

  for (const step of steps || []) {
    if (step.assignType !== 'users_pick' || step.skipIfNoApprover) continue;
    const k = `users_pick_${step.order}`;
    const v = String(data[k] || '').trim();
    if (!v || v === 'skip') {
      return `請勾選至少一位「${step.name || '簽核人'}」`;
    }
  }
  return null;
}

export function useFormModel({ fields, steps, defaults } = {}) {
  const formData = reactive(initFormData(fields || [], steps || [], defaults || {}));

  watch(
    () => formData.period_month,
    (month) => {
      if (isAutoOpeningSummary(formData.opening_summary)) {
        formData.opening_summary = welfareAutoOpeningSummary(month, formData.period_roc_year);
      }
    }
  );

  function reset(nextFields, nextSteps, nextDefaults) {
    const fresh = initFormData(nextFields || [], nextSteps || [], nextDefaults || {});
    Object.keys(formData).forEach((k) => delete formData[k]);
    Object.assign(formData, fresh);
  }

  function payload() {
    return collectFormPayload(formData, fields || []);
  }

  function validate() {
    return validateFormData(fields || [], steps || [], formData);
  }

  return { formData, reset, payload, validate };
}

export function fieldsAndStepsFromWorkflow(wf) {
  return {
    fields: workflowFormFields(wf),
    steps: workflowSteps(wf),
  };
}
