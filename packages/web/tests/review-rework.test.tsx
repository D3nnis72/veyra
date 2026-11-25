import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import type {
  Block,
  DailyNote,
  GoalWithStats,
  ProjectWithStats,
  PublicSettings,
  WeeklyReviewSnapshot,
} from '@veyra/core/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReviewResponse, SettingsResponse } from '../src/api/client';
import { AppShellContext, type AppShellContextValue } from '../src/app/AppShellContext';
import { ReviewView } from '../src/views/ReviewView';
import { SettingsView } from '../src/views/SettingsView';

const GOAL_COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const GOAL_PERSONAL_ID = '22222222-2222-4222-8222-222222222222';
const GOAL_QUIET_ID = '33333333-3333-4333-8333-333333333333';

const PROJ_OVER_ID = '44444444-4444-4444-8444-444444444444';
const PROJ_UNDER_ID = '55555555-5555-4555-8555-555555555555';
const PROJ_UNTOUCHED_ID = '66666666-6666-4666-8666-666666666666';
const PROJ_NOPLAN_ID = '77777777-7777-4777-8777-777777777777';
const PROJ_ONTRACK_ID = '88888888-8888-4888-8888-888888888888';

const BLOCK_MOVED_ID = '99999999-9999-4999-8999-999999999991';
const BLOCK_MOTION_ID = '99999999-9999-4999-8999-999999999992';
const BLOCK_CARRY_ID = '99999999-9999-4999-8999-999999999993';
const BLOCK_LATER_ID = '99999999-9999-4999-8999-999999999994';

const TEST_GOALS: GoalWithStats[] = [
  {
    id: GOAL_COMPANY_ID,
    name: 'Generate upsells',
    kind: 'company',
    description: 'Expand active enterprise accounts',
    doneWhen: '3 upsell proposals closed this quarter',
    checkInDate: '2026-11-27',
    measure: '1 / 3 closed',
    ifItStalls: 'Pair with account leads on executive summaries',
    closingNote: null,
    closedAt: null,
    color: '#34D399',
    status: 'active',
    orderKey: 'a0',
    updatedAt: '2026-11-27T10:00:00.000Z',
    deletedAt: null,
    weeklyFocusMinutes: 240,
    weeklyBlockCount: 3,
    linkedProjectCount: 2,
    rankInKind: 1,
  },
  {
    id: GOAL_PERSONAL_ID,
    name: 'Ship Veyra v1',
    kind: 'personal',
    description: 'Daily-driver local-first workspace',
    doneWhen: 'All 4 target design slices shipped',
    checkInDate: '2026-12-20',
    measure: '3 / 4 slices',
    ifItStalls: 'Cut secondary visual polish first',
    closingNote: null,
    closedAt: null,
    color: '#4DA3FF',
    status: 'active',
    orderKey: 'a0',
    updatedAt: '2026-11-27T10:00:00.000Z',
    deletedAt: null,
    weeklyFocusMinutes: 180,
    weeklyBlockCount: 2,
    linkedProjectCount: 1,
    rankInKind: 1,
  },
  {
    id: GOAL_QUIET_ID,
    name: 'Write technical essays',
    kind: 'personal',
    description: 'Publish thoughtful engineering notes',
    doneWhen: '2 deep-dive posts published',
    checkInDate: '2026-12-30',
    measure: null,
    ifItStalls: 'Shrink scope to one 500-word note',
    closingNote: null,
    closedAt: null,
    color: '#9D7FF7',
    status: 'active',
    orderKey: 'a1',
    updatedAt: '2026-11-27T10:00:00.000Z',
    deletedAt: null,
    weeklyFocusMinutes: 0,
    weeklyBlockCount: 0,
    linkedProjectCount: 0,
    rankInKind: 2,
  },
];

function makeProject(
  overrides: Partial<ProjectWithStats> & Pick<ProjectWithStats, 'id' | 'name'>,
): ProjectWithStats {
  return {
    description: '',
    color: '#3B4BD8',
    icon: 'Rocket',
    defaultGoalId: null,
    isPinned: false,
    isSystem: false,
    status: 'active',
    notionUrl: null,
    matchKeywords: [],
    weeklyTimeMinutes: 240,
    createdAt: '2026-10-01T08:00:00.000Z',
    updatedAt: '2026-11-27T08:00:00.000Z',
    deletedAt: null,
    isQuiet: false,
    weeklyFocusMinutes: 0,
    weeklyVarianceStatus: 'on_track',
    weeklyHistory8w: [],
    averageWeeklyMinutes8w: 0,
    learnedBlockSizeMinutes: 60,
    sizeDriftPct: null,
    openBlockCount: 1,
    nextBlockTitle: null,
    lastTouchedAt: '2026-11-27T08:00:00.000Z',
    ...overrides,
  };
}

const TEST_PROJECTS: ProjectWithStats[] = [
  makeProject({
    id: PROJ_OVER_ID,
    name: 'LioCare',
    color: '#2E9E6F',
    icon: 'Briefcase',
    defaultGoalId: GOAL_COMPANY_ID,
    weeklyTimeMinutes: 240,
    weeklyFocusMinutes: 430,
    weeklyVarianceStatus: 'over',
  }),
  makeProject({
    id: PROJ_UNDER_ID,
    name: 'Veyra App',
    color: '#3B4BD8',
    icon: 'Rocket',
    defaultGoalId: GOAL_PERSONAL_ID,
    weeklyTimeMinutes: 240,
    weeklyFocusMinutes: 110,
    weeklyVarianceStatus: 'under',
  }),
  makeProject({
    id: PROJ_UNTOUCHED_ID,
    name: 'Read Offer',
    color: '#D9772B',
    icon: 'Layers',
    defaultGoalId: GOAL_COMPANY_ID,
    weeklyTimeMinutes: 120,
    weeklyFocusMinutes: 0,
    weeklyVarianceStatus: 'untouched',
  }),
  makeProject({
    id: PROJ_NOPLAN_ID,
    name: 'Covestro',
    color: '#2A8FBD',
    icon: 'Globe',
    defaultGoalId: null,
    weeklyTimeMinutes: null,
    weeklyFocusMinutes: 140,
    weeklyVarianceStatus: 'time_without_plan',
  }),
  makeProject({
    id: PROJ_ONTRACK_ID,
    name: 'Core Platform',
    color: '#8B5CF6',
    icon: 'Cpu',
    defaultGoalId: GOAL_PERSONAL_ID,
    weeklyTimeMinutes: 180,
    weeklyFocusMinutes: 175,
    weeklyVarianceStatus: 'on_track',
  }),
];

