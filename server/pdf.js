const tz = require('./tz');
const PDFDocument = require('pdfkit');
const {
  getChineseFontPath,
  resolveChineseFont,
  getCompanyNameForPdf,
} = require('./pdf/font');
const {
  isLeaveRequest,
  isCreditLimitRequest,
  isPurchaseRequest,
  isExpenseRequest,
  isTravelRequest,
  isItRepairRequest,
  isOvertimeRequest,
  isGeneralMemoRequest,
} = require('./pdf/meta');
const {
  drawLeaveForm,
  drawPurchaseForm,
  drawExpenseForm,
  drawTravelForm,
  drawItRepairForm,
  drawOvertimeForm,
  drawGeneralMemoForm,
  drawStandardWorkflowForm,
  drawCreditLimitForm,
  endPdfWithApprovedStamp,
} = require('./pdf/forms');

function writeApprovalPdf(request, destStream) {
  return new Promise((resolve, reject) => {
    const fontPath = getChineseFontPath();
    const margin = 40;
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: margin, bottom: margin, left: margin, right: margin },
      autoFirstPage: true,
      bufferPages: true, // 供最後在各頁蓋「核准」章
      info: {
        Title: `${request.workflow_name || '簽核單'}-${request.id}`,
        Author: getCompanyNameForPdf(),
      },
    });

    destStream.on('error', reject);
    doc.on('error', reject);
    const done = () => resolve();
    if (typeof destStream.on === 'function') {
      destStream.once('finish', done);
    } else {
      doc.once('end', done);
    }
    doc.pipe(destStream);

    let fontReady = false;
    if (fontPath) {
      try {
        doc.registerFont('CJK', fontPath);
        doc.font('CJK');
        fontReady = true;
        console.log('[pdf] using font:', fontPath);
      } catch (e) {
        console.error('[pdf] font register failed:', fontPath, e.message);
        fontReady = false;
      }
    }

    function useFont() {
      if (fontReady) {
        try {
          doc.font('CJK');
        } catch {
          /* ignore */
        }
      }
    }

    function endPdfWithApprovedStamp(doc, request, useFont) {
      if (request.watermarkText || request.requester_name) {
        try {
          const text = String(request.watermarkText || `檢視/列印防偽：${request.requester_name || '系統同仁'} · ${tz.nowMinute()}`).trim();
          const range = doc.bufferedPageRange();
          for (let i = range.start; i < range.start + range.count; i++) {
            doc.switchToPage(i);
            doc.save();
            if (fontReady) {
              try { doc.font('CJK'); } catch {}
            }
            doc.fontSize(10).fillColor('#94a3b8').fillOpacity(0.14);
            const centerX = doc.page.width / 2;
            const centerY = doc.page.height / 2;
            doc.rotate(-30, { origin: [centerX, centerY] });
            for (let y = -200; y < doc.page.height + 400; y += 140) {
              for (let x = -200; x < doc.page.width + 400; x += 240) {
                doc.text(text, x, y, { lineBreak: false });
              }
            }
            doc.restore();
          }
        } catch (e) {
          console.warn('[pdf] watermark error:', e.message);
        }
      }
      doc.end();
    }

    const pageW = doc.page.width;
    const pageH = doc.page.height;
    const contentW = pageW - margin * 2;
    const leftX = margin;

    // 信用額度申請表
    if (isCreditLimitRequest(request)) {
      try {
        drawCreditLimitForm(
          { doc, useFont, leftX, contentW, pageH, margin },
          request
        );
        endPdfWithApprovedStamp(doc, request, useFont);
      } catch (e) {
        console.error('[pdf] credit limit form failed', e);
        reject(e);
      }
      return;
    }

    // 請假單：專用版面
    if (isLeaveRequest(request)) {
      try {
        drawLeaveForm(
          { doc, useFont, leftX, contentW, pageH, margin },
          request
        );
        endPdfWithApprovedStamp(doc, request, useFont);
      } catch (e) {
        console.error('[pdf] leave form failed', e);
        reject(e);
      }
      return;
    }

    // 請購申請
    if (isPurchaseRequest(request)) {
      try {
        drawPurchaseForm(
          { doc, useFont, leftX, contentW, pageH, margin },
          request
        );
        endPdfWithApprovedStamp(doc, request, useFont);
      } catch (e) {
        console.error('[pdf] purchase form failed', e);
        reject(e);
      }
      return;
    }

    // 費用報支
    if (isExpenseRequest(request)) {
      try {
        drawExpenseForm(
          { doc, useFont, leftX, contentW, pageH, margin },
          request
        );
        endPdfWithApprovedStamp(doc, request, useFont);
      } catch (e) {
        console.error('[pdf] expense form failed', e);
        reject(e);
      }
      return;
    }

    // 出差申請
    if (isTravelRequest(request)) {
      try {
        drawTravelForm(
          { doc, useFont, leftX, contentW, pageH, margin },
          request
        );
        endPdfWithApprovedStamp(doc, request, useFont);
      } catch (e) {
        console.error('[pdf] travel form failed', e);
        reject(e);
      }
      return;
    }

    // 電腦異常報修
    if (isItRepairRequest(request)) {
      try {
        drawItRepairForm(
          { doc, useFont, leftX, contentW, pageH, margin },
          request
        );
        endPdfWithApprovedStamp(doc, request, useFont);
      } catch (e) {
        console.error('[pdf] it repair form failed', e);
        reject(e);
      }
      return;
    }

    // 延長工時／加班
    if (isOvertimeRequest(request)) {
      try {
        drawOvertimeForm(
          { doc, useFont, leftX, contentW, pageH, margin },
          request
        );
        endPdfWithApprovedStamp(doc, request, useFont);
      } catch (e) {
        console.error('[pdf] overtime form failed', e);
        reject(e);
      }
      return;
    }

    // 一般簽呈
    if (isGeneralMemoRequest(request)) {
      try {
        drawGeneralMemoForm(
          { doc, useFont, leftX, contentW, pageH, margin },
          request
        );
        endPdfWithApprovedStamp(doc, request, useFont);
      } catch (e) {
        console.error('[pdf] general memo form failed', e);
        reject(e);
      }
      return;
    }

    // 其餘／新建簽核流程：一律使用標準表單版型（與現行各表風格一致）
    try {
      drawStandardWorkflowForm(
        { doc, useFont, leftX, contentW, pageH, margin },
        request
      );
      endPdfWithApprovedStamp(doc, request, useFont);
    } catch (e) {
      console.error('[pdf] standard form failed', e);
      reject(e);
    }
  });
}

