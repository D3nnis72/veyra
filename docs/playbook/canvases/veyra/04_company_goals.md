---
visual:
  status: Brainstorming
  created: 2026-11-24
  as-of: 2026-11-25
  lang: en
---
# Step 04: Richer Goals, Personal And Company

> **Main question:** How do we let Veyra carry company goals (such as raising revenue or generating upsells on certain projects) next to the personal goals, kept apart but used the same way?
>
> Living map of this brainstorm. Rewrite it when the direction changes.
> Specs and plans are distilled from this file. Not canonical product behavior.
> After shipping, knowledge docs own shipped truth; leftovers hold remaining work only, then delete when nothing remains.

Builds on the shipped goals in [domain-invariants.md](../../../knowledge/architecture/domain-invariants.md) and [VISION.md](../../../VISION.md) (principles 3, 5 and 6). Overarching map: [00_overview.md](00_overview.md).

## Current direction {#direction updated=2026-11-25}

Goals come in two kinds: **personal** goals and **company** goals. Both live in their own top-level `Goals` view in the main sidebar (moved out of Settings on 2026-11-25), are linked to blocks, meetings and projects the same way, and share the unified color picker (12 curated presets plus custom hex) with projects. They are shown clearly apart: two separate groups on `Goals` with white headlines ("Personal", "Company") above their cards, and no extra tag on the cards. The kind is carried by the icon that replaces the plain color dot everywhere a goal appears (Goals view, Projects list, block/meeting drawers, Focus completion card, Weekly Review): a person for Personal, a briefcase for Company. The icon sits in a small tinted rounded square in the goal color, like the project icons. Cards stay neutral. Tint, color bar and badge variants were tried and set aside. The building icon was replaced by the briefcase because it read as a document at 12 to 14 px.

Second layer, proposed on 2026-11-25: a goal becomes more than a name and a color. It carries a few fields that make it specific (what "done" looks like, when to check in, optional measure and if-it-stalls rule), and the Weekly Review uses them to compare intention with what really happened. Weekly focus time targets live on projects, not on goals. The sections below describe why and what.

Why this fits what exists: a `Project` already has a `defaultGoalId`, so hanging a customer project on the company goal "Upsells" already sends all its blocks there. What is missing is the difference between the kinds, the content that makes a goal specific, and the evaluation of it.

## What goals are for {#purpose updated=2026-11-25}

In Veyra a goal answers "why does this block matter?" (principle 6). Today it is a colored label, which helps sorting but does not change behavior. A goal earns its place only if it changes what gets planned and what the review shows. Five well known findings from goal research point to what it needs for that. They are cited from general knowledge, not checked against the papers for this canvas.

> [!card bulb indigo] Specific beats "do your best"
> Goal setting research (Locke and Latham) finds that a concrete target leads to more effort and better results than a vague intention, as long as there is feedback. "Generate upsells" gives no feedback. "10 upsells signed by end of Q1" does. So a goal needs one sentence of what done looks like.

> [!card bulb indigo] Progress in meaningful work drives motivation
> The progress principle (Amabile and Kramer): small visible wins on work that matters are the strongest daily motivator. Veyra already collects the "What actually moved forward?" line per block. Grouped by goal, these lines become a visible trail of progress, which is the reward a goal should give back.

> [!card bulb indigo] Steer the input, watch the outcome
> Outcomes like revenue depend on customers and other people (principle 5). Execution frameworks (4DX) split a goal into a lag measure, the result you want, and a lead measure, the input you control. In Veyra the lead measure is focus time on the goal and the lag measure is the optional number you update by hand. The review should judge you on the lead, and show the lag as context.

> [!card bulb indigo] Plan for the obstacle, not only the wish
> Mental contrasting and if then plans (Oettingen, Gollwitzer): naming what usually gets in the way, plus one "if X, then I do Y" rule, roughly doubles follow-through in studies. One optional line per goal is enough, and the review brings it up when the goal stalls.

> [!card bulb indigo] Letting go is healthy
> Research on goal disengagement (Wrosch) shows that dropping goals that no longer fit lowers stress and frees energy for new ones. This matches principle 3. A goal therefore needs a clean, guilt free ending with a short look back, and the review should ask about goals that get no time at all.

