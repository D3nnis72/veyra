import { and, eq, isNull } from 'drizzle-orm';
import type { VeyraDb } from '../db.js';
import { NotFoundError, ValidationError } from '../errors.js';
import { generateOrderKey } from '../order-key.js';
import { blocks, calendarEvents, focusSessions } from '../schema.js';
import {
  addDaysToDateString,
  formatLocalDate,
  getLocalDayBoundsIso,
  getWeekRange,
  getWeekdayToken,
} from '../time.js';
import {
  type Block,
  type BlockSizeMinutes,
  type CalendarEvent,
  type DateOnly,
  type DayLookBackSummary,
  type FitLineSummary,
  type FocusSession,
  type GoalWithStats,
  type PlanDayCapacity,
  type PlanProjectTimeItem,
  type ProjectWithStats,
  type RoomTodaySummary,
  SYSTEM_OTHER_PROJECT_ID,
  type SuggestedOrderItem,
  type WeekdayToken,
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

const DEFAULT_WEEKDAY_BASELINE_MINUTES = 240;
const DEFAULT_BLOCK_SIZE_MINUTES: BlockSizeMinutes = 60;
const MIN_LEARNED_WEEKDAY_SAMPLES = 2;
const MIN_LEARNED_SIZE_SAMPLES = 3;
const MIN_MOTION_HOTSPOT_SAMPLES = 3;
const MOTION_HOTSPOT_RATIO = 0.6;

const WEEKDAY_LABELS: Record<WeekdayToken, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

const PREP_KEYWORD_REGEX =
  /\b(prep|prepare|agenda|deck|slides|brief|briefing|pre-read|preread|rehearse|notes for|review for)\b/i;

const TITLE_STOPWORDS = new Set([
  'prep',
  'prepare',
  'agenda',
  'deck',
  'slides',
  'brief',
  'briefing',
  'notes',
  'review',
  'rehearse',
  'with',
  'from',
  'that',
  'this',
  'about',
  'into',
  'meeting',
  'call',
  'sync',
  'weekly',
  'daily',
  'today',
  'tomorrow',
]);

export interface ProjectSizeStats {
  learnedSizeMinutes: BlockSizeMinutes | null;
  sizeDriftPct: number | null;
  sampleCount: number;
}

export interface ComputeTodayCapacityOptions {
  date: DateOnly;
  upNext: Block[];
  completedToday: Block[];
  todayEvents: CalendarEvent[];
  projects: ProjectWithStats[];
  goals: GoalWithStats[];
  now?: Date | string;
}

export interface TodayCapacityResult {
  roomToday: RoomTodaySummary;
  suggestedOrder: SuggestedOrderItem[];
  fitLine: FitLineSummary;
  dayLookBack: DayLookBackSummary | null;
}

export interface PlanCapacityResult {
  projectTimeStrip: PlanProjectTimeItem[];
  dayCapacities: PlanDayCapacity[];
}

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid];
  }
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function snapToBlockSize(minutes: number): BlockSizeMinutes {
  if (minutes < 45) return 30;
  if (minutes < 90) return 60;
  return 120;
}

function computeMergedMeetingMinutes(
  events: ReadonlyArray<Pick<CalendarEvent, 'startAt' | 'endAt'>>,
  dayStartMs: number,
  dayEndMs: number,
): number {
  const intervals: Array<[number, number]> = [];
  for (const ev of events) {
    const startMs = Math.max(Date.parse(ev.startAt), dayStartMs);
    const endMs = Math.min(Date.parse(ev.endAt), dayEndMs);
    if (!Number.isNaN(startMs) && !Number.isNaN(endMs) && endMs > startMs) {
      intervals.push([startMs, endMs]);
    }
  }
  if (intervals.length === 0) {
    return 0;
  }
  intervals.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  let totalMs = 0;
  let [curStart, curEnd] = intervals[0];
  for (let i = 1; i < intervals.length; i++) {
    const [nextStart, nextEnd] = intervals[i];
    if (nextStart <= curEnd) {
      if (nextEnd > curEnd) {
        curEnd = nextEnd;
      }
    } else {
      totalMs += curEnd - curStart;
      curStart = nextStart;
      curEnd = nextEnd;
    }
  }
  totalMs += curEnd - curStart;
  return msToRoundedMinutes(totalMs);
}

