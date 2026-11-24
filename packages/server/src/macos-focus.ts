import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  type MacOsFocusPhase,
  type MacOsFocusRunResult,
  type MacOsFocusShortcutsResponse,
  type VeyraDb,
  getSettings,
  recordActivity,
} from '@veyra/core';

const execFileAsync = promisify(execFile);

export type ShortcutsExecRunner = (
  binary: string,
  args: readonly string[],
  timeoutMs: number,
) => Promise<{ stdout: string; stderr: string }>;

export interface MacOsFocusPresenceOptions {
  /** Override platform detection (defaults to `process.platform`). */
  platform?: NodeJS.Platform;
  /** Override path to macOS `shortcuts` CLI (defaults to `/usr/bin/shortcuts`). */
  shortcutsBin?: string;
  /** Execution timeout in milliseconds (defaults to `10_000`). */
  timeoutMs?: number;
  /** Injectable command runner for deterministic tests. */
  execRunner?: ShortcutsExecRunner;
}

const DEFAULT_SHORTCUTS_BIN = '/usr/bin/shortcuts';
const DEFAULT_TIMEOUT_MS = 10_000;

async function defaultExecRunner(
  binary: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync(binary, [...args], {
    timeout: timeoutMs,
    maxBuffer: 512 * 1024,
  });
  return {
    stdout: String(stdout ?? ''),
    stderr: String(stderr ?? ''),
  };
}

/**
 * Triggers optional macOS Focus / Do Not Disturb Shortcuts when a Veyra focus
 * session starts or ends.
 *
 * Uses `/usr/bin/shortcuts run <name>` (macOS built-in Shortcuts CLI) so users
 * can bind any native macOS Focus mode (`Do Not Disturb`, `Work`, `Deep Focus`)
 * without private plist hacks, while remaining a clean no-op on non-macOS hosts.
 */
export class MacOsFocusPresence {
  private readonly db: VeyraDb;
  private readonly platform: NodeJS.Platform;
  private readonly shortcutsBin: string;
  private readonly timeoutMs: number;
  private readonly execRunner: ShortcutsExecRunner;

  constructor(db: VeyraDb, options?: MacOsFocusPresenceOptions) {
    this.db = db;
    this.platform = options?.platform ?? process.platform;
    this.shortcutsBin = options?.shortcutsBin ?? DEFAULT_SHORTCUTS_BIN;
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.execRunner = options?.execRunner ?? defaultExecRunner;
  }

  isSupported(): boolean {
    return this.platform === 'darwin';
  }

  async listInstalledShortcuts(): Promise<MacOsFocusShortcutsResponse> {
    if (!this.isSupported()) {
      return { supported: false, shortcuts: [] };
    }
    try {
      const { stdout } = await this.execRunner(
        this.shortcutsBin,
        ['list'],
        this.timeoutMs,
      );
      const shortcuts = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      return { supported: true, shortcuts };
    } catch {
      return { supported: true, shortcuts: [] };
    }
  }

  async onFocusStarted(options?: {
    hadActiveSession?: boolean;
    now?: Date;
  }): Promise<MacOsFocusRunResult> {
    const settings = getSettings(this.db);
    if (!settings.macosFocusEnabled) {
      return {
        ok: true,
        phase: 'start',
        shortcutName: settings.macosFocusStartShortcut,
        skipped: true,
        reason: 'macOS Focus presence is disabled',
      };
    }

    // Switching straight from one active block to another keeps macOS Focus on
    // without flickering off and back on.
    if (options?.hadActiveSession) {
      return {
        ok: true,
        phase: 'start',
        shortcutName: settings.macosFocusStartShortcut,
        skipped: true,
        reason: 'Already focusing; keeping current macOS Focus active',
      };
    }

    return this.runShortcut('start', settings.macosFocusStartShortcut, options?.now);
  }

  async onFocusEnded(options?: { now?: Date }): Promise<MacOsFocusRunResult> {
    const settings = getSettings(this.db);
    if (!settings.macosFocusEnabled) {
      return {
        ok: true,
        phase: 'end',
        shortcutName: settings.macosFocusEndShortcut,
        skipped: true,
        reason: 'macOS Focus presence is disabled',
      };
    }

    return this.runShortcut('end', settings.macosFocusEndShortcut, options?.now);
  }

  async testShortcut(
    phase: MacOsFocusPhase,
    overrideShortcutName?: string,
    now?: Date,
  ): Promise<MacOsFocusRunResult> {
    const settings = getSettings(this.db);
    const configuredName =
      phase === 'start'
        ? settings.macosFocusStartShortcut
        : settings.macosFocusEndShortcut;
    const targetName =
      overrideShortcutName !== undefined
        ? overrideShortcutName.trim() || null
        : configuredName;

    return this.runShortcut(phase, targetName, now);
  }

  private async runShortcut(
    phase: MacOsFocusPhase,
    shortcutName: string | null,
    now?: Date,
  ): Promise<MacOsFocusRunResult> {
    const trimmed = shortcutName?.trim() || null;
    if (!trimmed) {
      return {
        ok: false,
        phase,
        shortcutName: null,
        skipped: true,
        reason: `No macOS ${phase === 'start' ? 'start' : 'end'} shortcut configured`,
      };
    }

    if (!this.isSupported()) {
      return {
        ok: false,
        phase,
        shortcutName: trimmed,
        skipped: true,
        reason: 'macOS Focus shortcuts are only supported on macOS (darwin)',
      };
    }

    try {
      await this.execRunner(
        this.shortcutsBin,
        ['run', trimmed],
        this.timeoutMs,
      );
      recordActivity(
        this.db,
        'hook',
        phase === 'start' ? 'macos_focus.activated' : 'macos_focus.deactivated',
        `Ran macOS Focus ${phase} shortcut "${trimmed}"`,
        now ?? new Date(),
      );
      return {
        ok: true,
        phase,
        shortcutName: trimmed,
        skipped: false,
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to execute macOS shortcut';
      recordActivity(
        this.db,
        'hook',
        'macos_focus.failed',
        `macOS Focus ${phase} shortcut "${trimmed}" failed: ${message}`,
        now ?? new Date(),
      );
      return {
        ok: false,
        phase,
        shortcutName: trimmed,
        skipped: false,
        error: message,
      };
    }
  }
}
