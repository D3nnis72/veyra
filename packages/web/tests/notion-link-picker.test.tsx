import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import type {
  BlockDetail,
  CalendarEvent,
  ExternalLink,
  GoalWithStats,
  NotionSearchResult,
  ProjectWithStats,
  PublicSettings,
} from '@veyra/core/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SettingsResponse } from '../src/api/client';
import { AppShellContext, type AppShellContextValue } from '../src/app/AppShellContext';
import { CreateBlockModal } from '../src/app/CreateBlockModal';
import { BlockDetailDrawer } from '../src/components/BlockDetailDrawer';
import { looksLikeUrl, normalizeUrlInput } from '../src/components/LinkPickerPopover';
import { MeetingDetailDrawer } from '../src/views/MeetingDetailDrawer';
import { SettingsView } from '../src/views/SettingsView';

const GOAL_1_ID = '11111111-1111-4111-8111-111111111111';
const PROJ_1_ID = '33333333-3333-4333-8333-333333333333';
const BLOCK_1_ID = '44444444-4444-4444-8444-444444444444';
const EVENT_1_ID = '55555555-5555-4555-8555-555555555555';

const BASE_GOALS: GoalWithStats[] = [
  {
    id: GOAL_1_ID,
    name: 'Ship Veyra v1',
    kind: 'company',
    description: '',
    doneWhen: '',
    checkInDate: null,
    measure: null,
    ifItStalls: '',
    closingNote: null,
    closedAt: null,
    color: '#3B4BD8',
    status: 'active',
    orderKey: 'a0',
    updatedAt: '2026-11-24T08:00:00.000Z',
    deletedAt: null,
    weeklyFocusMinutes: 120,
    weeklyBlockCount: 2,
    linkedProjectCount: 1,
    rankInKind: 1,
  },
];

const BASE_PROJECTS: ProjectWithStats[] = [
  {
    id: PROJ_1_ID,
    name: 'Veyra App',
    description: '',
    color: '#3B4BD8',
    icon: 'Rocket',
    defaultGoalId: GOAL_1_ID,
    isPinned: true,
    isSystem: false,
    status: 'active',
    notionUrl: 'https://notion.so/veyra-hub',
    matchKeywords: [],
    weeklyTimeMinutes: null,
    createdAt: '2026-11-01T08:00:00.000Z',
    updatedAt: '2026-11-24T08:00:00.000Z',
    deletedAt: null,
    isQuiet: false,
    weeklyFocusMinutes: 120,
    weeklyVarianceStatus: 'time_without_plan',
    weeklyHistory8w: [],
    averageWeeklyMinutes8w: 120,
    learnedBlockSizeMinutes: null,
    sizeDriftPct: null,
    openBlockCount: 1,
    nextBlockTitle: 'Build Notion link picker',
    lastTouchedAt: '2026-11-24T08:00:00.000Z',
  },
];

const NOTION_RESULTS: NotionSearchResult[] = [
  {
    id: 'notion-page-1',
    title: 'Q4 Product Roadmap',
    url: 'https://www.notion.so/Q4-Product-Roadmap-111',
    objectType: 'page',
    lastEditedTime: '2026-11-24T10:00:00.000Z',
  },
  {
    id: 'notion-db-2',
    title: 'Customer Engineering Tasks',
    url: 'https://www.notion.so/Customer-Engineering-Tasks-222',
    objectType: 'database',
    lastEditedTime: '2026-11-23T15:00:00.000Z',
  },
];

