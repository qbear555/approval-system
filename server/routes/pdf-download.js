/**
 * 申請單 PDF／ZIP 下載
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
function safeZipEntryName(name, fallback = 'file') {
  const base = String(name || fallback)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return base || fallback;
}

/**
 * 下載／預覽簽核單 PDF
 * - 與單據相關者、records_all、管理員可存取
 * - preview=1：一律 PDF、inline（詳情頁嵌入；簽核中亦可用）
 * - 已核准且有附件、非 preview：ZIP（PDF＋附件）
 */
app.get('/api/requests/:id/pdf', authMiddleware, async (req, res) => {
  const canSeeDeleted =
    req.user.role === 'admin' || canDeleteApprovalRecords(req.user);
  const detail = getRequestDetail(Number(req.params.id), {
    includeDeleted: canSeeDeleted,
  });
  if (!detail) return res.status(404).json({ error: '找不到簽核單' });

  const seeAll =
    req.user.role === 'admin' || userHasPermission(req.user.id, 'records_all');
  if (!seeAll && !isRequestRelatedToUser(detail, req.user.id)) {
    return res.status(403).json({ error: '無權下載或預覽此文件' });
  }

  const preview =
    req.query.preview === '1' ||
    req.query.inline === '1' ||
    String(req.query.disposition || '').toLowerCase() === 'inline';

  // 草稿僅申請人／管理員可預覽 PDF
  if (
    detail.status === 'draft' &&
    detail.requester_id !== req.user.id &&
    req.user.role !== 'admin'
  ) {
    return res.status(400).json({ error: '草稿僅申請人可預覽 PDF' });
  }

  try {
    const atts = db
      .prepare(
        `SELECT id, original_name, stored_name FROM request_attachments WHERE request_id = ? ORDER BY id ASC`
      )
      .all(detail.id);

    const clientIp = getClientIp(req);
    const nowStr = tz.nowMinute();
    const watermarkText = `檢視防偽：${req.user.name} (${req.user.username}) · ${nowStr} · IP: ${clientIp}`;
    const detailEnriched = { ...detail, watermarkText };

    logAudit(req, {
      action_type: preview ? 'preview_pdf' : 'download_pdf',
      category: 'approval',
      description: `${preview ? '預覽' : '下載'}簽核單 PDF #${detail.id}「${detail.title}」`,
      target_id: detail.id,
    });

    // 產生 PDF（若系統設定啟用公司憑證則數位簽章；僅已核准通常才加簽）
    const pdfBuf = await pdfSign.buildApprovalPdfBuffer(detailEnriched, writeApprovalPdf);
    if (pdfBuf && pdfBuf._pdfSignSkipped) {
      res.setHeader('X-Pdf-Sign', 'skipped');
      if (pdfBuf._pdfSignError) {
        res.setHeader(
          'X-Pdf-Sign-Error',
          encodeURIComponent(String(pdfBuf._pdfSignError).slice(0, 200))
        );
      }
    }

    const pdfName = buildApprovalPdfFileName(detail);
    const pdfNameSafe = safeZipEntryName(pdfName, `approval-${detail.id}.pdf`);

    // 預覽、或尚未核准、或無附件 → 純 PDF
    const asZip =
      !preview && detail.status === 'approved' && atts.length > 0;

    if (!asZip) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        preview
          ? `inline; filename="approval-${detail.id}.pdf"; filename*=UTF-8''${encodeURIComponent(pdfName)}`
          : contentDispositionAttachment(pdfName, `approval-${detail.id}.pdf`)
      );
      // 預覽時避免快取舊版（簽核中內容可能更新）
      if (preview) {
        res.setHeader('Cache-Control', 'private, no-store');
      }
      return res.send(pdfBuf);
    }

    // 已核准且有附件：ZIP = 簽核單 PDF + 附件/
    const zipName = buildApprovalZipFileName(detail, { hasAttachments: true });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      contentDispositionAttachment(
        zipName,
        `approval-${detail.id}-with-attachments.zip`
      )
    );

    const archive = archiver('zip', { zlib: { level: 8 } });
    archive.on('error', (err) => {
      console.error('zip error', err);
      if (!res.headersSent) res.status(500).json({ error: '壓縮失敗' });
      else res.end();
    });
    archive.pipe(res);

    archive.append(pdfBuf, { name: pdfNameSafe });

    const usedNames = new Set([pdfNameSafe.toLowerCase()]);
    for (const att of atts) {
      const abs = path.join(UPLOAD_DIR, att.stored_name);
      if (!fs.existsSync(abs)) continue;
      let entry = safeZipEntryName(att.original_name, `附件-${att.id}`);
      // 避免同名覆蓋
      let finalName = entry;
      let n = 1;
      while (usedNames.has(finalName.toLowerCase())) {
        const ext = path.extname(entry);
        const stem = ext ? entry.slice(0, -ext.length) : entry;
        finalName = `${stem}_${n}${ext}`;
        n += 1;
      }
      usedNames.add(finalName.toLowerCase());
      archive.file(abs, { name: `附件/${finalName}` });
    }

    await archive.finalize();
  } catch (e) {
    console.error('PDF/ZIP error', e);
    if (!res.headersSent) {
      const msg = e && e.message ? String(e.message) : 'PDF 產生失敗';
      res.status(500).json({
        error: msg.includes('數位簽章') || msg.includes('PKCS')
          ? msg
          : `PDF 產生失敗：${msg}`,
      });
    }
  }
});
};
