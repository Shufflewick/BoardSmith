---
phase: 120-authoring-pit-of-success-guards
reviewed: 2026-06-30T00:00:00Z
depth: deep
files_reviewed: 8
files_reviewed_list:
  - src/engine/flow/builders.ts
  - src/engine/flow/walk-flow-nodes.ts
  - src/engine/element/game.ts
  - src/engine/element/game-element.ts
  - src/engine/element/types.ts
  - src/eslint-plugin/rules/no-element-identity-comparison.ts
  - src/eslint-plugin/rules/no-element-array-state.ts
  - src/eslint-plugin/index.ts
findings:
  critical: 0
  warning: 4
  info: 1
  total: 5
status: resolved
---

# Phase 120: Code Review Report

**Reviewed:** 2026-06-30
**Depth:** deep
**Files Reviewed:** 8
**Status:** issues_found

## Summary

Traced all four PIT guards end-to-end against the specific failure scenarios called out in the review brief. The core mechanics are sound:

- **PIT-01** (`loop()` throws on missing `maxIterations`) fires only in the raw `loop()` builder. `turnLoop()` and `stateAwareLoop()` both default via `maxIterations: config.maxIterations ?? 100` *before* calling `loop()`, so the internal callers are correctly exempted. Message is actionable.
- **PIT-03** (`walkFlowNodes` / `#validateActionReachability`) is exhaustive over the current 11-member `FlowNode` union (verified against `src/engine/flow/types.ts`), correctly skips function-valued `actions` (documented blind spot), and correctly uses `devWarn` (never throw) for the reverse "registered but unreached" case. `#validateActionReachability()` runs and can throw *before* `FlowEngine` is constructed and *before* PIT-02 recording starts in `startFlow()` — the two guards do not interleave, so there's no ordering/double-traversal bug between them.
- **PIT-02** (`_pit02RecordingActive` / `_pit02RecordedClasses`) is correctly scoped per-`_ctx` (not module-global — confirmed via `types.ts`), is reset via `try/finally` around `this._flowEngine.start()` so a throw inside `start()` can't leave recording stuck on, allocates nothing on the hot path when inactive (single boolean short-circuit in `recordQueriedClassIfActive`), correctly distinguishes a class-typed finder from a predicate/object filter via the `isGameElement` static-flag guard (no over-triggering), and correctly records even when the query returns an empty collection (recording happens unconditionally before the query executes).

However, PIT-02's coverage has two real, provable gaps (not documented as accepted bounds anywhere), and the two new ESLint rules have a scope-hygiene issue in their name-based heuristic that can produce false positives on legitimate code under a rule registered at `error` severity. Details below.

## Warnings

### WR-01: PIT-02 does not record `.has()` queries — a typo'd/unregistered class checked via `has()` is invisible to the guard forever

**File:** `src/engine/element/game-element.ts:600-611`
**Issue:** `all`, `first`, `firstN`, `last`, and `lastN` all call `recordQueriedClassIfActive(this._ctx, classNameOrFinder)` before delegating to the underlying `ElementCollection`. `has()` builds its own `ElementCollection` and calls `.has()` on it directly, with no `recordQueriedClassIfActive` call at all:
```ts
has<F extends GameElement>(...): boolean {
  const collection = new ElementCollection(...this._t.children);
  return collection.has(classNameOrFinder as ElementClass<F>, ...finders);
}
```
`has(ElementClass)` is an extremely common idiom (`if (hand.has(Card))`, `if (board.has(Piece, {...}))`) — arguably more common than `first`/`last` for a pure existence check. If a game author passes a mistyped or never-registered class to `has()`, the query silently returns `false` forever (exactly the failure mode PIT-02 exists to catch for `all`/`first`/etc.), and the class is never added to `_pit02RecordedClasses`, so `startFlow()`'s post-traversal diff never flags it. Note `count()` (line 629-639) *does* get coverage for free because it delegates through `this.all(...)`, making the omission of `has()` an inconsistency between two otherwise-parallel finder methods, not an intentional design boundary.
**Fix:** Add the same `recordQueriedClassIfActive(this._ctx, classNameOrFinder)` call at the top of `has()`, mirroring the other five finders:
```ts
has<F extends GameElement>(
  classNameOrFinder?: ElementClass<F> | ElementFinder<F>,
  ...finders: ElementFinder<F>[]
): boolean {
  recordQueriedClassIfActive(this._ctx, classNameOrFinder);
  const collection = new ElementCollection(...this._t.children);
  return collection.has(classNameOrFinder as ElementClass<F>, ...finders);
}
```

### WR-02: PIT-02 recording is bypassed for finder calls made directly on an `ElementCollection` (e.g. `.children.all(Foo)`)

**File:** `src/engine/element/game-element.ts:171-173` (the `children` getter), `src/engine/element/element-collection.ts` (own `all`/`first`/`firstN`/`last`/`lastN`/`has` implementations)
**Issue:** `GameElement.children` returns a plain `ElementCollection`, which has its own `all`/`first`/etc. implementations with no `_ctx` linkage (this is called out in a code comment on `isElementClass` in `game-element.ts:18-20` as a known reason `ElementCollection` "cannot be the recording hook"). The practical consequence: any query chained off `.children` — e.g. `board.children.all(Piece)`, a completely idiomatic pattern given `children` is a public documented getter — never passes through `recordQueriedClassIfActive`, so a typo'd class referenced only this way is permanently invisible to PIT-02, with no diagnostic anywhere (not even a `devWarn`) telling the author this code path isn't covered.
**Fix:** At minimum, surface this as a documented limitation in the public-facing docs for `game.all()`/PIT-02 (the current caveat is an internal code comment only, not visible to game authors deciding which pattern to use). Better: have `GameElement.children` "reach through" to the recording hook — e.g. return a wrapped/instrumented collection, or expose the query only via a variant that still touches `_ctx` — so the same class of authoring mistake is caught regardless of whether the author wrote `board.all(Piece)` or `board.children.all(Piece)`.

