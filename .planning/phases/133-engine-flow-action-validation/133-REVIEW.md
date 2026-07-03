---
phase: 133-engine-flow-action-validation
reviewed: 2026-07-03T00:00:00Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - src/engine/action/action.test.ts
  - src/engine/action/action.ts
  - src/engine/flow/engine.test.ts
  - src/engine/flow/engine.ts
  - src/engine/flow/turn-order.ts
  - src/runtime/runner.test.ts
findings:
  critical: 0
  warning: 0
  info: 3
  total: 3
fixed:
  critical: 1
  warning: 5
fixed_at: 2026-07-03
status: issues_found
---

# Phase 133: Code Review Report

**Reviewed:** 2026-07-03
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found

## Summary

Reviewed the five Phase 133 changes: eachPlayer wrap-around (`ab0ac935`), simultaneous actionError set/clear (`c56bf44c`), chooseFrom multiSelect server-side enforcement (`423dffa1`), switchOn unmatched-case throw (`bbfc1c4a`), and turn-order.ts JSDoc corrections. All five changes are directionally correct and tested for their happy paths. However, tracing the new multiSelect chooseFrom contract through the full pipeline (resolveArgs → validateSelection → execute) exposes a validation bypass: array items are never canonicalized, and the smart-resolution fallback used to validate them ignores `disabled` annotations — so a custom UI submitting element IDs can select disabled (including tutorial-gated) choices, and the game's `execute()` receives raw IDs instead of choice values. Additional warnings cover a silent wrong-turn-order fallback in the wrap-around path, state/history divergence when the new switchOn throw fires mid-resume, an unmirrored error contract in the simultaneous path, duplicate-item acceptance in multiSelect count enforcement, and a broken code example left in the JSDoc file this phase corrected.

## Critical Issues

### CR-01: multiSelect chooseFrom array items bypass disabled-choice enforcement and reach execute() unresolved

**File:** `src/engine/action/action.ts:710-724` (validation), `src/engine/action/action.ts:210-234` (resolveArgs choice branch)
**Issue:** The new ENG-04 block (lines 747-765) formally blesses arrays as the multiSelect chooseFrom wire contract, but the surrounding pipeline cannot handle array *items*:

1. `resolveArgs`'s choice branch (lines 210-234) only smart-resolves scalar values. For an array, `smartResolveChoiceValue(array, ...)` returns the array unchanged (`isPlainObject` excludes arrays) and `extractChoiceValue(array)` is a no-op. Items that are element IDs or display strings — the exact custom-UI formats the scalar path explicitly supports — stay raw.
2. In `validateSelection`'s array loop (lines 711-724), the disabled check `valuesEqual(c.value, v)` cannot match a raw ID/string against an object choice value, so it falls through to `trySmartResolveChoice(v, choices)` (line 720) — which matches against **all** choices, ignoring `disabled`. A disabled choice (game-disabled or tutorial-gated) submitted by ID or display string therefore validates successfully. The scalar path is protected only because `resolveArgs` canonicalizes the value first; the array path has no such protection.
3. Because nothing canonicalizes the items, validation passes and `action.execute()` receives `[42, 43]` (raw numbers) or display strings where game code expects choice values/elements — a correctness failure even for honest clients.

Concrete trace: `chooseFrom('targets', { choices: ctx => enemies, multiSelect: 2, disabled: c => c.shielded ? 'Shielded' : false })`; custom UI sends `{ targets: [42, 43] }` where 42 is shielded → resolveArgs no-op → per-item disabled check misses → `trySmartResolveChoice(42)` returns true (ignores disabled) → count 2 in bounds → **valid** → `execute()` gets raw numbers including the shielded target.

