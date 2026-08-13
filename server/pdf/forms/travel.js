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
 * 出差申請專用版面（橄欖綠系）
 * 表格：統一標籤寬、等分欄寬、單行自動縮放，格線對齊
 */
function drawTravelForm(ctx, request) {
  const kit = createSimpleTableKit(ctx, FORM_UI_THEMES.travel);
  const {
    C,
    drawHeader,
    drawRow,
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

  // 統一標籤寬，全表垂直對齊
  const LW = 70;
  const RH = 30; // 標準列高

  const destination =
    pickFormValue(
      formData,
      formFields,
      ['destination', 'place', 'location'],
      /地點|出差地|目的地/
    ) || '—';
  const startDate = pickFormValue(
    formData,
    formFields,
    ['start_date', 'begin_date'],
    /起始|開始/
  );
  const endDate = pickFormValue(
    formData,
    formFields,
    ['end_date', 'finish_date'],
    /結束|迄/
  );
  const purposeRaw =
    pickFormValue(
      formData,
      formFields,
      ['purpose', 'reason', 'desc'],
      /事由|目的|說明/
    ) || '';
  const purpose = richHtmlBodyPlain(purposeRaw) || '—';
  const budgetRaw = pickFormValue(
    formData,
    formFields,
    ['budget', 'amount', 'cost'],
    /預估|費用|預算/
  );
  // 是否申請預支費用（動態欄位 id 或標籤）
  let advance = pickFormValue(
    formData,
    formFields,
    ['advance', 'prepay', 'f_mrsy2tt8_77gi'],
    /預支/
  );
  if (advance === '' || advance == null) {
    for (const [k, v] of Object.entries(formData)) {
      if (k.includes('__')) continue;
      const f = (formFields || []).find((x) => x.id === k);
      if (f && /預支/.test(String(f.label || ''))) {
        advance = v;
        break;
      }
    }
  }
  const advanceYes =
    advance === true ||
    advance === 1 ||
    advance === '1' ||
    advance === 'true' ||
    advance === 'on' ||
    advance === '是';

  const startP = toRocParts(startDate);
  const endP = toRocParts(endDate);
  // 表格日期（單行自動縮放，格線不溢出）
  const fmtDateCell = (p, raw) =>
    p.y !== ''
      ? `民國${p.y}年${p.m}月${p.d}日`
      : raw
        ? formatDisplayValue(raw)
        : '—';
  const startText = fmtDateCell(startP, startDate);
  const endText = fmtDateCell(endP, endDate);
  const created = toRocParts(request.created_at);
  const applyDateText =
    created.y !== ''
      ? `民國 ${created.y} 年 ${created.m} 月 ${created.d} 日`
      : formatDisplayValue(request.created_at);
  const budgetDisp = formatMoney(budgetRaw);
  const budgetText =
    budgetDisp === '—' ? '—' : `NTD ${budgetDisp}`;
  // 天數粗算（含首尾）
  let daysText = '—';
  if (startP.y && endP.y) {
    try {
      const a = new Date(
        Number(startP.y) + 1911,
        Number(startP.m) - 1,
        Number(startP.d)
      );
      const b = new Date(
        Number(endP.y) + 1911,
        Number(endP.m) - 1,
        Number(endP.d)
      );
      if (!Number.isNaN(a.getTime()) && !Number.isNaN(b.getTime()) && b >= a) {
        const d =
          Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
        daysText = `${d} 天`;
      }
    } catch {
      /* ignore */
    }
  }

  // 等分欄寬（最後一欄吸收餘數）
  const half = Math.floor(contentW / 2);
  const col3 = Math.floor(contentW / 3);

  drawHeader(
    '出  差  申  請  單',
    applyDateText,
    `單號 #${request.id}　·　${STATUS_LABEL[request.status] || request.status || ''}`
  );

  // 1) 申請人 / 單位（等分、統一標籤寬）
  drawRow(
    [
      {
        w: half,
        label: '申請人',
        value: request.requester_name || '—',
        labelW: LW,
      },
      {
        w: contentW - half,
        label: '單位',
        value: request.requester_dept || '—',
        labelW: LW,
      },
    ],
    RH
  );

  // 2) 主旨
  const title = String(request.title || '').trim();
  if (title) {
    useFont();
    doc.fontSize(FS_VALUE);
    const titleH = Math.max(
      RH,
      doc.heightOfString(title, { width: contentW - LW - 16 }) + 14
    );
    drawRow(
      [
        {
          w: contentW,
          label: '主旨',
          value: title,
          labelW: LW,
          multi: true,
        },
      ],
      titleH
    );
  }

  // 3) 出差地點
  useFont();
  doc.fontSize(FS_VALUE);
  const destStr = String(destination || '—');
  const destH = Math.max(
    RH,
    doc.heightOfString(destStr, { width: contentW - LW - 16 }) + 14
  );
  drawRow(
    [
      {
        w: contentW,
        label: '出差地點',
        value: destStr,
        labelW: LW,
        multi: destStr.length > 20,
      },
    ],
    destH
  );

  // 4) 起始日 / 結束日 / 天數（等分三欄，格線對齊）
  drawRow(
    [
      {
        w: col3,
        label: '起始日',
        value: startText,
        labelW: LW,
        align: 'center',
      },
      {
        w: col3,
        label: '結束日',
        value: endText,
        labelW: LW,
        align: 'center',
      },
      {
        w: contentW - col3 * 2,
        label: '天數',
        value: daysText,
        labelW: LW,
        align: 'center',
      },
    ],
    32
  );

  // 5) 預估費用 / 申請預支（等分兩欄）
  drawRow(
    [
      {
        w: half,
        label: '預估費用',
        value: budgetText,
        labelW: LW,
        align: 'center',
      },
      {
        w: contentW - half,
        label: '申請預支',
        value: advanceYes ? '■ 是　□ 否' : '□ 是　■ 否',
        labelW: LW,
        align: 'center',
      },
    ],
    32
  );

  // 6) 出差事由
  useFont();
  doc.fontSize(FS_VALUE);
  const purposeStr = String(purpose || '—');
  const purposeH = Math.max(
    44,
    doc.heightOfString(purposeStr, { width: contentW - LW - 16 }) + 16
  );
  drawRow(
    [
      {
        w: contentW,
        label: '出差事由',
        value: purposeStr,
        labelW: LW,
        multi: true,
      },
    ],
    purposeH
  );
  appendFieldTable(kit, ctx, formData, 'purpose', '', purposeRaw);

  // 8) 附件（同一表格風格）

  const atts = request.attachments || [];
  if (atts.length) {
    for (let i = 0; i < atts.length; i++) {
      const a = atts[i];
      drawRow(
        [
          {
            w: contentW,
            label: i === 0 ? '附件' : `附件${i + 1}`,
            value: a.original_name || a.filename || '—',
            labelW: LW,
          },
        ],
        28
      );
    }
  } else {
    drawRow(
      [
        {
          w: contentW,
          label: '附件',
          value: '（無上傳附件）',
          labelW: LW,
        },
      ],
      RH
    );
  }

  // 流程列
  kit.y += 6;
  ensureSpace(28);
  fillRect(leftX, kit.y, contentW, 26, C.headerSoft);
  strokeRect(leftX, kit.y, contentW, 26, C.lineDark, 0.55);
  textMid(
    '流程：申請人 → 人事單位 → 部門主管 → 副總經理 → 總經理',
    leftX + 6,
    kit.y,
    contentW - 12,
    26,
    { size: 9, color: C.muted, align: 'center' }
  );
  kit.y += 30;

  drawActionsHistory(request.actions);
}

module.exports = {
  drawTravelForm,
};