function computeFocusMinutesForDate(
  sessions: ReadonlyArray<Pick<FocusSession, 'startedAt' | 'endedAt'>>,
  dateStr: DateOnly,
  timezone: string,
  nowMs: number,
): number {
  const { startIso, endIso } = getLocalDayBoundsIso(dateStr, timezone);
  const dayStartMs = Date.parse(startIso);
  const dayEndMs = Date.parse(endIso);
  let totalMs = 0;
  for (const s of sessions) {
    const sStart = Date.parse(s.startedAt);
    const sEnd = s.endedAt ? Date.parse(s.endedAt) : nowMs;
    totalMs += computeOverlapMs(sStart, sEnd, dayStartMs, dayEndMs);
  }
  return msToRoundedMinutes(totalMs);
}

function computeWeekdayRoomWithPreloaded(
  dateStr: DateOnly,
  timezone: string,
  nowMs: number,
  allSessions: ReadonlyArray<Pick<FocusSession, 'startedAt' | 'endedAt'>>,
  eventsForRoom: ReadonlyArray<Pick<CalendarEvent, 'startAt' | 'endAt'>>,
): RoomTodaySummary {
  const activeWeekdayTotals: number[] = [];
  for (let weeksBack = 1; weeksBack <= 4; weeksBack++) {
    const priorDate = addDaysToDateString(dateStr, -7 * weeksBack);
    const mins = computeFocusMinutesForDate(allSessions, priorDate, timezone, nowMs);
    if (mins > 0) {
      activeWeekdayTotals.push(mins);
    }
  }

  const hasLearnedBaseline = activeWeekdayTotals.length >= MIN_LEARNED_WEEKDAY_SAMPLES;
  const baselineFocusMinutes = hasLearnedBaseline
    ? Math.round(median(activeWeekdayTotals))
    : DEFAULT_WEEKDAY_BASELINE_MINUTES;

  const { startIso, endIso } = getLocalDayBoundsIso(dateStr, timezone);
  const dayStartMs = Date.parse(startIso);
  const dayEndMs = Date.parse(endIso);
  const meetingMinutes = computeMergedMeetingMinutes(eventsForRoom, dayStartMs, dayEndMs);
  const roomMinutes = Math.max(0, baselineFocusMinutes - meetingMinutes);
  const weekdayLabel = WEEKDAY_LABELS[getWeekdayToken(dateStr)];

  return {
    roomMinutes,
    baselineFocusMinutes,
    meetingMinutes,
    hasLearnedBaseline,
    weekdayLabel,
  };
}

/**
 * Computes available focus room for a given local date:
 * - Inspects the 4 preceding same-weekday dates (-7d, -14d, -21d, -28d),
 *   excluding zero-focus days (PTO / inactive).
 * - Uses the median of active weekday totals once >= 2 active samples exist;
 *   otherwise falls back to 240m.
 * - Subtracts the union duration of non-deleted meetings clipped to the local day
 *   (merging overlapping meetings so double-booked calls are not subtracted twice),
 *   clamped at 0.
 */
export function computeWeekdayRoom(
  veyraDb: VeyraDb,
  dateStr: DateOnly,
  now?: Date | string,
  eventsOverride?: ReadonlyArray<Pick<CalendarEvent, 'startAt' | 'endAt'>>,
): RoomTodaySummary {
  const nowDate = resolveNow(now);
  const nowMs = nowDate.getTime();
  const timezone = getActiveTimezone(veyraDb);

  const allSessions = veyraDb.db
    .select({ startedAt: focusSessions.startedAt, endedAt: focusSessions.endedAt })
    .from(focusSessions)
    .where(isNull(focusSessions.deletedAt))
    .all();

  const events =
    eventsOverride ??
    veyraDb.db
      .select({ startAt: calendarEvents.startAt, endAt: calendarEvents.endAt })
      .from(calendarEvents)
      .where(isNull(calendarEvents.deletedAt))
      .all();

  return computeWeekdayRoomWithPreloaded(dateStr, timezone, nowMs, allSessions, events);
}

/**
 * Over the last 8 weeks (current week + 7 prior weeks), computes per-project:
 * - `learnedSizeMinutes`: median actual focus minutes across completed blocks with logged sessions,
 *   snapped to nearest of 30 | 60 | 120 (null until >= 3 completed blocks with sessions exist).
 * - `sizeDriftPct`: `Math.round(((actualSum - plannedSum) / plannedSum) * 100)` across those blocks
 *   (using explicit `sizeMinutes` or default 60m when unset; null until >= 3 samples exist).
 * - `sampleCount`: number of completed blocks with logged sessions in the 8-week window.
 */
