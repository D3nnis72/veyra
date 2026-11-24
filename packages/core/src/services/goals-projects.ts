import crypto from 'node:crypto';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { VeyraDb } from '../db.js';
import { NotFoundError, SystemProjectError, parseWithZod } from '../errors.js';
import { generateOrderKey } from '../order-key.js';
import { blocks, calendarEvents, dailyNotes, focusSessions, goals, projects } from '../schema.js';
import { formatLocalDate, getLocalDayBoundsIso, getWeekRange } from '../time.js';
import {
  type CreateGoalInput,
  type CreateProjectInput,
  type Goal,
  type ListGoalsFilter,
  type ListProjectsFilter,
  type Project,
  type ProjectWithStats,
  SYSTEM_OTHER_PROJECT_ID,
  type UpdateGoalInput,
  type UpdateProjectInput,
  createGoalInputSchema,
  createProjectInputSchema,
  updateGoalInputSchema,
  updateProjectInputSchema,
} from '../types.js';
import {
  type ServiceMutationOptions,
  computeOverlapMs,
  getActiveTimezone,
  listActivity,
  msToRoundedMinutes,
  recordActivity,
  resolveActor,
  resolveNow,
} from './internal.js';

export { listActivity, recordActivity };

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function ensureActiveGoalExists(veyraDb: VeyraDb, goalId: string): Goal {
  const goal = veyraDb.db
    .select()
    .from(goals)
    .where(and(eq(goals.id, goalId), isNull(goals.deletedAt)))
    .get();
  if (!goal) {
    throw new NotFoundError(`Goal '${goalId}' not found`);
  }
  return goal;
}

