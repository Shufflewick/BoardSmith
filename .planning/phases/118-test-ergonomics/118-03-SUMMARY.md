---
phase: 118-test-ergonomics
plan: "03"
subsystem: testing
tags: [testing, assertions, debug-trace, tdd]
dependency_graph:
  requires: []
  provides: [TEST-03, TEST-04]
  affects: [src/testing/assertions.ts]
tech_stack:
  added: []
  patterns: [trace-on-failure, actionsMode-guard, spy-verified-no-call]
key_files:
  created:
    - src/testing/assertions.test.ts
  modified:
    - src/testing/assertions.ts
decisions:
  - "Used debugActionAvailability (not traceAction) per D-05 — traceAction accesses stale (game as any).actions plain object while engine uses private _actions Map"
  - "actionsMode defaults to 'exact' per D-06 — zero migration impact; 'contains' must be explicitly opted into"
  - "debugActionAvailability called ONLY in failure branch — Pitfall 4 guard, no perf regression on passing assertions"
  - "Selections block omitted from error message when no selection lines (e.g. unregistered action with no selections)"
metrics:
  duration: "~5 minutes"
  completed: "2026-06-30"
  tasks_completed: 3
  files_changed: 2
---

# Phase 118 Plan 03: Assertion Trace + actionsMode Summary

Self-explaining assertion failures via `debugActionAvailability` trace and opt-in permissive action-list assertions via `actionsMode`.

## What Was Built

**TEST-03 — assertActionAvailable trace on failure**

In the failure branch of `assertActionAvailable` (assertions.ts:194), after confirming the action is not in `availableActions`: resolve the player object via `testGame.getPlayer(playerSeat)`, call `testGame.game.debugActionAvailability(actionName, player)`, and build an enriched error message:

```
Action "constrained" is not available for player 1.
Available actions: [pick, pass]
Why: Selection 'value' has no valid choices (No elements/choices available)
Selections:
  ✗ 'value': 0 choices — No elements/choices available
```

The trace is called ONLY in the failure branch — no perf regression on passing assertions. No `traceAction()` usage (D-05 compliance verified by grep).

**TEST-04 — assertFlowState actionsMode**

Added `actionsMode?: 'exact' | 'contains'` to `ExpectedFlowState` with full JSDoc. The extra-actions check is now guarded behind `(expected.actionsMode ?? 'exact') === 'exact'`. The missing-actions check remains unconditional in both modes. Omitting `actionsMode` produces identical behavior to the pre-change default (D-06 backward compat).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Write failing TEST-03 + TEST-04 tests (RED) | f0581d6 | src/testing/assertions.test.ts (created) |
| 2 | Wire trace into assertActionAvailable (TEST-03, GREEN) | c79d67e | src/testing/assertions.ts |
| 3 | Add actionsMode to assertFlowState (TEST-04, GREEN) | 1327b5c | src/testing/assertions.ts |

## Verification

- `npx vitest run src/testing/assertions.test.ts` — 6/6 green
- `npx vitest run src/testing/` — 63/63 green
- `npx tsc --noEmit` — 0 new errors (pre-existing baseline errors unchanged)
- `grep -c traceAction src/testing/assertions.ts` → 0 (D-05 compliance)
- Spy test confirms `debugActionAvailability` not called on passing path

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Threat Flags

None — in-process test utility only, no network/auth/secrets surface.

## Self-Check: PASSED

- src/testing/assertions.test.ts — FOUND
- src/testing/assertions.ts — FOUND (modified)
- Commit f0581d6 — FOUND
- Commit c79d67e — FOUND
- Commit 1327b5c — FOUND
