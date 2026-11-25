import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import type {
  Block,
  BlockDetail,
  GoalWithStats,
  Project,
  ProjectWeekPoint,
  ProjectWithStats,
} from '@veyra/core/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlanResponse, ProjectDetailResponse } from '../src/api/client';
import { AppShellContext, type AppShellContextValue } from '../src/app/AppShellContext';
import { CreateBlockModal } from '../src/app/CreateBlockModal';
import { BlockDetailDrawer } from '../src/components/BlockDetailDrawer';
import { PlanView } from '../src/views/PlanView';
import { ProjectDetailView } from '../src/views/ProjectDetailView';
import { ProjectModal } from '../src/views/ProjectModal';
import { ProjectsView } from '../src/views/ProjectsView';

const GOAL_1_ID = '11111111-1111-4111-8111-111111111111';
const PROJ_OVER_ID = '22222222-2222-4222-8222-222222222221';
const PROJ_UNDER_ID = '22222222-2222-4222-8222-222222222222';
const PROJ_UNTOUCHED_ID = '22222222-2222-4222-8222-222222222223';
const PROJ_UNPLANNED_ID = '22222222-2222-4222-8222-222222222224';
const BLOCK_1_ID = '33333333-3333-4333-8333-333333333331';

const SAMPLE_GOAL: GoalWithStats = {
  id: GOAL_1_ID,
  name: 'Ship Veyra v2',
  kind: 'personal',
  description: 'Weekly clarity without guilt',
  doneWhen: 'All slices shipped',
  checkInDate: '2026-12-15',
  measure: null,
  ifItStalls: '',
  closingNote: null,
  closedAt: null,
  color: '#5E6AD2',
  status: 'active',
  orderKey: 'a0',
  updatedAt: '2026-11-24T10:00:00.000Z',
  deletedAt: null,
  weeklyFocusMinutes: 430,
  weeklyBlockCount: 5,
  linkedProjectCount: 2,
  rankInKind: 1,
};

const EIGHT_WEEK_HISTORY: ProjectWeekPoint[] = [
  { weekStartDate: '2026-10-05', focusMinutes: 180 }, // W41
  { weekStartDate: '2026-10-12', focusMinutes: 240 }, // W42
  { weekStartDate: '2026-10-19', focusMinutes: 300 }, // W43
  { weekStartDate: '2026-10-26', focusMinutes: 210 }, // W44
  { weekStartDate: '2026-11-02', focusMinutes: 270 }, // W45
  { weekStartDate: '2026-11-09', focusMinutes: 360 }, // W46
  { weekStartDate: '2026-11-16', focusMinutes: 300 }, // W47
  { weekStartDate: '2026-11-23', focusMinutes: 430 }, // W48
];

const PROJECT_OVER: ProjectWithStats = {
  id: PROJ_OVER_ID,
  name: 'Veyra Core',
  description: 'Focus & capacity engine',
  color: '#3B4BD8',
  icon: 'Rocket',
  defaultGoalId: GOAL_1_ID,
  isPinned: true,
  isSystem: false,
  status: 'active',
  notionUrl: null,
  matchKeywords: ['Veyra'],
  weeklyTimeMinutes: 240, // 4h
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-11-25T10:00:00.000Z',
  deletedAt: null,
  isQuiet: false,
  weeklyFocusMinutes: 430, // 7h 10m
  weeklyVarianceStatus: 'over',
  weeklyHistory8w: EIGHT_WEEK_HISTORY,
  averageWeeklyMinutes8w: 286, // 4h 46m
  learnedBlockSizeMinutes: 120,
  sizeDriftPct: 40,
  openBlockCount: 3,
  nextBlockTitle: 'Build weekly time chart',
  lastTouchedAt: '2026-11-25T09:00:00.000Z',
};

