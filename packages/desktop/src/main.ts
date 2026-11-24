import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSettings } from '@veyra/core';
import { createVeyraServer, type VeyraServerInstance } from '@veyra/server/app';
import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  shell,
  Tray,
} from 'electron';
import {
  DEFAULT_CAPTURE_SHORTCUT,
  type DesktopPreferencesInput,
  loadClientConfig,
  type PersistedClientConfig,
  resolveDesktopClientConfig,
  saveClientConfig,
  type SaveClientConfigInput,
  updateDesktopPreferences,
} from './client-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ALLOWED_EXTERNAL_PROTOCOLS = new Set([
  'http:',
  'https:',
  'msteams:',
  'zoommtg:',
  'notion:',
]);

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 4173;
const COMMAND_SHORTCUT = 'Alt+K';
const QUICK_FOCUS_SHORTCUT = 'CommandOrControl+Shift+O';
const QUICK_FOCUS_ALT_SHORTCUT = 'Control+O';

type CaptureTab = 'daily-note' | 'inbox' | 'focus';

type DesktopCommandAction =
  | { type: 'navigate'; route: string; projectId?: string; settingsSection?: string }
  | { type: 'start-focus'; blockId: string }
  | { type: 'open-block'; blockId: string }
  | { type: 'open-create-block'; title?: string }
  | { type: 'open-daily-notes' }
  | { type: 'open-quick-capture' };

const COMMAND_ACTION_TYPES = new Set<DesktopCommandAction['type']>([
  'navigate',
  'start-focus',
  'open-block',
  'open-create-block',
  'open-daily-notes',
  'open-quick-capture',
]);

let mainWindow: BrowserWindow | null = null;
let captureWindow: BrowserWindow | null = null;
let lastCaptureTab: CaptureTab = 'daily-note';
let commandWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let embeddedServer: VeyraServerInstance | null = null;
let localServerUrl = `http://${DEFAULT_HOST}:${DEFAULT_PORT}`;
let clientConfig: PersistedClientConfig | null = null;
let activeShortcut: string | null = null;
let isQuitting = false;
let isShuttingDown = false;

function getDbPath(): string {
  return process.env.VEYRA_DB_PATH?.trim() || path.join(os.homedir(), '.veyra', 'veyra.db');
}

function getPort(): number {
  const parsed = Number.parseInt(process.env.VEYRA_PORT ?? '', 10);
  return Number.isNaN(parsed) || parsed <= 0 ? DEFAULT_PORT : parsed;
}

function getHost(): string {
  return process.env.VEYRA_HOST?.trim() || DEFAULT_HOST;
}

function getWebDevUrl(): string | undefined {
  const raw = process.env.VEYRA_WEB_DEV_URL?.trim();
  return raw ? raw.replace(/\/+$/, '') : undefined;
}

function getWebDistDir(): string {
  const override = process.env.VEYRA_WEB_DIST_DIR?.trim();
  if (override) return override;
  return app.isPackaged
    ? path.join(process.resourcesPath, 'web-dist')
    : path.resolve(__dirname, '../../web/dist');
}

function getConfigPath(): string {
  return (
    process.env.VEYRA_DESKTOP_CONFIG_PATH?.trim() ||
    path.join(app.getPath('userData'), 'client-config.json')
  );
}

function getPreloadPath(): string {
  return path.join(__dirname, 'preload.cjs');
}

function getTrayIconPath(): string {
  return path.resolve(__dirname, '../assets/tray-template.png');
}

function getRendererBaseUrl(): string {
  const devUrl = getWebDevUrl();
  if (devUrl) {
    return devUrl;
  }
  if (clientConfig?.mode === 'remote' && clientConfig.remoteUrl) {
    return clientConfig.remoteUrl;
  }
  return localServerUrl;
}

function formatShortcutForDisplay(accelerator: string): string {
  if (process.platform !== 'darwin') {
    return accelerator;
  }
  return accelerator
    .replace(/CommandOrControl/gi, '⌘')
    .replace(/Command/gi, '⌘')
    .replace(/Control/gi, '⌃')
    .replace(/Shift/gi, '⇧')
    .replace(/Alt|Option/gi, '⌥')
    .replace(/\+/g, '');
}

