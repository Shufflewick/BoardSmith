---
phase: 106-predicate-triggers-ci-verifiable-authoring
plan: "04"
subsystem: testing
tags: [tutorial, dsl, ci, authoring, testing]
dependency_graph:
  requires: [106-01]
  provides: [TUT-04]
  affects: [boardsmith/testing barrel]
tech_stack:
  added: []
  patterns:
    - "simulateTutorial driver reuses engine autoAdvanceTutorial + getTutorialDisabledActions (single source of truth)"
    - "assertTutorialStep/assertTutorialCompletes follow existing assertions.ts throw-with-actionable-message style"
    - "TDD: test file written first (RED), implementation second (GREEN)"
key_files:
  created:
    - src/testing/simulate-tutorial.ts
    - src/testing/tutorial-assertions.ts
    - src/testing/simulate-tutorial.test.ts
  modified:
    - src/testing/index.ts
decisions:
  - "Use playerCount:1 in tutorial tests — eachPlayer rotates seats in multi-player games, so the tutorial seat loses its turn after acting; single-player keeps the learner as the always-active seat"
  - "seed option in SimulateTutorialOptions is informational (documents caller intent); reproducibility requires creating TestGame with the seed — caller-seeded TestGame wins"
  - "stepsVisited uses deduplication (visit-order, each step at most once) — tutorials are forward-only so duplicates indicate a bug"
  - "assertTutorialStep result overload uses finalStepId (primary seat only); seat param accepted for API consistency but ignored"
metrics:
  duration: "~5 minutes"
  completed: "2026-06-26"
  tasks_completed: 2
  files_created: 3
  files_modified: 1
---

# Phase 106 Plan 04: CI-Verifiable Tutorial Authoring DSL Summary

`simulateTutorial(testGame, def, { seat, scenario, seed })` runs a scripted tutorial
scenario through a TestGame, failing fast on gate drift, predicate drift, and
non-completion via the engine's own pump and gate helpers.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 RED | Failing tests for simulateTutorial DSL | f4e241a | src/testing/simulate-tutorial.test.ts |
| 1 GREEN | simulateTutorial driver + tutorial assertions | b1b8094 | src/testing/simulate-tutorial.ts, src/testing/tutorial-assertions.ts |
| 2 | Public exports for boardsmith/testing | 5f191ef | src/testing/index.ts |

## What Was Built

**`src/testing/simulate-tutorial.ts`** — the driver. Attaches a TutorialDefinition to a
TestGame, initializes progress, runs an initial autoAdvanceTutorial pump (start-time parity
with the server), then for each scripted move:
1. Gate-legality check via `getTutorialDisabledActions` — throws on drift naming the step id and disabled reason.
2. `doAction` — throws on failure with the step context.
3. `autoAdvanceTutorial` for all running-tutorial seats — mirrors server post-action hook.
4. `expectStep` assertion — throws "expected advance ... did not fire" on predicate drift.

Returns `{ completed, finalStepId, stepsVisited }`.

**`src/testing/tutorial-assertions.ts`** — two assertion helpers:
- `assertTutorialStep(testGame|result, seat, stepId)` — TestGame overload reads live progress; result overload checks finalStepId.
- `assertTutorialCompletes(result)` — throws with actionable message listing steps visited when `result.completed === false`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Action execute callback parameter order**
- **Found during:** Task 1 GREEN (first test run)
- **Issue:** Test's action execute was written as `(ctx) => ctx.game.moveCount++` but the correct signature is `(args, ctx)` — `ctx` is the second parameter.
- **Fix:** Changed to `(_args, ctx) => (ctx.game as TutSimGame).moveCount++`
- **Files modified:** src/testing/simulate-tutorial.test.ts
- **Commit:** b1b8094

**2. [Rule 1 - Bug] Multi-player turn rotation breaks tutorial scenario**
- **Found during:** Task 1 GREEN (second test run after fixing execute bug)
- **Issue:** Tests used `playerCount: 2` but `eachPlayer` rotates between seats. After seat 1 acts on step-1, the flow gives the turn to seat 2. Seat 2 must act before seat 1 gets its turn back. Tutorial scenarios that script only seat 1 fail with "Not Player 1's turn."
- **Fix:** Changed all tests to `playerCount: 1` — tutorial tests are single-learner by nature; the learner always holds the active seat.
- **Files modified:** src/testing/simulate-tutorial.test.ts
- **Commit:** b1b8094

## Verification

- `grep -n "export function simulateTutorial" src/testing/simulate-tutorial.ts` — line 163 ✓
- `grep -nE "export function (assertTutorialStep|assertTutorialCompletes)" src/testing/tutorial-assertions.ts` — lines 46, 93 ✓
- `grep -n "getTutorialDisabledActions" src/testing/simulate-tutorial.ts` — line 207 ✓
- `grep -nE "autoAdvanceTutorial" src/testing/simulate-tutorial.ts` — lines 14, 198, 232 ✓
- `npx vitest run src/testing` — 17/17 green ✓
- `npx vitest run` — 1444/1444 green ✓

## Self-Check: PASSED

Files created:
- /Users/jtsmith/BoardSmith/src/testing/simulate-tutorial.ts ✓
- /Users/jtsmith/BoardSmith/src/testing/tutorial-assertions.ts ✓
- /Users/jtsmith/BoardSmith/src/testing/simulate-tutorial.test.ts ✓

Commits:
- f4e241a (test RED) ✓
- b1b8094 (feat GREEN) ✓
- 5f191ef (feat exports) ✓
