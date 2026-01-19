# Requirements: BoardSmith v2.0

**Defined:** 2026-01-18
**Core Value:** Make board game development fast and correct

## v2.0 Requirements

Requirements for Collapse the Monorepo milestone.

### Package Structure

- [x] **PKG-01**: Single `boardsmith` npm package replaces all `@boardsmith/*` packages
- [x] **PKG-02**: Subpath export `boardsmith` for core engine
- [x] **PKG-03**: Subpath export `boardsmith/ui` for Vue components
- [x] **PKG-04**: Subpath export `boardsmith/session` for game session
- [x] **PKG-05**: Subpath export `boardsmith/testing` for test utilities
- [x] **PKG-06**: Subpath export `boardsmith/eslint-plugin` for ESLint rules
- [x] **PKG-07**: Subpath export `boardsmith/ai` for AI/MCTS logic
- [x] **PKG-08**: Subpath export `boardsmith/ai-trainer` for training infrastructure
- [x] **PKG-09**: Subpath export `boardsmith/client` for client runtime
- [x] **PKG-10**: Subpath export `boardsmith/server` for server runtime
- [x] **PKG-11**: Subpath export `boardsmith/runtime` for shared runtime
- [x] **PKG-12**: Subpath export `boardsmith/worker` for web worker support
- [x] **PKG-13**: npm instead of pnpm (package-lock.json, no pnpm-workspace.yaml)

### Source Organization

- [x] **SRC-01**: `src/engine/` contains core game logic (from @boardsmith/engine)
- [x] **SRC-02**: `src/ui/` contains Vue components (from @boardsmith/ui)
- [x] **SRC-03**: `src/session/` contains game session (from @boardsmith/session)
- [x] **SRC-04**: `src/cli/` contains CLI commands (from @boardsmith/cli)
- [x] **SRC-05**: `src/testing/` contains test utilities (from @boardsmith/testing)
- [x] **SRC-06**: `src/eslint-plugin/` contains ESLint rules (from eslint-plugin-boardsmith)
- [x] **SRC-07**: `src/ai/` contains AI/MCTS logic (from @boardsmith/ai)
- [x] **SRC-08**: `src/ai-trainer/` contains training (from @boardsmith/ai-trainer)
- [x] **SRC-09**: `src/client/` contains client runtime (from @boardsmith/client)
- [x] **SRC-10**: `src/server/` contains server runtime (from @boardsmith/server)
- [x] **SRC-11**: `src/runtime/` contains shared runtime (from @boardsmith/runtime)
- [x] **SRC-12**: `src/worker/` contains web worker (from @boardsmith/worker)
- [x] **SRC-13**: All tests colocated (*.test.ts next to source files)
- [x] **SRC-14**: Single root package.json with exports field

### Import Updates

- [x] **IMP-01**: All internal imports use relative paths within src/
- [x] **IMP-02**: No `@boardsmith/*` imports anywhere in codebase (except JSDoc examples and code-generator templates)
- [x] **IMP-03**: Cross-concern imports use relative paths (e.g., `../engine/`)

### Game Extraction

- [ ] **GAME-01**: Hex extracted to separate git repo
- [ ] **GAME-02**: Go Fish extracted to separate git repo
- [ ] **GAME-03**: Checkers extracted to separate git repo
- [ ] **GAME-04**: Cribbage extracted to separate git repo
- [ ] **GAME-05**: Floss Bitties extracted to separate git repo (not currently working, not a fail condition)
- [ ] **GAME-06**: Polyhedral Potions extracted to separate git repo
- [ ] **GAME-07**: Demo ActionPanel extracted as example game
- [ ] **GAME-08**: Demo Animation extracted as example game
- [ ] **GAME-09**: Demo ComplexUiInteractions extracted as example game
- [ ] **GAME-10**: Each extracted game/demo works as standalone project depending on `boardsmith`
- [ ] **GAME-11**: Extracted games use npm (not pnpm)

### CLI Updates

- [x] **CLI-01**: `boardsmith create` scaffolds standalone npm project
- [x] **CLI-02**: `boardsmith dev` works with new structure
- [x] **CLI-03**: `boardsmith build` works with new structure
- [x] **CLI-04**: `boardsmith test` works with new structure
- [x] **CLI-05**: `boardsmith pack` updated for single-package structure
- [x] **CLI-06**: All CLI help text updated for new import paths

