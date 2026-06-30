---
phase: 106-predicate-triggers-ci-verifiable-authoring
fixed_at: 2026-06-26T10:06:00Z
review_path: .planning/phases/106-predicate-triggers-ci-verifiable-authoring/106-REVIEW.md
iteration: 1
findings_in_scope: 6
fixed: 6
skipped: 0
status: all_fixed
---

# Phase 106: Code Review Fix Report

**Fixed at:** 2026-06-26T10:06:00Z
**Source review:** .planning/phases/106-predicate-triggers-ci-verifiable-authoring/106-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 6 (CR-01, CR-02, WR-01, WR-02, WR-03, WR-04)
- Fixed: 6
- Skipped: 0

All 118 directly-affected tests pass; 730 tests across 49 files in engine/session/testing pass.

---

## Fixed Issues

### CR-01: Tutorial auto-advance not persisted — snapshot captured before `autoAdvanceTutorial` runs

**Files modified:** `src/session/game-session.ts`
**Commit:** 01fd3b8
**Applied fix:** Changed the `if (anyAdvanced) this.broadcast()` at the end of the auto-advance block in `performAction` to `if (anyAdvanced) { await this.#save(); this.broadcast(); }`. The second `#save()` captures the advanced tutorial progress into the durable snapshot so a server crash between the advance and the next action-triggered save can no longer cause the learner to re-experience a completed step on restore.

---

### CR-02: AI actions entirely bypass tutorial auto-advance

**Files modified:** `src/session/game-session.ts`
**Commit:** 01fd3b8 (same commit as CR-01 — both in game-session.ts, closely related)
**Applied fix:** Added the same auto-advance pump to the `#checkAITurn` action callback that was already present in `performAction`. After `#runner.performAction` succeeds for an AI move, the callback now iterates all running-tutorial seats, calls `autoAdvanceTutorial` for each, records whether any advanced, then saves (post-advance state included in the single save) and broadcasts — re-broadcasting if any seat advanced. This ensures `afterTurns(n)` and other predicates that depend on the opponent's turn fire correctly in learner+AI games.

---

### WR-01: `nextProgress` silently falls back to step 0 for unknown step IDs

**Files modified:** `src/engine/tutorial/progress.ts`, `src/engine/tutorial/progress.test.ts`
**Commit:** 227baa8
**Applied fix:** Added a guard in `nextProgress` immediately after `findIndex`: when `currentStepId` is non-null but not found in `def.steps` (i.e., `currentIndex === -1`), throw an actionable error that names the stale step ID and lists all known step IDs. The previous silent fallback to index 0 violated the project's fail-loud mandate and would silently corrupt tutorial progress after any step rename or removal. Three new tests added: stale ID throws, error message is actionable (lists known steps), and `null` currentStepId still advances from index 0 (the initial-advance path, which was the only legitimate use of the fallback).

---

### WR-02: Multi-seat gate-drift detection silently skips uninitialized seats in `simulateTutorial`

**Files modified:** `src/testing/simulate-tutorial.ts`, `src/testing/simulate-tutorial.test.ts`
**Commit:** 015de8b
**Applied fix:** Before executing scenario moves, `simulateTutorial` now collects all seats referenced in the scenario (primary seat plus all `move.seat` overrides), then initializes tutorial progress for any seat that doesn't already have it. This ensures `getTutorialDisabledActions(moveSeat)` returns the real disabled-action map for every non-primary seat rather than silently returning `{}`. Two new tests added: gate violation on a non-primary seat now throws as expected, and a two-seat scenario using the gate-allowed action completes without error.

---

### WR-03: `afterTurns` has no validation for non-positive `n`

**Files modified:** `src/engine/tutorial/predicates.ts`, `src/engine/tutorial/predicates.test.ts`
**Commit:** 9ec25b3
**Applied fix:** Added an early guard at the top of `afterTurns(n)` that throws when `n` is not a positive integer (`!Number.isInteger(n) || n <= 0`). Without this, `afterTurns(0)` would fire immediately at game start (completedTurns >= 0 is always true), and `afterTurns(-5)` would do the same — both silently skipping tutorial steps before the learner takes any action. Error message names the bad value and suggests `afterFirstTurn()` for the common n=1 case. Four new tests: n=0, n<0, non-integer all throw; error message is actionable and mentions `afterFirstTurn()`.

---

### WR-04: `resolveSeatForPlayer` returns 0-indexed positions from the `playerIds` fallback

**Files modified:** `src/session/game-session.ts`, `src/session/lobby-identity-security.test.ts`
**Commit:** 7730cce
**Applied fix:** Changed `return idx` to `return idx + 1` in the `playerIds` fallback path of `resolveSeatForPlayer`. The first player in `playerIds` was getting seat 0 (the spectator position), which caused `performAction` to reject their moves (it rejects `player < 1`) and `broadcast()` to treat them as a spectator. Every subsequent player was also off by one. The fix aligns the fallback path with the lobby path, which already returns 1-indexed seats. The existing non-lobby test was updated to assert the correct 1-indexed values (it was previously asserting the buggy 0-indexed values, silently validating the broken behavior).

---

_Fixed: 2026-06-26T10:06:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
