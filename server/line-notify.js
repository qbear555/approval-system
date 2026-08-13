/**
 * LINE 通知（呼叫獨立服務 D:\Line 專案 /api/push）
 * 設定檔：data/line-config.json（執行期，不進一鍵安裝包）
 */
const tz = require('./tz');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'line-config.json');

/** configAccess: builtin_admin | any_admin | permission */
const DEFAULTS = {
  enabled: false,
  serviceUrl: 'http://127.0.0.1:3850',
  apiKey: '',
  configAccess: 'builtin_admin',
  events: {
    pending: true,
    submitted: true,
    approved: true,
    rejected: true,
    step: true,
    remind: true,
  },
  updatedAt: null,
};

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadConfig() {
  ensureDir();
  try {
    if (!fs.existsSync(CONFIG_PATH)) return { ...DEFAULTS, events: { ...DEFAULTS.events } };
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8').replace(/^\uFEFF/, ''));
    const events = { ...DEFAULTS.events, ...(raw.events || {}) };
    let access = String(raw.configAccess || DEFAULTS.configAccess);
    if (!['builtin_admin', 'any_admin', 'permission'].includes(access)) {
      access = DEFAULTS.configAccess;
    }
    return {
      enabled: !!raw.enabled,
      serviceUrl: String(raw.serviceUrl || DEFAULTS.serviceUrl).replace(/\/$/, ''),
      apiKey: raw.apiKey != null ? String(raw.apiKey) : '',
      configAccess: access,
      events,
      updatedAt: raw.updatedAt || null,
    };
  } catch {
    return { ...DEFAULTS, events: { ...DEFAULTS.events } };
  }
}

function saveConfig(partial = {}) {
  const cur = loadConfig();
  const next = { ...cur, ...partial };
  if (partial.events && typeof partial.events === 'object') {
    next.events = { ...cur.events, ...partial.events };
  }
  if (partial.apiKey === '' || partial.apiKey == null) {
    if (Object.prototype.hasOwnProperty.call(partial, 'apiKey')) {
      // 明確傳空字串＝不變更（與 mail 一致）
      if (partial.apiKey === '') next.apiKey = cur.apiKey;
    }
  }
  if (partial.serviceUrl != null) {
    next.serviceUrl = String(partial.serviceUrl).trim().replace(/\/$/, '') || DEFAULTS.serviceUrl;
  }
  let access = String(next.configAccess || DEFAULTS.configAccess);
  if (!['builtin_admin', 'any_admin', 'permission'].includes(access)) {
    access = DEFAULTS.configAccess;
  }
  next.configAccess = access;
  next.enabled = !!next.enabled;
  next.updatedAt = tz.nowIso();
  ensureDir();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function publicConfig(cfg = loadConfig()) {
  return {
    enabled: !!cfg.enabled,
    serviceUrl: cfg.serviceUrl || DEFAULTS.serviceUrl,
    hasApiKey: Boolean(cfg.apiKey),
    configAccess: cfg.configAccess || DEFAULTS.configAccess,
    events: { ...DEFAULTS.events, ...(cfg.events || {}) },
    ready: isReady(cfg),
    updatedAt: cfg.updatedAt || null,
  };
}

function isReady(cfg = loadConfig()) {
  return !!(cfg.enabled && cfg.serviceUrl && cfg.apiKey);
}

function isEnabled(cfg = loadConfig()) {
  return isReady(cfg);
}

function eventOn(event, cfg = loadConfig()) {
  if (!isReady(cfg)) return false;
  const e = cfg.events || DEFAULTS.events;
  if (Object.prototype.hasOwnProperty.call(e, event)) return !!e[event];
  return true;
}

/**
 * @param {object} opts
 * @param {string} [opts.username]
 * @param {string} [opts.lineUserId]
 * @param {string} [opts.text]
 * @param {object} [opts.approval]
 * @param {Array} [opts.messages]
 */
async function push(opts = {}) {
  const cfg = loadConfig();
  if (!isReady(cfg)) {
    return { ok: false, skipped: true, error: 'LINE 通知未啟用或設定不完整' };
  }
  const url = `${cfg.serviceUrl}/api/push`;
  const body = {};
  if (opts.username) body.username = opts.username;
  if (opts.lineUserId) body.lineUserId = opts.lineUserId;
  if (opts.text) body.text = opts.text;
  if (opts.approval) body.approval = opts.approval;
  if (opts.messages) body.messages = opts.messages;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': cfg.apiKey,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        error: data.error || `LINE 服務回應 ${res.status}`,
        code: data.code,
        status: res.status,
      };
    }
    return { ok: true, ...data };
  } catch (e) {
    return { ok: false, error: e.message || '無法連線 LINE 通知服務' };
  }
}

