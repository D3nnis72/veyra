import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createVeyraServer, type VeyraServerInstance } from '@veyra/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createBlockMetadataCollector,
  createCommandContextCollector,
  createGitWorkspaceCollector,
  formatAutoSummaryPrompt,
  formatHookLogHuman,
  runAutoSummary,
  runCli,
  sanitizeSummaryOutput,
  type AutoSummaryBlockContext,
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

function initTempGitRepo(parentDir: string, name: string): string {
  const repoDir = path.join(parentDir, name);
  fs.mkdirSync(repoDir, { recursive: true });
  execFileSync('git', ['init', '-b', 'main'], { cwd: repoDir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test Author'], { cwd: repoDir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], {
    cwd: repoDir,
    stdio: 'ignore',
  });
  return repoDir;
}

function makeGitCommit(
  repoDir: string,
  filename: string,
  content: string,
  message: string,
  isoDate: string,
): void {
  fs.writeFileSync(path.join(repoDir, filename), content, 'utf8');
  execFileSync('git', ['add', filename], { cwd: repoDir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', message], {
    cwd: repoDir,
    stdio: 'ignore',
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: isoDate,
      GIT_COMMITTER_DATE: isoDate,
    },
  });
}

describe('auto-summary unit helpers & collectors', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veyra-auto-summary-unit-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('branches prompt instructions clearly between Build and Ops blocks', () => {
    const baseBlock: AutoSummaryBlockContext = {
      blockId: '44444444-4444-4444-8444-444444444444',
      title: 'Fix webhook retries',
      isOps: false,
      projectName: 'Platform Core',
      notes: 'Checked retry backoff behavior',
      outcomeNote: 'Added exponential backoff',
      resumeNote: null,
      previousAutoSummary: null,
      sessionNotes: [],
      externalLinks: [],
    };
    const window = {
      from: '2026-11-23T09:00:00.000Z',
      to: '2026-11-23T09:45:00.000Z',
      durationMinutes: 45,
    };

    const buildPrompt = formatAutoSummaryPrompt(baseBlock, window, []);
    expect(buildPrompt).toContain('what actually moved forward');
    expect(buildPrompt).toContain('Type: Build / Planned');
    expect(buildPrompt).not.toContain('recurring request or failure pattern');

    const opsPrompt = formatAutoSummaryPrompt({ ...baseBlock, isOps: true }, window, []);
    expect(opsPrompt).toContain('flagged as Ops');
    expect(opsPrompt).toContain('recurring request or failure pattern');
    expect(opsPrompt).toContain('automate, productize, or delegate');
    expect(opsPrompt).toContain('Type: Ops (reactive / operational)');
  });

  it('sanitizes summarizer stdout cleanly', () => {
    expect(sanitizeSummaryOutput('  Summary: "Shipped retry policy and added tests."  \n')).toBe(
      'Shipped retry policy and added tests.',
    );
    expect(sanitizeSummaryOutput('Auto-summary: First line.\n\nSecond line.')).toBe(
      'First line. Second line.',
    );
  });

  it('collects block metadata, git commits inside the window only, and custom context command output', async () => {
    const repoDir = initTempGitRepo(tmpDir, 'demo-service');
    makeGitCommit(
      repoDir,
      'before.txt',
      'early\n',
      'chore: commit before focus window',
      '2026-11-23T08:00:00Z',
    );
    makeGitCommit(
      repoDir,
      'retry.ts',
      'export const retry = true;\n',
      'feat: add exponential retry backoff',
      '2026-11-23T09:20:00Z',
    );
    makeGitCommit(
      repoDir,
      'after.txt',
      'late\n',
      'chore: commit after focus window',
      '2026-11-23T11:00:00Z',
    );

    const collectorScript = path.join(tmpDir, 'context-collector.mjs');
    fs.writeFileSync(
      collectorScript,
      `
const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
console.log('Transcript snippet for ' + input.blockId + ' (' + process.env.VEYRA_SESSION_START + '..' + process.env.VEYRA_SESSION_END + '): resolved retry flake');
`,
      'utf8',
    );

    const block: AutoSummaryBlockContext = {
      blockId: '55555555-5555-4555-8555-555555555555',
      title: 'Stabilize webhook retries',
      isOps: false,
      notes: 'Investigated flaky queue consumer',
      outcomeNote: 'Shipped backoff fix',
      resumeNote: 'Verify staging metrics',
      sessionNotes: ['Paused for standup'],
      previousAutoSummary: null,
      externalLinks: [{ title: 'PR #42', url: 'https://github.com/example/repo/pull/42' }],
    };

    const window = {
      from: '2026-11-23T09:00:00.000Z',
      to: '2026-11-23T09:45:00.000Z',
      durationMinutes: 45,
    };

    const metaSection = await createBlockMetadataCollector().collect({
      block,
      window,
      env: process.env,
      timeoutMs: 10_000,
    });
    expect(metaSection?.source).toBe('block');
    expect(metaSection?.content).toContain('Shipped backoff fix');
    expect(metaSection?.content).toContain('Verify staging metrics');
    expect(metaSection?.content).toContain('Paused for standup');
    expect(metaSection?.content).toContain('PR #42');

    const gitSection = await createGitWorkspaceCollector([
      repoDir,
      path.join(tmpDir, 'non-existent-dir'),
    ]).collect({
      block,
      window,
      env: process.env,
      timeoutMs: 10_000,
    });
    expect(gitSection?.source).toBe('git');
    expect(gitSection?.content).toContain('[demo-service]');
    expect(gitSection?.content).toContain('feat: add exponential retry backoff');
    expect(gitSection?.content).not.toContain('commit before focus window');
    expect(gitSection?.content).not.toContain('commit after focus window');

    const cmdSection = await createCommandContextCollector(
      `"${process.execPath}" "${collectorScript}"`,
    ).collect({
      block,
      window,
      env: process.env,
      timeoutMs: 10_000,
    });
    expect(cmdSection?.source).toBe('context-cmd');
    expect(cmdSection?.content).toContain('Transcript snippet for 55555555-5555-4555-8555-555555555555');
    expect(cmdSection?.content).toContain('2026-11-23T09:00:00.000Z..2026-11-23T09:45:00.000Z');
  });

  it('skips sessions below --min-minutes without invoking the summarizer', async () => {
    let summarizerCalled = false;
    const result = await runAutoSummary({
      payload: {
        event: 'focus.ended',
        timestamp: '2026-11-23T09:03:00.000Z',
        data: {
          reason: 'stopped',
          block: {
            id: '66666666-6666-4666-8666-666666666666',
            title: 'Quick check-in',
            isOps: false,
            notes: '',
          },
          session: {
            id: '77777777-7777-4777-8777-777777777777',
            startedAt: '2026-11-23T09:00:00.000Z',
            endedAt: '2026-11-23T09:03:00.000Z',
          },
        },
      },
      minMinutes: 5,
      summarizerCmd: 'echo should-not-run',
      runSummarizer: async () => {
        summarizerCalled = true;
        return {
          ok: true,
          exitCode: 0,
          signal: null,
          timedOut: false,
          durationMs: 1,
          stdout: 'Should not happen',
          stderr: '',
        };
      },
    });

    expect(result.status).toBe('skipped');
    expect(result.skipReason).toBe('below_min_minutes');
    expect(result.durationMinutes).toBe(3);
    expect(result.written).toBe(false);
    expect(summarizerCalled).toBe(false);
  });

  it('formats auto_summary_result human log lines cleanly', () => {
    const savedLine = formatHookLogHuman({
      type: 'auto_summary_result',
      event: 'block.completed',
      timestamp: '2026-11-23T10:00:00Z',
      blockId: '44444444-4444-4444-8444-444444444444',
      result: {
        status: 'summarized',
        blockId: '44444444-4444-4444-8444-444444444444',
        blockTitle: 'Triage CI flakes',
        isOps: true,
        window: null,
        durationMinutes: 30,
        minMinutes: 5,
        contextSources: ['block'],
        contextSections: [],
        warnings: [],
        summary: 'Stabilized runner retries; recurring timeout pattern is a strong automation candidate.',
        written: true,
        durationMs: 42,
      },
    });
    expect(savedLine).toContain('✓ block.completed [Ops] auto-summary saved (42ms)');
    expect(savedLine).toContain('automation candidate');
  });
});

