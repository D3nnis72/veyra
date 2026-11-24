import ical, { type Attendee, type ParameterValue, type VEvent } from 'node-ical';
import {
  type CalendarSyncAdapter,
  CalendarSyncError,
  type CalendarSyncWindow,
  type NormalizedCalendarEvent,
} from './types.js';

const MEETING_URL_HOST_PATTERNS = [
  /teams\.microsoft\.com/i,
  /teams\.live\.com/i,
  /zoom\.us/i,
  /meet\.google\.com/i,
  /webex\.com/i,
  /whereby\.com/i,
  /meet\.jit\.si/i,
  /around\.co/i,
  /cal\.com/i,
];

const URL_REGEX = /https?:\/\/[^\s<>")'\]]+/gi;

function extractParamString(value: ParameterValue | string | undefined | null): string {
  if (!value) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'object' && 'val' in value && typeof value.val === 'string') {
    return value.val;
  }
  return '';
}

function cleanUrl(raw: string): string {
  return raw.replace(/[.,;!?]+$/, '');
}

function extractMeetingUrl(event: VEvent): string | null {
  const locationText = extractParamString(event.location);
  const descriptionText = extractParamString(event.description);
  const directUrl = extractParamString(event.url);

  const candidates: string[] = [];
  for (const source of [locationText, directUrl, descriptionText]) {
    if (!source) continue;
    const matches = source.match(URL_REGEX);
    if (matches) {
      for (const match of matches) {
        candidates.push(cleanUrl(match));
      }
    }
  }

  for (const candidate of candidates) {
    if (MEETING_URL_HOST_PATTERNS.some((pattern) => pattern.test(candidate))) {
      return candidate;
    }
  }

  // Fallback: if location itself contains an https URL, treat it as meeting URL
  if (locationText) {
    const locMatches = locationText.match(URL_REGEX);
    if (locMatches && locMatches.length > 0) {
      return cleanUrl(locMatches[0]);
    }
  }

  return null;
}

function getAttendeeList(attendee: VEvent['attendee']): Attendee[] {
  if (!attendee) {
    return [];
  }
  return Array.isArray(attendee) ? attendee : [attendee];
}

function isEventDeclined(event: VEvent, ownerEmail?: string): boolean {
  if (event.status === 'CANCELLED') {
    return true;
  }
  const attendees = getAttendeeList(event.attendee);
  if (attendees.length === 0) {
    return false;
  }

  const normalizedOwner = ownerEmail?.trim().toLowerCase();
  if (normalizedOwner) {
    for (const att of attendees) {
      if (typeof att === 'string') {
        continue;
      }
      const partstat = att.params?.PARTSTAT?.toUpperCase();
      if (partstat !== 'DECLINED') {
        continue;
      }
      const val = (att.val ?? '').replace(/^mailto:/i, '').trim().toLowerCase();
      if (val === normalizedOwner) {
        return true;
      }
    }
    return false;
  }

  // Without ownerEmail, only treat PARTSTAT=DECLINED as declined when there is a single
  // attendee or ALL attendees declined so one coworker declining a group call does not
  // hide the user's meeting.
  let declinedCount = 0;
  for (const att of attendees) {
    if (typeof att === 'string') {
      continue;
    }
    if (att.params?.PARTSTAT?.toUpperCase() === 'DECLINED') {
      declinedCount++;
    }
  }

  return declinedCount === attendees.length;
}

function isFullDayEvent(event: VEvent, instanceFullDay?: boolean): boolean {
  if (instanceFullDay === true) {
    return true;
  }
  if (event.datetype === 'date') {
    return true;
  }
  if (event.start && event.start.dateOnly === true) {
    return true;
  }
  return false;
}

function normalizeEndDate(start: Date, end: Date | undefined, allDay: boolean): Date {
  if (end instanceof Date && !Number.isNaN(end.getTime()) && end.getTime() > start.getTime()) {
    return end;
  }
  const fallbackMs = allDay ? 24 * 60 * 60 * 1000 : 30 * 60 * 1000;
  return new Date(start.getTime() + fallbackMs);
}

export interface IcsFeedAdapterOptions {
  url?: string;
  icsText?: string;
  ownerEmail?: string;
  timeoutMs?: number;
  fetcher?: typeof fetch;
}

export class IcsFeedAdapter implements CalendarSyncAdapter {
  readonly name = 'ics' as const;
  private readonly url?: string;
  private readonly icsText?: string;
  private readonly ownerEmail?: string;
  private readonly timeoutMs: number;
  private readonly fetcher: typeof fetch;

  constructor(options: IcsFeedAdapterOptions) {
    this.url = options.url?.trim();
    this.icsText = options.icsText;
    this.ownerEmail = options.ownerEmail;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.fetcher = options.fetcher ?? fetch;
  }

