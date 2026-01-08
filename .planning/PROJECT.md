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

### Active

- [ ] Split `game-session.ts` (2,585 lines) into focused modules
- [ ] Split `useActionController.ts` (1,807 lines) into focused composables
- [ ] Split `action.ts` (1,845 lines) into focused modules
- [ ] Split `useActionController.test.ts` (2,088 lines) into focused test files

### Out of Scope

- Behavior changes — pure refactoring only, no bug fixes or feature work
- New test coverage — restructure existing tests, don't add new ones
- API changes — public exports must remain compatible
- Other tech debt items — type safety, error handling, docs are separate efforts

## Context

BoardSmith is a library for designing digital board games. The codebase is a TypeScript monorepo with 11 packages spanning engine, runtime, session, server, client, and UI layers.

**Target files and their responsibilities:**

1. **`packages/session/src/game-session.ts`** (2,585 lines)
   - GameSession class: unified session management across platforms
   - Handles storage adapters, broadcast adapters, AI controller
   - Complex state machine for game lifecycle

2. **`packages/ui/src/composables/useActionController.ts`** (1,807 lines)
   - Vue composable for action UI state management
   - Complex state machine with setTimeout-based followUp handling
   - Known fragile area with race conditions

3. **`packages/engine/src/action/action.ts`** (1,845 lines)
   - Action class with fluent builder API
   - Selection definitions, conditions, execution logic
   - Core abstraction used throughout the engine

4. **`packages/ui/tests/useActionController.test.ts`** (2,088 lines)
   - Comprehensive test suite for useActionController
   - Should mirror the structure of the refactored composable

## Constraints

- **Tests**: All existing tests must continue to pass after refactoring
- **Tech stack**: TypeScript 5.7, Vue 3.5, Vitest — no new dependencies
- **Exports**: Public package exports must remain compatible

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Refactor all four files | Complete the tech debt cleanup for large files | — Pending |
| Pure refactoring only | Minimize risk, changes are easier to verify | — Pending |

---
*Last updated: 2026-01-08 after initialization*
