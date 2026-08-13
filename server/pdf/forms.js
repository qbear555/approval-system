const { getChineseFontPath, getCompanyNameForPdf } = require('./font');
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
} = require('./meta');
const {
  createSimpleTableKit,
  richHtmlToPlain,
  richHtmlBodyPlain,
  getFormFieldTable,
  drawEmbeddedFormTableOnKit,
  drawRichContentInExplainSection,
  appendFieldTable,
  drawInlineHtmlTablesFromValue,
} = require('./kit');
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
} = require('./comments');

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

/**
 * 已核准 PDF：右上角紅色「核准」印章（類似傳統橡皮章）
 * 於各頁繪製；需 PDFDocument bufferPages: true
 */
function drawApprovedStamp(doc, useFont) {
  const pageW = doc.page.width;
  const margin = 40;
  // 右上角
  const cx = pageW - margin - 40;
  const cy = margin + 48;
  const r = 38;
  const red = '#c41e3a';

  doc.save();
  try {
    doc.translate(cx, cy);
    doc.rotate(-16);

    // 雙層圓環
    doc
      .circle(0, 0, r)
      .lineWidth(3)
      .strokeColor(red)
      .stroke();
    doc
      .circle(0, 0, r - 6)
      .lineWidth(1.4)
      .strokeColor(red)
      .stroke();

    // 內文「核准」
    if (typeof useFont === 'function') useFont();
    doc.fillColor(red).fontSize(20);
    const label = '核准';
    const tw = doc.widthOfString(label);
    doc.text(label, -tw / 2, -9, { lineBreak: false });

    // 底部小字（可選）
    doc.fontSize(7);
    const sub = 'APPROVED';
    const sw = doc.widthOfString(sub);
    doc.text(sub, -sw / 2, 14, { lineBreak: false });
  } finally {
    doc.restore();
  }
}

/** 僅在第一頁蓋核准章後結束文件（後續頁不蓋） */
function endPdfWithApprovedStamp(doc, request, useFont) {
  try {
    if (request && request.status === 'approved') {
      const range = doc.bufferedPageRange();
      if (range.count > 0) {
        doc.switchToPage(range.start); // 僅第一頁
        drawApprovedStamp(doc, useFont);
      }
    }
  } catch (e) {
    console.warn('[pdf] approved stamp failed', e && e.message ? e.message : e);
  }
  doc.end();
}

/**
 * resolveFormTheme → createSimpleTableKit 主題（與既有專用表單同一套表格風格）
 */
function kitThemeFromRequest(request) {
  const t = resolveFormTheme(request);
  return {
    header: t.headerBg || t.primary || '#1e3a5f',
    headerSoft: t.sectionBg || '#e2e8f0',
    labelBg: t.labelBg || '#f1f5f9',
    sectionBg: t.sectionBg || '#e2e8f0',
    line: t.border || '#94a3b8',
    lineDark: t.primary || '#334155',
    softLine: t.accentSoft || t.border || '#cbd5e1',
    softInk: t.primary || '#334155',
    altBg: t.rowAlt || '#f8fafc',
    ink: t.text || '#0f172a',
    muted: t.muted || '#64748b',
  };
}

/**
 * 標準簽核 PDF 版型（新建流程的預設）
 * 與現有請假／請購／出差／簽呈等同一套：
 * 彩色抬頭＋標籤格線表格＋區塊標題＋簽核歷程＋附件
 * 依 formFields／form_data 動態排版，無需為新流程另寫專用函式。
 */
