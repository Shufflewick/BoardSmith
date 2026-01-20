# BoardSmith

## What This Is

A library for designing digital board games. Provides a rules engine, UI components, AI bots, and CLI tooling for building and testing board games that run on web and server platforms.

## Core Value

Make board game development fast and correct — the framework handles multiplayer, AI, and UI so designers focus on game rules.

## Current Milestone: v2.1 Design-Game Skill Redesign

**Goal:** Transform `/design-game` from a monolithic code generator into an iterative, state-driven skill that guides non-programmer game designers through building games one phase at a time.

**Core insight:** Game design is discovery — you don't know what a game needs until you playtest it. The skill should build a minimal core loop first, then add features incrementally based on playtesting feedback.

## Current State: v2.0 Shipped

BoardSmith is now a single `boardsmith` npm package with 11 subpath exports. Games live in separate repositories at `~/BoardSmithGames/`.

**Package structure:**
- Single package: `boardsmith` (replaces 12 `@boardsmith/*` packages)
- Subpath exports: `boardsmith`, `boardsmith/ui`, `boardsmith/session`, `boardsmith/testing`, `boardsmith/eslint-plugin`, `boardsmith/ai`, `boardsmith/ai-trainer`, `boardsmith/client`, `boardsmith/server`, `boardsmith/runtime`, `boardsmith/worker`
- Source: Unified `src/` directory with colocated tests
- Tooling: npm (not pnpm)

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
- ✓ `boardsmith pack` command with timestamp versioning — v1.2
- ✓ `--target` flag for consumer project integration — v1.2
- ✓ Single `boardsmith` package replaces all `@boardsmith/*` packages — v2.0
- ✓ 11 subpath exports configured — v2.0
- ✓ Collapsed `src/` structure with colocated tests — v2.0
- ✓ npm instead of pnpm — v2.0
- ✓ 9 games extracted to `~/BoardSmithGames/` — v2.0
- ✓ CLI updated for monorepo and standalone contexts — v2.0
- ✓ Documentation and migration guide complete — v2.0

### Active

- [ ] State-driven `/design-game` skill that adapts behavior based on project state
- [ ] Structured interview for core loop (components, turns, rounds, end condition)
- [ ] Governor pattern to keep designers focused, defer details to backlog
- [ ] Planning artifacts (PROJECT.md, STATE.md, HISTORY.md) for session continuity
- [ ] Phase 1 code generation (core event loop + basic UI)
- [ ] Playtest-driven iteration (one feature per phase, test before continuing)
- [ ] `npx boardsmith claude` setup for skill + dependencies

### Out of Scope

- Backward compatibility — no fallbacks, clean break to v2.0
- Multiple package versions — single version for entire library
- Games in main repo — games are separate repos at `~/BoardSmithGames/`

## Constraints

- **Tests**: All existing tests must continue to pass
- **Tech stack**: TypeScript 5.7, Vue 3.5, Vitest, npm
- **Pit of success**: One right way to import — subpath exports, no re-exports at root
- **Games as validation**: All extracted games must work as standalone repos

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

~75k LOC TypeScript/Vue in unified `src/` structure.
Tech stack: TypeScript 5.7, Vue 3.5, Vitest, npm.
528 unit tests passing (15 e2e tests require running server).

**Current structure:**
- `src/engine/` — Core game logic
- `src/ui/` — Vue components
- `src/session/` — Game session management
- `src/cli/` — CLI commands
- `src/testing/` — Test utilities
- `src/eslint-plugin/` — ESLint rules
- `src/ai/` — MCTS and AI logic
- `src/ai-trainer/` — Training infrastructure
- `src/client/` — Client runtime
- `src/server/` — Server runtime
- `src/runtime/` — Shared runtime
- `src/worker/` — Web worker support

**Games:** 9 games extracted to `~/BoardSmithGames/` (hex, checkers, cribbage, go-fish, polyhedral-potions, floss-bitties, demo-action-panel, demo-animation, demo-complex-ui)

One external team using BoardSmith — migration guide at `docs/migration-guide.md`.

---
*Last updated: 2026-01-19 after starting v2.1 milestone*
