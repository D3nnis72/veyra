// Generates packages/desktop/assets/icon.png (1024×1024 macOS app icon) without
// external image libraries: a dark #131313 squircle with an indigo #3B4BD8 "V".
// Run: node scripts/generate-icon.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const SIZE = 1024;
const SAMPLES = 4; // 4×4 supersampling for crisp anti-aliased edges
// macOS Big Sur grid: 824px icon body centred on a 1024px canvas.
const BODY = 824;
const HALF = BODY / 2;
const SQUIRCLE_N = 5;

const BG_TOP = [0x1a, 0x1a, 0x1a];
const BG_BOTTOM = [0x13, 0x13, 0x13];
const V_TOP = [0x5b, 0x6b, 0xf2];
const V_BOTTOM = [0x3b, 0x4b, 0xd8];

function squircle(x, y) {
  // x, y in [-1, 1]; inside when |x|^n + |y|^n <= 1
  return Math.abs(x) ** SQUIRCLE_N + Math.abs(y) ** SQUIRCLE_N;
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// V emblem in body-normalised coordinates (y grows downward).
const V_LEFT = [-0.4, -0.36];
const V_TIP = [0, 0.4];
const V_RIGHT = [0.4, -0.36];
const V_HALF_WIDTH = 0.085;

function inV(x, y) {
  if (y < V_LEFT[1]) return false; // flat top caps
  const d = Math.min(
    distToSegment(x, y, V_LEFT[0], V_LEFT[1], V_TIP[0], V_TIP[1]),
    distToSegment(x, y, V_TIP[0], V_TIP[1], V_RIGHT[0], V_RIGHT[1]),
  );
  return d <= V_HALF_WIDTH;
}

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

const rgba = Buffer.alloc(SIZE * SIZE * 4);
for (let py = 0; py < SIZE; py++) {
  for (let px = 0; px < SIZE; px++) {
    let body = 0;
    let rim = 0;
    let vCover = 0;
    for (let sy = 0; sy < SAMPLES; sy++) {
      for (let sx = 0; sx < SAMPLES; sx++) {
        const x = (px + (sx + 0.5) / SAMPLES - SIZE / 2) / HALF;
        const y = (py + (sy + 0.5) / SAMPLES - SIZE / 2) / HALF;
        const s = squircle(x, y);
        if (s <= 1) {
          body++;
          if (s > 0.955) rim++; // hairline glass rim along the edge
          if (inV(x, y)) vCover++;
        }
      }
    }
    const n = SAMPLES * SAMPLES;
    const i = (py * SIZE + px) * 4;
    if (body === 0) continue;

    const ny = (py - (SIZE - BODY) / 2) / BODY;
    let color = mix(BG_TOP, BG_BOTTOM, Math.min(1, Math.max(0, ny)));
    if (rim > 0) color = mix(color, [255, 255, 255], 0.1 * (rim / body));
    if (vCover > 0) {
      const vColor = mix(V_TOP, V_BOTTOM, Math.min(1, Math.max(0, (ny - 0.32) / 0.38)));
      color = mix(color, vColor, vCover / body);
    }
    rgba[i] = Math.round(color[0]);
    rgba[i + 1] = Math.round(color[1]);
    rgba[i + 2] = Math.round(color[2]);
    rgba[i + 3] = Math.round((255 * body) / n);
  }
}

function crc32(buf) {
  let c;
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0; // filter: none
  rgba.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(__dirname, '../assets/icon.png');
fs.writeFileSync(out, png);
console.log(`Wrote ${out} (${png.length} bytes)`);
