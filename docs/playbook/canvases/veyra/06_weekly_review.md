---
visual:
  status: Brainstorming
  created: 2026-11-25
  as-of: 2026-11-25
  lang: en
---
# Step 06: Weekly Review Rework And Weekly Time Per Project

> **Main question:** How does the Weekly Review stay simple to walk through but show enough detail to learn from the week, including how the real time per project compares with the time you meant to give it?
>
> Living map of this brainstorm. Rewrite it when the direction changes.
> Specs and plans are distilled from this file. Not canonical product behavior.
> After shipping, knowledge docs own shipped truth; leftovers hold remaining work only, then delete when nothing remains.

Builds on the shipped review in [review-and-rollover.md](../../../knowledge/features/review-and-rollover.md), the goal rows from [04_company_goals.md](04_company_goals.md) and the planning findings from [05_prioritization.md](05_prioritization.md). Overarching map: [00_overview.md](00_overview.md).

## Current direction {#direction updated=2026-11-25}

Wanted by the user on 2026-11-25: the review deserves more detail than it has today, while staying simple. Projects get a weekly time you want to give them, so the review shows which project took far more than planned, where you put in too much, too little, and where you wanted to work but never did.

Today the review is one page of facts side by side: four KPIs (total focus, goal alignment, build versus ops, energy), the progress feed, daily notes, the Ops radar, carryovers and Later check in, and the rule for next week. Everything is there, but nothing says in which order to look at it or what to conclude.

The rework keeps one scrolling page and orders it into four chapters, each answering one question. A thin chapter bar at the top jumps between them and shows which ones you have walked through. Every chapter opens with one computed sentence, so a quick look at the four sentences already tells the week, and the detail below is there when you want it.

## The four chapters {#chapters updated=2026-11-25}

| # | Chapter | What it shows |
| --- | --- | --- |
| 1 | What happened? | Last week's rule with a quick "kept it? yes, partly, no". Key numbers: focus time against room and against planned time (Step 05), goal share split into company and personal, build versus Ops, the moved / partly / just motion split, energy counts. A Monday to Friday strip with one bar per day: real focus, the room line and meeting hours. Daily notes of the week, folded. |
| 2 | What moved? | One row per active goal, company first (Step 04): focus against intent, the sense split, the best outcome lines, the measure update, and a question for neglected or due goals. Below it the progress feed grouped by goal instead of by time, and "Worth a second look" with the partly and just motion blocks. |
| 3 | Where did the time go? | The projects table against their weekly time (see below), the Ops radar as today, and "What your planning taught you" with at most three findings (Step 05). |
| 4 | What changes next week? | Backlog check in (chronic carryovers, Later items due) with the existing actions, the weekly time per project for next week prefilled from this week and editable in place, and the rule for next week with up to three suggestions taken from the findings. |

The opening sentences read for example: "18 h 40 m focus, 2 h under your room, 72 % on goals." · "Upsells moved twice, Customer Communication got no time." · "LioCare took 3 h more than planned, Veyra 2 h less." · "Two carryovers to decide, one rule to pick."

## Weekly time per project {#projectintent updated=2026-11-25}

A project gets one optional field, **Weekly time**, such as "about 4 h". It is set in the project drawer (`Create Project` and `Edit Project`) and again in chapter 4 of the review, so it gets adjusted where you look back anyway. It is an intention, not a quota: nothing turns red, no counter of missing hours.

Where it shows up:

| Place | What it shows | Question it answers |
| --- | --- | --- |
| `Projects` list | "This week 2 h 10 m of 4 h" with a thin neutral bar; filter chips `Over`, `Under`, `Untouched` next to the status filters | Where am I this week? |
| Project detail | Bars for the last eight weeks against the intent line, plus "average 3 h 20 m of 4 h" and how far block sizes drift on this project (Step 05) | Is this a pattern or one week? |
| `Plan` | A strip above the week: planned block time per project against its weekly time, before the week starts | Did I plan what I meant to? |
| Review chapter 3 | Table of projects with intent, real time, difference, blocks, carryovers and a four week trend, grouped as below | Where did the time go against plan? |

The review groups projects into four plain buckets, ordered by size of the difference: **More than planned** (for example "LioCare 7 h 10 m of 4 h, +3 h"), **Less than planned**, **Wanted but untouched** (intent set, zero time), and **Time without a plan** (no intent, but more than one hour). Within about 20 percent of the intent counts as on track and stays folded.

Goals and projects then share the intent: a goal's weekly intent defaults to the sum of the weekly time of its projects (through `defaultGoalId`), and only needs its own value when the goal covers work outside those projects. This replaces the separate goal field from Step 04 as the main input.

## Text mockup {#mockup updated=2026-11-25}

```text
Review · Week 47                         [1 Week ✓] [2 Progress] [3 Time] [4 Next week]
Last rule: Protect 09:00–11:30 for one focused block   Kept? [Yes] [Partly] [No]

1 · WHAT HAPPENED?  18h 40m focus, 2h under your room, 72 % on goals.
 Focus 18h 40m / room 20h40 / planned 24h   Goals 72 % (Company 41 · Personal 31)
 Build 15h · Ops 3h40   Moved 5 · Partly 1 · Motion 2   Energy 9+ 3· 1−
 Mon ███▍ Tue █████ Wed ██▊ Thu ████ Fri ██        (line = room)

3 · WHERE DID THE TIME GO?  LioCare took 3h more than planned, Veyra 2h less.
 More than planned   LioCare      7h10 / 4h   +3h10   6 blocks  ▁▃▅▇
 Less than planned   Veyra        1h50 / 4h   −2h10   2 blocks  ▅▄▂▁
 Wanted, untouched   Read Offer   0h / 2h
 Time without plan   Covestro     2h20 / –
```

## Open questions {#questions updated=2026-11-25}

> [!card question indigo] Chapter bar or plain scrolling?
> Proposal: a thin chapter bar that only jumps and marks chapters as seen. It does not lock the order, so the review can still be skimmed in two minutes.

> [!card question indigo] Goal intent derived from projects?
> Proposal above: goals take the sum of their projects by default. Simpler to fill in, but a goal that spans many projects (Internal Visibility) needs its own value.

## Set aside for now {#aside updated=2026-11-25}

- **A wizard with one chapter per screen:** too slow for a quick week, and harder to compare chapters.
- **Hour budgets that block planning:** against the Vision non goals; the weekly time stays an intention.
