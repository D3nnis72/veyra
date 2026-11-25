import crypto from 'node:crypto';
import { and, asc, desc, eq, gte, isNotNull, isNull, lte } from 'drizzle-orm';
import type { VeyraDb } from '../db.js';
import { NotFoundError, parseWithZod } from '../errors.js';
import {
  blocks,
  calendarEvents,
  dailyNotes,
  focusSessions,
  goals,
  projects,
  weeklyReviews,
} from '../schema.js';
import {
  addDaysToDateString,
  formatLocalDate,
  getIsoWeekNumber,
  getLocalDayBoundsIso,
  getWeekRange,
} from '../time.js';
import {
  type ActiveWeeklyRuleResult,
  type ActivityActor,
  type Block,
  type ChapterOpeningSentences,
  type CompleteWeeklyReviewInput,
  type CompleteWeeklyReviewResult,
  type CreateDailyNoteInput,
  type DailyNote,
  type EnergyCounts,
  type Goal,
  type GoalReviewItem,
  type ListDailyNotesFilter,
  type OpsRadarItem,
  type PlanningFinding,
  type ProgressFeedItem,
  type Project,
  type ProjectReviewBucketItem,
  type ProjectReviewBuckets,
  type ProjectVarianceStatus,
  type ReviewDayStripItem,
  type RuleKept,
  SYSTEM_OTHER_PROJECT_ID,
  type SenseCounts,
  type UpdateDailyNoteInput,
  type WeeklyReview,
  type WeeklyReviewSnapshot,
  type WeeklyReviewSummary,
  completeWeeklyReviewInputSchema,
  createDailyNoteInputSchema,
  dateOnlySchema,
  ruleKeptSchema,
  updateDailyNoteInputSchema,
} from '../types.js';
import { computeProjectSizeStatsMap, computeWeekdayRoom } from './capacity.js';
import { updateProject } from './goals-projects.js';
import {
  type ServiceMutationOptions,
  computeOverlapMs,
  getActiveTimezone,
  msToRoundedMinutes,
  recordActivity,
  resolveActor,
  resolveNow,
} from './internal.js';

function ensureActiveProjectExists(veyraDb: VeyraDb, projectId: string): void {
  const row = veyraDb.db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    .get();
  if (!row) {
    throw new NotFoundError(`Project '${projectId}' not found`);
  }
}

function ensureActiveGoalExists(veyraDb: VeyraDb, goalId: string): void {
  const row = veyraDb.db
    .select({ id: goals.id })
    .from(goals)
    .where(and(eq(goals.id, goalId), isNull(goals.deletedAt)))
    .get();
  if (!row) {
    throw new NotFoundError(`Goal '${goalId}' not found`);
  }
}

function getActiveDailyNoteOrThrow(veyraDb: VeyraDb, id: string): DailyNote {
  const row = veyraDb.db
    .select()
    .from(dailyNotes)
    .where(and(eq(dailyNotes.id, id), isNull(dailyNotes.deletedAt)))
    .get();
  if (!row) {
    throw new NotFoundError(`DailyNote '${id}' not found`);
  }
  return row;
}

// ---------------------------------------------------------------------------
// Daily Notes
// ---------------------------------------------------------------------------

export function addDailyNote(
  veyraDb: VeyraDb,
  input: CreateDailyNoteInput,
  now?: Date | string,
  options?: { actor?: ActivityActor },
): DailyNote {
  const parsed = parseWithZod(createDailyNoteInputSchema, input);
  const nowDate = resolveNow(now);
  const nowIso = nowDate.toISOString();
  const actor = resolveActor(options?.actor);
  const timezone = getActiveTimezone(veyraDb);
  const date = parsed.date ?? formatLocalDate(nowDate, timezone);

  if (parsed.projectId) {
    ensureActiveProjectExists(veyraDb, parsed.projectId);
  }
  if (parsed.goalId) {
    ensureActiveGoalExists(veyraDb, parsed.goalId);
  }

  const note: DailyNote = {
    id: crypto.randomUUID(),
    date,
    content: parsed.content,
    projectId: parsed.projectId ?? null,
    goalId: parsed.goalId ?? null,
    isOps: parsed.isOps,
    createdAt: nowIso,
    updatedAt: nowIso,
    deletedAt: null,
  };

  veyraDb.sqlite.transaction(() => {
    veyraDb.db.insert(dailyNotes).values(note).run();
    recordActivity(veyraDb, actor, 'daily_note.created', `Added daily note for ${date}`, nowIso);
  })();

  return note;
}

export function listDailyNotes(
  veyraDb: VeyraDb,
  filters?: ListDailyNotesFilter,
): DailyNote[] {
  const conditions = [isNull(dailyNotes.deletedAt)];

  if (filters?.date) {
    parseWithZod(dateOnlySchema, filters.date);
    conditions.push(eq(dailyNotes.date, filters.date));
  } else if (filters?.weekStartDate) {
    parseWithZod(dateOnlySchema, filters.weekStartDate);
    const { weekStartDate, weekEndDate } = getWeekRange(filters.weekStartDate);
    conditions.push(gte(dailyNotes.date, weekStartDate));
    conditions.push(lte(dailyNotes.date, weekEndDate));
  }

  if (filters?.projectId) {
    conditions.push(eq(dailyNotes.projectId, filters.projectId));
  }
  if (filters?.goalId) {
    conditions.push(eq(dailyNotes.goalId, filters.goalId));
  }

  return veyraDb.db
    .select()
    .from(dailyNotes)
    .where(and(...conditions))
    .orderBy(asc(dailyNotes.date), asc(dailyNotes.createdAt))
    .all();
}

export function updateDailyNote(
  veyraDb: VeyraDb,
  id: string,
  input: UpdateDailyNoteInput,
  options?: ServiceMutationOptions,
): DailyNote {
  const existing = getActiveDailyNoteOrThrow(veyraDb, id);
  const parsed = parseWithZod(updateDailyNoteInputSchema, input);
  const nowIso = resolveNow(options?.now).toISOString();
  const actor = resolveActor(options?.actor);

  if (parsed.projectId !== undefined && parsed.projectId !== null) {
    ensureActiveProjectExists(veyraDb, parsed.projectId);
  }
  if (parsed.goalId !== undefined && parsed.goalId !== null) {
    ensureActiveGoalExists(veyraDb, parsed.goalId);
  }

  const updated: DailyNote = {
    ...existing,
    content: parsed.content ?? existing.content,
    date: parsed.date ?? existing.date,
    projectId: parsed.projectId !== undefined ? parsed.projectId : existing.projectId,
    goalId: parsed.goalId !== undefined ? parsed.goalId : existing.goalId,
    isOps: parsed.isOps ?? existing.isOps,
    updatedAt: nowIso,
  };

  veyraDb.sqlite.transaction(() => {
    veyraDb.db
      .update(dailyNotes)
      .set({
        content: updated.content,
        date: updated.date,
        projectId: updated.projectId,
        goalId: updated.goalId,
        isOps: updated.isOps,
        updatedAt: updated.updatedAt,
      })
      .where(eq(dailyNotes.id, id))
      .run();
    recordActivity(
      veyraDb,
      actor,
      'daily_note.updated',
      `Updated daily note for ${updated.date}`,
      nowIso,
    );
  })();

  return updated;
}

export function deleteDailyNote(
  veyraDb: VeyraDb,
  id: string,
  options?: ServiceMutationOptions,
): DailyNote {
  const existing = getActiveDailyNoteOrThrow(veyraDb, id);
  const nowIso = resolveNow(options?.now).toISOString();
  const actor = resolveActor(options?.actor);

  const deleted: DailyNote = {
    ...existing,
    updatedAt: nowIso,
    deletedAt: nowIso,
  };

  veyraDb.sqlite.transaction(() => {
    veyraDb.db
      .update(dailyNotes)
      .set({ deletedAt: nowIso, updatedAt: nowIso })
      .where(eq(dailyNotes.id, id))
      .run();
    recordActivity(
      veyraDb,
      actor,
      'daily_note.deleted',
      `Deleted daily note for ${existing.date}`,
      nowIso,
    );
  })();

  return deleted;
}

