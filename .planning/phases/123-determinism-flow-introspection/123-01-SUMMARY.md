---
phase: 123-determinism-flow-introspection
plan: 01
subsystem: engine
tags: [typescript, flow-engine, introspection, debug]

# Dependency graph
requires: []
provides:
  - "describeFlowPosition(root, position, flowState) — path-following flow-node walker producing a structured FlowDebugInfo"
  - "FlowDebugInfo interface (phase, step, path, awaiting, describe()) in src/engine/flow/types.ts"
  - "Game.getFlowDebugInfo() facade method — peer of debugActionAvailability()/getFlowState()"
affects: [123-02, 123-03, 123-04, testing, dev-host-devtools-bridge]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Path-following flow-node walker mirrors FlowEngine.getChildNode()'s switch(node.type) child-selection rules exactly, so a FlowPosition.path resolves to the same node the engine itself would navigate to"
    - "Facade-method pattern: gather raw data (flow definition root + FlowState) then delegate to a dedicated formatter, mirroring debugActionAvailability()"

key-files:
  created:
    - src/engine/flow/describe-flow-position.ts
    - src/engine/flow/describe-flow-position.test.ts
  modified:
    - src/engine/flow/types.ts
    - src/engine/element/game.ts

key-decisions:
  - "phase field reads FlowState.currentPhase directly — never re-derived from the path, matching the engine's own phase-entry/exit bookkeeping (Pitfall 1 from research)"
  - "step field falls back to the deepest node's type string when config.name is absent, never emits the literal string 'undefined' (Pitfall 2 from research)"
  - "Out-of-range/invalid path segments degrade gracefully — walkPath stops at the deepest reachable node instead of throwing"
  - "getFlowDebugInfo() with no active flow returns a well-formed FlowDebugInfo (describe() = 'no active flow') rather than throwing or returning undefined"

patterns-established:
  - "Path-following walker pattern: reuse the exact switch(node.type)/exhaustiveness-guard shape from walk-flow-nodes.ts and FlowEngine.getChildNode() for any future path-indexed tree operation"

requirements-completed: [FLOW-01]

# Metrics
duration: 12min
completed: 2026-07-01
---

# Phase 123 Plan 01: Flow-Position Debug Primitive Summary

**New `describeFlowPosition()` path-following flow-node walker + `FlowDebugInfo` type + `Game.getFlowDebugInfo()` facade, giving developers a structured and human-readable "where in the flow are we" dump that every later layer (TestGame, GameStuckError, devtools bridge) will reuse.**

## Performance

- **Duration:** ~12 min
- **Completed:** 2026-07-01T21:55:00Z
- **Tasks:** 2 completed
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments
- `describeFlowPosition(root, position, flowState)` walks a `FlowNode` tree following `FlowPosition.path`, using the identical child-selection switch structure as `FlowEngine.getChildNode()` so results match the engine's own navigation exactly (including `switch` case ordering via `Object.values(config.cases)`).
- `FlowDebugInfo` interface added to `flow/types.ts` with `phase?`, `step?`, `path`, `awaiting`, and `describe(): string`.
- `Game.getFlowDebugInfo()` added as a peer of `debugActionAvailability()`/`getFlowState()`, delegating entirely to `describeFlowPosition()` — no tree-walking logic duplicated in `game.ts`.
- 5 new unit tests covering named step, unnamed-node type-fallback, nested loop/each-player traversal, out-of-range path graceful degradation, and `describe()` formatting with/without an awaited seat.

## Task Commits

Each task was committed atomically:

1. **Task 1: Path-following flow-position walker + FlowDebugInfo type** - `c14bd5d` (feat)
2. **Task 2: Game.getFlowDebugInfo() facade method** - `b773b51` (feat)

## Files Created/Modified
- `src/engine/flow/describe-flow-position.ts` - `describeFlowPosition()` walker + `formatDescribe()` one-liner formatter
- `src/engine/flow/describe-flow-position.test.ts` - 5 tests (named/unnamed/nested/out-of-range/no-awaiting)
- `src/engine/flow/types.ts` - `FlowDebugInfo` interface added (doc-comment style matches sibling `FlowPosition`)
- `src/engine/element/game.ts` - `getFlowDebugInfo()` method added adjacent to `getFlowState()`; imports for `FlowDebugInfo` type and `describeFlowPosition` function added

## Decisions Made
- Followed the plan exactly: `phase` sourced from `FlowState.currentPhase` (not re-derived), `step` falls back to `node.type`, `switch` node child resolution uses `Object.values(config.cases)[idx] ?? config.default` to match `FlowEngine.getChildNode()`'s exact ordering convention.
- No active flow → `getFlowDebugInfo()` returns a well-formed sentinel `FlowDebugInfo` (`describe()` returns `"no active flow"`) rather than `undefined`, per the plan's "never throw, never return undefined" requirement.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `describeFlowPosition()` + `FlowDebugInfo` + `Game.getFlowDebugInfo()` are the single source of truth for flow-position introspection; ready to be reused by TestGame passthrough, `GameStuckError`/`assertActionAvailable` message embedding, and the `__BOARDSMITH_DEVTOOLS` bridge in subsequent 123-xx plans.
- All new/touched flow tests green (`src/engine/flow` — 97 tests passing); no new tsc errors introduced in `game.ts` or the new flow files (pre-existing unrelated tsc errors elsewhere in the repo are out of scope for this plan).

## Self-Check: PASSED

All created files and task commit hashes verified present.

---
*Phase: 123-determinism-flow-introspection*
*Completed: 2026-07-01*
