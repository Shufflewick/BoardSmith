---
requirements-completed: [AI-02, PROC-01]
---

# Plan 159-03 Summary — MCTS Redacted-View Soundness + Simultaneous Co-Decider Fix (AI-02, PROC-01)

**Plan:** 159-03 (execute — redact-only MCTS soundness, NOT determinization)
**Completed:** 2026-07-20
**Result:** PASS — closes an Information Disclosure defect: the MCTS bot's search clone leaked
opponents' hidden state and, within a simultaneous step, leaked an earlier co-decider's committed
pick to a later co-decider. Both are now redact/isolate-only fixes (T-159-06, T-159-07); PROC-01's
RED-before-GREEN gate satisfied; adversarial sweep + non-bot-caller guard both green; full suite at
or above baseline.

## What was done

1. **Task 1 (RED):** Added `src/ai/mcts-redaction.test.ts` driving `MCTSBot` directly against two
   in-file `Game` subclasses (per `mcts-restore.test.ts`), proving both defects against current,
   unfixed source with zero production changes:
   - `HiddenInfoGame` — seat 2 holds a face-down `SecretCard` (`showOnlyTo(2)`), seat 1 (the bot)
     must guess its value via a 3-choice action (`>=2` moves so the `mcts-bot.ts:224` 1-move
     short-circuit doesn't bypass cloning).
   - `SimultaneousGame` — seats 1 and 2 both pick one of `['x','y','z']` in a single
     `simultaneousActionStep`, excluding whatever's already taken.
   Ran and captured the real, observable failures (see verbatim RED output below). No
   `snapshot.ts`/`mcts-bot.ts` change in this commit.
2. **Task 2 (GREEN):**
   - `snapshot.ts`: `createSnapshot` gained an opt-in 5th arg `opts?: { forSeat?: number }`. When
     supplied, `state: game.toJSONForPlayer(forSeat)` (reuses the existing redaction from
     `game.ts:2738` — nothing invented); the default (`game.toJSON()`) is byte-for-byte unchanged
     for existing callers, so `runner.ts:527`'s non-bot caller is unaffected.
   - `mcts-bot.ts` `captureSnapshot`: now passes `{ forSeat: this.playerIndex }` — the search
     sandbox is redacted at the root.
   - `mcts-bot.ts` simultaneous loop (T-159-07): `resumeSimultaneousAction` (engine.ts) applies each
     co-decider's action to the shared game **immediately**, with no deferred reveal — so
     enumerating a later co-decider's moves against the live, mutated `searchGame` leaked the exact
     value an earlier co-decider committed. Added `maybeCaptureSimultaneousBaseline` — snapshots
     `searchGame` the instant a fresh simultaneous step begins (every awaiting player still
     not-completed), *before* any co-decider's move mutates it — and `enumerateMovesForSimulation`
     now enumerates against that frozen baseline whenever one exists, instead of the live game.
     Wired into both call sites the leak reaches: `expandIncremental` and `playoutIncremental`.
     Baseline is cleared once the step fully resolves (no `awaitingPlayers` left) so it can't leak
     into an unrelated later step.
3. **Task 3:** Added a `createSnapshot` non-bot-caller guard (calling it in the exact
   `runner.ts:527` shape — no `opts` — still yields a full un-redacted snapshot) and strengthened
   exploitability from Task 1's single seed/seat into an 18-trial adversarial sweep (3 secret
   values × 3 seeds × both possible bot seats — guesser=1/holder=2 and the mirrored
   guesser=2/holder=1). Ran the full suite: no regression.

## PROC-01 verbatim RED output (Task 1, before any fix)

```
 × MCTSBot redaction (AI-02 / T-159-06) > captured snapshot does not expose the opponent's hidden card value
   → expected 2 to be undefined
 ✓ MCTSBot redaction (AI-02 / T-159-06) > the redacted clone restores into a valid, playable game (restorability guard)
 ✓ MCTSBot redaction (AI-02 / T-159-06) > a naive full-info bot always guesses the hidden card correctly (exploitability baseline)
 × MCTSBot redaction (AI-02 / T-159-06) > the bot does not always exploit knowledge of the hidden card (non-exploitability)
   → expected true to be false // Object.is equality
 × MCTSBot simultaneous-step soundness (AI-02 / T-159-07) > a co-decider's enumerated moves do not depend on the earlier co-decider's committed pick
   → expected Set{ 'x', 'z' } to deeply equal Set{ 'y', 'z' }

 Test Files  1 failed (1)
      Tests  3 failed | 2 passed (5)
```
The 2 passing tests were guards, not RED assertions: restorability (round-trips through
`loadSerializedState` today; must stay green post-fix) and the exploitability baseline (documents
the pre-fix 100%-exploit ground truth for the record, not itself asserted).

## PROC-01 verbatim GREEN output (Task 2, after the fix)

