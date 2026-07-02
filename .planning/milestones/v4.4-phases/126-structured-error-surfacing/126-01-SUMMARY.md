---
phase: 126-structured-error-surfacing
plan: 01
subsystem: runtime/session
tags: [error-handling, errorCode, GameRunner, stateless-ops, pick-handler, TypeScript]

# Dependency graph
requires: []
provides:
  - "ErrorCode.ENGINE_ERROR + ErrorCode.ACTION_EXECUTION_ERROR on the shared ErrorCode enum"
  - "GameRunner.performAction sets errorCode on both previously-uncoded failure branches"
  - "OpResult.errorCode field, threaded through handleAction/handleSelectionStep/handleResolveChoices/handleAITurn"
  - "PickStepResult.errorCode (pending-action-manager) so selection-step failures no longer drop errorCode"
affects: [127-scriptable-dev-host]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "errorCode set at the point of detection only, never re-inferred from message text (mirrors existing runner INVALID_PLAYER/NOT_YOUR_TURN pattern)"
    - "errorResult(error, category, errorCode) — errorCode is optional and left undefined for protocol-level failures with no upstream code, never fabricated"

key-files:
  created: []
  modified:
    - src/types/protocol.ts
    - src/runtime/runner.ts
    - src/runtime/runner.test.ts
    - src/session/stateless-ops.ts
    - src/session/stateless-ops.test.ts
    - src/session/pending-action-manager.ts

key-decisions:
  - "Set errorCode at the source only (runner.ts, pick-handler.ts); did not extend game-session.ts's legacy string-matching inference (per threat model T-126-02)"
  - "Extended PickStepResult with errorCode and fixed a dropped-errorCode bug in PendingActionManager's auto-create branch (Rule 1) since the plan's handleSelectionStep call site requires step.errorCode to actually exist upstream"
  - "Test fixture design: an unconditionally-throwing Action.execute() does NOT reach the runner's continueFlow catch — ActionExecutor already wraps and converts it to a normal failure result. Used an unguarded execute() flow node instead to prove a genuine uncaught-throw path for ENGINE_ERROR coverage"
  - "Test fixture design: an unconditionally-throwing choices() function breaks game start itself (game.getAvailableActions iterates ALL registered actions on every actionStep re-evaluation, calling hasValidSelectionPath -> choices() unguarded, regardless of actionStep membership). Made the throw conditional on an explicit args.trigger flag so the reachability check (called with args:{}) never throws, isolating the failure to the deliberate resolveChoices call"

requirements-completed: [ERR-02]

# Metrics
duration: 35min
completed: 2026-07-02
---

# Phase 126 Plan 01: Structured Error Surfacing — Runner + Op Layer Summary

**Runner action-execution failures and the session op layer now carry a structured `ErrorCode` an agent can branch on instead of a flattened message string, closing both gap branches in `GameRunner.performAction` and three (plus AI) error-dropping wrapper call sites in `stateless-ops.ts`.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 2/2 completed
- **Files modified:** 6

## Accomplishments
- `ErrorCode` enum extended with `ENGINE_ERROR` (continueFlow throw) and `ACTION_EXECUTION_ERROR` (flowState.actionError) — both previously undefined on `GameRunner.performAction`'s failure paths.
- `OpResult.errorCode` added and threaded through `handleAction`, `handleSelectionStep`, `handleResolveChoices`, and the AI-action wrap — these handlers previously computed or received an errorCode from the runner/pick-handler and silently dropped it.
- Found and fixed (Rule 1) a pre-existing errorCode drop in `PendingActionManager.processSelectionStep`'s auto-create-pending-action branch, which is the underlying data source `handleSelectionStep` needed to forward.

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend ErrorCode enum + set errorCode on the two runner gap branches** - `cdf4d08` (feat)
2. **Task 2: Add OpResult.errorCode and thread it through the wrapping op handlers** - `31e98ed` (feat)

**Plan metadata:** (this commit) - docs: complete plan

