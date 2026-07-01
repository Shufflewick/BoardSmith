---
phase: 120-authoring-pit-of-success-guards
fixed_at: 2026-06-30T23:45:00Z
review_path: .planning/phases/120-authoring-pit-of-success-guards/120-REVIEW.md
iteration: 1
findings_in_scope: 5
fixed: 5
skipped: 0
status: all_fixed
---

# Phase 120: Code Review Fix Report

**Fixed at:** 2026-06-30T23:45:00Z
**Source review:** .planning/phases/120-authoring-pit-of-success-guards/120-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 5
- Fixed: 5
- Skipped: 0

## Fixed Issues

### WR-01: PIT-02 does not record `.has()` queries

**Files modified:** `src/engine/element/game-element.ts`, `src/engine/element/game.test.ts`
**Commit:** `5caa707`
**Applied fix:** Added `recordQueriedClassIfActive(this._ctx, classNameOrFinder)` as the first line of `has()`, mirroring the other five finders (`all`/`first`/`firstN`/`last`/`lastN`). Added `UnregisteredHasQueryGame` + a new test to the `PIT-02` describe block in `game.test.ts` proving a class queried only via `has()` during the first `startFlow()` traversal now triggers the unregistered-class throw. All 5 PIT-02 tests pass.

### WR-02: PIT-02 recording bypassed for `ElementCollection`-direct queries (documentation only)

**Files modified:** `src/engine/element/game-element.ts`, `src/engine/element/game.ts`, `.planning/phases/120-authoring-pit-of-success-guards/120-03-SUMMARY.md`
**Commit:** `5caa707` (same commit as WR-01 — both touch the PIT-02 recording mechanism)
**Applied fix:** No runtime behavior changed. Added a documented-limitation block to the JSDoc on `recordQueriedClassIfActive` (game-element.ts) and expanded the PIT-02 comment in `startFlow()` (game.ts) explaining that PIT-02 covers the `GameElement` finder methods only, during the first `startFlow()` traversal — queries made directly on an `ElementCollection` (e.g. `board.children.all(Foo)`, which has no `_ctx` linkage) and post-start/async queries are NOT covered by design. Added a matching limitation note to `120-03-SUMMARY.md`.

### WR-03: ESLint rules matched GameElement-typed variables by bare name, not scope

**Files modified:** `src/eslint-plugin/rules/no-element-identity-comparison.ts`, `src/eslint-plugin/rules/no-element-identity-comparison.test.ts`, `src/eslint-plugin/rules/no-element-array-state.ts`, `src/eslint-plugin/rules/no-element-array-state.test.ts`
**Commit:** `02d2ddd`
**Applied fix:** In `no-element-identity-comparison.ts`, replaced the file-wide bare-name `Set<string>` (`elementVarNames`/`elementArrayVarNames`) with `Set<object>` tracking the actual declaration Identifier AST nodes, and added `resolveDeclNodes()` which resolves a used Identifier to its bound variable via the ESLint scope manager (`sourceCode.getScope(node)` + the resolved `Reference`) before checking node-identity membership. This means two unrelated same-named variables in different functions (e.g. a `Card`-typed `card` in one function, a `string`-typed `card` in another) are no longer conflated. Updated the rule's JSDoc to describe the scope-resolution mechanism, and added a `RuleTester` VALID fixture proving the false-positive is gone. Audited `no-element-array-state.ts` and confirmed it does NOT have the same bug — its checks (`PropertyDefinition` type annotation, assignment call shape) are already scoped per-declaration/per-site rather than aggregated by bare name — so only a documentation note plus a confirming regression fixture were added there, no logic change. All 16 eslint-plugin tests pass (7 + 9).

### WR-04: `walkFlowNodes` has no exhaustiveness guard

**Files modified:** `src/engine/flow/walk-flow-nodes.ts`
**Commit:** `090f32b`
**Applied fix:** Added a `default` case to the `switch (node.type)` with `const _exhaustive: never = node; return _exhaustive;`, turning a future missed `FlowNode` variant into a compile-time TypeScript error instead of a silent runtime gap. Confirmed `npx tsc --noEmit -p .` reports no errors in this file, and all 92 `src/engine/flow` tests pass.

### IN-01: Vacuous conditional in `no-element-array-state.ts`

**Files modified:** `src/eslint-plugin/rules/no-element-array-state.ts`
**Commit:** `9f5a8c3`
**Applied fix:** Simplified `resolveArrayElementTypeName(propDef.key ? (propDef as { typeAnnotation?: unknown }).typeAnnotation : undefined)` to `resolveArrayElementTypeName((propDef as { typeAnnotation?: unknown }).typeAnnotation)`. No behavior change (`propDef.key` is always truthy for a valid `PropertyDefinition`, and the callee already guards an absent `typeAnnotation`).

## Skipped Issues

None — all 5 in-scope findings were fixed.

## Verification

Full suite + lint run after all 5 fixes were applied:

```
npx vitest run
Test Files  138 passed (138)
     Tests  1872 passed (1872)
```

1872 = 1869 baseline + 3 new tests added by these fixes (WR-01's `has()`-only-query regression test, WR-03's two `RuleTester` VALID scope-hygiene fixtures).

```
npm run lint
src/engine/element/game.ts
  450:3  warning  Unused eslint-disable directive (pre-existing)

src/ui/composables/useAnimationEvents.ts
  343:74  error  'options' is already declared in the upper scope (pre-existing @typescript-eslint/no-shadow)

src/ui/composables/useFlyingElements.ts
  585:34  error  'currentTime' is already declared in the upper scope (pre-existing @typescript-eslint/no-shadow)
  592:21  error  'cardIndex' is already declared in the upper scope (pre-existing @typescript-eslint/no-shadow)

✖ 4 problems (3 errors, 1 warning)
```

Baseline confirmed unchanged: exactly the 3 pre-existing `no-shadow` errors + 1 pre-existing `game.ts:450` warning, none introduced by this fix pass.

`npx tsc --noEmit -p .` was scoped-checked against every file touched by these fixes (`game-element.ts`, `game.ts`, `game.test.ts`, `walk-flow-nodes.ts`, `no-element-identity-comparison.ts`, `no-element-array-state.ts`, and both `.test.ts` files) — no errors attributable to these changes. The full project `tsc --noEmit -p .` run has a number of pre-existing errors in unrelated test files (e.g. `session/teaching.test.ts`, `ui/composables/anchorAttrs.test.ts`) that predate this fix pass and are out of scope.

---

_Fixed: 2026-06-30_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
