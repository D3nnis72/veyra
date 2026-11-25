---
id: features.cockpit-views
type: summary
scope: features
authority: canonical
sourceVersion: f62c1c9
extends: features
dependsOn:
  - architecture.domain-invariants
  - architecture.design-system-tokens
  - interfaces.http-sse-api
groundedIn:
  - packages/web/src/app/App.tsx
  - packages/web/src/app/Sidebar.tsx
  - packages/web/src/app/hotkeys.ts
  - packages/web/src/app/CommandPalette.tsx
  - packages/web/src/app/CreateBlockModal.tsx
  - packages/web/src/app/OnboardingFlow.tsx
  - packages/web/src/app/QuickCaptureOverlay.tsx
  - packages/web/src/components/AutoSummarySection.tsx
  - packages/web/src/components/BlockDetailDrawer.tsx
  - packages/web/src/components/ColorPicker.tsx
  - packages/web/src/components/DailyNotesDrawer.tsx
  - packages/web/src/components/GoalChip.tsx
  - packages/web/src/components/LinkPickerPopover.tsx
  - packages/web/src/components/TellSomeonePopover.tsx
  - packages/web/src/components/ContextMenu.tsx
  - packages/web/src/components/entityMenus.tsx
  - packages/web/src/views/TodayView.tsx
  - packages/web/src/views/FocusView.tsx
  - packages/web/src/views/PlanView.tsx
  - packages/web/src/views/CalendarView.tsx
  - packages/web/src/views/MeetingDetailDrawer.tsx
  - packages/web/src/views/SessionDetailDrawer.tsx
  - packages/web/src/views/ProjectsView.tsx
  - packages/web/src/views/ProjectDetailView.tsx
  - packages/web/src/views/ProjectModal.tsx
  - packages/web/src/views/GoalsView.tsx
  - packages/web/src/views/GoalDetailDrawer.tsx
  - packages/web/src/views/GoalFormDrawer.tsx
  - packages/web/src/views/CloseGoalSheet.tsx
  - packages/web/src/views/ReviewView.tsx
  - packages/web/src/views/SettingsView.tsx
updateWhen:
  - any view, docked drawer, composer modal, or global shortcut changes
  - onboarding or settings tabs change
---
# Cockpit Views And Interaction Flows

`@veyra/web` renders seven core cockpit views (`Today`, `Focus`, `Plan`, `Calendar`, `Projects`, `Goals`, `Review`), `Onboarding`, 3-tab Full-Page `Settings`, docked drawers, and global overlays against `@veyra/server` using TanStack Query plus live SSE invalidation (`packages/web/src/api/use-live-sync.ts`).

## App Shell, Shortcuts, And Context Menus

