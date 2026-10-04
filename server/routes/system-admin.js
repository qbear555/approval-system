/**
 * 系統管理設定、公告、安全政策、數位簽章、設定包與稽核日誌模組路由
 */
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { PassThrough } = require('stream');
const PDFDocument = require('pdfkit');
const auditLog = require('../audit-log');
const systemPackage = require('../system-package');
const { getChineseFontPath, contentDispositionAttachment } = require('../pdf');

module.exports = function registerSystemAdminRoutes(app, ctx) {
  const {
    systemSettings,
    appVersion,
    deployLog,
    pdfSign,
    authMiddleware,
    adminOnly,
    builtinAdminOnly,
    uploadPackage,
    packageUploadError,
    parseUploadedPackage,
  } = ctx;

  const logoUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  });

  const announceUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  });

  const certUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  });

  /** 公開：公司名稱／Logo／版本（登入頁不需登入也可讀） */
  app.get('/api/system/settings', (req, res) => {
    res.json(systemSettings.getPublicSettings());
  });

  /** 公開：應用程式版本宣告 */
  app.get('/api/system/version', (req, res) => {
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

  /** 登入使用者：讀取總覽公告（最多 2 則；未啟用／逾時則 active=false） */
  app.get('/api/announcement', authMiddleware, (req, res) => {
    const announcements = systemSettings.getAnnouncementsPublic();
    res.json({
      announcements,
      // 相容舊前端：第一則公布中或 slot 0
      announcement:
        announcements.find((a) => a.active) ||
        announcements[0] ||
        systemSettings.getAnnouncementPublic(),
    });
  });

  /** 下載／檢視公告附件（需登入；未啟用或無檔則 404）?slot=0|1 */
  app.get('/api/announcement/file', authMiddleware, (req, res) => {
    try {
      const slot = Number(req.query.slot);
      const si = Number.isFinite(slot) && slot >= 0 ? Math.floor(slot) : 0;
      const all = systemSettings.getAnnouncementsPublic();
      const ann = all[si] || all[0];
      if (!ann || !ann.active || !ann.hasFile) {
        return res.status(404).json({ error: '目前沒有可下載的公告附件' });
      }
      const info = systemSettings.getAnnouncementFilePath(si);
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

  /** 內建 Admin：更新公告文字／啟用（body.slot=0|1，預設 0） */
  app.put('/api/system/announcement', authMiddleware, builtinAdminOnly, (req, res) => {
    try {
      const body = req.body || {};
      const announcement = systemSettings.updateAnnouncement({
        slot: body.slot,
        enabled: body.enabled,
        title: body.title,
        body: body.body,
        startAt: body.startAt,
        endAt: body.endAt,
      });
      res.json({
        ok: true,
        announcement,
        announcements: systemSettings.getAnnouncementsPublic(),
        settings: systemSettings.getAdminSettings(),
      });
    } catch (e) {
      res.status(400).json({ error: e.message || '儲存失敗' });
    }
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
        let originalname = req.file.originalname || 'attachment';
        try {
          originalname = Buffer.from(originalname, 'latin1').toString('utf8');
        } catch {
          /* keep */
        }
        const slotRaw = req.body?.slot ?? req.query?.slot ?? 0;
        const announcement = systemSettings.saveAnnouncementFile(
          {
            buffer: req.file.buffer,
            originalname,
            mimetype: req.file.mimetype,
          },
          slotRaw
        );
        res.json({
          ok: true,
          announcement,
          announcements: systemSettings.getAnnouncementsPublic(),
          settings: systemSettings.getAdminSettings(),
        });
      } catch (e) {
        res.status(400).json({ error: e.message || '上傳失敗' });
      }
    }
  );

  /** 內建 Admin：移除公告附件（?slot=0|1） */
  app.delete('/api/system/announcement/file', authMiddleware, builtinAdminOnly, (req, res) => {
    try {
      const slotRaw = req.query?.slot ?? req.body?.slot ?? 0;
      const announcement = systemSettings.clearAnnouncementFile(slotRaw);
      res.json({
        ok: true,
        announcement,
        announcements: systemSettings.getAnnouncementsPublic(),
        settings: systemSettings.getAdminSettings(),
      });
    } catch (e) {
      res.status(400).json({ error: e.message || '移除失敗' });
    }
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

  /** 製作公司自簽數位簽章憑證（.p12） */
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

  /** 測試數位簽章 */
  app.post('/api/system/pdf-sign/test', authMiddleware, builtinAdminOnly, async (req, res) => {
    try {
      const chunks = [];
      const pass = new PassThrough();
      pass.on('data', (c) => chunks.push(c));
      const done = new Promise((resolve, reject) => {
        pass.on('end', resolve);
        pass.on('error', reject);
      });
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      doc.pipe(pass);

      let useCjk = false;
      const fontPath = getChineseFontPath ? getChineseFontPath() : null;
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

  /** 品牌設定：GET 公開讀取 */
  app.get('/api/system/branding', (req, res) => {
    res.json({
      companyName: systemSettings.getCompanyName(),
      hasLogo: systemSettings.hasLogo(),
    });
  });

  /** 匯出系統設定完整包 */
  app.get('/api/system/package/export', authMiddleware, builtinAdminOnly, (req, res) => {
    try {
      const includeHistory =
        req.query.includeHistory === '1' ||
        req.query.includeHistory === 'true' ||
        req.query.history === '1';
      const includeMailSecrets = !(
        req.query.includeMailSecrets === '0' ||
        req.query.includeMailSecrets === 'false'
      );
      const pack = systemPackage.buildPackage({ includeHistory, includeMailSecrets });
      const tag = includeHistory ? '完整含歷史' : '設定';
      const fname = `簽核系統_${tag}包_${new Date().toISOString().slice(0, 10)}.json`;
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

  /** 預覽設定包摘要（不上傳寫入） */
  app.post(
    '/api/system/package/preview',
    authMiddleware,
    builtinAdminOnly,
    (req, res, next) => {
      if (typeof uploadPackage?.single === 'function') {
        uploadPackage.single('package')(req, res, (err) => {
          if (err) return res.status(400).json({ error: typeof packageUploadError === 'function' ? packageUploadError(err) : err.message });
          next();
        });
      } else {
        next();
      }
    },
    (req, res) => {
      try {
        const data = typeof parseUploadedPackage === 'function' ? parseUploadedPackage(req) : req.body;
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
    (req, res, next) => {
      if (typeof uploadPackage?.single === 'function') {
        uploadPackage.single('package')(req, res, (err) => {
          if (err) return res.status(400).json({ error: typeof packageUploadError === 'function' ? packageUploadError(err) : err.message });
          next();
        });
      } else {
        next();
      }
    },
    (req, res) => {
      try {
        const data = typeof parseUploadedPackage === 'function' ? parseUploadedPackage(req) : req.body;
        if (!data || !systemPackage.isConfigPackage(data)) {
          return res.status(400).json({
            error: '不是有效的系統設定完整包。請使用「帳號設定 → 系統設定完整包」匯出的 JSON。',
          });
        }

        const importMail =
          req.body?.importMail === '1' ||
          req.body?.importMail === 'true' ||
          req.body?.importMail === true ||
          req.body?.importMail === undefined;
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

  /** 稽核日誌查詢 */
  app.get('/api/system/audit-logs', authMiddleware, adminOnly, (req, res) => {
    try {
      const data = auditLog.list(req.query || {});
      res.json(data);
    } catch (e) {
      console.error('[audit-logs list]', e);
      res.status(500).json({ error: e.message || '查詢日誌失敗' });
    }
  });

  /** 稽核日誌匯出 CSV */
  app.get('/api/system/audit-logs/export', authMiddleware, adminOnly, (req, res) => {
    try {
      const csv = auditLog.toCsv(req.query || {});
      const fname = `稽核日誌_${new Date().toISOString().slice(0, 10)}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="audit-logs.csv"; filename*=UTF-8''${encodeURIComponent(fname)}`
      );
      res.send(csv);
    } catch (e) {
      console.error('[audit-logs export]', e);
      res.status(500).json({ error: e.message || '匯出失敗' });
    }
  });

  /** 稽核日誌分類清單 */
  app.get('/api/system/audit-logs/categories', authMiddleware, (req, res) => {
    res.json({ categories: auditLog.CATEGORIES });
  });
};
