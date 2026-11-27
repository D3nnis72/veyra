import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import type { Block, GoalWithStats, ProjectWithStats } from '@veyra/core/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TodayResponse } from '../src/api/client';
import { AppShellContext, type AppShellContextValue } from '../src/app/AppShellContext';
import { FocusView } from '../src/views/FocusView';
import { TodayView } from '../src/views/TodayView';

const GOAL_1_ID = '11111111-1111-4111-8111-111111111111';
const PROJ_1_ID = '22222222-2222-4222-8222-222222222222';
const PROJ_2_ID = '33333333-3333-4333-8333-333333333333';
const BLOCK_A_ID = '44444444-4444-4444-8444-444444444444';
const BLOCK_B_ID = '55555555-5555-4555-8555-555555555555';
const BLOCK_C_ID = '66666666-6666-4666-8666-666666666666';
const BLOCK_D_ID = '77777777-7777-4777-8777-777777777777';

const TEST_GOAL: GoalWithStats = {
  id: GOAL_1_ID,
  name: 'Ship Veyra v1',
  kind: 'company',
  description: 'Deliver calm local-first prioritization',
  doneWhen: 'Daily capacity and weekly review live in desktop app',
  checkInDate: '2026-12-15',
  measure: '3/4 slices done',
  ifItStalls: 'Cut scope to core Today + Focus flows',
  closingNote: null,
  closedAt: null,
  color: '#34D399',
  status: 'active',
  orderKey: 'a0',
  updatedAt: '2026-11-25T08:00:00.000Z',
  deletedAt: null,
  weeklyFocusMinutes: 180,
  weeklyBlockCount: 3,
  linkedProjectCount: 1,
  rankInKind: 1,
};

const TEST_PROJECTS: ProjectWithStats[] = [
  {
    id: PROJ_1_ID,
    name: 'Veyra Core',
    description: 'Desktop and web client',
    color: '#3B4BD8',
    icon: 'Rocket',
    defaultGoalId: GOAL_1_ID,
    isPinned: true,
    isSystem: false,
    status: 'active',
    notionUrl: null,
    matchKeywords: [],
    weeklyTimeMinutes: 300,
    createdAt: '2026-11-01T08:00:00.000Z',
    updatedAt: '2026-11-25T08:00:00.000Z',
    deletedAt: null,
    isQuiet: false,
    weeklyFocusMinutes: 180,
    weeklyVarianceStatus: 'under',
    weeklyHistory8w: [],
    averageWeeklyMinutes8w: 240,
    learnedBlockSizeMinutes: 60,
    sizeDriftPct: 0,
    openBlockCount: 4,
    nextBlockTitle: 'Ship capacity UI',
    lastTouchedAt: '2026-11-25T08:00:00.000Z',
  },
  {
    id: PROJ_2_ID,
    name: 'Customer Ops',
    description: 'Support and admin',
    color: '#D9772B',
    icon: 'Briefcase',
    defaultGoalId: null,
    isPinned: false,
    isSystem: false,
    status: 'active',
    notionUrl: null,
    matchKeywords: [],
    weeklyTimeMinutes: null,
    createdAt: '2026-11-01T08:00:00.000Z',
    updatedAt: '2026-11-25T08:00:00.000Z',
    deletedAt: null,
    isQuiet: false,
    weeklyFocusMinutes: 60,
    weeklyVarianceStatus: 'unplanned',
    weeklyHistory8w: [],
    averageWeeklyMinutes8w: 60,
    learnedBlockSizeMinutes: 30,
    sizeDriftPct: null,
    openBlockCount: 2,
    nextBlockTitle: 'Clean Slack triage queue',
    lastTouchedAt: '2026-11-25T08:00:00.000Z',
  },
];

function makeBlock(overrides: Partial<Block> & Pick<Block, 'id' | 'title'>): Block {
  return {
    projectId: PROJ_1_ID,
    goalId: GOAL_1_ID,
    isOps: false,
    bucket: 'scheduled',
    scheduledDate: '2026-11-25',
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
    updatedAt: '2026-11-25T08:00:00.000Z',
    deletedAt: null,
    ...overrides,
  };
}