function isAllowedExternalUrl(raw: string): string | null {
  try {
    const parsed = new URL(raw);
    if (!ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

async function ensureLocalServer(): Promise<string> {
  if (embeddedServer) {
    return localServerUrl;
  }

  const dbPath = getDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const server = createVeyraServer({
    dbPath,
    port: getPort(),
    host: getHost(),
    webDistDir: getWebDistDir(),
    enableTestClock: process.env.VEYRA_ENABLE_TEST_CLOCK === '1',
  });

  const started = await server.start();
  embeddedServer = server;
  localServerUrl = started.url;
  return localServerUrl;
}

async function stopLocalServer(): Promise<void> {
  if (!embeddedServer) return;
  const server = embeddedServer;
  embeddedServer = null;
  await server.stop();
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
  }
  if (!mainWindow) return;

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function createMainWindow(): BrowserWindow {
  const isMac = process.platform === 'darwin';
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    backgroundColor: '#131313',
    ...(isMac
      ? {
          titleBarStyle: 'hiddenInset' as const,
          trafficLightPosition: { x: 16, y: 18 },
          vibrancy: 'under-window' as const,
          visualEffectState: 'active' as const,
        }
      : {}),
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) {
      win.show();
    }
  });

  win.on('close', (event) => {
    const keepInMenuBar = clientConfig?.cachedRunInMenuBar ?? true;
    if (!isQuitting && keepInMenuBar) {
      event.preventDefault();
      win.hide();
    }
  });

  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null;
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    const safeUrl = isAllowedExternalUrl(url);
    if (safeUrl) {
      void shell.openExternal(safeUrl);
    }
    return { action: 'deny' };
  });

  mainWindow = win;
  void win.loadURL(getRendererBaseUrl());
  return win;
}

function createFloatingWindow(opts: {
  width: number;
  height: number;
  routePath: string;
  onClosed: (win: BrowserWindow) => void;
}): BrowserWindow {
  const win = new BrowserWindow({
    width: opts.width,
    height: opts.height,
    frame: false,
    transparent: false,
    backgroundColor: '#1C1C1C',
    alwaysOnTop: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (process.platform === 'darwin') {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setAlwaysOnTop(true, 'floating');
  }

  win.on('blur', () => {
    if (!win.isDestroyed() && win.isVisible()) {
      win.hide();
    }
  });

  win.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      win.hide();
    }
  });

  win.on('closed', () => {
    opts.onClosed(win);
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    const safeUrl = isAllowedExternalUrl(url);
    if (safeUrl) {
      void shell.openExternal(safeUrl);
    }
    return { action: 'deny' };
  });

  void win.loadURL(`${getRendererBaseUrl()}${opts.routePath}`);
  return win;
}

function createCaptureWindow(): BrowserWindow {
  const win = createFloatingWindow({
    width: 580,
    height: 204,
    routePath: '/capture',
    onClosed: (closed) => {
      if (captureWindow === closed) {
        captureWindow = null;
      }
    },
  });

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') {
      event.preventDefault();
      hideCaptureWindow();
    }
  });

  captureWindow = win;
  return win;
}

function createCommandWindow(): BrowserWindow {
  const win = createFloatingWindow({
    width: 600,
    height: 420,
    routePath: '/command',
    onClosed: (closed) => {
      if (commandWindow === closed) {
        commandWindow = null;
      }
    },
  });

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') {
      event.preventDefault();
      hideCommandWindow();
    }
  });

  commandWindow = win;
  return win;
}

function showFloatingWindow(win: BrowserWindow): void {
  win.center();
  win.show();
  win.focus();
  void win.webContents
    .executeJavaScript(
      `(() => { window.dispatchEvent(new Event('veyra:floating-show')); const el = document.querySelector('input'); if (el) el.focus(); })()`,
    )
    .catch(() => {});
}

function toggleCommandWindow(): void {
  if (!commandWindow || commandWindow.isDestroyed()) {
    const win = createCommandWindow();
    win.once('ready-to-show', () => {
      if (!win.isDestroyed()) {
        showFloatingWindow(win);
      }
    });
    return;
  }

  if (commandWindow.isVisible()) {
    commandWindow.hide();
    return;
  }

  hideCaptureWindow();
  showFloatingWindow(commandWindow);
}

function hideCommandWindow(): void {
  if (commandWindow && !commandWindow.isDestroyed()) {
    commandWindow.hide();
  }
}

function sendCommandActionToMain(action: DesktopCommandAction): void {
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;
  const send = () => {
    if (!win.isDestroyed()) {
      win.webContents.send('veyra:command-action', action);
    }
  };
  if (win.webContents.isLoading()) {
    // Give React a moment to mount its listener after the first load.
    win.webContents.once('did-finish-load', () => {
      setTimeout(send, 250);
    });
  } else {
    send();
  }
}

function isCommandAction(value: unknown): value is DesktopCommandAction {
  if (!value || typeof value !== 'object') return false;
  const type = (value as { type?: unknown }).type;
  return typeof type === 'string' && COMMAND_ACTION_TYPES.has(type as DesktopCommandAction['type']);
}

function registerCommandShortcut(): boolean {
  try {
    return globalShortcut.register(COMMAND_SHORTCUT, () => {
      toggleCommandWindow();
    });
  } catch {
    return false;
  }
}

