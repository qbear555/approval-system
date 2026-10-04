/* 線上簽核系統 — 前端 */
const API = '';
const state = {
  token: localStorage.getItem('approval_token') || '',
  user: null,
  page: 'dashboard',
  users: [],
  workflows: [],
};

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

/** 正式環境先停用簽名檔設定（本機仍開啟） */
const SIGNATURE_SETTINGS_ENABLED = false;

/** 帳號顯示：第一個字母大寫（與後端 normalizeUsername 一致）；登入仍不分大小寫 */
function formatUsername(u) {
  const s = String(u || '').trim();
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * 依法有日數上限、可於成員名單填寫手動已休的假別
 * （與 server labor.MANUAL_LEAVE_TRACK_IDS 一致）
 */
const MANUAL_LEAVE_TRACK = [
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

function getLeaveUsedMapFromUser(user) {
  const map = {};
  for (const t of MANUAL_LEAVE_TRACK) {
    map[t.id] = { days: 0, hours: 0 };
  }
  const src =
    user?.leave_used ||
    user?.labor?.leaveUsedManual ||
    user?.labor?.leaveUsed ||
    null;
  if (src && typeof src === 'object') {
    for (const t of MANUAL_LEAVE_TRACK) {
      const v = src[t.id];
      if (v && typeof v === 'object') {
        map[t.id] = {
          days: v.days != null ? v.days : 0,
          hours: v.hours != null ? v.hours : 0,
        };
      }
    }
  }
  // 相容舊欄
  if (
    (!src || !src.special) &&
    (user?.sl_used_days != null || user?.labor?.sl_used_days != null)
  ) {
    map.special = {
      days: user.sl_used_days ?? user.labor?.sl_used_days ?? 0,
      hours: user.sl_used_hours ?? user.labor?.sl_used_hours ?? 0,
    };
  }
  return map;
}

/** 各假別「可休天數」（手動；不依年資） */
function getLeaveEntitledMapFromUser(user) {
  const map = {};
  for (const t of MANUAL_LEAVE_TRACK) {
    map[t.id] = { days: 0 };
  }
  const src =
    user?.leave_entitled ||
    user?.labor?.leaveEntitledManual ||
    user?.labor?.leaveEntitled ||
    null;
  if (src && typeof src === 'object') {
    for (const t of MANUAL_LEAVE_TRACK) {
      const v = src[t.id];
      if (v == null) continue;
      if (typeof v === 'object') {
        map[t.id] = { days: v.days != null ? v.days : 0 };
      } else {
        map[t.id] = { days: v };
      }
    }
  }
  // 從 leaveBalances 回填（若已算過）
  const bals = user?.labor?.leaveBalances;
  if (Array.isArray(bals) && (!src || !Object.keys(src).length)) {
    for (const b of bals) {
      if (b?.id && map[b.id] && b.entitled != null) {
        map[b.id] = { days: b.entitled };
      }
    }
  }
  return map;
}

function renderManualLeaveUsedFields(user) {
  const usedMap = getLeaveUsedMapFromUser(user);
  const entMap = getLeaveEntitledMapFromUser(user);
  const rows = MANUAL_LEAVE_TRACK.map((t) => {
    // 特休以日為準，不填／不顯示已休小時
    const isSpecial = t.id === 'special';
    const hoursCell = isSpecial
      ? `<td style="padding:4px 6px;text-align:right;color:var(--muted,#64748b);font-size:0.82rem">—（以日計）
           <input type="hidden" name="lu_${t.id}_hours" value="0" />
         </td>`
      : `<td style="padding:4px 6px">
           <input name="lu_${t.id}_hours" type="number" min="0" step="0.5" inputmode="decimal"
             value="${esc(String(usedMap[t.id]?.hours ?? 0))}"
             style="width:100%;max-width:88px;text-align:right" placeholder="0" />
         </td>`;
    return `
    <tr>
      <td style="font-size:0.88rem;padding:6px 8px">${esc(t.name)}${
        isSpecial
          ? '<div class="muted" style="font-size:0.72rem">以日計算，不換算小時</div>'
          : ''
      }</td>
      <td style="padding:4px 6px">
        <input name="le_${t.id}_days" type="number" min="0" step="0.5" inputmode="decimal"
          value="${esc(String(entMap[t.id]?.days ?? 0))}"
          style="width:100%;max-width:88px;text-align:right" placeholder="0" />
      </td>
      <td style="padding:4px 6px">
        <input name="lu_${t.id}_days" type="number" min="0" step="0.5" inputmode="decimal"
          value="${esc(String(usedMap[t.id]?.days ?? 0))}"
          style="width:100%;max-width:88px;text-align:right" placeholder="0" />
      </td>
      ${hoursCell}
    </tr>`;
  }).join('');
  return `
    <div class="field" style="margin-top:4px">
      <label>各假別可休／已休（全部手動）</label>
      <p class="muted" style="margin:4px 0 8px;font-size:0.8rem;line-height:1.45">
        <strong>可休天數</strong>由人事手動設定（<strong>不依年資自動計算</strong>）。
        <strong>特休</strong>以<strong>日</strong>計算（不填小時）；其他假別可填已休天數／小時。
        試算已休＝手動已休＋本系統已核准。公傷／安胎／公假／補休無固定上限，不在此列。
      </p>
      <div class="table-wrap" style="max-height:320px;overflow:auto;border:1px solid var(--border);border-radius:8px">
        <table class="data" style="margin:0">
          <thead>
            <tr>
              <th style="text-align:left">假別</th>
              <th style="text-align:right;width:100px">可休天數</th>
              <th style="text-align:right;width:100px">已休天數</th>
              <th style="text-align:right;width:100px">已休小時</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

function collectLeaveUsedFromForm(fd) {
  const leave_used = {};
  const leave_entitled = {};
  for (const t of MANUAL_LEAVE_TRACK) {
    const days = String(fd.get(`lu_${t.id}_days`) ?? '0').trim() || '0';
    // 特休不使用已休小時
    const hours =
      t.id === 'special'
        ? '0'
        : String(fd.get(`lu_${t.id}_hours`) ?? '0').trim() || '0';
    const ent = String(fd.get(`le_${t.id}_days`) ?? '0').trim() || '0';
    leave_used[t.id] = { days, hours };
    leave_entitled[t.id] = { days: ent };
  }
  return {
    leave_used,
    leave_entitled,
    sl_used_days: leave_used.special?.days ?? '0',
    sl_used_hours: '0',
  };
}

const STATUS = {
  draft: { label: '草稿', cls: 'draft' },
  pending: { label: '簽核中', cls: 'pending' },
  returned: { label: '退回修改', cls: 'returned' },
  approved: { label: '已核准', cls: 'approved' },
  rejected: { label: '已駁回', cls: 'rejected' },
  cancelled: { label: '已取消', cls: 'cancelled' },
  voided: { label: '已作廢', cls: 'voided' },
};

const ACTION_LABEL = {
  submit: '送出申請',
  approve: '核准',
  reject: '駁回',
  cancel: '取消',
  return: '退回',
  comment: '留言',
  forward: '轉簽',
  cosign: '加簽',
  void: '作廢',
};

function htmlToPlainText(raw) {
  const s = String(raw ?? '');
  if (!s) return '';
  if (typeof RichEditor !== 'undefined' && RichEditor.htmlToPlain) {
    return String(RichEditor.htmlToPlain(s) || '').trim();
  }
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}

function toast(msg, type = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast ${type}`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), 2800);
}

