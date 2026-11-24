---
id: features.cockpit-views
type: summary
scope: features
authority: canonical
sourceVersion: 432c801
extends: features
dependsOn:
  - architecture.domain-invariants
  - architecture.design-system-tokens
  - interfaces.http-sse-api
groundedIn:
  - packages/web/src/app/App.tsx
  - packages/web/src/app/Sidebar.tsx
  - packages/web/src/app/CommandPalette.tsx
  - packages/web/src/app/CreateBlockModal.tsx
  - packages/web/src/app/OnboardingFlow.tsx
  - packages/web/src/app/QuickCaptureOverlay.tsx
  - packages/web/src/components/AutoSummarySection.tsx
  - packages/web/src/components/BlockDetailDrawer.tsx
  - packages/web/src/components/DailyNotesDrawer.tsx
  - packages/web/src/components/LinkPickerPopover.tsx
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
  - packages/web/src/views/ReviewView.tsx
  - packages/web/src/views/SettingsView.tsx
updateWhen:
  - any view, docked drawer, composer modal, or global shortcut changes
  - onboarding or settings tabs change
---
# Cockpit Views And Interaction Flows

`@veyra/web` renders all six cockpit views, `Onboarding`, Full-Page `Settings`, docked drawers, and global overlays against `@veyra/server` using TanStack Query plus live SSE invalidation (`packages/web/src/api/use-live-sync.ts`).

## App Shell And Shortcuts

