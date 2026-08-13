/* 線上簽核系統 — 前端 */
const API = '';
const state = {
  token: '',
  user: null,
  page: 'dashboard',
  users: [],
  workflows: [],
};

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

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
  approved: { label: '已核准', cls: 'approved' },
  rejected: { label: '已駁回', cls: 'rejected' },
  cancelled: { label: '已取消', cls: 'cancelled' },
};

const ACTION_LABEL = {
  submit: '送出申請',
  approve: '核准',
  reject: '駁回',
  cancel: '取消',
  return: '退回',
  comment: '留言',
};

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
  const res = await fetch(API + path, { ...options, headers, credentials: 'same-origin' });
  const ct = res.headers.get('content-type') || '';
  /** 取回檔案內容；returnMeta 時一併帶回檔名與 MIME */
  const readBlob = async () => {
    const blob = await res.blob();
    if (!options.returnMeta) return blob;
    return {
      blob,
      filename: parseContentDispositionFilename(
        res.headers.get('Content-Disposition')
      ),
      contentType: ct,
    };
  };
  if (
    ct.includes('application/pdf') ||
    ct.includes('application/zip') ||
    ct.includes('application/x-zip-compressed') ||
    ct.includes('application/octet-stream') ||
    (options.expectBlob && res.ok)
  ) {
    if (!res.ok) throw new Error('檔案下載失敗');
    return readBlob();
  }
  // 附件下載可能是各種 mime
  if (options.expectBlob) {
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || '檔案下載失敗');
    }
    return readBlob();
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (
      res.status === 401 &&
      state.user &&
      !path.includes('/auth/login') &&
      !path.includes('/auth/logout') &&
      !path.includes('/auth/me')
    ) {
      logout(false);
    }
    throw new Error(data.error || `請求失敗 (${res.status})`);
  }
  return data;
}

function setAuth(token, user) {
  state.token = user ? '1' : '';
  state.user = user;
  try {
    localStorage.removeItem('approval_token');
  } catch {
    /* ignore */
  }
}

function logout(showMsg = true) {
  stopPendingWatcher();
  fetch(API + '/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
  setAuth('', null);
  updateAppWatermark();
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

/** 個人客製化佈景主題清單 */
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
      '--input-bg': '#ffffff'
    }
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
      '--input-bg': '#1e293b'
    }
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
      '--input-bg': '#ffffff'
    }
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
      '--input-bg': '#ffffff'
    }
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
      '--input-bg': '#ffffff'
    }
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
      '--input-bg': '#ffffff'
    }
  }
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

function hasPerm(permId) {
  if (isAdmin()) return true;
  const list = state.user?.permissions;
  return Array.isArray(list) && list.includes(permId);
}

/**
 * 是否可進入 LINE 通知設定（依後端 configAccess）
 * - 後端回傳 canConfigure 時優先
 * - 否則依 state.lineConfigAccess 粗判（builtin_admin / any_admin / permission）
 */
function canConfigureLine() {
  if (state.lineCanConfigure === true) return true;
  if (state.lineCanConfigure === false) return false;
  const access = state.lineConfigAccess || 'builtin_admin';
  if (access === 'builtin_admin') return isBuiltinAdmin();
  if (access === 'any_admin') return isAdmin() || isBuiltinAdmin();
  if (access === 'permission') return isAdmin() || isBuiltinAdmin() || hasPerm('line_settings');
  return isBuiltinAdmin();
}

/** 載入 LINE 設定摘要（決定側欄是否顯示） */
async function refreshLineAccess() {
  try {
    const cfg = await api('/api/line/config');
    state.lineConfigAccess = cfg.configAccess || 'builtin_admin';
    state.lineCanConfigure = !!cfg.canConfigure;
    state.lineReady = !!cfg.ready;
    state.lineEnabled = !!cfg.enabled;
    return cfg;
  } catch {
    state.lineCanConfigure = false;
    state.lineConfigAccess = 'builtin_admin';
    state.lineReady = false;
    state.lineEnabled = false;
    return null;
  }
}

/** 載入並套用系統品牌（公司名稱／Logo） */
async function loadSystemSettings() {
  try {
    const s = await api('/api/system/branding');
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
  const verLabel = settings.versionLabel || (settings.version ? `v${settings.version}` : '');
  const verFull =
    settings.versionLabelFull ||
    (settings.fullVersion ? `v${settings.fullVersion}` : verLabel);
  const verBanner =
    settings.versionBanner || (verLabel ? `${name} ${verLabel}` : name);
  const verTip = [
    verFull,
    settings.versionBuild ? `建置 ${settings.versionBuild}` : '',
    settings.versionBuiltAt
      ? `原始檔時間 ${String(settings.versionBuiltAt).replace('T', ' ').slice(0, 19)}`
      : '',
    settings.versionAuto ? '（自動版本：修改程式後重啟即更新）' : '',
  ]
    .filter(Boolean)
    .join('\n');

  document.title = verLabel ? `${name} · 線上簽核 ${verLabel}` : `${name} · 線上簽核`;
  applyFavicon(logoUrl);
  // 登入頁與側欄 Logo 統一更換為公司自訂 Logo
  document
    .querySelectorAll(
      '.brand-logo, .brand-logo-auth, .brand-logo-auth-hero, .brand-logo-side'
    )
    .forEach((img) => {
      img.src = logoUrl;
      img.alt = name;
    });
  const authCompany = document.querySelector('.auth-brand .company-name');
  if (authCompany) authCompany.textContent = name;
  const heroCompany = document.querySelector('.hero-company');
  if (heroCompany) heroCompany.textContent = name;
  // h1 固定為「線上簽核」，不覆寫
  // 版本宣告
  const authVer = document.getElementById('auth-version');
  if (authVer && verLabel) {
    authVer.textContent = verLabel;
    authVer.title = verTip || verBanner;
  }
  const authVerFoot = document.getElementById('auth-version-foot');
  if (authVerFoot) {
    authVerFoot.textContent = verFull ? `${name} ${verFull}` : name;
    authVerFoot.title = verTip || verBanner;
  }
  const sideVer = document.getElementById('sidebar-version');
  if (sideVer && verLabel) {
    sideVer.textContent = verLabel;
    sideVer.title = verTip || verBanner;
  }
  const sideName = document.querySelector('.sidebar-brand .company-name-sm');
  if (sideName) sideName.textContent = name;
  const sideStrong = document.querySelector('.sidebar-brand-text strong');
  if (sideStrong) sideStrong.textContent = name.length > 8 ? '線上簽核' : name;
}

/** 依角色／權限顯示選單 */
function applyRoleUi() {
  const admin = isAdmin();
  $$('.admin-only').forEach((el) => {
    el.classList.toggle('hidden', !admin);
  });
  $$('.perm-nav').forEach((el) => {
    const p = el.dataset.perm;
    el.classList.toggle('hidden', !(p && hasPerm(p)));
  });
  // 系統設定：僅內建 Admin 帳號可見（其他最高權限也看不到）
  const sysNav = document.querySelector('[data-page="system-settings"]');
  if (sysNav) sysNav.classList.toggle('hidden', !isBuiltinAdmin());
  // LINE 通知：依 line-config 的 configAccess
  const lineNav = document.querySelector('#nav-line-settings') ||
    document.querySelector('[data-page="line-settings"]');
  if (lineNav) lineNav.classList.toggle('hidden', !canConfigureLine());
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

function parseRouteFromHash(hash = location.hash) {
  const raw = String(hash || '').replace(/^#\/?/, '').trim();
  if (!raw) return null;
  let m = raw.match(/^detail\/(\d+)\b/i);
  if (m) return { page: 'detail', params: { id: Number(m[1]) } };
  m = raw.match(/^detail\?(?:.*&)?id=(\d+)/i);
  if (m) return { page: 'detail', params: { id: Number(m[1]) } };
  m = raw.match(/^requests?\/(\d+)\b/i);
  if (m) return { page: 'detail', params: { id: Number(m[1]) } };
  const pageOnly = raw.split(/[/?#]/)[0];
  if (pageOnly && ROUTE_PAGES.includes(pageOnly) && pageOnly !== 'detail') {
    return { page: pageOnly, params: {} };
  }
  return null;
}

/** 由 page + params 組成 hash（含總覽 #dashboard，重新整理可還原） */
function buildRouteHash(page, params = {}) {
  if (page === 'detail' && params.id) return `#detail/${params.id}`;
  if (page && ROUTE_PAGES.includes(page) && page !== 'detail') return `#${page}`;
  return '#dashboard';
}

function saveLastRoute(page, params = {}) {
  try {
    sessionStorage.setItem(
      LAST_ROUTE_KEY,
      JSON.stringify({
        page,
        params: params && params.id ? { id: Number(params.id) } : {},
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
  $('#auth-view').classList.add('hidden');
  $('#main-view').classList.remove('hidden');
  const u = state.user;
  $('#user-name').textContent = u.name;
  $('#user-role').textContent = u.role === 'admin' ? '系統管理員' : (u.department || '一般使用者');
  $('#user-avatar').textContent = (u.name || 'U').slice(0, 1);
  applyRoleUi();
  updateAppWatermark();
  loadSystemSettings().catch(() => {});
  // LINE 側欄權限（完成後再套一次選單）
  refreshLineAccess()
    .then(() => applyRoleUi())
    .catch(() => {});
  // 優先網址 hash（Email／重新整理）；其次 session 記住的頁面；否則總覽
  if (!applyRouteFromHash({ allowSession: true })) {
    state.page = 'dashboard';
    state.pageParams = {};
    navigate('dashboard');
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
  'line-settings': 'LINE 通知',
  'system-settings': '系統設定',
  detail: '簽核詳情',
};

async function navigate(page, params = {}, navOpts = {}) {
  if (page === 'system-settings' && !isBuiltinAdmin()) {
    toast('僅系統內建 Admin 帳號可進入系統設定', 'error');
    page = 'dashboard';
    params = {};
  }
  if (page === 'line-settings' && !canConfigureLine()) {
    toast('您沒有 LINE 通知設定權限', 'error');
    page = 'dashboard';
    params = {};
  }
  if (page === 'workflows' && !hasPerm('workflows')) {
    toast('您沒有「管理簽核流程」權限', 'error');
    page = 'dashboard';
    params = {};
  }
  if (page === 'backups' && !hasPerm('backups')) {
    toast('您沒有「備份資料」權限', 'error');
    page = 'dashboard';
    params = {};
  }
  if (page === 'leave-report' && !hasPerm('leave_report')) {
    toast('您沒有「請假報表匯出」權限', 'error');
    page = 'dashboard';
    params = {};
  }
  if (page === 'audit-logs' && !hasPerm('audit_logs')) {
    toast('您沒有「系統稽核日誌」權限', 'error');
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
  $('#page-title').textContent = titles[page] || '線上簽核';
  $('#page-actions').innerHTML = '';
  const body = $('#page-body');
  body.innerHTML = '<div class="muted">載入中…</div>';
  try {
    if (page === 'dashboard') await renderDashboard(body);
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
    else if (page === 'line-settings') await renderLineSettings(body);
    else if (page === 'system-settings') await renderSystemSettings(body);
    else if (page === 'detail') await renderDetail(body, params.id);
  } catch (e) {
    body.innerHTML = `<div class="error-msg">${esc(e.message)}</div>`;
  }
  refreshBadge();
}

/**
 * 台灣時間的 YYYY-MM-DD。
 * 檔名原本用 new Date().toISOString()，那是 UTC，
 * 台灣時間早上 8 點前下載會標成前一天的日期。
 */
function twToday(d) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d instanceof Date ? d : new Date());
  const o = {};
  for (const x of p) if (x.type !== 'literal') o[x.type] = x.value;
  return o.year + '-' + o.month + '-' + o.day;
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function renderDashboard(body) {
  const { stats } = await api('/api/stats');
  const { requests } = await api('/api/requests?filter=pending_me');
  let announcement = { active: false };
  try {
    const annRes = await api('/api/announcement');
    announcement = annRes.announcement || announcement;
  } catch {
    /* ignore */
  }
  const pendingList = requests.slice(0, 8);
  const canWf = hasPerm('workflows');
  const canUsers = hasPerm('users_leave');
  const isFinanceStaff = isFinanceStaffUser();

  const announcementHtml =
    announcement && announcement.active
      ? `<div class="card announcement-card" style="background:#fffbeb;border-color:#fbbf24;margin-bottom:16px;padding:0;overflow:hidden">
          <button type="button" class="announcement-open" id="btn-announcement-open"
            style="display:block;width:100%;text-align:left;border:0;background:transparent;padding:18px 20px;cursor:pointer">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
              <div style="flex:1;min-width:200px">
                <div style="font-size:1.55rem;font-weight:800;color:#b45309;letter-spacing:0.12em;margin-bottom:8px;line-height:1.2">公告</div>
                <strong style="color:#92400e;font-size:1.15rem;line-height:1.4;display:block">${esc(announcement.title || '公司公告')}</strong>
                ${
                  announcement.body
                    ? `<p style="margin:8px 0 0;font-size:0.98rem;color:#78350f;line-height:1.55;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-wrap">${esc(announcement.body)}</p>`
                    : ''
                }
              </div>
              <span class="btn outline sm" style="pointer-events:none;white-space:nowrap;border-color:#f59e0b;color:#92400e">查看</span>
            </div>
          </button>
        </div>`
      : '';

  const finNoticeHtml =
    isFinanceStaff && stats.pendingFinanceConfirm > 0
      ? `<div class="card" style="background:#ecfdf5;border-color:#6ee7b7;margin-bottom:16px;padding:16px">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
            <div>
              <strong style="color:#065f46;font-size:1.05rem">📊 待財務部授信額度建檔確認（${stats.pendingFinanceConfirm} 筆）</strong>
              <p style="margin:4px 0 0;font-size:0.88rem;color:#047857">
                總經理已完成核定。請於 ERP 完成授信額度設定後，點擊「前往處理」進行建檔確認。
              </p>
            </div>
            <button type="button" class="btn success" data-go="inbox" style="white-space:nowrap;font-weight:600">前往處理 (${stats.pendingFinanceConfirm})</button>
          </div>
        </div>`
      : '';

  const applicantAckNoticeHtml =
    stats.pendingApplicantAck > 0
      ? `<div class="card" style="background:#f0fdf4;border-color:#86efac;margin-bottom:16px;padding:16px">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
            <div>
              <strong style="color:#166534;font-size:1.05rem">📊 財務部已完成授信額度建檔（${stats.pendingApplicantAck} 筆待您確認）</strong>
              <p style="margin:4px 0 0;font-size:0.88rem;color:#15803d">
                財務部已完成您申請的授信額度建檔。請點擊「前往確認」並點選「我知道了」。
              </p>
            </div>
            <button type="button" class="btn success" data-go="inbox" style="white-space:nowrap;font-weight:600">前往確認 (${stats.pendingApplicantAck})</button>
          </div>
        </div>`
      : '';

  const finalNotifyNoticeHtml =
    stats.pendingFinalNotify > 0
      ? `<div class="card" style="background:#eff6ff;border-color:#93c5fd;margin-bottom:16px;padding:16px">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
            <div>
              <strong style="color:#1e40af;font-size:1.05rem">🔔 最終核准通知（${stats.pendingFinalNotify} 筆待確認）</strong>
              <p style="margin:4px 0 0;font-size:0.88rem;color:#1d4ed8">
                有申請單已最終核准。請假相關請<strong>設定 Email 自動回覆</strong>後，開啟單據點確認。
              </p>
            </div>
            <button type="button" class="btn primary" data-go="inbox" style="white-space:nowrap;font-weight:600">前往確認 (${stats.pendingFinalNotify})</button>
          </div>
        </div>`
      : '';

  body.innerHTML = `
    ${finNoticeHtml}
    ${applicantAckNoticeHtml}
    ${finalNotifyNoticeHtml}
    ${announcementHtml}
    <div class="stats-grid">
      ${statCardHtml({
        label: '待我簽核',
        value: stats.pendingMe ?? 0,
        go: 'inbox',
        hint: '前往待簽核列表',
      })}
      ${
        isFinanceStaff
          ? statCardHtml({
              label: '待財務建檔',
              value: stats.pendingFinanceConfirm ?? 0,
              go: 'inbox',
              hint: '待財務部額度建檔確認',
            })
          : ''
      }
      ${
        stats.pendingApplicantAck > 0
          ? statCardHtml({
              label: '待確認建檔',
              value: stats.pendingApplicantAck ?? 0,
              go: 'inbox',
              hint: '待您確認財務建檔結果',
            })
          : ''
      }
      ${statCardHtml({
        label: '我的進行中',
        value: stats.minePending ?? 0,
        go: 'mine',
        hint: '查看我的申請',
      })}
      ${statCardHtml({
        label: '我已完成',
        value: stats.mineDone ?? 0,
        go: 'mine',
        hint: '查看我的申請',
      })}
      ${statCardHtml({
        label: '本月申請',
        value: stats.monthlyRequests ?? 0,
        hint: '本月（1日起）我送出的申請數',
      })}
      ${statCardHtml({
        label: '平均簽核天數',
        value: stats.avgApprovalDays != null ? `${stats.avgApprovalDays} 天` : '—',
        hint: '我已核准單據的平均簽核天數',
      })}

      ${statCardHtml({
        label: '啟用中流程',
        value: stats.workflows ?? 0,
        go: canWf ? 'workflows' : undefined,
        hint: canWf ? '管理簽核流程' : '需流程管理權限',
        disabled: !canWf,
      })}
    </div>
    <div class="card">
      <div class="card-head">
        <h3>待辦簽核</h3>
        ${
          pendingList.length
            ? `<button type="button" class="btn outline sm" data-go="inbox">查看全部</button>`
            : ''
        }
      </div>
      ${requestTable(pendingList, {
        empty: {
          title: '目前沒有待簽核項目',
          desc: '有單據輪到您簽核時會顯示在這裡，也可從左側「待我簽核」進入。',
          actions: [
            { label: '＋ 新增申請', go: 'new-request', primary: true },
            { label: '我的申請', go: 'mine', outline: true },
          ],
        },
      })}
    </div>
    <div class="card">
      <h3>快速開始</h3>
      <div class="form-actions">
        <button type="button" class="btn primary" data-go="new-request">＋ 新增申請</button>
        ${
          canWf
            ? `<button type="button" class="btn outline" data-go="workflows">管理簽核流程</button>`
            : ''
        }
        ${
          hasPerm('backups')
            ? `<button type="button" class="btn outline" data-go="backups">備份資料</button>`
            : ''
        }
        ${
          isAdmin()
            ? `<button type="button" class="btn outline" data-go="users">成員權限</button>`
            : canUsers
              ? `<button type="button" class="btn outline" data-go="users">成員休假</button>`
              : ''
        }
        <button type="button" class="btn outline" data-go="inbox">查看待簽核</button>
      </div>
    </div>
  `;
  bindDataGo(body);
  bindRequestRows(body);

  $('#btn-announcement-open')?.addEventListener('click', () => {
    openAnnouncementModal(announcement);
  });
}

/** ISO → datetime-local 輸入值（本機時區） */
function toDatetimeLocalValue(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 系統設定：公告狀態文字 */
function formatAnnouncementStatus(a) {
  if (!a) return '未設定';
  if (!a.enabled) return '未啟用';
  const hasContent = !!(
    (a.title && String(a.title).trim()) ||
    (a.body && String(a.body).trim()) ||
    a.hasFile
  );
  if (!hasContent) return '已啟用，但尚無標題／內文／附件';
  if (a.scheduleStatus === 'scheduled') return '已啟用，尚未到公布開始時間（總覽暫不顯示）';
  if (a.scheduleStatus === 'expired') return '已過公布結束時間，自動下架（總覽不顯示）';
  if (a.active) return '公布中，顯示於總覽';
  return '已啟用';
}

/** 總覽／系統設定：查看公告全文與附件 */
function openAnnouncementModal(announcement) {
  // 系統設定預覽可在非 active 時查看；總覽僅 active 才開卡
  if (!announcement) return;
  if (announcement.active === false && !announcement._forcePreview) return;
  const bodyHtml = announcement.body
    ? `<div style="white-space:pre-wrap;line-height:1.75;color:#1e293b;margin:0 0 16px;font-size:1.12rem">${esc(announcement.body)}</div>`
    : `<p class="muted" style="margin:0 0 14px;font-size:1.05rem">（無內文）</p>`;
  // 附件僅檢視、不提供下載
  const fileHtml = announcement.hasFile
    ? `<div style="padding:14px 16px;background:#f8fafc;border:1px solid var(--border);border-radius:10px">
        <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;margin-bottom:10px">
          <div>
            <div style="font-size:0.9rem;color:#64748b">附件（僅供檢視）</div>
            <strong style="font-size:1.05rem">${esc(announcement.originalName || '附件')}</strong>
          </div>
          <button type="button" class="btn primary sm" id="ann-file-view">開啟檢視</button>
        </div>
        <div id="ann-file-preview" class="muted" style="font-size:0.9rem">點「開啟檢視」於下方或新分頁瀏覽（不提供下載）</div>
      </div>`
    : '';
  const updated = announcement.updatedAt
    ? String(announcement.updatedAt).replace('T', ' ').replace(/\.\d+Z$/, ' UTC')
    : '';
  openModal(`
    <h3 style="margin-top:0;font-size:1.45rem;line-height:1.35">📢 ${esc(announcement.title || '公司公告')}</h3>
    ${updated ? `<p class="muted" style="margin:-4px 0 14px;font-size:0.9rem">更新：${esc(updated)}</p>` : ''}
    ${bodyHtml}
    ${fileHtml}
    <div class="modal-actions" style="margin-top:16px">
      <button type="button" class="btn outline" data-close-modal>關閉</button>
    </div>
  `);
  $('#modal-panel')?.classList.add('wide');

  $('#ann-file-view')?.addEventListener('click', async () => {
    try {
      const meta = await api('/api/announcement/file?inline=1', {
        expectBlob: true,
        returnMeta: true,
      });
      const url = URL.createObjectURL(meta.blob);
      const ct = String(meta.contentType || meta.blob.type || '').toLowerCase();
      const name = String(meta.filename || announcement.originalName || '');
      const isPdf = ct.includes('pdf') || /\.pdf$/i.test(name);
      const isImg =
        ct.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(name);
      const box = $('#ann-file-preview');
      if (box && (isPdf || isImg)) {
        if (isPdf) {
          box.innerHTML = `<iframe src="${url}" title="附件預覽" style="width:100%;height:min(70vh,560px);border:1px solid var(--border);border-radius:8px;background:#fff"></iframe>`;
        } else {
          box.innerHTML = `<img src="${url}" alt="附件預覽" style="max-width:100%;max-height:min(70vh,560px);border-radius:8px;display:block;margin:0 auto" />`;
        }
        setTimeout(() => URL.revokeObjectURL(url), 120_000);
      } else {
        // 其他格式：新分頁 inline 開啟（仍不觸發下載屬性）
        window.open(url, '_blank', 'noopener');
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
    } catch (err) {
      toast(err.message || '附件開啟失敗', 'error');
    }
  });
}

/** 是否具備「刪除簽核紀錄」權限（管理員或 records_delete） */
function canDeleteRecordsPerm() {
  return isAdmin() || hasPerm('records_delete');
}

/** 人事：刪除請假申請（含簽核中、所有人） */
function canDeleteLeavePerm() {
  return isAdmin() || hasPerm('leave_delete');
}

function isLeaveRequestRow(r) {
  if (!r) return false;
  if (r.is_leave === true) return true;
  return (
    /請假/.test(String(r.workflow_name || '')) ||
    /請假/.test(String(r.title || ''))
  );
}

/**
 * 列表是否可刪除（與後端一致）
 * - 系統管理員：可刪任何狀態（已核准／駁回／簽核中／已取消／已簽署）
 * - 請假＋leave_delete：可刪任何人、含簽核進行中／已簽核
 * - 其餘：已有簽署人簽核 → 不可刪；已核准一般不可刪
 * - 申請人本人可刪自己的未核准單；records_delete 可刪他人未鎖定單
 */
function canDeleteRequestRow(r, { adminMode = false } = {}) {
  if (!r) return false;
  if (isAdmin()) return true;
  if (r.can_delete === true) return true;
  if (isLeaveRequestRow(r) && canDeleteLeavePerm()) return true;
  if (r.can_delete === false) return false;
  if (r.approver_signed) return false;
  if (r.status === 'approved') return false;
  if (adminMode && canDeleteRecordsPerm()) return true;
  return Number(r.requester_id) === Number(state.user?.id);
}

/**
 * 申請列表表格
 * @param {Array} requests
 * @param {boolean|{ empty?: object }} emptyOkOrOpts  相容舊呼叫 true＝簡易空狀態；或 { empty, allowDelete, adminMode }
 * @param {{ allowDelete?: boolean, adminMode?: boolean, empty?: object }} [opts]
 */
function requestTable(requests, emptyOkOrOpts = false, opts = {}) {
  // 相容：requestTable(list, true) / requestTable(list, false, {…}) / requestTable(list, { empty, … })
  let emptyCfg = null;
  let allowDelete = false;
  let adminMode = false;
  if (emptyOkOrOpts && typeof emptyOkOrOpts === 'object' && !Array.isArray(emptyOkOrOpts)) {
    emptyCfg = emptyOkOrOpts.empty || null;
    allowDelete = !!emptyOkOrOpts.allowDelete;
    adminMode = !!emptyOkOrOpts.adminMode;
  } else {
    allowDelete = !!(opts && opts.allowDelete);
    adminMode = !!(opts && opts.adminMode);
    emptyCfg = (opts && opts.empty) || null;
    if (!emptyCfg && emptyOkOrOpts === true) {
      emptyCfg = {
        title: '目前沒有項目',
        desc: '此處尚無相關簽核單據。',
      };
    }
  }
  if (!requests.length) {
    return emptyState(
      emptyCfg || {
        title: '尚無資料',
        desc: '目前沒有符合條件的簽核單據。',
      }
    );
  }
  const allowBatchSelect = opts.allowBatchSelect || false;
  const anyDeletable =
    allowDelete &&
    requests.some((r) => canDeleteRequestRow(r, { adminMode }));
  const showCheckboxCol = anyDeletable || allowBatchSelect;

  return `
    <div class="table-wrap">
      <table class="data" style="width:100%;min-width:920px;table-layout:fixed">
        <thead>
          <tr>
            ${showCheckboxCol ? '<th style="width:36px;text-align:center"></th>' : ''}
            <th style="width:70px;text-align:center;white-space:nowrap">單號</th>
            <th style="min-width:320px">主旨</th>
            <th style="width:150px">流程</th>
            <th style="width:100px;white-space:nowrap">申請人</th>
            <th style="width:90px;text-align:center;white-space:nowrap">狀態</th>
            <th style="width:145px;white-space:nowrap">更新時間</th>
            ${anyDeletable ? '<th style="width:95px;text-align:center;white-space:nowrap">操作</th>' : ''}
          </tr>
        </thead>
        <tbody>
          ${requests
            .map((r) => {
              const canDel = allowDelete && canDeleteRequestRow(r, { adminMode });
              const proxyBadge = r.is_delegated
                ? `<span class="tag draft" style="background:#eff6ff;color:#1d4ed8;border-color:#bfdbfe;margin-right:6px">代理 ${esc(r.delegated_for_name || '')}</span>`
                : '';
              return `
            <tr class="clickable" data-id="${r.id}">
              ${
                showCheckboxCol
                  ? `<td style="text-align:center" onclick="event.stopPropagation()">
                      ${
                        canDel
                          ? `<input type="checkbox" data-req-check value="${r.id}" />`
                          : allowBatchSelect
                            ? `<input type="checkbox" data-batch-check value="${r.id}" />`
                            : ''
                      }
                    </td>`
                  : ''
              }
              <td style="text-align:center;white-space:nowrap"><span class="req-id-badge">#${r.id}</span></td>
              <td style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(r.title)}">${proxyBadge}<strong>${esc(r.title)}</strong></td>
              <td style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(r.workflow_name)}">${esc(r.workflow_name)}</td>
              <td style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(r.requester_name)}">${esc(r.requester_name)}</td>
              <td style="text-align:center;white-space:nowrap">${statusTag(r.status)}</td>
              <td class="muted" style="white-space:nowrap">${esc(r.updated_at)}</td>
              ${
                anyDeletable
                  ? `<td style="text-align:center;white-space:nowrap" onclick="event.stopPropagation()">
                      ${
                        canDel
                          ? `<button type="button" class="btn sm danger" data-del-req="${r.id}">刪除</button>`
                          : r.approver_signed || r.can_delete === false
                            ? `<span class="muted" style="font-size:0.82rem" title="下一位簽署人已簽核">已簽核不可刪</span>`
                            : r.status === 'approved'
                              ? `<span class="muted" style="font-size:0.82rem">已核准不可刪</span>`
                              : ''
                      }
                    </td>`
                  : ''
              }
            </tr>`;
            })
            .join('')}
        </tbody>
      </table>
    </div>`;
}

function bindRequestRows(root) {
  root.querySelectorAll('tr[data-id]').forEach((tr) => {
    tr.onclick = (e) => {
      if (e.target.closest('input,button,a,label')) return;
      navigate('detail', { id: Number(tr.dataset.id) });
    };
  });
}

function getSelectedRequestIds(root) {
  return [...(root || document).querySelectorAll('input[data-req-check]:checked')]
    .map((c) => Number(c.value))
    .filter(Boolean);
}

function getSelectedBatchRequestIds(root) {
  return [...(root || document).querySelectorAll('input[data-batch-check]:checked')]
    .map((c) => Number(c.value))
    .filter(Boolean);
}

/**
 * 批次簽核 Modal (P2-2)
 */
function openBatchApprovalModal(selectedIds, action = 'approve', callback) {
  const isApprove = action === 'approve';
  const titleText = isApprove ? '⚡ 批次核准簽核單' : '❌ 批次駁回簽核單';
  const defaultComment = isApprove ? '批次同意核准' : '批次駁回';

  openModal(`
    <h3 style="margin-top:0">${titleText} (共 ${selectedIds.length} 筆)</h3>
    <p class="muted" style="margin-top:-4px">將對單號：<strong>#${selectedIds.join(', #')}</strong> 執行批次${isApprove ? '核准' : '駁回'}</p>
    <form id="batch-action-form" class="form-grid">
      <div class="field">
        <label>簽核意見 / 備註</label>
        <textarea name="comment" rows="3" placeholder="${defaultComment}">${defaultComment}</textarea>
      </div>
      ${
        isApprove
          ? `<div class="field">
              <label>手寫電子簽名（選填）</label>
              <div style="display:flex;gap:8px;align-items:center">
                <button type="button" class="btn outline sm" id="btn-batch-sig-pad">✏️ 打開手寫簽名板</button>
                <span class="muted" id="batch-sig-status" style="font-size:0.85rem">使用個人預設簽名檔</span>
              </div>
            </div>`
          : ''
      }
      <div class="form-actions" style="margin-top:16px">
        <button type="submit" class="btn ${isApprove ? 'primary' : 'danger'}">確定批次${isApprove ? '核准' : '駁回'}</button>
        <button type="button" class="btn outline" data-close-modal>取消</button>
      </div>
    </form>
  `);

  let tempSigImage = state.user?.signature_image || null;

  $('#btn-batch-sig-pad')?.addEventListener('click', () => {
    openSignaturePadModal((sigDataUrl) => {
      tempSigImage = sigDataUrl;
      const statusEl = $('#batch-sig-status');
      if (statusEl) statusEl.textContent = '✅ 已套用本次手寫簽名';
    });
  });

  $('#batch-action-form').onsubmit = async (e) => {
    e.preventDefault();
    const commentVal = String(e.target.comment.value || '').trim() || defaultComment;
    try {
      const res = await api('/api/requests/bulk-action', {
        method: 'POST',
        body: {
          ids: selectedIds,
          action,
          comment: commentVal,
          signature_image: tempSigImage,
        },
      });
      closeModal();
      toast(res.message || '批次簽核完成', 'success');
      if (typeof callback === 'function') callback();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

async function renderRequestList(body, filter) {
  // 查詢列僅「簽核紀錄」等紀錄頁；待我簽核／我的申請不顯示、也不帶查詢參數
  const showSearch =
    filter === 'related' || filter === 'all' || filter === 'done';

  // 查詢條件（僅紀錄頁、同 filter 間保留）
  const prev =
    showSearch &&
    state.requestListQuery &&
    state.requestListQuery._filter === filter
      ? state.requestListQuery
      : {};
  const query = showSearch
    ? {
        q: prev.q || '',
        workflow: prev.workflow || '',
        status: prev.status || '',
        dateFrom: prev.dateFrom || '',
        dateTo: prev.dateTo || '',
      }
    : { q: '', workflow: '', status: '', dateFrom: '', dateTo: '' };

  const params = new URLSearchParams({ filter });
  if (showSearch) {
    if (query.q) params.set('q', query.q);
    if (query.workflow) params.set('workflow', query.workflow);
    if (query.status) params.set('status', query.status);
    if (query.dateFrom) params.set('dateFrom', query.dateFrom);
    if (query.dateTo) params.set('dateTo', query.dateTo);
  }

  const data = await api(`/api/requests?${params.toString()}`);
  const requests = data.requests || [];
  const categories = Array.isArray(data.categories) ? data.categories : [];
  // 類別下拉：後端回傳＋本頁資料
  const catSet = new Set(categories);
  for (const r of requests) {
    if (r.workflow_name) catSet.add(String(r.workflow_name));
  }
  const categoryOptions = [...catSet].sort((a, b) => a.localeCompare(b, 'zh-Hant'));

  // 我的申請：可刪除非已核准；admin 可刪任何狀態；records_delete／leave_delete 在紀錄列表可刪
  const adminMode =
    (isAdmin() || canDeleteRecordsPerm() || canDeleteLeavePerm()) &&
    (filter === 'related' || filter === 'all' || filter === 'done' || filter === 'mine');
  const allowDelete =
    filter === 'mine' || adminMode || canDeleteLeavePerm() || isAdmin();
  const anyDeletable =
    allowDelete &&
    requests.some((r) => canDeleteRequestRow(r, { adminMode }));
  const hasActiveQuery =
    showSearch &&
    !!(query.q || query.workflow || query.status || query.dateFrom || query.dateTo);
  const hint =
    filter === 'related' || filter === 'all'
      ? `<p class="muted" style="margin:0 0 12px">僅顯示與您登入帳號相關的單據（本人申請、待您簽核或您曾簽核）。${
          isAdmin() || hasPerm('records_all')
            ? '具備「查看全部」權限者可看所有人單據。'
            : ''
        }${
          isAdmin()
            ? ' <strong>系統管理員可刪除任何狀態的申請單</strong>（含已核准／駁回／簽核中／已取消）。'
            : ''
        }${
          !isAdmin() && canDeleteLeavePerm()
            ? ' 具備「刪除請假申請」者可查看並刪除<strong>所有人的請假單</strong>（含簽核進行中）。'
            : ''
        }${
          !isAdmin() && canDeleteRecordsPerm()
            ? ' 具備「刪除簽核紀錄」者可刪除尚未有簽署人核准的單據。'
            : ''
        }</p>`
      : filter === 'mine'
        ? `<p class="muted" style="margin:0 0 12px">僅顯示您本人送出的申請。${
            isAdmin()
              ? '系統管理員可刪除任何狀態的申請單。'
              : '可刪除<strong>尚未核准</strong>的單據（已核准不可刪）。'
          }</p>`
        : filter === 'pending_me'
          ? `<p class="muted" style="margin:0 0 12px">僅顯示目前待您簽核的單據。</p>`
          : '';
  const emptyByFilter = {
    pending_me: {
      title: hasActiveQuery ? '沒有符合條件的待簽核' : '目前沒有待您簽核的單據',
      desc: hasActiveQuery
        ? '請調整查詢條件後再試。'
        : '新申請送達且輪到您時會出現在此。您也可以主動提出新申請。',
      actions: hasActiveQuery
        ? [{ label: '清除條件', id: 'btn-req-clear', outline: true }]
        : [
            { label: '＋ 新增申請', go: 'new-request', primary: true },
            { label: '回總覽', go: 'dashboard', outline: true },
          ],
    },
    mine: {
      title: hasActiveQuery ? '沒有符合條件的申請' : '尚無我的申請',
      desc: hasActiveQuery
        ? '請調整查詢條件後再試。'
        : '您還沒有送出任何申請。可從「新增申請」選擇流程開始。',
      actions: hasActiveQuery
        ? [{ label: '清除條件', id: 'btn-req-clear', outline: true }]
        : [{ label: '＋ 新增申請', go: 'new-request', primary: true }],
    },
    related: {
      title: hasActiveQuery ? '沒有符合條件的紀錄' : '尚無相關簽核紀錄',
      desc: hasActiveQuery
        ? '請調整申請類別、狀態、日期或關鍵字後再查詢。'
        : '與您有關的申請、待簽或曾簽核的單據會列在這裡。',
      actions: hasActiveQuery
        ? [{ label: '清除條件', id: 'btn-req-clear', outline: true }]
        : [
            { label: '查看待簽核', go: 'inbox', outline: true },
            { label: '＋ 新增申請', go: 'new-request', primary: true },
          ],
    },
    all: {
      title: hasActiveQuery ? '沒有符合條件的紀錄' : '尚無簽核紀錄',
      desc: hasActiveQuery
        ? '請調整查詢條件後再試。'
        : '系統中尚無相關單據。',
      actions: hasActiveQuery
        ? [{ label: '清除條件', id: 'btn-req-clear', outline: true }]
        : [{ label: '＋ 新增申請', go: 'new-request', primary: true }],
    },
    done: {
      title: hasActiveQuery ? '沒有符合條件的紀錄' : '尚無已完成紀錄',
      desc: hasActiveQuery
        ? '請調整查詢條件後再試。'
        : '已核准或結案的單據會顯示於此。',
      actions: hasActiveQuery
        ? [{ label: '清除條件', id: 'btn-req-clear', outline: true }]
        : [{ label: '回總覽', go: 'dashboard', outline: true }],
    },
  };

  const statusOpts = [
    { v: '', t: '全部狀態' },
    { v: 'pending', t: '簽核中' },
    { v: 'approved', t: '已核准' },
    { v: 'rejected', t: '已駁回' },
    { v: 'cancelled', t: '已取消' },
    { v: 'draft', t: '草稿' },
  ];

  let finConfirmCardHtml = '';
  // 最終核准系統通知待確認（列表上方提示）
  let finalNotifyListBanner = '';
  if (filter === 'pending_me') {
    const fnList = (requests || []).filter((r) => r.needsFinalNotifyAck);
    if (fnList.length) {
      finalNotifyListBanner = `
        <div class="card" style="background:#eff6ff;border-color:#93c5fd;margin-bottom:14px;padding:14px">
          <h3 style="color:#1e40af;margin:0">🔔 最終核准完成通知（${fnList.length} 筆待您確認收到）</h3>
          <p style="margin:6px 0 0;font-size:0.88rem;color:#1d4ed8">
            請開啟單據後點「確認收到通知」。此為系統內通知，非 Email。
          </p>
        </div>`;
    }
  }

  if (filter === 'pending_me' && isFinanceStaffUser()) {
    try {
      const finRes = await api('/api/requests?filter=pending_finance_confirm');
      const finReqs = finRes.requests || [];
      if (finReqs.length > 0) {
        finConfirmCardHtml = `
          <div class="card" style="background:#ecfdf5;border-color:#6ee7b7;margin-bottom:16px;padding:16px">
            <div class="card-head" style="margin-bottom:8px">
              <h3 style="color:#065f46;margin:0">📊 待財務部授信額度建檔確認（${finReqs.length} 筆）</h3>
            </div>
            <p style="margin:0 0 12px;font-size:0.88rem;color:#047857">
              總經理已完成核定。請於 ERP 完成授信額度設定後，點選單據開啟詳情並點擊「確認完成額度建檔」。
            </p>
            ${requestTable(finReqs, { empty: { title: '尚無待建檔單據' } })}
          </div>`;
      }
    } catch {
      /* ignore */
    }
  }

  body.innerHTML = `
    ${finConfirmCardHtml}
    ${finalNotifyListBanner}
    <div class="card">
      ${hint}
      ${
        showSearch
          ? `<form id="req-filter-form" class="req-filter-bar" style="margin-bottom:14px">
              <div class="form-grid two" style="gap:10px">
                <div class="field" style="margin:0">
                  <label>關鍵字</label>
                  <input type="search" name="q" value="${esc(query.q)}"
                    placeholder="單號、主旨、申請人、類別…" autocomplete="off" />
                </div>
                <div class="field" style="margin:0">
                  <label>申請類別</label>
                  <select name="workflow">
                    <option value="">全部類別</option>
                    ${categoryOptions
                      .map(
                        (c) =>
                          `<option value="${esc(c)}" ${
                            query.workflow === c ? 'selected' : ''
                          }>${esc(c)}</option>`
                      )
                      .join('')}
                  </select>
                </div>
                <div class="field" style="margin:0">
                  <label>狀態</label>
                  <select name="status">
                    ${statusOpts
                      .map(
                        (o) =>
                          `<option value="${esc(o.v)}" ${
                            query.status === o.v ? 'selected' : ''
                          }>${esc(o.t)}</option>`
                      )
                      .join('')}
                  </select>
                </div>
                <div class="field" style="margin:0">
                  <label>更新日期（起～迄）</label>
                  <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                    <input type="date" name="dateFrom" value="${esc(query.dateFrom)}" style="flex:1;min-width:120px" />
                    <span class="muted">～</span>
                    <input type="date" name="dateTo" value="${esc(query.dateTo)}" style="flex:1;min-width:120px" />
                  </div>
                </div>
              </div>
              <div class="form-actions" style="margin-top:10px;flex-wrap:wrap">
                <button type="submit" class="btn primary sm">查詢</button>
                <button type="button" class="btn outline sm" id="btn-req-clear">清除條件</button>
                <span class="muted" style="font-size:0.85rem">共 <strong>${requests.length}</strong> 筆</span>
              </div>
            </form>`
          : ''
      }
      ${
        filter === 'pending_me' && requests.length > 0
          ? `<div class="form-actions" style="margin-bottom:12px;flex-wrap:wrap;align-items:center;justify-content:space-between;background:#f8fafc;padding:10px 14px;border:1px solid var(--border);border-radius:10px">
              <div style="display:flex;align-items:center;gap:10px">
                <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-weight:600">
                  <input type="checkbox" id="chk-all-batch-reqs" /> 全選本頁待簽項目
                </label>
                <span class="muted" id="batch-req-sel-count">已勾選 0 筆</span>
              </div>
              <div style="display:flex;gap:8px;align-items:center">
                <button type="button" class="btn primary sm" id="btn-batch-approve-reqs" disabled>⚡ 批次核准 (0)</button>
                <button type="button" class="btn danger sm" id="btn-batch-reject-reqs" disabled>❌ 批次駁回 (0)</button>
              </div>
            </div>`
          : ''
      }
      ${
        anyDeletable
          ? `<div class="form-actions" style="margin-bottom:12px;flex-wrap:wrap">
              <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
                <input type="checkbox" id="chk-all-reqs" /> 全選
              </label>
              <button type="button" class="btn danger sm" id="btn-bulk-del-reqs">刪除選取</button>
              <span class="muted" id="req-sel-count">已選 0 筆</span>
            </div>`
          : ''
      }
      ${requestTable(requests, {
        allowDelete,
        adminMode,
        allowBatchSelect: filter === 'pending_me' && requests.length > 0,
        empty: emptyByFilter[filter] || {
          title: '尚無資料',
          desc: '目前沒有符合條件的簽核單據。',
        },
      })}
    </div>`;
  bindDataGo(body);
  bindRequestRows(body);

  const applyQueryAndReload = (next) => {
    state.requestListQuery = { ...next, _filter: filter };
    navigate(state.page || 'records');
  };
  $('#req-filter-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    applyQueryAndReload({
      q: String(fd.get('q') || '').trim(),
      workflow: String(fd.get('workflow') || '').trim(),
      status: String(fd.get('status') || '').trim(),
      dateFrom: String(fd.get('dateFrom') || '').trim(),
      dateTo: String(fd.get('dateTo') || '').trim(),
    });
  });
  const clearBtn = (e) => {
    e?.preventDefault?.();
    state.requestListQuery = { _filter: filter };
    navigate(state.page || 'records');
  };
  $('#btn-req-clear')?.addEventListener('click', clearBtn);
  body.querySelectorAll('#btn-req-clear').forEach((b) => {
    b.onclick = clearBtn;
  });

  if (filter === 'pending_me' && requests.length > 0) {
    const updateBatchBtnState = () => {
      const selectedIds = getSelectedBatchRequestIds(body);
      const count = selectedIds.length;
      const countEl = $('#batch-req-sel-count');
      const approveBtn = $('#btn-batch-approve-reqs');
      const rejectBtn = $('#btn-batch-reject-reqs');

      if (countEl) countEl.textContent = `已勾選 ${count} 筆`;
      if (approveBtn) {
        approveBtn.disabled = count === 0;
        approveBtn.textContent = `⚡ 批次核准 (${count})`;
      }
      if (rejectBtn) {
        rejectBtn.disabled = count === 0;
        rejectBtn.textContent = `❌ 批次駁回 (${count})`;
      }
    };

    $('#chk-all-batch-reqs')?.addEventListener('change', (e) => {
      body.querySelectorAll('input[data-batch-check]').forEach((c) => {
        c.checked = e.target.checked;
      });
      updateBatchBtnState();
    });

    body.querySelectorAll('input[data-batch-check]').forEach((c) => {
      c.onchange = updateBatchBtnState;
    });

    $('#btn-batch-approve-reqs')?.addEventListener('click', () => {
      const selectedIds = getSelectedBatchRequestIds(body);
      if (!selectedIds.length) return toast('請先勾選要簽核的單據', 'error');
      openBatchApprovalModal(selectedIds, 'approve', () => renderRequestList(body, 'pending_me'));
    });

    $('#btn-batch-reject-reqs')?.addEventListener('click', () => {
      const selectedIds = getSelectedBatchRequestIds(body);
      if (!selectedIds.length) return toast('請先勾選要駁回的單據', 'error');
      openBatchApprovalModal(selectedIds, 'reject', () => renderRequestList(body, 'pending_me'));
    });
  }

  if (!anyDeletable) return;

  const updateCount = () => {
    const n = getSelectedRequestIds(body).length;
    const el = $('#req-sel-count');
    if (el) el.textContent = `已選 ${n} 筆`;
  };
  $('#chk-all-reqs')?.addEventListener('change', (e) => {
    body.querySelectorAll('input[data-req-check]').forEach((c) => {
      c.checked = e.target.checked;
    });
    updateCount();
  });
  body.querySelectorAll('input[data-req-check]').forEach((c) => {
    c.onchange = updateCount;
  });

  body.querySelectorAll('[data-del-req]').forEach((btn) => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const id = Number(btn.dataset.delReq);
      const r = requests.find((x) => x.id === id);
      if (r && !canDeleteRequestRow(r, { adminMode })) {
        toast(
          r.approver_signed || r.can_delete === false
            ? '下一位簽署人已簽核，此申請單無法刪除'
            : '此申請單不可刪除',
          'error'
        );
        return;
      }
      if (
        r?.status === 'approved' &&
        !isAdmin() &&
        !canDeleteRecordsPerm() &&
        !(isLeaveRequestRow(r) && canDeleteLeavePerm())
      ) {
        toast('已核准的申請不可刪除', 'error');
        return;
      }
      const adminWarn = isAdmin()
        ? '\n（系統管理員：將永久刪除此單，含已簽核／任何狀態）'
        : '';
      if (
        !confirm(
          `確定刪除申請 #${id}${r ? `「${r.title}」` : ''}？\n將永久刪除單據、歷程、附件與相關備份，無法復原。${adminWarn}`
        )
      ) {
        return;
      }
      try {
        await api(`/api/requests/${id}`, { method: 'DELETE' });
        toast('已刪除申請', 'success');
        navigate(state.page || 'mine');
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  });

  $('#btn-bulk-del-reqs')?.addEventListener('click', async () => {
    const ids = getSelectedRequestIds(body);
    if (!ids.length) {
      toast('請先勾選要刪除的紀錄', 'error');
      return;
    }
    // 僅送出可刪者；已簽核鎖定的會被後端拒絕
    const locked = ids.filter((id) => {
      const r = requests.find((x) => x.id === id);
      return r && !canDeleteRequestRow(r, { adminMode });
    });
    if (locked.length) {
      toast(
        `有 ${locked.length} 筆已有簽署人簽核，無法刪除（將略過）`,
        'error'
      );
    }
    const okIds = ids.filter((id) => {
      const r = requests.find((x) => x.id === id);
      return !r || canDeleteRequestRow(r, { adminMode });
    });
    if (!okIds.length) {
      toast('選取的申請皆不可刪除', 'error');
      return;
    }
    if (
      !confirm(
        isAdmin()
          ? `確定刪除選取的 ${okIds.length} 筆申請？\n將永久刪除單據、歷程、附件與相關備份，無法復原。\n（系統管理員可刪除任何狀態，含已核准／駁回／簽核中／已取消）`
          : `確定刪除選取的 ${okIds.length} 筆申請？\n將永久刪除單據、歷程、附件與相關備份，無法復原。\n（一般單據：已簽署／已核准不可刪；請假單若具備「刪除請假申請」權限可刪）`
      )
    ) {
      return;
    }
    try {
      const data = await api('/api/requests/bulk-delete', {
        method: 'POST',
        body: { ids: okIds },
      });
      toast(data.message || '已批次刪除', 'success');
      navigate(state.page || 'mine');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

async function loadUsers() {
  const { users } = await api('/api/users');
  state.users = users;
  return users;
}

async function loadWorkflows(all = false) {
  // 完整管理列表需 workflows 權限；一般使用者只取啟用中流程（送出申請用）
  if (all && !hasPerm('workflows')) {
    throw new Error('您沒有管理簽核流程的權限');
  }
  const { workflows } = await api(`/api/workflows${all ? '?all=1' : ''}`);
  state.workflows = workflows;
  return workflows;
}

const FIELD_TYPE_LABEL = {
  text: '單行文字',
  textarea: '多行文字',
  number: '數字',
  date: '日期',
  datetime: '日期時間（30分）',
  select: '下拉選單',
  checkbox: '核取方塊',
  user: '人員選擇',
};

/** 出勤可選時間：09:00～17:30（每 30 分鐘） */
const WORK_TIME_START = '09:00';
const WORK_TIME_END = '17:30';
/** 延長工時可選時間：17:30～24:00（每 30 分鐘） */
const OT_TIME_START = '17:30';
const OT_TIME_END = '24:00';

function timeToMinutes(t) {
  const [h, m] = String(t || '0:0').split(':').map(Number);
  // 支援 24:00
  if (Number(h) === 24 && (Number(m) || 0) === 0) return 24 * 60;
  return (h || 0) * 60 + (m || 0);
}

function minutesToTime(mins) {
  if (mins >= 24 * 60) return '24:00';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 將時間對齊 30 分，並限制在指定範圍（預設出勤 09:00～17:30） */
function clampWorkTime(time, fallback = WORK_TIME_START, rangeStart = WORK_TIME_START, rangeEnd = WORK_TIME_END) {
  let t = time || fallback;
  const [hh0, mm0] = String(t).split(':').map(Number);
  let hh = Number.isFinite(hh0) ? hh0 : 9;
  let mm = Number.isFinite(mm0) ? mm0 : 0;
  if (mm !== 0 && mm !== 30) {
    if (mm < 15) mm = 0;
    else if (mm < 45) mm = 30;
    else {
      mm = 0;
      hh += 1;
    }
  }
  let mins = hh * 60 + mm;
  const minM = timeToMinutes(rangeStart);
  const maxM = timeToMinutes(rangeEnd);
  if (mins < minM) mins = minM;
  if (mins > maxM) mins = maxM;
  return minutesToTime(mins);
}

/**
 * 產生半小時時間選項
 * @param {string} selected
 * @param {{ start?: string, end?: string }} range 預設 09:00～17:30
 */
function halfHourTimeOptions(selected = '', range = {}) {
  const rStart = range.start || WORK_TIME_START;
  const rEnd = range.end || WORK_TIME_END;
  const startM = timeToMinutes(rStart);
  const endM = timeToMinutes(rEnd);
  const sel = clampWorkTime(
    selected || rStart,
    rStart,
    rStart,
    rEnd
  );
  const opts = [];
  for (let mins = startM; mins <= endM; mins += 30) {
    const t = minutesToTime(mins);
    opts.push(
      `<option value="${t}" ${sel === t ? 'selected' : ''}>${t}</option>`
    );
  }
  return opts.join('');
}

function parseDateTimeParts(val, defaultTime = WORK_TIME_START) {
  if (!val) return { date: '', time: clampWorkTime(defaultTime) };
  const s = String(val).replace(' ', 'T');
  const m = s.match(/^(\d{4}-\d{2}-\d{2})T?(\d{2}:\d{2})?/);
  if (!m) return { date: '', time: clampWorkTime(defaultTime) };
  let time = m[2] || defaultTime;
  time = clampWorkTime(time, defaultTime);
  return { date: m[1], time };
}

function formatDateTimeDisplay(val) {
  if (!val) return '—';
  const s = String(val).replace('T', ' ');
  return s.length >= 16 ? s.slice(0, 16) : s;
}

const ASSIGN_TYPE_LABEL = {
  users: '指定人員',
  form_user: '表單人員（如代理人）',
  dept_head: '部門主管（申請人自選／可略過）',
  department: '指定單位／部門',
  users_pick: '申請人自選（可多位勾選，必填）',
  cosign_pick: '會簽人員（申請人可多位勾選，非必填）',
};

function stepAssignLabel(s) {
  if (!s) return '';
  if (s.assignType === 'form_user') return `表單：${s.formFieldId || 'agent'}`;
  if (s.assignType === 'dept_head') return '自選成員／可略過';
  if (s.assignType === 'department') return `單位：${s.department || '—'}`;
  if (s.assignType === 'users_pick') {
    const n = (s.approverIds || []).length;
    return n ? `申請人自選（${n} 位可選）` : '申請人自選';
  }
  if (s.assignType === 'cosign_pick') return '會簽（選填）';
  const n = (s.approverIds || []).length;
  return n ? `指定 ${n} 人` : '指定人員';
}

/* ============================================================
   簽核流程圖（共用元件）
   使用處：申請詳情、新增申請預覽、流程編輯器預覽
   ============================================================ */

/** 條件式分支 → 人看得懂的說明文字 */
function flowConditionText(s) {
  const c = s && s.condition;
  if (!c || !c.enabled) return '';
  const opText = {
    '>=': '≥',
    '>': '>',
    '<=': '≤',
    '<': '<',
    '==': '=',
    '!=': '≠',
    contains: '包含',
  };
  const op = opText[c.operator] || c.operator || '';
  const field = c.fieldId || '';
  const val = c.value != null ? String(c.value) : '';
  const cond = `${field} ${op} ${val}`.trim();
  return c.action === 'skip' ? `符合「${cond}」則跳過` : `僅當「${cond}」才需簽核`;
}

/** 單一步驟 → 標籤陣列（會簽／自選／條件式…） */
function flowStepTags(s) {
  const tags = [];
  const condText = flowConditionText(s);
  if (condText) tags.push({ cls: 'cond', text: `🔀 條件式`, title: condText });
  if (s.assignType === 'cosign_pick') {
    tags.push({ cls: 'cosign', text: '會簽', title: '申請時可勾選多位會簽人員，皆須核准' });
    tags.push({ cls: 'optional', text: '可略過', title: '未勾選任何人時跳過此關卡' });
  } else if (s.mode === 'all' && (s.approverIds || []).length > 1) {
    tags.push({ cls: 'cosign', text: '需全簽', title: '此關卡所有簽核人都核准後才進入下一關' });
  } else if ((s.approverIds || []).length > 1) {
    tags.push({ cls: '', text: '任一人簽', title: '任一位簽核人核准即可進入下一關' });
  }
  if (s.assignType === 'dept_head') {
    tags.push({ cls: 'optional', text: '可略過', title: '由簽核人自選成員，或直接略過此關卡' });
  }
  if (s.assignType === 'users_pick') {
    tags.push({ cls: '', text: '申請人自選', title: '送出申請時由申請人挑選簽核人' });
  }
  if (s.assignType === 'form_user') {
    tags.push({ cls: '', text: '表單指定', title: '簽核人取自表單欄位的填寫內容' });
  }
  return tags;
}

/** 步驟的簽核人描述（優先顯示實際簽核者） */
function flowStepWho(s, ctx) {
  const nameOf =
    ctx.userName ||
    ((id) => {
      const u = (state.users || []).find((x) => x.id === Number(id));
      return u ? u.name : `#${id}`;
    });
  const acted = (ctx.actionsByStep && ctx.actionsByStep.get(Number(s.order))) || [];
  const approved = acted.filter((a) => a.action === 'approve' || a.action === 'reject');
  if (approved.length) {
    return approved
      .map((a) =>
        a.delegated_for_name
          ? `${a.actor_name}（代理 ${a.delegated_for_name}）`
          : a.actor_name
      )
      .join('、');
  }
  const ids = s.approverIds || [];
  if (ids.length) {
    const names = ids.map(nameOf);
    // 人數多時只列前 3 位，避免節點過長
    return names.length > 3
      ? `${names.slice(0, 3).join('、')} 等 ${names.length} 人`
      : names.join('、');
  }
  if (s.assignType === 'department') return `單位：${s.department || '未指定'}`;
  if (s.assignType === 'form_user') return `表單「${s.formFieldId || 'agent'}」欄位`;
  return '';
}

/* ── v2 圖模型渲染 ────────────────────────────────────────
   線性版把節點排成一列；圖模型需要表達分岔與並行，
   作法是把節點依「離開始節點的最長距離」分層：
   同一層 = 可同時進行的並行分支，垂直堆疊；層與層之間畫箭頭。
   ─────────────────────────────────────────────────────── */

/** 依最長路徑分層（DAG） */
function flowGraphLayers(graph) {
  const nodes = graph.nodes || [];
  const edges = graph.edges || [];
  const inMap = new Map(nodes.map((n) => [n.id, []]));
  const outMap = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    if (inMap.has(e.to)) inMap.get(e.to).push(e);
    if (outMap.has(e.from)) outMap.get(e.from).push(e);
  }
  const depth = new Map();
  const visit = (id, seen) => {
    if (depth.has(id)) return depth.get(id);
    if (seen.has(id)) return 0; // 防禦：理論上不該有環
    seen.add(id);
    const ins = inMap.get(id) || [];
    const d = ins.length ? Math.max(...ins.map((e) => visit(e.from, seen) + 1)) : 0;
    depth.set(id, d);
    return d;
  };
  for (const n of nodes) visit(n.id, new Set());

  const maxD = Math.max(0, ...[...depth.values()]);
  const layers = Array.from({ length: maxD + 1 }, () => []);
  for (const n of nodes) layers[depth.get(n.id) || 0].push(n);
  return { layers, inMap, outMap };
}

/** 單一節點狀態 → CSS class 與圖示 */
function flowGraphNodeState(node, states, request) {
  const st = states ? states[node.id] : null;
  if (node.type === 'start') return { cls: 'is-start is-done', icon: '✓' };
  if (node.type === 'end') {
    if (request?.status === 'rejected') return { cls: 'is-end is-rejected', icon: '✕' };
    if (st?.state === 'approved' || request?.status === 'approved') {
      return { cls: 'is-end is-done', icon: '✓' };
    }
    return { cls: 'is-end is-todo', icon: '🏁' };
  }
  if (node.type === 'join') {
    return { cls: st?.state === 'approved' ? 'is-join is-done' : 'is-join is-todo', icon: '⋈' };
  }
  if (!st) return { cls: 'is-todo', icon: '' };
  if (st.state === 'approved') return { cls: 'is-done', icon: '✓' };
  if (st.state === 'rejected') return { cls: 'is-rejected', icon: '✕' };
  if (st.state === 'skipped') return { cls: 'is-skipped', icon: '⤳' };
  return { cls: 'is-current', icon: '' };
}

/**
 * 產生 v2 圖模型流程圖
 * @param {Object} graph { nodes, edges }
 * @param {Object} opts { request, nodeStates, showLegend, userName }
 */
function flowGraphHtml(graph, opts = {}) {
  if (!graph || !Array.isArray(graph.nodes) || !graph.nodes.length) return '';
  const states = opts.nodeStates || null;
  const request = opts.request || null;
  const { layers, inMap } = flowGraphLayers(graph);

  const nameOf =
    opts.userName ||
    ((id) => {
      const u = (state.users || []).find((x) => x.id === Number(id));
      return u ? u.name : `#${id}`;
    });

  const nodeHtml = (node) => {
    const { cls, icon } = flowGraphNodeState(node, states, request);
    const st = states ? states[node.id] : null;

    if (node.type === 'start') {
      return `<div class="flow-node ${cls}">
        <div class="fn-head"><span class="fn-no">${icon}</span><span class="fn-name">申請人</span></div>
        ${request?.requester_name ? `<div class="fn-who">${esc(request.requester_name)}</div>` : ''}
      </div>`;
    }
    if (node.type === 'end') {
      const label = request?.status === 'rejected' ? '已駁回' : request?.status === 'cancelled' ? '已取消' : '完成';
      return `<div class="flow-node ${cls}">
        <div class="fn-head"><span class="fn-no">${icon}</span><span class="fn-name">${esc(label)}</span></div>
        ${request?.completed_at ? `<div class="fn-who">${esc(String(request.completed_at).slice(0, 16))}</div>` : ''}
      </div>`;
    }
    if (node.type === 'join') {
      const n = (inMap.get(node.id) || []).length;
      const title = node.mode === 'any' ? `任一分支完成即繼續（共 ${n} 條）` : `${n} 條分支全部完成才繼續`;
      return `<div class="flow-node ${cls}" title="${esc(title)}">
        <div class="fn-head"><span class="fn-no">${icon}</span><span class="fn-name">匯合${node.mode === 'any' ? '（任一）' : '（全部）'}</span></div>
      </div>`;
    }

    // approval
    const ids = node.approverIds || [];
    let who = '';
    if (ids.length) {
      const names = ids.map(nameOf);
      who = names.length > 3 ? `${names.slice(0, 3).join('、')} 等 ${names.length} 人` : names.join('、');
    } else if (node.assignType === 'department') {
      who = `單位：${node.department || '未指定'}`;
    } else if (node.assignType === 'form_user') {
      who = `表單「${node.formFieldId || 'agent'}」欄位`;
    }
    const tags = flowStepTags({
      assignType: node.assignType,
      mode: node.mode,
      approverIds: ids,
    });
    const metaBits = [];
    if (st?.completed_at) metaBits.push(esc(String(st.completed_at).slice(0, 16)));
    if (st?.state === 'skipped') metaBits.push('已略過');
    if (st?.ad_hoc) metaBits.push('加簽');

    return `<div class="flow-node ${cls}">
      <div class="fn-head">
        <span class="fn-no">${esc(icon || String(node.name || '').slice(0, 1))}</span>
        <span class="fn-name">${esc(node.name || node.id)}</span>
      </div>
      ${who ? `<div class="fn-who">${esc(who)}</div>` : ''}
      ${
        tags.length
          ? `<div class="fn-tags">${tags
              .map((t) => `<span class="flow-tag ${t.cls}"${t.title ? ` title="${esc(t.title)}"` : ''}>${esc(t.text)}</span>`)
              .join('')}</div>`
          : ''
      }
      ${metaBits.length ? `<div class="fn-meta">${metaBits.join('　')}</div>` : ''}
    </div>`;
  };

  const parts = [];
  layers.forEach((layer, li) => {
    if (li > 0) {
      // 這一層所有連入邊：若有條件則標示，若來源都已完成則轉綠
      const incoming = layer.flatMap((n) => inMap.get(n.id) || []);
      const conds = incoming.filter((e) => e.condition);
      const allDone =
        states &&
        incoming.length > 0 &&
        incoming.every((e) => {
          const s = states[e.from];
          return s && (s.state === 'approved' || s.state === 'skipped');
        });
      const label =
        conds.length === 1
          ? `${conds[0].condition.fieldId} ${flowOpSymbol(conds[0].condition.operator)} ${conds[0].condition.value}`
          : conds.length > 1
            ? `${conds.length} 個條件`
            : '';
      parts.push(
        `<div class="flow-link ${allDone ? 'is-done' : ''} ${conds.length ? 'is-cond' : ''}"${
          label ? ` title="${esc(label)}"` : ''
        }>${label ? `<span class="flow-edge-label">${esc(label)}</span>` : ''}</div>`
      );
    }
    parts.push(
      `<div class="flow-layer ${layer.length > 1 ? 'is-parallel' : ''}">${layer.map(nodeHtml).join('')}</div>`
    );
  });

  return `<div class="flow-graph">${parts.join('')}</div>${flowLegendHtml(opts.showLegend)}`;
}

/** 流程圖圖例（狀態色塊說明） */
function flowLegendHtml(show) {
  if (!show) return '';
  return `<div class="flow-legend">
        <span><i class="done"></i>已完成</span>
        <span><i class="current"></i>簽核中</span>
        <span><i class="todo"></i>未開始</span>
        <span><i class="skipped"></i>已略過</span>
        <span><i class="rejected"></i>駁回</span>
      </div>`;
}

function flowOpSymbol(op) {
  return (
    { '>=': '≥', '>': '>', '<=': '≤', '<': '<', '==': '=', '!=': '≠', contains: '包含', not_contains: '不包含' }[op] ||
    op
  );
}

/**
 * 產生簽核流程圖 HTML
 * @param {Array} steps 流程步驟（workflow.steps 或 request.steps）
 * @param {Object} opts
 *   - request：申請單（有則顯示實際進度）
 *   - showLegend：是否顯示圖例
 *   - userName：id → 姓名 的函式
 *   - flow：v2 流程圖；有的話改用圖模型渲染
 *   - nodeStates：v2 各節點實際狀態
 */
function flowChartHtml(steps, opts = {}) {
  // v2：有流程圖就用圖模型渲染（可表達分岔與並行）
  const graph = opts.flow || opts.request?.flow || null;
  if (graph && Array.isArray(graph.nodes) && graph.nodes.length) {
    return flowGraphHtml(graph, {
      ...opts,
      nodeStates: opts.nodeStates || opts.request?.nodeStates || null,
    });
  }
  return flowChartLinearHtml(steps, opts);
}

/** v1 線性版渲染（原本的實作，供舊流程與舊單據沿用） */
function flowChartLinearHtml(steps, opts = {}) {
  const list = Array.isArray(steps) ? steps : [];
  const req = opts.request || null;
  const status = req ? String(req.status || '') : '';
  const curStep = req ? Number(req.current_step) : NaN;

  // 依步驟彙整已發生的簽核動作
  const actionsByStep = new Map();
  for (const a of (req && req.actions) || []) {
    const k = Number(a.step_order);
    if (!actionsByStep.has(k)) actionsByStep.set(k, []);
    actionsByStep.get(k).push(a);
  }
  const ctx = { actionsByStep, userName: opts.userName };

  const parts = [];

  // 起點：申請人
  const startDone = !req || status !== 'draft';
  parts.push(`
    <div class="flow-node is-start ${startDone ? 'is-done' : 'is-todo'}">
      <div class="fn-head"><span class="fn-no">${startDone ? '✓' : '0'}</span><span class="fn-name">申請人</span></div>
      ${
        req
          ? `<div class="fn-who">${esc(req.requester_name || '')}</div>`
          : ''
      }
    </div>`);

  list.forEach((s, i) => {
    const order = Number(s.order != null ? s.order : i + 1);
    const acted = actionsByStep.get(order) || [];
    const hasApprove = acted.some((a) => a.action === 'approve');
    const hasReject = acted.some((a) => a.action === 'reject');

    // 判斷節點狀態
    let cls = 'is-todo';
    let icon = String(order);
    if (!req) {
      cls = 'is-todo';
    } else if (hasReject) {
      cls = 'is-rejected';
      icon = '✕';
    } else if (status === 'approved' || order < curStep) {
      // 走過但沒有核准紀錄 → 條件式分支或自選略過
      cls = hasApprove ? 'is-done' : 'is-skipped';
      icon = hasApprove ? '✓' : '⤳';
    } else if (status === 'pending' && order === curStep) {
      cls = 'is-current';
    } else if (status === 'rejected' && order === curStep) {
      cls = 'is-rejected';
      icon = '✕';
    }

    // 連接箭頭（走過的路徑標綠色，條件式標橘色）
    const arrowDone = req && (status === 'approved' || order <= curStep);
    const arrowCond = !!(s.condition && s.condition.enabled);
    parts.push(
      `<div class="flow-arrow ${arrowDone ? 'is-done' : ''} ${arrowCond ? 'is-cond' : ''}"${
        arrowCond ? ` title="${esc(flowConditionText(s))}"` : ''
      }></div>`
    );

    const who = flowStepWho(s, ctx);
    const tags = flowStepTags(s);
    // 完成時間（取該關卡最後一筆核准／駁回）
    const lastAct = [...acted].reverse().find((a) => a.action === 'approve' || a.action === 'reject');
    const metaBits = [];
    if (lastAct && lastAct.created_at) metaBits.push(esc(String(lastAct.created_at).slice(0, 16)));
    if (cls === 'is-skipped') metaBits.push('已略過');

    parts.push(`
      <div class="flow-node ${cls}"${
        flowConditionText(s) ? ` title="${esc(flowConditionText(s))}"` : ''
      }>
        <div class="fn-head">
          <span class="fn-no">${esc(icon)}</span>
          <span class="fn-name">${esc(s.name || `關卡 ${order}`)}</span>
        </div>
        ${who ? `<div class="fn-who">${esc(who)}</div>` : ''}
        ${
          tags.length
            ? `<div class="fn-tags">${tags
                .map(
                  (t) =>
                    `<span class="flow-tag ${t.cls}"${t.title ? ` title="${esc(t.title)}"` : ''}>${esc(t.text)}</span>`
                )
                .join('')}</div>`
            : ''
        }
        ${metaBits.length ? `<div class="fn-meta">${metaBits.join('　')}</div>` : ''}
      </div>`);
  });

  // 終點
  const endDone = status === 'approved';
  const endRejected = status === 'rejected';
  const endCancelled = status === 'cancelled';
  const endCls = endDone ? 'is-done' : endRejected ? 'is-rejected' : 'is-todo';
  const endText = endRejected ? '已駁回' : endCancelled ? '已取消' : '完成';
  parts.push(
    `<div class="flow-arrow ${endDone ? 'is-done' : ''}"></div>`,
    `<div class="flow-node is-end ${endCls}">
      <div class="fn-head"><span class="fn-no">${endDone ? '✓' : endRejected ? '✕' : '🏁'}</span><span class="fn-name">${esc(endText)}</span></div>
      ${
        req && req.completed_at
          ? `<div class="fn-who">${esc(String(req.completed_at).slice(0, 16))}</div>`
          : ''
      }
    </div>`
  );

  return `<div class="flow-chart">${parts.join('')}</div>${flowLegendHtml(opts.showLegend)}`;
}

/** 申請人同部門成員 + 其他人員（供部門主管自選） */
function splitUsersForDeptHeadChooser() {
  const me = state.user;
  const myDepts = new Set(
    [me?.department, ...(me?.departments || [])].filter(Boolean).map(String)
  );
  const all = (state.users || []).filter((u) => u.active !== 0 && u.id !== me?.id);
  const inDept = (u) => {
    const ud = [u.department, ...(u.departments || [])].filter(Boolean).map(String);
    return ud.some((d) => myDepts.has(d));
  };
  if (!myDepts.size) {
    return { deptMembers: [], others: all, myDeptLabel: '' };
  }
  const deptMembers = all.filter(inDept);
  const others = all.filter((u) => !inDept(u));
  return {
    deptMembers,
    others,
    myDeptLabel: [...myDepts].join('、'),
  };
}

/** 渲染部門主管步驟：自選成員或略過 */
function renderDeptHeadChooserHtml(step) {
  const fieldId = `dept_head_${step.order}`;
  const { deptMembers, others, myDeptLabel } = splitUsersForDeptHeadChooser();
  const opt = (u) =>
    `<option value="${u.id}">${esc(u.name)}${
      u.department ? `（${esc(u.department)}）` : ''
    }</option>`;
  let groups = '';
  if (deptMembers.length) {
    groups += `<optgroup label="同部門成員${myDeptLabel ? `（${esc(myDeptLabel)}）` : ''}">${deptMembers
      .map(opt)
      .join('')}</optgroup>`;
  }
  if (others.length) {
    groups += `<optgroup label="${deptMembers.length ? '其他人員' : '全體人員'}">${others
      .map(opt)
      .join('')}</optgroup>`;
  }
  if (!deptMembers.length && !others.length) {
    groups = `<option value="" disabled>尚無可選人員</option>`;
  }
  return `
    <div class="field" data-dept-head-chooser="${esc(fieldId)}" style="grid-column:1/-1">
      <label style="white-space:nowrap">${esc(step.name || '部門主管簽核')}
        <span class="muted" style="font-weight:400">（可指定成員或略過）</span>
      </label>
      <select name="ff_${esc(fieldId)}" data-ff="${esc(fieldId)}" data-type="dept_head">
        <option value="skip" selected>不需要經過部門主管（略過此步驟）</option>
        ${groups}
      </select>
    </div>`;
}

/**
 * 會簽人員：申請人可多位勾選，非必填（不勾＝略過）
 * 名單為全體啟用成員（排除本人）
 */
function renderCosignChooserHtml(step) {
  const fieldId = `cosign_${step.order}`;
  const me = state.user?.id;
  const all = (state.users || []).filter((u) => u.active !== 0 && u.id !== me);
  const checks = all
    .map(
      (u) => `
      <label class="member-pick-row">
        <input type="checkbox" data-ff="${esc(fieldId)}" data-type="cosign_pick"
          value="${u.id}" />
        <span>${esc(u.name)}${u.department ? `（${esc(u.department)}）` : ''}</span>
      </label>`
    )
    .join('');
  return `
    <div class="field" data-cosign-chooser="${esc(fieldId)}" style="grid-column:1/-1">
      <label style="white-space:nowrap">${esc(step.name || '會簽人員')}
        <span class="muted" style="font-weight:400">（選填・可多選・不勾則略過）</span>
      </label>
      <div class="approver-list" style="margin-top:6px;max-height:220px">
        ${
          checks ||
          '<span class="muted">尚無可選人員</span>'
        }
      </div>
    </div>`;
}

/**
 * 申請人自選簽核人（如副總）：勾選方式（可多位，至少一位）
 * 候選名單來自步驟 approverIds
 */
function renderUsersPickChooserHtml(step) {
  const fieldId = `users_pick_${step.order}`;
  const poolIds = (step.approverIds || []).map(Number).filter(Boolean);
  const me = state.user?.id;
  let candidates = (state.users || []).filter(
    (u) => u.active !== 0 && poolIds.includes(u.id) && u.id !== me
  );
  // 若 pool 在 state.users 對不到，仍顯示 id
  if (!candidates.length && poolIds.length) {
    candidates = poolIds
      .filter((id) => id !== me)
      .map((id) => ({ id, name: `使用者 #${id}`, department: '' }));
  }
  const modeHintText =
    candidates.length > 1
      ? (step.mode || 'any') === 'all'
        ? '多位需全部核准'
        : '多位任一核准即可'
      : '';
  const stepLabel = step.name || '副總經理簽核';
  const checks = candidates
    .map(
      (u) => `
      <label class="member-pick-row">
        <input type="checkbox" name="ff_${esc(fieldId)}" data-ff="${esc(fieldId)}"
          data-type="users_pick" value="${u.id}" />
        <span>${esc(u.name)}${u.department ? `（${esc(u.department)}）` : ''}</span>
      </label>`
    )
    .join('');
  return `
    <div class="field" data-users-pick-chooser="${esc(fieldId)}" style="grid-column:1/-1">
      <label style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;white-space:normal;margin-bottom:6px">
        <span style="white-space:nowrap">${esc(stepLabel)} <span style="color:#b91c1c">*</span></span>
        <span class="muted" style="font-weight:400;font-size:0.82rem;white-space:nowrap">必填・可勾選多位${modeHintText ? '・' + modeHintText : ''}</span>
        <button type="button" class="btn sm outline" data-users-pick-all="${esc(fieldId)}">全選</button>
        <button type="button" class="btn sm outline" data-users-pick-none="${esc(fieldId)}">取消全選</button>
      </label>
      <div class="approver-list" style="margin-top:0;max-height:280px">
        ${
          candidates.length
            ? checks
            : `<span class="muted">尚無可選簽核人，請聯絡管理員設定流程</span>`
        }
      </div>
    </div>`;
}

/** 綁定副總等 users_pick 全選／取消全選 */
function bindUsersPickChooser(root) {
  root.querySelectorAll('[data-users-pick-all]').forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.usersPickAll;
      root
        .querySelectorAll(`input[data-type="users_pick"][data-ff="${id}"]`)
        .forEach((cb) => {
          cb.checked = true;
        });
    };
  });
  root.querySelectorAll('[data-users-pick-none]').forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.usersPickNone;
      root
        .querySelectorAll(`input[data-type="users_pick"][data-ff="${id}"]`)
        .forEach((cb) => {
          cb.checked = false;
        });
    };
  });
}

function renderDynamicFieldHtml(f, defaults = {}, opts = {}) {
  const req = f.required ? ' *' : '';
  const reqAttr = f.required ? 'required' : '';
  const ph = f.placeholder ? esc(f.placeholder) : '';
  const name = `ff_${esc(f.id)}`;
  const defVal =
    defaults[f.id] != null && defaults[f.id] !== ''
      ? String(defaults[f.id])
      : '';
  // 請假／電腦異常報修：不使用富文字／自繪表格
  const allowRich = opts.enableRich !== false;
  if (f.type === 'textarea') {
    // 說明／事由等：Word 式富文字（顏色、字級、表格、可貼上）
    // 請假、電腦異常報修整份表單關閉（enableRich: false）
    const useRich =
      allowRich &&
      (/說明|事由|用途|內容|備註|主旨|廠商/.test(String(f.label || '')) ||
        f.id === 'subject' ||
        f.id === 'reason' ||
        f.id === 'purpose' ||
        f.id === 'desc');
    // 舊版 __table 物件轉提示（合併顯示於初始 HTML）
    let initial = defVal;
    const legacyTable = defaults[`${f.id}__table`];
    if (
      useRich &&
      legacyTable &&
      typeof legacyTable === 'object' &&
      Array.isArray(legacyTable.cells)
    ) {
      const rows = legacyTable.cells
        .map(
          (row, ri) =>
            `<tr>${(row || [])
              .map((c) => {
                const tag = ri === 0 ? 'th' : 'td';
                return `<${tag} style="border:1px solid #94a3b8;padding:6px 8px">${esc(c)}</${tag}>`;
              })
              .join('')}</tr>`
        )
        .join('');
      const tbl = `<table border="1" style="border-collapse:collapse;width:100%"><tbody>${rows}</tbody></table>`;
      if (initial && !/<table/i.test(initial)) {
        initial =
          (typeof RichEditor !== 'undefined'
            ? RichEditor.plainToHtml(initial)
            : esc(initial).replace(/\n/g, '<br>')) + tbl;
      } else if (!initial) {
        initial = tbl;
      }
    }
    // 請假等純文字：若誤存 HTML，顯示為純文字
    if (!useRich && typeof RichEditor !== 'undefined' && RichEditor.isProbablyHtml(initial)) {
      initial = RichEditor.htmlToPlain(initial);
    }
    return `<div class="field" style="grid-column:1/-1">
      <label>${esc(f.label)}${req}</label>
      <textarea name="${name}" data-ff="${esc(f.id)}" ${useRich ? 'data-rich="1"' : ''}
        ${reqAttr} placeholder="${
          useRich
            ? ph || '可輸入文字、設定顏色／字級、插入或貼上表格…'
            : ph || ''
        }"
        rows="${useRich ? 5 : 3}">${esc(initial)}</textarea>
      ${
        useRich
          ? `<div class="muted" style="font-size:0.78rem;margin-top:4px">支援粗體／顏色／字級／插入表格；可從 Word、Excel 直接貼上</div>`
          : ''
      }
    </div>`;
  }
  if (f.type === 'select') {
    const opts = (f.options || [])
      .map(
        (o) =>
          `<option value="${esc(o)}" ${defVal === String(o) ? 'selected' : ''}>${esc(o)}</option>`
      )
      .join('');
    return `<div class="field"><label>${esc(f.label)}${req}</label>
      <select name="${name}" data-ff="${esc(f.id)}" ${reqAttr}>
        <option value="">請選擇…</option>${opts}
      </select></div>`;
  }
  if (f.type === 'user') {
    const me = state.user?.id;
    const opts = (state.users || [])
      .filter((u) => u.active !== 0 && u.id !== me)
      .map(
        (u) =>
          `<option value="${u.id}" ${defVal === String(u.id) ? 'selected' : ''}>${esc(u.name)}${
            u.department ? `（${esc(u.department)}）` : ''
          }</option>`
      )
      .join('');
    return `<div class="field"><label>${esc(f.label)}${req}</label>
      <select name="${name}" data-ff="${esc(f.id)}" data-type="user" ${reqAttr}>
        <option value="">請選擇人員…</option>${opts}
      </select></div>`;
  }
  if (f.type === 'datetime') {
    // 請假：09:00～17:30；延長工時／實際工時：17:30～24:00；其餘：00:00～23:30
    const isLeaveRange = f.id === 'start_date' || f.id === 'end_date';
    const isOtRange =
      f.id === 'ot_start' ||
      f.id === 'ot_end' ||
      f.id === 'actual_start' ||
      f.id === 'actual_end' ||
      /延長工時|實際工時/.test(String(f.label || ''));
    const isEnd =
      f.id === 'end_date' ||
      f.id === 'ot_end' ||
      f.id === 'actual_end' ||
      /結束|迄/.test(String(f.label || ''));
    const tStart = isLeaveRange
      ? WORK_TIME_START
      : isOtRange
        ? OT_TIME_START
        : '00:00';
    const tEnd = isLeaveRange
      ? WORK_TIME_END
      : isOtRange
        ? OT_TIME_END
        : '23:30';
    const defaultTime = isEnd
      ? isLeaveRange
        ? WORK_TIME_END
        : isOtRange
          ? '21:00'
          : '18:00'
      : isLeaveRange
        ? WORK_TIME_START
        : isOtRange
          ? OT_TIME_START
          : '18:00';
    const parts = parseDateTimeParts('', defaultTime);
    const selTime = clampWorkTime(parts.time, defaultTime, tStart, tEnd);
    // 日期時間佔一欄（與其他短欄並排）
    return `<div class="field">
      <label>${esc(f.label)}${req}</label>
      <div class="datetime-row" data-datetime-field="${esc(f.id)}">
        <input type="date" data-ff-date="${esc(f.id)}" ${reqAttr} title="日期" />
        <select data-ff-time="${esc(f.id)}" ${reqAttr}
          title="時間 ${tStart}～${tEnd}（每 30 分鐘）"
          data-default-time="${defaultTime}">
          ${halfHourTimeOptions(selTime, { start: tStart, end: tEnd })}
        </select>
      </div>
      <input type="hidden" name="${name}" data-ff="${esc(f.id)}" data-type="datetime" value="" />
      <div class="muted" style="font-size:0.8rem;margin-top:4px">
        可選時間 ${tStart}～${tEnd}（每 30 分鐘）
      </div>
    </div>`;
  }
  if (f.type === 'checkbox') {
    return `<div class="field">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
        <input type="checkbox" name="${name}" data-ff="${esc(f.id)}" data-type="checkbox" ${reqAttr} />
        ${esc(f.label)}${req}
      </label></div>`;
  }
  const type = ['number', 'date'].includes(f.type) ? f.type : 'text';
  const valAttr = defVal !== '' ? ` value="${esc(defVal)}"` : '';
  // 天數／小時：最小單位 0.5（避免瀏覽器 step 預設為 1 導致 22.5 被拒）
  const isHalfStep =
    f.type === 'number' &&
    (f.id === 'hours' ||
      f.id === 'days' ||
      f.id === 'actual_hours' ||
      f.id === 'comp_leave_balance' ||
      f.id === 'remaining_special_leave_days' ||
      f.id === 'remaining_special_leave_hours' ||
      /小時|天數|時數/.test(String(f.label || '')));
  const halfHint = isHalfStep
    ? `<div class="muted" style="font-size:0.78rem;margin-top:4px">最小單位 0.5（例：0、0.5、1、3.5、7.5、22.5）</div>`
    : '';

  const isWide =
    /主旨|標題|地址|說明|內容|備註|事由/.test(String(f.label || '')) ||
    f.id === 'subject' ||
    f.id === 'title' ||
    f.id === 'address';
  const fieldStyle = isWide ? 'style="grid-column:1/-1"' : '';

  if (type === 'number' && isHalfStep) {
    return `<div class="field" ${fieldStyle}><label>${esc(f.label)}${req}</label>
      <input type="number" name="${name}" data-ff="${esc(f.id)}" data-half-step="1"
        step="0.5" min="0" inputmode="decimal" ${reqAttr}
        placeholder="${ph}"${valAttr} />
      ${halfHint}
    </div>`;
  }
  return `<div class="field" ${fieldStyle}><label>${esc(f.label)}${req}</label>
    <input type="${type}" name="${name}" data-ff="${esc(f.id)}" ${reqAttr}
      placeholder="${ph}"${valAttr}${type === 'number' ? ' step="any"' : ''} />
    ${halfHint}
  </div>`;
}

/** 對齊 0.5 單位（小時／天數） */
function snapHalfUnit(val) {
  const n = Number(val);
  if (!Number.isFinite(n) || n < 0) return '';
  return String(Math.round(n * 2) / 2);
}

/**
 * 請假最小計算單位（與後端 labor.getLeaveMinUnit 一致）
 * 補休／公假／公傷／病假／事假 → 0.5 小時
 * 特休 → 0.5 日
 * 產假／喪假／曠職 → 1 日
 */
const LEAVE_MIN_UNIT_BY_ID = {
  personal: { unit: 'hour', step: 0.5 },
  sick: { unit: 'hour', step: 0.5 },
  occupational: { unit: 'hour', step: 0.5 },
  official: { unit: 'hour', step: 0.5 },
  comp: { unit: 'hour', step: 0.5 },
  special: { unit: 'day', step: 0.5 },
  maternity: { unit: 'day', step: 1 },
  funeral: { unit: 'day', step: 1 },
  absence: { unit: 'day', step: 1 },
};
const WORK_DAY_HOURS_CLIENT = 7.5;

function matchLeaveTypeIdClient(typeName) {
  const t = String(typeName || '').trim();
  if (!t) return 'other';
  if (/特別休假|特休/.test(t) && !/不休假|代金/.test(t)) return 'special';
  if (/曠職/.test(t)) return 'absence';
  // 公傷須先於病假（避免「公傷病假」命中病假）
  if (/公傷/.test(t)) return 'occupational';
  if (/住院/.test(t)) return 'hospital';
  if (/普通傷病|病假/.test(t)) return 'sick';
  if (/事假/.test(t)) return 'personal';
  if (/婚假/.test(t)) return 'marriage';
  if (/祭儀/.test(t)) return 'ritual';
  if (/喪假|喪葬/.test(t)) return 'funeral';
  if (/產假|分娩/.test(t) && !/陪產|產檢/.test(t)) return 'maternity';
  if (/產檢/.test(t) && !/陪產/.test(t)) return 'prenatal';
  if (/安胎/.test(t)) return 'tocolysis';
  if (/陪產/.test(t)) return 'paternity';
  if (/生理/.test(t)) return 'menstrual';
  if (/家庭照顧|家照/.test(t)) return 'family';
  if (/公假/.test(t)) return 'official';
  if (/補休|調休/.test(t)) return 'comp';
  return 'other';
}

function getLeaveMinUnitClient(typeName) {
  const id = matchLeaveTypeIdClient(typeName);
  const base = LEAVE_MIN_UNIT_BY_ID[id] || { unit: 'day', step: 0.5 };
  const label =
    base.unit === 'hour' ? `${base.step} 小時` : `${base.step} 日`;
  return { id, unit: base.unit, step: base.step, label };
}

function snapToStepClient(n, step) {
  const x = Number(n);
  const s = Number(step);
  if (!Number.isFinite(x) || x < 0) return 0;
  if (!Number.isFinite(s) || s <= 0) return x;
  return Math.round((Math.round(x / s) * s) * 1000) / 1000;
}

/** 依假別對齊天數／小時（試算與手動修改） */
function applyLeaveMinUnitClient(leaveType, daysIn, hoursIn) {
  const rule = getLeaveMinUnitClient(leaveType);
  let days = Number(daysIn);
  let hours = Number(hoursIn);
  if (!Number.isFinite(days) || days < 0) days = 0;
  if (!Number.isFinite(hours) || hours < 0) hours = 0;

  if (rule.unit === 'hour') {
    let h = hours > 0 ? hours : days * WORK_DAY_HOURS_CLIENT;
    h = snapToStepClient(h, rule.step);
    if (h > 0 && h < rule.step) h = rule.step;
    return {
      days: Math.round((h / WORK_DAY_HOURS_CLIENT) * 1000) / 1000,
      hours: h,
      rule,
    };
  }
  let d = days > 0 ? days : hours / WORK_DAY_HOURS_CLIENT;
  d = snapToStepClient(d, rule.step);
  if (d > 0 && d < rule.step) d = rule.step;
  // 特休：只以日計，不換算／填寫小時
  if (rule.id === 'special') {
    return { days: d, hours: 0, rule };
  }
  return {
    days: d,
    hours: snapToStepClient(d * WORK_DAY_HOURS_CLIENT, 0.5),
    rule,
  };
}

function leaveUnitHintText(leaveType) {
  const rule = getLeaveMinUnitClient(leaveType);
  if (rule.id === 'special') {
    return `此假別（特休）最小單位 0.5 日，以日計算，不換算小時`;
  }
  if (rule.unit === 'hour') {
    return `此假別最小單位 ${rule.label}（以小時為準；全日＝7.5 小時）。例：0.5、1、1.5、3.5、7.5 小時`;
  }
  if (rule.step === 1) {
    return `此假別最小單位 1 日（僅能請整天，不可半日／小時）`;
  }
  return `此假別最小單位 0.5 日（例：0.5、1、1.5 日；全日＝7.5 小時）`;
}

/**
 * 解析日期時間（支援 24:00＝當日結束／次日 00:00）
 * @returns {Date|null}
 */
function parseOtDateTime(val) {
  if (!val) return null;
  const m = String(val)
    .trim()
    .replace(' ', 'T')
    .match(/^(\d{4}-\d{2}-\d{2})T?(\d{2}):(\d{2})/);
  if (!m) return null;
  const y = Number(m[1].slice(0, 4));
  const mo = Number(m[1].slice(5, 7)) - 1;
  const d = Number(m[1].slice(8, 10));
  let hh = Number(m[2]);
  let mm = Number(m[3]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  // 24:00 → 次日 00:00
  if (hh === 24 && mm === 0) {
    const dt = new Date(y, mo, d + 1, 0, 0, 0, 0);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  const dt = new Date(y, mo, d, hh, mm, 0, 0);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/**
 * 延長工時時數：結束−開始，對齊 0.5 小時
 * @returns {number|null} 無效或結束≤開始時回傳 null
 */
function calcOvertimeHours(startStr, endStr) {
  const a = parseOtDateTime(startStr);
  const b = parseOtDateTime(endStr);
  if (!a || !b) return null;
  if (b.getTime() <= a.getTime()) return null;
  let h = (b.getTime() - a.getTime()) / 3600000;
  h = Math.round(h * 2) / 2;
  if (h > 0 && h < 0.5) h = 0.5;
  return h;
}

/**
 * 綁定起迄時間 → 時數自動換算
 * @param {HTMLElement} root
 * @param {{ startId: string, endId: string, hoursId: string, hintId?: string, hintText?: string }} cfg
 */
function bindHoursAutoCalc(root, cfg) {
  if (!root || !cfg) return;
  const { startId, endId, hoursId, hintId, hintText } = cfg;
  const startDate = root.querySelector(`[data-ff-date="${startId}"]`);
  const startTime = root.querySelector(`[data-ff-time="${startId}"]`);
  const endDate = root.querySelector(`[data-ff-date="${endId}"]`);
  const endTime = root.querySelector(`[data-ff-time="${endId}"]`);
  const hoursInp = root.querySelector(`[data-ff="${hoursId}"]`);
  if (!hoursInp || (!startDate && !startTime && !endDate && !endTime)) return;

  // 時數改為唯讀自動帶入（仍可後端驗證）
  hoursInp.readOnly = true;
  hoursInp.title = '依起迄時間自動換算（最小 0.5 小時）';
  hoursInp.placeholder = '依起迄自動換算';
  if (hoursInp.hasAttribute('required')) {
    // 保持 required，送出前會寫入值
  }

  let hint = hintId ? root.querySelector(`#${hintId}`) : null;
  const hintHost = hoursInp.parentElement;
  if (hintHost && hintId && !hint) {
    hint = document.createElement('div');
    hint.id = hintId;
    hint.className = 'muted';
    hint.style.cssText = 'font-size:0.82rem;margin-top:4px;line-height:1.4';
    hint.textContent =
      hintText ||
      '時數依開始／結束自動換算（17:30～24:00，最小 0.5 小時／30 分鐘）';
    hintHost.appendChild(hint);
  }

  const recalc = () => {
    syncDateTimeHidden(root, startId);
    syncDateTimeHidden(root, endId);
    const a = root.querySelector(`[data-ff="${startId}"]`)?.value;
    const b = root.querySelector(`[data-ff="${endId}"]`)?.value;
    if (!a || !b) {
      hoursInp.value = '';
      if (hint) {
        hint.textContent =
          hintText ||
          '時數依開始／結束自動換算（17:30～24:00，最小 0.5 小時／30 分鐘）';
      }
      return;
    }
    const h = calcOvertimeHours(a, b);
    if (h == null) {
      hoursInp.value = '';
      if (hint) {
        hint.textContent = '結束時間須晚於開始時間，才能換算時數';
        hint.style.color = '#b45309';
      }
      return;
    }
    hoursInp.value = snapHalfUnit(h);
    if (hint) {
      hint.style.color = '';
      const st = a.slice(11, 16);
      const et = b.slice(11, 16);
      const sameDay = a.slice(0, 10) === b.slice(0, 10);
      hint.textContent = sameDay
        ? `自動換算：${st}～${et}＝${h} 小時（最小單位 0.5）`
        : `自動換算：${a.slice(0, 16).replace('T', ' ')}～${b
            .slice(0, 16)
            .replace('T', ' ')}＝${h} 小時`;
    }
  };

  [startDate, startTime, endDate, endTime].forEach((el) => {
    if (el) el.addEventListener('change', recalc);
  });
  // 初次若已有值則試算
  recalc();
}

/** 假別顯示用短名：祭儀假、病假、特休… */
function shortLeaveTypeLabel(type) {
  const s = String(type || '').trim();
  if (!s) return '假別';
  if (/特別休假|特休/.test(s) && !/不休假|代金/.test(s)) return '特休';
  const m = s.match(/（([^）]+)）/);
  if (m) return m[1];
  return s;
}

function isSpecialLeaveTypeClient(type) {
  const t = String(type || '');
  return /特別休假|特休/.test(t) && !/不休假|代金/.test(t);
}

/** 更新欄位 label，保留必填 * 標記 */
function setFieldLabelText(inputEl, text) {
  const lab = inputEl?.closest('.field')?.querySelector('label');
  if (!lab) return;
  const hadReq = !!lab.querySelector('.req') || !!inputEl?.required;
  lab.textContent = '';
  lab.appendChild(document.createTextNode(text));
  if (hadReq) {
    lab.appendChild(document.createTextNode(' '));
    const sp = document.createElement('span');
    sp.className = 'req';
    sp.textContent = '*';
    lab.appendChild(sp);
  }
}

/**
 * 人事簽核：假別（人事核定）變更時
 * - 標籤改為「剩餘{假別}日數（目前／核准後）」
 * - 特休：自動帶入剩餘日數（核准後＝目前−本單）；不再使用／換算小時
 * - 非特休：數值留白，不帶入
 * - 隱藏「剩餘特休小時」欄（若流程定義仍殘留）
 */
function bindHrLeaveTypeAutoRemain(root, labor) {
  if (!root || !labor) return;
  const typeSel = root.querySelector('[data-ff="hr_leave_type"]');
  const daysInp = root.querySelector('[data-ff="remaining_special_leave_days"]');
  const hoursInp = root.querySelector(
    '[data-ff="remaining_special_leave_hours"]'
  );
  // 特休不以小時計算：隱藏殘留的小時欄
  if (hoursInp) {
    const wrap = hoursInp.closest('.field');
    if (wrap) wrap.classList.add('hidden');
    hoursInp.required = false;
    hoursInp.value = '';
    hoursInp.removeAttribute('name');
  }
  if (!typeSel || !daysInp) return;

  // 確保下拉含全部假別選項
  const opts =
    Array.isArray(labor.leaveTypeOptions) && labor.leaveTypeOptions.length
      ? labor.leaveTypeOptions
      : labor.remainByLeaveType
        ? Object.keys(labor.remainByLeaveType)
        : [];
  if (opts.length && typeSel.tagName === 'SELECT') {
    const cur = typeSel.value || labor.leaveType || '';
    const existing = new Set(
      [...typeSel.options].map((o) => o.value).filter(Boolean)
    );
    opts.forEach((opt) => {
      if (!existing.has(opt)) {
        const o = document.createElement('option');
        o.value = opt;
        o.textContent = opt;
        typeSel.appendChild(o);
      }
    });
    if (cur && !existing.has(cur) && !opts.includes(cur)) {
      const o = document.createElement('option');
      o.value = cur;
      o.textContent = cur;
      typeSel.appendChild(o);
    }
    if (cur) typeSel.value = cur;
  }

  const applyRemain = () => {
    const t = typeSel.value || '';
    const isSpecial = isSpecialLeaveTypeClient(t);
    const shortName = shortLeaveTypeLabel(t);
    let days = '';

    if (isSpecial) {
      const map = labor.remainByLeaveType || {};
      if (map[t] && map[t].days !== '' && map[t].days != null) {
        days = map[t].days ?? '';
      } else {
        const before = Number(labor.remainingBefore);
        const thisDays = Number(labor.thisLeaveDays);
        let remain = Number.isFinite(before) ? before : null;
        if (remain != null && Number.isFinite(thisDays) && thisDays > 0) {
          remain = Math.round((remain - thisDays) * 2) / 2;
        }
        if (remain != null) {
          remain = Math.max(0, remain);
          days = String(remain);
        }
      }
    }
    // 非特休：強制留白

    if (daysInp) {
      daysInp.value = isSpecial ? days : '';
      daysInp.required = isSpecial;
      daysInp.placeholder = isSpecial
        ? '例如：7 或 7.5（核准後剩餘日數）'
        : '非特休可留白';
      daysInp.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // 標籤依假別變動（僅日數，不換算小時）
    const dayLabel = isSpecial
      ? `剩餘${shortName}日數（核准後）`
      : `剩餘${shortName}日數（目前）`;
    if (daysInp) setFieldLabelText(daysInp, dayLabel);
  };

  typeSel.addEventListener('change', applyRemain);
  applyRemain();
}

/** 人事簽核：申請人特休剩餘提示區塊 */
let leaveBalanceReqSeq = 0;

/** 新增申請頁：選到請假類流程時，載入並顯示我的請假餘額（僅供參考，實際以人事核定為準） */
async function loadAndRenderLeaveBalance(box) {
  if (!box) return;
  const seq = ++leaveBalanceReqSeq;
  box.innerHTML = `<div class="muted" style="font-size:0.85rem">載入請假餘額中…</div>`;
  try {
    const me = state.user?.id;
    if (!me) {
      box.innerHTML = '';
      return;
    }
    const res = await api(`/api/users/${me}/labor`);
    if (seq !== leaveBalanceReqSeq) return; // 使用者已切換流程，捨棄此結果
    const balances = (res?.labor?.leaveBalances || []).filter(
      (b) => b && (b.hasFixedQuota || b.canTrackManual)
    );
    if (!balances.length) {
      box.innerHTML = '';
      return;
    }
    box.innerHTML = `
      <div class="card" style="background:#f0fdf4;border-color:#86efac;margin-bottom:12px;padding:12px">
        <strong>我的請假餘額</strong>
        <div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:8px 18px;font-size:0.88rem">
          ${balances
            .map(
              (b) =>
                `<span>${esc(b.name)}：剩餘 <strong style="color:#15803d">${esc(
                  String(b.remainingLabel ?? b.remaining ?? '—')
                )}</strong></span>`
            )
            .join('')}
        </div>
        <p class="muted" style="margin:6px 0 0;font-size:0.78rem">僅供參考；實際可休天數與扣除以人事核定為準。</p>
      </div>`;
  } catch (e) {
    if (seq !== leaveBalanceReqSeq) return;
    box.innerHTML = '';
  }
}

function renderApplicantLaborBanner(labor, request) {
  if (!labor) return '';
  const sl = labor.specialLeave || {};
  const thisDays = labor.thisLeaveDays;
  const after =
    labor.remainingAfter != null
      ? labor.remainingAfter
      : labor.suggestRemainingDays;
  const warnAfter = after != null && after < 0;
  const entitled = sl.entitled ?? 0;
  return `
    <div class="card" style="background:#f0fdf4;border-color:#86efac;margin-bottom:12px;padding:12px">
      <strong>申請人特休（成員名單手動可休）</strong>
      <div style="margin-top:8px;font-size:0.9rem;line-height:1.55">
        <div>申請人：${esc(request.requester_name || '')}${
          request.requester_dept ? `（${esc(request.requester_dept)}）` : ''
        }</div>
        <div>到職日：${esc(labor.hireDate || '未設定')}${
          labor.seniority?.label ? ` · 年資：${esc(labor.seniority.label)}（僅顯示）` : ''
        }</div>
        <div>統計年度：${esc(sl.yearLabel || '—')}</div>
        <div>
          可休 <strong>${entitled}</strong> 日（手動）·
          已休 ${sl.used ?? '—'} 日
          ${
            sl.manualUsedDays
              ? `（含手動 ${sl.manualUsedDays || 0} 日）`
              : ''
          } ·
          目前剩餘 <strong style="color:#15803d">${
            labor.remainingBefore != null ? labor.remainingBefore : sl.remaining ?? '—'
          }</strong> 日
        </div>
        ${
          entitled === 0
            ? `<div class="muted" style="margin-top:4px">可休為 0：請至「成員名單」手動填寫特休可休天數。</div>`
            : ''
        }
        ${
          labor.thisIsSpecial && thisDays != null
            ? `<div>
                本單特休申請 <strong>${thisDays}</strong> 日 →
                核准後剩餘
                <strong style="color:${warnAfter ? '#b91c1c' : '#15803d'}">${after}</strong> 日
                ${warnAfter ? '（已超休，請確認）' : '（已自動填入下方「剩餘特休日數」）'}
              </div>`
            : labor.leaveType
              ? `<div>本單假別：${esc(labor.leaveType)}${
                  thisDays != null ? ` · ${thisDays} 日` : ''
                }（非特休時，剩餘欄位可留白）</div>`
              : ''
        }
      </div>
      <p class="muted" style="margin:8px 0 0;font-size:0.8rem">
        特休以<strong>日</strong>計算（不換算小時）。可休日數由成員名單手動設定；統計年度為曆年制（1/1～12/31）。實際給假以人事核定為準。
      </p>
    </div>`;
}

function syncDateTimeHidden(root, fieldId) {
  const dateEl = root.querySelector(`[data-ff-date="${fieldId}"]`);
  const timeEl = root.querySelector(`[data-ff-time="${fieldId}"]`);
  const hidden = root.querySelector(`[data-ff="${fieldId}"][data-type="datetime"]`);
  if (!dateEl || !timeEl || !hidden) return;
  if (dateEl.value && timeEl.value) {
    hidden.value = `${dateEl.value}T${timeEl.value}`;
  } else {
    hidden.value = '';
  }
}

function bindDateTimeFields(root) {
  root.querySelectorAll('[data-datetime-field]').forEach((wrap) => {
    const id = wrap.dataset.datetimeField;
    const dateEl = wrap.querySelector(`[data-ff-date="${id}"]`);
    const timeEl = wrap.querySelector(`[data-ff-time="${id}"]`);
    const onChange = () => syncDateTimeHidden(root, id);
    if (dateEl) dateEl.addEventListener('change', onChange);
    if (timeEl) timeEl.addEventListener('change', onChange);
    onChange();
  });
}

/** 正規化自繪表格資料 */
function normalizeFormTable(raw) {
  if (!raw) return null;
  let obj = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== 'object') return null;
  let cells = obj.cells;
  if (!Array.isArray(cells) || !cells.length) return null;
  cells = cells.map((row) =>
    (Array.isArray(row) ? row : []).map((c) => String(c ?? ''))
  );
  const cols = Math.max(
    1,
    ...cells.map((r) => r.length),
    Number(obj.cols) || 0
  );
  cells = cells.map((r) => {
    const next = r.slice(0, cols);
    while (next.length < cols) next.push('');
    return next;
  });
  // 全空白表格視為無
  const hasContent = cells.some((r) => r.some((c) => String(c).trim()));
  if (!hasContent) return null;
  return {
    rows: cells.length,
    cols,
    header: obj.header !== false,
    cells,
  };
}

function emptyFormTable(rows = 3, cols = 3) {
  const r = Math.min(20, Math.max(1, Number(rows) || 3));
  const c = Math.min(10, Math.max(1, Number(cols) || 3));
  return {
    rows: r,
    cols: c,
    header: true,
    cells: Array.from({ length: r }, () => Array.from({ length: c }, () => '')),
  };
}

function renderFormTableEditorHtml(fieldId, table) {
  const t = normalizeFormTable(table) || emptyFormTable(3, 3);
  const head = t.header;
  let html = `<table class="form-draw-table" data-table-grid="${esc(fieldId)}"><tbody>`;
  t.cells.forEach((row, ri) => {
    html += '<tr>';
    row.forEach((cell, ci) => {
      const tag = head && ri === 0 ? 'th' : 'td';
      html += `<${tag} contenteditable="true" data-r="${ri}" data-c="${ci}" spellcheck="false">${esc(cell)}</${tag}>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  html += `<div class="muted" style="font-size:0.78rem;margin-top:6px">表格 ${t.rows} 列 × ${t.cols} 欄${head ? '（首列為表頭）' : ''}</div>`;
  return html;
}

function readFormTableFromDom(root, fieldId) {
  const grid = root.querySelector(`[data-table-grid="${fieldId}"]`);
  if (!grid) return null;
  const rows = [...grid.querySelectorAll('tr')];
  if (!rows.length) return null;
  const cells = rows.map((tr) =>
    [...tr.querySelectorAll('th,td')].map((td) =>
      (td.innerText || td.textContent || '').replace(/\u00a0/g, ' ').trimEnd()
    )
  );
  return normalizeFormTable({ cells, header: true });
}

function syncFormTableHidden(root, fieldId) {
  const hidden = root.querySelector(
    `input[data-table-for="${fieldId}"][data-type="form_table"]`
  );
  if (!hidden) return;
  const t = readFormTableFromDom(root, fieldId);
  hidden.value = t ? JSON.stringify(t) : '';
  const tools = root.querySelector(`[data-table-tools="${fieldId}"]`);
  const wrap = root.querySelector(`[data-table-wrap="${fieldId}"]`);
  const has = !!t || (wrap && !wrap.classList.contains('hidden') && wrap.querySelector('table'));
  if (tools) {
    tools.querySelectorAll('button[data-table-add-row],button[data-table-add-col],button[data-table-del-row],button[data-table-del-col],button[data-table-clear]').forEach((btn) => {
      btn.disabled = !wrap || wrap.classList.contains('hidden');
    });
  }
  return has;
}

function mountFormTable(root, fieldId, table) {
  const wrap = root.querySelector(`[data-table-wrap="${fieldId}"]`);
  const hidden = root.querySelector(
    `input[data-table-for="${fieldId}"][data-type="form_table"]`
  );
  if (!wrap || !hidden) return;
  const t = normalizeFormTable(table) || emptyFormTable(3, 3);
  wrap.classList.remove('hidden');
  wrap.innerHTML = renderFormTableEditorHtml(fieldId, t);
  hidden.value = JSON.stringify(t);
  syncFormTableHidden(root, fieldId);
  // 編輯時即時寫入 hidden
  wrap.querySelectorAll('[contenteditable]').forEach((cell) => {
    cell.addEventListener('input', () => syncFormTableHidden(root, fieldId));
    cell.addEventListener('blur', () => syncFormTableHidden(root, fieldId));
  });
}

function mutateFormTable(root, fieldId, action) {
  const wrap = root.querySelector(`[data-table-wrap="${fieldId}"]`);
  if (!wrap || wrap.classList.contains('hidden')) return;
  let t = readFormTableFromDom(root, fieldId) || emptyFormTable(3, 3);
  const cells = t.cells.map((r) => r.slice());
  const cols = t.cols;
  if (action === 'add-row') {
    if (cells.length >= 20) return toast('表格最多 20 列', 'error');
    cells.push(Array.from({ length: cols }, () => ''));
  } else if (action === 'add-col') {
    if (cols >= 10) return toast('表格最多 10 欄', 'error');
    cells.forEach((r) => r.push(''));
  } else if (action === 'del-row') {
    if (cells.length <= 1) return toast('至少保留 1 列', 'error');
    cells.pop();
  } else if (action === 'del-col') {
    if (cols <= 1) return toast('至少保留 1 欄', 'error');
    cells.forEach((r) => r.pop());
  } else if (action === 'clear') {
    wrap.classList.add('hidden');
    wrap.innerHTML = '';
    const hidden = root.querySelector(
      `input[data-table-for="${fieldId}"][data-type="form_table"]`
    );
    if (hidden) hidden.value = '';
    syncFormTableHidden(root, fieldId);
    return;
  }
  mountFormTable(root, fieldId, { cells, header: true });
}

/** 綁定說明欄位自繪表格工具列 */
function bindFormTableEditors(root) {
  if (!root) return;
  // 還原既有表格
  root.querySelectorAll('input[data-type="form_table"]').forEach((hidden) => {
    const fieldId = hidden.dataset.tableFor;
    if (!fieldId) return;
    const t = normalizeFormTable(hidden.value);
    if (t) mountFormTable(root, fieldId, t);
    else syncFormTableHidden(root, fieldId);
  });

  root.querySelectorAll('[data-table-insert]').forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.tableInsert;
      const wrap = root.querySelector(`[data-table-wrap="${id}"]`);
      if (wrap && !wrap.classList.contains('hidden') && wrap.querySelector('table')) {
        if (!confirm('已有表格，要重新建立嗎？（內容會清空）')) return;
      }
      const rc = prompt('請輸入列數,欄數（例如 3,4）', '3,3');
      if (rc == null) return;
      const parts = String(rc).split(/[,，xX*／/]/).map((s) => Number(String(s).trim()));
      const rows = parts[0] > 0 ? parts[0] : 3;
      const cols = parts[1] > 0 ? parts[1] : 3;
      mountFormTable(root, id, emptyFormTable(rows, cols));
    };
  });
  const actions = [
    ['data-table-add-row', 'add-row'],
    ['data-table-add-col', 'add-col'],
    ['data-table-del-row', 'del-row'],
    ['data-table-del-col', 'del-col'],
    ['data-table-clear', 'clear'],
  ];
  for (const [attr, action] of actions) {
    root.querySelectorAll(`[${attr}]`).forEach((btn) => {
      btn.onclick = () => {
        const id = btn.getAttribute(attr);
        mutateFormTable(root, id, action);
      };
    });
  }
}

function collectFormData(root) {
  // 先同步所有日期時間隱藏欄位
  root.querySelectorAll('[data-datetime-field]').forEach((wrap) => {
    syncDateTimeHidden(root, wrap.dataset.datetimeField);
  });
  // 同步富文字編輯器 → textarea
  root.querySelectorAll('textarea[data-rich="1"]').forEach((ta) => {
    const surface = root.querySelector(
      `.rich-editor[data-rich-for="${ta.dataset.ff}"] .re-surface`
    );
    if (surface && typeof RichEditor !== 'undefined') {
      ta.value = RichEditor.sanitizeHtml(surface.innerHTML);
      const plain = RichEditor.htmlToPlain(ta.value).trim();
      if (!plain && !/<table/i.test(ta.value)) ta.value = '';
    }
  });
  // 同步舊版自繪表格（相容）
  root.querySelectorAll('input[data-type="form_table"]').forEach((hidden) => {
    const id = hidden.dataset.tableFor;
    if (id) syncFormTableHidden(root, id);
  });
  const data = {};
  const cosignBuckets = {}; // cosign_N → id[]
  const usersPickBuckets = {}; // users_pick_N → id[]
  root.querySelectorAll('[data-ff]').forEach((el) => {
    const id = el.dataset.ff;
    // 會簽多選 checkbox
    if (el.dataset.type === 'cosign_pick' && el.type === 'checkbox') {
      if (!cosignBuckets[id]) cosignBuckets[id] = [];
      if (el.checked) cosignBuckets[id].push(Number(el.value));
      return;
    }
    // 副總等申請人自選：勾選多位
    if (el.dataset.type === 'users_pick' && el.type === 'checkbox') {
      if (!usersPickBuckets[id]) usersPickBuckets[id] = [];
      if (el.checked) usersPickBuckets[id].push(Number(el.value));
      return;
    }
    // 自繪表格：存物件
    if (el.dataset.type === 'form_table') {
      const t = normalizeFormTable(el.value);
      if (t) data[id] = t;
      return;
    }
    // radio：只取 checked
    if (el.type === 'radio') {
      if (el.checked) data[id] = el.value;
      return;
    }
    if (el.dataset.type === 'checkbox' || el.type === 'checkbox') {
      data[id] = !!el.checked;
    } else {
      data[id] = el.value;
    }
  });
  // 會簽：無勾選＝skip；有勾選＝逗號分隔 id
  for (const [id, ids] of Object.entries(cosignBuckets)) {
    const clean = ids.filter((n) => n > 0);
    data[id] = clean.length ? clean.join(',') : 'skip';
  }
  // 申請人自選簽核人：逗號分隔 id（至少一位由送出驗證）
  for (const [id, ids] of Object.entries(usersPickBuckets)) {
    const clean = [...new Set(ids.filter((n) => n > 0))];
    data[id] = clean.length ? clean.join(',') : '';
  }
  return data;
}

/** 送出前檢查 users_pick 至少勾選一位 */
function validateUsersPickRequired(root) {
  const choosers = root.querySelectorAll('[data-users-pick-chooser]');
  for (const box of choosers) {
    const fieldId = box.dataset.usersPickChooser;
    const checked = box.querySelectorAll(
      `input[data-type="users_pick"][data-ff="${fieldId}"]:checked`
    );
    if (!checked.length) {
      const label =
        box.querySelector('label')?.textContent?.replace(/\s*\*\s*$/, '').trim() || '簽核人';
      return `請勾選至少一位「${label}」`;
    }
  }
  return null;
}

function formatFormValue(field, value, formData) {
  if (field?.type === 'checkbox') return value ? '是' : '否';
  if (field?.type === 'datetime') return formatDateTimeDisplay(value);
  if (field?.type === 'user') {
    if (formData?.[`${field.id}__label`]) return formData[`${field.id}__label`];
    if (formData?.[`${field.id}__name`]) return formData[`${field.id}__name`];
    const label = userLabelById(value, '');
    if (label) return label;
  }
  if (value == null || value === '') return '—';
  // 金額＋幣別（請購等）
  if (
    field?.id === 'amount' ||
    (field?.type === 'number' && /金額|總價|費用/.test(String(field?.label || '')))
  ) {
    const cur = formData?.currency || formData?.幣別 || '';
    const num = Number(value);
    const numText = Number.isFinite(num)
      ? num.toLocaleString('en-US', { maximumFractionDigits: 4 })
      : String(value);
    return cur ? `${numText} ${cur}` : numText;
  }
  return String(value);
}

/** 詳情頁：渲染自繪表格 */
function renderFormTableHtml(table) {
  const t = normalizeFormTable(table);
  if (!t) return '';
  let html = '<table class="form-view-table"><tbody>';
  t.cells.forEach((row, ri) => {
    html += '<tr>';
    row.forEach((cell) => {
      const tag = t.header && ri === 0 ? 'th' : 'td';
      html += `<${tag}>${esc(cell) || '&nbsp;'}</${tag}>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  return html;
}

/**
 * 表單欄位顯示：富文字 HTML／分行格式；相容舊版 __table
 */
function renderFormValueHtml(field, value, formData) {
  const raw = value == null || value === '' ? '' : String(value);
  const isRichField =
    field?.type === 'textarea' ||
    field?.id === 'subject' ||
    /主旨|說明|事由|內容|備註|異常|規格/.test(String(field?.label || ''));

  // 富文字 HTML
  if (
    isRichField &&
    typeof RichEditor !== 'undefined' &&
    (RichEditor.isProbablyHtml(raw) || formData?.[`${field?.id}__table`])
  ) {
    let html = raw;
    const legacy = formData?.[`${field?.id}__table`];
    if (legacy && !/<table/i.test(html)) {
      const t = normalizeFormTable(legacy);
      if (t) {
        const rows = t.cells
          .map(
            (row, ri) =>
              `<tr>${row
                .map((c) => {
                  const tag = t.header && ri === 0 ? 'th' : 'td';
                  return `<${tag} style="border:1px solid #94a3b8;padding:6px 8px">${esc(c)}</${tag}>`;
                })
                .join('')}</tr>`
          )
          .join('');
        html =
          (html
            ? RichEditor.isProbablyHtml(html)
              ? html
              : RichEditor.plainToHtml(html)
            : '') +
          `<table border="1" style="border-collapse:collapse;width:100%"><tbody>${rows}</tbody></table>`;
      }
    }
    return RichEditor.renderViewHtml(html || raw);
  }

  const text = formatFormValue(field, value, formData);
  const escaped = esc(text);
  const multiline =
    isRichField ||
    String(text).includes('\n') ||
    String(text).includes('\r');
  const tableHtml = renderFormTableHtml(formData?.[`${field?.id}__table`]);
  let body = '';
  if (multiline && text !== '—') {
    body = `<div class="form-value-pre">${escaped}</div>`;
  } else if (text !== '—' || !tableHtml) {
    body = escaped;
  }
  if (tableHtml) body += tableHtml;
  return body || '—';
}

function renderPlainValueHtml(val) {
  const text = val == null || val === '' ? '—' : String(val);
  const escaped = esc(text);
  if (text !== '—' && (text.includes('\n') || text.includes('\r'))) {
    return `<div class="form-value-pre">${escaped}</div>`;
  }
  return escaped;
}

/** 依 id 取「姓名（部門）」顯示字串；查無此人回傳 fallback */
function userLabelById(id, fallback) {
  const u = (state.users || []).find((x) => x.id === Number(id));
  if (!u) return fallback;
  return u.department ? `${u.name}（${u.department}）` : u.name;
}

/** 「1,2,3」→「姓名（部門）、…」；沒有有效 id 時回傳空字串 */
function userLabelsFromIds(val) {
  return String(val)
    .split(/[,，\s]+/)
    .map(Number)
    .filter((n) => n > 0)
    .map((id) => userLabelById(id, `#${id}`))
    .join('、');
}

function renderFormDataBlock(formFields, formData) {
  const fields = formFields || [];
  const data = formData || {};
  // 部門主管自選欄位（dept_head_N）
  const deptHeadRows = Object.keys(data)
    .filter((k) => /^dept_head_\d+$/.test(k))
    .map((k) => {
      const v = data[k];
      let label = '部門主管';
      let display = '略過';
      if (v && v !== 'skip' && Number(v)) {
        display = userLabelById(
          v,
          data[`${k}__label`] || data[`${k}__name`] || `#${v}`
        );
      }
      return `<dt>${esc(label)}</dt><dd>${esc(display)}</dd>`;
    })
    .join('');
  // 申請人自選簽核人（users_pick_N，如副總；可多位勾選）
  const usersPickRows = Object.keys(data)
    .filter((k) => /^users_pick_\d+$/.test(k))
    .map((k) => {
      const v = data[k];
      let display = data[`${k}__label`] || '—';
      if (data[`${k}__label`]) {
        display = data[`${k}__label`];
      } else if (String(v) === 'all') {
        display = '全部';
      } else if (v) {
        const labels = userLabelsFromIds(v);
        if (labels) display = labels;
      }
      return `<dt style="white-space:nowrap">副總經理簽核</dt><dd style="white-space:nowrap">${esc(display)}</dd>`;
    })
    .join('');
  // 會簽人員 cosign_N（可多位 1,2,3）
  const cosignRows = Object.keys(data)
    .filter((k) => /^cosign_\d+$/.test(k))
    .map((k) => {
      const v = data[k];
      let display = '略過（無會簽）';
      if (data[`${k}__label`]) {
        display = data[`${k}__label`];
      } else if (v && v !== 'skip') {
        const labels = userLabelsFromIds(v);
        if (labels) display = labels;
      }
      return `<dt>會簽人員</dt><dd>${esc(display)}</dd>`;
    })
    .join('');
  if (!fields.length) {
    const keys = Object.keys(data).filter(
      (k) =>
        !k.includes('__') &&
        !/^dept_head_\d+$/.test(k) &&
        !/^users_pick_\d+$/.test(k) &&
        !/^cosign_\d+$/.test(k)
    );
    if (!keys.length && !deptHeadRows && !usersPickRows && !cosignRows) return '';
    return `
      <h3 style="margin-top:20px">表單資料</h3>
      <dl class="kv">
        ${keys.map((k) => `<dt>${esc(k)}</dt><dd>${renderPlainValueHtml(data[k])}</dd>`).join('')}
        ${deptHeadRows}
        ${cosignRows}
        ${usersPickRows}
      </dl>`;
  }
  return `
    <h3 style="margin-top:20px">表單資料</h3>
    <dl class="kv">
      ${fields
        .map(
          (f) =>
            `<dt>${esc(f.label)}</dt><dd>${renderFormValueHtml(f, data[f.id], data)}</dd>`
        )
        .join('')}
      ${deptHeadRows}
      ${cosignRows}
      ${usersPickRows}
    </dl>`;
}

function isOfficeFileName(name) {
  return /\.(docx?|xlsx?|pptx?|odt|ods|odp|csv|rtf)$/i.test(String(name || ''));
}

function isPreviewableAttachmentName(name) {
  return /\.(pdf|png|jpe?g|gif|webp)$/i.test(String(name || ''));
}

function renderAttachmentsBlock(attachments, opts = {}) {
  const list = attachments || [];
  if (!list.length) return '';
  const ooOn = !!opts.onlyOfficeEnabled;
  // 簽核中／草稿可編輯；已核准等完成狀態僅檢視
  const reqStatus = String(opts.requestStatus || '');
  const ooCanEdit = reqStatus === 'pending' || reqStatus === 'draft';
  const fmtSize = (n) => {
    if (!n) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  };
  return `
    <h3 style="margin-top:20px">附件</h3>
    ${
      ooOn
        ? `<p class="muted" style="font-size:0.82rem;margin:0 0 8px">${
            ooCanEdit
              ? 'Word／Excel 可「線上編輯」後自動回存（需 OnlyOffice）。'
              : '簽核已完成，附件僅供「線上檢視」，無法再修改。'
          }</p>`
        : ''
    }
    <ul style="margin:0;padding-left:18px">
      ${list
        .map((a) => {
          const office = ooOn && isOfficeFileName(a.original_name);
          const previewable = isPreviewableAttachmentName(a.original_name);
          return `
        <li style="margin:6px 0;display:flex;flex-wrap:wrap;align-items:center;gap:8px">
          <button type="button" class="linkish" data-dl-att="${a.id}" data-dl-name="${esc(a.original_name || '')}">${esc(a.original_name)}</button>
          ${
            previewable
              ? `<button type="button" class="btn outline sm" data-preview-att="${a.id}" data-preview-name="${esc(a.original_name || '')}">預覽</button>`
              : ''
          }
          ${
            office
              ? `<button type="button" class="btn outline sm" data-oo-edit="${a.id}">${
                  ooCanEdit ? '線上編輯' : '線上檢視'
                }</button>`
              : ''
          }
          <span class="muted" style="font-size:0.82rem">
            ${a.size_bytes ? ` · ${fmtSize(a.size_bytes)}` : ''}
            ${a.uploader_name ? ` · ${esc(a.uploader_name)}` : ''}
            ${
              a.step_order != null && a.step_order !== ''
                ? ` · 步驟 ${esc(String(a.step_order))}`
                : ' · 申請時'
            }
          </span>
        </li>`;
        })
        .join('')}
    </ul>`;
}

async function openAttachmentPreviewModal(attId, attName) {
  openModal(`
    <h3 style="margin-top:0">📎 ${esc(attName || '附件預覽')}</h3>
    <div id="att-preview-box" class="muted" style="font-size:0.9rem">載入中…</div>
    <div class="modal-actions" style="margin-top:16px">
      <button type="button" class="btn outline" data-close-modal>關閉</button>
    </div>
  `);
  $('#modal-panel')?.classList.add('wide');
  const box = $('#att-preview-box');
  try {
    const meta = await api(`/api/attachments/${attId}?inline=1`, {
      expectBlob: true,
      returnMeta: true,
    });
    const url = URL.createObjectURL(meta.blob);
    const ct = String(meta.contentType || meta.blob.type || '').toLowerCase();
    const name = String(meta.filename || attName || '');
    const isPdf = ct.includes('pdf') || /\.pdf$/i.test(name);
    if (box) {
      if (isPdf) {
        box.innerHTML = `<iframe src="${url}" title="附件預覽" style="width:100%;height:min(70vh,560px);border:1px solid var(--border);border-radius:8px;background:#fff"></iframe>`;
      } else {
        box.innerHTML = `<img src="${url}" alt="附件預覽" style="max-width:100%;max-height:min(70vh,560px);border-radius:8px;display:block;margin:0 auto" />`;
      }
    }
    setTimeout(() => URL.revokeObjectURL(url), 120_000);
  } catch (err) {
    if (box) box.innerHTML = '';
    toast(err.message || '附件預覽失敗', 'error');
  }
}

let onlyOfficeScriptPromise = null;
let onlyOfficeEditorInstance = null;

function loadOnlyOfficeScript(src) {
  if (window.DocsAPI) return Promise.resolve();
  if (onlyOfficeScriptPromise) return onlyOfficeScriptPromise;
  onlyOfficeScriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      onlyOfficeScriptPromise = null;
      reject(
        new Error(
          '無法載入 OnlyOffice 腳本，請確認 Document Server 已啟動且 ONLYOFFICE_DOCS_URL 正確'
        )
      );
    };
    document.head.appendChild(s);
  });
  return onlyOfficeScriptPromise;
}

function closeOnlyOfficeEditor(reloadDetailId) {
  try {
    if (onlyOfficeEditorInstance && typeof onlyOfficeEditorInstance.destroyEditor === 'function') {
      onlyOfficeEditorInstance.destroyEditor();
    }
  } catch {
    /* ignore */
  }
  onlyOfficeEditorInstance = null;
  closeModal();
  if (reloadDetailId) {
    navigate('detail', { id: Number(reloadDetailId) });
  }
}

async function openOnlyOfficeEditor(attachmentId, requestId) {
  try {
    const data = await api(`/api/onlyoffice/editor/${attachmentId}`);
    if (!data?.config || !data.docsApiScript) {
      throw new Error(data?.error || '無法取得編輯器設定');
    }
    // HTTPS 頁面不可載入 http:// 腳本（混合內容）；改走同源 /web-apps
    let scriptUrl = data.docsApiScript;
    if (
      typeof location !== 'undefined' &&
      location.protocol === 'https:' &&
      /^http:\/\//i.test(scriptUrl)
    ) {
      scriptUrl = `${location.origin}/web-apps/apps/api/documents/api.js`;
    }
    await loadOnlyOfficeScript(scriptUrl);
    if (!window.DocsAPI || !window.DocsAPI.DocEditor) {
      throw new Error('OnlyOffice DocsAPI 未就緒');
    }

    openModal(`
      <div class="oo-editor-shell">
        <div class="oo-editor-bar">
          <div>
            <strong>${esc(data.fileName || '線上編輯')}</strong>
            <span class="muted" style="margin-left:8px;font-size:0.85rem">
              ${data.canEdit ? '可編輯 · 儲存後自動回寫附件' : '唯讀檢視'}
              · 請於編輯器內儲存後再關閉
            </span>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button type="button" class="btn outline sm" id="btn-oo-close">關閉</button>
          </div>
        </div>
        <div id="onlyoffice-placeholder" class="oo-editor-host"></div>
      </div>
    `);
    const modal = $('#modal');
    const panel = $('#modal-panel');
    if (modal) modal.classList.add('modal-oo-open');
    if (panel) {
      panel.classList.add('modal-panel-oo');
      panel.classList.remove('wide', 'modal-panel-wide');
    }

    // 高度由 CSS 的 flex 撐滿（.oo-editor-host { flex:1 }），
    // 這裡量實際可用高度傳給 DocsAPI —— 它需要明確的 px 值。
    // 原本用 window.innerHeight 沒扣掉標題列，會超出視窗高度。
    const host = document.getElementById('onlyoffice-placeholder');
    const barH = document.querySelector('.oo-editor-bar')?.offsetHeight || 52;
    const editorH = Math.max(480, (host?.clientHeight || window.innerHeight - barH));
    if (host) host.style.width = '100%';

    const cfg = {
      ...data.config,
      width: '100%',
      height: `${editorH}px`,
      type: 'desktop',
      events: {
        onDocumentStateChange: () => {},
        onError: (e) => {
          console.error('OnlyOffice error', e);
          toast(e?.data || 'OnlyOffice 編輯器錯誤', 'error');
        },
        onWarning: (e) => console.warn('OnlyOffice warning', e),
      },
    };
    if (cfg.editorConfig) {
      cfg.editorConfig = {
        ...cfg.editorConfig,
        customization: {
          ...(cfg.editorConfig.customization || {}),
          compactHeader: true,
          zoom: 100,
        },
      };
    }

    onlyOfficeEditorInstance = new window.DocsAPI.DocEditor(
      'onlyoffice-placeholder',
      cfg
    );

    $('#btn-oo-close')?.addEventListener('click', () => {
      closeOnlyOfficeEditor(requestId);
    });
  } catch (e) {
    toast(e.message || '無法開啟線上編輯', 'error');
  }
}

/**
 * 人事核定假別 → 顯示用標籤（副總／總經理詳情、簽核歷程共用）
 * 例：祭儀假 → 剩餘祭儀假日數（目前）；特休 → 剩餘特休日數（核准後）
 */
function hrLeaveFieldLabels(hrLeaveType) {
  const t = String(hrLeaveType || '').trim();
  const shortName = shortLeaveTypeLabel(t);
  const isSpecial = isSpecialLeaveTypeClient(t);
  return {
    hr_leave_type: '假別（人事核定）',
    remaining_special_leave_days: t
      ? isSpecial
        ? `剩餘${shortName}日數（核准後）`
        : `剩餘${shortName}日數（目前）`
      : '剩餘日數',
    hr_note: '人事備註',
  };
}

/** 請假／人事：排除特休「換算小時」欄位 */
function stripSpecialLeaveHoursFields(fields) {
  if (!Array.isArray(fields)) return fields || [];
  return fields.filter((f) => {
    if (!f) return false;
    const id = String(f.id || '');
    const label = String(f.label || '');
    if (id === 'remaining_special_leave_hours') return false;
    if (/剩餘.*特休.*小時|特休.*小時/.test(label) && /剩餘|換算/.test(label)) {
      return false;
    }
    if (id === 'remaining_special_leave_hours') return false;
    return true;
  });
}

function labelForApproverField(key, flatOrFd) {
  const hrLabels = hrLeaveFieldLabels(
    flatOrFd?.hr_leave_type || flatOrFd?.假別 || ''
  );
  if (hrLabels[key]) return hrLabels[key];
  const staticLabels = {
    pc_acquired_date: '原電腦取得日期',
    check_os: '作業系統（Windows10）',
    check_memory: '記憶體（4G 以上）',
    check_disk: '硬碟（SSD 500G 以上）',
    check_3dmark: '3DMARK 分數（500 分以上）',
    check_email: '電子郵件定期清理',
    check_backup: '重要資料定期備份',
    check_battery: '電池容量（70% 以下）',
    handle_result: '電腦處理情形',
    handle_note: '處理說明／其他',
    actual_start: '實際工時開始',
    actual_end: '實際工時結束',
    actual_hours: '實際總計（小時）',
    comp_leave_balance: '目前累計可用時數（補休）',
  };
  return staticLabels[key] || key;
}

function renderApproverDataBlock(approverData) {
  const data = approverData || {};
  const flat = {};
  for (const [k, v] of Object.entries(data)) {
    if (k.startsWith('step_') && v && typeof v === 'object' && v.data) {
      Object.assign(flat, v.data);
    } else if (!k.startsWith('step_') && typeof v !== 'object') {
      flat[k] = v;
    }
  }
  const keys = Object.keys(flat);
  if (!keys.length) return '';
  const isIt =
    flat.pc_acquired_date != null ||
    flat.check_os != null ||
    flat.handle_result != null;
  const sectionTitle = isIt
    ? '管理部／簽核單位填寫'
    : flat.hr_leave_type != null || flat.remaining_special_leave_days != null
      ? '人事／簽核單位填寫'
      : '簽核單位填寫';
  // 顯示順序：假別 → 剩餘日 → 備註 → 其他（不再顯示特休小時）
  const order = ['hr_leave_type', 'remaining_special_leave_days', 'hr_note'];
  const orderedKeys = [
    ...order.filter((k) => keys.includes(k)),
    ...keys.filter(
      (k) =>
        !order.includes(k) &&
        k !== 'remaining_special_leave_hours' &&
        !/特休.*小時|剩餘.*小時/.test(String(k))
    ),
  ];
  return `
    <h3 style="margin-top:20px">${sectionTitle}</h3>
    <dl class="kv">
      ${orderedKeys
        .map((k) => {
          let val = flat[k];
          if (k === 'remaining_special_leave_days' && (val === '' || val == null)) {
            val = '—';
          }
          return `<dt>${esc(labelForApproverField(k, flat))}</dt><dd>${esc(
            val
          )}</dd>`;
        })
        .join('')}
    </dl>`;
}

async function renderNewRequest(body) {
  await loadUsers();
  const workflows = await loadWorkflows(false);
  if (!workflows.length) {
    body.innerHTML = emptyState({
      title: '尚無可用的簽核流程',
      desc: hasPerm('workflows')
        ? '請先建立簽核流程，才能讓同仁送出申請。'
        : '目前沒有已啟用的流程，請洽系統管理員建立或啟用。',
      actions: hasPerm('workflows')
        ? [{ label: '前往簽核流程', go: 'workflows', primary: true }]
        : [{ label: '回總覽', go: 'dashboard', outline: true }],
    });
    bindDataGo(body);
    return;
  }
  body.innerHTML = `
    <div class="card">
      <form id="req-form" class="form-grid">
        <div class="field">
          <label>簽核流程 *</label>
          <select name="workflow_id" required>
            <option value="">請選擇…</option>
            ${workflows
              .map((w) => `<option value="${w.id}">${esc(w.name)}</option>`)
              .join('')}
          </select>
        </div>
        <div id="wf-preview" class="muted"></div>
        <div id="leave-balance-box"></div>
        <div class="field hidden" id="title-field-wrap">
          <label>主旨 *（僅一般簽呈）</label>
          <input name="title" id="req-title" maxlength="200" placeholder="請填寫簽呈主旨" />
          <p class="muted" style="font-size:0.8rem;margin:4px 0 0">其他申請表單不顯示主旨，送出時由系統依表單內容自動產生。</p>
        </div>
        <div id="custom-form-area" class="hidden">
          <div class="form-section-title"><strong>流程表單</strong><span class="muted">依所選流程自動顯示</span></div>
          <div class="custom-form-block form-preview-grid form-fields-multi" id="custom-form-fields"></div>
        </div>
        <div class="field" id="attach-area">
          <label>附件（選填，可多檔上傳）</label>
          <input type="file" id="req-attachments" name="attachments" multiple
            accept=".pdf,.png,.jpg,.jpeg,.gif,.doc,.docx,.xls,.xlsx,.txt,image/*" />
          <div class="muted" style="font-size:0.82rem;margin-top:4px">可一次選取多個檔案上傳（按住 Ctrl／Shift 多選），最多 20 個檔，每個上限 10MB（PDF／圖片／Word／Excel 等）</div>
        </div>
        <div class="field" id="notify-prefs-box">
          <label style="white-space:nowrap">Email 提醒通知${
            state.user?.email
              ? ` <span class="muted" style="font-weight:400">（${esc(state.user.email)}）</span>`
              : ` <span style="color:#b45309;font-weight:400">（尚未設定 Email）</span>`
          }</label>
          <div id="notify-prefs-detail" style="display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px">
            <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;margin:0;white-space:nowrap">
              <input type="checkbox" name="notify_email" id="notify-email-cb" value="1"
                ${state.user?.email_notify !== 0 ? 'checked' : ''} />
              開啟通知
            </label>
            <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;margin:0;white-space:nowrap">
              <input type="checkbox" id="notify-all-cb" />
              全部（核准／駁回／下一步）
            </label>
            <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;margin:0;white-space:nowrap">
              <input type="checkbox" id="notify-approved-cb" class="notify-event-cb" data-event="approved" checked />
              核准
            </label>
            <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;margin:0;white-space:nowrap">
              <input type="checkbox" id="notify-rejected-cb" class="notify-event-cb" data-event="rejected" />
              駁回
            </label>
            <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;margin:0;white-space:nowrap">
              <input type="checkbox" id="notify-step-cb" class="notify-event-cb" data-event="step" />
              下一步
            </label>
          </div>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn primary">送出申請</button>
        </div>
      </form>
    </div>`;

  const sel = body.querySelector('[name=workflow_id]');
  const preview = $('#wf-preview');
  const formArea = $('#custom-form-area');
  const formFieldsBox = $('#custom-form-fields');

  // Email 通知：全部／個別勾選連動
  const bindNotifyPrefsUi = () => {
    const master = $('#notify-email-cb');
    const allCb = $('#notify-all-cb');
    const detail = $('#notify-prefs-detail');
    const events = [
      $('#notify-approved-cb'),
      $('#notify-rejected-cb'),
      $('#notify-step-cb'),
    ].filter(Boolean);
    if (!master || !allCb || !events.length) return;

    const syncAllFromEvents = () => {
      const every = events.every((c) => c.checked);
      const some = events.some((c) => c.checked);
      allCb.checked = every;
      allCb.indeterminate = some && !every;
    };
    const setEventsEnabled = (on) => {
      allCb.disabled = !on;
      events.forEach((c) => {
        c.disabled = !on;
      });
      if (detail) detail.style.opacity = on ? '1' : '0.5';
    };
    const onMaster = () => {
      const on = master.checked;
      setEventsEnabled(on);
      if (on) {
        // 開啟時若全無勾選，預設僅「核准」
        if (!events.some((c) => c.checked)) {
          events.forEach((c) => {
            c.checked = c.id === 'notify-approved-cb' || c.dataset?.event === 'approved';
          });
        }
      }
      syncAllFromEvents();
    };
    master.addEventListener('change', onMaster);
    allCb.addEventListener('change', () => {
      const on = allCb.checked;
      events.forEach((c) => {
        c.checked = on;
      });
      allCb.indeterminate = false;
      if (on && !master.checked) {
        master.checked = true;
        setEventsEnabled(true);
      }
    });
    events.forEach((c) => {
      c.addEventListener('change', () => {
        syncAllFromEvents();
        // 若個別有勾選，確保主開關開啟
        if (events.some((x) => x.checked) && !master.checked) {
          master.checked = true;
          setEventsEnabled(true);
        }
      });
    });
    onMaster();
  };
  bindNotifyPrefsUi();

  const isLeaveWorkflow = (w) => {
    const n = String(w?.name || '');
    return /請假/.test(n);
  };
  /** 一般簽呈：唯一需手動填寫系統「主旨」的流程 */
  const isGeneralMemoWorkflow = (w) => {
    const n = String(w?.name || '');
    return /一般簽呈|簽呈/.test(n) && !/信用額度|請假|請購|報支|出差|加班|報修/.test(n);
  };
  /** 是否顯示主旨輸入（僅一般簽呈） */
  const showTitleField = (w) => isGeneralMemoWorkflow(w);

  /** 電腦異常報修：不使用說明欄富文字／自繪 */
  const isItRepairWorkflow = (w) => {
    const n = String(w?.name || '');
    return /電腦異常|異常報修|報修申請|IT.?Repair/i.test(n);
  };

  /** 請假申請：自動產生主旨 */
  const buildLeaveTitle = (formEl) => {
    const data = collectFormData(formEl);
    const type = data.leave_type || data.假別 || '';
    const start = (data.start_date || '').toString().slice(0, 16);
    const end = (data.end_date || '').toString().slice(0, 16);
    const days = data.days != null && data.days !== '' ? `${data.days}日` : '';
    const hours =
      data.hours != null && data.hours !== '' && Number(data.hours) > 0
        ? `${data.hours}小時`
        : '';
    const parts = ['請假申請'];
    if (type) parts.push(String(type));
    if (start || end) parts.push([start, end].filter(Boolean).join('～'));
    if (days) parts.push(days);
    if (hours) parts.push(hours);
    return parts.join(' · ').slice(0, 200);
  };

  /**
   * 非一般簽呈：不顯示主旨欄，依表單＋流程名稱自動組成（列表／搜尋仍用 title）
   */
  const buildAutoTitle = (w, formEl) => {
    if (isLeaveWorkflow(w)) return buildLeaveTitle(formEl);
    const data = collectFormData(formEl) || {};
    const wfName = String(w?.name || '申請').trim() || '申請';
    const pick = [
      data.subject,
      data.item_name,
      data.purpose,
      data.reason,
      data.destination,
      data.customer_name,
      data.issue_desc,
      data.expense_type,
      data.desc,
      data.ot_option,
      data.trading_products,
    ]
      .map((v) => (v == null ? '' : String(v).trim()))
      .filter(Boolean)
      .map((s) => s.replace(/\s+/g, ' ').slice(0, 80));
    if (pick.length) return `${wfName} · ${pick[0]}`.slice(0, 200);
    return wfName.slice(0, 200);
  };

  const refreshWorkflowUi = () => {
    const w = workflows.find((x) => x.id === Number(sel.value));
    const titleWrap = $('#title-field-wrap');
    const titleInp = $('#req-title');
    const leaveBox = $('#leave-balance-box');
    if (!w) {
      preview.innerHTML = '';
      formArea.classList.add('hidden');
      formFieldsBox.innerHTML = '';
      if (leaveBox) leaveBox.innerHTML = '';
      leaveBalanceReqSeq += 1;
      // 未選流程：先隱藏主旨，選定後再依類型顯示
      if (titleWrap) titleWrap.classList.add('hidden');
      if (titleInp) {
        titleInp.required = false;
        titleInp.value = '';
      }
      return;
    }

    const leaveMode = isLeaveWorkflow(w);
    if (leaveBox) {
      if (leaveMode) {
        loadAndRenderLeaveBalance(leaveBox);
      } else {
        leaveBox.innerHTML = '';
        leaveBalanceReqSeq += 1;
      }
    }
    const needTitle = showTitleField(w);
    const plainTextMode = leaveMode || isItRepairWorkflow(w);
    if (titleWrap) titleWrap.classList.toggle('hidden', !needTitle);
    if (titleInp) {
      titleInp.required = needTitle;
      if (!needTitle) titleInp.value = '';
      else {
        titleInp.placeholder = '請填寫簽呈主旨';
      }
    }

    preview.innerHTML = `
      <div class="muted" style="margin-bottom:8px">簽核層級：申請人送出 → 下列步驟依序簽核</div>
      ${flowChartHtml(w.steps || [], { showLegend: false, flow: w.flow || null })}
      <div class="muted">${esc(w.description || '')}</div>`;
    // 請假表單：確保有「小時」欄（接在天數後）
    let fields = [...(w.formFields || [])];
    if (leaveMode && !fields.some((f) => f.id === 'hours')) {
      const daysIdx = fields.findIndex((f) => f.id === 'days');
      const hoursField = {
        id: 'hours',
        label: '小時',
        type: 'number',
        required: false,
        placeholder: '依起迄自動試算（最小 0.5；全日＝7.5 小時）',
      };
      if (daysIdx >= 0) fields.splice(daysIdx + 1, 0, hoursField);
      else fields.push(hoursField);
    }
    // 天數欄位提示更新
    fields = fields.map((f) => {
      if (f.id === 'days') {
        return {
          ...f,
          placeholder: f.placeholder || '全日 09:00～17:30＝1 日',
        };
      }
      return f;
    });
    const deptHeadSteps = (w.steps || []).filter((s) => s.assignType === 'dept_head');
    const cosignSteps = (w.steps || []).filter((s) => s.assignType === 'cosign_pick');
    const usersPickSteps = (w.steps || []).filter((s) => s.assignType === 'users_pick');
    const hasDeptHead = deptHeadSteps.length > 0;
    const hasCosign = cosignSteps.length > 0;
    const hasUsersPick = usersPickSteps.length > 0;
    if (fields.length || hasDeptHead || hasCosign || hasUsersPick) {
      formArea.classList.remove('hidden');
      const deptHeadHtml = deptHeadSteps.map(renderDeptHeadChooserHtml).join('');
      const cosignHtml = cosignSteps.map(renderCosignChooserHtml).join('');
      const usersPickHtml = usersPickSteps.map(renderUsersPickChooserHtml).join('');
      // 不另開分段標題：標籤與選項同一列／同一區塊橫向顯示
      formFieldsBox.innerHTML =
        fields
          .map((f) =>
            renderDynamicFieldHtml(f, {}, { enableRich: !plainTextMode })
          )
          .join('') +
        deptHeadHtml +
        cosignHtml +
        usersPickHtml;
      bindDateTimeFields(formFieldsBox);
      bindUsersPickChooser(formFieldsBox);
      // 請假、電腦異常報修不綁定富文字／自繪
      if (!plainTextMode) {
        if (typeof RichEditor !== 'undefined') {
          RichEditor.bindAll(formFieldsBox);
        } else {
          bindFormTableEditors(formFieldsBox);
        }
      }
      // 請購：支付方式切換時，更新支付說明提示
      const payMethodSel = formFieldsBox.querySelector('[data-ff="payment_method"]');
      const payNoteInp = formFieldsBox.querySelector('[data-ff="payment_note"]');
      if (payMethodSel && payNoteInp) {
        const payNoteField = payNoteInp.closest('.field');
        const payNoteLabel = payNoteField?.querySelector('label');
        const syncPayNoteHint = () => {
          const m = payMethodSel.value || '';
          if (m === '期票') {
            payNoteInp.placeholder = '請註明期票到期日（例如：115/08/31）';
            if (payNoteLabel) {
              payNoteLabel.childNodes[0].textContent = '期票到期日';
            }
            payNoteField?.classList.remove('hidden');
          } else if (m === '其他') {
            payNoteInp.placeholder = '請說明其他支付方式';
            if (payNoteLabel) {
              payNoteLabel.childNodes[0].textContent = '其他支付說明';
            }
            payNoteField?.classList.remove('hidden');
          } else if (m === '現金') {
            payNoteInp.placeholder = '現金支付可不填';
            if (payNoteLabel) {
              payNoteLabel.childNodes[0].textContent = '支付說明（選填）';
            }
          } else {
            payNoteInp.placeholder = '選「期票」請填到期日；選「其他」請說明';
            if (payNoteLabel) {
              payNoteLabel.childNodes[0].textContent =
                '支付說明（期票到期日／其他說明）';
            }
          }
        };
        payMethodSel.addEventListener('change', syncPayNoteHint);
        syncPayNoteHint();
      }
      // 請假：起始／結束變更時試算天數＋小時（依假別最小單位）
      const startDate = formFieldsBox.querySelector('[data-ff-date="start_date"]');
      const startTime = formFieldsBox.querySelector('[data-ff-time="start_date"]');
      const endDate = formFieldsBox.querySelector('[data-ff-date="end_date"]');
      const endTime = formFieldsBox.querySelector('[data-ff-time="end_date"]');
      const daysInp = formFieldsBox.querySelector('[data-ff="days"]');
      const hoursInp = formFieldsBox.querySelector('[data-ff="hours"]');
      const leaveTypeSel = formFieldsBox.querySelector('[data-ff="leave_type"]');
      // 試算說明列
      let leaveHint = formFieldsBox.querySelector('#leave-days-hint');
      const hintHost = hoursInp?.parentElement || daysInp?.parentElement;
      if (leaveMode && hintHost && !leaveHint) {
        leaveHint = document.createElement('div');
        leaveHint.id = 'leave-days-hint';
        leaveHint.className = 'muted';
        leaveHint.style.cssText = 'font-size:0.82rem;margin-top:4px;line-height:1.4';
        leaveHint.textContent =
          '試算：全日＝1 日／7.5 小時；最小單位依假別（事假／病假／公假／公傷／補休＝0.5 小時；特休＝0.5 日；產假／喪假／曠職＝1 日）';
        hintHost.appendChild(leaveHint);
      }
      const syncLeaveFieldSteps = () => {
        if (!leaveMode) return;
        const lt = leaveTypeSel?.value || '';
        const rule = getLeaveMinUnitClient(lt);
        if (daysInp) {
          daysInp.step = rule.unit === 'day' ? String(rule.step) : 'any';
          daysInp.min = '0';
          if (rule.unit === 'day' && rule.step === 1) {
            daysInp.placeholder = '整日（最小 1 日）';
          } else if (rule.unit === 'day') {
            daysInp.placeholder = '最小 0.5 日（全日＝1）';
          } else {
            daysInp.placeholder = '由小時換算（最小 0.5 小時）';
          }
        }
        if (hoursInp) {
          const hoursWrap = hoursInp.closest('.field');
          // 特休：隱藏小時欄（以日為準，不換算小時）
          if (rule.id === 'special') {
            if (hoursWrap) hoursWrap.classList.add('hidden');
            hoursInp.value = '';
            hoursInp.required = false;
          } else {
            if (hoursWrap) hoursWrap.classList.remove('hidden');
            hoursInp.step = rule.unit === 'hour' ? String(rule.step) : 'any';
            hoursInp.min = '0';
            if (rule.unit === 'hour') {
              hoursInp.placeholder = '最小 0.5 小時（全日＝7.5）';
            } else if (rule.step === 1) {
              hoursInp.placeholder = '整日假＝天數×7.5 小時';
            } else {
              hoursInp.placeholder = '依起迄自動試算';
            }
          }
        }
        if (leaveHint && !startDate?.value) {
          leaveHint.textContent = leaveUnitHintText(lt);
        }
      };
      const maybeFillDays = () => {
        if (!startDate?.value || !endDate?.value) {
          syncLeaveFieldSteps();
          return;
        }
        syncDateTimeHidden(formFieldsBox, 'start_date');
        syncDateTimeHidden(formFieldsBox, 'end_date');
        const a = formFieldsBox.querySelector('[data-ff="start_date"]')?.value;
        const b = formFieldsBox.querySelector('[data-ff="end_date"]')?.value;
        if (!a || !b) return;
        const leaveType = leaveTypeSel?.value || '';
        let rawDays = 0;
        let rawHours = 0;
        if (typeof TwCalendar === 'undefined' || !TwCalendar.calcLeaveDays) {
          const t0 = new Date(a.replace(' ', 'T')).getTime();
          const t1 = new Date(b.replace(' ', 'T')).getTime();
          if (Number.isNaN(t0) || Number.isNaN(t1) || t1 < t0) return;
          const sameDay = a.slice(0, 10) === b.slice(0, 10);
          const st = a.slice(11, 16);
          const et = b.slice(11, 16);
          let h = Math.max(0, (t1 - t0) / 3600000);
          h = Math.round(h * 2) / 2;
          if (h > 0 && h < 0.5) h = 0.5;
          let d = 0;
          if (sameDay && st === '09:00' && et === '12:30') d = 0.5;
          else if (sameDay && st >= '13:30' && et === '17:30') d = 0.5;
          else if (sameDay && st === '09:00' && et === '17:30') {
            d = 1;
            h = 7.5;
          }
          rawDays = d;
          rawHours = h;
        } else {
          const result = TwCalendar.calcLeaveDays(a, b);
          rawDays = result.days > 0 ? result.days : 0;
          rawHours = result.hours > 0 ? result.hours : 0;
        }
        const aligned = applyLeaveMinUnitClient(leaveType, rawDays, rawHours);
        if (daysInp) daysInp.value = String(aligned.days);
        if (hoursInp) {
          if (aligned.rule?.id === 'special') {
            hoursInp.value = '';
          } else {
            hoursInp.value = String(aligned.hours);
          }
        }
        if (leaveHint) {
          leaveHint.textContent =
            aligned.rule?.id === 'special'
              ? `試算：${aligned.days} 日（特休以日計算，不換算小時）`
              : `試算：${aligned.days} 日、${aligned.hours} 小時（${leaveUnitHintText(leaveType)}）`;
        }
        syncLeaveFieldSteps();
      };
      if (leaveMode) {
        [startDate, startTime, endDate, endTime].forEach((el) => {
          if (el) el.addEventListener('change', maybeFillDays);
        });
        if (leaveTypeSel) {
          leaveTypeSel.addEventListener('change', () => {
            // 切換假別：若已有起迄則重算；否則只更新提示與 step
            if (startDate?.value && endDate?.value) maybeFillDays();
            else syncLeaveFieldSteps();
          });
        }
        syncLeaveFieldSteps();
      }
      // 延長工時：起迄 → 申請時數自動換算
      if (
        formFieldsBox.querySelector('[data-ff-date="ot_start"]') ||
        formFieldsBox.querySelector('[data-ff-time="ot_start"]')
      ) {
        bindHoursAutoCalc(formFieldsBox, {
          startId: 'ot_start',
          endId: 'ot_end',
          hoursId: 'hours',
          hintId: 'ot-hours-hint',
          hintText:
            '申請時數依延長工時開始／結束自動換算（17:30～24:00，最小 0.5 小時）',
        });
      }
      // 手動修改小時／天數時對齊單位（請假依假別；其餘 0.5）
      formFieldsBox.querySelectorAll('[data-half-step]').forEach((inp) => {
        if (inp.readOnly) return;
        const snap = () => {
          if (inp.value === '' || inp.value == null) return;
          const ff = inp.getAttribute('data-ff') || '';
          if (leaveMode && (ff === 'days' || ff === 'hours')) {
            const lt = leaveTypeSel?.value || '';
            const d =
              ff === 'days'
                ? inp.value
                : formFieldsBox.querySelector('[data-ff="days"]')?.value;
            const h =
              ff === 'hours'
                ? inp.value
                : formFieldsBox.querySelector('[data-ff="hours"]')?.value;
            const aligned = applyLeaveMinUnitClient(lt, d, h);
            const daysEl = formFieldsBox.querySelector('[data-ff="days"]');
            const hoursEl = formFieldsBox.querySelector('[data-ff="hours"]');
            if (daysEl) daysEl.value = String(aligned.days);
            if (hoursEl) hoursEl.value = String(aligned.hours);
            return;
          }
          inp.value = snapHalfUnit(inp.value);
        };
        inp.addEventListener('change', snap);
        inp.addEventListener('blur', snap);
      });
    } else {
      formArea.classList.add('hidden');
      formFieldsBox.innerHTML = '';
    }
  };

  sel.onchange = refreshWorkflowUi;

  $('#req-form').onsubmit = async (e) => {
    e.preventDefault();
    const pickErr = validateUsersPickRequired(e.target);
    if (pickErr) {
      toast(pickErr, 'error');
      return;
    }
    const fd = new FormData(e.target);
    const fileInput = $('#req-attachments');
    const files = fileInput?.files ? [...fileInput.files] : [];
    if (files.length > 20) {
      toast('附件最多 20 個', 'error');
      return;
    }
    try {
      const w = workflows.find((x) => x.id === Number(fd.get('workflow_id')));
      let title = String(fd.get('title') || '').trim();
      // 僅一般簽呈需手動填主旨；其餘（含請假）自動組成
      if (!showTitleField(w)) {
        title = buildAutoTitle(w, e.target);
      }
      if (!title) {
        toast(showTitleField(w) ? '請填寫主旨' : '無法產生主旨，請檢查表單', 'error');
        return;
      }
      // 一律用 FormData，方便帶附件（不再送申請內容）
      const body = new FormData();
      body.append('workflow_id', String(fd.get('workflow_id')));
      body.append('title', title);
      body.append('content', '');
      body.append('form_data', JSON.stringify(collectFormData(e.target)));
      const notifyOn = !!e.target.querySelector('#notify-email-cb')?.checked;
      const nApproved = !!e.target.querySelector('#notify-approved-cb')?.checked;
      const nRejected = !!e.target.querySelector('#notify-rejected-cb')?.checked;
      const nStep = !!e.target.querySelector('#notify-step-cb')?.checked;
      const anyEvent = nApproved || nRejected || nStep;
      body.append('notify_email', notifyOn && anyEvent ? '1' : '0');
      body.append(
        'notify_prefs',
        JSON.stringify({
          enabled: notifyOn && anyEvent,
          approved: notifyOn && nApproved,
          rejected: notifyOn && nRejected,
          step: notifyOn && nStep,
          submitted: notifyOn && anyEvent,
          cancelled: notifyOn && anyEvent,
        })
      );
      files.forEach((f) => body.append('attachments', f));
      const { request } = await api('/api/requests', {
        method: 'POST',
        body,
      });
      toast('申請已送出', 'success');
      navigate('detail', { id: request.id });
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

async function renderDetail(body, id) {
  await loadUsers();
  const {
    request,
    canApprove,
    currentStep,
    canAttach,
    isFinalStep,
    canCancel,
    canDelete,
    approverSigned,
    coApprovers,
    applicantLabor,
  } = await api(`/api/requests/${id}`);
  $('#page-title').textContent = `簽核詳情 #${request.id}`;
  const actionsHtml = [];
  if (canApprove) {
    actionsHtml.push(`
      <button type="button" class="btn success" id="btn-approve">核准</button>
      <button type="button" class="btn danger" id="btn-reject">駁回</button>
      <button type="button" class="btn outline" id="btn-cosign" title="臨時邀請其他同仁會簽">➕ 加簽</button>
      <button type="button" class="btn outline" id="btn-forward" title="將目前簽核關卡轉交給其他主管">↗️ 轉簽</button>
    `);
  }
  if (
    (request.requester_id === state.user.id || state.user.role === 'admin') &&
    request.status === 'pending'
  ) {
    actionsHtml.push(
      `<button type="button" class="btn outline" id="btn-remind" title="以 Email 催辦目前步驟簽核人">Email 催辦簽核人</button>`
    );
  }
  // 伺服器判定：已有簽署人簽核則不可取消
  if (canCancel) {
    actionsHtml.push(
      `<button type="button" class="btn outline" id="btn-cancel">取消申請</button>`
    );
  }
  // 簽核中／已結案皆可下載 PDF；已核准且有附件時打包 ZIP
  if (request.status !== 'draft' || request.requester_id === state.user.id || isAdmin()) {
    const attCount = (request.attachments || []).length;
    const zipDl = request.status === 'approved' && attCount > 0;
    actionsHtml.push(
      `<button type="button" class="btn primary" id="btn-pdf" title="${
        zipDl ? '含簽核單 PDF 與附件（ZIP）' : '下載簽核單 PDF'
      }">${zipDl ? `下載 PDF＋附件（${attCount}）` : '下載 PDF'}</button>`
    );
  }
  // 伺服器判定：已有簽署人簽核則不可刪除
  if (canDelete) {
    actionsHtml.push(
      `<button type="button" class="btn danger" id="btn-del-request" title="刪除此申請">刪除申請</button>`
    );
  }
  $('#page-actions').innerHTML = actionsHtml.join(' ');

  const steps = request.steps || [];
  const userName = (id) => {
    const u = (state.users || []).find((x) => x.id === Number(id));
    return u ? u.name : `#${id}`;
  };
  // 簽核流程圖（含實際進度：已完成／簽核中／已略過／駁回）
  const progress = flowChartHtml(steps, {
    request,
    userName,
    showLegend: true,
  });

  const coApproverBanner =
    coApprovers &&
    coApprovers.mode === 'all' &&
    (coApprovers.pending || []).length > 0 &&
    request.status === 'pending'
      ? `<div class="card" style="background:#fff7ed;border-color:#fdba74;margin-bottom:12px">
          <strong>會簽進行中</strong>
          <div class="muted" style="margin-top:6px;font-size:0.9rem">
            此步驟需<strong>全部</strong>簽核人核准後，才會通知下一步（含最終審核者）。
          </div>
          <div style="margin-top:8px;font-size:0.9rem">
            已簽：${
              (coApprovers.approved || []).length
                ? coApprovers.approved.map((p) => esc(p.name)).join('、')
                : '尚無'
            }
            <br/>
            待簽：${coApprovers.pending.map((p) => esc(p.name)).join('、')}
          </div>
        </div>`
      : '';

  const isCreditLimitReq =
    /信用額度/.test(String(request.workflow_name || '')) ||
    /信用額度/.test(String(request.title || ''));
  const finConfirmedAction = (request.actions || []).find(
    (a) => a.step_name === '財務部額度建檔確認'
  );
  const applicantAckAction = (request.actions || []).find(
    (a) => a.step_name === '申請人建檔確認'
  );
  const isFinanceStaff = isFinanceStaffUser();
  const isApplicantSelf =
    Number(request.requester_id) === Number(state.user?.id);

  // 最終核准系統通知：我是否待確認
  const myUid = Number(state.user?.id);
  const myFinalReceipt = (request.finalNotifyReceipts || []).find(
    (r) => Number(r.user_id) === myUid
  );
  const needFinalNotifyAck = myFinalReceipt && !myFinalReceipt.acked_at;
  let finalNotifyBanner = '';
  const isLeaveReq =
    /請假|休假|leave/i.test(String(request.workflow_name || '')) ||
    /請假|休假/i.test(String(request.title || '')) ||
    /自動回覆|Email/i.test(String(myFinalReceipt?.label || ''));
  const fnLabelText =
    myFinalReceipt?.label ||
    (isLeaveReq ? '設定 Email 自動回覆' : '最終核准完成通知');

  if (needFinalNotifyAck) {
    finalNotifyBanner = `
      <div class="card" style="background:#eff6ff;border-color:#93c5fd;margin-bottom:14px;padding:16px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
          <div>
            <strong style="color:#1e40af;font-size:1.05rem">🔔 ${
              isLeaveReq
                ? '請假核准 — 請設定 Email 自動回覆（待確認）'
                : '最終核准完成通知（待您確認收到）'
            }</strong>
            <p style="margin:4px 0 0;font-size:0.88rem;color:#1d4ed8;line-height:1.5">
              此單已完成最終核定（狀態：已核准）。
              ${
                isLeaveReq
                  ? `請為請假同仁<strong>設定 Email 自動回覆</strong>後再確認。<br/>說明：${esc(fnLabelText)}`
                  : `通知說明：${esc(fnLabelText)}`
              }<br/>
              通知時間：${esc(myFinalReceipt.created_at || '')}
            </p>
          </div>
          <button type="button" class="btn primary" id="btn-final-notify-ack" style="white-space:nowrap;padding:8px 18px;font-weight:600">${
            isLeaveReq ? '✅ 已設定自動回覆／確認收到' : '✅ 確認收到通知'
          }</button>
        </div>
      </div>`;
  } else if (myFinalReceipt && myFinalReceipt.acked_at) {
    finalNotifyBanner = `
      <div class="card" style="background:#f0fdf4;border-color:#86efac;margin-bottom:14px;padding:14px">
        <div style="display:flex;align-items:center;gap:12px">
          <span style="font-size:1.4rem">✅</span>
          <div>
            <strong style="color:#166534">${
              isLeaveReq
                ? '已確認（設定 Email 自動回覆）'
                : '您已確認收到最終核准通知'
            }</strong>
            <div class="muted" style="font-size:0.88rem;margin-top:2px">確認時間：${esc(myFinalReceipt.acked_at)}</div>
          </div>
        </div>
      </div>`;
  } else if (
    request.status === 'approved' &&
    (request.finalNotifyReceipts || []).length
  ) {
    // 其他人可看收執狀態摘要
    const receipts = request.finalNotifyReceipts || [];
    const pendingN = receipts.filter((r) => !r.acked_at).length;
    const doneN = receipts.length - pendingN;
    finalNotifyBanner = `
      <div class="card" style="background:#f8fafc;border-color:#e2e8f0;margin-bottom:14px;padding:14px">
        <strong style="color:#334155">最終核准系統通知收執</strong>
        <div class="muted" style="font-size:0.88rem;margin-top:4px">
          已通知 ${receipts.length} 人；已確認 ${doneN}、待確認 ${pendingN}
        </div>
        <ul style="margin:8px 0 0;padding-left:1.2rem;font-size:0.88rem">
          ${receipts
            .map(
              (r) =>
                `<li>${esc(r.user_name || r.user_username || r.user_id)}：${
                  r.acked_at
                    ? `已確認（${esc(r.acked_at)}）`
                    : '<span style="color:#b45309">待確認</span>'
                }</li>`
            )
            .join('')}
        </ul>
      </div>`;
  }

  let financeConfirmBanner = '';
  if (isCreditLimitReq && request.status === 'approved') {
    if (finConfirmedAction) {
      const fdNote =
        finConfirmedAction.form_data?.finance_establishment_note ||
        (typeof finConfirmedAction.form_data === 'string'
          ? (() => {
              try {
                return JSON.parse(finConfirmedAction.form_data || '{}')
                  .finance_establishment_note;
              } catch {
                return '';
              }
            })()
          : '');
      if (!applicantAckAction && (isApplicantSelf || isAdmin())) {
        financeConfirmBanner = `
          <div class="card" style="background:#f0fdf4;border-color:#86efac;margin-bottom:14px;padding:16px">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
              <div>
                <strong style="color:#166534;font-size:1.05rem">📊 財務部授信額度建檔完成（待您點選確認）</strong>
                <div style="font-size:0.9rem;color:#15803d;margin-top:4px">
                  ${esc(finConfirmedAction.actor_name || '財務部')} 已於 ${esc(finConfirmedAction.created_at)} 完成授信額度系統建檔登記。${
                    fdNote ? `<br/>建檔備註：${esc(fdNote)}` : ''
                  }
                </div>
              </div>
              <button type="button" class="btn success" id="btn-applicant-ack" style="white-space:nowrap;padding:8px 18px;font-weight:600">✅ 我知道了（完成確認）</button>
            </div>
          </div>`;
      } else {
        financeConfirmBanner = `
          <div class="card" style="background:#f0fdf4;border-color:#86efac;margin-bottom:14px;padding:16px">
            <div style="display:flex;align-items:center;gap:12px">
              <span style="font-size:1.5rem">✅</span>
              <div>
                <strong style="color:#166534;font-size:1.05rem">財務部授信額度建檔完成 ${applicantAckAction ? '（申請人已確認）' : ''}</strong>
                <div style="font-size:0.9rem;color:#15803d;margin-top:2px">
                  ${esc(finConfirmedAction.actor_name || '財務部')} 已於 ${esc(finConfirmedAction.created_at)} 完成核准額度建檔登記。${
                    fdNote ? `<br/>建檔備註：${esc(fdNote)}` : ''
                  }
                  ${
                    applicantAckAction
                      ? `<br/>申請人確認時間：${esc(applicantAckAction.created_at)}`
                      : ''
                  }
                </div>
              </div>
            </div>
          </div>`;
      }
    } else if (isFinanceStaff) {
      // 僅財務帳號顯示「確認完成額度建檔」
      financeConfirmBanner = `
        <div class="card" style="background:#ecfdf5;border-color:#6ee7b7;margin-bottom:14px;padding:16px">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
            <div>
              <strong style="color:#065f46;font-size:1.05rem">📊 財務部授信額度建檔確認</strong>
              <p style="margin:4px 0 0;font-size:0.88rem;color:#047857">
                總經理已核定通過。請於 ERP 完成授信額度建檔後，點擊下方按鈕完成登記並通知申請人。
              </p>
            </div>
            <button type="button" class="btn success" id="btn-finance-confirm" style="white-space:nowrap;padding:8px 18px;font-weight:600">✅ 確認完成額度建檔</button>
          </div>
        </div>`;
    } else {
      // 總經理／申請人／其他人：僅顯示狀態，不提供建檔確認按鈕
      financeConfirmBanner = `
        <div class="card" style="background:#fffbeb;border-color:#fde68a;margin-bottom:14px;padding:16px">
          <div style="display:flex;align-items:center;gap:12px">
            <span style="font-size:1.5rem">⏳</span>
            <div>
              <strong style="color:#92400e;font-size:1.02rem">已通知財務部進行授信額度建檔</strong>
              <div style="font-size:0.88rem;color:#b45309;margin-top:2px">
                總經理已完成核定。系統已通知財務部；建檔確認作業僅財務部同仁可操作。
              </div>
            </div>
          </div>
        </div>`;
    }
  }

  // 簽核中：申請單以 PDF 呈現（其餘狀態維持表單區塊，仍可下載 PDF）
  const usePdfFormView = request.status === 'pending';

  // OnlyOffice 狀態（可選）
  let onlyOfficeEnabled = false;
  try {
    const oo = await api('/api/onlyoffice/status');
    onlyOfficeEnabled = !!oo.enabled;
  } catch {
    onlyOfficeEnabled = false;
  }

  body.innerHTML = `
    <div class="detail-main">
      ${coApproverBanner}
      ${finalNotifyBanner}
      ${financeConfirmBanner}
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:start;gap:12px;flex-wrap:wrap">
          <div>
            <h3 style="margin:0 0 8px">${esc(request.title)}</h3>
            ${statusTag(request.status)}
          </div>
        </div>
        ${progress}
        <dl class="kv" style="margin-top:16px">
          <dt>流程</dt><dd>${esc(request.workflow_name)}</dd>
          <dt>申請人</dt><dd>${esc(request.requester_name)}${request.requester_dept ? `（${esc(request.requester_dept)}）` : ''}</dd>
          <dt>建立時間</dt><dd>${esc(request.created_at)}</dd>
          ${request.completed_at ? `<dt>完成時間</dt><dd>${esc(request.completed_at)}</dd>` : ''}
          ${currentStep ? `<dt>目前步驟</dt><dd>${esc(currentStep.name)}</dd>` : ''}
          <dt>Email 通知</dt><dd>${
            (() => {
              const mailHint = request.requester_email
                ? `（${esc(request.requester_email)}）`
                : '（申請人未填 Email）';
              if (!request.notify_email) return `未開啟${mailHint}`;
              const p = request.notify_prefs || {};
              const shown = [];
              // 有細項物件時只列 true；舊單據無細項則視為全部
              if (
                p &&
                (Object.prototype.hasOwnProperty.call(p, 'approved') ||
                  Object.prototype.hasOwnProperty.call(p, 'rejected') ||
                  Object.prototype.hasOwnProperty.call(p, 'step'))
              ) {
                if (p.approved) shown.push('核准');
                if (p.rejected) shown.push('駁回');
                if (p.step) shown.push('下一步');
              } else {
                shown.push('核准', '駁回', '下一步');
              }
              if (!shown.length) return `未開啟${mailHint}`;
              return `已開啟：${shown.join('、')}${mailHint}`;
            })()
          }</dd>
        </dl>
        ${
          usePdfFormView
            ? `<div class="pdf-form-view" style="margin-top:16px">
                <div class="pdf-form-toolbar">
                  <strong>申請單（PDF）</strong>
                  <span class="muted" style="font-size:0.82rem">簽核中以正式 PDF 版面檢視</span>
                  <button type="button" class="btn outline sm" id="btn-pdf-reload" style="margin-left:auto">重新載入</button>
                </div>
                <div id="pdf-preview-wrap" class="pdf-preview-wrap">
                  <div class="muted" style="padding:24px;text-align:center">正在產生 PDF 預覽…</div>
                </div>
                <details class="pdf-form-fallback" style="margin-top:12px">
                  <summary class="muted" style="cursor:pointer;font-size:0.9rem">顯示網頁表單內容（備援）</summary>
                  <div style="margin-top:10px">
                    ${renderFormDataBlock(request.formFields, request.form_data)}
                    ${renderApproverDataBlock(request.approver_data)}
                  </div>
                </details>
              </div>`
            : `${renderFormDataBlock(request.formFields, request.form_data)}
               ${renderApproverDataBlock(request.approver_data)}`
        }
        ${renderAttachmentsBlock(request.attachments || [], {
          onlyOfficeEnabled,
          requestStatus: request.status,
        })}
      </div>
      ${
        canApprove
          ? `<div class="card">
              <h3>簽核處理 — ${esc(currentStep?.name || '')}</h3>
              ${
                // 僅人事步驟顯示申請人特休（代理人不顯示）
                applicantLabor &&
                !/代理/.test(String(currentStep?.name || '')) &&
                currentStep?.assignType !== 'form_user'
                  ? renderApplicantLaborBanner(applicantLabor, request)
                  : ''
              }
              ${
                stripSpecialLeaveHoursFields(currentStep?.approverFields || [])
                  .length
                  ? `<div id="step-form-fields" class="form-grid form-fields-multi" style="margin-bottom:12px">
                      ${stripSpecialLeaveHoursFields(
                        currentStep.approverFields || []
                      )
                        .map((f) =>
                          renderDynamicFieldHtml(
                            f,
                            applicantLabor?.fieldPrefill || {}
                          )
                        )
                        .join('')}
                    </div>
                    <p class="muted" style="font-size:0.85rem;margin:0 0 12px">
                      此步驟需填寫上方欄位後再核准。
                      ${
                        applicantLabor
                          ? '切換「假別（人事核定）」時，標籤會改為對應假別（例：剩餘祭儀假日數）。<strong>僅特休</strong>自動帶入剩餘<strong>日數</strong>（核准後，不換算小時）；其他假別數值<strong>留白</strong>。'
                          : /人事/.test(String(currentStep?.name || ''))
                            ? '人事單位：請選擇假別；特休請確認剩餘日數（不換算小時），其他假別可留白。'
                            : /管理部/.test(String(currentStep?.name || ''))
                              ? '管理部：請依檢核標準填寫上方欄位。'
                              : `${esc(currentStep?.name || '簽核單位')}：請填寫上方欄位。`
                      }
                    </p>`
                  : ''
              }
              ${
                canAttach
                  ? `<div class="field" style="margin-bottom:12px">
                      <label>補充附件（選填，可多檔上傳）</label>
                      <input type="file" id="step-attachments" multiple
                        accept=".pdf,.png,.jpg,.jpeg,.gif,.doc,.docx,.xls,.xlsx,.txt,image/*" />
                      <div class="muted" style="font-size:0.82rem;margin-top:4px">
                        中間簽核步驟可一次多選新增附件（Ctrl／Shift 多選，最多 20 個）；亦可先按「僅上傳附件」再核准。最終審核者不可上傳。
                      </div>
                      <div class="form-actions" style="margin-top:8px">
                        <button type="button" class="btn outline sm" id="btn-upload-step-att">僅上傳附件</button>
                      </div>
                    </div>`
                  : isFinalStep
                    ? `<p class="muted" style="font-size:0.85rem;margin:0 0 12px">此為最終審核步驟，不可新增附件。</p>`
                    : ''
              }
              <div class="field" style="margin-bottom:12px;border:1px solid #e2e8f0;border-radius:10px;padding:12px;background:#f8fafc">
                <label style="font-weight:600;margin-bottom:6px;display:block">✍️ 電子簽名檔選擇</label>
                <p class="muted" style="margin:0 0 8px;font-size:0.85rem">預設使用「個人預設簽名」；核准時若未另選現場手寫，將自動套用帳號設定中的簽名。</p>
                <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
                  <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
                    <input type="radio" name="sig_mode" value="default" checked />
                    <span>使用預設個人簽名 ${state.user?.signature_image ? '✅' : '（尚未設定，請至帳號設定）'}</span>
                  </label>
                  <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
                    <input type="radio" name="sig_mode" value="draw" />
                    <span>現場白板手寫簽名</span>
                  </label>
                </div>
                <div id="default-sig-preview" style="margin-top:10px">
                  ${
                    state.user?.signature_image
                      ? `<img src="${state.user.signature_image}" alt="預設簽名" style="max-height:70px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;padding:2px" />`
                      : `<span class="muted" style="font-size:0.85rem">尚未設定個人簽名，可至「帳號設定」建立，或改選現場手寫。</span>`
                  }
                </div>
                <div id="draw-sig-wrap" style="margin-top:10px;display:none">
                  <button type="button" class="btn outline sm" id="btn-open-spot-sig">✏️ 點此開始手寫簽名</button>
                  <div id="spot-sig-preview" style="margin-top:8px"></div>
                </div>
              </div>
              <div class="field"><label>簽核意見</label><textarea id="action-comment" placeholder="選填意見…"></textarea></div>
            </div>`
          : ''
      }
    </div>`;

  let spotSignatureImage = null;

  if (canApprove) {
    const sigRadios = body.querySelectorAll('input[name=sig_mode]');
    const drawWrap = $('#draw-sig-wrap');
    const defaultPrev = $('#default-sig-preview');
    const spotPreview = $('#spot-sig-preview');
    const syncSigModeUi = () => {
      const mode = body.querySelector('input[name=sig_mode]:checked')?.value || 'default';
      if (drawWrap) drawWrap.style.display = mode === 'draw' ? '' : 'none';
      if (defaultPrev) defaultPrev.style.display = mode === 'default' ? '' : 'none';
    };
    sigRadios.forEach((r) => {
      r.addEventListener('change', syncSigModeUi);
    });
    syncSigModeUi();
    // 進詳情時確保個人預設簽名是最新（登入 token 不含簽名圖）
    (async () => {
      try {
        const sigRes = await api('/api/users/me/signature');
        if (sigRes?.signature_image) {
          state.user = { ...(state.user || {}), signature_image: sigRes.signature_image };
          if (defaultPrev && body.querySelector('input[name=sig_mode][value=default]')?.checked) {
            defaultPrev.innerHTML = `<img src="${sigRes.signature_image}" alt="預設簽名" style="max-height:70px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;padding:2px" />`;
          }
        }
      } catch {
        /* ignore */
      }
    })();
    $('#btn-open-spot-sig')?.addEventListener('click', () => {
      openSignaturePadModal({
        title: '現場手寫簽名',
        initialImage: spotSignatureImage,
        onSave: (dataUrl) => {
          spotSignatureImage = dataUrl;
          if (spotPreview) {
            spotPreview.innerHTML = `
              <div style="display:flex;align-items:center;gap:10px">
                <img src="${dataUrl}" style="max-height:65px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;padding:2px" alt="手寫簽名" />
                <span style="color:#15803d;font-size:0.85rem">✅ 已儲存現場簽名</span>
              </div>
            `;
          }
        },
      });
    });
  }

  if (canApprove && (currentStep?.approverFields || []).length) {
    const stepBox = $('#step-form-fields') || body;
    bindDateTimeFields(stepBox);
    // 人事：實際工時起迄 → 實際總計自動換算
    if (
      stepBox.querySelector('[data-ff-date="actual_start"]') ||
      stepBox.querySelector('[data-ff-time="actual_start"]')
    ) {
      bindHoursAutoCalc(stepBox, {
        startId: 'actual_start',
        endId: 'actual_end',
        hoursId: 'actual_hours',
        hintId: 'actual-hours-hint',
        hintText:
          '實際總計依實際工時開始／結束自動換算（17:30～24:00，最小 0.5 小時）',
      });
    }
    // 人事：假別（人事核定）切換 → 剩餘日數／小時自動調整
    bindHrLeaveTypeAutoRemain(stepBox, applicantLabor);
  }

  body.querySelectorAll('[data-dl-att]').forEach((btn) => {
    btn.onclick = async () => {
      try {
        const blob = await api(`/api/attachments/${btn.dataset.dlAtt}`, {
          expectBlob: true,
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = btn.dataset.dlName || `attachment-${btn.dataset.dlAtt}`;
        a.click();
        URL.revokeObjectURL(url);
      } catch (e) {
        toast(e.message, 'error');
      }
    };
  });
  body.querySelectorAll('[data-preview-att]').forEach((btn) => {
    btn.onclick = () =>
      openAttachmentPreviewModal(btn.dataset.previewAtt, btn.dataset.previewName);
  });
  body.querySelectorAll('[data-oo-edit]').forEach((btn) => {
    btn.onclick = () => openOnlyOfficeEditor(btn.dataset.ooEdit, request.id);
  });

  const doAction = async (action) => {
    const comment = $('#action-comment')?.value || '';
    if (action === 'reject' && !comment.trim()) {
      if (!confirm('確定要駁回嗎？（建議填寫意見）')) return;
    }
    let step_form_data = {};
    if (action === 'approve' && (currentStep?.approverFields || []).length) {
      const box = $('#step-form-fields');
      if (box) {
        step_form_data = collectFormData(box);
      }
    }
    const fileInput = $('#step-attachments');
    const files = fileInput?.files ? [...fileInput.files] : [];
    if (files.length > 20) {
      toast('附件最多 20 個', 'error');
      return;
    }
    if (files.length && isFinalStep) {
      toast('最終審核步驟不可新增附件', 'error');
      return;
    }

    let finalSignatureImage = null;
    if (action === 'approve') {
      // 預設一律用個人預設簽名；僅明確選「現場手寫」才用白板
      const selectedMode = body.querySelector('input[name=sig_mode]:checked')?.value || 'default';
      if (selectedMode === 'draw') {
        if (!spotSignatureImage) {
          toast('請先點擊「點此開始手寫簽名」完成現場簽名', 'error');
          return;
        }
        finalSignatureImage = spotSignatureImage;
      } else {
        // default：優先記憶體中的個人簽名，否則再拉一次 API
        finalSignatureImage = state.user?.signature_image || null;
        if (!finalSignatureImage) {
          try {
            const sigRes = await api('/api/users/me/signature');
            finalSignatureImage = sigRes?.signature_image || null;
            if (finalSignatureImage) {
              state.user = { ...(state.user || {}), signature_image: finalSignatureImage };
            }
          } catch {
            /* ignore */
          }
        }
        // 未設定時仍可核准；後端也會再從 DB 套用預設簽名
      }
    }

    try {
      // 有附件時用 FormData；無附件仍可用 FormData 以統一 multipart 路由
      const body = new FormData();
      body.append('action', action);
      body.append('comment', comment || '');
      body.append('step_form_data', JSON.stringify(step_form_data || {}));
      if (finalSignatureImage) {
        body.append('signature_image', finalSignatureImage);
      }
      files.forEach((f) => body.append('attachments', f));
      const result = await api(`/api/requests/${id}/action`, {
        method: 'POST',
        body,
      });
      const msg =
        result?.message ||
        (action === 'approve' ? '已核准' : action === 'reject' ? '已駁回' : '已取消');
      toast(msg, 'success');
      navigate('detail', { id });
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  $('#btn-upload-step-att')?.addEventListener('click', async () => {
    const fileInput = $('#step-attachments');
    const files = fileInput?.files ? [...fileInput.files] : [];
    if (!files.length) {
      toast('請先選擇檔案', 'error');
      return;
    }
    if (files.length > 20) {
      toast('附件最多 20 個', 'error');
      return;
    }
    const fd = new FormData();
    files.forEach((f) => fd.append('attachments', f));
    try {
      const data = await api(`/api/requests/${id}/attachments`, {
        method: 'POST',
        body: fd,
      });
      toast(data.message || '附件已上傳', 'success');
      navigate('detail', { id });
    } catch (e) {
      toast(e.message, 'error');
    }
  });

  $('#btn-approve')?.addEventListener('click', () => doAction('approve'));
  $('#btn-reject')?.addEventListener('click', () => doAction('reject'));
  $('#btn-cosign')?.addEventListener('click', () => openCosignModal(request, () => navigate('detail', { id })));
  $('#btn-forward')?.addEventListener('click', () => openForwardModal(request, () => navigate('detail', { id })));
  $('#btn-cancel')?.addEventListener('click', () => {
    if (confirm('確定取消此申請？')) doAction('cancel');
  });
  $('#btn-remind')?.addEventListener('click', async () => {
    if (
      !confirm(
        '確定寄送 Email 催辦目前步驟簽核人？\n（同一單據 10 分鐘內僅能催辦一次）'
      )
    ) {
      return;
    }
    const btn = $('#btn-remind');
    if (btn) btn.disabled = true;
    try {
      const data = await api(`/api/requests/${id}/remind`, { method: 'POST', body: {} });
      const extra = data.warning ? `（${data.warning}）` : '';
      const toList = Array.isArray(data.emails) ? data.emails.join('、') : '';
      toast(
        `已寄送催辦信給 ${data.sentTo || 0} 位${toList ? `：${toList}` : ''}${extra}`,
        'success'
      );
      navigate('detail', { id });
    } catch (e) {
      toast(e.message || '催辦失敗', 'error');
      if (btn) btn.disabled = false;
    }
  });
  // 簽核中：嵌入 PDF 預覽
  let pdfPreviewObjectUrl = null;
  async function loadRequestPdfPreview() {
    const wrap = $('#pdf-preview-wrap');
    if (!wrap) return;
    wrap.innerHTML =
      '<div class="muted" style="padding:24px;text-align:center">正在產生 PDF 預覽…</div>';
    try {
      const blob = await api(`/api/requests/${id}/pdf?preview=1`, {
        expectBlob: true,
      });
      const type = String(blob?.type || '').toLowerCase();
      if (type && !type.includes('pdf') && !type.includes('octet-stream')) {
        throw new Error(
          `伺服器回傳 ${type || '非 PDF'}（簽核中預覽需 PDF）。請聯絡管理員更新後端，或展開下方網頁表單／下載檔案。`
        );
      }
      // octet-stream：仍嘗試當 PDF 開啟
      const pdfBlob =
        type.includes('pdf') || !type
          ? blob
          : new Blob([await blob.arrayBuffer()], { type: 'application/pdf' });
      if (pdfPreviewObjectUrl) {
        try {
          URL.revokeObjectURL(pdfPreviewObjectUrl);
        } catch {
          /* ignore */
        }
      }
      pdfPreviewObjectUrl = URL.createObjectURL(pdfBlob);
      wrap.innerHTML = `<iframe class="pdf-frame" title="申請單 PDF 預覽" src="${pdfPreviewObjectUrl}#view=FitH"></iframe>`;
    } catch (e) {
      wrap.innerHTML = `<div class="error-msg" style="margin:12px">PDF 預覽失敗：${esc(
        e.message || '未知錯誤'
      )}。請展開下方「網頁表單內容」或按「下載 PDF」。</div>`;
    }
  }
  if (usePdfFormView) {
    loadRequestPdfPreview();
    $('#btn-pdf-reload')?.addEventListener('click', () => loadRequestPdfPreview());
  }

  $('#btn-pdf')?.addEventListener('click', async () => {
    try {
      const { blob, filename } = await api(`/api/requests/${id}/pdf`, {
        returnMeta: true,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const hasAtt = !!(request.attachments && request.attachments.length > 0);
      const isZip =
        blob.type.includes('zip') ||
        (request.status === 'approved' && hasAtt) ||
        /\.zip$/i.test(filename || '');
      // 優先使用伺服器 Content-Disposition；否則依規則組檔名
      a.download =
        filename ||
        buildApprovalDownloadFileName(request, {
          zip: isZip,
          hasAttachments: hasAtt && request.status === 'approved',
        });
      a.click();
      URL.revokeObjectURL(url);
      toast(
        isZip
          ? hasAtt
            ? '已下載 ZIP（含 PDF 與附件）'
            : '已下載 ZIP'
          : 'PDF 已開始下載',
        'success'
      );
    } catch (e) {
      toast(e.message, 'error');
    }
  });
  const finConfirmBtn = $('#btn-finance-confirm');
  if (finConfirmBtn) {
    finConfirmBtn.onclick = async () => {
      const note = prompt(
        '請輸入財務部建檔備註（選填，例如：已於 ERP 系統完成授信額度設定）：'
      );
      if (note === null) return;
      try {
        await api(`/api/requests/${id}/finance-confirm`, {
          method: 'POST',
          body: { note: String(note || '').trim() },
        });
        toast('已完成財務部額度建檔登記，並發送通知至申請人', 'success');
        renderDetail(body, id);
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }
  const applicantAckBtn = $('#btn-applicant-ack');
  if (applicantAckBtn) {
    applicantAckBtn.onclick = async () => {
      try {
        await api(`/api/requests/${id}/applicant-ack`, { method: 'POST' });
        toast('已確認財務部建檔完成！', 'success');
        renderDetail(body, id);
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }
  const finalNotifyAckBtn = $('#btn-final-notify-ack');
  if (finalNotifyAckBtn) {
    finalNotifyAckBtn.onclick = async () => {
      try {
        await api(`/api/requests/${id}/final-notify-ack`, { method: 'POST' });
        toast('已確認收到最終核准通知', 'success');
        renderDetail(body, id);
        refreshBadge();
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }

  $('#btn-del-request')?.addEventListener('click', async () => {
    const isLeave =
      /請假/.test(String(request.workflow_name || '')) ||
      /請假/.test(String(request.title || ''));
    if (
      request.status === 'approved' &&
      !canDeleteRecordsPerm() &&
      !(isLeave && canDeleteLeavePerm())
    ) {
      toast('已核准的申請不可刪除', 'error');
      return;
    }
    if (
      !confirm(
        `確定刪除申請 #${id}「${request.title}」？\n將一併刪除歷程、附件與相關備份，無法復原。`
      )
    ) {
      return;
    }
    try {
      await api(`/api/requests/${id}`, { method: 'DELETE' });
      toast('已刪除申請', 'success');
      navigate(
        Number(request.requester_id) === Number(state.user?.id)
          ? 'mine'
          : 'records'
      );
    } catch (e) {
      toast(e.message, 'error');
    }
  });
}

function openCosignModal(request, onDone) {
  const me = state.user?.id;
  const users = (state.users || []).filter((u) => u.active !== 0 && u.id !== me);
  openModal(`
    <h3>➕ 簽核加簽請託</h3>
    <p class="muted" style="margin-top:0">
      您可以臨時邀請其他同仁進行加簽。加簽同仁簽核完成後，將依位置繼續進行簽核。
    </p>
    <form id="cosign-form" class="form-grid">
      <div class="field">
        <label>加簽對象 *</label>
        <select name="target_user_id" required>
          <option value="">請選擇加簽同仁…</option>
          ${users.map((u) => `<option value="${u.id}">${esc(u.name)}（${esc(u.department || '未設部門')}）</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label>加簽順序</label>
        <select name="position">
          <option value="current" selected>先經加簽同仁簽核（再回傳原步驟）</option>
          <option value="after">於本關核准後，插入下一步驟</option>
        </select>
      </div>
      <div class="field">
        <label>加簽說明 / 請託意見</label>
        <textarea name="comment" rows="3" placeholder="請填寫加簽說明或請同仁協助說明的項目…"></textarea>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn primary">送出加簽</button>
        <button type="button" class="btn outline" data-close-modal>取消</button>
      </div>
    </form>
  `);

  $('#cosign-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const target_user_id = Number(fd.get('target_user_id'));
    if (!target_user_id) {
      toast('請選擇加簽同仁', 'error');
      return;
    }
    try {
      const res = await api(`/api/requests/${request.id}/cosign`, {
        method: 'POST',
        body: {
          target_user_id,
          position: fd.get('position') || 'current',
          comment: String(fd.get('comment') || '').trim(),
        },
      });
      closeModal();
      toast(res.message || '已成功送出加簽請託', 'success');
      if (typeof onDone === 'function') onDone();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

function openForwardModal(request, onDone) {
  const me = state.user?.id;
  const users = (state.users || []).filter((u) => u.active !== 0 && u.id !== me);
  openModal(`
    <h3>↗️ 簽核關卡轉簽改派</h3>
    <p class="muted" style="margin-top:0">
      將目前步驟的簽核權限轉交給指定同仁／主管辦理（您將不再為此步驟簽核人）。
    </p>
    <form id="forward-form" class="form-grid">
      <div class="field">
        <label>轉簽改派對象 *</label>
        <select name="target_user_id" required>
          <option value="">請選擇轉簽對象…</option>
          ${users.map((u) => `<option value="${u.id}">${esc(u.name)}（${esc(u.department || '未設部門')}）</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label>轉簽說明 / 理由</label>
        <textarea name="comment" rows="3" placeholder="請填寫轉簽改派原因或注意事項…"></textarea>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn primary">確認轉簽</button>
        <button type="button" class="btn outline" data-close-modal>取消</button>
      </div>
    </form>
  `);

  $('#forward-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const target_user_id = Number(fd.get('target_user_id'));
    if (!target_user_id) {
      toast('請選擇轉簽對象', 'error');
      return;
    }
    try {
      const res = await api(`/api/requests/${request.id}/forward`, {
        method: 'POST',
        body: {
          target_user_id,
          comment: String(fd.get('comment') || '').trim(),
        },
      });
      closeModal();
      toast(res.message || '已成功轉簽改派', 'success');
      if (typeof onDone === 'function') onDone();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

function userLabelById(id) {
  const u = (state.users || []).find((x) => x.id === Number(id));
  return u ? u.name : `#${id}`;
}

function describeStepForList(s) {
  if (!s) return '';
  if (s.assignType === 'form_user') return `${s.name}（表單指定）`;
  if (s.assignType === 'dept_head') return `${s.name}（自選／可略過）`;
  if (s.assignType === 'cosign_pick') return `${s.name}（會簽選填）`;
  if (s.assignType === 'users_pick') return `${s.name}（申請人自選）`;
  if (s.assignType === 'department') return `${s.name}（${s.department || '單位'}）`;
  if (s.assignType === 'users' || (s.approverIds && s.approverIds.length)) {
    const names = (s.approverIds || []).map(userLabelById).join('、');
    return names ? `${s.name}（${names}）` : s.name;
  }
  return s.name;
}

async function renderWorkflows(body) {
  if (!hasPerm('workflows')) {
    body.innerHTML = `<div class="error-msg">您沒有管理簽核流程的權限（請洽系統管理員）</div>`;
    return;
  }
  const workflows = await loadWorkflows(true);
  await loadUsers();
  $('#page-actions').innerHTML = `
    <button type="button" class="btn outline" id="btn-export-wf" title="含表單欄位、簽核步驟、PDF 排版；不含系統設定">匯出全部流程模組</button>
    <button type="button" class="btn outline" id="btn-import-wf" title="匯入流程＋表單＋PDF 排版；不影響系統設定">匯入流程模組</button>
    <button type="button" class="btn primary" id="btn-new-wf">＋ 建立簽核流程</button>
    <input type="file" id="wf-import-file" accept=".json,application/json" class="hidden" />
  `;
  $('#btn-new-wf').onclick = () => openWorkflowEditor();
  $('#btn-export-wf').onclick = async () => {
    try {
      const blob = await api('/api/workflows/export', { expectBlob: true });
      // 流程模組：formFields + steps + pdfLayout（version 2）
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `全部簽核流程_可匯入_${twToday()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast('已匯出流程模組（表單＋步驟＋PDF 排版；不含系統設定）', 'success');
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  $('#btn-import-wf').onclick = () => $('#wf-import-file')?.click();
  $('#wf-import-file').onchange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const data = await api('/api/workflows/import', {
        method: 'POST',
        body: payload,
      });
      toast(
        data.message ||
          `已匯入 ${data.imported} 個流程模組（含 PDF 排版；未變更系統設定）`,
        'success'
      );
      navigate('workflows');
    } catch (err) {
      toast(err.message || '匯入失敗（請確認 JSON 格式）', 'error');
    }
  };

  if (!workflows.length) {
    body.innerHTML = emptyState({
      title: '尚無簽核流程',
      desc: '建立第一個流程後，同仁即可在「新增申請」選擇表單送出。也可匯入流程模組（含 PDF 排版）。',
      actions: [
        { label: '＋ 建立第一個流程', id: 'btn-new-wf-empty', primary: true },
        { label: '匯入流程模組 JSON', id: 'btn-import-wf-empty', outline: true },
      ],
    });
    const b = $('#btn-new-wf-empty');
    if (b) b.onclick = () => openWorkflowEditor();
    const bi = $('#btn-import-wf-empty');
    if (bi) bi.onclick = () => $('#wf-import-file')?.click();
    return;
  }

  body.innerHTML = `
    <div class="card">
      <p class="muted" style="margin-top:0">
        每個申請表單可<strong>啟用</strong>或<strong>停用</strong>：停用後「新增申請」不會出現，歷史單據仍可查閱。
        亦可<strong>建立／編輯</strong>步驟與表單，或<strong>匯出／匯入</strong> JSON。
        不需要的表單可先停用；確認無用再<strong>永久刪除</strong>。
      </p>
      <div class="table-wrap">
        <table class="data" style="width:100%;min-width:1080px;table-layout:fixed">
          <thead>
            <tr>
              <th style="width:200px">名稱</th>
              <th style="min-width:320px">簽核步驟</th>
              <th style="width:110px">PDF 排版</th>
              <th style="width:140px">最終核准通知</th>
              <th style="width:100px;white-space:nowrap">建立者</th>
              <th style="width:85px;text-align:center;white-space:nowrap">狀態</th>
              <th style="width:180px;text-align:center;white-space:nowrap">操作</th>
            </tr>
          </thead>
          <tbody>
            ${workflows
              .map((w) => {
                const steps = [
                  '申請人',
                  ...(w.steps || []).map((s) => describeStepForList(s)),
                ].join(' → ');
                const fieldCount = (w.formFields || []).length;
                const isOn = !!w.active;
                const pl = w.pdfLayout || {};
                const plLabel = pl.label || pl.type || '自動';
                const plResolved =
                  pl.type && pl.type !== 'auto' && pl.resolvedType && pl.resolvedType !== pl.type
                    ? ''
                    : pl.type === 'auto' && pl.resolvedType
                      ? `（${pl.resolvedType}）`
                      : '';
                const fn = w.finalNotify || {};
                const fnRecv = (fn.userIds || fn.users || []).length;
                const fnAppMode = fn.applicantMode === 'selected' ? 'selected' : 'all';
                const fnAppN = (fn.applicantUserIds || fn.applicants || []).length;
                const fnText = fn.enabled
                  ? `通知 ${fnRecv} 人${
                      fnAppMode === 'selected' ? `／限 ${fnAppN} 位申請人` : '／全部申請人'
                    }`
                  : '關閉';
                return `
              <tr>
                <td style="white-space:normal;word-break:break-word">
                  <strong>${esc(w.name)}</strong>
                  ${w.description ? `<div class="muted" style="font-size:0.82rem;margin-top:2px">${esc(w.description)}</div>` : ''}
                  <div class="muted" style="margin-top:4px;font-size:0.8rem">表單 ${fieldCount} 個欄位</div>
                </td>
                <td style="white-space:normal;word-break:break-word;font-size:0.88rem;line-height:1.5">${esc(steps) || '—'}</td>
                <td style="font-size:0.85rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(pl.type || 'auto')}">${esc(plLabel)}${esc(plResolved)}</td>
                <td style="font-size:0.85rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(fn.label || '')}">${esc(fnText)}</td>
                <td style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(w.creator_name)}</td>
                <td style="text-align:center;white-space:nowrap">
                  <label class="switch" title="${isOn ? '點擊停用' : '點擊啟用'}">
                    <input type="checkbox" data-toggle-wf="${w.id}" data-wf-name="${esc(w.name)}"
                      ${isOn ? 'checked' : ''} />
                    <span class="switch-slider"></span>
                    <span class="switch-text" data-switch-label="${w.id}">${isOn ? '啟用' : '停用'}</span>
                  </label>
                </td>
                <td style="text-align:center;white-space:nowrap">
                  <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;justify-content:center">
                    <button type="button" class="btn sm outline" data-edit="${w.id}">編輯</button>
                    <button type="button" class="btn sm outline" data-flow="${w.id}" title="以流程圖方式編輯，可建立分支與並行簽核">🔀 流程圖</button>
                    <button type="button" class="btn sm outline" data-export-one="${w.id}">匯出</button>
                    ${
                      !isOn
                        ? `<button type="button" class="btn sm danger" data-purge-wf="${w.id}" data-wf-name="${esc(w.name)}">刪除</button>`
                        : ''
                    }
                  </div>
                </td>
              </tr>`;
              })
              .join('')}
          </tbody>
        </table>
      </div>
    </div>`;

  body.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.onclick = () => {
      const w = workflows.find((x) => x.id === Number(btn.dataset.edit));
      openWorkflowEditor(w);
    };
  });

  // 流程圖編輯器（v2）：儲存後該流程即升級為圖模型
  body.querySelectorAll('[data-flow]').forEach((btn) => {
    btn.onclick = async () => {
      const w = workflows.find((x) => x.id === Number(btn.dataset.flow));
      if (!w) return;
      await loadUsers();
      openFlowEditor(w, async (graph) => {
        try {
          // api() 內部已會 JSON.stringify，這裡傳物件即可。
          // 先 stringify 會變成雙重編碼，body-parser 解析失敗後由 express
          // 預設錯誤處理回傳 HTML，前端取不到 error 欄位只會看到「請求失敗 (400)」
          await api(`/api/workflows/${w.id}`, {
            method: 'PUT',
            body: { flow: graph },
          });
          closeModal();
          toast('流程圖已儲存，此流程已改用圖模型執行');
          renderWorkflows(body);
        } catch (e) {
          toast(e.message || '儲存失敗', 'error');
        }
      });
    };
  });

  body.querySelectorAll('[data-export-one]').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.dataset.exportOne;
      const w = workflows.find((x) => x.id === Number(id));
      try {
        const blob = await api(`/api/workflows/${id}/export`, { expectBlob: true });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${(w?.name || 'workflow').replace(/[<>:"/\\|?*]/g, '_')}.json`;
        a.click();
        URL.revokeObjectURL(url);
        toast(`已匯出「${w?.name || id}」（含 PDF 排版）`, 'success');
      } catch (e) {
        toast(e.message, 'error');
      }
    };
  });

  // 開關：啟用／停用
  body.querySelectorAll('[data-toggle-wf]').forEach((input) => {
    input.addEventListener('change', async () => {
      const id = input.dataset.toggleWf;
      const name = input.dataset.wfName || '此流程';
      const wantOn = input.checked;
      const label = body.querySelector(`[data-switch-label="${id}"]`);

      if (!wantOn) {
        if (
          !confirm(
            `確定停用申請表單「${name}」？\n停用後「新增申請」將無法再選擇此表單。\n歷史簽核紀錄仍可查閱，之後可再開啟開關啟用。`
          )
        ) {
          input.checked = true;
          return;
        }
      }

      input.disabled = true;
      try {
        if (wantOn) {
          await api(`/api/workflows/${id}/restore`, { method: 'POST' });
          if (label) label.textContent = '啟用';
          toast(`「${name}」已啟用`, 'success');
        } else {
          await api(`/api/workflows/${id}`, { method: 'DELETE' });
          if (label) label.textContent = '停用';
          toast(`「${name}」已停用`, 'success');
        }
        navigate('workflows');
      } catch (e) {
        input.checked = !wantOn;
        toast(e.message, 'error');
      } finally {
        input.disabled = false;
      }
    });
  });

  body.querySelectorAll('[data-purge-wf]').forEach((btn) => {
    btn.onclick = async () => {
      const name = btn.dataset.wfName || '此流程';
      const id = btn.dataset.purgeWf;
      if (
        !confirm(
          `確定【永久刪除】流程「${name}」？\n刪除後列表中不再顯示，無法復原。\n若仍有「進行中」的申請將無法刪除。`
        )
      ) {
        return;
      }
      try {
        // 同時帶 query 與 body，避免參數遺失
        await api(`/api/workflows/${id}?permanent=1`, {
          method: 'DELETE',
          body: { permanent: true },
        });
        toast('流程已永久刪除', 'success');
        navigate('workflows');
      } catch (e) {
        toast(e.message || '永久刪除失敗', 'error');
      }
    };
  });
}

function newFormField() {
  return {
    id: `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    label: '',
    type: 'text',
    required: false,
    placeholder: '',
    options: [],
    optionsText: '',
  };
}

function openWorkflowEditor(workflow = null) {
  const users = state.users;
  const deptNames = [
    ...new Set(
      [
        '管理部',
        '工程部',
        '採購部',
        '業務部',
        '財務部',
        '倉管部',
        '人事單位',
        ...(users || []).map((u) => u.department).filter(Boolean),
      ].filter(Boolean)
    ),
  ];
  const steps = workflow
    ? JSON.parse(JSON.stringify(workflow.steps || [])).map((s) => ({
        assignType: 'users',
        formFieldId: 'agent',
        department: '',
        approverIds: [],
        mode: 'any',
        ...s,
      }))
    : [
        {
          name: '代理人',
          assignType: 'form_user',
          formFieldId: 'agent',
          department: '',
          approverIds: [],
          mode: 'any',
        },
        {
          name: '部門主管',
          assignType: 'dept_head',
          formFieldId: 'agent',
          department: '',
          approverIds: [],
          mode: 'any',
        },
      ];
  const formFields = workflow
    ? JSON.parse(JSON.stringify(workflow.formFields || [])).map((f) => ({
        ...f,
        optionsText: Array.isArray(f.options) ? f.options.join('\n') : '',
      }))
    : [];

  const syncStepsFromDom = () => {
    steps.forEach((s, i) => {
      const nameInp = document.querySelector(`[data-field="name"][data-i="${i}"]`);
      const modeSel = document.querySelector(`[data-field="mode"][data-i="${i}"]`);
      const typeSel = document.querySelector(`[data-field="assignType"][data-i="${i}"]`);
      const ffSel = document.querySelector(`[data-field="formFieldId"][data-i="${i}"]`);
      const deptSel = document.querySelector(`[data-field="department"][data-i="${i}"]`);
      if (nameInp) s.name = nameInp.value;
      if (modeSel) s.mode = modeSel.value;
      if (typeSel) s.assignType = typeSel.value;
      if (ffSel) s.formFieldId = ffSel.value;
      if (deptSel) s.department = deptSel.value;
      if (s.assignType === 'users' || s.assignType === 'users_pick') {
        s.approverIds = [...document.querySelectorAll(`[data-approver="${i}"]:checked`)].map((c) =>
          Number(c.value)
        );
      }

      const condEnable = document.querySelector(`[data-cond-enable="${i}"]`)?.checked;
      if (condEnable) {
        s.condition = {
          enabled: true,
          fieldId: document.querySelector(`[data-cond-field="${i}"]`)?.value || 'amount',
          operator: document.querySelector(`[data-cond-op="${i}"]`)?.value || '>=',
          value: document.querySelector(`[data-cond-val="${i}"]`)?.value?.trim() || '0',
          action: document.querySelector(`[data-cond-action="${i}"]`)?.value || 'require',
        };
      } else {
        s.condition = { enabled: false };
      }
    });
  };

  const renderSteps = () => {
    const box = $('#steps-box');
    if (!box) return;
    const userFields = formFields.filter((f) => f.type === 'user');
    box.innerHTML = steps
      .map((s, i) => {
        const at = s.assignType || 'users';
        return `
      <div class="step-card" data-idx="${i}">
        <div class="step-head">
          <div style="display:flex;align-items:center;gap:10px">
            <span class="step-num">${i + 1}</span>
            <strong>簽核步驟</strong>
            <span class="field-type-tag">${esc(ASSIGN_TYPE_LABEL[at] || at)}</span>
            ${s.condition?.enabled ? `<span class="tag draft" style="font-size:0.75rem">🔀 條件分支</span>` : ''}
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button type="button" class="btn sm outline" data-up="${i}" ${i === 0 ? 'disabled' : ''}>上移</button>
            <button type="button" class="btn sm outline" data-down="${i}" ${i >= steps.length - 1 ? 'disabled' : ''}>下移</button>
            <button type="button" class="btn sm outline" data-rm="${i}" ${steps.length <= 1 ? 'disabled' : ''}>移除</button>
          </div>
        </div>
        <div class="form-grid two">
          <div class="field">
            <label>步驟名稱</label>
            <input data-field="name" data-i="${i}" value="${esc(s.name)}" placeholder="例如：代理人、部門主管、副總經理" />
          </div>
          <div class="field">
            <label>核准模式</label>
            <select data-field="mode" data-i="${i}">
              <option value="any" ${s.mode !== 'all' ? 'selected' : ''}>任一簽核人核准即可</option>
              <option value="all" ${s.mode === 'all' ? 'selected' : ''}>需全部簽核人核准</option>
            </select>
          </div>
          <div class="field">
            <label>簽核人來源 *</label>
            <select data-field="assignType" data-i="${i}">
              ${Object.entries(ASSIGN_TYPE_LABEL)
                .map(
                  ([k, v]) =>
                    `<option value="${k}" ${at === k ? 'selected' : ''}>${v}</option>`
                )
                .join('')}
            </select>
          </div>
          <div class="field ${at === 'form_user' ? '' : 'hidden'}" data-assign-wrap="form_user-${i}">
            <label>對應表單人員欄位</label>
            <select data-field="formFieldId" data-i="${i}">
              ${
                userFields.length
                  ? userFields
                      .map(
                        (f) =>
                          `<option value="${esc(f.id)}" ${
                            s.formFieldId === f.id ? 'selected' : ''
                          }>${esc(f.label)}（${esc(f.id)}）</option>`
                      )
                      .join('')
                  : `<option value="agent">代理人（請先新增「人員選擇」欄位，id=agent）</option>`
              }
            </select>
          </div>
          <div class="field ${at === 'department' ? '' : 'hidden'}" data-assign-wrap="department-${i}">
            <label>簽核單位／部門</label>
            <select data-field="department" data-i="${i}">
              <option value="">請選擇…</option>
              ${deptNames
                .map(
                  (d) =>
                    `<option value="${esc(d)}" ${s.department === d ? 'selected' : ''}>${esc(d)}</option>`
                )
                .join('')}
            </select>
          </div>
        </div>
        <div class="field ${
          at === 'users' || at === 'users_pick' ? '' : 'hidden'
        }" style="margin-top:8px" data-assign-wrap="users-${i}" data-assign-wrap-extra="users_pick-${i}">
          <label>${
            at === 'users_pick'
              ? '可選簽核人名單 *（申請人送出時從中擇一或選全部）'
              : '指定簽核人 *（勾選＝新增、取消勾選＝刪除）'
          }</label>
          <div class="approver-list">
            ${users
              .map(
                (u) => `
              <label>
                <input type="checkbox" data-approver="${i}" value="${u.id}"
                  ${(s.approverIds || []).includes(u.id) ? 'checked' : ''} />
                ${esc(u.name)}${u.department ? `（${esc(u.department)}）` : ''}
              </label>`
              )
              .join('')}
          </div>
          <p class="muted" style="font-size:0.8rem;margin:6px 0 0">${
            at === 'users_pick'
              ? '申請時必選其中一人，或選「全部」。核准模式決定全部時是否需人人簽核。'
              : '可隨時增刪指定人員；儲存流程後生效。新申請單會依最新設定解析簽核人。'
          }</p>
        </div>
        ${
          at === 'dept_head'
            ? `<p class="muted" style="margin:8px 0 0;font-size:0.85rem">
                申請時由<strong>申請人自行選擇</strong>同部門（或任一）成員作為此步驟簽核人；
                亦可選擇<strong>不需要經過部門主管</strong>（略過此步驟）。
              </p>`
            : ''
        }
        ${
          at === 'users_pick'
            ? `<p class="muted" style="margin:8px 0 0;font-size:0.85rem">
                申請人<strong>必選</strong>名單中的一位，或選<strong>全部</strong>。
              </p>`
            : ''
        }
        ${
          at === 'cosign_pick'
            ? `<p class="muted" style="margin:8px 0 0;font-size:0.85rem">
                申請時可<strong>勾選多位</strong>會簽人員（皆須核准）；可不選（略過會簽步驟）。
              </p>`
            : ''
        }

        <!-- 關卡條件式動態分支 -->
        <div style="border:1px solid #cbd5e1;border-radius:8px;padding:10px;background:#f8fafc;margin-top:10px">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-weight:600;margin:0 0 4px">
            <input type="checkbox" data-cond-enable="${i}" ${s.condition?.enabled ? 'checked' : ''} />
            <span>🔀 啟用關卡條件式動態分支 (符合/未達門檻時自動跳過關卡)</span>
          </label>
          <div data-cond-panel="${i}" class="${s.condition?.enabled ? '' : 'hidden'}" style="margin-top:8px">
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
              <span style="font-size:0.85rem">當欄位</span>
              <select data-cond-field="${i}" style="font-size:0.85rem">
                <option value="amount" ${s.condition?.fieldId === 'amount' ? 'selected' : ''}>金額 (amount / 總金額)</option>
                <option value="days" ${s.condition?.fieldId === 'days' ? 'selected' : ''}>請假天數 (days)</option>
                <option value="hours" ${s.condition?.fieldId === 'hours' ? 'selected' : ''}>請假小時 (hours)</option>
                ${(formFields || []).map(f => `<option value="${esc(f.id)}" ${s.condition?.fieldId === f.id ? 'selected' : ''}>${esc(f.label)} (${esc(f.id)})</option>`).join('')}
              </select>
              <select data-cond-op="${i}" style="font-size:0.85rem">
                <option value=">=" ${s.condition?.operator === '>=' ? 'selected' : ''}>&gt;= (大於等於)</option>
                <option value=">" ${s.condition?.operator === '>' ? 'selected' : ''}>&gt; (大於)</option>
                <option value="<=" ${s.condition?.operator === '<=' ? 'selected' : ''}>&lt;= (小於等於)</option>
                <option value="<" ${s.condition?.operator === '<' ? 'selected' : ''}>&lt; (小於)</option>
                <option value="==" ${s.condition?.operator === '==' ? 'selected' : ''}>== (等於)</option>
                <option value="!=" ${s.condition?.operator === '!=' ? 'selected' : ''}>!= (不等於)</option>
                <option value="contains" ${s.condition?.operator === 'contains' ? 'selected' : ''}>包含 (contains)</option>
              </select>
              <input type="text" data-cond-val="${i}" value="${esc(s.condition?.value || '')}" placeholder="數值或文字 (例: 100000)" style="width:140px;font-size:0.85rem" />
              <select data-cond-action="${i}" style="font-size:0.85rem">
                <option value="require" ${s.condition?.action !== 'skip' ? 'selected' : ''}>符合才簽核 (未達則自動跳過)</option>
                <option value="skip" ${s.condition?.action === 'skip' ? 'selected' : ''}>符合則跳過 (未達才簽核)</option>
              </select>
            </div>
            <p class="muted" style="font-size:0.8rem;margin:6px 0 0">
              例：金額 &gt;= 100000 且選擇「符合才簽核」→ 當請購金額未滿 10 萬時，系統將自動跳過此關卡，直接進入下一關。
            </p>
          </div>
        </div>
      </div>`;
      })
      .join('');

    box.querySelectorAll('[data-rm]').forEach((btn) => {
      btn.onclick = () => {
        syncStepsFromDom();
        steps.splice(Number(btn.dataset.rm), 1);
        renderSteps();
        syncFlowPathFromSteps();
      };
    });
    box.querySelectorAll('[data-up]').forEach((btn) => {
      btn.onclick = () => {
        const i = Number(btn.dataset.up);
        if (i <= 0) return;
        syncStepsFromDom();
        const t = steps[i - 1];
        steps[i - 1] = steps[i];
        steps[i] = t;
        renderSteps();
        syncFlowPathFromSteps();
      };
    });
    box.querySelectorAll('[data-down]').forEach((btn) => {
      btn.onclick = () => {
        const i = Number(btn.dataset.down);
        if (i >= steps.length - 1) return;
        syncStepsFromDom();
        const t = steps[i + 1];
        steps[i + 1] = steps[i];
        steps[i] = t;
        renderSteps();
        syncFlowPathFromSteps();
      };
    });
    box.querySelectorAll('[data-field]').forEach((inp) => {
      inp.onchange = inp.oninput = () => {
        const i = Number(inp.dataset.i);
        const field = inp.dataset.field;
        steps[i][field] = inp.value;
        if (field === 'assignType') renderSteps();
        if (field === 'name') syncFlowPathFromSteps();
      };
    });
    box.querySelectorAll('[data-approver]').forEach((cb) => {
      cb.onchange = () => {
        const i = Number(cb.dataset.approver);
        const id = Number(cb.value);
        const set = new Set(steps[i].approverIds || []);
        if (cb.checked) set.add(id);
        else set.delete(id);
        steps[i].approverIds = [...set];
      };
    });
    // 條件式分支：勾選時展開設定面板，並即時反映到流程圖
    box.querySelectorAll('[data-cond-enable]').forEach((cb) => {
      cb.onchange = () => {
        const i = cb.dataset.condEnable;
        const panel = box.querySelector(`[data-cond-panel="${i}"]`);
        if (panel) panel.classList.toggle('hidden', !cb.checked);
        syncStepsFromDom();
        syncFlowPathFromSteps();
      };
    });
    box
      .querySelectorAll('[data-cond-field],[data-cond-op],[data-cond-val],[data-cond-action]')
      .forEach((el) => {
        el.onchange = el.oninput = () => {
          syncStepsFromDom();
          syncFlowPathFromSteps();
        };
      });
    syncFlowPathFromSteps();
  };

  const syncFormFieldsFromDom = () => {
    formFields.forEach((f, i) => {
      const label = document.querySelector(`[data-ff-label="${i}"]`);
      const type = document.querySelector(`[data-ff-type="${i}"]`);
      const required = document.querySelector(`[data-ff-req="${i}"]`);
      const placeholder = document.querySelector(`[data-ff-ph="${i}"]`);
      const options = document.querySelector(`[data-ff-opts="${i}"]`);
      if (label) f.label = label.value;
      if (type) f.type = type.value;
      if (required) f.required = required.checked;
      if (placeholder) f.placeholder = placeholder.value;
      if (options) {
        f.optionsText = options.value;
        f.options = options.value
          .split(/[\n,]/)
          .map((o) => o.trim())
          .filter(Boolean);
      }
    });
  };

  /** 依目前步驟產生流程路徑文字 */
  const buildFlowPathText = () => {
    const names = steps
      .map((s) => String(s.name || '').trim())
      .filter(Boolean);
    return names.length ? `申請人 → ${names.join(' → ')}` : '申請人';
  };

  /**
   * 步驟新增／刪除／改名／排序後，同步更新「說明」與畫面上的路徑名稱
   * （流程標題若為路徑格式或空白，也一併更新）
   */
  const syncFlowPathFromSteps = () => {
    const path = buildFlowPathText();
    const descEl = document.querySelector('#wf-form [name="description"]');
    const nameEl = document.querySelector('#wf-form [name="name"]');
    const preview = document.querySelector('#flow-path-preview');
    if (descEl) descEl.value = path;
    if (preview) {
      // 流程圖 + 底下保留文字路徑（與「說明」欄位一致）
      preview.innerHTML = `${flowChartHtml(steps, { showLegend: false })}
        <div class="muted" style="margin-top:4px">${esc(path)}</div>`;
    }
    if (nameEl) {
      const cur = String(nameEl.value || '').trim();
      // 僅在名稱空白、或名稱本身就是路徑字串時自動改寫，避免蓋掉「請假申請」等專名
      if (!cur || cur.startsWith('申請人') || cur.includes(' → ')) {
        nameEl.value = path;
      }
    }
  };

  const renderFormFields = () => {
    const box = $('#form-fields-box');
    if (!box) return;
    if (!formFields.length) {
      box.innerHTML = `<div class="muted" style="padding:8px 0">尚未新增表單欄位。一般簽呈需填主旨；其餘流程主旨由系統自動產生。</div>`;
      return;
    }
    box.innerHTML = formFields
      .map(
        (f, i) => `
      <div class="step-card" data-ff-idx="${i}">
        <div class="step-head">
          <div style="display:flex;align-items:center;gap:10px">
            <span class="step-num">${i + 1}</span>
            <strong>表單欄位</strong>
            <span class="field-type-tag">${esc(FIELD_TYPE_LABEL[f.type] || f.type)}</span>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button type="button" class="btn sm outline" data-ff-up="${i}" ${
              i === 0 ? 'disabled' : ''
            } title="上移">上移</button>
            <button type="button" class="btn sm outline" data-ff-down="${i}" ${
              i >= formFields.length - 1 ? 'disabled' : ''
            } title="下移">下移</button>
            <button type="button" class="btn sm outline" data-ff-rm="${i}">移除</button>
          </div>
        </div>
        <div class="form-grid two">
          <div class="field">
            <label>欄位名稱 *</label>
            <input data-ff-label="${i}" value="${esc(f.label)}" placeholder="例如：請假起日、金額" />
          </div>
          <div class="field">
            <label>欄位類型</label>
            <select data-ff-type="${i}">
              ${Object.entries(FIELD_TYPE_LABEL)
                .map(
                  ([k, v]) =>
                    `<option value="${k}" ${f.type === k ? 'selected' : ''}>${v}</option>`
                )
                .join('')}
            </select>
          </div>
          <div class="field">
            <label>提示文字</label>
            <input data-ff-ph="${i}" value="${esc(f.placeholder || '')}" placeholder="選填" />
          </div>
          <div class="field" style="display:flex;align-items:end;padding-bottom:8px">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" data-ff-req="${i}" ${f.required ? 'checked' : ''} />
              必填
            </label>
          </div>
        </div>
        <div class="field ${f.type === 'select' ? '' : 'hidden'}" data-ff-opts-wrap="${i}" style="margin-top:8px">
          <label>下拉選項（每行一個，或用逗號分隔）</label>
          <textarea data-ff-opts="${i}" rows="3" placeholder="事假&#10;病假&#10;特休">${esc(f.optionsText || (f.options || []).join('\n'))}</textarea>
        </div>
      </div>`
      )
      .join('');

    box.querySelectorAll('[data-ff-up]').forEach((btn) => {
      btn.onclick = () => {
        const i = Number(btn.dataset.ffUp);
        if (i <= 0) return;
        syncFormFieldsFromDom();
        const tmp = formFields[i - 1];
        formFields[i - 1] = formFields[i];
        formFields[i] = tmp;
        renderFormFields();
        renderSteps();
      };
    });
    box.querySelectorAll('[data-ff-down]').forEach((btn) => {
      btn.onclick = () => {
        const i = Number(btn.dataset.ffDown);
        if (i >= formFields.length - 1) return;
        syncFormFieldsFromDom();
        const tmp = formFields[i + 1];
        formFields[i + 1] = formFields[i];
        formFields[i] = tmp;
        renderFormFields();
        renderSteps();
      };
    });
    box.querySelectorAll('[data-ff-rm]').forEach((btn) => {
      btn.onclick = () => {
        syncFormFieldsFromDom();
        formFields.splice(Number(btn.dataset.ffRm), 1);
        renderFormFields();
        renderSteps();
      };
    });
    box.querySelectorAll('[data-ff-type]').forEach((sel) => {
      sel.onchange = () => {
        const i = Number(sel.dataset.ffType);
        formFields[i].type = sel.value;
        const wrap = document.querySelector(`[data-ff-opts-wrap="${i}"]`);
        if (wrap) wrap.classList.toggle('hidden', sel.value !== 'select');
        const tag = sel.closest('.step-card')?.querySelector('.field-type-tag');
        if (tag) tag.textContent = FIELD_TYPE_LABEL[sel.value] || sel.value;
      };
    });
  };

  const PDF_LAYOUT_OPTIONS = [
    { type: 'auto', label: '依流程名稱自動判斷' },
    { type: 'leave', label: '請假單版面' },
    { type: 'credit_limit', label: '信用額度申請表版面' },
    { type: 'purchase', label: '請購申請版面' },
    { type: 'expense', label: '費用報支版面' },
    { type: 'travel', label: '出差申請版面' },
    { type: 'it_repair', label: '電腦異常報修版面' },
    { type: 'overtime', label: '延長工時版面' },
    { type: 'general', label: '一般簽呈版面' },
  ];
  const curPdfType = (workflow?.pdfLayout && workflow.pdfLayout.type) || 'auto';
  const curFinalNotify = workflow?.finalNotify || {
    enabled: false,
    userIds: [],
    applicantMode: 'all',
    applicantUserIds: [],
    label: '最終核准完成通知',
  };
  const curFinalNotifyIds = new Set(
    (curFinalNotify.userIds || []).map(Number).filter(Boolean)
  );
  const curApplicantMode =
    curFinalNotify.applicantMode === 'selected' ? 'selected' : 'all';
  const curApplicantIds = new Set(
    (curFinalNotify.applicantUserIds || []).map(Number).filter(Boolean)
  );
  // 信用額度預設建議：若未設定過且流程名稱含信用額度，UI 預勾財務相關（不強制）
  const suggestCreditFinance =
    !workflow?.finalNotify &&
    /信用額度|授信額度|額度申請/i.test(String(workflow?.name || ''));
  const isLeaveWorkflowName = /請假|休假|leave/i.test(String(workflow?.name || ''));

  openModal(`
    <h3>${workflow ? '編輯流程' : '建立簽核流程'}</h3>
    <form id="wf-form" class="form-grid">
      <div class="field">
        <label>流程名稱 *</label>
        <input name="name" required value="${esc(workflow?.name || '')}" placeholder="例如：請假申請、請購申請" />
        <p class="muted" style="font-size:0.8rem;margin:4px 0 0">若名稱為路徑格式，增刪步驟時會自動同步更新。</p>
      </div>
      <div class="field">
        <label>說明（簽核路徑，隨步驟自動更新）</label>
        <input name="description" id="wf-description" value="${esc(workflow?.description || '')}" placeholder="申請人 → …" />
      </div>
      <div class="field">
        <label>啟用狀態</label>
        <label class="switch" style="margin-top:8px">
          <input type="checkbox" name="active" id="wf-active" value="1"
            ${!workflow || workflow.active ? 'checked' : ''} />
          <span class="switch-slider"></span>
          <span class="switch-text" id="wf-active-label">${
            !workflow || workflow.active ? '啟用' : '停用'
          }</span>
        </label>
        <p class="muted" style="font-size:0.8rem;margin:6px 0 0">開啟＝可在「新增申請」中選擇；關閉＝停用（歷史單據仍可查）。</p>
      </div>
      <div class="field">
        <label>申請單 PDF 排版 *</label>
        <select name="pdfLayoutType" id="wf-pdf-layout">
          ${PDF_LAYOUT_OPTIONS.map(
            (o) =>
              `<option value="${esc(o.type)}" ${curPdfType === o.type ? 'selected' : ''}>${esc(o.label)}</option>`
          ).join('')}
        </select>
        <p class="muted" style="font-size:0.8rem;margin:6px 0 0">
          與簽核流程一體：匯出／匯入時會一併帶出 PDF 排版，不影響系統設定、Email、使用者。
        </p>
      </div>
      <div class="field" style="grid-column:1/-1">
        <label>目前簽核路徑</label>
        <div id="flow-path-preview" style="padding:6px 12px 10px;background:#f8fafc;border:1px solid var(--border);border-radius:8px;color:#1e3a5f;line-height:1.5">
          ${flowChartHtml(workflow?.steps || [], { showLegend: false })}
          <div class="muted" style="margin-top:4px">${esc(workflow?.description || '申請人')}</div>
        </div>
      </div>
      <div style="grid-column:1/-1;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;background:#f8fafc">
        <div class="form-section-title" style="margin:0 0 8px">
          <strong>最終核准完成通知（系統內）</strong>
          <span class="field-type-tag">流程模組</span>
        </div>
        <p class="muted" style="margin:0 0 12px;font-size:0.85rem;line-height:1.5">
          ${
            isLeaveWorkflowName
              ? '請假單<strong>最後一步核准</strong>後，以<strong>系統內通知</strong>提醒選定人員<strong>設定 Email 自動回覆</strong>，並請對方點「確認收到」。可再限定哪些申請人的假單才觸發。'
              : '當<strong>最後一步</strong>（例如總經理）核定通過時，在<strong>系統內</strong>通知選定人員，並請對方點<strong>「確認收到通知」</strong>（非 Email）。可指定只有特定申請人的單據才觸發。'
          }
          隨流程匯出／匯入。
        </p>
        <label class="switch" style="margin-bottom:10px">
          <input type="checkbox" id="wf-final-notify-enabled" value="1"
            ${curFinalNotify.enabled || suggestCreditFinance ? 'checked' : ''} />
          <span class="switch-slider"></span>
          <span class="switch-text" id="wf-final-notify-label">${
            curFinalNotify.enabled || suggestCreditFinance
              ? isLeaveWorkflowName
                ? '啟用（設定 Email 自動回覆通知）'
                : '啟用系統內最終通知'
              : '不通知（關閉）'
          }</span>
        </label>
        <div id="wf-final-notify-panel" class="${
          curFinalNotify.enabled || suggestCreditFinance ? '' : 'hidden'
        }">
          <div class="field" style="margin-bottom:10px">
            <label>${
              isLeaveWorkflowName
                ? '被通知人員說明（顯示在待確認畫面）'
                : '通知說明（顯示在待確認畫面）'
            }</label>
            <input type="text" id="wf-final-notify-label-input"
              value="${esc(
                curFinalNotify.label ||
                  (suggestCreditFinance
                    ? '財務部（授信額度建檔）'
                    : isLeaveWorkflowName
                      ? '設定 Email 自動回覆'
                      : '最終核准完成通知')
              )}"
              placeholder="${
                isLeaveWorkflowName
                  ? '設定 Email 自動回覆'
                  : '例如：人資歸檔、財務部建檔'
              }" />
            ${
              isLeaveWorkflowName
                ? `<p class="muted" style="font-size:0.8rem;margin:6px 0 0">請假預設說明：提醒被通知人員為請假同仁設定／確認 <strong>Email 自動回覆</strong>。</p>`
                : ''
            }
          </div>
          <div class="field" style="margin-bottom:12px">
            <label>哪些申請人的單據需要此通知模組？</label>
            <div style="display:flex;flex-wrap:wrap;gap:16px;margin:6px 0 8px">
              <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
                <input type="radio" name="wf-applicant-mode" id="wf-applicant-mode-all" value="all"
                  ${curApplicantMode !== 'selected' ? 'checked' : ''} />
                全部申請人
              </label>
              <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
                <input type="radio" name="wf-applicant-mode" id="wf-applicant-mode-selected" value="selected"
                  ${curApplicantMode === 'selected' ? 'checked' : ''} />
                僅下列申請人（可多選）
              </label>
            </div>
            <div id="wf-final-notify-applicants-wrap" class="${
              curApplicantMode === 'selected' ? '' : 'hidden'
            }">
              <div id="wf-final-notify-applicants" style="max-height:160px;overflow:auto;border:1px solid #e2e8f0;border-radius:8px;padding:8px;background:#fff;display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:4px 12px">
                ${(users || [])
                  .filter((u) => u.active !== 0)
                  .map((u) => {
                    const checked = curApplicantIds.has(Number(u.id));
                    return `<label style="display:flex;align-items:center;gap:6px;font-size:0.88rem;cursor:pointer">
                      <input type="checkbox" data-final-notify-applicant="${u.id}" ${checked ? 'checked' : ''} />
                      <span>${esc(u.name || u.username)}${u.department ? ` <span class="muted">（${esc(u.department)}）</span>` : ''}</span>
                    </label>`;
                  })
                  .join('') || '<span class="muted">尚無可選使用者</span>'}
              </div>
              <p class="muted" style="font-size:0.8rem;margin:6px 0 0">
                例：請假流程只勾「特定同仁」→ 僅這些人送的假單，最後核准後才通知下方「通知對象」。
              </p>
            </div>
          </div>
          <div class="field">
            <label>${
              isLeaveWorkflowName
                ? '最終被通知人員（請設定 Email 自動回覆）'
                : '通知對象（收件人，可多選）'
            }</label>
            <div id="wf-final-notify-users" style="max-height:180px;overflow:auto;border:1px solid #e2e8f0;border-radius:8px;padding:8px;background:#fff;display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:4px 12px">
              ${(users || [])
                .filter((u) => u.active !== 0)
                .map((u) => {
                  const isFinance =
                    /財務|會計|授信/.test(String(u.department || '')) ||
                    /財務|會計/.test(String(u.name || ''));
                  const checked =
                    curFinalNotifyIds.has(Number(u.id)) ||
                    (suggestCreditFinance && !curFinalNotifyIds.size && isFinance);
                  return `<label style="display:flex;align-items:center;gap:6px;font-size:0.88rem;cursor:pointer">
                    <input type="checkbox" data-final-notify-user="${u.id}" ${checked ? 'checked' : ''} />
                    <span>${esc(u.name || u.username)}${u.department ? ` <span class="muted">（${esc(u.department)}）</span>` : ''}</span>
                  </label>`;
                })
                .join('') || '<span class="muted">尚無可選使用者</span>'}
            </div>
            <p class="muted" style="font-size:0.8rem;margin:6px 0 0">
              ${
                isLeaveWorkflowName
                  ? '假單最終核准後，這些人員會在系統收到待確認，請其<strong>設定 Email 自動回覆</strong>後點「確認收到」。'
                  : '收件人登入後會看到待確認；點「確認收到通知」後才從待辦移除。'
              }
            </p>
          </div>
        </div>
      </div>
      <div>
        <div class="form-section-title">
          <strong>自訂表單欄位</strong>
          <button type="button" class="btn sm outline" id="add-field">＋ 新增欄位</button>
        </div>
        <p class="muted" style="margin:0 0 8px;font-size:0.85rem">
          建立流程時可一併設計申請表單（文字、數字、日期、下拉、核取等）。
          可用<strong>上移／下移</strong>調整申請單顯示順序（儲存後生效）。
        </p>
        <div class="steps-builder" id="form-fields-box"></div>
      </div>
      <div>
        <div class="form-section-title">
          <strong>簽核步驟（依序）</strong>
          <button type="button" class="btn sm outline" id="add-step">＋ 空白步驟</button>
        </div>
        <p class="muted" style="margin:0 0 8px;font-size:0.85rem">
          標準層級：<strong>申請人</strong> → 代理人 → 部門主管 → 人事單位 → <strong>副總經理</strong> → <strong>總經理</strong>。<br/>
          下方可<strong>自行新增任何層級</strong>、調整順序、或改簽核人來源；人事單位對應管理部。
        </p>
        <div id="step-presets" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px"></div>
        <div class="steps-builder" id="steps-box"></div>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn primary">儲存</button>
        <button type="button" class="btn outline" data-close-modal>取消</button>
      </div>
    </form>
  `);
  $('#modal-panel').classList.add('wide');
  renderSteps();
  renderFormFields();
  const wfActive = $('#wf-active');
  const wfActiveLabel = $('#wf-active-label');
  if (wfActive && wfActiveLabel) {
    wfActive.addEventListener('change', () => {
      wfActiveLabel.textContent = wfActive.checked ? '啟用' : '停用';
    });
  }
  const fnEnabled = $('#wf-final-notify-enabled');
  const fnLabel = $('#wf-final-notify-label');
  const fnPanel = $('#wf-final-notify-panel');
  if (fnEnabled) {
    fnEnabled.addEventListener('change', () => {
      const on = fnEnabled.checked;
      if (fnLabel) {
        fnLabel.textContent = on
          ? isLeaveWorkflowName
            ? '啟用（設定 Email 自動回覆通知）'
            : '啟用系統內最終通知'
          : '不通知（關閉）';
      }
      if (fnPanel) fnPanel.classList.toggle('hidden', !on);
      // 請假：啟用時若說明仍為空白或舊預設，帶入「設定 Email 自動回覆」
      if (on && isLeaveWorkflowName) {
        const inp = document.querySelector('#wf-final-notify-label-input');
        if (
          inp &&
          (!String(inp.value || '').trim() ||
            /^(最終核准完成通知|請假核准完成通知)$/.test(String(inp.value || '').trim()))
        ) {
          inp.value = '設定 Email 自動回覆';
        }
      }
    });
  }
  const syncApplicantModeUi = () => {
    const selected = $('#wf-applicant-mode-selected')?.checked;
    const wrap = $('#wf-final-notify-applicants-wrap');
    if (wrap) wrap.classList.toggle('hidden', !selected);
  };
  document.querySelectorAll('input[name="wf-applicant-mode"]').forEach((r) => {
    r.addEventListener('change', syncApplicantModeUi);
  });
  syncApplicantModeUi();
  // 常用層級一鍵新增（可任意組合、自行修改）
  const findUserId = (name) => {
    const u = (users || []).find((x) => x.name === name);
    return u ? u.id : null;
  };
  const STEP_PRESETS = [
    {
      label: '代理人',
      step: {
        name: '代理人',
        assignType: 'form_user',
        formFieldId: 'agent',
        department: '',
        approverIds: [],
        mode: 'any',
      },
      ensureAgentField: true,
    },
    {
      label: '部門主管',
      step: {
        name: '部門主管',
        assignType: 'dept_head',
        formFieldId: 'agent',
        department: '',
        approverIds: [],
        mode: 'any',
      },
    },
    {
      label: '人事單位',
      step: {
        name: '人事單位',
        assignType: 'department',
        formFieldId: 'agent',
        department: '人事單位',
        approverIds: [],
        mode: 'any',
      },
    },
    {
      label: '採購單位',
      step: {
        name: '採購單位',
        assignType: 'department',
        formFieldId: 'agent',
        department: '採購部',
        approverIds: [],
        mode: 'any',
      },
    },
    {
      label: '財務單位',
      step: {
        name: '財務單位',
        assignType: 'department',
        formFieldId: 'agent',
        department: '財務部',
        approverIds: [],
        mode: 'any',
      },
    },
    {
      label: '管理部',
      step: {
        name: '管理部',
        assignType: 'department',
        formFieldId: 'agent',
        department: '管理部',
        approverIds: [],
        mode: 'any',
      },
    },
    {
      label: '會簽人員（選填）',
      step: {
        name: '會簽人員',
        assignType: 'cosign_pick',
        formFieldId: '',
        department: '',
        approverIds: [],
        mode: 'any',
      },
    },
    {
      label: '副總經理（申請人自選）',
      step: {
        name: '副總經理',
        assignType: 'users_pick',
        formFieldId: 'agent',
        department: '',
        // 預勾：部門或姓名含「副總」者，或帳號 luis / danny
        approverIds: (users || [])
          .filter(
            (u) =>
              /副總/.test(String(u.department || '')) ||
              /副總/.test(String(u.name || '')) ||
              ['luis', 'danny'].includes(String(u.username || '').toLowerCase())
          )
          .map((u) => u.id),
        mode: 'any',
      },
    },
    {
      label: '總經理',
      step: {
        name: '總經理',
        assignType: 'users',
        formFieldId: 'agent',
        department: '',
        approverIds: (users || [])
          .filter(
            (u) =>
              /總經理/.test(String(u.department || '')) ||
              /總經理/.test(String(u.name || '')) ||
              String(u.username || '').toLowerCase() === 'martin'
          )
          .map((u) => u.id),
        mode: 'any',
      },
    },
    {
      label: '指定人員',
      step: {
        name: '指定簽核',
        assignType: 'users',
        formFieldId: 'agent',
        department: '',
        approverIds: [],
        mode: 'any',
      },
    },
  ];

  const presetsBox = $('#step-presets');
  if (presetsBox) {
    presetsBox.innerHTML = STEP_PRESETS.map(
      (p, i) =>
        `<button type="button" class="btn sm outline" data-preset="${i}">＋ ${esc(p.label)}</button>`
    ).join('');
    presetsBox.querySelectorAll('[data-preset]').forEach((btn) => {
      btn.onclick = () => {
        syncStepsFromDom();
        syncFormFieldsFromDom();
        const p = STEP_PRESETS[Number(btn.dataset.preset)];
        if (p.ensureAgentField && !formFields.some((f) => f.id === 'agent' || f.type === 'user')) {
          formFields.unshift({
            id: 'agent',
            label: '代理人',
            type: 'user',
            required: true,
            placeholder: '請選擇代理人',
            options: [],
            optionsText: '',
          });
          renderFormFields();
        }
        steps.push(JSON.parse(JSON.stringify(p.step)));
        renderSteps();
        syncFlowPathFromSteps();
      };
    });
  }

  $('#add-step').onclick = () => {
    syncStepsFromDom();
    steps.push({
      name: `步驟 ${steps.length + 1}`,
      assignType: 'users',
      formFieldId: 'agent',
      department: '',
      approverIds: [],
      mode: 'any',
      approverFields: [],
    });
    renderSteps();
    syncFlowPathFromSteps();
  };
  $('#add-field').onclick = () => {
    syncFormFieldsFromDom();
    formFields.push(newFormField());
    renderFormFields();
    renderSteps();
  };
  $('#wf-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    syncFormFieldsFromDom();
    syncStepsFromDom();
    for (const f of formFields) {
      if (!String(f.label || '').trim()) {
        toast('請填寫所有表單欄位名稱', 'error');
        return;
      }
      if (f.type === 'select' && !(f.options && f.options.length)) {
        toast(`「${f.label}」請至少設定一個下拉選項`, 'error');
        return;
      }
    }
    for (const s of steps) {
      if (!String(s.name || '').trim()) {
        toast('請填寫所有簽核步驟名稱', 'error');
        return;
      }
      if (
        (s.assignType === 'users' || s.assignType === 'users_pick') &&
        !(s.approverIds && s.approverIds.length)
      ) {
        toast(
          s.assignType === 'users_pick'
            ? `步驟「${s.name}」請勾選可選簽核人名單（申請人將從中選擇）`
            : `步驟「${s.name}」請指定簽核人`,
          'error'
        );
        return;
      }
      if (s.assignType === 'department' && !s.department) {
        toast(`步驟「${s.name}」請選擇單位／部門`, 'error');
        return;
      }
      if (s.assignType === 'form_user') {
        const ff = formFields.find((f) => f.id === s.formFieldId);
        if (!ff || ff.type !== 'user') {
          toast(`步驟「${s.name}」需要對應「人員選擇」表單欄位（例如代理人）`, 'error');
          return;
        }
      }
    }
    // 儲存前依步驟同步說明路徑
    syncFlowPathFromSteps();
    const pathDesc = buildFlowPathText();
    const nameVal = String(fd.get('name') || '').trim() || pathDesc;
    const pdfLayoutType =
      document.querySelector('#wf-pdf-layout')?.value ||
      fd.get('pdfLayoutType') ||
      'auto';
    const finalNotifyEnabled = !!document.querySelector('#wf-final-notify-enabled')?.checked;
    const finalNotifyUserIds = [
      ...document.querySelectorAll('[data-final-notify-user]:checked'),
    ].map((c) => Number(c.dataset.finalNotifyUser || c.value)).filter(Boolean);
    const applicantMode = $('#wf-applicant-mode-selected')?.checked
      ? 'selected'
      : 'all';
    const applicantUserIds = [
      ...document.querySelectorAll('[data-final-notify-applicant]:checked'),
    ]
      .map((c) => Number(c.dataset.finalNotifyApplicant || c.value))
      .filter(Boolean);
    if (finalNotifyEnabled && !finalNotifyUserIds.length) {
      toast('已啟用最終核准通知，請至少勾選一位「通知對象」', 'error');
      return;
    }
    if (finalNotifyEnabled && applicantMode === 'selected' && !applicantUserIds.length) {
      toast('已選「僅下列申請人」，請至少勾選一位申請人', 'error');
      return;
    }
    const payload = {
      name: nameVal,
      description: pathDesc,
      steps: steps.map((s) => ({
        name: s.name,
        mode: s.mode === 'all' ? 'all' : 'any',
        assignType: s.assignType || 'users',
        formFieldId: s.formFieldId || 'agent',
        department: s.department || '',
        // users / users_pick 都需保存可選簽核人名單
        approverIds:
          s.assignType === 'users' || s.assignType === 'users_pick'
            ? s.approverIds || []
            : [],
        // 保留步驟簽核表單（如人事：剩餘特休）
        approverFields: Array.isArray(s.approverFields) ? s.approverFields : [],
        condition: s.condition || { enabled: false },
      })),
      formFields: formFields.map((f) => ({
        id: f.id,
        label: f.label,
        type: f.type,
        required: !!f.required,
        placeholder: f.placeholder || '',
        options: f.type === 'select' ? f.options || [] : undefined,
      })),
      pdfLayout: { type: String(pdfLayoutType || 'auto') },
      finalNotify: {
        enabled: finalNotifyEnabled,
        userIds: finalNotifyUserIds,
        applicantMode,
        applicantUserIds: applicantMode === 'selected' ? applicantUserIds : [],
        label:
          document.querySelector('#wf-final-notify-label-input')?.value?.trim() ||
          (isLeaveWorkflowName ? '設定 Email 自動回覆' : '最終核准完成通知'),
      },
      active: document.querySelector('#wf-active')?.checked ? 1 : 0,
    };
    try {
      if (workflow) {
        await api(`/api/workflows/${workflow.id}`, { method: 'PUT', body: payload });
      } else {
        await api('/api/workflows', { method: 'POST', body: payload });
      }
      closeModal();
      toast('流程已儲存', 'success');
      navigate('workflows');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

async function renderBackups(body) {
  if (!hasPerm('backups')) {
    body.innerHTML = `<div class="error-msg">您沒有備份資料的權限</div>`;
    return;
  }

  const { meta } = await api('/api/backups/meta');
  const deptOpts = (meta.departments || [])
    .map((d) => `<option value="${esc(d)}">${esc(d)}</option>`)
    .join('');
  const wfOpts = (meta.workflows || [])
    .map((w) => `<option value="${esc(w)}">${esc(w)}</option>`)
    .join('');
  const yearOpts = (meta.years || [])
    .map((y) => `<option value="${esc(y)}">${esc(y)}</option>`)
    .join('');
  const monthOpts = Array.from({ length: 12 }, (_, i) => {
    const m = String(i + 1).padStart(2, '0');
    return `<option value="${m}">${m}</option>`;
  }).join('');

  const STATUS_OPT = [
    ['approved', '已核准'],
    ['all', '全部狀態'],
    ['pending', '簽核中'],
    ['rejected', '已駁回'],
    ['cancelled', '已取消'],
  ];

  const enc = meta.encrypt || {};
  const encNote = enc.ready
    ? `<span style="color:#15803d">已啟用 AES-256 加密</span>（一律存加密 ZIP；請用 7-Zip 等工具以系統設定密碼解壓）`
    : enc.enabled && !enc.hasPass
      ? `<span style="color:#b45309">已勾選加密但尚未設定密碼</span> — 請至「系統設定 → 備份加密」設定後再備份`
      : `未加密。可於「系統設定 → 備份加密」啟用 AES-256 密碼保護`;

  body.innerHTML = `
    <div class="card">
      <h3 style="margin-top:0">執行備份</h3>
      <p class="muted" style="margin-top:0">
        備份目錄：<strong>部門 / 申請表單類別 / 年月</strong>。<br/>
        無附件時存 <strong>PDF</strong>；有上傳附件時存 <strong>ZIP</strong>（簽核單 PDF + 附件資料夾）。<br/>
        加密：${encNote}。<br/>
        目前已備份 <strong>${meta.total || 0}</strong> 筆。
      </p>
      <form id="backup-run-form" class="form-grid two">
        <div class="field">
          <label>備份狀態</label>
          <select name="status">
            ${STATUS_OPT.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>部門（選填）</label>
          <select name="department">
            <option value="">全部部門</option>
            ${deptOpts}
          </select>
        </div>
        <div class="field">
          <label>申請表單類別（選填）</label>
          <select name="workflow_name">
            <option value="">全部表單</option>
            ${wfOpts}
          </select>
        </div>
        <div class="field">
          <label>強制覆寫既有備份</label>
          <label style="display:flex;align-items:center;gap:8px;margin-top:8px;cursor:pointer">
            <input type="checkbox" name="force" /> 是（重新產生 PDF）
          </label>
        </div>
        <div class="field">
          <label>起始日期（選填）</label>
          <input type="date" name="date_from" />
        </div>
        <div class="field">
          <label>結束日期（選填）</label>
          <input type="date" name="date_to" />
        </div>
        <div class="form-actions" style="grid-column:1/-1">
          <button type="submit" class="btn primary" id="btn-run-backup">開始備份</button>
        </div>
      </form>
      <div id="backup-run-result" class="muted" style="margin-top:8px"></div>
    </div>

    <div class="card" style="margin-top:16px">
      <h3 style="margin-top:0">查詢備份</h3>
      <form id="backup-query-form" class="form-grid two">
        <div class="field">
          <label>部門</label>
          <select name="department">
            <option value="">全部</option>
            ${deptOpts}
          </select>
        </div>
        <div class="field">
          <label>申請表單類別</label>
          <select name="workflow_name">
            <option value="">全部</option>
            ${wfOpts}
          </select>
        </div>
        <div class="field">
          <label>年</label>
          <select name="year">
            <option value="">全部</option>
            ${yearOpts}
          </select>
        </div>
        <div class="field">
          <label>月</label>
          <select name="month">
            <option value="">全部</option>
            ${monthOpts}
          </select>
        </div>
        <div class="field" style="grid-column:1/-1">
          <label>關鍵字（主旨／申請人／單號）</label>
          <input name="keyword" placeholder="例如：請假、張祖銘、6" />
        </div>
        <div class="form-actions" style="grid-column:1/-1">
          <button type="submit" class="btn primary">查詢</button>
          <button type="button" class="btn outline" id="btn-backup-reset">清除條件</button>
        </div>
      </form>
      <div id="backup-list" style="margin-top:12px">
        <div class="muted">請按「查詢」載入備份清單。</div>
      </div>
    </div>
  `;

  const STATUS_MAP = {
    draft: '草稿',
    pending: '簽核中',
    approved: '已核准',
    rejected: '已駁回',
    cancelled: '已取消',
  };

  const canDeleteBackup = isAdmin();

  async function loadList(params = {}) {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v) q.set(k, v);
    });
    const box = $('#backup-list');
    box.innerHTML = `<div class="muted">載入中…</div>`;
    try {
      const { backups } = await api(`/api/backups?${q.toString()}`);
      if (!backups.length) {
        box.innerHTML = emptyState({
          title: '沒有符合條件的備份',
          desc: '請調整篩選條件，或先執行備份作業產生檔案。',
        });
        return;
      }
      box.innerHTML = `
        ${
          canDeleteBackup
            ? `<div class="form-actions" style="margin-bottom:10px;flex-wrap:wrap">
                <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
                  <input type="checkbox" id="chk-all-backups" /> 全選
                </label>
                <button type="button" class="btn danger sm" id="btn-bulk-del-backups">刪除選取</button>
                <span class="muted" id="backup-sel-count">已選 0 筆</span>
              </div>`
            : ''
        }
        <div class="table-wrap">
          <table class="data" style="width:100%;min-width:1020px;table-layout:fixed">
            <thead>
              <tr>
                ${canDeleteBackup ? '<th style="width:36px;text-align:center"></th>' : ''}
                <th style="width:70px;text-align:center;white-space:nowrap">單號</th>
                <th style="width:120px">部門</th>
                <th style="width:150px">表單類別</th>
                <th style="width:85px;text-align:center;white-space:nowrap">年月</th>
                <th style="min-width:300px">主旨</th>
                <th style="width:100px;white-space:nowrap">申請人</th>
                <th style="width:90px;text-align:center;white-space:nowrap">狀態</th>
                <th style="width:145px;white-space:nowrap">備份時間</th>
                <th style="width:140px;white-space:nowrap;text-align:center">操作</th>
              </tr>
            </thead>
            <tbody>
              ${backups
                .map(
                  (b) => `
                <tr>
                  ${
                    canDeleteBackup
                      ? `<td style="text-align:center"><input type="checkbox" data-backup-check value="${b.id}" /></td>`
                      : ''
                  }
                  <td style="white-space:nowrap;font-weight:600;text-align:center">#${b.request_id}</td>
                  <td style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(b.department)}">${esc(b.department)}</td>
                  <td style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(b.workflow_name)}">${esc(b.workflow_name)}</td>
                  <td style="text-align:center;white-space:nowrap">${esc(b.period_year)}-${esc(b.period_month)}</td>
                  <td style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(b.title)}"><strong>${esc(b.title)}</strong></td>
                  <td style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(b.requester_name)}">${esc(b.requester_name)}</td>
                  <td style="text-align:center;white-space:nowrap"><span class="tag ${b.status}">${esc(STATUS_MAP[b.status] || b.status)}</span></td>
                  <td class="muted" style="white-space:nowrap;font-size:0.82rem">${esc(b.created_at)}</td>
                  <td style="white-space:nowrap;text-align:center">
                    <button type="button" class="btn sm primary" data-dl="${b.id}" data-fname="${esc(b.file_name || '')}">
                      ${/\.zip$/i.test(b.file_name || '') ? '下載 ZIP' : '下載 PDF'}
                    </button>
                    ${
                      canDeleteBackup
                        ? `<button type="button" class="btn sm danger" data-del-backup="${b.id}">刪除</button>`
                        : ''
                    }
                  </td>
                </tr>`
                )
                .join('')}
            </tbody>
          </table>
        </div>
        <p class="muted" style="margin-top:8px">路徑規則：部門 / 表單類別 / 年月 / 檔名.pdf（共 ${backups.length} 筆）${
          canDeleteBackup ? '。系統管理員可刪除備份。' : ''
        }</p>`;
      box.querySelectorAll('[data-dl]').forEach((btn) => {
        btn.onclick = async () => {
          try {
            const blob = await api(`/api/backups/${btn.dataset.dl}/download`);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const fname = btn.dataset.fname || '';
            const isZip = /\.zip$/i.test(fname) || blob.type.includes('zip');
            a.download =
              fname ||
              (isZip
                ? `backup-${btn.dataset.dl}.zip`
                : `backup-${btn.dataset.dl}.pdf`);
            a.click();
            URL.revokeObjectURL(url);
            toast(isZip ? 'ZIP 已開始下載（含 PDF 與附件）' : 'PDF 已開始下載', 'success');
          } catch (e) {
            toast(e.message, 'error');
          }
        };
      });
      if (canDeleteBackup) {
        const updateSel = () => {
          const n = [...box.querySelectorAll('input[data-backup-check]:checked')].length;
          const el = $('#backup-sel-count');
          if (el) el.textContent = `已選 ${n} 筆`;
        };
        $('#chk-all-backups')?.addEventListener('change', (e) => {
          box.querySelectorAll('input[data-backup-check]').forEach((c) => {
            c.checked = e.target.checked;
          });
          updateSel();
        });
        box.querySelectorAll('input[data-backup-check]').forEach((c) => {
          c.onchange = updateSel;
        });
        box.querySelectorAll('[data-del-backup]').forEach((btn) => {
          btn.onclick = async () => {
            if (!confirm(`確定刪除此備份 PDF？\n（不會刪除原始簽核單據）`)) return;
            try {
              await api(`/api/backups/${btn.dataset.delBackup}`, { method: 'DELETE' });
              toast('已刪除備份', 'success');
              await loadList(params);
            } catch (e) {
              toast(e.message, 'error');
            }
          };
        });
        $('#btn-bulk-del-backups')?.addEventListener('click', async () => {
          const ids = [...box.querySelectorAll('input[data-backup-check]:checked')].map((c) =>
            Number(c.value)
          );
          if (!ids.length) {
            toast('請先勾選要刪除的備份', 'error');
            return;
          }
          if (!confirm(`確定刪除選取的 ${ids.length} 筆備份 PDF？`)) return;
          try {
            const data = await api('/api/backups/bulk-delete', {
              method: 'POST',
              body: { ids },
            });
            toast(data.message || '已批次刪除', 'success');
            await loadList(params);
          } catch (e) {
            toast(e.message, 'error');
          }
        });
      }
    } catch (e) {
      box.innerHTML = `<div class="error-msg">${esc(e.message)}</div>`;
    }
  }

  $('#backup-run-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = {
      status: fd.get('status'),
      department: fd.get('department') || '',
      workflow_name: fd.get('workflow_name') || '',
      date_from: fd.get('date_from') || '',
      date_to: fd.get('date_to') || '',
      force: !!fd.get('force'),
    };
    const btn = $('#btn-run-backup');
    const out = $('#backup-run-result');
    btn.disabled = true;
    out.textContent = '備份進行中，請稍候…';
    try {
      const { result } = await api('/api/backups/run', { method: 'POST', body: payload });
      out.innerHTML = `完成：成功 <strong>${result.success}</strong>、略過（已存在） <strong>${result.skipped}</strong>、失敗 <strong>${result.failed}</strong>（共掃描 ${result.total} 筆）`;
      if (result.errors?.length) {
        out.innerHTML += `<div class="error-msg" style="margin-top:8px">${result.errors
          .slice(0, 5)
          .map((x) => `#${x.request_id}: ${esc(x.error)}`)
          .join('<br/>')}</div>`;
      }
      toast('備份作業完成', 'success');
      await loadList({});
    } catch (err) {
      out.textContent = '';
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  };

  $('#backup-query-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await loadList({
      department: fd.get('department'),
      workflow_name: fd.get('workflow_name'),
      year: fd.get('year'),
      month: fd.get('month'),
      keyword: fd.get('keyword'),
    });
  };
  $('#btn-backup-reset').onclick = () => {
    $('#backup-query-form').reset();
    loadList({});
  };

  // 預設載入全部
  await loadList({});
}

const PERM_LABEL = {
  workflows: '管理簽核流程',
  backups: '備份資料',
  records_all: '查看全部簽核紀錄',
  records_delete: '刪除簽核紀錄',
  leave_delete: '刪除請假申請',
  leave_report: '請假報表匯出',
  users_leave: '成員休假已休管理',
  finance_confirm: '財務部授信額度建檔確認',
};

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
  // hasPerm 對 admin 一律 true，故僅一般使用者看 finance_confirm 權限
  if (user.role !== 'admin' && hasPerm('finance_confirm')) return true;
  return false;
}

function formatPerms(u) {
  if (u.role === 'admin') return '全部權限（系統管理員）';
  const list = u.permissions || [];
  if (!list.length) return '一般（僅本人簽核）';
  return list.map((p) => PERM_LABEL[p] || p).join('、');
}

function getSelectedUserIds(root) {
  return [...(root || document).querySelectorAll('input[data-user-check]:checked')]
    .map((c) => Number(c.value))
    .filter(Boolean);
}

async function downloadUsersExcel(ids, { resetPasswords = false } = {}) {
  const blob = await api('/api/users/export', {
    method: 'POST',
    body: { ids: ids || [], resetPasswords },
    expectBlob: true,
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `成員名單_${twToday()}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

/** 人事：請假報表匯出 */
async function renderLeaveReport(body) {
  if (!hasPerm('leave_report')) {
    body.innerHTML = `<div class="error-msg">您沒有「請假報表匯出」權限（請洽系統管理員於成員權限中開啟）</div>`;
    return;
  }
  await loadUsers();
  const users = (state.users || []).filter((u) => u.active !== 0);
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  const defaultTo = `${y}-${m}-${d}`;
  const defaultFrom = `${y}-01-01`;

  body.innerHTML = `
    <div class="card" style="max-width:960px">
      <h3 style="margin-top:0">請假資料匯出（Excel）</h3>
      <p class="muted" style="margin-top:0;line-height:1.55">
        供<strong>人事單位</strong>匯出：可勾選<strong>多人</strong>、指定日期範圍。
        僅統計<strong>已核准</strong>請假。
        報表為<strong>一人一列</strong>：各有上限假別的<strong>應有／已請／剩餘／可請</strong>（天數），方便多人比對。
      </p>
      <div class="form-grid two" style="margin-bottom:12px">
        <div class="field">
          <label>日期起 *</label>
          <input type="date" id="lr-from" value="${defaultFrom}" required />
        </div>
        <div class="field">
          <label>日期迄 *</label>
          <input type="date" id="lr-to" value="${defaultTo}" required />
        </div>
      </div>
      <div class="field" style="margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <label style="margin:0">選擇人員 *（${users.length} 人）</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button type="button" class="btn outline sm" id="lr-all">全選</button>
            <button type="button" class="btn outline sm" id="lr-none">全不選</button>
            <span class="muted" id="lr-count">已選 0 人</span>
          </div>
        </div>
        <div class="approver-list" id="lr-user-list" style="margin-top:8px;max-height:280px;overflow:auto;border:1px solid var(--border);border-radius:10px;padding:10px">
          ${users
            .map(
              (u) => `
            <label style="display:flex;align-items:center;gap:8px;padding:4px 0">
              <input type="checkbox" data-lr-user value="${u.id}" />
              <span>
                <strong>${esc(u.name)}</strong>
                <span class="muted">（${esc(u.username)}）</span>
                ${u.department ? `<span class="muted">· ${esc(u.department)}</span>` : ''}
              </span>
            </label>`
            )
            .join('') || '<div class="muted">尚無成員</div>'}
        </div>
      </div>
      <div class="form-actions" style="margin-top:16px">
        <button type="button" class="btn primary" id="lr-export">匯出 Excel</button>
      </div>
      <p class="muted" style="font-size:0.82rem;margin-top:12px;line-height:1.45">
        Excel：
        <strong>人員餘額</strong>（一人一列 · 特休／事假／病假／祭儀等 · 應有／已請／剩餘／可請天數）、
        <strong>請假明細</strong>（期間已核准）、
        <strong>說明</strong>。
      </p>
    </div>`;

  const updateCount = () => {
    const n = body.querySelectorAll('input[data-lr-user]:checked').length;
    const el = $('#lr-count');
    if (el) el.textContent = `已選 ${n} 人`;
  };
  body.querySelectorAll('input[data-lr-user]').forEach((cb) => {
    cb.addEventListener('change', updateCount);
  });
  $('#lr-all')?.addEventListener('click', () => {
    body.querySelectorAll('input[data-lr-user]').forEach((cb) => {
      cb.checked = true;
    });
    updateCount();
  });
  $('#lr-none')?.addEventListener('click', () => {
    body.querySelectorAll('input[data-lr-user]').forEach((cb) => {
      cb.checked = false;
    });
    updateCount();
  });

  $('#lr-export')?.addEventListener('click', async () => {
    const userIds = [...body.querySelectorAll('input[data-lr-user]:checked')].map((c) =>
      Number(c.value)
    );
    const dateFrom = $('#lr-from')?.value;
    const dateTo = $('#lr-to')?.value;
    if (!userIds.length) {
      toast('請至少選擇一位人員', 'error');
      return;
    }
    if (!dateFrom || !dateTo) {
      toast('請選擇日期範圍', 'error');
      return;
    }
    if (dateFrom > dateTo) {
      toast('起始日期不可晚於結束日期', 'error');
      return;
    }
    const btn = $('#lr-export');
    if (btn) btn.disabled = true;
    try {
      // 一律僅匯出已核准
      const blob = await api('/api/reports/leave-export', {
        method: 'POST',
        body: { userIds, dateFrom, dateTo },
        expectBlob: true,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `請假報表_${dateFrom}_${dateTo}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      toast('Excel 已開始下載', 'success');
    } catch (e) {
      toast(e.message || '匯出失敗', 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}

async function renderUsers(body) {
  const canFull = isAdmin();
  const canLabor = hasPerm('users_leave');
  if (!canLabor) {
    body.innerHTML = emptyState({
      title: '無權限',
      desc: '需「成員休假已休管理」權限或系統管理員，才可查看成員名單。',
      actions: [{ label: '回總覽', go: 'dashboard', outline: true }],
    });
    bindDataGo(body);
    return;
  }
  const canEdit = canFull; // 完整管理（新增／刪除／權限／密碼）
  // 特休／年資：有 users_leave 或管理員
  const data = await api('/api/users?labor=1');
  const users = data.users || [];
  state.users = users;
  const defs = data.permissionDefs || [
    { id: 'workflows', label: PERM_LABEL.workflows },
    { id: 'backups', label: PERM_LABEL.backups },
    { id: 'records_all', label: PERM_LABEL.records_all },
    { id: 'leave_report', label: PERM_LABEL.leave_report },
    { id: 'users_leave', label: PERM_LABEL.users_leave },
  ];
  state.permissionDefs = defs;

  if (canFull) {
    $('#page-actions').innerHTML = `
      <button type="button" class="btn outline" id="btn-tpl-user">下載範本</button>
      <button type="button" class="btn outline" id="btn-import-user">Excel 匯入</button>
      <button type="button" class="btn outline" id="btn-export-all-user">匯出全部</button>
      <button type="button" class="btn primary" id="btn-add-user">＋ 新增成員</button>
      <input type="file" id="user-import-file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" class="hidden" />
    `;
  } else {
    $('#page-actions').innerHTML = `
      <span class="muted" style="font-size:0.88rem">您可查看成員並編輯<strong>可休／已休</strong>（特休以日計；其他假別可填小時）</span>
    `;
  }

  const laborCell = (u) => {
    const L = u.labor;
    const sl = L?.specialLeave;
    if (!L) {
      return `<span class="muted" style="font-size:0.82rem">尚無休假資料</span>`;
    }
    return `
      <div style="font-size:0.85rem;line-height:1.45">
        ${L.hireDate ? `<div>到職：${esc(L.hireDate)}${L.seniority?.label ? ` · ${esc(L.seniority.label)}` : ''}</div>` : `<div class="muted">到職日未設定</div>`}
        ${
          sl
            ? `<div>特休可休 <strong>${sl.entitled ?? 0}</strong> 日（手動）</div>
               <div>已休 ${sl.used ?? 0} 日
                 ${
                   sl.manualUsedDays
                     ? `<span class="muted">（手動 ${sl.manualUsedDays || 0} 日${
                         sl.systemUsed ? `＋系統 ${sl.systemUsed} 日` : ''
                       }）</span>`
                     : sl.systemUsed
                       ? `<span class="muted">（系統 ${sl.systemUsed} 日）</span>`
                       : ''
                 }
               </div>
               <div>剩餘 <strong style="color:${
                 (sl.remaining ?? 0) > 0 ? '#15803d' : '#b45309'
               }">${sl.remaining ?? 0}</strong> 日</div>
               <div class="muted" style="font-size:0.78rem">${esc(sl.yearLabel || '')} · 特休以日計</div>`
            : `<div class="muted">請於編輯設定各假別可休天數</div>`
        }
      </div>`;
  };

  body.innerHTML = `
    <div class="card">
      <p class="muted" style="margin-top:0">
        目前成員 <strong>${users.length}</strong> 人。
        ${
          canLabor
            ? `各假別<strong>可休天數一律手動設定</strong>（不依年資自動計算）。
        統計年度採<strong>曆年制</strong>（每年 1/1～12/31）。
        剩餘＝可休 −（<strong>手動已休</strong>＋系統已核准）。
        <strong>特休以日計算</strong>（不顯示小時）。
        ${
          canFull
            ? '管理員可於「編輯資料」填寫各假別可休與已休天數。'
            : '您可使用「編輯已休」填寫各假別可休與已休。'
        }`
            : ''
        }
      </p>
      ${
        canFull
          ? `<div class="form-actions" style="margin-bottom:12px;flex-wrap:wrap">
              <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
                <input type="checkbox" id="chk-all-users" /> 全選
              </label>
              <button type="button" class="btn outline sm" id="btn-export-selected">匯出選取</button>
              <button type="button" class="btn outline sm" id="btn-export-selected-pwd">匯出選取（重設密碼）</button>
              <button type="button" class="btn danger sm" id="btn-bulk-del">刪除選取</button>
              <span class="muted" id="sel-count">已選 0 人</span>
            </div>`
          : ''
      }
      <div class="table-wrap">
        <table class="data" style="width:100%;min-width:880px;table-layout:fixed">
          <thead>
            <tr>
              ${canFull ? '<th style="width:36px;text-align:center"></th>' : ''}
              <th style="width:110px;white-space:nowrap">姓名</th>
              <th style="width:120px;white-space:nowrap">帳號</th>
              <th style="width:130px">部門</th>
              ${canLabor ? '<th style="min-width:180px">休假（可休／已休／剩餘）</th>' : ''}
              <th style="min-width:160px">角色／權限</th>
              <th style="width:160px;text-align:center;white-space:nowrap">操作</th>
            </tr>
          </thead>
          <tbody>
            ${users
              .map(
                (u) => `
              <tr data-user-row="${u.id}">
                ${
                  canFull
                    ? `<td>
                        <input type="checkbox" data-user-check value="${u.id}"
                          ${
                            u.id === state.user?.id || isBuiltinAdminUser(u)
                              ? 'disabled title="' +
                                (isBuiltinAdminUser(u) ? '內建 Admin 不可刪除' : '不可選取自己') +
                                '"'
                              : ''
                          } />
                      </td>`
                    : ''
                }
                <td><strong>${esc(u.name)}</strong></td>
                <td>${esc(u.username)}</td>
                <td>
                  ${esc(u.department || '—')}
                  ${
                    u.departments && u.departments.length > 1
                      ? `<div class="muted" style="font-size:0.8rem">${esc(u.departments.join('、'))}</div>`
                      : ''
                  }
                </td>
                ${canLabor ? `<td style="white-space:normal;word-break:break-word">${laborCell(u)}</td>` : ''}
                <td style="white-space:normal;word-break:break-word">
                  ${
                    u.role === 'admin'
                      ? '<span class="tag draft">最高權限 · 系統管理員</span>'
                      : `<span class="tag">一般使用者</span>
                         <div class="muted" style="font-size:0.82rem;margin-top:4px">${esc(formatPerms(u))}</div>`
                  }
                </td>
                <td>
                  <div style="display:flex;flex-wrap:wrap;gap:6px">
                    ${
                      canFull
                        ? `<button type="button" class="btn sm primary" data-edit-user="${u.id}">編輯資料</button>`
                        : canLabor
                          ? `<button type="button" class="btn sm primary" data-edit-leave="${u.id}">編輯已休</button>`
                          : ''
                    }
                    ${
                      canLabor
                        ? `<button type="button" class="btn sm outline" data-labor-user="${u.id}">休假明細</button>`
                        : ''
                    }
                    ${
                      canFull
                        ? `<button type="button" class="btn sm outline" data-perm-edit="${u.id}"
                            ${isBuiltinAdminUser(u) && !isBuiltinAdmin() ? 'disabled' : ''}>權限</button>
                          <button type="button" class="btn sm outline" data-reset-pw="${u.id}">密碼</button>
                          ${
                            u.id === state.user?.id || isBuiltinAdminUser(u)
                              ? isBuiltinAdminUser(u)
                                ? '<span class="muted" style="font-size:0.78rem">內建帳號不可刪</span>'
                                : ''
                              : `<button type="button" class="btn sm danger" data-del-user="${u.id}">刪除</button>`
                          }`
                        : ''
                    }
                  </div>
                </td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </div>`;

  // 休假明細：管理員與休假權限皆可
  body.querySelectorAll('[data-labor-user]').forEach((btn) => {
    btn.onclick = async () => {
      try {
        const data = await api(`/api/users/${btn.dataset.laborUser}/labor`);
        openLaborDetailModal(data.user, data.labor);
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  });
  // 僅休假權限：編輯手動已休
  body.querySelectorAll('[data-edit-leave]').forEach((btn) => {
    btn.onclick = () => {
      const u = users.find((x) => x.id === Number(btn.dataset.editLeave));
      if (u) openUserLeaveEditor(u);
    };
  });

  if (!canFull) return;

  const updateSelCount = () => {
    const n = getSelectedUserIds(body).length;
    const el = $('#sel-count');
    if (el) el.textContent = `已選 ${n} 人`;
  };

  const addBtn = $('#btn-add-user');
  if (addBtn) addBtn.onclick = () => openAddUserModal(defs);

  $('#btn-tpl-user')?.addEventListener('click', async () => {
    try {
      const blob = await api('/api/users/export-template', { expectBlob: true });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = '成員名單_匯入範本.xlsx';
      a.click();
      URL.revokeObjectURL(url);
      toast('已下載範本', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  $('#btn-export-all-user')?.addEventListener('click', async () => {
    try {
      const reset = confirm(
        '是否在匯出時重設密碼並寫入 Excel？\n\n「確定」＝為每位成員產生隨機密碼並寫入密碼欄\n「取消」＝僅匯出名單，密碼欄空白（保留原密碼）'
      );
      await downloadUsersExcel([], { resetPasswords: reset });
      toast('已匯出全部成員', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  $('#btn-export-selected')?.addEventListener('click', async () => {
    const ids = getSelectedUserIds(body);
    if (!ids.length) {
      toast('請先勾選要匯出的成員', 'error');
      return;
    }
    try {
      await downloadUsersExcel(ids, { resetPasswords: false });
      toast(`已匯出 ${ids.length} 人`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  $('#btn-export-selected-pwd')?.addEventListener('click', async () => {
    const ids = getSelectedUserIds(body);
    if (!ids.length) {
      toast('請先勾選要匯出的成員', 'error');
      return;
    }
    if (
      !confirm(
        `確定重設並匯出 ${ids.length} 人的密碼？\n（每人一組隨機密碼，將寫入 Excel）`
      )
    ) {
      return;
    }
    try {
      await downloadUsersExcel(ids, { resetPasswords: true });
      toast(`已重設並匯出 ${ids.length} 人`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  $('#btn-import-user')?.addEventListener('click', () => $('#user-import-file')?.click());
  $('#user-import-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      const data = await api('/api/users/import', { method: 'POST', body: fd });
      toast(data.message || '匯入完成', 'success');
      if (data.errors?.length) {
        console.warn('import errors', data.errors);
        alert(`部分列有問題：\n${data.errors.slice(0, 12).join('\n')}`);
      }
      navigate('users');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  $('#chk-all-users')?.addEventListener('change', (e) => {
    body.querySelectorAll('input[data-user-check]:not(:disabled)').forEach((c) => {
      c.checked = e.target.checked;
    });
    updateSelCount();
  });
  body.querySelectorAll('input[data-user-check]').forEach((c) => {
    c.onchange = updateSelCount;
  });

  $('#btn-bulk-del')?.addEventListener('click', async () => {
    const ids = getSelectedUserIds(body);
    if (!ids.length) {
      toast('請先勾選要刪除的成員', 'error');
      return;
    }
    const names = ids
      .map((id) => users.find((u) => u.id === id))
      .filter(Boolean)
      .map((u) => `${u.name}（${u.username}）`)
      .slice(0, 15);
    if (
      !confirm(
        `確定刪除選取的 ${ids.length} 位成員？\n\n${names.join('\n')}${ids.length > 15 ? '\n…' : ''}\n\n刪除後無法登入（歷史簽核紀錄仍保留）。`
      )
    ) {
      return;
    }
    try {
      const data = await api('/api/users/bulk-delete', {
        method: 'POST',
        body: { ids },
      });
      toast(data.message || '已批次刪除', 'success');
      navigate('users');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  body.querySelectorAll('[data-edit-user]').forEach((btn) => {
    btn.onclick = () => {
      const u = users.find((x) => x.id === Number(btn.dataset.editUser));
      if (u) openMemberEditor(u, defs);
    };
  });
  body.querySelectorAll('[data-labor-user]').forEach((btn) => {
    btn.onclick = async () => {
      try {
        const data = await api(`/api/users/${btn.dataset.laborUser}/labor`);
        openLaborDetailModal(data.user, data.labor);
      } catch (e) {
        toast(e.message, 'error');
      }
    };
  });

  body.querySelectorAll('[data-perm-edit]').forEach((btn) => {
    btn.onclick = () => {
      const u = users.find((x) => x.id === Number(btn.dataset.permEdit));
      if (u) openUserPermissionEditor(u, defs);
    };
  });

  body.querySelectorAll('[data-reset-pw]').forEach((btn) => {
    btn.onclick = () => {
      const u = users.find((x) => x.id === Number(btn.dataset.resetPw));
      if (u) openAdminResetPasswordModal(u);
    };
  });

  body.querySelectorAll('[data-del-user]').forEach((btn) => {
    btn.onclick = async () => {
      const id = Number(btn.dataset.delUser);
      const u = users.find((x) => x.id === id);
      if (!u) return;
      if (
        !confirm(
          `確定刪除成員「${u.name}」（${u.username}）？\n刪除後無法以此帳號登入（歷史簽核紀錄仍會保留姓名）。`
        )
      ) {
        return;
      }
      try {
        await api(`/api/users/${id}`, { method: 'DELETE' });
        toast('已刪除成員', 'success');
        navigate('users');
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  });
}

/**
 * 系統進階稽核日誌 (P3-1)
 */
async function renderAuditLogs(body) {
  const query = state.auditListQuery || {};
  const page = Number(query.page) || 1;
  const q = String(query.q || '').trim();
  const category = String(query.category || '').trim();
  const dateFrom = String(query.dateFrom || '').trim();
  const dateTo = String(query.dateTo || '').trim();

  const params = new URLSearchParams({ page, limit: 30 });
  if (q) params.set('q', q);
  if (category) params.set('category', category);
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);

  let data = { logs: [], totalCount: 0, totalPages: 1 };
  try {
    data = await api(`/api/system/audit-logs?${params.toString()}`);
  } catch (err) {
    toast(err.message, 'error');
  }

  const categoryLabels = {
    auth: '🔒 帳號身份與登入',
    approval: '📝 流程與簽核動作',
    user_management: '👥 成員與權限變更',
    workflow: '⚙️ 簽核流程範本',
    system: '🛠️ 系統維運與設定',
  };

  const exportUrl = `/api/system/audit-logs/export?${params.toString()}`;

  body.innerHTML = `
    <div class="card">
      <form id="audit-filter-form" class="req-filter-bar" style="margin-bottom:16px;padding:16px 18px">
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:14px;align-items:end">
          <div class="field" style="margin:0">
            <label>關鍵字搜尋</label>
            <input type="search" name="q" value="${esc(q)}" placeholder="使用者姓名、帳號、IP、說明關鍵字…" autocomplete="off" />
          </div>
          <div class="field" style="margin:0">
            <label>日誌分類</label>
            <select name="category">
              <option value="">全部分類</option>
              ${Object.entries(categoryLabels)
                .map(([k, v]) => `<option value="${k}" ${category === k ? 'selected' : ''}>${v}</option>`)
                .join('')}
            </select>
          </div>
          <div class="field" style="margin:0">
            <label>發生日期（起～迄）</label>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:nowrap">
              <input type="date" name="dateFrom" value="${esc(dateFrom)}" style="flex:1;min-width:120px" />
              <span class="muted" style="flex-shrink:0">～</span>
              <input type="date" name="dateTo" value="${esc(dateTo)}" style="flex:1;min-width:120px" />
            </div>
          </div>
        </div>
        <div class="form-actions" style="margin-top:14px;display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px">
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            <button type="submit" class="btn primary sm">查詢日誌</button>
            <button type="button" class="btn outline sm" id="btn-audit-clear">清除條件</button>
            <span class="muted" style="font-size:0.85rem">共 <strong>${data.totalCount || 0}</strong> 筆日誌</span>
          </div>
          <a href="${exportUrl}" download class="btn outline sm" style="display:inline-flex;align-items:center;gap:4px">
            📥 匯出 CSV 報告
          </a>
        </div>
      </form>

      ${
        !data.logs || !data.logs.length
          ? emptyState({ title: '尚無稽核日誌', desc: '目前沒有符合篩選條件的系統稽核紀錄。' })
          : `
            <div class="table-wrap">
              <table class="data" style="width:100%;min-width:1040px;table-layout:fixed">
                <thead>
                  <tr>
                    <th style="width:150px;white-space:nowrap">時間</th>
                    <th style="width:175px;white-space:nowrap">分類</th>
                    <th style="width:130px;white-space:nowrap">執行人員</th>
                    <th style="width:150px;white-space:nowrap">IP 位址</th>
                    <th style="min-width:320px">說明詳情</th>
                  </tr>
                </thead>
                <tbody>
                  ${data.logs
                    .map(
                      (l) => `
                    <tr style="vertical-align:top">
                      <td class="muted" style="white-space:nowrap">${esc(l.created_at)}</td>
                      <td style="white-space:nowrap">
                        <span class="tag draft" style="font-size:0.75rem;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block;vertical-align:middle" title="${esc(categoryLabels[l.category] || l.category || '一般')}">${esc(categoryLabels[l.category] || l.category || '一般')}</span>
                      </td>
                      <td style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(l.user_name || '系統/訪客')}${l.user_username ? ` (@${esc(l.user_username)})` : ''}">
                        <strong>${esc(l.user_name || '系統/訪客')}</strong>
                        ${l.user_username ? `<span class="muted" style="font-size:0.78rem">(@${esc(l.user_username)})</span>` : ''}
                      </td>
                      <td style="white-space:nowrap"><code style="display:inline-block;max-width:100%;overflow:hidden;text-overflow:ellipsis;vertical-align:middle" title="${esc(l.ip_address || '127.0.0.1')}">${esc(l.ip_address || '127.0.0.1')}</code></td>
                      <td style="white-space:normal;word-break:break-word;line-height:1.5;color:#334155">${esc(l.description)}</td>
                    </tr>`
                    )
                    .join('')}
                </tbody>
              </table>
            </div>
            
            ${
              data.totalPages > 1
                ? `<div class="pagination">
                    <button type="button" class="page-btn" id="btn-audit-prev" ${page <= 1 ? 'disabled' : ''}>上一頁</button>
                    <span style="font-size:0.88rem;color:#475569;font-weight:600;padding:0 6px">第 ${page} / ${data.totalPages} 頁</span>
                    <button type="button" class="page-btn" id="btn-audit-next" ${page >= data.totalPages ? 'disabled' : ''}>下一頁</button>
                  </div>`
                : ''
            }
          `
      }
    </div>
  `;

  $('#audit-filter-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    state.auditListQuery = {
      q: String(fd.get('q') || '').trim(),
      category: String(fd.get('category') || '').trim(),
      dateFrom: String(fd.get('dateFrom') || '').trim(),
      dateTo: String(fd.get('dateTo') || '').trim(),
      page: 1,
    };
    renderAuditLogs(body);
  });

  $('#btn-audit-clear')?.addEventListener('click', (e) => {
    e.preventDefault();
    state.auditListQuery = {};
    renderAuditLogs(body);
  });

  $('#btn-audit-prev')?.addEventListener('click', () => {
    if (page > 1) {
      state.auditListQuery = { ...state.auditListQuery, page: page - 1 };
      renderAuditLogs(body);
    }
  });

  $('#btn-audit-next')?.addEventListener('click', () => {
    if (page < data.totalPages) {
      state.auditListQuery = { ...state.auditListQuery, page: page + 1 };
      renderAuditLogs(body);
    }
  });
}

/**
 * 畫面動態防偽浮水印（依需求：僅套用到 PDF，畫面網頁不顯示）
 */
function updateAppWatermark() {
  const overlay = document.getElementById('app-watermark-overlay');
  if (overlay) overlay.remove();
}

/** 休假明細（可休／已休皆手動） */
/**
 * 僅編輯到職日 + 各假別可休／已休（給「成員休假已休管理」權限使用）
 */
function openUserLeaveEditor(user) {
  const hireVal = user.hire_date || user.labor?.hireDate || '';
  openModal(`
    <h3>編輯休假設定 — ${esc(user.name)}</h3>
    <p class="muted" style="margin-top:0">帳號：${esc(user.username)}　部門：${esc(user.department || '—')}</p>
    <form id="leave-edit-form" class="form-grid">
      <div class="field">
        <label>到職日（選填）</label>
        <input name="hire_date" type="date" value="${esc(hireVal)}" />
        <div class="muted" style="font-size:0.8rem;margin-top:4px">僅供顯示；可休日數不依年資計算</div>
      </div>
      ${renderManualLeaveUsedFields(user)}
      <div class="form-actions">
        <button type="submit" class="btn primary">儲存休假設定</button>
        <button type="button" class="btn outline" data-close-modal>取消</button>
      </div>
    </form>
  `);
  $('#modal-panel')?.classList.add('wide');
  $('#leave-edit-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const leavePayload = collectLeaveUsedFromForm(fd);
    try {
      await api(`/api/users/${user.id}`, {
        method: 'PUT',
        body: {
          hire_date: String(fd.get('hire_date') || '').trim(),
          leave_used: leavePayload.leave_used,
          leave_entitled: leavePayload.leave_entitled,
          sl_used_days: leavePayload.sl_used_days,
          sl_used_hours: leavePayload.sl_used_hours,
        },
      });
      closeModal();
      toast('休假可休／已休已更新', 'success');
      navigate('users');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

function openLaborDetailModal(user, laborInfo) {
  const L = laborInfo || user?.labor || {};
  const sl = L.specialLeave;
  const balances = Array.isArray(L.leaveBalances) ? L.leaveBalances : [];
  const balanceRows = balances
    .map((b) => {
      const remColor =
        b.remaining == null
          ? '#64748b'
          : b.remaining < 0
            ? '#b91c1c'
            : b.remaining === 0
              ? '#b45309'
              : '#15803d';
      const usedDetail =
        b.used != null
          ? `${b.used} 日${
              b.canTrackManual || b.manualUsed != null || b.systemUsed != null
                ? `<div class="muted" style="font-size:0.72rem;font-weight:400">手動 ${b.manualUsed ?? 0} ＋ 系統 ${b.systemUsed ?? 0}</div>`
                : ''
            }`
          : '—';
      return `<tr>
        <td>
          <div style="font-weight:600">${esc(b.name)}</div>
          <div class="muted" style="font-size:0.75rem;line-height:1.35;margin-top:2px">${esc(b.law || '')}</div>
          ${b.note ? `<div class="muted" style="font-size:0.72rem;margin-top:2px">${esc(b.note)}</div>` : ''}
        </td>
        <td style="text-align:right;white-space:nowrap">${esc(b.entitledLabel || '—')}</td>
        <td style="text-align:right;white-space:nowrap">${usedDetail}</td>
        <td style="text-align:right;white-space:nowrap;font-weight:600;color:${remColor}">${esc(b.remainingLabel || '—')}</td>
      </tr>`;
    })
    .join('');

  // 優先使用「全部假別」單號明細；舊資料才回退特休 usedDetails
  const allDetails =
    Array.isArray(L.leaveUsedDetails) && L.leaveUsedDetails.length
      ? L.leaveUsedDetails
      : sl?.usedDetails || [];
  const usedRows = allDetails
    .map(
      (d) =>
        `<tr>
          <td><a href="#/detail/${d.requestId}" class="linkish" data-open-request="${d.requestId}">#${d.requestId}</a></td>
          <td>${esc(d.leaveType || '—')}</td>
          <td>${esc(d.start || '')}${d.end && d.end !== d.start ? ` ～ ${esc(d.end)}` : ''}</td>
          <td style="text-align:right">${d.days != null ? d.days : '—'}</td>
        </tr>`
    )
    .join('');

  openModal(`
    <h3>休假明細 — ${esc(user?.name || '')}</h3>
    <div class="kv" style="margin-bottom:12px">
      <dt>到職日</dt><dd>${esc(L.hireDate || '未設定')}（僅供參考）</dd>
      <dt>年資</dt><dd>${esc(L.seniority?.label || '—')}（不影響可休日數）</dd>
      ${
        sl
          ? `
      <dt>統計年度</dt><dd>${esc(sl.yearLabel || L.leaveBalanceYearLabel || '—')}</dd>
      <dt>特休可休</dt><dd><strong>${sl.entitled ?? 0}</strong> 日（<strong>手動設定</strong>，以日計）</dd>
      <dt>手動已休</dt><dd>${sl.manualUsedDays ?? 0} 日</dd>
      <dt>系統已休</dt><dd>${sl.systemUsed ?? 0} 日（本年度已核准特休）</dd>
      <dt>合計已休</dt><dd>${sl.used} 日</dd>
      <dt>剩餘特休</dt><dd><strong style="color:${(sl.remaining ?? 0) > 0 ? '#15803d' : '#b45309'}">${sl.remaining ?? 0}</strong> 日</dd>
      `
          : `<dt>說明</dt><dd class="muted">${esc(L.note || '請於編輯設定各假別可休天數')}</dd>`
      }
    </div>
    ${
      balanceRows
        ? `<h4 style="margin:12px 0 6px;font-size:0.95rem">各假別可休／已休／剩餘（全部手動可休）</h4>
           <p class="muted" style="margin:0 0 8px;font-size:0.82rem">統計年度：${esc(L.leaveBalanceYearLabel || sl?.yearLabel || '本年度')}；可休由成員名單手動設定；已休＝手動已休＋本系統已核准請假；特休以日計</p>
           <div class="table-wrap"><table class="data">
           <thead><tr>
             <th style="min-width:160px">假別</th>
             <th style="text-align:right">可休（手動）</th>
             <th style="text-align:right">本年度已休</th>
             <th style="text-align:right">剩餘</th>
           </tr></thead>
           <tbody>${balanceRows}</tbody></table></div>`
        : ''
    }
    ${
      usedRows
        ? `<h4 style="margin:16px 0 6px;font-size:0.95rem">休假明細（系統已核准 · 各假別單號）</h4>
           <div class="table-wrap"><table class="data">
           <thead><tr><th>單號</th><th>假別</th><th>起迄</th><th>天數</th></tr></thead>
           <tbody>${usedRows}</tbody></table></div>`
        : `<p class="muted" style="font-size:0.9rem;margin-top:12px">本年度尚無已核准之請假申請（系統）。</p>`
    }
    <p class="muted" style="font-size:0.8rem;margin-top:12px;line-height:1.5">
      <strong>說明</strong>：各假別<strong>可休日數一律由人事於成員名單手動填寫</strong>，系統<strong>不再依年資</strong>自動計算特休。
      已休＝手動已休＋本系統已核准請假；統計年度為曆年制（1/1～12/31）；<strong>特休以日計算，不換算小時</strong>。
    </p>
    <div class="form-actions">
      <button type="button" class="btn outline" data-close-modal>關閉</button>
    </div>
  `);
  $('#modal-panel')?.classList.add('wide');
  // 單號可點擊開啟申請詳情
  $('#modal-panel')?.querySelectorAll('[data-open-request]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const id = Number(el.dataset.openRequest);
      if (!id) return;
      closeModal();
      navigate('detail', { id });
    });
  });
}

/** 系統管理員編輯成員完整資料（含帳號） */
async function openMemberEditor(user, defs) {
  if (!state.departments?.length) {
    try {
      await loadDepartmentOptions();
    } catch {
      /* ignore */
    }
  }
  const depts = state.departments || [];
  const userDepts = new Set(user.departments || (user.department ? [user.department] : []));
  const perms = new Set(user.permissions || []);
  const hireVal = user.hire_date || user.labor?.hireDate || '';
  const sl = user.labor?.specialLeave;

  const builtin = isBuiltinAdminUser(user);
  openModal(`
    <h3>編輯成員 — ${esc(user.name)}${builtin ? ' <span class="muted" style="font-size:0.85rem">（系統內建 Admin）</span>' : ''}</h3>
    <form id="edit-member-form" class="form-grid">
      <div class="form-grid two">
        <div class="field">
          <label>帳號 *</label>
          <input name="username" required minlength="3" value="${esc(user.username)}" autocomplete="off"
            ${builtin ? 'readonly disabled' : ''} />
          ${
            builtin
              ? '<div class="muted" style="font-size:0.78rem;margin-top:4px">內建 Admin 帳號名稱鎖定，不可修改；可於下方重設密碼</div>'
              : ''
          }
        </div>
        <div class="field">
          <label>姓名 *</label>
          <input name="name" required value="${esc(user.name)}" />
        </div>
      </div>
      <div class="form-grid two">
        <div class="field">
          <label>Email</label>
          <input name="email" type="email" value="${esc(user.email || '')}" />
        </div>
        <div class="field">
          <label>到職日（選填）</label>
          <input name="hire_date" type="date" value="${esc(hireVal)}" />
          <div class="muted" style="font-size:0.8rem;margin-top:4px">僅供顯示；可休日數不依年資計算</div>
        </div>
      </div>
      ${renderManualLeaveUsedFields(user)}
      <div class="form-grid two">
        <div class="field">
          <label>電話 / 分機</label>
          <div style="display:flex;gap:8px">
            <input name="phone" value="${esc(user.phone || '')}" placeholder="電話" style="flex:1" />
            <input name="extension" value="${esc(user.extension || '')}" placeholder="分機" style="width:90px" />
          </div>
        </div>
        <div class="field">
          ${
            sl
              ? `<label>特休餘額（儲存後更新）</label>
                 <div style="font-size:0.9rem;padding:8px 0;line-height:1.5">
                   可休 <strong>${sl.entitled ?? 0}</strong> 日（手動）<br/>
                   已休 ${sl.used ?? 0} 日
                   <span class="muted">（手動＋系統）</span><br/>
                   剩餘 <strong style="color:${(sl.remaining ?? 0) > 0 ? '#15803d' : '#b45309'}">${sl.remaining ?? 0}</strong> 日
                   <div class="muted" style="font-size:0.78rem;margin-top:2px">特休以日計算，不換算小時</div>
                 </div>`
              : `<label class="muted">特休餘額</label>
                 <div class="muted" style="font-size:0.85rem;padding:8px 0">請於上方填寫「可休天數」後儲存</div>`
          }
        </div>
      </div>
      <div class="field">
        <label>主部門</label>
        <select name="department">
          <option value="">（未指定）</option>
          ${depts
            .map(
              (d) =>
                `<option value="${esc(d.name)}" ${user.department === d.name ? 'selected' : ''}>${esc(d.name)}</option>`
            )
            .join('')}
        </select>
      </div>
      <div class="field">
        <label>隸屬部門（可多選）</label>
        <div class="approver-list" style="margin-top:8px;max-height:160px">
          ${depts
            .map(
              (d) => `
            <label>
              <input type="checkbox" name="dept" value="${esc(d.name)}"
                ${userDepts.has(d.name) ? 'checked' : ''} />
              ${esc(d.name)}
            </label>`
            )
            .join('') || '<span class="muted">尚無部門</span>'}
        </div>
      </div>
      <div class="field">
        <label>權限等級</label>
        <select name="role" id="edit-member-role" ${builtin ? 'disabled' : ''}>
          <option value="user" ${user.role !== 'admin' ? 'selected' : ''}>一般使用者</option>
          <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>最高權限（系統管理員）</option>
        </select>
        ${builtin ? '<div class="muted" style="font-size:0.78rem;margin-top:4px">內建 Admin 固定為系統管理員</div>' : ''}
      </div>
      <div class="field" id="edit-perm-wrap">
        <label>一般使用者額外權限</label>
        <div class="approver-list" style="margin-top:8px">
          ${(defs || [])
            .map(
              (p) => `
            <label>
              <input type="checkbox" name="perm" value="${esc(p.id)}"
                ${perms.has(p.id) || user.role === 'admin' ? 'checked' : ''} />
              ${esc(p.label)}
            </label>`
            )
            .join('')}
        </div>
      </div>
      <div class="field">
        <label>重設密碼（選填）</label>
        <input name="password" type="password" minlength="6" autocomplete="new-password"
          placeholder="空白＝不變更密碼；填寫則重設（至少 6 字元）" />
      </div>
      <div class="form-actions">
        <button type="submit" class="btn primary">儲存</button>
        <button type="button" class="btn outline" data-close-modal>取消</button>
      </div>
    </form>
  `);
  $('#modal-panel')?.classList.add('wide');

  const roleSel = $('#edit-member-role');
  const syncPerm = () => {
    const isAdm = roleSel?.value === 'admin';
    $$('#edit-perm-wrap input[name=perm]').forEach((cb) => {
      cb.disabled = isAdm;
      if (isAdm) cb.checked = true;
    });
  };
  if (roleSel) roleSel.onchange = syncPerm;
  syncPerm();

  $('#edit-member-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const role = fd.get('role') || 'user';
    const departments = [...document.querySelectorAll('#edit-member-form input[name=dept]:checked')].map(
      (c) => c.value
    );
    const permissions =
      role === 'admin'
        ? []
        : [...document.querySelectorAll('#edit-perm-wrap input[name=perm]:checked')].map(
            (c) => c.value
          );
    const password = String(fd.get('password') || '').trim();
    const leavePayload = collectLeaveUsedFromForm(fd);
    const body = {
      // 內建 Admin 不送帳號變更（欄位 disabled 時 FormData 可能沒有值）
      username: isBuiltinAdminUser(user)
        ? user.username
        : formatUsername(fd.get('username')),
      name: String(fd.get('name') || '').trim(),
      email: String(fd.get('email') || '').trim(),
      phone: String(fd.get('phone') || '').trim(),
      extension: String(fd.get('extension') || '').trim(),
      hire_date: String(fd.get('hire_date') || '').trim(),
      leave_used: leavePayload.leave_used,
      leave_entitled: leavePayload.leave_entitled,
      sl_used_days: leavePayload.sl_used_days,
      sl_used_hours: leavePayload.sl_used_hours,
      department: String(fd.get('department') || '').trim(),
      departments,
      role: isBuiltinAdminUser(user) ? 'admin' : role,
      permissions: isBuiltinAdminUser(user) ? [] : permissions,
    };
    if (password) body.password = password;
    try {
      const data = await api(`/api/users/${user.id}`, { method: 'PUT', body });
      if (user.id === state.user?.id) {
        const { user: me } = await api('/api/auth/me');
        state.user = me;
        applyRoleUi();
        if (data.selfUsernameChanged) {
          toast(`帳號已改為 ${data.selfUsernameChanged}，請記得使用新帳號登入`, 'success');
        }
      }
      closeModal();
      toast('成員資料已更新', 'success');
      navigate('users');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

async function openAddUserModal(defs) {
  if (!state.departments?.length) {
    try {
      await loadDepartmentOptions();
    } catch {
      /* ignore */
    }
  }
  const depts = state.departments || [];
  openModal(`
    <h3>新增成員</h3>
    <form id="add-user-form" class="form-grid">
      <div class="field">
        <label>帳號 *</label>
        <input name="username" required minlength="3" placeholder="至少 3 字元；顯示首字母大寫，登入不分大小寫" autocomplete="off" />
      </div>
      <div class="field">
        <label>姓名 *</label>
        <input name="name" required placeholder="顯示名稱" />
      </div>
      <div class="field">
        <label>到職日</label>
        <input name="hire_date" type="date" />
        <div class="muted" style="font-size:0.8rem;margin-top:4px">選填；僅供顯示年資，可休日數不依年資計算</div>
      </div>
      ${renderManualLeaveUsedFields(null)}
      <div class="field">
        <label>密碼 *</label>
        <input name="password" type="password" required minlength="6" placeholder="至少 6 字元" autocomplete="new-password" />
      </div>
      <div class="field">
        <label>部門</label>
        <select name="department">
          <option value="">請選擇部門…</option>
          ${depts.map((d) => `<option value="${esc(d.name)}">${esc(d.name)}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label>Email</label>
        <input name="email" type="email" placeholder="選填" />
      </div>
      <div class="field">
        <label>權限等級</label>
        <select name="role" id="add-user-role">
          <option value="user" selected>一般使用者</option>
          <option value="admin">最高權限（系統管理員）</option>
        </select>
      </div>
      <div class="field" id="add-perm-wrap">
        <label>一般使用者額外權限</label>
        <div class="approver-list" style="margin-top:8px">
          ${(defs || [])
            .map(
              (p) => `
            <label>
              <input type="checkbox" name="perm" value="${esc(p.id)}" />
              <span>${esc(p.label)}</span>
            </label>`
            )
            .join('')}
        </div>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn primary">建立成員</button>
        <button type="button" class="btn outline" data-close-modal>取消</button>
      </div>
    </form>
  `);

  const roleSel = $('#add-user-role');
  const sync = () => {
    const isAdm = roleSel.value === 'admin';
    $$('#add-perm-wrap input[name=perm]').forEach((cb) => {
      cb.disabled = isAdm;
      if (isAdm) cb.checked = false;
    });
  };
  if (roleSel) roleSel.onchange = sync;
  sync();
  $('#modal-panel')?.classList.add('wide');

  $('#add-user-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const role = fd.get('role') || 'user';
    const permissions =
      role === 'admin'
        ? []
        : [...document.querySelectorAll('#add-perm-wrap input[name=perm]:checked')].map(
            (c) => c.value
          );
    try {
      const leavePayload = collectLeaveUsedFromForm(fd);
      await api('/api/users', {
        method: 'POST',
        body: {
          username: formatUsername(fd.get('username')),
          name: fd.get('name'),
          password: fd.get('password'),
          department: fd.get('department') || '',
          email: fd.get('email') || '',
          hire_date: fd.get('hire_date') || '',
          leave_used: leavePayload.leave_used,
          leave_entitled: leavePayload.leave_entitled,
          sl_used_days: leavePayload.sl_used_days,
          sl_used_hours: leavePayload.sl_used_hours,
          role,
          permissions,
        },
      });
      closeModal();
      toast('成員已新增', 'success');
      navigate('users');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

/** 系統管理員修改任一成員密碼 */
function openAdminResetPasswordModal(user) {
  openModal(`
    <h3>修改密碼 — ${esc(user.name)}</h3>
    <p class="muted" style="margin-top:0">
      帳號：<strong>${esc(user.username)}</strong>
      　部門：${esc(user.department || '—')}<br/>
      系統管理員可直接設定新密碼，不需對方舊密碼。修改後請通知對方以新密碼登入。
    </p>
    <form id="admin-reset-pw-form" class="form-grid">
      <div class="field">
        <label>新密碼 *</label>
        <input name="password" type="password" required minlength="6" autocomplete="new-password"
          placeholder="至少 6 字元" />
      </div>
      <div class="field">
        <label>確認新密碼 *</label>
        <input name="confirmPassword" type="password" required minlength="6" autocomplete="new-password"
          placeholder="再輸入一次" />
      </div>
      <div class="form-actions">
        <button type="submit" class="btn primary">儲存密碼</button>
        <button type="button" class="btn outline" data-close-modal>取消</button>
      </div>
    </form>
  `);

  $('#admin-reset-pw-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const password = String(fd.get('password') || '');
    const confirmPassword = String(fd.get('confirmPassword') || '');
    if (password.length < 6) {
      toast('新密碼至少 6 字元', 'error');
      return;
    }
    if (password !== confirmPassword) {
      toast('兩次輸入的密碼不一致', 'error');
      return;
    }
    try {
      const data = await api(`/api/users/${user.id}/password`, {
        method: 'PUT',
        body: { password, confirmPassword },
      });
      closeModal();
      toast(data.message || `已更新「${user.name}」的密碼`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

function openUserPermissionEditor(user, defs) {
  const isSelf = user.id === state.user?.id;
  const perms = new Set(user.permissions || []);
  openModal(`
    <h3>設定權限 — ${esc(user.name)}</h3>
    <p class="muted" style="margin-top:0">帳號：${esc(user.username)}　部門：${esc(user.department || '—')}</p>
    <form id="perm-form" class="form-grid">
      <div class="field" style="text-align:left">
        <label style="text-align:left">權限等級 *</label>
        <div id="role-level-list" style="margin-top:8px;display:flex;flex-direction:column;flex-wrap:nowrap;align-items:stretch;justify-content:flex-start;gap:10px;text-align:left">
          <label style="display:flex;align-items:flex-start;justify-content:flex-start;gap:10px;border:1px solid var(--border);border-radius:10px;padding:12px;cursor:pointer;background:#f8fafc;margin:0;width:100%;box-sizing:border-box;text-align:left;white-space:normal">
            <input type="radio" name="role_level" value="admin" ${user.role === 'admin' ? 'checked' : ''}
              style="margin:3px 0 0;flex-shrink:0;width:16px;height:16px" />
            <span style="flex:1;min-width:0;text-align:left">
              <strong style="color:#1e3a5f;display:block;line-height:1.35;text-align:left">最高權限（系統管理員）</strong>
              <span class="muted" style="display:block;font-size:0.85rem;margin-top:6px;line-height:1.45;text-align:left;white-space:normal">
                可管理簽核流程、備份資料、成員權限、查看全部紀錄等全部功能。
              </span>
            </span>
          </label>
          <label style="display:flex;align-items:flex-start;justify-content:flex-start;gap:10px;border:1px solid var(--border);border-radius:10px;padding:12px;cursor:pointer;background:#f8fafc;margin:0;width:100%;box-sizing:border-box;text-align:left;white-space:normal">
            <input type="radio" name="role_level" value="user" ${user.role !== 'admin' ? 'checked' : ''}
              style="margin:3px 0 0;flex-shrink:0;width:16px;height:16px" />
            <span style="flex:1;min-width:0;text-align:left">
              <strong style="display:block;line-height:1.35;text-align:left">一般使用者</strong>
              <span class="muted" style="display:block;font-size:0.85rem;margin-top:6px;line-height:1.45;text-align:left;white-space:normal">
                僅本人簽核相關功能；可再勾選下方額外權限。
              </span>
            </span>
          </label>
        </div>
      </div>
      <div class="field" id="perm-checks-wrap">
        <label>一般使用者的額外功能權限</label>
        <div class="approver-list" style="margin-top:8px">
          ${defs
            .map(
              (p) => `
            <label>
              <input type="checkbox" name="perm" value="${esc(p.id)}"
                ${perms.has(p.id) || user.role === 'admin' ? 'checked' : ''}
                ${user.role === 'admin' ? 'disabled' : ''} />
              <span><strong>${esc(p.label)}</strong>
                ${p.description ? `<span class="muted"> — ${esc(p.description)}</span>` : ''}
              </span>
            </label>`
            )
            .join('')}
        </div>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn primary">儲存</button>
        <button type="button" class="btn outline" data-close-modal>取消</button>
      </div>
    </form>
  `);

  const syncChecks = () => {
    const isAdm = document.querySelector('input[name=role_level]:checked')?.value === 'admin';
    $$('#perm-checks-wrap input[name=perm]').forEach((cb) => {
      cb.disabled = isAdm;
      if (isAdm) cb.checked = true;
    });
  };
  $$('input[name=role_level]').forEach((r) => {
    r.onchange = syncChecks;
  });
  syncChecks();

  $('#perm-form').onsubmit = async (e) => {
    e.preventDefault();
    const role = document.querySelector('input[name=role_level]:checked')?.value || 'user';
    const permissions =
      role === 'admin'
        ? []
        : [...document.querySelectorAll('#perm-checks-wrap input[name=perm]:checked')].map(
            (c) => c.value
          );
    try {
      await api(`/api/users/${user.id}`, {
        method: 'PUT',
        body: { role, permissions },
      });
      if (isSelf) {
        const { user: me } = await api('/api/auth/me');
        state.user = me;
        applyRoleUi();
      }
      closeModal();
      toast(
        role === 'admin' ? '已設為最高權限（系統管理員）' : '權限已更新',
        'success'
      );
      navigate('users');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

async function refreshDeptLists() {
  try {
    await loadDepartmentOptions();
  } catch {
    /* ignore */
  }
}

function openAddDeptModal() {
  openModal(`
    <h3>新增部門</h3>
    <form id="add-dept-form" class="form-grid">
      <div class="field">
        <label>部門名稱 *</label>
        <input name="name" required maxlength="40" placeholder="例如：人資部、品保部" />
      </div>
      <div class="form-actions">
        <button type="submit" class="btn primary">建立</button>
        <button type="button" class="btn outline" data-close-modal>取消</button>
      </div>
    </form>
  `);
  $('#add-dept-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/api/departments', { method: 'POST', body: { name: fd.get('name') } });
      closeModal();
      toast('部門已新增', 'success');
      await refreshDeptLists();
      navigate('departments');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

function openRenameDeptModal(dept) {
  openModal(`
    <h3>修改部門名稱</h3>
    <p class="muted" style="margin-top:0">原名稱：${esc(dept.name)}</p>
    <form id="rename-dept-form" class="form-grid">
      <div class="field">
        <label>新部門名稱 *</label>
        <input name="name" required maxlength="40" value="${esc(dept.name)}" />
      </div>
      <p class="muted" style="font-size:0.85rem;margin:0">修改後，此部門下所有成員的「所屬部門」會一併更新。</p>
      <div class="form-actions">
        <button type="submit" class="btn primary">儲存</button>
        <button type="button" class="btn outline" data-close-modal>取消</button>
      </div>
    </form>
  `);
  $('#rename-dept-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api(`/api/departments/${dept.id}`, {
        method: 'PUT',
        body: { name: fd.get('name') },
      });
      closeModal();
      toast('部門名稱已更新', 'success');
      await refreshDeptLists();
      navigate('departments');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

/**
 * 從「已註冊成員名單」勾選後加入部門
 * 同一人可同時隸屬多個部門（可重複加入不同部門）
 */
function openAddUserToDeptModal(dept, allUsers) {
  const deptName = dept.name;
  const deptId = dept.id;
  const inDept = (u) => {
    const list = Array.isArray(u.departments) ? u.departments : [];
    return list.includes(deptName) || u.department === deptName;
  };
  // 可選：尚未在此部門的已註冊成員（即使已在其他部門也可選）
  const candidates = (allUsers || [])
    .filter((u) => u.active !== 0 && !inDept(u))
    .slice()
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hant'));

  if (!candidates.length) {
    toast('沒有可加入的已註冊成員（可能都已在此部門，或請先到「成員名單」新增帳號）', 'error');
    return;
  }

  openModal(`
    <h3>從成員名單加入「${esc(deptName)}」</h3>
    <p class="muted" style="margin-top:0">
      勾選<strong>已註冊成員</strong>加入此部門（不新建帳號）。<br/>
      <strong>同一人可同時隸屬多個部門</strong>；已在其他部門的人也可再加入這裡。
    </p>
    <form id="add-user-form" class="form-grid">
      <div class="field">
        <label>搜尋成員</label>
        <input type="search" id="member-search" placeholder="輸入姓名或帳號篩選…" autocomplete="off" />
      </div>
      <div class="field">
        <label>成員名單 *（可多選）</label>
        <div style="display:flex;gap:8px;margin:6px 0 8px">
          <button type="button" class="btn sm outline" id="sel-all-members">全選</button>
          <button type="button" class="btn sm outline" id="sel-none-members">取消全選</button>
        </div>
        <div class="approver-list" id="member-pick-list" style="max-height:300px;overflow:auto;border:1px solid var(--border);border-radius:10px;padding:10px">
          ${candidates
            .map((u) => {
              const depts = Array.isArray(u.departments) ? u.departments : [];
              const deptText =
                depts.length > 0
                  ? depts.join('、')
                  : u.department
                    ? u.department
                    : '尚未分部門';
              return `
            <label class="member-pick-row" data-search="${esc((u.name + ' ' + u.username).toLowerCase())}">
              <input type="checkbox" name="user_ids" value="${u.id}" />
              <span>
                <strong>${esc(u.name)}</strong>
                <span class="muted">（${esc(u.username)}）</span>
                <span class="muted"> · 目前隸屬：${esc(deptText)}</span>
              </span>
            </label>`;
            })
            .join('')}
        </div>
        <div class="muted" style="font-size:0.82rem;margin-top:6px">共 ${candidates.length} 位可選</div>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn primary">確認加入部門</button>
        <button type="button" class="btn outline" data-close-modal>取消</button>
      </div>
    </form>
  `);
  $('#modal-panel').classList.add('wide');

  const filterList = () => {
    const q = ($('#member-search')?.value || '').trim().toLowerCase();
    $$('#member-pick-list .member-pick-row').forEach((row) => {
      const hay = row.dataset.search || '';
      row.style.display = !q || hay.includes(q) ? '' : 'none';
    });
  };
  const search = $('#member-search');
  if (search) search.oninput = filterList;

  const selAll = $('#sel-all-members');
  const selNone = $('#sel-none-members');
  if (selAll) {
    selAll.onclick = () => {
      $$('#member-pick-list .member-pick-row').forEach((row) => {
        if (row.style.display === 'none') return;
        const cb = row.querySelector('input[type=checkbox]');
        if (cb) cb.checked = true;
      });
    };
  }
  if (selNone) {
    selNone.onclick = () => {
      $$('#member-pick-list input[name=user_ids]').forEach((cb) => {
        cb.checked = false;
      });
    };
  }

  $('#add-user-form').onsubmit = async (e) => {
    e.preventDefault();
    const ids = [...document.querySelectorAll('#member-pick-list input[name=user_ids]:checked')].map(
      (c) => Number(c.value)
    );
    if (!ids.length) {
      toast('請從成員名單至少勾選一位', 'error');
      return;
    }
    try {
      const result = await api(`/api/departments/${deptId}/members`, {
        method: 'POST',
        body: { user_ids: ids },
      });
      closeModal();
      toast(
        `已加入 ${result.added_count || ids.length} 人到「${deptName}」` +
          (result.skipped_count ? `（略過 ${result.skipped_count} 位已在部門內）` : ''),
        'success'
      );
      navigate('departments');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

async function renderDepartments(body) {
  if (!isAdmin()) {
    body.innerHTML = emptyState({
      title: '無權限',
      desc: '僅系統管理員可查看與管理部門。',
      actions: [{ label: '回總覽', go: 'dashboard', outline: true }],
    });
    bindDataGo(body);
    return;
  }
  const { departments } = await api('/api/departments/stats');
  const canManage = true;
  // 載入全部已註冊成員（供加入部門使用）
  let allUsers = [];
  if (canManage) {
    try {
      const data = await api('/api/users');
      allUsers = data.users || [];
      state.users = allUsers;
    } catch {
      allUsers = state.users || [];
    }
  }

  if (canManage) {
    $('#page-actions').innerHTML =
      `<button type="button" class="btn primary" id="btn-add-dept">＋ 新增部門</button>`;
    const addBtn = $('#btn-add-dept');
    if (addBtn) addBtn.onclick = () => openAddDeptModal();
  }

  if (!departments?.length) {
    body.innerHTML = emptyState({
      title: '尚無部門資料',
      desc: canManage
        ? '請先新增部門，再將成員加入各部門。'
        : '管理員尚未建立部門。',
      actions: canManage
        ? [{ label: '＋ 新增部門', id: 'btn-add-dept-empty', primary: true }]
        : [],
    });
    const addEmpty = $('#btn-add-dept-empty');
    if (addEmpty) addEmpty.onclick = () => openAddDeptModal();
    return;
  }

  body.innerHTML = `
    <div class="card">
      <h3 style="margin-top:0">部門與成員</h3>
      <p class="muted" style="margin-top:0">
        ${
          canManage
            ? '成員可<strong>同時隸屬多個部門</strong>。「從成員名單加入」可重複把同一人加到不同部門；「移出部門」只移出該部門，不刪帳號。'
            : '以下列出每個部門的成員。'
        }
      </p>
      ${departments
        .map((d) => {
          const members = Array.isArray(d.members) ? d.members : [];
          return `
        <div style="border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:14px;background:#fff">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
              <strong style="font-size:1.1rem">${esc(d.name)}</strong>
              <span class="tag approved">${members.length} 位成員</span>
            </div>
            ${
              canManage
                ? `<div style="display:flex;flex-wrap:wrap;gap:6px">
                    <button type="button" class="btn sm outline" data-rename-dept="${d.id}" data-dept-name="${esc(d.name)}">修改名稱</button>
                    <button type="button" class="btn sm primary" data-add-member-dept-id="${d.id}" data-add-member-dept-name="${esc(d.name)}">＋ 從成員名單加入</button>
                    <button type="button" class="btn sm danger" data-del-dept="${d.id}" data-dept-name="${esc(d.name)}" data-member-count="${members.length}">刪除部門</button>
                  </div>`
                : ''
            }
          </div>
          ${
            members.length
              ? `<div class="table-wrap">
                  <table class="data" style="width:100%;min-width:600px;table-layout:fixed">
                    <thead>
                      <tr>
                        <th style="width:120px;white-space:nowrap">姓名</th>
                        <th style="width:140px;white-space:nowrap">帳號</th>
                        <th style="width:120px;white-space:nowrap">角色</th>
                        <th style="min-width:160px">隸屬部門</th>
                        ${canManage ? '<th style="width:140px;text-align:center;white-space:nowrap">操作</th>' : ''}
                      </tr>
                    </thead>
                    <tbody>
                      ${members
                        .map((m) => {
                          const depts = Array.isArray(m.departments) ? m.departments : [];
                          const deptLabel =
                            depts.length > 0 ? depts.join('、') : m.department || '—';
                          return `
                        <tr>
                          <td><strong>${esc(m.name)}</strong></td>
                          <td><code>${esc(m.username)}</code></td>
                          <td>${
                            m.role === 'admin'
                              ? '<span class="tag draft">系統管理員</span>'
                              : '一般使用者'
                          }</td>
                          <td style="font-size:0.88rem">${esc(deptLabel)}</td>
                          ${
                            canManage
                              ? `<td>
                                  <button type="button" class="btn sm outline" data-remove-from-dept="${m.id}" data-user-name="${esc(m.name)}" data-dept-id="${d.id}" data-dept-name="${esc(d.name)}">移出此部門</button>
                                </td>`
                              : ''
                          }
                        </tr>`;
                        })
                        .join('')}
                    </tbody>
                  </table>
                </div>`
              : `<div class="empty" style="padding:8px 0">此部門尚無成員
                  ${canManage ? '，可點「從成員名單加入」' : ''}
                </div>`
          }
        </div>`;
        })
        .join('')}
    </div>`;

  if (!canManage) return;

  body.querySelectorAll('[data-rename-dept]').forEach((btn) => {
    btn.onclick = () => {
      openRenameDeptModal({
        id: Number(btn.dataset.renameDept),
        name: btn.dataset.deptName,
      });
    };
  });

  body.querySelectorAll('[data-add-member-dept-id]').forEach((btn) => {
    btn.onclick = async () => {
      let list = allUsers;
      try {
        const data = await api('/api/users');
        list = data.users || [];
        state.users = list;
      } catch {
        /* use cached */
      }
      openAddUserToDeptModal(
        {
          id: Number(btn.dataset.addMemberDeptId),
          name: btn.getAttribute('data-add-member-dept-name') || btn.dataset.addMemberDeptName,
        },
        list
      );
    };
  });

  body.querySelectorAll('[data-del-dept]').forEach((btn) => {
    btn.onclick = async () => {
      const id = Number(btn.dataset.delDept);
      const name = btn.dataset.deptName || '此部門';
      const count = Number(btn.dataset.memberCount || 0);
      if (count > 0) {
        toast(`「${name}」尚有 ${count} 位成員，請先將成員「移出此部門」`, 'error');
        return;
      }
      if (!confirm(`確定刪除部門「${name}」？`)) return;
      try {
        await api(`/api/departments/${id}`, { method: 'DELETE' });
        toast('部門已刪除', 'success');
        await refreshDeptLists();
        navigate('departments');
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  });

  // 僅移出「此」部門，其他部門隸屬與帳號保留
  body.querySelectorAll('[data-remove-from-dept]').forEach((btn) => {
    btn.onclick = async () => {
      const userId = Number(btn.dataset.removeFromDept);
      const name = btn.dataset.userName || '此成員';
      const deptId = Number(btn.dataset.deptId);
      const deptName = btn.dataset.deptName || '';
      if (
        !confirm(
          `確定將「${name}」移出「${deptName}」？\n帳號保留；若還隸屬其他部門，其他部門不受影響。`
        )
      ) {
        return;
      }
      try {
        await api(`/api/departments/${deptId}/members/${userId}`, { method: 'DELETE' });
        toast(`已將「${name}」移出「${deptName}」`, 'success');
        navigate('departments');
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  });
}

/**
 * 彈出手寫簽名視窗 (Signature Canvas Modal)
 */
function openSignaturePadModal(opts = {}) {
  const { title = '手寫電子簽名', initialImage = null, onSave } = opts;
  const html = `
    <div style="max-width:520px;width:100%;margin:0 auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <h3 style="margin:0">${esc(title)}</h3>
        <button type="button" class="btn ghost sm" onclick="closeModal()">✕</button>
      </div>
      <p class="muted" style="margin:0 0 12px;font-size:0.88rem">
        請在下方白板處以滑鼠或手指/觸控筆畫出您的簽名：
      </p>
      <div style="border:2px dashed #94a3b8;border-radius:12px;background:#fff;padding:6px;text-align:center;touch-action:none">
        <canvas id="sig-pad-canvas" width="460" height="200" style="width:100%;max-width:460px;height:200px;display:block;margin:0 auto;cursor:crosshair;background:#ffffff;border-radius:8px;border:1px solid #e2e8f0"></canvas>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:14px;gap:10px;flex-wrap:wrap">
        <div>
          <button type="button" class="btn outline sm" id="btn-sig-clear">🧹 清除重寫</button>
        </div>
        <div style="display:flex;gap:8px">
          <button type="button" class="btn ghost sm" onclick="closeModal()">取消</button>
          <button type="button" class="btn primary sm" id="btn-sig-save">💾 確定儲存</button>
        </div>
      </div>
    </div>
  `;
  openModal(html);

  const canvas = $('#sig-pad-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#0f172a';

  let isDrawing = false;
  let hasDrawn = false;
  let lastX = 0;
  let lastY = 0;

  if (initialImage) {
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      hasDrawn = true;
    };
    img.src = initialImage;
  }

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if (e.touches && e.touches[0]) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  function startDraw(e) {
    e.preventDefault();
    isDrawing = true;
    const p = getPos(e);
    lastX = p.x;
    lastY = p.y;
  }

  function drawMove(e) {
    if (!isDrawing) return;
    e.preventDefault();
    const p = getPos(e);
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lastX = p.x;
    lastY = p.y;
    hasDrawn = true;
  }

  function stopDraw(e) {
    if (isDrawing) {
      isDrawing = false;
    }
  }

  canvas.addEventListener('mousedown', startDraw);
  canvas.addEventListener('mousemove', drawMove);
  canvas.addEventListener('mouseup', stopDraw);
  canvas.addEventListener('mouseleave', stopDraw);

  canvas.addEventListener('touchstart', startDraw, { passive: false });
  canvas.addEventListener('touchmove', drawMove, { passive: false });
  canvas.addEventListener('touchend', stopDraw);

  $('#btn-sig-clear').onclick = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasDrawn = false;
  };

  $('#btn-sig-save').onclick = () => {
    if (!hasDrawn && !initialImage) {
      toast('請先在白板上手寫簽名', 'error');
      return;
    }
    const dataUrl = canvas.toDataURL('image/png');
    closeModal();
    if (typeof onSave === 'function') onSave(dataUrl);
  };
}

async function renderSettings(body) {
  const u = state.user || {};
  const depts =
    Array.isArray(u.departments) && u.departments.length
      ? u.departments.join('、')
      : u.department || '—';

  let mailCfg = null;
  try {
    mailCfg = await api('/api/mail/config');
  } catch {
    mailCfg = { enabled: false, ready: false };
  }

  await loadUsers();
  const allUsers = (state.users || []).filter((x) => x.active !== 0 && x.id !== u.id);

  let delegationInfo = { activeDelegation: null, delegation: null, grantors: [] };
  try {
    delegationInfo = await api('/api/delegations/my');
  } catch {
    /* ignore */
  }

  let userSig = u.signature_image || null;
  try {
    const sigRes = await api('/api/users/me/signature');
    userSig = sigRes.signature_image || userSig;
  } catch {
    /* ignore */
  }

  const activeDel = delegationInfo.activeDelegation;
  const rawDel = delegationInfo.delegation;
  const grantors = delegationInfo.grantors || [];

  const grantorText = grantors.length
    ? grantors.map((g) => `<strong>${esc(g.grantor_name)}</strong>`).join('、')
    : '';

  body.innerHTML = `
    <div class="card" style="max-width:560px">
      <h3>我的資料</h3>
      <p class="muted" style="margin-top:0">每位成員皆可自行修改姓名、Email、分機與電話。帳號與部門由管理員管理。</p>
      <form id="profile-form" class="form-grid">
        <div class="field">
          <label>帳號</label>
          <input type="text" value="${esc(u.username || '')}" disabled />
        </div>
        <div class="field">
          <label>部門</label>
          <input type="text" value="${esc(depts)}" disabled />
        </div>
        <div class="field">
          <label>角色</label>
          <input type="text" value="${u.role === 'admin' ? '系統管理員' : '使用者'}" disabled />
        </div>
        <div class="field">
          <label>姓名 *</label>
          <input name="name" required maxlength="80" value="${esc(u.name || '')}" placeholder="顯示名稱" />
        </div>
        <div class="field">
          <label>Email</label>
          <input name="email" type="email" maxlength="120" value="${esc(u.email || '')}" placeholder="選填，例：name@company.com" />
          <div class="muted" style="font-size:0.82rem;margin-top:4px">用於接收簽核結果與待簽核提醒</div>
        </div>
        <div class="field">
          <label>到職日</label>
          <input type="text" value="${esc(u.hire_date || u.labor?.hireDate || '未設定')}" disabled />
          <div class="muted" style="font-size:0.82rem;margin-top:4px">
            ${
              u.labor?.specialLeave
                ? `特休可休 ${u.labor.specialLeave.entitled ?? 0} 日（手動）· 剩餘 ${u.labor.specialLeave.remaining ?? '—'} 日${
                    u.labor?.seniority?.label ? `；年資 ${esc(u.labor.seniority.label)}（僅顯示）` : ''
                  }`
                : '特休可休由管理員於「成員名單」手動設定（不依年資）'
            }
          </div>
        </div>
        <div class="field">
          <label>分機</label>
          <input name="extension" maxlength="20" value="${esc(u.extension || '')}" placeholder="選填，例：123" />
        </div>
        <div class="field">
          <label>電話</label>
          <input name="phone" maxlength="40" value="${esc(u.phone || '')}" placeholder="選填，例：0912-345-678" />
        </div>
        <div class="field" style="border:1px solid var(--border);border-radius:10px;padding:12px;background:#f8fafc">
          <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;margin:0">
            <input type="checkbox" name="email_notify" id="email-notify-pref" value="1"
              ${u.email_notify !== 0 ? 'checked' : ''} style="margin-top:3px" />
            <span>
              <strong>預設以 Email 通知我的申請進度</strong>
              <div class="muted" style="font-size:0.85rem;margin-top:4px">送出申請時可再單次調整；需先填寫上方 Email。</div>
            </span>
          </label>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn primary">儲存資料</button>
        </div>
      </form>
    </div>

    <!-- 客製化佈景主題 -->
    <div class="card" style="max-width:560px">
      <h3>🎨 客製化佈景主題</h3>
      <p class="muted" style="margin-top:0">點選下方主題即可即時預覽畫面效果，儲存後於此裝置自動持久化套用。</p>
      
      <div id="theme-selector-grid" class="theme-grid">
        ${THEMES.map((t) => {
          const isSelected = t.id === (localStorage.getItem('approval_user_theme') || 'navy');
          const activeStyle = isSelected
            ? `background: linear-gradient(135deg, ${t.vars['--primary']} 0%, ${t.vars['--primary-hover']} 100%) !important; color: #ffffff !important; border-color: ${t.vars['--primary-hover']} !important; box-shadow: 0 4px 14px ${t.vars['--primary']}55 !important;`
            : '';
          return `
          <button type="button" class="btn ${isSelected ? 'primary active' : ''} theme-card" data-theme-id="${t.id}" style="${activeStyle}">
            <span class="theme-color-dot" style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${isSelected ? '#ffffff' : t.vars['--primary']};box-shadow:0 0 0 1.5px rgba(255,255,255,0.6);"></span>
            <span>${t.name}</span>
          </button>
        `;
        }).join('')}
      </div>

      <div class="form-actions" style="margin-top:14px">
        <button type="button" class="btn primary" id="btn-save-theme">🎨 儲存並套用主題</button>
        <button type="button" class="btn outline" id="btn-reset-theme">還原預設藍調</button>
      </div>
    </div>

    <!-- 簽核代理人設定 -->
    <div class="card" style="max-width:560px">
      <h3>🔄 簽核代理人機制</h3>
      <p class="muted" style="margin-top:0">
        出差或休假時，可設定代理同仁。代理期間到達後，原屬於您的待簽核單據將會自動出現在代理人的「待我簽核」清單中，並記錄代理簽核日誌。
      </p>
      ${
        grantorText
          ? `<div class="card" style="background:#eff6ff;border-color:#93c5fd;margin-bottom:14px;padding:12px">
              <strong style="color:#1d4ed8">⚡ 代理授權通知</strong>
              <div style="font-size:0.88rem;color:#1e40af;margin-top:4px">
                下列同仁目前已將您設為簽核代理人：${grantorText}。<br/>
                當對方有待簽核單據時，您可進入該單進行代理簽核。
              </div>
            </div>`
          : ''
      }
      <form id="delegation-form" class="form-grid">
        <div class="field">
          <label>指定代理同仁 *</label>
          <select name="delegate_user_id" required>
            <option value="">請選擇代理同仁…</option>
            ${allUsers
              .map(
                (usr) =>
                  `<option value="${usr.id}" ${
                    rawDel && rawDel.delegate_user_id === usr.id ? 'selected' : ''
                  }>${esc(usr.name)}（${esc(usr.department || '未設部門')}）</option>`
              )
              .join('')}
          </select>
        </div>
        <div class="field">
          <label>代理開始時間（選填，留白即刻生效）</label>
          <input type="datetime-local" name="start_time" value="${esc(
            rawDel?.start_time ? String(rawDel.start_time).replace(' ', 'T') : ''
          )}" />
        </div>
        <div class="field">
          <label>代理結束時間（選填，留白永久生效）</label>
          <input type="datetime-local" name="end_time" value="${esc(
            rawDel?.end_time ? String(rawDel.end_time).replace(' ', 'T') : ''
          )}" />
        </div>
        <div class="field" style="border:1px solid var(--border);border-radius:10px;padding:12px;background:#f8fafc">
          <label style="display:flex;align-items:center;gap:10px;cursor:pointer;margin:0">
            <input type="checkbox" name="active" value="1" ${
              !rawDel || rawDel.active ? 'checked' : ''
            } />
            <span>
              <strong>啟用代理簽核功能</strong>
              <div class="muted" style="font-size:0.85rem;margin-top:2px">取消勾選可暫停代理授權</div>
            </span>
          </label>
        </div>
        <div class="form-actions" style="display:flex;gap:10px">
          <button type="submit" class="btn primary">儲存代理設定</button>
          ${
            rawDel && rawDel.active
              ? `<button type="button" class="btn danger outline" id="btn-cancel-delegation">取消代理設定</button>`
              : ''
          }
        </div>
      </form>
    </div>

    <!-- 個人電子簽名檔 -->
    <div class="card" style="max-width:560px">
      <h3>✍️ 個人電子簽名檔</h3>
      <p class="muted" style="margin-top:0">
        您可以先預設個人手寫電子簽名，簽核時系統將自動套用至簽核單與 exported PDF 檔案中；亦可選擇現場手寫。
      </p>
      <div style="border:1px dashed #cbd5e1;border-radius:10px;padding:16px;background:#f8fafc;text-align:center;margin-bottom:14px">
        <div id="sig-preview-box">
          ${
            userSig
              ? `<img src="${userSig}" style="max-height:90px;max-width:100%;object-fit:contain;background:#fff;padding:4px;border:1px solid #e2e8f0;border-radius:6px" alt="個人電子簽名" />`
              : `<div class="muted" style="padding:20px 0">尚未設定個人電子簽名檔</div>`
          }
        </div>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button type="button" class="btn primary sm" id="btn-draw-signature">✍️ 白板手寫簽名</button>
        <button type="button" class="btn outline sm" id="btn-upload-sig-file">📁 上傳簽名圖檔</button>
        <input type="file" id="sig-file-input" accept="image/*" class="hidden" />
        ${
          userSig
            ? `<button type="button" class="btn danger outline sm" id="btn-clear-signature">🗑️ 清除預設簽名</button>`
            : ''
        }
      </div>
    </div>
    <div class="card" style="max-width:560px">
      <h3>變更密碼</h3>
      <form id="pw-form" class="form-grid">
        <div class="field"><label>目前密碼</label><input type="password" name="currentPassword" required autocomplete="current-password" /></div>
        <div class="field"><label>新密碼（至少 6 字元）</label><input type="password" name="newPassword" required minlength="6" autocomplete="new-password" /></div>
        <div class="form-actions">
          <button type="submit" class="btn primary">更新密碼</button>
        </div>
      </form>
    </div>
    <div class="card" style="max-width:560px">
      <h3>Email 提醒</h3>
      <p class="muted" style="margin:0">系統 Email 功能目前：
        <strong>${mailCfg.enabled ? '已啟用' : '未啟用'}</strong>
        ${mailCfg.enabled && !mailCfg.ready ? '（管理員尚未完成 SMTP）' : ''}
      </p>
      <p class="muted" style="margin:8px 0 0;font-size:0.9rem;line-height:1.5">
        請在上方填寫 Email 並勾選通知偏好。申請送出後，可在簽核詳情點「Email 催辦簽核人」。
        ${
          isBuiltinAdmin()
            ? 'SMTP 與公司品牌請至<strong>系統設定</strong>管理（僅內建 Admin）。'
            : ''
        }
      </p>
    </div>
    <div class="card" style="max-width:560px">
      <h3>桌面通知設定</h3>
      <p class="muted" style="margin-top:0;line-height:1.5">
        登入後系統會定期檢查「待我簽核」。有新件時可透過瀏覽器桌面通知提醒（本機偏好，不跟著帳號同步）。
      </p>
      ${(() => {
        const dn = getDesktopNotifyPrefs();
        const perm = desktopNotifyPermissionLabel();
        const supported = 'Notification' in window;
        return `
      <div style="border:1px solid var(--border);border-radius:10px;padding:12px;background:#f8fafc;margin-bottom:12px">
        <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px">
          <span>瀏覽器權限：</span>
          <span class="tag ${esc(perm.cls)}">${esc(perm.text)}</span>
          ${
            supported
              ? `<button type="button" class="btn outline sm" id="btn-dn-permission">允許桌面通知</button>
                 <button type="button" class="btn outline sm" id="btn-dn-test">發送測試通知</button>`
              : ''
          }
        </div>
      </div>
      <form id="desktop-notify-form" class="form-grid">
        <div class="field dn-check-field">
          <label>
            <input type="checkbox" id="dn-enabled" ${dn.enabled ? 'checked' : ''} />
            <span>
              <strong>啟用桌面通知</strong>
              <div class="muted" style="font-size:0.85rem;margin-top:4px">待簽核件數增加時推送系統通知</div>
            </span>
          </label>
        </div>
        <div class="field dn-check-field">
          <label>
            <input type="checkbox" id="dn-foreground" ${dn.foreground ? 'checked' : ''} />
            <span>
              <strong>分頁在前景也顯示通知</strong>
              <div class="muted" style="font-size:0.85rem;margin-top:4px">關閉後僅在瀏覽器縮到背景／其他分頁時推送</div>
            </span>
          </label>
        </div>
        <div class="field dn-check-field">
          <label>
            <input type="checkbox" id="dn-title-flash" ${dn.titleFlash ? 'checked' : ''} />
            <span>
              <strong>背景時閃爍分頁標題</strong>
              <div class="muted" style="font-size:0.85rem;margin-top:4px">標題交替顯示「【待簽核】…」提醒</div>
            </span>
          </label>
        </div>
        <div class="field">
          <label>檢查間隔（秒）</label>
          <input type="number" id="dn-poll-sec" min="10" max="120" step="5" value="${esc(String(dn.pollSec))}" />
          <div class="muted" style="font-size:0.82rem;margin-top:4px">建議 15～30 秒；過短會增加伺服器負擔</div>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn primary">儲存桌面通知設定</button>
        </div>
      </form>
      <p class="muted" style="font-size:0.82rem;margin:12px 0 0;line-height:1.5">
        • 需使用 <strong>Chrome / Edge</strong>。完整步驟見文件 <strong>docs/桌面通知使用說明.md</strong>。<br/>
        • 顯示<strong>已封鎖</strong>：網址列左側圖示 → 通知 → 允許；或 Edge 開啟
          <code style="font-size:0.78rem">edge://settings/content/notifications</code> 把本站改允許後重新整理。<br/>
        • 網站為 <strong>http://</strong>（非 HTTPS）時，瀏覽器可能強制封鎖。暫用：
          <code style="font-size:0.78rem">edge://flags</code> 搜尋
          <em>Insecure origins treated as secure</em>，填入本站完整網址 → Enabled → 重啟瀏覽器後再按「允許」。長期建議改 HTTPS。<br/>
        • 仍無通知：Windows 設定 → 系統 → 通知 → Microsoft Edge 須開啟，並關閉勿擾模式後測試。
      </p>`;
      })()}
    </div>`;

  let selectedThemeId = localStorage.getItem('approval_user_theme') || 'navy';

  // 點擊主題卡片即時切換與預覽（動態套用該主題專屬底色與白字）
  document.querySelectorAll('.theme-card').forEach((card) => {
    card.addEventListener('click', () => {
      selectedThemeId = card.dataset.themeId;
      document.querySelectorAll('.theme-card').forEach((c) => {
        c.classList.remove('active', 'primary');
        c.removeAttribute('style');
        const themeId = c.dataset.themeId;
        const themeObj = THEMES.find((t) => t.id === themeId);
        const dot = c.querySelector('.theme-color-dot');
        if (dot && themeObj) dot.style.background = themeObj.vars['--primary'];
      });

      card.classList.add('active', 'primary');
      const curThemeObj = THEMES.find((t) => t.id === selectedThemeId) || THEMES[0];
      card.style.cssText = `background: linear-gradient(135deg, ${curThemeObj.vars['--primary']} 0%, ${curThemeObj.vars['--primary-hover']} 100%) !important; color: #ffffff !important; border-color: ${curThemeObj.vars['--primary-hover']} !important; box-shadow: 0 4px 14px ${curThemeObj.vars['--primary']}55 !important;`;
      const activeDot = card.querySelector('.theme-color-dot');
      if (activeDot) activeDot.style.background = '#ffffff';

      applyUserTheme(selectedThemeId, false);
    });
  });

  // 儲存主題
  $('#btn-save-theme')?.addEventListener('click', () => {
    applyUserTheme(selectedThemeId, true);
    const themeObj = THEMES.find((t) => t.id === selectedThemeId) || THEMES[0];
    toast(`已成功套用「${themeObj.name}」客製化主題！`, 'success');
  });

  // 還原預設主題
  $('#btn-reset-theme')?.addEventListener('click', () => {
    selectedThemeId = 'navy';
    applyUserTheme('navy', true);
    document.querySelectorAll('.theme-card').forEach((c) => {
      c.classList.toggle('active', c.dataset.themeId === 'navy');
    });
    toast('已還原為預設經典藍調主題！', 'success');
  });

  $('#profile-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const data = await api('/api/auth/profile', {
        method: 'PUT',
        body: {
          name: fd.get('name'),
          email: fd.get('email') || '',
          extension: fd.get('extension') || '',
          phone: fd.get('phone') || '',
          email_notify: e.target.querySelector('#email-notify-pref')?.checked ? 1 : 0,
        },
      });
      if (data.user) {
        state.user = { ...state.user, ...data.user };
        $('#user-name').textContent = data.user.name;
        $('#user-avatar').textContent = (data.user.name || 'U').slice(0, 1);
      }
      toast('個人資料已更新', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  // 簽核代理人表單
  $('#delegation-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const delegateId = Number(fd.get('delegate_user_id'));
    if (!delegateId) {
      toast('請選擇代理同仁', 'error');
      return;
    }
    const startTime = fd.get('start_time') ? String(fd.get('start_time')).replace('T', ' ') : null;
    const endTime = fd.get('end_time') ? String(fd.get('end_time')).replace('T', ' ') : null;
    const active = !!e.target.querySelector('input[name=active]')?.checked;

    try {
      const res = await api('/api/delegations/my', {
        method: 'POST',
        body: { delegate_user_id: delegateId, start_time: startTime, end_time: endTime, active },
      });
      toast(res.message || '代理設定已儲存', 'success');
      navigate('settings');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  $('#btn-cancel-delegation')?.addEventListener('click', async () => {
    if (!confirm('確定取消簽核代理設定？')) return;
    try {
      const res = await api('/api/delegations/my', { method: 'DELETE' });
      toast(res.message || '已取消簽核代理設定', 'success');
      navigate('settings');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // 電子簽名檔
  $('#btn-draw-signature')?.addEventListener('click', () => {
    openSignaturePadModal({
      title: '手寫個人電子簽名檔',
      initialImage: userSig,
      onSave: async (dataUrl) => {
        try {
          const res = await api('/api/users/me/signature', {
            method: 'POST',
            body: { signature_image: dataUrl },
          });
          state.user = { ...state.user, signature_image: dataUrl };
          toast(res.message || '手寫電子簽名已儲存', 'success');
          navigate('settings');
        } catch (err) {
          toast(err.message, 'error');
        }
      },
    });
  });

  $('#btn-upload-sig-file')?.addEventListener('click', () => {
    $('#sig-file-input')?.click();
  });

  $('#sig-file-input')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast('請上傳圖檔（PNG / JPG）', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = async (evt) => {
      const dataUrl = evt.target.result;
      try {
        const res = await api('/api/users/me/signature', {
          method: 'POST',
          body: { signature_image: dataUrl },
        });
        state.user = { ...state.user, signature_image: dataUrl };
        toast(res.message || '簽名圖檔上傳成功', 'success');
        navigate('settings');
      } catch (err) {
        toast(err.message, 'error');
      }
    };
    reader.readAsDataURL(file);
  });

  $('#btn-clear-signature')?.addEventListener('click', async () => {
    if (!confirm('確定清除預設電子簽名檔？')) return;
    try {
      const res = await api('/api/users/me/signature', { method: 'DELETE' });
      state.user = { ...state.user, signature_image: null };
      toast(res.message || '簽名檔已清除', 'success');
      navigate('settings');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // 桌面通知設定
  $('#desktop-notify-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const prefs = saveDesktopNotifyPrefs({
      enabled: !!$('#dn-enabled')?.checked,
      foreground: !!$('#dn-foreground')?.checked,
      titleFlash: !!$('#dn-title-flash')?.checked,
      pollSec: Number($('#dn-poll-sec')?.value) || 20,
    });
    // 立即套用輪詢間隔
    if (state.token) {
      startPendingWatcher({ requestPermission: false });
    }
    toast(
      prefs.enabled
        ? `桌面通知已儲存（每 ${prefs.pollSec} 秒檢查）`
        : '已關閉桌面通知（仍顯示角標與站內提示）',
      'success'
    );
    navigate('settings');
  });
  $('#btn-dn-permission')?.addEventListener('click', async () => {
    const ok = await ensureNotifyPermission(true);
    if (ok) {
      saveDesktopNotifyPrefs({ enabled: true });
      toast('已允許桌面通知', 'success');
    } else if (!('Notification' in window)) {
      toast('此瀏覽器不支援桌面通知', 'error');
    } else if (Notification.permission === 'denied') {
      toast('通知已被封鎖，請至瀏覽器網站設定改為「允許」', 'error');
    } else {
      toast('未取得通知權限', 'error');
    }
    navigate('settings');
  });
  $('#btn-dn-test')?.addEventListener('click', async () => {
    const ok = await ensureNotifyPermission(true);
    if (!ok) {
      toast('請先允許桌面通知權限', 'error');
      return;
    }
    const prefs = getDesktopNotifyPrefs();
    if (!prefs.enabled) {
      toast('請先勾選「啟用桌面通知」並儲存', 'error');
      return;
    }
    showDesktopNotification(
      '線上簽核系統 · 測試',
      '這是一則測試桌面通知。點擊可回到待簽核列表。',
      () => navigate('inbox')
    );
    toast('已發送測試通知（若沒看到請檢查系統勿擾模式）', 'success');
  });

  $('#pw-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/api/auth/password', {
        method: 'PUT',
        body: {
          currentPassword: fd.get('currentPassword'),
          newPassword: fd.get('newPassword'),
        },
      });
      e.target.reset();
      toast('密碼已更新', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

/** LINE 設定表單 HTML（側欄頁與系統設定共用） */
function lineSettingsFormHtml(cfg = {}, opts = {}) {
  const showAccess = opts.showAccess !== false && isBuiltinAdmin();
  const ev = cfg.events || {};
  const access = cfg.configAccess || 'builtin_admin';
  const statusText = cfg.ready
    ? '已就緒（啟用且已設定服務網址與 API 金鑰）'
    : cfg.enabled
      ? '已啟用但尚未就緒（請檢查服務網址／API 金鑰）'
      : '未啟用';
  return `
    <p class="muted" style="margin-top:0;line-height:1.55">
      透過獨立服務 <code>line-notify</code>（預設埠 3850）推播 Messaging API。
      Channel Token 只放在 LINE 專案 <code>.env</code>；此處只填<strong>服務網址</strong>與<strong>內部 API 金鑰</strong>。
      成員需先對官方帳號傳送：<code>綁定 簽核帳號</code>。
    </p>
    <p style="margin:0 0 12px">
      狀態：
      <strong style="color:${cfg.ready ? '#15803d' : '#b45309'}">${esc(statusText)}</strong>
      ${cfg.updatedAt ? `<span class="muted" style="margin-left:8px;font-size:0.85rem">更新：${esc(String(cfg.updatedAt).replace('T', ' ').replace(/\.\d+Z$/, ''))}</span>` : ''}
    </p>
    <form id="${esc(opts.formId || 'line-form')}" class="form-grid">
      <div class="field check-row-box">
        <label class="check-row">
          <input type="checkbox" name="enabled" id="${esc((opts.formId || 'line-form') + '-enabled')}" ${cfg.enabled ? 'checked' : ''} />
          <span><strong>啟用 LINE 推播通知</strong></span>
        </label>
      </div>
      <div class="field">
        <label>LINE 服務網址</label>
        <input name="serviceUrl" value="${esc(cfg.serviceUrl || 'http://192.168.99.220:3850')}"
          placeholder="http://192.168.99.220:3850" autocomplete="off" />
        <span class="field-hint" style="color:#6b7280;font-size:0.82rem">正式 NAS 建議：http://192.168.99.220:3850（容器內可用 http://line-notify:3850）</span>
      </div>
      <div class="field">
        <label>內部 API 金鑰（= line-notify 的 INTERNAL_API_KEY）</label>
        <input name="apiKey" type="password" value="" autocomplete="new-password"
          placeholder="${cfg.hasApiKey ? '已設定（留空則不變更）' : '尚未設定'}" />
      </div>
      ${
        showAccess
          ? `<div class="field">
        <label>誰可以設定 LINE</label>
        <select name="configAccess">
          <option value="builtin_admin" ${access === 'builtin_admin' ? 'selected' : ''}>僅內建 Admin</option>
          <option value="any_admin" ${access === 'any_admin' ? 'selected' : ''}>所有系統管理員</option>
          <option value="permission" ${access === 'permission' ? 'selected' : ''}>具備「LINE 通知設定」權限者</option>
        </select>
        <span class="field-hint" style="color:#6b7280;font-size:0.82rem">僅內建 Admin 可變更此項</span>
      </div>`
          : ''
      }
      <div class="field">
        <strong class="check-group-title" style="display:block;margin-bottom:8px">通知事件</strong>
        <div class="check-group-box" style="background:#f8fafc">
          <label class="check-row"><input type="checkbox" name="ev_pending" ${ev.pending !== false ? 'checked' : ''} /><span>待簽核（通知簽核人）</span></label>
          <label class="check-row"><input type="checkbox" name="ev_submitted" ${ev.submitted !== false ? 'checked' : ''} /><span>申請已送出（通知申請人）</span></label>
          <label class="check-row"><input type="checkbox" name="ev_approved" ${ev.approved !== false ? 'checked' : ''} /><span>已核准</span></label>
          <label class="check-row"><input type="checkbox" name="ev_rejected" ${ev.rejected !== false ? 'checked' : ''} /><span>已駁回</span></label>
          <label class="check-row"><input type="checkbox" name="ev_step" ${ev.step !== false ? 'checked' : ''} /><span>關卡進度更新</span></label>
          <label class="check-row"><input type="checkbox" name="ev_remind" ${ev.remind !== false ? 'checked' : ''} /><span>催辦</span></label>
        </div>
      </div>
      <div class="form-actions" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <button type="submit" class="btn primary">儲存 LINE 設定</button>
        <button type="button" class="btn outline" id="${esc((opts.formId || 'line-form') + '-health')}">檢查服務</button>
        <button type="button" class="btn outline" id="${esc((opts.formId || 'line-form') + '-test')}">測試推播給自己</button>
      </div>
    </form>
    <div id="${esc((opts.formId || 'line-form') + '-bindings')}" class="muted" style="margin-top:14px;font-size:0.88rem;line-height:1.5"></div>
  `;
}

function bindLineSettingsForm(opts = {}) {
  const formId = opts.formId || 'line-form';
  const form = document.getElementById(formId);
  if (!form) return;

  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = {
      enabled: !!e.target.querySelector(`#${formId}-enabled`)?.checked,
      serviceUrl: String(fd.get('serviceUrl') || '').trim(),
      apiKey: String(fd.get('apiKey') || ''),
      events: {
        pending: !!e.target.querySelector('[name="ev_pending"]')?.checked,
        submitted: !!e.target.querySelector('[name="ev_submitted"]')?.checked,
        approved: !!e.target.querySelector('[name="ev_approved"]')?.checked,
        rejected: !!e.target.querySelector('[name="ev_rejected"]')?.checked,
        step: !!e.target.querySelector('[name="ev_step"]')?.checked,
        remind: !!e.target.querySelector('[name="ev_remind"]')?.checked,
      },
    };
    if (isBuiltinAdmin() && fd.get('configAccess')) {
      body.configAccess = String(fd.get('configAccess'));
    }
    try {
      const data = await api('/api/line/config', { method: 'PUT', body });
      const cfg = data.config || data;
      state.lineCanConfigure = true;
      state.lineConfigAccess = cfg.configAccess || state.lineConfigAccess;
      state.lineReady = !!cfg.ready;
      state.lineEnabled = !!cfg.enabled;
      applyRoleUi();
      toast('LINE 設定已儲存', 'success');
      if (typeof opts.onSaved === 'function') opts.onSaved(cfg);
    } catch (err) {
      toast(err.message || '儲存失敗', 'error');
    }
  };

  document.getElementById(`${formId}-health`)?.addEventListener('click', async () => {
    try {
      const h = await api('/api/line/health');
      if (h.ok) {
        toast(
          `服務正常${h.data?.version ? ' v' + h.data.version : ''}${
            h.data?.lineConfigured === false ? '（Channel 尚未設定）' : ''
          }`,
          'success'
        );
      } else {
        toast(h.error || `服務異常 HTTP ${h.status || ''}`, 'error');
      }
    } catch (err) {
      toast(err.message || '無法連線 LINE 服務', 'error');
    }
  });

  document.getElementById(`${formId}-test`)?.addEventListener('click', async () => {
    try {
      await api('/api/line/test', {
        method: 'POST',
        body: { username: state.user?.username || '' },
      });
      toast('已送出測試推播（請確認 LINE 已綁定簽核帳號）', 'success');
    } catch (err) {
      toast(err.message || '測試推播失敗', 'error');
    }
  });

  // 綁定列表（選用）
  const box = document.getElementById(`${formId}-bindings`);
  if (box) {
    api('/api/line/bindings')
      .then((data) => {
        const list = data.bindings || [];
        if (!list.length) {
          box.innerHTML =
            '尚無綁定紀錄。請成員對 LINE 官方帳號傳送：<code>綁定 您的簽核帳號</code>';
          return;
        }
        const rows = list
          .slice(0, 30)
          .map(
            (b) =>
              `<tr><td>${esc(b.username || '—')}</td><td style="font-family:monospace;font-size:0.8rem">${esc(
                String(b.lineUserId || b.userId || '').slice(0, 24)
              )}</td></tr>`
          )
          .join('');
        box.innerHTML = `
          <strong>已綁定帳號（前 ${Math.min(list.length, 30)} 筆）</strong>
          <table class="data" style="margin-top:8px;font-size:0.85rem;width:100%">
            <thead><tr><th>簽核帳號</th><th>LINE userId</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>`;
      })
      .catch(() => {
        box.innerHTML = '無法載入綁定列表（服務未就緒或 API 金鑰不符）';
      });
  }
}

/** 側欄「LINE 通知」完整設定頁 */
async function renderLineSettings(body) {
  if (!canConfigureLine()) {
    body.innerHTML = `<div class="error-msg">您沒有 LINE 通知設定權限</div>`;
    return;
  }
  let cfg = {
    enabled: false,
    ready: false,
    serviceUrl: 'http://192.168.99.220:3850',
    hasApiKey: false,
    configAccess: 'builtin_admin',
    events: {},
  };
  try {
    const data = await api('/api/line/config');
    if (!data.canConfigure) {
      body.innerHTML = `<div class="error-msg">您沒有 LINE 通知設定權限</div>`;
      return;
    }
    cfg = { ...cfg, ...data };
    state.lineCanConfigure = true;
    state.lineConfigAccess = cfg.configAccess;
    state.lineReady = !!cfg.ready;
    state.lineEnabled = !!cfg.enabled;
  } catch (e) {
    body.innerHTML = `<div class="error-msg">${esc(e.message || '無法載入 LINE 設定')}</div>`;
    return;
  }

  body.innerHTML = `
    <div class="system-settings-page">
      <div class="card">
        <h3>💬 LINE 通知設定</h3>
        ${lineSettingsFormHtml(cfg, { formId: 'line-form', showAccess: true })}
      </div>
      <div class="card">
        <h3>使用說明</h3>
        <ol style="margin:0;padding-left:1.2rem;line-height:1.7;color:#334155">
          <li>確認 LINE 服務在 NAS 執行：<code>http://192.168.99.220:3850/health</code></li>
          <li>API 金鑰須與 <code>D:\\Line 專案</code>（或 NAS line-notify）的 <code>INTERNAL_API_KEY</code> 相同</li>
          <li>Webhook 需公網 HTTPS 才能綁定（Messaging API）</li>
          <li>成員私訊官方帳號：<code>綁定 帳號</code> 後才收得到推播</li>
        </ol>
      </div>
    </div>`;

  bindLineSettingsForm({
    formId: 'line-form',
    onSaved: () => navigate('line-settings'),
  });
}

/** 系統設定（僅內建 Admin 帳號） */
async function renderSystemSettings(body) {
  if (!isBuiltinAdmin()) {
    body.innerHTML = `<div class="error-msg">僅系統內建 Admin 帳號可進入系統設定（其他最高權限使用者亦無法存取）</div>`;
    return;
  }

  let brand = state.systemSettings || {};
  let pdfSign = {
    enabled: false,
    hasCert: false,
    hasPass: false,
    onlyApproved: true,
    ready: false,
    reason: '線上簽核系統正式產出文件',
    location: 'Taiwan',
    contactInfo: '',
    signerName: '',
    libsReady: true,
  };
  let backupEncrypt = {
    enabled: false,
    hasPass: false,
    ready: false,
  };
  let backupDir = '';
  let announcement = {
    enabled: false,
    active: false,
    title: '',
    body: '',
    hasFile: false,
    originalName: null,
    startAt: null,
    endAt: null,
    withinPeriod: true,
    scheduleStatus: 'open',
    updatedAt: null,
  };
  try {
    const adminCfg = await api('/api/system/settings/admin');
    brand = adminCfg;
    state.systemSettings = adminCfg;
    pdfSign = { ...pdfSign, ...(adminCfg.pdfSign || {}) };
    backupEncrypt = { ...backupEncrypt, ...(adminCfg.backupEncrypt || {}) };
    backupDir = adminCfg.backupDir || '';
    announcement = { ...announcement, ...(adminCfg.announcement || {}) };
  } catch {
    try {
      brand = await api('/api/system/settings');
      state.systemSettings = brand;
    } catch {
      /* keep cache */
    }
  }

  let mailCfg = {};
  try {
    mailCfg = await api('/api/mail/config');
  } catch {
    mailCfg = { enabled: false, ready: false };
  }

  let lineCfg = {
    enabled: false,
    ready: false,
    serviceUrl: 'http://192.168.99.220:3850',
    hasApiKey: false,
    configAccess: 'any_admin',
    events: {},
    canConfigure: true,
  };
  try {
    const lc = await api('/api/line/config');
    lineCfg = { ...lineCfg, ...lc };
    state.lineCanConfigure = !!lc.canConfigure;
    state.lineConfigAccess = lc.configAccess || state.lineConfigAccess;
    state.lineReady = !!lc.ready;
    state.lineEnabled = !!lc.enabled;
  } catch {
    /* keep defaults */
  }

  const logoUrl = brand.logoUrl || '/img/argo-logo.png';
  const signStatusText = pdfSign.ready
    ? '已就緒（下載／備份 PDF 將加蓋公司數位簽章）'
    : !pdfSign.libsReady
      ? `套件未就緒${pdfSign.libsError ? '：' + pdfSign.libsError : ''}`
      : !pdfSign.hasCert
        ? '尚未上傳憑證'
        : !pdfSign.enabled
          ? '已上傳憑證，尚未啟用'
          : '尚未就緒';
  const backupEncryptStatusText = backupEncrypt.ready
    ? '已就緒（備份將以 AES-256 加密 ZIP 儲存）'
    : backupEncrypt.enabled && !backupEncrypt.hasPass
      ? '已啟用但尚未設定密碼（無法執行備份）'
      : !backupEncrypt.enabled
        ? '未啟用（備份為一般 PDF／ZIP）'
        : '尚未就緒';
  const verLabel = brand.versionLabel || (brand.version ? `v${brand.version}` : '—');
  const verFull =
    brand.versionLabelFull ||
    (brand.fullVersion ? `v${brand.fullVersion}` : verLabel);
  const verBanner = brand.versionBanner || `線上簽核系統 ${verLabel}`;
  const builtAt = brand.versionBuiltAt
    ? String(brand.versionBuiltAt).replace('T', ' ').replace(/\.\d+Z$/, ' UTC')
    : '—';

  let deployLogHtml = `<p class="muted" style="margin:0">載入自動部署紀錄中…</p>`;
  try {
    const logData = await api('/api/system/deploy-log?limit=15');
    const entries = logData.entries || [];
    if (!entries.length) {
      deployLogHtml = `<p class="muted" style="margin:0">尚無部署紀錄（下次有程式變更並重啟後會自動寫入）。</p>`;
    } else {
      deployLogHtml = `
        <p class="muted" style="margin:0 0 10px;font-size:0.85rem;line-height:1.45">
          伺服器每次啟動會比對程式指紋；有變更時寫入
          <code>data/修改紀錄-自動.md</code> 與 <code>data/deploy-history.json</code>。
          純重啟（檔案未改）不重複記一筆。
        </p>
        <div style="max-height:320px;overflow:auto;border:1px solid var(--border);border-radius:10px">
          <table class="data" style="margin:0;font-size:0.85rem;width:100%;table-layout:fixed">
            <thead>
              <tr>
                <th style="width:150px;white-space:nowrap">時間</th>
                <th style="width:160px;white-space:nowrap">版本</th>
                <th style="width:110px;white-space:nowrap">類型</th>
                <th style="min-width:180px">變更檔</th>
              </tr>
            </thead>
            <tbody>
              ${entries
                .map((e) => {
                  const ch = e.changes || {};
                  const cnt = `改${ch.modifiedCount || 0}/新${ch.addedCount || 0}/刪${ch.removedCount || 0}`;
                  const files = [
                    ...(ch.modified || []).slice(0, 3),
                    ...(ch.added || []).slice(0, 2),
                  ]
                    .map((f) => f.replace(/^server\//, 's/').replace(/^public\//, 'p/'))
                    .join(', ');
                  const tip = [
                    ...(ch.modified || []).map((f) => `改 ${f}`),
                    ...(ch.added || []).map((f) => `新 ${f}`),
                    ...(ch.removed || []).map((f) => `刪 ${f}`),
                  ]
                    .slice(0, 20)
                    .join('\n');
                  return `<tr title="${esc(tip)}">
                    <td style="white-space:nowrap">${esc(e.atLocal || e.at || '')}</td>
                    <td><code>${esc(e.label || '')}</code></td>
                    <td>${esc(e.typeLabel || e.type || '')}</td>
                    <td>${esc(cnt)}${files ? `<div class="muted" style="font-size:0.78rem">${esc(files)}</div>` : ''}</td>
                  </tr>`;
                })
                .join('')}
            </tbody>
          </table>
        </div>`;
    }
  } catch {
    deployLogHtml = `<p class="muted" style="margin:0">無法載入部署紀錄（需內建 Admin）。</p>`;
  }

  body.innerHTML = `
    <div class="system-settings-page">
    <div class="card" style="background:#eff6ff;border-color:#bfdbfe">
      <h3 style="margin-top:0">系統版本（自動）</h3>
      <p style="margin:0;font-size:1.35rem;font-weight:700;color:#1d4ed8;letter-spacing:0.04em">${esc(verLabel)}</p>
      <p class="muted" style="margin:8px 0 0;line-height:1.55;font-size:0.9rem">
        完整版號：<strong style="color:#1e3a5f">${esc(verFull)}</strong><br/>
        建置指紋：<code>${esc(brand.versionBuild || '—')}</code>
        　·　原始檔時間：${esc(builtAt)}<br/>
        ${esc(verBanner)}<br/>
        <span style="color:#0369a1">主版號來自 package.json；掃描 server／public 產生指紋，
        <strong>修改並重新部署／重啟後會自動變更</strong>，並寫入部署修改紀錄。</span>
      </p>
    </div>

    <div class="card">
      <h3 style="margin-top:0">自動部署修改紀錄</h3>
      ${deployLogHtml}
    </div>

    <div class="card">
      <h3 style="margin-top:0">公司品牌</h3>
      <p class="muted" style="margin-top:0">設定後將顯示於登入頁、側欄與 PDF 抬頭。僅系統管理員可修改。</p>
      <form id="brand-form" class="form-grid">
        <div class="field">
          <label>公司名稱 *</label>
          <input name="companyName" required maxlength="80"
            value="${esc(brand.companyName || '線上簽核系統')}"
            placeholder="顯示於系統標題與 PDF" />
        </div>
        <div class="field">
          <label>公司 Logo</label>
          <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-top:8px">
            <div style="background:#f8fafc;border:1px solid var(--border);border-radius:12px;padding:12px 16px">
              <img id="brand-logo-preview" src="${esc(logoUrl)}" alt="Logo 預覽"
                style="display:block;max-width:220px;max-height:64px;width:auto;height:auto;object-fit:contain" />
            </div>
            <div style="display:flex;flex-direction:column;gap:8px">
              <label class="btn outline sm" style="cursor:pointer;margin:0;display:inline-flex;align-items:center">
                上傳 Logo
                <input type="file" id="brand-logo-file" accept="image/png,image/jpeg,image/gif,image/webp" class="hidden" />
              </label>
              <button type="button" class="btn sm outline" id="btn-logo-reset"
                ${brand.hasCustomLogo ? '' : 'disabled'}>還原預設 Logo</button>
              <span class="muted" style="font-size:0.78rem">PNG／JPG／GIF／WEBP，建議 2MB 以內；依比例縮放</span>
            </div>
          </div>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn primary">儲存公司名稱</button>
        </div>
      </form>
    </div>

    <div class="card">
      <h3 style="margin-top:0">總覽公告</h3>
      <p class="muted" style="margin-top:0;line-height:1.55">
        於<strong>總覽</strong>顯示一則公司公告卡。可上傳附件；同仁點「查看」可讀全文並開啟／下載附件。
        可設定<strong>公布期間</strong>，超過結束時間自動下架（總覽不再顯示）。
        部署不覆蓋 <code>data/</code> 內公告內容與附件。
      </p>
      <p class="muted" style="margin:0 0 12px;font-size:0.9rem">
        狀態：
        <strong style="color:${
          announcement.active
            ? '#15803d'
            : announcement.enabled
              ? '#b45309'
              : 'inherit'
        }">
          ${esc(formatAnnouncementStatus(announcement))}
        </strong>
        ${
          announcement.updatedAt
            ? ` · 更新 ${esc(String(announcement.updatedAt).replace('T', ' ').replace(/\.\d+Z$/, ''))}`
            : ''
        }
      </p>
      <form id="announcement-form" class="form-grid two">
        <div class="field check-row-box" style="grid-column:1/-1">
          <label class="check-row">
            <input type="checkbox" name="enabled" id="announcement-enabled"
              ${announcement.enabled ? 'checked' : ''} />
            <span><strong>啟用公告</strong>（須同時在公布期間內才會顯示於總覽）</span>
          </label>
        </div>
        <div class="field">
          <label>公布開始時間</label>
          <input type="datetime-local" name="startAt"
            value="${esc(toDatetimeLocalValue(announcement.startAt))}" />
          <span class="muted" style="font-size:0.78rem;display:block;margin-top:4px">留空＝立即（不限制開始）</span>
        </div>
        <div class="field">
          <label>公布結束時間</label>
          <input type="datetime-local" name="endAt"
            value="${esc(toDatetimeLocalValue(announcement.endAt))}" />
          <span class="muted" style="font-size:0.78rem;display:block;margin-top:4px">留空＝不自動下架；有填則到期後總覽不顯示</span>
        </div>
        <div class="field" style="grid-column:1/-1">
          <label>公告標題</label>
          <input name="title" maxlength="120"
            value="${esc(announcement.title || '')}"
            placeholder="例如：系統維護通知" />
        </div>
        <div class="field" style="grid-column:1/-1">
          <label>公告內容</label>
          <textarea name="body" rows="6" maxlength="8000"
            placeholder="支援多行文字…">${esc(announcement.body || '')}</textarea>
        </div>
        <div class="field" style="grid-column:1/-1">
          <label>附件（選填，總覽不顯示檔名，僅「查看」時可下載）</label>
          <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:6px">
            <label class="btn outline sm" style="cursor:pointer;margin:0;display:inline-flex">
              上傳附件
              <input type="file" id="announcement-file" class="hidden"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv,.zip,.7z" />
            </label>
            <button type="button" class="btn sm outline" id="btn-announcement-file-clear"
              ${announcement.hasFile ? '' : 'disabled'}>移除附件</button>
            <button type="button" class="btn sm outline" id="btn-announcement-preview">預覽查看</button>
          </div>
          <span class="muted" style="font-size:0.78rem;display:block;margin-top:6px">
            ${
              announcement.hasFile
                ? `目前附件：${esc(announcement.originalName || '')}`
                : '尚未上傳。允許 PDF／Office／圖片／TXT／CSV／ZIP，最大 15MB。'
            }
          </span>
        </div>
        <div class="form-actions" style="grid-column:1/-1">
          <button type="submit" class="btn primary">儲存公告</button>
        </div>
      </form>
    </div>

    <div class="card">
      <h3>PDF 數位簽章（公司憑證）</h3>
      <p class="muted" style="margin-top:0;line-height:1.55">
        使用公司 <strong>PKCS#12（.p12／.pfx）</strong> 憑證對下載／備份的 PDF 做數位簽章，
        可用 Acrobat 等軟體驗證並偵測竄改。
      </p>
      <p class="muted" style="margin:0 0 12px;font-size:0.9rem">
        狀態：<strong style="color:${pdfSign.ready ? '#15803d' : '#b45309'}">${esc(signStatusText)}</strong>
        ${pdfSign.certFileName ? ` · 憑證檔：${esc(pdfSign.certFileName)}` : ''}
        ${!pdfSign.libsReady && pdfSign.libsError ? `<br/><span style="color:#b45309">套件：${esc(pdfSign.libsError)}</span>` : ''}
      </p>

      <div style="border:1px solid #bfdbfe;background:#eff6ff;border-radius:12px;padding:14px 16px;margin-bottom:16px">
        <h4 style="margin:0 0 8px;color:#1e40af">製作數位簽章（自簽憑證）</h4>
        <p class="muted" style="margin:0 0 12px;font-size:0.85rem;line-height:1.5">
          無正式公司憑證時，可在此<strong>產生自簽 .p12</strong>並立即用於 PDF 簽章（僅供內部）。
          標示 <strong style="color:#b45309">*</strong> 為必填。
          <br/>CN／O 可填中文公司名稱；密碼請妥善保管。
        </p>
        <form id="pdf-sign-create-form" class="form-grid two">
          <div class="field">
            <label>通用名稱 CN *</label>
            <input name="commonName" required maxlength="64"
              value="${esc(brand.companyName || '')}"
              placeholder="例如：CatsHome Inc. 或公司全名" />
          </div>
          <div class="field">
            <label>組織／公司名稱 O *</label>
            <input name="organization" required maxlength="64"
              value="${esc(brand.companyName || '')}"
              placeholder="與營業登記或對外名稱一致" />
          </div>
          <div class="field">
            <label>單位／部門 OU（選填）</label>
            <input name="organizationalUnit" maxlength="64" placeholder="例如：資訊部" />
          </div>
          <div class="field">
            <label>國家代碼 C *</label>
            <input name="country" required maxlength="2" value="TW" placeholder="TW"
              style="text-transform:uppercase" />
          </div>
          <div class="field">
            <label>縣市／省 ST（選填）</label>
            <input name="province" maxlength="64" placeholder="例如：Taipei" />
          </div>
          <div class="field">
            <label>地區 L（選填）</label>
            <input name="locality" maxlength="64" placeholder="例如：Taipei City" />
          </div>
          <div class="field">
            <label>聯絡 Email（選填）</label>
            <input name="email" type="email" maxlength="80" placeholder="admin@example.com" />
          </div>
          <div class="field">
            <label>有效年數 *</label>
            <input name="validYears" type="number" required min="1" max="30" value="5" />
          </div>
          <div class="field">
            <label>憑證密碼 *</label>
            <input name="passphrase" type="password" required minlength="4" autocomplete="new-password"
              placeholder="至少 4 字元（請妥善保管）" />
          </div>
          <div class="field">
            <label>確認憑證密碼 *</label>
            <input name="passphraseConfirm" type="password" required minlength="4" autocomplete="new-password"
              placeholder="再輸入一次" />
          </div>
          <div class="field">
            <label>簽署者顯示名稱（選填）</label>
            <input name="signerName" maxlength="80"
              value="${esc(pdfSign.signerName || brand.companyName || '')}"
              placeholder="預設＝通用名稱 CN" />
          </div>
          <div class="field">
            <label>簽署原因（選填）</label>
            <input name="reason" maxlength="200"
              value="${esc(pdfSign.reason || '線上簽核系統正式產出文件')}" />
          </div>
          <div class="field" style="grid-column:1/-1">
            <label class="check-row" style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" name="enableAfterCreate" checked />
              <span>製作完成後<strong>自動啟用</strong> PDF 數位簽章</span>
            </label>
          </div>
          <div class="field" style="grid-column:1/-1">
            <label class="check-row" style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" name="onlyApproved" ${
                pdfSign.onlyApproved !== false ? 'checked' : ''
              } />
              <span>僅對<strong>已核准</strong>單據加簽（建議勾選）</span>
            </label>
          </div>
          <div class="form-actions" style="grid-column:1/-1">
            <button type="submit" class="btn primary" id="btn-pdf-sign-create">製作並儲存憑證</button>
          </div>
        </form>
        <p class="muted" style="font-size:0.78rem;margin:10px 0 0;line-height:1.45">
          注意：若已有憑證，製作新憑證會<strong>覆蓋</strong>現有 .p12。自簽憑證在 Acrobat 可能顯示「簽發者不被信任」，內部防竄改仍有效。
        </p>
      </div>

      <form id="pdf-sign-form" class="form-grid">
        <div class="field check-row-box">
          <label class="check-row">
            <input type="checkbox" name="pdfSignEnabled" id="pdf-sign-enabled"
              ${pdfSign.enabled ? 'checked' : ''} />
            <span><strong>啟用 PDF 數位簽章</strong></span>
          </label>
        </div>
        <div class="field check-row-box">
          <label class="check-row">
            <input type="checkbox" name="pdfSignOnlyApproved" id="pdf-sign-only-approved"
              ${pdfSign.onlyApproved !== false ? 'checked' : ''} />
            <span>僅對<strong>已核准</strong>單據加簽（建議勾選）</span>
          </label>
        </div>
        <div class="field">
          <label>或上傳既有公司憑證（.p12 / .pfx）</label>
          <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:6px">
            <label class="btn outline sm" style="cursor:pointer;margin:0;display:inline-flex">
              上傳憑證
              <input type="file" id="pdf-sign-cert-file" accept=".p12,.pfx,application/x-pkcs12" class="hidden" />
            </label>
            <button type="button" class="btn sm outline" id="btn-pdf-sign-cert-clear"
              ${pdfSign.hasCert ? '' : 'disabled'}>移除憑證</button>
          </div>
          <span class="muted" style="font-size:0.78rem;display:block;margin-top:6px">
            若已由 IT 核發正式 PKCS#12，可直接上傳；私鑰勿外流。
          </span>
        </div>
        <div class="field">
          <label>憑證密碼</label>
          <input name="pdfSignPass" type="password" value="" autocomplete="new-password"
            placeholder="${pdfSign.hasPass ? '已設定（留空則不變更）' : 'PKCS#12 密碼（可為空）'}" />
        </div>
        <div class="field">
          <label>簽署者顯示名稱</label>
          <input name="pdfSignSignerName" maxlength="80"
            value="${esc(pdfSign.signerName || brand.companyName || '')}"
            placeholder="預設＝公司名稱" />
        </div>
        <div class="field">
          <label>簽署原因</label>
          <input name="pdfSignReason" maxlength="200"
            value="${esc(pdfSign.reason || '線上簽核系統正式產出文件')}" />
        </div>
        <div class="field">
          <label>地點</label>
          <input name="pdfSignLocation" maxlength="80"
            value="${esc(pdfSign.location || 'Taiwan')}" />
        </div>
        <div class="field">
          <label>聯絡資訊（選填）</label>
          <input name="pdfSignContact" maxlength="120"
            value="${esc(pdfSign.contactInfo || '')}"
            placeholder="例如公司 Email" />
        </div>
        <div class="form-actions" style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="submit" class="btn primary">儲存簽章設定</button>
          <button type="button" class="btn outline" id="btn-pdf-sign-test">下載測試簽章 PDF</button>
        </div>
      </form>
      <p class="muted" style="font-size:0.8rem;margin:12px 0 0;line-height:1.5">
        驗章方式：以 Adobe Acrobat 開啟 PDF → 簽名面板應顯示簽章資訊。
      </p>
    </div>

    <div class="card">
      <h3>備份加密（AES-256）</h3>
      <p class="muted" style="margin-top:0;line-height:1.55">
        啟用後，<strong>備份資料</strong>一律以 <strong>AES-256 加密 ZIP</strong> 儲存（含僅 PDF、無附件的單據）。
        解壓時請使用支援 AES-256 的工具（如 7-Zip、WinZip、Bandizip）。
        Windows 檔案總管可能無法直接開啟 AES ZIP。
      </p>
      <p class="muted" style="margin:0 0 12px;font-size:0.9rem">
        狀態：<strong style="color:${backupEncrypt.ready ? '#15803d' : backupEncrypt.enabled ? '#b45309' : 'inherit'}">${esc(backupEncryptStatusText)}</strong>
      </p>
      <form id="backup-encrypt-form" class="form-grid">
        <div class="field check-row-box">
          <label class="check-row">
            <input type="checkbox" name="backupEncryptEnabled" id="backup-encrypt-enabled"
              ${backupEncrypt.enabled ? 'checked' : ''} />
            <span><strong>啟用備份 ZIP 加密</strong></span>
          </label>
        </div>
        <div class="field">
          <label>備份密碼</label>
          <input name="backupEncryptPass" type="password" value="" autocomplete="new-password"
            placeholder="${backupEncrypt.hasPass ? '已設定（留空則不變更）' : '設定加密密碼（請妥善保存）'}" />
        </div>
        <div class="field">
          <label>確認密碼</label>
          <input name="backupEncryptPassConfirm" type="password" value="" autocomplete="new-password"
            placeholder="再次輸入新密碼（僅在變更時）" />
        </div>
        <div class="form-actions" style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="submit" class="btn primary">儲存備份加密設定</button>
          <button type="button" class="btn outline" id="btn-backup-encrypt-clear-pass"
            ${backupEncrypt.hasPass ? '' : 'disabled'}>清除密碼</button>
        </div>
      </form>
      <p class="muted" style="font-size:0.8rem;margin:12px 0 0;line-height:1.5">
        密碼僅存於伺服器端，介面不會顯示。若遺失密碼，已加密的舊備份將無法解壓。<br/>
        變更密碼後，請勾選「強制覆寫」重新備份，既有檔案不會自動重加密。
      </p>
    </div>

    <div class="card">
      <h3>備份儲存目錄</h3>
      <p class="muted" style="margin-top:0;line-height:1.55">
        設定備份檔案的儲存根目錄。留空則使用預設路徑（<code>data/backups</code>）。
        Docker 環境請填寫容器內絕對路徑（如 <code>/mnt/nas-share/backups</code>）。
      </p>
      <form id="backup-dir-form" class="form-grid">
        <div class="field">
          <label for="backup-dir-input">備份目錄路徑</label>
          <input id="backup-dir-input" name="backupDir" type="text"
            value="${esc(backupDir)}"
            placeholder="留空使用預設：data/backups" style="font-family:monospace" />
          <span class="field-hint" style="color:#6b7280;font-size:0.82rem">
            目前：<code>${esc(backupDir || '（預設）data/backups')}</code>
          </span>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn primary" id="btn-backup-dir-save">儲存備份目錄</button>
          <button type="button" class="btn outline" id="btn-backup-dir-reset">恢復預設</button>
        </div>
      </form>
      <p class="muted" style="font-size:0.8rem;margin:12px 0 0;line-height:1.5">
        ⚠️ 變更目錄後，<strong>已備份的歷史紀錄仍指向舊路徑</strong>，新備份才會寫入新目錄。<br/>
        確認目錄存在且伺服器程序有寫入權限。不可使用 <code>..</code> 路徑穿越。
      </p>
    </div>

    <div class="card">
      <h3>💬 LINE 通知設定</h3>
      ${lineSettingsFormHtml(lineCfg, { formId: 'sys-line-form', showAccess: true })}
      <p class="muted" style="margin:12px 0 0;font-size:0.85rem">
        亦可從側欄「LINE 通知」進入同一套設定。
      </p>
    </div>

    <div class="card">
      <h3>Email 設定（SMTP）</h3>
      <p class="muted" style="margin-top:0">設定 SMTP 後，申請人可收到進度通知，並可對簽核人寄送催辦信。</p>
      <form id="mail-form" class="form-grid">
        <div class="field check-row-box">
          <label class="check-row">
            <input type="checkbox" name="enabled" id="mail-enabled" ${mailCfg.enabled ? 'checked' : ''} />
            <span><strong>啟用 Email 提醒</strong>
              <span class="muted" style="margin-left:8px;font-size:0.85rem">${
                mailCfg.ready ? 'SMTP 已就緒' : '尚未完成 SMTP 設定'
              }</span>
            </span>
          </label>
        </div>
        <div class="field"><label>SMTP 主機</label>
          <input name="host" value="${esc(mailCfg.host || '')}" placeholder="例如 smtp.gmail.com 或 mail.公司網域" /></div>
        <div class="field" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div><label>連接埠</label>
            <input name="port" type="number" id="mail-port" value="${esc(String(mailCfg.port || 587))}" /></div>
          <div class="check-row-stack">
            <label class="check-row">
              <input type="checkbox" name="secure" id="mail-secure" ${mailCfg.secure ? 'checked' : ''} />
              <span>SSL（埠 465）</span>
            </label>
            <label class="check-row">
              <input type="checkbox" name="ignoreTLS" id="mail-ignore-tls" ${
                mailCfg.ignoreTLS || Number(mailCfg.port) === 25 ? 'checked' : ''
              } />
              <span>略過 TLS（埠 25 明文請勾選）</span>
            </label>
            <label class="check-row">
              <input type="checkbox" name="requireTLS" id="mail-require-tls" ${
                mailCfg.requireTLS || Number(mailCfg.port) === 587 ? 'checked' : ''
              } />
              <span>要求 STARTTLS（埠 587）</span>
            </label>
          </div>
        </div>
        <p class="muted" style="font-size:0.82rem;margin:0 0 8px;line-height:1.45">
          常見設定：<strong>587</strong>＋STARTTLS（不勾 SSL）；<strong>465</strong>＋SSL；
          內網 <strong>25</strong>＋略過 TLS。
        </p>
        <div class="field"><label>SMTP 帳號</label>
          <input name="user" value="${esc(mailCfg.user || '')}" placeholder="完整信箱" autocomplete="off" /></div>
        <div class="field"><label>SMTP 密碼</label>
          <input name="pass" type="password" value="" placeholder="${mailCfg.hasPass ? '已設定（留空則不變更）' : '尚未設定'}" autocomplete="new-password" /></div>
        <div class="field"><label>寄件者 Email</label>
          <input name="from" type="email" value="${esc(mailCfg.from || '')}" placeholder="顯示的寄件信箱" /></div>
        <div class="field"><label>寄件者名稱</label>
          <input name="fromName" value="${esc(mailCfg.fromName || brand.companyName || '線上簽核系統')}" /></div>
        <div class="field"><label>系統網址（信內連結）</label>
          <input name="baseUrl" value="${esc(mailCfg.baseUrl || 'http://127.0.0.1:8080')}" placeholder="http://公司IP:端口" /></div>
        <div class="form-actions" style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="submit" class="btn primary">儲存 Email 設定</button>
          <button type="button" class="btn outline" id="btn-mail-test">寄送測試信</button>
        </div>
      </form>
    </div>

    <div class="card">
      <h3>系統設定完整包</h3>
      <p class="muted" style="margin-top:0;line-height:1.55">
        一次匯出／匯入：部門、成員、簽核流程與申請表、Email 設定。
      </p>
      <div class="check-group-box" style="margin-bottom:12px;background:#f8fafc">
        <strong class="check-group-title">匯出</strong>
        <label class="check-row">
          <input type="checkbox" id="pkg-export-history" />
          <span>包含歷史申請單、簽核歷程與附件</span>
        </label>
        <label class="check-row">
          <input type="checkbox" id="pkg-export-mail-pass" />
          <span>包含 SMTP 密碼（明文寫入 JSON，預設不匯出）</span>
        </label>
        <button type="button" class="btn primary" id="btn-pkg-export" style="margin-top:4px">下載設定完整包（JSON）</button>
      </div>
      <div class="check-group-box" style="background:#fff">
        <strong class="check-group-title">匯入</strong>
        <label class="check-row">
          <input type="checkbox" id="pkg-import-mail" checked />
          <span>套用 Email／SMTP 設定</span>
        </label>
        <label class="check-row">
          <input type="checkbox" id="pkg-import-history" />
          <span>匯入歷史申請</span>
        </label>
        <button type="button" class="btn outline" id="btn-pkg-import" style="margin-top:4px">選擇 JSON 並匯入…</button>
        <input type="file" id="pkg-import-file" accept=".json,application/json" class="hidden" />
        <div id="pkg-import-result" class="muted" style="margin-top:10px;font-size:0.9rem;white-space:pre-wrap"></div>
      </div>
    </div>
    </div>`;

  // 公司名稱
  $('#brand-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const data = await api('/api/system/settings', {
        method: 'PUT',
        body: { companyName: fd.get('companyName') },
      });
      state.systemSettings = data.settings || data;
      applySystemBranding(state.systemSettings);
      toast('公司名稱已儲存', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  // Logo 上傳
  $('#brand-logo-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const fd = new FormData();
    fd.append('logo', file);
    try {
      const data = await api('/api/system/logo', { method: 'POST', body: fd });
      state.systemSettings = data.settings || data;
      applySystemBranding(state.systemSettings);
      const prev = $('#brand-logo-preview');
      if (prev && state.systemSettings.logoUrl) {
        prev.src = state.systemSettings.logoUrl;
      }
      toast('Logo 已更新', 'success');
      navigate('system-settings');
    } catch (err) {
      toast(err.message || '上傳失敗', 'error');
    }
  });

  $('#btn-logo-reset')?.addEventListener('click', async () => {
    if (!confirm('確定還原為預設 Logo？')) return;
    try {
      const data = await api('/api/system/logo', { method: 'DELETE' });
      state.systemSettings = data.settings || data;
      applySystemBranding(state.systemSettings);
      toast('已還原預設 Logo', 'success');
      navigate('system-settings');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // 總覽公告
  $('#announcement-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const startRaw = String(fd.get('startAt') || '').trim();
    const endRaw = String(fd.get('endAt') || '').trim();
    if (startRaw && endRaw && new Date(startRaw) > new Date(endRaw)) {
      toast('公布開始時間不可晚於結束時間', 'error');
      return;
    }
    try {
      const data = await api('/api/system/announcement', {
        method: 'PUT',
        body: {
          enabled: !!e.target.querySelector('#announcement-enabled')?.checked,
          title: String(fd.get('title') || '').trim(),
          body: String(fd.get('body') || ''),
          // 空字串＝清除該端限制
          startAt: startRaw || null,
          endAt: endRaw || null,
        },
      });
      state.systemSettings = data.settings || state.systemSettings;
      toast('公告已儲存', 'success');
      navigate('system-settings');
    } catch (err) {
      toast(err.message || '儲存失敗', 'error');
    }
  });

  $('#announcement-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      await api('/api/system/announcement/file', { method: 'POST', body: fd });
      toast('附件已上傳', 'success');
      navigate('system-settings');
    } catch (err) {
      toast(err.message || '上傳失敗', 'error');
    }
  });

  $('#btn-announcement-file-clear')?.addEventListener('click', async () => {
    if (!confirm('確定移除公告附件？')) return;
    try {
      await api('/api/system/announcement/file', { method: 'DELETE' });
      toast('已移除附件', 'success');
      navigate('system-settings');
    } catch (err) {
      toast(err.message || '移除失敗', 'error');
    }
  });

  $('#btn-announcement-preview')?.addEventListener('click', () => {
    const a = {
      ...announcement,
      active: true,
      _forcePreview: true,
      title: String($('#announcement-form [name="title"]')?.value || announcement.title || ''),
      body: String($('#announcement-form [name="body"]')?.value || announcement.body || ''),
    };
    if (!a.title && !a.body && !a.hasFile) {
      toast('請先填寫公告或上傳附件', 'error');
      return;
    }
    openAnnouncementModal(a);
  });

  // PDF 數位簽章 — 製作自簽憑證
  $('#pdf-sign-create-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const passphrase = String(fd.get('passphrase') || '');
    const passphraseConfirm = String(fd.get('passphraseConfirm') || '');
    if (!String(fd.get('commonName') || '').trim()) {
      toast('請填寫通用名稱（CN）', 'error');
      return;
    }
    if (!String(fd.get('organization') || '').trim()) {
      toast('請填寫組織／公司名稱（O）', 'error');
      return;
    }
    if (!String(fd.get('country') || '').trim()) {
      toast('請填寫國家代碼（C）', 'error');
      return;
    }
    if (passphrase.length < 4) {
      toast('憑證密碼至少 4 個字元', 'error');
      return;
    }
    if (passphrase !== passphraseConfirm) {
      toast('兩次輸入的憑證密碼不一致', 'error');
      return;
    }
    if (
      pdfSign.hasCert &&
      !confirm('已有公司憑證，確定以新製作的憑證覆蓋？')
    ) {
      return;
    }
    const btn = $('#btn-pdf-sign-create');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '製作中…';
    }
    try {
      const data = await api('/api/system/pdf-sign/create', {
        method: 'POST',
        body: {
          commonName: String(fd.get('commonName') || '').trim(),
          organization: String(fd.get('organization') || '').trim(),
          organizationalUnit: String(fd.get('organizationalUnit') || '').trim(),
          country: String(fd.get('country') || 'TW').trim(),
          province: String(fd.get('province') || '').trim(),
          locality: String(fd.get('locality') || '').trim(),
          email: String(fd.get('email') || '').trim(),
          validYears: Number(fd.get('validYears') || 5),
          passphrase,
          passphraseConfirm,
          signerName: String(fd.get('signerName') || '').trim(),
          reason: String(fd.get('reason') || '').trim(),
          enableAfterCreate: !!e.target.querySelector('[name="enableAfterCreate"]')
            ?.checked,
          onlyApproved: !!e.target.querySelector('[name="onlyApproved"]')?.checked,
        },
      });
      const until = data.meta?.notAfter
        ? String(data.meta.notAfter).slice(0, 10)
        : '';
      toast(
        until
          ? `已製作憑證（有效至 ${until}），可下載測試 PDF 驗證`
          : '已製作並儲存自簽憑證',
        'success'
      );
      navigate('system-settings');
    } catch (err) {
      const msg = err && err.message ? String(err.message) : '製作失敗';
      toast(msg.length > 120 ? msg.slice(0, 120) + '…' : msg, 'error');
      console.error('[pdf-sign create]', err);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '製作並儲存憑證';
      }
    }
  });

  // PDF 數位簽章 — 儲存設定
  $('#pdf-sign-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/api/system/settings', {
        method: 'PUT',
        body: {
          pdfSignEnabled: !!e.target.querySelector('#pdf-sign-enabled')?.checked,
          pdfSignOnlyApproved: !!e.target.querySelector('#pdf-sign-only-approved')
            ?.checked,
          pdfSignReason: fd.get('pdfSignReason') || '',
          pdfSignLocation: fd.get('pdfSignLocation') || '',
          pdfSignContact: fd.get('pdfSignContact') || '',
          pdfSignSignerName: fd.get('pdfSignSignerName') || '',
          pdfSignPass: fd.get('pdfSignPass') || '',
        },
      });
      toast('PDF 簽章設定已儲存', 'success');
      navigate('system-settings');
    } catch (err) {
      toast(err.message || '儲存失敗', 'error');
    }
  });

  $('#pdf-sign-cert-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const fd = new FormData();
    fd.append('cert', file);
    const pass = document.querySelector('#pdf-sign-form [name="pdfSignPass"]')?.value;
    if (pass) fd.append('passphrase', pass);
    try {
      await api('/api/system/pdf-sign/cert', { method: 'POST', body: fd });
      toast('憑證已上傳', 'success');
      navigate('system-settings');
    } catch (err) {
      toast(err.message || '憑證上傳失敗', 'error');
    }
  });

  $('#btn-pdf-sign-cert-clear')?.addEventListener('click', async () => {
    if (!confirm('確定移除公司簽章憑證？')) return;
    try {
      await api('/api/system/pdf-sign/cert', { method: 'DELETE' });
      toast('已移除憑證', 'success');
      navigate('system-settings');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  $('#btn-pdf-sign-test')?.addEventListener('click', async () => {
    try {
      const blob = await api('/api/system/pdf-sign/test', {
        method: 'POST',
        body: {},
        expectBlob: true,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = '簽章測試.pdf';
      a.click();
      URL.revokeObjectURL(url);
      toast('已下載測試 PDF，請用 Acrobat 檢查簽章', 'success');
    } catch (err) {
      toast(err.message || '測試失敗', 'error');
    }
  });

  // 備份加密
  $('#backup-encrypt-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const enabled = !!e.target.querySelector('#backup-encrypt-enabled')?.checked;
    const pass = String(fd.get('backupEncryptPass') || '');
    const confirm = String(fd.get('backupEncryptPassConfirm') || '');
    if (pass || confirm) {
      if (pass !== confirm) {
        toast('兩次輸入的備份密碼不一致', 'error');
        return;
      }
      if (pass.length < 4) {
        toast('備份密碼至少 4 個字元', 'error');
        return;
      }
    }
    if (enabled && !backupEncrypt.hasPass && !pass) {
      toast('啟用加密時請設定備份密碼', 'error');
      return;
    }
    try {
      await api('/api/system/settings', {
        method: 'PUT',
        body: {
          backupEncryptEnabled: enabled,
          backupEncryptPass: pass || '',
        },
      });
      toast('備份加密設定已儲存', 'success');
      navigate('system-settings');
    } catch (err) {
      toast(err.message || '儲存失敗', 'error');
    }
  });

  $('#btn-backup-encrypt-clear-pass')?.addEventListener('click', async () => {
    if (
      !confirm(
        '確定清除備份密碼？\n若仍啟用加密，將無法執行新備份；已加密的舊檔仍需原密碼才能解壓。'
      )
    ) {
      return;
    }
    try {
      await api('/api/system/settings', {
        method: 'PUT',
        body: {
          backupEncryptPassClear: true,
          backupEncryptEnabled: false,
        },
      });
      toast('已清除備份密碼並關閉加密', 'success');
      navigate('system-settings');
    } catch (err) {
      toast(err.message || '清除失敗', 'error');
    }
  });

  // 備份目錄
  $('#backup-dir-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const dir = String(fd.get('backupDir') || '').trim();
    if (dir && dir.includes('..')) {
      toast('備份目錄不可包含「..」路徑穿越', 'error');
      return;
    }
    try {
      await api('/api/system/settings', {
        method: 'PUT',
        body: { backupDir: dir },
      });
      toast('備份目錄已儲存' + (dir ? `：${dir}` : '（已恢復預設）'), 'success');
      navigate('system-settings');
    } catch (err) {
      toast(err.message || '儲存失敗', 'error');
    }
  });

  $('#btn-backup-dir-reset')?.addEventListener('click', async () => {
    try {
      await api('/api/system/settings', {
        method: 'PUT',
        body: { backupDir: '' },
      });
      toast('備份目錄已恢復為預設（data/backups）', 'success');
      navigate('system-settings');
    } catch (err) {
      toast(err.message || '清除失敗', 'error');
    }
  });

  // LINE（系統設定內嵌）
  bindLineSettingsForm({
    formId: 'sys-line-form',
    onSaved: () => navigate('system-settings'),
  });

  // Mail
  const mailForm = $('#mail-form');
  if (mailForm) {
    mailForm.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await api('/api/mail/config', {
          method: 'PUT',
          body: {
            enabled: !!e.target.querySelector('#mail-enabled')?.checked,
            host: fd.get('host') || '',
            port: Number(fd.get('port')) || 587,
            secure: !!e.target.querySelector('#mail-secure')?.checked,
            ignoreTLS: !!e.target.querySelector('#mail-ignore-tls')?.checked,
            requireTLS: !!e.target.querySelector('#mail-require-tls')?.checked,
            user: fd.get('user') || '',
            pass: fd.get('pass') || '',
            from: fd.get('from') || '',
            fromName: fd.get('fromName') || brand.companyName || '線上簽核系統',
            baseUrl: fd.get('baseUrl') || 'http://127.0.0.1:8080',
          },
        });
        toast('Email 設定已儲存', 'success');
        navigate('system-settings');
      } catch (err) {
        toast(err.message, 'error');
      }
    };
    $('#mail-port')?.addEventListener('change', () => {
      const p = Number($('#mail-port')?.value) || 587;
      const sec = $('#mail-secure');
      const ign = $('#mail-ignore-tls');
      const req = $('#mail-require-tls');
      if (p === 465 && sec) sec.checked = true;
      if (p === 25) {
        if (sec) sec.checked = false;
        if (ign) ign.checked = true;
        if (req) req.checked = false;
      }
      if (p === 587) {
        if (sec) sec.checked = false;
        if (ign) ign.checked = false;
        if (req) req.checked = true;
      }
    });
    $('#btn-mail-test')?.addEventListener('click', async () => {
      try {
        const data = await api('/api/mail/test', { method: 'POST', body: {} });
        const mode =
          data.result?.mode === 'outbox' ? '（僅寫入 outbox，未真正寄出）' : '';
        toast(`測試信已寄出${mode}`, 'success');
      } catch (err) {
        toast(err.message || '測試信寄送失敗', 'error');
      }
    });
  }

  // Package
  $('#btn-pkg-export')?.addEventListener('click', async () => {
    const history = $('#pkg-export-history')?.checked ? '1' : '0';
    const mailSecrets = $('#pkg-export-mail-pass')?.checked ? '1' : '0';
    if (mailSecrets === '1') {
      const ok = confirm(
        '將把 SMTP 密碼以明文寫入 JSON 設定包。\n檔案請勿放入一鍵安裝包或 Git。\n確定仍要匯出密碼？'
      );
      if (!ok) return;
    }
    try {
      const confirmMail = mailSecrets === '1' ? '1' : '0';
      const blob = await api(
        `/api/system/package/export?includeHistory=${history}&includeMailSecrets=${mailSecrets}&confirmMailSecrets=${confirmMail}`,
        { expectBlob: true }
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `簽核系統_${history === '1' ? '完整含歷史' : '設定'}包_${twToday()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast('設定完整包已下載', 'success');
    } catch (err) {
      toast(err.message || '匯出失敗', 'error');
    }
  });
  $('#btn-pkg-import')?.addEventListener('click', () => {
    $('#pkg-import-file')?.click();
  });
  $('#pkg-import-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const importMail = $('#pkg-import-mail')?.checked;
    const importHistory = $('#pkg-import-history')?.checked;
    if (
      !confirm(
        `確定匯入「${file.name}」？\n將合併更新部門、成員、流程` +
          (importMail ? '、Email' : '') +
          (importHistory ? '，並匯入歷史' : '')
      )
    ) {
      return;
    }
    const fd = new FormData();
    fd.append('package', file);
    fd.append('importMail', importMail ? '1' : '0');
    fd.append('importHistory', importHistory ? '1' : '0');
    const resultEl = $('#pkg-import-result');
    if (resultEl) resultEl.textContent = '匯入中…';
    try {
      const data = await api('/api/system/package/import', { method: 'POST', body: fd });
      toast(data.message || '匯入完成', 'success');
      if (resultEl) resultEl.textContent = JSON.stringify(data.result || data, null, 2);
      try {
        await loadUsers(true);
        await loadWorkflows(true);
        await loadSystemSettings();
      } catch {
        /* ignore */
      }
    } catch (err) {
      toast(err.message || '匯入失敗', 'error');
      if (resultEl) resultEl.textContent = err.message || '匯入失敗';
    }
  });
}

// ---------- Boot ----------
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

function showForceChangePassword() {
  const loginForm = $('#login-form');
  if (loginForm) loginForm.classList.add('hidden');
  let form = $('#force-pwd-form');
  if (!form) {
    form = document.createElement('form');
    form.id = 'force-pwd-form';
    form.className = 'auth-form';
    form.innerHTML = `
      <p class="muted" style="margin:0 0 10px">此帳號仍使用系統預設弱密碼，必須先修改才能進入。</p>
      <div class="input-group-icon">
        <span class="input-icon">🔒</span>
        <input name="currentPassword" type="password" autocomplete="current-password" required placeholder="目前密碼" />
      </div>
      <div class="input-group-icon">
        <span class="input-icon">🔑</span>
        <input name="newPassword" type="password" autocomplete="new-password" required minlength="6" placeholder="新密碼（勿用常見密碼）" />
      </div>
      <div class="input-group-icon">
        <span class="input-icon">🔑</span>
        <input name="confirmPassword" type="password" autocomplete="new-password" required minlength="6" placeholder="再輸入一次新密碼" />
      </div>
      <button type="submit" class="btn primary block auth-submit-btn">儲存新密碼並進入</button>
    `;
    loginForm?.parentNode?.insertBefore(form, loginForm.nextSibling);
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const cur = String(fd.get('currentPassword') || '');
      const next = String(fd.get('newPassword') || '');
      const confirm = String(fd.get('confirmPassword') || '');
      const errEl = $('#auth-error');
      if (next !== confirm) {
        if (errEl) {
          errEl.textContent = '兩次新密碼不一致';
          errEl.classList.remove('hidden');
        }
        return;
      }
      try {
        await api('/api/auth/password', {
          method: 'PUT',
          body: { currentPassword: cur, newPassword: next },
        });
        form.classList.add('hidden');
        if (loginForm) loginForm.classList.remove('hidden');
        if (errEl) errEl.classList.add('hidden');
        showMain({ requestPermission: true });
        toast('密碼已更新', 'success');
      } catch (err) {
        if (errEl) {
          errEl.textContent = err.message || '修改失敗';
          errEl.classList.remove('hidden');
        }
      }
    };
  }
  form.classList.remove('hidden');
}

function bindAuthUI() {
  $('#login-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const data = await api('/api/auth/login', {
        method: 'POST',
        body: { username: fd.get('username'), password: fd.get('password') },
      });
      setAuth('1', data.user);
      if (data.mustChangePassword) {
        showForceChangePassword();
        toast('偵測到預設弱密碼，請先修改後再使用系統', 'error');
        return;
      }
      // 登入手勢下請求桌面通知權限
      showMain({ requestPermission: true });
      toast(`歡迎，${data.user.name}`, 'success');
    } catch (err) {
      const el = $('#auth-error');
      el.textContent = err.message;
      el.classList.remove('hidden');
    }
  };

  $$('.nav-item').forEach((el) => {
    el.onclick = () => navigate(el.dataset.page);
  });
  $('#btn-logout').onclick = () => logout();
  document.addEventListener('click', (e) => {
    if (e.target.matches('[data-close-modal]')) closeModal();
  });
  // Email／書籤／重新整理：已登入時 hash 變更導向對應頁
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
      String(route.params?.id || '') === String(state.pageParams?.id || '')
    ) {
      return;
    }
    navigate(route.page, route.params || {});
  });
}

async function boot() {
  initUserTheme();
  // 立刻顯示登入畫面，避免空白頁
  try {
    showAuth();
  } catch (e) {
    console.error('showAuth', e);
  }
  try {
    bindAuthUI();
  } catch (e) {
    console.error('bindAuthUI', e);
  }
  // 登入頁只讀品牌（公司名／Logo／版本）；部門名單需登入後才載
  loadSystemSettings().catch(() => {});
  try {
    localStorage.removeItem('approval_token');
  } catch {
    /* ignore */
  }
  try {
    const me = await api('/api/auth/me');
    if (!me.user) throw new Error('no user');
    setAuth('1', me.user);
    if (me.mustChangePassword) {
      showForceChangePassword();
      return;
    }
    loadDepartmentOptions();
    showMain();
  } catch (e) {
    setAuth('', null);
    showAuth();
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
boot();
