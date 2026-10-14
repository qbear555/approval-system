/**
 * 桌面通知與成員 Excel 匯出。
 */
import { apiRequest } from '@/api/client';
import { useSystemStore } from '@/stores/system';
import { goPage } from '@/lib/app-services';

const DESKTOP_NOTIFY_KEY = 'approval_desktop_notify_prefs';

export function getDesktopNotifyPrefs() {
  const defaults = { enabled: true, foreground: true, titleFlash: true, pollSec: 20 };
  try {
    const raw = localStorage.getItem(DESKTOP_NOTIFY_KEY);
    if (!raw) return { ...defaults };
    const o = JSON.parse(raw);
    return {
      enabled: o.enabled !== false,
      foreground: o.foreground !== false,
      titleFlash: o.titleFlash !== false,
      pollSec: Math.min(120, Math.max(10, Number(o.pollSec) || 20)),
    };
  } catch {
    return { ...defaults };
  }
}

export function saveDesktopNotifyPrefs(prefs) {
  const next = { ...getDesktopNotifyPrefs(), ...(prefs || {}) };
  next.pollSec = Math.min(120, Math.max(10, Number(next.pollSec) || 20));
  localStorage.setItem(DESKTOP_NOTIFY_KEY, JSON.stringify(next));
  return next;
}

export function desktopNotifyPermissionLabel() {
  if (!('Notification' in window)) return { text: '此瀏覽器不支援', cls: 'danger' };
  const p = Notification.permission;
  if (p === 'granted') return { text: '已允許', cls: 'approved' };
  if (p === 'denied') return { text: '已封鎖（請至瀏覽器網站設定改為允許）', cls: 'rejected' };
  return { text: '尚未詢問', cls: 'pending' };
}

function formatTaiwanDateOnly(d = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d instanceof Date ? d : new Date(d));
}

export async function downloadUsersExcel(ids, { resetPasswords = false } = {}) {
  const blob = await apiRequest('/api/users/export', {
    method: 'POST',
    body: { ids: ids || [], resetPasswords },
    expectBlob: true,
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `成員名單_${formatTaiwanDateOnly(new Date())}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function ensureNotifyPermission(fromUserGesture = false) {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  if (!fromUserGesture && Notification.permission === 'default') return false;
  try {
    return (await Notification.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

export function showDesktopNotification(title, body, onClick) {
  const prefs = getDesktopNotifyPrefs();
  if (!prefs.enabled || !('Notification' in window) || Notification.permission !== 'granted') return;
  if (document.hidden === false && prefs.foreground === false) return;
  try {
    const n = new Notification(title, { body, tag: 'approval-pending' });
    n.onclick = () => {
      window.focus();
      if (typeof onClick === 'function') onClick();
      n.close();
    };
    setTimeout(() => n.close(), 12000);
  } catch {
    /* 瀏覽器拒絕通知 */
  }
}

let pendingTimer = null;
let lastPending = null;

export function stopPendingWatcher() {
  if (pendingTimer) clearInterval(pendingTimer);
  pendingTimer = null;
}

export function startPendingWatcher() {
  stopPendingWatcher();
  const tick = async () => {
    try {
      const res = await apiRequest('/api/stats');
      const n = Number(res.stats?.pendingMe || res.pendingMe || 0);
      useSystemStore().pendingCount = n;
      if (lastPending != null && n > lastPending) {
        showDesktopNotification('待簽核', `您有 ${n} 件待簽核`, () => {
          goPage('inbox');
        });
      }
      lastPending = n;
    } catch {
      /* 未登入或暫時離線 */
    }
  };
  tick();
  pendingTimer = setInterval(tick, (getDesktopNotifyPrefs().pollSec || 20) * 1000);
}
