---
phase: 82-session-integration
plan: 01
subsystem: engine
tags: [theatre-state, visibility, player-view, element-json, id-lookup]

# Dependency graph
requires:
  - phase: 81
    provides: "Theatre state engine with _theatreSnapshot, theatreState getter, acknowledgeAnimationEvents"
provides:
  - "Game.theatreStateForPlayer() -- per-player visibility-filtered theatre snapshot"
affects: [82-02, 83-ui-composables]

# Tech tracking
tech-stack:
  added: []
  patterns: ["ID-based visibility filtering (element lookup by ID instead of parallel tree traversal)"]

key-files:
  created: []
  modified:
    - "src/engine/element/game.ts"
    - "src/engine/element/theatre-state.test.ts"

key-decisions:
  - "getElementById() over atId() for element lookup -- checks both main tree and pile for removed elements"
  - "structuredClone for deep copy -- avoids mutation of shared theatre snapshot during filtering"
  - "Theatre childCount uses json.children?.length (theatre count) not element._t.children.length (truth count)"

patterns-established:
  - "ID-based JSON filtering: look up live element by ID to apply visibility rules to any JSON tree"

# Metrics
duration: 2min
completed: 2026-02-07
---

# Phase 82 Plan 01: theatreStateForPlayer() Summary

**ID-based visibility filtering for theatre snapshots -- Game.theatreStateForPlayer() resolves live element visibility via getElementById() and applies hidden/count-only/owner-only rules to the theatre JSON tree**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-07T16:14:49Z
- **Completed:** 2026-02-07T16:17:21Z
- **Tasks:** 2/2
- **Files modified:** 2

## Accomplishments

- Added `Game.theatreStateForPlayer(player)` method that returns visibility-filtered theatre snapshot
- Falls through to `toJSONForPlayer()` when no animations pending (zero overhead for non-animated games)
- ID-based element lookup (`getElementById`) avoids parallel tree traversal that breaks when theatre/truth positions differ
- 10 new unit tests covering all visibility modes (hidden, count-only, owner-only, visible), playerView, spectator view, pile edge case, and no-mutation guarantee

## Task Commits

Each task was committed atomically:

1. **Task 1: Add theatreStateForPlayer() method to Game class** - `0d4bad0` (feat)
2. **Task 2: Write unit tests for theatreStateForPlayer()** - `d61cba6` (test)

## Files Created/Modified

- `src/engine/element/game.ts` - Added `theatreStateForPlayer()` method (~149 lines) after `theatreState` getter
- `src/engine/element/theatre-state.test.ts` - Added `describe('theatreStateForPlayer()')` block with 10 tests (~283 lines)

## Decisions Made

- **`getElementById()` over `atId()`:** `getElementById` checks both the main element tree AND the pile, which correctly handles elements that were removed in truth (moved to pile) but still exist in the theatre snapshot.
- **`structuredClone` for snapshot cloning:** Deep clone before filtering prevents mutation of the shared `_theatreSnapshot` used by all players. Verified by dedicated test.
- **Theatre `childCount` uses `json.children?.length`:** For count-only zones, the child count comes from the theatre snapshot's children (not truth's `element._t.children.length`), because theatre may have different element positions than truth.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `theatreStateForPlayer()` is ready for Phase 82-02 to wire into `buildPlayerState()` in the session layer
- Method signature matches what the research doc specified for session integration
- All visibility modes tested and working

---
*Phase: 82-session-integration*
*Completed: 2026-02-07*
