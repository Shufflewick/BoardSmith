# Phase 123: Determinism & Flow Introspection - Context

**Gathered:** 2026-07-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Developers get accurate, human-readable insight into flow state, disabled choices, and mid-action state, and seeded runs are fully deterministic end-to-end — the foundation later test-utility and dev-host phases build on. Covers FLOW-01 (flow-position dump), FLOW-02 (disabled-choice reasons), FLOW-03 (PendingActionState inspection), FLOW-04 (no Math.random fallbacks; deterministic playUntilComplete).

Scope: `src/engine/` (flow state, RNG paths), `src/session/` (PendingActionState, pick-choice filtering), `src/testing/` (`playUntilComplete` determinism, toDebugString integration).

</domain>

<decisions>
## Implementation Decisions

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

</decisions>

<code_context>
## Existing Code Insights

(From the verified 2026-07-01 agent-ergonomics audit — file:line evidence confirmed against the codebase.)

### Reusable Assets
- `debugActionAvailability()` / `debugAllActions()` — src/engine/element/game.ts:1237,1271 (structured ActionDebugInfo; the pattern to mirror for flow debug)
- v4.3 introspection family: `getActionSpace`/`getActionSchema`/`buildActionArgs`/`enumerateLegalMoves`/`getPlayerView`
- `toDebugString()` — src/testing/debug.ts:51 (prints players/tree; missing flow position)
- `GameStuckError` — src/testing/simulate-action.ts (structured error with flowState field, ready to embed readable position)
- `AnnotatedChoice` disabled-reason machinery already exists (v2.8) — engine annotates; only the exposure filters it out
- `__BOARDSMITH_DEVTOOLS` bridge + dev-host `debug:*` WS ops (v4.3) — extension points for parity

### Established Patterns
- FlowPosition is a raw path-index structure — src/engine/flow/types.ts:38; FlowState (types.ts:240) carries currentPlayer/awaitingPlayers/currentPhase
- `getPickChoices` filters disabled choices out — src/session/pick-handler.ts:200-265
- PendingActionState — src/session/types.ts:21 (internal, not exposed to tests)

### Integration Points / Known Fallback Sites
- `this._ctx.random ?? Math.random` — src/engine/element/space.ts:279
- `shuffle(random = Math.random)` — src/engine/element/element-collection.ts:211
- Auto-seed generation — src/engine/element/game.ts:591, src/session/game-session.ts:520
- `playUntilComplete` default `rng = Math.random` — src/testing/simulate-action.ts

</code_context>

<specifics>
## Specific Ideas

- Readable flow dump example format from requirements: "phase *pegging* → step *player-turn*, waiting on seat 2"
- Determinism regression test shape: run the same seeded game twice, assert identical command histories
- Error message for missing RNG must be actionable (tell the developer to attach the element to a game or pass an rng)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
