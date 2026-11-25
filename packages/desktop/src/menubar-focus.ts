import type { Block, FocusSession, FocusStatus, SseEventPayload } from '@veyra/core';

export const MAX_MENUBAR_TITLE_CHARS = 20;
export const MAX_MENU_ITEM_TITLE_CHARS = 36;
export const MAX_UP_NEXT_ITEMS = 3;

const DEFAULT_TICK_INTERVAL_MS = 1000;
const DEFAULT_SSE_DEBOUNCE_MS = 50;
const DEFAULT_BASE_RECONNECT_MS = 1000;
const DEFAULT_MAX_RECONNECT_MS = 15_000;

export interface MenuBarBlockSummary {
  id: string;
  title: string;
  projectId?: string;
}

export interface MenuBarProjectSummary {
  id: string;
  name: string;
  color: string;
  icon: string | null;
}

export interface MenuBarFocusState {
  activeSession: FocusSession | null;
  activeBlock: MenuBarBlockSummary | null;
  activeProject?: MenuBarProjectSummary | null;
  anchorElapsedSeconds: number;
  syncedAtMs: number | null;
  upNext: MenuBarBlockSummary[];
}

export const EMPTY_MENUBAR_FOCUS_STATE: MenuBarFocusState = {
  activeSession: null,
  activeBlock: null,
  activeProject: null,
  anchorElapsedSeconds: 0,
  syncedAtMs: null,
  upNext: [],
};

export interface MenuBarServerTarget {
  serverUrl: string;
  token?: string | null;
}

export type TrayMenuAction =
  | { type: 'open-focus' }
  | { type: 'pause-session' }
  | { type: 'stop-session' }
  | { type: 'complete-block'; blockId?: string }
  | { type: 'start-focus'; blockId: string }
  | { type: 'show-window' }
  | { type: 'quick-capture' }
  | { type: 'quick-focus' }
  | { type: 'command-palette' }
  | { type: 'quit' };

export type TrayMenuDescriptor =
  | { type: 'separator' }
  | { type: 'normal'; label: string; enabled: boolean; action?: TrayMenuAction };

export interface BuildTrayMenuOptions {
  nowMs?: number;
  captureShortcutLabel: string;
  quickFocusShortcutLabel: string;
  commandShortcutLabel: string;
}

export function hasActiveFocusSession(state: MenuBarFocusState): boolean {
  return Boolean(state.activeSession && state.activeBlock);
}

/**
 * Formats stopwatch elapsed seconds for the macOS menu bar:
 * `MM:SS` under one hour (e.g. `00:47`), `H:MM:SS` at or above one hour (e.g. `1:05:23`).
 */
