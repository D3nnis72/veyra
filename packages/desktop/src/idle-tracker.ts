const DEFAULT_POLL_INTERVAL_MS = 15_000;
/** Idle time after which a running session counts as "you walked away". */
export const DEFAULT_IDLE_THRESHOLD_MS = 10 * 60_000;

export interface AwayWindow {
  /** Moment of the last input (or lock/sleep) before the user left. */
  awayStartMs: number;
  /** Moment the user came back (first input after the away time). */
  awayEndMs: number;
}

export interface IdleTrackerOptions {
  /** Seconds since the last keyboard or mouse input (Electron `powerMonitor.getSystemIdleTime`). */
  getIdleSeconds: () => number;
  /** Start of the running focus session, or null when nothing is running. */
  getActiveSessionStartMs: () => number | null;
  /** True when the whole window lies inside a calendar meeting (no input during a call is normal). */
  isCoveredByMeeting?: (startMs: number, endMs: number) => boolean;
  onReturn: (window: AwayWindow) => void;
  nowFn?: () => number;
  pollIntervalMs?: number;
  thresholdMs?: number;
}

/**
 * Notices when the user was away from the keyboard while a focus session kept running, and
 * reports the away window once they are back. It never changes the session itself, the user
 * decides what to do with the time.
 */
export class IdleTracker {
  private readonly getIdleSeconds: () => number;
  private readonly getActiveSessionStartMs: () => number | null;
  private readonly isCoveredByMeeting: (startMs: number, endMs: number) => boolean;
  private readonly onReturn: (window: AwayWindow) => void;
  private readonly nowFn: () => number;
  private readonly pollIntervalMs: number;
  private readonly thresholdMs: number;

  private timer: ReturnType<typeof setInterval> | null = null;
  private awayStartMs: number | null = null;

  constructor(options: IdleTrackerOptions) {
    this.getIdleSeconds = options.getIdleSeconds;
    this.getActiveSessionStartMs = options.getActiveSessionStartMs;
    this.isCoveredByMeeting = options.isCoveredByMeeting ?? (() => false);
    this.onReturn = options.onReturn;
    this.nowFn = options.nowFn ?? Date.now;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.thresholdMs = options.thresholdMs ?? DEFAULT_IDLE_THRESHOLD_MS;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.poll(), this.pollIntervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.awayStartMs = null;
  }

  /**
   * Call when the screen locks or the machine goes to sleep. Polling cannot run while the
   * machine sleeps, so the start of the away time has to be recorded here.
   */
  markAway(): void {
    if (this.getActiveSessionStartMs() === null) return;
    if (this.awayStartMs === null) this.awayStartMs = this.nowFn();
  }

  /** One check of the idle time. Exposed for tests and for lock or wake events. */
  poll(): void {
    const sessionStartMs = this.getActiveSessionStartMs();
    if (sessionStartMs === null) {
      this.awayStartMs = null;
      return;
    }

    const now = this.nowFn();
    const idleMs = Math.max(0, this.getIdleSeconds() * 1000);
    const lastInputMs = now - idleMs;

    if (idleMs >= this.thresholdMs) {
      // Still away. The last input is the better start than a lock event that came later.
      this.awayStartMs = Math.min(this.awayStartMs ?? lastInputMs, lastInputMs);
      return;
    }

    if (this.awayStartMs === null) return;

    // Back at the keyboard. The away time ended with the first input after it.
    const awayStartMs = Math.max(this.awayStartMs, sessionStartMs);
    const awayEndMs = lastInputMs;
    this.awayStartMs = null;

    if (awayEndMs - awayStartMs < this.thresholdMs) return;
    if (this.isCoveredByMeeting(awayStartMs, awayEndMs)) return;
    this.onReturn({ awayStartMs, awayEndMs });
  }
}
