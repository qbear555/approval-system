/** 路由與彈窗的模組接點。不掛在 window 上。 */
let router = null;
const modals = {
  attachment: null,
  attachmentBlob: null,
  cosign: null,
  forward: null,
  returnTo: null,
};

export function bindRouter(r) {
  router = r;
}

export function goPage(page, params = {}) {
  if (!router) return false;
  let dest = '/dashboard';
  if (page === 'dashboard') dest = '/dashboard';
  else if (page === 'inbox') dest = '/inbox';
  else if (page === 'mine') dest = params.status ? { path: '/mine', query: { status: params.status } } : '/mine';
  else if (page === 'records') dest = '/records';
  else if (page === 'detail' && params.id) dest = `/detail/${params.id}`;
  else if (page === 'new-request') {
    const query = {};
    if (params.workflowId) query.workflowId = String(params.workflowId);
    if (params.cloneFrom) query.cloneFrom = String(params.cloneFrom);
    if (params.draftId) query.draftId = String(params.draftId);
    dest = Object.keys(query).length ? { path: '/new-request', query } : '/new-request';
  } else if (page === 'workflows') dest = '/workflows';
  else if (
    ['backups', 'leave-report', 'audit-logs', 'users', 'departments', 'settings', 'line-settings', 'system-settings'].includes(page)
  ) {
    dest = `/${page}`;
  } else if (page) dest = `/${page}`;
  router.push(dest).catch(() => {});
  return true;
}

export function registerUi(partial) {
  Object.assign(modals, partial || {});
}

export function openAttachmentViewer(id, name = '') {
  if (typeof modals.attachment !== 'function') return false;
  modals.attachment(id, name);
  return true;
}

export function openAttachmentBlob(blob, name = '') {
  if (typeof modals.attachmentBlob !== 'function') return false;
  modals.attachmentBlob(blob, name);
  return true;
}

export function openCosignModal(request, onDone) {
  if (typeof modals.cosign !== 'function') return false;
  modals.cosign(request, onDone);
  return true;
}

export function openForwardModal(request, onDone) {
  if (typeof modals.forward !== 'function') return false;
  modals.forward(request, onDone);
  return true;
}

export function openReturnModal(request, detail, onDone) {
  if (typeof modals.returnTo !== 'function') return false;
  modals.returnTo(request, detail, onDone);
  return true;
}
