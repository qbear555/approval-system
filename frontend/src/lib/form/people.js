export function userLabel(u, { fallbackId } = {}) {
  if (!u) return fallbackId != null ? `#${fallbackId}` : '—';
  return u.department ? `${u.name}（${u.department}）` : u.name || `#${u.id}`;
}

export function findUser(users, id) {
  return (users || []).find((u) => Number(u.id) === Number(id)) || null;
}

export function parseIdList(raw) {
  return String(raw || '')
    .split(/[,，\s]+/)
    .map(Number)
    .filter((n) => n > 0);
}

export function formatUserIds(raw, users) {
  const ids = parseIdList(raw);
  if (!ids.length) return '';
  return ids.map((id) => userLabel(findUser(users, id), { fallbackId: id })).join('、');
}

export function splitUsersForDeptHead(users, me) {
  const myDepts = new Set(
    [me?.department, ...(me?.departments || [])].filter(Boolean).map(String)
  );
  const all = (users || []).filter((u) => u.active !== 0 && Number(u.id) !== Number(me?.id));
  const inDept = (u) => {
    const ud = [u.department, ...(u.departments || [])].filter(Boolean).map(String);
    return ud.some((d) => myDepts.has(d));
  };
  if (!myDepts.size) {
    return { deptMembers: [], others: all, myDeptLabel: '' };
  }
  return {
    deptMembers: all.filter(inDept),
    others: all.filter((u) => !inDept(u)),
    myDeptLabel: [...myDepts].join('、'),
  };
}

export function activeUsersExceptMe(users, me) {
  return (users || []).filter((u) => u.active !== 0 && Number(u.id) !== Number(me?.id));
}
