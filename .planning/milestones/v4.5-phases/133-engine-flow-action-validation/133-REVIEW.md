---
phase: 133-engine-flow-action-validation
reviewed: 2026-07-03T00:00:00Z
re_reviewed: 2026-07-03T16:30:00Z
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
  info: 4
  total: 4
fixed:
  critical: 1
  warning: 8
  info: 1
fixed_at: 2026-07-03
status: resolved
---

# Phase 133: Code Review Report

**Reviewed:** 2026-07-03 (re-review iteration 2: 2026-07-03)
**Depth:** standard
**Files Reviewed:** 6
**Status:** resolved (all Critical/Warning findings fixed; Info items remain open)

## Summary

Reviewed the five Phase 133 changes: eachPlayer wrap-around (`ab0ac935`), simultaneous actionError set/clear (`c56bf44c`), chooseFrom multiSelect server-side enforcement (`423dffa1`), switchOn unmatched-case throw (`bbfc1c4a`), and turn-order.ts JSDoc corrections. All five changes are directionally correct and tested for their happy paths. However, tracing the new multiSelect chooseFrom contract through the full pipeline (resolveArgs → validateSelection → execute) exposes a validation bypass: array items are never canonicalized, and the smart-resolution fallback used to validate them ignores `disabled` annotations — so a custom UI submitting element IDs can select disabled (including tutorial-gated) choices, and the game's `execute()` receives raw IDs instead of choice values. Additional warnings cover a silent wrong-turn-order fallback in the wrap-around path, state/history divergence when the new switchOn throw fires mid-resume, an unmirrored error contract in the simultaneous path, duplicate-item acceptance in multiSelect count enforcement, and a broken code example left in the JSDoc file this phase corrected.

## Re-Review (Iteration 2) — Fix Verification

All six fixes (CR-01, WR-01..05, commits `154a3be2`, `c4c22d54`, `5d05d87b`, `ce2864b1`, `6ca8e31c`, `5e89bc71`) were re-traced against the current source and their red-first tests. All 258 tests across the three affected suites pass.

**Verified resolved:**

- **CR-01** — `resolveArgs` (action.ts:218-235) canonicalizes multiSelect array items (serialized element / element ID / display string → canonical choice value), gated on `multiSelect !== undefined` so a single choice whose value is itself an array is not corrupted; `resolved = { ...args }` means the no-op branch leaves the raw value intact (no value-drop). `trySmartResolveChoice` now returns the matched `AnnotatedChoice`, and both the array path (action.ts:774-780) and scalar path (action.ts:793-799) reject smart-resolved matches with `disabled !== false`. No remaining bypass on the exact-match path: the `valuesEqual`-based disabled check runs FIRST in both paths (action.ts:763, 786), so a canonicalized item that equals a disabled choice value is rejected before `annotatedChoicesContain` can accept it.
- **WR-01** — rotate-then-filter (engine.ts:1156-1182) is order-correct. When startingPlayer is eligible, rotate-then-filter equals the previous filter-then-rotate because filtering preserves relative order — no regression. Filtered-out startingPlayer now yields the next eligible seat after it (test: `[3, 4, 1]`). Absent/invalid startingPlayer (`findIndex` -1) falls back to index 0, matching prior behavior. Sole-player and backward-direction paths unaffected (reverse happens before rotation, as before).
- **WR-02** — sequential path verified: `continueAfterCommittedAction` (engine.ts:345-353) wraps `handleActionStepCompletion` + `run()` for both `resume()` and `resumeAfterExternalAction()`; the runner (runner.ts:204-206) records the committed action on `FlowHaltedError` before returning failure. Checkpoint/undo interaction is sane: `actionCheckpoints[n]` holds the state observed at n recorded actions — i.e. the pre-halted-action state — so undo of the recorded halted action restores an awaiting-input pre-commit state; the game is recoverable via undo, not wedged. The pending-action completion paths (runner.ts:412-415, pending-action-manager.ts:338-343) record BEFORE advancing the flow, so a FlowHaltedError there cannot cause divergence. **However, the fix is incomplete on the simultaneous path — see WR-06 below.**
- **WR-03** — all three pre-flight checks (engine.ts:483-495) set `actionError` and return `getState()`, which includes `actionError` (engine.ts:586-588), so the runner surfaces `ACTION_EXECUTION_ERROR`. Genuine developer errors still throw: "No player specified..." (engine.ts:475) and "Invalid player position" (engine.ts:500). No stale leak: every success path clears `actionError` (engine.ts:305, 330, 512) and each pre-flight failure overwrites it.
- **WR-04** — `hasDuplicateItems` (action.ts:515-530) rejects duplicates before the count check in both the choice (action.ts:820-822) and elements (action.ts:905-907) branches; element-referencing items keyed by id (raw ID and resolved element collide correctly, no circular-JSON hazard). **However, the JSON/id keying creates a false-positive class — see WR-07 below.**
- **WR-05** — LEFT_OF_DEALER JSDoc (turn-order.ts:121-125) now uses `getPlayerOrThrow`/`nextAfter` (the same APIs as the implementation at lines 132-133) and writes back `dealerPosition`. Verified against `Game`'s actual API.
- **IN-03** — resolved as a side effect of `5d05d87b`: the dead conditional collapsed into `continueAfterCommittedAction`.

