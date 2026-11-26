/**
 * Note tags: shared parsing and normalization for web, CLI, server and core.
 * Browser-safe (no Node imports), re-exported through `@veyra/core/types`.
 */

export const MAX_NOTE_TAGS = 10;
export const MAX_NOTE_TAG_LENGTH = 40;

/** A normalized tag: lowercase, starts with a letter, then letters, digits, `-`, `_`, `/`. */
export const NOTE_TAG_PATTERN = /^[a-z][a-z0-9_/-]*$/;

/**
 * `#tag` tokens in free text. The `#` must not follow a word character, `#`, `&` or `/`,
 * so URL fragments (`page#section`), HTML entities (`&#123;`), headings (`# Title`)
 * and issue numbers (`#123`) are not read as tags.
 */
const CONTENT_TAG_REGEX = /(^|[^\p{L}\p{N}_#&/])#([a-zA-Z][a-zA-Z0-9_/-]*)/gu;

export interface NoteTagCount {
  tag: string;
  count: number;
}

/**
 * Normalizes one tag: trims, lowercases, strips leading `#` and trailing `-`, `_`, `/`.
 * Returns `null` when the result is not a valid tag.
 */
export function normalizeNoteTag(raw: string): string | null {
  const value = raw
    .trim()
    .toLowerCase()
    .replace(/^#+/, '')
    .replace(/[-_/]+$/, '');
  if (value.length === 0 || value.length > MAX_NOTE_TAG_LENGTH) return null;
  return NOTE_TAG_PATTERN.test(value) ? value : null;
}

/** Normalizes, drops invalid entries, dedupes (first occurrence wins) and caps at {@link MAX_NOTE_TAGS}. */
export function normalizeNoteTags(raw: Iterable<string>): string[] {
  const seen = new Set<string>();
  for (const entry of raw) {
    const tag = normalizeNoteTag(entry);
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      if (seen.size >= MAX_NOTE_TAGS) break;
    }
  }
  return [...seen];
}

/** Extracts normalized `#tag` tokens from note content, in order of appearance. */
export function parseNoteTagsFromContent(content: string): string[] {
  const found: string[] = [];
  for (const match of content.matchAll(CONTENT_TAG_REGEX)) {
    found.push(match[2]);
  }
  return normalizeNoteTags(found);
}

/** Tags for a note: `#tags` from the content first, then explicit tags, normalized and capped. */
export function mergeNoteTags(content: string, explicit: Iterable<string> = []): string[] {
  return normalizeNoteTags([...parseNoteTagsFromContent(content), ...explicit]);
}

/**
 * The `#partial` being typed right before `caret`, for tag autocomplete.
 * Returns the start index of the `#` and the lowercase partial (may be empty), or `null`.
 */
export function findNoteTagQueryAtCaret(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = /(^|[^\p{L}\p{N}_#&/])#([a-zA-Z0-9_/-]*)$/u.exec(before);
  if (!match) return null;
  const query = match[2];
  return { start: before.length - query.length - 1, query: query.toLowerCase() };
}
