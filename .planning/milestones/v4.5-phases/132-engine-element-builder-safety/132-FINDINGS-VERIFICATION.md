# Phase 132 Findings Verification (PROC-01 Gate)

Independent re-verification of the four in-scope audit findings (F3/ENG-01, F12/ENG-05,
F13/ENG-06, F28/ENG-08), each re-traced against current source (post-Phase-131,
2026-07-03) BEFORE any fix is planned or written. `132-RESEARCH.md` already performed a
fresh trace of all four; this document independently re-confirms each trace against the
actual files (not the research doc) and records the gating verdict.

---

## F3 / ENG-01 — `putInto()` onto own descendant silently detaches subtree

**Chokepoint:** `src/engine/element/piece.ts:81` (`moveToInternal`).

Independently re-read `piece.ts:74-166` directly (not via research doc). Confirmed structure, in order:

1. **Lines 90-104** — Phase 131's WR-03 check: gated by `if (isDevMode())`. Walks `destination._t.parent` up to root, checking at each ancestor `el` whether `el._t.parent._t.children.includes(el)`. If a detached ancestor is found, calls `devWarn(...)` (not `throw`) and `break`s. This diagnostic is about **detached destinations** — an ancestor whose recorded parent no longer contains it (classic symptom: a restored `onEnter`/`onExit` closure holding a stale pre-restore element reference). It never compares any ancestor against `this`, so it cannot detect self/descendant containment.
2. **Lines 106-123** — removes `this` from `oldParent._t.children`; if `this` is not found in `oldParent`'s children, logs a `console.error` "TREE CORRUPTION" gated by `process.env?.NODE_ENV !== 'production'` (a *different* gate than `isDevMode()`). This too is duplicate-reachability detection (has `this` already been misplaced elsewhere), not self/descendant detection.
3. **Lines 126-128** — `oldParent.triggerEvent('exit', this)` if `oldParent instanceof Space`.
4. **Lines 132-138** — unconditional mutation: `this._t.parent = destination`, then splice `this` into `destination._t.children` (unshift or push depending on position/order mode).
5. **Lines 142-144** — `destination.triggerEvent('enter', this)` if `destination instanceof Space`.

**Confirmed: no self/descendant containment check exists anywhere in this function, in any mode.** Calling `outer.putInto(inner)` where `inner` is a descendant of `outer` (or `destination === this`) proceeds straight through steps 1-5 with no guard: `outer` (`this`) is spliced out of its own parent's children, then `outer._t.parent` is unconditionally reassigned to `inner` — producing a parent/child cycle (`outer` is now both an ancestor and, transitively, a child of `inner`). This is unchanged by Phase 131; WR-03 does not cover this bug class.

**Explicit record (per must_have):** Phase 131's WR-03 check (a) is gated by `isDevMode()` — does not run in production, (b) only calls `devWarn` (never throws, never blocks the mutation), and (c) detects a categorically different defect (detached-destination ancestor walk, i.e. stale-closure references into a discarded pre-restore tree) — **not** self/descendant containment of `this` within `destination`'s ancestor chain. A fix for F3/ENG-01 must be a separate, always-on (all-mode) check that throws, not an extension of WR-03's block.

**Call-path confirmation (single chokepoint claim), independently re-grepped:**
- `Piece.putInto()` (`piece.ts:74`) → `this.moveToInternal(destination, options?.position)` (line 75)
- `Piece.remove()` (`piece.ts:162-166`) → `this.putInto(this.game.pile)` → funnels into `moveToInternal`
- `command/executor.ts:120-134` `executeMove()` → `(element as Piece).moveToInternal(destination, command.position)` (line 132)
- `command/executor.ts:136-144` `executeRemove()` → `(element as Piece).moveToInternal(game.pile)` (line 142)

All four confirmed call sites funnel exclusively through `moveToInternal`. No parallel/duplicate tree-mutation path exists in `piece.ts` or `executor.ts`.

**VERDICT: LEGITIMATE**

---

## F12 / ENG-05 — `resolveArgs` second pass coerces bare numbers into elements

**Chokepoint:** `src/engine/action/action.ts` — `resolveArgs()` (lines 153-262).

Independently re-read `action.ts:153-283` directly. Confirmed structure:

- **First pass (lines 161-237):** iterates `action.selections`, resolving each named selection's raw value by `selection.type` (`element`, `elements`, `choice`). For `element`/`elements` types, a bare `number` value is resolved via `this.game.getElementById(value)` (lines 168-172, 186-191), and object values are resolved via the looser `looksLikeSerializedElement()` helper (lines 174, 200). This pass is scoped exclusively to `action.selections` (typed, developer-declared selection args) — it is not touched by this finding.
- **Second pass (lines 241-259):** iterates `Object.entries(args)`, skipping any key already in `selectionNames` (line 242). For every remaining (non-selection) key: if the value is a bare `number`, it calls `this.game.getElementById(value)` and — if a matching element exists — silently overwrites `resolved[key]` with the `GameElement` (lines 246-251). If the value instead passes the looser `looksLikeSerializedElement()` check (only requires `typeof obj.id === 'number'`, no `className` requirement — line 269-272), it is likewise resolved and overwritten (lines 253-258).

**Confirmed defect:** any non-selection arg (typically a `followUp` arg, e.g. `{ sectorId: 145 }`) whose value happens to be a bare number matching *any* live element's id is silently rewritten into that `GameElement`, even though the arg was never declared as an element-typed selection. This is a classic silent-wrong-path coercion: a plain numeric business value (e.g. a turn counter, a quantity, a die-roll result) that happens to collide with an element id gets silently replaced by that element.

**Existing helpers (both confirmed present, no new helper needed):**
- `isSerializedElement()` (lines 278-282): requires **both** `typeof obj.id === 'number'` AND `typeof obj.className === 'string'`.
- `looksLikeSerializedElement()` (lines 269-273): looser — only requires `typeof obj.id === 'number'`. Currently used in the second pass (line 253) and in the first pass for `element`/`elements` selections (lines 174, 200).

**Fix scope (recorded for planner, not implemented here):** in the second pass only, delete the bare-number branch (lines 245-251) and replace `looksLikeSerializedElement` with `isSerializedElement` at line 253, so only genuine `{id, className}`-shaped serialized-element objects are resolved. The first pass (lines 161-237) is untouched — selection-typed args intentionally keep the looser bare-number/`looksLikeSerializedElement` resolution, since those args are declared element-typed by the developer and bare-number coercion there is the intended, safe behavior.

**Exact second-pass line range confirmed:** `action.ts:241-259` (loop header through closing brace); the bare-number branch to delete is `246-251`; the helper swap is at line `253`.

**VERDICT: LEGITIMATE**

---

## F13 / ENG-06 — `forEach` re-evaluates collection every iteration against a persisted index

**Chokepoint:** `src/engine/flow/engine.ts:1151-1176` (`executeForEach`, private method on `FlowEngine`).

Independently re-read `engine.ts:1089-1176` directly. Confirmed `executeForEach` body:

```typescript
private executeForEach(frame, config, context): FlowStepResult {
  const items = typeof config.collection === 'function'
    ? config.collection(context)
    : config.collection;
  const itemIndex = (frame.data?.itemIndex as number) ?? 0;
  if (itemIndex >= items.length) { frame.completed = true; return {...}; }
  this.variables[config.as] = items[itemIndex];
  this.stack.push({ node: config.do, index: 0, completed: false });
  frame.data = { ...frame.data, itemIndex: itemIndex + 1 };
  frame.index++;
  return { continue: true, awaitingInput: false };
}
```

Confirmed: `config.collection(context)` is invoked **fresh on every re-entry** into this frame (the flow stack machine pushes one child step per call and re-enters `executeForEach` for the next iteration). `itemIndex` only counts iteration count — it carries no item identity. If `config.collection` is a live query (e.g. `(ctx) => [...ctx.game.all(Card)]`) and the loop body (`config.do`) mutates the underlying collection (removes/moves an item), the re-fetched `items` array shrinks, and reading `items[itemIndex]` on the next re-entry skips whatever shifted into the already-consumed index — the classic mutate-while-iterating-by-index bug.

**Mirror template — `executeEachPlayer`'s `eligibleSeats` snapshot (lines 1089-1149), independently re-read:**
```typescript
if (frame.data?.eligibleSeats === undefined) {
  let players = [...this.game.all(Player as any)] as Player[];
  // ...filter/direction/startingPlayer logic...
  frame.data = {
    ...frame.data,
    eligibleSeats: players.slice(startIndex).map(p => p.seat),  // number[]
    nextIndex: 0,
  };
}
const eligibleSeats = (frame.data.eligibleSeats as number[]) ?? [];
```
Confirmed pattern: evaluate the collection exactly once, guarded by `frame.data?.eligibleSeats === undefined` (first entry only); store a **stable identity list of primitives** (`number[]` of `Player.seat`, not `Player` object references) inside `frame.data`; on every subsequent iteration, re-derive the live object (`this.game.getPlayer(seat)`, confirmed at line 1128) from the stored identity rather than re-querying `this.game.all(Player)`. This is exactly the template `executeForEach` must mirror.

