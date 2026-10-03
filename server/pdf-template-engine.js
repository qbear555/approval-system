/**
 * 紙本 PDF 模版套印引擎 (PDF Template Overlay Engine)
 * 使用 pdf-lib + fontkit 將表單欄位與審核簽章精確套印至原始紙本底圖
 */
const fs = require('fs');
const path = require('path');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const { bufferFromDataUrl } = require('./signature');

function resolveFontPath() {
  const candidates = [
    path.join(__dirname, '..', 'fonts', 'Deng.ttf'),
    path.join(__dirname, '..', 'fonts', 'simhei.ttf'),
    path.join(__dirname, '..', 'fonts', 'NotoSansTC-Regular.otf'),
    path.join(__dirname, '..', 'fonts', 'kaiu.ttf'),
    path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts', 'Deng.ttf'),
    path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts', 'msjh.ttf'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * 將文字拆分為符合寬度的多行文字
 */
function wrapText(text, maxWidth, font, fontSize) {
  const lines = [];
  const rawLines = String(text || '').split(/\r?\n/);
  for (const raw of rawLines) {
    if (!raw) {
      lines.push('');
      continue;
    }
    let cur = '';
    for (const char of raw) {
      const test = cur + char;
      const width = font.widthOfTextAtSize(test, fontSize);
      if (width > maxWidth && cur.length > 0) {
        lines.push(cur);
        cur = char;
      } else {
        cur = test;
      }
    }
    if (cur.length > 0) {
      lines.push(cur);
    }
  }
  return lines;
}

/**
 * 產生套印後的 PDF Buffer
 * @param {Object} opts
 * @param {string} opts.templateAbsPath - 底圖 PDF 或圖片之絕對路徑
 * @param {Array} opts.fields - 欄位座標與定義陣列
 * @param {Object} opts.formData - 表單填寫值 { [fieldId]: value }
 * @param {Array} opts.actions - 簽核動作紀錄（包含各關卡核准人與簽名）
 * @param {Object} opts.requester - 申請人資訊 { id, name, username, signature_image }
 * @param {Object} [opts.request] - 申請單基本資訊 { id, title, created_at, status }
 * @param {Object} [opts.db] - 資料庫連接實例
 * @returns {Promise<Buffer>}
 */
async function renderPdfTemplate({
  templateAbsPath,
  fields = [],
  formData = {},
  actions = [],
  requester = {},
  request = {},
  db = null,
}) {
  if (!fs.existsSync(templateAbsPath)) {
    throw new Error(`找不到底圖範本檔案：${templateAbsPath}`);
  }

  const ext = path.extname(templateAbsPath).toLowerCase();
  let pdfDoc;

  if (ext === '.pdf') {
    const existingBytes = fs.readFileSync(templateAbsPath);
    pdfDoc = await PDFDocument.load(existingBytes);
  } else if (['.png', '.jpg', '.jpeg'].includes(ext)) {
    // 若為圖片底圖，建立標準 A4 (595.28 x 841.89) PDF 並貼入圖片
    pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595.28, 841.89]);
    const imgBytes = fs.readFileSync(templateAbsPath);
    const img = ext === '.png' ? await pdfDoc.embedPng(imgBytes) : await pdfDoc.embedJpg(imgBytes);
    page.drawImage(img, {
      x: 0,
      y: 0,
      width: 595.28,
      height: 841.89,
    });
  } else {
    throw new Error(`不支援的底圖格式：${ext}（僅支援 PDF, PNG, JPG）`);
  }

  // 註冊字型
  pdfDoc.registerFontkit(fontkit);
  let customFont = null;
  const fontPath = resolveFontPath();
  if (fontPath) {
    try {
      const fontBytes = fs.readFileSync(fontPath);
      customFont = await pdfDoc.embedFont(fontBytes, { subset: true });
    } catch (e) {
      console.warn('[pdf-template-engine] 載入中文字型失敗，改用備援：', e.message);
    }
  }
  if (!customFont) {
    customFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  }

  const pages = pdfDoc.getPages();

  // 處理各欄位套印
  for (const f of fields) {
    const pageIndex = Math.max(0, (Number(f.page) || 1) - 1);
    if (pageIndex >= pages.length) continue;
    const page = pages[pageIndex];
    const pageWidth = page.getWidth();
    const pageHeight = page.getHeight();

    // 座標計算：支援比例（ratio 0~1）或直接座標
    let pdfX, pdfY, pdfW, pdfH;
    if (f.rx !== undefined && f.ry !== undefined && f.rw !== undefined && f.rh !== undefined) {
      pdfX = f.rx * pageWidth;
      pdfW = f.rw * pageWidth;
      pdfH = f.rh * pageHeight;
      pdfY = pageHeight - (f.ry * pageHeight) - pdfH;
    } else {
      // 依傳入的參考寬高進行換算
      const refW = Number(f.canvasW) || pageWidth;
      const refH = Number(f.canvasH) || pageHeight;
      const rx = (Number(f.x) || 0) / refW;
      const ry = (Number(f.y) || 0) / refH;
      const rw = (Number(f.w) || 100) / refW;
      const rh = (Number(f.h) || 30) / refH;
      pdfX = rx * pageWidth;
      pdfW = rw * pageWidth;
      pdfH = rh * pageHeight;
      pdfY = pageHeight - (ry * pageHeight) - pdfH;
    }

    // 1. 簽章 / 電子印章欄位
    if (f.type === 'signature' || f.isStamp) {
      let signUser = null;
      let signDate = '';
      if (f.role === 'requester') {
        signUser = requester;
        signDate = request.created_at ? request.created_at.slice(0, 10) : '';
      } else {
        // 尋找對應關卡的簽核核准紀錄
        const targetStep = f.stepOrder != null ? Number(f.stepOrder) : null;
        const approveAction = (actions || []).find(
          (a) =>
            a.action === 'approve' &&
            (targetStep == null || a.step_order === targetStep)
        );
        if (approveAction) {
          signDate = approveAction.created_at ? approveAction.created_at.slice(0, 10) : '';
          if (db && approveAction.actor_id) {
            signUser = db
              .prepare('SELECT id, name, username, signature_image FROM users WHERE id = ?')
              .get(approveAction.actor_id);
          } else {
            signUser = { name: approveAction.actor_name || '審核人' };
          }
        }
      }

      if (signUser) {
        let hasDrawnImage = false;
        if (signUser.signature_image) {
          const imgBuf = bufferFromDataUrl(signUser.signature_image);
          if (imgBuf) {
            try {
              // 支援 PNG / JPG 簽名
              const signImg =
                signUser.signature_image.startsWith('data:image/jpeg') ||
                signUser.signature_image.startsWith('data:image/jpg')
                  ? await pdfDoc.embedJpg(imgBuf)
                  : await pdfDoc.embedPng(imgBuf);

              const imgAspect = signImg.width / signImg.height;
              const boxAspect = pdfW / pdfH;
              let drawW = pdfW;
              let drawH = pdfH;
              if (boxAspect > imgAspect) {
                drawW = pdfH * imgAspect;
              } else {
                drawH = pdfW / imgAspect;
              }
              const offsetX = pdfX + (pdfW - drawW) / 2;
              const offsetY = pdfY + (pdfH - drawH) / 2;

              page.drawImage(signImg, {
                x: offsetX,
                y: offsetY,
                width: drawW,
                height: drawH,
              });
              hasDrawnImage = true;
            } catch (err) {
              console.warn('[pdf-template-engine] 嵌入簽名圖檔失敗：', err.message);
            }
          }
        }

        // 若無上傳圖檔簽名，則繪製標準電子核章方塊/文字
        if (!hasDrawnImage) {
          const text = signUser.name || signUser.username || '已核准';
          const fontSize = Math.max(9, Math.min(13, pdfH * 0.35));
          const textW = customFont.widthOfTextAtSize(text, fontSize);
          const tX = pdfX + Math.max(0, (pdfW - textW) / 2);
          const tY = pdfY + (pdfH / 2) - (fontSize / 4) + (signDate ? 5 : 0);

          page.drawText(text, {
            x: tX,
            y: tY,
            size: fontSize,
            font: customFont,
            color: rgb(0.1, 0.1, 0.1),
          });

          if (signDate) {
            const dateFontSize = Math.max(7, fontSize * 0.75);
            const dateW = customFont.widthOfTextAtSize(signDate, dateFontSize);
            page.drawText(signDate, {
              x: pdfX + Math.max(0, (pdfW - dateW) / 2),
              y: pdfY + 4,
              size: dateFontSize,
              font: customFont,
              color: rgb(0.4, 0.4, 0.4),
            });
          }
        }
      }
      continue;
    }

    // 2. 一般填寫欄位 (text, textarea, number, date, select, checkbox)
    const val = formData[f.id] !== undefined ? formData[f.id] : formData[f.name];
    if (val === undefined || val === null || val === '') continue;

    // 核取方塊
    if (f.type === 'checkbox') {
      const isChecked = val === true || val === 'true' || val === 1 || val === '1' || val === 'yes';
      if (isChecked) {
        const mark = '✓';
        const fontSize = Math.min(pdfW, pdfH) * 0.85;
        page.drawText(mark, {
          x: pdfX + (pdfW * 0.15),
          y: pdfY + (pdfH * 0.15),
          size: fontSize,
          font: customFont,
          color: rgb(0, 0, 0),
        });
      }
      continue;
    }

    // 文字或多行文字
    const strVal = String(val);
    const fontSize = Number(f.fontSize) || 11;
    const align = f.align || 'left';
    const lines = wrapText(strVal, pdfW - 4, customFont, fontSize);
    const lineHeight = fontSize * 1.35;

    let curY = pdfY + pdfH - fontSize - 2;
    for (const line of lines) {
      if (curY < pdfY) break; // 超出高度則截斷
      let textX = pdfX + 2;
      const textWidth = customFont.widthOfTextAtSize(line, fontSize);
      if (align === 'center') {
        textX = pdfX + Math.max(0, (pdfW - textWidth) / 2);
      } else if (align === 'right') {
        textX = pdfX + Math.max(0, pdfW - textWidth - 2);
      }

      page.drawText(line, {
        x: textX,
        y: curY,
        size: fontSize,
        font: customFont,
        color: rgb(0, 0, 0),
      });
      curY -= lineHeight;
    }
  }

  const resultBytes = await pdfDoc.save();
  return Buffer.from(resultBytes);
}

module.exports = {
  renderPdfTemplate,
  resolveFontPath,
};
