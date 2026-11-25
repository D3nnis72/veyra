import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppShellContext, type AppShellContextValue, type SettingsSection } from '../src/app/AppShellContext';
import { Sidebar } from '../src/app/Sidebar';
import { SettingsView } from '../src/views/SettingsView';

vi.mock('../src/api/queries', () => ({
  useGoalsQuery: () => ({ data: { goals: [] } }),
  useActivityQuery: () => ({ data: { activity: [] } }),
  useProjectsQuery: () => ({ data: { projects: [] } }),
  useSettingsQuery: () => ({ data: undefined }),
  invalidateAllVeyraData: vi.fn(),
}));

vi.mock('../src/components/entityMenus', () => ({
  useProjectContextMenu: () => ({ open: vi.fn(), menu: null }),
  useGoalContextMenu: () => ({ open: vi.fn(), menu: null }),
}));

function renderSettingsShell(section: SettingsSection) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const shell: AppShellContextValue = {
    route: 'settings',
    previousRoute: 'today',
    activeProjectId: null,
    settingsSection: section,
    activeDrawer: null,
    liveSyncStatus: 'connected',
    focusStatus: null,
    liveElapsedSeconds: 0,
    projects: [],
    goals: [],
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
  };

  return render(
    <QueryClientProvider client={qc}>
      <AppShellContext.Provider value={shell}>
        <div className="flex">
          <Sidebar />
          <SettingsView section={section} />
        </div>
      </AppShellContext.Provider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe('Simplified 3-tab Settings', () => {
  it('SettingsView renders Integrations, Server & CLI (with Shortcuts section), and Appearance without a Goals or separate Shortcuts tab', () => {
    const { unmount } = renderSettingsShell('integrations');
    const nav = screen.getByRole('complementary', { name: 'Settings navigation' });

    expect(within(nav).getByRole('button', { name: 'Integrations' })).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: 'Server & CLI' })).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: 'Appearance' })).toBeInTheDocument();
    expect(within(nav).queryByRole('button', { name: 'Goals' })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('button', { name: 'Shortcuts' })).not.toBeInTheDocument();

    expect(
      screen.getByRole('heading', { name: 'Integrations & Outlook Sync' }),
    ).toBeInTheDocument();
    unmount();

    const serverRender = renderSettingsShell('server');
    expect(
      screen.getByRole('heading', { name: 'Server, CLI & Shortcuts' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Global macOS Hotkeys')).toBeInTheDocument();
    expect(screen.getByText('Navigation & Overlays')).toBeInTheDocument();
    serverRender.unmount();

    renderSettingsShell('appearance');
    expect(screen.getByRole('heading', { name: 'Appearance' })).toBeInTheDocument();
  });
});
