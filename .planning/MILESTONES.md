# Project Milestones: BoardSmith

## v2.5 Player Colors Refactor (Shipped: 2026-01-25)

**Delivered:** Engine-managed player colors with `player.color` property, game-level color configuration, lobby color picker, and automatic conflict validation — eliminating the fragmented `DEFAULT_PLAYER_COLORS` pattern.

**Phases completed:** 64-68 (5 phases, 5 plans total)

**Key accomplishments:**

- Added `player.color` property auto-assigned by engine from configurable palette
- Game-level `colors` and `colorSelectionEnabled` configuration in GameOptions
- Color conflict validation in lobby with clear error messages
- Auto-injected color picker in WaitingRoom when enabled
- Conditional player color indicators in PlayersPanel
- Deprecated DEFAULT_PLAYER_COLORS with migration guidance
- Migrated Hex and Checkers games to new API

**Stats:**

- 37 files changed
- +4,130 / -81 lines
- 5 phases, 5 plans
- 47 days from start to ship (2025-12-09 → 2026-01-25)

**Git range:** `fb42d3f` → `826c5ed`

**What's next:** Player color system complete. Ready for next milestone.

---

## v2.4 Animation Event System (Shipped: 2026-01-22)

**Delivered:** Infrastructure-level support for dramatic UI playback of game calculations — enabling games to animate combat sequences, card draws, and other events while game state advances immediately (soft continuation pattern).

**Phases completed:** 59-63 (5 phases, 6 plans total)

**Key accomplishments:**

- Added `game.emitAnimationEvent(type, data, options?)` API with unique IDs and timestamps
- Animation buffer serializes/restores with game state (checkpoint/replay safe)
- Session layer exposes `animationEvents` array and `acknowledgeAnimations()` method
- Created `useAnimationEvents` composable with handler registration, skip, and pause control
- ActionPanel automatically gates on pending animations (`showActionPanel` computed)
- Documented animation event system in ui-components.md and nomenclature.md

**Stats:**

- 42 files changed
- +7,668 / -107 lines
- 5 phases, 6 plans
- Same day from start to ship (2026-01-22)

**Git range:** `ebcb3b2` → `0e2ab7d`

**What's next:** Animation infrastructure complete. Ready for game developers to implement custom animations.

---

## v2.3 Nomenclature Standardization (Shipped: 2026-01-22)

**Delivered:** Consistent terminology across the entire codebase, documentation, and games — standardizing on Table (not Board), Seat (not Position), and Pick (not Selection) before external adoption.

**Phases completed:** 54-58 (5 phases, 14 plans total)

**Key accomplishments:**

- Created authoritative `docs/nomenclature.md` with 33 terms across 7 categories
- Renamed `GameBoard.vue` → `GameTable.vue` in all 4 extracted games and CLI templates
- Renamed `Player.position` → `Player.seat` across engine, session, client, and UI layers
- Renamed `currentSelection` → `currentPick` and `SelectionHandler` → `PickHandler` with deprecation aliases
- Created `docs/migration-guide.md` with v2.3 API rename tables and migration steps
- Cross-referenced nomenclature.md from all key documentation entry points

**Stats:**

- 174 files changed
- +20,420 / -20,246 lines (net +174 lines of terminology changes)
- 5 phases, 14 plans
- 44 days from start to ship (2025-12-09 → 2026-01-22)

**Git range:** `7ba2826` → `2a431ec`

**What's next:** Terminology standardized. Ready for external adoption or next milestone.

---

## v2.2 Game Design Aspects (Shipped: 2026-01-21)

**Delivered:** Added composable aspect templates (Dice, PlayingCards, HexGrid, SquareGrid) to `/design-game` that auto-detect from interview answers and merge into generated code.

**Phases completed:** 51-53 (3 phases, 3 plans total)

**Key accomplishments:**

- Created 4 aspect templates with element setup, action patterns, and UI components
- Keyword-based aspect detection added to interview (Phase 2B)
- Multiple aspects can be detected and combined in a single game
- Templates embedded inline in instructions.md (self-contained skill)
- Aspect templates include findElements(), safe defaults, documentation links
- E2E flow verified: Interview → Detection → Template Access → Generation

