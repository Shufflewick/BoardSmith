# Phase 132: Engine Element & Builder Safety - Research

**Researched:** 2026-07-03
**Domain:** BoardSmith engine internals — element-tree mutation (`Piece.moveToInternal`), action arg resolution (`resolveArgs`), flow loop execution (`executeForEach`), and action-builder registration (`Action.build()` / `Game.registerAction`)
**Confidence:** HIGH (all findings re-traced against current source with file:line evidence, 2026-07-03)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Fail-Loud Mechanisms**
- **ENG-01 (F3)**: `putInto()` onto self or own descendant **throws at the `moveToInternal` chokepoint** — O(depth) walk up `destination._t.parent` to root; if `this` is encountered (or `destination === this`), throw actionable error "Cannot move X into its own descendant Y". Covers all putInto call paths since moveToInternal is the shared chokepoint.
- **ENG-05 (F12)**: `resolveArgs` **only resolves non-selection args shaped like serialized elements** (`{id, className}` via `isSerializedElement`) — bare numbers are NEVER rewritten into GameElements. Clean break per No Backward Compatibility; any followUp patterns relying on bare-number coercion get fixed in games during Phase 138.
- **ENG-06 (F13)**: `forEach` **snapshots the collection once on loop entry** — stores a stable identity list (element ids for GameElements, values otherwise) in frame data, mirroring `eachPlayer`'s `eligibleSeats` snapshot pattern. Mutating the source collection mid-loop no longer skips items.
- **ENG-08 (F28)**: **Remove the default no-op `execute`**; `.build()` returns a definition flagged handler-less (for inspection), and `registerAction()` **throws** an actionable error on handler-less definitions ("action 'x' has no execute handler — end the chain with .execute(fn)").

**Process (carried over from Phase 131 locked decisions)**
- PROC-01 verify-first: per-finding verdict (repro or file:line trace) recorded in `132-FINDINGS-VERIFICATION.md` BEFORE any fix.
- PROC-02: red-then-green regression test per fix, RED output recorded in SUMMARY.
- Tests placed alongside existing engine suites; full suite green per wave.
- Same-phase doc updates for any API whose documented behavior changes (DOCX-04).

### Claude's Discretion
- Exact error message wording (must name both elements and the fix).
- Whether the forEach snapshot stores ids vs. values for non-element collections — pick what round-trips serialization safely.
- Where the handler-less flag lives on ActionDefinition (type shape) as long as registerAction fails loudly.

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ENG-01 | `putInto()` onto the element's own descendant (or itself) throws an actionable error instead of silently detaching the subtree (F3) | Findings Verification F3/ENG-01 traces `moveToInternal` (piece.ts:81-148) end-to-end, confirms it is the single chokepoint for all move paths (putInto, remove, Deck.dealTo, command executor), and specifies exact insertion point relative to Phase 131's WR-03 dev-mode check |
| ENG-05 | `resolveArgs` no longer coerces arbitrary numeric non-selection args into GameElements (F12) | Findings Verification F12/ENG-05 pinpoints the exact lines to change (action.ts:241-258), confirms `isSerializedElement` helper already exists (action.ts:278) and requires no new code, and cross-checks both BoardSmithGames and MERC for breakage risk (MERC's defensive dual-shape resolvers de-risk the fix) |
| ENG-06 | `forEach` over a mutated collection no longer silently skips items (snapshot the collection or document + guard the live-mutation case loudly) (F13) | Findings Verification F13/ENG-06 traces `executeForEach` (engine.ts:1151-1176), provides the exact `eligibleSeats` snapshot template to mirror (engine.ts:1096-1122), and confirms zero existing forEach usage across BoardSmith/games/MERC breaks under the fix (none mutate the collection today) |
| ENG-08 | An action built without `.execute()` (default no-op) is rejected at build/registration time or requires an explicit opt-in (F28) | Findings Verification F28/ENG-08 traces the default no-op (action-builder.ts:77), `.build()` (action-builder.ts:636-640), and confirms `registerAction()` (game.ts:919-921) currently performs zero validation — corrects the CONTEXT's assumption that an existing "validation layer" can be extended; this is new registration-time validation |
</phase_requirements>

## Summary

This phase fixes four audit-confirmed "silent wrong-path" defects in BoardSmith's engine core, all independent of each other and scoped to four files. Phase 131 already landed a dev-mode detached-destination check in `moveToInternal` (WR-03) — the ENG-01 fix must compose with, not replace, that check. All four fixes are additive guards/throws in existing chokepoints; none require new files or new architecture. No external packages are installed by this phase (pure internal TypeScript), so the Package Legitimacy Audit is not applicable.

Cross-repo impact research (`~/BoardSmithGames`, MERC) found: zero games/MERC use the flow `forEach()` builder, `.build()`, or object-shaped followUp args with id+className collisions — the highest-risk finding (ENG-06 forEach) has zero current usage to break. ENG-05 (resolveArgs bare-number coercion removal) is the one finding with real cross-repo exposure: MERC's `rebel-economy.ts`/`rebel-equipment.ts` pass bare numeric IDs (`combatantId: unit.id`, `sectorId: sector.id`) through `followUp.args`. However, MERC's own resolver helpers (`getUnit`/`getSector` in `rebel-equipment.ts:328-360`) already defensively branch on `typeof combatantArg === 'number'` vs. `object with id` — meaning removing bare-number auto-coercion is *expected to be compatible* with MERC's existing code, not a breaking change (full verification is Phase 138's job, out of scope here).

