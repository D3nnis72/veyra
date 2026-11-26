import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  SYSTEM_OTHER_PROJECT_ID,
  type VeyraDb,
  blockSizeMinutesSchema,
  openVeyraDb,
  parseBlockSizeInput,
  parseDurationMinutes,
} from '../src/index.js';
import { focusSessions } from '../src/schema.js';
import { SystemProjectError, ValidationError } from '../src/errors.js';
import {
  archiveProject,
  createGoal,
  createProject,
  deleteGoal,
  deleteProject,
  listActivity,
  listGoals,
  listProjects,
  recordActivity,
  updateGoal,
  updateProject,
} from '../src/services/goals-projects.js';
import {
  createBlock,
  dropBlock,
  getBlockDetail,
  listBlocks,
  moveBlock,
  parkBlock,
  reopenBlock,
  reorderBlock,
  updateBlock,
} from '../src/services/blocks.js';
import { runDailyRolloverAndRecurrence } from '../src/services/rollover.js';

describe('Task 3: Goals, Projects, Blocks, Rollover, Recurrence & Later Revisit', () => {
  let veyraDb: VeyraDb;

  beforeEach(() => {
    veyraDb = openVeyraDb(':memory:');
    // Pin timezone to Europe/Berlin for deterministic local-day assertions
    veyraDb.sqlite
      .prepare("UPDATE settings SET timezone = 'Europe/Berlin' WHERE id = 'default'")
      .run();
  });

  afterEach(() => {
    veyraDb.close();
  });

  it('rejects deleting the system Other project with SystemProjectError', () => {
    expect(() => deleteProject(veyraDb, SYSTEM_OTHER_PROJECT_ID)).toThrow(SystemProjectError);
    expect(() => archiveProject(veyraDb, SYSTEM_OTHER_PROJECT_ID)).toThrow(SystemProjectError);
  });

  it('allows creating and pinning 6 projects with custom icons and defaultGoalId with no cap', () => {
    const goal = createGoal(veyraDb, { name: 'Ship Veyra v1', color: '#3B4BD8' });
    const icons = ['Rocket', 'Layers', 'Cpu', 'Briefcase', 'Globe', 'Shield'] as const;

    const created = icons.map((icon, idx) =>
      createProject(veyraDb, {
        name: `Pinned Project ${idx + 1}`,
        icon,
        defaultGoalId: goal.id,
        isPinned: true,
      }),
    );

    expect(created).toHaveLength(6);
    expect(created.every((p) => p.isPinned && p.defaultGoalId === goal.id)).toBe(true);

    const listed = listProjects(veyraDb);
    const pinnedProjects = listed.filter((p) => p.isPinned);
    expect(pinnedProjects).toHaveLength(6);
  });

  it('computes isQuiet accurately based on 7-day inactivity threshold for active projects', () => {
    const now = new Date('2026-11-23T12:00:00.000Z');
    const eightDaysAgo = new Date('2026-11-15T11:00:00.000Z');
    const twoDaysAgoStart = '2026-11-21T09:00:00.000Z';
    const twoDaysAgoEnd = '2026-11-21T10:00:00.000Z';

    const quietProject = createProject(
      veyraDb,
      { name: 'Quiet Initiative' },
      { now: eightDaysAgo },
    );

    const activeProject = createProject(
      veyraDb,
      { name: 'Active Initiative' },
      { now: eightDaysAgo },
    );

    const pausedProject = createProject(
      veyraDb,
      { name: 'Paused Initiative', status: 'paused' },
      { now: eightDaysAgo },
    );

    const block = createBlock(
      veyraDb,
      { title: 'Recent work', projectId: activeProject.id, bucket: 'scheduled', scheduledDate: '2026-11-23' },
      { now: eightDaysAgo },
    );

    // Insert a focus session from 2 days ago for activeProject
    veyraDb.db
      .insert(focusSessions)
      .values({
        id: '11111111-1111-4111-8111-111111111111',
        blockId: block.id,
        startedAt: twoDaysAgoStart,
        endedAt: twoDaysAgoEnd,
        note: null,
        updatedAt: twoDaysAgoEnd,
        deletedAt: null,
      })
      .run();

    const projectsList = listProjects(veyraDb, now);
    const quietStats = projectsList.find((p) => p.id === quietProject.id);
    const activeStats = projectsList.find((p) => p.id === activeProject.id);
    const pausedStats = projectsList.find((p) => p.id === pausedProject.id);

    expect(quietStats?.isQuiet).toBe(true);
    expect(activeStats?.isQuiet).toBe(false);
    expect(activeStats?.lastTouchedAt).toBe(twoDaysAgoEnd);
    expect(activeStats?.openBlockCount).toBe(1);
    expect(activeStats?.nextBlockTitle).toBe('Recent work');
    expect(pausedStats?.isQuiet).toBe(false);
  });

  it('parks a block into Later and defaults revisitAt to today + 14 days when omitted', () => {
    const now = new Date('2026-11-23T10:00:00.000Z');
    const block = createBlock(veyraDb, { title: 'Someday refactor' }, { now });
    expect(block.projectId).toBe(SYSTEM_OTHER_PROJECT_ID);
    expect(block.bucket).toBe('inbox');

    const parked = parkBlock(veyraDb, block.id, undefined, { now });
    expect(parked.bucket).toBe('later');
    expect(parked.revisitAt).toBe('2026-12-07');
    expect(parked.scheduledDate).toBeNull();

    // Creating directly in Later without revisitAt also defaults to 2w
    const directLater = createBlock(
      veyraDb,
      { title: 'Direct later idea', bucket: 'later' },
      { now },
    );
    expect(directLater.revisitAt).toBe('2026-12-07');
  });

  it('rejects a dueDate containing a clock time with ValidationError', () => {
    expect(() =>
      createBlock(veyraDb, {
        title: 'Bad due date',
        dueDate: '2026-11-24T10:30',
      }),
    ).toThrow(ValidationError);

    const valid = createBlock(veyraDb, {
      title: 'Valid due date',
      dueDate: '2026-11-24',
    });
    expect(valid.dueDate).toBe('2026-11-24');
  });

  it('rolls unfinished non-recurring scheduled blocks to today idempotently', () => {
    const monday = new Date('2026-11-23T09:00:00.000Z');
    const tuesday = new Date('2026-11-24T09:00:00.000Z');

    const block = createBlock(
      veyraDb,
      {
        title: 'Write design doc',
        bucket: 'scheduled',
        scheduledDate: '2026-11-23',
      },
      { now: monday },
    );
    expect(block.carryoverCount).toBe(0);

    const firstRoll = runDailyRolloverAndRecurrence(veyraDb, tuesday);
    expect(firstRoll.rolledOverBlockIds).toEqual([block.id]);

    const afterFirst = getBlockDetail(veyraDb, block.id);
    expect(afterFirst.scheduledDate).toBe('2026-11-24');
    expect(afterFirst.carryoverCount).toBe(1);

    // Calling a second time on Tuesday is a no-op
    const secondRoll = runDailyRolloverAndRecurrence(veyraDb, new Date('2026-11-24T16:00:00.000Z'));
    expect(secondRoll.rolledOverBlockIds).toEqual([]);

    const afterSecond = getBlockDetail(veyraDb, block.id);
    expect(afterSecond.scheduledDate).toBe('2026-11-24');
    expect(afterSecond.carryoverCount).toBe(1);
  });

  it('soft-deletes untouched recurring occurrences, materializes weekdays, skips weekends, and stops series on drop', () => {
    const monday = new Date('2026-11-23T08:00:00.000Z'); // Mon
    const tuesday = new Date('2026-11-24T08:00:00.000Z'); // Tue
    const saturday = new Date('2026-11-28T08:00:00.000Z'); // Sat
    const sunday = new Date('2026-11-29T08:00:00.000Z'); // Sun
    const nextMonday = new Date('2026-11-30T08:00:00.000Z'); // Mon
    const nextTuesday = new Date('2026-12-01T08:00:00.000Z'); // Tue

    const monBlock = createBlock(
      veyraDb,
      {
        title: 'Inbox triage',
        isOps: true,
        bucket: 'scheduled',
        scheduledDate: '2026-11-23',
        recurrenceRule: 'weekdays',
      },
      { now: monday },
    );
    expect(monBlock.seriesId).toBeTruthy();

    // Roll over to Tuesday: Monday untouched -> soft-deleted, Tuesday materialized
    const tueResult = runDailyRolloverAndRecurrence(veyraDb, tuesday);
    expect(tueResult.softDeletedRecurringIds).toEqual([monBlock.id]);
    expect(tueResult.materializedBlockIds).toHaveLength(1);

    const tueBlocks = listBlocks(veyraDb, { scheduledDate: '2026-11-24' });
    expect(tueBlocks).toHaveLength(1);
    expect(tueBlocks[0].title).toBe('Inbox triage');
    expect(tueBlocks[0].seriesId).toBe(monBlock.seriesId);
    expect(tueBlocks[0].carryoverCount).toBe(0);

    // Repeating on Tuesday is idempotent
    const tueRepeat = runDailyRolloverAndRecurrence(veyraDb, new Date('2026-11-24T17:00:00.000Z'));
    expect(tueRepeat.materializedBlockIds).toEqual([]);

    // Saturday & Sunday: untouched Tuesday soft-deleted, no weekend occurrence materialized
    const satResult = runDailyRolloverAndRecurrence(veyraDb, saturday);
    expect(satResult.softDeletedRecurringIds).toEqual([tueBlocks[0].id]);
    expect(satResult.materializedBlockIds).toEqual([]);
    expect(listBlocks(veyraDb, { scheduledDate: '2026-11-28' })).toHaveLength(0);

    const sunResult = runDailyRolloverAndRecurrence(veyraDb, sunday);
    expect(sunResult.materializedBlockIds).toEqual([]);
    expect(listBlocks(veyraDb, { scheduledDate: '2026-11-29' })).toHaveLength(0);

    // Next Monday: materializes again from series template
    const nextMonResult = runDailyRolloverAndRecurrence(veyraDb, nextMonday);
    expect(nextMonResult.materializedBlockIds).toHaveLength(1);
    const nextMonBlockId = nextMonResult.materializedBlockIds[0];

    // Drop with stopSeries: true -> clears recurrenceRule across the series
    const dropped = dropBlock(veyraDb, nextMonBlockId, { stopSeries: true, now: nextMonday });
    expect(dropped.status).toBe('dropped');
    expect(dropped.recurrenceRule).toBeNull();

    // Next Tuesday: no new occurrence materialized
    const nextTueResult = runDailyRolloverAndRecurrence(veyraDb, nextTuesday);
    expect(nextTueResult.materializedBlockIds).toEqual([]);
  });

  it('moves a block with optional plannedStartAt and plannedEndAt for a future Calendar Planned slot', () => {
    const now = new Date('2026-11-23T09:00:00.000Z');
    const block = createBlock(veyraDb, { title: 'Deep architecture work' }, { now });

    const moved = moveBlock(
      veyraDb,
      block.id,
      {
        bucket: 'scheduled',
        scheduledDate: '2026-11-25',
        plannedStartAt: '2026-11-25T13:00:00.000Z',
        plannedEndAt: '2026-11-25T15:00:00.000Z',
      },
      { now },
    );

    expect(moved.bucket).toBe('scheduled');
    expect(moved.scheduledDate).toBe('2026-11-25');
    expect(moved.plannedStartAt).toBe('2026-11-25T13:00:00.000Z');
    expect(moved.plannedEndAt).toBe('2026-11-25T15:00:00.000Z');

    // Invalid planned slot (end <= start) rejected
    expect(() =>
      moveBlock(veyraDb, block.id, {
        plannedStartAt: '2026-11-25T15:00:00.000Z',
        plannedEndAt: '2026-11-25T14:00:00.000Z',
      }),
    ).toThrow(ValidationError);
  });

  it('supports goal CRUD, project update/delete, block reorder/reopen, and activity logging', () => {
    const goal = createGoal(veyraDb, { name: 'Grow revenue' }, { actor: 'cli' });
    const updatedGoal = updateGoal(veyraDb, goal.id, { status: 'achieved' }, { actor: 'agent' });
    expect(updatedGoal.status).toBe('achieved');
    expect(listGoals(veyraDb)).toHaveLength(1);

    const project = createProject(veyraDb, { name: 'Temp Project', defaultGoalId: goal.id });
    const updatedProj = updateProject(veyraDb, project.id, { name: 'Renamed Project' });
    expect(updatedProj.name).toBe('Renamed Project');

    const b1 = createBlock(veyraDb, { title: 'First', projectId: project.id });
    const b2 = createBlock(veyraDb, { title: 'Second', projectId: project.id });
    const b3 = createBlock(veyraDb, { title: 'Third', projectId: project.id });

    // Reorder b3 between b1 and b2
    const reordered = reorderBlock(veyraDb, b3.id, {
      beforeOrderKey: b1.orderKey,
      afterOrderKey: b2.orderKey,
    });
    expect(b1.orderKey < reordered.orderKey && reordered.orderKey < b2.orderKey).toBe(true);

    const dropped = dropBlock(veyraDb, b2.id);
    expect(dropped.status).toBe('dropped');
    const reopened = reopenBlock(veyraDb, b2.id);
    expect(reopened.status).toBe('todo');

    const edited = updateBlock(veyraDb, b1.id, { notes: 'Updated notes' });
    expect(edited.notes).toBe('Updated notes');

    // Delete non-system project succeeds and reassigns blocks to Other
    deleteProject(veyraDb, project.id);
    expect(getBlockDetail(veyraDb, b1.id).projectId).toBe(SYSTEM_OTHER_PROJECT_ID);

    deleteGoal(veyraDb, goal.id);
    expect(listGoals(veyraDb)).toHaveLength(0);

    recordActivity(veyraDb, 'hook', 'custom.ping', 'Webhook check');
    const logs = listActivity(veyraDb, { limit: 10 });
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0].actor).toBe('hook');
    expect(logs[0].action).toBe('custom.ping');
  });

  it('enforces bucket/date/slot/revisitAt invariants in updateBlock and normalizes planned timestamps to UTC ISO', () => {
    const now = new Date('2026-11-23T09:00:00.000Z');

    // Non-UTC offset timestamps normalized to canonical UTC ISO on create
    const created = createBlock(
      veyraDb,
      {
        title: 'Slot normalization',
        bucket: 'scheduled',
        scheduledDate: '2026-11-25',
        plannedStartAt: '2026-11-25T14:00:00+01:00',
        plannedEndAt: '2026-11-25T15:30:00+01:00',
      },
      { now },
    );
    expect(created.plannedStartAt).toBe('2026-11-25T13:00:00.000Z');
    expect(created.plannedEndAt).toBe('2026-11-25T14:30:00.000Z');

    // updateBlock -> inbox clears scheduledDate, plannedStartAt, plannedEndAt, revisitAt
    const toInbox = updateBlock(veyraDb, created.id, { bucket: 'inbox' }, { now });
    expect(toInbox.bucket).toBe('inbox');
    expect(toInbox.scheduledDate).toBeNull();
    expect(toInbox.plannedStartAt).toBeNull();
    expect(toInbox.plannedEndAt).toBeNull();
    expect(toInbox.revisitAt).toBeNull();

    // updateBlock -> scheduled defaults scheduledDate to today and clears revisitAt
    const toScheduled = updateBlock(
      veyraDb,
      created.id,
      {
        bucket: 'scheduled',
        plannedStartAt: '2026-11-23T11:00:00+01:00',
        plannedEndAt: '2026-11-23T12:00:00+01:00',
      },
      { now },
    );
    expect(toScheduled.bucket).toBe('scheduled');
    expect(toScheduled.scheduledDate).toBe('2026-11-23');
    expect(toScheduled.plannedStartAt).toBe('2026-11-23T10:00:00.000Z');
    expect(toScheduled.plannedEndAt).toBe('2026-11-23T11:00:00.000Z');
    expect(toScheduled.revisitAt).toBeNull();

    // updateBlock -> later clears scheduledDate, plannedStartAt, plannedEndAt and defaults revisitAt to 2w
    const toLater = updateBlock(veyraDb, created.id, { bucket: 'later' }, { now });
    expect(toLater.bucket).toBe('later');
    expect(toLater.scheduledDate).toBeNull();
    expect(toLater.plannedStartAt).toBeNull();
    expect(toLater.plannedEndAt).toBeNull();
    expect(toLater.revisitAt).toBe('2026-12-07');

    // updateBlock from later -> scheduled clears revisitAt and defaults scheduledDate to today
    const backToScheduled = updateBlock(veyraDb, created.id, { bucket: 'scheduled' }, { now });
    expect(backToScheduled.bucket).toBe('scheduled');
    expect(backToScheduled.scheduledDate).toBe('2026-11-23');
    expect(backToScheduled.revisitAt).toBeNull();
  });

  it('does not soft-delete non-scheduled recurring blocks during rollover Step 2', () => {
    const monday = new Date('2026-11-23T08:00:00.000Z');
    const tuesday = new Date('2026-11-24T08:00:00.000Z');

    const recurring = createBlock(
      veyraDb,
      {
        title: 'Parked recurring idea',
        bucket: 'scheduled',
        scheduledDate: '2026-11-23',
        recurrenceRule: 'weekdays',
      },
      { now: monday },
    );

    // Simulate a legacy row in bucket='later' that still has a past scheduled_date
    veyraDb.sqlite
      .prepare("UPDATE blocks SET bucket = 'later', revisit_at = '2026-12-07' WHERE id = ?")
      .run(recurring.id);

    const roll = runDailyRolloverAndRecurrence(veyraDb, tuesday);
    expect(roll.softDeletedRecurringIds).not.toContain(recurring.id);

    const stillActive = getBlockDetail(veyraDb, recurring.id);
    expect(stillActive.deletedAt).toBeNull();
    expect(stillActive.bucket).toBe('later');
  });

  it('createProject and updateProject persist and clear weeklyTimeMinutes', () => {
    const created = createProject(veyraDb, {
      name: 'Veyra Platform',
      weeklyTimeMinutes: 240,
    });
    expect(created.weeklyTimeMinutes).toBe(240);

    const updated = updateProject(veyraDb, created.id, { weeklyTimeMinutes: 360 });
    expect(updated.weeklyTimeMinutes).toBe(360);

    const cleared = updateProject(veyraDb, created.id, { weeklyTimeMinutes: null });
    expect(cleared.weeklyTimeMinutes).toBeNull();

    // Validation bounds: < 15 or > 4800 rejected
    expect(() =>
      createProject(veyraDb, { name: 'Too Small', weeklyTimeMinutes: 10 }),
    ).toThrow(ValidationError);
    expect(() =>
      createProject(veyraDb, { name: 'Too Large', weeklyTimeMinutes: 5000 }),
    ).toThrow(ValidationError);
  });

  it('dropBlock stores optional dropReason and reopenBlock clears dropReason, and blocks persist sizeMinutes', () => {
    const block = createBlock(veyraDb, {
      title: 'Sized task',
      sizeMinutes: 60,
    });
    expect(block.sizeMinutes).toBe(60);
    expect(block.senseSignal).toBeNull();
    expect(block.dropReason).toBeNull();

    const resized = updateBlock(veyraDb, block.id, { sizeMinutes: 120 });
    expect(resized.sizeMinutes).toBe(120);

    const dropped = dropBlock(veyraDb, block.id, { dropReason: 'no_room' });
    expect(dropped.status).toBe('dropped');
    expect(dropped.dropReason).toBe('no_room');
    expect(getBlockDetail(veyraDb, block.id).dropReason).toBe('no_room');

    const reopened = reopenBlock(veyraDb, block.id);
    expect(reopened.status).toBe('todo');
    expect(reopened.dropReason).toBeNull();
    expect(getBlockDetail(veyraDb, block.id).dropReason).toBeNull();

    const custom = createBlock(veyraDb, { title: 'Custom size', sizeMinutes: 45 });
    expect(custom.sizeMinutes).toBe(45);
    expect(updateBlock(veyraDb, custom.id, { sizeMinutes: 90 }).sizeMinutes).toBe(90);

    expect(() => createBlock(veyraDb, { title: 'Invalid size', sizeMinutes: 7 })).toThrow(
      ValidationError,
    );
    expect(() => createBlock(veyraDb, { title: 'Too big', sizeMinutes: 900 })).toThrow(
      ValidationError,
    );
  });
});

