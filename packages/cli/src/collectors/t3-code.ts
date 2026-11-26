import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
  CollectedContextSection,
  ContextCollector,
  ContextProjectActivity,
} from '../auto-summary.js';

const execFileAsync = promisify(execFile);

/**
 * Built-in read-only collector for T3 Code (the local agent workspace app).
 * Reads threads and messages active during the focus window from T3's SQLite
 * projection database via the system `sqlite3` CLI in `-readonly` mode, so Veyra
 * never writes to T3 and needs no native SQLite dependency for this.
 */

export const DEFAULT_T3_DB_PATH = path.join(os.homedir(), '.t3', 'userdata', 'statev2.sqlite');
const DEFAULT_SQLITE_BIN = '/usr/bin/sqlite3';
export const T3_SNIPPET_CHARS = 240;
export const T3_SECTION_MAX_CHARS = 6_000;
const MAX_SAMPLES_PER_THREAD = 3;
const MAX_QUERY_TIMEOUT_MS = 10_000;

/** Strict UTC ISO form produced by `Date#toISOString()`; anything else is rejected before SQL interpolation. */
const STRICT_ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export interface T3ThreadActivity {
  threadId: string;
  projectTitle: string;
  threadTitle: string;
  messageCount: number;
  firstAt: string;
  lastAt: string;
}

export interface T3MessageSample {
  threadId: string;
  role: string;
  createdAt: string;
  snippet: string;
}

export interface T3Activity {
  threads: T3ThreadActivity[];
  samples: T3MessageSample[];
}

export interface T3CodeCollectorOptions {
  /** Path to T3's `statev2.sqlite`; defaults to `~/.t3/userdata/statev2.sqlite`. */
  dbPath?: string;
  /** sqlite3 binary; defaults to `/usr/bin/sqlite3` when present, else `sqlite3` on PATH. */
  sqliteBin?: string;
}

function resolveSqliteBin(explicit?: string): string {
  if (explicit?.trim()) return explicit.trim();
  return fs.existsSync(DEFAULT_SQLITE_BIN) ? DEFAULT_SQLITE_BIN : 'sqlite3';
}

/** Normalizes a window bound to strict UTC ISO, or returns null when it is not a valid timestamp. */
export function normalizeT3WindowBound(raw: string): string | null {
  const ms = Date.parse(raw.trim());
  if (Number.isNaN(ms)) return null;
  const iso = new Date(ms).toISOString();
  return STRICT_ISO_RE.test(iso) ? iso : null;
}

function buildWindowFilter(from: string, to: string): string {
  return `
  m.streaming = 0
  AND m.role IN ('user', 'assistant')
  AND COALESCE(json_extract(t.payload_json, '$.lineage.relationshipToParent'), '') <> 'subagent'
  AND m.created_at >= '${from}'
  AND m.created_at <= '${to}'`;
}

function buildThreadAggregateSql(from: string, to: string): string {
  return `
SELECT
  t.thread_id AS thread_id,
  COALESCE(NULLIF(trim(p.title), ''), 'Workspace') AS project_title,
  COALESCE(NULLIF(trim(t.title), ''), 'Untitled thread') AS thread_title,
  COUNT(*) AS message_count,
  MIN(m.created_at) AS first_at,
  MAX(m.created_at) AS last_at
FROM orchestration_v2_projection_messages m
JOIN orchestration_v2_projection_threads t ON t.thread_id = m.thread_id
LEFT JOIN projection_projects p ON p.project_id = t.project_id
WHERE ${buildWindowFilter(from, to)}
GROUP BY t.thread_id
ORDER BY message_count DESC, last_at DESC;`;
}

/**
 * Per thread: the first message the user typed in the window (skipping agent-created
 * user messages and slash or `$` commands such as `/compact`; falls back to the first
 * message) plus the last two messages, so samples span the whole window instead of
 * only its beginning.
 */
