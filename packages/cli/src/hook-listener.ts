import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import http from 'node:http';
import { z } from 'zod';
import {
  DEFAULT_AUTO_SUMMARY_MIN_MINUTES,
  runAutoSummary,
  type AutoSummaryClient,
  type AutoSummaryResult,
  type ContextCollector,
  type SummarizerRunner,
} from './auto-summary.js';

export const DEFAULT_HOOK_PORT = 4174;
export const DEFAULT_HOOK_HOST = '127.0.0.1';
export const DEFAULT_HOOK_PATH = '/webhook';
export const DEFAULT_HOOK_ACCEPTED_PATHS = ['/', '/webhook', '/hooks/veyra'] as const;
export const DEFAULT_HOOK_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 64 * 1024;
const AUTO_SUMMARY_DEDUPE_WINDOW_MS = 15_000;

export const hookWebhookPayloadSchema = z.object({
  event: z.string().min(1),
  timestamp: z.string().min(1),
  data: z.record(z.unknown()).default({}),
});

export type HookWebhookPayload = z.infer<typeof hookWebhookPayloadSchema>;

export interface HookCommandMap {
  onFocusStart?: string;
  onFocusEnd?: string;
  onComplete?: string;
  onAny?: string;
}

export interface HookExecutionResult {
  ok: boolean;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
  error?: string;
}

export interface HookListenerAutoSummaryOptions {
  enabled: boolean;
  summarizerCmd?: string;
  workspaceDirs?: string[];
  contextCmds?: string[];
  collectors?: ContextCollector[];
  minMinutes?: number;
  timeoutMs?: number;
  dryRun?: boolean;
  client?: AutoSummaryClient;
  runSummarizer?: SummarizerRunner;
}

export type HookLogRecord =
  | {
      type: 'listening';
      host: string;
      port: number;
      url: string;
      handlers: {
        'focus.started': string | null;
        'focus.ended': string | null;
        'block.completed': string | null;
        any: string | null;
      };
      secretConfigured: boolean;
      autoSummaryEnabled?: boolean;
    }
  | {
      type: 'event';
      event: string;
      timestamp: string;
      blockId: string | null;
      handled: boolean;
      status: 'received' | 'skipped' | 'test';
      command?: string;
      autoSummary?: boolean;
    }
  | {
      type: 'handler_result';
      event: string;
      timestamp: string;
      blockId: string | null;
      command: string;
      ok: boolean;
      exitCode: number | null;
      signal: NodeJS.Signals | null;
      timedOut: boolean;
      durationMs: number;
      stdout: string;
      stderr: string;
      error?: string;
    }
  | {
      type: 'auto_summary_result';
      event: string;
      timestamp: string;
      blockId: string | null;
      result: AutoSummaryResult;
    }
  | {
      type: 'rejected';
      statusCode: number;
      reason: string;
    }
  | {
      type: 'stopped';
    };

export interface HookListenerOptions {
  port?: number;
  host?: string;
  webhookPath?: string;
  handlers?: HookCommandMap;
  autoSummary?: HookListenerAutoSummaryOptions;
  secret?: string;
  timeoutMs?: number;
  maxBodyBytes?: number;
  env?: NodeJS.ProcessEnv;
  onLog?: (record: HookLogRecord) => void;
}