  async fetchEvents(window: CalendarSyncWindow): Promise<NormalizedCalendarEvent[]> {
    const rawIcs = await this.loadIcsContent();
    return this.parseIcsWindow(rawIcs, window);
  }

  private async loadIcsContent(): Promise<string> {
    if (this.icsText !== undefined) {
      return this.icsText;
    }
    if (!this.url) {
      throw new CalendarSyncError(
        'ICS_URL_NOT_CONFIGURED',
        'ICS feed URL is empty. Configure icsFeedUrl in Settings.',
      );
    }

    let response: Response;
    try {
      response = await this.fetcher(this.url, {
        method: 'GET',
        headers: {
          Accept: 'text/calendar, text/plain;q=0.9, */*;q=0.8',
          'User-Agent': 'Veyra/0.1.0',
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new CalendarSyncError(
        'ICS_FETCH_FAILED',
        `Failed to fetch ICS feed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!response.ok) {
      throw new CalendarSyncError(
        'ICS_FETCH_HTTP_ERROR',
        `ICS feed returned HTTP ${response.status} ${response.statusText}`,
      );
    }

    return await response.text();
  }

  private parseIcsWindow(
    rawIcs: string,
    window: CalendarSyncWindow,
  ): NormalizedCalendarEvent[] {
    let parsed: ReturnType<typeof ical.sync.parseICS>;
    try {
      parsed = ical.sync.parseICS(rawIcs);
    } catch (err) {
      throw new CalendarSyncError(
        'ICS_PARSE_FAILED',
        `Failed to parse ICS calendar: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const windowFrom = new Date(`${window.startDate}T00:00:00.000Z`);
    const windowTo = new Date(`${window.endDate}T23:59:59.999Z`);
    if (Number.isNaN(windowFrom.getTime()) || Number.isNaN(windowTo.getTime())) {
      throw new CalendarSyncError(
        'ICS_INVALID_WINDOW',
        `Invalid sync window: ${window.startDate}..${window.endDate}`,
      );
    }

    const windowFromMs = windowFrom.getTime();
    const windowToMs = windowTo.getTime();

    const results: NormalizedCalendarEvent[] = [];
    const seenExternalIds = new Set<string>();

    for (const component of Object.values(parsed)) {
      if (!component || component.type !== 'VEVENT') {
        continue;
      }
      const event = component as VEvent;
      if (!(event.start instanceof Date) || Number.isNaN(event.start.getTime())) {
        continue;
      }

      if (event.rrule) {
        const instances = ical.expandRecurringEvent(event, {
          from: windowFrom,
          to: windowTo,
          includeOverrides: true,
          excludeExdates: true,
          expandOngoing: true,
        });

        for (const inst of instances) {
          const instEvent = inst.event ?? event;
          const allDay = isFullDayEvent(instEvent, inst.isFullDay);
          const startDate = inst.start;
          const endDate = normalizeEndDate(startDate, inst.end, allDay);

          if (endDate.getTime() <= windowFromMs || startDate.getTime() > windowToMs) {
            continue;
          }

          const uid = instEvent.uid || event.uid || extractParamString(inst.summary) || 'event';
          const externalId = `${uid}::${startDate.toISOString()}`;
          if (seenExternalIds.has(externalId)) {
            continue;
          }
          seenExternalIds.add(externalId);

          const title = extractParamString(inst.summary).trim() || 'Untitled Event';
          results.push({
            externalId,
            title,
            startAt: startDate.toISOString(),
            endAt: endDate.toISOString(),
            isAllDay: allDay,
            isDeclined: isEventDeclined(instEvent, this.ownerEmail),
            meetingUrl: extractMeetingUrl(instEvent),
          });
        }
      } else {
        const allDay = isFullDayEvent(event);
        const startDate = event.start;
        const endDate = normalizeEndDate(startDate, event.end, allDay);

        if (endDate.getTime() <= windowFromMs || startDate.getTime() > windowToMs) {
          continue;
        }

        const title = extractParamString(event.summary).trim() || 'Untitled Event';
        const externalId = event.uid || `${title}::${startDate.toISOString()}`;
        if (seenExternalIds.has(externalId)) {
          continue;
        }
        seenExternalIds.add(externalId);

        results.push({
          externalId,
          title,
          startAt: startDate.toISOString(),
          endAt: endDate.toISOString(),
          isAllDay: allDay,
          isDeclined: isEventDeclined(event, this.ownerEmail),
          meetingUrl: extractMeetingUrl(event),
        });
      }
    }

    results.sort((a, b) => a.startAt.localeCompare(b.startAt));
    return results;
  }
}
