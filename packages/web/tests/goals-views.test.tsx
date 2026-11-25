import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import {
  COLOR_PICKER_PRESETS,
  type Goal,
  type GoalDetail,
  type GoalWithStats,
} from '@veyra/core/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppShellContext, type AppShellContextValue } from '../src/app/AppShellContext';
import { ColorPicker } from '../src/components/ColorPicker';
import { GoalChip, GoalKindIconBadge } from '../src/components/GoalChip';
import { goalTint } from '../src/components/goalTint';
import { CloseGoalSheet } from '../src/views/CloseGoalSheet';
import { GoalDetailDrawer } from '../src/views/GoalDetailDrawer';
import { GoalFormDrawer } from '../src/views/GoalFormDrawer';
import { GoalsView } from '../src/views/GoalsView';

const PERSONAL_GOAL_ID = '11111111-1111-4111-8111-111111111111';
const COMPANY_GOAL_ID = '22222222-2222-4222-8222-222222222222';
const CLOSED_GOAL_ID = '33333333-3333-4333-8333-333333333333';

const PERSONAL_GOAL: GoalWithStats = {
  id: PERSONAL_GOAL_ID,
  name: 'Deep Craft',
  kind: 'personal',
  description: 'Protect daily maker energy',
  doneWhen: 'Ship 4 high-leverage releases without burnout',
  checkInDate: '2026-12-15',
  measure: '3 deep blocks / day',
  ifItStalls: 'Cut afternoon meetings in half',
  closingNote: null,
  closedAt: null,
  color: '#4DA3FF',
  status: 'active',
  orderKey: 'a0',
  updatedAt: '2026-11-24T10:00:00.000Z',
  deletedAt: null,
  weeklyFocusMinutes: 195,
  weeklyBlockCount: 4,
  linkedProjectCount: 2,
  rankInKind: 1,
};

const COMPANY_GOAL: GoalWithStats = {
  id: COMPANY_GOAL_ID,
  name: 'askLio Launch',
  kind: 'company',
  description: 'Make procurement automation effortless',
  doneWhen: '10 pilot customers live in production',
  checkInDate: '2026-12-20',
  measure: '6 / 10 customers live',
  ifItStalls: 'Pair directly with onboarding engineers',
  closingNote: null,
  closedAt: null,
  color: '#34D399',
  status: 'active',
  orderKey: 'a0',
  updatedAt: '2026-11-24T10:00:00.000Z',
  deletedAt: null,
  weeklyFocusMinutes: 270,
  weeklyBlockCount: 5,
  linkedProjectCount: 3,
  rankInKind: 1,
};

const CLOSED_GOAL: GoalWithStats = {
  id: CLOSED_GOAL_ID,
  name: 'Q3 Security Audit',
  kind: 'company',
  description: 'Pass SOC2 readiness review',
  doneWhen: 'Zero critical findings',
  checkInDate: null,
  measure: null,
  ifItStalls: '',
  closingNote: 'Passed ahead of schedule with clean report',
  closedAt: '2026-10-20T15:00:00.000Z',
  color: '#9D7FF7',
  status: 'achieved',
  orderKey: 'a1',
  updatedAt: '2026-10-20T15:00:00.000Z',
  deletedAt: null,
  weeklyFocusMinutes: 0,
  weeklyBlockCount: 0,
  linkedProjectCount: 1,
  rankInKind: 2,
};

