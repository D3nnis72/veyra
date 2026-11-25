---
id: interfaces.cli-and-agent-skill
type: summary
scope: interfaces
authority: canonical
sourceVersion: f4264a1
extends: interfaces
dependsOn:
  - interfaces.http-sse-api
groundedIn:
  - packages/cli/src/index.ts
  - packages/cli/src/commands.ts
  - packages/cli/src/client.ts
  - packages/cli/src/config.ts
  - packages/cli/src/hook-listener.ts
  - packages/cli/src/auto-summary.ts
  - skills/veyra/SKILL.md
updateWhen:
  - CLI commands, flags, config resolution, or error format change
  - T3 Code agent skill instructions change
---
# CLI Contract And T3 Code Agent Skill

`@veyra/cli` exposes the `veyra` binary (`packages/cli/src/index.ts`) as the primary interface for terminal users, T3 Code, Claude Code, and automation scripts. It communicates exclusively with `@veyra/server` over HTTP.

## Connection And Output Conventions

- **Config resolution order (`packages/cli/src/config.ts`):**
  - Server URL: `VEYRA_SERVER_URL` env var → `~/.veyra/config.json` (or `VEYRA_CONFIG_PATH`) → default `http://127.0.0.1:4173`.
  - Bearer token: `VEYRA_TOKEN` env var → `~/.veyra/config.json` → none.
  - Actor header: `VEYRA_ACTOR` env var (`user`, `cli`, `agent`, `hook`, defaulting to `cli`). T3 Code agents set `VEYRA_ACTOR=agent`.
  - Optional test clock: `VEYRA_NOW` forwards `X-Veyra-Now` when server test clock mode is active.
- **Deterministic `--json` mode:** Every subcommand accepts `--json` (before or after the subcommand). Successful calls print pure JSON to stdout; failures print `{ "error": { "code", "message" } }` to stderr with a non-zero exit code.
- **Name or UUID ergonomics:** `--project` and `--goal` flags accept either a UUID or a case-insensitive exact name, resolved via `packages/cli/src/client.ts`.

## Command Families

Full option signatures live in `packages/cli/src/commands.ts` and `skills/veyra/SKILL.md`:

- **Configuration:** `veyra config show` (alias `get`), `veyra config set --url <url> [--token <token>] [--clear-token]`
- **Read views:** `veyra today` (includes `roomToday`, `suggestedOrder`, `fitLine`, `dayLookBack`), `veyra plan` (includes `projectTimeStrip` and day room), `veyra calendar`, `veyra inbox`, `veyra later`, `veyra projects`, `veyra goals [--kind personal|company] [--status active|achieved|archived] [--all]` (active-only by default), `veyra goal show <idOrName>`, `veyra review [--week <N|YYYY-MM-DD>]`, `veyra show <blockId>`, `veyra focus status`
- **Plan, goals, and pruning:** `veyra add` / `veyra update` (`--size 30m|1h|2h|auto`), `veyra move` (`--date`, `--start`, `--end`), `veyra reorder`, `veyra park --revisit <horizon|YYYY-MM-DD>`, `veyra drop [--reason not_important|someone_else|no_room] [--stop-series]`, `veyra reopen`, `veyra project create/update` (`--weekly-time <dur|none>`, `--keywords <csv>`), `veyra goal create/update` (`--kind personal|company`, `--done-when`, `--check-in`, `--measure`, `--if-it-stalls`, `--color`), `veyra goal close <idOrName> --status achieved|let-go [--note]`
- **Focus and retroactive session edits:** `veyra start`, `veyra pause [--note]`, `veyra resume`, `veyra stop` (ends session, keeps time), `veyra cancel` (discards active session via `POST /api/focus/cancel`; `focus.ended` emits `reason: "cancelled"` and auto-summary skips it), `veyra done [--energy] [--sense moved|partly|motion] [--outcome]`, `veyra summary set <id> <text>`, `veyra summary clear <id>`, `veyra session log`, `veyra session trim`, `veyra session split --at <ISO> --gap <min>`, `veyra session delete <sessionId>`
- **Daily notes, review, and meetings:** `veyra note add`, `veyra notes [--week]`, `veyra review set-rule <rule> [--kept yes|partly|no]`, `veyra review complete [--week] [--rule] [--kept]`, `veyra review reopen [--week]`, `veyra events`, `veyra events sync`, `veyra events auto-match`, `veyra events upsert`, `veyra events assign`
- **Event hooks listener & auto-summary runner:**
  - `veyra hook listen [--port 4174] [--host 127.0.0.1] [--path /hooks/veyra] [--auto-summary --summarizer-cmd <cmd>] [--workspace <dir>] [--context-cmd <cmd>] [--min-minutes 5] [--dry-run] [--on-focus-start <cmd>] [--on-focus-end <cmd>] [--on-complete <cmd>] [--on-review-complete <cmd>] [--on-any <cmd>] [--secret <secret>] [--timeout <ms>]` (accepts `/hooks/veyra`, `/webhook`, and `/` by default; streams NDJSON records including `auto_summary_result` when `--json` is passed)
  - `veyra hook summarize <blockId> [--from <iso>] [--to <iso>] [--cmd <summarizerCmd>] [--workspace <dir>] [--context-cmd <cmd>] [--min-minutes 5] [--timeout <ms>] [--dry-run] [--json]` (collects window context, branches prompt on `block.isOps`, invokes stdin-to-stdout summarizer, and writes back `autoSummary` via `PATCH /api/blocks/:id`)

## Bundled Agent Skill

`skills/veyra/SKILL.md` provides the operational runbook for T3 Code and coding agents: always pass `--json`, set `VEYRA_ACTOR=agent`, inspect state before mutating notes or links, keep weekly time intentions on Projects only, wire `--on-review-complete` for automatic Monday handoff, and confirm before stopping recurring series or archiving projects/goals.
