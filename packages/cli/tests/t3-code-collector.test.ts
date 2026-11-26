import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createVeyraServer, type VeyraServerInstance } from '@veyra/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  computeSideWork,
  createT3CodeCollector,
  formatT3ContextSection,
  queryT3Activity,
  runCli,
} from '../src/index.js';

const SQLITE_BIN = fs.existsSync('/usr/bin/sqlite3') ? '/usr/bin/sqlite3' : 'sqlite3';

function execSql(dbPath: string, sql: string): void {
  execFileSync(SQLITE_BIN, [dbPath], { input: sql, encoding: 'utf8' });
}

function createFakeT3Db(dbPath: string): void {
  execSql(
    dbPath,
    `
CREATE TABLE projection_projects (
  project_id TEXT PRIMARY KEY,
  title TEXT
);
CREATE TABLE orchestration_v2_projection_threads (
  thread_id TEXT PRIMARY KEY,
  project_id TEXT,
  title TEXT,
  payload_json TEXT
);
CREATE TABLE orchestration_v2_projection_messages (
  message_id TEXT PRIMARY KEY,
  thread_id TEXT,
  role TEXT,
  streaming INTEGER,
  created_at TEXT,
  payload_json TEXT
);
`,
  );
}

function sqlStr(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

describe('T3 Code built-in collector and sideWork', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veyra-t3-collector-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('samples across the full 60-minute window (>40 messages), skips subagents/streaming/slash commands, and splits own vs side work', async () => {
    const dbPath = path.join(tmpDir, 'statev2.sqlite');
    createFakeT3Db(dbPath);

    const statements: string[] = [
      `INSERT INTO projection_projects VALUES ('p-acc', 'Accenture'), ('p-cov', 'Covestro');`,
      `INSERT INTO orchestration_v2_projection_threads VALUES
        ('t-acc', 'p-acc', 'Strategic Sourcing Figma', '{}'),
        ('t-sub', 'p-acc', 'Subagent helper', '{"lineage":{"relationshipToParent":"subagent"}}'),
        ('t-cov', 'p-cov', 'Run Daily Maintenance Flow', '{}');`,
    ];

    // 1) Slash command first, then real first user prompt, then 48 more messages reaching 19:58 UTC
    statements.push(
      `INSERT INTO orchestration_v2_projection_messages VALUES (
        'm-00', 't-acc', 'user', 0, '2026-11-25T19:01:00.000Z',
        ${sqlStr(JSON.stringify({ text: '/compact', createdBy: 'user' }))}
      );`,
      `INSERT INTO orchestration_v2_projection_messages VALUES (
        'm-01', 't-acc', 'user', 0, '2026-11-25T19:02:00.000Z',
        ${sqlStr(JSON.stringify({ text: 'Rebuild packages table in Figma', createdBy: 'user' }))}
      );`,
    );

    for (let i = 2; i <= 49; i++) {
      const minute = String(Math.min(58, i + 9)).padStart(2, '0');
      const sec = String(i % 60).padStart(2, '0');
      const role = i % 2 === 0 ? 'assistant' : 'user';
      const text =
        i === 49
          ? 'Final check at minute 58: exported updated packages frame.'
          : `Step ${i} progress note`;
      statements.push(
        `INSERT INTO orchestration_v2_projection_messages VALUES (
          'm-${String(i).padStart(2, '0')}', 't-acc', '${role}', 0,
          '2026-11-25T19:${minute}:${sec}.000Z',
          ${sqlStr(JSON.stringify({ text, createdBy: 'user' }))}
        );`,
      );
    }

    // Streaming message and subagent message should be ignored
    statements.push(
      `INSERT INTO orchestration_v2_projection_messages VALUES (
        'm-stream', 't-acc', 'assistant', 1, '2026-11-25T19:59:00.000Z',
        ${sqlStr(JSON.stringify({ text: 'partial stream should be skipped' }))}
      );`,
      `INSERT INTO orchestration_v2_projection_messages VALUES (
        'm-sub', 't-sub', 'assistant', 0, '2026-11-25T19:30:00.000Z',
        ${sqlStr(JSON.stringify({ text: 'subagent output should be skipped' }))}
      );`,
    );

    // 29 messages in Covestro during the same window
    for (let i = 1; i <= 29; i++) {
      const minute = String(15 + i).padStart(2, '0');
      statements.push(
        `INSERT INTO orchestration_v2_projection_messages VALUES (
          'c-${String(i).padStart(2, '0')}', 't-cov', '${i % 2 === 1 ? 'user' : 'assistant'}', 0,
          '2026-11-25T19:${minute}:00.000Z',
          ${sqlStr(JSON.stringify({ text: `Covestro maintenance msg ${i}` }))}
        );`,
      );
    }

    execSql(dbPath, statements.join('\n'));

    const activity = await queryT3Activity({
      dbPath,
      from: '2026-11-25T19:00:00.000Z',
      to: '2026-11-25T20:00:00.000Z',
    });
    expect(activity).not.toBeNull();
    expect(activity!.threads.map((t) => [t.projectTitle, t.threadTitle, t.messageCount])).toEqual([
      ['Accenture', 'Strategic Sourcing Figma', 50],
      ['Covestro', 'Run Daily Maintenance Flow', 29],
    ]);

    const accSamples = activity!.samples.filter((s) => s.threadId === 't-acc');
    expect(accSamples.map((s) => s.snippet)).toContain('Rebuild packages table in Figma');
    expect(accSamples.map((s) => s.snippet)).toContain(
      'Final check at minute 58: exported updated packages frame.',
    );
    expect(accSamples.some((s) => s.snippet.includes('/compact'))).toBe(false);
    expect(accSamples.some((s) => s.snippet.includes('partial stream'))).toBe(false);

    const rendered = formatT3ContextSection(activity!, 'Accenture');
    expect(rendered).toContain('Rebuild packages table in Figma');
    expect(rendered).toContain('Final check at minute 58: exported updated packages frame.');
    expect(rendered).toContain('Other projects active in T3 Code during this window');
    expect(rendered).toContain('- [Covestro] Run Daily Maintenance Flow (29 messages)');
    expect(rendered).not.toContain('Covestro maintenance msg');

    // Missing DB returns null silently
    const collector = createT3CodeCollector({ dbPath: path.join(tmpDir, 'missing.sqlite') });
    const missingSection = await collector.collect({
      block: {
        blockId: 'b1',
        title: 'Test',
        isOps: false,
        notes: '',
        outcomeNote: null,
        resumeNote: null,
        previousAutoSummary: null,
        sessionNotes: [],
        externalLinks: [],
      },
      window: {
        from: '2026-11-25T19:00:00.000Z',
        to: '2026-11-25T20:00:00.000Z',
        durationMinutes: 60,
      },
      env: process.env,
      timeoutMs: 5000,
    });
    expect(missingSection).toBeNull();
  });

  it('computeSideWork maps project names case-insensitively, excludes the block project, and keeps unmapped projects', () => {
    const accId = '11111111-1111-4111-8111-111111111111';
    const covId = '22222222-2222-4222-8222-222222222222';
    const result = computeSideWork({
      activity: [
        {
          projectName: 'accenture',
          messageCount: 50,
          threads: [{ title: 'Figma', messageCount: 50 }],
        },
        {
          projectName: 'covestro',
          messageCount: 29,
          threads: [{ title: 'Run Daily Maintenance Flow', messageCount: 29 }],
        },
        {
          projectName: 'Workspace',
          messageCount: 4,
          threads: [{ title: 'Scratch', messageCount: 4 }],
        },
      ],
      blockProjectId: accId,
      blockProjectName: 'Accenture',
      projects: [
        { id: accId, name: 'Accenture' },
        { id: covId, name: 'Covestro' },
      ],
    });

    expect(result).toEqual([
      {
        projectId: covId,
        projectName: 'Covestro',
        messageCount: 29,
        threads: [{ title: 'Run Daily Maintenance Flow', messageCount: 29 }],
      },
      {
        projectId: null,
        projectName: 'Workspace',
        messageCount: 4,
        threads: [{ title: 'Scratch', messageCount: 4 }],
      },
    ]);

    expect(
      computeSideWork({
        activity: null,
        blockProjectId: accId,
        projects: [],
      }),
    ).toBeNull();
  });
});

