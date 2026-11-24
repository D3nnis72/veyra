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
  getLocalDayBoundsIso,
  getWeekRange,
} from '../time.js';
import {
  type ActiveWeeklyRuleResult,
  type ActivityActor,
  type Block,
  type CreateDailyNoteInput,
  type DailyNote,
  type EnergyCounts,
  type ListDailyNotesFilter,
  type OpsRadarItem,
  type ProgressFeedItem,
  type UpdateDailyNoteInput,
  type WeeklyReview,
  type WeeklyReviewSummary,
  createDailyNoteInputSchema,
  dateOnlySchema,
  updateDailyNoteInputSchema,
} from '../types.js';
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
  options?: { notes?: string } & ServiceMutationOptions,
): WeeklyReview {
  parseWithZod(dateOnlySchema, weekStartDate);
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
        notes: options?.notes !== undefined ? options.notes : existing.notes,
        updatedAt: nowIso,
        deletedAt: null,
      };
      veyraDb.db
        .update(weeklyReviews)
        .set({
          ruleForNextWeek: result.ruleForNextWeek,
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
        notes: options?.notes ?? '',
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

  const weekStartIso = getLocalDayBoundsIso(start, timezone).startIso;
  const weekEndIso = getLocalDayBoundsIso(end, timezone).endIso;
  const weekStartMs = Date.parse(weekStartIso);
  const weekEndMs = Date.parse(weekEndIso);

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

  let totalFocusMs = 0;
  let buildMs = 0;
  let opsMs = 0;
  let goalLinkedMs = 0;
  let pureOpsMs = 0;
  let goalLinkedOpsMs = 0;

  const weekMsByBlock = new Map<string, number>();
  const allTimeMsByBlock = new Map<string, number>();

  for (const session of allSessions) {
    const sStart = Date.parse(session.startedAt);
    const sEnd = session.endedAt ? Date.parse(session.endedAt) : nowMs;
    if (sEnd > sStart) {
      allTimeMsByBlock.set(
        session.blockId,
        (allTimeMsByBlock.get(session.blockId) ?? 0) + (sEnd - sStart),
      );
    }

    const overlapMs = computeOverlapMs(sStart, sEnd, weekStartMs, weekEndMs);
    if (overlapMs <= 0) {
      continue;
    }

    const blk = blockById.get(session.blockId);
    if (!blk) {
      continue;
    }

    totalFocusMs += overlapMs;
    weekMsByBlock.set(blk.id, (weekMsByBlock.get(blk.id) ?? 0) + overlapMs);

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
    }
  }

  const totalFocusMinutes = msToRoundedMinutes(totalFocusMs);
  const buildMinutes = msToRoundedMinutes(buildMs);
  const opsMinutes = msToRoundedMinutes(opsMs);
  const goalAlignmentPct =
    totalFocusMs > 0 ? Math.round((goalLinkedMs / totalFocusMs) * 100) : 0;

  // Completed blocks within this week
  const completedThisWeek = allBlocks.filter((blk) => {
    if (blk.deletedAt !== null || blk.status !== 'done') {
      return false;
    }
    const updatedMs = Date.parse(blk.updatedAt);
    return updatedMs >= weekStartMs && updatedMs < weekEndMs;
  });

  // Raw energy counts (never a percentage)
  const energyCounts: EnergyCounts = { up: 0, neutral: 0, down: 0 };
  for (const blk of completedThisWeek) {
    if (blk.energySignal === 'up') energyCounts.up++;
    else if (blk.energySignal === 'neutral') energyCounts.neutral++;
    else if (blk.energySignal === 'down') energyCounts.down++;
  }

  // Goal-linked meetings overlapping this week
  const weekMeetings = veyraDb.db
    .select()
    .from(calendarEvents)
    .where(and(isNull(calendarEvents.deletedAt), isNotNull(calendarEvents.goalId)))
    .all()
    .filter((ev) => {
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
  const prevWeekStart = addDaysToDateString(start, -7);
  const activeRule = getWeeklyReviewRecord(veyraDb, prevWeekStart);
  const weeklyReview = getWeeklyReviewRecord(veyraDb, start);

  return {
    weekStartDate: start,
    weekEndDate: end,
    timezone,
    totalFocusMinutes,
    goalAlignmentPct,
    buildMinutes,
    opsMinutes,
    energyCounts,
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
  };
}