export interface HookListenerHandle {
  host: string;
  port: number;
  url: string;
  waitForIdle: () => Promise<void>;
  stop: () => Promise<void>;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function computeWebhookSignature(secret: string, rawBody: string): string {
  const digest = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  return `sha256=${digest}`;
}

export function verifyWebhookSignature(
  secret: string,
  rawBody: string,
  headerValue: string | string[] | undefined,
): boolean {
  const provided = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (!provided || !provided.startsWith('sha256=')) {
    return false;
  }
  const expected = computeWebhookSignature(secret, rawBody);
  const providedBuf = Buffer.from(provided, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');
  if (providedBuf.length !== expectedBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}

export function extractBlockId(payload: HookWebhookPayload): string | null {
  const { data } = payload;
  if (isPlainRecord(data.block) && typeof data.block.id === 'string') {
    return data.block.id;
  }
  if (typeof data.blockId === 'string') {
    return data.blockId;
  }
  return null;
}

export function extractHookEnv(
  payload: HookWebhookPayload,
  rawBody: string,
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    VEYRA_ACTOR: baseEnv.VEYRA_ACTOR?.trim() || 'hook',
    VEYRA_EVENT: payload.event,
    VEYRA_EVENT_TIMESTAMP: payload.timestamp,
    VEYRA_PAYLOAD: rawBody,
  };

  const { data } = payload;
  const block = isPlainRecord(data.block) ? data.block : null;
  const session = isPlainRecord(data.session)
    ? data.session
    : isPlainRecord(data.closedSession)
      ? data.closedSession
      : null;

  const blockId = extractBlockId(payload);
  if (blockId) env.VEYRA_BLOCK_ID = blockId;
  if (block) {
    if (typeof block.title === 'string') env.VEYRA_BLOCK_TITLE = block.title;
    if (typeof block.isOps === 'boolean') env.VEYRA_BLOCK_IS_OPS = String(block.isOps);
    if (typeof block.projectId === 'string') env.VEYRA_PROJECT_ID = block.projectId;
    if (typeof block.goalId === 'string') env.VEYRA_GOAL_ID = block.goalId;
  }
  if (session) {
    if (typeof session.id === 'string') env.VEYRA_SESSION_ID = session.id;
    if (typeof session.startedAt === 'string') env.VEYRA_SESSION_START = session.startedAt;
    if (typeof session.endedAt === 'string') env.VEYRA_SESSION_END = session.endedAt;
  }
  if (typeof data.reason === 'string') env.VEYRA_FOCUS_END_REASON = data.reason;
  if (typeof data.totalBlockMinutes === 'number') {
    env.VEYRA_TOTAL_BLOCK_MINUTES = String(data.totalBlockMinutes);
  }

  return env;
}

export function resolveCommandForEvent(
  eventName: string,
  handlers: HookCommandMap,
): string | undefined {
  if (eventName === 'webhook.test') {
    return undefined;
  }
  if (eventName === 'focus.started') {
    return handlers.onFocusStart ?? handlers.onAny;
  }
  if (eventName === 'focus.ended') {
    return handlers.onFocusEnd ?? handlers.onAny;
  }
  if (eventName === 'block.completed') {
    return handlers.onComplete ?? handlers.onAny;
  }
  return handlers.onAny;
}

export function executeHookCommand(
  command: string,
  rawBody: string,
  env: NodeJS.ProcessEnv,
  timeoutMs = DEFAULT_HOOK_TIMEOUT_MS,
): Promise<HookExecutionResult> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const finish = (result: Omit<HookExecutionResult, 'durationMs' | 'stdout' | 'stderr'>) => {
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
      if (stdout.length < MAX_OUTPUT_BYTES) {
        stdout += chunk.toString('utf8');
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < MAX_OUTPUT_BYTES) {
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
        ...(timedOut ? { error: `Handler timed out after ${timeoutMs}ms` } : {}),
      });
    });

    if (child.stdin) {
      child.stdin.on('error', () => {
        // Ignore EPIPE when the command exits without reading stdin
      });
      child.stdin.end(`${rawBody}\n`);
    }
  });
}

function sendJson(res: http.ServerResponse, statusCode: number, body: Record<string, unknown>): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function normalizeWebhookPath(raw?: string): string {
  const trimmed = (raw ?? DEFAULT_HOOK_PATH).trim();
  if (!trimmed || trimmed === '/') return '/';
  const withLead = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLead.replace(/\/+$/, '');
}

function readRequestBody(req: http.IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let exceeded = false;

    req.on('data', (chunk: Buffer) => {
      if (exceeded) return;
      total += chunk.length;
      if (total > maxBytes) {
        exceeded = true;
        reject(Object.assign(new Error(`Payload exceeds ${maxBytes} byte limit`), { statusCode: 413 }));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (!exceeded) {
        resolve(Buffer.concat(chunks).toString('utf8'));
      }
    });

    req.on('error', (err) => reject(err));
  });
}