**Fix:** Make the array path symmetric with the scalar path:
```typescript
// In resolveArgs, choice branch — canonicalize each array item:
} else if (Array.isArray(value) && player) {
  const choices = this.getChoices(selection, player, resolved);
  resolved[selection.name] = value.map(v => {
    let r = this.smartResolveChoiceValue(v, choices);
    return this.extractChoiceValue(r);
  });
}
```
And in `validateSelection`'s array loop, when `trySmartResolveChoice` matches, additionally verify the matched choice is not disabled (or better: resolve the item to the canonical choice first, then run the existing `valuesEqual`-based disabled check against it). The same disabled-ignoring gap exists in the scalar `trySmartResolveChoice` fallback (line 733) for `{value, label}` choices whose extracted scalar no longer `valuesEqual`s the full choice object — fix `trySmartResolveChoice` to skip (or report) choices with `disabled !== false`.

**Resolution:** Fixed in `154a3be2`. `resolveArgs` now canonicalizes each multiSelect array item exactly like the scalar path (serialized element / element ID / display string → canonical choice value), gated on `multiSelect` being configured so a single choice whose value is itself an array is never corrupted. `trySmartResolveChoice` returns the matched `AnnotatedChoice` instead of a boolean, and both the array and scalar validation paths reject smart-resolved matches with `disabled !== false` via the existing `Selection disabled: <reason>` error. Red-first tests cover disabled-by-ID array submissions, element-ID canonicalization, `{value,label}` array canonicalization, and the scalar smart-resolution disabled gap.

## Warnings

### WR-01: Wrap-around silently starts from the wrong player when startingPlayer is filtered out

**File:** `src/engine/flow/engine.ts:1122-1127`
**Issue:** `eligibleSeats` is built from the *filtered* player list, then `startingPlayer` is located in that list; `foundIndex === -1` silently falls back to `startIndex = 0`. With the new wrap-around semantics ("every player gets a turn starting from startingPlayer"), the documented composition `TurnOrder.combine(LEFT_OF_DEALER(...), SKIP_IF(p => p.hasFolded))` (turn-order.ts:160-168) hits this whenever the player left of dealer has folded: the round silently starts from the first seat in the filtered list instead of the next eligible player after the dealer — wrong betting order, no error, no warning. This fallback predates the phase, but the phase changed the semantics that make it consequential, updated the docs to promise startingPlayer-anchored rotation, and added no test for the filter+startingPlayer interplay.
**Fix:** When `startingPlayer` is not in the filtered list, rotate from the first eligible player at-or-after the starting player's position in the unfiltered order, e.g. find `startIndex` in the *unfiltered* rotated order and then filter — or at minimum `devWarn` on the `foundIndex === -1` fallback. Add a test: 4 players, start from seat 2, seat 2 filtered out → expected order `[3, 4, 1]`, not `[1, 3, 4]`.

**Resolution:** Fixed in `c4c22d54`. `executeEachPlayer` now rotates the unfiltered player order to the starting player first and applies the filter afterwards, so a filtered-out startingPlayer yields the next eligible seat after it (wrap semantics). When startingPlayer is eligible the result is identical to before. Red-first test: 4 players, start seat 2, seat 2 filtered → `[3, 4, 1]`.

### WR-02: switchOn throw fires after the triggering action has committed — state/history divergence and wedged flow

**File:** `src/engine/flow/engine.ts:1446-1452`, consumed at `src/runtime/runner.ts:196-214`
**Issue:** When a `switchOn` immediately follows an action step and `config.on(context)` yields an unmatched value (a *runtime* value, not necessarily a static misconfiguration), the throw propagates out of `resume()` **after** `game.performAction` already mutated game state and `awaitingInput` was set false (engine.ts:274-286). `GameRunner.performAction` catches it (runner.ts:198-204), returns `success: false`, and does **not** record the action in `actionHistory` — so game state now diverges from action history (replay/undo/snapshot inconsistency), and every subsequent `resume()` throws `'Flow is not awaiting input'`: the game is permanently wedged. Failing loud here is correct and consistent with the loop maxIterations tripwire convention (audit2 F33), but unlike the loop cap, this one triggers from ordinary game-state values and leaves a committed-but-unrecorded action behind.
**Fix:** At minimum, document in the error message that the game is unrecoverable and the flow definition must handle all values (or add `default`). Better: evaluate `config.on` reachability before committing, or have `run()`-originated developer-error throws mark the engine as poisoned with a distinct error so the session surfaces "game halted: flow definition error" rather than a per-action failure that looks retryable.

