import { eq } from 'drizzle-orm';
import type { VeyraDb } from '../db.js';
import { NotFoundError, ValidationError, parseWithZod } from '../errors.js';
import { settings } from '../schema.js';
import { isValidTimeZone } from '../time.js';
import {
  DEFAULT_SETTINGS_ID,
  type NotionTokenSource,
  type PublicSettings,
  type Settings,
  type UpdateSettingsInput,
  updateSettingsInputSchema,
} from '../types.js';
import {
  type ServiceMutationOptions,
  recordActivity,
  resolveActor,
  resolveNow,
} from './internal.js';

export function resolveNotionToken(
  row: Pick<Settings, 'notionToken'>,
  envNotionToken?: string | null,
): { token: string | null; source: NotionTokenSource | null } {
  const fromSettings = row.notionToken?.trim();
  if (fromSettings) {
    return { token: fromSettings, source: 'settings' };
  }
  const fromEnv = envNotionToken?.trim();
  if (fromEnv) {
    return { token: fromEnv, source: 'env' };
  }
  return { token: null, source: null };
}

export function toPublicSettings(
  row: Settings,
  envNotionToken?: string | null,
): PublicSettings {
  const { notionToken: _secret, ...rest } = row;
  const { source } = resolveNotionToken(row, envNotionToken);
  return {
    ...rest,
    notionConfigured: source !== null,
    notionTokenSource: source,
  };
}

export function getSettings(veyraDb: VeyraDb): Settings {
  const row = veyraDb.db
    .select()
    .from(settings)
    .where(eq(settings.id, DEFAULT_SETTINGS_ID))
    .get();
  if (!row) {
    throw new NotFoundError('Settings row not initialized');
  }
  return row as Settings;
}

export function updateSettings(
  veyraDb: VeyraDb,
  patch: UpdateSettingsInput,
  options?: ServiceMutationOptions,
): Settings {
  const existing = getSettings(veyraDb);
  const parsed = parseWithZod(updateSettingsInputSchema, patch);

  if (parsed.timezone !== undefined && !isValidTimeZone(parsed.timezone)) {
    throw new ValidationError(`Invalid IANA timezone: '${parsed.timezone}'`);
  }

  const nowIso = resolveNow(options?.now).toISOString();
  const actor = resolveActor(options?.actor);

  const updated: Settings = {
    ...existing,
    theme: parsed.theme ?? existing.theme,
    timezone: parsed.timezone ?? existing.timezone,
    onboardingCompleted: parsed.onboardingCompleted ?? existing.onboardingCompleted,
    serverUrl: parsed.serverUrl !== undefined ? parsed.serverUrl : existing.serverUrl,
    calendarSyncMode: parsed.calendarSyncMode ?? existing.calendarSyncMode,
    outlookCliCommand:
      parsed.outlookCliCommand !== undefined
        ? parsed.outlookCliCommand
        : existing.outlookCliCommand,
    icsFeedUrl: parsed.icsFeedUrl !== undefined ? parsed.icsFeedUrl : existing.icsFeedUrl,
    calendarSyncIntervalMin:
      parsed.calendarSyncIntervalMin ?? existing.calendarSyncIntervalMin,
    skipDeclinedAndAllDay:
      parsed.skipDeclinedAndAllDay ?? existing.skipDeclinedAndAllDay,
    lastCalendarSyncAt:
      parsed.lastCalendarSyncAt !== undefined
        ? parsed.lastCalendarSyncAt
        : existing.lastCalendarSyncAt,
    webhookUrl: parsed.webhookUrl !== undefined ? parsed.webhookUrl : existing.webhookUrl,
    webhookEvents: parsed.webhookEvents ?? existing.webhookEvents,
    notionToken:
      parsed.notionToken !== undefined
        ? parsed.notionToken?.trim() || null
        : existing.notionToken,
    globalCaptureShortcut:
      parsed.globalCaptureShortcut ?? existing.globalCaptureShortcut,
    runInMenuBar: parsed.runInMenuBar ?? existing.runInMenuBar,
    updatedAt: nowIso,
  };

  veyraDb.sqlite.transaction(() => {
    veyraDb.db
      .update(settings)
      .set({
        theme: updated.theme,
        timezone: updated.timezone,
        onboardingCompleted: updated.onboardingCompleted,
        serverUrl: updated.serverUrl,
        calendarSyncMode: updated.calendarSyncMode,
        outlookCliCommand: updated.outlookCliCommand,
        icsFeedUrl: updated.icsFeedUrl,
        calendarSyncIntervalMin: updated.calendarSyncIntervalMin,
        skipDeclinedAndAllDay: updated.skipDeclinedAndAllDay,
        lastCalendarSyncAt: updated.lastCalendarSyncAt,
        webhookUrl: updated.webhookUrl,
        webhookEvents: updated.webhookEvents,
        notionToken: updated.notionToken,
        globalCaptureShortcut: updated.globalCaptureShortcut,
        runInMenuBar: updated.runInMenuBar,
        updatedAt: updated.updatedAt,
      })
      .where(eq(settings.id, DEFAULT_SETTINGS_ID))
      .run();

    recordActivity(veyraDb, actor, 'settings.updated', 'Updated settings', nowIso);
  })();

  return updated;
}