function drawStandardWorkflowForm(ctx, request) {
  const kit = createSimpleTableKit(ctx, kitThemeFromRequest(request));
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
  const formFields = Array.isArray(request.formFields) ? request.formFields : [];
  const formName = String(request.workflow_name || request.form_name || '簽核申請');
  const created = toRocParts(request.created_at);
  const applyDateText =
    created.y !== ''
      ? `${created.y}年${created.m}月${created.d}日`
      : formatDisplayValue(request.created_at);
  const LW = 78;

  drawHeader(
    formName,
    applyDateText,
    `單號 #${request.id}　·　${STATUS_LABEL[request.status] || request.status || ''}`
  );

  // 基本資料
  sectionBar('基本資料');
  const applicant = `${request.requester_name || '—'}${
    request.requester_dept ? `（${request.requester_dept}）` : ''
  }`;
  drawRow(
    [
      { w: contentW * 0.5, label: '申請人', value: applicant, labelW: LW },
      {
        w: contentW * 0.5,
        label: '狀態',
        value: STATUS_LABEL[request.status] || request.status || '—',
        labelW: LW,
      },
    ],
    28
  );
  drawRow(
    [
      {
        w: contentW,
        label: '主旨',
        value: formatDisplayValue(request.title) || '—',
        labelW: LW,
        multi: true,
      },
    ],
    Math.max(
      28,
      Math.min(
        72,
        measureTextH(formatDisplayValue(request.title) || '—', contentW - LW - 16) + 14
      )
    )
  );
  if (request.created_at || request.completed_at) {
    drawRow(
      [
        {
          w: contentW * 0.5,
          label: '建立時間',
          value: formatDisplayValue(request.created_at),
          labelW: LW,
        },
        {
          w: contentW * 0.5,
          label: '完成時間',
          value: request.completed_at
            ? formatDisplayValue(request.completed_at)
            : '—',
          labelW: LW,
        },
      ],
      28
    );
  }

  // 申請表單（動態欄位）
  const renderedIds = new Set();
  if (formFields.length) {
    sectionBar('申請表單');
    for (const f of formFields) {
      if (!f || !f.id) continue;
      renderedIds.add(f.id);
      let val = formData[f.id];
      if (f.type === 'checkbox') {
        val = val ? '是' : '否';
      } else if (f.type === 'user') {
        val =
          formData[`${f.id}__label`] ||
          formData[`${f.id}__name`] ||
          val ||
          '—';
      } else if (f.type === 'datetime') {
        val = val ? String(val).replace('T', ' ').slice(0, 16) : '—';
      }
      const display = formatDisplayValue(val);
      const isLong =
        f.type === 'textarea' ||
        (typeof display === 'string' &&
          (display.length > 40 || display.includes('\n')));
      const rowH = isLong
        ? Math.max(
            32,
            Math.min(
              160,
              measureTextH(display, contentW - LW - 16) + 16
            )
          )
        : 28;
      drawRow(
        [
          {
            w: contentW,
            label: f.label || f.id,
            value: display,
            labelW: LW,
            multi: isLong,
          },
        ],
        rowH
      );
      // 富文字／內嵌表格
      if (
        (typeof formData[f.id] === 'string' && /<table/i.test(formData[f.id])) ||
        formData[`${f.id}__table`]
      ) {
        appendFieldTable(kit, ctx, formData, f.id, '');
      }
    }
  }

  // 無 schema 時列出其他鍵（略過 meta）
  const extraRows = [];
  for (const [k, v] of Object.entries(formData)) {
    if (k.includes('__')) continue;
    if (/^dept_head_\d+$/.test(k) || /^users_pick_\d+$/.test(k)) continue;
    if (renderedIds.has(k)) continue;
    if (/^cosign_\d+$/.test(k)) {
      const label = formData[`${k}__label`];
      extraRows.push([
        '會簽人員',
        label || (v && v !== 'skip' ? String(v) : '略過（無會簽）'),
      ]);
      continue;
    }
    if (!formFields.length && typeof v !== 'object') {
      extraRows.push([k, formatDisplayValue(v)]);
    }
  }
  if (extraRows.length) {
    if (!formFields.length) sectionBar('申請表單');
    for (const [lab, val] of extraRows) {
      drawRow(
        [{ w: contentW, label: lab, value: val, labelW: LW, multi: true }],
        Math.max(28, Math.min(100, measureTextH(String(val), contentW - LW - 16) + 14))
      );
    }
  }

  // 簽核單位填寫
  const ad = flattenApproverData(request.approver_data);
  const adKeys = Object.keys(ad || {});
  if (adKeys.length) {
    const secTitle =
      ad.hr_leave_type != null || ad.remaining_special_leave_days != null
        ? '人事／簽核單位填寫'
        : ad.pc_acquired_date != null || ad.handle_result != null
          ? '管理部／簽核單位填寫'
          : '簽核單位填寫';
    sectionBar(secTitle);
    const adOrder = [
      'hr_leave_type',
      'remaining_special_leave_days',
      'hr_note',
    ];
    const ordered = [
      ...adOrder.filter((k) => adKeys.includes(k)),
      ...adKeys.filter(
        (k) =>
          !adOrder.includes(k) &&
          k !== 'remaining_special_leave_hours' &&
          !/特休.*小時|剩餘.*小時/.test(String(k))
      ),
    ];
    for (const k of ordered) {
      let val = ad[k];
      if (k === 'remaining_special_leave_days' && (val === '' || val == null)) {
        val = '—';
      }
      drawRow(
        [
          {
            w: contentW,
            label: adLabelPdf(k, ad),
            value: formatDisplayValue(val),
            labelW: LW,
            multi: true,
          },
        ],
        28
      );
    }
  }

  drawAttachments(request.attachments || []);
  kit.y += 6;
  drawActionsHistory(request.actions);
}

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
  drawLeaveForm,
  drawPurchaseForm,
  drawExpenseForm,
  drawTravelForm,
  drawItRepairForm,
  drawOvertimeForm,
  drawGeneralMemoForm,
  drawApprovedStamp,
  endPdfWithApprovedStamp,
  kitThemeFromRequest,
  drawStandardWorkflowForm,
  drawCreditLimitForm,
};
