---
id: features.desktop-shell-capture
type: architecture
scope: features
authority: canonical
sourceVersion: f62c1c9
extends: features
dependsOn:
  - architecture.monorepo-boundaries
  - interfaces.http-sse-api
groundedIn:
  - packages/desktop/src/main.ts
  - packages/desktop/src/menubar-focus.ts
  - packages/desktop/src/preload.ts
  - packages/desktop/src/client-config.ts
  - packages/desktop/package.json
updateWhen:
  - Electron window chrome, tray lifecycle, IPC bridge, or global shortcut changes
  - desktop client-config persistence or native rebuild flow changes
  - hotkey ids, defaults, or the `settings.hotkeys` override map change
---
# Desktop Shell And Global Quick Capture

`@veyra/desktop` wraps `@veyra/web` and `@veyra/server` in a native macOS Electron 45 application (`packages/desktop/src/main.ts`) with menu bar background presence and system-wide quick capture.

## Local Embedded Server vs. Remote Mode

Client connection preferences live outside SQLite in Electron's local `client-config.json` (under `app.getPath('userData')` or `VEYRA_DESKTOP_CONFIG_PATH`, saved with mode `0600` inside a `0700` directory) so switching servers never depends on reaching a remote database first.

- **Local mode (default):** Main process starts `@veyra/server` in-process on `127.0.0.1:4173` (overridable via `VEYRA_HOST`, `VEYRA_PORT`, `VEYRA_DB_PATH`) serving both the REST/SSE API and built `@veyra/web` assets (`VEYRA_WEB_DIST_DIR`, or `VEYRA_WEB_DEV_URL` during development).
- **Remote mode:** Main process skips starting an embedded server (or stops it on switch) and points the renderer + capture window at the configured remote HTTPS/HTTP `remoteUrl` and optional `remoteToken`. `saveClientConfig` strictly validates `remoteUrl` as `http://` or `https://` (rejecting invalid URLs/protocols), and `loadClientConfig` safely falls back to `local` mode if the config file is missing, malformed, or lacks a valid `remoteUrl`.
- Switching modes via `Settings → Server & CLI` persists `client-config.json`, starts or stops the embedded server cleanly, and reloads the renderer only when the resolved target URL actually changes (preventing disruptive reloads when confirming the active local server during Onboarding).

## Preload IPC Bridge And Security Boundaries

Both `mainWindow` and `captureWindow` enforce strict Electron renderer isolation (`sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`) and attach `setWindowOpenHandler` returning `{ action: 'deny' }` while forwarding only allowlisted protocols (`http:`, `https:`, `msteams:`, `zoommtg:`, `notion:`) to `shell.openExternal`.

`packages/desktop/src/preload.ts` compiles to CJS (`dist/preload.cjs`) and exposes `window.veyraDesktop` via `contextBridge`:

- `getClientConfig()` / `saveClientConfig(cfg)`: read and switch local vs. remote server targets.
- `syncDesktopPreferences({ globalCaptureShortcut, runInMenuBar, globalHotkeys? })`: re-registers all macOS global shortcuts (Quick Capture, Quick Focus, Global Command Palette) and updates tray behavior immediately when saved in `Settings`, caching them locally in `client-config.json` (`cachedShortcut`, `cachedGlobalHotkeys`) for cold starts. Resolves to `{ failed: string[] }`: if macOS or another app refuses a key, the previous set is restored, nothing is cached, and the web UI shows an error instead of saving the binding.
- `closeCaptureWindow()`: dismisses the floating capture overlay after submit or `Esc`.
- `openExternalUrl(url)`: opens external links via `shell.openExternal` strictly limited to the same protocol allowlist (`http:`, `https:`, `msteams:`, `zoommtg:`, `notion:`).

## Menu Bar Live Focus Timer, Tray Controls, And Global Shortcuts

