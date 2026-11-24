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
  type FocusSession,
  type FocusStatus,
  type Goal,
  type NormalizedCalendarEvent,
  type NotionTestConnectionResult,
  type ProjectWithStats,
  type PublicSettings,
  type Settings,
  ValidationError,
  VeyraError,
  type VeyraDb,
  type WeeklyReviewSummary,
  activityActorSchema,
  addDailyNote,
  addDaysToDateString,
  blockBucketSchema,
  blockStatusSchema,
  calendarEventSourceSchema,
  completeBlock,
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
  formatLocalDate,
  getActiveWeeklyRule,
  getBlockDetail,
  getFocusStatus,
  getLocalDayBoundsIso,
  getProject,
  getSettings,
  getWeekRange,
  getWeeklyReview,
  goalStatusSchema,
  listActivity,
  listBlocks,
  listCalendarEvents,
  listDailyNotes,
  listGoals,
  listProjects,
  listSessions,
  logManualSession,
  moveBlock,
  normalizedCalendarEventSchema,
  openVeyraDb,
  parkBlock,
  pauseFocus,
  projectStatusSchema,
  reopenBlock,
  reorderBlock,
  resumeFocus,
  runDailyRolloverAndRecurrence,
  setWeeklyRule,
  splitSession,
  startFocus,
  stopFocus,
  toPublicSettings,
  trimSession,
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
}

export interface VeyraServerInstance {
  app: Hono;
  db: VeyraDb;
  syncRunner: CalendarSyncRunner;
  webhooks: WebhookDispatcher;
  notion: NotionClient;
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
  dailyNotesCount: number;
  projects: ProjectWithStats[];
  goals: Goal[];
}

export interface PlanDayBucket {
  date: string;
  blocks: Block[];
  events: CalendarEvent[];
}

export interface PlanResponse {
  weekStartDate: string;
  weekEndDate: string;
  today: string;
  timezone: string;
  days: PlanDayBucket[];
  inbox: Block[];
  later: Block[];
  projects: ProjectWithStats[];
  goals: Goal[];
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
  goals: Goal[];
}

export interface ProjectDetailResponse {
  project: ProjectWithStats;
  openBlocks: Block[];
  completedBlocks: Block[];
}

export interface ReviewResponse extends WeeklyReviewSummary {
  projects: ProjectWithStats[];
  goals: Goal[];
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

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const focusStartBodySchema = z.object({
  blockId: z.string().uuid(),
});

const focusPauseBodySchema = z.object({
  note: z.string().nullable().optional(),
});

const focusCompleteBodySchema = z.object({
  blockId: z.string().uuid().optional(),
  energySignal: z.enum(['up', 'neutral', 'down']).nullable().optional(),
  outcomeNote: z.string().nullable().optional(),
});

const dropBlockBodySchema = z.object({
  stopSeries: z.boolean().optional(),
});

const setWeeklyRuleBodySchema = z.object({
  weekStartDate: dateOnlySchema.optional(),
  ruleForNextWeek: z.string(),
  notes: z.string().optional(),
});

const upsertEventsBodySchema = z.object({
  source: calendarEventSourceSchema.optional().default('manual'),
  events: z.array(normalizedCalendarEventSchema),
});

const notionTestBodySchema = z.object({
  token: z.string().optional(),
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

  const notion = new NotionClient(db, {
    ...options.notionOptions,
    envToken: envNotionToken,
  });

  const buildSettingsResponse = (row: Settings): SettingsResponse => {
    const publicSettings = toPublicSettings(row, envNotionToken);
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

  // Bearer token auth middleware for /api/* (except /api/health and CORS preflight)
  if (bearerToken) {
    app.use('/api/*', async (c, next) => {
      if (c.req.method === 'OPTIONS' || c.req.path === '/api/health') {
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
    const upNext = listBlocks(db, {
      bucket: 'scheduled',
      scheduledDate: date,
      status: 'todo',
    });

    const todaySessions = listSessions(db, { startIso, endIso });
    const sessionBlockIdsToday = new Set(todaySessions.map((s) => s.blockId));

    const completedToday = listBlocks(db, { status: 'done' })
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
    const goals = listGoals(db, { includeArchived: false });

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
      dailyNotesCount: notesToday.length,
      projects,
      goals,
    };

    return c.json(payload);
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

    const days: PlanDayBucket[] = [];
    for (let offset = 0; offset < 7; offset++) {
      const date = addDaysToDateString(weekStartDate, offset);
      const { startIso, endIso } = getLocalDayBoundsIso(date, timezone);
      const dayBlocks = listBlocks(db, {
        bucket: 'scheduled',
        scheduledDate: date,
        includeDropped: false,
      });
      const dayEvents = listCalendarEvents(db, startIso, endIso);
      days.push({ date, blocks: dayBlocks, events: dayEvents });
    }

    const inbox = listBlocks(db, { bucket: 'inbox', status: 'todo' });
    const later = listBlocks(db, { bucket: 'later', status: 'todo' });
    const projects = listProjects(db, now, { includeArchived: false });
    const goals = listGoals(db, { includeArchived: false });

    const payload: PlanResponse = {
      weekStartDate,
      weekEndDate,
      today,
      timezone,
      days,
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

    const allBlocks = listBlocks(db);
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
        if (blk.status === 'dropped' || !blk.plannedStartAt || !blk.plannedEndAt) {
          return false;
        }
        const pStart = Date.parse(blk.plannedStartAt);
        const pEnd = Date.parse(blk.plannedEndAt);
        return pStart < rangeEndMs && pEnd > rangeStartMs;
      })
      .sort((a, b) => (a.plannedStartAt ?? '').localeCompare(b.plannedStartAt ?? ''));

    const events = listCalendarEvents(db, rangeStartIso, rangeEndIso);
    const projects = listProjects(db, now, { includeArchived: false });
    const goals = listGoals(db, { includeArchived: false });

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
    const includeArchived = parseOptionalBool(c.req.query('includeArchived'));
    const goals = listGoals(db, { status, includeArchived });
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
    const completedBlocks = listBlocks(db, { projectId: id, status: 'done' });
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

  app.post('/api/focus/start', async (c) => {
    const now = getNow(c);
    const actor = getActor(c);
    const raw = await readJsonBody(c);
    const parsed = focusStartBodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError('blockId (UUID) is required');
    }

    const result = startFocus(db, parsed.data.blockId, now, { actor });
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

    const result = pauseFocus(db, { note: parsed.data.note }, now, { actor });
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
    });
    return c.json({ notes });
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

    const weekStart = c.req.query('weekStart');
    const summary = getWeeklyReview(db, weekStart, now);
    const projects = listProjects(db, now, { includeArchived: false });
    const goals = listGoals(db, { includeArchived: false });

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

    const settings = getSettings(db);
    const today = formatLocalDate(now, settings.timezone);
    const weekStartDate = parsed.data.weekStartDate ?? getWeekRange(today).weekStartDate;

    const review = setWeeklyRule(db, weekStartDate, parsed.data.ruleForNextWeek, {
      notes: parsed.data.notes,
      now,
      actor,
    });
    emitSse('weekly_review.rule_set', 'weekly_review', review.id, now);
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
    sseHub,
    start,
    stop,
  };
}
