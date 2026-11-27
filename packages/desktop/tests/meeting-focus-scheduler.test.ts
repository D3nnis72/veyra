import type { CalendarEvent, FocusSession } from '@veyra/core';
import { describe, expect, it, vi } from 'vitest';
import {
  MeetingFocusScheduler,
  type MeetingNotificationSpec,
} from '../src/meeting-focus-scheduler.js';
import {
  EMPTY_MENUBAR_FOCUS_STATE,
  type MenuBarFocusState,
} from '../src/menubar-focus.js';

function makeMeeting(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    externalId: 'ext-meeting-1',
    title: 'Covestro order confirmation call',
    startAt: '2026-11-26T10:00:00.000Z',
    endAt: '2026-11-26T10:30:00.000Z',
    meetingUrl: 'https://teams.microsoft.com/l/meetup-join/covestro',
    source: 'outlook_cli',
    projectId: null,
    goalId: null,
    isOps: false,
    notes: '',
    externalLinks: [],
    status: 'todo',
    updatedAt: '2026-11-26T08:00:00.000Z',
    deletedAt: null,
    ...overrides,
  };
}

function makeSession(blockId: string, startedAt = '2026-11-26T09:30:00.000Z'): FocusSession {
  return {
    id: '99999999-9999-4999-8999-999999999999',
    blockId,
    startedAt,
    endedAt: null,
    note: null,
    updatedAt: startedAt,
    deletedAt: null,
  };
}