- **Background presence:** When `runInMenuBar` is enabled (default `true`), closing the main window hides it instead of quitting, keeping the macOS template tray icon (`packages/desktop/assets/tray-template.png`) and global shortcuts active.
- **Live focus sync (`packages/desktop/src/menubar-focus.ts`):** `MenuBarFocusController` runs in the Electron main process against the resolved API target (local embedded server or remote Docker server with `Authorization: Bearer <token>`). On startup and on server mode switches, it fetches `GET /api/focus` + `GET /api/today` and subscribes to `/api/events/stream` SSE updates with exponential-backoff reconnection so CLI, web, or agent mutations reflect immediately in the tray.
- **Icon-only macOS menu bar indicator (`packages/desktop/src/tray-icon.ts`):** To avoid cluttering the menu bar with text, `tray.setTitle('')` stays empty at all times. While a focus session is active, `tray.setImage` swaps the `18×18` tray icon to a crisp colored rounded-square badge rendered in the active project's accent color and icon/initial (`renderProjectTrayIconPng`), restoring the quiet monochrome Veyra template icon when paused, stopped, or completed. Hovering displays the live tooltip (`Veyra — <Block> (MM:SS)`).
- **Dynamic tray menu:**
  - *When focusing:* shows the active block title and elapsed time (disabled header), `Open Focus` (focuses main window and navigates to `Focus`), `Pause Session`, `Stop Session`, and `Complete Block`, followed by the standard app actions.
  - *When idle:* shows up to 3 `Up Next` blocks from `Today` to start focus in one click directly from the menu bar, alongside `Show Veyra`, `Quick Capture (<shortcut>)`, `Quick Focus (<shortcut>)`, `Command Palette (<shortcut>)`, and `Quit`.
  - Menu rebuilds pause while the native tray menu is open (`menu-will-show` / `menu-will-close`) so live ticks never disrupt clicks.
- **Global shortcuts (defaults `⌘⇧P`, `⌘⇧O` / `⌃O` & `⌥K`, all rebindable in `Settings → Server & CLI → Keyboard Shortcuts`):** Reads the accelerators from `client-config.json` (seeded from `settings.globalCaptureShortcut` and `settings.hotkeys` on startup) and registers `CommandOrControl+Shift+P` (configurable) for `captureWindow` (`580×204` at `/capture`, opening on `Daily Note`), `CommandOrControl+Shift+O` (`⌘⇧O`, plus `Control+O` alias) for `captureWindow` opening directly on `Focus Now` (create block and jump straight into `Focus`), and `Alt+K` (`⌥K`) for `commandWindow` (`600×420` at `/command`) via Electron `globalShortcut`, sharing one frameless macOS floating window factory with native glass bezel and `visibleOnFullScreen: true`. Pressing `⌥K` or `⌘⇧O` from any macOS application dispatches chosen actions (`navigate`, `start-focus`, `open-block`, `open-create-block`, `open-daily-notes`, `open-quick-capture`) back to the main window via IPC (`focusAndDispatchAction` / `veyra:command-action`).
- **Single-instance lock:** Acquires Electron's single-instance lock by default (bypassable for isolated test runs via `VEYRA_DESKTOP_CONFIG_PATH` or `VEYRA_ALLOW_MULTI_INSTANCE=1`) and guards lifecycle registration and `bootstrap` behind `hasSingleInstanceLock` so secondary instances quit without booting a second window or server.

## Native SQLite ABI And macOS `.app` Packaging

- **Packaging:** `pnpm package:mac` runs `electron-builder` for macOS `arm64` (`appId: ai.veyra.desktop`, ad-hoc signed, `asar: true` with `better-sqlite3` unpacked and `packages/web/dist` bundled under `extraResources/web-dist`), producing `packages/desktop/release/mac-arm64/Veyra.app` and `Veyra-0.1.0-arm64.dmg` ready to drag into `/Applications`.
- **Native SQLite binary:** `better-sqlite3@13.2.0` ships N-API prebuilds (`prebuilds/darwin-arm64.node`) compatible with both Node 22+ and Electron 45, so no `electron-rebuild` step is needed during `package:mac`. (`pnpm --filter @veyra/desktop rebuild:native` remains available only if a future upgrade drops prebuilds.)
