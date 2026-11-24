import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_CAPTURE_SHORTCUT = 'CommandOrControl+Shift+P';

export type ClientConnectionMode = 'local' | 'remote';

export interface PersistedClientConfig {
  mode: ClientConnectionMode;
  remoteUrl?: string;
  remoteToken?: string;
  cachedShortcut: string;
  cachedRunInMenuBar: boolean;
}

export interface SaveClientConfigInput {
  mode: ClientConnectionMode;
  remoteUrl?: string;
  remoteToken?: string;
}

export interface DesktopPreferencesInput {
  globalCaptureShortcut: string;
  runInMenuBar: boolean;
}

export interface RendererDesktopClientConfig {
  mode: ClientConnectionMode;
  serverUrl: string;
  token?: string | null;
  remoteUrl?: string;
  remoteToken?: string;
}

export const DEFAULT_CLIENT_CONFIG: PersistedClientConfig = {
  mode: 'local',
  cachedShortcut: DEFAULT_CAPTURE_SHORTCUT,
  cachedRunInMenuBar: true,
};

function normalizeUrl(raw?: string | null): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return undefined;
  }
  return parsed.toString().replace(/\/+$/, '');
}

function normalizeToken(raw?: string | null): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeShortcut(raw?: string | null): string {
  if (typeof raw !== 'string') return DEFAULT_CAPTURE_SHORTCUT;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_CAPTURE_SHORTCUT;
}

function buildPersistedConfig(raw: Partial<PersistedClientConfig>): PersistedClientConfig {
  const remoteUrl = normalizeUrl(raw.remoteUrl);
  const mode: ClientConnectionMode =
    raw.mode === 'remote' && remoteUrl !== undefined ? 'remote' : 'local';
  const remoteToken = normalizeToken(raw.remoteToken);
  const cachedShortcut = normalizeShortcut(raw.cachedShortcut);
  const cachedRunInMenuBar =
    typeof raw.cachedRunInMenuBar === 'boolean' ? raw.cachedRunInMenuBar : true;

  const config: PersistedClientConfig = {
    mode,
    cachedShortcut,
    cachedRunInMenuBar,
  };

  if (remoteUrl !== undefined) {
    config.remoteUrl = remoteUrl;
  }
  if (remoteToken !== undefined) {
    config.remoteToken = remoteToken;
  }

  return config;
}

function writeConfigFile(configPath: string, config: PersistedClientConfig): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  if (process.platform !== 'win32') {
    fs.chmodSync(configPath, 0o600);
  }
}

export function loadClientConfig(configPath: string): PersistedClientConfig {
  if (!fs.existsSync(configPath)) {
    return { ...DEFAULT_CLIENT_CONFIG };
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ...DEFAULT_CLIENT_CONFIG };
    }
    return buildPersistedConfig(parsed as Partial<PersistedClientConfig>);
  } catch {
    return { ...DEFAULT_CLIENT_CONFIG };
  }
}

export function saveClientConfig(
  configPath: string,
  input: SaveClientConfigInput,
): PersistedClientConfig {
  const hasRemoteUrl = typeof input.remoteUrl === 'string' && input.remoteUrl.trim().length > 0;
  const normalizedRemoteUrl = normalizeUrl(input.remoteUrl);
  if ((input.mode === 'remote' || hasRemoteUrl) && !normalizedRemoteUrl) {
    throw new Error('Remote server URL must be a valid http:// or https:// URL');
  }

  const existing = loadClientConfig(configPath);
  const next = buildPersistedConfig({
    mode: input.mode,
    remoteUrl: input.mode === 'remote' ? normalizedRemoteUrl : undefined,
    remoteToken: input.mode === 'remote' ? input.remoteToken : undefined,
    cachedShortcut: existing.cachedShortcut,
    cachedRunInMenuBar: existing.cachedRunInMenuBar,
  });

  writeConfigFile(configPath, next);
  return next;
}

export function updateDesktopPreferences(
  configPath: string,
  prefs: DesktopPreferencesInput,
): PersistedClientConfig {
  const existing = loadClientConfig(configPath);
  const next = buildPersistedConfig({
    ...existing,
    cachedShortcut: prefs.globalCaptureShortcut,
    cachedRunInMenuBar: prefs.runInMenuBar,
  });

  writeConfigFile(configPath, next);
  return next;
}

export function resolveDesktopClientConfig(
  config: PersistedClientConfig,
  localServerUrl: string,
): RendererDesktopClientConfig {
  const normalizedLocal = normalizeUrl(localServerUrl) ?? localServerUrl;

  if (config.mode === 'remote' && config.remoteUrl) {
    return {
      mode: 'remote',
      serverUrl: config.remoteUrl,
      token: config.remoteToken ?? null,
      remoteUrl: config.remoteUrl,
      remoteToken: config.remoteToken,
    };
  }

  return {
    mode: 'local',
    serverUrl: normalizedLocal,
    token: null,
    remoteUrl: config.remoteUrl,
    remoteToken: config.remoteToken,
  };
}
