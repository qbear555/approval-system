// 時區必須最先載入：它會設定 process.env.TZ，
// 之後 db 的 datetime('now','localtime') 才會是台灣時間
const tz = require('./tz');
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const {
  normalizeUsername,
  BUILTIN_ADMIN_USERNAME,
  isBuiltinAdminUsername,
  isBuiltinAdminUser,
  hashPassword,
  verifyPassword,
  isWeakPlainPassword,
  hashMatchesWeakPassword,
  generateBootstrapPassword,
  signToken,
  authMiddleware,
  setAuthCookie,
  clearAuthCookie,
  adminOnly,
  builtinAdminOnly,
  JWT_SECRET_SOURCE,
  parseCookies,
} = require('./auth');
const loginRateLimit = require('./login-rate-limit');
const accessControl = require('./access-control');
const {
  generateApprovalPdf,
  writeApprovalPdf,
  buildApprovalPdfFileName,
  buildApprovalZipFileName,
  contentDispositionAttachment,
  getChineseFontPath,
} = require('./pdf');
const archiver = require('archiver');
const { PassThrough } = require('stream');
const {
  runBackupJob,
  listBackups,
  getBackupMeta,
  getBackupById,
  resolveBackupAbsPath,
  backupOneRequest,
  deleteBackup,
  deleteBackups,
  isZipBackup,
} = require('./backup');
const mail = require('./mail');
const lineNotify = require('./line-notify');
const { importPayload } = require('./import-workflows');
const workflowModule = require('./workflow-module');
const flowGraph = require('./flow-graph');
const flowEngineFactory = require('./flow-engine');
const systemPackage = require('./system-package');
const labor = require('./labor');
const leaveReport = require('./leave-report');
const twCalendar = require('./tw-calendar');
const systemSettings = require('./system-settings');
const pdfSign = require('./pdf-sign');
const appVersion = require('./version');
const deployLog = require('./deploy-log');
const onlyoffice = require('./onlyoffice');
const fs = require('fs');
const multer = require('multer');
const crypto = require('crypto');

const runtime = require('./runtime');
const { getClientIp, logAudit } = runtime;

const app = express();
const PORT = process.env.PORT || 3847;
const TRUST_PROXY = /^(1|true|yes)$/i.test(String(process.env.TRUST_PROXY || ''));
const CORS_ORIGINS = String(process.env.CORS_ORIGIN || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// 直連 3847/3848 時勿信任 X-Forwarded-*（否則稽核 IP 可被偽造）
if (TRUST_PROXY) app.set('trust proxy', 1);

if (CORS_ORIGINS.length) {
  app.use(cors({ origin: CORS_ORIGINS, credentials: true }));
}

/** 安全標頭（內網也套用；OnlyOffice 啟用時放行文件伺服器） */
const OO_DOCS_URL = String(process.env.ONLYOFFICE_DOCS_URL || '').replace(/\/$/, '');
function onlyOfficeCspExtras(docsUrl) {
  const out = [];
  const raw = String(docsUrl || '').replace(/\/$/, '');
  if (!raw) return out;
  out.push(raw);
  try {
    const u = new URL(raw);
    out.push(`ws://${u.host}`, `wss://${u.host}`);
  } catch {
    /* ignore */
  }
  return out;
}
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // Document Server 自己的 HTML／JS 不能套簽核 CSP（缺 unsafe-eval／wasm 會空白）
  if (onlyoffice.isEnabled() && onlyoffice.isDocsProxyPath(req.url || req.path)) {
    return next();
  }
  const extras = onlyOfficeCspExtras(OO_DOCS_URL);
  const extra = extras.length ? ` ${extras.join(' ')}` : '';
  // OnlyOffice 編輯器（iframe／Worker）會 new Function；父頁同源時會套這條 CSP
  const ooScript = " 'unsafe-eval' 'wasm-unsafe-eval' blob:";
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${ooScript}${extra}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data: blob:",
      `connect-src 'self' blob:${extra}`,
      `frame-src 'self' blob:${extra}`,
      `child-src 'self' blob:${extra}`,
      `worker-src 'self' blob:${extra}`,
      // Chrome 內建 PDF 檢視器用 object／embed；'none' 會顯示「此內容已被封鎖」
      `object-src 'self' blob:${extra}`,
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ')
  );
  // PDF／ZIP 本身若帶 CSP，Chrome 開啟檔案時也會封鎖內建檢視器
  const origSetHeader = res.setHeader.bind(res);
  res.setHeader = function setHeaderPatched(name, value) {
    if (
      String(name).toLowerCase() === 'content-type' &&
      /application\/(pdf|zip)\b/i.test(String(value || ''))
    ) {
      res.removeHeader('Content-Security-Policy');
    }
    return origSetHeader(name, value);
  };
  next();
});
// OnlyOffice 靜態資源同源代理（須在 static 之前，避免 HTTPS 混合內容）
app.use(onlyoffice.createDocsProxy());

