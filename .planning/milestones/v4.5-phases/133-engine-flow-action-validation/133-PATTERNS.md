# Phase 133: Engine Flow & Action Validation - Pattern Map

**Mapped:** 2026-07-03
**Files analyzed:** 6 (4 source files with targeted fixes + 2 test files with insertions)
**Analogs found:** 6 / 6 (all fixes are same-file sibling patterns — no external analog needed)

This phase is unusual: every fix's "analog" is a **sibling code block in the same file** (a working pattern a few lines away from the buggy one), not a different file entirely. All line numbers below were re-verified against current `main` in this session (post Phase-132) and match RESEARCH.md's numbers exactly except `executeSwitch` (line 1442, not 1442-1445 for the specific `if (!branch)` line — confirmed identical).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog (same file unless noted) | Match Quality |
|---|---|---|---|---|
| `src/engine/flow/engine.ts` — `executeEachPlayer` (ENG-02) | flow executor (state-machine step) | transform (array construction) | Nothing to port — one-line formula fix, `Array.prototype.slice` degenerate-case reasoning only | exact (self-contained) |
| `src/engine/flow/engine.ts` — `resumeSimultaneousAction` (ENG-03) | flow executor (state-machine step) | request-response (action resolution) | `resume()` regular-path failure/success branch, same file, lines 277-284 | exact |
| `src/engine/flow/engine.ts` — `executeSwitch` (ENG-07) | flow executor (state-machine step) | event-driven (branch dispatch) | `executeLoop`'s `maxIterations` throw, same file, lines 1043-1069 | role-match (both are "flow-control safety throw") |
| `src/engine/action/action.ts` — `validateSelection` choice branch (ENG-04) | validation / service | CRUD (validate then accept/reject) | `validateSelection` elements branch, same file, lines 802-817 | exact |
| `src/engine/flow/turn-order.ts` (doc-only) | config/preset (JSDoc) | — | N/A — text edit to match new ENG-02 behavior | exact (self-contained) |
| `docs/common-patterns.md` (doc-only) | documentation | — | N/A — text edit to remove now-inaccurate no-wrap caveat | exact (self-contained) |
| `src/engine/flow/engine.test.ts` (test insertions) | test | — | Existing `describe('EachPlayer Execution', ...)` (line 303) and `describe('Conditionals', ...)` (line 580, `switchOn` tests at 615-648) | exact |
| `src/engine/action/action.test.ts` (test insertions) | test | — | Existing `describe('validateSelection', ...)` (line 254) and F31 elements-branch multiSelect tests (lines 2223-2320) | exact |

## Pattern Assignments

### `src/engine/flow/engine.ts` — ENG-02: `executeEachPlayer` wrap-around

**Current buggy code** (`engine.ts:1107-1130`):
```typescript
if (frame.data?.eligibleSeats === undefined) {
  let players = [...this.game.all(Player as any)] as Player[];

  if (config.filter) {
    players = players.filter((p) => config.filter!(p, context));
  }

  if (config.direction === 'backward') {
    players.reverse();
  }

  let startIndex = 0;
  if (config.startingPlayer) {
    const startPlayer = config.startingPlayer(context);
    const foundIndex = players.findIndex((p) => p.seat === startPlayer.seat);
    startIndex = foundIndex >= 0 ? foundIndex : 0;
  }

  frame.data = {
    ...frame.data,
    eligibleSeats: players.slice(startIndex).map(p => p.seat),   // BUG: truncates, never wraps
    nextIndex: 0,
  };
}
```

**Fix — change exactly one expression** (line 1127):
```typescript
eligibleSeats: [...players.slice(startIndex), ...players.slice(0, startIndex)].map(p => p.seat),
```
No other line in this block changes. `startIndex === 0` (no `startingPlayer` configured — the common case for all 8 shipped games + MERC) degenerates safely: `slice(0)` returns the full array, `slice(0,0)` returns `[]`, so behavior is unchanged for every existing caller.

**Everything downstream of `eligibleSeats` (lines 1132+) is untouched** — the iteration/`nextIndex` logic already treats `eligibleSeats` as an opaque ordered list.

---

### `src/engine/flow/engine.ts` — ENG-03: `resumeSimultaneousAction` actionError mirror

**Analog — the already-correct sibling in `resume()`** (`engine.ts:273-284`):
```typescript
// Execute the action (regular action step)
const result = this.game.performAction(actionName, this.currentPlayer!, args);
this.lastActionResult = result;

if (!result.success) {
  // Action failed, stay in same state and record the error
  this.actionError = result.error;
  return this.getState();
}

// Clear error and awaiting state on success
this.actionError = undefined;
this.awaitingInput = false;
```

