const COMMON_FORM_PATTERNS = [
  /請假/,
  /費用報支|報銷|請款/,
  /請購|採購/,
  /電腦異常報修|報修/,
  /出差/,
  /延長工時|加班/,
  /一般簽呈/,
  /信用額度/,
];

export function favWorkflowKey(userId) {
  return `approval_fav_workflows_${userId || 'guest'}`;
}

export function getDefaultFavWorkflowIds(allWorkflows = []) {
  const defaults = [];
  const pickedIds = new Set();
  for (const pattern of COMMON_FORM_PATTERNS) {
    const match = allWorkflows.find((w) => !pickedIds.has(w.id) && pattern.test(w.name));
    if (match) {
      defaults.push(match.id);
      pickedIds.add(match.id);
    }
  }
  for (const w of allWorkflows) {
    if (defaults.length >= 8) break;
    if (!pickedIds.has(w.id)) {
      defaults.push(w.id);
      pickedIds.add(w.id);
    }
  }
  return defaults;
}

export function getFavWorkflowIds(userId, allWorkflows = []) {
  const raw = localStorage.getItem(favWorkflowKey(userId));
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map(Number).filter((id) => allWorkflows.some((w) => w.id === id));
      }
    } catch {
      /* ignore */
    }
  }
  return getDefaultFavWorkflowIds(allWorkflows);
}

export function saveFavWorkflowIds(userId, ids) {
  localStorage.setItem(favWorkflowKey(userId), JSON.stringify((ids || []).map(Number)));
}

export function resetFavWorkflowIds(userId) {
  localStorage.removeItem(favWorkflowKey(userId));
}
