---
phase: 123-determinism-flow-introspection
plan: 02
subsystem: engine
tags: [determinism, rng, seeded-random, testing, playUntilComplete, vitest]

# Dependency graph
requires:
  - phase: 123-01
    provides: flow-position debug primitive (getFlowDebugInfo) — unrelated surface, same phase
provides:
  - "Space.shuffleInternal() throws an actionable error instead of silently using Math.random when no seeded rng is reachable"
  - "ElementCollection.shuffle() requires an explicit rng argument (Math.random default removed)"
  - "playUntilComplete() is deterministic by default via a fixed-seed rng; options.seed varies it; options.rng remains an escape hatch"
  - "GameRunner.seed captures the effective seed even when the Game auto-generated it, via getConstructorOptions().seed read-back"
affects: [125-headless-simulation]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Throw-on-missing-rng guard mirrors game.ts restoreFlow()'s actionable-error style (specific problem + concrete fix in message)"
    - "Default-seed-not-default-Math.random: options that previously fell back to Math.random now derive a fixed literal seed via createSeededRandom, preserving determinism for the zero-config path"

key-files:
  created:
    - src/engine/element/space.test.ts
    - src/engine/element/element-collection.test.ts
  modified:
    - src/engine/element/space.ts
    - src/engine/element/element-collection.ts
    - src/testing/simulate-action.ts
    - src/runtime/runner.ts
    - src/testing/play-until-complete.test.ts

key-decisions:
  - "ElementCollection.shuffle(rng) has no default parameter (clean break) — zero callers confirmed across BoardSmith + all games + MERC"
  - "playUntilComplete's default rng seed is the fixed literal 'playUntilComplete-default', not per-call randomness, so no-options calls stay reproducible"
  - "GameRunner.seed is populated by reading Game.getConstructorOptions().seed when no explicit seed was passed, reusing the existing constructor bookkeeping rather than adding new plumbing"

requirements-completed: [FLOW-04]

duration: 25min
completed: 2026-07-01
---

# Phase 123 Plan 02: Determinism — Kill Math.random Fallbacks Summary

**Removed every reachable `Math.random` fallback from the seeded-run path (Space/ElementCollection shuffle, playUntilComplete) and made auto-generated game seeds retrievable via GameRunner, closing FLOW-04.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-07-01T21:57:00Z (approx)
- **Completed:** 2026-07-01T22:11:00Z
- **Tasks:** 2 completed
- **Files modified:** 7 (2 created, 5 modified)

## Accomplishments

- `Space.shuffleInternal()` now throws a specific, actionable `Error` (naming the fix: attach the element to a `Game`, or connect the element tree) instead of silently falling back to `Math.random` when no seeded rng is reachable.
- `ElementCollection.shuffle()` requires an explicit `rng` argument — the `= Math.random` default is gone (clean break, zero confirmed callers repo-wide).
- `playUntilComplete()` is deterministic by default: with no options, the move-selection rng is seeded from a fixed literal default (`'playUntilComplete-default'`); `options.seed` varies the run reproducibly; `options.rng` remains the existing escape hatch.
- `GameRunner.seed` is now always populated — when `gameOptions.seed` isn't supplied, the runner reads back the game's auto-generated seed via `getConstructorOptions().seed`, so every run (seeded or not) is replayable.
- New regression tests: `space.test.ts`, `element-collection.test.ts` (both new files), plus a determinism suite added to `play-until-complete.test.ts`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Engine RNG fallback fixes (space.ts + element-collection.ts) with regression tests** - `1e54159` (fix)
2. **Task 2: Deterministic playUntilComplete + seed retrievability + determinism regression test** - `9f53b4f` (feat)

**Plan metadata:** (this commit, following this Summary)

## Files Created/Modified

- `src/engine/element/space.ts` - `shuffleInternal()` throws an actionable error when `_ctx.random` is absent; never references `Math.random`
- `src/engine/element/space.test.ts` (new) - Regression tests: deterministic shuffle with a game-attached seeded rng; throw when no seeded rng reachable
- `src/engine/element/element-collection.ts` - `shuffle(random: () => number)` — required param, no `Math.random` default
- `src/engine/element/element-collection.test.ts` (new) - Regression tests: deterministic shuffle with a stub rng; no-arg call throws at runtime
- `src/testing/simulate-action.ts` - `playUntilComplete`'s default rng now derives from `createSeededRandom(options?.seed ?? 'playUntilComplete-default')`; `options.seed` added to `PlayUntilCompleteOptions`
- `src/runtime/runner.ts` - `GameRunner.seed` reads back `game.getConstructorOptions().seed` when no explicit seed was passed
- `src/testing/play-until-complete.test.ts` - Added a `determinism by default` describe block: no-options runs match, same `options.seed` twice matches, different seeds diverge (compared on action history minus wall-clock `timestamp`)

## Decisions Made

- `ElementCollection.shuffle()`'s `random` parameter has no default at all (not even a seeded one) — this collection type has no `Game` context to derive a seed from, so requiring the caller to supply one is the only pit-of-success option. Confirmed zero callers exist across BoardSmith, all `~/BoardSmithGames/*`, and MERC before making this a clean break.
- `Space.shuffleInternal()`'s error message explicitly names the fix (attach via `Game`, or check element-tree connectivity) mirroring the `restoreFlow()` throw style in `game.ts`, per the plan's `<interfaces>` guidance.
- Determinism test comparisons strip the `timestamp` field from action-history entries before `toEqual`, since `timestamp` is `Date.now()` wall-clock and not part of the deterministic move-selection contract — comparing it directly caused false regression-test failures across process ticks.

## Deviations from Plan

None - plan executed exactly as written. The one refinement (stripping `timestamp` in the determinism test's deep-equal comparison) was a straightforward test-correctness fix within Task 2's own scope, not a deviation from the plan's intent (same-seed-twice command history equality) — `timestamp` was never part of the "identical command history" contract being verified.

## Issues Encountered

- Initial version of the same-seed-twice determinism test failed because `getActionHistory()` entries include a `timestamp: Date.now()` field that legitimately differs by 1ms between two sequential `playUntilComplete` calls. Fixed by comparing action history with `timestamp` stripped, which is what the test was actually meant to verify (that move selection reproduces identically).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- FLOW-04 fully satisfied: no reachable `Math.random` fallback remains in `space.ts`, `element-collection.ts`, or the reachable path of `simulate-action.ts`.
- Full BoardSmith suite green: 141 test files, 1885 tests passing.
- Cross-repo sanity check: `~/BoardSmithGames/go-fish` (78/78, shuffle-heavy hidden-info card game) and `~/BoardSmithGames/cribbage` (20/20) both green against the updated library via the live symlink — no breakage in shuffle-dependent games.
- Phase 125 (headless simulation) can now depend on this determinism guarantee for reproducible seeded runs.

---
*Phase: 123-determinism-flow-introspection*
*Completed: 2026-07-01*

## Self-Check: PASSED

All created/modified files verified present on disk; all task commits (`1e54159`, `9f53b4f`) and the summary commit (`6c19afe`) verified present in git log.
