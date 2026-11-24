import crypto from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { VeyraDb } from '../db.js';
import { ValidationError } from '../errors.js';
import { activityLog, settings } from '../schema.js';
import {
  type ActivityActor,
  type ActivityLog,
  DEFAULT_SETTINGS_ID,
  type ListActivityFilter,
  activityActorSchema,
} from '../types.js';

export interface ServiceMutationOptions {
  actor?: ActivityActor;
  now?: Date | string;
}

export function resolveNow(now?: Date | string): Date {
  if (now === undefined) {
    return new Date();
  }
  const date = typeof now === 'string' ? new Date(now) : now;
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError(`Invalid timestamp: '${String(now)}'`);
  }
  return date;
}

export function resolveActor(actor?: ActivityActor): ActivityActor {
  if (actor === undefined) {
    return 'user';
  }
  const parsed = activityActorSchema.safeParse(actor);
  if (!parsed.success) {
    throw new ValidationError(`Invalid activity actor: '${String(actor)}'`);
  }
  return parsed.data;
}

export function getActiveTimezone(veyraDb: VeyraDb): string {
  const row = veyraDb.db
    .select({ timezone: settings.timezone })
    .from(settings)
    .where(eq(settings.id, DEFAULT_SETTINGS_ID))
    .get();
  return row?.timezone ?? 'UTC';
}

export function computeOverlapMs(
  startA: number,
  endA: number,
  startB: number,
  endB: number,
): number {
  return Math.max(0, Math.min(endA, endB) - Math.max(startA, startB));
}

export function msToRoundedMinutes(ms: number): number {
  return Math.round(Math.max(0, ms) / 60_000);
}

export function recordActivity(
  veyraDb: VeyraDb,
  actor: ActivityActor,
  action: string,
  summary: string,
  now?: Date | string,
): ActivityLog {
  const validActor = resolveActor(actor);
  const createdAt = resolveNow(now).toISOString();
  const entry: ActivityLog = {
    id: crypto.randomUUID(),
    actor: validActor,
    action,
    summary,
    createdAt,
  };
  veyraDb.db.insert(activityLog).values(entry).run();
  return entry;
}

export function listActivity(
  veyraDb: VeyraDb,
  options?: ListActivityFilter,
): ActivityLog[] {
  const conditions = [];
  if (options?.actor) {
    conditions.push(eq(activityLog.actor, resolveActor(options.actor)));
  }
  if (options?.action) {
    conditions.push(eq(activityLog.action, options.action));
  }

  const limit = options?.limit ?? 100;
  const query = veyraDb.db
    .select()
    .from(activityLog)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(activityLog.createdAt), desc(sql`rowid`))
    .limit(limit);

  return query.all();
}
