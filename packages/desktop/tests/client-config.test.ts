import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_CAPTURE_SHORTCUT,
  DEFAULT_CLIENT_CONFIG,
  loadClientConfig,
  resolveDesktopClientConfig,
  saveClientConfig,
  updateDesktopPreferences,
} from '../src/client-config.js';

const tempDirs: string[] = [];

function createTempConfigPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veyra-desktop-config-'));
  tempDirs.push(dir);
  return path.join(dir, 'nested', 'client-config.json');
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('@veyra/desktop client-config', () => {
  it('loads defaults (mode: local) when no config file exists', () => {
    const configPath = createTempConfigPath();
    const config = loadClientConfig(configPath);

    expect(config).toEqual(DEFAULT_CLIENT_CONFIG);
    expect(config.mode).toBe('local');
    expect(config.cachedShortcut).toBe(DEFAULT_CAPTURE_SHORTCUT);
    expect(config.cachedRunInMenuBar).toBe(true);
    expect(config.remoteUrl).toBeUndefined();
    expect(config.remoteToken).toBeUndefined();
  });

  it('saves and reloads mode: remote with remoteUrl and remoteToken', () => {
    const configPath = createTempConfigPath();
    const saved = saveClientConfig(configPath, {
      mode: 'remote',
      remoteUrl: 'https://veyra.example.com///',
      remoteToken: '  secret-token-123  ',
    });

    expect(saved.mode).toBe('remote');
    expect(saved.remoteUrl).toBe('https://veyra.example.com');
    expect(saved.remoteToken).toBe('secret-token-123');
    expect(fs.existsSync(configPath)).toBe(true);

    const reloaded = loadClientConfig(configPath);
    expect(reloaded.mode).toBe('remote');
    expect(reloaded.remoteUrl).toBe('https://veyra.example.com');
    expect(reloaded.remoteToken).toBe('secret-token-123');
    expect(reloaded.cachedShortcut).toBe(DEFAULT_CAPTURE_SHORTCUT);
    expect(reloaded.cachedRunInMenuBar).toBe(true);
  });

  it('preserves cached desktop preferences when switching connection modes', () => {
    const configPath = createTempConfigPath();
    updateDesktopPreferences(configPath, {
      globalCaptureShortcut: 'CommandOrControl+Shift+Space',
      runInMenuBar: false,
    });

    saveClientConfig(configPath, {
      mode: 'remote',
      remoteUrl: 'http://10.0.0.5:4173',
      remoteToken: 'tok',
    });

    const reloaded = loadClientConfig(configPath);
    expect(reloaded.mode).toBe('remote');
    expect(reloaded.remoteUrl).toBe('http://10.0.0.5:4173');
    expect(reloaded.remoteToken).toBe('tok');
    expect(reloaded.cachedShortcut).toBe('CommandOrControl+Shift+Space');
    expect(reloaded.cachedRunInMenuBar).toBe(false);
  });

  it('falls back to defaults when config JSON is corrupted', () => {
    const configPath = createTempConfigPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, '{ invalid json', 'utf8');

    expect(loadClientConfig(configPath)).toEqual(DEFAULT_CLIENT_CONFIG);
  });

  it('resolves renderer DesktopClientConfig for local and remote modes', () => {
    const localResolved = resolveDesktopClientConfig(
      {
        mode: 'local',
        cachedShortcut: DEFAULT_CAPTURE_SHORTCUT,
        cachedRunInMenuBar: true,
      },
      'http://127.0.0.1:4173',
    );
    expect(localResolved).toEqual({
      mode: 'local',
      serverUrl: 'http://127.0.0.1:4173',
      token: null,
      remoteUrl: undefined,
      remoteToken: undefined,
    });

    const remoteResolved = resolveDesktopClientConfig(
      {
        mode: 'remote',
        remoteUrl: 'https://veyra.internal',
        remoteToken: 'bearer-xyz',
        cachedShortcut: DEFAULT_CAPTURE_SHORTCUT,
        cachedRunInMenuBar: true,
      },
      'http://127.0.0.1:4173',
    );
    expect(remoteResolved).toEqual({
      mode: 'remote',
      serverUrl: 'https://veyra.internal',
      token: 'bearer-xyz',
      remoteUrl: 'https://veyra.internal',
      remoteToken: 'bearer-xyz',
    });
  });

  it('rejects non-http(s) and missing remoteUrl values on saveClientConfig', () => {
    const configPath = createTempConfigPath();

    expect(() =>
      saveClientConfig(configPath, {
        mode: 'remote',
        remoteUrl: 'file:///etc/passwd',
      }),
    ).toThrow('Remote server URL must be a valid http:// or https:// URL');

    expect(() =>
      saveClientConfig(configPath, {
        mode: 'remote',
        remoteUrl: 'javascript:alert(1)',
      }),
    ).toThrow('Remote server URL must be a valid http:// or https:// URL');

    expect(() =>
      saveClientConfig(configPath, {
        mode: 'remote',
      }),
    ).toThrow('Remote server URL must be a valid http:// or https:// URL');

    expect(() =>
      saveClientConfig(configPath, {
        mode: 'local',
        remoteUrl: 'javascript:alert(1)',
      }),
    ).toThrow('Remote server URL must be a valid http:// or https:// URL');

    expect(fs.existsSync(configPath)).toBe(false);
  });

  it('falls back safely to mode: local when persisted remoteUrl has an invalid scheme', () => {
    for (const badUrl of ['file:///etc/passwd', 'javascript:alert(1)', 'not-a-url']) {
      const configPath = createTempConfigPath();
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          mode: 'remote',
          remoteUrl: badUrl,
          remoteToken: 'secret-tok',
          cachedShortcut: DEFAULT_CAPTURE_SHORTCUT,
          cachedRunInMenuBar: true,
        }),
        'utf8',
      );

      const loaded = loadClientConfig(configPath);
      expect(loaded.mode).toBe('local');
      expect(loaded.remoteUrl).toBeUndefined();
    }
  });

  it('writes client-config.json with owner-only 0600 permissions on POSIX', () => {
    if (process.platform === 'win32') return;

    const configPath = createTempConfigPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, '{}', { mode: 0o644 });
    fs.chmodSync(configPath, 0o644);

    saveClientConfig(configPath, {
      mode: 'remote',
      remoteUrl: 'https://veyra.example.com',
      remoteToken: 'secret-token',
    });

    const mode = fs.statSync(configPath).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
