import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  SYSTEM_OTHER_PROJECT_ID,
  ValidationError,
  type VeyraDb,
  addDailyNote,
  completeBlock,
  createBlock,
  createGoal,
  createProject,
  deleteDailyNote,
  deleteGoal,
  deleteProject,
  getActiveWeeklyRule,
  getBlock,
  getCalendarEvent,
  getProject,
  getSettings,
  getWeeklyReview,
  listCalendarEvents,
  listDailyNotes,
  logManualSession,
  openVeyraDb,
  parkBlock,
  runDailyRolloverAndRecurrence,
  setWeeklyRule,
  updateBlock,
  updateCalendarEvent,
  updateDailyNote,
  updateSettings,
  upsertCalendarEvents,
} from '../src/index.js';

describe('Task 4: Calendar Upsert, Daily Notes, Weekly Review Rollups & Settings', () => {
  let veyraDb: VeyraDb;

  beforeEach(() => {
    veyraDb = openVeyraDb(':memory:');
    updateSettings(veyraDb, { timezone: 'Europe/Berlin' });
  });

  afterEach(() => {
    veyraDb.close();
  });

  it('upserts calendar events preserving user projectId, goalId, isOps, notes, and externalLinks on re-sync', () => {
    const goal = createGoal(veyraDb, { name: 'Launch Veyra' });
    const project = createProject(veyraDb, { name: 'Veyra Core', defaultGoalId: goal.id });

    const firstSync = upsertCalendarEvents(veyraDb, 'outlook_cli', [
      {
        externalId: 'evt-1',
        title: 'Architecture Review',
        startAt: '2026-11-24T09:00:00.000Z',
        endAt: '2026-11-24T10:00:00.000Z',
        meetingUrl: 'https://teams.example.com/1',
      },
      {
        externalId: 'evt-allday',
        title: 'Company Holiday',
        startAt: '2026-11-24T00:00:00.000Z',
        endAt: '2026-11-25T00:00:00.000Z',
        isAllDay: true,
      },
      {
        externalId: 'evt-declined',
        title: 'Optional Sync',
        startAt: '2026-11-24T11:00:00.000Z',
        endAt: '2026-11-24T11:30:00.000Z',
        isDeclined: true,
      },
    ]);

    expect(firstSync.createdCount).toBe(1);
    expect(firstSync.skippedCount).toBe(2);

    const eventId = firstSync.upserted[0].id;
    updateCalendarEvent(veyraDb, eventId, {
      projectId: project.id,
      goalId: goal.id,
      isOps: true,
      notes: 'Agreed on SQLite WAL mode',
      externalLinks: [{ url: 'https://notion.so/arch', title: 'Arch Doc', source: 'notion' }],
    });

    // Re-sync with updated title and startAt
    const secondSync = upsertCalendarEvents(veyraDb, 'outlook_cli', [
      {
        externalId: 'evt-1',
        title: 'Architecture Review (Moved)',
        startAt: '2026-11-24T10:00:00.000Z',
        endAt: '2026-11-24T11:00:00.000Z',
        meetingUrl: 'https://teams.example.com/1-new',
      },
    ]);

    expect(secondSync.updatedCount).toBe(1);
    const updated = secondSync.upserted[0];
    expect(updated.id).toBe(eventId);
    expect(updated.title).toBe('Architecture Review (Moved)');
    expect(updated.startAt).toBe('2026-11-24T10:00:00.000Z');
    expect(updated.meetingUrl).toBe('https://teams.example.com/1-new');
    // User-owned fields preserved intact
    expect(updated.projectId).toBe(project.id);
    expect(updated.goalId).toBe(goal.id);
    expect(updated.isOps).toBe(true);
    expect(updated.notes).toBe('Agreed on SQLite WAL mode');
    expect(updated.externalLinks).toEqual([
      { url: 'https://notion.so/arch', title: 'Arch Doc', source: 'notion' },
    ]);

    const queried = listCalendarEvents(
      veyraDb,
      '2026-11-24T00:00:00.000Z',
      '2026-11-25T00:00:00.000Z',
    );
    expect(queried).toHaveLength(1);
    expect(queried[0].id).toBe(eventId);
  });

  it('computes full Weekly Review rollup: raw energyCounts, Build vs Ops, recurring Ops radar, chronic carryovers, past-revisit Later, daily notes & rules', () => {
    const mon = '2026-11-23';
    const tue = '2026-11-24';
    const wed = '2026-11-25';
    const thu = '2026-11-26';
    const fri = new Date('2026-11-27T17:00:00.000Z');

    const goal = createGoal(veyraDb, { name: 'Ship Beta' }, { now: `${mon}T08:00:00.000Z` });
    const buildProject = createProject(
      veyraDb,
      { name: 'Engine', defaultGoalId: goal.id },
      { now: `${mon}T08:00:00.000Z` },
    );
    const adminProject = createProject(
      veyraDb,
      { name: 'Admin' },
      { now: `${mon}T08:00:00.000Z` },
    );

    // 1. Two goal-linked Build blocks (120m + 60m = 180m), completed with 'up' energy
    const build1 = createBlock(
      veyraDb,
      { title: 'Core DB layer', projectId: buildProject.id, goalId: goal.id, bucket: 'scheduled', scheduledDate: mon },
      { now: `${mon}T08:00:00.000Z` },
    );
    logManualSession(veyraDb, {
      blockId: build1.id,
      startedAt: `${mon}T09:00:00.000Z`,
      endedAt: `${mon}T11:00:00.000Z`, // 120m
    });
    completeBlock(veyraDb, build1.id, { energySignal: 'up', outcomeNote: 'Solid' }, `${mon}T11:00:00.000Z`);
    updateBlock(
      veyraDb,
      build1.id,
      { autoSummary: 'Added SQLite WAL pragmas and migration smoke tests.' },
      { now: `${mon}T11:05:00.000Z`, actor: 'hook' },
    );

    const build2 = createBlock(
      veyraDb,
      { title: 'Focus state machine', projectId: buildProject.id, goalId: goal.id, bucket: 'scheduled', scheduledDate: tue },
      { now: `${tue}T08:00:00.000Z` },
    );
    logManualSession(veyraDb, {
      blockId: build2.id,
      startedAt: `${tue}T09:00:00.000Z`,
      endedAt: `${tue}T10:00:00.000Z`, // 60m
    });
    completeBlock(veyraDb, build2.id, { energySignal: 'up', outcomeNote: 'Clean' }, `${tue}T10:00:00.000Z`);

    // 2. Chronic carryover block created on Mon (will carry over Tue=1, Wed=2, Thu=3)
    const stuckBlock = createBlock(
      veyraDb,
      { title: 'Legacy cleanup', projectId: adminProject.id, bucket: 'scheduled', scheduledDate: mon },
      { now: `${mon}T08:00:00.000Z` },
    );

    // 3. Recurring Pure Ops series (Mon 30m + Tue 15m = 45m, rolled up by seriesId)
    const opsMon = createBlock(
      veyraDb,
      {
        title: 'Inbox zero',
        projectId: adminProject.id,
        goalId: null,
        isOps: true,
        bucket: 'scheduled',
        scheduledDate: mon,
        recurrenceRule: 'weekdays',
      },
      { now: `${mon}T08:00:00.000Z` },
    );
    logManualSession(veyraDb, {
      blockId: opsMon.id,
      startedAt: `${mon}T13:00:00.000Z`,
      endedAt: `${mon}T13:30:00.000Z`, // 30m
    });
    completeBlock(veyraDb, opsMon.id, { energySignal: 'neutral' }, `${mon}T13:30:00.000Z`);
    updateBlock(
      veyraDb,
      opsMon.id,
      { autoSummary: 'Recurring CI flake in webhook timeout retry test' },
      { now: `${mon}T13:35:00.000Z`, actor: 'hook' },
    );

    // Rollover to Tue to materialize second occurrence of the same seriesId (and carryover stuckBlock -> 1)
    const tueRoll = runDailyRolloverAndRecurrence(veyraDb, `${tue}T08:00:00.000Z`);
    expect(tueRoll.materializedBlockIds).toHaveLength(1);
    const opsTueId = tueRoll.materializedBlockIds[0];
    logManualSession(veyraDb, {
      blockId: opsTueId,
      startedAt: `${tue}T13:00:00.000Z`,
      endedAt: `${tue}T13:15:00.000Z`, // 15m
    });
    updateBlock(
      veyraDb,
      opsTueId,
      { autoSummary: 'Manual retry needed for flaky staging deploy queue' },
      { now: `${tue}T13:20:00.000Z`, actor: 'hook' },
    );

    // 4. Goal-linked Ops block (15m)
    const goalOps = createBlock(
      veyraDb,
      {
        title: 'Release prep checklist',
        projectId: buildProject.id,
        goalId: goal.id,
        isOps: true,
        bucket: 'scheduled',
        scheduledDate: wed,
      },
      { now: `${wed}T08:00:00.000Z` },
    );
    logManualSession(veyraDb, {
      blockId: goalOps.id,
      startedAt: `${wed}T14:00:00.000Z`,
      endedAt: `${wed}T14:15:00.000Z`, // 15m
    });

    // Rollover Wed (stuckBlock -> 2) and Thu (stuckBlock -> 3)
    runDailyRolloverAndRecurrence(veyraDb, `${wed}T08:00:00.000Z`);
    runDailyRolloverAndRecurrence(veyraDb, `${thu}T08:00:00.000Z`);

    // 5. Past-revisit Later item (revisitAt <= Fri 2026-11-27) + future Later item (excluded)
    const pastLater = createBlock(veyraDb, { title: 'Revisit vendor contract' }, { now: `${mon}T08:00:00.000Z` });
    parkBlock(veyraDb, pastLater.id, { revisitAt: '2026-11-26' }, { now: `${mon}T08:00:00.000Z` });

    const futureLater = createBlock(veyraDb, { title: 'Q1 planning' }, { now: `${mon}T08:00:00.000Z` });
    parkBlock(veyraDb, futureLater.id, { revisitAt: '2026-12-20' }, { now: `${mon}T08:00:00.000Z` });

    // 6. Goal-linked calendar meeting in this week
    const synced = upsertCalendarEvents(veyraDb, 'ics', [
      {
        externalId: 'meet-goal-1',
        title: 'Beta Launch Review',
        startAt: `${thu}T15:00:00.000Z`,
        endAt: `${thu}T16:00:00.000Z`,
      },
    ]);
    updateCalendarEvent(veyraDb, synced.upserted[0].id, { goalId: goal.id, projectId: buildProject.id });

    // 7. Daily notes (add, update, delete)
    const note1 = addDailyNote(
      veyraDb,
      { content: 'Morning deep work felt great', date: mon, projectId: buildProject.id },
      `${mon}T18:00:00.000Z`,
    );
    const note2 = addDailyNote(
      veyraDb,
      { content: 'Temporary note', date: tue },
      `${tue}T18:00:00.000Z`,
    );
    updateDailyNote(veyraDb, note1.id, { content: 'Morning deep work felt unstoppable' });
    deleteDailyNote(veyraDb, note2.id);
    expect(listDailyNotes(veyraDb, { weekStartDate: mon })).toHaveLength(1);

    // 8. Weekly rules: prev week's rule is active this week; this week's rule is for next week
    setWeeklyRule(veyraDb, '2026-11-16', 'Protect 09:00-11:00 for Build');
    setWeeklyRule(veyraDb, mon, 'Batch all Ops after 14:00');

    const review = getWeeklyReview(veyraDb, mon, fri);

    expect(review.weekStartDate).toBe('2026-11-23');
    expect(review.weekEndDate).toBe('2026-11-29');

    // Total focus: 120 + 60 + 30 + 15 + 15 = 240m
    expect(review.totalFocusMinutes).toBe(240);
    expect(review.buildMinutes).toBe(180);
    expect(review.opsMinutes).toBe(60);
    // Goal-linked focus: 120 + 60 + 15 = 195m / 240m = 81.25% -> 81%
    expect(review.goalAlignmentPct).toBe(81);

    // Raw energy counts (2 up, 1 neutral, 0 down)
    expect(review.energyCounts).toEqual({ up: 2, neutral: 1, down: 0 });

    // Progress feed has 3 completed blocks + 1 goal-linked meeting = 4 items
    expect(review.progressFeed).toHaveLength(4);
    expect(review.progressFeed.filter((i) => i.kind === 'block')).toHaveLength(3);
    expect(review.progressFeed.filter((i) => i.kind === 'meeting')).toHaveLength(1);
    const build1Feed = review.progressFeed.find((i) => i.kind === 'block' && i.id === build1.id);
    expect(build1Feed && build1Feed.kind === 'block' ? build1Feed.autoSummary : null).toBe(
      'Added SQLite WAL pragmas and migration smoke tests.',
    );

    // Ops radar: recurring series rolled up into 1 item (45m, 2 occurrences) + 1 goal-linked Ops item (15m)
    expect(review.opsRadar.totalOpsMinutes).toBe(60);
    expect(review.opsRadar.pureOpsMinutes).toBe(45);
    expect(review.opsRadar.goalLinkedOpsMinutes).toBe(15);
    expect(review.opsRadar.pureOpsItems).toHaveLength(1);
    expect(review.opsRadar.pureOpsItems[0]).toMatchObject({
      seriesId: opsMon.seriesId,
      occurrenceCount: 2,
      totalMinutes: 45,
      isGoalLinked: false,
      autoSummaries: [
        'Manual retry needed for flaky staging deploy queue',
        'Recurring CI flake in webhook timeout retry test',
      ],
    });
    expect(review.opsRadar.goalLinkedOpsItems).toHaveLength(1);
    expect(review.opsRadar.goalLinkedOpsItems[0]).toMatchObject({
      title: 'Release prep checklist',
      totalMinutes: 15,
      isGoalLinked: true,
    });

    // Chronic carryovers (>= 3)
    expect(review.chronicCarryovers.map((b) => b.id)).toEqual([stuckBlock.id]);
    expect(review.chronicCarryovers[0].carryoverCount).toBe(3);

    // Past revisit Later items (revisitAt <= today)
    expect(review.pastRevisitLater.map((b) => b.id)).toEqual([pastLater.id]);

    // Daily notes & rules
    expect(review.dailyNotes).toHaveLength(1);
    expect(review.dailyNotes[0].content).toBe('Morning deep work felt unstoppable');
    expect(review.activeRule?.ruleForNextWeek).toBe('Protect 09:00-11:00 for Build');
    expect(review.activeRuleText).toBe('Protect 09:00-11:00 for Build');
    expect(review.weeklyReview?.ruleForNextWeek).toBe('Batch all Ops after 14:00');
    expect(review.ruleForNextWeek).toBe('Batch all Ops after 14:00');
  });

  it('propagates week N ruleForNextWeek into week N+1 activeRule and getActiveWeeklyRule', () => {
    const weekNStart = '2026-11-23';
    const weekNPlus1Start = '2026-11-30';

    setWeeklyRule(veyraDb, weekNStart, 'Protect mornings');

    const weekNReview = getWeeklyReview(veyraDb, weekNStart, '2026-11-27T17:00:00.000Z');
    expect(weekNReview.activeRule).toBeNull();
    expect(weekNReview.activeRuleText).toBeNull();
    expect(weekNReview.weeklyReview?.ruleForNextWeek).toBe('Protect mornings');
    expect(weekNReview.ruleForNextWeek).toBe('Protect mornings');

    const weekNPlus1Review = getWeeklyReview(veyraDb, weekNPlus1Start, '2026-12-04T17:00:00.000Z');
    expect(weekNPlus1Review.activeRule?.ruleForNextWeek).toBe('Protect mornings');
    expect(weekNPlus1Review.activeRuleText).toBe('Protect mornings');
    expect(weekNPlus1Review.weeklyReview).toBeNull();
    expect(weekNPlus1Review.ruleForNextWeek).toBeNull();

    // Helper for Today endpoint during Week N+1 (Wednesday 2026-12-02)
    const activeForToday = getActiveWeeklyRule(veyraDb, '2026-12-02');
    expect(activeForToday.weekStartDate).toBe(weekNPlus1Start);
    expect(activeForToday.activeRule?.ruleForNextWeek).toBe('Protect mornings');
    expect(activeForToday.activeRuleText).toBe('Protect mornings');
    expect(activeForToday.nextWeekRule).toBeNull();
  });

  it('clears soft-deleted goal and project foreign key references across projects, blocks, meetings, and daily notes', () => {
    const mon = '2026-11-23';
    const nowIso = `${mon}T12:00:00.000Z`;

    const goal = createGoal(veyraDb, { name: 'Ephemeral Goal' }, { now: `${mon}T08:00:00.000Z` });
    const project = createProject(
      veyraDb,
      { name: 'Ephemeral Project', defaultGoalId: goal.id },
      { now: `${mon}T08:00:00.000Z` },
    );

    const blk = createBlock(
      veyraDb,
      { title: 'Goal block', projectId: project.id, goalId: goal.id, bucket: 'scheduled', scheduledDate: mon },
      { now: `${mon}T08:00:00.000Z` },
    );
    logManualSession(veyraDb, {
      blockId: blk.id,
      startedAt: `${mon}T09:00:00.000Z`,
      endedAt: `${mon}T10:00:00.000Z`, // 60m
    });
    completeBlock(veyraDb, blk.id, { energySignal: 'up' }, `${mon}T10:00:00.000Z`);

    const synced = upsertCalendarEvents(veyraDb, 'ics', [
      {
        externalId: 'meet-del-1',
        title: 'Goal Sync',
        startAt: `${mon}T10:00:00.000Z`,
        endAt: `${mon}T11:00:00.000Z`,
      },
    ]);
    const meetingId = synced.upserted[0].id;
    updateCalendarEvent(veyraDb, meetingId, { projectId: project.id, goalId: goal.id });

    const note = addDailyNote(
      veyraDb,
      { content: 'Linked note', date: mon, projectId: project.id, goalId: goal.id },
      `${mon}T11:00:00.000Z`,
    );

    // Before deleting goal: 100% goal alignment and meeting included in progressFeed
    const beforeReview = getWeeklyReview(veyraDb, mon, nowIso);
    expect(beforeReview.goalAlignmentPct).toBe(100);
    expect(beforeReview.progressFeed.some((i) => i.kind === 'meeting' && i.id === meetingId)).toBe(true);

    // Delete goal -> clears references on projects, blocks, calendar_events, daily_notes
    deleteGoal(veyraDb, goal.id, { now: nowIso });

    expect(getProject(veyraDb, project.id, nowIso).defaultGoalId).toBeNull();
    expect(getBlock(veyraDb, blk.id).goalId).toBeNull();
    expect(getCalendarEvent(veyraDb, meetingId).goalId).toBeNull();
    expect(listDailyNotes(veyraDb, { date: mon }).find((n) => n.id === note.id)?.goalId).toBeNull();

    const afterGoalDeleteReview = getWeeklyReview(veyraDb, mon, nowIso);
    expect(afterGoalDeleteReview.goalAlignmentPct).toBe(0);
    expect(
      afterGoalDeleteReview.progressFeed.some((i) => i.kind === 'meeting' && i.id === meetingId),
    ).toBe(false);

    // Delete project -> reassigns block to Other and clears calendar_events & daily_notes projectId
    deleteProject(veyraDb, project.id, { now: nowIso });

    expect(getBlock(veyraDb, blk.id).projectId).toBe(SYSTEM_OTHER_PROJECT_ID);
    expect(getCalendarEvent(veyraDb, meetingId).projectId).toBeNull();
    expect(listDailyNotes(veyraDb, { date: mon }).find((n) => n.id === note.id)?.projectId).toBeNull();
  });

  it('keeps Ops Radar pure vs goal-linked groups strictly consistent when a recurring series mixes goal linkage', () => {
    const mon = '2026-11-23';
    const tue = '2026-11-24';

    const goal = createGoal(veyraDb, { name: 'Ship v1' }, { now: `${mon}T08:00:00.000Z` });
    const opsMon = createBlock(
      veyraDb,
      {
        title: 'Daily triage',
        isOps: true,
        goalId: null,
        bucket: 'scheduled',
        scheduledDate: mon,
        recurrenceRule: 'weekdays',
      },
      { now: `${mon}T08:00:00.000Z` },
    );
    logManualSession(veyraDb, {
      blockId: opsMon.id,
      startedAt: `${mon}T09:00:00.000Z`,
      endedAt: `${mon}T09:30:00.000Z`, // 30m pure Ops
    });

    const tueRoll = runDailyRolloverAndRecurrence(veyraDb, `${tue}T08:00:00.000Z`);
    const opsTueId = tueRoll.materializedBlockIds[0];
    // Link Tuesday's occurrence to a goal
    updateBlock(veyraDb, opsTueId, { goalId: goal.id }, { now: `${tue}T08:30:00.000Z` });
    logManualSession(veyraDb, {
      blockId: opsTueId,
      startedAt: `${tue}T09:00:00.000Z`,
      endedAt: `${tue}T09:15:00.000Z`, // 15m goal-linked Ops
    });

    const review = getWeeklyReview(veyraDb, mon, `${tue}T17:00:00.000Z`);
    expect(review.opsRadar.totalOpsMinutes).toBe(45);
    expect(review.opsRadar.pureOpsMinutes).toBe(30);
    expect(review.opsRadar.goalLinkedOpsMinutes).toBe(15);
    expect(review.opsRadar.pureOpsItems).toHaveLength(1);
    expect(review.opsRadar.pureOpsItems[0].totalMinutes).toBe(30);
    expect(review.opsRadar.goalLinkedOpsItems).toHaveLength(1);
    expect(review.opsRadar.goalLinkedOpsItems[0].totalMinutes).toBe(15);
  });

  it('soft-deletes existing calendar events on re-sync when they become declined or all-day and skipDeclinedAndAllDay is enabled', () => {
    const first = upsertCalendarEvents(veyraDb, 'outlook_cli', [
      {
        externalId: 'evt-decline-me',
        title: 'Weekly Standup',
        startAt: '2026-11-24T09:00:00.000Z',
        endAt: '2026-11-24T09:30:00.000Z',
      },
      {
        externalId: 'evt-allday-me',
        title: 'Offsite',
        startAt: '2026-11-24T10:00:00.000Z',
        endAt: '2026-11-24T12:00:00.000Z',
      },
    ]);
    expect(first.createdCount).toBe(2);
    expect(first.deletedCount).toBe(0);

    const standupId = first.upserted.find((e) => e.externalId === 'evt-decline-me')!.id;
    updateCalendarEvent(veyraDb, standupId, { notes: 'Saved prep notes' });

    expect(
      listCalendarEvents(veyraDb, '2026-11-24T00:00:00.000Z', '2026-11-25T00:00:00.000Z'),
    ).toHaveLength(2);

    // Re-sync: first becomes declined, second becomes all-day
    const second = upsertCalendarEvents(veyraDb, 'outlook_cli', [
      {
        externalId: 'evt-decline-me',
        title: 'Weekly Standup',
        startAt: '2026-11-24T09:00:00.000Z',
        endAt: '2026-11-24T09:30:00.000Z',
        isDeclined: true,
      },
      {
        externalId: 'evt-allday-me',
        title: 'Offsite',
        startAt: '2026-11-24T00:00:00.000Z',
        endAt: '2026-11-25T00:00:00.000Z',
        isAllDay: true,
      },
    ]);

    expect(second.deletedCount).toBe(2);
    expect(second.skippedCount).toBe(2);
    expect(
      listCalendarEvents(veyraDb, '2026-11-24T00:00:00.000Z', '2026-11-25T00:00:00.000Z'),
    ).toHaveLength(0);

    // Re-accepting later restores the event and preserves user notes
    const third = upsertCalendarEvents(veyraDb, 'outlook_cli', [
      {
        externalId: 'evt-decline-me',
        title: 'Weekly Standup',
        startAt: '2026-11-24T09:00:00.000Z',
        endAt: '2026-11-24T09:30:00.000Z',
        isDeclined: false,
      },
    ]);
    expect(third.updatedCount).toBe(1);
    expect(third.upserted[0].id).toBe(standupId);
    expect(third.upserted[0].notes).toBe('Saved prep notes');
  });

  it('reads and updates settings and rejects invalid IANA timezones', () => {
    const initial = getSettings(veyraDb);
    expect(initial.timezone).toBe('Europe/Berlin');

    const updated = updateSettings(veyraDb, {
      timezone: 'America/New_York',
      onboardingCompleted: true,
      calendarSyncMode: 'outlook_cli',
      outlookCliCommand: 'outlook-cli cal list --json',
      webhookEvents: ['focus.started', 'block.completed'],
    });

    expect(updated.timezone).toBe('America/New_York');
    expect(updated.onboardingCompleted).toBe(true);
    expect(updated.calendarSyncMode).toBe('outlook_cli');
    expect(updated.webhookEvents).toEqual(['focus.started', 'block.completed']);

    expect(() => updateSettings(veyraDb, { timezone: 'Mars/Olympus_Mons' })).toThrow(
      ValidationError,
    );
  });
});
