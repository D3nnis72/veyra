import crypto from 'node:crypto';
import { and, asc, desc, eq, isNull, lte } from 'drizzle-orm';
import type { VeyraDb } from '../db.js';
import { NotFoundError, ValidationError, parseWithZod } from '../errors.js';
import { generateOrderKey } from '../order-key.js';
import { blocks, focusSessions, goals, projects } from '../schema.js';
import { formatLocalDate, resolveRevisitDate } from '../time.js';
import {
  type Block,
  type BlockBucket,
  type BlockDetail,
  type CreateBlockInput,
  type DropReason,
  type ListBlocksFilter,
  type MoveBlockInput,
  type ParkBlockInput,
  type ReorderBlockInput,
  type RevisitHorizon,
  SYSTEM_OTHER_PROJECT_ID,
  type UpdateBlockInput,
  createBlockInputSchema,
  dateOnlySchema,
  dropReasonSchema,
  moveBlockInputSchema,
  parkBlockInputSchema,
  reorderBlockInputSchema,
  updateBlockInputSchema,
} from '../types.js';
import {
  type ServiceMutationOptions,
  getActiveTimezone,
  msToRoundedMinutes,
  recordActivity,
  resolveActor,
  resolveNow,
} from './internal.js';

export type { ListBlocksFilter };

function getActiveBlockOrThrow(veyraDb: VeyraDb, id: string): Block {
  const row = veyraDb.db
    .select()
    .from(blocks)
    .where(and(eq(blocks.id, id), isNull(blocks.deletedAt)))
    .get();
  if (!row) {
    throw new NotFoundError(`Block '${id}' not found`);
  }
  return row;
}

function getActiveProjectOrThrow(veyraDb: VeyraDb, projectId: string) {
  const row = veyraDb.db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    .get();
  if (!row) {
    throw new NotFoundError(`Project '${projectId}' not found`);
  }
  return row;
}

function ensureActiveGoalOrThrow(veyraDb: VeyraDb, goalId: string): void {
  const row = veyraDb.db
    .select({ id: goals.id })
    .from(goals)
    .where(and(eq(goals.id, goalId), isNull(goals.deletedAt)))
    .get();
  if (!row) {
    throw new NotFoundError(`Goal '${goalId}' not found`);
  }
}

function normalizePlannedSlot(
  plannedStartAt: string | null,
  plannedEndAt: string | null,
): { plannedStartAt: string | null; plannedEndAt: string | null } {
  if (plannedStartAt === null && plannedEndAt === null) {
    return { plannedStartAt: null, plannedEndAt: null };
  }
  if (plannedStartAt === null || plannedEndAt === null) {
    throw new ValidationError('plannedStartAt and plannedEndAt must both be provided or both null');
  }
  const startMs = Date.parse(plannedStartAt);
  const endMs = Date.parse(plannedEndAt);
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
    throw new ValidationError('plannedEndAt must be strictly after plannedStartAt');
  }
  return {
    plannedStartAt: new Date(startMs).toISOString(),
    plannedEndAt: new Date(endMs).toISOString(),
  };
}

interface BucketPlacementInput {
  bucket?: BlockBucket;
  scheduledDate?: string | null;
  plannedStartAt?: string | null;
  plannedEndAt?: string | null;
  revisitAt?: RevisitHorizon | null;
}

interface BucketPlacementState {
  bucket: BlockBucket;
  scheduledDate: string | null;
  plannedStartAt: string | null;
  plannedEndAt: string | null;
  revisitAt: string | null;
}