// ---------------------------------------------------------------------------
// Weekly Review & Rules
// ---------------------------------------------------------------------------

const WEEKDAY_SHORT_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] as const;
const DEFAULT_BLOCK_SIZE_MINUTES = 60;
const MIN_FINDINGS_WEEKS = 3;
const MAX_PLANNING_FINDINGS = 3;
const MIN_SIZE_DRIFT_PCT = 25;
const MIN_DROPPED_FINDING_COUNT = 3;
const MIN_MOTION_FINDING_SAMPLES = 3;
const MOTION_FINDING_RATIO = 0.6;

function formatHoursMinutes(minutes: number): string {
  const abs = Math.max(0, Math.round(Math.abs(minutes)));
  if (abs === 0) return '0m';
  if (abs < 60) return `${abs}m`;
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function capitalizeFirst(sentence: string): string {
  if (!sentence) return sentence;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

function computeVarianceStatusForReview(
  realMinutes: number,
  weeklyTimeMinutes: number | null,
): ProjectVarianceStatus {
  if (weeklyTimeMinutes !== null) {
    if (realMinutes === 0) return 'untouched';
    if (realMinutes > weeklyTimeMinutes * 1.2) return 'over';
    if (realMinutes < weeklyTimeMinutes * 0.8) return 'under';
    return 'on_track';
  }
  return realMinutes > 60 ? 'time_without_plan' : 'unplanned';
}

function parseWeeklyReviewSnapshot(raw: string | null): WeeklyReviewSnapshot | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as WeeklyReviewSnapshot;
  } catch {
    return null;
  }
}

export function getWeeklyReviewRecord(
  veyraDb: VeyraDb,
  weekStartDate: string,
): WeeklyReview | null {
  parseWithZod(dateOnlySchema, weekStartDate);
  const { weekStartDate: normalizedStart } = getWeekRange(weekStartDate);
  const row = veyraDb.db
    .select()
    .from(weeklyReviews)
    .where(
      and(
        eq(weeklyReviews.weekStartDate, normalizedStart),
        isNull(weeklyReviews.deletedAt),
      ),
    )
    .get();
  return row ?? null;
}

export function setWeeklyRule(
  veyraDb: VeyraDb,
  weekStartDate: string,
  ruleForNextWeek: string,
  options?: { notes?: string; previousRuleKept?: RuleKept | null } & ServiceMutationOptions,
): WeeklyReview {
  parseWithZod(dateOnlySchema, weekStartDate);
  const parsedKept =
    options?.previousRuleKept !== undefined
      ? parseWithZod(ruleKeptSchema.nullable(), options.previousRuleKept)
      : undefined;
  const { weekStartDate: normalizedStart } = getWeekRange(weekStartDate);
  const nowIso = resolveNow(options?.now).toISOString();
  const actor = resolveActor(options?.actor);

  const existing = veyraDb.db
    .select()
    .from(weeklyReviews)
    .where(eq(weeklyReviews.weekStartDate, normalizedStart))
    .get();

  let result: WeeklyReview;

  veyraDb.sqlite.transaction(() => {
    if (existing) {
      result = {
        ...existing,
        ruleForNextWeek,
        previousRuleKept:
          parsedKept !== undefined ? parsedKept : existing.previousRuleKept,
        notes: options?.notes !== undefined ? options.notes : existing.notes,
        updatedAt: nowIso,
        deletedAt: null,
      };
      veyraDb.db
        .update(weeklyReviews)
        .set({
          ruleForNextWeek: result.ruleForNextWeek,
          previousRuleKept: result.previousRuleKept,
          notes: result.notes,
          updatedAt: result.updatedAt,
          deletedAt: null,
        })
        .where(eq(weeklyReviews.id, existing.id))
        .run();
    } else {
      result = {
        id: crypto.randomUUID(),
        weekStartDate: normalizedStart,
        ruleForNextWeek,
        previousRuleKept: parsedKept ?? null,
        notes: options?.notes ?? '',
        completedAt: null,
        snapshotJson: null,
        updatedAt: nowIso,
        deletedAt: null,
      };
      veyraDb.db.insert(weeklyReviews).values(result).run();
    }

    recordActivity(
      veyraDb,
      actor,
      'weekly_review.rule_set',
      `Set weekly rule for week of ${normalizedStart}`,
      nowIso,
    );
  })();

  return result!;
}

export function setPreviousRuleKept(
  veyraDb: VeyraDb,
  weekStartDate: string,
  previousRuleKept: RuleKept | null,
  options?: ServiceMutationOptions,
): WeeklyReview {
  parseWithZod(dateOnlySchema, weekStartDate);
  const parsedKept = parseWithZod(ruleKeptSchema.nullable(), previousRuleKept);
  const { weekStartDate: normalizedStart } = getWeekRange(weekStartDate);
  const nowIso = resolveNow(options?.now).toISOString();
  const actor = resolveActor(options?.actor);

  const existing = veyraDb.db
    .select()
    .from(weeklyReviews)
    .where(eq(weeklyReviews.weekStartDate, normalizedStart))
    .get();

  let result: WeeklyReview;

  veyraDb.sqlite.transaction(() => {
    if (existing) {
      result = {
        ...existing,
        previousRuleKept: parsedKept,
        updatedAt: nowIso,
        deletedAt: null,
      };
      veyraDb.db
        .update(weeklyReviews)
        .set({
          previousRuleKept: result.previousRuleKept,
          updatedAt: result.updatedAt,
          deletedAt: null,
        })
        .where(eq(weeklyReviews.id, existing.id))
        .run();
    } else {
      result = {
        id: crypto.randomUUID(),
        weekStartDate: normalizedStart,
        ruleForNextWeek: '',
        previousRuleKept: parsedKept,
        notes: '',
        completedAt: null,
        snapshotJson: null,
        updatedAt: nowIso,
        deletedAt: null,
      };
      veyraDb.db.insert(weeklyReviews).values(result).run();
    }

    recordActivity(
      veyraDb,
      actor,
      'weekly_review.rule_kept_set',
      `Marked previous weekly rule as ${parsedKept ?? 'unset'} for week of ${normalizedStart}`,
      nowIso,
    );
  })();

  return result!;
}

export function getActiveWeeklyRule(
  veyraDb: VeyraDb,
  dateStr?: string,
  now?: Date | string,
): ActiveWeeklyRuleResult {
  const timezone = getActiveTimezone(veyraDb);
  const targetDate = dateStr
    ? parseWithZod(dateOnlySchema, dateStr)
    : formatLocalDate(resolveNow(now), timezone);
  const { weekStartDate } = getWeekRange(targetDate);
  const prevWeekStart = addDaysToDateString(weekStartDate, -7);

  const activeRule = getWeeklyReviewRecord(veyraDb, prevWeekStart);
  const nextWeekRule = getWeeklyReviewRecord(veyraDb, weekStartDate);

  return {
    weekStartDate,
    activeRule,
    nextWeekRule,
    activeRuleText: activeRule?.ruleForNextWeek ?? null,
  };
}

