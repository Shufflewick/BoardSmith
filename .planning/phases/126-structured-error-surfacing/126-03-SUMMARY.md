---
phase: 126-structured-error-surfacing
plan: 03
subsystem: session/pick-handler + dev-host bridge
tags: [error-handling, warnings, pick-handler, stateless-ops, dev-host-bridge, TypeScript]

# Dependency graph
requires: ["126-01"]
provides:
  - "WarningEntry type ({code, message, source}) + optional warnings? on PickChoicesResponse/OpResult/PickStepResult"
  - "Structured warnings pushed at the three pick-handler soft-fail sites (boardRefs/display/boardRef), aggregated top-level on getPickChoices's response"
  - "display() catch now also echoes console.error (previously silent — the worst offender)"
  - "OpResult.warnings threaded through handleResolveChoices (real path) and handleSelectionStep (wiring, forward-compatible)"
  - "bridge.ts shapeResult forwards warnings on the 'action' and 'selection_step' wire cases; 'resolve_choices' passthrough regression-guarded"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Soft-fail warnings never flip success:false — only the pre-existing getChoices() hard-fail path (errorCode) does that, and it is untouched"
    - "sanitizeErrorMessage() extracts error.message only, never error.stack or a file path — grep gate `error.stack` == 0 in pick-handler.ts"
    - "Reserved stable warning code taxonomy: BOARD_REFS_ERROR, DISPLAY_ERROR, CHOICES_ERROR (boardRef()), PERSISTENCE_ERROR (reserved, not used here)"

key-files:
  created: []
  modified:
    - src/session/types.ts
    - src/session/pick-handler.ts
    - src/session/pick-handler.test.ts
    - src/session/stateless-ops.ts
    - src/session/stateless-ops.test.ts
    - src/session/pending-action-manager.ts
    - src/cli/dev-host/bridge.ts
    - src/cli/dev-host/bridge.test.ts

key-decisions:
  - "boardRef()'s warning code is CHOICES_ERROR per the plan's reserved taxonomy note (not BOARD_REF_ERROR), even though the name reads oddly — followed the CONTEXT interface spec literally"
  - "Added PickStepResult.warnings? in pending-action-manager.ts (not in the plan's files_modified list) — required so handleSelectionStep's `step.warnings` forwarding type-checks (Rule 3: blocking TS issue). This field is always undefined via the current repeating/non-repeating step-processing code paths, which never call boardRefs()/display()/boardRef() — only PickHandler.getPickChoices() (used by resolveChoices) does. The plumbing is forward-compatible, not a fabricated guarantee."
  - "selectionStep's warnings-threading is verified via a PickHandler.prototype.processSelectionStep spy (proves the wiring), not a real gameplay fixture — there is currently no live code path where a selectionStep op's underlying pick response carries warnings. resolveChoices IS proven end-to-end with a real boardRefs()-throwing fixture."

requirements-completed: [ERR-01]

# Metrics
duration: 40min
completed: 2026-07-02
---

# Phase 126 Plan 03: Structured Warnings for boardRefs/display/boardRef Summary

**`boardRefs()`, `display()`, and `boardRef()` failures in `pick-handler.ts` now push a structured `WarningEntry {code, message, source}` onto the pick response instead of degrading silently (or, for `display()`, not logging at all) — the choice/element is still returned via its existing graceful fallback, `getChoices()`'s hard-fail errorCode path is untouched, and the warnings survive `OpResult` and the dev-host bridge's manual `shapeResult` allowlist for the `action` and `selection_step` wire cases.**

## Performance

- **Duration:** ~40 min
- **Tasks:** 2/2 completed

## Accomplishments