**New findings from re-review:** WR-06 (residual WR-02 gap on the simultaneous path), WR-07 (WR-04 false positive on legitimately duplicated choice values), WR-08 (pre-existing element-selection array bypass adjacent to the CR-01 code), IN-04, IN-05.

## Critical Issues

### CR-01: multiSelect chooseFrom array items bypass disabled-choice enforcement and reach execute() unresolved — RESOLVED

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

**Resolution:** Fixed in `154a3be2`. `resolveArgs` now canonicalizes each multiSelect array item exactly like the scalar path (serialized element / element ID / display string → canonical choice value), gated on `multiSelect` being configured so a single choice whose value is itself an array is never corrupted. `trySmartResolveChoice` returns the matched `AnnotatedChoice` instead of a boolean, and both the array and scalar validation paths reject smart-resolved matches with `disabled !== false` via the existing `Selection disabled: <reason>` error. Red-first tests cover disabled-by-ID array submissions, element-ID canonicalization, `{value,label}` array canonicalization, and the scalar smart-resolution disabled gap. **Re-review iteration 2: verified in source and tests; no remaining bypass found on either the exact-match or smart-resolve path.**

## Warnings

### WR-06: FlowHaltedError wrap does not cover the simultaneous path's post-commit callbacks (NEW — residual WR-02 gap) — RESOLVED

**File:** `src/engine/flow/engine.ts:511-539` (unwrapped), `src/engine/flow/engine.ts:548-553` (wrap starts too late)
**Issue:** In `resumeSimultaneousAction`, the action commits at line 502 (`performAction` succeeds), but the `FlowHaltedError` wrap only begins at the `allDone` branch's `this.run()` (line 548). Everything between commit and that point runs unwrapped:
- `config.playerDone(context, player)` (line 517)
- `config.actions(context, player)` (line 523)
- `this.game.getAvailableActions(player)` inside the filter (line 528)
- `config.allDone(context)` (line 538)

These are developer callbacks evaluating live game state — exactly the same failure class as `switchOn`'s `on()` that motivated WR-02. If any of them throws, the throw is post-commit but reaches `GameRunner.performAction`'s catch as a plain `Error`, so the `instanceof FlowHaltedError` check (runner.ts:204) fails and the committed action is **not** recorded — reproducing the precise state/history divergence WR-02 was fixed to eliminate, just on the simultaneous path.
**Fix:** Start the try block immediately after the commit is acknowledged (right after `this.actionError = undefined` at line 512) so every post-commit throw in this method is wrapped:
```typescript
this.actionError = undefined;
try {
  // playerDone / actions re-eval / allDone / frame completion / run()
  ...
  return this.getState();
} catch (error) {
  if (error instanceof FlowHaltedError) throw error;
  throw new FlowHaltedError(error);
}
```

**Resolution:** Fixed in `428b48d4`. The try block in `resumeSimultaneousAction` now begins immediately after the commit is acknowledged (`this.actionError = undefined`), so `playerDone`, the `actions` re-eval (including `getAvailableActions`), `allDone`, frame completion, and `run()` are all covered; any throw surfaces as `FlowHaltedError` (an inner `FlowHaltedError` is re-thrown, not double-wrapped) and the runner records the committed action. Red-first tests (engine.test.ts): post-commit throws from `playerDone`, `allDone`, and the `actions()` re-eval each surface as `FlowHaltedError` carrying the original message — all three failed as plain `Error` pre-fix.