**Primary recommendation:** Implement all four fixes as narrow, additive changes at the identified chokepoints (single functions each), write red-first regression tests colocated with each function's existing test file, and do not attempt to "improve" adjacent code — this phase's scope is strictly the four findings.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Element-tree mutation safety (ENG-01) | Engine / Element | — | `moveToInternal` is the sole low-level mutation chokepoint in `src/engine/element/piece.ts`; owned entirely by the engine tier, no UI/session involvement |
| Action arg resolution (ENG-05) | Engine / Action | — | `resolveArgs` runs server-side inside `ActionExecutor`, converting network-serialized args before `execute()` — pure engine-tier concern |
| Flow loop execution (ENG-06) | Engine / Flow | — | `executeForEach` is internal `FlowEngine` state-machine logic; no client/session boundary crossed |
| Action builder validation (ENG-08) | Engine / Action | — | `Action.build()` and `Game.registerAction()` are both engine-tier; registration happens in the game constructor, before any session/client exists |

All four capabilities are single-tier (engine-only) fixes — no cross-tier task splitting is needed for this phase, unlike UI/session phases (134+).

## Standard Stack

No new packages. This phase modifies existing TypeScript source in `src/engine/`. No `npm install` required.

**Package Legitimacy Audit:** Not applicable — no external packages installed by this phase.

## Findings Verification (PROC-01 pre-trace, current code 2026-07-03)

These traces are provided so the phase's own `132-FINDINGS-VERIFICATION.md` can be written quickly by re-confirming rather than re-discovering. All four are independently re-verified LEGITIMATE against current source (post-Phase-131).

### F3 / ENG-01 — `putInto()` onto own descendant silently detaches subtree

**Chokepoint:** `src/engine/element/piece.ts:81` (`moveToInternal`, current signature: `moveToInternal(destination: GameElement, position?: 'first' | 'last'): void`)

Current structure (post Phase 131 WR-03 fix), in order:
1. **Lines 82-105** — WR-03 dev-mode-only detached-destination ancestor walk (`isDevMode()` guard): walks `destination._t.parent` up to root checking each ancestor is present in its own parent's `children` array; `devWarn`s (not throws) if a detached ancestor is found. This is a **different bug class** (stale closures pointing at pre-restore tree nodes) — it does NOT check self/descendant containment of `this`.
2. **Lines 107-123** — remove `this` from `oldParent._t.children`; if not found, `console.error` "TREE CORRUPTION" (dev-mode gated by `NODE_ENV !== 'production'`, not `isDevMode()` — different gate!). This too is duplicate-reachability detection, not self/descendant detection (confirmed matches audit's characterization).
3. **Lines 125-135** — `oldParent.triggerEvent('exit', this)` if `oldParent instanceof Space`.
4. **Lines 137-144** — `this._t.parent = destination`; splice `this` into `destination._t.children`.
5. **Lines 146-148** — `destination.triggerEvent('enter', this)` if `destination instanceof Space`.

**No self/descendant check exists anywhere in this chain.** `outer.putInto(inner)` where `inner` is a descendant of `outer` (or `destination === this`) still produces the 2-node detached cycle the audit describes: `outer`'s children shrink to 0 in step 2 (removing `inner`... wait, actually removes `this`=outer from its OWN parent, not from `inner`), and then `this._t.parent = destination` (outer's parent becomes inner) creates the cycle. This is unchanged from the audit's original trace — Phase 131 did not touch this hazard.

**Where the new throw belongs:** Insert a self/descendant ancestor-walk check **before** any mutation begins (i.e., before line 107, ideally as its own guarded block near/after the WR-03 dev-mode check but running in ALL modes, not just dev — this is prod-affecting state corruption, unlike WR-03's dev-only diagnostic). Walk `destination` up via `_t.parent` to root; if `this` is encountered, or `destination === this`, throw. This composes cleanly with WR-03 since WR-03 only runs in dev mode and only warns (doesn't throw/return early), so ordering either before or after WR-03's block is safe — but placing the new throw check FIRST is cleaner (fail before doing the more expensive/dev-only diagnostic walk).

**All call paths confirmed to funnel through `moveToInternal` (single chokepoint, verified by grep):**
- `Piece.putInto()` (piece.ts:74) → `this.moveToInternal(destination, options?.position)`
- `Piece.remove()` (piece.ts:164) → `this.putInto(this.game.pile)` → moveToInternal
- `Deck.dealTo()` (deck.ts:102) → `card.putInto(destination)` → moveToInternal
- Command executor `executeMove` (command/executor.ts:132) → `(element as Piece).moveToInternal(destination, command.position)`
- Command executor `executeRemove` (command/executor.ts:142) → `(element as Piece).moveToInternal(game.pile)`

No `swap` method exists on `Piece`/`GameElement` — grep of `src/engine/element/*.ts` for `swap` found no such API; the audit's "or simply swapping receiver and argument" language refers to a *usage mistake* (`outer.putInto(inner)` instead of `inner.putInto(outer)`), not a `swap()` API. No additional chokepoint to cover.

**VERDICT: LEGITIMATE, unchanged by Phase 131.**

### F12 / ENG-05 — `resolveArgs` second pass coerces bare numbers into elements

