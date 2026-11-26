import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_NOTE_TAGS,
  ValidationError,
  type VeyraDb,
  addDailyNote,
  deleteDailyNote,
  findNoteTagQueryAtCaret,
  listDailyNotes,
  listNoteTags,
  mergeNoteTags,
  normalizeNoteTag,
  normalizeNoteTags,
  openVeyraDb,
  parseNoteTagsFromContent,
  updateDailyNote,
  updateSettings,
} from '../src/index.js';

describe('note tag parsing and normalization', () => {
  it('normalizes single tags: lowercase, leading #, trailing separators, invalid -> null', () => {
    expect(normalizeNoteTag('#Veyra')).toBe('veyra');
    expect(normalizeNoteTag('  ##ux/Focus-Mode_2 ')).toBe('ux/focus-mode_2');
    expect(normalizeNoteTag('veyra/')).toBe('veyra');
    expect(normalizeNoteTag('')).toBeNull();
    expect(normalizeNoteTag('#')).toBeNull();
    expect(normalizeNoteTag('123')).toBeNull();
    expect(normalizeNoteTag('has space')).toBeNull();
    expect(normalizeNoteTag('über')).toBeNull();
    expect(normalizeNoteTag('a'.repeat(41))).toBeNull();
  });

  it('dedupes and caps tag lists at MAX_NOTE_TAGS', () => {
    expect(normalizeNoteTags(['Veyra', '#veyra', 'ux', 'bad tag'])).toEqual(['veyra', 'ux']);
    const many = Array.from({ length: 15 }, (_, i) => `t${i}`);
    expect(normalizeNoteTags(many)).toHaveLength(MAX_NOTE_TAGS);
  });

  it('parses #tags from content but not URL fragments, entities, headings or issue numbers', () => {
    expect(parseNoteTagsFromContent('#veyra drag handle feels sticky')).toEqual(['veyra']);
    expect(parseNoteTagsFromContent('Idea (#UX), also #veyra/focus. And #veyra again')).toEqual([
      'ux',
      'veyra/focus',
      'veyra',
    ]);
    expect(
      parseNoteTagsFromContent('see https://x.dev/page#section &#123; # Heading PR #123 ##double'),
    ).toEqual([]);
  });

  it('merges content tags first, then explicit tags', () => {
    expect(mergeNoteTags('#a text #b', ['c', '#A'])).toEqual(['a', 'b', 'c']);
  });

  it('finds the #partial being typed at the caret for autocomplete', () => {
    expect(findNoteTagQueryAtCaret('note #Vey', 9)).toEqual({ start: 5, query: 'vey' });
    expect(findNoteTagQueryAtCaret('#', 1)).toEqual({ start: 0, query: '' });
    expect(findNoteTagQueryAtCaret('note #veyra done', 16)).toBeNull();
    expect(findNoteTagQueryAtCaret('page#sec', 8)).toBeNull();
  });
});