const PROJECT_UNDER: ProjectWithStats = {
  id: PROJ_UNDER_ID,
  name: 'Client Portal',
  description: 'Onboarding docs and QA',
  color: '#2E9E6F',
  icon: 'Layers',
  defaultGoalId: null,
  isPinned: false,
  isSystem: false,
  status: 'active',
  notionUrl: null,
  matchKeywords: [],
  weeklyTimeMinutes: 360, // 6h
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-11-24T10:00:00.000Z',
  deletedAt: null,
  isQuiet: false,
  weeklyFocusMinutes: 120, // 2h
  weeklyVarianceStatus: 'under',
  weeklyHistory8w: EIGHT_WEEK_HISTORY.map((w) => ({ ...w, focusMinutes: 120 })),
  averageWeeklyMinutes8w: 120,
  learnedBlockSizeMinutes: 60,
  sizeDriftPct: null,
  openBlockCount: 2,
  nextBlockTitle: 'Polish webhook docs',
  lastTouchedAt: '2026-11-24T09:00:00.000Z',
};

const PROJECT_UNTOUCHED: ProjectWithStats = {
  id: PROJ_UNTOUCHED_ID,
  name: 'Design System',
  description: 'Token audits and Figma sync',
  color: '#D9772B',
  icon: 'Sparkles',
  defaultGoalId: null,
  isPinned: false,
  isSystem: false,
  status: 'active',
  notionUrl: null,
  matchKeywords: [],
  weeklyTimeMinutes: 120, // 2h
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-11-10T10:00:00.000Z',
  deletedAt: null,
  isQuiet: true,
  weeklyFocusMinutes: 0,
  weeklyVarianceStatus: 'untouched',
  weeklyHistory8w: EIGHT_WEEK_HISTORY.map((w) => ({ ...w, focusMinutes: 0 })),
  averageWeeklyMinutes8w: 0,
  learnedBlockSizeMinutes: null,
  sizeDriftPct: null,
  openBlockCount: 1,
  nextBlockTitle: 'Audit dark contrast',
  lastTouchedAt: '2026-11-10T09:00:00.000Z',
};

const PROJECT_UNPLANNED: ProjectWithStats = {
  id: PROJ_UNPLANNED_ID,
  name: 'Ad-hoc Ops',
  description: 'Unplanned maintenance',
  color: '#6E7280',
  icon: 'Shield',
  defaultGoalId: null,
  isPinned: false,
  isSystem: false,
  status: 'active',
  notionUrl: null,
  matchKeywords: [],
  weeklyTimeMinutes: null,
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-11-23T10:00:00.000Z',
  deletedAt: null,
  isQuiet: false,
  weeklyFocusMinutes: 45,
  weeklyVarianceStatus: 'time_without_plan',
  weeklyHistory8w: EIGHT_WEEK_HISTORY.map((w) => ({ ...w, focusMinutes: 30 })),
  averageWeeklyMinutes8w: 30,
  learnedBlockSizeMinutes: 30,
  sizeDriftPct: null,
  openBlockCount: 1,
  nextBlockTitle: 'Rotate staging keys',
  lastTouchedAt: '2026-11-23T09:00:00.000Z',
};

const SAMPLE_BLOCK: Block = {
  id: BLOCK_1_ID,
  projectId: PROJ_OVER_ID,
  goalId: GOAL_1_ID,
  title: 'Build weekly time chart',
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
  updatedAt: '2026-11-25T10:00:00.000Z',
  deletedAt: null,
};

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
    route: 'projects',
    previousRoute: 'today',
    activeProjectId: null,
    settingsSection: 'integrations',
    activeDrawer: null,
    liveSyncStatus: 'connected',
    focusStatus: null,
    liveElapsedSeconds: 0,
    projects: [PROJECT_OVER, PROJECT_UNDER, PROJECT_UNTOUCHED, PROJECT_UNPLANNED],
    goals: [SAMPLE_GOAL],
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
});

