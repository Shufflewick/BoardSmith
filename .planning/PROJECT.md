# BoardSmith

## What This Is

A library for designing digital board games. Provides a rules engine, UI components, AI bots, and CLI tooling for building and testing board games that run on web and server platforms.

## Core Value

Make board game development fast and correct — the framework handles multiplayer, AI, and UI so designers focus on game rules.

## Current Milestone: v2.4 Animation Event System

**Goal:** Infrastructure-level support for dramatic UI playback of game calculations — enabling games like MERC to animate combat sequences while game state advances immediately.

**Target features:**
- `game.emitAnimationEvent(type, data)` API for emitting events during calculations
- Soft continuation model (state advances, UI plays back asynchronously)
- Animation events as parallel channel (separate from commands, not state mutations)
- Automatic ActionPanel coordination (waits for animations before showing new decisions)
- Event serialization with game state (checkpoint/replay safe)
- `useAnimationEvents` composable for UI consumption
- Integration with existing `useAutoAnimations`

## Previous: v2.3 Shipped

BoardSmith is now a single `boardsmith` npm package with 11 subpath exports. Games live in separate repositories at `~/BoardSmithGames/`.

**v2.3 Delivered:** Nomenclature standardization — consistent terminology (Table, Seat, Pick) across the entire codebase, documentation, and games.

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
- ✓ State-driven `/design-game` skill that adapts behavior based on project state — v2.1
- ✓ Structured interview for core loop (components, turns, rounds, end condition) — v2.1
- ✓ Governor pattern to keep designers focused, defer details to backlog — v2.1
- ✓ Planning artifacts (PROJECT.md, STATE.md, HISTORY.md) for session continuity — v2.1
- ✓ Phase 1 code generation (core event loop + basic UI) — v2.1
- ✓ Playtest-driven iteration (one feature per phase, test before continuing) — v2.1
- ✓ `npx boardsmith claude` setup for skill + dependencies — v2.1
- ✓ Composable aspect detection from interview answers — v2.2
- ✓ Aspect templates (Dice, PlayingCards, HexGrid, SquareGrid) — v2.2
- ✓ Aspect-driven code generation with UI components — v2.2
- ✓ Nomenclature dictionary created as authoritative reference — v2.3
- ✓ `GameBoard.vue` → `GameTable.vue` across all games and templates — v2.3
- ✓ `position` → `seat` in API and documentation — v2.3
- ✓ `selection` → `pick` in API and documentation — v2.3
- ✓ All documentation uses standardized terminology — v2.3

### Active

- [ ] Animation events emittable during game execution via `game.emitAnimationEvent()`
- [ ] Animation event buffer serializes with game state
- [ ] `pendingAnimationEvents` getter returns unacknowledged events
- [ ] `acknowledgeAnimationEvents(upToId)` clears consumed events
- [ ] `PlayerGameState` includes `animationEvents` array
- [ ] `GameSession.acknowledgeAnimations()` method (not an action)
- [ ] `useAnimationEvents` composable with handler registration
- [ ] `useActionController` gates ActionPanel on pending animations
- [ ] `useAutoAnimations` integrates custom event handlers
- [ ] Snapshot serialization includes animation buffer
- [ ] Documentation for animation event system

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
| 6-question interview replaces 16-question | Minimal first pass, gather core loop only, defer details | ✓ Good |
| ACDR governor pattern | Acknowledge, Capture, Defer, Redirect — preserves ideas without blocking | ✓ Good |
| Self-contained slash commands | Embed instructions into installed .md files, no external file reads | ✓ Good |
| boardsmith init then modify | Scaffolding creates correct structure, Claude customizes based on interview | ✓ Good |
| tsc --noEmit verification | Catches real errors before playtest, no extra tooling needed | ✓ Good |
| Resume without interrogation | Detect state from STATE.md, don't ask designer questions | ✓ Good |
| Install as default action | `boardsmith claude` runs install without subcommand | ✓ Good |
| Composable aspects over --type flag | Games have multiple component types; aspects are detected and combined | ✓ Good |
| Table not Board for game surface | "Board" implies physical constraint; "Table" is where game happens | ✓ Good |
| Seat not Position for players | Position is overloaded (grid position); Seat is specific to players | ✓ Good |
| Pick not Selection for choices | Selection is generic; Pick conveys intent of choosing from options | ✓ Good |
| Deprecation aliases for renamed APIs | Allows gradual migration; old names still work | ✓ Good |

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

**Terminology:** Authoritative reference at `docs/nomenclature.md` with 33 terms across 7 categories.

---
*Last updated: 2026-01-22 after starting v2.4 milestone*