export function formatHookLogHuman(record: HookLogRecord): string {
  switch (record.type) {
    case 'listening': {
      const configured = (['focus.started', 'focus.ended', 'block.completed'] as const).filter(
        (key) => Boolean(record.handlers[key]),
      );
      const parts: string[] = [];
      if (record.autoSummaryEnabled) {
        parts.push('auto-summary (focus.ended, block.completed)');
      }
      if (configured.length > 0) {
        parts.push(`${configured.join(', ')}${record.handlers.any ? ' (+ fallback)' : ''}`);
      } else if (record.handlers.any) {
        parts.push('all events');
      }
      const handlerSummary =
        parts.length > 0 ? `Handlers: ${parts.join(' + ')}` : 'Handlers: none (logging payloads only)';
      const sigSuffix = record.secretConfigured ? ' · HMAC verification enabled' : '';
      return `Listening for Veyra webhooks at ${record.url}${sigSuffix}\n${handlerSummary}`;
    }
    case 'event': {
      const target = record.blockId ? ` (block ${record.blockId.slice(0, 8)})` : '';
      if (record.status === 'test') {
        return `[${record.timestamp}] ← ${record.event} (test ping acknowledged)`;
      }
      if (record.status === 'skipped') {
        return `[${record.timestamp}] ← ${record.event}${target} (no handler configured)`;
      }
      const actionLabel =
        record.autoSummary && record.command
          ? 'running auto-summary + handler'
          : record.autoSummary
            ? 'running auto-summary'
            : 'running handler';
      return `[${record.timestamp}] ← ${record.event}${target} → ${actionLabel}`;
    }
    case 'handler_result': {
      const icon = record.ok ? '✓' : '✗';
      const status = record.timedOut
        ? 'timed out'
        : `exit ${record.exitCode ?? record.signal ?? 'err'}`;
      const detail = !record.ok
        ? record.error || record.stderr || record.stdout
        : record.stdout;
      const suffix = detail ? ` — ${detail.split('\n')[0]}` : '';
      return `[${record.timestamp}] ${icon} ${record.event} (${status}, ${record.durationMs}ms)${suffix}`;
    }
    case 'auto_summary_result': {
      const res = record.result;
      const opsBadge = res.isOps ? ' [Ops]' : '';
      if (res.status === 'skipped') {
        return `[${record.timestamp}] · ${record.event}${opsBadge} auto-summary skipped (${res.durationMinutes}m < ${res.minMinutes}m)`;
      }
      if (res.status === 'failed') {
        return `[${record.timestamp}] ✗ ${record.event}${opsBadge} auto-summary failed (${res.durationMs}ms) — ${res.error ?? 'unknown error'}`;
      }
      if (res.status === 'dry_run') {
        return `[${record.timestamp}] ✓ ${record.event}${opsBadge} auto-summary dry-run (${res.durationMs}ms)${res.summary ? ` — ${res.summary}` : ''}`;
      }
      return `[${record.timestamp}] ✓ ${record.event}${opsBadge} auto-summary saved (${res.durationMs}ms) — ${res.summary ?? ''}`;
    }
    case 'rejected':
      return `Rejected webhook request (HTTP ${record.statusCode}): ${record.reason}`;
    case 'stopped':
      return 'Webhook listener stopped.';
  }
}

function extractSessionId(payload: HookWebhookPayload): string | null {
  const { data } = payload;
  const session = isPlainRecord(data.session)
    ? data.session
    : isPlainRecord(data.closedSession)
      ? data.closedSession
      : null;
  return session && typeof session.id === 'string' ? session.id : null;
}

