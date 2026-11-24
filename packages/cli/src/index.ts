#!/usr/bin/env node
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runCli } from './commands.js';

export {
  CliUsageError,
  createProgram,
  localDateTimeToIso,
  normalizeRecurrenceRule,
  parseDateTimeOption,
  parseExternalLink,
  runCli,
  type CliIo,
  type ProgramContext,
} from './commands.js';
export {
  VeyraApiError,
  VeyraClient,
  type CalendarResponse,
  type CalendarSessionItem,
  type FocusCloseResponse,
  type FocusCompleteResponse,
  type FocusStartResponse,
  type PlanDayBucket,
  type PlanResponse,
  type ReviewResponse,
  type SettingsResponse,
  type SyncEventsResponse,
  type TodayResponse,
  type VeyraClientOptions,
} from './client.js';
export {
  DEFAULT_SERVER_URL,
  getDefaultConfigPath,
  loadConfig,
  normalizeServerUrl,
  saveConfig,
  type ConfigOptions,
  type ResolvedCliConfig,
  type SaveConfigInput,
  type SaveConfigResult,
  type StoredCliConfig,
} from './config.js';

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(entry);
  } catch {
    return false;
  }
}

if (isDirectExecution()) {
  runCli(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Fatal error: ${msg}\n`);
      process.exitCode = 1;
    },
  );
}
