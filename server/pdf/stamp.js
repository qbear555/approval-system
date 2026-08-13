/**
 * 已核准印章＋檢視防偽浮水印
 */
const tz = require('../tz');

function drawApprovedStamp(doc, useFont) {
  const pageW = doc.page.width;
  const margin = 40;
  const cx = pageW - margin - 40;
  const cy = margin + 48;
  const r = 38;
  const red = '#c41e3a';

  doc.save();
  try {
    doc.translate(cx, cy);
    doc.rotate(-16);
    doc.circle(0, 0, r).lineWidth(3).strokeColor(red).stroke();
    doc.circle(0, 0, r - 6).lineWidth(1.4).strokeColor(red).stroke();
    if (typeof useFont === 'function') useFont();
    doc.fillColor(red).fontSize(20);
    const label = '核准';
    const tw = doc.widthOfString(label);
    doc.text(label, -tw / 2, -9, { lineBreak: false });
    doc.fontSize(7);
    const sub = 'APPROVED';
    const sw = doc.widthOfString(sub);
    doc.text(sub, -sw / 2, 14, { lineBreak: false });
  } finally {
    doc.restore();
  }
}

function drawViewWatermark(doc, request, fontReady) {
  if (!(request.watermarkText || request.requester_name)) return;
  const text = String(
    request.watermarkText ||
      `檢視/列印防偽：${request.requester_name || '系統同仁'} · ${tz.nowMinute()}`
  ).trim();
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.save();
    if (fontReady) {
      try {
        doc.font('CJK');
      } catch {
        /* ignore */
      }
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
}

/** 浮水印 → 第一頁核准章 → 結束文件 */
function endPdfWithApprovedStamp(doc, request, useFont, fontReady) {
  try {
    drawViewWatermark(doc, request, fontReady);
  } catch (e) {
    console.warn('[pdf] watermark error:', e.message);
  }
  try {
    if (request && request.status === 'approved') {
      const range = doc.bufferedPageRange();
      if (range.count > 0) {
        doc.switchToPage(range.start);
        drawApprovedStamp(doc, useFont);
      }
    }
  } catch (e) {
    console.warn('[pdf] approved stamp failed', e && e.message ? e.message : e);
  }
  doc.end();
}

module.exports = {
  drawApprovedStamp,
  drawViewWatermark,
  endPdfWithApprovedStamp,
};
