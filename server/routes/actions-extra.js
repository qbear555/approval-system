/**
 * 加簽／轉簽／批次簽核
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
 * 加簽請託 (Ad-hoc Co-signer)
 * POST /api/requests/:id/cosign
 * Body: { target_user_id: number, comment: string, position: 'current' | 'after' }
 */
app.post('/api/requests/:id/cosign', authMiddleware, (req, res) => {
  try {
    const id = Number(req.params.id);
    const { target_user_id, comment, position = 'current' } = req.body || {};
    const targetId = Number(target_user_id);

    if (!targetId) return res.status(400).json({ error: '請選擇加簽同仁' });
    if (targetId === req.user.id) return res.status(400).json({ error: '不能加簽給自己' });

    const targetUser = db.prepare(`SELECT id, name, username, email FROM users WHERE id = ? AND active = 1`).get(targetId);
    if (!targetUser) return res.status(400).json({ error: '加簽對象不存在或已停用' });

    const detail = getRequestDetail(id);
    if (!detail) return res.status(404).json({ error: '找不到簽核單' });
    if (detail.status !== 'pending') return res.status(400).json({ error: '此單據不在簽核中' });

    const steps = detail.steps || [];
    // 並行分支下 current_step 只指得到其中一關，改用這位使用者實際待簽的關卡
    const currentStep = resolveActionableStep(detail, steps, req.user.id, id);
    if (!canUserApproveStep(req.user.id, currentStep, id)) {
      return res.status(403).json({ error: '您不是目前步驟的簽核人，無法進行加簽' });
    }

    // ── v2 圖模型：改這張單凍結的圖，不動流程定義 ──
    const cosignGraph = getRequestGraph(detail);
    if (cosignGraph) {
      const anchorId = currentStep.nodeId || `n${currentStep.order}`;
      const newNode = {
        id: `cosign_${Date.now().toString(36)}`,
        type: 'approval',
        name: `加簽：${targetUser.name}`,
        assignType: 'users',
        mode: 'any',
        approverIds: [targetId],
        approverFields: [],
        rejectTo: 'requester',
      };
      // v1 的 position=current 語意是「加簽者先簽，簽完才輪到原關卡」
      const pos = position === 'after' ? 'after' : 'before';
      const nextGraph = flowEngine.insertAdHoc(id, cosignGraph, anchorId, newNode, pos);
      if (!nextGraph) return res.status(400).json({ error: '加簽失敗：流程圖更新錯誤' });

      db.prepare(
        `UPDATE approval_requests SET flow_snapshot_json = ?, updated_at = datetime('now','localtime') WHERE id = ?`
      ).run(JSON.stringify(nextGraph), id);
      flowEngine.syncCurrentStep(id, nextGraph);

      db.prepare(
        `INSERT INTO approval_actions (request_id, step_order, node_id, step_name, actor_id, action, comment, form_data)
         VALUES (?, ?, ?, '加簽請託', ?, 'cosign', ?, '{}')`
      ).run(
        id, currentStep.order ?? null, anchorId, req.user.id,
        `${req.user.name} 加簽給 ${targetUser.name}${comment ? `：${String(comment).trim()}` : ''}`
      );

      const afterG = getRequestDetail(id);
      notifyCurrentApprovers(afterG, 'pending', req.user.name);
      logAudit(req, {
        action_type: 'cosign_request',
        category: 'approval',
        description: `加簽請託給 ${targetUser.name} (單號 #${id})`,
        target_id: id,
      });
      return res.json({ ok: true, message: `已成功加簽給 ${targetUser.name}`, request: afterG });
    }

    const curOrder = Number(detail.current_step);
    const updatedSteps = [];
    const cosignName = `加簽：${targetUser.name}`;
    let insertedOrder = curOrder;

    if (position === 'after') {
      insertedOrder = curOrder + 1;
      for (const s of steps) {
        const sOrd = Number(s.order);
        if (sOrd <= curOrder) {
          updatedSteps.push(s);
        } else {
          updatedSteps.push({ ...s, order: sOrd + 1 });
        }
      }
      updatedSteps.push({
        order: insertedOrder,
        name: cosignName,
        approverIds: [targetId],
        mode: 'any',
        assignType: 'users',
        is_cosign: true,
      });
      updatedSteps.sort((a, b) => Number(a.order) - Number(b.order));
    } else {
      // position === 'current'
      for (const s of steps) {
        const sOrd = Number(s.order);
        if (sOrd < curOrder) {
          updatedSteps.push(s);
        } else {
          updatedSteps.push({ ...s, order: sOrd + 1 });
        }
      }
      updatedSteps.push({
        order: curOrder,
        name: cosignName,
        approverIds: [targetId],
        mode: 'any',
        assignType: 'users',
        is_cosign: true,
      });
      updatedSteps.sort((a, b) => Number(a.order) - Number(b.order));
    }

    db.prepare(`UPDATE approval_requests SET steps_snapshot_json = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`)
      .run(JSON.stringify(updatedSteps), id);

    const logComment = `${req.user.name} 加簽給 ${targetUser.name}${comment ? `：${String(comment).trim()}` : ''}`;
    db.prepare(
      `INSERT INTO approval_actions (request_id, step_order, step_name, actor_id, action, comment, form_data)
       VALUES (?, ?, '加簽請託', ?, 'cosign', ?, '{}')`
    ).run(id, curOrder, req.user.id, logComment);

    const after = getRequestDetail(id);
    notifyCurrentApprovers(after, 'pending', req.user.name);

    logAudit(req, {
      action_type: 'cosign_request',
      category: 'approval',
      description: `加簽請託給 ${targetUser.name} (單號 #${id})`,
      target_id: id,
    });

    res.json({ ok: true, message: `已成功加簽給 ${targetUser.name}`, request: after });
  } catch (e) {
    console.error('cosign error', e);
    res.status(500).json({ error: e.message || '加簽失敗' });
  }
});

