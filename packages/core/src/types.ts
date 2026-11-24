import { z } from 'zod';

export const SYSTEM_OTHER_PROJECT_ID = '00000000-0000-4000-8000-000000000001';
export const DEFAULT_SETTINGS_ID = 'default';
export const DEFAULT_GLOBAL_CAPTURE_SHORTCUT = 'CommandOrControl+Shift+P';
export const DEFAULT_PROJECT_COLOR = '#6E7280';
export const DEFAULT_GOAL_COLOR = '#3B4BD8';

export const WEEKDAY_TOKENS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export const weekdayTokenSchema = z.enum(WEEKDAY_TOKENS);
export type WeekdayToken = z.infer<typeof weekdayTokenSchema>;

export const PROJECT_ICON_KEYS = [
  'Rocket',
  'Layers',
  'Cpu',
  'Briefcase',
  'Globe',
  'Shield',
  'Code',
  'Sparkles',
] as const;
export const projectIconKeySchema = z.enum(PROJECT_ICON_KEYS);
export type ProjectIconKey = z.infer<typeof projectIconKeySchema>;

export const PROJECT_ACCENT_COLORS = [
  '#3B4BD8', // Indigo
  '#2E9E6F', // Emerald
  '#D9772B', // Amber
  '#C94A6A', // Rose
  '#2A8FBD', // Cyan
  '#8B5CF6', // Violet
  '#C49B2A', // Gold
  '#6E7280', // Neutral Slate
] as const;

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateOnly(value: string): boolean {
  if (!DATE_ONLY_REGEX.test(value)) {
    return false;
  }
  const [yearStr, monthStr, dayStr] = value.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export const dateOnlySchema = z
  .string()
  .refine(isValidDateOnly, { message: 'Expected a valid YYYY-MM-DD calendar date' });
export type DateOnly = z.infer<typeof dateOnlySchema>;

export const isoTimestampSchema = z.string().datetime({ offset: true });
export type IsoTimestamp = z.infer<typeof isoTimestampSchema>;

const DAYS_RECURRENCE_REGEX = /^days:\[([a-z,]+)\]$/;
const VALID_WEEKDAY_SET = new Set<string>(WEEKDAY_TOKENS);

export function isValidRecurrenceRule(value: string): boolean {
  if (value === 'weekdays' || value === 'weekly') {
    return true;
  }
  const match = DAYS_RECURRENCE_REGEX.exec(value);
  if (!match) {
    return false;
  }
  const tokens = match[1].split(',');
  if (tokens.length === 0) {
    return false;
  }
  const seen = new Set<string>();
  for (const token of tokens) {
    if (!VALID_WEEKDAY_SET.has(token) || seen.has(token)) {
      return false;
    }
    seen.add(token);
  }
  return true;
}

export const recurrenceRuleSchema = z.string().refine(isValidRecurrenceRule, {
  message: "Expected 'weekdays', 'weekly', or 'days:[mon,wed,fri]' with valid 3-letter weekday tokens",
});
export type RecurrenceRule = z.infer<typeof recurrenceRuleSchema>;

export const revisitPresetSchema = z.enum(['next-week', '2w', 'next-month', 'next-quarter']);
export type RevisitPreset = z.infer<typeof revisitPresetSchema>;

export const revisitHorizonSchema = z.union([revisitPresetSchema, dateOnlySchema]);
export type RevisitHorizon = z.infer<typeof revisitHorizonSchema>;

export const goalStatusSchema = z.enum(['active', 'achieved', 'archived']);
export type GoalStatus = z.infer<typeof goalStatusSchema>;

export const projectStatusSchema = z.enum(['active', 'paused', 'archived']);
export type ProjectStatus = z.infer<typeof projectStatusSchema>;

export const blockBucketSchema = z.enum(['inbox', 'scheduled', 'later']);
export type BlockBucket = z.infer<typeof blockBucketSchema>;

export const blockStatusSchema = z.enum(['todo', 'done', 'dropped']);
export type BlockStatus = z.infer<typeof blockStatusSchema>;

export const energySignalSchema = z.enum(['up', 'neutral', 'down']);
export type EnergySignal = z.infer<typeof energySignalSchema>;

export const calendarEventSourceSchema = z.enum(['outlook_cli', 'ics', 'manual']);
export type CalendarEventSource = z.infer<typeof calendarEventSourceSchema>;

export const calendarSyncModeSchema = z.enum(['outlook_cli', 'ics', 'manual']);
export type CalendarSyncMode = z.infer<typeof calendarSyncModeSchema>;

export const webhookEventNameSchema = z.enum([
  'focus.started',
  'focus.ended',
  'block.completed',
]);
export type WebhookEventName = z.infer<typeof webhookEventNameSchema>;

export const activityActorSchema = z.enum(['user', 'cli', 'agent', 'hook']);
export type ActivityActor = z.infer<typeof activityActorSchema>;

export const themeModeSchema = z.enum(['dark']);
export type ThemeMode = z.infer<typeof themeModeSchema>;

export const externalLinkSchema = z.object({
  url: z.string().url(),
  title: z.string().min(1),
  source: z.string().min(1).default('url'),
});
export type ExternalLink = z.infer<typeof externalLinkSchema>;

// ---------------------------------------------------------------------------
// Core Entities (verbatim spec shapes)
// ---------------------------------------------------------------------------

export const goalSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string(),
  color: z.string().min(1),
  status: goalStatusSchema,
  orderKey: z.string().min(1),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});
