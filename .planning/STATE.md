# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-05)

**Core value:** Make board game development fast and correct -- the framework handles multiplayer, AI, and UI so designers focus on game rules.
**Current focus:** Phase 79 — fix element-type disabled in getChoices (gap closure from audit)

## Current Position

Phase: 79 of 79 (Fix element-type disabled in getChoices)
Plan: 0 of 0 in current phase (not yet planned)
Status: Phase added from audit gap closure
Last activity: 2026-02-06 -- Phase 79 added to close audit gaps

Progress: [█████████░] 95%

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

**Current:**
- v2.8 Disabled Selections (Phases 75-79) -- in progress

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- `disabled` runs only on filter-passed items (filter = visibility, disabled = selectability)
- `disabled` returns `string | false` (no bare `true`) -- forces reason string
- `AnnotatedChoice<T>` has `value` + `disabled` only -- display layered by session/UI
- `disabled?: string` on wire (optional, not `string | false`)
- Disabled check runs before containment check in validateSelection for specific error messages
- AI bot preserves unknown[] contract by filtering disabled internally
- hasValidSelectionPath filters to enabled for required, skips for optional
- Sparse wire disabled: field absent (not undefined) on enabled items for clean JSON
- PickHandler evaluates disabled callback directly (no delegation to executor.getChoices())
- Board interaction ValidElement separate from controller ValidElement; both carry disabled?: string independently
- isDisabledElement returns false (not undefined) for non-disabled elements
- HTML disabled attribute prevents clicks natively -- no custom guards needed in button handlers
- Multi-select checkbox disabled is compound: element.disabled OR max-reached
- bs-element-disabled CSS overrides action-selectable green highlighting
- getChoices/getCurrentChoices return type includes disabled?: string (no as any casts needed)
- findMatchingChoice pattern: find() then check disabled before containment in validateSelection
- Auto-fill filters to enabled choices before counting across all 3 code paths

### Pending Todos

None.

### Blockers/Concerns

None.

## Session Continuity

Last session: 2026-02-06
Stopped at: Phase 79 added from audit gap closure, needs planning
Resume file: None
