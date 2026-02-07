---
phase: 83-ui-composables
plan: 01
subsystem: ui
tags: [vue, websocket, composables, animation, theatre-view]

# Dependency graph
requires:
  - phase: 82-session-integration
    provides: "Theatre view as default in buildPlayerState, acknowledgeAnimations server handler"
provides:
  - "Client SDK acknowledgeAnimations WebSocket transport"
  - "useGame() acknowledgeAnimations method"
  - "useCurrentView() composable for truth opt-in"
  - "Per-event animation acknowledge in processQueue"
affects: [83-02 GameShell wiring, 83-03 ActionPanel theatre rendering, 84 integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-event acknowledge: theatre state advances one step per acknowledged animation event"
    - "useCurrentView() provide/inject: explicit truth opt-in with actionable error on misuse"

key-files:
  created:
    - "src/ui/composables/useCurrentView.ts"
  modified:
    - "src/client/types.ts"
    - "src/client/game-connection.ts"
    - "src/client/vue.ts"
    - "src/ui/composables/useAnimationEvents.ts"
    - "src/ui/index.ts"

key-decisions:
  - "Per-event acknowledge inside processQueue while loop (not batch at end)"
  - "useCurrentView uses string injection key 'currentGameView' (not Symbol) for GameShell provide compatibility"
  - "Record<string, unknown> type for view (matches loosely-typed gameView pattern)"

patterns-established:
  - "Per-event acknowledge: acknowledge(event.id) called after each event handler completes, inside the while loop"
  - "Truth opt-in composable: useCurrentView() with CURRENT_VIEW_KEY injection"

# Metrics
duration: 2min
completed: 2026-02-07
---

# Phase 83 Plan 01: Client SDK and Composable Foundations Summary

**Client SDK acknowledgeAnimations transport, useCurrentView truth opt-in composable, and per-event animation acknowledge**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-07T16:43:12Z
- **Completed:** 2026-02-07T16:45:14Z
- **Tasks:** 2/2
- **Files modified:** 6

## Accomplishments
- Client SDK can send acknowledgeAnimations messages with upToId over WebSocket (types, GameConnection, useGame)
- useCurrentView() composable created with provide/inject for truth opt-in and actionable error on misuse
- Animation event processQueue changed from batch acknowledge to per-event acknowledge for incremental theatre advancement
- All 29 existing animation events tests pass without modification

## Task Commits

Each task was committed atomically:

1. **Task 1: Add acknowledgeAnimations to client SDK** - `83790fb` (feat)
2. **Task 2: Create useCurrentView composable and per-event acknowledge** - `d2da6f2` (feat)

## Files Created/Modified
- `src/client/types.ts` - Added 'acknowledgeAnimations' to WebSocketOutgoingMessage type union with upToId field
- `src/client/game-connection.ts` - Added acknowledgeAnimations(upToId) method to GameConnection class
- `src/client/vue.ts` - Exposed acknowledgeAnimations through UseGameReturn interface and useGame() function
- `src/ui/composables/useCurrentView.ts` - New composable for truth opt-in with CURRENT_VIEW_KEY injection
- `src/ui/composables/useAnimationEvents.ts` - Changed processQueue to per-event acknowledge (removed batch post-loop)
- `src/ui/index.ts` - Added useCurrentView and CURRENT_VIEW_KEY exports

## Decisions Made
- Per-event acknowledge inside the while loop (not batch at end) -- this matches the prior "per-event advancement" decision from Phase 80 and ensures theatre state advances incrementally as each animation plays
- String injection key 'currentGameView' (not Symbol) for useCurrentView -- matches the string-based provide pattern GameShell will use
- Record<string, unknown> view type -- matches the loosely-typed pattern used by existing gameView inject

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Client SDK has acknowledgeAnimations transport ready for GameShell to wire via createAnimationEvents
- useCurrentView composable ready for GameShell to provide and components to consume
- Per-event acknowledge ensures theatre state advances incrementally when Plan 02 wires createAnimationEvents in GameShell
- Plan 02 (GameShell wiring) can now proceed: wire createAnimationEvents with acknowledge callback, provide currentGameView, pass animationEvents to useActionController

---
*Phase: 83-ui-composables*
*Completed: 2026-02-07*
