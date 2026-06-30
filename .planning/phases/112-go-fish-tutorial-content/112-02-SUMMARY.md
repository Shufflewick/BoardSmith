---
phase: 112-go-fish-tutorial-content
plan: "02"
subsystem: go-fish (cross-repo)
tags: [tutorial, go-fish, preset, game-definition, card-anchoring]
dependency_graph:
  requires: ["112-01"]
  provides: ["112-03", "112-04"]
  affects: ["go-fish/src/rules/game.ts", "go-fish/src/rules/tutorial.ts", "go-fish/src/rules/index.ts"]
tech_stack:
  added: []
  patterns:
    - "TutorialDefinition.setup() → resetToTutorialPreset() on GoFishGame"
    - "gate.selections.rank { value: primitive } — enabled by Wave 1 matcher fix (112-01)"
    - "advanceWhen predicates reading game state only (TutorialGateContext has no lastActionResult)"
    - "Option A pond positioning: putInto(pond) re-adds card at stacking-order top"
key_files:
  created:
    - /Users/jtsmith/BoardSmithGames/go-fish/src/rules/tutorial.ts
    - /Users/jtsmith/BoardSmithGames/go-fish/tests/tutorial-preset.test.ts
  modified:
    - /Users/jtsmith/BoardSmithGames/go-fish/src/rules/game.ts
    - /Users/jtsmith/BoardSmithGames/go-fish/src/rules/index.ts
decisions:
  - "Option A preset confirmed: putInto(pond) on a card already in the pond re-positions it at the stacking-order top (draw-first position). TUTORIAL_PRESET_POND_SIZE = 48."
  - "Step ordering (Option A): ask-for-rank → turn-continuation → go-fish-tip → book-formed. Steps 3+4 auto-advance via pump after the second action."
  - "advanceWhen predicates: (1) hand.count>3 for ask-hit, (2+3) pond.count<48 for go-fish draw, (4) bookCount>0 for book formed."
  - "tutorial-preset.test.ts updated in Task 2 to add registration smoke tests (import GO_FISH_TUTORIAL). Minor plan deviation: test file modified in both tasks."
metrics:
  duration_seconds: 435
  completed_date: "2026-06-30"
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
  files_modified: 2
---

# Phase 112 Plan 02: Go-Fish Tutorial Content — Preset + Definition Summary

One-liner: Deterministic 7H/7D/QH tutorial deal (Option A, 7C at pond top) + GO_FISH_TUTORIAL four-beat TutorialDefinition wired on gameDefinition.

## What Was Built

### Task 1: Deterministic tutorial preset on GoFishGame (go-fish repo)

- Added `tutorialSetup?: boolean` to `GoFishOptions`
- Constructor branches on `tutorialSetup`: when `true`, calls `resetToTutorialPreset()` instead of `shuffle()+dealCards()`
- `resetToTutorialPreset()`: returns all hand/book cards to pond, zeroes `bookCount` for all players, deals named cards:
  - Learner (seat 1): `7H`, `7D`, `QH`
  - Opponent (seat 2): `7S`
  - Calls `this.first(Card, '7C')!.putInto(this.pond)` LAST to position 7C at the draw-first slot
- **Option A confirmed**: `putInto(pond)` on a card already in the pond re-positions it at the top of the stacking order (last-in = first-drawn). Verified by test: `pond.drawTo(hand, 1, Card)` returns the card named `'7C'`.

**TUTORIAL_PRESET_POND_SIZE = 48** (52 total − 3 P1 cards − 1 P2 card)

### Task 2: GO_FISH_TUTORIAL definition + gameDefinition wiring

Created `src/rules/tutorial.ts` exporting `GO_FISH_TUTORIAL: TutorialDefinition` with four beats:

| Step ID | Beat | Gate | advanceWhen | Fires when |
|---------|------|------|-------------|------------|
| `ask-for-rank` | GFT-01 | ask, rank={value:'7'}, target={value:2}; suppressAutoFill | hand.count > 3 | P1 got 7S from P2 (hand 3→4) |
| `turn-continuation` | GFT-04 | ask (broad) | pond.count < 48 | P1 drew from pond on go-fish miss |
| `go-fish-tip` | GFT-02 | ask (broad) | pond.count < 48 | Fires immediately via pump (same condition already true) |
| `book-formed` | GFT-03 | ask (broad) | bookCount > 0 | 4×7 book formed after drawing 7C |

Steps 3 and 4 auto-advance consecutively in a single pump call after action 2. Both appear in `stepsVisited` because `recordCurrentStep()` runs after each pump advance.

