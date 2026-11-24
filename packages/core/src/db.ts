import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3';
import { schema } from './schema.js';
import { getHostTimeZone } from './time.js';
import {
  DEFAULT_GLOBAL_CAPTURE_SHORTCUT,
  DEFAULT_PROJECT_COLOR,
  DEFAULT_SETTINGS_ID,
  SYSTEM_OTHER_PROJECT_ID,
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
  description TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#3B4BD8',
  status TEXT NOT NULL DEFAULT 'active',
  order_key TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
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
  energy_signal TEXT,
  outcome_note TEXT,
  resume_note TEXT,
  auto_summary TEXT,
  recurrence_rule TEXT,
  series_id TEXT,
  notes TEXT NOT NULL DEFAULT '',
  external_links TEXT NOT NULL DEFAULT '[]',
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
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS weekly_reviews (
  id TEXT PRIMARY KEY,
  week_start_date TEXT NOT NULL,
  rule_for_next_week TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
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
    table: 'projects',
    column: 'match_keywords',
    ddl: "ALTER TABLE projects ADD COLUMN match_keywords TEXT NOT NULL DEFAULT '[]'",
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
];

function applyAdditiveColumnMigrations(sqlite: Database.Database): void {
  for (const { table, column, ddl } of ADDITIVE_COLUMNS) {
    const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === column)) {
      sqlite.exec(ddl);
    }
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