export type Goal = z.infer<typeof goalSchema>;

export const projectSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string(),
  color: z.string().min(1),
  icon: z.string().nullable(),
  defaultGoalId: z.string().uuid().nullable(),
  isPinned: z.boolean(),
  isSystem: z.boolean(),
  status: projectStatusSchema,
  notionUrl: z.string().url().nullable(),
  matchKeywords: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});
export type Project = z.infer<typeof projectSchema>;

export const blockSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  goalId: z.string().uuid().nullable(),
  title: z.string().min(1),
  isOps: z.boolean(),
  bucket: blockBucketSchema,
  scheduledDate: dateOnlySchema.nullable(),
  plannedStartAt: z.string().nullable(),
  plannedEndAt: z.string().nullable(),
  dueDate: dateOnlySchema.nullable(),
  revisitAt: dateOnlySchema.nullable(),
  orderKey: z.string().min(1),
  status: blockStatusSchema,
  carryoverCount: z.number().int().min(0),
  energySignal: energySignalSchema.nullable(),
  outcomeNote: z.string().nullable(),
  resumeNote: z.string().nullable(),
  autoSummary: z.string().nullable(),
  recurrenceRule: recurrenceRuleSchema.nullable(),
  seriesId: z.string().nullable(),
  notes: z.string(),
  externalLinks: z.array(externalLinkSchema),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});
export type Block = z.infer<typeof blockSchema>;

export const focusSessionSchema = z.object({
  id: z.string().uuid(),
  blockId: z.string().uuid(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  note: z.string().nullable(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});
export type FocusSession = z.infer<typeof focusSessionSchema>;

export const calendarEventSchema = z.object({
  id: z.string().uuid(),
  externalId: z.string().min(1),
  title: z.string().min(1),
  startAt: z.string(),
  endAt: z.string(),
  meetingUrl: z.string().nullable(),
  source: calendarEventSourceSchema,
  projectId: z.string().uuid().nullable(),
  goalId: z.string().uuid().nullable(),
  isOps: z.boolean(),
  notes: z.string(),
  externalLinks: z.array(externalLinkSchema),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});
export type CalendarEvent = z.infer<typeof calendarEventSchema>;

export const dailyNoteSchema = z.object({
  id: z.string().uuid(),
  date: dateOnlySchema,
  content: z.string().min(1),
  projectId: z.string().uuid().nullable(),
  goalId: z.string().uuid().nullable(),
  isOps: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});
export type DailyNote = z.infer<typeof dailyNoteSchema>;

export const weeklyReviewSchema = z.object({
  id: z.string().uuid(),
  weekStartDate: dateOnlySchema,
  ruleForNextWeek: z.string(),
  notes: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});
export type WeeklyReview = z.infer<typeof weeklyReviewSchema>;

export const notionTokenSourceSchema = z.enum(['settings', 'env']);
export type NotionTokenSource = z.infer<typeof notionTokenSourceSchema>;

export const settingsSchema = z.object({
  id: z.literal(DEFAULT_SETTINGS_ID),
  theme: themeModeSchema,
  timezone: z.string().min(1),
  onboardingCompleted: z.boolean(),
  serverUrl: z.string().nullable(),
  calendarSyncMode: calendarSyncModeSchema,
  outlookCliCommand: z.string().nullable(),
  icsFeedUrl: z.string().nullable(),
  calendarSyncIntervalMin: z.number().int().min(1).max(1440),
  skipDeclinedAndAllDay: z.boolean(),
  lastCalendarSyncAt: z.string().nullable(),
  webhookUrl: z.string().nullable(),
  webhookEvents: z.array(webhookEventNameSchema),
  notionToken: z.string().nullable(),
  notionOauthClientId: z.string().nullable(),
  notionOauthClientSecret: z.string().nullable(),
  notionOauthRedirectUri: z.string().nullable(),
  notionWorkspaceName: z.string().nullable(),
  macosFocusEnabled: z.boolean(),
  macosFocusStartShortcut: z.string().nullable(),
  macosFocusEndShortcut: z.string().nullable(),
  globalCaptureShortcut: z.string().min(1),
  runInMenuBar: z.boolean(),
  updatedAt: z.string(),
});
export type Settings = z.infer<typeof settingsSchema>;

export const publicSettingsSchema = settingsSchema
  .omit({ notionToken: true, notionOauthClientSecret: true })
  .extend({
    notionConfigured: z.boolean(),
    notionTokenSource: notionTokenSourceSchema.nullable(),
    notionOauthConfigured: z.boolean(),
  });
export type PublicSettings = z.infer<typeof publicSettingsSchema>;

export const notionObjectTypeSchema = z.enum(['page', 'database']);
export type NotionObjectType = z.infer<typeof notionObjectTypeSchema>;

export const notionSearchResultSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  url: z.string().url(),
  objectType: notionObjectTypeSchema,
  lastEditedTime: z.string(),
});
export type NotionSearchResult = z.infer<typeof notionSearchResultSchema>;

