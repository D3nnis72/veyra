---
visual:
  status: Shipped (Q1 open)
  created: 2026-11-26
  as-of: 2026-11-26
  lang: en
---
# Step 07: Tagged Notes and Side Work in the Post-Block Summary

> **Main question:** While a focus block runs, how do I capture remarks (such as Veyra feedback) with tags from anywhere, filter all notes by tag later, and have the post-block summary also show which other projects I touched during the block (for example Covestro during an Accenture block)?
>
> Living map of this brainstorm. Tagged notes and side work are now shipped; only Q1 remains open.

Builds on the shipped post-block auto-summary ([calendar-sync-webhooks.md](../../../knowledge/interfaces/calendar-sync-webhooks.md), [cli-and-agent-skill.md](../../../knowledge/interfaces/cli-and-agent-skill.md)) and Quick Capture ([desktop-shell-capture.md](../../../knowledge/features/desktop-shell-capture.md)).

## Shipped {#shipped updated=2026-11-26}

### General Notes with `#tags`

Instead of a separate feedback note kind, Dennis chose general notes with `#tags` (so Veyra feedback is simply a note tagged `#veyra`).

- **Storage & API:** `daily_notes.tags` (JSON array, additive migration with backfill from existing `#tags` in content), `GET /api/notes?tag=<tag>` across all dates, `GET /api/notes/tags` returning counts per active tag, and `POST/PATCH /api/notes` merging `#tags` in content with explicit `tags`.
- **UI:** "Daily Note" / "Daily Notes" is now **Note** / **Notes** across Quick Capture (`⌘⇧P`), Sidebar, Command Palette, Notes drawer, and Weekly Review. Typing `#` in Quick Capture or the Notes drawer offers autocomplete for known tags; clicking any `#tag` chip in the Notes drawer shows all matching notes across all dates (newest first) and auto-tags notes added in that view.
- **CLI:** `veyra note add "#veyra ..." [--tag <tag>]`, `veyra notes --tag <tag>`, `veyra notes --tags`, and `veyra note tags`.

### Side work beside the summary & built-in T3 Code collector

- **Built-in `--t3` collector (`packages/cli/src/collectors/t3-code.ts`):** Read-only `sqlite3` query against `~/.t3/userdata/statev2.sqlite` sampling the first real user message plus the last 2 messages per thread across the full focus window (replacing the 40-message cap in `~/.veyra/t3-context.mjs`).
- **Deterministic `sideWork`:** Computed per other active project without the LLM, mapped by name to Veyra projects, stored in `blocks.side_work`, and rendered under the auto-summary in `BlockDetailDrawer` as "Also during this block" (display only; time stays on the focused block). The summarizer prompt keeps the summary focused on the block's own project.
- **Launch agent:** `com.veyra.hook-listener` switched from `--context-cmd ~/.veyra/t3-context.mjs` to `--t3`.

## Work steps {#steps updated=2026-11-26}

```steps
- [x] collector: T3 collector into the repo, sampling the whole window | owner: Agent | done-when: `veyra hook summarize` with `--t3` sees messages from the last ten minutes of a 60 minute block | updated: 2026-11-26
  Built-in `packages/cli/src/collectors/t3-code.ts` (`--t3` / `--t3-db`), samples first real user prompt + last 2 messages per thread across the full window. Launch agent switched to `--t3`.
- [x] sidework: Side work card under the auto-summary | owner: Agent | after: collector | done-when: an Accenture block with Covestro activity shows a Covestro line in the block drawer | updated: 2026-11-26
  Stored in `blocks.side_work` and rendered by `SideWorkSection` in `BlockDetailDrawer`.
- [x] notes-tags: General notes with `#tags`, autocomplete, tag filter view, and CLI | owner: Agent | done-when: `#veyra` notes can be captured via `⌘⇧P` or CLI and filtered across all dates | updated: 2026-11-26
  Replaces the separate feedback kind from the initial draft with general tagged notes (`#veyra`, `#ux`, etc.).
```

## Open questions {#open updated=2026-11-26}

> [!card question yellow] Q1: What should starting a session via the hotkey look like?
> Dennis asked that starting a session via the hotkey should feel nice and "not like an OS thing". Today `⌘⇧O` opens the Quick Capture window on `Focus Now` and, with a session running, brings the main window to the `Focus` view. Unclear whether this means a dedicated small focus window instead of the full main window, or something else.