function buildSampleSql(from: string, to: string): string {
  return `
WITH msgs AS (
  SELECT
    m.thread_id AS thread_id,
    m.role AS role,
    m.created_at AS created_at,
    substr(
      trim(replace(replace(COALESCE(json_extract(m.payload_json, '$.text'), ''), char(10), ' '), char(13), ' ')),
      1,
      ${T3_SNIPPET_CHARS + 1}
    ) AS snippet,
    ROW_NUMBER() OVER (
      PARTITION BY m.thread_id ORDER BY m.created_at DESC, m.message_id DESC
    ) AS rn_last,
    ROW_NUMBER() OVER (
      PARTITION BY m.thread_id
      ORDER BY (
        m.role = 'user'
        AND COALESCE(json_extract(m.payload_json, '$.createdBy'), 'user') = 'user'
        AND substr(ltrim(json_extract(m.payload_json, '$.text')), 1, 1) NOT IN ('/', '$')
      ) DESC, m.created_at ASC, m.message_id ASC
    ) AS rn_first_user
  FROM orchestration_v2_projection_messages m
  JOIN orchestration_v2_projection_threads t ON t.thread_id = m.thread_id
  WHERE ${buildWindowFilter(from, to)}
    AND trim(COALESCE(json_extract(m.payload_json, '$.text'), '')) <> ''
)
SELECT thread_id, role, created_at, snippet
FROM msgs
WHERE rn_last <= 2 OR rn_first_user = 1
ORDER BY thread_id, created_at ASC;`;
}

async function runSqliteJson(
  sqliteBin: string,
  dbPath: string,
  sql: string,
  timeoutMs: number,
): Promise<Array<Record<string, unknown>>> {
  const { stdout } = await execFileAsync(sqliteBin, ['-readonly', '-json', dbPath, sql], {
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
  });
  const raw = stdout.trim();
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  return Array.isArray(parsed) ? (parsed as Array<Record<string, unknown>>) : [];
}

function clipSnippet(raw: string): string {
  const text = raw.trim();
  if (text.length <= T3_SNIPPET_CHARS) return text;
  return `${text.slice(0, T3_SNIPPET_CHARS - 1).trimEnd()}…`;
}

/**
 * Queries T3 activity for the window. Returns null when the database file is missing
 * or the window is invalid (silent skip); throws when sqlite3 itself fails.
 */
export async function queryT3Activity(params: {
  dbPath: string;
  from: string;
  to: string;
  timeoutMs?: number;
  sqliteBin?: string;
}): Promise<T3Activity | null> {
  if (!fs.existsSync(params.dbPath)) return null;
  const from = normalizeT3WindowBound(params.from);
  const to = normalizeT3WindowBound(params.to);
  if (!from || !to || from > to) return null;

  const sqliteBin = resolveSqliteBin(params.sqliteBin);
  const timeoutMs = Math.min(params.timeoutMs ?? MAX_QUERY_TIMEOUT_MS, MAX_QUERY_TIMEOUT_MS);

  const threadRows = await runSqliteJson(sqliteBin, params.dbPath, buildThreadAggregateSql(from, to), timeoutMs);
  const threads: T3ThreadActivity[] = threadRows.map((row) => ({
    threadId: String(row.thread_id ?? ''),
    projectTitle: String(row.project_title ?? 'Workspace'),
    threadTitle: String(row.thread_title ?? 'Untitled thread'),
    messageCount: Number(row.message_count ?? 0),
    firstAt: String(row.first_at ?? ''),
    lastAt: String(row.last_at ?? ''),
  }));
  if (threads.length === 0) {
    return { threads, samples: [] };
  }

  const sampleRows = await runSqliteJson(sqliteBin, params.dbPath, buildSampleSql(from, to), timeoutMs);
  const samples: T3MessageSample[] = sampleRows
    .map((row) => ({
      threadId: String(row.thread_id ?? ''),
      role: String(row.role ?? ''),
      createdAt: String(row.created_at ?? ''),
      snippet: clipSnippet(String(row.snippet ?? '')),
    }))
    .filter((s) => s.snippet);

  return { threads, samples };
}

/** Aggregates thread activity per T3 project, largest first. */
export function aggregateT3ProjectActivity(threads: T3ThreadActivity[]): ContextProjectActivity[] {
  const byProject = new Map<string, ContextProjectActivity>();
  for (const thread of threads) {
    const key = thread.projectTitle.trim().toLowerCase();
    let entry = byProject.get(key);
    if (!entry) {
      entry = { projectName: thread.projectTitle, messageCount: 0, threads: [] };
      byProject.set(key, entry);
    }
    entry.messageCount += thread.messageCount;
    entry.threads.push({ title: thread.threadTitle, messageCount: thread.messageCount });
  }
  const result = Array.from(byProject.values());
  for (const entry of result) {
    entry.threads.sort((a, b) => b.messageCount - a.messageCount);
  }
  result.sort((a, b) => b.messageCount - a.messageCount);
  return result;
}

