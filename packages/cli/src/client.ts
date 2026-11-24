import {
  type ActivityActor,
  type ApiErrorPayload,
  type Block,
  type BlockBucket,
  type BlockDetail,
  type BlockStatus,
  type CalendarEvent,
  type CalendarEventSource,
  type CalendarSyncStatus,
  type CompleteBlockInput,
  type CreateBlockInput,
  type CreateDailyNoteInput,
  type CreateGoalInput,
  type CreateProjectInput,
  type DailyNote,
  type FocusSession,
  type FocusStatus,
  type Goal,
  type GoalStatus,
  type LogSessionInput,
  type MoveBlockInput,
  type NormalizedCalendarEvent,
  type ParkBlockInput,
  type Project,
  type ProjectStatus,
  type ProjectWithStats,
  type ReorderBlockInput,
  type Settings,
  type SplitSessionInput,
  type SplitSessionResult,
  type TrimSessionInput,
  type UpdateBlockInput,
  type UpdateCalendarEventInput,
  type UpdateGoalInput,
  type UpdateProjectInput,
  type UpsertCalendarEventsResult,
  type WeeklyReview,
  type WeeklyReviewSummary,
} from '@veyra/core/types';
import { z } from 'zod';

const uuidSchema = z.string().uuid();

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

export interface ReviewResponse extends WeeklyReviewSummary {
  projects: ProjectWithStats[];
  goals: Goal[];
}

export interface SettingsResponse {
  settings: Settings;
  calendarSyncStatus: CalendarSyncStatus;
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

export interface FocusStartResponse {
  closedSession: FocusSession | null;
  startedSession: FocusSession;
  block: Block;
  focusStatus: FocusStatus;
}

export interface FocusCloseResponse {
  closedSession: FocusSession;
  block: Block;
  focusStatus: FocusStatus;
}

export interface FocusCompleteResponse {
  block: Block;
  closedSession: FocusSession | null;
  currentSessionMinutes: number;
  totalBlockMinutes: number;
  focusStatus: FocusStatus;
}

export class VeyraApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'VeyraApiError';
    this.status = status;
    this.code = code;
  }
}

export interface VeyraClientOptions {
  serverUrl: string;
  token?: string;
  actor?: ActivityActor;
  now?: string;
  fetchImpl?: typeof fetch;
}

