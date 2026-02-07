# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-06)

**Core value:** Make board game development fast and correct -- the framework handles multiplayer, AI, and UI so designers focus on game rules.
**Current focus:** v2.9 Theatre View -- Phase 83: UI Composables

## Current Position

Phase: 83 of 84 (UI Composables)
Plan: Not started
Status: Phase complete (82), ready for next phase
Last activity: 2026-02-07 -- Completed Phase 82 (Session Integration)

Progress: [██████░░░░] 60%

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
- v2.1 Design-Game Skill Redesign (Phases 47-50) -- shipped 2026-01-19
- v2.2 Game Design Aspects (Phases 51-53) -- shipped 2026-01-21
- v2.3 Nomenclature Standardization (Phases 54-58) -- shipped 2026-01-22
- v2.4 Animation Event System (Phases 59-63) -- shipped 2026-01-22
- v2.5 Player Colors Refactor (Phases 64-68) -- shipped 2026-01-25
- v2.6 Code Consolidation (post-mortem driven) -- shipped 2026-01-29
- v2.7 Dead Code & Code Smell Cleanup (Phases 69-74) -- shipped 2026-02-02
- v2.8 Disabled Selections (Phases 75-79) -- shipped 2026-02-06

**In Progress:**
- v2.9 Theatre View (Phases 80-84) -- 5 phases, 21 requirements

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Scoped callback `game.animate()` over fire-and-forget `emitAnimationEvent`
- Theatre view as default, current view opt-in
- Per-event advancement over per-batch
- Replace `emitAnimationEvent` entirely (no backward compat)
- AnimationEvent.mutations is optional (not required) for backward compat with emitAnimationEvent
- Capture context pattern: nullable _captureContext on Game, set during animate() callback
- Element operations check game._captureContext to record mutations (putInto records MOVE, create records CREATE)
- Game root excluded from element attribute snapshot (tracked via property diff instead)
- SET_PROPERTY targets snapshot.attributes (where GameElement.toJSON() puts custom properties)
- MOVE to non-existent destination = removal (pile pattern)
- Theatre snapshot lazy-init in animate() (not on Game construction) -- zero overhead for non-animated games
- Snapshot cleared to null when all events acknowledged -- theatreState getter falls through to toJSON()
- getElementById() for theatre visibility filtering (checks main tree + pile for removed elements)
- structuredClone for theatre snapshot deep copy before per-player filtering
- Theatre childCount uses json.children?.length (theatre count, not truth count)
- currentView optional (undefined when theatre equals truth) for bandwidth optimization
- Theatre view as primary view field in buildPlayerState() -- semantic change from truth to theatre as default
- WebSocket acknowledgeAnimations handler validates spectator, game, and upToId

### Pending Todos

None.

### Blockers/Concerns

None.

## Session Continuity

Last session: 2026-02-07
Stopped at: Completed Phase 82 (Session Integration), ready for Phase 83
Resume file: None
