/**
 * Derives a dark, translucent-looking chip palette from a goal (or any accent) hex color.
 * Background is the accent mixed ~20% onto the app surface, the border is the accent at ~38%
 * alpha, and the text is a bright, legible tint of the accent.
 */
export interface GoalTint {
  bg: string;
  border: string;
  borderHover: string;
  text: string;
  dot: string;
}

const SURFACE = { r: 0x1c, g: 0x1c, b: 0x1c };

/** Hand-tuned text colors for Veyra's 12 curated Figma presets + 8 legacy project accents. */
const KNOWN_TEXT: Record<string, string> = {
  // 12 Curated Figma ColorPicker presets
  '#5e6ad2': '#AEB8FF', // Indigo
  '#4da3ff': '#8FC7FF', // Sky
  '#22d3ee': '#7EE8FA', // Cyan
  '#14b8a6': '#6BE5D8', // Teal
  '#34d399': '#7EE8BE', // Mint
  '#84cc16': '#BCE876', // Lime
  '#f59e0b': '#FBD07A', // Amber
  '#f97316': '#FCA872', // Orange
  '#fb7185': '#FDA4B2', // Coral
  '#f43f5e': '#FF9EB0', // Rose
  '#ec4899': '#F9A0CB', // Pink
  '#9d7ff7': '#C9B6FF', // Violet
  // Legacy 8 accent colors
  '#3b4bd8': '#AEB8FF', // Legacy Indigo
  '#2e9e6f': '#7BE0B0', // Legacy Emerald
  '#d9772b': '#F5B27A', // Legacy Amber
  '#c94a6a': '#FF9EB5', // Legacy Rose
  '#2a8fbd': '#7ED3F5', // Legacy Cyan
  '#8b5cf6': '#C9B6FF', // Legacy Violet
  '#c49b2a': '#F0D27A', // Legacy Gold
  '#6e7280': '#C4C7D0', // Legacy Slate
};

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const raw = hex.trim().replace(/^#/, '');
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw.slice(0, 6);
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
}

function toHex({ r, g, b }: { r: number; g: number; b: number }): string {
  const h = (n: number) =>
    Math.round(Math.min(255, Math.max(0, n)))
      .toString(16)
      .padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}

function mix(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
  amountOfA: number,
) {
  return {
    r: a.r * amountOfA + b.r * (1 - amountOfA),
    g: a.g * amountOfA + b.g * (1 - amountOfA),
    b: a.b * amountOfA + b.b * (1 - amountOfA),
  };
}

function alphaHex(alpha: number): string {
  return Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();
}

const FALLBACK = '#4DA3FF';

export function goalTint(color: string | null | undefined): GoalTint {
  const rgb = parseHex(color ?? '') ?? parseHex(FALLBACK)!;
  const base = toHex(rgb);
  const known = KNOWN_TEXT[base.toLowerCase()];
  const text = known ?? toHex(mix(rgb, { r: 255, g: 255, b: 255 }, 0.5));
  return {
    bg: toHex(mix(rgb, SURFACE, 0.2)),
    border: `${base}${alphaHex(0.38)}`,
    borderHover: `${base}${alphaHex(0.65)}`,
    text,
    dot: base,
  };
}

/** Inline style for a goal-tinted chip/button (background, border and text). */
export function goalChipStyle(color: string | null | undefined): {
  backgroundColor: string;
  borderColor: string;
  color: string;
} {
  const t = goalTint(color);
  return { backgroundColor: t.bg, borderColor: t.border, color: t.text };
}

/**
 * Subtle project-colored tint for active / selected block and meeting cards
 * (~12% project hue mixed into #1C1C1C surface, ~48% project hue border).
 */
export function activeCardStyle(color: string | null | undefined): {
  backgroundColor: string;
  borderColor: string;
} {
  const rgb = parseHex(color ?? '') ?? parseHex('#3B4BD8')!;
  const base = toHex(rgb);
  return {
    backgroundColor: toHex(mix(rgb, SURFACE, 0.13)),
    borderColor: `${base}${alphaHex(0.48)}`,
  };
}
