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
 * 將簽核單寫入串流（表格化版面）
 */
function drawCreditLimitForm(ctx, request) {
  const kit = createSimpleTableKit(ctx, FORM_UI_THEMES.purchase || {});
  const {
    C,
    drawRow,
    sectionBar,
    drawHeader,
    drawActionsHistory,
    drawAttachments,
    measureTextH,
    ensureSpace,
  } = kit;
  const { doc, useFont, leftX, contentW } = ctx;
  const formData = request.form_data || {};
  const ad = flattenApproverData(request.approver_data) || {};

  // —— 統一欄寬（整數，避免浮點誤差造成格線錯位）——
  // 雙欄：左半／右半；標籤寬全表一致
  const HALF = Math.floor(contentW / 2);
  const HALF_R = contentW - HALF;
  const STD_LW = 88; // 一般雙欄標籤寬
  // 四欄放帳
  const Q = Math.floor(contentW / 4);
  const Q_LAST = contentW - Q * 3;
  const Q_LW = 62;
  // 核決區：左欄（額度）／右欄（條件）固定比例，標籤寬固定 → 垂直格線對齊
  const COL_L = Math.floor(contentW * 0.48);
  const COL_R = contentW - COL_L;
  const LW_L = 118; // 左標籤（業務員申請額度、副總建議…）
  const LW_R = 96; // 右標籤（要求條件、建檔備註）

  const created = toRocParts(request.created_at || formData.apply_date);
  const applyDateText =
    created.y !== ''
      ? `${created.y}年${created.m}月${created.d}日`
      : formatDisplayValue(request.created_at || formData.apply_date);

  const groupName = formData.group_name || '—';

  // 1. 抬頭
  drawHeader(
    '信 用 額 度 申 請 表',
    `${applyDateText}　｜　組別：${groupName}`,
    `單號 #${request.id}　·　${STATUS_LABEL[request.status] || request.status || ''}`
  );

  // 基本資料 (申請人/部門)
  sectionBar('申請資訊');
  const applicant = request.requester_name || '—';
  const dept = request.requester_dept || '—';
  drawRow(
    [
      { w: HALF, label: '申請人', value: applicant, labelW: STD_LW },
      { w: HALF_R, label: '部門', value: dept, labelW: STD_LW },
    ],
    28
  );

  // 2. 第一區塊：客戶基本資料與申請內容
  sectionBar('一、客戶基本資料與申請內容');
  drawRow(
    [
      {
        w: HALF,
        label: '客戶名稱',
        value: formatDisplayValue(formData.customer_name),
        labelW: STD_LW,
      },
      {
        w: HALF_R,
        label: '統一編號',
        value: formatDisplayValue(formData.tax_id),
        labelW: STD_LW,
      },
    ],
    28
  );
  drawRow(
    [
      {
        w: HALF,
        label: '公司性質',
        value: formatDisplayValue(formData.company_type),
        labelW: STD_LW,
      },
      {
        w: HALF_R,
        label: '客戶類別',
        value: formatDisplayValue(formData.customer_type),
        labelW: STD_LW,
      },
    ],
    28
  );

  const tradingProducts = formatDisplayValue(formData.trading_products);
  const tpHeight = Math.max(
    32,
    Math.min(100, measureTextH(tradingProducts, contentW - STD_LW - 16) + 14)
  );
  drawRow(
    [
      {
        w: contentW,
        label: '交易產品',
        value: tradingProducts,
        labelW: STD_LW,
        multi: true,
      },
    ],
    tpHeight
  );

  const reqLimitVal =
    ad.requested_credit_limit ?? formData.requested_credit_limit;
  const requestedLimit =
    reqLimitVal != null && reqLimitVal !== '' ? `${reqLimitVal} 萬元` : '—';
  const reasonText = formatDisplayValue(
    ad.reason_for_increase ?? formData.reason_for_increase
  );
  const reasonHeight = Math.max(
    32,
    Math.min(120, measureTextH(reasonText, COL_R - STD_LW - 16) + 14)
  );
  drawRow(
    [
      {
        w: COL_L,
        label: '申請信用額度',
        value: requestedLimit,
        labelW: STD_LW,
        valueColor: '#c2410c',
      },
      {
        w: COL_R,
        label: '增加額度原由',
        value: reasonText,
        labelW: STD_LW,
        multi: true,
      },
    ],
    reasonHeight
  );

  // 3. 第二區塊：截至目前放帳金額（四欄等寬、標籤同寬）
  sectionBar('二、截至目前放帳金額（含已收未兌現票據及未收款）');
  const creditLimitVal =
    formData.credit_limit_current != null
      ? `${formData.credit_limit_current} 萬元`
      : '—';
  const arVal =
    formData.accounts_receivable != null
      ? `${formData.accounts_receivable} 萬元`
      : '—';
  const nrVal =
    formData.notes_receivable != null
      ? `${formData.notes_receivable} 萬元`
      : '—';
  const balVal =
    formData.credit_balance != null ? `${formData.credit_balance} 萬元` : '—';
  drawRow(
    [
      {
        w: Q,
        label: '授信額度',
        value: creditLimitVal,
        labelW: Q_LW,
        align: 'center',
      },
      {
        w: Q,
        label: '待收帳款',
        value: arVal,
        labelW: Q_LW,
        align: 'center',
      },
      {
        w: Q,
        label: '待收票據',
        value: nrVal,
        labelW: Q_LW,
        align: 'center',
      },
      {
        w: Q_LAST,
        label: '授信餘額',
        value: balVal,
        labelW: Q_LW,
        align: 'center',
        valueColor: '#0f766e',
      },
    ],
    28
  );

  // 4. 第三區塊：銀行徵信與收款狀況（雙欄對齊）
  sectionBar('三、銀行徵信與收款狀況');
  const BANK_LW = 100;
  drawRow(
    [
      {
        w: HALF,
        label: '往來銀行及分行',
        value: formatDisplayValue(formData.bank_name),
        labelW: BANK_LW,
      },
      {
        w: HALF_R,
        label: '甲存帳號／開戶日',
        value: formatDisplayValue(formData.bank_account),
        labelW: BANK_LW,
      },
    ],
    28
  );
  drawRow(
    [
      {
        w: HALF,
        label: '存款基數／往來',
        value: formatDisplayValue(formData.bank_status),
        labelW: BANK_LW,
      },
      {
        w: HALF_R,
        label: '收款狀況',
        value: formatDisplayValue(formData.payment_status),
        labelW: BANK_LW,
      },
    ],
    28
  );

  // 業務人員：取「業務人員」步驟核准人
  const salesActors = actorsForStep(
    request.actions,
    (name) =>
      /業務/.test(String(name || '')) &&
      !/副總|總經|財務/.test(String(name || ''))
  );
  const salesName = salesActors.names || '';
  drawRow(
    [
      {
        w: HALF,
        label: '徵信人',
        value: formatDisplayValue(formData.credit_checker),
        labelW: BANK_LW,
      },
      {
        w: HALF_R,
        label: '業務人員',
        value: salesName || '—',
        labelW: BANK_LW,
      },
    ],
    28
  );

  // 5. 第四區塊：核決（左額度／右條件，標籤寬固定 → 格線垂直對齊）
  sectionBar('四、核決權限與審核建議');

  const salesVal =
    ad.requested_credit_limit ??
    ad.sales_requested_limit ??
    formData.requested_credit_limit ??
    ad.finance_suggested_limit;
  // 金額僅顯示數值；業務姓名已改至「業務人員」欄
  const salesLimit =
    salesVal != null && salesVal !== '' ? `${salesVal} 萬元` : '—';
  const salesCond = formatDisplayValue(
    ad.sales_conditions || ad.finance_conditions
  );
  const salesH = Math.max(
    30,
    Math.min(80, measureTextH(salesCond, COL_R - LW_R - 16) + 14)
  );
  drawRow(
    [
      {
        w: COL_L,
        label: '業務員申請額度',
        value: salesLimit,
        labelW: LW_L,
        valueColor: '#c2410c',
      },
      {
        w: COL_R,
        label: '業務員要求條件',
        value: salesCond,
        labelW: LW_R,
        multi: true,
      },
    ],
    salesH
  );

  // 副總
  const vpLimit =
    ad.vp_suggested_limit != null && ad.vp_suggested_limit !== ''
      ? `${ad.vp_suggested_limit} 萬元`
      : '—';
  const vpCond = formatDisplayValue(ad.vp_conditions);
  const vpH = Math.max(
    30,
    Math.min(80, measureTextH(vpCond, COL_R - LW_R - 16) + 14)
  );
  drawRow(
    [
      {
        w: COL_L,
        label: '副總建議（權限100萬）',
        value: vpLimit,
        labelW: LW_L,
      },
      {
        w: COL_R,
        label: '副總要求條件',
        value: vpCond,
        labelW: LW_R,
        multi: true,
      },
    ],
    vpH
  );

  // 總經理
  const gmApprovedRaw =
    ad.gm_approved_limit != null && ad.gm_approved_limit !== ''
      ? ad.gm_approved_limit
      : null;
  const gmLimit = gmApprovedRaw != null ? `${gmApprovedRaw} 萬元` : '—';
  const gmCond = formatDisplayValue(ad.gm_conditions);
  const gmH = Math.max(
    32,
    Math.min(80, measureTextH(gmCond, COL_R - LW_R - 16) + 14)
  );
  drawRow(
    [
      {
        w: COL_L,
        label: '總經理核定額度',
        value: gmLimit,
        labelW: LW_L,
        valueColor: '#b91c1c',
      },
      {
        w: COL_R,
        label: '總經理要求條件',
        value: gmCond,
        labelW: LW_R,
        multi: true,
      },
    ],
    gmH
  );

  // 財務部建立額度／建檔備註
  const finAction = (request.actions || []).find(
    (a) =>
      a &&
      (a.step_name === '財務部額度建檔確認' ||
        /財務部.*建檔|額度建檔確認/.test(String(a.step_name || '')))
  );
  let finFd = {};
  if (finAction?.form_data) {
    if (typeof finAction.form_data === 'string') {
      try {
        finFd = JSON.parse(finAction.form_data || '{}') || {};
      } catch {
        finFd = {};
      }
    } else if (typeof finAction.form_data === 'object') {
      finFd = finAction.form_data || {};
    }
  }
  const financeConfirmed =
    !!finAction ||
    ad.limit_established_status === '已完成建立' ||
    finFd.limit_established_status === '已完成建立';

  const estLimitVal =
    gmApprovedRaw != null
      ? `${gmApprovedRaw} 萬元`
      : financeConfirmed &&
          (finFd.gm_approved_limit != null || ad.finance_established_limit != null)
        ? `${finFd.gm_approved_limit ?? ad.finance_established_limit} 萬元`
        : '—';
  const estNote = financeConfirmed
    ? '已建立完成'
    : request.status === 'approved'
      ? '待財務部建檔'
      : '—';
  const estH = Math.max(
    30,
    Math.min(80, measureTextH(String(estNote), COL_R - LW_R - 16) + 14)
  );
  drawRow(
    [
      {
        w: COL_L,
        label: '財務部建立額度',
        value: estLimitVal,
        labelW: LW_L,
        valueColor: '#0f766e',
      },
      {
        w: COL_R,
        label: '財務部建檔備註',
        value: estNote,
        labelW: LW_R,
        multi: true,
      },
    ],
    estH
  );

  // 6. 備註說明區塊
  ensureSpace(55);
  kit.y += 8;
  useFont();

  // 底色背框
  const noteBoxH = 45;
  doc.rect(leftX, kit.y, contentW, noteBoxH)
     .fillAndStroke('#f8fafc', '#cbd5e1');

  doc.fontSize(8.5).fillColor('#334155');
  doc.text('備註說明：', leftX + 8, kit.y + 6);
  doc.text('(一) 授信餘額 ＝ 授信額度(信用額度) － 待收帳款(應收帳款) － 待收票據(應收票據)', leftX + 55, kit.y + 6);
  doc.text('(二) 應備附件：(a) 客戶最近 3 年交易清單　(b) 客戶基本資料表　(c) 公司最近期異動資料(可由網路取得)。', leftX + 55, kit.y + 18);
  doc.text('(三) 表單流程：申請人提出申請 → 業務人員確認 → 副總經理核示 → 總經理核定 → 財務部建立額度。', leftX + 55, kit.y + 30);
  kit.y += noteBoxH + 8;

  // 附件與歷程
  drawAttachments(request.attachments || []);
  kit.y += 6;
  drawActionsHistory(request.actions);
}

module.exports = {
  drawCreditLimitForm,
};