```
✓ src/ai/mcts-restore.test.ts (3 tests)
✓ src/ai/mcts-redaction.test.ts (5 tests)

Test Files  2 passed (2)
     Tests  8 passed (8)
```

## Adversarial verification (Task 3)

- **Non-bot guard:** `createSnapshot(game, type, [], seed)` — no `opts` — still returns
  `attributes.value` visible / `__hidden` absent (matches `runner.ts:527`'s exact call shape).
  Confirms the opt-in default was never flipped for non-bot callers (T-159-08).
- **Adversarial exploitability sweep:** 3 secret values × 3 seeds × 2 bot seats = 18 independent
  trials. Post-fix, `matches.every(Boolean)` is `false` in every configuration — the bot never
  found a way to peek at the hidden value regardless of which seat it played or which seed drove
  the search.

## A note on test-fixture design (why two design iterations were needed)

The first `HiddenInfoGame` design called `game.finish()` inside the guess action's `.execute()` to
terminate after one guess and score via the terminal-winner path. This tripped a **pre-existing,
out-of-scope** MCTS limitation: `game.finish()` sets `settings.winners`/`phase` as plain-property
mutations outside the command system, and MCTS's incremental `undoCommands` only reverts
element-tree commands — so after the *first* simulated branch, the flow engine's own bookkeeping
(`awaitingPlayers[].completed`) silently stuck, and every subsequent root-child expansion was
rejected as a no-op. The fixture was redesigned around an `objectives` checker (a pure state
*read*, nothing to undo) and a perpetually-non-terminal loop flow, which sidesteps the issue
entirely and correctly exercises the redaction/exploitability defect in isolation.

The simultaneous fixture hit an analogous issue when first driven through the full tree
SELECT/EXPAND machinery (`runSearch`) across multiple iterations: root-child re-expansion for
alternate seat-1 branches also relies on undo reverting the flow engine's `awaitingPlayers[].completed`
flag, which — per the same limitation — it does not. The test now drives the bot's low-level
`captureSnapshot`/`restoreGame`/`continueFlow`/`enumerateMovesForSimulation` primitives directly
(three independent fresh searchGames, one per seat-1 branch), isolating exactly the T-159-07 leak
vector without depending on tree-undo semantics. Neither issue is a defect this plan is scoped to
fix (it's orthogonal MCTS incremental-undo behavior for plain-property/flow-bookkeeping mutations,
not element-tree state) — flagging here for visibility, not as a deviation requiring a code change.

## Verification

- `npx vitest run src/ai/mcts-redaction.test.ts src/ai/mcts-restore.test.ts` — 8/8 pass.
- `npm test` — **197 files / 2831 tests pass**, at/above the pre-phase baseline (196/2824 after
  159-01). The delta is exactly this plan's net-new file/tests (+1 file, +7 tests); nothing
  regressed.
- Grep gate: `grep -v '^\s*\*' src/ai/mcts-bot.ts | grep -Ec 'forSeat|playerIndex'` → 34 (≥1).
- Grep gate: `grep -c 'toJSONForPlayer' src/engine/utils/snapshot.ts` → 3 (≥2: `createPlayerView` +
  new `forSeat` path).
- Grep gate: `grep -c 'game.toJSON()' src/engine/utils/snapshot.ts` → 4 (≥1: default path retained
  for `createSnapshot` + `createActionCheckpoint`).

## Deviations from Plan

### Auto-fixed Issues
None — no Rule 1/2/3 fixes beyond what the plan already specified.

### Rule 4 (architectural) — none triggered
The RESEARCH/CONTEXT flagged the simultaneous fix might need to go deeper than the two named
helper functions (`enumerateMovesForSimulation`/`getCurrentPlayerFromFlowState`) into
`continueFlow` itself. That prediction held: the actual fix is a pre-reveal baseline captured
*before* `continueFlow` mutates `searchGame` (a new `simultaneousBaseline` field +
`maybeCaptureSimultaneousBaseline` hook), not a reordering of the two named functions alone. This
was anticipated in the plan's guidance, not an unplanned architectural surprise, so no Rule 4
checkpoint was needed — implemented directly per the plan's own steering.

### Auth gates
None encountered.

## Known Stubs
None — no stub patterns introduced.

## Threat Flags
None — this plan implements the mitigations specified in its own threat model (T-159-06 through
T-159-09); no new, unlisted security-relevant surface was introduced.

## Self-Check: PASSED

- `src/ai/mcts-redaction.test.ts` — FOUND
- `src/engine/utils/snapshot.ts` (`forSeat` opt-in path) — FOUND
- `src/ai/mcts-bot.ts` (`maybeCaptureSimultaneousBaseline`, `simultaneousBaseline`,
  `captureSnapshot` `forSeat`) — FOUND
- Commit `276f47fb` (RED) — FOUND in `git log`
- Commit `98a6f4e6` (GREEN) — FOUND in `git log`
- Commit `dc250d20` (adversarial + guard) — FOUND in `git log`
