---
id: human.configuration
type: view
scope: human
sourceVersion: 432c801
derivedFrom:
  - architecture.monorepo-boundaries
  - features.desktop-shell-capture
  - interfaces.cli-and-agent-skill
  - interfaces.calendar-sync-webhooks
---
# Configuration Guide

Veyra splits configuration into three clear layers so workspace behavior, server startup, and client connection targets never collide.

## Workspace Settings (SQLite Singleton)

Edited in Full-Page `Settings` (`⌘,`) or via `PATCH /api/settings`:

- `timezone`: IANA timezone string anchoring midnight rollover and weekly boundaries.
- `calendarSyncMode`: `outlook_cli`, `ics`, or `manual`, paired with `outlookCliCommand`, `icsFeedUrl`, `calendarSyncIntervalMin` (default `15`), and `skipDeclinedAndAllDay` (default `true`).
- `webhookUrl` and `webhookEvents`: target endpoint and enabled lifecycle hooks (`focus.started`, `focus.ended`, `block.completed`).
- `globalCaptureShortcut` (default `CommandOrControl+Shift+P`) and `runInMenuBar` (default `true`): synced to Electron's local preferences on save.

## Client Connection Files (Local Only)

- **Electron desktop:** Stores `mode` (`local` or `remote`), `remoteUrl`, `remoteToken`, and cached shortcut/tray flags in `client-config.json` (mode `0600`) under Electron `userData`. See `features.desktop-shell-capture`.
- **CLI:** Stores `serverUrl` and `token` in `~/.veyra/config.json` via `veyra config set`, overridden by `VEYRA_SERVER_URL` and `VEYRA_TOKEN`. See `interfaces.cli-and-agent-skill`.

## Build And Workspace Files

- `pnpm-workspace.yaml` and `tsconfig.base.json`: workspace membership and shared ESM TypeScript settings.
- `vitest.config.ts`: `node` and `web` (`jsdom`) test project definitions.
- `packages/web/vite.config.ts`: React + Tailwind v4 Vite configuration.
- `Dockerfile` and `docker-compose.yml`: self-hosted container runtime settings.
