# Phase 123: Determinism & Flow Introspection - Research

**Researched:** 2026-07-01
**Domain:** TypeScript game-engine internals — flow-state introspection, action/choice debug surfaces, deterministic PRNG threading
**Confidence:** HIGH (all claims verified directly against BoardSmith source; no external libraries involved)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

### Flow-Position Dump API (FLOW-01)
- API lives on the engine Game as `getFlowDebugInfo()` (peer of `debugActionAvailability`), surfaced through TestGame and integrated into `toDebugString()` — one source of truth all layers reuse
- Return shape: structured object (`{phase, step, path, awaiting}`) plus a `describe()`/formatted-string form — machine-branchable and human-readable
- `GameStuckError` and `assertActionAvailable` failure output embed the readable flow position automatically
- Also exposed via the existing dev-host `debug:*` WS op family (reuses the same structure)

### Choice & Pending-Action Introspection (FLOW-02/03)
- Disabled choices with reasons are included in the introspection surface (`getActionSpace`/`getSelectionChoices` results); the gameplay pick path stays filtered so a disabled choice can't be submitted
- PendingActionState exposed as a read-only snapshot getter on TestGame — `getPendingAction(seat)` returning current step, completed selections, accumulated args (not the raw mutable internal object)
- Pending-action state also surfaced via the existing `__BOARDSMITH_DEVTOOLS` bridge (v4.3 hard rule: introspection parity in browser)
- Naming/type placement at Claude's discretion — follow v4.3 introspection naming conventions (`getActionSpace` family)

### Determinism Enforcement (FLOW-04)
- `shuffle()` / space.ts RNG: default to the game's seeded RNG (`_ctx.random`); explicit rng param still accepted; if no seeded RNG is reachable, throw with an actionable message — never silently fall back to `Math.random`
- `playUntilComplete` is deterministic by default — PRNG seeded from a fixed default seed; `options.seed` varies it
- Auto-generated game seeds (game.ts:591, game-session.ts:520) stay, but the seed must be recorded/retrievable (state + logs) so any run is replayable after the fact
- Enforcement: engine-level guard + determinism regression test (same seed twice → identical command history); no new ESLint rule this phase

### Claude's Discretion
- Exact names/types for the flow-debug structure and pending-action snapshot (follow v4.3 `getActionSpace` family conventions)

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FLOW-01 | Developer can get a human-readable flow-position dump ("phase *pegging* → step *player-turn*, waiting on seat 2") via FlowState / `toDebugString()` | `debugActionAvailability()` pattern to mirror (game.ts:1237); new path-following walker design (Pattern 1); `FlowState.currentPhase` already tracked correctly by the engine — reuse rather than recompute; `GameStuckError`/`assertActionAvailable` already carry `flowState`, need the `describe()` string embedded |
| FLOW-02 | Developer can query disabled choices with their disable reasons (currently filtered out by `getPickChoices`) | `AnnotatedChoice.disabled` and `pick-handler.ts` forwarding (lines 239-241) already exist and are correct; gap is a convenient one-call TestGame/`getActionSpace`-family method, not a low-level filtering bug — see Summary nuance and Pitfall discussion |
| FLOW-03 | Developer can inspect mid-multi-step action state (`PendingActionState`) from TestGame | `PendingActionState` type (action/types.ts:137) and `PendingActionManager.getPendingAction()` (session layer) already exist; gap is exposing a read-only snapshot on `TestGame`, which currently has no pending-action accessor — see Pattern 2 and Open Question 2 |
| FLOW-04 | Seeded runs are deterministic end-to-end — no `Math.random` fallbacks in engine paths (space.ts:279, element-collection.ts:211) and `playUntilComplete` is deterministic by default | Both fallback sites confirmed by direct read; `Game.random` (seeded mulberry32) already threaded correctly through `_ctx.random` for the actually-used shuffle path; `playUntilComplete`'s rng default is the real gap; seed-and-record pattern already proven in `random-simulation.ts` to mirror |
</phase_requirements>

## Summary

This phase is pure internal-engineering work inside a single repo (no new dependencies, no external APIs). Everything needed already has a proven sibling pattern in the codebase from the v4.3 (Phase 116-122) introspection work: `debugActionAvailability()` / `debugAllActions()` on `Game` are the template for a new `getFlowDebugInfo()`; the `getActionSpace`/`getActionSchema` family is the template for how flow-debug should be exposed through `TestGame`; and the `__BOARDSMITH_DEVTOOLS` bridge (`GameShell.devtools.ts` → `DevHost.vue`) is a fully worked three-layer wiring example (payload builder → postMessage → `window.__BOARDSMITH_DEVTOOLS`) to extend rather than invent.

