const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

/** 專案根 fonts/（本檔在 server/pdf/，需上兩層） */
function projectFontsDir() {
  return path.join(__dirname, '..', '..', 'fonts');
}

/** SimSun-ExtB／擴展 B 幾乎沒有常用中文，選到會讓標籤空白 */
function isRejectedCjkFont(nameOrPath) {
  const lower = String(nameOrPath || '').toLowerCase();
  return /simsunb|simsun-ext|ext-?b|extb/.test(lower);
}

function resolveChineseFont() {
  const winFonts = path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts');
  const projectFonts = projectFontsDir();

  // 預設：無襯線 TTF（等線／黑體）；避免標楷體、Ext-B 與部分 CJK OTF（PDFKit 會亂碼）
  const candidates = [
    path.join(projectFonts, 'Deng.ttf'), // 等線（推薦）
    path.join(projectFonts, 'simhei.ttf'),
    path.join(projectFonts, 'NotoSansTC-Regular.ttf'),
    path.join(projectFonts, 'SourceHanSansTC-Regular.otf'),
    path.join(winFonts, 'Deng.ttf'),
    path.join(winFonts, 'Dengb.ttf'),
    path.join(winFonts, 'simhei.ttf'),
    path.join(winFonts, 'msyh.ttf'),
    path.join(winFonts, 'msjh.ttf'),
    path.join(winFonts, 'simfang.ttf'),
    // 部分 Subset OTF 在 PDFKit 會亂碼，排在後面
    path.join(projectFonts, 'NotoSansTC-Regular.otf'),
    path.join(projectFonts, 'NotoSansCJKtc-Regular.otf'),
    // 最後備援（標楷體）
    path.join(projectFonts, 'kaiu.ttf'),
    path.join(winFonts, 'kaiu.ttf'),
    path.join(winFonts, 'simkai.ttf'),
  ];

  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    if (/\.ttc$/i.test(p)) continue;
    if (/-VF\.ttf$/i.test(p) || /Variable/i.test(p)) continue;
    if (isRejectedCjkFont(p)) continue;
    return p;
  }
  return null;
}

function canUseFont(fontPath) {
  try {
    const { PassThrough } = require('stream');
    const doc = new PDFDocument({ autoFirstPage: false });
    const sink = new PassThrough();
    sink.resume();
    doc.pipe(sink);
    doc.addPage();
    doc.registerFont('__probe__', fontPath);
    doc.font('__probe__').fontSize(10).text('測試中文ABC', 50, 50);
    doc.end();
    return true;
  } catch {
    return false;
  }
}

let cachedFontPath = undefined;

function getChineseFontPath() {
  if (cachedFontPath !== undefined) return cachedFontPath;
  const preferred = resolveChineseFont();
  if (preferred && canUseFont(preferred)) {
    cachedFontPath = preferred;
    return cachedFontPath;
  }
  const winFonts = path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts');
  try {
    const files = fs.readdirSync(winFonts);
    for (const name of files) {
      if (!/\.ttf$/i.test(name)) continue;
      if (/-VF/i.test(name)) continue;
      if (isRejectedCjkFont(name)) continue;
      const lower = name.toLowerCase();
      // 掃描 Windows 字型時優先無襯線；略過標楷／楷體與泛用 ming（避免 simsunb）
      if (
        !/msyh|msjh|simhei|simfang|deng|noto|sourcehan|uming|wqy|firefly|yuan|hei/.test(
          lower
        )
      ) {
        continue;
      }
      const full = path.join(winFonts, name);
      if (canUseFont(full)) {
        cachedFontPath = full;
        return cachedFontPath;
      }
    }
  } catch {
    /* ignore */
  }
  cachedFontPath = preferred;
  return cachedFontPath;
}

/** 公司名稱（PDF 抬頭；讀取系統設定） */
function getCompanyNameForPdf() {
  try {
    const n = require('../system-settings').getCompanyName();
    return n != null ? String(n) : '';
  } catch {
    return '';
  }
}
const COMPANY_NAME = ''; // 相容舊常數名

module.exports = {
  resolveChineseFont,
  canUseFont,
  getChineseFontPath,
  getCompanyNameForPdf,
  isRejectedCjkFont,
  projectFontsDir,
  COMPANY_NAME,
};