- **Sidebar (`240px` fixed):** Holds `Search… ⌘K` (`38px`), six primary routes (`Today`, `Plan`, `Calendar`, `Projects`, `Goals`, `Review`), unlimited `PINNED` projects (`22px` icon/monogram badges + right-click menu), an active `GOALS` section below `PINNED` (with `+` quick create, grouped into `Personal` and `Company` with `GoalKindIconBadge`, right-click menu, and zero weekly time bars), a live focus pill when running outside `Focus`, and a quiet footer with `Daily Notes ⌘⇧P` and `Settings ⌘,`.
- **Shortcuts (`app/hotkeys.ts`):** `⌘1`–`⌘6` (`Today`, `Plan`, `Calendar`, `Projects`, `Goals`, `Review`), `Tab`, `⌘↵`, and `Esc` stay fixed; all other shortcuts are rebindable in `Settings → Server & CLI → Keyboard Shortcuts`. Defaults: `⌘K` (in-app) and `⌥K` (system-wide) open `CommandPalette`; `⌘⇧P` opens `QuickCaptureOverlay` on `Daily Note`, while `⌘⇧O` / `⌃O` opens it on `Focus Now` (`Tab` cycles `Daily Note → Inbox → Focus Now`, `⌃P` opens the searchable project autocomplete picker in both `QuickCaptureOverlay` and `CreateBlockModal`, `⌥O` toggles `Ops`, `⌘↵` creates and enters `Focus`); `⌘N` opens `CreateBlockModal`; `⌘S` saves the active drawer; `⌘,` opens `Settings` (`Integrations`); in `Focus`, `P` pauses, `C` or `⌘↵` completes, and `N` toggles notes.
- **CommandPalette (`CommandPalette.tsx`):** Jumps to views, projects, blocks, or goals—selecting a goal opens `GoalDetailDrawer` / `Goals` directly rather than `Settings`.
- **Context menus (`components/ContextMenu.tsx`, `components/entityMenus.tsx`):** One shared floating dark menu (viewport-clamped, `Esc` / outside click / scroll dismiss, `↑↓` navigation):
  - **Blocks:** `Start Focus` / `Reopen Block`, `Open Details`, `Mark Complete`, `Move to Today` / `Move to Tomorrow`, `Park in Later (2w)`, `Move to Inbox`, `Toggle Ops`, `Duplicate Block`, `Drop Block`, `Delete Block`.
  - **Meetings:** `Open Meeting Notes`, `Open in Teams / Join`, `Create Follow-up Block`, `Toggle Ops`.
  - **Focus sessions (`Calendar`):** `Open Session Details & Trim/Split`, `Open Block`, `Delete Session`.
  - **Projects (`ProjectsView` & Sidebar):** `New Block`, `Edit Project`, `Pin / Unpin from Sidebar`, `Archive Project`, `Delete Project` (archive/delete hidden for system `Other`).
  - **Goals (`GoalsView` & Sidebar `useGoalContextMenu`):** `Open Details`, `Edit Goal`, `New Block for this Goal`, `Show in Review`, `Move Up`, `Move Down`, `Mark Achieved`, `Let Go`, `Reactivate Goal` (on closed goals), `Delete Goal`.
- **Onboarding (`OnboardingFlow.tsx`):** Three-step first-run flow (initial Personal/Company Goals with shared `ColorPicker`, initial Projects with `ColorPicker`, local vs. remote server + `veyra` CLI setup) shown until `Settings.onboardingCompleted` is true. In local mode, data and `onboardingCompleted: true` persist before confirming client config so the renderer never reloads mid-save.

## Seven Core Views

