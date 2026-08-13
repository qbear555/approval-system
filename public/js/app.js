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
        const msg = `新增 ${added} 件待簽核，目前共 ${count} 件`;
        showDesktopNotification('線上簽核系統 · 新待簽核', msg, () => navigate('inbox'));
        toast(msg, 'info');
        if (!isModalOpen()) {
          openModal(`
            <h3 style="margin-top:0">📬 新待簽核</h3>
            <p>${esc(msg)}。請回公司後儘速處理。</p>
            <div class="form-actions">
              <button type="button" class="btn primary" id="btn-goto-inbox">前往待簽核</button>
              <button type="button" class="btn outline" data-close-modal>稍後</button>
            </div>
          `);
          $('#btn-goto-inbox')?.addEventListener('click', () => {
            closeModal();
            navigate('inbox');
          });
        }
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

function isModalOpen() {
  const modal = $('#modal');
  return !!(modal && !modal.classList.contains('hidden') && ($('#modal-panel')?.innerHTML || '').trim());
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
// 供後載入的 pages-settings.js / flow-editor.js 使用
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
// boot() 改由 pages-settings.js 載入後呼叫，避免管理頁函式尚未定義