const BLOCK_A = makeBlock({
  id: BLOCK_A_ID,
  title: 'Clean Slack triage queue',
  projectId: PROJ_2_ID,
  goalId: null,
  isOps: true,
  sizeMinutes: 60,
  orderKey: 'a0',
});

const BLOCK_B = makeBlock({
  id: BLOCK_B_ID,
  title: 'Ship capacity UI',
  projectId: PROJ_1_ID,
  goalId: GOAL_1_ID,
  sizeMinutes: 120,
  orderKey: 'a1',
});

const BLOCK_C = makeBlock({
  id: BLOCK_C_ID,
  title: 'Send Q4 rollout plan to Alex',
  projectId: PROJ_1_ID,
  goalId: GOAL_1_ID,
  dueDate: '2026-11-25',
  sizeMinutes: 60,
  orderKey: 'a2',
});

const BLOCK_D = makeBlock({
  id: BLOCK_D_ID,
  title: 'Tidy local scripts',
  projectId: PROJ_2_ID,
  goalId: null,
  isOps: true,
  sizeMinutes: 30,
  orderKey: 'a3',
});

function createTodayPayload(overrides: Partial<TodayResponse> = {}): TodayResponse {
  return {
    date: '2026-11-25',
    timezone: 'Europe/Berlin',
    weeklyRule: 'Finish one deep block before noon',
    nextWeekRule: null,
    focusStatus: {
      activeSession: null,
      activeBlock: null,
      elapsedSeconds: 0,
      focusedTodayMinutes: 45,
    },
    upNext: [BLOCK_A, BLOCK_B, BLOCK_C, BLOCK_D],
    completedToday: [],
    upcomingEvents: [],
    todayEvents: [],
    dailyNotesCount: 0,
    projects: TEST_PROJECTS,
    goals: [TEST_GOAL],
    roomToday: {
      roomMinutes: 220, // 3h 40m
      baselineFocusMinutes: 310,
      focusedTodayMinutes: 90, // 1h 30m
      focusBudgetLeftMinutes: 220, // 3h 40m
      freeTimeLeftMinutes: 300, // 5h
      meetingMinutes: 90, // 1h 30m
      countsFromNow: true,
      workdayStart: '09:00',
      workdayEnd: '18:00',
      hasLearnedBaseline: true,
      weekdayLabel: 'Monday',
    },
    suggestedOrder: [
      {
        blockId: BLOCK_C_ID,
        effectiveSizeMinutes: 60,
        reason: 'Due today',
        isChronicCarryover: false,
        isMotionHotSpot: false,
        isBehindWeeklyTime: true,
      },
      {
        blockId: BLOCK_B_ID,
        effectiveSizeMinutes: 120,
        reason: 'Goal: Ship Veyra v1 · behind weekly time',
        isChronicCarryover: false,
        isMotionHotSpot: false,
        isBehindWeeklyTime: true,
      },
      {
        blockId: BLOCK_A_ID,
        effectiveSizeMinutes: 60,
        reason: 'Ops — batch after main work',
        isChronicCarryover: false,
        isMotionHotSpot: false,
        isBehindWeeklyTime: false,
      },
      {
        blockId: BLOCK_D_ID,
        effectiveSizeMinutes: 30,
        reason: 'Ops — batch after main work',
        isChronicCarryover: false,
        isMotionHotSpot: false,
        isBehindWeeklyTime: false,
      },
    ],
    fitLine: {
      fitLineIndex: 2,
      fittingMinutes: 180,
      remainingMinutes: 40,
      overflowBlockCount: 2,
      overflowMinutes: 90,
    },
    dayLookBack: null,
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
    route: 'today',
    previousRoute: 'today',
    activeProjectId: null,
    settingsSection: 'integrations',
    activeDrawer: null,
    liveSyncStatus: 'connected',
    focusStatus: null,
    liveElapsedSeconds: 0,
    projects: TEST_PROJECTS,
    goals: [TEST_GOAL],
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

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('TodayView prioritization, capacity, exits, Tell someone, Drop reason & Day look back', () => {
  it('TodayView displays Room today, one-line reasons, Fit Line, and Probably not today overflow rows', async () => {
    const qc = createTestQueryClient();
    const payload = createTodayPayload();

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/api/today')) return jsonResponse(payload);
        if (url.includes('/api/calendar')) {
          return jsonResponse({
            startDate: '2026-11-25',
            endDate: '2026-11-25',
            timezone: 'Europe/Berlin',
            sessions: [],
            plannedBlocks: [],
            events: [],
            projects: TEST_PROJECTS,
            goals: [TEST_GOAL],
          });
        }
        return jsonResponse({});
      }),
    );

    render(
      <QueryClientProvider client={qc}>
        <AppShellContext.Provider value={createMockShell()}>
          <TodayView />
        </AppShellContext.Provider>
      </QueryClientProvider>,
    );

    // Room today line beneath date (with clickable working-until button)
    const roomLine = await screen.findByTestId('room-today-line');
    expect(roomLine).toHaveTextContent(
      /Room today ≈ 3h 40m · 5h free.*until 18:00.*3h 40m of your usual Monday 5h 10m focus budget left/i,
    );
    expect(
      screen.getByRole('button', { name: /Set working end time for today/i }),
    ).toBeInTheDocument();

    // Rule hint in UP NEXT header
    expect(
      screen.getByText(/Order: commitments, goal work, project time, Ops last/i),
    ).toBeInTheDocument();

    // Fitting cards show rough size chips and one-line placement reasons
    expect(screen.getByText('Ship capacity UI')).toBeInTheDocument();
    expect(screen.getByText('Goal: Ship Veyra v1 · behind weekly time')).toBeInTheDocument();
    expect(screen.getByText('2h')).toBeInTheDocument();

    // Fit Line divider
    expect(screen.getByText(/fits today · about 40m left/i)).toBeInTheDocument();

    // Probably not today section with overflow summary and quieter rows
    const overflowRegion = screen.getByRole('region', { name: /Probably not today/i });
    expect(within(overflowRegion).getByText(/2 blocks · 1h 30m past the room/i)).toBeInTheDocument();

    // Block C has dueDate -> shows Tomorrow, Later, Drop, and Tell someone
    const blockCRow = within(overflowRegion)
      .getByText('Send Q4 rollout plan to Alex')
      .closest('[data-overflow-row]') as HTMLElement;
    expect(blockCRow).toBeInTheDocument();
    expect(blockCRow.className).toContain('bg-[#171717]');
    expect(within(blockCRow).getByRole('button', { name: 'Tomorrow' })).toBeInTheDocument();
    expect(within(blockCRow).getByRole('button', { name: 'Later' })).toBeInTheDocument();
    expect(within(blockCRow).getByRole('button', { name: 'Drop' })).toBeInTheDocument();
    expect(within(blockCRow).getByRole('button', { name: 'Tell someone' })).toBeInTheDocument();

    // Block D has no dueDate and does not start with Follow-up: -> no Tell someone
    const blockDRow = within(overflowRegion)
      .getByText('Tidy local scripts')
      .closest('[data-overflow-row]') as HTMLElement;
    expect(blockDRow).toBeInTheDocument();
    expect(within(blockDRow).queryByRole('button', { name: 'Tell someone' })).not.toBeInTheDocument();
  });

  it('clicking Use suggested order calls applySuggestedOrder with the suggested block IDs', async () => {
    const user = userEvent.setup();
    const qc = createTestQueryClient();
    const payload = createTodayPayload();
    let appliedBlockIds: string[] | null = null;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        const method = (init?.method ?? 'GET').toUpperCase();
        if (url.includes('/api/today/apply-suggested-order') && method === 'POST') {
          const body = JSON.parse(String(init?.body ?? '{}')) as { blockIds: string[] };
          appliedBlockIds = body.blockIds;
          return jsonResponse({ blocks: [BLOCK_C, BLOCK_B, BLOCK_A, BLOCK_D] });
        }
        if (url.includes('/api/today')) return jsonResponse(payload);
        if (url.includes('/api/calendar')) {
          return jsonResponse({
            startDate: '2026-11-25',
            endDate: '2026-11-25',
            timezone: 'Europe/Berlin',
            sessions: [],
            plannedBlocks: [],
            events: [],
            projects: TEST_PROJECTS,
            goals: [TEST_GOAL],
          });
        }
        return jsonResponse({});
      }),
    );

    render(
      <QueryClientProvider client={qc}>
        <AppShellContext.Provider value={createMockShell()}>
          <TodayView />
        </AppShellContext.Provider>
      </QueryClientProvider>,
    );

    const btn = await screen.findByRole('button', { name: /Use suggested order/i });
    await user.click(btn);

    await waitFor(() => {
      expect(appliedBlockIds).toEqual([BLOCK_C_ID, BLOCK_B_ID, BLOCK_A_ID, BLOCK_D_ID]);
    });
  });

  it('clicking Drop reveals inline Drop reason choices (Not important anymore, Someone else did it, No room) and Undo reopens the block', async () => {
    const user = userEvent.setup();
    const qc = createTestQueryClient();
    let currentUpNext = [BLOCK_A, BLOCK_B, BLOCK_C, BLOCK_D];
    const droppedIds: string[] = [];
    const patchPayloads: Array<{ id: string; body: Record<string, unknown> }> = [];
    const reopenedIds: string[] = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        const method = (init?.method ?? 'GET').toUpperCase();
        if (url.includes('/api/today')) {
          const overflowCount = Math.max(0, currentUpNext.length - 2);
          return jsonResponse(
            createTodayPayload({
              upNext: currentUpNext,
              fitLine: {
                fitLineIndex: 2,
                fittingMinutes: 180,
                remainingMinutes: 40,
                overflowBlockCount: overflowCount,
                overflowMinutes: overflowCount * 45,
              },
            }),
          );
        }
        if (url.endsWith('/drop') && method === 'POST') {
          const id = url.split('/api/blocks/')[1].replace('/drop', '');
          droppedIds.push(id);
          // Simulate backend removing dropped block on refetch (as SSE block.dropped does)
          currentUpNext = currentUpNext.filter((b) => b.id !== id);
          return jsonResponse({ block: { ...BLOCK_C, id, status: 'dropped' } });
        }
        if (url.endsWith('/reopen') && method === 'POST') {
          const id = url.split('/api/blocks/')[1].replace('/reopen', '');
          reopenedIds.push(id);
          return jsonResponse({ block: { ...BLOCK_D, id, status: 'todo' } });
        }
        if (url.includes('/api/blocks/') && method === 'PATCH') {
          const id = url.split('/api/blocks/')[1];
          const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
          patchPayloads.push({ id, body });
          return jsonResponse({ block: { ...BLOCK_C, id, ...body } });
        }
        if (url.includes('/api/calendar')) {
          return jsonResponse({
            startDate: '2026-11-25',
            endDate: '2026-11-25',
            timezone: 'Europe/Berlin',
            sessions: [],
            plannedBlocks: [],
            events: [],
            projects: TEST_PROJECTS,
            goals: [TEST_GOAL],
          });
        }
        return jsonResponse({});
      }),
    );

    render(
      <QueryClientProvider client={qc}>
        <AppShellContext.Provider value={createMockShell()}>
          <TodayView />
        </AppShellContext.Provider>
      </QueryClientProvider>,
    );

    const overflowRegion = await screen.findByRole('region', { name: /Probably not today/i });
    const blockCRow = within(overflowRegion)
      .getByText('Send Q4 rollout plan to Alex')
      .closest('[data-overflow-row]') as HTMLElement;

    // Click Drop on Block C
    await user.click(within(blockCRow).getByRole('button', { name: 'Drop' }));

    await waitFor(() => {
      expect(droppedIds).toContain(BLOCK_C_ID);
    });

    // Inline Drop reason strip stays visible even after refetch removes Block C from upNext
    expect(await screen.findByText(/Why\? \(optional\)/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Not important anymore' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Someone else did it' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'No room' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Skip' })).toBeInTheDocument();

    // Pick "No room" -> calls PATCH /api/blocks/:id { dropReason: 'no_room' } and clears strip
    await user.click(screen.getByRole('button', { name: 'No room' }));
    await waitFor(() => {
      expect(patchPayloads).toContainEqual({
        id: BLOCK_C_ID,
        body: { dropReason: 'no_room' },
      });
    });
    await waitFor(() => {
      expect(screen.queryByText(/Why\? \(optional\)/i)).not.toBeInTheDocument();
    });

    // Drop Block D and click Undo -> calls POST /api/blocks/:id/reopen
    const blockDRow = screen
      .getByText('Tidy local scripts')
      .closest('[data-overflow-row]') as HTMLElement;
    await user.click(within(blockDRow).getByRole('button', { name: 'Drop' }));
    const undoBtn = await screen.findByRole('button', { name: 'Undo' });
    await user.click(undoBtn);

    await waitFor(() => {
      expect(reopenedIds).toContain(BLOCK_D_ID);
    });
  });

  it('clicking Tell someone opens TellSomeonePopover with editable two-line draft and Copy / Send to T3 Code buttons', async () => {
    const user = userEvent.setup();
    const qc = createTestQueryClient();
    const payload = createTodayPayload();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/today')) return jsonResponse(payload);
      if (url.includes('/api/calendar')) {
        return jsonResponse({
          startDate: '2026-11-25',
          endDate: '2026-11-25',
          timezone: 'Europe/Berlin',
          sessions: [],
          plannedBlocks: [],
          events: [],
          projects: TEST_PROJECTS,
          goals: [TEST_GOAL],
        });
      }
      return jsonResponse({});
    });
    vi.stubGlobal('fetch', fetchSpy);

    render(
      <QueryClientProvider client={qc}>
        <AppShellContext.Provider value={createMockShell()}>
          <TodayView />
        </AppShellContext.Provider>
      </QueryClientProvider>,
    );

    const overflowRegion = await screen.findByRole('region', { name: /Probably not today/i });
    const blockCRow = within(overflowRegion)
      .getByText('Send Q4 rollout plan to Alex')
      .closest('[data-overflow-row]') as HTMLElement;

    await user.click(within(blockCRow).getByRole('button', { name: 'Tell someone' }));

    const popover = await screen.findByRole('dialog', { name: /Tell someone/i });
    expect(within(popover).getByText(/TELL SOMEONE/i)).toBeInTheDocument();
    expect(within(popover).getByText(/Due Nov 25/i)).toBeInTheDocument();
    expect(
      within(popover).getByText(/Veyra copies the note or hands it to T3 Code\. It never sends anything itself\./i),
    ).toBeInTheDocument();

    const textarea = within(popover).getByRole('textbox', { name: /Draft message/i });
    expect(textarea).toHaveValue(
      "I won't get to Send Q4 rollout plan to Alex today, you'll have it tomorrow morning.",
    );

    // Edit draft and click Copy
    await user.clear(textarea);
    await user.type(textarea, "Quick heads-up: I'll send the Q4 rollout plan tomorrow at 9.");
    await user.click(within(popover).getByRole('button', { name: /^Copy$/i }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        "Quick heads-up: I'll send the Q4 rollout plan tomorrow at 9.",
      );
    });

    // Click Send to T3 Code -> copies structured T3 Code handoff prompt locally
    await user.click(within(popover).getByRole('button', { name: /Send to T3 Code/i }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(2);
    });
    const t3Prompt = writeText.mock.calls[1][0] as string;
    expect(t3Prompt).toContain('Send Q4 rollout plan to Alex');
    expect(t3Prompt).toContain("Quick heads-up: I'll send the Q4 rollout plan tomorrow at 9.");

    // Second click on "Tell someone" toggles the popover closed cleanly
    await user.click(within(blockCRow).getByRole('button', { name: 'Tell someone' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /Tell someone/i })).not.toBeInTheDocument();
    });
  });

  it('keyboard ArrowDown selection highlights overflow rows in Probably not today', async () => {
    const user = userEvent.setup();
    const qc = createTestQueryClient();
    const payload = createTodayPayload();

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/api/today')) return jsonResponse(payload);
        if (url.includes('/api/calendar')) {
          return jsonResponse({
            startDate: '2026-11-25',
            endDate: '2026-11-25',
            timezone: 'Europe/Berlin',
            sessions: [],
            plannedBlocks: [],
            events: [],
            projects: TEST_PROJECTS,
            goals: [TEST_GOAL],
          });
        }
        return jsonResponse({});
      }),
    );

    render(
      <QueryClientProvider client={qc}>
        <AppShellContext.Provider value={createMockShell()}>
          <TodayView />
        </AppShellContext.Provider>
      </QueryClientProvider>,
    );

    const overflowRegion = await screen.findByRole('region', { name: /Probably not today/i });
    const blockCRow = within(overflowRegion)
      .getByText('Send Q4 rollout plan to Alex')
      .closest('[data-overflow-row]') as HTMLElement;
    expect(blockCRow.className).not.toContain('border-[#5566F2]/70');
    // No card is preselected on load: a mouse user only sees a highlight on what they picked.
    const upNextRegion = screen.getByRole('region', { name: /Up Next/i });
    for (const card of within(upNextRegion).getAllByRole('button', { name: /Ship capacity UI|Clean Slack triage queue/ })) {
      expect(card.getAttribute('style') ?? '').toBe('');
    }

    // Nothing is highlighted until the first arrow key; three presses walk past the 2 fitting
    // blocks onto the first overflow row (index 2 -> BLOCK_C).
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
    await waitFor(() => {
      expect(blockCRow.className).toContain('border-[#5566F2]/70');
    });
  });

  it('TodayView renders Day look back card when dayLookBack is returned', async () => {
    const user = userEvent.setup();
    const qc = createTestQueryClient();
    const payload = createTodayPayload({
      dayLookBack: {
        date: '2026-11-24',
        isYesterday: true,
        focusedMinutes: 195, // 3h 15m
        roomMinutes: 240,
        goalSharePct: 78,
        movedGoalCount: 3,
        completedCount: 4,
        notFitBlocks: [
          { id: BLOCK_C_ID, title: 'Send Q4 rollout plan to Alex', destination: 'Moved to today' },
        ],
      },
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/api/today')) return jsonResponse(payload);
        if (url.includes('/api/calendar')) {
          return jsonResponse({
            startDate: '2026-11-25',
            endDate: '2026-11-25',
            timezone: 'Europe/Berlin',
            sessions: [],
            plannedBlocks: [],
            events: [],
            projects: TEST_PROJECTS,
            goals: [TEST_GOAL],
          });
        }
        return jsonResponse({});
      }),
    );

    render(
      <QueryClientProvider client={qc}>
        <AppShellContext.Provider value={createMockShell()}>
          <TodayView />
        </AppShellContext.Provider>
      </QueryClientProvider>,
    );

    const lookBack = await screen.findByRole('region', { name: /Day look back/i });
    expect(within(lookBack).getByText(/DAY LOOK BACK/i)).toBeInTheDocument();
    expect(
      within(lookBack).getByText(/3h 15m focused · 78% on goals · 3 blocks moved a goal/i),
    ).toBeInTheDocument();
    expect(within(lookBack).getByText(/^Did not fit$/i)).toBeInTheDocument();
    expect(within(lookBack).getByText('Send Q4 rollout plan to Alex')).toBeInTheDocument();
    expect(
      within(lookBack).getByText(/What did not fit is capacity, not failure\./i),
    ).toBeInTheDocument();

    // Dismissing hides the card and records dismissal in localStorage
    await user.click(within(lookBack).getByRole('button', { name: /Dismiss/i }));
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: /Day look back/i })).not.toBeInTheDocument();
    });
    expect(window.localStorage.getItem('veyra.dayLookBack.dismissed.2026-11-24')).toBe('1');
  });
});

