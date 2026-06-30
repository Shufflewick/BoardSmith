# Phase 117: Action-Space Introspection - Context

**Gathered:** 2026-06-30
**Status:** Ready for planning
**Source:** Locked design contract (`.planning/v4.3-API-DESIGN.md`, approved 2026-06-30)

<domain>
## Phase Boundary

Ship the keystone introspection primitive every later v4.3 layer (test ergonomics, devtools bridge, AI) depends on: a single, serializable way to ask "what can this seat do right now, with what choices?" — plus per-action schema, validated arg-building, full legal-move enumeration, and a typed perspective-aware state view. Plus the promoted INTRO-F1 (expose checkpoint/rewind).

Scope: BoardSmith `src/` — primarily engine/session/runtime. Clean implementation, no backward-compat shims. Reuse existing primitives; do NOT build parallel validators.

Covers: INTRO-01..05 + INTRO-F1 (promoted). Excludes: UI/devtools (Phase 119), test ergonomics wrappers (Phase 118), game migration (Phase 121), docs (Phase 122).
</domain>

<decisions>
## Implementation Decisions

All API-surface decisions are **already locked** in the approved design doc — Phase 117 implements that contract exactly. Build to `.planning/v4.3-API-DESIGN.md` Part 2 (INTRO section) and the Design Decisions Registry. The authoritative per-surface dispositions:

### INTRO-01 — `game.getActionSpace(seat): ActionSpaceView`
- BUILD new method on `Game` (`src/engine/element/game.ts`). MUST wrap existing primitives in this exact order: `availableActionsForSeat()` → resolve `Player` → `buildActionMetadata()` → enrich with `argTemplate`. No `evaluateCondition()` call from this method (no parallel validator).
- New types `ActionSpaceView` / `ActionSchemaView` in engine public barrel. `argTemplate` placeholder format (D-01): optional → `null`; required → `{ __required: true }`. Plain JSON-serializable (no element refs in template).

### INTRO-02 — `game.getActionSchema(actionName, seat)`
- EXPOSE existing `buildSingleActionMetadata` (`src/session/utils.ts:91`); export `ActionMetadata` type from `src/session/index.ts` (currently unexported). Add a thin `getActionSchema` convenience method on Game. Dynamic choices via existing `game.getSelectionChoices(...)` — documented, no server round-trip for headless/test.

### INTRO-03 — `buildActionArgs(actionName, selectionValues, game, seat, options?)`
- BUILD new utility in new file `src/engine/utils/arg-builder.ts`. Format (D-02): in-process element objects by default; `{ format: 'wire' }` opt-in produces `{ __elementRef }` for cross-process agents.

### INTRO-04 — legal-move enumeration
- Extract/reuse the enumeration logic from `MCTSBot.enumerateSelectionsInternal` (`src/ai/mcts-bot.ts:924`) — do NOT duplicate it. Handles dependsOn, multiSelect, optional, recursive combos. Default full enumeration; opt-in `maxPerAction` limit (D-07). The bot's 20-item sampling is a bot optimization, not a correctness default.

### INTRO-05 — perspective-aware state view
- EXPOSE existing `createPlayerView()` / `runner.getPlayerView()` (CONFIRMED at 4 layers). Document; do NOT build a new JSON filter. Raw `game.toJSON()` is a hidden-info leak — never use it for perspective view.

### INTRO-F1 — checkpoint/rewind (PROMOTED, user-approved)
- EXPOSE-ONLY: add `UndoResult` and `ElementDiff` type exports to `src/session/index.ts` (~5 lines). The 5 methods (`getStateAtAction`, `getStateDiff`, `getActionTraces`, `undoToTurnStart`, `rewindToAction`) are already implemented + public on `GameSession`. No new logic. Document them for the agent-control guide (Phase 122).

### Claude's Discretion
- Test structure and exact assertion wording (follow CLAUDE.md: at least one integration test per cross-layer boundary; trace a real value config→engine→session→runtime).
- Exact error-message text (must be actionable per project rules).
- Internal refactor mechanics when extracting the enumeration logic for INTRO-04, as long as the MCTS bot keeps passing and no behavior changes.
- Wave/plan decomposition (planner's call).
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets (per design doc "Don't Hand-Roll" table — MUST reuse)
- Action availability: `availableActionsForSeat()` + `buildActionMetadata()` / `buildSingleActionMetadata()` (`src/session/utils.ts`). `PickMetadata` (`src/session/types.ts`) already carries `dependsOn`, `choices`, `validElements`.
- Move enumeration: `MCTSBot.enumerateSelectionsInternal` (`src/ai/mcts-bot.ts:924`).
- Perspective view: `createPlayerView()` (`src/engine/utils/snapshot.ts:194`), `runner.getPlayerView()` (`src/runtime/runner.ts:281`), `TestGame.getPlayerView()` (`src/testing/test-game.ts:243`); `PlayerStateView` typed.
- Checkpoint/undo: `StateHistory` (`src/session/state-history.ts`) → public `GameSession` methods.
- Dynamic choices: `game.getSelectionChoices()` (`src/engine/element/game.ts:934`).

### Established Patterns
- Event-sourced state; `commandHistory` + `actionHistory`; snapshots/replays in runtime.
- Do not call `evaluateCondition()` from introspection — drift risk; reuse the metadata builders.

### Integration Points
- New public surface on `Game` (engine) + new `src/engine/utils/arg-builder.ts`; type re-exports from `src/session/index.ts` and the engine public barrel. Serializable end-to-end for Phase 119's devtools global.
</code_context>

<specifics>
## Specific Ideas

- Honor the design doc's "Don't Hand-Roll Constraints" table verbatim — any PR calling `evaluateCondition()` directly from introspection code, or duplicating enumeration, is a red flag.
- INTRO-05 must correctly exclude hidden info (security-sensitive — a leak here is a regression). Add an explicit test that a hidden-information element is absent from another seat's view.
- TEST-03's trace (Phase 118) will use `game.debugActionAvailability()` (`game.ts:1072`), not the possibly-stale `traceAction()` in debug.ts (D-05) — keep that in mind if any shared helper is touched here.
</specifics>

<deferred>
## Deferred Ideas

- Test-ergonomics wrappers (`playUntilComplete`, observable-state typed API, builder) — Phase 118.
- Devtools global / DOM signal / `data-*` selectors — Phase 119.
- `AgentRunner` (INTRO-F2), leak assertion (TEST-F1) — DEFERRED per design doc Part 3.
- Game migration onto these APIs — Phase 121.
</deferred>
