/**
 * PDF／ZIP 下載與備份檔名
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

/** 表單名稱_申請人_日期+五位流水號，例：請假申請_王小明_2026071800012 */
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
 * @param {object} request
 * @param {{ hasAttachments?: boolean }} [opts]
 */
function buildApprovalZipFileName(request, opts = {}) {
  const hasAttachments = opts.hasAttachments !== false;
  const base = buildApprovalFileBaseName(request);
  return hasAttachments ? `${base}_含附件.zip` : `${base}.zip`;
}

function contentDispositionAttachment(utfFileName, asciiFallback) {
  const ascii =
    asciiFallback ||
    String(utfFileName || 'download.bin')
      .replace(/[^\x20-\x7E]/g, '_')
      .replace(/["\\]/g, '_') ||
    'download.bin';
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(utfFileName)}`;
}

module.exports = {
  safeFilePart,
  formatDateYmdCompact,
  buildApprovalFileBaseName,
  buildApprovalPdfFileName,
  buildApprovalZipFileName,
  contentDispositionAttachment,
};