**`frame.data` serialization constraint (independently confirmed via the pattern itself):** `eligibleSeats` stores `number[]`, never `Player[]` — this is deliberate, because `frame.data` is part of `ExecutionFrame`, which persists as part of `FlowEngine`'s checkpointed stack. Storing a live `GameElement`/`Player` object reference in `frame.data` would either fail to serialize as plain JSON or go stale across a checkpoint restore (the exact class of bug Phase 131's WR-03 diagnostic exists to catch). The fix for `executeForEach` must therefore store `GameElement` items as `id: number` (re-resolved via `this.game.getElementById(id)` per iteration) and only store non-element primitive items (string/number/boolean) directly.

**Existing test coverage confirmed:** `src/engine/flow/engine.test.ts` `describe('ForEach Execution')` — a static-array case and a dynamic-collection case, neither of which mutates the collection inside the loop body; both currently pass and are unaffected by a snapshot-once fix (observationally identical for a non-mutating body).

**VERDICT: LEGITIMATE**

---

## F28 / ENG-08 — Action builder default no-op `execute`, `.build()` silently registerable

**Chokepoint 1:** `src/engine/action/action-builder.ts:73-79` (constructor).

Independently re-read `action-builder.ts:60-90` directly. Confirmed constructor:
```typescript
private constructor(name: string) {
  this.definition = {
    name,
    selections: [],
    execute: () => {},
  };
}
```
`execute` defaults to a no-op arrow function. Nothing distinguishes this default from a real developer-supplied handler at the type level.

**Chokepoint 2:** `action-builder.ts:635-640` (`build()`), independently re-read:
```typescript
/**
 * Get the built definition (without execute, for inspection)
 */
build(): ActionDefinition {
  return this.definition;
}
```
Returns the exact same `ActionDefinition` type as the terminal `.execute(fn)` method (lines 625-633), which also returns `ActionDefinition` after setting `this.definition.execute = fn`. A definition built via `.build()` (handler never supplied) and a definition built via `.execute(fn)` (handler supplied) are structurally indistinguishable to any consumer.

**Chokepoint 3 — `registerAction()`:** independently re-read `game.ts:912-921`:
```typescript
registerAction(action: ActionDefinition): void {
  this._actions.set(action.name, action);
}
```
**Confirmed: `registerAction()` performs zero validation of any kind** — no handler-less check, no name-collision check, no reachability check. It is a bare `Map.set`.

**Confirmed distinct from `startFlow()`'s existing validators:** independently re-read `game.ts:1600-1699`. `#validateActionReachability()` (lines 1616-1655) is a private method that walks the flow tree to find `action-step`/`simultaneous-action-step` node references and throws if a referenced action name was never registered (lines 1634-1642); it also `devWarn`s (not throws) for a registered-but-unreferenced action (lines 1644-1654). This method is called from `startFlow()` at line 1665 — i.e., only when `startFlow()` runs, which is after all constructor-time `registerActions()` calls have already completed. The PIT-02 element-class-registration check (lines 1669-1699, inline in `startFlow()`, not a separately named method) is likewise `startFlow()`-time only.

**Explicit record (per must_have):** `registerAction()` currently performs **zero validation** of any kind — confirmed by direct reading of `game.ts:919-921`, which is a bare `this._actions.set(action.name, action)` with no guard clauses whatsoever. The two existing validators (`#validateActionReachability` and the PIT-02 element-class check) both live inside `startFlow()`, not inside `registerAction()`, and both run once, late — only if and when `startFlow()` is ever invoked. A handler-less-action check placed inside `registerAction()` itself is therefore **new registration-time validation**, not an extension of `startFlow()`'s existing validators: it is earlier (constructor time, before any flow exists) and stricter (fires even in unit tests that call `registerAction()`/`registerActions()` directly and never call `startFlow()`).

**`.build()` internal call-site check:** grep of `\.build()` across `src/` (including tests) returned zero matches — `.build()` is currently dead code with no internal consumer, confirming a handler-less-check fix has no existing caller to migrate.

**VERDICT: LEGITIMATE**

---

## Summary

| Finding | Verdict |
|---------|---------|
| F3 / ENG-01 | LEGITIMATE |
| F12 / ENG-05 | LEGITIMATE |
| F13 / ENG-06 | LEGITIMATE |
| F28 / ENG-08 | LEGITIMATE |

All four findings independently re-verified against current post-Phase-131 source (2026-07-03) via direct file reads (not solely relying on `132-RESEARCH.md`'s prior trace). No fix code was written in the production of this document — verdicts only. PROC-01 gate is satisfied; fix plans 132-02 through 132-05 are unblocked.
