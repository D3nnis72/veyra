---
visual:
  status: Brainstorming
  created: 2026-11-25
  as-of: 2026-11-25
  lang: en
---
# Step 05: Prioritize By Capacity, Learn What To Let Go

> **Main question:** How does Veyra help decide what matters today, show honestly what does not fit, and learn over time how this person should prioritize, so the day is judged by focused input instead of a cleared list?
>
> Living map of this brainstorm. Rewrite it when the direction changes.
> Specs and plans are distilled from this file. Not canonical product behavior.
> After shipping, knowledge docs own shipped truth; leftovers hold remaining work only, then delete when nothing remains.

Builds on [VISION.md](../../../VISION.md) principles 1, 3, 5 and 7, on the goal fields in [04_company_goals.md](04_company_goals.md), and on the shipped carryover and Later check in in [review-and-rollover.md](../../../knowledge/features/review-and-rollover.md). Overarching map: [00_overview.md](00_overview.md).

## Current direction {#direction updated=2026-11-25}

The core problem is planning more than a day can hold. When the list is longer than the day, every block feels late, you rush, and the evening ends with "not done" although you worked well. Veyra already counts focus time up instead of down and keeps the backlog out of sight. What is missing is the step before: an honest picture of how much room today really has, a help to order what goes into it, a calm way to let the rest go and tell people, and a loop that learns from your own history which things matter and which ones you always end up dropping.

The proposal has five parts, all built from data Veyra already has or gets in Step 04: real focus time per day, meetings, carryovers, drops, goal priority and weekly intent, and the new "did this block make sense" answer. Nothing here is a hidden model. Every suggestion comes with its reason in one line, and nothing reorders itself without a click.

## 1. Room today {#room updated=2026-11-25}

Veyra learns how much focus time a normal day of yours really holds: the median real focus per weekday over the last four weeks, minus the meetings on today's calendar. Today shows it as one quiet line under the date, for example "Room today about 3 h 40 m". It is a measured average, not a target.

Blocks get a rough size (30 min, 1 h, 2 h). The default comes from your history for that project, so most blocks need no input. Veyra also learns how far off sizes usually are ("your 1 h blocks on LioCare take 1 h 25 m"), which is the planning fallacy made visible and corrected for.

## 2. The fit line {#fitline updated=2026-11-25}

In `Today → UP NEXT` a thin line sits where the room runs out. Blocks above it fit, blocks below it are shown quieter under "Probably not today". No red, no counter of missing items.