/** 從 Content-Disposition 解析檔名（支援 filename*=UTF-8''） */
function parseContentDispositionFilename(cd) {
  if (!cd) return '';
  const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(cd);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^["']|["']$/g, ''));
    } catch {
      /* fall through */
    }
  }
  const plain = /filename\s*=\s*("?)([^";]+)\1/i.exec(cd);
  if (plain) return plain[2].trim();
  return '';
}

/**
 * 與後端一致：表單名稱_申請人_日期+五位流水號
 * 例：請假申請_王小明_2026071800012.pdf
 */
function buildApprovalDownloadFileName(request, { zip = false, hasAttachments } = {}) {
  const safe = (s, fb) => {
    const t = String(s || '')
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
      .replace(/\s+/g, '')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .trim()
      .slice(0, 40);
    return t || fb;
  };
  const form = safe(request?.workflow_name, '簽核申請');
  const applicant = safe(request?.requester_name, '申請人');
  let datePart = '';
  const raw = String(request?.created_at || request?.completed_at || '').replace(
    /\//g,
    '-'
  );
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) datePart = `${m[1]}${m[2]}${m[3]}`;
  else {
    const d = new Date();
    datePart = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(
      d.getDate()
    ).padStart(2, '0')}`;
  }
  const serial = String(Math.abs(Number(request?.id) || 0))
    .padStart(5, '0')
    .slice(-5);
  const base = `${form}_${applicant}_${datePart}${serial}`;
  if (!zip) return `${base}.pdf`;
  // 僅真有附件才加「_含附件」
  const withAtt =
    hasAttachments !== undefined
      ? !!hasAttachments
      : !!(request?.attachments && request.attachments.length);
  return withAtt ? `${base}_含附件.zip` : `${base}.zip`;
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const isForm = options.body instanceof FormData;
  if (options.body && !isForm) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }
  // FormData 勿手動設 Content-Type，瀏覽器會帶 boundary
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(API + path, { ...options, headers });
  const ct = res.headers.get('content-type') || '';
  if (
    ct.includes('application/pdf') ||
    ct.includes('application/zip') ||
    ct.includes('application/x-zip-compressed') ||
    ct.includes('application/octet-stream') ||
    (options.expectBlob && res.ok)
  ) {
    if (!res.ok) throw new Error('檔案下載失敗');
    const blob = await res.blob();
    if (options.returnMeta) {
      return {
        blob,
        filename: parseContentDispositionFilename(
          res.headers.get('Content-Disposition')
        ),
        contentType: ct,
      };
    }
    return blob;
  }
  // 附件下載可能是各種 mime
  if (options.expectBlob) {
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || '檔案下載失敗');
    }
    const blob = await res.blob();
    if (options.returnMeta) {
      return {
        blob,
        filename: parseContentDispositionFilename(
          res.headers.get('Content-Disposition')
        ),
        contentType: ct,
      };
    }
    return blob;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && state.token && !path.includes('/auth/login')) {
      logout(false);
    }
    throw new Error(data.error || `請求失敗 (${res.status})`);
  }
  return data;
}

function setAuth(token, user) {
  state.token = token;
  state.user = user;
  if (token) localStorage.setItem('approval_token', token);
  else localStorage.removeItem('approval_token');
}

function logout(showMsg = true) {
  stopPendingWatcher();
  setAuth('', null);
  state.page = 'dashboard';
  state.pageParams = {};
  showAuth();
  if (showMsg) toast('已登出');
}

// ---------- 待簽核桌面通知（登入中輪詢） ----------
const DESKTOP_NOTIFY_KEY = 'approval_desktop_notify_prefs';
const PENDING_POLL_DEFAULT_MS = 20000;
let pendingPollTimer = null;
let lastPendingMe = null; // null = 尚未初始化
let titleFlashTimer = null;
const originalDocumentTitle = () => {
  const name =
    (state.systemSettings && state.systemSettings.companyName) || '線上簽核系統';
  return name;
};

/** 桌面通知偏好（本機 localStorage，各瀏覽器／電腦獨立） */
function getDesktopNotifyPrefs() {
  const defaults = {
    enabled: true, // 允許系統推送桌面通知
    foreground: true, // 分頁在前景也顯示
    titleFlash: true, // 背景時標題閃爍
    pollSec: 20, // 輪詢秒數 10–120
  };
  try {
    const raw = localStorage.getItem(DESKTOP_NOTIFY_KEY);
    if (!raw) return { ...defaults };
    const o = JSON.parse(raw);
    const pollSec = Math.min(120, Math.max(10, Number(o.pollSec) || 20));
    return {
      enabled: o.enabled !== false,
      foreground: o.foreground !== false,
      titleFlash: o.titleFlash !== false,
      pollSec,
    };
  } catch {
    return { ...defaults };
  }
}

function saveDesktopNotifyPrefs(prefs) {
  const cur = getDesktopNotifyPrefs();
  const next = { ...cur, ...(prefs || {}) };
  next.pollSec = Math.min(120, Math.max(10, Number(next.pollSec) || 20));
  localStorage.setItem(DESKTOP_NOTIFY_KEY, JSON.stringify(next));
  return next;
}

function desktopNotifyPermissionLabel() {
  if (!('Notification' in window)) return { text: '此瀏覽器不支援', cls: 'danger' };
  const p = Notification.permission;
  if (p === 'granted') return { text: '已允許', cls: 'approved' };
  if (p === 'denied') return { text: '已封鎖（請至瀏覽器網站設定改為允許）', cls: 'rejected' };
  return { text: '尚未詢問', cls: 'pending' };
}

/** 請求瀏覽器桌面通知權限（需使用者手勢較可靠） */
async function ensureNotifyPermission(fromUserGesture = false) {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  // 自動登入無手勢時不強求；登入按鈕送出時再請求
  if (!fromUserGesture && Notification.permission === 'default') return false;
  try {
    const p = await Notification.requestPermission();
    return p === 'granted';
  } catch {
    return false;
  }
}

function stopTitleFlash() {
  if (titleFlashTimer) {
    clearInterval(titleFlashTimer);
    titleFlashTimer = null;
  }
  try {
    if (document.title.includes('待簽核') || document.title.startsWith('【')) {
      document.title = originalDocumentTitle();
    }
  } catch {
    /* ignore */
  }
}

/** 分頁在背景時閃爍標題，提醒有待簽核 */
function flashDocumentTitle(message) {
  stopTitleFlash();
  const prefs = getDesktopNotifyPrefs();
  if (!prefs.titleFlash) return;
  if (!document.hidden) return;
  const orig = document.title || originalDocumentTitle();
  let i = 0;
  titleFlashTimer = setInterval(() => {
    document.title = i % 2 === 0 ? message : orig;
    i += 1;
    if (i >= 12) stopTitleFlash();
  }, 1000);
}

function showDesktopNotification(title, body, onClick) {
  const prefs = getDesktopNotifyPrefs();
  if (!prefs.enabled) {
    // 仍可用 toast；標題閃爍視偏好
    if (prefs.titleFlash) flashDocumentTitle(`【待簽核】${body}`);
    return;
  }
  // 前景且未勾「前景也顯示」→ 僅 toast（呼叫端另處理）
  const inFg = !document.hidden;
  try {
    if (
      'Notification' in window &&
      Notification.permission === 'granted' &&
      (!inFg || prefs.foreground)
    ) {
      const n = new Notification(title, {
        body,
        tag: 'approval-pending',
        renotify: true,
        requireInteraction: false,
      });
      n.onclick = () => {
        try {
          window.focus();
        } catch {
          /* ignore */
        }
        if (typeof onClick === 'function') onClick();
        n.close();
      };
      // 自動關閉，避免通知堆太多
      setTimeout(() => {
        try {
          n.close();
        } catch {
          /* ignore */
        }
      }, 12000);
    }
  } catch (e) {
    console.warn('desktop notification failed', e);
  }
  flashDocumentTitle(`【待簽核】${body}`);
}

function stopPendingWatcher() {
  if (pendingPollTimer) {
    clearInterval(pendingPollTimer);
    pendingPollTimer = null;
  }
  lastPendingMe = null;
  stopTitleFlash();
}

function startPendingWatcher(opts = {}) {
  const { requestPermission = false } = opts;
  stopPendingWatcher();
  const prefs = getDesktopNotifyPrefs();
  if (requestPermission && prefs.enabled) {
    // 不 await，避免卡住 UI
    ensureNotifyPermission(true);
  } else {
    ensureNotifyPermission(false);
  }
  // 立即檢查一次 + 定期輪詢（僅登入中）
  refreshBadge({ allowNotify: true });
  const pollMs = (prefs.pollSec || 20) * 1000;
  pendingPollTimer = setInterval(() => {
    if (!state.token || !state.user) {
      stopPendingWatcher();
      return;
    }
    refreshBadge({ allowNotify: true });
  }, pollMs);

  // 回到分頁時停止標題閃爍
  document.removeEventListener('visibilitychange', onVisibilityForNotify);
  document.addEventListener('visibilitychange', onVisibilityForNotify);
}

function onVisibilityForNotify() {
  if (!document.hidden) stopTitleFlash();
}

function showAuth() {
  $('#auth-view').classList.remove('hidden');
  $('#main-view').classList.add('hidden');
}

function isAdmin() {
  return state.user?.role === 'admin';
}

/** 是否為系統內建 Admin 帳號（username=admin，不分大小寫） */
function isBuiltinAdmin(user = state.user) {
  return String(user?.username || '').trim().toLowerCase() === 'admin';
}

function isBuiltinAdminUser(u) {
  return !!(u && (u.isBuiltinAdmin || isBuiltinAdmin(u)));
}

const THEMES = [
  {
    id: 'navy',
    name: '🌊 經典藍調',
    vars: {
      '--primary': '#2563eb',
      '--primary-hover': '#1d4ed8',
      '--sidebar': '#0b192c',
      '--sidebar-2': '#1e3e62',
      '--bg': '#f1f5f9',
      '--surface': '#ffffff',
      '--text': '#0f172a',
      '--text-heading': '#0f172a',
      '--muted': '#64748b',
      '--border': '#cbd5e1',
      '--input-bg': '#ffffff',
    },
  },
  {
    id: 'dark',
    name: '🌙 暗黑夜空',
    vars: {
      '--primary': '#3b82f6',
      '--primary-hover': '#60a5fa',
      '--sidebar': '#0f172a',
      '--sidebar-2': '#1e293b',
      '--bg': '#090d16',
      '--surface': '#151d2a',
      '--text': '#e2e8f0',
      '--text-heading': '#f8fafc',
      '--muted': '#94a3b8',
      '--border': '#2a3649',
      '--input-bg': '#1e293b',
    },
  },
  {
    id: 'emerald',
    name: '🌲 翡翠森林',
    vars: {
      '--primary': '#059669',
      '--primary-hover': '#047857',
      '--sidebar': '#064e3b',
      '--sidebar-2': '#047857',
      '--bg': '#f0fdf4',
      '--surface': '#ffffff',
      '--text': '#064e3b',
      '--text-heading': '#022c22',
      '--muted': '#374151',
      '--border': '#a7f3d0',
      '--input-bg': '#ffffff',
    },
  },
  {
    id: 'violet',
    name: '💜 皇家紫羅蘭',
    vars: {
      '--primary': '#7c3aed',
      '--primary-hover': '#6d28d9',
      '--sidebar': '#2e1065',
      '--sidebar-2': '#4c1d95',
      '--bg': '#f5f3ff',
      '--surface': '#ffffff',
      '--text': '#2e1065',
      '--text-heading': '#1e1b4b',
      '--muted': '#6b7280',
      '--border': '#ddd6fe',
      '--input-bg': '#ffffff',
    },
  },
  {
    id: 'amber',
    name: '🌅 暖陽日暮',
    vars: {
      '--primary': '#d97706',
      '--primary-hover': '#b45309',
      '--sidebar': '#451a03',
      '--sidebar-2': '#78350f',
      '--bg': '#fffbeb',
      '--surface': '#ffffff',
      '--text': '#451a03',
      '--text-heading': '#292524',
      '--muted': '#57534e',
      '--border': '#fde68a',
      '--input-bg': '#ffffff',
    },
  },
  {
    id: 'rose',
    name: '🌸 櫻花石榴',
    vars: {
      '--primary': '#e11d48',
      '--primary-hover': '#be123c',
      '--sidebar': '#4c0519',
      '--sidebar-2': '#881337',
      '--bg': '#fff1f2',
      '--surface': '#ffffff',
      '--text': '#4c0519',
      '--text-heading': '#881337',
      '--muted': '#64748b',
      '--border': '#fecdd3',
      '--input-bg': '#ffffff',
    },
  },
];

function applyUserTheme(themeId, save = false) {
  const theme = THEMES.find((t) => t.id === themeId) || THEMES[0];
  const root = document.documentElement;
  Object.entries(theme.vars).forEach(([key, val]) => {
    root.style.setProperty(key, val);
  });
  if (save) {
    try {
      localStorage.setItem('approval_user_theme', theme.id);
    } catch (_) {}
  }
  return theme;
}

function initUserTheme() {
  try {
    const saved = localStorage.getItem('approval_user_theme') || 'navy';
    applyUserTheme(saved, false);
  } catch (_) {}
}

function updateAppWatermark() {
  const overlay = document.getElementById('app-watermark-overlay');
  if (overlay) overlay.remove();
}

function hasPerm(permId) {
  if (isAdmin()) return true;
  const list = state.user?.permissions;
  return Array.isArray(list) && list.includes(permId);
}

/**
 * 財務部／授信額度建檔人員（僅財務）
 * 「確認完成額度建檔」僅財務可見；總經理／一般 admin 不會因最高權限而顯示。
 */
function isFinanceStaffUser(u) {
  const user = u || state.user;
  if (!user) return false;
  if (user.department === '財務部') return true;
  if (Array.isArray(user.departments) && user.departments.includes('財務部')) {
    return true;
  }
  if (user.username === 'Gigi' || user.name === '張美雯') return true;
  if (user.username === 'Joan' || user.name === '詹慈敏') return true;
  if (user.role !== 'admin' && hasPerm('finance_confirm')) return true;
  return false;
}

/** 載入並套用系統品牌（公司名稱／Logo） */
async function loadSystemSettings() {
  try {
    const s = await api('/api/system/settings');
    state.systemSettings = s || {};
    applySystemBranding(s);
    return s;
  } catch {
    state.systemSettings = state.systemSettings || {
      companyName: '線上簽核系統',
      logoUrl: '/img/argo-logo.png',
    };
    applySystemBranding(state.systemSettings);
    return state.systemSettings;
  }
}

/** 依副檔名推斷 favicon MIME */
function faviconTypeFromUrl(url) {
  const path = String(url || '').split('?')[0].toLowerCase();
  if (path.endsWith('.svg')) return 'image/svg+xml';
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
  if (path.endsWith('.gif')) return 'image/gif';
  if (path.endsWith('.webp')) return 'image/webp';
  if (path.endsWith('.ico')) return 'image/x-icon';
  return 'image/png';
}

/** 頁籤圖標改為公司 Logo（系統設定上傳後會同步更新） */
function applyFavicon(logoUrl) {
  const href = logoUrl || '/img/argo-logo.png';
  const type = faviconTypeFromUrl(href);
  const ids = ['app-favicon', 'app-favicon-shortcut', 'app-favicon-apple'];
  for (const id of ids) {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('link');
      el.id = id;
      if (id === 'app-favicon') el.rel = 'icon';
      else if (id === 'app-favicon-shortcut') el.rel = 'shortcut icon';
      else el.rel = 'apple-touch-icon';
      document.head.appendChild(el);
    }
    if (id !== 'app-favicon-apple') el.type = type;
    // 強制換新 href 以突破瀏覽器 favicon 快取
    el.href = href;
  }
}

function applySystemBranding(s) {
  const settings = s || state.systemSettings || {};
  const name = settings.companyName || '線上簽核系統';
  const logoUrl = settings.logoUrl || '/img/argo-logo.png';
  // 只顯示主版號（例如 v1.1.0），不顯示建置指紋
  const verNum = String(settings.version || settings.versionLabel || '')
    .replace(/^v/i, '')
    .split('+')[0]
    .trim();
  const verLabel = verNum ? `v${verNum}` : '';

  document.title = verLabel ? `${name} · 線上簽核 ${verLabel}` : `${name} · 線上簽核`;
  applyFavicon(logoUrl);
  // 登入頁
  const authLogo = document.querySelector('.brand-logo-auth');
  if (authLogo) {
    authLogo.src = logoUrl;
    authLogo.alt = name;
  }
  const heroLogo = document.querySelector('.brand-logo-auth-hero');
  if (heroLogo) {
    heroLogo.src = logoUrl;
    heroLogo.alt = name;
  }
  const heroCompany = document.querySelector('.hero-company');
  if (heroCompany) heroCompany.textContent = name;
  const authCompany = document.querySelector('.auth-brand .company-name');
  if (authCompany) authCompany.textContent = name;
  // h1 固定為「線上簽核」，不覆寫
  // 版本宣告（登入頁／側欄左下：僅版號）
  const authVer = document.getElementById('auth-version');
  if (authVer && verLabel) {
    authVer.textContent = verLabel;
    authVer.title = verLabel;
  }
  const authVerFoot = document.getElementById('auth-version-foot');
  if (authVerFoot) {
    authVerFoot.textContent = verLabel ? `${name} ${verLabel}` : name;
    authVerFoot.title = verLabel || name;
  }
  const sideVer = document.getElementById('sidebar-version');
  if (sideVer && verLabel) {
    sideVer.textContent = verLabel;
    sideVer.title = verLabel;
  }
  // 側欄
  const sideLogo = document.querySelector('.brand-logo-side');
  if (sideLogo) {
    sideLogo.src = logoUrl;
    sideLogo.alt = name;
  }
  const sideName = document.querySelector('.sidebar-brand .company-name-sm');
  if (sideName) sideName.textContent = name;
  const sideStrong = document.querySelector('.sidebar-brand-text strong');
  if (sideStrong) sideStrong.textContent = name.length > 8 ? '線上簽核' : name;
}

const DEFAULT_COMMENT_PHRASES = [
  '同意',
  '核可',
  '准予備查',
  '依規定辦理',
  '請檢附單據正本',
  '依規定核銷',
];

function getCommentPhrases() {
  const list = (state.user && state.user.comment_phrases) || [];
  if (Array.isArray(list) && list.length) {
    return list.map((s) => String(s || '').trim()).filter(Boolean);
  }
  return DEFAULT_COMMENT_PHRASES.slice();
}

function commentPhraseButtonsHtml(textareaId) {
  const phrases = getCommentPhrases();
  return `<div class="comment-phrase-chips" style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap" data-phrase-target="${esc(
    textareaId
  )}">
    ${phrases
      .map(
        (p) =>
          `<button type="button" class="btn outline xs btn-quick-opinion" data-val="${esc(p)}">${esc(
            p
          )}</button>`
      )
      .join('')}
  </div>`;
}

function bindCommentPhraseChips(root) {
  (root || document).querySelectorAll('.btn-quick-opinion').forEach((btn) => {
    btn.onclick = () => {
      const wrap = btn.closest('[data-phrase-target]');
      const id = (wrap && wrap.dataset.phraseTarget) || '';
      const ta = id
        ? document.getElementById(id)
        : document.getElementById('action-comment') ||
          document.getElementById('bulk-approve-comment');
      if (ta) ta.value = btn.dataset.val || '';
    };
  });
}

function downloadBlobFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** 人事／備份：可進入備份資料（含下載請假申請單） */
function canAccessBackupsPage() {
  return hasPerm('backups') || hasPerm('leave_report') || hasPerm('leave_delete');
}

/** 人事：可批次查詢／下載請假申請單 PDF */
function canDownloadLeaveForms() {
  return hasPerm('leave_report') || hasPerm('leave_delete') || hasPerm('backups');
}

/** 依角色／權限顯示選單 */
function applyRoleUi() {
  const admin = isAdmin();
  $$('.admin-only').forEach((el) => {
    el.classList.toggle('hidden', !admin);
  });
  $$('.perm-nav').forEach((el) => {
    const p = el.dataset.perm;
    if (p === 'backups') {
      el.classList.toggle('hidden', !canAccessBackupsPage());
      return;
    }
    el.classList.toggle('hidden', !(p && hasPerm(p)));
  });
  // 系統設定／稽核日誌：僅內建 Admin 帳號可見（其他最高權限也看不到）
  const sysNav = document.querySelector('[data-page="system-settings"]');
  if (sysNav) sysNav.classList.toggle('hidden', !isBuiltinAdmin());
  const auditNav = document.querySelector('[data-page="audit-logs"]');
  if (auditNav) auditNav.classList.toggle('hidden', !isBuiltinAdmin());
}

/**
 * 解析網址 hash 深連結（Email 通知用）
 * 支援：#detail/123、#/detail/123、#detail?id=123
 */
const ROUTE_PAGES = [
  'dashboard',
  'inbox',
  'mine',
  'records',
  'new-request',
  'workflows',
  'backups',
  'leave-report',
  'audit-logs',
  'users',
  'departments',
  'settings',
  'line-settings',
  'system-settings',
  'detail',
];

const LAST_ROUTE_KEY = 'approval-last-route';
const REQUEST_STATUS_FILTERS = ['draft', 'pending', 'returned', 'approved', 'rejected', 'cancelled', 'voided'];

function normalizeRequestStatus(s) {
  const v = String(s || '').trim().toLowerCase();
  return REQUEST_STATUS_FILTERS.includes(v) ? v : '';
}

function minePageTitle(params = {}) {
  const st = normalizeRequestStatus(params.status);
  if (st === 'pending') return '我的進行中';
  if (st === 'approved') return '我已完成';
  return '我的申請';
}

function parseRouteFromHash(hash = location.hash) {
  const raw = String(hash || '').replace(/^#\/?/, '').trim();
  if (!raw) return null;
  let m = raw.match(/^detail\/(\d+)\b/i);
  if (m) return { page: 'detail', params: { id: Number(m[1]) } };
  m = raw.match(/^detail\?(?:.*&)?id=(\d+)/i);
  if (m) return { page: 'detail', params: { id: Number(m[1]) } };
  m = raw.match(/^requests?\/(\d+)\b/i);
  if (m) return { page: 'detail', params: { id: Number(m[1]) } };
  const qIndex = raw.indexOf('?');
  const pageOnly = (qIndex >= 0 ? raw.slice(0, qIndex) : raw).split('/')[0];
  if (pageOnly && ROUTE_PAGES.includes(pageOnly) && pageOnly !== 'detail') {
    const params = {};
    if (qIndex >= 0) {
      const sp = new URLSearchParams(raw.slice(qIndex + 1));
      if (pageOnly === 'mine') {
        const st = normalizeRequestStatus(sp.get('status'));
        if (st) params.status = st;
      }
      if (pageOnly === 'new-request') {
        if (sp.get('cloneFrom')) params.cloneFrom = Number(sp.get('cloneFrom'));
        if (sp.get('workflowId')) params.workflowId = Number(sp.get('workflowId'));
        if (sp.get('draftId')) params.draftId = Number(sp.get('draftId'));
      }
    }
    return { page: pageOnly, params };
  }
  return null;
}

/** 由 page + params 組成 hash（含總覽 #dashboard，重新整理可還原） */
function buildRouteHash(page, params = {}) {
  if (page === 'detail' && params.id) return `#detail/${params.id}`;
  if (page === 'mine') {
    const st = normalizeRequestStatus(params.status);
    return st ? `#mine?status=${encodeURIComponent(st)}` : '#mine';
  }
  if (page === 'new-request') {
    const p = new URLSearchParams();
    if (params.cloneFrom) p.set('cloneFrom', params.cloneFrom);
    if (params.workflowId) p.set('workflowId', params.workflowId);
    if (params.draftId) p.set('draftId', params.draftId);
    const qs = p.toString();
    return qs ? `#new-request?${qs}` : '#new-request';
  }
  if (page && ROUTE_PAGES.includes(page) && page !== 'detail') return `#${page}`;
  return '#dashboard';
}

