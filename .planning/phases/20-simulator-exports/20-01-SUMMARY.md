---
phase: 20-simulator-exports
plan: 01
status: complete
subsystem: ai-trainer
requires: []
provides:
  - simulateSingleGame export
  - SerializableGameStructure type
  - SerializableSimulationOptions type
  - serializeGameStructure function
  - deserializeGameStructure function
affects:
  - 21-worker-infrastructure
tags:
  - ai-training
  - parallelization
  - worker-threads
key-decisions:
  - Features regenerated from structure in workers (not serialized)
  - SingleGameOptions as focused subset of SimulationOptions
key-files:
  - packages/ai-trainer/src/types.ts
  - packages/ai-trainer/src/simulator.ts
  - packages/ai-trainer/src/index.ts
tech-stack:
  added: []
  patterns:
    - Serialize Map/Set to Record/Array for structured cloning
---

# Phase 20 Plan 01: Simulator Exports Summary

**Exported simulateSingleGame and added serializable types for worker thread communication.**

## Accomplishments

- Made `simulateSingleGame` a public export (was private)
- Added `SerializableElementTypeInfo` interface (Set → Array for stringEnums)
- Added `SerializableGameStructure` interface (Map → Record for elementTypes)
- Added `SingleGameOptions` interface (focused options for single game simulation)
- Added `SerializableSimulationOptions` interface (all structured-cloneable for workers)
- Added `serializeGameStructure()` function for Map/Set → Record/Array conversion
- Added `deserializeGameStructure()` function for reverse conversion
- Updated package exports in index.ts

## Files Created/Modified

- `packages/ai-trainer/src/types.ts` - Added 4 new interfaces
- `packages/ai-trainer/src/simulator.ts` - Exported simulateSingleGame, added serialization helpers
- `packages/ai-trainer/src/index.ts` - Added new exports

## Decisions Made

**Feature serialization approach:** Workers regenerate features from structure using `generateCandidateFeatures(deserializeGameStructure(data.structure))`. This is cleaner than serializing function code because:
1. `GameStructure` is already plain data (no functions)
2. `generateCandidateFeatures()` is pure and deterministic
3. No eval() or code serialization needed

## Issues Encountered

**Pre-existing CLI issue:** The `train-ai.js` file was missing from dist/ because the file was renamed from `build-ai.ts` to `train-ai.ts` but the dist wasn't cleaned. Fixed by rebuilding the CLI package.

## Next Step

Ready for Phase 21 (worker-infrastructure): Create simulation-worker.ts and parallel-simulator.ts for multi-core execution.
