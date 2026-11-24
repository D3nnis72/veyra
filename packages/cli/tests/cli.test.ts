import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createVeyraServer, type VeyraServerInstance } from '@veyra/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/index.js';

interface CliRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function execCli(
  argv: string[],
  env: Record<string, string | undefined>,
): Promise<CliRunResult> {
  let stdout = '';
  let stderr = '';
  const exitCode = await runCli(argv, {
    stdout: (chunk) => {
      stdout += chunk;
    },
    stderr: (chunk) => {
      stderr += chunk;
    },
    env: {
      ...process.env,
      ...env,
    },
  });
  return { exitCode, stdout, stderr };
}

describe('@veyra/cli integration', () => {
  let server: VeyraServerInstance;
  let serverUrl: string;
  let tmpDir: string;
  let configPath: string;
  const fixedNow = '2026-11-23T09:00:00.000Z';

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veyra-cli-test-'));
    configPath = path.join(tmpDir, 'config.json');
    server = createVeyraServer({
      dbPath: ':memory:',
      port: 0,
      host: '127.0.0.1',
      enableTestClock: true,
      rolloverCheckIntervalMs: 600_000,
    });
    const started = await server.start();
    serverUrl = started.url;
  });

  afterEach(async () => {
    await server.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function baseEnv(overrides?: Record<string, string | undefined>): Record<string, string | undefined> {
    return {
      VEYRA_SERVER_URL: serverUrl,
      VEYRA_TOKEN: undefined,
      VEYRA_CONFIG_PATH: configPath,
      VEYRA_ACTOR: 'cli',
      VEYRA_NOW: fixedNow,
      ...overrides,
    };
  }

  it('adds an ops block, shows it in today (global --json before & after), and completes full focus loop', async () => {
    const addRes = await execCli(
      ['add', 'Audit webhook retries', '--ops', '--date', '2026-11-23', '--json'],
      baseEnv(),
    );
    expect(addRes.exitCode).toBe(0);
    const added = JSON.parse(addRes.stdout) as {
      id: string;
      title: string;
      isOps: boolean;
      bucket: string;
      scheduledDate: string;
    };
    expect(added.id).toBeTruthy();
    expect(added.title).toBe('Audit webhook retries');
    expect(added.isOps).toBe(true);
    expect(added.bucket).toBe('scheduled');
    expect(added.scheduledDate).toBe('2026-11-23');

    // Global --json after subcommand
    const todayAfter = await execCli(['today', '--json'], baseEnv());
    expect(todayAfter.exitCode).toBe(0);
    const todayData = JSON.parse(todayAfter.stdout) as {
      upNext: Array<{ id: string; title: string }>;
    };
    expect(todayData.upNext.some((b) => b.id === added.id)).toBe(true);

    // Global --json before subcommand
    const todayBefore = await execCli(['--json', 'today'], baseEnv());
    expect(todayBefore.exitCode).toBe(0);
    const todayData2 = JSON.parse(todayBefore.stdout) as {
      upNext: Array<{ id: string }>;
    };
    expect(todayData2.upNext.some((b) => b.id === added.id)).toBe(true);

    // Start focus
    const startRes = await execCli(['start', added.id, '--json'], baseEnv());
    expect(startRes.exitCode).toBe(0);
    const started = JSON.parse(startRes.stdout) as {
      startedSession: { id: string; blockId: string };
      focusStatus: { activeBlock: { id: string } | null };
    };
    expect(started.startedSession.blockId).toBe(added.id);
    expect(started.focusStatus.activeBlock?.id).toBe(added.id);

    // Focus status
    const statusRes = await execCli(['focus', 'status', '--json'], baseEnv({ VEYRA_NOW: '2026-11-23T09:15:00.000Z' }));
    expect(statusRes.exitCode).toBe(0);
    const statusData = JSON.parse(statusRes.stdout) as {
      activeBlock: { id: string } | null;
      elapsedSeconds: number;
    };
    expect(statusData.activeBlock?.id).toBe(added.id);
    expect(statusData.elapsedSeconds).toBe(900);

    // Pause with note
    const pauseRes = await execCli(
      ['pause', '--note', 'Left off at step 2', '--json'],
      baseEnv({ VEYRA_NOW: '2026-11-23T09:20:00.000Z' }),
    );
    expect(pauseRes.exitCode).toBe(0);
    const paused = JSON.parse(pauseRes.stdout) as {
      closedSession: { note: string | null; endedAt: string | null };
      block: { resumeNote: string | null };
    };
    expect(paused.closedSession.note).toBe('Left off at step 2');
    expect(paused.block.resumeNote).toBe('Left off at step 2');

    // Resume then complete without <id>
    const resumeRes = await execCli(
      ['resume', added.id, '--json'],
      baseEnv({ VEYRA_NOW: '2026-11-23T09:30:00.000Z' }),
    );
    expect(resumeRes.exitCode).toBe(0);

    const doneRes = await execCli(
      ['done', '--energy', 'up', '--outcome', 'Fixed retries', '--json'],
      baseEnv({ VEYRA_NOW: '2026-11-23T10:00:00.000Z' }),
    );
    expect(doneRes.exitCode).toBe(0);
    const done = JSON.parse(doneRes.stdout) as {
      block: { id: string; status: string; energySignal: string; outcomeNote: string };
      totalBlockMinutes: number;
    };
    expect(done.block.id).toBe(added.id);
    expect(done.block.status).toBe('done');
    expect(done.block.energySignal).toBe('up');
    expect(done.block.outcomeNote).toBe('Fixed retries');
    expect(done.totalBlockMinutes).toBe(50);

    // Summary set
    const sumRes = await execCli(
      ['summary', 'set', added.id, 'Audited all 3 retry queues', '--json'],
      baseEnv(),
    );
    expect(sumRes.exitCode).toBe(0);
    const summarized = JSON.parse(sumRes.stdout) as { id: string; autoSummary: string };
    expect(summarized.autoSummary).toBe('Audited all 3 retry queues');

    // Verify X-Veyra-Actor: cli was recorded in activity log
    const activityResp = await fetch(`${serverUrl}/api/activity?actor=cli`);
    const activityJson = (await activityResp.json()) as { activity: Array<{ actor: string; action: string }> };
    expect(activityJson.activity.length).toBeGreaterThanOrEqual(4);
    expect(activityJson.activity.every((a) => a.actor === 'cli')).toBe(true);
  });

  it('captures daily notes and weekly review rule and exposes them in review --json', async () => {
    const noteRes = await execCli(
      ['note', 'add', 'Teams muted until 11:30 worked great', '--json'],
      baseEnv(),
    );
    expect(noteRes.exitCode).toBe(0);
    const note = JSON.parse(noteRes.stdout) as { id: string; content: string; date: string };
    expect(note.content).toBe('Teams muted until 11:30 worked great');

    const notesRes = await execCli(['notes', '--week', '2026-11-23', '--json'], baseEnv());
    expect(notesRes.exitCode).toBe(0);
    const notesPayload = JSON.parse(notesRes.stdout) as { notes: Array<{ id: string }> };
    expect(notesPayload.notes.some((n) => n.id === note.id)).toBe(true);

    const ruleRes = await execCli(
      ['review', 'set-rule', 'Protect morning focus', '--json'],
      baseEnv(),
    );
    expect(ruleRes.exitCode).toBe(0);
    const rule = JSON.parse(ruleRes.stdout) as { ruleForNextWeek: string };
    expect(rule.ruleForNextWeek).toBe('Protect morning focus');

    const reviewRes = await execCli(['review', '--json'], baseEnv());
    expect(reviewRes.exitCode).toBe(0);
    const review = JSON.parse(reviewRes.stdout) as {
      ruleForNextWeek: string | null;
      dailyNotes: Array<{ content: string }>;
    };
    expect(review.ruleForNextWeek).toBe('Protect morning focus');
    expect(review.dailyNotes.some((n) => n.content === 'Teams muted until 11:30 worked great')).toBe(true);
  });

  it('invokes /api/events/sync and supports events upsert & assign', async () => {
    const syncRes = await execCli(['events', 'sync', '--json'], baseEnv());
    expect(syncRes.exitCode).toBe(0);
    const syncPayload = JSON.parse(syncRes.stdout) as {
      status: { state: string };
      result: { upsertedCount: number };
    };
    expect(syncPayload.status).toBeDefined();
    expect(typeof syncPayload.result.upsertedCount).toBe('number');

    // Create a project and goal to assign by name
    const goalRes = await execCli(['goal', 'create', 'Ship Q4 Reliability', '--json'], baseEnv());
    expect(goalRes.exitCode).toBe(0);
    const goal = JSON.parse(goalRes.stdout) as { id: string; name: string };

    const projRes = await execCli(
      ['project', 'create', 'Platform Core', '--goal', 'ship q4 reliability', '--json'],
      baseEnv(),
    );
    expect(projRes.exitCode).toBe(0);
    const project = JSON.parse(projRes.stdout) as { id: string; defaultGoalId: string };
    expect(project.defaultGoalId).toBe(goal.id);

    // Upsert events from JSON file
    const eventsFile = path.join(tmpDir, 'events.json');
    fs.writeFileSync(
      eventsFile,
      JSON.stringify({
        source: 'manual',
        events: [
          {
            externalId: 'evt-1',
            title: 'Architecture Review',
            startAt: '2026-11-23T14:00:00.000Z',
            endAt: '2026-11-23T15:00:00.000Z',
          },
        ],
      }),
    );

    const upsertRes = await execCli(
      ['events', 'upsert', '--file', eventsFile, '--json'],
      baseEnv(),
    );
    expect(upsertRes.exitCode).toBe(0);
    const upserted = JSON.parse(upsertRes.stdout) as {
      createdCount: number;
      upserted: Array<{ id: string; title: string }>;
    };
    expect(upserted.createdCount).toBe(1);
    const eventId = upserted.upserted[0].id;

    // Assign event by project/goal name
    const assignRes = await execCli(
      [
        'events',
        'assign',
        eventId,
        '--project',
        'platform core',
        '--goal',
        'ship q4 reliability',
        '--ops',
        '--notes',
        'Aligned on retry policy',
        '--json',
      ],
      baseEnv(),
    );
    expect(assignRes.exitCode).toBe(0);
    const assigned = JSON.parse(assignRes.stdout) as {
      id: string;
      projectId: string;
      goalId: string;
      isOps: boolean;
      notes: string;
    };
    expect(assigned.projectId).toBe(project.id);
    expect(assigned.goalId).toBe(goal.id);
    expect(assigned.isOps).toBe(true);
    expect(assigned.notes).toBe('Aligned on retry policy');
  });

  it('supports planning, ergonomic add options, move with HH:MM, reorder, park, drop, sessions', async () => {
    const pRes = await execCli(['project', 'create', 'Veyra', '--json'], baseEnv());
    const project = JSON.parse(pRes.stdout) as { id: string };

    // Add inbox item with repeatable links
    const inboxAdd = await execCli(
      [
        'add',
        'Draft release notes',
        '--project',
        'veyra',
        '--link',
        'https://www.notion.so/veyra/release',
        '--link',
        'https://github.com/acme/veyra/pull/42',
        '--link',
        'https://example.com/spec',
        '--notes',
        'Include CLI docs',
        '--json',
      ],
      baseEnv(),
    );
    expect(inboxAdd.exitCode).toBe(0);
    const inboxBlock = JSON.parse(inboxAdd.stdout) as {
      id: string;
      projectId: string;
      bucket: string;
      externalLinks: Array<{ url: string; source: string }>;
    };
    expect(inboxBlock.projectId).toBe(project.id);
    expect(inboxBlock.bucket).toBe('inbox');
    expect(inboxBlock.externalLinks.map((l) => l.source)).toEqual(['notion', 'github', 'web']);

    // Inbox list contains it
    const inboxList = await execCli(['inbox', '--json'], baseEnv());
    expect(inboxList.exitCode).toBe(0);
    expect((JSON.parse(inboxList.stdout) as { blocks: Array<{ id: string }> }).blocks.some((b) => b.id === inboxBlock.id)).toBe(true);

    // Move with date + HH:MM start/end
    const moveRes = await execCli(
      ['move', inboxBlock.id, '--date', '2026-11-24', '--start', '09:30', '--end', '10:30', '--json'],
      baseEnv(),
    );
    expect(moveRes.exitCode).toBe(0);
    const moved = JSON.parse(moveRes.stdout) as {
      bucket: string;
      scheduledDate: string;
      plannedStartAt: string | null;
      plannedEndAt: string | null;
    };
    expect(moved.bucket).toBe('scheduled');
    expect(moved.scheduledDate).toBe('2026-11-24');
    expect(moved.plannedStartAt).toBeTruthy();
    expect(moved.plannedEndAt).toBeTruthy();
    expect(Date.parse(moved.plannedEndAt!) - Date.parse(moved.plannedStartAt!)).toBe(60 * 60_000);

    // Add recurring block using comma shorthand mon,wed,fri
    const recRes = await execCli(
      ['add', 'Triage Sentry alerts', '--ops', '--date', '2026-11-24', '--repeat', 'mon,wed,fri', '--json'],
      baseEnv(),
    );
    expect(recRes.exitCode).toBe(0);
    const recBlock = JSON.parse(recRes.stdout) as { id: string; recurrenceRule: string; orderKey: string };
    expect(recBlock.recurrenceRule).toBe('days:[mon,wed,fri]');

    // Reorder recBlock before inboxBlock
    const reorderRes = await execCli(
      ['reorder', recBlock.id, '--after', inboxBlock.id, '--json'],
      baseEnv(),
    );
    expect(reorderRes.exitCode).toBe(0);
    const reordered = JSON.parse(reorderRes.stdout) as { id: string; orderKey: string };
    expect(reordered.orderKey < (JSON.parse(moveRes.stdout) as { orderKey: string }).orderKey).toBe(true);

    // Plan view
    const planRes = await execCli(['plan', '--week', '2026-11-23', '--json'], baseEnv());
    expect(planRes.exitCode).toBe(0);
    const plan = JSON.parse(planRes.stdout) as { weekStartDate: string; days: Array<{ date: string; blocks: Array<{ id: string }> }> };
    expect(plan.weekStartDate).toBe('2026-11-23');
    const tue = plan.days.find((d) => d.date === '2026-11-24');
    expect(tue?.blocks.map((b) => b.id)).toEqual([recBlock.id, inboxBlock.id]);

    // Park & later
    const parkRes = await execCli(['park', inboxBlock.id, '--revisit', 'next-week', '--json'], baseEnv());
    expect(parkRes.exitCode).toBe(0);
    const parked = JSON.parse(parkRes.stdout) as { bucket: string; revisitAt: string };
    expect(parked.bucket).toBe('later');
    expect(parked.revisitAt).toBe('2026-11-30');

    const laterRes = await execCli(['later', '--json'], baseEnv());
    expect(laterRes.exitCode).toBe(0);
    expect((JSON.parse(laterRes.stdout) as { blocks: Array<{ id: string }> }).blocks.some((b) => b.id === inboxBlock.id)).toBe(true);

    // Drop with --stop-series & reopen
    const dropRes = await execCli(['drop', recBlock.id, '--stop-series', '--json'], baseEnv());
    expect(dropRes.exitCode).toBe(0);
    const dropped = JSON.parse(dropRes.stdout) as { status: string; recurrenceRule: string | null };
    expect(dropped.status).toBe('dropped');
    expect(dropped.recurrenceRule).toBeNull();

    const reopenRes = await execCli(['reopen', recBlock.id, '--json'], baseEnv());
    expect(reopenRes.exitCode).toBe(0);
    expect((JSON.parse(reopenRes.stdout) as { status: string }).status).toBe('todo');

    // Session log, trim, split
    const logRes = await execCli(
      [
        'session',
        'log',
        inboxBlock.id,
        '--start',
        '2026-11-23T11:00:00.000Z',
        '--end',
        '2026-11-23T12:30:00.000Z',
        '--note',
        'Deep draft',
        '--json',
      ],
      baseEnv(),
    );
    expect(logRes.exitCode).toBe(0);
    const logged = JSON.parse(logRes.stdout) as { id: string; startedAt: string; endedAt: string };

    const trimRes = await execCli(
      [
        'session',
        'trim',
        logged.id,
        '--start',
        '2026-11-23T11:05:00.000Z',
        '--end',
        '2026-11-23T12:25:00.000Z',
        '--json',
      ],
      baseEnv(),
    );
    expect(trimRes.exitCode).toBe(0);
    expect((JSON.parse(trimRes.stdout) as { startedAt: string }).startedAt).toBe('2026-11-23T11:05:00.000Z');

    const splitRes = await execCli(
      [
        'session',
        'split',
        logged.id,
        '--at',
        '2026-11-23T11:40:00.000Z',
        '--gap',
        '10',
        '--json',
      ],
      baseEnv(),
    );
    expect(splitRes.exitCode).toBe(0);
    const split = JSON.parse(splitRes.stdout) as {
      firstSession: { endedAt: string };
      secondSession: { startedAt: string; endedAt: string };
    };
    expect(split.firstSession.endedAt).toBe('2026-11-23T11:40:00.000Z');
    expect(split.secondSession.startedAt).toBe('2026-11-23T11:50:00.000Z');
    expect(split.secondSession.endedAt).toBe('2026-11-23T12:25:00.000Z');
  });

  it('persists config via config set and authenticates against bearer-protected server', async () => {
    const authServer = createVeyraServer({
      dbPath: ':memory:',
      port: 0,
      host: '127.0.0.1',
      bearerToken: 'secret-cli-token',
      enableTestClock: true,
      rolloverCheckIntervalMs: 600_000,
    });
    const started = await authServer.start();
    try {
      const cfgRes = await execCli(
        ['config', 'set', '--url', started.url, '--token', 'secret-cli-token', '--json'],
        {
          VEYRA_SERVER_URL: undefined,
          VEYRA_TOKEN: undefined,
          VEYRA_CONFIG_PATH: configPath,
          VEYRA_NOW: fixedNow,
        },
      );
      expect(cfgRes.exitCode).toBe(0);
      expect(fs.existsSync(configPath)).toBe(true);

      // Should read URL + token from config file when env vars are unset
      const projectsRes = await execCli(['projects', '--json'], {
        VEYRA_SERVER_URL: undefined,
        VEYRA_TOKEN: undefined,
        VEYRA_CONFIG_PATH: configPath,
        VEYRA_NOW: fixedNow,
      });
      expect(projectsRes.exitCode).toBe(0);
      const parsed = JSON.parse(projectsRes.stdout) as { projects: Array<{ name: string }> };
      expect(parsed.projects.some((p) => p.name === 'Other')).toBe(true);

      // Wrong token produces structured error JSON on stderr and non-zero exit code
      const badAuth = await execCli(['projects', '--json'], {
        VEYRA_SERVER_URL: started.url,
        VEYRA_TOKEN: 'wrong-token',
        VEYRA_CONFIG_PATH: configPath,
      });
      expect(badAuth.exitCode).toBe(1);
      const errJson = JSON.parse(badAuth.stderr) as { error: { code: string; message: string } };
      expect(errJson.error.code).toBe('UNAUTHORIZED');

      // config show never leaks raw token
      const showCfg = await execCli(['config', 'show', '--json'], {
        VEYRA_SERVER_URL: undefined,
        VEYRA_TOKEN: undefined,
        VEYRA_CONFIG_PATH: configPath,
      });
      expect(showCfg.exitCode).toBe(0);
      expect(showCfg.stdout).not.toContain('secret-cli-token');
      const cfgData = JSON.parse(showCfg.stdout) as {
        serverUrl: string;
        tokenConfigured: boolean;
        sources: { serverUrl: string; token: string };
      };
      expect(cfgData.serverUrl).toBe(started.url);
      expect(cfgData.tokenConfigured).toBe(true);
      expect(cfgData.sources).toEqual({ serverUrl: 'file', token: 'file' });
    } finally {
      await authServer.stop();
    }
  });

  it('preserves boolean/optional flags on update, supports stop/project/goal updates, human output, and clean JSON usage errors', async () => {
    const goalCreate = await execCli(['goal', 'create', 'Improve DX', '--json'], baseEnv());
    expect(goalCreate.exitCode).toBe(0);
    const goal = JSON.parse(goalCreate.stdout) as { id: string; status: string };

    const goalUpdate = await execCli(
      ['goal', 'update', 'improve dx', '--status', 'achieved', '--json'],
      baseEnv(),
    );
    expect(goalUpdate.exitCode).toBe(0);
    expect((JSON.parse(goalUpdate.stdout) as { status: string }).status).toBe('achieved');

    const projCreate = await execCli(
      ['project', 'create', 'CLI Tooling', '--pinned', '--json'],
      baseEnv(),
    );
    expect(projCreate.exitCode).toBe(0);
    const proj = JSON.parse(projCreate.stdout) as { id: string; isPinned: boolean };
    expect(proj.isPinned).toBe(true);

    // Updating description without --pinned/--no-pinned preserves isPinned=true
    const projUpdate1 = await execCli(
      ['project', 'update', 'cli tooling', '--description', 'Fast CLI', '--json'],
      baseEnv(),
    );
    expect(projUpdate1.exitCode).toBe(0);
    expect((JSON.parse(projUpdate1.stdout) as { isPinned: boolean; description: string })).toMatchObject({
      isPinned: true,
      description: 'Fast CLI',
    });

    // Explicitly unpinning works
    const projUpdate2 = await execCli(
      ['project', 'update', proj.id, '--no-pinned', '--json'],
      baseEnv(),
    );
    expect(projUpdate2.exitCode).toBe(0);
    expect((JSON.parse(projUpdate2.stdout) as { isPinned: boolean }).isPinned).toBe(false);

    // Block with ops=true and repeat=weekdays
    const addRes = await execCli(
      ['add', 'Morning triage', '--ops', '--date', '2026-11-23', '--repeat', 'weekdays', '--json'],
      baseEnv(),
    );
    const blk = JSON.parse(addRes.stdout) as { id: string; isOps: boolean; recurrenceRule: string };
    expect(blk.isOps).toBe(true);
    expect(blk.recurrenceRule).toBe('weekdays');

    // Updating title alone preserves isOps and recurrenceRule
    const upd1 = await execCli(['update', blk.id, '--title', 'Daily triage', '--json'], baseEnv());
    expect(upd1.exitCode).toBe(0);
    expect(JSON.parse(upd1.stdout) as { title: string; isOps: boolean; recurrenceRule: string }).toMatchObject({
      title: 'Daily triage',
      isOps: true,
      recurrenceRule: 'weekdays',
    });

    // Explicitly clearing --no-ops and --no-repeat works
    const upd2 = await execCli(
      ['update', blk.id, '--no-ops', '--no-repeat', '--json'],
      baseEnv(),
    );
    expect(upd2.exitCode).toBe(0);
    expect(JSON.parse(upd2.stdout) as { isOps: boolean; recurrenceRule: string | null }).toMatchObject({
      isOps: false,
      recurrenceRule: null,
    });

    // Updating title on a non-ops block preserves isOps=false (verifies --no-ops doesn't default ops to true)
    const upd3 = await execCli(
      ['update', blk.id, '--title', 'Daily triage v2', '--json'],
      baseEnv(),
    );
    expect(upd3.exitCode).toBe(0);
    expect(JSON.parse(upd3.stdout) as { title: string; isOps: boolean }).toMatchObject({
      title: 'Daily triage v2',
      isOps: false,
    });

    // Updating unpinned project preserves isPinned=false
    const projUpdate3 = await execCli(
      ['project', 'update', proj.id, '--description', 'Fast CLI v2', '--json'],
      baseEnv(),
    );
    expect(projUpdate3.exitCode).toBe(0);
    expect(JSON.parse(projUpdate3.stdout) as { isPinned: boolean; description: string }).toMatchObject({
      isPinned: false,
      description: 'Fast CLI v2',
    });

    // Start then stop focus
    expect((await execCli(['start', blk.id, '--json'], baseEnv())).exitCode).toBe(0);
    const stopRes = await execCli(['stop', '--json'], baseEnv({ VEYRA_NOW: '2026-11-23T09:10:00.000Z' }));
    expect(stopRes.exitCode).toBe(0);
    expect((JSON.parse(stopRes.stdout) as { closedSession: { endedAt: string | null } }).closedSession.endedAt).toBeTruthy();

    // Human-readable output (no --json) succeeds cleanly
    const humanToday = await execCli(['today'], baseEnv());
    expect(humanToday.exitCode).toBe(0);
    expect(humanToday.stdout).toContain('Daily triage');

    // Usage error with --json outputs single valid JSON object on stderr
    const usageErr = await execCli(['add', '--json'], baseEnv());
    expect(usageErr.exitCode).not.toBe(0);
    const parsedErr = JSON.parse(usageErr.stderr) as { error: { code: string; message: string } };
    expect(parsedErr.error.code).toBe('USAGE_ERROR');
  });
});