**Stats:**

- 16 files changed
- +4,031 / -167 lines
- 3 phases, 3 plans
- 1 day from start to ship (2026-01-21)

**Git range:** `1ba5985` → `604160f`

**What's next:** Aspect system complete. Ready for nomenclature standardization.

---

## v2.1 Design-Game Skill Redesign (Shipped: 2026-01-19)

**Delivered:** Transformed `/design-game` from a monolithic code generator into an iterative, state-driven skill that guides non-programmer game designers through building games one phase at a time.

**Phases completed:** 47-50 (4 phases, 7 plans total)

**Key accomplishments:**

- State detection routes designers to interview (new), continuation (complete), or resume (in-progress)
- 6-question structured interview gathers core mechanics without scope creep
- Governor pattern (ACDR) captures deferred ideas while maintaining focus
- Code generation produces minimal playable game (elements, game, flow, actions)
- Continuation flow: playtest feedback → ranked options → mini-interview → feature generation
- Resume flow: checkpoint-based recovery with three-level error hierarchy
- Self-contained slash commands (no external file permission prompts)
- `npx boardsmith claude` installs everything with a single command

**Stats:**

- 5 files changed
- +1,320 / -194 lines (1,342-line instructions.md)
- 4 phases, 7 plans
- Same day from start to ship (2026-01-19)

**Git range:** `9cd5c30` → `dff1e6b`

**What's next:** /design-game skill complete. Ready for real-world testing with game designers.

---

## v2.0 Collapse the Monorepo (Shipped: 2026-01-19)

**Delivered:** Transformed BoardSmith from a pnpm monorepo with 12 `@boardsmith/*` packages into a single `boardsmith` npm package with 11 subpath exports, extracted all games to separate repos.

**Phases completed:** 39-46 (8 phases, 23 plans total)

**Key accomplishments:**

- Replaced 12 separate packages with single `boardsmith` npm package
- Consolidated 179 source files into unified `src/` structure (git history preserved)
- Configured 11 subpath exports (`boardsmith`, `boardsmith/ui`, `boardsmith/session`, etc.)
- Colocated all library tests (*.test.ts next to source files)
- Rewrote all internal imports to relative paths
- Extracted 9 games to `~/BoardSmithGames/` as standalone git repos
- Updated CLI for both monorepo and standalone game contexts
- Complete migration guide for external team

**Stats:**

- 293 files changed
- +19,773 / -7,278 lines
- 8 phases, 23 plans
- 2 days from start to ship (2026-01-18 → 2026-01-19)

**Git range:** `5bba218` → `d3fd429`

**What's next:** Package structure complete. Ready for v2.1 enhancements or new features.

---

## v1.2 Local Tarballs (Shipped: 2026-01-18)

**Delivered:** Parallel development workflow with `boardsmith pack` command producing immutable tarball snapshots.

**Phases completed:** 37-38 (2 plans total)

**Key accomplishments:**

- `boardsmith pack` command with timestamp versioning
- `--target` flag for consumer project integration
- Vendor directory management with dependency updates

**Stats:**

- 12 files modified
- +1,200 lines
- 2 phases, 2 plans
- 1 day from start to ship

**Git range:** `feat(37-01)` → `docs(38)`

**What's next:** Monorepo collapse (v2.0)

---

## v1.1 MCTS Strategy Improvements (Shipped: 2026-01-16)

**Delivered:** Advanced MCTS search techniques including playout lookahead, threat response, RAVE, gradient objectives, dynamic UCT, and proof number search - making AI play strategically better with measurable improvements.

**Phases completed:** 29-36 (+30.1 inserted), 10 plans total

**Key accomplishments:**

- Playout lookahead with depth-based presets (+17.5% P1 win rate)
- Threat response forcing via threatResponseMoves hook (blocks straight-line exploits)
- RAVE algorithm for rapid action value estimation across simulations
- Gradient objectives (0-1) replacing boolean win/loss for finer evaluation
- Dynamic UCT constant tuned by game phase (exploration → exploitation)
- Proof Number Search (+7.5% P2 win rate as disadvantaged player)

**Stats:**