function hhmm(iso: string): string {
  const match = /T(\d{2}:\d{2})/.exec(iso);
  return match?.[1] ?? iso;
}

function sameProject(a: string, b: string | null | undefined): boolean {
  return Boolean(b) && a.trim().toLowerCase() === (b ?? '').trim().toLowerCase();
}

/**
 * Renders the prompt section. Threads in the block's own project get message samples
 * first; other projects are listed by title and count only and flagged as side work
 * the summarizer should not summarize. When no thread matches the block's project,
 * every thread keeps its samples so the summarizer still has evidence to work from.
 */
export function formatT3ContextSection(
  activity: T3Activity,
  blockProjectName: string | null | undefined,
  maxChars = T3_SECTION_MAX_CHARS,
): string {
  const samplesByThread = new Map<string, T3MessageSample[]>();
  for (const sample of activity.samples) {
    const list = samplesByThread.get(sample.threadId) ?? [];
    list.push(sample);
    samplesByThread.set(sample.threadId, list);
  }

  const ownThreads = activity.threads.filter((t) => sameProject(t.projectTitle, blockProjectName));
  const otherThreads = activity.threads.filter((t) => !sameProject(t.projectTitle, blockProjectName));
  const hasOwn = ownThreads.length > 0;

  const lines: string[] = [];
  let used = 0;
  const push = (line: string): boolean => {
    if (used + line.length + 1 > maxChars) return false;
    lines.push(line);
    used += line.length + 1;
    return true;
  };

  const pushThreadWithSamples = (thread: T3ThreadActivity): void => {
    const header = `- [${thread.projectTitle}] ${thread.threadTitle} (${thread.messageCount} messages, ${hhmm(thread.firstAt)}-${hhmm(thread.lastAt)} UTC)`;
    if (!push(header)) return;
    const samples = (samplesByThread.get(thread.threadId) ?? []).slice(0, MAX_SAMPLES_PER_THREAD);
    for (const sample of samples) {
      if (!push(`  - ${hhmm(sample.createdAt)} ${sample.role}: ${sample.snippet}`)) return;
    }
  };

  if (hasOwn) {
    push(
      `T3 Code threads in this block's project during the focus window (counts cover the whole window; samples are the first user message and the last 2 messages per thread):`,
    );
    for (const thread of ownThreads) pushThreadWithSamples(thread);
    if (otherThreads.length > 0) {
      push('');
      push(
        'Other projects active in T3 Code during this window (side work, shown to the user separately; do not summarize it):',
      );
      for (const thread of otherThreads) {
        push(`- [${thread.projectTitle}] ${thread.threadTitle} (${thread.messageCount} messages)`);
      }
    }
  } else {
    push(
      `T3 Code threads active during this focus window (none is in this block's project; use only what relates to the block; counts cover the whole window; samples are the first user message and the last 2 messages per thread):`,
    );
    for (const thread of activity.threads) pushThreadWithSamples(thread);
  }

  return lines.join('\n').trim();
}

export function createT3CodeCollector(options: T3CodeCollectorOptions = {}): ContextCollector {
  const dbPath = options.dbPath?.trim() || DEFAULT_T3_DB_PATH;
  return {
    name: 't3',
    async collect({ block, window, timeoutMs }): Promise<CollectedContextSection | null> {
      if (!window) return null;
      let activity: T3Activity | null;
      try {
        activity = await queryT3Activity({
          dbPath,
          from: window.from,
          to: window.to,
          timeoutMs,
          sqliteBin: options.sqliteBin,
        });
      } catch (err) {
        throw new Error(
          `T3 Code collector failed: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`,
        );
      }
      if (!activity) return null;

      const projectActivity = aggregateT3ProjectActivity(activity.threads);
      return {
        source: 't3',
        label: 'T3 Code Activity',
        content: activity.threads.length > 0 ? formatT3ContextSection(activity, block.projectName) : '',
        projectActivity,
      };
    },
  };
}