The determinism gap is narrower than the CONTEXT.md audit implied in one respect and confirmed in another: `Space.shuffleInternal()` (the only shuffle path actually used by every game and by MERC) already reads `this._ctx.random`, which is populated by every `Game` constructor with a seeded mulberry32 RNG (`src/engine/element/game.ts:592`) — the `?? Math.random` fallback only fires for a `Space` that is somehow disconnected from a game's context, which today should never happen for elements built through the normal tree (`super(ctx)` always propagates `random` down). `ElementCollection.shuffle(random = Math.random)` (`element-collection.ts:211`) is a **separate, currently-unused-in-repo** method (grep across BoardSmith + all `~/BoardSmithGames/*` + MERC shows zero callers) — it is public API surface with a silent-`Math.random`-default footgun, not an active runtime bug. Both must be fixed per FLOW-04, but the risk profile differs: `space.ts:279` needs a "throw if truly unreachable" guard (defense-in-depth), while `element-collection.ts:211` needs the default parameter removed entirely (nothing depends on the current default, so removing it is a clean break, not a migration). `playUntilComplete`'s `rng: () => number = Math.random` default (`src/testing/simulate-action.ts:297`) is the one *actually*-reachable non-deterministic default and is the FLOW-04 headline fix.

The `PendingActionState` type already exists fully-formed in `src/engine/action/types.ts:137` and is already tracked read/write by `PendingActionManager` (`src/session/pending-action-manager.ts`) with a `getPendingAction(playerPosition)` accessor already present on `GameSession` — but **not on `TestGame`**, which is the actual FLOW-03 gap. Likewise, `getSelectionChoices()` on `Game` (`game.ts:1015`) and `getChoices()` on `ActionExecutor` already return `AnnotatedChoice[]` with `disabled: string | false` per choice (the v2.8 disabled-reason machinery) and `pick-handler.ts`'s `getPickChoices()` already forwards `disabled` into the wire format (`ChoiceWithRefs.disabled`, lines 239-241) — so FLOW-02's gap is not "choices are filtered out" at the low level, but that there is **no convenient one-call TestGame method** to get action-space-with-disabled-choices without manually calling `getSelectionChoices` per selection name. Verify this nuance with the user/planner: CONTEXT.md's phrasing ("currently filtered out by getPickChoices") should be read as "not surfaced through a single ergonomic call," not "the disabled flag is dropped."

**Primary recommendation:** Add `Game.getFlowDebugInfo()` (mirrors `debugActionAvailability`) with a path-walking helper over `FlowDefinition.root` using `FlowPosition.path`; add `TestGame.getPendingAction(seat)` and `TestGame.getFlowDebugInfo()` passthroughs; add a `TestGame.getActionSpaceWithChoices(seat)`-style helper (or extend `getActionSpace`) that resolves disabled choices; fix the two RNG defaults (throw-on-unreachable for `space.ts`, remove-default for `element-collection.ts`); make `playUntilComplete` seed from a fixed default seed via `SeededRandom`, mirroring `random-simulation.ts`'s already-correct pattern; extend the `__BOARDSMITH_DEVTOOLS` bridge with `getFlowDebugInfo()` and `getPendingAction()`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Flow-position readable dump (FLOW-01) | Engine (`Game`) | Session/Testing (passthrough), Dev-host (devtools bridge) | `Game` owns `_flowEngine`/`_flowDefinition`; single source of truth per CONTEXT.md decision |
| Disabled-choice introspection (FLOW-02) | Engine (`ActionExecutor`/`Game`) | Session (`pick-handler.ts` gameplay path stays filtered) | Engine already computes `AnnotatedChoice.disabled`; session's live pick path must keep enforcing (not just displaying) |
| Pending-action snapshot (FLOW-03) | Session (`PendingActionManager`) | Testing (`TestGame` read-only getter) | `PendingActionManager` is the sole owner of live mutable pending state; TestGame must expose a snapshot, never the mutable object |
| Seeded RNG threading (FLOW-04) | Engine (`Game.random`, `Space.shuffleInternal`) | Testing (`playUntilComplete`, `random-simulation.ts`) | `Game` constructs and owns the seeded RNG; all consumers (shuffle, simulation) must read through it, never default to `Math.random` |
| Devtools parity exposure | UI (`GameShell.devtools.ts`) | Dev-host (`DevHost.vue` global) | Existing DEV-02 bridge pattern; additive fields only |

## Standard Stack

No new dependencies. This phase is 100% internal TypeScript engine/session/testing work in the existing BoardSmith `src/` tree.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| (none) | — | — | Internal-only phase; no package installs |

### Package Legitimacy Audit

Not applicable — this phase installs no external packages. Skipping the slopcheck/registry gate per the protocol's scope condition.

## Architecture Patterns

### System Architecture Diagram

