const { getChineseFontPath, getCompanyNameForPdf } = require('../font');
const {
  STATUS_LABEL,
  ACTION_LABEL,
  AD_LABELS,
  shortLeaveTypeNamePdf,
  isSpecialLeaveTypePdf,
  hrLeaveLabelsPdf,
  adLabelPdf,
  formatDisplayValue,
  resolveFormTheme,
  FORM_UI_THEMES,
} = require('../meta');
const {
  createSimpleTableKit,
  richHtmlToPlain,
  richHtmlBodyPlain,
  getFormFieldTable,
  drawEmbeddedFormTableOnKit,
  drawRichContentInExplainSection,
  appendFieldTable,
  drawInlineHtmlTablesFromValue,
} = require('../kit');
const {
  formatMoney,
  toRocParts,
  formFieldByLabel,
  pickFormValue,
  drawApproverComments,
  drawSignatureCell,
  formatStepCell,
  actorsForStep,
  flattenApproverData,
  actionsWithWrittenComments,
  historyCommentCell,
} = require('../comments');

/**
 * 電腦異常報修申請單（參考紙本，簡單整齊）
 */
function drawItRepairForm(ctx, request) {
  const kit = createSimpleTableKit(ctx, FORM_UI_THEMES.it);
  const {
    C,
    drawHeader,
    drawRow,
    sectionBar,
    textAt,
    textMid,
    fillRect,
    strokeRect,
    ensureSpace,
    drawActionsHistory,
    drawAttachments,
    FS_VALUE,
  } = kit;
  const { useFont, leftX, contentW } = ctx;
  const formData = request.form_data || {};
  const formFields = request.formFields || [];
  const ad = flattenApproverData(request.approver_data);

  const created = toRocParts(request.created_at);
  const applyDateText =
    created.y !== ''
      ? `民國 ${created.y} 年 ${created.m} 月 ${created.d} 日`
      : formatDisplayValue(request.created_at);

  drawHeader(
    '電 腦 異 常 報 修 申 請 單',
    applyDateText,
    `單號 #${request.id}　·　${STATUS_LABEL[request.status] || request.status || ''}`
  );

  // 申請人 / 部門
  const half = Math.floor(contentW / 2);
  drawRow(
    [
      {
        w: half,
        label: '申請人',
        value: request.requester_name || '—',
        labelW: 64,
      },
      {
        w: contentW - half,
        label: '部門',
        value: request.requester_dept || '—',
        labelW: 48,
      },
    ],
    30
  );

  // 設備異常說明
  sectionBar('設備異常說明');
  const issueRaw =
    pickFormValue(formData, formFields, ['issue_desc'], /異常|故障|說明/) || '';
  const issue = richHtmlBodyPlain(issueRaw) || '—';
  useFont();
  const issueH = Math.max(
    52,
    ctx.doc.heightOfString(String(issue), {
      width: contentW - 16,
      fontSize: FS_VALUE,
    }) + 16
  );
  ensureSpace(issueH + 1);
  fillRect(leftX, kit.y, contentW, issueH, C.cellBg);
  strokeRect(leftX, kit.y, contentW, issueH, C.lineDark, 0.65);
  textAt(issue, leftX + 8, kit.y + 8, contentW - 16, {
    size: FS_VALUE,
    color: C.ink,
    height: issueH - 12,
  });
  kit.y += issueH;
  appendFieldTable(kit, ctx, formData, 'issue_desc', '', issueRaw);

  // 電腦規格
  sectionBar('電腦規格（申請人填寫）');
  const specRaw =
    pickFormValue(formData, formFields, ['computer_spec'], /規格|電腦/) || '';
  const spec = richHtmlBodyPlain(specRaw) || '—';
  useFont();
  const specH = Math.max(
    40,
    ctx.doc.heightOfString(String(spec), {
      width: contentW - 16,
      fontSize: FS_VALUE,
    }) + 16
  );
  ensureSpace(specH + 1);
  fillRect(leftX, kit.y, contentW, specH, C.cellBg);
  strokeRect(leftX, kit.y, contentW, specH, C.lineDark, 0.65);
  textAt(spec, leftX + 8, kit.y + 8, contentW - 16, {
    size: FS_VALUE,
    color: C.ink,
    height: specH - 12,
  });
  kit.y += specH;
  appendFieldTable(kit, ctx, formData, 'computer_spec', '', specRaw);

  // 管理部填寫
  sectionBar('以下由管理部填寫');
  const checks = [
    {
      key: 'pc_acquired_date',
      label: '原電腦取得日期',
      std: '—',
      isDate: true,
    },
    { key: 'check_os', label: '作業系統', std: 'Windows10' },
    { key: 'check_memory', label: '記憶體', std: '4G 以上' },
    { key: 'check_disk', label: '硬碟', std: 'SSD 500G 以上' },
    { key: 'check_3dmark', label: '3DMARK 分數', std: '500 分以上' },
    { key: 'check_email', label: '電子郵件', std: '定期清理' },
    { key: 'check_backup', label: '重要資料', std: '定期備份' },
    { key: 'check_battery', label: '電池容量', std: '70% 以下' },
  ];

  // 表頭
  const colLabel = Math.floor(contentW * 0.28);
  const colVal = Math.floor(contentW * 0.28);
  const colStd = Math.floor(contentW * 0.24);
  const colOk = contentW - colLabel - colVal - colStd;
  const headH = 26;
  ensureSpace(headH);
  fillRect(leftX, kit.y, contentW, headH, C.labelBg);
  strokeRect(leftX, kit.y, contentW, headH, C.lineDark, 0.65);
  let x = leftX;
  const heads = [
    ['檢查項目', colLabel],
    ['填寫／結果', colVal],
    ['檢核標準', colStd],
    ['是否符合', colOk],
  ];
  for (let i = 0; i < heads.length; i++) {
    const [lab, w] = heads[i];
    if (i > 0) {
      ctx.doc
        .moveTo(x, kit.y)
        .lineTo(x, kit.y + headH)
        .strokeColor(C.line)
        .lineWidth(0.5)
        .stroke();
    }
    textMid(lab, x + 4, kit.y, w - 8, headH, {
      size: 10,
      color: C.softInk,
      align: 'center',
    });
    x += w;
  }
  kit.y += headH;

  for (const row of checks) {
    const raw = ad[row.key];
    let val = '—';
    let okText = '—';
    let okColor = C.muted;
    if (row.isDate) {
      val = raw ? formatDisplayValue(raw) : '—';
      okText = '—';
    } else {
      const s = raw != null && raw !== '' ? String(raw) : '';
      if (!s) {
        val = '—';
        okText = '—';
      } else if (s.includes('不符合')) {
        val = s;
        okText = '□ 不符合';
        okColor = C.ng;
      } else if (s.includes('符合')) {
        val = s;
        okText = '■ 符合';
        okColor = C.ok;
      } else {
        val = s;
        okText = '—';
      }
    }

    const rh = 26;
    ensureSpace(rh);
    fillRect(leftX, kit.y, contentW, rh, C.cellBg);
    strokeRect(leftX, kit.y, contentW, rh, C.lineDark, 0.55);
    const vals = [row.label, val, row.std, okText];
    const widths = [colLabel, colVal, colStd, colOk];
    const colors = [C.softInk, C.ink, C.muted, okColor];
    x = leftX;
    for (let i = 0; i < 4; i++) {
      if (i > 0) {
        ctx.doc
          .moveTo(x, kit.y)
          .lineTo(x, kit.y + rh)
          .strokeColor(C.line)
          .lineWidth(0.5)
          .stroke();
      }
      if (i === 0) fillRect(x, kit.y, widths[i], rh, C.labelBg);
      textMid(vals[i], x + 4, kit.y, widths[i] - 8, rh, {
        size: i === 3 ? 10.5 : 10.5,
        color: colors[i],
        align: i === 0 || i === 3 ? 'center' : 'left',
      });
      x += widths[i];
    }
    kit.y += rh;
  }

  // 電腦處理情形
  sectionBar('電腦處理情形');
  const handleResult = ad.handle_result ? String(ad.handle_result) : '—';
  const handleNote = ad.handle_note ? String(ad.handle_note) : '';
  const handleText = handleNote
    ? `${handleResult}\n說明：${handleNote}`
    : handleResult;
  useFont();
  const handleH = Math.max(
    48,
    ctx.doc.heightOfString(handleText, {
      width: contentW - 16,
      fontSize: FS_VALUE,
    }) + 16
  );
  ensureSpace(handleH + 1);
  fillRect(leftX, kit.y, contentW, handleH, C.cellBg);
  strokeRect(leftX, kit.y, contentW, handleH, C.lineDark, 0.65);
  textAt(handleText, leftX + 8, kit.y + 8, contentW - 16, {
    size: FS_VALUE,
    color: C.ink,
  });
  kit.y += handleH + 8;

  // 備註
  textAt(
    '※ 檢核標準自 2024 年 3 月核定，日後將依照符合當時電腦規格提升而變動。',
    leftX + 2,
    kit.y,
    contentW - 4,
    { size: 9, color: C.muted }
  );
  kit.y += 14;
  textAt(
    '流程：申請人 → 管理部檢修 → 副總經理 → 總經理',
    leftX + 2,
    kit.y,
    contentW - 4,
    { size: 9, color: C.muted }
  );
  kit.y += 16;

  drawAttachments(request.attachments || []);
  kit.y += 6;
  drawActionsHistory(request.actions);
}

module.exports = {
  drawItRepairForm,
};
