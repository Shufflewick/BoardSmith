---
phase: 101-accessibility-wcag-wave-4
plan: "07"
subsystem: ui
tags: [accessibility, a11y, legend, players-panel, aria-current, reduced-motion, shapes]
dependency_graph:
  requires: [101-01]
  provides: [BoardLegend.vue, aria-current on active seat, reduced-motion static border]
  affects: [AutoUI.vue, PlayersPanel.vue]
tech_stack:
  added: []
  patterns: [aria-current on listitem, clip-path shape identity, prefers-reduced-motion static border, CSS-only legend swatches]
key_files:
  created:
    - src/ui/components/auto-ui/BoardLegend.vue
  modified:
    - src/ui/components/auto-ui/AutoUI.vue
    - src/ui/components/PlayersPanel.vue
decisions:
  - "aria-current='true' used on active player's listitem — most appropriate value for 'whose turn is it now'"
  - "BoardLegend positioned absolute bottom-left within .auto-ui (position:relative added)"
  - "5 legend states: selectable/selected/drop-target/disabled/active-player (matches plan spec, extends mockup's 4-state list)"
  - "Brought full IA-06 PlayersPanel into worktree to unblock shape-identity requirement (base was missing plan 100-05 commit)"
metrics:
  duration: "15 minutes"
  completed: "2026-06-23"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 3
---

# Phase 101 Plan 07: BoardLegend + PlayersPanel A11Y Summary

**One-liner:** BoardLegend component naming 5 interaction states with CSS-mirroring swatches, mounted in AutoUI; PlayersPanel gains clip-path shape identity, aria-current on active seat, and a static accent border under reduced-motion.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Create BoardLegend.vue + mount in AutoUI | e8cd80a | `BoardLegend.vue` (new), `AutoUI.vue` |
| 2 | PlayersPanel shape identity + aria-current + reduced-motion border | bfd921e | `PlayersPanel.vue` |

## What Was Built

### Task 1: BoardLegend.vue

New presentational component at `src/ui/components/auto-ui/BoardLegend.vue` listing five board interaction states. Each row pairs a 16×16 swatch (whose CSS rules are drawn directly from the renderer state classes — dashed outline, solid outline, dotted+hatched, striped/faded, accent ring+dot) with a bold label and non-color description text.

Mounted as `<BoardLegend />` in AutoUI.vue absolutely positioned at bottom-left within `.auto-ui` (which gained `position: relative`). The `pointer-events: none` rule ensures it never blocks board interaction.

### Task 2: PlayersPanel A11Y additions

- **Shape identity (A11Y-05):** Full IA-06 PlayersPanel brought into the worktree (plan 100-05 commit `28cd550` was present on main but missing from this worktree's base). Eight distinct clip-path shapes (circle/square/hexagon/octagon/diamond/pentagon/shield/plus) assigned by seat index. Same letter + different shape resolves the Sam/Sally same-initial collision.
- **aria-current (A11Y-04):** `:aria-current="isPlayerActive(player.seat) ? 'true' : undefined"` on the active player's `role="listitem"` div so screen readers announce whose turn it is.
- **Reduced-motion border (A11Y-08):** The existing `@media (prefers-reduced-motion: reduce)` block now also sets `border: 2px solid var(--bsg-accent)` on `.player-card.current`. Previously only `animation: none` was applied, causing the turn cue to vanish under reduced-motion preference.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Pre-existing hex color violations in AutoUI.vue**
- **Found during:** Task 1 (running lint on file I was modifying)
- **Issue:** `.game-complete h2` gradient used `#00d9ff` and `#00ff88` hex literals, failing `color-no-hex` stylelint rule
- **Fix:** Replaced with `var(--bsg-accent-2)` and `var(--bsg-accent)` tokens
- **Files modified:** `src/ui/components/auto-ui/AutoUI.vue`
- **Commit:** e8cd80a

**2. [Rule 1 - Bug] Pre-existing hex violations + missing IA-06 work in PlayersPanel.vue**
- **Found during:** Task 2 setup
- **Issue:** Worktree had the old PlayersPanel (pre-phase-100) with hex literals `#00d9ff`/`#00ff88`. The plan's shape-identity work (100-05, commit `28cd550`) was on main but not in this worktree's base. Without the IA-06 shapes, the shape-distinctiveness requirement couldn't be met.
- **Fix:** Replaced worktree PlayersPanel with the IA-06 version from main checkout, then applied the A11Y-04/A11Y-08 additions on top. Hex literals replaced with `var(--bsg-accent)`, `var(--bsg-accent-2)`.
- **Files modified:** `src/ui/components/PlayersPanel.vue`
- **Commit:** bfd921e

### Pre-existing Test Failure (Out of Scope)

`src/ui/composables/useActionController.test.ts:1643` has a pre-existing failure (`endTurn` vs `collectEquipment` assertion). This is unrelated to Plan 07 changes and was already failing in the worktree. Logged for the merge orchestrator.

## Verification

```
grep -c "BoardLegend" src/ui/components/auto-ui/AutoUI.vue
# → 2 (import + usage)

grep -c "aria-current" src/ui/components/PlayersPanel.vue
# → 2 (template binding)

grep -c "clip-path" src/ui/components/PlayersPanel.vue
# → 10 (8 shape definitions + 2 clip-path: circle references)

# No hex literals in BoardLegend.vue:
grep -cE "#[0-9a-fA-F]{3,6}" src/ui/components/auto-ui/BoardLegend.vue
# → 0

# CSS lint — all 3 modified files pass color-no-hex
npx stylelint "src/ui/components/auto-ui/BoardLegend.vue" "src/ui/components/auto-ui/AutoUI.vue" "src/ui/components/PlayersPanel.vue"
# → clean (exit 0)
```

## Known Stubs

None — all functionality is fully wired. The legend swatches mirror the actual renderer CSS tokens; the aria-current binding uses the live `isPlayerActive()` function; the reduced-motion border fires via a real `@media` query.

## Threat Flags

None — these changes are purely HTML/CSS accessibility additions with no new network surface, auth paths, or data exposure.

## Self-Check: PASSED

- [x] `src/ui/components/auto-ui/BoardLegend.vue` exists (27+ lines, 5 states, all var tokens)
- [x] `src/ui/components/auto-ui/AutoUI.vue` contains 2 occurrences of "BoardLegend" (import + mount)
- [x] `src/ui/components/PlayersPanel.vue` contains aria-current and clip-path and border:2px solid var(--bsg-accent) inside @media reduced-motion
- [x] Commits e8cd80a and bfd921e exist in git log
- [x] CSS lint clean on all 3 files
