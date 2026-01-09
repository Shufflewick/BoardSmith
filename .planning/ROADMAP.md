# Roadmap: BoardSmith Large File Refactoring

## Completed Milestones

- ✅ [v0.1 Large File Refactoring](milestones/v0.1-ROADMAP.md) (Phases 1-4) — SHIPPED 2026-01-08
- ✅ [v0.2 Concerns Cleanup](milestones/v0.2-ROADMAP.md) (Phases 5-8) — SHIPPED 2026-01-09
- ✅ [v0.3 Flow Engine Docs](milestones/v0.3-ROADMAP.md) (Phase 9) — SHIPPED 2026-01-09

## Overview

A systematic refactoring of BoardSmith's four largest files into smaller, more maintainable modules. Each phase targets one file, preserving all existing behavior and public APIs while improving code organization, navigability, and testability.

## Milestones

- ✅ **v0.1 Large File Refactoring** — Phases 1-4 (shipped 2026-01-08)
- ✅ **v0.2 Concerns Cleanup** — Phases 5-8 (shipped 2026-01-09)
- ✅ **v0.3 Flow Engine Docs** — Phase 9 (shipped 2026-01-09)

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
