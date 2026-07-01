# Phase 120: Authoring Pit-of-Success Guards - Research

**Researched:** 2026-07-01
**Domain:** Engine construction/start-time validation (fail-fast guards) + ESLint static analysis rules
**Confidence:** HIGH (all claims verified directly against current tree; no external libraries involved)

## Summary

The API design for PIT-01..04 is locked in `.planning/v4.3-API-DESIGN.md` (approved 2026-06-30). This research does NOT relitigate that design — it verifies every file:line anchor against the current tree (several have drifted since Phase 116 due to intervening Phases 117-119 adding code), maps the exact hook points and data shapes the implementer will touch, and surfaces concrete in-repo landmines (test call sites that will start throwing).

**Key drift:** All three `game.ts` anchors have shifted (+~70-130 lines) and two API names in the design doc's prose do not exist in the codebase (`game._flow` and `game.firstOf()`) — see `## Anchor Drift Table` below. The design *intent* is unaffected; only the literal line numbers/identifiers used in the design doc's prose need translation when planning tasks.

**Landmine:** PIT-01's unconditional throw will break 6 real (non-doc-comment) test call sites in this repo's own test suite (`loop({...})` without `maxIterations`) — these must be fixed in this phase or the suite goes red immediately. Two real games in `~/BoardSmithGames` already contain the exact identity-comparison and array-`.includes()` footguns PIT-04 targets (evidence, not in-scope to fix — Phase 121).