function makeSettingsResponse(
  notionConfigured: boolean,
  source: 'settings' | 'env' | null = notionConfigured ? 'settings' : null,
): SettingsResponse {
  const settings: PublicSettings = {
    id: 'default',
    theme: 'dark',
    timezone: 'Europe/Berlin',
    onboardingCompleted: true,
    serverUrl: null,
    calendarSyncMode: 'manual',
    outlookCliCommand: null,
    icsFeedUrl: null,
    calendarSyncIntervalMin: 15,
    skipDeclinedAndAllDay: true,
    lastCalendarSyncAt: null,
    webhookUrl: null,
    webhookEvents: [],
    notionConfigured,
    notionTokenSource: source,
    notionOauthClientId: null,
    notionOauthRedirectUri: null,
    notionWorkspaceName: null,
    notionOauthConfigured: false,
    macosFocusEnabled: false,
    macosFocusStartShortcut: null,
    macosFocusEndShortcut: null,
    globalCaptureShortcut: 'CommandOrControl+Shift+P',
    hotkeys: {},
    runInMenuBar: true,
    workdayStart: '09:00',
    workdayEnd: '18:00',
    updatedAt: new Date().toISOString(),
  };
  return {
    settings,
    calendarSyncStatus: {
      state: 'manual',
      lastSyncAt: null,
      lastCount: 0,
      lastError: null,
    },
    notionConfigured,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function createMockAppShell(): AppShellContextValue {
  return {
    route: 'today',
    previousRoute: 'today',
    activeProjectId: null,
    settingsSection: 'integrations',
    activeDrawer: null,
    liveSyncStatus: 'connected',
    focusStatus: null,
    liveElapsedSeconds: 0,
    projects: BASE_PROJECTS,
    goals: BASE_GOALS,
    settings: makeSettingsResponse(true, 'settings').settings,
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
}

describe('URL detection helpers', () => {
  it('distinguishes pasted URLs from free-text Notion search queries', () => {
    expect(looksLikeUrl('https://notion.so/Q4-Roadmap-123')).toBe(true);
    expect(looksLikeUrl('http://localhost:4173/plan')).toBe(true);
    expect(looksLikeUrl('notion.so/team/page')).toBe(true);
    expect(looksLikeUrl('github.com/org/repo/pull/42')).toBe(true);
    expect(looksLikeUrl('www.figma.com')).toBe(true);

    expect(looksLikeUrl('Q4 Roadmap')).toBe(false);
    expect(looksLikeUrl('app.ts')).toBe(false);
    expect(looksLikeUrl('v2.1')).toBe(false);
    expect(looksLikeUrl('')).toBe(false);

    expect(normalizeUrlInput('notion.so/my-page')).toBe('https://notion.so/my-page');
    expect(normalizeUrlInput('not a url')).toBeNull();
  });
});

describe('Inline Notion Link Picker UI & Settings', () => {
  let notionConfigured: boolean;
  let notionTokenSource: 'settings' | 'env' | null;
  let blockState: BlockDetail;
  let eventState: CalendarEvent;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    notionConfigured = true;
    notionTokenSource = 'settings';
    blockState = {
      id: BLOCK_1_ID,
      projectId: PROJ_1_ID,
      goalId: GOAL_1_ID,
      title: 'Build Notion link picker',
      isOps: false,
      bucket: 'scheduled',
      scheduledDate: '2026-11-24',
      plannedStartAt: null,
      plannedEndAt: null,
      dueDate: null,
      revisitAt: null,
      orderKey: 'a0',
      status: 'todo',
      carryoverCount: 0,
      sizeMinutes: null,
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
      updatedAt: '2026-11-24T09:00:00.000Z',
      deletedAt: null,
      sessions: [],
      totalFocusMinutes: 0,
    };
    eventState = {
      id: EVENT_1_ID,
      externalId: 'mtg-1',
      title: 'Customer Architecture Review',
      startAt: '2026-11-24T14:00:00.000Z',
      endAt: '2026-11-24T15:00:00.000Z',
      meetingUrl: 'https://teams.microsoft.com/l/meetup-join/test',
      source: 'manual',
      projectId: PROJ_1_ID,
      goalId: GOAL_1_ID,
      isOps: false,
      notes: '',
      externalLinks: [],
      updatedAt: '2026-11-24T09:00:00.000Z',
      deletedAt: null,
    };

    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      const parsed = new URL(url, 'http://localhost:4173');
      const pathname = parsed.pathname;

      if (pathname === '/api/settings' && method === 'GET') {
        return jsonResponse(makeSettingsResponse(notionConfigured, notionTokenSource));
      }
      if (pathname === '/api/settings' && method === 'PATCH') {
        const body = JSON.parse(String(init?.body ?? '{}')) as { notionToken?: string | null };
        if ('notionToken' in body) {
          if (body.notionToken && body.notionToken.trim()) {
            notionConfigured = true;
            notionTokenSource = 'settings';
          } else {
            notionConfigured = false;
            notionTokenSource = null;
          }
        }
        return jsonResponse(makeSettingsResponse(notionConfigured, notionTokenSource));
      }
      if (pathname === '/api/integrations/notion/search' && method === 'GET') {
        if (!notionConfigured) {
          return jsonResponse({ configured: false, results: [] });
        }
        const q = (parsed.searchParams.get('q') ?? '').trim().toLowerCase();
        const filtered = q
          ? NOTION_RESULTS.filter((r) => r.title.toLowerCase().includes(q))
          : NOTION_RESULTS;
        return jsonResponse({ configured: true, results: filtered });
      }
      if (pathname === '/api/integrations/notion/test' && method === 'POST') {
        return jsonResponse({
          result: {
            ok: true,
            statusCode: 200,
            workspaceName: 'Veyra HQ',
            botName: 'Veyra Link Picker',
            error: null,
          },
        });
      }
      if (pathname === '/api/projects' && method === 'GET') {
        return jsonResponse({ projects: BASE_PROJECTS });
      }
      if (pathname === '/api/goals' && method === 'GET') {
        return jsonResponse({ goals: BASE_GOALS });
      }
      if (pathname === `/api/blocks/${BLOCK_1_ID}` && method === 'GET') {
        return jsonResponse({ block: blockState });
      }
      if (pathname === `/api/blocks/${BLOCK_1_ID}` && method === 'PATCH') {
        const body = JSON.parse(String(init?.body ?? '{}')) as { externalLinks?: ExternalLink[] };
        blockState = {
          ...blockState,
          ...(body.externalLinks ? { externalLinks: body.externalLinks } : {}),
          updatedAt: new Date().toISOString(),
        };
        return jsonResponse({ block: blockState });
      }
      if (pathname === '/api/blocks' && method === 'POST') {
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          title: string;
          externalLinks?: ExternalLink[];
        };
        return jsonResponse(
          {
            block: {
              ...blockState,
              id: '66666666-6666-4666-8666-666666666666',
              title: body.title,
              externalLinks: body.externalLinks ?? [],
            },
          },
          201,
        );
      }
      if (pathname === '/api/events' && method === 'GET') {
        return jsonResponse({ events: [eventState] });
      }
      if (pathname === `/api/events/${EVENT_1_ID}` && method === 'PATCH') {
        const body = JSON.parse(String(init?.body ?? '{}')) as { externalLinks?: ExternalLink[] };
        eventState = {
          ...eventState,
          ...(body.externalLinks ? { externalLinks: body.externalLinks } : {}),
          updatedAt: new Date().toISOString(),
        };
        return jsonResponse({ event: eventState });
      }

      return jsonResponse({ error: { code: 'NOT_FOUND', message: `${method} ${pathname}` } }, 404);
    });

    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('BlockDetailDrawer searches live Notion pages, navigates with ↑↓ + Enter, and keeps drawer open on Esc', async () => {
    const user = userEvent.setup();
    const qc = createTestQueryClient();
    const onClose = vi.fn();

    render(
      <QueryClientProvider client={qc}>
        <BlockDetailDrawer blockId={BLOCK_1_ID} onClose={onClose} />
      </QueryClientProvider>,
    );

    const dialog = await screen.findByRole('dialog', { name: 'Block detail' });

    // Open picker and press Escape — closes ONLY the picker, not the drawer
    const addLinkBtn = await within(dialog).findByRole('button', { name: /Add link/i });
    await user.click(addLinkBtn);
    expect(await within(dialog).findByRole('region', { name: 'Add link picker' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(within(dialog).queryByRole('region', { name: 'Add link picker' })).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    // Open picker again, verify live Notion results, navigate down to second item, press Enter
    await user.click(await within(dialog).findByRole('button', { name: /Add link/i }));
    const listbox = await within(dialog).findByRole('listbox', { name: 'Notion search results' });
    expect(within(listbox).getByText('Q4 Product Roadmap')).toBeInTheDocument();
    expect(within(listbox).getByText('Customer Engineering Tasks')).toBeInTheDocument();

    const input = within(dialog).getByRole('combobox', { name: 'Search Notion or paste URL' });
    await user.click(input);
    await user.keyboard('{ArrowDown}{Enter}');

    // Attaches the selected database as a LinkChip
    await waitFor(() => {
      expect(within(dialog).getByText('Customer Engineering Tasks')).toBeInTheDocument();
    });
    expect(blockState.externalLinks).toEqual([
      {
        url: 'https://www.notion.so/Customer-Engineering-Tasks-222',
        title: 'Customer Engineering Tasks',
        source: 'notion',
      },
    ]);
  });

  it('BlockDetailDrawer supports zero-config direct URL paste when Notion is not configured', async () => {
    notionConfigured = false;
    notionTokenSource = null;

    const user = userEvent.setup();
    const qc = createTestQueryClient();

    render(
      <QueryClientProvider client={qc}>
        <BlockDetailDrawer blockId={BLOCK_1_ID} onClose={vi.fn()} />
      </QueryClientProvider>,
    );

    const dialog = await screen.findByRole('dialog', { name: 'Block detail' });
    await user.click(await within(dialog).findByRole('button', { name: /Add link/i }));

    const input = await within(dialog).findByRole('combobox', {
      name: 'Search Notion or paste URL',
    });
    await user.type(input, 'https://github.com/veyra/app/pull/42');
    const labelInput = within(dialog).getByLabelText('Link label');
    await user.type(labelInput, 'PR #42');
    await user.click(within(dialog).getByRole('button', { name: 'Add link' }));

    await waitFor(() => {
      expect(within(dialog).getByText('PR #42')).toBeInTheDocument();
    });
    expect(blockState.externalLinks).toEqual([
      {
        url: 'https://github.com/veyra/app/pull/42',
        title: 'PR #42',
        source: 'github',
      },
    ]);
  });

  it('MeetingDetailDrawer attaches a searched Notion page in one click', async () => {
    const user = userEvent.setup();
    const qc = createTestQueryClient();
    const shell = createMockAppShell();

    render(
      <QueryClientProvider client={qc}>
        <AppShellContext.Provider value={shell}>
          <MeetingDetailDrawer eventId={EVENT_1_ID} onClose={vi.fn()} />
        </AppShellContext.Provider>
      </QueryClientProvider>,
    );

    const dialog = await screen.findByRole('dialog', { name: 'Meeting detail' });
    await user.click(await within(dialog).findByRole('button', { name: /Add link/i }));
    const option = await within(dialog).findByRole('option', { name: /Q4 Product Roadmap/i });
    await user.click(option);

    await waitFor(() => {
      expect(within(dialog).getByText('Q4 Product Roadmap')).toBeInTheDocument();
    });
    expect(eventState.externalLinks).toEqual([
      {
        url: 'https://www.notion.so/Q4-Product-Roadmap-111',
        title: 'Q4 Product Roadmap',
        source: 'notion',
      },
    ]);
  });

  it('CreateBlockModal searches and attaches a Notion link without prematurely submitting the modal', async () => {
    const user = userEvent.setup();
    const qc = createTestQueryClient();
    const shell = createMockAppShell();
    const onClose = vi.fn();

    render(
      <QueryClientProvider client={qc}>
        <AppShellContext.Provider value={shell}>
          <CreateBlockModal open onClose={onClose} />
        </AppShellContext.Provider>
      </QueryClientProvider>,
    );

    const dialog = await screen.findByRole('dialog', { name: 'Create Block' });
    await user.type(
      within(dialog).getByPlaceholderText(/What do you want to finish/i),
      'Finalize Q4 Roadmap',
    );

    await user.click(within(dialog).getByRole('button', { name: /Add link/i }));
    const searchInput = await within(dialog).findByRole('combobox', {
      name: 'Search Notion or paste URL',
    });
    await user.type(searchInput, 'Roadmap');

    await waitFor(() => {
      expect(within(dialog).getByRole('option', { name: /Q4 Product Roadmap/i })).toBeInTheDocument();
    });

    await user.keyboard('{Enter}');

    // Picker attached link and closed, modal stayed open
    expect(onClose).not.toHaveBeenCalled();
    expect(within(dialog).getByText('Q4 Product Roadmap')).toBeInTheDocument();

    // Submit the CreateBlockModal
    await user.click(within(dialog).getByRole('button', { name: /Create Block/i }));
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });

    const createCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).includes('/api/blocks') && (init?.method ?? 'GET') === 'POST',
    );
    expect(createCall).toBeDefined();
    const payload = JSON.parse(String(createCall?.[1]?.body ?? '{}')) as {
      title: string;
      externalLinks: ExternalLink[];
    };
    expect(payload.title).toBe('Finalize Q4 Roadmap');
    expect(payload.externalLinks).toEqual([
      {
        url: 'https://www.notion.so/Q4-Product-Roadmap-111',
        title: 'Q4 Product Roadmap',
        source: 'notion',
      },
    ]);
  });

  it('SettingsView configures Notion token, tests connection, clears input after save, and removes token', async () => {
    notionConfigured = false;
    notionTokenSource = null;

    const user = userEvent.setup();
    const qc = createTestQueryClient();

    render(
      <QueryClientProvider client={qc}>
        <SettingsView section="integrations" />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Notion Links')).toBeInTheDocument();
    expect(screen.getByText('URL Paste Only')).toBeInTheDocument();

    const tokenInput = screen.getByLabelText(/Notion Integration Token/i) as HTMLInputElement;
    await user.type(tokenInput, 'ntn_test_token_456');

    // Test Connection before saving
    await user.click(screen.getByRole('button', { name: /Test Connection/i }));
    expect(await screen.findByText(/Connected to Veyra HQ/i)).toBeInTheDocument();

    // Save Token -> clears input and flips status pill to Connected
    await user.click(screen.getByRole('button', { name: /Save Token/i }));
    await waitFor(() => {
      expect(tokenInput.value).toBe('');
      expect(screen.getByText('Connected')).toBeInTheDocument();
    });

    // Remove Token -> restores URL Paste Only
    await user.click(screen.getByRole('button', { name: /Remove Token/i }));
    await waitFor(() => {
      expect(screen.getByText('URL Paste Only')).toBeInTheDocument();
    });
  });
});
