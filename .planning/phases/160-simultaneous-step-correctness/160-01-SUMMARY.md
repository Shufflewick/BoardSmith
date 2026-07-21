---
requirements-completed: [SIM-01, SIM-03, PROC-01]
---

# Plan 160-01 Summary — Engine-layer simultaneous-step correctness (SIM-01, SIM-03, PROC-01)

**Plan:** 160-01 (execute — `getState()` checkpoint aliasing (D3) + `allDone`-on-empty crash (D21))
**Completed:** 2026-07-20
**Result:** PASS — single-source `getState()` deep-copy fixes checkpoint aliasing for ALL consumers;
`resumeSimultaneousAction` now finalizes instead of throwing when no eligible actor remains; new
shared `simultaneous-fixture.ts` for Phase 160's session/UI plans (02, 03); PROC-01's RED-before-GREEN
and adversarial gates both satisfied.

## What was done

1. **Task 1 (RED):** Added `src/session/testing/fixtures/simultaneous-fixture.ts` — `CommitGame`
   (2-4 seat `Player` subclass with per-seat `committed`), one `simultaneousActionStep('commit-step')`
   whose `playerDone` is per-seat (`committed`) and whose `allDone` is gated on a step-wide
   `roundClosed` flag INDEPENDENT of per-seat completion — the shape needed to reach "every seat
   individually done, but allDone still false" (the D21 edge). Usable both via the public `Game` API
   directly (`startFlow`/`continueFlow`/`getFlowState`/`restoreFlowState`) and via
   `createHeadlessSession(simultaneousFixtureDefinition, ...)` for Plan 02's session-layer work.
   Added `simultaneous-checkpoint-aliasing.test.ts` (D3) and `simultaneous-alldone-empty.test.ts`
   (D21) against current, unfixed `engine.ts`. Ran and captured the real failures verbatim (below).
   No production source touched in this commit.
2. **Task 2 (GREEN):**
   - **D3** — `getState()` (`engine.ts:619`) now returns `this.awaitingPlayers.map(p => ({ ...p }))`
     instead of the private array by reference. Single capture-side source of truth; mirrors the
     restore-side copy already at `restoreFullState` (`:759-761`).
   - **D21** — in `resumeSimultaneousAction`, when no explicit `playerIndex` is given and no seat is
     both incomplete and able to act, check whether every awaiting seat has already individually
     completed (or the set is empty) — if so, finalize the step (same `awaitingInput=false` /
     `frame.completed=true` / `this.run()` path the normal post-action allDone branch uses) instead
     of throwing "No player specified and no awaiting players found". This is the SOURCE fix (closes
     the state-transition gap), not a guard wrapped around the throw site. Also reordered
     `executeSimultaneousActionStep`'s step-entry checks so `config.allDone` is consulted BEFORE the
     empty-`awaitingPlayers` guard, so a freshly-entered empty step completes through the same
     allDone-aware path as every other completion.
   - One assertion in the D3 "no hang" test was narrowed from re-invoking the `commit` action (which
     also depends on session-layer element-state undo — restoring `player.committed`, out of scope
     for this engine-only plan) to asserting directly on the restored `FlowEngine` state
     (`awaitingInput`, `completed`, `availableActions`). Re-verified RED against unfixed `engine.ts`
     before re-applying the fix, to keep PROC-01 honest.
