---
phase: 127-scriptable-dev-host
plan: 02
subsystem: client
tags: [websocket, node, client-sdk, testing, vitest]

# Dependency graph
requires:
  - phase: 127-scriptable-dev-host (plan 01)
    provides: getState/getLobby/debugToggle/uiSwitch WS handlers on the dev-host bridge
provides:
  - Injectable WebSocket constructor (wsCtor) on GameConnection, resolved via a shared resolveWsCtor() helper
  - GameConnectionConfig.wsImplementation escape hatch for runtimes without a global WebSocket (Node <22.4)
  - Fail-loud actionable constructor guard naming both the Node >=22.4 requirement and the wsImplementation override
affects: [127-03 (Node-capable dev-host client), DRIVE requirements]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Injectable runtime-global resolution: config.override ?? globalThis.X, guarded fail-loud, extracted into a tiny shared helper (src/client/ws-ctor.ts) so multiple client SDKs share one guard message"

key-files:
  created:
    - src/client/game-connection.test.ts
    - src/client/ws-ctor.ts
  modified:
    - src/client/game-connection.ts
    - src/client/types.ts

key-decisions:
  - "package.json engines.node NOT bumped to >=22.4 — BoardSmith is browser-first; the fail-loud guard is the enforcement mechanism, not a blanket engines constraint that would over-constrain consumers who never touch GameConnection in Node"
  - "Extracted resolveWsCtor() into src/client/ws-ctor.ts (DRY, per plan's additional guidance) so 127-03's dev-host client can reuse the same injected-override-or-global resolution and guard message instead of duplicating/drifting"
  - "GameConnection's private #wsCtor field is resolved once in the constructor and reused for both `new` and all static OPEN/CONNECTING reads — single source of truth, no per-call re-resolution"

patterns-established:
  - "Fail-loud runtime-capability guards name both the platform requirement (Node >=22.4) and the override escape hatch (wsImplementation) in one message — never a bare ReferenceError"

requirements-completed: [DRIVE-02]

# Metrics
duration: 25min
completed: 2026-07-02
---

# Phase 127 Plan 02: Node-Capable GameConnection Summary

**GameConnection now constructs/connects in a Node process via an injectable WebSocket constructor (`config.wsImplementation ?? globalThis.WebSocket`), with a fail-loud guard when neither is available — production wire protocol unchanged.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-07-02T15:10:00Z
- **Completed:** 2026-07-02T15:35:00Z
- **Tasks:** 1 (plus one in-scope DRY refactor commit)
- **Files modified:** 4 (2 modified, 2 created)

## Accomplishments
- Routed all six browser-global `WebSocket` touch points in `game-connection.ts` (construction + five `OPEN`/`CONNECTING` static reads) through a single private `#wsCtor` field resolved once in the constructor
- Added `GameConnectionConfig.wsImplementation` as the documented override for runtimes lacking a global `WebSocket`
- Fail-loud constructor guard: throws an `Error` naming both "22.4" and "wsImplementation" when no implementation is resolvable — never a bare `ReferenceError`
- Extracted the resolution + guard logic into `src/client/ws-ctor.ts` (`resolveWsCtor`) so the upcoming 127-03 dev-host client can reuse it without duplicating the guard message
- Node-environment unit test (`game-connection.test.ts`, 3 tests): injected-`FakeWebSocket` construction/connect path, fail-loud message assertion (temporarily removing `globalThis.WebSocket`), and native-global resolution on this dev machine (Node 22.21)

## Task Commits

Each task was committed atomically:

1. **Task 1: Injectable wsCtor + fail-loud guard + config field** - `955ab53` (feat)
2. **DRY refactor: extract resolveWsCtor into shared src/client/ws-ctor.ts** - `53f80a1` (refactor)

**Plan metadata:** committed below (docs: complete plan)

## Files Created/Modified
- `src/client/game-connection.ts` - Private `#wsCtor` field resolved via `resolveWsCtor()`; `new WebSocket(wsUrl)` → `new this.#wsCtor(wsUrl)`; all five `WebSocket.OPEN`/`WebSocket.CONNECTING` static reads → `this.#wsCtor.OPEN`/`this.#wsCtor.CONNECTING`; constructor JSDoc `@remarks` documents the Node >=22.4 native path
- `src/client/types.ts` - `GameConnectionConfig.wsImplementation?: typeof WebSocket` with JSDoc
- `src/client/ws-ctor.ts` (new) - Shared `resolveWsCtor(wsImplementation, callerName)` helper: injected override ?? `globalThis.WebSocket`, fail-loud guard naming Node >=22.4 + the override escape hatch
- `src/client/game-connection.test.ts` (new) - Node-environment vitest suite: injected `FakeWebSocket` (minimal readyState/OPEN/CONNECTING/send/close/handler-slots fake), fail-loud path, native-global resolution

## Decisions Made
- **`engines.node` left at `>=20`** (not bumped to `>=22.4`) — per plan's explicit RESEARCH Pitfall 2 guidance: BoardSmith is browser-first, and forcing 22.4 on all consumers over-constrains the majority who never use `GameConnection` in Node. The fail-loud guard is the correctness enforcement; unaffected consumers are untouched. Documented in the constructor's `@remarks`.
- **Extracted `resolveWsCtor()` into `src/client/ws-ctor.ts`** rather than keeping the guard inline — the plan's additional guidance flagged that 127-03's dev-host client will need identical injected-implementation-or-global resolution; a tiny (20-line) shared helper avoids two guard messages drifting apart. Kept the helper Node/browser-runtime-only (no dependency on `GameConnectionConfig` or dev-host protocol types) so it stays reusable by both callers without coupling their config shapes.
- **`this.config` type changed to `Required<Omit<GameConnectionConfig, 'wsImplementation'>>`** rather than `Required<GameConnectionConfig>` — `wsImplementation` is resolved once into `#wsCtor` at construction time and never read again from `this.config`, so keeping it out of the `Required<>` field avoids a spurious "must always be present" type signal on a field that's legitimately optional-and-consumed-once.

## Deviations from Plan

None — plan executed as written, with one anticipated addition explicitly invited by the plan's "additional_guidance" (DRY extraction of the wsCtor resolution into a shared helper for 127-03's reuse), not scope creep.

## Issues Encountered

None. `npx tsc --noEmit` was run to confirm no new type errors were introduced by this change; the pre-existing unrelated errors across the repo (test-file looseness in `ai/`, `engine/`, `session/`, `ui/` — already tracked in STATE.md's deferred backlog) are untouched by this plan's files.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- 127-03 (Node-capable dev-host client) can import `resolveWsCtor` from `src/client/ws-ctor.ts` directly, reusing the same fail-loud guard message rather than duplicating it — per the scope fence, GameConnection itself is NOT reused (it speaks a different protocol), only the tiny WebSocket-resolution helper is shared.
- Full repo test suite (`npx vitest run`) confirmed green at 151 files / 2013 tests after this change — no regressions.

---
*Phase: 127-scriptable-dev-host*
*Completed: 2026-07-02*

## Self-Check: PASSED

All created/modified files and both task commits verified present.