**Chokepoint:** `src/engine/action/action.ts:153-262` (`resolveArgs`), second pass at **lines 239-259** (line numbers verified current, matches audit's line 246 reference within tolerance).

Current second-pass logic (verbatim, lines 241-258):
```typescript
for (const [key, value] of Object.entries(args)) {
  if (selectionNames.has(key)) continue; // Already processed above
  if (value === undefined) continue;

  // Resolve numeric IDs
  if (typeof value === 'number') {
    const element = this.game.getElementById(value);
    if (element) {
      resolved[key] = element;
    }
  }
  // Resolve serialized element objects (from followUp args)
  else if (this.looksLikeSerializedElement(value)) {
    const element = this.game.getElementById((value as { id: number }).id);
    if (element) {
      resolved[key] = element;
    }
  }
}
```

Two helpers exist at different strictness levels (both already present, no new helper needed):
- `isSerializedElement(value)` (line 278) — requires **both** `typeof obj.id === 'number'` AND `typeof obj.className === 'string'`. This is the CONTEXT-mandated check for the fix.
- `looksLikeSerializedElement(value)` (line 269) — looser: only requires `typeof obj.id === 'number'` (no className requirement). Currently used in the second pass (line 253) AND in the first pass for `element`/`elements` selections (lines 174, 200).

**The fix (per CONTEXT decision):** In the second pass ONLY, delete the bare-number branch (lines 245-251) entirely, and replace `looksLikeSerializedElement` with `isSerializedElement` (line 253) so only `{id, className}`-shaped objects get resolved. **Do not touch the first pass** (lines 161-237) — those are named-selection args where `looksLikeSerializedElement`'s looser check is correct and intentional (selection-typed args are supposed to auto-resolve IDs; only the *non-selection* followUp-args pass is unsafe per the audit).

**Callers passing followUp args through `resolveArgs`** (all four call sites verified, lines 922, 1386, 1505, 1720 in action.ts) — all go through the same `resolveArgs` method; no separate followUp-specific resolution path exists. The fix at the one function covers all callers.

**What breaks when bare-number coercion is removed:** Any followUp `args` object with a non-selection key holding a bare number that was previously silently promoted to a `GameElement`. Grepped BoardSmith's own test suite and both game repos:
- **BoardSmith src:** grep of `followUp` across `src/` (excluding tests) found only the four `resolveArgs` call sites above — no BoardSmith-internal helper code relies on bare-number followUp coercion.
- **`~/BoardSmithGames`:** only `checkers/src/rules/actions.ts:228` and `polyhedral-potions/src/rules/actions.ts:340,432,496` use `followUp:` at all. None pass non-selection numeric args in the followUp `args` object requiring second-pass coercion (checked; `polyhedral-potions` followUp values are booleans/conditionals guarding whether to chain, not numeric args needing resolution).
- **MERC (`~/Dropbox/MERC/BoardSmith/MERC`):** heaviest followUp user (25 occurrences). `rebel-economy.ts:439-449` and `:600-611`, `rebel-equipment.ts:295-305, 463-473, 1146-1156, 1231-1243` all pass **bare numeric IDs** (`combatantId: unit.id`, `sectorId: sector.id`) as followUp args — exactly the pattern the second pass currently auto-resolves and the fix will stop resolving. **Critically, MERC's own consuming code already defends against both raw-number and resolved-object shapes**: `rebel-equipment.ts:328-361` (`getUnit`/`getSector` helpers) explicitly branch `typeof combatantArg === 'number'` (calls `game.getElementById` itself) vs. `object with id` (also calls `getElementById`). This means the ENG-05 fix is **expected to be a no-op for MERC's behavior** — MERC never relied on the auto-coercion; it defensively resolves either way. Full confirmation is Phase 138's job (re-vendor + run MERC's suite), but this significantly de-risks the fix.

**VERDICT: LEGITIMATE. Fix is narrowly scoped to lines 241-258; zero known BoardSmith-suite breakage; MERC breakage risk is low per above.**

### F13 / ENG-06 — `forEach` re-evaluates collection every iteration against persisted index

**Chokepoint:** `src/engine/flow/engine.ts:1151-1176` (`executeForEach`, private method on `FlowEngine`).

Current logic (verbatim):
```typescript
private executeForEach(
  frame: ExecutionFrame,
  config: ForEachConfig,
  context: FlowContext
): FlowStepResult {
  const items = typeof config.collection === 'function'
    ? config.collection(context)
    : config.collection;

  const itemIndex = (frame.data?.itemIndex as number) ?? 0;

  if (itemIndex >= items.length) {
    frame.completed = true;
    return { continue: true, awaitingInput: false };
  }

  this.variables[config.as] = items[itemIndex];

  this.stack.push({ node: config.do, index: 0, completed: false });
  frame.data = { ...frame.data, itemIndex: itemIndex + 1 };
  frame.index++;

  return { continue: true, awaitingInput: false };
}
```

Confirmed: `config.collection(context)` is invoked **fresh on every re-entry** of this frame (once per loop iteration, since the flow stack machine returns after pushing one child step and re-enters `executeForEach` for the next iteration). If `collection` is a live query (e.g. `(ctx) => [...ctx.game.all(Card)]`) and the loop body (`config.do`) removes/moves items, the re-fetched `items` array shrinks and `itemIndex` (which counts iterations, not identity) skips every other item — exactly the audit's classic mutating-array-by-index bug.