describe('veyra hook summarize & hook listen --auto-summary integration', () => {
  let server: VeyraServerInstance;
  let serverUrl: string;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veyra-auto-summary-int-'));
    server = createVeyraServer({
      dbPath: ':memory:',
      port: 0,
      host: '127.0.0.1',
      enableTestClock: true,
      rolloverCheckIntervalMs: 600_000,
      webhookOptions: {
        timeoutMs: 5_000,
        retryDelayMs: 10,
      },
    });
    const started = await server.start();
    serverUrl = started.url;
  });

  afterEach(async () => {
    await server.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('runs `veyra hook summarize` with --dry-run and live write-back including git + custom context and Ops branching', async () => {
    const repoDir = initTempGitRepo(tmpDir, 'ops-tooling');
    makeGitCommit(
      repoDir,
      'alerts.ts',
      'export const dedupe = true;\n',
      'fix: deduplicate noisy queue alert',
      '2026-11-23T09:15:00Z',
    );

    const promptCaptureFile = path.join(tmpDir, 'captured-prompt.txt');
    const mockSummarizer = path.join(tmpDir, 'mock-summarizer.mjs');
    fs.writeFileSync(
      mockSummarizer,
      `
import fs from 'node:fs';
const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const prompt = Buffer.concat(chunks).toString('utf8');
fs.writeFileSync(${JSON.stringify(promptCaptureFile)}, prompt, 'utf8');
if (prompt.includes('flagged as Ops')) {
  console.log('Deduplicated noisy queue alerts in ops-tooling; recurring manual triage is a clear candidate to automate into an alert-routing rule.');
} else {
  console.log('Completed planned implementation work.');
}
`,
      'utf8',
    );

    const contextScript = path.join(tmpDir, 'transcript-collector.mjs');
    fs.writeFileSync(
      contextScript,
      `console.log('Agent session log: traced 3 duplicate PagerDuty alerts to missing idempotency key.');`,
      'utf8',
    );

    // Create an Ops block with a 40-minute closed session
    const createRes = await fetch(`${serverUrl}/api/blocks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Veyra-Now': '2026-11-23T09:00:00.000Z' },
      body: JSON.stringify({
        title: 'Triage duplicate queue alerts',
        isOps: true,
        bucket: 'scheduled',
        scheduledDate: '2026-11-23',
        notes: 'Alerts spiked during nightly batch import',
      }),
    });
    const { block } = (await createRes.json()) as { block: { id: string } };

    await fetch(`${serverUrl}/api/focus/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Veyra-Now': '2026-11-23T09:00:00.000Z' },
      body: JSON.stringify({ blockId: block.id }),
    });
    await fetch(`${serverUrl}/api/focus/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Veyra-Now': '2026-11-23T09:40:00.000Z' },
      body: JSON.stringify({
        blockId: block.id,
        energySignal: 'down',
        outcomeNote: 'Silenced duplicate alerts for batch runs',
      }),
    });

    const baseEnv = { ...process.env, VEYRA_SERVER_URL: serverUrl };

    // 1) --dry-run without --cmd builds prompt and collects context without modifying the block
    let dryOut = '';
    const dryCode = await runCli(
      [
        'hook',
        'summarize',
        block.id,
        '--workspace',
        repoDir,
        '--context-cmd',
        `"${process.execPath}" "${contextScript}"`,
        '--dry-run',
        '--json',
      ],
      {
        env: baseEnv,
        stdout: (c) => {
          dryOut += c;
        },
        stderr: () => {},
      },
    );
    expect(dryCode).toBe(0);
    const dryJson = JSON.parse(dryOut) as {
      status: string;
      written: boolean;
      summary: string | null;
      contextSources: string[];
      prompt: string;
    };
    expect(dryJson.status).toBe('dry_run');
    expect(dryJson.written).toBe(false);
    expect(dryJson.summary).toBeNull();
    expect(dryJson.contextSources).toEqual(['block', 'git', 'context-cmd']);
    expect(dryJson.prompt).toContain('flagged as Ops');
    expect(dryJson.prompt).toContain('fix: deduplicate noisy queue alert');
    expect(dryJson.prompt).toContain('missing idempotency key');

    // Confirm block autoSummary is still null after --dry-run
    const beforeBlock = (await (await fetch(`${serverUrl}/api/blocks/${block.id}`)).json()) as {
      block: { autoSummary: string | null };
    };
    expect(beforeBlock.block.autoSummary).toBeNull();

    // 1b) --dry-run WITH --cmd runs the summarizer for preview but still does NOT write back
    let dryCmdOut = '';
    const dryCmdCode = await runCli(
      [
        'hook',
        'summarize',
        block.id,
        '--from',
        '2026-11-23T09:00:00.000Z',
        '--to',
        '2026-11-23T09:40:00.000Z',
        '--cmd',
        `"${process.execPath}" "${mockSummarizer}"`,
        '--workspace',
        repoDir,
        '--context-cmd',
        `"${process.execPath}" -e "console.error('collector boom'); process.exit(1)"`,
        '--dry-run',
        '--json',
      ],
      {
        env: baseEnv,
        stdout: (c) => {
          dryCmdOut += c;
        },
        stderr: () => {},
      },
    );
    expect(dryCmdCode).toBe(0);
    const dryCmdJson = JSON.parse(dryCmdOut) as {
      status: string;
      written: boolean;
      summary: string | null;
      warnings: string[];
    };
    expect(dryCmdJson.status).toBe('dry_run');
    expect(dryCmdJson.written).toBe(false);
    expect(dryCmdJson.summary).toContain('candidate to automate');
    expect(dryCmdJson.warnings.some((w) => w.includes('collector boom'))).toBe(true);

    const stillBeforeBlock = (await (await fetch(`${serverUrl}/api/blocks/${block.id}`)).json()) as {
      block: { autoSummary: string | null };
    };
    expect(stillBeforeBlock.block.autoSummary).toBeNull();

    // 2) Live run with --cmd writes autoSummary back via PATCH /api/blocks/:id
    let liveOut = '';
    const liveCode = await runCli(
      [
        'hook',
        'summarize',
        block.id,
        '--cmd',
        `"${process.execPath}" "${mockSummarizer}"`,
        '--workspace',
        repoDir,
        '--context-cmd',
        `"${process.execPath}" "${contextScript}"`,
        '--json',
      ],
      {
        env: baseEnv,
        stdout: (c) => {
          liveOut += c;
        },
        stderr: () => {},
      },
    );
    expect(liveCode).toBe(0);
    const liveJson = JSON.parse(liveOut) as {
      status: string;
      written: boolean;
      summary: string;
      durationMinutes: number;
    };
    expect(liveJson.status).toBe('summarized');
    expect(liveJson.written).toBe(true);
    expect(liveJson.durationMinutes).toBe(40);
    expect(liveJson.summary).toContain('candidate to automate');

    const capturedPrompt = fs.readFileSync(promptCaptureFile, 'utf8');
    expect(capturedPrompt).toContain('Silenced duplicate alerts for batch runs');
    expect(capturedPrompt).toContain('fix: deduplicate noisy queue alert');

    const afterBlock = (await (await fetch(`${serverUrl}/api/blocks/${block.id}`)).json()) as {
      block: { autoSummary: string | null };
    };
    expect(afterBlock.block.autoSummary).toBe(liveJson.summary);
  });

  it('wires `veyra hook listen --auto-summary` to /hooks/veyra, skips short blocks, deduplicates completion events, and writes back autoSummary', async () => {
    const countFile = path.join(tmpDir, 'summarizer-calls.txt');
    const mockSummarizer = path.join(tmpDir, 'listen-summarizer.mjs');
    fs.writeFileSync(
      mockSummarizer,
      `
import fs from 'node:fs';
const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const prompt = Buffer.concat(chunks).toString('utf8');
fs.appendFileSync(${JSON.stringify(countFile)}, 'call\\n', 'utf8');
if (prompt.includes('flagged as Ops')) {
  console.log('Handled recurring staging cert renewal; automate via ACME cron job.');
} else {
  console.log('Moved API client pagination work forward.');
}
`,
      'utf8',
    );

    const controller = new AbortController();
    const lines: string[] = [];

    const cliPromise = runCli(
      [
        'hook',
        'listen',
        '--port',
        '0',
        '--auto-summary',
        '--summarizer-cmd',
        `"${process.execPath}" "${mockSummarizer}"`,
        '--min-minutes',
        '5',
        '--json',
      ],
      {
        env: { ...process.env, VEYRA_SERVER_URL: serverUrl },
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
    const listening = JSON.parse(lines[0]) as {
      type: string;
      port: number;
      autoSummaryEnabled: boolean;
    };
    expect(listening.type).toBe('listening');
    expect(listening.autoSummaryEnabled).toBe(true);

    // Configure server webhookUrl using the /hooks/veyra path
    const hooksVeyraUrl = `http://127.0.0.1:${listening.port}/hooks/veyra`;
    const patchRes = await fetch(`${serverUrl}/api/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        webhookUrl: hooksVeyraUrl,
        webhookEvents: ['focus.started', 'focus.ended', 'block.completed'],
      }),
    });
    expect(patchRes.status).toBe(200);

    // 1) Short 2-minute session -> skipped by --min-minutes 5
    const shortBlockRes = await fetch(`${serverUrl}/api/blocks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Veyra-Now': '2026-11-23T08:00:00.000Z' },
      body: JSON.stringify({
        title: 'Quick 2m glance',
        bucket: 'scheduled',
        scheduledDate: '2026-11-23',
      }),
    });
    const { block: shortBlock } = (await shortBlockRes.json()) as { block: { id: string } };

    await fetch(`${serverUrl}/api/focus/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Veyra-Now': '2026-11-23T08:00:00.000Z' },
      body: JSON.stringify({ blockId: shortBlock.id }),
    });
    await fetch(`${serverUrl}/api/focus/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Veyra-Now': '2026-11-23T08:02:00.000Z' },
      body: JSON.stringify({ blockId: shortBlock.id }),
    });

    await waitUntil(() =>
      lines.some((l) => {
        const rec = JSON.parse(l) as { type: string; blockId?: string; result?: { status: string } };
        return rec.type === 'auto_summary_result' && rec.blockId === shortBlock.id;
      }),
    );

    const shortDetail = (await (await fetch(`${serverUrl}/api/blocks/${shortBlock.id}`)).json()) as {
      block: { autoSummary: string | null };
    };
    expect(shortDetail.block.autoSummary).toBeNull();
    expect(fs.existsSync(countFile)).toBe(false);

    // 2) Full 30-minute Ops block -> both focus.ended and block.completed fire, deduplicated to 1 call
    const opsBlockRes = await fetch(`${serverUrl}/api/blocks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Veyra-Now': '2026-11-23T10:00:00.000Z' },
      body: JSON.stringify({
        title: 'Renew staging TLS cert',
        isOps: true,
        bucket: 'scheduled',
        scheduledDate: '2026-11-23',
        notes: 'Manual cert renewal broke staging ingress again',
      }),
    });
    const { block: opsBlock } = (await opsBlockRes.json()) as { block: { id: string } };

    await fetch(`${serverUrl}/api/focus/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Veyra-Now': '2026-11-23T10:00:00.000Z' },
      body: JSON.stringify({ blockId: opsBlock.id }),
    });
    await fetch(`${serverUrl}/api/focus/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Veyra-Now': '2026-11-23T10:30:00.000Z' },
      body: JSON.stringify({
        blockId: opsBlock.id,
        energySignal: 'neutral',
        outcomeNote: 'Renewed cert and restored ingress',
      }),
    });

    await waitUntil(() =>
      lines.some((l) => {
        const rec = JSON.parse(l) as {
          type: string;
          blockId?: string;
          result?: { status: string; written: boolean };
        };
        return (
          rec.type === 'auto_summary_result' &&
          rec.blockId === opsBlock.id &&
          rec.result?.status === 'summarized'
        );
      }),
    );

    // Give a brief moment for any duplicate webhook delivery to settle
    await new Promise((r) => setTimeout(r, 150));

    controller.abort();
    const exitCode = await cliPromise;
    expect(exitCode).toBe(0);

    // Verify summarizer was invoked exactly once despite both focus.ended and block.completed firing
    const calls = fs.readFileSync(countFile, 'utf8').trim().split('\n').filter(Boolean);
    expect(calls).toHaveLength(1);

    const opsDetail = (await (await fetch(`${serverUrl}/api/blocks/${opsBlock.id}`)).json()) as {
      block: { autoSummary: string | null };
    };
    expect(opsDetail.block.autoSummary).toBe(
      'Handled recurring staging cert renewal; automate via ACME cron job.',
    );

    // Verify surfaced in Weekly Review Ops Radar
    const reviewRes = await fetch(`${serverUrl}/api/review?weekStart=2026-11-23`, {
      headers: { 'X-Veyra-Now': '2026-11-23T17:00:00.000Z' },
    });
    const review = (await reviewRes.json()) as {
      opsRadar: { pureOpsItems: Array<{ autoSummaries: string[] }> };
    };
    expect(review.opsRadar.pureOpsItems[0]?.autoSummaries).toContain(
      'Handled recurring staging cert renewal; automate via ACME cron job.',
    );
  });

  it('rejects `veyra hook listen --auto-summary` without --summarizer-cmd or VEYRA_SUMMARIZER_CMD', async () => {
    let errText = '';
    const code = await runCli(['hook', 'listen', '--port', '0', '--auto-summary', '--json'], {
      env: { PATH: process.env.PATH },
      stdout: () => {},
      stderr: (c) => {
        errText += c;
      },
    });
    expect(code).toBe(2);
    const parsed = JSON.parse(errText) as { error: { code: string; message: string } };
    expect(parsed.error.code).toBe('USAGE_ERROR');
    expect(parsed.error.message).toContain('--summarizer-cmd');
  });
});