export interface NotionSearchResponse {
  configured: boolean;
  results: NotionSearchResult[];
}

export interface NotionTestConnectionResult {
  ok: boolean;
  statusCode: number | null;
  workspaceName: string | null;
  botName: string | null;
  error: string | null;
}

export interface NotionOAuthStartResponse {
  authorizeUrl: string;
  redirectUri: string;
}

export const macOsFocusPhaseSchema = z.enum(['start', 'end']);
export type MacOsFocusPhase = z.infer<typeof macOsFocusPhaseSchema>;

export interface MacOsFocusRunResult {
  ok: boolean;
  phase: MacOsFocusPhase;
  shortcutName: string | null;
  skipped: boolean;
  reason?: string;
  error?: string;
}

export interface MacOsFocusShortcutsResponse {
  supported: boolean;
  shortcuts: string[];
}

export const activityLogSchema = z.object({
  id: z.string().uuid(),
  actor: activityActorSchema,
  action: z.string().min(1),
  summary: z.string(),
  createdAt: z.string(),
});
export type ActivityLog = z.infer<typeof activityLogSchema>;

// ---------------------------------------------------------------------------
// Input / Mutation Schemas
// ---------------------------------------------------------------------------

export const createGoalInputSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().optional().default(''),
  color: z.string().min(1).optional().default(DEFAULT_GOAL_COLOR),
  status: goalStatusSchema.optional().default('active'),
  orderKey: z.string().min(1).optional(),
});
export type CreateGoalInput = z.input<typeof createGoalInputSchema>;

export const updateGoalInputSchema = z.object({
  name: z.string().trim().min(1).optional(),
  description: z.string().optional(),
  color: z.string().min(1).optional(),
  status: goalStatusSchema.optional(),
  orderKey: z.string().min(1).optional(),
});
export type UpdateGoalInput = z.infer<typeof updateGoalInputSchema>;

const matchKeywordsInputSchema = z
  .array(z.string())
  .transform((list) => normalizeMatchKeywords(list));

/** Trims, drops empties, and de-duplicates (case-insensitive) calendar match keywords. */
export function normalizeMatchKeywords(list: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const kw = raw.trim().replace(/\s+/g, ' ');
    if (!kw) continue;
    const key = kw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(kw);
  }
  return out;
}

export const createProjectInputSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().optional().default(''),
  color: z.string().min(1).optional().default(DEFAULT_GOAL_COLOR),
  icon: z.string().min(1).nullable().optional().default(null),
  defaultGoalId: z.string().uuid().nullable().optional().default(null),
  isPinned: z.boolean().optional().default(false),
  status: projectStatusSchema.optional().default('active'),
  notionUrl: z.string().url().nullable().optional().default(null),
  matchKeywords: matchKeywordsInputSchema.optional().default([]),
});
export type CreateProjectInput = z.input<typeof createProjectInputSchema>;

