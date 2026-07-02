---
phase: 127-scriptable-dev-host
plan: 01
subsystem: dev-tooling
tags: [websocket, vue, dev-host, cli, testing]

# Dependency graph
requires:
  - phase: 126-structured-error-surfacing
    provides: dev-host WS surface stability (ERR ops landed first so DRIVE-added ops report failures structurally from day one)
provides:
  - "getState WS op: returns the caller's own seat view (session.viewForSeat + meta), correlated by requestId, full guard chain (phase-not-playing -> seat-not-found)"
  - "getLobby WS op: returns lobbyMessage() payload in any phase (including pre-join lobby), correlated by requestId"
  - "debugToggle/uiSwitch WS ops: host-level relay-only fan-out to all connected clients; DevHost.vue drives its existing toggleDebug()/onUiSelect() functions"
affects: [127-scriptable-dev-host (remaining plans), 128-animation-test-story, 129-cross-repo-migration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "requestId echo on synchronous query ops (getState/getLobby) without a requestOrigin map -- unlike server_request, the reply always goes to the same asker"
    - "Broadcast-to-all-connected fan-out for relay ops with no single canonical target (debugToggle/uiSwitch), mirroring broadcastLobby's for-loop"
    - "WS message -> page reacts locally with zero bridge.ts involvement (the 'follow' precedent), extended to debugToggle/uiSwitch"

key-files:
  created:
    - src/cli/dev-host/DevHost.debug-relay.test.ts
  modified:
    - src/cli/dev-host/multiplayer-host.ts
    - src/cli/dev-host/multiplayer-host.test.ts
    - src/cli/dev-host/DevHost.vue

key-decisions:
  - "getState/getLobby reuse the existing 'game_state'/'lobby' HostOutbound shapes (plus an optional requestId field) rather than inventing new response type names, so getState is provably equal to the game_state broadcast"
  - "getState resolves seat ONLY from server-tracked followerClientId/clientSeat -- there is no client-supplied seat field on the variant at all, closing the cross-seat hidden-info leak vector by construction (T-127-01)"
  - "debugToggle/uiSwitch are host-level ClientInbound/HostOutbound variants, NOT bridge.ts WireOp entries -- relay-only, no game-state mutation, no DOM reconstruction host-side (T-127-02)"

patterns-established:
  - "Query ops that answer synchronously to the asker echo requestId directly; only server_request (which may be answered on behalf of a followed seat) needs the requestOrigin map"

requirements-completed: [DRIVE-01, DRIVE-03]

# Metrics
duration: 25min
completed: 2026-07-02
---

# Phase 127 Plan 01: Scriptable Dev Host — getState/getLobby/debugToggle/uiSwitch Summary

**Added four host-level WS ops (getState, getLobby, debugToggle, uiSwitch) to MultiplayerHost with zero new dependencies and zero bridge.ts involvement — closing the last browser-only dev-host gaps for scripted/agent-driven testing.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-07-02T10:14:00Z
- **Completed:** 2026-07-02T10:20:00Z
- **Tasks:** 3
- **Files modified:** 3 (+ 1 created)

## Accomplishments
- `getState` returns the caller's own seat view (never another seat's), correlated by requestId, guarded by the exact same phase-not-playing/seat-not-found chain as `handleServerRequest`
- `getLobby` works in every phase including the pre-join lobby, correlated by requestId
- `debugToggle`/`uiSwitch` fan out host-side to every connected client; `DevHost.vue` reacts by calling its existing `toggleDebug()`/`onUiSelect()` — no parallel logic
- 12 new unit tests (multiplayer-host.test.ts) + 2 new jsdom component tests (DevHost.debug-relay.test.ts) — full suite 150 files / 2010 tests green

## Task Commits

Each task was committed atomically:

1. **Task 1+2: getState/getLobby/debugToggle/uiSwitch host ops** - `d43359c` (feat) — implemented together since both add to the same `ClientInbound`/`HostOutbound` unions and `handleMessage` switch in the same file; separating the diff into two commits would have required an artificial partial-union intermediate state that itself wouldn't type-check.
2. **Fix: narrow lobbyMessage() spread** - `3c8d215` (fix) — caught by `tsc --noEmit`, not by vitest (see Deviations).
3. **Task 3: DevHost.vue relay cases + component test** - `f4ee2d6` (feat)