export function computeProjectSizeStatsMap(
  veyraDb: VeyraDb,
  now?: Date | string,
): Map<string, ProjectSizeStats> {
  const nowDate = resolveNow(now);
  const nowMs = nowDate.getTime();
  const timezone = getActiveTimezone(veyraDb);
  const today = formatLocalDate(nowDate, timezone);
  const { weekStartDate, weekEndDate } = getWeekRange(today);
  const windowStartDate = addDaysToDateString(weekStartDate, -49); // 7 prior weeks + current week = 8w
  const windowStartMs = Date.parse(getLocalDayBoundsIso(windowStartDate, timezone).startIso);
  const windowEndMs = Date.parse(getLocalDayBoundsIso(weekEndDate, timezone).endIso);

  const completedBlocks = veyraDb.db
    .select({
      id: blocks.id,
      projectId: blocks.projectId,
      sizeMinutes: blocks.sizeMinutes,
      updatedAt: blocks.updatedAt,
    })
    .from(blocks)
    .where(and(eq(blocks.status, 'done'), isNull(blocks.deletedAt)))
    .all()
    .filter((blk) => {
      const doneMs = Date.parse(blk.updatedAt);
      return doneMs >= windowStartMs && doneMs < windowEndMs;
    });

  const allSessions = veyraDb.db
    .select({
      blockId: focusSessions.blockId,
      startedAt: focusSessions.startedAt,
      endedAt: focusSessions.endedAt,
    })
    .from(focusSessions)
    .where(isNull(focusSessions.deletedAt))
    .all();

  const msByBlockId = new Map<string, number>();
  for (const s of allSessions) {
    const startMs = Date.parse(s.startedAt);
    const endMs = s.endedAt ? Date.parse(s.endedAt) : nowMs;
    if (endMs > startMs) {
      msByBlockId.set(s.blockId, (msByBlockId.get(s.blockId) ?? 0) + (endMs - startMs));
    }
  }

  const samplesByProject = new Map<string, Array<{ actualMinutes: number; plannedMinutes: number }>>();
  for (const blk of completedBlocks) {
    const totalMs = msByBlockId.get(blk.id) ?? 0;
    const actualMinutes = msToRoundedMinutes(totalMs);
    if (actualMinutes <= 0) {
      continue;
    }
    const plannedMinutes = blk.sizeMinutes ?? DEFAULT_BLOCK_SIZE_MINUTES;
    const list = samplesByProject.get(blk.projectId) ?? [];
    list.push({ actualMinutes, plannedMinutes });
    samplesByProject.set(blk.projectId, list);
  }

  const result = new Map<string, ProjectSizeStats>();
  for (const [projectId, samples] of samplesByProject.entries()) {
    if (samples.length < MIN_LEARNED_SIZE_SAMPLES) {
      result.set(projectId, {
        learnedSizeMinutes: null,
        sizeDriftPct: null,
        sampleCount: samples.length,
      });
      continue;
    }

    const medianActual = median(samples.map((s) => s.actualMinutes));
    const learnedSizeMinutes = snapToBlockSize(medianActual);
    const actualSum = samples.reduce((sum, s) => sum + s.actualMinutes, 0);
    const plannedSum = samples.reduce((sum, s) => sum + s.plannedMinutes, 0);
    const sizeDriftPct =
      plannedSum > 0 ? Math.round(((actualSum - plannedSum) / plannedSum) * 100) : null;

    result.set(projectId, {
      learnedSizeMinutes,
      sizeDriftPct,
      sampleCount: samples.length,
    });
  }

  return result;
}

function extractSignificantWords(text: string): Set<string> {
  const words = new Set<string>();
  const matches = text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
  for (const word of matches) {
    if (!TITLE_STOPWORDS.has(word)) {
      words.add(word);
    }
  }
  return words;
}

