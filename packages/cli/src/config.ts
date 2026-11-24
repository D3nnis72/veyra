import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type ActivityActor, activityActorSchema } from '@veyra/core/types';
import { z } from 'zod';

export const DEFAULT_SERVER_URL = 'http://127.0.0.1:4173';

const storedConfigSchema = z.object({
  serverUrl: z.string().min(1).optional(),
  url: z.string().min(1).optional(),
  token: z.string().min(1).optional(),
});

export interface StoredCliConfig {
  serverUrl?: string;
  token?: string;
}

export interface ResolvedCliConfig {
  serverUrl: string;
  token?: string;
  actor: ActivityActor;
  now?: string;
  configPath: string;
  sources: {
    serverUrl: 'env' | 'file' | 'default';
    token: 'env' | 'file' | 'none';
  };
}

export interface ConfigOptions {
  env?: NodeJS.ProcessEnv;
  configPath?: string;
}

export function getDefaultConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.VEYRA_CONFIG_PATH?.trim();
  if (fromEnv) {
    return path.resolve(fromEnv);
  }
  return path.join(os.homedir(), '.veyra', 'config.json');
}

export function normalizeServerUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('Server URL must not be empty');
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Invalid server URL: '${raw}'`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Server URL must use http or https protocol: '${raw}'`);
  }
  return parsed.toString().replace(/\/+$/, '');
}

function readStoredConfigFile(configPath: string): StoredCliConfig {
  if (!fs.existsSync(configPath)) {
    return {};
  }
  const rawText = fs.readFileSync(configPath, 'utf8');
  if (!rawText.trim()) {
    return {};
  }
  let json: unknown;
  try {
    json = JSON.parse(rawText);
  } catch {
    throw new Error(`Failed to parse config file at '${configPath}': invalid JSON`);
  }
  const parsed = storedConfigSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Invalid config file at '${configPath}': ${parsed.error.message}`);
  }
  const rawUrl = parsed.data.serverUrl ?? parsed.data.url;
  return {
    ...(rawUrl ? { serverUrl: normalizeServerUrl(rawUrl) } : {}),
    ...(parsed.data.token?.trim() ? { token: parsed.data.token.trim() } : {}),
  };
}

export function loadConfig(options?: ConfigOptions): ResolvedCliConfig {
  const env = options?.env ?? process.env;
  const configPath = options?.configPath ? path.resolve(options.configPath) : getDefaultConfigPath(env);
  const fileConfig = readStoredConfigFile(configPath);

  const envUrl = env.VEYRA_SERVER_URL?.trim();
  let serverUrl: string;
  let serverUrlSource: 'env' | 'file' | 'default';
  if (envUrl) {
    serverUrl = normalizeServerUrl(envUrl);
    serverUrlSource = 'env';
  } else if (fileConfig.serverUrl) {
    serverUrl = fileConfig.serverUrl;
    serverUrlSource = 'file';
  } else {
    serverUrl = DEFAULT_SERVER_URL;
    serverUrlSource = 'default';
  }

  const envToken = env.VEYRA_TOKEN?.trim();
  let token: string | undefined;
  let tokenSource: 'env' | 'file' | 'none';
  if (envToken) {
    token = envToken;
    tokenSource = 'env';
  } else if (fileConfig.token) {
    token = fileConfig.token;
    tokenSource = 'file';
  } else {
    token = undefined;
    tokenSource = 'none';
  }

  const rawActor = env.VEYRA_ACTOR?.trim();
  let actor: ActivityActor = 'cli';
  if (rawActor) {
    const parsedActor = activityActorSchema.safeParse(rawActor);
    if (!parsedActor.success) {
      throw new Error(
        `Invalid VEYRA_ACTOR value '${rawActor}'. Expected one of: user, cli, agent, hook`,
      );
    }
    actor = parsedActor.data;
  }

  const now = env.VEYRA_NOW?.trim() || undefined;

  return {
    serverUrl,
    ...(token ? { token } : {}),
    actor,
    ...(now ? { now } : {}),
    configPath,
    sources: {
      serverUrl: serverUrlSource,
      token: tokenSource,
    },
  };
}

export interface SaveConfigInput {
  serverUrl?: string;
  token?: string | null;
}

export interface SaveConfigResult {
  configPath: string;
  serverUrl?: string;
  tokenConfigured: boolean;
}

export function saveConfig(
  updates: SaveConfigInput,
  options?: ConfigOptions,
): SaveConfigResult {
  const env = options?.env ?? process.env;
  const configPath = options?.configPath ? path.resolve(options.configPath) : getDefaultConfigPath(env);

  let existing: StoredCliConfig = {};
  if (fs.existsSync(configPath)) {
    try {
      existing = readStoredConfigFile(configPath);
    } catch {
      existing = {};
    }
  }

  const next: StoredCliConfig = { ...existing };
  if (updates.serverUrl !== undefined) {
    next.serverUrl = normalizeServerUrl(updates.serverUrl);
  }
  if (updates.token !== undefined) {
    if (updates.token === null || updates.token.trim() === '') {
      delete next.token;
    } else {
      next.token = updates.token.trim();
    }
  }

  const dir = path.dirname(configPath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });

  return {
    configPath,
    ...(next.serverUrl ? { serverUrl: next.serverUrl } : {}),
    tokenConfigured: Boolean(next.token),
  };
}
