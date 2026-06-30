---
phase: 112-go-fish-tutorial-content
plan: "03"
subsystem: go-fish (cross-repo)
tags: [tutorial, go-fish, ci-test, regression, TDD]
dependency_graph:
  requires: ["112-02"]
  provides: ["112-04"]
  affects: ["go-fish/tests/tutorial.test.ts"]
tech_stack:
  added: []
  patterns:
    - "simulateTutorial + assertTutorialCompletes for CI-verifiable tutorial walkthrough"
    - "Monkey-patch on TestGame.game to construct deliberate rule breaks"
    - "Two-action scenario matching Option A preset (ask '7' hit → ask 'Q' go-fish)"
key_files:
  created:
    - /Users/jtsmith/BoardSmithGames/go-fish/tests/tutorial.test.ts
  modified: []
decisions:
  - "Option A two-action scenario: ask target=2 rank='7' (hit → advance to turn-continuation) then ask target=2 rank='Q' (go-fish → draws 7C → book formed → advance to book-formed). Confirmed expectStep 'book-formed' for action 2 works because completed tutorials retain the last stepId."
  - "go-fish-tip not asserted in stepsVisited: simulateTutorial calls recordCurrentStep() once per action (after the full pump), not per internal pump advance. go-fish-tip fires and immediately auto-advances to book-formed in the same autoAdvanceTutorial call, so it is never the resting state when the snapshot is taken. Asserted only ask-for-rank, turn-continuation, book-formed."
  - "Primary break (checkForBooks = () => []): bookCount stays 0; book-formed.advanceWhen never fires; assertTutorialCompletes throws /Tutorial/. Assumption A2 confirmed: the only player.bookCount++ is inside checkForBooks (game.ts line 232)."
  - "Secondary break (getCardsOfRank = () => [] + non-seven moved to pond top): forces go-fish on first ask with a non-matching draw (drewMatch=false → extraTurn=false). Turn ends. GameRunner.performAction checks canPlayerAct(1) — returns false when it is seat 2's turn — so second seat-1 ask throws 'Tutorial scenario: action ask ... failed. Error: Not Learner's turn' which matches /Tutorial/."
metrics:
  duration_seconds: 210
  completed_date: "2026-06-30"
  tasks_completed: 2
  tasks_total: 2
  files_created: 1
  files_modified: 0
---

# Phase 112 Plan 03: Go-Fish Tutorial CI Walkthrough Summary

One-liner: CI-verifiable two-action tutorial walkthrough (ask-for-rank + turn-continuation) + two deliberate rule breaks (checkForBooks + turn-continuation) both going red against the intact tutorial.

## What Was Built

### Task 1: Green walkthrough — tutorial completes, all teaching beats visited

Created `tests/tutorial.test.ts` in the go-fish repo with:

- `TestGame.create(GoFishGame, { playerCount: 2, playerNames: ['Learner','Opponent'], seed: 'go-fish-tutorial-pinned', tutorialSetup: true })`
- Two-action Option A scenario:
  1. `{ action: 'ask', args: { target: 2, rank: '7' }, expectStep: 'turn-continuation' }` — P2 gives 7S, hand grows 3→4, ask-for-rank.advanceWhen fires
  2. `{ action: 'ask', args: { target: 2, rank: 'Q' }, expectStep: 'book-formed' }` — go fish, draws 7C, four sevens form book, pump: turn-continuation → go-fish-tip → book-formed → completed
- `assertTutorialCompletes(result)` passes
- `stepsVisited` contains 'ask-for-rank', 'turn-continuation', 'book-formed'

### Task 2: Green→red proof — broken go-fish rules fail the test

**Primary break** (`checkForBooks = () => []`):
- `bookCount` never increments (Assumption A2 confirmed — only one `bookCount++` in game.ts, inside `checkForBooks`)
- `book-formed.advanceWhen` (`player.bookCount > 0`) never fires → tutorial stalls at `book-formed` (status 'running')
- `assertTutorialCompletes(result)` throws "Tutorial did not complete. Final step: 'book-formed'..." → matches `/Tutorial/`

