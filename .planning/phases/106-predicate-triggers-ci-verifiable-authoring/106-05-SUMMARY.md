---
phase: 106-predicate-triggers-ci-verifiable-authoring
plan: 05
subsystem: testing
tags: [tutorial, predicates, ci, vitest, testing-dsl]

# Dependency graph
requires:
  - phase: 106-02
    provides: afterTurns / whenForced named predicate helpers in predicates.ts
  - phase: 106-04
    provides: simulateTutorial + assertTutorialCompletes DSL in testing/

provides:
  - In-repo proof that tutorial CI tests fail when game rules are broken (criterion #3)
  - DemoGame in-test subclass demonstrating persistentMap + action conditions pattern
  - DEMO_TUTORIAL authored with afterTurns + whenForced showing the correct authoring idiom
  - Two explicit break variants (gate drift, predicate drift) exercising both drift detectors

affects:
  - 109-checkers-tutorial (cross-repo tutorial authoring, same pattern)
  - 110-demo-gate (end-to-end demo verification)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Tutorial CI proof: minimal in-test Game subclass + simulateTutorial + assertTutorialCompletes"
    - "Deliberate-break variants: change tutorial def (gate drift) or swap game class (predicate drift)"
    - "persistentMap for serializable per-seat counters in test game classes"

key-files:
  created:
    - src/testing/tutorial-ci-demo.test.ts
  modified: []

key-decisions:
  - "DemoGame uses persistentMap<number,number> (not plain Map) to demonstrate the correct serializable-state pattern to game authors"
  - "Break #1 implemented via brokenGateDef (tutorial definition change) rather than broken game class — exercises getTutorialDisabledActions directly"
  - "Break #2 implemented via separate DemoGameNoCaptureRule class — clean separation of broken-rule variants"
  - "afterTurns(3) on the final step ensures the tutorial completes via the pump rather than requiring a manual assertTutorialCompletes-only check"

patterns-established:
  - "Tutorial CI demo pattern: TestGame.create → simulateTutorial(intact) → assertTutorialCompletes; plus expect(simulateTutorial(broken)).toThrow for each drift dimension"
  - "Broken-rule variants: definition-level for gate drift, game-class-level for predicate drift"

requirements-completed: [TUT-04]

# Metrics
duration: 14min
completed: 2026-06-26
---

# Phase 106 Plan 05: Tutorial CI Demo Summary

**In-repo criterion #3 proof: `simulateTutorial` with `afterTurns`+`whenForced` is GREEN on intact rules and RED on two deliberate breaks (gate drift via tutorial def change, predicate drift via capture-rule removal)**

## Performance

- **Duration:** 14 min
- **Started:** 2026-06-26T14:35:00Z
- **Completed:** 2026-06-26T14:49:37Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments

- Created `src/testing/tutorial-ci-demo.test.ts` — the canonical in-repo example of a tutorial authored as a CI test using named predicate helpers
- Proven criterion #3 green-when-intact: 3-step `DEMO_TUTORIAL` (intro → capture-tip → done) walks to completion via a 5-move `WALKTHROUGH` scenario, visiting all steps
- Proven criterion #3 red-when-broken — break #1 (gate drift): changing the intro step's gate to `{ action: 'capture' }` makes `simulateTutorial` throw `Tutorial drift (gate)` on the very first move
- Proven criterion #3 red-when-broken — break #2 (predicate drift): `DemoGameNoCaptureRule` removes the capture rule so `whenForced('capture')` never fires; `simulateTutorial` throws `Tutorial drift (predicate): expected advance to 'done' did not fire`

## Task Commits

1. **Task 1 + Task 2: Intact tutorial (GREEN) + broken-rule cases (RED)** - `66d4979` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `src/testing/tutorial-ci-demo.test.ts` — in-repo criterion #3 demonstration: DemoGame, DEMO_TUTORIAL definition, WALKTHROUGH scenario, plus two broken-rule variants with toThrow assertions

## Decisions Made

- `DemoGame.movesPerSeat` uses `persistentMap<number, number>` (not a plain `Map`) because this file doubles as documentation and the correct serializable-state pattern should be demonstrated from the start
- Break #1 implemented by changing the tutorial definition rather than the game class, because this directly exercises the `getTutorialDisabledActions` path (the preferred break per the plan)
- Break #2 implemented as a separate `DemoGameNoCaptureRule` class to keep the game variants readable and to test the exact failure path: `whenForced` never fires → `expectStep: 'done'` fails on step 3

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## Known Stubs

None — no stubs; the demo exercises real engine machinery (autoAdvanceTutorial, getTutorialDisabledActions, evaluateConditionWithTrace).

## Threat Flags

None — test-only file, no new network endpoints or trust boundaries.

## Self-Check: PASSED

- `src/testing/tutorial-ci-demo.test.ts` — FOUND
- commit `66d4979` — FOUND
- 3/3 tests pass (`npx vitest run src/testing/tutorial-ci-demo.test.ts`)

## Next Phase Readiness

- Criterion #3 proven in-repo; Phase 106 is complete
- Phase 109 (checkers tutorial, cross-repo) can author the real tutorial using the same `simulateTutorial` + named-helper pattern demonstrated here
- Phase 110 (demo gate) can verify the end-to-end checkers tutorial in browser
