---
id: human.overview
type: view
scope: human
sourceVersion: f62c1c9
derivedFrom:
  - architecture.monorepo-boundaries
  - features.cockpit-views
  - interfaces.cli-and-agent-skill
---
# Veyra Overview

Veyra is a calm visual focus cockpit and self-hostable TypeScript server designed for modern work across parallel projects and AI agents. T3 Code acts as the conversational thinking interface via the `veyra` CLI, while the Veyra desktop and web app keeps `Today` honest about daily capacity, measures real focus time with a count-up stopwatch, aligns work to Personal and Company `Goals`, tracks project weekly time intentions, and guides a four-chapter Weekly `Review` that auto-syncs conclusions back to T3 Code.

## Entry Points

- **Desktop app (macOS):** `pnpm dev:desktop` (starts an embedded local server on `127.0.0.1:4173` backed by `~/.veyra/veyra.db`, plus menu bar tray and global `⌘⇧P` quick capture).
- **Web + API server:** `pnpm dev:server` and `pnpm dev:web`.
- **Self-hosted container:** `docker compose up -d --build`.
- **CLI for terminal and T3 Code:** `veyra today --json` (agent runbook in `skills/veyra/SKILL.md`).

## Where To Look Next

- Product principles and deliberate non-goals: [VISION.md](../VISION.md)
- Local installation and native Electron rebuilds: [setup.md](setup.md)
- All workspace scripts and CLI shortcuts: [commands.md](commands.md)
- Package boundaries and domain rules: [architecture.md](architecture.md)
- Canonical deep-dive knowledge docs: [knowledge/README.md](../knowledge/README.md)