function registerQuickFocusShortcut(): boolean {
  let primaryOk = false;
  try {
    primaryOk = globalShortcut.register(QUICK_FOCUS_SHORTCUT, () => {
      toggleCaptureWindow('focus');
    });
  } catch {
    primaryOk = false;
  }
  try {
    globalShortcut.register(QUICK_FOCUS_ALT_SHORTCUT, () => {
      toggleCaptureWindow('focus');
    });
  } catch {
    // Optional secondary alias
  }
  return primaryOk;
}

function dispatchCaptureTab(win: BrowserWindow, tab: CaptureTab): void {
  const safeTab = JSON.stringify(tab);
  void win.webContents
    .executeJavaScript(
      `(() => { window.dispatchEvent(new CustomEvent('veyra:capture-tab', { detail: { tab: ${safeTab} } })); const el = document.querySelector('input'); if (el) el.focus(); })()`,
    )
    .catch(() => {});
}

function toggleCaptureWindow(tab: CaptureTab = 'daily-note'): void {
  if (!captureWindow || captureWindow.isDestroyed()) {
    lastCaptureTab = tab;
    const win = createCaptureWindow();
    win.once('ready-to-show', () => {
      if (!win.isDestroyed()) {
        showFloatingWindow(win);
        dispatchCaptureTab(win, tab);
      }
    });
    return;
  }

  if (captureWindow.isVisible()) {
    if (lastCaptureTab === tab) {
      captureWindow.hide();
      return;
    }
    lastCaptureTab = tab;
    dispatchCaptureTab(captureWindow, tab);
    captureWindow.focus();
    return;
  }

  lastCaptureTab = tab;
  hideCommandWindow();
  showFloatingWindow(captureWindow);
  dispatchCaptureTab(captureWindow, tab);
}

function hideCaptureWindow(): void {
  if (captureWindow && !captureWindow.isDestroyed()) {
    captureWindow.hide();
  }
}

function registerCaptureShortcut(accelerator: string): boolean {
  const nextShortcut = accelerator.trim() || DEFAULT_CAPTURE_SHORTCUT;
  if (activeShortcut && globalShortcut.isRegistered(activeShortcut)) {
    globalShortcut.unregister(activeShortcut);
  }
  activeShortcut = null;

  try {
    const ok = globalShortcut.register(nextShortcut, () => {
      toggleCaptureWindow();
    });
    if (ok) {
      activeShortcut = nextShortcut;
    }
    return ok;
  } catch {
    return false;
  }
}