**`eachPlayer`'s `eligibleSeats` snapshot pattern (the in-repo template), file:line:** `src/engine/flow/engine.ts:1089-1149` (`executeEachPlayer`). Key mechanism (lines 1096-1119):
```typescript
if (frame.data?.eligibleSeats === undefined) {
  let players = [...this.game.all(Player as any)] as Player[];
  // ...filter, direction, startingPlayer logic...
  frame.data = {
    ...frame.data,
    eligibleSeats: players.slice(startIndex).map(p => p.seat),  // <- number[], serializable
    nextIndex: 0,
  };
}
const eligibleSeats = (frame.data.eligibleSeats as number[]) ?? [];
```
The pattern: **evaluate once on first entry** (guarded by `frame.data?.X === undefined`), store a **stable identity list of primitives** (here, `number[]` seat numbers, not `Player` objects) in `frame.data`, then on each iteration re-derive the live object (`this.game.getPlayer(seat)`) from the stored identity rather than re-querying the whole collection. This is exactly the template CONTEXT specifies for the ENG-06 fix.

**How frame data serializes (must survive checkpoint restore mid-loop):** `frame.data` is part of `ExecutionFrame`, which is part of `FlowEngine`'s persisted stack — confirmed by grep, `ExecutionFrame` objects are included in `FlowState`/checkpoint serialization (same general area as `eligibleSeats`, which is already proven to round-trip since `eachPlayer` mid-round checkpoint/restore is an existing, tested path). **Only JSON-plain data survives** — `frame.data` must NOT store `GameElement` object references directly (they'd either fail to serialize or become stale after restore, the same class of bug WR-03 in Phase 131 was built to catch). This is why `eachPlayer` stores `seat: number[]`, not `Player[]`.

