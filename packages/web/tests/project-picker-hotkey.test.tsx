import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ProjectWithStats } from '@veyra/core/types';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppShellContext, type AppShellContextValue } from '../src/app/AppShellContext';
import { CreateBlockModal } from '../src/app/CreateBlockModal';
import { QuickCaptureOverlay } from '../src/app/QuickCaptureOverlay';

const PROJECTS: ProjectWithStats[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'LioCare',
    description: 'Customer health',
    color: '#5E6AD2',
    icon: 'Rocket',
    defaultGoalId: null,
    isPinned: true,
    isSystem: false,
    status: 'active',
    notionUrl: null,
    matchKeywords: [],
    weeklyTimeMinutes: 240,
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-24T10:00:00.000Z',
    deletedAt: null,
    isQuiet: false,
    weeklyFocusMinutes: 120,
    openBlockCount: 2,
    nextBlockTitle: null,
    lastTouchedAt: '2026-11-24T10:00:00.000Z',
    weeklyVarianceStatus: 'under',
    weeklyHistory8w: [],
    averageWeeklyMinutes8w: 120,
    learnedBlockSizeMinutes: 60,
    sizeDriftPct: null,
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Veyra',
    description: 'Focus cockpit',
    color: '#4DA3FF',
    icon: 'Layers',
    defaultGoalId: null,
    isPinned: true,
    isSystem: false,
    status: 'active',
    notionUrl: null,
    matchKeywords: [],
    weeklyTimeMinutes: 240,
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-24T10:00:00.000Z',
    deletedAt: null,
    isQuiet: false,
    weeklyFocusMinutes: 180,
    openBlockCount: 1,
    nextBlockTitle: null,
    lastTouchedAt: '2026-11-24T10:00:00.000Z',
    weeklyVarianceStatus: 'on_track',
    weeklyHistory8w: [],
    averageWeeklyMinutes8w: 180,
    learnedBlockSizeMinutes: 60,
    sizeDriftPct: null,
  },
  {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Other',
    description: 'System project',
    color: '#6E7280',
    icon: null,
    defaultGoalId: null,
    isPinned: false,
    isSystem: true,
    status: 'active',
    notionUrl: null,
    matchKeywords: [],
    weeklyTimeMinutes: null,
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-24T10:00:00.000Z',
    deletedAt: null,
    isQuiet: false,
    weeklyFocusMinutes: 0,
    openBlockCount: 0,
    nextBlockTitle: null,
    lastTouchedAt: '2026-11-24T10:00:00.000Z',
    weeklyVarianceStatus: 'unplanned',
    weeklyHistory8w: [],
    averageWeeklyMinutes8w: 0,
    learnedBlockSizeMinutes: null,
    sizeDriftPct: null,
  },
];

const createBlock = vi.fn(async (input: Record<string, unknown>) => ({
  block: { id: '99999999-9999-4999-8999-999999999999', ...input },
}));

vi.mock('../src/api/client', async (orig) => {
  const actual = await orig<typeof import('../src/api/client')>();
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      createBlock: (input: Record<string, unknown>) => createBlock(input),
    },
  };
});

vi.mock('../src/api/queries', () => ({
  useProjectsQuery: () => ({ data: { projects: PROJECTS } }),
  useSettingsQuery: () => ({ data: undefined }),
  useNotionSearchQuery: () => ({ data: { configured: false, results: [] }, isLoading: false }),
  invalidateBlockRelated: vi.fn(),
  invalidateNotesRelated: vi.fn(),
}));

