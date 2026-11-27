import crypto from 'node:crypto';
import { and, asc, eq, isNotNull, isNull, lt } from 'drizzle-orm';
import type { VeyraDb } from '../db.js';
import { generateOrderKey } from '../order-key.js';
import { blocks, focusSessions, goals, projects } from '../schema.js';
import { formatLocalDate, matchesRecurrenceRule } from '../time.js';
import {
  type Block,
  type RolloverResult,
  SYSTEM_OTHER_PROJECT_ID,
} from '../types.js';
import { getActiveTimezone, resolveNow } from './internal.js';

/**
 * Idempotent daily midnight rollover & guilt-free recurring block engine.
 *
 * 1. Moves unfinished (`status = 'todo'`) non-recurring `scheduled` blocks with
 *    `scheduledDate < today` to `scheduledDate = today` and increments `carryoverCount` by 1.
 * 2. Soft-deletes untouched (`status = 'todo'`, zero non-deleted `FocusSession` rows)
 *    past recurring occurrences (`recurrenceRule IS NOT NULL`, `scheduledDate < today`)
 *    with zero carryover.
 * 3. For each active recurring `seriesId` (latest row still has `recurrenceRule IS NOT NULL`,
 *    including rows soft-deleted in step 2, excluding stopped series where `recurrenceRule`
 *    was cleared to `null`), materializes today's occurrence when `matchesRecurrenceRule`
 *    is true and no row (active or soft-deleted) exists for `(seriesId, today)`.
 */
