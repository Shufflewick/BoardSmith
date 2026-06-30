# Phase 118: Test Ergonomics - Context

**Gathered:** 2026-06-30
**Status:** Ready for planning
**Source:** Locked design contract (`.planning/v4.3-API-DESIGN.md`, approved 2026-06-30) + Phase 117 introspection primitive

<domain>
## Phase Boundary

A test author can read state, drive games to completion, and assert availability without parsing snapshot JSON or dropping to low-level selection plumbing — with failures that explain themselves. All work lives in `src/testing/` (TestGame ergonomics) plus the supporting engine/session surface already shipped in Phase 117 (`getActionSpace`, `enumerateLegalMoves`, `getPlayerView`).

Covers: TEST-01..05. Excludes: devtools/browser (Phase 119), authoring guards (Phase 120), migration (Phase 121), docs (Phase 122). TEST-F1 (first-class leak assertion) is DEFERRED per design doc Part 3.
</domain>

<decisions>
## Implementation Decisions

All surface decisions are **locked** in the approved design doc (Part 2 TEST section). Build to it exactly. Per-surface dispositions:

### TEST-01 — Typed observable state access
- EXPOSE/DOCUMENT existing `testGame.getPlayerView(seat)` (`src/testing/test-game.ts:243`) plus a thin typed accessor so a test author reads observable state without parsing snapshot JSON or knowing per-game accessor methods. Reuse the Phase 117 perspective view; do not build a parallel filter. Owning module: testing.

### TEST-02 — `playUntilComplete(testGame, options?)`
- BUILD new function in `src/testing/`. Options: `maxMoves` (default 1000), `strategy` ('random' default | 'first'), `rng` (injectable, default Math.random). Returns `void`; throws `GameStuckError` (with `iteration`, `availableActions`, `flowState`, and an actionable message) when `maxMoves` exceeded. MUST drive moves via the Phase 117 `enumerateLegalMoves` primitive — do not hand-roll move enumeration.

### TEST-03 — Assertion failure trace
- BUILD: wire `game.debugActionAvailability()` (`game.ts:1072`) into the existing `assertActionAvailable(testGame, seat, name)` (`src/testing/assertions.ts:180`) so a failed availability assertion automatically includes *why* the action is unavailable (which selection/condition failed). Signature unchanged — behavior change only. Per D-05, use `debugActionAvailability()`, NOT the possibly-stale `traceAction()` in debug.ts.

### TEST-04 — Permissive vs exact action-list assertions
- BUILD: extend existing `assertFlowState(testGame, expected)` (`src/testing/assertions.ts:64`) with an `actionsMode` option. Per D-06, default is `'exact'` (only-these — backward compatible with current implicit behavior); `'contains'` (permissive) must be opted into explicitly.

### TEST-05 — Multi-step selection builder
- BUILD a new `ActionBuilder` (a.k.a. `MultiStepAction`) helper class in `src/testing/action-builder.ts` so a test author drives multi-step / dependent selections ergonomically rather than via low-level `resolveChoices` / `selectionStep` calls.

### Claude's Discretion
- Exact internal structure of the typed observable accessor (TEST-01) and the ActionBuilder fluent API shape, as long as the locked names/signatures hold and the design doc's return shapes are honored.
- `GameStuckError` message wording (must be actionable per CLAUDE.md).
- Test structure; new test files per TEST requirement; integration test per cross-layer boundary (CLAUDE.md).
- Wave/plan decomposition (planner's call).
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets (reuse, do not rebuild)
- Phase 117 primitives: `game.getActionSpace(seat)`, `enumerateLegalMoves(game, seat, opts?)` (`src/engine/utils/enumerate-moves.ts`), `game.getActionSchema(name, seat)`, `createPlayerView`/`runner.getPlayerView`. `playUntilComplete` builds directly on `enumerateLegalMoves`.
- `TestGame` (`src/testing/test-game.ts`) — already has `getPlayerView(seat)` at :243.
- `src/testing/assertions.ts` — `assertActionAvailable` (:180), `assertFlowState` (:64) are the functions to modify/extend.
- `game.debugActionAvailability()` (`src/engine/element/game.ts:1072`) — the actively-maintained availability tracer for TEST-03.
- Existing simulate helpers in `src/testing/` (simulate-action, etc.).

### Established Patterns
- TestGame drives actions in-process; events sourced; deterministic seeding via injectable rng.
- MEMORY: `src/ai/mcts-bot.test.ts` is excluded from vitest; test games need `maxIterations` on `loop()`.

### Integration Points
- All public API additions surface from the testing barrel (`src/testing/index.ts`). `GameStuckError` exported there.
- Cross-layer boundary: testing → engine (enumerateLegalMoves, debugActionAvailability, getPlayerView). Integration test per the VALIDATION strategy.
</code_context>

<specifics>
## Specific Ideas

- `playUntilComplete` is the marquee ergonomic: one call drives a game to completion, guards against infinite/stuck loops, and throws a structured `GameStuckError` instead of hanging. Reproducibility via injectable `rng`.
- TEST-03's auto-trace is what makes failures self-explaining — the whole point is the assertion message tells you which selection/condition failed without manual debugging.
- TEST-04 default `'exact'` is a deliberate D-06 decision (backward compatible); document the `'contains'` opt-in clearly.
</specifics>

<deferred>
## Deferred Ideas

- First-class hidden-info leak assertion `assertNoLeakFrom` (TEST-F1) — DEFERRED per design doc Part 3.
- Devtools/browser driving (Phase 119); authoring guards (Phase 120); migration (Phase 121); docs (Phase 122).
</deferred>
