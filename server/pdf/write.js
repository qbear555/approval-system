/**
 * 產生簽核 PDF 並寫入串流
 */
const PDFDocument = require('pdfkit');
const { getChineseFontPath, getCompanyNameForPdf } = require('./font');
const {
  isLeaveRequest,
  isCreditLimitRequest,
  isPurchaseRequest,
  isExpenseRequest,
  isTravelRequest,
  isItRepairRequest,
  isOvertimeRequest,
  isGeneralMemoRequest,
} = require('./meta');
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
} = require('./forms');
const { endPdfWithApprovedStamp } = require('./stamp');
const { buildApprovalPdfFileName, contentDispositionAttachment } = require('./filename');

const FORM_DRAWERS = [
  [isCreditLimitRequest, drawCreditLimitForm, 'credit limit form'],
  [isLeaveRequest, drawLeaveForm, 'leave form'],
  [isPurchaseRequest, drawPurchaseForm, 'purchase form'],
  [isExpenseRequest, drawExpenseForm, 'expense form'],
  [isTravelRequest, drawTravelForm, 'travel form'],
  [isItRepairRequest, drawItRepairForm, 'it repair form'],
  [isOvertimeRequest, drawOvertimeForm, 'overtime form'],
  [isGeneralMemoRequest, drawGeneralMemoForm, 'general memo form'],
];

function writeApprovalPdf(request, destStream) {
  const pl = request.pdfLayout || {};
  if (pl.type === 'pdf_template' && pl.templateFile) {
    const templateRel = String(pl.templateFile).replace(/^[/\\]+/, '');
    const templateAbs = path.join(__dirname, '..', '..', 'data', templateRel);
    if (fs.existsSync(templateAbs)) {
      const { renderPdfTemplate } = require('../pdf-template-engine');
      const db = require('../db');
      return renderPdfTemplate({
        templateAbsPath: templateAbs,
        fields: pl.fields || [],
        formData: request.form_data || {},
        actions: request.actions || [],
        requester: {
          id: request.requester_id,
          name: request.requester_name,
          username: request.requester_username,
        },
        request: {
          id: request.id,
          title: request.title,
          created_at: request.created_at,
          status: request.status,
        },
        db,
      }).then((buf) => {
        destStream.end(buf);
      });
    }
  }

  return new Promise((resolve, reject) => {
    const fontPath = getChineseFontPath();
    const margin = 40;
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: margin, bottom: margin, left: margin, right: margin },
      autoFirstPage: true,
      bufferPages: true,
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

    const pageW = doc.page.width;
    const pageH = doc.page.height;
    const contentW = pageW - margin * 2;
    const leftX = margin;
    const ctx = { doc, useFont, leftX, contentW, pageH, margin };

    try {
      let drawn = false;
      for (const [match, draw, label] of FORM_DRAWERS) {
        if (!match(request)) continue;
        try {
          draw(ctx, request);
        } catch (e) {
          console.error('[pdf]', label, 'failed', e);
          throw e;
        }
        drawn = true;
        break;
      }
      if (!drawn) drawStandardWorkflowForm(ctx, request);
      endPdfWithApprovedStamp(doc, request, useFont, fontReady);
    } catch (e) {
      console.error('[pdf] form failed', e);
      reject(e);
    }
  });
}

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
  writeApprovalPdf,
  generateApprovalPdf,
};
