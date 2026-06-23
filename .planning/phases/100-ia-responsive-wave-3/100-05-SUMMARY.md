---
phase: 100-ia-responsive-wave-3
plan: "05"
subsystem: ui
tags: [gameshell, responsive, rail, seat-strip, history-sheet, ia-06, ia-02, slate]
dependency_graph:
  requires:
    - 100-01 (GameShell Slate keystone — .stage + .sidebar + .actionbar)
    - 100-04 (ControlsMenu + heartbeat dot + platform-mode header gate)
  provides:
    - GameShell: real compact/medium/wide/ultrawide responsive tiers (640/768/1024/1440)
    - GameShell: sidebarRail ref + .side-edge toggle + .scrim phone overlay
    - PlayersPanel: color+shape+letter token + turn-status sentence + seatStrip mode
    - GameHistory: on-demand bottom-sheet mode (sheet prop) for compact phones
  affects:
    - src/ui/components/GameShell.vue (Phase 103 regression surface — rail state, responsive tiers)
    - src/ui/components/PlayersPanel.vue (Phase 103 regression surface — token + seat strip)
    - src/ui/components/GameHistory.vue (Phase 103 regression surface — sheet mode)
tech_stack:
  added: []
  patterns:
    - matchMedia compact query (≤639px) auto-collapses sidebar to rail on mount
    - MediaQueryList change listener cleaned up in onUnmounted
    - CSS clamp(220px, 22vw, 320px) for fluid sidebar width
    - CSS clip-path shape set (8 shapes) for player identity tokens
    - position:absolute within .stage for both scrim and history sheet overlay
key_files:
  created: []
  modified:
    - src/ui/components/GameShell.vue
    - src/ui/components/GameShell.ia.test.ts
    - src/ui/components/PlayersPanel.vue
    - src/ui/components/GameHistory.vue
decisions:
  - "sidebarRail class on .sidebar (not body) — scoped to component, no global side-effects"
  - "seatStrip bound to sidebarRail so rail-mode sidebar and seat-strip mode are always in sync"
  - "historySheet mode driven by sidebarRail ref (same source of truth as rail) — no separate historySheet ref needed"
  - "GameHistory sheet placed inside .stage as sibling of sidebar and boardregion — can never cover .actionbar"
  - "Scrim .active class bound in template; CSS only makes it visible in @media max-width:639px — safe on all breakpoints"
  - "PlayersPanel turnStatus returns 'Your move' for local player, '{name} is playing' for others — no 'your turn' literal"
metrics:
  duration_minutes: 32
  completed: "2026-06-23T11:20:00Z"
  tasks_completed: 3
  files_changed: 4
---

# Phase 100 Plan 05: Responsive Tiers, Rail, Seat Strip, History Sheet Summary

Replaced the single 768px breakpoint with real compact/medium/wide responsive tiers (IA-06); sidebar collapses to a rail via `sidebarRail` ref with a `.scrim` phone overlay; PlayersPanel gains color+shape+letter tokens and a turn-status sentence; GameHistory supports an on-demand bottom-sheet mode for compact phones.

## What Was Built

### Task 1 — Responsive Tiers, Sidebar Rail, Phone Overlay + Scrim, Landscape Branch

**GameShell.vue** script additions:
- `sidebarRail = ref<boolean>(false)` + `compactQuery: MediaQueryList | null = null`
- `initCompactRail(mql)` auto-collapses to rail when compact (≤639px) on mount
- `compactQuery.addEventListener('change', initCompactRail)` + cleanup in `onUnmounted`

**Template additions:**
- `<aside class="sidebar" :class="{ rail: sidebarRail }">` — rail class binding
- `.side-edge` button inside sidebar: `@click="sidebarRail = !sidebarRail"`, chevron rotates in rail mode
- `<div class="scrim" :class="{ active: !sidebarRail }" @click="sidebarRail = true">` inside `.stage` — never covers `.actionbar`

**CSS changes:**

| Selector | Key Rule |
|----------|----------|
| `.sidebar` | `width: clamp(220px, 22vw, 320px); transition: width var(--bsg-dur-base)` |
| `.sidebar.rail` | `width: var(--bsg-rail)` |
| `.sidebar.rail .side-scroll` | `padding: var(--bsg-s2) 0` |
| `.sidebar.rail :deep(.player-name-row)` | `display: none` |
| `.side-edge` | absolute, `right: -13px`, 26×26 circle button |
| `.scrim` | `position:absolute; inset:0; z-index:45; opacity:0; pointer-events:none` |
| `@media (max-width: 639px)` | `.sidebar:not(.rail)` → absolute overlay; `.scrim.active` → visible |
| `@media (min-width: 768px) and (max-width: 1023px)` | `boardregion min-height: 380px` |
| `@media (min-width: 1024px)` | `boardregion min-height: 480px` |
| `@media (min-width: 1440px)` | `.game-shell__game max-width: 1600px; margin-inline: auto` |
| `@media (orientation:landscape) and (max-height:600px)` | `actionbar max-height: min(22dvh, 120px)` |

Replaced the residual lone `@media (min-width: 768px)` block (plan 100-01 stub).

