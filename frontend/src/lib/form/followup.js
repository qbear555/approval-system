export function parseFollowupItems(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const p = JSON.parse(raw);
      if (Array.isArray(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return [];
}

export function emptyFollowupRows(n = 2) {
  return Array.from({ length: n }, () => ({ item: '', owner: '', due: '' }));
}

export function compactFollowupItems(items) {
  return (items || []).filter((it) => it.item || it.owner || it.due);
}
