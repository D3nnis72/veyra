import type {
  ActivityLog,
  ApiErrorPayload,
  Block,
  BlockDetail,
  CalendarEvent,
  CalendarEventSource,
  CalendarSyncStatus,
  CloseFocusResult,
  CompleteBlockResult,
  CreateBlockInput,
  CreateDailyNoteInput,
  CreateGoalInput,
  CreateProjectInput,
  DailyNote,
  EnergySignal,
  FocusSession,
  FocusStatus,
  Goal,
  ListActivityFilter,
  ListBlocksFilter,
  ListDailyNotesFilter,
  ListGoalsFilter,
  ListProjectsFilter,
  LogSessionInput,
  MacOsFocusPhase,
  MacOsFocusRunResult,
  MacOsFocusShortcutsResponse,
  MoveBlockInput,
  NormalizedCalendarEvent,
  NotionSearchResponse,
  NotionTestConnectionResult,
  ParkBlockInput,
  Project,
  ProjectWithStats,
  PublicSettings,
  ReorderBlockInput,
  SplitSessionInput,
  SplitSessionResult,
  StartFocusResult,
  TrimSessionInput,
  UpdateBlockInput,
  UpdateCalendarEventInput,
  UpdateDailyNoteInput,
  UpdateGoalInput,
  UpdateProjectInput,
  UpdateSettingsInput,
  UpsertCalendarEventsResult,
  WeeklyReview,
  WeeklyReviewSummary,
} from '@veyra/core/types';

// ---------------------------------------------------------------------------
// Electron Desktop Preload Bridge
// ---------------------------------------------------------------------------

export interface DesktopClientConfig {
  mode: 'local' | 'remote';
  serverUrl: string;
  token?: string | null;
  remoteUrl?: string;
  remoteToken?: string;
}

export type DesktopCommandAction =
  | { type: 'navigate'; route: string; projectId?: string; settingsSection?: string }
  | { type: 'start-focus'; blockId: string }
  | { type: 'open-block'; blockId: string }
  | { type: 'open-create-block'; title?: string }
  | { type: 'open-daily-notes' }
  | { type: 'open-quick-capture' };

export interface VeyraDesktopBridge {
  isElectron: boolean;
  getClientConfig: () => Promise<DesktopClientConfig>;
  saveClientConfig: (cfg: {
    mode: 'local' | 'remote';
    remoteUrl?: string;
    remoteToken?: string;
  }) => Promise<void>;
  syncDesktopPreferences: (prefs: {
    globalCaptureShortcut: string;
    runInMenuBar: boolean;
  }) => Promise<void>;
  closeCaptureWindow: () => Promise<void>;
  closeCommandWindow?: () => Promise<void>;
  focusAndDispatchAction?: (action: DesktopCommandAction) => Promise<void>;
  onCommandAction?: (listener: (action: DesktopCommandAction) => void) => () => void;
  openExternalUrl: (url: string) => Promise<void>;
}

declare global {
  interface Window {
    veyraDesktop?: VeyraDesktopBridge;
  }
}

export function isElectronDesktop(): boolean {
  return Boolean(typeof window !== 'undefined' && window.veyraDesktop?.isElectron);
}

const ALLOWED_EXTERNAL_PROTOCOLS = new Set([
  'http:',
  'https:',
  'msteams:',
  'zoommtg:',
  'notion:',
]);

export function openExternalUrl(url: string): void {
  if (typeof window === 'undefined') return;
  if (window.veyraDesktop?.openExternalUrl) {
    void window.veyraDesktop.openExternalUrl(url);
    return;
  }
  try {
    const parsed = new URL(url);
    if (!ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
      return;
    }
    window.open(parsed.toString(), '_blank', 'noopener,noreferrer');
  } catch {
    // Ignore invalid URLs
  }
}

// ---------------------------------------------------------------------------
// Server Response DTOs (1:1 with @veyra/server)
// ---------------------------------------------------------------------------

export interface HealthResponse {
  ok: boolean;
  version: string;
  dbReady: boolean;
}

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

export interface MacOsFocusTestResponse {
  result: MacOsFocusRunResult;
}