### WR-07: duplicate rejection false-positives on legitimately duplicated choice values (NEW — introduced by the WR-04 fix) — RESOLVED

**File:** `src/engine/action/action.ts:515-530` (`hasDuplicateItems`), consumed at `src/engine/action/action.ts:820-822`
**Issue:** The duplicate check inspects only the submitted items, never the choices list. Two consequences:
1. When the developer's choices legitimately contain the same value more than once — e.g. a deckbuilder hand `chooseFrom('discards', { choices: ['copper', 'copper', 'estate'], multiSelect: 2 })` — submitting `['copper', 'copper']` is the **only** possible wire encoding of "both coppers" (values are the identity in the protocol; there is no per-instance id for scalar choices). This was accepted before `6ca8e31c` (each item validated individually, count in bounds) and is now rejected with "contains duplicate choices" — a behavior regression that makes the two-copy selection unexpressible.
2. Any plain object with a numeric `id` property is keyed by `id:` alone, so two *distinct* non-element choice values that happen to share an `id` field (`{id: 1, kind: 'attack'}` vs `{id: 1, kind: 'defend'}`) are falsely flagged as duplicates.
The elements branch is unaffected (GameElement ids are globally unique).
**Fix:** Make the check multiplicity-aware for the choice branch: count occurrences of each key among the annotated choices and reject only when a submitted key's count exceeds its occurrence count in `choices`. For the object-id keying, include a discriminator (e.g. `className` when present, else full JSON) rather than bare `id` for non-element plain objects.

**Resolution:** Fixed in `d692a3de`. chooseFrom submissions now use a new `hasDuplicateChoiceItems(items, choices)`: each submitted item claims a distinct choice slot, matched by `valuesEqual` against the annotated choice values with a `trySmartResolveChoice` fallback for raw element IDs / display strings — so a value may appear at most as many times as the choices list offers it, and identity is choice identity (full-value equality), eliminating the bare-`id:` false-collision class entirely rather than patching its keying. Items matching no choice are ignored (the per-item loop already rejects them). The elements branch keeps id-based keying under the renamed `hasDuplicateElementItems` (GameElement ids are globally unique there). Red-first tests: `['copper','copper']` against `['copper','copper','estate']` accepted (rejected pre-fix), three coppers rejected, distinct `{id:1,...}` objects accepted (rejected pre-fix); element-object + raw-ID duplicate still rejected (regression guard).

### WR-08: array submitted for a single `element` selection passes validation with zero item checks (pre-existing, adjacent to CR-01 code) — RESOLVED

**File:** `src/engine/action/action.ts:760-783`
**Issue:** The array loop in `validateSelection` only ever pushes errors when `selection.type === 'choice'` (line 773). For a `chooseElement` (type `'element'`) selection, a client submitting an array — `{ card: [999, 1000] }` — takes the array branch: `disabledItem` never matches, `annotatedChoicesContain` fails, and then **no error is recorded** because the smart-resolve block is choice-only and, unlike the scalar path (line 800-802), the array path has no `else if (selection.type === 'element')` rejection. `resolveArgs`'s element branch only resolves scalar numbers/serialized objects, so the raw array flows through validation as **valid** and reaches `execute()` untouched. This is a pre-existing gap (the pre-fix code had the identical choice-only guard), not introduced by the CR-01 fix — but it is the same untrusted-input validation surface ENG-04 exists to defend, in the exact block the fix modified.
**Fix:** Mirror the scalar path inside the array loop:
```typescript
if (!this.annotatedChoicesContain(choices, v)) {
  if (selection.type === 'choice') {
    // existing smart-resolve + disabled logic
  } else if (selection.type === 'element') {
    errors.push(`Invalid selection for ${selection.name}`);
  }
}
```
Or reject arrays outright for single `element` selections before the loop (an `element` selection is never multiSelect).