function routeParamsToStore(page, params = {}) {
  const out = {};
  if (params && params.id) out.id = Number(params.id);
  if (page === 'mine') {
    const st = normalizeRequestStatus(params && params.status);
    if (st) out.status = st;
  }
  if (page === 'new-request') {
    if (params && params.cloneFrom) out.cloneFrom = Number(params.cloneFrom);
    if (params && params.workflowId) out.workflowId = Number(params.workflowId);
    if (params && params.draftId) out.draftId = Number(params.draftId);
  }
  return out;
}

function saveLastRoute(page, params = {}) {
  try {
    sessionStorage.setItem(
      LAST_ROUTE_KEY,
      JSON.stringify({
        page,
        params: routeParamsToStore(page, params),
        at: Date.now(),
      })
    );
  } catch {
    /* private mode */
  }
}

function loadLastRoute() {
  try {
    const raw = sessionStorage.getItem(LAST_ROUTE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || !o.page || !ROUTE_PAGES.includes(o.page)) return null;
    if (o.page === 'detail') {
      const id = Number(o.params && o.params.id);
      if (!id) return null;
      return { page: 'detail', params: { id } };
    }
    if (o.page === 'mine') {
      const st = normalizeRequestStatus(o.params && o.params.status);
      return { page: 'mine', params: st ? { status: st } : {} };
    }
    if (o.page === 'new-request') {
      return { page: 'new-request', params: o.params || {} };
    }
    return { page: o.page, params: {} };
  } catch {
    return null;
  }
}