const COMPANY_GOAL_DETAIL: GoalDetail = {
  ...COMPANY_GOAL,
  history: [
    {
      kind: 'outcome',
      id: 'out-1',
      blockId: '44444444-4444-4444-8444-444444444444',
      blockTitle: 'Ship onboarding wizard',
      outcomeNote: 'Three enterprise pilots completed self-serve setup',
      totalFocusMinutes: 120,
      timestamp: '2026-11-22T16:00:00.000Z',
    },
    {
      kind: 'measure',
      id: 'meas-1',
      previousValue: '4 / 10 customers live',
      value: '6 / 10 customers live',
      weekStartDate: '2026-11-16',
      timestamp: '2026-11-20T14:00:00.000Z',
    },
  ],
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
    route: 'goals',
    previousRoute: 'today',
    activeProjectId: null,
    settingsSection: 'integrations',
    activeDrawer: null,
    liveSyncStatus: 'connected',
    focusStatus: null,
    liveElapsedSeconds: 0,
    projects: [],
    goals: [PERSONAL_GOAL, COMPANY_GOAL],
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

describe('ColorPicker', () => {
  it('renders all 12 curated presets plus custom slot and applies valid custom hex', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<ColorPicker value="#5E6AD2" onChange={onChange} label="Color" />);

    // All 12 curated presets exist as buttons
    for (const preset of COLOR_PICKER_PRESETS) {
      expect(screen.getByRole('button', { name: new RegExp(preset.name, 'i') })).toBeInTheDocument();
    }

    // Selected preset uses inside-aligned border ring
    const selectedSwatch = screen.getByRole('button', { name: /Indigo/i });
    expect(selectedSwatch).toHaveAttribute('aria-pressed', 'true');
    expect(selectedSwatch.className).toContain('border-2');
    expect(selectedSwatch.className).toContain('box-border');

    // Select preset Sky
    await user.click(screen.getByRole('button', { name: /Sky/i }));
    expect(onChange).toHaveBeenCalledWith('#4DA3FF');

    // Toggle custom hex row via 13th custom slot
    const customSlot = screen.getByRole('button', { name: /Custom hex/i });
    await user.click(customSlot);

    const hexInput = screen.getByRole('textbox', { name: /Hex color/i });
    await user.clear(hexInput);
    await user.type(hexInput, '#12ab34');
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onChange).toHaveBeenCalledWith('#12AB34');
  });

  it('shows a quiet inline hint on invalid custom hex without crashing', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<ColorPicker value="#5E6AD2" onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: /Custom hex/i }));
    const hexInput = screen.getByRole('textbox', { name: /Hex color/i });
    await user.clear(hexInput);
    await user.type(hexInput, 'not-a-hex');
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/valid hex/i)).toBeInTheDocument();
  });
});

describe('GoalChip and GoalKindIconBadge', () => {
  it('renders Person icon for personal goals and Briefcase icon for company goals with no plain dot', () => {
    const { container } = render(
      <div>
        <GoalChip name="Deep Craft" kind="personal" color="#4DA3FF" />
        <GoalChip name="askLio Launch" kind="company" color="#34D399" />
      </div>,
    );

    const personalBadge = container.querySelector('[data-goal-kind="personal"]');
    const companyBadge = container.querySelector('[data-goal-kind="company"]');

    expect(personalBadge).toBeInTheDocument();
    expect(companyBadge).toBeInTheDocument();
    expect(personalBadge?.querySelector('svg')).toBeInTheDocument();
    expect(companyBadge?.querySelector('svg')).toBeInTheDocument();

    // No plain dot markers
    expect(container.querySelector('.rounded-full.w-1\\.5')).not.toBeInTheDocument();

    // Tinted styles match goalTint
    const skyTint = goalTint('#4DA3FF');
    expect(skyTint.text).toBe('#8FC7FF');
    const mintTint = goalTint('#34D399');
    expect(mintTint.text).toBe('#7EE8BE');

    expect(screen.getByText('Deep Craft')).toBeInTheDocument();
    expect(screen.getByText('askLio Launch')).toBeInTheDocument();
  });

  it('supports xs, sm, md, lg sizes on GoalKindIconBadge', () => {
    const { container } = render(
      <div>
        <GoalKindIconBadge kind="personal" color="#5E6AD2" size="xs" />
        <GoalKindIconBadge kind="company" color="#F59E0B" size="lg" />
      </div>,
    );
    expect(container.querySelectorAll('[data-goal-kind]').length).toBe(2);
  });
});