Figma concept (Today, Plan, day look back and Weekly Review, current state left, proposal right): [Proposal · Prioritization · Dark](https://www.figma.com/design/071lgm98oyBn2xNWx2uBD1/Veyra?node-id=109-3). Concept only, not decided. In `Plan` each day header shows planned against room ("4 h planned · room about 3 h"), so overplanning is visible while dragging, before the day starts.

```text
UP NEXT                                  Room today ≈ 3h 40m
▶ Wefox renewal offer            1h   · due tomorrow
▶ LioCare architecture prep      30m  · prep for the 14:30 call
▶ Upsell plan Siemens            1h   · Upsells behind (40m of 4h)
▶ Sidebar polish                 30m  · Product goal
─────────────── fits today ─── about 40m left ───────────────
  Probably not today
  ○ Covestro offer revision      2h   · due Thu   [Tomorrow] [Later] [Drop] [Tell someone]
  ○ Covestro ticket hypercare Ops 1h  · mostly just motion lately   [Tomorrow] [Later] [Drop]
```

## 3. A suggested order with reasons {#order updated=2026-11-25}

Veyra proposes an order for `UP NEXT` and shows why next to each block. You take it with one click ("Use suggested order") or drag yourself. The rules are simple on purpose, so they can be explained and trusted:

1. Real commitments first: a quiet due date for today or tomorrow, or prep for a meeting today. These are the only outside deadlines Veyra knows (principle 4).
2. Then work for goals that are behind their weekly intent, in goal priority order.
3. Then other goal work, by goal priority.
4. Ops last and batched into one block (principle 2).

Learned corrections move blocks within this order: kinds of blocks that were mostly "just motion" move down, a block carried over three times is not pushed up but gets a decision prompt (see 4). The reason line says which rule placed it ("due tomorrow", "Upsells behind", "mostly just motion lately").

## 4. Letting go, and saying so {#letgo updated=2026-11-25}

A block below the fit line gets four calm exits: `Tomorrow`, `Later`, `Drop`, and `Tell someone`. The first three exist today in the block menu; here they sit right on the row. `Tell someone` is new: when somebody waits for the block (it has a due date or came from a meeting follow up), Veyra drafts a two line note such as "I won't get to the Covestro revision today, you'll have it Thursday morning." Veyra copies it or hands it to T3 Code; it never sends anything itself.

`Drop` asks one optional question: why? `Not important anymore`, `Someone else did it`, `No room`. This is the cheapest signal for learning what never mattered.

## 5. The day is judged by input {#input updated=2026-11-25}

The day ends with a short look back, in `Today` after the last block or at the first open the next morning: focus time, the share on goals, how many blocks moved a goal, and what did not fit with where it went. Example: "3 h 50 m focused, 80 % on goals, 2 blocks moved a goal. 2 blocks did not fit and moved to tomorrow." There is no "4 of 7 done". What did not fit is described as capacity, not as failure (principles 3 and 5).

## The learning loop {#learning updated=2026-11-25}

This is the part that makes prioritization automatic over time. Veyra keeps a few plain statistics and shows what they mean once a week in the Weekly Review under "What your planning taught you", at most three findings, each with a suggested rule:

> [!card bulb indigo] Overplanning
> Planned against room per day over the week. Example finding: "You planned 160 % of your room on four of five days." Suggested rule: "Plan three blocks per day, not five."

> [!card bulb indigo] Size drift
> Learned size against real time per project. Example: "LioCare blocks take 40 % longer than planned." The default size for the project adjusts automatically.

> [!card bulb indigo] Dropped without consequence
> Blocks dropped or parked in Later that never came back and caused no follow up. Example: "You dropped 6 of 7 'clean up' blocks this month." Suggested rule: "Do not plan clean up blocks, batch them into Friday Ops."

> [!card bulb indigo] Motion hot spots
> Projects or block kinds with many "just motion" answers (Step 04). Example: "Covestro: 5 of 6 blocks just motion." These sink in the suggested order until a "moved the goal" answer appears again.

> [!card bulb indigo] Goal neglect
> Goals with no time for two weeks. Asked as "keep, pause or let go?", see Step 04.

The findings feed back into parts 1 to 3: room per weekday, default sizes and the order corrections update themselves. The rule you pick in the review is the existing weekly rule, so no new mechanism is needed there. In T3 Code the same facts come from `veyra review --json` and a new `veyra today --json` with room and suggested order, so a planning conversation can say "Your Tuesday is full, should the refactor move to Thursday?".

```glossary
Room today: Measured median focus time for this weekday over the last four weeks, minus today's meetings.
Fit line: The point in UP NEXT where the planned blocks use up the room today.
Size: Rough block length (30 min, 1 h, 2 h), defaulted from history, used only for the fit line.
Planning fallacy: The well known habit of planning tasks shorter than they take. Veyra corrects sizes from real times.
```

## What this does not do {#not updated=2026-11-25}

No countdowns, no red overdue, no daily cap that blocks adding work (Vision non goals). No automatic rescheduling: Veyra suggests, you click. No black box model: every number is a median, a ratio or a count you can check in the review. No messages sent on your behalf.

## Open questions {#questions updated=2026-11-25}

> [!card question indigo] Block size: new field or learned only?
> Proposal: a size chip with a learned default per project. Without any size, the fit line can only count blocks, which is too rough for 30 min versus 2 h blocks.

> [!card question indigo] When does the day look back appear?
> Option 1: after the last block is completed. Option 2: the first time Veyra opens the next morning, together with the moves to today. Option 2 avoids a prompt at the moment you want to stop working.

> [!card question indigo] How many weeks before learning kicks in?
> Proposal: room and sizes after two weeks of data, findings after three. Before that, Veyra shows the fit line from a default of 4 h focus per day.

## Set aside for now {#aside updated=2026-11-25}

- **Eisenhower matrix or numeric priority per block:** extra sorting work on every block, against principle 3. The order is derived instead.
- **Automatic reordering:** too opaque; the suggested order stays a one click offer.