export function startHookListener(options: HookListenerOptions = {}): Promise<HookListenerHandle> {
  const port = options.port ?? DEFAULT_HOOK_PORT;
  const host = options.host ?? DEFAULT_HOOK_HOST;
  const explicitPath = options.webhookPath ? normalizeWebhookPath(options.webhookPath) : null;
  const advertisedPath = explicitPath ?? DEFAULT_HOOK_PATH;
  const handlers: HookCommandMap = options.handlers ?? {};
  const autoSummary = options.autoSummary?.enabled ? options.autoSummary : undefined;
  const secret = options.secret?.trim() || undefined;
  const timeoutMs = options.timeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS;
  const maxBodyBytes = options.maxBodyBytes ?? 1024 * 1024;
  const baseEnv = options.env ?? process.env;
  const log = options.onLog ?? (() => {});

  const pendingExecutions = new Set<Promise<void>>();
  const recentAutoSummaries = new Map<string, number>();

  const claimAutoSummarySlot = (blockId: string, sessionId: string | null): boolean => {
    const now = Date.now();
    for (const [key, seenAt] of recentAutoSummaries.entries()) {
      if (now - seenAt > AUTO_SUMMARY_DEDUPE_WINDOW_MS) {
        recentAutoSummaries.delete(key);
      }
    }
    const dedupeKey = `${blockId}:${sessionId ?? 'nosession'}`;
    if (recentAutoSummaries.has(dedupeKey)) {
      return false;
    }
    recentAutoSummaries.set(dedupeKey, now);
    return true;
  };

  const server = http.createServer((req, res) => {
    const method = (req.method ?? 'GET').toUpperCase();
    const parsedUrl = new URL(req.url ?? '/', `http://${host}`);
    const pathname = normalizeWebhookPath(parsedUrl.pathname);

    if (method === 'GET' && pathname === '/health') {
      sendJson(res, 200, { ok: true, listening: true });
      return;
    }

    const pathMatches = explicitPath
      ? pathname === explicitPath
      : (DEFAULT_HOOK_ACCEPTED_PATHS as readonly string[]).includes(pathname);

    if (!pathMatches) {
      sendJson(res, 404, {
        error: { code: 'NOT_FOUND', message: `Webhook endpoint is ${advertisedPath}` },
      });
      return;
    }

    if (method !== 'POST') {
      sendJson(res, 405, {
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST for webhook delivery' },
      });
      return;
    }

    void (async () => {
      let rawBody: string;
      try {
        rawBody = await readRequestBody(req, maxBodyBytes);
      } catch (err) {
        const statusCode =
          typeof err === 'object' && err !== null && 'statusCode' in err
            ? Number((err as { statusCode: unknown }).statusCode) || 400
            : 400;
        const reason = err instanceof Error ? err.message : 'Failed to read request body';
        log({ type: 'rejected', statusCode, reason });
        sendJson(res, statusCode, { error: { code: 'INVALID_REQUEST', message: reason } });
        return;
      }

      if (secret) {
        const validSig = verifyWebhookSignature(
          secret,
          rawBody,
          req.headers['x-veyra-signature-256'],
        );
        if (!validSig) {
          const reason = 'Missing or invalid X-Veyra-Signature-256 signature';
          log({ type: 'rejected', statusCode: 401, reason });
          sendJson(res, 401, { error: { code: 'INVALID_SIGNATURE', message: reason } });
          return;
        }
      }

      let rawJson: unknown;
      try {
        rawJson = JSON.parse(rawBody);
      } catch {
        const reason = 'Webhook payload is not valid JSON';
        log({ type: 'rejected', statusCode: 400, reason });
        sendJson(res, 400, { error: { code: 'INVALID_PAYLOAD', message: reason } });
        return;
      }

      const parsed = hookWebhookPayloadSchema.safeParse(rawJson);
      if (!parsed.success) {
        const reason = `Invalid webhook payload: ${parsed.error.message}`;
        log({ type: 'rejected', statusCode: 400, reason });
        sendJson(res, 400, { error: { code: 'INVALID_PAYLOAD', message: reason } });
        return;
      }

      const payload = parsed.data;
      const blockId = extractBlockId(payload);

      if (payload.event === 'webhook.test') {
        log({
          type: 'event',
          event: payload.event,
          timestamp: payload.timestamp,
          blockId: null,
          handled: false,
          status: 'test',
        });
        sendJson(res, 200, { ok: true, event: payload.event, handled: false, test: true });
        return;
      }

      const command = resolveCommandForEvent(payload.event, handlers);
      // A cancelled focus session is discarded, so there is no work to summarize.
      const wasCancelled = payload.event === 'focus.ended' && payload.data.reason === 'cancelled';
      const isAutoSummaryEvent =
        Boolean(autoSummary) &&
        Boolean(blockId) &&
        !wasCancelled &&
        (payload.event === 'focus.ended' || payload.event === 'block.completed');
      const shouldRunAutoSummary =
        isAutoSummaryEvent && blockId
          ? claimAutoSummarySlot(blockId, extractSessionId(payload))
          : false;

      if (!command && !shouldRunAutoSummary) {
        log({
          type: 'event',
          event: payload.event,
          timestamp: payload.timestamp,
          blockId,
          handled: false,
          status: 'skipped',
        });
        sendJson(res, 200, { ok: true, event: payload.event, handled: false });
        return;
      }

      log({
        type: 'event',
        event: payload.event,
        timestamp: payload.timestamp,
        blockId,
        handled: true,
        status: 'received',
        ...(command ? { command } : {}),
        ...(shouldRunAutoSummary ? { autoSummary: true } : {}),
      });

      // Respond promptly with 202 Accepted so Veyra's 5s webhook timeout never trips
      // while longer-running agent scripts or auto-summary LLM calls finish.
      sendJson(res, 202, {
        ok: true,
        event: payload.event,
        handled: true,
        ...(shouldRunAutoSummary ? { autoSummary: true } : {}),
      });

      const env = extractHookEnv(payload, rawBody, baseEnv);

      if (command) {
        const task = executeHookCommand(command, rawBody, env, timeoutMs).then((result) => {
          log({
            type: 'handler_result',
            event: payload.event,
            timestamp: payload.timestamp,
            blockId,
            command,
            ...result,
          });
        });

        pendingExecutions.add(task);
        void task.finally(() => {
          pendingExecutions.delete(task);
        });
      }

      if (shouldRunAutoSummary && autoSummary) {
        const summaryTask = runAutoSummary({
          payload,
          summarizerCmd: autoSummary.summarizerCmd,
          workspaceDirs: autoSummary.workspaceDirs,
          contextCmds: autoSummary.contextCmds,
          collectors: autoSummary.collectors,
          minMinutes: autoSummary.minMinutes ?? DEFAULT_AUTO_SUMMARY_MIN_MINUTES,
          timeoutMs: autoSummary.timeoutMs ?? timeoutMs,
          dryRun: autoSummary.dryRun,
          client: autoSummary.client,
          env,
          runSummarizer: autoSummary.runSummarizer,
        }).then((result) => {
          log({
            type: 'auto_summary_result',
            event: payload.event,
            timestamp: payload.timestamp,
            blockId,
            result,
          });
        });

        pendingExecutions.add(summaryTask);
        void summaryTask.finally(() => {
          pendingExecutions.delete(summaryTask);
        });
      }
    })();
  });

  return new Promise((resolve, reject) => {
    server.once('error', (err) => reject(err));
    server.listen(port, host, () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to bind webhook listener port'));
        return;
      }
      const boundPort = addr.port;
      const url = `http://${host}:${boundPort}${advertisedPath === '/' ? '' : advertisedPath}`;

      log({
        type: 'listening',
        host,
        port: boundPort,
        url,
        handlers: {
          'focus.started': handlers.onFocusStart ?? null,
          'focus.ended': handlers.onFocusEnd ?? null,
          'block.completed': handlers.onComplete ?? null,
          any: handlers.onAny ?? null,
        },
        secretConfigured: Boolean(secret),
        ...(autoSummary ? { autoSummaryEnabled: true } : {}),
      });

      let stopped = false;

      const waitForIdle = async (): Promise<void> => {
        while (pendingExecutions.size > 0) {
          await Promise.allSettled(Array.from(pendingExecutions));
        }
      };

      const stop = async (): Promise<void> => {
        if (stopped) return;
        stopped = true;
        await new Promise<void>((closeResolve) => {
          server.close(() => closeResolve());
          if (typeof server.closeAllConnections === 'function') {
            server.closeAllConnections();
          }
        });
        await waitForIdle();
        log({ type: 'stopped' });
      };

      resolve({
        host,
        port: boundPort,
        url,
        waitForIdle,
        stop,
      });
    });
  });
}
