# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-01-18)

**Core value:** Make board game development fast and correct
**Current focus:** v1.2 Local Tarballs (complete)

## Current Position

Phase: 38 (target-integration)
Plan: 01 of 1 complete
Status: Milestone v1.2 complete
Last activity: 2026-01-18 — Completed 38-01-PLAN.md

Progress: [========================================] 100% (2/2 phases)

## Milestones

**Completed:**
- v0.1 Large File Refactoring (Phases 1-4) — shipped 2026-01-08
- v0.2 Concerns Cleanup (Phases 5-8) — shipped 2026-01-09
- v0.3 Flow Engine Docs (Phase 9) — shipped 2026-01-09
- v0.4 Public API Docs (Phase 10) — shipped 2026-01-09
- v0.5 ESLint No-Shadow (Phase 11) — shipped 2026-01-09
- v0.6 Players in Element Tree (Phases 12-13) — shipped 2026-01-09
- v0.7 Condition Tracing Refactor (Phases 14-16) — shipped 2026-01-10
- v0.8 HMR Reliability (Phases 17-19) — shipped 2026-01-11
- v0.9 Parallel AI Training (Phases 20-23) — shipped 2026-01-13
- v1.0 AI System Overhaul (Phases 24-28.1) — shipped 2026-01-15
- v1.1 MCTS Strategy Improvements (Phases 29-36) — shipped 2026-01-16
- v1.2 Local Tarballs (Phases 37-38) — shipped 2026-01-18

## Roadmap Evolution

- Milestone v1.2 created: Local Tarballs, 2 phases (Phases 37-38)
- Milestone v1.2 completed: 2026-01-18

## Session Continuity

Last session: 2026-01-18
Stopped at: Completed Phase 38 (target-integration), milestone v1.2 complete
Resume file: None

## Key Decisions (v1.2)

| Decision | Rationale | Phase |
|----------|-----------|-------|
| Pack only @boardsmith/* + eslint-plugin-boardsmith | Games use @mygames/*, should not be distributed | 37-01 |
| Single timestamp for all packages in pack run | Creates consistent snapshot for reproducibility | 37-01 |
| try/finally for package.json restoration | Ensures original version preserved even on error | 37-01 |
| Resolve workspace:* to file:./vendor/* in tarballs | Tarballs must work outside monorepo context | 38-01 |
| Build tarball map upfront before packing | Enables cross-package dependency resolution | 38-01 |
| Only update existing deps in target | Don't add new dependencies user didn't ask for | 38-01 |
