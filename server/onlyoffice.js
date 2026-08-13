/**
 * OnlyOffice Document Server 整合
 * - 線上編輯 Word／Excel 附件，儲存後回寫 request_attachments
 * - 需另起 onlyoffice/documentserver 容器（見 docker-compose）
 *
 * 環境變數：
 *   ONLYOFFICE_ENABLED=1
 *   ONLYOFFICE_DOCS_URL        瀏覽器載入編輯器腳本（對外，例 http://192.168.11.116:8088）
 *   ONLYOFFICE_INTERNAL_URL    後端呼叫 DS（容器內，例 http://onlyoffice）
 *   ONLYOFFICE_APP_URL         DS 下載附件／callback 用（DS 要連得上，例 http://approval-system:3847）
 *   ONLYOFFICE_JWT_SECRET      與 DS JWT_SECRET 相同（建議設定）
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const ROOT = path.join(__dirname, '..');
const UPLOAD_DIR = path.join(ROOT, 'data', 'uploads');

const OFFICE_EXTS = new Set([
  'doc',
  'docx',
  'odt',
  'rtf',
  'txt',
  'xls',
  'xlsx',
  'ods',
  'csv',
  'ppt',
  'pptx',
  'odp',
]);

function envBool(name, def = false) {
  const v = process.env[name];
  if (v == null || v === '') return def;
  return /^(1|true|yes|on)$/i.test(String(v));
}

function getConfig() {
  const enabled = envBool('ONLYOFFICE_ENABLED', false);
  const docsUrl = String(
    process.env.ONLYOFFICE_DOCS_URL || 'http://127.0.0.1:8088'
  ).replace(/\/$/, '');
  const internalUrl = String(
    process.env.ONLYOFFICE_INTERNAL_URL || docsUrl
  ).replace(/\/$/, '');
  // Document Server 連回本系統（下載檔案、callback）
  const appUrl = String(
    process.env.ONLYOFFICE_APP_URL ||
      process.env.PUBLIC_APP_URL ||
      `http://127.0.0.1:${process.env.PORT || 3847}`
  ).replace(/\/$/, '');
  const { JWT_SECRET, isWeakSecret } = require('./auth');
  const ooEnv = String(process.env.ONLYOFFICE_JWT_SECRET || '').trim();
  const jwtSecret = ooEnv && !isWeakSecret(ooEnv) ? ooEnv : JWT_SECRET;
  const jwtEnabled = envBool('ONLYOFFICE_JWT_ENABLED', true);
  return {
    enabled,
    docsUrl,
    internalUrl,
    appUrl,
    jwtSecret,
    jwtEnabled,
  };
}

function isEnabled() {
  return getConfig().enabled;
}

function extOfName(name) {
  const e = path.extname(String(name || '')).replace(/^\./, '').toLowerCase();
  return e;
}

function isOfficeAttachment(att) {
  if (!att) return false;
  const ext = extOfName(att.original_name || att.stored_name || '');
  if (OFFICE_EXTS.has(ext)) return true;
  const mime = String(att.mime_type || '').toLowerCase();
  return (
    mime.includes('word') ||
    mime.includes('excel') ||
    mime.includes('spreadsheet') ||
    mime.includes('msword') ||
    mime.includes('officedocument')
  );
}

function documentTypeForExt(ext) {
  const e = String(ext || '').toLowerCase();
  if (['xls', 'xlsx', 'ods', 'csv'].includes(e)) return 'cell';
  if (['ppt', 'pptx', 'odp'].includes(e)) return 'slide';
  return 'word';
}

function signFileToken(payload, ttlSec = 3600) {
  const cfg = getConfig();
  return jwt.sign(
    { ...payload, purpose: 'onlyoffice-file' },
    cfg.jwtSecret,
    { expiresIn: ttlSec }
  );
}

function verifyFileToken(token) {
  const cfg = getConfig();
  const data = jwt.verify(token, cfg.jwtSecret);
  if (data.purpose !== 'onlyoffice-file') throw new Error('invalid token purpose');
  return data;
}

function signCallbackToken(payload, ttlSec = 86400) {
  const cfg = getConfig();
  return jwt.sign(
    { ...payload, purpose: 'onlyoffice-cb' },
    cfg.jwtSecret,
    { expiresIn: ttlSec }
  );
}

function verifyCallbackToken(token) {
  const cfg = getConfig();
  const data = jwt.verify(token, cfg.jwtSecret);
  if (data.purpose !== 'onlyoffice-cb') throw new Error('invalid token purpose');
  return data;
}

/** OnlyOffice 編輯器設定用 JWT（整包 config） */
function signEditorConfig(configObj) {
  const cfg = getConfig();
  if (!cfg.jwtEnabled) return null;
  return jwt.sign(configObj, cfg.jwtSecret);
}