describe('veyra hook summarize --t3 integration', () => {
  let tmpDir: string;
  let server: VeyraServerInstance;
  let serverUrl: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veyra-t3-summarize-int-'));
    server = createVeyraServer({
      dbPath: path.join(tmpDir, 'veyra.db'),
      port: 0,
      host: '127.0.0.1',
      enableTestClock: true,
      rolloverCheckIntervalMs: 60_000,
    });
    serverUrl = (await server.start()).url;
  });

  afterEach(async () => {
    await server.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('persists autoSummary and mapped sideWork on the block via --t3 --t3-db', async () => {
    const headers = { 'Content-Type': 'application/json', 'X-Veyra-Now': '2026-11-25T19:00:00.000Z' };
    const acc = (
      (await (
        await fetch(`${serverUrl}/api/projects`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ name: 'Accenture' }),
        })
      ).json()) as { project: { id: string } }
    ).project;
    const cov = (
      (await (
        await fetch(`${serverUrl}/api/projects`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ name: 'Covestro' }),
        })
      ).json()) as { project: { id: string } }
    ).project;

    const { block } = (await (
      await fetch(`${serverUrl}/api/blocks`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          title: 'Strategic Sourcing Figma',
          projectId: acc.id,
          bucket: 'scheduled',
          scheduledDate: '2026-11-25',
        }),
      })
    ).json()) as { block: { id: string } };

    await fetch(`${serverUrl}/api/focus/start`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ blockId: block.id }),
    });
    await fetch(`${serverUrl}/api/focus/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Veyra-Now': '2026-11-25T19:58:00.000Z' },
      body: JSON.stringify({ blockId: block.id }),
    });

    const t3DbPath = path.join(tmpDir, 't3.sqlite');
    createFakeT3Db(t3DbPath);
    execSql(
      t3DbPath,
      `
INSERT INTO projection_projects VALUES ('p-acc', 'Accenture'), ('p-cov', 'Covestro');
INSERT INTO orchestration_v2_projection_threads VALUES
  ('t-acc', 'p-acc', 'Strategic Sourcing Figma', '{}'),
  ('t-cov', 'p-cov', 'Run Daily Maintenance Flow', '{}');
INSERT INTO orchestration_v2_projection_messages VALUES
  ('a1', 't-acc', 'user', 0, '2026-11-25T19:05:00.000Z', '{"text":"Update screens","createdBy":"user"}'),
  ('a2', 't-acc', 'assistant', 0, '2026-11-25T19:55:00.000Z', '{"text":"Finished updating Figma screens."}'),
  ('c1', 't-cov', 'user', 0, '2026-11-25T19:20:00.000Z', '{"text":"Run maintenance","createdBy":"user"}'),
  ('c2', 't-cov', 'assistant', 0, '2026-11-25T19:25:00.000Z', '{"text":"Maintenance flow completed."}');
`,
    );

    const mockSummarizer = path.join(tmpDir, 'summarizer.mjs');
    fs.writeFileSync(
      mockSummarizer,
      `console.log('Updated the Strategic Sourcing Figma screens.');`,
      'utf8',
    );

    let out = '';
    const code = await runCli(
      [
        'hook',
        'summarize',
        block.id,
        '--t3-db',
        t3DbPath,
        '--cmd',
        `"${process.execPath}" "${mockSummarizer}"`,
        '--json',
      ],
      {
        env: { ...process.env, VEYRA_SERVER_URL: serverUrl },
        stdout: (c) => {
          out += c;
        },
        stderr: () => {},
      },
    );

    expect(code).toBe(0);
    const res = JSON.parse(out) as {
      status: string;
      written: boolean;
      summary: string;
      sideWork: Array<{ projectId: string | null; projectName: string; messageCount: number }>;
    };
    expect(res.status).toBe('summarized');
    expect(res.written).toBe(true);
    expect(res.sideWork).toEqual([
      {
        projectId: cov.id,
        projectName: 'Covestro',
        messageCount: 2,
        threads: [{ title: 'Run Daily Maintenance Flow', messageCount: 2 }],
      },
    ]);

    const persisted = (await (await fetch(`${serverUrl}/api/blocks/${block.id}`)).json()) as {
      block: { autoSummary: string | null; sideWork: unknown };
    };
    expect(persisted.block.autoSummary).toBe('Updated the Strategic Sourcing Figma screens.');
    expect(persisted.block.sideWork).toEqual(res.sideWork);
  });
});
