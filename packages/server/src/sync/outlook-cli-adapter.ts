import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isValidTimeZone } from '@veyra/core';
import { z } from 'zod';
import {
  type CalendarSyncAdapter,
  CalendarSyncError,
  type CalendarSyncWindow,
  type NormalizedCalendarEvent,
} from './types.js';

const execFileAsync = promisify(execFile);

const outlookEventDateObjSchema = z.object({
  dateTime: z.string().min(1),
  timeZone: z.string().optional(),
});

const outlookRawEventSchema = z.object({
  externalId: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
  iCalUId: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  subject: z.string().min(1).optional(),
  startAt: z.string().min(1).optional(),
  start: z.union([z.string().min(1), outlookEventDateObjSchema]).optional(),
  endAt: z.string().min(1).optional(),
  end: z.union([z.string().min(1), outlookEventDateObjSchema]).optional(),
  isAllDay: z.boolean().optional(),
  isDeclined: z.boolean().optional(),
  responseStatus: z
    .union([
      z.string(),
      z.object({
        response: z.string().optional(),
      }),
    ])
    .optional(),
  isCancelled: z.boolean().optional(),
  meetingUrl: z.string().nullable().optional(),
  onlineMeetingUrl: z.string().nullable().optional(),
  onlineMeeting: z
    .object({
      joinUrl: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});

const outlookRawEventArraySchema = z.array(outlookRawEventSchema);

export function splitCommandLine(command: string): string[] {
  const args: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaping = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (escaping) {
      current += ch;
      escaping = false;
      continue;
    }
    if (ch === '\\' && quote !== "'") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current.length > 0) {
        args.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }

  if (escaping) {
    current += '\\';
  }
  if (quote !== null) {
    throw new CalendarSyncError(
      'OUTLOOK_CLI_INVALID_COMMAND',
      `Outlook CLI command has an unclosed ${quote} quote`,
    );
  }
  if (current.length > 0) {
    args.push(current);
  }
  return args;
}

const EXPLICIT_OFFSET_RE = /(?:Z|[+-]\d{2}:?\d{2})$/i;
const WALL_CLOCK_DATETIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/;
const UTC_TIMEZONE_NAMES = new Set(['utc', 'etc/utc', 'gmt', 'etc/gmt']);

function getTimeZoneOffsetMs(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') === 24 ? 0 : get('hour'),
    get('minute'),
    get('second'),
  );
  return asUtc - date.getTime();
}

function parseWallClockInTimeZone(raw: string, timezone: string): number {
  const match = WALL_CLOCK_DATETIME_RE.exec(raw);
  if (!match) {
    return Number.NaN;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] ? Number(match[6]) : 0;
  const ms = match[7] ? Number(match[7].slice(0, 3).padEnd(3, '0')) : 0;

  const utcGuessSec = Date.UTC(year, month - 1, day, hour, minute, second, 0);
  const verify = new Date(utcGuessSec);
  if (
    verify.getUTCFullYear() !== year ||
    verify.getUTCMonth() !== month - 1 ||
    verify.getUTCDate() !== day ||
    verify.getUTCHours() !== hour ||
    verify.getUTCMinutes() !== minute ||
    verify.getUTCSeconds() !== second
  ) {
    return Number.NaN;
  }

  const offset1 = getTimeZoneOffsetMs(new Date(utcGuessSec), timezone);
  const candidateMs = utcGuessSec - offset1;
  const offset2 = getTimeZoneOffsetMs(new Date(candidateMs), timezone);
  const resolvedSecMs = offset2 !== offset1 ? utcGuessSec - offset2 : candidateMs;
  return resolvedSecMs + ms;
}

function extractIsoTimestamp(
  direct: string | undefined,
  fallback: string | { dateTime: string; timeZone?: string } | undefined,
  fieldName: string,
  index: number,
): string {
  const raw = (direct ?? (typeof fallback === 'string' ? fallback : fallback?.dateTime))?.trim();
  if (!raw) {
    throw new CalendarSyncError(
      'OUTLOOK_CLI_SCHEMA_ERROR',
      `Outlook CLI event at index ${index} is missing ${fieldName}`,
    );
  }

  const timeZone =
    direct === undefined && typeof fallback === 'object' && fallback !== null
      ? fallback.timeZone?.trim()
      : undefined;

  let parsedMs: number;
  if (!EXPLICIT_OFFSET_RE.test(raw) && timeZone) {
    if (UTC_TIMEZONE_NAMES.has(timeZone.toLowerCase())) {
      parsedMs = Date.parse(`${raw}Z`);
    } else if (isValidTimeZone(timeZone)) {
      parsedMs = parseWallClockInTimeZone(raw, timeZone);
    } else {
      parsedMs = Date.parse(raw);
    }
  } else {
    parsedMs = Date.parse(raw);
  }

  if (Number.isNaN(parsedMs)) {
    throw new CalendarSyncError(
      'OUTLOOK_CLI_SCHEMA_ERROR',
      `Outlook CLI event at index ${index} has invalid ${fieldName}: '${raw}'`,
    );
  }
  return new Date(parsedMs).toISOString();
}

