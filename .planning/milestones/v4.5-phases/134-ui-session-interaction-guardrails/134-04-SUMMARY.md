---
phase: 134-ui-session-interaction-guardrails
plan: 04
subsystem: session
tags: [game-session, game-runner, encapsulation, sess-01]

# Dependency graph
requires:
  - phase: 134-01
    provides: PROC-01 verification gate confirming F29/SESS-01 LEGITIMATE against current source (5 `#runner` assignment sites, zero production `.performAction` consumers through `session.runner`)
provides:
  - "ReadOnlyRunnerFacade<G> interface + buildRunnerFacade() factory in src/session/game-session.ts"
  - "GameSession.runner now returns a read-only facade — performAction unreachable at both the type level and runtime"
affects: [134-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Narrower runtime object, not a type-cast: buildRunnerFacade() returns a fresh object literal with getters/arrow-methods delegating to the live GameRunner, so `.performAction` is genuinely absent (undefined) at runtime for untyped/JS callers, not merely hidden by TypeScript's static type"
    - "Facade rebuilt in lockstep with every #runner reassignment (paired assignment at all 5 sites) rather than computed lazily in the getter, keeping session.runner referentially stable within a runner generation"

key-files:
  created: []
  modified:
    - src/session/game-session.ts
    - src/session/game-session.test.ts

key-decisions:
  - "Facade delegates via closures over the `runner` parameter captured at construction time (not `this.#runner`), so each of the 5 rebuild call sites passes the just-assigned runner directly — avoids any risk of the facade referencing a stale field during the brief window between `this.#runner = newRunner` and any subsequent statement."
  - "@ts-expect-error test line references `session.runner.performAction` as a property (assigns to a local, does not call it) rather than invoking it directly — an actual call would throw a TypeError at runtime (which the adjacent `toBeUndefined()` runtime assertion already proves), and the plan's goal is to lock in the *type-level* absence without also asserting on the exact runtime error shape."

requirements-completed: [SESS-01]

duration: 5min
completed: 2026-07-03
---

# Phase 134 Plan 04: Read-Only Runner Facade (SESS-01) Summary

**`session.runner` now returns a genuinely narrower `ReadOnlyRunnerFacade` object — `.performAction()` is absent at both the type level and runtime, eliminating the lookalike wrong path beside `session.performAction()` that silently skipped persistence/broadcast/checkpoints/tutorials/AI scheduling.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-07-03T16:36:56Z
- **Completed:** 2026-07-03T16:41:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Added exported `ReadOnlyRunnerFacade<G>` interface (game, actionHistory, getSnapshot, getPlayerView, getAllPlayerViews, getFlowState, getFlowDebugInfo, getPendingAction, isComplete, getWinners — no `performAction`) and a module-level `buildRunnerFacade<G>(runner)` factory that returns a genuinely narrower object literal (getters/arrow-methods delegating to the live `GameRunner`), not a cast of the runner
- Added a private `#runnerFacade` field, rebuilt at all 5 confirmed `#runner` assignment sites (constructor 341→now offset by inserted code but same logical site, `replaceRunner` callback, lobby onGameStart handoff, dev-transfer reload, replay reload) so `session.runner` stays referentially stable across reads within a runner generation
- Narrowed `get runner()` to return the cached `#runnerFacade` typed as `ReadOnlyRunnerFacade<G>` instead of the raw `GameRunner<G>`
- No write path altered — `session.performAction()` and all internal `this.#runner` usage are untouched; confirmed via grep that no internal code used `this.runner` (the public getter) — only `this.#runner` directly
- Added a "runner facade" test suite: one test proving the full read surface (getSnapshot/.game/.actionHistory/getFlowState/isComplete) works through the facade and stays live across a `performAction()` call; one test proving `.performAction` is `undefined` at runtime (`(session.runner as any).performAction`) plus a `@ts-expect-error` line locking in the type-level absence

## Task Commits

Each task was committed atomically:

1. **Task 1: Add ReadOnlyRunnerFacade + rebuild at all 5 #runner sites + narrow get runner()** - `c160740b` (feat)
2. **Task 2: SESS-01 regression test — read surface works, performAction unreachable** - `f2cd0be1` (test)

## Files Created/Modified

- `src/session/game-session.ts` - Added `ReadOnlyRunnerFacade<G>` interface, `buildRunnerFacade<G>()` factory, `#runnerFacade` field (rebuilt at all 5 `#runner` assignment sites), narrowed `get runner()`; imported `GameStateSnapshot`, `PlayerStateView`, `FlowDebugInfo`, `Player` from `../engine/index.js`
- `src/session/game-session.test.ts` - Added `describe('GameSession runner facade (SESS-01/F29)')` with the read-surface and performAction-unreachable tests

## Decisions Made
See `key-decisions` in frontmatter above.

## Deviations from Plan

None — plan executed exactly as written. All 5 `#runner` assignment sites were re-grepped before editing (per the plan's explicit NOTE that RESEARCH.md's prose is stale) and matched the must_haves-listed line numbers (341, 379, 484, 1462, 1482) exactly.

## RED State (PROC-02)

Per PROC-02, this plan's regression test is RED-first relative to the facade change: before Task 1's facade existed, `session.runner` returned the raw `GameRunner`, so:
- `(session.runner as any).performAction` was a real, callable function — the `toBeUndefined()` assertion would have failed (assertion would receive a `function`, not `undefined`).
- The `@ts-expect-error` line covering `session.runner.performAction` would have produced a compile-time `error TS2578: Unused '@ts-expect-error' directive` (no type error to suppress, since `performAction` genuinely existed on the pre-facade return type `GameRunner<G>`).

Both failure modes were confirmed by direct reasoning against the pre-Task-1 `get runner(): GameRunner<G> { return this.#runner; }` getter (verified via `git show c160740b~1:src/session/game-session.ts` line 858-860 before editing). Because this plan's tasks are ordered "build the facade, then add the regression test that proves it" (not a formal RED-commit/GREEN-commit split — Task 1 already lands the fix), the RED state is documented here analytically rather than captured as a separate failing-test commit; the test as committed is GREEN against the Task-1 facade.

## Issues Encountered

None. `npx tsc --noEmit` reports no `game-session` errors; the pre-existing `teaching.test.ts` `GameStateSnapshot`-to-`Record<string, unknown>` cast errors (6 occurrences) are unrelated to this plan's changes (same cast, same type, present before and after — `session.runner.getSnapshot()` returns the identical `GameStateSnapshot` type whether delegated through the facade or the raw runner) and out of scope per the plan's `files_modified` list; matches STATE.md's already-tracked "tsc test-file looseness — future cleanup pass" deferred item.

## Known Stubs

None.

## Threat Flags

None — T-134-08 (session-state consistency, mitigated by removing `performAction` from both the type and the runtime object) and T-134-09 (information disclosure, accepted — no new read surface) are the only two threat-register rows for this plan and both were applied/confirmed exactly as specified. No new unmitigated surface was introduced.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- SESS-01 is shipped and test-covered. All 5 `#runner` assignment sites rebuild the facade; zero production consumers were affected (confirmed zero production `.runner.` call sites outside `TestGame` in 134-01's verification pass); all 10 existing read-only test consumers across `restore-snapshot-authoritative.test.ts`, `teaching.test.ts`, `teaching-disabled-persistence.test.ts`, `stateful-timetravel-authoritative.test.ts`, `stateful-undo-authoritative.test.ts` continue to compile and pass unchanged (full `src` suite: 169 test files / 2216 tests green).
- No blockers. Ready for Plan 05.

---
*Phase: 134-ui-session-interaction-guardrails*
*Completed: 2026-07-03*

## Self-Check: PASSED

Both modified files (`src/session/game-session.ts`, `src/session/game-session.test.ts`) confirmed present on disk; both task commit hashes (`c160740b`, `f2cd0be1`) confirmed present in git log.
