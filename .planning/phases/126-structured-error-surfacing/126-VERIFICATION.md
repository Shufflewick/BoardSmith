---
phase: 126-structured-error-surfacing
verified: 2026-07-02T01:00:00Z
status: passed
score: 4/4 must-haves verified
overrides_applied: 0
---

# Phase 126: Structured Error Surfacing Verification Report

**Phase Goal:** Failures at the pick-handler, action-runner, storage, and dev-host layers surface as structured, inspectable signals instead of console-only silent fallbacks.
**Verified:** 2026-07-02
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth (ROADMAP Success Criterion) | Status | Evidence |
|---|---|---|---|
| 1 | Pick-result warnings are structured + inspectable (boardRefs/display/boardRef failures produce `{code,message,source}`, success not flipped) | VERIFIED | `src/session/pick-handler.ts`: `WarningEntry` pushed at `BOARD_REFS_ERROR` (line 253), `DISPLAY_ERROR` (385), `CHOICES_ERROR` for boardRef (414), all via `sanitizeErrorMessage()` (line 41, never `.stack`). `getChoices()` hard-fail path untouched (regression-tested). `pick-handler.test.ts` asserts all three + regression + no-stack-trace. |
| 2 | Runner failures carry structured `errorCode` AND it survives to the wire (bridge `shapeResult` forwards it — CR-01 fix) | VERIFIED | `src/runtime/runner.ts` sets `ErrorCode.ENGINE_ERROR`/`ACTION_EXECUTION_ERROR` on both gap branches. `src/session/stateless-ops.ts` threads `errorCode` through `OpResult`. `src/cli/dev-host/bridge.ts:253,260` — `shapeResult`'s `'action'` and `'selection_step'` cases now include `errorCode: result.errorCode` (confirmed by direct grep — this is the CR-01 fix, applied post-review, commit `2450aed`). `bridge.test.ts:186-213` has explicit regression tests asserting `errorCode` survives both wire cases. |
| 3 | Storage failures observable (`onPersistenceError` 3-arg + `lastPersistenceError` + `persistenceHealthy` flip at 3 on BOTH hosts, AI-misclassification regression test present) | VERIFIED | `game-session.ts` and `snapshot-session-host.ts` both define `PERSISTENCE_UNHEALTHY_THRESHOLD = 3`, `onPersistenceError` 3-arg callback `(entry, consecutiveFailures, healthy)`, `persistenceHealthy` getter (`< THRESHOLD`), and never-rethrowing `#persistSafely`/`persistSafely` wrapping every save/persist call site. `ai-circuit-breaker.test.ts:105` — dedicated "persistence misclassification regression (Pitfall 2 / T-126-04)" describe block proving no false `"[AI] Giving up"` log. |
| 4 | `debug:logs` op returns captured entries (ring buffer FIFO, dual-channel capture: warnings + bridge errors + persistence escalation), session layer has zero imports of log-capture | VERIFIED | `src/cli/dev-host/log-capture.ts`: `MAX_LOG_ENTRIES = 300`, FIFO `record()`/`getEntries()`. `bridge.ts`: `'debug:logs'` WireOp (line 229/233 translateOp marker, 313/371 handleServerRequest intercept — bypasses `executeOp`), persistence adapter calls `record(healthy ? 'warning' : 'error', ...)` (343), `OpResult.warnings` captured per-op (384), bridge:325-equivalent catch captured (390). `grep -rn "cli/dev-host" src/session/` returns nothing — confirmed clean, no reverse import. |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `src/session/types.ts` | `WarningEntry` type | VERIFIED | Confirmed present, imported by pick-handler.ts |
| `src/session/pick-handler.ts` | warnings pushed at 3 soft-fail sites | VERIFIED | All 3 sites confirmed via grep + read |
| `src/runtime/runner.ts` | ErrorCode on 2 gap branches | VERIFIED | Confirmed in Plan 01 SUMMARY + independent grep pass |
| `src/session/stateless-ops.ts` | OpResult.errorCode + warnings threaded | VERIFIED | Confirmed |
| `src/cli/dev-host/bridge.ts` | shapeResult forwards errorCode + warnings; debug:logs op | VERIFIED | Direct grep confirms both errorCode (CR-01 fix) and debug:logs wiring |
| `src/session/game-session.ts` | onPersistenceError/lastPersistenceError/persistenceHealthy/#persistSafely | VERIFIED | Confirmed via grep |
| `src/session/snapshot-session-host.ts` | Symmetric persistence surface | VERIFIED | Confirmed via grep |
| `src/cli/dev-host/log-capture.ts` | Ring buffer module | VERIFIED | Confirmed via grep + read |
| `src/ui/components/DebugPanel.vue` | Logs tab | VERIFIED | `DebugPanel.tabs.test.ts` 23 tests green (7 tabs) |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `stateless-ops.ts errorResult()` | runner `ActionExecutionResult.errorCode` | 3rd param threaded | WIRED | Confirmed in Plan 01 |
| `pick-handler.ts` warnings | `bridge.ts shapeResult` | OpResult.warnings | WIRED | Plan 03; regression-tested |
| `bridge.ts shapeResult` (action/selection_step) | `OpResult.errorCode` | CR-01 fix | WIRED | Post-review fix confirmed live in code, with dedicated regression tests |
| `GameSession/SnapshotSessionHost onPersistenceError` | `log-capture.record()` | dev-host adapter (dependency dev-host → session only) | WIRED | Confirmed; `grep -rn "cli/dev-host" src/session/` clean |
| bridge.ts op boundary (success/catch) | `log-capture.record()` | warnings loop + catch-site record | WIRED | Confirmed at lines 384/390 |
| DebugPanel.vue `fetchLogs()` | `debug:logs` WS op | debugRequest pattern | WIRED | Confirmed via grep + tabs test suite green |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| ERR-01 | 126-03 | boardRefs/display/getChoices structured warnings | SATISFIED | pick-handler.ts + pick-handler.test.ts |
| ERR-02 | 126-01 | Runner errorCode classification | SATISFIED | runner.ts + stateless-ops.ts + bridge.ts (CR-01 fix) |
| ERR-03 | 126-02 | Storage failure observability | SATISFIED | game-session.ts + snapshot-session-host.ts + ai-circuit-breaker.test.ts |
| ERR-04 | 126-04 | debug:logs WS op | SATISFIED | log-capture.ts + bridge.ts + DebugPanel.vue |

