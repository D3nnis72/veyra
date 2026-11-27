import crypto from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { VeyraDb } from '../db.js';
import { ConflictError, NotFoundError, ValidationError, parseWithZod } from '../errors.js';
import { blocks, focusSessions } from '../schema.js';
import { formatLocalDate, getLocalDayBoundsIso } from '../time.js';
import {
  type ActivityActor,
  type AdjustFocusStartResult,
  type Block,
  type CloseFocusResult,
  type CompleteBlockInput,
  type CompleteBlockResult,
  type FocusSession,
  type FocusStatus,
  type ListSessionsFilter,
  type LogSessionInput,
  type RemoveFocusGapInput,
  type RemoveFocusGapResult,
  type SplitSessionInput,
  type SplitSessionResult,
  type StartFocusResult,
  type TrimSessionInput,
  completeBlockInputSchema,
  isoTimestampSchema,
  logSessionInputSchema,
  removeFocusGapInputSchema,
  splitSessionInputSchema,
  trimSessionInputSchema,
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

export type {
  AdjustFocusStartResult,
  CloseFocusResult,
  CompleteBlockResult,
  ListSessionsFilter,
  RemoveFocusGapResult,
  SplitSessionResult,
  StartFocusResult,
};

function getActiveBlockOrThrow(veyraDb: VeyraDb, blockId: string): Block {
  const blk = veyraDb.db
    .select()
    .from(blocks)
    .where(and(eq(blocks.id, blockId), isNull(blocks.deletedAt)))
    .get();
  if (!blk) {
    throw new NotFoundError(`Block '${blockId}' not found`);
  }
  return blk;
}

function getActiveOpenSession(veyraDb: VeyraDb): FocusSession | null {
  const row = veyraDb.db
    .select()
    .from(focusSessions)
    .where(and(isNull(focusSessions.endedAt), isNull(focusSessions.deletedAt)))
    .orderBy(desc(focusSessions.startedAt))
    .get();
  return row ?? null;
}

function getSessionOrThrow(veyraDb: VeyraDb, sessionId: string): FocusSession {
  const row = veyraDb.db
    .select()
    .from(focusSessions)
    .where(and(eq(focusSessions.id, sessionId), isNull(focusSessions.deletedAt)))
    .get();
  if (!row) {
    throw new NotFoundError(`FocusSession '${sessionId}' not found`);
  }
  return row;
}

function formatSessionRangeForError(startIso: string, endIso: string | null, timezone: string): string {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const start = fmt.format(new Date(startIso));
  if (!endIso) {
    return `${start} to now`;
  }
  const end = fmt.format(new Date(endIso));
  return `${start} to ${end}`;
}

function assertNoSessionOverlap(
  veyraDb: VeyraDb,
  startMs: number,
  endMs: number,
  excludeSessionId?: string,
): void {
  const existing = veyraDb.db
    .select()
    .from(focusSessions)
    .where(isNull(focusSessions.deletedAt))
    .all();

  for (const s of existing) {
    if (excludeSessionId && s.id === excludeSessionId) {
      continue;
    }
    const sStart = Date.parse(s.startedAt);
    const sEnd = s.endedAt ? Date.parse(s.endedAt) : Number.POSITIVE_INFINITY;
    if (startMs < sEnd && sStart < endMs) {
      const blk = veyraDb.db.select().from(blocks).where(eq(blocks.id, s.blockId)).get();
      const label = blk ? `"${blk.title}"` : `block '${s.blockId}'`;
      const range = formatSessionRangeForError(s.startedAt, s.endedAt, getActiveTimezone(veyraDb));
      throw new ConflictError(
        `Session interval overlaps with an existing session on ${label} (${range}, id ${s.id}). Delete or trim that session first.`,
      );
    }
  }
}

function calculateFocusedTodayMinutes(
  veyraDb: VeyraDb,
  nowDate: Date,
  timezone: string,
): number {
  const today = formatLocalDate(nowDate, timezone);
  const { startIso, endIso } = getLocalDayBoundsIso(today, timezone);
  const dayStartMs = Date.parse(startIso);
  const dayEndMs = Date.parse(endIso);
  const nowMs = nowDate.getTime();

  const sessions = veyraDb.db
    .select()
    .from(focusSessions)
    .where(isNull(focusSessions.deletedAt))
    .all();

  let totalMs = 0;
  for (const s of sessions) {
    const sStart = Date.parse(s.startedAt);
    const sEnd = s.endedAt ? Date.parse(s.endedAt) : nowMs;
    totalMs += computeOverlapMs(sStart, sEnd, dayStartMs, dayEndMs);
  }

  return msToRoundedMinutes(totalMs);
}

/**
 * Starts a focus session on `blockId`. Enforces the single-focus invariant by
 * automatically closing any currently open session first.
 * Optionally accepts a past `startedAt` ISO timestamp when starting late.
 */
export function startFocus(
  veyraDb: VeyraDb,
  blockId: string,
  now?: Date | string,
  options?: { actor?: ActivityActor; startedAt?: string },
): StartFocusResult {
  const block = getActiveBlockOrThrow(veyraDb, blockId);
  const nowDate = resolveNow(now);
  const nowIso = nowDate.toISOString();
  const nowMs = nowDate.getTime();
  const actor = resolveActor(options?.actor);

  let effectiveStartMs = nowMs;
  if (options?.startedAt !== undefined) {
    const validStart = parseWithZod(isoTimestampSchema, options.startedAt);
    effectiveStartMs = Date.parse(validStart);
    if (effectiveStartMs > nowMs) {
      throw new ValidationError('Focus start time cannot be in the future');
    }
  }
  const effectiveStartIso = new Date(effectiveStartMs).toISOString();

  let closedSession: FocusSession | null = null;
  const startedSession: FocusSession = {
    id: crypto.randomUUID(),
    blockId: block.id,
    startedAt: effectiveStartIso,
    endedAt: null,
    note: null,
    updatedAt: nowIso,
    deletedAt: null,
  };

  veyraDb.sqlite.transaction(() => {
    const open = getActiveOpenSession(veyraDb);
    if (open) {
      const openStartMs = Date.parse(open.startedAt);
      if (effectiveStartMs < openStartMs) {
        throw new ValidationError('Cannot close active focus session at a timestamp before it started');
      }
      veyraDb.db
        .update(focusSessions)
        .set({ endedAt: effectiveStartIso, updatedAt: nowIso })
        .where(eq(focusSessions.id, open.id))
        .run();
      closedSession = {
        ...open,
        endedAt: effectiveStartIso,
        updatedAt: nowIso,
      };
    }

    if (options?.startedAt !== undefined) {
      assertNoSessionOverlap(veyraDb, effectiveStartMs, nowMs, open?.id);
    }

    veyraDb.db.insert(focusSessions).values(startedSession).run();
    recordActivity(
      veyraDb,
      actor,
      'focus.started',
      `Started focus on "${block.title}"`,
      nowIso,
    );
  })();

  return {
    closedSession,
    startedSession,
    block,
  };
}

/**
 * Adjusts `startedAt` of the currently active open focus session (e.g. when you forgot to
 * press start 15 minutes ago). Rejects future timestamps and overlaps with earlier sessions.
 */
export function updateActiveFocusStartTime(
  veyraDb: VeyraDb,
  startedAt: string,
  now?: Date | string,
  options?: { actor?: ActivityActor },
): AdjustFocusStartResult {
  const validStart = parseWithZod(isoTimestampSchema, startedAt);
  const startMs = Date.parse(validStart);
  const nowDate = resolveNow(now);
  const nowIso = nowDate.toISOString();
  const nowMs = nowDate.getTime();
  const actor = resolveActor(options?.actor);

  if (startMs > nowMs) {
    throw new ValidationError('Start time cannot be in the future');
  }

  const open = getActiveOpenSession(veyraDb);
  if (!open) {
    throw new NotFoundError('No active focus session to adjust');
  }

  const block = getActiveBlockOrThrow(veyraDb, open.blockId);
  const normalizedStartIso = new Date(startMs).toISOString();
  const updatedSession: FocusSession = {
    ...open,
    startedAt: normalizedStartIso,
    updatedAt: nowIso,
  };

  veyraDb.sqlite.transaction(() => {
    assertNoSessionOverlap(veyraDb, startMs, nowMs, open.id);
    veyraDb.db
      .update(focusSessions)
      .set({ startedAt: normalizedStartIso, updatedAt: nowIso })
      .where(eq(focusSessions.id, open.id))
      .run();
    recordActivity(
      veyraDb,
      actor,
      'focus.start_time_adjusted',
      `Adjusted focus start time on "${block.title}"`,
      nowIso,
    );
  })();

  return {
    session: updatedSession,
    block,
  };
}

/**
 * Cuts a gap out of the running focus session (a pause you forgot to log). The open session is
 * closed at `gapStartAt` and a new open session on the same block starts at `gapEndAt`
 * (default: now), so the gap counts as neither focus time nor block time. The timer keeps running
 * from the end of the gap.
 */
export function removeActiveFocusGap(
  veyraDb: VeyraDb,
  input: RemoveFocusGapInput,
  now?: Date | string,
  options?: { actor?: ActivityActor },
): RemoveFocusGapResult {
  const parsed = parseWithZod(removeFocusGapInputSchema, input);
  const nowDate = resolveNow(now);
  const nowIso = nowDate.toISOString();
  const nowMs = nowDate.getTime();
  const actor = resolveActor(options?.actor);

  const open = getActiveOpenSession(veyraDb);
  if (!open) {
    throw new NotFoundError('No active focus session to remove a gap from');
  }

  const gapStartMs = Date.parse(parsed.gapStartAt);
  const gapEndMs = parsed.gapEndAt !== undefined ? Date.parse(parsed.gapEndAt) : nowMs;
  if (gapEndMs <= gapStartMs) {
    throw new ValidationError('The pause must end after it started');
  }
  if (gapEndMs > nowMs) {
    throw new ValidationError('The pause cannot end in the future');
  }
  if (gapStartMs <= Date.parse(open.startedAt)) {
    throw new ValidationError(
      'The pause must start after the session started. To drop the whole session, cancel it instead.',
    );
  }

  const block = getActiveBlockOrThrow(veyraDb, open.blockId);
  const gapStartIso = new Date(gapStartMs).toISOString();
  const gapEndIso = new Date(gapEndMs).toISOString();

  const closedSession: FocusSession = {
    ...open,
    endedAt: gapStartIso,
    updatedAt: nowIso,
  };
  const startedSession: FocusSession = {
    id: crypto.randomUUID(),
    blockId: open.blockId,
    startedAt: gapEndIso,
    endedAt: null,
    note: open.note,
    updatedAt: nowIso,
    deletedAt: null,
  };

  veyraDb.sqlite.transaction(() => {
    veyraDb.db
      .update(focusSessions)
      .set({ endedAt: gapStartIso, updatedAt: nowIso })
      .where(eq(focusSessions.id, open.id))
      .run();
    veyraDb.db.insert(focusSessions).values(startedSession).run();
    recordActivity(
      veyraDb,
      actor,
      'session.gap_removed',
      `Removed ${msToRoundedMinutes(gapEndMs - gapStartMs)}m pause from focus on "${block.title}"`,
      nowIso,
    );
  })();

  return { closedSession, startedSession, block };
}

export function resumeFocus(
  veyraDb: VeyraDb,
  blockId: string,
  now?: Date | string,
  options?: { actor?: ActivityActor },
): StartFocusResult {
  return startFocus(veyraDb, blockId, now, options);
}

/**
 * Pauses the running session. `input.endedAt` ends it earlier than now (for example when you
 * walked away and only notice later), it must lie between the session start and now.
 */
export function pauseFocus(
  veyraDb: VeyraDb,
  input?: { note?: string | null; endedAt?: string },
  now?: Date | string,
  options?: { actor?: ActivityActor },
): CloseFocusResult {
  const nowDate = resolveNow(now);
  const nowIso = nowDate.toISOString();
  const actor = resolveActor(options?.actor);

  const open = getActiveOpenSession(veyraDb);
  if (!open) {
    throw new NotFoundError('No active focus session to pause');
  }
  if (nowDate.getTime() < Date.parse(open.startedAt)) {
    throw new ValidationError('Cannot pause focus session at a timestamp before it started');
  }

  let endedIso = nowIso;
  if (input?.endedAt !== undefined) {
    const endedMs = Date.parse(parseWithZod(isoTimestampSchema, input.endedAt));
    if (endedMs > nowDate.getTime()) {
      throw new ValidationError('Pause time cannot be in the future');
    }
    if (endedMs <= Date.parse(open.startedAt)) {
      throw new ValidationError('Pause time must be after the session started');
    }
    endedIso = new Date(endedMs).toISOString();
  }

  const block = getActiveBlockOrThrow(veyraDb, open.blockId);
  const nextNote = input?.note !== undefined ? input.note : open.note;
  const nextResumeNote = input?.note !== undefined ? input.note : block.resumeNote;

  const closedSession: FocusSession = {
    ...open,
    endedAt: endedIso,
    note: nextNote,
    updatedAt: nowIso,
  };
  const updatedBlock: Block = {
    ...block,
    resumeNote: nextResumeNote,
    updatedAt: input?.note !== undefined ? nowIso : block.updatedAt,
  };

  veyraDb.sqlite.transaction(() => {
    veyraDb.db
      .update(focusSessions)
      .set({
        endedAt: closedSession.endedAt,
        note: closedSession.note,
        updatedAt: closedSession.updatedAt,
      })
      .where(eq(focusSessions.id, open.id))
      .run();

    if (input?.note !== undefined) {
      veyraDb.db
        .update(blocks)
        .set({ resumeNote: nextResumeNote, updatedAt: nowIso })
        .where(eq(blocks.id, block.id))
        .run();
    }

    recordActivity(
      veyraDb,
      actor,
      'focus.paused',
      `Paused focus on "${block.title}"`,
      nowIso,
    );
  })();

  return {
    closedSession,
    block: updatedBlock,
  };
}

export function stopFocus(
  veyraDb: VeyraDb,
  now?: Date | string,
  options?: { actor?: ActivityActor },
): CloseFocusResult {
  const nowDate = resolveNow(now);
  const nowIso = nowDate.toISOString();
  const actor = resolveActor(options?.actor);

  const open = getActiveOpenSession(veyraDb);
  if (!open) {
    throw new NotFoundError('No active focus session to stop');
  }
  if (nowDate.getTime() < Date.parse(open.startedAt)) {
    throw new ValidationError('Cannot stop focus session at a timestamp before it started');
  }

  const block = getActiveBlockOrThrow(veyraDb, open.blockId);
  const closedSession: FocusSession = {
    ...open,
    endedAt: nowIso,
    updatedAt: nowIso,
  };

  veyraDb.sqlite.transaction(() => {
    veyraDb.db
      .update(focusSessions)
      .set({ endedAt: nowIso, updatedAt: nowIso })
      .where(eq(focusSessions.id, open.id))
      .run();

    recordActivity(
      veyraDb,
      actor,
      'focus.stopped',
      `Stopped focus on "${block.title}"`,
      nowIso,
    );
  })();

  return {
    closedSession,
    block,
  };
}

/**
 * Cancels the running focus session: the session is discarded (soft-deleted), so its time
 * does not count anywhere. Use `stopFocus` to end a session but keep the tracked time.
 */
export function cancelFocus(
  veyraDb: VeyraDb,
  now?: Date | string,
  options?: { actor?: ActivityActor },
): CloseFocusResult {
  const nowIso = resolveNow(now).toISOString();
  const actor = resolveActor(options?.actor);

  const open = getActiveOpenSession(veyraDb);
  if (!open) {
    throw new NotFoundError('No active focus session to cancel');
  }

  const block = getActiveBlockOrThrow(veyraDb, open.blockId);
  const closedSession: FocusSession = {
    ...open,
    endedAt: nowIso,
    updatedAt: nowIso,
    deletedAt: nowIso,
  };

  veyraDb.sqlite.transaction(() => {
    veyraDb.db
      .update(focusSessions)
      .set({ endedAt: nowIso, updatedAt: nowIso, deletedAt: nowIso })
      .where(eq(focusSessions.id, open.id))
      .run();

    recordActivity(
      veyraDb,
      actor,
      'focus.cancelled',
      `Cancelled focus on "${block.title}" (session discarded)`,
      nowIso,
    );
  })();

  return { closedSession, block };
}

export function completeBlock(
  veyraDb: VeyraDb,
  blockId?: string,
  input?: CompleteBlockInput,
  now?: Date | string,
  options?: { actor?: ActivityActor },
): CompleteBlockResult {
  const parsed = parseWithZod(completeBlockInputSchema, input ?? {});
  const nowDate = resolveNow(now);
  const nowIso = nowDate.toISOString();
  const nowMs = nowDate.getTime();
  const actor = resolveActor(options?.actor);

  const open = getActiveOpenSession(veyraDb);
  const resolvedBlockId = blockId ?? open?.blockId;
  if (!resolvedBlockId) {
    throw new NotFoundError('No active focus session to complete');
  }

  const existingBlock = getActiveBlockOrThrow(veyraDb, resolvedBlockId);

  let closedSession: FocusSession | null = null;
  let currentSessionMinutes = 0;

  if (open && open.blockId === resolvedBlockId) {
    const startMs = Date.parse(open.startedAt);
    if (nowMs < startMs) {
      throw new ValidationError('Cannot complete block at a timestamp before active session started');
    }
    closedSession = {
      ...open,
      endedAt: nowIso,
      updatedAt: nowIso,
    };
    currentSessionMinutes = msToRoundedMinutes(nowMs - startMs);
  }

  const completedBlock: Block = {
    ...existingBlock,
    status: 'done',
    energySignal:
      parsed.energySignal !== undefined ? parsed.energySignal : existingBlock.energySignal,
    senseSignal:
      parsed.senseSignal !== undefined ? parsed.senseSignal : existingBlock.senseSignal,
    outcomeNote:
      parsed.outcomeNote !== undefined ? parsed.outcomeNote : existingBlock.outcomeNote,
    updatedAt: nowIso,
  };

  veyraDb.sqlite.transaction(() => {
    if (closedSession) {
      veyraDb.db
        .update(focusSessions)
        .set({ endedAt: nowIso, updatedAt: nowIso })
        .where(eq(focusSessions.id, closedSession.id))
        .run();
    }

    veyraDb.db
      .update(blocks)
      .set({
        status: 'done',
        energySignal: completedBlock.energySignal,
        senseSignal: completedBlock.senseSignal,
        outcomeNote: completedBlock.outcomeNote,
        updatedAt: nowIso,
      })
      .where(eq(blocks.id, resolvedBlockId))
      .run();

    recordActivity(
      veyraDb,
      actor,
      'block.completed',
      `Completed block "${completedBlock.title}"`,
      nowIso,
    );
  })();

  const allBlockSessions = veyraDb.db
    .select()
    .from(focusSessions)
    .where(and(eq(focusSessions.blockId, resolvedBlockId), isNull(focusSessions.deletedAt)))
    .all();

  let totalMs = 0;
  for (const s of allBlockSessions) {
    const sStart = Date.parse(s.startedAt);
    const sEnd = s.endedAt ? Date.parse(s.endedAt) : nowMs;
    if (sEnd > sStart) {
      totalMs += sEnd - sStart;
    }
  }

  return {
    block: completedBlock,
    closedSession,
    currentSessionMinutes,
    totalBlockMinutes: msToRoundedMinutes(totalMs),
  };
}

export function logManualSession(
  veyraDb: VeyraDb,
  input: LogSessionInput,
  options?: ServiceMutationOptions,
): FocusSession {
  const parsed = parseWithZod(logSessionInputSchema, input);
  const block = getActiveBlockOrThrow(veyraDb, parsed.blockId);

  const startMs = Date.parse(parsed.startedAt);
  const endMs = Date.parse(parsed.endedAt);
  if (endMs <= startMs) {
    throw new ValidationError('endedAt must be strictly after startedAt');
  }

  const nowIso = resolveNow(options?.now).toISOString();
  const actor = resolveActor(options?.actor);

  const session: FocusSession = {
    id: crypto.randomUUID(),
    blockId: block.id,
    startedAt: new Date(startMs).toISOString(),
    endedAt: new Date(endMs).toISOString(),
    note: parsed.note ?? null,
    updatedAt: nowIso,
    deletedAt: null,
  };

  veyraDb.sqlite.transaction(() => {
    assertNoSessionOverlap(veyraDb, startMs, endMs);
    veyraDb.db.insert(focusSessions).values(session).run();
    recordActivity(
      veyraDb,
      actor,
      'session.logged',
      `Logged ${msToRoundedMinutes(endMs - startMs)}m session on "${block.title}"`,
      nowIso,
    );
  })();

  return session;
}

export function trimSession(
  veyraDb: VeyraDb,
  sessionId: string,
  input: TrimSessionInput,
  options?: ServiceMutationOptions,
): FocusSession {
  const existing = getSessionOrThrow(veyraDb, sessionId);
  const parsed = parseWithZod(trimSessionInputSchema, input);

  const startMs = Date.parse(parsed.startedAt);
  const endMs = Date.parse(parsed.endedAt);
  if (endMs <= startMs) {
    throw new ValidationError('endedAt must be strictly after startedAt');
  }

  const nowIso = resolveNow(options?.now).toISOString();
  const actor = resolveActor(options?.actor);

  const updated: FocusSession = {
    ...existing,
    startedAt: new Date(startMs).toISOString(),
    endedAt: new Date(endMs).toISOString(),
    note: parsed.note !== undefined ? parsed.note : existing.note,
    updatedAt: nowIso,
  };

  veyraDb.sqlite.transaction(() => {
    assertNoSessionOverlap(veyraDb, startMs, endMs, sessionId);
    veyraDb.db
      .update(focusSessions)
      .set({
        startedAt: updated.startedAt,
        endedAt: updated.endedAt,
        note: updated.note,
        updatedAt: updated.updatedAt,
      })
      .where(eq(focusSessions.id, sessionId))
      .run();
    recordActivity(veyraDb, actor, 'session.trimmed', `Trimmed focus session '${sessionId}'`, nowIso);
  })();

  return updated;
}

export function splitSession(
  veyraDb: VeyraDb,
  sessionId: string,
  input: SplitSessionInput,
  options?: ServiceMutationOptions,
): SplitSessionResult {
  const existing = getSessionOrThrow(veyraDb, sessionId);
  const parsed = parseWithZod(splitSessionInputSchema, input);

  if (!existing.endedAt) {
    throw new ValidationError('Cannot split an active open focus session; pause or stop it first');
  }

  const startMs = Date.parse(existing.startedAt);
  const endMs = Date.parse(existing.endedAt);
  const breakStartMs = Date.parse(parsed.breakStartAt);
  const breakEndMs = breakStartMs + parsed.breakMinutes * 60_000;

  if (breakStartMs <= startMs || breakEndMs >= endMs) {
    throw new ValidationError(
      'Break window must fall strictly inside the session start and end boundaries',
    );
  }

  const nowIso = resolveNow(options?.now).toISOString();
  const actor = resolveActor(options?.actor);

  const firstSession: FocusSession = {
    ...existing,
    endedAt: new Date(breakStartMs).toISOString(),
    updatedAt: nowIso,
  };

  const secondSession: FocusSession = {
    id: crypto.randomUUID(),
    blockId: existing.blockId,
    startedAt: new Date(breakEndMs).toISOString(),
    endedAt: existing.endedAt,
    note: existing.note,
    updatedAt: nowIso,
    deletedAt: null,
  };

  veyraDb.sqlite.transaction(() => {
    veyraDb.db
      .update(focusSessions)
      .set({ endedAt: firstSession.endedAt, updatedAt: nowIso })
      .where(eq(focusSessions.id, sessionId))
      .run();

    veyraDb.db.insert(focusSessions).values(secondSession).run();

    recordActivity(
      veyraDb,
      actor,
      'session.split',
      `Split focus session '${sessionId}' with ${parsed.breakMinutes}m break`,
      nowIso,
    );
  })();

  return { firstSession, secondSession };
}

export function deleteSession(
  veyraDb: VeyraDb,
  sessionId: string,
  options?: ServiceMutationOptions,
): FocusSession {
  const existing = getSessionOrThrow(veyraDb, sessionId);
  const nowIso = resolveNow(options?.now).toISOString();
  const actor = resolveActor(options?.actor);

  const deleted: FocusSession = {
    ...existing,
    updatedAt: nowIso,
    deletedAt: nowIso,
  };

  veyraDb.sqlite.transaction(() => {
    veyraDb.db
      .update(focusSessions)
      .set({ deletedAt: nowIso, updatedAt: nowIso })
      .where(eq(focusSessions.id, sessionId))
      .run();

    recordActivity(veyraDb, actor, 'session.deleted', `Deleted focus session '${sessionId}'`, nowIso);
  })();

  return deleted;
}

export function listSessions(
  veyraDb: VeyraDb,
  filters?: ListSessionsFilter,
): FocusSession[] {
  const conditions = [isNull(focusSessions.deletedAt)];
  if (filters?.blockId) {
    conditions.push(eq(focusSessions.blockId, filters.blockId));
  }

  let rows = veyraDb.db
    .select()
    .from(focusSessions)
    .where(and(...conditions))
    .orderBy(desc(focusSessions.startedAt))
    .all();

  if (filters?.startIso || filters?.endIso) {
    const startBound = filters.startIso ? Date.parse(filters.startIso) : Number.NEGATIVE_INFINITY;
    const endBound = filters.endIso ? Date.parse(filters.endIso) : Number.POSITIVE_INFINITY;
    rows = rows.filter((s) => {
      const sStart = Date.parse(s.startedAt);
      const sEnd = s.endedAt ? Date.parse(s.endedAt) : Number.POSITIVE_INFINITY;
      return sStart < endBound && sEnd > startBound;
    });
  }

  return rows;
}

export function getFocusStatus(veyraDb: VeyraDb, now?: Date | string): FocusStatus {
  const nowDate = resolveNow(now);
  const timezone = getActiveTimezone(veyraDb);
  const activeSession = getActiveOpenSession(veyraDb);

  let activeBlock: Block | null = null;
  let elapsedSeconds = 0;

  if (activeSession) {
    const blk = veyraDb.db
      .select()
      .from(blocks)
      .where(and(eq(blocks.id, activeSession.blockId), isNull(blocks.deletedAt)))
      .get();
    activeBlock = blk ?? null;
    elapsedSeconds = Math.max(
      0,
      Math.floor((nowDate.getTime() - Date.parse(activeSession.startedAt)) / 1000),
    );
  }

  const focusedTodayMinutes = calculateFocusedTodayMinutes(veyraDb, nowDate, timezone);

  const today = formatLocalDate(nowDate, timezone);
  const { startIso: dayStartIso } = getLocalDayBoundsIso(today, timezone);
  const dayStartMs = Date.parse(dayStartIso);
  const nowMs = nowDate.getTime();

  let lastClosedSessionEndedAt: string | null = null;
  let lastClosedMs = -1;
  const recentSessions = veyraDb.db
    .select({ id: focusSessions.id, endedAt: focusSessions.endedAt })
    .from(focusSessions)
    .where(isNull(focusSessions.deletedAt))
    .all();
  for (const s of recentSessions) {
    if (!s.endedAt || (activeSession && s.id === activeSession.id)) continue;
    const endMs = Date.parse(s.endedAt);
    if (endMs >= dayStartMs && endMs <= nowMs && endMs > lastClosedMs) {
      lastClosedMs = endMs;
      lastClosedSessionEndedAt = s.endedAt;
    }
  }

  return {
    activeSession,
    activeBlock,
    elapsedSeconds,
    focusedTodayMinutes,
    lastClosedSessionEndedAt,
  };
}