/**
 * 同步網址 hash（重新整理／書籤／Email 深連結用）
 * 一律使用 pathname+search+hash，避免只寫 #xxx 在部分環境失效
 */
function syncRouteHash(page, params = {}) {
  const wantHash = buildRouteHash(page, params);
  const base = `${location.pathname}${location.search || ''}`;
  const wantUrl = `${base}${wantHash}`;
  const curUrl = `${location.pathname}${location.search || ''}${location.hash || ''}`;
  if (curUrl === wantUrl || location.hash === wantHash) {
    saveLastRoute(page, params);
    return;
  }
  try {
    history.replaceState(null, '', wantUrl);
  } catch {
    try {
      location.hash = wantHash.slice(1) ? wantHash : 'dashboard';
    } catch {
      /* ignore */
    }
  }
  saveLastRoute(page, params);
}

/** 依目前 hash 或 session 還原導向（已登入時）；成功回 true */
function applyRouteFromHash(opts = {}) {
  if (!state.token) return false;
  const fromHash = parseRouteFromHash();
  const fromSession = opts.allowSession === false ? null : loadLastRoute();
  const route = fromHash || fromSession;
  if (!route) return false;
  navigate(route.page, route.params || {}, { skipHashSync: false, fromRestore: true });
  return true;
}

