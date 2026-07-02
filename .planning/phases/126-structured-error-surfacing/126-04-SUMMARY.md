---
phase: 126-structured-error-surfacing
plan: 04
subsystem: cli/dev-host (bridge + log-capture) + ui/DebugPanel
tags: [error-handling, dev-host, ring-buffer, WS-op, DebugPanel, TDD]

# Dependency graph
requires: ["126-02", "126-03"]
provides:
  - "log-capture.ts: an in-process capped ring buffer (MAX_LOG_ENTRIES=300, FIFO) confined to src/cli/dev-host/ — record(severity, message, source) + getEntries()"
  - "debug:logs WS op: a host-lifecycle op resolved directly in bridge.ts's handleServerRequest (never routed through executeOp/host.handleOp) returning the ring buffer's captured entries"
  - "Dual-channel capture wired at the real bridge.ts sites: createDevSession's onPersistenceError adapter (health-escalated), OpResult.warnings per resolved op, and the bridge.ts:325 catch (the only dev-host console.error site)"
  - "DebugPanel Logs tab (7th tab, before Controls) polling debug:logs like the existing History tab"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "DebugLogsMarker: a bridge-local type ({ type: 'debugLogs' }), NOT a member of the session layer's Op union — translateOp's return type is widened locally (Op | DebugLogsMarker | undefined) so debug:logs never touches stateless-ops.ts, keeping session-layer types clean and the purity contract intact by construction (not just by convention)"
    - "shapeResult's second parameter widened to OpResult & { entries?: readonly LogEntry[] } (intersection, not union) so the existing per-wireOp property access on OpResult still type-checks for every pre-existing case"
    - "DevSessionOptions gained an optional persist adapter (previously absent) purely so tests could exercise the onPersistenceError→record() wiring end-to-end; production dev-host callers are unaffected (still unconfigured by default)"

key-files:
  created:
    - src/cli/dev-host/log-capture.ts
    - src/cli/dev-host/log-capture.test.ts
  modified:
    - src/cli/dev-host/bridge.ts
    - src/cli/dev-host/bridge.test.ts
    - src/ui/components/DebugPanel.vue
    - src/ui/components/DebugPanel.tabs.test.ts

key-decisions:
  - "Resolved the checker's explicit ambiguity (intercept debug:logs BEFORE translateOp, or add it to the Op union) by choosing: translateOp DOES produce a marker for 'debug:logs' (satisfying the plan's required translateOp test), but that marker's type (DebugLogsMarker) is declared locally in bridge.ts and is NOT unioned into stateless-ops.ts's Op type. handleServerRequest checks `op.type === 'debugLogs'` and short-circuits before ever calling host.handleOp/executeOp. This keeps session-layer types clean (grep for 'debugLogs' in stateless-ops.ts is 0) while still giving translateOp/shapeResult the debug:flow-state-shaped bridge template the interfaces note asked for."
  - "Added an optional `persist` field to DevSessionOptions (not explicitly listed in the plan's files_modified, but required to make the onPersistenceError→record() wiring testable end-to-end) — the dev host's production callsite (multiplayer-host.ts) does not configure it, so this is additive/inert for existing behavior (Rule 3 — minimal necessary plumbing, same category as Plan 126-03's PickStepResult.warnings? addition)."
  - "Logs tab placed as the 7th tab, directly before Controls (which stays last) — minimizes churn in the existing ARIA tablist regression test (DebugPanel.tabs.test.ts), whose End-key/wrap-around assertions specifically depend on Controls remaining the last tab."

requirements-completed: [ERR-04]

# Metrics
duration: ~50min
completed: 2026-07-02
---

# Phase 126 Plan 04: Structured Error Surfacing — debug:logs Ring Buffer & DebugPanel Summary

