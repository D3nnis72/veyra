const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = DIGITS.length; // 62

const DIGIT_INDEX = new Map<string, number>();
for (let i = 0; i < DIGITS.length; i++) {
  DIGIT_INDEX.set(DIGITS[i], i);
}

function assertValidKey(key: string, label: string): void {
  if (key.length === 0) {
    throw new Error(`generateOrderKey: ${label} must not be empty`);
  }
  if (key[key.length - 1] === '0') {
    throw new Error(`generateOrderKey: ${label} must not end with '0'`);
  }
  for (let i = 0; i < key.length; i++) {
    if (!DIGIT_INDEX.has(key[i])) {
      throw new Error(`generateOrderKey: invalid character '${key[i]}' in ${label}`);
    }
  }
}

function digitAt(str: string, index: number): number {
  if (index >= str.length) {
    return 0;
  }
  return DIGIT_INDEX.get(str[index]) ?? 0;
}

/**
 * Generates a lexicographically ordered base-62 fractional key strictly between
 * `before` and `after`. Works for initial creation, append, prepend, and
 * arbitrarily deep midpoint splits using standard ASCII / SQLite TEXT ordering.
 */
export function generateOrderKey(before?: string | null, after?: string | null): string {
  const loStr = before ?? '';
  const hiStr = after ?? null;

  if (loStr.length > 0) {
    assertValidKey(loStr, 'before');
  }
  if (hiStr !== null) {
    assertValidKey(hiStr, 'after');
  }
  if (loStr.length > 0 && hiStr !== null && loStr >= hiStr) {
    throw new Error(
      `generateOrderKey: before ('${loStr}') must be lexicographically less than after ('${hiStr}')`,
    );
  }

  let prefix = '';
  let i = 0;

  while (true) {
    const lo = digitAt(loStr, i);
    const hi = hiStr !== null ? digitAt(hiStr, i) : BASE;

    if (lo === hi) {
      prefix += DIGITS[lo];
      i++;
      continue;
    }

    if (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      return prefix + DIGITS[mid];
    }

    // hi - lo === 1: emit `lo` and find the first digit strictly greater than `loStr`
    prefix += DIGITS[lo];
    let j = i + 1;
    while (true) {
      const loJ = digitAt(loStr, j);
      if (loJ < BASE - 1) {
        const midJ = Math.floor((loJ + BASE) / 2);
        return prefix + DIGITS[midJ];
      }
      prefix += DIGITS[BASE - 1];
      j++;
    }
  }
}
