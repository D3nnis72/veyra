import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createVeyraServer, type VeyraServerInstance } from '@veyra/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  computeWebhookSignature,
  extractHookEnv,
  formatHookLogHuman,
  resolveCommandForEvent,
  runCli,
  startHookListener,
  verifyWebhookSignature,
  type HookListenerHandle,
  type HookLogRecord,
} from '../src/index.js';

async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`Condition not met within ${timeoutMs}ms`);
}

describe('hook-listener unit helpers', () => {
  it('computes and verifies HMAC-SHA256 webhook signatures in constant time', () => {
    const body = JSON.stringify({ event: 'block.completed', timestamp: '2026-11-23T10:00:00Z', data: {} });
    const sig = computeWebhookSignature('top-secret', body);
    expect(sig.startsWith('sha256=')).toBe(true);
    expect(verifyWebhookSignature('top-secret', body, sig)).toBe(true);
    expect(verifyWebhookSignature('wrong-secret', body, sig)).toBe(false);
    expect(verifyWebhookSignature('top-secret', `${body} `, sig)).toBe(false);
    expect(verifyWebhookSignature('top-secret', body, undefined)).toBe(false);
    expect(verifyWebhookSignature('top-secret', body, 'md5=abc')).toBe(false);
  });

  it('extracts structured VEYRA_* environment variables from lifecycle payloads', () => {
    const payload = {
      event: 'block.completed',
      timestamp: '2026-11-23T10:30:00.000Z',
      data: {
        block: {
          id: '44444444-4444-4444-8444-444444444444',
          title: 'Triage CI flakes',
          isOps: true,
          projectId: '33333333-3333-4333-8333-333333333333',
          goalId: null,
        },
        closedSession: {
          id: '77777777-7777-4777-8777-777777777777',
          startedAt: '2026-11-23T09:30:00.000Z',
          endedAt: '2026-11-23T10:30:00.000Z',
        },
        totalBlockMinutes: 60,
      },
    };
    const raw = JSON.stringify(payload);
    const env = extractHookEnv(payload, raw, { PATH: process.env.PATH });

    expect(env.VEYRA_ACTOR).toBe('hook');
    expect(env.VEYRA_EVENT).toBe('block.completed');
    expect(env.VEYRA_EVENT_TIMESTAMP).toBe('2026-11-23T10:30:00.000Z');
    expect(env.VEYRA_PAYLOAD).toBe(raw);
    expect(env.VEYRA_BLOCK_ID).toBe('44444444-4444-4444-8444-444444444444');
    expect(env.VEYRA_BLOCK_TITLE).toBe('Triage CI flakes');
    expect(env.VEYRA_BLOCK_IS_OPS).toBe('true');
    expect(env.VEYRA_PROJECT_ID).toBe('33333333-3333-4333-8333-333333333333');
    expect(env.VEYRA_GOAL_ID).toBeUndefined();
    expect(env.VEYRA_SESSION_ID).toBe('77777777-7777-4777-8777-777777777777');
    expect(env.VEYRA_SESSION_START).toBe('2026-11-23T09:30:00.000Z');
    expect(env.VEYRA_SESSION_END).toBe('2026-11-23T10:30:00.000Z');
    expect(env.VEYRA_TOTAL_BLOCK_MINUTES).toBe('60');
  });

  it('routes event names to specific handlers with optional fallback and never executes on webhook.test', () => {
    const handlers = {
      onFocusStart: 'echo start',
      onComplete: 'echo complete',
      onAny: 'echo any',
    };
    expect(resolveCommandForEvent('focus.started', handlers)).toBe('echo start');
    expect(resolveCommandForEvent('focus.ended', handlers)).toBe('echo any');
    expect(resolveCommandForEvent('block.completed', handlers)).toBe('echo complete');
    expect(resolveCommandForEvent('webhook.test', handlers)).toBeUndefined();
  });

  it('hook-listener routes review.completed to onReviewComplete and exports VEYRA_WEEK_START, VEYRA_WEEK_NUMBER, and VEYRA_RULE_FOR_NEXT_WEEK', () => {
    const handlers = {
      onReviewComplete: 'echo review-done',
      onAny: 'echo fallback',
    };
    expect(resolveCommandForEvent('review.completed', handlers)).toBe('echo review-done');
    expect(resolveCommandForEvent('review.completed', { onAny: 'echo fallback' })).toBe(
      'echo fallback',
    );

    const payload = {
      event: 'review.completed',
      timestamp: '2026-11-20T16:00:00.000Z',
      data: {
        weekStartDate: '2026-11-16',
        weekNumber: 47,
        ruleForNextWeek: 'Protect Tuesday mornings',
      },
    };
    const raw = JSON.stringify(payload);
    const env = extractHookEnv(payload, raw, { PATH: process.env.PATH });

    expect(env.VEYRA_EVENT).toBe('review.completed');
    expect(env.VEYRA_WEEK_START).toBe('2026-11-16');
    expect(env.VEYRA_WEEK_NUMBER).toBe('47');
    expect(env.VEYRA_RULE_FOR_NEXT_WEEK).toBe('Protect Tuesday mornings');
  });

  it('formats human log lines cleanly for listening, event, handler_result, and rejected records', () => {
    expect(
      formatHookLogHuman({
        type: 'listening',
        host: '127.0.0.1',
        port: 4174,
        url: 'http://127.0.0.1:4174/webhook',
        handlers: {
          'focus.started': null,
          'focus.ended': null,
          'block.completed': './summarize.sh',
          'review.completed': null,
          any: null,
        },
        secretConfigured: true,
      }),
    ).toContain('http://127.0.0.1:4174/webhook · HMAC verification enabled');

    expect(
      formatHookLogHuman({
        type: 'handler_result',
        event: 'block.completed',
        timestamp: '2026-11-23T10:00:00Z',
        blockId: '44444444-4444-4444-8444-444444444444',
        command: './summarize.sh',
        ok: true,
        exitCode: 0,
        signal: null,
        timedOut: false,
        durationMs: 18,
        stdout: 'Summary updated',
        stderr: '',
      }),
    ).toContain('✓ block.completed (exit 0, 18ms) — Summary updated');
  });
});