describe('Project Weekly Time UI (Task 9)', () => {
  it('ProjectModal saves weeklyTimeMinutes via preset chip or hours input and clears with None', async () => {
    const user = userEvent.setup();
    const qc = createTestQueryClient();
    const createPayloads: Array<Record<string, unknown>> = [];
    const updatePayloads: Array<Record<string, unknown>> = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        const method = (init?.method ?? 'GET').toUpperCase();
        if (url.includes('/api/goals')) {
          return jsonResponse({ goals: [SAMPLE_GOAL] });
        }
        if (url.includes('/api/projects') && method === 'POST') {
          const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
          createPayloads.push(body);
          const created: Project = {
            ...PROJECT_OVER,
            id: '99999999-9999-4999-8999-999999999999',
            name: String(body.name ?? ''),
            weeklyTimeMinutes: (body.weeklyTimeMinutes as number | null) ?? null,
          };
          return jsonResponse({ project: created }, 201);
        }
        if (url.includes(`/api/projects/${PROJ_OVER_ID}`) && method === 'PATCH') {
          const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
          updatePayloads.push(body);
          return jsonResponse({
            project: {
              ...PROJECT_OVER,
              weeklyTimeMinutes: (body.weeklyTimeMinutes as number | null) ?? null,
            },
          });
        }
        return jsonResponse({});
      }),
    );

    // 1. Create with preset chip (6h -> 360)
    const onClose1 = vi.fn();
    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <ProjectModal open project={null} onClose={onClose1} />
      </QueryClientProvider>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Create project' });
    const weeklySection = within(dialog).getByRole('region', { name: /Weekly time/i });
    expect(
      within(weeklySection).getByText(
        /An intention, not a quota\. Used in Projects, Plan, and Review\./i,
      ),
    ).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText('Project name'), 'Alpha');
    await user.click(within(weeklySection).getByRole('button', { name: '6h' }));
    await user.click(within(dialog).getByRole('button', { name: 'Create Project' }));

    await waitFor(() => expect(onClose1).toHaveBeenCalled());
    expect(createPayloads[0]).toMatchObject({ name: 'Alpha', weeklyTimeMinutes: 360 });

    // 2. Edit with free-form input (2.5h -> 150)
    const onClose2 = vi.fn();
    rerender(
      <QueryClientProvider client={qc}>
        <ProjectModal open project={PROJECT_OVER} onClose={onClose2} />
      </QueryClientProvider>,
    );

    const editDialog = screen.getByRole('dialog', { name: 'Edit project' });
    const editWeeklySection = within(editDialog).getByRole('region', { name: /Weekly time/i });
    const weeklyInput = within(editWeeklySection).getByLabelText(/Weekly time/i);
    expect(weeklyInput).toHaveValue('4h');

    await user.clear(weeklyInput);
    await user.type(weeklyInput, '2.5h');
    await user.click(within(editDialog).getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(onClose2).toHaveBeenCalled());
    expect(updatePayloads[0]).toMatchObject({ weeklyTimeMinutes: 150 });

    // 3. Edit and clear with None (null)
    const onClose3 = vi.fn();
    rerender(
      <QueryClientProvider client={qc}>
        <ProjectModal open={false} project={PROJECT_OVER} onClose={onClose3} />
      </QueryClientProvider>,
    );
    rerender(
      <QueryClientProvider client={qc}>
        <ProjectModal open project={PROJECT_OVER} onClose={onClose3} />
      </QueryClientProvider>,
    );

    const clearDialog = screen.getByRole('dialog', { name: 'Edit project' });
    const clearWeeklySection = within(clearDialog).getByRole('region', { name: /Weekly time/i });
    await user.click(within(clearWeeklySection).getByRole('button', { name: 'None' }));
    await user.click(within(clearDialog).getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(onClose3).toHaveBeenCalled());
    expect(updatePayloads[1]).toMatchObject({ weeklyTimeMinutes: null });
  });

  it('ProjectsView displays weekly progress bars (actual / target) and filters by Over, Under, and Untouched', async () => {
    const user = userEvent.setup();
    const qc = createTestQueryClient();
    const shell = createMockShell();

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/api/projects')) {
          return jsonResponse({
            projects: [PROJECT_OVER, PROJECT_UNDER, PROJECT_UNTOUCHED, PROJECT_UNPLANNED],
          });
        }
        if (url.includes('/api/goals')) {
          return jsonResponse({ goals: [SAMPLE_GOAL] });
        }
        return jsonResponse({});
      }),
    );

    render(
      <QueryClientProvider client={qc}>
        <AppShellContext.Provider value={shell}>
          <ProjectsView />
        </AppShellContext.Provider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Veyra Core')).toBeInTheDocument();
    expect(screen.getByText('7h 10m / 4h')).toBeInTheDocument();
    expect(screen.getByText('2h / 6h')).toBeInTheDocument();
    expect(screen.getByText('0m / 2h')).toBeInTheDocument();

    // Progress bars appear only for projects with weeklyTimeMinutes (3 of 4)
    const bars = screen.getAllByRole('progressbar');
    expect(bars).toHaveLength(3);

    // Filter: Over
    await user.click(screen.getByRole('tab', { name: /Over/i }));
    expect(screen.getByText('Veyra Core')).toBeInTheDocument();
    expect(screen.queryByText('Client Portal')).not.toBeInTheDocument();
    expect(screen.queryByText('Design System')).not.toBeInTheDocument();

    // Filter: Under
    await user.click(screen.getByRole('tab', { name: /Under/i }));
    expect(screen.getByText('Client Portal')).toBeInTheDocument();
    expect(screen.queryByText('Veyra Core')).not.toBeInTheDocument();
    expect(screen.queryByText('Design System')).not.toBeInTheDocument();

    // Filter: Untouched
    await user.click(screen.getByRole('tab', { name: /Untouched/i }));
    expect(screen.getByText('Design System')).toBeInTheDocument();
    expect(screen.queryByText('Veyra Core')).not.toBeInTheDocument();
    expect(screen.queryByText('Client Portal')).not.toBeInTheDocument();
  });

  it('ProjectDetailView renders 8-week chart, average vs weeklyTimeMinutes, and size drift sentence', async () => {
    const qc = createTestQueryClient();
    const shell = createMockShell({ route: 'project-detail', activeProjectId: PROJ_OVER_ID });

    const detailResponse: ProjectDetailResponse = {
      project: PROJECT_OVER,
      openBlocks: [SAMPLE_BLOCK],
      completedBlocks: [],
    };

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes(`/api/projects/${PROJ_OVER_ID}`)) {
          return jsonResponse(detailResponse);
        }
        if (url.includes('/api/goals')) {
          return jsonResponse({ goals: [SAMPLE_GOAL] });
        }
        return jsonResponse({});
      }),
    );

    render(
      <QueryClientProvider client={qc}>
        <AppShellContext.Provider value={shell}>
          <ProjectDetailView projectId={PROJ_OVER_ID} />
        </AppShellContext.Provider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Veyra Core')).toBeInTheDocument();

    // Header weekly focus + subtitle
    expect(screen.getByText('7h 10m')).toBeInTheDocument();
    expect(screen.getByText('of 4h this week')).toBeInTheDocument();

    // Weekly Time card
    const weeklyCard = screen.getByRole('region', { name: /Weekly time/i });
    expect(within(weeklyCard).getByText(/WEEKLY TIME · 8 WEEKS/i)).toBeInTheDocument();
    expect(within(weeklyCard).getByText(/Average 4h 46m of 4h/i)).toBeInTheDocument();
    expect(
      within(weeklyCard).getByText(/Blocks take 40% longer than planned/i),
    ).toBeInTheDocument();
    expect(within(weeklyCard).getByText(/Intention, not a quota/i)).toBeInTheDocument();

    // 8-week labels W41–W48 and dashed intent line target label
    for (const label of ['W41', 'W42', 'W43', 'W44', 'W45', 'W46', 'W47', 'W48']) {
      expect(within(weeklyCard).getByText(label)).toBeInTheDocument();
    }
    expect(within(weeklyCard).getByText('4h')).toBeInTheDocument();
  });
});

