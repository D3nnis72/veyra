import crypto from 'node:crypto';
import { and, asc, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import type { VeyraDb } from '../db.js';
import { NotFoundError, ValidationError, parseWithZod } from '../errors.js';
import { calendarEvents, goals, projects } from '../schema.js';
import {
  type AutoMatchCalendarEventsResult,
  type CalendarEvent,
  type CalendarEventSource,
  type NormalizedCalendarEvent,
  type UpdateCalendarEventInput,
  type UpsertCalendarEventsResult,
  calendarEventSourceSchema,
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
 * Stage 1: inherit the assignment of an existing meeting with the same normalized title.
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
      title: calendarEvents.title,
      projectId: calendarEvents.projectId,
      goalId: calendarEvents.goalId,
      isOps: calendarEvents.isOps,
    })
    .from(calendarEvents)
    .where(and(isNull(calendarEvents.deletedAt), isNotNull(calendarEvents.projectId)))
    .orderBy(desc(calendarEvents.updatedAt))
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
  eventId: string,
  assignment: MeetingAssignment,
  nowIso: string,
): void {
  veyraDb.db
    .update(calendarEvents)
    .set({
      projectId: assignment.projectId,
      goalId: assignment.goalId,
      isOps: assignment.isOps,
      updatedAt: nowIso,
    })
    .where(and(eq(calendarEvents.id, eventId), isNull(calendarEvents.projectId)))
    .run();
}

/**
 * Retro-matches every non-deleted, still-unassigned calendar event against learned
 * titles and Project keywords. Never touches events that already carry a `projectId`.
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
      .select({ id: calendarEvents.id, title: calendarEvents.title })
      .from(calendarEvents)
      .where(and(isNull(calendarEvents.deletedAt), isNull(calendarEvents.projectId)))
      .orderBy(asc(calendarEvents.startAt))
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
 * Upserts normalized calendar events by `(source, externalId)`, preserving user-owned
 * metadata (`projectId`, `goalId`, `isOps`, `notes`, `externalLinks`) across re-syncs.
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
    const tryAutoMatch = (event: CalendarEvent): CalendarEvent => {
      if (event.projectId !== null) return event;
      const assignment = matcher.match(event.title);
      if (!assignment) return event;
      applyAssignment(veyraDb, event.id, assignment, nowIso);
      autoMatchedCount++;
      return { ...event, ...assignment };
    };

    for (const ev of parsedEvents) {
      if (currentSettings.skipDeclinedAndAllDay && (ev.isAllDay || ev.isDeclined)) {
        const existingActive = veyraDb.db
          .select({ id: calendarEvents.id })
          .from(calendarEvents)
          .where(
            and(
              eq(calendarEvents.source, validSource),
              eq(calendarEvents.externalId, ev.externalId),
              isNull(calendarEvents.deletedAt),
            ),
          )
          .get();

        if (existingActive) {
          veyraDb.db
            .update(calendarEvents)
            .set({ deletedAt: nowIso, updatedAt: nowIso })
            .where(eq(calendarEvents.id, existingActive.id))
            .run();
          deletedCount++;
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

      const existing = veyraDb.db
        .select()
        .from(calendarEvents)
        .where(
          and(
            eq(calendarEvents.source, validSource),
            eq(calendarEvents.externalId, ev.externalId),
          ),
        )
        .get();

      if (existing) {
        const updated: CalendarEvent = {
          ...existing,
          title: ev.title,
          startAt: normalizedStart,
          endAt: normalizedEnd,
          meetingUrl: ev.meetingUrl ?? null,
          updatedAt: nowIso,
          deletedAt: null,
        };

        veyraDb.db
          .update(calendarEvents)
          .set({
            title: updated.title,
            startAt: updated.startAt,
            endAt: updated.endAt,
            meetingUrl: updated.meetingUrl,
            updatedAt: updated.updatedAt,
            deletedAt: null,
          })
          .where(eq(calendarEvents.id, existing.id))
          .run();

        upserted.push(tryAutoMatch(updated));
        updatedCount++;
      } else {
        const created: CalendarEvent = {
          id: crypto.randomUUID(),
          externalId: ev.externalId,
          title: ev.title,
          startAt: normalizedStart,
          endAt: normalizedEnd,
          meetingUrl: ev.meetingUrl ?? null,
          source: validSource,
          projectId: null,
          goalId: null,
          isOps: false,
          notes: '',
          externalLinks: [],
          updatedAt: nowIso,
          deletedAt: null,
        };

        veyraDb.db.insert(calendarEvents).values(created).run();
        upserted.push(tryAutoMatch(created));
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
    .from(calendarEvents)
    .where(and(eq(calendarEvents.id, id), isNull(calendarEvents.deletedAt)))
    .get();
  if (!row) {
    throw new NotFoundError(`CalendarEvent '${id}' not found`);
  }
  return row;
}

export function updateCalendarEvent(
  veyraDb: VeyraDb,
  id: string,
  input: UpdateCalendarEventInput,
  options?: ServiceMutationOptions,
): CalendarEvent {
  const existing = getCalendarEvent(veyraDb, id);
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

  const updated: CalendarEvent = {
    ...existing,
    projectId: parsed.projectId !== undefined ? parsed.projectId : existing.projectId,
    goalId: parsed.goalId !== undefined ? parsed.goalId : existing.goalId,
    isOps: parsed.isOps ?? existing.isOps,
    notes: parsed.notes ?? existing.notes,
    externalLinks: parsed.externalLinks ?? existing.externalLinks,
    updatedAt: nowIso,
  };

  veyraDb.sqlite.transaction(() => {
    veyraDb.db
      .update(calendarEvents)
      .set({
        projectId: updated.projectId,
        goalId: updated.goalId,
        isOps: updated.isOps,
        notes: updated.notes,
        externalLinks: updated.externalLinks,
        updatedAt: updated.updatedAt,
      })
      .where(eq(calendarEvents.id, id))
      .run();

    recordActivity(
      veyraDb,
      actor,
      'calendar.event_updated',
      `Updated calendar event "${updated.title}"`,
      nowIso,
    );
  })();

  return updated;
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
    .from(calendarEvents)
    .where(isNull(calendarEvents.deletedAt))
    .orderBy(asc(calendarEvents.startAt))
    .all();

  return rows.filter((ev) => {
    const evStart = Date.parse(ev.startAt);
    const evEnd = Date.parse(ev.endAt);
    return evStart < endMs && evEnd > startMs;
  });
}