export function formatMenuBarElapsed(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const pad2 = (n: number) => String(n).padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${pad2(minutes)}:${pad2(seconds)}`;
  }
  return `${pad2(minutes)}:${pad2(seconds)}`;
}

/**
 * Normalizes whitespace and truncates text cleanly to `maxChars` Unicode codepoints
 * with a single trailing ellipsis (`…`) when truncated.
 */
export function truncateMenuBarText(text: string, maxChars = MAX_MENUBAR_TITLE_CHARS): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized || maxChars <= 0) {
    return '';
  }
  const chars = Array.from(normalized);
  if (chars.length <= maxChars) {
    return normalized;
  }
  if (maxChars === 1) {
    return '…';
  }
  const sliced = chars
    .slice(0, maxChars - 1)
    .join('')
    .trimEnd();
  return `${sliced}…`;
}

/**
 * Computes current live elapsed seconds for an active session, anchored to the
 * server-reported elapsed seconds at sync time so remote Docker clock skew and
 * test clocks never cause visible jumps.
 */
export function computeLiveElapsedSeconds(state: MenuBarFocusState, nowMs = Date.now()): number {
  if (!state.activeSession) {
    return 0;
  }
  if (state.syncedAtMs !== null) {
    const deltaSeconds = Math.floor((nowMs - state.syncedAtMs) / 1000);
    return Math.max(0, Math.floor(state.anchorElapsedSeconds) + Math.max(0, deltaSeconds));
  }
  const startMs = Date.parse(state.activeSession.startedAt);
  if (Number.isNaN(startMs)) {
    return Math.max(0, Math.floor(state.anchorElapsedSeconds));
  }
  return Math.max(0, Math.floor((nowMs - startMs) / 1000));
}

/**
 * Builds the calm macOS menu bar title rendered next to the tray icon.
 * Returns `""` immediately when idle/paused/stopped/completed.
 */
export function formatMenuBarTitle(
  state: MenuBarFocusState,
  nowMs = Date.now(),
  maxBlockTitleChars = MAX_MENUBAR_TITLE_CHARS,
): string {
  if (!state.activeSession) {
    return '';
  }
  const elapsed = formatMenuBarElapsed(computeLiveElapsedSeconds(state, nowMs));
  const blockTitle = state.activeBlock
    ? truncateMenuBarText(state.activeBlock.title, maxBlockTitleChars)
    : '';
  return blockTitle ? ` ${elapsed} · ${blockTitle}` : ` ${elapsed}`;
}

export function formatTrayToolTip(state: MenuBarFocusState, nowMs = Date.now()): string {
  if (!state.activeSession) {
    return 'Veyra';
  }
  const elapsed = formatMenuBarElapsed(computeLiveElapsedSeconds(state, nowMs));
  const title = state.activeBlock?.title?.replace(/\s+/g, ' ').trim();
  return title ? `Veyra — ${title} (${elapsed})` : `Veyra — Focusing (${elapsed})`;
}

export function applyFocusStatus(
  prev: MenuBarFocusState,
  focusStatus: FocusStatus,
  nowMs = Date.now(),
): MenuBarFocusState {
  if (!focusStatus.activeSession) {
    return {
      ...prev,
      activeSession: null,
      activeBlock: null,
      activeProject: null,
      anchorElapsedSeconds: 0,
      syncedAtMs: null,
    };
  }
  const activeBlock = focusStatus.activeBlock
    ? {
        id: focusStatus.activeBlock.id,
        title: focusStatus.activeBlock.title,
        projectId: focusStatus.activeBlock.projectId,
      }
    : null;
  const activeProject =
    activeBlock?.projectId && prev.activeProject?.id === activeBlock.projectId
      ? prev.activeProject
      : null;
  return {
    ...prev,
    activeSession: focusStatus.activeSession,
    activeBlock,
    activeProject,
    anchorElapsedSeconds: Math.max(0, Math.floor(focusStatus.elapsedSeconds ?? 0)),
    syncedAtMs: nowMs,
  };
}

export function applyTodayProjects(
  prev: MenuBarFocusState,
  projects: ReadonlyArray<MenuBarProjectSummary>,
): MenuBarFocusState {
  const projectId = prev.activeBlock?.projectId;
  if (!prev.activeSession || !projectId) {
    return prev.activeProject ? { ...prev, activeProject: null } : prev;
  }
  const found = projects.find((p) => p.id === projectId) ?? null;
  return {
    ...prev,
    activeProject: found
      ? { id: found.id, name: found.name, color: found.color, icon: found.icon ?? null }
      : null,
  };
}

export function applyTodayUpNext(
  prev: MenuBarFocusState,
  upNext: ReadonlyArray<Pick<Block, 'id' | 'title'>>,
): MenuBarFocusState {
  const sanitized: MenuBarBlockSummary[] = [];
  for (const blk of upNext) {
    if (!blk || typeof blk.id !== 'string' || typeof blk.title !== 'string') continue;
    sanitized.push({ id: blk.id, title: blk.title });
    if (sanitized.length >= MAX_UP_NEXT_ITEMS) break;
  }
  return {
    ...prev,
    upNext: sanitized,
  };
}

export function buildTrayMenuDescriptors(
  state: MenuBarFocusState,
  options: BuildTrayMenuOptions,
): TrayMenuDescriptor[] {
  const nowMs = options.nowMs ?? Date.now();
  const items: TrayMenuDescriptor[] = [];

  if (state.activeSession) {
    const elapsed = formatMenuBarElapsed(computeLiveElapsedSeconds(state, nowMs));
    const title = state.activeBlock
      ? truncateMenuBarText(state.activeBlock.title, MAX_MENU_ITEM_TITLE_CHARS) || 'Focus Session'
      : 'Focus Session';

    items.push(
      { type: 'normal', label: `${title} · ${elapsed}`, enabled: false },
      { type: 'normal', label: 'Open Focus', enabled: true, action: { type: 'open-focus' } },
      { type: 'normal', label: 'Pause Session', enabled: true, action: { type: 'pause-session' } },
      { type: 'normal', label: 'Stop Session', enabled: true, action: { type: 'stop-session' } },
      {
        type: 'normal',
        label: 'Complete Block',
        enabled: true,
        action: { type: 'complete-block', blockId: state.activeBlock?.id },
      },
      { type: 'separator' },
    );
  } else if (state.upNext.length > 0) {
    items.push({ type: 'normal', label: 'Up Next', enabled: false });
    for (const block of state.upNext.slice(0, MAX_UP_NEXT_ITEMS)) {
      const labelTitle =
        truncateMenuBarText(block.title, MAX_MENU_ITEM_TITLE_CHARS) || 'Untitled Block';
      items.push({
        type: 'normal',
        label: `▶ ${labelTitle}`,
        enabled: true,
        action: { type: 'start-focus', blockId: block.id },
      });
    }
    items.push({ type: 'separator' });
  }

  items.push(
    { type: 'normal', label: 'Show Veyra', enabled: true, action: { type: 'show-window' } },
    {
      type: 'normal',
      label: `Quick Capture (${options.captureShortcutLabel})`,
      enabled: true,
      action: { type: 'quick-capture' },
    },
    {
      type: 'normal',
      label: `Quick Focus (${options.quickFocusShortcutLabel})`,
      enabled: true,
      action: { type: 'quick-focus' },
    },
    {
      type: 'normal',
      label: `Command Palette (${options.commandShortcutLabel})`,
      enabled: true,
      action: { type: 'command-palette' },
    },
    { type: 'separator' },
    { type: 'normal', label: 'Quit', enabled: true, action: { type: 'quit' } },
  );

  return items;
}

/**
 * Returns true when an incoming SSE event could change the active focus session
 * or Today's `Up Next` queue displayed in the tray.
 */
export function shouldRefreshTrayForEvent(payload: SseEventPayload | null): boolean {
  if (!payload) return true;
  const type = payload.type ?? '';
  const entity = payload.entity ?? '';

  if (type === 'rollover.completed') return true;
  if (entity === 'focus_session' || type.startsWith('focus.') || type.startsWith('session.')) {
    return true;
  }
  if (entity === 'block' || type.startsWith('block.')) {
    return true;
  }
  if (entity === 'project' || type.startsWith('project.')) {
    return true;
  }
  return false;
}

/**
 * Incrementally parses Server-Sent Events chunks into decoded payloads.
 * Comment-only frames (e.g. `: connected`, `: heartbeat`) are ignored.
 */
export function parseSseChunk(
  previousBuffer: string,
  chunk: string,
): { events: Array<SseEventPayload | null>; remainder: string } {
  const combined = (previousBuffer + chunk).replace(/\r\n/g, '\n');
  const frames = combined.split('\n\n');
  const remainder = frames.pop() ?? '';
  const events: Array<SseEventPayload | null> = [];

  for (const frame of frames) {
    const dataLines: string[] = [];
    for (const line of frame.split('\n')) {
      if (!line || line.startsWith(':')) continue;
      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
    if (dataLines.length === 0) continue;
    const rawData = dataLines.join('\n').trim();
    if (!rawData) continue;
    try {
      events.push(JSON.parse(rawData) as SseEventPayload);
    } catch {
      events.push(null);
    }
  }

  return { events, remainder };
}

interface TodayApiSubset {
  focusStatus?: FocusStatus;
  upNext?: Array<Pick<Block, 'id' | 'title'>>;
  projects?: MenuBarProjectSummary[];
}

interface FocusMutationApiResponse {
  focusStatus?: FocusStatus;
}

export interface MenuBarFocusControllerOptions {
  onStateChange: (state: MenuBarFocusState) => void;
  onTick?: (state: MenuBarFocusState) => void;
  onError?: (context: string, error: unknown) => void;
  fetchFn?: typeof fetch;
  nowFn?: () => number;
  tickIntervalMs?: number;
  sseDebounceMs?: number;
  baseReconnectMs?: number;
  maxReconnectMs?: number;
}

function normalizeServerUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/**
 * Keeps the Electron macOS menu bar tray synchronized with the configured Veyra
 * server (local embedded or remote Docker) via initial `GET /api/focus` +
 * `GET /api/today`, live `/api/events/stream` SSE subscription, a 1-second tick
 * timer while focusing, and quick focus control mutations.
 */
export class MenuBarFocusController {
  private readonly onStateChange: (state: MenuBarFocusState) => void;
  private readonly onTick?: (state: MenuBarFocusState) => void;
  private readonly onError?: (context: string, error: unknown) => void;
  private readonly fetchFn: typeof fetch;
  private readonly nowFn: () => number;
  private readonly tickIntervalMs: number;
  private readonly sseDebounceMs: number;
  private readonly baseReconnectMs: number;
  private readonly maxReconnectMs: number;

  private target: MenuBarServerTarget | null = null;
  private state: MenuBarFocusState = { ...EMPTY_MENUBAR_FOCUS_STATE, upNext: [] };
  private generation = 0;
  private sseAbort: AbortController | null = null;
  private syncAbort: AbortController | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private syncDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempt = 0;
  private hasSyncedCurrentTarget = false;
  private syncInFlight = false;
  private syncQueued = false;

  constructor(options: MenuBarFocusControllerOptions) {
    this.onStateChange = options.onStateChange;
    this.onTick = options.onTick;
    this.onError = options.onError;
    this.fetchFn = options.fetchFn ?? fetch;
    this.nowFn = options.nowFn ?? (() => Date.now());
    this.tickIntervalMs = options.tickIntervalMs ?? DEFAULT_TICK_INTERVAL_MS;
    this.sseDebounceMs = options.sseDebounceMs ?? DEFAULT_SSE_DEBOUNCE_MS;
    this.baseReconnectMs = options.baseReconnectMs ?? DEFAULT_BASE_RECONNECT_MS;
    this.maxReconnectMs = options.maxReconnectMs ?? DEFAULT_MAX_RECONNECT_MS;
  }

  getState(): MenuBarFocusState {
    return this.state;
  }

  configure(target: MenuBarServerTarget): void {
    const normalized: MenuBarServerTarget = {
      serverUrl: normalizeServerUrl(target.serverUrl),
      token: target.token?.trim() || null,
    };

    const targetChanged =
      !this.target ||
      this.target.serverUrl !== normalized.serverUrl ||
      this.target.token !== normalized.token;

    this.teardownConnections();
    this.generation += 1;
    this.target = normalized;
    this.reconnectAttempt = 0;
    this.hasSyncedCurrentTarget = false;
    this.syncInFlight = false;
    this.syncQueued = false;

    if (targetChanged) {
      this.setState({ ...EMPTY_MENUBAR_FOCUS_STATE, upNext: [] });
    }

    const gen = this.generation;
    void this.syncNow(gen);
    void this.connectSse(gen);
  }

  stop(): void {
    this.generation += 1;
    this.teardownConnections();
    this.stopTicker();
    this.target = null;
    this.syncInFlight = false;
    this.syncQueued = false;
  }

  async syncNow(expectedGeneration = this.generation): Promise<void> {
    if (!this.target || expectedGeneration !== this.generation) {
      return;
    }

    if (this.syncInFlight) {
      this.syncQueued = true;
      return;
    }

    this.syncInFlight = true;
    const { serverUrl, token } = this.target;
    const controller = new AbortController();
    this.syncAbort = controller;

    try {
      const [focusResult, todayResult] = await Promise.allSettled([
        this.requestJson<FocusStatus>(serverUrl, token, 'GET', '/api/focus', undefined, controller.signal),
        this.requestJson<TodayApiSubset>(
          serverUrl,
          token,
          'GET',
          '/api/today',
          undefined,
          controller.signal,
        ),
      ]);

      if (expectedGeneration !== this.generation || controller.signal.aborted) {
        return;
      }

      let nextState = this.state;
      let anySucceeded = false;

      if (focusResult.status === 'fulfilled') {
        nextState = applyFocusStatus(nextState, focusResult.value, this.nowFn());
        anySucceeded = true;
      } else {
        this.onError?.('GET /api/focus', focusResult.reason);
      }

      if (todayResult.status === 'fulfilled') {
        if (focusResult.status === 'rejected' && todayResult.value.focusStatus) {
          nextState = applyFocusStatus(nextState, todayResult.value.focusStatus, this.nowFn());
        }
        if (Array.isArray(todayResult.value.upNext)) {
          nextState = applyTodayUpNext(nextState, todayResult.value.upNext);
        }
        if (Array.isArray(todayResult.value.projects)) {
          nextState = applyTodayProjects(nextState, todayResult.value.projects);
        }
        anySucceeded = true;
      } else {
        this.onError?.('GET /api/today', todayResult.reason);
      }

      if (anySucceeded) {
        this.hasSyncedCurrentTarget = true;
        this.setState(nextState);
      }
    } finally {
      if (this.syncAbort === controller) {
        this.syncAbort = null;
      }
      this.syncInFlight = false;
      if (this.syncQueued && expectedGeneration === this.generation) {
        this.syncQueued = false;
        void this.syncNow(expectedGeneration);
      }
    }
  }

  async startFocus(blockId: string): Promise<boolean> {
    return this.runFocusMutation('POST /api/focus/start', '/api/focus/start', { blockId });
  }

  async pauseFocus(): Promise<boolean> {
    return this.runFocusMutation('POST /api/focus/pause', '/api/focus/pause', {});
  }

  async stopFocus(): Promise<boolean> {
    return this.runFocusMutation('POST /api/focus/stop', '/api/focus/stop', {});
  }

  async completeBlock(blockId?: string): Promise<boolean> {
    return this.runFocusMutation(
      'POST /api/focus/complete',
      '/api/focus/complete',
      blockId ? { blockId } : {},
    );
  }

  private async runFocusMutation(
    context: string,
    endpoint: string,
    body: Record<string, unknown>,
  ): Promise<boolean> {
    if (!this.target) return false;
    const gen = this.generation;
    const { serverUrl, token } = this.target;

    try {
      const response = await this.requestJson<FocusMutationApiResponse>(
        serverUrl,
        token,
        'POST',
        endpoint,
        body,
      );
      if (gen !== this.generation) return false;

      if (response.focusStatus) {
        const nextState = applyFocusStatus(this.state, response.focusStatus, this.nowFn());
        this.setState(nextState);
      }
      // Refresh Today's Up Next list (and full state) in background
      void this.syncNow(gen);
      return true;
    } catch (err) {
      this.onError?.(context, err);
      if (gen === this.generation) {
        void this.syncNow(gen);
      }
      return false;
    }
  }

  private scheduleDebouncedSync(expectedGeneration: number): void {
    if (expectedGeneration !== this.generation) return;
    if (this.syncDebounceTimer !== null) {
      clearTimeout(this.syncDebounceTimer);
    }
    this.syncDebounceTimer = setTimeout(() => {
      this.syncDebounceTimer = null;
      if (expectedGeneration === this.generation) {
        void this.syncNow(expectedGeneration);
      }
    }, this.sseDebounceMs);
    if (typeof this.syncDebounceTimer.unref === 'function') {
      this.syncDebounceTimer.unref();
    }
  }

  private async connectSse(expectedGeneration: number): Promise<void> {
    if (!this.target || expectedGeneration !== this.generation) return;

    const { serverUrl, token } = this.target;
    const controller = new AbortController();
    this.sseAbort = controller;

    const headers: Record<string, string> = {
      Accept: 'text/event-stream',
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    try {
      const response = await this.fetchFn(`${serverUrl}/api/events/stream`, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      if (expectedGeneration !== this.generation) {
        return;
      }

      if (!response.ok || !response.body) {
        throw new Error(`SSE stream returned HTTP ${response.status}`);
      }

      const shouldResyncOnConnect = this.reconnectAttempt > 0 || !this.hasSyncedCurrentTarget;
      this.reconnectAttempt = 0;

      if (shouldResyncOnConnect) {
        void this.syncNow(expectedGeneration);
      }

      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (expectedGeneration === this.generation) {
        const { done, value } = await reader.read();
        if (done) break;
        if (expectedGeneration !== this.generation) break;

        const chunk = decoder.decode(value, { stream: true });
        const parsed = parseSseChunk(buffer, chunk);
        buffer = parsed.remainder;

        if (parsed.events.some((ev) => shouldRefreshTrayForEvent(ev))) {
          this.scheduleDebouncedSync(expectedGeneration);
        }
      }
    } catch (err) {
      if (controller.signal.aborted || expectedGeneration !== this.generation) {
        return;
      }
      this.onError?.('GET /api/events/stream', err);
    } finally {
      if (reader) {
        try {
          await reader.cancel();
        } catch {
          // Ignore stream cancellation errors during teardown
        }
      }
      if (this.sseAbort === controller) {
        this.sseAbort = null;
      }
    }

    if (expectedGeneration === this.generation && this.target) {
      this.scheduleReconnect(expectedGeneration);
    }
  }

  private scheduleReconnect(expectedGeneration: number): void {
    if (expectedGeneration !== this.generation) return;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
    }
    this.reconnectAttempt += 1;
    const delayMs = Math.min(
      this.baseReconnectMs * 2 ** Math.min(this.reconnectAttempt - 1, 4),
      this.maxReconnectMs,
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (expectedGeneration === this.generation) {
        void this.connectSse(expectedGeneration);
      }
    }, delayMs);
    if (typeof this.reconnectTimer.unref === 'function') {
      this.reconnectTimer.unref();
    }
  }

  private async requestJson<T>(
    serverUrl: string,
    token: string | null | undefined,
    method: 'GET' | 'POST',
    endpoint: string,
    body?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-Veyra-Actor': 'user',
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    if (method === 'POST') {
      headers['Content-Type'] = 'application/json';
    }

    const response = await this.fetchFn(`${serverUrl}${endpoint}`, {
      method,
      headers,
      ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}),
      ...(signal ? { signal } : {}),
    });

    if (!response.ok) {
      throw new Error(`${method} ${endpoint} failed with HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  }

  private setState(nextState: MenuBarFocusState): void {
    this.state = nextState;
    if (this.state.activeSession) {
      this.ensureTicker();
    } else {
      this.stopTicker();
    }
    this.onStateChange(this.state);
  }

  private ensureTicker(): void {
    if (this.tickTimer !== null) return;
    this.tickTimer = setInterval(() => {
      if (!this.state.activeSession) {
        this.stopTicker();
        return;
      }
      this.onTick?.(this.state);
    }, this.tickIntervalMs);
    if (typeof this.tickTimer.unref === 'function') {
      this.tickTimer.unref();
    }
  }

  private stopTicker(): void {
    if (this.tickTimer !== null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private teardownConnections(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.syncDebounceTimer !== null) {
      clearTimeout(this.syncDebounceTimer);
      this.syncDebounceTimer = null;
    }
    if (this.sseAbort) {
      this.sseAbort.abort();
      this.sseAbort = null;
    }
    if (this.syncAbort) {
      this.syncAbort.abort();
      this.syncAbort = null;
    }
  }
}
