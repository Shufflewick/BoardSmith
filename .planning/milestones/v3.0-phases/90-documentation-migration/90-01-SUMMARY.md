---
phase: 90-documentation-migration
plan: 01
subsystem: documentation
tags: [docs, animation-events, migration, nomenclature, v3.0]
dependency_graph:
  requires: [85-animation-events, 86-animation-cleanup, 87-animation-integration, 88-animation-polish, 89-ui-integration]
  provides: [updated-animation-docs, v3.0-nomenclature, migration-guide]
  affects: [90-02]
tech_stack:
  added: []
  patterns: [pure-data-events, wait-for-handler, client-owned-playback]
key_files:
  created:
    - docs/migration-guide.md
  modified:
    - docs/ui-components.md
    - docs/nomenclature.md
decisions:
  - id: 90-01-D1
    description: "Migration guide organized by task (what developers DO) rather than by removed API"
    rationale: "Task-oriented guides are more actionable than API removal lists"
metrics:
  duration: "4 minutes"
  completed: "2026-02-08"
---

# Phase 90 Plan 01: Documentation & Migration Guide Summary

Updated all BoardSmith documentation to reflect the v3.0 animation system: rewrote ui-components.md animation section for pure-data event model, removed Theatre View/Current View/Mutation Capture from nomenclature.md, and created a task-oriented migration-guide.md with before/after examples.

## What Was Done

### Task 1: Rewrite ui-components.md animation events section
**Commit:** `4e5aed1`

Rewrote lines 1090-1307 of `docs/ui-components.md` to document the v3.0 pure-data animation event model:

- Replaced theatre view / mutation capture / acknowledgment language throughout
- Key Concepts now describes: pure data events, immediate state advancement, client-owned playback, wait-for-handler
- Engine-side section shows pure data form as primary (`game.animate(type, data)`), callback as optional convenience
- UI-side section removes `acknowledge` parameter, adds `handlerWaitTimeout` option
- Removed "Forgetting to acknowledge events" pitfall
- Added "Forgetting handlerWaitTimeout for lazily-mounted components" pitfall
- Updated `skipAll()` description to remove acknowledgment language

### Task 2: Update nomenclature.md terminology
**Commit:** `b9ee23b`

Updated `docs/nomenclature.md` to remove v2.9 concepts and add v3.0 terminology:

- Quick Reference Table: updated Animation Event definition, removed Current View / Mutation Capture / Theatre View rows, added Animation Timeline and Wait-for-Handler rows, re-sorted alphabetically
- Animation Section: rewrote Animation Event definition as pure data signal, updated Soft Continuation to remove theatre references, deleted Theatre View / Current View / Mutation Capture entries entirely, added Animation Timeline and Wait-for-Handler entries with full definitions, code references, and usage examples

### Task 3: Create migration-guide.md for v3.0
**Commit:** `a1613be`

Created `docs/migration-guide.md` with a task-oriented v3.0 migration guide:

- Step 1: Update `game.animate()` calls (remove empty callbacks, keep truth-advancing callbacks, remove mutation-capture patterns)
- Step 2: Update `createAnimationEvents()` (remove `acknowledge`, add `handlerWaitTimeout`)
- Step 3: Remove `useCurrentView()` usage (replace with `gameView` from GameShell)
- Step 4: Remove theatre state references (replace with `toJSON()` / `toJSONForPlayer()`)
- Step 5: Animation handlers need no changes
- Documents new wait-for-handler behavior
- Includes migration checklist with 9 items
- References BREAKING.md for complete API removal list

## Decisions Made

| ID | Decision | Rationale |
|----|----------|-----------|
| 90-01-D1 | Migration guide organized by task (what developers DO) rather than by removed API | Task-oriented guides are more actionable than API removal lists -- developers want to know "what do I change" not "what was removed" |

## Deviations from Plan

None -- plan executed exactly as written.

## Verification Results

All verification checks passed:

1. `grep -ri "theatre" docs/ui-components.md docs/nomenclature.md` -- NO matches
2. `grep -ri "mutation capture" docs/ui-components.md docs/nomenclature.md` -- NO matches
3. `grep -ri "acknowledge" docs/ui-components.md` -- NO matches
4. `docs/migration-guide.md` exists with v3.0 content, before/after examples, and checklist
5. All three docs files are internally consistent with no cross-references to removed concepts

## Next Phase Readiness

Plan 90-02 (example game migration) can proceed. The documentation now accurately describes the v3.0 API that the example games need to migrate to.
