const { getCompanyNameForPdf } = require('./font');
const { resolveFormTheme, formatDisplayValue, ACTION_LABEL } = require('./meta');
const {
  drawApproverComments,
  formatStepCell,
  drawSignatureCell,
  historyCommentCell,
} = require('./comments');

function createSimpleTableKit(ctx, theme = {}) {
  const { doc, useFont, leftX, contentW, pageH, margin } = ctx;
  let y = margin;
  const C = {
    ink: theme.ink || '#111827',
    softInk: theme.softInk || '#374151',
    muted: theme.muted || '#6b7280',
    line: theme.line || '#9ca3af',
    lineDark: theme.lineDark || '#4b5563',
    softLine: theme.softLine || '#d1d5db',
    header: theme.header || '#374151',
    headerSoft: theme.headerSoft || '#f3f4f6',
    labelBg: theme.labelBg || '#f9fafb',
    sectionBg: theme.sectionBg || '#e5e7eb',
    white: '#ffffff',
    cellBg: '#ffffff',
    altBg: theme.altBg || '#f9fafb',
    ok: '#166534',
    ng: '#b91c1c',
  };
  const FS_LABEL = 10.5;
  const FS_VALUE = 11;
  const FS_SMALL = 9.5;

  function ensureSpace(need) {
    if (y + need > pageH - margin - 16) {
      doc.addPage();
      y = margin;
      return true;
    }
    return false;
  }
  function fillRect(x, yy, w, h, color) {
    doc.rect(x, yy, w, h).fill(color);
  }
  function strokeRect(x, yy, w, h, color, width) {
    doc
      .rect(x, yy, w, h)
      .strokeColor(color || C.lineDark)
      .lineWidth(width || 0.7)
      .stroke();
  }
  function textAt(str, x, yy, w, opts = {}) {
    useFont();
    const o = {
      width: w,
      align: opts.align || 'left',
      lineBreak: opts.lineBreak !== false,
    };
    if (opts.height != null) o.height = opts.height;
    if (opts.lineGap != null) o.lineGap = opts.lineGap;
    if (opts.ellipsis) o.ellipsis = true;
    doc
      .fillColor(opts.color || C.ink)
      .fontSize(opts.size || FS_VALUE)
      .text(String(str ?? ''), x, yy, o);
  }
  function textMid(str, x, yy, w, h, opts = {}) {
    useFont();
    const size = opts.size || FS_VALUE;
    const ty = yy + Math.max(3, (h - size * 0.9) / 2);
    doc
      .fillColor(opts.color || C.ink)
      .fontSize(size)
      .text(String(str ?? ''), x, ty, {
        width: w,
        align: opts.align || 'left',
        lineBreak: false,
      });
  }

  /** 量測多行文字高度（必須先設好字型／字級，與繪製一致） */
  function measureTextH(str, w, opts = {}) {
    useFont();
    const size = opts.size != null ? opts.size : FS_VALUE;
    doc.fontSize(size);
    const h = doc.heightOfString(String(str ?? ''), {
      width: Math.max(8, w),
      lineGap: opts.lineGap != null ? opts.lineGap : 2,
    });
    return h;
  }

  /** 單行自動縮放，避免文字溢出相鄰欄位 */
  function textFitOneLine(str, x, yy, w, h, opts = {}) {
    useFont();
    const text = String(str ?? '');
    const maxSize = opts.maxSize != null ? opts.maxSize : FS_VALUE;
    const minSize = opts.minSize != null ? opts.minSize : 7.5;
    let size = maxSize;
    const maxW = Math.max(6, w);
    while (size > minSize) {
      doc.fontSize(size);
      if (doc.widthOfString(text) <= maxW) break;
      size -= 0.5;
    }
    let draw = text;
    if (doc.widthOfString(draw) > maxW && draw.length > 1) {
      while (draw.length > 1 && doc.widthOfString(draw + '…') > maxW) {
        draw = draw.slice(0, -1);
      }
      draw += '…';
    }
    const ty = yy + Math.max(3, (h - size * 0.9) / 2);
    doc
      .fillColor(opts.color || C.ink)
      .fontSize(size)
      .text(draw, x, ty, {
        width: maxW,
        align: opts.align || 'left',
        lineBreak: false,
      });
  }

  /** cells: [{ w, label?, value, labelW?, multi?, bg?, valueColor?, align? }] */
  function drawRow(cells, h) {
    ensureSpace(h + 1);
    // 校正最後一欄寬度，確保列寬合計 = contentW（格線對齊）
    const cellsAdj = cells.map((c) => ({ ...c }));
    if (cellsAdj.length) {
      const sum = cellsAdj.reduce((a, c) => a + (c.w || 0), 0);
      if (sum !== contentW) {
        cellsAdj[cellsAdj.length - 1].w =
          (cellsAdj[cellsAdj.length - 1].w || 0) + (contentW - sum);
      }
    }
    let x = leftX;
    fillRect(leftX, y, contentW, h, C.cellBg);
    for (const c of cellsAdj) {
      const lw = c.label != null ? c.labelW || 70 : 0;
      if (c.label != null) fillRect(x, y, lw, h, c.labelBg || C.labelBg);
      if (c.bg) fillRect(x + lw, y, c.w - lw, h, c.bg);
      x += c.w;
    }
    strokeRect(leftX, y, contentW, h, C.lineDark, 0.65);
    x = leftX;
    for (let i = 0; i < cellsAdj.length; i++) {
      const c = cellsAdj[i];
      const lw = c.label != null ? c.labelW || 70 : 0;
      if (i > 0) {
        doc
          .moveTo(x, y)
          .lineTo(x, y + h)
          .strokeColor(C.line)
          .lineWidth(0.55)
          .stroke();
      }
      if (c.label != null) {
        doc
          .moveTo(x + lw, y)
          .lineTo(x + lw, y + h)
          .strokeColor(C.line)
          .lineWidth(0.55)
          .stroke();
        textFitOneLine(c.label, x + 2, y, lw - 4, h, {
          maxSize: FS_LABEL,
          minSize: 8,
          color: C.softInk,
          align: 'center',
        });
        if (c.multi) {
          // 限制高度，避免說明／主旨等長文超出儲存格外框
          textAt(c.value || '—', x + lw + 6, y + 6, c.w - lw - 12, {
            size: c.valueSize || FS_VALUE,
            color: c.valueColor || C.ink,
            height: Math.max(10, h - 12),
            lineGap: 2,
          });
        } else {
          textFitOneLine(c.value || '—', x + lw + 6, y, c.w - lw - 12, h, {
            maxSize: c.valueSize || FS_VALUE,
            minSize: 8,
            color: c.valueColor || C.ink,
            align: c.align || 'left',
          });
        }
      } else if (c.value != null) {
        if (c.multi) {
          textAt(c.value, x + 6, y + 6, c.w - 12, {
            size: c.valueSize || FS_VALUE,
            color: c.valueColor || C.ink,
            height: Math.max(10, h - 12),
            lineGap: 2,
          });
        } else {
          textFitOneLine(c.value, x + 6, y, c.w - 12, h, {
            maxSize: c.valueSize || FS_VALUE,
            minSize: 8,
            color: c.valueColor || C.ink,
            align: c.align || 'left',
          });
        }
      }
      x += c.w;
    }
    y += h;
  }

  function sectionBar(title) {
    const h = 24;
    ensureSpace(h + 2);
    fillRect(leftX, y, contentW, h, C.sectionBg);
    strokeRect(leftX, y, contentW, h, C.lineDark, 0.65);
    textMid(title, leftX + 10, y, contentW - 20, h, {
      size: 11,
      color: C.header,
      align: 'left',
    });
    y += h;
  }

  function drawHeader(formTitle, applyDateText, metaRight) {
    const headH = 66;
    // 頂部主色條 + 淺色抬頭底
    fillRect(leftX, y, contentW, 5, C.header);
    fillRect(leftX, y + 5, contentW, headH - 5, C.headerSoft);
    strokeRect(leftX, y, contentW, headH, C.lineDark, 0.95);
    useFont();
    doc
      .fillColor(C.header)
      .fontSize(12)
      .text(getCompanyNameForPdf(), leftX, y + 14, {
        width: contentW,
        align: 'center',
      });
    doc
      .moveTo(leftX + contentW * 0.3, y + 32)
      .lineTo(leftX + contentW * 0.7, y + 32)
      .strokeColor(C.header)
      .lineWidth(0.9)
      .stroke();
    doc
      .fillColor(C.header)
      .fontSize(18)
      .text(formTitle, leftX, y + 38, {
        width: contentW,
        align: 'center',
      });
    y += headH + 6;
    const metaH = 22;
    fillRect(leftX, y, contentW, metaH, C.altBg);
    strokeRect(leftX, y, contentW, metaH, C.softLine, 0.55);
    fillRect(leftX, y, 3, metaH, C.header);
    textMid(`申請日期：${applyDateText}`, leftX + 10, y, contentW * 0.55, metaH, {
      size: FS_SMALL,
      color: C.softInk,
    });
    textMid(metaRight || '', leftX + contentW * 0.45, y, contentW * 0.55 - 10, metaH, {
      size: FS_SMALL,
      color: C.muted,
      align: 'right',
    });
    y += metaH + 8;
  }

  /** 版面介面：供 drawApproverComments 等共用區塊使用（y 需可讀寫） */
  const surface = {
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
  };

  function drawActionsHistory(actions) {
    const list = (actions || []).filter(
      (a) =>
        a.action !== 'comment' ||
        (a.comment && !/Email 催辦/.test(a.comment || ''))
    );
    if (!list.length) return;
    // 簽核人員填寫的意見另外完整列在歷程之上
    drawApproverComments(surface, actions, () => {
      textAt('簽核意見', leftX, y, contentW, { size: 11.5, color: C.header });
      y += 16;
    });
    ensureSpace(36);
    textAt('簽核歷程', leftX, y, contentW, {
      size: 11.5,
      color: C.header,
    });
    y += 16;
    const colW = {
      step: Math.floor(contentW * 0.28),
      action: Math.floor(contentW * 0.12),
      actor: Math.floor(contentW * 0.16),
      time: Math.floor(contentW * 0.22),
    };
    colW.comment =
      contentW - colW.step - colW.action - colW.actor - colW.time;
    const headH = 24;
    ensureSpace(headH + 12);
    fillRect(leftX, y, contentW, headH, C.header);
    let x = leftX;
    for (const [lab, w] of [
      ['步驟', colW.step],
      ['動作', colW.action],
      ['簽核人', colW.actor],
      ['時間', colW.time],
      ['意見', colW.comment],
    ]) {
      textMid(lab, x + 4, y, w - 8, headH, {
        size: 10,
        color: C.white,
      });
      x += w;
    }
    y += headH;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
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
      let maxH = a.signature_image ? 36 : 22;
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
  }

  function drawAttachments(atts) {
    if (!atts || !atts.length) return;
    ensureSpace(28);
    textAt('附件', leftX, y, contentW, { size: 11.5, color: C.header });
    y += 14;
    for (let i = 0; i < atts.length; i++) {
      const a = atts[i];
      ensureSpace(15);
      textAt(
        `${i + 1}. ${a.original_name || a.filename || '—'}`,
        leftX + 4,
        y,
        contentW - 8,
        { size: 10, color: C.softInk }
      );
      y += 14;
    }
  }

  return {
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
    textAt,
    textMid,
    drawRow,
    sectionBar,
    drawHeader,
    drawActionsHistory,
    drawAttachments,
    measureTextH,
    drawEmbeddedFormTable: (table, opts = {}) =>
      drawEmbeddedFormTableOnKit(
        {
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
          textAt,
          textMid,
          FS_VALUE,
          FS_LABEL,
        },
        table,
        {
          ctx,
          title: opts.title,
          hideTitle: opts.hideTitle,
          inset: opts.inset,
          maxRowH: opts.maxRowH,
        }
      ),
    FS_VALUE,
    FS_LABEL,
    FS_SMALL,
  };
}

