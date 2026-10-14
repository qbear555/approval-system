import { apiRequest } from './client';

export function fetchRequests(params = {}) {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v != null && v !== '') q.set(k, String(v));
  });
  const qs = q.toString();
  return apiRequest(`/api/requests${qs ? `?${qs}` : ''}`);
}

export function fetchRequest(id) {
  return apiRequest(`/api/requests/${id}`);
}

export function createRequest(formData) {
  return apiRequest('/api/requests', { method: 'POST', body: formData });
}

export function fetchVoidTargets() {
  return apiRequest('/api/requests/void-targets');
}

export function fetchApprovedForAttach(params = {}) {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v != null && v !== '') q.set(k, String(v));
  });
  const qs = q.toString();
  return apiRequest(`/api/requests/approved-for-attach${qs ? `?${qs}` : ''}`);
}

export function deleteAttachment(id) {
  return apiRequest(`/api/attachments/${id}`, { method: 'DELETE' });
}

export function fetchLeavePrincipals() {
  return apiRequest('/api/agents/leave-principals');
}

export function fetchVoidPreview(id) {
  return apiRequest(`/api/requests/${id}/void-preview`);
}

export function postRequestAction(id, body) {
  return apiRequest(`/api/requests/${id}/action`, { method: 'POST', body });
}

export function updateRequest(id, formData) {
  return apiRequest(`/api/requests/${id}`, { method: 'PUT', body: formData });
}

export function deleteRequest(id) {
  return apiRequest(`/api/requests/${id}`, { method: 'DELETE' });
}

export function remindRequest(id) {
  return apiRequest(`/api/requests/${id}/remind`, { method: 'POST', body: {} });
}

export function voidApplyRequest(id, reason) {
  return apiRequest(`/api/requests/${id}/void-apply`, { method: 'POST', body: { reason } });
}

export function voidRequest(id, reason) {
  return apiRequest(`/api/requests/${id}/void`, { method: 'POST', body: { reason } });
}

export function financeConfirmRequest(id, note) {
  return apiRequest(`/api/requests/${id}/finance-confirm`, {
    method: 'POST',
    body: { note: note || '已於ERP系統完成授信額度設定' },
  });
}

export function applicantAckRequest(id) {
  return apiRequest(`/api/requests/${id}/applicant-ack`, { method: 'POST' });
}

export function finalNotifyAckRequest(id) {
  return apiRequest(`/api/requests/${id}/final-notify-ack`, { method: 'POST' });
}

export function uploadRequestAttachments(id, formData) {
  return apiRequest(`/api/requests/${id}/attachments`, { method: 'POST', body: formData });
}

export function fetchRequestPdf(id, { preview = false, returnMeta = false } = {}) {
  const qs = preview ? '?preview=1' : '';
  return apiRequest(`/api/requests/${id}/pdf${qs}`, {
    expectBlob: !returnMeta,
    returnMeta,
  });
}

export function fetchOnlyOfficeStatus() {
  return apiRequest('/api/onlyoffice/status');
}

export function fetchOnlyOfficeEditor(attachmentId) {
  return apiRequest(`/api/onlyoffice/editor/${attachmentId}`);
}
