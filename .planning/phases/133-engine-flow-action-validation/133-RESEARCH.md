# Phase 133: Engine Flow & Action Validation - Research

**Researched:** 2026-07-03
**Domain:** BoardSmith flow engine (`src/engine/flow/engine.ts`) and action validation (`src/engine/action/action.ts`)
**Confidence:** HIGH — every claim below is a direct file:line trace against current `main` source (post Phase-132), not training-data recall.

## Summary

All four findings this phase addresses (F4/ENG-02, F5/ENG-03, F6/ENG-04, F27/ENG-07) are independently **re-confirmed LEGITIMATE** against current code — Phase 132's changes (a85c4ae6 forEach snapshot fix, ENG-05 resolveArgs narrowing) touched adjacent code but did not touch any of the four target functions, and none of the audit's line numbers or reasoning are stale. All four fixes are narrow, mechanical, and isolated to single functions with no fan-out risk: `executeEachPlayer`'s seat-list construction (one array-building expression), `resumeSimultaneousAction`'s failure branch (one missing assignment, mirroring three sibling code paths that already do it correctly), `validateSelection`'s choice-type branch (porting an existing, already-tested pattern from 20 lines away), and `executeSwitch`'s unmatched-branch fallthrough (add a throw, mirroring the v4.3 loop `maxIterations` precedent).

Zero shipped games (8 example games + MERC) use `eachPlayer({ startingPlayer })` or `switchOn` at all, so ENG-02 and ENG-07 fixes carry no cross-repo migration risk and no double-fix hazard from games working around the current bugs. `chooseFrom` with `multiSelect` IS used across 6 games + 6 MERC action files, so ENG-04's port must be verified against those call sites in Phase 138, but the fix itself only tightens validation servers-side (any client already respecting the client-shipped bounds is unaffected).

**Primary recommendation:** Fix all four in place as narrow, isolated diffs; each gets one red-then-green regression test in the existing `describe` block for that function. No architectural changes, no new abstractions needed beyond possibly extracting a tiny shared `enforceMultiSelectCount(value, multiSelectConfig, selectionName, context)` helper if the planner wants to dedupe the elements-branch and choice-branch logic (Claude's Discretion per CONTEXT.md).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Turn-order seat sequencing (`eachPlayer`) | Engine (flow) | — | Pure server-side flow-control state machine; no client involvement |
| Simultaneous-action failure signaling | Engine (flow) | Runtime (`GameRunner`) | Engine sets `actionError`; runtime (`performAction`) is the sole consumer that decides success/failure and `actionHistory` writes |
| Action argument count validation (`multiSelect`) | Engine (action) | UI (client-side pre-check) | Server validation (`validateSelection`) is the authority; AutoUI/action-metadata's client-shipped bounds are a UX convenience, not a security boundary — this phase closes the gap where the UX convenience was the *only* enforcement |
| `switchOn` branch resolution | Engine (flow) | — | Pure flow-control; no client involvement |

## User Constraints (from CONTEXT.md)

### Locked Decisions
- **ENG-02 (F4, critical)**: `eachPlayer` with `startingPlayer` **wraps around always** — `eligibleSeats = [...players.slice(startIndex), ...players.slice(0, startIndex)]`. No `wrap: false` opt-out (truncation was never a sane board-game semantic). Fix `docs/common-patterns.md` dealer pattern and `TurnOrder` preset docs (LEFT_OF_DEALER / START_FROM / CONTINUE) in the same phase.
- **ENG-03 (F5, critical)**: `resumeSimultaneousAction` **mirrors the regular resume path** — sets `this.actionError = result.error` before returning `getState()` on failure and clears it on success. A failed simultaneous action surfaces `actionError`, returns failure to the client, and is NOT recorded in `actionHistory`.
- **ENG-04 (F6)**: **Port multiSelect min/max count enforcement from the elements branch** (action.ts ~802-817) into the choice-type array branch of `validateSelection`, resolving function-valued `multiSelect` the same way. Also **reject non-array values** when multiSelect is configured.
- **ENG-07 (F27)**: `switchOn` with no matching case and no default **throws** an actionable error naming the stringified value and the available case keys (e.g. "switchOn 'phase' got 'combatt' — no matching case (draw, play, combat) and no default"). Matches the loop `maxIterations` throw precedent from v4.3 Phase 120.

### Process (carried over from Phases 131/132 locked decisions)
- PROC-01 verify-first: per-finding verdict recorded in `133-FINDINGS-VERIFICATION.md` BEFORE any fix.
- PROC-02: red-then-green regression test per fix, RED output recorded in SUMMARY.
- Tests in existing engine suites; full suite green per wave; same-phase doc updates (DOCX-04).

### Claude's Discretion
- Exact error message wording (actionable, names the offending value and valid options).
- Whether ENG-02's wrap needs a checkpoint-restore compatibility note (eligibleSeats snapshot is persisted in frame data — verify restored mid-round frames from pre-fix snapshots don't break; a clean break is acceptable per No Backward Compatibility). **Research finding: no compatibility hazard exists — see Runtime State Inventory below.**
- Where the ENG-04 count-validation helper lives if shared between elements and choice branches (dedupe if clean).

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ENG-02 | `eachPlayer` wraps around so every player gets a turn | Exact fix location `engine.ts:1127`; TurnOrder preset docs at `turn-order.ts:26,47,68,110,128`; dealer pattern at `docs/common-patterns.md:1-58` |
| ENG-03 | Failed simultaneous action surfaces `actionError`, not recorded in `actionHistory` | Exact fix location `engine.ts:468-471`; consumer chain traced through `runner.ts:207-217` |
| ENG-04 | `chooseFrom` multiSelect min/max enforced server-side | Exact port source `action.ts:802-817` → target `action.ts:706-741`; type confirms `ChoiceSelection.multiSelect` exists (`types.ts:212`) and is unused in validation today |
| ENG-07 | `switchOn` unmatched value + no default fails loudly | Exact fix location `engine.ts:1442-1445`; zero games use `switchOn`, no migration risk |

