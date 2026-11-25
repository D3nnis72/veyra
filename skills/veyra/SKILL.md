---
name: veyra
description: Use when planning days, pruning Inbox/Later, managing focus sessions, capturing daily notes, assigning meetings, or running weekly reviews in Veyra via the `veyra --json` CLI.
---

# Veyra CLI Skill (T3 Code & Agents)

Veyra is a personal work cockpit built around **Goals → Projects → Blocks → Focus Sessions**, plus synced calendar events, daily notes, and weekly reviews.

## Connection & Conventions

- **Always pass `--json`** (before or after any subcommand) so output is deterministic JSON and errors return `{ "error": { "code", "message" } }` on stderr.
- Set `VEYRA_ACTOR=agent` when acting autonomously so Veyra's activity log attributes agent actions cleanly.
- Server connection resolves in order: `VEYRA_SERVER_URL` / `VEYRA_TOKEN` env vars → `~/.veyra/config.json` → `http://127.0.0.1:4173`.
- Configure once with:
  ```bash
  veyra config set --url http://127.0.0.1:4173 --token <optional-token> --json
  ```
- `--project` and `--goal` accept either a UUID or a case-insensitive exact name.

## 1. Plan the Day or Week

1. Inspect current state before changing anything (`today --json` includes `roomToday`, `suggestedOrder`, `fitLine`, and `dayLookBack`; `plan --json` includes `projectTimeStrip` and per-day `plannedMinutes` vs `roomMinutes`; `goals --json` returns active Personal & Company goals with measured weekly focus):
   ```bash
   veyra today --json
   veyra plan --json
   veyra goals --json
   veyra events sync --json
   ```
2. Manage goals and project weekly time intentions (`weeklyTimeMinutes` lives exclusively on Projects; Goals measure actual focus without hour targets):
   ```bash
   veyra goal create "Generate upsells" --kind company --done-when "10 signed upsells" --check-in 2027-03-31 --measure "3 of 10" --if-it-stalls "Weekly account review" --json
   veyra goal update "Generate upsells" --measure "4 of 10" --json
   veyra goal close "Generate upsells" --status achieved --note "Hit Q1 target" --json   # or --status let-go
   veyra project create "Platform Core" --weekly-time 4h --goal "Generate upsells" --json
   veyra project update "Platform Core" --weekly-time 3h --json   # pass none to clear
   ```
3. Add new blocks (use `--ops` for operational/unplanned work; use `--size 30m|1h|2h` or `auto`; omit `--date` to capture into `Inbox`):
   ```bash
   veyra add "Implement retry backoff" --project "Platform Core" --date 2026-11-23 --size 1h --start 09:30 --end 11:00 --json
   veyra add "Triage Sentry alerts" --ops --date 2026-11-23 --repeat mon,wed,fri --json
   veyra add "Review RFC" --link https://github.com/acme/repo/pull/42 --notes "Focus on migration section" --json
   ```
4. Schedule, time-block, or reorder existing blocks:
   ```bash
   veyra move <blockId> --date 2026-11-24 --start 14:00 --end 15:30 --json
   veyra reorder <blockId> --after <nextBlockId> --json   # places <blockId> before <nextBlockId>
   ```
5. Assign synced meetings so goal-linked meetings show up in Weekly Review. Most meetings auto-match by learned title or Project keywords; give a Project keywords and retro-match first, then assign the rest by hand (manual assignments are never overwritten):
   ```bash
   veyra project update "Acme" --keywords "Acme, AC" --json
   veyra events auto-match --json
   veyra events --json
   veyra events assign <eventId> --project "Platform Core" --goal "Ship Q4 Reliability" --notes "Aligned on rollout" --json
   ```

## 2. Prune `Inbox` and `Later`

```bash
veyra inbox --json
veyra later --json
```
For each stale or ambiguous item, decide one of three actions:
- **Schedule:** `veyra move <id> --date YYYY-MM-DD --json`
- **Park with revisit horizon (`next-week`, `2w`, `next-month`, `next-quarter`, or `YYYY-MM-DD`):**
  `veyra park <id> --revisit next-week --json`
- **Drop (optional `--reason not_important|someone_else|no_room`, and `--stop-series` to end a recurring series):**
  `veyra drop <id> --reason no_room --json`
  `veyra drop <id> --stop-series --json`

## 3. Focus Loop & Session Adjustments

Veyra enforces a **single active focus session** invariant (`start`/`resume` automatically closes any prior open session).

```bash
veyra focus status --json
veyra start <blockId> --json
veyra pause --note "Left off at step 2" --json
veyra resume <blockId> --json
veyra stop --json
veyra done --energy up --sense moved --outcome "Shipped retry policy" --json   # omits <id> to complete active block; --sense accepts moved|partly|motion
veyra summary set <blockId> "Completed audit across 3 queues" --json
veyra summary clear <blockId> --json
```

