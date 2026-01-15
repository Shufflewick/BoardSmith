# Roadmap: BoardSmith Large File Refactoring

## Completed Milestones

- ✅ [v0.1 Large File Refactoring](milestones/v0.1-ROADMAP.md) (Phases 1-4) — SHIPPED 2026-01-08
- ✅ [v0.2 Concerns Cleanup](milestones/v0.2-ROADMAP.md) (Phases 5-8) — SHIPPED 2026-01-09
- ✅ [v0.3 Flow Engine Docs](milestones/v0.3-ROADMAP.md) (Phase 9) — SHIPPED 2026-01-09
- ✅ [v0.4 Public API Docs](milestones/v0.4-ROADMAP.md) (Phase 10) — SHIPPED 2026-01-09
- ✅ [v0.5 ESLint No-Shadow](milestones/v0.5-ROADMAP.md) (Phase 11) — SHIPPED 2026-01-09
- ✅ [v0.6 Players in Element Tree](milestones/v0.6-ROADMAP.md) (Phases 12-13) — SHIPPED 2026-01-09
- ✅ [v0.7 Condition Tracing Refactor](milestones/v0.7-ROADMAP.md) (Phases 14-16) — SHIPPED 2026-01-10
- ✅ [v0.8 HMR Reliability](milestones/v0.8-ROADMAP.md) (Phases 17-19) — SHIPPED 2026-01-11
- ✅ [v0.9 Parallel AI Training](milestones/v0.9-ROADMAP.md) (Phases 20-23) — SHIPPED 2026-01-13
- ✅ [v1.0 AI System Overhaul](milestones/v1.0-ROADMAP.md) (Phases 24-28) — SHIPPED 2026-01-15

## Overview

A systematic refactoring of BoardSmith's four largest files into smaller, more maintainable modules. Each phase targets one file, preserving all existing behavior and public APIs while improving code organization, navigability, and testability.

## Milestones

- ✅ **v0.1 Large File Refactoring** — Phases 1-4 (shipped 2026-01-08)
- ✅ **v0.2 Concerns Cleanup** — Phases 5-8 (shipped 2026-01-09)
- ✅ **v0.3 Flow Engine Docs** — Phase 9 (shipped 2026-01-09)
- ✅ **v0.4 Public API Docs** — Phase 10 (shipped 2026-01-09)
- ✅ **v0.5 ESLint No-Shadow** — Phase 11 (shipped 2026-01-09)
- ✅ **v0.6 Players in Element Tree** — Phases 12-13 (shipped 2026-01-09)
- ✅ **v0.7 Condition Tracing Refactor** — Phases 14-16 (shipped 2026-01-10)
- ✅ **v0.8 HMR Reliability** — Phases 17-19 (shipped 2026-01-11)
- ✅ **v0.9 Parallel AI Training** — Phases 20-23 (shipped 2026-01-13)
- ✅ **v1.0 AI System Overhaul** — Phases 24-28 (shipped 2026-01-15)

## Phases

<details>
<summary>✅ v0.1 Large File Refactoring (Phases 1-4) — SHIPPED 2026-01-08</summary>

- [x] Phase 1: game-session refactoring (4/4 plans) — completed 2026-01-08
- [x] Phase 2: useActionController refactoring (4/4 plans) — completed 2026-01-08
- [x] Phase 3: action refactoring (3/3 plans) — completed 2026-01-08
- [x] Phase 4: test file refactoring (3/3 plans) — completed 2026-01-08

</details>

<details>
<summary>✅ v0.2 Concerns Cleanup (Phases 5-8) — SHIPPED 2026-01-09</summary>

### Phase 5: type-safety
**Goal**: Fix type assertion (`as any`) issues in UI code
**Depends on**: v0.1 complete
**Plans**: 3/3 complete

- [x] 05-01: Fix choice validation type in useActionController
- [x] 05-02: Replace DOM property storage with WeakMap in useZoomPreview
- [x] 05-03: Document introspector assertions (rule out as legitimate)

### Phase 6: error-handling
**Goal**: Fix critical error handling gaps
**Depends on**: Phase 5
**Plans**: 3/3 complete

- [x] 06-01: Add boardRefs error logging in selection-handler
- [x] 06-02: Add JSON.parse error handling in sqlite-storage (CRITICAL)
- [x] 06-03: Document acceptable silent errors (rule out)

### Phase 7: documentation
**Goal**: Fill documentation and API gaps
**Depends on**: Phase 6
**Plans**: 3/3 complete

