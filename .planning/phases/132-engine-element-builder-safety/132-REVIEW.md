---
phase: 132-engine-element-builder-safety
reviewed: 2026-07-03T07:46:00Z
depth: standard
files_reviewed: 13
files_reviewed_list:
  - docs/common-pitfalls.md
  - src/engine/action/action-builder.ts
  - src/engine/action/action.test.ts
  - src/engine/action/action.ts
  - src/engine/action/types.ts
  - src/engine/element/game-element.test.ts
  - src/engine/element/game.test.ts
  - src/engine/element/game.ts
  - src/engine/element/piece.ts
  - src/engine/flow/engine.test.ts
  - src/engine/flow/engine.ts
  - src/session/testing/fixtures/collect-fixture.ts
  - src/session/testing/fixtures/collect-turns-fixture.ts
findings:
  critical: 0
  warning: 5
  info: 3
  total: 8
status: issues_found
---

# Phase 132: Code Review Report

**Reviewed:** 2026-07-03T07:46:00Z
**Depth:** standard
**Files Reviewed:** 13
**Status:** issues_found

## Summary

Reviewed the four Phase 132 changes (ENG-01 self/descendant putInto guard, ENG-05 resolveArgs bare-number narrowing, ENG-06 forEach snapshot-on-entry, ENG-08 handler-less registration rejection) plus the fixture and doc updates. Diff base verified as `ec78b3a5~1..HEAD`. Targeted test suites run green (288 engine tests + 24 fixture-consuming session/runtime tests).

The core implementations are correct. Adversarial checks that came back clean:

- **ENG-01 ancestor walk**: reference identity is sound here — `getElementById`/finders return live tree instances, so `el === this` is valid in-engine; guard runs before any mutation; `game.pile` (parentless) and detached destinations terminate the walk correctly; ordering before the Phase 131 WR-03 dev check is right (a self-descendant move both corrupts and detaches — the unconditional production throw must win).
- **ENG-06**: `game.getElementById` searches `game.pile` (game.ts:819-825), so the common `piece.remove()` / move-to-pile pattern inside a loop body does NOT trigger the "no longer exists" throw — only genuinely unreachable ids do. `Player extends GameElement` and players are created via `this.create(...)` (in-tree), so forEach-over-players survives `{elementId}` tagging. The snapshot round-trips through `getPosition()` frameData (shallow copy of JSON-plain data, engine.ts:797-807) and `restore()` (engine.ts:566-581); a restored frame with `forEachItems` present skips re-snapshotting, which is the intended stability win. The snapshot array is never mutated after creation, so the shallow-copy aliasing in `getPosition` is safe. Empty collections, `null` items, and the existing primitive-collection test (`[10, 20, 30]`) all behave.
- **ENG-05**: `pick-handler.ts:193` and `runner.ts:255` both funnel through the single `resolveArgs`, so prompt/filter/execute/history all see identical narrowed behavior; the looser `looksLikeSerializedElement` remains only on *declared* element selections (first pass), which is intentional. No other non-selection bare-number→element coercion path found (session-layer `{ id: val }` conversions at game-session.ts:1032 / stateless-ops.ts:611,697 are display-only hint/ref shapes, not state coercion).
- **ENG-08**: `registerActions(...)` funnels through `registerAction` (game.ts:954-958), so the guard cannot be bypassed via the plural API. `handlerless` is deleted by `.execute(fn)`, never spread into action metadata (`action-metadata.ts` builds field-by-field), and `_actions` is excluded from serialization — no leak into schemas, AutoUI metadata, or snapshots. Hand-written object-literal definitions (no `handlerless` key) register fine. `.build()` followed by a later `.execute(fn)` on the same builder mutates the shared definition and clears the flag, matching the documented contract.
- **Fixtures**: both collect fixtures correctly switched to explicit `getElementById(... as number)` and their consuming parity/undo/timetravel suites pass.

The findings below are documentation drift that re-teaches the exact bug ENG-05 removed, a validation gap in the surviving `{id, className}` coercion, a type/runtime contract mismatch in `forEach`, and a test gap on the new checkpoint surface.

