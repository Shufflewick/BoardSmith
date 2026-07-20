---
requirements-completed: [UNDO-03, PROC-01]
---

# Phase 155 Plan 03: Solo-Undo Wipe Fix — moveCount Authoritative, Fallback Deleted Summary

**Plan:** 155-03 (execute — delete the game-erasing backward-scan fallback in
`computeUndoInfo`, make `FlowState.moveCount` authoritative by publishing it
on every action step)

**One-liner:** Deleted `computeUndoInfo`'s branch-C backward scan (the path
that wiped a solo game's entire history on first undo); `moveCount` is now
published unconditionally, so undo is always bounded to the currently-open
action-step frame — never a game-erasing heuristic.

## What was built

- `engine.ts` `getState()`: `state.moveCount` is now set for ANY active
  action-step config, not only ones declaring `minMoves`/`maxMoves`.
  `movesRemaining`/`movesRequired` stay limits-gated (meaningless without
  limits).
- `types.ts`: `FlowState.moveCount`'s doc comment now states the contract —
  missing means "not currently in an action step" / undo-unavailable, never
  "fall back to a heuristic."
- `utils.ts` `computeUndoInfo`: the backward-scan fallback (branch C) is
  DELETED, not replaced. `moveCount === undefined` (or no current player, or
  empty history) returns `{ turnStartActionIndex: actionHistory.length,
  actionsThisTurn: 0, hasNonUndoableAction: false }` — `canUndo: false`, no
  fallback of any kind.
- `solo-undo-authoritative.test.ts` (new): the UNDO-03 regression suite,
  both executors.
- Rewrote `undo-authoritative.test.ts` and `stateful-undo-authoritative.test.ts`
  to CONTEXT D-06's new contract ("one undo = one action-step, not one
  turn"), plus fixed six other test files whose fixtures assumed the old,
  now-superseded cross-frame undo eligibility (see Deviations).

## THE CENTRAL DECISION, applied

