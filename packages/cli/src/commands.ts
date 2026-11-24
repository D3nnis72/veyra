import fs from 'node:fs';
import {
  type Block,
  type CalendarEvent,
  type CalendarEventSource,
  type CreateBlockInput,
  type DailyNote,
  type EnergySignal,
  type ExternalLink,
  type FocusSession,
  type FocusStatus,
  type Goal,
  type MoveBlockInput,
  type NormalizedCalendarEvent,
  type Project,
  type ProjectWithStats,
  type RecurrenceRule,
  type RevisitHorizon,
  type UpdateBlockInput,
  type UpdateCalendarEventInput,
  type UpdateGoalInput,
  type UpdateProjectInput,
  type WeeklyReview,
  blockBucketSchema,
  blockStatusSchema,
  calendarEventSourceSchema,
  dateOnlySchema,
  energySignalSchema,
  goalStatusSchema,
  normalizedCalendarEventSchema,
  projectStatusSchema,
  recurrenceRuleSchema,
  revisitHorizonSchema,
} from '@veyra/core/types';
import { Command, CommanderError } from 'commander';
import { z } from 'zod';
import {
  type CalendarResponse,
  type FocusCloseResponse,
  type FocusCompleteResponse,
  type FocusStartResponse,
  type PlanResponse,
  type ReviewResponse,
  type SyncEventsResponse,
  type TodayResponse,
  VeyraApiError,
  VeyraClient,
} from './client.js';
import { loadConfig, saveConfig } from './config.js';
import {
  DEFAULT_HOOK_HOST,
  DEFAULT_HOOK_PORT,
  DEFAULT_HOOK_TIMEOUT_MS,
  formatHookLogHuman,
  startHookListener,
} from './hook-listener.js';

export interface CliIo {
  stdout?: (chunk: string) => void;
  stderr?: (chunk: string) => void;
  env?: NodeJS.ProcessEnv;
  configPath?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

export class CliUsageError extends Error {
  readonly code = 'USAGE_ERROR';

  constructor(message: string) {
    super(message);
    this.name = 'CliUsageError';
  }
}

// ---------------------------------------------------------------------------
// Parsing & normalization helpers
// ---------------------------------------------------------------------------

function collectRepeatable(value: string, previous: string[]): string[] {
  return [...previous, value];
}

export function normalizeRecurrenceRule(raw: string): RecurrenceRule {
  const cleaned = raw.trim().toLowerCase();
  if (cleaned === 'weekdays' || cleaned === 'weekly') {
    return cleaned;
  }

  let candidate: string;
  if (cleaned.startsWith('days:[') && cleaned.endsWith(']')) {
    const inner = cleaned
      .slice('days:['.length, -1)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    candidate = `days:[${inner.join(',')}]`;
  } else {
    const tokens = cleaned
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    candidate = `days:[${tokens.join(',')}]`;
  }

  const parsed = recurrenceRuleSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new CliUsageError(
      `Invalid recurrence rule '${raw}'. Use 'weekdays', 'weekly', 'days:[mon,wed,fri]', or 'mon,wed,fri'.`,
    );
  }
  return parsed.data;
}

export function parseExternalLink(rawUrl: string): ExternalLink {
  const trimmed = rawUrl.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new CliUsageError(`Invalid URL for --link: '${rawUrl}'`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new CliUsageError(`Link URL must use http or https: '${rawUrl}'`);
  }

  const host = parsed.hostname.toLowerCase();
  let source: 'notion' | 'github' | 'web' = 'web';
  if (
    host === 'notion.so' ||
    host.endsWith('.notion.so') ||
    host === 'notion.site' ||
    host.endsWith('.notion.site')
  ) {
    source = 'notion';
  } else if (host === 'github.com' || host.endsWith('.github.com')) {
    source = 'github';
  }

  return {
    url: parsed.toString(),
    title: trimmed,
    source,
  };
}

function formatLocalDate(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  if (!year || !month || !day) {
    throw new CliUsageError(`Failed to format date in timezone '${timezone}'.`);
  }
  return `${year}-${month}-${day}`;
}

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

export function localDateTimeToIso(
  dateStr: string,
  hours: number,
  minutes: number,
  seconds: number,
  timezone: string,
): string {
  const validDate = dateOnlySchema.safeParse(dateStr);
  if (!validDate.success) {
    throw new CliUsageError(`Invalid date '${dateStr}'. Expected YYYY-MM-DD.`);
  }
  const [y, m, d] = dateStr.split('-').map(Number);
  const utcGuess = new Date(Date.UTC(y, m - 1, d, hours, minutes, seconds));
  const offset1 = getTimeZoneOffsetMs(utcGuess, timezone);
  const candidate = new Date(utcGuess.getTime() - offset1);
  const offset2 = getTimeZoneOffsetMs(candidate, timezone);
  const finalDate = offset2 !== offset1 ? new Date(utcGuess.getTime() - offset2) : candidate;
  return finalDate.toISOString();
}

const TIME_ONLY_REGEX = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

export function parseDateTimeOption(
  raw: string,
  flagName: string,
  fallbackDate: string | null,
  timezone: string,
): string {
  const trimmed = raw.trim();
  const timeMatch = TIME_ONLY_REGEX.exec(trimmed);
  if (timeMatch) {
    const hours = Number(timeMatch[1]);
    const minutes = Number(timeMatch[2]);
    const seconds = timeMatch[3] ? Number(timeMatch[3]) : 0;
    if (hours > 23 || minutes > 59 || seconds > 59) {
      throw new CliUsageError(`Invalid time '${raw}' for ${flagName}. Expected HH:MM (00:00-23:59).`);
    }
    if (!fallbackDate) {
      throw new CliUsageError(
        `${flagName} '${raw}' is a clock time and requires --date YYYY-MM-DD (or a full ISO timestamp).`,
      );
    }
    return localDateTimeToIso(fallbackDate, hours, minutes, seconds, timezone);
  }

  const ms = Date.parse(trimmed);
  if (Number.isNaN(ms) || !trimmed.includes('T')) {
    throw new CliUsageError(
      `Invalid timestamp '${raw}' for ${flagName}. Expected HH:MM or ISO-8601 timestamp.`,
    );
  }
  return new Date(ms).toISOString();
}

function validateDateOnly(raw: string, flagName: string): string {
  const parsed = dateOnlySchema.safeParse(raw.trim());
  if (!parsed.success) {
    throw new CliUsageError(`Invalid date '${raw}' for ${flagName}. Expected YYYY-MM-DD.`);
  }
  return parsed.data;
}

function validateRevisit(raw: string): RevisitHorizon {
  const parsed = revisitHorizonSchema.safeParse(raw.trim());
  if (!parsed.success) {
    throw new CliUsageError(
      `Invalid --revisit '${raw}'. Expected next-week, 2w, next-month, next-quarter, or YYYY-MM-DD.`,
    );
  }
  return parsed.data;
}

/** Parses a `--keywords` CSV into trimmed, non-empty keywords ("none" clears). */
function parseKeywordsCsv(raw: string): string[] {
  if (isClearToken(raw)) return [];
  return raw
    .split(',')
    .map((kw) => kw.trim())
    .filter((kw) => kw.length > 0);
}