What this rules out: no streaks, no red overdue states, no score per goal. A goal that got no time this week is a question in the review, not a failure (Vision non goals). Focus time is a signal, not the target itself, because a pure time target can be gamed (Goodhart's law). The "did it make sense" answer per block keeps the time honest.

```glossary
Lead measure: The input you control and can count every week, here focus time on a goal.
Lag measure: The result you want but do not fully control, such as revenue or signed upsells. Updated by hand.
If then plan: One prepared rule for a known obstacle, such as "If a customer call eats my Tuesday block, I move it to Wednesday morning".
Check in date: The date when the Weekly Review asks whether the goal is achieved, continues or gets let go. Not a deadline, nothing turns red.
```

## What a goal carries {#fields updated=2026-11-25}

Proposal. The first four fields are always visible on the goal card, the rest stays folded behind "More" so creating a goal still takes ten seconds. Every field has to change something in planning or review, otherwise it does not belong here.

| Field | Example | What it is used for | Exists today |
| --- | --- | --- | --- |
| Name | Generate upsells | Pickers, Focus view, review | yes |
| Kind | Company | Group in Settings, icon, company versus personal split in review | no |
| Why it matters | Expansion is how the team hits its revenue plan without new logos | Shown quietly in the Focus view header and in the review row, keeps the goal tied to something you care about | yes, as `description` |
| Done when | 10 upsells signed by end of Q1 | Makes the goal specific; the review asks against this sentence | no |
| Check in date | 2027-03-31 | From this date the review asks: achieved, continue with a new date, or let go | no |
| Measure (optional) | 4 of 10 upsells | The lag measure, updated by hand once a week in the review; mainly for company goals | no |
| If it stalls (optional) | If no upsell call is booked by Wednesday, I block 30 min to write two offers | Shown in the review when the goal got little time or mostly "just motion" | no |
| Color, order, status | blue, 2nd, active | As today; order is the priority between goals | yes |

Derived, not stored on the goal: linked projects (through `defaultGoalId`), measured focus time per week (shown as actuals without a weekly target), number of blocks, the split of "did it make sense" answers, and the list of outcome lines. Weekly time intentions live on projects ([06](06_weekly_review.md)), not on goals.

Closing a goal asks two short things: was it achieved or let go, and one line on what it brought. `Achieved` and `Let go` (today `archived`) both hide the goal from pickers and keep it in history.

```text
┌ Company ──────────────────────────────────────────────────────────┐
│ [briefcase] Generate upsells                     4 projects · ✎   │
│ Done when: 10 upsells signed by end of Q1         Check in 31 Mar │
│ This week: 4h 50m focused · 3 blocks · 5 of 10 upsells            │
│ Why: Expansion is how the team hits its plan without new logos    │
└───────────────────────────────────────────────────────────────────┘
```

## Goals in the sidebar, edited in a drawer {#sidebar updated=2026-11-25}

Wanted by the user on 2026-11-25: goals are edited the same way as blocks and projects, and they get a right click menu. Today goals only live in `Settings → Goals` with inline editing, and they have no context menu.

Direction: `Goals` becomes its own top-level view in the main sidebar (between `Projects` and `Review`), while `Settings` stays strictly for app settings (`Integrations`, `Server & CLI`, `Appearance`). Below `PINNED`, the sidebar keeps a `GOALS` section (with a `+` button to create a goal), listing active goals grouped into Personal and Company, each row with its kind icon wrapper and no weekly time bar. A click opens `GoalDetailDrawer` (520 px) with the goal's details, measured focus time this week, shared color picker (12 presets plus custom hex), history of outcomes and measure updates, and an `Edit` button. Creating, editing and closing goals live in the `Goals` step (`Goals · Overview`, `Create Goal Drawer`, `Edit Goal Drawer`, `Close Goal` sheet) and are reachable from the sidebar `+`, the context menu, or the detail drawer.

The right click menu on a goal row (sidebar and Goals view) uses the shared `ContextMenu`: `Open Details`, `Edit Goal`, `New Block for this Goal`, `Show in Review`, `Move Up` and `Move Down` (priority), `Mark Achieved`, `Let Go`, `Delete Goal`. Achieved and Let go open the `Close Goal` sheet.

## Did this block make sense? {#sense updated=2026-11-25}

Wanted by the user: at the end of a block and in the Weekly Review, a short look at whether the block made sense for its goal. The completion card in the Focus view already asks how the block felt (energy) and what actually moved forward. The concept adds one more question, "Did this block make sense for its goal?", with three answers: moved the goal, partly, just motion. The Weekly Review then splits goal alignment into company and personal focus time and lists the blocks marked partly or just motion under "Worth a second look". Fits principle 6 in [VISION.md](../../../VISION.md) (progress over motion).

Drawn on the Figma page Screens, which since 2026-11-25 holds the target design: [Today with the goals sidebar, goal menu and GoalDetailDrawer](https://www.figma.com/design/071lgm98oyBn2xNWx2uBD1/Veyra?node-id=22-6), [Focus · Inline Complete with the sense question](https://www.figma.com/design/071lgm98oyBn2xNWx2uBD1/Veyra?node-id=22-881), [Step 6 · Goals (Overview, Create, Edit and Close Goal)](https://www.figma.com/design/071lgm98oyBn2xNWx2uBD1/Veyra?node-id=136-7007) and [Weekly Review (5 states)](https://www.figma.com/design/071lgm98oyBn2xNWx2uBD1/Veyra?node-id=24-2350). The proposal page is deleted.

## What the Weekly Review does with it {#review updated=2026-11-25}

Proposal. Today the review shows one number, goal alignment, the share of focus time linked to any goal. With the fields above it gets one row per active goal, ordered company first, then personal:

- **Focus this week (no target):** actual focus time and block count this week, with Company and Personal totals above the rows. Goals carry no weekly hour target; weekly time intentions live on projects ([06](06_weekly_review.md)).
- **Did it make sense:** the split of moved, partly and just motion for the goal's blocks. Much time with mostly "just motion" is the clearest motion signal Veyra can give.
- **Progress trail:** the two or three best "What actually moved forward?" lines of the week for this goal.
- **Measure update:** for goals with a measure, one input "Where are you now?" (4 of 10 becomes 5 of 10). This is the only place the number is updated, so it stays a weekly ritual and does not become a dashboard to watch.
- **Questions instead of alarms:** a goal with no time for two weeks gets "keep, pause or let go?". A goal past its check in date gets "achieved, continue until…, or let go?". A stalled goal shows its "if it stalls" line.

The rule for next week, which the review already asks for, can then point at a goal ("Two upsell blocks before Wednesday").

## Later use {#later updated=2026-11-25}

Proposal, ordered by how much it helps. First, day planning in T3 Code: `veyra goals --json` returns real focus time and outcomes per goal for the week, so the planning agent can flag neglected goals ("Customer Communication got no blocks for two weeks, want one today?"). Second, a goal history: all outcome lines and measure updates of one goal over the quarter, which is exactly what you need to report your contribution to a company goal to the team. Third, the Focus view shows the goal's "why" and "done when" as one quiet line while a block runs. Fourth, closed goals with their closing line form a small record of what each quarter was about.

## What exists today {#today updated=2026-11-24}

A goal has a name, a description, a color, an order and a status of `active`, `achieved` or `archived` (checked in code, not only in docs).

- **Archived** hides the goal everywhere a goal is picked: block drawer, meeting drawer, command palette, quick capture, sidebar. `Settings → Goals` still lists it, so it can be reactivated. Old blocks keep their link.
- **Achieved** is only a label. Nothing filters on it, so an achieved goal still shows up in every picker and keeps counting in the Weekly Review goal alignment. It has no effect on behavior yet.
- Neither status changes the data of linked blocks. `Delete` is a separate soft delete that clears the links.
- No doc describes the intended difference between `achieved` and `archived`.

## Open questions {#questions updated=2026-11-25}

> [!card question indigo] Which fields make the cut?
> Proposal: Kind, Why, Done when and Check in date always, Measure and If it stalls optional. Each extra field makes creating a goal slower, so the question is which ones Dennis would really fill in.

> [!card question indigo] Do company goals count in the "3 to 5 goals" limit?
> VISION principle 6 names 3 to 5 goals. Proposal: count the kinds separately, otherwise the list fills up quickly. Not decided.

## Set aside for now {#aside updated=2026-11-25}

- **Weekly focus time target on goals:** decided against on 2026-11-25. Weekly time intentions live on projects ([06](06_weekly_review.md)); goals only show measured focus time without a target or progress bar.
- **Two levels** (personal goals point to a company goal): maps the contribution best but adds a second hierarchy, against the radical simplicity of Veyra. Revisit only if one level stops being enough.
- **Scores or streaks per goal:** against the Vision non goals and easy to game.
- **Building icon for company goals:** replaced by the briefcase, see Current direction.
