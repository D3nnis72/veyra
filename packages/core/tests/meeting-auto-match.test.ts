import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type NormalizedCalendarEvent,
  type VeyraDb,
  autoMatchUnassignedCalendarEvents,
  createGoal,
  createProject,
  getCalendarEvent,
  getProject,
  openVeyraDb,
  updateCalendarEvent,
  updateProject,
  upsertCalendarEvents,
} from '../src/index.js';

const NOW = '2026-11-24T08:00:00.000Z';

function meeting(externalId: string, title: string, day = 24, hour = 10): NormalizedCalendarEvent {
  const start = new Date(Date.UTC(2026, 10, day, hour, 0, 0));
  const end = new Date(start.getTime() + 30 * 60_000);
  return {
    externalId,
    title,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    meetingUrl: null,
    isAllDay: false,
    isDeclined: false,
  };
}

function byExternalId(veyraDb: VeyraDb, externalId: string) {
  const row = veyraDb.sqlite
    .prepare('SELECT id FROM calendar_events WHERE external_id = ?')
    .get(externalId) as { id: string };
  return getCalendarEvent(veyraDb, row.id);
}

describe('match_keywords migration', () => {
  it('adds match_keywords to an older projects table without losing rows', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veyra-match-migration-'));
    const dbPath = path.join(tmpDir, 'veyra.db');
    try {
      const legacy = new Database(dbPath);
      legacy.exec(`
        CREATE TABLE goals (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
          color TEXT NOT NULL DEFAULT '#3B4BD8', status TEXT NOT NULL DEFAULT 'active',
          order_key TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
        );
        CREATE TABLE projects (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
          color TEXT NOT NULL DEFAULT '#3B4BD8', icon TEXT,
          default_goal_id TEXT REFERENCES goals(id) ON DELETE SET NULL,
          is_pinned INTEGER NOT NULL DEFAULT 0, is_system INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'active', notion_url TEXT,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
        );
      `);
      legacy
        .prepare(
          `INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
        )
        .run('11111111-1111-4111-8111-111111111111', 'Northstar', NOW, NOW);
      legacy.close();

      const veyraDb = openVeyraDb(dbPath);
      try {
        const cols = veyraDb.sqlite.prepare('PRAGMA table_info(projects)').all() as Array<{
          name: string;
        }>;
        expect(cols.map((c) => c.name)).toContain('match_keywords');

        const legacyProject = getProject(veyraDb, '11111111-1111-4111-8111-111111111111');
        expect(legacyProject.name).toBe('Northstar');
        expect(legacyProject.matchKeywords).toEqual([]);
      } finally {
        veyraDb.close();
      }

      // Re-opening is idempotent (no duplicate-column error).
      const reopened = openVeyraDb(dbPath);
      reopened.close();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('calendar meeting auto-matching', () => {
  let veyraDb: VeyraDb;

  beforeEach(() => {
    veyraDb = openVeyraDb(':memory:');
  });

  afterEach(() => {
    veyraDb.close();
  });

  it('Stage 1: inherits the assignment of an earlier meeting with the same normalized title', () => {
    const goal = createGoal(veyraDb, { name: 'Ship Q4' }, { now: NOW });
    const project = createProject(
      veyraDb,
      { name: 'Internal', matchKeywords: ['zzz-never-matches'] },
      { now: NOW },
    );

    upsertCalendarEvents(veyraDb, 'outlook_cli', [meeting('a1', 'Weekly Sync')], { now: NOW });
    const first = byExternalId(veyraDb, 'a1');
    expect(first.projectId).toBeNull();
    updateCalendarEvent(
      veyraDb,
      first.id,
      { projectId: project.id, goalId: goal.id, isOps: true },
      { now: NOW },
    );

    const result = upsertCalendarEvents(
      veyraDb,
      'outlook_cli',
      [meeting('a2', '  weekly   SYNC ', 25)],
      { now: NOW },
    );
    expect(result.autoMatchedCount).toBe(1);
    const second = byExternalId(veyraDb, 'a2');
    expect(second).toMatchObject({ projectId: project.id, goalId: goal.id, isOps: true });
  });

  it('Stage 2: matches matchKeywords on word boundaries, prefers the longest keyword, and inherits defaultGoalId', () => {
    const northstarGoal = createGoal(veyraDb, { name: 'Northstar Rollout' }, { now: NOW });
    const coreApp = createProject(
      veyraDb,
      { name: 'CoreApp', matchKeywords: ['CoreApp'] },
      { now: NOW },
    );
    const northstar = createProject(
      veyraDb,
      { name: 'Northstar', matchKeywords: ['Northstar', 'Arc'], defaultGoalId: northstarGoal.id },
      { now: NOW },
    );

    upsertCalendarEvents(
      veyraDb,
      'outlook_cli',
      [
        meeting('m1', 'CoreApp-Northstar issue review'),
        meeting('m2', 'CoreApp standup', 24, 11),
        meeting('m3', 'Architecture planning', 24, 12),
        meeting('m4', 'Arc / weekly', 24, 13),
      ],
      { now: NOW },
    );

    expect(byExternalId(veyraDb, 'm1')).toMatchObject({
      projectId: northstar.id,
      goalId: northstarGoal.id,
    });
    expect(byExternalId(veyraDb, 'm2')).toMatchObject({ projectId: coreApp.id, goalId: null });
    // "Arc" must not match inside "Architecture".
    expect(byExternalId(veyraDb, 'm3').projectId).toBeNull();
    expect(byExternalId(veyraDb, 'm4').projectId).toBe(northstar.id);
  });

  it('Stage 2: explicit keywords replace the name fallback; projects without keywords match by name', () => {
    const named = createProject(veyraDb, { name: 'Acme' }, { now: NOW });
    createProject(veyraDb, { name: 'Atlas', matchKeywords: ['ATL'] }, { now: NOW });
    createProject(veyraDb, { name: 'Paused Co', status: 'paused' }, { now: NOW });

    upsertCalendarEvents(
      veyraDb,
      'ics',
      [
        meeting('n1', 'Acme kickoff'),
        meeting('n2', 'Atlas quarterly', 24, 11),
        meeting('n3', 'Paused Co sync', 24, 12),
      ],
      { now: NOW },
    );

    expect(byExternalId(veyraDb, 'n1').projectId).toBe(named.id);
    expect(byExternalId(veyraDb, 'n2').projectId).toBeNull();
    expect(byExternalId(veyraDb, 'n3').projectId).toBeNull();
  });

  it('never overwrites a manual assignment on re-sync or retro-match', () => {
    const northstar = createProject(
      veyraDb,
      { name: 'Northstar', matchKeywords: ['Northstar'] },
      { now: NOW },
    );
    const other = createProject(veyraDb, { name: 'Personal Admin' }, { now: NOW });

    upsertCalendarEvents(veyraDb, 'outlook_cli', [meeting('x1', 'Northstar sync')], { now: NOW });
    const ev = byExternalId(veyraDb, 'x1');
    expect(ev.projectId).toBe(northstar.id);

    updateCalendarEvent(veyraDb, ev.id, { projectId: other.id }, { now: NOW });

    const resync = upsertCalendarEvents(
      veyraDb,
      'outlook_cli',
      [meeting('x1', 'Northstar sync (moved)')],
      { now: NOW },
    );
    expect(resync.autoMatchedCount).toBe(0);
    expect(autoMatchUnassignedCalendarEvents(veyraDb, NOW).matchedCount).toBe(0);
    expect(byExternalId(veyraDb, 'x1').projectId).toBe(other.id);
  });

  it('autoMatchUnassignedCalendarEvents retro-matches existing unassigned meetings after keywords change', () => {
    upsertCalendarEvents(
      veyraDb,
      'outlook_cli',
      [meeting('r1', 'NSX onboarding'), meeting('r2', 'Lunch', 24, 12)],
      { now: NOW },
    );
    expect(byExternalId(veyraDb, 'r1').projectId).toBeNull();

    const goal = createGoal(veyraDb, { name: 'Expand Northstar' }, { now: NOW });
    const project = createProject(
      veyraDb,
      { name: 'Northstar Account', matchKeywords: [] },
      { now: NOW },
    );
    expect(autoMatchUnassignedCalendarEvents(veyraDb, NOW).matchedCount).toBe(0);

    const updated = updateProject(
      veyraDb,
      project.id,
      { matchKeywords: [' NSX ', 'nsx', ''], defaultGoalId: goal.id },
      { now: NOW },
    );
    expect(updated.matchKeywords).toEqual(['NSX']);

    const result = autoMatchUnassignedCalendarEvents(veyraDb, NOW);
    expect(result.matchedCount).toBe(1);
    expect(byExternalId(veyraDb, 'r1')).toMatchObject({ projectId: project.id, goalId: goal.id });
    expect(byExternalId(veyraDb, 'r2').projectId).toBeNull();
  });
});
