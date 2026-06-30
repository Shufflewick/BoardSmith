---
phase: 110-demonstration-refinement
fixed_at: 2026-06-29T11:43:00Z
review_path: .planning/phases/110-demonstration-refinement/110-REFINEMENTS.md
iteration: 2
findings_in_scope: 2
fixed: 2
skipped: 0
status: all_fixed
---

# Phase 110: Code Review Fix Report (Iteration 2 — DEMO-01 bugs)

**Fixed at:** 2026-06-29T11:43:00Z
**Source review:** `.planning/phases/110-demonstration-refinement/110-REFINEMENTS.md`
**Iteration:** 2

**Summary:**
- Findings in scope: 2 (R-01, R-02 from DEMO-01 live-run findings)
- Fixed: 2
- Skipped: 0

## Fixed Issues

### R-01: Tutorial does not load its deterministic preset position

**Files modified (BoardSmith repo):**
- `src/engine/tutorial/types.ts`
- `src/session/stateless-ops.ts`
- `src/session/tutorial-controller.ts`
- `src/session/stateless-ops.test.ts`
- `src/session/tutorial-controller.test.ts`

**BoardSmith commit:** `0b59c1a`

**Files modified (checkers repo `~/BoardSmithGames/checkers`):**
- `src/rules/game.ts`
- `src/rules/tutorial.ts`
- `tests/tutorial-preset.test.ts`

**Checkers commit:** `95d74ea`

**Applied fix:**

1. Added `setup?: (game: Game) => void` optional field to `TutorialDefinition` in `types.ts`, documented as: "applied by startTutorial to put the board into the tutorial's deterministic starting position".

2. In `stateless-ops.ts` `startTutorial` case: call `def.tutorial.setup?.(runner.game as Game)` immediately after `runnerFromSnapshot`, before `tutorialProgress.set` and `autoAdvanceTutorial`. The subsequent `stateEnvelope`/`getSnapshot` captures the mutated board as authoritative.

3. In `tutorial-controller.ts` `start()`: call `def.setup?.(game)` after `validateTutorialDefinition` and before `initialProgress(def)` — so the production GameSession path also resets the board.

4. Added public `resetToTutorialPreset()` to `CheckersGame` (checkers repo): iterates `getDarkSquares()` removing any piece found, resets `continuingPiece`/`continuingPlayer`/`hasMovedThisTurn` to initial values, then calls the existing private `placeTutorialPieces()`.

5. Added `setup: (game) => (game as CheckersGame).resetToTutorialPreset()` to `CHECKERS_TUTORIAL`.

**Tests added:**
- `stateless-ops.test.ts` — "startTutorial setup callback (R-01)": proves `advanceWhen` predicate sees setup-applied state at start (the key scenario: capture-tip's `playerHasCaptures` must be true from game-start in the preset); proves no-setup path unaffected.
- `tutorial-controller.test.ts` — "TutorialController — setup callback (R-01)": proves `setup` spy called once with the live game instance before progress is set; proves no-setup path still starts on step-1.
- `checkers/tests/tutorial-preset.test.ts` — "CheckersGame.resetToTutorialPreset (R-01)": proves standard 24-piece opening is cleared → 4-piece preset (1 Player 1 piece at b6 with capture available), turn-tracking reset, `CHECKERS_TUTORIAL.setup` is defined.

---

### R-02: No way to exit/leave the tutorial once started

**Files modified (BoardSmith repo):**
- `src/session/stateless-ops.ts`
- `src/cli/dev-host/bridge.ts`
- `src/ui/components/ControlsMenu.vue`
- `src/ui/components/GameShell.vue`
- `src/ui/components/ControlsMenu.tutorial-toggle.test.ts` (new file)

**Commit:** `cfe3b50`

**Applied fix:**

1. Added `| { type: 'exitTutorial'; player: number }` to the `Op` union in `stateless-ops.ts`. Added a `case 'exitTutorial':` handler that validates `def.tutorial` presence (fail-loud) and seat range (fail-loud), reads current `tutorialProgress`, and sets `{ stepId: current?.stepId ?? null, status: 'exited' }`. Returns `stateEnvelope` so the broadcast carries the gate-lifted state.

2. In `bridge.ts`: added `'exit-tutorial'` to the `WireOp` union; added `translateOp` case returning `{ type: 'exitTutorial', player: seat }`; added `shapeResult` case returning `{ success, error }` (same pattern as `start-tutorial`).

3. In `ControlsMenu.vue`: added `isTutorialRunning?: boolean` prop; extended the `teaching-action` emit union to include `'exit-tutorial'`; the Tutorial group button now toggles: label `'Exit tutorial'` / emits `'exit-tutorial'` when `isTutorialRunning`, else label `'Start tutorial'` / emits `'start-tutorial'`.

4. In `GameShell.vue`: computed `isTutorialRunningProp = computed(() => tutorialStep.value !== undefined)` (tutorialStep already computed from broadcast state); added `'exit-tutorial'` branch to `handleTeachingAction` calling `platformRequest('exit-tutorial', { seat: playerSeat.value })`; added `'exit-tutorial'` to the function's type signature; passed `:is-tutorial-running="isTutorialRunningProp"` to `<ControlsMenu>`.

**Tests added:**
- `stateless-ops.test.ts` — "exitTutorial" describe: sets status to `'exited'` and tutorial step view disappears from broadcast; fails loud when no tutorial def (protocol); fails loud for invalid seat (protocol).
- `ControlsMenu.tutorial-toggle.test.ts` (new file): shows "Start tutorial" and emits `start-tutorial` when `isTutorialRunning: false`; shows "Exit tutorial" and emits `exit-tutorial` when `isTutorialRunning: true`; defaults to "Start tutorial" when prop absent; Tutorial group hidden when `hasTutorial: false`.

---

## Skipped Issues

None — both in-scope findings were fixed.

---

_Fixed: 2026-06-29T11:43:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 2_
