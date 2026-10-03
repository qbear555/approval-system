/**
 * 簽核 Email 提醒（nodemailer）
 * 設定檔：data/mail-config.json
 * 若 SMTP 未就緒但 enabled=true，信件會寫入 data/mail-outbox 供檢查
 */
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'mail-config.json');
const OUTBOX_DIR = path.join(DATA_DIR, 'mail-outbox');

function defaultConfig() {
  return {
    enabled: false,
    host: '',
    port: 587,
    secure: false,
    /** 埠 25 常見為明文 SMTP；true=不升級 TLS（可解 wrong version number） */
    ignoreTLS: false,
    /** 埠 587 建議 true（STARTTLS） */
    requireTLS: false,
    /** 自簽憑證時可 false */
    tlsRejectUnauthorized: true,
    user: '',
    pass: '',
    from: '',
    fromName: '線上簽核系統',
    baseUrl: 'http://127.0.0.1:8080',
  };
}

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(OUTBOX_DIR)) fs.mkdirSync(OUTBOX_DIR, { recursive: true });
}

function loadConfig() {
  ensureDirs();
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      return { ...defaultConfig(), ...raw };
    }
  } catch (e) {
    console.error('load mail config', e.message);
  }
  return defaultConfig();
}

function saveConfig(partial) {
  const cur = loadConfig();
  const next = {
    ...cur,
    ...partial,
  };
  // 空字串密碼表示不變更既有密碼
  if (partial && Object.prototype.hasOwnProperty.call(partial, 'pass')) {
    if (partial.pass === '' || partial.pass == null) {
      next.pass = cur.pass;
    }
  }
  next.port = Number(next.port) || 587;
  next.secure = Boolean(next.secure);
  next.enabled = Boolean(next.enabled);
  // 自動建議：埠 465 → secure；埠 25 → ignoreTLS（若未明確設定）
  if (partial && Object.prototype.hasOwnProperty.call(partial, 'ignoreTLS')) {
    next.ignoreTLS = Boolean(partial.ignoreTLS);
  } else if (next.port === 25 && partial && Object.prototype.hasOwnProperty.call(partial, 'port')) {
    next.ignoreTLS = true;
  } else {
    next.ignoreTLS = Boolean(next.ignoreTLS);
  }
  if (partial && Object.prototype.hasOwnProperty.call(partial, 'requireTLS')) {
    next.requireTLS = Boolean(partial.requireTLS);
  } else if (next.port === 587 && partial && Object.prototype.hasOwnProperty.call(partial, 'port')) {
    next.requireTLS = true;
  } else {
    next.requireTLS = Boolean(next.requireTLS);
  }
  if (partial && Object.prototype.hasOwnProperty.call(partial, 'tlsRejectUnauthorized')) {
    next.tlsRejectUnauthorized = Boolean(partial.tlsRejectUnauthorized);
  } else if (next.tlsRejectUnauthorized === undefined) {
    next.tlsRejectUnauthorized = true;
  }
  if (next.port === 465) next.secure = true;
  next.host = String(next.host || '').trim();
  next.user = String(next.user || '').trim();
  next.from = String(next.from || '').trim();
  next.fromName = String(next.fromName || '線上簽核系統').trim();
  next.baseUrl = String(next.baseUrl || 'http://127.0.0.1:8080').replace(/\/$/, '');
  ensureDirs();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function publicConfig(cfg = loadConfig()) {
  return {
    enabled: Boolean(cfg.enabled),
    host: cfg.host || '',
    port: Number(cfg.port) || 587,
    secure: Boolean(cfg.secure),
    ignoreTLS: Boolean(cfg.ignoreTLS),
    requireTLS: Boolean(cfg.requireTLS),
    tlsRejectUnauthorized: cfg.tlsRejectUnauthorized !== false,
    user: cfg.user || '',
    hasPass: Boolean(cfg.pass),
    from: cfg.from || '',
    fromName: cfg.fromName || '線上簽核系統',
    baseUrl: cfg.baseUrl || 'http://127.0.0.1:8080',
    ready: isSmtpReady(cfg),
  };
}

/** 明顯無效／測試用網域（不會真正送達） */
function isPlaceholderEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e || !e.includes('@')) return true;
  return (
    /@(example\.(com|org|net|local)|test\.local|localhost|invalid|email\.test)$/i.test(e) ||
    e.endsWith('.local')
  );
}

