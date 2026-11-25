---
id: features.review-and-rollover
type: rule
scope: features
authority: canonical
sourceVersion: 9026ead
extends: features
dependsOn:
  - architecture.domain-invariants
groundedIn:
  - packages/core/src/services/rollover.ts
  - packages/core/src/services/notes-review.ts
  - packages/core/src/services/capacity.ts
  - packages/server/src/app.ts
  - packages/web/src/views/ReviewView.tsx
updateWhen:
  - weekly review chapters, KPI formulas, project buckets, learning findings, or Ops radar change
  - review completion snapshot or midnight rollover trigger timing changes
---
# Weekly Review And Midnight Rollover

Veyra's learning loop turns real measured focus time, block sense signals, one-line outcomes, `Ops` flags, daily notes, project weekly intentions, and carryovers into a four-chapter weekly reflection that persists its snapshot and syncs automatically to T3 Code via `review.completed` hooks and `veyra review --json`.

## Midnight Rollover Trigger Guard

Rollover logic lives in `@veyra/core` (`runDailyRolloverAndRecurrence` in `packages/core/src/services/rollover.ts`, invariants in `architecture.domain-invariants`). `@veyra/server` invokes `runDailyRolloverAndRecurrence` in three places: on server boot, via a 60-second background date-change watcher (which broadcasts SSE `rollover.completed` whenever the local date in `Settings.timezone` advances), and before handling the four composite read routes (`GET /api/today`, `GET /api/plan`, `GET /api/calendar`, `GET /api/review`) — not on `/api/blocks` or mutation routes. Because rollover runs inside one SQLite transaction and checks for existing `(seriesId, today)` rows, repeated calls on the same local day are idempotent.

## Weekly Rule Continuity And Week Selection

- `WeeklyReview` records are keyed by Monday `weekStartDate` (`YYYY-MM-DD` in `Settings.timezone`). `GET /api/review` and `veyra review` accept either `weekStart=YYYY-MM-DD` or an ISO week number (`week=1..53`).
- `PUT /api/review/rule` (or `veyra review set-rule`) updates `ruleForNextWeek` and/or `previousRuleKept` (`yes`, `partly`, `no`) on the week's review record.
- `GET /api/today` displays the active Weekly Rule directly beneath the date using `activeRuleText` (previous week's `ruleForNextWeek`), falling back to the current week's `ruleForNextWeek` (`ruleInfo.activeRuleText ?? ruleInfo.nextWeekRule?.ruleForNextWeek ?? null`) when no previous-week rule exists yet.

## Four-Chapter Weekly Review Structure

`getWeeklyReview` (`packages/core/src/services/notes-review.ts`) computes all review facts for the selected Monday–Sunday week. `ReviewView.tsx` renders one scrolling page with a non-locking top `Chapter Bar` (`1 Week`, `2 Progress`, `3 Time`, `4 Next week`), a `By Goal` / `By Project` grouping toggle, and one computed opening sentence per chapter:

- **`1 Week` — What happened?:**
  - Checks whether last week's rule was kept (`Yes`, `Partly`, `No` → `previousRuleKept`).
  - Five KPI tiles: `Total Focus` (measured `FocusSession` minutes overlapping the week vs. weekly room and planned time), `Goal Alignment` (share of focus minutes tied to a `Goal`, split into `Company` and `Personal` percentages; goal-linked meetings appear in `Progress Feed` only), `Build vs. Ops` (`isOps = false` vs. `isOps = true`), `Sense` split (`moved`, `partly`, `motion`), and raw `Energy` counts (`up`, `neutral`, `down` — never collapsed into a gamified score).
  - Monday–Friday day strip comparing actual focus, weekday room, and meeting hours per day.
  - Folded `Daily Notes This Week` (all `DailyNote` bullets captured during the week via `Today`, `⌘⇧P`, or `veyra note add`) with inline expansion.
- **`2 Progress` — What moved?:**
  - One row per active goal, ordered Company first then Personal, showing measured focus time and block count only (never a weekly hour target), sense split, top `outcomeNote` lines, inline `Measure` update (appending to `goal_measure_updates`), and calm conditional prompts when `checkInDate` is reached, a goal had two quiet weeks, or a goal stalled (`ifItStalls`).
  - Grouped `Progress Feed` (`By Goal` or `By Project`) listing completed blocks and goal-linked meetings with project badge, duration, energy pill, `Ops` tag, `outcomeNote`, and hairline `autoSummary` when present.
  - `Worth a second look` highlighting blocks marked `partly` or `motion`.
- **`3 Time` — Where did the time go?:**
  - Project weekly-time table comparing actual focus against `Project.weeklyTimeMinutes` (with 4-week sparklines and carryover counts), grouped into `More than planned` (> +20%), `Less than planned` (< -20% with focus > 0), `Wanted but untouched` (intent set, 0 focus), `Time without a plan` (no intent, > 60m), and a collapsed-by-default `On track` bucket (±20%).
  - `Ops & Automation Radar`: groups `isOps` work into recurring series rollups (aggregated by `seriesId`), separates pure `Ops` (no `Goal`) from Goal-linked `Ops`, and surfaces deduplicated `autoSummaries` as automation or delegation candidates.
  - `What your planning taught you`: up to 3 learned findings (`overplanning`, `size_drift` >= 25%, `dropped_without_consequence` >= 3 drops, `motion_hotspot` >= 3 blocks & >= 60% `motion`, and `goal_neglect` over 2 quiet weeks), activated once at least 3 weeks of data exist, each paired with a suggested rule.
- **`4 Next week` — What changes next week?:**
  - `Backlog, Carryovers & Later Check-In`: surfaces unfinished non-recurring blocks with `carryoverCount >= 3` and `Later` blocks with `revisitAt <= today`, with direct `Plan next week`, `Revisit`, or `Drop` actions.
  - Inline next-week `Weekly time` project inputs prefilled from current `weeklyTimeMinutes`.
  - Canvas-level `Rule for next week` editor (no card-on-card nesting) with up to 3 clickable rule suggestions derived from the learned planning findings.

## Completion Snapshot And Automatic T3 Code Sync

- Completing the review (`POST /api/review/complete` or `veyra review complete`) persists `ruleForNextWeek`, `previousRuleKept`, optional inline project `weeklyTimeMinutes` updates, `completedAt`, and a compact `snapshotJson` summary in SQLite, broadcasts SSE `review.completed`, and dispatches the `review.completed` outgoing webhook (See → `interfaces.calendar-sync-webhooks`).
- `ReviewView` switches to the `Review · Completed & Auto-Synced` state (keeping optional `Copy Markdown` for manual sharing). `POST /api/review/reopen` (or `veyra review reopen`) clears `completedAt` so the review can be revised.
