---
id: architecture
type: overview
scope: architecture
authority: canonical
sourceVersion: 432c801
extends: knowledge.index
includes:
  - architecture.monorepo-boundaries
  - architecture.domain-invariants
  - architecture.design-system-tokens
updateWhen:
  - workspace packages or dependency boundaries change
  - core entity invariants or storage rules change
  - design tokens or shared UI primitives change
---
# Veyra Architecture

## Adaptive Architecture Contract

Veyra ships as a pnpm TypeScript monorepo under `packages/` with five workspace packages: `@veyra/core`, `@veyra/server`, `@veyra/cli`, `@veyra/web`, and `@veyra/desktop`. Keep new code inside the owning package rather than introducing parallel utility packages before reuse is proven.

## Project Continuity Rules

- Treat executable code, tests, Drizzle/SQLite schema, and Zod contracts as ground truth.
- Keep English UI copy and plain Veyra terminology (`Today`, `Plan`, `Calendar`, `Projects`, `Review`, `Focus`, `Goals`, `Blocks`, `Ops`, `Daily Notes`, `Later`, `Settings`).
- Preserve the product guardrails from [docs/VISION.md](../../VISION.md): single active focus session, count-up stopwatch, no fake time estimates on `Plan`, no red overdue badges, and no Work/Personal split.

## Structural Ownership

- `@veyra/core` owns SQLite migrations, Drizzle tables, domain services, and browser-safe Zod contracts (`@veyra/core/types`).
- `@veyra/server` owns the Hono HTTP API, SSE hub, midnight rollover guard, calendar sync runner, and outgoing webhook dispatcher.
- `@veyra/cli` owns the `veyra` terminal interface; `skills/veyra/SKILL.md` owns agent guidance for T3 Code.
- `@veyra/web` owns the React cockpit UI, design tokens, and TanStack Query + SSE state sync.
- `@veyra/desktop` owns the Electron macOS shell, embedded local server lifecycle, tray icon, and global `⌘⇧P` quick capture.

## Configuration First

Runtime settings divide cleanly by scope: workspace behavior lives in the singleton SQLite `Settings` row (`timezone`, `calendarSyncMode`, `webhookUrl`), server startup options come from `VEYRA_*` environment variables, and client connection targets live locally in Electron `client-config.json` or CLI `~/.veyra/config.json`.

## Reuse And Composition

Shared UI primitives live in `packages/web/src/components/` (`Button`, `Pill`, `PropertyChip`, `ProjectBadge`, `LinkChip`, `DockedDrawer`, `ModalSheet`, `ToggleSwitch`). Compose drawers, modals, and views from these primitives instead of duplicating chip or surface markup.

## Leaves

- Package structure, dependency direction, and single API boundary. See → `architecture.monorepo-boundaries`
- Sync-ready SQLite persistence rules and behavioral invariants. See → `architecture.domain-invariants`
- Neutral dark visual tokens, layout rules, and shared UI primitives. See → `architecture.design-system-tokens`