function isClearToken(raw: string): boolean {
  const lower = raw.trim().toLowerCase();
  return lower === 'none' || lower === 'null' || lower === '';
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function formatBlockLine(block: Block): string {
  const tags: string[] = [];
  if (block.isOps) tags.push('ops');
  if (block.bucket === 'scheduled' && block.scheduledDate) tags.push(block.scheduledDate);
  if (block.bucket === 'later' && block.revisitAt) tags.push(`revisit:${block.revisitAt}`);
  if (block.recurrenceRule) tags.push(`repeat:${block.recurrenceRule}`);
  if (block.status !== 'todo') tags.push(block.status);
  const tagStr = tags.length > 0 ? ` [${tags.join(', ')}]` : '';
  return `- ${block.id}  ${block.title}${tagStr}`;
}

// ---------------------------------------------------------------------------
// Global --json lifting so `--json` works before or after any subcommand
// ---------------------------------------------------------------------------

function extractGlobalJsonFlag(argv: string[]): { jsonMode: boolean; normalizedArgv: string[] } {
  let jsonMode = false;
  const filtered: string[] = [];
  let afterDoubleDash = false;

  for (const arg of argv) {
    if (!afterDoubleDash && arg === '--') {
      afterDoubleDash = true;
      filtered.push(arg);
      continue;
    }
    if (!afterDoubleDash && arg === '--json') {
      jsonMode = true;
      continue;
    }
    filtered.push(arg);
  }

  return { jsonMode, normalizedArgv: filtered };
}

// ---------------------------------------------------------------------------
// Command builder
// ---------------------------------------------------------------------------

export interface ProgramContext {
  jsonMode: boolean;
  writeOut: (text: string) => void;
  writeErr: (text: string) => void;
  getClient: () => VeyraClient;
  env: NodeJS.ProcessEnv;
  configPath?: string;
  signal?: AbortSignal;
}

export function createProgram(ctx: ProgramContext): Command {
  const program = new Command();

  const emit = <T>(data: T, formatHuman: (d: T) => string) => {
    if (ctx.jsonMode) {
      ctx.writeOut(`${JSON.stringify(data, null, 2)}\n`);
    } else {
      ctx.writeOut(`${formatHuman(data)}\n`);
    }
  };

  program
    .name('veyra')
    .description('Veyra personal work cockpit CLI')
    .version('0.1.0')
    .option('--json', 'Output machine-readable JSON')
    .showHelpAfterError(false)
    .configureOutput({
      writeOut: (str) => ctx.writeOut(str),
      writeErr: (str) => {
        if (!ctx.jsonMode) {
          ctx.writeErr(str);
        }
      },
    })
    .exitOverride();

  // -------------------------------------------------------------------------
  // Read Commands
  // -------------------------------------------------------------------------

  program
    .command('today')
    .description('Show Today focus, up-next blocks, events, and weekly rule')
    .action(async () => {
      const data = await ctx.getClient().today();
      emit<TodayResponse>(data, (d) => {
        const lines: string[] = [`Today (${d.date}, ${d.timezone})`];
        if (d.weeklyRule) lines.push(`Rule: ${d.weeklyRule}`);
        if (d.focusStatus.activeBlock) {
          const mins = Math.floor(d.focusStatus.elapsedSeconds / 60);
          lines.push(
            `Active focus: ${d.focusStatus.activeBlock.title} (${mins}m elapsed, ${d.focusStatus.focusedTodayMinutes}m today)`,
          );
        } else {
          lines.push(`Focused today: ${formatDuration(d.focusStatus.focusedTodayMinutes)}`);
        }
        lines.push(`Up next (${d.upNext.length}):`);
        for (const blk of d.upNext) lines.push(`  ${formatBlockLine(blk)}`);
        if (d.completedToday.length > 0) {
          lines.push(`Completed today (${d.completedToday.length}):`);
          for (const blk of d.completedToday) lines.push(`  ${formatBlockLine(blk)}`);
        }
        if (d.upcomingEvents.length > 0) {
          lines.push(`Upcoming events (${d.upcomingEvents.length}):`);
          for (const ev of d.upcomingEvents) {
            lines.push(`  - ${ev.id}  ${ev.title} (${ev.startAt} -> ${ev.endAt})`);
          }
        }
        return lines.join('\n');
      });
    });

  program
    .command('plan')
    .description('Show weekly plan across days, Inbox, and Later')
    .option('--week <YYYY-MM-DD>', 'Any date within the target week')
    .action(async (opts: { week?: string }) => {
      const weekStart = opts.week ? validateDateOnly(opts.week, '--week') : undefined;
      const data = await ctx.getClient().plan(weekStart);
      emit<PlanResponse>(data, (d) => {
        const lines: string[] = [`Week ${d.weekStartDate} .. ${d.weekEndDate} (today: ${d.today})`];
        for (const day of d.days) {
          lines.push(`${day.date} (${day.blocks.length} blocks, ${day.events.length} events)`);
          for (const blk of day.blocks) lines.push(`  ${formatBlockLine(blk)}`);
        }
        lines.push(`Inbox (${d.inbox.length}) | Later (${d.later.length})`);
        return lines.join('\n');
      });
    });

  program
    .command('calendar')
    .description('Show focus sessions, planned blocks, and calendar events for a date range')
    .option('--start <YYYY-MM-DD>', 'Range start date')
    .option('--end <YYYY-MM-DD>', 'Range end date')
    .action(async (opts: { start?: string; end?: string }) => {
      const start = opts.start ? validateDateOnly(opts.start, '--start') : undefined;
      const end = opts.end ? validateDateOnly(opts.end, '--end') : undefined;
      const data = await ctx.getClient().calendar(start, end);
      emit<CalendarResponse>(data, (d) => {
        const lines = [
          `Calendar ${d.startDate} .. ${d.endDate}: ${d.sessions.length} sessions, ${d.plannedBlocks.length} planned blocks, ${d.events.length} events`,
        ];
        return lines.join('\n');
      });
    });

  program
    .command('projects')
    .description('List projects with weekly focus stats')
    .option('--status <status>', 'Filter by status (active|paused|archived)')
    .option('--all', 'Include archived projects')
    .action(async (opts: { status?: string; all?: boolean }) => {
      let status: Project['status'] | undefined;
      if (opts.status) {
        const parsed = projectStatusSchema.safeParse(opts.status);
        if (!parsed.success) {
          throw new CliUsageError(`Invalid --status '${opts.status}'. Expected active, paused, or archived.`);
        }
        status = parsed.data;
      }
      const data = await ctx.getClient().listProjects({
        status,
        includeArchived: opts.all ? true : undefined,
      });
      emit<{ projects: ProjectWithStats[] }>(data, (d) => {
        if (d.projects.length === 0) return 'No projects found.';
        return d.projects
          .map(
            (p) =>
              `- ${p.id}  ${p.name} [${p.status}] (${p.openBlockCount} open, ${formatDuration(p.weeklyFocusMinutes)} this week${p.isQuiet ? ', quiet' : ''})`,
          )
          .join('\n');
      });
    });

  program
    .command('goals')
    .description('List goals')
    .option('--status <status>', 'Filter by status (active|achieved|archived)')
    .option('--all', 'Include archived goals')
    .action(async (opts: { status?: string; all?: boolean }) => {
      let status: Goal['status'] | undefined;
      if (opts.status) {
        const parsed = goalStatusSchema.safeParse(opts.status);
        if (!parsed.success) {
          throw new CliUsageError(`Invalid --status '${opts.status}'. Expected active, achieved, or archived.`);
        }
        status = parsed.data;
      }
      const data = await ctx.getClient().listGoals({
        status,
        includeArchived: opts.all ? true : undefined,
      });
      emit<{ goals: Goal[] }>(data, (d) => {
        if (d.goals.length === 0) return 'No goals found.';
        return d.goals.map((g) => `- ${g.id}  ${g.name} [${g.status}]`).join('\n');
      });
    });

  program
    .command('inbox')
    .description('List open Inbox blocks')
    .action(async () => {
      const data = await ctx.getClient().listBlocks({ bucket: 'inbox', status: 'todo' });
      emit<{ blocks: Block[] }>(data, (d) => {
        if (d.blocks.length === 0) return 'Inbox is empty.';
        return d.blocks.map(formatBlockLine).join('\n');
      });
    });

  program
    .command('later')
    .description('List open Later blocks')
    .action(async () => {
      const data = await ctx.getClient().listBlocks({ bucket: 'later', status: 'todo' });
      emit<{ blocks: Block[] }>(data, (d) => {
        if (d.blocks.length === 0) return 'Later bucket is empty.';
        return d.blocks.map(formatBlockLine).join('\n');
      });
    });

  program
    .command('show <id>')
    .alias('block')
    .description('Show full detail and focus sessions for a block')
    .action(async (id: string) => {
      const { block } = await ctx.getClient().getBlock(id);
      emit(block, (b) => {
        const lines = [
          `${b.title} (${b.id})`,
          `Status: ${b.status} | Bucket: ${b.bucket}${b.scheduledDate ? ` (${b.scheduledDate})` : ''} | Focus: ${formatDuration(b.totalFocusMinutes)}`,
        ];
        if (b.notes) lines.push(`Notes: ${b.notes}`);
        if (b.autoSummary) lines.push(`Summary: ${b.autoSummary}`);
        return lines.join('\n');
      });
    });

  // -------------------------------------------------------------------------
  // Plan & Prune Commands
  // -------------------------------------------------------------------------

  program
    .command('add <title>')
    .description('Create a new block')
    .option('--project <idOrName>', 'Project UUID or name')
    .option('--goal <idOrName>', 'Goal UUID or name')
    .option('--ops', 'Mark block as operational / unplanned work')
    .option('--date <YYYY-MM-DD>', 'Schedule for a specific date (sets bucket to scheduled)')
    .option('--start <timeOrIso>', 'Planned start time (HH:MM or ISO timestamp)')
    .option('--end <timeOrIso>', 'Planned end time (HH:MM or ISO timestamp)')
    .option('--bucket <bucket>', 'Target bucket (inbox|scheduled|later)')
    .option('--due <YYYY-MM-DD>', 'Due date')
    .option('--revisit <horizon>', 'Revisit horizon (next-week|2w|next-month|next-quarter|YYYY-MM-DD)')
    .option('--repeat <rule>', 'Recurrence rule (weekdays|weekly|days:[mon,wed,fri]|mon,wed,fri)')
    .option('--notes <text>', 'Block notes')
    .option('--link <url>', 'Attach external link (repeatable)', collectRepeatable, [])
    .action(
      async (
        title: string,
        opts: {
          project?: string;
          goal?: string;
          ops?: boolean;
          date?: string;
          start?: string;
          end?: string;
          bucket?: string;
          due?: string;
          revisit?: string;
          repeat?: string;
          notes?: string;
          link: string[];
        },
      ) => {
        const client = ctx.getClient();
        const payload: CreateBlockInput = {
          title,
          ...(opts.ops ? { isOps: true } : {}),
          ...(opts.notes !== undefined ? { notes: opts.notes } : {}),
        };

        if (opts.project) {
          payload.projectId = await client.resolveProjectId(opts.project);
        }
        if (opts.goal) {
          payload.goalId = await client.resolveGoalId(opts.goal);
        }
        if (opts.due) {
          payload.dueDate = validateDateOnly(opts.due, '--due');
        }
        if (opts.revisit) {
          payload.revisitAt = validateRevisit(opts.revisit);
        }
        if (opts.repeat) {
          payload.recurrenceRule = normalizeRecurrenceRule(opts.repeat);
        }
        if (opts.link.length > 0) {
          payload.externalLinks = opts.link.map(parseExternalLink);
        }

        const scheduledDate = opts.date ? validateDateOnly(opts.date, '--date') : undefined;
        if (scheduledDate) {
          payload.scheduledDate = scheduledDate;
        }

        if (opts.start || opts.end) {
          if (!opts.start || !opts.end) {
            throw new CliUsageError('Both --start and --end must be provided together.');
          }
          const { settings } = await client.getSettings();
          const nowDate = ctx.env.VEYRA_NOW ? new Date(ctx.env.VEYRA_NOW) : new Date();
          const fallbackDate = scheduledDate ?? formatLocalDate(nowDate, settings.timezone);
          payload.plannedStartAt = parseDateTimeOption(
            opts.start,
            '--start',
            fallbackDate,
            settings.timezone,
          );
          payload.plannedEndAt = parseDateTimeOption(
            opts.end,
            '--end',
            fallbackDate,
            settings.timezone,
          );
          if (!payload.scheduledDate) {
            payload.scheduledDate = fallbackDate;
          }
        }

        if (opts.bucket) {
          const parsedBucket = blockBucketSchema.safeParse(opts.bucket);
          if (!parsedBucket.success) {
            throw new CliUsageError(
              `Invalid --bucket '${opts.bucket}'. Expected inbox, scheduled, or later.`,
            );
          }
          payload.bucket = parsedBucket.data;
        } else if (scheduledDate || payload.plannedStartAt || payload.recurrenceRule) {
          payload.bucket = 'scheduled';
        } else if (payload.revisitAt) {
          payload.bucket = 'later';
        } else {
          payload.bucket = 'inbox';
        }

        const { block } = await client.createBlock(payload);
        emit<Block>(block, (b) => `Created block ${formatBlockLine(b)}`);
      },
    );

  program
    .command('update <id>')
    .description('Update fields on an existing block')
    .option('--title <title>', 'New block title')
    .option('--project <idOrName>', 'Project UUID or name')
    .option('--goal <idOrName>', 'Goal UUID, name, or "none" to clear')
    .option('--ops', 'Mark block as Ops')
    .option('--no-ops', 'Clear Ops flag')
    .option('--bucket <bucket>', 'Target bucket (inbox|scheduled|later)')
    .option('--date <YYYY-MM-DD>', 'Scheduled date')
    .option('--due <YYYY-MM-DD>', 'Due date (or "none" to clear)')
    .option('--revisit <horizon>', 'Revisit horizon (or "none" to clear)')
    .option('--repeat <rule>', 'Recurrence rule')
    .option('--no-repeat', 'Remove recurrence rule')
    .option('--notes <text>', 'Block notes')
    .option('--link <url>', 'Replace external links (repeatable)', collectRepeatable, [])
    .option('--status <status>', 'Block status (todo|done|dropped)')
    .option('--summary <text>', 'Auto summary text')
    .action(
      async (
        id: string,
        opts: {
          title?: string;
          project?: string;
          goal?: string;
          ops?: boolean;
          bucket?: string;
          date?: string;
          due?: string;
          revisit?: string;
          repeat?: string | false;
          notes?: string;
          link: string[];
          status?: string;
          summary?: string;
        },
      ) => {
        const client = ctx.getClient();
        const payload: UpdateBlockInput = {};

        if (opts.title !== undefined) payload.title = opts.title;
        if (opts.project !== undefined) {
          payload.projectId = await client.resolveProjectId(opts.project);
        }
        if (opts.goal !== undefined) {
          payload.goalId = isClearToken(opts.goal) ? null : await client.resolveGoalId(opts.goal);
        }
        if (opts.ops !== undefined) payload.isOps = opts.ops;
        if (opts.bucket !== undefined) {
          const parsed = blockBucketSchema.safeParse(opts.bucket);
          if (!parsed.success) {
            throw new CliUsageError(
              `Invalid --bucket '${opts.bucket}'. Expected inbox, scheduled, or later.`,
            );
          }
          payload.bucket = parsed.data;
        }
        if (opts.date !== undefined) {
          payload.scheduledDate = isClearToken(opts.date)
            ? null
            : validateDateOnly(opts.date, '--date');
        }
        if (opts.due !== undefined) {
          payload.dueDate = isClearToken(opts.due) ? null : validateDateOnly(opts.due, '--due');
        }
        if (opts.revisit !== undefined) {
          payload.revisitAt = isClearToken(opts.revisit) ? null : validateRevisit(opts.revisit);
        }
        if (opts.repeat === false) {
          payload.recurrenceRule = null;
        } else if (typeof opts.repeat === 'string') {
          payload.recurrenceRule = normalizeRecurrenceRule(opts.repeat);
        }
        if (opts.notes !== undefined) payload.notes = opts.notes;
        if (opts.link.length > 0) {
          payload.externalLinks = opts.link.map(parseExternalLink);
        }
        if (opts.status !== undefined) {
          const parsed = blockStatusSchema.safeParse(opts.status);
          if (!parsed.success) {
            throw new CliUsageError(`Invalid --status '${opts.status}'. Expected todo, done, or dropped.`);
          }
          payload.status = parsed.data;
        }
        if (opts.summary !== undefined) payload.autoSummary = opts.summary;

        const { block } = await client.updateBlock(id, payload);
        emit<Block>(block, (b) => `Updated block ${formatBlockLine(b)}`);
      },
    );

  program
    .command('move <id>')
    .description('Move a block between buckets, dates, or planned time slots')
    .option('--date <YYYY-MM-DD>', 'Target scheduled date')
    .option('--start <timeOrIso>', 'Planned start time (HH:MM or ISO timestamp)')
    .option('--end <timeOrIso>', 'Planned end time (HH:MM or ISO timestamp)')
    .option('--bucket <bucket>', 'Target bucket (inbox|scheduled|later)')
    .option('--revisit <horizon>', 'Revisit horizon when moving to Later')
    .option('--clear-time', 'Clear plannedStartAt and plannedEndAt')
    .action(
      async (
        id: string,
        opts: {
          date?: string;
          start?: string;
          end?: string;
          bucket?: string;
          revisit?: string;
          clearTime?: boolean;
        },
      ) => {
        const client = ctx.getClient();
        const payload: MoveBlockInput = {};

        if (opts.bucket) {
          const parsed = blockBucketSchema.safeParse(opts.bucket);
          if (!parsed.success) {
            throw new CliUsageError(
              `Invalid --bucket '${opts.bucket}'. Expected inbox, scheduled, or later.`,
            );
          }
          payload.bucket = parsed.data;
        }

        const scheduledDate = opts.date ? validateDateOnly(opts.date, '--date') : undefined;
        if (scheduledDate) {
          payload.scheduledDate = scheduledDate;
          if (!payload.bucket) {
            payload.bucket = 'scheduled';
          }
        }

        if (opts.revisit) {
          payload.revisitAt = validateRevisit(opts.revisit);
        }

        if (opts.clearTime) {
          payload.plannedStartAt = null;
          payload.plannedEndAt = null;
        } else if (opts.start || opts.end) {
          if (!opts.start || !opts.end) {
            throw new CliUsageError('Both --start and --end must be provided together.');
          }
          const { settings } = await client.getSettings();
          let fallbackDate = scheduledDate ?? null;
          if (!fallbackDate) {
            const existing = await client.getBlock(id);
            fallbackDate =
              existing.block.scheduledDate ??
              formatLocalDate(
                ctx.env.VEYRA_NOW ? new Date(ctx.env.VEYRA_NOW) : new Date(),
                settings.timezone,
              );
          }
          payload.plannedStartAt = parseDateTimeOption(
            opts.start,
            '--start',
            fallbackDate,
            settings.timezone,
          );
          payload.plannedEndAt = parseDateTimeOption(
            opts.end,
            '--end',
            fallbackDate,
            settings.timezone,
          );
          if (!payload.bucket) {
            payload.bucket = 'scheduled';
          }
        }

        const { block } = await client.moveBlock(id, payload);
        emit<Block>(block, (b) => `Moved block ${formatBlockLine(b)}`);
      },
    );

  program
    .command('reorder <id>')
    .description('Reorder a block relative to sibling blocks or orderKeys')
    .option('--before <blockId>', 'ID of block immediately before the target slot (moves after it)')
    .option('--after <blockId>', 'ID of block immediately after the target slot (moves before it)')
    .option('--before-key <orderKey>', 'Explicit preceding orderKey')
    .option('--after-key <orderKey>', 'Explicit following orderKey')
    .action(
      async (
        id: string,
        opts: { before?: string; after?: string; beforeKey?: string; afterKey?: string },
      ) => {
        if (!opts.before && !opts.after && !opts.beforeKey && !opts.afterKey) {
          throw new CliUsageError(
            'Provide at least one of --before, --after, --before-key, or --after-key.',
          );
        }
        const { block } = await ctx.getClient().reorderBlock(id, {
          ...(opts.before ? { beforeId: opts.before } : {}),
          ...(opts.after ? { afterId: opts.after } : {}),
          ...(opts.beforeKey ? { beforeOrderKey: opts.beforeKey } : {}),
          ...(opts.afterKey ? { afterOrderKey: opts.afterKey } : {}),
        });
        emit<Block>(block, (b) => `Reordered block ${b.id} (orderKey=${b.orderKey})`);
      },
    );

  program
    .command('park <id>')
    .description('Park a block into Later with an optional revisit horizon')
    .option('--revisit <horizon>', 'Revisit horizon (next-week|2w|next-month|next-quarter|YYYY-MM-DD)')
    .action(async (id: string, opts: { revisit?: string }) => {
      const revisitAt = opts.revisit ? validateRevisit(opts.revisit) : undefined;
      const { block } = await ctx.getClient().parkBlock(id, revisitAt ? { revisitAt } : {});
      emit<Block>(block, (b) => `Parked block ${formatBlockLine(b)}`);
    });

  program
    .command('drop <id>')
    .description('Drop a block (optionally stopping its recurring series)')
    .option('--stop-series', 'Clear recurrence rule across the entire series')
    .action(async (id: string, opts: { stopSeries?: boolean }) => {
      const { block } = await ctx.getClient().dropBlock(id, {
        stopSeries: Boolean(opts.stopSeries),
      });
      emit<Block>(block, (b) => `Dropped block ${b.id} ("${b.title}")`);
    });

  program
    .command('reopen <id>')
    .description('Reopen a completed or dropped block')
    .action(async (id: string) => {
      const { block } = await ctx.getClient().reopenBlock(id);
      emit<Block>(block, (b) => `Reopened block ${formatBlockLine(b)}`);
    });

  // Project create / update
  const projectCmd = program.command('project').description('Create or update projects');

  projectCmd
    .command('create <name>')
    .description('Create a new project')
    .option('--description <text>', 'Project description')
    .option('--color <hex>', 'Accent hex color')
    .option('--icon <key>', 'Project icon key')
    .option('--goal <idOrName>', 'Default goal UUID or name')
    .option('--pinned', 'Pin project to top')
    .option('--status <status>', 'Initial status (active|paused|archived)')
    .option('--notion-url <url>', 'Linked Notion URL')
    .option('--keywords <csv>', 'Calendar sync keywords that auto-match meetings by title (comma-separated)')
    .action(
      async (
        name: string,
        opts: {
          description?: string;
          color?: string;
          icon?: string;
          goal?: string;
          pinned?: boolean;
          status?: string;
          notionUrl?: string;
          keywords?: string;
        },
      ) => {
        const client = ctx.getClient();
        let defaultGoalId: string | null | undefined;
        if (opts.goal) {
          defaultGoalId = await client.resolveGoalId(opts.goal);
        }
        let status: Project['status'] | undefined;
        if (opts.status) {
          const parsed = projectStatusSchema.safeParse(opts.status);
          if (!parsed.success) {
            throw new CliUsageError(`Invalid --status '${opts.status}'. Expected active, paused, or archived.`);
          }
          status = parsed.data;
        }
        const { project } = await client.createProject({
          name,
          ...(opts.description !== undefined ? { description: opts.description } : {}),
          ...(opts.color !== undefined ? { color: opts.color } : {}),
          ...(opts.icon !== undefined ? { icon: opts.icon } : {}),
          ...(defaultGoalId !== undefined ? { defaultGoalId } : {}),
          ...(opts.pinned ? { isPinned: true } : {}),
          ...(status !== undefined ? { status } : {}),
          ...(opts.notionUrl !== undefined ? { notionUrl: opts.notionUrl } : {}),
          ...(opts.keywords !== undefined ? { matchKeywords: parseKeywordsCsv(opts.keywords) } : {}),
        });
        emit<Project>(project, (p) => `Created project ${p.id}  ${p.name}`);
      },
    );

  projectCmd
    .command('update <idOrName>')
    .description('Update an existing project')
    .option('--name <name>', 'New project name')
    .option('--description <text>', 'Project description')
    .option('--color <hex>', 'Accent hex color')
    .option('--icon <key>', 'Project icon key (or "none" to clear)')
    .option('--goal <idOrName>', 'Default goal UUID, name, or "none" to clear')
    .option('--pinned', 'Pin project')
    .option('--no-pinned', 'Unpin project')
    .option('--status <status>', 'Project status (active|paused|archived)')
    .option('--notion-url <url>', 'Linked Notion URL (or "none" to clear)')
    .option('--keywords <csv>', 'Calendar sync keywords, comma-separated (or "none" to clear)')
    .action(
      async (
        idOrName: string,
        opts: {
          name?: string;
          description?: string;
          color?: string;
          icon?: string;
          goal?: string;
          pinned?: boolean;
          status?: string;
          notionUrl?: string;
          keywords?: string;
        },
      ) => {
        const client = ctx.getClient();
        const projectId = await client.resolveProjectId(idOrName);
        const payload: UpdateProjectInput = {};
        if (opts.name !== undefined) payload.name = opts.name;
        if (opts.description !== undefined) payload.description = opts.description;
        if (opts.color !== undefined) payload.color = opts.color;
        if (opts.icon !== undefined) payload.icon = isClearToken(opts.icon) ? null : opts.icon;
        if (opts.goal !== undefined) {
          payload.defaultGoalId = isClearToken(opts.goal)
            ? null
            : await client.resolveGoalId(opts.goal);
        }
        if (opts.pinned !== undefined) payload.isPinned = opts.pinned;
        if (opts.status !== undefined) {
          const parsed = projectStatusSchema.safeParse(opts.status);
          if (!parsed.success) {
            throw new CliUsageError(`Invalid --status '${opts.status}'. Expected active, paused, or archived.`);
          }
          payload.status = parsed.data;
        }
        if (opts.notionUrl !== undefined) {
          payload.notionUrl = isClearToken(opts.notionUrl) ? null : opts.notionUrl;
        }
        if (opts.keywords !== undefined) {
          payload.matchKeywords = parseKeywordsCsv(opts.keywords);
        }

        const { project } = await client.updateProject(projectId, payload);
        emit<Project>(project, (p) => `Updated project ${p.id}  ${p.name} [${p.status}]`);
      },
    );

  // Goal create / update
  const goalCmd = program.command('goal').description('Create or update goals');

  goalCmd
    .command('create <name>')
    .description('Create a new goal')
    .option('--description <text>', 'Goal description')
    .option('--color <hex>', 'Goal accent hex color')
    .option('--status <status>', 'Goal status (active|achieved|archived)')
    .action(async (name: string, opts: { description?: string; color?: string; status?: string }) => {
      let status: Goal['status'] | undefined;
      if (opts.status) {
        const parsed = goalStatusSchema.safeParse(opts.status);
        if (!parsed.success) {
          throw new CliUsageError(`Invalid --status '${opts.status}'. Expected active, achieved, or archived.`);
        }
        status = parsed.data;
      }
      const { goal } = await ctx.getClient().createGoal({
        name,
        ...(opts.description !== undefined ? { description: opts.description } : {}),
        ...(opts.color !== undefined ? { color: opts.color } : {}),
        ...(status !== undefined ? { status } : {}),
      });
      emit<Goal>(goal, (g) => `Created goal ${g.id}  ${g.name}`);
    });

  goalCmd
    .command('update <idOrName>')
    .description('Update an existing goal')
    .option('--name <name>', 'New goal name')
    .option('--description <text>', 'Goal description')
    .option('--color <hex>', 'Goal accent hex color')
    .option('--status <status>', 'Goal status (active|achieved|archived)')
    .action(
      async (
        idOrName: string,
        opts: { name?: string; description?: string; color?: string; status?: string },
      ) => {
        const client = ctx.getClient();
        const goalId = await client.resolveGoalId(idOrName);
        const payload: UpdateGoalInput = {};
        if (opts.name !== undefined) payload.name = opts.name;
        if (opts.description !== undefined) payload.description = opts.description;
        if (opts.color !== undefined) payload.color = opts.color;
        if (opts.status !== undefined) {
          const parsed = goalStatusSchema.safeParse(opts.status);
          if (!parsed.success) {
            throw new CliUsageError(`Invalid --status '${opts.status}'. Expected active, achieved, or archived.`);
          }
          payload.status = parsed.data;
        }
        const { goal } = await client.updateGoal(goalId, payload);
        emit<Goal>(goal, (g) => `Updated goal ${g.id}  ${g.name} [${g.status}]`);
      },
    );

  // -------------------------------------------------------------------------
  // Focus & Sessions Commands
  // -------------------------------------------------------------------------

  const focusCmd = program
    .command('focus')
    .description('Inspect current focus timer state')
    .action(async () => {
      const data = await ctx.getClient().getFocus();
      emit<FocusStatus>(data, formatFocusStatus);
    });

  focusCmd
    .command('status')
    .description('Show active focus session and today total')
    .action(async () => {
      const data = await ctx.getClient().getFocus();
      emit<FocusStatus>(data, formatFocusStatus);
    });

  program
    .command('start <id>')
    .description('Start focusing on a block (auto-closes any active session)')
    .action(async (id: string) => {
      const data = await ctx.getClient().startFocus(id);
      emit<FocusStartResponse>(
        data,
        (d) => `Started focus on "${d.block.title}" (session ${d.startedSession.id})`,
      );
    });

  program
    .command('pause')
    .description('Pause the active focus session with an optional resume note')
    .option('--note <text>', 'Where you left off')
    .action(async (opts: { note?: string }) => {
      const data = await ctx.getClient().pauseFocus(opts.note);
      emit<FocusCloseResponse>(
        data,
        (d) =>
          `Paused focus on "${d.block.title}"${d.closedSession.note ? ` — ${d.closedSession.note}` : ''}`,
      );
    });

  program
    .command('resume <id>')
    .description('Resume focusing on a block')
    .action(async (id: string) => {
      const data = await ctx.getClient().resumeFocus(id);
      emit<FocusStartResponse>(
        data,
        (d) => `Resumed focus on "${d.block.title}" (session ${d.startedSession.id})`,
      );
    });

  program
    .command('stop')
    .description('Stop the active focus session without completing the block')
    .action(async () => {
      const data = await ctx.getClient().stopFocus();
      emit<FocusCloseResponse>(data, (d) => `Stopped focus on "${d.block.title}"`);
    });

  program
    .command('done [id]')
    .description('Complete the active focus block or a specified block ID')
    .option('--energy <signal>', 'Energy signal (up|neutral|down)')
    .option('--outcome <text>', 'Short outcome note')
    .action(async (id: string | undefined, opts: { energy?: string; outcome?: string }) => {
      let energySignal: EnergySignal | undefined;
      if (opts.energy !== undefined) {
        const parsed = energySignalSchema.safeParse(opts.energy);
        if (!parsed.success) {
          throw new CliUsageError(`Invalid --energy '${opts.energy}'. Expected up, neutral, or down.`);
        }
        energySignal = parsed.data;
      }
      const data = await ctx.getClient().completeFocus({
        ...(id ? { blockId: id } : {}),
        ...(energySignal !== undefined ? { energySignal } : {}),
        ...(opts.outcome !== undefined ? { outcomeNote: opts.outcome } : {}),
      });
      emit<FocusCompleteResponse>(
        data,
        (d) =>
          `Completed "${d.block.title}" (${formatDuration(d.totalBlockMinutes)} total${d.block.energySignal ? `, energy=${d.block.energySignal}` : ''})`,
      );
    });

  const summaryCmd = program.command('summary').description('Manage block summaries');
  summaryCmd
    .command('set <id> <text>')
    .description('Set autoSummary on a block')
    .action(async (id: string, text: string) => {
      const { block } = await ctx.getClient().updateBlock(id, { autoSummary: text });
      emit<Block>(block, (b) => `Set summary on ${b.id}: ${b.autoSummary ?? ''}`);
    });

  summaryCmd
    .command('clear <id>')
    .description('Clear autoSummary on a block')
    .action(async (id: string) => {
      const { block } = await ctx.getClient().updateBlock(id, { autoSummary: null });
      emit<Block>(block, (b) => `Cleared summary on ${b.id}`);
    });

  // -------------------------------------------------------------------------
  // Event Hook Listener Command
  // -------------------------------------------------------------------------

  const hookCmd = program.command('hook').description('Listen for Veyra lifecycle webhooks');

  hookCmd
    .command('listen')
    .description(
      'Run a local HTTP webhook listener that forwards Veyra events to shell commands or agent scripts',
    )
    .option('--port <port>', 'Port to listen on', String(DEFAULT_HOOK_PORT))
    .option('--host <host>', 'Host interface to bind', DEFAULT_HOOK_HOST)
    .option('--path <path>', 'Webhook URL path (defaults to accepting / and /webhook)')
    .option('--on-focus-start <cmd>', 'Shell command to execute on focus.started')
    .option('--on-focus-end <cmd>', 'Shell command to execute on focus.ended')
    .option('--on-complete <cmd>', 'Shell command to execute on block.completed')
    .option('--on-any <cmd>', 'Fallback shell command for any unhandled lifecycle event')
    .option(
      '--secret <secret>',
      'HMAC-SHA256 signing secret (defaults to VEYRA_WEBHOOK_SECRET env var)',
    )
    .option(
      '--timeout <ms>',
      'Handler command timeout in milliseconds',
      String(DEFAULT_HOOK_TIMEOUT_MS),
    )
    .action(
      async (opts: {
        port: string;
        host: string;
        path?: string;
        onFocusStart?: string;
        onFocusEnd?: string;
        onComplete?: string;
        onAny?: string;
        secret?: string;
        timeout: string;
      }) => {
        const port = Number.parseInt(opts.port, 10);
        if (Number.isNaN(port) || port < 0 || port > 65535) {
          throw new CliUsageError(`Invalid --port '${opts.port}'. Expected an integer 0-65535.`);
        }
        const timeoutMs = Number.parseInt(opts.timeout, 10);
        if (Number.isNaN(timeoutMs) || timeoutMs < 100) {
          throw new CliUsageError(
            `Invalid --timeout '${opts.timeout}'. Expected an integer >= 100 (ms).`,
          );
        }

        const secret =
          opts.secret !== undefined ? opts.secret : ctx.env.VEYRA_WEBHOOK_SECRET;

        const handle = await startHookListener({
          port,
          host: opts.host,
          webhookPath: opts.path,
          handlers: {
            onFocusStart: opts.onFocusStart,
            onFocusEnd: opts.onFocusEnd,
            onComplete: opts.onComplete,
            onAny: opts.onAny,
          },
          secret,
          timeoutMs,
          env: ctx.env,
          onLog: (record) => {
            if (ctx.jsonMode) {
              ctx.writeOut(`${JSON.stringify(record)}\n`);
            } else {
              ctx.writeOut(`${formatHookLogHuman(record)}\n`);
            }
          },
        });

        await new Promise<void>((resolve) => {
          let closing = false;
          const shutdown = () => {
            if (closing) return;
            closing = true;
            process.off('SIGINT', shutdown);
            process.off('SIGTERM', shutdown);
            ctx.signal?.removeEventListener('abort', shutdown);
            void handle.stop().finally(() => resolve());
          };

          if (ctx.signal?.aborted) {
            shutdown();
            return;
          }

          process.once('SIGINT', shutdown);
          process.once('SIGTERM', shutdown);
          ctx.signal?.addEventListener('abort', shutdown, { once: true });
        });
      },
    );

  const sessionCmd = program.command('session').description('Log, trim, split, or delete focus sessions');

  sessionCmd
    .command('log <blockId>')
    .description('Log a manual completed focus session')
    .requiredOption('--start <iso>', 'Session start ISO timestamp')
    .requiredOption('--end <iso>', 'Session end ISO timestamp')
    .option('--note <text>', 'Optional session note')
    .action(async (blockId: string, opts: { start: string; end: string; note?: string }) => {
      const { session } = await ctx.getClient().logSession({
        blockId,
        startedAt: opts.start,
        endedAt: opts.end,
        ...(opts.note !== undefined ? { note: opts.note } : {}),
      });
      emit<FocusSession>(
        session,
        (s) => `Logged session ${s.id} (${s.startedAt} -> ${s.endedAt ?? 'active'})`,
      );
    });

  sessionCmd
    .command('trim <sessionId>')
    .description('Trim a focus session start/end timestamps')
    .requiredOption('--start <iso>', 'New start ISO timestamp')
    .requiredOption('--end <iso>', 'New end ISO timestamp')
    .option('--note <text>', 'Updated session note')
    .action(async (sessionId: string, opts: { start: string; end: string; note?: string }) => {
      const { session } = await ctx.getClient().trimSession(sessionId, {
        startedAt: opts.start,
        endedAt: opts.end,
        ...(opts.note !== undefined ? { note: opts.note } : {}),
      });
      emit<FocusSession>(
        session,
        (s) => `Trimmed session ${s.id} (${s.startedAt} -> ${s.endedAt ?? 'active'})`,
      );
    });

  sessionCmd
    .command('split <sessionId>')
    .description('Split a closed focus session around a break')
    .requiredOption('--at <iso>', 'Break start ISO timestamp')
    .requiredOption('--gap <minutes>', 'Break duration in minutes')
    .action(async (sessionId: string, opts: { at: string; gap: string }) => {
      const breakMinutes = Number.parseInt(opts.gap, 10);
      if (Number.isNaN(breakMinutes) || breakMinutes < 1) {
        throw new CliUsageError(`Invalid --gap '${opts.gap}'. Expected a positive integer (minutes).`);
      }
      const data = await ctx.getClient().splitSession(sessionId, {
        breakStartAt: opts.at,
        breakMinutes,
      });
      emit(
        data,
        (d) =>
          `Split session into ${d.firstSession.id} (${d.firstSession.startedAt} -> ${d.firstSession.endedAt}) and ${d.secondSession.id} (${d.secondSession.startedAt} -> ${d.secondSession.endedAt})`,
      );
    });

  sessionCmd
    .command('delete <sessionId>')
    .description('Soft-delete a focus session')
    .action(async (sessionId: string) => {
      const { session } = await ctx.getClient().deleteSession(sessionId);
      emit<FocusSession>(session, (s) => `Deleted session ${s.id}`);
    });

  // -------------------------------------------------------------------------
  // Notes, Weekly Review & Calendar Events Commands
  // -------------------------------------------------------------------------

  const noteCmd = program.command('note').description('Capture daily reflection notes');
  noteCmd
    .command('add <content>')
    .description('Add a daily note')
    .option('--date <YYYY-MM-DD>', 'Note date (defaults to today in server timezone)')
    .option('--project <idOrName>', 'Tag with project UUID or name')
    .option('--goal <idOrName>', 'Tag with goal UUID or name')
    .option('--ops', 'Tag note as operational')
    .action(
      async (
        content: string,
        opts: { date?: string; project?: string; goal?: string; ops?: boolean },
      ) => {
        const client = ctx.getClient();
        const projectId = opts.project ? await client.resolveProjectId(opts.project) : undefined;
        const goalId = opts.goal ? await client.resolveGoalId(opts.goal) : undefined;
        const date = opts.date ? validateDateOnly(opts.date, '--date') : undefined;
        const { note } = await client.addNote({
          content,
          ...(date ? { date } : {}),
          ...(projectId ? { projectId } : {}),
          ...(goalId ? { goalId } : {}),
          ...(opts.ops ? { isOps: true } : {}),
        });
        emit<DailyNote>(note, (n) => `Added note ${n.id} (${n.date}): ${n.content}`);
      },
    );

  program
    .command('notes')
    .description('List daily notes for a week or date')
    .option('--week <YYYY-MM-DD>', 'Any date within the target week')
    .option('--date <YYYY-MM-DD>', 'Filter by specific date')
    .option('--project <idOrName>', 'Filter by project UUID or name')
    .option('--goal <idOrName>', 'Filter by goal UUID or name')
    .action(
      async (opts: { week?: string; date?: string; project?: string; goal?: string }) => {
        const client = ctx.getClient();
        const projectId = opts.project ? await client.resolveProjectId(opts.project) : undefined;
        const goalId = opts.goal ? await client.resolveGoalId(opts.goal) : undefined;
        const data = await client.listNotes({
          date: opts.date ? validateDateOnly(opts.date, '--date') : undefined,
          weekStart: opts.week ? validateDateOnly(opts.week, '--week') : undefined,
          projectId,
          goalId,
        });
        emit<{ notes: DailyNote[] }>(data, (d) => {
          if (d.notes.length === 0) return 'No notes found.';
          return d.notes.map((n) => `- ${n.date} [${n.id}] ${n.content}`).join('\n');
        });
      },
    );

  const reviewCmd = program
    .command('review')
    .description('Inspect weekly review summary or set rule for next week')
    .option('--week <YYYY-MM-DD>', 'Any date within the target week')
    .action(async (opts: { week?: string }) => {
      const weekStart = opts.week ? validateDateOnly(opts.week, '--week') : undefined;
      const data = await ctx.getClient().review(weekStart);
      emit<ReviewResponse>(data, (d) => {
        const lines = [
          `Weekly Review ${d.weekStartDate} .. ${d.weekEndDate}`,
          `Focus: ${formatDuration(d.totalFocusMinutes)} (Build ${formatDuration(d.buildMinutes)} / Ops ${formatDuration(d.opsMinutes)}, Goal-aligned ${d.goalAlignmentPct}%)`,
          `Energy: +${d.energyCounts.up} / =${d.energyCounts.neutral} / -${d.energyCounts.down}`,
          `Rule for next week: ${d.ruleForNextWeek ?? '(not set)'}`,
          `Notes: ${d.dailyNotes.length} | Chronic carryovers: ${d.chronicCarryovers.length} | Past-revisit Later: ${d.pastRevisitLater.length}`,
        ];
        return lines.join('\n');
      });
    });

  reviewCmd
    .command('set-rule <rule>')
    .description('Set the weekly rule for next week')
    .option('--week <YYYY-MM-DD>', 'Week start date (defaults to current week)')
    .option('--notes <text>', 'Optional review reflection notes')
    .action(async (rule: string, opts: { week?: string; notes?: string }) => {
      const weekStartDate = opts.week ? validateDateOnly(opts.week, '--week') : undefined;
      const { review } = await ctx.getClient().setWeeklyRule({
        ...(weekStartDate ? { weekStartDate } : {}),
        ruleForNextWeek: rule,
        ...(opts.notes !== undefined ? { notes: opts.notes } : {}),
      });
      emit<WeeklyReview>(
        review,
        (r) => `Saved rule for week of ${r.weekStartDate}: "${r.ruleForNextWeek}"`,
      );
    });

  const eventsCmd = program
    .command('events')
    .description('List, sync, upsert, or assign calendar events')
    .option('--start <dateOrIso>', 'Start date or ISO timestamp')
    .option('--end <dateOrIso>', 'End date or ISO timestamp')
    .action(async (opts: { start?: string; end?: string }) => {
      const data = await ctx.getClient().listEvents({ start: opts.start, end: opts.end });
      emit<{ events: CalendarEvent[] }>(data, (d) => {
        if (d.events.length === 0) return 'No calendar events found.';
        return d.events
          .map((ev) => `- ${ev.id}  ${ev.title} (${ev.startAt} -> ${ev.endAt}) [${ev.source}]`)
          .join('\n');
      });
    });

  eventsCmd
    .command('sync')
    .description('Trigger immediate calendar sync on the server')
    .action(async () => {
      const data = await ctx.getClient().syncEvents();
      emit<SyncEventsResponse>(data, (d) => {
        const base = `Calendar sync [${d.status.state}]: ${d.result.createdCount} created, ${d.result.updatedCount} updated, ${d.result.skippedCount} skipped, ${d.result.deletedCount} deleted`;
        return d.error ? `${base} (error: ${d.error})` : base;
      });
    });

  eventsCmd
    .command('auto-match')
    .description('Assign unassigned meetings to projects by learned titles and project keywords')
    .action(async () => {
      const data = await ctx.getClient().autoMatchEvents();
      emit<{ matchedCount: number }>(
        data,
        (d) => `Auto-matched ${d.matchedCount} calendar event${d.matchedCount === 1 ? '' : 's'} to projects`,
      );
    });

  eventsCmd
    .command('upsert')
    .description('Upsert normalized calendar events from a JSON file')
    .requiredOption('--file <path>', 'Path to JSON file containing events array or { source, events }')
    .option('--source <source>', 'Override source (manual|outlook_cli|ics)')
    .action(async (opts: { file: string; source?: string }) => {
      let rawText: string;
      try {
        rawText = fs.readFileSync(opts.file, 'utf8');
      } catch (err) {
        throw new CliUsageError(
          `Failed to read events file '${opts.file}': ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      let rawJson: unknown;
      try {
        rawJson = JSON.parse(rawText);
      } catch {
        throw new CliUsageError(`Events file '${opts.file}' is not valid JSON.`);
      }

      let source: CalendarEventSource = 'manual';
      let eventsInput: unknown;

      if (Array.isArray(rawJson)) {
        eventsInput = rawJson;
      } else if (rawJson && typeof rawJson === 'object' && 'events' in rawJson) {
        const obj = rawJson as { source?: unknown; events: unknown };
        eventsInput = obj.events;
        if (typeof obj.source === 'string') {
          const parsedSrc = calendarEventSourceSchema.safeParse(obj.source);
          if (!parsedSrc.success) {
            throw new CliUsageError(`Invalid source '${obj.source}' in events file.`);
          }
          source = parsedSrc.data;
        }
      } else {
        throw new CliUsageError(
          `Events file '${opts.file}' must be a JSON array or an object with an "events" array.`,
        );
      }

      if (opts.source) {
        const parsedSrc = calendarEventSourceSchema.safeParse(opts.source);
        if (!parsedSrc.success) {
          throw new CliUsageError(
            `Invalid --source '${opts.source}'. Expected manual, outlook_cli, or ics.`,
          );
        }
        source = parsedSrc.data;
      }

      const parsedEvents = z.array(normalizedCalendarEventSchema).safeParse(eventsInput);
      if (!parsedEvents.success) {
        throw new CliUsageError(`Invalid events payload: ${parsedEvents.error.message}`);
      }

      const data = await ctx.getClient().upsertEvents({
        source,
        events: parsedEvents.data as NormalizedCalendarEvent[],
      });
      emit(
        data,
        (d) =>
          `Upserted ${d.upserted.length} events (${d.createdCount} created, ${d.updatedCount} updated, ${d.skippedCount} skipped, ${d.deletedCount} deleted)`,
      );
    });

  eventsCmd
    .command('assign <id>')
    .description('Assign project, goal, ops flag, notes, or links to a calendar event')
    .option('--project <idOrName>', 'Project UUID, name, or "none" to clear')
    .option('--goal <idOrName>', 'Goal UUID, name, or "none" to clear')
    .option('--ops', 'Mark event as Ops')
    .option('--no-ops', 'Clear Ops flag')
    .option('--notes <text>', 'Event notes')
    .option('--link <url>', 'Attach external links (repeatable)', collectRepeatable, [])
    .action(
      async (
        id: string,
        opts: {
          project?: string;
          goal?: string;
          ops?: boolean;
          notes?: string;
          link: string[];
        },
      ) => {
        const client = ctx.getClient();
        const payload: UpdateCalendarEventInput = {};
        if (opts.project !== undefined) {
          payload.projectId = isClearToken(opts.project)
            ? null
            : await client.resolveProjectId(opts.project);
        }
        if (opts.goal !== undefined) {
          payload.goalId = isClearToken(opts.goal)
            ? null
            : await client.resolveGoalId(opts.goal);
        }
        if (opts.ops !== undefined) payload.isOps = opts.ops;
        if (opts.notes !== undefined) payload.notes = opts.notes;
        if (opts.link.length > 0) {
          payload.externalLinks = opts.link.map(parseExternalLink);
        }

        const { event } = await client.updateEvent(id, payload);
        emit<CalendarEvent>(event, (ev) => `Updated event ${ev.id} ("${ev.title}")`);
      },
    );

  // -------------------------------------------------------------------------
  // Config Commands
  // -------------------------------------------------------------------------

  const configCmd = program.command('config').description('Manage Veyra CLI connection config');

  configCmd
    .command('set')
    .description('Save server URL and optional bearer token to ~/.veyra/config.json')
    .requiredOption('--url <url>', 'Veyra server base URL (e.g. http://127.0.0.1:4173)')
    .option('--token <token>', 'Bearer token for authenticated servers')
    .option('--clear-token', 'Remove saved bearer token')
    .action((opts: { url: string; token?: string; clearToken?: boolean }) => {
      const saved = saveConfig(
        {
          serverUrl: opts.url,
          ...(opts.clearToken ? { token: null } : opts.token !== undefined ? { token: opts.token } : {}),
        },
        { env: ctx.env, configPath: ctx.configPath },
      );
      emit(
        saved,
        (s) =>
          `Saved Veyra config to ${s.configPath} (url=${s.serverUrl ?? ''}, token=${s.tokenConfigured ? 'configured' : 'none'})`,
      );
    });

  configCmd
    .command('show')
    .alias('get')
    .description('Show effective Veyra CLI configuration')
    .action(() => {
      const resolved = loadConfig({ env: ctx.env, configPath: ctx.configPath });
      const safePayload = {
        serverUrl: resolved.serverUrl,
        tokenConfigured: Boolean(resolved.token),
        actor: resolved.actor,
        configPath: resolved.configPath,
        sources: resolved.sources,
      };
      emit(
        safePayload,
        (c) =>
          `Server URL: ${c.serverUrl} (${c.sources.serverUrl})\nToken: ${c.tokenConfigured ? 'configured' : 'none'} (${c.sources.token})\nActor: ${c.actor}\nConfig path: ${c.configPath}`,
      );
    });

  return program;
}

function formatFocusStatus(status: FocusStatus): string {
  if (!status.activeBlock || !status.activeSession) {
    return `Idle | Focused today: ${formatDuration(status.focusedTodayMinutes)}`;
  }
  const elapsedMins = Math.floor(status.elapsedSeconds / 60);
  const elapsedSecs = status.elapsedSeconds % 60;
  return `Focusing on "${status.activeBlock.title}" (${status.activeBlock.id}) — ${elapsedMins}m ${elapsedSecs}s elapsed | Today: ${formatDuration(status.focusedTodayMinutes)}`;
}

// ---------------------------------------------------------------------------
// Public CLI runner (in-process testable & entrypoint)
// ---------------------------------------------------------------------------

export async function runCli(argv: string[], io?: CliIo): Promise<number> {
  const writeOut = io?.stdout ?? ((chunk: string) => process.stdout.write(chunk));
  const writeErr = io?.stderr ?? ((chunk: string) => process.stderr.write(chunk));
  const env = io?.env ?? process.env;
  const { jsonMode, normalizedArgv } = extractGlobalJsonFlag(argv);

  let cachedClient: VeyraClient | null = null;
  const getClient = (): VeyraClient => {
    if (!cachedClient) {
      const cfg = loadConfig({ env, configPath: io?.configPath });
      cachedClient = new VeyraClient({
        serverUrl: cfg.serverUrl,
        token: cfg.token,
        actor: cfg.actor,
        now: cfg.now,
        fetchImpl: io?.fetchImpl,
      });
    }
    return cachedClient;
  };

  const program = createProgram({
    jsonMode,
    writeOut,
    writeErr,
    getClient,
    env,
    configPath: io?.configPath,
    signal: io?.signal,
  });

  try {
    await program.parseAsync(normalizedArgv, { from: 'user' });
    return 0;
  } catch (err) {
    if (err instanceof CommanderError) {
      if (err.exitCode === 0) {
        return 0;
      }
      if (jsonMode) {
        writeErr(
          `${JSON.stringify({ error: { code: 'USAGE_ERROR', message: err.message } }, null, 2)}\n`,
        );
      }
      return err.exitCode || 2;
    }

    if (err instanceof VeyraApiError) {
      if (jsonMode) {
        writeErr(
          `${JSON.stringify({ error: { code: err.code, message: err.message, status: err.status } }, null, 2)}\n`,
        );
      } else {
        writeErr(`Error [${err.code}]: ${err.message}\n`);
      }
      return 1;
    }

    if (err instanceof CliUsageError) {
      if (jsonMode) {
        writeErr(
          `${JSON.stringify({ error: { code: err.code, message: err.message } }, null, 2)}\n`,
        );
      } else {
        writeErr(`Usage error: ${err.message}\n`);
      }
      return 2;
    }

    const message = err instanceof Error ? err.message : String(err);
    if (jsonMode) {
      writeErr(
        `${JSON.stringify({ error: { code: 'CLI_ERROR', message } }, null, 2)}\n`,
      );
    } else {
      writeErr(`Error: ${message}\n`);
    }
    return 1;
  }
}
