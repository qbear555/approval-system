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
 * 延長工時申請表（參考紙本，簡單整齊）
 */
function drawOvertimeForm(ctx, request) {
  const kit = createSimpleTableKit(ctx, FORM_UI_THEMES.overtime);
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
    '延 長 工 時 申 請 表',
    applyDateText,
    `單號 #${request.id}　·　${STATUS_LABEL[request.status] || request.status || ''}`
  );

  // 部門 / 姓名
  const half = Math.floor(contentW / 2);
  drawRow(
    [
      {
        w: half,
        label: '部門',
        value: request.requester_dept || '—',
        labelW: 56,
      },
      {
        w: contentW - half,
        label: '姓名',
        value: request.requester_name || '—',
        labelW: 48,
      },
    ],
    30
  );

  // 事由
  const reasonRawOt =
    pickFormValue(formData, formFields, ['reason'], /事由/) || '';
  const reason = richHtmlBodyPlain(reasonRawOt) || '—';
  useFont();
  const reasonH = Math.max(
    40,
    ctx.doc.heightOfString(String(reason), {
      width: contentW - 70 - 14,
      fontSize: FS_VALUE,
    }) + 14
  );
  drawRow(
    [
      {
        w: contentW,
        label: '事由',
        value: reason,
        labelW: 56,
        multi: true,
      },
    ],
    reasonH
  );
  appendFieldTable(kit, ctx, formData, 'reason', '', reasonRawOt);

  // 延長工時時間
  const startP = toRocParts(formData.ot_start);
  const endP = toRocParts(formData.ot_end);
  const hours =
    formData.hours != null && formData.hours !== ''
      ? String(formData.hours)
      : '—';
  const periodH = 56;
  ensureSpace(periodH + 1);
  const labelW = 90;
  fillRect(leftX, kit.y, contentW, periodH, C.cellBg);
  fillRect(leftX, kit.y, labelW, periodH, C.labelBg);
  strokeRect(leftX, kit.y, contentW, periodH, C.lineDark, 0.65);
  ctx.doc
    .moveTo(leftX + labelW, kit.y)
    .lineTo(leftX + labelW, kit.y + periodH)
    .strokeColor(C.line)
    .lineWidth(0.55)
    .stroke();
  textMid('延長工時時間', leftX + 2, kit.y, labelW - 4, periodH, {
    size: 10.5,
    color: C.softInk,
    align: 'center',
  });
  const pX = leftX + labelW + 10;
  const pW = contentW - labelW - 18;
  textAt(
    `從　民國 ${startP.y || '　'} 年 ${startP.m || '　'} 月 ${startP.d || '　'} 日　${startP.hh || '　'} 時 ${startP.mm || '　'} 分`,
    pX,
    kit.y + 8,
    pW,
    { size: 11 }
  );
  textAt(
    `至　民國 ${endP.y || '　'} 年 ${endP.m || '　'} 月 ${endP.d || '　'} 日　${endP.hh || '　'} 時 ${endP.mm || '　'} 分`,
    pX,
    kit.y + 26,
    pW,
    { size: 11 }
  );
  textAt(`總計：${hours} 時`, pX, kit.y + 42, pW, {
    size: 11,
    color: C.ink,
  });
  kit.y += periodH;

  // 選擇項目
  const opt = String(
    pickFormValue(formData, formFields, ['ot_option'], /選擇|項目/) || ''
  );
  const optOther = String(
    pickFormValue(formData, formFields, ['ot_option_other'], /其他/) || ''
  );
  const options = ['補休', '誤餐費', '其他'];
  const optParts = options.map((o) => {
    const on = opt === o || opt.includes(o);
    return `${on ? '■' : '□'} ${o}`;
  });
  let optDisplay = optParts.join('　　');
  if (opt === '其他' || opt.includes('其他')) {
    optDisplay += optOther ? `：${optOther}` : '';
  } else if (opt && !options.includes(opt)) {
    optDisplay = opt;
  }
  drawRow(
    [
      {
        w: contentW,
        label: '選擇項目',
        value: optDisplay || '—',
        labelW: 70,
      },
    ],
    32
  );

  // 人事單位核算
  sectionBar('以下由人事單位核算');
  const actStart = toRocParts(ad.actual_start || formData.ot_start);
  const actEnd = toRocParts(ad.actual_end || formData.ot_end);
  const actHours =
    ad.actual_hours != null && ad.actual_hours !== ''
      ? String(ad.actual_hours)
      : hours;
  const balance =
    ad.comp_leave_balance != null && ad.comp_leave_balance !== ''
      ? String(ad.comp_leave_balance)
      : '—';
  const hrNote = ad.hr_note ? String(ad.hr_note) : '';

  const actH = 56;
  ensureSpace(actH + 1);
  fillRect(leftX, kit.y, contentW, actH, C.cellBg);
  fillRect(leftX, kit.y, labelW, actH, C.labelBg);
  strokeRect(leftX, kit.y, contentW, actH, C.lineDark, 0.65);
  ctx.doc
    .moveTo(leftX + labelW, kit.y)
    .lineTo(leftX + labelW, kit.y + actH)
    .strokeColor(C.line)
    .lineWidth(0.55)
    .stroke();
  textMid('實際工時', leftX + 2, kit.y, labelW - 4, actH, {
    size: 10.5,
    color: C.softInk,
    align: 'center',
  });
  textAt(
    `從　民國 ${actStart.y || '　'} 年 ${actStart.m || '　'} 月 ${actStart.d || '　'} 日　${actStart.hh || '　'} 時 ${actStart.mm || '　'} 分`,
    pX,
    kit.y + 8,
    pW,
    { size: 11 }
  );
  textAt(
    `至　民國 ${actEnd.y || '　'} 年 ${actEnd.m || '　'} 月 ${actEnd.d || '　'} 日　${actEnd.hh || '　'} 時 ${actEnd.mm || '　'} 分`,
    pX,
    kit.y + 26,
    pW,
    { size: 11 }
  );
  textAt(
    `總計：${actHours} 時　　目前累計可用時數：${balance} 時`,
    pX,
    kit.y + 42,
    pW,
    { size: 11 }
  );
  kit.y += actH;

  if (hrNote) {
    drawRow(
      [
        {
          w: contentW,
          label: '備註',
          value: hrNote,
          labelW: 56,
          multi: true,
        },
      ],
      Math.max(
        32,
        ctx.doc.heightOfString(hrNote, {
          width: contentW - 56 - 14,
          fontSize: FS_VALUE,
        }) + 14
      )
    );
  }

  kit.y += 8;
  // 附註
  const notes = [
    '一、各部門確有延時工作需要，由部門主管事先核實指派，於隔日由人事單位核算並於每月底由本表填完後送管理部查核登錄。',
    '二、實際工作時間依刷卡時間時數查核後，以憑填報每月誤餐費請領清冊。',
    '三、延時工作人員均應於工作完成後刷卡，實際工作時數以小時為單位。',
    '四、誤餐費及換特休僅可擇一，不得同時申請。',
    '五、如換特休，最多累計 40 小時，限一年內休完。',
  ];
  for (const n of notes) {
    ensureSpace(20);
    textAt(n, leftX + 2, kit.y, contentW - 4, {
      size: 8.5,
      color: C.muted,
    });
    kit.y += 13;
  }
  kit.y += 4;
  textAt(
    '流程：申請人 → 部門主管 → 副總經理 → 人事單位 → 總經理',
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
  drawOvertimeForm,
};
