---
phase: 110-demonstration-refinement
plan: "04"
subsystem: checkers (cross-repo)
tags: [cross-repo, ai, hint, checkers]
dependency_graph:
  requires: [110-02]
  provides: [DEMO-01 hintTargetFromMove]
  affects: [BoardSmithGames/checkers/src/rules/index.ts]
tech_stack:
  added: []
  patterns: [hintTargetFromMove destination resolution, cross-repo-commit]
key_files:
  created:
    - ~/BoardSmithGames/checkers/tests/hint-target.test.ts
  modified:
    - ~/BoardSmithGames/checkers/src/rules/index.ts
decisions:
  - "hintTargetFromMove casts destination to { toNotation?: string } and optional-chains — never throws, returns undefined as safe bubble fallback (T-110-09 mitigation)"
metrics:
  duration: "2 minutes"
  completed_date: "2026-06-29"
  tasks_completed: 1
  tasks_total: 1
  files_changed: 2
---

# Phase 110 Plan 04: checkers hintTargetFromMove Summary

**One-liner:** Added `hintTargetFromMove` to checkers `gameDefinition.ai` so the AI hint highlights the destination board square via `{ notation: destination.toNotation }` instead of showing a floating-only bubble.

## Tasks Completed

| Task | Name | Commit (checkers repo) | Files |
|------|------|------------------------|-------|
| 1 | Add hintTargetFromMove to checkers gameDefinition.ai | d437521 | src/rules/index.ts, tests/hint-target.test.ts |

## What Was Built

The checkers `destination` argument is an object `{ pieceId, fromNotation, toNotation, isCapture, ... }`. Without a custom `hintTargetFromMove`, the default `DEST_ARGS` fallback in the BoardSmith hint op only matches plain `string`/`number` values and would return `undefined`, causing the hint to render as a floating "Suggested move" bubble with no board highlight.

The new hook resolves `destination.toNotation` and returns `{ notation: toNotation }` so the annotation target is wired to the correct board square. The optional-chain ensures a safe `undefined` return (bubble fallback) when the shape is unexpected — satisfying threat T-110-09.

4 unit tests cover: destination present (returns notation), no destination arg (undefined), destination is undefined (undefined), destination has no toNotation (undefined).

## Verification

- `cd ~/BoardSmithGames/checkers && npx vitest run` — **35/35 passed** (4 new + 31 existing)
- Code committed in `~/BoardSmithGames/checkers` repo (commit `d437521`) — NOT in BoardSmith

## Deviations from Plan

None — plan executed exactly as written.

## Threat Surface Scan

No new network endpoints, auth paths, or schema changes. The `hintTargetFromMove` hook is pure computation over a trusted engine-produced object. T-110-09 mitigation verified (optional-chain, never throws).

## Self-Check: PASSED

- `/Users/jtsmith/BoardSmithGames/checkers/src/rules/index.ts` contains `hintTargetFromMove` ✓
- `/Users/jtsmith/BoardSmithGames/checkers/tests/hint-target.test.ts` exists ✓
- Checkers repo commit `d437521` exists ✓
- Checkers vitest 35/35 green ✓
