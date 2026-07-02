---
phase: 123-determinism-flow-introspection
plan: 04
subsystem: session
tags: [flow-introspection, devtools, dev-host, websocket, perspective-isolation]

# Dependency graph
requires:
  - phase: 123-determinism-flow-introspection (Plan 01)
    provides: "Game.getFlowDebugInfo() engine primitive (FlowDebugInfo with describe())"
provides:
  - "Serialized flow-debug snapshot + own-seat pendingAction on every session broadcast (GameSession AND SnapshotSessionHost — the dev host's actual host class)"
  - "window.__BOARDSMITH_DEVTOOLS.getFlowDebugInfo()/getPendingAction() dev-only window bridge getters"
  - "debug:flow-state WS op (dev-host debug:* op family) returning the same serialized structure"
  - "Visual DebugPanel readable flow-position line sourced from debug:flow-state"
  - "Shared serializeFlowDebugInfo() helper (src/session/utils.ts) so broadcast, debug op, and devtools never diverge in shape"
affects: [125-headless-simulation, 127-scriptable-dev-host]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Single shared serialization helper (serializeFlowDebugInfo) reused across GameSession.broadcast(), SnapshotSessionHost.mergeTransientState, and the debug:flow-state op handler — prevents divergent wire shapes"
    - "Per-seat pending-action injection uses effectivePosition/seat-scoped lookup only, never a loop that could leak another seat's args"

key-files:
  created:
    - src/session/utils.ts (serializeFlowDebugInfo helper, added in the gap-fix commit)
  modified:
    - src/session/game-session.ts
    - src/session/types.ts
    - src/session/game-session.test.ts
    - src/session/stateless-ops.ts
    - src/session/stateless-ops.test.ts
    - src/cli/dev-host/bridge.ts
    - src/ui/components/DebugPanel.vue
    - src/ui/components/GameShell.vue
    - src/ui/components/GameShell.devtools.ts
    - src/ui/components/GameShell.devtools.test.ts
    - src/ui/global.d.ts
    - src/cli/dev-host/DevHost.vue

key-decisions:
  - "flowDebugInfo is public flow structure (accepted disclosure, T-123-08) and broadcast to all seats/spectators; pendingAction is strictly per-seat (mitigated disclosure, T-123-07/T-123-10), proven by a dedicated multi-seat leak test on both GameSession and SnapshotSessionHost"
  - "Gap-fix (ac1261e): browser verification revealed boardsmith dev runs on SnapshotSessionHost, not GameSession — Task 1's broadcast injection only covered GameSession, so the dev host (the primary agent-facing surface) carried no flowDebugInfo/pendingAction at all until the fix. Extracted serializeFlowDebugInfo() as a shared helper so GameSession, stateless-ops' stateEnvelope(), and the debug:flow-state op cannot diverge in shape again"
  - "DebugPanel's readable flow-position line renders inside the existing flow-context box (not a new box) to keep the panel visually consistent with debug:action-traces output"

patterns-established:
  - "When a dev-host feature is verified only against GameSession, explicitly check whether SnapshotSessionHost (the actual `boardsmith dev` host class) needs the same wiring before calling a broadcast-shape change complete"

requirements-completed: [FLOW-01, FLOW-03]

# Metrics
duration: ~55min
completed: 2026-07-01
---

# Phase 123 Plan 04: Browser Introspection Parity Summary

