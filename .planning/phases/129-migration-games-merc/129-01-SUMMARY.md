---
phase: 129-migration-games-merc
plan: 01
subsystem: testing
tags: [cross-repo, migration, tsc, vitest, useFLIP, ChoiceBoardRefs, vite-env]

# Dependency graph
requires:
  - phase: 128-animation-drag-drop-test-story
    provides: ANIM-03 fail-loud missing-anchor dev throw (the reason hex needed an anchor-attribute fix)
provides:
  - hex's stone element now carries a useFLIP-recognized anchor attribute (data-element-id)
  - checkers, hex, polyhedral-potions, demo-complex-ui tsc --noEmit now clean (pre-existing debt closed)
  - Confirmed zero breakage-surface grep hits across all 5 non-flagship game repos
affects: [129-02, 129-03, milestone-verification]

# Tech tracking
tech-stack:
  added: []
  patterns: ["vite-env.d.ts ambient reference for games missing vite/client types", "ChoiceBoardRefs.refs[] array shape for boardRefs() callbacks (replaces legacy targetRef/sourceRef shorthand)"]

key-files:
  created:
    - ~/BoardSmithGames/hex/src/vite-env.d.ts
    - ~/BoardSmithGames/checkers/src/vite-env.d.ts
  modified:
    - ~/BoardSmithGames/hex/src/ui/components/HexBoard.vue
    - ~/BoardSmithGames/hex/.gitignore
    - ~/BoardSmithGames/checkers/src/rules/game.ts
    - ~/BoardSmithGames/checkers/src/rules/index.ts
    - ~/BoardSmithGames/polyhedral-potions/src/rules/actions.ts
    - ~/BoardSmithGames/demo-complex-ui/src/rules/actions.ts

key-decisions:
  - "hex: added data-element-id alongside (not replacing) data-stone-id — useElementChangeTracker's own [data-stone-id] selector must keep working"
  - "checkers: re-exported CheckersPlayer from game.ts (it was already exported from elements.ts, just never re-exported) rather than restructuring the class"
  - "polyhedral-potions/demo-complex-ui: converted legacy { targetRef } boardRefs() return shape to the current { refs: RefWithRole[] } shape — pre-v4.4 debt (predates Phase 94-01), not a v4.4 regression"

requirements-completed: [MIG-03]

# Metrics
duration: 25min
completed: 2026-07-02
---

# Phase 129 Plan 01: Non-Flagship Game Migration (hex, checkers, polyhedral-potions, demo-complex-ui, demo-action-panel) Summary

**Fixed hex's real v4.4 breakage-surface hit (missing useFLIP anchor attribute) plus pre-existing tsc debt in 4 of 5 non-flagship game repos; confirmed all 5 suites green and the scoped breakage-surface grep sweep is clean.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-07-02T18:20:00Z
- **Completed:** 2026-07-02T18:45:54Z
- **Tasks:** 3/3 completed
- **Files modified:** 8 (across 4 repos)

## Accomplishments
- hex's stone `<circle>` now carries `data-element-id` alongside `data-stone-id`, so `useFLIP.getElementId()` recognizes it and the ANIM-03 fail-loud dev throw no longer fires against real stones
- Closed all pre-existing `tsc --noEmit` debt in hex, checkers, polyhedral-potions, and demo-complex-ui (5 total tsc errors resolved, all type-only fixes, zero behavior changes)
- Verified demo-action-panel stays tsc-clean with no code change needed
- Confirmed zero disallowed breakage-surface grep hits (`headless-harness`, detached `ElementCollection.shuffle()`, `boardsmith`-imported `playUntilComplete`) across all 5 repos

## Task Commits

Each task was committed atomically in its own game repo (BoardSmith itself has no per-task commits — src/ was never touched):

1. **Task 1: Fix hex breakage-surface hit + tsc debt** - `hex@02b1ca5` (fix)
2. **Task 2: Close checkers tsc debt** - `checkers@4ce9ebd` (fix)
3. **Task 3: Close polyhedral-potions + demo-complex-ui tsc debt, verify demo-action-panel, scoped grep sweep** - `polyhedral-potions@485e8f9` (fix), `demo-complex-ui@86a7cc5` (fix)

**Plan metadata:** committed in BoardSmith (this SUMMARY.md + STATE.md + ROADMAP.md)

## Files Created/Modified
- `~/BoardSmithGames/hex/src/ui/components/HexBoard.vue` - stone circle now carries `data-element-id` alongside `data-stone-id`
- `~/BoardSmithGames/hex/src/vite-env.d.ts` - new, vite/client ambient types
- `~/BoardSmithGames/hex/.gitignore` - added `.boardsmith/` (generated runtime-bundle cache, was untracked)
- `~/BoardSmithGames/checkers/src/rules/game.ts` - re-exports `CheckersPlayer` so tutorial.ts's import resolves
- `~/BoardSmithGames/checkers/src/rules/index.ts` - explicit `BotMove` type on `hintTargetFromMove`'s `move` param
- `~/BoardSmithGames/checkers/src/vite-env.d.ts` - new, vite/client ambient types
- `~/BoardSmithGames/polyhedral-potions/src/rules/actions.ts` - `boardRefs()` returns current `{ refs: RefWithRole[] }` shape
- `~/BoardSmithGames/demo-complex-ui/src/rules/actions.ts` - `boardRefs()` (trade + gift actions) returns current `{ refs: RefWithRole[] }` shape

## Decisions Made
- hex: additive fix only (`data-element-id` alongside `data-stone-id`), per 129-CONTEXT.md amendment and RESEARCH Pitfall 1 — never remove the attribute `useElementChangeTracker` depends on.
- checkers: `CheckersPlayer` was already `export`ed from its true declaration site (`elements.ts`) — the missing piece was a re-export from `game.ts`, which tutorial.ts imports from. Added `export { CheckersPlayer };` rather than moving the declaration.
- polyhedral-potions / demo-complex-ui: `ChoiceBoardRefs.refs` has been required since Phase 94-01 (pre-v4.4); both games' `boardRefs()` callbacks still used a legacy `{ targetRef }` shorthand shape. Converted to `{ refs: [{ ref, role: 'target' }] }` — matches `RefWithRole`/`ChoiceBoardRefs` exactly, no gameplay change.
- No BoardSmith `src/` gap was found — all 3 game-side fixes were legitimately owned by the game repos (markup + pre-existing type debt), so no bug-fix request was filed.

## Deviations from Plan

None - plan executed exactly as written. All three tasks matched their acceptance criteria without requiring architectural changes or BoardSmith `src/` fixes.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
Plans 129-02 (flagship new-test adoption: go-fish, cribbage, demo-animation) and 129-03 (MERC re-vendor) are unblocked and can proceed independently — this plan touched no shared BoardSmith `src/` code, so no dependency chain into either.

---
*Phase: 129-migration-games-merc*
*Completed: 2026-07-02*

## Self-Check: PASSED

All created files verified to exist; all game-repo commit hashes verified present in each repo's git log.
