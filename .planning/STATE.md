# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-01-19)

**Core value:** Make board game development fast and correct
**Current focus:** v2.1 Design-Game Skill Redesign - Phase 48

## Current Position

Phase: 48 (continuation-flow)
Plan: None yet
Status: Phase 47 complete -- ready for /gsd:plan-phase 48
Last activity: 2026-01-20 -- Phase 47 complete

Progress: [██████████                              ] 25% (1/4 phases in v2.1)

## Milestones

**Completed:**
- v0.1 Large File Refactoring (Phases 1-4) -- shipped 2026-01-08
- v0.2 Concerns Cleanup (Phases 5-8) -- shipped 2026-01-09
- v0.3 Flow Engine Docs (Phase 9) -- shipped 2026-01-09
- v0.4 Public API Docs (Phase 10) -- shipped 2026-01-09
- v0.5 ESLint No-Shadow (Phase 11) -- shipped 2026-01-09
- v0.6 Players in Element Tree (Phases 12-13) -- shipped 2026-01-09
- v0.7 Condition Tracing Refactor (Phases 14-16) -- shipped 2026-01-10
- v0.8 HMR Reliability (Phases 17-19) -- shipped 2026-01-11
- v0.9 Parallel AI Training (Phases 20-23) -- shipped 2026-01-13
- v1.0 AI System Overhaul (Phases 24-28.1) -- shipped 2026-01-15
- v1.1 MCTS Strategy Improvements (Phases 29-36) -- shipped 2026-01-16
- v1.2 Local Tarballs (Phases 37-38) -- shipped 2026-01-18
- v2.0 Collapse the Monorepo (Phases 39-46) -- shipped 2026-01-19

**Active:**
- v2.1 Design-Game Skill Redesign (Phases 47-50) -- started 2026-01-19

## Roadmap Evolution

- Milestone v2.0 created: Collapse the Monorepo, 8 phases (Phases 39-46)
- 46 v2.0 requirements mapped to 8 phases
- Milestone v2.1 created: Design-Game Skill Redesign, 4 phases (Phases 47-50)
- 27 v2.1 requirements mapped to 4 phases

## Session Continuity

Last session: 2026-01-20
Stopped at: Phase 47 complete, ready for Phase 48
Resume file: None

## Key Decisions (v2.0)

| Decision | Rationale | Phase |
|----------|-----------|-------|
| 8 phases for 46 requirements | Natural groupings: foundation, source, tests, exports, imports, games, CLI, docs | Roadmap |
| Tests colocated in separate phase | Allows source collapse to complete before moving tests | 41 |
| Game extraction after imports | Games validate the new structure works end-to-end | 44 |
| Switch from pnpm to npm | Simpler single-package workflow for collapsed monorepo | 39-01 |
| Remove workspaces config | No longer a monorepo after collapse | 39-01 |
| Exports field points to packages/engine/dist | Minimal foundation; expands in later phases | 39-01 |
| Single atomic commit for source moves | Easier rollback if needed; all 84 files moved together | 40-01 |
| git mv for all file moves | Preserves full git history | 40-01 |
| Source collapse complete: 179 files | All 12 packages consolidated to src/*/ | 40-02 |
| Vitest resolve.alias for packages | Tests need workspace package resolution from src/ | 41-01 |
| Vue as root devDependency | UI composable tests need vue from root | 41-01 |
| 14 tests + 1 helper colocated | All library tests now siblings of their source files | 41-01 |
| Source-based exports | Point to .ts source files, bundler consumers compile | 42-01 |
| Types condition first | Required for TypeScript moduleResolution: bundler | 42-01 |
| 11 subpaths configured | ., ui, session, testing, eslint-plugin, ai, ai-trainer, client, server, runtime, worker | 42-01 |
| Relative imports with .js extension | ESM requires file extensions in import paths | 43-01 |
| Preserve JSDoc @boardsmith examples | User-facing documentation should show public API, not internal paths | 43-01 |
| Extended import rewrite scope | Completed worker, server, cli, ui imports in single phase for completeness | 43-01 |
| Vitest aliases only for external packages | Internal modules use relative imports, aliases only for game packages in packages/ | 43-02 |
| Templates in /private/tmp/ | Isolated testing environment for game extraction workflow | 44-01 |
| file:../../BoardSmith for local dev | Local development uses file link; production uses npm version | 44-01 |
| Placeholder tokens {GAME_NAME}, {DISPLAY_NAME} | Per-game customization during extraction | 44-01 |
| Preserve unified src/ structure for complex games | Demo Complex UI has src/rules and src/ui, preserved as-is | 44-09 |
| No vitest for demos without tests | Cleaner package.json for demo games that have no tests | 44-07 |
| Demos with tests get vitest.config.ts | Demo Animation has tests/game.test.ts, needs vitest setup | 44-08 |
| Non-working games extracted anyway | GAME-05 allows non-working state; Floss Bitties preserved as-is | 44-10 |
| Track command system for MCTS | Added TRACK_ADD/TRACK_REMOVE_LAST commands so scoring tracks work with MCTS undo | 44-11 |
| Multi-candidate monorepo detection | Try both 3-level and 2-level parent paths to handle bundled CLI | 45-01 |
| Simplified package name | @mygames/${name} -> ${name} for standalone projects | 45-01 |
| npx boardsmith for scripts | No @boardsmith/cli devDependency needed in generated projects | 45-01 |
| Game-specific Player in tests | Use ${Pascal}Player from game.js instead of generic Player import | 45-01 |
| Context detection via src/engine/ | Monorepo has src/engine/, standalone has boardsmith.json but no src/engine/ | 45-02 |
| dev.ts noop plugin for standalone | Let node_modules resolution work naturally instead of intercepting | 45-02 |
| build command is games-only | Clear error when run in monorepo context guides users to appropriate tooling | 45-02 |
| pack packs single package | After monorepo collapse, there's only one boardsmith package at root | 45-02 |
| Table format for import mappings | Clear visual reference for all 13 import paths in migration guide | 46-03 |
| Documentation import updates | All docs use new boardsmith paths, migration-guide shows both | 46-01 |
| API reference template | Consistent structure: When to Use, Usage, Exports, Examples, See Also | 46-02 |
| 6-question interview replaces 16-question | Minimal first pass, gather core loop only, defer details | 47-01 |
| ACDR governor pattern | Acknowledge, Capture, Defer, Redirect - preserves ideas without blocking | 47-01 |
| Reference files before interview | Claude needs BoardSmith context to ask informed questions | 47-01 |
| boardsmith init then modify | Scaffolding creates correct structure, Claude customizes | 47-02 |
| Placeholder action only in Phase 1 | Real actions added based on playtest feedback | 47-02 |
| tsc --noEmit verification | Catches real errors before playtest, no extra tooling needed | 47-02 |
| Self-contained slash commands | Embed instructions into installed .md files, no external file reads | 47-03 |
| Quick Reference in instructions | Condensed code patterns inline, no doc file reads needed | 47-03 |
