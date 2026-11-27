import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3';
import { generateOrderKey } from './order-key.js';
import { schema } from './schema.js';
import { formatLocalDate, getHostTimeZone } from './time.js';
import {
  DEFAULT_GLOBAL_CAPTURE_SHORTCUT,
  DEFAULT_PROJECT_COLOR,
  DEFAULT_SETTINGS_ID,
  SYSTEM_OTHER_PROJECT_ID,
  normalizeBlockSizeMinutes,
  parseNoteTagsFromContent,
} from './types.js';

export interface VeyraDb {
  db: BetterSQLite3Database<typeof schema>;
  sqlite: Database.Database;
  dbPath: string;
  close(): void;
}

const MIGRATIONS_SQL = `
CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'personal',
  description TEXT NOT NULL DEFAULT '',
  done_when TEXT NOT NULL DEFAULT '',
  check_in_date TEXT,
  measure TEXT,
  if_it_stalls TEXT NOT NULL DEFAULT '',
  closing_note TEXT,
  closed_at TEXT,
  color TEXT NOT NULL DEFAULT '#3B4BD8',
  status TEXT NOT NULL DEFAULT 'active',
  order_key TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS goal_measure_updates (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  previous_value TEXT,
  value TEXT NOT NULL,
  week_start_date TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#3B4BD8',
  icon TEXT,
  default_goal_id TEXT REFERENCES goals(id) ON DELETE SET NULL,
  is_pinned INTEGER NOT NULL DEFAULT 0,
  is_system INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  notion_url TEXT,
  match_keywords TEXT NOT NULL DEFAULT '[]',
  weekly_time_minutes INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS blocks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  goal_id TEXT REFERENCES goals(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  is_ops INTEGER NOT NULL DEFAULT 0,
  bucket TEXT NOT NULL DEFAULT 'inbox',
  scheduled_date TEXT,
  planned_start_at TEXT,
  planned_end_at TEXT,
  due_date TEXT,
  revisit_at TEXT,
  order_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'todo',
  carryover_count INTEGER NOT NULL DEFAULT 0,
  size_minutes INTEGER,
  energy_signal TEXT,
  sense_signal TEXT,
  drop_reason TEXT,
  outcome_note TEXT,
  resume_note TEXT,
  auto_summary TEXT,
  side_work TEXT,
  recurrence_rule TEXT,
  series_id TEXT,
  notes TEXT NOT NULL DEFAULT '',
  external_links TEXT NOT NULL DEFAULT '[]',
  calendar_source TEXT,
  external_event_id TEXT,
  meeting_url TEXT,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS focus_sessions (
  id TEXT PRIMARY KEY,
  block_id TEXT NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  note TEXT,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS calendar_events (
  id TEXT PRIMARY KEY,
  external_id TEXT NOT NULL,
  title TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  meeting_url TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  goal_id TEXT REFERENCES goals(id) ON DELETE SET NULL,
  is_ops INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  external_links TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS daily_notes (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  content TEXT NOT NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  goal_id TEXT REFERENCES goals(id) ON DELETE SET NULL,
  is_ops INTEGER NOT NULL DEFAULT 0,
  tags TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS weekly_reviews (
  id TEXT PRIMARY KEY,
  week_start_date TEXT NOT NULL,
  rule_for_next_week TEXT NOT NULL DEFAULT '',
  previous_rule_kept TEXT,
  notes TEXT NOT NULL DEFAULT '',
  completed_at TEXT,
  snapshot_json TEXT,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS settings (
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
  meeting_auto_focus_enabled INTEGER NOT NULL DEFAULT 1,
  last_calendar_sync_at TEXT,
  webhook_url TEXT,
  webhook_events TEXT NOT NULL DEFAULT '[]',
  notion_token TEXT,
  notion_oauth_client_id TEXT,
  notion_oauth_client_secret TEXT,
  notion_oauth_redirect_uri TEXT,
  notion_workspace_name TEXT,
  macos_focus_enabled INTEGER NOT NULL DEFAULT 0,
  macos_focus_start_shortcut TEXT,
  macos_focus_end_shortcut TEXT,
  global_capture_shortcut TEXT NOT NULL DEFAULT 'CommandOrControl+Shift+P',
  run_in_menu_bar INTEGER NOT NULL DEFAULT 1,
  hotkeys TEXT NOT NULL DEFAULT '{}',
  workday_start TEXT NOT NULL DEFAULT '09:00',
  workday_end TEXT NOT NULL DEFAULT '18:00',
  workday_end_override_date TEXT,
  workday_end_override_time TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_log (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_events_source_external
  ON calendar_events(source, external_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_weekly_reviews_week_start
  ON weekly_reviews(week_start_date);

CREATE INDEX IF NOT EXISTS idx_blocks_bucket_date
  ON blocks(bucket, scheduled_date) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_blocks_project_id
  ON blocks(project_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_blocks_series_date
  ON blocks(series_id, scheduled_date);

CREATE INDEX IF NOT EXISTS idx_focus_sessions_block_id
  ON focus_sessions(block_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_focus_sessions_open
  ON focus_sessions(ended_at) WHERE ended_at IS NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_daily_notes_date
  ON daily_notes(date) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_goal_measure_updates_goal_id
  ON goal_measure_updates(goal_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_activity_log_created_at
  ON activity_log(created_at DESC);
`;