**Resolution:** Fixed in `5d05d87b`. Post-commit flow failures now surface as a distinct `FlowHaltedError` ("Game halted: the flow failed after the action was committed — ... not a retryable player error") raised from a shared `continueAfterCommittedAction` path in `resume()`, `resumeAfterExternalAction()`, and the simultaneous allDone branch. `GameRunner.performAction` catches it and records the committed action in `actionHistory` before returning the failure, restoring the state/history invariant (replay/undo/snapshot consistency). Fail-loud is preserved: the game halts, but the error is clearly non-retryable and the switchOn message now tells the developer to add a matching case or `default`. Extracting the shared path also collapsed the IN-03 dead conditional. Red-first runner test proves the committed action is recorded and the error is marked halted.

### WR-03: resumeSimultaneousAction throws where resume() records actionError — unmirrored error contract

**File:** `src/engine/flow/engine.ts:444-463` vs `src/engine/flow/engine.ts:267-271`
**Issue:** The ENG-03 fix mirrors `resume()`'s actionError set/clear only for the `performAction`-failure branch. The pre-flight checks still `throw`: action not in the player's allow-list (line 457), player already completed (line 454), player not awaiting (line 451). In the regular action-step path the equivalent allow-list violation gracefully sets `actionError` and returns state (line 268-271). Through the runner, the simultaneous throws surface as `ErrorCode.ENGINE_ERROR` while the sequential equivalent surfaces as a flow-level action error — so a client double-submitting after completing its simultaneous step (an ordinary race in concurrent play, not a programming error) gets an engine-error instead of an actionable rejection. Inconsistent with the Phase 131/132 convention of reserving throws for developer errors and using `actionError` for player-input rejection.
**Fix:** Convert the three pre-flight throws to `this.actionError = ...; return this.getState();` matching resume()'s allow-list handling, e.g.:
```typescript
if (!playerState.availableActions.includes(actionName)) {
  this.actionError = `Action ${actionName} is not available for player ${actingPlayerIndex}`;
  return this.getState();
}
```

**Resolution:** Fixed in `ce2864b1`. All three pre-flight checks (player not awaiting, player already completed, action not in allow-list) now set `actionError` and return state, exactly mirroring `resume()`'s allow-list handling; the runner surfaces them as `ACTION_EXECUTION_ERROR` instead of `ENGINE_ERROR`. Developer-error throws (no player determinable, invalid player position) remain throws. Red-first tests cover double-submit after completion, out-of-allow-list action, and non-awaiting player.

### WR-04: multiSelect count enforcement accepts duplicate items

**File:** `src/engine/action/action.ts:747-765` (new choice branch), `src/engine/action/action.ts:827-842` (elements branch, same gap)
**Issue:** `['red', 'red']` satisfies `multiSelect: { min: 2 }` — each item validates individually and `value.length` meets the bound. A client (the exact untrusted party ENG-04 exists to defend against) can satisfy "choose N" by repeating one choice, and `execute()` receives duplicates game code will not expect (e.g. discarding the same card twice). The elements branch shares the gap (duplicate element IDs), so the new code faithfully mirrored an existing hole.
**Fix:** Reject duplicates in both branches before the count check:
```typescript
const seen = new Set(value.map(v => JSON.stringify(v))); // or element id for elements branch
if (seen.size !== value.length) {
  errors.push(`Selection "${selection.name}" contains duplicate choices`);
}
```

**Resolution:** Fixed in `6ca8e31c`. A shared `hasDuplicateItems` helper rejects duplicates before the count check in both the choice and elements multiSelect branches (fail-loud rejection, not silent dedupe). Element-referencing items are keyed by element id — so a raw ID and its resolved element count as the same item, avoiding `JSON.stringify` on circular GameElement structures — and other values are keyed by JSON serialization, matching `valuesEqual` semantics. Red-first tests: `['red','red']` and `[card1, card1]` both rejected with a "duplicate" error.

