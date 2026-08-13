/**
 * 系統設定／日曆／郵件／LINE／設定包
 */
module.exports = function register(ctx) {
  const {
    app,
    db,
    fs,
    path,
    multer,
    tz,
    mail,
    labor,
    twCalendar,
    systemSettings,
    pdfSign,
    appVersion,
    deployLog,
    systemPackage,
    lineNotify,
    PassThrough,
    authMiddleware,
    adminOnly,
    builtinAdminOnly,
    lineSettingsOnly,
    normalizeUsername,
    isBuiltinAdminUsername,
    isBuiltinAdminUser,
    hashPassword,
    verifyPassword,
    isWeakPlainPassword,
    hashMatchesWeakPassword,
    generateBootstrapPassword,
    signToken,
    setAuthCookie,
    clearAuthCookie,
    loginRateLimit,
    contentDispositionAttachment,
    getChineseFontPath,
    bindOrCheckDevice,
    listUserDevices,
    getClientIp,
    logAudit,
    parsePermissions,
    getUserDepartments,
    publicUser,
    canConfigureLineSettings,
    addUserToDepartment,
    removeUserFromDepartment,
    userHasPermission,
    resolveNextHireDate,
    getActiveDelegationForUser,
    getGrantorUserIdsForDelegate,
    isValidDepartment,
    upload,
    uploadPackage,
    PERMISSION_DEFS,
  } = ctx;
/**
 * 台灣國定假日／補班（請假試算用）
 * GET：需登入；POST refresh：管理員強制從遠端更新
 */
app.get('/api/tw-calendar', authMiddleware, (req, res) => {
  res.json(twCalendar.getPublic());
});

app.get('/api/tw-calendar/detail', authMiddleware, adminOnly, (req, res) => {
  res.json(twCalendar.getDetail());
});

app.post('/api/tw-calendar/refresh', authMiddleware, adminOnly, async (req, res) => {
  try {
    const data = await twCalendar.refresh({ force: true });
    res.json({ ok: true, ...data });
  } catch (e) {
    res.status(500).json({ error: e.message || '更新失敗' });
  }
});
// ---------- LINE 通知設定 ----------
app.get('/api/line/config', authMiddleware, (req, res) => {
  const pub = lineNotify.publicConfig();
  const canConfigure = canConfigureLineSettings(req.user);
  if (!canConfigure) {
    return res.json({
      enabled: pub.enabled,
      ready: pub.ready,
      canConfigure: false,
      configAccess: pub.configAccess,
    });
  }
  res.json({ ...pub, canConfigure: true });
});

app.put('/api/line/config', authMiddleware, lineSettingsOnly, (req, res) => {
  const body = req.body || {};
  const partial = {
    enabled: body.enabled,
    serviceUrl: body.serviceUrl,
    events: body.events,
    configAccess: body.configAccess,
  };
  // 空字串＝不變更 API Key（與 mail 密碼相同）
  if (body.apiKey != null && String(body.apiKey).trim() !== '') {
    partial.apiKey = String(body.apiKey).trim();
  } else {
    partial.apiKey = '';
  }
  // 僅內建 Admin 可變更「誰可設定 LINE」，避免權限被下放後失控
  if (!isBuiltinAdminUsername(req.user.username)) {
    delete partial.configAccess;
  }
  const saved = lineNotify.saveConfig(partial);
  res.json({
    ok: true,
    config: { ...lineNotify.publicConfig(saved), canConfigure: true },
  });
});

app.post('/api/line/test', authMiddleware, lineSettingsOnly, async (req, res) => {
  const username = String(req.body?.username || req.user.username || '').trim();
  const lineUserId = String(req.body?.lineUserId || '').trim();
  const text = String(req.body?.text || '').trim();
  if (!username && !lineUserId) {
    return res.status(400).json({ error: '請指定簽核帳號或 LINE userId' });
  }
  if (
    lineNotify.LINE_NOTIFY_BUILTIN_ADMIN_ONLY &&
    username &&
    !lineNotify.isLineNotifyAllowedUsername(username)
  ) {
    return res.status(400).json({ error: 'LINE 通知目前僅內建 Admin 可測試／收推播' });
  }
  if (!lineNotify.isReady()) {
    return res.status(400).json({
      error: '請先啟用 LINE 通知並填寫服務網址與 API 金鑰後儲存',
    });
  }
  const result = await lineNotify.testPush({
    username: username || undefined,
    lineUserId: lineUserId || undefined,
    text: text || undefined,
  });
  if (!result.ok) {
    return res.status(400).json({ error: result.error || '測試推播失敗', result });
  }
  res.json({ ok: true, result });
});

app.get('/api/line/health', authMiddleware, lineSettingsOnly, async (req, res) => {
  const result = await lineNotify.healthCheck();
  res.json(result);
});

app.get('/api/line/bindings', authMiddleware, lineSettingsOnly, async (req, res) => {
  const result = await lineNotify.fetchBindings();
  if (!result.ok) {
    return res.status(400).json({ error: result.error || '無法取得綁定列表' });
  }
  res.json(result);
});

app.delete('/api/line/bindings/me', authMiddleware, async (req, res) => {
  const result = await lineNotify.unbindUsername(req.user.username);
  if (!result.ok) return res.status(400).json({ error: result.error || '解除綁定失敗' });
  logAudit(req, {
    action_type: 'line_unbind',
    category: 'system',
    description: `自行解除 LINE 綁定（${req.user.username}）`,
  });
  res.json(result);
});

app.delete('/api/line/bindings/:username', authMiddleware, lineSettingsOnly, async (req, res) => {
  const username = decodeURIComponent(String(req.params.username || '').trim());
  const result = await lineNotify.unbindUsername(username);
  if (!result.ok) return res.status(400).json({ error: result.error || '解除綁定失敗' });
  logAudit(req, {
    action_type: 'line_unbind',
    category: 'system',
    description: `解除 LINE 綁定（${username}）`,
  });
  res.json(result);
});

// ---------- Mail settings ----------
app.get('/api/mail/config', authMiddleware, (req, res) => {
  // 所有登入者可見是否啟用；完整 SMTP 僅管理員
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

// ---------- 系統設定（僅內建 Admin 帳號，其他最高權限亦不可見）----------
const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
});

/** 公開：登入頁品牌（公司名／Logo／版本），不含部門與簽章狀態 */
app.get('/api/system/branding', (req, res) => {
  res.json(systemSettings.getBrandingSettings());
});

/** 已登入：公司名稱／Logo／版本／是否啟用 PDF 簽章 */
app.get('/api/system/settings', authMiddleware, (req, res) => {
  res.json(systemSettings.getPublicSettings());
});

/** 已登入：應用程式版本宣告 */
app.get('/api/system/version', authMiddleware, (req, res) => {
  res.json(appVersion.getVersionInfo());
});

/** 內建 Admin：自動部署／修改紀錄 */
app.get('/api/system/deploy-log', authMiddleware, builtinAdminOnly, (req, res) => {
  const limit = req.query.limit || 30;
  res.json({
    ok: true,
    latest: deployLog.getLatest(),
    ...deployLog.listHistory(limit),
  });
});

/** 公開：自訂 Logo 圖檔（無自訂則 404，前端改用預設） */
app.get('/api/system/logo', (req, res) => {
  const filePath = systemSettings.getLogoFilePath();
  if (!filePath) return res.status(404).end();
  res.sendFile(filePath);
});

/** 內建 Admin：完整系統設定（含 PDF 簽章狀態，不含明文密碼） */
app.get('/api/system/settings/admin', authMiddleware, builtinAdminOnly, (req, res) => {
  const settings = systemSettings.getAdminSettings();
  const sign = pdfSign.getSigningStatus();
  res.json({
    ...settings,
    pdfSign: { ...(settings.pdfSign || {}), ...sign },
  });
});

app.put('/api/system/settings', authMiddleware, builtinAdminOnly, (req, res) => {
  try {
    const body = req.body || {};
    systemSettings.updateSettings({
      companyName: body.companyName,
      pdfSignEnabled: body.pdfSignEnabled,
      pdfSignOnlyApproved: body.pdfSignOnlyApproved,
      pdfSignReason: body.pdfSignReason,
      pdfSignLocation: body.pdfSignLocation,
      pdfSignContact: body.pdfSignContact,
      pdfSignSignerName: body.pdfSignSignerName,
      pdfSignPass: body.pdfSignPass,
      pdfSignPassClear: body.pdfSignPassClear,
      backupEncryptEnabled: body.backupEncryptEnabled,
      backupEncryptPass: body.backupEncryptPass,
      backupEncryptPassClear: body.backupEncryptPassClear,
      ...(Object.prototype.hasOwnProperty.call(body, 'backupDir') ? { backupDir: body.backupDir } : {}),
      ...(Object.prototype.hasOwnProperty.call(body, 'intranetOnly')
        ? { intranetOnly: body.intranetOnly }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(body, 'loginCidrs') ? { loginCidrs: body.loginCidrs } : {}),
      ...(Object.prototype.hasOwnProperty.call(body, 'deviceBindEnabled')
        ? { deviceBindEnabled: body.deviceBindEnabled }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(body, 'deviceBindMax')
        ? { deviceBindMax: body.deviceBindMax }
        : {}),
    });
    res.json({
      ok: true,
      settings: systemSettings.getAdminSettings(),
      pdfSign: pdfSign.getSigningStatus(),
    });
  } catch (e) {
    res.status(400).json({ error: e.message || '儲存失敗' });
  }
});

app.post(
  '/api/system/logo',
  authMiddleware,
  builtinAdminOnly,
  logoUpload.single('logo'),
  (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: '請選擇 Logo 圖檔' });
      const settings = systemSettings.saveLogoFile({
        buffer: req.file.buffer,
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
      });
      res.json({ ok: true, settings });
    } catch (e) {
      res.status(400).json({ error: e.message || '上傳失敗' });
    }
  }
);

