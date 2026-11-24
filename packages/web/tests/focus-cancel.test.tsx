import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';

const cancelFocus = vi.fn(async () => ({}));
const navigate = vi.fn();

vi.mock('../src/api/client', async (orig) => {
  const actual = await orig<typeof import('../src/api/client')>();
  return {
    ...actual,
    isElectronDesktop: () => false,
    apiClient: { ...actual.apiClient, cancelFocus: () => cancelFocus() },
  };
});

vi.mock('../src/app/AppShellContext', () => ({
  useAppShell: () => ({
    route: 'today',
    previousRoute: 'today',
    activeProjectId: null,
    settingsSection: 'goals',
    focusStatus: {
      activeSession: { id: 's1' },
      activeBlock: { id: 'b1', title: 'Write spec' },
    },
    liveElapsedSeconds: 125,
    projects: [],
    navigate,
    openProject: vi.fn(),
    setSettingsSection: vi.fn(),
    openCommandPalette: vi.fn(),
    openCreateBlock: vi.fn(),
    openDailyNotesDrawer: vi.fn(),
  }),
}));

vi.mock('../src/components/entityMenus', () => ({
  useProjectContextMenu: () => ({ open: vi.fn(), menu: null, element: null }),
}));

import { Sidebar } from '../src/app/Sidebar';

afterEach(() => {
  cleanup();
  cancelFocus.mockClear();
});

describe('Sidebar live focus pill', () => {
  it('cancels the running focus only after confirming', async () => {
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Sidebar />
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Cancel focus session' }));
    expect(cancelFocus).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(cancelFocus).toHaveBeenCalledTimes(1));
  });

  it('Keep backs out without cancelling', async () => {
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Sidebar />
      </QueryClientProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Cancel focus session' }));
    await user.click(screen.getByRole('button', { name: 'Keep' }));
    expect(cancelFocus).not.toHaveBeenCalled();
    expect(screen.getByText('Write spec')).toBeInTheDocument();
  });
});