/** LINE Webhook 轉送（不走 /api，避免內網限制；須保留 raw body 驗簽） */
app.get('/line/webhook', (_req, res) => {
  res.json({
    ok: true,
    service: 'approval-line-webhook-proxy',
    hint: 'LINE Developers 的 Webhook URL 請填：https://你的公網主機:3848/line/webhook',
  });
});
app.post('/line/webhook', express.raw({ type: '*/*', limit: '2mb' }), async (req, res) => {
  try {
    const cfg = lineNotify.loadConfig();
    const base = String(cfg.serviceUrl || 'http://127.0.0.1:3850').replace(/\/$/, '');
    const headers = { ...req.headers };
    delete headers.host;
    delete headers['content-length'];
    const r = await fetch(`${base}/webhook`, {
      method: 'POST',
      headers,
      body: req.body,
    });
    const buf = Buffer.from(await r.arrayBuffer());
    res.status(r.status);
    const ct = r.headers.get('content-type');
    if (ct) res.setHeader('Content-Type', ct);
    res.send(buf);
  } catch (e) {
    console.error('[line-webhook-proxy]', e.message);
    res.status(502).json({ error: '無法轉送 LINE Webhook' });
  }
});

app.use(express.json({ limit: '2mb' }));

/** 探活（無需登入；勿改打業務 API） */
app.get(['/health', '/api/health'], (req, res) => {
  try {
    db.prepare('SELECT 1 AS ok').get();
    res.json({ ok: true, status: 'ok' });
  } catch (e) {
    res.status(503).json({ ok: false, status: 'db_error' });
  }
});

/** 內網限制：探活／品牌／Logo 除外 */
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();
  if (
    req.path === '/api/health' ||
    req.path === '/api/system/branding' ||
    req.path === '/api/system/logo' ||
    // Document Server 用 token 抓檔／回存，來源是 docker 網段
    req.path.startsWith('/api/onlyoffice/file/') ||
    req.path === '/api/onlyoffice/callback'
  ) {
    return next();
  }
  const cfg = systemSettings.getAccessControl();
  if (!cfg.intranetOnly) return next();
  const ip = getClientIp(req);
  if (accessControl.ipAllowed(ip, cfg.loginCidrs)) return next();
  logAudit(req, {
    action_type: 'intranet_blocked',
    category: 'auth',
    description: `拒絕非內網存取（IP：${ip}）`,
  });
  return res.status(403).json({ error: '僅限公司內網存取' });
});

/** 瀏覽器預設請求 /favicon.ico → 使用公司 Logo（自訂或預設 ARGO） */
app.get(['/favicon.ico', '/favicon.png'], (req, res) => {
  try {
    const custom = systemSettings.getLogoFilePath();
    if (custom) return res.sendFile(custom);
  } catch {
    /* fall through */
  }
  res.sendFile(path.join(__dirname, '..', 'public', 'img', 'argo-logo.png'));
});

app.use(
  express.static(path.join(__dirname, '..', 'public'), {
    setHeaders(res, filePath) {
      if (/\.html?$/i.test(filePath)) {
        // 避免快取舊 CSP，OnlyOffice 父頁／Worker 需要最新 script-src
        res.setHeader('Cache-Control', 'no-store');
      }
    },
  })
);

// ---------- helpers ----------

const routeCtx = {
  app, db, fs, path, crypto, express, multer, XLSX: require('xlsx'),
  tz, mail, labor, leaveReport, twCalendar,
  systemSettings, pdfSign, appVersion, deployLog, onlyoffice, systemPackage,
  workflowModule, flowGraph, flowEngine: runtime.flowEngine, importPayload, lineNotify,
  archiver, PassThrough,
  authMiddleware, adminOnly, builtinAdminOnly, lineSettingsOnly: runtime.lineSettingsOnly,
  normalizeUsername, isBuiltinAdminUsername, isBuiltinAdminUser,
  hashPassword, verifyPassword, isWeakPlainPassword, hashMatchesWeakPassword,
  generateBootstrapPassword, signToken, setAuthCookie, clearAuthCookie,
  parseCookies, loginRateLimit, accessControl,
  generateApprovalPdf, writeApprovalPdf, buildApprovalPdfFileName,
  buildApprovalZipFileName, contentDispositionAttachment, getChineseFontPath,
  runBackupJob, listBackups, getBackupMeta, getBackupById, resolveBackupAbsPath,
  backupOneRequest, deleteBackup, deleteBackups, isZipBackup,
  ...runtime,
};
require('./routes/auth')(routeCtx);
require('./routes/users')(routeCtx);
require('./routes/departments')(routeCtx);
require('./routes/system')(routeCtx);
require('./routes/workflows')(routeCtx);
require('./routes/requests')(routeCtx);
require('./routes/attachments')(routeCtx);
require('./routes/actions')(routeCtx);
require('./routes/actions-extra')(routeCtx);
require('./routes/actions-ack')(routeCtx);
require('./routes/pdf-download')(routeCtx);
require('./routes/backups')(routeCtx);
require('./routes/audit')(routeCtx);