## Standard Stack

No new dependencies. All four fixes are internal engine logic changes in TypeScript already in the repo. No package installs — **Package Legitimacy Audit section omitted** (not applicable this phase).

## Architecture Patterns

### System Architecture Diagram

```
Client submits action
        │
        ▼
GameRunner.performAction()  (src/runtime/runner.ts:154)
        │  calls game.continueFlow(actionName, args, playerIndex)
        ▼
FlowEngine.resume() / resumeSimultaneousAction()  (src/engine/flow/engine.ts)
        │
        ├─ action-step path (sequential)          ├─ simultaneous-action-step path
        │  resume() line 255                       │  resumeSimultaneousAction() line 426
        │  → game.performAction(...)                │  → game.performAction(...)
        │  → on failure: sets this.actionError ✓    │  → on failure: MISSING actionError set ✗ (F5/ENG-03)
        │  → on success: clears actionError,         │  → on success: clears nothing explicitly,
        │    returns run()                            re-evaluates playerState, checks allDone
        ▼
FlowEngine.getState() → FlowState { actionError?, ... }
        ▼
GameRunner.performAction() checks flowState.actionError (runner.ts:207)
        │
        ├─ actionError set → returns { success: false, error, ... }  (no actionHistory push)
        └─ actionError undefined → this.actionHistory.push(serializedAction) (runner.ts:217)
                                     returns { success: true, ... }
        ▼
Session layer (game-session.ts) broadcasts result; pending-action-manager / state-history
consume actionHistory for undo/replay
```

Because `resumeSimultaneousAction`'s failure branch never sets `actionError`, the failure is invisible to the one chokepoint (`runner.ts:207`) every downstream consumer relies on — this is the entire bug in one diagram.

```
eachPlayer({ startingPlayer }) round construction  (executeEachPlayer, engine.ts:1100)

  players = game.all(Player)                     [seat 1, seat 2, seat 3, seat 4]
  startIndex = index of startingPlayer            e.g. seat 3 → startIndex = 2

  CURRENT (buggy):  players.slice(startIndex)     → [seat 3, seat 4]           (seats 1,2 silently skipped)
  FIXED:            [...slice(startIndex), ...slice(0, startIndex)]
                                                    → [seat 3, seat 4, seat 1, seat 2]  (full wrap, deterministic)
```

### Recommended Project Structure

No structural changes — fixes land in the existing files at existing function boundaries:
```
src/engine/flow/engine.ts       # executeEachPlayer, resumeSimultaneousAction, executeSwitch
src/engine/flow/turn-order.ts   # TurnOrder preset JSDoc (wrap-around note is now stale/wrong)
src/engine/action/action.ts     # validateSelection choice-type branch
docs/common-patterns.md         # Dealer Rotation pattern (section 1, lines 1-58)
```