**Primary recommendation:** Implement PIT-01 as a pure builder-function change (self-contained, low risk). Implement PIT-02/PIT-03 as a single new private method on `Game` (e.g. `#validateFlowIntegrity()`) invoked from inside `startFlow()` — both need to walk `this._flowDefinition.root` (not `game._flow`, which doesn't exist) and both have a *dynamic-function* escape hatch that must be explicitly scoped out (documented limitation), matching the precedent already set for PIT-02's async limitation. Implement PIT-04 as syntactic-only (no type checker available — `eslint.config.mjs` sets `parserOptions.project: false`), file-local heuristics matching the existing 3 rules' style, and build first-ever `RuleTester` test infrastructure for `src/eslint-plugin/` (currently zero test coverage exists there).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| PIT-01 loop() construction throw | Engine (flow builders) | — | Pure function, no dependencies on Game instance |
| PIT-02 element-class registration check | Engine (Game.startFlow) | — | Needs live access to `_ctx.classRegistry` and the actual element tree/finder call sites during first traversal |
| PIT-03 action reachability check | Engine (Game.startFlow) | — | Needs live access to `_flowDefinition.root` (flow node tree) and `_actions` map |
| PIT-04 lint rules | Dev tooling (eslint-plugin) | — | Static analysis, runs outside the engine entirely, ships as a separate optional plugin consumers opt into |

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PIT-01 | `loop()` without `maxIterations` fails fast at construction | Verified current `devWarn` call site (`builders.ts:86-96`), confirmed no dual-behavior test exists to migrate, found 6 real call sites needing fixes |
| PIT-02 | `startFlow()` validates element-class registration, throws w/ actionable message | Verified `startFlow()` location, `classRegistry` storage, and confirmed the design doc's `game.firstOf()` does not exist (`game.first()` is the real name); found the single instrumentation choke point (`ElementCollection._finder`) |
| PIT-03 | `startFlow()` validates action reachability from `actionStep`, throws on unregistered, warns on unreachable-but-registered | Verified `FlowNode`/`ActionStepConfig` shape, confirmed a **partial** runtime check already exists at `engine.ts:1244-1260` (per-frame, not exhaustive) that PIT-03 must not conflict with/duplicate, and confirmed `actions` can be a function (static-walk blind spot) |
| PIT-04 | Two new ESLint rules for element-identity and element-array-state footguns | Verified existing 3 rules are 100% syntactic (no type info), confirmed zero existing test coverage for eslint-plugin rules, found two real matching footgun instances in `~/BoardSmithGames` as design validation |

## Anchor Drift Table

Every file:line anchor in the locked design doc, checked against the current tree (2026-07-01):

| Design doc anchor | Current reality | Drift | Notes |
|---|---|---|---|
| `src/engine/flow/builders.ts:85–96` (devWarn block) | Lines 85-96, **exact match** | None | `if (config.maxIterations === undefined) { ... devWarn(...) }` — line numbers are accurate as of today |
| `src/engine/flow/engine.ts:1045` (`DEFAULT_MAX_ITERATIONS`) | Constant declared at line **30**; consumed at line **1032** (`config.maxIterations ?? DEFAULT_MAX_ITERATIONS`) and checked at line **907** (`if (iterations > DEFAULT_MAX_ITERATIONS)`) | **Drifted** — no code at line 1045 relates to this constant | Verify current line before writing the plan's "leave this alone" note |
| `src/engine/element/game.ts:1426` (`game.startFlow()`) | Actual method at line **1554** | **Drifted +128 lines** | Method body is unchanged in shape: `if (!this._flowDefinition) throw; this._flowEngine = new FlowEngine(...); const state = this._flowEngine.start(); ...; return state;` |
| `game._flow` (used in PIT-03 prose: "via `game._flow`") | **Does not exist.** The field is `private _flowDefinition: FlowDefinition \| undefined` (set via `setFlow()`, read via public `getFlow()`) | **Name drift** | The flow tree to walk is `game.getFlow()!.root` (a `FlowNode`), not a field called `_flow` |
| `game.firstOf(Class)` (used in PIT-02 prose) | **Does not exist.** Actual API surface for class-scoped queries: `all(Class, ...)`, `first(Class, ...)`, `firstN(n, Class, ...)`, `last(Class, ...)`, `lastN(n, Class, ...)` — all defined on `GameElement`/`ElementCollection`, `Game extends GameElement` | **Name drift** | Plan tasks must instrument all 5 finder methods, not a nonexistent `firstOf` |
| `game.classRegistry` (used in PIT-02 prose) | **Does not exist as a public property.** Registry lives at `this._ctx.classRegistry` (a `Map<string, ElementClass>`), private context object | **Access path drift, not a blocker** | PIT-02 is implemented as a `Game` instance method, which has direct access to `this._ctx.classRegistry` — no new public API needed |
| `game.registerAction()` / `game.registerActions()` | Exist, but signatures differ slightly from design doc prose: `registerAction(action: ActionDefinition)` (takes ONE `ActionDefinition` object with a `.name` field, not `(name, config)`); `registerActions(...actions: ActionDefinition[])` (varargs, not array) | **Signature drift in error-message prose only** | Only matters for the exact wording of PIT-03's actionable throw message — use `this.registerActions(...)` phrasing, not `registerAction('name', {...})` |

**Planner action:** Use the "Current reality" column, not the design doc's literal numbers, when writing task descriptions. The design *decisions* (throw vs. warn, scope boundaries, disposition) are unaffected by this drift — only the line/identifier citations are stale.

## Hook Points (verified)

### PIT-01 — `src/engine/flow/builders.ts`, `loop()` function (lines 79-107)
Self-contained. Replace the `devWarn(...)` call (lines 88-95) with `throw new Error(...)`. No other code path calls this function's warn branch; `import { devWarn } from '../../utils/dev.js'` stays imported (used elsewhere — do not remove the import, verify no other unused-import lint failure results. `devWarn` itself is untouched — PIT-03's bidirectional check reuses it).

### PIT-02/PIT-03 — `src/engine/element/game.ts`, inside `startFlow()` (line 1554)
```typescript
startFlow(): FlowState {
  if (!this._flowDefinition) {
    throw new Error('No flow definition set');
  }
  // <-- new validation pass goes here, BEFORE creating FlowEngine,
  //     OR after engine.start() for PIT-02's "first traversal" semantics (see below)
  this._flowEngine = new FlowEngine(this, this._flowDefinition);
  const state = this._flowEngine.start();
  ...
}
```