describe('veyra hook listen end-to-end post-block auto-summary loop', () => {
  let server: VeyraServerInstance;
  let serverUrl: string;
  let tmpDir: string;
  let activeListeners: HookListenerHandle[] = [];

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veyra-hook-loop-'));
    activeListeners = [];
    server = createVeyraServer({
      dbPath: ':memory:',
      port: 0,
      host: '127.0.0.1',
      enableTestClock: true,
      rolloverCheckIntervalMs: 600_000,
      webhookOptions: {
        secret: 'loop-secret-key',
        timeoutMs: 5_000,
        retryDelayMs: 10,
      },
    });
    const started = await server.start();
    serverUrl = started.url;
  });

  afterEach(async () => {
    while (activeListeners.length > 0) {
      await activeListeners.pop()!.stop();
    }
    await server.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('receives signed focus.started, focus.ended, and block.completed hooks, runs handlers with stdin/env, and writes autoSummary back to Veyra', async () => {
    const startLogFile = path.join(tmpDir, 'focus-start.json');
    const endLogFile = path.join(tmpDir, 'focus-end.json');
    const handlerScript = path.join(tmpDir, 'hook-handler.mjs');

    // Script that reads JSON payload from stdin, verifies VEYRA_* env vars,
    // and on block.completed writes autoSummary back to the Veyra server API.
    fs.writeFileSync(
      handlerScript,
      `
import fs from 'node:fs';

const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const raw = Buffer.concat(chunks).toString('utf8').trim();
const payload = JSON.parse(raw);

const mode = process.argv[2];
if (mode === 'start') {
  fs.writeFileSync(${JSON.stringify(startLogFile)}, JSON.stringify({
    event: process.env.VEYRA_EVENT,
    blockId: process.env.VEYRA_BLOCK_ID,
    title: process.env.VEYRA_BLOCK_TITLE,
    stdinEvent: payload.event,
  }));
  console.log('focus-start recorded');
} else if (mode === 'end') {
  fs.writeFileSync(${JSON.stringify(endLogFile)}, JSON.stringify({
    event: process.env.VEYRA_EVENT,
    reason: process.env.VEYRA_FOCUS_END_REASON,
    sessionStart: process.env.VEYRA_SESSION_START,
    sessionEnd: process.env.VEYRA_SESSION_END,
  }));
  console.log('focus-end recorded');
} else if (mode === 'complete') {
  const blockId = process.env.VEYRA_BLOCK_ID;
  const isOps = process.env.VEYRA_BLOCK_IS_OPS === 'true';
  const summary = isOps
    ? 'Ops pattern: webhook retry timeouts on flaky staging worker (auto-summarized)'
    : 'Completed block summary';
  const res = await fetch(\`\${process.env.VEYRA_SERVER_URL}/api/blocks/\${blockId}\`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'X-Veyra-Actor': process.env.VEYRA_ACTOR || 'hook',
    },
    body: JSON.stringify({ autoSummary: summary }),
  });
  if (!res.ok) {
    console.error('Failed to set summary: HTTP ' + res.status);
    process.exit(1);
  }
  console.log('autoSummary written for ' + blockId);
}
`,
      'utf8',
    );

    const logs: HookLogRecord[] = [];
    const listener = await startHookListener({
      port: 0,
      host: '127.0.0.1',
      secret: 'loop-secret-key',
      env: { ...process.env, VEYRA_SERVER_URL: serverUrl },
      handlers: {
        onFocusStart: `"${process.execPath}" "${handlerScript}" start`,
        onFocusEnd: `"${process.execPath}" "${handlerScript}" end`,
        onComplete: `"${process.execPath}" "${handlerScript}" complete`,
      },
      onLog: (rec) => logs.push(rec),
    });
    activeListeners.push(listener);

    // Reject unsigned / bad signature requests with 401
    const unauthRes = await fetch(listener.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'focus.started', timestamp: '2026-11-23T09:00:00Z', data: {} }),
    });
    expect(unauthRes.status).toBe(401);

    // Configure Veyra server webhookUrl pointing to our listener
    const patchSettings = await fetch(`${serverUrl}/api/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        webhookUrl: listener.url,
        webhookEvents: ['focus.started', 'focus.ended', 'block.completed'],
      }),
    });
    expect(patchSettings.status).toBe(200);

    // Test Hook ping should succeed without triggering handlers
    const testHookRes = await fetch(`${serverUrl}/api/settings/test-hook`, { method: 'POST' });
    expect(testHookRes.status).toBe(200);
    const testHookJson = (await testHookRes.json()) as {
      result: { delivered: boolean; statusCode: number };
    };
    expect(testHookJson.result.delivered).toBe(true);
    expect(testHookJson.result.statusCode).toBe(200);

    // Create an Ops block, start focus, pause, resume, complete
    const createRes = await fetch(`${serverUrl}/api/blocks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Veyra-Now': '2026-11-23T09:00:00.000Z' },
      body: JSON.stringify({
        title: 'Investigate staging webhook timeouts',
        isOps: true,
        bucket: 'scheduled',
        scheduledDate: '2026-11-23',
      }),
    });
    const { block } = (await createRes.json()) as { block: { id: string } };

    await fetch(`${serverUrl}/api/focus/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Veyra-Now': '2026-11-23T09:00:00.000Z' },
      body: JSON.stringify({ blockId: block.id }),
    });

    await waitUntil(() => fs.existsSync(startLogFile));
    await listener.waitForIdle();

    const startData = JSON.parse(fs.readFileSync(startLogFile, 'utf8')) as Record<string, string>;
    expect(startData).toEqual({
      event: 'focus.started',
      blockId: block.id,
      title: 'Investigate staging webhook timeouts',
      stdinEvent: 'focus.started',
    });

    await fetch(`${serverUrl}/api/focus/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Veyra-Now': '2026-11-23T09:45:00.000Z' },
      body: JSON.stringify({
        blockId: block.id,
        energySignal: 'neutral',
        outcomeNote: 'Identified flaky worker pool',
      }),
    });

    // Wait for both focus.ended and block.completed handlers to complete
    await waitUntil(
      () =>
        logs.some((l) => l.type === 'handler_result' && l.event === 'focus.ended') &&
        logs.some((l) => l.type === 'handler_result' && l.event === 'block.completed'),
    );
    await listener.waitForIdle();

    const endData = JSON.parse(fs.readFileSync(endLogFile, 'utf8')) as Record<string, string>;
    expect(endData.event).toBe('focus.ended');
    expect(endData.reason).toBe('completed');
    expect(endData.sessionStart).toBe('2026-11-23T09:00:00.000Z');
    expect(endData.sessionEnd).toBe('2026-11-23T09:45:00.000Z');

    // Verify autoSummary was persisted on the block and surfaced in Weekly Review
    const blockDetailRes = await fetch(`${serverUrl}/api/blocks/${block.id}`);
    const blockDetail = (await blockDetailRes.json()) as { block: { autoSummary: string | null } };
    expect(blockDetail.block.autoSummary).toBe(
      'Ops pattern: webhook retry timeouts on flaky staging worker (auto-summarized)',
    );

    const reviewRes = await fetch(`${serverUrl}/api/review?weekStart=2026-11-23`, {
      headers: { 'X-Veyra-Now': '2026-11-23T17:00:00.000Z' },
    });
    const review = (await reviewRes.json()) as {
      progressFeed: Array<{ kind: string; id: string; autoSummary?: string | null }>;
      opsRadar: { pureOpsItems: Array<{ blockIds: string[]; autoSummaries: string[] }> };
    };
    const feedItem = review.progressFeed.find((item) => item.kind === 'block' && item.id === block.id);
    expect(feedItem?.autoSummary).toBe(
      'Ops pattern: webhook retry timeouts on flaky staging worker (auto-summarized)',
    );
    expect(review.opsRadar.pureOpsItems[0]?.autoSummaries).toEqual([
      'Ops pattern: webhook retry timeouts on flaky staging worker (auto-summarized)',
    ]);

    // Verify hook deliveries were recorded in /api/activity?actor=hook
    const activityRes = await fetch(`${serverUrl}/api/activity?actor=hook`);
    const activity = (await activityRes.json()) as {
      activity: Array<{ actor: string; action: string; summary: string }>;
    };
    expect(activity.activity.some((a) => a.action === 'webhook.delivered')).toBe(true);
  });

  it('runs `veyra hook listen --port 0 --json` via runCli and emits NDJSON records until aborted', async () => {
    const controller = new AbortController();
    const lines: string[] = [];

    const cliPromise = runCli(
      [
        'hook',
        'listen',
        '--port',
        '0',
        '--on-complete',
        `"${process.execPath}" -e "console.log('done:' + process.env.VEYRA_BLOCK_ID)"`,
        '--json',
      ],
      {
        signal: controller.signal,
        stdout: (chunk) => {
          for (const line of chunk.split('\n')) {
            if (line.trim()) lines.push(line);
          }
        },
        stderr: () => {},
      },
    );

    await waitUntil(() => lines.length >= 1);
    const listeningRecord = JSON.parse(lines[0]) as { type: string; url: string; port: number };
    expect(listeningRecord.type).toBe('listening');
    expect(listeningRecord.port).toBeGreaterThan(0);

    const postRes = await fetch(listeningRecord.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Veyra-Event': 'block.completed' },
      body: JSON.stringify({
        event: 'block.completed',
        timestamp: '2026-11-23T12:00:00.000Z',
        data: { block: { id: 'blk-ndjson-1', title: 'Test NDJSON' } },
      }),
    });
    expect(postRes.status).toBe(202);

    await waitUntil(() =>
      lines.some((l) => {
        const parsed = JSON.parse(l) as { type: string };
        return parsed.type === 'handler_result';
      }),
    );

    controller.abort();
    const exitCode = await cliPromise;
    expect(exitCode).toBe(0);

    const parsedRecords = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    const resultRecord = parsedRecords.find((r) => r.type === 'handler_result');
    expect(resultRecord).toMatchObject({
      type: 'handler_result',
      event: 'block.completed',
      blockId: 'blk-ndjson-1',
      ok: true,
      exitCode: 0,
      stdout: 'done:blk-ndjson-1',
    });
    expect(parsedRecords[parsedRecords.length - 1]).toEqual({ type: 'stopped' });
  });
});