**Resolution:** Fixed in `279ef5bc` using the second (stronger) form: `validateSelection` rejects arrays outright for `element` selections before the loop — an `element` selection is never multiSelect, so an array is never a valid submission shape regardless of its contents. The error is actionable: it names the selection, states one element/ID is expected, and points at `chooseElements` for multi-element needs. Red-first tests: `[validId]` and `[999, 1000]` both rejected (both validated as valid pre-fix).

### WR-01: Wrap-around silently starts from the wrong player when startingPlayer is filtered out — RESOLVED

**File:** `src/engine/flow/engine.ts:1122-1127`
**Issue:** `eligibleSeats` is built from the *filtered* player list, then `startingPlayer` is located in that list; `foundIndex === -1` silently falls back to `startIndex = 0`. With the new wrap-around semantics ("every player gets a turn starting from startingPlayer"), the documented composition `TurnOrder.combine(LEFT_OF_DEALER(...), SKIP_IF(p => p.hasFolded))` (turn-order.ts:160-168) hits this whenever the player left of dealer has folded: the round silently starts from the first seat in the filtered list instead of the next eligible player after the dealer — wrong betting order, no error, no warning. This fallback predates the phase, but the phase changed the semantics that make it consequential, updated the docs to promise startingPlayer-anchored rotation, and added no test for the filter+startingPlayer interplay.
**Fix:** When `startingPlayer` is not in the filtered list, rotate from the first eligible player at-or-after the starting player's position in the unfiltered order, e.g. find `startIndex` in the *unfiltered* rotated order and then filter — or at minimum `devWarn` on the `foundIndex === -1` fallback. Add a test: 4 players, start from seat 2, seat 2 filtered out → expected order `[3, 4, 1]`, not `[1, 3, 4]`.

**Resolution:** Fixed in `c4c22d54`. `executeEachPlayer` now rotates the unfiltered player order to the starting player first and applies the filter afterwards, so a filtered-out startingPlayer yields the next eligible seat after it (wrap semantics). When startingPlayer is eligible the result is identical to before. Red-first test: 4 players, start seat 2, seat 2 filtered → `[3, 4, 1]`. **Re-review iteration 2: verified — order-preservation of `Array.filter` guarantees no regression for the eligible-startingPlayer, sole-player, and backward-direction cases.**

### WR-02: switchOn throw fires after the triggering action has committed — state/history divergence and wedged flow — RESOLVED (sequential path; see WR-06 for the simultaneous residual)

**File:** `src/engine/flow/engine.ts:1446-1452`, consumed at `src/runtime/runner.ts:196-214`
**Issue:** When a `switchOn` immediately follows an action step and `config.on(context)` yields an unmatched value (a *runtime* value, not necessarily a static misconfiguration), the throw propagates out of `resume()` **after** `game.performAction` already mutated game state and `awaitingInput` was set false (engine.ts:274-286). `GameRunner.performAction` catches it (runner.ts:198-204), returns `success: false`, and does **not** record the action in `actionHistory` — so game state now diverges from action history (replay/undo/snapshot inconsistency), and every subsequent `resume()` throws `'Flow is not awaiting input'`: the game is permanently wedged. Failing loud here is correct and consistent with the loop maxIterations tripwire convention (audit2 F33), but unlike the loop cap, this one triggers from ordinary game-state values and leaves a committed-but-unrecorded action behind.
**Fix:** At minimum, document in the error message that the game is unrecoverable and the flow definition must handle all values (or add `default`). Better: evaluate `config.on` reachability before committing, or have `run()`-originated developer-error throws mark the engine as poisoned with a distinct error so the session surfaces "game halted: flow definition error" rather than a per-action failure that looks retryable.

**Resolution:** Fixed in `5d05d87b`. Post-commit flow failures now surface as a distinct `FlowHaltedError` ("Game halted: the flow failed after the action was committed — ... not a retryable player error") raised from a shared `continueAfterCommittedAction` path in `resume()`, `resumeAfterExternalAction()`, and the simultaneous allDone branch. `GameRunner.performAction` catches it and records the committed action in `actionHistory` before returning the failure, restoring the state/history invariant (replay/undo/snapshot consistency). Fail-loud is preserved: the game halts, but the error is clearly non-retryable and the switchOn message now tells the developer to add a matching case or `default`. Extracting the shared path also collapsed the IN-03 dead conditional. Red-first runner test proves the committed action is recorded and the error is marked halted. **Re-review iteration 2: sequential path verified, including undo recoverability (`actionCheckpoints[n]` holds the pre-commit state, so undoing the recorded halted action restores an awaiting-input state). The simultaneous path's wrap starts too late — tracked as WR-06.**