Content overlay on `ask-for-rank`:
- `target: { kind: 'element', ref: { name: '7H' } }` — anchors to the learner's held seven
- `placement: 'top'`

All four `advanceWhen` predicates read game state only (`TutorialGateContext = { game, seat }` — no `lastActionResult`). Verified by test (function `.toString()` check).

Wired in `index.ts`:
```typescript
tutorial: GO_FISH_TUTORIAL  // on gameDefinition
export { GO_FISH_TUTORIAL } from './tutorial.js'  // for test imports
```

This is the one line that lights up the v4.1 ControlsMenu "Start tutorial" affordance in GameShell and `boardsmith dev` host (GFT-05).

## Preset Option: A (Confirmed)

Option A was chosen and verified:
- P1: `[7H, 7D, QH]` — 2 sevens + 1 queen
- P2: `[7S]` — the fourth seven
- Pond: 48 cards, `7C` at top (stacking draw-first position)

Assumption A1 confirmed: `putInto(pond)` when the card is already in the pond removes it and re-adds at the top of the stacking order. The draw-order test (`pond.drawTo(hand, 1, Card)` → `'7C'`) passes deterministically.

Option B (P1=[7H,7D,7C,QH], no pond-order dependency) was not needed.

## Tutorial Scenario (Option A)

Two-action walkthrough:
1. P1 asks P2 for '7' (gated) → P2 gives 7S → P1 hand 3→4 → advanceWhen fires → `turn-continuation`
2. P1 asks P2 for 'Q' (extra turn, miss) → Go Fish → draws 7C → 4×7 book forms → pump: `go-fish-tip` then `book-formed` → tutorial completed

`stepsVisited`: `['ask-for-rank', 'turn-continuation', 'go-fish-tip', 'book-formed']`

## Test Results

| Suite | Files | Tests | Result |
|-------|-------|-------|--------|
| go-fish `npm test` | 3 | 45 | PASS |
| BoardSmith `npm test` | 123 | 1708 | PASS (no regression) |

### tutorial-preset.test.ts coverage (15 tests)

- `tutorialSetup preset` (5): hand names, pond count, first-draw is 7C, standard deal unaffected
- `GoFishGame.resetToTutorialPreset` (2): live-game reset, bookCount zeroing
- `gameDefinition.tutorial registration` (8): tutorial defined, 4 steps, step IDs, tutorial===GO_FISH_TUTORIAL, suppressAutoFill+gate shape, content overlay anchor, no lastActionResult in predicates, setup defined

## Deviations from Plan

### Auto-applied during execution

**1. [Task boundary deviation] tutorial-preset.test.ts updated in both Task 1 and Task 2**
- **Found during:** Task 2 planning
- **Issue:** Task 1 wrote tutorial-preset.test.ts without GO_FISH_TUTORIAL imports (not yet created). Task 2 needed to update the test file to add registration smoke tests, but the plan listed tutorial-preset.test.ts only in Task 1's files.
- **Fix:** Updated tutorial-preset.test.ts in Task 2 to add the registration describe block and import GO_FISH_TUTORIAL / gameDefinition. This is the natural split matching checkers' tutorial-preset.test.ts structure.
- **Files modified:** `tests/tutorial-preset.test.ts`

None of the auto-fix rules (1-3) or architectural rules (4) were triggered. No bugs found, no missing critical functionality beyond what was planned, no blocking issues.

## Known Stubs

None. All tutorial beats are fully wired: gates enforce selection constraints, advanceWhen predicates read live game state, content text is instructional (not placeholder), and the overlay anchor resolves to a named card in the learner's hand.

## Threat Flags

None. Tutorial content is authored TypeScript constants compiled into the trusted game bundle. No new network endpoints, auth paths, or untrusted input surfaces were introduced.

## Self-Check: PASSED

- [x] `/Users/jtsmith/BoardSmithGames/go-fish/src/rules/game.ts` — exists with `resetToTutorialPreset()`
- [x] `/Users/jtsmith/BoardSmithGames/go-fish/src/rules/tutorial.ts` — exists with `GO_FISH_TUTORIAL`
- [x] `/Users/jtsmith/BoardSmithGames/go-fish/src/rules/index.ts` — contains `tutorial: GO_FISH_TUTORIAL`
- [x] `/Users/jtsmith/BoardSmithGames/go-fish/tests/tutorial-preset.test.ts` — exists with 15 tests
- [x] go-fish repo commits: `c241bdb` (Task 1), `39b3998` (Task 2)
- [x] 45/45 go-fish tests pass
- [x] 1708/1708 BoardSmith tests pass
