import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SYSTEM_OTHER_PROJECT_ID } from '@veyra/core';
import { createVeyraServer, type VeyraServerInstance } from '../src/index.js';

const tempDirs: string[] = [];
const runningServers: VeyraServerInstance[] = [];
const auxServers: http.Server[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veyra-server-api-'));
  tempDirs.push(dir);
  return dir;
}

async function startTestVeyraServer(
  opts?: Partial<Parameters<typeof createVeyraServer>[0]>,
): Promise<{ instance: VeyraServerInstance; baseUrl: string; dir: string }> {
  const dir = createTempDir();
  const instance = createVeyraServer({
    dbPath: path.join(dir, 'veyra.db'),
    port: 0,
    host: '127.0.0.1',
    enableTestClock: true,
    rolloverCheckIntervalMs: 60_000,
    ...opts,
  });
  runningServers.push(instance);
  const started = await instance.start();
  return { instance, baseUrl: started.url, dir };
}

function startAuxHttpServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    auxServers.push(server);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        throw new Error('Unexpected server address');
      }
      resolve({ server, url: `http://127.0.0.1:${addr.port}` });
    });
  });
}

afterEach(async () => {
  while (runningServers.length > 0) {
    await runningServers.pop()!.stop();
  }
  while (auxServers.length > 0) {
    const srv = auxServers.pop()!;
    await new Promise<void>((resolve) => srv.close(() => resolve()));
  }
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe('@veyra/server REST API', () => {
  it('GET /api/health returns 200 { ok: true, version, dbReady: true }', async () => {
    const { baseUrl } = await startTestVeyraServer();
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; version: string; dbReady: boolean };
    expect(body.ok).toBe(true);
    expect(body.dbReady).toBe(true);
    expect(typeof body.version).toBe('string');
  });

  it('enforces Bearer token auth on /api/* except /api/health and accepts ?token= for SSE', async () => {
    const token = 'secret-veyra-token-123';
    const { baseUrl } = await startTestVeyraServer({ bearerToken: token });

    // Health stays unauthenticated
    const healthRes = await fetch(`${baseUrl}/api/health`);
    expect(healthRes.status).toBe(200);

    // Unauthenticated /api/today rejected with 401
    const unauthRes = await fetch(`${baseUrl}/api/today`);
    expect(unauthRes.status).toBe(401);
    const errBody = (await unauthRes.json()) as { error: { code: string; message: string } };
    expect(errBody.error.code).toBe('UNAUTHORIZED');

    // Wrong token rejected
    const wrongRes = await fetch(`${baseUrl}/api/today`, {
      headers: { Authorization: 'Bearer wrong-token' },
    });
    expect(wrongRes.status).toBe(401);

    // Valid bearer token accepted
    const okRes = await fetch(`${baseUrl}/api/today`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(okRes.status).toBe(200);

    // SSE rejects without token, accepts ?token=
    const sseUnauth = await fetch(`${baseUrl}/api/events/stream`);
    expect(sseUnauth.status).toBe(401);

    const controller = new AbortController();
    const sseOk = await fetch(`${baseUrl}/api/events/stream?token=${token}`, {
      signal: controller.signal,
    });
    expect(sseOk.status).toBe(200);
    expect(sseOk.headers.get('content-type')).toContain('text/event-stream');
    controller.abort();
  });

  it('runs full block + focus lifecycle over HTTP, emits SSE mutation events, and respects X-Veyra-Actor', async () => {
    const webhookHits: Array<Record<string, unknown>> = [];
    const { url: hookUrl } = await startAuxHttpServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        webhookHits.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{}');
      });
    });

    const { baseUrl } = await startTestVeyraServer({
      webhookOptions: { retryDelayMs: 5 },
    });

    // Configure webhook
    const patchSettingsRes = await fetch(`${baseUrl}/api/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timezone: 'UTC',
        webhookUrl: `${hookUrl}/events`,
        webhookEvents: ['focus.started', 'focus.ended', 'block.completed'],
      }),
    });
    expect(patchSettingsRes.status).toBe(200);

    // Open SSE stream
    const sseAbort = new AbortController();
    const sseRes = await fetch(`${baseUrl}/api/events/stream`, { signal: sseAbort.signal });
    expect(sseRes.status).toBe(200);
    const reader = sseRes.body!.getReader();
    const decoder = new TextDecoder();
    const sseEvents: Array<{ type: string; entity?: string; id?: string }> = [];

    const readLoop = (async () => {
      let buffer = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split('\n\n');
          buffer = frames.pop() ?? '';
          for (const frame of frames) {
            for (const line of frame.split('\n')) {
              if (line.startsWith('data: ')) {
                sseEvents.push(JSON.parse(line.slice(6)) as { type: string; entity?: string; id?: string });
              }
            }
          }
        }
      } catch {
        // Aborted on cleanup
      }
    })();

    // 1. Create block
    const createRes = await fetch(`${baseUrl}/api/blocks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Veyra-Actor': 'cli',
        'X-Veyra-Now': '2026-11-23T09:00:00.000Z',
      },
      body: JSON.stringify({
        title: 'Build Hono REST API',
        bucket: 'scheduled',
        scheduledDate: '2026-11-23',
      }),
    });
    expect(createRes.status).toBe(201);
    const { block } = (await createRes.json()) as { block: { id: string; title: string } };
    expect(block.title).toBe('Build Hono REST API');

    // 2. Start focus
    const startRes = await fetch(`${baseUrl}/api/focus/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Veyra-Now': '2026-11-23T09:05:00.000Z',
      },
      body: JSON.stringify({ blockId: block.id }),
    });
    expect(startRes.status).toBe(200);
    const startData = (await startRes.json()) as {
      startedSession: { id: string; blockId: string };
      focusStatus: { activeBlock: { id: string } | null };
    };
    expect(startData.startedSession.blockId).toBe(block.id);
    expect(startData.focusStatus.activeBlock?.id).toBe(block.id);

    // 3. Pause focus with note
    const pauseRes = await fetch(`${baseUrl}/api/focus/pause`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Veyra-Now': '2026-11-23T09:35:00.000Z',
      },
      body: JSON.stringify({ note: 'Paused after routes' }),
    });
    expect(pauseRes.status).toBe(200);
    const pauseData = (await pauseRes.json()) as {
      closedSession: { endedAt: string | null; note: string | null };
      block: { resumeNote: string | null };
    };
    expect(pauseData.closedSession.endedAt).toBe('2026-11-23T09:35:00.000Z');
    expect(pauseData.block.resumeNote).toBe('Paused after routes');

    // 4. Resume focus and complete WITHOUT blockId (defaults to active open session's block)
    const resumeRes = await fetch(`${baseUrl}/api/focus/resume`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Veyra-Now': '2026-11-23T09:45:00.000Z',
      },
      body: JSON.stringify({ blockId: block.id }),
    });
    expect(resumeRes.status).toBe(200);

    const completeRes = await fetch(`${baseUrl}/api/focus/complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Veyra-Now': '2026-11-23T10:15:00.000Z',
      },
      body: JSON.stringify({
        energySignal: 'up',
        outcomeNote: 'All endpoints verified',
      }),
    });
    expect(completeRes.status).toBe(200);
    const completeData = (await completeRes.json()) as {
      block: { id: string; status: string; energySignal: string; outcomeNote: string };
      currentSessionMinutes: number;
      totalBlockMinutes: number;
    };
    expect(completeData.block.id).toBe(block.id);
    expect(completeData.block.status).toBe('done');
    expect(completeData.block.energySignal).toBe('up');
    expect(completeData.currentSessionMinutes).toBe(30);
    expect(completeData.totalBlockMinutes).toBe(60);

    // Wait briefly for SSE frames and async webhooks to arrive
    await new Promise((resolve) => setTimeout(resolve, 100));
    sseAbort.abort();
    await readLoop;

    const eventTypes = sseEvents.map((e) => e.type);
    expect(eventTypes).toContain('block.created');
    expect(eventTypes).toContain('focus.started');
    expect(eventTypes).toContain('focus.paused');
    expect(eventTypes).toContain('block.completed');

    const hookEventNames = webhookHits.map((h) => h.event);
    expect(hookEventNames).toContain('focus.started');
    expect(hookEventNames).toContain('focus.ended');
    expect(hookEventNames).toContain('block.completed');

    // Verify activity log captured CLI actor
    const activityRes = await fetch(`${baseUrl}/api/activity?actor=cli`);
    expect(activityRes.status).toBe(200);
    const { activity } = (await activityRes.json()) as {
      activity: Array<{ actor: string; action: string }>;
    };
    expect(activity.some((a) => a.action === 'block.created' && a.actor === 'cli')).toBe(true);
  });

  it('triggers midnight rollover consistently via X-Veyra-Now on both GET /api/today and GET /api/plan', async () => {
    const { baseUrl } = await startTestVeyraServer();

    await fetch(`${baseUrl}/api/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timezone: 'UTC' }),
    });

    // Create a block scheduled for Monday 2026-11-23
    const createRes = await fetch(`${baseUrl}/api/blocks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Veyra-Now': '2026-11-23T10:00:00.000Z',
      },
      body: JSON.stringify({
        title: 'Unfinished Monday Block',
        bucket: 'scheduled',
        scheduledDate: '2026-11-23',
      }),
    });
    expect(createRes.status).toBe(201);
    const { block } = (await createRes.json()) as { block: { id: string } };

    // Jump clock to Tuesday 2026-11-24 and query GET /api/plan first
    const planRes = await fetch(`${baseUrl}/api/plan?weekStart=2026-11-23`, {
      headers: { 'X-Veyra-Now': '2026-11-24T08:00:00.000Z' },
    });
    expect(planRes.status).toBe(200);
    const planData = (await planRes.json()) as {
      today: string;
      days: Array<{ date: string; blocks: Array<{ id: string; carryoverCount: number }> }>;
    };
    expect(planData.today).toBe('2026-11-24');
    const monDay = planData.days.find((d) => d.date === '2026-11-23')!;
    const tueDay = planData.days.find((d) => d.date === '2026-11-24')!;
    expect(monDay.blocks).toHaveLength(0);
    expect(tueDay.blocks).toHaveLength(1);
    expect(tueDay.blocks[0].id).toBe(block.id);
    expect(tueDay.blocks[0].carryoverCount).toBe(1);

    // Query GET /api/today at the same Tuesday timestamp: idempotent, carryoverCount remains 1
    const todayRes = await fetch(`${baseUrl}/api/today`, {
      headers: { 'X-Veyra-Now': '2026-11-24T08:05:00.000Z' },
    });
    expect(todayRes.status).toBe(200);
    const todayData = (await todayRes.json()) as {
      date: string;
      upNext: Array<{ id: string; carryoverCount: number }>;
    };
    expect(todayData.date).toBe('2026-11-24');
    expect(todayData.upNext).toHaveLength(1);
    expect(todayData.upNext[0].id).toBe(block.id);
    expect(todayData.upNext[0].carryoverCount).toBe(1);
  });

  it('rejects DELETE /api/projects/<Other> with 400 SYSTEM_PROJECT_PROTECTED', async () => {
    const { baseUrl } = await startTestVeyraServer();
    const res = await fetch(`${baseUrl}/api/projects/${SYSTEM_OTHER_PROJECT_ID}`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('SYSTEM_PROJECT_PROTECTED');
  });

  it('supports goals, projects, calendar, notes, review rules, events, and static SPA serving', async () => {
    const webDir = createTempDir();
    fs.writeFileSync(path.join(webDir, 'index.html'), '<!doctype html><html><body>Veyra UI</body></html>');
    fs.mkdirSync(path.join(webDir, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(webDir, 'assets', 'app.js'), 'console.log("veyra");');

    const { baseUrl } = await startTestVeyraServer({ webDistDir: webDir });
    const nowHeader = { 'X-Veyra-Now': '2026-11-23T12:00:00.000Z' };

    // Static asset + SPA fallback
    const jsRes = await fetch(`${baseUrl}/assets/app.js`);
    expect(jsRes.status).toBe(200);
    expect(await jsRes.text()).toContain('veyra');

    const spaRes = await fetch(`${baseUrl}/plan`);
    expect(spaRes.status).toBe(200);
    expect(await spaRes.text()).toContain('Veyra UI');

    // Goal + Project CRUD
    const goalRes = await fetch(`${baseUrl}/api/goals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...nowHeader },
      body: JSON.stringify({ name: 'Ship Veyra v1' }),
    });
    expect(goalRes.status).toBe(201);
    const { goal } = (await goalRes.json()) as { goal: { id: string } };

    const projRes = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...nowHeader },
      body: JSON.stringify({ name: 'Server Package', defaultGoalId: goal.id }),
    });
    expect(projRes.status).toBe(201);
    const { project } = (await projRes.json()) as { project: { id: string } };

    const projDetailRes = await fetch(`${baseUrl}/api/projects/${project.id}`, {
      headers: nowHeader,
    });
    expect(projDetailRes.status).toBe(200);
    const projDetail = (await projDetailRes.json()) as {
      project: { id: string; name: string };
      openBlocks: unknown[];
      completedBlocks: unknown[];
    };
    expect(projDetail.project.name).toBe('Server Package');

    // Daily Note + Weekly Rule + Review
    const noteRes = await fetch(`${baseUrl}/api/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...nowHeader },
      body: JSON.stringify({ content: 'Kept morning deep work protected' }),
    });
    expect(noteRes.status).toBe(201);

    const ruleRes = await fetch(`${baseUrl}/api/review/rule`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...nowHeader },
      body: JSON.stringify({ ruleForNextWeek: 'No meetings before 10:00' }),
    });
    expect(ruleRes.status).toBe(200);

    const reviewRes = await fetch(`${baseUrl}/api/review?weekStart=2026-11-23`, {
      headers: nowHeader,
    });
    expect(reviewRes.status).toBe(200);
    const reviewData = (await reviewRes.json()) as {
      ruleForNextWeek: string;
      dailyNotes: Array<{ content: string }>;
    };
    expect(reviewData.ruleForNextWeek).toBe('No meetings before 10:00');
    expect(reviewData.dailyNotes).toHaveLength(1);

    // Events upsert + Calendar read
    const upsertRes = await fetch(`${baseUrl}/api/events/upsert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...nowHeader },
      body: JSON.stringify({
        source: 'manual',
        events: [
          {
            externalId: 'manual-1',
            title: 'Design Critique',
            startAt: '2026-11-23T14:00:00.000Z',
            endAt: '2026-11-23T15:00:00.000Z',
          },
        ],
      }),
    });
    expect(upsertRes.status).toBe(200);

    const calRes = await fetch(`${baseUrl}/api/calendar?start=2026-11-23&end=2026-11-29`, {
      headers: nowHeader,
    });
    expect(calRes.status).toBe(200);
    const calData = (await calRes.json()) as {
      events: Array<{ title: string }>;
      sessions: unknown[];
      plannedBlocks: unknown[];
    };
    expect(calData.events).toHaveLength(1);
    expect(calData.events[0].title).toBe('Design Critique');
  });

  it('covers block transitions, session editing, event metadata updates, sync resilience, and test-hook', async () => {
    const { baseUrl } = await startTestVeyraServer();
    const nowHeader = { 'X-Veyra-Now': '2026-11-23T12:00:00.000Z' };

    // Create two blocks to test move, reorder, park, drop, reopen, detail
    const b1Res = await fetch(`${baseUrl}/api/blocks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...nowHeader },
      body: JSON.stringify({ title: 'Block A', bucket: 'scheduled', scheduledDate: '2026-11-23' }),
    });
    const { block: b1 } = (await b1Res.json()) as { block: { id: string; orderKey: string } };

    const b2Res = await fetch(`${baseUrl}/api/blocks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...nowHeader },
      body: JSON.stringify({ title: 'Block B', bucket: 'scheduled', scheduledDate: '2026-11-23' }),
    });
    const { block: b2 } = (await b2Res.json()) as { block: { id: string; orderKey: string } };

    // Reorder b2 before b1
    const reorderRes = await fetch(`${baseUrl}/api/blocks/${b2.id}/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...nowHeader },
      body: JSON.stringify({ afterId: b1.id }),
    });
    expect(reorderRes.status).toBe(200);
    const { block: reorderedB2 } = (await reorderRes.json()) as { block: { orderKey: string } };
    expect(reorderedB2.orderKey < b1.orderKey).toBe(true);

    // Move b1 to planned time slot, then park, then drop, then reopen
    const moveRes = await fetch(`${baseUrl}/api/blocks/${b1.id}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...nowHeader },
      body: JSON.stringify({
        bucket: 'scheduled',
        scheduledDate: '2026-11-23',
        plannedStartAt: '2026-11-23T13:00:00.000Z',
        plannedEndAt: '2026-11-23T14:00:00.000Z',
      }),
    });
    expect(moveRes.status).toBe(200);

    const parkRes = await fetch(`${baseUrl}/api/blocks/${b1.id}/park`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...nowHeader },
      body: JSON.stringify({ revisitAt: 'next-week' }),
    });
    expect(parkRes.status).toBe(200);
    const { block: parked } = (await parkRes.json()) as {
      block: { bucket: string; revisitAt: string };
    };
    expect(parked.bucket).toBe('later');
    expect(parked.revisitAt).toBe('2026-11-30');

    const dropRes = await fetch(`${baseUrl}/api/blocks/${b1.id}/drop`, {
      method: 'POST',
      headers: nowHeader,
    });
    expect(dropRes.status).toBe(200);
    expect(((await dropRes.json()) as { block: { status: string } }).block.status).toBe('dropped');

    const reopenRes = await fetch(`${baseUrl}/api/blocks/${b1.id}/reopen`, {
      method: 'POST',
      headers: nowHeader,
    });
    expect(reopenRes.status).toBe(200);
    expect(((await reopenRes.json()) as { block: { status: string } }).block.status).toBe('todo');

    // Manual session log -> trim -> split -> delete + block detail
    const logRes = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...nowHeader },
      body: JSON.stringify({
        blockId: b2.id,
        startedAt: '2026-11-23T08:00:00.000Z',
        endedAt: '2026-11-23T10:00:00.000Z',
        note: 'Deep work',
      }),
    });
    expect(logRes.status).toBe(201);
    const { session } = (await logRes.json()) as { session: { id: string } };

    const trimRes = await fetch(`${baseUrl}/api/sessions/${session.id}/trim`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...nowHeader },
      body: JSON.stringify({
        startedAt: '2026-11-23T08:15:00.000Z',
        endedAt: '2026-11-23T09:45:00.000Z',
      }),
    });
    expect(trimRes.status).toBe(200);

    const splitRes = await fetch(`${baseUrl}/api/sessions/${session.id}/split`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...nowHeader },
      body: JSON.stringify({
        breakStartAt: '2026-11-23T08:45:00.000Z',
        breakMinutes: 15,
      }),
    });
    expect(splitRes.status).toBe(200);
    const splitData = (await splitRes.json()) as {
      firstSession: { id: string };
      secondSession: { id: string };
    };

    const detailRes = await fetch(`${baseUrl}/api/blocks/${b2.id}`, { headers: nowHeader });
    expect(detailRes.status).toBe(200);
    const { block: detail } = (await detailRes.json()) as {
      block: { sessions: unknown[]; totalFocusMinutes: number };
    };
    expect(detail.sessions).toHaveLength(2);
    expect(detail.totalFocusMinutes).toBe(75);

    const delSessionRes = await fetch(`${baseUrl}/api/sessions/${splitData.secondSession.id}`, {
      method: 'DELETE',
      headers: nowHeader,
    });
    expect(delSessionRes.status).toBe(200);

    // Focus start + stop
    await fetch(`${baseUrl}/api/focus/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Veyra-Now': '2026-11-23T12:00:00.000Z' },
      body: JSON.stringify({ blockId: b2.id }),
    });
    const stopRes = await fetch(`${baseUrl}/api/focus/stop`, {
      method: 'POST',
      headers: { 'X-Veyra-Now': '2026-11-23T12:20:00.000Z' },
    });
    expect(stopRes.status).toBe(200);

    // Focus start + cancel (session is discarded)
    await fetch(`${baseUrl}/api/focus/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Veyra-Now': '2026-11-23T12:30:00.000Z' },
      body: JSON.stringify({ blockId: b2.id }),
    });
    const cancelRes = await fetch(`${baseUrl}/api/focus/cancel`, {
      method: 'POST',
      headers: { 'X-Veyra-Now': '2026-11-23T12:40:00.000Z' },
    });
    expect(cancelRes.status).toBe(200);
    const cancelBody = (await cancelRes.json()) as {
      closedSession: { deletedAt: string | null };
      focusStatus: { activeSession: unknown };
    };
    expect(cancelBody.closedSession.deletedAt).not.toBeNull();
    expect(cancelBody.focusStatus.activeSession).toBeNull();

    // Sync error resilience: misconfigured ICS returns 200 with diagnostic status, never 500
    await fetch(`${baseUrl}/api/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ calendarSyncMode: 'ics', icsFeedUrl: null }),
    });
    const syncRes = await fetch(`${baseUrl}/api/events/sync`, { method: 'POST' });
    expect(syncRes.status).toBe(200);
    const syncBody = (await syncRes.json()) as {
      status: { state: string; lastError: string | null };
      error?: string;
    };
    expect(syncBody.status.state).toBe('error');
    expect(syncBody.error).toMatch(/icsFeedUrl/i);

    // Test hook without webhookUrl returns 400 validation error
    const hookRes = await fetch(`${baseUrl}/api/settings/test-hook`, { method: 'POST' });
    expect(hookRes.status).toBe(400);
  });

  it('auto-matches synced meetings to projects on project keyword updates and POST /api/events/auto-match', async () => {
    const { baseUrl } = await startTestVeyraServer();
    const json = { 'Content-Type': 'application/json' };

    const upsert = await fetch(`${baseUrl}/api/events/upsert`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({
        source: 'manual',
        events: [
          {
            externalId: 'cov-1',
            title: 'Core-Northstar issue review',
            startAt: '2026-11-24T10:00:00.000Z',
            endAt: '2026-11-24T10:30:00.000Z',
          },
        ],
      }),
    });
    expect(upsert.status).toBe(200);

    const created = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ name: 'Customer X', matchKeywords: [] }),
    });
    const { project } = (await created.json()) as { project: { id: string } };

    const noop = await fetch(`${baseUrl}/api/events/auto-match`, { method: 'POST' });
    expect(await noop.json()).toEqual({ matchedCount: 0 });

    const patched = await fetch(`${baseUrl}/api/projects/${project.id}`, {
      method: 'PATCH',
      headers: json,
      body: JSON.stringify({ matchKeywords: ['Northstar'] }),
    });
    const patchedBody = (await patched.json()) as { project: { matchKeywords: string[] } };
    expect(patchedBody.project.matchKeywords).toEqual(['Northstar']);

    const events = (await (
      await fetch(`${baseUrl}/api/events?start=2026-11-24&end=2026-11-25`)
    ).json()) as { events: Array<{ externalId: string; projectId: string | null }> };
    expect(events.events.find((e) => e.externalId === 'cov-1')?.projectId).toBe(project.id);
  });

  it('blocks path traversal and null-byte requests in static file serving', async () => {
    const parentDir = createTempDir();
    fs.writeFileSync(
      path.join(parentDir, 'package.json'),
      JSON.stringify({ name: 'secret-parent-package' }),
    );
    const webDir = path.join(parentDir, 'dist');
    fs.mkdirSync(path.join(webDir, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(webDir, 'index.html'), '<!doctype html><html><body>Veyra UI</body></html>');
    fs.writeFileSync(path.join(webDir, 'assets', 'app.js'), 'console.log("safe");');

    const { baseUrl } = await startTestVeyraServer({ webDistDir: webDir });

    const traversalRes = await fetch(`${baseUrl}/%2e%2e/package.json`);
    const traversalBody = await traversalRes.text();
    expect(traversalBody).not.toContain('secret-parent-package');
    expect(traversalRes.status).toBe(200);
    expect(traversalBody).toContain('Veyra UI');

    const nullByteRes = await fetch(`${baseUrl}/assets/app.js%00.txt`);
    const nullByteBody = await nullByteRes.text();
    expect(nullByteRes.status).not.toBe(500);
    expect(nullByteBody).not.toContain('console.log("safe")');
  });
});