### WR-03: resumeSimultaneousAction throws where resume() records actionError — unmirrored error contract — RESOLVED

**File:** `src/engine/flow/engine.ts:444-463` vs `src/engine/flow/engine.ts:267-271`
**Issue:** The ENG-03 fix mirrors `resume()`'s actionError set/clear only for the `performAction`-failure branch. The pre-flight checks still `throw`: action not in the player's allow-list (line 457), player already completed (line 454), player not awaiting (line 451). In the regular action-step path the equivalent allow-list violation gracefully sets `actionError` and returns state (line 268-271). Through the runner, the simultaneous throws surface as `ErrorCode.ENGINE_ERROR` while the sequential equivalent surfaces as a flow-level action error — so a client double-submitting after completing its simultaneous step (an ordinary race in concurrent play, not a programming error) gets an engine-error instead of an actionable rejection. Inconsistent with the Phase 131/132 convention of reserving throws for developer errors and using `actionError` for player-input rejection.
**Fix:** Convert the three pre-flight throws to `this.actionError = ...; return this.getState();` matching resume()'s allow-list handling.

**Resolution:** Fixed in `ce2864b1`. All three pre-flight checks (player not awaiting, player already completed, action not in allow-list) now set `actionError` and return state, exactly mirroring `resume()`'s allow-list handling; the runner surfaces them as `ACTION_EXECUTION_ERROR` instead of `ENGINE_ERROR`. Developer-error throws (no player determinable, invalid player position) remain throws. Red-first tests cover double-submit after completion, out-of-allow-list action, and non-awaiting player. **Re-review iteration 2: verified — `getState()` includes `actionError`, success paths clear it, no stale-leak path found.**

### WR-04: multiSelect count enforcement accepts duplicate items — RESOLVED (with a new false-positive class; see WR-07)

**File:** `src/engine/action/action.ts:747-765` (new choice branch), `src/engine/action/action.ts:827-842` (elements branch, same gap)
**Issue:** `['red', 'red']` satisfies `multiSelect: { min: 2 }` — each item validates individually and `value.length` meets the bound. A client (the exact untrusted party ENG-04 exists to defend against) can satisfy "choose N" by repeating one choice, and `execute()` receives duplicates game code will not expect (e.g. discarding the same card twice). The elements branch shares the gap (duplicate element IDs), so the new code faithfully mirrored an existing hole.
**Fix:** Reject duplicates in both branches before the count check.

**Resolution:** Fixed in `6ca8e31c`. A shared `hasDuplicateItems` helper rejects duplicates before the count check in both the choice and elements multiSelect branches (fail-loud rejection, not silent dedupe). Element-referencing items are keyed by element id — so a raw ID and its resolved element count as the same item, avoiding `JSON.stringify` on circular GameElement structures — and other values are keyed by JSON serialization, matching `valuesEqual` semantics. Red-first tests: `['red','red']` and `[card1, card1]` both rejected with a "duplicate" error. **Re-review iteration 2: the rejection works as specified, but the check is not multiplicity-aware — legitimately duplicated choice values are now unexpressible (WR-07).**

### WR-05: LEFT_OF_DEALER JSDoc example calls methods that do not exist — RESOLVED

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

**Resolution:** Fixed in `5e89bc71`. The LEFT_OF_DEALER JSDoc example now uses `ctx.game.getPlayerOrThrow(...)` and `ctx.game.nextAfter(...)` (the same APIs the implementation uses) and writes back to `dealerPosition`, the field it reads. **Re-review iteration 2: verified against Game's actual API.**

## Info

### IN-01: actionError is engine-global — cross-player clearing in simultaneous steps

