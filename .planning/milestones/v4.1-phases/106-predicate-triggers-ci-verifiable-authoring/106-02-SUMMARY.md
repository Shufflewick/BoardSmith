---
phase: 106-predicate-triggers-ci-verifiable-authoring
plan: "02"
subsystem: engine/tutorial
tags: [tutorial, predicates, advanceWhen, tut-03]
dependency_graph:
  requires: [106-01]
  provides: [afterFirstTurn, afterTurns, whenForced, TUT-03-predicates]
  affects: [engine/tutorial/predicates.ts, engine/index.ts]
tech_stack:
  added: []
  patterns: [labeled-ObjectCondition, pure-predicate-factory, flow-state-inspection]
key_files:
  created:
    - src/engine/tutorial/predicates.ts
    - src/engine/tutorial/predicates.test.ts
  modified:
    - src/engine/index.ts
decisions:
  - "afterTurns derives from flow state: sum of loop iterations - 1 + 1 if learner has acted mid-round; documented assumption is learner acts first in each round (common tutorial pattern)"
  - "whenForced reuses getAvailableActions(player) — same source as action panel — for consistency"
  - "All three helpers produce labeled TutorialAdvanceCondition records; zero events/subscriptions/timers"
  - "Tutorial types (TutorialDefinition, TutorialStep, etc.) also added to the public engine surface alongside the helpers"
metrics:
  duration: "~20 minutes"
  completed: "2026-06-26"
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
  files_modified: 1
---

# Phase 106 Plan 02: Named-Predicate Helpers Summary

Named predicate helpers that compile to labeled `advanceWhen` conditions for tutorial step auto-advance, shipping `afterFirstTurn()`, `afterTurns(n)`, and `whenForced(actionName)`.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Named-predicate helpers + tests | 8a0a443 | predicates.ts, predicates.test.ts |
| 2 | Export from public engine surface | 2f76533 | src/engine/index.ts |

## What Was Built

**`src/engine/tutorial/predicates.ts`** — Three pure predicate factories, each returning a single-label `TutorialAdvanceCondition` (`Record<string, (ctx: TutorialGateContext) => boolean>`):

- **`afterFirstTurn()`**: Alias for `afterTurns(1)`. False at game start (proven no flash-skip), true after the learner's first completed action.

- **`afterTurns(n)`**: True after the learner has completed `n` turns. Derives turn count from `game.getFlowState().position`: sums all loop iteration counters (normalised by subtracting 1 for the initial round-start) and adds 1 if the current player is not the learner (mid-round contribution). Documented assumption: learner is the first player to act within each round (standard tutorial pattern).

- **`whenForced(actionName)`**: True when the named action is the sole available action for the learner's seat. Delegates to `game.getAvailableActions(player)` — the same source the action panel uses — ensuring tutorial state is consistent with actual game rules.

All helpers: zero events, subscriptions, or timers. Read-only game inspection only.

**`src/engine/tutorial/predicates.test.ts`** — 16 tests:
- `afterFirstTurn()` false at start, true after first action, remains true
- `afterTurns(2)` false at start, false after 1 turn, false after round 1 complete, true after 2 turns
- `afterTurns(n)` integration with `evaluateAdvanceWhen` from Plan 01: `fired=false` after 1 turn, `fired=true` after 2 turns
- `whenForced` false with multiple actions, true with sole named action, false with different sole action, false for non-existent seat
- Label-key correctness and safe object-spread composition

**`src/engine/index.ts`** — Exports `afterFirstTurn`, `afterTurns`, `whenForced` plus all tutorial types (`TutorialDefinition`, `TutorialStep`, `TutorialGateContext`, `TutorialAdvanceCondition`, etc.) from the public engine surface.

## Verification

- All 1421 tests pass (108 test files)
- eslint clean on all modified files
- Acceptance grep: `grep -rinE "addEventListener|emit\(|on\(.action|setTimeout|new EventTarget" src/engine/tutorial/predicates.ts` → no matches
- `grep -nE "afterTurns|predicates" src/engine/index.ts` → line 246 confirms export

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. The predicates read live game state; no hardcoded or placeholder values flow to any UI.

## Threat Flags

None — predicates.ts introduces no network endpoints, auth paths, file access, or schema changes.

## Self-Check: PASSED

- `src/engine/tutorial/predicates.ts` — exists ✓
- `src/engine/tutorial/predicates.test.ts` — exists ✓
- Commit 8a0a443 — exists ✓ (`git log --oneline | grep 8a0a443`)
- Commit 2f76533 — exists ✓ (`git log --oneline | grep 2f76533`)