export const updateProjectInputSchema = z.object({
  name: z.string().trim().min(1).optional(),
  description: z.string().optional(),
  color: z.string().min(1).optional(),
  icon: z.string().min(1).nullable().optional(),
  defaultGoalId: z.string().uuid().nullable().optional(),
  isPinned: z.boolean().optional(),
  status: projectStatusSchema.optional(),
  notionUrl: z.string().url().nullable().optional(),
  matchKeywords: matchKeywordsInputSchema.optional(),
});
export type UpdateProjectInput = z.infer<typeof updateProjectInputSchema>;

export const createBlockInputSchema = z.object({
  title: z.string().trim().min(1),
  projectId: z.string().uuid().optional(),
  goalId: z.string().uuid().nullable().optional(),
  isOps: z.boolean().optional().default(false),
  bucket: blockBucketSchema.optional(),
  scheduledDate: dateOnlySchema.nullable().optional(),
  plannedStartAt: isoTimestampSchema.nullable().optional(),
  plannedEndAt: isoTimestampSchema.nullable().optional(),
  dueDate: dateOnlySchema.nullable().optional(),
  revisitAt: revisitHorizonSchema.nullable().optional(),
  orderKey: z.string().min(1).optional(),
  recurrenceRule: recurrenceRuleSchema.nullable().optional(),
  notes: z.string().optional().default(''),
  externalLinks: z.array(externalLinkSchema).optional().default([]),
});
export type CreateBlockInput = z.input<typeof createBlockInputSchema>;

export const updateBlockInputSchema = z.object({
  title: z.string().trim().min(1).optional(),
  projectId: z.string().uuid().optional(),
  goalId: z.string().uuid().nullable().optional(),
  isOps: z.boolean().optional(),
  bucket: blockBucketSchema.optional(),
  scheduledDate: dateOnlySchema.nullable().optional(),
  plannedStartAt: isoTimestampSchema.nullable().optional(),
  plannedEndAt: isoTimestampSchema.nullable().optional(),
  dueDate: dateOnlySchema.nullable().optional(),
  revisitAt: revisitHorizonSchema.nullable().optional(),
  orderKey: z.string().min(1).optional(),
  status: blockStatusSchema.optional(),
  energySignal: energySignalSchema.nullable().optional(),
  outcomeNote: z.string().nullable().optional(),
  resumeNote: z.string().nullable().optional(),
  autoSummary: z.string().nullable().optional(),
  recurrenceRule: recurrenceRuleSchema.nullable().optional(),
  notes: z.string().optional(),
  externalLinks: z.array(externalLinkSchema).optional(),
});
export type UpdateBlockInput = z.infer<typeof updateBlockInputSchema>;

export const moveBlockInputSchema = z.object({
  bucket: blockBucketSchema.optional(),
  scheduledDate: dateOnlySchema.nullable().optional(),
  plannedStartAt: isoTimestampSchema.nullable().optional(),
  plannedEndAt: isoTimestampSchema.nullable().optional(),
  revisitAt: revisitHorizonSchema.nullable().optional(),
  orderKey: z.string().min(1).optional(),
});
export type MoveBlockInput = z.infer<typeof moveBlockInputSchema>;

export const parkBlockInputSchema = z.object({
  revisitAt: revisitHorizonSchema.optional(),
});
export type ParkBlockInput = z.infer<typeof parkBlockInputSchema>;

export const reorderBlockInputSchema = z.object({
  beforeOrderKey: z.string().min(1).nullable().optional(),
  afterOrderKey: z.string().min(1).nullable().optional(),
  beforeId: z.string().uuid().nullable().optional(),
  afterId: z.string().uuid().nullable().optional(),
});
export type ReorderBlockInput = z.infer<typeof reorderBlockInputSchema>;

export const completeBlockInputSchema = z.object({
  energySignal: energySignalSchema.nullable().optional(),
  outcomeNote: z.string().nullable().optional(),
});
export type CompleteBlockInput = z.infer<typeof completeBlockInputSchema>;

