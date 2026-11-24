import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  type VeyraDb,
  completeBlock,
  createBlock,
  deleteSession,
  getBlockDetail,
  getFocusStatus,
  listSessions,
  logManualSession,
  openVeyraDb,
  pauseFocus,
  resumeFocus,
  splitSession,
  startFocus,
  stopFocus,
  trimSession,
  updateSettings,
} from '../src/index.js';

describe('Task 4: Focus Sessions (single focus, multi-day totals, pause/stop/complete, trim/split/log)', () => {
  let veyraDb: VeyraDb;

  beforeEach(() => {
    veyraDb = openVeyraDb(':memory:');
    updateSettings(veyraDb, { timezone: 'Europe/Berlin' });
  });

  afterEach(() => {
    veyraDb.close();
  });

  it('enforces single focus invariant: starting focus on Block B closes Block A session automatically', () => {
    const t0 = new Date('2026-11-23T09:00:00.000Z');
    const t1 = new Date('2026-11-23T09:30:00.000Z');

    const blockA = createBlock(veyraDb, { title: 'Block A' }, { now: t0 });
    const blockB = createBlock(veyraDb, { title: 'Block B' }, { now: t0 });

    const firstStart = startFocus(veyraDb, blockA.id, t0);
    expect(firstStart.closedSession).toBeNull();
    expect(firstStart.startedSession.blockId).toBe(blockA.id);
    expect(firstStart.startedSession.endedAt).toBeNull();

    const secondStart = startFocus(veyraDb, blockB.id, t1);
    expect(secondStart.closedSession).not.toBeNull();
    expect(secondStart.closedSession?.id).toBe(firstStart.startedSession.id);
    expect(secondStart.closedSession?.endedAt).toBe(t1.toISOString());
    expect(secondStart.startedSession.blockId).toBe(blockB.id);
    expect(secondStart.startedSession.endedAt).toBeNull();

    const status = getFocusStatus(veyraDb, new Date('2026-11-23T09:45:00.000Z'));
    expect(status.activeSession?.id).toBe(secondStart.startedSession.id);
    expect(status.activeBlock?.id).toBe(blockB.id);
    expect(status.elapsedSeconds).toBe(900);
    // 30m from Block A + 15m active on Block B = 45m today
    expect(status.focusedTodayMinutes).toBe(45);
  });

  it('tracks multi-day totals accurately (75m Friday + 47m Monday => 122m total, 47m focusedTodayMinutes)', () => {
    const fridayStart = '2026-11-20T10:00:00.000Z';
    const fridayEnd = '2026-11-20T11:15:00.000Z'; // 75m
    const mondayStart = new Date('2026-11-23T08:00:00.000Z');
    const mondayNow = new Date('2026-11-23T08:47:00.000Z'); // 47m

    const block = createBlock(
      veyraDb,
      { title: 'Multi-day feature' },
      { now: fridayStart },
    );

    logManualSession(veyraDb, {
      blockId: block.id,
      startedAt: fridayStart,
      endedAt: fridayEnd,
      note: 'Friday progress',
    });

    startFocus(veyraDb, block.id, mondayStart);

    const detail = getBlockDetail(veyraDb, block.id, mondayNow);
    expect(detail.sessions).toHaveLength(2);
    expect(detail.sessions[0].startedAt).toBe(mondayStart.toISOString()); // newest first
    expect(detail.totalFocusMinutes).toBe(122);

    const status = getFocusStatus(veyraDb, mondayNow);
    expect(status.focusedTodayMinutes).toBe(47);
  });

  it('clips focusedTodayMinutes to local day bounds in Settings.timezone across midnight', () => {
    // Europe/Berlin is UTC+1 in November:
    // Local 2026-11-24 starts at 2026-11-23T23:00:00.000Z.
    // Session 22:30Z -> 23:20Z (50m total): 30m on Nov 23, 20m on Nov 24.
    const block = createBlock(veyraDb, { title: 'Late night debugging' });
    logManualSession(veyraDb, {
      blockId: block.id,
      startedAt: '2026-11-23T22:30:00.000Z',
      endedAt: '2026-11-23T23:20:00.000Z',
    });

    const statusNov24 = getFocusStatus(veyraDb, '2026-11-23T23:30:00.000Z');
    expect(statusNov24.focusedTodayMinutes).toBe(20);
  });

  it('completes active session block when blockId is omitted and throws NotFoundError when none active', () => {
    expect(() => completeBlock(veyraDb)).toThrow(NotFoundError);

    const fridayStart = '2026-11-20T10:00:00.000Z';
    const fridayEnd = '2026-11-20T11:00:00.000Z'; // 60m
    const mondayStart = new Date('2026-11-23T09:00:00.000Z');
    const mondayDone = new Date('2026-11-23T09:40:00.000Z'); // 40m

    const block = createBlock(veyraDb, { title: 'Release API' }, { now: fridayStart });
    logManualSession(veyraDb, {
      blockId: block.id,
      startedAt: fridayStart,
      endedAt: fridayEnd,
    });
    startFocus(veyraDb, block.id, mondayStart);

    const completed = completeBlock(
      veyraDb,
      undefined,
      { energySignal: 'up', outcomeNote: 'Shipped' },
      mondayDone,
    );

    expect(completed.block.id).toBe(block.id);
    expect(completed.block.status).toBe('done');
    expect(completed.block.energySignal).toBe('up');
    expect(completed.block.outcomeNote).toBe('Shipped');
    expect(completed.closedSession?.endedAt).toBe(mondayDone.toISOString());
    expect(completed.currentSessionMinutes).toBe(40);
    expect(completed.totalBlockMinutes).toBe(100);

    const status = getFocusStatus(veyraDb, mondayDone);
    expect(status.activeSession).toBeNull();
    expect(status.focusedTodayMinutes).toBe(40);
  });

  it('supports pauseFocus (saves resumeNote), resumeFocus, and stopFocus', () => {
    const t0 = new Date('2026-11-23T10:00:00.000Z');
    const t1 = new Date('2026-11-23T10:25:00.000Z');
    const t2 = new Date('2026-11-23T10:40:00.000Z');
    const t3 = new Date('2026-11-23T11:00:00.000Z');

    const block = createBlock(veyraDb, { title: 'Draft spec' }, { now: t0 });
    startFocus(veyraDb, block.id, t0);

    const paused = pauseFocus(veyraDb, { note: 'Next: finish edge cases section' }, t1);
    expect(paused.closedSession.endedAt).toBe(t1.toISOString());
    expect(paused.block.resumeNote).toBe('Next: finish edge cases section');
    expect(paused.block.status).toBe('todo');

    const resumed = resumeFocus(veyraDb, block.id, t2);
    expect(resumed.startedSession.blockId).toBe(block.id);

    const stopped = stopFocus(veyraDb, t3);
    expect(stopped.closedSession.endedAt).toBe(t3.toISOString());
    expect(stopped.block.status).toBe('todo');
    expect(stopped.block.resumeNote).toBe('Next: finish edge cases section');
  });

  it('splits a 09:00-11:00 session with a 20m break at 10:00 into 09:00-10:00 and 10:20-11:00', () => {
    const block = createBlock(veyraDb, { title: 'Long coding session' });
    const session = logManualSession(veyraDb, {
      blockId: block.id,
      startedAt: '2026-11-23T09:00:00.000Z',
      endedAt: '2026-11-23T11:00:00.000Z',
      note: 'Deep work',
    });

    const { firstSession, secondSession } = splitSession(veyraDb, session.id, {
      breakStartAt: '2026-11-23T10:00:00.000Z',
      breakMinutes: 20,
    });

    expect(firstSession.startedAt).toBe('2026-11-23T09:00:00.000Z');
    expect(firstSession.endedAt).toBe('2026-11-23T10:00:00.000Z');
    expect(secondSession.startedAt).toBe('2026-11-23T10:20:00.000Z');
    expect(secondSession.endedAt).toBe('2026-11-23T11:00:00.000Z');

    const detail = getBlockDetail(veyraDb, block.id);
    expect(detail.sessions).toHaveLength(2);
    expect(detail.totalFocusMinutes).toBe(100);
  });

  it('validates trimSession bounds and rejects overlaps with ConflictError, and supports deleteSession', () => {
    const block = createBlock(veyraDb, { title: 'Trim test' });
    const s1 = logManualSession(veyraDb, {
      blockId: block.id,
      startedAt: '2026-11-23T09:00:00.000Z',
      endedAt: '2026-11-23T10:00:00.000Z',
    });
    const s2 = logManualSession(veyraDb, {
      blockId: block.id,
      startedAt: '2026-11-23T10:30:00.000Z',
      endedAt: '2026-11-23T11:30:00.000Z',
    });

    // endedAt <= startedAt rejected with ValidationError
    expect(() =>
      trimSession(veyraDb, s1.id, {
        startedAt: '2026-11-23T10:00:00.000Z',
        endedAt: '2026-11-23T09:30:00.000Z',
      }),
    ).toThrow(ValidationError);

    expect(() =>
      trimSession(veyraDb, s1.id, {
        startedAt: '2026-11-23T10:00:00.000Z',
        endedAt: '2026-11-23T10:00:00.000Z',
      }),
    ).toThrow(ValidationError);

    // Overlapping s2 rejected with ConflictError
    expect(() =>
      trimSession(veyraDb, s1.id, {
        startedAt: '2026-11-23T09:00:00.000Z',
        endedAt: '2026-11-23T10:45:00.000Z',
      }),
    ).toThrow(ConflictError);

    // Touching boundary (10:30) is allowed
    const trimmed = trimSession(veyraDb, s1.id, {
      startedAt: '2026-11-23T09:15:00.000Z',
      endedAt: '2026-11-23T10:30:00.000Z',
      note: 'Adjusted start',
    });
    expect(trimmed.startedAt).toBe('2026-11-23T09:15:00.000Z');
    expect(trimmed.endedAt).toBe('2026-11-23T10:30:00.000Z');
    expect(trimmed.note).toBe('Adjusted start');

    deleteSession(veyraDb, s2.id);
    expect(listSessions(veyraDb, { blockId: block.id })).toHaveLength(1);
  });
});
