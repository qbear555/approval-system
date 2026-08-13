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
 * 一般簽呈（參考 ARGO-簽呈.docx，公文式整齊版面）
 */
function drawGeneralMemoForm(ctx, request) {
  const kit = createSimpleTableKit(ctx, FORM_UI_THEMES.memo);
  const {
    C,
    drawRow,
    textAt,
    textMid,
    fillRect,
    strokeRect,
    ensureSpace,
    drawActionsHistory,
    measureTextH,
    FS_VALUE,
    FS_SMALL,
  } = kit;
  const { doc, useFont, leftX, contentW } = ctx;
  const formData = request.form_data || {};
  const formFields = request.formFields || [];
  const atts = request.attachments || [];

  const created = toRocParts(request.created_at);
  const applyDateText =
    created.y !== ''
      ? `${created.y}年${created.m}月${created.d}日`
      : formatDisplayValue(request.created_at);

  const subjectTitle = String(request.title || '').trim() || '—';
  // 說明欄（富文字）：文字與貼上表格依序完整留在「說明」欄內
  const bodyField =
    (formFields || []).find(
      (f) =>
        f &&
        (f.id === 'subject' ||
          /主旨說明|說明|內容/.test(String(f.label || '')))
    ) || null;
  const bodyFieldId = bodyField?.id || 'subject';
  const bodyRaw =
    pickFormValue(
      formData,
      formFields,
      [bodyFieldId, 'subject', 'desc', 'description', 'reason'],
      /主旨說明|說明|內容|事由/
    ) ||
    formData[bodyFieldId] ||
    formData.subject ||
    '';
  const category =
    pickFormValue(formData, formFields, ['category'], /類別/) || '—';
  const urgentRaw = formData.urgent;
  const isUrgent =
    urgentRaw === true ||
    urgentRaw === 1 ||
    urgentRaw === '1' ||
    urgentRaw === 'true' ||
    urgentRaw === 'on' ||
    urgentRaw === '急件';

  // 抬頭：公司 + 簽呈（深藍系）
  const headH = 70;
  fillRect(leftX, kit.y, contentW, 5, C.header);
  fillRect(leftX, kit.y + 5, contentW, headH - 5, C.headerSoft);
  strokeRect(leftX, kit.y, contentW, headH, C.lineDark, 0.9);
  useFont();
  doc
    .fillColor(C.header)
    .fontSize(12)
    .text(getCompanyNameForPdf(), leftX, kit.y + 14, {
      width: contentW,
      align: 'center',
    });
  doc
    .moveTo(leftX + contentW * 0.32, kit.y + 34)
    .lineTo(leftX + contentW * 0.68, kit.y + 34)
    .strokeColor(C.header)
    .lineWidth(0.9)
    .stroke();
  doc
    .fillColor(C.header)
    .fontSize(22)
    .text('簽　　呈', leftX, kit.y + 40, {
      width: contentW,
      align: 'center',
    });
  kit.y += headH + 8;

  // 單號列
  const metaH = 20;
  fillRect(leftX, kit.y, contentW, metaH, C.altBg);
  strokeRect(leftX, kit.y, contentW, metaH, C.softLine, 0.5);
  textMid(
    `單號 #${request.id}　·　${STATUS_LABEL[request.status] || request.status || ''}${
      isUrgent ? '　·　【急件】' : ''
    }`,
    leftX + 8,
    kit.y,
    contentW - 16,
    metaH,
    { size: FS_SMALL, color: isUrgent ? '#b91c1c' : C.muted, align: 'right' }
  );
  kit.y += metaH + 6;

  // 公文表頭（對照 ARGO-簽呈）
  // 列1：正本受文者 | 發文日期
  const half = Math.floor(contentW / 2);
  drawRow(
    [
      {
        w: half,
        label: '正本受文者',
        value: '總經理／相關單位',
        labelW: 78,
      },
      {
        w: contentW - half,
        label: '發文日期',
        value: applyDateText,
        labelW: 64,
      },
    ],
    28
  );
  // 列2：副本受文者 | 機密等級／類別
  drawRow(
    [
      {
        w: half,
        label: '副本受文者',
        value: '—',
        labelW: 78,
      },
      {
        w: contentW - half,
        label: '類別／等級',
        value: isUrgent ? `${category}（急件）` : String(category),
        labelW: 72,
      },
    ],
    28
  );
  // 列3：承辦人 | 部門 | 頁數
  const c3a = Math.floor(contentW * 0.4);
  const c3b = Math.floor(contentW * 0.35);
  const c3c = contentW - c3a - c3b;
  drawRow(
    [
      {
        w: c3a,
        label: '承辦人',
        value: request.requester_name || '—',
        labelW: 56,
      },
      {
        w: c3b,
        label: '部門',
        value: request.requester_dept || '—',
        labelW: 48,
      },
      {
        w: c3c,
        label: '頁數',
        value: '1',
        labelW: 40,
        align: 'center',
      },
    ],
    28
  );

  // 主旨（量測字級與繪製一致，並加安全邊距）
  const titleValSize = 12;
  useFont();
  doc.fontSize(titleValSize);
  const titleH = Math.max(
    32,
    measureTextH(subjectTitle, contentW - 56 - 14, {
      size: titleValSize,
      lineGap: 2,
    }) + 18
  );
  drawRow(
    [
      {
        w: contentW,
        label: '主旨',
        value: subjectTitle,
        labelW: 56,
        multi: true,
        valueSize: titleValSize,
      },
    ],
    titleH
  );

  // 附件
  const attText = atts.length
    ? atts
        .map((a, i) => `${i + 1}. ${a.original_name || a.filename || '附件'}`)
        .join('；')
    : '無';
  useFont();
  doc.fontSize(FS_VALUE);
  const attH = Math.max(
    28,
    measureTextH(attText, contentW - 56 - 14, { size: FS_VALUE, lineGap: 2 }) +
      16
  );
  drawRow(
    [
      {
        w: contentW,
        label: '附件',
        value: attText,
        labelW: 56,
        multi: true,
      },
    ],
    attH
  );

  // ========== 說明（文字 + 貼上表格完整留在此欄，依原始順序）==========
  drawRichContentInExplainSection(kit, ctx, bodyRaw, {
    sectionTitle: '說　　明',
    legacyTable:
      formData[`${bodyFieldId}__table`] || formData.subject__table || null,
  });

  // 呈請核示
  ensureSpace(36);
  textAt('呈請　核示', leftX, kit.y, contentW, {
    size: 13,
    color: C.ink,
    align: 'center',
  });
  kit.y += 22;
  textAt(
    `${request.requester_dept ? request.requester_dept + '　' : ''}${
      request.requester_name || ''
    }　謹呈`,
    leftX,
    kit.y,
    contentW - 10,
    { size: 11, color: C.softInk, align: 'right' }
  );
  kit.y += 18;

  // 流程
  ensureSpace(28);
  fillRect(leftX, kit.y, contentW, 26, C.headerSoft);
  strokeRect(leftX, kit.y, contentW, 26, C.softLine, 0.5);
  textMid(
    '流程：申請人 → 部門主管 → 會簽人員 → 副總經理 → 總經理',
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
  drawGeneralMemoForm,
};
