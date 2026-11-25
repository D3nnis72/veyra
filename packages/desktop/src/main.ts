import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSettings, resolveHotkey } from '@veyra/core';
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
  DEFAULT_GLOBAL_HOTKEYS,
  type DesktopPreferencesInput,
  type GlobalHotkeys,
  loadClientConfig,
  type PersistedClientConfig,
  resolveDesktopClientConfig,
  saveClientConfig,
  type SaveClientConfigInput,
  updateDesktopPreferences,
} from './client-config.js';
import {
  buildTrayMenuDescriptors,
  formatTrayToolTip,
  MenuBarFocusController,
  type MenuBarServerTarget,
  type TrayMenuAction,
} from './menubar-focus.js';
import { renderProjectTrayIconPng } from './tray-icon.js';

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
let isTrayMenuOpen = false;
let pendingTrayMenuRefresh = false;
let defaultTrayImage: Electron.NativeImage | null = null;
let lastTrayIconKey: string | null = null;
let lastTrayToolTip: string | null = null;
let embeddedServer: VeyraServerInstance | null = null;
let localServerUrl = `http://${DEFAULT_HOST}:${DEFAULT_PORT}`;
let clientConfig: PersistedClientConfig | null = null;
let isQuitting = false;
let isShuttingDown = false;

const menuBarFocus = new MenuBarFocusController({
  onStateChange: () => {
    updateTrayDisplay({ rebuildMenu: true });
  },
  onTick: () => {
    updateTrayDisplay({ rebuildMenu: true });
  },
  onError: (context, err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`Veyra menu bar sync (${context}): ${message}`);
  },
});

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

type GlobalShortcutId = 'quickCapture' | 'quickFocus' | 'globalCommandPalette';

const GLOBAL_SHORTCUT_HANDLERS: Record<GlobalShortcutId, () => void> = {
  quickCapture: () => toggleCaptureWindow(),
  quickFocus: () => toggleCaptureWindow('focus'),
  globalCommandPalette: () => toggleCommandWindow(),
};

/** Accelerators currently registered with macOS, by hotkey id. */
let activeGlobalShortcuts: Record<GlobalShortcutId, string[]> = {
  quickCapture: [],
  quickFocus: [],
  globalCommandPalette: [],
};

function desiredGlobalShortcuts(
  captureShortcut: string,
  hotkeys: GlobalHotkeys,
): Record<GlobalShortcutId, string[]> {
  return {
    quickCapture: [captureShortcut.trim() || DEFAULT_CAPTURE_SHORTCUT],
    quickFocus: hotkeys.quickFocus,
    globalCommandPalette: hotkeys.globalCommandPalette,
  };
}

function unregisterGlobalShortcuts(): void {
  for (const accelerators of Object.values(activeGlobalShortcuts)) {
    for (const accelerator of accelerators) {
      try {
        globalShortcut.unregister(accelerator);
      } catch {
        // Already gone
      }
    }
  }
  activeGlobalShortcuts = { quickCapture: [], quickFocus: [], globalCommandPalette: [] };
}

/**
 * Registers every global hotkey. Returns the ids that macOS refused (taken by another app
 * or an invalid accelerator). A failing alias does not fail an id that has another working key.
 */
function registerGlobalShortcuts(wanted: Record<GlobalShortcutId, string[]>): GlobalShortcutId[] {
  unregisterGlobalShortcuts();
  const failed: GlobalShortcutId[] = [];
  for (const id of Object.keys(wanted) as GlobalShortcutId[]) {
    for (const accelerator of wanted[id]) {
      try {
        if (globalShortcut.register(accelerator, GLOBAL_SHORTCUT_HANDLERS[id])) {
          activeGlobalShortcuts[id].push(accelerator);
        }
      } catch {
        // Invalid accelerator, counted as failed below
      }
    }
    if (activeGlobalShortcuts[id].length === 0) failed.push(id);
  }
  return failed;
}

/**
 * Applies new global hotkeys. If any id cannot be registered, the previous set is restored
 * so a rejected rebind never leaves the user without a working shortcut.
 */
function applyGlobalShortcuts(
  captureShortcut: string,
  hotkeys: GlobalHotkeys,
): { failed: GlobalShortcutId[] } {
  const previous = { ...activeGlobalShortcuts };
  const failed = registerGlobalShortcuts(desiredGlobalShortcuts(captureShortcut, hotkeys));
  if (failed.length > 0) {
    registerGlobalShortcuts(previous);
  }
  return { failed };
}

function getApiServerTarget(): MenuBarServerTarget {
  const config = clientConfig ?? loadClientConfig(getConfigPath());
  const resolved = resolveDesktopClientConfig(config, localServerUrl);
  return {
    serverUrl: resolved.serverUrl,
    token: resolved.token ?? null,
  };
}

function handleTrayMenuAction(action: TrayMenuAction): void {
  switch (action.type) {
    case 'open-focus':
      showMainWindow();
      sendCommandActionToMain({ type: 'navigate', route: 'focus' });
      return;
    case 'pause-session':
      void menuBarFocus.pauseFocus();
      return;
    case 'stop-session':
      void menuBarFocus.stopFocus();
      return;
    case 'complete-block':
      void menuBarFocus.completeBlock(action.blockId);
      return;
    case 'start-focus':
      void menuBarFocus.startFocus(action.blockId);
      return;
    case 'show-window':
      showMainWindow();
      return;
    case 'quick-capture':
      toggleCaptureWindow('daily-note');
      return;
    case 'quick-focus':
      toggleCaptureWindow('focus');
      return;
    case 'command-palette':
      toggleCommandWindow();
      return;
    case 'quit':
      isQuitting = true;
      app.quit();
      return;
  }
}

