import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GLOBAL_CAPTURE_SHORTCUT,
  DEFAULT_SETTINGS_ID,
  SYSTEM_OTHER_PROJECT_ID,
  dateOnlySchema,
  formatLocalDate,
  generateOrderKey,
  getWeekRange,
  openVeyraDb,
  recurrenceRuleSchema,
  resolveRevisitDate,
} from '../src/index.js';
import { projects, settings } from '../src/schema.js';

describe('@veyra/core database bootstrap, order-key, time, and contracts', () => {
  it('creates all 9 tables on openVeyraDb(":memory:") with foreign keys enabled', () => {
    const veyraDb = openVeyraDb(':memory:');
    try {
      const rows = veyraDb.sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .all() as Array<{ name: string }>;

      const tableNames = rows.map((r) => r.name);
      expect(tableNames).toEqual([
        'activity_log',
        'blocks',
        'calendar_events',
        'daily_notes',
        'focus_sessions',
        'goals',
        'projects',
        'settings',
        'weekly_reviews',
      ]);

      const fkPragma = veyraDb.sqlite.pragma('foreign_keys', { simple: true });
      expect(fkPragma).toBe(1);
    } finally {
      veyraDb.close();
    }
  });

  it('seeds system Other project and singleton settings idempotently across repeated opens', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veyra-core-db-'));
    const dbPath = path.join(tmpDir, 'veyra.db');

    try {
      const first = openVeyraDb(dbPath);
      const journalMode = first.sqlite.pragma('journal_mode', { simple: true });
      expect(String(journalMode).toLowerCase()).toBe('wal');
      first.close();

      const second = openVeyraDb(dbPath);
      try {
        const allProjects = second.db.select().from(projects).all();
        expect(allProjects).toHaveLength(1);
        expect(allProjects[0]).toMatchObject({
          id: SYSTEM_OTHER_PROJECT_ID,
          name: 'Other',
          isSystem: true,
          status: 'active',
        });

        const allSettings = second.db.select().from(settings).all();
        expect(allSettings).toHaveLength(1);
        expect(allSettings[0]).toMatchObject({
          id: DEFAULT_SETTINGS_ID,
          theme: 'dark',
          calendarSyncIntervalMin: 15,
          skipDeclinedAndAllDay: true,
          runInMenuBar: true,
          globalCaptureShortcut: DEFAULT_GLOBAL_CAPTURE_SHORTCUT,
          onboardingCompleted: false,
        });
        expect(() =>
          new Intl.DateTimeFormat('en-US', { timeZone: allSettings[0].timezone }),
        ).not.toThrow();
      } finally {
        second.close();
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('generates lexicographically ordered fractional keys for append, prepend, and 20 midpoint splits', () => {
    const initial = generateOrderKey();
    const appended1 = generateOrderKey(initial, null);
    const appended2 = generateOrderKey(appended1, null);
    expect(initial < appended1).toBe(true);
    expect(appended1 < appended2).toBe(true);

    let head = initial;
    for (let i = 0; i < 10; i++) {
      const prepended = generateOrderKey(null, head);
      expect(prepended < head).toBe(true);
      head = prepended;
    }

    let left = initial;
    const right = appended1;
    for (let i = 0; i < 20; i++) {
      const mid = generateOrderKey(left, right);
      expect(left < mid).toBe(true);
      expect(mid < right).toBe(true);
      left = mid;
    }
  });

  it('formats local dates across midnight boundaries for Europe/Berlin vs UTC', () => {
    const instant = '2026-11-23T23:30:00.000Z';
    expect(formatLocalDate(instant, 'Europe/Berlin')).toBe('2026-11-24');
    expect(formatLocalDate(instant, 'UTC')).toBe('2026-11-23');
  });

  it('computes ISO week ranges, revisit horizons, and validates recurrenceRule and date-only contracts', () => {
    expect(getWeekRange('2026-11-25')).toEqual({
      weekStartDate: '2026-11-23',
      weekEndDate: '2026-11-29',
    });
    expect(getWeekRange('2026-11-29')).toEqual({
      weekStartDate: '2026-11-23',
      weekEndDate: '2026-11-29',
    });

    expect(resolveRevisitDate('next-week', '2026-11-23')).toBe('2026-11-30');
    expect(resolveRevisitDate('2w', '2026-11-23')).toBe('2026-12-07');
    expect(resolveRevisitDate('next-month', '2026-11-23')).toBe('2026-12-23');
    expect(resolveRevisitDate('next-quarter', '2026-11-23')).toBe('2027-02-21');
    expect(resolveRevisitDate('2027-01-15', '2026-11-23')).toBe('2027-01-15');

    expect(recurrenceRuleSchema.safeParse('weekdays').success).toBe(true);
    expect(recurrenceRuleSchema.safeParse('weekly').success).toBe(true);
    expect(recurrenceRuleSchema.safeParse('days:[mon,wed,fri]').success).toBe(true);
    expect(recurrenceRuleSchema.safeParse('days:[mon,funday]').success).toBe(false);
    expect(recurrenceRuleSchema.safeParse('daily').success).toBe(false);

    expect(dateOnlySchema.safeParse('2026-11-24').success).toBe(true);
    expect(dateOnlySchema.safeParse('2026-11-24T10:30:00Z').success).toBe(false);
    expect(dateOnlySchema.safeParse('2026-02-30').success).toBe(false);
  });

  it('keeps @veyra/core/types browser-safe with zero native or Node built-in imports', () => {
    const typesSource = fs.readFileSync(
      path.resolve(import.meta.dirname, '../src/types.ts'),
      'utf8',
    );
    expect(typesSource).not.toMatch(/better-sqlite3/);
    expect(typesSource).not.toMatch(/drizzle-orm/);
    expect(typesSource).not.toMatch(/from\s+['"]node:/);
  });

  it('adds settings.notion_token cleanly to legacy databases via additive migration', async () => {
    const { default: Database } = await import('better-sqlite3');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veyra-core-legacy-'));
    const dbPath = path.join(tmpDir, 'legacy.db');
    try {
      const legacy = new Database(dbPath);
      legacy.exec(`
        CREATE TABLE settings (
          id TEXT PRIMARY KEY,
          theme TEXT NOT NULL DEFAULT 'dark',
          timezone TEXT NOT NULL,
          onboarding_completed INTEGER NOT NULL DEFAULT 0,
          server_url TEXT,
          calendar_sync_mode TEXT NOT NULL DEFAULT 'manual',
          outlook_cli_command TEXT,
          ics_feed_url TEXT,
          calendar_sync_interval_min INTEGER NOT NULL DEFAULT 15,
          skip_declined_and_all_day INTEGER NOT NULL DEFAULT 1,
          last_calendar_sync_at TEXT,
          webhook_url TEXT,
          webhook_events TEXT NOT NULL DEFAULT '[]',
          global_capture_shortcut TEXT NOT NULL DEFAULT 'CommandOrControl+Shift+P',
          run_in_menu_bar INTEGER NOT NULL DEFAULT 1,
          updated_at TEXT NOT NULL
        );
        INSERT INTO settings (id, theme, timezone, onboarding_completed, calendar_sync_mode, calendar_sync_interval_min, skip_declined_and_all_day, webhook_events, global_capture_shortcut, run_in_menu_bar, updated_at)
        VALUES ('default', 'dark', 'UTC', 1, 'manual', 15, 1, '[]', 'CommandOrControl+Shift+P', 1, '2026-11-23T00:00:00.000Z');
      `);
      legacy.close();

      const upgraded = openVeyraDb(dbPath);
      try {
        const cols = upgraded.sqlite
          .prepare('PRAGMA table_info(settings)')
          .all() as Array<{ name: string }>;
        expect(cols.some((c) => c.name === 'notion_token')).toBe(true);
        const rows = upgraded.db.select().from(settings).all();
        expect(rows).toHaveLength(1);
        expect(rows[0].timezone).toBe('UTC');
        expect(rows[0].onboardingCompleted).toBe(true);
        expect(rows[0].notionToken).toBeNull();
      } finally {
        upgraded.close();
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
