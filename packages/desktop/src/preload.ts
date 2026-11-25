import { contextBridge, type IpcRendererEvent, ipcRenderer } from 'electron';

export type DesktopCommandAction =
  | { type: 'navigate'; route: string; projectId?: string; settingsSection?: string }
  | { type: 'start-focus'; blockId: string }
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
  focusAndDispatchAction: (action: DesktopCommandAction) => Promise<void>;
  onCommandAction: (listener: (action: DesktopCommandAction) => void) => () => void;
  openExternalUrl: (url: string) => Promise<void>;
}

const bridge: VeyraDesktopBridge = {
  isElectron: true,
  getClientConfig: () => ipcRenderer.invoke('veyra:get-client-config'),
  saveClientConfig: (cfg) => ipcRenderer.invoke('veyra:save-client-config', cfg),
  syncDesktopPreferences: (prefs) => ipcRenderer.invoke('veyra:sync-desktop-preferences', prefs),
  closeCaptureWindow: () => ipcRenderer.invoke('veyra:close-capture-window'),
  closeCommandWindow: () => ipcRenderer.invoke('veyra:close-command-window'),
  focusAndDispatchAction: (action) => ipcRenderer.invoke('veyra:focus-and-dispatch-action', action),
  onCommandAction: (listener) => {
    const handler = (_event: IpcRendererEvent, action: DesktopCommandAction) => listener(action);
    ipcRenderer.on('veyra:command-action', handler);
    return () => {
      ipcRenderer.removeListener('veyra:command-action', handler);
    };
  },
  openExternalUrl: (url) => ipcRenderer.invoke('veyra:open-external-url', url),
};

contextBridge.exposeInMainWorld('veyraDesktop', bridge);
