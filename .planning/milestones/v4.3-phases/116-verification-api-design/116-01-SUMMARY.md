---
phase: 116-verification-api-design
plan: "01"
subsystem: planning
tags: [design, verification, api-spec, no-src-changes]
dependency_graph:
  requires: []
  provides: [".planning/v4.3-API-DESIGN.md"]
  affects: ["Phase 117 INTRO implementation", "Phase 118 TEST implementation", "Phase 119 DEV implementation", "Phase 120 PIT implementation"]
tech_stack:
  added: []
  patterns: ["verdicts table with file:line evidence", "API spec with full TypeScript signatures"]
key_files:
  created:
    - .planning/v4.3-API-DESIGN.md
  modified: []
decisions:
  - "INTRO-01 arg-template: optional→null, required→{__required:true} sentinel"
  - "INTRO-03 default format: in-process element objects (wire format opt-in)"
  - "DEV-01 attribute direction: align AutoUI to emit data-bs-el-id (anchorAttrs is single source of truth)"
  - "INTRO-F1 checkpoint/rewind API promoted to IN-scope (trivial expose-not-build)"
  - "TEST-03 trace source: use game.debugActionAvailability(), not stale traceAction()"
metrics:
  duration: "~25 min"
  completed: "2026-06-30"
  tasks_completed: 2
  tasks_total: 2
  files_created: 1
  files_modified: 0
---

# Phase 116 Plan 01: Verification Verdicts & INTRO/TEST API Spec Summary

Produced `.planning/v4.3-API-DESIGN.md` — the locked planning contract for Phases 117–121. Contains 19 verification verdicts with file:line evidence and full TypeScript API specifications for 10 surfaces (INTRO-01..05, TEST-01..05).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Spot-check load-bearing citations and author Part 1 Verdicts Table | b105810 | `.planning/v4.3-API-DESIGN.md` (created) |
| 2 | Author Part 2 API spec for INTRO and TEST surfaces | b105810 | `.planning/v4.3-API-DESIGN.md` (extended) |

## What Was Built

**Part 1 — Verification Verdicts Table (19 rows):**
- Three named claims: INTRO-05/getPlayerView (CONFIRMED), INTRO-F1/checkpoint-rewind (CONFIRMED — promoted to IN-scope), DEV-03/action-resolved-signal (PARTIAL — Vue ref exists, DOM signal must build)
- All friction claims: INTRO-01..04 (3 PARTIAL, 1 FALSE), TEST-01..05 (2 PARTIAL, 3 FALSE), DEV-01..04 (1 PARTIAL, 2 FALSE, 1 FALSE), PIT-01..04 (3 FALSE, 1 PARTIAL)
- Spot-check log: 8 citation groups verified against live `src/` — all confirmed accurate, zero corrections needed

**Part 2 — INTRO/TEST API Spec:**
- INTRO-01: `game.getActionSpace(seat)` → `ActionSpaceView` — BUILD (wraps `buildActionMetadata` + `availableActionsForSeat`)
- INTRO-02: `game.getActionSchema(actionName, seat)` + document `buildSingleActionMetadata` — EXPOSE/DOCUMENT
- INTRO-03: `buildActionArgs(actionName, selectionValues, game, seat, options?)` — BUILD (in-process default, wire opt-in)
- INTRO-04: `enumerateLegalMoves(game, seat, options?)` — BUILD (extract from `MCTSBot.enumerateAllMoves`)
- INTRO-05: `createPlayerView` / `runner.getPlayerView` / `testGame.getPlayerView` — DOCUMENT existing
- TEST-01: `testGame.getPlayerView(seat)` — DOCUMENT existing
- TEST-02: `playUntilComplete(testGame, options?)` + `GameStuckError` — BUILD
- TEST-03: Extend `assertActionAvailable` to call `game.debugActionAvailability()` on failure — BUILD
- TEST-04: Extend `assertFlowState` with `actionsMode: 'exact' | 'contains'` — BUILD
- TEST-05: `ActionBuilder` class with fluent `select()` / `execute()` / `buildArgs()` — BUILD

## Deviations from Plan

None — plan executed exactly as written.

## Key Decisions

1. **INTRO-01 arg-template format:** Optional selections → `null`; required selections → `{ __required: true }` sentinel. Rationale: self-describing template without re-reading PickMetadata; `null` is natural for "no value yet" on optional picks.

2. **INTRO-03 wire-vs-in-process:** In-process element-object args are the default (90% use case is headless/TestGame). Wire format (`{ __elementRef }`) is opt-in via `{ format: 'wire' }` for cross-process agents.

3. **INTRO-F1 promoted to IN-scope:** All five StateHistory methods (`getStateAtAction`, `getStateDiff`, `getActionTraces`, `undoToTurnStart`, `rewindToAction`) are fully implemented and public on `GameSession`. Only gap is type exports (`UndoResult`, `ElementDiff`) not in session barrel — ~5 lines.

4. **TEST-03 trace source:** Use `game.debugActionAvailability()` directly. `traceAction()` in `debug.ts` accesses `(game as any).actions` (plain object) while engine uses `game._actions` (private Map) — likely stale (Assumption A1 confirmed as risk).

5. **DEV-01 attribute direction:** AutoUI must gain `data-bs-el-id` (alongside existing `data-element-id`). `anchorAttrs()` is declared single source of truth; must not modify it to emit `data-element-id`.

## Known Stubs

None — this plan produces only a planning document, no production code.

## Threat Flags

None — no production code modified, no trust boundaries crossed.

## Self-Check: PASSED

- [x] `.planning/v4.3-API-DESIGN.md` exists
- [x] `git log --oneline | grep b105810` → commit found
- [x] `git diff --stat src/` → clean (no src/ modifications)
- [x] 19 verdict rows in Part 1
- [x] 10 "Owning module" entries in Part 2 (INTRO-01..05 + TEST-01..05)
- [x] Both design decisions (INTRO-01, INTRO-03) stated explicitly with rationale
- [x] `getActionSpace` specified as wrapping `buildActionMetadata` (no parallel validator)
- [x] INTRO-05 marked DOCUMENT-existing