/**
 * 轉簽改派 (Forwarding / Re-assign)
 * POST /api/requests/:id/forward
 * Body: { target_user_id: number, comment: string }
 */
app.post('/api/requests/:id/forward', authMiddleware, (req, res) => {
  try {
    const id = Number(req.params.id);
    const { target_user_id, comment } = req.body || {};
    const targetId = Number(target_user_id);

    if (!targetId) return res.status(400).json({ error: '請選擇轉簽對象' });
    if (targetId === req.user.id) return res.status(400).json({ error: '不能轉簽給自己' });

    const targetUser = db.prepare(`SELECT id, name, username, email FROM users WHERE id = ? AND active = 1`).get(targetId);
    if (!targetUser) return res.status(400).json({ error: '轉簽對象不存在或已停用' });

    const detail = getRequestDetail(id);
    if (!detail) return res.status(404).json({ error: '找不到簽核單' });
    if (detail.status !== 'pending') return res.status(400).json({ error: '此單據不在簽核中' });

    const steps = detail.steps || [];
    const curOrder = Number(detail.current_step);
    // 並行分支下 current_step 只指得到其中一關，改用這位使用者實際待簽的關卡
    const currentStep = resolveActionableStep(detail, steps, req.user.id, id);
    if (!canUserApproveStep(req.user.id, currentStep, id)) {
      return res.status(403).json({ error: '您不是目前步驟的簽核人，無法進行轉簽' });
    }

    // ── v2 圖模型：轉簽不改流程結構，只換該節點的簽核人 ──
    const fwdGraph = getRequestGraph(detail);
    if (fwdGraph) {
      const anchorId = currentStep.nodeId || `n${currentStep.order}`;
      const nextGraph = {
        ...fwdGraph,
        nodes: fwdGraph.nodes.map((n) =>
          n.id === anchorId
            ? {
                ...n,
                approverIds: [targetId],
                mode: 'any',
                name: /改派:/.test(n.name || '') ? n.name : `${n.name} (改派: ${targetUser.name})`,
              }
            : n
        ),
      };
      db.prepare(
        `UPDATE approval_requests SET flow_snapshot_json = ?, updated_at = datetime('now','localtime') WHERE id = ?`
      ).run(JSON.stringify(nextGraph), id);

      db.prepare(
        `INSERT INTO approval_actions (request_id, step_order, node_id, step_name, actor_id, action, comment, form_data)
         VALUES (?, ?, ?, '轉簽改派', ?, 'forward', ?, '{}')`
      ).run(
        id, currentStep.order ?? null, anchorId, req.user.id,
        `${req.user.name} 轉簽改派給 ${targetUser.name}${comment ? `：${String(comment).trim()}` : ''}`
      );

      const afterG = getRequestDetail(id);
      notifyCurrentApprovers(afterG, 'pending', req.user.name);
      logAudit(req, {
        action_type: 'forward_request',
        category: 'approval',
        description: `轉簽改派給 ${targetUser.name} (單號 #${id})`,
        target_id: id,
      });
      return res.json({ ok: true, message: `已成功轉簽給 ${targetUser.name}`, request: afterG });
    }

    const updatedSteps = steps.map((s) => {
      if (Number(s.order) === curOrder) {
        return {
          ...s,
          approverIds: [targetId],
          name: `${s.name} (改派: ${targetUser.name})`,
        };
      }
      return s;
    });

    db.prepare(`UPDATE approval_requests SET steps_snapshot_json = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`)
      .run(JSON.stringify(updatedSteps), id);

    const logComment = `${req.user.name} 轉簽改派給 ${targetUser.name}${comment ? `：${String(comment).trim()}` : ''}`;
    db.prepare(
      `INSERT INTO approval_actions (request_id, step_order, step_name, actor_id, action, comment, form_data)
       VALUES (?, ?, '轉簽改派', ?, 'forward', ?, '{}')`
    ).run(id, curOrder, req.user.id, logComment);

    const after = getRequestDetail(id);
    notifyCurrentApprovers(after, 'pending', req.user.name);

    logAudit(req, {
      action_type: 'forward_request',
      category: 'approval',
      description: `轉簽改派給 ${targetUser.name} (單號 #${id})`,
      target_id: id,
    });

    res.json({ ok: true, message: `已成功轉簽給 ${targetUser.name}`, request: after });
  } catch (e) {
    console.error('forward error', e);
    res.status(500).json({ error: e.message || '轉簽失敗' });
  }
});

