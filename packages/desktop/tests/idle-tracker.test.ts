import { describe, expect, it } from 'vitest';
import { IdleTracker, type AwayWindow } from '../src/idle-tracker.js';

const MIN = 60_000;

function setup(opts?: { sessionStartMs?: number | null; covered?: boolean }) {
  const clock = { now: 10 * 60 * MIN };
  const state = {
    idleSeconds: 0,
    sessionStartMs: opts?.sessionStartMs === undefined ? clock.now - 120 * MIN : opts.sessionStartMs,
  };
  const returns: AwayWindow[] = [];
  const tracker = new IdleTracker({
    getIdleSeconds: () => state.idleSeconds,
    getActiveSessionStartMs: () => state.sessionStartMs,
    isCoveredByMeeting: () => opts?.covered ?? false,
    onReturn: (w) => returns.push(w),
    nowFn: () => clock.now,
    thresholdMs: 10 * MIN,
  });
  return { clock, state, tracker, returns };
}

describe('IdleTracker', () => {
  it('reports the away window once the user is back after at least the threshold', () => {
    const { clock, state, tracker, returns } = setup();
    const lastInput = clock.now;

    clock.now += 12 * MIN;
    state.idleSeconds = 12 * 60;
    tracker.poll();
    expect(returns).toHaveLength(0);

    clock.now += 11 * MIN;
    state.idleSeconds = 5;
    tracker.poll();

    expect(returns).toEqual([{ awayStartMs: lastInput, awayEndMs: clock.now - 5000 }]);
  });

  it('stays quiet for short breaks and for sessions that are not running', () => {
    const short = setup();
    short.clock.now += 9 * MIN;
    short.state.idleSeconds = 9 * 60;
    short.tracker.poll();
    short.state.idleSeconds = 1;
    short.tracker.poll();
    expect(short.returns).toHaveLength(0);

    const idleNoSession = setup({ sessionStartMs: null });
    idleNoSession.clock.now += 30 * MIN;
    idleNoSession.state.idleSeconds = 30 * 60;
    idleNoSession.tracker.poll();
    idleNoSession.state.idleSeconds = 1;
    idleNoSession.tracker.poll();
    expect(idleNoSession.returns).toHaveLength(0);
  });

  it('uses the sleep start recorded by markAway, because polling cannot run during sleep', () => {
    const { clock, state, tracker, returns } = setup();
    const sleepAt = clock.now;
    tracker.markAway();

    clock.now += 45 * MIN;
    state.idleSeconds = 3;
    tracker.poll();

    expect(returns).toEqual([{ awayStartMs: sleepAt, awayEndMs: clock.now - 3000 }]);
  });

  it('clamps the window to the session start and skips windows inside a meeting', () => {
    const clamped = setup();
    // Session started 5 min into the idle time (for example a meeting auto-start).
    clamped.clock.now += 30 * MIN;
    clamped.state.sessionStartMs = clamped.clock.now - 25 * MIN;
    clamped.state.idleSeconds = 30 * 60;
    clamped.tracker.poll();
    clamped.clock.now += 1 * MIN;
    clamped.state.idleSeconds = 2;
    clamped.tracker.poll();
    expect(clamped.returns).toHaveLength(1);
    expect(clamped.returns[0]?.awayStartMs).toBe(clamped.clock.now - 1 * MIN - 25 * MIN);

    const meeting = setup({ covered: true });
    meeting.clock.now += 40 * MIN;
    meeting.state.idleSeconds = 40 * 60;
    meeting.tracker.poll();
    meeting.state.idleSeconds = 1;
    meeting.tracker.poll();
    expect(meeting.returns).toHaveLength(0);
  });

  it('forgets the away time when the session ends meanwhile', () => {
    const { clock, state, tracker, returns } = setup();
    clock.now += 20 * MIN;
    state.idleSeconds = 20 * 60;
    tracker.poll();
    state.sessionStartMs = null;
    tracker.poll();
    state.sessionStartMs = clock.now;
    state.idleSeconds = 1;
    tracker.poll();
    expect(returns).toHaveLength(0);
  });
});
