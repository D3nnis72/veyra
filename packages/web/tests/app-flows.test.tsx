import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import type {
  ActivityLog,
  Block,
  BlockDetail,
  DailyNote,
  GoalWithStats,
  ProjectWithStats,
  PublicSettings,
} from '@veyra/core/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CalendarResponse,
  ReviewResponse,
  SettingsResponse,
  TodayResponse,
} from '../src/api/client';
import { App } from '../src/app/App';
import { AppShellContext } from '../src/app/AppShellContext';
import { ProjectModal } from '../src/views/ProjectModal';
import { SessionDetailDrawer } from '../src/views/SessionDetailDrawer';

const GOAL_1_ID = '11111111-1111-4111-8111-111111111111';
const GOAL_2_ID = '22222222-2222-4222-8222-222222222222';
const PROJ_1_ID = '33333333-3333-4333-8333-333333333333';
const BLOCK_1_ID = '44444444-4444-4444-8444-444444444444';
const BLOCK_2_ID = '55555555-5555-4555-8555-555555555555';
const NOTE_1_ID = '66666666-6666-4666-8666-666666666666';
const SESSION_1_ID = '77777777-7777-4777-8777-777777777777';
const SESSION_2_ID = '88888888-8888-4888-8888-888888888888';

const BASE_GOALS: GoalWithStats[] = [
  {
    id: GOAL_1_ID,
    name: 'Ship Veyra v1',
    kind: 'company',
    description: 'Core local-first release',
    doneWhen: 'v1 shipped to desktop',
    checkInDate: null,
    measure: null,
    ifItStalls: '',
    closingNote: null,
    closedAt: null,
    color: '#3B4BD8',
    status: 'active',
    orderKey: 'a0',
    updatedAt: '2026-11-23T08:00:00.000Z',
    deletedAt: null,
    weeklyFocusMinutes: 210,
    weeklyBlockCount: 3,
    linkedProjectCount: 1,
    rankInKind: 1,
  },
];

const BASE_PROJECTS: ProjectWithStats[] = [
  {
    id: PROJ_1_ID,
    name: 'Veyra App',
    description: 'Desktop and web client',
    color: '#3B4BD8',
    icon: 'Rocket',
    defaultGoalId: GOAL_1_ID,
    isPinned: true,
    isSystem: false,
    status: 'active',
    notionUrl: 'https://notion.so/veyra-hub',
    matchKeywords: [],
    weeklyTimeMinutes: null,
    createdAt: '2026-11-01T08:00:00.000Z',
    updatedAt: '2026-11-23T08:00:00.000Z',
    deletedAt: null,
    isQuiet: false,
    weeklyFocusMinutes: 210,
    weeklyVarianceStatus: 'time_without_plan',
    weeklyHistory8w: [],
    averageWeeklyMinutes8w: 210,
    learnedBlockSizeMinutes: null,
    sizeDriftPct: null,
    openBlockCount: 2,
    nextBlockTitle: 'Wire Weekly Review metrics',
    lastTouchedAt: '2026-11-23T08:00:00.000Z',
  },
];

const BASE_BLOCK: Block = {
  id: BLOCK_1_ID,
  projectId: PROJ_1_ID,
  goalId: GOAL_1_ID,
  title: 'Wire Weekly Review metrics',
  isOps: false,
  bucket: 'scheduled',
  scheduledDate: '2026-11-23',
  plannedStartAt: null,
  plannedEndAt: null,
  dueDate: null,
  revisitAt: null,
  orderKey: 'a0',
  status: 'todo',
  carryoverCount: 0,
  sizeMinutes: null,
  energySignal: null,
  senseSignal: null,
  dropReason: null,
  outcomeNote: null,
  resumeNote: 'Finish energy tile formatting',
  autoSummary: null,
  recurrenceRule: null,
  seriesId: null,
  notes: '- [ ] Check raw counts\n- [x] Verify API payload',
  externalLinks: [],
  updatedAt: '2026-11-23T09:00:00.000Z',
  deletedAt: null,
};

const BASE_BLOCK_DETAIL: BlockDetail = {
  ...BASE_BLOCK,
  sessions: [
    {
      id: SESSION_1_ID,
      blockId: BLOCK_1_ID,
      startedAt: '2026-11-22T09:00:00.000Z',
      endedAt: '2026-11-22T10:30:00.000Z',
      note: 'Day 1 pass',
      updatedAt: '2026-11-22T10:30:00.000Z',
      deletedAt: null,
    },
    {
      id: SESSION_2_ID,
      blockId: BLOCK_1_ID,
      startedAt: '2026-11-23T08:00:00.000Z',
      endedAt: '2026-11-23T09:00:00.000Z',
      note: 'Day 2 wrap-up',
      updatedAt: '2026-11-23T09:00:00.000Z',
      deletedAt: null,
    },
  ],
  totalFocusMinutes: 150,
};

const BASE_DAILY_NOTES: DailyNote[] = [
  {
    id: NOTE_1_ID,
    date: '2026-11-23',
    content: 'Keep morning meetings out of deep build block',
    projectId: PROJ_1_ID,
    goalId: GOAL_1_ID,
    isOps: false,
    createdAt: '2026-11-23T08:15:00.000Z',
    updatedAt: '2026-11-23T08:15:00.000Z',
    deletedAt: null,
  },
];