**Buggy target** (`engine.ts:465-473`):
```typescript
const result = this.game.performAction(actionName, player as any, args);
this.lastActionResult = result;

if (!result.success) {
  // Action failed, stay in same state
  return this.getState();          // BUG: this.actionError never set
}

// Check if this player is done (re-evaluate after action)
const context = this.createContext();
```

**Fix — insert the failure-set and success-clear, mirroring `resume()` exactly**, before the existing `playerState`/`allDone` continuation logic that already follows on success:
```typescript
if (!result.success) {
  this.actionError = result.error;
  return this.getState();
}
this.actionError = undefined;

// Check if this player is done (re-evaluate after action)
const context = this.createContext();
```
Do NOT move `this.awaitingInput = false` here — `resumeSimultaneousAction` has its own `awaitingInput`/`awaitingPlayers` clearing logic further down (only when `allDone`), which is structurally different from `resume()`'s single-player completion and must not be touched.

**Consumer chokepoint (do not modify, just be aware):** `src/runtime/runner.ts:207` reads `flowState.actionError` as the sole success/failure signal; `runner.ts:217` gates `actionHistory.push` on the same check. No other file needs changes for ENG-03.

---

### `src/engine/flow/engine.ts` — ENG-07: `executeSwitch` unmatched-case throw

**Analog — `maxIterations` safety throw in the same file** (`engine.ts:1056-1069`), the precedent this fix must match stylistically (plain `Error`, multi-line descriptive `.join`-free template string, actionable "how to fix" guidance):
```typescript
if (iteration >= maxIterations) {
  throw new Error(
    `Loop ${config.name ? `"${loopName}" ` : ''}hit its maxIterations safety cap ` +
    `(${maxIterations} iterations) without its 'while' condition becoming false.\n\n` +
    ...
    `Fix: Ensure the loop's 'while' condition becomes false before ${maxIterations} ` +
    `iterations${config.name ? `, or raise maxIterations on loop "${loopName}" if the cap is genuinely too low` : ''}.`
  );
}
```
Note `config.name` is used when present — `SwitchConfig` (`src/engine/flow/types.ts:178-185`) has **no `name` field** (confirmed: `on`, `cases`, `default` only, extends `BaseFlowConfig`). So the ENG-07 message cannot include a name segment unless `BaseFlowConfig` itself provides one — check `BaseFlowConfig` before finalizing; if absent, drop the `'phase'`-style token from the locked-decision example and use the generalized form recommended in RESEARCH.md's Open Questions: `` `switchOn got ${JSON.stringify(stringValue)} — no matching case (${availableCases}) and no default` ``.

**Buggy target** (`engine.ts:1437-1445`):
```typescript
const value = config.on(context);
const stringValue = String(value);

