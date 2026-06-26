---
phase: 107-ai-assisted-teaching
plan: "02"
subsystem: session
tags: [mcts, ai, teaching, hints, heatmap, tdd, broadcast-injection, session-layer]
dependency_graph:
  requires:
    - phase: 107-01
      provides: [MCTSBot.playWithStats, BotMoveStats, AIConfig.hintTargetFromMove]
  provides:
    - HeatmapEntry interface in session/types.ts
    - hint/heatmap/narration fields on PlayerGameState (session-layer only, never serialized)
    - GameSession.requestHint(seat) — ephemeral MCTS search → hint annotation in broadcast state
    - GameSession.clearHint(seat) — removes hint + broadcasts
    - GameSession.setHeatmapVisible(seat, bool) — per-cell MCTS evaluation heatmap in broadcast state
    - GameSession.#buildHeatmapEntries — dedupe/isBest logic
    - GameSession.#extractMoveTarget — config hook + common arg-name fallback
  affects:
    - src/ui/components/helpers/HintOverlay.vue (Phase 107 Task UI — reads state.hint)
    - src/ui/components/helpers/HeatmapOverlay.vue (Phase 107 Task UI — reads state.heatmap)
    - src/ui/components/GameShell.vue (mounts new overlays)
    - src/ui/components/ControlsMenu.vue (Teaching group emitting hint/heatmap actions)
tech-stack:
  added: []
  patterns:
    - Post-buildPlayerState broadcast injection (teaching state injected AFTER pure fn, never in engine)
    - Per-seat thinking guard pattern (Set<number> prevents concurrent MCTS per seat)
    - replaceRunner clear pattern (undo/rewind drops stale ephemeral element refs)
    - Move-target extraction (config hook > common arg-name scan > undefined → floating bubble)
    - Heatmap deduplication (Map keyed by element ref, keep highest normalizedValue per cell, one isBest)
key-files:
  created:
    - src/session/teaching.test.ts
  modified:
    - src/session/types.ts
    - src/session/game-session.ts
key-decisions:
  - "Inject hint/heatmap/narration post-buildPlayerState() to keep that pure function untouched — session-only transient state must not enter engine serialization"
  - "Store botAIConfig on GameSession (added to constructor) so ephemeral hint/heatmap bots can use the same hintTargetFromMove hook as the main AIController"
  - "Session-wide #heatmapUpdating guard (not per-seat) because MCTS is CPU-bound — concurrent full-board evaluations compete for the same CPU"
  - "setHeatmapVisible concurrent skip (not queue) — if AI is thinking, the recompute is silently skipped; caller can retry after AI finishes"
  - "TDD cycle: Task 1 created structural invariant tests (no-serialization); Task 2+3 added RED tests calling new APIs; all 12 tests pass"
requirements-completed: [AI-01, AI-03]
duration: ~8 minutes
completed: "2026-06-26"
---

# Phase 107 Plan 02: Session Teaching Substrate Summary

**Transient hint/heatmap teaching state injected post-buildPlayerState into broadcast, with per-seat DoS guards and undo/rewind clear via replaceRunner callback.**

## Performance

- **Duration:** ~8 minutes
- **Started:** 2026-06-26
- **Completed:** 2026-06-26
- **Tasks:** 3
- **Files modified:** 2 (types.ts, game-session.ts)
- **Files created:** 1 (teaching.test.ts)
- **Tests added:** 12 (teaching.test.ts)
- **Tests total:** 1475

## Accomplishments

- Added `HeatmapEntry` interface + `hint?`/`heatmap?`/`narration?` optional fields to `PlayerGameState` (session-layer only, never serialized per T-107-04)
- Implemented `requestHint(seat)`: ephemeral MCTS search → `Annotation{text:'Suggested move', target?}` stored in `#hint` Map → broadcast; fails loud if seat not awaiting input or concurrent request detected (T-107-03)
- Implemented `setHeatmapVisible(seat, bool)`: MCTS stats → per-cell deduplicated `HeatmapEntry[]` with one `isBest` → broadcast; session-wide guard prevents concurrent recompute
- Move-target extraction via `config.hintTargetFromMove` hook first, then common arg names (`to`, `destination`, `target`, `square`, `cell`, `position`); returns `undefined` for floating bubble (no ring)
- Clear-on-replace: `replaceRunner` callback clears `#hint` and `#heatmap` so undo/rewind never broadcasts stale element-ID refs
- Auto-clear hint in `performAction()` before broadcast: acting player's hint is removed after each action