describe('Plan Week Time Strip, Day Room & Block Rough Size (Task 10)', () => {
  it('PlanView renders Week Time Strip per project and planned vs room under each day header', async () => {
    const qc = createTestQueryClient();
    const shell = createMockShell({ route: 'plan' });

    const blockExplicitSize: Block = {
      ...SAMPLE_BLOCK,
      id: '33333333-3333-4333-8333-333333333310',
      projectId: PROJ_OVER_ID,
      title: 'Explicit 2h architecture pass',
      scheduledDate: '2026-11-23',
      sizeMinutes: 120,
    };

    const blockLearnedSize: Block = {
      ...SAMPLE_BLOCK,
      id: '33333333-3333-4333-8333-333333333311',
      projectId: PROJ_UNPLANNED_ID, // learnedBlockSizeMinutes: 30
      title: 'Rotate staging keys',
      scheduledDate: '2026-11-24',
      sizeMinutes: null,
    };

    const blockNoSize: Block = {
      ...SAMPLE_BLOCK,
      id: '33333333-3333-4333-8333-333333333312',
      projectId: PROJ_UNTOUCHED_ID, // learnedBlockSizeMinutes: null
      title: 'Audit dark contrast',
      scheduledDate: '2026-11-25',
      sizeMinutes: null,
    };

    const planResponse: PlanResponse = {
      weekStartDate: '2026-11-23',
      weekEndDate: '2026-11-29',
      today: '2026-11-25',
      timezone: 'UTC',
      days: [
        {
          date: '2026-11-23',
          blocks: [blockExplicitSize],
          events: [],
          plannedMinutes: 240,
          roomMinutes: 300,
        },
        {
          date: '2026-11-24',
          blocks: [blockLearnedSize],
          events: [],
          plannedMinutes: 300,
          roomMinutes: 180, // planned > room, still calm neutral (never red)
        },
        {
          date: '2026-11-25',
          blocks: [blockNoSize],
          events: [],
          plannedMinutes: 60,
          roomMinutes: 240,
        },
        {
          date: '2026-11-26',
          blocks: [],
          events: [],
          plannedMinutes: 0,
          roomMinutes: 240,
        },
        {
          date: '2026-11-27',
          blocks: [],
          events: [],
          plannedMinutes: 0,
          roomMinutes: 210,
        },
      ],
      projectTimeStrip: [
        {
          projectId: PROJ_OVER_ID,
          plannedMinutes: 240,
          loggedMinutes: 120,
          weeklyTimeMinutes: 240,
        },
        {
          projectId: PROJ_UNPLANNED_ID,
          plannedMinutes: 120,
          loggedMinutes: 45,
          weeklyTimeMinutes: null,
        },
      ],
      inbox: [],
      later: [],
      projects: [PROJECT_OVER, PROJECT_UNDER, PROJECT_UNTOUCHED, PROJECT_UNPLANNED],
      goals: [SAMPLE_GOAL],
    };

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/api/plan')) {
          return jsonResponse(planResponse);
        }
        return jsonResponse({});
      }),
    );

    render(
      <QueryClientProvider client={qc}>
        <AppShellContext.Provider value={shell}>
          <PlanView />
        </AppShellContext.Provider>
      </QueryClientProvider>,
    );

    // Week Time Strip renders per-project chips with planned/weeklyTime or planned only
    const strip = await screen.findByRole('region', { name: /Week time strip/i });
    expect(within(strip).getByText('Veyra Core')).toBeInTheDocument();
    expect(within(strip).getByText('4h / 4h')).toBeInTheDocument();
    expect(within(strip).getByText('Ad-hoc Ops')).toBeInTheDocument();
    expect(within(strip).getByText('2h planned')).toBeInTheDocument();

    // Per-day planned vs room headers
    expect(screen.getByText('4h planned · room about 5h')).toBeInTheDocument();
    const overRoomLine = screen.getByText('5h planned · room about 3h');
    expect(overRoomLine).toBeInTheDocument();
    expect(overRoomLine.className).not.toMatch(/red|rose|FF9EC5|C94A6A/i);
    expect(screen.getByText('1h planned · room about 4h')).toBeInTheDocument();

    // Block cards show rough size chip for explicit (2h) and learned (30m), none when unset + unlearned
    const explicitCard = screen.getByText('Explicit 2h architecture pass').closest('[role="button"]') as HTMLElement;
    expect(within(explicitCard).getByText('2h')).toBeInTheDocument();

    const learnedCard = screen.getByText('Rotate staging keys').closest('[role="button"]') as HTMLElement;
    expect(within(learnedCard).getByText('30m')).toBeInTheDocument();

    const noSizeCard = screen.getByText('Audit dark contrast').closest('[role="button"]') as HTMLElement;
    expect(within(noSizeCard).queryByText(/^(30m|1h|2h)$/)).not.toBeInTheDocument();
  });

  it('CreateBlockModal and BlockDetailDrawer let the user choose 30m, 1h, or 2h block size', async () => {
    const user = userEvent.setup();
    const qc = createTestQueryClient();
    const shell = createMockShell();
    const createdPayloads: Array<Record<string, unknown>> = [];
    const patchedPayloads: Array<Record<string, unknown>> = [];

    let currentBlock: BlockDetail = {
      ...SAMPLE_BLOCK,
      sizeMinutes: 60,
      sessions: [],
      totalFocusMinutes: 0,
    };

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        const method = (init?.method ?? 'GET').toUpperCase();
        if (url.includes('/api/projects')) {
          return jsonResponse({ projects: [PROJECT_OVER, PROJECT_UNDER] });
        }
        if (url.includes('/api/goals')) {
          return jsonResponse({ goals: [SAMPLE_GOAL] });
        }
        if (url.includes('/api/blocks') && method === 'POST') {
          const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
          createdPayloads.push(body);
          return jsonResponse(
            { block: { ...SAMPLE_BLOCK, title: String(body.title ?? ''), sizeMinutes: body.sizeMinutes ?? null } },
            201,
          );
        }
        if (url.includes(`/api/blocks/${BLOCK_1_ID}`) && method === 'GET') {
          return jsonResponse({ block: currentBlock });
        }
        if (url.includes(`/api/blocks/${BLOCK_1_ID}`) && method === 'PATCH') {
          const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
          patchedPayloads.push(body);
          currentBlock = {
            ...currentBlock,
            sizeMinutes:
              'sizeMinutes' in body
                ? (body.sizeMinutes as BlockDetail['sizeMinutes'])
                : currentBlock.sizeMinutes,
          };
          return jsonResponse({ block: currentBlock });
        }
        return jsonResponse({});
      }),
    );

    // 1. CreateBlockModal: select 2h and submit
    const onCloseModal = vi.fn();
    render(
      <QueryClientProvider client={qc}>
        <AppShellContext.Provider value={shell}>
          <CreateBlockModal open onClose={onCloseModal} />
        </AppShellContext.Provider>
      </QueryClientProvider>,
    );

    const createDialog = screen.getByRole('dialog', { name: 'Create Block' });
    const createSizeGroup = within(createDialog).getByRole('group', { name: /Block size/i });
    expect(within(createSizeGroup).getByRole('button', { name: 'Auto' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(within(createSizeGroup).getByRole('button', { name: '2h' }));
    expect(within(createSizeGroup).getByRole('button', { name: '2h' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await user.type(
      within(createDialog).getByPlaceholderText(/What do you want to finish/i),
      'Deep capacity refactor',
    );
    await user.click(within(createDialog).getByRole('button', { name: /Create Block/i }));

    await waitFor(() => expect(onCloseModal).toHaveBeenCalled());
    expect(createdPayloads[0]).toMatchObject({
      title: 'Deep capacity refactor',
      sizeMinutes: 120,
    });

    cleanup();

    // 2. BlockDetailDrawer: switch from 1h to 30m, then to Auto (null)
    render(
      <QueryClientProvider client={qc}>
        <AppShellContext.Provider value={shell}>
          <BlockDetailDrawer blockId={BLOCK_1_ID} onClose={vi.fn()} />
        </AppShellContext.Provider>
      </QueryClientProvider>,
    );

    const drawer = await screen.findByRole('dialog', { name: 'Block detail' });
    const drawerSizeGroup = await within(drawer).findByRole('group', { name: /Block size/i });
    expect(within(drawerSizeGroup).getByRole('button', { name: '1h' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await user.click(within(drawerSizeGroup).getByRole('button', { name: '30m' }));
    await waitFor(() => {
      expect(patchedPayloads).toContainEqual({ sizeMinutes: 30 });
    });

    await user.click(within(drawerSizeGroup).getByRole('button', { name: 'Auto' }));
    await waitFor(() => {
      expect(patchedPayloads).toContainEqual({ sizeMinutes: null });
    });
  });
});
