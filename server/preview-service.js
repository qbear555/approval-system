/**
 * Office 附件極速預覽與快取服務
 * - 支援 Word / Excel / PPT / PDF / 圖片 / 試算表即時預覽
 * - 當 OnlyOffice Document Server 啟用時，透過 ConvertService 產出高畫質向量 PDF 快取
 * - 當 OnlyOffice 未啟用或離線時，內建 SheetJS (xlsx) 即時解析試算表為 JSON/Grid
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
let XLSX = null;
try {
  XLSX = require('xlsx');
} catch (e) {
  console.warn('[preview-service] xlsx module not found, sheet parsing disabled');
}

const ROOT = path.join(__dirname, '..');
const UPLOAD_DIR = path.join(ROOT, 'data', 'uploads');
const CACHE_DIR = path.join(ROOT, 'data', 'preview-cache');

if (!fs.existsSync(CACHE_DIR)) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  } catch (err) {
    console.warn('[preview-service] failed to create cache dir:', err.message);
  }
}

const EXT_MAP = {
  pdf: 'pdf',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  bmp: 'image',
  svg: 'image',
  xlsx: 'sheet',
  xls: 'sheet',
  ods: 'sheet',
  csv: 'sheet',
  docx: 'doc',
  doc: 'doc',
  odt: 'doc',
  rtf: 'doc',
  pptx: 'slide',
  ppt: 'slide',
  odp: 'slide',
  txt: 'text',
  md: 'text',
  json: 'text',
};

function extOf(filename) {
  return path.extname(String(filename || '')).replace(/^\./, '').toLowerCase();
}

function getPreviewType(att) {
  if (!att) return 'none';
  const ext = extOf(att.original_name || att.stored_name);
  if (EXT_MAP[ext]) return EXT_MAP[ext];
  const mime = String(att.mime_type || '').toLowerCase();
  if (mime.includes('pdf')) return 'pdf';
  if (mime.startsWith('image/')) return 'image';
  if (mime.includes('spreadsheet') || mime.includes('excel')) return 'sheet';
  if (mime.includes('word') || mime.includes('msword') || mime.includes('officedocument')) return 'doc';
  return 'none';
}

function resolveAttachmentPath(att) {
  if (!att) return null;
  const p1 = path.join(UPLOAD_DIR, att.stored_name);
  if (fs.existsSync(p1)) return p1;
  const p2 = path.join(UPLOAD_DIR, path.basename(att.stored_name));
  if (fs.existsSync(p2)) return p2;
  return null;
}

function getCacheKey(att) {
  const raw = `${att.id}_${att.stored_name}_${att.size_bytes || 0}_${att.created_at || ''}`;
  const hash = crypto.createHash('md5').update(raw).digest('hex').slice(0, 16);
  return `${att.id}_${hash}.pdf`;
}

/**
 * 透過 OnlyOffice ConvertService 將 Office 檔案轉成 PDF
 */
async function convertOfficeToPdf(att, onlyoffice) {
  if (!onlyoffice || !onlyoffice.isEnabled()) {
    return { ok: false, error: 'OnlyOffice 服務未啟用' };
  }

  const cacheKey = getCacheKey(att);
  const cachePath = path.join(CACHE_DIR, cacheKey);
  if (fs.existsSync(cachePath) && fs.statSync(cachePath).size > 0) {
    return { ok: true, cached: true, pdfPath: cachePath };
  }

  const cfg = onlyoffice.getConfig();
  const ext = extOf(att.original_name || att.stored_name);
  const fileToken = onlyoffice.signFileToken({
    attId: att.id,
    storedName: att.stored_name,
  }, 3600);

  const downloadUrl = `${cfg.appUrl}/api/onlyoffice/file/${att.id}?token=${encodeURIComponent(fileToken)}`;
  const key = `conv_${att.id}_${Date.now()}`;

  const payload = {
    async: false,
    filetype: ext,
    outputtype: 'pdf',
    key,
    title: att.original_name || `file-${att.id}`,
    url: downloadUrl,
  };

  if (cfg.jwtEnabled && cfg.jwtSecret) {
    const token = jwt.sign(payload, cfg.jwtSecret);
    payload.token = token;
  }

  const targetUrl = new URL(`${cfg.internalUrl}/ConvertService.ashx`);
  const reqData = JSON.stringify(payload);
  const isHttps = targetUrl.protocol === 'https:';
  const client = isHttps ? https : http;

  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Content-Length': Buffer.byteLength(reqData),
  };
  if (payload.token) {
    headers['Authorization'] = `Bearer ${payload.token}`;
  }

  const convRes = await new Promise((resolve, reject) => {
    const req = client.request(
      {
        protocol: targetUrl.protocol,
        hostname: targetUrl.hostname,
        port: targetUrl.port || (isHttps ? 443 : 80),
        path: targetUrl.pathname,
        method: 'POST',
        headers,
        timeout: 25000,
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            resolve({ error: -1, raw: body });
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('OnlyOffice 轉換連線逾時'));
    });
    req.write(reqData);
    req.end();
  });

  if (!convRes.fileUrl) {
    return {
      ok: false,
      error: `轉換失敗 (code: ${convRes.error ?? -1})`,
      details: convRes,
    };
  }

  // 下載產出的 PDF 並寫入 cachePath
  let downloadPdfUrl = convRes.fileUrl;
  try {
    const parsed = new URL(downloadPdfUrl);
    // 若 Document Server 回傳了內部的容器名稱或需要經 internalUrl 抓取
    if (parsed.hostname === targetUrl.hostname || parsed.port === targetUrl.port) {
      parsed.hostname = targetUrl.hostname;
      parsed.port = targetUrl.port;
      downloadPdfUrl = parsed.toString();
    }
  } catch (e) {
    /* keep downloadPdfUrl */
  }

  const pdfBuffer = await new Promise((resolve, reject) => {
    const pUrl = new URL(downloadPdfUrl);
    const c = pUrl.protocol === 'https:' ? https : http;
    c.get(pUrl, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`下載轉換 PDF 失敗，HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });

  fs.writeFileSync(cachePath, pdfBuffer);
  return { ok: true, cached: false, pdfPath: cachePath };
}

/**
 * 試算表極速解析 (SheetJS)
 */
function parseSpreadsheet(att, maxRows = 500) {
  if (!XLSX) {
    throw new Error('未安裝 xlsx 模組，無法解析試算表');
  }
  const absPath = resolveAttachmentPath(att);
  if (!absPath) {
    throw new Error('附件實體檔案不存在');
  }

  const wb = XLSX.readFile(absPath, { cellDates: true, raw: false });
  const sheetNames = wb.SheetNames || [];
  const sheets = [];

  for (const name of sheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const rawData = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    const totalRows = rawData.length;
    let maxCols = 0;
    const rows = rawData.slice(0, maxRows).map((row) => {
      const arr = Array.isArray(row) ? row : [row];
      if (arr.length > maxCols) maxCols = arr.length;
      return arr.map((cell) => {
        if (cell == null) return '';
        if (cell instanceof Date) {
          return cell.toLocaleDateString('zh-TW');
        }
        return String(cell);
      });
    });

    sheets.push({
      name,
      rows,
      totalRows,
      maxCols,
      truncated: totalRows > maxRows,
    });
  }

  return {
    title: att.original_name || '試算表',
    sheets,
  };
}

module.exports = {
  getPreviewType,
  resolveAttachmentPath,
  convertOfficeToPdf,
  parseSpreadsheet,
  getCacheKey,
  UPLOAD_DIR,
  CACHE_DIR,
};