## Task Commits

1. **Task 1: Transient teaching fields + broadcast injection + clear-on-replace** — `37fa8ec` (feat)
2. **Task 2: requestHint / clearHint + move-target extraction + auto-clear** — `cf3f4da` (feat)
3. **Task 3: setHeatmapVisible + buildHeatmapEntries + recompute guard** — `470d483` (feat)

## Files Created/Modified

- `src/session/types.ts` — Added `HeatmapEntry` interface; added `Annotation` import; added `hint?`, `heatmap?`, `narration?` optional fields to `PlayerGameState`
- `src/session/game-session.ts` — Added `#hint`, `#heatmap`, `#narrationText`, `#hintThinking`, `#heatmapUpdating`, `#botAIConfig` private fields; broadcast injection; clear-on-replace in replaceRunner; `requestHint()`, `clearHint()`, `setHeatmapVisible()`, `#extractMoveTarget()`, `#buildHeatmapEntries()` methods; auto-clear hint in `performAction()`; added imports (`canSeatAct`, `createBot`, `parseAILevel`, `BotMove`, `BotMoveStats`, `ElementRef`)
- `src/session/teaching.test.ts` — New: 12 tests covering no-serialization invariants, broadcast injection, clear-on-replace, requestHint/clearHint lifecycle, heatmap shape/dedupe/isBest

## Decisions Made

1. **Post-buildPlayerState injection** — Teaching state is injected after `buildPlayerState()` in `broadcast()` to keep that pure function untouched. `buildPlayerState` reads from engine state; hint/heatmap are not engine state and must not enter serialization.

2. **botAIConfig stored on GameSession** — The `hintTargetFromMove` hook lives in `BotAIConfig` (AI module). Previously, `botAIConfig` was only passed to `AIController` at construction. Added `#botAIConfig` field + constructor parameter so ephemeral bots for hint/heatmap can use the same game-specific target extraction as the main AIController.

3. **Session-wide heatmap guard** — `#heatmapUpdating` is session-wide (not per-seat) because MCTS is CPU-bound. Concurrent per-seat heatmap recomputes would compete for CPU; session-wide serialization is simpler and sufficient.

4. **Skip (not queue) concurrent heatmap** — When `setHeatmapVisible(true)` is called while a recompute is in flight, the request is silently skipped. Queueing would risk stale UI with old stats; the UI can retry via the controls menu.

5. **TDD structure** — Task 1's RED tests used structural invariants (no-serialization) plus injection tests that called non-existent `requestHint` (TypeError → RED). Task 1 GREEN implemented infrastructure making structural tests pass; injection tests remained RED for Task 2. Task 2 and 3 added more tests and implemented the APIs. All 12 tests pass after Task 3.

## Deviations from Plan

None — plan executed exactly as written. The constructor change to store `botAIConfig` was implied by "read the bot AI config off the game definition" in the plan and was the minimal correct implementation.

## Known Stubs

None — all three API methods (`requestHint`, `clearHint`, `setHeatmapVisible`) are fully wired and functional. The UI layer (HintOverlay.vue, HeatmapOverlay.vue, GameShell.vue, ControlsMenu.vue) is deferred to Phase 107 Tasks UI (separate plans).

## Threat Flags

No new threat surface beyond what was planned. T-107-03 (DoS guard) and T-107-04 (no serialization) are both mitigated as designed.

## Self-Check: PASSED

| Item | Status |
|------|--------|
| src/session/types.ts — HeatmapEntry + teaching fields | FOUND |
| src/session/game-session.ts — requestHint | FOUND |
| src/session/game-session.ts — clearHint | FOUND |
| src/session/game-session.ts — setHeatmapVisible | FOUND |
| src/session/game-session.ts — #hint.clear in replaceRunner | FOUND |
| src/session/game-session.ts — #hint.delete in performAction | FOUND |
| src/session/teaching.test.ts | FOUND |
| commit 37fa8ec (Task 1) | FOUND |
| commit cf3f4da (Task 2) | FOUND |
| commit 470d483 (Task 3) | FOUND |
| 1475 tests pass | VERIFIED |
| No new dependencies | VERIFIED |
| buildPlayerState in utils.ts unchanged | VERIFIED |
