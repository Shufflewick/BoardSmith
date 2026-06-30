---
phase: 113-go-fish-ai-teaching
plan: 01
subsystem: ui
tags: [go-fish, hint, mcts, anchorAttrs, hintTargetFromMove, overlay, teaching]

# Dependency graph
requires:
  - phase: 112-go-fish-tutorial-content
    provides: anchorAttrs wired in GameTable.vue custom UI (Phase 112 per-card bindings)
  - phase: 107-checkers-ai-teaching
    provides: hintTargetFromMove substrate in game-session + HintOverlay overlay resolution
provides:
  - getGoFishHintTarget hook: maps ask BotMove { rank } to { name: rank } ElementRef
  - hintTargetFromMove wired in go-fish gameDefinition.ai alongside objectives
  - rank-group anchor (data-bs-el-name="<rank>") on card-group div in GameTable.vue
  - tests/hint-target.test.ts: 13 tests covering hook behavior, wiring, and source-binding guard
affects: [113-02, 113-03, 114-action-help-host-lockout, 115-documentation]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "hintTargetFromMove: game-agnostic hook for mapping BotMove to ElementRef in gameDefinition.ai"
    - "anchorAttrs({ name: rank }) on the card-group div enables HintOverlay to resolve rank refs in card games"
    - "Source-binding guard: readFileSync in test to assert Vue template contains required binding"

key-files:
  created:
    - ~/BoardSmithGames/go-fish/tests/hint-target.test.ts
  modified:
    - ~/BoardSmithGames/go-fish/src/rules/ai.ts
    - ~/BoardSmithGames/go-fish/src/rules/index.ts
    - ~/BoardSmithGames/go-fish/src/ui/components/GameTable.vue

key-decisions:
  - "Hook receives move only (no game/seat) — bare-rank { name: rank } is the correct ref; resolving a card id from hintTargetFromMove is not possible by design"
  - "anchorAttrs({ name: rank }) on the card-group div (additive to per-card Phase 112 bindings) targets the whole rank group for the hint ring"
  - "Source-binding guard in test file uses readFileSync to assert the Vue template contains the anchor, preventing silent regressions"

patterns-established:
  - "Rank-group anchor pattern: card-game hint targets use bare-rank { name } refs on the rank-group div, not individual card ids"
  - "Test source guard: for template attributes that cannot be tested via mount, read the source file and assert substring presence"

requirements-completed: [GFAI-01]

# Metrics
duration: 12min
completed: 2026-06-30
---

# Phase 113 Plan 01: go-fish-ai-teaching (move HINT) Summary

**getGoFishHintTarget hook maps MCTS ask moves to bare-rank { name } refs, anchored on the rank-group card-group div via anchorAttrs, enabling HintOverlay ring placement on go-fish card hands**

## Performance

- **Duration:** 12 min
- **Started:** 2026-06-30T10:45:00Z
- **Completed:** 2026-06-30T10:47:00Z
- **Tasks:** 2
- **Files modified:** 4 (go-fish repo)

## Accomplishments
- Added `getGoFishHintTarget` to `ai.ts`: maps `{ action:'ask', args:{ rank } }` to `{ name: rank }` ElementRef, returns `undefined` for any move without a rank — substrate shows floating bubble, never fabricates a target
- Wired `hintTargetFromMove: getGoFishHintTarget` in `gameDefinition.ai` in `index.ts` alongside existing `objectives`; exported hook from the package barrel
- Added `v-bind="anchorAttrs({ name: rank })"` on the `card-group` div in `GameTable.vue` so `data-bs-el-name="<rank>"` is emitted on each rank group, enabling `HintOverlay.buildSelector` to resolve `{ name: rank }` to the group in the learner's hand
- Wrote `tests/hint-target.test.ts` (13 tests): ask → `{name:rank}`, two-digit rank '10', missing rank → undefined, non-ask → undefined, bare-rank guard (Pitfall 1), same-reference wiring assertion, and source-binding guard asserting `GameTable.vue` contains `anchorAttrs({ name: rank })`

## Task Commits (go-fish repo)

1. **Task 1: getGoFishHintTarget hook + wiring + unit tests** - `4579535` (feat)
2. **Task 2: rank-group anchor + source-binding guard test** - `0ebea1f` (feat)

**Plan metadata (BoardSmith repo):** see final commit below

## Files Created/Modified
- `~/BoardSmithGames/go-fish/src/rules/ai.ts` - Added `getGoFishHintTarget` function (Hook 5)
- `~/BoardSmithGames/go-fish/src/rules/index.ts` - Exported hook, wired `hintTargetFromMove` in `gameDefinition.ai`
- `~/BoardSmithGames/go-fish/src/ui/components/GameTable.vue` - Added rank-group `anchorAttrs({ name: rank })` on `card-group` div
- `~/BoardSmithGames/go-fish/tests/hint-target.test.ts` - New: 13 unit tests

## Decisions Made
- Hook receives `move` only (no game/seat access) — bare-rank `{ name: rank }` is the correct and only derivable ElementRef at hook call time. This is consistent with the checkers analog and the substrate contract.
- The rank-group anchor is additive: Phase 112 per-card `anchorAttrs({ id, name: rank+suit })` bindings are left unchanged. The rank-group anchor `{ name: rank }` serves the hint overlay; the per-card bindings serve tutorial step anchoring on specific cards.
- Source-binding guard uses `readFileSync` in the test rather than mounting the Vue component — the attribute is a Vue template binding that requires DOM inspection to confirm visually, and the source assertion catches template-level regressions without a full jsdom mount.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness
- GFAI-01 hook + wiring + rank anchor in place; unit tests prove the full signal chain from ask BotMove to rank-group ElementRef
- Ready for Phase 113-02 (demo/narration) and eventually the 113-03 browser checkpoint
- No BoardSmith `src/` changes made; substrate is as-is from v4.1

---
*Phase: 113-go-fish-ai-teaching*
*Completed: 2026-06-30*