describe('tagged notes service', () => {
  let veyraDb: VeyraDb;

  beforeEach(() => {
    veyraDb = openVeyraDb(':memory:');
    updateSettings(veyraDb, { timezone: 'Europe/Berlin' });
  });

  afterEach(() => {
    veyraDb.close();
  });

  it('stores content #tags plus explicit tags on create and keeps the content unchanged', () => {
    const note = addDailyNote(
      veyraDb,
      { content: '#Veyra drag handle feels sticky', date: '2026-11-23', tags: ['ux', '#veyra'] },
      '2026-11-23T10:00:00.000Z',
    );
    expect(note.content).toBe('#Veyra drag handle feels sticky');
    expect(note.tags).toEqual(['veyra', 'ux']);
    expect(listDailyNotes(veyraDb, { date: '2026-11-23' })[0].tags).toEqual(['veyra', 'ux']);
  });

  it('rejects explicit tags that cannot be normalized', () => {
    expect(() =>
      addDailyNote(veyraDb, { content: 'x', tags: ['not a tag'] }, '2026-11-23T10:00:00.000Z'),
    ).toThrow(ValidationError);
  });

  it('re-derives tags on update: content tags follow the content, explicit tags stay unless replaced', () => {
    const note = addDailyNote(
      veyraDb,
      { content: '#veyra sticky handle', date: '2026-11-23', tags: ['ux'] },
      '2026-11-23T10:00:00.000Z',
    );

    const edited = updateDailyNote(veyraDb, note.id, { content: 'sticky handle #focus' });
    expect(edited.content).toBe('sticky handle #focus');
    expect(edited.tags).toEqual(['focus', 'ux']);

    const retagged = updateDailyNote(veyraDb, note.id, { tags: ['bug'] });
    expect(retagged.tags).toEqual(['focus', 'bug']);

    const unchanged = updateDailyNote(veyraDb, note.id, { isOps: true });
    expect(unchanged.tags).toEqual(['focus', 'bug']);
    expect(listDailyNotes(veyraDb, { tag: 'bug' }).map((n) => n.id)).toEqual([note.id]);
  });

  it('lists notes by tag across all dates and counts tags on active notes', () => {
    const a = addDailyNote(veyraDb, { content: '#veyra a', date: '2026-10-01' });
    const b = addDailyNote(veyraDb, { content: 'b #veyra #ux', date: '2026-11-23' });
    addDailyNote(veyraDb, { content: 'c #ux', date: '2026-11-24' });
    addDailyNote(veyraDb, { content: 'plain', date: '2026-11-24' });
    const gone = addDailyNote(veyraDb, { content: '#veyra deleted', date: '2026-11-24' });
    deleteDailyNote(veyraDb, gone.id);

    expect(listDailyNotes(veyraDb, { tag: '#Veyra' }).map((n) => n.id)).toEqual([a.id, b.id]);
    expect(listDailyNotes(veyraDb, { tag: 'veyra', date: '2026-11-23' }).map((n) => n.id)).toEqual(
      [b.id],
    );
    expect(listDailyNotes(veyraDb, { tag: 'veyr' })).toEqual([]);
    expect(() => listDailyNotes(veyraDb, { tag: 'bad tag' })).toThrow(ValidationError);
    expect(listDailyNotes(veyraDb, { weekStartDate: '2026-11-23' })).toHaveLength(3);

    expect(listNoteTags(veyraDb)).toEqual([
      { tag: 'ux', count: 2 },
      { tag: 'veyra', count: 2 },
    ]);
  });

  it('adds the tags column to a legacy daily_notes table, backfilling #tags from content', async () => {
    const { default: Database } = await import('better-sqlite3');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veyra-core-legacy-notes-'));
    const dbPath = path.join(tmpDir, 'legacy-notes.db');
    const legacyNoteId = '44444444-4444-4444-8444-444444444444';
    try {
      const legacy = new Database(dbPath);
      legacy.exec(`
        CREATE TABLE daily_notes (
          id TEXT PRIMARY KEY,
          date TEXT NOT NULL,
          content TEXT NOT NULL,
          project_id TEXT,
          goal_id TEXT,
          is_ops INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT
        );
        INSERT INTO daily_notes (id, date, content, created_at, updated_at)
        VALUES ('${legacyNoteId}', '2026-11-20', 'Old #note', '2026-11-20T00:00:00.000Z', '2026-11-20T00:00:00.000Z');
      `);
      legacy.close();

      const upgraded = openVeyraDb(dbPath);
      try {
        const cols = upgraded.sqlite.prepare('PRAGMA table_info(daily_notes)').all() as Array<{
          name: string;
        }>;
        expect(cols.some((c) => c.name === 'tags')).toBe(true);
        const [row] = listDailyNotes(upgraded, { date: '2026-11-20' });
        expect(row).toMatchObject({ id: legacyNoteId, content: 'Old #note', tags: ['note'] });
        expect(listNoteTags(upgraded)).toEqual([{ tag: 'note', count: 1 }]);

        const edited = updateDailyNote(upgraded, legacyNoteId, { content: 'Old #note edited' });
        expect(edited.tags).toEqual(['note']);
      } finally {
        upgraded.close();
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
