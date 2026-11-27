---
id: interfaces.calendar-sync-webhooks
type: architecture
scope: interfaces
authority: canonical
sourceVersion: f4264a1
extends: interfaces
dependsOn:
  - architecture.domain-invariants
  - interfaces.http-sse-api
groundedIn:
  - packages/server/src/sync/types.ts
  - packages/server/src/sync/sync-runner.ts
  - packages/server/src/sync/outlook-cli-adapter.ts
  - packages/server/src/sync/ics-adapter.ts
  - packages/server/src/webhooks.ts
  - packages/server/src/macos-focus.ts
  - packages/cli/src/hook-listener.ts
  - packages/cli/src/auto-summary.ts
  - packages/core/src/services/calendar-events.ts
updateWhen:
  - calendar sync adapters, sync window, or filtering rules change
  - meeting auto-matching stages or Project `matchKeywords` semantics change
  - webhook event names, payload shape, or retry behavior change
---
# Calendar Sync And Event Webhooks

`@veyra/server` ships Day-1 read-only calendar synchronization and outgoing lifecycle webhooks so real meetings appear immediately and Step 03 automations can subscribe to focus transitions.

## Calendar Sync Runner Lifecycle

`CalendarSyncRunner` (`packages/server/src/sync/sync-runner.ts`) polls on `Settings.calendarSyncIntervalMin` (default 15 minutes) and runs on demand via `POST /api/events/sync` (`Sync Now` in Settings or `veyra events sync`).

- **Sync window:** Fetches `today - 7 days` through `today + 28 days` in `Settings.timezone` (expanded beyond the original 14-day draft so multi-week planning shows upcoming calls).
- **Concurrency:** Coalesces concurrent sync calls onto one in-flight promise so manual clicks never overlap background polls.
- **Upsert preservation (unified into `blocks`):** Upserts directly into `blocks` keyed by `(calendar_source, external_event_id)` with `bucket = 'scheduled'`, `scheduledDate`, `plannedStartAt`, `plannedEndAt`, `sizeMinutes`, and `meetingUrl`. Re-syncing refreshes meeting time, title, and `meetingUrl` while preserving user-assigned `projectId`, `goalId`, `isOps`, `notes`, `externalLinks`, `status`, `outcomeNote`, `energySignal`, `senseSignal`, `autoSummary`, and `sideWork`. Existing rows in the legacy `calendar_events` table are migrated idempotently into `blocks` on `openVeyraDb`. `/api/events/*` and `veyra events` remain thin projections over calendar-synced blocks (`calendarSource IS NOT NULL`).
- **Filtering:** When `Settings.skipDeclinedAndAllDay` is enabled (default `true`, labeled `Accepted only (skip unaccepted, declined & all-day)` in Settings), all-day, declined, and cancelled events are excluded, and events carrying `responseStatus` are only kept when `accepted` or `organizer` (skipping `not_responded`, `tentatively_accepted`, `declined`, and `none`). On re-sync, previously synced events that are no longer accepted are soft-deleted only if they remain `todo` with zero focus sessions, preserving tracked history.
- **Meeting focus automation (`Settings.meetingAutoFocusEnabled`, default `true`):** `MeetingFocusScheduler` in `@veyra/desktop` (`packages/desktop/src/meeting-focus-scheduler.ts`) watches today's synced calendar blocks. At a meeting's start time (within a 2-minute window), if idle it auto-starts focus on that meeting block and shows a macOS notification; if another block is already running it leaves that session untouched and sends a macOS notification offering to switch. At the meeting's end time, if the meeting block is still active, it sends a macOS notification to open the Focus Complete panel while keeping the stopwatch running.
- **Status reporting:** Exposes `state` (`connected`, `error`, `manual`), `lastSyncAt`, `lastCount`, and `lastError` via `GET /api/settings` so `Settings → Integrations` surfaces actionable diagnostics.

## Meeting Auto-Matching To Projects

`packages/core/src/services/calendar-events.ts` assigns synced meeting blocks to a Project deterministically, in two stages. It only ever touches calendar blocks whose `projectId` is still the system `Other` project (`SYSTEM_OTHER_PROJECT_ID`), so a manual assignment is never overwritten.

