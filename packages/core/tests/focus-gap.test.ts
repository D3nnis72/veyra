import { describe, expect, it } from 'vitest';
import {
  NotFoundError,
  ValidationError,
  createBlock,
  getFocusStatus,
  listSessions,
  openVeyraDb,
  pauseFocus,
  removeActiveFocusGap,
  startFocus,
} from '../src/index.js';

describe('removeActiveFocusGap (a pause you forgot to log)', () => {
  const setup = () => {
    const db = openVeyraDb(':memory:');
    const block = createBlock(db, { title: 'Sourcing prep', bucket: 'scheduled', scheduledDate: '2026-11-27' });
    startFocus(db, block.id, '2026-11-27T09:00:00.000Z');
    return { db, block };
  };

  it('closes the running session at the gap start and continues from the gap end', () => {
    const { db, block } = setup();
    try {
      const now = '2026-11-27T10:30:00.000Z';
      const result = removeActiveFocusGap(
        db,
        { gapStartAt: '2026-11-27T09:40:00.000Z', gapEndAt: '2026-11-27T10:00:00.000Z' },
        now,
      );

      expect(result.closedSession.endedAt).toBe('2026-11-27T09:40:00.000Z');
      expect(result.startedSession.startedAt).toBe('2026-11-27T10:00:00.000Z');
      expect(result.startedSession.endedAt).toBeNull();
      expect(result.startedSession.blockId).toBe(block.id);

      const status = getFocusStatus(db, now);
      expect(status.activeSession?.id).toBe(result.startedSession.id);
      expect(status.elapsedSeconds).toBe(30 * 60);
      // 40 min before the gap + 30 min after it, the 20 min gap is not counted
      expect(status.focusedTodayMinutes).toBe(70);
      expect(listSessions(db, { blockId: block.id })).toHaveLength(2);
    } finally {
      db.sqlite.close();
    }
  });

  it('uses now as the gap end when gapEndAt is omitted', () => {
    const { db } = setup();
    try {
      const now = '2026-11-27T10:30:00.000Z';
      const result = removeActiveFocusGap(db, { gapStartAt: '2026-11-27T10:10:00.000Z' }, now);
      expect(result.startedSession.startedAt).toBe(now);
      expect(getFocusStatus(db, now).elapsedSeconds).toBe(0);
    } finally {
      db.sqlite.close();
    }
  });

  it('rejects gaps outside the running session and an empty session', () => {
    const { db } = setup();
    try {
      const now = '2026-11-27T10:30:00.000Z';
      expect(() =>
        removeActiveFocusGap(db, { gapStartAt: '2026-11-27T08:50:00.000Z' }, now),
      ).toThrow(ValidationError);
      expect(() =>
        removeActiveFocusGap(db, { gapStartAt: '2026-11-27T09:00:00.000Z' }, now),
      ).toThrow(ValidationError);
      expect(() =>
        removeActiveFocusGap(
          db,
          { gapStartAt: '2026-11-27T10:00:00.000Z', gapEndAt: '2026-11-27T09:50:00.000Z' },
          now,
        ),
      ).toThrow(ValidationError);
      expect(() =>
        removeActiveFocusGap(
          db,
          { gapStartAt: '2026-11-27T10:00:00.000Z', gapEndAt: '2026-11-27T10:45:00.000Z' },
          now,
        ),
      ).toThrow(ValidationError);
    } finally {
      db.sqlite.close();
    }
  });

  it('throws when nothing is running', () => {
    const db = openVeyraDb(':memory:');
    try {
      expect(() =>
        removeActiveFocusGap(db, { gapStartAt: '2026-11-27T10:00:00.000Z' }, '2026-11-27T10:30:00.000Z'),
      ).toThrow(NotFoundError);
    } finally {
      db.sqlite.close();
    }
  });
});

describe('pauseFocus with an earlier end time (you walked away and noticed later)', () => {
  it('ends the session at the given time instead of now and rejects times outside the session', () => {
    const db = openVeyraDb(':memory:');
    try {
      const block = createBlock(db, { title: 'Prep', bucket: 'scheduled', scheduledDate: '2026-11-27' });
      startFocus(db, block.id, '2026-11-27T09:00:00.000Z');
      const now = '2026-11-27T10:30:00.000Z';

      expect(() => pauseFocus(db, { endedAt: '2026-11-27T10:45:00.000Z' }, now)).toThrow(ValidationError);
      expect(() => pauseFocus(db, { endedAt: '2026-11-27T09:00:00.000Z' }, now)).toThrow(ValidationError);

      const result = pauseFocus(db, { endedAt: '2026-11-27T10:00:00.000Z' }, now);
      expect(result.closedSession.endedAt).toBe('2026-11-27T10:00:00.000Z');
      expect(getFocusStatus(db, now).activeSession).toBeNull();
      expect(getFocusStatus(db, now).focusedTodayMinutes).toBe(60);
    } finally {
      db.sqlite.close();
    }
  });
});