/**
 * 產生文件 key：同一檔內容相同則 key 可穩定；改檔後必須變
 * OnlyOffice 限制長度與字元
 */
function documentKey(att) {
  const raw = `${att.id}_${att.stored_name}_${att.size_bytes || 0}_${att.created_at || ''}`;
  return crypto.createHash('md5').update(raw).digest('hex').slice(0, 20);
}

/**
 * 瀏覽器端 Document Server 根網址。
 * HTTPS 簽核頁若載入 http://…:8088 腳本會被「混合內容」封鎖，
 * 預設改走同源代理（/web-apps 等由本機轉發到 onlyoffice 容器）。
 */
function publicDocsBase(req) {
  const cfg = getConfig();
  if (!cfg.enabled) return null;
  const forceSame = envBool('ONLYOFFICE_SAME_ORIGIN', true);
  if (!req || !forceSame) return cfg.docsUrl;

  const xfProto = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim();
  const proto = xfProto || req.protocol || 'http';
  // 優先完整 Host（含埠）；nginx 若用 $host 會省略非標準埠
  let host = String(
    req.headers['x-forwarded-host'] || req.headers.host || ''
  )
    .split(',')[0]
    .trim();
  if (!host) return cfg.docsUrl;

  // 補上 X-Forwarded-Port（例：host=192.168.11.116、port=3847）
  if (!/:\d+$/.test(host) && host.indexOf(']') === -1) {
    const xfPort = String(req.headers['x-forwarded-port'] || '')
      .split(',')[0]
      .trim();
    const reqHost = String(req.headers.host || '').trim();
    const portFromHost = (reqHost.match(/:(\d+)$/) || [])[1];
    const port = xfPort || portFromHost;
    const defaultPort = proto === 'https' ? '443' : '80';
    if (port && port !== defaultPort) {
      host = `${host}:${port}`;
    }
  }

  // HTTPS 簽核頁必須同源，否則混合內容會擋腳本
  if (proto === 'https') return `${proto}://${host}`;
  // HTTP 可直連 Document Server（略過代理）
  return cfg.docsUrl;
}

function publicStatus(req) {
  const cfg = getConfig();
  const docsUrl = publicDocsBase(req);
  return {
    enabled: cfg.enabled,
    docsUrl: cfg.enabled ? docsUrl : null,
    jwtEnabled: cfg.jwtEnabled,
    supported: [...OFFICE_EXTS],
    sameOriginProxy: envBool('ONLYOFFICE_SAME_ORIGIN', true),
  };
}

/** Document Server 靜態／即時通訊路徑（同源代理用） */
function isDocsProxyPath(urlPath) {
  // 去掉 querystring
  const raw = String(urlPath || '').split('?')[0];
  // OnlyOffice 8.x 會在路徑前加版本碼，例如 /8.2.3-abc123/web-apps/...
  // 編輯器還會連 WebSocket：/8.2.3-xxx/doc/{key}/c/?EIO=4&transport=websocket
  const p = raw.replace(/^\/\d+\.\d+\.\d+-[a-f0-9]+(?=\/)/i, '');
  if (/^\/\d+\.\d+\.\d+-[a-f0-9]+$/i.test(raw)) return true;
  return (
    p.startsWith('/web-apps') ||
    p.startsWith('/cache') ||
    p.startsWith('/sdkjs') ||
    p.startsWith('/fonts') ||
    p.startsWith('/common') ||
    p.startsWith('/downloadas') ||
    p.startsWith('/coauthoring') ||
    p.startsWith('/docbuilder') ||
    p.startsWith('/welcome') ||
    p.startsWith('/office-online') ||
    p.startsWith('/products') ||
    p.startsWith('/example') ||
    p.startsWith('/doc/') ||
    p === '/doc' ||
    p.startsWith('/info') ||
    p.startsWith('/7.') ||
    p === '/healthcheck' ||
    p.startsWith('/healthcheck')
  );
}