- `WarningEntry` type added to `types.ts`, plus optional `warnings?: WarningEntry[]` on `PickChoicesResponse`.
- All three soft-fail catch sites in `pick-handler.ts`'s `getPickChoices` now push a sanitized, stable-coded warning while keeping their fallback behavior: `boardRefs()` → `BOARD_REFS_ERROR` (console.error echo already existed, kept), `display()` → `DISPLAY_ERROR` (console.error echo added — this was the silent worst offender), `boardRef()` → `CHOICES_ERROR` (the taxonomy's reserved code for this site).
- `getChoices()`'s existing hard-fail `errorCode` behavior (`CHOICES_EVALUATION_ERROR`/`ELEMENTS_EVALUATION_ERROR`) is untouched and regression-tested.
- `OpResult.warnings?` added to `stateless-ops.ts`; `handleResolveChoices` forwards the pick response's warnings (proven end-to-end via a real `boardRefs()`-throwing fixture). `handleSelectionStep` also forwards `step.warnings` for forward-compatible wiring.
- `bridge.ts`'s `shapeResult` now forwards `result.warnings` for the `'action'` and `'selection_step'` wire cases; `'resolve_choices'` was already a full passthrough (regression-guarded by a new test).

## Task Commits

Each task was committed atomically:

1. **Task 1: WarningEntry type + push warnings at the three soft-fail pick-handler sites** - `71d39ca` (feat)
2. **Task 2: Thread warnings onto OpResult and through the bridge shapeResult allowlist** - `54a8d61` (feat)

**Plan metadata:** (this commit) - docs: complete plan

## Files Created/Modified