### Documentation

- [ ] **DOC-01**: All docs updated with new import paths
- [ ] **DOC-02**: Getting started guide uses `boardsmith` imports
- [ ] **DOC-03**: API reference reflects subpath exports
- [ ] **DOC-04**: Migration guide written for external team

## Out of Scope

| Feature | Reason |
|---------|--------|
| Backward compatibility | Clean break to v2.0, no fallbacks |
| Multiple package versions | Single version for entire library |
| Games bundled in repo | Games are separate repos |
| pnpm support | npm only for simplicity |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| PKG-01 | 39 (Foundation) | Complete |
| PKG-02 | 42 (Subpath Exports) | Complete |
| PKG-03 | 42 (Subpath Exports) | Complete |
| PKG-04 | 42 (Subpath Exports) | Complete |
| PKG-05 | 42 (Subpath Exports) | Complete |
| PKG-06 | 42 (Subpath Exports) | Complete |
| PKG-07 | 42 (Subpath Exports) | Complete |
| PKG-08 | 42 (Subpath Exports) | Complete |
| PKG-09 | 42 (Subpath Exports) | Complete |
| PKG-10 | 42 (Subpath Exports) | Complete |
| PKG-11 | 42 (Subpath Exports) | Complete |
| PKG-12 | 42 (Subpath Exports) | Complete |
| PKG-13 | 39 (Foundation) | Complete |
| SRC-01 | 40 (Source Collapse) | Complete |
| SRC-02 | 40 (Source Collapse) | Complete |
| SRC-03 | 40 (Source Collapse) | Complete |
| SRC-04 | 40 (Source Collapse) | Complete |
| SRC-05 | 40 (Source Collapse) | Complete |
| SRC-06 | 40 (Source Collapse) | Complete |
| SRC-07 | 40 (Source Collapse) | Complete |
| SRC-08 | 40 (Source Collapse) | Complete |
| SRC-09 | 40 (Source Collapse) | Complete |
| SRC-10 | 40 (Source Collapse) | Complete |
| SRC-11 | 40 (Source Collapse) | Complete |
| SRC-12 | 40 (Source Collapse) | Complete |
| SRC-13 | 41 (Test Colocation) | Complete |
| SRC-14 | 39 (Foundation) | Complete |
| IMP-01 | 43 (Import Rewrite) | Complete |
| IMP-02 | 43 (Import Rewrite) | Complete |
| IMP-03 | 43 (Import Rewrite) | Complete |
| GAME-01 | 44 (Game Extraction) | Pending |
| GAME-02 | 44 (Game Extraction) | Pending |
| GAME-03 | 44 (Game Extraction) | Pending |
| GAME-04 | 44 (Game Extraction) | Pending |
| GAME-05 | 44 (Game Extraction) | Pending |
| GAME-06 | 44 (Game Extraction) | Pending |
| GAME-07 | 44 (Game Extraction) | Pending |
| GAME-08 | 44 (Game Extraction) | Pending |
| GAME-09 | 44 (Game Extraction) | Pending |
| GAME-10 | 44 (Game Extraction) | Pending |
| GAME-11 | 44 (Game Extraction) | Pending |
| CLI-01 | 45 (CLI Update) | Complete |
| CLI-02 | 45 (CLI Update) | Complete |
| CLI-03 | 45 (CLI Update) | Complete |
| CLI-04 | 45 (CLI Update) | Complete |
| CLI-05 | 45 (CLI Update) | Complete |
| CLI-06 | 45 (CLI Update) | Complete |
| DOC-01 | 46 (Documentation) | Pending |
| DOC-02 | 46 (Documentation) | Pending |
| DOC-03 | 46 (Documentation) | Pending |
| DOC-04 | 46 (Documentation) | Pending |

**Coverage:**
- v2.0 requirements: 51 total
- Mapped to phases: 51
- Unmapped: 0

---
*Requirements defined: 2026-01-18*
*Last updated: 2026-01-18 after Phase 45 completion*