app.delete('/api/system/logo', authMiddleware, builtinAdminOnly, (req, res) => {
  try {
    const settings = systemSettings.clearLogo();
    res.json({ ok: true, settings });
  } catch (e) {
    res.status(400).json({ error: e.message || '清除失敗' });
  }
});

/** 登入使用者：讀取總覽公告（未啟用則 active=false） */
app.get('/api/announcement', authMiddleware, (req, res) => {
  res.json({ announcement: systemSettings.getAnnouncementPublic() });
});

/** 下載／檢視公告附件（需登入；未啟用或無檔則 404） */
app.get('/api/announcement/file', authMiddleware, (req, res) => {
  try {
    const ann = systemSettings.getAnnouncementPublic();
    if (!ann.active || !ann.hasFile) {
      return res.status(404).json({ error: '目前沒有可下載的公告附件' });
    }
    const info = systemSettings.getAnnouncementFilePath();
    if (!info) return res.status(404).json({ error: '附件不存在' });
    const inline = String(req.query.inline || '') === '1';
    const ext = path.extname(info.originalName || '').toLowerCase();
    const mimeMap = {
      '.pdf': 'application/pdf',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.txt': 'text/plain; charset=utf-8',
      '.csv': 'text/csv; charset=utf-8',
    };
    const mime = mimeMap[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    if (inline && mimeMap[ext]) {
      res.setHeader(
        'Content-Disposition',
        contentDispositionAttachment(info.originalName, info.storedName).replace(
          /^attachment/i,
          'inline'
        )
      );
    } else {
      res.setHeader(
        'Content-Disposition',
        contentDispositionAttachment(info.originalName, info.storedName)
      );
    }
    fs.createReadStream(info.fullPath).pipe(res);
  } catch (e) {
    res.status(400).json({ error: e.message || '下載失敗' });
  }
});

/** 內建 Admin：更新公告文字／啟用 */
app.put('/api/system/announcement', authMiddleware, builtinAdminOnly, (req, res) => {
  try {
    const body = req.body || {};
    const announcement = systemSettings.updateAnnouncement({
      enabled: body.enabled,
      title: body.title,
      body: body.body,
      startAt: body.startAt,
      endAt: body.endAt,
    });
    res.json({
      ok: true,
      announcement,
      settings: systemSettings.getAdminSettings(),
    });
  } catch (e) {
    res.status(400).json({ error: e.message || '儲存失敗' });
  }
});

const announceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
});

