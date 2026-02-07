# BoardSmith

## What This Is

A library for designing digital board games. Provides a rules engine, UI components, AI bots, and CLI tooling for building and testing board games that run on web and server platforms.

## Core Value

Make board game development fast and correct — the framework handles multiplayer, AI, and UI so designers focus on game rules.

## Previous: v2.9 Shipped

Theatre View — replaced fire-and-forget animation events with `game.animate()` scoped callbacks, mutation capture, engine-level theatre state, session/UI integration, and clean migration. Components never show "the future" while animations play.

**v2.9 Delivered:** Theatre View with `game.animate()` API, mutation capture, per-event theatre advancement, session broadcasting, `useCurrentView()` opt-in, ActionPanel gating, skip functionality, and full game migration.

## Previous: v2.8 Shipped

Disabled Selections — added `disabled` state to element and choice selections with mandatory reason strings, `AnnotatedChoice<T>` return type, defense-in-depth enforcement at engine/client/UI layers.

**v2.8 Delivered:** Disabled selections with `AnnotatedChoice<T>` type, reason-required callbacks, wire threading, ActionPanel/board rendering, auto-fill filtering, and 27 new tests.

## Previous: v2.7 Shipped

Dead Code & Code Smell Cleanup — fixed stale config paths, consolidated lobby types, removed deprecated flying APIs, extracted shared helpers, created BREAKING.md.

**v2.7 Delivered:** Pristine codebase with Pit of Success APIs — removed deprecated code, consolidated types, extracted helpers, documented breaking changes.

## Previous: v2.6 Shipped

Animation API consolidation — extended `useFLIP` with multi-container support, added `flyOnAppear`/`autoWatch`/`countBasedRoutes` to `useFlyingElements`, removed 7 deprecated composables.

**v2.6 Delivered:** Consolidated animation APIs — `useFLIP` + `useFlyingElements` replace deprecated composables with clean break.

## Previous: v2.5 Shipped

Player colors are now a first-class engine-managed property with game-level configuration. Players get auto-assigned colors from a configurable palette, with optional lobby color selection and conflict validation.

**v2.5 Delivered:** Player Colors Refactor — `player.color` property, `GameOptions.colors` configuration, lobby color picker with conflict detection, deprecated `DEFAULT_PLAYER_COLORS`.

## Previous: v2.4 Shipped

BoardSmith now includes animation event infrastructure for dramatic UI playback. Games can emit animation events during calculations while state advances immediately (soft continuation pattern).

**v2.4 Delivered:** Animation Event System — `game.emitAnimationEvent()` API, session integration, `useAnimationEvents` composable, ActionPanel gating, and documentation.

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
- ✓ Animation events emittable via `game.emitAnimationEvent()` — v2.4
- ✓ Animation event buffer serializes with game state — v2.4
- ✓ `pendingAnimationEvents` getter returns unacknowledged events — v2.4
- ✓ `acknowledgeAnimationEvents(upToId)` clears consumed events — v2.4
- ✓ `PlayerGameState` includes `animationEvents` array — v2.4
- ✓ `GameSession.acknowledgeAnimations()` method — v2.4
- ✓ `useAnimationEvents` composable with handler registration — v2.4
- ✓ `useActionController` gates ActionPanel on pending animations — v2.4
- ✓ `useAutoAnimations` integrates custom event handlers — v2.4
- ✓ Snapshot serialization includes animation buffer — v2.4
- ✓ Animation event system documented — v2.4
- ✓ `player.color` property on Player class — v2.5
- ✓ Game-level color palette configuration — v2.5
- ✓ Game-level `colorSelectionEnabled` flag — v2.5
- ✓ Auto-assignment of colors based on seat — v2.5
- ✓ Color change API with exclusivity enforcement — v2.5
- ✓ Validation: error if maxPlayers > colors.length — v2.5
- ✓ Lobby UI: color picker when enabled — v2.5
- ✓ PlayerStats: color display when enabled — v2.5
- ✓ Deprecated DEFAULT_PLAYER_COLORS with migration guidance — v2.5
- ✓ Hex game migrated to player.color — v2.5
- ✓ Checkers game migrated to player.color with custom palette — v2.5
- ✓ useFLIP multi-container support restored — v2.6
- ✓ flyOnAppear helper in useFlyingElements — v2.6
- ✓ autoWatch for automatic cross-container flying — v2.6
- ✓ countBasedRoutes for hidden element tracking — v2.6
- ✓ Deprecated composables removed (7 files) — v2.6
- ✓ Fixed stale config path references (vitest.config.ts, eslint.config.mjs) — v2.7
- ✓ Removed deprecated `flyCard()`, `flyCards()`, `FlyCardOptions` — v2.7
- ✓ Migrated internal callers to `fly()`, `flyMultiple()`, `FlyConfig` — v2.7
- ✓ Consolidated lobby types to `types/protocol.ts` — v2.7
- ✓ Extracted shared completion logic from FlowEngine — v2.7
- ✓ Extracted auto-fill pattern helper in useActionController — v2.7
- ✓ Refactored `suppressNextWatcherFetch` to scoped fetchedSelections Set — v2.7
- ✓ Fixed redundant `unknown | undefined` type — v2.7
- ✓ Removed vestigial `src/ai/utils.ts` — v2.7
- ✓ Created BREAKING.md documenting all API changes — v2.7
- ✓ `disabled` option on `chooseElement`, `fromElements`, `chooseFrom` with reason-required callbacks — v2.8
- ✓ `AnnotatedChoice<T>` type with `{ value, disabled }` returned from `getChoices()` — v2.8
- ✓ `hasValidSelectionPath()` only counts enabled items (optional selections still available) — v2.8
- ✓ `validateSelection()` rejects disabled items with reason in error message — v2.8
- ✓ `ValidElement` and `ChoiceWithRefs` gain `disabled?: string` on the wire — v2.8
- ✓ ActionPanel renders disabled items greyed out with tooltip reason — v2.8
- ✓ `useBoardInteraction` gains `isDisabledElement()` method — v2.8
- ✓ Custom UIs read `item.disabled` from `validElements` and `getChoices()` — v2.8
- ✓ Auto-fill skips disabled items; `fill()` rejects disabled with surfaced reason — v2.8
- ✓ Documentation updated (migration guide, BREAKING.md) — v2.8
- ✓ `game.animate(type, data, callback)` scoped callback API with mutation capture — v2.9
- ✓ Theatre view maintained at engine/session layer with per-event advancement — v2.9
- ✓ Theatre view as default client view, current view via `useCurrentView()` opt-in — v2.9
- ✓ `PlayerGameState` carries theatre view (default) and current view (opt-in) — v2.9
- ✓ `useAnimationEvents` composable updated for `animate()` event flow — v2.9
- ✓ ActionPanel renders from theatre state when flow yields mid-animation — v2.9
- ✓ All players receive theatre view — multiplayer sync without spoilers — v2.9
- ✓ Theatre view serializes/restores with game state (checkpoint/replay safe) — v2.9
- ✓ `emitAnimationEvent` removed — `game.animate()` is sole animation API — v2.9
- ✓ Documentation updated (BREAKING.md, ui-components.md, nomenclature.md) — v2.9
- ✓ Demo animation and cribbage games migrated to `game.animate()` — v2.9