export interface SyncEventsResponse {
  status: CalendarSyncStatus;
  result: {
    upsertedCount: number;
    createdCount: number;
    updatedCount: number;
    skippedCount: number;
    deletedCount: number;
  };
  error?: string;
}

export interface WebhookDispatchResult {
  delivered: boolean;
  skipped: boolean;
  attempts: number;
  statusCode?: number;
  error?: string;
}

export interface TestHookResponse {
  result: WebhookDispatchResult;
}

export interface FocusStartResponse extends StartFocusResult {
  focusStatus: FocusStatus;
}

export interface FocusCloseResponse extends CloseFocusResult {
  focusStatus: FocusStatus;
}

export interface FocusCompleteResponse extends CompleteBlockResult {
  focusStatus: FocusStatus;
}

// ---------------------------------------------------------------------------
// Error Type
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Connection Configuration Resolution (same-origin web vs Electron bridge)
// ---------------------------------------------------------------------------

interface ResolvedConnection {
  baseUrl: string;
  token: string | null;
}

let cachedConnection: ResolvedConnection | null = null;
let connectionPromise: Promise<ResolvedConnection> | null = null;
const configListeners = new Set<() => void>();

function normalizeBaseUrl(raw?: string | null): string {
  if (!raw) return '';
  return raw.trim().replace(/\/+$/, '');
}

export function subscribeClientConfigChange(listener: () => void): () => void {
  configListeners.add(listener);
  return () => {
    configListeners.delete(listener);
  };
}

export async function resolveClientConnection(forceRefresh = false): Promise<ResolvedConnection> {
  if (!forceRefresh && cachedConnection) {
    return cachedConnection;
  }
  if (!forceRefresh && connectionPromise) {
    return connectionPromise;
  }

  connectionPromise = (async () => {
    if (typeof window !== 'undefined' && window.veyraDesktop?.getClientConfig) {
      try {
        const cfg = await window.veyraDesktop.getClientConfig();
        const url =
          cfg.mode === 'remote' && cfg.remoteUrl
            ? normalizeBaseUrl(cfg.remoteUrl)
            : normalizeBaseUrl(cfg.serverUrl);
        const token =
          cfg.mode === 'remote'
            ? (cfg.remoteToken ?? cfg.token ?? null)
            : (cfg.token ?? null);
        cachedConnection = {
          baseUrl: url,
          token: token?.trim() ? token.trim() : null,
        };
        return cachedConnection;
      } catch {
        // Fall through to same-origin default
      }
    }

    cachedConnection = {
      baseUrl: '',
      token: null,
    };
    return cachedConnection;
  })();

  try {
    return await connectionPromise;
  } finally {
    connectionPromise = null;
  }
}

export async function refreshClientConfig(): Promise<ResolvedConnection> {
  const next = await resolveClientConnection(true);
  for (const listener of configListeners) {
    listener();
  }
  return next;
}

export async function getEventStreamUrl(): Promise<string> {
  const conn = await resolveClientConnection();
  const base = conn.baseUrl ? `${conn.baseUrl}/api/events/stream` : '/api/events/stream';
  if (conn.token) {
    return `${base}?token=${encodeURIComponent(conn.token)}`;
  }
  return base;
}

// ---------------------------------------------------------------------------
// Core Fetch Helper
// ---------------------------------------------------------------------------

function buildQuery(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    sp.set(key, String(value));
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : '';
}

async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const conn = await resolveClientConnection();
  const url = `${conn.baseUrl}${path}`;

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Veyra-Actor': 'user',
  };

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (conn.token) {
    headers.Authorization = `Bearer ${conn.token}`;
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let json: unknown = undefined;
  if (text.trim()) {
    try {
      json = JSON.parse(text);
    } catch {
      // Non-JSON response fallback
    }
  }

  if (!response.ok) {
    const errPayload = json as ApiErrorPayload | undefined;
    const code = errPayload?.error?.code ?? 'HTTP_ERROR';
    const message =
      errPayload?.error?.message ?? `Request failed (${response.status} ${response.statusText})`;
    throw new ApiError(response.status, code, message);
  }

  return json as T;
}

// ---------------------------------------------------------------------------
// Centralized TanStack React Query Keys
// ---------------------------------------------------------------------------

