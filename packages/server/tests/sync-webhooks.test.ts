import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createProject,
  listActivity,
  listCalendarEvents,
  openVeyraDb,
  updateCalendarEvent,
  updateSettings,
  type VeyraDb,
} from '@veyra/core';
import { IcsFeedAdapter } from '../src/sync/ics-adapter.js';
import { OutlookCliAdapter } from '../src/sync/outlook-cli-adapter.js';
import { CalendarSyncRunner } from '../src/sync/sync-runner.js';
import { createVeyraServer, type VeyraServerInstance } from '../src/app.js';
import {
  WebhookDispatcher,
  computeWebhookSignature,
  type WebhookDeliveryEvent,
} from '../src/webhooks.js';

const tempDirs: string[] = [];
const openDbs: VeyraDb[] = [];
const activeServers: http.Server[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veyra-server-sync-'));
  tempDirs.push(dir);
  return dir;
}

function createTestDb(): VeyraDb {
  const dir = createTempDir();
  const db = openVeyraDb(path.join(dir, 'veyra.db'));
  openDbs.push(db);
  return db;
}

function startLocalServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    activeServers.push(server);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        throw new Error('Unexpected server address');
      }
      resolve({ server, url: `http://127.0.0.1:${addr.port}` });
    });
  });
}

