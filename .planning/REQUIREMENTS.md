# Requirements: BoardSmith

**Defined:** 2026-02-01
**Core Value:** Make board game development fast and correct — clean APIs with Pit of Success design

## v2.7 Requirements

Requirements for dead code and code smell cleanup.

### Config Cleanup

- [x] **CFG-01**: Fix vitest.config.ts stale path references (packages/games/ no longer exists)
- [x] **CFG-02**: Fix eslint.config.mjs stale path references (packages/**/*.ts should be src/**/*.ts)

### Deprecated API Removal

- [ ] **DEP-01**: Remove `flyCard()` method from useFlyingElements
- [ ] **DEP-02**: Remove `flyCards()` method from useFlyingElements
- [ ] **DEP-03**: Remove `FlyCardOptions` interface from useFlyingElements
- [ ] **DEP-04**: Migrate usePlayerStatAnimation.ts to `fly()`/`flyMultiple()`/`FlyConfig`
- [ ] **DEP-05**: Migrate AutoGameBoard.vue to `fly()`/`flyMultiple()`/`FlyConfig`
- [ ] **DEP-06**: Migrate useActionAnimations.ts to `fly()`/`flyMultiple()`/`FlyConfig`

### Type Consolidation

- [x] **TYPE-01**: Consolidate `LobbyState` to types/protocol.ts as canonical source
- [x] **TYPE-02**: Consolidate `SlotStatus` to types/protocol.ts as canonical source
- [x] **TYPE-03**: Consolidate `LobbySlot` to types/protocol.ts as canonical source
- [x] **TYPE-04**: Consolidate `LobbyInfo` to types/protocol.ts as canonical source
- [x] **TYPE-05**: Update session/types.ts to re-export from types/protocol.ts
- [x] **TYPE-06**: Update client/types.ts to re-export from types/protocol.ts

### Code Duplication

- [ ] **DUP-01**: Extract shared completion logic from FlowEngine `resume()` and `resumeAfterExternalAction()` (~40 lines duplicated)
- [ ] **DUP-02**: Extract auto-fill pattern helper in useActionController (repeated in 3 places: start, startFollowUp, currentPick watcher)

### Code Smells

- [ ] **SMELL-01**: Refactor `suppressNextWatcherFetch` module-level flag into proper coordination pattern
- [ ] **SMELL-02**: Fix redundant `unknown | undefined` return type in `injectBoardInteraction()`

### Vestigial Files

- [x] **VEST-01**: Remove src/ai/utils.ts single re-export file

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
| CFG-01 | Phase 69 | Complete |
| CFG-02 | Phase 69 | Complete |
| VEST-01 | Phase 69 | Complete |
| TYPE-01 | Phase 70 | Complete |
| TYPE-02 | Phase 70 | Complete |
| TYPE-03 | Phase 70 | Complete |
| TYPE-04 | Phase 70 | Complete |
| TYPE-05 | Phase 70 | Complete |
| TYPE-06 | Phase 70 | Complete |
| DEP-04 | Phase 71 | Pending |
| DEP-05 | Phase 71 | Pending |
| DEP-06 | Phase 71 | Pending |
| DEP-01 | Phase 71 | Pending |
| DEP-02 | Phase 71 | Pending |
| DEP-03 | Phase 71 | Pending |
| DUP-01 | Phase 72 | Pending |
| DUP-02 | Phase 72 | Pending |
| SMELL-01 | Phase 73 | Pending |
| SMELL-02 | Phase 73 | Pending |
| DOC-01 | Phase 74 | Pending |

**Coverage:**
- v2.7 requirements: 20 total
- Mapped to phases: 20
- Unmapped: 0

---
*Requirements defined: 2026-02-01*
*Last updated: 2026-02-01 after roadmap creation*
