import type { CalendarEvent } from '@veyra/core';
import type { MenuBarFocusState } from './menubar-focus.js';

const DEFAULT_POLL_INTERVAL_MS = 15_000;
const DEFAULT_START_GRACE_MS = 2 * 60_000;
const DEFAULT_END_GRACE_MS = 10 * 60_000;
const INITIAL_SYNC_LOOKBACK_MS = 15_000;

export type MeetingNotificationKind =
  | 'meeting-auto-started'
  | 'meeting-switch-prompt'
  | 'meeting-ended';

export interface MeetingNotificationSpec {
  kind: MeetingNotificationKind;
  blockId: string;
  title: string;
  body: string;
  actionLabel?: string;
  onClick: () => void;
  onAction?: () => void;
}

export interface MeetingFocusSchedulerOptions {
  getState: () => MenuBarFocusState;
  startFocus: (blockId: string) => Promise<boolean>;
  showNotification: (spec: MeetingNotificationSpec) => void;
  onOpenFocus: () => void;
  onOpenFocusComplete: () => void;
  nowFn?: () => number;
  pollIntervalMs?: number;
  startGraceMs?: number;
  endGraceMs?: number;
}

function formatLocalClock(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  const hh = String(dt.getHours()).padStart(2, '0');
  const mm = String(dt.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function formatClockRange(startAt: string, endAt: string): string {
  const start = formatLocalClock(startAt);
  const end = formatLocalClock(endAt);
  if (!start || !end) return '';
  return `${start}–${end}`;
}

/**
 * Watches today's synced accepted calendar blocks in the desktop shell:
 * - At meeting start: auto-starts focus if idle (+ quiet macOS notification),
 *   or sends a notification offering to switch if another block is already running.
 * - At meeting end: if that meeting block is still the active focus session,
 *   sends a notification to complete it while keeping the timer running.
 */
export class MeetingFocusScheduler {
  private readonly getState: () => MenuBarFocusState;
  private readonly startFocus: (blockId: string) => Promise<boolean>;
  private readonly showNotification: (spec: MeetingNotificationSpec) => void;
  private readonly onOpenFocus: () => void;
  private readonly onOpenFocusComplete: () => void;
  private readonly nowFn: () => number;
  private readonly pollIntervalMs: number;
  private readonly startGraceMs: number;
  private readonly endGraceMs: number;

  private timer: ReturnType<typeof setInterval> | null = null;
  private seededInitialEvents = false;
  private readonly handledStartKeys = new Set<string>();
  private readonly handledEndKeys = new Set<string>();
  private evaluating = false;

  constructor(options: MeetingFocusSchedulerOptions) {
    this.getState = options.getState;
    this.startFocus = options.startFocus;
    this.showNotification = options.showNotification;
    this.onOpenFocus = options.onOpenFocus;
    this.onOpenFocusComplete = options.onOpenFocusComplete;
    this.nowFn = options.nowFn ?? (() => Date.now());
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.startGraceMs = options.startGraceMs ?? DEFAULT_START_GRACE_MS;
    this.endGraceMs = options.endGraceMs ?? DEFAULT_END_GRACE_MS;
  }

  start(): void {
    this.stop();
    this.timer = setInterval(() => {
      void this.evaluate();
    }, this.pollIntervalMs);
    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
    void this.evaluate();
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  reset(): void {
    this.seededInitialEvents = false;
    this.handledStartKeys.clear();
    this.handledEndKeys.clear();
  }

  onStateUpdated(): void {
    void this.evaluate();
  }

  async evaluate(): Promise<void> {
    if (this.evaluating) return;
    this.evaluating = true;

    try {
      const state = this.getState();
      const events = state.todayEvents ?? [];
      const nowMs = this.nowFn();

      if (!this.seededInitialEvents) {
        // Wait until we have synced at least once (either events loaded or syncedAtMs set)
        if (!state.hasTodaySynced) {
          return;
        }
        this.seedAlreadyPassedKeys(events, nowMs);
        this.seededInitialEvents = true;
      }

      if (state.meetingAutoFocusEnabled === false) {
        return;
      }

      await this.checkMeetingStarts(state, events, nowMs);
      this.checkMeetingEnd(state, events, nowMs);
    } finally {
      this.evaluating = false;
    }
  }

  private seedAlreadyPassedKeys(events: readonly CalendarEvent[], nowMs: number): void {
    for (const ev of events) {
      const startMs = Date.parse(ev.startAt);
      const endMs = Date.parse(ev.endAt);
      if (!Number.isNaN(startMs) && startMs < nowMs - INITIAL_SYNC_LOOKBACK_MS) {
        this.handledStartKeys.add(`start:${ev.id}:${ev.startAt}`);
      }
      if (!Number.isNaN(endMs) && endMs < nowMs - INITIAL_SYNC_LOOKBACK_MS) {
        this.handledEndKeys.add(`end:${ev.id}:${ev.endAt}`);
      }
    }
  }

  private async checkMeetingStarts(
    state: MenuBarFocusState,
    events: readonly CalendarEvent[],
    nowMs: number,
  ): Promise<void> {
    const sorted = [...events].sort((a, b) => a.startAt.localeCompare(b.startAt));

    for (const ev of sorted) {
      if (ev.status === 'done' || ev.status === 'dropped') {
        continue;
      }

      const startMs = Date.parse(ev.startAt);
      const endMs = Date.parse(ev.endAt);
      if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
        continue;
      }
      if (nowMs < startMs || nowMs >= endMs || nowMs - startMs > this.startGraceMs) {
        continue;
      }

      const startKey = `start:${ev.id}:${ev.startAt}`;
      if (this.handledStartKeys.has(startKey)) {
        continue;
      }
      this.handledStartKeys.add(startKey);

      if (state.activeSession && state.activeBlock?.id === ev.id) {
        continue;
      }

      if (!state.activeSession) {
        const started = await this.startFocus(ev.id);
        if (started) {
          const range = formatClockRange(ev.startAt, ev.endAt);
          this.showNotification({
            kind: 'meeting-auto-started',
            blockId: ev.id,
            title: `Focus started: ${ev.title}`,
            body: range ? `${range} · Click to open Focus` : 'Click to open Focus',
            actionLabel: 'Open Focus',
            onClick: () => this.onOpenFocus(),
            onAction: () => this.onOpenFocus(),
          });
          // Only auto-start one meeting if multiple share the same start timestamp.
          break;
        }
      } else {
        const activeTitle = state.activeBlock?.title ?? 'current block';
        const switchToMeeting = () => {
          void this.startFocus(ev.id).then((switched) => {
            if (switched) {
              this.onOpenFocus();
            }
          });
        };
        this.showNotification({
          kind: 'meeting-switch-prompt',
          blockId: ev.id,
          title: `Meeting starting: ${ev.title}`,
          body: `Currently focusing on "${activeTitle}". Click to switch.`,
          actionLabel: 'Switch',
          onClick: switchToMeeting,
          onAction: switchToMeeting,
        });
      }
    }
  }

  private checkMeetingEnd(
    state: MenuBarFocusState,
    events: readonly CalendarEvent[],
    nowMs: number,
  ): void {
    if (!state.activeSession || !state.activeBlock) {
      return;
    }

    const activeEvent = events.find((ev) => ev.id === state.activeBlock?.id);
    if (!activeEvent) {
      return;
    }

    const endMs = Date.parse(activeEvent.endAt);
    if (Number.isNaN(endMs) || nowMs < endMs || nowMs - endMs > this.endGraceMs) {
      return;
    }

    const endKey = `end:${activeEvent.id}:${activeEvent.endAt}`;
    if (this.handledEndKeys.has(endKey)) {
      return;
    }
    this.handledEndKeys.add(endKey);

    this.showNotification({
      kind: 'meeting-ended',
      blockId: activeEvent.id,
      title: `Meeting ended: ${activeEvent.title}`,
      body: 'Timer is still running. Click to complete this block.',
      actionLabel: 'Complete',
      onClick: () => this.onOpenFocusComplete(),
      onAction: () => this.onOpenFocusComplete(),
    });
  }
}