function findMatchingPrepEvent(
  block: Block,
  todayEvents: ReadonlyArray<CalendarEvent>,
  projectById: ReadonlyMap<string, ProjectWithStats>,
): CalendarEvent | null {
  if (todayEvents.length === 0 || !PREP_KEYWORD_REGEX.test(block.title)) {
    return null;
  }

  const blockWords = extractSignificantWords(block.title);
  const project = projectById.get(block.projectId);
  const projectNameLower =
    project && !project.isSystem ? project.name.trim().toLowerCase() : null;

  for (const ev of todayEvents) {
    if (block.projectId !== SYSTEM_OTHER_PROJECT_ID && ev.projectId === block.projectId) {
      return ev;
    }
    const evLower = ev.title.toLowerCase();
    if (projectNameLower && projectNameLower.length >= 3 && evLower.includes(projectNameLower)) {
      return ev;
    }
    const evWords = extractSignificantWords(ev.title);
    for (const w of blockWords) {
      if (evWords.has(w)) {
        return ev;
      }
    }
  }

  return null;
}

function computeMotionHotSpots(
  veyraDb: VeyraDb,
  nowDate: Date,
  timezone: string,
): { motionProjectIds: Set<string>; motionSeriesIds: Set<string> } {
  const today = formatLocalDate(nowDate, timezone);
  const { weekStartDate, weekEndDate } = getWeekRange(today);
  const windowStartDate = addDaysToDateString(weekStartDate, -49);
  const windowStartMs = Date.parse(getLocalDayBoundsIso(windowStartDate, timezone).startIso);
  const windowEndMs = Date.parse(getLocalDayBoundsIso(weekEndDate, timezone).endIso);

  const ratedDoneBlocks = veyraDb.db
    .select({
      projectId: blocks.projectId,
      seriesId: blocks.seriesId,
      senseSignal: blocks.senseSignal,
      updatedAt: blocks.updatedAt,
    })
    .from(blocks)
    .where(and(eq(blocks.status, 'done'), isNull(blocks.deletedAt)))
    .all()
    .filter((blk) => {
      if (!blk.senseSignal) return false;
      const doneMs = Date.parse(blk.updatedAt);
      return doneMs >= windowStartMs && doneMs < windowEndMs;
    });

  const projectCounts = new Map<string, { rated: number; motion: number }>();
  const seriesCounts = new Map<string, { rated: number; motion: number }>();

  for (const blk of ratedDoneBlocks) {
    if (blk.projectId !== SYSTEM_OTHER_PROJECT_ID) {
      const pStats = projectCounts.get(blk.projectId) ?? { rated: 0, motion: 0 };
      pStats.rated += 1;
      if (blk.senseSignal === 'motion') pStats.motion += 1;
      projectCounts.set(blk.projectId, pStats);
    }

    if (blk.seriesId) {
      const sStats = seriesCounts.get(blk.seriesId) ?? { rated: 0, motion: 0 };
      sStats.rated += 1;
      if (blk.senseSignal === 'motion') sStats.motion += 1;
      seriesCounts.set(blk.seriesId, sStats);
    }
  }

  const motionProjectIds = new Set<string>();
  for (const [projectId, stats] of projectCounts.entries()) {
    if (stats.rated >= MIN_MOTION_HOTSPOT_SAMPLES && stats.motion / stats.rated >= MOTION_HOTSPOT_RATIO) {
      motionProjectIds.add(projectId);
    }
  }

  const motionSeriesIds = new Set<string>();
  for (const [seriesId, stats] of seriesCounts.entries()) {
    if (stats.rated >= MIN_MOTION_HOTSPOT_SAMPLES && stats.motion / stats.rated >= MOTION_HOTSPOT_RATIO) {
      motionSeriesIds.add(seriesId);
    }
  }

  return { motionProjectIds, motionSeriesIds };
}

