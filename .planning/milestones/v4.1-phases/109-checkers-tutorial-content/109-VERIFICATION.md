---
phase: 109-checkers-tutorial-content
verified: 2026-06-28T23:05:00Z
status: human_needed
score: 5/5 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Open boardsmith dev host with the checkers game, click Controls > Tutorial > Start tutorial, and walk through all four steps (capture-tip auto-advance, piece selection gate enforced, destination highlighted, multi-jump continuation, End Turn)"
    expected: "Tutorial starts, capture-tip annotation appears briefly and auto-advances, execute-capture forces selection of tutorial-p1 piece, destination annotation highlights d4, multi-jump-continue step advances after second capture to b2, confirm-turn shows and completes on End Turn"
    why_human: "DEMO-01 browser visual is the Phase 110 gate. CHK-04's GameShell + dev host rendering requires a live browser to confirm annotations render, the ControlsMenu 'Start tutorial' item appears, and the tutorial UX flows correctly. Automated tests confirm all substrate wiring but not visual output."
---

# Phase 109: Checkers Tutorial Content — Verification Report

**Phase Goal:** A complete, launchable, CI-verifiable checkers tutorial that teaches the two-step move, mandatory-capture rule, and forced multi-jump.
**Verified:** 2026-06-28T23:05:00Z
**Status:** human_needed
**Re-verification:** No — initial verification.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | CHK-01: A new player can complete a guided tutorial teaching two-step piece-selection → destination move, using action gating (TUT-02) and annotation overlays (TUT-01) | ✓ VERIFIED | `execute-capture` step: piece gate `{ name: 'tutorial-p1' }` on `selections.piece` enforced in action pipeline; two annotation overlays with `target` present (piece + d4 square). Destination gate removed by documented limitation (followUp/doAction synchrony); destination constrained by mandatory-capture rule to d4. Piece gate demonstrates TUT-02; overlays demonstrate TUT-01. See Limitation note. |
| 2 | CHK-02: A predicate-triggered tip explains mandatory-capture the first time a capture becomes forced | ✓ VERIFIED | `capture-tip` step with `advanceWhen: playerHasCaptures(player)` — content "A capture is available — in checkers, you MUST take it!"; green→red proof confirms patching `playerHasCaptures = () => false` causes `Tutorial drift (predicate)` at capture-tip. |
| 3 | CHK-03: Tutorial walks player through forced multi-jump (turn does not end while further jumps exist) | ✓ VERIFIED | `multi-jump-continue` step with destination gate `{ toNotation: 'b2' }` and `advanceWhen: continuingPiece === null`; intact walkthrough test confirms step appears in `stepsVisited`. `capture-tip` → `execute-capture` → `multi-jump-continue` all recorded. |
| 4 | CHK-04: Tutorial launchable from game and runs inside both GameShell and the boardsmith dev host | ✓ VERIFIED | `CHECKERS_TUTORIAL` registered on `gameDefinition.tutorial` in checkers `index.ts`; `hasTutorial` signal flows through `buildPlayerState`; `ControlsMenu` renders "Start tutorial" when `hasTutorial=true`; `GameShell` calls `platformRequest('start-tutorial', ...)` on the emit; `bridge.ts` routes `start-tutorial` → `{ type: 'startTutorial' }`; `stateless-ops.ts` handles `startTutorial` case; CR-01 fix wires `autoAdvanceTutorial` after every `handleAction` and `handleSelectionStep` in stateless path. |
| 5 | TUT-04: Tutorial is a CI-verifiable artifact — a checkers-rules change that breaks it fails a test | ✓ VERIFIED | `~/BoardSmithGames/checkers/tests/tutorial.test.ts`: intact walkthrough (2/2 passing) via `simulateTutorial` + `assertTutorialCompletes`; break test patches `playerHasCaptures = () => false` → throws `/Tutorial drift/`; green→red attribution confirmed by error text "Tutorial for seat 1 is on step 'capture-tip'". |

**Score:** 5/5 truths verified (automated). 1 human visual check outstanding (browser UX deferred to Phase 110 DEMO-01).

### CHK-01 Destination Gate Limitation — Assessment

The `execute-capture` step's `destination` selection is not gated by `{ toNotation: 'd4' }`. The removal is intentional and documented (see `tutorial.ts` lines 90-103): `TestGame.doAction()` sends all move args synchronously; the engine's `followUp` re-enters the action step within the same `performAction` call before `autoAdvanceTutorial` fires, causing the destination gate to block the continuation move (b2 ≠ d4), exhausting `maxIterations`. The production WebSocket path (two separate `selectionStep` round-trips) would not have this problem since `handleSelectionStep` calls `autoAdvanceTutorial` between them (CR-01 fix).

