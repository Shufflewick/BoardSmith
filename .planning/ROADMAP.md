# Roadmap: BoardSmith Large File Refactoring

## Overview

A systematic refactoring of BoardSmith's four largest files into smaller, more maintainable modules. Each phase targets one file, preserving all existing behavior and public APIs while improving code organization, navigability, and testability.

## Domain Expertise

None

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3, 4): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: game-session refactoring** - Split GameSession class into focused modules
- [ ] **Phase 2: useActionController refactoring** - Split Vue composable into focused composables
- [ ] **Phase 3: action refactoring** - Split Action class into focused modules
- [ ] **Phase 4: test file refactoring** - Restructure tests to mirror composable structure

## Phase Details

### Phase 1: game-session refactoring
**Goal**: Split `packages/session/src/game-session.ts` (2,585 lines) into focused modules while maintaining the unified GameSession API
**Depends on**: Nothing (first phase)
**Research**: None needed (internal refactoring of existing code)
**Plans**: 4

Plans:
- [x] 01-01: Extract lobby management (~900 lines → LobbyManager)
- [x] 01-02: Extract selection & pending action handling (~550 lines → SelectionHandler, PendingActionManager)
- [x] 01-03: Extract state history & debug (~360 lines → StateHistory, DebugController)
- [x] 01-04: Verify and clean up

### Phase 2: useActionController refactoring
**Goal**: Split `packages/ui/src/composables/useActionController.ts` (1,807 lines) into focused Vue composables
**Depends on**: Phase 1
**Research**: Unlikely (internal refactoring following Vue 3 composable patterns)
**Plans**: TBD

Plans:
- [ ] 02-01: Analyze useActionController and identify extraction boundaries
- [ ] 02-02: Extract selection state management
- [ ] 02-03: Extract followUp handling logic
- [ ] 02-04: Extract action execution state

### Phase 3: action refactoring
**Goal**: Split `packages/engine/src/action/action.ts` (1,845 lines) into focused modules while preserving fluent builder API
**Depends on**: Phase 2
**Research**: Unlikely (internal refactoring of existing code)
**Plans**: TBD

Plans:
- [ ] 03-01: Analyze Action class and identify extraction boundaries
- [ ] 03-02: Extract selection definitions
- [ ] 03-03: Extract condition logic
- [ ] 03-04: Extract execution logic

### Phase 4: test file refactoring
**Goal**: Restructure `packages/ui/tests/useActionController.test.ts` (2,088 lines) to mirror the new composable structure
**Depends on**: Phase 2 (must complete useActionController refactoring first)
**Research**: Unlikely (restructuring existing tests)
**Plans**: TBD

Plans:
- [ ] 04-01: Analyze test structure and map to new composable modules
- [ ] 04-02: Split tests into separate files mirroring composable structure
- [ ] 04-03: Verify all tests pass after restructure

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. game-session refactoring | 4/4 | Complete | 2026-01-08 |
| 2. useActionController refactoring | 0/4 | Not started | - |
| 3. action refactoring | 0/4 | Not started | - |
| 4. test file refactoring | 0/3 | Not started | - |
