---
phase: 31-trajectory-objectives
plan: 01
subsystem: ai-trainer
tags: [feature-templates, momentum-detection, trajectory-features, connection-games, capture-games]

# Dependency graph
requires:
  - phase: 25-structural-features
    provides: feature-templates.ts infrastructure, FEATURE_TEMPLATES array, evaluator factory pattern
provides:
  - 6 new feature templates for detecting momentum/trajectory
  - Tempo/initiative features (path-differential, threat-differential, forcing-position)
  - Position quality features (bridge-potential, expansion-room, central-mass)
affects: [ai-training, feature-selection, hex-ai, capture-game-ai]

# Tech tracking
tech-stack:
  added: []
  patterns: [trajectory-detection, momentum-proxies, bridge-cell-detection]

key-files:
  created: []
  modified:
    - packages/ai-trainer/src/feature-templates.ts

key-decisions:
  - "Path differential threshold of 2 stones ahead for significant tempo advantage"
  - "Bridge cells defined as empty cells adjacent to 2+ distinct player groups"
  - "Expansion room counts unique adjacent empty cells, not total adjacencies"
  - "Central mass uses average distance from center (continuous) vs center-control threshold regions"

patterns-established:
  - "Momentum detection via path differential and forcing position"
  - "Position quality via bridge potential and expansion room"
  - "Hex distance formula for central mass calculation"

issues-created: []

# Metrics
duration: 12min
completed: 2026-01-15
---

# Phase 31: Trajectory Objectives Summary

**Added 6 feature templates that detect momentum/trajectory rather than just static state, enabling AI to evaluate who is gaining ground**

## Performance

- **Duration:** 12 min
- **Started:** 2026-01-15
- **Completed:** 2026-01-15
- **Tasks:** 3
- **Files modified:** 1

## Accomplishments
- Added 3 tempo/initiative feature templates that detect forcing positions
- Added 3 position quality feature templates that detect growth potential
- Created helper functions: countBridgeCells, countAdjacentEmpty, calculateAverageDistanceFromCenter
- All features properly filtered by gameType (connection vs capture)
- Verified feature generation for both connection and capture game types

## Task Commits

Each task was committed atomically:

1. **Task 1: Add tempo/initiative feature templates** - `a64a750` (feat)
2. **Task 2: Add position quality feature templates** - `9bdffc3` (feat)
3. **Task 3: Verify feature generation** - (verification only, no commit)

## Files Created/Modified
- `packages/ai-trainer/src/feature-templates.ts` - Added 6 new templates and 5 helper/evaluator functions

## New Feature Templates

### Tempo/Initiative Features
| Template ID | Category | Game Type | Description |
|-------------|----------|-----------|-------------|
| path-differential | comparison | connection | Player has significantly shorter path (2+ stones ahead) |
| threat-differential | comparison | capture | Player threatens more opponent pieces than own are threatened |
| forcing-position | boolean | connection | Player is within 2 moves while opponent is further |

### Position Quality Features
| Template ID | Category | Game Type | Description |
|-------------|----------|-----------|-------------|
| bridge-potential | spatial | connection | Player has more cells that could connect 2+ groups |
| expansion-room | spatial | all spatial | Player's pieces have more adjacent empty cells |
| central-mass | spatial | all spatial | Player's pieces are closer to board center on average |

## Verification Results
- All 6 templates exist in FEATURE_TEMPLATES array
- Connection games generate 8 trajectory features (including per-element variants)
- Capture games generate 3 trajectory features (threat-differential, expansion-room, central-mass)
- TypeScript compiles without errors
- No test regressions (527 unit tests pass, 3 E2E failures are pre-existing)
