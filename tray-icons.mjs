/**
 * tray-icons — generates the system tray status icons (green/yellow/red — FR-004) as raw PNG
 * bytes at runtime, so the daemon ships with zero binary icon assets and zero extra image
 * dependencies. A tiny hand-rolled encoder (uncompressed RGB scanlines through node:zlib's
 * deflate) is simple enough not to need a library — this is not a general-purpose PNG writer,
 * just "one flat-color square," which is all a status dot needs.
 *
 * Platform note: Windows systray requires ICO base64; macOS/Linux use PNG base64.
 */
import { deflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/** Build a solid `[r,g,b]` PNG of `size`x`size` pixels, returned as a base64 string. */
function solidColorPng(size, [r, g, b]) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 2;  // color type: RGB (no alpha)
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace

  const row = Buffer.alloc(1 + size * 3); // filter byte (0=none) + RGB per pixel
  for (let x = 0; x < size; x++) {
    row[1 + x * 3] = r;
    row[1 + x * 3 + 1] = g;
    row[1 + x * 3 + 2] = b;
  }
  const raw = Buffer.concat(Array(size).fill(row));
  const idatData = deflateSync(raw);

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdrData),
    chunk('IDAT', idatData),
    chunk('IEND', Buffer.alloc(0)),
  ]).toString('base64');
}

/**
 * Build a minimal ICO file containing one 32x32 24-bit solid-color image.
 * Windows systray requires ICO format — PNG base64 renders as a blank icon on win32.
 * ICO structure: 6-byte header + 16-byte directory entry + BITMAPINFOHEADER + XOR mask + AND mask.
 */
function solidColorIco(size, [r, g, b]) {
  const pixelDataSize = size * size * 3; // 24-bit RGB

  // ICO header (6 bytes)
  const icoHeader = Buffer.alloc(6);
  icoHeader.writeUInt16LE(0, 0);  // reserved
  icoHeader.writeUInt16LE(1, 2);  // type: 1 = ICO
  icoHeader.writeUInt16LE(1, 4);  // image count: 1

  // AND mask: 1 bit per pixel, rows padded to 4-byte boundary, all 0 = fully opaque
  const andMaskRowBytes = Math.ceil(size / 32) * 4;
  const andMask = Buffer.alloc(size * andMaskRowBytes, 0);

  // BITMAPINFOHEADER (40 bytes) — ICO height is doubled (XOR mask + AND mask stacked)
  const bmpHeader = Buffer.alloc(40);
  bmpHeader.writeUInt32LE(40, 0);               // header size
  bmpHeader.writeInt32LE(size, 4);              // width
  bmpHeader.writeInt32LE(size * 2, 8);          // height × 2
  bmpHeader.writeUInt16LE(1, 12);               // color planes
  bmpHeader.writeUInt16LE(24, 14);              // bits per pixel
  bmpHeader.writeUInt32LE(0, 16);               // compression: none
  bmpHeader.writeUInt32LE(pixelDataSize + andMask.length, 20); // image data size

  // ICO directory entry (16 bytes)
  const imageDataSize = 40 + pixelDataSize + andMask.length;
  const dirEntry = Buffer.alloc(16);
  dirEntry[0] = size;                           // width (0 = 256)
  dirEntry[1] = size;                           // height
  dirEntry[2] = 0;                              // color count (0 = true color)
  dirEntry[3] = 0;                              // reserved
  dirEntry.writeUInt16LE(1, 4);                 // color planes
  dirEntry.writeUInt16LE(24, 6);                // bits per pixel
  dirEntry.writeUInt32LE(imageDataSize, 8);     // size of image data
  dirEntry.writeUInt32LE(22, 12);               // offset to image data (6 header + 16 dir)

  // XOR mask: pixel rows bottom-to-top (BMP convention), BGR byte order
  const xorMask = Buffer.alloc(pixelDataSize);
  for (let row = size - 1; row >= 0; row--) {
    const base = (size - 1 - row) * size * 3;
    for (let col = 0; col < size; col++) {
      xorMask[base + col * 3]     = b; // BGR
      xorMask[base + col * 3 + 1] = g;
      xorMask[base + col * 3 + 2] = r;
    }
  }

  return Buffer.concat([icoHeader, dirEntry, bmpHeader, xorMask, andMask]).toString('base64');
}

const COLORS = {
  green: [0x2e, 0xa0, 0x4f],  // healthy
  yellow: [0xe6, 0xa8, 0x17], // degraded
  red: [0xd9, 0x3c, 0x3c],    // gateway down
};

const cache = new Map();

/**
 * Base64 icon for a tray status. `status` is one of 'green'|'yellow'|'red' (FR-004); unknown
 * values fall back to 'yellow'. On Windows returns ICO base64 (required by systray on win32);
 * on macOS/Linux returns PNG base64.
 */
export function getTrayIcon(status) {
  const color = COLORS[status] ?? COLORS.yellow;
  const cacheKey = `${process.platform}:${status}`;
  if (!cache.has(cacheKey)) {
    const icon = process.platform === 'win32'
      ? solidColorIco(32, color)
      : solidColorPng(32, color);
    cache.set(cacheKey, icon);
  }
  return cache.get(cacheKey);
}