No orphaned requirements — REQUIREMENTS.md lists exactly ERR-01..04 mapped to Phase 126, all four claimed and satisfied.

### Anti-Patterns Found

None blocking. The phase's own code-review (126-REVIEW.md) found 1 critical (CR-01: bridge.ts dropped errorCode on wire) and 3 warnings (concurrency-safety documentation caveat, log-capture mutable-array doc fix, PendingActionManager errorCode gaps) — all four were fixed post-review (commits `2450aed`, `00e10ac`, `35f3492`, `f4dc3cf`), independently confirmed present in the current tree via direct grep (see Truth #2, `persistenceHealthy` doc-comment concurrency caveat at game-session.ts:2040/snapshot-session-host.ts:175, and `getEntries()` copy behavior). One info-level finding (IN-01, `CHOICES_ERROR` naming ambiguity) was explicitly deferred by the reviewer as non-blocking with documented justification — not a gap.

### Independent Test Run

- `npm test` — 149 test files, 1999 tests, all green (matches SUMMARY claims independently reproduced).
- `npx tsc --noEmit -p .` — pre-existing errors only, none in any of the 20 files this phase modified (verified by cross-referencing the error file list against 126-REVIEW.md's `files_reviewed_list` and each plan's `files_modified`; `DebugPanel.tabs.test.ts`'s single pre-existing `TS7006` was confirmed by the SUMMARY via `git stash` to predate this phase).

### Behavioral Spot-Checks

Not run as live browser/server checks — all four ROADMAP success criteria were instead verified via direct code inspection (grep + read) matching the actual committed source, which is stronger evidence than a spot-check for this phase's scope (no running server required to confirm structural wiring).

### Probe Execution

No `scripts/*/tests/probe-*.sh` probes declared or discovered for this phase. N/A.

### Human Verification Required

None. The dev-host live smoke test (`boardsmith dev` in go-fish, trigger a warning, poll `debug:logs`) was explicitly documented in `126-VALIDATION.md`'s Manual-Only Verifications table as **optional**, on the grounds that unit coverage of the full host-lifecycle + bridge chain makes it unnecessary. That unit coverage was independently confirmed to exist and pass (`bridge.test.ts`'s `debug:logs host-lifecycle op` and `log-capture wiring` describe blocks, 25 tests green per Plan 04 SUMMARY, reproduced in the full 1999-test run above).

### Gaps Summary

No gaps. All four ROADMAP success criteria are independently verified against the current codebase (not just SUMMARY claims): structured pick-handler warnings, runner+wire errorCode (including the critical CR-01 bridge fix confirmed live), symmetric persistence observability with the AI-misclassification regression test, and a working `debug:logs` ring buffer with confirmed dev-host/session layering discipline. The one code-review BLOCKER (CR-01) and three WARNINGs were all fixed post-SUMMARY and independently re-confirmed in the current tree rather than trusted from the REVIEW.md narrative alone.

---

_Verified: 2026-07-02_
_Verifier: Claude (gsd-verifier)_
