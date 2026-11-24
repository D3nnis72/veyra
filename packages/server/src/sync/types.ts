import type { CalendarSyncStatus, NormalizedCalendarEvent } from '@veyra/core';

export type { CalendarSyncStatus, NormalizedCalendarEvent };

export interface CalendarSyncWindow {
  startDate: string;
  endDate: string;
}

export interface CalendarSyncAdapter {
  readonly name: 'outlook_cli' | 'ics';
  fetchEvents(window: CalendarSyncWindow): Promise<NormalizedCalendarEvent[]>;
}

export interface CalendarSyncRunResult {
  status: CalendarSyncStatus;
  upsertedCount: number;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  deletedCount: number;
  error?: string;
}

export class CalendarSyncError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'CalendarSyncError';
    this.code = code;
  }
}
