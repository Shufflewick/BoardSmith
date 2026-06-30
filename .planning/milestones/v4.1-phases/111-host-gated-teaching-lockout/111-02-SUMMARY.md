---
phase: 111
plan: "02"
subsystem: session/dev-host
tags: [teaching-lockout, dev-host, stateless-ops, bridge, tdd]
dependency_graph:
  requires: []
  provides: [executeOp.teachingDisabled guards, SnapshotSessionHost.demoStart guard, state.teachingDisabled broadcast, DevSessionOptions.teachingDisabled]
  affects:
    - src/session/stateless-ops.ts
    - src/session/stateless-ops.test.ts
    - src/session/snapshot-session-host.ts
    - src/session/snapshot-session-host.test.ts
    - src/cli/dev-host/bridge.ts
    - src/cli/dev-host/bridge.test.ts
tech_stack:
  added: []
  patterns: [fail-loud guards via gameOptions input bag, throw in handleOp for host lifecycle, unconditional broadcast injection, hasTransient short-circuit fix]
key_files:
  created: []
  modified:
    - src/session/stateless-ops.ts
    - src/session/stateless-ops.test.ts
    - src/session/snapshot-session-host.ts
    - src/session/snapshot-session-host.test.ts
    - src/cli/dev-host/bridge.ts
    - src/cli/dev-host/bridge.test.ts
decisions:
  - "Pure executeOp reads teachingDisabled from the gameOptions bag (open-bag pattern, no signature change) — same input that callers already supply"
  - "handleHeatmapToggle lockout guard placed before runnerFromSnapshot and before seat validation, ensuring visible=false is also blocked under lockout"
  - "mergeTransientState hasTransient includes (adapters.teachingDisabled ?? false) so a lockout-only session with no other transient state still broadcasts the flag"
  - "state.teachingDisabled injected unconditionally (true or false) in mergeTransientState, mirroring the GameSession pattern from 111-01"
  - "demoStart throws (not returns errorResult) to match handleOp's existing throw pattern; bridge.ts catch block converts it to {success:false, error}"
metrics:
  duration: "5 minutes"
  completed: "2026-06-30"
  tasks_completed: 2
  files_modified: 6
---

# Phase 111 Plan 02: Host-Gated Teaching Lockout — Dev-Host Enforcement Layer Summary

**One-liner:** `teachingDisabled` threaded through gameOptions into three pure executeOp guards (hint/heatmapToggle/startTutorial) and through SnapshotSessionHost adapters into the demoStart guard and unconditional broadcast injection, with bridge.ts wiring completing the dev-host stack.

## What Was Built

### Task 1: Guard hint/heatmapToggle/startTutorial in the pure executeOp (commit `1686bdd`)

Three fail-loud guards added to `executeOp` in `stateless-ops.ts`:

- **`handleHint`** — guard at the top, before AI config check. Returns `errorResult('Teaching features are disabled for this session.', 'protocol')`.
- **`handleHeatmapToggle`** — guard at the top, before `runnerFromSnapshot` and before seat-range validation. Both `visible=true` and `visible=false` paths are blocked (teachingDisabled rejects the entire op, not just the MCTS path).
- **`startTutorial` case** — guard at the top of the switch case, before `def.tutorial` check.
- **`exitTutorial` case** — intentionally unguarded (D-06).

The guards read `gameOptions.teachingDisabled` from the open-bag input — no signature change needed. The same `gameOptions` bag that callers already supply is the vehicle.

**12 new tests** in `stateless-ops.test.ts` covering:
- Lockout (teachingDisabled:true) for hint, heatmapToggle visible=true, heatmapToggle visible=false, startTutorial
- exitTutorial succeeds under lockout (D-06)
- Open (teachingDisabled:absent) leaves hint + startTutorial functional
- Open (teachingDisabled:false) leaves hint + startTutorial functional

### Task 2: Guard demoStart + reflect teachingDisabled in SnapshotSessionHost + thread through bridge (commit `e9d69d9`)

**`SnapshotSessionAdapters`** — new `teachingDisabled?: boolean` field added alongside `aiSeats` and `persist`.

**`handleOp` demoStart branch** — guard throws `new Error('Teaching features are disabled for this session.')` before the `!this.demoRunning` check. Bridge.ts's existing `catch` block in `handleServerRequest` converts the throw to `{ success: false, error: message }`. demoStop is NOT guarded (stopping is always safe).

**`mergeTransientState`** — two changes:
1. Added `(this.adapters.teachingDisabled ?? false)` to the `hasTransient` condition so that a lockout-only session with no other transient state still enters the injection path (criterion 4 compliance).
2. Added `state.teachingDisabled = this.adapters.teachingDisabled ?? false` unconditionally for every seat view (both true and false emitted so reconnecting clients always read the authoritative value).

**`bridge.ts`** — `DevSessionOptions` gains `teachingDisabled?: boolean`; `createDevSession` passes `opts.teachingDisabled` into the `SnapshotSessionHost` adapters bag.

**5 new tests** in `snapshot-session-host.test.ts`:
- demoStart throws lockout error when adapters.teachingDisabled is true
- demoStop succeeds (unguarded) when teachingDisabled is true
- Broadcast carries state.teachingDisabled === true on every seat view
- Lockout-only session (no other transient state) still broadcasts the flag via broadcastCurrent (critical criterion 4 case)
- Broadcast carries state.teachingDisabled === false when adapter is absent

**2 new tests** in `bridge.test.ts`:
- demoStart via handleServerRequest returns success:false with lockout error when DevSessionOptions.teachingDisabled is set
- Broadcast views carry state.teachingDisabled === true when DevSessionOptions.teachingDisabled is set

## Verification

```
npm test -- src/session/stateless-ops.test.ts src/session/snapshot-session-host.test.ts src/cli/dev-host/bridge.test.ts
# 86 tests, all pass (40 + 34 + 12)
npx eslint src/session/stateless-ops.ts src/session/snapshot-session-host.ts src/cli/dev-host/bridge.ts
# clean
```

## Deviations from Plan

None — plan executed exactly as written.

## Threat Surface Scan

No new network endpoints or auth paths introduced. The three changes implement the mitigations specified in the plan's threat register:
- **T-111-04** (Tampering — executeOp handlers): mitigated by three fail-loud `errorResult` guards reading `gameOptions.teachingDisabled`.
- **T-111-05** (Tampering — SnapshotSessionHost.handleOp demoStart): mitigated by throw before `runDemoLoop` launch.
- **T-111-06** (Elevation of Privilege — dev-host client trusts local init): mitigated by unconditional `state.teachingDisabled` injection in `mergeTransientState`, making broadcast the authoritative source for every connected seat.

## Known Stubs

None.

## Self-Check: PASSED

- `src/session/stateless-ops.ts` — modified (contains `teachingDisabled` in handleHint, handleHeatmapToggle, startTutorial)
- `src/session/stateless-ops.test.ts` — modified (12 new tests)
- `src/session/snapshot-session-host.ts` — modified (contains `teachingDisabled` in adapters, handleOp, mergeTransientState)
- `src/session/snapshot-session-host.test.ts` — modified (5 new tests)
- `src/cli/dev-host/bridge.ts` — modified (contains `teachingDisabled` in DevSessionOptions + createDevSession)
- `src/cli/dev-host/bridge.test.ts` — modified (2 new tests)
- Commits: `1686bdd` (Task 1), `e9d69d9` (Task 2) — both confirmed in git log
