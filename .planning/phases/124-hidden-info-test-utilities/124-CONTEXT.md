# Phase 124: Hidden-Info Test Utilities - Context

**Gathered:** 2026-07-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Developers can verify hidden information stays hidden — in test assertions and in the rendered DOM — without hand-parsing ElementJSON or manually inspecting markup. Covers VIS-01 (`isElementVisible`/`getVisibleElements` on TestGame), VIS-02 (view-diff utility), VIS-03 (DOM-leak test utility rendering the UI as seat N).

Scope: BoardSmith `src/testing/` (TestGame visibility methods, view-diff utility, DOM-leak renderer utility). Games adopt these in Phase 129 (migration), not here.

</domain>

<decisions>
## Implementation Decisions

### Visibility Assertion API (VIS-01/02)
- Visibility is computed from the SAME serialization path the wire uses (`toJSONForPlayer`/`getPlayerView` machinery) — assertions cannot drift from actual leak behavior (pit of success)
- `getVisibleElements(seat)` returns live engine elements (ElementCollection — queryable with the existing collection API), not serialized JSON
- `diffPlayerViews` returns a structured object (`{onlyInA, onlyInB, attributeDiffs}`-style) plus a readable `describe()` string — mirrors the Phase 123 FlowDebugInfo pattern
- Add assertion helpers `assertHidden`/`assertVisible` in testing/assertions with rich failure messages that embed what leaked and to which seat

### DOM-Leak Test Utility (VIS-03)
- Headless vitest utility in `boardsmith/testing` that mounts a UI component with a seat-filtered gameView (reuse BoardSmith's existing Vue component-test infrastructure)
- Forbidden identity markers are AUTOMATICALLY derived from the elements hidden from that seat (attribute values, data-* attributes, image paths) — no manual leak lists
- Attribute-focused matching with a configurable allowlist to avoid false positives (e.g. a legitimate "7" elsewhere in the UI)
- Prove in-repo against the AutoUI card renderer this phase; example games adopt the utility in Phase 129

### Visibility Semantics
- Three-state visibility model: **visible** (identity serialized) / **present-but-hidden** (element exists on the wire as a back/count but identity attrs excluded) / **absent** (not serialized at all)
- Spectator (seat 0) supported in all APIs
- Browser/devtools exposure: none this phase — testing-layer only

### Claude's Discretion
- Exact names/types — follow the v4.3 introspection family conventions (`getActionSpace`/`getPlayerView` naming style)

</decisions>

<code_context>
## Existing Code Insights

(From the verified 2026-07-01 audit + Phase 123 work.)

### Reusable Assets
- `TestGame.getPlayerView(seat)` — src/testing/test-game.ts:294 → `runner.getPlayerView` (PlayerStateView, perspective-filtered)
- `toJSONForPlayer` / element serialization visibility machinery in src/engine (the single source of truth for what each seat sees)
- Phase 123's `FlowDebugInfo` structured-object + `describe()` pattern (src/engine/flow/describe-flow-position.ts) — the shape to mirror for view diffs
- BoardSmith UI component tests (e.g. src/ui/components/auto-ui/renderers/*.test.ts) — existing Vue component-test infrastructure for the DOM-leak utility
- `anchorAttrs` emits data-bs-el-* attributes (v4.3) — relevant to attribute-based leak matching
- go-fish `no-hidden-info-leak.test.ts` (~/BoardSmithGames/go-fish) — the only existing hidden-info test; broadcast-message-focused, shows the developer intent this phase generalizes

### Established Patterns
- v4.3 introspection naming family: `getActionSpace`/`getActionSchema`/`getPlayerView`/`enumerateLegalMoves`
- Assertions with actionable failure output (Phase 123 embedded flow position into assertActionAvailable/GameStuckError)

### Integration Points
- src/testing/test-game.ts (new methods), src/testing/assertions.ts (new assertions), src/testing/index.ts (exports)
- AutoUI card renderer (in-repo proof target for the DOM-leak utility)

</code_context>

<specifics>
## Specific Ideas

- The catastrophic bug class this protects against: an agent-built card game rendering opponent card identity into the DOM (rank/suit/face-image attrs) even though the UI *looks* hidden
- Failure messages should read like: `Element Card#7H is visible to seat 2 (expected hidden): serialized attributes [rank, suit] present in seat 2's view`
- DOM-leak matcher should catch: attribute values, data-* attributes, and face-image URL fragments belonging to hidden elements

</specifics>

<deferred>
## Deferred Ideas

- Game-repo adoption of these utilities (go-fish/cribbage DOM-leak tests) — Phase 129 migration
- Devtools/browser exposure of visibility diffing — not needed; per-seat state already visible via seat switching

</deferred>
