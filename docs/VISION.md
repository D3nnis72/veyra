# Veyra: Vision and Core Principles

> Product name: **Veyra** (from *verum* + *way*, meaning the honest path and real progress)
> CLI: `veyra`
> Purpose: Short, durable guiding document for product decisions, Figma design, and incremental builds.

## Goal

Achieve maximum real productivity and work quality during working hours: do things properly instead of rushing through a list, and optimize for **progress over motion** (meaningful work that moves key projects and personal goals forward, not busywork like clearing 100 emails). Veyra stays radically simple, starts as a lean MVP for a modern workday with many parallel projects and AI agents, and evolves week by week through its own reflection loop.

## Division of Roles: T3 Code vs. Veyra App

- **T3 Code is the thinking and voice interface:** Daily planning, inbox cleanup, backlog pruning, weekly reviews, and retroactive session adjustments happen in conversation with agents via the `veyra` CLI.
- **Veyra is the calm visual cockpit:** One clean workspace (no Work/Personal split) that shows what matters today at a glance, lets you drag blocks onto days in a Sunsama-like week board without timeblocking, starts the stopwatch in one click, makes real focus time and completed work visible, and lays out the facts for weekly review.

## Core Principles (Intended Effect Over Features)

1. **Protect the brain and do things right:** Seeing a long backlog triggers a rush reflex where you pace too fast, under-invest in important work, feel stressed, and pile on even more tasks. During active work, the backlog stays out of sight and the timer counts up like a stopwatch rather than down, giving each task the time it actually needs to be done well.
2. **Single focus and intentional batching:** Deep work on one project and reviewing multiple AI agent threads are different mental gears. Don't scatter agent check-ins across deep work; run single-focus blocks and batch agent reviews into their own dedicated block when needed, without needing an extra mode switch on every card. When an interruption forces a pause, a one-line resume note captures where you left off, and real interruptions can be cleanly trimmed or split out later without micromanagement.
3. **Curated choice over debt, letting go over backlog graveyards:** Today's list is a simple ordered set of what matters most, not a contract you owe. A growing inbox or stale backlog is never a reason to work faster; it is an honest capacity signal to drop, defer, delegate, or automate.
4. **Plan by day, measure actual time, skip fake deadlines:** Assign blocks to specific days across the week (with real meetings shown as quiet context for prep work), without rigid clock-time timeblocking and without red "overdue" alarms for self-imposed dates. Only real meetings get clock times, and only real external commitments or call-prep cutoffs get a quiet due date. Measured actuals replace guesswork without second-by-second perfectionism.
5. **Visible progress and controllable input:** Put completed work (Done list) and real focus hours front and center. Outcomes often depend on clients, bugs, or other people, while your focused input is fully under your control.
6. **Vertical coherence (Projects, Goals, and Motion vs. Progress):** `Projects` show *where* work happens (clients and workstreams); 3 to 5 overarching `Goals` show *why* it matters to you (such as Customer Communication, Internal Visibility, or Product & Upsell). Both blocks and meetings can link to a Goal. A short one-line outcome per completed block ("What actually moved forward?") reveals in review what created real progress and what was just motion. Low-leverage admin stays collapsed in `Other`.
7. **Weekly learning loop and `Ops` Automation Radar:** Essential reactive work you would rather automate or hand off (like Teams hypercare or support tickets) carries a simple orthogonal `Ops` flag, independent of `Project` and `Goal` (so a block can be both `Customer Communication` and `Ops`). Combined with lightweight daily reflection notes (captured out of sight via shortcut or CLI) and activity summaries, the weekly review groups recurring `Ops` patterns, chronic carryovers, and energy drains so you know what to automate, productize, or delegate next, and commit to one concrete rule change for next week.

## Phased Rollout (MVP First)

- **Two-layer split with Notion:** Notion stays the detail store (subtasks, notes, "waiting on reply", existing automations). Veyra holds coarse 30-to-120-minute work blocks by project, optional goal, and optional `Ops` flag.
- **Phase 01 (Figma design):** Independent UI built in the Veyra Dark style (neutral graphite surfaces, restrained indigo accent, tabular numbers, calm layout rules), designed in Figma before writing app code.
- **Phase 02 (Lean MVP):** Self-hostable SQLite server (local zero-config or online via Docker volume) + Desktop/Web UI (including Settings for Goals, Outlook/Calendar Sync, Event Hooks, and Server/CLI + macOS global `⌘⇧P` quick capture) + Day-1 Outlook & Calendar sync (local calendar CLI adapter + generic ICS/CalDAV URL feed) + `veyra` CLI (`--json`, including `session split/trim`, `note add`, and `goals`) + event hooks (`focus.started`, `focus.ended`, `block.completed`). No embedded in-app agent in the MVP.
- **Phase 03 (Ecosystem loop):** T3 Code filters projects and threads to the active project during Focus mode; an event hook triggers a background T3 agent after a block ends to read that window's T3/Teams chats, write a short honest summary back to the block, and log recurring `Ops` patterns; plus optional Teams/Outlook focus status write-back, inline Notion search picker, and dedicated iOS app.

## Deliberate Non-Goals

- No Work/Personal workspace split, no bonus-line sub-categories, and no heavy triage UI.
- No parallel focus timers and no stressful countdown timers by default.
- No rigid timeblocking, no AI calendar auto-rescheduling, and no red "overdue" badges for self-chosen target dates.
- No second-level time-tracking perfectionism (honest ballpark reality beats micro-tracking).
- No 1:1 mirror of granular Notion subtasks.
- No artificial daily cap, no guilt-driven streaks, and no feature that does not serve the seven principles or a real review bottleneck.
