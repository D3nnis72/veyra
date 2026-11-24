---
id: features.review-and-rollover
type: rule
scope: features
authority: canonical
sourceVersion: 6b0af57
extends: features
dependsOn:
  - architecture.domain-invariants
groundedIn:
  - packages/core/src/services/rollover.ts
  - packages/core/src/services/notes-review.ts
  - packages/server/src/app.ts
  - packages/web/src/views/ReviewView.tsx
updateWhen:
  - weekly review KPI formulas, Ops radar grouping, or carryover thresholds change
  - midnight rollover trigger timing or weekly rule lookup logic changes
---
# Weekly Review And Midnight Rollover

Veyra's learning loop turns real measured focus time, one-line outcomes, `Ops` flags, daily notes, and carryovers into structured facts for weekly reflection (typically alongside T3 Code via `veyra review --json`).

## Midnight Rollover Trigger Guard

Rollover logic lives in `@veyra/core` (`runDailyRolloverAndRecurrence` in `packages/core/src/services/rollover.ts`, invariants in `architecture.domain-invariants`). `@veyra/server` invokes `runDailyRolloverAndRecurrence` in three places: on server boot, via a 60-second background date-change watcher (which broadcasts SSE `rollover.completed` whenever the local date in `Settings.timezone` advances), and before handling the four composite read routes (`GET /api/today`, `GET /api/plan`, `GET /api/calendar`, `GET /api/review`) — not on `/api/blocks` or mutation routes. Because rollover runs inside one SQLite transaction and checks for existing `(seriesId, today)` rows, repeated calls on the same local day are idempotent.

## Weekly Rule Continuity

- `WeeklyReview` records are keyed by Monday `weekStartDate` (`YYYY-MM-DD` in `Settings.timezone`).
- Setting a rule during the current week (`PUT /api/review/rule` or `veyra review set-rule`) saves `ruleForNextWeek` on the current week's review record.
- `GET /api/today` displays the active Weekly Rule directly beneath the date using `activeRuleText` (previous week's `ruleForNextWeek`), falling back specifically to the current week's `ruleForNextWeek` (`ruleInfo.activeRuleText ?? ruleInfo.nextWeekRule?.ruleForNextWeek ?? null`) when no previous-week rule exists yet, keeping the single concrete commitment visible all week.

## Review KPIs And Progress Feed

`getWeeklyReview` (`packages/core/src/services/notes-review.ts`) computes all review facts for the selected Monday–Sunday week:

- **`Total Focus`:** Sum of logged `FocusSession` minutes overlapping the week.
- **`Goal Alignment`:** Percentage of logged `FocusSession` minutes tied to a `Goal` (`goalLinkedMs / totalFocusMs`); goal-linked meetings appear in `progressFeed` only.
- **`Build vs. Ops`:** Split of focus minutes where `isOps = false` (`buildMinutes`) vs. `isOps = true` (`opsMinutes`).
- **`Energy`:** Raw counts of completed blocks by signal (`up`, `neutral`, `down`, rendered as `9+ · 3· · 1−`), never collapsed into a gamified score.
- **`Progress Feed`:** Completed blocks and goal-linked meetings for the week showing project badge, duration, energy pill, `Ops` tag, one-line `outcomeNote`, and (when present) the post-block `autoSummary` beneath a quiet hairline divider.

## Ops Automation Radar And Hygiene Check-Ins

- **`Ops & Automation Radar`:** Groups `isOps` work into recurring series rollups (aggregated by `seriesId` across occurrences), separates pure `Ops` (no `Goal`) from Goal-linked `Ops`, and surfaces deduplicated `autoSummaries` captured on those `Ops` blocks so recurring reactive patterns stand out as candidates for automation, product fixes, or delegation.
- **`Daily Notes This Week`:** Lists all `DailyNote` bullets captured during the week via `Today`, global `⌘⇧P`, or `veyra note add`.
- **`Backlog, Carryovers & Later Check-In`:** Surfaces unfinished non-recurring blocks with `carryoverCount >= 3` and `Later` blocks whose `revisitAt` date is on or before today, each with direct `Plan next week`, `Revisit`, or `Drop` actions.