- **Sidebar (`240px` fixed, no collapse toggle in MVP):** Holds `Search… ⌘K` (`38px`), five primary routes (`Today`, `Plan`, `Calendar`, `Projects`, `Review`), unlimited pinned projects with `22px` icon or monogram badges and the shared project right-click menu (see Context Menus below), a live focus pill whenever a session runs outside `Focus`, and a quiet footer with `Daily Notes ⌘⇧P` and `Settings & Goals ⌘,`.
- **Global shortcuts:** `⌘K` (in-app) and `⌥K` (system-wide macOS floating glass window at `/command`) open `CommandPalette`; `⌘⇧P` (in-app and system-wide) opens `QuickCaptureOverlay` on `Daily Note`, while `⌃O` (in-app and system-wide) opens it directly on `Focus Now` to create a block for today and enter `Focus` on `Enter`. Inside `QuickCaptureOverlay`, `Tab` / `Shift+Tab` cycles `Daily Note → Inbox → Focus Now`, `⌃P` cycles projects, `⌥O` toggles `Ops`, and `⌘↵` creates and enters `Focus` from `Inbox`. `⌘1`–`⌘5` jump to `Today`, `Plan`, `Calendar`, `Projects`, `Review`; `⌘N` opens `CreateBlockModal` (`⌘↵` creates, `⌘⇧↵` creates and enters `Focus`); `⌘S` saves the active drawer; `⌘,` opens Full-Page `Settings`; in `Focus`, `P` pauses, `C` or `⌘↵` completes, and `N` toggles the notes drawer; `Esc` dismisses overlays/drawers.
- **Context menus (`components/ContextMenu.tsx`, `components/entityMenus.tsx`):** Right-click opens one shared floating dark glass menu (viewport-clamped, `Esc` / outside click / scroll dismiss, `↑↓` to move between items). **Block cards** (`Today` `UP NEXT` + `COMPLETED TODAY`, `Plan` `Inbox` / `Later` / day columns, `ProjectDetailView`, `Calendar` planned slots): `Start Focus` (todo) or `Reopen Block` (done/dropped), `Open Details`, `Mark Complete` (todo), `Move to Today` / `Move to Tomorrow` (hidden when already there), `Park in Later (2w)`, `Move to Inbox` (hidden in Inbox), `Toggle Ops`, `Duplicate Block`, `Drop Block`, `Delete Block`. **Meetings** (`Today` next-meeting bar, `Plan` day-top meetings, `Calendar` meeting blocks): `Open Meeting Notes`, `Open in Teams / Join` (when `meetingUrl` is set), `Create Follow-up Block` (opens `CreateBlockModal` with the meeting's project, goal, and `Follow-up: <title>`), `Toggle Ops`. **Focus sessions** (`Calendar`): `Open Session Details & Trim/Split`, `Open Block`, `Delete Session`. **Projects** (`ProjectsView` rows and Sidebar pinned projects): `New Block`, `Edit Project`, `Pin / Unpin from Sidebar`, `Archive Project`, `Delete Project` (archive and delete hidden for system `Other`).
- **Onboarding:** Three-step first-run flow (create initial Goals, create initial Projects, confirm local vs. self-hosted server and copy `veyra` CLI setup) shown until `Settings.onboardingCompleted` is true. In local mode, Onboarding persists goals, projects, and `onboardingCompleted: true` before confirming client config so the renderer is never reloaded mid-save.

## Six Core Views

- **`Today` (`TodayView.tsx`):** Dedicated `52px` topbar (`Today · <date>` left, `+ Note ⌘⇧P` and `+ New Block` right) above a calm single-column daily workspace showing the date, `focused today` total pill, active Weekly Rule, next upcoming real call (only while a meeting is still ahead; no bar once today's meetings are over), `UP NEXT` cards (clicking Play or `Enter` enters `Focus`; clicking a card opens `BlockDetailDrawer`), and `COMPLETED TODAY` rows with duration, outcome, and energy pill.
- **`Focus` (`FocusView.tsx`):** Hides sidebar and queue completely (`App.tsx` omits `<Sidebar />` on the `focus` route, with macOS traffic-light clearance on the `52px` draggable Focus header). Displays centered count-up stopwatch, quiet upcoming-call chip when a real meeting starts within 45 minutes, inline `Pause` (optional one-line resume note, `Esc` skips), inline `Complete Block` (3-option energy picker + one-line outcome showing both session and multi-day block totals), and `Notes & Notion links` toggling the docked `BlockDetailDrawer` beside the stopwatch.
- **`Plan` (`PlanView.tsx`):** Split workspace with toggleable borderless `Inbox` (inline quick-add + collapsible `Later` section with revisit horizon badges) on the left and borderless `Mon`–`Fri` day columns on the right. Drag blocks with `@dnd-kit` across `Inbox`, `Later`, and day columns. Day headers display real meetings quietly at the top as prep context.
- **`Calendar` (`CalendarView.tsx`):** Weekly time grid with live `Now` line distinguishing solid `Done (logged)` sessions (`✓`), very dark dashed optional future `Planned` slots, and neutral `Meeting` blocks. Clicking empty slots schedules a `Planned` slot; clicking sessions opens `SessionDetailDrawer` (trim, split around a break, delete, edit metadata); clicking meetings opens `MeetingDetailDrawer` (Teams/Zoom link, custom dark popover `Project` (with `ProjectBadge`) and `Goal` (colored dot) pickers plus `Ops`, an open borderless `MEETING NOTES & PREP` canvas directly on `#1C1C1C`, `+ Create Follow-up Block`). Meetings assigned to a Project (manually or by auto-matching, see → `interfaces.calendar-sync-webhooks`) keep the neutral `#181818` card and video icon but gain a `3px` project-colored left stripe and a quiet project name.
- **`Projects` (`ProjectsView.tsx`, `ProjectDetailView.tsx`, `ProjectModal.tsx`):** Filterable portfolio (`All`, `Active`, `Quiet`, `Paused`, `Archived`) with search, weekly focus hours, open counts, last-touched status, linked Goal pill, and non-deletable system `Other` project. `ProjectModal` renders as a `520px` docked right-side drawer (`DockedDrawer`, matching `BlockDetailDrawer` and `MeetingDetailDrawer`) with a borderless hero header (live `ProjectBadge` preview, inline name and description), header `Delete` icon in edit mode, and `⌘↵` to save. It supports icon vs. monogram toggle, 8 accent colors, inline `+ New Goal`, Notion URL, optional comma-separated `Calendar sync keywords` (`matchKeywords`, auto-matches synced Outlook meetings by title), unlimited `Pin to sidebar`, `Active` / `Paused` / `Archived` status, and `Archive` (footer) / `Delete` (header) (also reachable from the Sidebar right-click menu).
- **`Review` (`ReviewView.tsx`):** Weekly facts view with KPIs, `Progress Feed`, `Daily Notes`, `Ops & Automation Radar`, `Backlog, Carryovers & Later Check-In`, and inline next-week Weekly Rule editor. See → `features.review-and-rollover`

## Shared Docked Drawers And Settings

- **Overlay vs. docked:** On every route except `Focus`, docked right drawers overlay the page (with a light backdrop) and never shrink or shift the underlying columns. Only `Focus` reserves `lg:pr-[520px]` on `<main>` so the stopwatch stays centered beside the open drawer.

- **`BlockDetailDrawer` (`520px`, `24px` padding):** Shared across `Today`, `Plan`, `Projects`, and `Focus`. Topbar carries a direct `Delete` button alongside `•••` and `Close`. Edits title, custom dark popover property chips (`Project`, `Goal`, unified `Schedule`, quiet `Due`, `Ops`, `Repeat`), clickable `LinkChip`s backed by the shared `LinkPickerPopover` (also used in `MeetingDetailDrawer` and `CreateBlockModal` so `+ Add link` supports both zero-config URL paste and live Notion page/database search with `↑↓` + `Enter` + `Esc` keyboard selection, linking without mirroring subtasks), a stacked full-width `Start Focus` / `Resume Focus` and `Finish` action bar directly beneath `Links`, a quiet hairline `AUTO SUMMARY` section (`AutoSummarySection`, shown when `block.autoSummary` is present, inline editable or clearable with zero nested cards), an open borderless markdown `NOTES & AI CONTEXT` canvas directly on `#1C1C1C`, multi-day `SESSIONS` history with `+ Log time`, and quiet footer actions (`Move to Tomorrow`, `Park in Later (2w)`, `Drop block`). `SessionDetailDrawer` also renders the same quiet `AUTO SUMMARY` hairline section beneath `Outcome` when present.
- **Full-Page `Settings` (`SettingsView.tsx`):** Linear-style full-page settings with five tabs: `Goals` (inline CRUD), `Integrations` (Outlook CLI / ICS / Manual calendar sync, `Sync Now`, status diagnostics, outgoing webhooks + `Test Hook`, copyable `veyra hook listen` CLI snippet, live `Recent Deliveries` diagnostics backed by `/api/activity?actor=hook`, and optional `Notion Links` integration token configuration with masked status + `Test Connection`), `Shortcuts` (complete reference of global macOS, navigation, Quick Capture, and Focus hotkeys plus customizable Quick Capture accelerator), `Server & CLI` (Electron local vs. remote server switcher, `veyra` CLI copyable config, macOS menu bar + global shortcut toggles), and `Appearance` (Dark mode active in MVP).
