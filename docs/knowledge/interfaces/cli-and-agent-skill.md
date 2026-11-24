---
id: interfaces.cli-and-agent-skill
type: summary
scope: interfaces
authority: canonical
sourceVersion: 432c801
extends: interfaces
dependsOn:
  - interfaces.http-sse-api
groundedIn:
  - packages/cli/src/index.ts
  - packages/cli/src/commands.ts
  - packages/cli/src/client.ts
  - packages/cli/src/config.ts
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
- **Read views:** `veyra today`, `veyra plan`, `veyra calendar`, `veyra inbox`, `veyra later`, `veyra projects`, `veyra goals`, `veyra review`, `veyra show <blockId>`, `veyra focus status`
- **Plan and prune:** `veyra add`, `veyra update`, `veyra move` (supports `--date`, `--start`, `--end`), `veyra reorder`, `veyra park --revisit <horizon|YYYY-MM-DD>`, `veyra drop [--stop-series]`, `veyra reopen`, `veyra project create/update` (`--keywords <csv>` sets calendar `matchKeywords`), `veyra goal create/update`
- **Focus and retroactive session edits:** `veyra start`, `veyra pause [--note]`, `veyra resume`, `veyra stop`, `veyra done [--energy] [--outcome]`, `veyra summary set`, `veyra session log`, `veyra session trim`, `veyra session split --at <ISO> --gap <min>`, `veyra session delete <sessionId>`
- **Daily notes, review, and meetings:** `veyra note add`, `veyra notes [--week]`, `veyra review set-rule`, `veyra events`, `veyra events sync`, `veyra events auto-match`, `veyra events upsert`, `veyra events assign`

## Bundled Agent Skill

`skills/veyra/SKILL.md` provides the operational runbook for T3 Code and coding agents: always pass `--json`, set `VEYRA_ACTOR=agent`, inspect state before mutating notes or links, and confirm before stopping recurring series or archiving projects/goals.