function makeBlock(overrides: Partial<Block> & Pick<Block, 'id' | 'title'>): Block {
  return {
    projectId: PROJ_UNDER_ID,
    goalId: GOAL_PERSONAL_ID,
    isOps: false,
    bucket: 'scheduled',
    scheduledDate: '2026-11-26',
    plannedStartAt: null,
    plannedEndAt: null,
    dueDate: null,
    revisitAt: null,
    orderKey: 'a0',
    status: 'todo',
    carryoverCount: 0,
    sizeMinutes: 60,
    energySignal: null,
    senseSignal: null,
    dropReason: null,
    outcomeNote: null,
    resumeNote: null,
    autoSummary: null,
    recurrenceRule: null,
    seriesId: null,
    notes: '',
    externalLinks: [],
    updatedAt: '2026-11-27T08:00:00.000Z',
    deletedAt: null,
    ...overrides,
  };
}

const TEST_NOTES: DailyNote[] = [
  {
    id: 'aaaa1111-1111-4111-8111-111111111111',
    date: '2026-11-24',
    content: 'Morning deep block before Slack doubled output.',
    projectId: PROJ_UNDER_ID,
    goalId: GOAL_PERSONAL_ID,
    isOps: false,
    createdAt: '2026-11-24T11:00:00.000Z',
    updatedAt: '2026-11-24T11:00:00.000Z',
    deletedAt: null,
  },
  {
    id: 'aaaa2222-2222-4222-8222-222222222222',
    date: '2026-11-26',
    content: 'Client onboarding calls spilled over Tuesday afternoon.',
    projectId: PROJ_OVER_ID,
    goalId: GOAL_COMPANY_ID,
    isOps: true,
    createdAt: '2026-11-26T16:30:00.000Z',
    updatedAt: '2026-11-26T16:30:00.000Z',
    deletedAt: null,
  },
];