function showMain(opts = {}) {
  const av = $('#auth-view');
  if (av) av.classList.add('hidden');
  const mv = $('#main-view');
  if (mv) mv.classList.remove('hidden');
  const u = state.user;
  if (u) {
    const un = $('#user-name');
    if (un) un.textContent = u.name;
    const ur = $('#user-role');
    if (ur) ur.textContent = u.role === 'admin' ? '系統管理員' : (u.department || '一般使用者');
    const ua = $('#user-avatar');
    if (ua) ua.textContent = (u.name || 'U').slice(0, 1);
  }
  applyRoleUi();
  loadSystemSettings().catch(() => {});
  // 優先網址 hash（Email／重新整理）；其次 session 記住的頁面；否則總覽
  if (!window.__legacyManualBoot) {
    if (!applyRouteFromHash({ allowSession: true })) {
      state.page = 'dashboard';
      state.pageParams = {};
      navigate('dashboard');
    }
  }
  // 登入期間輪詢待簽核，有新件即桌面通知
  startPendingWatcher({ requestPermission: !!opts.requestPermission });
}

/**
 * 更新待簽核角標；allowNotify 時若件數增加則發桌面通知
 */
async function refreshBadge(opts = {}) {
  const allowNotify = !!opts.allowNotify;
  try {
    const { stats } = await api('/api/stats');
    const count = Number(stats.pendingMe) || 0;
    const b = $('#badge-pending');
    if (count > 0) {
      b.textContent = String(count);
      b.classList.remove('hidden');
    } else {
      b.classList.add('hidden');
    }

    if (allowNotify && state.token && state.user) {
      if (lastPendingMe === null) {
        // 剛登入：若已有待簽核，通知一次
        if (count > 0) {
          showDesktopNotification(
            '線上簽核系統',
            `您有 ${count} 件待簽核文件，請儘速處理`,
            () => navigate('inbox')
          );
          toast(`您有 ${count} 件待簽核文件`, 'info');
        }
      } else if (count > lastPendingMe) {
        const added = count - lastPendingMe;
        showDesktopNotification(
          '線上簽核系統 · 新待簽核',
          `新增 ${added} 件待簽核，目前共 ${count} 件`,
          () => navigate('inbox')
        );
        toast(`新增 ${added} 件待簽核文件`, 'info');
      }
      lastPendingMe = count;
    } else if (lastPendingMe !== null) {
      // 手動刷新角標時同步件數，避免之後誤判「新增」
      lastPendingMe = count;
    }
  } catch {
    /* ignore */
  }
}

