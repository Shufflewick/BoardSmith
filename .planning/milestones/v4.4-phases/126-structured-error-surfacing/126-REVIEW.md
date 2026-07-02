---
phase: 126-structured-error-surfacing
reviewed: 2026-07-02T00:00:00Z
depth: standard
files_reviewed: 20
files_reviewed_list:
  - src/cli/dev-host/bridge.test.ts
  - src/cli/dev-host/bridge.ts
  - src/cli/dev-host/log-capture.test.ts
  - src/cli/dev-host/log-capture.ts
  - src/runtime/runner.test.ts
  - src/runtime/runner.ts
  - src/session/ai-circuit-breaker.test.ts
  - src/session/game-session.test.ts
  - src/session/game-session.ts
  - src/session/pending-action-manager.ts
  - src/session/pick-handler.test.ts
  - src/session/pick-handler.ts
  - src/session/snapshot-session-host.test.ts
  - src/session/snapshot-session-host.ts
  - src/session/stateless-ops.test.ts
  - src/session/stateless-ops.ts
  - src/session/types.ts
  - src/types/protocol.ts
  - src/ui/components/DebugPanel.tabs.test.ts
  - src/ui/components/DebugPanel.vue
findings:
  critical: 1
  warning: 3
  info: 1
  total: 5
status: fixed
fix_iteration: 1
fixed_at: 2026-07-02T00:00:00Z
resolutions:
  CR-01: fixed (commit 2450aed)
  WR-01: fixed (commit 00e10ac) — documented as best-effort concurrency caveat, not serialized
  WR-02: fixed (commit 35f3492)
  WR-03: fixed (commit f4dc3cf)
  IN-01: skipped — non-blocking per reviewer; rename would require updating the reserved
    taxonomy note and any external consumers keying off 'CHOICES_ERROR' (grep confirms
    only one internal use site, but the code's own comment marks it a reserved stable
    code); left as-is pending a dedicated follow-up
---

# Phase 126: Code Review Report

**Reviewed:** 2026-07-02
**Depth:** standard
**Files Reviewed:** 20
**Status:** issues_found (fixed — see resolutions below)

## Summary

Reviewed the full ERR-01..ERR-04 implementation (structured warnings, runner/op errorCode, persistence-failure observability, dev-host log ring buffer). The persistence funnel (`#persistSafely`/`persistSafely`) is genuinely single-funnel on both `GameSession` and `SnapshotSessionHost`, correctly avoids Pitfall 2 (AI/persistence failure misclassification), never leaks stack traces, and guards a throwing hook. `WarningEntry`/`sanitizeErrorMessage` correctly avoid leaking `error.stack` at every pick-handler soft-fail site, and the DebugPanel Logs tab uses plain Vue interpolation (no `v-html`) so there is no XSS vector there.

However, there is one BLOCKER: `bridge.ts`'s `shapeResult` — the exact mechanism this phase built to thread `OpResult.errorCode`/`warnings` to a dev-host client — has a manually-maintained field allowlist per wire op, and while `warnings` was added to the `'action'` and `'selection_step'` cases (Plan 03/04), `errorCode` (the entire subject of ERR-02 / Plan 01) was never added to either. A failed `action` or `selection_step` op over the dev-host bridge still surfaces only `{success, error}` — the very same flattened-string regression ERR-02 set out to fix — with no test catching the omission. Three further WARNINGs cover a persistence-counter race under concurrent saves, a misleading "snapshot" doc-comment on `log-capture.ts`'s `getEntries()`, and incomplete `errorCode` coverage on non-auto-create `PendingActionManager.processSelectionStep` failure branches.

## Critical Issues

### CR-01: `bridge.ts` `shapeResult` drops `errorCode` on the `action` and `selection_step` wire cases

**Resolution: FIXED (commit 2450aed).** `shapeResult`'s `'action'` case now includes
`errorCode: result.errorCode`; the `'selection_step'` failure branch now includes
`errorCode: result.errorCode`. Added `bridge.test.ts` regression tests forwarding
`errorCode` on both a failing `'action'` and failing `'selection_step'` result,
mirroring the existing warnings-forwarding tests. Full test suite (1999 tests) and
`tsc --noEmit` clean.