function refreshTrayMenu(nowMs = Date.now()): void {
  if (!tray || tray.isDestroyed()) return;

  const descriptors = buildTrayMenuDescriptors(menuBarFocus.getState(), {
    nowMs,
    captureShortcutLabel: formatShortcutForDisplay(
      clientConfig?.cachedShortcut ?? DEFAULT_CAPTURE_SHORTCUT,
    ),
    quickFocusShortcutLabel: formatShortcutForDisplay(
      (clientConfig?.cachedGlobalHotkeys ?? DEFAULT_GLOBAL_HOTKEYS).quickFocus[0],
    ),
    commandShortcutLabel: formatShortcutForDisplay(
      (clientConfig?.cachedGlobalHotkeys ?? DEFAULT_GLOBAL_HOTKEYS).globalCommandPalette[0],
    ),
  });

  const template: Electron.MenuItemConstructorOptions[] = descriptors.map((entry) => {
    if (entry.type === 'separator') {
      return { type: 'separator' };
    }
    return {
      label: entry.label,
      enabled: entry.enabled,
      ...(entry.action
        ? {
            click: () => {
              handleTrayMenuAction(entry.action!);
            },
          }
        : {}),
    };
  });

  const menu = Menu.buildFromTemplate(template);
  menu.on('menu-will-show', () => {
    isTrayMenuOpen = true;
  });
  menu.on('menu-will-close', () => {
    isTrayMenuOpen = false;
    if (pendingTrayMenuRefresh) {
      pendingTrayMenuRefresh = false;
      updateTrayDisplay({ rebuildMenu: true });
    }
  });

  tray.setContextMenu(menu);
}

function updateTrayDisplay(opts: { rebuildMenu?: boolean } = {}): void {
  if (!tray || tray.isDestroyed()) return;

  const nowMs = Date.now();
  const state = menuBarFocus.getState();

  // Keep the macOS menu bar compact: never render timer text next to the icon.
  // Instead, swap the 18×18 tray icon to the active project's colored badge while focusing.
  if (process.platform === 'darwin') {
    tray.setTitle('');
  }

  const nextIconKey = state.activeSession
    ? state.activeProject
      ? `project:${state.activeProject.color}:${state.activeProject.icon ?? ''}:${state.activeProject.name}`
      : 'active:default'
    : 'idle';

  if (nextIconKey !== lastTrayIconKey) {
    lastTrayIconKey = nextIconKey;
    if (state.activeSession) {
      const png = renderProjectTrayIconPng({
        name: state.activeProject?.name ?? state.activeBlock?.title ?? 'Veyra',
        color: state.activeProject?.color ?? '#3B4BD8',
        icon: state.activeProject?.icon ?? null,
      });
      const activeImg = nativeImage.createFromBuffer(png, { scaleFactor: 2 });
      activeImg.setTemplateImage(false);
      tray.setImage(activeImg);
    } else if (defaultTrayImage) {
      tray.setImage(defaultTrayImage);
    }
  }

  const nextToolTip = formatTrayToolTip(state, nowMs);
  if (nextToolTip !== lastTrayToolTip) {
    lastTrayToolTip = nextToolTip;
    tray.setToolTip(nextToolTip);
  }

  if (opts.rebuildMenu) {
    if (isTrayMenuOpen) {
      pendingTrayMenuRefresh = true;
    } else {
      refreshTrayMenu(nowMs);
    }
  }
}

function createTray(): void {
  if (tray && !tray.isDestroyed()) {
    updateTrayDisplay({ rebuildMenu: true });
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

  defaultTrayImage = image;
  tray = new Tray(image);
  lastTrayIconKey = 'idle';
  lastTrayToolTip = null;
  isTrayMenuOpen = false;
  pendingTrayMenuRefresh = false;
  updateTrayDisplay({ rebuildMenu: true });
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
      menuBarFocus.configure(getApiServerTarget());
    } else if (updated.remoteUrl) {
      const nextUrl = getRendererBaseUrl();
      if (!getWebDevUrl() && nextUrl !== previousUrl && mainWindow && !mainWindow.isDestroyed()) {
        await mainWindow.loadURL(nextUrl).catch(() => {});
      }
      reloadFloatingWindows(nextUrl, previousUrl);
      menuBarFocus.configure(getApiServerTarget());
      await stopLocalServer();
    }
  });

  ipcMain.handle(
    'veyra:sync-desktop-preferences',
    (_event, prefs: DesktopPreferencesInput) => {
      const configPath = getConfigPath();
      const current = clientConfig ?? loadClientConfig(configPath);
      const { failed } = applyGlobalShortcuts(
        prefs.globalCaptureShortcut,
        prefs.globalHotkeys ?? current.cachedGlobalHotkeys,
      );
      if (failed.length > 0) {
        return { failed };
      }
      clientConfig = updateDesktopPreferences(configPath, prefs);
      updateTrayDisplay({ rebuildMenu: true });
      return { failed: [] as GlobalShortcutId[] };
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

  menuBarFocus.stop();

  try {
    unregisterGlobalShortcuts();
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
          globalHotkeys: {
            quickFocus: resolveHotkey('quickFocus', settings.hotkeys),
            globalCommandPalette: resolveHotkey('globalCommandPalette', settings.hotkeys),
          },
        });
      } catch {
        // Keep cached client config if settings read fails
      }
    }
  }

  registerIpcHandlers();
  createTray();
  menuBarFocus.configure(getApiServerTarget());
  const failedShortcuts = registerGlobalShortcuts(
    desiredGlobalShortcuts(clientConfig.cachedShortcut, clientConfig.cachedGlobalHotkeys),
  );
  for (const id of failedShortcuts) {
    console.warn(`Veyra: could not register global shortcut for ${id}`);
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
