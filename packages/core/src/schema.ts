import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type {
  ActivityActor,
  BlockBucket,
  BlockStatus,
  CalendarEventSource,
  CalendarSyncMode,
  EnergySignal,
  ExternalLink,
  GoalKind,
  GoalStatus,
  ProjectStatus,
  ThemeMode,
  WebhookEventName,
} from './types.js';

export const goals = sqliteTable('goals', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  kind: text('kind').$type<GoalKind>().notNull().default('personal'),
  description: text('description').notNull().default(''),
  doneWhen: text('done_when').notNull().default(''),
  checkInDate: text('check_in_date'),
  measure: text('measure'),
  ifItStalls: text('if_it_stalls').notNull().default(''),
  closingNote: text('closing_note'),
  closedAt: text('closed_at'),
  color: text('color').notNull().default('#3B4BD8'),
  status: text('status').$type<GoalStatus>().notNull().default('active'),
  orderKey: text('order_key').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
});

export const goalMeasureUpdates = sqliteTable('goal_measure_updates', {
  id: text('id').primaryKey(),
  goalId: text('goal_id')
    .notNull()
    .references(() => goals.id, { onDelete: 'cascade' }),
  previousValue: text('previous_value'),
  value: text('value').notNull(),
  weekStartDate: text('week_start_date').notNull(),
  recordedAt: text('recorded_at').notNull(),
});

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  color: text('color').notNull().default('#3B4BD8'),
  icon: text('icon'),
  defaultGoalId: text('default_goal_id').references(() => goals.id, { onDelete: 'set null' }),
  isPinned: integer('is_pinned', { mode: 'boolean' }).notNull().default(false),
  isSystem: integer('is_system', { mode: 'boolean' }).notNull().default(false),
  status: text('status').$type<ProjectStatus>().notNull().default('active'),
  notionUrl: text('notion_url'),
  matchKeywords: text('match_keywords', { mode: 'json' }).$type<string[]>().notNull().default([]),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
});

export const blocks = sqliteTable('blocks', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'restrict' }),
  goalId: text('goal_id').references(() => goals.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  isOps: integer('is_ops', { mode: 'boolean' }).notNull().default(false),
  bucket: text('bucket').$type<BlockBucket>().notNull().default('inbox'),
  scheduledDate: text('scheduled_date'),
  plannedStartAt: text('planned_start_at'),
  plannedEndAt: text('planned_end_at'),
  dueDate: text('due_date'),
  revisitAt: text('revisit_at'),
  orderKey: text('order_key').notNull(),
  status: text('status').$type<BlockStatus>().notNull().default('todo'),
  carryoverCount: integer('carryover_count').notNull().default(0),
  energySignal: text('energy_signal').$type<EnergySignal>(),
  outcomeNote: text('outcome_note'),
  resumeNote: text('resume_note'),
  autoSummary: text('auto_summary'),
  recurrenceRule: text('recurrence_rule'),
  seriesId: text('series_id'),
  notes: text('notes').notNull().default(''),
  externalLinks: text('external_links', { mode: 'json' })
    .$type<ExternalLink[]>()
    .notNull()
    .default([]),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
});

export const focusSessions = sqliteTable('focus_sessions', {
  id: text('id').primaryKey(),
  blockId: text('block_id')
    .notNull()
    .references(() => blocks.id, { onDelete: 'cascade' }),
  startedAt: text('started_at').notNull(),
  endedAt: text('ended_at'),
  note: text('note'),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
});

export const calendarEvents = sqliteTable(
  'calendar_events',
  {
    id: text('id').primaryKey(),
    externalId: text('external_id').notNull(),
    title: text('title').notNull(),
    startAt: text('start_at').notNull(),
    endAt: text('end_at').notNull(),
    meetingUrl: text('meeting_url'),
    source: text('source').$type<CalendarEventSource>().notNull().default('manual'),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
    goalId: text('goal_id').references(() => goals.id, { onDelete: 'set null' }),
    isOps: integer('is_ops', { mode: 'boolean' }).notNull().default(false),
    notes: text('notes').notNull().default(''),
    externalLinks: text('external_links', { mode: 'json' })
      .$type<ExternalLink[]>()
      .notNull()
      .default([]),
    updatedAt: text('updated_at').notNull(),
    deletedAt: text('deleted_at'),
  },
  (table) => [
    uniqueIndex('idx_calendar_events_source_external').on(table.source, table.externalId),
  ],
);

export const dailyNotes = sqliteTable('daily_notes', {
  id: text('id').primaryKey(),
  date: text('date').notNull(),
  content: text('content').notNull(),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
  goalId: text('goal_id').references(() => goals.id, { onDelete: 'set null' }),
  isOps: integer('is_ops', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
});

export const weeklyReviews = sqliteTable(
  'weekly_reviews',
  {
    id: text('id').primaryKey(),
    weekStartDate: text('week_start_date').notNull(),
    ruleForNextWeek: text('rule_for_next_week').notNull().default(''),
    notes: text('notes').notNull().default(''),
    updatedAt: text('updated_at').notNull(),
    deletedAt: text('deleted_at'),
  },
  (table) => [uniqueIndex('idx_weekly_reviews_week_start').on(table.weekStartDate)],
);

export const settings = sqliteTable('settings', {
  id: text('id').primaryKey(),
  theme: text('theme').$type<ThemeMode>().notNull().default('dark'),
  timezone: text('timezone').notNull(),
  onboardingCompleted: integer('onboarding_completed', { mode: 'boolean' })
    .notNull()
    .default(false),
  serverUrl: text('server_url'),
  calendarSyncMode: text('calendar_sync_mode')
    .$type<CalendarSyncMode>()
    .notNull()
    .default('manual'),
  outlookCliCommand: text('outlook_cli_command'),
  icsFeedUrl: text('ics_feed_url'),
  calendarSyncIntervalMin: integer('calendar_sync_interval_min').notNull().default(15),
  skipDeclinedAndAllDay: integer('skip_declined_and_all_day', { mode: 'boolean' })
    .notNull()
    .default(true),
  lastCalendarSyncAt: text('last_calendar_sync_at'),
  webhookUrl: text('webhook_url'),
  webhookEvents: text('webhook_events', { mode: 'json' })
    .$type<WebhookEventName[]>()
    .notNull()
    .default([]),
  notionToken: text('notion_token'),
  notionOauthClientId: text('notion_oauth_client_id'),
  notionOauthClientSecret: text('notion_oauth_client_secret'),
  notionOauthRedirectUri: text('notion_oauth_redirect_uri'),
  notionWorkspaceName: text('notion_workspace_name'),
  macosFocusEnabled: integer('macos_focus_enabled', { mode: 'boolean' })
    .notNull()
    .default(false),
  macosFocusStartShortcut: text('macos_focus_start_shortcut'),
  macosFocusEndShortcut: text('macos_focus_end_shortcut'),
  globalCaptureShortcut: text('global_capture_shortcut')
    .notNull()
    .default('CommandOrControl+Shift+P'),
  runInMenuBar: integer('run_in_menu_bar', { mode: 'boolean' }).notNull().default(true),
  updatedAt: text('updated_at').notNull(),
});

export const activityLog = sqliteTable('activity_log', {
  id: text('id').primaryKey(),
  actor: text('actor').$type<ActivityActor>().notNull(),
  action: text('action').notNull(),
  summary: text('summary').notNull(),
  createdAt: text('created_at').notNull(),
});

export const schema = {
  goals,
  goalMeasureUpdates,
  projects,
  blocks,
  focusSessions,
  calendarEvents,
  dailyNotes,
  weeklyReviews,
  settings,
  activityLog,
};
