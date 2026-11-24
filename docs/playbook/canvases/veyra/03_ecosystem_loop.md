---
visual:
  status: In Progress
  created: 2026-11-22
  as-of: 2026-11-24
  lang: en
---
# Step 03: Ecosystem Loop (T3 Code, Post-Block Summary, and iOS App)

> **Main question:** After the lean MVP ships, how do we connect **Veyra** deeply with T3 Code, Outlook, Teams, Notion, macOS, and iOS so starting a focus block protects the entire workspace and ending one automatically summarizes what actually happened (including repeating `Ops` patterns)?
>
> Living map of this brainstorm. Rewrite it when the direction changes.
> Specs and plans are distilled from this file. Not canonical product behavior.
> After shipping, knowledge docs own shipped truth; leftovers hold remaining work only, then delete when nothing remains.

Overarching context lives in [00_overview.md](00_overview.md) and [docs/VISION.md](../../../VISION.md). Builds on the shipped MVP documented in [docs/knowledge/README.md](../../../knowledge/README.md).

## Shipped {#shipped updated=2026-11-24}

- **macOS Menu Bar Active Project Icon & Quick Controls:** Icon-only macOS menu bar indicator with zero text clutter (`tray.setTitle('')` stays empty at all times; active focus swaps the monochrome template icon to a colored rounded-square badge for the active project, with live elapsed time in the hover tooltip and dropdown header), synced over `/api/events/stream`, with quick `Open Focus` / `Pause Session` / `Stop Session` / `Complete Block` controls while focusing and one-click `Up Next` launch while idle (canonical spec in [desktop-shell-capture.md](../../../knowledge/features/desktop-shell-capture.md)).
- **Event Hooks Listener & Post-Block Auto-Summary Loop:** Local webhook receiver (`veyra hook listen`, accepting `/hooks/veyra`, `/webhook`, and `/`) with optional HMAC-SHA256 verification and a built-in `--auto-summary` runner plus on-demand `veyra hook summarize <blockId>`. Collects opt-in local context for the `[startedAt, endedAt]` window (block notes/outcome/resume notes, git commits via `--workspace`, and custom collectors via `--context-cmd` for T3 Code/Teams/agent transcripts), skips trivial sessions under `--min-minutes` (default `5`), prompts for an honest 1–2 sentence summary — with recurring request/failure pattern and automation-candidate analysis on `Ops` blocks — and writes `autoSummary` back via `PATCH /api/blocks/:id` so `BlockDetailDrawer` and Weekly Review `Ops & Automation Radar` surface it automatically (canonical specs in [calendar-sync-webhooks.md](../../../knowledge/interfaces/calendar-sync-webhooks.md) and [cli-and-agent-skill.md](../../../knowledge/interfaces/cli-and-agent-skill.md)).
- **Inline Notion Search & Link Picker:** Zero-config URL paste plus optional Notion integration token (`Settings → Integrations` or `VEYRA_NOTION_TOKEN`) powering live page/database search (`GET /api/integrations/notion/search`, `POST /api/integrations/notion/test`) directly inside `BlockDetailDrawer`, `MeetingDetailDrawer`, and `CreateBlockModal` without mirroring granular subtasks (canonical specs in [cockpit-views.md](../../../knowledge/features/cockpit-views.md) and [http-sse-api.md](../../../knowledge/interfaces/http-sse-api.md)).

## Remaining Scope {#scope updated=2026-11-24}

- **T3 Code Focus Mode Filter:** When a focus block starts (`focus.started`), a targeted update in T3 Code reacts to the event and filters visible projects and threads to the active project so parallel workstreams stop competing for attention.
- **macOS Focus Mode Presence:** Optional automatic macOS Focus / Do Not Disturb toggle while a focus block is running (for example via macOS Shortcuts CLI on `focus.started` / `focus.ended`). Teams and Outlook presence write-back are intentionally out of scope.
- **Dedicated iOS App:** Mobile client (native SwiftUI or Expo) talking to the same Step 02 server API with a local offline cache.
