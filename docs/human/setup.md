---
id: human.setup
type: view
scope: human
sourceVersion: f62c1c9
derivedFrom:
  - architecture.monorepo-boundaries
  - features.desktop-shell-capture
  - operations.testing-and-verification
---
# Local Setup

## Prerequisites

- Node.js `>= 22.0.0`
- pnpm `>= 10.0.0`
- macOS with Xcode command line tools (for native `better-sqlite3` compilation and Electron desktop mode)
- Optional: Docker Desktop or Colima for self-hosted container verification

## First-Time Install And Verify

```bash
pnpm install
pnpm typecheck
pnpm build
pnpm test
```

## Running Locally

- **Desktop app (embedded SQLite server + menu bar + `⌘⇧P`):**
  ```bash
  pnpm --filter @veyra/desktop rebuild:native
  pnpm dev:desktop
  ```
- **Standalone API server + Vite web dev server:**
  ```bash
  pnpm dev:server
  pnpm dev:web
  ```
- **Using the `veyra` CLI against the local server:**
  ```bash
  node packages/cli/dist/index.js today --json
  ```
  Or link globally with `pnpm --filter @veyra/cli link --global` so `veyra` is available on `PATH`.

For environment variables see [environment.md](environment.md); for canonical desktop runtime details see `features.desktop-shell-capture`.