function resolveBucketPlacement(
  current: BucketPlacementState,
  input: BucketPlacementInput,
  today: string,
  timezone: string,
): BucketPlacementState {
  const hasPlannedSlotInput =
    input.plannedStartAt !== undefined || input.plannedEndAt !== undefined;

  let nextBucket: BlockBucket = input.bucket ?? current.bucket;
  if (
    !input.bucket &&
    (input.scheduledDate || (hasPlannedSlotInput && (input.plannedStartAt || input.plannedEndAt)))
  ) {
    nextBucket = 'scheduled';
  } else if (!input.bucket && input.revisitAt) {
    nextBucket = 'later';
  }

  let nextScheduledDate =
    input.scheduledDate !== undefined ? input.scheduledDate : current.scheduledDate;
  let nextPlannedStartAt =
    input.plannedStartAt !== undefined ? input.plannedStartAt : current.plannedStartAt;
  let nextPlannedEndAt =
    input.plannedEndAt !== undefined ? input.plannedEndAt : current.plannedEndAt;
  let nextRevisitAt = current.revisitAt;
  if (input.revisitAt !== undefined) {
    nextRevisitAt =
      input.revisitAt === null ? null : resolveRevisitDate(input.revisitAt, today);
  }

  if (nextBucket === 'inbox') {
    nextScheduledDate = null;
    nextPlannedStartAt = null;
    nextPlannedEndAt = null;
    nextRevisitAt = null;
  } else if (nextBucket === 'later') {
    nextScheduledDate = null;
    nextPlannedStartAt = null;
    nextPlannedEndAt = null;
    if (nextRevisitAt === null) {
      nextRevisitAt = resolveRevisitDate('2w', today);
    }
  } else if (nextBucket === 'scheduled') {
    nextRevisitAt = null;
    const normalizedSlot = normalizePlannedSlot(nextPlannedStartAt, nextPlannedEndAt);
    nextPlannedStartAt = normalizedSlot.plannedStartAt;
    nextPlannedEndAt = normalizedSlot.plannedEndAt;
    if (input.scheduledDate === undefined && input.plannedStartAt && nextPlannedStartAt) {
      nextScheduledDate = formatLocalDate(nextPlannedStartAt, timezone);
    }
    if (nextScheduledDate === null) {
      nextScheduledDate = nextPlannedStartAt
        ? formatLocalDate(nextPlannedStartAt, timezone)
        : today;
    }
  }

  return {
    bucket: nextBucket,
    scheduledDate: nextScheduledDate,
    plannedStartAt: nextPlannedStartAt,
    plannedEndAt: nextPlannedEndAt,
    revisitAt: nextRevisitAt,
  };
}

function nextOrderKeyForBucket(
  veyraDb: VeyraDb,
  bucket: BlockBucket,
  scheduledDate: string | null,
): string {
  const conditions = [isNull(blocks.deletedAt), eq(blocks.bucket, bucket)];
  if (bucket === 'scheduled' && scheduledDate !== null) {
    conditions.push(eq(blocks.scheduledDate, scheduledDate));
  }
  const existing = veyraDb.db
    .select({ orderKey: blocks.orderKey })
    .from(blocks)
    .where(and(...conditions))
    .orderBy(asc(blocks.orderKey))
    .all();

  const lastKey = existing.length > 0 ? existing[existing.length - 1].orderKey : null;
  return generateOrderKey(lastKey, null);
}

export function createBlock(
  veyraDb: VeyraDb,
  input: CreateBlockInput,
  options?: ServiceMutationOptions,
): Block {
  const parsed = parseWithZod(createBlockInputSchema, input);
  const nowDate = resolveNow(options?.now);
  const nowIso = nowDate.toISOString();
  const actor = resolveActor(options?.actor);
  const timezone = getActiveTimezone(veyraDb);
  const today = formatLocalDate(nowDate, timezone);

  const projectId = parsed.projectId ?? SYSTEM_OTHER_PROJECT_ID;
  const project = getActiveProjectOrThrow(veyraDb, projectId);

  let goalId: string | null;
  if (parsed.goalId !== undefined) {
    if (parsed.goalId !== null) {
      ensureActiveGoalOrThrow(veyraDb, parsed.goalId);
    }
    goalId = parsed.goalId;
  } else if (project.defaultGoalId) {
    const defaultGoal = veyraDb.db
      .select({ id: goals.id })
      .from(goals)
      .where(and(eq(goals.id, project.defaultGoalId), isNull(goals.deletedAt)))
      .get();
    goalId = defaultGoal ? defaultGoal.id : null;
  } else {
    goalId = null;
  }

  const recurrenceRule = parsed.recurrenceRule ?? null;

  const initialBucket: BlockBucket =
    parsed.bucket ??
    (parsed.scheduledDate || parsed.plannedStartAt || parsed.plannedEndAt || recurrenceRule
      ? 'scheduled'
      : parsed.revisitAt
        ? 'later'
        : 'inbox');

  const placement = resolveBucketPlacement(
    {
      bucket: initialBucket,
      scheduledDate: null,
      plannedStartAt: null,
      plannedEndAt: null,
      revisitAt: null,
    },
    {
      bucket: initialBucket,
      scheduledDate: parsed.scheduledDate,
      plannedStartAt: parsed.plannedStartAt,
      plannedEndAt: parsed.plannedEndAt,
      revisitAt: parsed.revisitAt,
    },
    today,
    timezone,
  );

  const seriesId = recurrenceRule ? crypto.randomUUID() : null;
  const orderKey =
    parsed.orderKey ?? nextOrderKeyForBucket(veyraDb, placement.bucket, placement.scheduledDate);

  const block: Block = {
    id: crypto.randomUUID(),
    projectId,
    goalId,
    title: parsed.title,
    isOps: parsed.isOps,
    bucket: placement.bucket,
    scheduledDate: placement.scheduledDate,
    plannedStartAt: placement.plannedStartAt,
    plannedEndAt: placement.plannedEndAt,
    dueDate: parsed.dueDate ?? null,
    revisitAt: placement.revisitAt,
    orderKey,
    status: 'todo',
    carryoverCount: 0,
    sizeMinutes: parsed.sizeMinutes ?? null,
    energySignal: null,
    senseSignal: parsed.senseSignal ?? null,
    dropReason: parsed.dropReason ?? null,
    outcomeNote: null,
    resumeNote: null,
    autoSummary: null,
    recurrenceRule,
    seriesId,
    notes: parsed.notes,
    externalLinks: parsed.externalLinks,
    updatedAt: nowIso,
    deletedAt: null,
  };

  veyraDb.sqlite.transaction(() => {
    veyraDb.db.insert(blocks).values(block).run();
    recordActivity(veyraDb, actor, 'block.created', `Created block "${block.title}"`, nowIso);
  })();

  return block;
}

