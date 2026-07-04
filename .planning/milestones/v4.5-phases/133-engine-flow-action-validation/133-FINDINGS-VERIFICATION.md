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

---

## F6 / ENG-04 — choice-branch `validateSelection` has no `multiSelect` count/array-type check

**VERDICT: LEGITIMATE**

**Trace:**
- `validateSelection` is defined at `src/engine/action/action.ts:691`.
- The choice/element branch spans lines **706-741** (`if (selection.type === 'choice' || selection.type === 'element') { ... }`). Within this branch:
  - Array submissions (lines 709-724) validate each item's *membership* in `choices` (via `annotatedChoicesContain` / `trySmartResolveChoice`) and disabled-state, but never inspect `value.length` against any bound.
  - Scalar submissions (lines 726-740) validate membership only.
  - No reference to `selection.multiSelect` appears anywhere in lines 706-741. There is no rejection of a bare scalar submitted against a `multiSelect`-configured choice selection — a scalar simply flows through the `else` scalar-validation branch and, if it matches a valid choice, passes with zero count enforcement.
- **Elements-branch port source confirmed** at lines **802-817** (inside the `if (selection.type === 'elements')` block starting line 745):
  ```ts
  const multiSelect = (selection as ElementsSelection).multiSelect;
  const multiSelectConfig = typeof multiSelect === 'function' ? multiSelect(context) : multiSelect;
  if (multiSelectConfig !== undefined) {
    const min = typeof multiSelectConfig === 'number' ? 1 : (multiSelectConfig.min ?? 1);
    const max = typeof multiSelectConfig === 'number' ? multiSelectConfig : multiSelectConfig.max;
    const count = Array.isArray(value) ? value.length : 1;
    if (count < min) { errors.push(...); }
    if (max !== undefined && count > max) { errors.push(...); }
  }
  ```
  This block is the only place in `validateSelection` that enforces `multiSelect` bounds today, and it applies only to `selection.type === 'elements'`, never to `'choice'`/`'element'`.
- **Type identity confirmed** in `src/engine/action/types.ts`: `ChoiceSelection.multiSelect` (line **212**) and `ElementsSelection.multiSelect` (line **304**) both declare the identical shape:
  ```ts
  multiSelect?: number | MultiSelectConfig | ((context: ActionContext) => number | MultiSelectConfig | undefined);
  ```
  confirming the elements-branch count logic can be ported mechanically (same input shape) into the choice branch.
- **New logic beyond a straight port, per locked decision:** the elements-branch count computation degrades a non-array `value` to `count = 1` (line 810: `Array.isArray(value) ? value.length : 1`) rather than rejecting it outright — acceptable there because a bare element is a legitimate single-item shorthand. The locked decision for ENG-04 explicitly requires the choice branch to **reject non-array values outright** when `multiSelect` is configured (not silently treat as count 1), which is genuinely new logic, not present anywhere in the current choice branch or the elements-branch pattern being ported.

**Fix scope for Plan 03:** after the existing choice-branch array-item-membership loop (ending line 724) and before the scalar `else` branch, insert a ported+extended count/array-type check using `(selection as ChoiceSelection).multiSelect`, including the new non-array rejection.

---

## F27 / ENG-07 — `switchOn` with no matching case and no default silently completes

**VERDICT: LEGITIMATE**

**Trace:**
- `executeSwitch` is defined at `src/engine/flow/engine.ts:1426`, called from the flow dispatcher at line 1001 (`case 'switch': return this.executeSwitch(...)`).
- The value resolution and branch lookup (lines 1436-1440):
  ```ts
  const value = config.on(context);
  const stringValue = String(value);
  const hasCase = Object.prototype.hasOwnProperty.call(config.cases, stringValue);
  const branch = hasCase ? config.cases[stringValue] : config.default;
  ```
  followed by the unmatched-branch handling at lines **1442-1445**:
  ```ts
  if (!branch) {
    frame.completed = true;
    return { continue: true, awaitingInput: false };
  }
  ```
  This marks the flow frame `completed` and returns `{ continue: true }` with no error, no warning, no log — the flow simply advances past the switch node as if it had executed successfully, even though no case matched and no default was configured. This is a genuine silent-wrong-path defect: a typo'd or unhandled switch value produces no signal that anything went wrong.
- **`SwitchConfig` inherits an optional `name`:** confirmed in `src/engine/flow/types.ts:178`:
  ```ts
  export interface SwitchConfig extends BaseFlowConfig {
    on: (context: FlowContext) => unknown;
    cases: Record<string, FlowNode>;
    default?: FlowNode;
  }
  ```
  and `BaseFlowConfig` (types.ts:73-76):
  ```ts
  export interface BaseFlowConfig {
    /** Optional name for this flow node (for serialization) */
    name?: string;
  }
  ```
  So `config.name` is available (optional) if the fix wants to include a node name in the error message, but it is not guaranteed to be set by every caller — the baseline required wording from the locked decision (`"switchOn got '<value>' — no matching case (<keys>) and no default"`) does not depend on it being present.
- **No double-fix hazard:** `grep -rln "switchOn" ~/BoardSmithGames/*/src` and the equivalent MERC grep both return zero matches — no shipped game or MERC currently uses `switchOn` at all, so introducing a throw here changes behavior for zero existing call sites.
- **Propagation path confirmed:** `executeSwitch` is plain synchronous flow-control code, not wrapped in a local try/catch. A thrown `Error` here propagates up through the flow dispatch loop to whatever caller invoked `continueFlow`/`run()`/`resume()`, ultimately reaching `src/runtime/runner.ts` `performAction()`'s existing try/catch around `this.game.continueFlow(...)` (lines 194-200), which converts any thrown error into `{ success: false, error: ..., errorCode: ErrorCode.ENGINE_ERROR }`. This is the same propagation path already used by `resumeSimultaneousAction`'s existing `throw new Error(...)` calls (e.g. lines 445, 451, 454, 457) for invalid player states — confirming the fix requires no new catch/handling infrastructure.

**Fix scope for Plan 04:** replace the silent `frame.completed = true; return {...}` at lines 1442-1445 with a thrown `Error` naming the stringified switch value and the available case keys, matching the locked-decision wording and the `maxIterations`-throw precedent.

---

## Gate Status

| Finding | Verdict | Fix Plan |
|---------|---------|----------|
| F4 / ENG-02 | LEGITIMATE | 02 |
| F5 / ENG-03 | LEGITIMATE | 02 |
| F6 / ENG-04 | LEGITIMATE | 03 |
| F27 / ENG-07 | LEGITIMATE | 04 |

All four findings independently re-verified against current (post-Phase-132) source with current file:line evidence. No fix code was written or planned in the production of this document. PROC-01 gate satisfied — Plans 02-05 are unblocked.