**Session broadcasts (GameSession AND the dev host's SnapshotSessionHost) now carry a serialized flow-debug snapshot and each seat's own pending-action, surfaced via both `window.__BOARDSMITH_DEVTOOLS` getters and a new `debug:flow-state` WS op rendered in the visual DebugPanel — browser-verified against go-fish.**

## Performance

- **Duration:** ~55 min (Tasks 1-3 + gap-fix + checkpoint resolution)
- **Tasks:** 4 (3 auto + 1 checkpoint), plus 1 gap-fix commit discovered during checkpoint verification
- **Files modified:** 12

## Accomplishments

- `PlayerGameState` gained `flowDebugInfo?`/`pendingAction?`; a new shared `SerializedFlowDebugInfo` plain-object type is the single wire shape reused across the broadcast, the debug op, and the devtools payload (no divergent copies)
- `GameSession.broadcast()` injects flow-debug (public, all seats) and pending-action (own-seat only, via `effectivePosition`) — proven by a multi-seat perspective-isolation test
- The `__BOARDSMITH_DEVTOOLS` window bridge exposes `getFlowDebugInfo()`/`getPendingAction()`, dev-guarded end-to-end (isDevBuild / `import.meta.env.DEV`)
- A new `debug:flow-state` WS op (dev-host `debug:*` family) returns the same serialized structure plus the requesting seat's own pending action; the visual `DebugPanel` renders the readable `description` string in its existing flow-context box
- **Gap found and fixed during Task 4 browser verification:** `boardsmith dev` actually runs on `SnapshotSessionHost`, not `GameSession` — Task 1's injection only reached `GameSession.broadcast()`, so the dev host (the primary agent-facing surface this whole plan targets) never carried the new fields. Fixed by extracting a shared `serializeFlowDebugInfo()` helper (`src/session/utils.ts`), having `stateEnvelope()` in `stateless-ops.ts` compute it once per op (mirroring GameSession's "compute once, reuse across seats" pattern), routing `handleStart`/`handleAction`/`handleAiTurn` through the shared envelope, and having `SnapshotSessionHost.mergeTransientState` merge `lastFlowDebugInfo` + each seat's own `pendingAction` (looked up strictly by seat index) into every broadcast view, including re-broadcasts via `broadcastCurrent()` that have no fresh `executeOp` result.

## Task Commits

Each task was committed atomically:

1. **Task 1: Broadcast serialized flow-debug + own-seat pending-action (perspective-safe)** - `0d909e7` (feat, tdd)
2. **Task 2: Wire flow-debug + pending-action through the devtools bridge (client)** - `7122cf7` (feat)
3. **Task 3: Add debug:flow-state WS op + surface readable flow position in the visual DebugPanel** - `248ac2d` (feat)
4. **Gap-fix: wire flowDebugInfo/pendingAction into SnapshotSessionHost (dev-host parity)** - `ac1261e` (fix) — discovered during Task 4 checkpoint verification, applied under Rule 1 (auto-fix bug: the dev host's actual host class was never wired)
5. **Task 4: Browser-verify devtools + DebugPanel flow/pending-action parity** - checkpoint, resolved: approved with one documented known issue (see below)

**Plan metadata:** (this commit) `docs(123-04): complete plan`

## Files Created/Modified

- `src/session/types.ts` - `SerializedFlowDebugInfo` type; `PlayerGameState.flowDebugInfo?`/`pendingAction?`
- `src/session/game-session.ts` - broadcast() injects flow-debug (all seats) + own-seat pendingAction
- `src/session/game-session.test.ts` - multi-seat perspective-isolation test (seat 2 never sees seat 1's args)
- `src/session/utils.ts` - `serializeFlowDebugInfo()` shared helper (added in gap-fix)
- `src/session/stateless-ops.ts` - `debugFlowState` Op + handler + dispatch case; `stateEnvelope()` now computes flowDebugInfo once and every state-mutating handler spreads it
- `src/session/stateless-ops.test.ts` - debugFlowState description/out-of-range/perspective-scoped tests
- `src/cli/dev-host/bridge.ts` - `debug:flow-state` WireOp + translateOp + shapeResult cases
- `src/ui/components/DebugPanel.vue` - `fetchFlowState()` + readable flow-position line in the flow-context box
- `src/ui/components/GameShell.devtools.ts` / `.test.ts` - flowDebugInfo/pendingAction additive fields
- `src/ui/components/GameShell.vue` - forwards the two fields from received broadcast state into the devtools payload
- `src/ui/global.d.ts` - `getFlowDebugInfo`/`getPendingAction` on `BoardsmithDevtools`, `| null` convention
- `src/cli/dev-host/DevHost.vue` - two new window bridge getters inside `import.meta.env.DEV`

## Decisions Made

- flowDebugInfo is treated as public flow structure (T-123-08, accepted) and broadcast unconditionally; pendingAction is strictly seat-scoped (T-123-07/T-123-10, mitigated) — enforced identically on both GameSession and SnapshotSessionHost after the gap-fix
- Extracted `serializeFlowDebugInfo()` as the single source of truth for the wire shape rather than letting GameSession, stateless-ops, and the debug op each build their own object — prevents future divergence
- DebugPanel's new "Flow position" line lives in the existing flow-context box rather than a new UI element, keeping the panel visually consistent with the existing `debug:action-traces` display

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] SnapshotSessionHost (the actual `boardsmith dev` host class) never carried flowDebugInfo/pendingAction**
- **Found during:** Task 4 (browser checkpoint verification)
- **Issue:** Task 1 only wired the broadcast injection into `GameSession.broadcast()`. `boardsmith dev` runs on `SnapshotSessionHost`, a separate host implementation, which never received the new fields — so the primary agent-facing dev-host surface this plan targets was non-functional despite all unit tests passing.
- **Fix:** Extracted `serializeFlowDebugInfo()` into `src/session/utils.ts`; `stateEnvelope()` in `stateless-ops.ts` now computes it once per op and `handleStart`/`handleAction`/`handleAiTurn` spread it; `SnapshotSessionHost` tracks `lastFlowDebugInfo` and merges it plus each seat's own `pendingAction` (strict per-seat lookup) into every broadcast view in `mergeTransientState`, including `broadcastCurrent()` re-broadcasts.
- **Files modified:** src/session/utils.ts (new), src/session/stateless-ops.ts, and the dev-host session-host files touched by ac1261e
- **Verification:** Re-verified live in the browser — `window.__BOARDSMITH_DEVTOOLS.getFlowDebugInfo()` returned a correct, matching snapshot; 4 new dev-host parity unit tests added (non-empty description on every seat, seat-2-never-sees-seat-1's-pendingAction, undefined not error when no pending action, survives `broadcastCurrent()` re-broadcasts). Full suite green (1909 tests), tsc clean on touched files.
- **Committed in:** ac1261e

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Necessary for correctness — without it, the plan's stated purpose ("agent/developer can read... from the dev host bridge... without a Node terminal") would have been unmet for the actual dev-host entry point. No scope creep beyond the fix itself.

## Issues Encountered

**Checkpoint (Task 4) initial FAIL, then PASS after gap-fix:**
- First browser verification pass FAILED: the dev host's window bridge getters returned no flow-debug/pending-action data (root cause: SnapshotSessionHost gap above, fixed in ac1261e).
- Re-verified in browser after the fix: `window.__BOARDSMITH_DEVTOOLS.getFlowDebugInfo()` returned `{step:"sequence", path:[1,1,3,1,2,0], awaiting:{currentPlayer:1}, description:"step *sequence*, waiting on seat 1"}` — correct and matching visible game state. Getters return `null` (not errors) when no data applies, as required.
- Per-seat `pendingAction` isolation is proven by the 4 new dev-host parity unit tests in `src/session/snapshot-session-host.test.ts`, covering the exact broadcast path that was browser-verified.

**KNOWN ISSUE (pre-existing, not caused by this plan):** The Dev-header "Debug" toggle does not visibly open the `DebugPanel` inside the GameShell iframe, so the panel's new "Flow position" readable-description line could not be visually confirmed in the browser (its data path — the `debug:flow-state` op — is covered by unit tests in `stateless-ops.test.ts`, and the window-bridge channel was confirmed live). Wiring was traced: `DevHost.vue`'s `toggleDebug` postMessage → a `GameShell.vue` handler that predates this plan; the gap is in the panel's visibility, not in anything Plan 04 changed. Also observed during the same verification session (pre-existing, non-blocking): a stale seat claim persists across dev-server restarts, blocking seat switching, and the in-iframe lobby's "Create Game" control does not advance in some flows. All three are filed as a tracked pending todo: `.planning/todos/pending/dev-host-debug-toggle-panel-not-opening.md`.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- FLOW-01/FLOW-03 introspection parity is complete via both locked channels (window bridge + debug:* op family), browser-verified against go-fish, and now correctly reaches the actual dev-host host class used by `boardsmith dev`.
- Phase 123 (all 4 plans) is now complete: determinism (FLOW-04, prior plans) + flow/pending-action introspection (FLOW-01/03, this plan) are both shipped and browser-proven.
- One low-severity pre-existing dev-host UI issue (Debug toggle visibility) tracked as a todo for future cleanup — does not block Phase 125 (headless simulation), which consumes the determinism guarantee, not the DebugPanel UI.

---
*Phase: 123-determinism-flow-introspection*
*Completed: 2026-07-01*

## Self-Check: PASSED

- FOUND: commit 0d909e7
- FOUND: commit 7122cf7
- FOUND: commit 248ac2d
- FOUND: commit ac1261e
- FOUND: src/session/utils.ts
- FOUND: .planning/todos/pending/dev-host-debug-toggle-panel-not-opening.md