function buildDayLookBack(
  veyraDb: VeyraDb,
  targetDate: DateOnly,
  isYesterday: boolean,
  completedBlocks: ReadonlyArray<Block>,
  allSessions: ReadonlyArray<FocusSession>,
  allEvents: ReadonlyArray<Pick<CalendarEvent, 'startAt' | 'endAt'>>,
  timezone: string,
  nowMs: number,
  notFitBlocks: Array<{ id: string; title: string; destination: string }>,
): DayLookBackSummary {
  const { startIso, endIso } = getLocalDayBoundsIso(targetDate, timezone);
  const dayStartMs = Date.parse(startIso);
  const dayEndMs = Date.parse(endIso);

  const allBlocksForLookup = veyraDb.db
    .select({ id: blocks.id, goalId: blocks.goalId })
    .from(blocks)
    .all();
  const blockToGoal = new Map<string, string | null>();
  for (const b of allBlocksForLookup) {
    blockToGoal.set(b.id, b.goalId);
  }

  let totalMs = 0;
  let goalMs = 0;
  for (const s of allSessions) {
    const sStart = Date.parse(s.startedAt);
    const sEnd = s.endedAt ? Date.parse(s.endedAt) : nowMs;
    const overlap = computeOverlapMs(sStart, sEnd, dayStartMs, dayEndMs);
    if (overlap > 0) {
      totalMs += overlap;
      if (blockToGoal.get(s.blockId)) {
        goalMs += overlap;
      }
    }
  }

  const focusedMinutes = msToRoundedMinutes(totalMs);
  const goalSharePct = totalMs > 0 ? Math.round((goalMs / totalMs) * 100) : 0;
  const movedGoalCount = completedBlocks.filter((b) => b.senseSignal === 'moved').length;
  const roomMinutes = computeWeekdayRoomWithPreloaded(
    targetDate,
    timezone,
    nowMs,
    allSessions,
    allEvents,
  ).roomMinutes;

  return {
    date: targetDate,
    isYesterday,
    focusedMinutes,
    roomMinutes,
    goalSharePct,
    movedGoalCount,
    completedCount: completedBlocks.length,
    notFitBlocks,
  };
}

/**
 * Computes Today's full capacity read model:
 * - `roomToday`: available focus room for `date`
 * - `suggestedOrder`: deterministic 4-tier suggested order + motion hot spot demotion + chronic carryover flagging
 * - `fitLine`: splits `upNext` in its CURRENT display order at cumulative `effectiveSizeMinutes <= roomToday.roomMinutes`
 * - `dayLookBack`: today's look-back once `upNext` is cleared and `completedToday.length > 0`,
 *   otherwise yesterday's look-back if yesterday had focus, completions, or rolled-over / dropped-no-room blocks.
 */
