---
phase: 125-headless-simulation
plan: 01
subsystem: session
tags: [headless-simulation, public-api, testing]
dependency-graph:
  requires: [FLOW determinism guarantee (Phase 123, no-Math.random fallbacks)]
  provides: [createHeadlessSession public export from boardsmith/session]
  affects: [src/session, src/runtime/runner.test.ts, downstream SIM-02 (CLI simulate command)]
tech-stack:
  added: []
  patterns: [clean-break file move (no re-export shim), structuredClone boundary enforcement]
key-files:
  created:
    - src/session/headless-session.ts
    - src/session/headless-session.test.ts
  modified:
    - src/session/index.ts
    - src/runtime/runner.test.ts
    - src/session/testing/eachplayer-clone.test.ts
    - src/session/testing/parity-contract.test.ts
    - src/session/testing/undo-authoritative.test.ts
  deleted:
    - src/session/testing/headless-harness.ts
decisions:
  - "No rename of createHeadlessSession (RESEARCH Open Question 1 resolved)"
  - "Clean break: old testing/ path deleted with zero re-export shim, per CLAUDE.md No Backward Compatibility"
  - "Determinism test compares game.random()-derived values, not raw broadcast/result objects — those also carry Date.now() action-history timestamps, which are legitimately wall-clock and outside the seeded-RNG contract"
metrics:
  duration: "~35 minutes"
  completed: 2026-07-02
---

# Phase 125 Plan 01: Promote createHeadlessSession to Public Session Surface Summary

Moved `createHeadlessSession` from the test-internal `src/session/testing/headless-harness.ts` to the public `boardsmith/session` barrel as `src/session/headless-session.ts`, migrated all 4 internal call sites, added a JSDoc worked example, and wrote a dedicated public-path unit test proving seeded determinism, AI-seat auto-play, and action-op round-trips.

## What Was Built

- **`src/session/headless-session.ts`** — the moved file, byte-identical in logic to the old harness except its two relative imports shifted one directory level shallower (`./snapshot-session-host.js` / `./stateless-ops.js` instead of `../`). Function signature (`createHeadlessSession(def, gameOptions, aiSeats)`) is unchanged.
- **`src/session/index.ts`** — new `// Headless Simulation` banner section exporting `createHeadlessSession` from `./headless-session.js`, so `import { createHeadlessSession } from 'boardsmith/session'` now resolves.
- **4 migrated call sites** — `src/runtime/runner.test.ts`, `src/session/testing/eachplayer-clone.test.ts`, `src/session/testing/parity-contract.test.ts`, `src/session/testing/undo-authoritative.test.ts` now import from the new public/relative path instead of the deleted `testing/headless-harness.js`.
- **`src/session/testing/headless-harness.ts`** — deleted. `grep -rl "headless-harness" src/` returns only a documentation-comment reference inside the new test file (explicitly noting the old path no longer exists) — zero import/functional references remain.
- **JSDoc `@example`** on `createHeadlessSession` — worked example showing `createHeadlessSession(gameDefinition, { playerCount: 2, seed: 'demo' }, [{ seat: 2, level: 'easy' }])` → `start()` → `send()` → reading `broadcasts`, modeled on the existing module-level example in `src/session/index.ts`.
- **`src/session/headless-session.test.ts`** — new public-path test file with 3 tests:
  1. **Determinism**: an inline `RollGame` fixture calls `game.random()` inside its `roll` action; two sessions created with the identical seed produce the identical sequence of RNG draws across 3 actions, and the sequence is non-trivial (not all-identical values) to rule out a vacuous/broken-RNG pass.
  2. **AI seats**: using the existing `eachPlayerFixtureDefinition` (2-player turn rotation), passing `aiSeats: [{ seat: 2, level: 'easy' }]` and only ever calling `session.send(1, ...)` proves seat 2 acts automatically via `SnapshotSessionHost.runAITurns` (more than one broadcast fires, and play rotates back to seat 1 without any `send(2, ...)` call).
  3. **Action op round-trip**: `send(seat, { type: 'action', ... })` with a valid action resolves with `success: true`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Determinism test initially asserted deep-equality on full broadcast/result objects, which include non-deterministic `Date.now()` action-history timestamps**
- **Found during:** Task 2, first test run (`npx vitest run src/session/headless-session.test.ts`)
- **Issue:** `expect(resultsA).toEqual(resultsB)` failed — not because the seeded RNG was non-deterministic (a debug script confirmed both sessions drew the identical roll sequence: 5, 1, 6), but because action-history entries carry a wall-clock `timestamp` field that legitimately differs by 1-2ms between the two session runs.
- **Fix:** Narrowed the determinism assertion to compare only the `game.random()`-derived values recorded on game state (`lastRoll`) across both sessions, plus a non-triviality check (`new Set(rollsA).size > 1`). This is the correct scope for the SIM-01 determinism contract — seeded RNG reproducibility — without conflating it with wall-clock action-history metadata that was never claimed to be deterministic.
- **Files modified:** `src/session/headless-session.test.ts`
- **Commit:** `1524a05`

None of this required touching production code — the fix was scoping the test assertion correctly.

## Self-Check: PASSED

- `src/session/headless-session.ts` exists — FOUND
- `src/session/headless-session.test.ts` exists — FOUND
- `src/session/testing/headless-harness.ts` does not exist — CONFIRMED (deleted)
- `grep -rl "headless-harness" src/` returns only a documentation comment in the new test file (no functional/import references) — CONFIRMED
- Commit `0d9f9d5` (Task 1) — FOUND in `git log`
- Commit `1524a05` (Task 2) — FOUND in `git log`
- `npx vitest run src/session/headless-session.test.ts src/runtime/runner.test.ts src/session/testing/eachplayer-clone.test.ts src/session/testing/parity-contract.test.ts src/session/testing/undo-authoritative.test.ts` — all green
- Full suite `npm test` — 147 test files, 1950 tests, all green
- `npx tsc --noEmit -p .` — no new errors introduced by this plan's files (pre-existing unrelated test-file looseness errors are untouched, per STATE.md known tech debt)
- `npx eslint` on changed files — clean
