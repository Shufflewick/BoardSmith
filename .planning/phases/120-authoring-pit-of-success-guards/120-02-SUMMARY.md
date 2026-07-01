---
phase: 120-authoring-pit-of-success-guards
plan: 02
subsystem: engine
tags: [flow-engine, action-registry, static-analysis, devWarn, pit-of-success]

requires:
  - phase: 120-authoring-pit-of-success-guards
    provides: PIT-01/PIT-02 loop() maxIterations construction-time throw (prior plan in this phase)
provides:
  - "walkFlowNodes exhaustive FlowNode generator (src/engine/flow/walk-flow-nodes.ts)"
  - "Game#validateActionReachability() static check called from startFlow()"
  - "First game.test.ts in the tree (PIT-03 coverage)"
affects: [120-03, future-flow-authoring-guards]

tech-stack:
  added: []
  patterns:
    - "Static FlowNode-tree walk (generator) as a reusable primitive for author-time flow validation"
    - "Throw-on-missing / devWarn-on-unreachable disposition split for action reachability"

key-files:
  created:
    - src/engine/flow/walk-flow-nodes.ts
    - src/engine/flow/walk-flow-nodes.test.ts
    - src/engine/element/game.test.ts
  modified:
    - src/engine/element/game.ts

key-decisions:
  - "Bidirectional check (registered-but-unreferenced) is a devWarn, not a throw, per plan's locked design — actions may be legitimately invoked outside actionStep (follow-ups, other actions' .execute())"
  - "Function-valued ActionStepConfig.actions / SimultaneousActionStepConfig.actions are a documented static-walk blind spot, skipped entirely rather than invoked speculatively"
  - "Validation runs before FlowEngine construction (pure static walk, no engine state needed)"

requirements-completed: [PIT-03]

duration: 25min
completed: 2026-07-01
---

# Phase 120 Plan 02: Action Reachability Validation Summary

**Game#startFlow() now statically walks the flow tree and throws on any actionStep-referenced-but-unregistered action, with a non-throwing devWarn for the reverse (registered-but-unreachable) case.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 2 completed
- **Files modified:** 4 (1 modified, 3 created)

## Accomplishments
- New `walkFlowNodes` generator: exhaustive pre-order traversal over the 11-member `FlowNode` union, covering all 6 nesting shapes (sequence/array, loop-family/single-child, if/then-else, switch/cases+default, and the 3 leaf types).
- `Game#validateActionReachability()` private method, invoked inside `startFlow()` immediately before `new FlowEngine(...)`, enumerating every action name referenced by `action-step` / `simultaneous-action-step` nodes and cross-checking against the action registry.
- Throw path: unregistered-but-referenced action names produce an `Error` naming the action and pointing to `registerActions(...)`.
- Warn path: registered-but-unreferenced actions produce a `devWarn` (deduplicated by key, dev-mode gated) — never a throw.
- Function-valued `actions` fields (the polyhedral-potions dynamic-action pattern) are explicitly skipped by the static walk, with an inline comment documenting the blind spot.
- First `game.test.ts` in the tree, with `describe('PIT-03', ...)` covering all 4 required behaviors.

## Task Commits

Each task followed full RED → GREEN TDD gates:

1. **Task 1: walkFlowNodes generator**
   - `8b6179e` test(120-02): add failing tests for walkFlowNodes generator (RED)
   - `aaa9136` feat(120-02): add walkFlowNodes exhaustive flow-node generator (GREEN)
2. **Task 2: #validateActionReachability() + PIT-03 tests**
   - `a9a1f27` test(120-02): add failing PIT-03 action-reachability tests (RED)
   - `04ec337` feat(120-02): validate action reachability in startFlow (PIT-03) (GREEN)

## Files Created/Modified
- `src/engine/flow/walk-flow-nodes.ts` - Exported `walkFlowNodes` generator; exhaustive switch over `FlowNode.type`
- `src/engine/flow/walk-flow-nodes.test.ts` - 7 tests covering all nesting shapes + leaves
- `src/engine/element/game.ts` - Added `#validateActionReachability()`, called from `startFlow()` before `FlowEngine` construction; added `walkFlowNodes` and `devWarn` imports (the latter re-uses the existing `../../utils/dev.js` module, no new dependency)
- `src/engine/element/game.test.ts` - New file; `describe('PIT-03', ...)` with 4 tests (throw / devWarn / positive / function-valued blind spot)

## Decisions Made
- Positioned the validation call directly after the `if (!this._flowDefinition) throw` guard and before `new FlowEngine(...)`, matching the plan's locked interface (pure static walk needs no engine).
- Used a `Set<string>` for referenced-action names to naturally dedupe across multiple actionStep nodes referencing the same action.
- Left the pre-existing per-frame runtime warning at `src/engine/flow/engine.ts:1244-1260` completely untouched — confirmed via `git diff --stat src/engine/flow/engine.ts` (no changes) — since it is complementary (fires per visited frame with its own dedup Set) rather than redundant with the new author-time static check.

## Deviations from Plan

None - plan executed exactly as written. One test-construction adjustment (not a plan deviation, just a test-authoring correction caught during RED/GREEN iteration): the `FunctionValuedActionsGame` test fixture initially wrapped its `actionStep` in a `loop()`, which caused an unrelated "loop hit its maxIterations safety cap" error at runtime (because the function-valued `actions` resolves to an unregistered action, so every player's step auto-completes with zero available actions, spinning the loop with no `while` terminator). Switched that one test fixture to a bare `eachPlayer(...)` (single pass, no loop wrapper) so the test isolates the PIT-03 blind-spot assertion from this orthogonal loop-safety concern. No production code was affected by this — it was purely a test-fixture correction made during the RED phase before the GREEN commit.

## Issues Encountered
None beyond the test-fixture adjustment documented above.

## Next Phase Readiness
- Plan 120-03 (Wave 2) also touches `src/engine/element/game.ts` / `game.test.ts` and depends on this plan's completion. Edits here were localized to imports, the new `#validateActionReachability()` method block, and one line inside `startFlow()` — should merge cleanly.
- Full suite green: `npx vitest run` → 137 files, 1859 tests passed.

---
*Phase: 120-authoring-pit-of-success-guards*
*Completed: 2026-07-01*

## Self-Check: PASSED

All created files verified present on disk; all 4 task commit hashes (8b6179e, aaa9136, a9a1f27, 04ec337) verified present in git log.
