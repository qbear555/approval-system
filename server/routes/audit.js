/**
 * 系統稽核日誌
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
/**
 * 稽核日誌查詢條件 → WHERE 子句與參數（查詢與匯出共用）
 * @param {{ q?: string, category?: string, user_id?: string|number, dateFrom?: string, dateTo?: string }} query
 */
function buildAuditLogFilter(query = {}) {
  const { q, category, user_id, dateFrom, dateTo } = query || {};
  const where = [];
  const params = [];

  if (q && String(q).trim()) {
    const kw = `%${String(q).trim()}%`;
    where.push(
      `(user_name LIKE ? OR user_username LIKE ? OR description LIKE ? OR ip_address LIKE ? OR action_type LIKE ?)`
    );
    params.push(kw, kw, kw, kw, kw);
  }
  if (category && String(category).trim()) {
    where.push(`category = ?`);
    params.push(String(category).trim());
  }
  if (user_id) {
    where.push(`user_id = ?`);
    params.push(Number(user_id));
  }
  if (dateFrom && String(dateFrom).trim()) {
    where.push(`created_at >= ?`);
    params.push(`${String(dateFrom).trim()} 00:00:00`);
  }
  if (dateTo && String(dateTo).trim()) {
    where.push(`created_at <= ?`);
    params.push(`${String(dateTo).trim()} 23:59:59`);
  }

  return { whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

/**
 * 取得系統進階稽核日誌 (P3-1)
 * GET /api/system/audit-logs
 * Query: { q, category, user_id, dateFrom, dateTo, page, limit }
 */
app.get('/api/system/audit-logs', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin' && !userHasPermission(req.user.id, 'audit_logs')) {
    return res.status(403).json({ error: '需要系統稽核日誌權限' });
  }

  const { page = 1, limit = 50 } = req.query || {};
  const p = Math.max(1, Number(page) || 1);
  const l = Math.min(200, Math.max(10, Number(limit) || 50));
  const offset = (p - 1) * l;

  const { whereSql, params } = buildAuditLogFilter(req.query);

  const totalCount = db.prepare(`SELECT COUNT(*) AS c FROM system_audit_logs ${whereSql}`).get(...params)?.c || 0;
  const logs = db.prepare(`SELECT * FROM system_audit_logs ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...params, l, offset);

  const categories = ['auth', 'approval', 'user_management', 'workflow', 'system'];

  res.json({
    logs,
    totalCount,
    totalPages: Math.ceil(totalCount / l),
    page: p,
    limit: l,
    categories,
  });
});

/**
 * 匯出系統進階稽核日誌 CSV (P3-1)
 * GET /api/system/audit-logs/export
 */
app.get('/api/system/audit-logs/export', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin' && !userHasPermission(req.user.id, 'audit_logs')) {
    return res.status(403).json({ error: '需要系統稽核日誌權限' });
  }

  const { whereSql, params } = buildAuditLogFilter(req.query);
  const logs = db.prepare(`SELECT * FROM system_audit_logs ${whereSql} ORDER BY id DESC LIMIT 5000`).all(...params);

  // UTF-8 BOM CSV output for Excel compatibility
  const BOM = '\uFEFF';
  const headers = ['ID', '時間', '分類', '動作類型', '使用者', '帳號', 'IP 位址', '目標 ID', '說明詳情'];
  const rows = logs.map((l) => [
    l.id,
    l.created_at,
    l.category || '',
    l.action_type || '',
    l.user_name || '',
    l.user_username || '',
    l.ip_address || '',
    l.target_id || '',
    (l.description || '').replace(/"/g, '""'),
  ]);

  const csvContent = BOM + [headers.join(','), ...rows.map((r) => r.map((cell) => `"${cell}"`).join(','))].join('\r\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="system_audit_logs_${tz.today()}.csv"`);
  res.send(csvContent);
});
};