function statusTag(status) {
  const s = STATUS[status] || { label: status, cls: '' };
  return `<span class="tag ${s.cls}">${s.label}</span>`;
}

function openModal(html) {
  const modal = $('#modal');
  if (modal) {
    modal.classList.remove('hidden', 'modal-oo-open');
  }
  const panel = $('#modal-panel');
  panel.className = 'modal-panel';
  panel.innerHTML = html;
}
function closeModal() {
  try {
    if (onlyOfficeEditorInstance && typeof onlyOfficeEditorInstance.destroyEditor === 'function') {
      onlyOfficeEditorInstance.destroyEditor();
    }
  } catch {
    /* ignore */
  }
  onlyOfficeEditorInstance = null;
  const modal = $('#modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('modal-oo-open');
  }
  const panel = $('#modal-panel');
  if (panel) {
    panel.className = 'modal-panel';
    panel.innerHTML = '';
  }
}

// ---------- Pages ----------
const titles = {
  dashboard: '總覽',
  inbox: '待我簽核',
  mine: '我的申請',
  records: '簽核紀錄',
  'new-request': '新增申請',
  workflows: '簽核流程',
  backups: '備份資料',
  'leave-report': '請假報表',
  'audit-logs': '系統稽核日誌',
  users: '成員名單',
  departments: '部門',
  settings: '帳號設定',
  'system-settings': '系統設定',
  detail: '簽核詳情',
};