afterEach(async () => {
  while (activeServers.length > 0) {
    const srv = activeServers.pop()!;
    await new Promise<void>((resolve) => srv.close(() => resolve()));
  }
  while (openDbs.length > 0) {
    openDbs.pop()!.close();
  }
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

const SAMPLE_ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Veyra Test//EN',
  // 1. Single meeting with Teams link in DESCRIPTION
  'BEGIN:VEVENT',
  'UID:single-meeting-1@veyra.test',
  'DTSTAMP:20261120T080000Z',
  'DTSTART:20261124T100000Z',
  'DTEND:20261124T110000Z',
  'SUMMARY:Architecture Sync',
  'DESCRIPTION:Join here https://teams.microsoft.com/l/meetup-join/abc123 for review.',
  'ATTENDEE;PARTSTAT=ACCEPTED:mailto:dennis@veyra.test',
  'END:VEVENT',
  // 2. Weekly recurring meeting (RRULE) with Zoom link in LOCATION
  'BEGIN:VEVENT',
  'UID:weekly-standup@veyra.test',
  'DTSTAMP:20261101T080000Z',
  'DTSTART:20261109T090000Z',
  'DTEND:20261109T093000Z',
  'RRULE:FREQ=WEEKLY;COUNT=6',
  'SUMMARY:Weekly Standup',
  'LOCATION:https://zoom.us/j/987654321',
  'END:VEVENT',
  // 3. All-day event
  'BEGIN:VEVENT',
  'UID:allday-offsite@veyra.test',
  'DTSTAMP:20261120T080000Z',
  'DTSTART;VALUE=DATE:20261125',
  'DTEND;VALUE=DATE:20261126',
  'SUMMARY:Company Offsite',
  'END:VEVENT',
  // 4. Declined event
  'BEGIN:VEVENT',
  'UID:declined-sync@veyra.test',
  'DTSTAMP:20261120T080000Z',
  'DTSTART:20261126T140000Z',
  'DTEND:20261126T150000Z',
  'SUMMARY:Optional Vendor Pitch',
  'ATTENDEE;CN=Dennis;PARTSTAT=DECLINED:mailto:dennis@veyra.test',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

describe('IcsFeedAdapter & CalendarSyncRunner', () => {
  it('parses single, weekly recurring, all-day, and declined events, filters on syncNow, and preserves projectId and notes across re-sync', async () => {
    const db = createTestDb();
    updateSettings(db, {
      timezone: 'UTC',
      calendarSyncMode: 'ics',
      skipDeclinedAndAllDay: true,
    });

    const adapter = new IcsFeedAdapter({ icsText: SAMPLE_ICS });
    const parsed = await adapter.fetchEvents({
      startDate: '2026-11-23',
      endDate: '2026-12-06',
    });

    const single = parsed.find((e) => e.externalId === 'single-meeting-1@veyra.test');
    expect(single).toBeDefined();
    expect(single?.title).toBe('Architecture Sync');
    expect(single?.meetingUrl).toBe('https://teams.microsoft.com/l/meetup-join/abc123');
    expect(single?.isAllDay).toBe(false);
    expect(single?.isDeclined).toBe(false);

    const recurring = parsed.filter((e) => e.externalId.startsWith('weekly-standup@veyra.test'));
    expect(recurring).toHaveLength(2); // Nov 23 and Nov 30
    expect(recurring[0].meetingUrl).toBe('https://zoom.us/j/987654321');
    expect(recurring[0].startAt).toBe('2026-11-23T09:00:00.000Z');
    expect(recurring[1].startAt).toBe('2026-11-30T09:00:00.000Z');

    const allDay = parsed.find((e) => e.externalId === 'allday-offsite@veyra.test');
    expect(allDay?.isAllDay).toBe(true);

    const declined = parsed.find((e) => e.externalId === 'declined-sync@veyra.test');
    expect(declined?.isDeclined).toBe(true);

    // Serve the same ICS over local HTTP so CalendarSyncRunner exercises real URL fetching
    let currentIcs = SAMPLE_ICS;
    const { url } = await startLocalServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8' });
      res.end(currentIcs);
    });

    updateSettings(db, {
      calendarSyncMode: 'ics',
      icsFeedUrl: `${url}/calendar.ics`,
      skipDeclinedAndAllDay: true,
    });

    const emitted: Array<{ type: string; count: number }> = [];
    const runner = new CalendarSyncRunner(db, {
      windowDaysBack: 0,
      windowDaysForward: 13,
      onSynced: (ev) => emitted.push({ type: ev.type, count: ev.count }),
    });

    const firstRun = await runner.syncNow('2026-11-23T08:00:00.000Z');
    expect(firstRun.error).toBeUndefined();
    expect(firstRun.status.state).toBe('connected');
    expect(firstRun.createdCount).toBe(3); // 1 single + 2 recurring occurrences
    expect(firstRun.skippedCount).toBe(2); // 1 all-day + 1 declined
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toEqual({ type: 'events.synced', count: 3 });

    const stored = listCalendarEvents(db, '2026-11-23T00:00:00.000Z', '2026-12-07T00:00:00.000Z');
    expect(stored).toHaveLength(3);
    expect(stored.some((e) => e.title === 'Company Offsite')).toBe(false);
    expect(stored.some((e) => e.title === 'Optional Vendor Pitch')).toBe(false);

    // Attach projectId and notes to Architecture Sync, then re-sync with updated title
    const project = createProject(db, { name: 'Veyra Core' });
    const archEvent = stored.find((e) => e.externalId === 'single-meeting-1@veyra.test')!;
    updateCalendarEvent(db, archEvent.id, {
      projectId: project.id,
      notes: 'Decide SQLite WAL tuning',
    });

    currentIcs = SAMPLE_ICS.replace('SUMMARY:Architecture Sync', 'SUMMARY:Architecture Sync v2');
    const secondRun = await runner.syncNow('2026-11-23T09:00:00.000Z');
    expect(secondRun.error).toBeUndefined();
    expect(secondRun.updatedCount).toBe(3);

    const afterResync = listCalendarEvents(db, '2026-11-23T00:00:00.000Z', '2026-12-07T00:00:00.000Z');
    const updatedArch = afterResync.find((e) => e.externalId === 'single-meeting-1@veyra.test')!;
    expect(updatedArch.title).toBe('Architecture Sync v2');
    expect(updatedArch.projectId).toBe(project.id);
    expect(updatedArch.notes).toBe('Decide SQLite WAL tuning');
  });

  it('does not mark a multi-attendee meeting as declined when only one coworker declined', async () => {
    const multiAttendeeIcs = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Veyra Test//EN',
      'BEGIN:VEVENT',
      'UID:group-sync@veyra.test',
      'DTSTAMP:20261120T080000Z',
      'DTSTART:20261124T140000Z',
      'DTEND:20261124T150000Z',
      'SUMMARY:Product Review',
      'ATTENDEE;CN=Coworker;PARTSTAT=DECLINED:mailto:coworker@veyra.test',
      'ATTENDEE;CN=Dennis;PARTSTAT=ACCEPTED:mailto:dennis@veyra.test',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:all-declined@veyra.test',
      'DTSTAMP:20261120T080000Z',
      'DTSTART:20261124T160000Z',
      'DTEND:20261124T163000Z',
      'SUMMARY:Everyone Declined',
      'ATTENDEE;CN=Coworker;PARTSTAT=DECLINED:mailto:coworker@veyra.test',
      'ATTENDEE;CN=Dennis;PARTSTAT=DECLINED:mailto:dennis@veyra.test',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const adapter = new IcsFeedAdapter({ icsText: multiAttendeeIcs });
    const parsed = await adapter.fetchEvents({
      startDate: '2026-11-23',
      endDate: '2026-11-30',
    });

    const groupSync = parsed.find((e) => e.externalId === 'group-sync@veyra.test');
    expect(groupSync).toBeDefined();
    expect(groupSync?.isDeclined).toBe(false);

    const allDeclined = parsed.find((e) => e.externalId === 'all-declined@veyra.test');
    expect(allDeclined?.isDeclined).toBe(true);

    // Verify CalendarSyncRunner syncs the group meeting when skipDeclinedAndAllDay is true
    const { url } = await startLocalServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8' });
      res.end(multiAttendeeIcs);
    });

    const db = createTestDb();
    updateSettings(db, {
      timezone: 'UTC',
      calendarSyncMode: 'ics',
      icsFeedUrl: `${url}/calendar.ics`,
      skipDeclinedAndAllDay: true,
    });

    const runner = new CalendarSyncRunner(db, {
      windowDaysBack: 0,
      windowDaysForward: 7,
    });
    const run = await runner.syncNow('2026-11-23T08:00:00.000Z');
    expect(run.error).toBeUndefined();
    expect(run.createdCount).toBe(1);
    expect(run.skippedCount).toBe(1);

    const stored = listCalendarEvents(db, '2026-11-23T00:00:00.000Z', '2026-11-30T23:59:59.999Z');
    expect(stored).toHaveLength(1);
    expect(stored[0].externalId).toBe('group-sync@veyra.test');
    expect(stored[0].title).toBe('Product Review');
  });
});