**"One undo = one action-step, NOT one turn."** `FlowState.moveCount` is
frame-scoped. A turn built from two sequential single-move `actionStep`s
(e.g. `collect-turns-fixture.ts`'s `sequence(actionStep, actionStep)`) now
loses undo eligibility the instant the first action-step's one move commits
and a fresh frame opens — that frame reports `moveCount: 0`, and there is no
fallback left to reach back across the boundary. This is the deliberate,
user-approved trade: it closes the game-erasing defect (D5/UNDO-03) at the
cost of narrowing undo to "the action(s) taken in the currently-open frame,"
never "the whole logical turn" when a turn spans multiple frames.

## PROC-01: RED before GREEN

### Verbatim RED output (Task 1, before any production code touched)

```
❯ src/session/testing/solo-undo-authoritative.test.ts (6 tests | 6 failed)
   × UNDO-03 solo-wipe regression (stateless) > one undo removes exactly the pending act move -- the two prior pass turns survive
     → expected +0 to be 2 // Object.is equality
   × UNDO-03 solo-wipe regression (stateless) > undo is incremental and repeatable -- a second act-then-undo cycle never approaches an empty history
     → expected +0 to be 2 // Object.is equality
   × UNDO-03 solo-wipe regression (stateless) > two undos in a row (no intervening action) never wipes the game -- the second is safely refused
     → expected +0 to be 2 // Object.is equality
   × UNDO-03 solo-wipe regression (stateful) > one undo removes exactly the pending act move -- the two prior pass turns survive
     → expected +0 to be 2 // Object.is equality
   × UNDO-03 solo-wipe regression (stateful) > undo is incremental and repeatable across two act-then-undo cycles
     → expected +0 to be 2 // Object.is equality
   × UNDO-03 solo-wipe regression (stateful) > two undos in a row (no intervening action) never wipes the game
     → expected +0 to be 2 // Object.is equality

 Test Files  1 failed (1)
      Tests  6 failed (6)
```

All six failures are `expected +0 to be 2` — i.e. after two closed "pass"
turns (score 2) plus one pending "act" move (score 12), a single undo
returned score `0`: it wiped ALL THREE actions, not just the pending one.
This is the exact real-world symptom ("undo wiped my game") the wipe defect
produces, not a missing-symbol/import error — every failure is a wrong
runtime value from the deleted-in-Task-2 backward-scan fallback finding no
different player in a solo game and scanning all the way to action index 0.

### Verbatim GREEN output (Task 2)

```
✓ src/session/testing/solo-undo-authoritative.test.ts (6 tests) 16ms
✓ src/session/build-player-state.test.ts (25 tests) 20ms

 Test Files  2 passed (2)
      Tests  31 passed (31)
```

## Solo-wipe fixture design note (why not a plain single-move loop)

`SoloWipeGame`'s active action-step uses `repeatUntil: () => false` (still
declaring NO `minMoves`/`maxMoves`) rather than a bare `loop(do:
actionStep(...))`. Traced empirically (probe scripts, not shipped): a plain
single-move `actionStep` with no completion condition auto-completes after
EVERY move and a fresh frame opens with `moveCount: 0` before any subsequent
op can observe it — so `computeUndoInfo` correctly reports "no actions to
undo" for that shape post-fix (undo becomes unavailable rather than
wiping — still not a regression from D5, but it can't demonstrate an
INCREMENTAL single-move undo). `repeatUntil` is the minimal, still-limits-free
way to keep ONE frame open across multiple moves, which is what actually
lets `moveCount` be a small positive number (not 0) at the moment undo is
invoked — matching real games where a player can act multiple times before
ending their turn (and matching this plan's `<must_haves>` truth: "one undo
rewinds exactly one action").

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `computeUndoInfo`'s empty-history branch merged into the
new single-path return, `turnStartActionIndex` now `actionHistory.length`
instead of `0`**
- **Found during:** Task 2 implementation.
- **Issue:** The original code had TWO early-return branches — `currentPlayer
  === undefined || history.length === 0` returning `{0, 0, false}`, and (now-
  deleted) branch C. Merging the `moveCount === undefined` case (per the
  plan's literal spec: `{ turnStartActionIndex: <history length>, ... }`)
  with the pre-existing empty/no-player branch means that branch's
  `turnStartActionIndex` changed from `0` to `actionHistory.length`.
- **Fix:** Confirmed harmless — every caller short-circuits on
  `actionsThisTurn === 0` before ever reading `turnStartActionIndex` in this
  branch. Kept the merge (simpler, one return statement) rather than
  special-casing back to `0`.
- **Files modified:** `src/session/utils.ts`.
- **Commit:** `2ac037c6`.

**2. [Rule 1 - Bug] Six test files broken by the D-06 contract change, none
in the plan's `files_modified` list**
- **Found during:** Task 3's full-suite run (15 failures beyond the two
  named suites).
- **Issue:** `undo-fence-fixture.ts` (Plan 01/02's shared fixture, consumed
  by `notundoable-enforcement.test.ts`, `finished-phase-undo.test.ts`,
  `parity-contract.test.ts`), `BotGame` in `snapshot-session-host.test.ts`,
  `SimpleGame` in `stateless-ops.test.ts`, and `TickGame` in
  `rewind-animation-watermark.test.ts` (155-04/UNDO-04 territory) all used
  a single-move `actionStep` (bare or as the first of a two-step turn) and
  called undo immediately after ONE action, relying on the OLD cross-frame
  eligibility branch C provided. Under the new contract every one of these
  hit the generic "No actions to undo" refusal BEFORE any test could reach
  the specific behavior under test (notUndoable fence, finished-phase fence,
  transient-state-clears-on-undo, animation watermark across a successful
  undo). `pending-action-manager.test.ts` had a direct `computeUndoInfo()`
  unit-test call expecting `actionsThisTurn >= 1` for a fixture whose flow
  COMPLETES the instant its one action does (no active frame left at all).
- **Fix:** For the four action-step fixtures: converted the relevant
  actionStep from single-move to `repeatUntil`-kept-open (still NO
  `minMoves`/`maxMoves` — same "plain actionStep" shape) so the frame stays
  open across the moves each test actually needs, restoring undo
  eligibility at the exact point each test's assertion needs it. This is
  D-06's contract working as designed ("undo within the currently-active
  frame"), not a workaround around it — no assertion about
  notUndoable/finished-phase/watermark/transient-state behavior was
  weakened; only the SETUP needed adjusting so undo remains reachable.
  `TickGame`'s two-actionStep-per-turn shape was collapsed to one actionStep
  with `repeatUntil` counting to exactly 2 ticks, preserving its documented
  "two ticks per turn, then rotate" semantics exactly. For
  `pending-action-manager.test.ts`: rewrote the assertion to check what the
  test's own name/comment actually protects — the action IS recorded in
  `actionHistory`, not `computeUndoInfo`'s undo-eligibility verdict for an
  already-finished game (which is now, correctly, "unavailable").
- **Files modified:** `src/session/testing/fixtures/undo-fence-fixture.ts`,
  `src/session/snapshot-session-host.test.ts`, `src/session/stateless-ops.test.ts`,
  `src/session/testing/rewind-animation-watermark.test.ts`,
  `src/session/pending-action-manager.test.ts`.
- **Commit:** `682b651c`.

**Total deviations:** 2 auto-fixed (1 harmless formula-merge side effect in
production code, 1 blast-radius fix across six test files caused by the
correct, intentional D-06 contract change).
**Impact on plan:** Neither deviation touches the production fix itself
(commit `2ac037c6` is exactly what Task 2 specifies); both are adaptations
of test setup to the new, correct contract.

### Auth gates

None encountered.

## Contract-change vs. new-fix test inventory (so a reviewer can tell at a glance)

**Tests REWRITTEN because the contract changed intentionally (D-06):**
- `undo-authoritative.test.ts` — the mid-turn, cross-frame case: was
  `undo.success === true`, now asserts refusal (`No actions to undo`).
- `stateful-undo-authoritative.test.ts` — same case, stateful executor.
- `pending-action-manager.test.ts` — "reports an undoable action for a turn
  whose only action was multi-step" renamed and reassertion on
  `actionHistory`, not `computeUndoInfo`'s undo-eligibility for a finished
  game.

**Tests/fixtures ADAPTED (setup only) so an EXISTING, unrelated fix (from
Plans 01/02/04) remains exercisable under the new contract — no assertion
about THEIR behavior changed:**
- `undo-fence-fixture.ts` + its three consumer test files (UNDO-01/UNDO-02
  fences) — `notundoable-enforcement.test.ts`, `finished-phase-undo.test.ts`,
  `parity-contract.test.ts`'s undo-fence blocks.
- `snapshot-session-host.test.ts`'s `BotGame` (undo-clears-transient-state
  test).
