---
id: architecture.design-system-tokens
type: rule
scope: architecture
authority: canonical
sourceVersion: 9026ead
extends: architecture
groundedIn:
  - packages/web/src/styles/tokens.css
  - packages/web/src/styles/global.css
  - packages/web/src/components/Button.tsx
  - packages/web/src/components/Pill.tsx
  - packages/web/src/components/goalTint.ts
  - packages/web/src/components/GoalChip.tsx
  - packages/web/src/components/ColorPicker.tsx
  - packages/web/src/components/TellSomeonePopover.tsx
  - packages/web/src/components/ContextMenu.tsx
  - packages/web/src/components/PropertyChip.tsx
  - packages/web/src/components/ProjectBadge.tsx
  - packages/web/src/components/LinkChip.tsx
  - packages/web/src/components/DockedDrawer.tsx
  - packages/web/src/components/ModalSheet.tsx
  - packages/web/src/components/ToggleSwitch.tsx
  - packages/web/src/components/icons.tsx
updateWhen:
  - Figma palette tokens, spacing rules, or typography change
  - shared UI primitives or calendar block visual semantics change
---
# Design System Tokens And Layout Rules

Veyra's web and desktop UI implements the pure neutral dark aesthetic locked in Figma (`Veyra Theme` and `Veyra Scale`, Screens `22:2`). Exact CSS custom properties live in `packages/web/src/styles/tokens.css`.

## Surface Hierarchy And Neutral Dark Rules

- **Zero bluish slate cast:** Surfaces step strictly through pure neutral charcoals: canvas `#131313`, completed/deep canvas `#171717`, meeting card `#181818`, cards and drawers `#1C1C1C`, secondary surface `#242424`, elevated chips/floats `#262626`, hairline border `#2A2A2A`, and strong border `#3C3C3C`.
- **Restrained indigo brand accent:** Primary interactive fill is `#3B4BD8` (`#4758E6` hover) with soft indigo selection states (`rgba(59, 75, 216, 0.23)` pill and `#D6DCFF` text in the sidebar).
- **Liquid Glass macOS sidebar:** Full-height `240px` sidebar (`rgba(30, 30, 30, 0.90)` vibrancy glass) with macOS traffic-light clearance, `38px` `Search… ⌘K` above six primary routes (`Today`, `Plan`, `Calendar`, `Projects`, `Goals`, `Review`), unlimited pinned projects (`22px` icon/monogram badges + right-click context menu), active `GOALS` grouped by `Personal` and `Company` (`GoalKindIconBadge`, `+` quick create, right-click menu, zero weekly time bars), live focus pill, and `Daily Notes ⌘⇧P` + `Settings ⌘,` footer.
- **Floating Quick Capture glass treatment:** The `580×204` `⌘⇧P` overlay pairs translucent dark charcoal (`#1C1C1C`) with a crisp light-catching macOS window rim, deep floating shadow, borderless `17px` `Outfit` input, and elevated `#262626` footer chips.
- **Typography:** `Outfit` SemiBold for display headings, `Inter` for UI copy, `SF Mono` for code/commands, and tabular numerals on all durations, counters, and stopwatches.

## Layout Invariants

