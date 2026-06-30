---
phase: 26-training-improvements
plan: 02
subsystem: ai-training
tags: [evolution, genetic-algorithm, weight-optimization, mcts]

# Dependency graph
requires:
  - phase: 26-01
    provides: benchmark infrastructure for evaluating weight fitness
provides:
  - µ+λ evolution strategy functions
  - Seeded RNG for reproducible evolution
  - Weight mutation with Gaussian perturbation
  - Weight crossover between parent solutions
  - Selection of best individuals by fitness
  - Offspring generation combining mutation and crossover
affects: [27-llm-strategy, 28-integration]

# Tech tracking
tech-stack:
  added: []
  patterns: [mulberry32-prng, box-muller-transform, pure-functions]

key-files:
  created:
    - packages/ai-trainer/src/evolution.ts
    - packages/ai-trainer/tests/evolution.test.ts
  modified:
    - packages/ai-trainer/src/index.ts

key-decisions:
  - "Used mulberry32 PRNG for seeded randomness (fast, simple, deterministic)"
  - "Box-Muller transform for Gaussian distribution (no external deps)"
  - "80/20 mutation/crossover ratio (standard for ES)"
  - "10% sign flip probability during mutation (explore opposite hypotheses)"

patterns-established:
  - "Pure evolution functions with seeded RNG injection"
  - "Immutable objective arrays (mutation returns new array)"

issues-created: []

# Metrics
duration: 3min
completed: 2026-01-14
---

# Phase 26 Plan 02: Weight Evolution System Summary

**µ+λ evolution strategy with mutate, crossover, select, and offspring generation functions using seeded RNG for reproducibility**

## Performance

- **Duration:** 3 min
- **Started:** 2026-01-14T16:53:41Z
- **Completed:** 2026-01-14T16:56:28Z
- **Tasks:** 1 TDD feature (RED → GREEN → REFACTOR)
- **Files modified:** 3

## RED Phase: Failing Tests

Wrote comprehensive tests for all evolution functions:

**createSeededRandom tests:**
- Produces deterministic sequence from same seed
- Different sequences for different seeds
- Values bounded in [0, 1)

**mutateWeights tests:**
- Preserves feature IDs
- Changes weights when sigma > 0
- Keeps weights within bounds [-20, 20]
- Returns identical weights with sigma=0
- Returns new array (immutability)
- Preserves other objective properties

**crossoverWeights tests:**
- Combines features from both parents
- For shared features, picks weight from one parent
- Returns new array (immutability)

**selectBest tests:**
- Returns exactly mu items
- Items sorted by fitness (highest first)
- Handles mu larger than population
- Handles empty population

**generateOffspring tests:**
- Returns exactly lambda items
- Produces mutated versions of parent weights
- Handles single parent
- Deterministic with same seed

Tests failed because evolution.ts didn't exist.

## GREEN Phase: Implementation

Created evolution.ts with pure functions:

1. **createSeededRandom(seed):** mulberry32 PRNG with string-to-hash conversion
2. **mutateWeights(objectives, sigma, rng):** Gaussian perturbation + 10% sign flip + clamping
3. **crossoverWeights(parent1, parent2, rng):** Feature union with random selection
4. **selectBest(population, fitnesses, mu):** Sort by fitness, return top mu
5. **generateOffspring(parents, lambda, sigma, rng):** 80% mutation / 20% crossover+mutation

All 20 tests pass.

## REFACTOR Phase

No refactoring needed - code was clean from the start:
- Pure functions with no side effects
- Well-documented with JSDoc
- Uses early returns
- Clear separation of concerns

## Task Commits

TDD plan commits:

1. **RED: Failing tests** - `6f3c14b` (test)
2. **GREEN: Implementation** - `dddbefd` (feat)

**Plan metadata:** TBD (docs: complete plan)

## Files Created/Modified

- `packages/ai-trainer/src/evolution.ts` - New evolution module with all functions
- `packages/ai-trainer/tests/evolution.test.ts` - 20 tests for evolution functions
- `packages/ai-trainer/src/index.ts` - Export new evolution functions

## Decisions Made

1. **mulberry32 PRNG** - Fast, simple, deterministic, widely tested
2. **Box-Muller transform** - Standard method for Gaussian without dependencies
3. **80/20 mutation/crossover** - Standard ratio in evolution strategies
4. **10% sign flip** - Allows exploring opposite hypotheses (positive→negative correlation)
5. **[-20, 20] weight bounds** - Reasonable range to prevent runaway weights

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## Next Phase Readiness

- Evolution functions ready for integration into training loop
- Next plan can wire evolution into trainer.ts iteration cycle
- Benchmark infrastructure from 26-01 ready to evaluate evolved weights

---
*Phase: 26-training-improvements*
*Completed: 2026-01-14*
