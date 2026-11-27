import crypto from 'node:crypto';
import { and, asc, desc, eq, isNotNull, isNull, ne } from 'drizzle-orm';
import type { VeyraDb } from '../db.js';
import { NotFoundError, ValidationError, parseWithZod } from '../errors.js';
import { generateOrderKey } from '../order-key.js';
import { blocks, focusSessions, goals, projects } from '../schema.js';
import { formatLocalDate } from '../time.js';
import {
  type AutoMatchCalendarEventsResult,
  type Block,
  type CalendarEvent,
  type CalendarEventSource,
  type NormalizedCalendarEvent,
  SYSTEM_OTHER_PROJECT_ID,
  type Settings,
  type UpdateCalendarEventInput,
  type UpsertCalendarEventsResult,
  calendarEventSourceSchema,
  normalizeBlockSizeMinutes,
  normalizedCalendarEventSchema,
  updateCalendarEventInputSchema,
} from '../types.js';
import {
  type ServiceMutationOptions,
  recordActivity,
  resolveActor,
  resolveNow,
} from './internal.js';
import { getSettings } from './settings.js';

export type { AutoMatchCalendarEventsResult, UpsertCalendarEventsResult };

// ---------------------------------------------------------------------------
// Helpers: Block <-> CalendarEvent projection & sync filter
// ---------------------------------------------------------------------------

/** Projects a calendar-synced `Block` row into the `CalendarEvent` read shape. */
export function blockToCalendarEvent(block: Block): CalendarEvent {
  return {
    id: block.id,
    externalId: block.externalEventId ?? block.id,
    title: block.title,
    startAt: block.plannedStartAt ?? block.updatedAt,
    endAt: block.plannedEndAt ?? block.updatedAt,
    meetingUrl: block.meetingUrl ?? null,
    source: block.calendarSource ?? 'manual',
    projectId: block.projectId === SYSTEM_OTHER_PROJECT_ID ? null : block.projectId,
    goalId: block.goalId,
    isOps: block.isOps,
    notes: block.notes,
    externalLinks: block.externalLinks,
    status: block.status,
    updatedAt: block.updatedAt,
    deletedAt: block.deletedAt,
  };
}

/**
 * Returns true when an incoming synced event should be skipped (and removed if previously
 * synced without tracked focus time) under the current settings.
 *
 * When `skipDeclinedAndAllDay` is enabled:
 * - all-day, declined, and cancelled events are excluded;
 * - events that carry a `responseStatus` are only kept when `'accepted'` or `'organizer'`.
 */
export function isCalendarEventExcluded(
  ev: NormalizedCalendarEvent,
  settings: Pick<Settings, 'skipDeclinedAndAllDay'>,
): boolean {
  if (!settings.skipDeclinedAndAllDay) {
    return false;
  }
  if (ev.isAllDay || ev.isDeclined || ev.isCancelled) {
    return true;
  }
  if (ev.responseStatus !== undefined && ev.responseStatus !== null) {
    return ev.responseStatus !== 'accepted' && ev.responseStatus !== 'organizer';
  }
  return false;
}

// ---------------------------------------------------------------------------
// Meeting -> Project auto-matching
// ---------------------------------------------------------------------------

interface MeetingAssignment {
  projectId: string;
  goalId: string | null;
  isOps: boolean;
}

interface KeywordCandidate {
  projectId: string;
  goalId: string | null;
  keywords: string[];
}

interface MeetingMatcher {
  match(title: string): MeetingAssignment | null;
}

/** Normalizes a meeting title for learned (Stage 1) matching. */
export function normalizeMeetingTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}

const WORD_CHARS = 'a-z0-9äöüß';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function keywordMatches(normalizedTitle: string, keyword: string): boolean {
  const escaped = escapeRegExp(keyword.toLowerCase().replace(/\s+/g, ' '));
  const re = new RegExp(`(?:^|[^${WORD_CHARS}])${escaped}(?:$|[^${WORD_CHARS}])`);
  return re.test(normalizedTitle);
}

/**
 * Builds a deterministic two-stage matcher from the current DB state.
 * Stage 1: inherit the assignment of an existing synced meeting block with the same normalized title.
 * Stage 2: active, non-system Projects matched by `matchKeywords` (or by name when the
 * Project has no keywords and its name has >= 3 chars); longest keyword wins, ties keep
 * the first Project in name order.
 */
