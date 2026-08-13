/**
 * 簽核核准／駁回／取消
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
app.post(
  '/api/requests/:id/action',
  authMiddleware,
  upload.array('attachments', 20),
  (req, res) => {
  const id = Number(req.params.id);
  let { action, comment, step_form_data: stepFormData, signature_image: signatureImage } = req.body || {};
  if (typeof stepFormData === 'string') {
    try {
      stepFormData = JSON.parse(stepFormData || '{}');
    } catch {
      stepFormData = {};
    }
  }
  const allowed = ['approve', 'reject', 'cancel'];
  if (!allowed.includes(action)) {
    return res.status(400).json({ error: '不支援的操作' });
  }

  const detail = getRequestDetail(id);
  if (!detail) return res.status(404).json({ error: '找不到簽核單' });

  if (action === 'cancel') {
    if (detail.requester_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: '僅申請人或管理員可取消' });
    }
    if (!['pending', 'draft'].includes(detail.status)) {
      return res.status(400).json({ error: '此單據無法取消' });
    }
    // 簽核中且已有簽署人核准 → 不可取消
    if (detail.status === 'pending' && hasApproverSigned(id, detail)) {
      return res.status(400).json({ error: MSG_LOCKED_AFTER_SIGN });
    }
    db.prepare(
      `UPDATE approval_requests SET status = 'cancelled', completed_at = datetime('now', 'localtime'),
       updated_at = datetime('now', 'localtime') WHERE id = ?`
    ).run(id);
    db.prepare(
      `INSERT INTO approval_actions (request_id, step_order, step_name, actor_id, action, comment, form_data)
       VALUES (?, ?, '取消', ?, 'cancel', ?, '{}')`
    ).run(id, detail.current_step, req.user.id, comment || '取消申請');
    const after = getRequestDetail(id);
    const actor = db.prepare(`SELECT name FROM users WHERE id = ?`).get(req.user.id);
    fireAndForgetMail(
      'applicant-cancel',
      mail.notifyApplicant(after, 'cancelled', {
        actorName: actor?.name,
        comment: comment || '取消申請',
      })
    );
    fireAndForgetLine(
      'applicant-cancel',
      lineNotify.notifyApplicantLine(after, 'cancelled', {
        actorName: actor?.name,
        comment: comment || '取消申請',
        baseUrl: getAppBaseUrl(),
        getUsernameById,
      })
    );
    return res.json({ request: after });
  }

  if (detail.status !== 'pending') {
    return res.status(400).json({ error: '此單據不在簽核中' });
  }

  const steps = detail.steps;
  // v2 並行分支時可能同時有多個待簽關卡，current_step 只指得到其中一個，
  // 必須改由「這位使用者實際待簽的節點」決定，否則另一條分支的簽核人會被擋
  const step = resolveActionableStep(detail, steps, req.user.id, id);
  const check = checkUserApprovalRight(req.user.id, step, id);
  if (!check.canApprove) {
    return res.status(403).json({ error: '您不是目前步驟的簽核人，或已簽核過' });
  }

  const delegatedForId = check.isDelegated ? check.delegatedFor.id : null;
  let finalComment = comment != null ? String(comment).trim() : '';
  if (check.isDelegated) {
    const proxyTag = `(代理 ${check.delegatedFor.name} 簽核)`;
    if (!finalComment.includes(proxyTag)) {
      finalComment = finalComment ? `${finalComment} ${proxyTag}` : proxyTag;
    }
  } else if (!finalComment) {
    finalComment = action === 'approve' ? '同意' : '駁回';
  }

  // 簽名檔處置：優先本次上傳；否則一律帶入「個人預設簽名」（JWT 無簽名欄，須查 DB）
  let sigImgToSave = signatureImage || null;
  if (sigImgToSave && typeof sigImgToSave === 'string') {
    sigImgToSave = String(sigImgToSave).trim() || null;
  } else {
    sigImgToSave = null;
  }
  if (!sigImgToSave) {
    try {
      const uSig = db
        .prepare(`SELECT signature_image FROM users WHERE id = ?`)
        .get(req.user.id);
      if (uSig?.signature_image) sigImgToSave = uSig.signature_image;
    } catch {
      /* ignore */
    }
  }

  // 中間步驟可隨簽核一併上傳附件；最終審核者不可
  if (req.files?.length) {
    if (isFinalApprovalStep(steps, step)) {
      return res.status(400).json({ error: '最終審核步驟不可新增附件' });
    }
    saveAttachments(id, req.user.id, req.files, step?.order);
  }

  // 簽核步驟附加表單（如人事：剩餘特休）
  let actionFormJson = '{}';
  if (action === 'approve') {
    let fields = Array.isArray(step?.approverFields) ? step.approverFields : [];
    if (fields.length) {
      // 請假人事：非特休時「剩餘日數／小時」可不填（留白）
      const rawStep = stepFormData || {};
      const hrType = String(
        rawStep.hr_leave_type || rawStep.假別 || ''
      ).trim();

      // 假別選項：與詳情頁一致，帶入申請表單全部假別
      const leaveFieldOpts = resolveLeaveTypeOptions(detail.formFields);

      // 特休不以小時計算：略過剩餘特休小時欄
      fields = fields
        .filter(
          (f) =>
            f &&
            f.id !== 'remaining_special_leave_hours' &&
            !(/剩餘.*特休.*小時|特休.*換算.*小時/.test(String(f.label || '')))
        )
        .map((f) => {
          let next = { ...f };
          if (
            f.id === 'hr_leave_type' ||
            (/假別/.test(String(f.label || '')) && f.type === 'select')
          ) {
            const merged = [
              ...new Set(
                [
                  ...(Array.isArray(f.options) ? f.options.map(String) : []),
                  ...leaveFieldOpts,
                  String(detail.form_data?.leave_type || '').trim(),
                  hrType,
                ].filter(Boolean)
              ),
            ];
            next = { ...next, type: 'select', options: merged };
          }
          if (
            hrType &&
            !labor.isSpecialLeaveType(hrType) &&
            (f.id === 'remaining_special_leave_days' ||
              /剩餘.*日數/.test(String(f.label || '')))
          ) {
            next = { ...next, required: false };
          }
          return next;
        });

      // 提交時去掉殘留的小時欄
      if (rawStep && typeof rawStep === 'object') {
        delete rawStep.remaining_special_leave_hours;
      }

      const validated = validateFormData(fields, rawStep);
      if (validated.error) return res.status(400).json({ error: validated.error });
      actionFormJson = JSON.stringify(validated.data || {});
      let merged = {};
      try {
        merged = JSON.parse(
          db.prepare(`SELECT approver_data_json FROM approval_requests WHERE id = ?`).get(id)
            ?.approver_data_json || '{}'
        );
      } catch {
        merged = {};
      }
      merged[`step_${step.order}`] = {
        step_name: step.name,
        data: validated.data || {},
        by: req.user.id,
        at: tz.nowIso(),
      };
      Object.assign(merged, validated.data || {});
      db.prepare(
        `UPDATE approval_requests SET approver_data_json = ?, updated_at = datetime('now','localtime') WHERE id = ?`
      ).run(JSON.stringify(merged), id);
    }
  }

  const reqGraph = getRequestGraph(detail);

  if (action === 'reject') {
    if (reqGraph) {
      // v2：由引擎決定是整單駁回或退回指定節點
      flowEngine.reject(id, reqGraph, step.nodeId || `n${step.order}`);
    } else {
      db.prepare(
        `UPDATE approval_requests SET status = 'rejected', completed_at = datetime('now', 'localtime'),
         updated_at = datetime('now', 'localtime') WHERE id = ?`
      ).run(id);
    }
    db.prepare(
      `INSERT INTO approval_actions (request_id, step_order, node_id, step_name, actor_id, action, comment, form_data, signature_image, delegated_for_id)
       VALUES (?, ?, ?, ?, ?, 'reject', ?, ?, ?, ?)`
    ).run(id, step.order, step.nodeId || null, step.name, req.user.id, finalComment, actionFormJson, sigImgToSave, delegatedForId);
    const after = getRequestDetail(id);
    const actor = db.prepare(`SELECT name FROM users WHERE id = ?`).get(req.user.id);
    fireAndForgetMail(
      'applicant-reject',
      mail.notifyApplicant(after, 'rejected', {
        actorName: actor?.name,
        comment: finalComment,
      })
    );
    fireAndForgetLine(
      'applicant-reject',
      lineNotify.notifyApplicantLine(after, 'rejected', {
        actorName: actor?.name,
        comment: finalComment,
        baseUrl: getAppBaseUrl(),
        getUsernameById,
      })
    );
    return res.json({ request: after });
  }

  // approve
  db.prepare(
    `INSERT INTO approval_actions (request_id, step_order, node_id, step_name, actor_id, action, comment, form_data, signature_image, delegated_for_id)
     VALUES (?, ?, ?, ?, ?, 'approve', ?, ?, ?, ?)`
  ).run(id, step.order, step.nodeId || null, step.name, req.user.id, finalComment, actionFormJson, sigImgToSave, delegatedForId);

  let mailEvent = null; // approved | step | waiting_co
  let nextStepName = '';
  if (isStepComplete(id, step)) {
    if (reqGraph) {
      // v2：圖引擎推進，可能同時開啟多個並行關卡
      const r = flowEngine.approve(id, reqGraph, step.nodeId || `n${step.order}`, detail.form_data || {});
      mailEvent = r.status === 'approved' ? 'approved' : 'step';
      const idx = flowEngine.indexGraph(reqGraph);
      nextStepName = (r.pending || [])
        .map((nid) => idx.byId.get(nid)?.name || nid)
        .join('、');
    } else {
      const adv = advanceToNextEligibleStep(id, detail, steps, step);
      mailEvent = adv.mailEvent;
      nextStepName = adv.nextStepName;
    }
  } else {
    db.prepare(
      `UPDATE approval_requests SET updated_at = datetime('now', 'localtime') WHERE id = ?`
    ).run(id);
    mailEvent = 'waiting_co';
  }

  let after = getRequestDetail(id);
  const actor = db.prepare(`SELECT name FROM users WHERE id = ?`).get(req.user.id);
  let message = '已核准';
  if (mailEvent === 'approved') {
    const isCredit = isCreditLimitRequestRow(after);
    // 流程模組：最終核准完成後通知選定人員（可開關）
    const finalNotify = enrichFinalNotifyUsers(
      after.finalNotify ||
        workflowModule.parseFinalNotifyJson(
          db
            .prepare(`SELECT final_notify_json FROM workflows WHERE id = ?`)
            .get(after.workflow_id)?.final_notify_json
        )
    );
    const finalNotifyOn = Boolean(finalNotify.enabled);
    const finalNotifyCount = (finalNotify.userIds || []).length;
    const finalNotifyApplies = workflowModule.shouldApplyFinalNotify(
      finalNotify,
      after.requester_id
    );

    if (finalNotifyApplies && finalNotifyCount) {
      message = isCredit
        ? `總經理已完成核定，表單正式「已核准」！系統將通知 ${finalNotifyCount} 位選定人員。`
        : `已核准，簽核流程完成；將系統通知 ${finalNotifyCount} 位選定人員`;
    } else if (finalNotifyOn && !finalNotifyApplies) {
      message = isCredit
        ? '總經理已完成核定，表單正式「已核准」！（此申請人不在最終通知範圍）'
        : '已核准，簽核流程完成（此申請人不在最終通知範圍）';
    } else if (isCredit) {
      message =
        '總經理已完成核定，表單正式「已核准」！系統將通知財務部建檔。';
    } else {
      message = '已核准，簽核流程完成';
    }

    handleP2ApprovedSideEffects(after, req);

    fireAndForgetMail(
      'applicant-approved',
      mail.notifyApplicant(after, 'approved', {
        actorName: actor?.name,
        comment: comment || '同意',
      })
    );
    fireAndForgetLine(
      'applicant-approved',
      lineNotify.notifyApplicantLine(after, 'approved', {
        actorName: actor?.name,
        comment: comment || '同意',
        baseUrl: getAppBaseUrl(),
        getUsernameById,
      })
    );

    // 1) 流程模組：最終核准 → 系統內通知選定人員（需點「確認收到通知」；非 Email）
    // 注意：單據此時已是 approved，通知失敗不可讓整支 API 500
    // 僅當申請人在「需要通知模組」範圍內才寫入
    if (finalNotifyApplies) {
      try {
        const created = createFinalNotifyReceipts(
          id,
          finalNotify,
          req.user.id,
          after.requester_id
        );
        if (created.created > 0) {
          message = isCredit
            ? `總經理已完成核定，表單正式「已核准」！已在系統通知 ${created.created} 位選定人員（待確認收到）。`
            : `已核准，簽核流程完成；已在系統通知 ${created.created} 位選定人員（待確認收到）`;
        } else if (created.skipped && created.reason === 'applicant_not_in_scope') {
          message = isCredit
            ? '總經理已完成核定，表單正式「已核准」！（此申請人不在最終通知對象範圍內）'
            : '已核准，簽核流程完成（此申請人不在最終通知對象範圍內）';
        }
        after = getRequestDetail(id);
      } catch (fnErr) {
        console.error('[final-notify] create receipts failed', fnErr);
        message = isCredit
          ? '總經理已完成核定，表單正式「已核准」！（系統通知寫入失敗，請管理員檢查）'
          : '已核准，簽核流程完成（系統通知寫入失敗，請管理員檢查）';
      }
    }

    // 2) 相容：信用額度未啟用模組通知時，仍 Email 抄送財務（舊行為；建檔確認仍走系統內按鈕）
    if (isCredit && !finalNotifyOn && mail.sendCcNotice) {
      const finUsers = db
        .prepare(`SELECT * FROM users WHERE active = 1`)
        .all()
        .filter((u) => isFinanceUser(u) && u.role !== 'admin');
      const targets = finUsers.length
        ? finUsers
        : db
            .prepare(`SELECT * FROM users WHERE active = 1`)
            .all()
            .filter((u) => isFinanceUser(u));
      for (const fu of targets) {
        const email = String(fu.email || '').trim();
        if (!email || (mail.isPlaceholderEmail && mail.isPlaceholderEmail(email))) {
          continue;
        }
        fireAndForgetMail(
          'finance-cc-credit',
          mail.sendCcNotice({
            to: email,
            toName: fu.name,
            request: after,
            deptName: '財務部（授信額度建檔）',
            actorName: actor?.name,
            kind: 'final_approved',
          })
        );
      }
    }
  } else if (mailEvent === 'step') {
    message = `已核准，已進入下一步「${nextStepName}」並通知簽核人`;
    fireAndForgetMail(
      'applicant-step',
      mail.notifyApplicant(after, 'step', {
        actorName: actor?.name,
        comment: comment || '',
      })
    );
    fireAndForgetLine(
      'applicant-step',
      lineNotify.notifyApplicantLine(after, 'step', {
        actorName: actor?.name,
        comment: comment || '',
        baseUrl: getAppBaseUrl(),
        getUsernameById,
      })
    );
    // 進入下一步（含最終審核步驟）一律通知該步簽核人
    notifyCurrentApprovers(after, 'pending', actor?.name);
  } else if (mailEvent === 'waiting_co') {
    const pendingIds = getPendingApproverIds(id, step);
    const names = pendingIds.map((aid) => {
      const u = db.prepare(`SELECT name FROM users WHERE id = ?`).get(aid);
      return u?.name || `#${aid}`;
    });
    message = names.length
      ? `已核准；此步驟為會簽，尚待：${names.join('、')}`
      : '已核准；此步驟尚待其他簽核人';
    // 提醒尚未核准的會簽人（若已啟用 Email）
    notifyCurrentApprovers(after, 'pending', actor?.name);
  }

  res.json({ request: after, message, mailEvent, nextStepName });
});
};