/**
 * 批次簽核 (P2-2)
 * POST /api/requests/bulk-action
 * Body: { ids: number[], action: 'approve' | 'reject', comment?: string, signature_image?: string }
 */
app.post('/api/requests/bulk-action', authMiddleware, async (req, res) => {
  const { ids, action = 'approve', comment, signature_image } = req.body || {};
  const reqIds = Array.isArray(ids) ? ids.map(Number).filter(Boolean) : [];

  if (!reqIds.length) {
    return res.status(400).json({ error: '請選擇至少一筆簽核單' });
  }

  const successIds = [];
  const failedItems = [];

  for (const id of reqIds) {
    try {
      const detail = getRequestDetail(id);
      if (!detail) {
        failedItems.push({ id, reason: '找不到簽核單' });
        continue;
      }
      if (detail.status !== 'pending') {
        failedItems.push({ id, reason: '此單據不在簽核中' });
        continue;
      }

      const steps = detail.steps || [];
      const step = findStepByOrder(steps, detail.current_step);
      if (!canUserApproveStep(req.user.id, step, id)) {
        failedItems.push({ id, reason: '您非目前步驟簽核人' });
        continue;
      }

      const stepOrder = Number(detail.current_step);
      const stepName = step?.name || `步驟 ${stepOrder}`;
      const defaultComment = action === 'approve' ? '批次同意核准' : '批次駁回';
      const finalComment = comment ? String(comment).trim() : defaultComment;

      if (action === 'approve') {
        // 批次核准：優先本次簽名，否則個人預設簽名（查 DB）
        let sigImg = signature_image ? String(signature_image).trim() : '';
        if (!sigImg) {
          const uSig = db
            .prepare(`SELECT signature_image FROM users WHERE id = ?`)
            .get(req.user.id);
          if (uSig?.signature_image) sigImg = uSig.signature_image;
        }
        db.prepare(
          `INSERT INTO approval_actions (request_id, step_order, step_name, actor_id, action, comment, form_data, signature_image)
           VALUES (?, ?, ?, ?, 'approve', ?, '{}', ?)`
        ).run(id, stepOrder, stepName, req.user.id, finalComment, sigImg || null);

        advanceToNextEligibleStep(id, detail, steps, step);
        const after = getRequestDetail(id);

        if (after.status === 'approved') {
          handleP2ApprovedSideEffects(after, req);
        }

        logAudit(req, {
          action_type: 'bulk_approve_request',
          category: 'approval',
          description: `批次核准申請單 #${id}「${detail.title}」`,
          target_id: id,
        });

        successIds.push(id);
      } else if (action === 'reject') {
        db.prepare(
          `INSERT INTO approval_actions (request_id, step_order, step_name, actor_id, action, comment, form_data)
           VALUES (?, ?, ?, ?, 'reject', ?, '{}')`
        ).run(id, stepOrder, stepName, req.user.id, finalComment);

        db.prepare(`UPDATE approval_requests SET status = 'rejected', updated_at = datetime('now', 'localtime') WHERE id = ?`)
          .run(id);

        logAudit(req, {
          action_type: 'bulk_reject_request',
          category: 'approval',
          description: `批次駁回申請單 #${id}「${detail.title}」`,
          target_id: id,
        });

        successIds.push(id);
      }
    } catch (e) {
      failedItems.push({ id, reason: e.message || '簽核失敗' });
    }
  }

  res.json({
    ok: true,
    processedCount: successIds.length,
    failedCount: failedItems.length,
    successIds,
    failedItems,
    message: `批次處理完成：成功 ${successIds.length} 筆${failedItems.length ? `，失敗 ${failedItems.length} 筆` : ''}`,
  });
});
};