const BASE_SETTINGS: PublicSettings = {
  id: 'default',
  theme: 'dark',
  timezone: 'Europe/Berlin',
  onboardingCompleted: true,
  serverUrl: null,
  calendarSyncMode: 'outlook_cli',
  outlookCliCommand: 'lio-outlook calendar list --json',
  icsFeedUrl: null,
  calendarSyncIntervalMin: 15,
  skipDeclinedAndAllDay: true,
  lastCalendarSyncAt: '2026-11-23T09:15:00.000Z',
  webhookUrl: null,
  webhookEvents: ['focus.started', 'focus.ended', 'block.completed'],
  notionConfigured: false,
  notionTokenSource: null,
  notionOauthClientId: null,
  notionOauthRedirectUri: null,
  notionWorkspaceName: null,
  notionOauthConfigured: false,
  macosFocusEnabled: false,
  macosFocusStartShortcut: null,
  macosFocusEndShortcut: null,
  globalCaptureShortcut: 'CommandOrControl+Shift+P',
  hotkeys: {},
  runInMenuBar: true,
  updatedAt: '2026-11-23T09:15:00.000Z',
};

const BASE_TODAY: TodayResponse = {
  date: '2026-11-23',
  timezone: 'Europe/Berlin',
  weeklyRule: 'Protect 09:00–12:00 for deep product build',
  nextWeekRule: null,
  focusStatus: {
    activeSession: null,
    activeBlock: null,
    elapsedSeconds: 0,
    focusedTodayMinutes: 135,
  },
  upNext: [BASE_BLOCK],
  completedToday: [],
  upcomingEvents: [],
  todayEvents: [],
  dailyNotesCount: 1,
  projects: BASE_PROJECTS,
  goals: BASE_GOALS,
  roomToday: {
    roomMinutes: 240,
    baselineFocusMinutes: 240,
    meetingMinutes: 0,
    hasLearnedBaseline: false,
    weekdayLabel: 'Monday',
  },
  suggestedOrder: [
    {
      blockId: BLOCK_1_ID,
      effectiveSizeMinutes: 60,
      reason: 'Supports Ship Veyra v1',
      isChronicCarryover: false,
      isMotionHotSpot: false,
      isBehindWeeklyTime: false,
    },
  ],
  fitLine: {
    fitLineIndex: 1,
    fittingMinutes: 60,
    remainingMinutes: 180,
    overflowBlockCount: 0,
    overflowMinutes: 0,
  },
  dayLookBack: null,
};

const BASE_CALENDAR: CalendarResponse = {
  startDate: '2026-11-23',
  endDate: '2026-11-23',
  timezone: 'Europe/Berlin',
  sessions: [
    {
      id: SESSION_2_ID,
      blockId: BLOCK_1_ID,
      startedAt: '2026-11-23T08:00:00.000Z',
      endedAt: '2026-11-23T09:00:00.000Z',
      note: 'Day 2 wrap-up',
      updatedAt: '2026-11-23T09:00:00.000Z',
      deletedAt: null,
      blockTitle: BASE_BLOCK.title,
      projectId: PROJ_1_ID,
      goalId: GOAL_1_ID,
      isOps: false,
      blockStatus: 'todo',
    },
  ],
  plannedBlocks: [],
  events: [],
  projects: BASE_PROJECTS,
  goals: BASE_GOALS,
};

const BASE_HOOK_ACTIVITY: ActivityLog[] = [
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    actor: 'hook',
    action: 'webhook.delivered',
    summary:
      "Delivered webhook 'block.completed' to http://127.0.0.1:4174/webhook (HTTP 202, attempts: 1)",
    createdAt: '2026-11-23T11:31:00.000Z',
  },
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    actor: 'hook',
    action: 'webhook.failed',
    summary:
      "Failed to deliver webhook 'focus.started' to http://127.0.0.1:4174/webhook after 2 attempt(s): fetch failed",
    createdAt: '2026-11-23T09:01:00.000Z',
  },
];

