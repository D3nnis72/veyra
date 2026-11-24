import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Block, BlockDetail, FocusSession } from '@veyra/core/types';
import type { HookWebhookPayload } from './hook-listener.js';

const execFileAsync = promisify(execFile);

export const DEFAULT_AUTO_SUMMARY_MIN_MINUTES = 5;
export const DEFAULT_AUTO_SUMMARY_TIMEOUT_MS = 60_000;
const MAX_CONTEXT_SECTION_BYTES = 16 * 1024;
const MAX_SUMMARIZER_OUTPUT_BYTES = 32 * 1024;
const MAX_SUMMARY_LENGTH = 2_000;
const MAX_GIT_COMMITS = 25;

export interface AutoSummaryWindow {
  from: string;
  to: string;
  durationMinutes: number;
}

export interface AutoSummaryBlockContext {
  blockId: string;
  title: string;
  isOps: boolean;
  status?: string;
  projectId?: string | null;
  projectName?: string | null;
  goalId?: string | null;
  notes: string;
  outcomeNote: string | null;
  resumeNote: string | null;
  previousAutoSummary: string | null;
  sessionNotes: string[];
  externalLinks: Array<{ title: string; url: string; source?: string }>;
}

export interface CollectedContextSection {
  source: string;
  label: string;
  content: string;
}

export interface ContextCollectorInput {
  block: AutoSummaryBlockContext;
  window: AutoSummaryWindow | null;
  event?: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}

export interface ContextCollector {
  readonly name: string;
  collect(input: ContextCollectorInput): Promise<CollectedContextSection | null>;
}

export interface AutoSummaryClient {
  getBlock(id: string): Promise<{ block: BlockDetail }>;
  updateBlock(id: string, input: { autoSummary: string | null }): Promise<{ block: Block }>;
  listProjects?: (params?: {
    includeArchived?: boolean;
  }) => Promise<{ projects: Array<{ id: string; name: string }> }>;
}

export interface SummarizerExecutionResult {
  ok: boolean;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
  error?: string;
}

export type SummarizerRunner = (
  command: string,
  prompt: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
) => Promise<SummarizerExecutionResult>;

export interface RunAutoSummaryOptions {
  blockId?: string;
  payload?: HookWebhookPayload;
  from?: string;
  to?: string;
  summarizerCmd?: string;
  workspaceDirs?: string[];
  contextCmds?: string[];
  collectors?: ContextCollector[];
  minMinutes?: number;
  timeoutMs?: number;
  dryRun?: boolean;
  client?: AutoSummaryClient;
  env?: NodeJS.ProcessEnv;
  runSummarizer?: SummarizerRunner;
}

export interface AutoSummaryResult {
  status: 'summarized' | 'skipped' | 'dry_run' | 'failed';
  blockId: string;
  blockTitle: string;
  isOps: boolean;
  window: AutoSummaryWindow | null;
  durationMinutes: number;
  minMinutes: number;
  skipReason?: 'below_min_minutes';
  contextSources: string[];
  contextSections: CollectedContextSection[];
  warnings: string[];
  prompt?: string;
  summary: string | null;
  written: boolean;
  durationMs: number;
  error?: string;
}