function normalizeRecipients(to) {
  const list = Array.isArray(to)
    ? to.map((t) => String(t || '').trim()).filter(Boolean)
    : [String(to || '').trim()].filter(Boolean);
  const unique = [...new Set(list)];
  const valid = unique.filter((e) => !isPlaceholderEmail(e));
  const skipped = unique.filter((e) => isPlaceholderEmail(e));
  return { valid, skipped };
}

/**
 * 依埠號建立 nodemailer transport
 * - 25：多數內網 SMTP 為明文 → ignoreTLS，避免 wrong version number
 * - 587：STARTTLS
 * - 465：SSL
 */
function createTransport(cfg) {
  const port = Number(cfg.port) || 587;
  let secure = Boolean(cfg.secure);
  if (port === 465) secure = true;
  if (port === 25) secure = false;

  const ignoreTLS =
    cfg.ignoreTLS === true || (port === 25 && cfg.ignoreTLS !== false && !cfg.requireTLS);
  const requireTLS =
    !ignoreTLS && (cfg.requireTLS === true || (port === 587 && cfg.requireTLS !== false));

  const opts = {
    host: String(cfg.host || '').trim(),
    port,
    secure,
    connectionTimeout: 20000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
    tls: {
      // 部分公司 SMTP 憑證不完整
      rejectUnauthorized: cfg.tlsRejectUnauthorized !== false,
      minVersion: 'TLSv1',
    },
  };

  if (ignoreTLS) {
    opts.ignoreTLS = true;
    opts.requireTLS = false;
  } else if (requireTLS) {
    opts.requireTLS = true;
  }

  if (cfg.user) {
    opts.auth = {
      user: String(cfg.user).trim(),
      pass: String(cfg.pass || ''),
    };
  }

  return nodemailer.createTransport(opts);
}

function isSmtpReady(cfg = loadConfig()) {
  return Boolean(cfg.enabled && cfg.host && (cfg.from || cfg.user));
}

function isEnabled(cfg = loadConfig()) {
  return Boolean(cfg.enabled);
}

function fromAddress(cfg) {
  const addr = cfg.from || cfg.user;
  if (!addr) return 'noreply@localhost';
  if (cfg.fromName) return `"${cfg.fromName.replace(/"/g, '')}" <${addr}>`;
  return addr;
}

function writeOutbox({ to, subject, text, html, meta }) {
  ensureDirs();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(OUTBOX_DIR, `${stamp}.json`);
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        to,
        subject,
        text,
        html,
        meta: meta || {},
      },
      null,
      2
    ),
    'utf8'
  );
  return file;
}

