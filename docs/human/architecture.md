---
id: human.architecture
type: view
scope: human
sourceVersion: f62c1c9
derivedFrom:
  - architecture.monorepo-boundaries
  - architecture.domain-invariants
  - architecture.design-system-tokens
  - interfaces.http-sse-api
---
# Architecture Summary

Veyra is a five-package pnpm TypeScript monorepo with a strict single API boundary: external clients never touch SQLite directly.

## Packages

- `@veyra/core`: SQLite database migrations, Drizzle tables, domain services, and browser-safe Zod types (`@veyra/core/types`).
- `@veyra/server`: Hono REST API, `/api/events/stream` SSE hub, midnight rollover guard, calendar sync runner, outgoing webhooks, and optional SPA static hosting.
- `@veyra/cli`: `veyra` command-line client with `--json` output and local config file support.
- `@veyra/web`: React 19 + Tailwind 4 + Vite 8 cockpit UI implementing the Figma pure neutral dark tokens and TanStack Query + SSE live updates.
- `@veyra/desktop`: Electron 45 macOS wrapper embedding `@veyra/server` in local mode (or connecting to a remote self-hosted server), with menu bar tray and global `⌘⇧P` floating quick capture.

## Key Invariants

- Single active `FocusSession` at any time (`start`/`resume` auto-closes any open session).
- Orthogonal `Goal` (`personal` or `company`, measured actuals only), `Project` (including non-deletable system `Other` and optional `weeklyTimeMinutes` intentions), and `Ops` boolean flag.
- Deterministic capacity signals (`Room today`, `Fit Line`, suggested order, size drift, and 4-chapter review findings) computed in `@veyra/core` so UI and CLI see identical facts.
- Timezone-anchored midnight rollover (`Settings.timezone`) with guilt-free recurring blocks that vanish untouched without carryover.

For full canonical rules, see `architecture.monorepo-boundaries`, `architecture.domain-invariants`, `architecture.design-system-tokens`, and `interfaces.http-sse-api`.