## Files Created/Modified
- `src/cli/dev-host/multiplayer-host.ts` - `getState`/`getLobby`/`debugToggle`/`uiSwitch` ClientInbound/HostOutbound variants + `handleGetState`/`handleGetLobby`/`handleDebugToggle`/`handleUiSwitch` handlers, wired into `handleMessage`
- `src/cli/dev-host/multiplayer-host.test.ts` - 12 new unit tests covering all five required behaviors (getState own-seat view, getState errors pre-start and unseated, getState ignores client-supplied seat, getLobby any-phase, debugToggle/uiSwitch fan-out, no state mutation)
- `src/cli/dev-host/DevHost.vue` - `onHostMessage` gains `case 'debugToggle'`/`case 'uiSwitch'` mirroring the existing `case 'follow'`
- `src/cli/dev-host/DevHost.debug-relay.test.ts` (new) - jsdom component test reusing `DevHost.restart.test.ts`'s `FakeWebSocket` harness, spies on the iframe's `contentWindow.postMessage` to prove `dev-debug-toggle`/`dev-ui-select` postMessages fire

## Decisions Made
- Combined Task 1 and Task 2 into a single commit (`d43359c`) because both add members to the SAME `ClientInbound`/`HostOutbound` discriminated unions and the same `handleMessage` switch statement in the same file — an intermediate commit with only half the union members would not compile. Documented as a deviation below (process, not scope).
- Kept `getState`/`getLobby` in the exact `game_state`/`lobby` response shapes (plus optional `requestId`) per the plan's explicit "do not invent a new response type name" instruction, so a scripted client's `getState` result is provably identical to what a browser client receives via broadcast.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed a tsc type error from spreading a union-typed lobbyMessage()**
- **Found during:** Task 1/2 verification (`npx tsc --noEmit`, run proactively per CLAUDE.md testing discipline — not required by the plan's `<verify>` block, which only specified vitest)
- **Issue:** `{ ...this.lobbyMessage(), requestId: ... }` widened the object literal to a union tsc could no longer narrow back to `HostOutbound`, because `lobbyMessage()`'s return type is the full `HostOutbound` union, not just the `'lobby'` member.
- **Fix:** Cast `this.lobbyMessage()` to `Extract<HostOutbound, { type: 'lobby' }>` before spreading.
- **Files modified:** `src/cli/dev-host/multiplayer-host.ts`
- **Verification:** `npx tsc --noEmit` shows zero errors in `multiplayer-host.ts`/`DevHost.vue`; full vitest suite still green (2010/2010).
- **Committed in:** `3c8d215`

### Process Deviation (not a code deviation)

**Task 1 and Task 2 committed together, not separately.** Both tasks modify the identical `ClientInbound`/`HostOutbound` union declarations and the identical `handleMessage` switch statement in `multiplayer-host.ts`. Splitting the diff into two sequential commits (one per plan task) would have required committing a `HostOutbound`/`ClientInbound` union with only `getState`/`getLobby` added and a placeholder gap for `debugToggle`/`uiSwitch`, then a second commit adding the rest — but the plan's Task 1 acceptance criteria explicitly require `npx vitest run multiplayer-host.test.ts` fully green as a gate, and the two features share the exact same edit locations, making a clean split impractical without churn. Both tasks' behaviors and acceptance criteria are fully met; only the commit granularity differs from the plan's one-task-one-commit default.

---

**Total deviations:** 1 auto-fixed (1 Rule 1 bug) + 1 process note (commit granularity)
**Impact on plan:** The tsc fix was necessary for correctness (a real type-safety hole). The commit-granularity note reflects the underlying two tasks sharing edit surface, not a scope change — all acceptance criteria for both tasks were independently verified.

## Issues Encountered
None beyond the tsc fix above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All four DRIVE-01/DRIVE-03 dev-host WS ops (`getState`, `getLobby`, `debugToggle`, `uiSwitch`) are shipped, tested, and verified not to touch `bridge.ts`'s `WireOp` machinery (`grep debugToggle\|uiSwitch bridge.ts` returns nothing).
- Full BoardSmith suite (150 files / 2010 tests) green after this plan.
- Remaining Phase 127 scope (per 127-PATTERNS.md): the Node-capable client SDK fix (`game-connection.ts` WebSocket injectability) and any dedicated dev-host protocol client helper are NOT part of this plan (127-01) — check ROADMAP.md/127-CONTEXT.md for whether they land in a subsequent 127-0N plan.
- No blockers.

---
*Phase: 127-scriptable-dev-host*
*Completed: 2026-07-02*

## Self-Check: PASSED
- FOUND: d43359c (getState/getLobby/debugToggle/uiSwitch dev-host ops)
- FOUND: 3c8d215 (fix: narrow lobbyMessage() spread)
- FOUND: f4ee2d6 (DevHost.vue relay cases + test)
- FOUND: src/cli/dev-host/DevHost.debug-relay.test.ts
- FOUND: .planning/phases/127-scriptable-dev-host/127-01-SUMMARY.md