### Active

(No active requirements — ready for next milestone)

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
| Soft continuation pattern for animations | Game state advances immediately, UI plays back asynchronously | ✓ Good |
| Animation events as parallel channel | Not commands, not state mutations — UI hints only | ✓ Good |
| acknowledgeAnimations on session not game | Avoids polluting game state with UI concerns | ✓ Good |
| Animation buffer serializes with game state | Checkpoint/replay safety | ✓ Good |
| ActionPanel gates on animations | New decisions wait for animation completion | ✓ Good |
| Seat-based color conflict detection | Works for AI slots (no playerId); includes player name in error | ✓ Good |
| Auto-inject color picker via computed | Games don't define color options; UI auto-injects when enabled | ✓ Good |
| JSDoc @deprecated vs runtime warning | Editor-visible with zero runtime cost | ✓ Good |
| Custom game colors in boardsmith.json | Checkers preserves red/dark theme via config, not code | ✓ Good |
| Engine guarantees player.color | Remove fallback chains; null-safety only for defensive coding | ✓ Good |
| Consolidated animation APIs | useFLIP + useFlyingElements replace 7 deprecated composables | ✓ Good |
| autoWatch for cross-container flying | Declarative API replaces manual watches | ✓ Good |
| No backward compatibility for deprecated APIs | Clean break avoids confusion about which API to use | ✓ Good |
| `disabled` runs only on filter-passed items | Clean separation: filter = visibility, disabled = selectability | ✓ Good |
| `disabled` returns `string \| false` (no bare `true`) | Forces developers to provide a reason — pit of success | ✓ Good |
| `AnnotatedChoice<T>` has `value` + `disabled` only | Display is layered on by session/UI, not engine concern | ✓ Good |
| `disabled?: string` on wire (optional, not `string \| false`) | No need to send `false` for every selectable item | ✓ Good |
| Scoped callback `game.animate()` over fire-and-forget `emitAnimationEvent` | Ties mutations to events — framework can track what changed per event | ✓ Good |
| Theatre view as default, current view opt-in | Pit of success — correct behavior is the easy path | ✓ Good |
| Per-event advancement over per-batch | Finer control — theatre view steps through narrative one event at a time | ✓ Good |
| Replace `emitAnimationEvent` entirely (no backward compat) | Clean break — one API, no confusion about which to use | ✓ Good |

## Context

~79k LOC TypeScript/Vue in unified `src/` structure.
Tech stack: TypeScript 5.7, Vue 3.5, Vitest, npm.
633 unit tests passing (15 e2e tests require running server).
Shipped v2.9 with theatre view — 100 new tests added, 119 migrated to `game.animate()`.

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
*Last updated: 2026-02-07 after v2.9 Theatre View milestone*