## Files Created/Modified
- `src/types/protocol.ts` - Added `ENGINE_ERROR` + `ACTION_EXECUTION_ERROR` under a new "Engine/execution errors" block in `ErrorCode`.
- `src/runtime/runner.ts` - Set `errorCode: ErrorCode.ENGINE_ERROR` on the continueFlow catch branch and `errorCode: ErrorCode.ACTION_EXECUTION_ERROR` on the flowState.actionError branch of `performAction`.
- `src/runtime/runner.test.ts` - Added a `ThrowingFlowGame` fixture (unguarded `execute()` flow node) proving a genuine uncaught throw reaches ENGINE_ERROR, plus a not-in-allow-list action test proving ACTION_EXECUTION_ERROR; both assert the error message never contains stack-frame text or file paths.
- `src/session/stateless-ops.ts` - Added `OpResult.errorCode`, a third `errorCode` param on `errorResult()`, and threaded `actionResult.errorCode` / `step.errorCode` / `result.errorCode` through the three wrapping call sites plus the AI-action wrap.
- `src/session/stateless-ops.test.ts` - Added a `BadChoicesGame` fixture (conditional-throw `choices()` via `args.trigger`) proving `CHOICES_EVALUATION_ERROR` survives `resolveChoices`, a `NOT_YOUR_TURN` action-op test, an `ACTION_EXECUTION_ERROR` unknown-action assertion, and a protocol-only-failure assertion that `errorCode` stays `undefined` (never fabricated).
- `src/session/pending-action-manager.ts` - Added `errorCode` to `PickStepResult` and forwarded `startResult.errorCode` in the auto-create-pending-action failure branch (previously dropped).

## Decisions Made
- errorCode is set only at the point of detection (runner.ts, pick-handler.ts / pending-action-manager.ts) — no changes to the legacy string-matching fallback in game-session.ts, per the threat model's T-126-02 mitigation.
- See key-decisions in frontmatter for the two test-fixture design choices required to reach each gap branch without tripping unrelated engine behavior (ActionExecutor's execute()-throw wrapping, and game.getAvailableActions's whole-registry reachability sweep).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] PendingActionManager silently dropped errorCode on auto-create-pending-action failure**
- **Found during:** Task 2
- **Issue:** `processSelectionStep`'s auto-create branch called `startPendingAction`, which already computes an `errorCode` (e.g. `ACTION_NOT_FOUND`), but returned only `{ success: false, error: startResult.error }`, discarding it. `PickStepResult` also had no `errorCode` field at all, so `handleSelectionStep`'s planned `step.errorCode` forward would have been forwarding `undefined` even on a real upstream failure.
- **Fix:** Added `errorCode?: ErrorCode` to `PickStepResult` and forwarded `startResult.errorCode` in the auto-create branch.
- **Files modified:** `src/session/pending-action-manager.ts`
- **Verification:** `npx vitest run src/session/pending-action-manager.test.ts src/session/stateless-ops.test.ts` — 56 tests green.
- **Committed in:** `31e98ed` (part of Task 2 commit)

## Verification Results

- `npx vitest run src/runtime/runner.test.ts src/session/stateless-ops.test.ts` — 66 tests, all green.
- `npx vitest run` (full suite) — 1960 tests / 148 files, all green.
- `npx tsc --noEmit -p .` — no new errors introduced in any of the 6 modified files (pre-existing unrelated errors in other files untouched).
- `grep -rn "error.stack" src/runtime/runner.ts src/session/stateless-ops.ts` — no matches (T-126-01 mitigation holds).

## Must-Haves Validation

- ✅ "A continueFlow() throw in the runner returns errorCode ENGINE_ERROR" — `runner.test.ts` "should report ENGINE_ERROR when continueFlow throws"
- ✅ "A flowState.actionError returns errorCode ACTION_EXECUTION_ERROR" — `runner.test.ts` "should report ACTION_EXECUTION_ERROR when flowState.actionError is set"
- ✅ "An op result for a failed action/selection/resolve carries the underlying errorCode instead of dropping it" — `stateless-ops.test.ts` NOT_YOUR_TURN/ACTION_EXECUTION_ERROR/CHOICES_EVALUATION_ERROR tests
- ✅ `src/types/protocol.ts` contains `ENGINE_ERROR` (grep -c >= 2: passes, count=2)
- ✅ `src/runtime/runner.ts` contains `ErrorCode.ENGINE_ERROR` (grep -c == 2: passes)
- ✅ `errorResult()` threads a third `errorCode` argument at handleAction/handleSelectionStep/handleResolveChoices (pattern `errorResult\([^)]*errorCode` matches all three plus the AI-action wrap)

## Known Stubs

None.

## Threat Flags

None — this plan only extends existing error-reporting fields; no new network endpoints, auth paths, file access, or schema changes were introduced. Both T-126-01 (stack-leak) and T-126-02 (re-inference) mitigations from the plan's threat model were honored as specified.

## Self-Check: PASSED
