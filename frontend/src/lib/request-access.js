export function isLeaveRequestRow(r) {
  if (!r) return false;
  if (Number(r.void_of_request_id) > 0) return false;
  if (/作廢申請/.test(String(r.workflow_name || '')) || /^作廢申請/.test(String(r.title || '').trim())) {
    return false;
  }
  if (r.is_leave === true) return true;
  return /請假/.test(String(r.workflow_name || '')) || /請假/.test(String(r.title || ''));
}

export function canDeleteRequestRow(r, { isAdmin, hasLeaveDelete, hasRecordsDelete, userId, adminMode = false } = {}) {
  if (!r) return false;
  if (isAdmin) return true;
  if (r.can_delete === true) return true;
  if (isLeaveRequestRow(r) && hasLeaveDelete) return true;
  if (r.can_delete === false) return false;
  if (r.approver_signed) return false;
  if (r.status === 'approved') return false;
  if (adminMode && hasRecordsDelete) return true;
  return Number(r.requester_id) === Number(userId);
}