describe('MeetingFocusScheduler', () => {
  it('auto-starts focus and notifies when idle at meeting start, then notifies to complete at end while keeping timer running', async () => {
    const meeting = makeMeeting();
    let nowMs = Date.parse('2026-11-26T09:59:00.000Z');
    let state: MenuBarFocusState = {
      ...EMPTY_MENUBAR_FOCUS_STATE,
      hasTodaySynced: true,
      meetingAutoFocusEnabled: true,
      todayEvents: [meeting],
    };

    const notifications: MeetingNotificationSpec[] = [];
    const onOpenFocus = vi.fn();
    const onOpenFocusComplete = vi.fn();
    const startFocus = vi.fn(async (blockId: string) => {
      state = {
        ...state,
        activeSession: makeSession(blockId, new Date(nowMs).toISOString()),
        activeBlock: { id: blockId, title: meeting.title },
      };
      return true;
    });

    const scheduler = new MeetingFocusScheduler({
      getState: () => state,
      startFocus,
      showNotification: (spec) => notifications.push(spec),
      onOpenFocus,
      onOpenFocusComplete,
      nowFn: () => nowMs,
    });

    // Before start: seeds cleanly, does nothing
    await scheduler.evaluate();
    expect(startFocus).not.toHaveBeenCalled();
    expect(notifications).toHaveLength(0);

    // At 10:00:10 -> idle, so auto-starts focus and emits auto-started notification
    nowMs = Date.parse('2026-11-26T10:00:10.000Z');
    await scheduler.evaluate();
    expect(startFocus).toHaveBeenCalledTimes(1);
    expect(startFocus).toHaveBeenCalledWith(meeting.id);
    expect(notifications).toHaveLength(1);
    expect(notifications[0].kind).toBe('meeting-auto-started');
    expect(notifications[0].title).toContain(meeting.title);

    // Repeated evaluation during meeting never fires a duplicate start
    nowMs = Date.parse('2026-11-26T10:00:30.000Z');
    await scheduler.evaluate();
    expect(startFocus).toHaveBeenCalledTimes(1);
    expect(notifications).toHaveLength(1);

    // Clicking auto-started notification opens Focus
    notifications[0].onClick();
    expect(onOpenFocus).toHaveBeenCalledTimes(1);

    // At 10:30:05 -> still focusing on meeting, emits end notification without stopping timer
    nowMs = Date.parse('2026-11-26T10:30:05.000Z');
    await scheduler.evaluate();
    expect(notifications).toHaveLength(2);
    expect(notifications[1].kind).toBe('meeting-ended');
    expect(notifications[1].body).toContain('Timer is still running');
    expect(state.activeSession).not.toBeNull();

    // Clicking end notification opens Focus Complete panel
    notifications[1].onClick();
    expect(onOpenFocusComplete).toHaveBeenCalledTimes(1);

    // Repeated evaluation after end never fires duplicate end notification
    nowMs = Date.parse('2026-11-26T10:31:00.000Z');
    await scheduler.evaluate();
    expect(notifications).toHaveLength(2);
  });

  it('does not interrupt an active focus block at meeting start, instead sends a switch notification that switches on click', async () => {
    const meeting = makeMeeting();
    const otherBlockId = '22222222-2222-4222-8222-222222222222';
    let nowMs = Date.parse('2026-11-26T09:59:00.000Z');
    let state: MenuBarFocusState = {
      ...EMPTY_MENUBAR_FOCUS_STATE,
      hasTodaySynced: true,
      meetingAutoFocusEnabled: true,
      todayEvents: [meeting],
      activeSession: makeSession(otherBlockId),
      activeBlock: { id: otherBlockId, title: 'Deep work block' },
    };

    const notifications: MeetingNotificationSpec[] = [];
    const onOpenFocus = vi.fn();
    const startFocus = vi.fn(async () => true);

    const scheduler = new MeetingFocusScheduler({
      getState: () => state,
      startFocus,
      showNotification: (spec) => notifications.push(spec),
      onOpenFocus,
      onOpenFocusComplete: vi.fn(),
      nowFn: () => nowMs,
    });

    await scheduler.evaluate();

    nowMs = Date.parse('2026-11-26T10:00:05.000Z');
    await scheduler.evaluate();

    // Must NOT auto-start over active block
    expect(startFocus).not.toHaveBeenCalled();
    expect(notifications).toHaveLength(1);
    expect(notifications[0].kind).toBe('meeting-switch-prompt');
    expect(notifications[0].body).toContain('Deep work block');

    // Clicking the switch notification starts focus on the meeting block and opens Focus
    notifications[0].onClick();
    await Promise.resolve();
    expect(startFocus).toHaveBeenCalledWith(meeting.id);
    expect(onOpenFocus).toHaveBeenCalledTimes(1);
  });

  it('skips meetings that already started before app launch and respects meetingAutoFocusEnabled=false', async () => {
    const alreadyRunningMeeting = makeMeeting({
      startAt: '2026-11-26T09:00:00.000Z',
      endAt: '2026-11-26T10:00:00.000Z',
    });
    const upcomingMeeting = makeMeeting({
      id: '33333333-3333-4333-8333-333333333333',
      externalId: 'ext-meeting-2',
      title: 'UX Accenture',
      startAt: '2026-11-26T10:05:00.000Z',
      endAt: '2026-11-26T10:35:00.000Z',
    });

    // App launches at 09:01 (60s into first meeting)
    let nowMs = Date.parse('2026-11-26T09:01:00.000Z');
    let state: MenuBarFocusState = {
      ...EMPTY_MENUBAR_FOCUS_STATE,
      hasTodaySynced: true,
      meetingAutoFocusEnabled: true,
      todayEvents: [alreadyRunningMeeting, upcomingMeeting],
    };

    const startFocus = vi.fn(async () => true);
    const notifications: MeetingNotificationSpec[] = [];

    const scheduler = new MeetingFocusScheduler({
      getState: () => state,
      startFocus,
      showNotification: (spec) => notifications.push(spec),
      onOpenFocus: vi.fn(),
      onOpenFocusComplete: vi.fn(),
      nowFn: () => nowMs,
    });

    await scheduler.evaluate();
    expect(startFocus).not.toHaveBeenCalled();
    expect(notifications).toHaveLength(0);

    // Disable auto-focus before 10:05 -> nothing fires
    state = { ...state, meetingAutoFocusEnabled: false };
    nowMs = Date.parse('2026-11-26T10:05:05.000Z');
    await scheduler.evaluate();
    expect(startFocus).not.toHaveBeenCalled();
    expect(notifications).toHaveLength(0);
  });
});
