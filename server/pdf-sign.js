/**
 * PDF 公司憑證數位簽章
 * 使用 PKCS#12（.p12 / .pfx）+ @signpdf
 */
const fs = require('fs');
const path = require('path');
const systemSettings = require('./system-settings');

let signpdfMod = null;
let P12Signer = null;
let plainAddPlaceholder = null;
let loadError = null;

function loadSignLibs() {
  if (signpdfMod || loadError) return !!signpdfMod;
  try {
    // @signpdf monorepo packages（CJS）
    const sp = require('@signpdf/signpdf');
    signpdfMod = sp.default || sp;
    if (signpdfMod && typeof signpdfMod.sign !== 'function' && sp.SignPdf) {
      signpdfMod = new sp.SignPdf();
    }
    const s12 = require('@signpdf/signer-p12');
    P12Signer = s12.P12Signer || s12.default;
    const ph = require('@signpdf/placeholder-plain');
    plainAddPlaceholder = ph.plainAddPlaceholder || ph.default;
    if (
      !signpdfMod ||
      typeof signpdfMod.sign !== 'function' ||
      !P12Signer ||
      typeof plainAddPlaceholder !== 'function'
    ) {
      throw new Error('signpdf 模組不完整');
    }
    return true;
  } catch (e) {
    loadError = e;
    console.warn('[pdf-sign] 無法載入數位簽章套件：', e.message);
    return false;
  }
}

function getSigningStatus() {
  const cfg = systemSettings.getPdfSignConfig();
  const libsOk = loadSignLibs();
  return {
    enabled: !!cfg.enabled,
    hasCert: !!cfg.hasCert,
    hasPass: !!cfg.hasPass,
    onlyApproved: cfg.onlyApproved !== false,
    reason: cfg.reason || '',
    location: cfg.location || '',
    contactInfo: cfg.contactInfo || '',
    signerName: cfg.signerName || '',
    libsReady: libsOk,
    libsError: loadError ? loadError.message : null,
    // 憑證密碼可為空（部分 p12 無密碼）
    ready: !!(cfg.enabled && cfg.hasCert && libsOk),
  };
}

/**
 * 是否應對此單據簽署
 */
function shouldSignRequest(request) {
  const st = getSigningStatus();
  if (!st.ready) return false;
  if (st.onlyApproved && request && request.status !== 'approved') return false;
  return true;
}

/**
 * 對 PDF Buffer 加上公司憑證數位簽章
 * @param {Buffer} pdfBuffer
 * @param {{ request?: object }} [opts]
 * @returns {Promise<Buffer>}
 */
async function signPdfBuffer(pdfBuffer, opts = {}) {
  if (!Buffer.isBuffer(pdfBuffer) || !pdfBuffer.length) {
    throw new Error('無效的 PDF 資料');
  }
  if (!loadSignLibs()) {
    throw new Error(
      loadError?.message ||
        '未安裝數位簽章套件（@signpdf/*）。請重新建置 Docker 映像。'
    );
  }
  const cfg = systemSettings.getPdfSignConfig();
  if (!opts.force && !cfg.enabled) return pdfBuffer;
  const certPath = systemSettings.getPdfSignCertPath();
  if (!certPath || !fs.existsSync(certPath)) {
    throw new Error('尚未上傳公司簽章憑證（.p12 / .pfx）');
  }
  const passphrase = cfg.passphrase || '';

  const company = systemSettings.getCompanyName();
  const req = opts.request || {};
  const reason =
    cfg.reason ||
    `線上簽核系統產出 · 單號 #${req.id || ''} · ${req.workflow_name || ''}`.trim();
  const name = cfg.signerName || company || '線上簽核系統';
  const location = cfg.location || 'Taiwan';
  const contactInfo = cfg.contactInfo || '';

  const p12Buffer = fs.readFileSync(certPath);

  // 預留簽章空間後再簽署
  const withPlaceholder = plainAddPlaceholder({
    pdfBuffer,
    reason: String(reason).slice(0, 200),
    contactInfo: String(contactInfo).slice(0, 120),
    name: String(name).slice(0, 80),
    location: String(location).slice(0, 80),
    signatureLength: 16184,
  });

  const signer = new P12Signer(p12Buffer, { passphrase: String(passphrase || '') });
  const signed = await signpdfMod.sign(withPlaceholder, signer);
  return Buffer.isBuffer(signed) ? signed : Buffer.from(signed);
}

/**
 * 產生簽核 PDF（可選數位簽章）
 */
async function buildApprovalPdfBuffer(request, writeApprovalPdf) {
  const { PassThrough } = require('stream');
  const chunks = [];
  const pass = new PassThrough();
  pass.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    pass.on('end', resolve);
    pass.on('error', reject);
  });
  await writeApprovalPdf(request, pass);
  await done;
  let buf = Buffer.concat(chunks);
  if (shouldSignRequest(request)) {
    try {
      buf = await signPdfBuffer(buf, { request });
    } catch (e) {
      // 憑證密碼錯誤／損壞時：仍回傳未簽署 PDF，避免「下載失敗」
      // 前端／日誌可據此排查；正式環境請至系統設定重新製作或上傳憑證
      console.error('[pdf-sign] 簽署失敗，改回傳未簽署 PDF：', e.message || e);
      buf._pdfSignSkipped = true;
      buf._pdfSignError = String(e.message || e);
    }
  }
  return buf;
}

module.exports = {
  getSigningStatus,
  shouldSignRequest,
  signPdfBuffer,
  buildApprovalPdfBuffer,
  loadSignLibs,
};