1. **Learned title:** If another non-deleted meeting with the same normalized title (`trim`, lowercase, collapsed whitespace) already has a `projectId`, the new meeting inherits its `projectId`, `goalId`, and `isOps`.
2. **Project keywords:** Active, non-deleted, non-system Projects match case-insensitively on word or separator boundaries (letters `a-z0-9äöüß` count as word characters, so `Arc` does not match `Architecture`). A Project with non-empty `matchKeywords` matches only those keywords; a Project without keywords falls back to its name when the name has at least 3 characters. When several Projects match, the longest matched keyword wins (ties keep the first Project by name), so `Core-Northstar issue review` goes to `Northstar` rather than `Core`. The meeting gets `projectId` plus the Project's `defaultGoalId`.

Auto-matching runs inside `upsertCalendarEvents` for new and still-unassigned events (result field `autoMatchedCount`) and retroactively through `autoMatchUnassignedCalendarEvents`. The server calls the retro pass after `POST /api/projects`, after `PATCH /api/projects/:id` when `matchKeywords`, `defaultGoalId`, `name`, or `status` change, after `POST /api/events/sync`, and on `POST /api/events/auto-match` (`veyra events auto-match`), broadcasting SSE `events.updated` when `matchedCount > 0`. Keywords are set in `ProjectModal` (`Calendar sync keywords`) or via `veyra project create|update --keywords "Northstar, NS"` (`none` clears). Existing databases gain the `projects.match_keywords` column (`TEXT NOT NULL DEFAULT '[]'`) through an idempotent `PRAGMA table_info` check in `openVeyraDb`.

## Sync Adapters

- **`OutlookCliAdapter` (`outlook-cli-adapter.ts`):** Executes `Settings.outlookCliCommand` with `--start YYYY-MM-DD --end YYYY-MM-DD --limit 250 --json`, parsing a JSON array of normalized meeting records (`externalId`, `title`, `startAt`, `endAt`, optional `isAllDay`, `isDeclined`, `isCancelled`, `responseStatus`, `meetingUrl`) with timezone-aware date normalization and Graph/O365 response-status normalization (`organizer`, `accepted`, `tentatively_accepted`, `declined`, `not_responded`, `none`). Returns structured `CalendarSyncError` diagnostics when the binary is missing or emits non-JSON output.
- **`IcsFeedAdapter` (`ics-adapter.ts`):** Fetches any `.ics` feed URL (Outlook/Microsoft 365, Google, Apple Calendar) using `node-ical`, expands recurring `RRULE` occurrences across the sync window, inspects multi-attendee `PARTSTAT=DECLINED` parameters accurately, and extracts Teams/Zoom meeting URLs. Works identically locally and inside Docker.
- **`Manual / CLI Push` (`calendarSyncMode = 'manual'`):** Disables polling while allowing direct event creation via `POST /api/events/upsert` or `veyra events upsert`.

## Outgoing Event Webhooks And Local Listener

`WebhookDispatcher` (`packages/server/src/webhooks.ts`) sends fire-and-forget JSON `POST` requests whenever `Settings.webhookUrl` is configured and the event is enabled in `Settings.webhookEvents`:

- **Lifecycle events:** `focus.started`, `focus.ended` (`data.reason`: `paused`, `stopped`, `switched`, `completed` or `cancelled`), `block.completed`, `review.completed` (`data`: `{ weekStartDate, weekNumber, ruleForNextWeek, snapshot, review }`), plus `webhook.test` triggered by `POST /api/settings/test-hook`.
- **Delivery contract:** Sends `Content-Type: application/json`, `User-Agent: Veyra-Webhook/0.1.0`, `X-Veyra-Event: <event>`, and body `{ event, timestamp, data }`, with a 5-second timeout and up to 2 attempts (250ms retry delay). When `VEYRA_WEBHOOK_SECRET` (or `WebhookDispatcherOptions.secret`) is set, deliveries also include `X-Veyra-Signature-256: sha256=<hmac-hex>`.
- **Diagnostics & live updates:** Every delivery outcome (`webhook.delivered` or `webhook.failed`) is recorded in `activity_log` with `actor = 'hook'` and broadcast over SSE (`entity: 'activity'`) so `Settings → Integrations` surfaces recent webhook deliveries live alongside `Test Hook`.

