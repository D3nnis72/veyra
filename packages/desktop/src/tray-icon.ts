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

// Crisp 10x10 bitmap glyphs rendered at 2x (20x20 centered inside 36x36 @2x tray badge)
const ICON_GLYPHS: Record<string, string[]> = {
  Rocket: [
    '......####',
    '.....#####',
    '....####.#',
    '...#####..',
    '..#####...',
    '.####.....',
    '.###.#....',
    '#.##..#...',
    '##....#...',
    '#.........',
  ],
  Layers: [
    '....##....',
    '..######..',
    '##########',
    '..######..',
    '..........',
    '.##....##.',
    '..######..',
    '..........',
    '.##....##.',
    '..######..',
  ],
  Cpu: [
    '..#....#..',
    '.########.',
    '##......##',
    '.#..##..#.',
    '##.####.##',
    '##.####.##',
    '.#..##..#.',
    '##......##',
    '.########.',
    '..#....#..',
  ],
  Briefcase: [
    '...####...',
    '...#..#...',
    '.########.',
    '##########',
    '###.##.###',
    '##########',
    '##########',
    '##########',
    '##########',
    '.########.',
  ],
  Globe: [
    '..######..',
    '.##.##.##.',
    '##..##..##',
    '#...##...#',
    '##########',
    '##########',
    '#...##...#',
    '##..##..##',
    '.##.##.##.',
    '..######..',
  ],
  Shield: [
    '....##....',
    '.########.',
    '##########',
    '##......##',
    '##......##',
    '##......##',
    '.##....##.',
    '..##..##..',
    '...####...',
    '....##....',
  ],
  Code: [
    '..........',
    '..#....#..',
    '.##....##.',
    '##......##',
    '##......##',
    '##......##',
    '.##....##.',
    '..#....#..',
    '..........',
    '..........',
  ],
  Sparkles: [
    '....##....',
    '....##....',
    '...####...',
    '..######..',
    '##########',
    '##########',
    '..######..',
    '...####...',
    '....##....',
    '....##....',
  ],
};

// Minimal 5x7 uppercase letters for monogram fallback when a project has no icon
const LETTER_BITMAPS: Record<string, string[]> = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.####', '#....', '#....', '#..##', '#...#', '#...#', '.####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  J: ['..###', '...#.', '...#.', '...#.', '#..#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#...#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
};

const iconBufferCache = new Map<string, Buffer>();

/**
 * Generates a crisp 36×36 (@2x for 18×18 macOS menu bar) colored rounded-square PNG
 * representing the currently focused project (vector icon glyph or initial).
 */
export function renderProjectTrayIconPng(spec: ActiveProjectTraySpec): Buffer {
  const initial = (spec.name.trim().charAt(0) || 'V').toUpperCase();
  const iconKey = spec.icon && ICON_GLYPHS[spec.icon] ? spec.icon : null;
  const cacheKey = `${spec.color}:${iconKey ?? initial}`;
  const cached = iconBufferCache.get(cacheKey);
  if (cached) return cached;

  const size = 36;
  const pad = 3; // 30x30 rounded badge inside 36x36 @2x canvas (15pt icon in 18pt macOS slot)
  const radius = 8;
  const [r, g, b] = parseHexColor(spec.color);

  const raw = Buffer.alloc(size * (size * 4 + 1));

  const setPixel = (x: number, y: number, pr: number, pg: number, pb: number, pa: number) => {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const rowStart = y * (size * 4 + 1);
    const idx = rowStart + 1 + x * 4;
    raw[idx] = pr;
    raw[idx + 1] = pg;
    raw[idx + 2] = pb;
    raw[idx + 3] = pa;
  };

  // 1. Draw rounded square background in project's accent color with subtle top highlight
  const minC = pad;
  const maxC = size - pad - 1;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // PNG filter type 0
    for (let x = 0; x < size; x++) {
      if (x < minC || x > maxC || y < minC || y > maxC) continue;
      let dx = 0;
      let dy = 0;
      if (x < minC + radius) dx = minC + radius - x;
      else if (x > maxC - radius) dx = x - (maxC - radius);
      if (y < minC + radius) dy = minC + radius - y;
      else if (y > maxC - radius) dy = y - (maxC - radius);

      const dist = Math.hypot(dx, dy);
      if (dist > radius + 0.6) continue;
      const alpha = dist <= radius - 0.5 ? 255 : Math.round(Math.max(0, (radius + 0.6 - dist) / 1.1) * 255);
      const lift = y === minC ? 18 : 0;
      setPixel(x, y, Math.min(255, r + lift), Math.min(255, g + lift), Math.min(255, b + lift), alpha);
    }
  }

  // 2. Draw centered crisp white glyph (10x10 at 2x = 20x20, or 5x7 initial at 2x = 10x14)
  if (iconKey) {
    const glyph = ICON_GLYPHS[iconKey];
    const ox = 8;
    const oy = 8;
    for (let gy = 0; gy < glyph.length; gy++) {
      for (let gx = 0; gx < glyph[gy].length; gx++) {
        if (glyph[gy][gx] !== '#') continue;
        for (let sy = 0; sy < 2; sy++) {
          for (let sx = 0; sx < 2; sx++) {
            setPixel(ox + gx * 2 + sx, oy + gy * 2 + sy, 255, 255, 255, 245);
          }
        }
      }
    }
  } else {
    const glyph = LETTER_BITMAPS[initial] ?? LETTER_BITMAPS.V;
    const ox = 13;
    const oy = 11;
    for (let gy = 0; gy < glyph.length; gy++) {
      for (let gx = 0; gx < glyph[gy].length; gx++) {
        if (glyph[gy][gx] !== '#') continue;
        for (let sy = 0; sy < 2; sy++) {
          for (let sx = 0; sx < 2; sx++) {
            setPixel(ox + gx * 2 + sx, oy + gy * 2 + sy, 255, 255, 255, 248);
          }
        }
      }
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
