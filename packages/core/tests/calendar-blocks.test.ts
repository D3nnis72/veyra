import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type NormalizedCalendarEvent,
  SYSTEM_OTHER_PROJECT_ID,
  type VeyraDb,
  completeBlock,
  createGoal,
  createProject,
  getBlock,
  getBlockDetail,
  getCalendarEvent,
  getProject,
  getWeeklyReview,
  listBlocks,
  listCalendarEvents,
  openVeyraDb,
  runDailyRolloverAndRecurrence,
  startFocus,
  updateSettings,
  upsertCalendarEvents,
} from '../src/index.js';

const NOW = '2026-11-26T09:00:00.000Z';

function makeEvent(overrides: Partial<NormalizedCalendarEvent> = {}): NormalizedCalendarEvent {
  return {
    externalId: 'ext-1',
    title: 'Covestro order confirmation call',
    startAt: '2026-11-26T10:00:00.000Z',
    endAt: '2026-11-26T10:45:00.000Z',
    isAllDay: false,
    isDeclined: false,
    isCancelled: false,
    responseStatus: 'accepted',
    meetingUrl: 'https://teams.microsoft.com/l/meetup-join/covestro',
    ...overrides,
  };
}

describe('calendar-synced blocks & accepted-only filtering', () => {
  let veyraDb: VeyraDb;

  beforeEach(() => {
    veyraDb = openVeyraDb(':memory:');
    updateSettings(veyraDb, { timezone: 'UTC' }, { now: NOW });
  });

  afterEach(() => {
    veyraDb.close();
  });

  it('keeps accepted and organizer events and skips tentative, not_responded, declined, and cancelled', () => {
    const result = upsertCalendarEvents(
      veyraDb,
      'outlook_cli',
      [
        makeEvent({ externalId: 'acc', title: 'Accepted Call', responseStatus: 'accepted' }),
        makeEvent({ externalId: 'org', title: 'My Own Call', responseStatus: 'organizer' }),
        makeEvent({ externalId: 'tent', title: 'Tentative Call', responseStatus: 'tentatively_accepted' }),
        makeEvent({ externalId: 'nr', title: 'Unanswered Invite', responseStatus: 'not_responded' }),
        makeEvent({ externalId: 'dec', title: 'Declined Call', responseStatus: 'declined', isDeclined: true }),
        makeEvent({ externalId: 'can', title: 'Cancelled Accepted', responseStatus: 'accepted', isCancelled: true }),
      ],
      { now: NOW },
    );

    expect(result.createdCount).toBe(2);
    expect(result.skippedCount).toBe(4);
    expect(result.upserted.map((e) => e.externalId)).toEqual(['acc', 'org']);

    const events = listCalendarEvents(veyraDb, '2026-11-26T00:00:00.000Z', '2026-11-27T00:00:00.000Z');
    expect(events.map((e) => e.externalId)).toEqual(['acc', 'org']);
  });

  it('soft-deletes a previously synced unaccepted meeting when untouched, but preserves one with tracked focus time', () => {
    const first = upsertCalendarEvents(
      veyraDb,
      'outlook_cli',
      [
        makeEvent({ externalId: 'untouched', title: 'Untouched Call' }),
        makeEvent({ externalId: 'focused', title: 'Focused Call' }),
      ],
      { now: NOW },
    );

    const focusedId = first.upserted.find((e) => e.externalId === 'focused')!.id;
    startFocus(veyraDb, focusedId, '2026-11-26T10:00:00.000Z');
    completeBlock(veyraDb, focusedId, { outcomeNote: 'Confirmed order' }, '2026-11-26T10:30:00.000Z');

    const second = upsertCalendarEvents(
      veyraDb,
      'outlook_cli',
      [
        makeEvent({ externalId: 'untouched', title: 'Untouched Call', responseStatus: 'not_responded' }),
        makeEvent({ externalId: 'focused', title: 'Focused Call', responseStatus: 'declined', isDeclined: true }),
      ],
      { now: '2026-11-26T11:00:00.000Z' },
    );

    expect(second.deletedCount).toBe(1);
    expect(second.skippedCount).toBe(2);

    const remaining = listCalendarEvents(veyraDb, '2026-11-26T00:00:00.000Z', '2026-11-27T00:00:00.000Z');
    expect(remaining.map((e) => e.externalId)).toEqual(['focused']);
    expect(getBlockDetail(veyraDb, focusedId).totalFocusMinutes).toBe(30);
  });

  it('stores synced events as first-class blocks that can be focused, count into project/review time, stay out of default listBlocks, and never roll over', () => {
    const goal = createGoal(veyraDb, { name: 'Customer Delivery' }, { now: NOW });
    const covestro = createProject(
      veyraDb,
      { name: 'Covestro', defaultGoalId: goal.id, matchKeywords: ['Covestro'] },
      { now: NOW },
    );

    const synced = upsertCalendarEvents(
      veyraDb,
      'outlook_cli',
      [makeEvent({ externalId: 'cov-1', title: 'Covestro order confirmation call' })],
      { now: NOW },
    );
    const blockId = synced.upserted[0].id;

    // Directly readable as a Block
    const blk = getBlock(veyraDb, blockId);
    expect(blk.calendarSource).toBe('outlook_cli');
    expect(blk.externalEventId).toBe('cov-1');
    expect(blk.meetingUrl).toBe('https://teams.microsoft.com/l/meetup-join/covestro');
    expect(blk.projectId).toBe(covestro.id);
    expect(blk.goalId).toBe(goal.id);
    expect(blk.scheduledDate).toBe('2026-11-26');

    // Excluded from default listBlocks (Up Next / Plan / open project tasks), included with includeCalendar
    expect(listBlocks(veyraDb, { scheduledDate: '2026-11-26', status: 'todo' })).toHaveLength(0);
    expect(listBlocks(veyraDb, { scheduledDate: '2026-11-26', status: 'todo', includeCalendar: true })).toHaveLength(1);
    expect(getProject(veyraDb, covestro.id, NOW).openBlockCount).toBe(0);

    // Midnight rollover must not roll over untouched calendar blocks
    const rollover = runDailyRolloverAndRecurrence(veyraDb, '2026-11-27T08:00:00.000Z');
    expect(rollover.rolledOverBlockIds).toEqual([]);
    expect(getBlock(veyraDb, blockId).scheduledDate).toBe('2026-11-26');
    expect(getBlock(veyraDb, blockId).carryoverCount).toBe(0);

    // Focus and complete directly on the calendar block
    startFocus(veyraDb, blockId, '2026-11-26T10:00:00.000Z');
    completeBlock(
      veyraDb,
      blockId,
      { energySignal: 'up', senseSignal: 'moved', outcomeNote: 'Order flow signed off' },
      '2026-11-26T10:45:00.000Z',
    );

    // Tracked time counts into Project weekly hours and Weekly Review without duplicating progressFeed
    const updatedProject = getProject(veyraDb, covestro.id, '2026-11-26T11:00:00.000Z');
    expect(updatedProject.weeklyFocusMinutes).toBe(45);

    const review = getWeeklyReview(veyraDb, '2026-11-23', '2026-11-26T11:00:00.000Z');
    expect(review.totalFocusMinutes).toBe(45);
    expect(review.goalAlignmentPct).toBe(100);
    const matchingFeedItems = review.progressFeed.filter((item) => item.id === blockId);
    expect(matchingFeedItems).toHaveLength(1);
    expect(matchingFeedItems[0].kind).toBe('block');
  });

  it('migrates legacy calendar_events rows into blocks idempotently on openVeyraDb', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veyra-cal-migrate-'));
    const dbPath = path.join(tmpDir, 'veyra.db');
    const legacyEventId = '22222222-2222-4222-8222-222222222222';
    const legacyProjectId = '33333333-3333-4333-8333-333333333333';

    try {
      // Seed an older DB shape with calendar_events populated and blocks without calendar_* columns
      const firstDb = openVeyraDb(dbPath);
      firstDb.sqlite
        .prepare(
          `INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
        )
        .run(legacyProjectId, 'Accenture', NOW, NOW);
      firstDb.sqlite
        .prepare(
          `INSERT INTO calendar_events (
            id, external_id, title, start_at, end_at, meeting_url, source,
            project_id, goal_id, is_ops, notes, external_links, updated_at, deleted_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, ?, '[]', ?, NULL)`,
        )
        .run(
          legacyEventId,
          'legacy-ext-1',
          'UX Accenture',
          '2026-11-26T14:00:00.000Z',
          '2026-11-26T15:00:00.000Z',
          'https://teams.microsoft.com/l/meetup-join/acc',
          'outlook_cli',
          legacyProjectId,
          'Agenda prep note',
          NOW,
        );
      firstDb.close();

      // Re-opening migrates the legacy calendar_events row into blocks
      const migrated = openVeyraDb(dbPath);
      try {
        const blk = getBlock(migrated, legacyEventId);
        expect(blk.title).toBe('UX Accenture');
        expect(blk.projectId).toBe(legacyProjectId);
        expect(blk.isOps).toBe(true);
        expect(blk.notes).toBe('Agenda prep note');
        expect(blk.calendarSource).toBe('outlook_cli');
        expect(blk.externalEventId).toBe('legacy-ext-1');
        expect(blk.meetingUrl).toBe('https://teams.microsoft.com/l/meetup-join/acc');
        expect(blk.plannedStartAt).toBe('2026-11-26T14:00:00.000Z');
        expect(blk.plannedEndAt).toBe('2026-11-26T15:00:00.000Z');

        const ev = getCalendarEvent(migrated, legacyEventId);
        expect(ev.id).toBe(legacyEventId);
        expect(ev.projectId).toBe(legacyProjectId);
      } finally {
        migrated.close();
      }

      // Opening a third time is idempotent and does not duplicate
      const reopened = openVeyraDb(dbPath);
      try {
        const count = reopened.sqlite
          .prepare('SELECT COUNT(*) as c FROM blocks WHERE external_event_id = ?')
          .get('legacy-ext-1') as { c: number };
        expect(count.c).toBe(1);
      } finally {
        reopened.close();
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('defaults unassigned calendar block projectId to Other in blocks and null in CalendarEvent projection', () => {
    const res = upsertCalendarEvents(
      veyraDb,
      'outlook_cli',
      [makeEvent({ externalId: 'misc-1', title: 'Random Coffee Chat' })],
      { now: NOW },
    );
    const id = res.upserted[0].id;
    expect(res.upserted[0].projectId).toBeNull();
    expect(getBlock(veyraDb, id).projectId).toBe(SYSTEM_OTHER_PROJECT_ID);
  });
});
