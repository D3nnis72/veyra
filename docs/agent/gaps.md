# Open Gaps And Follow-Ups

Open post-MVP items and known non-blocking improvements. Remove each item once resolved or moved into its canonical owner.

## Step 03 Ecosystem Loop (Remaining Scope)

- **Area:** `docs/playbook/canvases/veyra/03_ecosystem_loop.md`
- **Detail:** `T3 Code Focus Mode Filter` (`focus.started` thread/project filter), `macOS Focus Mode Presence`, and `Dedicated iOS App` remain intentionally open in Step 03. (Teams/Outlook status write-back was explicitly dropped; menu bar active project icon & controls, inline Notion search & link picker, and the event hooks listener + post-block auto-summary & `Ops` pattern runner have shipped.)

## Web Bundle Code-Splitting

- **Area:** `features.cockpit-views` (`packages/web/vite.config.ts`)
- **Detail:** Vite currently emits a single main JS bundle (>500 kB warning during `pnpm --filter @veyra/web build`). Split heavy views (`CalendarView`, `ReviewView`, `SettingsView`) or vendor chunks via dynamic imports or `manualChunks` when optimizing cold load performance.

## Light Mode And Theme Switcher

- **Area:** `architecture.design-system-tokens` (`packages/web/src/styles/tokens.css`, `packages/web/src/views/SettingsView.tsx`)
- **Detail:** MVP intentionally ships Dark mode only (`Settings.theme = 'dark'`). Light and System mode CSS variable sets and UI polish remain deferred.

## Minor Spec Divergence Noted At MVP Closeout

- **Calendar sync forward window:** `CalendarSyncRunner` defaults to `windowDaysForward = 28` (`today - 7d` through `today + 28d`) rather than the earlier `+14d` spec draft; documented as shipped truth in `interfaces.calendar-sync-webhooks`.
