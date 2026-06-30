---
phase: "110"
plan: "01"
subsystem: session/ui
tags: [teaching, transient-state, broadcast, hasAIPlayers, platform-mode]
dependency_graph:
  requires: []
  provides: [transient-teaching-state-substrate, hasAIPlayers-broadcast-signal, showHintProp-platform-fix]
  affects: [snapshot-session-host, GameShell, broadcastCurrent]
tech_stack:
  added: []
  patterns: [broadcast-injection-post-buildPlayerState, per-seat-transient-Map, identity-short-circuit]
key_files:
  created:
    - src/ui/components/GameShell.test.ts
  modified:
    - src/session/snapshot-session-host.ts
    - src/ui/components/GameShell.vue
    - src/session/snapshot-session-host.test.ts
decisions:
  - "Null-guard added to mergeTransientState for stub views (AI pump tests use null sentinel playerViews)"
  - "transientTeachingState, demoRunning, narrationText kept public for direct test access; lastPlayerViews private"
  - "BotGameDefinitionLike extends GameDefinitionLike with ai? to carry AIConfig before stateless-ops.ts is updated"
metrics:
  duration: "~8 minutes"
  completed: "2026-06-29"
  tasks_completed: 3
  tasks_total: 3
  files_created: 1
  files_modified: 3
---

# Phase 110 Plan 01: Transient Teaching State Foundation Summary

Transient teaching state injection plumbing for `SnapshotSessionHost` + Teaching-controls un-hide in platform (dev-host) mode via `showHintProp` OR-condition.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Add transient teaching state + mergeTransientState + broadcastCurrent | b3eacd7 | snapshot-session-host.ts |
| 2 | Un-hide Teaching controls in platform mode via showHintProp | 688ce72 | GameShell.vue, GameShell.test.ts (created) |
| 3 | BotGame fixture + transient-merge/hasAIPlayers broadcast tests | 416e558 | snapshot-session-host.test.ts |

## What Was Built

### `SnapshotSessionHost` — transient teaching state substrate (Task 1)

Added private fields to `SnapshotSessionHost`:
- `transientTeachingState: Map<number, { hint?, heatmap? }>` — per-seat hint/heatmap storage
- `demoRunning: boolean` — game-wide demo-running signal
- `narrationText: string | null` — game-wide narration text
- `lastPlayerViews: unknown[]` — cached from last `apply()` for `broadcastCurrent()`

Added `mergeTransientState(playerViews)`:
- Short-circuits (returns input unchanged) when no transient state AND no aiSeats — identity for non-teaching games
- Maps each view by `seat = i + 1`: applies per-seat hint/heatmap from the Map
- Applies game-wide signals to ALL seats: `narration`, `isDemoRunning`, `hasAIPlayers`
- Guards against null/stub views (AI pump tests use null sentinel playerViews)

Added `broadcastCurrent()`: re-broadcasts `lastPlayerViews` merged with current transient state. Used by Plans 02/03 to surface transient changes without re-running an op.

Modified `apply()`: caches `res.playerViews` into `lastPlayerViews` before broadcasting merged views.

`buildPlayerState` is untouched — the injection stays above it.

### `GameShell.vue` — showHintProp OR-condition (Task 2)

Changed `showHintProp` computed from a single lobby-check to an OR:
1. Production lobby path (unchanged): `lobbyInfo.value?.slots?.some(s => s.aiLevel != null)`
2. Dev-host (platform mode) path: `(state.value?.state as any)?.hasAIPlayers` — injected by `SnapshotSessionHost` when `aiSeats` are present

This unblocks the Teaching controls in the dev host (`boardsmith dev --ai 2`) without touching the production `GameSession` path.

### `GameShell.test.ts` — new file (Task 2)

Unit test file with 7 cases for `showHintProp`:
- SH-1/1b: both absent → `undefined` (production no-AI)
- SH-2/2b: `state.hasAIPlayers` true → `true` (dev-host)
- SH-3/3b: lobbyInfo AI slot → `true` (production lobby)
- SH-4: both active → `true`

### `snapshot-session-host.test.ts` — new tests + BotGame fixture (Task 3)

Added `BotGame` fixture: 2 players, `chooseFrom('direction', ['left','right'])` gives 2+ legal moves for MCTS, `objectives` evaluator, `ai` config on `BotGameDefinitionLike`. Exported for Plans 02/03.

Added 4 foundation tests:
1. `aiSeats` set → all broadcast views carry `state.hasAIPlayers === true`
2. No aiSeats + no transient state → `hasAIPlayers` absent (identity short-circuit proven)
3. Per-seat hint isolation: seat 1 gets hint, seat 2 does not (RESEARCH Pitfall 6 guard)
4. Game-wide narration + isDemoRunning applied to all seats via `broadcastCurrent()`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Null guard in mergeTransientState for stub views**
- **Found during:** Task 1 — running existing test suite after the change
- **Issue:** AI pump tests use `playerViews: [null, null]` as sentinel stubs. When `aiSeats` is set, `hasTransient` is true, and `mergeTransientState` tried to spread `view.state` on a null view → `TypeError: Cannot read properties of null`
- **Fix:** Added `if (view == null || typeof view !== 'object' || !('state' in view)) return view;` at the top of the map callback
- **Files modified:** src/session/snapshot-session-host.ts
- **Commit:** b3eacd7

None - all other plan items executed exactly as written.

## Verification

- `npx vitest run src/session/snapshot-session-host.test.ts` — 14 tests pass (10 existing + 4 new)
- `npx vitest run src/ui/components/GameShell.test.ts` — 7 tests pass (all new)
- `buildPlayerState` unchanged (grep confirms injection is in `SnapshotSessionHost.mergeTransientState`)
- Production lobby `showHintProp` path byte-for-byte equivalent (`lobbyInfo` branch unchanged, verified by SH-3/3b)

## Known Stubs

None. This plan is pure plumbing substrate — no UI rendering of teaching data yet. The `transientTeachingState` fields are wired but unpopulated until Plans 02/03 add the hint/heatmap/demo ops.

## Self-Check: PASSED
