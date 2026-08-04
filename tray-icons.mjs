/**
 * tray-icons — generates the system tray status icons (green/yellow/red — FR-004) as raw PNG
 * bytes at runtime, so the daemon ships with zero binary icon assets and zero extra image
 * dependencies. A tiny hand-rolled encoder (uncompressed RGB scanlines through node:zlib's
 * deflate) is simple enough not to need a library — this is not a general-purpose PNG writer,
 * just "one flat-color square," which is all a status dot needs.
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

const COLORS = {
  green: [0x2e, 0xa0, 0x4f],  // healthy
  yellow: [0xe6, 0xa8, 0x17], // degraded
  red: [0xd9, 0x3c, 0x3c],    // gateway down
};

const cache = new Map();

/**
 * Base64 PNG for a tray status. `status` is one of 'green'|'yellow'|'red' (FR-004); unknown
 * values fall back to 'yellow' rather than throwing, since a bad status string should degrade
 * gracefully, not crash the daemon's tray loop.
 */
export function getTrayIcon(status) {
  const color = COLORS[status] ?? COLORS.yellow;
  if (!cache.has(status)) cache.set(status, solidColorPng(32, color));
  return cache.get(status);
}