// SPA fallback
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error('[http]', err && err.stack ? err.stack : err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: '伺服器錯誤，請稍後再試' });
});

// 同時支援 IPv4 / IPv6；HTTP 預設 3847，HTTPS 預設 3848（entrypoint 產生憑證）
const http = require('http');
const https = require('https');

function listenDual(server, port, label, urls) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.off('error', onError);
      if (err.code === 'EADDRINUSE' || err.code === 'EAFNOSUPPORT') {
        server.listen(Number(port), '0.0.0.0', () => {
          console.log(`${label} (IPv4):`);
          for (const u of urls) console.log(`  ${u}`);
          resolve('ipv4');
        });
        server.once('error', reject);
      } else {
        reject(err);
      }
    };
    server.once('error', onError);
    server.listen({ port: Number(port), host: '::', ipv6Only: false }, () => {
      server.off('error', onError);
      console.log(`${label}:`);
      for (const u of urls) console.log(`  ${u}`);
      resolve('dual');
    });
  });
}

const server = http.createServer(app);
// OnlyOffice 同源 WebSocket 代理（編輯器 /doc/.../c/ 需要）
try {
  onlyoffice.attachDocsWsProxy(server);
} catch (e) {
  console.warn('[onlyoffice] attachDocsWsProxy failed', e.message);
}
// 台灣辦公日曆：讀快取 + 背景自動更新（每日）
try {
  twCalendar.startAutoRefresh();
} catch (e) {
  console.warn('[tw-calendar] 啟動失敗', e.message);
}

listenDual(server, PORT, '線上簽核系統 HTTP', [
  `http://127.0.0.1:${PORT}/`,
  `http://localhost:${PORT}/`,
])
  .then(() => {
    const ver = appVersion.getVersionInfo();
    console.log(`${ver.banner} 已啟動`);
    console.log(`  版本: ${ver.labelFull || ver.label}`);
    console.log(`  建置: ${ver.build} · 原始檔 ${ver.sourceFiles || 0} 個`);
    console.log(`  JWT: ${JWT_SECRET_SOURCE === 'env' ? '環境變數' : JWT_SECRET_SOURCE === 'file' ? 'data/.jwt-secret' : '本次新產生'}`);
    console.log(`  時間: ${tz.nowStamp()}（台灣時間）`);
    // 主機時區不是 UTC+8 時大聲提醒：資料庫寫入的時間會錯，且只能在啟動前修正
    tz.warnIfHostTzMismatch();
    console.log('內建管理員帳號: Admin（首次安裝請看 data/.admin-bootstrap.txt，並立刻改密）');
    try {
      deployLog.recordOnStartup();
    } catch (e) {
      console.warn('[deploy-log] 記錄失敗', e.message);
    }
  })
  .catch((err) => {
    console.error('[server] HTTP listen error:', err.message);
    process.exit(1);
  });

const HTTPS_PORT = process.env.HTTPS_PORT || '3848';
const SSL_KEY_PATH =
  process.env.SSL_KEY_PATH || path.join(__dirname, '..', 'data', 'certs', 'key.pem');
const SSL_CERT_PATH =
  process.env.SSL_CERT_PATH || path.join(__dirname, '..', 'data', 'certs', 'cert.pem');
const httpsEnabled =
  String(process.env.HTTPS_ENABLED || '1') !== '0' &&
  Number(HTTPS_PORT) > 0 &&
  fs.existsSync(SSL_KEY_PATH) &&
  fs.existsSync(SSL_CERT_PATH);

if (httpsEnabled) {
  try {
    const httpsServer = https.createServer(
      {
        key: fs.readFileSync(SSL_KEY_PATH),
        cert: fs.readFileSync(SSL_CERT_PATH),
      },
      app
    );
    try {
      onlyoffice.attachDocsWsProxy(httpsServer);
    } catch (e) {
      /* optional */
    }
    listenDual(httpsServer, HTTPS_PORT, '線上簽核系統 HTTPS', [
      `https://127.0.0.1:${HTTPS_PORT}/`,
      `https://localhost:${HTTPS_PORT}/`,
    ]).catch((err) => {
      console.error('[server] HTTPS listen error:', err.message);
    });
  } catch (err) {
    console.error('[server] HTTPS 啟動失敗:', err.message);
  }
} else if (String(process.env.HTTPS_ENABLED || '1') !== '0') {
  console.log(
    `[server] 找不到 SSL 憑證（${SSL_CERT_PATH}），略過 HTTPS。` +
      `請用 docker-entrypoint 自動產生，或設定 SSL_KEY_PATH / SSL_CERT_PATH。`
  );
}
