import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  COLOR_PICKER_PRESETS,
  SYSTEM_OTHER_PROJECT_ID,
  ValidationError,
  type VeyraDb,
  addDailyNote,
  closeGoal,
  completeBlock,
  completeWeeklyReview,
  createBlock,
  createGoal,
  createProject,
  deleteDailyNote,
  deleteGoal,
  deleteProject,
  dropBlock,
  getActiveWeeklyRule,
  getBlock,
  getCalendarEvent,
  getGoalDetail,
  getIsoWeekNumber,
  getProject,
  getSettings,
  getWeeklyReview,
  listCalendarEvents,
  listDailyNotes,
  listGoals,
  logManualSession,
  openVeyraDb,
  parkBlock,
  reopenWeeklyReview,
  reorderGoal,
  resolveIsoWeekStartDate,
  resolveNotionToken,
  resolveHotkey,
  runDailyRolloverAndRecurrence,
  setPreviousRuleKept,
  setWeeklyRule,
  toPublicSettings,
  updateBlock,
  updateCalendarEvent,
  updateDailyNote,
  updateGoal,
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

    expect(initial.hotkeys).toEqual({});
    const rebound = updateSettings(veyraDb, { hotkeys: { quickFocus: 'Alt+Shift+F' } });
    expect(rebound.hotkeys).toEqual({ quickFocus: 'Alt+Shift+F' });
    expect(getSettings(veyraDb).hotkeys).toEqual({ quickFocus: 'Alt+Shift+F' });
    expect(resolveHotkey('quickFocus', rebound.hotkeys)).toEqual(['Alt+Shift+F']);
    expect(resolveHotkey('globalCommandPalette', rebound.hotkeys)).toEqual(['Alt+K']);
    expect(updateSettings(veyraDb, { hotkeys: {} }).hotkeys).toEqual({});

    expect(() => updateSettings(veyraDb, { timezone: 'Mars/Olympus_Mons' })).toThrow(
      ValidationError,
    );
  });

  it('stores, preserves, clears, and masks notionToken across settings and env fallback', () => {
    expect(getSettings(veyraDb).notionToken).toBeNull();
    expect(toPublicSettings(getSettings(veyraDb))).toMatchObject({
      notionConfigured: false,
      notionTokenSource: null,
    });

    // Env fallback works when DB token is null
    expect(resolveNotionToken(getSettings(veyraDb), 'ntn_env_123')).toEqual({
      token: 'ntn_env_123',
      source: 'env',
    });
    const envPublic = toPublicSettings(getSettings(veyraDb), 'ntn_env_123');
    expect(envPublic.notionConfigured).toBe(true);
    expect(envPublic.notionTokenSource).toBe('env');
    expect('notionToken' in envPublic).toBe(false);

    // Persisting a settings token trims whitespace and takes precedence over env
    const saved = updateSettings(veyraDb, { notionToken: '  ntn_saved_secret  ' });
    expect(saved.notionToken).toBe('ntn_saved_secret');
    expect(resolveNotionToken(saved, 'ntn_env_123')).toEqual({
      token: 'ntn_saved_secret',
      source: 'settings',
    });
    const savedPublic = toPublicSettings(saved, 'ntn_env_123');
    expect(savedPublic.notionConfigured).toBe(true);
    expect(savedPublic.notionTokenSource).toBe('settings');
    expect('notionToken' in savedPublic).toBe(false);

    // Unrelated update preserves notionToken
    const afterTz = updateSettings(veyraDb, { timezone: 'UTC' });
    expect(afterTz.notionToken).toBe('ntn_saved_secret');

    // Explicit null or whitespace clears notionToken
    const cleared = updateSettings(veyraDb, { notionToken: null });
    expect(cleared.notionToken).toBeNull();
  });

  it('creates and updates company goals with richer fields and records measure history on change', () => {
    expect(COLOR_PICKER_PRESETS).toHaveLength(12);
    expect(COLOR_PICKER_PRESETS[0]).toEqual({ name: 'Indigo', hex: '#5E6AD2' });

    const createdAt = '2026-11-23T08:00:00.000Z';
    const updatedAt = '2026-11-25T10:00:00.000Z';

    const goal = createGoal(
      veyraDb,
      {
        name: 'Generate upsells',
        kind: 'company',
        description: 'Grow expansion ARR across existing enterprise accounts',
        doneWhen: '10 signed enterprise upsells in Q1',
        checkInDate: '2027-03-31',
        measure: '3 of 10 upsells',
        ifItStalls: 'Pair with account leads for weekly pipeline review',
        color: '#4DA3FF',
      },
      { now: createdAt },
    );

    expect(goal).toMatchObject({
      name: 'Generate upsells',
      kind: 'company',
      doneWhen: '10 signed enterprise upsells in Q1',
      checkInDate: '2027-03-31',
      measure: '3 of 10 upsells',
      ifItStalls: 'Pair with account leads for weekly pipeline review',
      closingNote: null,
      closedAt: null,
    });

    // Completed block in current quarter with outcome note
    const recentBlk = createBlock(
      veyraDb,
      { title: 'Close Acme expansion', goalId: goal.id, bucket: 'scheduled', scheduledDate: '2026-11-24' },
      { now: '2026-11-24T09:00:00.000Z' },
    );
    logManualSession(veyraDb, {
      blockId: recentBlk.id,
      startedAt: '2026-11-24T09:00:00.000Z',
      endedAt: '2026-11-24T10:00:00.000Z',
    });
    completeBlock(
      veyraDb,
      recentBlk.id,
      { outcomeNote: 'Signed 40k expansion with Acme' },
      '2026-11-24T10:00:00.000Z',
    );

    // Completed block in current quarter WITHOUT outcome note (should be excluded from history)
    const emptyOutcomeBlk = createBlock(
      veyraDb,
      { title: 'Internal prep', goalId: goal.id, bucket: 'scheduled', scheduledDate: '2026-11-24' },
      { now: '2026-11-24T11:00:00.000Z' },
    );
    completeBlock(veyraDb, emptyOutcomeBlk.id, { outcomeNote: '   ' }, '2026-11-24T11:30:00.000Z');

    // Old completed block outside quarter & >90 days ago (should be excluded from quarterly history)
    const oldBlk = createBlock(
      veyraDb,
      { title: 'Ancient milestone', goalId: goal.id, bucket: 'scheduled', scheduledDate: '2026-06-01' },
      { now: '2026-06-01T09:00:00.000Z' },
    );
    completeBlock(veyraDb, oldBlk.id, { outcomeNote: 'Old note' }, '2026-06-01T10:00:00.000Z');

    // Update measure -> records measure history row
    const updated = updateGoal(
      veyraDb,
      goal.id,
      { measure: '4 of 10 upsells' },
      { now: updatedAt },
    );
    expect(updated.measure).toBe('4 of 10 upsells');

    // Updating unrelated field does NOT create duplicate measure history row
    updateGoal(
      veyraDb,
      goal.id,
      { description: 'Grow expansion ARR across enterprise accounts' },
      { now: '2026-11-25T11:00:00.000Z' },
    );

    const detail = getGoalDetail(veyraDb, goal.id, '2026-11-25T12:00:00.000Z');
    expect(detail.measure).toBe('4 of 10 upsells');
    expect(detail.history).toHaveLength(2);
    expect(detail.history[0]).toMatchObject({
      kind: 'measure',
      previousValue: '3 of 10 upsells',
      value: '4 of 10 upsells',
      weekStartDate: '2026-11-23',
      timestamp: updatedAt,
    });
    expect(detail.history[1]).toMatchObject({
      kind: 'outcome',
      blockId: recentBlk.id,
      blockTitle: 'Close Acme expansion',
      outcomeNote: 'Signed 40k expansion with Acme',
      totalFocusMinutes: 60,
    });
  });

  it('closeGoal marks achieved or archived (Let Go), stores closingNote and closedAt, and excludes both from activeOnly listGoals', () => {
    const achievedGoal = createGoal(
      veyraDb,
      { name: 'Ship v1', kind: 'personal' },
      { now: '2026-11-23T08:00:00.000Z' },
    );
    const letGoGoal = createGoal(
      veyraDb,
      { name: 'Legacy migration', kind: 'company' },
      { now: '2026-11-23T08:05:00.000Z' },
    );
    const linkedBlock = createBlock(
      veyraDb,
      { title: 'Final launch check', goalId: achievedGoal.id, bucket: 'scheduled', scheduledDate: '2026-11-23' },
      { now: '2026-11-23T09:00:00.000Z' },
    );

    const closedAchieved = closeGoal(
      veyraDb,
      achievedGoal.id,
      { status: 'achieved', closingNote: 'Hit target' },
      { now: '2026-11-25T15:00:00.000Z' },
    );
    const closedLetGo = closeGoal(
      veyraDb,
      letGoGoal.id,
      { status: 'archived', closingNote: 'No longer relevant' },
      { now: '2026-11-25T15:05:00.000Z' },
    );

    expect(closedAchieved.status).toBe('achieved');
    expect(closedAchieved.closingNote).toBe('Hit target');
    expect(closedAchieved.closedAt).toBe('2026-11-25T15:00:00.000Z');

    expect(closedLetGo.status).toBe('archived');
    expect(closedLetGo.closingNote).toBe('No longer relevant');
    expect(closedLetGo.closedAt).toBe('2026-11-25T15:05:00.000Z');

    // activeOnly excludes both achieved and archived
    expect(listGoals(veyraDb, { activeOnly: true }, '2026-11-25T16:00:00.000Z')).toHaveLength(0);

    // includeArchived: true returns both with closedAt and rankInKind === 0
    const allGoals = listGoals(veyraDb, { includeArchived: true }, '2026-11-25T16:00:00.000Z');
    expect(allGoals).toHaveLength(2);
    expect(allGoals.find((g) => g.id === achievedGoal.id)).toMatchObject({
      status: 'achieved',
      closedAt: '2026-11-25T15:00:00.000Z',
      rankInKind: 0,
    });
    expect(allGoals.find((g) => g.id === letGoGoal.id)).toMatchObject({
      status: 'archived',
      closedAt: '2026-11-25T15:05:00.000Z',
      rankInKind: 0,
    });

    // Linked blocks retain goalId
    expect(getBlock(veyraDb, linkedBlock.id).goalId).toBe(achievedGoal.id);

    // Reopening clears closedAt
    const reopened = updateGoal(
      veyraDb,
      achievedGoal.id,
      { status: 'active' },
      { now: '2026-11-25T16:30:00.000Z' },
    );
    expect(reopened.status).toBe('active');
    expect(reopened.closedAt).toBeNull();
  });

  it('reorderGoal swaps orderKey only within the same kind', () => {
    const p1 = createGoal(veyraDb, { name: 'Personal 1', kind: 'personal' });
    const p2 = createGoal(veyraDb, { name: 'Personal 2', kind: 'personal' });
    const c1 = createGoal(veyraDb, { name: 'Company 1', kind: 'company' });
    const c2 = createGoal(veyraDb, { name: 'Company 2', kind: 'company' });

    reorderGoal(veyraDb, c2.id, { direction: 'up' });

    const companyGoals = listGoals(veyraDb, { kind: 'company', activeOnly: true });
    expect(companyGoals.map((g) => g.id)).toEqual([c2.id, c1.id]);
    expect(companyGoals.map((g) => g.rankInKind)).toEqual([1, 2]);

    const personalGoals = listGoals(veyraDb, { kind: 'personal', activeOnly: true });
    expect(personalGoals.map((g) => g.id)).toEqual([p1.id, p2.id]);
    expect(personalGoals.map((g) => g.rankInKind)).toEqual([1, 2]);
  });

  it('listGoals computes weeklyFocusMinutes, weeklyBlockCount, linkedProjectCount, and rankInKind without any weeklyIntent field', () => {
    const mon = '2026-11-23';
    const tue = '2026-11-24';
    const now = '2026-11-25T12:00:00.000Z';

    const g1 = createGoal(veyraDb, { name: 'Master Systems', kind: 'personal' }, { now: `${mon}T08:00:00.000Z` });
    const g2 = createGoal(veyraDb, { name: 'Write Weekly', kind: 'personal' }, { now: `${mon}T08:01:00.000Z` });

    createProject(veyraDb, { name: 'Proj A', defaultGoalId: g1.id }, { now: `${mon}T08:02:00.000Z` });
    createProject(veyraDb, { name: 'Proj B', defaultGoalId: g1.id }, { now: `${mon}T08:03:00.000Z` });

    const b1 = createBlock(
      veyraDb,
      { title: 'Block 1', goalId: g1.id, bucket: 'scheduled', scheduledDate: mon },
      { now: `${mon}T08:10:00.000Z` },
    );
    logManualSession(veyraDb, {
      blockId: b1.id,
      startedAt: `${mon}T09:00:00.000Z`,
      endedAt: `${mon}T09:45:00.000Z`, // 45m
    });

    const b2 = createBlock(
      veyraDb,
      { title: 'Block 2', goalId: g1.id, bucket: 'scheduled', scheduledDate: tue },
      { now: `${tue}T08:10:00.000Z` },
    );
    logManualSession(veyraDb, {
      blockId: b2.id,
      startedAt: `${tue}T10:00:00.000Z`,
      endedAt: `${tue}T10:30:00.000Z`, // 30m
    });

    // Previous week session (should NOT count in this week's stats)
    const oldBlk = createBlock(
      veyraDb,
      { title: 'Last week block', goalId: g1.id, bucket: 'scheduled', scheduledDate: '2026-11-18' },
      { now: '2026-11-18T08:00:00.000Z' },
    );
    logManualSession(veyraDb, {
      blockId: oldBlk.id,
      startedAt: '2026-11-18T09:00:00.000Z',
      endedAt: '2026-11-18T11:00:00.000Z',
    });

    const listed = listGoals(veyraDb, { activeOnly: true }, now);
    const stat1 = listed.find((g) => g.id === g1.id)!;
    const stat2 = listed.find((g) => g.id === g2.id)!;

    expect(stat1).toMatchObject({
      weeklyFocusMinutes: 75,
      weeklyBlockCount: 2,
      linkedProjectCount: 2,
      rankInKind: 1,
    });
    expect('weeklyIntent' in stat1).toBe(false);

    expect(stat2).toMatchObject({
      weeklyFocusMinutes: 0,
      weeklyBlockCount: 0,
      linkedProjectCount: 0,
      rankInKind: 2,
    });
  });

  it('getIsoWeekNumber and resolveIsoWeekStartDate map week 47 of 2026 to Monday 2026-11-16 and reject week 0 or 54', () => {
    expect(getIsoWeekNumber('2026-11-16')).toEqual({ isoYear: 2026, isoWeek: 47 });
    expect(getIsoWeekNumber('2026-11-22')).toEqual({ isoYear: 2026, isoWeek: 47 });
    expect(getIsoWeekNumber('2026-11-23')).toEqual({ isoYear: 2026, isoWeek: 48 });

    // Year-boundary ISO week 1 & week 53 of 2026 (2026 starts on Thursday -> 53 ISO weeks)
    expect(getIsoWeekNumber('2025-12-29')).toEqual({ isoYear: 2026, isoWeek: 1 });
    expect(getIsoWeekNumber('2026-01-04')).toEqual({ isoYear: 2026, isoWeek: 1 });
    expect(getIsoWeekNumber('2026-12-31')).toEqual({ isoYear: 2026, isoWeek: 53 });

    expect(resolveIsoWeekStartDate(47, '2026-11-25')).toBe('2026-11-16');
    expect(resolveIsoWeekStartDate(1, '2026-11-25')).toBe('2025-12-29');
    expect(resolveIsoWeekStartDate(53, '2026-11-25')).toBe('2026-12-28');

    // 2025 only has 52 ISO weeks
    expect(() => resolveIsoWeekStartDate(53, '2025-06-15')).toThrow(ValidationError);
    expect(() => resolveIsoWeekStartDate(0, '2026-11-25')).toThrow(ValidationError);
    expect(() => resolveIsoWeekStartDate(54, '2026-11-25')).toThrow(ValidationError);
    expect(() => resolveIsoWeekStartDate(1.5, '2026-11-25')).toThrow(ValidationError);
  });

  it('getWeeklyReview computes chapter opening sentences, Company vs Personal split, senseCounts, Mon-Fri dayStrip, goalReviews (check-in due, 2 quiet weeks, stalled), and worthSecondLook', () => {
    const mon = '2026-11-23';
    const tue = '2026-11-24';
    const wed = '2026-11-25';
    const friNow = '2026-11-27T17:00:00.000Z';

    const companyGoal = createGoal(
      veyraDb,
      {
        name: 'Generate upsells',
        kind: 'company',
        doneWhen: '10 signed upsells',
        checkInDate: '2026-11-25', // check-in due during review week
        measure: '4 of 10',
      },
      { now: '2026-11-01T08:00:00.000Z' },
    );
    const quietPersonalGoal = createGoal(
      veyraDb,
      {
        name: 'Write technical essays',
        kind: 'personal',
        ifItStalls: 'Block 30m Friday morning for an outline',
      },
      { now: '2026-11-01T08:00:00.000Z' },
    );
    const stalledCompanyGoal = createGoal(
      veyraDb,
      {
        name: 'Customer onboarding',
        kind: 'company',
        ifItStalls: 'Audit onboarding tickets before adding more work',
      },
      { now: '2026-11-01T08:00:00.000Z' },
    );

    const proj = createProject(
      veyraDb,
      { name: 'LioCare', defaultGoalId: companyGoal.id, weeklyTimeMinutes: 180 },
      { now: '2026-11-01T08:00:00.000Z' },
    );

    // 2 moved blocks on companyGoal (120m + 60m = 180m)
    const b1 = createBlock(
      veyraDb,
      {
        title: 'Acme renewal pitch',
        projectId: proj.id,
        goalId: companyGoal.id,
        bucket: 'scheduled',
        scheduledDate: mon,
        sizeMinutes: 120,
      },
      { now: `${mon}T08:00:00.000Z` },
    );
    logManualSession(veyraDb, {
      blockId: b1.id,
      startedAt: `${mon}T09:00:00.000Z`,
      endedAt: `${mon}T11:00:00.000Z`,
    });
    completeBlock(
      veyraDb,
      b1.id,
      { senseSignal: 'moved', energySignal: 'up', outcomeNote: 'Acme approved expansion scope' },
      `${mon}T11:00:00.000Z`,
    );

    const b2 = createBlock(
      veyraDb,
      {
        title: 'Siemens upsell deck',
        projectId: proj.id,
        goalId: companyGoal.id,
        bucket: 'scheduled',
        scheduledDate: tue,
        sizeMinutes: 60,
      },
      { now: `${tue}T08:00:00.000Z` },
    );
    logManualSession(veyraDb, {
      blockId: b2.id,
      startedAt: `${tue}T09:00:00.000Z`,
      endedAt: `${tue}T10:00:00.000Z`,
    });
    completeBlock(
      veyraDb,
      b2.id,
      { senseSignal: 'moved', outcomeNote: 'Deck sent to Siemens sponsor' },
      `${tue}T10:00:00.000Z`,
    );

    // 1 motion + 1 partly block on stalledCompanyGoal (60m + 30m = 90m)
    const b3 = createBlock(
      veyraDb,
      {
        title: 'Onboarding spreadsheet sync',
        projectId: proj.id,
        goalId: stalledCompanyGoal.id,
        bucket: 'scheduled',
        scheduledDate: wed,
        sizeMinutes: 60,
      },
      { now: `${wed}T08:00:00.000Z` },
    );
    logManualSession(veyraDb, {
      blockId: b3.id,
      startedAt: `${wed}T09:00:00.000Z`,
      endedAt: `${wed}T10:00:00.000Z`,
    });
    completeBlock(veyraDb, b3.id, { senseSignal: 'motion' }, `${wed}T10:00:00.000Z`);

    const b4 = createBlock(
      veyraDb,
      {
        title: 'Follow up ticket tags',
        projectId: proj.id,
        goalId: stalledCompanyGoal.id,
        bucket: 'scheduled',
        scheduledDate: wed,
        sizeMinutes: 30,
      },
      { now: `${wed}T10:00:00.000Z` },
    );
    logManualSession(veyraDb, {
      blockId: b4.id,
      startedAt: `${wed}T10:30:00.000Z`,
      endedAt: `${wed}T11:00:00.000Z`,
    });
    completeBlock(veyraDb, b4.id, { senseSignal: 'partly' }, `${wed}T11:00:00.000Z`);

    // 1 meeting on Monday (60m)
    upsertCalendarEvents(veyraDb, 'ics', [
      {
        externalId: 'mon-meet',
        title: 'Weekly Sync',
        startAt: `${mon}T14:00:00.000Z`,
        endAt: `${mon}T15:00:00.000Z`,
      },
    ]);

    setPreviousRuleKept(veyraDb, mon, 'partly', { now: friNow });

    const review = getWeeklyReview(veyraDb, mon, friNow);

    expect(review.weekNumber).toBe(48);
    expect(review.previousRuleKept).toBe('partly');
    expect(review.companyGoalMinutes).toBe(270);
    expect(review.personalGoalMinutes).toBe(0);
    expect(review.companyGoalPct).toBe(100);
    expect(review.personalGoalPct).toBe(0);
    expect(review.senseCounts).toEqual({ moved: 2, partly: 1, motion: 1 });
    expect(review.worthSecondLook.map((b) => b.id)).toEqual([b4.id, b3.id]);

    // Mon-Fri dayStrip (5 items)
    expect(review.dayStrip).toHaveLength(5);
    expect(review.dayStrip[0]).toMatchObject({
      date: mon,
      weekday: 'Mon',
      focusMinutes: 120,
      plannedMinutes: 120,
      meetingMinutes: 60,
      roomMinutes: 180, // 240 baseline - 60 meeting
    });
    expect(review.dayStrip[1]).toMatchObject({
      date: tue,
      weekday: 'Tue',
      focusMinutes: 60,
      plannedMinutes: 60,
      meetingMinutes: 0,
      roomMinutes: 240,
    });
    expect(review.roomMinutesTotal).toBe(180 + 240 * 4);
    expect(review.plannedMinutesTotal).toBe(120 + 60 + 90);

    // Goal reviews: Company first, then Personal, with NO weekly target property
    expect(review.goalReviews.map((g) => g.goalId)).toEqual([
      companyGoal.id,
      stalledCompanyGoal.id,
      quietPersonalGoal.id,
    ]);
    const companyRow = review.goalReviews[0];
    expect(companyRow).toMatchObject({
      goalId: companyGoal.id,
      kind: 'company',
      focusMinutes: 180,
      blockCount: 2,
      senseCounts: { moved: 2, partly: 0, motion: 0 },
      isCheckInDue: true,
      isQuietTwoWeeks: false,
      isStalled: false,
    });
    expect(companyRow.topOutcomes).toEqual([
      'Deck sent to Siemens sponsor',
      'Acme approved expansion scope',
    ]);
    expect('weeklyTimeMinutes' in companyRow).toBe(false);

    const stalledRow = review.goalReviews[1];
    expect(stalledRow).toMatchObject({
      goalId: stalledCompanyGoal.id,
      isCheckInDue: false,
      isQuietTwoWeeks: false,
      isStalled: true,
    });

    const quietRow = review.goalReviews[2];
    expect(quietRow).toMatchObject({
      goalId: quietPersonalGoal.id,
      kind: 'personal',
      focusMinutes: 0,
      blockCount: 0,
      isCheckInDue: false,
      isQuietTwoWeeks: true,
      isStalled: true,
    });

    // Opening sentences populated and non-empty
    expect(review.chapterOpeningSentences.week).toContain('4h 30m focus');
    expect(review.chapterOpeningSentences.progress).toContain('Generate upsells moved twice');
    expect(review.chapterOpeningSentences.progress).toContain('Write technical essays got no time');
    expect(review.chapterOpeningSentences.time.length).toBeGreaterThan(0);
    expect(review.chapterOpeningSentences.nextWeek.length).toBeGreaterThan(0);
  });

  it('getWeeklyReview groups projects into More than planned, Less than planned, Wanted but untouched, Time without a plan (> 60m), and On track (±20%) with 4-week sparklines', () => {
    const mon = '2026-11-23';
    const prevMon = '2026-11-16';
    const friNow = '2026-11-27T17:00:00.000Z';

    const overProj = createProject(veyraDb, { name: 'LioCare', weeklyTimeMinutes: 120 }); // 240m -> +120m (over)
    const underProj = createProject(veyraDb, { name: 'Veyra', weeklyTimeMinutes: 240 }); // 60m -> -180m (under)
    const untouchedProj = createProject(veyraDb, { name: 'Read Offer', weeklyTimeMinutes: 120 }); // 0m (untouched)
    const unplannedOver60 = createProject(veyraDb, { name: 'Covestro', weeklyTimeMinutes: null }); // 90m (time_without_plan)
    const unplannedSmall = createProject(veyraDb, { name: 'Tiny Admin', weeklyTimeMinutes: null }); // 30m (unplanned -> omitted)
    const onTrackProj = createProject(veyraDb, { name: 'Core API', weeklyTimeMinutes: 120 }); // 130m (+8% -> on_track)

    const logForProject = (projectId: string, date: string, startHour: number, minutes: number) => {
      const blk = createBlock(
        veyraDb,
        { title: `Work ${date}`, projectId, bucket: 'scheduled', scheduledDate: date },
        { now: `${date}T08:00:00.000Z` },
      );
      const startH = String(startHour).padStart(2, '0');
      const totalEndMins = startHour * 60 + minutes;
      const endHour = Math.floor(totalEndMins / 60);
      const endMin = totalEndMins % 60;
      const hh = String(endHour).padStart(2, '0');
      const mm = String(endMin).padStart(2, '0');
      logManualSession(veyraDb, {
        blockId: blk.id,
        startedAt: `${date}T${startH}:00:00.000Z`,
        endedAt: `${date}T${hh}:${mm}:00.000Z`,
      });
    };

    logForProject(overProj.id, prevMon, 9, 60);
    logForProject(overProj.id, mon, 9, 240);
    logForProject(underProj.id, '2026-11-24', 9, 60);
    logForProject(unplannedOver60.id, '2026-11-25', 9, 90);
    logForProject(unplannedSmall.id, '2026-11-25', 11, 30);
    logForProject(onTrackProj.id, '2026-11-26', 9, 130);

    const review = getWeeklyReview(veyraDb, mon, friNow);

    expect(review.projectBuckets.moreThanPlanned.map((p) => p.projectId)).toEqual([overProj.id]);
    expect(review.projectBuckets.moreThanPlanned[0]).toMatchObject({
      projectId: overProj.id,
      weeklyTimeMinutes: 120,
      realMinutes: 240,
      differenceMinutes: 120,
      varianceStatus: 'over',
      trend4w: [0, 0, 60, 240],
    });

    expect(review.projectBuckets.lessThanPlanned.map((p) => p.projectId)).toEqual([underProj.id]);
    expect(review.projectBuckets.lessThanPlanned[0]).toMatchObject({
      differenceMinutes: -180,
      varianceStatus: 'under',
    });

    expect(review.projectBuckets.wantedUntouched.map((p) => p.projectId)).toEqual([untouchedProj.id]);
    expect(review.projectBuckets.timeWithoutPlan.map((p) => p.projectId)).toEqual([unplannedOver60.id]);
    expect(review.projectBuckets.onTrack.map((p) => p.projectId)).toEqual([onTrackProj.id]);

    // unplannedSmall (<= 60m, no weeklyTimeMinutes) is omitted from all 5 buckets
    const allBucketIds = [
      ...review.projectBuckets.moreThanPlanned,
      ...review.projectBuckets.lessThanPlanned,
      ...review.projectBuckets.wantedUntouched,
      ...review.projectBuckets.timeWithoutPlan,
      ...review.projectBuckets.onTrack,
    ].map((p) => p.projectId);
    expect(allBucketIds).not.toContain(unplannedSmall.id);

    expect(review.chapterOpeningSentences.time).toContain('LioCare took 2h more than planned');
    expect(review.chapterOpeningSentences.time).toContain('Veyra took 3h less than planned');
  });

  it('getWeeklyReview emits up to 3 planningFindings once >= 3 weeks of data exist (Overplanning, Size drift, Dropped without consequence, Motion hot spots, Goal neglect)', () => {
    const w1 = '2026-11-02';
    const w2 = '2026-11-09';
    const w3 = '2026-11-16';
    const w4 = '2026-11-23';
    const friW4 = '2026-11-27T17:00:00.000Z';

    const neglectedGoal = createGoal(
      veyraDb,
      { name: 'Customer Communication', kind: 'company' },
      { now: `${w1}T08:00:00.000Z` },
    );
    const driftProj = createProject(veyraDb, { name: 'LioCare' }, { now: `${w1}T08:00:00.000Z` });
    const motionProj = createProject(veyraDb, { name: 'Covestro' }, { now: `${w1}T08:00:00.000Z` });

    // Only 2 weeks of data so far -> findings MUST be empty
    const earlyB1 = createBlock(
      veyraDb,
      { title: 'W1 task', projectId: driftProj.id, bucket: 'scheduled', scheduledDate: w1, sizeMinutes: 60 },
      { now: `${w1}T08:00:00.000Z` },
    );
    logManualSession(veyraDb, {
      blockId: earlyB1.id,
      startedAt: `${w1}T09:00:00.000Z`,
      endedAt: `${w1}T11:00:00.000Z`, // 120m actual vs 60m planned (+100% drift)
    });
    completeBlock(veyraDb, earlyB1.id, { senseSignal: 'moved' }, `${w1}T11:00:00.000Z`);

    const earlyB2 = createBlock(
      veyraDb,
      { title: 'W2 task', projectId: driftProj.id, bucket: 'scheduled', scheduledDate: w2, sizeMinutes: 60 },
      { now: `${w2}T08:00:00.000Z` },
    );
    logManualSession(veyraDb, {
      blockId: earlyB2.id,
      startedAt: `${w2}T09:00:00.000Z`,
      endedAt: `${w2}T11:00:00.000Z`,
    });
    completeBlock(veyraDb, earlyB2.id, { senseSignal: 'moved' }, `${w2}T11:00:00.000Z`);

    const reviewAt2Weeks = getWeeklyReview(veyraDb, w2, '2026-11-13T17:00:00.000Z');
    expect(reviewAt2Weeks.planningFindings).toEqual([]);

    // Add 3rd week of data -> unlocks findings (size_drift + goal_neglect)
    const w3B = createBlock(
      veyraDb,
      { title: 'W3 task', projectId: driftProj.id, bucket: 'scheduled', scheduledDate: w3, sizeMinutes: 60 },
      { now: `${w3}T08:00:00.000Z` },
    );
    logManualSession(veyraDb, {
      blockId: w3B.id,
      startedAt: `${w3}T09:00:00.000Z`,
      endedAt: `${w3}T11:00:00.000Z`,
    });
    completeBlock(veyraDb, w3B.id, { senseSignal: 'moved' }, `${w3}T11:00:00.000Z`);

    const reviewAt3Weeks = getWeeklyReview(veyraDb, w3, '2026-11-20T17:00:00.000Z');
    expect(reviewAt3Weeks.planningFindings.some((f) => f.kind === 'size_drift')).toBe(true);
    expect(reviewAt3Weeks.planningFindings.some((f) => f.kind === 'goal_neglect')).toBe(true);

    // Add Overplanning (4 days in W4 planned > room), Dropped without consequence (3 drops), and Motion hot spot (3 motion blocks on Covestro)
    for (const day of ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26']) {
      for (let i = 0; i < 3; i++) {
        createBlock(
          veyraDb,
          { title: `Overplan ${day} #${i}`, projectId: driftProj.id, bucket: 'scheduled', scheduledDate: day, sizeMinutes: 120 },
          { now: `${day}T08:00:00.000Z` },
        );
      }
    }

    for (let i = 0; i < 3; i++) {
      const dropMe = createBlock(
        veyraDb,
        { title: `Cleanup #${i}`, projectId: motionProj.id, bucket: 'scheduled', scheduledDate: w4 },
        { now: `${w4}T08:00:00.000Z` },
      );
      dropBlock(veyraDb, dropMe.id, { dropReason: 'not_important', now: `${w4}T12:00:00.000Z` });

      const motionBlk = createBlock(
        veyraDb,
        { title: `Motion #${i}`, projectId: motionProj.id, bucket: 'scheduled', scheduledDate: w4 },
        { now: `${w4}T08:00:00.000Z` },
      );
      completeBlock(veyraDb, motionBlk.id, { senseSignal: 'motion' }, `${w4}T15:00:00.000Z`);
    }

    const reviewW4 = getWeeklyReview(veyraDb, w4, friW4);
    expect(reviewW4.planningFindings.length).toBeGreaterThan(0);
    expect(reviewW4.planningFindings.length).toBeLessThanOrEqual(3);
    expect(reviewW4.ruleSuggestions.length).toBeGreaterThan(0);
    expect(reviewW4.ruleSuggestions.length).toBeLessThanOrEqual(3);
    expect(neglectedGoal.id).toBeTruthy();

    // Verify each of the remaining 3 finding detectors individually on fresh DBs
    // 1) motion_hot_spot + dropped_without_consequence
    const db2 = openVeyraDb(':memory:');
    try {
      updateSettings(db2, { timezone: 'Europe/Berlin' });
      const p2 = createProject(db2, { name: 'Covestro' }, { now: `${w1}T08:00:00.000Z` });
      for (const d of [w1, w2, w3]) {
        const mb = createBlock(db2, { title: `M ${d}`, projectId: p2.id, bucket: 'scheduled', scheduledDate: d }, { now: `${d}T08:00:00.000Z` });
        completeBlock(db2, mb.id, { senseSignal: 'motion' }, `${d}T10:00:00.000Z`);
        const dr = createBlock(db2, { title: `D ${d}`, projectId: p2.id, bucket: 'scheduled', scheduledDate: d }, { now: `${d}T08:00:00.000Z` });
        dropBlock(db2, dr.id, { dropReason: 'not_important', now: `${d}T11:00:00.000Z` });
      }
      const r2 = getWeeklyReview(db2, w3, '2026-11-20T17:00:00.000Z');
      expect(r2.planningFindings.map((f) => f.kind)).toContain('motion_hot_spot');
      expect(r2.planningFindings.map((f) => f.kind)).toContain('dropped_without_consequence');
    } finally {
      db2.close();
    }

    // 2) overplanning
    const db3 = openVeyraDb(':memory:');
    try {
      updateSettings(db3, { timezone: 'Europe/Berlin' });
      const p3 = createProject(db3, { name: 'Engine' }, { now: `${w1}T08:00:00.000Z` });
      for (const d of [w1, w2, w3]) {
        const b = createBlock(db3, { title: `Log ${d}`, projectId: p3.id, bucket: 'scheduled', scheduledDate: d }, { now: `${d}T08:00:00.000Z` });
        logManualSession(db3, { blockId: b.id, startedAt: `${d}T09:00:00.000Z`, endedAt: `${d}T10:00:00.000Z` });
      }
      for (const day of ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19']) {
        for (let i = 0; i < 3; i++) {
          createBlock(db3, { title: `Big ${day} ${i}`, projectId: p3.id, bucket: 'scheduled', scheduledDate: day, sizeMinutes: 120 }, { now: `${day}T08:00:00.000Z` });
        }
      }
      const r3 = getWeeklyReview(db3, w3, '2026-11-20T17:00:00.000Z');
      expect(r3.planningFindings.map((f) => f.kind)).toContain('overplanning');
    } finally {
      db3.close();
    }
  });

  it('completeWeeklyReview updates project weekly times, persists completedAt and snapshotJson, and reopenWeeklyReview clears completedAt', () => {
    const mon = '2026-11-16'; // ISO week 47
    const completedNow = '2026-11-20T16:30:00.000Z';

    const goal = createGoal(veyraDb, { name: 'Ship v2', kind: 'company', measure: '2 of 5' });
    const proj = createProject(veyraDb, { name: 'Veyra Core', weeklyTimeMinutes: 180, defaultGoalId: goal.id });

    const b1 = createBlock(
      veyraDb,
      { title: 'Review engine', projectId: proj.id, goalId: goal.id, bucket: 'scheduled', scheduledDate: mon },
      { now: `${mon}T08:00:00.000Z` },
    );
    logManualSession(veyraDb, {
      blockId: b1.id,
      startedAt: `${mon}T09:00:00.000Z`,
      endedAt: `${mon}T11:00:00.000Z`,
    });
    completeBlock(veyraDb, b1.id, { senseSignal: 'moved', outcomeNote: 'Engine ready' }, `${mon}T11:00:00.000Z`);

    const completed = completeWeeklyReview(
      veyraDb,
      {
        weekStartDate: mon,
        ruleForNextWeek: 'Protect Tuesday mornings for Veyra Core',
        previousRuleKept: 'yes',
        notes: 'Good momentum',
        projectWeeklyTimes: { [proj.id]: 300 },
      },
      { now: completedNow },
    );

    expect(completed.review.completedAt).toBe(completedNow);
    expect(completed.review.previousRuleKept).toBe('yes');
    expect(completed.review.ruleForNextWeek).toBe('Protect Tuesday mornings for Veyra Core');
    expect(completed.review.snapshotJson).toBeTruthy();

    // Project weeklyTimeMinutes was updated inline in the same transaction
    expect(getProject(veyraDb, proj.id, completedNow).weeklyTimeMinutes).toBe(300);

    // Snapshot & getWeeklyReview match
    expect(completed.snapshot).toMatchObject({
      weekStartDate: mon,
      weekNumber: 47,
      completedAt: completedNow,
      totalFocusMinutes: 120,
      ruleForNextWeek: 'Protect Tuesday mornings for Veyra Core',
      previousRuleKept: 'yes',
    });
    expect(completed.snapshot.projectWeeklyTimes).toEqual([
      { projectId: proj.id, name: 'Veyra Core', weeklyTimeMinutes: 300, realMinutes: 120 },
    ]);
    expect(completed.snapshot.goalsMoved).toHaveLength(1);
    expect(completed.snapshot.goalsMoved[0]).toMatchObject({
      goalId: goal.id,
      focusMinutes: 120,
      movedCount: 1,
      measure: '2 of 5',
    });

    const fetched = getWeeklyReview(veyraDb, mon, completedNow);
    expect(fetched.completedAt).toBe(completedNow);
    expect(fetched.snapshot).toEqual(completed.snapshot);

    // Reopen clears completedAt while preserving ruleForNextWeek and previousRuleKept
    const reopened = reopenWeeklyReview(veyraDb, mon, { now: '2026-11-20T17:00:00.000Z' });
    expect(reopened.completedAt).toBeNull();
    expect(reopened.ruleForNextWeek).toBe('Protect Tuesday mornings for Veyra Core');
    expect(reopened.previousRuleKept).toBe('yes');

    const afterReopen = getWeeklyReview(veyraDb, mon, '2026-11-20T17:00:00.000Z');
    expect(afterReopen.completedAt).toBeNull();
    expect(afterReopen.snapshot).toBeNull();
  });

  it('handles empty weeks cleanly, preserves ruleForNextWeek on setPreviousRuleKept, and resolves ISO year boundaries', () => {
    // 2027-01-01 (Friday) belongs to ISO week 53 of 2026
    expect(getIsoWeekNumber('2027-01-01')).toEqual({ isoYear: 2026, isoWeek: 53 });
    expect(resolveIsoWeekStartDate(53, '2027-01-01')).toBe('2026-12-28');
    expect(getIsoWeekNumber('2027-01-04')).toEqual({ isoYear: 2027, isoWeek: 1 });

    // Empty week on fresh DB
    const empty = getWeeklyReview(veyraDb, '2026-03-23', '2026-03-27T17:00:00.000Z'); // DST week in Europe/Berlin
    expect(empty.weekNumber).toBe(13);
    expect(empty.totalFocusMinutes).toBe(0);
    expect(empty.dayStrip).toHaveLength(5);
    expect(empty.goalReviews).toEqual([]);
    expect(empty.planningFindings).toEqual([]);
    expect(empty.chapterOpeningSentences.week).toBe('No focus time logged this week yet.');
    expect(empty.chapterOpeningSentences.progress).toBe('No active goals to track this week.');
    expect(empty.chapterOpeningSentences.time).toBe('No project time variance to flag this week.');
    expect(empty.chapterOpeningSentences.nextWeek).toBe('One rule to pick.');

    // setPreviousRuleKept does not clobber existing ruleForNextWeek
    setWeeklyRule(veyraDb, '2026-03-23', 'Keep mornings clear');
    const kept = setPreviousRuleKept(veyraDb, '2026-03-23', 'yes');
    expect(kept.ruleForNextWeek).toBe('Keep mornings clear');
    expect(kept.previousRuleKept).toBe('yes');
  });
});