const hasCase = Object.prototype.hasOwnProperty.call(config.cases, stringValue);
const branch = hasCase ? config.cases[stringValue] : config.default;
if (!branch) {
  frame.completed = true;              // BUG: silent no-op
  return { continue: true, awaitingInput: false };
}
```

**Fix:**
```typescript
if (!branch) {
  const availableCases = Object.keys(config.cases).join(', ');
  throw new Error(
    `switchOn got ${JSON.stringify(stringValue)} — no matching case (${availableCases}) and no default`
  );
}
```
No try/catch needed inside `executeSwitch` — `resumeSimultaneousAction`'s existing plain `throw new Error(...)` calls (lines 445, 451, 454, 457, unchanged by this phase) are the proof this propagates correctly through `runner.ts`'s existing catch (`runner.ts:196-204`) into `{success:false, errorCode: ENGINE_ERROR}`.

---

### `src/engine/action/action.ts` — ENG-04: choice-branch multiSelect enforcement

**Port source — elements branch, already tested** (`action.ts:802-817`):
```typescript
// Enforce multiSelect min/max bounds on the submitted count.
// multiSelect can be a number (max, with implicit min 1), a { min, max }
// config, or a function returning either. Mirror pick-handler.ts resolution.
const multiSelect = (selection as ElementsSelection).multiSelect;
const multiSelectConfig = typeof multiSelect === 'function' ? multiSelect(context) : multiSelect;
if (multiSelectConfig !== undefined) {
  const min = typeof multiSelectConfig === 'number' ? 1 : (multiSelectConfig.min ?? 1);
  const max = typeof multiSelectConfig === 'number' ? multiSelectConfig : multiSelectConfig.max;
  const count = Array.isArray(value) ? value.length : 1;
  if (count < min) {
    errors.push(`Selection "${selection.name}" requires at least ${min} element${min === 1 ? '' : 's'}, got ${count}`);
  }
  if (max !== undefined && count > max) {
    errors.push(`Selection "${selection.name}" requires at most ${max} element${max === 1 ? '' : 's'}, got ${count}`);
  }
}
```

**Target — choice branch, currently no count check** (`action.ts:706-741`, specifically after the array-item-membership loop at line 725 and before falling to the `else` scalar branch at 726):
```typescript
if (selection.type === 'choice' || selection.type === 'element') {
  const choices = this.getChoices(selection, player, args, actionName);

  if (Array.isArray(value)) {
    for (const v of value) {
      // ... existing per-item membership checks (710-725), unchanged ...
    }
  } else {
    // ... existing scalar disabled/membership checks (726-740), unchanged ...
  }
}
```

**Fix — insert after the `if (Array.isArray(value)) {...} else {...}` block, still inside the `if (selection.type === 'choice' || selection.type === 'element')` guard.** Use `ChoiceSelection` cast (already imported and used elsewhere in this file, e.g. line 362, 1097) instead of `ElementsSelection`. Per the locked decision, non-array values must be REJECTED outright when multiSelect is configured (unlike the elements branch, which degrades a scalar to count=1) — this is new logic, not a straight port:
```typescript
const choiceMultiSelect = (selection as ChoiceSelection).multiSelect;
const choiceMultiSelectConfig = typeof choiceMultiSelect === 'function' ? choiceMultiSelect(context) : choiceMultiSelect;
if (choiceMultiSelectConfig !== undefined) {
  if (!Array.isArray(value)) {
    errors.push(`Selection "${selection.name}" is multiSelect — expected an array, got ${typeof value}: ${JSON.stringify(value)}`);
  } else {
    const min = typeof choiceMultiSelectConfig === 'number' ? 1 : (choiceMultiSelectConfig.min ?? 1);
    const max = typeof choiceMultiSelectConfig === 'number' ? choiceMultiSelectConfig : choiceMultiSelectConfig.max;
    const count = value.length;
    if (count < min) {
      errors.push(`Selection "${selection.name}" requires at least ${min} choice${min === 1 ? '' : 's'}, got ${count}`);
    }
    if (max !== undefined && count > max) {
      errors.push(`Selection "${selection.name}" requires at most ${max} choice${max === 1 ? '' : 's'}, got ${count}`);
    }
  }
}
```
**Dedup option (Claude's Discretion per CONTEXT.md):** extract a shared `enforceMultiSelectCount(value, multiSelectConfig, selectionName, unitLabel, errors)` helper used by both this block and the elements-branch block (802-817) — the two would otherwise differ only in the array-type-rejection branch and the word "element" vs "choice". Low risk; recommended if the planner wants one plan to touch both branches.

`ChoiceSelection.multiSelect` type is already imported/typed identically to `ElementsSelection.multiSelect` (confirmed structurally identical per RESEARCH.md types.ts:212/304) — no type changes needed.

---

### `src/engine/flow/turn-order.ts` (doc-only fix)

**Current stale JSDoc** (module-level, lines 25-27):
```typescript
/**
 * Note: eachPlayer iterates from startingPlayer to the end of the list,
 * it does NOT wrap around. For full round-robin from a specific player,
 * use CONTINUE or manually structure your flow.
 */