export const queryKeys = {
  health: ['health'] as const,
  today: ['today'] as const,
  plan: (weekStart?: string) => (weekStart ? (['plan', weekStart] as const) : (['plan'] as const)),
  calendar: (start?: string, end?: string) => ['calendar', start ?? '', end ?? ''] as const,
  review: (weekStart?: string) =>
    weekStart ? (['review', weekStart] as const) : (['review'] as const),
  goals: (filter?: ListGoalsFilter) => ['goals', filter ?? {}] as const,
  projects: (filter?: ListProjectsFilter) => ['projects', filter ?? {}] as const,
  project: (id: string) => ['project', id] as const,
  blocks: (filter?: ListBlocksFilter) => ['blocks', filter ?? {}] as const,
  block: (id: string) => ['block', id] as const,
  focus: ['focus'] as const,
  notes: (filter?: ListDailyNotesFilter) => ['notes', filter ?? {}] as const,
  events: (start?: string, end?: string) => ['events', start ?? '', end ?? ''] as const,
  settings: ['settings'] as const,
  notionSearch: (q: string) => ['notion-search', q] as const,
  activity: (filter?: ListActivityFilter) => ['activity', filter ?? {}] as const,
};

// ---------------------------------------------------------------------------
// Typed API Client
// ---------------------------------------------------------------------------

