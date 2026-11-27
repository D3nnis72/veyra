import crypto from 'node:crypto';
import fs from 'node:fs';
import type http from 'node:http';
import path from 'node:path';
import { serve, type ServerType } from '@hono/node-server';
import {
  type ActivityActor,
  type ActivityLog,
  type Block,
  type BlockDetail,
  type CalendarEvent,
  type CalendarSyncStatus,
  type DailyNote,
  type DayLookBackSummary,
  type FitLineSummary,
  type FocusSession,
  type FocusStatus,
  type Goal,
  type GoalDetail,
  type GoalWithStats,
  type MacOsFocusRunResult,
  type MacOsFocusShortcutsResponse,
  type NormalizedCalendarEvent,
  type NotionOAuthStartResponse,
  type NotionTestConnectionResult,
  type PlanProjectTimeItem,
  type ProjectWithStats,
  type PublicSettings,
  type RoomTodaySummary,
  type Settings,
  type SuggestedOrderItem,
  ValidationError,
  VeyraError,
  type VeyraDb,
  type WeeklyReviewSummary,
  activityActorSchema,
  addDailyNote,
  addDaysToDateString,
  applySuggestedOrder,
  blockBucketSchema,
  blockStatusSchema,
  calendarEventSourceSchema,
  closeGoal,
  completeBlock,
  completeWeeklyReview,
  completeWeeklyReviewInputSchema,
  computePlanCapacity,
  computeTodayCapacity,
  createBlock,
  createGoal,
  autoMatchUnassignedCalendarEvents,
  createProject,
  dateOnlySchema,
  deleteBlock,
  deleteDailyNote,
  deleteGoal,
  deleteProject,
  deleteSession,
  dropBlock,
  dropReasonSchema,
  formatLocalDate,
  getActiveWeeklyRule,
  getBlockDetail,
  cancelFocus,
  getFocusStatus,
  getGoalDetail,
  getLocalDayBoundsIso,
  getProject,
  getSettings,
  getWeekRange,
  getWeeklyReview,
  goalKindSchema,
  goalStatusSchema,
  isoTimestampSchema,
  listActivity,
  listBlocks,
  listCalendarEvents,
  listDailyNotes,
  listNoteTags,
  listGoals,
  listProjects,
  listSessions,
  logManualSession,
  macOsFocusPhaseSchema,
  moveBlock,
  normalizedCalendarEventSchema,
  openVeyraDb,
  parkBlock,
  pauseFocus,
  removeActiveFocusGap,
  projectStatusSchema,
  reopenBlock,
  reopenWeeklyReview,
  reorderBlock,
  reorderGoal,
  resolveIsoWeekStartDate,
  resumeFocus,
  ruleKeptSchema,
  runDailyRolloverAndRecurrence,
  senseSignalSchema,
  setPreviousRuleKept,
  setWeeklyRule,
  splitSession,
  startFocus,
  stopFocus,
  toPublicSettings,
  trimSession,
  updateActiveFocusStartTime,
  updateBlock,
  updateCalendarEvent,
  updateDailyNote,
  updateGoal,
  updateProject,
  updateSettings,
  upsertCalendarEvents,
} from '@veyra/core';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';
import {
  MacOsFocusPresence,
  type MacOsFocusPresenceOptions,
} from './macos-focus.js';
import { NotionApiError, NotionClient, type NotionClientOptions } from './notion.js';
import { SseHub } from './sse.js';
import { CalendarSyncRunner, type CalendarSyncRunnerOptions } from './sync/sync-runner.js';
import { CalendarSyncError, type CalendarSyncRunResult } from './sync/types.js';
import {
  WebhookDispatcher,
  type WebhookDispatchResult,
  type WebhookDispatcherOptions,
} from './webhooks.js';

export const SERVER_VERSION = '0.1.0';

export interface CreateVeyraServerOptions {
  dbPath: string;
  port?: number;
  host?: string;
  bearerToken?: string;
  webDistDir?: string;
  enableTestClock?: boolean;
  rolloverCheckIntervalMs?: number;
  sseHeartbeatIntervalMs?: number;
  syncRunnerOptions?: CalendarSyncRunnerOptions;
  webhookOptions?: WebhookDispatcherOptions;
  notionToken?: string;
  notionOptions?: Omit<NotionClientOptions, 'envToken'>;
  macosFocusOptions?: MacOsFocusPresenceOptions;
}