```
And at `CONTINUE` (lines 45-49), `START_FROM` (lines 64-65, 68-69), all repeating the "does NOT wrap around" claim that ENG-02 makes false.

**Fix:** Update all three doc blocks (module-level note, `CONTINUE`, `START_FROM`) to state that `eachPlayer`/these presets now wrap around the full player list starting from the given player, and delete the now-inaccurate "manually structure your flow" workaround guidance. `LEFT_OF_DEALER`'s example (lines 111-138) already shows manual wrap-handling via `nextAfter` for the *dealer rotation itself* (a different concern — advancing `dealerPosition` between rounds) — that example is unaffected and should stay, only the "does NOT wrap around" framing needs correcting.

---

### `docs/common-patterns.md` (doc-only fix)

**Current section** (lines 1-64, "Dealer Rotation" pattern) already uses `eachPlayer({ startingPlayer: () => game.playerAfterDealer, ... })` (line 53-56) as the canonical round-play step. With ENG-02 fixed, this example becomes **correct as written** (previously it silently skipped players seated before the dealer). No code sample needs to change — only add/adjust prose if the doc currently claims or implies non-wrap behavior nearby (re-check full file content around any caveat text beyond line 65 during execution; the excerpt read in this pass showed no explicit "does not wrap" caveat within lines 1-65, but the full file should be scanned for one before closing DOCX-04).

---

## Shared Patterns

### Actionable-throw style (ENG-07 uses; ENG-01/ENG-08 established it in Phase 132)
**Source:** `src/engine/flow/engine.ts:1043-1069` (`maxIterations`) and `resumeSimultaneousAction`'s existing throws (`engine.ts:445,451,454,457`)
**Apply to:** `executeSwitch`'s new throw
Convention: plain `new Error(...)`, template string naming the offending value + valid alternatives, no custom error class, no try/catch added at the throw site — let it propagate to `runner.ts`'s existing catch boundary.

### actionError set/clear mirror (ENG-03)
**Source:** `src/engine/flow/engine.ts:277-284` (`resume()`)
**Apply to:** `resumeSimultaneousAction` (`engine.ts:465-473`)
Both halves are required: set on failure (`this.actionError = result.error`) AND clear on success (`this.actionError = undefined`) — a regression test must cover a fail-then-succeed sequence within the same simultaneous step to catch a partial port (see RESEARCH.md Pitfall 2).

### multiSelect count enforcement (ENG-04)
**Source:** `src/engine/action/action.ts:802-817` (elements branch)
**Apply to:** choice branch (`action.ts:706-741`), with the added non-array-rejection requirement described above.

## No Analog Found

None. All four fixes are same-file, same-function or sibling-block edits with a proven in-file precedent; no external analog search was needed or fruitful.

## Test Insertion Points

| Requirement | File | Insertion point | Sibling tests to match style |
|---|---|---|---|
| ENG-02 | `src/engine/flow/engine.test.ts` | inside `describe('EachPlayer Execution', ...)`, line 303 — after the existing `'should iterate through all players'` / `'should filter players'` / `'should iterate backward'` tests (304-356) | Same `defineFlow` + `FlowEngine` + `visitedPlayers` push pattern; add `startingPlayer` config and assert wrapped order, e.g. `[3, 1, 2]` for a 3-player game starting at seat 3 (not `[3]` truncated) |
| ENG-03 | `src/engine/flow/engine.test.ts` | near existing simultaneous-action-step coverage around line 1997 (`'simultaneous-action-step warning also points to the real API'`) | Drive a `simultaneousActionStep`, submit a failing action for one player, assert `state.actionError` is set and `awaitingPlayers` unaffected; then submit a passing action for another player and assert `actionError` clears |
| ENG-04 | `src/engine/action/action.test.ts` | inside `describe('validateSelection', ...)` (line 254), sibling to the F31 `chooseElements` multiSelect tests at lines 2223-2320 (same file, `describe('Element selection API (F23/F28)', ...)` at line 2162) — add analogous `chooseFrom` (choice) tests | Copy the exact shape of `'rejects a submission with too few elements...'` (2234-2245) / `'...too many...'` (2247-2262) / `'enforces bounds for the number multiSelect form'` (2293-2308) / `'enforces bounds for the function multiSelect form'` (2310-2321), swapping `chooseElements` for `chooseFrom` and asserting `'at least N choices'` / `'expected an array'` wording. Also add one non-array-rejection test (e.g. submit `'red'` instead of `['red']` to a `multiSelect: {min:1}` choice) — this case has NO elements-branch equivalent to copy, it is new. |
| ENG-07 | `src/engine/flow/engine.test.ts` | inside `describe('Conditionals', ...)` (line 580), directly after `'should use switch default case'` (633-648) | Mirror `'should handle switch cases'` (615-631) structure — `defineFlow({ root: switchOn({ on: () => 'x', cases: { a: ..., b: ... } }) })` with no `default`, then `expect(() => engine.start()).toThrow(/no matching case/)` |

## Metadata

**Analog search scope:** `src/engine/flow/engine.ts`, `src/engine/flow/turn-order.ts`, `src/engine/action/action.ts`, `src/engine/flow/engine.test.ts`, `src/engine/action/action.test.ts`, `docs/common-patterns.md`, `src/engine/flow/types.ts` (SwitchConfig), `src/runtime/runner.ts` (consumer verification only, not modified)
**Files scanned:** 7
**Pattern extraction date:** 2026-07-03
**Line number caveat:** All ranges cited above were re-read directly from current `main` in this session (post Phase-132) and match RESEARCH.md's claims exactly. If any Phase-133-adjacent work lands on `engine.ts` or `action.ts` before execution, re-verify line numbers per PROC-01.