**PIT-03 (action reachability) is a pure static tree walk — can run BEFORE `FlowEngine` is constructed:**
- `this._flowDefinition.root` is a `FlowNode` (discriminated union, `type` field uses **hyphenated** strings: `'sequence' | 'loop' | 'repeat' | 'each-player' | 'for-each' | 'action-step' | 'simultaneous-action-step' | 'switch' | 'if' | 'execute' | 'phase'`. The design doc's prose says `actionStep` — that's the *builder function name* (`actionStep()`), not the node's `.type` discriminant, which is `'action-step'`.
- Nodes nest via `.config.do` (single child: loop/repeat/each-player/for-each/phase), `.config.steps` (array: sequence), `.config.then`/`.config.else` (if), `.config.cases`/`.config.default` (switch, a `Record<string, FlowNode>`). A generic recursive walker must handle all 6 nesting shapes — **no existing generic tree-walk utility exists in the codebase**; must be written new.
- `ActionStepConfig.actions: string[] | ((context: FlowContext) => string[])`. **Landmine:** when `actions` is a function, it cannot be statically enumerated (no `FlowContext` exists before flow start). `~/BoardSmithGames/polyhedral-potions/src/rules/flow.ts:56,98` already uses this function form in production (`actions: (ctx) => ['draft', ...getAvailableAbilityActions(ctx)]`). PIT-03 must either (a) skip validation for function-typed `actions` fields (documented limitation, consistent with PIT-02's precedent) or (b) statically extract only string-literal-array elements from a function's array-literal return when the function body is a trivial `() => [...]` shape (fragile, not recommended). **Recommend (a).**
- `game.getAction(name)` (line 919, reads `this._actions.get(name)`) is the correct registered-action check.
- **Pre-existing partial runtime check** at `src/engine/flow/engine.ts:1244-1260`: when an `action-step` frame is actually *reached* during play, the engine already does `console.warn` (not `devWarn`, not deduped via the `devWarn` key registry — uses its own `Set<string> warnedUnknownActions`) for any `actionName` in that frame's `actions` list that has no registered `ActionDefinition`. This is NOT exhaustive (only fires for frames actually visited) and is NOT what PIT-03 requires (PIT-03 must validate the *entire* tree before the game starts, independent of which branches get visited). **The two checks are complementary, not overlapping** — do not remove the engine.ts warning; PIT-03 is an additional, earlier, and more complete pass.
- Bidirectional check (registered-but-unreferenced): iterate `game._actions` keys (needs a public-ish accessor — check `listActions()`/similar; found `[...this._actions.keys()]` used internally at line 927, likely already exposed as `getActionNames()` or similar public method — verify exact method name at implementation time) and diff against the collected referenced-names set; `devWarn` each unreferenced name (one key per action name, e.g. `devWarn('unreachable-action:${name}', ...)`).

**PIT-02 (element class registration) requires runtime instrumentation, not a pure static walk**, because element classes are referenced by imperative code running inside `do:`/`while:`/`fn:` closures (arbitrary JS), not by static tree data (unlike PIT-03's actionStep names). This means:
- "First `startFlow()` traversal" = the actual first execution pass through `FlowEngine.start()` (i.e., instrument, then call `this._flowEngine.start()`, not a pre-execution static walk).
- **Single instrumentation choke point found:** `src/engine/element/element-collection.ts`, private method `_finder(classNameOrFinder, ...)` (referenced from all of `all()`, `first()`, `firstN()`, `last()`, `lastN()` via the `isElementClass()` guard at lines 47/68/91/112/135). Wrapping/monkeypatching or adding a collection callback at this single method captures every class-scoped query regardless of which of the 5 finder methods was called — avoids patching 5 separate call sites.
- Practical approach: during the first `startFlow()` execution only, set a module/instance-level "recording" flag + `Set<ElementClass>`; on each `_finder` call with a defined `classNameOrFinder`, record the class; after `engine.start()` returns, diff recorded classes against `this._ctx.classRegistry` values, throw on first class whose `.name` is not a key in the registry. Turn off recording after the first traversal completes (must not impose ongoing overhead on every subsequent query — this is the "first traversal only" scope boundary already resolved as Design Decision D-04).
- **Note:** `Game.createElement()` (line 758-772) *already auto-registers* any class passed to it into `classRegistry` the moment an element of that class is instantiated (line 767-769). This means the only way a class ends up "used but unregistered" is if it's queried via `all()/first()/etc.` for a class that was NEVER instantiated during setup (e.g., a typo'd class reference, or a class defined but never actually created) — this narrows PIT-02's real-world blast radius considerably; it will rarely fire for classes that back real elements, only for genuine typos/dead-class references. Document this nuance for the planner so the "still starts correctly" positive test picks a realistic scenario (e.g., `game.all(Card)` after `Card` elements exist and were registered via normal `createElement`/`registerElements` flow).

## Standard Stack

No new dependencies. `@typescript-eslint/parser` (^8.52.0) and `eslint` (^9.39.2) are already devDependencies; PIT-04 uses only the plain `eslint` `Rule.RuleModule` type (same as all 5 existing rules) — **not** `@typescript-eslint/utils`' `ESLintUtils.RuleCreator`, since the existing rules don't use it and adding it would be an inconsistent pattern shift not requested by the design doc.

**Installation:** none required — no `npm install` needed for this phase.

## Package Legitimacy Audit

Not applicable — this phase installs no new packages.

## Architecture Patterns

### Recommended structure for PIT-02/03 implementation
```
src/engine/element/game.ts
├── startFlow()                          # existing, gains a call to the new validator(s)
├── #validateActionReachability()        # NEW: static tree walk, PIT-03, throws
└── (instrumentation wired through)      # NEW: PIT-02, wraps first engine.start() call
src/engine/element/element-collection.ts
└── _finder()                            # gains an optional recording hook (constructor-injected
                                          # callback or a module-level WeakMap<Game, Set<ElementClass>>)
```

### Pattern: Recursive FlowNode walker (new utility, needed for PIT-03)
No such utility exists yet. Write a small internal recursive function local to `game.ts` (or a new `src/engine/flow/walk-flow-nodes.ts` if reused elsewhere later) that switches on `node.type` and yields every `action-step`/`simultaneous-action-step` node found, handling all 6 nesting shapes (`do`, `steps`, `then`/`else`, `cases`/`default`).

```typescript
// Source: derived from src/engine/flow/types.ts FlowNode union (verified in this session)
function* walkFlowNodes(node: FlowNode): Generator<FlowNode> {
  yield node;
  switch (node.type) {
    case 'sequence':
      for (const step of node.config.steps) yield* walkFlowNodes(step);
      break;
    case 'loop':
    case 'repeat':
    case 'each-player':
    case 'for-each':
    case 'phase':
      yield* walkFlowNodes(node.config.do);
      break;
    case 'if':
      yield* walkFlowNodes(node.config.then);
      if (node.config.else) yield* walkFlowNodes(node.config.else);
      break;
    case 'switch':
      for (const child of Object.values(node.config.cases)) yield* walkFlowNodes(child);
      if (node.config.default) yield* walkFlowNodes(node.config.default);
      break;
    case 'action-step':
    case 'simultaneous-action-step':
    case 'execute':
      break; // leaf nodes
  }
}
```
This is a NEW pattern — verify against the real `FlowNode` union in `src/engine/flow/types.ts` at implementation time (re-read the file; it may have grown new node types since this research pass).

### Anti-Patterns to Avoid
- **Duplicating the engine.ts:1244-1260 runtime warning logic:** PIT-03 is a distinct, earlier, exhaustive check — do not try to "extend" the existing per-frame warning into an exhaustive one; it doesn't have access to the full tree structure at that point in execution (it only sees the current frame).
- **Assuming `game._flow` or `game.firstOf()` exist:** they don't (see Anchor Drift Table). Grep the current file before writing code, not just before writing the plan.
- **Type-aware ESLint assumptions:** Do not write PIT-04 rules assuming `context.getTypeChecker()`/`parserServices` are available — `eslint.config.mjs` sets `parserOptions.project: false` for this repo's own linting, and the *published* plugin cannot force downstream game projects to enable type-aware parsing (that would break "pit of success" — adding a new required `tsconfig.json` project reference to every consuming game's eslint config is a heavy, easy-to-misconfigure ask). Rules must degrade gracefully to syntactic heuristics with expected false negatives, exactly like the 3 existing rules.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| One-time dev warnings | New warning-dedup mechanism | `devWarn(key, message)` from `src/utils/dev.ts` | Already handles dedup-by-key and dev/prod gating; PIT-03's bidirectional check must reuse it |
| Flow tree traversal | Ad-hoc per-call-site recursion | The single `walkFlowNodes()` generator (write once, reuse for PIT-03; consider exporting for future flow-introspection needs) | Avoids 6 duplicated switch statements across the codebase |
| Element class filtering | New instanceof-check logic in PIT-02 | Hook the single `ElementCollection._finder()` choke point | All 5 finder methods (`all/first/firstN/last/lastN`) already funnel through it — one hook, not five |

**Key insight:** The engine already has narrow, well-defined seams (`_finder`, `_flowDefinition.root`, `_actions` Map) for both new validations — no new plumbing/architecture is needed, only two focused additions inside `game.ts` plus one small addition to `element-collection.ts`.

## Common Pitfalls

### Pitfall 1: PIT-01 breaks 6 real test call sites immediately
**What goes wrong:** Once `loop()` throws unconditionally without `maxIterations`, any test constructing a flow via `loop({...})` without that field fails at construction time (before the test body even runs).
**Why it happens:** These tests predate the PIT-01 requirement; `maxIterations` was optional and several tests never needed a bound (short-lived test flows).
**How to avoid:** Fix all 6 call sites **in this phase** (they are in this repo's own `src/` tree, not cross-repo — CONTEXT.md explicitly requires this: "fixed here only if they block the suite," and these WILL block the suite).
**Confirmed real (non-doc-comment) call sites missing `maxIterations`** (verified via brace-balanced scan of every `loop({` call in `src/`, 68 total occurrences, 13 flagged, 7 of which are JSDoc `@example` comments and don't need fixing):
- `src/engine/utils/dev-state.test.ts:76`
- `src/engine/flow/engine.test.ts:50` (asserts `node.type === 'loop'` — trivial fix, add `maxIterations: 10`)
- `src/engine/flow/engine.test.ts:174`
- `src/engine/flow/engine.test.ts:196`
- `src/engine/flow/engine.test.ts:1030`
- `src/engine/flow/engine.test.ts:1465`
**Warning signs:** Running `npm test` after landing PIT-01 without this fix will show 6+ new construction-time failures across `engine.test.ts` and `dev-state.test.ts`.

### Pitfall 2: PIT-03 static walk cannot see dynamic `actions` functions
**What goes wrong:** A game using `actionStep({ actions: (ctx) => [...] })` (real pattern, confirmed in `~/BoardSmithGames/polyhedral-potions`) will have that action-step silently skipped by a naive static walker, giving false confidence that "all actionStep-referenced actions are registered" when dynamic ones aren't checked.
**Why it happens:** Function-typed `actions` require a `FlowContext` that doesn't exist before `startFlow()`.
**How to avoid:** Explicitly document this as an accepted scope boundary (mirroring PIT-02's precedent) rather than attempting fragile static function-body analysis. Add a code comment at the validator referencing this limitation.
**Warning signs:** A game with only dynamic-actions actionSteps will get zero PIT-03 throws even with a typo'd action name inside the function body — expected, not a bug.

### Pitfall 3: PIT-04 rules will have real false negatives without type info
**What goes wrong:** `no-element-identity-comparison` cannot reliably tell `a === b` (numbers) apart from `card1 === card2` (GameElement footgun) without a type checker. A purely syntactic heuristic (e.g., "flag if either operand's declared type or class name matches a known-element pattern in this file") will miss cross-file cases and flag some false positives on ambiguous variable names.
**Why it happens:** No type-aware parsing configured project-wide (`parserOptions.project: false`), and the plugin can't require downstream consumers to change that.
**How to avoid:** Scope the heuristic narrowly and document the tradeoff explicitly in the rule's JSDoc/description (consistency with the honest-limitation pattern already established for PIT-02). Base the heuristic on: (a) `class X extends GameElement` / `extends <KnownSubclass>` declarations visible in the same file, cross-referenced against variable/parameter type annotations; (b) known collection-returning call expressions (`.all(...)`, `.first(...)`, etc.) assigned to a variable then later compared/`.includes()`'d.
**Warning signs:** RuleTester fixtures should include at least one intentional false-negative case (documented, not asserted as a failure) to make the limitation explicit to future maintainers.

### Pitfall 4: `src/eslint-plugin/` has zero existing test coverage
**What goes wrong:** There is no `RuleTester` usage anywhere in this codebase today — assuming test conventions exist to copy is wrong.
**Why it happens:** The 3 pre-existing rules (`no-network`, `no-timers`, `no-nondeterministic`) plus `no-eval`/`no-filesystem` were never given RuleTester specs.
**How to avoid:** This phase must create the FIRST `*.test.ts` files under `src/eslint-plugin/rules/` — there's no existing pattern to mirror beyond the rule *implementation* style. Use ESLint's built-in `RuleTester` from the `eslint` package (already a devDependency) — it works fine under Vitest since `vitest.config.ts` sets `globals: true` (RuleTester's default Mocha-style `describe`/`it` resolve to Vitest's globals with no extra config).
**Warning signs:** If a plan step assumes "mirror the existing rule tests," flag it — there are none to mirror; only the rule *implementations* have precedent.

## Code Examples

### Existing rule style to mirror (verified, `src/eslint-plugin/rules/no-nondeterministic.ts`)
```typescript
// Source: src/eslint-plugin/rules/no-nondeterministic.ts (read in full this session)
import type { Rule } from 'eslint';

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: { description: '...', recommended: true },
    messages: { someMessageId: 'Actionable message text.' },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) { /* AST match + context.report */ },
      NewExpression(node) { /* ... */ },
    };
  },
};
export default rule;
```
PIT-04's two rules should follow this exact shape: plain `Rule.RuleModule`, `meta.messages` keyed dict, `create(context)` returning an ESTree visitor object. For the auto-fixable `no-element-identity-comparison`, add `meta.fixable: 'code'` and a `fix(fixer)` callback in `context.report()` — none of the 5 existing rules currently use `fixable`, so this will be the first fixable rule in the plugin; consult ESLint's `RuleFixer` API docs directly (not present anywhere else in this repo to copy from).

### Registration pattern (verified, `src/eslint-plugin/index.ts`)
```typescript
// Source: src/eslint-plugin/index.ts (read in full this session)
import noElementIdentityComparison from './rules/no-element-identity-comparison.js';
import noElementArrayState from './rules/no-element-array-state.js';
// add both to `plugin.rules` map and `plugin.configs.recommended.rules` map,
// following the existing `'no-network': 'error'` pattern exactly.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `loop()` silently `devWarn`s on missing `maxIterations` | Construction-time throw | This phase (PIT-01) | Breaking change; 6 in-repo test call sites need fixing |
| No pre-flight validation of element classes/actions | `startFlow()` validates both | This phase (PIT-02/03) | New failure mode at game-start time; games with real bugs will now fail loud instead of silently misbehaving |
| 5 syntactic-only lint rules (network/timers/nondeterminism/eval/filesystem) | 7 rules, 2 new element-aware ones | This phase (PIT-04) | First fixable rule in the plugin; first RuleTester test infra |

**Deprecated/outdated:** The `devWarn('loop-no-max:...')` call site in `builders.ts` is removed entirely per the No-Backward-Compat hard rule — no flag, no opt-out.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The exact public method name for enumerating registered action names (used for PIT-03's bidirectional devWarn) is not confirmed beyond `[...this._actions.keys()]` seen inline at `game.ts:927` inside another method — a dedicated public accessor may or may not already exist under a different name. | Hook Points — PIT-03 bidirectional check | If no public accessor exists, the implementer adds one trivially (`getActionNames()`); low risk, ~2 min fix, does not change task scope materially |
| A2 | The recommended instrumentation approach for PIT-02 (hook `ElementCollection._finder`) assumes `Game extends GameElement` and thus shares the same `all/first/firstN/last/lastN` → `_finder` code path as regular elements; not independently re-verified that `Game`'s own class doesn't override these methods separately. | Hook Points — PIT-02 | If `Game` has its own override, the hook must be duplicated or moved to a shared base; verify with a quick grep for `all(` overrides in `game.ts` at implementation time before committing to the single-hook design |

## Open Questions

1. **Should PIT-02's instrumentation window include `FlowDefinition.setup()`?**
   - What we know: `startFlow()` calls `this._flowEngine.start()`, and `FlowDefinition.setup` is invoked as part of engine startup (per `FlowDefinition` interface in `types.ts`), likely before the first node executes.
   - What's unclear: Whether class-scoped queries made inside `setup(context)` (which runs once, synchronously, before the flow tree begins) should be included in the "first traversal" instrumentation window.
   - Recommendation: Include it — `setup()` runs as part of the same `engine.start()` call the recording window wraps, so it will be captured naturally by the proposed instrumentation approach without special-casing.

2. **Exact wording/format for the PIT-02/PIT-03 error messages given the corrected API names.**
   - What we know: Design doc gives message templates using `game.registerElements([${className}])` and `game.registerAction('${actionName}', {...})`/`registerActions([...])`.
   - What's unclear: `registerElements` and `registerAction`/`registerActions` are declared `protected` on `Game` (verified: `protected registerElements(...)`, need to verify `registerAction`/`registerActions` protection level too — not confirmed in this pass, only their signatures were read). If protected, the error message's suggested fix is still valid (subclass authors calling from their own constructor, which is exactly the intended usage), but worth a quick double-check at implementation time.
   - Recommendation: Verify `registerAction`/`registerActions` access modifiers at implementation time; adjust message wording only if they turn out to be `private` (unlikely given the design doc's calling convention assumes constructor access).

## Environment Availability

Skipped — this phase has no external tool/service dependencies beyond the existing Node/npm/vitest/eslint toolchain already verified present and in use throughout this repo (`package.json`, `vitest.config.ts`, `eslint.config.mjs` all read and confirmed functional in this session).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (via `vitest run`, `globals: true`, `environment: 'node'`) |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run src/engine/flow/builders.test.ts src/engine/element/game.test.ts src/eslint-plugin -t <pattern>` (adjust per new test files created) |
| Full suite command | `npm test` (= `vitest run`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PIT-01 | `loop()` without `maxIterations` throws at construction | unit | `npx vitest run src/engine/flow/builders.test.ts` | ❌ Wave 0 — no `builders.test.ts` exists yet; `loop()` is currently only exercised indirectly via other test files' flow construction |
| PIT-01 | `loop({ maxIterations: N, ... })` still constructs normally | unit | same file | ❌ Wave 0 |
| PIT-01 | 6 pre-existing real call sites updated to include `maxIterations` | regression | `npm test` (full suite must stay green) | N/A — fix existing tests, no new file |
| PIT-02 | `startFlow()` throws naming the unregistered class when an unregistered class is queried via `all`/`first`/etc. during first traversal | unit | `npx vitest run src/engine/element/game.test.ts -t "PIT-02"` | Verify `game.test.ts` exists (likely does, given `game.ts` is large); add new `describe` block if so |
| PIT-02 | A correctly-registered game still starts without throwing (positive/non-regression test) | unit | same | Same file |
| PIT-03 | `startFlow()` throws naming the action when an `actionStep` references an unregistered action name (static array form) | unit | `npx vitest run src/engine/element/game.test.ts -t "PIT-03"` | Same file |
| PIT-03 | `startFlow()` emits `devWarn` (not throw) for a registered action with no referencing `actionStep` | unit | same | Same file; assert via spying on `console.warn` (devWarn's transport) or the `_clearShownWarnings()`/dedup exposed in `src/utils/dev.ts` |
| PIT-03 | A correctly-wired game still starts without throwing (positive test) | unit | same | Same file |
| PIT-04 | `no-element-identity-comparison`: valid/invalid fixtures + auto-fix output assertion | unit (RuleTester) | `npx vitest run src/eslint-plugin/rules/no-element-identity-comparison.test.ts` | ❌ Wave 0 — first RuleTester file in this repo |
| PIT-04 | `no-element-array-state`: valid/invalid fixtures (no auto-fix to assert) | unit (RuleTester) | `npx vitest run src/eslint-plugin/rules/no-element-array-state.test.ts` | ❌ Wave 0 |
| PIT-04 | Both rules registered and reachable via `boardsmith/recommended` config | unit | `npx vitest run src/eslint-plugin/index.test.ts` (or fold into one of the above) | ❌ Wave 0 — no `index.test.ts` exists |

### Sampling Rate
- **Per task commit:** run the specific new/modified test file(s) listed above.
- **Per wave merge:** `npm test` (full suite) — required given PIT-01's blast radius across `engine.test.ts`/`dev-state.test.ts`.
- **Phase gate:** Full suite green (`npm test`) plus `npm run lint` (to confirm the two new rules don't themselves violate the repo's own eslint config, and that `no-shadow` pre-existing 3 errors remain the only pre-existing failures per CONTEXT.md) before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `src/engine/flow/builders.test.ts` — new file, covers PIT-01 (currently `loop()` has no dedicated unit test file; it's only exercised transitively)
- [ ] RuleTester test infra in `src/eslint-plugin/` — first-ever test files there; no existing pattern, must establish convention (plain `eslint` `RuleTester`, not `@typescript-eslint/rule-tester`, to avoid adding a new dependency for one feature)
- [ ] Confirm whether `src/engine/element/game.test.ts` exists and its current size/structure before adding PIT-02/03 `describe` blocks (verify at implementation time — not confirmed by filename existence check in this research pass)
- [ ] Fix 6 real `loop({...})` call sites lacking `maxIterations` (listed under Common Pitfalls #1) — required for the full suite to stay green after PIT-01 lands

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | No | N/A — this phase touches only engine construction-time validation and static lint rules, no auth surface |
| V3 Session Management | No | N/A |
| V4 Access Control | No | N/A |
| V5 Input Validation | Marginal — PIT-02/03 are themselves a form of authoring-time input validation (validating game-definition "input" from the game author, not end-user/runtime input) | No library needed; hand-rolled throw with actionable message is correct here (these are developer-facing errors at author time, not runtime security boundaries) |
| V6 Cryptography | No | N/A |

### Known Threat Patterns for this stack
Not applicable — this phase has no network/auth/crypto/user-input surface. It hardens the game-authoring developer experience, not a runtime attack surface.

## Sources

### Primary (HIGH confidence — all verified directly against the repository in this session)
- `.planning/v4.3-API-DESIGN.md` (PIT section, lines 652-776) — locked design spec
- `.planning/phases/120-authoring-pit-of-success-guards/120-CONTEXT.md` — locked decisions, in-scope boundary
- `.planning/phases/116-verification-api-design/116-RESEARCH.md` (lines 420-470) — original DSGN-01 evidence for PIT-01..04
- `.planning/REQUIREMENTS.md` (lines 41-44, 104-107) — requirement text and phase mapping
- `src/engine/flow/builders.ts` (read in full for `loop()`, lines 60-115)
- `src/engine/flow/engine.ts` (grepped/read for `DEFAULT_MAX_ITERATIONS`, action-step execution at lines 1225-1330)
- `src/engine/flow/types.ts` (read in full — `FlowNode` union, `ActionStepConfig`, `FlowDefinition`)
- `src/engine/element/game.ts` (read `startFlow()` at 1554-1571, `registerElements`/`createElement` at 700-795, `_actions`/`registerAction`/`getAction` at 473-935)
- `src/engine/element/game-element.ts` (read `all()`/`first()` overloads, lines 380-470)
- `src/engine/element/element-collection.ts` (grepped `_finder`/`isElementClass` choke points, lines 30-135, 417)
- `src/eslint-plugin/index.ts` (read in full — registration pattern)
- `src/eslint-plugin/rules/no-nondeterministic.ts` (read in full — rule implementation style)
- `eslint.config.mjs` (read in full — confirmed `parserOptions.project: false`, no type-aware linting)
- `vitest.config.ts` (read — confirmed `globals: true`, RuleTester compatibility)
- `src/utils/dev.ts` (read in full — `devWarn`/`isDevMode`/`_clearShownWarnings` API)
- `package.json` (grepped devDependencies — `eslint@^9.39.2`, `@typescript-eslint/parser@^8.52.0`, `@typescript-eslint/eslint-plugin@^8.52.0`, no `@typescript-eslint/rule-tester` or `@typescript-eslint/utils`)
- Cross-repo evidence (read-only, not modified): `~/BoardSmithGames/polyhedral-potions/src/rules/flow.ts` (dynamic `actions` function usage), `~/BoardSmithGames/polyhedral-potions/src/rules/actions.ts:310,329` (real `die2 !== die1` identity comparison and `.includes(draftedDie)` footgun instances), `~/BoardSmithGames/checkers/src/rules/actions.ts` (`Player` identity comparisons, `Player extends GameElement` confirmed at `src/engine/player/player.ts:79`)

### Secondary (MEDIUM confidence)
None — no web research was needed for this phase; entirely a codebase-verification task against a locked internal design doc.

### Tertiary (LOW confidence)
None.

## Metadata

**Confidence breakdown:**
- Anchor/API verification: HIGH — every claim checked via Read/Bash grep against the live tree this session
- Hook-point design (PIT-02 instrumentation, PIT-03 tree walker): HIGH for the "what exists" facts, MEDIUM for the specific implementation approach recommended (a reasonable design given the constraints, but the design doc left implementation mechanics open — this is guidance, not a locked decision)
- PIT-04 lint heuristic feasibility: HIGH confidence that type-aware linting is unavailable; MEDIUM confidence on the specific syntactic heuristic recommended (reasonable given constraints, but heuristic design has inherent tradeoffs the planner/implementer should sanity-check against a few real fixtures before committing)

**Research date:** 2026-07-01
**Valid until:** 14 days (fast-moving — Phases 117-119 already caused ~130 lines of drift in `game.ts` in a short window; re-verify anchors if planning is delayed)