/** 富文字 HTML → 純文字（PDF 量測／顯示用） */
function richHtmlToPlain(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<\/td>/gi, '\t')
    .replace(/<\/th>/gi, '\t')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#160;/gi, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 以深度掃描切出 HTML 中的 <table>…</table>（支援巢狀 table）
 * @returns {{ start:number, end:number, body:string }[]}
 */
function findHtmlTableRanges(html) {
  const src = String(html || '');
  const lower = src.toLowerCase();
  const ranges = [];
  let i = 0;
  while (i < src.length) {
    const start = lower.indexOf('<table', i);
    if (start < 0) break;
    const openGt = src.indexOf('>', start);
    if (openGt < 0) break;
    let depth = 1;
    let pos = openGt + 1;
    let closeAt = -1;
    while (pos < src.length && depth > 0) {
      const nextOpen = lower.indexOf('<table', pos);
      const nextClose = lower.indexOf('</table', pos);
      if (nextClose < 0) break;
      if (nextOpen >= 0 && nextOpen < nextClose) {
        depth += 1;
        pos = nextOpen + 6;
      } else {
        depth -= 1;
        if (depth === 0) {
          closeAt = nextClose;
          break;
        }
        pos = nextClose + 7;
      }
    }
    if (closeAt < 0) break;
    const endGt = src.indexOf('>', closeAt);
    if (endGt < 0) break;
    ranges.push({
      start,
      end: endGt + 1,
      body: src.slice(openGt + 1, closeAt),
    });
    i = endGt + 1;
  }
  return ranges;
}

