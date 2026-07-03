# Phase 133: Findings Verification Gate (PROC-01)

**Purpose:** Independent re-verification of all four in-scope audit findings (F4/ENG-02, F5/ENG-03, F6/ENG-04, F27/ENG-07), each recorded with a verdict line before any fix is planned or written, per the project's "Prove Before Fix" rule.

**Method:** Every claim below was re-traced against current `main` source in this session (not copied from the audit report's original line numbers, and not merely re-stated from `133-RESEARCH.md`) using direct `grep`/`Read` of `src/engine/flow/engine.ts`, `src/engine/action/action.ts`, `src/engine/action/types.ts`, `src/engine/flow/types.ts`, and `src/runtime/runner.ts`, plus repo-wide + MERC greps for `startingPlayer` and `switchOn` usage.

---

## F4 / ENG-02 — `eachPlayer` with `startingPlayer` drops seats instead of wrapping

**VERDICT: LEGITIMATE**

**Trace:**
- `executeEachPlayer` lives at `src/engine/flow/engine.ts:1099` (private method, guarded by `frame.data?.eligibleSeats === undefined` at line **1107**).
- The seat list is constructed at line **1127**:
  ```ts
  eligibleSeats: players.slice(startIndex).map(p => p.seat),
  ```
  `startIndex` is computed just above (lines 1117-1121) by finding the index of `config.startingPlayer(context)` in the already filtered/reversed `players` array. When `startIndex > 0`, `players.slice(startIndex)` returns only the tail of the array — every seat at index `< startIndex` (i.e., every player who would normally act *before* the configured starting player in table order) is silently omitted from `eligibleSeats` for the entire round. There is no wrap-around concatenation of `players.slice(0, startIndex)` anywhere in the function.
- Confirmed against the consuming loop (lines 1132-1142): `eligibleSeats` is iterated exactly once per round (`nextIndex` walks from 0 to `eligibleSeats.length`), so a truncated array means those dropped seats get zero turns in the round, not a delayed turn — this is a genuine "some players silently never act" defect, not a display/ordering-only issue.
- **No double-fix hazard:** `grep -rn "startingPlayer" ~/BoardSmithGames/*/src` and `grep -rn "startingPlayer" ~/Dropbox/MERC/BoardSmith/MERC/src` both return zero matches. No shipped game (8 example games + MERC) passes `eachPlayer({ startingPlayer })`, so no game is silently relying on or working around the current truncation behavior — the fix carries zero cross-repo migration risk.

**Fix scope for Plan 02:** change the single array-construction expression at engine.ts:1127 to wrap (`[...players.slice(startIndex), ...players.slice(0, startIndex)]`), plus stale "does not wrap" JSDoc in `turn-order.ts` and the dealer-rotation pattern in `docs/common-patterns.md`.

---

## F5 / ENG-03 — `resumeSimultaneousAction` failure branch never sets `actionError`

**VERDICT: LEGITIMATE**

**Trace:**
- `resumeSimultaneousAction` is defined at `src/engine/flow/engine.ts:426`.
- Its action-execution failure branch, at lines **467-470**:
  ```ts
  if (!result.success) {
    // Action failed, stay in same state
    return this.getState();
  }
  ```
  sets no field on `this` before returning — `this.actionError` is left at whatever value it held before this call (commonly `undefined`, or worse, a *stale* value from a prior turn in the same simultaneous step — see Pitfall 2 in `133-RESEARCH.md`). The success path continues past this block (lines 472+) to re-evaluate `playerState.completed` / `availableActions` / `allDone`, but never explicitly clears `this.actionError` either.
- **Correct sibling to mirror:** `resume()` (the regular, non-simultaneous action-step path), defined at `src/engine/flow/engine.ts:255`. Its failure branch at lines **278-280**:
  ```ts
  if (!result.success) {
    // Action failed, stay in same state and record the error
    this.actionError = result.error;
    return this.getState();
  }
  ```
  followed immediately by the success-path clear at line **284**: `this.actionError = undefined;`, placed *before* `handleActionStepCompletion` is invoked. This confirms both halves (set-on-failure, clear-on-success, placed before continuation logic) are required for the mirror fix, matching Pitfall 2 in RESEARCH.md.
- **Sole consumer confirmed:** `src/runtime/runner.ts`, `performAction()` (defined at line 154). It calls `this.game.continueFlow(...)` to get `flowState`, then at line **207**:
  ```ts
  if (flowState.actionError) {
    return { success: false, error: flowState.actionError, errorCode: ErrorCode.ACTION_EXECUTION_ERROR, flowState };
  }
  ```
  and only if that check is *not* hit does it reach line **217**: `this.actionHistory.push(serializedAction);`. This is the sole chokepoint in the runtime layer that reads `actionError` and the sole gate on `actionHistory` writes for normal play — confirming that a failed simultaneous-step action currently returns `{ success: true }` and gets pushed into `actionHistory` incorrectly (or, if `actionError` happens to carry a stale value from an earlier turn, could incorrectly report failure for a legitimately succeeding later action — both directions are real bugs).

**Fix scope for Plan 02:** insert `this.actionError = result.error;` in the failure branch and `this.actionError = undefined;` immediately after the failure check (mirroring `resume()`'s exact placement) in the success path, before the `playerDone`/`availableActions` continuation logic.