- `stateless-ops.test.ts`'s `SimpleGame` (undo op tests).
- `rewind-animation-watermark.test.ts`'s `TickGame` (UNDO-04 watermark
  tests).

**Tests that PROVE the new UNDO-03 fix (net-new, this plan):**
- `solo-undo-authoritative.test.ts` — all 6 tests (3 stateless + 3
  stateful): one-undo-removes-exactly-the-pending-move, incremental/
  repeatable across cycles, and two-undos-in-a-row-never-wipes.
- `undo-authoritative.test.ts` / `stateful-undo-authoritative.test.ts` — the
  new "positive case" block (`TwoMoveTurnGame`): undo mid-frame succeeds and
  removes exactly the pending move while a prior, closed turn survives.

**Confirmed NOT needing changes (RESEARCH.md §E at-risk list, audited, pass
unmodified):**
- `build-player-state.test.ts` — no `moveCount`/fallback-shaped assertions;
  its `canUndo` fixtures already reflect the real (limits-free) contract.
- `stateful-timetravel-authoritative.test.ts` — uses `rewindToAction`
  (index-targeted, execute-barrier-gated), not `moveCount`/turn-boundary
  logic; unaffected.
- `src/engine/command/undo.test.ts`, `src/engine/element/animation-events.test.ts`
  — engine-level mechanics (`.notUndoable()`, animation-event pushing), no
  session undo policy.

## Verification

- `npx vitest run src/session/testing/solo-undo-authoritative.test.ts src/session/testing/undo-authoritative.test.ts src/session/testing/stateful-undo-authoritative.test.ts` — all pass (10 tests).
- `npm test` — **193 files / 2752 tests pass**, up from the pre-plan baseline
  (192/2744). Every delta accounted for above (net: +1 test file, +8 tests
  from the rewritten/new suites; all six blast-radius files stayed at their
  original test COUNT, only assertions/fixture shape adjusted).
- Grep gate: `grep -v '^\s*[*/]' src/session/utils.ts | grep -c 'Scan backwards'` → `0`.
- Grep gate: `grep -c "currentActionConfig.minMoves || " src/engine/flow/engine.ts` → `0`.
- Both executors verified in parity: `moveCount` is passed identically at
  `stateless-ops.ts:469` and `state-history.ts:292` (unchanged call sites —
  the fix is entirely upstream of them, in what `flowState.moveCount`
  itself now contains).

## Known Stubs

None — no stub patterns introduced.

## Threat Flags

None — this plan implements exactly the mitigations specified in its own
threat model (T-155-12 through T-155-15); no new, unlisted security-relevant
surface was introduced. The fail-closed behavior (missing `moveCount` ⇒
`canUndo: false`) is the T-155-14 mitigation, applied verbatim.

## Self-Check: PASSED

- `src/session/testing/solo-undo-authoritative.test.ts` — FOUND
- `src/engine/flow/engine.ts` (moveCount published unconditionally) — FOUND
- `src/engine/flow/types.ts` (updated doc comment) — FOUND
- `src/session/utils.ts` (`computeUndoInfo`, single path) — FOUND
- `src/session/testing/undo-authoritative.test.ts` (rewritten) — FOUND
- `src/session/testing/stateful-undo-authoritative.test.ts` (rewritten) — FOUND
- `src/session/build-player-state.test.ts` (confirmed unmodified, still passes) — FOUND
- Commit `4fd08dff` (RED) — FOUND in `git log`
- Commit `2ac037c6` (GREEN) — FOUND in `git log`
- Commit `682b651c` (rewrite + blast-radius fix) — FOUND in `git log`