describe('OutlookCliAdapter', () => {
  it('executes a configured CLI command with date window args and validates JSON output', async () => {
    const dir = createTempDir();
    const scriptPath = path.join(dir, 'fake-outlook.mjs');
    fs.writeFileSync(
      scriptPath,
      `
const args = process.argv.slice(2);
const startIdx = args.indexOf('--start');
const endIdx = args.indexOf('--end');
const limitIdx = args.indexOf('--limit');
const hasJson = args.includes('--json');
if (startIdx === -1 || endIdx === -1 || limitIdx === -1 || !hasJson) {
  console.error('Missing expected flags: ' + args.join(' '));
  process.exit(2);
}
console.log(JSON.stringify([
  {
    externalId: 'outlook-evt-1',
    title: 'Customer Discovery',
    startAt: args[startIdx + 1] + 'T13:00:00.000Z',
    endAt: args[startIdx + 1] + 'T13:45:00.000Z',
    isAllDay: false,
    isDeclined: false,
    meetingUrl: 'https://teams.microsoft.com/l/meetup-join/outlook1'
  }
]));
`,
      'utf8',
    );

    const adapter = new OutlookCliAdapter({
      command: `"${process.execPath}" "${scriptPath}"`,
    });

    const events = await adapter.fetchEvents({
      startDate: '2026-11-23',
      endDate: '2026-11-30',
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      externalId: 'outlook-evt-1',
      title: 'Customer Discovery',
      startAt: '2026-11-23T13:00:00.000Z',
      endAt: '2026-11-23T13:45:00.000Z',
      isAllDay: false,
      isDeclined: false,
      meetingUrl: 'https://teams.microsoft.com/l/meetup-join/outlook1',
    });
  });

  it('returns a clear structured error when CLI prints plain-text table instead of JSON', async () => {
    const dir = createTempDir();
    const scriptPath = path.join(dir, 'plain-text-outlook.mjs');
    fs.writeFileSync(
      scriptPath,
      `console.log('DATE       | TIME  | TITLE\\n2026-11-23 | 10:00 | Standup');`,
      'utf8',
    );

    const adapter = new OutlookCliAdapter({
      command: `"${process.execPath}" "${scriptPath}"`,
    });

    await expect(
      adapter.fetchEvents({ startDate: '2026-11-23', endDate: '2026-11-30' }),
    ).rejects.toThrow(/valid JSON/i);

    // Also verify CalendarSyncRunner catches it gracefully without crashing
    const db = createTestDb();
    updateSettings(db, {
      calendarSyncMode: 'outlook_cli',
      outlookCliCommand: `"${process.execPath}" "${scriptPath}"`,
    });
    const runner = new CalendarSyncRunner(db);
    const result = await runner.syncNow('2026-11-23T08:00:00.000Z');
    expect(result.status.state).toBe('error');
    expect(result.error).toMatch(/valid JSON/i);
  });

  it('converts naive { dateTime, timeZone } timestamps in UTC and IANA timezones accurately', async () => {
    const dir = createTempDir();
    const scriptPath = path.join(dir, 'tz-outlook.mjs');
    fs.writeFileSync(
      scriptPath,
      `
console.log(JSON.stringify([
  {
    id: 'utc-evt',
    subject: 'UTC Standup',
    start: { dateTime: '2026-11-23T09:00:00', timeZone: 'UTC' },
    end: { dateTime: '2026-11-23T09:30:00.0000000', timeZone: 'UTC' }
  },
  {
    id: 'berlin-evt',
    subject: 'Berlin Planning',
    start: { dateTime: '2026-11-23T10:00:00', timeZone: 'Europe/Berlin' },
    end: { dateTime: '2026-11-23T11:00:00', timeZone: 'Europe/Berlin' }
  }
]));
`,
      'utf8',
    );

    const adapter = new OutlookCliAdapter({
      command: `"${process.execPath}" "${scriptPath}"`,
    });

    const events = await adapter.fetchEvents({
      startDate: '2026-11-23',
      endDate: '2026-11-30',
    });

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      externalId: 'utc-evt',
      title: 'UTC Standup',
      startAt: '2026-11-23T09:00:00.000Z',
      endAt: '2026-11-23T09:30:00.000Z',
    });
    expect(events[1]).toMatchObject({
      externalId: 'berlin-evt',
      title: 'Berlin Planning',
      startAt: '2026-11-23T09:00:00.000Z',
      endAt: '2026-11-23T10:00:00.000Z',
    });
  });

  it('surfaces a structured error when CLI exits with a non-zero exit code', async () => {
    const dir = createTempDir();
    const scriptPath = path.join(dir, 'failing-outlook.mjs');
    fs.writeFileSync(
      scriptPath,
      `console.error('Outlook auth token expired'); process.exit(42);`,
      'utf8',
    );

    const adapter = new OutlookCliAdapter({
      command: `"${process.execPath}" "${scriptPath}"`,
    });

    await expect(
      adapter.fetchEvents({ startDate: '2026-11-23', endDate: '2026-11-30' }),
    ).rejects.toMatchObject({
      code: 'OUTLOOK_CLI_EXEC_FAILED',
      message: expect.stringContaining('Outlook auth token expired'),
    });

    const db = createTestDb();
    updateSettings(db, {
      calendarSyncMode: 'outlook_cli',
      outlookCliCommand: `"${process.execPath}" "${scriptPath}"`,
    });
    const runner = new CalendarSyncRunner(db);
    const result = await runner.syncNow('2026-11-23T08:00:00.000Z');
    expect(result.status.state).toBe('error');
    expect(result.error).toContain('Outlook auth token expired');
  });
});