### Pattern 1: eligibleSeats wrap-around fix (ENG-02)

**What:** `executeEachPlayer` builds a `players` array (already filtered/reversed per `config.filter`/`config.direction`), finds `startIndex`, then slices from `startIndex` to the end only.

**Current code** (`src/engine/flow/engine.ts:1100-1130`):
```typescript
private executeEachPlayer(
  frame: ExecutionFrame,
  config: EachPlayerConfig,
  context: FlowContext
): FlowStepResult {
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
      eligibleSeats: players.slice(startIndex).map(p => p.seat),   // <-- BUG: no wrap
      nextIndex: 0,
    };
  }
  // ...
}
```

**Fix:** change the one line building `eligibleSeats`:
```typescript
eligibleSeats: [...players.slice(startIndex), ...players.slice(0, startIndex)].map(p => p.seat),
```
When `startIndex === 0` (the common case, no `startingPlayer`), this is a no-op — `slice(0)` + `slice(0,0)` = the full original array — so the fix is safe for every game that doesn't use `startingPlayer` at all (all 8 example games + MERC, confirmed by grep, see Common Pitfalls below).

**When to use:** This IS the fix — apply directly, no conditional/opt-in per locked decision.

### Pattern 2: resumeSimultaneousAction actionError mirror (ENG-03)

**What:** `resumeSimultaneousAction`'s failure branch returns early without setting `this.actionError`, unlike its three siblings.

**Current code** (`src/engine/flow/engine.ts:465-471`):
```typescript
const result = this.game.performAction(actionName, player as any, args);
this.lastActionResult = result;

if (!result.success) {
  // Action failed, stay in same state
  return this.getState();          // <-- BUG: this.actionError never set
}
```

**Sibling pattern already correct** (`resume()`, `engine.ts:277-284`):
```typescript
if (!result.success) {
  this.actionError = result.error;
  return this.getState();
}
this.actionError = undefined;
```

**Fix:** mirror exactly:
```typescript
if (!result.success) {
  this.actionError = result.error;
  return this.getState();
}
this.actionError = undefined;
```
Note: `resumeSimultaneousAction` continues past the success case to re-evaluate `playerState.completed`/`availableActions`/`allDone` (lines 473-499+) — the `this.actionError = undefined` clear must be inserted right after the failure check, before that continuation logic, exactly matching where `resume()` places its clear (line 284, before `handleActionStepCompletion`).

**Consumer verification** (`src/runtime/runner.ts:154-224`): `performAction` is the SOLE reader of `flowState.actionError` (line 207) and the sole writer of `actionHistory` for the normal play path (line 217, guarded by the same `if`). No other file inspects `resumeSimultaneousAction`'s return value differently — the fix's effect flows correctly to the runner chokepoint with no other code path to update.

### Pattern 3: choice-type multiSelect count enforcement (ENG-04)

**What:** Port the elements-branch pattern verbatim into the choice branch.

