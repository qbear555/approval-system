/**
 * 附件下載、即時預覽與 OnlyOffice 模組路由
 */
module.exports = function registerAttachmentRoutes(app, ctx) {
  const {
    db,
    fs,
    path,
    express,
    onlyoffice,
    previewService,
    authMiddleware,
    userHasPermission,
    getRequestDetail,
    canUserApproveStep,
    findStepByOrder,
    isFinalApprovalStep,
    decodeUploadFilename,
    contentDispositionAttachment,
    getAttachments,
    pdfSign,
    writeApprovalPdf,
    UPLOAD_DIR,
  } = ctx;
  const { isRequestRelatedToUser } = require('./request-helpers')(ctx);

  /** 下載原始附件 */
  app.get('/api/attachments/:id', authMiddleware, async (req, res) => {
    const att = db
      .prepare(`SELECT * FROM request_attachments WHERE id = ?`)
      .get(Number(req.params.id));
    if (!att) return res.status(404).json({ error: '找不到附件' });

    const detail = getRequestDetail(att.request_id);
    if (!detail) return res.status(404).json({ error: '找不到簽核單' });
    const seeAll =
      req.user.role === 'admin' || userHasPermission(req.user.id, 'records_all');
    if (!seeAll && !isRequestRelatedToUser(detail, req.user.id)) {
      return res.status(403).json({ error: '無權下載此附件' });
    }

    const abs = path.join(UPLOAD_DIR, att.stored_name);
    if (!fs.existsSync(abs) && att.source_request_id) {
      try {
        const srcDetail = getRequestDetail(att.source_request_id);
        if (srcDetail) {
          const pdfBuf = await pdfSign.buildApprovalPdfBuffer(srcDetail, writeApprovalPdf);
          if (pdfBuf && pdfBuf.length) {
            fs.writeFileSync(abs, pdfBuf);
          }
        }
      } catch (err) {
        console.warn('Auto-generate missing source_request_id PDF failed:', err);
      }
    }
    if (!fs.existsSync(abs)) return res.status(404).json({ error: '附件檔案不存在' });

    const downloadName = decodeUploadFilename(att.original_name || `file-${att.id}`);
    const ext = path.extname(String(downloadName || att.stored_name || '')).toLowerCase();
    const mime = String(att.mime_type || '').toLowerCase();
    const canInline =
      mime.includes('pdf') ||
      ext === '.pdf' ||
      mime.startsWith('image/') ||
      /\.(png|jpe?g|gif|webp|bmp)$/i.test(ext);
    const wantInline = String(req.query.inline || '') === '1';
    const disp = contentDispositionAttachment(downloadName, `file-${att.id}`);
    if (wantInline && canInline) {
      res.setHeader('Content-Disposition', disp.replace(/^attachment/i, 'inline'));
    } else {
      res.setHeader('Content-Disposition', disp);
    }
    if (ext === '.pdf' || mime.includes('pdf')) {
      res.setHeader('Content-Type', 'application/pdf');
    } else if (ext === '.png') {
      res.setHeader('Content-Type', 'image/png');
    } else if (ext === '.jpg' || ext === '.jpeg') {
      res.setHeader('Content-Type', 'image/jpeg');
    } else if (ext === '.gif') {
      res.setHeader('Content-Type', 'image/gif');
    } else if (ext === '.webp') {
      res.setHeader('Content-Type', 'image/webp');
    } else if (att.mime_type) {
      res.setHeader('Content-Type', att.mime_type);
    }
    fs.createReadStream(abs).pipe(res);
  });

  /** 附件預覽資訊 */
  app.get('/api/attachments/:id/preview-info', authMiddleware, (req, res) => {
    const att = db
      .prepare(`SELECT * FROM request_attachments WHERE id = ?`)
      .get(Number(req.params.id));
    if (!att) return res.status(404).json({ error: '找不到附件' });

    const detail = getRequestDetail(att.request_id);
    if (!detail) return res.status(404).json({ error: '找不到簽核單' });
    const seeAll =
      req.user.role === 'admin' || userHasPermission(req.user.id, 'records_all');
    if (!seeAll && !isRequestRelatedToUser(detail, req.user.id)) {
      return res.status(403).json({ error: '無權檢視此附件' });
    }

    const previewType = previewService.getPreviewType(att);
    const cacheKey = previewService.getCacheKey(att);
    const cachePath = path.join(previewService.CACHE_DIR, cacheKey);
    const hasPdfCache = fs.existsSync(cachePath) && fs.statSync(cachePath).size > 0;

    res.json({
      ok: true,
      id: att.id,
      previewType,
      hasPdfCache,
      originalName: att.original_name,
      sizeBytes: att.size_bytes,
      onlyOfficeEnabled: onlyoffice.isEnabled(),
    });
  });

  /** 試算表 (Excel/CSV) 極速解析與表格資料 */
  app.get('/api/attachments/:id/sheet-data', authMiddleware, (req, res) => {
    const att = db
      .prepare(`SELECT * FROM request_attachments WHERE id = ?`)
      .get(Number(req.params.id));
    if (!att) return res.status(404).json({ error: '找不到附件' });

    const detail = getRequestDetail(att.request_id);
    if (!detail) return res.status(404).json({ error: '找不到簽核單' });
    const seeAll =
      req.user.role === 'admin' || userHasPermission(req.user.id, 'records_all');
    if (!seeAll && !isRequestRelatedToUser(detail, req.user.id)) {
      return res.status(403).json({ error: '無權檢視此附件' });
    }

    try {
      const data = previewService.parseSpreadsheet(att);
      res.json({ ok: true, ...data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message || '試算表解析失敗' });
    }
  });

  /** 附件即時預覽串流 (PDF/圖片/Office轉換PDF) */
  app.get('/api/attachments/:id/preview', authMiddleware, async (req, res) => {
    const att = db
      .prepare(`SELECT * FROM request_attachments WHERE id = ?`)
      .get(Number(req.params.id));
    if (!att) return res.status(404).json({ error: '找不到附件' });

    const detail = getRequestDetail(att.request_id);
    if (!detail) return res.status(404).json({ error: '找不到簽核單' });
    const seeAll =
      req.user.role === 'admin' || userHasPermission(req.user.id, 'records_all');
    if (!seeAll && !isRequestRelatedToUser(detail, req.user.id)) {
      return res.status(403).json({ error: '無權檢視此附件' });
    }

    const pType = previewService.getPreviewType(att);

    // 1. 原生 PDF 或圖片：直接串流原檔
    if (pType === 'pdf' || pType === 'image') {
      const abs = previewService.resolveAttachmentPath(att);
      if (!abs) return res.status(404).json({ error: '實體檔案不存在' });
      const ext = path.extname(abs).toLowerCase();
      res.setHeader('Content-Disposition', 'inline; filename="preview' + ext + '"');
      if (ext === '.pdf') res.setHeader('Content-Type', 'application/pdf');
      else if (ext === '.png') res.setHeader('Content-Type', 'image/png');
      else if (ext === '.jpg' || ext === '.jpeg') res.setHeader('Content-Type', 'image/jpeg');
      else if (ext === '.gif') res.setHeader('Content-Type', 'image/gif');
      else if (ext === '.webp') res.setHeader('Content-Type', 'image/webp');
      return fs.createReadStream(abs).pipe(res);
    }

    // 2. 請求試算表 JSON 結構
    if (req.query.format === 'json' || req.query.type === 'sheet') {
      try {
        const data = previewService.parseSpreadsheet(att);
        return res.json({ ok: true, type: 'sheet', ...data });
      } catch (e) {
        return res.status(500).json({ ok: false, error: e.message });
      }
    }

    // 3. Office 文件 (Word, Excel, PPT) 轉換 PDF 快取串流
    if (pType === 'doc' || pType === 'sheet' || pType === 'slide') {
      try {
        const conv = await previewService.convertOfficeToPdf(att, onlyoffice);
        if (conv.ok && conv.pdfPath && fs.existsSync(conv.pdfPath)) {
          res.setHeader('Content-Disposition', 'inline; filename="preview.pdf"');
          res.setHeader('Content-Type', 'application/pdf');
          return fs.createReadStream(conv.pdfPath).pipe(res);
        }
      } catch (err) {
        console.warn('[preview] convertOfficeToPdf error:', err.message);
      }

      if (pType === 'sheet') {
        try {
          const data = previewService.parseSpreadsheet(att);
          return res.json({ ok: true, type: 'sheet', ...data });
        } catch (e) {
          /* fallback to download */
        }
      }

      return res.status(422).json({
        ok: false,
        fallback: pType === 'sheet' ? 'sheet' : 'download',
        error: '線上轉換暫時無法使用，請使用下載或 OnlyOffice 完整編輯器開啟',
      });
    }

    // 4. 純文字檔案
    if (pType === 'text') {
      const abs = previewService.resolveAttachmentPath(att);
      if (abs && fs.existsSync(abs)) {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return fs.createReadStream(abs).pipe(res);
      }
    }

    res.status(415).json({ error: '此格式不支援線上預覽，請使用下載開啟' });
  });

  /** 草稿階段：申請人可移除已上傳附件（重新編輯草稿時） */
  app.delete('/api/attachments/:id', authMiddleware, (req, res) => {
    const attId = Number(req.params.id);
    const att = db
      .prepare(`SELECT * FROM request_attachments WHERE id = ?`)
      .get(attId);
    if (!att) return res.status(404).json({ error: '找不到附件' });

    const row = db
      .prepare(`SELECT id, status, requester_id, submitted_by FROM approval_requests WHERE id = ?`)
      .get(Number(att.request_id));
    if (!row) return res.status(404).json({ error: '找不到簽核單' });
    if (String(row.status) !== 'draft') {
      return res.status(400).json({ error: '僅草稿可移除附件；簽核中請於詳情頁操作' });
    }
    const canRemoveDraftAtt =
      Number(row.requester_id) === Number(req.user.id) ||
      Number(row.submitted_by) === Number(req.user.id) ||
      req.user.role === 'admin';
    if (!canRemoveDraftAtt) {
      return res.status(403).json({ error: '僅申請人或代申請人可移除此草稿附件' });
    }

    try {
      const abs = path.join(UPLOAD_DIR, att.stored_name);
      if (fs.existsSync(abs)) {
        try {
          fs.unlinkSync(abs);
        } catch (e) {
          console.warn('[attachments] unlink failed', abs, e.message);
        }
      }
      try {
        const bak = `${abs}.bak`;
        if (fs.existsSync(bak)) fs.unlinkSync(bak);
      } catch {
        /* ignore */
      }
    } catch (e) {
      console.warn('[attachments] delete file error', e.message);
    }

    db.prepare(`DELETE FROM request_attachments WHERE id = ?`).run(attId);
    db.prepare(
      `UPDATE approval_requests SET updated_at = datetime('now', 'localtime') WHERE id = ?`
    ).run(row.id);

    res.json({
      ok: true,
      message: '已從草稿移除附件',
      attachments: getAttachments(row.id),
    });
  });

  // ---------- OnlyOffice 線上編輯 Word／Excel ----------
  app.get('/api/onlyoffice/status', authMiddleware, (req, res) => {
    res.json(onlyoffice.publicStatus(req));
  });

  /**
   * 開啟編輯器設定
   * 可編輯：簽核中且為目前步驟簽核人（或管理員）
   * 可檢視：其餘有權限看單據者
   */
  app.get('/api/onlyoffice/editor/:attachmentId', authMiddleware, (req, res) => {
    try {
      if (!onlyoffice.isEnabled()) {
        return res.status(503).json({
          error:
            'OnlyOffice 未啟用。請在 docker-compose 啟動 onlyoffice 服務，並設定 ONLYOFFICE_ENABLED=1',
        });
      }
      const att = db
        .prepare(`SELECT * FROM request_attachments WHERE id = ?`)
        .get(Number(req.params.attachmentId));
      if (!att) return res.status(404).json({ error: '找不到附件' });
      if (!onlyoffice.isOfficeAttachment(att)) {
        return res.status(400).json({ error: '僅 Word／Excel 等 Office 附件可線上編輯' });
      }
      const detail = getRequestDetail(att.request_id);
      if (!detail) return res.status(404).json({ error: '找不到簽核單' });
      const seeAll =
        req.user.role === 'admin' || userHasPermission(req.user.id, 'records_all');
      if (!seeAll && !isRequestRelatedToUser(detail, req.user.id)) {
        return res.status(403).json({ error: '無權開啟此附件' });
      }
      const abs = onlyoffice.resolveAttachmentPath(att);
      if (!abs) return res.status(404).json({ error: '附件檔案不存在' });

      const steps = detail.steps || [];
      const current = findStepByOrder(steps, detail.current_step);
      const isCurrentApprover =
        detail.status === 'pending' &&
        canUserApproveStep(req.user.id, current, detail.id);
      const canEdit =
        detail.status === 'draft'
          ? detail.requester_id === req.user.id || req.user.role === 'admin'
          : detail.status === 'pending' &&
            (isCurrentApprover ||
              req.user.role === 'admin' ||
              (detail.requester_id === req.user.id &&
                !isFinalApprovalStep(steps, current)));

      const editor = onlyoffice.buildEditorConfig({
        att: {
          ...att,
          original_name: decodeUploadFilename(att.original_name || 'file'),
        },
        user: { id: req.user.id, name: req.user.name },
        canEdit,
        requestId: detail.id,
        req,
      });
      res.json({ ok: true, ...editor, requestStatus: detail.status });
    } catch (e) {
      console.error('onlyoffice editor config', e);
      res.status(400).json({ error: e.message || '無法開啟編輯器' });
    }
  });

  /** Document Server 下載原始檔（token，無需使用者 JWT） */
  app.get('/api/onlyoffice/file/:token', (req, res) => {
    try {
      const payload = onlyoffice.verifyFileToken(req.params.token);
      const att = db
        .prepare(`SELECT * FROM request_attachments WHERE id = ?`)
        .get(Number(payload.attachmentId));
      if (!att) return res.status(404).json({ error: '找不到附件' });
      const abs = onlyoffice.resolveAttachmentPath(att);
      if (!abs) return res.status(404).json({ error: '檔案不存在' });
      const name = decodeUploadFilename(att.original_name || `file-${att.id}`);
      res.setHeader(
        'Content-Disposition',
        contentDispositionAttachment(name, `file-${att.id}`)
      );
      if (att.mime_type) res.setHeader('Content-Type', att.mime_type);
      else res.setHeader('Content-Type', 'application/octet-stream');
      fs.createReadStream(abs).pipe(res);
    } catch (e) {
      res.status(403).json({ error: '檔案連結無效或已過期' });
    }
  });

  /** OnlyOffice 儲存 callback */
  app.post('/api/onlyoffice/callback', express.json({ limit: '2mb' }), async (req, res) => {
    const respond = (error = 0) => res.json({ error });
    try {
      const token = req.query.token || req.body?.token;
      if (!token) {
        console.warn('[onlyoffice] callback missing token');
        return respond(1);
      }
      let payload;
      try {
        payload = onlyoffice.verifyCallbackToken(String(token));
      } catch (e) {
        console.warn('[onlyoffice] callback token invalid', e.message);
        return respond(1);
      }
      const result = await onlyoffice.handleCallback(req.body || {}, payload, db);
      if (!result.handled || result.error) {
        console.warn('[onlyoffice] callback fail', result.error);
        return respond(1);
      }
      return respond(0);
    } catch (e) {
      console.error('[onlyoffice] callback error', e);
      return respond(1);
    }
  });
};
