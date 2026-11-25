import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type VeyraDb,
  applySuggestedOrder,
  completeBlock,
  computePlanCapacity,
  computeProjectSizeStatsMap,
  computeTodayCapacity,
  computeWeekdayRoom,
  createBlock,
  createGoal,
  createProject,
  dropBlock,
  listBlocks,
  listCalendarEvents,
  listGoals,
  listProjects,
  logManualSession,
  openVeyraDb,
  runDailyRolloverAndRecurrence,
  updateBlock,
  updateSettings,
  upsertCalendarEvents,
} from '../src/index.js';

describe('Task 7: Capacity, Room, Learned Block Sizes, Suggested Order, 8-Week Project Stats & Day Look Back', () => {
  let veyraDb: VeyraDb;

  beforeEach(() => {
    veyraDb = openVeyraDb(':memory:');
    updateSettings(veyraDb, { timezone: 'UTC' });
  });

  afterEach(() => {
    veyraDb.close();
  });

  it('computeWeekdayRoom falls back to 240m minus meetings with < 2 weeks history, then uses 4-week weekday median once >= 2 weeks exist (excluding zero days & merging overlapping meetings)', () => {
    // Today: Wednesday 2026-11-25
    const today = '2026-11-25';
    const now = '2026-11-25T08:00:00.000Z';

    // Overlapping meetings on today: 09:00-10:00 and 09:30-10:30 => union is 90m (not 120m)
    upsertCalendarEvents(veyraDb, 'manual', [
      {
        externalId: 'm1',
        title: 'Standup',
        startAt: '2026-11-25T09:00:00.000Z',
        endAt: '2026-11-25T10:00:00.000Z',
      },
      {
        externalId: 'm2',
        title: 'Overlap sync',
        startAt: '2026-11-25T09:30:00.000Z',
        endAt: '2026-11-25T10:30:00.000Z',
      },
    ]);

    // 0 weeks of history -> fallback 240m - 90m = 150m
    const room0 = computeWeekdayRoom(veyraDb, today, now);
    expect(room0).toEqual({
      roomMinutes: 150,
      baselineFocusMinutes: 240,
      meetingMinutes: 90,
      hasLearnedBaseline: false,
      weekdayLabel: 'Wednesday',
    });

    // Add 1 prior Wednesday (2026-11-18): 180m focus -> still < 2 active weeks, fallback 240m
    const blk = createBlock(veyraDb, { title: 'Deep work' }, { now: '2026-10-20T08:00:00.000Z' });
    logManualSession(veyraDb, {
      blockId: blk.id,
      startedAt: '2026-11-18T09:00:00.000Z',
      endedAt: '2026-11-18T12:00:00.000Z', // 180m
    });

    const room1 = computeWeekdayRoom(veyraDb, today, now);
    expect(room1.hasLearnedBaseline).toBe(false);
    expect(room1.baselineFocusMinutes).toBe(240);
    expect(room1.roomMinutes).toBe(150);

    // Add 2nd prior Wednesday (2026-11-11): 220m focus. Leave 2026-11-04 (0m) and 2026-10-28 (0m) inactive (PTO).
    // Active totals: [180, 220] -> median = 200m (zero days excluded!)
    logManualSession(veyraDb, {
      blockId: blk.id,
      startedAt: '2026-11-11T09:00:00.000Z',
      endedAt: '2026-11-11T12:40:00.000Z', // 220m
    });

    const room2 = computeWeekdayRoom(veyraDb, today, now);
    expect(room2.hasLearnedBaseline).toBe(true);
    expect(room2.baselineFocusMinutes).toBe(200);
    expect(room2.meetingMinutes).toBe(90);
    expect(room2.roomMinutes).toBe(110);

    // Add 3rd prior Wednesday (2026-10-28): 300m focus -> active totals [180, 220, 300] -> median = 220m
    logManualSession(veyraDb, {
      blockId: blk.id,
      startedAt: '2026-10-28T08:00:00.000Z',
      endedAt: '2026-10-28T13:00:00.000Z', // 300m
    });

    const room3 = computeWeekdayRoom(veyraDb, today, now);
    expect(room3.hasLearnedBaseline).toBe(true);
    expect(room3.baselineFocusMinutes).toBe(220);
    expect(room3.roomMinutes).toBe(130);
  });

  it('computeProjectSizeStatsMap snaps learned default size to 30/60/120 after 3 completed blocks and calculates sizeDriftPct', () => {
    const now = '2026-11-25T12:00:00.000Z';
    const projSmall = createProject(veyraDb, { name: 'Quick Wins' }, { now });
    const projLarge = createProject(veyraDb, { name: 'Deep Architecture' }, { now });
    const projFew = createProject(veyraDb, { name: 'Too Few' }, { now });

    // projSmall: 3 completed blocks (actual: 25m, 30m, 40m -> median 30m -> snaps to 30)
    // planned: 30, 60, 60 => plannedSum = 150, actualSum = 95 => drift = round((95-150)/150 * 100) = -37%
    const smallDurations = [
      { actual: 25, size: 30 as const, day: '2026-11-10' },
      { actual: 30, size: 60 as const, day: '2026-11-11' },
      { actual: 40, size: null, day: '2026-11-12' }, // default 60
    ];
    for (const [i, item] of smallDurations.entries()) {
      const b = createBlock(
        veyraDb,
        { title: `Small ${i}`, projectId: projSmall.id, sizeMinutes: item.size },
        { now: `${item.day}T08:00:00.000Z` },
      );
      logManualSession(veyraDb, {
        blockId: b.id,
        startedAt: `${item.day}T09:00:00.000Z`,
        endedAt: new Date(Date.parse(`${item.day}T09:00:00.000Z`) + item.actual * 60_000).toISOString(),
      });
      completeBlock(veyraDb, b.id, {}, `${item.day}T10:00:00.000Z`);
    }

    // projLarge: 3 completed blocks (actual: 100m, 115m, 130m -> median 115m -> snaps to 120)
    // planned: 60, 60, 60 => plannedSum = 180, actualSum = 345 => drift = round((345-180)/180 * 100) = +92%
    const largeDurations = [
      { actual: 100, day: '2026-11-13' },
      { actual: 115, day: '2026-11-14' },
      { actual: 130, day: '2026-11-15' },
    ];
    for (const [i, item] of largeDurations.entries()) {
      const b = createBlock(
        veyraDb,
        { title: `Large ${i}`, projectId: projLarge.id, sizeMinutes: 60 },
        { now: `${item.day}T08:00:00.000Z` },
      );
      logManualSession(veyraDb, {
        blockId: b.id,
        startedAt: `${item.day}T09:00:00.000Z`,
        endedAt: new Date(Date.parse(`${item.day}T09:00:00.000Z`) + item.actual * 60_000).toISOString(),
      });
      completeBlock(veyraDb, b.id, {}, `${item.day}T12:00:00.000Z`);
    }

    // projFew: only 2 completed blocks -> stays null
    for (let i = 0; i < 2; i++) {
      const day = `2026-11-1${6 + i}`;
      const b = createBlock(
        veyraDb,
        { title: `Few ${i}`, projectId: projFew.id, sizeMinutes: 60 },
        { now: `${day}T08:00:00.000Z` },
      );
      logManualSession(veyraDb, {
        blockId: b.id,
        startedAt: `${day}T09:00:00.000Z`,
        endedAt: `${day}T10:00:00.000Z`,
      });
      completeBlock(veyraDb, b.id, {}, `${day}T10:00:00.000Z`);
    }

    const statsMap = computeProjectSizeStatsMap(veyraDb, now);
    expect(statsMap.get(projSmall.id)).toEqual({
      learnedSizeMinutes: 30,
      sizeDriftPct: -37,
      sampleCount: 3,
    });
    expect(statsMap.get(projLarge.id)).toEqual({
      learnedSizeMinutes: 120,
      sizeDriftPct: 92,
      sampleCount: 3,
    });
    expect(statsMap.get(projFew.id)).toEqual({
      learnedSizeMinutes: null,
      sizeDriftPct: null,
      sampleCount: 2,
    });
  });

  it('computeTodayCapacity orders commitments first, then goal work / projects behind weekly time, then other non-Ops, then Ops last, and sinks motion hot spots', () => {
    const today = '2026-11-25';
    const now = '2026-11-25T08:00:00.000Z';

    const goalTop = createGoal(veyraDb, { name: 'Top Goal', orderKey: 'a' }, { now });
    const goalSecond = createGoal(veyraDb, { name: 'Second Goal', orderKey: 'b' }, { now });

    const projOnTrack = createProject(
      veyraDb,
      { name: 'OnTrack', defaultGoalId: goalTop.id, weeklyTimeMinutes: 120 },
      { now },
    );
    const projBehind = createProject(
      veyraDb,
      { name: 'BehindProj', defaultGoalId: goalSecond.id, weeklyTimeMinutes: 240 },
      { now },
    );
    const projMotion = createProject(
      veyraDb,
      { name: 'MotionProj', defaultGoalId: goalTop.id },
      { now },
    );
    const projPlain = createProject(veyraDb, { name: 'PlainProj' }, { now });

    // Make projOnTrack already have 120m focus this week (on_track)
    const doneOnTrack = createBlock(
      veyraDb,
      { title: 'Earlier work', projectId: projOnTrack.id },
      { now: '2026-11-23T09:00:00.000Z' },
    );
    logManualSession(veyraDb, {
      blockId: doneOnTrack.id,
      startedAt: '2026-11-23T09:00:00.000Z',
      endedAt: '2026-11-23T11:00:00.000Z',
    });

    // Make projMotion a motion hot spot: 3 recent completed blocks with senseSignal = 'motion'
    for (let i = 0; i < 3; i++) {
      const mb = createBlock(
        veyraDb,
        { title: `Busywork ${i}`, projectId: projMotion.id },
        { now: `2026-11-1${i + 1}T09:00:00.000Z` },
      );
      completeBlock(veyraDb, mb.id, { senseSignal: 'motion' }, `2026-11-1${i + 1}T10:00:00.000Z`);
    }

    // Meeting today for prep match
    upsertCalendarEvents(veyraDb, 'manual', [
      {
        externalId: 'board-sync',
        title: 'Board Sync',
        startAt: '2026-11-25T15:00:00.000Z',
        endAt: '2026-11-25T15:30:00.000Z',
      },
    ]);

    // Create today's upNext in intentionally scrambled order
    const opsBlock = createBlock(
      veyraDb,
      { title: 'Weekly invoices', projectId: projPlain.id, isOps: true, bucket: 'scheduled', scheduledDate: today },
      { now },
    );
    const motionBlock = createBlock(
      veyraDb,
      { title: 'Polish slides again', projectId: projMotion.id, bucket: 'scheduled', scheduledDate: today },
      { now },
    );
    const otherBlock = createBlock(
      veyraDb,
      { title: 'Clean docs', projectId: projPlain.id, bucket: 'scheduled', scheduledDate: today },
      { now },
    );
    // Simulate carryoverCount = 3 on otherBlock (flagged, NOT promoted)
    veyraDb.sqlite.prepare('UPDATE blocks SET carryover_count = 3 WHERE id = ?').run(otherBlock.id);

    const goalOnTrackBlock = createBlock(
      veyraDb,
      { title: 'Goal top task', projectId: projOnTrack.id, bucket: 'scheduled', scheduledDate: today },
      { now },
    );
    const goalBehindBlock = createBlock(
      veyraDb,
      { title: 'Goal behind task', projectId: projBehind.id, bucket: 'scheduled', scheduledDate: today },
      { now },
    );
    const prepBlock = createBlock(
      veyraDb,
      { title: 'Prep agenda for Board Sync', projectId: projPlain.id, bucket: 'scheduled', scheduledDate: today },
      { now },
    );
    const dueBlock = createBlock(
      veyraDb,
      { title: 'Submit contract', projectId: projPlain.id, bucket: 'scheduled', scheduledDate: today, dueDate: today },
      { now },
    );

    const upNext = listBlocks(veyraDb, { bucket: 'scheduled', scheduledDate: today, status: 'todo' });
    const projects = listProjects(veyraDb, now, { includeArchived: false });
    const goals = listGoals(veyraDb, { activeOnly: true }, now);
    const todayEvents = listCalendarEvents(
      veyraDb,
      '2026-11-25T00:00:00.000Z',
      '2026-11-26T00:00:00.000Z',
    );

    const result = computeTodayCapacity(veyraDb, {
      date: today,
      upNext,
      completedToday: [],
      todayEvents,
      projects,
      goals,
      now,
    });

    const orderedIds = result.suggestedOrder.map((item) => item.blockId);

    // Tier 1: commitments (dueBlock, prepBlock) first
    expect(orderedIds.slice(0, 2)).toEqual([dueBlock.id, prepBlock.id]);
    // Tier 2: goal work with behind-weekly-time boosted ahead of on-track
    expect(orderedIds.slice(2, 4)).toEqual([goalBehindBlock.id, goalOnTrackBlock.id]);
    // Tier 3: other non-Ops (chronic carryover flagged, NOT promoted)
    expect(orderedIds[4]).toBe(otherBlock.id);
    // Tier 4: Ops
    expect(orderedIds[5]).toBe(opsBlock.id);
    // Tier 5: motion hot spot sunk to the bottom
    expect(orderedIds[6]).toBe(motionBlock.id);

    const motionItem = result.suggestedOrder.find((i) => i.blockId === motionBlock.id)!;
    expect(motionItem.isMotionHotSpot).toBe(true);
    expect(motionItem.reason).toBe('mostly just motion lately');

    const chronicItem = result.suggestedOrder.find((i) => i.blockId === otherBlock.id)!;
    expect(chronicItem.isChronicCarryover).toBe(true);

    const behindItem = result.suggestedOrder.find((i) => i.blockId === goalBehindBlock.id)!;
    expect(behindItem.isBehindWeeklyTime).toBe(true);
  });

  it('computeTodayCapacity places fitLine at cumulative room boundary and computes overflowBlockCount and overflowMinutes', () => {
    const today = '2026-11-25';
    const now = '2026-11-25T08:00:00.000Z';

    // 120m of meetings -> fallback 240 - 120 = 120m room
    upsertCalendarEvents(veyraDb, 'manual', [
      {
        externalId: 'm-2h',
        title: 'Workshop',
        startAt: '2026-11-25T10:00:00.000Z',
        endAt: '2026-11-25T12:00:00.000Z',
      },
    ]);

    createBlock(veyraDb, { title: 'B1', bucket: 'scheduled', scheduledDate: today, sizeMinutes: 60 }, { now });
    createBlock(veyraDb, { title: 'B2', bucket: 'scheduled', scheduledDate: today, sizeMinutes: 30 }, { now });
    createBlock(veyraDb, { title: 'B3', bucket: 'scheduled', scheduledDate: today, sizeMinutes: 60 }, { now });
    createBlock(veyraDb, { title: 'B4', bucket: 'scheduled', scheduledDate: today, sizeMinutes: 30 }, { now });

    const upNext = listBlocks(veyraDb, { bucket: 'scheduled', scheduledDate: today, status: 'todo' });
    const projects = listProjects(veyraDb, now, { includeArchived: false });
    const goals = listGoals(veyraDb, { activeOnly: true }, now);
    const todayEvents = listCalendarEvents(
      veyraDb,
      '2026-11-25T00:00:00.000Z',
      '2026-11-26T00:00:00.000Z',
    );

    const result = computeTodayCapacity(veyraDb, {
      date: today,
      upNext,
      completedToday: [],
      todayEvents,
      projects,
      goals,
      now,
    });

    // Room = 120m. B1 (60) + B2 (30) = 90 <= 120; B3 (60) pushes to 150 > 120 -> fitLineIndex = 2
    expect(result.roomToday.roomMinutes).toBe(120);
    expect(result.fitLine).toEqual({
      fitLineIndex: 2,
      fittingMinutes: 90,
      remainingMinutes: 30,
      overflowBlockCount: 2,
      overflowMinutes: 90,
    });
  });

  it('computeTodayCapacity produces DayLookBack when today queue clears or for yesterday rolled-over blocks', () => {
    const yesterday = '2026-11-24';
    const today = '2026-11-25';
    const goal = createGoal(veyraDb, { name: 'Ship v2' }, { now: `${yesterday}T08:00:00.000Z` });

    // Yesterday: 1 completed block (moved goal, 60m focus) + 1 unfinished block that rolls over to today
    const yDone = createBlock(
      veyraDb,
      { title: 'Done yesterday', goalId: goal.id, bucket: 'scheduled', scheduledDate: yesterday },
      { now: `${yesterday}T08:00:00.000Z` },
    );
    logManualSession(veyraDb, {
      blockId: yDone.id,
      startedAt: `${yesterday}T09:00:00.000Z`,
      endedAt: `${yesterday}T10:00:00.000Z`,
    });
    completeBlock(veyraDb, yDone.id, { senseSignal: 'moved' }, `${yesterday}T10:00:00.000Z`);

    const yCarry = createBlock(
      veyraDb,
      { title: 'Rolled over block', bucket: 'scheduled', scheduledDate: yesterday },
      { now: `${yesterday}T08:00:00.000Z` },
    );

    // Rollover into today
    runDailyRolloverAndRecurrence(veyraDb, `${today}T08:00:00.000Z`);

    const upNextMorning = listBlocks(veyraDb, { bucket: 'scheduled', scheduledDate: today, status: 'todo' });
    const projects = listProjects(veyraDb, `${today}T08:00:00.000Z`, { includeArchived: false });
    const goals = listGoals(veyraDb, { activeOnly: true }, `${today}T08:00:00.000Z`);

    const morningCap = computeTodayCapacity(veyraDb, {
      date: today,
      upNext: upNextMorning,
      completedToday: [],
      todayEvents: [],
      projects,
      goals,
      now: `${today}T08:00:00.000Z`,
    });

    expect(morningCap.dayLookBack).not.toBeNull();
    expect(morningCap.dayLookBack?.date).toBe(yesterday);
    expect(morningCap.dayLookBack?.isYesterday).toBe(true);
    expect(morningCap.dayLookBack?.focusedMinutes).toBe(60);
    expect(morningCap.dayLookBack?.goalSharePct).toBe(100);
    expect(morningCap.dayLookBack?.movedGoalCount).toBe(1);
    expect(morningCap.dayLookBack?.completedCount).toBe(1);
    expect(morningCap.dayLookBack?.notFitBlocks).toEqual([
      expect.objectContaining({ id: yCarry.id, title: 'Rolled over block' }),
    ]);

    // Now finish today's only block (yCarry) with focus + senseSignal = 'moved', and drop another with 'no_room'
    const droppedToday = createBlock(
      veyraDb,
      { title: 'Cut for room', bucket: 'scheduled', scheduledDate: today },
      { now: `${today}T08:30:00.000Z` },
    );
    dropBlock(veyraDb, droppedToday.id, { dropReason: 'no_room', now: `${today}T08:45:00.000Z` });

    updateBlock(veyraDb, yCarry.id, { goalId: goal.id }, { now: `${today}T09:00:00.000Z` });
    logManualSession(veyraDb, {
      blockId: yCarry.id,
      startedAt: `${today}T09:00:00.000Z`,
      endedAt: `${today}T10:30:00.000Z`,
    });
    const completedRes = completeBlock(
      veyraDb,
      yCarry.id,
      { senseSignal: 'moved' },
      `${today}T10:30:00.000Z`,
    );

    const eveningCap = computeTodayCapacity(veyraDb, {
      date: today,
      upNext: [],
      completedToday: [completedRes.block],
      todayEvents: [],
      projects,
      goals,
      now: `${today}T10:30:00.000Z`,
    });

    expect(eveningCap.dayLookBack).not.toBeNull();
    expect(eveningCap.dayLookBack?.date).toBe(today);
    expect(eveningCap.dayLookBack?.isYesterday).toBe(false);
    expect(eveningCap.dayLookBack?.focusedMinutes).toBe(90);
    expect(eveningCap.dayLookBack?.movedGoalCount).toBe(1);
    expect(eveningCap.dayLookBack?.completedCount).toBe(1);
    expect(eveningCap.dayLookBack?.notFitBlocks).toEqual([
      expect.objectContaining({ id: droppedToday.id, title: 'Cut for room' }),
    ]);
  });

  it('applySuggestedOrder persists deterministic increasing orderKeys in one transaction', () => {
    const today = '2026-11-25';
    const b1 = createBlock(veyraDb, { title: 'First', bucket: 'scheduled', scheduledDate: today });
    const b2 = createBlock(veyraDb, { title: 'Second', bucket: 'scheduled', scheduledDate: today });
    const b3 = createBlock(veyraDb, { title: 'Third', bucket: 'scheduled', scheduledDate: today });

    const reordered = applySuggestedOrder(veyraDb, [b3.id, b1.id, b2.id], { actor: 'user' });
    expect(reordered.map((b) => b.id)).toEqual([b3.id, b1.id, b2.id]);
    expect(reordered[0].orderKey < reordered[1].orderKey).toBe(true);
    expect(reordered[1].orderKey < reordered[2].orderKey).toBe(true);

    const fetched = listBlocks(veyraDb, { bucket: 'scheduled', scheduledDate: today, status: 'todo' });
    expect(fetched.map((b) => b.id)).toEqual([b3.id, b1.id, b2.id]);
  });

  it('listProjects computes weeklyVarianceStatus (over, under, untouched, on_track, time_without_plan, unplanned) and 8-week history', () => {
    const now = '2026-11-25T12:00:00.000Z'; // Week starts Mon 2026-11-23
    const pOver = createProject(veyraDb, { name: 'P Over', weeklyTimeMinutes: 100 }, { now });
    const pUnder = createProject(veyraDb, { name: 'P Under', weeklyTimeMinutes: 200 }, { now });
    const pUntouched = createProject(veyraDb, { name: 'P Untouched', weeklyTimeMinutes: 120 }, { now });
    const pOnTrack = createProject(veyraDb, { name: 'P OnTrack', weeklyTimeMinutes: 100 }, { now });
    const pTimeNoPlan = createProject(veyraDb, { name: 'P TimeNoPlan' }, { now });
    const pUnplanned = createProject(veyraDb, { name: 'P Unplanned' }, { now });

    const logMins = (projectId: string, startIso: string, minutes: number) => {
      const b = createBlock(veyraDb, { title: 'Work', projectId }, { now: startIso });
      logManualSession(veyraDb, {
        blockId: b.id,
        startedAt: startIso,
        endedAt: new Date(Date.parse(startIso) + minutes * 60_000).toISOString(),
      });
    };

    // Current week (2026-11-23)
    logMins(pOver.id, '2026-11-23T08:00:00.000Z', 130); // > 120 (100 * 1.2) => over
    logMins(pUnder.id, '2026-11-23T11:00:00.000Z', 100); // < 160 (200 * 0.8) => under
    logMins(pOnTrack.id, '2026-11-24T08:00:00.000Z', 90); // within [80, 120] => on_track
    logMins(pTimeNoPlan.id, '2026-11-24T10:00:00.000Z', 90); // > 60 without intent => time_without_plan
    logMins(pUnplanned.id, '2026-11-24T12:00:00.000Z', 45); // <= 60 without intent => unplanned

    // Historical week for pOver: 2 weeks ago (2026-11-09): 110m
    logMins(pOver.id, '2026-11-09T09:00:00.000Z', 110);

    const listed = listProjects(veyraDb, now);
    const byId = new Map(listed.map((p) => [p.id, p]));

    expect(byId.get(pOver.id)?.weeklyVarianceStatus).toBe('over');
    expect(byId.get(pUnder.id)?.weeklyVarianceStatus).toBe('under');
    expect(byId.get(pUntouched.id)?.weeklyVarianceStatus).toBe('untouched');
    expect(byId.get(pOnTrack.id)?.weeklyVarianceStatus).toBe('on_track');
    expect(byId.get(pTimeNoPlan.id)?.weeklyVarianceStatus).toBe('time_without_plan');
    expect(byId.get(pUnplanned.id)?.weeklyVarianceStatus).toBe('unplanned');

    const overStats = byId.get(pOver.id)!;
    expect(overStats.weeklyHistory8w).toHaveLength(8);
    expect(overStats.weeklyHistory8w[0].weekStartDate).toBe('2026-10-05');
    expect(overStats.weeklyHistory8w[5]).toEqual({ weekStartDate: '2026-11-09', focusMinutes: 110 });
    expect(overStats.weeklyHistory8w[7]).toEqual({ weekStartDate: '2026-11-23', focusMinutes: 130 });
    expect(overStats.averageWeeklyMinutes8w).toBe(30); // (110 + 130) / 8 = 30
  });

  it('computePlanCapacity aggregates projectTimeStrip and per-day plannedMinutes vs roomMinutes', () => {
    const now = '2026-11-25T08:00:00.000Z';
    const proj = createProject(veyraDb, { name: 'Alpha', weeklyTimeMinutes: 240 }, { now });
    const b1 = createBlock(
      veyraDb,
      { title: 'Mon task', projectId: proj.id, bucket: 'scheduled', scheduledDate: '2026-11-23', sizeMinutes: 120 },
      { now },
    );
    const b2 = createBlock(
      veyraDb,
      { title: 'Wed task', projectId: proj.id, bucket: 'scheduled', scheduledDate: '2026-11-25', sizeMinutes: 60 },
      { now },
    );
    logManualSession(veyraDb, {
      blockId: b1.id,
      startedAt: '2026-11-23T09:00:00.000Z',
      endedAt: '2026-11-23T10:30:00.000Z', // 90m logged
    });

    const projects = listProjects(veyraDb, now, { includeArchived: false });
    const days = [
      { date: '2026-11-23', blocks: [b1] },
      { date: '2026-11-24', blocks: [] },
      { date: '2026-11-25', blocks: [b2] },
    ];

    const planCap = computePlanCapacity(veyraDb, days, projects, now);
    expect(planCap.dayCapacities).toEqual([
      { date: '2026-11-23', plannedMinutes: 120, roomMinutes: 240 },
      { date: '2026-11-24', plannedMinutes: 0, roomMinutes: 240 },
      { date: '2026-11-25', plannedMinutes: 60, roomMinutes: 240 },
    ]);
    expect(planCap.projectTimeStrip).toContainEqual({
      projectId: proj.id,
      plannedMinutes: 180,
      loggedMinutes: 90,
      weeklyTimeMinutes: 240,
    });
  });
});
