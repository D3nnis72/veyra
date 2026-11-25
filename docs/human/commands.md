---
id: human.commands
type: view
scope: human
sourceVersion: f62c1c9
derivedFrom:
  - interfaces.cli-and-agent-skill
  - operations.testing-and-verification
  - operations.docker-self-hosting
---
# Commands Reference

## Root Workspace Scripts (`package.json`)

| Command | Purpose |
| --- | --- |
| `pnpm typecheck` | Run TypeScript `--noEmit` across all five packages |
| `pnpm build` | Build `core`, `server`, `cli`, `web`, and `desktop` |
| `pnpm test` | Run all Vitest suites (`node` and `web` jsdom projects) |
| `pnpm test:e2e` | Run the end-to-end daily-driver verification suite |
| `pnpm dev:server` | Start `@veyra/server` in watch mode on `127.0.0.1:4173` |
| `pnpm dev:web` | Start `@veyra/web` Vite dev server |
| `pnpm dev:desktop` | Build `@veyra/desktop` main/preload bundles and launch Electron |
| `pnpm --filter @veyra/desktop rebuild:native` | Rebuild `better-sqlite3` for Electron's Node ABI |

## Docker Commands

```bash
docker compose up -d --build
curl -fsS http://127.0.0.1:4173/api/health
docker compose down
```

## Common `veyra` CLI Commands

Always pass `--json` in scripts and T3 Code sessions (full catalog in `interfaces.cli-and-agent-skill` and `skills/veyra/SKILL.md`):

- Inspect: `veyra today --json`, `veyra plan --json`, `veyra goals --json`, `veyra review --week 47 --json`, `veyra focus status --json`
- Plan, goals & prune: `veyra add "..." --project "..." --size 1h --date YYYY-MM-DD --json`, `veyra project update "..." --weekly-time 4h --json`, `veyra goal create "..." --kind company --done-when "..." --json`, `veyra goal close "..." --status achieved --json`, `veyra park <id> --revisit next-week --json`, `veyra drop <id> --reason no_room --json`
- Focus & sessions: `veyra start <id> --json`, `veyra pause --note "..." --json`, `veyra done --energy up --sense moved --outcome "..." --json`, `veyra session split <sessionId> --at <ISO> --gap 15 --json`
- Notes, review & calendar: `veyra note add "..." --json`, `veyra events sync --json`, `veyra review complete --week 47 --rule "..." --kept yes --json`
- Event hooks & auto-summary: `veyra hook listen --port 4174 --auto-summary --summarizer-cmd "claude -p" --on-review-complete "./sync.sh"`, `veyra hook summarize <blockId> --cmd "claude -p" --dry-run --json`
