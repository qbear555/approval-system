/**
 * 附件下載與 OnlyOffice
 */
module.exports = function register(ctx) {
  const {
    app,
    db,
    fs,
    path,
    express,
    tz,
    mail,
    labor,
    pdfSign,
    onlyoffice,
    workflowModule,
    flowEngine,
    lineNotify,
    archiver,
    authMiddleware,
    adminOnly,
    requirePerm,
    writeApprovalPdf,
    buildApprovalPdfFileName,
    buildApprovalZipFileName,
    contentDispositionAttachment,
    runBackupJob,
    listBackups,
    getBackupMeta,
    getBackupById,
    resolveBackupAbsPath,
    backupOneRequest,
    deleteBackup,
    deleteBackups,
    isZipBackup,
    decodeUploadFilename,
    saveAttachments,
    getAttachments,
    isFinalApprovalStep,
    canUserAttachOnStep,
    getClientIp,
    logAudit,
    handleP2ApprovedSideEffects,
    hasApproverSigned,
    isFinanceUser,
    isCreditLimitRequestRow,
    canDeleteApprovalRecords,
    isLeaveApprovalRequest,
    canDeleteLeaveRequests,
    diagnoseApproverEmails,
    fireAndForgetMail,
    fireAndForgetLine,
    getAppBaseUrl,
    getUsernameById,
    findStepByOrder,
    getPendingApproverIds,
    notifyCurrentApprovers,
    userHasPermission,
    parseSteps,
    resolveLeaveTypeOptions,
    parseFormFields,
    mergeFormTables,
    validateFormData,
    mergeDeptHeadFormData,
    mergeUsersPickFormData,
    mergeCosignFormData,
    resolveStepsForRequest,
    loadStepsForRequest,
    createFinalNotifyReceipts,
    getPendingFinalNotifyCount,
    getPendingFinalNotifyRequests,
    getPendingFinanceConfirmRequests,
    getPendingApplicantAckRequests,
    enrichFinalNotifyUsers,
    buildResolvedGraph,
    getRequestGraph,
    resolveActionableStep,
    getRequestDetail,
    checkUserApprovalRight,
    canUserApproveStep,
    isStepComplete,
    evaluateStepCondition,
    advanceToNextEligibleStep,
    upload,
    REQUEST_LIST_SELECT,
    REQUEST_NOT_DELETED,
    CREDIT_LIMIT_COND,
    STEP_FINANCE_CONFIRM,
    STEP_APPLICANT_ACK,
    UPLOAD_DIR,
    MSG_LOCKED_AFTER_SIGN,
  } = ctx;
  const { isRequestRelatedToUser } = require('./request-helpers')(ctx);
/** 下載附件 */
app.get('/api/attachments/:id', authMiddleware, (req, res) => {
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
  if (!fs.existsSync(abs)) return res.status(404).json({ error: '附件檔案不存在' });

  const downloadName = decodeUploadFilename(att.original_name || `file-${att.id}`);
  const ext = path.extname(String(downloadName || att.stored_name || '')).toLowerCase();
  const mime = String(att.mime_type || '').toLowerCase();
  const canInline =
    mime.includes('pdf') ||
    ext === '.pdf' ||
    mime.startsWith('image/') ||
    /\.(png|jpe?g|gif|webp|bmp)$/i.test(ext);
  const inline = String(req.query.inline || '') === '1';
  const disposition = contentDispositionAttachment(downloadName, `file-${att.id}`);
  res.setHeader(
    'Content-Disposition',
    inline && canInline
      ? disposition.replace(/^attachment/i, 'inline')
      : disposition
  );
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
    // 僅「簽核中／草稿」可編輯回存；已核准／駁回／取消 → 一律唯讀（含管理員）
    // 簽核中：目前簽核人、管理員、或申請人（非最後關）
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
      `inline; filename="file-${att.id}"; filename*=UTF-8''${encodeURIComponent(name)}`
    );
    if (att.mime_type) res.setHeader('Content-Type', att.mime_type);
    else res.setHeader('Content-Type', 'application/octet-stream');
    fs.createReadStream(abs).pipe(res);
  } catch (e) {
    res.status(403).json({ error: '檔案連結無效或已過期' });
  }
});

/**
 * OnlyOffice 儲存 callback
 * 必須回傳 { error: 0 } JSON
 */
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