export function runDailyRolloverAndRecurrence(
  veyraDb: VeyraDb,
  now?: Date | string,
): RolloverResult {
  const nowDate = resolveNow(now);
  const nowIso = nowDate.toISOString();
  const timezone = getActiveTimezone(veyraDb);
  const today = formatLocalDate(nowDate, timezone);

  const rolledOverBlockIds: string[] = [];
  const softDeletedRecurringIds: string[] = [];
  const materializedBlockIds: string[] = [];

  veyraDb.sqlite.transaction(() => {
    // Step 1: Roll over unfinished non-recurring scheduled blocks from past days
    const overdueNonRecurring = veyraDb.db
      .select()
      .from(blocks)
      .where(
        and(
          isNull(blocks.deletedAt),
          isNull(blocks.calendarSource),
          eq(blocks.status, 'todo'),
          eq(blocks.bucket, 'scheduled'),
          isNull(blocks.recurrenceRule),
          isNotNull(blocks.scheduledDate),
          lt(blocks.scheduledDate, today),
        ),
      )
      .all();

    for (const blk of overdueNonRecurring) {
      veyraDb.db
        .update(blocks)
        .set({
          scheduledDate: today,
          plannedStartAt: null,
          plannedEndAt: null,
          carryoverCount: blk.carryoverCount + 1,
          updatedAt: nowIso,
        })
        .where(eq(blocks.id, blk.id))
        .run();
      rolledOverBlockIds.push(blk.id);
    }

    // Step 2: Soft-delete untouched past recurring occurrences (zero carryover)
    const overdueRecurring = veyraDb.db
      .select()
      .from(blocks)
      .where(
        and(
          isNull(blocks.deletedAt),
          isNull(blocks.calendarSource),
          eq(blocks.status, 'todo'),
          eq(blocks.bucket, 'scheduled'),
          isNotNull(blocks.recurrenceRule),
          isNotNull(blocks.scheduledDate),
          lt(blocks.scheduledDate, today),
        ),
      )
      .all();

    for (const blk of overdueRecurring) {
      const existingSession = veyraDb.db
        .select({ id: focusSessions.id })
        .from(focusSessions)
        .where(and(eq(focusSessions.blockId, blk.id), isNull(focusSessions.deletedAt)))
        .limit(1)
        .get();

      if (!existingSession) {
        veyraDb.db
          .update(blocks)
          .set({
            deletedAt: nowIso,
            updatedAt: nowIso,
          })
          .where(eq(blocks.id, blk.id))
          .run();
        softDeletedRecurringIds.push(blk.id);
      }
    }

    // Step 3: Materialize today's recurring occurrences from active series templates
    // Query ALL rows with seriesId IS NOT NULL (including soft-deleted rows from step 2)
    const seriesRows = veyraDb.db
      .select()
      .from(blocks)
      .where(isNotNull(blocks.seriesId))
      .all();

    const bySeries = new Map<string, Block[]>();
    for (const row of seriesRows) {
      if (!row.seriesId) continue;
      const list = bySeries.get(row.seriesId) ?? [];
      list.push(row);
      bySeries.set(row.seriesId, list);
    }

    // Track current max orderKey for today's scheduled blocks
    const todayOrderRows = veyraDb.db
      .select({ orderKey: blocks.orderKey })
      .from(blocks)
      .where(
        and(
          isNull(blocks.deletedAt),
          isNull(blocks.calendarSource),
          eq(blocks.bucket, 'scheduled'),
          eq(blocks.scheduledDate, today),
        ),
      )
      .orderBy(asc(blocks.orderKey))
      .all();

    let lastTodayOrderKey: string | null =
      todayOrderRows.length > 0 ? todayOrderRows[todayOrderRows.length - 1].orderKey : null;

    for (const [seriesId, rows] of bySeries.entries()) {
      // Sort descending by scheduledDate then updatedAt to identify the latest template row
      const sorted = rows.slice().sort((a, b) => {
        const dA = a.scheduledDate ?? '';
        const dB = b.scheduledDate ?? '';
        if (dA !== dB) {
          return dB.localeCompare(dA);
        }
        return b.updatedAt.localeCompare(a.updatedAt);
      });

      const latest = sorted[0];
      // If the latest row has recurrenceRule === null, the series was stopped
      if (!latest.recurrenceRule) {
        continue;
      }

      // Do not materialize before the series's earliest scheduled date
      let minScheduledDate: string | null = null;
      for (const row of rows) {
        if (row.scheduledDate && (minScheduledDate === null || row.scheduledDate < minScheduledDate)) {
          minScheduledDate = row.scheduledDate;
        }
      }
      if (minScheduledDate !== null && minScheduledDate > today) {
        continue;
      }

      // Check whether a row (active OR soft-deleted) already exists for (seriesId, today)
      const existsForToday = rows.some((row) => row.scheduledDate === today);
      if (existsForToday) {
        continue;
      }

      if (!matchesRecurrenceRule(latest.recurrenceRule, today, latest.scheduledDate)) {
        continue;
      }

      // Verify project still exists and is not deleted; otherwise fall back to Other
      const activeProject = veyraDb.db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.id, latest.projectId), isNull(projects.deletedAt)))
        .get();
      const targetProjectId = activeProject ? activeProject.id : SYSTEM_OTHER_PROJECT_ID;

      let targetGoalId: string | null = latest.goalId;
      if (targetGoalId) {
        const activeGoal = veyraDb.db
          .select({ id: goals.id })
          .from(goals)
          .where(and(eq(goals.id, targetGoalId), isNull(goals.deletedAt)))
          .get();
        if (!activeGoal) {
          targetGoalId = null;
        }
      }

      const orderKey = generateOrderKey(lastTodayOrderKey, null);
      lastTodayOrderKey = orderKey;

      const materialized: Block = {
        id: crypto.randomUUID(),
        projectId: targetProjectId,
        goalId: targetGoalId,
        title: latest.title,
        isOps: latest.isOps,
        bucket: 'scheduled',
        scheduledDate: today,
        plannedStartAt: null,
        plannedEndAt: null,
        dueDate: null,
        revisitAt: null,
        orderKey,
        status: 'todo',
        carryoverCount: 0,
        sizeMinutes: latest.sizeMinutes,
        energySignal: null,
        senseSignal: null,
        dropReason: null,
        outcomeNote: null,
        resumeNote: null,
        autoSummary: null,
        sideWork: null,
        recurrenceRule: latest.recurrenceRule,
        seriesId,
        notes: latest.notes,
        externalLinks: latest.externalLinks,
        updatedAt: nowIso,
        deletedAt: null,
      };

      veyraDb.db.insert(blocks).values(materialized).run();
      materializedBlockIds.push(materialized.id);
    }
  })();

  return {
    today,
    timezone,
    rolledOverBlockIds,
    softDeletedRecurringIds,
    materializedBlockIds,
  };
}
