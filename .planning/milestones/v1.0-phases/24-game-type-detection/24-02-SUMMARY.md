---
phase: 24-game-type-detection
plan: 02
subsystem: ai
tags: [feature-templates, game-type, heuristics, zero-config]

# Dependency graph
requires:
  - phase: 24-01
    provides: GameType detection in introspector
provides:
  - Type-specific feature templates (connection, capture, racing, collection)
  - generateCandidateFeatures() function with gameType filtering
  - countConnectedGroups() hex grid flood-fill algorithm
affects: [25-structural-features, 26-training-improvements, ai-training]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Flood-fill connected component counting for hex grids
    - Feature template filtering by game type

key-files:
  created: []
  modified:
    - packages/ai-trainer/src/feature-templates.ts

key-decisions:
  - "Combined all 3 tasks into single commit since all changes were to same file"
  - "Added gameType to FeatureTemplate.requires interface for zero-config filtering"
  - "Used flood-fill BFS for hex connectivity detection"

patterns-established:
  - "Game type-specific feature templates with requires.gameType guard"

issues-created: []

# Metrics
duration: 3min
completed: 2026-01-14
---

# Phase 24 Plan 02: Type-Specific Features Summary

**Added zero-config heuristic features that auto-filter based on detected game type - Hex gets connection features, Checkers gets capture features, etc.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-01-14T15:59:40Z
- **Completed:** 2026-01-14T16:02:41Z
- **Tasks:** 3
- **Files modified:** 1

## Accomplishments

- Added `gameType` requirement to `FeatureTemplate.requires` interface
- Created connection game features: edge-proximity, center-influence, connectivity-groups
- Created capture game features: mobility-advantage, piece-safety, promotion-progress
- Created racing game features: win-proximity
- Created collection game features: collection-progress, resource-advantage
- Implemented `countConnectedGroups()` for hex grid flood-fill connectivity detection
- Exported `generateCandidateFeatures(structure)` that filters templates by game type

## Task Commits

Tasks 1-3 were implemented together (same file):

1. **Tasks 1-3: All type-specific features** - `0746aaa` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified

- `packages/ai-trainer/src/feature-templates.ts` - Added 605 lines: type-specific templates, evaluators, and generateCandidateFeatures()

## Decisions Made

- **Combined tasks into single commit:** All three tasks modified the same file, and the changes were interdependent (templates require the gameType interface, generation requires the templates).
- **Simplified mobility evaluator:** True mobility requires legal move generation which is expensive. Used "piece count" as a proxy.
- **Used BFS flood-fill for connectivity:** Simple and efficient O(n) algorithm for counting connected groups on hex grids.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## Next Phase Readiness

- Phase 24 complete: Game type detection + type-specific features
- Ready for Phase 25 (structural-features) to add graph-based features
- `generateCandidateFeatures()` now provides zero-config feature generation based on game type

---
*Phase: 24-game-type-detection*
*Completed: 2026-01-14*
