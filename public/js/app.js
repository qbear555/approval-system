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

function getRuntimeEnv() {
  const fromApi = state.systemSettings && state.systemSettings.env;
  if (fromApi) return fromApi;
  const h = String(location.hostname || '').toLowerCase();
  if (h === '192.168.99.220' || h === 'catshome.tw' || h.endsWith('.catshome.tw')) {
    return 'NAS';
  }
  if (h === '127.0.0.1' || h === 'localhost') return '本機';
  return h || '未知';
}

function envBadgeText(verLabel) {
  const env = getRuntimeEnv();
  return verLabel ? `${env} · ${verLabel}` : env;
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
  const env = getRuntimeEnv();
  const badge = envBadgeText(verLabel);
  const envTip = [`環境：${env}`, verTip || verBanner].filter(Boolean).join('\n');
  const authVer = document.getElementById('auth-version');
  if (authVer && badge) {
    authVer.textContent = badge;
    authVer.title = envTip;
  }
  const authVerFoot = document.getElementById('auth-version-foot');
  if (authVerFoot) {
    authVerFoot.textContent = verFull ? `${env} · ${name} ${verFull}` : `${env} · ${name}`;
    authVerFoot.title = envTip;
  }
  const sideVer = document.getElementById('sidebar-version');
  if (sideVer && badge) {
    sideVer.textContent = badge;
    sideVer.title = envTip;
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

// 供後載入的 pages-admin.js / flow-editor.js 使用
window.state = state;
window.$ = $;
window.$$ = $$;
window.FIELD_TYPE_LABEL = FIELD_TYPE_LABEL;
window.WORK_TIME_START = WORK_TIME_START;
window.WORK_TIME_END = WORK_TIME_END;

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
// boot() 改由 pages-admin.js 載入後呼叫，避免管理頁函式尚未定義
