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
 * 費用報支專用版面（薔薇紅系，與其他申請單同風格）
 */
function drawExpenseForm(ctx, request) {
  const kit = createSimpleTableKit(ctx, FORM_UI_THEMES.expense);
  const {
    C,
    drawHeader,
    drawRow,
    sectionBar,
    textMid,
    fillRect,
    strokeRect,
    ensureSpace,
    drawActionsHistory,
    FS_VALUE,
  } = kit;
  const { doc, useFont, leftX, contentW } = ctx;
  const formData = request.form_data || {};
  const formFields = request.formFields || [];

  const expenseType =
    pickFormValue(
      formData,
      formFields,
      ['expense_type', 'type', 'category'],
      /費用類別|類別|費用種類/
    ) || '—';
  const currency =
    pickFormValue(formData, formFields, ['currency'], /幣別|幣種/) || 'NTD';
  const amountRaw = pickFormValue(
    formData,
    formFields,
    ['amount', 'total'],
    /金額|總額/
  );
  const expenseDate = pickFormValue(
    formData,
    formFields,
    ['expense_date', 'date', 'occur_date'],
    /發生|費用日|日期/
  );
  const descRaw =
    pickFormValue(
      formData,
      formFields,
      ['desc', 'description', 'reason', '說明'],
      /費用說明|說明|事由/
    ) || '';
  const desc = richHtmlBodyPlain(descRaw) || '—';

  const expP = toRocParts(expenseDate);
  const expenseDateText =
    expP.y !== ''
      ? `民國 ${expP.y} 年 ${expP.m} 月 ${expP.d} 日`
      : expenseDate
        ? formatDisplayValue(expenseDate)
        : '—';
  const created = toRocParts(request.created_at);
  const applyDateText =
    created.y !== ''
      ? `民國 ${created.y} 年 ${created.m} 月 ${created.d} 日`
      : formatDisplayValue(request.created_at);
  const amountDisp = formatMoney(amountRaw);
  const amountLine = `${currency || ''} ${amountDisp}`.trim();

  drawHeader(
    '費  用  報  支  單',
    applyDateText,
    `單號 #${request.id}　·　${STATUS_LABEL[request.status] || request.status || ''}`
  );

  // 申請人 / 單位
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
        label: '單位',
        value: request.requester_dept || '—',
        labelW: 48,
      },
    ],
    30
  );

  // 主旨（有填才顯示）
  const title = String(request.title || '').trim();
  if (title) {
    useFont();
    doc.fontSize(FS_VALUE);
    const titleH = Math.max(
      30,
      doc.heightOfString(title, { width: contentW - 56 - 14 }) + 14
    );
    drawRow(
      [
        {
          w: contentW,
          label: '主旨',
          value: title,
          labelW: 56,
          multi: true,
        },
      ],
      titleH
    );
  }

  // 費用類別 / 發生日期
  const cA = Math.floor(contentW * 0.5);
  const cB = contentW - cA;
  drawRow(
    [
      {
        w: cA,
        label: '費用類別',
        value: String(expenseType),
        labelW: 70,
      },
      {
        w: cB,
        label: '發生日期',
        value: expenseDateText,
        labelW: 70,
      },
    ],
    32
  );

  // 幣別 / 金額
  const c1 = Math.floor(contentW * 0.32);
  const c2 = contentW - c1;
  drawRow(
    [
      {
        w: c1,
        label: '幣別',
        value: String(currency || '—'),
        labelW: 48,
        align: 'center',
      },
      {
        w: c2,
        label: '金額',
        value: amountDisp,
        labelW: 48,
        align: 'center',
        valueSize: 13,
      },
    ],
    34
  );

  // 合計強調列
  drawRow(
    [
      {
        w: contentW,
        label: '報支合計',
        value: amountLine,
        labelW: 70,
      },
    ],
    32
  );

  // 費用說明
  useFont();
  doc.fontSize(FS_VALUE);
  const descStr = String(desc || '—');
  const descH = Math.max(
    48,
    doc.heightOfString(descStr, { width: contentW - 78 - 16 }) + 16
  );
  drawRow(
    [
      {
        w: contentW,
        label: '費用說明',
        value: descStr,
        labelW: 70,
        multi: true,
      },
    ],
    descH
  );
  appendFieldTable(kit, ctx, formData, 'desc', '', descRaw);

  // 附件
  const atts = request.attachments || [];
  sectionBar('附件（單據／發票）');
  if (atts.length) {
    for (let i = 0; i < atts.length; i++) {
      const a = atts[i];
      drawRow(
        [
          {
            w: contentW,
            label: `附件 ${i + 1}`,
            value: a.original_name || a.filename || '—',
            labelW: 64,
          },
        ],
        26
      );
    }
  } else {
    drawRow(
      [
        {
          w: contentW,
          label: '附件',
          value: '（無上傳附件）',
          labelW: 56,
        },
      ],
      28
    );
  }

  kit.y += 8;
  ensureSpace(28);
  fillRect(leftX, kit.y, contentW, 26, C.headerSoft);
  strokeRect(leftX, kit.y, contentW, 26, C.softLine, 0.5);
  textMid(
    '流程：申請人 → 部門主管 → 副總經理 → 總經理',
    leftX + 6,
    kit.y,
    contentW - 12,
    26,
    { size: 9, color: C.muted, align: 'center' }
  );
  kit.y += 32;

  drawActionsHistory(request.actions);
}

module.exports = {
  drawExpenseForm,
};
