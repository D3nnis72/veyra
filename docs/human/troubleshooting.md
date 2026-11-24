---
id: human.troubleshooting
type: view
scope: human
sourceVersion: 432c801
derivedFrom:
  - features.desktop-shell-capture
  - interfaces.calendar-sync-webhooks
  - operations.testing-and-verification
---
# Troubleshooting

## Electron Fails Loading `better-sqlite3` (NODE_MODULE_VERSION Mismatch)

Electron ships a different Node ABI than system Node 22. Rebuild the native module inside `@veyra/desktop`:

```bash
pnpm --filter @veyra/desktop rebuild:native
```

If system Node Vitest tests subsequently report an ABI mismatch on `better-sqlite3`, run `pnpm rebuild better-sqlite3` from the repo root.

## `Outlook CLI` Calendar Sync Shows Non-JSON Error

`OutlookCliAdapter` passes `--start YYYY-MM-DD --end YYYY-MM-DD --limit 250 --json` to `outlookCliCommand` and expects a JSON array of normalized event objects on stdout. Ensure your configured local calendar CLI supports `--json`, or switch to `ICS / CalDAV Feed` mode.

## Global `⌘⇧P` Shortcut Does Not Trigger When Main Window Closes

Confirm `Run in macOS menu bar` is enabled under `Settings → Server & CLI` and verify no other macOS application has claimed `CommandOrControl+Shift+P` (or change the shortcut in Settings).

## Downstream Tests Fail After Editing `@veyra/core`

`@veyra/server`, `@veyra/cli`, `@veyra/web`, and `tests/e2e` import compiled outputs from `@veyra/core/dist`. Run `pnpm build` before `pnpm test` whenever modifying `@veyra/core`.
