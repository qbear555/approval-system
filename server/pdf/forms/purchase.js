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
 * 請購申請專用版面
 * 參考支付申請欄位，風格與其他申請單一致（簡潔灰階表格）
 */
function drawPurchaseForm(ctx, request) {
  const kit = createSimpleTableKit(ctx, FORM_UI_THEMES.purchase);
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
    FS_LABEL,
  } = kit;
  const { doc, useFont, leftX, contentW } = ctx;
  const formData = request.form_data || {};
  const formFields = request.formFields || [];

  const itemName =
    pickFormValue(formData, formFields, ['item_name', 'item'], /品名|項目/) ||
    '—';
  const qty = pickFormValue(formData, formFields, ['qty', 'quantity'], /數量/);
  const currency =
    pickFormValue(formData, formFields, ['currency'], /幣別|幣種/) || 'NTD';
  const amountRaw = pickFormValue(
    formData,
    formFields,
    ['amount', 'total'],
    /金額|總額/
  );
  const vendor =
    pickFormValue(
      formData,
      formFields,
      ['vendor', 'supplier', 'customer'],
      /廠商|供應|客戶/
    ) || '—';
  const reasonRaw =
    pickFormValue(
      formData,
      formFields,
      ['reason', 'purpose', 'usage'],
      /事由|用途|說明/
    ) || '';
  const reason = richHtmlBodyPlain(reasonRaw) || '—';
  const needDate = pickFormValue(
    formData,
    formFields,
    ['need_date', 'needDate', 'required_date'],
    /需用|需求日/
  );
  const needP = toRocParts(needDate);
  const needDateText =
    needP.y !== ''
      ? `民國 ${needP.y} 年 ${needP.m} 月 ${needP.d} 日`
      : needDate
        ? formatDisplayValue(needDate)
        : '—';
  const created = toRocParts(request.created_at);
  const applyDateText =
    created.y !== ''
      ? `民國 ${created.y} 年 ${created.m} 月 ${created.d} 日`
      : formatDisplayValue(request.created_at);
  const qtyText = qty != null && qty !== '' ? String(qty) : '—';
  const amountDisp = formatMoney(amountRaw);

  drawHeader(
    '請  購  申  請  單',
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

  // 品名 / 數量
  const itemW = Math.floor(contentW * 0.7);
  const qtyW = contentW - itemW;
  useFont();
  doc.fontSize(FS_VALUE);
  const itemH = Math.max(
    32,
    doc.heightOfString(String(itemName), {
      width: itemW - 78 - 16,
    }) + 14
  );
  drawRow(
    [
      {
        w: itemW,
        label: '品名／項目',
        value: itemName,
        labelW: 78,
        multi: String(itemName).length > 14,
      },
      {
        w: qtyW,
        label: '數量',
        value: qtyText,
        labelW: 48,
        align: 'center',
      },
    ],
    itemH
  );

  // 幣別 / 預估金額 / 需用日期
  const c1 = Math.floor(contentW * 0.28);
  const c2 = Math.floor(contentW * 0.36);
  const c3 = contentW - c1 - c2;
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
        label: '預估金額',
        value: amountDisp,
        labelW: 64,
        align: 'center',
        valueSize: 12,
      },
      {
        w: c3,
        label: '需用日期',
        value: needDateText,
        labelW: 64,
      },
    ],
    32
  );

  // 合計列
  drawRow(
    [
      {
        w: contentW,
        label: '合計金額',
        value: `${currency || ''} ${amountDisp}　／　數量 ${qtyText}`.trim(),
        labelW: 70,
      },
    ],
    30
  );

  // 支付方式（現金／期票／其他）
  const payMethod =
    pickFormValue(
      formData,
      formFields,
      ['payment_method', 'pay_method', 'pay_type'],
      /支付方式|付款方式/
    ) || '';
  const payNote =
    pickFormValue(
      formData,
      formFields,
      ['payment_note', 'pay_note', 'payment_detail'],
      /支付說明|到期日|付款說明/
    ) || '';
  let payDisplay = payMethod ? String(payMethod) : '—';
  if (payNote) {
    if (/期票/.test(String(payMethod))) {
      payDisplay = `${payMethod}（到期日：${payNote}）`;
    } else if (/其他/.test(String(payMethod))) {
      payDisplay = `${payMethod}：${payNote}`;
    } else {
      payDisplay = `${payMethod}　／　${payNote}`;
    }
  }
  // 勾選式呈現（對照紙本支付申請）
  const payOpts = ['現金', '期票', '其他'];
  const payCheckLine = payOpts
    .map((o) => {
      const on =
        String(payMethod) === o || String(payMethod).includes(o);
      return `${on ? '■' : '□'} ${o}`;
    })
    .join('　　');
  const payValue = payMethod
    ? `${payCheckLine}${
        payNote
          ? `\n說明：${payNote}`
          : ''
      }`
    : '—';
  useFont();
  doc.fontSize(FS_VALUE);
  const payH = Math.max(
    32,
    doc.heightOfString(payValue, { width: contentW - 78 - 16 }) + 14
  );
  drawRow(
    [
      {
        w: contentW,
        label: '支付方式',
        value: payValue,
        labelW: 70,
        multi: true,
      },
    ],
    payH
  );

  // 廠商
  useFont();
  doc.fontSize(FS_VALUE);
  const vendorH = Math.max(
    32,
    doc.heightOfString(String(vendor), { width: contentW - 70 - 16 }) + 14
  );
  drawRow(
    [
      {
        w: contentW,
        label: '廠商',
        value: vendor,
        labelW: 56,
        multi: true,
      },
    ],
    vendorH
  );

  // 用途／事由
  useFont();
  doc.fontSize(FS_VALUE);
  const reasonH = Math.max(
    44,
    doc.heightOfString(String(reason), { width: contentW - 78 - 16 }) + 16
  );
  drawRow(
    [
      {
        w: contentW,
        label: '用途／事由',
        value: reason,
        labelW: 78,
        multi: true,
      },
    ],
    reasonH
  );
  // 貼上表格完整留在「用途／事由」欄下方（不另開附表）
  appendFieldTable(kit, ctx, formData, 'reason', '', reasonRaw);

  // 附件
  const atts = request.attachments || [];
  sectionBar('附件');
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
  drawPurchaseForm,
};
