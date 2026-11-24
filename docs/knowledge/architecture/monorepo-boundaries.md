---
id: architecture.monorepo-boundaries
type: architecture
scope: architecture
authority: canonical
sourceVersion: 5adbd95
extends: architecture
groundedIn:
  - pnpm-workspace.yaml
  - package.json
  - packages/core/package.json
  - packages/server/package.json
  - packages/cli/package.json
  - packages/web/package.json
  - packages/desktop/package.json
updateWhen:
  - packages are added, removed, or renamed
  - package dependency direction or export entrypoints change
---
# Monorepo Boundaries

Veyra uses one pnpm TypeScript monorepo (Node.js >= 22, pnpm >= 10, ESM modules throughout) so every client and server shares one contract layer without duplicating domain rules.

## Governing API Boundary

External clients never touch SQLite directly. `@veyra/web`, `@veyra/desktop` renderer windows, and `@veyra/cli` communicate exclusively with `@veyra/server` over HTTP and Server-Sent Events (`/api/events/stream`). Only `@veyra/server` and its in-process services (such as the calendar sync runner) invoke `@veyra/core` database functions directly, then broadcast SSE updates through the server hub.

## Package Dependency Direction

| Package | Depends On | Owns |
| --- | --- | --- |
| `@veyra/core` | `better-sqlite3`, `drizzle-orm`, `zod` | SQLite database bootstrap, schema, domain services, browser-safe contracts |
| `@veyra/server` | `@veyra/core`, `hono`, `node-ical`, `zod` | REST API, SSE hub, bearer auth, calendar sync adapters, webhooks, static web serving |
| `@veyra/cli` | `@veyra/core` (`@veyra/core/types`), `commander`, `zod` | `veyra` binary, HTTP client, local CLI config file |
| `@veyra/web` | `@veyra/core` (`@veyra/core/types`), React 19, Vite 8, Tailwind 4, TanStack Query, `@dnd-kit` | Browser cockpit views, drawers, modals, design tokens |
| `@veyra/desktop` | `@veyra/core`, `@veyra/server`, `better-sqlite3`, Electron 45 | macOS shell, embedded local server or remote connection, menu bar tray, global `⌘⇧P` capture |

## Browser-Safe Contract Split

`@veyra/core` exposes two entrypoints defined in `packages/core/package.json`:

- `@veyra/core`: Node-only entrypoint exporting `better-sqlite3` database setup and all domain services.
- `@veyra/core/types`: Pure TypeScript types, constants, and Zod schemas with zero Node or native dependencies. `@veyra/web` and `@veyra/cli` must import from `@veyra/core/types` so browser builds and CLI bundles never pull in `better-sqlite3`.

## Local vs. Self-Hosted Topology

- **Local desktop mode:** `@veyra/desktop` starts `@veyra/server` in-process on `127.0.0.1:4173` backed by `~/.veyra/veyra.db`. The renderer window, floating capture window, and `veyra` CLI all talk to that same local HTTP server.
- **Self-hosted remote mode:** `@veyra/server` runs inside Docker (or any Node 22 host) with `VEYRA_DB_PATH` on a persistent volume and `VEYRA_TOKEN` bearer auth, serving the built `@veyra/web` bundle directly. `@veyra/desktop` and `@veyra/cli` switch to remote mode via their local client configs without code changes.
