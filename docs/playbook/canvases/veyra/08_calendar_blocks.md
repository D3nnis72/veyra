---
visual:
  status: Shipped (Granola follow-up open)
  created: 2026-11-26
  as-of: 2026-11-26
  lang: en
---
# Step 08: Accepted Calendar Events as Blocks and Meeting Auto-Focus

> **Main question:** Sync only accepted Outlook calendar events, make calendar entries real blocks instead of a separate entity, and auto-start focus or notify to start focus when a meeting begins.
>
> Living map of remaining work only. Shipped behavior lives in [calendar-sync-webhooks.md](../../../knowledge/interfaces/calendar-sync-webhooks.md), [domain-invariants.md](../../../knowledge/architecture/domain-invariants.md), [cockpit-views.md](../../../knowledge/features/cockpit-views.md), and [desktop-shell-capture.md](../../../knowledge/features/desktop-shell-capture.md).

## Shipped {#shipped updated=2026-11-26}

- **Accepted-only Outlook CLI sync:** `lio-outlook-cli` (`cal list --json`) now emits `responseStatus` and `isCancelled`, and Veyra keeps only `accepted` and `organizer` non-cancelled events when accepted-only filtering is enabled (soft-deleting untouched previously synced unaccepted meetings on re-sync).
- **Calendar entries unified directly into `blocks`:** Synced meetings live in `blocks` with `calendarSource`, `externalEventId`, and `meetingUrl` (with idempotent migration from legacy `calendar_events`). They share `BlockDetailDrawer`, `FocusView`, `TrayPopover`, webhooks, and post-block auto-summaries, count tracked sessions into `focused today`, Project weekly hours, and `Review`, and stay excluded from `Up Next` and midnight rollover.
- **Desktop meeting focus automation:** `MeetingFocusScheduler` in `@veyra/desktop` auto-starts focus (+ quiet macOS notification) when idle at meeting start, notifies to switch when already focusing, and notifies to open the Focus Complete panel at meeting end while keeping the stopwatch running. Controlled by `Settings.meetingAutoFocusEnabled` (default `true`).

## Open Follow-Up {#followup updated=2026-11-26}

```steps
- [ ] granola-post-meeting: Attach Granola note link and summary after a meeting block finishes | owner: Agent | done-when: finishing a calendar-synced block via `hook listen --auto-summary` attaches the matching Granola note link to `externalLinks` and folds Granola's summary into `autoSummary` | updated: 2026-11-26
  Local `Granola.app` storage (`granola.db`, cache) is encrypted and exposes no Shortcut or URL command to start recording, so post-meeting sync should query Granola MCP from the existing `hook listen` pipeline after a short delay once Granola finishes summarizing.
```