### WR-03: ESLint rules resolve GameElement-typed variable names at whole-file scope, not lexical scope — false positives possible under `error` severity

**File:** `src/eslint-plugin/rules/no-element-identity-comparison.ts:131-224`
**Issue:** `elementVarNames`/`elementArrayVarNames` are populated once per `Program` by walking the *entire file* for any `Identifier` with a GameElement(-ish) type annotation, then the `BinaryExpression`/`CallExpression` visitors check membership by **name only** (`elementVarNames.has(n.name)`), with no scope/binding resolution. If the same file defines two unrelated functions/methods that each have a local variable or parameter named e.g. `card` — one typed `Card` (a `GameElement` subclass) and one typed `string` (e.g. a card ID) — the rule will flag `card === otherCard` inside the *second, unrelated* function as an identity-comparison violation, because the name `card` was seen with a `GameElement` annotation somewhere else in the file. This is a real false-positive class distinct from the two documented "ACCEPTED BOUNDS" (same-named class-not-actually-extending-GameElement, and untyped operands with no evidence) — neither bound covers same-named-but-different-scope variables. Because `no-element-identity-comparison` is registered at `'error'` in `plugin.configs.recommended` (`src/eslint-plugin/index.ts:40`), this can break `lint`/CI for legitimate, correct game code that happens to reuse a common variable name (`card`, `piece`, `player`, `target`, ...) across multiple functions in one file — a very likely occurrence in game code.
**Fix:** Track scope alongside name — e.g. use ESLint's scope manager (`context.sourceCode.getScope(node)` / `context.getScope()`) to resolve the binding for each `Identifier` before checking `elementVarNames`, rather than a flat file-wide name set. At minimum, document this additional false-positive bound explicitly in the rule's JSDoc so it's a known, accepted tradeoff rather than an unstated gap.

### WR-04: `walkFlowNodes` has no exhaustiveness guard — a future `FlowNode` variant would be silently skipped with no compile error

**File:** `src/engine/flow/walk-flow-nodes.ts:24-56`
**Issue:** The `switch (node.type)` is correctly exhaustive *today* against the 11-member `FlowNodeType`/`FlowNode` union in `src/engine/flow/types.ts`, but there is no `default` branch asserting exhaustiveness (e.g. `default: { const _exhaustive: never = node; break; }`). Because the function's return type (`Generator<FlowNode>`) doesn't depend on the switch being exhaustive, TypeScript will not flag a missing case if a new `FlowNode` variant (e.g. a hypothetical `'parallel'` or `'try-catch'` node type) is added to the union in the future without updating this walker. Any `action-step`/`simultaneous-action-step` nested inside that new node type would then be silently un-walked — reintroducing, for framework maintainers rather than game authors, exactly the "referenced action silently unvalidated" failure mode PIT-03 exists to eliminate for game authors.
**Fix:** Add an exhaustiveness assertion in a `default` case:
```ts
default: {
  const _exhaustive: never = node;
  return _exhaustive;
}
```
This turns a future missed-case into a compile-time error at the point the new `FlowNode` variant is added, rather than a silent runtime gap discovered later.

## Info

### IN-01: Vacuous conditional in `no-element-array-state.ts`

**File:** `src/eslint-plugin/rules/no-element-array-state.ts:186`
**Issue:** `resolveArrayElementTypeName(propDef.key ? (propDef as { typeAnnotation?: unknown }).typeAnnotation : undefined)` gates on `propDef.key`, but every valid `PropertyDefinition` AST node has a `key` (it's required by the grammar), so this ternary is always effectively the true branch and reads as dead/misleading — presumably meant to guard against something else (e.g. a missing type annotation) but doesn't actually do so (the callee already handles an absent `typeAnnotation` gracefully).
**Fix:** Simplify to `resolveArrayElementTypeName((propDef as { typeAnnotation?: unknown }).typeAnnotation)`, or if the intent was to skip untyped fields, that's already handled inside `resolveArrayElementTypeName`'s own `if (!ta || ...) return undefined` guard, making the outer ternary redundant either way.

---

## Resolution

All 5 findings fixed (see `120-REVIEW-FIX.md` for full commit-by-commit detail):

- **WR-01**: fixed — `has()` now calls `recordQueriedClassIfActive`; added a regression test proving a `has()`-only unregistered-class query throws.
- **WR-02**: documented (no behavior change) — coverage bound (GameElement finder methods, first `startFlow()` traversal only) now called out in code comments on `recordQueriedClassIfActive` (game-element.ts), the `startFlow()` PIT-02 block (game.ts), and 120-03-SUMMARY.md.
- **WR-03**: fixed — `no-element-identity-comparison.ts` now resolves identifiers to their actual binding via the ESLint scope manager instead of matching by bare name; `no-element-array-state.ts` audited and confirmed already scoped per-declaration (documented, plus a regression fixture added to each rule's `.test.ts`).
- **WR-04**: fixed — added an exhaustiveness (`never`) guard to `walkFlowNodes`'s switch statement.
- **IN-01**: fixed — simplified the vacuous `propDef.key ? ... : undefined` ternary.

_Resolved: 2026-06-30_
_Fixer: Claude (gsd-code-fixer)_

---

_Reviewed: 2026-06-30_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