describe('WebhookDispatcher', () => {
  it('POSTs JSON payload and retries once on simulated 500 before succeeding', async () => {
    const db = createTestDb();
    let attempts = 0;
    const receivedBodies: Array<Record<string, unknown>> = [];
    const receivedHeaders: Array<http.IncomingHttpHeaders> = [];

    const { url } = await startLocalServer((req, res) => {
      attempts++;
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        receivedHeaders.push(req.headers);
        const text = Buffer.concat(chunks).toString('utf8');
        receivedBodies.push(JSON.parse(text) as Record<string, unknown>);
        if (attempts === 1) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Temporary upstream error');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    });

    updateSettings(db, {
      webhookUrl: `${url}/hook`,
      webhookEvents: ['focus.started', 'block.completed'],
    });

    const dispatcher = new WebhookDispatcher(db, {
      timeoutMs: 5000,
      retryDelayMs: 10,
    });

    const result = await dispatcher.emit(
      'focus.started',
      {
        blockId: 'blk-1',
        title: 'Write server tests',
        sessionId: 'sess-1',
      },
      { now: '2026-11-23T10:00:00.000Z' },
    );

    expect(result.delivered).toBe(true);
    expect(result.attempts).toBe(2);
    expect(result.statusCode).toBe(200);
    expect(attempts).toBe(2);
    expect(receivedBodies).toHaveLength(2);
    expect(receivedBodies[1]).toEqual({
      event: 'focus.started',
      timestamp: '2026-11-23T10:00:00.000Z',
      data: {
        blockId: 'blk-1',
        title: 'Write server tests',
        sessionId: 'sess-1',
      },
    });
    expect(receivedHeaders[1]['x-veyra-event']).toBe('focus.started');

    const logs = listActivity(db, { actor: 'hook' });
    expect(logs.some((entry) => entry.action === 'webhook.delivered')).toBe(true);

    // Events not in settings.webhookEvents are skipped
    const skipped = await dispatcher.emit('focus.ended', { blockId: 'blk-1' });
    expect(skipped.skipped).toBe(true);
    expect(skipped.attempts).toBe(0);

    // sendTestHook delivers a test event
    const testResult = await dispatcher.sendTestHook({ now: '2026-11-23T10:05:00.000Z' });
    expect(testResult.delivered).toBe(true);
    expect(receivedBodies[receivedBodies.length - 1].event).toBe('webhook.test');
  });

  it('signs payloads with X-Veyra-Signature-256 when secret is configured and invokes onDelivery for success and failure', async () => {
    const db = createTestDb();
    let mode: 'ok' | 'fail' = 'ok';
    const receivedRawBodies: string[] = [];
    const receivedSignatures: Array<string | undefined> = [];

    const { url } = await startLocalServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        receivedRawBodies.push(Buffer.concat(chunks).toString('utf8'));
        const sig = req.headers['x-veyra-signature-256'];
        receivedSignatures.push(Array.isArray(sig) ? sig[0] : sig);
        if (mode === 'fail') {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Bad request');
          return;
        }
        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    });

    updateSettings(db, {
      webhookUrl: `${url}/webhook`,
      webhookEvents: ['block.completed'],
    });

    const deliveries: WebhookDeliveryEvent[] = [];
    const secret = 'test-signing-secret';
    const dispatcher = new WebhookDispatcher(db, {
      timeoutMs: 5000,
      retryDelayMs: 10,
      secret,
      onDelivery: (ev) => deliveries.push(ev),
    });

    const okResult = await dispatcher.emit(
      'block.completed',
      { block: { id: 'blk-42', title: 'Ship hooks loop' } },
      { now: '2026-11-23T11:00:00.000Z' },
    );
    expect(okResult.delivered).toBe(true);
    expect(okResult.statusCode).toBe(202);
    expect(receivedSignatures[0]).toBe(computeWebhookSignature(secret, receivedRawBodies[0]));
    expect(deliveries[0]).toMatchObject({
      action: 'webhook.delivered',
      eventName: 'block.completed',
      delivered: true,
      statusCode: 202,
    });

    mode = 'fail';
    const failResult = await dispatcher.emit(
      'block.completed',
      { block: { id: 'blk-43', title: 'Failing hook' } },
      { now: '2026-11-23T11:05:00.000Z' },
    );
    expect(failResult.delivered).toBe(false);
    expect(failResult.statusCode).toBe(400);
    expect(deliveries[1]).toMatchObject({
      action: 'webhook.failed',
      eventName: 'block.completed',
      delivered: false,
      statusCode: 400,
    });

    const hookLogs = listActivity(db, { actor: 'hook' });
    expect(hookLogs.map((l) => l.action)).toEqual(['webhook.failed', 'webhook.delivered']);
  });

  it('POST /api/review/complete persists snapshot and dispatches review.completed webhook when subscribed', async () => {
    const receivedHooks: Array<{
      event: string;
      data: Record<string, unknown>;
    }> = [];

    const { url: hookUrl } = await startLocalServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        receivedHooks.push(JSON.parse(text) as { event: string; data: Record<string, unknown> });
        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    });

    const server: VeyraServerInstance = createVeyraServer({
      dbPath: ':memory:',
      port: 0,
      host: '127.0.0.1',
      enableTestClock: true,
      rolloverCheckIntervalMs: 600_000,
      webhookOptions: { timeoutMs: 5_000, retryDelayMs: 10 },
    });

    try {
      const { url: serverUrl } = await server.start();

      // Subscribe webhook to review.completed
      const patchRes = await fetch(`${serverUrl}/api/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timezone: 'Europe/Berlin',
          webhookUrl: `${hookUrl}/webhook`,
          webhookEvents: ['review.completed'],
        }),
      });
      expect(patchRes.status).toBe(200);

      // GET /api/review?week=47 resolves ISO week 47 of 2026 -> 2026-11-16
      const week47Res = await fetch(`${serverUrl}/api/review?week=47`, {
        headers: { 'X-Veyra-Now': '2026-11-25T10:00:00.000Z' },
      });
      expect(week47Res.status).toBe(200);
      const week47 = (await week47Res.json()) as { weekStartDate: string; weekNumber: number };
      expect(week47.weekStartDate).toBe('2026-11-16');
      expect(week47.weekNumber).toBe(47);

      // PUT /api/review/rule sets rule, then a second PUT with only previousRuleKept preserves ruleForNextWeek
      const setRuleRes = await fetch(`${serverUrl}/api/review/rule`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Veyra-Now': '2026-11-20T15:00:00.000Z' },
        body: JSON.stringify({
          weekStartDate: '2026-11-16',
          ruleForNextWeek: 'Keep mornings clear',
        }),
      });
      expect(setRuleRes.status).toBe(200);

      const setKeptRes = await fetch(`${serverUrl}/api/review/rule`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Veyra-Now': '2026-11-20T15:05:00.000Z' },
        body: JSON.stringify({
          weekStartDate: '2026-11-16',
          previousRuleKept: 'partly',
        }),
      });
      expect(setKeptRes.status).toBe(200);
      const keptPayload = (await setKeptRes.json()) as {
        review: { ruleForNextWeek: string; previousRuleKept: string | null };
      };
      expect(keptPayload.review.ruleForNextWeek).toBe('Keep mornings clear');
      expect(keptPayload.review.previousRuleKept).toBe('partly');

      // POST /api/review/complete persists snapshot and dispatches review.completed webhook
      const completeRes = await fetch(`${serverUrl}/api/review/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Veyra-Now': '2026-11-20T16:00:00.000Z' },
        body: JSON.stringify({
          weekStartDate: '2026-11-16',
          ruleForNextWeek: 'Protect 09:00-11:00 for deep build',
          previousRuleKept: 'yes',
        }),
      });
      expect(completeRes.status).toBe(200);
      const completed = (await completeRes.json()) as {
        review: { completedAt: string | null; snapshotJson: string | null };
        snapshot: { weekStartDate: string; weekNumber: number; ruleForNextWeek: string };
      };
      expect(completed.review.completedAt).toBe('2026-11-20T16:00:00.000Z');
      expect(completed.review.snapshotJson).toBeTruthy();
      expect(completed.snapshot).toMatchObject({
        weekStartDate: '2026-11-16',
        weekNumber: 47,
        ruleForNextWeek: 'Protect 09:00-11:00 for deep build',
      });

      // Wait briefly for fire-and-forget webhook delivery
      const deadline = Date.now() + 3000;
      while (receivedHooks.length === 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(receivedHooks).toHaveLength(1);
      expect(receivedHooks[0].event).toBe('review.completed');
      expect(receivedHooks[0].data).toMatchObject({
        weekStartDate: '2026-11-16',
        weekNumber: 47,
        ruleForNextWeek: 'Protect 09:00-11:00 for deep build',
      });

      // POST /api/review/reopen clears completedAt
      const reopenRes = await fetch(`${serverUrl}/api/review/reopen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Veyra-Now': '2026-11-20T16:30:00.000Z' },
        body: JSON.stringify({ weekStartDate: '2026-11-16' }),
      });
      expect(reopenRes.status).toBe(200);
      const reopened = (await reopenRes.json()) as { review: { completedAt: string | null } };
      expect(reopened.review.completedAt).toBeNull();
    } finally {
      await server.stop();
    }
  });

  it('filters Outlook CLI sync to accepted/organizer events and supports full block focus lifecycle on synced meetings', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veyra-outlook-accepted-'));
    tempDirs.push(tmpDir);
    const dbPath = path.join(tmpDir, 'veyra.db');

    const fakeCliPath = path.join(tmpDir, 'fake-outlook.mjs');
    fs.writeFileSync(
      fakeCliPath,
      `
const events = [
  {
    externalId: 'accepted-1',
    title: 'Covestro order confirmation call',
    startAt: '2026-11-26T10:00:00Z',
    endAt: '2026-11-26T10:30:00Z',
    isAllDay: false,
    isDeclined: false,
    isCancelled: false,
    responseStatus: 'accepted',
    meetingUrl: 'https://teams.microsoft.com/l/meetup-join/covestro',
  },
  {
    externalId: 'organizer-1',
    title: 'UX Accenture',
    startAt: '2026-11-26T14:00:00Z',
    endAt: '2026-11-26T14:45:00Z',
    isAllDay: false,
    isDeclined: false,
    isCancelled: false,
    responseStatus: 'organizer',
    meetingUrl: null,
  },
  {
    externalId: 'not-responded-1',
    title: 'Unanswered Optional Sync',
    startAt: '2026-11-26T11:00:00Z',
    endAt: '2026-11-26T11:30:00Z',
    isAllDay: false,
    isDeclined: false,
    isCancelled: false,
    responseStatus: 'not_responded',
    meetingUrl: null,
  },
  {
    externalId: 'tentative-1',
    title: 'Maybe Lunch',
    startAt: '2026-11-26T12:00:00Z',
    endAt: '2026-11-26T12:30:00Z',
    isAllDay: false,
    isDeclined: false,
    isCancelled: false,
    responseStatus: 'tentatively_accepted',
    meetingUrl: null,
  },
  {
    externalId: 'cancelled-accepted-1',
    title: 'Cancelled Call',
    startAt: '2026-11-26T15:00:00Z',
    endAt: '2026-11-26T15:30:00Z',
    isAllDay: false,
    isDeclined: true,
    isCancelled: true,
    responseStatus: 'accepted',
    meetingUrl: null,
  },
];
process.stdout.write(JSON.stringify(events));
`,
    );

    const server = createVeyraServer({
      dbPath,
      port: 0,
      host: '127.0.0.1',
      enableTestClock: true,
    });
    const { url: serverUrl } = await server.start();

    try {
      await fetch(`${serverUrl}/api/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timezone: 'UTC',
          calendarSyncMode: 'outlook_cli',
          outlookCliCommand: `"${process.execPath}" "${fakeCliPath}"`,
          skipDeclinedAndAllDay: true,
        }),
      });

      const syncRes = await fetch(`${serverUrl}/api/events/sync`, {
        method: 'POST',
        headers: { 'X-Veyra-Now': '2026-11-26T09:00:00.000Z' },
      });
      expect(syncRes.status).toBe(200);
      const syncJson = (await syncRes.json()) as {
        result: { createdCount: number; skippedCount: number };
      };
      expect(syncJson.result.createdCount).toBe(2);
      expect(syncJson.result.skippedCount).toBe(3);

      const todayRes = await fetch(`${serverUrl}/api/today`, {
        headers: { 'X-Veyra-Now': '2026-11-26T09:30:00.000Z' },
      });
      const todayJson = (await todayRes.json()) as {
        upNext: Array<{ id: string }>;
        todayEvents: Array<{ id: string; title: string }>;
        completedToday: Array<{ id: string }>;
        meetingAutoFocusEnabled?: boolean;
      };
      expect(todayJson.meetingAutoFocusEnabled).toBe(true);
      expect(todayJson.upNext).toHaveLength(0);
      expect(todayJson.todayEvents.map((e) => e.title)).toEqual([
        'Covestro order confirmation call',
        'UX Accenture',
      ]);

      const meetingBlockId = todayJson.todayEvents[0].id;

      // Meeting is directly accessible as a block
      const blockRes = await fetch(`${serverUrl}/api/blocks/${meetingBlockId}`);
      expect(blockRes.status).toBe(200);
      const blockJson = (await blockRes.json()) as {
        block: { id: string; calendarSource: string; meetingUrl: string };
      };
      expect(blockJson.block.calendarSource).toBe('outlook_cli');
      expect(blockJson.block.meetingUrl).toBe('https://teams.microsoft.com/l/meetup-join/covestro');

      // Focus and complete directly on the calendar block
      const startRes = await fetch(`${serverUrl}/api/focus/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Veyra-Now': '2026-11-26T10:00:00.000Z' },
        body: JSON.stringify({ blockId: meetingBlockId }),
      });
      expect(startRes.status).toBe(200);

      const completeRes = await fetch(`${serverUrl}/api/focus/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Veyra-Now': '2026-11-26T10:30:00.000Z' },
        body: JSON.stringify({ blockId: meetingBlockId, outcomeNote: 'Confirmed order' }),
      });
      expect(completeRes.status).toBe(200);

      // Completed meeting appears in Today's completedToday and Calendar's sessions (without duplicating plannedBlocks)
      const afterTodayRes = await fetch(`${serverUrl}/api/today`, {
        headers: { 'X-Veyra-Now': '2026-11-26T10:35:00.000Z' },
      });
      const afterToday = (await afterTodayRes.json()) as {
        completedToday: Array<{ id: string }>;
      };
      expect(afterToday.completedToday.some((b) => b.id === meetingBlockId)).toBe(true);

      const calRes = await fetch(`${serverUrl}/api/calendar?start=2026-11-26&end=2026-11-26`, {
        headers: { 'X-Veyra-Now': '2026-11-26T10:35:00.000Z' },
      });
      const calJson = (await calRes.json()) as {
        plannedBlocks: Array<{ id: string }>;
        sessions: Array<{ blockId: string; blockTitle: string }>;
        events: Array<{ id: string }>;
      };
      expect(calJson.plannedBlocks).toHaveLength(0);
      expect(calJson.events).toHaveLength(2);
      expect(calJson.sessions.some((s) => s.blockId === meetingBlockId && s.blockTitle === 'Covestro order confirmation call')).toBe(true);
    } finally {
      await server.stop();
    }
  });
});