function refreshTrayMenu(): void {
  if (!tray || tray.isDestroyed()) return;
  const shortcutLabel = formatShortcutForDisplay(
    clientConfig?.cachedShortcut ?? DEFAULT_CAPTURE_SHORTCUT,
  );

  const menu = Menu.buildFromTemplate([
    {
      label: 'Show Veyra',
      click: () => {
        showMainWindow();
      },
    },
    {
      label: `Quick Capture (${shortcutLabel})`,
      click: () => {
        toggleCaptureWindow('daily-note');
      },
    },
    {
      label: `Quick Focus (${formatShortcutForDisplay(QUICK_FOCUS_SHORTCUT)})`,
      click: () => {
        toggleCaptureWindow('focus');
      },
    },
    {
      label: `Command Palette (${formatShortcutForDisplay(COMMAND_SHORTCUT)})`,
      click: () => {
        toggleCommandWindow();
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(menu);
}

function createTray(): void {
  if (tray && !tray.isDestroyed()) {
    refreshTrayMenu();
    return;
  }

  const iconPath = getTrayIconPath();
  let image: Electron.NativeImage;
  if (fs.existsSync(iconPath)) {
    const buf = fs.readFileSync(iconPath);
    image = nativeImage.createFromBuffer(buf, { scaleFactor: 2 });
  } else {
    image = nativeImage.createEmpty();
  }

  if (process.platform === 'darwin') {
    image.setTemplateImage(true);
  }

  tray = new Tray(image);
  tray.setToolTip('Veyra');
  refreshTrayMenu();
}

function reloadFloatingWindows(nextUrl: string, previousUrl: string): void {
  if (nextUrl === previousUrl) return;
  if (captureWindow && !captureWindow.isDestroyed()) {
    void captureWindow.loadURL(`${nextUrl}/capture`).catch(() => {});
  }
  if (commandWindow && !commandWindow.isDestroyed()) {
    void commandWindow.loadURL(`${nextUrl}/command`).catch(() => {});
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle('veyra:get-client-config', () => {
    const config = clientConfig ?? loadClientConfig(getConfigPath());
    return resolveDesktopClientConfig(config, localServerUrl);
  });

  ipcMain.handle('veyra:save-client-config', async (_event, input: SaveClientConfigInput) => {
    const previousUrl = getRendererBaseUrl();
    const configPath = getConfigPath();
    const updated = saveClientConfig(configPath, input);
    clientConfig = updated;

    if (updated.mode === 'local') {
      await ensureLocalServer();
      const nextUrl = getRendererBaseUrl();
      if (!getWebDevUrl() && nextUrl !== previousUrl && mainWindow && !mainWindow.isDestroyed()) {
        void mainWindow.loadURL(nextUrl).catch(() => {});
      }
      reloadFloatingWindows(nextUrl, previousUrl);
    } else if (updated.remoteUrl) {
      const nextUrl = getRendererBaseUrl();
      if (!getWebDevUrl() && nextUrl !== previousUrl && mainWindow && !mainWindow.isDestroyed()) {
        await mainWindow.loadURL(nextUrl).catch(() => {});
      }
      reloadFloatingWindows(nextUrl, previousUrl);
      await stopLocalServer();
    }
  });

  ipcMain.handle(
    'veyra:sync-desktop-preferences',
    (_event, prefs: DesktopPreferencesInput) => {
      const configPath = getConfigPath();
      const updated = updateDesktopPreferences(configPath, prefs);
      clientConfig = updated;
      registerCaptureShortcut(updated.cachedShortcut);
      refreshTrayMenu();
    },
  );

  ipcMain.handle('veyra:close-capture-window', () => {
    hideCaptureWindow();
  });

  ipcMain.handle('veyra:close-command-window', () => {
    hideCommandWindow();
  });

  ipcMain.handle('veyra:focus-and-dispatch-action', (_event, action: unknown) => {
    if (!isCommandAction(action)) {
      throw new Error('Unsupported command action');
    }
    hideCommandWindow();
    hideCaptureWindow();
    if (action.type === 'open-quick-capture') {
      toggleCaptureWindow('daily-note');
      return;
    }
    showMainWindow();
    sendCommandActionToMain(action);
  });

  ipcMain.handle('veyra:open-external-url', async (_event, url: string) => {
    const safeUrl = isAllowedExternalUrl(url);
    if (!safeUrl) {
      throw new Error(`Unsupported external URL protocol: ${url}`);
    }
    await shell.openExternal(safeUrl);
  });
}

async function shutdown(): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  isQuitting = true;

  try {
    globalShortcut.unregisterAll();
  } catch {
    // Ignore shutdown errors if app is not ready
  }

  if (tray && !tray.isDestroyed()) {
    tray.destroy();
    tray = null;
  }

  await stopLocalServer();
}

async function bootstrap(): Promise<void> {
  const configPath = getConfigPath();
  clientConfig = loadClientConfig(configPath);

  if (clientConfig.mode === 'local' || !clientConfig.remoteUrl) {
    await ensureLocalServer();
    if (embeddedServer) {
      try {
        const settings = getSettings(embeddedServer.db);
        clientConfig = updateDesktopPreferences(configPath, {
          globalCaptureShortcut: settings.globalCaptureShortcut,
          runInMenuBar: settings.runInMenuBar,
        });
      } catch {
        // Keep cached client config if settings read fails
      }
    }
  }

  registerIpcHandlers();
  createTray();
  registerCaptureShortcut(clientConfig.cachedShortcut);
  if (!registerQuickFocusShortcut()) {
    console.warn(`Veyra: could not register global shortcut ${QUICK_FOCUS_SHORTCUT}`);
  }
  if (!registerCommandShortcut()) {
    console.warn(`Veyra: could not register global shortcut ${COMMAND_SHORTCUT}`);
  }
  createMainWindow();
  createCaptureWindow();
  createCommandWindow();
}

const useSingleInstanceLock =
  !process.env.VEYRA_DESKTOP_CONFIG_PATH && process.env.VEYRA_ALLOW_MULTI_INSTANCE !== '1';

let hasSingleInstanceLock = true;
if (useSingleInstanceLock) {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    hasSingleInstanceLock = false;
    app.quit();
  } else {
    app.on('second-instance', () => {
      showMainWindow();
    });
  }
}

if (hasSingleInstanceLock) {
  app.on('activate', () => {
    showMainWindow();
  });

  app.on('window-all-closed', () => {
    const keepInMenuBar = clientConfig?.cachedRunInMenuBar ?? true;
    if (!keepInMenuBar && process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('before-quit', (event) => {
    if (!isShuttingDown) {
      event.preventDefault();
      void shutdown().finally(() => {
        app.exit(0);
      });
    }
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void shutdown().finally(() => {
        process.exit(0);
      });
    });
  }

  app
    .whenReady()
    .then(bootstrap)
    .catch((err) => {
      console.error('Failed to bootstrap Veyra Desktop:', err);
      void shutdown().finally(() => {
        app.exit(1);
      });
    });
}