## Warnings

### WR-01: Section 10 of common-pitfalls.md still ends with the pre-ENG-05 claim it was rewritten to remove

**File:** `docs/common-pitfalls.md:812-816`
**Issue:** The phase rewrote pitfall #10 to say bare numeric non-selection args are **never** auto-resolved, but left the section's closing paragraph intact: *"### Why This Happens — The server resolves numeric args to elements so that most action callbacks 'just work' with element objects."* This directly contradicts the corrected content 20 lines above it, in the same section a developer reads to understand ENG-05.
**Fix:** Replace the stale paragraph with the actual rationale, e.g.:
```markdown
### Why Only the `{id, className}` Shape Resolves

A bare number is ambiguous — it may be a count, an index, or an id. Only the
explicit serialized-element shape is an unambiguous signal that an element
reference was intended, so only that shape is coerced (ENG-05).
```

### WR-02: Pitfall #15 still teaches the removed auto-resolution behavior

**File:** `docs/common-pitfalls.md:1264-1272, 1303-1313, 1773`
**Issue:** Section 15 ("Using followUp Args in prompt/filter") was not updated for ENG-05. It still states: *"**Elements are automatically resolved everywhere**: Whether you pass an element or an ID, the server resolves it to the actual Element"* and *"Pass element or ID"* (line ~1256), and the "Why This Works" list repeats "Server resolves everywhere ... Resolves ALL args (selection args AND followUp args)". For a bare numeric ID in a non-selection followUp arg this is now false — a developer following section 15 will write `element.container === ctx.args.sectorId` against a plain number and get a silent always-false comparison, the exact trap this phase fixed. The Quick Reference row at line 1773 ("Args are resolved - use ctx.args.sectorId") has the same problem. The fact that both collect fixtures had to be patched for this exact assumption proves real code follows this doc.
**Fix:** Rewrite section 15 to match section 10: elements passed directly still work (they serialize to `{id, className, ...}` via `GameElement.toJSON` and resolve on the way back); bare numeric IDs stay numbers and must be resolved with `getElementById`. Prefer recommending the explicit `{ id, className }` shape, which is also structured-clone-safe over the postMessage/RPC boundary (a live element in `followUp.args` is not).

### WR-03: resolveArgs second pass resolves `{id, className}` by id alone — className is never validated

**File:** `src/engine/action/action.ts:250-256`
**Issue:** The narrowed second pass treats `className` purely as a shape discriminator: `{ id: 7, className: 'Sector' }` resolves to whatever element has id 7, even if that element is a `Card`. The entire justification for keeping this coercion (per the ENG-05 comment: "unambiguously represent element references") rests on `className` being a truthful signal, yet a mismatch silently hands the execute handler a wrong-class element — the same corruption class ENG-05 was fixing, just one step removed. The engine already validates this exact shape elsewhere: `relinkFlowVariables` (src/engine/flow/engine.ts:93-96) refuses to resolve when `live.constructor.name !== value.className`. The two paths are inconsistent.
**Fix:** In the second pass, after `getElementById`, verify the class matches before substituting; on mismatch, leave the value unresolved (fail loud downstream) and `devWarn`:
```typescript
if (this.isSerializedElement(value)) {
  const element = this.game.getElementById((value as { id: number }).id);
  if (element && element.constructor.name === (value as { className: string }).className) {
    resolved[key] = element;
  } else if (element) {
    devWarn(`followup-arg-class-mismatch:${key}`,
      `followUp arg '${key}' claims className '${(value as { className: string }).className}' ` +
      `but element ${element.id} is a ${element.constructor.name}; leaving it unresolved.`);
  }
}
```
If subclass-name flexibility is a concern (dev writes base-class name for a subclass instance), use an instanceof check against the class registry instead of strict name equality.

### WR-04: forEach() type signature still admits collection items the runtime now rejects

