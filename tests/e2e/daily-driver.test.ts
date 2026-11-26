import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { runCli, startHookListener } from '../../packages/cli/src/index.js';
import { createVeyraServer, type VeyraServerInstance } from '../../packages/server/src/app.js';
import { afterEach, describe, expect, it } from 'vitest';

interface SseEvent {
  type: string;
  entity?: string;
  id?: string;
  timestamp?: string;
}

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

function startLocalHttpServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        throw new Error('Unexpected HTTP server address');
      }
      resolve({ server, url: `http://127.0.0.1:${addr.port}` });
    });
  });
}

async function waitFor<T>(
  predicate: () => T | undefined | false,
  timeoutMs = 4000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for condition`);
}

describe('Veyra E2E daily-driver suite', () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop()!;
      await fn();
    }
  });

  it('runs the complete daily-driver lifecycle across HTTP, CLI, SSE, ICS/Outlook sync, rollover, multi-day sessions, and Weekly Review', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veyra-e2e-'));
    cleanups.push(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

    const dbPath = path.join(tmpDir, 'veyra.db');
    const cliConfigPath = path.join(tmpDir, 'cli-config.json');

    const server: VeyraServerInstance = createVeyraServer({
      dbPath,
      port: 0,
      host: '127.0.0.1',
      enableTestClock: true,
      rolloverCheckIntervalMs: 600_000,
    });
    const started = await server.start();
    cleanups.push(() => server.stop());

    const baseUrl = started.url;

    const api = async <T = Record<string, unknown>>(
      method: string,
      route: string,
      opts?: { body?: unknown; now?: string; actor?: string },
    ): Promise<{ status: number; data: T }> => {
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'X-Veyra-Actor': opts?.actor ?? 'user',
      };
      if (opts?.body !== undefined) {
        headers['Content-Type'] = 'application/json';
      }
      if (opts?.now) {
        headers['X-Veyra-Now'] = opts.now;
      }
      const res = await fetch(`${baseUrl}${route}`, {
        method,
        headers,
        body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
      const text = await res.text();
      const data = text.trim() ? (JSON.parse(text) as T) : ({} as T);
      return { status: res.status, data };
    };

    const cliEnv = (nowIso: string) => ({
      VEYRA_SERVER_URL: baseUrl,
      VEYRA_TOKEN: undefined,
      VEYRA_CONFIG_PATH: cliConfigPath,
      VEYRA_ACTOR: 'cli',
      VEYRA_NOW: nowIso,
    });

    // -----------------------------------------------------------------------
    // 1. Live SSE stream connection
    // -----------------------------------------------------------------------
    const sseAbort = new AbortController();
    cleanups.push(() => sseAbort.abort());

    const sseEvents: SseEvent[] = [];
    const sseResp = await fetch(`${baseUrl}/api/events/stream`, {
      signal: sseAbort.signal,
    });
    expect(sseResp.status).toBe(200);
    expect(sseResp.body).toBeTruthy();

    const reader = sseResp.body!.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = '';

    const pumpSse = (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          sseBuffer += decoder.decode(value, { stream: true });
          const frames = sseBuffer.split('\n\n');
          sseBuffer = frames.pop() ?? '';
          for (const frame of frames) {
            const dataLine = frame
              .split('\n')
              .find((line) => line.startsWith('data:'));
            if (!dataLine) continue;
            const raw = dataLine.slice('data:'.length).trim();
            try {
              const parsed = JSON.parse(raw) as SseEvent;
              if (parsed.type) {
                sseEvents.push(parsed);
              }
            } catch {
              // Ignore non-JSON heartbeat payloads
            }
          }
        }
      } catch {
        // Expected on AbortController cancel in afterEach
      }
    })();
    void pumpSse;

    // Set timezone to UTC so date boundaries are deterministic across machines
    const mondayMorning = '2026-11-23T08:00:00.000Z';
    const settingsInit = await api('PATCH', '/api/settings', {
      now: mondayMorning,
      body: { timezone: 'UTC', onboardingCompleted: true },
    });
    expect(settingsInit.status).toBe(200);

    // -----------------------------------------------------------------------
    // 2. System `Other` project protection, unlimited pinned projects, inline Goals
    // -----------------------------------------------------------------------
    const projectsRes = await api<{
      projects: Array<{ id: string; name: string; isSystem: boolean }>;
    }>('GET', '/api/projects', { now: mondayMorning });
    expect(projectsRes.status).toBe(200);
    const otherProject = projectsRes.data.projects.find((p) => p.name === 'Other');
    expect(otherProject).toBeDefined();
    expect(otherProject?.isSystem).toBe(true);

    // Attempting to delete system `Other` project must be rejected
    const delOther = await api<{ error: { code: string } }>(
      'DELETE',
      `/api/projects/${otherProject!.id}`,
      { now: mondayMorning },
    );
    expect(delOther.status).toBeGreaterThanOrEqual(400);
    expect(delOther.data.error.code).toBeTruthy();

    // Create 3 Goals (one inline via HTTP, two via CLI)
    const goal1Res = await api<{ goal: { id: string; name: string } }>('POST', '/api/goals', {
      now: mondayMorning,
      body: {
        name: 'Ship Veyra v1',
        description: 'Daily-driver local-first execution workspace',
        color: '#3B4BD8',
      },
    });
    expect(goal1Res.status).toBe(201);
    const goal1 = goal1Res.data.goal;

    const goal2Cli = await execCli(
      ['goal', 'create', 'Customer Delivery Excellence', '--json'],
      cliEnv(mondayMorning),
    );
    expect(goal2Cli.exitCode).toBe(0);
    const goal2 = JSON.parse(goal2Cli.stdout) as { id: string; name: string };

    // Unlimited pinned projects (create 5 pinned projects — no arbitrary cap)
    const createdProjects: Array<{ id: string; name: string }> = [];
    for (const [idx, spec] of [
      { name: 'Veyra Core', icon: 'Rocket', color: '#3B4BD8', defaultGoalId: goal1.id },
      { name: 'Desktop Shell', icon: 'Layers', color: '#5566F2', defaultGoalId: goal1.id },
      { name: 'Customer A', icon: null, color: '#2F9E66', defaultGoalId: goal2.id },
      { name: 'Customer B', icon: 'Briefcase', color: '#E8B417', defaultGoalId: goal2.id },
      { name: 'Platform Ops', icon: 'Code', color: '#9A9A9A', defaultGoalId: null },
    ].entries()) {
      const pRes = await api<{ project: { id: string; name: string; isPinned: boolean } }>(
        'POST',
        '/api/projects',
        {
          now: mondayMorning,
          body: { ...spec, isPinned: true },
        },
      );
      expect(pRes.status).toBe(201);
      expect(pRes.data.project.isPinned).toBe(true);
      createdProjects[idx] = pRes.data.project;
    }

    const veyraCore = createdProjects[0];
    const customerA = createdProjects[2];
    const platformOps = createdProjects[4];

    const listPinned = await api<{ projects: Array<{ isPinned: boolean }> }>(
      'GET',
      '/api/projects',
      { now: mondayMorning },
    );
    expect(listPinned.data.projects.filter((p) => p.isPinned).length).toBeGreaterThanOrEqual(5);

    // -----------------------------------------------------------------------
    // 3. Planning, `Later` default `revisitAt`, `Planned` calendar slots
    // -----------------------------------------------------------------------
    const inboxBlockRes = await api<{
      block: { id: string; bucket: string; projectId: string };
    }>('POST', '/api/blocks', {
      now: mondayMorning,
      body: {
        title: 'Design desktop IPC bridge',
        projectId: veyraCore.id,
        goalId: goal1.id,
        bucket: 'inbox',
        notes: 'Check preload surface',
        externalLinks: [
          {
            url: 'https://github.com/acme/veyra/issues/13',
            title: 'Desktop shell issue',
            source: 'github',
          },
        ],
      },
    });
    expect(inboxBlockRes.status).toBe(201);
    const focusBlockId = inboxBlockRes.data.block.id;

    // Schedule it onto Monday with Planned calendar slot 09:00-10:30 UTC
    const movePlanned = await api<{
      block: {
        id: string;
        bucket: string;
        scheduledDate: string;
        plannedStartAt: string | null;
        plannedEndAt: string | null;
      };
    }>('POST', `/api/blocks/${focusBlockId}/move`, {
      now: mondayMorning,
      body: {
        bucket: 'scheduled',
        scheduledDate: '2026-11-23',
        plannedStartAt: '2026-11-23T09:00:00.000Z',
        plannedEndAt: '2026-11-23T10:30:00.000Z',
      },
    });
    expect(movePlanned.status).toBe(200);
    expect(movePlanned.data.block.bucket).toBe('scheduled');
    expect(movePlanned.data.block.plannedStartAt).toBe('2026-11-23T09:00:00.000Z');
    expect(movePlanned.data.block.plannedEndAt).toBe('2026-11-23T10:30:00.000Z');

    // Create a block and park it into Later without explicit revisitAt -> default ~4 weeks ahead
    const laterDefaultRes = await api<{ block: { id: string } }>('POST', '/api/blocks', {
      now: mondayMorning,
      body: { title: 'Evaluate Linux AppImage packaging', projectId: veyraCore.id },
    });
    const parkedDefault = await api<{ block: { bucket: string; revisitAt: string | null } }>(
      'POST',
      `/api/blocks/${laterDefaultRes.data.block.id}/park`,
      { now: mondayMorning, body: {} },
    );
    expect(parkedDefault.status).toBe(200);
    expect(parkedDefault.data.block.bucket).toBe('later');
    expect(parkedDefault.data.block.revisitAt).toBe('2026-12-07'); // default 2w (14 days) from 2026-11-23

    // Also create a Later block whose revisitAt will be due by Friday (for Review `pastRevisitLater`)
    const laterDueRes = await api<{ block: { id: string } }>('POST', '/api/blocks', {
      now: mondayMorning,
      body: { title: 'Revisit legacy migration guide', projectId: customerA.id },
    });
    const laterDueId = laterDueRes.data.block.id;
    const parkDue = await api<{ block: { bucket: string; revisitAt: string } }>(
      'POST',
      `/api/blocks/${laterDueId}/park`,
      { now: mondayMorning, body: { revisitAt: '2026-11-25' } },
    );
    expect(parkDue.status).toBe(200);
    expect(parkDue.data.block.revisitAt).toBe('2026-11-25');

    // -----------------------------------------------------------------------
    // 4. Focus lifecycle (start -> pause with resume note -> resume -> complete omitting blockId)
    // -----------------------------------------------------------------------
    const cliStart = await execCli(
      ['start', focusBlockId, '--json'],
      cliEnv('2026-11-23T09:00:00.000Z'),
    );
    expect(cliStart.exitCode).toBe(0);

    await waitFor(() =>
      sseEvents.find((e) => e.type === 'focus.started' && e.entity === 'focus_session'),
    );

    const cliPause = await execCli(
      ['pause', '--note', 'Paused before wiring tray icon', '--json'],
      cliEnv('2026-11-23T09:40:00.000Z'),
    );
    expect(cliPause.exitCode).toBe(0);
    const pausedPayload = JSON.parse(cliPause.stdout) as {
      closedSession: { id: string; note: string };
      block: { resumeNote: string };
    };
    expect(pausedPayload.closedSession.note).toBe('Paused before wiring tray icon');
    expect(pausedPayload.block.resumeNote).toBe('Paused before wiring tray icon');

    await waitFor(() => sseEvents.find((e) => e.type === 'focus.paused'));

    const cliResume = await execCli(
      ['resume', focusBlockId, '--json'],
      cliEnv('2026-11-23T10:00:00.000Z'),
    );
    expect(cliResume.exitCode).toBe(0);

    // Complete omitting blockId -> completes active block
    const cliDone = await execCli(
      ['done', '--energy', 'up', '--outcome', 'IPC bridge & preload shipped', '--json'],
      cliEnv('2026-11-23T10:35:00.000Z'),
    );
    expect(cliDone.exitCode).toBe(0);
    const donePayload = JSON.parse(cliDone.stdout) as {
      block: { id: string; status: string; energySignal: string; outcomeNote: string };
      totalBlockMinutes: number;
    };
    expect(donePayload.block.id).toBe(focusBlockId);
    expect(donePayload.block.status).toBe('done');
    expect(donePayload.block.energySignal).toBe('up');
    expect(donePayload.block.outcomeNote).toBe('IPC bridge & preload shipped');
    expect(donePayload.totalBlockMinutes).toBe(75); // 40m + 35m

    await waitFor(() =>
      sseEvents.find((e) => e.type === 'block.completed' && e.id === focusBlockId),
    );

    // -----------------------------------------------------------------------
    // 5. Multi-day sessions + log + trim + split + Calendar Done vs Planned
    // -----------------------------------------------------------------------
    const multiDayBlockRes = await api<{ block: { id: string } }>('POST', '/api/blocks', {
      now: '2026-11-23T11:00:00.000Z',
      body: {
        title: 'Customer A ERP architecture spec',
        projectId: customerA.id,
        goalId: goal2.id,
        bucket: 'scheduled',
        scheduledDate: '2026-11-23',
        plannedStartAt: '2026-11-24T13:00:00.000Z',
        plannedEndAt: '2026-11-24T14:30:00.000Z',
      },
    });
    const multiDayBlockId = multiDayBlockRes.data.block.id;

    // Session 1 on Monday (logged via CLI), trimmed & split
    const logDay1 = await execCli(
      [
        'session',
        'log',
        multiDayBlockId,
        '--start',
        '2026-11-23T13:00:00.000Z',
        '--end',
        '2026-11-23T15:00:00.000Z',
        '--note',
        'Drafted data model',
        '--json',
      ],
      cliEnv('2026-11-23T15:05:00.000Z'),
    );
    expect(logDay1.exitCode).toBe(0);
    const day1Session = JSON.parse(logDay1.stdout) as { id: string };

    const trimRes = await execCli(
      [
        'session',
        'trim',
        day1Session.id,
        '--start',
        '2026-11-23T13:10:00.000Z',
        '--end',
        '2026-11-23T14:50:00.000Z',
        '--json',
      ],
      cliEnv('2026-11-23T15:10:00.000Z'),
    );
    expect(trimRes.exitCode).toBe(0);

    const splitRes = await execCli(
      [
        'session',
        'split',
        day1Session.id,
        '--at',
        '2026-11-23T14:00:00.000Z',
        '--gap',
        '10',
        '--json',
      ],
      cliEnv('2026-11-23T15:15:00.000Z'),
    );
    expect(splitRes.exitCode).toBe(0);
    const splitPayload = JSON.parse(splitRes.stdout) as {
      firstSession: { startedAt: string; endedAt: string };
      secondSession: { startedAt: string; endedAt: string };
    };
    expect(splitPayload.firstSession.startedAt).toBe('2026-11-23T13:10:00.000Z');
    expect(splitPayload.firstSession.endedAt).toBe('2026-11-23T14:00:00.000Z');
    expect(splitPayload.secondSession.startedAt).toBe('2026-11-23T14:10:00.000Z');
    expect(splitPayload.secondSession.endedAt).toBe('2026-11-23T14:50:00.000Z');

    // Session 2 on Tuesday on the same block -> multi-day session attribution
    const logDay2 = await api<{ session: { id: string } }>('POST', '/api/sessions', {
      now: '2026-11-24T12:00:00.000Z',
      body: {
        blockId: multiDayBlockId,
        startedAt: '2026-11-24T10:00:00.000Z',
        endedAt: '2026-11-24T11:00:00.000Z',
        note: 'Reviewed edge cases',
      },
    });
    expect(logDay2.status).toBe(201);

    // Complete multi-day block with energy 'neutral'
    const completeMulti = await api<{ block: { status: string }; totalBlockMinutes: number }>(
      'POST',
      '/api/focus/complete',
      {
        now: '2026-11-24T12:15:00.000Z',
        body: {
          blockId: multiDayBlockId,
          energySignal: 'neutral',
          outcomeNote: 'Spec signed off by engineering',
        },
      },
    );
    expect(completeMulti.status).toBe(200);
    expect(completeMulti.data.totalBlockMinutes).toBe(150); // 50m + 40m + 60m

    // Check /api/calendar shows both Done sessions & Planned blocks
    const calRes = await api<{
      sessions: Array<{ blockId: string }>;
      plannedBlocks: Array<{ id: string }>;
    }>('GET', '/api/calendar?start=2026-11-23&end=2026-11-29', {
      now: '2026-11-24T12:30:00.000Z',
    });
    expect(calRes.status).toBe(200);
    expect(calRes.data.sessions.filter((s) => s.blockId === multiDayBlockId)).toHaveLength(3);
    expect(calRes.data.plannedBlocks.some((b) => b.id === focusBlockId)).toBe(true);
    expect(calRes.data.plannedBlocks.some((b) => b.id === multiDayBlockId)).toBe(true);

    // -----------------------------------------------------------------------
    // 6. Calendar Sync: IcsFeedAdapter + metadata preservation + mock OutlookCliAdapter
    // -----------------------------------------------------------------------
    let icsBody = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Veyra E2E//EN',
      'BEGIN:VEVENT',
      'UID:e2e-arch-sync@veyra.test',
      'DTSTAMP:20261120T080000Z',
      'DTSTART:20261124T150000Z',
      'DTEND:20261124T160000Z',
      'SUMMARY:Customer A Architecture Review',
      'DESCRIPTION:Teams https://teams.microsoft.com/l/meetup-join/e2e-room',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:e2e-allday@veyra.test',
      'DTSTAMP:20261120T080000Z',
      'DTSTART;VALUE=DATE:20261125',
      'DTEND;VALUE=DATE:20261126',
      'SUMMARY:All Day Holiday',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const icsServer = await startLocalHttpServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8' });
      res.end(icsBody);
    });
    cleanups.push(
      () => new Promise<void>((resolve) => icsServer.server.close(() => resolve())),
    );

    await api('PATCH', '/api/settings', {
      now: '2026-11-23T08:30:00.000Z',
      body: {
        calendarSyncMode: 'ics',
        icsFeedUrl: `${icsServer.url}/feed.ics`,
        skipDeclinedAndAllDay: true,
      },
    });

    const icsSync1 = await api<{
      status: { state: string };
      result: { createdCount: number; skippedCount: number };
    }>('POST', '/api/events/sync', { now: '2026-11-23T08:31:00.000Z' });
    expect(icsSync1.status).toBe(200);
    expect(icsSync1.data.status.state).toBe('connected');
    expect(icsSync1.data.result.createdCount).toBe(1);
    expect(icsSync1.data.result.skippedCount).toBe(1); // all-day skipped

    await waitFor(() => sseEvents.find((e) => e.type === 'events.synced'));

    // Link meeting to Customer A + Goal 2 + notes via CLI `events assign`
    const eventsAfterIcs = await api<{
      events: Array<{ id: string; externalId: string; title: string }>;
    }>('GET', '/api/events?start=2026-11-23&end=2026-11-29', {
      now: '2026-11-23T08:32:00.000Z',
    });
    const archMeeting = eventsAfterIcs.data.events.find(
      (e) => e.externalId === 'e2e-arch-sync@veyra.test',
    );
    expect(archMeeting).toBeDefined();

    const assignMeetingCli = await execCli(
      [
        'events',
        'assign',
        archMeeting!.id,
        '--project',
        'Customer A',
        '--goal',
        'Customer Delivery Excellence',
        '--notes',
        'Confirmed milestone sign-off date',
        '--json',
      ],
      cliEnv('2026-11-23T08:35:00.000Z'),
    );
    expect(assignMeetingCli.exitCode).toBe(0);

    // Change title in ICS feed & re-sync -> projectId, goalId, notes MUST be preserved!
    icsBody = icsBody.replace(
      'SUMMARY:Customer A Architecture Review',
      'SUMMARY:Customer A Architecture Review (Updated)',
    );
    const icsSync2 = await api<{ status: { state: string }; result: { updatedCount: number } }>(
      'POST',
      '/api/events/sync',
      { now: '2026-11-23T08:40:00.000Z' },
    );
    expect(icsSync2.status).toBe(200);
    expect(icsSync2.data.result.updatedCount).toBe(1);

    const eventsAfterResync = await api<{
      events: Array<{
        id: string;
        title: string;
        projectId: string | null;
        goalId: string | null;
        notes: string;
      }>;
    }>('GET', '/api/events?start=2026-11-23&end=2026-11-29', {
      now: '2026-11-23T08:41:00.000Z',
    });
    const preserved = eventsAfterResync.data.events.find((e) => e.id === archMeeting!.id)!;
    expect(preserved.title).toBe('Customer A Architecture Review (Updated)');
    expect(preserved.projectId).toBe(customerA.id);
    expect(preserved.goalId).toBe(goal2.id);
    expect(preserved.notes).toBe('Confirmed milestone sign-off date');

    // Switch to mock OutlookCliAdapter JSON script & verify sync
    const mockOutlookScript = path.join(tmpDir, 'mock-outlook.mjs');
    fs.writeFileSync(
      mockOutlookScript,
      `
console.log(JSON.stringify([
  {
    externalId: 'outlook-e2e-1',
    title: 'Weekly Product Triage',
    startAt: '2026-11-25T10:00:00.000Z',
    endAt: '2026-11-25T10:45:00.000Z',
    isAllDay: false,
    isDeclined: false,
    meetingUrl: 'https://teams.microsoft.com/l/meetup-join/triage'
  }
]));
`,
      'utf8',
    );

    await api('PATCH', '/api/settings', {
      now: '2026-11-23T08:45:00.000Z',
      body: {
        calendarSyncMode: 'outlook_cli',
        outlookCliCommand: `"${process.execPath}" "${mockOutlookScript}"`,
      },
    });

    const outlookSync = await api<{ status: { state: string }; result: { createdCount: number } }>(
      'POST',
      '/api/events/sync',
      { now: '2026-11-23T08:46:00.000Z' },
    );
    expect(outlookSync.status).toBe(200);
    expect(outlookSync.data.status.state).toBe('connected');
    expect(outlookSync.data.result.createdCount).toBe(1);

    const eventsAfterOutlook = await api<{ events: Array<{ externalId: string; title: string }> }>(
      'GET',
      '/api/events?start=2026-11-23&end=2026-11-29',
      { now: '2026-11-23T08:47:00.000Z' },
    );
    expect(
      eventsAfterOutlook.data.events.some(
        (e) => e.externalId === 'outlook-e2e-1' && e.title === 'Weekly Product Triage',
      ),
    ).toBe(true);

    // -----------------------------------------------------------------------
    // 7. Midnight rollover via X-Veyra-Now:
    //    - Unfinished scheduled block accumulates carryoverCount (+1 per day -> chronic >= 3)
    //    - Untouched recurring weekday block is soft-deleted with 0 carryover, next weekday materialized
    //    - Recurring Ops blocks logged across 2 days roll up in Ops Radar
    // -----------------------------------------------------------------------
    const chronicBlockRes = await api<{ block: { id: string } }>('POST', '/api/blocks', {
      now: '2026-11-23T08:00:00.000Z',
      body: {
        title: 'Clean up legacy billing flags',
        projectId: platformOps.id,
        bucket: 'scheduled',
        scheduledDate: '2026-11-23',
      },
    });
    const chronicBlockId = chronicBlockRes.data.block.id;

    // Untouched recurring weekday block on Monday
    const untouchedRecurringRes = await api<{
      block: { id: string; seriesId: string };
    }>('POST', '/api/blocks', {
      now: '2026-11-23T08:00:00.000Z',
      body: {
        title: 'Inbox zero sweep',
        projectId: platformOps.id,
        bucket: 'scheduled',
        scheduledDate: '2026-11-23',
        isOps: true,
        recurrenceRule: 'weekdays',
      },
    });
    const untouchedMonId = untouchedRecurringRes.data.block.id;
    const untouchedSeriesId = untouchedRecurringRes.data.block.seriesId;

    // Recurring pure-Ops series that we DO work on Monday and Tuesday (for Ops Radar seriesId rollup)
    const opsSeriesRes = await api<{ block: { id: string; seriesId: string } }>(
      'POST',
      '/api/blocks',
      {
        now: '2026-11-23T08:00:00.000Z',
        body: {
          title: 'Daily support triage',
          projectId: platformOps.id,
          bucket: 'scheduled',
          scheduledDate: '2026-11-23',
          isOps: true,
          recurrenceRule: 'weekdays',
        },
      },
    );
    const opsMonId = opsSeriesRes.data.block.id;
    const opsSeriesId = opsSeriesRes.data.block.seriesId;

    await api('POST', '/api/sessions', {
      now: '2026-11-23T16:30:00.000Z',
      body: {
        blockId: opsMonId,
        startedAt: '2026-11-23T16:00:00.000Z',
        endedAt: '2026-11-23T16:30:00.000Z',
      },
    });
    await api('POST', '/api/focus/complete', {
      now: '2026-11-23T16:31:00.000Z',
      body: { blockId: opsMonId, energySignal: 'down', outcomeNote: 'Handled 6 tickets' },
    });

    // Goal-linked Ops block (separated from pure Ops in Ops Radar)
    const goalOpsRes = await api<{ block: { id: string } }>('POST', '/api/blocks', {
      now: '2026-11-24T08:30:00.000Z',
      body: {
        title: 'Release pipeline hotfix',
        projectId: veyraCore.id,
        goalId: goal1.id,
        bucket: 'scheduled',
        scheduledDate: '2026-11-24',
        isOps: true,
      },
    });
    const goalOpsId = goalOpsRes.data.block.id;
    await api('POST', '/api/sessions', {
      now: '2026-11-24T09:20:00.000Z',
      body: {
        blockId: goalOpsId,
        startedAt: '2026-11-24T08:50:00.000Z',
        endedAt: '2026-11-24T09:20:00.000Z',
      },
    });
    await api('POST', '/api/focus/complete', {
      now: '2026-11-24T09:21:00.000Z',
      body: { blockId: goalOpsId, energySignal: 'up', outcomeNote: 'Fixed CI flake' },
    });

    // Trigger Tuesday rollover (day 1)
    const tueToday = await api<{
      date: string;
      upNext: Array<{ id: string; title: string; seriesId: string | null; carryoverCount: number }>;
    }>('GET', '/api/today', { now: '2026-11-24T08:00:00.000Z' });
    expect(tueToday.status).toBe(200);
    expect(tueToday.data.date).toBe('2026-11-24');

    // Untouched Monday recurring block must be soft-deleted (404 on GET) and a fresh Tuesday occurrence materialized with carryoverCount = 0
    const getUntouchedMon = await api('GET', `/api/blocks/${untouchedMonId}`, {
      now: '2026-11-24T08:00:00.000Z',
    });
    expect(getUntouchedMon.status).toBe(404);

    const tueUntouchedOcc = tueToday.data.upNext.find((b) => b.seriesId === untouchedSeriesId);
    expect(tueUntouchedOcc).toBeDefined();
    expect(tueUntouchedOcc?.carryoverCount).toBe(0);

    // Work on Tuesday's Daily support triage occurrence so Ops Radar rolls up 2 occurrences (30m + 20m = 50m)
    const tueOpsOcc = tueToday.data.upNext.find((b) => b.seriesId === opsSeriesId);
    expect(tueOpsOcc).toBeDefined();
    await api('POST', '/api/sessions', {
      now: '2026-11-24T16:20:00.000Z',
      body: {
        blockId: tueOpsOcc!.id,
        startedAt: '2026-11-24T16:00:00.000Z',
        endedAt: '2026-11-24T16:20:00.000Z',
      },
    });
    await api('POST', '/api/focus/complete', {
      now: '2026-11-24T16:21:00.000Z',
      body: { blockId: tueOpsOcc!.id, energySignal: 'down' },
    });

    // Advance Wednesday (carryover 2) and Thursday (carryover 3) -> chronic carryover!
    await api('GET', '/api/today', { now: '2026-11-25T08:00:00.000Z' });
    const thuToday = await api<{
      upNext: Array<{ id: string; carryoverCount: number }>;
    }>('GET', '/api/today', { now: '2026-11-26T08:00:00.000Z' });
    const chronicOnThu = thuToday.data.upNext.find((b) => b.id === chronicBlockId);
    expect(chronicOnThu).toBeDefined();
    expect(chronicOnThu?.carryoverCount).toBe(3);

    // -----------------------------------------------------------------------
    // 8. Daily Notes + Weekly Review + Weekly Rule carryover into next week
    // -----------------------------------------------------------------------
    const noteCli = await execCli(
      ['note', 'add', 'Blocking 09:00-11:00 for deep work doubled throughput', '--json'],
      cliEnv('2026-11-25T17:00:00.000Z'),
    );
    expect(noteCli.exitCode).toBe(0);

    const noteHttp = await api<{ note: { id: string } }>('POST', '/api/notes', {
      now: '2026-11-26T16:00:00.000Z',
      body: {
        content: 'Too many ad-hoc support pings on Tuesday afternoon',
        projectId: platformOps.id,
        isOps: true,
      },
    });
    expect(noteHttp.status).toBe(201);

    // Friday Review
    const fridayNow = '2026-11-27T17:00:00.000Z';
    const reviewRes = await api<{
      weekStartDate: string;
      totalFocusMinutes: number;
      buildMinutes: number;
      opsMinutes: number;
      energyCounts: { up: number; neutral: number; down: number };
      progressFeed: Array<{ kind: string; id: string }>;
      dailyNotes: Array<{ content: string }>;
      opsRadar: {
        pureOpsMinutes: number;
        goalLinkedOpsMinutes: number;
        pureOpsItems: Array<{ seriesId: string | null; occurrenceCount: number; totalMinutes: number }>;
        goalLinkedOpsItems: Array<{ totalMinutes: number }>;
      };
      chronicCarryovers: Array<{ id: string; carryoverCount: number }>;
      pastRevisitLater: Array<{ id: string; revisitAt: string }>;
    }>('GET', '/api/review?weekStart=2026-11-23', { now: fridayNow });

    expect(reviewRes.status).toBe(200);
    const rev = reviewRes.data;
    expect(rev.weekStartDate).toBe('2026-11-23');
    // Build: 75m (focusBlock) + 150m (multiDayBlock) = 225m; Ops: 30m + 20m (pure) + 30m (goal-linked) = 80m; Total = 305m
    expect(rev.buildMinutes).toBe(225);
    expect(rev.opsMinutes).toBe(80);
    expect(rev.totalFocusMinutes).toBe(305);

    // Raw energy counts (never percentages): 2 up (focusBlock, goalOps), 1 neutral (multiDay), 2 down (opsMon, tueOps)
    expect(rev.energyCounts).toEqual({ up: 2, neutral: 1, down: 2 });

    // Progress feed includes completed blocks + goal-linked meeting
    expect(rev.progressFeed.some((i) => i.kind === 'block' && i.id === focusBlockId)).toBe(true);
    expect(rev.progressFeed.some((i) => i.kind === 'meeting' && i.id === archMeeting!.id)).toBe(
      true,
    );

    // Ops Radar splits pure Ops vs goal-linked Ops and rolls up recurring series
    expect(rev.opsRadar.pureOpsMinutes).toBe(50);
    expect(rev.opsRadar.goalLinkedOpsMinutes).toBe(30);
    const rolledUpOps = rev.opsRadar.pureOpsItems.find((i) => i.seriesId === opsSeriesId);
    expect(rolledUpOps).toBeDefined();
    expect(rolledUpOps?.occurrenceCount).toBe(2);
    expect(rolledUpOps?.totalMinutes).toBe(50);
    expect(rev.opsRadar.goalLinkedOpsItems).toHaveLength(1);
    expect(rev.opsRadar.goalLinkedOpsItems[0].totalMinutes).toBe(30);

    // Chronic carryovers (>= 3) & past-revisit Later items (revisitAt <= 2026-11-27)
    expect(rev.chronicCarryovers.some((b) => b.id === chronicBlockId && b.carryoverCount >= 3)).toBe(
      true,
    );
    expect(rev.pastRevisitLater.some((b) => b.id === laterDueId)).toBe(true);
    expect(rev.dailyNotes).toHaveLength(2);

    // Set weekly rule for next week via CLI -> carries over into next week's activeRuleText!
    const setRuleCli = await execCli(
      ['review', 'set-rule', 'No meetings before 11:00 Mon-Thu', '--json'],
      cliEnv(fridayNow),
    );
    expect(setRuleCli.exitCode).toBe(0);

    // Advance into next week (Monday 2026-11-30) and verify activeRuleText on BOTH /api/today and /api/review
    const nextMondayNow = '2026-11-30T08:00:00.000Z';
    const nextWeekToday = await api<{ weeklyRule: string | null }>('GET', '/api/today', {
      now: nextMondayNow,
    });
    expect(nextWeekToday.status).toBe(200);
    expect(nextWeekToday.data.weeklyRule).toBe('No meetings before 11:00 Mon-Thu');

    const nextWeekReview = await api<{ activeRuleText: string | null; ruleForNextWeek: string | null }>(
      'GET',
      '/api/review',
      { now: nextMondayNow },
    );
    expect(nextWeekReview.status).toBe(200);
    expect(nextWeekReview.data.activeRuleText).toBe('No meetings before 11:00 Mon-Thu');
    expect(nextWeekReview.data.ruleForNextWeek).toBeNull();
  });

  it('full target design lifecycle: personal/company goals, project weekly time, today room/fit-line/drop-reason/sense, and 4-chapter review auto-sync', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veyra-e2e-target-'));
    cleanups.push(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

    const dbPath = path.join(tmpDir, 'veyra.db');
    const cliConfigPath = path.join(tmpDir, 'cli-config.json');
    const hookCapturePath = path.join(tmpDir, 'review-hook-capture.json');

    const server: VeyraServerInstance = createVeyraServer({
      dbPath,
      port: 0,
      host: '127.0.0.1',
      enableTestClock: true,
      rolloverCheckIntervalMs: 600_000,
    });
    const started = await server.start();
    cleanups.push(() => server.stop());
    const baseUrl = started.url;

    const api = async <T = Record<string, unknown>>(
      method: string,
      route: string,
      opts?: { body?: unknown; now?: string; actor?: string },
    ): Promise<{ status: number; data: T }> => {
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'X-Veyra-Actor': opts?.actor ?? 'user',
      };
      if (opts?.body !== undefined) {
        headers['Content-Type'] = 'application/json';
      }
      if (opts?.now) {
        headers['X-Veyra-Now'] = opts.now;
      }
      const res = await fetch(`${baseUrl}${route}`, {
        method,
        headers,
        body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
      const text = await res.text();
      const data = text.trim() ? (JSON.parse(text) as T) : ({} as T);
      return { status: res.status, data };
    };

    const cliEnv = (nowIso: string) => ({
      VEYRA_SERVER_URL: baseUrl,
      VEYRA_TOKEN: undefined,
      VEYRA_CONFIG_PATH: cliConfigPath,
      VEYRA_ACTOR: 'cli',
      VEYRA_NOW: nowIso,
    });

    const week4Start = '2026-11-23'; // ISO Week 48
    const mondayMorning = '2026-11-23T08:00:00.000Z';

    // Initialize deterministic UTC timezone
    const initSettings = await api('PATCH', '/api/settings', {
      now: mondayMorning,
      body: { timezone: 'UTC', onboardingCompleted: true },
    });
    expect(initSettings.status).toBe(200);

    // -----------------------------------------------------------------------
    // 1. Slice 1 — Company & Personal Goals, custom hex, CLI goals & close
    // -----------------------------------------------------------------------
    const companyGoalCli = await execCli(
      [
        'goal',
        'create',
        'Generate upsells',
        '--kind',
        'company',
        '--color',
        '#12AB34',
        '--description',
        'Expand enterprise accounts with measurable ROI',
        '--done-when',
        '3 upsell contracts signed in Q4',
        '--check-in',
        '2026-11-27',
        '--measure',
        '1 / 3 closed',
        '--if-it-stalls',
        'Pair with CS leads on executive ROI briefs',
        '--json',
      ],
      cliEnv(mondayMorning),
    );
    expect(companyGoalCli.exitCode).toBe(0);
    const companyGoal = JSON.parse(companyGoalCli.stdout) as {
      id: string;
      name: string;
      kind: string;
      color: string;
      doneWhen: string;
      checkInDate: string;
      measure: string;
      ifItStalls: string;
    };
    expect(companyGoal.kind).toBe('company');
    expect(companyGoal.color).toBe('#12AB34');
    expect(companyGoal.doneWhen).toBe('3 upsell contracts signed in Q4');
    expect(companyGoal.checkInDate).toBe('2026-11-27');
    expect(companyGoal.measure).toBe('1 / 3 closed');
    expect(companyGoal.ifItStalls).toBe('Pair with CS leads on executive ROI briefs');

    const personalGoalRes = await api<{ goal: { id: string; name: string } }>('POST', '/api/goals', {
      now: mondayMorning,
      body: {
        name: 'Q4 Security Readiness',
        kind: 'personal',
        color: '#4DA3FF',
        doneWhen: 'All audit findings closed',
      },
    });
    expect(personalGoalRes.status).toBe(201);
    const personalGoal = personalGoalRes.data.goal;

    // Verify `veyra goals --json` lists both active goals
    const goalsListCli = await execCli(['goals', '--json'], cliEnv(mondayMorning));
    expect(goalsListCli.exitCode).toBe(0);
    const goalsPayload = JSON.parse(goalsListCli.stdout) as {
      goals: Array<{ id: string; name: string; kind: string; status: string }>;
    };
    expect(goalsPayload.goals.some((g) => g.id === companyGoal.id && g.kind === 'company')).toBe(
      true,
    );
    expect(goalsPayload.goals.some((g) => g.id === personalGoal.id && g.kind === 'personal')).toBe(
      true,
    );

    // Close the second goal via `veyra goal close --status achieved --note "..."`
    const closeGoalCli = await execCli(
      [
        'goal',
        'close',
        personalGoal.id,
        '--status',
        'achieved',
        '--note',
        'Zero open audit issues remaining',
        '--json',
      ],
      cliEnv(mondayMorning),
    );
    expect(closeGoalCli.exitCode).toBe(0);
    const closedGoal = JSON.parse(closeGoalCli.stdout) as {
      id: string;
      status: string;
      closingNote: string;
    };
    expect(closedGoal.status).toBe('achieved');
    expect(closedGoal.closingNote).toBe('Zero open audit issues remaining');

    // Confirm closed goal is hidden from GET /api/today active goals
    const todayAfterClose = await api<{ goals: Array<{ id: string; status: string }> }>(
      'GET',
      '/api/today',
      { now: mondayMorning },
    );
    expect(todayAfterClose.status).toBe(200);
    expect(todayAfterClose.data.goals.some((g) => g.id === companyGoal.id)).toBe(true);
    expect(todayAfterClose.data.goals.some((g) => g.id === personalGoal.id)).toBe(false);

    // -----------------------------------------------------------------------
    // 2. Slice 2 — Project weeklyTimeMinutes = 240, 4-week seeded history,
    //    8-week history & size drift on /api/projects/:id, /api/plan strip & roomMinutes
    // -----------------------------------------------------------------------
    const projectRes = await api<{
      project: { id: string; name: string; weeklyTimeMinutes: number | null };
    }>('POST', '/api/projects', {
      now: '2026-11-02T08:00:00.000Z',
      body: {
        name: 'LioCare',
        color: '#2E9E6F',
        icon: 'Briefcase',
        defaultGoalId: companyGoal.id,
        isPinned: true,
        weeklyTimeMinutes: 240,
      },
    });
    expect(projectRes.status).toBe(201);
    expect(projectRes.data.project.weeklyTimeMinutes).toBe(240);
    const lioCare = projectRes.data.project;

    // Seed focus sessions across 4 weeks (Mon Nov 2, Nov 9, Nov 16, Nov 23) with size 60m -> actual 90m to create measurable size drift
    const historicalWeeks = [
      { date: '2026-11-02', start: '2026-11-02T09:00:00.000Z', end: '2026-11-02T10:30:00.000Z' },
      { date: '2026-11-09', start: '2026-11-09T09:00:00.000Z', end: '2026-11-09T10:30:00.000Z' },
      { date: '2026-11-16', start: '2026-11-16T09:00:00.000Z', end: '2026-11-16T10:30:00.000Z' },
      { date: '2026-11-23', start: '2026-11-23T09:00:00.000Z', end: '2026-11-23T10:30:00.000Z' },
    ];
    for (const [idx, wk] of historicalWeeks.entries()) {
      const blkRes = await api<{ block: { id: string } }>('POST', '/api/blocks', {
        now: wk.start,
        body: {
          title: `LioCare enterprise sync week ${idx + 1}`,
          projectId: lioCare.id,
          goalId: companyGoal.id,
          bucket: 'scheduled',
          scheduledDate: wk.date,
          sizeMinutes: 60,
        },
      });
      expect(blkRes.status).toBe(201);
      await api('POST', '/api/sessions', {
        now: wk.end,
        body: {
          blockId: blkRes.data.block.id,
          startedAt: wk.start,
          endedAt: wk.end,
        },
      });
      await api('POST', '/api/focus/complete', {
        now: wk.end,
        body: {
          blockId: blkRes.data.block.id,
          energySignal: 'up',
          senseSignal: 'moved',
          outcomeNote: `Advanced upsell track ${idx + 1}`,
        },
      });
    }

    const projectDetailRes = await api<{
      project: {
        id: string;
        weeklyTimeMinutes: number | null;
        weeklyHistory8w: Array<{ weekStartDate: string; focusMinutes: number }>;
        sizeDriftPct: number | null;
      };
    }>('GET', `/api/projects/${lioCare.id}`, { now: '2026-11-24T08:00:00.000Z' });
    expect(projectDetailRes.status).toBe(200);
    expect(projectDetailRes.data.project.weeklyTimeMinutes).toBe(240);
    expect(projectDetailRes.data.project.weeklyHistory8w).toHaveLength(8);
    expect(
      projectDetailRes.data.project.weeklyHistory8w.filter((pt) => pt.focusMinutes === 90).length,
    ).toBe(4);
    expect(projectDetailRes.data.project.sizeDriftPct).toBe(50);

    // Verify GET /api/plan returns projectTimeStrip and day roomMinutes
    const planRes = await api<{
      weekStartDate: string;
      days: Array<{ date: string; roomMinutes: number; plannedMinutes: number }>;
      projectTimeStrip: Array<{
        projectId: string;
        weeklyTimeMinutes: number | null;
        loggedMinutes: number;
      }>;
    }>('GET', `/api/plan?weekStart=${week4Start}`, { now: '2026-11-24T08:00:00.000Z' });
    expect(planRes.status).toBe(200);
    expect(planRes.data.days.length).toBeGreaterThanOrEqual(5);
    expect(planRes.data.days.every((d) => typeof d.roomMinutes === 'number' && d.roomMinutes >= 0)).toBe(
      true,
    );
    const lioStrip = planRes.data.projectTimeStrip.find((p) => p.projectId === lioCare.id);
    expect(lioStrip).toBeDefined();
    expect(lioStrip?.weeklyTimeMinutes).toBe(240);
    expect(lioStrip?.loggedMinutes).toBe(90);

    // -----------------------------------------------------------------------
    // 3. Slice 3 — Today roomToday, suggestedOrder, fitLine, applySuggestedOrder,
    //    drop with dropReason: 'no_room', CLI `veyra done --sense moved --energy up`, dayLookBack
    // -----------------------------------------------------------------------
    const tuesdayMorning = '2026-11-24T08:00:00.000Z';
    const tuesdayDate = '2026-11-24';

    // Schedule blocks on Tuesday so one overflows roomToday (08:00 UTC = 09:00 local: min(240m baseline, 9h workday minus 1h meeting) -> 240m room; 180m Ops + 120m priority = 300m)
    await api('POST', '/api/events/upsert', {
      now: tuesdayMorning,
      body: {
        source: 'manual',
        events: [
          {
            externalId: 'tue-meeting-1',
            title: 'Enterprise customer check-in',
            startAt: '2026-11-24T13:00:00.000Z',
            endAt: '2026-11-24T14:00:00.000Z',
          },
        ],
      },
    });

    const opsOverflowRes = await api<{ block: { id: string } }>('POST', '/api/blocks', {
      now: tuesdayMorning,
      body: {
        title: 'Clean up old Jira tags',
        projectId: lioCare.id,
        isOps: true,
        bucket: 'scheduled',
        scheduledDate: tuesdayDate,
        sizeMinutes: 180,
      },
    });
    const opsBlockId = opsOverflowRes.data.block.id;

    const priorityBlockRes = await api<{ block: { id: string } }>('POST', '/api/blocks', {
      now: tuesdayMorning,
      body: {
        title: 'Send Acme upsell proposal',
        projectId: lioCare.id,
        goalId: companyGoal.id,
        bucket: 'scheduled',
        scheduledDate: tuesdayDate,
        dueDate: tuesdayDate,
        sizeMinutes: 120,
      },
    });
    const priorityBlockId = priorityBlockRes.data.block.id;

    // Verify GET /api/today and `veyra today --json` return roomToday, suggestedOrder, fitLine
    const todayApiRes = await api<{
      roomToday: { roomMinutes: number; meetingMinutes: number };
      suggestedOrder: Array<{ blockId: string; reason: string }>;
      fitLine: { fitLineIndex: number; overflowBlockCount: number };
    }>('GET', '/api/today', { now: tuesdayMorning });
    expect(todayApiRes.status).toBe(200);
    expect(todayApiRes.data.roomToday.meetingMinutes).toBe(60);
    expect(todayApiRes.data.roomToday.roomMinutes).toBeGreaterThan(0);
    expect(todayApiRes.data.suggestedOrder[0]?.blockId).toBe(priorityBlockId);
    expect(todayApiRes.data.fitLine.overflowBlockCount).toBeGreaterThanOrEqual(1);

    const todayCliRes = await execCli(['today', '--json'], cliEnv(tuesdayMorning));
    expect(todayCliRes.exitCode).toBe(0);
    const todayCliJson = JSON.parse(todayCliRes.stdout) as {
      roomToday: { roomMinutes: number };
      suggestedOrder: Array<{ blockId: string }>;
      fitLine: { fitLineIndex: number };
    };
    expect(todayCliJson.roomToday.roomMinutes).toBe(todayApiRes.data.roomToday.roomMinutes);
    expect(todayCliJson.suggestedOrder.map((s) => s.blockId)).toEqual(
      todayApiRes.data.suggestedOrder.map((s) => s.blockId),
    );
    expect(todayCliJson.fitLine.fitLineIndex).toBe(todayApiRes.data.fitLine.fitLineIndex);

    // Apply suggested order
    const applyOrderRes = await api<{ blocks: Array<{ id: string }> }>(
      'POST',
      '/api/today/apply-suggested-order',
      {
        now: tuesdayMorning,
        body: { blockIds: todayApiRes.data.suggestedOrder.map((s) => s.blockId) },
      },
    );
    expect(applyOrderRes.status).toBe(200);
    expect(applyOrderRes.data.blocks[0]?.id).toBe(priorityBlockId);

    // Drop overflow Ops block with dropReason: 'no_room'
    const dropRes = await api<{ block: { id: string; status: string; dropReason: string | null } }>(
      'POST',
      `/api/blocks/${opsBlockId}/drop`,
      {
        now: '2026-11-24T08:15:00.000Z',
        body: { dropReason: 'no_room' },
      },
    );
    expect(dropRes.status).toBe(200);
    expect(dropRes.data.block.status).toBe('dropped');
    expect(dropRes.data.block.dropReason).toBe('no_room');

    // Focus and complete priority block via CLI `veyra done --sense moved --energy up --outcome "..."`
    const startCli = await execCli(
      ['start', priorityBlockId, '--json'],
      cliEnv('2026-11-24T09:00:00.000Z'),
    );
    expect(startCli.exitCode).toBe(0);

    const doneCli = await execCli(
      [
        'done',
        '--sense',
        'moved',
        '--energy',
        'up',
        '--outcome',
        'Sent signed ROI proposal to Acme VP',
        '--json',
      ],
      cliEnv('2026-11-24T11:00:00.000Z'),
    );
    expect(doneCli.exitCode).toBe(0);
    const doneJson = JSON.parse(doneCli.stdout) as {
      block: { id: string; senseSignal: string; energySignal: string; outcomeNote: string };
    };
    expect(doneJson.block.senseSignal).toBe('moved');
    expect(doneJson.block.energySignal).toBe('up');
    expect(doneJson.block.outcomeNote).toBe('Sent signed ROI proposal to Acme VP');

    // Verify dayLookBack is populated once upNext is clear and completedToday > 0
    const todayEveningRes = await api<{
      dayLookBack: {
        date: string;
        focusedMinutes: number;
        completedCount: number;
        movedGoalCount: number;
        notFitBlocks: Array<{ id: string; destination: string }>;
      } | null;
    }>('GET', '/api/today', { now: '2026-11-24T17:30:00.000Z' });
    expect(todayEveningRes.status).toBe(200);
    expect(todayEveningRes.data.dayLookBack).not.toBeNull();
    expect(todayEveningRes.data.dayLookBack?.date).toBe(tuesdayDate);
    expect(todayEveningRes.data.dayLookBack?.focusedMinutes).toBe(120);
    expect(todayEveningRes.data.dayLookBack?.completedCount).toBe(1);
    expect(todayEveningRes.data.dayLookBack?.movedGoalCount).toBe(1);
    expect(
      todayEveningRes.data.dayLookBack?.notFitBlocks.some(
        (b) => b.id === opsBlockId && b.destination === 'Dropped (no room)',
      ),
    ).toBe(true);

    // -----------------------------------------------------------------------
    // 4. Slice 4 — startHookListener(onReviewComplete), review.completed webhook,
    //    update goal measure, POST /api/review/complete, `veyra review --week <N> --json`
    // -----------------------------------------------------------------------
    const captureScript = path.join(tmpDir, 'capture-review-hook.mjs');
    fs.writeFileSync(
      captureScript,
      `
import fs from 'node:fs';
fs.writeFileSync(
  ${JSON.stringify(hookCapturePath)},
  JSON.stringify({
    event: process.env.VEYRA_EVENT ?? null,
    weekNumber: process.env.VEYRA_WEEK_NUMBER ?? null,
    weekStart: process.env.VEYRA_WEEK_START ?? null,
    ruleForNextWeek: process.env.VEYRA_RULE_FOR_NEXT_WEEK ?? null,
  }),
  'utf8',
);
`,
      'utf8',
    );

    const hookListener = await startHookListener({
      port: 0,
      host: '127.0.0.1',
      handlers: {
        onReviewComplete: `"${process.execPath}" "${captureScript}"`,
      },
    });
    cleanups.push(() => hookListener.stop());

    const fridayNow = '2026-11-27T17:00:00.000Z';

    // Subscribe server webhook to review.completed pointing at hookListener.url
    const hookSettingsRes = await api('PATCH', '/api/settings', {
      now: fridayNow,
      body: {
        webhookUrl: hookListener.url,
        webhookEvents: ['review.completed'],
      },
    });
    expect(hookSettingsRes.status).toBe(200);

    // Update goal measure inline during review
    const measurePatchRes = await api<{ goal: { measure: string | null } }>(
      'PATCH',
      `/api/goals/${companyGoal.id}`,
      {
        now: fridayNow,
        body: {
          measure: '2 / 3 closed',
          measureWeekStartDate: week4Start,
        },
      },
    );
    expect(measurePatchRes.status).toBe(200);
    expect(measurePatchRes.data.goal.measure).toBe('2 / 3 closed');

    // Complete review via POST /api/review/complete
    const nextRuleText = 'Protect 09:00-11:00 Mon-Thu for LioCare upsell proposals';
    const completeReviewRes = await api<{
      review: { completedAt: string | null; ruleForNextWeek: string };
      snapshot: {
        weekNumber: number;
        weekStartDate: string;
        ruleForNextWeek: string;
        goalsMoved: Array<{ goalId: string; measure: string | null }>;
      };
    }>('POST', '/api/review/complete', {
      now: fridayNow,
      body: {
        weekStartDate: week4Start,
        ruleForNextWeek: nextRuleText,
        previousRuleKept: 'yes',
        projectWeeklyTimes: { [lioCare.id]: 300 },
      },
    });
    expect(completeReviewRes.status).toBe(200);
    expect(completeReviewRes.data.review.completedAt).toBeTruthy();
    expect(completeReviewRes.data.snapshot.weekNumber).toBe(48);
    expect(completeReviewRes.data.snapshot.ruleForNextWeek).toBe(nextRuleText);
    expect(
      completeReviewRes.data.snapshot.goalsMoved.find((g) => g.goalId === companyGoal.id)?.measure,
    ).toBe('2 / 3 closed');

    // Wait for hook handler to write captured env variables
    await waitFor(() => fs.existsSync(hookCapturePath), 5000);
    await hookListener.waitForIdle();

    const capturedHook = JSON.parse(fs.readFileSync(hookCapturePath, 'utf8')) as {
      event: string | null;
      weekNumber: string | null;
      weekStart: string | null;
      ruleForNextWeek: string | null;
    };
    expect(capturedHook).toEqual({
      event: 'review.completed',
      weekNumber: '48',
      weekStart: week4Start,
      ruleForNextWeek: nextRuleText,
    });

    // Verify `veyra review --week 48 --json` returns the persisted snapshot matching `GET /api/review`
    const reviewHttpRes = await api<{
      weekNumber: number;
      completedAt: string | null;
      ruleForNextWeek: string | null;
      snapshot: { weekNumber: number; ruleForNextWeek: string } | null;
    }>('GET', `/api/review?week=48`, { now: fridayNow });
    expect(reviewHttpRes.status).toBe(200);
    expect(reviewHttpRes.data.completedAt).toBeTruthy();
    expect(reviewHttpRes.data.snapshot).not.toBeNull();

    const reviewCliRes = await execCli(['review', '--week', '48', '--json'], cliEnv(fridayNow));
    expect(reviewCliRes.exitCode).toBe(0);
    const reviewCliJson = JSON.parse(reviewCliRes.stdout) as {
      weekNumber: number;
      completedAt: string | null;
      ruleForNextWeek: string | null;
      snapshot: { weekNumber: number; ruleForNextWeek: string } | null;
    };
    expect(reviewCliJson.weekNumber).toBe(48);
    expect(reviewCliJson.completedAt).toBe(reviewHttpRes.data.completedAt);
    expect(reviewCliJson.ruleForNextWeek).toBe(nextRuleText);
    expect(reviewCliJson.snapshot).toEqual(reviewHttpRes.data.snapshot);
  });
});