- **`Today` (`TodayView.tsx`):** `52px` topbar (`Today · <date>`, `+ Note ⌘⇧P`, `+ New Block`) above a single-column workspace showing `focused today`, `Room today` under the date (See → `architecture.domain-invariants`), active Weekly Rule, next upcoming real call (only while ahead), `UP NEXT` with one-line placement reasons and one-click `Use suggested order` (never auto-reorders), a `Fit Line` (`fits today`) separating fitting blocks from quieter `Probably not today` rows with inline `Tomorrow`, `Later`, `Drop` (optional inline `Drop reason` + `Undo`), and `Tell someone` (`TellSomeonePopover` local draft for due/follow-up blocks), a dismissible `Day look back` card when today's queue clears or on next-morning first open, and `COMPLETED TODAY` rows.
- **`Focus` (`FocusView.tsx`):** Hides sidebar and queue completely (`App.tsx` omits `<Sidebar />` on `focus`). Displays centered count-up stopwatch, quiet linked-goal `why` / `doneWhen` context, upcoming-call chip within 45 minutes, inline `Pause` (optional resume note, `Esc` skips), inline `Complete Block` (3-option energy picker, 3-option `senseSignal` "Did this block make sense for its goal?" picker, and one-line outcome with session + multi-day totals), and `Notes & Notion links` toggling the docked `BlockDetailDrawer`.
- **`Plan` (`PlanView.tsx`):** `Week Time Strip` above the board comparing planned block time per project against `weeklyTimeMinutes`, toggleable borderless `Inbox` (inline quick-add + collapsible `Later` with revisit badges), and borderless `Mon`–`Fri` columns with `@dnd-kit` drag-and-drop. Day column headers show planned time against weekday room plus real meetings as quiet prep context; cards and editors support rough block sizes (`30m` / `1h` / `2h` / learned default).
- **`Calendar` (`CalendarView.tsx`):** Weekly time grid with live `Now` line distinguishing solid `Done (logged)` sessions (`✓`), dark dashed optional `Planned` slots, and neutral `Meeting` blocks (auto-matched or assigned meetings gain a `3px` project left stripe; See → `interfaces.calendar-sync-webhooks`). Clicking opens `SessionDetailDrawer` (trim, split, delete, `AutoSummarySection`) or `MeetingDetailDrawer` (`ProjectBadge`, `GoalChip` picker, `Ops`, `LinkPickerPopover`, notes, `+ Create Follow-up Block`).
- **`Projects` (`ProjectsView.tsx`, `ProjectDetailView.tsx`, `ProjectModal.tsx`):** Portfolio filterable by status (`All`, `Active`, `Quiet`, `Paused`, `Archived`) and weekly-time variance (`Over`, `Under`, `Untouched`), showing weekly focus progress bars against `weeklyTimeMinutes`, open counts, last-touched status, `GoalChip`, and non-deletable system `Other`. `ProjectDetailView` adds an 8-week bar chart against the weekly time line, 8-week average, and learned size drift. `ProjectModal` (`520px` `DockedDrawer`) edits badge icon/monogram, shared `ColorPicker`, `Weekly time`, default `GoalChip` (+ inline `+ New Goal`), Notion URL, `Calendar sync keywords` (`matchKeywords`), sidebar pin, and status.
- **`Goals` (`GoalsView.tsx`, `GoalDetailDrawer.tsx`, `GoalFormDrawer.tsx`, `CloseGoalSheet.tsx`):** Top-level route grouping active goals under `Personal` and `Company` headlines (neutral cards, `GoalKindIconBadge`, measured weekly focus, zero weekly time targets/bars) with collapsible closed goals (`Achieved` / `Let Go`). Clicking opens `GoalDetailDrawer` (`520px` drawer with weekly focus, block/project counts, inline `ColorPicker`, and quarterly history of outcomes + measure updates). `GoalFormDrawer` creates/edits `kind`, `COLOR` beneath `KIND`, `Why it matters`, `Done when`, `Check in date`, `Measure`, and `If it stalls`; `CloseGoalSheet` records `Mark Achieved` or `Let Go` with "What did this goal bring?".
- **`Review` (`ReviewView.tsx`):** Four-chapter scrolling review with top `Chapter Bar`, `By Goal` / `By Project` toggle, inline measure and next-week project time inputs, canvas-level rule editor, and `Completed & Auto-Synced` snapshot state. See → `features.review-and-rollover`

## Shared Docked Drawers And Three-Tab Settings

- **Overlay vs. docked:** On every route except `Focus`, docked right drawers (`520px`) overlay the page without shrinking columns; `Focus` reserves `lg:pr-[520px]` so the stopwatch stays centered.
- **`BlockDetailDrawer`:** Shared across `Today`, `Plan`, `Projects`, and `Focus`. Edits title, property chips (`Project`, `GoalChip` picker, `Schedule`, rough `Size`, quiet `Due`, `Ops`, `Repeat`), `LinkChip`s via `LinkPickerPopover` (zero-config URL paste + optional live Notion search), `Start`/`Resume Focus` and `Finish` buttons, hairline `AutoSummarySection`, borderless `NOTES & AI CONTEXT` markdown canvas, multi-day `SESSIONS` with `+ Log time`, and footer exits (`Move to Tomorrow`, `Park in Later (2w)`, `Drop block`).
- **Full-Page `Settings` (`SettingsView.tsx`):** Three tabs defaulting to `Integrations` on `⌘,`: `Integrations` (calendar sync modes/diagnostics, outgoing webhooks including `review.completed` + `Test Hook` + live `Recent Deliveries` + `veyra hook listen` command, optional Notion token/OAuth + test, macOS Focus Mode shortcuts; See → `interfaces.calendar-sync-webhooks`), `Server & CLI` (titled `Server, CLI & Shortcuts`: Electron local vs. remote server switcher, `veyra` CLI config, macOS tray toggle, and rebindable `Keyboard Shortcuts`; See → `features.desktop-shell-capture`), and `Appearance` (Dark mode active).