function buildMeetingMatcher(veyraDb: VeyraDb): MeetingMatcher {
  const liveProjectIds = new Set(
    veyraDb.db
      .select({ id: projects.id })
      .from(projects)
      .where(isNull(projects.deletedAt))
      .all()
      .map((row) => row.id),
  );

  const learned = new Map<string, MeetingAssignment>();
  const assignedRows = veyraDb.db
    .select({
      title: blocks.title,
      projectId: blocks.projectId,
      goalId: blocks.goalId,
      isOps: blocks.isOps,
    })
    .from(blocks)
    .where(
      and(
        isNull(blocks.deletedAt),
        isNotNull(blocks.calendarSource),
        ne(blocks.projectId, SYSTEM_OTHER_PROJECT_ID),
      ),
    )
    .orderBy(desc(blocks.updatedAt))
    .all();
  for (const row of assignedRows) {
    if (!row.projectId || !liveProjectIds.has(row.projectId)) continue;
    const key = normalizeMeetingTitle(row.title);
    if (!key || learned.has(key)) continue;
    learned.set(key, { projectId: row.projectId, goalId: row.goalId, isOps: row.isOps });
  }

  const candidates: KeywordCandidate[] = veyraDb.db
    .select()
    .from(projects)
    .where(
      and(
        isNull(projects.deletedAt),
        eq(projects.status, 'active'),
        eq(projects.isSystem, false),
      ),
    )
    .orderBy(asc(projects.name), asc(projects.createdAt))
    .all()
    .map((project) => {
      const explicit = (project.matchKeywords ?? []).map((k) => k.trim()).filter(Boolean);
      const keywords =
        explicit.length > 0
          ? explicit
          : project.name.trim().length >= 3
            ? [project.name.trim()]
            : [];
      return { projectId: project.id, goalId: project.defaultGoalId ?? null, keywords };
    })
    .filter((candidate) => candidate.keywords.length > 0);

  return {
    match(title: string): MeetingAssignment | null {
      const normalized = normalizeMeetingTitle(title);
      if (!normalized) return null;

      const fromHistory = learned.get(normalized);
      if (fromHistory) return fromHistory;

      let best: { candidate: KeywordCandidate; length: number } | null = null;
      for (const candidate of candidates) {
        for (const keyword of candidate.keywords) {
          if (!keywordMatches(normalized, keyword)) continue;
          const length = keyword.length;
          if (!best || length > best.length) {
            best = { candidate, length };
          }
        }
      }
      if (!best) return null;
      return { projectId: best.candidate.projectId, goalId: best.candidate.goalId, isOps: false };
    },
  };
}

function applyAssignment(
  veyraDb: VeyraDb,
  blockId: string,
  assignment: MeetingAssignment,
  nowIso: string,
): void {
  veyraDb.db
    .update(blocks)
    .set({
      projectId: assignment.projectId,
      goalId: assignment.goalId,
      isOps: assignment.isOps,
      updatedAt: nowIso,
    })
    .where(and(eq(blocks.id, blockId), eq(blocks.projectId, SYSTEM_OTHER_PROJECT_ID)))
    .run();
}

/**
 * Retro-matches every non-deleted, still-unassigned calendar block against learned
 * titles and Project keywords. Never touches calendar blocks already assigned to a real Project.
 */
export function autoMatchUnassignedCalendarEvents(
  veyraDb: VeyraDb,
  now?: Date | string,
  options?: Omit<ServiceMutationOptions, 'now'>,
): AutoMatchCalendarEventsResult {
  const nowIso = resolveNow(now).toISOString();
  const actor = resolveActor(options?.actor);
  let matchedCount = 0;

  veyraDb.sqlite.transaction(() => {
    const matcher = buildMeetingMatcher(veyraDb);
    const unassigned = veyraDb.db
      .select({ id: blocks.id, title: blocks.title })
      .from(blocks)
      .where(
        and(
          isNull(blocks.deletedAt),
          isNotNull(blocks.calendarSource),
          eq(blocks.projectId, SYSTEM_OTHER_PROJECT_ID),
        ),
      )
      .orderBy(asc(blocks.plannedStartAt))
      .all();

    for (const row of unassigned) {
      const assignment = matcher.match(row.title);
      if (!assignment) continue;
      applyAssignment(veyraDb, row.id, assignment, nowIso);
      matchedCount++;
    }

    if (matchedCount > 0) {
      recordActivity(
        veyraDb,
        actor,
        'calendar.auto_matched',
        `Auto-matched ${matchedCount} calendar event${matchedCount === 1 ? '' : 's'} to projects`,
        nowIso,
      );
    }
  })();

  return { matchedCount };
}

/**
 * Upserts normalized calendar events directly into `blocks` keyed by
 * `(calendarSource, externalEventId)`, preserving user-owned metadata
 * (`projectId`, `goalId`, `isOps`, `notes`, `externalLinks`, `status`,
 * `outcomeNote`, `energySignal`, `senseSignal`, `autoSummary`, `sideWork`) across re-syncs.
 */
