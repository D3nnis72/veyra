import { describe, expect, it } from 'vitest';
import {
  ConflictError,
  ValidationError,
  computeWeekdayRoom,
  createBlock,
  getFocusStatus,
  logManualSession,
  openVeyraDb,
  startFocus,
  updateActiveFocusStartTime,
  updateSettings,
} from '../src/index.js';

describe('live focus start-time adjustment & today workday end override', () => {
  it('backdates an active focus session, blocks overlaps and future timestamps, and reports lastClosedSessionEndedAt', () => {
    const db = openVeyraDb(':memory:');
    try {
      updateSettings(db, { timezone: 'UTC' }, { now: '2026-11-26T08:00:00.000Z' });
      const b1 = createBlock(db, { title: 'Morning block', bucket: 'scheduled', scheduledDate: '2026-11-26' });
      const b2 = createBlock(db, { title: 'Covestro Ticket', bucket: 'scheduled', scheduledDate: '2026-11-26' });

      logManualSession(db, {
        blockId: b1.id,
        startedAt: '2026-11-26T10:00:00.000Z',
        endedAt: '2026-11-26T11:00:00.000Z',
      });

      startFocus(db, b2.id, '2026-11-26T11:30:00.000Z');
      const statusBefore = getFocusStatus(db, '2026-11-26T11:35:00.000Z');
      expect(statusBefore.lastClosedSessionEndedAt).toBe('2026-11-26T11:00:00.000Z');
      expect(statusBefore.elapsedSeconds).toBe(300);

      // Reject future start time
      expect(() =>
        updateActiveFocusStartTime(db, '2026-11-26T11:40:00.000Z', '2026-11-26T11:35:00.000Z'),
      ).toThrow(ValidationError);

      // Reject overlap with earlier session ending at 11:00
      expect(() =>
        updateActiveFocusStartTime(db, '2026-11-26T10:45:00.000Z', '2026-11-26T11:35:00.000Z'),
      ).toThrow(ConflictError);

      // Allow backdating right to 11:00 (after last session)
      const adjusted = updateActiveFocusStartTime(
        db,
        '2026-11-26T11:00:00.000Z',
        '2026-11-26T11:35:00.000Z',
      );
      expect(adjusted.session.startedAt).toBe('2026-11-26T11:00:00.000Z');

      const statusAfter = getFocusStatus(db, '2026-11-26T11:35:00.000Z');
      expect(statusAfter.elapsedSeconds).toBe(35 * 60);
    } finally {
      db.close();
    }
  });

  it('uses today-only workday end override to compute room directly from remaining free time even after budget is spent', () => {
    const db = openVeyraDb(':memory:');
    try {
      updateSettings(db, { timezone: 'UTC', workdayStart: '09:00', workdayEnd: '18:00' });
      const b = createBlock(db, { title: 'Long deep work', bucket: 'scheduled', scheduledDate: '2026-11-26' });
      // Already focused 5h today (exceeds default 4h baseline)
      logManualSession(db, {
        blockId: b.id,
        startedAt: '2026-11-26T09:00:00.000Z',
        endedAt: '2026-11-26T14:00:00.000Z',
      });

      const now = '2026-11-26T18:30:00.000Z';
      const defaultRoom = computeWeekdayRoom(db, '2026-11-26', now);
      expect(defaultRoom.roomMinutes).toBe(0);
      expect(defaultRoom.hasTodayWorkdayEndOverride).toBe(false);

      // Set today's end time to 20:30 -> 2h free left, not clamped to 0 by the 4h baseline
      updateSettings(db, {
        workdayEndOverrideDate: '2026-11-26',
        workdayEndOverrideTime: '20:30',
      });
      const overriddenRoom = computeWeekdayRoom(db, '2026-11-26', now);
      expect(overriddenRoom.hasTodayWorkdayEndOverride).toBe(true);
      expect(overriddenRoom.workdayEnd).toBe('20:30');
      expect(overriddenRoom.freeTimeLeftMinutes).toBe(120);
      expect(overriddenRoom.roomMinutes).toBe(120);

      // Tomorrow is unaffected by today's override
      const tomorrowRoom = computeWeekdayRoom(db, '2026-11-27', now);
      expect(tomorrowRoom.hasTodayWorkdayEndOverride).toBe(false);
      expect(tomorrowRoom.workdayEnd).toBe('18:00');
    } finally {
      db.close();
    }
  });
});