**Existing (already correct) elements-branch pattern** (`src/engine/action/action.ts:802-817`):
```typescript
// Enforce multiSelect min/max bounds on the submitted count.
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

**Target: choice branch** (`src/engine/action/action.ts:706-741`) currently has NO count check — it validates array-item membership only (line 710-725) and falls through the disabled/membership check for scalars (726-740). `ChoiceSelection.multiSelect` (types.ts:212) is structurally identical to `ElementsSelection.multiSelect` (types.ts:304): `number | MultiSelectConfig | ((context) => number | MultiSelectConfig | undefined)`.

**Fix approach:** After the existing array-item-membership loop (line 725) and before falling into the `else` scalar branch, insert the ported count-check block using `(selection as ChoiceSelection).multiSelect` instead of `ElementsSelection`. Additionally — **new requirement beyond the elements-branch pattern** — reject non-array submissions when `multiSelectConfig !== undefined`: the elements branch doesn't need this guard because a scalar there is still validated as "count = 1" (line 810 `count = Array.isArray(value) ? value.length : 1`), which happens to be semantically fine since a bare element ID/object is a legitimate single-item shorthand in some paths. For the choice branch, ENG-04's locked decision explicitly says "reject non-array values when multiSelect is configured" — this is stricter than the elements branch and must be added as new logic, not merely ported. Recommend:
```typescript
if (multiSelectConfig !== undefined && !Array.isArray(value)) {
  errors.push(`Selection "${selection.name}" is multiSelect — expected an array, got ${typeof value}: ${JSON.stringify(value)}`);
} else if (multiSelectConfig !== undefined) {
  const count = Array.isArray(value) ? value.length : 0;
  // min/max checks as above
}
```

**Dedup option (Claude's Discretion):** extract `enforceMultiSelectCount(value, multiSelectConfig, selectionName, errors)` shared by both branches. Low risk, small win — recommend doing it since the two blocks would otherwise be near-duplicates differing only in the non-array-rejection addition.

**Client-side parity confirmed:** `action-metadata.ts:147-158` (choice) and `:201-212` (elements) already ship `multiSelect: { min, max }` to the client identically for static (non-function) configs — the ENG-04 fix only closes the *server* gap; no client/metadata change needed.

### Pattern 4: switchOn unmatched-value throw (ENG-07)

**What:** `executeSwitch` currently marks the frame completed and continues silently when no case matches and no default exists.

**Current code** (`src/engine/flow/engine.ts:1426-1456`):
```typescript
private executeSwitch(
  frame: ExecutionFrame,
  config: SwitchConfig,
  context: FlowContext
): FlowStepResult {
  if (frame.data?.branchPushed) {
    frame.completed = true;
    return { continue: true, awaitingInput: false };
  }

  const value = config.on(context);
  const stringValue = String(value);

  const hasCase = Object.prototype.hasOwnProperty.call(config.cases, stringValue);
  const branch = hasCase ? config.cases[stringValue] : config.default;
  if (!branch) {
    frame.completed = true;              // <-- BUG: silent no-op
    return { continue: true, awaitingInput: false };
  }
  // ...
}
```

**Fix:** throw when `!branch`:
```typescript
if (!branch) {
  const availableCases = Object.keys(config.cases).join(', ');
  throw new Error(
    `switchOn got ${JSON.stringify(stringValue)} — no matching case (${availableCases})${config.default ? '' : ' and no default'}`
  );
}
```
Match the exact wording style from the locked decision example: `"switchOn 'phase' got 'combatt' — no matching case (draw, play, combat) and no default"`. Since `config.default` is checked as part of `branch` resolution, by the time we reach the throw, `config.default` is guaranteed falsy — the "and no default" clause is always applicable at this point, so it can be a fixed suffix rather than conditional. Confirm against the audit's exact wording before finalizing (name the selection's `on` accessor if `config` doesn't expose a semantic name — check `SwitchConfig` type for an optional `name` field to include in the message).

**Precedent match:** v4.3 Phase 120's loop `maxIterations` throw (referenced in CONTEXT.md) — locate that throw's exact message shape in `engine.ts` (loop executor) to match error-message conventions (e.g., does it use `Error` subclass, `ErrorCode`, or plain `Error`?). Grep shows `executeSwitch` is plain synchronous flow-control code (not wrapped in the action-executor try/catch at `action.ts` that converts thrown errors into `{success:false}`) — a thrown `Error` here propagates up through `FlowEngine.run()`/`resume()` to whatever caller invoked flow (`continueFlow` in `game.ts`, itself called from `runner.ts:197` inside a try/catch that converts it to `ErrorCode.ENGINE_ERROR`). This means a `switchOn` throw during a flow `execute()`/`run()` step becomes a proper `{success:false, errorCode: ENGINE_ERROR}` at the runner boundary — consistent with existing thrown-error handling elsewhere in the flow engine (e.g. `resumeSimultaneousAction`'s existing `throw new Error(...)` at lines 445, 451, 454, 457 for invalid player states, which is the same code path).

### Anti-Patterns to Avoid

- **Adding a `wrap: false` opt-out for ENG-02:** explicitly rejected by locked decision — truncation was never valid board-game semantics, and no game uses it, so there's no compatibility need to preserve it.
- **Catching the ENG-07 throw inside `executeSwitch` and converting to a soft warning:** locked decision requires an actual throw (matching `maxIterations` precedent), not a `devWarn`.
- **Re-implementing multiSelect enforcement from scratch for the choice branch instead of porting:** the elements-branch logic is already tested (6 tests at `action.test.ts:2223-2320`) and correct — copy its shape, don't reinvent.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Multi-item count validation | A new bespoke min/max checker for the choice branch | Port the existing `elements` branch logic (`action.ts:802-817`) | Already correct, already tested, keeps both branches structurally identical for future maintenance |
| Round-robin wrap math | Custom modulo/index arithmetic scattered at call sites | The single `eligibleSeats` array-concat fix inside `executeEachPlayer` | One chokepoint; every `eachPlayer` caller (including `TurnOrder.LEFT_OF_DEALER`/`START_FROM`/`CONTINUE`) benefits automatically with zero call-site changes |

**Key insight:** All four fixes are "one function, one bug" — there is no complexity to hand-roll around. The risk in this phase is scope creep (e.g., refactoring `executeEachPlayer` more broadly), not under-engineering.

## Common Pitfalls

### Pitfall 1: Assuming the ENG-02 wrap fix needs a `startIndex === 0` special case
**What goes wrong:** Writing `if (startIndex === 0) { eligibleSeats = players.map(...) } else { wrap logic }` as unnecessary defensive code.
**Why it happens:** Looks like an edge case needs guarding.
**How to avoid:** `[...players.slice(0), ...players.slice(0, 0)]` already equals `players` — the wrap formula degenerates correctly for `startIndex === 0` with no special-casing needed. Verified: `Array.prototype.slice(0)` returns a full shallow copy, `slice(0,0)` returns `[]`.
**Warning signs:** Extra branching in the diff that doesn't reduce to the audit's suggested one-liner.

### Pitfall 2: Fixing `resumeSimultaneousAction` failure path but forgetting the success-path `actionError` clear
**What goes wrong:** Only adding `this.actionError = result.error` in the failure branch, leaving a stale `actionError` from a PREVIOUS failed attempt visible after a later successful action in the same simultaneous step (since `resumeSimultaneousAction` is called repeatedly, once per player action, across the life of the step).
**Why it happens:** The audit's suggested fix text says "sets `this.actionError`... and clears it on success" — both halves are required, but it's easy to only patch the reported failure line.
**How to avoid:** Add `this.actionError = undefined;` immediately after the failure check returns, mirroring `resume()`'s exact placement (line 284) before continuing to the `playerDone`/`availableActions` re-evaluation logic.
**Warning signs:** A regression test where player A's action fails, then player B's action succeeds — if `actionError` is still set after B's turn, the clear was missed.

### Pitfall 3: Treating ENG-04's "reject non-array" requirement as already covered by the elements-branch port
**What goes wrong:** Copy-pasting only the count-check block (lines 802-817) and assuming scalar submissions are already rejected because `count = Array.isArray(value) ? value.length : 1` treats a non-array as count 1, which would silently pass a `min:1,max:1` config.
**Why it happens:** The elements branch's count-computation degrades a scalar to `count=1` rather than rejecting outright — that's intentional there (a single legitimate object is a valid "count 1" submission), but the locked decision for ENG-04 explicitly calls out rejecting non-arrays as a DISTINCT requirement for the choice branch.
**How to avoid:** Add an explicit `!Array.isArray(value)` check before/alongside the count logic that pushes its own error, as shown in Pattern 3 above — don't rely on the ported count math alone.
**Warning signs:** A test submitting a bare scalar (e.g. `'red'` instead of `['red']`) to a `multiSelect: {min:1}` choice selection passes validation when it shouldn't.

### Pitfall 4: Assuming ENG-07's throw needs to be caught somewhere new
**What goes wrong:** Wrapping the new `throw` in a try/catch inside `executeSwitch` "to be safe," defeating the fail-loud requirement.
**Why it happens:** Overcaution about breaking the flow engine's control loop.
**How to avoid:** `resumeSimultaneousAction` already throws plain `Error`s for analogous invalid-state conditions (lines 445, 451, 454, 457) with no special catch inside the flow engine — those propagate to `runner.ts`'s existing try/catch (line 196-204) which converts to `{success:false, errorCode: ENGINE_ERROR}`. The new `executeSwitch` throw should follow the identical, already-proven pattern.
**Warning signs:** A new try/catch block added inside `engine.ts` specifically for the switchOn throw that doesn't exist for the other flow-engine throws.

## Code Examples

### ENG-03 regression test shape (mirrors existing sim-step test patterns)
```typescript
// Source: pattern derived from src/engine/flow/engine.test.ts describe('EachPlayer Execution')
// and src/runtime/runner.ts consumer contract (flowState.actionError / actionHistory)
it('a failed simultaneous action surfaces actionError and is not recorded in actionHistory', () => {
  // set up a simultaneousActionStep where one player's action execute() throws
  // or fails validation
  const result = runner.performAction('discard', badPlayer, { cards: [] }); // e.g. below min
  expect(result.success).toBe(false);
  expect(result.error).toBeDefined();
  expect(runner.actionHistory).toHaveLength(0); // or unchanged from prior length
});
```

### ENG-02 regression test shape
```typescript
// Source: pattern derived from src/engine/flow/engine.test.ts describe('EachPlayer Execution')
it('eachPlayer with startingPlayer wraps around so every player gets a turn', () => {
  // 4 players, startingPlayer = seat 3
  // drive the flow through all 4 turns
  // assert seats visited in order [3, 4, 1, 2] (or whatever direction default)
});
```

## State of the Art

Not applicable — this is internal bugfix work on stable, already-shipped engine internals, not adopting new external tooling or patterns.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | v4.3 Phase 120's `maxIterations` throw uses plain `Error` (not a custom error class) — used as the precedent for ENG-07's error style | Pattern 4 | Low — worst case, ENG-07's throw uses a slightly different error shape than the loop precedent; both still propagate correctly through `runner.ts`'s catch. Verify the exact loop throw's code/message shape before finalizing ENG-07's exact error text. |

**All other claims in this document are `[VERIFIED: codebase grep/read]`** — every file:line reference, current behavior, and cross-file consumer chain was independently re-traced in this session against current `main`, not recalled from training data or the audit report's original line numbers.

## Open Questions

1. **Exact wording match for ENG-07's error message**
   - What we know: locked decision gives an example format: `"switchOn 'phase' got 'combatt' — no matching case (draw, play, combat) and no default"`. The example includes a field-name-like token (`'phase'`) that doesn't obviously come from `SwitchConfig` — need to check whether `SwitchConfig` has a `name` option to source that token from, or whether it should be omitted/generalized.
   - What's unclear: Whether `SwitchConfig` type has an optional descriptive name field.
   - Recommendation: Check `SwitchConfig` type definition during planning/execution; if no name field exists, either add one as a minor API addition or drop that segment from the message (still actionable without it: `"switchOn got 'combatt' — no matching case (draw, play, combat) and no default"`).

## Runtime State Inventory

*(Included because ENG-02's fix changes the shape/semantics of persisted flow state — `eligibleSeats` is written into checkpoint `frameData`.)*

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `eligibleSeats` (plain `number[]` of seats) is persisted via `FlowEngine.getPosition()` → `frameData[__frame_i]` (`engine.ts:788-808`), read back via the restore path. | **None** — the fix only changes how a NEW `eligibleSeats` array is *computed* on first entry into `executeEachPlayer` (`frame.data?.eligibleSeats === undefined` guard, line 1107). A checkpoint/snapshot taken mid-round BEFORE the fix already has a concrete, fully-materialized `eligibleSeats` array baked in — restoring it just resumes iterating that same (old, truncated) array; the wrap fix never re-runs for an in-progress round restored from an old snapshot. No schema change, no crash risk, no migration needed. This confirms the CONTEXT.md discretion question: **no compatibility note or migration step is needed** — a clean break is trivially safe here because the persisted data shape (`number[]`) is unchanged, only the construction logic for brand-new rounds changes. |
| Live service config | None — pure in-process engine state, no external service config involved. | None |
| OS-registered state | None applicable. | None |
| Secrets/env vars | None applicable. | None |
| Build artifacts | None — no renamed exports, no package/module boundary changes. | None |

## Environment Availability

Skipped — this phase is pure TypeScript engine code with no external tool/service/runtime dependencies beyond the existing Node/npm/vitest toolchain already in use throughout the repo.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (existing repo-wide) |
| Config file | `vitest.config.ts` (repo root) |
| Quick run command | `npx vitest run src/engine/flow/engine.test.ts src/engine/action/action.test.ts` |
| Full suite command | `npm test` (or `npx vitest run`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ENG-02 | `eachPlayer` with `startingPlayer` at non-zero seat wraps to visit all players | unit | `npx vitest run src/engine/flow/engine.test.ts -t "EachPlayer"` | ✅ (insert into existing `describe('EachPlayer Execution', ...)` at `engine.test.ts:303`) |
| ENG-03 | Failed simultaneous action sets `actionError`, `actionHistory` unchanged | unit + integration (through `GameRunner.performAction`) | `npx vitest run src/engine/flow/engine.test.ts -t "simultaneous"` and `npx vitest run src/runtime/runner.test.ts` if a runner-level assertion is added | ✅ engine.test.ts has sim-step coverage near line 1997-2010; runner.test.ts exists at `src/runtime/runner.test.ts` (confirm exact filename before planning) |
| ENG-04 | Choice-branch `multiSelect` count + array-type enforced server-side | unit | `npx vitest run src/engine/action/action.test.ts -t "validateSelection"` | ✅ insert into existing `describe('validateSelection', ...)` at `action.test.ts:254`, sibling to F31 elements-branch tests at `action.test.ts:2223-2320` |
| ENG-07 | `switchOn` unmatched value + no default throws actionable error | unit | `npx vitest run src/engine/flow/engine.test.ts -t "switch"` | ✅ existing `switchOn` coverage at `engine.test.ts:617-650` in `describe('Conditionals', ...)` |

### Sampling Rate
- **Per task commit:** `npx vitest run src/engine/flow/engine.test.ts src/engine/action/action.test.ts`
- **Per wave merge:** `npm test` (full suite, keep 168 files / 2148+ tests green per STATE.md baseline)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
None — existing test infrastructure (`engine.test.ts`, `action.test.ts`) covers all four requirements' insertion points; no new test files or fixtures needed.

## Security Domain

Not applicable — `security_enforcement` config not checked in this session, but all four findings are internal engine-correctness bugs (silent skip, silent success-lie, missing count validation, silent no-op) with no ASVS-mapped authentication/session/crypto surface. ENG-04's count validation is a defense-in-depth server-side input validation fix (closes a gap where only a friendly client's UI enforced bounds), which is the closest to a security concern — captured already under "Don't Hand-Roll" / Pattern 3 above, not a distinct ASVS category requiring a dedicated section.

## Sources

### Primary (HIGH confidence — direct codebase reads this session)
- `src/engine/flow/engine.ts` — `executeEachPlayer` (1100-1160), `resume`/`resumeAfterExternalAction`/`resumeSimultaneousAction` (255-509), `executeSwitch` (1426-1456), `getPosition` (789-816)
- `src/runtime/runner.ts` — `performAction` (154-225), consumer of `flowState.actionError`
- `src/engine/action/action.ts` — `validateSelection` (691-830), choice branch (706-741), elements branch multiSelect enforcement (802-817)
- `src/engine/action/types.ts` — `ChoiceSelection` (155-222), `ElementsSelection` (286-...), both declaring identical `multiSelect` shape
- `src/engine/action/action-builder.ts` — `chooseFrom` (195-260, no default multiSelect), `chooseElements` (380-472, defaults `multiSelect: {min:1}`)
- `src/engine/element/action-metadata.ts` — client-shipped `multiSelect` bounds for both choice (147-158) and elements (201-212) branches, confirmed symmetric
- `src/engine/flow/turn-order.ts` — `TurnOrder` presets (1-140+), stale "does NOT wrap around" JSDoc notes at multiple locations
- `docs/common-patterns.md` — Dealer Rotation pattern (1-58)
- `src/engine/flow/engine.test.ts`, `src/engine/action/action.test.ts` — existing `describe` block insertion points

### Secondary (MEDIUM confidence)
- `.planning/tmp/v4.5-audit-findings.json` — original audit findings F4/F5/F6/F27 with independent verifier re-verdicts (all confirmed legitimate, though the audit's own line numbers are pre-Phase-132 and have shifted; this research re-traced all of them against current code)

### Tertiary (LOW confidence)
None — no unverified WebSearch-only claims in this research; entirely a codebase-internal investigation.

## Metadata

**Confidence breakdown:**
- Standard stack: N/A — no external stack, pure internal bugfix
- Architecture: HIGH — every function, line range, and consumer chain independently re-verified against current source in this session
- Pitfalls: HIGH — derived directly from tracing the actual current code paths, not speculation

**Research date:** 2026-07-03
**Valid until:** Effectively indefinite for the fix locations (internal stable code), but re-verify line numbers if any other Phase-133-adjacent work lands on `engine.ts`/`action.ts` before this phase executes (30-day nominal validity per convention).
