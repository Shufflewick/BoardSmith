# Roadmap: BoardSmith Large File Refactoring

## Completed Milestones

- ✅ [v0.1 Large File Refactoring](milestones/v0.1-ROADMAP.md) (Phases 1-4) — SHIPPED 2026-01-08
- ✅ [v0.2 Concerns Cleanup](milestones/v0.2-ROADMAP.md) (Phases 5-8) — SHIPPED 2026-01-09
- ✅ [v0.3 Flow Engine Docs](milestones/v0.3-ROADMAP.md) (Phase 9) — SHIPPED 2026-01-09
- ✅ [v0.4 Public API Docs](milestones/v0.4-ROADMAP.md) (Phase 10) — SHIPPED 2026-01-09
- ✅ [v0.5 ESLint No-Shadow](milestones/v0.5-ROADMAP.md) (Phase 11) — SHIPPED 2026-01-09

## Overview

A systematic refactoring of BoardSmith's four largest files into smaller, more maintainable modules. Each phase targets one file, preserving all existing behavior and public APIs while improving code organization, navigability, and testability.

## Milestones

- ✅ **v0.1 Large File Refactoring** — Phases 1-4 (shipped 2026-01-08)
- ✅ **v0.2 Concerns Cleanup** — Phases 5-8 (shipped 2026-01-09)
- ✅ **v0.3 Flow Engine Docs** — Phase 9 (shipped 2026-01-09)
- ✅ **v0.4 Public API Docs** — Phase 10 (shipped 2026-01-09)
- ✅ **v0.5 ESLint No-Shadow** — Phase 11 (shipped 2026-01-09)
- 🚧 **v0.6 Players in Element Tree** — Phases 12-13 (in progress)

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

### 🚧 v0.6 Players in Element Tree (In Progress)

**Milestone Goal:** Make Player extend GameElement so players are in the searchable tree, fixing the "player data in two worlds" problem from MERC post-mortem.

#### Phase 12: player-in-tree
**Goal**: Make Player extend GameElement, remove PlayerCollection, migrate to `game.all(Player)`
**Depends on**: v0.5 complete
**Research**: Unlikely (internal refactoring)
**Plans**: 3

Plans:
- [ ] 12-01: Make Player extend GameElement, remove PlayerCollection from engine
- [ ] 12-02: Update all game implementations and custom Player classes
- [ ] 12-03: Update tests and supporting packages, verify all pass

#### Phase 13: player-access-docs
**Goal**: Document the new player access pattern (players as GameElements, anti-patterns to avoid)
**Depends on**: Phase 12
**Research**: Unlikely (documentation only)
**Plans**: TBD

Plans:
- [ ] 13-01: TBD (run /gsd:plan-phase 13 to break down)

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
| 12. player-in-tree | v0.6 | 0/3 | Planned | - |
| 13. player-access-docs | v0.6 | 0/? | Not started | - |
