---
phase: 106-predicate-triggers-ci-verifiable-authoring
plan: "03"
subsystem: session
tags: [tutorial, auto-advance, predicates, game-session, broadcast]

# Dependency graph
requires:
  - phase: 106-01
    provides: autoAdvanceTutorial, nextProgress, initialProgress, validateTutorialDefinition from engine tutorial/progress.ts
provides:
  - Post-action auto-advance pump in GameSession.performAction — evaluates advanceWhen predicates server-side for all running-tutorial seats after every action, re-broadcasting if any seat advanced
  - Fail-loud TutorialController.start() via validateTutorialDefinition (MR-03) — throws on zero steps and non-function predicates at start time
  - Step-transition delegation to engine — TutorialController.#forwardAdvance uses nextProgress, start() uses initialProgress (single source of truth)
  - Tutorial auto-advance test suite — opponent-triggered, double-broadcast, flash-and-skip guard, MR-03 assertions
affects: [106-04, 109-checkers, 110-demo]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Post-action hook pattern: after primary broadcast in performAction, iterate tutorialProgress Map and pump autoAdvanceTutorial per seat; if any advanced, re-broadcast"
    - "Flash-and-skip guard: auto-advance pump intentionally NOT called at startTutorial; step[0] always renders before any advance"
    - "Fail-loud at start: validateTutorialDefinition called at TutorialController.start() before initialProgress"

key-files:
  created:
    - src/session/tutorial-autoadvance.test.ts
  modified:
    - src/session/game-session.ts
    - src/session/tutorial-controller.ts
    - src/session/tutorial-controller.test.ts

key-decisions:
  - "Flash-and-skip guard: the auto-advance pump runs ONLY in performAction's post-action hook, never at startTutorial — step[0] content always renders on entry"
  - "All running-tutorial seats (not just acting player) are iterated after every action so opponent moves can advance the learner's tutorial"
  - "Single re-broadcast after the pump loop if any seat advanced — allocation-light and zero extra broadcasts in non-tutorial games"
  - "validateTutorialDefinition called at start() before initialProgress — catches empty steps and non-function predicates with actionable errors at the earliest possible moment"

patterns-established:
  - "Iterate game.tutorialProgress Map (not playerCount loop) so only seats that actually have tutorials are touched"
  - "Engine owns all step-transition logic; session delegates to nextProgress/initialProgress/validateTutorialDefinition"

requirements-completed: [TUT-03]

# Metrics
duration: 15min
completed: 2026-06-26
---

# Phase 106 Plan 03: Session Auto-Advance Hook Summary

**Post-action advanceWhen predicate pump wired into GameSession with flash-and-skip guard, fail-loud MR-03 start validation, and engine-delegated step transitions**

## Performance

- **Duration:** 15 min
- **Started:** 2026-06-26T09:19:00Z
- **Completed:** 2026-06-26T09:25:00Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- `GameSession.performAction` now evaluates `advanceWhen` predicates server-side for every running-tutorial seat after each action and re-broadcasts if any seat advanced (UI-agnostic parity — client just renders the advanced step)
- `TutorialController.start()` calls `validateTutorialDefinition(def)` first (MR-03: zero steps throws, non-function predicates throw at start time), then delegates to `initialProgress(def)` for first-step construction
- `TutorialController.#forwardAdvance` replaced with single call to `nextProgress(def, currentStepId)` — no more hand-rolled findIndex/nextIndex math, single source of truth in engine
- 8 new integration tests in `tutorial-autoadvance.test.ts` + 2 new MR-03 tests in `tutorial-controller.test.ts`; full session suite 204/204 green

## Task Commits

1. **Task 1: Server-side auto-advance hook** - `fd2f8a8` (feat)
2. **Task 2: Fail-loud lifecycle (MR-03) + engine-delegated step transitions** - `79f79de` (feat)
3. **Task 3: Tests — auto-advance, re-broadcast, opponent-triggered, MR-03** - `bc4d3d4` (test)

## Files Created/Modified

- `src/session/game-session.ts` — Added `autoAdvanceTutorial` import and post-action pump in `performAction`; hook iterates all running-tutorial seats, re-broadcasts if any advanced
- `src/session/tutorial-controller.ts` — Added `nextProgress/initialProgress/validateTutorialDefinition` imports; replaced `#forwardAdvance` body with `nextProgress`; replaced `start()` body with `validateTutorialDefinition` + `initialProgress`
- `src/session/tutorial-autoadvance.test.ts` — New: 8 tests covering double-broadcast, opponent-triggered advance, flash-and-skip guard (single broadcast at start), single-broadcast when no tutorial, MR-03 zero-steps error
- `src/session/tutorial-controller.test.ts` — Added 2 MR-03 zero-steps tests to error handling describe block

## Decisions Made

- **Flash-and-skip guard enforced**: The plan's note about `advanceWhen` being POST-ACTION only is implemented by not calling the pump in `startTutorial`. Step[0] always renders on entry; the pump only fires from `performAction`'s post-broadcast hook.
- **All seats iterated (not just acting player)**: `game.tutorialProgress` Map is iterated (not a `playerCount` loop), so only seats with actual tutorials are touched and opponent moves correctly advance learner progress.
- **Single re-broadcast**: The loop collects an `anyAdvanced` flag and calls `broadcast()` at most once after the loop — allocation-light, avoids N broadcasts for N-seat games.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## Known Stubs

None.

## Threat Flags

No new security surface introduced. T-106-04 (DoS from post-action hook on non-tutorial games) is mitigated — the hook performs zero extra broadcasts when no tutorial is running, verified by the spy test in `tutorial-autoadvance.test.ts`.

## Next Phase Readiness

- TUT-03 runtime delivery complete: predicates evaluated server-side, auto-advance re-broadcasts UI-agnostically
- Ready for Plan 106-04 (testing DSL) which consumes `autoAdvanceTutorial` for CI-verifiable authoring
- Session suite 204/204 green; no regressions

---
*Phase: 106-predicate-triggers-ci-verifiable-authoring*
*Completed: 2026-06-26*