### WR-05: LEFT_OF_DEALER JSDoc example calls methods that do not exist

**File:** `src/engine/flow/turn-order.ts:121-125`
**Issue:** This phase's stated scope included JSDoc corrections in this file, but the LEFT_OF_DEALER example still reads:
```typescript
const dealer = ctx.game.players.get(ctx.game.dealerPosition);
ctx.game.dealerSeat = ctx.game.players.nextAfter(dealer).seat;
```
`game.players` is a plain `P[]` (game.ts:1968) — it has neither `.get()` nor `.nextAfter()`; the implementation itself correctly uses `ctx.game.getPlayerOrThrow(...)` and `ctx.game.nextAfter(...)` (lines 132-133). The example also writes `dealerSeat` while reading `dealerPosition`. Copy-pasting the documented end-of-hand pattern produces a runtime TypeError.
**Fix:**
```typescript
const dealer = ctx.game.getPlayerOrThrow(ctx.game.dealerPosition);
ctx.game.dealerPosition = ctx.game.nextAfter(dealer).seat;
```

**Resolution:** Fixed in `5e89bc71`. The LEFT_OF_DEALER JSDoc example now uses `ctx.game.getPlayerOrThrow(...)` and `ctx.game.nextAfter(...)` (the same APIs the implementation uses) and writes back to `dealerPosition`, the field it reads.

## Info

### IN-01: actionError is engine-global — cross-player clearing in simultaneous steps

**File:** `src/engine/flow/engine.ts:468-475`
**Issue:** `actionError` carries no player attribution. In a simultaneous step, player B's success clears player A's recorded failure (the new test at engine.test.ts "fail-then-succeed" encodes this as expected), and two failures keep only the last. This is benign today because the only consumer (`runner.ts:207`) reads it synchronously per call, but `restoreFullState` round-trips it and any future consumer of `FlowState.actionError` (e.g. a UI error banner fed from broadcast state) inherits cross-player ambiguity.
**Fix:** Consider `actionError?: { playerIndex?: number; message: string }` (or a per-player field on `PlayerAwaitingState`) before another consumer appears.

### IN-02: Pre-fix checkpoints carrying truncated eligibleSeats restore as silently short rounds

**File:** `src/engine/flow/engine.ts:1111` (guard), `src/engine/flow/engine.ts:557-601` (restore)
**Issue:** `restore()` round-trips `frame.data.eligibleSeats` verbatim, and `executeEachPlayer` skips rebuilding whenever the key is present. A checkpoint captured mid-round before commit `ab0ac935` holds a truncated (non-wrapped) array; restoring it silently ends the round early rather than failing loud. Acceptable under the project's No-Backward-Compatibility rule, but note no protocol/format version guard distinguishes old frame data (INFRA-04 stamps bundles, not dev checkpoints).
**Fix:** None required if stale dev checkpoints are considered disposable; otherwise bump a frame-data version so restore rejects pre-wrap frames loudly.

### IN-03: Dead conditional in resume()

**File:** `src/engine/flow/engine.ts:287-292`
**Issue:** Both branches are identical:
```typescript
if (this.handleActionStepCompletion(result)) {
  return this.run();
}
return this.run();
```
The comment claims the true branch means "run() immediately (followUp)", but the false branch also runs immediately — the boolean return of `handleActionStepCompletion` is meaningless at both call sites (same pattern at lines 317-322).
**Fix:** Drop the conditional (`this.handleActionStepCompletion(result); return this.run();`) or make the return value do something.

---

**Test-gap notes (per project rule "treat test gaps as blockers"):** no test covers (a) wrap-around + `filter` when startingPlayer is filtered out (WR-01), (b) mid-round checkpoint restore of a wrapped `eligibleSeats` frame, (c) multiSelect chooseFrom submissions in element-ID/display-string form (the CR-01 path) — all new tests submit canonical string choices only.

---

_Reviewed: 2026-07-03_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
