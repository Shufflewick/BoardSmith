---
phase: 120-authoring-pit-of-success-guards
plan: 01
subsystem: engine
tags: [flow, builders, pit-of-success, fail-fast, vitest]

# Dependency graph
requires: []
provides:
  - "loop() throws an actionable Error at construction time when maxIterations is omitted"
  - "Removal of the devWarn('loop-no-max:*') silent-warning path"
affects: [flow-authoring, game-flow-design]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Construction-time fail-fast guard for required-but-optional-typed config fields"]

key-files:
  created:
    - src/engine/flow/builders.test.ts
  modified:
    - src/engine/flow/builders.ts
    - src/engine/flow/engine.test.ts
    - src/engine/utils/dev-state.test.ts

key-decisions:
  - "Removed the devWarn path entirely rather than gating it behind a flag — No-Backward-Compat rule (CLAUDE.md)"
  - "Kept DEFAULT_MAX_ITERATIONS (engine.ts) untouched as the secondary runtime safety net"

patterns-established:
  - "Authoring-time throw for missing required flow config, with corrective example text and the silent-fallback risk explained in the message"

requirements-completed: [PIT-01]

# Metrics
duration: ~15min
completed: 2026-07-01
---

# Phase 120 Plan 01: loop() maxIterations construction-time guard Summary

**`loop()` now throws an actionable Error at game-construction time when `maxIterations` is omitted, replacing a silent dev-console warning; all 6 in-repo test call sites lacking the option were patched to keep the suite green.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-07-01T04:09:00Z (approx, first read)
- **Completed:** 2026-07-01T04:24:15Z
- **Tasks:** 2/2 completed
- **Files modified:** 4 (1 created, 3 modified)

## Accomplishments
- `loop({ do })` without `maxIterations` now throws a construction-time `Error` naming the corrective form (`loop({ maxIterations: 100, ... })`) and explaining the silent 10000-iteration `DEFAULT_MAX_ITERATIONS` fallback risk.
- Removed the `devWarn('loop-no-max:*')` path and its now-unused `devWarn` import from `builders.ts` (No-Backward-Compat — no shim, no deprecation cycle).
- Added dedicated `builders.test.ts` covering the throw case and two happy-path construction cases (basic + `while`/`name` preservation).
- Fixed all 6 pre-existing in-repo `loop({...})` test call sites that omitted `maxIterations`, all with `maxIterations: 10` (sufficient bound for each test's short-lived flow, doesn't change test intent).
- Full test suite (135 files, 1847 tests) passes green after the change.

## Task Commits

Each task was committed atomically (TDD RED → GREEN for Task 1):

1. **Task 1 RED: add failing test for loop() maxIterations throw** - `ba439da` (test)
2. **Task 1 GREEN: loop() throws at construction when maxIterations is omitted** - `ea5ead9` (feat)
3. **Task 2: add maxIterations to pre-existing loop() call sites** - `3d4a1bd` (fix)

**Plan metadata:** pending (this commit, docs: complete plan)

## Files Created/Modified
- `src/engine/flow/builders.test.ts` - New dedicated PIT-01 unit tests: throw-on-missing-maxIterations, happy-path construction, while/name preservation.
- `src/engine/flow/builders.ts` - `loop()` guard clause replaced: unconditional `throw new Error(...)` instead of `devWarn(...)`; removed unused `devWarn` import.
- `src/engine/flow/engine.test.ts` - Added `maxIterations: 10` to the 5 call sites at (pre-edit) lines 50, 174, 196, 1030, 1465.
- `src/engine/utils/dev-state.test.ts` - Added `maxIterations: 10` to the call site at (pre-edit) line 76.

## Decisions Made
- Followed CLAUDE.md's No-Backward-Compat rule: deleted the `devWarn` branch outright rather than keeping it behind a flag or deprecation warning.
- Chose `maxIterations: 10` uniformly for the 6 patched test call sites — small enough to keep tests fast, large enough (>= each test's expected iteration count) to not change test intent. Verified each site's loop only needs 3-4 iterations at most.
- Left `DEFAULT_MAX_ITERATIONS` (engine.ts, ~line 30) and its runtime enforcement (~line 1045) completely untouched — it remains the secondary safety net per the plan's interface note.
- Verified the two internal `builders.ts` callers of `loop()` (`turnLoop`, `stateAwareLoop`) already pass `maxIterations: config.maxIterations ?? 100`, so they were unaffected by the new throw.

## Deviations from Plan

None - plan executed exactly as written. Line numbers in the plan (50, 174, 196, 1030, 1465) matched the actual file at read time (they had not drifted); after this plan's own edits inserted new lines, they naturally shifted forward by 1-2 lines during the fix-up but all 6 target call sites were located and patched correctly via grep verification.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- PIT-01 is fully resolved: `loop()` fails fast and loud at authoring time.
- The `builders.test.ts` file establishes a pattern for future PIT-0x plans in this phase (120-02, 120-03, 120-04 etc. already have commits in the branch history) to add dedicated unit coverage for authoring guards.
- No blockers for subsequent phase-120 plans.

---
*Phase: 120-authoring-pit-of-success-guards*
*Completed: 2026-07-01*

## Self-Check: PASSED
All created/modified files verified present on disk; all 3 task commit hashes (ba439da, ea5ead9, 3d4a1bd) verified in git log.