async function sendMail({ to, subject, text, html, meta }) {
  const { valid: recipients, skipped: skippedPlaceholders } = normalizeRecipients(to);

  if (!recipients.length) {
    const hint = skippedPlaceholders.length
      ? `（略過測試信箱：${skippedPlaceholders.join(', ')}）`
      : '';
    return {
      ok: false,
      skipped: true,
      error: `無有效收件 Email${hint}。請於成員帳號填寫真實信箱（不可使用 example.local）`,
      skippedPlaceholders,
    };
  }

  const cfg = loadConfig();
  if (!cfg.enabled) {
    return { ok: false, skipped: true, error: 'Email 提醒未啟用（請管理員於帳號設定 → Email 設定）' };
  }

  const payload = {
    to: recipients,
    subject: String(subject || ''),
    text: String(text || ''),
    html: html || undefined,
    meta,
    skippedPlaceholders,
  };

  // 一律寫入 outbox 方便查核
  let outboxFile = '';
  try {
    outboxFile = writeOutbox(payload);
  } catch (e) {
    console.error('mail outbox', e.message);
  }

  if (!isSmtpReady(cfg)) {
    console.warn('[mail] SMTP 未完整設定，僅寫入 outbox:', outboxFile);
    return {
      ok: false,
      skipped: true,
      mode: 'outbox',
      to: recipients,
      outboxFile,
      error: 'SMTP 主機／寄件者未完整設定，信件僅存 data/mail-outbox，未真正寄出',
      warning: 'SMTP 主機／寄件者未完整設定，信件已存到 data/mail-outbox',
    };
  }

  try {
    const transporter = createTransport(cfg);
    const info = await transporter.sendMail({
      from: fromAddress(cfg),
      to: recipients.join(', '),
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
    });

    console.log(
      '[mail] sent',
      info.messageId,
      'to',
      recipients.join(','),
      'accepted',
      info.accepted,
      'rejected',
      info.rejected
    );

    const rejected = info.rejected || [];
    if (rejected.length && (!info.accepted || !info.accepted.length)) {
      return {
        ok: false,
        mode: 'smtp',
        to: recipients,
        error: `SMTP 拒絕收件：${rejected.join(', ')}`,
        messageId: info.messageId,
        outboxFile,
        skippedPlaceholders,
      };
    }

    return {
      ok: true,
      mode: 'smtp',
      to: recipients,
      accepted: info.accepted || recipients,
      rejected,
      messageId: info.messageId,
      response: info.response,
      outboxFile,
      skippedPlaceholders,
      warning:
        skippedPlaceholders.length > 0
          ? `已略過無效信箱：${skippedPlaceholders.join(', ')}`
          : undefined,
    };
  } catch (e) {
    const msg = e.message || String(e);
    console.error('[mail] send failed', msg);
    let hint = '';
    if (/wrong version number|ssl|tls/i.test(msg)) {
      hint =
        '（TLS 協定不符：若使用埠 25 請關閉 SSL、勾選「略過 TLS」；公司信箱常用 587+STARTTLS 或 465+SSL）';
    } else if (/auth|invalid login|credentials/i.test(msg)) {
      hint = '（帳密驗證失敗：請確認 SMTP 帳號為完整 Email，密碼正確）';
    } else if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND/i.test(msg)) {
      hint = '（無法連上 SMTP 主機：請確認主機名稱、埠號與防火牆）';
    }
    return {
      ok: false,
      mode: 'smtp',
      to: recipients,
      error: (msg + hint).slice(0, 500),
      outboxFile,
      skippedPlaceholders,
    };
  }
}

function statusLabel(status) {
  const map = {
    pending: '簽核中',
    approved: '已核准',
    rejected: '已駁回',
    cancelled: '已取消',
    voided: '已作廢',
    draft: '草稿',
  };
  return map[status] || status;
}

function requestLink(cfg, requestId) {
  const base = (cfg.baseUrl || 'http://127.0.0.1:8080').replace(/\/$/, '');
  // 前端 showMain 會解析 #detail/{id}，登入後直達申請詳情（非整頁總覽）
  return `${base}/#detail/${Number(requestId) || 0}`;
}

/**
 * 郵件主旨用：簽核申請名稱 + 申請人
 * 例：「請假申請 · 事假 · 陳子安」
 */
function requestMailIdentity(request) {
  const id = request?.id != null ? Number(request.id) : 0;
  const title = String(request?.title || '').trim();
  const wf = String(request?.workflow_name || '').trim();
  const applicant = String(request?.requester_name || '').trim();
  // 申請名稱：單據主旨優先，否則流程名
  let appName = title || wf || (id ? `簽核單 #${id}` : '簽核申請');
  // 若主旨未含流程名且有流程名，可保留主旨即可（主旨多已含流程類型）
  appName = appName.replace(/\s+/g, ' ').slice(0, 80);
  return {
    appName,
    applicant,
    /** 主旨核心：申請名稱 · 申請人 */
    core: applicant ? `${appName} · ${applicant}` : appName,
  };
}

/** 組合郵件主旨（限制長度，避免部分信箱截斷） */
function buildMailSubject(tag, request, suffix = '') {
  const { core } = requestMailIdentity(request);
  const mid = core;
  const tail = suffix ? ` — ${suffix}` : '';
  return `【${tag}】${mid}${tail}`.slice(0, 180);
}

