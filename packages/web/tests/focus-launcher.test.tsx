import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Block, ProjectWithStats } from '@veyra/core/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShellContext, type AppShellContextValue } from '../src/app/AppShellContext';
import { FocusLauncher } from '../src/app/FocusLauncher';

const PROJ_COVESTRO: ProjectWithStats = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Covestro',
  description: '',
  color: '#2E9E6F',
  icon: 'Rocket',
  defaultGoalId: null,
  isPinned: true,
  isSystem: false,
  status: 'active',
  notionUrl: null,
  matchKeywords: ['Covestro'],
  weeklyTimeMinutes: null,
  createdAt: '2026-11-01T09:00:00.000Z',
  updatedAt: '2026-11-26T09:00:00.000Z',
  deletedAt: null,
  isQuiet: false,
  weeklyFocusMinutes: 60,
  weeklyVarianceStatus: 'unplanned',
  weeklyHistory8w: [],
  averageWeeklyMinutes8w: 60,
  learnedBlockSizeMinutes: 60,
  sizeDriftPct: null,
  openBlockCount: 1,
  nextBlockTitle: 'Covestro Ticket',
  lastTouchedAt: '2026-11-26T09:00:00.000Z',
};

const BLOCK_UP_NEXT: Block = {
  id: '22222222-2222-4222-8222-222222222222',
  projectId: PROJ_COVESTRO.id,
  goalId: null,
  title: 'Covestro Ticket',
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
  updatedAt: '2026-11-26T09:00:00.000Z',
  deletedAt: null,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('FocusLauncher', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const parsed = new URL(url, 'http://localhost:4173');
        const method = (init?.method ?? 'GET').toUpperCase();

        if (parsed.pathname === '/api/today' && method === 'GET') {
          return jsonResponse({
            date: '2026-11-26',
            timezone: 'UTC',
            weeklyRule: null,
            nextWeekRule: null,
            focusStatus: { activeSession: null, activeBlock: null, elapsedSeconds: 0, focusedTodayMinutes: 0 },
            upNext: [BLOCK_UP_NEXT],
            completedToday: [],
            upcomingEvents: [],
            todayEvents: [],
            dailyNotesCount: 0,
            projects: [PROJ_COVESTRO],
            goals: [],
            roomToday: {
              roomMinutes: 120,
              baselineFocusMinutes: 240,
              focusedTodayMinutes: 0,
              focusBudgetLeftMinutes: 240,
              freeTimeLeftMinutes: 120,
              meetingMinutes: 0,
              countsFromNow: true,
              workdayStart: '09:00',
              workdayEnd: '18:00',
              hasLearnedBaseline: false,
              weekdayLabel: 'Thursday',
            },
            suggestedOrder: [],
            fitLine: { fitLineIndex: 1, fittingMinutes: 60, remainingMinutes: 60, overflowBlockCount: 0, overflowMinutes: 0 },
            dayLookBack: null,
          });
        }
        if (parsed.pathname === '/api/blocks' && method === 'GET') {
          return jsonResponse({ blocks: [BLOCK_UP_NEXT] });
        }
        if (parsed.pathname === '/api/projects' && method === 'GET') {
          return jsonResponse({ projects: [PROJ_COVESTRO] });
        }
        if (parsed.pathname === '/api/blocks' && method === 'POST') {
          const body = JSON.parse(String(init?.body ?? '{}')) as { title: string; projectId?: string };
          return jsonResponse(
            {
              block: {
                ...BLOCK_UP_NEXT,
                id: '33333333-3333-4333-8333-333333333333',
                title: body.title,
                projectId: body.projectId ?? PROJ_COVESTRO.id,
              },
            },
            201,
          );
        }
        if (parsed.pathname === '/api/focus/start' && method === 'POST') {
          return jsonResponse({
            closedSession: null,
            startedSession: {
              id: '44444444-4444-4444-8444-444444444444',
              blockId: '33333333-3333-4333-8333-333333333333',
              startedAt: '2026-11-26T18:00:00.000Z',
              endedAt: null,
              note: null,
              updatedAt: '2026-11-26T18:00:00.000Z',
              deletedAt: null,
            },
            block: BLOCK_UP_NEXT,
            focusStatus: { activeSession: null, activeBlock: null, elapsedSeconds: 0, focusedTodayMinutes: 0 },
          });
        }
        return jsonResponse({});
      }),
    );
  });

  afterEach(() => {
    vi.stubGlobal('fetch', originalFetch);
  });

  it('lists Up Next before New when empty, prioritizes matching existing blocks when typing, and starts existing block on Enter', async () => {
    const user = userEvent.setup();
    const startFocusAndNavigate = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const shell = {
      projects: [PROJ_COVESTRO],
      goals: [],
      settings: null,
      navigate: vi.fn(),
      startFocusAndNavigate,
    } as unknown as AppShellContextValue;

    render(
      <QueryClientProvider client={qc}>
        <AppShellContext.Provider value={shell}>
          <FocusLauncher open onClose={onClose} />
        </AppShellContext.Provider>
      </QueryClientProvider>,
    );

    const input = await screen.findByRole('textbox', { name: 'Focus launcher search' });
    await waitFor(() => {
      expect(screen.getByText('New focus block')).toBeInTheDocument();
      expect(screen.getByText('Covestro Ticket')).toBeInTheDocument();
    });

    // Type "Covestro" -> existing matching block is ranked first and started on Enter
    await user.type(input, 'Covestro{Enter}');

    await waitFor(() => {
      expect(startFocusAndNavigate).toHaveBeenCalledWith(BLOCK_UP_NEXT.id);
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('starts the first Up Next block when Enter is pressed with an empty search', async () => {
    const user = userEvent.setup();
    const startFocusAndNavigate = vi.fn().mockResolvedValue(undefined);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const shell = {
      projects: [PROJ_COVESTRO],
      goals: [],
      settings: null,
      navigate: vi.fn(),
      startFocusAndNavigate,
    } as unknown as AppShellContextValue;

    render(
      <QueryClientProvider client={qc}>
        <AppShellContext.Provider value={shell}>
          <FocusLauncher open onClose={vi.fn()} />
        </AppShellContext.Provider>
      </QueryClientProvider>,
    );

    await screen.findByText('Covestro Ticket');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(startFocusAndNavigate).toHaveBeenCalledWith(BLOCK_UP_NEXT.id);
    });
  });
});