**A connected dev-host client can now pull captured server-side errors/warnings — session errors, persistence failures (health-escalated), and structured pick-handler warnings — over a `debug:logs` WS op and view them in a new DebugPanel Logs tab, closing ERR-04's "only visible in the terminal" gap without ever routing the ring buffer through the pure `executeOp` or letting the session layer import dev-host code.**

## Performance

- **Duration:** ~50 min
- **Tasks:** 2/2 completed

## Accomplishments

- `src/cli/dev-host/log-capture.ts`: a capped FIFO ring buffer (`MAX_LOG_ENTRIES = 300`, mirroring the `MAX_AI_MOVES`/`MAX_DEMO_MOVES` naming convention) with `record(severity, message, source)` and `getEntries()`. Confined to `src/cli/dev-host/`; `grep -rn "cli/dev-host" src/session/` is empty, proving the session layer never imports it.
- `bridge.ts`'s `createDevSession` now supplies an `onPersistenceError` adapter to `SnapshotSessionHost` that calls `record()`, escalating severity to `'error'` once `persistenceHealthy` flips `false` (otherwise `'warning'`), sourced as `'persistence'`.
- `handleServerRequest`'s success path now records each `OpResult.warnings` entry as a `'warning'`, sourced by the wireOp name — the debug:logs channel for structured warnings, in addition to the channel-1 passthrough on the op result itself (Plan 126-03).
- `handleServerRequest`'s catch block (the real bridge.ts:325 `console.error` site — the only one in the dev host) now also records an `'error'` entry sourced by the wireOp name, alongside the preserved console echo.
- `debug:logs` is a new `WireOp`. `translateOp('debug:logs', ...)` returns a `DebugLogsMarker` (`{ type: 'debugLogs' }`) — a bridge-local type, not part of the session layer's `Op` union. `handleServerRequest` intercepts this marker before it ever reaches `host.handleOp`/`executeOp`, resolving directly from `getEntries()`. `shapeResult('debug:logs', ...)` returns `{ success, error, entries }`.
- `DebugPanel.vue` gained a 7th "Logs" tab (placed before Controls) that polls `debug:logs` the same way the existing History tab polls `debug:history` (`fetchLogs()` mirrors `fetchHistory()`'s loading/error/refresh-on-state-change shape), rendering each entry with a severity badge, source, timestamp, and message.

## Task Commits

Followed RED (failing test) → GREEN (implementation) for both tasks:

1. **Task 1: log-capture ring buffer + persistence/warnings/boundary-error capture in bridge.ts**
   - `5cfb88c` (test) — failing tests for the ring buffer module
   - `cbf6612` (feat) — log-capture.ts implementation
   - `d54f9f8` (test) — failing tests for the bridge.ts wiring + debug:logs op
   - `121252a` (feat) — bridge.ts wiring implementation
2. **Task 2: debug:logs host-lifecycle op + DebugPanel Logs tab**
   - (bridge.ts translateOp/shapeResult/handleServerRequest for debug:logs were implemented together with Task 1's `121252a`, since both tasks share bridge.ts and the RED tests for both were written in the same pass — see Deviations)
   - `be3bf68` (feat) — DebugPanel.vue Logs tab + DebugPanel.tabs.test.ts tab-count update

**Plan metadata:** (this commit) — docs: complete plan

## Files Created/Modified

- `src/cli/dev-host/log-capture.ts` — New. `MAX_LOG_ENTRIES = 300`, `LogEntry` interface, `record()`, `getEntries()`, and a test-only `clearEntries()`.
- `src/cli/dev-host/log-capture.test.ts` — New. FIFO eviction, entry shape, no-stack-trace assertions.
- `src/cli/dev-host/bridge.ts` — Added `'debug:logs'` to `WireOp`; `DebugLogsMarker` type + widened `translateOp` return type; `DevSessionOptions.persist?` (test-enabling plumbing); `createDevSession`'s `onPersistenceError` adapter; `handleServerRequest`'s `debugLogs` short-circuit, warnings capture loop, and the bridge.ts:325 catch's `record()` call; `shapeResult`'s `'debug:logs'` case and widened parameter type.
- `src/cli/dev-host/bridge.test.ts` — New `log-capture wiring` describe block (persistence/warnings/throwing-op capture) and `debug:logs host-lifecycle op` describe block (translateOp/shapeResult/handleServerRequest/regression-guard).
- `src/ui/components/DebugPanel.vue` — `logEntries`/`logsLoading`/`logsError`/`logsLastFetched` refs, `LogEntry` interface, `fetchLogs()`, two `watch()` blocks (tab switch + state change) mirroring the History tab's polling pattern, the "Logs" tab descriptor + template panel, and severity-badge CSS.
- `src/ui/components/DebugPanel.tabs.test.ts` — Updated `TAB_IDS`, the tab-count assertion (6→7), and the inactive-tab count assertion (5→6) for the new Logs tab; End-key/wrap-around assertions were left unchanged because Controls remains the last tab.

## Decisions Made

See key-decisions in frontmatter. The most consequential: resolving the checker's explicit "intercept before translateOp, or add to the Op union" question by doing neither literally — `translateOp` DOES produce a marker (satisfying the required test), but that marker's type lives only in bridge.ts, never entering `stateless-ops.ts`'s `Op` union. This makes the purity contract (`debugLogs` absent from `READ_ONLY_OP_TYPES`/`executeOp`) true by construction, not just by a "don't add it" convention that a future edit could accidentally violate.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] `DevSessionOptions` had no way to configure a `persist` adapter, blocking a real end-to-end test of the `onPersistenceError` → `record()` wiring**
- **Found during:** Task 1, writing the failing bridge.test.ts persistence test
- **Issue:** `SnapshotSessionHost` already supports `persist`/`onPersistenceError` (Plan 126-02), but `bridge.ts`'s `createDevSession` never exposed a way to supply a `persist` function — there was no way to make `persistSafely` actually invoke (and fail) without one.
- **Fix:** Added an optional `persist?` field to `DevSessionOptions`, threaded straight through to `new SnapshotSessionHost({ persist: opts.persist, ... })`. Unconfigured by default; the current production dev-host callsite (`multiplayer-host.ts`) does not set it, so this is purely additive.
- **Files modified:** `src/cli/dev-host/bridge.ts`
- **Verification:** `npx vitest run src/cli/dev-host/bridge.test.ts` — the 3-failure/health-escalation test passes; `npx tsc --noEmit -p .` shows no new errors.
- **Committed in:** `121252a`

**2. [Rule 1 - Pre-existing test-suite coupling] The ARIA tablist regression test hardcoded "6 tabs" and specific wrap-around/End-key targets**
- **Found during:** Task 2, adding the Logs tab
- **Issue:** `DebugPanel.tabs.test.ts` asserted exactly 6 `role="tab"` elements, 5 inactive tabs, and a fixed `TAB_IDS` array — all of which a 7th tab would break.
- **Fix:** Updated the tab count (6→7), inactive count (5→6), and `TAB_IDS` array to include `'logs'`. Placed the Logs tab immediately before Controls (not at the very end) so the existing End-key/wrap-around assertions — which specifically depend on Controls being the last tab — needed no further changes.
- **Files modified:** `src/ui/components/DebugPanel.tabs.test.ts`
- **Verification:** `npx vitest run src/ui/components/DebugPanel.tabs.test.ts` — all 23 tests (up from 20) green.
- **Committed in:** `be3bf68`

### Task boundary note

Task 1's `read_first`/`action` text and Task 2's both touch `bridge.ts`, and this plan's RED tests for both tasks were written and verified failing together before any implementation (both share the same `handleServerRequest`/`translateOp`/`shapeResult` functions, so splitting the RED/GREEN cycle strictly per-task would have meant re-editing the same functions twice). Task 1's GREEN commit (`121252a`) therefore includes the `debug:logs` WireOp/translateOp/shapeResult/handleServerRequest wiring that Task 2's acceptance criteria check. Task 2's own commit (`be3bf68`) covers the DebugPanel.vue portion, which is genuinely independent. All of Task 1's and Task 2's `<acceptance_criteria>` greps and tests pass against the final tree (verified below).

## Verification Results

- `npx vitest run src/cli/dev-host/log-capture.test.ts src/cli/dev-host/bridge.test.ts` — 25 tests, all green.
- `npx vitest run src/ui/components/DebugPanel.tabs.test.ts src/ui/components/DebugPanel.shortcut.test.ts` — 32 tests, all green.
- `npx vitest run` (full suite) — 149 files / 1993 tests, all green.
- `npx tsc --noEmit -p .` — no new errors in any of the 6 modified/created files (one pre-existing, unrelated `TS7006` in `DebugPanel.tabs.test.ts` confirmed via `git stash` to predate this plan's changes).
- `grep -c "MAX_LOG_ENTRIES" src/cli/dev-host/log-capture.ts` → 3 (>= 1 required).
- `grep -rn "cli/dev-host" src/session/` → empty (no reverse import).
- `grep -c "record(" src/cli/dev-host/bridge.ts` → 3 (persistence adapter + warnings loop + bridge:325 catch).
- The bridge.ts:325 catch site (`console.error('[boardsmith dev] server_request ...')`) is immediately followed by a `record('error', ...)` call — confirmed via `sed` line-range inspection (verified manually; the plan's literal grep-with-`${wireOp}`-in-double-quotes gate is a shell-quoting artifact, not a real signal — the actual site is wired).
- `grep -c "error.stack" src/cli/dev-host/log-capture.ts` → 0.
- `grep -c "debug:logs" src/cli/dev-host/bridge.ts` → 7 (>= 3 required: WireOp, translateOp case, shapeResult case, handleServerRequest intercept, doc comments).
- `grep -c "debugLogs" src/session/stateless-ops.ts` → 0 (never routed through executeOp).
- `grep -c "debug:logs" src/ui/components/DebugPanel.vue` → 3 (>= 1 required).

## Must-Haves Validation

- ✅ "A connected dev-host client can request captured server-side errors/warnings via a debug:logs WS op" — `bridge.test.ts` "debug:logs host-lifecycle op" describe block; `DebugPanel.vue`'s Logs tab.
- ✅ "The log ring buffer lives in the dev-host process and caps at MAX_LOG_ENTRIES = 300" — `log-capture.test.ts` FIFO eviction test.
- ✅ "The session layer never imports dev-host log-capture code" — `grep -rn "cli/dev-host" src/session/` empty.
- ✅ "Persistence errors feed the ring buffer via onPersistenceError, escalated to 'error' when persistenceHealthy is false" — `bridge.test.ts` "a persist() failure is captured..." test (3 consecutive failures → warning, warning, error).
- ✅ "Structured OpResult.warnings are recorded into the ring buffer at the dev-host op boundary as severity 'warning', sourced by op name" — `bridge.test.ts` "a resolved op's OpResult.warnings are captured..." test.
- ✅ "Session errors caught at the dev-host request boundary (bridge.ts:325) are recorded into the ring buffer" — `bridge.test.ts` "a server_request that throws is captured..." test.

## Known Stubs

None.

## Threat Flags

None new beyond what the plan's own threat model already registers (T-126-10..13, T-126-SC) — all disposed and verified above (mitigate/mitigate/mitigate/accept/accept). No new network endpoints, auth paths, or schema changes: `debug:logs` is an addition to the existing dev-only debug:* WS op family, gated the same way as its siblings (process-wide, no per-seat filtering, consistent accepted precedent).

## Self-Check: PASSED

All claimed files verified present via `[ -f ... ]`; all 5 task commit hashes verified present via `git log --oneline --all`.
