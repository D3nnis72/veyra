import { contextBridge, type IpcRendererEvent, ipcRenderer } from 'electron';

export type DesktopCommandAction =
  | { type: 'navigate'; route: string; projectId?: string; settingsSection?: string }
  | { type: 'start-focus'; blockId: string }
  | { type: 'open-focus-complete' }
  | { type: 'open-block'; blockId: string }
  | { type: 'open-create-block'; title?: string }
  | { type: 'open-daily-notes' }
  | { type: 'open-quick-capture' };

export interface DesktopClientConfig {
  mode: 'local' | 'remote';
  serverUrl: string;
  token?: string | null;
  remoteUrl?: string;
  remoteToken?: string;
}

export interface AwayReturnEvent {
  awayStartedAt: string;
  awayEndedAt: string;
}

export interface VeyraDesktopBridge {
  isElectron: boolean;
  getClientConfig: () => Promise<DesktopClientConfig>;
  saveClientConfig: (cfg: {
    mode: 'local' | 'remote';
    remoteUrl?: string;
    remoteToken?: string;
  }) => Promise<void>;
  syncDesktopPreferences: (prefs: {
    globalCaptureShortcut: string;
    runInMenuBar: boolean;
    globalHotkeys?: { quickFocus: string[]; globalCommandPalette: string[] };
  }) => Promise<{ failed: string[] }>;
  closeCaptureWindow: () => Promise<void>;
  closeCommandWindow: () => Promise<void>;
  closeFocusLauncherWindow: () => Promise<void>;
  closeTrayPopover: () => Promise<void>;
  hideMainWindow: () => Promise<void>;
  reportCaptureTab: (tab: 'daily-note' | 'inbox' | 'focus') => void;
  reportRoute: (route: string) => void;
  resizeTrayPopover: (height: number) => Promise<void>;
  trayAction: (action: 'show-window' | 'quick-capture' | 'quick-focus' | 'quit') => Promise<void>;
  focusAndDispatchAction: (action: DesktopCommandAction) => Promise<void>;
  onCommandAction: (listener: (action: DesktopCommandAction) => void) => () => void;
  onAwayReturn: (listener: (event: AwayReturnEvent) => void) => () => void;
  openExternalUrl: (url: string) => Promise<void>;
}

const bridge: VeyraDesktopBridge = {
  isElectron: true,
  getClientConfig: () => ipcRenderer.invoke('veyra:get-client-config'),
  saveClientConfig: (cfg) => ipcRenderer.invoke('veyra:save-client-config', cfg),
  syncDesktopPreferences: (prefs) => ipcRenderer.invoke('veyra:sync-desktop-preferences', prefs),
  closeCaptureWindow: () => ipcRenderer.invoke('veyra:close-capture-window'),
  closeCommandWindow: () => ipcRenderer.invoke('veyra:close-command-window'),
  closeFocusLauncherWindow: () => ipcRenderer.invoke('veyra:close-focus-launcher-window'),
  closeTrayPopover: () => ipcRenderer.invoke('veyra:close-tray-popover'),
  hideMainWindow: () => ipcRenderer.invoke('veyra:hide-main-window'),
  reportCaptureTab: (tab) => ipcRenderer.send('veyra:capture-tab-changed', tab),
  reportRoute: (route) => ipcRenderer.send('veyra:route-changed', route),
  resizeTrayPopover: (height) => ipcRenderer.invoke('veyra:resize-tray-popover', height),
  trayAction: (action) => ipcRenderer.invoke('veyra:tray-action', action),
  focusAndDispatchAction: (action) => ipcRenderer.invoke('veyra:focus-and-dispatch-action', action),
  onCommandAction: (listener) => {
    const handler = (_event: IpcRendererEvent, action: DesktopCommandAction) => listener(action);
    ipcRenderer.on('veyra:command-action', handler);
    return () => {
      ipcRenderer.removeListener('veyra:command-action', handler);
    };
  },
  onAwayReturn: (listener) => {
    const handler = (_event: IpcRendererEvent, payload: AwayReturnEvent) => listener(payload);
    ipcRenderer.on('veyra:away-return', handler);
    return () => {
      ipcRenderer.removeListener('veyra:away-return', handler);
    };
  },
  openExternalUrl: (url) => ipcRenderer.invoke('veyra:open-external-url', url),
};

contextBridge.exposeInMainWorld('veyraDesktop', bridge);