interface ExtractedPayloadFields {
  blockId: string | null;
  block: Partial<Block> | null;
  session: Partial<FocusSession> | null;
  totalBlockMinutes: number | null;
  reason: string | null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function truncateText(text: string, maxBytes: number): string {
  const trimmed = text.trim();
  if (Buffer.byteLength(trimmed, 'utf8') <= maxBytes) {
    return trimmed;
  }
  const sliced = Buffer.from(trimmed, 'utf8').subarray(0, maxBytes).toString('utf8');
  return `${sliced.trimEnd()}\n…[truncated]`;
}

function toGitIsoSeconds(iso: string, round: 'floor' | 'ceil'): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const roundedMs =
    round === 'floor' ? Math.floor(ms / 1000) * 1000 : Math.ceil(ms / 1000) * 1000;
  return new Date(roundedMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function parseIsoTimestamp(raw: string, label: string): string {
  const trimmed = raw.trim();
  const ms = Date.parse(trimmed);
  if (Number.isNaN(ms)) {
    throw new Error(`Invalid ISO timestamp for ${label}: '${raw}'`);
  }
  return new Date(ms).toISOString();
}

export function extractWebhookSummaryInput(payload: HookWebhookPayload): ExtractedPayloadFields {
  const { data } = payload;
  const rawBlock = isPlainRecord(data.block) ? data.block : null;
  const rawSession = isPlainRecord(data.session)
    ? data.session
    : isPlainRecord(data.closedSession)
      ? data.closedSession
      : null;

  const blockId =
    (rawBlock && typeof rawBlock.id === 'string' ? rawBlock.id : null) ??
    (typeof data.blockId === 'string' ? data.blockId : null);

  let block: Partial<Block> | null = null;
  if (rawBlock) {
    block = {
      id: typeof rawBlock.id === 'string' ? rawBlock.id : undefined,
      title: typeof rawBlock.title === 'string' ? rawBlock.title : undefined,
      isOps: typeof rawBlock.isOps === 'boolean' ? rawBlock.isOps : undefined,
      status:
        rawBlock.status === 'todo' || rawBlock.status === 'done' || rawBlock.status === 'dropped'
          ? rawBlock.status
          : undefined,
      projectId: typeof rawBlock.projectId === 'string' ? rawBlock.projectId : undefined,
      goalId:
        typeof rawBlock.goalId === 'string'
          ? rawBlock.goalId
          : rawBlock.goalId === null
            ? null
            : undefined,
      notes: typeof rawBlock.notes === 'string' ? rawBlock.notes : undefined,
      outcomeNote:
        typeof rawBlock.outcomeNote === 'string'
          ? rawBlock.outcomeNote
          : rawBlock.outcomeNote === null
            ? null
            : undefined,
      resumeNote:
        typeof rawBlock.resumeNote === 'string'
          ? rawBlock.resumeNote
          : rawBlock.resumeNote === null
            ? null
            : undefined,
      autoSummary:
        typeof rawBlock.autoSummary === 'string'
          ? rawBlock.autoSummary
          : rawBlock.autoSummary === null
            ? null
            : undefined,
      externalLinks: Array.isArray(rawBlock.externalLinks)
        ? rawBlock.externalLinks
            .filter(isPlainRecord)
            .filter((l) => typeof l.url === 'string' && typeof l.title === 'string')
            .map((l) => ({
              url: l.url as string,
              title: l.title as string,
              source: typeof l.source === 'string' ? l.source : 'url',
            }))
        : undefined,
    };
  }

  let session: Partial<FocusSession> | null = null;
  if (rawSession) {
    session = {
      id: typeof rawSession.id === 'string' ? rawSession.id : undefined,
      startedAt: typeof rawSession.startedAt === 'string' ? rawSession.startedAt : undefined,
      endedAt:
        typeof rawSession.endedAt === 'string'
          ? rawSession.endedAt
          : rawSession.endedAt === null
            ? null
            : undefined,
      note:
        typeof rawSession.note === 'string'
          ? rawSession.note
          : rawSession.note === null
            ? null
            : undefined,
    };
  }

  const totalBlockMinutes =
    typeof data.totalBlockMinutes === 'number' && Number.isFinite(data.totalBlockMinutes)
      ? data.totalBlockMinutes
      : null;

  const reason = typeof data.reason === 'string' ? data.reason : null;

  return {
    blockId,
    block,
    session,
    totalBlockMinutes,
    reason,
  };
}

function pickLatestClosedSession(sessions: FocusSession[]): FocusSession | null {
  const closed = sessions.filter((s) => !s.deletedAt && Boolean(s.endedAt));
  if (closed.length === 0) return null;
  closed.sort((a, b) => Date.parse(b.endedAt ?? '') - Date.parse(a.endedAt ?? ''));
  return closed[0] ?? null;
}

export function resolveSummaryWindow(params: {
  explicitFrom?: string;
  explicitTo?: string;
  payloadSession?: Partial<FocusSession> | null;
  blockDetail?: BlockDetail | null;
}): AutoSummaryWindow | null {
  const latestSession = params.blockDetail
    ? pickLatestClosedSession(params.blockDetail.sessions)
    : null;

  const rawFrom =
    params.explicitFrom ?? params.payloadSession?.startedAt ?? latestSession?.startedAt ?? null;
  const rawTo =
    params.explicitTo ?? params.payloadSession?.endedAt ?? latestSession?.endedAt ?? null;

  if (!rawFrom || !rawTo) {
    return null;
  }

  const from = parseIsoTimestamp(rawFrom, '--from');
  const to = parseIsoTimestamp(rawTo, '--to');
  const diffMs = Date.parse(to) - Date.parse(from);
  if (diffMs < 0) {
    throw new Error(`Summary window end (${to}) is earlier than start (${from}).`);
  }

  const durationMinutes = Number((diffMs / 60_000).toFixed(2));
  return { from, to, durationMinutes };
}

// ---------------------------------------------------------------------------
// Pluggable Context Collectors
// ---------------------------------------------------------------------------

export function createBlockMetadataCollector(): ContextCollector {
  return {
    name: 'block',
    async collect({ block }) {
      const lines: string[] = [];
      if (block.outcomeNote?.trim()) {
        lines.push(`Outcome note: ${block.outcomeNote.trim()}`);
      }
      if (block.resumeNote?.trim()) {
        lines.push(`Resume note: ${block.resumeNote.trim()}`);
      }
      if (block.sessionNotes.length > 0) {
        lines.push(`Session notes: ${block.sessionNotes.join(' | ')}`);
      }
      if (block.notes.trim()) {
        lines.push(`Block notes:\n${block.notes.trim()}`);
      }
      if (block.externalLinks.length > 0) {
        const formattedLinks = block.externalLinks
          .map((link) => (link.title && link.title !== link.url ? `${link.title} (${link.url})` : link.url))
          .join(', ');
        lines.push(`Links: ${formattedLinks}`);
      }

      if (lines.length === 0) {
        return null;
      }

      return {
        source: 'block',
        label: 'Block Notes & Outcome',
        content: truncateText(lines.join('\n'), MAX_CONTEXT_SECTION_BYTES),
      };
    },
  };
}

export function createGitWorkspaceCollector(workspaceDirs: string[]): ContextCollector {
  const normalizedDirs = workspaceDirs.map((dir) => dir.trim()).filter(Boolean);

  return {
    name: 'git',
    async collect({ window, timeoutMs }) {
      if (normalizedDirs.length === 0 || !window) {
        return null;
      }

      const sinceArg = `--since=${toGitIsoSeconds(window.from, 'floor')}`;
      const untilArg = `--until=${toGitIsoSeconds(window.to, 'ceil')}`;
      const gitTimeoutMs = Math.min(timeoutMs, 15_000);
      const repoSections: string[] = [];

      for (const rawDir of normalizedDirs) {
        const absDir = path.resolve(rawDir);
        if (!fs.existsSync(absDir)) {
          continue;
        }
        try {
          const { stdout } = await execFileAsync(
            'git',
            [
              '-C',
              absDir,
              'log',
              '--all',
              '--no-merges',
              `-n`,
              String(MAX_GIT_COMMITS),
              sinceArg,
              untilArg,
              '--stat=80,60',
              '--format=%h %ai %s',
            ],
            {
              timeout: gitTimeoutMs,
              maxBuffer: 256 * 1024,
            },
          );
          const output = stdout.trim();
          if (output) {
            const repoName = path.basename(absDir) || 'workspace';
            repoSections.push(`[${repoName}]\n${output}`);
          }
        } catch {
          // Directory is not a git repository or has no commits yet — skip quietly
        }
      }

      if (repoSections.length === 0) {
        return null;
      }

      return {
        source: 'git',
        label: 'Git Commits During Window',
        content: truncateText(repoSections.join('\n\n'), MAX_CONTEXT_SECTION_BYTES),
      };
    },
  };
}

function runShellCommand(
  command: string,
  stdinText: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
  maxOutputBytes: number,
): Promise<SummarizerExecutionResult> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const finish = (result: Omit<SummarizerExecutionResult, 'durationMs' | 'stdout' | 'stderr'>) => {
      if (settled) return;
      settled = true;
      resolve({
        ...result,
        durationMs: Date.now() - startedAt,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    };

    const child = spawn(command, {
      shell: true,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      const forceKill = setTimeout(() => {
        child.kill('SIGKILL');
      }, 2_000);
      forceKill.unref();
    }, timeoutMs);
    timer.unref();

    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < maxOutputBytes) {
        stdout += chunk.toString('utf8');
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < maxOutputBytes) {
        stderr += chunk.toString('utf8');
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      finish({
        ok: false,
        exitCode: null,
        signal: null,
        timedOut,
        error: err.message,
      });
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      finish({
        ok: !timedOut && code === 0,
        exitCode: code,
        signal,
        timedOut,
        ...(timedOut ? { error: `Command timed out after ${timeoutMs}ms` } : {}),
      });
    });

    if (child.stdin) {
      child.stdin.on('error', () => {
        // Ignore EPIPE if command exits without consuming stdin
      });
      child.stdin.end(stdinText);
    }
  });
}

