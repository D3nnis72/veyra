---
id: architecture.design-system-tokens
type: rule
scope: architecture
authority: canonical
sourceVersion: 0d7deb2
extends: architecture
groundedIn:
  - packages/web/src/styles/tokens.css
  - packages/web/src/styles/global.css
  - packages/web/src/components/Button.tsx
  - packages/web/src/components/Pill.tsx
  - packages/web/src/components/goalTint.ts
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
- **Liquid Glass macOS sidebar:** Full-height `240px` sidebar (`rgba(30, 30, 30, 0.90)` vibrancy glass) with macOS traffic-light clearance, `38px` `Search… ⌘K` above `36px` primary routes, unlimited pinned projects (`22px` icon/monogram badges + right-click context menu), live focus pill, and `Daily Notes ⌘⇧P` + `Settings & Goals ⌘,` footer.
- **Floating Quick Capture glass treatment:** The `580×196` `⌘⇧P` overlay pairs translucent dark charcoal (`#1C1C1C`) with a crisp light-catching macOS window rim, deep floating shadow, borderless `17px` `Outfit` input, and elevated `#262626` footer chips.
- **Typography:** `Outfit` SemiBold for display headings, `Inter` for UI copy, `SF Mono` for code/commands, and tabular numerals on all durations, counters, and stopwatches.

## Layout Invariants

- **Strict no card-in-card:** Cards sit directly on `#131313` canvas. Inside a paused `Today` card, the resume note sits beneath a single `1px` hairline divider rather than a nested inner card. `Plan` day columns and `Inbox` are borderless columns directly on canvas.
- **Equal `18px` card padding:** Cards across `Today`, `Plan`, `Calendar`, `Projects`, and `Review` use uniform `--space-card` (`18px`) padding on all four sides, with `space-y-3`–`3.5` gaps between cards. `.veyra-card` lives in `@layer components`, so Tailwind utilities on a card (selected borders, `focus-visible:border-[#5566F2]`, padding overrides such as `py-4 px-5` on `Projects` rows) win over the defaults. Clickable cards suppress the browser focus outline and show a `#5566F2` border on keyboard focus instead.
- **Goal-tinted pills and chips:** Goal pills (`<Pill tone="goal" dotColor={goal.color}>`), the `Goal` picker buttons in `BlockDetailDrawer` / `MeetingDetailDrawer`, and the goal chips in `CreateBlockModal` / `ProjectModal` derive their colors from the goal's own hex via `components/goalTint.ts`: background is the goal color mixed ~20% onto `#1C1C1C`, border is the goal color at ~38% alpha, and text is a hand-tuned bright tint for the 8 accent colors (generic hex: 50% mix with white).
- **Popover and context menus:** Dropdowns, the `CommandPalette` list, and every right-click `ContextMenu` share one rhythm: `p-1.5` outer padding, `11px` radius, rows `px-3 py-2 rounded-[7px] gap-2.5 text-[13px]`, destructive rows in rose `#FF9EC5`, and project lists up to `max-h-80`.
- **High-signal minimalism:** Block cards show project badge, title, and actionable flags only (`Ops`, real date-only `Due`, or quiet `↻` recurring indicator). Never render fake time estimates on `Plan` cards or red overdue alarms.
- **Calendar visual distinction:**
  - `Done (logged)` focus sessions render with a solid project-tinted fill and `✓` prefix.
  - Optional future `Planned` slots render with a very dark project-tinted wash (`--project-*-wash`) and a dashed project-colored border with `Planned` label.
  - Real `Meetings` render as neutral outlined `#181818` cards with a video/calendar icon (past meetings dimmed).
  - Selection rings match the selected item's accent color.

## Shared UI Primitives

Build screens by composing the primitives in `packages/web/src/components/`:

- `ProjectBadge` and `icons.tsx`: renders a project's chosen vector icon or 2-letter monogram in one of the 8 accent colors (`indigo`, `emerald`, `amber`, `rose`, `cyan`, `violet`, `gold`, `slate`).
- `Pill` and `PropertyChip`: semantic tag pills (`Goal`, `Ops`, `Due`, `Energy`, `Neutral`) and interactive elevated `#262626` metadata chips inside drawers and modals.
- `LinkChip`: clickable external link badge (Notion, GitHub PR, Teams, URL) that opens via browser or `window.veyraDesktop.openExternalUrl`.
- `DockedDrawer` (`520px` right slide-over, `24px` padding) and `ModalSheet` (`640px` / `560px` centered sheets): consistent overlay chrome with `Esc` dismissal.
- `Button` and `ToggleSwitch`: standard interactive controls with consistent focus and disabled states.