**File:** `src/engine/flow/builders.ts:169-184`, `src/engine/flow/types.ts:124-131`
**Issue:** `forEach<T>` is an unconstrained generic, so `forEach({ collection: [{ round: 1 }, { round: 2 }], as: 'r', do: ... })` still compiles cleanly — but ENG-06 now throws at runtime on first entry ("collection item is not a GameElement or JSON primitive"). Before this phase, plain-object items worked (they were assigned directly to the loop variable), so this is a behavioral narrowing that the type system does not express: the wrong path is still the easy path at compile time (Pit of Success violation). No BoardSmith-internal or sibling-game flow currently uses object collections, but MERC is vendored and cannot be grepped from here.
**Fix:** Constrain the generic so unsupported item types fail at compile time, matching the runtime contract:
```typescript
export function forEach<T extends GameElement | string | number | boolean | null>(config: {
  collection: T[] | ((context: FlowContext) => T[]);
  ...
```
Apply the same constraint to `ForEachConfig<T>` and document the restriction (and the "move, don't delete" rule) in the `forEach` JSDoc, which currently says nothing about either.

### WR-05: New forEach checkpoint surface (`frame.data.forEachItems`) has no restore-path test

**File:** `src/engine/flow/engine.test.ts:426-460` (only coverage of ENG-06)
**Issue:** The stated purpose of the tagged-wrapper design is checkpoint/restore safety ("keeps frame.data checkpoint-safe", "round-trip through checkpoint/restore"), and the behavioral win is that a mid-loop restore reuses the original snapshot instead of recomputing a possibly-changed collection. None of that is tested: the only new test covers in-process mutation. Untested paths: (a) `getPosition()` → `restore()` mid-loop resumes at the correct item with the original snapshot; (b) the deleted-element throw (engine.ts:1207-1213) — currently unreachable in any test; (c) the non-primitive item throw (engine.ts:1186-1190). Project rules treat in-scope test gaps as blockers, and (a) is the load-bearing new serialization contract — a future refactor of `frameData` handling would regress it silently.
**Fix:** Add a test that starts a forEach over 3+ elements with an `actionStep` body, captures `getState()` after the first iteration, mutates the collection source, restores into a fresh engine via `restoreFullState`, and asserts the remaining visited ids equal the original snapshot's tail. Add throw-path tests for (b) (e.g. surgically detach an element from tree+pile) and (c) (object item).

## Info

### IN-01: ENG-01 ancestor walk has no cycle guard

**File:** `src/engine/element/piece.ts:96-104`
**Issue:** `for (let el = destination._t.parent; el; el = el._t.parent)` never terminates if the `_t.parent` chain is already cyclic. The guard itself prevents *creating* cycles via `putInto`, and restore rebuilds trees from acyclic nested JSON, so a cycle can only arise from direct `_t` mutation — but if one exists, this walk hangs the process instead of reporting corruption. The Phase 131 WR-03 walk at line 115 shares the exposure.
**Fix:** Cap the walk (e.g. 10,000 hops) and throw a "tree corruption: cyclic parent chain" error when exceeded.

### IN-02: runner.ts serializeForHistory comment is now partially stale

**File:** `src/runtime/runner.ts:229-233`
**Issue:** "Raw element IDs are first resolved to GameElement objects so they serialize with branch paths (or stable IDs) that survive game restoration, instead of being passed through as raw numbers" — post-ENG-05 this holds only for declared selection args. Bare-number non-selection followUp args now stay raw numbers in `actionHistory` and are never branch-path-stabilized, so replay of such args relies on deterministic numeric id assignment (which holds today; fixture suites confirm). The comment should state that so a future reader doesn't "fix" resolveArgs back.
**Fix:** Amend the comment: selection args are resolved/stabilized; non-selection numeric args intentionally pass through as raw numbers (ENG-05) and rely on deterministic element ids across replay.

### IN-03: Self-move error message references putInto() from a replay-reachable path

**File:** `src/engine/element/piece.ts:89-95`
**Issue:** `moveToInternal` is also invoked by the command executor during replay (src/engine/command/executor.ts:132,142); when a corrupt recorded command trips the guard there, the message "putInto() destination must not be the element being moved" points at an API the replaying code never called.
**Fix:** Phrase neutrally, e.g. "a move destination must not be the element being moved (or any of its descendants)".

---

_Reviewed: 2026-07-03T07:46:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