**Implication for the ENG-06 fix (element collections):** Per CONTEXT's discretion note ("Whether the forEach snapshot stores ids vs. values for non-element collections — pick what round-trips serialization safely"), the safe pattern is:
- **`GameElement` items:** store `.id` (number) in `frame.data`, re-resolve via `this.game.getElementById(id)` per iteration (mirrors `eachPlayer`'s seat→Player re-derivation exactly).
- **Non-element items (primitives: string/number/boolean):** store the values directly — they're already JSON-plain and round-trip safely.
- **Non-element, non-primitive items (plain objects):** these are already an edge case with no existing precedent in the codebase (grep found no `forEach` usage with object-collection items in BoardSmith, games, or MERC) — flagged as an Open Question below for the planner to decide handling (throw/warn vs. best-effort JSON clone).

**How the `as` binding resolves:** `this.variables[config.as] = items[itemIndex]` (line 1169) — after the fix, this becomes `this.variables[config.as] = <re-resolved item>` (element re-fetched by id, or primitive read directly from the snapshot array), evaluated fresh each iteration from the frozen identity list rather than a live re-query.

**Existing test coverage (`src/engine/flow/engine.test.ts:384-429`, `describe('ForEach Execution')`):**
- Test 1 (`'should iterate through collection'`, lines 385-402): static array `[10, 20, 30]`, non-mutating. Unaffected by the fix.
- Test 2 (`'should use dynamic collection'`, lines 404-428): `collection: (ctx) => [...ctx.game.all(Card)]`, non-mutating body (`cardNames.push(...)`, no `putInto`/`remove`). Unaffected by the fix — this is the exact re-evaluate-per-iteration pattern the audit warns about, but the test body happens not to mutate, so it currently passes and will continue to pass after the fix (snapshot-once behavior is observationally identical for a non-mutating body).

**Red-first regression test location:** add to this same `describe('ForEach Execution')` block in `src/engine/flow/engine.test.ts` — a new case with a mutating body (`card.putInto(game.pile)` or similar) proving all N items are visited pre-fix-failure / post-fix-success.

**VERDICT: LEGITIMATE, unchanged by any Phase 131 work.**

### F28 / ENG-08 — Action builder default no-op `execute`, `.build()` silently registerable

**Chokepoint 1:** `src/engine/action/action-builder.ts:77` — constructor seeds `this.definition = { name, selections: [], execute: () => {} }`. This default is what makes a `.build()`-terminated (or never-`.execute()`'d) action definition type-valid.

**Chokepoint 2:** `src/engine/action/action-builder.ts:636-640` (`build()` method):
```typescript
/**
 * Get the built definition (without execute, for inspection)
 */
build(): ActionDefinition {
  return this.definition;
}
```
Returns the **same `ActionDefinition` type** as `.execute(fn)` (line 638 area's sibling terminal method) — nothing distinguishes a handler-less definition from a real one at the type level.

**`registerAction()` (chokepoint 3):** `src/engine/element/game.ts:919-921`:
```typescript
registerAction(action: ActionDefinition): void {
  this._actions.set(action.name, action);
}
```
**Currently performs zero validation of any kind** — no handler-less check, no reachability check, no element-registration check. This confirms the CONTEXT's "internal uses of `.build()`... action-registration validation layer" framing needs correction for the planner: **the "v4.3 Phase 120" validation layer (element-registration + action-reachability) does NOT live inside `registerAction()`.** It lives in `Game.startFlow()`:
- `#validateActionReachability()` (game.ts:1616-1655) — called from `startFlow()` (line 1664), throws if a flow `action-step` references an unregistered action name; `devWarn`s (not throws) for a registered-but-unreferenced action.
- The PIT-02 element-class-registration check (game.ts:1660-1697, inline in `startFlow()`, not a separate named method) — throws if a queried element class was never registered via `registerElements()`.

**Both existing validations run at `startFlow()` time, not `registerAction()` time** — i.e., they run once, late (after all `defineActions()`/constructor code has run), and only if `startFlow()` is ever called (never in some test/inspection-only paths). **The ENG-08 handler-less check is the FIRST validation to live directly inside `registerAction()` itself** — it does not "join" an existing chokepoint call chain; it establishes registration-time (not flow-start-time) validation, which is *earlier* and *stricter* than the existing pattern. Planner should note this as a new validation timing precedent, not an extension of `#validateActionReachability`.

**Internal `.build()` call sites (BoardSmith src + tests):** grep of `\.build()` across `src/` (all files, including tests) returned **zero matches**. `.build()` is fully dead code with no internal consumer — confirmed matches the audit's finding exactly ("`.build()` has ZERO call sites anywhere"). No AutoUI introspection use exists (contrary to what the CONTEXT prompt speculated as a research target — verified absent).

**Recommended implementation (per CONTEXT decision + discretion):**
1. Add a `handlerless?: boolean` (or similar) flag to `ActionDefinition` (CONTEXT gives full discretion on where this flag lives, as long as `registerAction()` fails loudly). Simplest approach: have the constructor's default `execute: () => {}` be a **distinguishable sentinel function** (e.g. a named function or one tagged with a symbol/property) rather than an anonymous arrow, so `registerAction()` can detect "was `.execute()` ever called" without adding a new field to the public `ActionDefinition` type — OR add the explicit boolean field (cleaner, more discoverable, matches the type-shape-based approach games/tests could introspect). Given "Claude's Discretion" explicitly covers this, either is acceptable; a dedicated boolean field is more idiomatic to the existing `ActionDefinition` interface style (other flags like `undoable?: boolean` already exist there).
2. `.build()` sets that flag true when returning (or: the constructor's sentinel default already implies it; `.execute(fn)` clears/never sets it).
3. `registerAction()` (game.ts:920) checks the flag/sentinel and throws: `"action 'x' has no execute handler — end the chain with .execute(fn)"` (per CONTEXT's exact required wording pattern — both element and fix named).

**VERDICT: LEGITIMATE, unchanged by any Phase 131 work. Zero internal `.build()` consumers to migrate — pure guard addition.**

## Architecture Patterns

### System Architecture Diagram

```
Client/Session (out of scope for this phase)
        │
        ▼
┌───────────────────────────────────────────────────────────┐
│ Engine tier (this phase's entire scope)                    │
│                                                              │
│  Action registration (constructor time)                     │
│  ┌──────────────┐      ┌────────────────────┐              │
│  │ Action.create │──►.execute(fn)──►ActionDefinition        │
│  │ (builder)     │──►.build()───────►ActionDefinition        │
│  └──────────────┘         (ENG-08: registerAction() throws  │
│         │                  if handler-less flag set)         │
│         ▼                                                    │
│  game.registerAction(def) ──► Game._actions Map              │
│                                                                │
│  Action execution (per player action)                        │
│  ┌────────────────────────────────────────────────────┐     │
│  │ ActionExecutor.executeAction()                       │     │
│  │   └─► resolveArgs(action, rawArgs, player)            │     │
│  │         ├─ 1st pass: selection-typed args              │     │
│  │         │   (loose id/serialized-element resolution,    │     │
│  │         │    UNCHANGED by ENG-05)                        │     │
│  │         └─ 2nd pass: non-selection followUp args         │     │
│  │             (ENG-05: isSerializedElement ONLY,            │     │
│  │              bare numbers no longer coerced)               │     │
│  └─────────────────────┬────────────────────────────────┘     │
│                         ▼                                       │
│                    action.execute(resolvedArgs, ctx)             │
│                         │                                        │
│                         ▼                                        │
│         Element-tree mutation (card.putInto(...), etc.)          │
│         ┌──────────────────────────────────────────┐             │
│         │ Piece.putInto() ──► Piece.moveToInternal() │             │
│         │   (ENG-01: self/descendant ancestor-walk    │             │
│         │    throw, BEFORE any tree mutation, runs     │             │
│         │    in ALL modes not just dev)                 │             │
│         └──────────────────────────────────────────┘             │
│                                                                     │
│  Flow execution (FlowEngine step loop, independent of action exec) │
│  ┌──────────────────────────────────────────────────────┐         │
│  │ executeForEach(frame, config, context)                 │         │
│  │   1st entry: snapshot config.collection(ctx) → id list  │         │
│  │              into frame.data (ENG-06, mirrors             │         │
│  │              executeEachPlayer's eligibleSeats pattern)   │         │
│  │   Nth entry: re-resolve item by stored id/value,            │         │
│  │              NOT by re-querying collection()                │         │
│  └──────────────────────────────────────────────────────┘         │
└───────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

No new files/folders. Fixes land in the four existing files:
```
src/engine/
├── element/
│   └── piece.ts              # ENG-01: moveToInternal ancestor-walk throw
├── action/
│   ├── action.ts              # ENG-05: resolveArgs 2nd-pass tightening
│   └── action-builder.ts      # ENG-08: build() flag + handler-less sentinel
├── element/
│   └── game.ts                 # ENG-08: registerAction() throw
└── flow/
    └── engine.ts                # ENG-06: executeForEach snapshot-on-entry
```

### Pattern 1: Snapshot-on-first-entry for frame-persisted flow loops

**What:** Guard collection evaluation with `if (frame.data?.X === undefined) { ...compute once...; frame.data = {...frame.data, X: snapshot}; }`, then read from `frame.data.X` on all subsequent re-entries.
**When to use:** Any `FlowEngine` executor whose state must survive checkpoint restore mid-loop and whose source collection may be mutated by the loop body.
**Example (existing, `executeEachPlayer`):**
```typescript
// Source: src/engine/flow/engine.ts:1096-1119
if (frame.data?.eligibleSeats === undefined) {
  let players = [...this.game.all(Player as any)] as Player[];
  // ...
  frame.data = {
    ...frame.data,
    eligibleSeats: players.slice(startIndex).map(p => p.seat),
    nextIndex: 0,
  };
}
```

### Pattern 2: Fail-loud ancestor-walk guard before tree mutation

**What:** Before mutating `_t.parent`/`_t.children`, walk the destination's ancestor chain checking for a match against `this`.
**When to use:** Any mutation chokepoint where the "moving X into X's own descendant" invalid state is representable in the type system (both `this` and `destination` are typed as plain `GameElement`, so nothing prevents this at compile time).
**Example (existing, WR-03's related-but-different check, showing the walk idiom to reuse):**
```typescript
// Source: src/engine/element/piece.ts:83-104 (adapt: walk destination up checking against `this`, not checking detachment)
for (let el: GameElement = destination; el._t.parent; el = el._t.parent) {
  if (el === this || destination === this) {
    throw new Error(`Cannot move ${this.name ?? this.constructor.name} into its own descendant ${destination.name ?? destination.constructor.name}`);
  }
}
```

### Anti-Patterns to Avoid
- **Widening the `looksLikeSerializedElement` check instead of narrowing to `isSerializedElement` in resolveArgs' 2nd pass:** would still coerce `{id: 3}`-shaped plain data (not just true serialized elements), leaving the corruption vector partially open. Use `isSerializedElement` (requires `className` too) per CONTEXT decision.
- **Storing `GameElement` references directly in `frame.data` for the ENG-06 fix:** breaks checkpoint serialization/restore (same class of bug Phase 131's WR-03 diagnostic exists to catch). Always store `id: number` and re-resolve via `getElementById`.
- **Making the ENG-01 throw dev-mode-only:** unlike WR-03 (a diagnostic aid for a different, restore-related bug class), self/descendant detachment is real state corruption reachable in production play — CONTEXT requires it to throw unconditionally, not `devWarn`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Ancestor-walk containment check | A new tree-walking utility | The inline `for (let el = x; el._t.parent; el = el._t.parent)` idiom already used by WR-03 (piece.ts:83) | Same idiom, same file, same performance characteristics (O(depth)); no need for a generic "isDescendantOf" utility method unless the planner decides to also expose it publicly (out of scope per CONTEXT) |
| Serialized-element shape detection | A new/looser helper | Existing `isSerializedElement()` (action.ts:278) | Already implements exactly the `{id: number, className: string}` check CONTEXT specifies; do not add a third helper |
| Collection identity snapshotting | A new generic "stable list" utility | The existing `eligibleSeats` pattern (inline in `executeEachPlayer`) | One additional call site doesn't justify extracting a shared helper; mirror the pattern locally in `executeForEach` |

**Key insight:** All four fixes are guard/validation additions to existing single-purpose chokepoints. There is no missing library or abstraction — the risk in this phase is scope creep (e.g. building a generic "validated action definition" type system) rather than under-engineering.

## Common Pitfalls

### Pitfall 1: Conflating ENG-01's new check with WR-03's existing dev-mode detached-destination check
**What goes wrong:** A dev "merges" the new self/descendant throw into the WR-03 `isDevMode()`-gated block, making it dev-only.
**Why it happens:** Both checks live in the same function and both walk ancestors — easy to assume they're the same diagnostic.
**How to avoid:** WR-03 detects a *different* bug (stale-closure detached destinations, dev-only diagnostic, `devWarn` not throw). ENG-01 detects self/descendant containment (real corruption, must throw in all environments). Keep them as two separate blocks.
**Warning signs:** If the new throw only fires when `isDevMode()` is true, it's wrong — self/descendant `putInto()` must fail in production too.

### Pitfall 2: Narrowing resolveArgs' first pass by mistake
**What goes wrong:** Applying `isSelectionElement` tightening to the FIRST pass (selection-typed args, lines 161-237) instead of only the second pass (lines 239-259).
**Why it happens:** Both passes call similar-looking `looksLikeSerializedElement`/`isSerializedElement` checks; a search-and-replace across the whole function would over-apply the fix.
**How to avoid:** CONTEXT and the audit both scope the fix to "non-selection args" specifically — the first pass's looser `looksLikeSerializedElement` resolution for selection-typed `element`/`elements` args is intentional and must remain unchanged.
**Warning signs:** If `chooseElement`/`chooseOnBoard` selections stop resolving bare numeric IDs sent by a client, the fix was applied too broadly.

### Pitfall 3: Assuming `frame.data` for forEach must store the SAME shape as `eligibleSeats` (always `number[]`)
**What goes wrong:** Force-fitting non-element collection items (e.g. an array of plain strings/numbers already being iterated, like the existing `[10, 20, 30]` test) through an id-based resolution scheme that doesn't apply to them.
**Why it happens:** Over-generalizing from the `eachPlayer` seat-number pattern.
**How to avoid:** Only `GameElement` items need id-based snapshot+re-resolve; primitive collection items can be snapshotted as-is (they're already JSON-plain and don't go stale).
**Warning signs:** A forEach with `collection: [10, 20, 30]` (the existing passing test) suddenly needs `game.getElementById` calls that fail because 10/20/30 aren't element ids.

### Pitfall 4: Assuming `registerAction()`'s new throw can reuse `#validateActionReachability`'s call site/timing
**What goes wrong:** Placing the handler-less check inside `startFlow()`'s existing validation methods instead of directly in `registerAction()`.
**Why it happens:** The CONTEXT's "Integration Points" note ("the handler-less check joins that existing fail-fast validation layer") reads as if there's one shared validation call site — there isn't; `#validateActionReachability` and the PIT-02 element-class check are both `startFlow()`-time, not `registerAction()`-time.
**How to avoid:** Per CONTEXT's Decisions section (not just Integration Points), `registerAction()` itself must throw — this is earlier and separate from the `startFlow()` validations, not merged into them.
**Warning signs:** If a handler-less action only throws when `startFlow()` is called (not immediately at `registerActions(...)` time in the constructor), the fix is in the wrong place — tests that only call `registerAction()` without `startFlow()` (common in unit tests) would falsely pass.

## Code Examples

### Existing `eligibleSeats` snapshot pattern (template for ENG-06)
```typescript
// Source: src/engine/flow/engine.ts:1096-1122 (executeEachPlayer)
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
    eligibleSeats: players.slice(startIndex).map(p => p.seat),
    nextIndex: 0,
  };
}
const eligibleSeats = (frame.data.eligibleSeats as number[]) ?? [];
```

### Existing `isSerializedElement` helper (reuse for ENG-05)
```typescript
// Source: src/engine/action/action.ts:275-282
/**
 * Check if a value is a serialized game element (has id and className properties)
 */
private isSerializedElement(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.id === 'number' && typeof obj.className === 'string';
}
```

### MERC's existing defensive dual-shape resolver (evidence ENG-05 fix is low-risk for Phase 138)
```typescript
// Source: ~/Dropbox/MERC/BoardSmith/MERC/src/rules/actions/rebel-equipment.ts:328-343
function getUnit(ctx: { args?: Record<string, unknown> }): CombatantModel | undefined {
  const combatantArg = ctx.args?.combatantId;
  if (typeof combatantArg === 'number') {
    const el = game.getElementById(combatantArg);
    if (isCombatantModel(el)) return el;
    return undefined;
  } else if (combatantArg && typeof combatantArg === 'object' && 'id' in combatantArg) {
    const combatantObj = combatantArg as { id: number };
    const el = game.getElementById(combatantObj.id);
    if (isCombatantModel(el)) return el;
    return undefined;
  }
  return undefined;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `moveToInternal` had no dev-mode diagnostics at all | Phase 131 added WR-03 detached-destination `devWarn` | Phase 131 (2026-07-03, commit 3c86d9e per CONTEXT) | ENG-01's new throw must be added as a SEPARATE, always-on check, not merged into WR-03's dev-only block |
| `resolveArgs` second pass had no distinction between selection and non-selection args w.r.t. strictness | Still true today — first pass (selection args) stays loose, second pass (followUp args) gets tightened | This phase | No change to selection-arg resolution; only followUp-arg resolution narrows |

**Deprecated/outdated:** None — this is a bug-fix phase, not an API-modernization phase.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The `ActionDefinition` flag naming (`handlerless?: boolean` or a sentinel-execute approach) is Claude's discretion per CONTEXT, and a dedicated boolean field is the most idiomatic choice given existing fields like `undoable?: boolean` | Findings Verification F28 / ENG-08 | Low — CONTEXT explicitly grants this discretion; either implementation satisfies the requirement (registerAction() throws on handler-less definitions) |
| A2 | MERC's `getUnit`/`getSector`-style defensive dual-shape resolvers are representative of ALL of MERC's followUp-arg consumers, not just the two files sampled (`rebel-economy.ts`, `rebel-equipment.ts`) | Findings Verification F12 / ENG-05 | Medium — if other MERC action files consume followUp args WITHOUT the defensive dual-branch pattern, Phase 138's MERC re-vendor could surface breakage this research didn't predict. Recommend Phase 138 grep MERC broadly for `ctx.args?.` non-defensive numeric access before assuming zero-risk. |

**None of the four findings themselves (F3/F12/F13/F28, i.e. the trap descriptions and chokepoint locations) are ASSUMED** — all were independently re-traced against current source with file:line evidence in this research session, matching the `[VERIFIED: codebase grep]` provenance level.

## Open Questions

1. **How should `executeForEach` handle non-element, non-primitive collection items (plain objects)?**
   - What we know: No existing BoardSmith/games/MERC usage of `forEach()` iterates plain-object collections (only primitives in tests, `GameElement`s in the one dynamic-collection test).
   - What's unclear: Whether the ENG-06 fix should throw/devWarn if a non-serializable, non-element item is encountered (since it can't safely round-trip through `frame.data` for checkpoint restore), or silently best-effort JSON-clone it.
   - Recommendation: Given zero real usage of this shape, the planner should scope the fix to (a) `GameElement` items → id-based snapshot, (b) JSON-primitive items → value-based snapshot, and treat anything else as an explicit `devWarn` or throw ("forEach collection item is neither a GameElement nor a JSON primitive — cannot safely snapshot for checkpoint restore") rather than silently attempting a JSON clone that might drop data. This keeps the fix within the CONTEXT's "pick what round-trips serialization safely" discretion without adding untested generic-object handling.

2. **Should the ENG-08 handler-less flag be visible on the public `ActionDefinition` type, or kept as a private/internal marker?**
   - What we know: `ActionDefinition` is exported and consumed by session/UI code (e.g. `ActionMetadata` generation) elsewhere in the codebase.
   - What's unclear: Whether exposing `handlerless?: boolean` publicly is desirable (e.g. for AutoUI/introspection tooling to filter out inspection-only definitions) vs. keeping it as an internal-only symbol/property to avoid expanding the public API surface for a narrow safety-net field.
   - Recommendation: Given zero current consumers of `.build()`'s output, default to the simplest implementation (public optional field, consistent with existing `ActionDefinition` fields like `undoable?`) unless the planner has a specific reason to hide it.

## Environment Availability

Not applicable — this phase touches only existing TypeScript source with no new runtime/tool/service dependencies. `npm test` (vitest) is already configured and used by the existing 168-file/2135-test suite (per CONTEXT's "Specifics" section).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^2.1.0 |
| Config file | `vitest.config.ts` (repo root; pre-existing, no changes needed) |
| Quick run command | `npx vitest run src/engine/element/piece.test.ts src/engine/action/action.test.ts src/engine/flow/engine.test.ts src/engine/action/action-builder.test.ts` (adjust to whichever files receive the red-first tests) |
| Full suite command | `npm test` (i.e. `vitest run`) |

Note: no `src/engine/element/piece.test.ts` currently exists (verified via `find`) — piece-level tests (if any are added for ENG-01) will need a new file or can be colocated in an existing element-tree test file (e.g. `element-collection.test.ts` or a new `piece-move.test.ts`). Existing coverage for `moveToInternal`/`putInto` behavior currently lives implicitly across many element/game tests rather than one dedicated piece-mutation suite.

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ENG-01 | `putInto()` onto self/descendant throws actionable error | unit | `npx vitest run <new-or-existing-piece-test>` | ❌ Wave 0 — no dedicated piece-mutation test file found; create one or add to `element-collection.test.ts` |
| ENG-05 | `resolveArgs` no longer coerces bare numeric followUp args into elements | unit | `npx vitest run src/engine/action/action.test.ts` | ✅ (add new case to existing file) |
| ENG-06 | `forEach` over a mutated collection visits all items | unit | `npx vitest run src/engine/flow/engine.test.ts` | ✅ (add new case to existing `describe('ForEach Execution')` block, line 384) |
| ENG-08 | `registerAction()` throws for a `.build()`-terminated/handler-less action | unit | `npx vitest run <action-builder test file>` | ❌ Wave 0 — no `action-builder.test.ts` found by name; check whether builder behavior is tested inside `action.ts`'s own test file or needs a new file |

### Sampling Rate
- **Per task commit:** run the specific test file(s) touched by that task (see table above)
- **Per wave merge:** `npm test` (full suite; must stay green at 168+ files / 2135+ tests per CONTEXT's baseline)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] Confirm whether `src/engine/action/action-builder.ts` has a dedicated test file (grep found none by that exact name — search for builder-chain tests inside `action.test.ts` or `action-typed-args.test.ts` before creating a new file)
- [ ] Confirm whether a dedicated `piece.test.ts` / `piece-move.test.ts` should be created for ENG-01, or whether the red-first test belongs in `element-collection.test.ts` (which already covers tree-corruption-adjacent behavior)
- [ ] No framework install needed — Vitest is already fully configured

*(No other gaps: `resolveArgs` and `executeForEach` both have existing, actively-maintained test files with clear insertion points identified above.)*

## Security Domain

Not applicable — this is an internal engine-correctness phase (element mutation, arg coercion, loop iteration, builder validation), not a hidden-information/auth/session boundary. No ASVS category applies; the four findings are all "fail loud instead of silently corrupting state" fixes, not access-control or cryptography concerns. (Compare to Phase 131's SEC-01..04, which WAS security-domain — that phase is already shipped and out of scope here.)

## Sources

### Primary (HIGH confidence — direct codebase grep/read, 2026-07-03)
- `src/engine/element/piece.ts` — full read, lines 1-165
- `src/engine/action/action.ts` — full read, lines 100-380 (resolveArgs and helpers)
- `src/engine/flow/engine.ts` — full read, lines 1070-1270 (executeEachPlayer, executeForEach, executeActionStep)
- `src/engine/action/action-builder.ts` — full read, lines 1-100, 600-640
- `src/engine/element/game.ts` — full read, lines 890-960 (registerAction/registerActions), 1600-1720 (`#validateActionReachability`, PIT-02 element check, startFlow)
- `src/engine/command/executor.ts` — lines 100-150 (executeMove/executeRemove confirm single chokepoint)
- `src/engine/flow/engine.test.ts` — lines 384-429 (existing ForEach test coverage)
- `.planning/tmp/v4.5-audit-findings.json` — original audit findings F3, F12, F13, F28 with verdicts

### Secondary (MEDIUM confidence — cross-repo grep, verified against actual source)
- `~/BoardSmithGames/*/src/rules/*.ts` — grep for `.build()`, `forEach(`, `followUp`, `putInto` across all 8 example games
- `~/Dropbox/MERC/BoardSmith/MERC/src/rules/actions/*.ts` — grep + targeted reads of `rebel-economy.ts` and `rebel-equipment.ts` followUp-arg patterns and their defensive resolver helpers

### Tertiary (LOW confidence)
- None — all findings in this research were verified directly against source, not inferred from training data or unverified web search.

## Metadata

**Confidence breakdown:**
- Standard stack: N/A — no packages
- Architecture (chokepoint identification): HIGH — every claim backed by file:line reads of current source
- Pitfalls: HIGH — derived directly from re-tracing the audit findings against post-Phase-131 code, not speculation
- Cross-repo impact (GAMES-01/02 forward-look): MEDIUM — thorough grep of both repos, but MERC's full action surface (beyond the two sampled files) was not exhaustively read; flagged as Assumption A2

**Research date:** 2026-07-03
**Valid until:** Stable — this is internal-only engine code with no external dependency drift risk; research remains valid until the four target files are modified by this phase's own plans (i.e., single-use research, not time-decaying)
