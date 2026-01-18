# Requirements: BoardSmith v2.0

**Defined:** 2026-01-18
**Core Value:** Make board game development fast and correct

## v2.0 Requirements

Requirements for Collapse the Monorepo milestone.

### Package Structure

- [ ] **PKG-01**: Single `boardsmith` npm package replaces all `@boardsmith/*` packages
- [ ] **PKG-02**: Subpath export `boardsmith` for core engine
- [ ] **PKG-03**: Subpath export `boardsmith/ui` for Vue components
- [ ] **PKG-04**: Subpath export `boardsmith/session` for game session
- [ ] **PKG-05**: Subpath export `boardsmith/testing` for test utilities
- [ ] **PKG-06**: Subpath export `boardsmith/eslint-plugin` for ESLint rules
- [ ] **PKG-07**: Subpath export `boardsmith/ai` for AI/MCTS logic
- [ ] **PKG-08**: Subpath export `boardsmith/ai-trainer` for training infrastructure
- [ ] **PKG-09**: Subpath export `boardsmith/client` for client runtime
- [ ] **PKG-10**: Subpath export `boardsmith/server` for server runtime
- [ ] **PKG-11**: Subpath export `boardsmith/runtime` for shared runtime
- [ ] **PKG-12**: Subpath export `boardsmith/worker` for web worker support
- [ ] **PKG-13**: npm instead of pnpm (package-lock.json, no pnpm-workspace.yaml)

### Source Organization

- [ ] **SRC-01**: `src/engine/` contains core game logic (from @boardsmith/engine)
- [ ] **SRC-02**: `src/ui/` contains Vue components (from @boardsmith/ui)
- [ ] **SRC-03**: `src/session/` contains game session (from @boardsmith/session)
- [ ] **SRC-04**: `src/cli/` contains CLI commands (from @boardsmith/cli)
- [ ] **SRC-05**: `src/testing/` contains test utilities (from @boardsmith/testing)
- [ ] **SRC-06**: `src/eslint-plugin/` contains ESLint rules (from eslint-plugin-boardsmith)
- [ ] **SRC-07**: `src/ai/` contains AI/MCTS logic (from @boardsmith/ai)
- [ ] **SRC-08**: `src/ai-trainer/` contains training (from @boardsmith/ai-trainer)
- [ ] **SRC-09**: `src/client/` contains client runtime (from @boardsmith/client)
- [ ] **SRC-10**: `src/server/` contains server runtime (from @boardsmith/server)
- [ ] **SRC-11**: `src/runtime/` contains shared runtime (from @boardsmith/runtime)
- [ ] **SRC-12**: `src/worker/` contains web worker (from @boardsmith/worker)
- [ ] **SRC-13**: All tests colocated (*.test.ts next to source files)
- [ ] **SRC-14**: Single root package.json with exports field

### Import Updates

- [ ] **IMP-01**: All internal imports use relative paths within src/
- [ ] **IMP-02**: No `@boardsmith/*` imports anywhere in codebase
- [ ] **IMP-03**: Cross-concern imports use relative paths (e.g., `../engine/`)

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

- [ ] **CLI-01**: `boardsmith create` scaffolds standalone npm project
- [ ] **CLI-02**: `boardsmith dev` works with new structure
- [ ] **CLI-03**: `boardsmith build` works with new structure
- [ ] **CLI-04**: `boardsmith test` works with new structure
- [ ] **CLI-05**: `boardsmith pack` updated for single-package structure
- [ ] **CLI-06**: All CLI help text updated for new import paths

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
| PKG-01 | TBD | Pending |
| PKG-02 | TBD | Pending |
| PKG-03 | TBD | Pending |
| PKG-04 | TBD | Pending |
| PKG-05 | TBD | Pending |
| PKG-06 | TBD | Pending |
| PKG-07 | TBD | Pending |
| PKG-08 | TBD | Pending |
| PKG-09 | TBD | Pending |
| PKG-10 | TBD | Pending |
| PKG-11 | TBD | Pending |
| PKG-12 | TBD | Pending |
| PKG-13 | TBD | Pending |
| SRC-01 | TBD | Pending |
| SRC-02 | TBD | Pending |
| SRC-03 | TBD | Pending |
| SRC-04 | TBD | Pending |
| SRC-05 | TBD | Pending |
| SRC-06 | TBD | Pending |
| SRC-07 | TBD | Pending |
| SRC-08 | TBD | Pending |
| SRC-09 | TBD | Pending |
| SRC-10 | TBD | Pending |
| SRC-11 | TBD | Pending |
| SRC-12 | TBD | Pending |
| SRC-13 | TBD | Pending |
| SRC-14 | TBD | Pending |
| IMP-01 | TBD | Pending |
| IMP-02 | TBD | Pending |
| IMP-03 | TBD | Pending |
| GAME-01 | TBD | Pending |
| GAME-02 | TBD | Pending |
| GAME-03 | TBD | Pending |
| GAME-04 | TBD | Pending |
| GAME-05 | TBD | Pending |
| GAME-06 | TBD | Pending |
| GAME-07 | TBD | Pending |
| GAME-08 | TBD | Pending |
| GAME-09 | TBD | Pending |
| GAME-10 | TBD | Pending |
| GAME-11 | TBD | Pending |
| CLI-01 | TBD | Pending |
| CLI-02 | TBD | Pending |
| CLI-03 | TBD | Pending |
| CLI-04 | TBD | Pending |
| CLI-05 | TBD | Pending |
| CLI-06 | TBD | Pending |
| DOC-01 | TBD | Pending |
| DOC-02 | TBD | Pending |
| DOC-03 | TBD | Pending |
| DOC-04 | TBD | Pending |

**Coverage:**
- v2.0 requirements: 46 total
- Mapped to phases: 0
- Unmapped: 46

---
*Requirements defined: 2026-01-18*
*Last updated: 2026-01-18 after initial definition*