export function computeTodayCapacity(
  veyraDb: VeyraDb,
  options: ComputeTodayCapacityOptions,
): TodayCapacityResult {
  const { date, upNext, completedToday, todayEvents, projects, goals } = options;
  const nowDate = resolveNow(options.now);
  const nowMs = nowDate.getTime();
  const timezone = getActiveTimezone(veyraDb);

  const allSessions = veyraDb.db
    .select()
    .from(focusSessions)
    .where(isNull(focusSessions.deletedAt))
    .all();

  const allEvents = veyraDb.db
    .select({ startAt: calendarEvents.startAt, endAt: calendarEvents.endAt })
    .from(calendarEvents)
    .where(isNull(calendarEvents.deletedAt))
    .all();

  const roomToday = computeWeekdayRoomWithPreloaded(
    date,
    timezone,
    nowMs,
    allSessions,
    todayEvents,
  );

  const projectById = new Map<string, ProjectWithStats>();
  for (const p of projects) {
    projectById.set(p.id, p);
  }

  const goalById = new Map<string, GoalWithStats>();
  for (const g of goals) {
    goalById.set(g.id, g);
  }

  const { motionProjectIds, motionSeriesIds } = computeMotionHotSpots(veyraDb, nowDate, timezone);
  const tomorrow = addDaysToDateString(date, 1);

  interface RankedCandidate {
    item: SuggestedOrderItem;
    tier: number;
    subTier: number;
    primarySort: string;
    secondarySort: string;
  }

  const effectiveSizeByBlockId = new Map<string, BlockSizeMinutes>();
  const candidates: RankedCandidate[] = [];

  for (const blk of upNext) {
    const project = projectById.get(blk.projectId);
    const goal = blk.goalId ? goalById.get(blk.goalId) : undefined;
    const effectiveSizeMinutes: BlockSizeMinutes =
      blk.sizeMinutes ?? project?.learnedBlockSizeMinutes ?? DEFAULT_BLOCK_SIZE_MINUTES;
    effectiveSizeByBlockId.set(blk.id, effectiveSizeMinutes);

    const isChronicCarryover = blk.carryoverCount >= 3;
    const isMotionHotSpot =
      motionProjectIds.has(blk.projectId) ||
      (blk.seriesId !== null && motionSeriesIds.has(blk.seriesId));
    const isBehindWeeklyTime =
      project !== undefined &&
      project.weeklyTimeMinutes !== null &&
      (project.weeklyVarianceStatus === 'under' || project.weeklyVarianceStatus === 'untouched');

    const isDueSoon = blk.dueDate !== null && blk.dueDate <= tomorrow;
    const matchedPrepEvent = isDueSoon ? null : findMatchingPrepEvent(blk, todayEvents, projectById);
    const isCommitment = isDueSoon || matchedPrepEvent !== null;

    let tier: number;
    let subTier = 0;
    let primarySort = blk.orderKey;
    const secondarySort = blk.orderKey;
    let reason: string;

    if (isCommitment) {
      tier = 1;
      if (isDueSoon && blk.dueDate !== null) {
        subTier = 0;
        primarySort = blk.dueDate;
        reason =
          blk.dueDate < date
            ? 'Due date passed'
            : blk.dueDate === date
              ? 'Due today'
              : 'Due tomorrow';
      } else {
        subTier = 1;
        primarySort = matchedPrepEvent?.startAt ?? blk.orderKey;
        reason = matchedPrepEvent
          ? `Prep for "${matchedPrepEvent.title}"`
          : 'Prep for today’s meeting';
      }
    } else if (isMotionHotSpot) {
      tier = 5;
      subTier = 0;
      primarySort = blk.orderKey;
      reason = 'mostly just motion lately';
    } else if (!blk.isOps && (goal !== undefined || isBehindWeeklyTime)) {
      tier = 2;
      if (goal !== undefined && isBehindWeeklyTime) {
        subTier = 0;
        primarySort = goal.orderKey;
        reason = `Goal: ${goal.name} · behind weekly time`;
      } else if (goal !== undefined) {
        subTier = 1;
        primarySort = goal.orderKey;
        reason = `Supports ${goal.name}`;
      } else {
        subTier = 2;
        primarySort = project?.name ?? blk.orderKey;
        reason = project ? `${project.name} behind weekly time` : 'Behind weekly time';
      }
    } else if (!blk.isOps) {
      tier = 3;
      subTier = 0;
      primarySort = blk.orderKey;
      reason = isChronicCarryover ? 'Carried over 3+ times — decide or cut' : 'Scheduled for today';
    } else {
      tier = 4;
      subTier = 0;
      primarySort = blk.orderKey;
      reason = isChronicCarryover ? 'Ops · carried over 3+ times' : 'Ops — batch after main work';
    }

    candidates.push({
      item: {
        blockId: blk.id,
        effectiveSizeMinutes,
        reason,
        isChronicCarryover,
        isMotionHotSpot,
        isBehindWeeklyTime,
      },
      tier,
      subTier,
      primarySort,
      secondarySort,
    });
  }

  candidates.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (a.subTier !== b.subTier) return a.subTier - b.subTier;
    if (a.primarySort !== b.primarySort) {
      return a.primarySort < b.primarySort ? -1 : 1;
    }
    if (a.secondarySort !== b.secondarySort) {
      return a.secondarySort < b.secondarySort ? -1 : 1;
    }
    return a.item.blockId.localeCompare(b.item.blockId);
  });

  const suggestedOrder = candidates.map((c) => c.item);

  // Fit line splits `upNext` in its CURRENT display order at cumulative effectiveSizeMinutes <= roomMinutes
  let fitLineIndex = 0;
  let fittingMinutes = 0;
  for (let i = 0; i < upNext.length; i++) {
    const size = effectiveSizeByBlockId.get(upNext[i].id) ?? DEFAULT_BLOCK_SIZE_MINUTES;
    if (fittingMinutes + size <= roomToday.roomMinutes) {
      fittingMinutes += size;
      fitLineIndex = i + 1;
    } else {
      break;
    }
  }

  let overflowMinutes = 0;
  for (let i = fitLineIndex; i < upNext.length; i++) {
    overflowMinutes += effectiveSizeByBlockId.get(upNext[i].id) ?? DEFAULT_BLOCK_SIZE_MINUTES;
  }

  const fitLine: FitLineSummary = {
    fitLineIndex,
    fittingMinutes,
    remainingMinutes: Math.max(0, roomToday.roomMinutes - fittingMinutes),
    overflowBlockCount: upNext.length - fitLineIndex,
    overflowMinutes,
  };

  // Day look back
  let dayLookBack: DayLookBackSummary | null = null;
  if (upNext.length === 0 && completedToday.length > 0) {
    const { startIso, endIso } = getLocalDayBoundsIso(date, timezone);
    const todayStartMs = Date.parse(startIso);
    const todayEndMs = Date.parse(endIso);
    const droppedNoRoomToday = veyraDb.db
      .select()
      .from(blocks)
      .where(and(eq(blocks.status, 'dropped'), eq(blocks.dropReason, 'no_room'), isNull(blocks.deletedAt)))
      .all()
      .filter((blk) => {
        const updatedMs = Date.parse(blk.updatedAt);
        return updatedMs >= todayStartMs && updatedMs < todayEndMs;
      })
      .map((blk) => ({ id: blk.id, title: blk.title, destination: 'Dropped (no room)' }));

    dayLookBack = buildDayLookBack(
      veyraDb,
      date,
      false,
      completedToday,
      allSessions,
      allEvents,
      timezone,
      nowMs,
      droppedNoRoomToday,
    );
  } else {
    const yesterday = addDaysToDateString(date, -1);
    const { startIso, endIso } = getLocalDayBoundsIso(yesterday, timezone);
    const yStartMs = Date.parse(startIso);
    const yEndMs = Date.parse(endIso);

    const allActiveBlocks = veyraDb.db
      .select()
      .from(blocks)
      .where(isNull(blocks.deletedAt))
      .all();

    const completedYesterday = allActiveBlocks.filter((blk) => {
      if (blk.status !== 'done') return false;
      if (blk.scheduledDate === yesterday) return true;
      const updatedMs = Date.parse(blk.updatedAt);
      return updatedMs >= yStartMs && updatedMs < yEndMs;
    });

    const notFitYesterday: Array<{ id: string; title: string; destination: string }> = [];
    const seenNotFit = new Set<string>();

    for (const blk of upNext) {
      if (blk.carryoverCount > 0) {
        seenNotFit.add(blk.id);
        notFitYesterday.push({ id: blk.id, title: blk.title, destination: 'Moved to today' });
      }
    }

    for (const blk of allActiveBlocks) {
      if (seenNotFit.has(blk.id)) continue;
      if (blk.status === 'todo' && blk.bucket === 'scheduled' && blk.scheduledDate === yesterday) {
        seenNotFit.add(blk.id);
        notFitYesterday.push({ id: blk.id, title: blk.title, destination: 'Moved to today' });
      } else if (blk.status === 'dropped' && blk.dropReason === 'no_room') {
        const updatedMs = Date.parse(blk.updatedAt);
        if (updatedMs >= yStartMs && updatedMs < yEndMs) {
          seenNotFit.add(blk.id);
          notFitYesterday.push({ id: blk.id, title: blk.title, destination: 'Dropped (no room)' });
        }
      }
    }

    const yesterdayFocusMinutes = computeFocusMinutesForDate(
      allSessions,
      yesterday,
      timezone,
      nowMs,
    );

    if (
      yesterdayFocusMinutes > 0 ||
      completedYesterday.length > 0 ||
      notFitYesterday.length > 0
    ) {
      dayLookBack = buildDayLookBack(
        veyraDb,
        yesterday,
        true,
        completedYesterday,
        allSessions,
        allEvents,
        timezone,
        nowMs,
        notFitYesterday,
      );
    }
  }

  return {
    roomToday,
    suggestedOrder,
    fitLine,
    dayLookBack,
  };
}