describe('GoalsView, GoalFormDrawer, CloseGoalSheet, and GoalDetailDrawer', () => {
  it('GoalsView separates Personal and Company groups with measured focus and opens Create Goal Drawer and Close Goal sheet', async () => {
    const user = userEvent.setup();
    const qc = createTestQueryClient();
    const openCreateGoal = vi.fn();
    const openCloseGoal = vi.fn();
    const openGoalDrawer = vi.fn();
    const shell = createMockShell({ openCreateGoal, openCloseGoal, openGoalDrawer });

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/api/goals')) {
          return jsonResponse({ goals: [PERSONAL_GOAL, COMPANY_GOAL, CLOSED_GOAL] });
        }
        return jsonResponse({ error: { code: 'NOT_FOUND', message: url } }, 404);
      }),
    );

    render(
      <QueryClientProvider client={qc}>
        <AppShellContext.Provider value={shell}>
          <GoalsView />
        </AppShellContext.Provider>
      </QueryClientProvider>,
    );

    const personalSection = await screen.findByRole('region', { name: 'Personal goals' });
    const companySection = screen.getByRole('region', { name: 'Company goals' });

    expect(within(personalSection).getByText('Deep Craft')).toBeInTheDocument();
    expect(within(personalSection).getByText(/3h 15m focused/i)).toBeInTheDocument();
    expect(within(personalSection).getByText(/4 blocks/i)).toBeInTheDocument();
    expect(within(personalSection).getByText(/3 deep blocks \/ day/i)).toBeInTheDocument();
    expect(within(personalSection).queryByText('askLio Launch')).not.toBeInTheDocument();

    expect(within(companySection).getByText('askLio Launch')).toBeInTheDocument();
    expect(within(companySection).getByText(/4h 30m focused/i)).toBeInTheDocument();
    expect(within(companySection).getByText(/5 blocks/i)).toBeInTheDocument();
    expect(within(companySection).getByText(/6 \/ 10 customers live/i)).toBeInTheDocument();

    // No progress bars on GoalsView
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();

    // Open Create Goal drawer from topbar
    await user.click(screen.getByRole('button', { name: /New Goal/i }));
    expect(openCreateGoal).toHaveBeenCalledTimes(1);

    // Open Close Goal sheet from card action
    await user.click(screen.getByRole('button', { name: /Close goal Deep Craft/i }));
    expect(openCloseGoal).toHaveBeenCalledWith(PERSONAL_GOAL_ID);

    // Expand closed goals and see Q3 Security Audit + Reactivate button
    await user.click(screen.getByRole('button', { name: /Closed goals/i }));
    expect(screen.getByText('Q3 Security Audit')).toBeInTheDocument();
    expect(screen.getByText(/Passed ahead of schedule/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reactivate' })).toBeInTheDocument();
  });

  it('GoalFormDrawer places COLOR beneath KIND and submits company goal with doneWhen, checkInDate, measure, and ifItStalls', async () => {
    const user = userEvent.setup();
    const qc = createTestQueryClient();
    const onClose = vi.fn();
    let submittedBody: Record<string, unknown> | null = null;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/api/goals') && (init?.method ?? 'GET') === 'POST') {
          submittedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
          const created: Goal = {
            ...COMPANY_GOAL,
            id: '99999999-9999-4999-8999-999999999999',
            name: String(submittedBody.name ?? ''),
          };
          return jsonResponse({ goal: created }, 201);
        }
        return jsonResponse({ goals: [] });
      }),
    );

    render(
      <QueryClientProvider client={qc}>
        <GoalFormDrawer open mode="create" onClose={onClose} />
      </QueryClientProvider>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Create goal' });

    // Verify COLOR section is strictly below KIND section in DOM order
    const kindLabel = within(dialog).getByText(/^Kind$/i);
    const colorLabel = within(dialog).getByText(/^Color$/i);
    expect(kindLabel.compareDocumentPosition(colorLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.type(within(dialog).getByLabelText('Goal name'), 'Enterprise Scale');
    await user.click(within(dialog).getByRole('button', { name: /Company/i }));
    await user.click(within(dialog).getByRole('button', { name: /^Mint$/i }));
    await user.type(within(dialog).getByLabelText('Why it matters'), 'Build durable ARR');
    await user.type(within(dialog).getByLabelText('Done when'), '20 enterprise accounts live');
    await user.type(within(dialog).getByLabelText('Check in date'), '2026-12-31');
    await user.type(within(dialog).getByLabelText('Measure'), '12 / 20 accounts');
    await user.type(within(dialog).getByLabelText('If it stalls'), 'Run weekly customer unblock sessions');

    await user.click(within(dialog).getByRole('button', { name: 'Create Goal' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(submittedBody).toMatchObject({
      name: 'Enterprise Scale',
      kind: 'company',
      color: '#34D399',
      description: 'Build durable ARR',
      doneWhen: '20 enterprise accounts live',
      checkInDate: '2026-12-31',
      measure: '12 / 20 accounts',
      ifItStalls: 'Run weekly customer unblock sessions',
    });
  });

  it('CloseGoalSheet submits Mark Achieved or Let Go with optional closingNote', async () => {
    const user = userEvent.setup();
    const qc = createTestQueryClient();
    const onClose = vi.fn();
    let closePayload: Record<string, unknown> | null = null;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes(`/api/goals/${PERSONAL_GOAL_ID}/close`) && init?.method === 'POST') {
          closePayload = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
          return jsonResponse({ goal: { ...PERSONAL_GOAL, status: closePayload.status } });
        }
        return jsonResponse({});
      }),
    );

    render(
      <QueryClientProvider client={qc}>
        <CloseGoalSheet
          open
          goal={PERSONAL_GOAL}
          initialStatus="achieved"
          onClose={onClose}
        />
      </QueryClientProvider>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Close goal' });
    expect(within(dialog).getByText('Deep Craft')).toBeInTheDocument();

    // Switch to Let Go and add closing note
    await user.click(within(dialog).getByRole('button', { name: /Let Go/i }));
    await user.type(
      within(dialog).getByLabelText(/What did this goal bring/i),
      'Shifted focus to launch quarter',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(closePayload).toEqual({
      status: 'archived',
      closingNote: 'Shifted focus to launch quarter',
    });
  });

  it('GoalDetailDrawer shows quarterly history (outcomes and measure updates), inline ColorPicker, and Edit/Close triggers', async () => {
    const user = userEvent.setup();
    const qc = createTestQueryClient();
    const openEditGoal = vi.fn();
    const openCloseGoal = vi.fn();
    const shell = createMockShell({ openEditGoal, openCloseGoal });
    const patchCalls: Array<Record<string, unknown>> = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        const method = (init?.method ?? 'GET').toUpperCase();
        if (url.includes(`/api/goals/${COMPANY_GOAL_ID}`) && method === 'GET') {
          return jsonResponse({ goal: COMPANY_GOAL_DETAIL });
        }
        if (url.includes(`/api/goals/${COMPANY_GOAL_ID}`) && method === 'PATCH') {
          const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
          patchCalls.push(body);
          return jsonResponse({ goal: { ...COMPANY_GOAL, ...body } });
        }
        return jsonResponse({});
      }),
    );

    render(
      <QueryClientProvider client={qc}>
        <AppShellContext.Provider value={shell}>
          <GoalDetailDrawer goalId={COMPANY_GOAL_ID} onClose={vi.fn()} />
        </AppShellContext.Provider>
      </QueryClientProvider>,
    );

    const dialog = await screen.findByRole('dialog', { name: 'Goal detail' });
    expect(await within(dialog).findByText('askLio Launch')).toBeInTheDocument();
    expect(within(dialog).getByText(/Goal Detail · Company/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/3 projects/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/#1 in Company/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/4h 30m focused/i)).toBeInTheDocument();

    // Quarterly history renders both outcome and measure update items
    expect(within(dialog).getByText('Ship onboarding wizard')).toBeInTheDocument();
    expect(within(dialog).getByText(/Three enterprise pilots completed/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/4 \/ 10 customers live/i)).toBeInTheDocument();
    expect(within(dialog).getAllByText(/6 \/ 10 customers live/i)).toHaveLength(2);

    // Inline ColorPicker updates color immediately
    await user.click(within(dialog).getByRole('button', { name: /^Sky$/i }));
    await waitFor(() => {
      expect(patchCalls).toContainEqual({ color: '#4DA3FF' });
    });

    // Edit and Close triggers
    await user.click(within(dialog).getByRole('button', { name: 'Edit goal' }));
    expect(openEditGoal).toHaveBeenCalledWith(COMPANY_GOAL_ID);

    await user.click(within(dialog).getByRole('button', { name: 'Mark Achieved' }));
    expect(openCloseGoal).toHaveBeenCalledWith(COMPANY_GOAL_ID, 'achieved');
  });
});