function buildChapterOpeningSentences(params: {
  totalFocusMinutes: number;
  roomMinutesTotal: number;
  goalAlignmentPct: number;
  goalReviews: GoalReviewItem[];
  projectBuckets: ProjectReviewBuckets;
  projectById: ReadonlyMap<string, Project>;
  chronicCarryoversCount: number;
  pastRevisitLaterCount: number;
  hasRuleForNextWeek: boolean;
}): ChapterOpeningSentences {
  const {
    totalFocusMinutes,
    roomMinutesTotal,
    goalAlignmentPct,
    goalReviews,
    projectBuckets,
    projectById,
    chronicCarryoversCount,
    pastRevisitLaterCount,
    hasRuleForNextWeek,
  } = params;

  // Chapter 1: What happened?
  let weekSentence: string;
  if (totalFocusMinutes === 0) {
    weekSentence = 'No focus time logged this week yet.';
  } else {
    let roomPhrase = '';
    if (roomMinutesTotal > 0) {
      const diff = totalFocusMinutes - roomMinutesTotal;
      if (Math.abs(diff) < 15) {
        roomPhrase = ', right on your room';
      } else if (diff > 0) {
        roomPhrase = `, ${formatHoursMinutes(diff)} over your room`;
      } else {
        roomPhrase = `, ${formatHoursMinutes(Math.abs(diff))} under your room`;
      }
    }
    weekSentence = `${formatHoursMinutes(totalFocusMinutes)} focus${roomPhrase}, ${goalAlignmentPct}% on goals.`;
  }

  // Chapter 2: What moved?
  let progressSentence: string;
  if (goalReviews.length === 0) {
    progressSentence = 'No active goals to track this week.';
  } else {
    const movedGoals = goalReviews
      .filter((g) => g.senseCounts.moved > 0)
      .sort((a, b) => b.senseCounts.moved - a.senseCounts.moved || b.focusMinutes - a.focusMinutes);
    const focusedGoals = goalReviews
      .filter((g) => g.focusMinutes > 0)
      .sort((a, b) => b.focusMinutes - a.focusMinutes);
    const quietGoals = goalReviews
      .filter((g) => g.focusMinutes === 0)
      .sort((a, b) => Number(b.isQuietTwoWeeks) - Number(a.isQuietTwoWeeks));

    const parts: string[] = [];
    let leadGoalId: string | null = null;
    if (movedGoals.length > 0) {
      const top = movedGoals[0];
      leadGoalId = top.goalId;
      const countText =
        top.senseCounts.moved === 1
          ? 'once'
          : top.senseCounts.moved === 2
            ? 'twice'
            : `${top.senseCounts.moved} times`;
      parts.push(`${top.name} moved ${countText}`);
    } else if (focusedGoals.length > 0) {
      const top = focusedGoals[0];
      leadGoalId = top.goalId;
      parts.push(`${top.name} led with ${formatHoursMinutes(top.focusMinutes)}`);
    }

    const quiet = quietGoals.find((g) => g.goalId !== leadGoalId);
    if (quiet) {
      parts.push(`${quiet.name} got no time`);
    }

    progressSentence =
      parts.length > 0 ? `${parts.join(', ')}.` : 'No goal progress logged this week yet.';
  }

  // Chapter 3: Where did the time go?
  let timeSentence: string;
  const timeParts: string[] = [];
  if (projectBuckets.moreThanPlanned.length > 0) {
    const top = projectBuckets.moreThanPlanned[0];
    const name = projectById.get(top.projectId)?.name ?? 'A project';
    timeParts.push(`${name} took ${formatHoursMinutes(top.differenceMinutes ?? 0)} more than planned`);
  }
  if (projectBuckets.lessThanPlanned.length > 0) {
    const top = projectBuckets.lessThanPlanned[0];
    const name = projectById.get(top.projectId)?.name ?? 'A project';
    timeParts.push(`${name} took ${formatHoursMinutes(Math.abs(top.differenceMinutes ?? 0))} less than planned`);
  }
  if (timeParts.length > 0) {
    timeSentence = `${timeParts.join(', ')}.`;
  } else if (projectBuckets.wantedUntouched.length > 0) {
    const top = projectBuckets.wantedUntouched[0];
    const name = projectById.get(top.projectId)?.name ?? 'A project';
    timeSentence = `${name} was planned for ${formatHoursMinutes(top.weeklyTimeMinutes ?? 0)} but untouched.`;
  } else if (projectBuckets.timeWithoutPlan.length > 0) {
    const top = projectBuckets.timeWithoutPlan[0];
    const name = projectById.get(top.projectId)?.name ?? 'A project';
    timeSentence = `${name} took ${formatHoursMinutes(top.realMinutes)} without a weekly plan.`;
  } else if (projectBuckets.onTrack.length > 0) {
    const n = projectBuckets.onTrack.length;
    timeSentence = `All ${n} planned project${n === 1 ? '' : 's'} stayed on track.`;
  } else {
    timeSentence = 'No project time variance to flag this week.';
  }

  // Chapter 4: What changes next week?
  const nextParts: string[] = [];
  if (chronicCarryoversCount > 0) {
    nextParts.push(
      `${chronicCarryoversCount} carryover${chronicCarryoversCount === 1 ? '' : 's'} to decide`,
    );
  }
  if (pastRevisitLaterCount > 0) {
    nextParts.push(
      `${pastRevisitLaterCount} Later item${pastRevisitLaterCount === 1 ? '' : 's'} due`,
    );
  }
  nextParts.push(hasRuleForNextWeek ? "next week's rule is set" : 'one rule to pick');
  const nextWeekSentence = `${capitalizeFirst(nextParts.join(', '))}.`;

  return {
    week: weekSentence,
    progress: progressSentence,
    time: timeSentence,
    nextWeek: nextWeekSentence,
  };
}