/**
 * Assigns sequential fractional `orderKey`s to `blockIds` in a single atomic transaction.
 */
export function applySuggestedOrder(
  veyraDb: VeyraDb,
  blockIds: string[],
  options?: ServiceMutationOptions,
): Block[] {
  if (blockIds.length === 0) {
    return [];
  }

  const seen = new Set<string>();
  for (const id of blockIds) {
    if (seen.has(id)) {
      throw new ValidationError(`Duplicate blockId '${id}' in suggested order`);
    }
    seen.add(id);
  }

  const nowIso = resolveNow(options?.now).toISOString();
  const actor = resolveActor(options?.actor);

  const updated: Block[] = [];

  veyraDb.sqlite.transaction(() => {
    let prevKey: string | null = null;
    for (const id of blockIds) {
      const existing = veyraDb.db
        .select()
        .from(blocks)
        .where(and(eq(blocks.id, id), isNull(blocks.deletedAt)))
        .get();
      if (!existing) {
        throw new NotFoundError(`Block '${id}' not found`);
      }

      const nextOrderKey = generateOrderKey(prevKey, null);
      prevKey = nextOrderKey;

      veyraDb.db
        .update(blocks)
        .set({ orderKey: nextOrderKey, updatedAt: nowIso })
        .where(eq(blocks.id, id))
        .run();

      updated.push({
        ...existing,
        orderKey: nextOrderKey,
        updatedAt: nowIso,
      });
    }

    recordActivity(
      veyraDb,
      actor,
      'block.reordered',
      `Applied suggested order to ${updated.length} block${updated.length === 1 ? '' : 's'}`,
      nowIso,
    );
  })();

  return updated;
}