- 35 files modified
- +4,943 / -152 lines
- 9 phases (including 30.1), 10 plans
- 2 days from start to ship (2026-01-15 → 2026-01-16)

**Git range:** `27c7892` → `08cd681`

**What's next:** AI system complete. Ready for new features or next milestone.

---

## v0.4 Public API Docs (Shipped: 2026-01-09)

**Delivered:** Comprehensive JSDoc documentation for all public APIs in @boardsmith/engine and @boardsmith/testing packages, enabling IDE autocompletion and clear API understanding.

**Phases completed:** 10 (3 plans total)

**Key accomplishments:**

- Element system JSDoc: Game, GameElement, Space, Piece, Card, Deck, Hand, Die, Grid classes
- Action/flow system JSDoc: Action builder methods, ActionExecutor, FlowEngine class docs
- Testing package JSDoc: TestGame, assertions, fixtures, debug utilities with @throws and @example
- Package-level @packageDocumentation with usage examples
- Established patterns: @module, @internal, @typeParam, @throws

**Stats:**

- 14 files modified
- +866 / -78 lines
- 1 phase, 3 plans
- Same day start to ship (2026-01-09)

**Git range:** `docs(10-01)` → `docs(10-03)`

**What's next:** Documentation complete. Ready for new feature work.

---

## v0.3 Flow Engine Docs (Shipped: 2026-01-09)

**Delivered:** Section dividers and JSDoc improvements to the 1032-line FlowEngine file, following the established MCTS Bot documentation pattern.

**Phases completed:** 9 (1 plan total)

**Key accomplishments:**

- 7 section dividers grouping major FlowEngine subsystems
- Enhanced JSDoc for 3 key complex methods (run, executeActionStep, resumeSimultaneousAction)
- Section divider pattern now applied to both major engine files

**Stats:**

- 4 files created/modified
- +192 / -23 lines
- 1 phase, 1 plan
- Same day start to ship (2026-01-09)

**Git range:** `docs(09-01)` commits

**What's next:** Public API JSDoc documentation (v0.4)

---

## v0.2 Concerns Cleanup (Shipped: 2026-01-09)

**Delivered:** Addressed all technical concerns from v0.1: eliminated type assertions, added error logging, improved documentation, and updated CONCERNS.md with resolution status.

**Phases completed:** 5-8 (10 plans total)

**Key accomplishments:**

- Type-safe choice validation with type guards (eliminated `as any` in useActionController)
- WeakMap pattern for DOM metadata storage (eliminated `as any` in useZoomPreview)
- Added error logging for silent catch blocks (boardRefs, JSON.parse)
- Added MCTS Bot documentation (7 section dividers + JSDoc improvements)
- Removed incomplete API (unused withChoices parameter)
- Added fallback checker warnings in code-generator
- Updated CONCERNS.md with all resolution statuses

**Stats:**

- 33 files created/modified
- +2,091 / -131 lines
- 4 phases, 10 plans
- 2 days from start to ship (2026-01-08 → 2026-01-09)

**Git range:** `docs(05)` → `docs(08-01)`

**What's next:** Project goals achieved. Ready for new feature work or next refactoring milestone.

---

## v0.1 Large File Refactoring (Shipped: 2026-01-08)

**Delivered:** Split four largest files (8,325 lines total) into 16 focused modules while preserving all public APIs and maintaining 442 passing tests.

**Phases completed:** 1-4 (14 plans total)

**Key accomplishments:**

- GameSession refactored: 2,585 → 1,249 lines (52% reduction) with 5 extracted modules
- useActionController refactored: 1,807 → 1,423 lines (21% reduction) with 3 extracted files
- Action module refactored: 1,845 → 1,361 lines (26% reduction) with builder/executor separation
- Test suite restructured: 2,088 lines split into 3 focused files with shared helpers
- All 442 unit tests passing, zero regressions

**Stats:**

- 48 files created/modified
- +8,183 / -3,461 lines (net +4,722)
- 4 phases, 14 plans, ~50 tasks
- 1 day from start to ship (2026-01-08)

**Git range:** `feat(01-01)` → `docs(04-03)`

**What's next:** Milestone complete. Project goals achieved.

---