function createMockShell(): AppShellContextValue {
  return {
    route: 'today',
    previousRoute: 'today',
    activeProjectId: null,
    settingsSection: 'integrations',
    activeDrawer: null,
    liveSyncStatus: 'connected',
    focusStatus: null,
    liveElapsedSeconds: 0,
    projects: PROJECTS,
    goals: [],
    settings: null,
    navigate: vi.fn(),
    openProject: vi.fn(),
    setSettingsSection: vi.fn(),
    openBlockDrawer: vi.fn(),
    openDailyNotesDrawer: vi.fn(),
    openMeetingDrawer: vi.fn(),
    openSessionDrawer: vi.fn(),
    openGoalDrawer: vi.fn(),
    openCreateGoal: vi.fn(),
    openEditGoal: vi.fn(),
    openCloseGoal: vi.fn(),
    closeDrawer: vi.fn(),
    openCommandPalette: vi.fn(),
    openQuickCapture: vi.fn(),
    openCreateBlock: vi.fn(),
    openEditProject: vi.fn(),
    startFocusAndNavigate: vi.fn(async () => {}),
  };
}

afterEach(() => {
  cleanup();
  createBlock.mockClear();
});

describe('Composer project picker hotkey & autocomplete', () => {
  it('QuickCaptureOverlay opens searchable project picker with Ctrl+P, filters on typing, picks on Enter without submitting, and Escape closes only the picker', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={qc}>
        <AppShellContext.Provider value={createMockShell()}>
          <QuickCaptureOverlay open initialTab="inbox" onClose={onClose} />
        </AppShellContext.Provider>
      </QueryClientProvider>,
    );

    const titleInput = screen.getByPlaceholderText('Block title to park in Inbox…');
    await user.type(titleInput, 'Ship autocomplete');

    // Open searchable project picker with Ctrl+P
    fireEvent.keyDown(window, { key: 'p', code: 'KeyP', ctrlKey: true });

    const searchInput = await screen.findByLabelText('Filter projects');
    await user.type(searchInput, 'vey');

    expect(screen.getByRole('option', { name: /Veyra/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /LioCare/ })).not.toBeInTheDocument();

    // Press Enter to pick Veyra without submitting the form
    fireEvent.keyDown(searchInput, { key: 'Enter', code: 'Enter' });

    await waitFor(() => expect(screen.queryByLabelText('Filter projects')).not.toBeInTheDocument());
    expect(createBlock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Veyra/ })).toBeInTheDocument();

    // Re-open with Ctrl+P and press Escape: closes only the picker, not the overlay
    fireEvent.keyDown(window, { key: 'p', code: 'KeyP', ctrlKey: true });
    expect(await screen.findByLabelText('Filter projects')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
    await waitFor(() => expect(screen.queryByLabelText('Filter projects')).not.toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();

    // Submitting now sends the selected Veyra projectId
    await user.click(screen.getByRole('button', { name: /Park in Inbox/i }));
    await waitFor(() =>
      expect(createBlock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Ship autocomplete',
          projectId: PROJECTS[1].id,
        }),
      ),
    );
  });

  it('CreateBlockModal opens searchable Project popover with Ctrl+P, autocompletes, selects on Enter without submitting, and Escape closes only the popover', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={qc}>
        <AppShellContext.Provider value={createMockShell()}>
          <CreateBlockModal open onClose={onClose} />
        </AppShellContext.Provider>
      </QueryClientProvider>,
    );

    const titleInput = screen.getByPlaceholderText('What do you want to finish in this block?');
    await user.type(titleInput, 'Refactor picker');

    // Default project is LioCare; press Ctrl+P to open searchable Project popover
    fireEvent.keyDown(window, { key: 'p', code: 'KeyP', ctrlKey: true });
    const searchInput = await screen.findByLabelText('Search Project');

    await user.type(searchInput, 'vey');
    expect(screen.getByRole('option', { name: /Veyra/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /LioCare/ })).not.toBeInTheDocument();

    // Enter picks Veyra without submitting the modal
    fireEvent.keyDown(searchInput, { key: 'Enter', code: 'Enter' });

    await waitFor(() => expect(screen.queryByLabelText('Search Project')).not.toBeInTheDocument());
    expect(createBlock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Project' })).toHaveTextContent('Veyra');

    // Opening again and pressing Escape closes only the popover, keeping CreateBlockModal open
    fireEvent.keyDown(window, { key: 'p', code: 'KeyP', ctrlKey: true });
    expect(await screen.findByLabelText('Search Project')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
    await waitFor(() => expect(screen.queryByLabelText('Search Project')).not.toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
  });
});