export function createCommandContextCollector(command: string, index = 0): ContextCollector {
  const name = index === 0 ? 'context-cmd' : `context-cmd-${index + 1}`;
  return {
    name,
    async collect({ block, window, event, env, timeoutMs }) {
      const collectorEnv: NodeJS.ProcessEnv = {
        ...env,
        VEYRA_BLOCK_ID: block.blockId,
        VEYRA_BLOCK_TITLE: block.title,
        VEYRA_BLOCK_IS_OPS: String(block.isOps),
        ...(block.projectId ? { VEYRA_PROJECT_ID: block.projectId } : {}),
        ...(block.goalId ? { VEYRA_GOAL_ID: block.goalId } : {}),
        ...(window ? { VEYRA_SESSION_START: window.from, VEYRA_SESSION_END: window.to } : {}),
        ...(event ? { VEYRA_EVENT: event } : {}),
      };

      const stdinPayload = `${JSON.stringify({ blockId: block.blockId, block, window, event })}\n`;
      const result = await runShellCommand(
        command,
        stdinPayload,
        collectorEnv,
        Math.min(timeoutMs, 30_000),
        MAX_CONTEXT_SECTION_BYTES,
      );

      if (!result.ok) {
        const detail = result.error || result.stderr || `exit code ${result.exitCode ?? 'unknown'}`;
        throw new Error(`Context collector '${name}' failed: ${detail}`);
      }

      if (!result.stdout) {
        return null;
      }

      return {
        source: name,
        label: index === 0 ? 'External Context' : `External Context #${index + 1}`,
        content: truncateText(result.stdout, MAX_CONTEXT_SECTION_BYTES),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Prompt Formatting & Summarizer Execution
// ---------------------------------------------------------------------------

export function formatAutoSummaryPrompt(
  block: AutoSummaryBlockContext,
  window: AutoSummaryWindow | null,
  sections: CollectedContextSection[],
): string {
  const instructions = block.isOps
    ? [
        'You are writing a post-block summary for Veyra, a personal work cockpit focused on progress over motion.',
        'This block is flagged as Ops (reactive / operational work).',
        'Write an honest, concrete 1-2 sentence plain-text summary that:',
        '1. States what operational issue or request was actually handled.',
        '2. Identifies the recurring request or failure pattern and notes whether it is a candidate to automate, productize, or delegate.',
        'Base your answer strictly on the facts below. Do not invent work that is not evidenced. Output plain text only with no markdown headings, bullets, or "Summary:" prefix.',
      ]
    : [
        'You are writing a post-block summary for Veyra, a personal work cockpit focused on progress over motion.',
        'Write an honest, concrete 1-2 sentence plain-text summary of what actually moved forward during this focus block (what was built, decided, unblocked, or discovered).',
        'Base your answer strictly on the facts below. Do not invent work that is not evidenced. Output plain text only with no markdown headings, bullets, or "Summary:" prefix.',
      ];

  const factLines: string[] = [
    `Block title: ${block.title}`,
    `Type: ${block.isOps ? 'Ops (reactive / operational)' : 'Build / Planned'}`,
  ];
  if (block.projectName) {
    factLines.push(`Project: ${block.projectName}`);
  }
  if (window) {
    factLines.push(
      `Time window: ${window.from} to ${window.to} (${Math.round(window.durationMinutes)} min)`,
    );
  }

  const parts: string[] = [instructions.join('\n'), '', '## Block Facts', factLines.join('\n')];

  if (sections.length > 0) {
    parts.push('', '## Collected Context');
    for (const section of sections) {
      parts.push(`### ${section.label}`, section.content, '');
    }
  } else {
    parts.push(
      '',
      '## Collected Context',
      'No additional notes, commits, or external activity were recorded for this window.',
    );
  }

  return parts.join('\n').trim();
}

export function sanitizeSummaryOutput(raw: string): string {
  let cleaned = raw
    .replace(/\r\n/g, '\n')
    .trim()
    .replace(/^(?:auto[- ]?summary|summary)\s*:\s*/i, '')
    .trim();

  if (
    cleaned.length >= 2 &&
    ((cleaned.startsWith('"') && cleaned.endsWith('"')) ||
      (cleaned.startsWith("'") && cleaned.endsWith("'")))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }

  cleaned = cleaned
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ');

  if (cleaned.length > MAX_SUMMARY_LENGTH) {
    cleaned = `${cleaned.slice(0, MAX_SUMMARY_LENGTH - 1).trimEnd()}…`;
  }

  return cleaned;
}

export function runSummarizerCommand(
  command: string,
  prompt: string,
  env: NodeJS.ProcessEnv = process.env,
  timeoutMs = DEFAULT_AUTO_SUMMARY_TIMEOUT_MS,
): Promise<SummarizerExecutionResult> {
  return runShellCommand(command, `${prompt}\n`, env, timeoutMs, MAX_SUMMARIZER_OUTPUT_BYTES);
}

// ---------------------------------------------------------------------------
// Main Auto-Summary Pipeline
// ---------------------------------------------------------------------------

export async function runAutoSummary(options: RunAutoSummaryOptions): Promise<AutoSummaryResult> {
  const startedAt = Date.now();
  const env = options.env ?? process.env;
  const minMinutes = options.minMinutes ?? DEFAULT_AUTO_SUMMARY_MIN_MINUTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_AUTO_SUMMARY_TIMEOUT_MS;
  const dryRun = Boolean(options.dryRun);
  const warnings: string[] = [];

  const extracted = options.payload ? extractWebhookSummaryInput(options.payload) : null;
  const blockId = options.blockId ?? extracted?.blockId ?? null;

  if (!blockId) {
    return {
      status: 'failed',
      blockId: '',
      blockTitle: '',
      isOps: false,
      window: null,
      durationMinutes: 0,
      minMinutes,
      contextSources: [],
      contextSections: [],
      warnings,
      summary: null,
      written: false,
      durationMs: Date.now() - startedAt,
      error: 'Missing blockId in options and webhook payload.',
    };
  }

  let blockDetail: BlockDetail | null = null;
  let projectName: string | null = null;

  // Fetch full block detail from the Veyra API whenever a client is available
  // (mandatory when invoked without a rich payload, e.g. `veyra hook summarize <id>` or `focus.ended` switch).
  if (options.client) {
    try {
      const detailRes = await options.client.getBlock(blockId);
      blockDetail = detailRes.block;

      if (blockDetail.projectId && options.client.listProjects) {
        try {
          const { projects } = await options.client.listProjects({ includeArchived: true });
          const matched = projects.find((p) => p.id === blockDetail?.projectId);
          projectName = matched?.name ?? null;
        } catch {
          // Non-fatal: project name is optional context
        }
      }
    } catch (err) {
      if (!extracted?.block?.title) {
        return {
          status: 'failed',
          blockId,
          blockTitle: '',
          isOps: false,
          window: null,
          durationMinutes: 0,
          minMinutes,
          contextSources: [],
          contextSections: [],
          warnings,
          summary: null,
          written: false,
          durationMs: Date.now() - startedAt,
          error: `Failed to fetch block ${blockId}: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
      warnings.push(
        `Could not fetch full block detail from Veyra API (${err instanceof Error ? err.message : String(err)}); using webhook payload fields.`,
      );
    }
  }

  const blockTitle = blockDetail?.title ?? extracted?.block?.title ?? `Block ${blockId.slice(0, 8)}`;
  const isOps = blockDetail?.isOps ?? extracted?.block?.isOps ?? false;

  let summaryWindow: AutoSummaryWindow | null = null;
  try {
    summaryWindow = resolveSummaryWindow({
      explicitFrom: options.from,
      explicitTo: options.to,
      payloadSession: extracted?.session,
      blockDetail,
    });
  } catch (err) {
    return {
      status: 'failed',
      blockId,
      blockTitle,
      isOps,
      window: null,
      durationMinutes: 0,
      minMinutes,
      contextSources: [],
      contextSections: [],
      warnings,
      summary: null,
      written: false,
      durationMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const durationMinutes =
    summaryWindow?.durationMinutes ??
    extracted?.totalBlockMinutes ??
    blockDetail?.totalFocusMinutes ??
    0;

  if (minMinutes > 0 && durationMinutes < minMinutes) {
    return {
      status: 'skipped',
      blockId,
      blockTitle,
      isOps,
      window: summaryWindow,
      durationMinutes,
      minMinutes,
      skipReason: 'below_min_minutes',
      contextSources: [],
      contextSections: [],
      warnings,
      summary: null,
      written: false,
      durationMs: Date.now() - startedAt,
    };
  }

  // Gather session notes overlapping the window (or from the payload session)
  const sessionNoteSet = new Set<string>();
  if (extracted?.session?.note?.trim()) {
    sessionNoteSet.add(extracted.session.note.trim());
  }
  if (blockDetail?.sessions) {
    const winStartMs = summaryWindow ? Date.parse(summaryWindow.from) : null;
    const winEndMs = summaryWindow ? Date.parse(summaryWindow.to) : null;
    for (const sess of blockDetail.sessions) {
      if (sess.deletedAt || !sess.note?.trim()) continue;
      if (winStartMs !== null && winEndMs !== null) {
        const sStart = Date.parse(sess.startedAt);
        const sEnd = sess.endedAt ? Date.parse(sess.endedAt) : winEndMs;
        if (sEnd < winStartMs || sStart > winEndMs) {
          continue;
        }
      }
      sessionNoteSet.add(sess.note.trim());
    }
  }

  const blockContext: AutoSummaryBlockContext = {
    blockId,
    title: blockTitle,
    isOps,
    status: blockDetail?.status ?? extracted?.block?.status,
    projectId: blockDetail?.projectId ?? extracted?.block?.projectId ?? null,
    projectName,
    goalId: blockDetail?.goalId ?? extracted?.block?.goalId ?? null,
    notes: blockDetail?.notes ?? extracted?.block?.notes ?? '',
    outcomeNote: blockDetail?.outcomeNote ?? extracted?.block?.outcomeNote ?? null,
    resumeNote: blockDetail?.resumeNote ?? extracted?.block?.resumeNote ?? null,
    previousAutoSummary: blockDetail?.autoSummary ?? extracted?.block?.autoSummary ?? null,
    sessionNotes: Array.from(sessionNoteSet),
    externalLinks: blockDetail?.externalLinks ?? extracted?.block?.externalLinks ?? [],
  };

  // Assemble pluggable collectors
  const collectors: ContextCollector[] = [createBlockMetadataCollector()];
  if (options.workspaceDirs && options.workspaceDirs.length > 0) {
    collectors.push(createGitWorkspaceCollector(options.workspaceDirs));
  }
  if (options.contextCmds && options.contextCmds.length > 0) {
    options.contextCmds.forEach((cmd, idx) => {
      if (cmd.trim()) {
        collectors.push(createCommandContextCollector(cmd, idx));
      }
    });
  }
  if (options.collectors && options.collectors.length > 0) {
    collectors.push(...options.collectors);
  }

  const contextSections: CollectedContextSection[] = [];
  for (const collector of collectors) {
    try {
      const section = await collector.collect({
        block: blockContext,
        window: summaryWindow,
        event: options.payload?.event,
        env,
        timeoutMs,
      });
      if (section && section.content.trim()) {
        contextSections.push(section);
      }
    } catch (err) {
      warnings.push(err instanceof Error ? err.message : String(err));
    }
  }

  const contextSources = contextSections.map((s) => s.source);
  const prompt = formatAutoSummaryPrompt(blockContext, summaryWindow, contextSections);

  const summarizerCmd = options.summarizerCmd?.trim() || env.VEYRA_SUMMARIZER_CMD?.trim() || '';
  if (!summarizerCmd) {
    if (dryRun) {
      return {
        status: 'dry_run',
        blockId,
        blockTitle,
        isOps,
        window: summaryWindow,
        durationMinutes,
        minMinutes,
        contextSources,
        contextSections,
        warnings,
        prompt,
        summary: null,
        written: false,
        durationMs: Date.now() - startedAt,
      };
    }

    return {
      status: 'failed',
      blockId,
      blockTitle,
      isOps,
      window: summaryWindow,
      durationMinutes,
      minMinutes,
      contextSources,
      contextSections,
      warnings,
      prompt,
      summary: null,
      written: false,
      durationMs: Date.now() - startedAt,
      error:
        'No summarizer command configured. Pass --cmd / --summarizer-cmd (e.g. "claude -p") or set VEYRA_SUMMARIZER_CMD.',
    };
  }

  const summarizerEnv: NodeJS.ProcessEnv = {
    ...env,
    VEYRA_ACTOR: env.VEYRA_ACTOR?.trim() || 'hook',
    VEYRA_BLOCK_ID: blockId,
    VEYRA_BLOCK_TITLE: blockTitle,
    VEYRA_BLOCK_IS_OPS: String(isOps),
    ...(summaryWindow
      ? { VEYRA_SESSION_START: summaryWindow.from, VEYRA_SESSION_END: summaryWindow.to }
      : {}),
  };

  const runner = options.runSummarizer ?? runSummarizerCommand;
  const execResult = await runner(summarizerCmd, prompt, summarizerEnv, timeoutMs);

  if (!execResult.ok) {
    const detail =
      execResult.error ||
      execResult.stderr ||
      `Summarizer exited with code ${execResult.exitCode ?? execResult.signal ?? 'unknown'}`;
    return {
      status: 'failed',
      blockId,
      blockTitle,
      isOps,
      window: summaryWindow,
      durationMinutes,
      minMinutes,
      contextSources,
      contextSections,
      warnings,
      prompt,
      summary: null,
      written: false,
      durationMs: Date.now() - startedAt,
      error: detail,
    };
  }

  const summary = sanitizeSummaryOutput(execResult.stdout);
  if (!summary) {
    return {
      status: 'failed',
      blockId,
      blockTitle,
      isOps,
      window: summaryWindow,
      durationMinutes,
      minMinutes,
      contextSources,
      contextSections,
      warnings,
      prompt,
      summary: null,
      written: false,
      durationMs: Date.now() - startedAt,
      error: 'Summarizer command returned empty output.',
    };
  }

  if (dryRun) {
    return {
      status: 'dry_run',
      blockId,
      blockTitle,
      isOps,
      window: summaryWindow,
      durationMinutes,
      minMinutes,
      contextSources,
      contextSections,
      warnings,
      prompt,
      summary,
      written: false,
      durationMs: Date.now() - startedAt,
    };
  }

  if (!options.client) {
    return {
      status: 'failed',
      blockId,
      blockTitle,
      isOps,
      window: summaryWindow,
      durationMinutes,
      minMinutes,
      contextSources,
      contextSections,
      warnings,
      prompt,
      summary,
      written: false,
      durationMs: Date.now() - startedAt,
      error: 'No Veyra API client provided to persist autoSummary.',
    };
  }

  try {
    await options.client.updateBlock(blockId, { autoSummary: summary });
  } catch (err) {
    return {
      status: 'failed',
      blockId,
      blockTitle,
      isOps,
      window: summaryWindow,
      durationMinutes,
      minMinutes,
      contextSources,
      contextSections,
      warnings,
      prompt,
      summary,
      written: false,
      durationMs: Date.now() - startedAt,
      error: `Failed to write autoSummary to block ${blockId}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  return {
    status: 'summarized',
    blockId,
    blockTitle,
    isOps,
    window: summaryWindow,
    durationMinutes,
    minMinutes,
    contextSources,
    contextSections,
    warnings,
    prompt,
    summary,
    written: true,
    durationMs: Date.now() - startedAt,
  };
}

export function formatAutoSummaryHuman(result: AutoSummaryResult): string {
  const shortId = result.blockId ? result.blockId.slice(0, 8) : 'unknown';
  const opsBadge = result.isOps ? ' [Ops]' : '';

  if (result.status === 'skipped') {
    return `Skipped auto-summary for "${result.blockTitle}" (${shortId})${opsBadge}: duration ${result.durationMinutes}m is below --min-minutes ${result.minMinutes}m.`;
  }

  if (result.status === 'failed') {
    return `Auto-summary failed for "${result.blockTitle || shortId}": ${result.error ?? 'unknown error'}`;
  }

  if (result.status === 'dry_run') {
    const lines = [
      `Dry run for "${result.blockTitle}" (${shortId})${opsBadge} — sources: ${result.contextSources.join(', ') || 'none'}`,
    ];
    if (result.summary) {
      lines.push(`Generated summary (not written): ${result.summary}`);
    } else if (result.prompt) {
      lines.push('--- Prompt ---', result.prompt);
    }
    if (result.warnings.length > 0) {
      lines.push(`Warnings: ${result.warnings.join('; ')}`);
    }
    return lines.join('\n');
  }

  const lines = [
    `Updated auto-summary on "${result.blockTitle}" (${shortId})${opsBadge}: ${result.summary ?? ''}`,
  ];
  if (result.warnings.length > 0) {
    lines.push(`Warnings: ${result.warnings.join('; ')}`);
  }
  return lines.join('\n');
}