/** 解析單一 table body → { rows, cols, header, cells } */
function parseTableBodyToStruct(bodyHtml) {
  const body = String(bodyHtml || '');
  const rows = [];
  // 先依 <tr> 切開（不處理巢狀 tr，一般 table 無此情況）
  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let tr;
  while ((tr = trRe.exec(body))) {
    const cells = [];
    const cellRe = /<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
    let c;
    while ((c = cellRe.exec(tr[1]))) {
      const attrs = c[2] || '';
      const plain = richHtmlToPlain(c[3]).replace(/\t/g, ' ').replace(/\n+/g, ' ').trim();
      // 簡易 colspan：重複填入空字串佔位，內容放第一格
      let span = 1;
      const cm = attrs.match(/colspan\s*=\s*["']?(\d+)/i);
      if (cm) span = Math.min(20, Math.max(1, Number(cm[1]) || 1));
      cells.push(plain);
      for (let s = 1; s < span; s++) cells.push('');
    }
    if (cells.length) rows.push(cells);
  }
  if (!rows.length) return null;
  const cols = Math.max(...rows.map((r) => r.length));
  const cells = rows.map((r) => {
    const next = r.slice(0, cols);
    while (next.length < cols) next.push('');
    return next;
  });
  // 第一列若多為 th，視為表頭
  const firstTr = body.match(/<tr\b[^>]*>([\s\S]*?)<\/tr>/i);
  const header =
    firstTr && /<th\b/i.test(firstTr[1])
      ? true
      : cells.length > 1
        ? true
        : false;
  return { rows: cells.length, cols, header, cells };
}

/** 從 HTML 抽出 table → 自繪表格結構（依出現順序） */
function extractHtmlTables(html) {
  return findHtmlTableRanges(html)
    .map((r) => parseTableBodyToStruct(r.body))
    .filter(Boolean);
}

/**
 * 將富文字 HTML 拆成「文字／表格」區塊（維持貼上順序，表格留在說明流內）
 * @returns {{ type:'text'|'table', text?:string, table?:object }[]}
 */
function splitRichHtmlBlocks(html) {
  const src = String(html || '');
  if (!src.trim()) return [{ type: 'text', text: '—' }];
  const ranges = findHtmlTableRanges(src);
  if (!ranges.length) {
    const t = richHtmlToPlain(src);
    return [{ type: 'text', text: t || '—' }];
  }
  const blocks = [];
  let cursor = 0;
  for (const r of ranges) {
    if (r.start > cursor) {
      const text = richHtmlToPlain(src.slice(cursor, r.start)).trim();
      if (text) blocks.push({ type: 'text', text });
    }
    const table = parseTableBodyToStruct(r.body);
    if (table) blocks.push({ type: 'table', table });
    cursor = r.end;
  }
  if (cursor < src.length) {
    const text = richHtmlToPlain(src.slice(cursor)).trim();
    if (text) blocks.push({ type: 'text', text });
  }
  if (!blocks.length) {
    blocks.push({ type: 'text', text: richHtmlToPlain(src) || '—' });
  }
  return blocks;
}

/** 說明文字（去掉 table 後的純文字） */
function richHtmlBodyPlain(html) {
  let s = String(html || '');
  // 以深度切出的 table 區間移除，避免巢狀誤切
  const ranges = findHtmlTableRanges(s);
  for (let i = ranges.length - 1; i >= 0; i--) {
    const r = ranges[i];
    s = s.slice(0, r.start) + '\n' + s.slice(r.end);
  }
  return richHtmlToPlain(s);
}

/** 正規化 form_data 內嵌自繪表格 */
function normalizeEmbeddedTable(raw) {
  if (!raw) return null;
  let obj = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!obj || !Array.isArray(obj.cells) || !obj.cells.length) return null;
  const cells = obj.cells.map((row) =>
    (Array.isArray(row) ? row : []).map((c) => String(c ?? ''))
  );
  const cols = Math.max(1, ...cells.map((r) => r.length));
  const normalized = cells.map((r) => {
    const next = r.slice(0, cols);
    while (next.length < cols) next.push('');
    return next;
  });
  if (!normalized.some((r) => r.some((c) => String(c).trim()))) return null;
  return {
    rows: normalized.length,
    cols,
    header: obj.header !== false,
    cells: normalized,
  };
}

function getFormFieldTable(formData, fieldId) {
  if (!formData || !fieldId) return null;
  return normalizeEmbeddedTable(formData[`${fieldId}__table`]);
}

/**
 * 在 simple-table kit 上繪製內嵌表格（說明欄／貼上表格）
 * opts.hideTitle：不顯示「附表」標題（表格留在說明欄內）
 * opts.inset：左右內縮（貼齊說明內文區）
 * opts.maxRowH：列高上限（預設 200，完整顯示儲存格）
 */
function drawEmbeddedFormTableOnKit(kit, table, opts = {}) {
  const t = normalizeEmbeddedTable(table);
  if (!t || !kit) return;
  const { C, ensureSpace, fillRect, strokeRect } = kit;
  const ctx = opts.ctx;
  if (!ctx) return;
  const { doc, useFont, leftX, contentW } = ctx;
  const inset = Number(opts.inset) || 0;
  const tableX = leftX + inset;
  const tableW = Math.max(40, contentW - inset * 2);
  const cols = t.cols;
  const colWs = [];
  const base = Math.floor(tableW / cols);
  for (let i = 0; i < cols; i++) colWs.push(base);
  colWs[cols - 1] += tableW - base * cols;
  const maxRowH = opts.maxRowH != null ? opts.maxRowH : 200;
  const hideTitle = !!opts.hideTitle || opts.title === '';

  useFont();
  doc.fontSize(9.5);
  const rowHeights = t.cells.map((row) => {
    let maxH = 18;
    for (let i = 0; i < cols; i++) {
      const hh =
        doc.heightOfString(String(row[i] || ' ') || ' ', {
          width: Math.max(12, colWs[i] - 8),
          lineGap: 1,
        }) + 10;
      if (hh > maxH) maxH = hh;
    }
    return Math.min(maxRowH, Math.max(18, maxH));
  });

  if (!hideTitle) {
    ensureSpace(18);
    useFont();
    doc
      .fillColor(C.softInk || C.muted || '#374151')
      .fontSize(9)
      .text(opts.title || '附表', tableX + 2, kit.y, { width: tableW });
    kit.y += 14;
  } else {
    ensureSpace(6);
    kit.y += 4;
  }

  for (let ri = 0; ri < t.cells.length; ri++) {
    const h = rowHeights[ri];
    ensureSpace(h + 2);
    const y0 = kit.y;
    fillRect(
      tableX,
      y0,
      tableW,
      h,
      ri === 0 && t.header ? C.sectionBg || C.labelBg : C.cellBg || C.white
    );
    // 列外框（加強）
    strokeRect(tableX, y0, tableW, h, C.lineDark || '#334155', 1.15);
    let x = tableX;
    for (let ci = 0; ci < cols; ci++) {
      if (ci > 0) {
        // 直向內框線（加強）
        doc
          .moveTo(x, y0)
          .lineTo(x, y0 + h)
          .strokeColor(C.lineDark || '#334155')
          .lineWidth(1.0)
          .stroke();
      }
      const cell = String(t.cells[ri][ci] || '');
      const isHead = t.header && ri === 0;
      useFont();
      doc
        .fillColor(isHead ? C.header || C.softInk : C.ink)
        .fontSize(isHead ? 9.5 : 9)
        .text(cell, x + 4, y0 + 5, {
          width: colWs[ci] - 8,
          height: h - 8,
          lineGap: 1,
          align: isHead ? 'center' : 'left',
        });
      x += colWs[ci];
    }
    kit.y = y0 + h;
  }
  kit.y += 6;
}

/**
 * 在「說明」欄內繪製富文字：
 * ┌─ 說　　明 ─────────────────┐  ← 標題列
 * │  前文文字…                  │
 * │   ┌────┬────┬────┐         │  ← 框內「獨立表格」（有自己的格線）
 * │   │    │    │    │         │
 * │   └────┴────┴────┘         │
 * │  後文文字…                  │
 * └────────────────────────────┘  ← 單一說明外框（不被表格切成兩段）
 */
function drawRichContentInExplainSection(kit, ctx, html, opts = {}) {
  if (!kit || !ctx) return;
  const { C, ensureSpace, fillRect, strokeRect, textMid } = kit;
  const { doc, useFont, leftX, contentW } = ctx;
  const secH = 26;
  const padX = 12;
  const padY = 10;
  const textW = contentW - padX * 2;
  const bodyFontSize = opts.fontSize || 11;
  const lineGap = 2;
  const safety = 6;
  const tableInset = 16;
  const pageBottom = () => ctx.pageH - ctx.margin - 20;
  const sectionTitle = opts.sectionTitle || '說　　明';
  // 說明外框用中灰；表格內框線用更深、更粗，獨立清楚
  const lineColor = C.lineDark || C.line || '#475569';
  const tableLine = '#1e293b';
  const tableInnerW = 1.15;
  const tableOuterW = 1.35;
  const ink = C.ink || '#0f172a';

  const blocks = splitRichHtmlBlocks(html);
  const legacy = normalizeEmbeddedTable(opts.legacyTable);
  if (legacy) blocks.push({ type: 'table', table: legacy });
  if (!blocks.length) blocks.push({ type: 'text', text: '—' });

  /** 本頁說明「內容區」頂端（標題列下方），結束時畫一次完整外框 */
  let contentTop = null;

  function drawHeader(continued) {
    ensureSpace(secH + 60);
    fillRect(leftX, kit.y, contentW, secH, C.sectionBg);
    strokeRect(leftX, kit.y, contentW, secH, lineColor, 0.7);
    textMid(
      continued ? '說　　明（續）' : sectionTitle,
      leftX + 10,
      kit.y,
      contentW - 20,
      secH,
      { size: continued ? 11 : 12, color: C.header }
    );
    kit.y += secH;
    contentTop = kit.y;
  }

  function strokeContentFrame() {
    if (contentTop == null) return;
    const h = Math.max(18, kit.y - contentTop);
    // 只描邊，不填色（避免蓋住文字／表格）
    strokeRect(leftX, contentTop, contentW, h, lineColor, 0.7);
    contentTop = null;
  }

  function newPage() {
    strokeContentFrame();
    doc.addPage();
    kit.y = ctx.margin;
    drawHeader(true);
    kit.y += padY;
  }

  function textHeight(str) {
    useFont();
    doc.fontSize(bodyFontSize);
    return (
      doc.heightOfString(String(str || ' '), { width: textW, lineGap }) + safety
    );
  }

  function fitText(text, availInnerH) {
    useFont();
    doc.fontSize(bodyFontSize);
    if (textHeight(text) <= availInnerH) return { chunk: text, rest: '' };
    let lo = 0;
    let hi = text.length;
    let best = 0;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      let cut = mid;
      if (cut > 0 && cut < text.length) {
        const slice = text.slice(0, cut);
        const breakAt = Math.max(
          slice.lastIndexOf('\n'),
          slice.lastIndexOf('。'),
          slice.lastIndexOf('；'),
          slice.lastIndexOf('，'),
          slice.lastIndexOf('、'),
          slice.lastIndexOf(' ')
        );
        if (breakAt > cut * 0.45) cut = breakAt + 1;
      }
      cut = Math.max(1, cut);
      if (textHeight(text.slice(0, cut)) <= availInnerH) {
        best = cut;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (best <= 0) best = Math.min(40, text.length);
    return {
      chunk: text.slice(0, best),
      rest: text.slice(best).replace(/^\n+/, ''),
    };
  }

  function tableColWidths(cols) {
    const tableW = Math.max(40, contentW - tableInset * 2);
    const colWs = [];
    const base = Math.floor(tableW / cols);
    for (let i = 0; i < cols; i++) colWs.push(base);
    colWs[cols - 1] += tableW - base * cols;
    return { tableW, colWs };
  }

  function rowHeightsOf(t) {
    const { colWs } = tableColWidths(t.cols);
    useFont();
    doc.fontSize(9);
    return t.cells.map((row) => {
      let maxH = 22;
      for (let i = 0; i < t.cols; i++) {
        const hh =
          doc.heightOfString(String(row[i] || ' ') || ' ', {
            width: Math.max(12, colWs[i] - 8),
            lineGap: 1,
          }) + 12;
        if (hh > maxH) maxH = hh;
      }
      return Math.min(160, Math.max(22, maxH));
    });
  }

  function measureTableHeight(table) {
    const t = normalizeEmbeddedTable(table);
    if (!t) return 0;
    const rhs = rowHeightsOf(t);
    return 12 + rhs.reduce((a, b) => a + b, 0) + 10;
  }

  /**
   * 在說明框「內部」畫獨立表格（完整格線，左右內縮）
   * 盡量整表同一頁；若頁高不足才從列中間換頁（續頁仍在說明框內）
   */
  function drawIndepTable(table) {
    const t = normalizeEmbeddedTable(table);
    if (!t) return;
    const { tableW, colWs } = tableColWidths(t.cols);
    const tableX = leftX + tableInset;
    const rhs = rowHeightsOf(t);
    const totalH = rhs.reduce((a, b) => a + b, 0);

    // 整表放得下就換頁後一次畫完，避免「說明被切兩段」的感覺
    const avail = pageBottom() - kit.y - padY;
    if (totalH + 12 > avail && totalH + 12 < pageBottom() - ctx.margin - secH - padY * 2 - 20) {
      // 下一頁放得下整表
      newPage();
    } else if (avail < 50) {
      newPage();
    }

    kit.y += 6;
    let segTop = kit.y; // 本頁表格區段頂端（換頁會重設）

    function strokeTableSegment() {
      if (kit.y <= segTop) return;
      strokeRect(
        tableX,
        segTop,
        tableW,
        kit.y - segTop,
        tableLine,
        tableOuterW
      );
    }

    for (let ri = 0; ri < t.cells.length; ri++) {
      const h = rhs[ri];
      if (pageBottom() - kit.y < h + 2) {
        strokeTableSegment();
        newPage();
        kit.y += 6;
        segTop = kit.y;
      }
      const y0 = kit.y;
      const isHead = t.header && ri === 0;
      fillRect(
        tableX,
        y0,
        tableW,
        h,
        isHead ? C.sectionBg || '#e2e8f0' : '#ffffff'
      );
      let x = tableX;
      for (let ci = 0; ci < t.cols; ci++) {
        if (ci > 0) {
          // 直向內框線（加強加粗）
          doc
            .moveTo(x, y0)
            .lineTo(x, y0 + h)
            .strokeColor(tableLine)
            .lineWidth(tableInnerW)
            .stroke();
        }
        useFont();
        doc
          .fillColor(isHead ? C.header || '#1e3a5f' : ink)
          .fontSize(isHead ? 9.5 : 9)
          .text(String(t.cells[ri][ci] || ''), x + 5, y0 + 6, {
            width: colWs[ci] - 10,
            height: h - 10,
            lineGap: 1,
            align: isHead ? 'center' : 'left',
          });
        x += colWs[ci];
      }
      // 橫向內框線（列底，加強加粗）
      doc
        .moveTo(tableX, y0 + h)
        .lineTo(tableX + tableW, y0 + h)
        .strokeColor(tableLine)
        .lineWidth(tableInnerW)
        .stroke();
      kit.y = y0 + h;
    }
    // 本頁獨立表格外框（完整四邊，比內框略粗）
    strokeTableSegment();
    kit.y += 10;
  }

  function drawTextInside(text) {
    let remaining = String(text || '').trim();
    if (!remaining) return;
    let guard = 0;
    while (remaining !== '' && guard++ < 50) {
      let avail = pageBottom() - kit.y - padY;
      if (avail < 30) {
        newPage();
        avail = pageBottom() - kit.y - padY;
      }
      const { chunk, rest } = fitText(remaining, avail);
      const th = textHeight(chunk);
      useFont();
      doc
        .fillColor(ink)
        .fontSize(bodyFontSize)
        .text(chunk, leftX + padX, kit.y, {
          width: textW,
          height: th + 2,
          lineGap,
          align: 'left',
        });
      kit.y += th;
      remaining = rest;
      if (remaining) newPage();
    }
  }

  // ===== 開始 =====
  drawHeader(false);
  kit.y += padY;

  for (const block of blocks) {
    if (block.type === 'table' && block.table) {
      drawIndepTable(block.table);
    } else {
      drawTextInside(block.text || '—');
    }
  }

  kit.y += padY;
  // 最後畫「單一」說明內容外框（文字+表格都在框內）
  strokeContentFrame();
  kit.y += 10;
}

/**
 * 在欄位值之後、同一區塊內繪製 HTML 表格（不另標附表）
 * @param {string} [rawOverride] 若欄位 id 不確定，可直接傳已取得的 HTML 字串
 */
function appendFieldTable(kit, ctx, formData, fieldId, title, rawOverride) {
  if (!kit || !formData) return;
  const hideTitle = title === '' || title == null;
  const t = getFormFieldTable(formData, fieldId);
  if (t) {
    kit.drawEmbeddedFormTable(t, {
      title: hideTitle ? '' : title || '附表',
      hideTitle,
    });
  }
  const raw =
    rawOverride != null
      ? rawOverride
      : formData[fieldId] != null
        ? formData[fieldId]
        : null;
  if (typeof raw === 'string' && /<table/i.test(raw)) {
    extractHtmlTables(raw).forEach((tbl, idx) => {
      kit.drawEmbeddedFormTable(tbl, {
        title: hideTitle
          ? ''
          : idx > 0
            ? `${title || '附表'} ${idx + 1}`
            : title || '附表',
        hideTitle,
      });
    });
  }
  // 若指定 fieldId 無表格，掃其他字串欄位中含 table 且尚未畫過的（避免漏掉動態 id）
  if (
    typeof raw !== 'string' ||
    !/<table/i.test(raw)
  ) {
    // no-op：由呼叫端傳 rawOverride 即可
  }
}

/**
 * 從任意字串（欄位值）抽出並繪製表格，留在當前欄位流內
 */
function drawInlineHtmlTablesFromValue(kit, ctx, value, opts = {}) {
  if (!kit || value == null) return;
  if (typeof value === 'object' && Array.isArray(value.cells)) {
    kit.drawEmbeddedFormTable(value, {
      title: '',
      hideTitle: true,
      inset: opts.inset || 0,
    });
    return;
  }
  if (typeof value !== 'string' || !/<table/i.test(value)) return;
  extractHtmlTables(value).forEach((tbl) => {
    kit.drawEmbeddedFormTable(tbl, {
      title: '',
      hideTitle: true,
      inset: opts.inset || 0,
      maxRowH: opts.maxRowH || 220,
    });
  });
}


module.exports = {
  createSimpleTableKit,
  richHtmlToPlain,
  findHtmlTableRanges,
  parseTableBodyToStruct,
  extractHtmlTables,
  splitRichHtmlBlocks,
  richHtmlBodyPlain,
  normalizeEmbeddedTable,
  getFormFieldTable,
  drawEmbeddedFormTableOnKit,
  drawRichContentInExplainSection,
  appendFieldTable,
  drawInlineHtmlTablesFromValue,
};
