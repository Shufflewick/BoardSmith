---
requirements-completed: [UNDO-01, UNDO-02, PROC-01]
---

# Plan 155-01 Summary — Shared Undo/Rewind Guard (UNDO-01, UNDO-02 finished-phase, PROC-01)

**Plan:** 155-01 (execute — server-side `.notUndoable()` + `finished`-phase enforcement)
**Completed:** 2026-07-20
**Result:** PASS — one shared `assertUndoAllowed` guard in `src/session/utils.ts`, wired into all four
undo/rewind entry points; PROC-01's RED-before-GREEN and adversarial-bypass gates both satisfied.

## What was done

1. **Task 1 (RED):** Added `src/session/testing/fixtures/undo-fence-fixture.ts` (2 players; `play`
   undoable, `lock` `.notUndoable()`, `endGame` calling `ctx.game.finish()`; two-actionStep-per-turn
   shape mirroring `collect-turns-fixture.ts` so undo is offered mid-turn). Added
   `notundoable-enforcement.test.ts` and `finished-phase-undo.test.ts`, driving both the stateless
   (`createHeadlessSession`) and stateful (`GameSession`) undo paths against current, unfixed source.
   Ran and captured the real failure (undo silently succeeded when it should have been refused) —
   see verbatim output below. No production source touched in this commit.
2. **Task 2 (GREEN):** Added `UndoRefusedError` + `assertUndoAllowed({ game, actionHistory,
   turnStartActionIndex })` to `utils.ts` — two independent, composable checks (phase fence, checked
   up front before any checkpoint lookup per D-04; then non-undoable fence, scanning
   `actionHistory[turnStartActionIndex..end)` for `undoable === false`). Wired at all four sites:
   `stateless-ops.ts` `handleUndo` + `handleDebugRewind`, `state-history.ts` `undoToTurnStart` +
   `rewindToAction`. Added `ErrorCode.UNDO_NOT_ALLOWED` to `types/protocol.ts`.
3. **Task 3:** Extended `parity-contract.test.ts` with a parity block (stateless/stateful agree on
   decision + message for both the non-undoable and finished-phase cases) and an adversarial block
   (raw `{type:'undo'}` op, direct `undoToTurnStart()` call, `{type:'debugRewind'}` op, direct
   `rewindToAction()` call — each built/called without ever consulting `canUndo`). Ran the full suite
   to confirm no collateral breakage.

## PROC-01 verbatim RED output (Task 1, before any fix)

```
❯ finished-phase-undo.test.ts (2 tests | 2 failed)
  × UNDO-02 (stateless) > refuses undo after game.phase becomes "finished"
    → expected true to be false // Object.is equality
  × UNDO-02 (stateful) > refuses undo after game.phase becomes "finished"
    → expected true to be false // Object.is equality
❯ notundoable-enforcement.test.ts (4 tests | 2 failed)
  × UNDO-01 (stateless) > refuses undo after a .notUndoable() action
    → expected true to be false // Object.is equality
  × UNDO-01 (stateful) > refuses undo after a .notUndoable() action
    → expected true to be false // Object.is equality

Test Files  2 failed (2)
     Tests  4 failed | 2 passed (6)
```
The 2 passing tests were the negative controls (an ordinary undoable action still undoes
successfully) — proving the fixture doesn't refuse everything. Both failures were the real defect
(undo silently succeeded), not a mechanical/import error.

## PROC-01 verbatim GREEN output (Task 2, after the fix)

```
✓ src/session/testing/finished-phase-undo.test.ts (2 tests) 8ms
✓ src/session/testing/notundoable-enforcement.test.ts (4 tests) 10ms

Test Files  2 passed (2)
     Tests  6 passed (6)
```

## Adversarial verification (Task 3, real attack attempted)

- Hand-crafted raw `{ type: 'undo', player: 1 }` op sent after a `.notUndoable()` action, without
  ever reading `state.canUndo` → refused, message names `lock`.
- `GameSession.undoToTurnStart(1)` called directly, bypassing any UI layer → refused, same message.
- `{ type: 'debugRewind', player: 1, actionIndex: 0 }` targeting a rewind that would cross the
  `.notUndoable()` action → refused.
- `GameSession.rewindToAction(0)` called directly, same crossing → refused.

All four bypass attempts failed to defeat the guard (see `parity-contract.test.ts`,
`describe('undo-fence adversarial verification (bypassing canUndo)')`).

## Verification

- `npx vitest run src/session/testing/notundoable-enforcement.test.ts src/session/testing/finished-phase-undo.test.ts src/session/testing/parity-contract.test.ts` — all pass (parity-contract.test.ts: 9/9).
- `npm test` — **191 files / 2726 tests pass**, at/above the pre-phase baseline (188/2712). The
  increase reflects this plan's 12 new tests plus a concurrently-landed sibling plan (155-04);
  nothing regressed.
- `undo-authoritative.test.ts` and `stateful-undo-authoritative.test.ts` (Plan 03's territory —
  `moveCount`-scope contract change) remain **GREEN**, unmodified by this plan, confirming no
  collateral breakage from the guard.
- Grep gate: `grep -v '^\s*\*' src/session/stateless-ops.ts src/session/state-history.ts | grep -c 'assertUndoAllowed'` → 6 (≥4 required).
- Grep gate: `grep -rn 'hasNonUndoableAction' src/session/stateless-ops.ts src/session/state-history.ts` → no matches (guard owns it now).

## Deviations from Plan

### Auto-fixed Issues
None — plan executed exactly as written; no Rule 1/2/3 fixes were needed beyond what the plan
already specified.

### Process note (not a code deviation, but load-bearing for reviewers)

**Concurrent-execution git-index race with sibling plan 155-04, self-corrected.** This repo is not
worktree-isolated for parallel phase-155 plan execution — 155-01 and 155-04 ran in the same working
tree simultaneously. Mid-Task-2, a concurrent 155-04 commit (`fe1cdc0c`) accidentally swept this
plan's staged-but-uncommitted edits to `utils.ts`/`stateless-ops.ts`/`state-history.ts`/`protocol.ts`
into its own commit alongside its unrelated `game.ts`/`runner.ts` changes (a `git add`/`git commit`
race on the shared index). The 155-04 agent detected this itself and immediately issued a follow-up
commit (`085fd236`) reverting those 4 files out of its history while leaving the edits unstaged and
intact in the working tree. This executor verified file content and re-ran the target tests GREEN
before staging and committing Task 2's work under its own, correctly-scoped commit (`69973494`).
No code or test content was lost; only the commit-boundary hygiene was briefly at risk, and it
self-healed. Flagging for the orchestrator: concurrent plan execution in this phase should use
isolated worktrees to avoid relying on this kind of self-correction happening again.

### Auth gates
None encountered.

## Known Stubs
None — no stub patterns introduced.

## Threat Flags
None — this plan implements the mitigations specified in the plan's own threat model (T-155-01
through T-155-04); no new, unlisted security-relevant surface was introduced.

## Self-Check: PASSED

- `src/session/testing/fixtures/undo-fence-fixture.ts` — FOUND
- `src/session/testing/notundoable-enforcement.test.ts` — FOUND
- `src/session/testing/finished-phase-undo.test.ts` — FOUND
- `src/session/utils.ts` (`assertUndoAllowed`, `UndoRefusedError`) — FOUND
- Commit `f87427b3` (RED) — FOUND in `git log`
- Commit `69973494` (GREEN) — FOUND in `git log`
- Commit `b3a6f457` (parity + adversarial) — FOUND in `git log`
