import { ValidationError } from './errors.js';
import {
  type DateOnly,
  type RevisitHorizon,
  type WeekdayToken,
  isValidDateOnly,
  isValidRecurrenceRule,
} from './types.js';

const UTC_DAY_TO_TOKEN: readonly WeekdayToken[] = [
  'sun',
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
];

export function isValidTimeZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export function getHostTimeZone(): string {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (tz && isValidTimeZone(tz)) {
    return tz;
  }
  return 'UTC';
}

function parseDateOnlyParts(dateStr: string): { year: number; month: number; day: number } {
  if (!isValidDateOnly(dateStr)) {
    throw new Error(`Invalid YYYY-MM-DD date string: '${dateStr}'`);
  }
  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  return {
    year: Number(yearStr),
    month: Number(monthStr),
    day: Number(dayStr),
  };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Formats an instant (`Date` or ISO timestamp string) as `YYYY-MM-DD` in the given IANA timezone.
 */
export function formatLocalDate(isoOrDate: Date | string, timezone: string): string {
  if (!isValidTimeZone(timezone)) {
    throw new Error(`Invalid IANA timezone: '${timezone}'`);
  }
  const date = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date value: '${String(isoOrDate)}'`);
  }

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;

  if (!year || !month || !day) {
    throw new Error(`Failed to format date in timezone '${timezone}'`);
  }
  return `${year}-${month}-${day}`;
}

/**
 * Pure calendar arithmetic on a `YYYY-MM-DD` string, immune to DST transitions.
 */
export function addDaysToDateString(dateStr: string, days: number): string {
  const { year, month, day } = parseDateOnlyParts(dateStr);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function getWeekdayToken(dateStr: string): WeekdayToken {
  const { year, month, day } = parseDateOnlyParts(dateStr);
  const utcDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return UTC_DAY_TO_TOKEN[utcDay];
}

/**
 * Returns the ISO Monday–Sunday week range (`weekStartDate` .. `weekEndDate`) containing `dateStr`.
 */
export function getWeekRange(dateStr: string): { weekStartDate: string; weekEndDate: string } {
  const { year, month, day } = parseDateOnlyParts(dateStr);
  const utcDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0=Sun..6=Sat
  const offsetFromMonday = (utcDay + 6) % 7; // Mon=0, Tue=1, ..., Sun=6
  const weekStartDate = addDaysToDateString(dateStr, -offsetFromMonday);
  const weekEndDate = addDaysToDateString(weekStartDate, 6);
  return { weekStartDate, weekEndDate };
}

/**
 * Computes the ISO-8601 week year and week number (1..53) for a `YYYY-MM-DD` calendar date.
 */
export function getIsoWeekNumber(dateStr: DateOnly): { isoYear: number; isoWeek: number } {
  if (!isValidDateOnly(dateStr)) {
    throw new ValidationError(`Invalid YYYY-MM-DD date string: '${dateStr}'`);
  }
  const { year, month, day } = parseDateOnlyParts(dateStr);
  const d = new Date(Date.UTC(year, month - 1, day));
  const isoDay = d.getUTCDay() || 7; // Mon=1..Sun=7
  // Shift to Thursday of the same ISO week to determine the ISO week-year
  d.setUTCDate(d.getUTCDate() + 4 - isoDay);
  const isoYear = d.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const daysSinceYearStart = Math.floor((d.getTime() - yearStart.getTime()) / 86_400_000) + 1;
  const isoWeek = Math.ceil(daysSinceYearStart / 7);
  return { isoYear, isoWeek };
}

/**
 * Resolves an ISO week number (1..53) relative to the ISO week-year of `referenceDateStr`
 * to its Monday `YYYY-MM-DD` start date. Throws `ValidationError` on invalid week numbers.
 */
export function resolveIsoWeekStartDate(weekNumber: number, referenceDateStr: DateOnly): DateOnly {
  if (!Number.isInteger(weekNumber) || weekNumber < 1 || weekNumber > 53) {
    throw new ValidationError(
      `Invalid ISO week number: ${String(weekNumber)} (expected an integer between 1 and 53)`,
    );
  }
  const { isoYear } = getIsoWeekNumber(referenceDateStr);
  const maxWeeks = getIsoWeekNumber(`${isoYear}-12-28`).isoWeek;
  if (weekNumber > maxWeeks) {
    throw new ValidationError(
      `ISO year ${isoYear} only has ${maxWeeks} weeks (got week ${weekNumber})`,
    );
  }
  // January 4 is always in ISO week 1 of its year
  const { weekStartDate: week1Monday } = getWeekRange(`${isoYear}-01-04`);
  return addDaysToDateString(week1Monday, (weekNumber - 1) * 7);
}

/**
 * Resolves a revisit horizon preset (`next-week`, `2w`, `next-month`, `next-quarter`)
 * or explicit `YYYY-MM-DD` date relative to `baseDate`.
 */
export function resolveRevisitDate(horizon: RevisitHorizon, baseDate: string): string {
  parseDateOnlyParts(baseDate);
  switch (horizon) {
    case 'next-week':
      return addDaysToDateString(baseDate, 7);
    case '2w':
      return addDaysToDateString(baseDate, 14);
    case 'next-month':
      return addDaysToDateString(baseDate, 30);
    case 'next-quarter':
      return addDaysToDateString(baseDate, 90);
    default:
      parseDateOnlyParts(horizon);
      return horizon;
  }
}

/**
 * Evaluates whether a `YYYY-MM-DD` date matches a spec `recurrenceRule`:
 * - `'weekdays'` -> mon..fri
 * - `'weekly'` -> matches `anchorDateStr`'s weekday (or `'mon'` when no anchor is provided)
 * - `'days:[mon,wed,fri]'` -> matches any listed weekday token
 */
export function matchesRecurrenceRule(
  rule: string,
  dateStr: string,
  anchorDateStr?: string | null,
): boolean {
  if (!isValidRecurrenceRule(rule)) {
    return false;
  }
  const token = getWeekdayToken(dateStr);
  if (rule === 'weekdays') {
    return token !== 'sat' && token !== 'sun';
  }
  if (rule === 'weekly') {
    const anchorToken = anchorDateStr && isValidDateOnly(anchorDateStr)
      ? getWeekdayToken(anchorDateStr)
      : 'mon';
    return token === anchorToken;
  }
  const inner = rule.slice('days:['.length, -1);
  return inner.split(',').includes(token);
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

function localMidnightToUtcDate(dateStr: string, timezone: string): Date {
  const { year, month, day } = parseDateOnlyParts(dateStr);
  const utcGuess = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  const offset1 = getTimeZoneOffsetMs(utcGuess, timezone);
  const candidate = new Date(utcGuess.getTime() - offset1);
  const offset2 = getTimeZoneOffsetMs(candidate, timezone);
  if (offset2 !== offset1) {
    return new Date(utcGuess.getTime() - offset2);
  }
  return candidate;
}

/**
 * Computes exact UTC ISO boundaries `[startIso, endIso)` for a local calendar day
 * `YYYY-MM-DD` in the specified IANA timezone.
 */
export function getLocalDayBoundsIso(
  dateStr: string,
  timezone: string,
): { startIso: string; endIso: string } {
  if (!isValidTimeZone(timezone)) {
    throw new Error(`Invalid IANA timezone: '${timezone}'`);
  }
  const start = localMidnightToUtcDate(dateStr, timezone);
  const nextDateStr = addDaysToDateString(dateStr, 1);
  const end = localMidnightToUtcDate(nextDateStr, timezone);
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}