describe('FocusView quiet goal context & Inline Complete sense question', () => {
  const ACTIVE_SESSION = {
    id: '88888888-8888-4888-8888-888888888888',
    blockId: BLOCK_B_ID,
    startedAt: '2026-11-25T09:00:00.000Z',
    endedAt: null,
    note: null,
    updatedAt: '2026-11-25T09:00:00.000Z',
    deletedAt: null,
  };

  it('FocusView shows quiet goal doneWhen/why context while active', async () => {
    const qc = createTestQueryClient();

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/api/today')) return jsonResponse(createTodayPayload());
        if (url.includes(`/api/blocks/${BLOCK_B_ID}`)) {
          return jsonResponse({
            block: { ...BLOCK_B, sessions: [ACTIVE_SESSION], totalFocusMinutes: 25 },
          });
        }
        return jsonResponse({});
      }),
    );

    const shell = createMockShell({
      route: 'focus',
      liveElapsedSeconds: 25 * 60,
      focusStatus: {
        activeSession: ACTIVE_SESSION,
        activeBlock: BLOCK_B,
        elapsedSeconds: 25 * 60,
        focusedTodayMinutes: 70,
      },
    });

    const { unmount } = render(
      <QueryClientProvider client={qc}>
        <AppShellContext.Provider value={shell}>
          <FocusView />
        </AppShellContext.Provider>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Ship capacity UI' })).toBeInTheDocument();
    const goalContext = screen.getByTestId('focus-goal-context');
    expect(goalContext).toHaveTextContent(
      /Daily capacity and weekly review live in desktop app/i,
    );
    unmount();

    // Falls back to goal description ("Why") when doneWhen is empty
    const goalWhyOnly: GoalWithStats = {
      ...TEST_GOAL,
      doneWhen: '',
      description: 'Deliver calm local-first prioritization',
    };
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <AppShellContext.Provider
          value={{
            ...shell,
            goals: [goalWhyOnly],
          }}
        >
          <FocusView />
        </AppShellContext.Provider>
      </QueryClientProvider>,
    );

    expect(screen.getByTestId('focus-goal-context')).toHaveTextContent(
      /Deliver calm local-first prioritization/i,
    );
  });

  it('FocusView Inline Complete renders Moved the goal / Partly / Just motion and submits senseSignal to completeFocus', async () => {
    const user = userEvent.setup();
    const qc = createTestQueryClient();
    let completePayload: Record<string, unknown> | null = null;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        const method = (init?.method ?? 'GET').toUpperCase();
        if (url.includes('/api/focus/complete') && method === 'POST') {
          completePayload = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
          return jsonResponse({
            block: { ...BLOCK_B, status: 'done', senseSignal: completePayload.senseSignal },
            closedSession: { ...ACTIVE_SESSION, endedAt: '2026-11-25T09:35:00.000Z' },
            currentSessionMinutes: 35,
            totalBlockMinutes: 35,
            focusStatus: {
              activeSession: null,
              activeBlock: null,
              elapsedSeconds: 0,
              focusedTodayMinutes: 80,
            },
          });
        }
        if (url.includes('/api/today')) return jsonResponse(createTodayPayload());
        if (url.includes(`/api/blocks/${BLOCK_B_ID}`)) {
          return jsonResponse({
            block: { ...BLOCK_B, sessions: [ACTIVE_SESSION], totalFocusMinutes: 35 },
          });
        }
        return jsonResponse({});
      }),
    );

    const shell = createMockShell({
      route: 'focus',
      liveElapsedSeconds: 35 * 60,
      focusStatus: {
        activeSession: ACTIVE_SESSION,
        activeBlock: BLOCK_B,
        elapsedSeconds: 35 * 60,
        focusedTodayMinutes: 80,
      },
    });

    render(
      <QueryClientProvider client={qc}>
        <AppShellContext.Provider value={shell}>
          <FocusView />
        </AppShellContext.Provider>
      </QueryClientProvider>,
    );

    // Focus actions: Continue later (primary), Complete (secondary), Cancel (no redundant Stop)
    expect(screen.getByRole('button', { name: /Continue later/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Stop$/i })).not.toBeInTheDocument();

    // Open Inline Complete panel
    await user.click(screen.getByRole('button', { name: /^Complete$/i }));

    const energyHeading = screen.getByText(/HOW DID THIS BLOCK FEEL\?/i);
    const senseHeading = screen.getByText(/DID THIS BLOCK MAKE SENSE FOR ITS GOAL\?/i);
    const outcomeLabel = screen.getByText(/WHAT ACTUALLY MOVED FORWARD\? \(OPTIONAL\)/i);

    // Verify order: Energy -> Sense -> Outcome
    expect(
      energyHeading.compareDocumentPosition(senseHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      senseHeading.compareDocumentPosition(outcomeLabel) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // Three equal-width toggle buttons, initially unselected
    const movedBtn = screen.getByRole('button', { name: /Moved the goal/i });
    const partlyBtn = screen.getByRole('button', { name: /Partly/i });
    const motionBtn = screen.getByRole('button', { name: /Just motion/i });
    expect(movedBtn).toHaveAttribute('aria-pressed', 'false');
    expect(partlyBtn).toHaveAttribute('aria-pressed', 'false');
    expect(motionBtn).toHaveAttribute('aria-pressed', 'false');

    // Footer "logged to" row shows minutes, project name, GoalKindIconBadge, and goal name
    const loggedToRow = screen.getByTestId('focus-complete-logged-to');
    expect(loggedToRow).toHaveTextContent(/35m logged to Veyra Core/i);
    expect(loggedToRow).toHaveTextContent(/Ship Veyra v1/i);
    expect(loggedToRow.querySelector('[data-goal-kind="company"]')).toBeInTheDocument();

    // Select "Moved the goal", enter outcome note, and submit
    await user.click(movedBtn);
    expect(movedBtn).toHaveAttribute('aria-pressed', 'true');

    const outcomeInput = screen.getByLabelText(/WHAT ACTUALLY MOVED FORWARD\? \(OPTIONAL\)/i);
    await user.type(outcomeInput, 'Shipped Today capacity & Fit Line UI');
    await user.click(screen.getByRole('button', { name: /Finish Block/i }));

    await waitFor(() => {
      expect(completePayload).toEqual({
        blockId: BLOCK_B_ID,
        energySignal: 'up',
        senseSignal: 'moved',
        outcomeNote: 'Shipped Today capacity & Fit Line UI',
      });
    });
  });

  it('FocusView lets you cut a forgotten pause out of the running session', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 27, 12, 0, 0));
    try {
      const user = userEvent.setup();
      const qc = createTestQueryClient();
      let gapPayload: Record<string, unknown> | null = null;

      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = typeof input === 'string' ? input : input.toString();
          const method = (init?.method ?? 'GET').toUpperCase();
          if (url.includes('/api/focus/gap') && method === 'POST') {
            gapPayload = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
            return jsonResponse({
              closedSession: { ...ACTIVE_SESSION, endedAt: gapPayload.gapStartAt },
              startedSession: { ...ACTIVE_SESSION, id: 'new', startedAt: gapPayload.gapEndAt },
              block: BLOCK_B,
              focusStatus: {
                activeSession: { ...ACTIVE_SESSION, id: 'new', startedAt: gapPayload.gapEndAt },
                activeBlock: BLOCK_B,
                elapsedSeconds: 0,
                focusedTodayMinutes: 40,
              },
            });
          }
          if (url.includes('/api/today')) return jsonResponse(createTodayPayload());
          return jsonResponse({});
        }),
      );

      const shell = createMockShell({
        route: 'focus',
        liveElapsedSeconds: 35 * 60,
        focusStatus: {
          activeSession: ACTIVE_SESSION,
          activeBlock: BLOCK_B,
          elapsedSeconds: 35 * 60,
          focusedTodayMinutes: 80,
        },
      });

      render(
        <QueryClientProvider client={qc}>
          <AppShellContext.Provider value={shell}>
            <FocusView />
          </AppShellContext.Provider>
        </QueryClientProvider>,
      );

      await user.click(screen.getByRole('button', { name: /Remove a pause you forgot to log/i }));
      expect(screen.getByText(/Forgot to log a pause\?/i)).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: '30m' }));
      expect(screen.getByLabelText('Pause started at')).toHaveValue('11:30');
      expect(screen.getByLabelText('Pause ended at')).toHaveValue('12:00');

      await user.click(screen.getByRole('button', { name: /Remove pause/i }));

      await waitFor(() => {
        expect(gapPayload).toEqual({
          gapStartAt: new Date(2026, 10, 27, 11, 30).toISOString(),
          gapEndAt: new Date(2026, 10, 27, 12, 0).toISOString(),
        });
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
