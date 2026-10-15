/**
 * Generate PWA Icons (SVG and crisp PNGs for 192x192, 512x512, apple-touch-icon 180x180)
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const IMG_DIR = path.join(__dirname, '../public/img');
if (!fs.existsSync(IMG_DIR)) fs.mkdirSync(IMG_DIR, { recursive: true });

// 1. Vector SVG Icon
const svgIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1e3a8a"/>
      <stop offset="100%" stop-color="#2563eb"/>
    </linearGradient>
    <linearGradient id="stampGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#10b981"/>
      <stop offset="100%" stop-color="#059669"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="12" stdDeviation="16" flood-color="#0f172a" flood-opacity="0.25"/>
    </filter>
  </defs>

  <!-- Background rounded square -->
  <rect width="512" height="512" rx="112" fill="url(#bgGrad)"/>

  <!-- Document Sheet -->
  <g filter="url(#shadow)">
    <rect x="116" y="96" width="280" height="320" rx="20" fill="#ffffff"/>
    <path d="M 336 96 L 396 156 L 336 156 Z" fill="#cbd5e1"/>
    
    <!-- Document Lines -->
    <rect x="156" y="156" width="150" height="18" rx="9" fill="#93c5fd"/>
    <rect x="156" y="196" width="200" height="12" rx="6" fill="#e2e8f0"/>
    <rect x="156" y="224" width="170" height="12" rx="6" fill="#e2e8f0"/>
    <rect x="156" y="252" width="190" height="12" rx="6" fill="#e2e8f0"/>
    
    <!-- Approval Seal Badge -->
    <circle cx="316" cy="326" r="62" fill="url(#stampGrad)"/>
    <circle cx="316" cy="326" r="54" fill="none" stroke="#ffffff" stroke-width="3" stroke-dasharray="6,4"/>
    
    <!-- White Checkmark -->
    <path d="M 292 326 L 308 342 L 344 306" fill="none" stroke="#ffffff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>`;

fs.writeFileSync(path.join(IMG_DIR, 'icon.svg'), svgIcon);

// 2. Pure JS PNG generator
function createPng(width, height, drawPixel) {
  const bytesPerPixel = 4;
  const rowSize = width * bytesPerPixel + 1;
  const rawData = Buffer.alloc(rowSize * height);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    rawData[rowOffset] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = drawPixel(x, y, width, height);
      const pxOffset = rowOffset + 1 + x * bytesPerPixel;
      rawData[pxOffset] = r;
      rawData[pxOffset + 1] = g;
      rawData[pxOffset + 2] = b;
      rawData[pxOffset + 3] = a;
    }
  }

  const compressed = zlib.deflateSync(rawData);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  function makeChunk(type, data) {
    const len = data.length;
    const buf = Buffer.alloc(12 + len);
    buf.writeUInt32BE(len, 0);
    buf.write(type, 4);
    data.copy(buf, 8);
    const crc = crc32(buf.subarray(4, 8 + len));
    buf.writeUInt32BE(crc, 8 + len);
    return buf;
  }

  function crc32(buf) {
    let crc = 0 ^ (-1);
    for (let i = 0; i < buf.length; i++) {
      crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
    }
    return (crc ^ (-1)) >>> 0;
  }

  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = ((c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1));
    }
    table[i] = c;
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0))
  ]);
}

// Icon Pixel Renderer (Gradient background + rounded corners + document badge + checkmark)
function renderAppIcon(x, y, w, h) {
  const nx = x / w;
  const ny = y / h;

  // Corner radius (0.22 of size)
  const r = 0.22;
  const dx = Math.max(0, Math.max(r - nx, nx - (1 - r)));
  const dy = Math.max(0, Math.max(r - ny, ny - (1 - r)));
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist > r) {
    return [0, 0, 0, 0]; // Transparent outside rounded rect
  }

  // Base background gradient: #1e3a8a (30, 58, 138) to #2563eb (37, 99, 235)
  const t = (nx + ny) / 2;
  let bgR = Math.round(30 + t * 7);
  let bgG = Math.round(58 + t * 41);
  let bgB = Math.round(138 + t * 97);

  // Document sheet: x in [0.22, 0.78], y in [0.18, 0.82]
  if (nx >= 0.24 && nx <= 0.76 && ny >= 0.20 && ny <= 0.80) {
    // White sheet
    let sheetR = 255;
    let sheetG = 255;
    let sheetB = 255;

    // Header bar on sheet
    if (ny >= 0.28 && ny <= 0.34 && nx >= 0.30 && nx <= 0.60) {
      sheetR = 147; sheetG = 197; sheetB = 253; // Blue header bar
    } else if (ny >= 0.38 && ny <= 0.41 && nx >= 0.30 && nx <= 0.70) {
      sheetR = 226; sheetG = 232; sheetB = 240; // line 1
    } else if (ny >= 0.44 && ny <= 0.47 && nx >= 0.30 && nx <= 0.65) {
      sheetR = 226; sheetG = 232; sheetB = 240; // line 2
    } else if (ny >= 0.50 && ny <= 0.53 && nx >= 0.30 && nx <= 0.68) {
      sheetR = 226; sheetG = 232; sheetB = 240; // line 3
    }

    // Green circular seal at bottom right of document: center (0.64, 0.66), radius 0.14
    const sdcX = nx - 0.62;
    const sdcY = ny - 0.64;
    const sealDist = Math.sqrt(sdcX * sdcX + sdcY * sdcY);
    if (sealDist <= 0.14) {
      // Seal gradient #10b981 to #059669
      sheetR = 16; sheetG = 185; sheetB = 129;

      // Checkmark: line 1 from (0.57, 0.64) to (0.61, 0.68), line 2 to (0.68, 0.59)
      const isCheck1 = Math.abs((ny - 0.64) - (nx - 0.57)) < 0.025 && nx >= 0.56 && nx <= 0.61;
      const isCheck2 = Math.abs((ny - 0.68) + 1.28 * (nx - 0.61)) < 0.025 && nx >= 0.61 && nx <= 0.68;
      if (isCheck1 || isCheck2) {
        sheetR = 255; sheetG = 255; sheetB = 255;
      }
    }

    return [sheetR, sheetG, sheetB, 255];
  }

  return [bgR, bgG, bgB, 255];
}

console.log('Generating PWA icons...');
const icon192 = createPng(192, 192, renderAppIcon);
fs.writeFileSync(path.join(IMG_DIR, 'icon-192.png'), icon192);

const icon512 = createPng(512, 512, renderAppIcon);
fs.writeFileSync(path.join(IMG_DIR, 'icon-512.png'), icon512);

const iconApple = createPng(180, 180, renderAppIcon);
fs.writeFileSync(path.join(IMG_DIR, 'apple-touch-icon.png'), iconApple);

console.log('Done! Created: icon.svg, icon-192.png, icon-512.png, apple-touch-icon.png');