- `src/session/types.ts` - Added `WarningEntry` interface + `warnings?: WarningEntry[]` on `PickChoicesResponse`.
- `src/session/pick-handler.ts` - Added `sanitizeErrorMessage()` helper (never leaks `error.stack`); built a local `warnings: WarningEntry[]` in `getPickChoices`, pushed at the `boardRefs`, `display` (+ added the missing `console.error` echo), and `boardRef` catch sites; threaded `warnings` through `#buildValidElementsList` and attached to all three success returns (`choice`/`element`/`elements` cases) as `warnings.length > 0 ? warnings : undefined`.
- `src/session/pick-handler.test.ts` - Extended `BoardRefsGame` with four new throwing-callback actions (`moveThrowBoardRefs`, `selectSquareThrowDisplay`, `selectSquareThrowBoardRef`, `pickThrowChoices` — the last conditional on `args.trigger` to avoid breaking the unconditional action-reachability sweep, mirroring the existing `BadChoicesGame` pattern in `stateless-ops.test.ts`). Added a `PickHandler structured warnings (ERR-01)` describe block: 3 positive warning tests, 1 getChoices hard-fail regression test, 1 no-stack-trace/no-file-path test.
- `src/session/stateless-ops.ts` - Added `OpResult.warnings?: WarningEntry[]`; forwarded `result.warnings` in `handleResolveChoices` and `step.warnings` in `handleSelectionStep`.
- `src/session/stateless-ops.test.ts` - Added a `WarningGame` fixture (boardRefs()-throwing `chooseFrom`) proving `resolveChoices` op forwards warnings end-to-end; added a `selectionStep warnings threading` describe block that spies on `PickHandler.prototype.processSelectionStep` to prove `handleSelectionStep`'s forwarding wiring (documented as a wiring proof, not a live-gameplay-producible scenario today).
- `src/session/pending-action-manager.ts` - Added `PickStepResult.warnings?: WarningEntry[]` (Rule 3 — required for `handleSelectionStep`'s forwarding to type-check).
- `src/cli/dev-host/bridge.ts` - `shapeResult`'s `'action'` and `'selection_step'` cases now include `warnings: result.warnings`.
- `src/cli/dev-host/bridge.test.ts` - Added 3 tests: warnings forwarded on `'action'`, warnings forwarded on `'selection_step'`, and a `'resolve_choices'` regression guard proving its full-passthrough still carries warnings.

## Decisions Made

See key-decisions in frontmatter. Notably: `boardRef()`'s stable code is `CHOICES_ERROR` per the plan's reserved taxonomy (not the more intuitive `BOARD_REF_ERROR`), and `PickStepResult.warnings?` was added outside the plan's stated `files_modified` list as necessary type-plumbing for `handleSelectionStep` — always `undefined` today since no live selectionStep code path invokes the three soft-fail callbacks (only `getPickChoices`, used by `resolveChoices`, does).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] `PickStepResult` had no `warnings` field, blocking `handleSelectionStep`'s type-safe forwarding**
- **Found during:** Task 2
- **Issue:** The plan's interfaces note says `handleSelectionStep` should "wrap the pick response" and forward warnings, but `PickStepResult` (returned by `PickHandler.processSelectionStep`, which wraps `PendingActionManager.processSelectionStep`) had no `warnings` field at all — `step.warnings` would not type-check.
- **Fix:** Added `warnings?: WarningEntry[]` to `PickStepResult` in `pending-action-manager.ts` (not in the plan's `files_modified` list, but a minimal necessary addition).
- **Files modified:** `src/session/pending-action-manager.ts`
- **Verification:** `npx vitest run src/session/stateless-ops.test.ts src/session/pending-action-manager.test.ts` — all green; `npx tsc --noEmit -p .` shows no new errors in this file.
- **Committed in:** `54a8d61` (part of Task 2 commit)

## Verification Results

- `npx vitest run src/session/pick-handler.test.ts src/session/stateless-ops.test.ts src/cli/dev-host/bridge.test.ts` — 78 tests, all green.
- `npx vitest run` (full suite) — 1981 tests / 148 files, all green.
- `npx tsc --noEmit -p .` — no new errors in any of the 8 modified files (pre-existing unrelated errors in other test files untouched, per PROJECT.md's known repo-wide tsc test-file looseness).
- `grep -v '^\s*//' src/session/pick-handler.ts | grep -c "error.stack"` — 0 (T-126-07 mitigation holds; adjusted a docstring that had literally mentioned "error.stack" in prose to avoid a false-positive grep match while keeping the same meaning).

## Must-Haves Validation

- ✅ "A throwing boardRefs() produces a structured warning and the choice is still returned/selectable" — `pick-handler.test.ts` "a throwing boardRefs() produces a structured warning and the choice is still returned/selectable"
- ✅ "A throwing display() produces a structured warning, falls back to a default label, and echoes to console" — `pick-handler.test.ts` "a throwing display() produces a structured warning, falls back to a default label, and echoes to console"
- ✅ "getChoices() still hard-fails with its existing errorCode (regression unchanged)" — `pick-handler.test.ts` "regression: a throwing getChoices() still returns success:false with the existing CHOICES_EVALUATION_ERROR errorCode"
- ✅ "Warnings ride OpResult and survive the dev-host bridge shapeResult allowlist" — `stateless-ops.test.ts` "carries structured warnings from a throwing boardRefs() while still succeeding (ERR-01)" + `bridge.test.ts`'s three warnings-forwarding tests
- ✅ `grep -c "WarningEntry" src/session/types.ts` >= 1 (count=2)
- ✅ `grep -c "BOARD_REFS_ERROR\|DISPLAY_ERROR" src/session/pick-handler.ts` >= 2 (count=2)
- ✅ `grep -v '^\s*//' src/session/pick-handler.ts | grep -c "error.stack"` == 0
- ✅ `grep -c "warnings" src/cli/dev-host/bridge.ts` >= 2 (action + selection_step cases)
- ✅ `grep -c "warnings" src/session/stateless-ops.ts` >= 2 (field + threading)

## Known Stubs

None. `handleSelectionStep`'s warnings forwarding is real, type-safe wiring — it is simply never exercised by a non-empty array in current gameplay because no selectionStep code path invokes the three soft-fail callbacks. This is documented above (key-decisions), not a stub masking missing functionality.

## Threat Flags

None — this plan only adds a new optional field to existing response/result types and forwards it through an existing allowlist function; no new network endpoints, auth paths, file access, or schema changes were introduced. T-126-07 (stack-leak), T-126-08 (soft-fail never becomes hard-fail), and T-126-09 (warnings dropped at the bridge allowlist) mitigations from the plan's threat model were all honored and test-covered.

## Deferred / Out-of-scope Notes

`npm run audit:dead-code` was run per CLAUDE.md's Code Quality Audits section and reported pre-existing repo-wide findings (dead exports, circular deps, complexity hotspots including `pick-handler.ts`'s `getPickChoices` at cognitive complexity 55 and `stateless-ops.ts`'s `handleHeatmapToggle` at 32). These predate this plan's changes (the function was already large before the ~15 lines added here) and are out of this plan's scope per the SCOPE BOUNDARY rule — logged here for visibility, not fixed.

## Self-Check: PASSED
