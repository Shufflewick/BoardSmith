# Phase 126: Structured Error Surfacing - Context

**Gathered:** 2026-07-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Failures at the pick-handler, action-runner, storage, and dev-host layers surface as structured, inspectable signals instead of console-only silent fallbacks. Covers ERR-01 (structured warnings for boardRefs/display/getChoices failures), ERR-02 (structured errorCode on runner failures), ERR-03 (observable storage save failures), ERR-04 (dev-host `debug:logs` WS op).

Scope: `src/session/` (pick-handler.ts, game-session.ts storage paths, stateless-ops), `src/runtime/runner.ts`, `src/cli/dev-host/` (log capture + WS op), `src/types/protocol.ts` (ErrorCode reuse/extension).

</domain>

<decisions>
## Implementation Decisions

### Structured Warnings & Error Codes (ERR-01/02)
- Pick/op results carry `warnings: [{code, message, source}]` with stable code values; gameplay still degrades gracefully but the degradation is VISIBLE to the caller; console.error kept as a dev-side echo
- All three console-only sites covered: `boardRefs()`, `display()`, `getChoices()` evaluation errors — warnings attached where they occur (per-choice/selection where relevant)
- Runner failures reuse/extend the existing `ErrorCode` enum from `src/types/protocol.ts` (one enum, wire-compatible); classification happens at the catch site (validation vs action-not-available vs engine-crash)

### Storage Save Observability (ERR-03)
- Saves stay async (no gameplay latency); failures observable via an `onPersistenceError` hook + queryable persistence status (`lastPersistenceError`) on the session
- Repeated failures escalate loudly: persistence status flips unhealthy; dev host logs it via the ERR-04 channel

### Dev-Host Log Streaming (ERR-04)
- Ring buffer + `debug:logs` pull op (consistent with the existing `debug:*` family)
- Captured: server-side errors/warnings routed through a capture hook (session errors, persistence failures, structured warnings) with timestamps + severity
- Dev host only (production hosts own their logging)

### Claude's Discretion
- Warning code taxonomy, ring buffer size, exact hook names — follow existing conventions (ErrorCode enum style, debug:* op patterns from Phase 123's debug:flow-state)

</decisions>

<code_context>
## Existing Code Insights

(From the verified 2026-07-01 audit + Phases 123-125 work.)

### Known console-only failure sites (verified)
- src/session/pick-handler.ts:235 — `console.error('boardRefs() error (ignored):', e)`; display() fallback ~360; getChoices() eval errors returned in error response but per-choice display errors silent (~204-291)
- src/session/game-session.ts — storage `.save().catch(err => console.error(...))` fire-and-forget (multiple sites; audit cited ~704-706, now shifted)
- src/runtime/runner.ts:172-176 — catch flattens to `error.message` string, no errorCode (upstream ops DO have codes)

### Reusable Assets
- `ErrorCode` enum — src/types/protocol.ts:44-77 (INVALID_PLAYER, NOT_YOUR_TURN, ACTION_NOT_FOUND, ACTION_NOT_AVAILABLE, ...)
- `debug:flow-state` op (Phase 123) — the exact pattern for adding `debug:logs`: Op union + READ_ONLY_OP_TYPES + handler in stateless-ops.ts, WireOp + translateOp + shapeResult in bridge.ts
- SnapshotSessionHost mergeTransientState injection point (Phase 123) — where dev-host-side signals join broadcasts if needed
- OpResult shape in stateless-ops.ts (where `warnings` would ride)

### Established Patterns
- Structured error results with `success:false, error, errorCode` on op paths
- debug:* ops are dev-only, read-only ops

### Integration Points
- pick-handler.ts → OpResult/pick metadata types (session/types.ts)
- runner.ts ActionResult type (runtime)
- GameSession + SnapshotSessionHost storage paths (both hosts need ERR-03 observability — remember the Phase 123 lesson: the dev host uses SnapshotSessionHost, wire BOTH)
- multiplayer-host.ts / bridge.ts / stateless-ops.ts for debug:logs

</code_context>

<specifics>
## Specific Ideas

- Phase 123 lesson to honor: ANY session-layer surface must be wired in BOTH GameSession and SnapshotSessionHost (dev host parity) — the checker/review will look for this
- Warning codes should be greppable and stable, e.g. `BOARD_REFS_ERROR`, `DISPLAY_ERROR`, `CHOICES_ERROR`, `PERSISTENCE_ERROR`
- An agent driving the dev host should be able to: perform an op → see `warnings` in the result; poll `debug:logs` → see captured server-side errors with severity + timestamp

</specifics>

<deferred>
## Deferred Ideas

- Production log aggregation/transport — host responsibility, out of scope
- HTTP /api/logs endpoint — v2 (TOOL-02)

</deferred>