function ensureActiveProjectExists(veyraDb: VeyraDb, projectId: string): Project {
  const project = veyraDb.db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    .get();
  if (!project) {
    throw new NotFoundError(`Project '${projectId}' not found`);
  }
  return project;
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

export function createGoal(
  veyraDb: VeyraDb,
  input: CreateGoalInput,
  options?: ServiceMutationOptions,
): Goal {
  const parsed = parseWithZod(createGoalInputSchema, input);
  const nowIso = resolveNow(options?.now).toISOString();
  const actor = resolveActor(options?.actor);

  let orderKey = parsed.orderKey;
  if (!orderKey) {
    const existing = veyraDb.db
      .select({ orderKey: goals.orderKey })
      .from(goals)
      .where(isNull(goals.deletedAt))
      .orderBy(asc(goals.orderKey))
      .all();
    const lastKey = existing.length > 0 ? existing[existing.length - 1].orderKey : null;
    orderKey = generateOrderKey(lastKey, null);
  }

  const goal: Goal = {
    id: crypto.randomUUID(),
    name: parsed.name,
    description: parsed.description,
    color: parsed.color,
    status: parsed.status,
    orderKey,
    updatedAt: nowIso,
    deletedAt: null,
  };

  veyraDb.sqlite.transaction(() => {
    veyraDb.db.insert(goals).values(goal).run();
    recordActivity(veyraDb, actor, 'goal.created', `Created goal "${goal.name}"`, nowIso);
  })();

  return goal;
}

export function getGoal(veyraDb: VeyraDb, id: string): Goal {
  return ensureActiveGoalExists(veyraDb, id);
}

export function listGoals(
  veyraDb: VeyraDb,
  options?: ListGoalsFilter,
): Goal[] {
  const rows = veyraDb.db
    .select()
    .from(goals)
    .where(isNull(goals.deletedAt))
    .orderBy(asc(goals.orderKey))
    .all();

  if (options?.status) {
    return rows.filter((g) => g.status === options.status);
  }
  if (options?.includeArchived === false) {
    return rows.filter((g) => g.status !== 'archived');
  }
  return rows;
}

export function updateGoal(
  veyraDb: VeyraDb,
  id: string,
  input: UpdateGoalInput,
  options?: ServiceMutationOptions,
): Goal {
  const existing = ensureActiveGoalExists(veyraDb, id);
  const parsed = parseWithZod(updateGoalInputSchema, input);
  const nowIso = resolveNow(options?.now).toISOString();
  const actor = resolveActor(options?.actor);

  const updated: Goal = {
    ...existing,
    name: parsed.name ?? existing.name,
    description: parsed.description ?? existing.description,
    color: parsed.color ?? existing.color,
    status: parsed.status ?? existing.status,
    orderKey: parsed.orderKey ?? existing.orderKey,
    updatedAt: nowIso,
  };

  veyraDb.sqlite.transaction(() => {
    veyraDb.db
      .update(goals)
      .set({
        name: updated.name,
        description: updated.description,
        color: updated.color,
        status: updated.status,
        orderKey: updated.orderKey,
        updatedAt: updated.updatedAt,
      })
      .where(eq(goals.id, id))
      .run();
    recordActivity(veyraDb, actor, 'goal.updated', `Updated goal "${updated.name}"`, nowIso);
  })();

  return updated;
}

export function deleteGoal(
  veyraDb: VeyraDb,
  id: string,
  options?: ServiceMutationOptions,
): Goal {
  const existing = ensureActiveGoalExists(veyraDb, id);
  const nowIso = resolveNow(options?.now).toISOString();
  const actor = resolveActor(options?.actor);

  const deleted: Goal = {
    ...existing,
    updatedAt: nowIso,
    deletedAt: nowIso,
  };

  veyraDb.sqlite.transaction(() => {
    // Soft-delete does not trigger SQLite ON DELETE SET NULL; clear references explicitly
    veyraDb.db
      .update(projects)
      .set({ defaultGoalId: null, updatedAt: nowIso })
      .where(eq(projects.defaultGoalId, id))
      .run();

    veyraDb.db
      .update(blocks)
      .set({ goalId: null, updatedAt: nowIso })
      .where(eq(blocks.goalId, id))
      .run();

    veyraDb.db
      .update(calendarEvents)
      .set({ goalId: null, updatedAt: nowIso })
      .where(eq(calendarEvents.goalId, id))
      .run();

    veyraDb.db
      .update(dailyNotes)
      .set({ goalId: null, updatedAt: nowIso })
      .where(eq(dailyNotes.goalId, id))
      .run();

    veyraDb.db
      .update(goals)
      .set({ deletedAt: nowIso, updatedAt: nowIso })
      .where(eq(goals.id, id))
      .run();
    recordActivity(veyraDb, actor, 'goal.deleted', `Deleted goal "${existing.name}"`, nowIso);
  })();

  return deleted;
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export function createProject(
  veyraDb: VeyraDb,
  input: CreateProjectInput,
  options?: ServiceMutationOptions,
): Project {
  const parsed = parseWithZod(createProjectInputSchema, input);
  const nowIso = resolveNow(options?.now).toISOString();
  const actor = resolveActor(options?.actor);

  if (parsed.defaultGoalId) {
    ensureActiveGoalExists(veyraDb, parsed.defaultGoalId);
  }

  const project: Project = {
    id: crypto.randomUUID(),
    name: parsed.name,
    description: parsed.description,
    color: parsed.color,
    icon: parsed.icon ?? null,
    defaultGoalId: parsed.defaultGoalId ?? null,
    isPinned: parsed.isPinned,
    isSystem: false,
    status: parsed.status,
    notionUrl: parsed.notionUrl ?? null,
    matchKeywords: parsed.matchKeywords,
    createdAt: nowIso,
    updatedAt: nowIso,
    deletedAt: null,
  };

  veyraDb.sqlite.transaction(() => {
    veyraDb.db.insert(projects).values(project).run();
    recordActivity(
      veyraDb,
      actor,
      'project.created',
      `Created project "${project.name}"`,
      nowIso,
    );
  })();

  return project;
}

export function updateProject(
  veyraDb: VeyraDb,
  id: string,
  input: UpdateProjectInput,
  options?: ServiceMutationOptions,
): Project {
  const existing = ensureActiveProjectExists(veyraDb, id);
  const parsed = parseWithZod(updateProjectInputSchema, input);
  const nowIso = resolveNow(options?.now).toISOString();
  const actor = resolveActor(options?.actor);

  if (existing.isSystem && parsed.status === 'archived') {
    throw new SystemProjectError();
  }

  if (parsed.defaultGoalId !== undefined && parsed.defaultGoalId !== null) {
    ensureActiveGoalExists(veyraDb, parsed.defaultGoalId);
  }

  const updated: Project = {
    ...existing,
    name: parsed.name ?? existing.name,
    description: parsed.description ?? existing.description,
    color: parsed.color ?? existing.color,
    icon: parsed.icon !== undefined ? parsed.icon : existing.icon,
    defaultGoalId:
      parsed.defaultGoalId !== undefined ? parsed.defaultGoalId : existing.defaultGoalId,
    isPinned: parsed.isPinned ?? existing.isPinned,
    status: parsed.status ?? existing.status,
    notionUrl: parsed.notionUrl !== undefined ? parsed.notionUrl : existing.notionUrl,
    matchKeywords: parsed.matchKeywords ?? existing.matchKeywords,
    updatedAt: nowIso,
  };

  veyraDb.sqlite.transaction(() => {
    veyraDb.db
      .update(projects)
      .set({
        name: updated.name,
        description: updated.description,
        color: updated.color,
        icon: updated.icon,
        defaultGoalId: updated.defaultGoalId,
        isPinned: updated.isPinned,
        status: updated.status,
        notionUrl: updated.notionUrl,
        matchKeywords: updated.matchKeywords,
        updatedAt: updated.updatedAt,
      })
      .where(eq(projects.id, id))
      .run();
    recordActivity(
      veyraDb,
      actor,
      'project.updated',
      `Updated project "${updated.name}"`,
      nowIso,
    );
  })();

  return updated;
}

export function archiveProject(
  veyraDb: VeyraDb,
  id: string,
  options?: ServiceMutationOptions,
): Project {
  const existing = ensureActiveProjectExists(veyraDb, id);
  if (existing.isSystem) {
    throw new SystemProjectError();
  }
  const nowIso = resolveNow(options?.now).toISOString();
  const actor = resolveActor(options?.actor);

  const archived: Project = {
    ...existing,
    status: 'archived',
    updatedAt: nowIso,
  };

  veyraDb.sqlite.transaction(() => {
    veyraDb.db
      .update(projects)
      .set({ status: 'archived', updatedAt: nowIso })
      .where(eq(projects.id, id))
      .run();
    recordActivity(
      veyraDb,
      actor,
      'project.archived',
      `Archived project "${existing.name}"`,
      nowIso,
    );
  })();

  return archived;
}

export function deleteProject(
  veyraDb: VeyraDb,
  id: string,
  options?: ServiceMutationOptions,
): Project {
  const existing = ensureActiveProjectExists(veyraDb, id);
  if (existing.isSystem) {
    throw new SystemProjectError();
  }
  const nowIso = resolveNow(options?.now).toISOString();
  const actor = resolveActor(options?.actor);

  const deleted: Project = {
    ...existing,
    updatedAt: nowIso,
    deletedAt: nowIso,
  };

  veyraDb.sqlite.transaction(() => {
    // Reassign active blocks of the deleted project to system Other project
    veyraDb.db
      .update(blocks)
      .set({ projectId: SYSTEM_OTHER_PROJECT_ID, updatedAt: nowIso })
      .where(and(eq(blocks.projectId, id), isNull(blocks.deletedAt)))
      .run();

    // Soft-delete does not trigger SQLite ON DELETE SET NULL; clear nullable references explicitly
    veyraDb.db
      .update(calendarEvents)
      .set({ projectId: null, updatedAt: nowIso })
      .where(eq(calendarEvents.projectId, id))
      .run();

    veyraDb.db
      .update(dailyNotes)
      .set({ projectId: null, updatedAt: nowIso })
      .where(eq(dailyNotes.projectId, id))
      .run();

    veyraDb.db
      .update(projects)
      .set({ deletedAt: nowIso, updatedAt: nowIso })
      .where(eq(projects.id, id))
      .run();

    recordActivity(
      veyraDb,
      actor,
      'project.deleted',
      `Deleted project "${existing.name}"`,
      nowIso,
    );
  })();

  return deleted;
}

function compareOpenBlocksForNext(
  a: { bucket: string; scheduledDate: string | null; revisitAt: string | null; orderKey: string },
  b: { bucket: string; scheduledDate: string | null; revisitAt: string | null; orderKey: string },
): number {
  const bucketRank = (bucket: string) =>
    bucket === 'scheduled' ? 0 : bucket === 'inbox' ? 1 : 2;
  const rankDiff = bucketRank(a.bucket) - bucketRank(b.bucket);
  if (rankDiff !== 0) {
    return rankDiff;
  }
  if (a.bucket === 'scheduled') {
    const dateA = a.scheduledDate ?? '9999-99-99';
    const dateB = b.scheduledDate ?? '9999-99-99';
    if (dateA !== dateB) {
      return dateA < dateB ? -1 : 1;
    }
  } else if (a.bucket === 'later') {
    const revA = a.revisitAt ?? '9999-99-99';
    const revB = b.revisitAt ?? '9999-99-99';
    if (revA !== revB) {
      return revA < revB ? -1 : 1;
    }
  }
  if (a.orderKey === b.orderKey) {
    return 0;
  }
  return a.orderKey < b.orderKey ? -1 : 1;
}

function computeProjectsWithStats(
  veyraDb: VeyraDb,
  projectRows: Project[],
  now?: Date | string,
): ProjectWithStats[] {
  const nowDate = resolveNow(now);
  const nowIso = nowDate.toISOString();
  const nowMs = nowDate.getTime();
  const timezone = getActiveTimezone(veyraDb);
  const today = formatLocalDate(nowDate, timezone);
  const { weekStartDate, weekEndDate } = getWeekRange(today);
  const weekStartMs = Date.parse(getLocalDayBoundsIso(weekStartDate, timezone).startIso);
  const weekEndMs = Date.parse(getLocalDayBoundsIso(weekEndDate, timezone).endIso);

  const allBlocks = veyraDb.db
    .select()
    .from(blocks)
    .where(isNull(blocks.deletedAt))
    .all();

  const blockToProject = new Map<string, string>();
  const openBlocksByProject = new Map<string, typeof allBlocks>();
  const lastCompletedMsByProject = new Map<string, { ms: number; iso: string }>();

  for (const blk of allBlocks) {
    blockToProject.set(blk.id, blk.projectId);
    if (blk.status === 'todo') {
      const list = openBlocksByProject.get(blk.projectId) ?? [];
      list.push(blk);
      openBlocksByProject.set(blk.projectId, list);
    } else if (blk.status === 'done') {
      const doneMs = Date.parse(blk.updatedAt);
      const prev = lastCompletedMsByProject.get(blk.projectId);
      if (!prev || doneMs > prev.ms) {
        lastCompletedMsByProject.set(blk.projectId, { ms: doneMs, iso: blk.updatedAt });
      }
    }
  }

  // Also map soft-deleted blocks to their projectId in case a session existed on one
  const allSessions = veyraDb.db
    .select()
    .from(focusSessions)
    .where(isNull(focusSessions.deletedAt))
    .all();

  const weeklyMsByProject = new Map<string, number>();
  const lastSessionEndByProject = new Map<string, { ms: number; iso: string }>();

  for (const session of allSessions) {
    let projectId = blockToProject.get(session.blockId);
    if (!projectId) {
      const blk = veyraDb.db
        .select({ projectId: blocks.projectId })
        .from(blocks)
        .where(eq(blocks.id, session.blockId))
        .get();
      if (!blk) {
        continue;
      }
      projectId = blk.projectId;
      blockToProject.set(session.blockId, projectId);
    }

    const startMs = Date.parse(session.startedAt);
    const endIso = session.endedAt ?? nowIso;
    const endMs = session.endedAt ? Date.parse(session.endedAt) : nowMs;

    const overlapMs = computeOverlapMs(startMs, endMs, weekStartMs, weekEndMs);
    if (overlapMs > 0) {
      weeklyMsByProject.set(projectId, (weeklyMsByProject.get(projectId) ?? 0) + overlapMs);
    }

    const prevEnd = lastSessionEndByProject.get(projectId);
    if (!prevEnd || endMs > prevEnd.ms) {
      lastSessionEndByProject.set(projectId, { ms: endMs, iso: endIso });
    }
  }

  return projectRows.map((project) => {
    const openBlocks = (openBlocksByProject.get(project.id) ?? []).slice();
    openBlocks.sort(compareOpenBlocksForNext);

    const createdMs = Date.parse(project.createdAt);
    let lastTouchedMs = createdMs;
    let lastTouchedAt = project.createdAt;

    const lastCompleted = lastCompletedMsByProject.get(project.id);
    if (lastCompleted && lastCompleted.ms > lastTouchedMs) {
      lastTouchedMs = lastCompleted.ms;
      lastTouchedAt = lastCompleted.iso;
    }

    const lastSession = lastSessionEndByProject.get(project.id);
    if (lastSession && lastSession.ms > lastTouchedMs) {
      lastTouchedMs = lastSession.ms;
      lastTouchedAt = lastSession.iso;
    }

    const isQuiet = project.status === 'active' && nowMs - lastTouchedMs > SEVEN_DAYS_MS;

    return {
      ...project,
      isQuiet,
      weeklyFocusMinutes: msToRoundedMinutes(weeklyMsByProject.get(project.id) ?? 0),
      openBlockCount: openBlocks.length,
      nextBlockTitle: openBlocks.length > 0 ? openBlocks[0].title : null,
      lastTouchedAt,
    };
  });
}

export function getProject(
  veyraDb: VeyraDb,
  id: string,
  now?: Date | string,
): ProjectWithStats {
  const project = ensureActiveProjectExists(veyraDb, id);
  return computeProjectsWithStats(veyraDb, [project], now)[0];
}

export function listProjects(
  veyraDb: VeyraDb,
  now?: Date | string,
  options?: ListProjectsFilter,
): ProjectWithStats[] {
  let rows = veyraDb.db
    .select()
    .from(projects)
    .where(isNull(projects.deletedAt))
    .all();

  if (options?.status) {
    rows = rows.filter((p) => p.status === options.status);
  } else if (options?.includeArchived === false) {
    rows = rows.filter((p) => p.status !== 'archived');
  }

  rows.sort((a, b) => {
    if (a.isPinned !== b.isPinned) {
      return a.isPinned ? -1 : 1;
    }
    if (a.isSystem !== b.isSystem) {
      return a.isSystem ? 1 : -1;
    }
    return a.name.localeCompare(b.name);
  });

  return computeProjectsWithStats(veyraDb, rows, now);
}
