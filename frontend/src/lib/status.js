export const REQUEST_STATUS = {
  draft: { label: '草稿', cls: 'draft' },
  pending: { label: '簽核中', cls: 'pending' },
  approved: { label: '已核准', cls: 'approved' },
  rejected: { label: '已駁回', cls: 'rejected' },
  cancelled: { label: '已取消', cls: 'cancelled' },
  voided: { label: '已作廢', cls: 'voided' },
};

export const REQUEST_STATUS_FILTERS = Object.keys(REQUEST_STATUS);

export function normalizeRequestStatus(s) {
  const v = String(s || '').trim().toLowerCase();
  return REQUEST_STATUS_FILTERS.includes(v) ? v : '';
}

export function statusLabel(status) {
  return REQUEST_STATUS[status]?.label || status || '—';
}

export function statusClass(status) {
  return REQUEST_STATUS[status]?.cls || '';
}

export function minePageTitle(status) {
  const st = normalizeRequestStatus(status);
  if (st === 'pending') return '我的進行中';
  if (st === 'approved') return '我已完成';
  return '我的申請';
}
