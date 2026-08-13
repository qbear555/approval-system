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

function drawLeaveForm(ctx, request) {
  const { doc, useFont, leftX, contentW, pageH, margin } = ctx;
  let y = margin;
  const formData = request.form_data || {};
  const formFields = request.formFields || [];
  const ad = flattenApproverData(request.approver_data);

  // 請假單：青綠系（與其他申請單區隔）
  const T = FORM_UI_THEMES.leave;
  const C = {
    ink: '#0f172a',
    softInk: T.softInk,
    muted: '#64748b',
    line: T.line,
    lineDark: T.lineDark,
    softLine: T.softLine,
    header: T.header,
    headerDark: T.softInk,
    headerSoft: T.headerSoft,
    labelBg: T.labelBg,
    noticeBg: '#fffbeb',
    noticeBorder: '#f59e0b',
    white: '#ffffff',
    cellBg: '#ffffff',
    altBg: T.altBg,
    totalBg: T.headerSoft,
  };

  // 統一欄寬格線（整表外框一次描，內線對齊）
  const LW = 70; // 左側標籤寬
  const FS_LABEL = 10.5;
  const FS_VALUE = 11.5;
  const FS_SMALL = 9.5;

  function ensureSpace(need) {
    if (y + need > pageH - margin - 18) {
      doc.addPage();
      y = margin;
      return true;
    }
    return false;
  }

  function strokeRect(x, yy, w, h, color, width) {
    doc
      .rect(x, yy, w, h)
      .strokeColor(color || C.line)
      .lineWidth(width || 0.7)
      .stroke();
  }

  function fillRect(x, yy, w, h, color) {
    doc.rect(x, yy, w, h).fill(color);
  }

  function textAt(str, x, yy, w, opts = {}) {
    useFont();
    doc
      .fillColor(opts.color || C.ink)
      .fontSize(opts.size || FS_VALUE)
      .text(String(str ?? ''), x, yy, {
        width: w,
        align: opts.align || 'left',
        lineBreak: opts.lineBreak !== false,
      });
  }

  /** 垂直置中單行文字 */
  function textMid(str, x, yy, w, h, opts = {}) {
    useFont();
    const size = opts.size || FS_VALUE;
    const approx = size * 0.9;
    const ty = yy + Math.max(4, (h - approx) / 2);
    doc
      .fillColor(opts.color || C.ink)
      .fontSize(size)
      .text(String(str ?? ''), x, ty, {
        width: w,
        align: opts.align || 'left',
        lineBreak: false,
      });
  }

  /**
   * 單行文字自動縮放以符合寬度（不換行、不分段）
   * @param {string} str
   * @param {number} x
   * @param {number} yy 列頂
   * @param {number} w 可用寬度
   * @param {number} h 列高
   * @param {{ maxSize?: number, minSize?: number, color?: string, align?: string }} opts
   */
  function textFitOneLine(str, x, yy, w, h, opts = {}) {
    useFont();
    const text = String(str ?? '');
    const maxSize = opts.maxSize != null ? opts.maxSize : FS_VALUE;
    const minSize = opts.minSize != null ? opts.minSize : 7;
    let size = maxSize;
    const maxW = Math.max(8, w);
    while (size > minSize) {
      doc.fontSize(size);
      const tw = doc.widthOfString(text);
      if (tw <= maxW) break;
      size -= 0.5;
    }
    doc.fontSize(size);
    // 仍超寬時截斷尾端加 …
    let draw = text;
    let tw = doc.widthOfString(draw);
    if (tw > maxW && draw.length > 1) {
      while (draw.length > 1 && doc.widthOfString(draw + '…') > maxW) {
        draw = draw.slice(0, -1);
      }
      draw = draw + '…';
    }
    const ty = yy + Math.max(3, (h - size * 0.9) / 2);
    doc
      .fillColor(opts.color || C.ink)
      .fontSize(size)
      .text(draw, x, ty, {
        width: maxW,
        align: opts.align || 'left',
        lineBreak: false,
        ellipsis: false,
      });
  }

  /**
   * 畫一列表格列：cells = [{ w, label?, value, labelW?, bg?, labelBg?, align? }]
   * 同一列高度 h，外框 + 內部分隔線
   */
  function drawRow(cells, h, opts = {}) {
    ensureSpace(h + 1);
    const lineW = opts.lineW || 0.65;
    let x = leftX;
    // 底
    fillRect(leftX, y, contentW, h, opts.bg || C.cellBg);
    for (const c of cells) {
      const lw = c.label != null ? c.labelW || LW : 0;
      if (c.label != null) {
        fillRect(x, y, lw, h, c.labelBg || C.labelBg);
      }
      if (c.bg) fillRect(x + lw, y, c.w - lw, h, c.bg);
      x += c.w;
    }
    // 外框
    strokeRect(leftX, y, contentW, h, C.lineDark, lineW);
    // 內線與文字
    x = leftX;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      const lw = c.label != null ? c.labelW || LW : 0;
      if (i > 0) {
        doc
          .moveTo(x, y)
          .lineTo(x, y + h)
          .strokeColor(C.line)
          .lineWidth(lineW)
          .stroke();
      }
      if (c.label != null) {
        doc
          .moveTo(x + lw, y)
          .lineTo(x + lw, y + h)
          .strokeColor(C.line)
          .lineWidth(lineW)
          .stroke();
        textMid(c.label, x + 3, y, lw - 6, h, {
          size: FS_LABEL,
          color: C.softInk,
          align: 'center',
        });
        if (c.multi) {
          textAt(c.value || '—', x + lw + 8, y + 7, c.w - lw - 14, {
            size: c.valueSize || FS_VALUE,
            color: C.ink,
          });
        } else {
          textMid(c.value || '—', x + lw + 8, y, c.w - lw - 14, h, {
            size: c.valueSize || FS_VALUE,
            color: c.valueColor || C.ink,
            align: c.align || 'left',
          });
        }
      } else if (c.value != null) {
        if (c.multi) {
          textAt(c.value, x + 8, y + 7, c.w - 14, {
            size: c.valueSize || FS_VALUE,
            color: c.valueColor || C.ink,
            align: c.align || 'left',
          });
        } else {
          textMid(c.value, x + 6, y, c.w - 12, h, {
            size: c.valueSize || FS_VALUE,
            color: c.valueColor || C.ink,
            align: c.align || 'left',
          });
        }
      }
      x += c.w;
    }
    y += h;
  }

  // ========== 取值 ==========
  // 代理人：優先顯示姓名（部門改放在「單位」欄，避免重複）
  const agentRaw =
    formData.agent__name ||
    pickFormValue(formData, formFields, ['agent'], /代理/) ||
    '';
  const agent = String(agentRaw)
    .replace(/（[^）]*）\s*$/g, '')
    .replace(/\([^)]*\)\s*$/g, '')
    .trim() || '—';
  // 單位欄：申請人部門
  const unitDept =
    (request.requester_dept && String(request.requester_dept).trim()) ||
    (request.department && String(request.department).trim()) ||
    (formData.department && String(formData.department).trim()) ||
    (formData.unit && String(formData.unit).trim()) ||
    '';
  const leaveType =
    pickFormValue(formData, formFields, ['leave_type'], /假別/) || '—';
  const reason =
    pickFormValue(formData, formFields, ['reason'], /事由/) ||
    request.title ||
    '—';
  const handover =
    pickFormValue(
      formData,
      formFields,
      ['handover', 'hand_over', '交接事項'],
      /交接/
    ) || '';
  const days = formData.days != null && formData.days !== '' ? formData.days : '';
  const hours =
    formData.hours != null && formData.hours !== '' ? formData.hours : '';
  const startP = toRocParts(formData.start_date);
  const endP = toRocParts(formData.end_date);
  // 特休以日為準，不顯示小時換算
  const leaveIsSpecial = isSpecialLeaveTypePdf(leaveType);
  const totalText = leaveIsSpecial
    ? days !== '' && days != null
      ? `${days} 天`
      : '—'
    : [
        days !== '' && days != null ? `${days} 天` : '',
        hours !== '' && hours != null ? `${hours} 時` : '',
      ]
        .filter(Boolean)
        .join('　') || '—';
  const created = toRocParts(request.created_at);
  const applyDateText =
    created.y !== ''
      ? `民國 ${created.y} 年 ${created.m} 月 ${created.d} 日`
      : formatDisplayValue(request.created_at);
  // 請假期間文字（精簡、易讀）
  const fmtPeriodLine = (p, prefix, suffix) => {
    if (!p || p.y === '') return `${prefix}　—　${suffix}`;
    const hm =
      p.hh !== ''
        ? ` ${p.hh}:${(p.mm || '00').padStart(2, '0')}`
        : '';
    return `${prefix} 民國${p.y}年${p.m}月${p.d}日${hm} ${suffix}`;
  };

  // ========== 抬頭（僅中文公司名） ==========
  const headH = 72;
  // 頂部主色條
  fillRect(leftX, y, contentW, 4, C.header);
  fillRect(leftX, y + 4, contentW, headH - 4, C.headerSoft);
  strokeRect(leftX, y, contentW, headH, C.header, 1.1);

  useFont();
  doc
    .fillColor(C.headerDark)
    .fontSize(13)
    .text(getCompanyNameForPdf(), leftX, y + 14, {
      width: contentW,
      align: 'center',
    });
  // 底線分隔
  doc
    .moveTo(leftX + contentW * 0.28, y + 34)
    .lineTo(leftX + contentW * 0.72, y + 34)
    .strokeColor(C.header)
    .lineWidth(0.8)
    .stroke();
  doc
    .fillColor(C.headerDark)
    .fontSize(22)
    .text('請　假　單', leftX, y + 40, {
      width: contentW,
      align: 'center',
    });
  y += headH + 6;

  // 申請日／單號（單行資訊列）
  const metaH = 22;
  fillRect(leftX, y, contentW, metaH, C.altBg);
  strokeRect(leftX, y, contentW, metaH, C.softLine, 0.5);
  textMid(
    `申請日：${applyDateText}`,
    leftX + 10,
    y,
    contentW * 0.55,
    metaH,
    { size: FS_SMALL, color: C.softInk }
  );
  textMid(
    `單號 #${request.id}　·　${STATUS_LABEL[request.status] || request.status || ''}`,
    leftX + contentW * 0.45,
    y,
    contentW * 0.55 - 10,
    metaH,
    { size: FS_SMALL, color: C.muted, align: 'right' }
  );
  y += metaH + 8;

  // ========== 主表：統一格線 ==========
  // 第1列：申請人 | 單位（部門）| 職務代理人
  const colApplicant = Math.floor(contentW * 0.30);
  const colUnit = Math.floor(contentW * 0.30);
  const colAgent = contentW - colApplicant - colUnit;
  useFont();
  doc.fontSize(FS_VALUE);
  const row1H = Math.max(
    32,
    doc.heightOfString(String(agent), { width: colAgent - 78 - 12 }) + 14,
    doc.heightOfString(String(unitDept || '—'), {
      width: colUnit - 56 - 12,
    }) + 14
  );
  drawRow(
    [
      {
        w: colApplicant,
        label: '申請人',
        value: request.requester_name || '—',
        labelW: 52,
      },
      {
        w: colUnit,
        // 紙本「單位」欄：填入申請人部門
        label: '單位',
        value: unitDept || '—',
        labelW: 48,
        multi: String(unitDept || '').length > 8,
      },
      {
        w: colAgent,
        label: '職務代理人',
        value: agent,
        labelW: 72,
        multi: String(agent).length > 6,
      },
    ],
    row1H
  );

  // 第2列：假別 + 事由
  const leaveCol = Math.floor(contentW * 0.38);
  const reasonCol = contentW - leaveCol;
  useFont();
  doc.fontSize(FS_VALUE);
  const leaveTypeStr = String(leaveType || '—');
  const reasonStr = String(reason || '—');
  const reasonH = Math.max(
    34,
    doc.heightOfString(leaveTypeStr, { width: leaveCol - 48 - 14 }) + 16,
    doc.heightOfString(reasonStr, { width: reasonCol - 48 - 14 }) + 16
  );
  drawRow(
    [
      {
        w: leaveCol,
        label: '假別',
        value: leaveTypeStr,
        labelW: 48,
        multi: leaveTypeStr.length > 8,
      },
      {
        w: reasonCol,
        label: '事由',
        value: reasonStr,
        labelW: 48,
        multi: true,
      },
    ],
    reasonH
  );

  // 第3列：請假期間 + 合計
  const totalW = 100;
  const periodW = contentW - totalW;
  const periodH = 52;
  ensureSpace(periodH + 1);
  fillRect(leftX, y, periodW, periodH, C.cellBg);
  fillRect(leftX, y, LW, periodH, C.labelBg);
  fillRect(leftX + periodW, y, totalW, periodH, C.totalBg);
  strokeRect(leftX, y, contentW, periodH, C.lineDark, 0.65);
  doc
    .moveTo(leftX + LW, y)
    .lineTo(leftX + LW, y + periodH)
    .strokeColor(C.line)
    .lineWidth(0.65)
    .stroke();
  doc
    .moveTo(leftX + periodW, y)
    .lineTo(leftX + periodW, y + periodH)
    .strokeColor(C.line)
    .lineWidth(0.65)
    .stroke();
  textMid('請假期間', leftX + 3, y, LW - 6, periodH, {
    size: FS_LABEL,
    color: C.softInk,
    align: 'center',
  });
  const pInnerX = leftX + LW + 10;
  const pInnerW = periodW - LW - 16;
  textAt(fmtPeriodLine(startP, '自', '起'), pInnerX, y + 10, pInnerW, {
    size: 11,
  });
  textAt(fmtPeriodLine(endP, '至', '止'), pInnerX, y + 28, pInnerW, {
    size: 11,
  });
  textMid('合計', leftX + periodW + 4, y + 6, totalW - 8, 18, {
    size: FS_LABEL,
    color: C.header,
    align: 'center',
  });
  textMid(totalText, leftX + periodW + 4, y + 24, totalW - 8, 22, {
    size: 12.5,
    color: C.headerDark,
    align: 'center',
  });
  y += periodH;

  // 第4列：交接事項
  const handText = String(handover || '').trim() || '—';
  useFont();
  doc.fontSize(FS_VALUE);
  const handH = Math.max(
    36,
    doc.heightOfString(handText, {
      width: contentW - LW - 18,
    }) + 16
  );
  drawRow(
    [
      {
        w: contentW,
        label: '交接事項',
        value: handText,
        labelW: LW,
        multi: true,
      },
    ],
    handH
  );

  // 說明／事由／交接等自繪表格
  {
    const leaveKit = {
      C,
      get y() {
        return y;
      },
      set y(v) {
        y = v;
      },
      ensureSpace,
      fillRect,
      strokeRect,
    };
    const tableFields = (formFields || []).filter((f) => f.type === 'textarea');
    for (const f of tableFields) {
      const tbl = getFormFieldTable(formData, f.id);
      if (tbl) {
        drawEmbeddedFormTableOnKit(leaveKit, tbl, {
          ctx,
          title: `${f.label || '附表'}附表`,
        });
      }
    }
    // 無 schema 時仍嘗試常見鍵
    for (const [fid, title] of [
      ['reason', '事由附表'],
      ['f_mrssswlt_nrkz', '交接事項附表'],
    ]) {
      if (tableFields.some((f) => f.id === fid)) continue;
      const tbl = getFormFieldTable(formData, fid);
      if (tbl) drawEmbeddedFormTableOnKit(leaveKit, tbl, { ctx, title });
    }
  }

  // 注意列（併入表格風格）
  const noteH = 26;
  ensureSpace(noteH + 2);
  fillRect(leftX, y, contentW, noteH, C.noticeBg);
  strokeRect(leftX, y, contentW, noteH, C.noticeBorder, 0.7);
  textMid(
    '※ 業務部、管理部、工程部同仁，如有請休假，都必須設定 email 自動回覆。',
    leftX + 10,
    y,
    contentW - 20,
    noteH,
    { size: FS_SMALL, color: '#92400e' }
  );
  y += noteH + 10;

  // ========== 差假統計（三欄：核定假別／本次天數／剩餘日數；不顯示特休小時） ==========
  const hrTypeRaw = String(ad.hr_leave_type || leaveType || '').trim();
  const hrType = hrTypeRaw || '—';
  const hrLab = hrLeaveLabelsPdf(hrTypeRaw);
  const remDays =
    ad.remaining_special_leave_days != null &&
    ad.remaining_special_leave_days !== ''
      ? String(ad.remaining_special_leave_days)
      : '—';
  const hrNote = ad.hr_note ? String(ad.hr_note) : '';

  // 差假統計整塊表格：標題列 + 資料列（＋可選備註列），線條最後一次畫齊
  const remDayLab = hrLab.remDaysShort || '剩餘日數';
  const remLabW = Math.min(78, Math.max(52, Math.ceil(remDayLab.length * 10.5)));
  const s3 = Math.floor(contentW / 3);
  const s3last = contentW - s3 * 2;
  // 特休：本次欄改稱「本次天數」；其他假別仍可顯示日／時
  const amountLab = isSpecialLeaveTypePdf(hrTypeRaw) ? '本次天數' : '本次時數';
  const amountVal = isSpecialLeaveTypePdf(hrTypeRaw)
    ? days !== '' && days != null
      ? `${days} 天`
      : totalText
    : totalText;
  const statCells = [
    { w: s3, label: '核定假別', value: hrType, labelW: 52 },
    { w: s3, label: amountLab, value: amountVal, labelW: 52 },
    { w: s3last, label: remDayLab, value: remDays, labelW: remLabW },
  ];
  // 驗證欄寬合計 = contentW
  const statWSum = statCells.reduce((a, c) => a + c.w, 0);
  if (statWSum !== contentW && statCells.length) {
    statCells[statCells.length - 1].w += contentW - statWSum;
  }

  const titleH = 26;
  const statRowH = 32;
  useFont();
  doc.fontSize(FS_VALUE);
  const noteLabW = 70;
  const hrNoteH = hrNote
    ? Math.max(
        28,
        doc.heightOfString(hrNote, {
          width: contentW - noteLabW - 16,
        }) + 14
      )
    : 0;
  const blockH = titleH + statRowH + hrNoteH;
  ensureSpace(blockH + 4);

  const blockTop = y;
  const dataTop = blockTop + titleH;
  const noteTop = dataTop + statRowH;
  const lineW = 0.75;
  const lineColor = C.lineDark;

  // —— 1) 填底色（不畫線）——
  fillRect(leftX, blockTop, contentW, titleH, C.header);
  fillRect(leftX, dataTop, contentW, statRowH, C.cellBg);
  let sx = leftX;
  for (const c of statCells) {
    fillRect(sx, dataTop, c.labelW, statRowH, C.labelBg);
    sx += c.w;
  }
  if (hrNote) {
    fillRect(leftX, noteTop, contentW, hrNoteH, C.cellBg);
    fillRect(leftX, noteTop, noteLabW, hrNoteH, C.labelBg);
  }

  // —— 2) 文字 ——
  textMid('差假統計（人事核定）', leftX + 10, blockTop, contentW - 20, titleH, {
    size: 11.5,
    color: C.white,
  });
  sx = leftX;
  for (const c of statCells) {
    textFitOneLine(c.label, sx + 3, dataTop, c.labelW - 6, statRowH, {
      maxSize: 9.5,
      minSize: 6.5,
      color: C.softInk,
      align: 'center',
    });
    textFitOneLine(
      c.value,
      sx + c.labelW + 4,
      dataTop,
      c.w - c.labelW - 8,
      statRowH,
      {
        maxSize: 11,
        minSize: 7,
        color: C.ink,
        align: 'center',
      }
    );
    sx += c.w;
  }
  if (hrNote) {
    textFitOneLine('人事備註', leftX + 3, noteTop, noteLabW - 6, hrNoteH, {
      maxSize: 10,
      minSize: 7,
      color: C.softInk,
      align: 'center',
    });
    useFont();
    doc
      .fillColor(C.ink)
      .fontSize(FS_VALUE)
      .text(hrNote, leftX + noteLabW + 8, noteTop + 7, {
        width: contentW - noteLabW - 16,
        align: 'left',
        lineBreak: true,
      });
  }

  // —— 3) 線條（最後畫，確保不被底色蓋住）——
  // 外框
  doc
    .rect(leftX, blockTop, contentW, blockH)
    .strokeColor(lineColor)
    .lineWidth(lineW)
    .stroke();
  // 標題列底線
  doc
    .moveTo(leftX, dataTop)
    .lineTo(leftX + contentW, dataTop)
    .strokeColor(lineColor)
    .lineWidth(lineW)
    .stroke();
  // 資料列底線（有備註時）
  if (hrNote) {
    doc
      .moveTo(leftX, noteTop)
      .lineTo(leftX + contentW, noteTop)
      .strokeColor(lineColor)
      .lineWidth(lineW)
      .stroke();
    // 備註標籤右界
    doc
      .moveTo(leftX + noteLabW, noteTop)
      .lineTo(leftX + noteLabW, noteTop + hrNoteH)
      .strokeColor(lineColor)
      .lineWidth(lineW)
      .stroke();
  }
  // 資料列垂直分隔（欄界 + 標籤／值中線）
  sx = leftX;
  for (let i = 0; i < statCells.length; i++) {
    const c = statCells[i];
    if (i > 0) {
      doc
        .moveTo(sx, dataTop)
        .lineTo(sx, dataTop + statRowH)
        .strokeColor(lineColor)
        .lineWidth(lineW)
        .stroke();
    }
    doc
      .moveTo(sx + c.labelW, dataTop)
      .lineTo(sx + c.labelW, dataTop + statRowH)
      .strokeColor(lineColor)
      .lineWidth(lineW)
      .stroke();
    sx += c.w;
  }

  y = blockTop + blockH;

  y += 8;
  // 規定
  ensureSpace(36);
  textAt(
    '1. 申請事假、年休假、公假須事前提出申請。　2. 申請病假請檢附掛號費影本，公假請檢附相關證明文件。',
    leftX + 2,
    y,
    contentW - 4,
    { size: 9, color: C.muted }
  );
  y += 18;

  // 流程
  ensureSpace(30);
  fillRect(leftX, y, contentW, 28, C.headerSoft);
  strokeRect(leftX, y, contentW, 28, C.header, 0.55);
  textMid(
    '流程：申請人 → 職務代理人 → 單位主管 → 人事單位 → 副總經理 → 總經理 → 人事留存',
    leftX + 6,
    y,
    contentW - 12,
    28,
    { size: 9, color: C.headerDark, align: 'center' }
  );
  y += 36;

  // ========== 簽核意見 ／ 簽核歷程 ==========
  const actions = (request.actions || []).filter(
    (a) =>
      a.action !== 'comment' || (a.comment && !/Email 催辦/.test(a.comment || ''))
  );
  if (actions.length) {
    // 簽核人員填寫的意見另外完整列在歷程之上
    drawApproverComments(
      {
        doc,
        useFont,
        C,
        leftX,
        contentW,
        ensureSpace,
        fillRect,
        strokeRect,
        textAt,
        textMid,
        get y() {
          return y;
        },
        set y(v) {
          y = v;
        },
      },
      request.actions,
      () => {
        fillRect(leftX, y, 4, 16, C.header);
        textAt('簽核意見', leftX + 12, y, contentW - 16, {
          size: 12,
          color: C.headerDark,
        });
        y += 20;
      }
    );
    ensureSpace(40);
    fillRect(leftX, y, 4, 16, C.header);
    textAt('簽核歷程', leftX + 12, y, contentW - 16, {
      size: 12,
      color: C.headerDark,
    });
    y += 20;

    const colW = {
      step: Math.floor(contentW * 0.26),
      action: Math.floor(contentW * 0.12),
      actor: Math.floor(contentW * 0.16),
      time: Math.floor(contentW * 0.22),
    };
    colW.comment =
      contentW - colW.step - colW.action - colW.actor - colW.time;
    const headH2 = 26;
    ensureSpace(headH2 + 16);
    fillRect(leftX, y, contentW, headH2, C.header);
    let x = leftX;
    const heads = [
      ['步驟', colW.step],
      ['動作', colW.action],
      ['簽核人', colW.actor],
      ['時間', colW.time],
      ['意見', colW.comment],
    ];
    for (const [lab, w] of heads) {
      textMid(lab, x + 4, y, w - 8, headH2, {
        size: 10,
        color: C.white,
      });
      x += w;
    }
    y += headH2;

    for (let i = 0; i < actions.length; i++) {
      const a = actions[i];
      const actorLabel = a.delegated_for_name
        ? `${a.actor_name} (代 ${a.delegated_for_name})`
        : (a.actor_name || '—');
      const cells = [
        formatStepCell(a),
        ACTION_LABEL[a.action] || a.action,
        actorLabel,
        String(a.created_at || '').replace('T', ' ').slice(0, 16),
        historyCommentCell(a),
      ];
      const widths = [
        colW.step,
        colW.action,
        colW.actor,
        colW.time,
        colW.comment,
      ];
      useFont();
      let maxH = a.signature_image ? 36 : 24;
      for (let j = 0; j < cells.length; j++) {
        const hh =
          doc.heightOfString(String(cells[j]), {
            width: widths[j] - 8,
            fontSize: 9.5,
          }) + 10;
        if (hh > maxH) maxH = hh;
      }
      ensureSpace(maxH + 1);
      if (i % 2 === 1) fillRect(leftX, y, contentW, maxH, C.altBg);
      strokeRect(leftX, y, contentW, maxH, C.softLine, 0.4);
      x = leftX;
      for (let j = 0; j < cells.length; j++) {
        if (j > 0) {
          doc
            .moveTo(x, y)
            .lineTo(x, y + maxH)
            .strokeColor(C.softLine)
            .lineWidth(0.35)
            .stroke();
        }
        const drawCellText = () =>
          textAt(cells[j], x + 4, y + 5, widths[j] - 8, { size: 9.5, color: C.ink });
        const cellBox = { x, y, w: widths[j], h: maxH };
        if (j === 2) drawSignatureCell(doc, a.signature_image, cellBox, drawCellText);
        else drawCellText();
        x += widths[j];
      }
      y += maxH;
    }
    y += 6;
  }

  // 附件
  const atts = request.attachments || [];
  if (atts.length) {
    ensureSpace(28);
    fillRect(leftX, y, 4, 16, C.header);
    textAt('附件', leftX + 12, y, contentW - 16, {
      size: 12,
      color: C.headerDark,
    });
    y += 18;
    for (let i = 0; i < atts.length; i++) {
      const a = atts[i];
      ensureSpace(16);
      textAt(
        `${i + 1}. ${a.original_name || a.filename || '—'}`,
        leftX + 8,
        y,
        contentW - 12,
        { size: 10, color: C.softInk }
      );
      y += 15;
    }
  }
}

module.exports = {
  drawLeaveForm,
};