```
                         ┌─────────────────────────────┐
                         │        Game (engine)        │
                         │                              │
  FlowPosition.path ───▶ │  getFlowDebugInfo()          │──▶ { phase, step, path,
  (from _flowEngine)     │  (NEW — mirrors              │     awaiting, describe() }
                         │   debugActionAvailability)   │
                         │                              │
  seat ──────────────────│▶ getSelectionChoices()       │──▶ AnnotatedChoice[]
                         │  (EXISTING — has .disabled)   │    { value, disabled }
                         │                              │
  this._ctx.random ──────│▶ Space.shuffleInternal()     │──▶ deterministic shuffle
  (seeded mulberry32,    │  (guard: throw if reachable   │    (never Math.random)
   set in constructor)   │   random is truly absent)     │
                         └─────────────┬────────────────┘
                                       │
                    ┌──────────────────┼───────────────────────┐
                    ▼                  ▼                       ▼
        ┌───────────────────┐ ┌─────────────────┐   ┌──────────────────────┐
        │  TestGame          │ │ GameSession      │   │ __BOARDSMITH_DEVTOOLS │
        │  (testing layer)   │ │ (session layer)  │   │ (dev-host bridge)      │
        │                    │ │                  │   │                       │
        │ getFlowDebugInfo() │ │ getPendingAction │   │ getFlowDebugInfo()     │
        │  (NEW passthrough) │ │  (ALREADY EXISTS │   │  (NEW — extend         │
        │ getPendingAction() │ │   via            │   │   DevtoolsStateMessage │
        │  (NEW passthrough  │ │  PendingAction   │   │   + GameShell.devtools │
        │   over runner.game)│ │  Manager)        │   │   .ts payload)         │
        │                    │ │                  │   │                       │
        │ playUntilComplete()│ │                  │   └──────────────────────┘
        │  (FIX: default     │ │                  │
        │   seeded rng, not  │ │                  │
        │   Math.random)     │ │                  │
        └────────┬───────────┘ └──────────────────┘
                 │
                 ▼
        GameStuckError.flowState  ──▶ embed getFlowDebugInfo().describe()
        assertActionAvailable()   ──▶ embed getFlowDebugInfo().describe()
        (both ALREADY carry flowState; ADD the readable describe() string to the message)
```

### Recommended Project Structure

No new files/folders are required as top-level primitives; extend existing files:

```
src/engine/
├── element/game.ts              # ADD: getFlowDebugInfo() (peer of debugActionAvailability at :1237)
├── element/space.ts             # FIX: shuffleInternal() random fallback (line 279)
├── element/element-collection.ts # FIX: shuffle() default param (line 211)
├── flow/
│   ├── types.ts                 # ADD: FlowDebugInfo type (phase/step/path/awaiting + describe())
│   ├── engine.ts                # possibly expose FlowDefinition access if not already public
│   └── describe-flow-position.ts # NEW: path-walking helper (see Pattern 1 below)
src/session/
├── pending-action-manager.ts    # NO CHANGE — getPendingAction() already exists
├── pick-handler.ts              # NO CHANGE to disabled-forwarding (already correct); verify only
src/testing/
├── test-game.ts                 # ADD: getFlowDebugInfo(), getPendingAction(seat)
├── simulate-action.ts           # FIX: playUntilComplete default rng; embed flow describe() in GameStuckError message
├── assertions.ts                 # FIX: embed flow describe() in assertActionAvailable() error message
├── random-simulation.ts          # REFERENCE PATTERN ONLY — already does seed-and-record correctly
src/ui/
├── components/GameShell.devtools.ts  # ADD: flowDebugInfo + pendingAction fields to DevtoolsStateMessage
├── components/GameShell.vue          # ADD: watch sources for the two new fields
├── global.d.ts                       # ADD: getFlowDebugInfo()/getPendingAction() to BoardsmithDevtools interface
src/cli/dev-host/
├── DevHost.vue                       # ADD: expose the two new methods on window.__BOARDSMITH_DEVTOOLS
```

### Pattern 1: Path-resolving flow-position walker (NEW — no existing sibling)

**What:** `FlowPosition.path: number[]` is an index stack into the `FlowNode` tree rooted at `FlowDefinition.root`. There is currently **no function that walks the tree following this index path** — the only existing tree-walker, `walkFlowNodes()` (`src/engine/flow/walk-flow-nodes.ts`), is a pre-order traversal that visits every node but does **not** correlate with a specific `FlowPosition.path`. `getFlowDebugInfo()` needs a **new**, path-following walker.

**When to use:** Any time a human/machine-readable description of "where in the flow are we" is needed — `getFlowDebugInfo()`, `GameStuckError` messages, `assertActionAvailable()` messages, devtools bridge.

**Example (to be written, no existing code — this is guidance, not a citation):**
```typescript
// src/engine/flow/describe-flow-position.ts (NEW FILE)
import type { FlowNode, FlowPosition, FlowState } from './types.js';

export interface FlowDebugInfo {
  /** Nearest enclosing named `phase` node's `config.name`, if any. */
  phase?: string;
  /** Nearest enclosing named `action-step`/`simultaneous-action-step`/other node's `config.name`, if any. */
  step?: string;
  /** Raw index path, for machine consumers that want exact position. */
  path: number[];
  /** Seat(s) currently awaited, mirrors FlowState.currentPlayer/awaitingPlayers. */
  awaiting: { currentPlayer?: number; awaitingPlayers?: number[] };
  /** Human-readable one-liner, e.g. "phase *pegging* -> step *player-turn*, waiting on seat 2". */
  describe(): string;
}

// Walk `root` following `position.path`, collecting the most specific named
// `phase` and the most specific named node overall (any BaseFlowConfig.name),
// so BOTH partially-named and unnamed flows degrade gracefully (fall back to
// node `type` when `config.name` is absent — never throw for missing names).
export function describeFlowPosition(
  root: FlowNode,
  position: FlowPosition,
  flowState: FlowState,
): FlowDebugInfo { /* ... */ }
```

