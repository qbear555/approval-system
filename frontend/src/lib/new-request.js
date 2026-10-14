import {
  applyLeaveMinUnit,
  calcLeaveDaysHours,
  computePersonalLeaveDisplay,
  computeSickLeaveDisplay,
  formatLeaveTitlePeriod,
  isSickLeaveType,
  isSpecialLeaveType,
  welfareCurrentRocYear,
} from '@/lib/form';
import { parseJsonField, workflowFormFields, workflowSteps } from '@/stores/workflows';

export const CAT_ORDER = ['人事差勤', '財務採購', '資訊總務', '業務行政', '一般簽呈'];

export function isLeaveWorkflow(w) {
  return /請假/.test(String(w?.name || ''));
}
export function isOtWorkflow(w) {
  return /延長工時|加班/.test(String(w?.name || ''));
}
export function isGeneralMemoWorkflow(w) {
  const n = String(w?.name || '');
  return /一般簽呈|簽呈/.test(n) && !/信用額度|請假|請購|支付|報支|出差|加班|報修/.test(n);
}
export function isExpenseWorkflow(w) {
  return /費用|報支|報銷|請款/.test(String(w?.name || ''));
}
export function isVoidWorkflow(w) {
  return /作廢申請/.test(String(w?.name || ''));
}
export function isItRepairWorkflow(w) {
  return /電腦異常|異常報修|報修申請|IT.?Repair/i.test(String(w?.name || ''));
}
export function showTitleField(w) {
  return isGeneralMemoWorkflow(w) || isExpenseWorkflow(w);
}
export function isExecTeamApplicantUser(user) {
  if (!user) return false;
  const depts = [user.department, ...(user.departments || [])].filter(Boolean);
  return depts.some((d) => /經營團隊/.test(String(d)));
}

export function sortedWorkflowCategories(workflows) {
  const catsSet = new Set(workflows.map((w) => String(w.category || '').trim() || '一般簽呈'));
  return [...catsSet].sort((a, b) => {
    const ia = CAT_ORDER.indexOf(a);
    const ib = CAT_ORDER.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });
}

export function normalizeWorkflowCategory(w) {
  return String(w?.category || '').trim() || '一般簽呈';
}

export function leaveStepsForApplicant(w, applicant) {
  const steps = [...workflowSteps(w)];
  if (!isLeaveWorkflow(w) || !isExecTeamApplicantUser(applicant)) return steps;
  return steps.filter(
    (s) => !/副總/.test(String(s.name || '')) && s.assignType !== 'dept_head' && !/部門主管/.test(String(s.name || ''))
  );
}

export function leavePathDescription(steps, proxyPicked) {
  const names = (steps || []).map((s) => String(s.name || '').trim()).filter(Boolean);
  const start = proxyPicked ? `申請人（代 ${proxyPicked}）` : '申請人';
  return names.length ? `${start} → ${names.join(' → ')}` : start;
}

export function workflowPdfLayout(wf) {
  return parseJsonField(wf?.pdfLayout ?? wf?.pdf_layout, null);
}

export function isPdfTemplateMode(wf) {
  const pl = workflowPdfLayout(wf);
  return pl?.type === 'pdf_template' && !!pl?.templateFile;
}

export function displayFormFields(wf) {
  let fields = [...workflowFormFields(wf)];
  const leaveMode = isLeaveWorkflow(wf);
  if (leaveMode && !fields.some((f) => f.id === 'hours')) {
    const daysIdx = fields.findIndex((f) => f.id === 'days');
    const hoursField = {
      id: 'hours',
      label: '小時',
      type: 'number',
      required: false,
      placeholder: '依起迄自動試算（最小 0.5；全日＝7.5 小時）',
    };
    if (daysIdx >= 0) fields.splice(daysIdx + 1, 0, hoursField);
    else fields.push(hoursField);
  }
  fields = fields.map((f) => {
    if (f.id === 'days') {
      return { ...f, placeholder: f.placeholder || '全日 09:00～17:30＝1 日' };
    }
    if (leaveMode && (f.id === 'agent' || /代理/.test(String(f.label || '')))) {
      return {
        ...f,
        label: f.label && !/職務/.test(String(f.label)) ? `${f.label}（職務代理人）` : f.label || '代理人（職務代理人）',
        hint: f.hint || '可填寫本人或其他同仁。於請假起迄期間，職務代理人可代申請人簽核其他待辦。',
      };
    }
    return f;
  });
  if (isOtWorkflow(wf)) {
    fields = fields.map((f) => (f.id === 'hours' ? { ...f, readOnly: true, placeholder: '依起迄自動換算' } : f));
  }
  return fields;
}