**Secondary break** (GFT-04 proof, option-independent):
- `game.getCardsOfRank = () => []` — every ask goes fish (no cards transferred → no `extraTurn: true` from hit path)
- A non-seven card moved to pond stacking top (above 7C) — ensures go-fish draw gets a non-seven so `drewMatch = false` → `extraTurn = false` via the lucky-draw path too. Pond stays at 48 cards (card repositioned, not removed), preventing premature pump fires.
- After action 1: `extraTurn = false` → flow `execute` block sets `turnEnded = true` → learner's turn ends (seat 2's turn)
- Scenario's action 2 (seat 1 asks for 'Q'): `GameRunner.performAction` checks `canPlayerAct(1)` → `false` → returns `{ success: false, error: "Not Learner's turn" }` → `simulateTutorial` throws "Tutorial scenario: action 'ask' by seat 1 ... failed." → matches `/Tutorial/`

## Test Results

| Suite | Files | Tests | Result |
|-------|-------|-------|--------|
| go-fish `npm test -- tutorial` | 2 | 18 | PASS |
| go-fish `npm test` | 4 | 48 | PASS |
| BoardSmith `npm test` | 123 | 1708 | PASS (no regression) |

**Go-fish commit:** `1d6e171` (test(112-03): add CI tutorial walkthrough for Go Fish (GFT-06))

## Deviations from Plan

### Auto-applied during execution

**1. [Rule 1 - Correction] go-fish-tip not asserted in stepsVisited**
- **Found during:** Task 1 implementation
- **Issue:** The 112-02-SUMMARY and 112-03-PLAN claimed that all four step ids (`ask-for-rank`, `turn-continuation`, `go-fish-tip`, `book-formed`) would appear in `stepsVisited`. Analysis of `simulateTutorial` source reveals that `recordCurrentStep()` is called ONCE per action (after the full `autoAdvanceTutorial` pump), not once per individual pump advance. Since `go-fish-tip` fires and immediately auto-advances to `book-formed` in the same pump call (both steps share `pond.count < 48` as their `advanceWhen`), `go-fish-tip` is never the resting state when the snapshot is taken.
- **Fix:** Removed the `stepsVisited.toContain('go-fish-tip')` assertion. Added an explanatory comment in the test documenting this expected DSL behaviour.
- **Verification:** Test runs confirmed: stepsVisited = ['ask-for-rank', 'turn-continuation', 'book-formed']. go-fish-tip is visited (the pump passes through it) but is not observable via stepsVisited at this granularity.
- **Impact:** GFT-02's teaching content still fires during the tutorial run (the step is traversed — the learner sees it); it is simply not verifiable via stepsVisited with the current DSL.

## Assumption A2 Verification

`player.bookCount` is incremented **ONLY** inside `GoFishGame.checkForBooks()`:
- Single `player.bookCount++` at `game.ts:232` inside `checkForBooks`
- `resetToTutorialPreset()` zeros bookCount (`player.bookCount = 0`) but never increments
- `getTotalBooks()`, `isFinished()`, `getWinners()` read bookCount but do not modify it
- No other mutation of `bookCount` exists in the codebase

Patching `testGame.game.checkForBooks = () => []` is the minimal and sufficient patch to prevent book formation.

## Known Stubs

None. The test is a live regression artifact: all three test cases execute real game state via the engine's `autoAdvanceTutorial` and `GameRunner.performAction` machinery — no mocks of engine internals.

## Threat Flags

None. Test-only code; no new network endpoints, auth paths, or schema changes.

## Self-Check: PASSED

- [x] `/Users/jtsmith/BoardSmithGames/go-fish/tests/tutorial.test.ts` — exists (created 237 lines)
- [x] go-fish repo commit: `1d6e171`
- [x] go-fish tests: 48/48 pass (all 4 test files)
- [x] BoardSmith tests: 1708/1708 pass (no regression)
- [x] Green test: `assertTutorialCompletes` passes, stepsVisited contains 'ask-for-rank', 'turn-continuation', 'book-formed'
- [x] Primary break: `expect(() => { simulateTutorial; assertTutorialCompletes }).toThrow(/Tutorial/)` passes
- [x] Secondary break: same pattern, throws due to `Not Learner's turn` enforcement in `performAction`
