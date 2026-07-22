---
phase: 168-platform-feature-spike-seed-to-state
plan: 01
subsystem: docs
tags: [snapshot, GameRunner, GameStateSnapshot, dev-host, testing, vitest]

requires:
  - phase: 155-160
    provides: undo/rewind checkpoint + snapshot-restore fixes that GameRunner.fromSnapshot's current state-authoritative design relies on
provides:
  - FEAT-01 seed-to-state feasibility spike doc (docs/seed-to-state.md)
  - Section-presence + citation-existence guard test (docs/seed-to-state.test.ts)
affects: [168-02-poc, future bs-skills playtest wiring]

tech-stack:
  added: []
  patterns:
    - "Citation-existence guard test: parse src/*.ts path tokens out of a doc and assert existsSync for each, catching citation drift without a markdown parser"

key-files:
  created:
    - docs/seed-to-state.md
    - docs/seed-to-state.test.ts
  modified:
    - vitest.config.ts

key-decisions:
  - "Seed file convention: seeds/<scenario-name>.json at the game project root, containing exactly a serialized GameStateSnapshot with no wrapper envelope"
  - "Ship raw-snapshot seed format now; defer a scenario DSL until raw authoring proves too low-level in practice"
  - "Record-from-play (TestGame.getSnapshot()) is the primary authoring surface; hand-authoring without playing to the state is deferred"

patterns-established:
  - "docs/*.test.ts is now a valid location for repo-root doc-drift guard tests (vitest.config.ts include extended)"

requirements-completed: [FEAT-01]

duration: ~20min
completed: 2026-07-22
---

# Phase 168 Plan 01: Seed-to-State Feasibility Spike Summary

**Wrote docs/seed-to-state.md establishing that loading a game into an exact playtest state is already solved via the existing GameRunner.fromSnapshot state-authoritative restore — the only new work is a record-from-play authoring recipe and a small `--seed` dev-host wiring flag — backed by a citation-existence guard test that verifies every cited source file against the real codebase.**

## Performance

- **Duration:** ~20 min
- **Tasks:** 2
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments
- Authored `docs/seed-to-state.md` covering Problem, Mechanism, Load path, Authoring surface, Pipeline request API, Dev-host wiring, Cost/shape recommendation, and Proven vs deferred — every citation independently verified against real source (`src/engine/utils/snapshot.ts`, `src/runtime/runner.ts`, `src/session/stateless-ops.ts`, `src/session/game-session.ts`, `src/session/snapshot-session-host.ts`, `src/cli/dev-host/multiplayer-host.ts`, `src/testing/test-game.ts`) before writing any claim.
- Added `docs/seed-to-state.test.ts`, a vitest guard asserting all six required `##` sections, the three load-path anchors (`GameRunner.fromSnapshot`, `handleStart`, `TestGame.getSnapshot`), and — via a regex-extracted `src/*.ts` path scan + `existsSync` — that every source file the doc cites actually exists on disk. 21/21 assertions pass.
- Explicitly recorded the feasibility finding that reduces perceived cost of C.1: the load path (`GameRunner.fromSnapshot`) is already public, exported, and state-authoritative (not replay-based); only the authoring convenience and a small CLI flag are new.
- Documented the pipeline request API shape (named seed file, `seeds/<scenario>.json` convention) without wiring any `bs-` skills files, per the plan's explicit no-skills-edits-this-phase constraint.
- Stated plainly that C.2 (panel multi-select) belongs to Phase 159, not this phase.

## Task Commits

1. **Task 1: Author the seed-to-state feasibility spike doc** - `5705f508` (docs)
2. **Task 2: Add a section-presence + citation-existence guard test for the doc** - `f13c16ce` (test)

**Plan metadata:** pending (docs: complete plan)

## Files Created/Modified
- `docs/seed-to-state.md` - FEAT-01 spike finding: mechanism, load path, authoring surface, pipeline API shape, dev-host wiring, cost recommendation, proven-vs-deferred
- `docs/seed-to-state.test.ts` - Section-presence + citation-existence guard (21 assertions)
- `vitest.config.ts` - Added `docs/**/*.test.ts` to the `include` glob (Rule 3 fix, see below)

## Decisions Made
- Seed file convention: `seeds/<scenario-name>.json` at the game project root, holding exactly a serialized `GameStateSnapshot` (no wrapper envelope) — documented for a future `bs-` skills wire-up, not built this phase.
- Recommend shipping the raw-snapshot seed format (no scenario DSL) until raw authoring is empirically shown to be too low-level.
- Guard test parses `src/*.ts` path tokens out of the markdown with a regex rather than a markdown parser (matches the repo's existing `templates.test.ts` plain-string-assertion convention) — new dependency avoided.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] vitest include glob excluded docs/*.test.ts**
- **Found during:** Task 2 (running `npx vitest run docs/seed-to-state.test.ts` per the plan's verify step)
- **Issue:** `vitest.config.ts`'s `test.include` was `['src/**/*.test.ts', 'scripts/**/*.test.mjs']` — a test file at `docs/seed-to-state.test.ts` (the plan's mandated `files_modified` path) is silently excluded from collection even when vitest is invoked with the file's explicit path, because vitest still filters explicit paths against `include`.
- **Fix:** Added `'docs/**/*.test.ts'` to the `include` array in `vitest.config.ts`.
- **Files modified:** `vitest.config.ts`
- **Verification:** `npx vitest run docs/seed-to-state.test.ts` — 21/21 tests pass.
- **Committed in:** `f13c16ce` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary to make the plan's own mandated file location (`docs/seed-to-state.test.ts`) executable under the repo's existing `npx vitest run` convention. No scope creep — scoped to the exact include-glob gap this task's file hit.

## Issues Encountered
None beyond the vitest include-glob gap documented above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Plan 168-02 (the PoC) can now build the `--seed <file>` dev-host flag against the exact load path this doc documents (`GameRunner.fromSnapshot` via the stateless dev-host `start` op).
- The doc's Pipeline request API section gives 168-02 (and any future `bs-` skills wiring) a concrete seed-file convention to target without re-deriving it.
- No blockers.

---
*Phase: 168-platform-feature-spike-seed-to-state*
*Completed: 2026-07-22*

## Self-Check: PASSED

- FOUND: docs/seed-to-state.md
- FOUND: docs/seed-to-state.test.ts
- FOUND: 5705f508
- FOUND: f13c16ce
