---
phase: 109-checkers-tutorial-content
plan: "03"
subsystem: testing
tags: [tutorial, checkers, cross-repo, TutorialDefinition, preset]

# Dependency graph
requires:
  - phase: 109-01
    provides: SelectionMatcher type + TutorialGateAllowList.selections per-selection gate API
  - phase: 109-02
    provides: startTutorial stateless op + hasTutorial broadcast signal + ControlsMenu launch item
provides:
  - tutorialSetup?: boolean option on CheckersOptions — deterministic two-jump preset for CI
  - CHECKERS_TUTORIAL TutorialDefinition — 4-step tutorial teaching CHK-01/02/03
  - gameDefinition.tutorial = CHECKERS_TUTORIAL — game advertises tutorial (drives hasTutorial)
  - TUTORIAL_PIECE_NAME, TUTORIAL_P1_NOTATION, TUTORIAL_LAND1_NOTATION, TUTORIAL_LAND2_NOTATION exports
  - tests/tutorial-preset.test.ts — 14-test preset + registration smoke suite in checkers repo
affects:
  - 109-04 (full simulateTutorial walkthrough + green->red proof builds on this preset + definition)
  - 110-DEMO (browser verification of the tutorial flow end-to-end)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "tutorialSetup game option: minimal deterministic preset via named constants + getSquareByNotation"
    - "Piece gate by { name } instead of { id }: stable across game instantiations, avoids runtime ID lookup"
    - "capture-tip advances immediately via initial auto-advance pump (playerHasCaptures true at start)"
    - "TestGameOptions [key: string]: unknown index signature + spread in create() enables game-specific options"

key-files:
  created:
    - ~/BoardSmithGames/checkers/src/rules/tutorial.ts
    - ~/BoardSmithGames/checkers/tests/tutorial-preset.test.ts
  modified:
    - ~/BoardSmithGames/checkers/src/rules/game.ts
    - ~/BoardSmithGames/checkers/src/rules/index.ts
    - src/testing/test-game.ts  # BoardSmith: TestGameOptions index signature + extra options spread

key-decisions:
  - "Piece gate uses { name: 'tutorial-p1' } not { id: N } — CheckerPiece has no .notation, and element IDs are runtime-assigned; the name is stable and set in placeTutorialPieces()"
  - "Tutorial preset position: P1 at b6, P2 at c5+c3 (jump path) + g3 (extra for valid P2 moves); chain b6->d4->b2 avoids king row (row 7)"
  - "capture-tip.advanceWhen fires immediately via initial pump — by design, the tip flashes and auto-advances to execute-capture; stepsVisited still records capture-tip"
  - "Extend TestGameOptions with [key: string]: unknown and spread extras into gameOptions so tutorialSetup passes to CheckersGame constructor (Rule 3 fix in BoardSmith)"

patterns-established:
  - "Tutorial preset: use getSquareByNotation + named-piece string to create deterministic positions without hard-coded row/col math"
  - "Cross-repo tutorial content: game.ts exports position constants; tutorial.ts imports them to build static TutorialDefinition; no circular refs"

requirements-completed: [CHK-01, CHK-02, CHK-03, CHK-04]

# Metrics
duration: 4min
completed: 2026-06-28
---

# Phase 109 Plan 03: Checkers Tutorial Content Summary

**CHECKERS_TUTORIAL teaching mandatory-capture + two-step gated move + multi-jump via deterministic b6->d4->b2 preset registered on gameDefinition**

## Performance

- **Duration:** 4 min
- **Started:** 2026-06-29T02:46:14Z
- **Completed:** 2026-06-29T02:50:35Z
- **Tasks:** 2 (Task 1: preset + test; Task 2: tutorial.ts + index.ts registration + extended test)
- **Files modified:** 5 (3 checkers repo, 1 BoardSmith test-game.ts, 1 new checkers tutorial.ts)

## Accomplishments

- `CheckersOptions.tutorialSetup?: boolean` routes to `placeTutorialPieces()` which places Player 1 at b6 with two Player 2 pieces in the jump path (c5, c3) and one extra at g3 — forces a two-jump chain without crowning
- `CHECKERS_TUTORIAL` (4 steps: capture-tip → execute-capture → multi-jump-continue → confirm-turn) authored against the Plan 01 per-selection gate API; uses `{ name: 'tutorial-p1' }` piece gate to avoid runtime ID dependency
- `gameDefinition.tutorial = CHECKERS_TUTORIAL` registered in `index.ts` — game now advertises a tutorial (drives `hasTutorial` signal from Plan 02)
- 14 tests in `tests/tutorial-preset.test.ts` covering preset correctness (6 tests) + registration smoke (8 tests); full checkers suite 29/29 green

## Task Commits (checkers repo — branch `master`)

1. **Task 1: tutorialSetup option + preset** - `548bde5` (feat) — checkers repo
2. **Task 2: CHECKERS_TUTORIAL + registration** - `e3e0542` (feat) — checkers repo

## BoardSmith repo commits

- **TestGameOptions extension (Rule 3 fix)** - `252c690` (feat) — allows `tutorialSetup` to pass through `TestGame.create` to the game constructor

## Files Created/Modified

