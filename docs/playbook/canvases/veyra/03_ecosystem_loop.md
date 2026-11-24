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

- **macOS Menu Bar Live Focus Timer & Quick Controls:** Live tabular-digit stopwatch and truncated active block title directly in the macOS menu bar synced over `/api/events/stream`, with quick `Open Focus` / `Pause Session` / `Stop Session` / `Complete Block` controls while focusing and one-click `Up Next` block launch while idle (canonical spec in [desktop-shell-capture.md](../../../knowledge/features/desktop-shell-capture.md)).

## Remaining Scope {#scope updated=2026-11-24}

- **Automatic post-block summary and `Ops` pattern extraction via T3 Code event hook:** When a focus block finishes (`focus.ended` / `block.completed`), a webhook triggers a lightweight background agent in T3 Code. It inspects T3 chats (and later Teams threads) from that exact time window to see what was actually done, whether it worked, and which projects were touched, then writes a short honest summary back via `veyra summary set`. On blocks flagged `Ops`, it specifically captures the recurring request or failure pattern so `Review` can turn operational drag into concrete automation or product-feature proposals.
- **T3 Code Focus Mode filter:** When a focus block starts (`focus.started`), a targeted update in T3 Code reacts to the event and filters visible projects and threads to the active project so parallel workstreams stop competing for attention.
- **Teams, Outlook, and macOS Focus presence write-back:** Optional automatic status updates in Teams, Outlook, and macOS Focus Mode while a focus block is running (read-only Outlook/ICS meeting sync already ships in Step 02 MVP).
- **Inline Notion link picker:** Search and attach Notion tasks directly from the Block Detail drawer without pasting URLs manually.
- **Dedicated iOS app:** Mobile client (native SwiftUI or Expo) talking to the same Step 02 server API with a local offline cache.