export function buildLeaveTitle(data, proxyName) {
  const type = data.leave_type || data.假別 || '';
  const days = data.days != null && data.days !== '' ? `${data.days}日` : '';
  const hours =
    data.hours != null && data.hours !== '' && Number(data.hours) > 0 ? `${data.hours}小時` : '';
  const parts = proxyName ? [`代申請請假（${proxyName}）`] : ['請假申請'];
  if (type) parts.push(String(type));
  const period = formatLeaveTitlePeriod(data.start_date, data.end_date);
  if (period) parts.push(period);
  if (/事假/.test(String(type))) {
    const disp = computePersonalLeaveDisplay(data);
    if (disp?.text) parts.push(disp.text);
    else {
      if (days) parts.push(days);
      if (hours) parts.push(hours);
    }
  } else if (isSickLeaveType(type)) {
    const disp = computeSickLeaveDisplay(data);
    if (disp?.text) parts.push(disp.text);
    else if (days) parts.push(days);
    else if (hours) parts.push(hours);
  } else if (isSpecialLeaveType(type)) {
    if (days) parts.push(days);
  } else {
    if (days) parts.push(days);
    if (hours) parts.push(hours);
  }
  return parts.join(' · ').slice(0, 200);
}

export function buildAutoTitle(w, data, proxyName) {
  if (isLeaveWorkflow(w)) return buildLeaveTitle(data, proxyName);
  const wfName = String(w?.name || '申請').trim() || '申請';
  if (/福利金/.test(wfName)) {
    const y = welfareCurrentRocYear(data);
    const m = String(data.period_month || '').replace(/[^\d]/g, '');
    if (m) return `${wfName} · ${y}年${Number(m)}月`.slice(0, 200);
    return wfName.slice(0, 200);
  }
  const pick = [
    data.subject,
    data.item_name,
    data.purpose,
    data.reason,
    data.destination,
    data.customer_name,
    data.issue_desc,
    data.expense_type,
    data.desc,
    data.ot_option,
    data.trading_products,
  ]
    .map((v) => (v == null ? '' : String(v).trim()))
    .filter(Boolean)
    .map((s) => s.replace(/\s+/g, ' ').slice(0, 80));
  if (pick.length) return `${wfName} · ${pick[0]}`.slice(0, 200);
  return wfName.slice(0, 200);
}

export function composeSubmitTitle(w, titleInput, data, { asDraft, proxyName } = {}) {
  let title = String(titleInput || '').trim();
  if (!showTitleField(w)) {
    title = buildAutoTitle(w, data, proxyName) || (asDraft ? `草稿 · ${w.name || '申請'}` : '');
  } else if (asDraft && !title) {
    title = `草稿 · ${w.name || '申請'}`;
  } else if (isExpenseWorkflow(w) && title && !/^草稿\s*·/.test(title)) {
    const wfLabel = String(w.name || '費用報支').trim() || '費用報支';
    if (title !== wfLabel && !title.startsWith(`${wfLabel} ·`) && !/^費用報支(\s*·|$)/.test(title)) {
      title = `${wfLabel} · ${title}`.slice(0, 200);
    }
  }
  return title || `草稿 · ${w.name || '申請'}`;
}

export function cleanLoadedTitle(title, { isClone } = {}) {
  const raw = String(title || '').trim();
  const stripped = raw
    .replace(/^草稿\s*·\s*/, '')
    .replace(/^(費用報支|費用申請)\s*·\s*/, '')
    .trim();
  if (isClone) return stripped.startsWith('[複製]') ? stripped : `[複製] ${stripped}`;
  return stripped;
}

export function recalcLeaveFields(data) {
  const start = data.start_date;
  const end = data.end_date;
  const leaveType = data.leave_type || '';
  if (!start || !end) {
    return { aligned: applyLeaveMinUnit(leaveType, data.days, data.hours), raw: null };
  }
  const raw = calcLeaveDaysHours(start, end);
  const aligned = applyLeaveMinUnit(leaveType, raw.days, raw.hours);
  return { aligned, raw };
}

export function formatApprovedRequestLabel(r) {
  if (!r) return '';
  const when = String(r.completed_at || '').replace('T', ' ').slice(0, 16);
  const wf = r.workflow_name ? `${r.workflow_name} · ` : '';
  const who = r.requester_name ? `（${r.requester_name}）` : '';
  return `#${r.id}　${wf}${r.title || ''}${who}${when ? `　${when}` : ''}`;
}

export function fmtAttSize(n) {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function isPreviewableName(name, mime = '') {
  const n = String(name || '');
  const m = String(mime || '').toLowerCase();
  return m.includes('pdf') || /\.pdf$/i.test(n) || m.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(n);
}
