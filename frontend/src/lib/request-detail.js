import { REQUEST_STATUS } from '@/lib/status';

export function htmlToPlain(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export function flattenApproverData(approverData) {
  const data = approverData || {};
  const flat = {};
  for (const [k, v] of Object.entries(data)) {
    if (k.startsWith('step_') && v && typeof v === 'object' && v.data) {
      Object.assign(flat, v.data);
    } else if (!k.startsWith('step_') && typeof v !== 'object') {
      flat[k] = v;
    }
  }
  return flat;
}

export const APPROVER_FIELD_LABELS = {
  leave_month_days: '本月累計日數',
  leave_month_hours: '本月累計時數',
  leave_year_days: '本年累計日數',
  leave_year_hours: '本年累計時數',
  remaining_special_leave_days: '剩餘特休日數',
  hr_leave_type: '假別（人事核定）',
  pc_acquired_date: '原電腦取得日期',
  check_os: '作業系統（Windows10）',
  check_memory: '記憶體（4G 以上）',
  handle_result: '處理結果',
  requested_credit_limit: '申請信用額度（元）',
  vp_suggested_limit: '建議額度（元）',
  gm_approved_limit: '核定額度（元）',
  sales_conditions: '業務員要求條件',
  vp_conditions: '副總要求條件',
  gm_conditions: '總經理要求條件',
  reason_for_increase: '增加額度原由',
  sales_revenue: '銷貨收入',
  sales_cost: '銷貨成本',
  sales_gross_profit: '銷貨毛利',
  actual_start: '實際工時開始',
  actual_end: '實際工時結束',
  actual_hours: '實際總計',
};

export function approverSectionTitle(flat) {
  if (flat.pc_acquired_date != null || flat.check_os != null || flat.handle_result != null) {
    return '管理部／簽核單位填寫';
  }
  if (
    flat.requested_credit_limit != null ||
    flat.vp_suggested_limit != null ||
    flat.gm_approved_limit != null
  ) {
    return '核決單位填寫（信用額度）';
  }
  if (flat.sales_revenue != null || flat.sales_cost != null || flat.sales_gross_profit != null) {
    return '財務單位填寫';
  }
  if (
    flat.hr_leave_type != null ||
    flat.remaining_special_leave_days != null ||
    flat.leave_month_days != null
  ) {
    return '人事／簽核單位填寫';
  }
  return '簽核單位填寫';
}

export function creditStepPrefill(currentStep, approverData) {
  if (!currentStep) return {};
  const ad = approverData || {};
  const name = String(currentStep.name || '');
  const pre = {};
  if (/業務/.test(name)) {
    if (ad.requested_credit_limit != null && ad.requested_credit_limit !== '') {
      pre.requested_credit_limit = ad.requested_credit_limit;
    }
  } else if (/副總/.test(name)) {
    pre.vp_suggested_limit =
      ad.vp_suggested_limit != null && ad.vp_suggested_limit !== ''
        ? ad.vp_suggested_limit
        : ad.requested_credit_limit ?? '';
  } else if (/總經理/.test(name)) {
    pre.gm_approved_limit =
      ad.gm_approved_limit != null && ad.gm_approved_limit !== ''
        ? ad.gm_approved_limit
        : ad.vp_suggested_limit != null && ad.vp_suggested_limit !== ''
          ? ad.vp_suggested_limit
          : ad.requested_credit_limit ?? '';
  }
  return pre;
}

export function isCreditLimitRequest(request) {
  return (
    /信用額度/.test(String(request?.workflow_name || '')) ||
    /信用額度/.test(String(request?.title || ''))
  );
}

export function emailNotifyText(request) {
  const mailHint = request.requester_email
    ? `（${request.requester_email}）`
    : '（申請人未填 Email）';
  if (!request.notify_email) return `未開啟${mailHint}`;
  const p = request.notify_prefs || {};
  const shown = [];
  if (
    p &&
    (Object.prototype.hasOwnProperty.call(p, 'approved') ||
      Object.prototype.hasOwnProperty.call(p, 'rejected') ||
      Object.prototype.hasOwnProperty.call(p, 'step'))
  ) {
    if (p.approved) shown.push('核准');
    if (p.rejected) shown.push('駁回');
    if (p.step) shown.push('下一步');
  } else {
    shown.push('核准', '駁回', '下一步');
  }
  if (!shown.length) return `未開啟${mailHint}`;
  return `已開啟：${shown.join('、')}${mailHint}`;
}

export const TIMELINE_ACTIONS = {
  submit: { label: '發起申請', cls: 'submit', icon: '📝' },
  approve: { label: '核准通過', cls: 'approve', icon: '✅' },
  reject: { label: '駁回退件', cls: 'reject', icon: '❌' },
  return: { label: '退回', cls: 'return', icon: '↩️' },
  cosign: { label: '加簽', cls: 'cosign', icon: '➕' },
  forward: { label: '轉簽', cls: 'forward', icon: '↗️' },
  void: { label: '申請作廢', cls: 'reject', icon: '🚫' },
  comment: { label: '留言', cls: 'pending', icon: '💬' },
  finance_confirm: { label: '財務建檔完成', cls: 'approve', icon: '📊' },
  applicant_ack: { label: '申請人確認', cls: 'approve', icon: '🆗' },
};

export function statusTagClass(status) {
  return REQUEST_STATUS[status]?.cls || '';
}

export function voidStepsPathText(steps) {
  if (!Array.isArray(steps) || !steps.length) return '';
  return steps.map((s) => s.name || `步驟 ${s.order}`).join(' → ');
}

export function stepAssigneeLabel(step, userName) {
  if (!step) return '—';
  if (step.approver_name) return step.approver_name;
  if (step.approverName) return step.approverName;
  const ids = step.approverIds || step.approver_ids || [];
  if (Array.isArray(ids) && ids.length && typeof userName === 'function') {
    return ids.map((id) => userName(id)).join('、');
  }
  return step.assignType === 'dept_head' ? '部門主管' : '系統指定';
}