/**
 * Computes weekly project time strip (`plannedMinutes`, `loggedMinutes`, `weeklyTimeMinutes`)
 * and per-day `plannedMinutes` vs `roomMinutes` for the Plan view.
 */
export function computePlanCapacity(
  veyraDb: VeyraDb,
  days: ReadonlyArray<{ date: DateOnly; blocks: ReadonlyArray<Block> }>,
  projects: ReadonlyArray<ProjectWithStats>,
  now?: Date | string,
): PlanCapacityResult {
  const nowDate = resolveNow(now);
  const nowMs = nowDate.getTime();
  const timezone = getActiveTimezone(veyraDb);

  const projectById = new Map<string, ProjectWithStats>();
  for (const p of projects) {
    projectById.set(p.id, p);
  }

  const allSessions = veyraDb.db
    .select()
    .from(focusSessions)
    .where(isNull(focusSessions.deletedAt))
    .all();

  const allEvents = veyraDb.db
    .select({ startAt: calendarEvents.startAt, endAt: calendarEvents.endAt })
    .from(calendarEvents)
    .where(isNull(calendarEvents.deletedAt))
    .all();

  // Compute logged focus per project within the displayed week's [firstDay, lastDay] range
  const loggedMsByProject = new Map<string, number>();
  if (days.length > 0) {
    const rangeStartMs = Date.parse(getLocalDayBoundsIso(days[0].date, timezone).startIso);
    const rangeEndMs = Date.parse(
      getLocalDayBoundsIso(days[days.length - 1].date, timezone).endIso,
    );

    const allBlocksForLookup = veyraDb.db
      .select({ id: blocks.id, projectId: blocks.projectId })
      .from(blocks)
      .all();
    const blockToProject = new Map<string, string>();
    for (const b of allBlocksForLookup) {
      blockToProject.set(b.id, b.projectId);
    }

    for (const s of allSessions) {
      const projectId = blockToProject.get(s.blockId);
      if (!projectId) continue;
      const sStart = Date.parse(s.startedAt);
      const sEnd = s.endedAt ? Date.parse(s.endedAt) : nowMs;
      const overlap = computeOverlapMs(sStart, sEnd, rangeStartMs, rangeEndMs);
      if (overlap > 0) {
        loggedMsByProject.set(projectId, (loggedMsByProject.get(projectId) ?? 0) + overlap);
      }
    }
  }

  const plannedMinutesByProject = new Map<string, number>();
  const dayCapacities: PlanDayCapacity[] = [];

  for (const day of days) {
    let dayPlanned = 0;
    for (const blk of day.blocks) {
      if (blk.status === 'dropped') continue;
      const proj = projectById.get(blk.projectId);
      const size = blk.sizeMinutes ?? proj?.learnedBlockSizeMinutes ?? DEFAULT_BLOCK_SIZE_MINUTES;
      dayPlanned += size;
      plannedMinutesByProject.set(
        blk.projectId,
        (plannedMinutesByProject.get(blk.projectId) ?? 0) + size,
      );
    }

    const room = computeWeekdayRoomWithPreloaded(
      day.date,
      timezone,
      nowMs,
      allSessions,
      allEvents,
    );
    dayCapacities.push({
      date: day.date,
      plannedMinutes: dayPlanned,
      roomMinutes: room.roomMinutes,
    });
  }

  const projectTimeStrip: PlanProjectTimeItem[] = [];
  for (const project of projects) {
    const plannedMinutes = plannedMinutesByProject.get(project.id) ?? 0;
    const loggedMinutes = msToRoundedMinutes(loggedMsByProject.get(project.id) ?? 0);
    if (
      project.weeklyTimeMinutes !== null ||
      plannedMinutes > 0 ||
      loggedMinutes > 0
    ) {
      projectTimeStrip.push({
        projectId: project.id,
        plannedMinutes,
        loggedMinutes,
        weeklyTimeMinutes: project.weeklyTimeMinutes,
      });
    }
  }

  return {
    projectTimeStrip,
    dayCapacities,
  };
}