function createReviewPayload(overrides: Partial<ReviewResponse> = {}): ReviewResponse {
  return {
    weekStartDate: '2026-11-23',
    weekEndDate: '2026-11-29',
    weekNumber: 48,
    timezone: 'Europe/Berlin',
    chapterOpeningSentences: {
      week: '14h 15m focus, 2h under your room, 76% on goals.',
      progress: 'Generate upsells moved twice, Write technical essays stayed quiet.',
      time: 'LioCare took 3h 10m more than planned, Veyra App 2h 10m less.',
      nextWeek: '2 backlog items to decide, 1 rule to pick.',
    },
    previousRuleKept: null,
    totalFocusMinutes: 855,
    roomMinutesTotal: 975,
    plannedMinutesTotal: 1020,
    goalAlignmentPct: 76,
    companyGoalMinutes: 430,
    personalGoalMinutes: 220,
    companyGoalPct: 50,
    personalGoalPct: 26,
    buildMinutes: 675,
    opsMinutes: 180,
    energyCounts: { up: 7, neutral: 2, down: 1 },
    senseCounts: { moved: 4, partly: 1, motion: 1 },
    dayStrip: [
      { date: '2026-11-23', weekday: 'Mon', focusMinutes: 210, plannedMinutes: 240, roomMinutes: 210, meetingMinutes: 60 },
      { date: '2026-11-24', weekday: 'Tue', focusMinutes: 180, plannedMinutes: 240, roomMinutes: 195, meetingMinutes: 90 },
      { date: '2026-11-25', weekday: 'Wed', focusMinutes: 165, plannedMinutes: 180, roomMinutes: 195, meetingMinutes: 45 },
      { date: '2026-11-26', weekday: 'Thu', focusMinutes: 180, plannedMinutes: 210, roomMinutes: 195, meetingMinutes: 30 },
      { date: '2026-11-27', weekday: 'Fri', focusMinutes: 120, plannedMinutes: 150, roomMinutes: 180, meetingMinutes: 60 },
    ],
    goalReviews: [
      {
        goalId: GOAL_COMPANY_ID,
        name: 'Generate upsells',
        kind: 'company',
        color: '#34D399',
        status: 'active',
        doneWhen: '3 upsell proposals closed this quarter',
        checkInDate: '2026-11-27',
        measure: '1 / 3 closed',
        ifItStalls: 'Pair with account leads on executive summaries',
        rankInKind: 1,
        focusMinutes: 240,
        blockCount: 3,
        senseCounts: { moved: 2, partly: 1, motion: 0 },
        topOutcomes: ['Sent Acme expansion proposal', 'Validated pricing tiers with CS'],
        isCheckInDue: true,
        isQuietTwoWeeks: false,
        isStalled: false,
      },
      {
        goalId: GOAL_PERSONAL_ID,
        name: 'Ship Veyra v1',
        kind: 'personal',
        color: '#4DA3FF',
        status: 'active',
        doneWhen: 'All 4 target design slices shipped',
        checkInDate: '2026-12-20',
        measure: '3 / 4 slices',
        ifItStalls: 'Cut secondary visual polish first',
        rankInKind: 1,
        focusMinutes: 180,
        blockCount: 2,
        senseCounts: { moved: 2, partly: 0, motion: 0 },
        topOutcomes: ['Completed Today Fit Line UI'],
        isCheckInDue: false,
        isQuietTwoWeeks: false,
        isStalled: false,
      },
      {
        goalId: GOAL_QUIET_ID,
        name: 'Write technical essays',
        kind: 'personal',
        color: '#9D7FF7',
        status: 'active',
        doneWhen: '2 deep-dive posts published',
        checkInDate: '2026-12-30',
        measure: null,
        ifItStalls: 'Shrink scope to one 500-word note',
        rankInKind: 2,
        focusMinutes: 0,
        blockCount: 0,
        senseCounts: { moved: 0, partly: 0, motion: 0 },
        topOutcomes: [],
        isCheckInDue: false,
        isQuietTwoWeeks: true,
        isStalled: true,
      },
    ],
    worthSecondLook: [
      makeBlock({
        id: BLOCK_MOTION_ID,
        title: 'Reorganize internal wiki folders',
        projectId: PROJ_OVER_ID,
        goalId: GOAL_COMPANY_ID,
        status: 'done',
        senseSignal: 'motion',
        outcomeNote: 'Renamed folders without advancing pilot',
      }),
    ],
    projectBuckets: {
      moreThanPlanned: [
        {
          projectId: PROJ_OVER_ID,
          weeklyTimeMinutes: 240,
          realMinutes: 430,
          differenceMinutes: 190,
          blockCount: 6,
          carryoverCount: 1,
          trend4w: [180, 240, 320, 430],
          varianceStatus: 'over',
        },
      ],
      lessThanPlanned: [
        {
          projectId: PROJ_UNDER_ID,
          weeklyTimeMinutes: 240,
          realMinutes: 110,
          differenceMinutes: -130,
          blockCount: 2,
          carryoverCount: 2,
          trend4w: [240, 210, 160, 110],
          varianceStatus: 'under',
        },
      ],
      wantedUntouched: [
        {
          projectId: PROJ_UNTOUCHED_ID,
          weeklyTimeMinutes: 120,
          realMinutes: 0,
          differenceMinutes: -120,
          blockCount: 0,
          carryoverCount: 0,
          trend4w: [90, 60, 30, 0],
          varianceStatus: 'untouched',
        },
      ],
      timeWithoutPlan: [
        {
          projectId: PROJ_NOPLAN_ID,
          weeklyTimeMinutes: null,
          realMinutes: 140,
          differenceMinutes: null,
          blockCount: 2,
          carryoverCount: 0,
          trend4w: [0, 60, 90, 140],
          varianceStatus: 'time_without_plan',
        },
      ],
      onTrack: [
        {
          projectId: PROJ_ONTRACK_ID,
          weeklyTimeMinutes: 180,
          realMinutes: 175,
          differenceMinutes: -5,
          blockCount: 3,
          carryoverCount: 0,
          trend4w: [180, 170, 185, 175],
          varianceStatus: 'on_track',
        },
      ],
    },
    planningFindings: [
      {
        kind: 'overplanning',
        title: 'Wednesdays consistently overplanned',
        summary: 'You planned 2h more than room on 3 of the last 4 Wednesdays.',
        suggestedRule: 'Cap Wednesday plan to 3h before lunch',
      },
      {
        kind: 'size_drift',
        title: 'LioCare blocks run 40% longer than estimated',
        summary: '1h estimates averaged 1h 25m across the last month.',
        suggestedRule: 'Book LioCare client work as 2h blocks',
      },
    ],
    ruleSuggestions: [
      'Cap Wednesday plan to 3h before lunch',
      'Book LioCare client work as 2h blocks',
      'Protect 09:00–11:00 Mon–Thu for Veyra App',
    ],
    progressFeed: [
      {
        kind: 'block',
        id: BLOCK_MOVED_ID,
        title: 'Draft Acme upsell proposal',
        projectId: PROJ_OVER_ID,
        goalId: GOAL_COMPANY_ID,
        isOps: false,
        timestamp: '2026-11-25T11:00:00.000Z',
        outcomeNote: 'Sent Acme expansion proposal',
        autoSummary: 'Built tiered ROI comparison for Q1 renewal.',
        energySignal: 'up',
        senseSignal: 'moved',
        totalFocusMinutes: 120,
      },
      {
        kind: 'block',
        id: BLOCK_MOTION_ID,
        title: 'Reorganize internal wiki folders',
        projectId: PROJ_OVER_ID,
        goalId: GOAL_COMPANY_ID,
        isOps: false,
        timestamp: '2026-11-26T14:00:00.000Z',
        outcomeNote: 'Renamed folders without advancing pilot',
        autoSummary: null,
        energySignal: 'neutral',
        senseSignal: 'motion',
        totalFocusMinutes: 60,
      },
    ],
    dailyNotes: TEST_NOTES,
    opsRadar: {
      totalOpsMinutes: 180,
      pureOpsMinutes: 120,
      goalLinkedOpsMinutes: 60,
      pureOpsItems: [
        {
          key: 'series:ops-triage',
          seriesId: 'ops-triage',
          blockIds: [BLOCK_CARRY_ID],
          title: 'Daily support queue triage',
          projectId: PROJ_OVER_ID,
          goalId: null,
          isGoalLinked: false,
          occurrenceCount: 3,
          totalMinutes: 120,
          autoSummaries: ['Repeated manual ticket tagging across 3 sessions.'],
        },
      ],
      goalLinkedOpsItems: [],
      items: [],
    },
    chronicCarryovers: [
      makeBlock({
        id: BLOCK_CARRY_ID,
        title: 'Clean up staging webhooks',
        projectId: PROJ_UNDER_ID,
        carryoverCount: 4,
      }),
    ],
    pastRevisitLater: [
      makeBlock({
        id: BLOCK_LATER_ID,
        title: 'Audit onboarding docs',
        projectId: PROJ_UNTOUCHED_ID,
        bucket: 'later',
        scheduledDate: null,
        revisitAt: '2026-11-24',
      }),
    ],
    activeRule: null,
    weeklyReview: null,
    activeRuleText: 'Protect 09:00–11:30 for one deep block',
    ruleForNextWeek: '',
    completedAt: null,
    snapshot: null,
    projects: TEST_PROJECTS,
    goals: TEST_GOALS,
    ...overrides,
  };
}

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function createMockShell(overrides: Partial<AppShellContextValue> = {}): AppShellContextValue {
  return {
    route: 'review',
    previousRoute: 'today',
    activeProjectId: null,
    settingsSection: 'integrations',
    activeDrawer: null,
    liveSyncStatus: 'connected',
    focusStatus: null,
    liveElapsedSeconds: 0,
    projects: TEST_PROJECTS,
    goals: TEST_GOALS,
    settings: null,
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
    startFocusAndNavigate: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('4-chapter ReviewView & Settings review.completed toggle', () => {
  it('ReviewView renders 4 chapters, Chapter Bar, opening sentences, Kept it toggle, Mon-Fri day strip, and expandable Daily notes', async () => {
    const user = userEvent.setup();
    const qc = createTestQueryClient();
    const rulePayloads: Array<Record<string, unknown>> = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        const method = (init?.method ?? 'GET').toUpperCase();
        if (url.includes('/api/review/rule') && method === 'PUT') {
          const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
          rulePayloads.push(body);
          return jsonResponse({
            review: {
              id: 'rev-1',
              weekStartDate: '2026-11-23',
              ruleForNextWeek: String(body.ruleForNextWeek ?? ''),
              previousRuleKept: body.previousRuleKept ?? null,
              notes: '',
              completedAt: null,
              snapshotJson: null,
              updatedAt: '2026-11-27T17:00:00.000Z',
              deletedAt: null,
            },
          });
        }
        if (url.includes('/api/review')) {
          return jsonResponse(createReviewPayload());
        }
        return jsonResponse({});
      }),
    );

    render(
      <QueryClientProvider client={qc}>
        <AppShellContext.Provider value={createMockShell()}>
          <ReviewView />
        </AppShellContext.Provider>
      </QueryClientProvider>,
    );

    // Chapter Bar with all 4 jump buttons
    const chapterBar = await screen.findByRole('navigation', { name: /Review chapters/i });
    expect(within(chapterBar).getByRole('button', { name: /1.*Week/i })).toBeInTheDocument();
    expect(within(chapterBar).getByRole('button', { name: /2.*Progress/i })).toBeInTheDocument();
    expect(within(chapterBar).getByRole('button', { name: /3.*Time/i })).toBeInTheDocument();
    expect(within(chapterBar).getByRole('button', { name: /4.*Next week/i })).toBeInTheDocument();

    // All 4 chapter headings & opening sentences
    expect(screen.getByText(/1 · What happened\?/i)).toBeInTheDocument();
    expect(
      screen.getByText('14h 15m focus, 2h under your room, 76% on goals.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/2 · What moved\?/i)).toBeInTheDocument();
    expect(
      screen.getByText('Generate upsells moved twice, Write technical essays stayed quiet.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/3 · Where did the time go\?/i)).toBeInTheDocument();
    expect(
      screen.getByText('LioCare took 3h 10m more than planned, Veyra App 2h 10m less.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/4 · What changes next week\?/i)).toBeInTheDocument();
    expect(screen.getByText('2 backlog items to decide, 1 rule to pick.')).toBeInTheDocument();

    // Kept it? inline toggle on last week's rule
    expect(screen.getByText('Protect 09:00–11:30 for one deep block')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Partly$/i }));
    await waitFor(() => {
      expect(rulePayloads).toContainEqual(
        expect.objectContaining({
          weekStartDate: '2026-11-23',
          previousRuleKept: 'partly',
        }),
      );
    });

    // 5 KPI tiles including Company/Personal split, Sense split, and raw Energy counts
    const energyTile = screen.getByTestId('review-energy-tile');
    expect(energyTile).toHaveTextContent('7+ · 2· · 1−');
    expect(energyTile).not.toHaveTextContent('%');
    expect(screen.getByText(/Company 50% · Personal 26%/i)).toBeInTheDocument();

    // Mon-Fri day strip
    const dayStrip = screen.getByRole('region', { name: /Mon–Fri day strip/i });
    for (const day of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']) {
      expect(within(dayStrip).getByText(day)).toBeInTheDocument();
    }

    // Daily notes collapsed by default (shows count + latest preview, hides earlier note until expanded)
    const dailyNotesSection = screen.getByRole('region', { name: /Daily Notes This Week/i });
    expect(
      within(dailyNotesSection).queryByText('Morning deep block before Slack doubled output.'),
    ).not.toBeInTheDocument();

    // Expand Daily notes inline
    const toggleNotesBtn = within(dailyNotesSection).getByRole('button', {
      name: /Daily notes this week/i,
    });
    expect(toggleNotesBtn).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggleNotesBtn);
    expect(toggleNotesBtn).toHaveAttribute('aria-expanded', 'true');
    expect(
      within(dailyNotesSection).getByText('Morning deep block before Slack doubled output.'),
    ).toBeInTheDocument();
    expect(
      within(dailyNotesSection).getByText('Client onboarding calls spilled over Tuesday afternoon.'),
    ).toBeInTheDocument();
  });

  it('ReviewView toggles Progress Feed between By Goal and By Project, updates goal measure inline, and renders check-in-due and quiet goal prompts', async () => {
    const user = userEvent.setup();
    const qc = createTestQueryClient();
    const openCloseGoal = vi.fn();
    const openCreateBlock = vi.fn();
    const goalPatches: Array<{ id: string; body: Record<string, unknown> }> = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        const method = (init?.method ?? 'GET').toUpperCase();
        if (url.includes('/api/goals/') && method === 'PATCH') {
          const id = url.split('/api/goals/')[1];
          const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
          goalPatches.push({ id, body });
          return jsonResponse({ goal: { ...TEST_GOALS[0], id, ...body } });
        }
        if (url.includes('/api/review')) {
          return jsonResponse(createReviewPayload());
        }
        return jsonResponse({});
      }),
    );

    render(
      <QueryClientProvider client={qc}>
        <AppShellContext.Provider value={createMockShell({ openCloseGoal, openCreateBlock })}>
          <ReviewView />
        </AppShellContext.Provider>
      </QueryClientProvider>,
    );

    // Chapter 2 Goals section shows Company-first, measured totals, zero weekly time target progressbars
    const goalsSection = await screen.findByRole('region', { name: /Goals moved/i });
    expect(within(goalsSection).queryByRole('progressbar')).not.toBeInTheDocument();
    expect(within(goalsSection).getByText(/Company 7h 10m · Personal 3h 40m/i)).toBeInTheDocument();

    // Check-in date reached prompt on Generate upsells
    expect(within(goalsSection).getByText(/Check-in date reached/i)).toBeInTheDocument();
    await user.click(within(goalsSection).getByRole('button', { name: 'Mark Achieved' }));
    expect(openCloseGoal).toHaveBeenCalledWith(GOAL_COMPANY_ID, 'achieved');

    // Continue until... inline date picker updates checkInDate
    await user.click(within(goalsSection).getByRole('button', { name: /Continue until/i }));
    const continueDateInput = within(goalsSection).getByLabelText(/Continue until date for Generate upsells/i);
    await user.clear(continueDateInput);
    await user.type(continueDateInput, '2026-12-31');
    await user.click(within(goalsSection).getByRole('button', { name: /Save date/i }));
    await waitFor(() => {
      expect(goalPatches).toContainEqual({
        id: GOAL_COMPANY_ID,
        body: { checkInDate: '2026-12-31' },
      });
    });

    // Inline "Where are you now?" measure update
    const measureInput = within(goalsSection).getByLabelText(
      /Where are you now for Generate upsells/i,
    );
    await user.clear(measureInput);
    await user.type(measureInput, '2 / 3 closed');
    await user.click(
      within(goalsSection).getByRole('button', { name: /Save measure for Generate upsells/i }),
    );
    await waitFor(() => {
      expect(goalPatches).toContainEqual({
        id: GOAL_COMPANY_ID,
        body: { measure: '2 / 3 closed', measureWeekStartDate: '2026-11-23' },
      });
    });

    // Quiet goal prompt (2 quiet weeks + stalled ifItStalls line)
    expect(within(goalsSection).getByText(/Shrink scope to one 500-word note/i)).toBeInTheDocument();
    await user.click(within(goalsSection).getByRole('button', { name: /^Pause$/i }));
    const pauseDateInput = within(goalsSection).getByLabelText(/Defer check-in date for Write technical essays/i);
    expect(pauseDateInput).toBeInTheDocument();
    await user.click(within(goalsSection).getByRole('button', { name: /Save check-in/i }));
    await waitFor(() => {
      expect(goalPatches.some((p) => p.id === GOAL_QUIET_ID && typeof p.body.checkInDate === 'string' && !('status' in p.body))).toBe(true);
    });

    // Keep dismisses quiet prompt and offers + Queue Monday block
    await user.click(within(goalsSection).getByRole('button', { name: /^Keep$/i }));
    const queueBtn = within(goalsSection).getByRole('button', { name: /\+ Queue Monday block/i });
    await user.click(queueBtn);
    expect(openCreateBlock).toHaveBeenCalledWith({
      goalId: GOAL_QUIET_ID,
      scheduledDate: '2026-11-30',
    });

    // Worth a second look renders motion block
    const secondLook = screen.getByRole('region', { name: /Worth a second look/i });
    expect(within(secondLook).getByText('Reorganize internal wiki folders')).toBeInTheDocument();

    // Progress Feed defaults to By Goal and switches to By Project via topbar toggle
    const feed = screen.getByRole('region', { name: 'Progress Feed' });
    expect(within(feed).getByTestId('progress-group-goal')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'By Project' }));
    expect(within(feed).getByTestId('progress-group-project')).toBeInTheDocument();
    expect(within(feed).getByText('LioCare')).toBeInTheDocument();
  });

  it('ReviewView renders 4 project variance buckets, expands collapsed On track rows on click, and renders What your planning taught you findings', async () => {
    const user = userEvent.setup();
    const qc = createTestQueryClient();

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/api/review')) return jsonResponse(createReviewPayload());
        return jsonResponse({});
      }),
    );

    render(
      <QueryClientProvider client={qc}>
        <AppShellContext.Provider value={createMockShell()}>
          <ReviewView />
        </AppShellContext.Provider>
      </QueryClientProvider>,
    );

    const projectTable = await screen.findByRole('region', { name: /Project time breakdown/i });
    expect(within(projectTable).getByText('More than planned')).toBeInTheDocument();
    expect(within(projectTable).getByText('Less than planned')).toBeInTheDocument();
    expect(within(projectTable).getByText('Wanted but untouched')).toBeInTheDocument();
    expect(within(projectTable).getByText('Time without a plan')).toBeInTheDocument();

    expect(within(projectTable).getByText('LioCare')).toBeInTheDocument();
    expect(within(projectTable).getByText('Veyra App')).toBeInTheDocument();
    expect(within(projectTable).getByText('Read Offer')).toBeInTheDocument();
    expect(within(projectTable).getByText('Covestro')).toBeInTheDocument();

    // On track is collapsed by default
    expect(within(projectTable).queryByText('Core Platform')).not.toBeInTheDocument();
    const onTrackToggle = within(projectTable).getByRole('button', { name: /On track/i });
    expect(onTrackToggle).toHaveAttribute('aria-expanded', 'false');

    // Expanding On track shows Core Platform
    await user.click(onTrackToggle);
    expect(onTrackToggle).toHaveAttribute('aria-expanded', 'true');
    expect(within(projectTable).getByText('Core Platform')).toBeInTheDocument();

    // What your planning taught you shows findings and clickable rule button
    const findings = screen.getByRole('region', { name: /What your planning taught you/i });
    expect(within(findings).getByText('Wednesdays consistently overplanned')).toBeInTheDocument();
    expect(within(findings).getByText('LioCare blocks run 40% longer than estimated')).toBeInTheDocument();
  });

  it('ReviewView edits next-week project weekly time inline, picks a suggested rule directly on canvas, and completes review into Completed & Auto-Synced state with Copy Markdown', async () => {
    const user = userEvent.setup();
    const qc = createTestQueryClient();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    const projectPatches: Array<{ id: string; body: Record<string, unknown> }> = [];
    let completeBody: Record<string, unknown> | null = null;

    const completedSnapshot: WeeklyReviewSnapshot = {
      weekStartDate: '2026-11-23',
      weekEndDate: '2026-11-29',
      weekNumber: 48,
      completedAt: '2026-11-27T17:30:00.000Z',
      totalFocusMinutes: 855,
      roomMinutesTotal: 975,
      plannedMinutesTotal: 1020,
      goalAlignmentPct: 76,
      companyGoalPct: 50,
      personalGoalPct: 26,
      buildMinutes: 675,
      opsMinutes: 180,
      senseCounts: { moved: 4, partly: 1, motion: 1 },
      energyCounts: { up: 7, neutral: 2, down: 1 },
      previousRuleText: 'Protect 09:00–11:30 for one deep block',
      previousRuleKept: 'partly',
      ruleForNextWeek: 'Cap Wednesday plan to 3h before lunch',
      goalsMoved: [
        {
          goalId: GOAL_COMPANY_ID,
          name: 'Generate upsells',
          kind: 'company',
          color: '#34D399',
          focusMinutes: 240,
          blockCount: 3,
          movedCount: 2,
          measure: '1 / 3 closed',
          topOutcomes: ['Sent Acme expansion proposal'],
        },
      ],
      projectWeeklyTimes: [
        {
          projectId: PROJ_OVER_ID,
          name: 'LioCare',
          weeklyTimeMinutes: 300,
          realMinutes: 430,
        },
      ],
    };

    let isCompleted = false;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        const method = (init?.method ?? 'GET').toUpperCase();

        if (url.includes('/api/projects/') && method === 'PATCH') {
          const id = url.split('/api/projects/')[1];
          const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
          projectPatches.push({ id, body });
          return jsonResponse({ project: { ...TEST_PROJECTS[0], id, ...body } });
        }
        if (url.includes('/api/review/complete') && method === 'POST') {
          completeBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
          isCompleted = true;
          const completedSummary = createReviewPayload({
            completedAt: completedSnapshot.completedAt,
            ruleForNextWeek: completedSnapshot.ruleForNextWeek,
            snapshot: completedSnapshot,
          });
          return jsonResponse({
            review: {
              id: 'rev-1',
              weekStartDate: '2026-11-23',
              ruleForNextWeek: completedSnapshot.ruleForNextWeek,
              previousRuleKept: 'partly',
              notes: '',
              completedAt: completedSnapshot.completedAt,
              snapshotJson: JSON.stringify(completedSnapshot),
              updatedAt: completedSnapshot.completedAt,
              deletedAt: null,
            },
            summary: completedSummary,
            snapshot: completedSnapshot,
          });
        }
        if (url.includes('/api/review/reopen') && method === 'POST') {
          isCompleted = false;
          return jsonResponse({
            review: {
              id: 'rev-1',
              weekStartDate: '2026-11-23',
              ruleForNextWeek: completedSnapshot.ruleForNextWeek,
              previousRuleKept: 'partly',
              notes: '',
              completedAt: null,
              snapshotJson: null,
              updatedAt: '2026-11-27T17:35:00.000Z',
              deletedAt: null,
            },
          });
        }
        if (url.includes('/api/review')) {
          return jsonResponse(
            isCompleted
              ? createReviewPayload({
                  completedAt: completedSnapshot.completedAt,
                  ruleForNextWeek: completedSnapshot.ruleForNextWeek,
                  snapshot: completedSnapshot,
                })
              : createReviewPayload(),
          );
        }
        return jsonResponse({});
      }),
    );

    render(
      <QueryClientProvider client={qc}>
        <AppShellContext.Provider value={createMockShell()}>
          <ReviewView />
        </AppShellContext.Provider>
      </QueryClientProvider>,
    );

    // Edit LioCare next-week weekly time inline (4h -> 5h = 300m)
    const nextWeekTable = await screen.findByRole('region', { name: /Weekly time for next week/i });
    const lioInput = within(nextWeekTable).getByLabelText(/Weekly time hours for LioCare/i);
    await user.clear(lioInput);
    await user.type(lioInput, '5');
    await user.tab();

    await waitFor(() => {
      expect(projectPatches).toContainEqual({
        id: PROJ_OVER_ID,
        body: { weeklyTimeMinutes: 300 },
      });
    });

    // Rule editor sits directly on #131313 canvas (zero card-in-card: no .veyra-card container)
    const ruleCanvas = screen.getByTestId('review-rule-canvas');
    expect(ruleCanvas.className).not.toContain('veyra-card');
    expect(ruleCanvas.closest('.veyra-card')).toBeNull();

    // Pick a suggested rule chip
    await user.click(
      within(ruleCanvas).getByRole('button', { name: 'Cap Wednesday plan to 3h before lunch' }),
    );
    const ruleInput = screen.getByLabelText(/Rule for next week/i);
    expect(ruleInput).toHaveValue('Cap Wednesday plan to 3h before lunch');

    // Complete Review -> transitions to Completed & Auto-Synced state
    await user.click(screen.getByRole('button', { name: /Complete Review/i }));

    await waitFor(() => {
      expect(completeBody).toMatchObject({
        weekStartDate: '2026-11-23',
        ruleForNextWeek: 'Cap Wednesday plan to 3h before lunch',
      });
    });

    // Completed & Auto-Synced banner and Snapshot card
    expect(
      await screen.findByText(/Week 48 wrapped · automatically synced to T3 Code/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/WEEK 48 SNAPSHOT · AUTO-SYNCED VIA LOCAL HOOK/i),
    ).toBeInTheDocument();
    expect(screen.getByText('Focus & rhythm')).toBeInTheDocument();
    expect(screen.getByText('Goals moved')).toBeInTheDocument();
    expect(screen.getByText('Week 49 commitments')).toBeInTheDocument();

    // Copy Markdown copies structured snapshot
    await user.click(screen.getByRole('button', { name: /Copy Markdown/i }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1);
    });
    const copiedMarkdown = writeText.mock.calls[0][0] as string;
    expect(copiedMarkdown).toContain('Week 48');
    expect(copiedMarkdown).toContain('Cap Wednesday plan to 3h before lunch');
    expect(copiedMarkdown).toContain('Generate upsells');

    // Reopen review returns to editable 4-chapter view
    await user.click(screen.getByRole('button', { name: /Reopen review/i }));
    expect(await screen.findByText(/1 · What happened\?/i)).toBeInTheDocument();
  });

  it('Kept it? toggle (Yes / Partly / No) omits ruleForNextWeek and does not show "Saved for next week"', async () => {
    const user = userEvent.setup();
    const qc = createTestQueryClient();
    const rulePayloads: Array<Record<string, unknown>> = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        const method = (init?.method ?? 'GET').toUpperCase();
        if (url.includes('/api/review/rule') && method === 'PUT') {
          const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
          rulePayloads.push(body);
          return jsonResponse({
            review: {
              id: 'rev-1',
              weekStartDate: '2026-11-23',
              ruleForNextWeek: 'Existing saved rule for next week',
              previousRuleKept: body.previousRuleKept ?? null,
              notes: '',
              completedAt: null,
              snapshotJson: null,
              updatedAt: '2026-11-27T17:00:00.000Z',
              deletedAt: null,
            },
          });
        }
        if (url.includes('/api/review')) {
          return jsonResponse(
            createReviewPayload({
              ruleForNextWeek: 'Existing saved rule for next week',
            }),
          );
        }
        return jsonResponse({});
      }),
    );

    render(
      <QueryClientProvider client={qc}>
        <AppShellContext.Provider value={createMockShell()}>
          <ReviewView />
        </AppShellContext.Provider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Protect 09:00–11:30 for one deep block')).toBeInTheDocument();

    for (const [label, expected] of [
      ['Yes', 'yes'],
      ['Partly', 'partly'],
      ['No', 'no'],
    ] as const) {
      const prevCount = rulePayloads.length;
      await user.click(screen.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }));
      await waitFor(() => {
        expect(rulePayloads.length).toBe(prevCount + 1);
      });
      const payload = rulePayloads[rulePayloads.length - 1];
      expect(payload).toEqual({
        weekStartDate: '2026-11-23',
        previousRuleKept: expected,
      });
      expect('ruleForNextWeek' in payload).toBe(false);
      expect(screen.queryByText(/Saved for next week/i)).not.toBeInTheDocument();
    }
  });

  it('wraps ISO week number to Week 1 at year end (2026-12-28 / Week 53) in Chapter 4, Snapshot card, and Copy Markdown', async () => {
    const user = userEvent.setup();
    const qc = createTestQueryClient();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    const yearEndSnapshot: WeeklyReviewSnapshot = {
      weekStartDate: '2026-12-28',
      weekEndDate: '2027-01-03',
      weekNumber: 53,
      completedAt: '2027-01-01T17:00:00.000Z',
      totalFocusMinutes: 300,
      roomMinutesTotal: 480,
      plannedMinutesTotal: 360,
      goalAlignmentPct: 80,
      companyGoalPct: 50,
      personalGoalPct: 30,
      buildMinutes: 240,
      opsMinutes: 60,
      senseCounts: { moved: 2, partly: 1, motion: 0 },
      energyCounts: { up: 3, neutral: 1, down: 0 },
      previousRuleText: 'Protect morning focus',
      previousRuleKept: 'yes',
      ruleForNextWeek: 'Start January with one deep block daily',
      goalsMoved: [],
      projectWeeklyTimes: [
        {
          projectId: PROJ_OVER_ID,
          name: 'LioCare',
          weeklyTimeMinutes: 240,
          realMinutes: 240,
        },
      ],
    };

    let isCompleted = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        const method = (init?.method ?? 'GET').toUpperCase();
        if (url.includes('/api/review/complete') && method === 'POST') {
          isCompleted = true;
          return jsonResponse({
            review: {
              id: 'rev-53',
              weekStartDate: '2026-12-28',
              ruleForNextWeek: yearEndSnapshot.ruleForNextWeek,
              previousRuleKept: 'yes',
              notes: '',
              completedAt: yearEndSnapshot.completedAt,
              snapshotJson: JSON.stringify(yearEndSnapshot),
              updatedAt: yearEndSnapshot.completedAt,
              deletedAt: null,
            },
            summary: createReviewPayload({
              weekStartDate: '2026-12-28',
              weekEndDate: '2027-01-03',
              weekNumber: 53,
              completedAt: yearEndSnapshot.completedAt,
              ruleForNextWeek: yearEndSnapshot.ruleForNextWeek,
              snapshot: yearEndSnapshot,
            }),
            snapshot: yearEndSnapshot,
          });
        }
        if (url.includes('/api/review')) {
          return jsonResponse(
            createReviewPayload({
              weekStartDate: '2026-12-28',
              weekEndDate: '2027-01-03',
              weekNumber: 53,
              completedAt: isCompleted ? yearEndSnapshot.completedAt : null,
              ruleForNextWeek: yearEndSnapshot.ruleForNextWeek,
              snapshot: isCompleted ? yearEndSnapshot : null,
            }),
          );
        }
        return jsonResponse({});
      }),
    );

    render(
      <QueryClientProvider client={qc}>
        <AppShellContext.Provider value={createMockShell()}>
          <ReviewView />
        </AppShellContext.Provider>
      </QueryClientProvider>,
    );

    // Chapter 4 shows Week 1 (not Week 54)
    const nextWeekTable = await screen.findByRole('region', { name: /Weekly time for next week/i });
    expect(within(nextWeekTable).getByText('Weekly time for Week 1')).toBeInTheDocument();
    expect(within(nextWeekTable).queryByText(/Week 54/i)).not.toBeInTheDocument();

    // Complete Review -> Snapshot card shows Week 1 commitments (not Week 54)
    await user.click(screen.getByRole('button', { name: /Complete Review/i }));
    expect(await screen.findByText('Week 1 commitments')).toBeInTheDocument();
    expect(screen.queryByText(/Week 54/i)).not.toBeInTheDocument();

    // Copy Markdown outputs "## Week 1 commitments"
    await user.click(screen.getByRole('button', { name: /Copy Markdown/i }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1);
    });
    const copiedMarkdown = writeText.mock.calls[0][0] as string;
    expect(copiedMarkdown).toContain('# Week 53 Review (2026-12-28 – 2027-01-03)');
    expect(copiedMarkdown).toContain('## Week 1 commitments');
    expect(copiedMarkdown).not.toContain('Week 54');
  });

  it('SettingsView Integrations lists review.completed webhook event toggle', async () => {
    const user = userEvent.setup();
    const qc = createTestQueryClient();
    let savedWebhookEvents: string[] | null = null;

    const settingsPayload: SettingsResponse = {
      settings: {
        id: 'default',
        theme: 'dark',
        timezone: 'Europe/Berlin',
        onboardingCompleted: true,
        serverUrl: null,
        calendarSyncMode: 'manual',
        outlookCliCommand: null,
        icsFeedUrl: null,
        calendarSyncIntervalMin: 15,
        skipDeclinedAndAllDay: true,
        lastCalendarSyncAt: null,
        webhookUrl: 'http://127.0.0.1:4174/hooks/veyra',
        webhookEvents: ['focus.started', 'focus.ended', 'block.completed'],
        notionOauthClientId: null,
        notionOauthRedirectUri: null,
        notionWorkspaceName: null,
        notionConfigured: false,
        notionTokenSource: null,
        notionOauthConfigured: false,
        macosFocusEnabled: false,
        macosFocusStartShortcut: null,
        macosFocusEndShortcut: null,
        globalCaptureShortcut: 'CommandOrControl+Shift+P',
        hotkeys: {},
        runInMenuBar: true,
        updatedAt: '2026-11-27T10:00:00.000Z',
      } as PublicSettings,
      calendarSyncStatus: {
        state: 'manual',
        lastSyncAt: null,
        lastCount: 0,
        lastError: null,
      },
      notionConfigured: false,
    };

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        const method = (init?.method ?? 'GET').toUpperCase();
        if (url.includes('/api/settings') && method === 'PATCH') {
          const body = JSON.parse(String(init?.body ?? '{}')) as { webhookEvents?: string[] };
          savedWebhookEvents = body.webhookEvents ?? null;
          return jsonResponse(settingsPayload);
        }
        if (url.includes('/api/settings')) return jsonResponse(settingsPayload);
        if (url.includes('/api/projects')) return jsonResponse({ projects: [] });
        if (url.includes('/api/activity')) return jsonResponse({ activity: [] });
        if (url.includes('/api/integrations/macos-focus/shortcuts')) {
          return jsonResponse({ supported: false, shortcuts: [] });
        }
        return jsonResponse({});
      }),
    );

    render(
      <QueryClientProvider client={qc}>
        <AppShellContext.Provider value={createMockShell({ route: 'settings' })}>
          <SettingsView section="integrations" />
        </AppShellContext.Provider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('review.completed')).toBeInTheDocument();
    expect(
      screen.getByText(/Fires when a Weekly Review is wrapped so T3 Code syncs next week's rule and snapshot/i),
    ).toBeInTheDocument();

    const reviewToggle = screen.getByRole('switch', { name: /review\.completed/i });
    expect(reviewToggle).toHaveAttribute('aria-checked', 'false');
    await user.click(reviewToggle);
    expect(reviewToggle).toHaveAttribute('aria-checked', 'true');

    await user.click(screen.getByRole('button', { name: /Save Webhook/i }));
    await waitFor(() => {
      expect(savedWebhookEvents).toContain('review.completed');
    });
  });
});