export class VeyraClient {
  readonly serverUrl: string;
  private readonly token?: string;
  private readonly actor: ActivityActor;
  private readonly now?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: VeyraClientOptions) {
    this.serverUrl = options.serverUrl.replace(/\/+$/, '');
    this.token = options.token;
    this.actor = options.actor ?? 'cli';
    this.now = options.now;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    endpoint: string,
    options?: {
      query?: Record<string, string | boolean | number | undefined>;
      body?: unknown;
    },
  ): Promise<T> {
    const url = new URL(`${this.serverUrl}${endpoint}`);
    if (options?.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-Veyra-Actor': this.actor,
    };
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    if (this.now) {
      headers['X-Veyra-Now'] = this.now;
    }

    const init: RequestInit = { method, headers };
    if (options?.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url.toString(), init);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new VeyraApiError(
        0,
        'NETWORK_ERROR',
        `Could not reach Veyra server at ${this.serverUrl}: ${detail}`,
      );
    }

    const rawText = await response.text();
    let parsed: unknown = undefined;
    if (rawText.trim()) {
      try {
        parsed = JSON.parse(rawText);
      } catch {
        if (!response.ok) {
          throw new VeyraApiError(
            response.status,
            'HTTP_ERROR',
            `Server returned ${response.status}: ${rawText.slice(0, 200)}`,
          );
        }
        throw new VeyraApiError(
          response.status,
          'INVALID_RESPONSE',
          `Expected JSON from ${method} ${endpoint}`,
        );
      }
    }

    if (!response.ok) {
      const apiErr = parsed as Partial<ApiErrorPayload> | undefined;
      const code = apiErr?.error?.code ?? 'HTTP_ERROR';
      const message =
        apiErr?.error?.message ?? `Request failed (${response.status} ${response.statusText})`;
      throw new VeyraApiError(response.status, code, message);
    }

    return parsed as T;
  }

  // Composite reads
  today(): Promise<TodayResponse> {
    return this.request<TodayResponse>('GET', '/api/today');
  }

  plan(weekStart?: string): Promise<PlanResponse> {
    return this.request<PlanResponse>('GET', '/api/plan', { query: { weekStart } });
  }

  calendar(start?: string, end?: string): Promise<CalendarResponse> {
    return this.request<CalendarResponse>('GET', '/api/calendar', { query: { start, end } });
  }

  review(weekStart?: string): Promise<ReviewResponse> {
    return this.request<ReviewResponse>('GET', '/api/review', { query: { weekStart } });
  }

  getSettings(): Promise<SettingsResponse> {
    return this.request<SettingsResponse>('GET', '/api/settings');
  }

  // Projects & Goals
  listProjects(params?: {
    status?: ProjectStatus;
    includeArchived?: boolean;
  }): Promise<{ projects: ProjectWithStats[] }> {
    return this.request<{ projects: ProjectWithStats[] }>('GET', '/api/projects', {
      query: {
        status: params?.status,
        includeArchived: params?.includeArchived,
      },
    });
  }

  createProject(input: CreateProjectInput): Promise<{ project: Project }> {
    return this.request<{ project: Project }>('POST', '/api/projects', { body: input });
  }

  updateProject(id: string, input: UpdateProjectInput): Promise<{ project: Project }> {
    return this.request<{ project: Project }>('PATCH', `/api/projects/${encodeURIComponent(id)}`, {
      body: input,
    });
  }

  listGoals(params?: {
    status?: GoalStatus;
    includeArchived?: boolean;
  }): Promise<{ goals: Goal[] }> {
    return this.request<{ goals: Goal[] }>('GET', '/api/goals', {
      query: {
        status: params?.status,
        includeArchived: params?.includeArchived,
      },
    });
  }

  createGoal(input: CreateGoalInput): Promise<{ goal: Goal }> {
    return this.request<{ goal: Goal }>('POST', '/api/goals', { body: input });
  }

  updateGoal(id: string, input: UpdateGoalInput): Promise<{ goal: Goal }> {
    return this.request<{ goal: Goal }>('PATCH', `/api/goals/${encodeURIComponent(id)}`, {
      body: input,
    });
  }

  async resolveProjectId(idOrName: string): Promise<string> {
    const trimmed = idOrName.trim();
    if (uuidSchema.safeParse(trimmed).success) {
      return trimmed;
    }
    const { projects } = await this.listProjects({ includeArchived: true });
    const needle = trimmed.toLowerCase();
    const matches = projects.filter((p) => p.name.trim().toLowerCase() === needle);
    if (matches.length === 1) {
      return matches[0].id;
    }
    if (matches.length > 1) {
      const ids = matches.map((m) => m.id).join(', ');
      throw new VeyraApiError(
        400,
        'AMBIGUOUS_PROJECT',
        `Multiple projects match '${idOrName}'. Specify a project UUID instead: ${ids}`,
      );
    }
    throw new VeyraApiError(404, 'NOT_FOUND', `Project '${idOrName}' not found`);
  }

  async resolveGoalId(idOrName: string): Promise<string> {
    const trimmed = idOrName.trim();
    if (uuidSchema.safeParse(trimmed).success) {
      return trimmed;
    }
    const { goals } = await this.listGoals({ includeArchived: true });
    const needle = trimmed.toLowerCase();
    const matches = goals.filter((g) => g.name.trim().toLowerCase() === needle);
    if (matches.length === 1) {
      return matches[0].id;
    }
    if (matches.length > 1) {
      const ids = matches.map((m) => m.id).join(', ');
      throw new VeyraApiError(
        400,
        'AMBIGUOUS_GOAL',
        `Multiple goals match '${idOrName}'. Specify a goal UUID instead: ${ids}`,
      );
    }
    throw new VeyraApiError(404, 'NOT_FOUND', `Goal '${idOrName}' not found`);
  }

  // Blocks
  listBlocks(params?: {
    bucket?: BlockBucket;
    scheduledDate?: string;
    projectId?: string;
    goalId?: string;
    status?: BlockStatus;
    isOps?: boolean;
    dueBefore?: string;
    includeDropped?: boolean;
    includeDone?: boolean;
  }): Promise<{ blocks: Block[] }> {
    return this.request<{ blocks: Block[] }>('GET', '/api/blocks', {
      query: params,
    });
  }

  getBlock(id: string): Promise<{ block: BlockDetail }> {
    return this.request<{ block: BlockDetail }>('GET', `/api/blocks/${encodeURIComponent(id)}`);
  }

  createBlock(input: CreateBlockInput): Promise<{ block: Block }> {
    return this.request<{ block: Block }>('POST', '/api/blocks', { body: input });
  }

  updateBlock(id: string, input: UpdateBlockInput): Promise<{ block: Block }> {
    return this.request<{ block: Block }>('PATCH', `/api/blocks/${encodeURIComponent(id)}`, {
      body: input,
    });
  }

  moveBlock(id: string, input: MoveBlockInput): Promise<{ block: Block }> {
    return this.request<{ block: Block }>('POST', `/api/blocks/${encodeURIComponent(id)}/move`, {
      body: input,
    });
  }

  reorderBlock(id: string, input: ReorderBlockInput): Promise<{ block: Block }> {
    return this.request<{ block: Block }>(
      'POST',
      `/api/blocks/${encodeURIComponent(id)}/reorder`,
      { body: input },
    );
  }

  parkBlock(id: string, input?: ParkBlockInput): Promise<{ block: Block }> {
    return this.request<{ block: Block }>('POST', `/api/blocks/${encodeURIComponent(id)}/park`, {
      body: input ?? {},
    });
  }

  dropBlock(id: string, input?: { stopSeries?: boolean }): Promise<{ block: Block }> {
    return this.request<{ block: Block }>('POST', `/api/blocks/${encodeURIComponent(id)}/drop`, {
      body: input ?? {},
    });
  }

  reopenBlock(id: string): Promise<{ block: Block }> {
    return this.request<{ block: Block }>(
      'POST',
      `/api/blocks/${encodeURIComponent(id)}/reopen`,
    );
  }

  // Focus & Sessions
  getFocus(): Promise<FocusStatus> {
    return this.request<FocusStatus>('GET', '/api/focus');
  }

  startFocus(blockId: string): Promise<FocusStartResponse> {
    return this.request<FocusStartResponse>('POST', '/api/focus/start', {
      body: { blockId },
    });
  }

  resumeFocus(blockId: string): Promise<FocusStartResponse> {
    return this.request<FocusStartResponse>('POST', '/api/focus/resume', {
      body: { blockId },
    });
  }

  pauseFocus(note?: string): Promise<FocusCloseResponse> {
    return this.request<FocusCloseResponse>('POST', '/api/focus/pause', {
      body: note !== undefined ? { note } : {},
    });
  }

  stopFocus(): Promise<FocusCloseResponse> {
    return this.request<FocusCloseResponse>('POST', '/api/focus/stop');
  }

  completeFocus(input?: CompleteBlockInput & { blockId?: string }): Promise<FocusCompleteResponse> {
    return this.request<FocusCompleteResponse>('POST', '/api/focus/complete', {
      body: input ?? {},
    });
  }

  logSession(input: LogSessionInput): Promise<{ session: FocusSession }> {
    return this.request<{ session: FocusSession }>('POST', '/api/sessions', { body: input });
  }

  trimSession(id: string, input: TrimSessionInput): Promise<{ session: FocusSession }> {
    return this.request<{ session: FocusSession }>(
      'PATCH',
      `/api/sessions/${encodeURIComponent(id)}/trim`,
      { body: input },
    );
  }

  splitSession(id: string, input: SplitSessionInput): Promise<SplitSessionResult> {
    return this.request<SplitSessionResult>(
      'POST',
      `/api/sessions/${encodeURIComponent(id)}/split`,
      { body: input },
    );
  }

  deleteSession(id: string): Promise<{ session: FocusSession }> {
    return this.request<{ session: FocusSession }>(
      'DELETE',
      `/api/sessions/${encodeURIComponent(id)}`,
    );
  }

  // Notes & Weekly Review
  listNotes(params?: {
    date?: string;
    weekStart?: string;
    projectId?: string;
    goalId?: string;
  }): Promise<{ notes: DailyNote[] }> {
    return this.request<{ notes: DailyNote[] }>('GET', '/api/notes', {
      query: params,
    });
  }

  addNote(input: CreateDailyNoteInput): Promise<{ note: DailyNote }> {
    return this.request<{ note: DailyNote }>('POST', '/api/notes', { body: input });
  }

  setWeeklyRule(input: {
    weekStartDate?: string;
    ruleForNextWeek: string;
    notes?: string;
  }): Promise<{ review: WeeklyReview }> {
    return this.request<{ review: WeeklyReview }>('PUT', '/api/review/rule', { body: input });
  }

  // Calendar Events
  listEvents(params?: { start?: string; end?: string }): Promise<{ events: CalendarEvent[] }> {
    return this.request<{ events: CalendarEvent[] }>('GET', '/api/events', {
      query: params,
    });
  }

  syncEvents(): Promise<SyncEventsResponse> {
    return this.request<SyncEventsResponse>('POST', '/api/events/sync');
  }

  autoMatchEvents(): Promise<{ matchedCount: number }> {
    return this.request<{ matchedCount: number }>('POST', '/api/events/auto-match');
  }

  upsertEvents(input: {
    source?: CalendarEventSource;
    events: NormalizedCalendarEvent[];
  }): Promise<UpsertCalendarEventsResult> {
    return this.request<UpsertCalendarEventsResult>('POST', '/api/events/upsert', {
      body: input,
    });
  }

  updateEvent(id: string, input: UpdateCalendarEventInput): Promise<{ event: CalendarEvent }> {
    return this.request<{ event: CalendarEvent }>(
      'PATCH',
      `/api/events/${encodeURIComponent(id)}`,
      { body: input },
    );
  }
}