function fireAndForget(label, promise) {
  Promise.resolve(promise)
    .then((r) => {
      if (r && r.ok === false && !r.skipped) {
        console.warn('[line]', label, r.error || r);
      } else {
        console.log('[line]', label, r?.ok ? 'ok' : r);
      }
    })
    .catch((e) => console.error('[line]', label, e.message));
}

function statusLabel(status) {
  const map = {
    pending: '簽核中',
    approved: '已核准',
    rejected: '已駁回',
    cancelled: '已取消',
  };
  return map[status] || status || '';
}

/**
 * @param {function} getUsernameById (id) => username|null
 */
function notifyApplicantLine(detail, event, { actorName, comment, baseUrl, getUsernameById } = {}) {
  if (!eventOn(event === 'submitted' ? 'submitted' : event)) {
    return Promise.resolve({ ok: false, skipped: true, error: '事件未啟用' });
  }
  const uid = detail?.requester_id;
  const username =
    (typeof getUsernameById === 'function' && uid ? getUsernameById(uid) : null) ||
    detail?.requester_username ||
    null;
  if (!username) {
    return Promise.resolve({ ok: false, skipped: true, error: '無申請人帳號' });
  }
  const titleMap = {
    submitted: '申請已送出',
    approved: '申請已核准',
    rejected: '申請已駁回',
    step: '簽核進度更新',
    cancelled: '申請已取消',
  };
  const cfg = loadConfig();
  const link = (cfg.serviceUrl && baseUrl) || baseUrl || '';
  return push({
    username,
    approval: {
      event,
      title: titleMap[event] || '簽核通知',
      requester: detail.requester_name || '',
      workflow: detail.workflow_name || detail.title || '',
      status: statusLabel(detail.status),
      detailUrl: link,
      extra: [actorName ? `處理人：${actorName}` : '', comment ? `意見：${comment}` : '']
        .filter(Boolean)
        .join('\n'),
    },
  });
}

/**
 * 通知簽核人（依 username 列表）
 */
function notifyApproversLine(detail, usernames, kind, { actorName, baseUrl } = {}) {
  const eventKey = kind === 'remind' ? 'remind' : 'pending';
  if (!eventOn(eventKey)) {
    return Promise.resolve({ ok: false, skipped: true, error: '事件未啟用' });
  }
  const list = (usernames || []).map(String).filter(Boolean);
  if (!list.length) {
    return Promise.resolve({ ok: false, skipped: true, error: '無簽核人' });
  }
  const cfg = loadConfig();
  const link = baseUrl || '';
  const title = kind === 'remind' ? '簽核催辦' : '待您簽核';
  return Promise.all(
    list.map((username) =>
      push({
        username,
        approval: {
          event: eventKey,
          title,
          requester: detail.requester_name || '',
          workflow: detail.workflow_name || detail.title || '',
          status: '待您簽核',
          detailUrl: link,
          extra: actorName ? `來自：${actorName}` : '',
        },
      })
    )
  ).then((results) => {
    const ok = results.some((r) => r && r.ok);
    const errors = results.filter((r) => r && !r.ok && !r.skipped).map((r) => r.error);
    return { ok, results, error: errors[0] };
  });
}

async function testPush({ username, lineUserId, text }) {
  return push({
    username,
    lineUserId,
    text: text || `【測試】線上簽核 LINE 通知 ${new Date().toLocaleString('zh-TW')}`,
  });
}

async function unbindUsername(username) {
  const cfg = loadConfig();
  if (!cfg.serviceUrl || !cfg.apiKey) {
    return { ok: false, error: '尚未設定 LINE 服務' };
  }
  const u = String(username || '').trim();
  if (!u) return { ok: false, error: '請指定簽核帳號' };
  try {
    const res = await fetch(`${cfg.serviceUrl}/api/bind/${encodeURIComponent(u)}`, {
      method: 'DELETE',
      headers: { 'X-Api-Key': cfg.apiKey },
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 404) return { ok: false, error: '此帳號尚未綁定 LINE' };
    if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    return { ok: true, binding: data.binding || null };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function fetchBindings() {
  const cfg = loadConfig();
  if (!cfg.serviceUrl || !cfg.apiKey) {
    return { ok: false, error: '尚未設定 LINE 服務' };
  }
  try {
    const res = await fetch(`${cfg.serviceUrl}/api/bindings`, {
      headers: { 'X-Api-Key': cfg.apiKey },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    return { ok: true, bindings: data.bindings || [] };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function healthCheck() {
  const cfg = loadConfig();
  if (!cfg.serviceUrl) return { ok: false, error: '未設定服務網址' };
  try {
    const res = await fetch(`${cfg.serviceUrl}/health`);
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = {
  DEFAULTS,
  loadConfig,
  saveConfig,
  publicConfig,
  isReady,
  isEnabled,
  eventOn,
  push,
  fireAndForget,
  notifyApplicantLine,
  notifyApproversLine,
  testPush,
  fetchBindings,
  unbindUsername,
  healthCheck,
};