**File:** `src/engine/flow/engine.ts:468-475`
**Issue:** `actionError` carries no player attribution. In a simultaneous step, player B's success clears player A's recorded failure (the new test at engine.test.ts "fail-then-succeed" encodes this as expected), and two failures keep only the last. This is benign today because the only consumer (`runner.ts:207`) reads it synchronously per call, but `restoreFullState` round-trips it and any future consumer of `FlowState.actionError` (e.g. a UI error banner fed from broadcast state) inherits cross-player ambiguity. Note the WR-03 fix routes three more failure classes through this same global field, slightly widening the exposure.
**Fix:** Consider `actionError?: { playerIndex?: number; message: string }` (or a per-player field on `PlayerAwaitingState`) before another consumer appears.

### IN-02: Pre-fix checkpoints carrying truncated eligibleSeats restore as silently short rounds

**File:** `src/engine/flow/engine.ts:1153` (guard), `src/engine/flow/engine.ts:601-645` (restore)
**Issue:** `restore()` round-trips `frame.data.eligibleSeats` verbatim, and `executeEachPlayer` skips rebuilding whenever the key is present. A checkpoint captured mid-round before commit `ab0ac935` holds a truncated (non-wrapped) array; restoring it silently ends the round early rather than failing loud. Acceptable under the project's No-Backward-Compatibility rule, but note no protocol/format version guard distinguishes old frame data (INFRA-04 stamps bundles, not dev checkpoints).
**Fix:** None required if stale dev checkpoints are considered disposable; otherwise bump a frame-data version so restore rejects pre-wrap frames loudly.

### IN-03: Dead conditional in resume() — RESOLVED

**File:** `src/engine/flow/engine.ts:287-292`
**Issue:** Both branches were identical (`if (this.handleActionStepCompletion(result)) return this.run(); return this.run();`), making the boolean return meaningless at both call sites.
**Resolution:** Collapsed as a side effect of the WR-02 fix (`5d05d87b`) — both call sites now delegate to `continueAfterCommittedAction`, which calls `handleActionStepCompletion(result)` unconditionally followed by `run()`.

### IN-04: FlowHaltedError discards the original error's stack (NEW)

**File:** `src/engine/flow/engine.ts:196-206`
**Issue:** The constructor keeps only `cause.message`; the wrapped error's stack trace (which points at the actual flow-definition bug — the switchOn node, the throwing callback) is lost. For a "fix your flow definition" error, the original stack is the primary debugging signal.
**Fix:** `super(message, { cause })` (ES2022 error cause, already available at the project's target) so tooling and logs can surface the inner stack.

### IN-05: resolveArgs multiSelect gate is static; validation still treats every array as multiSelect items (NEW)

**File:** `src/engine/action/action.ts:225` (gate), `src/engine/action/action.ts:760` (loop)
**Issue:** Two edges of the CR-01 gate: (1) the gate tests `multiSelect !== undefined` statically — a function-valued `multiSelect` that returns `undefined` at runtime (dynamically single-select) still triggers per-item canonicalization, which could corrupt a single choice whose value is an array of strings matching other choices' labels; (2) independently of the gate, `validateSelection`'s `Array.isArray(value)` branch (pre-existing) per-item-validates ANY array, so a single chooseFrom choice whose value is an array remains rejected by validation regardless of resolveArgs' care to preserve it. Both are contrived today (array-valued scalar choices were already unusable pre-phase, and ENG-04 now formally reserves arrays for multiSelect), but the gate's comment overpromises what it protects.
**Fix:** Either document that array-valued single-choice values are unsupported (arrays are the multiSelect wire format, full stop), or gate both the resolveArgs canonicalization and the validation array loop on the *evaluated* multiSelect config.

---

**Test-gap notes (per project rule "treat test gaps as blockers"):** iteration 1 gaps (a)–(c) are now covered by the red-first fix tests. Iteration 2 gaps are also closed: post-commit throws from `playerDone`/`allDone`/`actions()` in a simultaneous step are covered by the WR-06 fix tests, and duplicated values in the choices list with multiSelect by the WR-07 fix tests.

---

_Reviewed: 2026-07-03 (iteration 1), 2026-07-03 (iteration 2 fix verification)_
_Reviewer: Claude (gsd-code-reviewer)_
_Fixes applied: 2026-07-03 — WR-06 `428b48d4`, WR-07 `d692a3de`, WR-08 `279ef5bc` (Claude, gsd-code-fixer)_
_Depth: standard_