export function getWeeklyReview(
  veyraDb: VeyraDb,
  weekStartDate?: string,
  now?: Date | string,
): WeeklyReviewSummary {
  const nowDate = resolveNow(now);
  const nowMs = nowDate.getTime();
  const timezone = getActiveTimezone(veyraDb);
  const today = formatLocalDate(nowDate, timezone);

  const targetDate = weekStartDate
    ? parseWithZod(dateOnlySchema, weekStartDate)
    : today;
  const { weekStartDate: start, weekEndDate: end } = getWeekRange(targetDate);
  const { isoWeek: weekNumber } = getIsoWeekNumber(start);

  const weekStartIso = getLocalDayBoundsIso(start, timezone).startIso;
  const weekEndIso = getLocalDayBoundsIso(end, timezone).endIso;
  const weekStartMs = Date.parse(weekStartIso);
  const weekEndMs = Date.parse(weekEndIso);

  const prevWeekStart = addDaysToDateString(start, -7);
  const prevWeekStartMs = Date.parse(getLocalDayBoundsIso(prevWeekStart, timezone).startIso);

  // Build 4 chronological week buckets ending at the target review week for 4-week sparklines
  const fourWeekBuckets: Array<{ weekStartDate: string; startMs: number; endMs: number }> = [];
  for (let i = 3; i >= 0; i--) {
    const wStart = addDaysToDateString(start, -i * 7);
    const wEnd = addDaysToDateString(wStart, 6);
    fourWeekBuckets.push({
      weekStartDate: wStart,
      startMs: Date.parse(getLocalDayBoundsIso(wStart, timezone).startIso),
      endMs: Date.parse(getLocalDayBoundsIso(wEnd, timezone).endIso),
    });
  }
  const fourWeekStartMs = fourWeekBuckets[0].startMs;
  const eightWeekStartDate = addDaysToDateString(start, -49);
  const eightWeekStartMs = Date.parse(getLocalDayBoundsIso(eightWeekStartDate, timezone).startIso);

  const allGoals = veyraDb.db
    .select()
    .from(goals)
    .where(isNull(goals.deletedAt))
    .orderBy(asc(goals.orderKey))
    .all();
  const goalById = new Map<string, Goal>();
  for (const g of allGoals) {
    goalById.set(g.id, g);
  }

  const allProjects = veyraDb.db
    .select()
    .from(projects)
    .where(isNull(projects.deletedAt))
    .all();
  const projectById = new Map<string, Project>();
  for (const p of allProjects) {
    projectById.set(p.id, p);
  }

  const allBlocks = veyraDb.db.select().from(blocks).all();
  const blockById = new Map<string, Block>();
  for (const blk of allBlocks) {
    blockById.set(blk.id, blk);
  }

  const allSessions = veyraDb.db
    .select()
    .from(focusSessions)
    .where(isNull(focusSessions.deletedAt))
    .all();

  const allActiveEvents = veyraDb.db
    .select()
    .from(calendarEvents)
    .where(isNull(calendarEvents.deletedAt))
    .all();

  let totalFocusMs = 0;
  let buildMs = 0;
  let opsMs = 0;
  let goalLinkedMs = 0;
  let companyGoalMs = 0;
  let personalGoalMs = 0;
  let pureOpsMs = 0;
  let goalLinkedOpsMs = 0;

  const weekMsByBlock = new Map<string, number>();
  const allTimeMsByBlock = new Map<string, number>();
  const weekMsByGoal = new Map<string, number>();
  const twoWeekMsByGoal = new Map<string, number>();
  const weekBlockIdsByGoal = new Map<string, Set<string>>();
  const weekBlockIdsByProject = new Map<string, Set<string>>();
  const fourWeekMsByProject = new Map<string, [number, number, number, number]>();
  const distinctActiveWeeks = new Set<string>();

  const addToSetMap = (map: Map<string, Set<string>>, key: string, value: string) => {
    let set = map.get(key);
    if (!set) {
      set = new Set<string>();
      map.set(key, set);
    }
    set.add(value);
  };

  for (const session of allSessions) {
    const sStart = Date.parse(session.startedAt);
    const sEnd = session.endedAt ? Date.parse(session.endedAt) : nowMs;
    if (sEnd > sStart) {
      allTimeMsByBlock.set(
        session.blockId,
        (allTimeMsByBlock.get(session.blockId) ?? 0) + (sEnd - sStart),
      );
      if (sStart < weekEndMs) {
        const sessionDate = formatLocalDate(session.startedAt, timezone);
        distinctActiveWeeks.add(getWeekRange(sessionDate).weekStartDate);
      }
    }

    const blk = blockById.get(session.blockId);
    if (!blk) {
      continue;
    }

    // 4-week project focus buckets (including target week at index 3)
    if (computeOverlapMs(sStart, sEnd, fourWeekStartMs, weekEndMs) > 0) {
      let arr = fourWeekMsByProject.get(blk.projectId);
      if (!arr) {
        arr = [0, 0, 0, 0];
        fourWeekMsByProject.set(blk.projectId, arr);
      }
      for (let i = 0; i < 4; i++) {
        const ov = computeOverlapMs(sStart, sEnd, fourWeekBuckets[i].startMs, fourWeekBuckets[i].endMs);
        if (ov > 0) {
          arr[i] += ov;
        }
      }
    }

    // 2-week goal focus window (for isQuietTwoWeeks)
    if (blk.goalId) {
      const twoWeekOv = computeOverlapMs(sStart, sEnd, prevWeekStartMs, weekEndMs);
      if (twoWeekOv > 0) {
        twoWeekMsByGoal.set(blk.goalId, (twoWeekMsByGoal.get(blk.goalId) ?? 0) + twoWeekOv);
      }
    }

    const overlapMs = computeOverlapMs(sStart, sEnd, weekStartMs, weekEndMs);
    if (overlapMs <= 0) {
      continue;
    }

    totalFocusMs += overlapMs;
    weekMsByBlock.set(blk.id, (weekMsByBlock.get(blk.id) ?? 0) + overlapMs);
    addToSetMap(weekBlockIdsByProject, blk.projectId, blk.id);

    if (blk.isOps) {
      opsMs += overlapMs;
      if (blk.goalId) {
        goalLinkedOpsMs += overlapMs;
      } else {
        pureOpsMs += overlapMs;
      }
    } else {
      buildMs += overlapMs;
    }

    if (blk.goalId) {
      goalLinkedMs += overlapMs;
      weekMsByGoal.set(blk.goalId, (weekMsByGoal.get(blk.goalId) ?? 0) + overlapMs);
      addToSetMap(weekBlockIdsByGoal, blk.goalId, blk.id);
      const goal = goalById.get(blk.goalId);
      if (goal?.kind === 'company') {
        companyGoalMs += overlapMs;
      } else if (goal?.kind === 'personal') {
        personalGoalMs += overlapMs;
      }
    }
  }

  const totalFocusMinutes = msToRoundedMinutes(totalFocusMs);
  const buildMinutes = msToRoundedMinutes(buildMs);
  const opsMinutes = msToRoundedMinutes(opsMs);
  const goalAlignmentPct =
    totalFocusMs > 0 ? Math.round((goalLinkedMs / totalFocusMs) * 100) : 0;
  const companyGoalMinutes = msToRoundedMinutes(companyGoalMs);
  const personalGoalMinutes = msToRoundedMinutes(personalGoalMs);
  const companyGoalPct =
    totalFocusMs > 0 ? Math.round((companyGoalMs / totalFocusMs) * 100) : 0;
  const personalGoalPct =
    totalFocusMs > 0 ? Math.round((personalGoalMs / totalFocusMs) * 100) : 0;

  // Completed / dropped blocks tracking
  const completedThisWeek: Block[] = [];
  const twoWeekCompletedGoalIds = new Set<string>();
  for (const blk of allBlocks) {
    if (blk.deletedAt !== null) continue;
    const updatedMs = Date.parse(blk.updatedAt);

    if ((blk.status === 'done' || blk.status === 'dropped') && updatedMs < weekEndMs) {
      const blockDate = formatLocalDate(blk.updatedAt, timezone);
      distinctActiveWeeks.add(getWeekRange(blockDate).weekStartDate);
    }

    if (blk.status === 'done') {
      if (blk.goalId && updatedMs >= prevWeekStartMs && updatedMs < weekEndMs) {
        twoWeekCompletedGoalIds.add(blk.goalId);
      }
      if (updatedMs >= weekStartMs && updatedMs < weekEndMs) {
        completedThisWeek.push(blk);
        addToSetMap(weekBlockIdsByProject, blk.projectId, blk.id);
        if (blk.goalId) {
          addToSetMap(weekBlockIdsByGoal, blk.goalId, blk.id);
        }
      }
    }
  }

  // Raw energy counts and sense counts (never a percentage for energy)
  const energyCounts: EnergyCounts = { up: 0, neutral: 0, down: 0 };
  const senseCounts: SenseCounts = { moved: 0, partly: 0, motion: 0 };
  for (const blk of completedThisWeek) {
    if (blk.energySignal === 'up') energyCounts.up++;
    else if (blk.energySignal === 'neutral') energyCounts.neutral++;
    else if (blk.energySignal === 'down') energyCounts.down++;

    if (blk.senseSignal === 'moved') senseCounts.moved++;
    else if (blk.senseSignal === 'partly') senseCounts.partly++;
    else if (blk.senseSignal === 'motion') senseCounts.motion++;
  }

  const worthSecondLook = completedThisWeek
    .filter((blk) => blk.senseSignal === 'partly' || blk.senseSignal === 'motion')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));

  // Evaluation anchor for historical size stats (clamped to end of review week)
  const evaluationNow = new Date(Math.min(nowMs, weekEndMs - 1));
  const sizeStatsMap = computeProjectSizeStatsMap(veyraDb, evaluationNow);

  // Mon-Fri dayStrip (focus, planned, room, meetings)
  const dayStrip: ReviewDayStripItem[] = [];
  for (let offset = 0; offset < 5; offset++) {
    const date = addDaysToDateString(start, offset);
    const { startIso, endIso } = getLocalDayBoundsIso(date, timezone);
    const dayStartMs = Date.parse(startIso);
    const dayEndMs = Date.parse(endIso);

    let dayFocusMs = 0;
    for (const s of allSessions) {
      const sStart = Date.parse(s.startedAt);
      const sEnd = s.endedAt ? Date.parse(s.endedAt) : nowMs;
      dayFocusMs += computeOverlapMs(sStart, sEnd, dayStartMs, dayEndMs);
    }

    let plannedMinutes = 0;
    for (const blk of allBlocks) {
      if (blk.deletedAt !== null || blk.status === 'dropped') continue;
      if (blk.scheduledDate === date) {
        const learnedSize = sizeStatsMap.get(blk.projectId)?.learnedSizeMinutes ?? null;
        plannedMinutes += blk.sizeMinutes ?? learnedSize ?? DEFAULT_BLOCK_SIZE_MINUTES;
      }
    }

    const room = computeWeekdayRoom(veyraDb, date, nowDate, allActiveEvents);
    dayStrip.push({
      date,
      weekday: WEEKDAY_SHORT_LABELS[offset],
      focusMinutes: msToRoundedMinutes(dayFocusMs),
      plannedMinutes,
      roomMinutes: room.roomMinutes,
      meetingMinutes: room.meetingMinutes,
    });
  }

  const roomMinutesTotal = dayStrip.reduce((sum, d) => sum + d.roomMinutes, 0);
  const plannedMinutesTotal = dayStrip.reduce((sum, d) => sum + d.plannedMinutes, 0);

  // Active Goal Reviews: Company first, then Personal, preserving orderKey rank within kind
  const activeGoals = allGoals.filter((g) => g.status === 'active');
  const orderedActiveGoals = [
    ...activeGoals.filter((g) => g.kind === 'company'),
    ...activeGoals.filter((g) => g.kind === 'personal'),
  ];
  const rankCounters: Record<Goal['kind'], number> = { company: 0, personal: 0 };

  const goalReviews: GoalReviewItem[] = orderedActiveGoals.map((goal) => {
    rankCounters[goal.kind] += 1;
    const focusMinutes = msToRoundedMinutes(weekMsByGoal.get(goal.id) ?? 0);
    const blockCount = weekBlockIdsByGoal.get(goal.id)?.size ?? 0;

    const goalCompletedBlocks = completedThisWeek.filter((b) => b.goalId === goal.id);
    const goalSense: SenseCounts = { moved: 0, partly: 0, motion: 0 };
    for (const blk of goalCompletedBlocks) {
      if (blk.senseSignal === 'moved') goalSense.moved++;
      else if (blk.senseSignal === 'partly') goalSense.partly++;
      else if (blk.senseSignal === 'motion') goalSense.motion++;
    }

    const topOutcomes = goalCompletedBlocks
      .filter((b) => Boolean(b.outcomeNote && b.outcomeNote.trim().length > 0))
      .sort((a, b) => {
        const aMoved = a.senseSignal === 'moved' ? 1 : 0;
        const bMoved = b.senseSignal === 'moved' ? 1 : 0;
        if (aMoved !== bMoved) return bMoved - aMoved;
        return b.updatedAt.localeCompare(a.updatedAt);
      })
      .slice(0, 3)
      .map((b) => b.outcomeNote!.trim());

    const isCheckInDue = goal.checkInDate !== null && goal.checkInDate <= end;
    const twoWeekMinutes = msToRoundedMinutes(twoWeekMsByGoal.get(goal.id) ?? 0);
    const isQuietTwoWeeks = twoWeekMinutes === 0 && !twoWeekCompletedGoalIds.has(goal.id);

    const senseTotal = goalSense.moved + goalSense.partly + goalSense.motion;
    const hasMostlyMotion =
      senseTotal > 0 && goalSense.motion > goalSense.moved && goalSense.motion >= senseTotal / 2;
    const isStalled =
      isQuietTwoWeeks || hasMostlyMotion || (focusMinutes < 30 && goalSense.moved === 0);

    return {
      goalId: goal.id,
      name: goal.name,
      kind: goal.kind,
      color: goal.color,
      status: goal.status,
      doneWhen: goal.doneWhen,
      checkInDate: goal.checkInDate,
      measure: goal.measure,
      ifItStalls: goal.ifItStalls,
      rankInKind: rankCounters[goal.kind],
      focusMinutes,
      blockCount,
      senseCounts: goalSense,
      topOutcomes,
      isCheckInDue,
      isQuietTwoWeeks,
      isStalled,
    };
  });

  // Project Buckets (More than planned, Less than planned, Wanted untouched, Time without plan, On track)
  const carryoversByProject = new Map<string, number>();
  for (const blk of allBlocks) {
    if (blk.deletedAt !== null || blk.carryoverCount <= 0) continue;
    const isOpenOrInWeek =
      blk.status === 'todo' ||
      (blk.scheduledDate !== null && blk.scheduledDate >= start && blk.scheduledDate <= end) ||
      (Date.parse(blk.updatedAt) >= weekStartMs && Date.parse(blk.updatedAt) < weekEndMs);
    if (isOpenOrInWeek) {
      carryoversByProject.set(
        blk.projectId,
        (carryoversByProject.get(blk.projectId) ?? 0) + 1,
      );
    }
  }

  const projectBuckets: ProjectReviewBuckets = {
    moreThanPlanned: [],
    lessThanPlanned: [],
    wantedUntouched: [],
    timeWithoutPlan: [],
    onTrack: [],
  };

  for (const project of allProjects) {
    const msArr = fourWeekMsByProject.get(project.id) ?? [0, 0, 0, 0];
    const trend4w = msArr.map((ms) => msToRoundedMinutes(ms));
    const realMinutes = trend4w[3];

    if (project.status === 'archived' && realMinutes === 0) {
      continue;
    }
    if (project.isSystem && project.weeklyTimeMinutes === null && realMinutes <= 60) {
      continue;
    }

    const varianceStatus = computeVarianceStatusForReview(realMinutes, project.weeklyTimeMinutes);
    if (varianceStatus === 'unplanned') {
      continue;
    }

    const item: ProjectReviewBucketItem = {
      projectId: project.id,
      weeklyTimeMinutes: project.weeklyTimeMinutes,
      realMinutes,
      differenceMinutes:
        project.weeklyTimeMinutes !== null ? realMinutes - project.weeklyTimeMinutes : null,
      blockCount: weekBlockIdsByProject.get(project.id)?.size ?? 0,
      carryoverCount: carryoversByProject.get(project.id) ?? 0,
      trend4w,
      varianceStatus,
    };

    switch (varianceStatus) {
      case 'over':
        projectBuckets.moreThanPlanned.push(item);
        break;
      case 'under':
        projectBuckets.lessThanPlanned.push(item);
        break;
      case 'untouched':
        projectBuckets.wantedUntouched.push(item);
        break;
      case 'time_without_plan':
        projectBuckets.timeWithoutPlan.push(item);
        break;
      case 'on_track':
        projectBuckets.onTrack.push(item);
        break;
    }
  }

  projectBuckets.moreThanPlanned.sort(
    (a, b) =>
      (b.differenceMinutes ?? 0) - (a.differenceMinutes ?? 0) ||
      b.realMinutes - a.realMinutes ||
      a.projectId.localeCompare(b.projectId),
  );
  projectBuckets.lessThanPlanned.sort(
    (a, b) =>
      (a.differenceMinutes ?? 0) - (b.differenceMinutes ?? 0) ||
      (b.weeklyTimeMinutes ?? 0) - (a.weeklyTimeMinutes ?? 0) ||
      a.projectId.localeCompare(b.projectId),
  );
  projectBuckets.wantedUntouched.sort(
    (a, b) =>
      (b.weeklyTimeMinutes ?? 0) - (a.weeklyTimeMinutes ?? 0) ||
      a.projectId.localeCompare(b.projectId),
  );
  projectBuckets.timeWithoutPlan.sort(
    (a, b) => b.realMinutes - a.realMinutes || a.projectId.localeCompare(b.projectId),
  );
  projectBuckets.onTrack.sort(
    (a, b) => b.realMinutes - a.realMinutes || a.projectId.localeCompare(b.projectId),
  );

  // Planning Findings (up to 3, active once >= 3 distinct weeks have logged sessions or completed/dropped blocks)
  const planningFindings: PlanningFinding[] = [];
  if (distinctActiveWeeks.size >= MIN_FINDINGS_WEEKS) {
    // 1. Overplanning
    const overDays = dayStrip.filter(
      (d) => d.roomMinutes > 0 && d.plannedMinutes > d.roomMinutes,
    ).length;
    if (
      roomMinutesTotal > 0 &&
      overDays >= 3 &&
      plannedMinutesTotal > roomMinutesTotal * 1.15
    ) {
      const pct = Math.round((plannedMinutesTotal / roomMinutesTotal) * 100);
      planningFindings.push({
        kind: 'overplanning',
        title: 'Overplanning',
        summary: `You planned ${pct}% of your room on ${overDays} of 5 days.`,
        suggestedRule: 'Plan only what fits your daily room before adding extra blocks.',
      });
    }

    // 2. Size drift
    let worstDrift: { project: Project; driftPct: number; learnedMinutes: number } | null = null;
    for (const [projectId, stats] of sizeStatsMap.entries()) {
      if (stats.sizeDriftPct === null || stats.learnedSizeMinutes === null) continue;
      if (Math.abs(stats.sizeDriftPct) < MIN_SIZE_DRIFT_PCT) continue;
      const proj = projectById.get(projectId);
      if (!proj || proj.isSystem) continue;
      if (!worstDrift || Math.abs(stats.sizeDriftPct) > Math.abs(worstDrift.driftPct)) {
        worstDrift = {
          project: proj,
          driftPct: stats.sizeDriftPct,
          learnedMinutes: stats.learnedSizeMinutes,
        };
      }
    }
    if (worstDrift) {
      const learnedLabel = formatHoursMinutes(worstDrift.learnedMinutes);
      const direction =
        worstDrift.driftPct > 0
          ? `${worstDrift.project.name} blocks take ${worstDrift.driftPct}% longer than planned.`
          : `${worstDrift.project.name} blocks finish ${Math.abs(worstDrift.driftPct)}% faster than planned.`;
      planningFindings.push({
        kind: 'size_drift',
        title: 'Size drift',
        summary: direction,
        suggestedRule: `Default ${worstDrift.project.name} blocks to ${learnedLabel} when planning.`,
      });
    }

    // 3. Motion hot spots (8-week window ending at weekEndMs)
    const motionStatsByProject = new Map<string, { rated: number; motion: number }>();
    for (const blk of allBlocks) {
      if (blk.deletedAt !== null || blk.status !== 'done' || !blk.senseSignal) continue;
      const doneMs = Date.parse(blk.updatedAt);
      if (doneMs < eightWeekStartMs || doneMs >= weekEndMs) continue;
      if (blk.projectId === SYSTEM_OTHER_PROJECT_ID) continue;
      const cur = motionStatsByProject.get(blk.projectId) ?? { rated: 0, motion: 0 };
      cur.rated += 1;
      if (blk.senseSignal === 'motion') cur.motion += 1;
      motionStatsByProject.set(blk.projectId, cur);
    }

    let worstMotion: { project: Project; motion: number; rated: number; ratio: number } | null =
      null;
    for (const [projectId, stats] of motionStatsByProject.entries()) {
      if (stats.rated < MIN_MOTION_FINDING_SAMPLES) continue;
      const ratio = stats.motion / stats.rated;
      if (ratio < MOTION_FINDING_RATIO) continue;
      const proj = projectById.get(projectId);
      if (!proj) continue;
      if (
        !worstMotion ||
        ratio > worstMotion.ratio ||
        (ratio === worstMotion.ratio && stats.motion > worstMotion.motion)
      ) {
        worstMotion = { project: proj, motion: stats.motion, rated: stats.rated, ratio };
      }
    }
    if (worstMotion) {
      planningFindings.push({
        kind: 'motion_hot_spot',
        title: 'Motion hot spots',
        summary: `${worstMotion.project.name}: ${worstMotion.motion} of ${worstMotion.rated} blocks felt like just motion.`,
        suggestedRule: `Before starting ${worstMotion.project.name} blocks, name the outcome that moves a goal.`,
      });
    }

    // 4. Dropped without consequence (4-week window ending at weekEndMs)
    const droppedByProject = new Map<string, number>();
    let totalDropped4w = 0;
    for (const blk of allBlocks) {
      if (blk.deletedAt !== null || blk.status !== 'dropped') continue;
      const updatedMs = Date.parse(blk.updatedAt);
      if (updatedMs < fourWeekStartMs || updatedMs >= weekEndMs) continue;
      totalDropped4w += 1;
      droppedByProject.set(blk.projectId, (droppedByProject.get(blk.projectId) ?? 0) + 1);
    }
    if (totalDropped4w >= MIN_DROPPED_FINDING_COUNT) {
      let topDroppedProject: { project: Project; count: number } | null = null;
      for (const [projectId, count] of droppedByProject.entries()) {
        if (count < MIN_DROPPED_FINDING_COUNT) continue;
        const proj = projectById.get(projectId);
        if (!proj || proj.isSystem) continue;
        if (!topDroppedProject || count > topDroppedProject.count) {
          topDroppedProject = { project: proj, count };
        }
      }
      if (topDroppedProject) {
        planningFindings.push({
          kind: 'dropped_without_consequence',
          title: 'Dropped without consequence',
          summary: `You dropped ${topDroppedProject.count} ${topDroppedProject.project.name} blocks over the last 4 weeks.`,
          suggestedRule: `Keep low-conviction ${topDroppedProject.project.name} ideas in Later instead of scheduling them.`,
        });
      } else {
        planningFindings.push({
          kind: 'dropped_without_consequence',
          title: 'Dropped without consequence',
          summary: `You dropped ${totalDropped4w} blocks over the last 4 weeks without follow-up.`,
          suggestedRule: 'Park uncertain blocks in Later instead of scheduling them for the week.',
        });
      }
    }

    // 5. Goal neglect (active goal with no time for two weeks)
    const neglectedGoals = goalReviews.filter((g) => g.isQuietTwoWeeks);
    if (neglectedGoals.length > 0) {
      const first = neglectedGoals[0];
      const summary =
        neglectedGoals.length === 1
          ? `${first.name} had no focus time for two weeks.`
          : `${first.name} and ${neglectedGoals.length - 1} other goal${neglectedGoals.length - 1 === 1 ? '' : 's'} had no focus time for two weeks.`;
      planningFindings.push({
        kind: 'goal_neglect',
        title: 'Goal neglect',
        summary,
        suggestedRule: `Block one focused session for ${first.name} early next week, or let it go.`,
      });
    }
  }

  const cappedFindings = planningFindings.slice(0, MAX_PLANNING_FINDINGS);

  // Rule suggestions: up to 3 distinct suggestions taken from findings (with calm fallbacks if < 3)
  const ruleSuggestions: string[] = [];
  const addSuggestion = (suggestion: string) => {
    if (ruleSuggestions.length >= 3) return;
    if (!ruleSuggestions.includes(suggestion)) {
      ruleSuggestions.push(suggestion);
    }
  };
  for (const finding of cappedFindings) {
    addSuggestion(finding.suggestedRule);
  }
  if (ruleSuggestions.length < 3 && projectBuckets.wantedUntouched.length > 0) {
    const untouchedName = projectById.get(projectBuckets.wantedUntouched[0].projectId)?.name;
    if (untouchedName) {
      addSuggestion(`Schedule one focused block for ${untouchedName} before Wednesday.`);
    }
  }

  // Goal-linked meetings overlapping this week
  const weekMeetings = allActiveEvents.filter((ev) => {
    if (!ev.goalId) return false;
    const evStart = Date.parse(ev.startAt);
    const evEnd = Date.parse(ev.endAt);
    return evStart < weekEndMs && evEnd > weekStartMs;
  });

  // Progress feed: completed blocks + goal-linked meetings, newest first
  const progressFeed: ProgressFeedItem[] = [
    ...completedThisWeek.map((blk): ProgressFeedItem => ({
      kind: 'block',
      id: blk.id,
      title: blk.title,
      projectId: blk.projectId,
      goalId: blk.goalId,
      isOps: blk.isOps,
      timestamp: blk.updatedAt,
      outcomeNote: blk.outcomeNote,
      autoSummary: blk.autoSummary,
      energySignal: blk.energySignal,
      senseSignal: blk.senseSignal,
      totalFocusMinutes: msToRoundedMinutes(allTimeMsByBlock.get(blk.id) ?? 0),
    })),
    ...weekMeetings.map((ev): ProgressFeedItem => ({
      kind: 'meeting',
      id: ev.id,
      title: ev.title,
      projectId: ev.projectId,
      goalId: ev.goalId!,
      isOps: ev.isOps,
      timestamp: ev.endAt,
      startAt: ev.startAt,
      endAt: ev.endAt,
      notes: ev.notes,
    })),
  ].sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  // Ops Radar: roll up recurring Ops by seriesId, separate pure Ops vs goal-linked Ops
  const opsCandidateBlockIds = new Set<string>();
  for (const [blkId, ms] of weekMsByBlock.entries()) {
    const blk = blockById.get(blkId);
    if (blk && blk.isOps && ms > 0) {
      opsCandidateBlockIds.add(blkId);
    }
  }
  for (const blk of completedThisWeek) {
    if (blk.isOps) {
      opsCandidateBlockIds.add(blk.id);
    }
  }

  const opsGroups = new Map<
    string,
    {
      key: string;
      seriesId: string | null;
      blockIds: string[];
      title: string;
      projectId: string;
      goalId: string | null;
      isGoalLinked: boolean;
      totalMs: number;
      autoSummaries: string[];
    }
  >();

  // Sort candidate blocks oldest-to-newest so blockIds preserves chronological order
  // (latestBlockId at the end) while autoSummaries are collected newest-first.
  const sortedOpsBlocks = Array.from(opsCandidateBlockIds)
    .map((id) => blockById.get(id))
    .filter((blk): blk is Block => blk !== undefined)
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));

  for (const blk of sortedOpsBlocks) {
    const isGoalLinked = blk.goalId !== null;
    const key = `${blk.seriesId ?? blk.id}:${isGoalLinked ? 'goal' : 'pure'}`;
    const ms = weekMsByBlock.get(blk.id) ?? 0;
    const trimmedSummary = blk.autoSummary?.trim() || null;

    const existingGroup = opsGroups.get(key);
    if (existingGroup) {
      existingGroup.blockIds.push(blk.id);
      existingGroup.totalMs += ms;
      if (trimmedSummary && !existingGroup.autoSummaries.includes(trimmedSummary)) {
        existingGroup.autoSummaries.unshift(trimmedSummary);
      }
    } else {
      opsGroups.set(key, {
        key,
        seriesId: blk.seriesId,
        blockIds: [blk.id],
        title: blk.title,
        projectId: blk.projectId,
        goalId: blk.goalId,
        isGoalLinked,
        totalMs: ms,
        autoSummaries: trimmedSummary ? [trimmedSummary] : [],
      });
    }
  }

  const opsItems: OpsRadarItem[] = Array.from(opsGroups.values())
    .map((group) => ({
      key: group.key,
      seriesId: group.seriesId,
      blockIds: group.blockIds,
      title: group.title,
      projectId: group.projectId,
      goalId: group.goalId,
      isGoalLinked: group.isGoalLinked,
      occurrenceCount: group.blockIds.length,
      totalMinutes: msToRoundedMinutes(group.totalMs),
      autoSummaries: group.autoSummaries,
    }))
    .sort((a, b) => b.totalMinutes - a.totalMinutes || a.title.localeCompare(b.title));

  const pureOpsItems = opsItems.filter((item) => !item.isGoalLinked);
  const goalLinkedOpsItems = opsItems.filter((item) => item.isGoalLinked);

  // Chronic carryovers: open non-deleted blocks with carryoverCount >= 3
  const chronicCarryovers = veyraDb.db
    .select()
    .from(blocks)
    .where(
      and(
        isNull(blocks.deletedAt),
        eq(blocks.status, 'todo'),
        gte(blocks.carryoverCount, 3),
      ),
    )
    .orderBy(desc(blocks.carryoverCount), asc(blocks.orderKey))
    .all();

  // Past-revisit Later items: open Later blocks with revisitAt <= today
  const pastRevisitLater = veyraDb.db
    .select()
    .from(blocks)
    .where(
      and(
        isNull(blocks.deletedAt),
        eq(blocks.status, 'todo'),
        eq(blocks.bucket, 'later'),
        isNotNull(blocks.revisitAt),
        lte(blocks.revisitAt, today),
      ),
    )
    .orderBy(asc(blocks.revisitAt), asc(blocks.orderKey))
    .all();

  const weekDailyNotes = listDailyNotes(veyraDb, { weekStartDate: start });
  const activeRule = getWeeklyReviewRecord(veyraDb, prevWeekStart);
  const weeklyReview = getWeeklyReviewRecord(veyraDb, start);

  if (ruleSuggestions.length < 3 && chronicCarryovers.length > 0) {
    addSuggestion('Decide on carried-over blocks first thing Monday morning.');
  }

  const chapterOpeningSentences = buildChapterOpeningSentences({
    totalFocusMinutes,
    roomMinutesTotal,
    goalAlignmentPct,
    goalReviews,
    projectBuckets,
    projectById,
    chronicCarryoversCount: chronicCarryovers.length,
    pastRevisitLaterCount: pastRevisitLater.length,
    hasRuleForNextWeek: Boolean(weeklyReview?.ruleForNextWeek?.trim()),
  });

  const completedAt = weeklyReview?.completedAt ?? null;
  const snapshot =
    completedAt && weeklyReview?.snapshotJson
      ? parseWeeklyReviewSnapshot(weeklyReview.snapshotJson)
      : null;

  return {
    weekStartDate: start,
    weekEndDate: end,
    weekNumber,
    timezone,
    chapterOpeningSentences,
    previousRuleKept: weeklyReview?.previousRuleKept ?? null,
    totalFocusMinutes,
    roomMinutesTotal,
    plannedMinutesTotal,
    goalAlignmentPct,
    companyGoalMinutes,
    personalGoalMinutes,
    companyGoalPct,
    personalGoalPct,
    buildMinutes,
    opsMinutes,
    energyCounts,
    senseCounts,
    dayStrip,
    goalReviews,
    worthSecondLook,
    projectBuckets,
    planningFindings: cappedFindings,
    ruleSuggestions,
    progressFeed,
    dailyNotes: weekDailyNotes,
    opsRadar: {
      totalOpsMinutes: opsMinutes,
      pureOpsMinutes: msToRoundedMinutes(pureOpsMs),
      goalLinkedOpsMinutes: msToRoundedMinutes(goalLinkedOpsMs),
      pureOpsItems,
      goalLinkedOpsItems,
      items: opsItems,
    },
    chronicCarryovers,
    pastRevisitLater,
    activeRule,
    weeklyReview,
    activeRuleText: activeRule?.ruleForNextWeek ?? null,
    ruleForNextWeek: weeklyReview?.ruleForNextWeek ?? null,
    completedAt,
    snapshot,
  };
}