export const logSessionInputSchema = z.object({
  blockId: z.string().uuid(),
  startedAt: isoTimestampSchema,
  endedAt: isoTimestampSchema,
  note: z.string().nullable().optional(),
});
export type LogSessionInput = z.infer<typeof logSessionInputSchema>;

export const trimSessionInputSchema = z.object({
  startedAt: isoTimestampSchema,
  endedAt: isoTimestampSchema,
  note: z.string().nullable().optional(),
});
export type TrimSessionInput = z.infer<typeof trimSessionInputSchema>;

export const splitSessionInputSchema = z.object({
  breakStartAt: isoTimestampSchema,
  breakMinutes: z.number().int().min(1),
});
export type SplitSessionInput = z.infer<typeof splitSessionInputSchema>;

export const normalizedCalendarEventSchema = z.object({
  externalId: z.string().min(1),
  title: z.string().min(1),
  startAt: z.string().min(1),
  endAt: z.string().min(1),
  isAllDay: z.boolean().optional(),
  isDeclined: z.boolean().optional(),
  meetingUrl: z.string().nullable().optional(),
});
export type NormalizedCalendarEvent = z.infer<typeof normalizedCalendarEventSchema>;

export const updateCalendarEventInputSchema = z.object({
  projectId: z.string().uuid().nullable().optional(),
  goalId: z.string().uuid().nullable().optional(),
  isOps: z.boolean().optional(),
  notes: z.string().optional(),
  externalLinks: z.array(externalLinkSchema).optional(),
});
export type UpdateCalendarEventInput = z.infer<typeof updateCalendarEventInputSchema>;

export const createDailyNoteInputSchema = z.object({
  content: z.string().trim().min(1),
  date: dateOnlySchema.optional(),
  projectId: z.string().uuid().nullable().optional().default(null),
  goalId: z.string().uuid().nullable().optional().default(null),
  isOps: z.boolean().optional().default(false),
});
export type CreateDailyNoteInput = z.input<typeof createDailyNoteInputSchema>;

export const updateDailyNoteInputSchema = z.object({
  content: z.string().trim().min(1).optional(),
  date: dateOnlySchema.optional(),
  projectId: z.string().uuid().nullable().optional(),
  goalId: z.string().uuid().nullable().optional(),
  isOps: z.boolean().optional(),
});
export type UpdateDailyNoteInput = z.infer<typeof updateDailyNoteInputSchema>;

export const updateSettingsInputSchema = z.object({
  theme: themeModeSchema.optional(),
  timezone: z.string().min(1).optional(),
  onboardingCompleted: z.boolean().optional(),
  serverUrl: z.string().nullable().optional(),
  calendarSyncMode: calendarSyncModeSchema.optional(),
  outlookCliCommand: z.string().nullable().optional(),
  icsFeedUrl: z.string().nullable().optional(),
  calendarSyncIntervalMin: z.number().int().min(1).max(1440).optional(),
  skipDeclinedAndAllDay: z.boolean().optional(),
  lastCalendarSyncAt: z.string().nullable().optional(),
  webhookUrl: z.string().nullable().optional(),
  webhookEvents: z.array(webhookEventNameSchema).optional(),
  notionToken: z.string().nullable().optional(),
  notionOauthClientId: z.string().nullable().optional(),
  notionOauthClientSecret: z.string().nullable().optional(),
  notionOauthRedirectUri: z.string().nullable().optional(),
  notionWorkspaceName: z.string().nullable().optional(),
  macosFocusEnabled: z.boolean().optional(),
  macosFocusStartShortcut: z.string().nullable().optional(),
  macosFocusEndShortcut: z.string().nullable().optional(),
  globalCaptureShortcut: z.string().min(1).optional(),
  runInMenuBar: z.boolean().optional(),
});
export type UpdateSettingsInput = z.infer<typeof updateSettingsInputSchema>;

// ---------------------------------------------------------------------------
// Derived & Transport Read Models, Filters & Service Results
// ---------------------------------------------------------------------------

export interface ListGoalsFilter {
  status?: GoalStatus;
  includeArchived?: boolean;
}

export interface ListProjectsFilter {
  status?: ProjectStatus;
  includeArchived?: boolean;
}

export interface ListBlocksFilter {
  bucket?: BlockBucket;
  scheduledDate?: string;
  projectId?: string;
  goalId?: string;
  status?: BlockStatus;
  isOps?: boolean;
  dueBefore?: string;
  includeDropped?: boolean;
  includeDone?: boolean;
}