## macOS Focus Mode Presence

`MacOsFocusPresence` (`packages/server/src/macos-focus.ts`) optionally toggles native macOS Focus / Do Not Disturb via `/usr/bin/shortcuts run <shortcutName>` when focus sessions start or end:

- **Settings:** `Settings.macosFocusEnabled` (default `false`), `Settings.macosFocusStartShortcut`, and `Settings.macosFocusEndShortcut` (added idempotently via `PRAGMA table_info` migration in `openVeyraDb`).
- **Anti-flicker transition behavior:** Starting or resuming a focus session while idle runs the configured start shortcut; switching straight from one active block to another skips re-running or disabling Focus; pausing, stopping, or completing an active session runs the end shortcut.
- **Endpoints & diagnostics:** `GET /api/integrations/macos-focus/shortcuts` lists installed macOS Shortcuts for autocomplete (gracefully returning `{ supported: false, shortcuts: [] }` on non-macOS hosts), and `POST /api/integrations/macos-focus/test` runs either phase on demand. Outcomes are recorded in `activity_log` as `macos_focus.activated`, `macos_focus.deactivated`, or `macos_focus.failed`.
- **Built-in CLI receiver (`veyra hook listen`):** `packages/cli/src/hook-listener.ts` provides a lightweight local HTTP receiver on `127.0.0.1:4174` accepting `POST /hooks/veyra`, `POST /webhook`, `POST /`, and `GET /health` by default (customizable via `--path`). It optionally verifies `X-Veyra-Signature-256` (`--secret` / `VEYRA_WEBHOOK_SECRET`), responds `202 Accepted` immediately so longer-running agent scripts never trip the 5-second webhook timeout, pipes the raw JSON payload to stdin, and exports `VEYRA_EVENT`, `VEYRA_BLOCK_ID`, `VEYRA_BLOCK_TITLE`, `VEYRA_BLOCK_IS_OPS`, `VEYRA_PROJECT_ID`, `VEYRA_GOAL_ID`, `VEYRA_SESSION_ID`, `VEYRA_SESSION_START`, `VEYRA_SESSION_END`, `VEYRA_FOCUS_END_REASON`, `VEYRA_TOTAL_BLOCK_MINUTES`, `VEYRA_WEEK_START`, `VEYRA_WEEK_NUMBER`, `VEYRA_RULE_FOR_NEXT_WEEK`, and `VEYRA_PAYLOAD` to `--on-focus-start`, `--on-focus-end`, `--on-complete`, `--on-review-complete`, or `--on-any` handlers.
- **Built-in Post-Block Auto-Summary, Side Work & `Ops` Pattern Runner (`packages/cli/src/auto-summary.ts`, `packages/cli/src/collectors/t3-code.ts`):** Exposed both inline on `veyra hook listen --auto-summary --summarizer-cmd <cmd>` (for `focus.ended` and `block.completed`, deduplicating paired `focus.ended` + `block.completed` deliveries for the same `(blockId, sessionId)` within a 15-second window) and on demand via `veyra hook summarize <blockId>`. The pipeline resolves the `[startedAt, endedAt]` window (fetching full `BlockDetail` from `/api/blocks/:id` when needed), skips trivial sessions shorter than `--min-minutes` (default `5`), runs pluggable local collectors (block notes/outcome/resume notes/links, opt-in git commit logs via `--workspace <dir>`, built-in read-only T3 Code collector via `--t3` / `--t3-db <path>` that samples first user message plus last 2 messages per thread across the entire window, and custom `--context-cmd <cmd>` hooks), computes deterministic `sideWork` per other active project (mapped by name to Veyra projects, display-only with no time splitting), formats a focused prompt asking for an honest 1–2 sentence progress summary of this block only — branching on `block.isOps === true` to highlight recurring request/failure patterns and automation/productization candidates — invokes the stdin-to-stdout `--summarizer-cmd` (e.g. `claude -p`), and persists `autoSummary` and `sideWork` via `PATCH /api/blocks/:id` (with `--dry-run` preview support).