/**
 * 將 /web-apps 等請求轉發到 ONLYOFFICE_INTERNAL_URL（避免 HTTPS 混合內容）
 */
function createDocsProxy() {
  const http = require('http');
  const https = require('https');
  return function onlyOfficeDocsProxy(req, res, next) {
    if (!isEnabled() || !isDocsProxyPath(req.url)) return next();
    const cfg = getConfig();
    let target;
    try {
      target = new URL(cfg.internalUrl || cfg.docsUrl);
    } catch {
      return next();
    }
    const lib = target.protocol === 'https:' ? https : http;
    const pubHost = String(
      req.headers['x-forwarded-host'] || req.headers.host || ''
    ).trim();
    const xfProto = String(req.headers['x-forwarded-proto'] || '')
      .split(',')[0]
      .trim();
    const pubProto = xfProto || req.protocol || 'http';

    const headers = { ...req.headers, host: target.host };
    // 讓 Document Server 產生對外可用的網址（勿把 onlyoffice 內網主機名丟給瀏覽器）
    if (pubHost) {
      headers['x-forwarded-host'] = pubHost;
      headers['x-forwarded-proto'] = pubProto;
      headers['x-forwarded-for'] =
        req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '';
    }
    // 避免壓縮差異導致串流問題
    delete headers['accept-encoding'];
    const opts = {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      path: req.url,
      method: req.method,
      headers,
      timeout: 120000,
    };
    const p = lib.request(opts, (upstream) => {
      const out = { ...upstream.headers };
      // 不要把 upstream 的 connection 掛死
      delete out.connection;
      delete out['transfer-encoding'];
      // 改寫 Location: http://onlyoffice/... → https://catshome.tw:3848/...
      const locKey = out.location ? 'location' : out.Location ? 'Location' : null;
      if (locKey && out[locKey] && pubHost) {
        try {
          const loc = new URL(String(out[locKey]), target);
          const internalHosts = new Set([
            target.hostname,
            'onlyoffice',
            'localhost',
            '127.0.0.1',
          ]);
          if (internalHosts.has(loc.hostname)) {
            out[locKey] = `${pubProto}://${pubHost}${loc.pathname}${loc.search}${loc.hash}`;
          }
        } catch {
          /* keep original */
        }
      }
      res.writeHead(upstream.statusCode || 502, out);
      upstream.pipe(res);
    });
    p.on('error', (e) => {
      console.error('[onlyoffice proxy]', e.message);
      if (!res.headersSent) {
        res.status(502).type('text/plain').send('OnlyOffice Document Server 無法連線');
      } else {
        res.end();
      }
    });
    p.on('timeout', () => {
      p.destroy();
      if (!res.headersSent) res.status(504).end('OnlyOffice proxy timeout');
    });
    req.pipe(p);
  };
}

/**
 * 將 OnlyOffice WebSocket（wss://簽核主機/.../doc/.../c/）轉發到 Document Server
 * 必須掛在 http.Server / https.Server 的 upgrade 事件上（Express middleware 接不到 WS）
 * @param {import('http').Server|import('https').Server} server
 */
