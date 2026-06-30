---
phase: 85-theatre-erasure
plan: 03
subsystem: client, ui
tags: [websocket, vue, composables, theatre-removal]

# Dependency graph
requires:
  - phase: 85-01
    provides: Engine theatre code removed (Game class clean of theatre methods)
provides:
  - Client SDK without acknowledgeAnimations method or currentView type
  - GameShell without theatre wiring (no-op acknowledge, no CURRENT_VIEW_KEY)
  - useCurrentView composable and CURRENT_VIEW_KEY deleted
  - UI exports cleaned of theatre-related items
affects: [Phase 89 UI Integration, Phase 87 Session Simplification]

# Tech tracking
tech-stack:
  added: []
  patterns: [no-op acknowledge callback as bridge to Phase 89 cleanup]

key-files:
  created: []
  modified:
    - src/client/game-connection.ts
    - src/client/types.ts
    - src/client/vue.ts
    - src/ui/components/GameShell.vue
    - src/ui/index.ts
  deleted:
    - src/ui/composables/useCurrentView.ts
    - src/ui/composables/useCurrentView.test.ts

key-decisions:
  - "No-op acknowledge callback preserved in createAnimationEvents call -- Phase 89 removes the parameter entirely"

patterns-established: []

# Metrics
duration: 2min
completed: 2026-02-07
---

# Phase 85 Plan 03: Client + UI Theatre Erasure Summary

**Removed acknowledgeAnimations from client SDK and GameShell, deleted useCurrentView composable, cleaned UI exports**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-07T23:57:47Z
- **Completed:** 2026-02-07T23:59:52Z
- **Tasks:** 2
- **Files modified:** 5 (+ 2 deleted)

## Accomplishments
- Stripped all acknowledge protocol from client SDK (GameConnection, types, Vue composable)
- Removed currentView field from PlayerState interface
- Cleaned GameShell of theatre wiring: no acknowledgeAnimations destructure, no CURRENT_VIEW_KEY provide, no currentGameView computed
- Deleted useCurrentView composable and its test file (dead code)
- Cleaned UI exports of useCurrentView and CURRENT_VIEW_KEY
- All 120 UI tests pass, zero TypeScript errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Strip client SDK of acknowledge protocol** - `cb1b15d` (feat)
2. **Task 2: Clean GameShell, delete useCurrentView, update UI exports** - `1e91857` (feat)

## Files Created/Modified
- `src/client/game-connection.ts` - Removed acknowledgeAnimations method
- `src/client/types.ts` - Removed currentView from PlayerState, acknowledgeAnimations from WebSocketOutgoingMessage
- `src/client/vue.ts` - Removed acknowledgeAnimations from UseGameReturn interface, implementation, and return
- `src/ui/components/GameShell.vue` - Removed acknowledge destructure, CURRENT_VIEW_KEY import/provide, currentGameView computed; no-op acknowledge callback
- `src/ui/index.ts` - Removed useCurrentView and CURRENT_VIEW_KEY exports
- `src/ui/composables/useCurrentView.ts` - DELETED
- `src/ui/composables/useCurrentView.test.ts` - DELETED

## Decisions Made
- Kept acknowledge parameter in createAnimationEvents call as no-op `() => {}` rather than removing it -- Phase 89 owns the cleanup of the createAnimationEvents composable itself

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Client and UI layers are fully clean of theatre references
- Plans 02 and 03 ran in parallel (both depend only on 01) -- session/server and client/UI erasure are both complete
- Ready for 85-04 (BREAKING.md creation and full verification)

---
*Phase: 85-theatre-erasure*
*Completed: 2026-02-07*