const BASE_REVIEW: ReviewResponse = {
  weekStartDate: '2026-11-23',
  weekEndDate: '2026-11-29',
  weekNumber: 48,
  timezone: 'Europe/Berlin',
  chapterOpeningSentences: {
    week: '10h 45m focus, 9h 15m under your room, 82% on goals.',
    progress: 'Ship Veyra v1 moved once.',
    time: 'Veyra App took 3h 30m without a weekly plan.',
    nextWeek: "Next week's rule is set.",
  },
  previousRuleKept: null,
  totalFocusMinutes: 645,
  roomMinutesTotal: 1200,
  plannedMinutesTotal: 600,
  goalAlignmentPct: 82,
  companyGoalMinutes: 529,
  personalGoalMinutes: 0,
  companyGoalPct: 82,
  personalGoalPct: 0,
  buildMinutes: 510,
  opsMinutes: 135,
  energyCounts: { up: 9, neutral: 3, down: 1 },
  senseCounts: { moved: 1, partly: 0, motion: 0 },
  dayStrip: [
    { date: '2026-11-23', weekday: 'Mon', focusMinutes: 180, plannedMinutes: 120, roomMinutes: 240, meetingMinutes: 0 },
    { date: '2026-11-24', weekday: 'Tue', focusMinutes: 150, plannedMinutes: 120, roomMinutes: 240, meetingMinutes: 0 },
    { date: '2026-11-25', weekday: 'Wed', focusMinutes: 120, plannedMinutes: 120, roomMinutes: 240, meetingMinutes: 0 },
    { date: '2026-11-26', weekday: 'Thu', focusMinutes: 105, plannedMinutes: 120, roomMinutes: 240, meetingMinutes: 0 },
    { date: '2026-11-27', weekday: 'Fri', focusMinutes: 90, plannedMinutes: 120, roomMinutes: 240, meetingMinutes: 0 },
  ],
  goalReviews: [
    {
      goalId: GOAL_1_ID,
      name: 'Ship Veyra v1',
      kind: 'company',
      color: '#3B4BD8',
      status: 'active',
      doneWhen: 'v1 shipped to desktop',
      checkInDate: null,
      measure: null,
      ifItStalls: '',
      rankInKind: 1,
      focusMinutes: 529,
      blockCount: 3,
      senseCounts: { moved: 1, partly: 0, motion: 0 },
      topOutcomes: ['Outlook CLI + ICS runner tested'],
      isCheckInDue: false,
      isQuietTwoWeeks: false,
      isStalled: false,
    },
  ],
  worthSecondLook: [],
  projectBuckets: {
    moreThanPlanned: [],
    lessThanPlanned: [],
    wantedUntouched: [],
    timeWithoutPlan: [
      {
        projectId: PROJ_1_ID,
        weeklyTimeMinutes: null,
        realMinutes: 210,
        differenceMinutes: null,
        blockCount: 2,
        carryoverCount: 0,
        trend4w: [0, 0, 0, 210],
        varianceStatus: 'time_without_plan',
      },
    ],
    onTrack: [],
  },
  planningFindings: [],
  ruleSuggestions: [],
  progressFeed: [
    {
      kind: 'block',
      id: BLOCK_2_ID,
      title: 'Ship calendar sync runner',
      projectId: PROJ_1_ID,
      goalId: GOAL_1_ID,
      isOps: false,
      timestamp: '2026-11-23T11:30:00.000Z',
      outcomeNote: 'Outlook CLI + ICS runner tested',
      autoSummary: 'Verified ICS recurrence expansion and Outlook CLI timezone normalization.',
      energySignal: 'up',
      senseSignal: 'moved',
      totalFocusMinutes: 95,
    },
  ],
  dailyNotes: BASE_DAILY_NOTES,
  opsRadar: {
    totalOpsMinutes: 135,
    pureOpsMinutes: 75,
    goalLinkedOpsMinutes: 60,
    pureOpsItems: [
      {
        key: 'series:ops-1',
        seriesId: 'ops-1',
        blockIds: [BLOCK_2_ID],
        title: 'Inbox triage & CI cleanup',
        projectId: PROJ_1_ID,
        goalId: null,
        isGoalLinked: false,
        occurrenceCount: 3,
        totalMinutes: 75,
        autoSummaries: [
          'Flaky webhook retry test required manual rerun twice this week.',
        ],
      },
    ],
    goalLinkedOpsItems: [],
    items: [],
  },
  chronicCarryovers: [],
  pastRevisitLater: [],
  activeRule: null,
  weeklyReview: null,
  activeRuleText: 'Protect 09:00–12:00 for deep product build',
  ruleForNextWeek: 'No unscheduled Slack checks before noon',
  completedAt: null,
  snapshot: null,
  projects: BASE_PROJECTS,
  goals: BASE_GOALS,
};

