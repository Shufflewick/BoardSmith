# Requirements: BoardSmith

**Defined:** 2026-02-01
**Core Value:** Make board game development fast and correct — clean APIs with Pit of Success design

## v2.7 Requirements

Requirements for dead code and code smell cleanup.

### Config Cleanup

- [ ] **CFG-01**: Fix vitest.config.ts stale path references (packages/games/ no longer exists)
- [ ] **CFG-02**: Fix eslint.config.mjs stale path references (packages/**/*.ts should be src/**/*.ts)

### Deprecated API Removal

- [ ] **DEP-01**: Remove `flyCard()` method from useFlyingElements
- [ ] **DEP-02**: Remove `flyCards()` method from useFlyingElements
- [ ] **DEP-03**: Remove `FlyCardOptions` interface from useFlyingElements
- [ ] **DEP-04**: Migrate usePlayerStatAnimation.ts to `fly()`/`flyMultiple()`/`FlyConfig`
- [ ] **DEP-05**: Migrate AutoGameBoard.vue to `fly()`/`flyMultiple()`/`FlyConfig`
- [ ] **DEP-06**: Migrate useActionAnimations.ts to `fly()`/`flyMultiple()`/`FlyConfig`

### Type Consolidation

- [ ] **TYPE-01**: Consolidate `LobbyState` to types/protocol.ts as canonical source
- [ ] **TYPE-02**: Consolidate `SlotStatus` to types/protocol.ts as canonical source
- [ ] **TYPE-03**: Consolidate `LobbySlot` to types/protocol.ts as canonical source
- [ ] **TYPE-04**: Consolidate `LobbyInfo` to types/protocol.ts as canonical source
- [ ] **TYPE-05**: Update session/types.ts to re-export from types/protocol.ts
- [ ] **TYPE-06**: Update client/types.ts to re-export from types/protocol.ts

### Code Duplication

- [ ] **DUP-01**: Extract shared completion logic from FlowEngine `resume()` and `resumeAfterExternalAction()` (~40 lines duplicated)
- [ ] **DUP-02**: Extract auto-fill pattern helper in useActionController (repeated in 3 places: start, startFollowUp, currentPick watcher)

### Code Smells

- [ ] **SMELL-01**: Refactor `suppressNextWatcherFetch` module-level flag into proper coordination pattern
- [ ] **SMELL-02**: Fix redundant `unknown | undefined` return type in `injectBoardInteraction()`

### Vestigial Files

- [ ] **VEST-01**: Remove src/ai/utils.ts single re-export file

### Documentation

- [ ] **DOC-01**: Create BREAKING.md documenting all breaking API changes for external users

## Out of Scope

| Feature | Reason |
|---------|--------|
| Worker file split | Large file but all code in use; structural refactor deferred |
| Unused export audit | Requires deeper investigation; separate milestone |
| Complex state machine analysis | FlowEngine and useActionController are well-structured |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CFG-01 | Pending | Pending |
| CFG-02 | Pending | Pending |
| DEP-01 | Pending | Pending |
| DEP-02 | Pending | Pending |
| DEP-03 | Pending | Pending |
| DEP-04 | Pending | Pending |
| DEP-05 | Pending | Pending |
| DEP-06 | Pending | Pending |
| TYPE-01 | Pending | Pending |
| TYPE-02 | Pending | Pending |
| TYPE-03 | Pending | Pending |
| TYPE-04 | Pending | Pending |
| TYPE-05 | Pending | Pending |
| TYPE-06 | Pending | Pending |
| DUP-01 | Pending | Pending |
| DUP-02 | Pending | Pending |
| SMELL-01 | Pending | Pending |
| SMELL-02 | Pending | Pending |
| VEST-01 | Pending | Pending |
| DOC-01 | Pending | Pending |

**Coverage:**
- v2.7 requirements: 20 total
- Mapped to phases: 0
- Unmapped: 20

---
*Requirements defined: 2026-02-01*
*Last updated: 2026-02-01 after initial definition*