export interface OutlookCliAdapterOptions {
  command: string;
  timeoutMs?: number;
}

export class OutlookCliAdapter implements CalendarSyncAdapter {
  readonly name = 'outlook_cli' as const;
  private readonly command: string;
  private readonly timeoutMs: number;

  constructor(options: OutlookCliAdapterOptions) {
    this.command = options.command.trim();
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async fetchEvents(window: CalendarSyncWindow): Promise<NormalizedCalendarEvent[]> {
    if (!this.command) {
      throw new CalendarSyncError(
        'OUTLOOK_CLI_NOT_CONFIGURED',
        'Outlook CLI command is empty. Configure outlookCliCommand in Settings.',
      );
    }

    const parts = splitCommandLine(this.command);
    if (parts.length === 0) {
      throw new CalendarSyncError(
        'OUTLOOK_CLI_NOT_CONFIGURED',
        'Outlook CLI command could not be parsed.',
      );
    }

    const [executable, ...baseArgs] = parts;
    const args = [
      ...baseArgs,
      '--start',
      window.startDate,
      '--end',
      window.endDate,
      '--limit',
      '250',
      '--json',
    ];

    let stdout: string;
    try {
      const result = await execFileAsync(executable, args, {
        timeout: this.timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true,
      });
      stdout = result.stdout;
    } catch (err) {
      const e = err as NodeJS.ErrnoException & {
        code?: string | number;
        stderr?: string;
        killed?: boolean;
      };
      const stderrSnippet = e.stderr ? e.stderr.trim().slice(0, 300) : '';
      const detail = e.killed
        ? `timed out after ${this.timeoutMs}ms`
        : stderrSnippet || e.message || String(err);
      throw new CalendarSyncError(
        'OUTLOOK_CLI_EXEC_FAILED',
        `Outlook CLI command '${executable}' failed (code: ${String(e.code ?? 'unknown')}): ${detail}`,
      );
    }

    const trimmed = stdout.trim();
    if (!trimmed) {
      return [];
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(trimmed);
    } catch {
      const preview = trimmed.slice(0, 160).replace(/\s+/g, ' ');
      throw new CalendarSyncError(
        'OUTLOOK_CLI_INVALID_JSON',
        `Outlook CLI did not return valid JSON (ensure the command supports --json). Output preview: "${preview}"`,
      );
    }

    const validated = outlookRawEventArraySchema.safeParse(parsedJson);
    if (!validated.success) {
      const issues = validated.error.issues
        .slice(0, 4)
        .map((i) => `${i.path.join('.') || 'root'}: ${i.message}`)
        .join('; ');
      throw new CalendarSyncError(
        'OUTLOOK_CLI_SCHEMA_ERROR',
        `Outlook CLI JSON output must be an array of calendar events: ${issues}`,
      );
    }

    return validated.data.map((item, idx) => {
      const externalId = item.externalId ?? item.iCalUId ?? item.id;
      if (!externalId) {
        throw new CalendarSyncError(
          'OUTLOOK_CLI_SCHEMA_ERROR',
          `Outlook CLI event at index ${idx} is missing externalId/id`,
        );
      }
      const title = (item.title ?? item.subject ?? '').trim();
      if (!title) {
        throw new CalendarSyncError(
          'OUTLOOK_CLI_SCHEMA_ERROR',
          `Outlook CLI event '${externalId}' is missing title/subject`,
        );
      }

      const startAt = extractIsoTimestamp(item.startAt, item.start, 'startAt', idx);
      const endAt = extractIsoTimestamp(item.endAt, item.end, 'endAt', idx);
      if (Date.parse(endAt) <= Date.parse(startAt)) {
        throw new CalendarSyncError(
          'OUTLOOK_CLI_SCHEMA_ERROR',
          `Outlook CLI event '${externalId}' has endAt <= startAt`,
        );
      }

      const responseStr =
        typeof item.responseStatus === 'string'
          ? item.responseStatus
          : item.responseStatus?.response;
      const isDeclined =
        item.isDeclined === true ||
        item.isCancelled === true ||
        responseStr?.toLowerCase() === 'declined';

      const meetingUrl =
        item.meetingUrl ?? item.onlineMeetingUrl ?? item.onlineMeeting?.joinUrl ?? null;

      return {
        externalId,
        title,
        startAt,
        endAt,
        isAllDay: item.isAllDay === true,
        isDeclined,
        meetingUrl,
      };
    });
  }
}