const BASE_SETTINGS_RESPONSE: SettingsResponse = {
  settings: BASE_SETTINGS,
  calendarSyncStatus: {
    state: 'connected',
    lastSyncAt: '2026-11-23T09:15:00.000Z',
    lastCount: 4,
    lastError: null,
  },
  notionConfigured: false,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

describe('Veyra Web App Flows', () => {
  let goalsState: GoalWithStats[];
  let projectsState: ProjectWithStats[];
  let blockDetailState: BlockDetail;
  let hookActivityState: ActivityLog[];
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    goalsState = [...BASE_GOALS];
    projectsState = [...BASE_PROJECTS];
    blockDetailState = { ...BASE_BLOCK_DETAIL };
    hookActivityState = [...BASE_HOOK_ACTIVITY];

    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      const parsed = new URL(url, 'http://localhost:4173');
      const path = parsed.pathname;

      if (path === '/api/settings' && method === 'GET') {
        return jsonResponse(BASE_SETTINGS_RESPONSE);
      }
      if (path === '/api/settings/test-hook' && method === 'POST') {
        const entry: ActivityLog = {
          id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          actor: 'hook',
          action: 'webhook.delivered',
          summary:
            "Delivered webhook 'webhook.test' to http://127.0.0.1:4174/webhook (HTTP 200, attempts: 1)",
          createdAt: '2026-11-23T12:00:00.000Z',
        };
        hookActivityState = [entry, ...hookActivityState];
        return jsonResponse({
          result: { delivered: true, skipped: false, attempts: 1, statusCode: 200 },
        });
      }
      if (path === '/api/activity' && method === 'GET') {
        return jsonResponse({ activity: hookActivityState });
      }
      if (path === '/api/today' && method === 'GET') {
        return jsonResponse(BASE_TODAY);
      }
      if (path === '/api/focus' && method === 'GET') {
        return jsonResponse(BASE_TODAY.focusStatus);
      }
      if (path === '/api/projects' && method === 'GET') {
        return jsonResponse({ projects: projectsState });
      }
      if (path === '/api/projects' && method === 'POST') {
        const body = JSON.parse(String(init?.body ?? '{}'));
        const created: ProjectWithStats = {
          id: '99999999-9999-4999-8999-999999999999',
          name: body.name,
          description: body.description ?? '',
          color: body.color ?? '#3B4BD8',
          icon: body.icon ?? null,
          defaultGoalId: body.defaultGoalId ?? null,
          isPinned: Boolean(body.isPinned),
          isSystem: false,
          status: body.status ?? 'active',
          notionUrl: body.notionUrl ?? null,
          matchKeywords: body.matchKeywords ?? [],
          weeklyTimeMinutes: body.weeklyTimeMinutes ?? null,
          createdAt: '2026-11-23T10:00:00.000Z',
          updatedAt: '2026-11-23T10:00:00.000Z',
          deletedAt: null,
          isQuiet: false,
          weeklyFocusMinutes: 0,
          weeklyVarianceStatus: body.weeklyTimeMinutes ? 'untouched' : 'unplanned',
          weeklyHistory8w: [],
          averageWeeklyMinutes8w: 0,
          learnedBlockSizeMinutes: null,
          sizeDriftPct: null,
          openBlockCount: 0,
          nextBlockTitle: null,
          lastTouchedAt: '2026-11-23T10:00:00.000Z',
        };
        projectsState = [...projectsState, created];
        return jsonResponse({ project: created }, 201);
      }
      if (path === '/api/goals' && method === 'GET') {
        return jsonResponse({ goals: goalsState });
      }
      if (path.startsWith('/api/goals/') && method === 'GET') {
        const goalId = path.slice('/api/goals/'.length);
        const match = goalsState.find((g) => g.id === goalId) ?? goalsState[0];
        return jsonResponse({ goal: { ...match, history: [] } });
      }
      if (path === '/api/goals' && method === 'POST') {
        const body = JSON.parse(String(init?.body ?? '{}'));
        const created: GoalWithStats = {
          id: GOAL_2_ID,
          name: body.name,
          kind: body.kind ?? 'personal',
          description: body.description ?? '',
          doneWhen: body.doneWhen ?? '',
          checkInDate: body.checkInDate ?? null,
          measure: body.measure ?? null,
          ifItStalls: body.ifItStalls ?? '',
          closingNote: null,
          closedAt: null,
          color: body.color ?? '#2E9E6F',
          status: 'active',
          orderKey: 'a1',
          updatedAt: '2026-11-23T10:00:00.000Z',
          deletedAt: null,
          weeklyFocusMinutes: 0,
          weeklyBlockCount: 0,
          linkedProjectCount: 0,
          rankInKind: 1,
        };
        goalsState = [...goalsState, created];
        return jsonResponse({ goal: created }, 201);
      }
      if (path === `/api/blocks/${BLOCK_1_ID}` && method === 'GET') {
        return jsonResponse({ block: blockDetailState });
      }
      if (path === `/api/blocks/${BLOCK_1_ID}` && method === 'PATCH') {
        const body = JSON.parse(String(init?.body ?? '{}'));
        blockDetailState = {
          ...blockDetailState,
          ...body,
          updatedAt: '2026-11-23T12:05:00.000Z',
        };
        return jsonResponse({ block: blockDetailState });
      }
      if (path === '/api/notes' && method === 'GET') {
        return jsonResponse({ notes: BASE_DAILY_NOTES });
      }
      if (path === '/api/calendar' && method === 'GET') {
        return jsonResponse(BASE_CALENDAR);
      }
      if (path === '/api/review' && method === 'GET') {
        return jsonResponse(BASE_REVIEW);
      }

      return jsonResponse({ error: { code: 'NOT_FOUND', message: `Unhandled ${method} ${path}` } }, 404);
    });

    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('TodayView renders Weekly Rule below date, focused today pill, and opens BlockDetailDrawer (multi-day SESSIONS total) and DailyNotesDrawer on click', async () => {
    const user = userEvent.setup();
    const qc = createTestQueryClient();

    render(
      <QueryClientProvider client={qc}>
        <App />
      </QueryClientProvider>,
    );

    // Date heading + Weekly Rule directly beneath date + focused today pill
    expect(
      await screen.findByText(/Protect 09:00–12:00 for deep product build/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/2h 15m focused today/i)).toBeInTheDocument();

    // Clicking the Up Next block card opens BlockDetailDrawer showing multi-day SESSIONS total
    await user.click(screen.getByText('Wire Weekly Review metrics'));
    const blockDialog = await screen.findByRole('dialog', { name: 'Block detail' });
    expect(within(blockDialog).getByText(/Sessions · 2h 30m total/i)).toBeInTheDocument();

    // Close block drawer and click + Note to open DailyNotesDrawer
    await user.click(within(blockDialog).getByRole('button', { name: 'Close drawer' }));
    await user.click(screen.getByRole('button', { name: /\+ Note/i }));
    const notesDialog = await screen.findByRole('dialog', { name: /Daily Notes/i });
    expect(
      within(notesDialog).getByText(/Keep morning meetings out of deep build block/i),
    ).toBeInTheDocument();
  });

  it('TodayView block cards open a right-click context menu with block actions', async () => {
    const user = userEvent.setup();
    const qc = createTestQueryClient();

    render(
      <QueryClientProvider client={qc}>
        <App />
      </QueryClientProvider>,
    );

    const title = await screen.findByText('Wire Weekly Review metrics');
    await user.pointer({ keys: '[MouseRight]', target: title });

    const menu = await screen.findByRole('menu', { name: 'Block actions' });
    for (const label of [
      'Start Focus',
      'Open Details',
      'Mark Complete',
      'Move to Tomorrow',
      'Park in Later (2w)',
      'Move to Inbox',
      'Toggle Ops',
      'Duplicate Block',
      'Drop Block',
      'Delete Block',
    ]) {
      expect(within(menu).getByRole('menuitem', { name: label })).toBeInTheDocument();
    }
    expect(within(menu).queryByRole('menuitem', { name: 'Reopen Block' })).not.toBeInTheDocument();

    await user.click(within(menu).getByRole('menuitem', { name: 'Open Details' }));
    expect(screen.queryByRole('menu', { name: 'Block actions' })).not.toBeInTheDocument();
    expect(await screen.findByRole('dialog', { name: 'Block detail' })).toBeInTheDocument();
  });

  it('ProjectModal creates a new Goal inline via + New Goal and toggles Pin to sidebar with no cap', async () => {
    const user = userEvent.setup();
    const qc = createTestQueryClient();
    const onClose = vi.fn();

    render(
      <QueryClientProvider client={qc}>
        <ProjectModal open project={null} onClose={onClose} />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('dialog', { name: 'Create project' })).toBeInTheDocument();

    // Inline "+ New Goal" flow uses Personal/Company toggle and shared ColorPicker
    await user.click(screen.getByRole('button', { name: /New Goal/i }));
    const goalInput = screen.getByLabelText('New goal name');
    await user.type(goalInput, 'Automate Weekly Ops');
    await user.click(screen.getByRole('button', { name: /^Company$/i }));
    await user.click(screen.getByRole('button', { name: 'Create Goal' }));

    // Newly created goal appears as a selectable chip with GoalKindIconBadge
    const createdGoalBtn = await screen.findByRole('button', { name: 'Automate Weekly Ops' });
    expect(createdGoalBtn).toBeInTheDocument();
    expect(createdGoalBtn.querySelector('[data-goal-kind="company"]')).toBeInTheDocument();

    // Project color picker renders all 12 curated presets + custom slot
    expect(screen.getByRole('button', { name: /^Sky$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Custom hex/i })).toBeInTheDocument();

    // Pin to sidebar switch works freely with no cap
    const pinSwitch = screen.getByRole('switch', { name: /Pin to sidebar/i });
    expect(pinSwitch).toHaveAttribute('aria-checked', 'true');
    await user.click(pinSwitch);
    expect(pinSwitch).toHaveAttribute('aria-checked', 'false');
    await user.click(pinSwitch);
    expect(pinSwitch).toHaveAttribute('aria-checked', 'true');

    // Fill project name and submit
    await user.type(screen.getByPlaceholderText(/Project name/i), 'Ops Automation');
    await user.click(screen.getByRole('button', { name: 'Create Project' }));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });

    const createProjectCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).includes('/api/projects') && (init?.method ?? 'GET') === 'POST',
    );
    expect(createProjectCall).toBeDefined();
    const payload = JSON.parse(String(createProjectCall?.[1]?.body ?? '{}'));
    expect(payload.defaultGoalId).toBe(GOAL_2_ID);
    expect(payload.isPinned).toBe(true);
  });

  it('ProjectModal renders as a docked drawer with header Delete in edit mode and submits via Cmd+Enter', async () => {
    const user = userEvent.setup();
    const qc = createTestQueryClient();
    const onClose = vi.fn();

    const { unmount } = render(
      <QueryClientProvider client={qc}>
        <ProjectModal open project={BASE_PROJECTS[0]} onClose={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('dialog', { name: 'Edit project' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete project' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^(Archive|Unarchive)$/ })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Veyra App')).toBeInTheDocument();
    unmount();

    render(
      <QueryClientProvider client={qc}>
        <ProjectModal open project={null} onClose={onClose} />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('dialog', { name: 'Create project' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete project' })).not.toBeInTheDocument();

    await user.type(screen.getByPlaceholderText(/Project name/i), 'Shortcut Project');
    await user.keyboard('{Meta>}{Enter}{/Meta}');

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    const createCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).includes('/api/projects') && (init?.method ?? 'GET') === 'POST',
    );
    expect(JSON.parse(String(createCall?.[1]?.body ?? '{}')).name).toBe('Shortcut Project');
  });

  it('ReviewView renders raw Energy counts (9+ · 3· · 1−) and never renders a percentage energy score', async () => {
    const user = userEvent.setup();
    const qc = createTestQueryClient();

    render(
      <QueryClientProvider client={qc}>
        <App />
      </QueryClientProvider>,
    );

    await screen.findByText(/2h 15m focused today/i);

    await user.click(screen.getByRole('button', { name: 'Review' }));

    expect(await screen.findByText('Weekly Review')).toBeInTheDocument();
    const energyTile = await screen.findByTestId('review-energy-tile');
    expect(energyTile).toHaveTextContent('9+ · 3· · 1−');
    expect(energyTile).not.toHaveTextContent('%');
  });

  it('SettingsView renders Full-Page navigation and Integrations & Outlook Sync heading with no modal backdrop', async () => {
    const user = userEvent.setup();
    const qc = createTestQueryClient();

    render(
      <QueryClientProvider client={qc}>
        <App />
      </QueryClientProvider>,
    );

    await screen.findByText(/2h 15m focused today/i);

    // Navigate to full-page Settings
    await user.click(screen.getByRole('button', { name: /^Settings/i }));

    // Left sidebar switches to full-page Settings navigation (3 tabs only)
    const settingsNav = await screen.findByRole('complementary', {
      name: 'Settings navigation',
    });
    expect(within(settingsNav).getByRole('button', { name: /Back to Today/i })).toBeInTheDocument();
    expect(within(settingsNav).getByRole('button', { name: 'Integrations' })).toBeInTheDocument();
    expect(within(settingsNav).getByRole('button', { name: 'Server & CLI' })).toBeInTheDocument();
    expect(within(settingsNav).getByRole('button', { name: 'Appearance' })).toBeInTheDocument();
    expect(within(settingsNav).queryByRole('button', { name: 'Goals' })).not.toBeInTheDocument();
    expect(within(settingsNav).queryByRole('button', { name: 'Shortcuts' })).not.toBeInTheDocument();

    // Integrations is the default Settings section
    expect(
      await screen.findByRole('heading', { name: 'Integrations & Outlook Sync' }),
    ).toBeInTheDocument();

    // Confirm full-page (no modal dialog / backdrop rendered)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Webhook listener snippet and recent webhook delivery logs surface in Integrations
    expect(
      screen.getByText(/veyra hook listen --port 4174 --auto-summary --summarizer-cmd "claude -p"/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/http:\/\/127\.0\.0\.1:4174\/hooks\/veyra/i)).toBeInTheDocument();
    expect(await screen.findByText(/Delivered webhook 'block\.completed'/i)).toBeInTheDocument();
    expect(screen.getByText(/Failed to deliver webhook 'focus\.started'/i)).toBeInTheDocument();

    // Clicking Test Hook reports HTTP 200 delivery and refreshes the delivery log
    await user.click(screen.getByRole('button', { name: /Test Hook/i }));
    expect(await screen.findByText(/Test webhook delivered \(HTTP 200\)/i)).toBeInTheDocument();
    expect(await screen.findByText(/Delivered webhook 'webhook\.test'/i)).toBeInTheDocument();
  });

  it('BlockDetailDrawer renders editable and clearable AUTO SUMMARY when present and omits it when null', async () => {
    const user = userEvent.setup();
    const qc = createTestQueryClient();

    // First verify AUTO SUMMARY is omitted when block.autoSummary is null
    const { unmount } = render(
      <QueryClientProvider client={qc}>
        <App />
      </QueryClientProvider>,
    );
    await user.click(await screen.findByText('Wire Weekly Review metrics'));
    const emptyDialog = await screen.findByRole('dialog', { name: 'Block detail' });
    expect(within(emptyDialog).queryByRole('region', { name: 'Auto Summary' })).not.toBeInTheDocument();
    unmount();

    // Now populate autoSummary and verify display, inline edit, and clear
    blockDetailState = {
      ...BASE_BLOCK_DETAIL,
      autoSummary: 'Summarized 2 focus sessions and verified SQLite metrics.',
    };

    const qc2 = createTestQueryClient();
    render(
      <QueryClientProvider client={qc2}>
        <App />
      </QueryClientProvider>,
    );
    await user.click(await screen.findByText('Wire Weekly Review metrics'));
    const dialog = await screen.findByRole('dialog', { name: 'Block detail' });
    const summarySection = await within(dialog).findByRole('region', { name: 'Auto Summary' });
    expect(summarySection).toHaveTextContent(
      'Summarized 2 focus sessions and verified SQLite metrics.',
    );

    // Edit inline
    await user.click(within(summarySection).getByRole('button', { name: 'Edit auto summary' }));
    const textarea = within(summarySection).getByRole('textbox', { name: 'Auto summary' });
    await user.clear(textarea);
    await user.type(textarea, 'Edited post-block summary');
    await user.click(within(summarySection).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Edited post-block summary')).toBeInTheDocument();

    // Clear autoSummary
    await user.click(within(dialog).getByRole('button', { name: 'Clear auto summary' }));
    await waitFor(() => {
      expect(within(dialog).queryByRole('region', { name: 'Auto Summary' })).not.toBeInTheDocument();
    });
  });

  it('SessionDetailDrawer displays AUTO SUMMARY when present and lets users clear it', async () => {
    const user = userEvent.setup();
    blockDetailState = {
      ...BASE_BLOCK_DETAIL,
      autoSummary: 'Completed review metrics wiring in 60m.',
    };

    const qc = createTestQueryClient();
    render(
      <QueryClientProvider client={qc}>
        <AppShellContext.Provider
          value={{
            route: 'calendar',
            previousRoute: 'today',
            activeProjectId: null,
            settingsSection: 'integrations',
            activeDrawer: { kind: 'session', sessionId: SESSION_2_ID },
            liveSyncStatus: 'connected',
            focusStatus: null,
            liveElapsedSeconds: 0,
            projects: BASE_PROJECTS,
            goals: BASE_GOALS,
            settings: BASE_SETTINGS,
            navigate: vi.fn(),
            openProject: vi.fn(),
            setSettingsSection: vi.fn(),
            openBlockDrawer: vi.fn(),
            openGoalDrawer: vi.fn(),
            openCreateGoal: vi.fn(),
            openEditGoal: vi.fn(),
            openCloseGoal: vi.fn(),
            openDailyNotesDrawer: vi.fn(),
            openMeetingDrawer: vi.fn(),
            openSessionDrawer: vi.fn(),
            closeDrawer: vi.fn(),
            openCommandPalette: vi.fn(),
            openQuickCapture: vi.fn(),
            openCreateBlock: vi.fn(),
            openEditProject: vi.fn(),
            startFocusAndNavigate: vi.fn(async () => {}),
          }}
        >
          <SessionDetailDrawer sessionId={SESSION_2_ID} onClose={vi.fn()} />
        </AppShellContext.Provider>
      </QueryClientProvider>,
    );

    const dialog = await screen.findByRole('dialog', { name: 'Session detail' });
    const summarySection = await within(dialog).findByRole('region', { name: 'Auto Summary' });
    expect(summarySection).toHaveTextContent('Completed review metrics wiring in 60m.');

    await user.click(within(summarySection).getByRole('button', { name: 'Clear auto summary' }));
    await waitFor(() => {
      expect(within(dialog).queryByRole('region', { name: 'Auto Summary' })).not.toBeInTheDocument();
    });
  });

  it('ReviewView surfaces autoSummary in Progress Feed and recurring Ops pattern summaries in Ops & Automation Radar', async () => {
    const user = userEvent.setup();
    const qc = createTestQueryClient();

    render(
      <QueryClientProvider client={qc}>
        <App />
      </QueryClientProvider>,
    );

    await screen.findByText(/2h 15m focused today/i);
    await user.click(screen.getByRole('button', { name: 'Review' }));

    const feed = await screen.findByRole('region', { name: 'Progress Feed' });
    expect(
      within(feed).getByText(
        /Verified ICS recurrence expansion and Outlook CLI timezone normalization\./i,
      ),
    ).toBeInTheDocument();

    const opsRadar = screen.getByRole('region', { name: 'Ops and Automation Radar' });
    expect(
      within(opsRadar).getByText(/Flaky webhook retry test required manual rerun twice this week\./i),
    ).toBeInTheDocument();

    // Review Progress Feed renders GoalChip with kind icon badge instead of plain dot
    expect(feed.querySelector('[data-goal-kind="company"]')).toBeInTheDocument();
  });

  it('TodayView, BlockDetailDrawer, and CommandPalette render GoalChip/GoalKindIconBadge and CommandPalette opens GoalDetailDrawer', async () => {
    const user = userEvent.setup();
    const qc = createTestQueryClient();

    const { container } = render(
      <QueryClientProvider client={qc}>
        <App />
      </QueryClientProvider>,
    );

    // TodayView renders GoalChip with kind icon badge
    await screen.findByText('Wire Weekly Review metrics');
    expect(container.querySelector('[data-goal-kind="company"]')).toBeInTheDocument();

    // BlockDetailDrawer renders GoalKindIconBadge in goal picker
    await user.click(screen.getByText('Wire Weekly Review metrics'));
    const blockDialog = await screen.findByRole('dialog', { name: 'Block detail' });
    expect(blockDialog.querySelector('[data-goal-kind="company"]')).toBeInTheDocument();
    await user.click(within(blockDialog).getByRole('button', { name: 'Close drawer' }));

    // CommandPalette renders GoalKindIconBadge and opens GoalDetailDrawer (not Settings)
    await user.click(screen.getByRole('button', { name: /Search/i }));
    const palette = await screen.findByRole('dialog', { name: 'Command palette' });
    await user.type(within(palette).getByRole('textbox', { name: 'Search' }), 'Ship Veyra');

    const goalOption = await within(palette).findByText('Ship Veyra v1');
    const goalRow = goalOption.closest('[data-palette-index]') as HTMLElement;
    expect(goalRow.querySelector('[data-goal-kind="company"]')).toBeInTheDocument();

    await user.click(goalRow);
    const goalDrawer = await screen.findByRole('dialog', { name: 'Goal detail' });
    expect(within(goalDrawer).getByText(/Goal Detail · Company/i)).toBeInTheDocument();
  });

  it('Escape closes CloseGoalSheet without closing GoalDetailDrawer, and Edit Goal replaces GoalDetailDrawer', async () => {
    const user = userEvent.setup();
    const qc = createTestQueryClient();

    render(
      <QueryClientProvider client={qc}>
        <App />
      </QueryClientProvider>,
    );

    // Open Goals view and click Ship Veyra v1 to open GoalDetailDrawer
    await screen.findByText(/2h 15m focused today/i);
    await user.click(screen.getByRole('button', { name: 'Goals' }));
    const companySection = await screen.findByRole('region', { name: 'Company goals' });
    await user.click(within(companySection).getByText('Ship Veyra v1'));

    const goalDrawer = await screen.findByRole('dialog', { name: 'Goal detail' });
    expect(await within(goalDrawer).findByText('Ship Veyra v1')).toBeInTheDocument();

    // Open CloseGoalSheet on top of GoalDetailDrawer
    await user.click(within(goalDrawer).getByRole('button', { name: 'Mark Achieved' }));
    expect(await screen.findByRole('dialog', { name: 'Close goal' })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Goal detail' })).toBeInTheDocument();

    // First Escape closes ONLY CloseGoalSheet, leaving GoalDetailDrawer open
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Close goal' })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('dialog', { name: 'Goal detail' })).toBeInTheDocument();

    // Clicking Edit goal cleanly replaces GoalDetailDrawer with GoalFormDrawer (no stacked drawers)
    await user.click(within(goalDrawer).getByRole('button', { name: 'Edit goal' }));
    expect(await screen.findByRole('dialog', { name: 'Edit goal' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Goal detail' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);

    // Escape closes GoalFormDrawer
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Edit goal' })).not.toBeInTheDocument();
    });
  });

  it('SessionDetailDrawer loads archived goals so historical sessions still render closed GoalChips', async () => {
    const archivedGoal: GoalWithStats = {
      ...BASE_GOALS[0],
      status: 'achieved',
      closingNote: 'Completed v1 launch',
      closedAt: '2026-11-20T12:00:00.000Z',
    };
    goalsState = [archivedGoal];

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      const parsed = new URL(url, 'http://localhost:4173');
      if (parsed.pathname === '/api/goals' && method === 'GET') {
        const includeArchived = parsed.searchParams.get('includeArchived') === 'true';
        return jsonResponse({
          goals: includeArchived ? goalsState : goalsState.filter((g) => g.status === 'active'),
        });
      }
      if (parsed.pathname === '/api/projects' && method === 'GET') {
        return jsonResponse({ projects: projectsState });
      }
      if (parsed.pathname === `/api/blocks/${BLOCK_1_ID}` && method === 'GET') {
        return jsonResponse({ block: blockDetailState });
      }
      if (parsed.pathname === '/api/calendar' && method === 'GET') {
        return jsonResponse(BASE_CALENDAR);
      }
      return jsonResponse({});
    });

    const qc = createTestQueryClient();
    render(
      <QueryClientProvider client={qc}>
        <AppShellContext.Provider
          value={{
            route: 'calendar',
            previousRoute: 'today',
            activeProjectId: null,
            settingsSection: 'integrations',
            activeDrawer: { kind: 'session', sessionId: SESSION_2_ID },
            liveSyncStatus: 'connected',
            focusStatus: null,
            liveElapsedSeconds: 0,
            projects: BASE_PROJECTS,
            goals: [],
            settings: BASE_SETTINGS,
            navigate: vi.fn(),
            openProject: vi.fn(),
            setSettingsSection: vi.fn(),
            openBlockDrawer: vi.fn(),
            openGoalDrawer: vi.fn(),
            openCreateGoal: vi.fn(),
            openEditGoal: vi.fn(),
            openCloseGoal: vi.fn(),
            openDailyNotesDrawer: vi.fn(),
            openMeetingDrawer: vi.fn(),
            openSessionDrawer: vi.fn(),
            closeDrawer: vi.fn(),
            openCommandPalette: vi.fn(),
            openQuickCapture: vi.fn(),
            openCreateBlock: vi.fn(),
            openEditProject: vi.fn(),
            startFocusAndNavigate: vi.fn(async () => {}),
          }}
        >
          <SessionDetailDrawer sessionId={SESSION_2_ID} onClose={vi.fn()} />
        </AppShellContext.Provider>
      </QueryClientProvider>,
    );

    const dialog = await screen.findByRole('dialog', { name: 'Session detail' });
    expect(await within(dialog).findByText('Ship Veyra v1')).toBeInTheDocument();
    expect(dialog.querySelector('[data-goal-kind="company"]')).toBeInTheDocument();
  });
});