Adjust sessions retroactively when a timer ran long or had an interruption:
```bash
veyra session log <blockId> --start 2026-11-23T09:00:00Z --end 2026-11-23T10:15:00Z --note "Deep work" --json
veyra session trim <sessionId> --start 2026-11-23T09:05:00Z --end 2026-11-23T10:00:00Z --json
veyra session split <sessionId> --at 2026-11-23T09:30:00Z --gap 15 --json
```

## 4. Event Hooks, Post-Block Auto-Summary & `review.completed` Handoff

Run Veyra's built-in webhook receiver and post-block auto-summary runner to react to `focus.started`, `focus.ended`, `block.completed`, and `review.completed` events (configure `http://127.0.0.1:4174/hooks/veyra` or `/webhook` in `Settings → Integrations`):

```bash
# Built-in post-block auto-summary & automatic review.completed handoff
veyra hook listen --port 4174 \
  --auto-summary \
  --summarizer-cmd "claude -p" \
  --on-review-complete "./sync-weekly-review.sh" \
  --workspace ~/code/my-repo \
  --min-minutes 5 \
  --json

# Run on demand for a single block (use --dry-run to inspect context & prompt without writing)
veyra hook summarize <blockId> --cmd "claude -p" --workspace ~/code/my-repo --json
veyra hook summarize <blockId> --from 2026-11-23T09:00:00Z --to 2026-11-23T09:45:00Z --dry-run --json
```

- `--auto-summary` runs automatically on `focus.ended` and `block.completed` (deduplicating paired completion events), skips trivial sessions under `--min-minutes` (default `5`), gathers block notes/outcome/resume notes plus opt-in git commits (`--workspace <dir>`, repeatable) and custom transcript/chat collectors (`--context-cmd <cmd>`, repeatable), prompts for a 1–2 sentence progress summary — highlighting recurring failure/request patterns and automation candidates when `block.isOps` is true — and writes back to `PATCH /api/blocks/:id` (`autoSummary`).
- `--on-review-complete <cmd>` runs automatically when a Weekly Review is completed (`review.completed`), receiving the persisted snapshot JSON on stdin plus `VEYRA_WEEK_START`, `VEYRA_WEEK_NUMBER`, and `VEYRA_RULE_FOR_NEXT_WEEK` env vars so T3 Code picks up next week's rule, goal outcomes, and project weekly times on Monday with zero copy-paste.
- You can also combine or replace `--auto-summary` with shell handlers (`--on-focus-start`, `--on-focus-end`, `--on-complete`, `--on-review-complete`, `--on-any`), which receive the full JSON payload on stdin plus structured env vars (`VEYRA_EVENT`, `VEYRA_BLOCK_ID`, `VEYRA_BLOCK_TITLE`, `VEYRA_BLOCK_IS_OPS`, `VEYRA_PROJECT_ID`, `VEYRA_GOAL_ID`, `VEYRA_SESSION_START`, `VEYRA_SESSION_END`, `VEYRA_TOTAL_BLOCK_MINUTES`, `VEYRA_WEEK_START`, `VEYRA_WEEK_NUMBER`, `VEYRA_RULE_FOR_NEXT_WEEK`, `VEYRA_PAYLOAD`).
- Pass `--secret <secret>` (or set `VEYRA_WEBHOOK_SECRET` on both server and listener) to require HMAC-SHA256 verification via `X-Veyra-Signature-256`.
- `--json` streams newline-delimited JSON (NDJSON) events (`listening`, `event`, `handler_result`, `auto_summary_result`, `rejected`, `stopped`).

## 5. Daily Notes & Weekly Review

Capture observations throughout the week:
```bash
veyra note add "Teams muted until 11:30 worked great" --json
veyra notes --week 2026-11-23 --json
```

Run the 4-chapter weekly review (`--week` accepts either an ISO week number `1–53` or a `YYYY-MM-DD` date):
1. Pull full 4-chapter review metrics (`chapterOpeningSentences`, `dayStrip`, `companyGoalPct`/`personalGoalPct`, `senseCounts`, `goalReviews`, `worthSecondLook`, `projectBuckets`, `planningFindings`, `ruleSuggestions`, `opsRadar`, `chronicCarryovers`, `pastRevisitLater`, `dailyNotes`, `snapshot`):
   ```bash
   veyra review --json
   veyra review --week 47 --json
   ```
2. Walk through `goalReviews` (check-in due, quiet, stalled), `projectBuckets`, `planningFindings`, `chronicCarryovers`, `pastRevisitLater`, and `opsRadar.pureOpsItems` with the user.
3. Complete the review (persists rule, rule-kept state, and compact snapshot, and dispatches `review.completed` hooks) or update just the rule:
   ```bash
   veyra review complete --week 47 --rule "Protect morning focus before 11:30" --kept yes --json
   veyra review set-rule "Protect morning focus before 11:30" --kept partly --json
   veyra review reopen --week 47 --json
   ```

## Guardrails

- Read (`today`, `plan`, `review`, `show <id>`) before mutating blocks or notes so you never overwrite existing user notes or links unintentionally.
- Confirm with the user before dropping recurring series (`--stop-series`) or archiving projects/goals.
- Never parse human-formatted output when `--json` is available.