**Judgment: Acceptable documented limitation.** CHK-01 requires teaching the two-step move "using action gating and annotation overlays." The piece selection IS gated. Both steps have annotation overlays with `target` elements (piece highlight + destination highlight). The mandatory-capture rule constrains the destination to d4 without a gate — the lesson is intact. The destination gate omission is a test-infrastructure constraint, not a production constraint. This is not a gap.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/engine/tutorial/types.ts` | `SelectionMatcher` type + `TutorialGateAllowList.selections` map | ✓ VERIFIED | `SelectionMatcher = Record<string, unknown>` at line 125; `selections?: Record<string, SelectionMatcher>` at line 154; `from`/`to` removed (grep returns 0 in non-comment code) |
| `src/engine/tutorial/gate.ts` | `getGateReasonForValue(step, actionName, value, selectionName)` + `selectionMatchesValue` | ✓ VERIFIED | 4th param `selectionName: string` at line 154; `selectionMatchesValue` at line 66; per-selection branch at lines 170-173 |
| `src/engine/index.ts` | `SelectionMatcher` exported | ✓ VERIFIED | `SelectionMatcher` at line 249 of index.ts |
| `src/engine/action/action.ts` | All 3 `getGateReasonForValue` call sites pass `selection.name` | ✓ VERIFIED | Lines 388, 440, 460 confirmed |
| `src/session/stateless-ops.ts` | `startTutorial` op + `autoAdvanceTutorial` wired post-action (CR-01 fix) | ✓ VERIFIED | Op union at line 61; `executeOp` case at line 749; `autoAdvanceTutorial` imported and called at lines 262, 321, 767; seat guard at line 754 (WR-01) |
| `src/ui/components/ControlsMenu.vue` | `hasTutorial` prop + Tutorial group template | ✓ VERIFIED | `hasTutorial?: boolean` at line 48; Tutorial group template at lines 310-318 with `v-if="hasTutorial"` |
| `src/ui/components/GameShell.vue` | `platformRequest('start-tutorial')` + `hasTutorialProp` computed + `:has-tutorial` binding | ✓ VERIFIED | Lines 699-700, 756-758, 1933 |
| `src/cli/dev-host/bridge.ts` | `start-tutorial` in WireOp + translateOp + shapeResult | ✓ VERIFIED | Lines 27, 127, 192 |
| `src/cli/commands/dev.ts` | `tutorial: gameDefinition.tutorial` in gameDef | ✓ VERIFIED | Lines 572-575 |
| `~/BoardSmithGames/checkers/src/rules/tutorial.ts` | `CHECKERS_TUTORIAL` with 4 steps | ✓ VERIFIED | 4 steps: capture-tip (CHK-02), execute-capture (CHK-01), multi-jump-continue (CHK-03), confirm-turn |
| `~/BoardSmithGames/checkers/src/rules/game.ts` | `tutorialSetup?: boolean` + `placeTutorialPieces()` + exported constants | ✓ VERIFIED | `tutorialSetup` at line 49; constants at lines 26-30; `placeTutorialPieces` wired via `placePieces` at line 94 |
| `~/BoardSmithGames/checkers/src/rules/index.ts` | `CHECKERS_TUTORIAL` exported + registered on `gameDefinition.tutorial` | ✓ VERIFIED | Export at line 7; `tutorial: CHECKERS_TUTORIAL` at line 46 |
| `~/BoardSmithGames/checkers/tests/tutorial.test.ts` | Intact walkthrough + green→red break proof | ✓ VERIFIED | 2/2 tests pass; `stepsVisited` asserted for all 3 teaching beats; break test throws `/Tutorial drift/` |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `ControlsMenu.vue` | `GameShell.vue` | `'teaching-action', 'start-tutorial'` emit | ✓ WIRED | `emit('teaching-action', 'start-tutorial')` in ControlsMenu; `handleTeachingAction` branch in GameShell |
| `GameShell.vue` | `stateless-ops.ts` | `platformRequest('start-tutorial', { seat })` → bridge.ts translateOp → `startTutorial` | ✓ WIRED | bridge.ts line 127 translates; stateless-ops line 749 handles |
| `stateless-ops.ts` | tutorial step advancement | `autoAdvanceTutorial` post-action in `handleAction`/`handleSelectionStep`/`startTutorial` | ✓ WIRED | Lines 262, 321, 767 |
| `checkers/index.ts` | `hasTutorial` in broadcast | `gameDefinition.tutorial` → `dev.ts` → `runnerFromSnapshot` → `buildPlayerState` | ✓ WIRED | `tutorial: gameDefinition.tutorial` in dev.ts; `hasTutorial = true` in buildPlayerState when `tutorialDefinition` set |
| `CHECKERS_TUTORIAL` | CI test | `simulateTutorial` + `assertTutorialCompletes` in tutorial.test.ts | ✓ WIRED | `simulateTutorial(testGame, CHECKERS_TUTORIAL, { seat: 1, scenario: WALKTHROUGH })` passes |
| `capture-tip.advanceWhen` | green→red proof | `playerHasCaptures = () => false` → Tutorial drift | ✓ WIRED | Break test confirms stall at capture-tip when rule removed |

### Data-Flow Trace (Level 4)

The tutorial definition flows: `gameDefinition.tutorial` (checkers/index.ts) → `dev.ts` gameDef `tutorial` field → `GameDefinitionLike.tutorial` → `runnerFromSnapshot` re-attaches `tutorialDefinition` to `runner.game` → `buildPlayerState` emits `hasTutorial: true` → `GameShell` `hasTutorialProp` computed → `:has-tutorial` on `ControlsMenu`. Verified by grep across all boundary files and stateless-ops.test.ts assertions.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Tutorial test suite (intact + break) | `npx vitest run tests/tutorial.test.ts` (checkers) | 2/2 passed | ✓ PASS |
| Full checkers suite | `npx vitest run` (checkers) | 31/31 passed | ✓ PASS |
| Gate unit tests | `npx vitest run src/engine/tutorial/gate.test.ts` | 13/13 passed | ✓ PASS |
| Action pipeline gate tests | `npx vitest run src/engine/action/tutorial-gate.test.ts` | 33/33 passed | ✓ PASS |
| stateless-ops suite (incl. CR-01 regression) | `npx vitest run src/session/stateless-ops.test.ts` | 18/18 passed | ✓ PASS |
| Full BoardSmith suite | `npx vitest run` (BoardSmith) | 1593/1593 passed | ✓ PASS |

### Probe Execution

No `probe-*.sh` files declared or found for this phase.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| CHK-01 | 109-01, 109-03 | Guided tutorial teaching two-step move with gating + overlays | ✓ SATISFIED | Piece gate on execute-capture; two overlays with targets; destination constrained by rule (see Limitation note) |
| CHK-02 | 109-03 | Predicate-triggered tip for mandatory-capture | ✓ SATISFIED | capture-tip step with `playerHasCaptures` advanceWhen; green→red proof passes |
| CHK-03 | 109-03 | Forced multi-jump walkthrough | ✓ SATISFIED | multi-jump-continue step; confirmed in stepsVisited in intact walkthrough |
| CHK-04 | 109-02, 109-03 | Launchable from game in GameShell and dev host | ✓ SATISFIED | gameDefinition.tutorial registered; hasTutorial signal; ControlsMenu item; bridge routing; CR-01 fix |
| TUT-04 | 109-04 | CI-verifiable tutorial artifact | ✓ SATISFIED | tutorial.test.ts 2/2 passing; green→red break proof via playerHasCaptures patch |

### Anti-Patterns Found

Scanned all files modified in this phase: `src/engine/tutorial/types.ts`, `gate.ts`, `action.ts`, `index.ts`, `src/session/stateless-ops.ts`, `src/ui/components/ControlsMenu.vue`, `GameShell.vue`, `src/cli/dev-host/bridge.ts`, `src/cli/commands/dev.ts`, `src/testing/test-game.ts`, `~/BoardSmithGames/checkers/src/rules/tutorial.ts`, `game.ts`, `index.ts`, `tests/tutorial.test.ts`.

No `TBD`, `FIXME`, `XXX`, `TODO`, `HACK`, `PLACEHOLDER`, or `return null`/`return []`/`return {}` stub patterns found in phase-modified files. The WR-03 `as any` cast was fixed to `as Game`. The documented destination-gate omission is a design comment, not a stub.

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | None found | — | — |

### Human Verification Required

#### 1. End-to-End Tutorial UX in Browser (DEMO-01 Gate)

**Test:** Run `npx boardsmith dev` in the checkers game directory. Open two browser tabs (Player 1 and Player 2). In Player 1's tab, open Controls > Tutorial > Start tutorial. Walk through all four steps.

**Expected:**
- "Start tutorial" item appears in the Tutorial section of the Controls menu (requires `hasTutorial=true` in broadcast)
- `capture-tip` annotation appears briefly: "A capture is available — in checkers, you MUST take it!" then auto-advances to `execute-capture`
- `execute-capture` step: piece highlight on tutorial-p1 (b6), "Select your piece." annotation; destination highlight on d4, "Jump to d4 to capture!" annotation; attempting to select any other piece produces a disabled-reason UI
- After jump b6→d4: `multi-jump-continue` step activates immediately (turn does not end); "The turn continues! Jump again to finish the capture chain." annotation with b2 target; attempting to jump anywhere other than b2 is blocked by gate
- After jump d4→b2: `confirm-turn` step activates; "Well done! Click End Turn to confirm your move." annotation
- After End Turn: tutorial shows completed status

**Why human:** Visual rendering of annotation overlays, highlight targets, disabled-reason UI feedback, and the ControlsMenu item require a browser. This is the DEMO-01 gate documented as Phase 110 scope.

---

_Verified: 2026-06-28T23:05:00Z_
_Verifier: Claude (gsd-verifier)_