3. **Task 3 (adversarial):** Extended both test files —
   - D3: 3 sequential checkpoints (3 seats, one commit each) each still show exactly the `completed`
     values live at their OWN capture, unaffected by later flips; a caller mutating the returned
     `awaitingPlayers` array (both an entry's field and pushing a phantom entry) cannot corrupt the
     engine's private array (one-directional isolation), and the real seat can still act afterward.
   - D21: a variant, inline `VariantGame` reaches the same "no eligible actor, allDone unsatisfied"
     edge via a DIFFERENT engine branch — the "no available actions left after re-eval" auto-complete
     path, with NO `playerDone` callback at all — and also completes cleanly, proving the fix isn't
     narrowly targeted at the primary reproduction.
   Ran the full suite once to confirm no collateral breakage from the `getState()` copy.

## Consumer audit (D3 — "does anything rely on mutating the returned awaitingPlayers?")

Grepped every non-test, non-`engine.ts` call site of `getFlowState()` / `.awaitingPlayers` across
`src/`: `ai/mcts-bot.ts`, `session/utils.ts`, `session/stateless-ops.ts`, `session/state-history.ts`,
`session/ai-controller.ts`, `session/game-session.ts`, `session/pending-action-manager.ts`,
`engine/flow/seat-activity.ts`, `engine/flow/describe-flow-position.ts`,
`engine/utils/enumerate-moves.ts`, `engine/tutorial/predicates.ts`, `testing/simulate-action.ts`,
`testing/random-simulation.ts`, `testing/assertions.ts`, `testing/test-game.ts`,
`ai-trainer/benchmark.ts`. Every one reads via `.find` / `.filter` / `.map` / JSON serialization —
**no writer found.** The copy's one-directional isolation is a pure safety improvement; nothing broke.

## PROC-01 verbatim RED output (Task 1, before any fix)

```
❯ src/engine/flow/simultaneous-checkpoint-aliasing.test.ts (3 tests | 2 failed)
  × a checkpoint captured before seat 2 completes still reports seat 2 completed:false after the flip
    → expected true to be false // Object.is equality
  × undo (restoreFlowState) back across a flipped completed resolves to a well-formed awaiting state, not a stranded seat
    → expected true to be false // Object.is equality
❯ src/engine/flow/simultaneous-alldone-empty.test.ts (2 tests | 1 failed)
  × a resume with no eligible actor (all seats completed, allDone false) completes cleanly instead of throwing
    → No player specified and no awaiting players found

Error: No player specified and no awaiting players found
 ❯ FlowEngine.resumeSimultaneousAction src/engine/flow/engine.ts:520:13
 ❯ FlowEngine.resume src/engine/flow/engine.ts:330:19
 ❯ CommitGame.continueFlow src/engine/element/game.ts:1742:36

Test Files  2 failed (2)
     Tests  3 failed | 2 passed (5)
```
The 2 passing tests were negative controls (an ordinary two-seat step where `allDone` naturally
becomes true, and a fresh step entered with nothing to await) — proving the fixture doesn't fail
everything; both failures were the real defects, not a mechanical/import error.

## PROC-01 verbatim GREEN output (Task 2, after the fix)

```
✓ src/engine/flow/simultaneous-alldone-empty.test.ts (2 tests) 3ms
✓ src/engine/flow/simultaneous-checkpoint-aliasing.test.ts (3 tests) 4ms

Test Files  2 passed (2)
     Tests  5 passed (5)
```

## Adversarial verification (Task 3)

```
✓ src/engine/flow/simultaneous-alldone-empty.test.ts (3 tests) 4ms
✓ src/engine/flow/simultaneous-checkpoint-aliasing.test.ts (5 tests) 5ms

Test Files  2 passed (2)
     Tests  8 passed (8)
```

## Verification

- `npx vitest run src/engine/flow/simultaneous-checkpoint-aliasing.test.ts src/engine/flow/simultaneous-alldone-empty.test.ts` — 8/8 pass.
- `npm test` — **200 files / 2850 tests pass**, at/above the pre-phase baseline (198/2842; +2 files/+8 net tests from this plan, zero regressions). Phase 155's undo tests remain green.
- Grep gate: `grep -v '^\s*\*' src/engine/flow/engine.ts | grep -c 'awaitingPlayers\.map'` → 2 (≥1 required — one at `getState()`, one at the pre-existing `restoreFullState` restore-side copy).
- Grep gate: `grep -c 'simultaneousActionStep' src/session/testing/fixtures/simultaneous-fixture.ts` → 4 (≥1 required).

## Fixture exported API (for Plan 02 / Plan 03)

`src/session/testing/fixtures/simultaneous-fixture.ts`:
- `CommitGame` — `Game<CommitGame, CommitPlayer>` subclass, 2-4 seats. `roundClosed: boolean` (public,
  default `false`) is the step-wide `allDone` gate, independent of per-seat completion. Registers one
  action, `'commit'` (condition: not yet committed; execute sets `player.committed = true`). Flow root
  is a single `simultaneousActionStep({ name: 'commit-step', players: () => this.players, actions:
  ['commit'], playerDone: (ctx,p) => p.committed, allDone: () => this.roundClosed })` — no wrapping
  `loop`/`sequence`, so the whole flow completes when the step completes.
- `CommitPlayer` — `Player<CommitGame, CommitPlayer>` subclass; `committed: boolean` (public).
- `simultaneousFixtureDefinition: GameDefinitionLike` — `{ gameClass: CommitGame, gameType:
  'simultaneous', minPlayers: 2, maxPlayers: 4 }`, for `createHeadlessSession(...)`.

Drive it directly (engine/session-agnostic) via the public `Game` API: `new CommitGame({playerCount,
seed})`, `game.startFlow()`, `game.continueFlow('commit', {}, seatIndex)`, `game.getFlowState()`,
`game.restoreFlowState(flowState)`. To reach the D21 edge: commit every seat while `roundClosed` stays
`false`. To reach ordinary completion: set `game.roundClosed = true` before/at the last seat's commit.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Also reordered `executeSimultaneousActionStep`'s empty-guard/allDone check**
- **Found during:** Task 2, implementing the D21 fix per the plan's literal line references
  (`engine.ts:1534`/`:1540`).
- **Issue:** the plan's root-cause analysis of the actual crash (traced via the RED test) lands in
  `resumeSimultaneousAction`'s actor-resolution branch (`:519-520`), not the step-entry empty-guard
  the plan's interface section cites — the step-entry guard already completed unconditionally and
  was not itself reachable as the crash site. Left unchanged, the two code paths would decide
  "empty/no-eligible-actor" completion through two different orderings.
- **Fix:** reordered `executeSimultaneousActionStep` so `config.allDone` is checked before the
  length-`0` guard (matching the plan's literal instruction) for consistency with the
  `resumeSimultaneousAction` fix, even though it doesn't itself close the crash. Both branches now
  agree: consult `allDone` first, then treat "nobody left to await" as complete regardless.
- **Files modified:** `src/engine/flow/engine.ts`.
- **Commit:** `a3932975`.

### Auth gates
None encountered.

## Known Stubs
None — no stub patterns introduced.

## Threat Flags
None — this plan implements the mitigations specified in the plan's own threat model (T-160-01,
T-160-03); no new, unlisted security-relevant surface was introduced.

## Self-Check: PASSED

- `src/session/testing/fixtures/simultaneous-fixture.ts` — FOUND
- `src/engine/flow/simultaneous-checkpoint-aliasing.test.ts` — FOUND
- `src/engine/flow/simultaneous-alldone-empty.test.ts` — FOUND
- `src/engine/flow/engine.ts` (`getState()` deep copy, `resumeSimultaneousAction` allDone-on-empty) — FOUND
- Commit `edfd662c` (RED) — FOUND in `git log`
- Commit `a3932975` (GREEN) — FOUND in `git log`
- Commit `fc6eda60` (adversarial) — FOUND in `git log`