/**
 * 檔名安全字元（移除路徑／非法字元）
 */
function safeFilePart(s, fallback = '—') {
  const t = String(s || '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .trim()
    .slice(0, 40);
  return t || fallback;
}

/**
 * 日期 YYYYMMDD（優先申請建立日）
 */
function formatDateYmdCompact(val) {
  if (!val) {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}${m}${day}`;
  }
  const s = String(val).trim().replace(/\//g, '-');
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}${m[2]}${m[3]}`;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}${mo}${day}`;
  }
  return formatDateYmdCompact(null);
}

/**
 * PDF／ZIP 檔名規則：表單名稱_申請人_日期+五位數流水號
 * 例：請假申請_王小明_2026071800012
 * 流水號採單號 id 右側補滿 5 位
 */
function buildApprovalFileBaseName(request) {
  const form = safeFilePart(request.workflow_name || '簽核申請', '簽核申請');
  const applicant = safeFilePart(request.requester_name || '申請人', '申請人');
  const datePart = formatDateYmdCompact(
    request.created_at || request.completed_at || null
  );
  const serial = String(Math.abs(Number(request.id) || 0))
    .padStart(5, '0')
    .slice(-5);
  return `${form}_${applicant}_${datePart}${serial}`;
}

function buildApprovalPdfFileName(request) {
  return `${buildApprovalFileBaseName(request)}.pdf`;
}

/**
 * ZIP 檔名：僅有附件時才加「_含附件」
 * （例如加密備份無附件時為 xxx.zip，不寫含附件）
 * @param {object} request
 * @param {{ hasAttachments?: boolean }} [opts]
 */
function buildApprovalZipFileName(request, opts = {}) {
  const hasAttachments = opts.hasAttachments !== false;
  const base = buildApprovalFileBaseName(request);
  return hasAttachments ? `${base}_含附件.zip` : `${base}.zip`;
}

/** Content-Disposition（ASCII fallback + UTF-8 檔名） */
function contentDispositionAttachment(utfFileName, asciiFallback) {
  const ascii =
    asciiFallback ||
    String(utfFileName || 'download.bin')
      .replace(/[^\x20-\x7E]/g, '_')
      .replace(/["\\]/g, '_') ||
    'download.bin';
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(utfFileName)}`;
}

/** HTTP 下載用 */
function generateApprovalPdf(request, res) {
  res.setHeader('Content-Type', 'application/pdf');
  const utfName = buildApprovalPdfFileName(request);
  const asciiName = `approval-${request.id || 0}.pdf`;
  res.setHeader(
    'Content-Disposition',
    contentDispositionAttachment(utfName, asciiName)
  );
  return writeApprovalPdf(request, res);
}

module.exports = {
  generateApprovalPdf,
  writeApprovalPdf,
  getChineseFontPath,
  resolveChineseFont,
  buildApprovalFileBaseName,
  buildApprovalPdfFileName,
  buildApprovalZipFileName,
  contentDispositionAttachment,
  safeFilePart,
};
