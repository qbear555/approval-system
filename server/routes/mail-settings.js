/**
 * 郵件與通知設定模組路由
 */
module.exports = function registerMailRoutes(app, ctx) {
  const {
    db,
    mail,
    authMiddleware,
    builtinAdminOnly,
    adminOnly,
  } = ctx;
  const lineNotify = ctx.lineNotify || require('../line-notify');

  function resolveAppBaseUrl() {
    if (typeof ctx.getAppBaseUrl === 'function') {
      try { return ctx.getAppBaseUrl(); } catch {}
    }
    try {
      const cfg = mail.loadConfig ? mail.loadConfig() : {};
      const fromMail = String(cfg.baseUrl || '').trim().replace(/\/$/, '');
      if (fromMail) return fromMail;
    } catch {}
    const port = process.env.PORT || 3847;
    return `http://127.0.0.1:${port}`;
  }

  /**
   * 郵件伺服器設定讀取
   * 所有登入者可見是否啟用；完整 SMTP 僅管理員
   */
  app.get('/api/mail/config', authMiddleware, (req, res) => {
    const pub = mail.publicConfig();
    if (req.user.role !== 'admin') {
      return res.json({
        enabled: pub.enabled,
        ready: pub.ready,
        fromName: pub.fromName,
      });
    }
    res.json(pub);
  });

  /** 儲存 SMTP 設定（僅內建 Admin 帳號） */
  app.put('/api/mail/config', authMiddleware, builtinAdminOnly, (req, res) => {
    const body = req.body || {};
    const saved = mail.saveConfig({
      enabled: body.enabled,
      host: body.host,
      port: body.port,
      secure: body.secure,
      ignoreTLS: body.ignoreTLS,
      requireTLS: body.requireTLS,
      tlsRejectUnauthorized: body.tlsRejectUnauthorized,
      user: body.user,
      pass: body.pass,
      from: body.from,
      fromName: body.fromName,
      baseUrl: body.baseUrl,
    });
    res.json({ ok: true, config: mail.publicConfig(saved) });
  });

  /** 寄送測試信（僅內建 Admin 帳號） */
  app.post('/api/mail/test', authMiddleware, builtinAdminOnly, async (req, res) => {
    const to = String(req.body?.to || '').trim() || req.user.email;
    // 從 DB 取管理員 email
    const me = db.prepare(`SELECT email, name FROM users WHERE id = ?`).get(req.user.id);
    const target = to || me?.email;
    if (!target) {
      return res.status(400).json({ error: '請指定測試收件 Email，或先在帳號設定填寫自己的 Email' });
    }
    if (!mail.isEnabled()) {
      return res.status(400).json({ error: '請先啟用 Email 提醒並儲存設定' });
    }
    const result = await mail.sendMail({
      to: target,
      subject: '【簽核系統】Email 測試信',
      text: `您好 ${me?.name || ''}，\n\n這是線上簽核系統的測試信件。若您收到此信，表示 SMTP 設定正常。\n`,
      html: `<p>您好 <strong>${me?.name || ''}</strong>，</p><p>這是線上簽核系統的測試信件。若您收到此信，表示 SMTP 設定正常。</p>`,
      meta: { type: 'test' },
    });
    if (!result.ok) {
      return res.status(400).json({ error: result.error || '寄送失敗', result });
    }
    res.json({ ok: true, result });
  });

  /** 通知通道狀態（不含密鑰；管理員） */
  app.get('/api/system/notify-status', authMiddleware, adminOnly, (req, res) => {
    const mailPub = mail.publicConfig ? mail.publicConfig() : {};
    const linePub = (lineNotify && lineNotify.publicConfig) ? lineNotify.publicConfig() : {
      enabled: false,
      ready: false,
      serviceUrl: '',
      hasApiKey: false,
      events: {},
    };
    const baseUrl = resolveAppBaseUrl();
    res.json({
      ok: true,
      baseUrl,
      mail: {
        enabled: mailPub.enabled,
        ready: mailPub.ready,
        host: mailPub.host || '',
        from: mailPub.from || '',
        baseUrl: mailPub.baseUrl || '',
        hasPass: mailPub.hasPass,
      },
      line: {
        enabled: linePub.enabled,
        ready: linePub.ready,
        serviceUrl: linePub.serviceUrl || '',
        hasApiKey: linePub.hasApiKey,
        events: linePub.events,
      },
      desktop: {
        poll: true,
        modal: true,
        notification: true,
      },
    });
  });

  /** LINE Webhook 轉送（不走 /api，避免內網限制；須保留 raw body 驗簽） */
  app.get('/line/webhook', (_req, res) => {
    res.json({
      ok: true,
      service: 'approval-line-webhook-proxy',
      hint: 'LINE Developers 的 Webhook URL 請填：https://你的公網主機:3848/line/webhook',
    });
  });

  app.post('/line/webhook', require('express').raw({ type: '*/*', limit: '2mb' }), async (req, res) => {
    try {
      const cfg = typeof lineNotify.loadConfig === 'function' ? lineNotify.loadConfig() : {};
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
};
