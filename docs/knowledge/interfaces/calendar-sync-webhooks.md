---
id: interfaces.calendar-sync-webhooks
type: architecture
scope: interfaces
authority: canonical
sourceVersion: 6f4ad5c
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
  - packages/cli/src/hook-listener.ts
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
- **Upsert preservation:** Upserts into `calendar_events` keyed by `(source, externalId)`. Re-syncing refreshes meeting time, title, and `meetingUrl` while preserving user-assigned `projectId`, `goalId`, `isOps`, `notes`, and `externalLinks`.
- **Filtering:** When `Settings.skipDeclinedAndAllDay` is enabled (default `true`), declined invitations and all-day events are excluded before upsert.
- **Status reporting:** Exposes `state` (`connected`, `error`, `manual`), `lastSyncAt`, `lastCount`, and `lastError` via `GET /api/settings` so `Settings → Integrations` surfaces actionable diagnostics.

## Meeting Auto-Matching To Projects

`packages/core/src/services/calendar-events.ts` assigns synced meetings to a Project deterministically, in two stages. It only ever touches events whose `projectId` is `NULL`, so a manual assignment is never overwritten.

1. **Learned title:** If another non-deleted meeting with the same normalized title (`trim`, lowercase, collapsed whitespace) already has a `projectId`, the new meeting inherits its `projectId`, `goalId`, and `isOps`.
2. **Project keywords:** Active, non-deleted, non-system Projects match case-insensitively on word or separator boundaries (letters `a-z0-9äöüß` count as word characters, so `Arc` does not match `Architecture`). A Project with non-empty `matchKeywords` matches only those keywords; a Project without keywords falls back to its name when the name has at least 3 characters. When several Projects match, the longest matched keyword wins (ties keep the first Project by name), so `Core-Northstar issue review` goes to `Northstar` rather than `Core`. The meeting gets `projectId` plus the Project's `defaultGoalId`.

Auto-matching runs inside `upsertCalendarEvents` for new and still-unassigned events (result field `autoMatchedCount`) and retroactively through `autoMatchUnassignedCalendarEvents`. The server calls the retro pass after `POST /api/projects`, after `PATCH /api/projects/:id` when `matchKeywords`, `defaultGoalId`, `name`, or `status` change, after `POST /api/events/sync`, and on `POST /api/events/auto-match` (`veyra events auto-match`), broadcasting SSE `events.updated` when `matchedCount > 0`. Keywords are set in `ProjectModal` (`Calendar sync keywords`) or via `veyra project create|update --keywords "Northstar, NS"` (`none` clears). Existing databases gain the `projects.match_keywords` column (`TEXT NOT NULL DEFAULT '[]'`) through an idempotent `PRAGMA table_info` check in `openVeyraDb`.

## Sync Adapters

- **`OutlookCliAdapter` (`outlook-cli-adapter.ts`):** Executes `Settings.outlookCliCommand` with `--start YYYY-MM-DD --end YYYY-MM-DD --limit 250 --json`, parsing a JSON array of normalized meeting records (`externalId`, `title`, `startAt`, `endAt`, optional `isAllDay`, `isDeclined`, `meetingUrl`) with timezone-aware date normalization. Returns structured `CalendarSyncError` diagnostics when the binary is missing or emits non-JSON output.
- **`IcsFeedAdapter` (`ics-adapter.ts`):** Fetches any `.ics` feed URL (Outlook/Microsoft 365, Google, Apple Calendar) using `node-ical`, expands recurring `RRULE` occurrences across the sync window, inspects multi-attendee `PARTSTAT=DECLINED` parameters accurately, and extracts Teams/Zoom meeting URLs. Works identically locally and inside Docker.
- **`Manual / CLI Push` (`calendarSyncMode = 'manual'`):** Disables polling while allowing direct event creation via `POST /api/events/upsert` or `veyra events upsert`.

## Outgoing Event Webhooks And Local Listener

`WebhookDispatcher` (`packages/server/src/webhooks.ts`) sends fire-and-forget JSON `POST` requests whenever `Settings.webhookUrl` is configured and the event is enabled in `Settings.webhookEvents`:

- **Lifecycle events:** `focus.started`, `focus.ended`, `block.completed`, plus `webhook.test` triggered by `POST /api/settings/test-hook`.
- **Delivery contract:** Sends `Content-Type: application/json`, `User-Agent: Veyra-Webhook/0.1.0`, `X-Veyra-Event: <event>`, and body `{ event, timestamp, data }`, with a 5-second timeout and up to 2 attempts (250ms retry delay). When `VEYRA_WEBHOOK_SECRET` (or `WebhookDispatcherOptions.secret`) is set, deliveries also include `X-Veyra-Signature-256: sha256=<hmac-hex>`.
- **Diagnostics & live updates:** Every delivery outcome (`webhook.delivered` or `webhook.failed`) is recorded in `activity_log` with `actor = 'hook'` and broadcast over SSE (`entity: 'activity'`) so `Settings → Integrations` surfaces recent webhook deliveries live alongside `Test Hook`.
- **Built-in CLI receiver (`veyra hook listen`):** `packages/cli/src/hook-listener.ts` provides a lightweight local HTTP receiver (default `http://127.0.0.1:4174/webhook`, also accepting `POST /` and `GET /health`). It optionally verifies `X-Veyra-Signature-256` (`--secret` / `VEYRA_WEBHOOK_SECRET`), responds `202 Accepted` immediately so longer-running agent scripts never trip the 5-second webhook timeout, pipes the raw JSON payload to stdin, and exports `VEYRA_EVENT`, `VEYRA_BLOCK_ID`, `VEYRA_BLOCK_TITLE`, `VEYRA_BLOCK_IS_OPS`, `VEYRA_PROJECT_ID`, `VEYRA_GOAL_ID`, `VEYRA_SESSION_ID`, `VEYRA_SESSION_START`, `VEYRA_SESSION_END`, `VEYRA_FOCUS_END_REASON`, `VEYRA_TOTAL_BLOCK_MINUTES`, and `VEYRA_PAYLOAD` to `--on-focus-start`, `--on-focus-end`, `--on-complete`, or `--on-any` handlers (which can write post-block summaries back via `veyra summary set <blockId> "..."`).