**Key implementation note:** `PhaseConfig.name` is **required** (`name: string` — see `src/engine/flow/types.ts:203-204`, "required, displayed in UI") so every `phase` node always has a name. Other node configs (`SequenceConfig`, `ActionStepConfig`, etc.) have **optional** `name?: string` via `BaseFlowConfig` — most games do NOT set it today (verify via grep before assuming games have named their action-steps; if none do, the "step" in the example dump format `"step *player-turn*"` will need to fall back to the node's `type` string, e.g. `"step (action-step)"`, unless this phase also asks games to add names). **This is an open question for the planner** — see Open Questions below.

### Pattern 2: TestGame passthrough methods (mirrors existing `getFlowState()`/`getSnapshot()`)

**What:** `TestGame` already exposes thin passthrough methods that delegate to `this.game` (`src/testing/test-game.ts:128` `getFlowState()`, `:234` `getSnapshot()`, `:294` `getPlayerView()`). New `getFlowDebugInfo()` and `getPendingAction(seat)` should follow this exact shape — no new abstraction layer.

```typescript
// Pattern already established at test-game.ts:128
getFlowState(): FlowState | undefined {
  return this.game.getFlowState();
}
```

`getPendingAction(seat)` is slightly different: the pending-action state lives on **session** (`PendingActionManager`), not on `Game` directly — `TestGame` wraps a `GameRunner`, not a `GameSession`. Confirm whether `GameRunner` has (or needs) its own lightweight pending-action tracking, or whether `TestGame.doAction()` already routes through something pending-action-aware. **This needs verification during planning** — grep `TestGame` for `doAction` implementation and check whether multi-step actions in tests currently go through `PendingActionManager` at all, or through a different, session-free code path (`ActionExecutor.createPendingActionState` / `isPendingActionComplete` in `action.ts` look like they may be usable directly by `TestGame` without going through `GameSession`).

### Pattern 3: Seed-and-record pattern (already correct in `random-simulation.ts`)

**What:** `runSimulation()` in `src/testing/random-simulation.ts` already does the right thing: accepts an optional `seed`, generates one if absent, and **returns it** on `SimulationResults.seed` so any run is replayable (lines 37-42, 121-122). This is the exact pattern FLOW-04 wants applied to `playUntilComplete` and to `Game`'s own auto-seed generation.

```typescript
// Source: src/testing/random-simulation.ts (existing, verified pattern)
// "Base seed for the whole run... When omitted, a random base seed is
//  generated and returned on SimulationResults.seed so a run can still be replayed."
```

Apply the same shape to `playUntilComplete(testGame, options)`: default `options.seed` (not `options.rng`) to a fixed literal (e.g. `'playUntilComplete-default'`) when neither `seed` nor `rng` is supplied, construct a `SeededRandom`/`createSeededRandom` from it, and — per CONTEXT.md — vary via `options.seed`. Keep `options.rng` as an escape hatch for callers who want to inject a stub, but the *default* must not be `Math.random`.

### Anti-Patterns to Avoid
- **Building a parallel disabled-choice filter:** `AnnotatedChoice.disabled` and `pick-handler.ts`'s forwarding already exist and are correct — do not duplicate this logic in a new "introspection" path. Reuse `getSelectionChoices()`/`getChoices()`.
- **Exposing the mutable `PendingActionState` object directly:** CONTEXT.md is explicit — `TestGame.getPendingAction()` must return a read-only snapshot (e.g. spread-copy), never the live object a caller could mutate to corrupt session state.
- **Silently keeping `Math.random` as a "safe" default because nothing currently breaks:** `element-collection.ts:211`'s default is currently unreachable/unused, which makes it *easy* to leave as "harmless" — CONTEXT.md's decision is explicit that this must throw or require an explicit rng, not silently default.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Seeded PRNG | A new RNG implementation | `Game.random` (mulberry32, `createSeededRandom`) or `SeededRandom` class in `src/utils/random.ts` | Both already exist, both are already used correctly elsewhere (`Game` constructor, `random-simulation.ts`); a third implementation would fragment the determinism story |
| Disabled-choice computation | A new "why is this choice disabled" evaluator | `ActionExecutor.getChoices()` → `AnnotatedChoice.disabled` (already computed by the v2.8 disabled-selections work) | Already covers tutorial gates + selection-level disables; a parallel evaluator risks disagreeing with the live gameplay path |
| Flow tree traversal | A second full flow-node walker | Extend/adapt `walkFlowNodes()` generator pattern for path-following (new function, same style) | Reuse the established recursion shape (one `switch` per `FlowNode` variant with an exhaustiveness guard) rather than inventing new traversal conventions |

**Key insight:** Every piece FLOW-01/02/03/04 needs either already exists (just not exposed at the right layer) or has a proven sibling pattern from v4.3 to copy. The actual net-new code is small: one path-following flow walker, a handful of thin passthrough methods, and two RNG-default fixes.

## Common Pitfalls

### Pitfall 1: Assuming `FlowPosition.path` indices map 1:1 to "phase" boundaries
**What goes wrong:** A path index can point into any `FlowNode` type (sequence, loop, if, switch, action-step...), not just `phase`. Code that assumes "path[i] always corresponds to a named phase" will produce garbage or throw on ordinary nested-loop/switch flows.
**Why it happens:** `currentPhase` on `FlowState` (already tracked separately, `engine.ts:1454`/`:641`) is maintained by the engine as a *side effect* of entering/exiting `phase` nodes — it is NOT derived by walking `path` at read time. The path-walker for `getFlowDebugInfo()` is solving a *different* problem (giving a full breadcrumb, not just the current phase name) and must handle non-phase node types gracefully.
**How to avoid:** Reuse `FlowState.currentPhase` directly for the "phase" field (it's already correct and already tracked) — only build the *new* path-walker for the "step" / breadcrumb detail, don't recompute phase from scratch.
**Warning signs:** A implementation that ignores `FlowState.currentPhase` and tries to re-derive phase name purely from `path` + `root` will likely diverge from the engine's own bookkeeping on `each-player`/`for-each` re-entry (see `engine.ts:1474` restoring `previousPhase` from frame data — this frame-based bookkeeping is non-trivial to reimplement from the path alone).

### Pitfall 2: Named `step` fields don't exist in most game flows today
**What goes wrong:** The example dump format "step *player-turn*" implies `action-step` nodes are named. `BaseFlowConfig.name` is optional and, per a quick repo scan, is not consistently set by existing games (checkers, go-fish, cribbage). Building the dump format around "always have a step name" will produce `step *undefined*` or force a schema change to games.
**Why it happens:** `name` was added to `BaseFlowConfig` for serialization/debugging purposes generically, not enforced at authoring time except for `phase` (`PhaseConfig.name` is required).
**How to avoid:** Design `describe()` to fall back to the node's `type` (e.g., `action-step`) when `config.name` is absent, and treat "step" as best-effort, not guaranteed. Flag to the user whether games should be asked to add `name` to their `action-step` configs as part of this phase (adds authoring burden) or whether type-fallback is acceptable for v1.
**Warning signs:** Grep `~/BoardSmithGames/*/src/rules/*.ts` for `name:` inside flow builders before assuming names are already there.

### Pitfall 3: Conflating "seeded RNG is threaded" with "seed is retrievable/replayable"
**What goes wrong:** `Game.random` is already seeded and already deterministic per-run — but the CONTEXT.md decision explicitly also requires the seed itself be recorded/retrievable (`this._constructorOptions.seed` already stores it, and `StoredGameState.seed` already persists it in session — verify no gap remains) so a **specific auto-generated run** can be replayed after the fact, not just that re-running the same seed twice is deterministic.
**Why it happens:** These are two different guarantees: (a) determinism given a seed, and (b) discoverability of which seed a given past/auto-generated run used.
**How to avoid:** Confirm during planning that `TestGame`/`Game` expose a public "what seed did/does this game use" getter (there's no `game.getSeed()` method today — only internal `_constructorOptions.seed`, which is private-by-convention (underscore prefix) though not a TS `private` field). Add one if missing, per FLOW-04's "must be recorded/retrievable" clause.
**Warning signs:** If the only way to find a run's seed is to dig into a private-by-convention field or the stored-state blob, it isn't "retrievable" in the ergonomic sense CONTEXT.md intends.

### Pitfall 4: `element-collection.ts:211`'s `shuffle()` fix must not silently become dead code
**What goes wrong:** Because nothing in-repo calls `ElementCollection.shuffle()` today, a fix here (throw when no rng passed, or require an explicit param) has zero regression risk to existing games — but also zero test coverage forcing the fix to be exercised. It's easy to "fix" this without adding a regression test, and have the fix silently regress later.
**How to avoid:** Add an explicit unit test for `ElementCollection.shuffle()` requiring an rng arg (or throwing without one) as part of this phase's Wave 0/task list, since no existing test exercises this path (`grep -rn "\.shuffle(" src/engine/element/element-collection.test.ts` returns nothing today — confirm at planning time).

## Code Examples

### Existing `debugActionAvailability` pattern to mirror for `getFlowDebugInfo`
```typescript
// Source: src/engine/element/game.ts:1237 (existing, verified)
debugActionAvailability(actionName: string, player: P): ActionDebugInfo {
  const action = this._actions.get(actionName);
  if (!action) {
    return { actionName, available: false, reason: `Action '${actionName}' does not exist`, details: { /* ... */ } };
  }
  const trace = this._actionExecutor.traceActionAvailability(action, player);
  return this._formatActionDebugInfo(trace);
}
```

### Existing disabled-choice forwarding (already correct — do not rebuild)
```typescript
// Source: src/session/pick-handler.ts:239-241 (existing, verified)
if (disabled !== false) {
  choice.disabled = disabled;
}
```

### Existing devtools bridge wiring to extend (DEV-02 pattern)
```typescript
// Source: src/ui/components/GameShell.devtools.ts (existing, verified)
export function buildDevtoolsPayload(params: DevtoolsParams): DevtoolsStateMessage {
  return {
    source: 'shufflewick-game',
    type: 'boardsmith:devtools-state-update',
    seat: params.seat,
    state: params.state,
    availableActions: params.availableActions,
    actionMetadata: params.actionMetadata,
    boardInteraction: { /* ... */ },
    // ADD HERE: flowDebugInfo: params.flowDebugInfo, pendingAction: params.pendingAction,
  };
}
```

### Existing seed-and-record pattern to mirror in `playUntilComplete`
```typescript
// Source: src/testing/random-simulation.ts (existing, verified — comment at lines 36-42)
// "Base seed for the whole run. Per-game seeds are derived deterministically
//  from it, so re-running with the same base seed reproduces the same games.
//  When omitted, a random base seed is generated and returned on
//  SimulationResults.seed so a run can still be replayed."
```

### The two RNG-fallback sites requiring fixes
```typescript
// Source: src/engine/element/space.ts:279 (existing, needs fix per FLOW-04)
shuffleInternal(): void {
  const random = this._ctx.random ?? Math.random; // <- must throw with actionable message instead
  // ...
}

// Source: src/engine/element/element-collection.ts:211 (existing, needs fix per FLOW-04)
shuffle(random: () => number = Math.random): ElementCollection<T> { // <- remove default entirely
  // ...
}
```

### `playUntilComplete`'s current non-deterministic default
```typescript
// Source: src/testing/simulate-action.ts:297 (existing, needs fix per FLOW-04)
const rng = options?.rng ?? Math.random; // <- must default to a seeded rng, not Math.random
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Per-selection choice fetch via `getSelectionChoices()`/`getPickChoices()` only | Bulk `getActionSpace(seat)` for the whole legal action set (v4.3 INTRO-01) | v4.3 (2026-07-01) | FLOW-02's convenience layer should build on `getActionSpace`, not reinvent a bulk-fetch mechanism |
| No structured pending-action inspection | `PendingActionState`/`PendingActionManager.getPendingAction()` on session (v2.8-era, confirmed still current) | Pre-v4.3 | FLOW-03 is "expose to TestGame," not "build new" |
| No devtools bridge | `__BOARDSMITH_DEVTOOLS` window global (v4.3 DEV-02, Phase 119) | 2026-07-01 | FLOW-01/03 dev-host exposure is additive to this existing bridge |

**Deprecated/outdated:** None found — this is all live, current-generation (v4.3) code being extended, not legacy code being replaced.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Most existing game flows do not set `BaseFlowConfig.name` on non-`phase` nodes (only `PhaseConfig.name` is required) | Common Pitfalls #2 | If wrong (games already name their steps), the fallback-to-`type` design is unnecessary complexity — verify with a grep across `~/BoardSmithGames/*/src` before finalizing the dump format |
| A2 | `TestGame`/`GameRunner` does not currently route multi-step actions through `PendingActionManager` (that's session-only) | Pattern 2 | If wrong (there's an existing test-layer pending-action path this research missed), `TestGame.getPendingAction()` could reuse it directly instead of needing new plumbing — re-check `GameRunner`/`ActionExecutor.createPendingActionState` call sites during planning |
| A3 | There is no existing `game.getSeed()`/public seed-retrieval method beyond `_constructorOptions.seed` (convention-private) and `StoredGameState.seed` (session-persisted) | Common Pitfalls #3 | If wrong, FLOW-04's "seed must be retrievable" requirement may already be satisfied and needs no new getter |

**All three assumptions above are grep/read gaps that a planner or implementer should close in ~5 minutes each before writing tasks** — they are not speculative training-data claims, just areas where this research's file:line coverage stopped short of exhaustive verification.

## Open Questions

1. **Should `action-step`/`sequence`/other flow nodes be required to carry a `name` for a good "step" dump, or is type-fallback (`step (action-step)`) acceptable for v1?**
   - What we know: `PhaseConfig.name` is required; other configs' `name` is optional and appears largely unused today (A1 above).
   - What's unclear: Whether the "waiting on seat 2" example format in REQUIREMENTS.md implies games must be updated to name their steps (adds authoring scope/MIG-03 risk) or whether the planner should design a graceful type-based fallback.
   - Recommendation: Default to type-fallback for v1 (matches "no backward compat but also no unnecessary scope creep" project ethos); document the `name` field as recommended-but-optional in DOC-05 (Phase 130).

2. **Does `TestGame` need its own lightweight pending-action tracking, or should it delegate to a `GameSession`-free path via `ActionExecutor` directly?**
   - What we know: `PendingActionManager` (session-layer) is the only current owner of live pending-action state; `TestGame` wraps a bare `GameRunner`, not a `GameSession`.
   - What's unclear: Whether `TestGame.doAction()` for multi-step/repeating-selection actions already works today without going through `PendingActionManager` (i.e., some other mechanism), or whether multi-step actions are simply untested via `TestGame` today.
   - Recommendation: Planner should trace one `doAction()` call for a repeating-selection action through `TestGame` in the debugger/tests before deciding whether `getPendingAction()` needs new state-tracking machinery or is a one-line passthrough.

3. **Is a new ESLint rule truly out of scope, or would a plain grep/CI check for `Math.random` in `src/engine/` catch regressions cheaply?**
   - What we know: CONTEXT.md explicitly says "no new ESLint rule this phase," favoring an engine-level guard + regression test.
   - What's unclear: Nothing — this is a locked decision, not a gap. Listed here only so the planner doesn't second-guess it.
   - Recommendation: Follow the locked decision as-is; do not add lint tooling.

## Environment Availability

Skipped — this phase is pure `src/` code changes with no external tool/service/runtime dependencies beyond the existing Node/TypeScript/Vitest toolchain already used throughout the repo (verified present via `package.json` `"test": "vitest run"`).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (existing repo-wide config: `vitest.config.ts`) |
| Config file | `/Users/jtsmith/BoardSmith/vitest.config.ts` |
| Quick run command | `npx vitest run src/engine/flow src/session/pending-action-manager.test.ts src/testing/simulate-action.test.ts src/testing/play-until-complete.test.ts src/engine/element/element-collection.test.ts --silent` |
| Full suite command | `npm test` (`vitest run`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FLOW-01 | `getFlowDebugInfo()`/`describe()` produces correct phase/step/awaiting for nested flows (sequence/loop/each-player/phase) | unit | `npx vitest run src/engine/flow/describe-flow-position.test.ts` | ❌ Wave 0 (new file) |
| FLOW-01 | `GameStuckError`/`assertActionAvailable` error messages embed the readable flow position | unit | `npx vitest run src/testing/simulate-action.test.ts -t "GameStuckError"` and `src/testing/assertions.test.ts -t "assertActionAvailable"` | ✅ existing files, new test cases needed |
| FLOW-02 | `TestGame`-level helper surfaces disabled choices + reasons for a seat's full action space | unit | `npx vitest run src/testing/test-game.test.ts -t "disabled"` | ❌ Wave 0 (new test cases in existing file) |
| FLOW-02 | Gameplay pick path (`pick-handler.ts`) still rejects a disabled choice submission (regression, not new — confirm existing coverage) | unit | `npx vitest run src/session/pick-handler.test.ts` | ✅ existing (verify current coverage includes disabled-submission-rejected case) |
| FLOW-03 | `TestGame.getPendingAction(seat)` returns correct read-only snapshot mid multi-step action | unit | `npx vitest run src/testing/test-game.test.ts -t "getPendingAction"` | ❌ Wave 0 |
| FLOW-04 | `Space.shuffleInternal()` throws actionable error when no seeded rng reachable (constructed detached-context test) | unit | `npx vitest run src/engine/element/space.test.ts -t "shuffle"` | ❌ Wave 0 (verify file exists first — `ls src/engine/element/space.test.ts`) |
| FLOW-04 | `ElementCollection.shuffle()` requires explicit rng (no silent `Math.random` default) | unit | `npx vitest run src/engine/element/element-collection.test.ts -t "shuffle"` | ❌ Wave 0 (no existing shuffle test found) |
| FLOW-04 | `playUntilComplete` with same seed twice → identical command history (determinism regression test) | unit/integration | `npx vitest run src/testing/play-until-complete.test.ts -t "determinis"` | ❌ Wave 0 (new test case in existing file) |

### Sampling Rate
- **Per task commit:** targeted `npx vitest run <touched-file>.test.ts`
- **Per wave merge:** `npm test` (full suite — this phase touches shared engine primitives (`Space`, `ElementCollection`) used by every game, so full-suite regression checks are mandatory, not optional)
- **Phase gate:** Full suite green + all 7 `~/BoardSmithGames/*` and MERC unaffected (spot-check at minimum; full cross-repo migration is Phase 129, but a determinism/shuffle regression here would silently break every game's fairness — sanity-run at least one shuffle-heavy game, e.g. go-fish or cribbage, before calling this phase done)

### Wave 0 Gaps
- [ ] `src/engine/flow/describe-flow-position.ts` + `.test.ts` — new path-walking flow-debug helper (FLOW-01)
- [ ] Confirm `src/engine/element/space.test.ts` exists; if not, create it — no dedicated shuffle-fallback test found in this research pass
- [ ] `src/engine/element/element-collection.test.ts` — add shuffle-requires-rng test (none currently exists)
- [ ] `src/testing/play-until-complete.test.ts` — add same-seed-twice-identical-history regression test

*(If any of these already exist, confirm during planning rather than assuming — this research's file listing found `space.ts` but did not confirm a matching `.test.ts`.)*

## Security Domain

`security_enforcement` is absent from `.planning/config.json` — treated as enabled per protocol, but this phase has essentially no attack surface: it is internal debug/introspection tooling and a PRNG-determinism fix for game *fairness* (not cryptographic/security randomness), with no new network input, auth, or session boundary changes.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Not touched by this phase |
| V3 Session Management | No | Not touched by this phase |
| V4 Access Control | No | Not touched by this phase |
| V5 Input Validation | Marginal | `getFlowDebugInfo()`/`getPendingAction()` take a `seat` number param — reuse existing `getPlayer(seat)`/bounds-checking patterns already used by `getActionSpace`/`getActionSchema` (return `undefined`/empty rather than throw on out-of-range seat) |
| V6 Cryptography | No | The seeded PRNG (mulberry32) is explicitly for game-fairness/reproducibility, not security/cryptographic randomness — do not conflate; no crypto library needed here |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Devtools bridge (`__BOARDSMITH_DEVTOOLS`) leaking hidden info | Information Disclosure | Already dev-build-gated (`import.meta.env.DEV`/`isDevBuild`) and production-dead-code-eliminated — new `getFlowDebugInfo()`/`getPendingAction()` additions must stay inside the same guard, never exposed in production builds |
| Predictable PRNG seed exposing future game outcomes to a player | Information Disclosure (game-fairness, not security) | Out of scope for this phase — mulberry32 is not cryptographically secure and this is a known, accepted tradeoff already baked into `Game.random`; do not attempt to "fix" this as part of FLOW-04, which is about determinism/reproducibility, not unpredictability-hardening |

## Sources

### Primary (HIGH confidence — direct source-code reads in this session)
- `src/engine/flow/types.ts` — `FlowNode`, `FlowPosition`, `FlowState`, `PhaseConfig`, `BaseFlowConfig`
- `src/engine/element/game.ts` — `debugActionAvailability`, `debugAllActions`, `getActionSpace`, `getActionSchema`, `getSelectionChoices`, `getFlowState`, `getRandomState`/`setRandomState`, constructor RNG seeding (line 591-603)
- `src/engine/action/types.ts` — `PendingActionState`, `RepeatingSelectionState`, `ActionDebugInfo`
- `src/engine/element/action-metadata.ts` — `buildActionMetadata`, `buildPickMetadata` (confirms choices are fetched on-demand, not embedded in static metadata)
- `src/engine/element/space.ts` (line 279) — `shuffleInternal` RNG fallback
- `src/engine/element/element-collection.ts` (line 211) — `shuffle()` RNG default param
- `src/engine/flow/walk-flow-nodes.ts` — existing pre-order tree walker (reference pattern, not path-following)
- `src/session/types.ts`, `src/session/pending-action-manager.ts`, `src/session/game-session.ts`, `src/session/pick-handler.ts` — `PendingActionState` ownership and `getPendingAction`, `AnnotatedChoice.disabled` forwarding (lines 239-241)
- `src/testing/test-game.ts`, `src/testing/simulate-action.ts`, `src/testing/debug.ts`, `src/testing/random-simulation.ts`, `src/testing/assertions.ts` — `TestGame` passthrough pattern, `GameStuckError`, `playUntilComplete` rng default, seed-and-record pattern, `assertActionAvailable`
- `src/utils/random.ts` — `SeededRandom`, `createSeededRandom`
- `src/ui/components/GameShell.devtools.ts`, `src/ui/components/GameShell.vue`, `src/ui/global.d.ts`, `src/cli/dev-host/DevHost.vue` — `__BOARDSMITH_DEVTOOLS` bridge, full wiring
- `.planning/phases/123-determinism-flow-introspection/123-CONTEXT.md`, `.planning/REQUIREMENTS.md`, `.planning/STATE.md`, `.planning/ROADMAP.md` — locked decisions, requirement IDs, milestone context

### Secondary (MEDIUM confidence)
- None — no WebSearch/Context7 lookups were needed; this is 100% internal-codebase research with no external library or ecosystem questions.

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: N/A — no external packages
- Architecture: HIGH — every pattern cited was read directly from source with line numbers
- Pitfalls: HIGH — pitfalls derived from direct code reads (e.g. `name` field usage, `_constructorOptions` privacy), not speculation

**Research date:** 2026-07-01
**Valid until:** 30 days (stable internal codebase; re-verify if Phase 116-122's introspection surface changes before Phase 123 planning begins)