- [x] 07-01: Add MCTS Bot inline documentation
- [x] 07-02: Fix assertions.ts incomplete API (remove unused param)
- [x] 07-03: Add code-generator fallback warning

### Phase 8: concerns-cleanup
**Goal**: Update CONCERNS.md to mark all items resolved
**Depends on**: Phases 5-7
**Plans**: 1/1 complete

- [x] 08-01: Update CONCERNS.md with resolution status for all items

</details>

<details>
<summary>✅ v0.3 Flow Engine Docs (Phase 9) — SHIPPED 2026-01-09</summary>

### Phase 9: flow-engine-docs
**Goal**: Add section dividers to group major subsystems in the 968-line flow engine file
**Depends on**: v0.2 complete
**Research**: None needed (documentation only, following established MCTS Bot pattern)
**Plans**: 1/1 complete

- [x] 09-01: Add section dividers and JSDoc improvements to FlowEngine

</details>

<details>
<summary>✅ v0.4 Public API Docs (Phase 10) — SHIPPED 2026-01-09</summary>

### Phase 10: public-api-jsdoc
**Goal**: Add JSDoc documentation to all public APIs since BoardSmith is a library for others to use
**Depends on**: v0.3 complete
**Research**: None needed (documentation only, following established patterns)
**Plans**: 3/3 complete

Plans:
- [x] 10-01: Add JSDoc to engine element system (Game, GameElement, Space, Piece, Card, etc.)
- [x] 10-02: Add JSDoc to engine action and flow systems (Action builder, flow DSL)
- [x] 10-03: Add JSDoc to testing package (test utilities, assertions, debug)

**Details:**
BoardSmith is a library. Library users need clear JSDoc documentation for IDE autocompletion and understanding APIs. Focus on the core packages game developers use: engine (element, action, flow systems) and testing utilities.

</details>

<details>
<summary>✅ v0.5 ESLint No-Shadow (Phase 11) — SHIPPED 2026-01-09</summary>

### Phase 11: eslint-no-shadow
**Goal**: Add ESLint with @typescript-eslint/no-shadow rule and fix all existing violations
**Depends on**: v0.4 complete
**Plans**: 1/1 complete

- [x] 11-01: Add ESLint with no-shadow rule, fix 5 violations

</details>

<details>
<summary>✅ v0.6 Players in Element Tree (Phases 12-13) — SHIPPED 2026-01-09</summary>

**Milestone Goal:** Make Player extend GameElement so players are in the searchable tree, fixing the "player data in two worlds" problem from MERC post-mortem.

#### Phase 12: player-in-tree ✅
**Goal**: Make Player extend GameElement, remove PlayerCollection, migrate to `game.all(Player)`
**Depends on**: v0.5 complete
**Research**: Unlikely (internal refactoring)
**Plans**: 3/3 complete

Plans:
- [x] 12-01: Make Player extend GameElement, remove PlayerCollection from engine
- [x] 12-02: Update all game implementations and custom Player classes
- [x] 12-03: Update tests and supporting packages, verify all pass

#### Phase 13: player-access-docs ✅
**Goal**: Document the new player access pattern (players as GameElements, anti-patterns to avoid)
**Depends on**: Phase 12
**Research**: Unlikely (documentation only)
**Plans**: 1/1 complete

Plans:
- [x] 13-01: Add comprehensive JSDoc to Player class and Game player helpers

</details>

<details>
<summary>✅ v0.7 Condition Tracing Refactor (Phases 14-16) — SHIPPED 2026-01-10</summary>

**Milestone Goal:** Redesign action conditions to use object-based API where labels are structurally required, making detailed debugging automatic and mandatory.

#### Phase 14: condition-api-refactor ✅
**Goal**: Implement object-based condition API, remove ConditionTracer
**Depends on**: v0.6 complete
**Plans**: 2/2 complete

Plans:
- [x] 14-01: Add condition API types and update Action builder
- [x] 14-02: Implement auto-tracing in ActionExecutor, remove ConditionTracer

#### Phase 15: game-migrations ✅
**Goal**: Update all BoardSmith games to new condition format
**Depends on**: Phase 14
**Plans**: 2/2 complete

Plans:
- [x] 15-01: Migrate all game conditions to object format
- [x] 15-02: Migrate test file conditions to object format

#### Phase 16: docs-migration-guide ✅
**Goal**: Update documentation and write migration guide for merc team
**Depends on**: Phase 15
**Plans**: 1/1 complete

Plans:
- [x] 16-01: Update docs, create condition-migration-guide.md

</details>

