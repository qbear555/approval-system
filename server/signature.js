const MAX_LEN = 900000; // ~650KB data URL

function normalizeSignatureImage(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (!/^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(s)) {
    return null;
  }
  if (s.length > MAX_LEN) return null;
  return s.replace(/\s+/g, '');
}

function bufferFromDataUrl(dataUrl) {
  const s = String(dataUrl || '');
  const m = s.match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/i);
  if (!m) return null;
  try {
    const buf = Buffer.from(m[2], 'base64');
    return buf.length ? buf : null;
  } catch {
    return null;
  }
}

module.exports = {
  normalizeSignatureImage,
  bufferFromDataUrl,
};