**Tests added (Suite 4 in GameShell.ia.test.ts):** 8 new tests for rail class binding, scrim active class, side-edge/scrim click events, and reactivity.

Commit: `d8fd874`

---

### Task 2 — PlayersPanel Color+Shape+Letter Token, Turn-Status Sentence, Seat Strip

**PlayersPanel.vue** fully rewritten:

- **8-shape clip-path set** (circle/square/hexagon/octagon/diamond/pentagon/shield/plus) from canonical mockup; seat index → shape
- **Player identity token**: `<span class="tok sh-*" :style="{ '--tc': player.color }"><span class="shape"></span><span class="ini">A</span></span>` — color via `--tc` CSS custom property (inline style; never hex in CSS)
- **Turn-status sentence** in standard mode: `isPlayerActive(seat)` → "Your move" (local) or "{name} is playing" (other); no "your turn" literal
- **`seatStrip` prop**: compact one-line mode showing all player tokens horizontally + active player's status sentence (`flex-direction:row`)
- **GameShell.vue** binds `:seat-strip="sidebarRail"` — rail mode auto-switches to seat strip
- **Breathe dot animation** on `turn-indicator-dot`; `@media (prefers-reduced-motion: reduce)` honored

Commit: `28cd550`

---

### Task 3 — GameHistory On-Demand Bottom Sheet for Phones

**GameHistory.vue** additions:

- `sheet?: boolean` prop (default `false`)
- In sheet mode: `isCollapsed` starts `true` (closed) regardless of prop — reuses existing toggle mechanism
- Sheet template: `.history-sheet-wrap` (absolute, bottom of parent `.stage`) + `.history-sheet-panel` (slide-up, `max-height: min(50dvh, 320px)`) + `.sheet-trigger` pill button
- Sidebar mode: unchanged — same `game-history` div with collapse pattern
- `pointer-events: none` on `.history-sheet-wrap` with `> * { pointer-events: auto }` so the board receives clicks when panel is closed

**GameShell.vue** changes:
- Sidebar history: `v-if="showHistory && !sidebarRail"` — hidden on compact/rail
- Sheet history inside `.stage`: `v-if="showHistory && sidebarRail" :sheet="true"` — shown on compact/rail
- Sheet is a sibling of `.sidebar`, `<main>`, and `.scrim` inside `.stage` — guaranteed to never cover `.actionbar`

Commit: `87de044`

---

## Test Results

```
src/ui/components/GameShell.ia.test.ts  30 tests passing (was 22; +8 for IA-06 rail/scrim)
src/ui/components/  132 tests passing (15 test files)
Full suite: 1049 tests passing (77 test files)
npm run lint:css: exit 0
```

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as written.

### Implementation Notes

1. **`historySheet` ref omitted**: The plan mentioned a `historySheet` ref as an alternative to driving sheet mode from `sidebarRail`. Since both are driven by the same compact trigger (sidebarRail = compact phone), a separate ref would be redundant. Used `sidebarRail` directly as the single source of truth (Pit of Success: one concept, one ref).

2. **`seatStrip` bound to `sidebarRail`** (not a separate computed): The seat strip exactly tracks rail mode — when the sidebar is a rail, the player list is also in strip mode. No separate breakpoint logic needed.

## Phase 103 Regression Surface

The following changed surfaces must be re-checked against all 9 games + MERC in Phase 103:

- **`GameShell.vue`**: Sidebar now has `clamp(220px, 22vw, 320px)` width and a rail collapse mode; rail mode hides PlayersPanel name rows via `:deep()` — any game relying on the sidebar width as a layout anchor may reflow
- **`PlayersPanel.vue`**: Player card layout changed from `flex` to CSS `grid` (38px + 1fr); token size is 38×38px (was no defined token); `player-card.current` border/background unchanged
- **`GameHistory.vue`**: In compact/rail mode, history is now a bottom-sheet inside `.stage` (not in `.side-scroll`); any game that targets `.sidebar-history` class may need updates; sheet `max-height: min(50dvh, 320px)` replaces the standing sidebar history
- **Rail mode test**: Verify player tokens are visible (not hidden) in rail mode; player name rows are hidden but tokens and the seat strip remain

## Known Stubs

None — all functionality is wired to real data (players, sidebarRail state, message array).

## Threat Flags

No new threat flags. Analysis:
- `sidebarRail` is a UI-only boolean ref; no data path changed
- `.scrim` click handler only sets `sidebarRail = true` — no data mutation
- `matchMedia` listener reads viewport size only; cleaned up in `onUnmounted`
- History sheet overlay positioned within `.stage` — cannot cover browser UI or `.actionbar`

## Self-Check: PASSED

Files modified:
- `src/ui/components/GameShell.vue` — FOUND
- `src/ui/components/GameShell.ia.test.ts` — FOUND
- `src/ui/components/PlayersPanel.vue` — FOUND
- `src/ui/components/GameHistory.vue` — FOUND

Commits:
- `d8fd874` — FOUND (Task 1: responsive tiers + rail + scrim)
- `28cd550` — FOUND (Task 2: PlayersPanel token + seat strip)
- `87de044` — FOUND (Task 3: GameHistory bottom sheet)
