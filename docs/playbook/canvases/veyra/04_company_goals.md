---
visual:
  status: Brainstorming
  created: 2026-11-24
  as-of: 2026-11-24
  lang: en
---
# Step 04: Company Goals Next To Personal Goals

> **Main question:** How do we let Veyra carry company goals (such as raising revenue or generating upsells on certain projects) next to the personal goals, kept apart but used the same way?
>
> Living map of this brainstorm. Rewrite it when the direction changes.
> Specs and plans are distilled from this file. Not canonical product behavior.
> After shipping, knowledge docs own shipped truth; leftovers hold remaining work only, then delete when nothing remains.

Builds on the shipped goals in [domain-invariants.md](../../../knowledge/architecture/domain-invariants.md) and [VISION.md](../../../VISION.md) (principle 6). Overarching map: [00_overview.md](00_overview.md).

## Current direction {#direction updated=2026-11-24}

Goals come in two kinds: **personal** goals and **company** goals. Both live in the same place, are linked to blocks, meetings and projects the same way, and use the same color and status. They are shown apart: two groups in `Settings → Goals`, and a small company marker wherever a goal pill appears. Reading of the request: the user wants the two kinds separated a bit, not merged into one list and not turned into a second system.

Why this fits what exists: a `Project` already has a `defaultGoalId`, so hanging a customer project on the company goal "Upsells" already sends all its blocks there. What is missing is the difference between the kinds and the evaluation of it.

## Did this block make sense? {#sense updated=2026-11-24}

Wanted by the user: at the end of a block and in the Weekly Review, a short look at whether the block made sense for its goal. The completion card in the Focus view already asks how the block felt (energy) and what actually moved forward. The concept adds one more question, "Did this block make sense for its goal?", with three answers: moved the goal, partly, just motion. The Weekly Review then splits goal alignment into company and personal focus time and lists the blocks marked partly or just motion under "Worth a second look". Fits principle 6 in [VISION.md](../../../VISION.md) (progress over motion).

Figma concept (three before and after pairs, current state left, proposal right): [Proposal · Company Goals · Dark](https://www.figma.com/design/071lgm98oyBn2xNWx2uBD1/Veyra?node-id=94-4478). Concept only, not decided.

## What exists today {#today updated=2026-11-24}

A goal has a name, a color, an order and a status of `active`, `achieved` or `archived` (checked in code, not only in docs).

- **Archived** hides the goal everywhere a goal is picked: block drawer, meeting drawer, command palette, quick capture, sidebar. `Settings → Goals` still lists it, so it can be reactivated. Old blocks keep their link.
- **Achieved** is only a label. Nothing filters on it, so an achieved goal still shows up in every picker and keeps counting in the Weekly Review goal alignment. It has no effect on behavior yet.
- Neither status changes the data of linked blocks. `Delete` is a separate soft delete that clears the links.
- No doc describes the intended difference between `achieved` and `archived`.

## Open questions {#questions updated=2026-11-24}

> [!card question indigo] Does a company goal carry a measure?
> Option 1: only a marker, evaluated by focus time. Option 2: plus one line such as "Revenue plus 15 percent in Q1" or "10 upsells", with the current state entered by hand. Veyra measures focus time, not revenue, so any number would be manual.

> [!card question indigo] What should `achieved` do?
> Today it does nothing. Options: keep it as a pure label, or hide it from pickers like `archived` and keep it visible in the review as a result. Matters more for company goals, which are meant to end.

> [!card question indigo] Do company goals count in the "3 to 5 goals" limit?
> VISION principle 6 names 3 to 5 goals. Proposal: count the kinds separately, otherwise the list fills up quickly. Not decided.

> [!card question indigo] Weekly Review split
> Proposal: next to goal alignment, show focus time on company goals versus personal goals. Not decided.

## Set aside for now {#aside updated=2026-11-24}

- **Two levels** (personal goals point to a company goal): maps the contribution best but adds a second hierarchy, against the radical simplicity of Veyra. Revisit only if one level stops being enough.