export interface VeyraServerInstance {
  app: Hono;
  db: VeyraDb;
  syncRunner: CalendarSyncRunner;
  webhooks: WebhookDispatcher;
  notion: NotionClient;
  macosFocus: MacOsFocusPresence;
  sseHub: SseHub;
  start: () => Promise<{ port: number; host: string; url: string }>;
  stop: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Response DTO types (exported for @veyra/cli & @veyra/web)
// ---------------------------------------------------------------------------

export interface TodayResponse {
  date: string;
  timezone: string;
  weeklyRule: string | null;
  nextWeekRule: string | null;
  focusStatus: FocusStatus;
  upNext: Block[];
  completedToday: Block[];
  upcomingEvents: CalendarEvent[];
  todayEvents: CalendarEvent[];
  meetingAutoFocusEnabled?: boolean;
  dailyNotesCount: number;
  projects: ProjectWithStats[];
  goals: GoalWithStats[];
  roomToday: RoomTodaySummary;
  suggestedOrder: SuggestedOrderItem[];
  fitLine: FitLineSummary;
  dayLookBack: DayLookBackSummary | null;
}

export interface PlanDayBucket {
  date: string;
  blocks: Block[];
  events: CalendarEvent[];
  plannedMinutes: number;
  roomMinutes: number;
}

export interface PlanResponse {
  weekStartDate: string;
  weekEndDate: string;
  today: string;
  timezone: string;
  days: PlanDayBucket[];
  projectTimeStrip: PlanProjectTimeItem[];
  inbox: Block[];
  later: Block[];
  projects: ProjectWithStats[];
  goals: GoalWithStats[];
}

export interface CalendarSessionItem extends FocusSession {
  blockTitle: string;
  projectId: string;
  goalId: string | null;
  isOps: boolean;
  blockStatus: Block['status'];
}

export interface CalendarResponse {
  startDate: string;
  endDate: string;
  timezone: string;
  sessions: CalendarSessionItem[];
  plannedBlocks: Block[];
  events: CalendarEvent[];
  projects: ProjectWithStats[];
  goals: GoalWithStats[];
}

export interface ProjectDetailResponse {
  project: ProjectWithStats;
  openBlocks: Block[];
  completedBlocks: Block[];
}

export interface ReviewResponse extends WeeklyReviewSummary {
  projects: ProjectWithStats[];
  goals: GoalWithStats[];
}

export interface SettingsResponse {
  settings: PublicSettings;
  calendarSyncStatus: CalendarSyncStatus;
  notionConfigured: boolean;
}

export interface NotionTestResponse {
  result: NotionTestConnectionResult;
}

export interface SyncEventsResponse {
  status: CalendarSyncStatus;
  result: Omit<CalendarSyncRunResult, 'status'>;
  error?: string;
}

export interface TestHookResponse {
  result: WebhookDispatchResult;
}

export interface MacOsFocusTestResponse {
  result: MacOsFocusRunResult;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const focusStartBodySchema = z.object({
  blockId: z.string().uuid(),
  startedAt: isoTimestampSchema.optional(),
});

const focusStartTimeBodySchema = z.object({
  startedAt: isoTimestampSchema,
});

const focusPauseBodySchema = z.object({
  note: z.string().nullable().optional(),
  /** End the session earlier than now, for example when you walked away. */
  endedAt: isoTimestampSchema.optional(),
});

const focusGapBodySchema = z.object({
  gapStartAt: isoTimestampSchema,
  gapEndAt: isoTimestampSchema.optional(),
});

const focusCompleteBodySchema = z.object({
  blockId: z.string().uuid().optional(),
  energySignal: z.enum(['up', 'neutral', 'down']).nullable().optional(),
  senseSignal: senseSignalSchema.nullable().optional(),
  outcomeNote: z.string().nullable().optional(),
});

const dropBlockBodySchema = z.object({
  stopSeries: z.boolean().optional(),
  dropReason: dropReasonSchema.nullable().optional(),
});

const applySuggestedOrderBodySchema = z.object({
  blockIds: z.array(z.string().uuid()),
});

const setWeeklyRuleBodySchema = z.object({
  weekStartDate: dateOnlySchema.optional(),
  ruleForNextWeek: z.string().optional(),
  previousRuleKept: ruleKeptSchema.nullable().optional(),
  notes: z.string().optional(),
});

const completeWeeklyReviewBodySchema = completeWeeklyReviewInputSchema.extend({
  week: z.number().int().min(1).max(53).optional(),
});

const reopenWeeklyReviewBodySchema = z.object({
  weekStartDate: dateOnlySchema.optional(),
  week: z.number().int().min(1).max(53).optional(),
});

const upsertEventsBodySchema = z.object({
  source: calendarEventSourceSchema.optional().default('manual'),
  events: z.array(normalizedCalendarEventSchema),
});

const notionTestBodySchema = z.object({
  token: z.string().optional(),
});

const notionOAuthStartBodySchema = z.object({
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  redirectUri: z.string().optional(),
});

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderNotionOAuthCallbackHtml(options: {
  ok: boolean;
  title: string;
  detail: string;
}): string {
  const accent = options.ok ? '#2E9E6F' : '#C94A6A';
  const badge = options.ok ? 'Connected' : 'Connection Failed';
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Veyra · ${escapeHtml(options.title)}</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #131313; color: #EDEDED; font-family: -apple-system, BlinkMacSystemFont, "Inter", sans-serif; padding: 24px; }
      .card { width: 100%; max-width: 440px; background: #1C1C1C; border: 1px solid #2A2A2A; border-radius: 12px; padding: 24px; box-sizing: border-box; }
      .badge { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; padding: 4px 10px; border-radius: 999px; background: ${accent}22; color: #EDEDED; border: 1px solid ${accent}66; }
      h1 { margin: 14px 0 8px; font-size: 18px; font-weight: 600; }
      p { margin: 0; font-size: 13px; line-height: 1.5; color: #9A9A9A; }
      .hint { margin-top: 16px; font-size: 12px; color: #6E6E6E; }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="badge">${escapeHtml(badge)}</div>
      <h1>${escapeHtml(options.title)}</h1>
      <p>${escapeHtml(options.detail)}</p>
      <p class="hint">You can close this tab and return to Veyra.</p>
    </div>
  </body>
</html>`;
}

const macOsFocusTestBodySchema = z.object({
  phase: macOsFocusPhaseSchema,
  shortcutName: z.string().optional(),
});

function constantTimeTokenMatch(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(provided, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');
  if (providedBuf.length !== expectedBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}

function parseOptionalBool(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  throw new ValidationError(`Invalid boolean query parameter value: '${value}'`);
}

function parseDateOrIsoToRangeBound(
  raw: string,
  timezone: string,
  edge: 'start' | 'end',
): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const valid = dateOnlySchema.safeParse(raw);
    if (!valid.success) {
      throw new ValidationError(`Invalid date parameter: '${raw}'`);
    }
    const bounds = getLocalDayBoundsIso(valid.data, timezone);
    return edge === 'start' ? bounds.startIso : bounds.endIso;
  }
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) {
    throw new ValidationError(`Invalid date/timestamp parameter: '${raw}'`);
  }
  return new Date(ms).toISOString();
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] ?? 'application/octet-stream';
}

function resolveStaticFile(rootDir: string, requestPath: string): string | null {
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(requestPath);
  } catch {
    return null;
  }
  if (decodedPath.includes('\0')) {
    return null;
  }
  const normalized = path.posix.normalize(decodedPath);
  const relativePath = normalized.replace(/^\/+/, '');
  const resolvedRoot = path.resolve(rootDir);
  const candidate = path.resolve(resolvedRoot, relativePath);

  if (candidate !== resolvedRoot && !candidate.startsWith(`${resolvedRoot}${path.sep}`)) {
    return null;
  }
  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    return candidate;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Server Factory
// ---------------------------------------------------------------------------

export function createVeyraServer(options: CreateVeyraServerOptions): VeyraServerInstance {
  const db = openVeyraDb(options.dbPath);
  const port = options.port ?? 4173;
  const host = options.host ?? '127.0.0.1';
  const bearerToken = options.bearerToken?.trim() || undefined;
  const webDistDir = options.webDistDir?.trim() || undefined;
  const enableTestClock =
    options.enableTestClock ?? process.env.VEYRA_ENABLE_TEST_CLOCK === '1';
  const rolloverCheckIntervalMs = options.rolloverCheckIntervalMs ?? 60_000;

  const sseHub = new SseHub({
    heartbeatIntervalMs: options.sseHeartbeatIntervalMs,
  });

  const emitSse = (type: string, entity?: string, id?: string, now?: Date) => {
    sseHub.broadcast({
      type,
      ...(entity ? { entity } : {}),
      ...(id ? { id } : {}),
      timestamp: (now ?? new Date()).toISOString(),
    });
  };

  const syncRunner = new CalendarSyncRunner(db, {
    ...options.syncRunnerOptions,
    onSynced: (ev) => {
      sseHub.broadcast({
        type: ev.type,
        entity: ev.entity,
        timestamp: ev.timestamp,
      });
      options.syncRunnerOptions?.onSynced?.(ev);
    },
  });

  const webhooks = new WebhookDispatcher(db, {
    ...options.webhookOptions,
    onDelivery: (ev) => {
      emitSse(ev.action, 'activity', undefined, new Date(ev.timestamp));
      options.webhookOptions?.onDelivery?.(ev);
    },
  });

  const envNotionToken =
    (options.notionToken !== undefined
      ? options.notionToken
      : process.env.VEYRA_NOTION_TOKEN
    )?.trim() || undefined;
  const envNotionOauthClientId = process.env.VEYRA_NOTION_CLIENT_ID?.trim() || undefined;
  const envNotionOauthClientSecret =
    process.env.VEYRA_NOTION_CLIENT_SECRET?.trim() || undefined;

  const notion = new NotionClient(db, {
    ...options.notionOptions,
    envToken: envNotionToken,
    envOauthClientId: options.notionOptions?.envOauthClientId ?? envNotionOauthClientId,
    envOauthClientSecret:
      options.notionOptions?.envOauthClientSecret ?? envNotionOauthClientSecret,
  });

  const pendingNotionOAuthStates = new Map<
    string,
    { redirectUri: string; expiresAt: number }
  >();
  const NOTION_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

  const macosFocus = new MacOsFocusPresence(db, options.macosFocusOptions);

  const buildSettingsResponse = (row: Settings): SettingsResponse => {
    const publicSettings = toPublicSettings(row, envNotionToken, {
      clientId: options.notionOptions?.envOauthClientId ?? envNotionOauthClientId,
      clientSecret:
        options.notionOptions?.envOauthClientSecret ?? envNotionOauthClientSecret,
    });
    return {
      settings: publicSettings,
      calendarSyncStatus: syncRunner.getStatus(),
      notionConfigured: publicSettings.notionConfigured,
    };
  };

  /** Retro-matches unassigned meetings to Projects and notifies clients when anything changed. */
  const runMeetingAutoMatch = (now: Date | undefined, actor: ActivityActor) => {
    const result = autoMatchUnassignedCalendarEvents(db, now, { actor });
    if (result.matchedCount > 0) {
      emitSse('events.updated', 'calendar_event', undefined, now);
    }
    return result;
  };

  /** Project fields that change which meetings a Project can claim. */
  const touchesMatching = (body: unknown): boolean =>
    typeof body === 'object' &&
    body !== null &&
    ['matchKeywords', 'defaultGoalId', 'name', 'status'].some((key) => key in body);

  const app = new Hono();

  // CORS for Vite dev server, Electron renderer, and local clients
  app.use(
    '*',
    cors({
      origin: (origin) => origin || '*',
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'X-Veyra-Actor', 'X-Veyra-Now'],
      exposeHeaders: ['Content-Type'],
      maxAge: 86_400,
    }),
  );

  // Global error handling (uniform { error: { code, message } } envelope)
  app.onError((err, c) => {
    if (err instanceof VeyraError) {
      return c.json(
        { error: { code: err.code, message: err.message } },
        err.httpStatus as ContentfulStatusCode,
      );
    }
    if (err instanceof CalendarSyncError) {
      return c.json({ error: { code: err.code, message: err.message } }, 502);
    }
    if (err instanceof NotionApiError) {
      return c.json({ error: { code: err.code, message: err.message } }, 502);
    }
    return c.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: err instanceof Error ? err.message : 'Internal server error',
        },
      },
      500,
    );
  });

  // Bearer token auth middleware for /api/* (except /api/health, OAuth callback, and CORS preflight)
  if (bearerToken) {
    app.use('/api/*', async (c, next) => {
      if (
        c.req.method === 'OPTIONS' ||
        c.req.path === '/api/health' ||
        c.req.path === '/api/integrations/notion/oauth/callback'
      ) {
        await next();
        return;
      }

      const authHeader = c.req.header('Authorization');
      let provided: string | null = null;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        provided = authHeader.slice('Bearer '.length).trim();
      } else if (c.req.path === '/api/events/stream') {
        provided = c.req.query('token') ?? null;
      }

      if (!provided || !constantTimeTokenMatch(provided, bearerToken)) {
        return c.json(
          {
            error: {
              code: 'UNAUTHORIZED',
              message: 'Valid Bearer token is required',
            },
          },
          401,
        );
      }

      await next();
    });
  }

  // Request context helpers
  const getNow = (c: Context): Date => {
    if (enableTestClock) {
      const raw = c.req.header('X-Veyra-Now') ?? c.req.query('now');
      if (raw) {
        const ms = Date.parse(raw);
        if (Number.isNaN(ms)) {
          throw new ValidationError(`Invalid X-Veyra-Now timestamp: '${raw}'`);
        }
        return new Date(ms);
      }
    }
    return new Date();
  };

  const getActor = (c: Context): ActivityActor => {
    const raw = c.req.header('X-Veyra-Actor');
    if (!raw) {
      return 'user';
    }
    const parsed = activityActorSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError(`Invalid X-Veyra-Actor header: '${raw}'`);
    }
    return parsed.data;
  };

  const readJsonBody = async <T = Record<string, unknown>>(
    c: Context,
    allowEmpty = false,
  ): Promise<T> => {
    const text = await c.req.text();
    if (!text.trim()) {
      if (allowEmpty) {
        return {} as T;
      }
      throw new ValidationError('Request body must be valid JSON');
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ValidationError('Invalid JSON request body');
    }
  };

  // -------------------------------------------------------------------------
  // Health & SSE
  // -------------------------------------------------------------------------

  app.get('/api/health', (c) => {
    let dbReady = false;
    try {
      const row = db.sqlite.prepare('SELECT 1 AS ok').get() as { ok: number } | undefined;
      dbReady = row?.ok === 1;
    } catch {
      dbReady = false;
    }
    return c.json({ ok: dbReady, version: SERVER_VERSION, dbReady });
  });

  app.get('/api/events/stream', (c) => {
    return sseHub.createResponse(c.req.raw.signal);
  });

  // -------------------------------------------------------------------------
  // Composite Views: Today, Plan, Calendar, Review
  // -------------------------------------------------------------------------

  app.get('/api/today', (c) => {
    const now = getNow(c);
    runDailyRolloverAndRecurrence(db, now);

    const settings = getSettings(db);
    const timezone = settings.timezone;
    const date = formatLocalDate(now, timezone);
    const { startIso, endIso } = getLocalDayBoundsIso(date, timezone);
    const dayStartMs = Date.parse(startIso);
    const dayEndMs = Date.parse(endIso);

    const ruleInfo = getActiveWeeklyRule(db, date, now);
    const weeklyRule =
      ruleInfo.activeRuleText ?? ruleInfo.nextWeekRule?.ruleForNextWeek ?? null;
    const nextWeekRule = ruleInfo.nextWeekRule?.ruleForNextWeek ?? null;

    const focusStatus = getFocusStatus(db, now);
    const activeBlockId = focusStatus.activeBlock?.id ?? null;
    const upNext = listBlocks(db, {
      bucket: 'scheduled',
      scheduledDate: date,
      status: 'todo',
    }).filter((blk) => blk.id !== activeBlockId);

    const todaySessions = listSessions(db, { startIso, endIso });
    const sessionBlockIdsToday = new Set(todaySessions.map((s) => s.blockId));

    const completedToday = listBlocks(db, { status: 'done', includeCalendar: true })
      .filter((blk) => {
        if (blk.scheduledDate === date) return true;
        const updatedMs = Date.parse(blk.updatedAt);
        if (updatedMs >= dayStartMs && updatedMs < dayEndMs) return true;
        return sessionBlockIdsToday.has(blk.id);
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    const todayEvents = listCalendarEvents(db, startIso, endIso);
    const nowMs = now.getTime();
    const upcomingEvents = todayEvents.filter((ev) => Date.parse(ev.endAt) > nowMs);

    const notesToday = listDailyNotes(db, { date });
    const projects = listProjects(db, now, { includeArchived: false });
    const goals = listGoals(db, { activeOnly: true }, now);
    const capacity = computeTodayCapacity(db, {
      date,
      upNext,
      completedToday,
      todayEvents,
      projects,
      goals,
      now,
    });

    const payload: TodayResponse = {
      date,
      timezone,
      weeklyRule,
      nextWeekRule,
      focusStatus,
      upNext,
      completedToday,
      upcomingEvents,
      todayEvents,
      meetingAutoFocusEnabled: settings.meetingAutoFocusEnabled,
      dailyNotesCount: notesToday.length,
      projects,
      goals,
      roomToday: capacity.roomToday,
      suggestedOrder: capacity.suggestedOrder,
      fitLine: capacity.fitLine,
      dayLookBack: capacity.dayLookBack,
    };

    return c.json(payload);
  });

  app.post('/api/today/apply-suggested-order', async (c) => {
    const now = getNow(c);
    const actor = getActor(c);
    const raw = await readJsonBody(c);
    const parsed = applySuggestedOrderBodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError('Invalid apply-suggested-order payload (expected { blockIds: UUID[] })');
    }
    const reordered = applySuggestedOrder(db, parsed.data.blockIds, { now, actor });
    emitSse('block.reordered', 'block', undefined, now);
    return c.json({ blocks: reordered });
  });

  app.get('/api/plan', (c) => {
    const now = getNow(c);
    runDailyRolloverAndRecurrence(db, now);

    const settings = getSettings(db);
    const timezone = settings.timezone;
    const today = formatLocalDate(now, timezone);

    const rawWeekStart = c.req.query('weekStart');
    if (rawWeekStart) {
      const check = dateOnlySchema.safeParse(rawWeekStart);
      if (!check.success) {
        throw new ValidationError(`Invalid weekStart parameter: '${rawWeekStart}'`);
      }
    }

    const { weekStartDate, weekEndDate } = getWeekRange(rawWeekStart ?? today);

    const rawDays: Array<{ date: string; blocks: Block[]; events: CalendarEvent[] }> = [];
    for (let offset = 0; offset < 7; offset++) {
      const date = addDaysToDateString(weekStartDate, offset);
      const { startIso, endIso } = getLocalDayBoundsIso(date, timezone);
      const dayBlocks = listBlocks(db, {
        bucket: 'scheduled',
        scheduledDate: date,
        includeDropped: false,
      });
      const dayEvents = listCalendarEvents(db, startIso, endIso);
      rawDays.push({ date, blocks: dayBlocks, events: dayEvents });
    }

    const inbox = listBlocks(db, { bucket: 'inbox', status: 'todo' });
    const later = listBlocks(db, { bucket: 'later', status: 'todo' });
    const projects = listProjects(db, now, { includeArchived: false });
    const goals = listGoals(db, { activeOnly: true }, now);

    const planCapacity = computePlanCapacity(db, rawDays, projects, now);
    const days: PlanDayBucket[] = rawDays.map((day, idx) => ({
      ...day,
      plannedMinutes: planCapacity.dayCapacities[idx]?.plannedMinutes ?? 0,
      roomMinutes: planCapacity.dayCapacities[idx]?.roomMinutes ?? 0,
    }));

    const payload: PlanResponse = {
      weekStartDate,
      weekEndDate,
      today,
      timezone,
      days,
      projectTimeStrip: planCapacity.projectTimeStrip,
      inbox,
      later,
      projects,
      goals,
    };

    return c.json(payload);
  });

  app.get('/api/calendar', (c) => {
    const now = getNow(c);
    runDailyRolloverAndRecurrence(db, now);

    const settings = getSettings(db);
    const timezone = settings.timezone;
    const today = formatLocalDate(now, timezone);
    const defaultWeek = getWeekRange(today);

    const startDate = c.req.query('start') ?? defaultWeek.weekStartDate;
    const endDate = c.req.query('end') ?? defaultWeek.weekEndDate;

    if (!dateOnlySchema.safeParse(startDate).success) {
      throw new ValidationError(`Invalid start parameter: '${startDate}'`);
    }
    if (!dateOnlySchema.safeParse(endDate).success) {
      throw new ValidationError(`Invalid end parameter: '${endDate}'`);
    }
    if (endDate < startDate) {
      throw new ValidationError('end date must be on or after start date');
    }

    const rangeStartIso = getLocalDayBoundsIso(startDate, timezone).startIso;
    const rangeEndIso = getLocalDayBoundsIso(endDate, timezone).endIso;
    const rangeStartMs = Date.parse(rangeStartIso);
    const rangeEndMs = Date.parse(rangeEndIso);

    const allBlocks = listBlocks(db, { includeCalendar: true });
    const blockById = new Map<string, Block>();
    for (const blk of allBlocks) {
      blockById.set(blk.id, blk);
    }

    const rawSessions = listSessions(db, { startIso: rangeStartIso, endIso: rangeEndIso });
    const sessions: CalendarSessionItem[] = rawSessions.map((session) => {
      const blk = blockById.get(session.blockId);
      return {
        ...session,
        blockTitle: blk?.title ?? 'Deleted block',
        projectId: blk?.projectId ?? '',
        goalId: blk?.goalId ?? null,
        isOps: blk?.isOps ?? false,
        blockStatus: blk?.status ?? 'todo',
      };
    });

    const plannedBlocks = allBlocks
      .filter((blk) => {
        if (
          blk.status === 'dropped' ||
          blk.calendarSource ||
          !blk.plannedStartAt ||
          !blk.plannedEndAt
        ) {
          return false;
        }
        const pStart = Date.parse(blk.plannedStartAt);
        const pEnd = Date.parse(blk.plannedEndAt);
        return pStart < rangeEndMs && pEnd > rangeStartMs;
      })
      .sort((a, b) => (a.plannedStartAt ?? '').localeCompare(b.plannedStartAt ?? ''));

    const events = listCalendarEvents(db, rangeStartIso, rangeEndIso);
    const projects = listProjects(db, now, { includeArchived: false });
    const goals = listGoals(db, { activeOnly: true }, now);

    const payload: CalendarResponse = {
      startDate,
      endDate,
      timezone,
      sessions,
      plannedBlocks,
      events,
      projects,
      goals,
    };

    return c.json(payload);
  });

  // -------------------------------------------------------------------------
  // Goals
  // -------------------------------------------------------------------------

  app.get('/api/goals', (c) => {
    const now = getNow(c);
    const rawStatus = c.req.query('status');
    const status = rawStatus
      ? (() => {
          const parsed = goalStatusSchema.safeParse(rawStatus);
          if (!parsed.success) {
            throw new ValidationError(`Invalid goal status: '${rawStatus}'`);
          }
          return parsed.data;
        })()
      : undefined;
    const rawKind = c.req.query('kind');
    const kind = rawKind
      ? (() => {
          const parsed = goalKindSchema.safeParse(rawKind);
          if (!parsed.success) {
            throw new ValidationError(`Invalid goal kind: '${rawKind}'`);
          }
          return parsed.data;
        })()
      : undefined;
    const includeArchived = parseOptionalBool(c.req.query('includeArchived'));
    const activeOnly = parseOptionalBool(c.req.query('activeOnly'));
    const goals = listGoals(db, { status, kind, includeArchived, activeOnly }, now);
    return c.json({ goals });
  });

  app.post('/api/goals', async (c) => {
    const now = getNow(c);
    const actor = getActor(c);
    const body = await readJsonBody(c);
    const goal = createGoal(db, body as Parameters<typeof createGoal>[1], { now, actor });
    emitSse('goal.created', 'goal', goal.id, now);
    return c.json({ goal }, 201);
  });

  app.get('/api/goals/:id', (c) => {
    const now = getNow(c);
    const goal: GoalDetail = getGoalDetail(db, c.req.param('id'), now);
    return c.json({ goal });
  });

  app.patch('/api/goals/:id', async (c) => {
    const now = getNow(c);
    const actor = getActor(c);
    const body = await readJsonBody(c);
    const goal = updateGoal(db, c.req.param('id'), body as Parameters<typeof updateGoal>[2], {
      now,
      actor,
    });
    emitSse('goal.updated', 'goal', goal.id, now);
    return c.json({ goal });
  });

  app.post('/api/goals/:id/close', async (c) => {
    const now = getNow(c);
    const actor = getActor(c);
    const body = await readJsonBody(c);
    const goal = closeGoal(db, c.req.param('id'), body as Parameters<typeof closeGoal>[2], {
      now,
      actor,
    });
    emitSse('goal.closed', 'goal', goal.id, now);
    return c.json({ goal });
  });

  app.post('/api/goals/:id/reorder', async (c) => {
    const now = getNow(c);
    const actor = getActor(c);
    const body = await readJsonBody(c);
    const goal = reorderGoal(db, c.req.param('id'), body as Parameters<typeof reorderGoal>[2], {
      now,
      actor,
    });
    emitSse('goal.reordered', 'goal', goal.id, now);
    return c.json({ goal });
  });

  app.delete('/api/goals/:id', (c) => {
    const now = getNow(c);
    const actor = getActor(c);
    const goal = deleteGoal(db, c.req.param('id'), { now, actor });
    emitSse('goal.deleted', 'goal', goal.id, now);
    return c.json({ goal });
  });

  // -------------------------------------------------------------------------
  // Projects
  // -------------------------------------------------------------------------

  app.get('/api/projects', (c) => {
    const now = getNow(c);
    const rawStatus = c.req.query('status');
    const status = rawStatus
      ? (() => {
          const parsed = projectStatusSchema.safeParse(rawStatus);
          if (!parsed.success) {
            throw new ValidationError(`Invalid project status: '${rawStatus}'`);
          }
          return parsed.data;
        })()
      : undefined;
    const includeArchived = parseOptionalBool(c.req.query('includeArchived'));
    const projects = listProjects(db, now, { status, includeArchived });
    return c.json({ projects });
  });

  app.post('/api/projects', async (c) => {
    const now = getNow(c);
    const actor = getActor(c);
    const body = await readJsonBody(c);
    const project = createProject(db, body as Parameters<typeof createProject>[1], {
      now,
      actor,
    });
    emitSse('project.created', 'project', project.id, now);
    runMeetingAutoMatch(now, actor);
    return c.json({ project }, 201);
  });

  app.get('/api/projects/:id', (c) => {
    const now = getNow(c);
    const id = c.req.param('id');
    const project = getProject(db, id, now);
    const openBlocks = listBlocks(db, { projectId: id, status: 'todo' });
    const completedBlocks = listBlocks(db, { projectId: id, status: 'done', includeCalendar: true });
    const payload: ProjectDetailResponse = { project, openBlocks, completedBlocks };
    return c.json(payload);
  });

  app.patch('/api/projects/:id', async (c) => {
    const now = getNow(c);
    const actor = getActor(c);
    const body = await readJsonBody(c);
    const project = updateProject(
      db,
      c.req.param('id'),
      body as Parameters<typeof updateProject>[2],
      { now, actor },
    );
    emitSse('project.updated', 'project', project.id, now);
    if (touchesMatching(body)) {
      runMeetingAutoMatch(now, actor);
    }
    return c.json({ project });
  });

  app.delete('/api/projects/:id', (c) => {
    const now = getNow(c);
    const actor = getActor(c);
    const project = deleteProject(db, c.req.param('id'), { now, actor });
    emitSse('project.deleted', 'project', project.id, now);
    return c.json({ project });
  });

  // -------------------------------------------------------------------------
  // Blocks
  // -------------------------------------------------------------------------

  app.get('/api/blocks', (c) => {
    const rawBucket = c.req.query('bucket');
    const bucket = rawBucket
      ? (() => {
          const p = blockBucketSchema.safeParse(rawBucket);
          if (!p.success) throw new ValidationError(`Invalid bucket: '${rawBucket}'`);
          return p.data;
        })()
      : undefined;

    const rawStatus = c.req.query('status');
    const status = rawStatus
      ? (() => {
          const p = blockStatusSchema.safeParse(rawStatus);
          if (!p.success) throw new ValidationError(`Invalid status: '${rawStatus}'`);
          return p.data;
        })()
      : undefined;

    const blocksList = listBlocks(db, {
      bucket,
      scheduledDate: c.req.query('scheduledDate'),
      projectId: c.req.query('projectId'),
      goalId: c.req.query('goalId'),
      status,
      isOps: parseOptionalBool(c.req.query('isOps')),
      dueBefore: c.req.query('dueBefore'),
      includeDropped: parseOptionalBool(c.req.query('includeDropped')),
      includeDone: parseOptionalBool(c.req.query('includeDone')),
      includeCalendar: parseOptionalBool(c.req.query('includeCalendar')),
    });
    return c.json({ blocks: blocksList });
  });

  app.post('/api/blocks', async (c) => {
    const now = getNow(c);
    const actor = getActor(c);
    const body = await readJsonBody(c);
    const block = createBlock(db, body as Parameters<typeof createBlock>[1], { now, actor });
    emitSse('block.created', 'block', block.id, now);
    return c.json({ block }, 201);
  });

  app.get('/api/blocks/:id', (c) => {
    const now = getNow(c);
    const block: BlockDetail = getBlockDetail(db, c.req.param('id'), now);
    return c.json({ block });
  });

  app.patch('/api/blocks/:id', async (c) => {
    const now = getNow(c);
    const actor = getActor(c);
    const body = await readJsonBody(c);
    const block = updateBlock(db, c.req.param('id'), body as Parameters<typeof updateBlock>[2], {
      now,
      actor,
    });
    emitSse('block.updated', 'block', block.id, now);
    return c.json({ block });
  });

  app.delete('/api/blocks/:id', (c) => {
    const now = getNow(c);
    const actor = getActor(c);
    const block = deleteBlock(db, c.req.param('id'), { now, actor });
    emitSse('block.deleted', 'block', block.id, now);
    return c.json({ block });
  });

  app.post('/api/blocks/:id/move', async (c) => {
    const now = getNow(c);
    const actor = getActor(c);
    const body = await readJsonBody(c);
    const block = moveBlock(db, c.req.param('id'), body as Parameters<typeof moveBlock>[2], {
      now,
      actor,
    });
    emitSse('block.moved', 'block', block.id, now);
    return c.json({ block });
  });

  app.post('/api/blocks/:id/reorder', async (c) => {
    const now = getNow(c);
    const actor = getActor(c);
    const body = await readJsonBody(c);
    const block = reorderBlock(db, c.req.param('id'), body as Parameters<typeof reorderBlock>[2], {
      now,
      actor,
    });
    emitSse('block.reordered', 'block', block.id, now);
    return c.json({ block });
  });

  app.post('/api/blocks/:id/park', async (c) => {
    const now = getNow(c);
    const actor = getActor(c);
    const body = await readJsonBody(c, true);
    const block = parkBlock(db, c.req.param('id'), body as Parameters<typeof parkBlock>[2], {
      now,
      actor,
    });
    emitSse('block.parked', 'block', block.id, now);
    return c.json({ block });
  });

  app.post('/api/blocks/:id/drop', async (c) => {
    const now = getNow(c);
    const actor = getActor(c);
    const raw = await readJsonBody(c, true);
    const parsed = dropBlockBodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError('Invalid drop block payload');
    }
    const block = dropBlock(db, c.req.param('id'), {
      stopSeries: parsed.data.stopSeries,
      dropReason: parsed.data.dropReason,
      now,
      actor,
    });
    emitSse('block.dropped', 'block', block.id, now);
    return c.json({ block });
  });

  app.post('/api/blocks/:id/reopen', (c) => {
    const now = getNow(c);
    const actor = getActor(c);
    const block = reopenBlock(db, c.req.param('id'), { now, actor });
    emitSse('block.reopened', 'block', block.id, now);
    return c.json({ block });
  });

  // -------------------------------------------------------------------------
  // Focus
  // -------------------------------------------------------------------------

  app.get('/api/focus', (c) => {
    const now = getNow(c);
    return c.json(getFocusStatus(db, now));
  });

  app.patch('/api/focus/start-time', async (c) => {
    const now = getNow(c);
    const actor = getActor(c);
    const raw = await readJsonBody(c);
    const parsed = focusStartTimeBodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError('startedAt (ISO-8601 timestamp with offset) is required');
    }

    const result = updateActiveFocusStartTime(db, parsed.data.startedAt, now, { actor });
    emitSse('focus.updated', 'focus_session', result.session.id, now);

    return c.json({
      ...result,
      focusStatus: getFocusStatus(db, now),
    });
  });

  app.post('/api/focus/start', async (c) => {
    const now = getNow(c);
    const actor = getActor(c);
    const raw = await readJsonBody(c);
    const parsed = focusStartBodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError('blockId (UUID) is required');
    }

    const result = startFocus(db, parsed.data.blockId, now, {
      actor,
      startedAt: parsed.data.startedAt,
    });
    emitSse('focus.started', 'focus_session', result.startedSession.id, now);

    if (result.closedSession) {
      void webhooks.emit(
        'focus.ended',
        {
          reason: 'switched',
          session: result.closedSession,
          blockId: result.closedSession.blockId,
        },
        { now },
      );
    }
    void webhooks.emit(
      'focus.started',
      {
        session: result.startedSession,
        block: result.block,
      },
      { now },
    );
    void macosFocus.onFocusStarted({
      hadActiveSession: Boolean(result.closedSession),
      now,
    });

    return c.json({
      ...result,
      focusStatus: getFocusStatus(db, now),
    });
  });

  app.post('/api/focus/resume', async (c) => {
    const now = getNow(c);
    const actor = getActor(c);
    const raw = await readJsonBody(c);
    const parsed = focusStartBodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError('blockId (UUID) is required');
    }

    const result = resumeFocus(db, parsed.data.blockId, now, { actor });
    emitSse('focus.started', 'focus_session', result.startedSession.id, now);

    if (result.closedSession) {
      void webhooks.emit(
        'focus.ended',
        {
          reason: 'switched',
          session: result.closedSession,
          blockId: result.closedSession.blockId,
        },
        { now },
      );
    }
    void webhooks.emit(
      'focus.started',
      {
        session: result.startedSession,
        block: result.block,
      },
      { now },
    );
    void macosFocus.onFocusStarted({
      hadActiveSession: Boolean(result.closedSession),
      now,
    });

    return c.json({
      ...result,
      focusStatus: getFocusStatus(db, now),
    });
  });

  app.post('/api/focus/pause', async (c) => {
    const now = getNow(c);
    const actor = getActor(c);
    const raw = await readJsonBody(c, true);
    const parsed = focusPauseBodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError('Invalid pause focus payload');
    }

    const result = pauseFocus(db, { note: parsed.data.note, endedAt: parsed.data.endedAt }, now, { actor });
    emitSse('focus.paused', 'focus_session', result.closedSession.id, now);

    void webhooks.emit(
      'focus.ended',
      {
        reason: 'paused',
        session: result.closedSession,
        block: result.block,
      },
      { now },
    );
    void macosFocus.onFocusEnded({ now });

    return c.json({
      ...result,
      focusStatus: getFocusStatus(db, now),
    });
  });

  app.post('/api/focus/gap', async (c) => {
    const now = getNow(c);
    const actor = getActor(c);
    const raw = await readJsonBody(c);
    const parsed = focusGapBodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError('gapStartAt (ISO timestamp) is required');
    }

    const result = removeActiveFocusGap(db, parsed.data, now, { actor });
    emitSse('session.gap_removed', 'focus_session', result.startedSession.id, now);

    return c.json({
      ...result,
      focusStatus: getFocusStatus(db, now),
    });
  });

  app.post('/api/focus/stop', (c) => {
    const now = getNow(c);
    const actor = getActor(c);
    const result = stopFocus(db, now, { actor });
    emitSse('focus.stopped', 'focus_session', result.closedSession.id, now);

    void webhooks.emit(
      'focus.ended',
      {
        reason: 'stopped',
        session: result.closedSession,
        block: result.block,
      },
      { now },
    );
    void macosFocus.onFocusEnded({ now });

    return c.json({
      ...result,
      focusStatus: getFocusStatus(db, now),
    });
  });

  app.post('/api/focus/cancel', (c) => {
    const now = getNow(c);
    const actor = getActor(c);
    const result = cancelFocus(db, now, { actor });
    emitSse('focus.cancelled', 'focus_session', result.closedSession.id, now);

    void webhooks.emit(
      'focus.ended',
      {
        reason: 'cancelled',
        session: result.closedSession,
        block: result.block,
      },
      { now },
    );
    void macosFocus.onFocusEnded({ now });

    return c.json({
      ...result,
      focusStatus: getFocusStatus(db, now),
    });
  });

  app.post('/api/focus/complete', async (c) => {
    const now = getNow(c);
    const actor = getActor(c);
    const raw = await readJsonBody(c, true);
    const parsed = focusCompleteBodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError('Invalid complete block payload');
    }

    const result = completeBlock(
      db,
      parsed.data.blockId,
      {
        energySignal: parsed.data.energySignal,
        senseSignal: parsed.data.senseSignal,
        outcomeNote: parsed.data.outcomeNote,
      },
      now,
      { actor },
    );
    emitSse('block.completed', 'block', result.block.id, now);

    if (result.closedSession) {
      void webhooks.emit(
        'focus.ended',
        {
          reason: 'completed',
          session: result.closedSession,
          block: result.block,
        },
        { now },
      );
      void macosFocus.onFocusEnded({ now });
    }
    void webhooks.emit(
      'block.completed',
      {
        block: result.block,
        closedSession: result.closedSession,
        currentSessionMinutes: result.currentSessionMinutes,
        totalBlockMinutes: result.totalBlockMinutes,
      },
      { now },
    );

    return c.json({
      ...result,
      focusStatus: getFocusStatus(db, now),
    });
  });

  // -------------------------------------------------------------------------
  // Focus Sessions
  // -------------------------------------------------------------------------

  app.post('/api/sessions', async (c) => {
    const now = getNow(c);
    const actor = getActor(c);
    const body = await readJsonBody(c);
    const session = logManualSession(db, body as Parameters<typeof logManualSession>[1], {
      now,
      actor,
    });
    emitSse('session.logged', 'focus_session', session.id, now);
    return c.json({ session }, 201);
  });

  app.patch('/api/sessions/:id/trim', async (c) => {
    const now = getNow(c);
    const actor = getActor(c);
    const body = await readJsonBody(c);
    const session = trimSession(
      db,
      c.req.param('id'),
      body as Parameters<typeof trimSession>[2],
      { now, actor },
    );
    emitSse('session.trimmed', 'focus_session', session.id, now);
    return c.json({ session });
  });

  app.post('/api/sessions/:id/split', async (c) => {
    const now = getNow(c);
    const actor = getActor(c);
    const body = await readJsonBody(c);
    const result = splitSession(
      db,
      c.req.param('id'),
      body as Parameters<typeof splitSession>[2],
      { now, actor },
    );
    emitSse('session.split', 'focus_session', result.firstSession.id, now);
    return c.json(result);
  });

  app.delete('/api/sessions/:id', (c) => {
    const now = getNow(c);
    const actor = getActor(c);
    const session = deleteSession(db, c.req.param('id'), { now, actor });
    emitSse('session.deleted', 'focus_session', session.id, now);
    return c.json({ session });
  });

  // -------------------------------------------------------------------------
  // Daily Notes
  // -------------------------------------------------------------------------

  app.get('/api/notes', (c) => {
    const notes: DailyNote[] = listDailyNotes(db, {
      date: c.req.query('date'),
      weekStartDate: c.req.query('weekStartDate') ?? c.req.query('weekStart'),
      projectId: c.req.query('projectId'),
      goalId: c.req.query('goalId'),
      tag: c.req.query('tag'),
    });
    return c.json({ notes });
  });

  app.get('/api/notes/tags', (c) => {
    return c.json({ tags: listNoteTags(db) });
  });

  app.post('/api/notes', async (c) => {
    const now = getNow(c);
    const actor = getActor(c);
    const body = await readJsonBody(c);
    const note = addDailyNote(db, body as Parameters<typeof addDailyNote>[1], now, { actor });
    emitSse('daily_note.created', 'daily_note', note.id, now);
    return c.json({ note }, 201);
  });

  app.patch('/api/notes/:id', async (c) => {
    const now = getNow(c);
    const actor = getActor(c);
    const body = await readJsonBody(c);
    const note = updateDailyNote(
      db,
      c.req.param('id'),
      body as Parameters<typeof updateDailyNote>[2],
      { now, actor },
    );
    emitSse('daily_note.updated', 'daily_note', note.id, now);
    return c.json({ note });
  });

  app.delete('/api/notes/:id', (c) => {
    const now = getNow(c);
    const actor = getActor(c);
    const note = deleteDailyNote(db, c.req.param('id'), { now, actor });
    emitSse('daily_note.deleted', 'daily_note', note.id, now);
    return c.json({ note });
  });

  // -------------------------------------------------------------------------
  // Weekly Review
  // -------------------------------------------------------------------------

  app.get('/api/review', (c) => {
    const now = getNow(c);
    runDailyRolloverAndRecurrence(db, now);

    const rawWeek = c.req.query('week');
    const rawWeekStart = c.req.query('weekStart');
    let weekStart = rawWeekStart;

    if (rawWeek !== undefined) {
      if (!/^\d+$/.test(rawWeek.trim())) {
        throw new ValidationError(`Invalid week parameter: '${rawWeek}' (expected integer 1-53)`);
      }
      const weekNum = Number.parseInt(rawWeek.trim(), 10);
      const settings = getSettings(db);
      const today = formatLocalDate(now, settings.timezone);
      weekStart = resolveIsoWeekStartDate(weekNum, today);
    }

    const summary = getWeeklyReview(db, weekStart, now);

    const referencedProjectIds = new Set<string>();
    for (const bucketItems of [
      summary.projectBuckets.moreThanPlanned,
      summary.projectBuckets.lessThanPlanned,
      summary.projectBuckets.wantedUntouched,
      summary.projectBuckets.timeWithoutPlan,
      summary.projectBuckets.onTrack,
    ]) {
      for (const item of bucketItems) {
        referencedProjectIds.add(item.projectId);
      }
    }
    for (const item of summary.progressFeed) {
      if (item.projectId) referencedProjectIds.add(item.projectId);
    }
    for (const blk of summary.worthSecondLook) {
      referencedProjectIds.add(blk.projectId);
    }
    for (const item of summary.opsRadar.items) {
      referencedProjectIds.add(item.projectId);
    }
    for (const note of summary.dailyNotes) {
      if (note.projectId) referencedProjectIds.add(note.projectId);
    }
    for (const blk of summary.chronicCarryovers) {
      referencedProjectIds.add(blk.projectId);
    }
    for (const blk of summary.pastRevisitLater) {
      referencedProjectIds.add(blk.projectId);
    }

    const allProjects = listProjects(db, now, { includeArchived: true });
    const projects = allProjects.filter(
      (p) => p.status !== 'archived' || referencedProjectIds.has(p.id),
    );

    const referencedGoalIds = new Set<string>();
    for (const item of summary.progressFeed) {
      if (item.goalId) referencedGoalIds.add(item.goalId);
    }
    for (const note of summary.dailyNotes) {
      if (note.goalId) referencedGoalIds.add(note.goalId);
    }
    for (const item of summary.opsRadar.items) {
      if (item.goalId) referencedGoalIds.add(item.goalId);
    }
    for (const blk of summary.chronicCarryovers) {
      if (blk.goalId) referencedGoalIds.add(blk.goalId);
    }
    for (const blk of summary.pastRevisitLater) {
      if (blk.goalId) referencedGoalIds.add(blk.goalId);
    }

    const weekStartIso = getLocalDayBoundsIso(summary.weekStartDate, summary.timezone).startIso;
    const weekEndIso = getLocalDayBoundsIso(summary.weekEndDate, summary.timezone).endIso;
    const weekSessions = listSessions(db, { startIso: weekStartIso, endIso: weekEndIso });
    if (weekSessions.length > 0) {
      const weekSessionBlockIds = new Set(weekSessions.map((s) => s.blockId));
      for (const blk of listBlocks(db, { includeCalendar: true })) {
        if (blk.goalId && weekSessionBlockIds.has(blk.id)) {
          referencedGoalIds.add(blk.goalId);
        }
      }
    }

    const allGoals = listGoals(db, { includeArchived: true }, now);
    const goals = allGoals.filter((g) => g.status === 'active' || referencedGoalIds.has(g.id));

    const payload: ReviewResponse = {
      ...summary,
      projects,
      goals,
    };
    return c.json(payload);
  });

  app.put('/api/review/rule', async (c) => {
    const now = getNow(c);
    const actor = getActor(c);
    const raw = await readJsonBody(c);
    const parsed = setWeeklyRuleBodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      );
    }

    if (
      parsed.data.ruleForNextWeek === undefined &&
      parsed.data.previousRuleKept === undefined
    ) {
      throw new ValidationError('Either ruleForNextWeek or previousRuleKept is required');
    }

    const settings = getSettings(db);
    const today = formatLocalDate(now, settings.timezone);
    const weekStartDate = parsed.data.weekStartDate ?? getWeekRange(today).weekStartDate;

    if (parsed.data.ruleForNextWeek === undefined) {
      const review = setPreviousRuleKept(db, weekStartDate, parsed.data.previousRuleKept ?? null, {
        now,
        actor,
      });
      emitSse('weekly_review.rule_kept_set', 'weekly_review', review.id, now);
      return c.json({ review });
    }

    const review = setWeeklyRule(db, weekStartDate, parsed.data.ruleForNextWeek, {
      notes: parsed.data.notes,
      previousRuleKept: parsed.data.previousRuleKept,
      now,
      actor,
    });
    emitSse('weekly_review.rule_set', 'weekly_review', review.id, now);
    return c.json({ review });
  });

  app.post('/api/review/complete', async (c) => {
    const now = getNow(c);
    const actor = getActor(c);
    const raw = await readJsonBody(c);
    const parsed = completeWeeklyReviewBodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      );
    }

    const settings = getSettings(db);
    const today = formatLocalDate(now, settings.timezone);
    const weekStartDate =
      parsed.data.weekStartDate ??
      (parsed.data.week !== undefined
        ? resolveIsoWeekStartDate(parsed.data.week, today)
        : undefined);

    const result = completeWeeklyReview(
      db,
      {
        weekStartDate,
        ruleForNextWeek: parsed.data.ruleForNextWeek,
        previousRuleKept: parsed.data.previousRuleKept,
        notes: parsed.data.notes,
        projectWeeklyTimes: parsed.data.projectWeeklyTimes,
      },
      { now, actor },
    );

    emitSse('review.completed', 'weekly_review', result.review.id, now);
    void webhooks.emit(
      'review.completed',
      {
        weekStartDate: result.review.weekStartDate,
        weekNumber: result.snapshot.weekNumber,
        ruleForNextWeek: result.review.ruleForNextWeek,
        snapshot: result.snapshot,
        review: result.review,
      },
      { now },
    );

    return c.json(result);
  });

  app.post('/api/review/reopen', async (c) => {
    const now = getNow(c);
    const actor = getActor(c);
    const raw = await readJsonBody(c, true);
    const parsed = reopenWeeklyReviewBodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      );
    }

    const settings = getSettings(db);
    const today = formatLocalDate(now, settings.timezone);
    const weekStartDate =
      parsed.data.weekStartDate ??
      (parsed.data.week !== undefined
        ? resolveIsoWeekStartDate(parsed.data.week, today)
        : getWeekRange(today).weekStartDate);

    const review = reopenWeeklyReview(db, weekStartDate, { now, actor });
    emitSse('weekly_review.reopened', 'weekly_review', review.id, now);
    return c.json({ review });
  });

  // -------------------------------------------------------------------------
  // Calendar Events
  // -------------------------------------------------------------------------

  app.get('/api/events', (c) => {
    const now = getNow(c);
    const settings = getSettings(db);
    const timezone = settings.timezone;
    const today = formatLocalDate(now, timezone);
    const defaultWeek = getWeekRange(today);

    const rawStart = c.req.query('start') ?? defaultWeek.weekStartDate;
    const rawEnd = c.req.query('end') ?? defaultWeek.weekEndDate;

    const startIso = parseDateOrIsoToRangeBound(rawStart, timezone, 'start');
    const endIso = parseDateOrIsoToRangeBound(rawEnd, timezone, 'end');
    const events = listCalendarEvents(db, startIso, endIso);
    return c.json({ events });
  });

  app.post('/api/events/upsert', async (c) => {
    const now = getNow(c);
    const actor = getActor(c);
    const raw = await readJsonBody(c);
    const parsed = upsertEventsBodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      );
    }

    const result = upsertCalendarEvents(
      db,
      parsed.data.source,
      parsed.data.events as NormalizedCalendarEvent[],
      { now, actor },
    );
    emitSse('events.synced', 'calendar_event', undefined, now);
    return c.json(result);
  });

  app.post('/api/events/sync', async (c) => {
    const now = getNow(c);
    const runResult = await syncRunner.syncNow(now);
    runMeetingAutoMatch(now, getActor(c));
    const { status, error, ...counts } = runResult;
    const payload: SyncEventsResponse = {
      status,
      result: counts,
      ...(error ? { error } : {}),
    };
    return c.json(payload);
  });

  app.post('/api/events/auto-match', (c) => {
    const now = getNow(c);
    const result = runMeetingAutoMatch(now, getActor(c));
    return c.json(result);
  });

  app.patch('/api/events/:id', async (c) => {
    const now = getNow(c);
    const actor = getActor(c);
    const body = await readJsonBody(c);
    const event = updateCalendarEvent(
      db,
      c.req.param('id'),
      body as Parameters<typeof updateCalendarEvent>[2],
      { now, actor },
    );
    emitSse('calendar_event.updated', 'calendar_event', event.id, now);
    return c.json({ event });
  });

  // -------------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------------

  app.get('/api/settings', (c) => {
    return c.json(buildSettingsResponse(getSettings(db)));
  });

  app.patch('/api/settings', async (c) => {
    const now = getNow(c);
    const actor = getActor(c);
    const prev = getSettings(db);
    const body = await readJsonBody(c);
    const updated = updateSettings(db, body as Parameters<typeof updateSettings>[1], {
      now,
      actor,
    });

    const syncConfigChanged =
      updated.calendarSyncMode !== prev.calendarSyncMode ||
      updated.outlookCliCommand !== prev.outlookCliCommand ||
      updated.icsFeedUrl !== prev.icsFeedUrl ||
      updated.calendarSyncIntervalMin !== prev.calendarSyncIntervalMin;

    if (syncConfigChanged) {
      syncRunner.restartPolling();
    }

    emitSse('settings.updated', 'settings', updated.id, now);
    return c.json(buildSettingsResponse(updated));
  });

  app.post('/api/settings/test-hook', async (c) => {
    const now = getNow(c);
    const result = await webhooks.sendTestHook({ now });
    const payload: TestHookResponse = { result };
    return c.json(payload);
  });

  // -------------------------------------------------------------------------
  // Integrations: Notion Search Proxy & Connection Test
  // -------------------------------------------------------------------------

  app.get('/api/integrations/notion/search', async (c) => {
    const q = c.req.query('q') ?? '';
    const rawLimit = c.req.query('limit');
    let limit: number | undefined;
    if (rawLimit !== undefined) {
      const parsed = Number.parseInt(rawLimit, 10);
      if (Number.isNaN(parsed) || parsed < 1 || parsed > 50) {
        throw new ValidationError('limit must be an integer between 1 and 50');
      }
      limit = parsed;
    }

    const result = await notion.search(q, { limit });
    return c.json(result);
  });

  app.post('/api/integrations/notion/test', async (c) => {
    const raw = await readJsonBody(c, true);
    const parsed = notionTestBodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError('Invalid Notion connection test payload');
    }
    const result = await notion.testConnection(parsed.data.token);
    const payload: NotionTestResponse = { result };
    return c.json(payload);
  });

  app.post('/api/integrations/notion/oauth/start', async (c) => {
    const now = getNow(c);
    const actor = getActor(c);
    const raw = await readJsonBody(c, true);
    const parsed = notionOAuthStartBodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError('Invalid Notion OAuth start payload');
    }

    const patch: Parameters<typeof updateSettings>[1] = {};
    if (parsed.data.clientId !== undefined && parsed.data.clientId.trim()) {
      patch.notionOauthClientId = parsed.data.clientId.trim();
    }
    if (parsed.data.clientSecret !== undefined && parsed.data.clientSecret.trim()) {
      patch.notionOauthClientSecret = parsed.data.clientSecret.trim();
    }
    if (parsed.data.redirectUri !== undefined) {
      patch.notionOauthRedirectUri = parsed.data.redirectUri.trim() || null;
    }
    if (Object.keys(patch).length > 0) {
      updateSettings(db, patch, { now, actor });
      emitSse('settings.updated', 'settings', 'default', now);
    }

    const creds = notion.resolveOAuthCredentials();
    if (!creds.clientId || !creds.clientSecret) {
      throw new ValidationError(
        'Enter both your Notion OAuth Client ID and Client Secret first',
      );
    }

    const reqOrigin = new URL(c.req.url).origin;
    const redirectUri =
      creds.redirectUri || `${reqOrigin}/api/integrations/notion/oauth/callback`;
    try {
      const parsedRedirect = new URL(redirectUri);
      if (parsedRedirect.protocol !== 'http:' && parsedRedirect.protocol !== 'https:') {
        throw new Error('Invalid protocol');
      }
    } catch {
      throw new ValidationError('Redirect URI must be a valid http:// or https:// URL');
    }

    // Purge expired states before issuing a new CSRF state token
    const nowMs = Date.now();
    for (const [k, v] of pendingNotionOAuthStates.entries()) {
      if (v.expiresAt <= nowMs) pendingNotionOAuthStates.delete(k);
    }

    const state = crypto.randomBytes(24).toString('hex');
    pendingNotionOAuthStates.set(state, {
      redirectUri,
      expiresAt: nowMs + NOTION_OAUTH_STATE_TTL_MS,
    });

    const authorizeUrl = notion.buildOAuthAuthorizeUrl({
      clientId: creds.clientId,
      redirectUri,
      state,
    });

    const payload: NotionOAuthStartResponse = { authorizeUrl, redirectUri };
    return c.json(payload);
  });

  app.get('/api/integrations/notion/oauth/callback', async (c) => {
    const now = getNow(c);
    const errorParam = c.req.query('error');
    const code = c.req.query('code')?.trim();
    const state = c.req.query('state')?.trim();

    if (errorParam) {
      return c.html(
        renderNotionOAuthCallbackHtml({
          ok: false,
          title: 'Notion authorization cancelled',
          detail: `Notion returned: ${errorParam}`,
        }),
        400,
      );
    }

    if (!state || !pendingNotionOAuthStates.has(state)) {
      return c.html(
        renderNotionOAuthCallbackHtml({
          ok: false,
          title: 'Invalid or expired OAuth state',
          detail: 'Start the Notion connection again from Veyra Settings -> Integrations.',
        }),
        400,
      );
    }

    const pending = pendingNotionOAuthStates.get(state)!;
    pendingNotionOAuthStates.delete(state);
    if (pending.expiresAt <= Date.now()) {
      return c.html(
        renderNotionOAuthCallbackHtml({
          ok: false,
          title: 'OAuth session expired',
          detail: 'Start the Notion connection again from Veyra Settings -> Integrations.',
        }),
        400,
      );
    }

    if (!code) {
      return c.html(
        renderNotionOAuthCallbackHtml({
          ok: false,
          title: 'Missing authorization code',
          detail: 'Notion did not provide an authorization code.',
        }),
        400,
      );
    }

    try {
      const exchanged = await notion.exchangeOAuthCode({
        code,
        redirectUri: pending.redirectUri,
        now,
      });
      emitSse('settings.updated', 'settings', 'default', now);
      const target = exchanged.workspaceName
        ? `Connected to Notion workspace "${exchanged.workspaceName}".`
        : 'Your Notion account is now connected to Veyra.';
      return c.html(
        renderNotionOAuthCallbackHtml({
          ok: true,
          title: 'Connected to Notion',
          detail: `${target} Inline Notion search is ready in Veyra.`,
        }),
      );
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to exchange Notion authorization code';
      return c.html(
        renderNotionOAuthCallbackHtml({
          ok: false,
          title: 'Notion connection failed',
          detail: msg,
        }),
        502,
      );
    }
  });

  // -------------------------------------------------------------------------
  // Integrations: macOS Focus Mode Presence (Shortcuts CLI)
  // -------------------------------------------------------------------------

  app.get('/api/integrations/macos-focus/shortcuts', async (c) => {
    const payload: MacOsFocusShortcutsResponse = await macosFocus.listInstalledShortcuts();
    return c.json(payload);
  });

  app.post('/api/integrations/macos-focus/test', async (c) => {
    const now = getNow(c);
    const raw = await readJsonBody(c);
    const parsed = macOsFocusTestBodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError("phase ('start' | 'end') is required");
    }
    const result = await macosFocus.testShortcut(
      parsed.data.phase,
      parsed.data.shortcutName,
      now,
    );
    const payload: MacOsFocusTestResponse = { result };
    return c.json(payload);
  });

  // -------------------------------------------------------------------------
  // Activity Log
  // -------------------------------------------------------------------------

  app.get('/api/activity', (c) => {
    const rawLimit = c.req.query('limit');
    let limit: number | undefined;
    if (rawLimit !== undefined) {
      const parsed = Number.parseInt(rawLimit, 10);
      if (Number.isNaN(parsed) || parsed < 1 || parsed > 1000) {
        throw new ValidationError('limit must be an integer between 1 and 1000');
      }
      limit = parsed;
    }

    const rawActor = c.req.query('actor');
    const actor = rawActor
      ? (() => {
          const parsed = activityActorSchema.safeParse(rawActor);
          if (!parsed.success) {
            throw new ValidationError(`Invalid actor filter: '${rawActor}'`);
          }
          return parsed.data;
        })()
      : undefined;

    const activity: ActivityLog[] = listActivity(db, {
      limit,
      actor,
      action: c.req.query('action'),
    });
    return c.json({ activity });
  });

  // -------------------------------------------------------------------------
  // Static Web UI + SPA Fallback (non-/api/* routes)
  // -------------------------------------------------------------------------

  if (webDistDir && fs.existsSync(webDistDir)) {
    const resolvedWebDir = path.resolve(webDistDir);
    const indexHtmlPath = path.join(resolvedWebDir, 'index.html');

    app.get('*', async (c, next) => {
      if (c.req.path === '/api' || c.req.path.startsWith('/api/')) {
        await next();
        return;
      }

      const filePath = resolveStaticFile(resolvedWebDir, c.req.path);
      if (filePath) {
        const content = await fs.promises.readFile(filePath);
        return new Response(content, {
          status: 200,
          headers: { 'Content-Type': getMimeType(filePath) },
        });
      }

      if (fs.existsSync(indexHtmlPath)) {
        const html = await fs.promises.readFile(indexHtmlPath);
        return new Response(html, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }

      await next();
    });
  }

  app.notFound((c) => {
    return c.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: `Route not found: ${c.req.method} ${c.req.path}`,
        },
      },
      404,
    );
  });

  // -------------------------------------------------------------------------
  // Lifecycle: HTTP server, Midnight Rollover Watcher, Sync Polling
  // -------------------------------------------------------------------------

  let httpServer: ServerType | null = null;
  let rolloverTimer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  const startRolloverWatcher = () => {
    if (rolloverTimer !== null) return;
    let lastObservedDate = formatLocalDate(new Date(), getSettings(db).timezone);
    rolloverTimer = setInterval(() => {
      try {
        const now = new Date();
        const tz = getSettings(db).timezone;
        const currentDate = formatLocalDate(now, tz);
        if (currentDate !== lastObservedDate) {
          lastObservedDate = currentDate;
          runDailyRolloverAndRecurrence(db, now);
          emitSse('rollover.completed', 'block', undefined, now);
        }
      } catch {
        // Ignore transient watcher errors during shutdown
      }
    }, rolloverCheckIntervalMs);
    rolloverTimer.unref();
  };

  const stopRolloverWatcher = () => {
    if (rolloverTimer !== null) {
      clearInterval(rolloverTimer);
      rolloverTimer = null;
    }
  };

  const start = async (): Promise<{ port: number; host: string; url: string }> => {
    if (httpServer) {
      const addr = httpServer.address();
      const boundPort = addr && typeof addr !== 'string' ? addr.port : port;
      return { port: boundPort, host, url: `http://${host}:${boundPort}` };
    }

    stopped = false;
    runDailyRolloverAndRecurrence(db, new Date());
    startRolloverWatcher();
    syncRunner.startPolling();

    return new Promise((resolve, reject) => {
      const srv = serve(
        {
          fetch: app.fetch,
          port,
          hostname: host,
        },
        (info) => {
          httpServer = srv;
          resolve({
            port: info.port,
            host,
            url: `http://${host}:${info.port}`,
          });
        },
      );

      srv.on('error', (err) => {
        stopRolloverWatcher();
        syncRunner.stopPolling();
        reject(err);
      });
    });
  };

  const stop = async (): Promise<void> => {
    if (stopped) {
      return;
    }
    stopped = true;

    stopRolloverWatcher();
    syncRunner.stopPolling();
    sseHub.closeAll();

    if (httpServer) {
      const srv = httpServer as http.Server;
      httpServer = null;
      await new Promise<void>((resolve) => {
        srv.close(() => resolve());
        if (typeof srv.closeAllConnections === 'function') {
          srv.closeAllConnections();
        }
      });
    }

    db.close();
  };

  return {
    app,
    db,
    syncRunner,
    webhooks,
    notion,
    macosFocus,
    sseHub,
    start,
    stop,
  };
}