- **Strict no card-in-card:** Cards sit directly on `#131313` canvas. Inside a paused `Today` card, the resume note sits beneath a single `1px` hairline divider rather than a nested inner card; the Review `What changes next week?` `Rule for next week` editor also sits directly on canvas. `Plan` day columns and `Inbox` are borderless columns directly on canvas.
- **Strict spacing & radius tokens, equal four-sided padding:** All layout padding, gaps, and border radii bind strictly to `Veyra Scale` variables (`space/2`–`space/32` and `radius/badge`, `radius/sm`, `radius/md`, `radius/lg`, `radius/pill`)—never arbitrary intermediate values like `11px`, `14px`, `22px`, or raw corner radii—so Figma tokens map 1:1 to CSS/code. Every container surface—page canvases (`space/24`), `DockedDrawer` bodies (`space/24`), `ModalSheet` bodies (`space/24`), cards (`space/20` in Figma / `--space-card` in web), and multiline textareas (`space/12`)—uses identical padding on all four sides (`top = right = bottom = left`). Asymmetric horizontal vs. vertical padding is reserved strictly for single-line controls where it makes semantic sense (single-line text inputs, buttons, pills/chips, toolbars/topbars, and table rows).
- **Equal-height sibling cards & inline title icons:** Side-by-side option or choice cards stretch to equal height (`layoutSizingVertical: 'FILL'`). Multi-line rows with a leading icon (such as Ops Radar entries or summary sections) place the icon inline and vertically centered on the title line rather than floating in a separate left gutter.
- **Equal `18px` card padding (web):** Cards across `Today`, `Plan`, `Calendar`, `Projects`, `Goals`, and `Review` use uniform `--space-card` (`18px`) padding on all four sides, with `space-y-3`–`3.5` gaps between cards. `.veyra-card` lives in `@layer components`, so Tailwind utilities on a card (selected borders, `focus-visible:border-[#5566F2]`, padding overrides such as `py-4 px-5` on `Projects` rows) win over the defaults. Clickable cards suppress the browser focus outline and show a `#5566F2` border on keyboard focus instead.
- **Selection rings never clip:** Selected color swatches and active badges use inside-aligned strokes (`strokeAlign: 'INSIDE'`) or non-clipping wrappers so selection rings stay circular and never get shaved flat by parent bounds.
- **Goal chips and kind icon badges (`GoalChip.tsx`, `goalTint.ts`):** Everywhere a goal appears (`Goals`, Sidebar `GOALS`, `Projects`, `ProjectModal`, `CreateBlockModal`, `BlockDetailDrawer`, `Focus`, `Review`), `GoalChip` and `GoalKindIconBadge` replace plain color dots with a kind icon inside a tinted rounded square (`User` for `Personal`, `Briefcase` for `Company`). `goalTint.ts` derives background (~20% goal color mixed onto `#1C1C1C`), border (~38% alpha), and bright readable foreground tint for both preset and arbitrary custom hex colors. Goal cards themselves stay neutral `#1C1C1C`.
- **Popover and context menus:** Dropdowns, the `CommandPalette` list, and every right-click `ContextMenu` share one rhythm: `p-1.5` outer padding, `11px` radius, rows `px-3 py-2 rounded-[7px] gap-2.5 text-[13px]`, destructive rows in rose `#FF9EC5`, and project lists up to `max-h-80`.
- **High-signal minimalism:** Block cards show project badge, title, and actionable flags only (`Ops`, real date-only `Due`, quiet `↻` recurring indicator, or rough size chip for capacity fit). Never render fake time estimates, red overdue alarms, gamified goal scores, or weekly time bars on goals.
- **Calendar visual distinction:**
  - `Done (logged)` focus sessions render with a solid project-tinted fill and `✓` prefix.
  - Optional future `Planned` slots render with a very dark project-tinted wash (`--project-*-wash`) and a dashed project-colored border with `Planned` label.
  - Real `Meetings` render as neutral outlined `#181818` cards with a video/calendar icon (past meetings dimmed).
  - Selection rings match the selected item's accent color.

## Shared UI Primitives

Build screens by composing the primitives in `packages/web/src/components/`:

- `ColorPicker`: shared across Goals, Projects, and Onboarding (`COLOR_PICKER_PRESETS` from `@veyra/core/types`): 12 curated swatches (`Indigo`, `Sky`, `Cyan`, `Teal`, `Mint`, `Lime`, `Amber`, `Orange`, `Coral`, `Rose`, `Pink`, `Violet`) plus a 13th custom slot toggling an inline hex editor (preview, hex input, native picker button, `Apply`) with non-clipping circular selection rings.
- `GoalChip` & `GoalKindIconBadge`: canonical goal tag and kind-icon badge (`personal` person icon, `company` briefcase icon) tinted via `goalTint.ts`.
- `ProjectBadge` & `icons.tsx`: renders a project's chosen vector icon or 2-letter monogram in its configured color.
- `Pill` & `PropertyChip`: semantic tag pills (`Goal`, `Ops`, `Due`, `Energy`, `Neutral`) and interactive elevated `#262626` metadata chips inside drawers and modals.
- `TellSomeonePopover`: calm local two-line message draft popover with `Copy` and `Send to T3 Code` clipboard handoff (never sends messages externally).
- `LinkChip`: clickable external link badge (Notion, GitHub PR, Teams, URL) that opens via browser or `window.veyraDesktop.openExternalUrl`.
- `DockedDrawer` (`520px` right slide-over, `24px` padding) and `ModalSheet` (`640px` / `560px` centered sheets): consistent overlay chrome with `Esc` dismissal.
- `Button` and `ToggleSwitch`: standard interactive controls with consistent focus and disabled states.
