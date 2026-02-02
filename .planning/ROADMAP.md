# Roadmap: BoardSmith v2.7

## Overview

v2.7 cleans up all identified dead code, type duplication, and code smells discovered during v2.6. The work flows from quick config fixes through systematic type consolidation, deprecated API removal (migrate callers first), code duplication extraction, and code smell refactors, culminating in BREAKING.md documentation.

## Phases

**Phase Numbering:**
- Integer phases (69, 70, 71...): Planned milestone work
- Decimal phases (69.1, 69.2): Urgent insertions (marked with INSERTED)

- [ ] **Phase 69: Config & Vestigial Cleanup** - Fix stale config paths and remove single-export utils file
- [ ] **Phase 70: Type Consolidation** - Consolidate duplicated lobby types to types/protocol.ts
- [ ] **Phase 71: Deprecated API Removal** - Migrate internal callers then remove deprecated flying APIs
- [ ] **Phase 72: Code Duplication Fixes** - Extract shared logic in FlowEngine and useActionController
- [ ] **Phase 73: Code Smell Refactors** - Fix coordination pattern and redundant type annotation
- [ ] **Phase 74: Documentation** - Create BREAKING.md documenting all API changes

## Phase Details

### Phase 69: Config & Vestigial Cleanup
**Goal**: Build tooling configuration is accurate and vestigial files are removed
**Depends on**: Nothing (first phase)
**Requirements**: CFG-01, CFG-02, VEST-01
**Success Criteria** (what must be TRUE):
  1. `vitest.config.ts` references only paths that exist in the codebase
  2. `eslint.config.mjs` references only paths that exist in the codebase
  3. `src/ai/utils.ts` no longer exists (exports moved to consumers or removed)
  4. All tests pass after config changes
**Plans**: 1 plan

Plans:
- [ ] 69-01-PLAN.md — Fix stale config paths and remove utils.ts re-export file

### Phase 70: Type Consolidation
**Goal**: Lobby-related types have a single canonical source in types/protocol.ts
**Depends on**: Phase 69
**Requirements**: TYPE-01, TYPE-02, TYPE-03, TYPE-04, TYPE-05, TYPE-06
**Success Criteria** (what must be TRUE):
  1. `LobbyState`, `SlotStatus`, `LobbySlot`, `LobbyInfo` are defined only in `types/protocol.ts`
  2. `session/types.ts` re-exports lobby types from `types/protocol.ts` (no duplicate definitions)
  3. `client/types.ts` re-exports lobby types from `types/protocol.ts` (no duplicate definitions)
  4. All imports across codebase resolve to the canonical source
  5. All tests pass after type consolidation
**Plans**: TBD

Plans:
- [ ] 70-01: [TBD]

### Phase 71: Deprecated API Removal
**Goal**: Deprecated flying APIs are removed after all internal callers migrate to new APIs
**Depends on**: Phase 70
**Requirements**: DEP-04, DEP-05, DEP-06, DEP-01, DEP-02, DEP-03
**Success Criteria** (what must be TRUE):
  1. `usePlayerStatAnimation.ts` uses `fly()`/`flyMultiple()`/`FlyConfig` (not deprecated APIs)
  2. `AutoGameBoard.vue` uses `fly()`/`flyMultiple()`/`FlyConfig` (not deprecated APIs)
  3. `useActionAnimations.ts` uses `fly()`/`flyMultiple()`/`FlyConfig` (not deprecated APIs)
  4. `flyCard()` method no longer exists in useFlyingElements
  5. `flyCards()` method no longer exists in useFlyingElements
  6. `FlyCardOptions` interface no longer exists in useFlyingElements
  7. All tests pass after API removal
**Plans**: TBD

Plans:
- [ ] 71-01: [TBD]

### Phase 72: Code Duplication Fixes
**Goal**: Repeated code patterns are extracted into shared helpers
**Depends on**: Phase 71
**Requirements**: DUP-01, DUP-02
**Success Criteria** (what must be TRUE):
  1. FlowEngine `resume()` and `resumeAfterExternalAction()` share completion logic via extracted helper
  2. useActionController auto-fill pattern is extracted and used in all 3 places (start, startFollowUp, currentPick watcher)
  3. No duplication of the extracted patterns remains
  4. All tests pass after refactoring
**Plans**: TBD

Plans:
- [ ] 72-01: [TBD]

### Phase 73: Code Smell Refactors
**Goal**: Code smells are fixed with proper patterns
**Depends on**: Phase 72
**Requirements**: SMELL-01, SMELL-02
**Success Criteria** (what must be TRUE):
  1. `suppressNextWatcherFetch` module-level flag is replaced with proper coordination pattern
  2. `injectBoardInteraction()` return type is `unknown` (not redundant `unknown | undefined`)
  3. All tests pass after refactoring
**Plans**: TBD

Plans:
- [ ] 73-01: [TBD]

### Phase 74: Documentation
**Goal**: Breaking changes are documented for external users
**Depends on**: Phase 73
**Requirements**: DOC-01
**Success Criteria** (what must be TRUE):
  1. `BREAKING.md` exists in project root
  2. All removed APIs from v2.7 are documented with migration paths
  3. Document references the consolidated type locations
  4. All tests pass (final verification)
**Plans**: TBD

Plans:
- [ ] 74-01: [TBD]

## Progress

**Execution Order:**
Phases execute in numeric order: 69 -> 70 -> 71 -> 72 -> 73 -> 74

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 69. Config & Vestigial Cleanup | 0/1 | Ready | - |
| 70. Type Consolidation | 0/TBD | Not started | - |
| 71. Deprecated API Removal | 0/TBD | Not started | - |
| 72. Code Duplication Fixes | 0/TBD | Not started | - |
| 73. Code Smell Refactors | 0/TBD | Not started | - |
| 74. Documentation | 0/TBD | Not started | - |