async function navigate(page, params = {}, navOpts = {}) {
  if (page === 'system-settings' && !isBuiltinAdmin()) {
    toast('僅系統內建 Admin 帳號可進入系統設定', 'error');
    page = 'dashboard';
    params = {};
  }
  if (page === 'workflows' && !hasPerm('workflows')) {
    toast('您沒有「管理簽核流程」權限', 'error');
    page = 'dashboard';
    params = {};
  }
  if (page === 'backups' && !canAccessBackupsPage()) {
    toast('您沒有「備份資料」或人事請假相關權限', 'error');
    page = 'dashboard';
    params = {};
  }
  if (page === 'leave-report' && !hasPerm('leave_report')) {
    toast('您沒有「請假報表匯出」權限', 'error');
    page = 'dashboard';
    params = {};
  }
  if (page === 'audit-logs' && !isBuiltinAdmin()) {
    toast('僅系統內建 Admin 帳號可查看稽核日誌', 'error');
    page = 'dashboard';
    params = {};
  }
  // 部門：僅系統管理員；成員名單：管理員或「成員休假已休管理」權限
  if (page === 'departments' && !isAdmin()) {
    toast('僅系統管理員可進入「部門」', 'error');
    page = 'dashboard';
    params = {};
  }
  if (page === 'users' && !hasPerm('users_leave')) {
    toast('您沒有「成員名單／休假已休」權限', 'error');
    page = 'dashboard';
    params = {};
  }
  if (page === 'detail' && !params.id) {
    page = 'dashboard';
    params = {};
  }
  state.page = page;
  state.pageParams = params || {};
  // 同步網址 hash：所有頁面（含總覽）皆寫入，重新整理可留在同一項目
  if (!navOpts.skipHashSync) {
    syncRouteHash(page, state.pageParams);
  } else {
    saveLastRoute(page, state.pageParams);
  }
  applyRoleUi();
  $$('.nav-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.page === page);
  });
  $('#page-title').textContent =
    page === 'mine' ? minePageTitle(params) : titles[page] || '線上簽核';
  $('#page-actions').innerHTML = '';
  const body = $('#page-body');
  if (typeof window.__unmountNativePage === 'function') window.__unmountNativePage();
  body.innerHTML = '<div class="muted">載入中…</div>';
  const nativeRender = window.__nativePages && window.__nativePages[page];
  try {
    if (nativeRender) await nativeRender(body, params, page);
    else if (page === 'dashboard') await renderDashboard(body);
    else if (page === 'inbox') await renderRequestList(body, 'pending_me');
    else if (page === 'mine') await renderRequestList(body, 'mine');
    else if (page === 'records') await renderRequestList(body, 'related');
    else if (page === 'new-request') await renderNewRequest(body);
    else if (page === 'workflows') await renderWorkflows(body);
    else if (page === 'backups') await renderBackups(body);
    else if (page === 'leave-report') await renderLeaveReport(body);
    else if (page === 'audit-logs') await renderAuditLogs(body);
    else if (page === 'users') await renderUsers(body);
    else if (page === 'departments') await renderDepartments(body);
    else if (page === 'settings') await renderSettings(body);
    else if (page === 'system-settings') await renderSystemSettings(body);
    else if (page === 'detail') await renderDetail(body, params.id);
  } catch (e) {
    body.innerHTML = `<div class="error-msg">${esc(e.message)}</div>`;
  }
  refreshBadge();
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getFavWorkflowKey() {
  const uid = state.user?.id || 'guest';
  return `approval_fav_workflows_${uid}`;
}

