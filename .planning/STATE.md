# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-01-18)

**Core value:** Make board game development fast and correct
**Current focus:** v2.0 Collapse the Monorepo (in progress)

## Current Position

Phase: 40 of 46 (Source Collapse)
Plan: 01 of 02 complete
Status: In progress
Last activity: 2026-01-18 -- Completed 40-01-PLAN.md (foundation packages)

Progress: [======                                  ] 15% (1.5/8 phases)

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

**Active:**
- v2.0 Collapse the Monorepo (Phases 39-46)

## Roadmap Evolution

- Milestone v2.0 created: Collapse the Monorepo, 8 phases (Phases 39-46)
- 46 v2.0 requirements mapped to 8 phases

## Session Continuity

Last session: 2026-01-18
Stopped at: Completed 40-01-PLAN.md, ready for 40-02-PLAN.md
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
