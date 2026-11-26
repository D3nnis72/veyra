---
visual:
  status: Brainstorming
  created: 2026-11-26
  as-of: 2026-11-26
  lang: en
---
# Step 07: In-Session Feedback Capture and Side Work in the Post-Block Summary

> **Main question:** While a focus block runs, how do I tag "this could be better in Veyra" in one keystroke without leaving the block, have that feedback collected after the session somewhere I can work through it, and have the post-block summary also show which other projects I touched during the block (for example Covestro during an Accenture block)?
>
> Living map of this brainstorm. Rewrite it when the direction changes.
> Specs and plans are distilled from this file. Not canonical product behavior.
> After shipping, knowledge docs own shipped truth; leftovers hold remaining work only, then delete when nothing remains.

Builds on the shipped post-block auto-summary ([calendar-sync-webhooks.md](../../../knowledge/interfaces/calendar-sync-webhooks.md), [cli-and-agent-skill.md](../../../knowledge/interfaces/cli-and-agent-skill.md)) and Quick Capture ([desktop-shell-capture.md](../../../knowledge/features/desktop-shell-capture.md)).

## What exists today {#today updated=2026-11-26}

The post-block summary runs on this Mac. The launch agent `com.veyra.hook-listener` keeps `veyra hook listen --auto-summary` alive with `~/.veyra/summarize.sh` (Claude Haiku) and `~/.veyra/t3-context.mjs` as the only context collector, and the listener log shows summaries saved for the blocks on 2026-11-25 and 2026-11-26. Two parts of that setup live only in `~/.veyra`, outside the repository, so they are neither versioned nor tested.

Feedback can already be captured, but only as a plain note. `⌘⇧P` opens Quick Capture on `Daily Note`, and `⌃P` can set the project to Veyra. That note has no link to the running block, no "feedback" marker, no open or done state, and nothing gathers these notes after the session.

Side work reaches the summarizer but gets lost there, for three reasons found in the code and the T3 Code database:

- `t3-context.mjs` already reads T3 threads from all projects in the block window, so the raw data is there.
- It keeps only the first 40 messages in time order. In the 58 minute `Strategic Sourcing Figma` block on 2026-11-25, message 40 was at 19:42 UTC, so the collector saw about the first 21 minutes and missed the rest.
- The prompt asks for 1 to 2 sentences on what moved forward in this block, so the model drops other projects. In the same block, the Covestro thread `Run Daily Maintenance Flow` had 29 messages, and the saved summary does not mention Covestro.

## Proposed direction {#direction updated=2026-11-26}

### Feedback note as a kind of daily note

A feedback item becomes a daily note with `kind: feedback`, so it reuses the existing note storage, CLI and capture window instead of adding a new entity. Captured during a running session, it also stores the `blockId` and `sessionId` of that session automatically. It gets a `resolvedAt` so it can leave the list once handled. The target is a project, Veyra by default, so the same mechanism works for feedback on any tool that is a project.

```compare
says: A note kind fits best, because feedback is a remark to collect and triage, not a unit of work with time attached.
- Daily note with kind feedback | empfohlen
  Reuses notes, Quick Capture and `veyra notes`, adds kind, block link and resolved state.
  + one keystroke from the existing capture window
  + does not clutter Inbox or the Fit Line
  - needs a small schema change and a feedback filter
- Inbox block in project Veyra
  Already possible today via `⌘⇧P`, Tab to Inbox, `⌃P` Veyra.
  + no code change
  - every small remark becomes a block that competes in Inbox and Plan
  - no link to the block during which it came up
- Hashtag in any note, parsed after the session
  `#veyra` anywhere in a daily note or session note.
  + no new UI
  - easy to mistype, invisible until the analysis runs
```

### Capture while in session

In the `Focus` view, a new hotkey (proposal `F`, next to `P`, `C` and `N`) opens an inline single-line field "Feedback for Veyra", saved with `↵` without stopping the stopwatch. In Quick Capture, a fourth tab `Feedback` follows `Daily Note`, `Inbox`, `Focus Now`, with the project preset to Veyra and changeable via `⌃P`. The CLI gets `veyra note add --feedback "…"`, so agents in T3 can file feedback too.

### Collect after the session

The post-block summary run lists the feedback captured in the block window as part of its result, so the block drawer shows "2 feedback notes for Veyra" under the summary. All open feedback lands in one list: a `Feedback` section on the Veyra project page plus `veyra --json notes --kind feedback --open` for agents. The weekly review shows the open count. Automatic detection of feedback inside T3 conversations (Dennis complaining about Veyra in a thread) stays a later option, because the explicit tag is cheaper and does not produce false positives.

### Side work beside the summary

The summary run computes a deterministic `sideWork` list without the LLM: per other project, the T3 thread titles and message counts in the window, mapped to Veyra projects by name (`Accenture`, `Covestro` and `Veyra` match today). The block drawer shows it as a small card under the auto-summary, for example "Also during this block: Covestro, Run Daily Maintenance Flow (29 messages)". The time stays on the focused block and is not split across projects, because the focus session is the time record. The summary text itself stays focused on the block.

The T3 collector moves into the repository as a built-in collector (`--t3` flag), samples across the whole window per thread instead of the first 40 messages, and returns the per-project breakdown that `sideWork` needs.

## Work steps {#steps updated=2026-11-26}

```steps
- [ ] collector: T3 collector into the repo, sampling the whole window | owner: Agent | done-when: `veyra hook summarize` with `--t3` sees messages from the last ten minutes of a 60 minute block | updated: 2026-11-26
  Moves `t3-context.mjs` into `packages/cli` as a built-in collector, keeps first and last messages per thread across the full window, and returns per-project counts. The launch agent switches from `--context-cmd` to the built-in flag.
- [ ] sidework: Side work card under the auto-summary | owner: Agent | after: collector | done-when: an Accenture block with Covestro activity shows a Covestro line in the block drawer | updated: 2026-11-26
  Stores `sideWork` on the block next to `autoSummary` and renders it in `BlockDetailDrawer`. Display only, no time attribution.
- [ ] feedback-model: Feedback kind on daily notes | owner: Agent | done-when: `veyra note add --feedback` stores a note with kind, block link and project Veyra | updated: 2026-11-26
  Adds `kind`, `blockId`, `sessionId` and `resolvedAt` to daily notes, with API and CLI filters.
- [ ] feedback-capture: Feedback capture in Focus and Quick Capture | owner: Agent | after: feedback-model | done-when: in a running Focus session, one hotkey plus `↵` saves feedback without pausing | updated: 2026-11-26
  Inline field in the `Focus` view and a `Feedback` tab in Quick Capture.
- [ ] feedback-collect: Feedback list after the session | owner: Agent | after: feedback-model | done-when: the Veyra project page and `veyra notes --kind feedback --open` list open feedback, and the block drawer counts feedback from that block | updated: 2026-11-26
  The post-block summary result includes the window's feedback; the project page gets a `Feedback` section with resolve.
```

## Open questions {#open updated=2026-11-26}

> [!card question yellow] Q1: What should starting a session via the hotkey look like?
> Dennis asked that starting a session via the hotkey should feel nice and "not like an OS thing". Today `⌘⇧O` opens the Quick Capture window on `Focus Now` and, with a session running, brings the main window to the `Focus` view. Unclear whether this means a dedicated small focus window instead of the full main window, or something else.

> [!card question yellow] Q2: Feedback only for Veyra, or for any project?
> The proposal targets a project with Veyra as default. If feedback is only ever about Veyra, the project picker in the feedback tab can go.