export function completeWeeklyReview(
  veyraDb: VeyraDb,
  input: CompleteWeeklyReviewInput,
  options?: ServiceMutationOptions,
): CompleteWeeklyReviewResult {
  const parsed = parseWithZod(completeWeeklyReviewInputSchema, input);
  const nowDate = resolveNow(options?.now);
  const nowIso = nowDate.toISOString();
  const actor = resolveActor(options?.actor);
  const timezone = getActiveTimezone(veyraDb);
  const targetDate = parsed.weekStartDate ?? formatLocalDate(nowDate, timezone);
  const { weekStartDate: normalizedStart } = getWeekRange(targetDate);

  let savedReview!: WeeklyReview;
  let finalSummary!: WeeklyReviewSummary;
  let snapshot!: WeeklyReviewSnapshot;

  veyraDb.sqlite.transaction(() => {
    // 1. Apply optional inline project weeklyTimeMinutes updates inside the same transaction
    if (parsed.projectWeeklyTimes) {
      for (const [projectId, weeklyTimeMinutes] of Object.entries(parsed.projectWeeklyTimes)) {
        updateProject(veyraDb, projectId, { weeklyTimeMinutes }, { now: nowDate, actor });
      }
    }

    // 2. Upsert weekly_reviews row with ruleForNextWeek, previousRuleKept, notes, and completedAt
    const existing = veyraDb.db
      .select()
      .from(weeklyReviews)
      .where(eq(weeklyReviews.weekStartDate, normalizedStart))
      .get();

    const nextPreviousRuleKept =
      parsed.previousRuleKept !== undefined
        ? parsed.previousRuleKept
        : (existing?.previousRuleKept ?? null);
    const nextNotes = parsed.notes !== undefined ? parsed.notes : (existing?.notes ?? '');

    if (existing) {
      savedReview = {
        ...existing,
        ruleForNextWeek: parsed.ruleForNextWeek,
        previousRuleKept: nextPreviousRuleKept,
        notes: nextNotes,
        completedAt: nowIso,
        updatedAt: nowIso,
        deletedAt: null,
      };
      veyraDb.db
        .update(weeklyReviews)
        .set({
          ruleForNextWeek: savedReview.ruleForNextWeek,
          previousRuleKept: savedReview.previousRuleKept,
          notes: savedReview.notes,
          completedAt: savedReview.completedAt,
          updatedAt: savedReview.updatedAt,
          deletedAt: null,
        })
        .where(eq(weeklyReviews.id, existing.id))
        .run();
    } else {
      savedReview = {
        id: crypto.randomUUID(),
        weekStartDate: normalizedStart,
        ruleForNextWeek: parsed.ruleForNextWeek,
        previousRuleKept: nextPreviousRuleKept,
        notes: nextNotes,
        completedAt: nowIso,
        snapshotJson: null,
        updatedAt: nowIso,
        deletedAt: null,
      };
      veyraDb.db.insert(weeklyReviews).values(savedReview).run();
    }

    // 3. Recompute enriched review summary with updated project weekly times and review row
    const summary = getWeeklyReview(veyraDb, normalizedStart, nowDate);

    // Collect real minutes per project from buckets + sessions for snapshot
    const realMinutesByProject = new Map<string, number>();
    for (const list of [
      summary.projectBuckets.moreThanPlanned,
      summary.projectBuckets.lessThanPlanned,
      summary.projectBuckets.wantedUntouched,
      summary.projectBuckets.timeWithoutPlan,
      summary.projectBuckets.onTrack,
    ]) {
      for (const item of list) {
        realMinutesByProject.set(item.projectId, item.realMinutes);
      }
    }

    const activeProjects = veyraDb.db
      .select()
      .from(projects)
      .where(isNull(projects.deletedAt))
      .orderBy(asc(projects.name))
      .all()
      .filter((p) => p.status !== 'archived' && !p.isSystem);

    snapshot = {
      weekStartDate: summary.weekStartDate,
      weekEndDate: summary.weekEndDate,
      weekNumber: summary.weekNumber,
      completedAt: nowIso,
      totalFocusMinutes: summary.totalFocusMinutes,
      roomMinutesTotal: summary.roomMinutesTotal,
      plannedMinutesTotal: summary.plannedMinutesTotal,
      goalAlignmentPct: summary.goalAlignmentPct,
      companyGoalPct: summary.companyGoalPct,
      personalGoalPct: summary.personalGoalPct,
      buildMinutes: summary.buildMinutes,
      opsMinutes: summary.opsMinutes,
      senseCounts: summary.senseCounts,
      energyCounts: summary.energyCounts,
      previousRuleText: summary.activeRuleText,
      previousRuleKept: savedReview.previousRuleKept,
      ruleForNextWeek: savedReview.ruleForNextWeek,
      goalsMoved: summary.goalReviews.map((g) => ({
        goalId: g.goalId,
        name: g.name,
        kind: g.kind,
        color: g.color,
        focusMinutes: g.focusMinutes,
        blockCount: g.blockCount,
        movedCount: g.senseCounts.moved,
        measure: g.measure,
        topOutcomes: g.topOutcomes,
      })),
      projectWeeklyTimes: activeProjects
        .filter(
          (p) => p.weeklyTimeMinutes !== null || (realMinutesByProject.get(p.id) ?? 0) > 0,
        )
        .map((p) => ({
          projectId: p.id,
          name: p.name,
          weeklyTimeMinutes: p.weeklyTimeMinutes,
          realMinutes: realMinutesByProject.get(p.id) ?? 0,
        })),
    };

    const snapshotJson = JSON.stringify(snapshot);
    savedReview = {
      ...savedReview,
      snapshotJson,
    };

    veyraDb.db
      .update(weeklyReviews)
      .set({ snapshotJson, updatedAt: nowIso })
      .where(eq(weeklyReviews.id, savedReview.id))
      .run();

    recordActivity(
      veyraDb,
      actor,
      'weekly_review.completed',
      `Completed weekly review for Week ${summary.weekNumber} (${normalizedStart})`,
      nowIso,
    );

    finalSummary = {
      ...summary,
      weeklyReview: savedReview,
      completedAt: nowIso,
      snapshot,
    };
  })();

  return {
    review: savedReview,
    summary: finalSummary,
    snapshot,
  };
}

