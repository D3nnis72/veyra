import zlib from 'node:zlib';

export interface ActiveProjectTraySpec {
  name: string;
  color: string;
  icon?: string | null;
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// Precompute CRC32 table for valid PNG chunks
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function parseHexColor(hex: string): [number, number, number] {
  const clean = hex.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{6}$/.test(clean)) {
    return [
      Number.parseInt(clean.slice(0, 2), 16),
      Number.parseInt(clean.slice(2, 4), 16),
      Number.parseInt(clean.slice(4, 6), 16),
    ];
  }
  return [59, 75, 216]; // Veyra Indigo fallback
}

/**
 * Gently lifts dark accent colors so the active menu bar mark stays crisp and
 * legible on dark macOS menu bars while remaining clearly distinct on light ones.
 */
function liftForMenuBar([r, g, b]: [number, number, number]): [number, number, number] {
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (luminance < 115) {
    const t = Math.min(0.35, (115 - luminance) / 180);
    return [
      Math.round(r + (255 - r) * t),
      Math.round(g + (255 - g) * t),
      Math.round(b + (255 - b) * t),
    ];
  }
  return [r, g, b];
}

function distToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Geometric Veyra "V" matching icon.png proportions (flat top caps, rounded tip)
const V_TOP_Y = -0.54;
const V_BOT_Y = 0.56;
const V_SPAN_X = 0.58;
const V_HALF_WIDTH = 0.145;

function inVeyraMark(x: number, y: number): boolean {
  if (y < V_TOP_Y) return false;
  const d = Math.min(
    distToSegment(x, y, -V_SPAN_X, V_TOP_Y, 0, V_BOT_Y),
    distToSegment(x, y, 0, V_BOT_Y, V_SPAN_X, V_TOP_Y),
  );
  return d <= V_HALF_WIDTH;
}

const iconBufferCache = new Map<string, Buffer>();

/**
 * Generates a 4×4 supersampled 36×36 (@2x for 18×18pt macOS menu bar) PNG:
 * the geometric Veyra "V" tinted in the active project's color paired with a
 * crisp live indicator dot at the bottom-right.
 */
export function renderProjectTrayIconPng(spec: ActiveProjectTraySpec): Buffer {
  const rgb = parseHexColor(spec.color);
  const cacheKey = `${rgb[0]},${rgb[1]},${rgb[2]}`;
  const cached = iconBufferCache.get(cacheKey);
  if (cached) return cached;

  const size = 36;
  const samples = 4;
  const totalSamples = samples * samples;
  const half = size / 2;

  const [lr, lg, lb] = liftForMenuBar(rgb);
  const topR = Math.min(255, lr + 24);
  const topG = Math.min(255, lg + 24);
  const topB = Math.min(255, lb + 24);
  const dotR = Math.min(255, lr + 42);
  const dotG = Math.min(255, lg + 42);
  const dotB = Math.min(255, lb + 42);

  const raw = Buffer.alloc(size * (size * 4 + 1));

  for (let py = 0; py < size; py++) {
    const rowStart = py * (size * 4 + 1);
    raw[rowStart] = 0; // PNG filter type 0
    const ny = py / size;
    const vr = topR + (lr - topR) * ny;
    const vg = topG + (lg - topG) * ny;
    const vb = topB + (lb - topB) * ny;

    for (let px = 0; px < size; px++) {
      let vHits = 0;
      let dotHits = 0;

      for (let sy = 0; sy < samples; sy++) {
        const y = (py + (sy + 0.5) / samples - half) / half;
        for (let sx = 0; sx < samples; sx++) {
          const x = (px + (sx + 0.5) / samples - half) / half;
          if (inVeyraMark(x + 0.08, y + 0.02)) {
            vHits++;
          }
          if (Math.hypot(x - 0.56, y - 0.52) <= 0.17) {
            dotHits++;
          }
        }
      }

      const hits = Math.min(totalSamples, vHits + dotHits);
      if (hits === 0) continue;

      const dotWeight = dotHits / Math.max(1, vHits + dotHits);
      const idx = rowStart + 1 + px * 4;
      raw[idx] = Math.round(vr + (dotR - vr) * dotWeight);
      raw[idx + 1] = Math.round(vg + (dotG - vg) * dotWeight);
      raw[idx + 2] = Math.round(vb + (dotB - vb) * dotWeight);
      raw[idx + 3] = Math.round((hits / totalSamples) * 255);
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const compressed = zlib.deflateSync(raw);
  const png = Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);

  iconBufferCache.set(cacheKey, png);
  return png;
}