export function getBlock(veyraDb: VeyraDb, id: string): Block {
  return getActiveBlockOrThrow(veyraDb, id);
}

export function listBlocks(veyraDb: VeyraDb, filter?: ListBlocksFilter): Block[] {
  const conditions = [isNull(blocks.deletedAt)];

  if (filter?.bucket) {
    conditions.push(eq(blocks.bucket, filter.bucket));
  }
  if (filter?.scheduledDate) {
    parseWithZod(dateOnlySchema, filter.scheduledDate);
    conditions.push(eq(blocks.scheduledDate, filter.scheduledDate));
  }
  if (filter?.projectId) {
    conditions.push(eq(blocks.projectId, filter.projectId));
  }
  if (filter?.goalId) {
    conditions.push(eq(blocks.goalId, filter.goalId));
  }
  if (filter?.status) {
    conditions.push(eq(blocks.status, filter.status));
  }
  if (filter?.isOps !== undefined) {
    conditions.push(eq(blocks.isOps, filter.isOps));
  }
  if (filter?.dueBefore) {
    parseWithZod(dateOnlySchema, filter.dueBefore);
    conditions.push(lte(blocks.dueDate, filter.dueBefore));
  }

  let rows = veyraDb.db
    .select()
    .from(blocks)
    .where(and(...conditions))
    .orderBy(asc(blocks.orderKey))
    .all();

  if (!filter?.status) {
    if (filter?.includeDropped === false) {
      rows = rows.filter((b) => b.status !== 'dropped');
    }
    if (filter?.includeDone === false) {
      rows = rows.filter((b) => b.status !== 'done');
    }
  }

  return rows;
}

