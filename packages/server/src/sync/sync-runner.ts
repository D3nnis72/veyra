import {
  addDaysToDateString,
  formatLocalDate,
  getSettings,
  recordActivity,
  updateSettings,
  upsertCalendarEvents,
  type CalendarSyncStatus,
  type Settings,
  type VeyraDb,
} from '@veyra/core';
import { IcsFeedAdapter } from './ics-adapter.js';
import { OutlookCliAdapter } from './outlook-cli-adapter.js';
import {
  type CalendarSyncAdapter,
  CalendarSyncError,
  type CalendarSyncRunResult,
} from './types.js';

export interface CalendarSyncedEvent {
  type: 'events.synced';
  entity: 'calendar_event';
  timestamp: string;
  count: number;
}

export interface CalendarSyncRunnerOptions {
  onSynced?: (event: CalendarSyncedEvent) => void;
  adapterFactory?: (settings: Settings) => CalendarSyncAdapter | null;
  windowDaysBack?: number;
  windowDaysForward?: number;
}

function defaultAdapterFactory(settings: Settings): CalendarSyncAdapter | null {
  if (settings.calendarSyncMode === 'outlook_cli') {
    if (!settings.outlookCliCommand || !settings.outlookCliCommand.trim()) {
      throw new CalendarSyncError(
        'OUTLOOK_CLI_NOT_CONFIGURED',
        'Outlook CLI sync is enabled, but outlookCliCommand is not configured in Settings.',
      );
    }
    return new OutlookCliAdapter({ command: settings.outlookCliCommand });
  }
  if (settings.calendarSyncMode === 'ics') {
    if (!settings.icsFeedUrl || !settings.icsFeedUrl.trim()) {
      throw new CalendarSyncError(
        'ICS_URL_NOT_CONFIGURED',
        'ICS feed sync is enabled, but icsFeedUrl is not configured in Settings.',
      );
    }
    return new IcsFeedAdapter({ url: settings.icsFeedUrl });
  }
  return null;
}

export class CalendarSyncRunner {
  private readonly veyraDb: VeyraDb;
  private readonly onSynced?: (event: CalendarSyncedEvent) => void;
  private readonly adapterFactory: (settings: Settings) => CalendarSyncAdapter | null;
  private readonly windowDaysBack: number;
  private readonly windowDaysForward: number;

  private timer: ReturnType<typeof setInterval> | null = null;
  private inflight: Promise<CalendarSyncRunResult> | null = null;
  private lastSyncAt: string | null = null;
  private lastCount = 0;
  private lastError: string | null = null;

  constructor(veyraDb: VeyraDb, options?: CalendarSyncRunnerOptions) {
    this.veyraDb = veyraDb;
    this.onSynced = options?.onSynced;
    this.adapterFactory = options?.adapterFactory ?? defaultAdapterFactory;
    this.windowDaysBack = options?.windowDaysBack ?? 7;
    this.windowDaysForward = options?.windowDaysForward ?? 28;
  }

  getStatus(): CalendarSyncStatus {
    const settings = getSettings(this.veyraDb);
    const lastSyncAt = this.lastSyncAt ?? settings.lastCalendarSyncAt;
    if (settings.calendarSyncMode === 'manual') {
      return {
        state: 'manual',
        lastSyncAt,
        lastCount: this.lastCount,
        lastError: null,
      };
    }
    if (this.lastError !== null) {
      return {
        state: 'error',
        lastSyncAt,
        lastCount: this.lastCount,
        lastError: this.lastError,
      };
    }
    return {
      state: 'connected',
      lastSyncAt,
      lastCount: this.lastCount,
      lastError: null,
    };
  }

  async syncNow(now?: Date | string): Promise<CalendarSyncRunResult> {
    if (this.inflight) {
      return this.inflight;
    }

    const run = this.executeSync(now).finally(() => {
      this.inflight = null;
    });
    this.inflight = run;
    return run;
  }

  private async executeSync(now?: Date | string): Promise<CalendarSyncRunResult> {
    const nowDate = now ? (typeof now === 'string' ? new Date(now) : now) : new Date();
    const nowIso = nowDate.toISOString();
    const settings = getSettings(this.veyraDb);

    if (settings.calendarSyncMode === 'manual') {
      this.lastError = null;
      return {
        status: this.getStatus(),
        upsertedCount: 0,
        createdCount: 0,
        updatedCount: 0,
        skippedCount: 0,
        deletedCount: 0,
      };
    }

    try {
      const adapter = this.adapterFactory(settings);
      if (!adapter) {
        this.lastError = null;
        return {
          status: this.getStatus(),
          upsertedCount: 0,
          createdCount: 0,
          updatedCount: 0,
          skippedCount: 0,
          deletedCount: 0,
        };
      }

      const today = formatLocalDate(nowDate, settings.timezone);
      const startDate = addDaysToDateString(today, -this.windowDaysBack);
      const endDate = addDaysToDateString(today, this.windowDaysForward);

      const fetchedEvents = await adapter.fetchEvents({ startDate, endDate });
      const upsertResult = upsertCalendarEvents(this.veyraDb, adapter.name, fetchedEvents, {
        now: nowDate,
        actor: 'hook',
      });

      updateSettings(
        this.veyraDb,
        { lastCalendarSyncAt: nowIso },
        { now: nowDate, actor: 'hook' },
      );

      this.lastSyncAt = nowIso;
      this.lastCount = upsertResult.upserted.length;
      this.lastError = null;

      this.onSynced?.({
        type: 'events.synced',
        entity: 'calendar_event',
        timestamp: nowIso,
        count: upsertResult.upserted.length,
      });

      return {
        status: this.getStatus(),
        upsertedCount: upsertResult.upserted.length,
        createdCount: upsertResult.createdCount,
        updatedCount: upsertResult.updatedCount,
        skippedCount: upsertResult.skippedCount,
        deletedCount: upsertResult.deletedCount,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.lastError = message;
      try {
        recordActivity(
          this.veyraDb,
          'hook',
          'calendar.sync_failed',
          `Calendar sync (${settings.calendarSyncMode}) failed: ${message}`,
          nowDate,
        );
      } catch {
        // Ignore logging failure if DB is already closing
      }

      return {
        status: this.getStatus(),
        upsertedCount: 0,
        createdCount: 0,
        updatedCount: 0,
        skippedCount: 0,
        deletedCount: 0,
        error: message,
      };
    }
  }

  startPolling(): void {
    this.stopPolling();
    const settings = getSettings(this.veyraDb);
    if (settings.calendarSyncMode === 'manual') {
      return;
    }
    const intervalMs = Math.max(1, settings.calendarSyncIntervalMin) * 60_000;
    this.timer = setInterval(() => {
      void this.syncNow();
    }, intervalMs);
    this.timer.unref();
  }

  stopPolling(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  restartPolling(): void {
    this.stopPolling();
    this.lastError = null;
    this.startPolling();
  }
}
