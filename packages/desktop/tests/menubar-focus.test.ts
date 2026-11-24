import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createBlock,
  createProject,
  formatLocalDate,
  getSettings,
  startFocus,
  type FocusStatus,
} from '@veyra/core';
import { createVeyraServer, type VeyraServerInstance } from '@veyra/server/app';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyFocusStatus,
  applyTodayUpNext,
  buildTrayMenuDescriptors,
  computeLiveElapsedSeconds,
  EMPTY_MENUBAR_FOCUS_STATE,
  formatMenuBarElapsed,
  formatMenuBarTitle,
  formatTrayToolTip,
  MenuBarFocusController,
  parseSseChunk,
  shouldRefreshTrayForEvent,
  truncateMenuBarText,
  type MenuBarFocusState,
} from '../src/menubar-focus.js';

const tempDirs: string[] = [];
const runningServers: VeyraServerInstance[] = [];
const activeControllers: MenuBarFocusController[] = [];

function createTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veyra-desktop-menubar-'));
  tempDirs.push(dir);
  return path.join(dir, 'veyra.db');
}

async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for condition`);
}

afterEach(async () => {
  while (activeControllers.length > 0) {
    const ctrl = activeControllers.pop();
    ctrl?.stop();
  }
  while (runningServers.length > 0) {
    const srv = runningServers.pop();
    if (srv) {
      await srv.stop();
    }
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('@veyra/desktop menubar-focus formatting', () => {
  it('formats elapsed stopwatch seconds as MM:SS under one hour and H:MM:SS at/over one hour', () => {
    expect(formatMenuBarElapsed(0)).toBe('00:00');
    expect(formatMenuBarElapsed(7)).toBe('00:07');
    expect(formatMenuBarElapsed(47)).toBe('00:47');
    expect(formatMenuBarElapsed(60)).toBe('01:00');
    expect(formatMenuBarElapsed(3599)).toBe('59:59');
    expect(formatMenuBarElapsed(3600)).toBe('1:00:00');
    expect(formatMenuBarElapsed(3661)).toBe('1:01:01');
    expect(formatMenuBarElapsed(36_000)).toBe('10:00:00');
    expect(formatMenuBarElapsed(-15)).toBe('00:00');
    expect(formatMenuBarElapsed(Number.NaN)).toBe('00:00');
    expect(formatMenuBarElapsed(47.9)).toBe('00:47');
  });

  it('truncates long titles cleanly with whitespace normalization and Unicode safety', () => {
    expect(truncateMenuBarText('  Ship   timer \n now  ', 20)).toBe('Ship timer now');
    expect(truncateMenuBarText('12345678901234567890', 20)).toBe('12345678901234567890');
    expect(truncateMenuBarText('Ship menu bar live focus timer', 20)).toBe('Ship menu bar live…');
    expect(Array.from(truncateMenuBarText('Ship menu bar live focus timer', 20)).length).toBeLessThanOrEqual(20);
    expect(truncateMenuBarText('🚀🎯🔥✨🎉💡🚀🎯🔥✨🎉💡', 6)).toBe('🚀🎯🔥✨🎉…');
    expect(truncateMenuBarText('   ', 20)).toBe('');
  });

  it('formats active menu bar title, updates second-by-second, and clears immediately when idle', () => {
    const t0 = Date.parse('2026-11-24T10:00:00.000Z');
    const activeStatus: FocusStatus = {
      activeSession: {
        id: '11111111-1111-4111-8111-111111111111',
        blockId: '22222222-2222-4222-8222-222222222222',
        startedAt: '2026-11-24T09:59:13.000Z',
        endedAt: null,
        durationMinutes: null,
        endReason: null,
        pauseNote: null,
        source: 'stopwatch',
        createdAt: '2026-11-24T09:59:13.000Z',
      },
      activeBlock: {
        id: '22222222-2222-4222-8222-222222222222',
        title: 'Write menu bar live timer specs',
        projectId: '33333333-3333-4333-8333-333333333333',
        goalId: null,
        isOps: false,
        status: 'todo',
        bucket: 'scheduled',
        scheduledDate: '2026-11-24',
        dueDate: null,
        revisitDate: null,
        plannedStartAt: null,
        plannedEndAt: null,
        sortOrder: 0,
        notes: '',
        notionUrl: null,
        energySignal: null,
        outcomeNote: null,
        postBlockSummary: null,
        opsPattern: null,
        recurrence: null,
        seriesId: null,
        carryoverCount: 0,
        createdAt: '2026-11-24T08:00:00.000Z',
        updatedAt: '2026-11-24T08:00:00.000Z',
        deletedAt: null,
      },
      elapsedSeconds: 47,
      focusedTodayMinutes: 15,
    };

    const activeState = applyFocusStatus(EMPTY_MENUBAR_FOCUS_STATE, activeStatus, t0);
    expect(formatMenuBarTitle(activeState, t0)).toBe(' 00:47 · Write menu bar live…');
    expect(formatMenuBarTitle(activeState, t0 + 1000)).toBe(' 00:48 · Write menu bar live…');
    expect(formatMenuBarTitle(activeState, t0 + 13_000)).toBe(' 01:00 · Write menu bar live…');
    expect(formatTrayToolTip(activeState, t0)).toBe(
      'Veyra — Write menu bar live timer specs (00:47)',
    );
    expect(computeLiveElapsedSeconds(activeState, t0 - 500)).toBe(47);

    const clearedState = applyFocusStatus(
      activeState,
      {
        activeSession: null,
        activeBlock: null,
        elapsedSeconds: 0,
        focusedTodayMinutes: 16,
      },
      t0 + 14_000,
    );
    expect(formatMenuBarTitle(clearedState, t0 + 14_000)).toBe('');
    expect(formatTrayToolTip(clearedState, t0 + 14_000)).toBe('Veyra');
  });
});

describe('@veyra/desktop tray menu descriptors', () => {
  const baseShortcuts = {
    captureShortcutLabel: '⌘⇧P',
    quickFocusShortcutLabel: '⌘⇧O',
    commandShortcutLabel: '⌥K',
  };

  it('builds focusing menu with active header, focus controls, and standard actions', () => {
    const t0 = Date.parse('2026-11-24T12:00:00.000Z');
    const state: MenuBarFocusState = {
      activeSession: {
        id: '11111111-1111-4111-8111-111111111111',
        blockId: 'block-1',
        startedAt: '2026-11-24T11:55:00.000Z',
        endedAt: null,
        durationMinutes: null,
        endReason: null,
        pauseNote: null,
        source: 'stopwatch',
        createdAt: '2026-11-24T11:55:00.000Z',
      },
      activeBlock: { id: 'block-1', title: 'Draft Q4 roadmap' },
      anchorElapsedSeconds: 300,
      syncedAtMs: t0,
      upNext: [{ id: 'block-2', title: 'Review PRs' }],
    };

    const items = buildTrayMenuDescriptors(state, { ...baseShortcuts, nowMs: t0 + 5000 });
    const labels = items.map((item) => (item.type === 'separator' ? '---' : item.label));

    expect(labels).toEqual([
      'Draft Q4 roadmap · 05:05',
      'Open Focus',
      'Pause Session',
      'Stop Session',
      'Complete Block',
      '---',
      'Show Veyra',
      'Quick Capture (⌘⇧P)',
      'Quick Focus (⌘⇧O)',
      'Command Palette (⌥K)',
      '---',
      'Quit',
    ]);

    expect(items[0]).toEqual({
      type: 'normal',
      label: 'Draft Q4 roadmap · 05:05',
      enabled: false,
    });
    expect(items[1]).toMatchObject({ action: { type: 'open-focus' } });
    expect(items[2]).toMatchObject({ action: { type: 'pause-session' } });
    expect(items[3]).toMatchObject({ action: { type: 'stop-session' } });
    expect(items[4]).toMatchObject({
      action: { type: 'complete-block', blockId: 'block-1' },
    });
  });

  it('builds idle menu with up to 3 Up Next blocks to start focus in one click', () => {
    const state = applyTodayUpNext(EMPTY_MENUBAR_FOCUS_STATE, [
      { id: 'b1', title: 'First block' },
      { id: 'b2', title: 'Second block' },
      { id: 'b3', title: 'Third block' },
      { id: 'b4', title: 'Fourth block should be omitted' },
    ]);

    const items = buildTrayMenuDescriptors(state, baseShortcuts);
    const labels = items.map((item) => (item.type === 'separator' ? '---' : item.label));

    expect(labels).toEqual([
      'Up Next',
      '▶ First block',
      '▶ Second block',
      '▶ Third block',
      '---',
      'Show Veyra',
      'Quick Capture (⌘⇧P)',
      'Quick Focus (⌘⇧O)',
      'Command Palette (⌥K)',
      '---',
      'Quit',
    ]);

    expect(items[0]).toEqual({ type: 'normal', label: 'Up Next', enabled: false });
    expect(items[1]).toMatchObject({ enabled: true, action: { type: 'start-focus', blockId: 'b1' } });
    expect(items[2]).toMatchObject({ enabled: true, action: { type: 'start-focus', blockId: 'b2' } });
    expect(items[3]).toMatchObject({ enabled: true, action: { type: 'start-focus', blockId: 'b3' } });
  });

  it('omits Up Next section when idle and Today has no open blocks', () => {
    const items = buildTrayMenuDescriptors(EMPTY_MENUBAR_FOCUS_STATE, baseShortcuts);
    const labels = items.map((item) => (item.type === 'separator' ? '---' : item.label));

    expect(labels).toEqual([
      'Show Veyra',
      'Quick Capture (⌘⇧P)',
      'Quick Focus (⌘⇧O)',
      'Command Palette (⌥K)',
      '---',
      'Quit',
    ]);
  });
});

describe('@veyra/desktop SSE parsing and filtering', () => {
  it('parses chunked SSE frames and ignores comment heartbeats', () => {
    const step1 = parseSseChunk('', ': connected\n\n: heartbeat\n\ndata: {"type":"focus.');
    expect(step1.events).toEqual([]);
    expect(step1.remainder).toBe('data: {"type":"focus.');

    const step2 = parseSseChunk(
      step1.remainder,
      'started","entity":"focus_session","timestamp":"2026-11-24T10:00:00.000Z"}\r\n\r\n',
    );
    expect(step2.events).toEqual([
      {
        type: 'focus.started',
        entity: 'focus_session',
        timestamp: '2026-11-24T10:00:00.000Z',
      },
    ]);
    expect(step2.remainder).toBe('');
  });

  it('refreshes tray only for focus, session, block, rollover, or unknown events', () => {
    const ts = '2026-11-24T10:00:00.000Z';
    expect(shouldRefreshTrayForEvent({ type: 'focus.started', entity: 'focus_session', timestamp: ts })).toBe(true);
    expect(shouldRefreshTrayForEvent({ type: 'focus.paused', entity: 'focus_session', timestamp: ts })).toBe(true);
    expect(shouldRefreshTrayForEvent({ type: 'block.completed', entity: 'block', timestamp: ts })).toBe(true);
    expect(shouldRefreshTrayForEvent({ type: 'block.created', entity: 'block', timestamp: ts })).toBe(true);
    expect(shouldRefreshTrayForEvent({ type: 'rollover.completed', entity: 'block', timestamp: ts })).toBe(true);
    expect(shouldRefreshTrayForEvent(null)).toBe(true);

    expect(shouldRefreshTrayForEvent({ type: 'daily_note.created', entity: 'daily_note', timestamp: ts })).toBe(false);
    expect(shouldRefreshTrayForEvent({ type: 'events.synced', entity: 'calendar_event', timestamp: ts })).toBe(false);
    expect(shouldRefreshTrayForEvent({ type: 'settings.updated', entity: 'settings', timestamp: ts })).toBe(false);
  });
});

describe('@veyra/desktop MenuBarFocusController live server transitions', () => {
  it('syncs initial Today Up Next + Focus, reacts to SSE updates, and executes tray actions', async () => {
    const server = createVeyraServer({
      dbPath: createTempDbPath(),
      port: 0,
      host: '127.0.0.1',
    });
    runningServers.push(server);
    const { url } = await server.start();

    const tz = getSettings(server.db).timezone;
    const today = formatLocalDate(new Date(), tz);
    const project = createProject(server.db, { name: 'Core' });
    const blockA = createBlock(server.db, {
      title: 'Build menu bar timer',
      projectId: project.id,
      bucket: 'scheduled',
      scheduledDate: today,
    });
    const blockB = createBlock(server.db, {
      title: 'Polish tray menu',
      projectId: project.id,
      bucket: 'scheduled',
      scheduledDate: today,
    });

    const states: MenuBarFocusState[] = [];
    let tickCount = 0;
    const controller = new MenuBarFocusController({
      onStateChange: (s) => states.push(s),
      onTick: () => {
        tickCount += 1;
      },
      tickIntervalMs: 50,
      sseDebounceMs: 15,
    });
    activeControllers.push(controller);

    controller.configure({ serverUrl: url });

    // Initial GET /api/focus + GET /api/today populates Up Next while idle
    await waitFor(() => controller.getState().upNext.length === 2);
    expect(controller.getState().activeSession).toBeNull();
    expect(controller.getState().upNext.map((b) => b.title)).toEqual([
      'Build menu bar timer',
      'Polish tray menu',
    ]);
    expect(formatMenuBarTitle(controller.getState())).toBe('');

    // Start focus directly from the tray menu (one click on Up Next)
    const started = await controller.startFocus(blockA.id);
    expect(started).toBe(true);
    expect(controller.getState().activeBlock?.id).toBe(blockA.id);
    expect(formatMenuBarTitle(controller.getState())).toMatch(/^ \d{2}:\d{2} · Build menu bar timer$/);

    // Live ticker runs while focusing
    await waitFor(() => tickCount >= 2);

    // Pause session clears the menu bar title immediately
    const paused = await controller.pauseFocus();
    expect(paused).toBe(true);
    expect(controller.getState().activeSession).toBeNull();
    expect(formatMenuBarTitle(controller.getState())).toBe('');

    // External focus start (e.g. from web UI or CLI) arrives via SSE stream
    const res = await fetch(`${url}/api/focus/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blockId: blockB.id }),
    });
    expect(res.ok).toBe(true);

    await waitFor(() => controller.getState().activeBlock?.id === blockB.id);
    expect(formatMenuBarTitle(controller.getState())).toMatch(/^ \d{2}:\d{2} · Polish tray menu$/);

    // Complete block from tray clears active session and removes blockB from Up Next
    const completed = await controller.completeBlock(blockB.id);
    expect(completed).toBe(true);
    expect(controller.getState().activeSession).toBeNull();
    expect(formatMenuBarTitle(controller.getState())).toBe('');

    await waitFor(() => controller.getState().upNext.length === 1);
    expect(controller.getState().upNext[0]?.id).toBe(blockA.id);
    expect(states.length).toBeGreaterThan(0);
  });

  it('authenticates with bearer token in remote mode and resets state on server switch', async () => {
    const token = 'test-remote-token-xyz';
    const remoteServer = createVeyraServer({
      dbPath: createTempDbPath(),
      port: 0,
      host: '127.0.0.1',
      bearerToken: token,
    });
    runningServers.push(remoteServer);
    const { url: remoteUrl } = await remoteServer.start();

    const tz = getSettings(remoteServer.db).timezone;
    const today = formatLocalDate(new Date(), tz);
    const project = createProject(remoteServer.db, { name: 'Remote Work' });
    const block = createBlock(remoteServer.db, {
      title: 'Docker focus block',
      projectId: project.id,
      bucket: 'scheduled',
      scheduledDate: today,
    });
    startFocus(remoteServer.db, block.id);

    const localServer = createVeyraServer({
      dbPath: createTempDbPath(),
      port: 0,
      host: '127.0.0.1',
    });
    runningServers.push(localServer);
    const { url: localUrl } = await localServer.start();

    const controller = new MenuBarFocusController({
      onStateChange: () => {},
      sseDebounceMs: 15,
    });
    activeControllers.push(controller);

    // Connect to authenticated remote server with active session
    controller.configure({ serverUrl: remoteUrl, token });
    await waitFor(() => controller.getState().activeBlock?.id === block.id);
    expect(formatMenuBarTitle(controller.getState())).toMatch(/^ \d{2}:\d{2} · Docker focus block$/);

    // Stop session on authenticated remote server via tray action
    const stopped = await controller.stopFocus();
    expect(stopped).toBe(true);
    expect(controller.getState().activeSession).toBeNull();
    expect(formatMenuBarTitle(controller.getState())).toBe('');

    // Restart focus on remote, then switch target to idle local server -> clears immediately
    await controller.startFocus(block.id);
    expect(controller.getState().activeBlock?.id).toBe(block.id);

    controller.configure({ serverUrl: localUrl, token: null });
    expect(controller.getState().activeSession).toBeNull();
    expect(formatMenuBarTitle(controller.getState())).toBe('');
  });

  it('reconnects SSE with backoff after disconnect and re-syncs focus state', async () => {
    const encoder = new TextEncoder();
    let sseAttempts = 0;
    let focusFetches = 0;
    let sseConnected = false;

    const mockFetch: typeof fetch = async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/api/events/stream')) {
        sseAttempts += 1;
        if (sseAttempts === 1) {
          throw new Error('simulated disconnect');
        }
        sseConnected = true;
        const stream = new ReadableStream<Uint8Array>({
          start(ctrl) {
            ctrl.enqueue(encoder.encode(': connected\n\n'));
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }
      if (url.endsWith('/api/focus')) {
        focusFetches += 1;
        const active = focusFetches >= 2;
        const payload: FocusStatus = active
          ? {
              activeSession: {
                id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                blockId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
                startedAt: '2026-11-24T10:00:00.000Z',
                endedAt: null,
                durationMinutes: null,
                endReason: null,
                pauseNote: null,
                source: 'stopwatch',
                createdAt: '2026-11-24T10:00:00.000Z',
              },
              activeBlock: {
                id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
                title: 'Recovered focus block',
                projectId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
                goalId: null,
                isOps: false,
                status: 'todo',
                bucket: 'scheduled',
                scheduledDate: '2026-11-24',
                dueDate: null,
                revisitDate: null,
                plannedStartAt: null,
                plannedEndAt: null,
                sortOrder: 0,
                notes: '',
                notionUrl: null,
                energySignal: null,
                outcomeNote: null,
                postBlockSummary: null,
                opsPattern: null,
                recurrence: null,
                seriesId: null,
                carryoverCount: 0,
                createdAt: '2026-11-24T08:00:00.000Z',
                updatedAt: '2026-11-24T08:00:00.000Z',
                deletedAt: null,
              },
              elapsedSeconds: 95,
              focusedTodayMinutes: 2,
            }
          : {
              activeSession: null,
              activeBlock: null,
              elapsedSeconds: 0,
              focusedTodayMinutes: 0,
            };
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith('/api/today')) {
        return new Response(JSON.stringify({ upNext: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('not found', { status: 404 });
    };

    const controller = new MenuBarFocusController({
      onStateChange: () => {},
      fetchFn: mockFetch,
      baseReconnectMs: 25,
      maxReconnectMs: 50,
    });
    activeControllers.push(controller);

    controller.configure({ serverUrl: 'http://127.0.0.1:4173' });

    await waitFor(() => sseConnected && controller.getState().activeBlock?.title === 'Recovered focus block');
    expect(sseAttempts).toBe(2);
    expect(focusFetches).toBeGreaterThanOrEqual(2);
    expect(formatMenuBarTitle(controller.getState())).toMatch(/^ 01:3\d · Recovered focus blo…$/);
  });
});