export function upsertCalendarEvents(
  veyraDb: VeyraDb,
  source: CalendarEventSource,
  events: NormalizedCalendarEvent[],
  options?: ServiceMutationOptions,
): UpsertCalendarEventsResult {
  const validSource = parseWithZod(calendarEventSourceSchema, source);
  const parsedEvents = events.map((ev) => parseWithZod(normalizedCalendarEventSchema, ev));
  const nowIso = resolveNow(options?.now).toISOString();
  const actor = resolveActor(options?.actor);
  const currentSettings = getSettings(veyraDb);

  const upserted: CalendarEvent[] = [];
  let createdCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let deletedCount = 0;
  let autoMatchedCount = 0;

  veyraDb.sqlite.transaction(() => {
    const matcher = buildMeetingMatcher(veyraDb);
    const tryAutoMatch = (block: Block): Block => {
      if (block.projectId !== SYSTEM_OTHER_PROJECT_ID) return block;
      const assignment = matcher.match(block.title);
      if (!assignment) return block;
      applyAssignment(veyraDb, block.id, assignment, nowIso);
      autoMatchedCount++;
      return { ...block, ...assignment };
    };

    for (const ev of parsedEvents) {
      if (isCalendarEventExcluded(ev, currentSettings)) {
        const existingActive = veyraDb.db
          .select({ id: blocks.id, status: blocks.status })
          .from(blocks)
          .where(
            and(
              eq(blocks.calendarSource, validSource),
              eq(blocks.externalEventId, ev.externalId),
              isNull(blocks.deletedAt),
            ),
          )
          .get();

        if (existingActive && existingActive.status !== 'done') {
          const hasSession = veyraDb.db
            .select({ id: focusSessions.id })
            .from(focusSessions)
            .where(and(eq(focusSessions.blockId, existingActive.id), isNull(focusSessions.deletedAt)))
            .limit(1)
            .get();

          if (!hasSession) {
            veyraDb.db
              .update(blocks)
              .set({ deletedAt: nowIso, updatedAt: nowIso })
              .where(eq(blocks.id, existingActive.id))
              .run();
            deletedCount++;
          }
        }

        skippedCount++;
        continue;
      }

      const startMs = Date.parse(ev.startAt);
      const endMs = Date.parse(ev.endAt);
      if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
        throw new ValidationError(
          `Calendar event '${ev.externalId}' has invalid startAt/endAt range`,
        );
      }

      const normalizedStart = new Date(startMs).toISOString();
      const normalizedEnd = new Date(endMs).toISOString();
      const scheduledDate = formatLocalDate(new Date(startMs), currentSettings.timezone);
      const sizeMinutes = normalizeBlockSizeMinutes(Math.round((endMs - startMs) / 60_000));

      const existing = veyraDb.db
        .select()
        .from(blocks)
        .where(
          and(
            eq(blocks.calendarSource, validSource),
            eq(blocks.externalEventId, ev.externalId),
          ),
        )
        .get();

      if (existing) {
        const updated: Block = {
          ...existing,
          title: ev.title,
          bucket: 'scheduled',
          scheduledDate,
          plannedStartAt: normalizedStart,
          plannedEndAt: normalizedEnd,
          sizeMinutes,
          meetingUrl: ev.meetingUrl ?? null,
          updatedAt: nowIso,
          deletedAt: null,
        };

        veyraDb.db
          .update(blocks)
          .set({
            title: updated.title,
            bucket: updated.bucket,
            scheduledDate: updated.scheduledDate,
            plannedStartAt: updated.plannedStartAt,
            plannedEndAt: updated.plannedEndAt,
            sizeMinutes: updated.sizeMinutes,
            meetingUrl: updated.meetingUrl,
            updatedAt: updated.updatedAt,
            deletedAt: null,
          })
          .where(eq(blocks.id, existing.id))
          .run();

        upserted.push(blockToCalendarEvent(tryAutoMatch(updated)));
        updatedCount++;
      } else {
        const created: Block = {
          id: crypto.randomUUID(),
          projectId: SYSTEM_OTHER_PROJECT_ID,
          goalId: null,
          title: ev.title,
          isOps: false,
          bucket: 'scheduled',
          scheduledDate,
          plannedStartAt: normalizedStart,
          plannedEndAt: normalizedEnd,
          dueDate: null,
          revisitAt: null,
          orderKey: generateOrderKey(),
          status: 'todo',
          carryoverCount: 0,
          sizeMinutes,
          energySignal: null,
          senseSignal: null,
          dropReason: null,
          outcomeNote: null,
          resumeNote: null,
          autoSummary: null,
          sideWork: null,
          recurrenceRule: null,
          seriesId: null,
          notes: '',
          externalLinks: [],
          calendarSource: validSource,
          externalEventId: ev.externalId,
          meetingUrl: ev.meetingUrl ?? null,
          updatedAt: nowIso,
          deletedAt: null,
        };

        veyraDb.db.insert(blocks).values(created).run();
        upserted.push(blockToCalendarEvent(tryAutoMatch(created)));
        createdCount++;
      }
    }

    if (createdCount > 0 || updatedCount > 0 || deletedCount > 0) {
      recordActivity(
        veyraDb,
        actor,
        'calendar.synced',
        `Synced ${createdCount} new, ${updatedCount} updated, and ${deletedCount} removed calendar events from ${validSource}${
          autoMatchedCount > 0 ? ` (${autoMatchedCount} auto-matched to projects)` : ''
        }`,
        nowIso,
      );
    }
  })();

  return { upserted, createdCount, updatedCount, skippedCount, deletedCount, autoMatchedCount };
}

