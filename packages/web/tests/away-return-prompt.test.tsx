import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AwayReturnEvent } from '../src/api/client';
import { AwayReturnPrompt } from '../src/app/AwayReturnPrompt';

const SESSION = {
  id: '33333333-3333-4333-8333-333333333333',
  blockId: '22222222-2222-4222-8222-222222222222',
  startedAt: '2026-11-27T09:10:00.000Z',
  endedAt: null,
  note: null,
  updatedAt: '2026-11-27T09:10:00.000Z',
  deletedAt: null,
};

const FOCUS_STATUS = {
  activeSession: SESSION,
  activeBlock: { id: SESSION.blockId, title: 'Strategic Sourcing prep' },
  elapsedSeconds: 3600,
  focusedTodayMinutes: 60,
  lastClosedSessionEndedAt: null,
};

const AWAY: AwayReturnEvent = {
  awayStartedAt: '2026-11-27T10:00:00.000Z',
  awayEndedAt: '2026-11-27T10:23:00.000Z',
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('AwayReturnPrompt', () => {
  let listener: ((event: AwayReturnEvent) => void) | null = null;
  let posts: Array<{ path: string; body: unknown }> = [];

  beforeEach(() => {
    listener = null;
    posts = [];
    (window as unknown as { veyraDesktop: unknown }).veyraDesktop = {
      isElectron: true,
      onAwayReturn: (cb: (event: AwayReturnEvent) => void) => {
        listener = cb;
        return () => {
          listener = null;
        };
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const parsed = new URL(url, 'http://localhost:4173');
        const method = (init?.method ?? 'GET').toUpperCase();
        if (method === 'POST') {
          posts.push({ path: parsed.pathname, body: JSON.parse(String(init?.body ?? '{}')) });
          return jsonResponse({ focusStatus: { ...FOCUS_STATUS, activeSession: null, activeBlock: null } });
        }
        if (parsed.pathname === '/api/focus') return jsonResponse(FOCUS_STATUS);
        return jsonResponse({});
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as unknown as { veyraDesktop?: unknown }).veyraDesktop;
  });

  const renderPrompt = (onSessionEnded = vi.fn()) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <AwayReturnPrompt onSessionEnded={onSessionEnded} />
      </QueryClientProvider>,
    );
    return onSessionEnded;
  };

  const reportAway = async () => {
    await waitFor(() => expect(listener).not.toBeNull());
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    act(() => listener?.(AWAY));
  };

  it('shows nothing until the desktop shell reports an away time', () => {
    renderPrompt();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('removes the away time from the running session', async () => {
    const user = userEvent.setup();
    renderPrompt();
    await reportAway();

    expect(await screen.findByText(/You were away for/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Remove 23m and keep going/ }));

    await waitFor(() => {
      expect(posts).toEqual([
        {
          path: '/api/focus/gap',
          body: { gapStartAt: AWAY.awayStartedAt, gapEndAt: AWAY.awayEndedAt },
        },
      ]);
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('ends the session at the time you left', async () => {
    const user = userEvent.setup();
    const onSessionEnded = renderPrompt();
    await reportAway();

    await user.click(await screen.findByRole('button', { name: /End at/ }));

    await waitFor(() => {
      expect(posts).toEqual([{ path: '/api/focus/pause', body: { endedAt: AWAY.awayStartedAt } }]);
    });
    await waitFor(() => expect(onSessionEnded).toHaveBeenCalled());
  });

  it('keeps the session untouched when you say it was work', async () => {
    const user = userEvent.setup();
    renderPrompt();
    await reportAway();

    await user.click(await screen.findByRole('button', { name: 'It was work' }));

    expect(posts).toEqual([]);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
