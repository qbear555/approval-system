/**
 * PDF 備份
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
// ---------- 管理員：PDF 備份與查詢 ----------
app.get('/api/backups/meta', authMiddleware, requirePerm('backups'), (req, res) => {
  res.json({ meta: getBackupMeta() });
});

app.get('/api/backups', authMiddleware, requirePerm('backups'), (req, res) => {
  const items = listBackups({
    department: req.query.department || '',
    workflow_name: req.query.workflow_name || '',
    year: req.query.year || '',
    month: req.query.month || '',
    keyword: req.query.keyword || '',
    status: req.query.status || '',
    limit: req.query.limit || 200,
  });
  res.json({ backups: items });
});

app.post('/api/backups/run', authMiddleware, requirePerm('backups'), async (req, res) => {
  try {
    const body = req.body || {};
    const result = await runBackupJob(
      {
        status: body.status || 'approved',
        department: body.department || '',
        workflow_name: body.workflow_name || '',
        date_from: body.date_from || '',
        date_to: body.date_to || '',
        force: !!body.force,
      },
      (id) => getRequestDetail(id),
      req.user.id
    );
    res.json({ ok: true, result });
  } catch (e) {
    console.error('backup run error', e);
    res.status(500).json({ error: e.message || '備份失敗' });
  }
});

app.post('/api/backups/request/:id', authMiddleware, requirePerm('backups'), async (req, res) => {
  try {
    const detail = getRequestDetail(Number(req.params.id));
    if (!detail) return res.status(404).json({ error: '找不到簽核單' });
    const item = await backupOneRequest(detail, req.user.id);
    res.json({ ok: true, backup: item });
  } catch (e) {
    console.error('backup one error', e);
    res.status(500).json({ error: e.message || '備份失敗' });
  }
});

app.get('/api/backups/:id/download', authMiddleware, requirePerm('backups'), (req, res) => {
  const row = getBackupById(req.params.id);
  if (!row) return res.status(404).json({ error: '找不到備份' });
  const abs = resolveBackupAbsPath(row);
  if (!abs) return res.status(404).json({ error: '備份檔案不存在，請重新執行備份' });
  const zip = isZipBackup(row);
  res.setHeader('Content-Type', zip ? 'application/zip' : 'application/pdf');
  const nameHint = String(row.file_name || '');
  const ascii = zip
    ? nameHint.includes('含附件')
      ? `backup-${row.request_id}-with-attachments.zip`
      : `backup-${row.request_id}.zip`
    : `backup-${row.request_id}.pdf`;
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(row.file_name || ascii)}`
  );
  fs.createReadStream(abs).pipe(res);
});

/** 系統管理員刪除單筆備份（含 PDF 檔） */
app.delete('/api/backups/:id', authMiddleware, adminOnly, (req, res) => {
  const result = deleteBackup(req.params.id);
  if (!result.ok) return res.status(404).json({ error: result.error });
  res.json({ ok: true, ...result });
});

/** 系統管理員批次刪除備份 */
app.post('/api/backups/bulk-delete', authMiddleware, adminOnly, (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  if (!ids.length) return res.status(400).json({ error: '請選擇至少一筆備份' });
  const { deleted, failed } = deleteBackups(ids);
  res.json({
    ok: true,
    deleted: deleted.length,
    failed: failed.length,
    deletedItems: deleted,
    failures: failed,
    message: `已刪除 ${deleted.length} 筆備份${failed.length ? `，${failed.length} 筆失敗` : ''}`,
  });
});
};