function attachDocsWsProxy(server) {
  if (!server || typeof server.on !== 'function') return;
  if (server.__onlyofficeWsProxyAttached) return;
  server.__onlyofficeWsProxyAttached = true;

  const http = require('http');
  const https = require('https');

  server.on('upgrade', (req, clientSocket, head) => {
    try {
      if (!isEnabled() || !isDocsProxyPath(req.url || '')) {
        // 非 OnlyOffice 路徑：不處理（保留給其他 upgrade 監聽者）
        return;
      }
      const cfg = getConfig();
      let target;
      try {
        target = new URL(cfg.internalUrl || cfg.docsUrl);
      } catch (e) {
        clientSocket.destroy();
        return;
      }
      const lib = target.protocol === 'https:' ? https : http;
      const pubHost = String(
        req.headers['x-forwarded-host'] || req.headers.host || ''
      ).trim();
      const xfProto = String(req.headers['x-forwarded-proto'] || '')
        .split(',')[0]
        .trim();
      // 對外是 wss → 告訴後端曾經過 TLS 終結
      const pubProto =
        xfProto ||
        (req.socket && req.socket.encrypted ? 'https' : 'http');

      const headers = { ...req.headers, host: target.host };
      if (pubHost) {
        headers['x-forwarded-host'] = pubHost;
        headers['x-forwarded-proto'] = pubProto;
      }
      // 轉發 Upgrade 相關標頭
      const opts = {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        path: req.url,
        method: 'GET',
        headers,
        timeout: 120000,
      };

      const proxyReq = lib.request(opts);
      proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
        let headStr = 'HTTP/1.1 101 Switching Protocols\r\n';
        for (const [k, v] of Object.entries(proxyRes.headers || {})) {
          if (v == null) continue;
          if (Array.isArray(v)) {
            for (const item of v) headStr += `${k}: ${item}\r\n`;
          } else {
            headStr += `${k}: ${v}\r\n`;
          }
        }
        headStr += '\r\n';
        try {
          clientSocket.write(headStr);
          if (proxyHead && proxyHead.length) proxySocket.write(proxyHead);
          if (head && head.length) clientSocket.write(head);
          proxySocket.pipe(clientSocket);
          clientSocket.pipe(proxySocket);
        } catch (e) {
          try {
            proxySocket.destroy();
          } catch {
            /* ignore */
          }
          try {
            clientSocket.destroy();
          } catch {
            /* ignore */
          }
          return;
        }
        proxySocket.on('error', () => {
          try {
            clientSocket.destroy();
          } catch {
            /* ignore */
          }
        });
        clientSocket.on('error', () => {
          try {
            proxySocket.destroy();
          } catch {
            /* ignore */
          }
        });
      });
      proxyReq.on('error', (e) => {
        console.error('[onlyoffice ws proxy]', e.message);
        try {
          clientSocket.write('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
        } catch {
          /* ignore */
        }
        try {
          clientSocket.destroy();
        } catch {
          /* ignore */
        }
      });
      proxyReq.on('timeout', () => {
        proxyReq.destroy();
        try {
          clientSocket.destroy();
        } catch {
          /* ignore */
        }
      });
      proxyReq.end();
    } catch (e) {
      console.error('[onlyoffice ws proxy] unexpected', e.message);
      try {
        clientSocket.destroy();
      } catch {
        /* ignore */
      }
    }
  });
}

/**
 * 建立編輯器設定
 * @param {object} opts
 * @param {object} opts.att attachment row
 * @param {object} opts.user { id, name }
 * @param {boolean} opts.canEdit
 * @param {number} opts.requestId
 * @param {import('express').Request} [opts.req] 用於同源 docsUrl
 */
function buildEditorConfig({ att, user, canEdit, requestId, req }) {
  const cfg = getConfig();
  if (!cfg.enabled) throw new Error('OnlyOffice 未啟用');
  if (!isOfficeAttachment(att)) {
    throw new Error('此附件類型不支援線上編輯（請使用 Word／Excel）');
  }
  const docsUrl = publicDocsBase(req) || cfg.docsUrl;
  const ext = extOfName(att.original_name || att.stored_name) || 'docx';
  const fileToken = signFileToken(
    {
      attachmentId: Number(att.id),
      requestId: Number(requestId),
      userId: Number(user.id),
    },
    2 * 3600
  );
  const cbToken = signCallbackToken(
    {
      attachmentId: Number(att.id),
      requestId: Number(requestId),
      userId: Number(user.id),
    },
    24 * 3600
  );

  const fileUrl = `${cfg.appUrl}/api/onlyoffice/file/${encodeURIComponent(fileToken)}`;
  const callbackUrl = `${cfg.appUrl}/api/onlyoffice/callback?token=${encodeURIComponent(cbToken)}`;

  const mode = canEdit ? 'edit' : 'view';
  const config = {
    width: '100%',
    height: '100%',
    type: 'desktop',
    documentType: documentTypeForExt(ext),
    document: {
      fileType: ext,
      key: documentKey(att),
      title: att.original_name || `file.${ext}`,
      url: fileUrl,
      permissions: {
        edit: !!canEdit,
        download: true,
        print: true,
        review: !!canEdit,
        comment: !!canEdit,
      },
    },
    editorConfig: {
      mode,
      lang: 'zh-TW',
      callbackUrl: canEdit ? callbackUrl : undefined,
      user: {
        id: String(user.id),
        name: String(user.name || `user-${user.id}`),
      },
      customization: {
        forcesave: true,
        autosave: true,
        chat: false,
        compactHeader: true,
        feedback: false,
        help: false,
      },
    },
  };

  const token = signEditorConfig(config);
  if (token) config.token = token;

  return {
    config,
    docsApiScript: `${docsUrl}/web-apps/apps/api/documents/api.js`,
    docsUrl,
    mode,
    canEdit: !!canEdit,
    attachmentId: Number(att.id),
    requestId: Number(requestId),
    fileName: att.original_name,
  };
}