export function updateBlock(
  veyraDb: VeyraDb,
  id: string,
  input: UpdateBlockInput,
  options?: ServiceMutationOptions,
): Block {
  const existing = getActiveBlockOrThrow(veyraDb, id);
  const parsed = parseWithZod(updateBlockInputSchema, input);
  const nowDate = resolveNow(options?.now);
  const nowIso = nowDate.toISOString();
  const actor = resolveActor(options?.actor);
  const timezone = getActiveTimezone(veyraDb);
  const today = formatLocalDate(nowDate, timezone);

  if (parsed.projectId !== undefined) {
    getActiveProjectOrThrow(veyraDb, parsed.projectId);
  }
  if (parsed.goalId !== undefined && parsed.goalId !== null) {
    ensureActiveGoalOrThrow(veyraDb, parsed.goalId);
  }

  const placement = resolveBucketPlacement(
    {
      bucket: existing.bucket,
      scheduledDate: existing.scheduledDate,
      plannedStartAt: existing.plannedStartAt,
      plannedEndAt: existing.plannedEndAt,
      revisitAt: existing.revisitAt,
    },
    {
      bucket: parsed.bucket,
      scheduledDate: parsed.scheduledDate,
      plannedStartAt: parsed.plannedStartAt,
      plannedEndAt: parsed.plannedEndAt,
      revisitAt: parsed.revisitAt,
    },
    today,
    timezone,
  );

  const locationChanged =
    placement.bucket !== existing.bucket || placement.scheduledDate !== existing.scheduledDate;
  const nextOrderKey =
    parsed.orderKey ??
    (locationChanged
      ? nextOrderKeyForBucket(veyraDb, placement.bucket, placement.scheduledDate)
      : existing.orderKey);

  const nextRecurrenceRule =
    parsed.recurrenceRule !== undefined ? parsed.recurrenceRule : existing.recurrenceRule;
  const nextSeriesId =
    nextRecurrenceRule && !existing.seriesId ? crypto.randomUUID() : existing.seriesId;

  const updated: Block = {
    ...existing,
    title: parsed.title ?? existing.title,
    projectId: parsed.projectId ?? existing.projectId,
    goalId: parsed.goalId !== undefined ? parsed.goalId : existing.goalId,
    isOps: parsed.isOps ?? existing.isOps,
    bucket: placement.bucket,
    scheduledDate: placement.scheduledDate,
    plannedStartAt: placement.plannedStartAt,
    plannedEndAt: placement.plannedEndAt,
    dueDate: parsed.dueDate !== undefined ? parsed.dueDate : existing.dueDate,
    revisitAt: placement.revisitAt,
    orderKey: nextOrderKey,
    status: parsed.status ?? existing.status,
    sizeMinutes: parsed.sizeMinutes !== undefined ? parsed.sizeMinutes : existing.sizeMinutes,
    energySignal:
      parsed.energySignal !== undefined ? parsed.energySignal : existing.energySignal,
    senseSignal: parsed.senseSignal !== undefined ? parsed.senseSignal : existing.senseSignal,
    dropReason: parsed.dropReason !== undefined ? parsed.dropReason : existing.dropReason,
    outcomeNote: parsed.outcomeNote !== undefined ? parsed.outcomeNote : existing.outcomeNote,
    resumeNote: parsed.resumeNote !== undefined ? parsed.resumeNote : existing.resumeNote,
    autoSummary: parsed.autoSummary !== undefined ? parsed.autoSummary : existing.autoSummary,
    recurrenceRule: nextRecurrenceRule,
    seriesId: nextSeriesId,
    notes: parsed.notes ?? existing.notes,
    externalLinks: parsed.externalLinks ?? existing.externalLinks,
    updatedAt: nowIso,
  };

  veyraDb.sqlite.transaction(() => {
    veyraDb.db
      .update(blocks)
      .set({
        title: updated.title,
        projectId: updated.projectId,
        goalId: updated.goalId,
        isOps: updated.isOps,
        bucket: updated.bucket,
        scheduledDate: updated.scheduledDate,
        plannedStartAt: updated.plannedStartAt,
        plannedEndAt: updated.plannedEndAt,
        dueDate: updated.dueDate,
        revisitAt: updated.revisitAt,
        orderKey: updated.orderKey,
        status: updated.status,
        sizeMinutes: updated.sizeMinutes,
        energySignal: updated.energySignal,
        senseSignal: updated.senseSignal,
        dropReason: updated.dropReason,
        outcomeNote: updated.outcomeNote,
        resumeNote: updated.resumeNote,
        autoSummary: updated.autoSummary,
        recurrenceRule: updated.recurrenceRule,
        seriesId: updated.seriesId,
        notes: updated.notes,
        externalLinks: updated.externalLinks,
        updatedAt: updated.updatedAt,
      })
      .where(eq(blocks.id, id))
      .run();
    recordActivity(veyraDb, actor, 'block.updated', `Updated block "${updated.title}"`, nowIso);
  })();

  return updated;
}