describe('block size schema and parser', () => {
  it('accepts integer minutes 5–600 in steps of 5', () => {
    expect(blockSizeMinutesSchema.safeParse(45).success).toBe(true);
    expect(blockSizeMinutesSchema.safeParse(5).success).toBe(true);
    expect(blockSizeMinutesSchema.safeParse(600).success).toBe(true);
    expect(blockSizeMinutesSchema.safeParse(7).success).toBe(false);
    expect(blockSizeMinutesSchema.safeParse(0).success).toBe(false);
    expect(blockSizeMinutesSchema.safeParse(900).success).toBe(false);
    expect(blockSizeMinutesSchema.safeParse(45.5).success).toBe(false);
  });

  it('parses human durations', () => {
    expect(parseDurationMinutes('45')).toBe(45);
    expect(parseDurationMinutes('90m')).toBe(90);
    expect(parseDurationMinutes('90 min')).toBe(90);
    expect(parseDurationMinutes('1h')).toBe(60);
    expect(parseDurationMinutes('1.5h')).toBe(90);
    expect(parseDurationMinutes('1,5h')).toBe(90);
    expect(parseDurationMinutes('1h30m')).toBe(90);
    expect(parseDurationMinutes('1h 30m')).toBe(90);
    expect(parseDurationMinutes('1h30')).toBe(90);
    expect(parseDurationMinutes('1:30')).toBe(90);
    expect(parseDurationMinutes('')).toBeNull();
    expect(parseDurationMinutes('abc')).toBeNull();
    expect(parseDurationMinutes('h')).toBeNull();
  });

  it('rounds block size input to 5 minutes and clamps to 5–600', () => {
    expect(parseBlockSizeInput('47')).toBe(45);
    expect(parseBlockSizeInput('48m')).toBe(50);
    expect(parseBlockSizeInput('3h')).toBe(180);
    expect(parseBlockSizeInput('2')).toBe(5);
    expect(parseBlockSizeInput('12h')).toBe(600);
    expect(parseBlockSizeInput('0')).toBeNull();
    expect(parseBlockSizeInput('soon')).toBeNull();
  });
});