/** 內建 Admin：上傳公告附件 */
app.post(
  '/api/system/announcement/file',
  authMiddleware,
  builtinAdminOnly,
  (req, res, next) => {
    announceUpload.single('file')(req, res, (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: '附件請小於 15MB' });
        }
        return res.status(400).json({ error: err.message || '上傳失敗' });
      }
      next();
    });
  },
  (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: '請選擇附件檔案' });
      // 修正中文檔名（multer 預設 latin1）
      let originalname = req.file.originalname || 'attachment';
      try {
        originalname = Buffer.from(originalname, 'latin1').toString('utf8');
      } catch {
        /* keep */
      }
      const announcement = systemSettings.saveAnnouncementFile({
        buffer: req.file.buffer,
        originalname,
        mimetype: req.file.mimetype,
      });
      res.json({
        ok: true,
        announcement,
        settings: systemSettings.getAdminSettings(),
      });
    } catch (e) {
      res.status(400).json({ error: e.message || '上傳失敗' });
    }
  }
);

/** 內建 Admin：移除公告附件 */
app.delete('/api/system/announcement/file', authMiddleware, builtinAdminOnly, (req, res) => {
  try {
    const announcement = systemSettings.clearAnnouncementFile();
    res.json({
      ok: true,
      announcement,
      settings: systemSettings.getAdminSettings(),
    });
  } catch (e) {
    res.status(400).json({ error: e.message || '移除失敗' });
  }
});

const certUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

/** 上傳公司 PDF 數位簽章憑證（.p12 / .pfx） */
app.post(
  '/api/system/pdf-sign/cert',
  authMiddleware,
  builtinAdminOnly,
  certUpload.single('cert'),
  (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: '請選擇 .p12 或 .pfx 憑證檔' });
      const settings = systemSettings.savePdfSignCert({
        buffer: req.file.buffer,
        originalname: req.file.originalname,
      });
      // 若同表單有帶密碼一併更新
      if (req.body && req.body.passphrase != null && String(req.body.passphrase) !== '') {
        systemSettings.updateSettings({ pdfSignPass: req.body.passphrase });
      }
      res.json({
        ok: true,
        settings: systemSettings.getAdminSettings(),
        pdfSign: pdfSign.getSigningStatus(),
      });
    } catch (e) {
      res.status(400).json({ error: e.message || '上傳失敗' });
    }
  }
);

app.delete('/api/system/pdf-sign/cert', authMiddleware, builtinAdminOnly, (req, res) => {
  try {
    const settings = systemSettings.clearPdfSignCert();
    res.json({
      ok: true,
      settings,
      pdfSign: pdfSign.getSigningStatus(),
    });
  } catch (e) {
    res.status(400).json({ error: e.message || '清除失敗' });
  }
});

/**
 * 製作公司自簽數位簽章憑證（.p12）
 * 必填：commonName、organization、country、passphrase（與確認密碼）
 */
app.post('/api/system/pdf-sign/create', authMiddleware, builtinAdminOnly, (req, res) => {
  try {
    const result = systemSettings.createSelfSignedPdfSignCert(req.body || {});
    res.json({
      ok: true,
      message: '已製作並儲存自簽公司憑證',
      meta: result.meta,
      settings: result.settings,
      pdfSign: pdfSign.getSigningStatus(),
    });
  } catch (e) {
    console.error('[pdf-sign create]', e);
    res.status(400).json({ error: e.message || '製作憑證失敗' });
  }
});