<details>
<summary>✅ v0.8 HMR Reliability (Phases 17-19) — SHIPPED 2026-01-11</summary>

**Milestone Goal:** Make HMR work reliably during development by bypassing replay and directly transferring game state to new code. Target: 90% of changes work seamlessly, with clear feedback and fast recovery when they don't.

**Design Principle:** Pit of success — the easy/natural path is the correct path. No special hooks or annotations required. Use TypeScript idioms (getters for derived values).

#### Phase 17: dev-state-transfer ✅
**Goal**: Bypass replay, directly transfer game state to new class definitions
**Depends on**: v0.7 complete
**Research**: Unlikely (internal refactoring)
**Plans**: 1/1 complete

Plans:
- [x] 17-01: Create dev-state.ts, integrate into reloadWithCurrentRules, add tests

#### Phase 18: validation-layer ✅
**Goal**: Clear error messages when state transfer fails, graceful flow position recovery
**Depends on**: Phase 17
**Research**: Unlikely (internal)
**Plans**: 1/1 complete

Plans:
- [x] 18-01: Add validation layer with structured errors and flow recovery

#### Phase 19: dev-checkpoints ✅
**Goal**: Fast recovery via auto-checkpoints when HMR fails
**Depends on**: Phase 18
**Research**: Unlikely (internal)
**Plans**: 1/1 complete

Plans:
- [x] 19-01: Add checkpoint types, CheckpointManager, GameSession integration, tests

</details>

<details>
<summary>✅ v0.9 Parallel AI Training — SHIPPED 2026-01-13</summary>

**Milestone Goal:** Add worker thread parallelization to `train-ai` to utilize multiple CPU cores, achieving near-linear speedup on modern machines.

#### Phase 20: simulator-exports ✅
**Goal**: Export `simulateSingleGame` and prepare serializable simulation options
**Depends on**: v0.8 complete
**Research**: Unlikely (internal refactoring)
**Plans**: 1/1 complete

Plans:
- [x] 20-01: Export simulateSingleGame, add serializable types and helpers

#### Phase 21: worker-infrastructure ✅
**Goal**: Create simulation-worker.ts and parallel-simulator.ts for multi-core execution
**Depends on**: Phase 20
**Research**: Unlikely (Node.js worker_threads API)
**Plans**: 1/1 complete

Plans:
- [x] 21-01: Create simulation-worker.ts and parallel-simulator.ts

#### Phase 22: cli-integration ✅
**Goal**: Add --parallel and --workers CLI flags, integrate with trainer
**Depends on**: Phase 21
**Research**: Unlikely (internal)
**Plans**: 1/1 complete

Plans:
- [x] 22-01: Add CLI flags and parallel simulation integration

#### Phase 23: verification ✅
**Goal**: Verify correctness (same seed = same results), benchmark speedup
**Depends on**: Phase 22
**Research**: Unlikely (testing)
**Plans**: 1/1 complete

Plans:
- [x] 23-01: Add parallel simulator tests and document benchmark results

</details>

### ✅ v1.0 AI System Overhaul — SHIPPED 2026-01-15

**Milestone Goal:** Transform AI training from broken/useless to a tiered system that produces quality opponents with minimal designer effort.

#### Phase 24: game-type-detection ✅
**Goal**: Analyze win conditions to auto-categorize games (connection, territory, capture, racing) and apply appropriate Tier 1 zero-config heuristics
**Depends on**: v0.9 complete
**Research**: Unlikely (internal patterns, analyzing existing game definitions)
**Plans**: 2/2 complete

Plans:
- [x] 24-01: Add GameType enum, WinConditionInfo, and analyzeWinConditions to introspector
- [x] 24-02: Add type-specific zero-config heuristic features with generateCandidateFeatures

#### Phase 25: structural-features ✅
**Goal**: Enhance introspector to detect connectivity patterns, graph-based features (paths, bridges, reachability), influence maps, and threat detection
**Depends on**: Phase 24
**Research**: Likely (graph algorithms, influence mapping patterns)
**Research topics**: Graph algorithms for connectivity, influence map implementations, threat detection patterns
**Plans**: 2/2 complete

Plans:
- [x] 25-01: Add shortest path analysis utility and path-distance feature templates for connection games
- [x] 25-02: Add threat detection features for capture games (diagonal threat analysis, piece safety)

#### Phase 26: training-improvements
**Goal**: Add mutation/evolution of feature weights, use stronger MCTS as training oracle, ensure training produces measurable improvement (Tier 2)
**Depends on**: Phase 25
**Research**: Likely (evolutionary algorithms, mutation strategies)
**Research topics**: Evolutionary algorithm patterns, genetic programming for weights, fitness function design
**Plans**: 3/3 complete

