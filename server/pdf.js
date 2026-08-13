/**
 * 簽核 PDF：編排入口（實作在 server/pdf/）
 */
const { getChineseFontPath, resolveChineseFont } = require('./pdf/font');
const { writeApprovalPdf, generateApprovalPdf } = require('./pdf/write');
const {
  safeFilePart,
  buildApprovalFileBaseName,
  buildApprovalPdfFileName,
  buildApprovalZipFileName,
  contentDispositionAttachment,
} = require('./pdf/filename');

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
