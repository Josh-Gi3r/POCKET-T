// Dependency-free placeholder PWA icon generator.
// Draws a dark tile with a green ">_" prompt glyph, emits 192/512/maskable
// PNGs into public/icons/. Real branding art can replace these later.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(OUT, { recursive: true });

const BG = [0x0b, 0x0f, 0x14];
const FG = [0x3f, 0xe0, 0x8f];

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

// px(size, x, y) -> whether this pixel belongs to the glyph. We draw a
// chevron ">" and an underscore "_" scaled to the icon size.
function isGlyph(size, x, y) {
  const s = size;
  const t = s * 0.055; // stroke half-thickness
  // chevron ">": two diagonal strokes meeting at right-center.
  const cx = s * 0.32;
  const apexX = s * 0.5;
  const midY = s * 0.42;
  const span = s * 0.16;
  // top diagonal: from (cx, midY-span) to (apexX, midY)
  const onLine = (x1, y1, x2, y2) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    const tt = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len2));
    const px = x1 + tt * dx;
    const py = y1 + tt * dy;
    return Math.hypot(x - px, y - py) <= t;
  };
  if (onLine(cx, midY - span, apexX, midY)) return true;
  if (onLine(apexX, midY, cx, midY + span)) return true;
  // underscore "_": horizontal bar bottom-right.
  if (x > s * 0.55 && x < s * 0.78 && y > s * 0.6 && y < s * 0.6 + t * 1.6) return true;
  return false;
}

function makePng(size, maskable) {
  // For maskable, keep glyph within the safe zone (already central); add a
  // full-bleed background so the platform can crop to any shape.
  const raw = Buffer.alloc(size * (size * 3 + 1));
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const g = isGlyph(size, x, y);
      const c = g ? FG : BG;
      raw[p++] = c[0];
      raw[p++] = c[1];
      raw[p++] = c[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

writeFileSync(join(OUT, 'icon-192.png'), makePng(192, false));
writeFileSync(join(OUT, 'icon-512.png'), makePng(512, false));
writeFileSync(join(OUT, 'icon-maskable-512.png'), makePng(512, true));
console.log('icons written to', OUT);