export interface ListSessionsFilter {
  blockId?: string;
  startIso?: string;
  endIso?: string;
}

export interface ListDailyNotesFilter {
  date?: string;
  weekStartDate?: string;
  projectId?: string;
  goalId?: string;
}

export interface ListActivityFilter {
  limit?: number;
  actor?: ActivityActor;
  action?: string;
}

export interface StartFocusResult {
  closedSession: FocusSession | null;
  startedSession: FocusSession;
  block: Block;
}

export interface CloseFocusResult {
  closedSession: FocusSession;
  block: Block;
}

export interface CompleteBlockResult {
  block: Block;
  closedSession: FocusSession | null;
  currentSessionMinutes: number;
  totalBlockMinutes: number;
}

export interface SplitSessionResult {
  firstSession: FocusSession;
  secondSession: FocusSession;
}

export interface UpsertCalendarEventsResult {
  upserted: CalendarEvent[];
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  deletedCount: number;
  /** Events this sync auto-assigned to a Project (learned title or Project keywords). */
  autoMatchedCount: number;
}

export interface AutoMatchCalendarEventsResult {
  matchedCount: number;
}

export interface ActiveWeeklyRuleResult {
  weekStartDate: DateOnly;
  activeRule: WeeklyReview | null;
  nextWeekRule: WeeklyReview | null;
  activeRuleText: string | null;
}

export interface ProjectWithStats extends Project {
  isQuiet: boolean;
  weeklyFocusMinutes: number;
  openBlockCount: number;
  nextBlockTitle: string | null;
  lastTouchedAt: string;
}

export interface BlockDetail extends Block {
  sessions: FocusSession[];
  totalFocusMinutes: number;
}

export interface FocusStatus {
  activeSession: FocusSession | null;
  activeBlock: Block | null;
  elapsedSeconds: number;
  focusedTodayMinutes: number;
}

export interface EnergyCounts {
  up: number;
  neutral: number;
  down: number;
}

export interface RolloverResult {
  today: DateOnly;
  timezone: string;
  rolledOverBlockIds: string[];
  softDeletedRecurringIds: string[];
  materializedBlockIds: string[];
}

export type ProgressFeedItem =
  | {
      kind: 'block';
      id: string;
      title: string;
      projectId: string;
      goalId: string | null;
      isOps: boolean;
      timestamp: string;
      outcomeNote: string | null;
      autoSummary: string | null;
      energySignal: EnergySignal | null;
      totalFocusMinutes: number;
    }
  | {
      kind: 'meeting';
      id: string;
      title: string;
      projectId: string | null;
      goalId: string;
      isOps: boolean;
      timestamp: string;
      startAt: string;
      endAt: string;
      notes: string;
    };

export interface OpsRadarItem {
  key: string;
  seriesId: string | null;
  blockIds: string[];
  title: string;
  projectId: string;
  goalId: string | null;
  isGoalLinked: boolean;
  occurrenceCount: number;
  totalMinutes: number;
  autoSummaries: string[];
}

export interface OpsRadarSummary {
  totalOpsMinutes: number;
  pureOpsMinutes: number;
  goalLinkedOpsMinutes: number;
  pureOpsItems: OpsRadarItem[];
  goalLinkedOpsItems: OpsRadarItem[];
  items: OpsRadarItem[];
}

export interface WeeklyReviewSummary {
  weekStartDate: DateOnly;
  weekEndDate: DateOnly;
  timezone: string;
  totalFocusMinutes: number;
  goalAlignmentPct: number;
  buildMinutes: number;
  opsMinutes: number;
  energyCounts: EnergyCounts;
  progressFeed: ProgressFeedItem[];
  dailyNotes: DailyNote[];
  opsRadar: OpsRadarSummary;
  chronicCarryovers: Block[];
  pastRevisitLater: Block[];
  activeRule: WeeklyReview | null;
  weeklyReview: WeeklyReview | null;
  activeRuleText: string | null;
  ruleForNextWeek: string | null;
}

export interface CalendarSyncStatus {
  state: 'connected' | 'error' | 'manual';
  lastSyncAt: string | null;
  lastCount: number;
  lastError: string | null;
}

export interface SseEventPayload {
  type: string;
  entity?: string;
  id?: string;
  timestamp: string;
}

export interface ApiErrorPayload {
  error: {
    code: string;
    message: string;
  };
}