**File:** `src/cli/dev-host/bridge.ts:249-262`
**Issue:** `OpResult.errorCode` (added in Plan 126-01, the entire subject of ERR-02) is never referenced anywhere in `bridge.ts` (`grep -n "errorCode" src/cli/dev-host/bridge.ts` returns nothing). `shapeResult`'s `'action'` case returns `{ success, error, followUp, warnings }` and the `'selection_step'` failure branch returns `{ success: false, error }` — neither includes `errorCode`. Since `shapeResult` is a manually-maintained allowlist per wire op (by design, per the RESEARCH-Pitfall-4 comment at bridge.ts:125), any field not explicitly listed is silently dropped at this boundary. This means a client driving a game through `boardsmith dev` (the exact scriptable/agent-driven surface this phase and the adjacent "Follow active seat" agent-testing tooling target) receives the same flattened `error` string ERR-02 was written to eliminate — it can never branch on `NOT_YOUR_TURN` vs `ENGINE_ERROR` vs `ACTION_EXECUTION_ERROR` from a dev-host action/selectionStep response. `resolve_choices` is unaffected (it is a full passthrough of `result`, which does carry `errorCode`), so the gap is specific to the two most common wire ops. `bridge.test.ts` has no assertion for `errorCode` anywhere (`grep -n "errorCode" src/cli/dev-host/bridge.test.ts` returns nothing), so this regression was never caught by the phase's own verification claims.
**Fix:**
```ts
case 'action':
  return { success: result.success, error: result.error, errorCode: result.errorCode, followUp: result.followUp, warnings: result.warnings };
case 'selection_step':
  if (!result.success) return { success: false, error: result.error, errorCode: result.errorCode };
  return {
    success: true,
    done: result.done,
    nextChoices: result.nextChoices,
    actionComplete: result.actionComplete,
    followUp: result.followUp,
    warnings: result.warnings,
  };
```
Add a regression test mirroring the existing warnings-forwarding tests (`bridge.test.ts:128-163`) asserting `errorCode` survives `shapeResult('action', ...)` and `shapeResult('selection_step', ...)` for a failing result.

## Warnings

### WR-01: Persistence consecutive-failure counter is not concurrency-safe

**Resolution: FIXED (commit 00e10ac) — documented, not serialized.** Verified every
known call site (`GameSession.create()`'s initial save, `#save()`'s direct-action/
tutorial-advance/AI-turn paths within `#performAction`) awaits `#persistSafely`
sequentially — the two `#save()` calls inside a single `performAction` are both
`await`ed, never fired concurrently. The genuine hazard (an external host issuing
overlapping `performAction`/`handleOp` calls for the *same* session without
serializing per-session requests) is architecture-level and outside this session
layer's control; a promise-chain serialization refactor was judged too invasive to
land blind without a reproducing caller. Documented the best-effort limitation
explicitly on both `persistenceHealthy` getters (`game-session.ts`,
`snapshot-session-host.ts`) and both `#persistSafely`/`persistSafely` methods so
future callers are not misled by the docstring's implied exactness.

**File:** `src/session/game-session.ts:2029-2051`, `src/session/snapshot-session-host.ts:165-187`
**Issue:** `#persistSafely`/`persistSafely` increments/resets `#persistenceConsecutiveFailures` around an `await op()` with no serialization guard. If two saves are in flight concurrently (e.g. a direct action's `#save()` overlapping with a tutorial-advance `#save()` inside the same `performAction` call, or two independent overlapping `performAction` calls under a host that doesn't serialize requests per session), a failing save's increment can be immediately reset to `0` by an overlapping successful save that resolves afterward (or vice versa), so `persistenceHealthy`'s 3-consecutive-failure threshold can both false-positive (never flip unhealthy despite a real outage, if failures interleave with lucky successes) and false-negative in the other direction. This is exactly the kind of "shared-tree concurrency hazard" this project has hit before (see project memory: v4.3 shared-tree concurrency hazard learnings).
**Fix:** Serialize persistence attempts through a single in-flight promise chain (e.g. `this.#persistChain = this.#persistChain.then(() => op())...`) so consecutive-failure accounting reflects true call order, or document explicitly that the counter is best-effort under concurrent callers and is not meant to be exact.

### WR-02: `log-capture.ts` `getEntries()` returns the live mutable array, contradicting its own doc comment

**Resolution: FIXED (commit 35f3492).** `getEntries()` now returns `[...entries]`
(a shallow copy) instead of the module-level array reference; doc comment updated
to explain why the copy matters (future callers holding the reference across an
`await`). Existing `log-capture.test.ts` (3 tests) and `bridge.test.ts`'s
`debug:logs` tests still pass unchanged.

