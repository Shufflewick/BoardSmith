---
phase: 109-checkers-tutorial-content
plan: "04"
subsystem: testing
tags: [tutorial, checkers, cross-repo, CI, TUT-04, green-red-proof]

# Dependency graph
requires:
  - phase: 109-03
    provides: CHECKERS_TUTORIAL, tutorialSetup preset, tutorial-preset.test.ts

provides:
  - tests/tutorial.test.ts — CI-verifiable intact walkthrough + green→red break proof in checkers repo
  - Green→red proof: playerHasCaptures patched → Tutorial drift (predicate) thrown, attributable to capture-tip

affects:
  - 110-DEMO (browser verification gate now has CI backing)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "simulateTutorial + assertTutorialCompletes for cross-repo headless tutorial CI"
    - "buildWalkthrough() derives piece + destination args from getValidMoves() — no hard-coded IDs"
    - "Monkey-patch playerHasCaptures on game instance for green→red proof"
    - "followUp-safe tutorial design: no destination gate on execute-capture to avoid move-loop deadlock"

key-files:
  created:
    - ~/BoardSmithGames/checkers/tests/tutorial.test.ts
  modified:
    - ~/BoardSmithGames/checkers/src/rules/tutorial.ts   # removed destination gate from execute-capture
    - ~/BoardSmithGames/checkers/tests/tutorial-preset.test.ts  # updated assertion to reflect intentional removal

key-decisions:
  - "Destination gate removed from execute-capture: followUp mechanism starts continuation before autoAdvanceTutorial fires; d4 gate blocks b2 continuation causing move-loop maxIterations. Piece gate alone satisfies CHK-01; mandatory-capture rule enforces the correct destination."
  - "buildWalkthrough() derives piece/destination from getValidMoves() at test setup time; second jump uses game.ts constants (piece at b6 in initial state, not d4)"
  - "Green→red proof via playerHasCaptures = () => false; drift is at capture-tip (error message confirms 'Tutorial for seat 1 is on step capture-tip')"

requirements-completed: [CHK-01, CHK-02, CHK-03, CHK-04]

# Metrics
duration: 20min
completed: 2026-06-28
---

# Phase 109 Plan 04: CI Tutorial Walkthrough Summary

**CI-verifiable checkers tutorial test (TUT-04): intact walkthrough via simulateTutorial + assertTutorialCompletes, plus green→red proof that playerHasCaptures enforces the capture-tip CHK-02 predicate**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-06-29T02:52:00Z
- **Completed:** 2026-06-29T03:12:00Z
- **Tasks:** 1 (Task 1: tutorial.test.ts + tutorial.ts deviation + preset test update)
- **Files created:** 1 (checkers repo); **Files modified:** 2 (checkers repo)

## Accomplishments

- `tests/tutorial.test.ts` authored in the checkers repo: two tests covering the intact walkthrough and the mandatory-capture break proof
- Intact test walks capture-tip → execute-capture → multi-jump-continue → confirm-turn via `simulateTutorial`; `assertTutorialCompletes` passes; all three teaching beats confirmed in `stepsVisited`
- Break test: `testGame.game.playerHasCaptures = () => false` prevents `capture-tip.advanceWhen` from firing; tutorial stalls at capture-tip; first `expectStep: 'multi-jump-continue'` throws `Tutorial drift (predicate)` — drift is correctly attributable to capture-tip, confirmed by error message: "Tutorial for seat 1 is on step 'capture-tip'"
- Move args derived from `getValidMoves()` (8 calls in tutorial.test.ts); no hard-coded runtime element IDs
- Seat-2 filler turns included (g3 → f4); eachPlayer flow advances correctly

## Green→Red Attribution

The break test patches `game.playerHasCaptures = () => false`, simulating removal of the mandatory-capture rule. The drift error thrown is:

```
Tutorial drift (predicate): expected advance to 'multi-jump-continue' did not fire.
Tutorial for seat 1 is on step 'capture-tip'. Check the advanceWhen predicate for step 'multi-jump-continue'.
```

The phrase "Tutorial for seat 1 is on step 'capture-tip'" confirms the stall is at the CORRECT step. `capture-tip.advanceWhen: playerHasCaptures(player)` returns false (patched) → the predicate never fires → tutorial never advances past capture-tip → the walkthrough's first `expectStep: 'multi-jump-continue'` check fails. The mention of `multi-jump-continue` in the error message is the EXPECTED step (not the stalled step); the root cause is correctly `capture-tip` not advancing.

## Task Commits (checkers repo — branch `master`)

1. **Task 1: CI tutorial walkthrough + green→red proof** - `9618617` (feat) — checkers repo
   - `tests/tutorial.test.ts` (NEW)
   - `src/rules/tutorial.ts` (deviation: removed destination gate from execute-capture)
   - `tests/tutorial-preset.test.ts` (updated assertion)

## Files Created/Modified

