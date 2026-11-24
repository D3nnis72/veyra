# Open Gaps And Follow-Ups

Open post-MVP items and known non-blocking improvements. Remove each item once resolved or moved into its canonical owner.

## Step 03 Ecosystem Loop (Open Canvas)

- **Area:** `docs/playbook/canvases/veyra/03_ecosystem_loop.md`
- **Detail:** Post-block T3 Code auto-summary and `Ops` pattern extraction (`focus.ended` / `block.completed` webhook consumer), T3 Code Focus filter (`focus.started`), Teams/Outlook/macOS Focus presence write-back, inline Notion search picker, live stopwatch in macOS menu bar, and dedicated iOS app remain intentionally deferred to Step 03.

## Web Bundle Code-Splitting

- **Area:** `features.cockpit-views` (`packages/web/vite.config.ts`)
- **Detail:** Vite currently emits a single main JS bundle (>500 kB warning during `pnpm --filter @veyra/web build`). Split heavy views (`CalendarView`, `ReviewView`, `SettingsView`) or vendor chunks via dynamic imports or `manualChunks` when optimizing cold load performance.

## Light Mode And Theme Switcher

- **Area:** `architecture.design-system-tokens` (`packages/web/src/styles/tokens.css`, `packages/web/src/views/SettingsView.tsx`)
- **Detail:** MVP intentionally ships Dark mode only (`Settings.theme = 'dark'`). Light and System mode CSS variable sets and UI polish remain deferred.

## Minor Spec Divergence Noted At MVP Closeout

- **Calendar sync forward window:** `CalendarSyncRunner` defaults to `windowDaysForward = 28` (`today - 7d` through `today + 28d`) rather than the earlier `+14d` spec draft; documented as shipped truth in `interfaces.calendar-sync-webhooks`.
