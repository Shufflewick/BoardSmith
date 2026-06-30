---
phase: 118-test-ergonomics
plan: "01"
subsystem: testing
tags: [test-ergonomics, typed-api, hidden-info, pit-of-success]
dependency_graph:
  requires: [Phase 117 createPlayerView / runner.getPlayerView]
  provides: [getPlayerView with PlayerStateView return type + JSDoc, TEST-01 test coverage]
  affects: [src/testing/test-game.ts, src/testing/test-game.test.ts]
tech_stack:
  added: []
  patterns: [type annotation, JSDoc two-pattern documentation, Vitest integration test]
key_files:
  created:
    - src/testing/test-game.test.ts
  modified:
    - src/testing/test-game.ts
decisions:
  - "Import PlayerStateView from runtime barrel (same pattern as ActionExecutionResult import)"
  - "JSDoc steers authors toward testGame.game.<prop> for domain state, away from view.state JSON parsing"
metrics:
  duration: "~8 minutes"
  completed: "2026-06-30T22:44:08Z"
  tasks_completed: 2
  tasks_total: 2
  files_created: 1
  files_modified: 1
---

# Phase 118 Plan 01: TEST-01 Typed Observable State Summary

`getPlayerView` annotated with explicit `PlayerStateView` return type + two-pattern JSDoc; 13 integration tests verify typed state access and hidden-info exclusion.

## Tasks Completed

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 | Write failing TEST-01 tests (RED) | b07184c | src/testing/test-game.test.ts |
| 2 | Annotate + document getPlayerView (GREEN) | 211fbc2 | src/testing/test-game.ts |

## What Was Built

### Task 1: Test file (`src/testing/test-game.test.ts`)

Created 13 Vitest tests organized into three suites covering the TEST-01 contract:

1. **PlayerStateView shape** — `player`, `phase`, `complete`, `flowState` fields present; `isMyTurn` correct for active vs inactive seat; `view.state` is an `ElementJSON` object.
2. **Hidden-info exclusion** (cross-layer testing → engine integration) — player 1 cannot see player 2's hand card attributes (`__hidden: true`, `rank` undefined); each player CAN see their own hand; p1 and p2 views are distinct.
3. **Typed per-game access** — `testGame.game.score` accessible as `number` without casting; `testGame.game` is the same instance as `runner.game`.

Fixture: inline `FixtureGame` class (extends `Game<FixtureGame, Player>`) with `Hand` elements per player and a `score: number = 0` custom property. Uses a fixed seed for determinism.

### Task 2: Annotation + JSDoc (`src/testing/test-game.ts`)

- Added `type PlayerStateView` to the existing `import { GameRunner, type ActionExecutionResult } from '../runtime/index.js'` import.
- Changed `getPlayerView(playerSeat: number)` → `getPlayerView(playerSeat: number): PlayerStateView` (body unchanged: still `return this.runner.getPlayerView(playerSeat)`).
- Expanded JSDoc with two documented read patterns:
  - Pattern 1: `testGame.getPlayerView(seat)` for perspective-correct observable state
  - Pattern 2: `testGame.game.<prop>` for typed per-game custom properties
- Explicit note steering authors away from parsing `view.state` JSON (Pit of Success).

## Verification

- `npx vitest run src/testing/` — 35 tests pass (13 new + 22 existing)
- `npx tsc --noEmit` — zero errors in `src/testing/`; pre-existing errors in `src/ui/`, `src/session/`, `src/engine/element/image-leak.test.ts` are baseline (unchanged)
- `getPlayerView` signature is exactly `getPlayerView(playerSeat: number): PlayerStateView`
- Body delegates to `this.runner.getPlayerView(playerSeat)` — Phase 117 perspective filter preserved

## Deviations from Plan

None — plan executed exactly as written.

The plan noted "some [tests] may already pass since getPlayerView exists" — all 13 tests passed immediately, which is the expected outcome for this annotation-only requirement. No assertions were weakened.

## Threat Surface Scan

No new network endpoints, auth paths, or schema changes. The hidden-info exclusion test (cross-layer testing → engine) explicitly asserts that `createPlayerView`'s perspective filter excludes opponent hand contents — the T-118-01 STRIDE mitigation is covered.

## Self-Check: PASSED

- `src/testing/test-game.test.ts` exists: FOUND
- `src/testing/test-game.ts` has `getPlayerView(playerSeat: number): PlayerStateView`: FOUND
- Commit b07184c exists: FOUND
- Commit 211fbc2 exists: FOUND