Plans:
- [x] 26-01: Add benchmark infrastructure and separated oracle/trained MCTS configs
- [x] 26-02: Implement µ+λ evolution strategy for weight optimization
- [x] 26-03: Integrate evolution into training loop with CLI options (partially verified)

#### Phase 26.1: parallel-only-training (INSERTED) ✅
**Goal**: Consolidate training harnesses - make parallel the only execution path, eliminating duplicate AITrainer vs parallel-path code
**Depends on**: Phase 26
**Research**: Unlikely (internal refactoring)
**Plans**: 1/1 complete

Plans:
- [x] 26.1-01: Create ParallelTrainer, update train-ai.ts, remove --parallel flag

**Details:**
Consolidated dual-path training to single ParallelTrainer:
- Created ParallelTrainer class wrapping parallel simulation with iteration logic
- Removed 147 lines of duplicate code from train-ai.ts
- Evolution now works in parallel mode

#### Phase 27: llm-strategy-generation ✅
**Goal**: `/generate-ai` Claude Code slash command that guides Claude through generating custom evaluation functions (Tier 3)
**Depends on**: Phase 26.1
**Research**: Not needed (leveraged existing slash command infrastructure)
**Plans**: 1/1 complete

Plans:
- [x] 27-01: Create /generate-ai slash command template, instructions, and tiered AI documentation

#### Phase 28: integration-verification ✅
**Goal**: Unified CLI with tiered AI system, documentation, multi-game validation (test with Hex + at least one other game type)
**Depends on**: Phase 27
**Research**: Unlikely (internal wiring, docs, testing)
**Plans**: 1/1 complete

Plans:
- [x] 28-01: Validate tiered AI system with multi-game types, update PROJECT.md

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. game-session refactoring | v0.1 | 4/4 | Complete | 2026-01-08 |
| 2. useActionController refactoring | v0.1 | 4/4 | Complete | 2026-01-08 |
| 3. action refactoring | v0.1 | 3/3 | Complete | 2026-01-08 |
| 4. test file refactoring | v0.1 | 3/3 | Complete | 2026-01-08 |
| 5. type-safety | v0.2 | 3/3 | Complete | 2026-01-08 |
| 6. error-handling | v0.2 | 3/3 | Complete | 2026-01-09 |
| 7. documentation | v0.2 | 3/3 | Complete | 2026-01-09 |
| 8. concerns-cleanup | v0.2 | 1/1 | Complete | 2026-01-09 |
| 9. flow-engine-docs | v0.3 | 1/1 | Complete | 2026-01-09 |
| 10. public-api-jsdoc | v0.4 | 3/3 | Complete | 2026-01-09 |
| 11. eslint-no-shadow | v0.5 | 1/1 | Complete | 2026-01-09 |
| 12. player-in-tree | v0.6 | 3/3 | Complete | 2026-01-09 |
| 13. player-access-docs | v0.6 | 1/1 | Complete | 2026-01-09 |
| 14. condition-api-refactor | v0.7 | 2/2 | Complete | 2026-01-10 |
| 15. game-migrations | v0.7 | 2/2 | Complete | 2026-01-10 |
| 16. docs-migration-guide | v0.7 | 1/1 | Complete | 2026-01-10 |
| 17. dev-state-transfer | v0.8 | 1/1 | Complete | 2026-01-11 |
| 18. validation-layer | v0.8 | 1/1 | Complete | 2026-01-11 |
| 19. dev-checkpoints | v0.8 | 1/1 | Complete | 2026-01-11 |
| 20. simulator-exports | v0.9 | 1/1 | Complete | 2026-01-13 |
| 21. worker-infrastructure | v0.9 | 1/1 | Complete | 2026-01-13 |
| 22. cli-integration | v0.9 | 1/1 | Complete | 2026-01-13 |
| 23. verification | v0.9 | 1/1 | Complete | 2026-01-13 |
| 24. game-type-detection | v1.0 | 2/2 | Complete | 2026-01-14 |
| 25. structural-features | v1.0 | 2/2 | Complete | 2026-01-14 |
| 26. training-improvements | v1.0 | 3/3 | Complete | 2026-01-14 |
| 26.1 parallel-only-training | v1.0 | 1/1 | Complete | 2026-01-14 |
| 27. llm-strategy-generation | v1.0 | 1/1 | Complete | 2026-01-15 |
| 28. integration-verification | v1.0 | 1/1 | Complete | 2026-01-15 |