**File:** `src/cli/dev-host/log-capture.ts:45-48`
**Issue:** The doc comment says `/** Snapshot of all currently captured entries, oldest first. */` but the implementation is `return entries;` — the actual module-level array reference, not a copy. Any future caller that holds the returned reference across an `await` (unlike today's single synchronous read-and-serialize in `bridge.ts:366`) will observe entries mutating out from under it as new `record()` calls push/shift the same array. This is a footgun for exactly the kind of forward-compatible reuse this module documents itself as being designed for (dev-only, but still a correctness landmine for the next caller).
**Fix:**
```ts
export function getEntries(): readonly LogEntry[] {
  return [...entries];
}
```

### WR-03: `PendingActionManager.processSelectionStep`'s non-auto-create failure branches still drop `errorCode`

**Resolution: FIXED (commit f4dc3cf).** Threaded `ErrorCode.PICK_NOT_FOUND` for "no
pending action" (line ~170), "no current selection" (~187), and the selection-name
mismatch (~192); `ErrorCode.ACTION_NOT_FOUND` for the pending-state's own
action-not-found branch (~179); `ErrorCode.INVALID_PICK` for the repeating-selection
error branch (~204) and the regular (non-repeating) selection validation-failure
branch (~234). Added 4 regression tests in `pending-action-manager.test.ts`
covering each reachable branch (PICK_NOT_FOUND ×2, ACTION_NOT_FOUND, INVALID_PICK).

**File:** `src/session/pending-action-manager.ts:175, 183, 188, 196, 226`
**Issue:** Plan 126-01 added `PickStepResult.errorCode` and forwarded it only from the auto-create-pending-action branch (line 144: `errorCode: startResult.errorCode`). Every other failure return in the same function — `Action not found: ...` (175), `No current selection` (183), `Expected selection at index ...` (188), the repeating-selection `result.error` branch (196), and the non-repeating `stepResult.error` branch (226) — still returns no `errorCode` at all. A `selectionStep` op that fails through any of these paths (which cover several of the most common real-world selection-step failure modes, not just the auto-create edge case) still degrades to an unclassified string for `handleSelectionStep`/`OpResult.errorCode` consumers, undermining ERR-02's stated goal ("Runner failures reuse/extend the existing ErrorCode enum ... classification happens at the catch site") for this call path.
**Fix:** At minimum, thread the existing `ErrorCode` values these branches' messages imply (`ACTION_NOT_FOUND` at line 175, `PICK_NOT_FOUND`-equivalent for "No current selection"/"Expected selection..." at 183/188, `INVALID_PICK` for the two `.error` branches at 196/226 where applicable) rather than leaving them all `undefined`.

## Info

### IN-01: `boardRef()`'s warning code `CHOICES_ERROR` is easily confused with the unrelated `CHOICES_EVALUATION_ERROR` hard-fail `ErrorCode`

**Resolution: SKIPPED.** Confirmed via grep that `'CHOICES_ERROR'` has exactly one
use site (`pick-handler.ts:414`) and no test asserts on the literal string. However
the code's own comment marks it "the reserved stable code for boardRef() failures
... see the taxonomy in the plan's CONTEXT note" — the reviewer's own suggested fix
requires updating that reserved taxonomy note as part of the rename, which is a
docs/contract change beyond a trivial code edit. Deferred to a dedicated follow-up
per the reviewer's own "non-blocking" classification.

**File:** `src/session/pick-handler.ts:411-417`
**Issue:** The soft-fail warning code for `boardRef()` throwing is `'CHOICES_ERROR'` (a `WarningEntry.code` string), while the pre-existing hard-fail `getChoices()` failure uses `ErrorCode.CHOICES_EVALUATION_ERROR`. The two are different types (string literal vs enum) and different severities (soft warning vs hard failure) but share the "choices" name stem, which is a plausible source of confusion for any consumer that greps for `CHOICES` in error-handling switch statements. This was flagged by the implementers themselves in the plan summary as reading "oddly," so it is a known, deliberate tradeoff rather than an oversight — noted here for visibility only.
**Fix:** Consider renaming to `BOARD_REF_ERROR` in a follow-up (non-blocking; would require updating the reserved taxonomy note and any external consumers already keying off `'CHOICES_ERROR'`).

---

_Reviewed: 2026-07-02_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