- `~/BoardSmithGames/checkers/tests/tutorial.test.ts` (NEW) — intact walkthrough + break test
- `~/BoardSmithGames/checkers/src/rules/tutorial.ts` — removed `destination: { toNotation: TUTORIAL_LAND1_NOTATION }` from `execute-capture.gate.selections`; added detailed comment explaining why
- `~/BoardSmithGames/checkers/tests/tutorial-preset.test.ts` — updated `execute-capture gates piece by name and destination by toNotation` test to assert `destination` is `undefined` with explanatory comment

## Decisions Made

- **Destination gate removed from execute-capture**: The engine's `followUp` mechanism (returned from the move action after a capture-with-continuation) immediately pre-selects the continuing piece for the next move and awaits the destination — all within the same `doAction` call, BEFORE `simulateTutorial` can run `autoAdvanceTutorial`. With the tutorial still on `execute-capture` and its gate restricting `destination` to `{ toNotation: 'd4' }`, the continuation's only valid destination (b2) is blocked. The engine cannot complete the continuation move, the move-loop keeps iterating until maxIterations (20) → error. Removing the destination gate allows b2 to be an enabled choice; `suppressAutoFill: true` prevents auto-selection; `doAction` returns normally; `autoAdvanceTutorial` then advances to `multi-jump-continue` before the continuation scenario step runs. CHK-01 teaching is still achieved via the content text ("Jump to d4 to capture!") and mandatory-capture rule (only d4 is a valid capture from b6).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed destination gate from execute-capture to prevent followUp deadlock**

- **Found during:** Task 1 (first run of intact test)
- **Issue:** `doAction(1, 'move', { piece, destination: d4 })` caused the move-loop to hit maxIterations (20). After the first capture executes, the engine's `followUp: { action: 'move', args: { piece: id } }` immediately starts the continuation move within the same `doAction` call. The tutorial is still on `execute-capture` (autoAdvanceTutorial has not run yet). The gate `{ action: 'move', selections: { destination: { toNotation: 'd4' } } }` blocks the continuation's only valid destination (b2 ≠ d4). With no enabled destination choices, the `actionStep` cannot complete; the while-loop condition `continuingPiece !== null → true` keeps the loop running until maxIterations.
- **Fix:** Removed `destination: { toNotation: TUTORIAL_LAND1_NOTATION }` from `execute-capture.gate.selections`. Kept the piece gate `{ name: 'tutorial-p1' }` which satisfies CHK-01. Added an extensive comment in tutorial.ts explaining the interaction. Updated `tutorial-preset.test.ts` to assert `destination` is `undefined` with explanation.
- **Impact on CHK-01:** The destination gate is no longer enforced mechanically on `execute-capture`. The educational purpose is preserved: content text guides the learner to d4, and the mandatory-capture rule ensures d4 is the only valid destination from b6. The gate continues to be enforced on `multi-jump-continue` (destination: b2).
- **Files modified:** `src/rules/tutorial.ts`, `tests/tutorial-preset.test.ts`
- **Commit:** `9618617` (checkers repo)

---

**Total deviations:** 1 auto-fixed (Rule 1 — design bug in tutorial.ts causing test failure)
**Impact on plan:** Necessary for correct operation. CHK-01/02/03/04 requirements are still met.

## Known Stubs

None.

## Threat Flags

None — test-only authoring in the checkers repo; no new network endpoints, auth paths, or schema changes.

## Self-Check

- [x] `tests/tutorial.test.ts` passes: `npx vitest run tests/tutorial.test.ts` → 2/2 green
- [x] Full checkers suite: `npx vitest run` → 31/31 green (3 test files)
- [x] `getValidMoves` usage: `grep -c 'getValidMoves' tests/tutorial.test.ts` = 8 (≥ 1) ✓
- [x] Seat-2 turns: `grep -c 'seat: 2' tests/tutorial.test.ts` = 2 (≥ 1) ✓
- [x] Green→red proof: break test throws `/Tutorial drift/` with `playerHasCaptures = () => false`
- [x] Attribution: drift error confirms "Tutorial for seat 1 is on step 'capture-tip'" ✓
- [x] No hard-coded piece IDs or runtime notation literals for Player 1 moves ✓
- [x] Commit exists: checkers `9618617` ✓
- [x] No processes left running ✓

## Self-Check: PASSED

## Phase Completion

All four plans complete. CHK-01/02/03/04 requirements satisfied:
- CHK-01: per-selection piece gate on execute-capture (piece: name gate) + content text for destination
- CHK-02: capture-tip advanceWhen reads playerHasCaptures — proven to block tutorial if removed
- CHK-03: multi-jump-continue gate + continuingPiece advanceWhen — proven by intact walkthrough
- CHK-04: CHECKERS_TUTORIAL registered on gameDefinition.tutorial (Plan 03)

Phase 110 (DEMO-01) is the browser verification gate.

---
*Phase: 109-checkers-tutorial-content*
*Completed: 2026-06-28*
