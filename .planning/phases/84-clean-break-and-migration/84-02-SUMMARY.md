---
phase: 84-clean-break-and-migration
plan: 02
subsystem: games
tags: [animation, migration, demo-animation, cribbage, browser-verification]

# Dependency graph
requires:
  - phase: 84-clean-break-and-migration
    plan: 01
    provides: "game.animate() as sole animation API (emitAnimationEvent removed)"
provides:
  - "Demo-animation game using game.animate() with working toast animation"
  - "Cribbage game using game.animate() with scoring/pegging animations"
  - "Both games compile cleanly and animate correctly in browser"
affects:
  - 84-03 (documentation references these games as examples)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "useAnimationEvents() injection for custom UI components (not createAnimationEvents)"
    - "game.animate() with empty callback for pure UI signals"
    - "game.animate() with mutation callbacks for scoring animations"

key-files:
  created: []
  modified:
    - "~/BoardSmithGames/demo-animation/src/rules/actions.ts"
    - "~/BoardSmithGames/demo-animation/src/ui/components/GameTable.vue"
    - "~/BoardSmithGames/cribbage/src/rules/game.ts"
    - "~/BoardSmithGames/CLAUDE.md"
    - "~/BoardSmithGames/.planning/codebase/ARCHITECTURE.md"

key-decisions:
  - "Custom UI components must use useAnimationEvents() injection from GameShell, not createAnimationEvents() with local state"
  - "Empty callbacks for pure UI signals (demo-animation), mutation callbacks for state changes (cribbage)"

patterns-established:
  - "useAnimationEvents() is the correct pattern for custom UI animation event handling"

# Metrics
duration: 8min
completed: 2026-02-07
---

# Phase 84 Plan 02: Game Migration Summary

**Migrated demo-animation and cribbage games from emitAnimationEvent() to game.animate(), verified animations play correctly in browser**

## Performance

- **Duration:** 8 min (including browser verification)
- **Completed:** 2026-02-07
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Migrated demo-animation's `createAnimationEventAction` from `emitAnimationEvent()` to `game.animate()` with empty callback (pure UI signal)
- Migrated cribbage's 9 call sites across 3 scoring sections to wrap `addPoints()` inside `game.animate()` callbacks
- Fixed demo-animation GameTable.vue to use `useAnimationEvents()` injection instead of creating a broken local `createAnimationEvents` instance
- Updated BoardSmithGames CLAUDE.md and ARCHITECTURE.md to reference `game.animate()`
- Browser-verified: cribbage scoring animations work, demo-animation toast appears correctly

## Task Commits

1. **Task 1: Migrate demo-animation and cribbage** - `72a42d9` (feat + docs)
2. **Task 2: Browser verification** - Human-verified (approved)

## Files Created/Modified
- `~/BoardSmithGames/demo-animation/src/rules/actions.ts` - Replaced emitAnimationEvent with game.animate() + empty callback
- `~/BoardSmithGames/demo-animation/src/ui/components/GameTable.vue` - Fixed to use useAnimationEvents() injection from GameShell instead of local createAnimationEvents
- `~/BoardSmithGames/cribbage/src/rules/game.ts` - 9 emitAnimationEvent calls → game.animate() with addPoints in callbacks
- `~/BoardSmithGames/CLAUDE.md` - Updated animation API references
- `~/BoardSmithGames/.planning/codebase/ARCHITECTURE.md` - Updated animation cross-cutting concern

## Decisions Made
- **useAnimationEvents() over createAnimationEvents():** Custom UI components in GameTable must inject the animation events instance provided by GameShell (via `useAnimationEvents()`) rather than creating their own `createAnimationEvents()`. GameShell's instance has the correct server-side acknowledge wiring; a local instance reads from `gameView.animationEvents` which doesn't exist in the theatre view system (events are on `state.animationEvents`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] GameTable.vue reading events from wrong location**
- **Found during:** Browser verification (Task 2)
- **Issue:** `createAnimationEvents({ events: () => props.gameView?.animationEvents })` returned undefined because animation events live on `state.animationEvents`, not `gameView.animationEvents` in the theatre view system
- **Fix:** Replaced with `useAnimationEvents()` injection from GameShell which reads from the correct location
- **Files modified:** ~/BoardSmithGames/demo-animation/src/ui/components/GameTable.vue
- **Verification:** Toast now appears correctly when Animation Event button is clicked

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Fixed a critical integration bug in the demo game's custom UI component.

## Issues Encountered
None remaining after fix.

## User Setup Required
None.

## Next Phase Readiness
- Both example games demonstrate game.animate() as the current API
- Documentation plan (84-03) already complete
- Ready for phase verification

---
*Phase: 84-clean-break-and-migration*
*Completed: 2026-02-07*
