import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';

const GOAL = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Product & Engineering',
  description: 'askLio core',
  color: '#3B4BD8',
  status: 'active',
  orderKey: 'a0',
  updatedAt: '2026-11-24T10:00:00.000Z',
  deletedAt: null,
};

const updateGoal = vi.fn(async (_id: string, _input: unknown) => ({ goal: GOAL }));

vi.mock('../src/api/queries', () => ({
  useGoalsQuery: () => ({ data: { goals: [GOAL] } }),
  useActivityQuery: () => ({ data: { activity: [] } }),
  useProjectsQuery: () => ({ data: { projects: [] } }),
  useSettingsQuery: () => ({ data: undefined }),
  invalidateAllVeyraData: vi.fn(),
}));

vi.mock('../src/api/client', async (orig) => {
  const actual = await orig<typeof import('../src/api/client')>();
  return {
    ...actual,
    apiClient: { ...actual.apiClient, updateGoal: (id: string, input: unknown) => updateGoal(id, input) },
  };
});

import { SettingsView } from '../src/views/SettingsView';

function renderGoals() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SettingsView section="goals" />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  updateGoal.mockClear();
});

describe('Goals settings', () => {
  it('offers an Archived status that is sent to the API', async () => {
    renderGoals();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Archived' }));
    await waitFor(() => expect(updateGoal).toHaveBeenCalledWith(GOAL.id, { status: 'archived' }));
  });

  it('edits name, description and a custom color via the Edit button', async () => {
    const user = userEvent.setup();
    renderGoals();

    await user.click(screen.getByRole('button', { name: /Edit goal Product & Engineering details/ }));
    const name = screen.getByRole('textbox', { name: /Edit goal Product & Engineering$/ });
    await user.clear(name);
    await user.type(name, 'Platform');
    fireEvent.change(screen.getByLabelText(/Custom product & engineering color/i), {
      target: { value: '#12ab34' },
    });
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(updateGoal).toHaveBeenCalledWith(GOAL.id, {
        name: 'Platform',
        description: 'askLio core',
        color: '#12AB34',
      }),
    );
  });
});