/** 測試數位簽章（產生最小 PDF 並簽署；使用中文字型避免亂碼） */
app.post('/api/system/pdf-sign/test', authMiddleware, builtinAdminOnly, async (req, res) => {
  try {
    const PDFDocument = require('pdfkit');
    const { PassThrough } = require('stream');
    const chunks = [];
    const pass = new PassThrough();
    pass.on('data', (c) => chunks.push(c));
    const done = new Promise((resolve, reject) => {
      pass.on('end', resolve);
      pass.on('error', reject);
    });
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    doc.pipe(pass);

    // 註冊中文字型（與正式簽核 PDF 相同）
    let useCjk = false;
    const fontPath = getChineseFontPath();
    if (fontPath) {
      try {
        doc.registerFont('CJK', fontPath);
        doc.font('CJK');
        useCjk = true;
      } catch (e) {
        console.warn('[pdf-sign test] font register failed', e.message);
      }
    }
    const text = (str, opts) => {
      if (useCjk) {
        try {
          doc.font('CJK');
        } catch {
          /* ignore */
        }
      }
      doc.text(str, opts);
    };

    const company = systemSettings.getCompanyName();
    const now = new Date().toLocaleString('zh-TW', { hour12: false });
    doc.fontSize(18);
    text('PDF 數位簽章測試', { align: 'center' });
    doc.moveDown(1.2);
    doc.fontSize(12);
    text(`公司名稱：${company}`);
    text(`產生時間：${now}`);
    text('簽署者：' + (systemSettings.getPdfSignConfig().signerName || company));
    doc.moveDown(0.8);
    text('說明：若可正常開啟本檔，並在 Acrobat「簽名」面板看到簽章資訊，表示公司憑證設定正確。');
    doc.moveDown(0.5);
    text('注意：自簽憑證可能顯示「簽發者不被信任」，屬正常現象；內部使用不影響防竄改驗證。');
    doc.end();
    await done;
    let buf = Buffer.concat(chunks);
    // 測試時強制簽署（略過 onlyApproved）
    const cfg = systemSettings.getPdfSignConfig();
    if (!cfg.hasCert) throw new Error('請先上傳 .p12 / .pfx 憑證');
    buf = await pdfSign.signPdfBuffer(buf, {
      force: true,
      request: { id: 'TEST', workflow_name: '簽章測試' },
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      contentDispositionAttachment('簽章測試.pdf', 'pdf-sign-test.pdf')
    );
    res.send(buf);
  } catch (e) {
    console.error('[pdf-sign test]', e);
    res.status(400).json({ error: e.message || '測試簽署失敗' });
  }
});
// ---------- 系統設定完整包（僅系統管理員）----------
/**
 * 匯出系統設定完整包
 * query: includeHistory=1 含歷史申請與附件
 * 含 SMTP 密碼須同時 includeMailSecrets=1 且 confirmMailSecrets=1（預設不含）
 */
app.get('/api/system/package/export', authMiddleware, builtinAdminOnly, (req, res) => {
  try {
    const includeHistory =
      req.query.includeHistory === '1' ||
      req.query.includeHistory === 'true' ||
      req.query.history === '1';
    const wantMailSecrets =
      req.query.includeMailSecrets === '1' || req.query.includeMailSecrets === 'true';
    const confirmMailSecrets =
      req.query.confirmMailSecrets === '1' || req.query.confirmMailSecrets === 'true';
    const includeMailSecrets = wantMailSecrets && confirmMailSecrets;
    if (wantMailSecrets && !confirmMailSecrets) {
      return res.status(400).json({
        error: '匯出 SMTP 密碼須再確認（confirmMailSecrets=1）',
      });
    }
    const pack = systemPackage.buildPackage({ includeHistory, includeMailSecrets });
    const tag = includeHistory ? '完整含歷史' : '設定';
    const fname = `簽核系統_${tag}包_${tz.today()}.json`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="approval-config-package.json"; filename*=UTF-8''${encodeURIComponent(fname)}`
    );
    res.send(JSON.stringify(pack, null, 2));
  } catch (e) {
    console.error('system package export', e);
    res.status(500).json({ error: e.message || '匯出失敗' });
  }
});

/** 設定包上傳（multipart 檔案或 JSON body 皆可） */
function uploadPackageMiddleware(req, res, next) {
  uploadPackage.single('package')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || '上傳失敗' });
    next();
  });
}

/** 從上傳檔案／body 取出設定包 JSON；無法解析回傳 null */
function readPackagePayload(req) {
  // 以記事本另存的 JSON 可能含 BOM，需先去除才能 parse
  if (req.file?.buffer) {
    const text = req.file.buffer.toString('utf8').replace(/^\uFEFF/, '');
    return JSON.parse(text);
  }
  if (req.body?.package) {
    return typeof req.body.package === 'string'
      ? JSON.parse(req.body.package)
      : req.body.package;
  }
  if (req.body && req.body.format) return req.body;
  return null;
}

/** 預覽設定包摘要（不上傳寫入） */
app.post(
  '/api/system/package/preview',
  authMiddleware,
  builtinAdminOnly,
  uploadPackageMiddleware,
  (req, res) => {
    try {
      const data = readPackagePayload(req);
      if (!data || !systemPackage.isConfigPackage(data)) {
        return res.status(400).json({
          error: '不是有效的系統設定完整包（format 不符）',
        });
      }
      res.json({
        ok: true,
        format: data.format,
        version: data.version,
        exportedAt: data.exportedAt,
        includeHistory: Boolean(data.includeHistory),
        summary: data.summary || {
          departments: (data.departments || []).length,
          users: (data.users || []).length,
          workflows: (data.workflows || []).length,
        },
        hasMail: Boolean(data.mailConfig),
        hasMailPass: Boolean(data.mailConfig?.pass),
      });
    } catch (e) {
      res.status(400).json({ error: e.message || '無法解析設定包' });
    }
  }
);

/** 匯入系統設定完整包 */
app.post(
  '/api/system/package/import',
  authMiddleware,
  builtinAdminOnly,
  uploadPackageMiddleware,
  (req, res) => {
    try {
      const data = readPackagePayload(req);
      if (!data || !systemPackage.isConfigPackage(data)) {
        return res.status(400).json({
          error: '不是有效的系統設定完整包。請使用「帳號設定 → 系統設定完整包」匯出的 JSON。',
        });
      }

      const importMail =
        req.body?.importMail === '1' ||
        req.body?.importMail === 'true' ||
        req.body?.importMail === true ||
        req.body?.importMail === undefined; // 預設匯入 mail（若包內有）
      // 若 body 明確傳 0/false 則略過
      const skipMail =
        req.body?.importMail === '0' ||
        req.body?.importMail === 'false' ||
        req.body?.importMail === false;
      const importHistory =
        req.body?.importHistory === '1' ||
        req.body?.importHistory === 'true' ||
        req.body?.importHistory === true;

      const result = systemPackage.importPackage(data, {
        importMail: !skipMail && importMail !== false,
        importHistory,
      });

      const parts = [
        `部門 +${result.departments.created}/更新${result.departments.updated}`,
        `成員 +${result.users.created}/更新${result.users.updated}`,
        `流程 ${result.workflows.length} 個`,
      ];
      if (result.mail?.ok) parts.push('Email 設定已套用');
      if (result.history) {
        parts.push(
          `歷史：申請 ${result.history.requests}、歷程 ${result.history.actions}、附件 ${result.history.attachments}`
        );
      }

      res.json({
        ok: true,
        result,
        message: `匯入完成：${parts.join('；')}`,
      });
    } catch (e) {
      console.error('system package import', e);
      res.status(400).json({ error: e.message || '匯入失敗' });
    }
  }
);

  /** 通知通道狀態（不含密鑰；管理員） */
  app.get('/api/system/notify-status', authMiddleware, adminOnly, (req, res) => {
    const mailPub = mail.publicConfig();
    const linePub = lineNotify.publicConfig();
    const { getAppBaseUrl } = require('../runtime');
    res.json({
      ok: true,
      baseUrl: getAppBaseUrl(),
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
};