/**
 * Additive column migrations for databases created before a column existed.
 * `CREATE TABLE IF NOT EXISTS` never alters an existing table, so each new column
 * is checked via `PRAGMA table_info` and added in place (no data loss).
 */
const ADDITIVE_COLUMNS: ReadonlyArray<{ table: string; column: string; ddl: string }> = [
  {
    table: 'goals',
    column: 'kind',
    ddl: "ALTER TABLE goals ADD COLUMN kind TEXT NOT NULL DEFAULT 'personal'",
  },
  {
    table: 'goals',
    column: 'done_when',
    ddl: "ALTER TABLE goals ADD COLUMN done_when TEXT NOT NULL DEFAULT ''",
  },
  {
    table: 'goals',
    column: 'check_in_date',
    ddl: 'ALTER TABLE goals ADD COLUMN check_in_date TEXT',
  },
  {
    table: 'goals',
    column: 'measure',
    ddl: 'ALTER TABLE goals ADD COLUMN measure TEXT',
  },
  {
    table: 'goals',
    column: 'if_it_stalls',
    ddl: "ALTER TABLE goals ADD COLUMN if_it_stalls TEXT NOT NULL DEFAULT ''",
  },
  {
    table: 'goals',
    column: 'closing_note',
    ddl: 'ALTER TABLE goals ADD COLUMN closing_note TEXT',
  },
  {
    table: 'goals',
    column: 'closed_at',
    ddl: 'ALTER TABLE goals ADD COLUMN closed_at TEXT',
  },
  {
    table: 'projects',
    column: 'match_keywords',
    ddl: "ALTER TABLE projects ADD COLUMN match_keywords TEXT NOT NULL DEFAULT '[]'",
  },
  {
    table: 'projects',
    column: 'weekly_time_minutes',
    ddl: 'ALTER TABLE projects ADD COLUMN weekly_time_minutes INTEGER',
  },
  {
    table: 'blocks',
    column: 'size_minutes',
    ddl: 'ALTER TABLE blocks ADD COLUMN size_minutes INTEGER',
  },
  {
    table: 'blocks',
    column: 'sense_signal',
    ddl: 'ALTER TABLE blocks ADD COLUMN sense_signal TEXT',
  },
  {
    table: 'blocks',
    column: 'drop_reason',
    ddl: 'ALTER TABLE blocks ADD COLUMN drop_reason TEXT',
  },
  {
    table: 'blocks',
    column: 'side_work',
    ddl: 'ALTER TABLE blocks ADD COLUMN side_work TEXT',
  },
  {
    table: 'blocks',
    column: 'calendar_source',
    ddl: 'ALTER TABLE blocks ADD COLUMN calendar_source TEXT',
  },
  {
    table: 'blocks',
    column: 'external_event_id',
    ddl: 'ALTER TABLE blocks ADD COLUMN external_event_id TEXT',
  },
  {
    table: 'blocks',
    column: 'meeting_url',
    ddl: 'ALTER TABLE blocks ADD COLUMN meeting_url TEXT',
  },
  {
    table: 'daily_notes',
    column: 'tags',
    ddl: "ALTER TABLE daily_notes ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'",
  },
  {
    table: 'weekly_reviews',
    column: 'previous_rule_kept',
    ddl: 'ALTER TABLE weekly_reviews ADD COLUMN previous_rule_kept TEXT',
  },
  {
    table: 'weekly_reviews',
    column: 'completed_at',
    ddl: 'ALTER TABLE weekly_reviews ADD COLUMN completed_at TEXT',
  },
  {
    table: 'weekly_reviews',
    column: 'snapshot_json',
    ddl: 'ALTER TABLE weekly_reviews ADD COLUMN snapshot_json TEXT',
  },
  {
    table: 'settings',
    column: 'notion_token',
    ddl: 'ALTER TABLE settings ADD COLUMN notion_token TEXT',
  },
  {
    table: 'settings',
    column: 'notion_oauth_client_id',
    ddl: 'ALTER TABLE settings ADD COLUMN notion_oauth_client_id TEXT',
  },
  {
    table: 'settings',
    column: 'notion_oauth_client_secret',
    ddl: 'ALTER TABLE settings ADD COLUMN notion_oauth_client_secret TEXT',
  },
  {
    table: 'settings',
    column: 'notion_oauth_redirect_uri',
    ddl: 'ALTER TABLE settings ADD COLUMN notion_oauth_redirect_uri TEXT',
  },
  {
    table: 'settings',
    column: 'notion_workspace_name',
    ddl: 'ALTER TABLE settings ADD COLUMN notion_workspace_name TEXT',
  },
  {
    table: 'settings',
    column: 'macos_focus_enabled',
    ddl: 'ALTER TABLE settings ADD COLUMN macos_focus_enabled INTEGER NOT NULL DEFAULT 0',
  },
  {
    table: 'settings',
    column: 'macos_focus_start_shortcut',
    ddl: 'ALTER TABLE settings ADD COLUMN macos_focus_start_shortcut TEXT',
  },
  {
    table: 'settings',
    column: 'macos_focus_end_shortcut',
    ddl: 'ALTER TABLE settings ADD COLUMN macos_focus_end_shortcut TEXT',
  },
  {
    table: 'settings',
    column: 'hotkeys',
    ddl: "ALTER TABLE settings ADD COLUMN hotkeys TEXT NOT NULL DEFAULT '{}'",
  },
  {
    table: 'settings',
    column: 'workday_start',
    ddl: "ALTER TABLE settings ADD COLUMN workday_start TEXT NOT NULL DEFAULT '09:00'",
  },
  {
    table: 'settings',
    column: 'workday_end',
    ddl: "ALTER TABLE settings ADD COLUMN workday_end TEXT NOT NULL DEFAULT '18:00'",
  },
  {
    table: 'settings',
    column: 'meeting_auto_focus_enabled',
    ddl: 'ALTER TABLE settings ADD COLUMN meeting_auto_focus_enabled INTEGER NOT NULL DEFAULT 1',
  },
  {
    table: 'settings',
    column: 'workday_end_override_date',
    ddl: 'ALTER TABLE settings ADD COLUMN workday_end_override_date TEXT',
  },
  {
    table: 'settings',
    column: 'workday_end_override_time',
    ddl: 'ALTER TABLE settings ADD COLUMN workday_end_override_time TEXT',
  },
];