function buildStatusMail(request, event, actorName, comment) {
  const cfg = loadConfig();
  const link = requestLink(cfg, request.id);
  const { appName, applicant, core } = requestMailIdentity(request);
  const title = appName;
  const eventMap = {
    approved: '您的申請已核准',
    rejected: '您的申請已駁回',
    returned: '您的申請已被退回上一關',
    cancelled: '您的申請已取消',
    voided: '您的申請已作廢',
    step: '您的申請已進入下一簽核步驟',
    submitted: '您的申請已送出',
  };
  const headline = eventMap[event] || '簽核狀態更新';
  // 主旨：【簽核提醒】申請名稱 · 申請人 — 事件
  const subject = buildMailSubject('簽核提醒', request, headline);
  const lines = [
    `您好 ${applicant || ''}，`,
    '',
    headline + '。',
    '',
    `單號：#${request.id}`,
    `申請名稱：${title}`,
    `申請人：${applicant || '—'}`,
    `流程：${request.workflow_name || ''}`,
    `狀態：${statusLabel(request.status)}`,
  ];
  if (actorName) lines.push(`操作人：${actorName}`);
  if (comment) lines.push(`意見：${comment}`);
  if (request.current_step_name) lines.push(`目前步驟：${request.current_step_name}`);
  lines.push('', `請點此直接開啟申請單：${link}`, '', '— 線上簽核系統自動通知 —');
  const text = lines.join('\n');
  const html = `
    <div style="font-family:Microsoft JhengHei,sans-serif;line-height:1.6;color:#0f172a">
      <p>您好 <strong>${escapeHtml(applicant || '')}</strong>，</p>
      <p style="font-size:16px"><strong>${escapeHtml(headline)}</strong></p>
      <table style="border-collapse:collapse;margin:12px 0">
        <tr><td style="padding:4px 12px 4px 0;color:#64748b">單號</td><td>#${request.id}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#64748b">申請名稱</td><td>${escapeHtml(title)}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#64748b">申請人</td><td>${escapeHtml(applicant || '—')}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#64748b">流程</td><td>${escapeHtml(request.workflow_name || '')}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#64748b">狀態</td><td>${escapeHtml(statusLabel(request.status))}</td></tr>
        ${actorName ? `<tr><td style="padding:4px 12px 4px 0;color:#64748b">操作人</td><td>${escapeHtml(actorName)}</td></tr>` : ''}
        ${comment ? `<tr><td style="padding:4px 12px 4px 0;color:#64748b">意見</td><td>${escapeHtml(comment)}</td></tr>` : ''}
      </table>
      <p><a href="${link}" style="display:inline-block;background:#1e3a5f;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">直接開啟申請單</a></p>
      <p style="color:#94a3b8;font-size:12px">點選後將開啟該筆申請詳情（若尚未登入請先登入）。此為系統自動寄送，請勿直接回覆。</p>
    </div>`;
  return { subject, text, html };
}