export const apiClient = {
  // Health
  health(): Promise<HealthResponse> {
    return request<HealthResponse>('GET', '/api/health');
  },

  // Composite Views
  getToday(): Promise<TodayResponse> {
    return request<TodayResponse>('GET', '/api/today');
  },

  getPlan(weekStart?: string): Promise<PlanResponse> {
    return request<PlanResponse>('GET', `/api/plan${buildQuery({ weekStart })}`);
  },

  getCalendar(start?: string, end?: string): Promise<CalendarResponse> {
    return request<CalendarResponse>('GET', `/api/calendar${buildQuery({ start, end })}`);
  },

  getReview(weekStart?: string): Promise<ReviewResponse> {
    return request<ReviewResponse>('GET', `/api/review${buildQuery({ weekStart })}`);
  },

  setWeeklyRule(body: {
    weekStartDate?: string;
    ruleForNextWeek: string;
    notes?: string;
  }): Promise<{ review: WeeklyReview }> {
    return request<{ review: WeeklyReview }>('PUT', '/api/review/rule', body);
  },

  // Goals
  listGoals(filter?: ListGoalsFilter): Promise<{ goals: Goal[] }> {
    return request<{ goals: Goal[] }>(
      'GET',
      `/api/goals${buildQuery({
        status: filter?.status,
        includeArchived: filter?.includeArchived,
      })}`,
    );
  },

  createGoal(input: CreateGoalInput): Promise<{ goal: Goal }> {
    return request<{ goal: Goal }>('POST', '/api/goals', input);
  },

  updateGoal(id: string, input: UpdateGoalInput): Promise<{ goal: Goal }> {
    return request<{ goal: Goal }>('PATCH', `/api/goals/${encodeURIComponent(id)}`, input);
  },

  deleteGoal(id: string): Promise<{ goal: Goal }> {
    return request<{ goal: Goal }>('DELETE', `/api/goals/${encodeURIComponent(id)}`);
  },

  // Projects
  listProjects(filter?: ListProjectsFilter): Promise<{ projects: ProjectWithStats[] }> {
    return request<{ projects: ProjectWithStats[] }>(
      'GET',
      `/api/projects${buildQuery({
        status: filter?.status,
        includeArchived: filter?.includeArchived,
      })}`,
    );
  },

  createProject(input: CreateProjectInput): Promise<{ project: Project }> {
    return request<{ project: Project }>('POST', '/api/projects', input);
  },

  getProject(id: string): Promise<ProjectDetailResponse> {
    return request<ProjectDetailResponse>('GET', `/api/projects/${encodeURIComponent(id)}`);
  },

  updateProject(id: string, input: UpdateProjectInput): Promise<{ project: Project }> {
    return request<{ project: Project }>('PATCH', `/api/projects/${encodeURIComponent(id)}`, input);
  },

  deleteProject(id: string): Promise<{ project: Project }> {
    return request<{ project: Project }>('DELETE', `/api/projects/${encodeURIComponent(id)}`);
  },

  // Blocks
  listBlocks(filter?: ListBlocksFilter): Promise<{ blocks: Block[] }> {
    return request<{ blocks: Block[] }>(
      'GET',
      `/api/blocks${buildQuery({
        bucket: filter?.bucket,
        scheduledDate: filter?.scheduledDate,
        projectId: filter?.projectId,
        goalId: filter?.goalId,
        status: filter?.status,
        isOps: filter?.isOps,
        dueBefore: filter?.dueBefore,
        includeDropped: filter?.includeDropped,
        includeDone: filter?.includeDone,
      })}`,
    );
  },

  createBlock(input: CreateBlockInput): Promise<{ block: Block }> {
    return request<{ block: Block }>('POST', '/api/blocks', input);
  },

  getBlock(id: string): Promise<{ block: BlockDetail }> {
    return request<{ block: BlockDetail }>('GET', `/api/blocks/${encodeURIComponent(id)}`);
  },

  updateBlock(id: string, input: UpdateBlockInput): Promise<{ block: Block }> {
    return request<{ block: Block }>('PATCH', `/api/blocks/${encodeURIComponent(id)}`, input);
  },

  deleteBlock(id: string): Promise<{ block: Block }> {
    return request<{ block: Block }>('DELETE', `/api/blocks/${encodeURIComponent(id)}`);
  },

  moveBlock(id: string, input: MoveBlockInput): Promise<{ block: Block }> {
    return request<{ block: Block }>('POST', `/api/blocks/${encodeURIComponent(id)}/move`, input);
  },

  reorderBlock(id: string, input: ReorderBlockInput): Promise<{ block: Block }> {
    return request<{ block: Block }>(
      'POST',
      `/api/blocks/${encodeURIComponent(id)}/reorder`,
      input,
    );
  },

  parkBlock(id: string, input?: ParkBlockInput): Promise<{ block: Block }> {
    return request<{ block: Block }>(
      'POST',
      `/api/blocks/${encodeURIComponent(id)}/park`,
      input ?? {},
    );
  },

  dropBlock(id: string, input?: { stopSeries?: boolean }): Promise<{ block: Block }> {
    return request<{ block: Block }>(
      'POST',
      `/api/blocks/${encodeURIComponent(id)}/drop`,
      input ?? {},
    );
  },

  reopenBlock(id: string): Promise<{ block: Block }> {
    return request<{ block: Block }>('POST', `/api/blocks/${encodeURIComponent(id)}/reopen`, {});
  },

  // Focus & Sessions
  getFocus(): Promise<FocusStatus> {
    return request<FocusStatus>('GET', '/api/focus');
  },

  startFocus(blockId: string): Promise<FocusStartResponse> {
    return request<FocusStartResponse>('POST', '/api/focus/start', { blockId });
  },

  resumeFocus(blockId: string): Promise<FocusStartResponse> {
    return request<FocusStartResponse>('POST', '/api/focus/resume', { blockId });
  },

  pauseFocus(note?: string | null): Promise<FocusCloseResponse> {
    return request<FocusCloseResponse>('POST', '/api/focus/pause', note !== undefined ? { note } : {});
  },

  stopFocus(): Promise<FocusCloseResponse> {
    return request<FocusCloseResponse>('POST', '/api/focus/stop', {});
  },

  completeFocus(input?: {
    blockId?: string;
    energySignal?: EnergySignal | null;
    outcomeNote?: string | null;
  }): Promise<FocusCompleteResponse> {
    return request<FocusCompleteResponse>('POST', '/api/focus/complete', input ?? {});
  },

  logSession(input: LogSessionInput): Promise<{ session: FocusSession }> {
    return request<{ session: FocusSession }>('POST', '/api/sessions', input);
  },

  trimSession(id: string, input: TrimSessionInput): Promise<{ session: FocusSession }> {
    return request<{ session: FocusSession }>(
      'PATCH',
      `/api/sessions/${encodeURIComponent(id)}/trim`,
      input,
    );
  },

  splitSession(id: string, input: SplitSessionInput): Promise<SplitSessionResult> {
    return request<SplitSessionResult>(
      'POST',
      `/api/sessions/${encodeURIComponent(id)}/split`,
      input,
    );
  },

  deleteSession(id: string): Promise<{ session: FocusSession }> {
    return request<{ session: FocusSession }>('DELETE', `/api/sessions/${encodeURIComponent(id)}`);
  },

  // Daily Notes
  listNotes(filter?: ListDailyNotesFilter): Promise<{ notes: DailyNote[] }> {
    return request<{ notes: DailyNote[] }>(
      'GET',
      `/api/notes${buildQuery({
        date: filter?.date,
        weekStartDate: filter?.weekStartDate,
        projectId: filter?.projectId,
        goalId: filter?.goalId,
      })}`,
    );
  },

  addNote(input: CreateDailyNoteInput): Promise<{ note: DailyNote }> {
    return request<{ note: DailyNote }>('POST', '/api/notes', input);
  },

  updateNote(id: string, input: UpdateDailyNoteInput): Promise<{ note: DailyNote }> {
    return request<{ note: DailyNote }>('PATCH', `/api/notes/${encodeURIComponent(id)}`, input);
  },

  deleteNote(id: string): Promise<{ note: DailyNote }> {
    return request<{ note: DailyNote }>('DELETE', `/api/notes/${encodeURIComponent(id)}`);
  },

  // Calendar Events
  listEvents(start?: string, end?: string): Promise<{ events: CalendarEvent[] }> {
    return request<{ events: CalendarEvent[] }>('GET', `/api/events${buildQuery({ start, end })}`);
  },

  upsertEvents(input: {
    source?: CalendarEventSource;
    events: NormalizedCalendarEvent[];
  }): Promise<UpsertCalendarEventsResult> {
    return request<UpsertCalendarEventsResult>('POST', '/api/events/upsert', input);
  },

  syncEvents(): Promise<SyncEventsResponse> {
    return request<SyncEventsResponse>('POST', '/api/events/sync', {});
  },

  updateEvent(id: string, input: UpdateCalendarEventInput): Promise<{ event: CalendarEvent }> {
    return request<{ event: CalendarEvent }>(
      'PATCH',
      `/api/events/${encodeURIComponent(id)}`,
      input,
    );
  },

  // Settings
  getSettings(): Promise<SettingsResponse> {
    return request<SettingsResponse>('GET', '/api/settings');
  },

  updateSettings(input: UpdateSettingsInput): Promise<SettingsResponse> {
    return request<SettingsResponse>('PATCH', '/api/settings', input);
  },

  testHook(): Promise<TestHookResponse> {
    return request<TestHookResponse>('POST', '/api/settings/test-hook', {});
  },

  // Integrations: Notion
  searchNotion(q = '', limit?: number): Promise<NotionSearchResponse> {
    return request<NotionSearchResponse>(
      'GET',
      `/api/integrations/notion/search${buildQuery({ q, limit })}`,
    );
  },

  testNotionConnection(token?: string): Promise<NotionTestResponse> {
    return request<NotionTestResponse>(
      'POST',
      '/api/integrations/notion/test',
      token !== undefined ? { token } : {},
    );
  },

  // Integrations: macOS Focus Mode Presence
  listMacOsFocusShortcuts(): Promise<MacOsFocusShortcutsResponse> {
    return request<MacOsFocusShortcutsResponse>(
      'GET',
      '/api/integrations/macos-focus/shortcuts',
    );
  },

  testMacOsFocus(
    phase: MacOsFocusPhase,
    shortcutName?: string,
  ): Promise<MacOsFocusTestResponse> {
    return request<MacOsFocusTestResponse>(
      'POST',
      '/api/integrations/macos-focus/test',
      shortcutName !== undefined ? { phase, shortcutName } : { phase },
    );
  },

  // Activity Log
  listActivity(filter?: ListActivityFilter): Promise<{ activity: ActivityLog[] }> {
    return request<{ activity: ActivityLog[] }>(
      'GET',
      `/api/activity${buildQuery({
        limit: filter?.limit,
        actor: filter?.actor,
        action: filter?.action,
      })}`,
    );
  },
};
