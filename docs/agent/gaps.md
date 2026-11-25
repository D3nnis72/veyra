# Open Gaps And Follow-Ups

Open post-MVP items and known non-blocking improvements. Remove each item once resolved or moved into its canonical owner.

## Step 03 Ecosystem Loop (Remaining Scope)

- **Area:** `docs/playbook/canvases/veyra/03_ecosystem_loop.md`
- **Detail:** `T3 Code Focus Mode Filter` (`focus.started` thread/project filter) and `Dedicated iOS App` remain intentionally open in Step 03. (Teams/Outlook status write-back was explicitly dropped; menu bar active project icon & controls, inline Notion search & link picker, the event hooks listener + post-block auto-summary & `Ops` pattern runner, and macOS Focus Mode presence have shipped.)

## Visual Screenshot Verification Against Figma (Target Design)

- **Area:** `features.cockpit-views`, `architecture.design-system-tokens`, `features.review-and-rollover`
- **Detail:** All 4 slices of the target design (`Goals`, `Project Weekly Time & Plan`, `Today Prioritization & Focus Sense-Check`, and `4-Chapter Weekly Review`) passed automated unit, jsdom UI, and E2E verification, plus interactive Checkpoint 1 and Checkpoint 3 fixes. A final full-pass dark-mode browser screenshot comparison of every updated screen and overlay against Figma `Screens` (`071lgm98oyBn2xNWx2uBD1`) — and refreshing `docs/assets/*.png` — remains to be run interactively outside headless mode.

## Web Bundle Code-Splitting

- **Area:** `features.cockpit-views` (`packages/web/vite.config.ts`)
- **Detail:** Vite currently emits a single main JS bundle (>500 kB warning during `pnpm --filter @veyra/web build`). Split heavy views (`CalendarView`, `ReviewView`, `SettingsView`) or vendor chunks via dynamic imports or `manualChunks` when optimizing cold load performance.

## Light Mode And Theme Switcher

- **Area:** `architecture.design-system-tokens` (`packages/web/src/styles/tokens.css`, `packages/web/src/views/SettingsView.tsx`)
- **Detail:** MVP intentionally ships Dark mode only (`Settings.theme = 'dark'`). Light and System mode CSS variable sets and UI polish remain deferred.

## Minor Spec Divergence Noted At MVP Closeout

- **Calendar sync forward window:** `CalendarSyncRunner` defaults to `windowDaysForward = 28` (`today - 7d` through `today + 28d`) rather than the earlier `+14d` spec draft; documented as shipped truth in `interfaces.calendar-sync-webhooks`.