export function reopenWeeklyReview(
  veyraDb: VeyraDb,
  weekStartDate: string,
  options?: ServiceMutationOptions,
): WeeklyReview {
  parseWithZod(dateOnlySchema, weekStartDate);
  const { weekStartDate: normalizedStart } = getWeekRange(weekStartDate);
  const nowIso = resolveNow(options?.now).toISOString();
  const actor = resolveActor(options?.actor);

  const existing = veyraDb.db
    .select()
    .from(weeklyReviews)
    .where(and(eq(weeklyReviews.weekStartDate, normalizedStart), isNull(weeklyReviews.deletedAt)))
    .get();

  if (!existing) {
    throw new NotFoundError(`WeeklyReview for week '${normalizedStart}' not found`);
  }

  const updated: WeeklyReview = {
    ...existing,
    completedAt: null,
    updatedAt: nowIso,
  };

  veyraDb.sqlite.transaction(() => {
    veyraDb.db
      .update(weeklyReviews)
      .set({ completedAt: null, updatedAt: nowIso })
      .where(eq(weeklyReviews.id, existing.id))
      .run();

    recordActivity(
      veyraDb,
      actor,
      'weekly_review.reopened',
      `Reopened weekly review for week of ${normalizedStart}`,
      nowIso,
    );
  })();

  return updated;
}