function getDefaultFavWorkflowIds(allWorkflows = []) {
  const COMMON_FORM_PATTERNS = [
    /請假/,
    /費用報支|報銷|請款/,
    /請購|採購/,
    /電腦異常報修|報修/,
    /出差/,
    /延長工時|加班/,
    /一般簽呈/,
    /信用額度/
  ];
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

function getFavWorkflowIds(allWorkflows = []) {
  const raw = localStorage.getItem(getFavWorkflowKey());
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

function saveFavWorkflowIds(ids) {
  localStorage.setItem(getFavWorkflowKey(), JSON.stringify(ids.map(Number)));
}

function resetFavWorkflowIds() {
  localStorage.removeItem(getFavWorkflowKey());
}

function openCustomizeCommonFormsModal(allWorkflows = [], onSaved = null) {
  let currentFavIds = new Set(getFavWorkflowIds(allWorkflows));

  const sorted = [...allWorkflows].sort((a, b) => {
    return (a.category || '').localeCompare(b.category || '') || a.name.localeCompare(b.name);
  });

  openModal(`
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <h3 style="margin:0">⭐ 自訂常用申請表單</h3>
      <button type="button" class="btn text sm" id="modal-fav-reset-btn" style="color:var(--primary);cursor:pointer">恢復系統預設推薦</button>
    </div>
    <p class="muted" style="margin:0 0 12px;font-size:0.85rem;line-height:1.5">
      勾選您平時最常送出的表單，將置頂顯示於「總覽」常用表單區，方便一鍵快速填寫。
    </p>
    <div style="margin-bottom:10px">
      <input type="text" id="modal-fav-search" placeholder="🔍 搜尋表單名稱或分類..." style="width:100%" />
    </div>
    <div style="max-height:360px;overflow-y:auto;border:1px solid var(--border);border-radius:10px;padding:6px" id="modal-fav-list">
      ${sorted
        .map((w) => {
          const isChecked = currentFavIds.has(w.id);
          const icon = getWorkflowIcon(w.name, w.category);
          const catCls = getCategoryClass(w.category);
          return `
          <label class="modal-fav-item" data-wf-id="${w.id}" data-name="${esc(w.name.toLowerCase())}" data-cat="${esc((w.category || '').toLowerCase())}" style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;cursor:pointer;transition:background 0.15s">
            <input type="checkbox" class="modal-fav-cb" value="${w.id}" ${isChecked ? 'checked' : ''} style="transform:scale(1.15);cursor:pointer" />
            <span style="font-size:1.25rem">${icon}</span>
            <div style="flex:1;min-width:0">
              <strong style="font-size:0.92rem;color:var(--text-heading)">${esc(w.name)}</strong>
              <span class="catalog-category-tag sm ${catCls}" style="margin-left:6px;vertical-align:middle">${esc(w.category || '一般簽呈')}</span>
            </div>
            <span class="modal-fav-badge muted" style="font-size:0.8rem">${isChecked ? '已選中' : ''}</span>
          </label>
        `;
        })
        .join('')}
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:14px">
      <span style="font-size:0.88rem;color:#64748b">
        已選取 <strong id="modal-fav-count" style="color:var(--primary)">${currentFavIds.size}</strong> 項
      </span>
      <div style="display:flex;gap:8px">
        <button type="button" class="btn outline" data-close-modal>取消</button>
        <button type="button" class="btn primary" id="modal-fav-save-btn">儲存設定</button>
      </div>
    </div>
  `);

  const countEl = $('#modal-fav-count');
  const searchInp = $('#modal-fav-search');
  const items = $$('.modal-fav-item');

  searchInp?.addEventListener('input', () => {
    const q = searchInp.value.trim().toLowerCase();
    items.forEach((item) => {
      const match = !q || item.dataset.name.includes(q) || item.dataset.cat.includes(q);
      item.style.display = match ? 'flex' : 'none';
    });
  });

  const updateCount = () => {
    const selected = $$('.modal-fav-cb:checked').map((c) => Number(c.value));
    if (countEl) countEl.textContent = selected.length;
    items.forEach((item) => {
      const cb = item.querySelector('.modal-fav-cb');
      const badge = item.querySelector('.modal-fav-badge');
      if (cb && badge) {
        badge.textContent = cb.checked ? '已選中' : '';
        item.style.background = cb.checked ? 'rgba(59, 130, 246, 0.06)' : '';
      }
    });
  };

  updateCount();

  items.forEach((item) => {
    const cb = item.querySelector('.modal-fav-cb');
    cb?.addEventListener('change', updateCount);
  });

  $('#modal-fav-reset-btn')?.addEventListener('click', () => {
    const defIds = new Set(getDefaultFavWorkflowIds(allWorkflows));
    items.forEach((item) => {
      const cb = item.querySelector('.modal-fav-cb');
      if (cb) {
        cb.checked = defIds.has(Number(cb.value));
      }
    });
    updateCount();
    toast('已還原為系統預設推薦選項（請點儲存設定生效）', 'info');
  });

  $('#modal-fav-save-btn')?.addEventListener('click', () => {
    const selected = $$('.modal-fav-cb:checked').map((c) => Number(c.value));
    saveFavWorkflowIds(selected);
    closeModal();
    toast('常用申請表單已更新', 'success');
    if (typeof onSaved === 'function') onSaved(selected);
  });
}


// ---------- Boot ----------
function collectWorkflowDeptNames(extra = []) {
  const fromApi = (state.departments || [])
    .map((d) => (d && typeof d === 'object' ? d.name : d))
    .map((n) => String(n || '').trim())
    .filter(Boolean);
  const fromUsers = (state.users || [])
    .flatMap((u) => {
      const list = Array.isArray(u.departments) ? u.departments.slice() : [];
      if (u.department) list.push(u.department);
      return list;
    })
    .map((n) => String(n || '').trim())
    .filter(Boolean);
  const extraNames = (Array.isArray(extra) ? extra : [])
    .map((n) => String(n || '').trim())
    .filter(Boolean);
  return [...new Set(['人事單位', ...fromApi, ...fromUsers, ...extraNames])];
}

async function loadDepartmentOptions() {
  try {
    const { departments } = await api('/api/departments');
    state.departments = departments;
    const sel = $('#register-department');
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML =
      '<option value="">請選擇部門…</option>' +
      departments.map((d) => `<option value="${esc(d.name)}">${esc(d.name)}</option>`).join('');
    if (current) sel.value = current;
  } catch {
    /* ignore on auth screen offline */
  }
}

function bindAuthUI() {
  const loginForm = $('#login-form');
  if (loginForm) {
    loginForm.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        const data = await api('/api/auth/login', {
          method: 'POST',
          body: { username: fd.get('username'), password: fd.get('password') },
        });
        setAuth(data.token, data.user);
        // 登入手勢下請求桌面通知權限
        showMain({ requestPermission: true });
        toast(`歡迎，${data.user.name}`, 'success');
      } catch (err) {
        const el = $('#auth-error');
        if (el) {
          el.textContent = err.message;
          el.classList.remove('hidden');
        }
      }
    };
  }

  $$('.nav-item').forEach((el) => {
    el.onclick = () => navigate(el.dataset.page);
  });
  const logoutBtn = $('#btn-logout');
  if (logoutBtn) {
    logoutBtn.onclick = () => logout();
  }

  // 全域委派點擊：確保動態渲染或 Vue 宿主內的 .nav-item 永遠可以點擊導向
  if (!window.__navDelegationBound) {
    window.__navDelegationBound = true;
    document.addEventListener('click', (e) => {
      if (e.target.matches('[data-close-modal]')) closeModal();
      const navBtn = e.target.closest('.nav-item');
      if (navBtn && navBtn.dataset && navBtn.dataset.page) {
        if (navBtn.tagName === 'BUTTON' || !navBtn.getAttribute('href')) {
          e.preventDefault();
          navigate(navBtn.dataset.page);
        }
      }
    });
  }

  // Email／書籤／重新整理：已登入時 hash 變更導向對應頁
  if (!window.__hashChangeBound) {
    window.__hashChangeBound = true;
    window.addEventListener('hashchange', () => {
      if (!state.token) return;
      const route = parseRouteFromHash();
      if (!route) {
        // 空 hash 視為總覽
        if (state.page !== 'dashboard') navigate('dashboard');
        return;
      }
      if (
        route.page === state.page &&
        String(route.params?.id || '') === String(state.pageParams?.id || '') &&
        String(route.params?.status || '') === String(state.pageParams?.status || '')
      ) {
        return;
      }
      navigate(route.page, route.params || {});
    });
  }
}

async function boot() {
  initUserTheme();
  updateAppWatermark();
  // 僅在無 token 且非 Vue 宿主時才主動切至 auth-view，避免覆蓋畫面或產生空白
  if (!state.token && !window.__legacyManualBoot) {
    try {
      showAuth();
    } catch (e) {
      console.error('showAuth', e);
    }
  }
  try {
    bindAuthUI();
  } catch (e) {
    console.error('bindAuthUI', e);
  }
  // 登入頁也套用公司名稱／Logo（公開 API）
  loadSystemSettings().catch(() => {});
  loadDepartmentOptions();
  if (!state.token) {
    return;
  }
  try {
    const { user } = await api('/api/auth/me');
    if (!user) throw new Error('no user');
    state.user = user;
    showMain();
  } catch (e) {
    console.warn('auto login failed', e);
    setAuth('', null);
    if (!window.__legacyManualBoot) {
      showAuth();
    }
  }
}

// 同步先亮登入畫面
try {
  if (document.getElementById('auth-view')) {
    document.getElementById('auth-view').classList.remove('hidden');
  }
} catch (_) {
  /* ignore */
}
window.boot = boot;
window.appState = state; // 供 v2 Vue 頁面存取全域狀態
if (window.__legacyManualBoot) {
  /* v2 宿主會在所有 pages-*.js 載入後自行呼叫 boot() */
} else if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    boot();
  });
} else {
  setTimeout(boot, 0);
}
