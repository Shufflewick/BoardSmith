# BoardSmith Large File Refactoring

## What This Is

A focused refactoring effort to split BoardSmith's largest files into smaller, more maintainable modules. The codebase has four files exceeding 1800 lines that have grown organically and become difficult to navigate and modify.

## Core Value

Improve code maintainability, testability, and navigability equally—making it easier to understand, modify, and test the codebase going forward.

## Requirements

### Validated

- ✓ Game rules layer isolated from platform/networking — existing
- ✓ Event sourcing via Command pattern — existing
- ✓ Fluent action/flow builder APIs — existing
- ✓ Cross-platform deployment (Node.js, Cloudflare Workers) — existing
- ✓ Real-time multiplayer via WebSocket — existing
- ✓ Vue 3 UI component library — existing
- ✓ AI bot support (MCTS, random) — existing
- ✓ CLI tooling (dev, build, test, validate) — existing
- ✓ Split `game-session.ts` into focused modules — v0.1 (2,585 → 1,249 lines)
- ✓ Split `useActionController.ts` into focused composables — v0.1 (1,807 → 1,423 lines)
- ✓ Split `action.ts` into focused modules — v0.1 (1,845 → 1,361 lines)
- ✓ Split `useActionController.test.ts` into focused test files — v0.1 (2,088 → 3 files)
- ✓ Type-safe choice validation in useActionController — v0.2 (type guards replace `as any`)
- ✓ WeakMap pattern for DOM metadata in useZoomPreview — v0.2 (eliminates `as any`)
- ✓ Error logging for silent catch blocks — v0.2 (boardRefs, JSON.parse)
- ✓ MCTS Bot documentation — v0.2 (section dividers + JSDoc)
- ✓ CONCERNS.md all items resolved — v0.2
- ✓ FlowEngine section dividers — v0.3 (7 sections grouping major subsystems)
- ✓ FlowEngine JSDoc improvements — v0.3 (key complex methods documented)
- ✓ Element system JSDoc — v0.4 (Game, GameElement, Space, Piece, Card, etc.)
- ✓ Action/Flow system JSDoc — v0.4 (Action builder, ActionExecutor, FlowEngine)
- ✓ Testing package JSDoc — v0.4 (TestGame, assertions, fixtures, debug)
- ✓ Object-based conditions with labeled predicates — v0.7 (automatic debug tracing)
- ✓ Pit of success condition API — v0.7 (TypeScript enforces object format)
- ✓ ConditionTracer removed — v0.7 (auto-tracing replaces manual tracing)
- ✓ All games migrated to object conditions — v0.7 (18+ conditions converted)
- ✓ Parallel AI training with worker threads — v0.9 (8.3x speedup)
- ✓ `--parallel` and `--workers` CLI flags — v0.9
- ✓ Work-stealing pattern for load balancing — v0.9
- ✓ Deterministic parallel simulation — v0.9 (same seed = same results)
- ✓ train-ai respects paths.rules from boardsmith.json — v0.9
- ✓ Game type auto-detection (connection, capture, collection, racing) — v1.0
- ✓ Type-specific feature generation via introspection — v1.0
- ✓ Parallel training with evolution support — v1.0
- ✓ /generate-ai slash command for LLM-assisted generation — v1.0
- ✓ Playout lookahead for discovering forcing sequences — v1.1
- ✓ Threat response hooks for blocking opponent wins — v1.1
- ✓ RAVE algorithm for rapid action value estimation — v1.1
- ✓ Gradient objectives (0-1) for finer evaluation — v1.1
- ✓ Dynamic UCT constant tuned by game phase — v1.1
- ✓ Proof Number Search for forced win/loss detection — v1.1

### Active

(Ready for next milestone)

### Out of Scope

- Behavior changes — pure refactoring only, no bug fixes or feature work
- New test coverage — restructure existing tests, don't add new ones
- API changes — public exports must remain compatible

## Constraints

- **Tests**: All existing tests must continue to pass after refactoring
- **Tech stack**: TypeScript 5.7, Vue 3.5, Vitest — no new dependencies
- **Exports**: Public package exports must remain compatible

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Refactor all four files | Complete the tech debt cleanup for large files | ✓ Good |
| Pure refactoring only | Minimize risk, changes are easier to verify | ✓ Good |
| LobbyManager holds reference to StoredGameState | Mutations flow through without copying | ✓ Good |
| Callback pattern for cross-module coordination | GameSession controls AI scheduling | ✓ Good |
| Handlers expose updateRunner() method | Hot reload support for reloadWithCurrentRules | ✓ Good |
| Extract types + helpers only, not stateful composables | actionSnapshot is central; Pit of Success pattern requires centralized state | ✓ Good |
| ActionExecutor kept intact | Cohesive class with internal method dependencies | ✓ Good |

## Context

Shipped v1.1 with ~99k LOC TypeScript/Vue.
Tech stack: TypeScript 5.7, Vue 3.5, Vitest.
All 493 unit tests passing.
All milestones complete: v0.1-v1.1 (file refactoring, concerns cleanup, documentation, ESLint, players in tree, condition tracing, HMR reliability, parallel AI training, AI system overhaul, MCTS strategy improvements).
Ready to start next milestone.

---
*Last updated: 2026-01-16 after v1.1 milestone*
