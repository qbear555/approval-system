import { apiRequest } from './client';

export function fetchWorkflows({ all = false } = {}) {
  return apiRequest(`/api/workflows${all ? '?all=1' : ''}`);
}

export function fetchWorkflow(id) {
  return apiRequest(`/api/workflows/${id}`);
}

export function createWorkflow(body) {
  return apiRequest('/api/workflows', { method: 'POST', body });
}

export function updateWorkflow(id, body) {
  return apiRequest(`/api/workflows/${id}`, { method: 'PUT', body });
}

export function deactivateWorkflow(id) {
  return apiRequest(`/api/workflows/${id}`, { method: 'DELETE' });
}

export function restoreWorkflow(id) {
  return apiRequest(`/api/workflows/${id}/restore`, { method: 'POST' });
}

export function purgeWorkflow(id) {
  return apiRequest(`/api/workflows/${id}?permanent=1`, {
    method: 'DELETE',
    body: { permanent: true },
  });
}

export function exportWorkflows() {
  return apiRequest('/api/workflows/export', { expectBlob: true });
}

export function exportWorkflow(id) {
  return apiRequest(`/api/workflows/${id}/export`, { expectBlob: true });
}

export function importWorkflows(body) {
  return apiRequest('/api/workflows/import', { method: 'POST', body });
}

export function fetchCanvasPreset(type) {
  return apiRequest(`/api/workflows/canvas-preset/${encodeURIComponent(type)}`);
}