- `~/BoardSmithGames/checkers/src/rules/game.ts` — Added `tutorialSetup?: boolean` to `CheckersOptions`; added `placeTutorialPieces()` private method; exported `TUTORIAL_P1_NOTATION`, `TUTORIAL_PIECE_NAME`, `TUTORIAL_LAND1_NOTATION`, `TUTORIAL_LAND2_NOTATION`
- `~/BoardSmithGames/checkers/src/rules/tutorial.ts` (NEW) — `CHECKERS_TUTORIAL` with 4 teaching steps; uses Plan 01 `selections` gate with piece by `{ name }` and destination by `{ toNotation }`
- `~/BoardSmithGames/checkers/src/rules/index.ts` — Added `CHECKERS_TUTORIAL` export + `tutorial: CHECKERS_TUTORIAL` on `gameDefinition`
- `~/BoardSmithGames/checkers/tests/tutorial-preset.test.ts` (NEW) — 14 tests: 6 preset + 8 registration smoke
- `src/testing/test-game.ts` (BoardSmith) — `TestGameOptions` index signature + extra options spread into `gameOptions`

## Decisions Made

- **Piece gate by `{ name }`** instead of `{ id }`: CheckerPiece has no `.notation`, and element IDs are assigned at runtime (not stable across game instantiations). The piece name 'tutorial-p1' is set in `placeTutorialPieces()` and is always stable. This satisfies CHK-01 per-selection gate requirement without needing runtime ID knowledge.
- **Preset board position** (b6 → d4 → b2, Player 2 at c5 + c3 + g3): chosen so both capture landings (rows 4 and 6) avoid the king row (row 7); after the second jump, no further captures from b2 are possible (row+2 = 8 is off-board), so `continuingPiece` clears naturally.
- **`capture-tip` design**: `advanceWhen: playerHasCaptures` fires immediately via the initial auto-advance pump (captures are forced from game start). The tip flashes and auto-advances to `execute-capture`. `stepsVisited` still records `capture-tip`. This avoids the "intro non-capture move + endTurn deadlock" pitfall.
- **TestGameOptions extension** (Rule 3 deviation): without `[key: string]: unknown` index signature + extra option spreading in `TestGame.create`, `tutorialSetup: true` could not be passed to `CheckersGame`. Extended the BoardSmith testing module to be the correct fix.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Extended TestGameOptions to forward extra options to game constructor**
- **Found during:** Task 1 (tutorial-preset.test.ts authoring)
- **Issue:** `TestGame.create(CheckersGame, { tutorialSetup: true })` fails because `TestGameOptions` only forwards `playerCount`, `playerNames`, and `seed` to `gameOptions`. `tutorialSetup` was silently dropped — the game would always use the standard 24-piece opening.
- **Fix:** Added `[key: string]: unknown` index signature to `TestGameOptions`; updated `TestGame.create` to destructure known fields and spread `...extraOptions` into `gameOptions` first (standard fields override extras).
- **Files modified:** `src/testing/test-game.ts`
- **Verification:** All 22 existing testing module tests still pass; `tutorialSetup: true` now reaches `CheckersGame` constructor
- **Committed in:** `252c690` (BoardSmith repo, separate stream)

---

**Total deviations:** 1 auto-fixed (Rule 3 — blocking)
**Impact on plan:** Necessary for correct operation. The fix is minimal and backward-compatible (no existing test behavior changes).

## Issues Encountered

**Pitfall 4 (advanceWhen fires before beat is shown):** Per RESEARCH, `capture-tip.advanceWhen: playerHasCaptures` fires immediately via the initial auto-advance pump because captures are forced at game start. The design decision was to accept this behavior — the capture-tip IS recorded in `stepsVisited`, it just auto-advances to `execute-capture` before any player action. The educational value is preserved (the UI shows the annotation briefly), and no extra "intro" step is needed.

**`whenForced` pitfall avoided:** `capture-tip` uses a custom `advanceWhen` predicate calling `playerHasCaptures(player)`. The acceptance criterion `grep -c whenForced src/rules/tutorial.ts` returns 2 (both in comments explaining why `whenForced` is NOT used). Zero usage in actual code.

## Known Stubs

None.

## Threat Flags

None — content-only authoring; no new network endpoints, auth paths, or schema changes.

## Self-Check

- [x] `CheckersOptions.tutorialSetup?: boolean` exists: `grep -c 'tutorialSetup' src/rules/game.ts` = 6 (≥ 2 required)
- [x] `tests/tutorial-preset.test.ts` passes (14/14 tests green)
- [x] `playerHasCaptures` in tutorial.ts: `grep -c 'playerHasCaptures' src/rules/tutorial.ts` = 3 (≥ 1)
- [x] `continuingPiece` in tutorial.ts: `grep -c 'continuingPiece' src/rules/tutorial.ts` = 10 (≥ 2)
- [x] `whenForced` NOT used in code: 2 occurrences in comments only, 0 in actual TypeScript expressions
- [x] `tutorial` in index.ts: `grep -c 'tutorial' src/rules/index.ts` = 3 (≥ 1)
- [x] Full checkers suite: 29 tests, all passing
- [x] BoardSmith TestGameOptions tests: 22 passing
- [x] Commits exist: checkers `548bde5`, `e3e0542`; BoardSmith `252c690`
- [x] No processes left running

## Self-Check: PASSED

## Next Phase Readiness

- CHK-01/02/03/04 content complete. `CHECKERS_TUTORIAL` is authored and registered.
- Plan 04 can add a full `simulateTutorial` walkthrough + green→red proof (the preset deterministically drives the full tutorial flow).
- Phase 110 (DEMO-01) is the browser verification gate for the complete checkers tutorial experience.

---
*Phase: 109-checkers-tutorial-content*
*Completed: 2026-06-28*