export function moveBlock(
  veyraDb: VeyraDb,
  id: string,
  input: MoveBlockInput,
  options?: ServiceMutationOptions,
): Block {
  const existing = getActiveBlockOrThrow(veyraDb, id);
  const parsed = parseWithZod(moveBlockInputSchema, input);
  const nowDate = resolveNow(options?.now);
  const nowIso = nowDate.toISOString();
  const actor = resolveActor(options?.actor);
  const timezone = getActiveTimezone(veyraDb);
  const today = formatLocalDate(nowDate, timezone);

  const placement = resolveBucketPlacement(
    {
      bucket: existing.bucket,
      scheduledDate: existing.scheduledDate,
      plannedStartAt: existing.plannedStartAt,
      plannedEndAt: existing.plannedEndAt,
      revisitAt: existing.revisitAt,
    },
    {
      bucket: parsed.bucket,
      scheduledDate: parsed.scheduledDate,
      plannedStartAt: parsed.plannedStartAt,
      plannedEndAt: parsed.plannedEndAt,
      revisitAt: parsed.revisitAt,
    },
    today,
    timezone,
  );

  const locationChanged =
    placement.bucket !== existing.bucket || placement.scheduledDate !== existing.scheduledDate;
  const nextOrderKey =
    parsed.orderKey ??
    (locationChanged
      ? nextOrderKeyForBucket(veyraDb, placement.bucket, placement.scheduledDate)
      : existing.orderKey);

  const updated: Block = {
    ...existing,
    bucket: placement.bucket,
    scheduledDate: placement.scheduledDate,
    plannedStartAt: placement.plannedStartAt,
    plannedEndAt: placement.plannedEndAt,
    revisitAt: placement.revisitAt,
    orderKey: nextOrderKey,
    updatedAt: nowIso,
  };

  veyraDb.sqlite.transaction(() => {
    veyraDb.db
      .update(blocks)
      .set({
        bucket: updated.bucket,
        scheduledDate: updated.scheduledDate,
        plannedStartAt: updated.plannedStartAt,
        plannedEndAt: updated.plannedEndAt,
        revisitAt: updated.revisitAt,
        orderKey: updated.orderKey,
        updatedAt: updated.updatedAt,
      })
      .where(eq(blocks.id, id))
      .run();
    recordActivity(
      veyraDb,
      actor,
      'block.moved',
      `Moved block "${updated.title}" to ${updated.bucket}${updated.scheduledDate ? ` (${updated.scheduledDate})` : ''}`,
      nowIso,
    );
  })();

  return updated;
}

export function reorderBlock(
  veyraDb: VeyraDb,
  id: string,
  input: ReorderBlockInput,
  options?: ServiceMutationOptions,
): Block {
  const existing = getActiveBlockOrThrow(veyraDb, id);
  const parsed = parseWithZod(reorderBlockInputSchema, input);
  const nowIso = resolveNow(options?.now).toISOString();
  const actor = resolveActor(options?.actor);

  let beforeKey = parsed.beforeOrderKey ?? null;
  let afterKey = parsed.afterOrderKey ?? null;

  if (parsed.beforeId) {
    beforeKey = getActiveBlockOrThrow(veyraDb, parsed.beforeId).orderKey;
  }
  if (parsed.afterId) {
    afterKey = getActiveBlockOrThrow(veyraDb, parsed.afterId).orderKey;
  }

  let newOrderKey: string;
  try {
    newOrderKey = generateOrderKey(beforeKey, afterKey);
  } catch (err) {
    throw new ValidationError(err instanceof Error ? err.message : 'Invalid reorder boundaries');
  }

  const updated: Block = {
    ...existing,
    orderKey: newOrderKey,
    updatedAt: nowIso,
  };

  veyraDb.sqlite.transaction(() => {
    veyraDb.db
      .update(blocks)
      .set({ orderKey: newOrderKey, updatedAt: nowIso })
      .where(eq(blocks.id, id))
      .run();
    recordActivity(veyraDb, actor, 'block.reordered', `Reordered block "${existing.title}"`, nowIso);
  })();

  return updated;
}

export function parkBlock(
  veyraDb: VeyraDb,
  id: string,
  input?: ParkBlockInput,
  options?: ServiceMutationOptions,
): Block {
  const parsed = parseWithZod(parkBlockInputSchema, input ?? {});
  const nowDate = resolveNow(options?.now);
  const timezone = getActiveTimezone(veyraDb);
  const today = formatLocalDate(nowDate, timezone);
  const revisitAt = resolveRevisitDate(parsed.revisitAt ?? '2w', today);

  return moveBlock(
    veyraDb,
    id,
    {
      bucket: 'later',
      scheduledDate: null,
      plannedStartAt: null,
      plannedEndAt: null,
      revisitAt,
    },
    options,
  );
}

