/** 與 server labor.MANUAL_LEAVE_TRACK_IDS、經典 app.js 一致。 */
export const MANUAL_LEAVE_TRACK = [
  { id: 'special', name: '特別休假（特休）' },
  { id: 'personal', name: '事假' },
  { id: 'sick', name: '普通傷病假（病假）' },
  { id: 'hospital', name: '住院傷病假' },
  { id: 'marriage', name: '婚假' },
  { id: 'funeral', name: '喪假' },
  { id: 'ritual', name: '祭儀假' },
  { id: 'maternity', name: '產假' },
  { id: 'prenatal', name: '產檢假' },
  { id: 'paternity', name: '陪產檢及陪產假' },
  { id: 'menstrual', name: '生理假' },
  { id: 'family', name: '家庭照顧假' },
];

export function formatUsername(u) {
  const s = String(u || '').trim();
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function leaveUsedMap(user) {
  const map = {};
  for (const t of MANUAL_LEAVE_TRACK) map[t.id] = { days: 0, hours: 0 };
  const src = user?.leave_used || user?.labor?.leaveUsedManual || user?.labor?.leaveUsed || null;
  if (src && typeof src === 'object') {
    for (const t of MANUAL_LEAVE_TRACK) {
      const v = src[t.id];
      if (v && typeof v === 'object') {
        map[t.id] = { days: v.days != null ? v.days : 0, hours: v.hours != null ? v.hours : 0 };
      }
    }
  }
  if ((!src || !src.special) && (user?.sl_used_days != null || user?.labor?.sl_used_days != null)) {
    map.special = {
      days: user.sl_used_days ?? user.labor?.sl_used_days ?? 0,
      hours: 0,
    };
  }
  return map;
}

export function leaveEntitledMap(user) {
  const map = {};
  for (const t of MANUAL_LEAVE_TRACK) map[t.id] = { days: 0 };
  const src = user?.leave_entitled || user?.labor?.leaveEntitledManual || user?.labor?.leaveEntitled || null;
  if (src && typeof src === 'object') {
    for (const t of MANUAL_LEAVE_TRACK) {
      const v = src[t.id];
      if (v == null) continue;
      map[t.id] = { days: typeof v === 'object' ? (v.days != null ? v.days : 0) : v };
    }
  }
  const bals = user?.labor?.leaveBalances;
  if (Array.isArray(bals) && (!src || !Object.keys(src).length)) {
    for (const b of bals) {
      if (b?.id && map[b.id] && b.entitled != null) map[b.id] = { days: b.entitled };
    }
  }
  return map;
}

export function collectLeavePayload(rows) {
  const leave_used = {};
  const leave_entitled = {};
  for (const t of MANUAL_LEAVE_TRACK) {
    const row = rows[t.id] || { entitled: 0, days: 0, hours: 0 };
    const hours = t.id === 'special' ? '0' : String(row.hours ?? '0');
    leave_used[t.id] = { days: String(row.days ?? '0'), hours };
    leave_entitled[t.id] = { days: String(row.entitled ?? '0') };
  }
  return {
    leave_used,
    leave_entitled,
    sl_used_days: leave_used.special?.days ?? '0',
    sl_used_hours: '0',
  };
}
