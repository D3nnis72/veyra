import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { DailyNote, ProjectWithStats } from '@veyra/core/types';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DailyNotesDrawer } from '../src/components/DailyNotesDrawer';
import { SideWorkSection } from '../src/components/SideWorkSection';

const COV_ID = '22222222-2222-4222-8222-222222222222';

const PROJECTS: ProjectWithStats[] = [
  {
    id: COV_ID,
    name: 'Covestro',
    description: 'Customer project',
    color: '#2E9E6F',
    icon: null,
    defaultGoalId: null,
    isPinned: true,
    isSystem: false,
    status: 'active',
    notionUrl: null,
    matchKeywords: [],
    weeklyTimeMinutes: 120,
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-24T10:00:00.000Z',
    deletedAt: null,
    isQuiet: false,
    weeklyFocusMinutes: 60,
    openBlockCount: 1,
    nextBlockTitle: null,
    lastTouchedAt: '2026-11-24T10:00:00.000Z',
    weeklyVarianceStatus: 'on_track',
    weeklyHistory8w: [],
    averageWeeklyMinutes8w: 60,
    learnedBlockSizeMinutes: 60,
    sizeDriftPct: null,
  },
];

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

describe('SideWorkSection', () => {
  it('renders nothing when empty and shows mapped and unmapped side work entries when present', () => {
    const { container, rerender } = render(<SideWorkSection sideWork={null} projects={PROJECTS} />);
    expect(container).toBeEmptyDOMElement();

    rerender(
      <SideWorkSection
        sideWork={[
          {
            projectId: COV_ID,
            projectName: 'Covestro',
            messageCount: 29,
            threads: [{ title: 'Run Daily Maintenance Flow', messageCount: 29 }],
          },
          {
            projectId: null,
            projectName: 'Workspace',
            messageCount: 1,
            threads: [{ title: 'Quick check', messageCount: 1 }],
          },
        ]}
        projects={PROJECTS}
      />,
    );

    const section = screen.getByRole('region', { name: 'Also during this block' });
    expect(within(section).getByText('Time stays on this block')).toBeInTheDocument();
    expect(within(section).getByText('Covestro')).toBeInTheDocument();
    expect(within(section).getByText('29 messages')).toBeInTheDocument();
    expect(within(section).getByText('Run Daily Maintenance Flow')).toBeInTheDocument();
    expect(within(section).getByText('Workspace')).toBeInTheDocument();
    expect(within(section).getByText('1 message')).toBeInTheDocument();
  });
});

describe('DailyNotesDrawer tags and autocomplete', () => {
  it('filters notes by tag across dates, auto-tags notes added in tag view, and handles # autocomplete without closing the drawer on Esc', async () => {
    const user = userEvent.setup();
    const notes: DailyNote[] = [
      {
        id: 'n1',
        date: '2026-11-20',
        content: '#veyra drag handle feels sticky',
        projectId: null,
        goalId: null,
        isOps: false,
        tags: ['veyra'],
        createdAt: '2026-11-20T09:00:00.000Z',
        updatedAt: '2026-11-20T09:00:00.000Z',
        deletedAt: null,
      },
      {
        id: 'n2',
        date: '2026-11-26',
        content: 'Today plain note',
        projectId: null,
        goalId: null,
        isOps: false,
        tags: [],
        createdAt: '2026-11-26T10:00:00.000Z',
        updatedAt: '2026-11-26T10:00:00.000Z',
        deletedAt: null,
      },
    ];
    const postBodies: Array<Record<string, unknown>> = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(typeof input === 'string' ? input : input.toString(), 'http://localhost');
        const method = (init?.method ?? 'GET').toUpperCase();

        if (url.pathname === '/api/projects' && method === 'GET') {
          return jsonResponse({ projects: PROJECTS });
        }
        if (url.pathname === '/api/notes/tags' && method === 'GET') {
          return jsonResponse({
            tags: [
              { tag: 'veyra', count: 1 },
              { tag: 'ux', count: 1 },
            ],
          });
        }
        if (url.pathname === '/api/notes' && method === 'GET') {
          const tag = url.searchParams.get('tag');
          const date = url.searchParams.get('date');
          const filtered = notes.filter((n) => {
            if (tag) return n.tags.includes(tag);
            if (date) return n.date === date;
            return true;
          });
          return jsonResponse({ notes: filtered });
        }
        if (url.pathname === '/api/notes' && method === 'POST') {
          const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
          postBodies.push(body);
          const created: DailyNote = {
            id: 'n3',
            date: String(body.date ?? '2026-11-26'),
            content: String(body.content ?? ''),
            projectId: null,
            goalId: null,
            isOps: false,
            tags: Array.isArray(body.tags) ? (body.tags as string[]) : [],
            createdAt: '2026-11-26T11:00:00.000Z',
            updatedAt: '2026-11-26T11:00:00.000Z',
            deletedAt: null,
          };
          notes.push(created);
          return jsonResponse({ note: created }, 201);
        }
        return jsonResponse({ error: { code: 'NOT_FOUND', message: url.pathname } }, 404);
      }),
    );

    const onClose = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={qc}>
        <DailyNotesDrawer open date="2026-11-26" onClose={onClose} />
      </QueryClientProvider>,
    );

    const dialog = await screen.findByRole('dialog', { name: 'Notes' });
    expect(await within(dialog).findByText('Today plain note')).toBeInTheDocument();

    // Filter by #veyra across all dates
    const filterGroup = within(dialog).getByRole('group', { name: 'Filter notes by tag' });
    await user.click(within(filterGroup).getByRole('button', { name: /#veyra/i }));
    expect(await within(dialog).findByText('#veyra drag handle feels sticky')).toBeInTheDocument();
    expect(within(dialog).queryByText('Today plain note')).not.toBeInTheDocument();

    // Type `#v` -> tag suggestions show; Escape dismisses only suggestions (drawer stays open)
    const input = within(dialog).getByLabelText('New note');
    await user.type(input, 'Check #v');
    expect(await within(dialog).findByRole('listbox', { name: 'Tag suggestions' })).toBeInTheDocument();

    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() =>
      expect(within(dialog).queryByRole('listbox', { name: 'Tag suggestions' })).not.toBeInTheDocument(),
    );
    expect(onClose).not.toHaveBeenCalled();

    // Type `#u` and press Tab -> accepts `#ux `
    await user.clear(input);
    await user.type(input, 'Polish #u');
    expect(await within(dialog).findByRole('listbox', { name: 'Tag suggestions' })).toBeInTheDocument();
    await user.keyboard('{Tab}');
    expect(input).toHaveValue('Polish #ux ');

    // Submitting in tag view attaches the active tag (`veyra`)
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(postBodies).toHaveLength(1));
    expect(postBodies[0]).toMatchObject({
      content: 'Polish #ux',
      tags: ['veyra'],
    });
  });
});