/**
 * 處理 OnlyOffice callback body
 * @returns {{ handled: boolean, error?: string }}
 */
async function handleCallback(body, tokenPayload, db) {
  // status: 0 missing, 1 editing, 2 ready save, 3 save error, 4 closed no changes, 6 force save, 7 force save error
  const status = Number(body?.status);
  if (![2, 6].includes(status)) {
    return { handled: true, skipped: true, status };
  }
  const url = body.url || body.changesurl;
  if (!url) {
    return { handled: false, error: 'callback 缺少檔案 url' };
  }

  const attachmentId = Number(tokenPayload.attachmentId);
  const att = db
    .prepare(`SELECT * FROM request_attachments WHERE id = ?`)
    .get(attachmentId);
  if (!att) return { handled: false, error: '找不到附件' };

  // 簽核完成／駁回／取消後禁止回存（防止舊編輯工作階段仍送 callback）
  try {
    const reqRow = db
      .prepare(`SELECT status FROM requests WHERE id = ?`)
      .get(Number(att.request_id));
    const st = String(reqRow?.status || '');
    if (st && st !== 'pending' && st !== 'draft') {
      return {
        handled: true,
        skipped: true,
        status,
        error: `申請單狀態為「${st}」，附件已鎖定不可再編輯`,
      };
    }
  } catch {
    /* ignore status check failures and continue carefully */
  }

  const abs = path.join(UPLOAD_DIR, att.stored_name);
  // 下載編輯後檔案
  const res = await fetch(url);
  if (!res.ok) {
    return { handled: false, error: `下載編輯結果失敗 HTTP ${res.status}` };
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) return { handled: false, error: '編輯結果檔案為空' };

  // 備份舊檔（同目錄 .bak）
  try {
    if (fs.existsSync(abs)) {
      fs.copyFileSync(abs, `${abs}.bak`);
    }
  } catch {
    /* ignore */
  }
  fs.writeFileSync(abs, buf);

  db.prepare(
    `UPDATE request_attachments SET size_bytes = ? WHERE id = ?`
  ).run(buf.length, attachmentId);

  // 觸發 key 變更：更新 created_at 為現在（documentKey 會變）
  try {
    db.prepare(
      `UPDATE request_attachments SET created_at = datetime('now','localtime') WHERE id = ?`
    ).run(attachmentId);
  } catch {
    /* some schemas may not allow — ignore */
  }

  console.log(
    `[onlyoffice] 已回存附件 #${attachmentId} request=${att.request_id} bytes=${buf.length} by user=${tokenPayload.userId}`
  );
  return {
    handled: true,
    saved: true,
    attachmentId,
    size: buf.length,
    status,
  };
}

function resolveAttachmentPath(att) {
  if (!att?.stored_name) return null;
  const abs = path.join(UPLOAD_DIR, att.stored_name);
  if (!fs.existsSync(abs)) return null;
  return abs;
}

module.exports = {
  getConfig,
  isEnabled,
  publicStatus,
  publicDocsBase,
  isDocsProxyPath,
  createDocsProxy,
  attachDocsWsProxy,
  isOfficeAttachment,
  buildEditorConfig,
  verifyFileToken,
  verifyCallbackToken,
  handleCallback,
  resolveAttachmentPath,
  UPLOAD_DIR,
};