export function dropBlock(
  veyraDb: VeyraDb,
  id: string,
  options?: { stopSeries?: boolean; dropReason?: DropReason | null } & ServiceMutationOptions,
): Block {
  const existing = getActiveBlockOrThrow(veyraDb, id);
  const nowIso = resolveNow(options?.now).toISOString();
  const actor = resolveActor(options?.actor);
  const stopSeries = options?.stopSeries === true;
  const nextDropReason =
    options?.dropReason !== undefined
      ? parseWithZod(dropReasonSchema.nullable(), options.dropReason)
      : existing.dropReason;

  const updated: Block = {
    ...existing,
    status: 'dropped',
    dropReason: nextDropReason,
    recurrenceRule: stopSeries && existing.seriesId ? null : existing.recurrenceRule,
    updatedAt: nowIso,
  };

  veyraDb.sqlite.transaction(() => {
    // Close any active focus session on this block so no open session lingers
    veyraDb.db
      .update(focusSessions)
      .set({ endedAt: nowIso, updatedAt: nowIso })
      .where(
        and(
          eq(focusSessions.blockId, id),
          isNull(focusSessions.endedAt),
          isNull(focusSessions.deletedAt),
        ),
      )
      .run();

    veyraDb.db
      .update(blocks)
      .set({
        status: 'dropped',
        dropReason: updated.dropReason,
        recurrenceRule: updated.recurrenceRule,
        updatedAt: nowIso,
      })
      .where(eq(blocks.id, id))
      .run();

    if (stopSeries && existing.seriesId) {
      // Clear recurrenceRule across ALL rows in the series (including soft-deleted rows)
      veyraDb.db
        .update(blocks)
        .set({ recurrenceRule: null, updatedAt: nowIso })
        .where(eq(blocks.seriesId, existing.seriesId))
        .run();
    }

    recordActivity(
      veyraDb,
      actor,
      'block.dropped',
      stopSeries
        ? `Dropped block "${existing.title}" and stopped recurring series`
        : `Dropped block "${existing.title}"`,
      nowIso,
    );
  })();

  return updated;
}

export function reopenBlock(
  veyraDb: VeyraDb,
  id: string,
  options?: ServiceMutationOptions,
): Block {
  const existing = getActiveBlockOrThrow(veyraDb, id);
  const nowIso = resolveNow(options?.now).toISOString();
  const actor = resolveActor(options?.actor);

  const updated: Block = {
    ...existing,
    status: 'todo',
    dropReason: null,
    updatedAt: nowIso,
  };

  veyraDb.sqlite.transaction(() => {
    veyraDb.db
      .update(blocks)
      .set({ status: 'todo', dropReason: null, updatedAt: nowIso })
      .where(eq(blocks.id, id))
      .run();
    recordActivity(veyraDb, actor, 'block.reopened', `Reopened block "${existing.title}"`, nowIso);
  })();

  return updated;
}

export function deleteBlock(
  veyraDb: VeyraDb,
  id: string,
  options?: ServiceMutationOptions,
): Block {
  const existing = getActiveBlockOrThrow(veyraDb, id);
  const nowIso = resolveNow(options?.now).toISOString();
  const actor = resolveActor(options?.actor);

  const deleted: Block = {
    ...existing,
    updatedAt: nowIso,
    deletedAt: nowIso,
  };

  veyraDb.sqlite.transaction(() => {
    veyraDb.db
      .update(focusSessions)
      .set({ endedAt: nowIso, updatedAt: nowIso })
      .where(
        and(
          eq(focusSessions.blockId, id),
          isNull(focusSessions.endedAt),
          isNull(focusSessions.deletedAt),
        ),
      )
      .run();

    veyraDb.db
      .update(blocks)
      .set({ deletedAt: nowIso, updatedAt: nowIso })
      .where(eq(blocks.id, id))
      .run();

    recordActivity(veyraDb, actor, 'block.deleted', `Deleted block "${existing.title}"`, nowIso);
  })();

  return deleted;
}

export function getBlockDetail(
  veyraDb: VeyraDb,
  id: string,
  now?: Date | string,
): BlockDetail {
  const block = getActiveBlockOrThrow(veyraDb, id);
  const nowMs = resolveNow(now).getTime();

  const sessions = veyraDb.db
    .select()
    .from(focusSessions)
    .where(and(eq(focusSessions.blockId, id), isNull(focusSessions.deletedAt)))
    .orderBy(desc(focusSessions.startedAt))
    .all();

  let totalMs = 0;
  for (const session of sessions) {
    const startMs = Date.parse(session.startedAt);
    const endMs = session.endedAt ? Date.parse(session.endedAt) : nowMs;
    if (endMs > startMs) {
      totalMs += endMs - startMs;
    }
  }

  return {
    ...block,
    sessions,
    totalFocusMinutes: msToRoundedMinutes(totalMs),
  };
}
