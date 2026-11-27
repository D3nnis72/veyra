import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { Block, FocusStatus, ProjectWithStats } from '@veyra/core/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient, type TodayResponse } from '../src/api/client';
import { TrayPopover } from '../src/app/TrayPopover';

const PROJ_ID = '33333333-3333-4333-8333-333333333333';
const BLOCK_ID = '44444444-4444-4444-8444-444444444444';

const PROJECT: ProjectWithStats = {
  id: PROJ_ID,
  name: 'Strategic Sourcing',
  description: '',
  color: '#D9772B',
  icon: 'Globe',
  defaultGoalId: null,
  isPinned: false,
  isSystem: false,
  status: 'active',
  notionUrl: null,
  matchKeywords: [],
  weeklyTimeMinutes: null,
  createdAt: '2026-11-01T08:00:00.000Z',
  updatedAt: '2026-11-26T08:00:00.000Z',
  deletedAt: null,
  isQuiet: false,
  weeklyFocusMinutes: 60,
  weeklyVarianceStatus: 'time_without_plan',
  weeklyHistory8w: [],
  averageWeeklyMinutes8w: 60,
  learnedBlockSizeMinutes: null,
  sizeDriftPct: null,
  openBlockCount: 3,
  nextBlockTitle: 'Strategic Sourcing - Code Preparation',
  lastTouchedAt: '2026-11-26T08:00:00.000Z',
};

const BLOCK: Block = {
  id: BLOCK_ID,
  projectId: PROJ_ID,
  goalId: null,
  title: 'Strategic Sourcing - Code Preparation',
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

function renderPopover() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TrayPopover />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.spyOn(apiClient, 'listProjects').mockResolvedValue({ projects: [PROJECT] });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('TrayPopover', () => {
  it('shows active project, block title, elapsed timer, and wires Pause/Done/2-step Cancel controls', async () => {
    const focusStatus: FocusStatus = {
      activeSession: {
        id: '77777777-7777-4777-8777-777777777777',
        blockId: BLOCK_ID,
        startedAt: '2026-11-26T10:00:00.000Z',
        endedAt: null,
        note: null,
        updatedAt: '2026-11-26T10:00:00.000Z',
        deletedAt: null,
      },
      activeBlock: BLOCK,
      elapsedSeconds: 125,
      focusedTodayMinutes: 40,
    };

    vi.spyOn(apiClient, 'getFocus').mockResolvedValue(focusStatus);
    vi.spyOn(apiClient, 'getToday').mockResolvedValue({
      date: '2026-11-26',
      focusStatus,
      upNext: [],
      projects: [PROJECT],
    } as unknown as TodayResponse);
    const pauseSpy = vi.spyOn(apiClient, 'pauseFocus').mockResolvedValue({} as never);
    const completeSpy = vi.spyOn(apiClient, 'completeFocus').mockResolvedValue({} as never);
    const cancelSpy = vi.spyOn(apiClient, 'cancelFocus').mockResolvedValue({} as never);

    renderPopover();

    expect(await screen.findByText('Strategic Sourcing')).toBeInTheDocument();
    expect(screen.getByText('Strategic Sourcing - Code Preparation')).toBeInTheDocument();
    expect(screen.getByTestId('tray-popover-timer')).toHaveTextContent('02:05');
    expect(screen.queryByRole('button', { name: /Stop/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Pause/i }));
    await waitFor(() => expect(pauseSpy).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: /Done/i }));
    await waitFor(() => expect(completeSpy).toHaveBeenCalledWith({ blockId: BLOCK_ID }));

    // Cancel requires two clicks (Cancel -> Discard?) before discarding the session
    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));
    expect(cancelSpy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Discard\?/i }));
    await waitFor(() => expect(cancelSpy).toHaveBeenCalledTimes(1));
  });

  it('shows Up Next blocks when idle and starts focus on click', async () => {
    const idleStatus: FocusStatus = {
      activeSession: null,
      activeBlock: null,
      elapsedSeconds: 0,
      focusedTodayMinutes: 40,
    };

    vi.spyOn(apiClient, 'getFocus').mockResolvedValue(idleStatus);
    vi.spyOn(apiClient, 'getToday').mockResolvedValue({
      date: '2026-11-26',
      focusStatus: idleStatus,
      upNext: [BLOCK],
      projects: [PROJECT],
    } as unknown as TodayResponse);
    const startSpy = vi.spyOn(apiClient, 'startFocus').mockResolvedValue({} as never);

    renderPopover();

    expect(await screen.findByText('Up Next')).toBeInTheDocument();
    const blockBtn = await screen.findByRole('button', {
      name: /Strategic Sourcing - Code Preparation/i,
    });
    fireEvent.click(blockBtn);
    await waitFor(() => expect(startSpy).toHaveBeenCalledWith(BLOCK_ID));
  });
});