export function getCalendarEvent(veyraDb: VeyraDb, id: string): CalendarEvent {
  const row = veyraDb.db
    .select()
    .from(blocks)
    .where(and(eq(blocks.id, id), isNotNull(blocks.calendarSource), isNull(blocks.deletedAt)))
    .get();
  if (!row) {
    throw new NotFoundError(`CalendarEvent '${id}' not found`);
  }
  return blockToCalendarEvent(row);
}

export function updateCalendarEvent(
  veyraDb: VeyraDb,
  id: string,
  input: UpdateCalendarEventInput,
  options?: ServiceMutationOptions,
): CalendarEvent {
  const existingRow = veyraDb.db
    .select()
    .from(blocks)
    .where(and(eq(blocks.id, id), isNotNull(blocks.calendarSource), isNull(blocks.deletedAt)))
    .get();
  if (!existingRow) {
    throw new NotFoundError(`CalendarEvent '${id}' not found`);
  }

  const parsed = parseWithZod(updateCalendarEventInputSchema, input);
  const nowIso = resolveNow(options?.now).toISOString();
  const actor = resolveActor(options?.actor);

  if (parsed.projectId !== undefined && parsed.projectId !== null) {
    const project = veyraDb.db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, parsed.projectId), isNull(projects.deletedAt)))
      .get();
    if (!project) {
      throw new NotFoundError(`Project '${parsed.projectId}' not found`);
    }
  }

  if (parsed.goalId !== undefined && parsed.goalId !== null) {
    const goal = veyraDb.db
      .select({ id: goals.id })
      .from(goals)
      .where(and(eq(goals.id, parsed.goalId), isNull(goals.deletedAt)))
      .get();
    if (!goal) {
      throw new NotFoundError(`Goal '${parsed.goalId}' not found`);
    }
  }

  const nextProjectId =
    parsed.projectId === undefined
      ? existingRow.projectId
      : parsed.projectId === null
        ? SYSTEM_OTHER_PROJECT_ID
        : parsed.projectId;

  const updated: Block = {
    ...existingRow,
    projectId: nextProjectId,
    goalId: parsed.goalId !== undefined ? parsed.goalId : existingRow.goalId,
    isOps: parsed.isOps ?? existingRow.isOps,
    notes: parsed.notes ?? existingRow.notes,
    externalLinks: parsed.externalLinks ?? existingRow.externalLinks,
    updatedAt: nowIso,
  };

  veyraDb.sqlite.transaction(() => {
    veyraDb.db
      .update(blocks)
      .set({
        projectId: updated.projectId,
        goalId: updated.goalId,
        isOps: updated.isOps,
        notes: updated.notes,
        externalLinks: updated.externalLinks,
        updatedAt: updated.updatedAt,
      })
      .where(eq(blocks.id, id))
      .run();

    recordActivity(
      veyraDb,
      actor,
      'calendar.event_updated',
      `Updated calendar event "${updated.title}"`,
      nowIso,
    );
  })();

  return blockToCalendarEvent(updated);
}

export function listCalendarEvents(
  veyraDb: VeyraDb,
  startIso: string,
  endIso: string,
): CalendarEvent[] {
  const startMs = Date.parse(startIso);
  const endMs = Date.parse(endIso);
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) {
    throw new ValidationError('Invalid startIso/endIso range for listCalendarEvents');
  }

  const rows = veyraDb.db
    .select()
    .from(blocks)
    .where(
      and(
        isNull(blocks.deletedAt),
        isNotNull(blocks.calendarSource),
        isNotNull(blocks.plannedStartAt),
        isNotNull(blocks.plannedEndAt),
      ),
    )
    .orderBy(asc(blocks.plannedStartAt))
    .all();

  return rows
    .filter((blk) => {
      const evStart = Date.parse(blk.plannedStartAt!);
      const evEnd = Date.parse(blk.plannedEndAt!);
      return evStart < endMs && evEnd > startMs;
    })
    .map(blockToCalendarEvent);
}