function applyAdditiveColumnMigrations(sqlite: Database.Database): void {
  for (const { table, column, ddl } of ADDITIVE_COLUMNS) {
    const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === column)) {
      sqlite.exec(ddl);
      if (table === 'daily_notes' && column === 'tags') {
        backfillNoteTagsFromContent(sqlite);
      }
    }
  }
}

/** One-time backfill when `daily_notes.tags` is added: existing `#tags` in content become tags. */
function backfillNoteTagsFromContent(sqlite: Database.Database): void {
  const rows = sqlite.prepare('SELECT id, content FROM daily_notes').all() as Array<{
    id: string;
    content: string;
  }>;
  const update = sqlite.prepare('UPDATE daily_notes SET tags = ? WHERE id = ?');
  for (const row of rows) {
    const tags = parseNoteTagsFromContent(row.content);
    if (tags.length > 0) update.run(JSON.stringify(tags), row.id);
  }
}

function seedBootstrapRows(sqlite: Database.Database): void {
  const now = new Date().toISOString();
  const hostTimezone = getHostTimeZone();

  const insertSystemProject = sqlite.prepare(`
    INSERT OR IGNORE INTO projects (
      id, name, description, color, icon, default_goal_id,
      is_pinned, is_system, status, notion_url, created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertSystemProject.run(
    SYSTEM_OTHER_PROJECT_ID,
    'Other',
    'Built-in system project for unassigned blocks and admin work.',
    DEFAULT_PROJECT_COLOR,
    null,
    null,
    0,
    1,
    'active',
    null,
    now,
    now,
    null,
  );

  const insertDefaultSettings = sqlite.prepare(`
    INSERT OR IGNORE INTO settings (
      id, theme, timezone, onboarding_completed, server_url,
      calendar_sync_mode, outlook_cli_command, ics_feed_url,
      calendar_sync_interval_min, skip_declined_and_all_day, last_calendar_sync_at,
      webhook_url, webhook_events, notion_token,
      notion_oauth_client_id, notion_oauth_client_secret,
      notion_oauth_redirect_uri, notion_workspace_name,
      macos_focus_enabled, macos_focus_start_shortcut, macos_focus_end_shortcut,
      global_capture_shortcut, run_in_menu_bar, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertDefaultSettings.run(
    DEFAULT_SETTINGS_ID,
    'dark',
    hostTimezone,
    0,
    null,
    'manual',
    null,
    null,
    15,
    1,
    null,
    null,
    '[]',
    null,
    null,
    null,
    null,
    null,
    0,
    null,
    null,
    DEFAULT_GLOBAL_CAPTURE_SHORTCUT,
    1,
    now,
  );
}

function applyPostMigrationIndexesAndBackfills(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_blocks_calendar_source_external
      ON blocks(calendar_source, external_event_id)
      WHERE calendar_source IS NOT NULL AND external_event_id IS NOT NULL;
  `);

  migrateLegacyCalendarEventsToBlocks(sqlite);
}

/**
 * Idempotently migrates rows from the legacy `calendar_events` table into `blocks`
 * so existing synced meetings keep their IDs, project/goal assignments, notes, and links.
 */
function migrateLegacyCalendarEventsToBlocks(sqlite: Database.Database): void {
  const hasLegacyTable = sqlite
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'calendar_events'")
    .get();
  if (!hasLegacyTable) return;

  const legacyRows = sqlite
    .prepare(
      `SELECT id, external_id, title, start_at, end_at, meeting_url, source,
              project_id, goal_id, is_ops, notes, external_links, updated_at, deleted_at
         FROM calendar_events`,
    )
    .all() as Array<{
    id: string;
    external_id: string;
    title: string;
    start_at: string;
    end_at: string;
    meeting_url: string | null;
    source: string;
    project_id: string | null;
    goal_id: string | null;
    is_ops: number;
    notes: string;
    external_links: string;
    updated_at: string;
    deleted_at: string | null;
  }>;

  if (legacyRows.length === 0) return;

  const tzRow = sqlite
    .prepare('SELECT timezone FROM settings WHERE id = ?')
    .get(DEFAULT_SETTINGS_ID) as { timezone?: string } | undefined;
  const timezone = tzRow?.timezone || getHostTimeZone();

  const existingById = sqlite.prepare('SELECT 1 FROM blocks WHERE id = ?');
  const existingByExt = sqlite.prepare(
    'SELECT 1 FROM blocks WHERE calendar_source = ? AND external_event_id = ?',
  );
  const projectExists = sqlite.prepare('SELECT 1 FROM projects WHERE id = ?');
  const goalExists = sqlite.prepare('SELECT 1 FROM goals WHERE id = ?');
  const insertBlock = sqlite.prepare(`
    INSERT INTO blocks (
      id, project_id, goal_id, title, is_ops, bucket, scheduled_date,
      planned_start_at, planned_end_at, due_date, revisit_at, order_key,
      status, carryover_count, size_minutes, energy_signal, sense_signal,
      drop_reason, outcome_note, resume_note, auto_summary, side_work,
      recurrence_rule, series_id, notes, external_links,
      calendar_source, external_event_id, meeting_url, updated_at, deleted_at
    ) VALUES (
      ?, ?, ?, ?, ?, 'scheduled', ?,
      ?, ?, NULL, NULL, ?,
      'todo', 0, ?, NULL, NULL,
      NULL, NULL, NULL, NULL, NULL,
      NULL, NULL, ?, ?,
      ?, ?, ?, ?, ?
    )
  `);

  let prevKey: string | null = null;
  sqlite.transaction(() => {
    for (const ev of legacyRows) {
      if (existingById.get(ev.id) || existingByExt.get(ev.source, ev.external_id)) {
        continue;
      }
      const startMs = Date.parse(ev.start_at);
      const endMs = Date.parse(ev.end_at);
      const scheduledDate = !Number.isNaN(startMs)
        ? formatLocalDate(new Date(startMs), timezone)
        : formatLocalDate(new Date(), timezone);
      const durationMinutes =
        !Number.isNaN(startMs) && !Number.isNaN(endMs) && endMs > startMs
          ? normalizeBlockSizeMinutes(Math.round((endMs - startMs) / 60_000))
          : 30;
      const validProjectId =
        ev.project_id && projectExists.get(ev.project_id)
          ? ev.project_id
          : SYSTEM_OTHER_PROJECT_ID;
      const validGoalId = ev.goal_id && goalExists.get(ev.goal_id) ? ev.goal_id : null;
      const orderKey = generateOrderKey(prevKey, null);
      prevKey = orderKey;

      insertBlock.run(
        ev.id,
        validProjectId,
        validGoalId,
        ev.title,
        ev.is_ops ? 1 : 0,
        scheduledDate,
        ev.start_at,
        ev.end_at,
        orderKey,
        durationMinutes,
        ev.notes ?? '',
        ev.external_links ?? '[]',
        ev.source,
        ev.external_id,
        ev.meeting_url ?? null,
        ev.updated_at,
        ev.deleted_at,
      );
    }
  })();
}

/**
 * Opens (or creates) a Veyra SQLite database, enables WAL + foreign keys,
 * applies idempotent DDL migrations, and seeds the singleton `Settings` row
 * and non-deletable system `Other` project.
 */
export function openVeyraDb(dbPath: string): VeyraDb {
  if (dbPath !== ':memory:') {
    const dir = path.dirname(path.resolve(dbPath));
    fs.mkdirSync(dir, { recursive: true });
  }

  const sqlite = new Database(dbPath);
  if (dbPath !== ':memory:') {
    sqlite.pragma('journal_mode = WAL');
  }
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');

  sqlite.exec(MIGRATIONS_SQL);
  applyAdditiveColumnMigrations(sqlite);
  seedBootstrapRows(sqlite);
  applyPostMigrationIndexesAndBackfills(sqlite);

  const db = drizzle(sqlite, { schema });

  return {
    db,
    sqlite,
    dbPath,
    close() {
      sqlite.close();
    },
  };
}