function buildApproverMail(request, step, kind, fromName) {
  const cfg = loadConfig();
  const link = requestLink(cfg, request.id);
  const { appName, applicant, core } = requestMailIdentity(request);
  const title = appName;
  const stepName = step?.name || '待簽核';
  const isRemind = kind === 'remind';
  const headline = isRemind
    ? `${fromName || '申請人'}提醒您簽核`
    : '您有一筆待簽核申請';
  // 主旨：【待簽核／簽核催辦】申請名稱 · 申請人（步驟）
  const subject = isRemind
    ? buildMailSubject('簽核催辦', request, stepName)
    : buildMailSubject('待簽核', request, stepName);
  const lines = [
    '您好，',
    '',
    headline + '。',
    '',
    `單號：#${request.id}`,
    `申請名稱：${title}`,
    `申請人：${applicant || '—'}${request.requester_dept ? `（${request.requester_dept}）` : ''}`,
    `步驟：${stepName}`,
    `流程：${request.workflow_name || ''}`,
    '',
    `請點此直接開啟申請單並簽核：${link}`,
    '',
    '— 線上簽核系統自動通知 —',
  ];
  const text = lines.join('\n');
  const html = `
    <div style="font-family:Microsoft JhengHei,sans-serif;line-height:1.6;color:#0f172a">
      <p>您好，</p>
      <p style="font-size:16px"><strong>${escapeHtml(headline)}</strong></p>
      <table style="border-collapse:collapse;margin:12px 0">
        <tr><td style="padding:4px 12px 4px 0;color:#64748b">單號</td><td>#${request.id}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#64748b">申請名稱</td><td>${escapeHtml(title)}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#64748b">申請人</td><td>${escapeHtml(applicant || '—')}${
          request.requester_dept
            ? `（${escapeHtml(request.requester_dept)}）`
            : ''
        }</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#64748b">步驟</td><td>${escapeHtml(stepName)}</td></tr>
      </table>
      <p><a href="${link}" style="display:inline-block;background:#1e3a5f;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">直接開啟申請單</a></p>
      <p style="color:#94a3b8;font-size:12px">點選後將開啟該筆申請詳情（若尚未登入請先登入）。此為系統自動寄送，請勿直接回覆。</p>
    </div>`;
  return { subject, text, html };
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 解析申請人 Email 通知偏好
 * notify_prefs_json: { enabled, approved, rejected, step, submitted?, cancelled? }
 * 舊單據僅有 notify_email=0/1 → 全關／全開
 *
 * 注意：getRequestDetail 會把 notify_prefs_json 清掉並改放 notify_prefs，
 * 寄信時必須優先讀 notify_prefs，否則會誤判成「全部事件開啟」。
 */
function parseNotifyPrefs(detail) {
  const masterOff =
    detail?.notify_email === 0 ||
    detail?.notify_email === false ||
    detail?.notify_email === '0';
  if (masterOff) {
    return {
      enabled: false,
      approved: false,
      rejected: false,
      step: false,
      submitted: false,
      cancelled: false,
    };
  }

  let prefs = null;
  // 1) 已解析的物件（getRequestDetail 回傳）
  if (detail?.notify_prefs && typeof detail.notify_prefs === 'object') {
    prefs = detail.notify_prefs;
  } else {
    // 2) 資料庫原始 JSON 字串／物件
    try {
      const raw = detail?.notify_prefs_json;
      if (raw) {
        prefs = typeof raw === 'string' ? JSON.parse(raw || 'null') : raw;
      }
    } catch {
      prefs = null;
    }
  }

  // 無細項設定：notify_email 開啟＝全部事件（相容舊資料）
  if (!prefs || typeof prefs !== 'object') {
    return {
      enabled: true,
      approved: true,
      rejected: true,
      step: true,
      submitted: true,
      cancelled: true,
    };
  }

  // 明確 false 才關；有細項物件時缺漏鍵預設為 false（避免「只勾核准」卻仍通知下一步）
  const hasEventKeys =
    Object.prototype.hasOwnProperty.call(prefs, 'approved') ||
    Object.prototype.hasOwnProperty.call(prefs, 'rejected') ||
    Object.prototype.hasOwnProperty.call(prefs, 'step');

  const on = (k, defaultVal) => {
    const v = prefs[k];
    if (v === true || v === 1 || v === '1' || v === 'true') return true;
    if (v === false || v === 0 || v === '0' || v === 'false') return false;
    return defaultVal;
  };

  const enabled =
    prefs.enabled === false || prefs.enabled === 0 || prefs.enabled === '0'
      ? false
      : true;
  if (!enabled) {
    return {
      enabled: false,
      approved: false,
      rejected: false,
      step: false,
      submitted: false,
      cancelled: false,
    };
  }

  // 有細項鍵時：缺漏＝不通知；完全無細項鍵的舊物件仍預設全開
  const def = hasEventKeys ? false : true;
  return {
    enabled: true,
    approved: on('approved', def),
    rejected: on('rejected', def),
    step: on('step', def),
    submitted: on('submitted', def),
    cancelled: on('cancelled', def),
  };
}

/** 申請人是否要收到此事件的 Email */
function wantsApplicantNotify(detail, event) {
  const p = parseNotifyPrefs(detail);
  if (!p.enabled) return false;
  if (event === 'approved') return p.approved;
  if (event === 'rejected') return p.rejected;
  // 退回上一位：比照「駁回」或「步驟」通知偏好（有開其一即通知）
  if (event === 'returned') return p.rejected || p.step;
  if (event === 'step') return p.step;
  if (event === 'submitted') return p.submitted;
  if (event === 'cancelled') return p.cancelled;
  return true;
}

/**
 * 通知申請人狀態變更
 * @param {object} detail getRequestDetail 結果
 * @param {string} event approved|rejected|cancelled|step|submitted
 */
async function notifyApplicant(detail, event, { actorName, comment } = {}) {
  if (!detail) return { ok: false, skipped: true, error: '無單據' };
  if (!isEnabled()) return { ok: false, skipped: true, error: 'Email 未啟用' };

  if (!wantsApplicantNotify(detail, event)) {
    return {
      ok: false,
      skipped: true,
      error: '申請人未開啟此類 Email 通知',
    };
  }

  const email = detail.requester_email;
  if (!email) {
    return { ok: false, skipped: true, error: '申請人未設定 Email' };
  }

  const mail = buildStatusMail(detail, event, actorName, comment);
  return sendMail({
    to: email,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    meta: { type: 'applicant', event, requestId: detail.id },
  });
}

/**
 * 已核准作廢：一律通知申請人與所有簽核人（忽略申請人通知偏好）
 */
async function notifyVoided(detail, emails, { actorName, reason } = {}) {
  if (!detail) return { ok: false, skipped: true, error: '無單據' };
  if (!isEnabled()) return { ok: false, skipped: true, error: 'Email 未啟用' };

  const list = [
    ...new Set((emails || []).map((e) => String(e || '').trim()).filter(Boolean)),
  ];
  if (!list.length) {
    return { ok: false, skipped: true, error: '無有效收件 Email' };
  }

  const cfg = loadConfig();
  const link = requestLink(cfg, detail.id);
  const { appName, applicant } = requestMailIdentity(detail);
  const headline = '此申請已作廢';
  const subject = buildMailSubject('簽核作廢', detail, headline);
  const lines = [
    '您好，',
    '',
    headline + '。',
    '原已核准之申請因故作廢，簽核歷程仍保留，請假已休將不再計入。',
    '',
    `單號：#${detail.id}`,
    `申請名稱：${appName}`,
    `申請人：${applicant || '—'}`,
    `流程：${detail.workflow_name || ''}`,
    `狀態：${statusLabel('voided')}`,
  ];
  if (actorName) lines.push(`操作人：${actorName}`);
  if (reason) lines.push(`作廢原因：${reason}`);
  lines.push('', `請點此直接開啟申請單：${link}`, '', '— 線上簽核系統自動通知 —');
  const text = lines.join('\n');
  const html = `
    <div style="font-family:Microsoft JhengHei,sans-serif;line-height:1.6;color:#0f172a">
      <p>您好，</p>
      <p style="font-size:16px"><strong>${escapeHtml(headline)}</strong></p>
      <p>原已核准之申請因故作廢，簽核歷程仍保留；若為請假單，已休時數將不再計入。</p>
      <table style="border-collapse:collapse;margin:12px 0">
        <tr><td style="padding:4px 12px 4px 0;color:#64748b">單號</td><td>#${detail.id}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#64748b">申請名稱</td><td>${escapeHtml(appName)}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#64748b">申請人</td><td>${escapeHtml(applicant || '—')}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#64748b">流程</td><td>${escapeHtml(detail.workflow_name || '')}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#64748b">狀態</td><td>${escapeHtml(statusLabel('voided'))}</td></tr>
        ${actorName ? `<tr><td style="padding:4px 12px 4px 0;color:#64748b">操作人</td><td>${escapeHtml(actorName)}</td></tr>` : ''}
        ${reason ? `<tr><td style="padding:4px 12px 4px 0;color:#64748b">作廢原因</td><td>${escapeHtml(reason)}</td></tr>` : ''}
      </table>
      <p><a href="${link}" style="display:inline-block;background:#6b21a8;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">直接開啟申請單</a></p>
      <p style="color:#94a3b8;font-size:12px">點選後將開啟該筆申請詳情（若尚未登入請先登入）。此為系統自動寄送，請勿直接回覆。</p>
    </div>`;
  return sendMail({
    to: list,
    subject,
    text,
    html,
    meta: { type: 'voided', event: 'voided', requestId: detail.id },
  });
}

/**
 * 通知目前步驟簽核人（新進件或進入下一步）
 */
async function notifyStepApprovers(detail, step, kind = 'pending', fromName = '') {
  if (!detail || !step) return { ok: false, skipped: true, error: '無步驟' };
  if (!isEnabled()) return { ok: false, skipped: true, error: 'Email 未啟用' };

  const ids = Array.isArray(step.approverIds) ? step.approverIds : [];
  if (!ids.length) return { ok: false, skipped: true, error: '此步驟無簽核人' };

  // 由呼叫端傳入 emails 或這裡不查 DB — 呼叫端傳 toEmails 較單純
  return { ok: false, skipped: true, error: 'use notifyUsers' };
}

async function sendApproverMails(detail, step, emails, kind, fromName) {
  if (!isEnabled()) return { ok: false, skipped: true, error: 'Email 未啟用' };
  const list = [...new Set((emails || []).map((e) => String(e || '').trim()).filter(Boolean))];
  if (!list.length) {
    return { ok: false, skipped: true, error: '簽核人皆未設定 Email' };
  }
  const mail = buildApproverMail(detail, step, kind, fromName);
  return sendMail({
    to: list,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    meta: { type: kind === 'remind' ? 'remind' : 'approver', requestId: detail.id, step: step?.order },
  });
}

/**
 * 副本／最終核准完成通知
 * - 信用額度：總經理核定後通知財務
 * - 流程模組 finalNotify：最終一步核准後通知選定人員
 * - 建檔完成：通知申請人
 */
async function sendCcNotice({
  to,
  toName,
  request,
  deptName = '財務部',
  actorName = '',
  kind = 'final_approved',
}) {
  if (!request) return { ok: false, skipped: true, error: '無單據' };
  if (!isEnabled()) return { ok: false, skipped: true, error: 'Email 未啟用' };
  const cfg = loadConfig();
  const { appName, applicant, core } = requestMailIdentity(request);
  const title = appName;
  const reqName = applicant || '申請人';
  const base = cfg.baseUrl || 'http://127.0.0.1:3847';
  const url = `${base}/#/detail/${request.id}`;
  const actorLabel = actorName || '總經理';
  const noticeLabel = deptName || '最終核准完成通知';

  // 主旨：【最終核准通知】申請名稱 · 申請人 — 已核准
  const subject = buildMailSubject('最終核准通知', request, '已核准');
  const text = `您好 ${toName || ''}：\n\n「${title}」（申請人：${reqName}，單號 #${request.id}）已由${actorLabel}核定通過，系統依流程設定通知您（${noticeLabel}）。\n\n申請名稱：${title}\n申請人：${reqName}\n核定完成，單據狀態：已核准\n\n查看單據詳情與下載 PDF：\n${url}\n`;
  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
      <h2 style="color: #0f766e; margin-top: 0;">✅ 最終核准完成通知</h2>
      <p>您好 <strong>${escapeHtml(toName || '')}</strong>：</p>
      <p>「<strong>${escapeHtml(title)}</strong>」（申請人：${escapeHtml(reqName)}，單號 #${request.id}）已由<strong>${escapeHtml(actorLabel)}</strong>核定通過！</p>
      <div style="background-color: #f8fafc; padding: 15px; border-left: 4px solid #0f766e; margin: 15px 0;">
        <p style="margin: 5px 0;"><strong>申請名稱：</strong> ${escapeHtml(title)}</p>
        <p style="margin: 5px 0;"><strong>申請人：</strong> ${escapeHtml(reqName)}</p>
        <p style="margin: 5px 0;"><strong>通知對象說明：</strong> ${escapeHtml(noticeLabel)}</p>
        <p style="margin: 5px 0;"><strong>最新狀態：</strong> <span style="color: #16a34a; font-weight: bold;">已核准</span></p>
      </div>
      <p>此通知依簽核流程模組設定自動寄送。您可點擊下方連結查看詳情與下載簽署 PDF：</p>
      <p style="margin-top: 20px;">
        <a href="${url}" style="background-color: #0f766e; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">開啟簽核單據詳情</a>
      </p>
    </div>
  `;

  return sendMail({
    to,
    subject,
    text,
    html,
    meta: { type: kind || 'cc', deptName: noticeLabel, requestId: request.id },
  });
}

module.exports = {
  loadConfig,
  saveConfig,
  publicConfig,
  isSmtpReady,
  isEnabled,
  sendMail,
  notifyApplicant,
  notifyVoided,
  sendApproverMails,
  sendCcNotice,
  statusLabel,
  isPlaceholderEmail,
  createTransport,
  parseNotifyPrefs,
  wantsApplicantNotify,
};
