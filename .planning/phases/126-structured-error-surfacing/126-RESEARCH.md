# Phase 126: Structured Error Surfacing - Research

**Researched:** 2026-07-02
**Domain:** TypeScript library internals — session layer (pick resolution, action execution, persistence), dev-host WS protocol
**Confidence:** HIGH (all claims verified by direct file:line inspection of this repo; no external libraries involved)

## Summary

This phase closes four silent-failure gaps, all internal to BoardSmith's own `src/` — there is no external library research needed, only architectural investigation of the existing session/runtime/dev-host code. All four gaps were confirmed by direct code reading (not assumption):

1. **ERR-01** (`pick-handler.ts`): `boardRefs()` failures are truly silent (`console.error` + continue, no signal in the returned choice). `display()` failures are silently swallowed with a `catch {}` fallback (no logging at all — worse than boardRefs). `getChoices()` failures for the *overall* selection ARE already surfaced as a hard `success:false` op failure (not a warning) — this is arguably too strict (the whole pick becomes unusable instead of degrading), but the "structured" fix is to keep the existing hard-fail shape (`ErrorCode.CHOICES_EVALUATION_ERROR`/`ELEMENTS_EVALUATION_ERROR` already exist) and add a NEW soft-fail `warnings` channel for the per-choice/per-element failures (`boardRefs`, `display`) that currently silently degrade rather than fail the whole op.
2. **ERR-02** (`runner.ts`): Two paths in `GameRunner.performAction` return `{success:false, error}` with NO `errorCode`: the `continueFlow()` catch block (engine threw) and the `flowState.actionError` branch (engine returned a soft error). Both need a new `ErrorCode` value. `OpResult` (stateless-ops.ts) has NO `errorCode` field at all today — only `category: 'bundle'|'executor'|'protocol'`. `handleAction`/`handleSelectionStep`/`handleResolveChoices` all call `errorResult(x.error ?? '...')`, silently dropping any `errorCode` the underlying result already carries (e.g. `actionResult.errorCode` from the runner). This is the single biggest concrete fix: thread `errorCode` through `errorResult()` and `OpResult`.
3. **ERR-03** (storage): There are THREE distinct storage-failure code paths in `game-session.ts`, and they behave differently today — this inconsistency (not just "no signal") is the real finding:
   - Initial save (`GameSession.create`, ~line 704): fire-and-forget `.catch(err => console.error(...))` — silent, never reaches the caller.
   - Every other save (`#save()`, ~line 1974): `await this.#storage.save(...)` with **no catch at all** — an exception here propagates up and throws out of `performAction`/`broadcast` callers. When called from the synchronous action path (`performAction`, ~line 1294) this becomes an unhandled rejection reaching whoever calls the async `performAction`. When called from inside `#checkAITurn`'s try/catch (~line 2092), a storage failure is **misclassified as an AI failure** (counted against `#aiConsecutiveFailures`, logged as `[AI] Giving up...`) — a real, confirmed bug-adjacent finding, not a hypothesis.
   - `SnapshotSessionHost.apply()` (~line 197): `await this.adapters.persist?.(...)` also has no catch — a persist-adapter failure propagates through `handleOp()` up to `bridge.ts`'s generic `catch (err)` (line 320-327), which reports it to the client as an ordinary op failure (`{success:false, error: message}`), indistinguishable from a game-rule error.
   - **The dev host (`SnapshotSessionHost`/`multiplayer-host.ts`) currently has NO persistence at all wired up.** `persist` is an optional adapter on `SnapshotSessionAdapters`; grepping `src/cli/dev-host/` finds zero callers supplying it. `boardsmith dev` is fully in-memory (confirmed: no `storage`/`Storage`/`persist:` hits in `multiplayer-host.ts` or `dev.ts`). The only persistence-adjacent thing in the dev host is the browser's `localStorage` client-id (`DevHost.vue:29`), which is unrelated to game-state persistence. **This changes the ERR-03 "wire both hosts" requirement**: since `SnapshotSessionHost` has no active persistence today, the correct interpretation of "dev-host parity" is: (a) the `onPersistenceError`/`lastPersistenceError` API surface must exist symmetrically on both `GameSession` and `SnapshotSessionHost` so a future/optional `persist` adapter reports failures the same way, and (b) THE hook that fires when a real production `GameSession` storage failure happens must be capturable by the dev-host's new ring buffer (ERR-04) too, closing the classification bug at `bridge.ts`'s catch-all.
4. **ERR-04** (`debug:logs`): The `debug:flow-state` op (Phase 123) is the exact template: `Op` union entry (`stateless-ops.ts`) → `READ_ONLY_OP_TYPES` membership → handler function → `WireOp` union member (`bridge.ts`) → `translateOp` case → `shapeResult` case → client `debugRequest('debug:flow-state', {...})` call in `DebugPanel.vue`. `debug:logs` should follow this exact chain, EXCEPT it does not need a snapshot/game-state round trip — it is a pure read of an in-memory ring buffer that lives in the dev-host process (NOT in `stateless-ops.ts`'s pure `executeOp`, which has no persistent module state by design — see its own doc comment: "no module-level mutable state, no memory between calls"). This means `debug:logs` must be handled like `demo-start`/`demo-stop`: a **host lifecycle op**, resolved directly in `SnapshotSessionHost.handleOp` or in `bridge.ts`/`multiplayer-host.ts` itself — NOT routed through `executeOp`.

**Primary recommendation:** Add a `warnings: WarningEntry[]` array to `PickChoicesResponse`/`OpResult`/`ActionExecutionResult` (soft-fail signal, additive, never turns a success into a failure); add `errorCode` to `OpResult` and thread it from `ActionExecutionResult.errorCode` through every `errorResult()` call site; add two new `ErrorCode` values (`ENGINE_ERROR` for the `continueFlow` catch, `ACTION_EXECUTION_ERROR` for the `flowState.actionError` branch); build a single `onPersistenceError` callback + `lastPersistenceError` getter shared by both `GameSession` and `SnapshotSessionHost`, wrapping ALL THREE storage/persist call sites in both classes; add a `debug:logs` host-lifecycle op backed by a small ring-buffer module in `src/cli/dev-host/` that both the persistence-error hook and general dev-host `console.error` sites feed into via an explicit capture function (never monkey-patching global `console`).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| boardRefs/display/getChoices warnings (ERR-01) | API / Backend (session layer, `pick-handler.ts`) | — | Pure result-shaping; no I/O, no client-tier logic needed — warnings ride the existing wire response |
| Runner errorCode (ERR-02) | API / Backend (`runtime/runner.ts`, `session/stateless-ops.ts`) | — | Errors originate inside engine/flow execution, which lives entirely in the backend/runtime tier |
| Storage save observability (ERR-03) | API / Backend (`session/game-session.ts`, `session/snapshot-session-host.ts`) | Database / Storage (the `StorageAdapter`/`persist` implementations themselves) | The observability hook belongs with the caller of storage, not the storage implementation; the storage adapter itself is unaffected |
| Dev-host `debug:logs` (ERR-04) | Frontend Server / Dev-Host process (`src/cli/dev-host/`) | Browser / Client (`DebugPanel.vue` consumes it) | Ring buffer lives in the long-running Node dev-host process; the browser only polls it via the existing WS bridge |

## User Constraints

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Structured Warnings & Error Codes (ERR-01/02)**
- Pick/op results carry `warnings: [{code, message, source}]` with stable code values; gameplay still degrades gracefully but the degradation is VISIBLE to the caller; console.error kept as a dev-side echo
- All three console-only sites covered: `boardRefs()`, `display()`, `getChoices()` evaluation errors — warnings attached where they occur (per-choice/selection where relevant)
- Runner failures reuse/extend the existing `ErrorCode` enum from `src/types/protocol.ts` (one enum, wire-compatible); classification happens at the catch site (validation vs action-not-available vs engine-crash)

**Storage Save Observability (ERR-03)**
- Saves stay async (no gameplay latency); failures observable via an `onPersistenceError` hook + queryable persistence status (`lastPersistenceError`) on the session
- Repeated failures escalate loudly: persistence status flips unhealthy; dev host logs it via the ERR-04 channel

**Dev-Host Log Streaming (ERR-04)**
- Ring buffer + `debug:logs` pull op (consistent with the existing `debug:*` family)
- Captured: server-side errors/warnings routed through a capture hook (session errors, persistence failures, structured warnings) with timestamps + severity
- Dev host only (production hosts own their logging)

### Claude's Discretion
- Warning code taxonomy, ring buffer size, exact hook names — follow existing conventions (ErrorCode enum style, debug:* op patterns from Phase 123's debug:flow-state)

### Deferred Ideas (OUT OF SCOPE)
- Production log aggregation/transport — host responsibility, out of scope
- HTTP /api/logs endpoint — v2 (TOOL-02)
</user_constraints>

## Phase Requirements

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ERR-01 | `boardRefs()`/`display()`/`getChoices()` failures surface as structured warnings, not console-only fallbacks | Exact 3 sites located in `pick-handler.ts` (boardRefs ~line 235, display ~line 358-361, and `#buildValidElementsList`'s `boardRef` catch ~line 379) plus 3 `getChoices()` hard-fail sites (lines 203-207, 271-276, 286-291) — see Architecture Patterns + Code Examples |
| ERR-02 | Runner failures carry structured `errorCode` | Two gap sites identified in `runner.ts` `performAction` (continueFlow catch ~198-203, actionError branch ~206-212) + `OpResult` missing `errorCode` field entirely in `stateless-ops.ts` — see Code Examples |
| ERR-03 | Storage save failures observable, not fire-and-forget | 3 call sites in `game-session.ts` (create ~704, `#save()` ~1974, used by `#checkAITurn` ~2092) + 1 in `snapshot-session-host.ts` (`apply()` ~197) — see Summary + Common Pitfalls |
| ERR-04 | Dev-host `debug:logs` WS op | Exact `debug:flow-state` template chain identified across `stateless-ops.ts`/`bridge.ts`/`DebugPanel.vue`; ring buffer must live OUTSIDE `executeOp` (which is explicitly pure/stateless) — see Architecture Patterns |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **Pit of Success**: APIs must make the right (structured, observable) path the easy path — e.g. `warnings` should ride the existing response object automatically, not require callers to opt in.
- **No Backward Compatibility**: Clean break allowed — `ActionExecutionResult`/`OpResult`/`PickChoicesResponse` can be extended additively (new optional fields) without deprecation aliases, since this is purely additive (no removed fields).
- **Fail Fast and Loud**: Console-only silent fallbacks are exactly what this phase eliminates; do not introduce a NEW silent fallback while fixing the old ones (e.g. don't let `onPersistenceError` itself throw-and-swallow).
- **Never leak implementation details**: Warning/error messages must not leak stack traces or internal paths to players — `error instanceof Error ? error.message : String(error)` (the existing pattern in `errorResult()`) is the sanctioned shape; do not attach `error.stack`.
- **Dev-host parity (`useBoardInteraction`)**: Not directly applicable to this phase (no UI interaction change), but the "wire both hosts" discipline from Phase 123 (see Summary point 3) is the direct analog for session-layer surfaces.
- **Never leave a dev server running** — verification for ERR-04 requires running `boardsmith dev`; must be killed before returning.
- **Don't add dependencies without discussing** — this phase requires zero new npm packages (ring buffer is a capped in-memory array; no need for `lru-cache` or similar).

## Standard Stack

No external libraries apply — this phase is 100% internal `src/` code (TypeScript, existing project conventions only).

### Package Legitimacy Audit

**N/A — this phase installs no external packages.** All work is internal `src/session/`, `src/runtime/`, `src/types/`, `src/cli/dev-host/` changes. Skip the Package Legitimacy Gate entirely; no `npm install` step exists for this phase's plan.

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│ Pick/Action failure paths (ERR-01, ERR-02)                          │
│                                                                       │
│  PickHandler.getPickChoices()                                       │
│    ├─ getChoices() throws ───────► hard fail (existing, keep)       │
│    │                                 errorCode: CHOICES/ELEMENTS_    │
│    │                                 EVALUATION_ERROR                │
│    └─ per-choice loop:                                               │
│         boardRefs() throws ──┐                                       │
│         display() throws  ───┼──► NEW: push to choice.warnings[]     │
│         boardRef() throws  ──┘     (soft fail — choice still usable) │
│                                                                       │
│  GameRunner.performAction()                                          │
│    ├─ continueFlow() throws ──► NEW errorCode: ENGINE_ERROR          │
│    └─ flowState.actionError ──► NEW errorCode: ACTION_EXECUTION_ERROR│
│                                                                       │
│  stateless-ops.ts errorResult(error, category)                      │
│    └─ NEW: errorResult(error, category, errorCode?) threads code     │
│         through OpResult.errorCode (new field)                      │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ Storage observability (ERR-03)                                       │
│                                                                       │
│  GameSession                        SnapshotSessionHost              │
│   ├─ create(): storage.save()        ├─ apply(): persist?.()         │
│   ├─ #save(): storage.save()         │                                │
│   └─ #checkAITurn → #save()          │                                │
│         │                                    │                       │
│         ▼                                    ▼                       │
│   shared onPersistenceError(err) hook + lastPersistenceError getter  │
│         │                                                             │
│         ▼                                                             │
│   dev-host log-capture ring buffer (ERR-04) ◄── explicit capture call │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ debug:logs (ERR-04) — mirrors debug:flow-state's WS chain, but is a  │
│ HOST LIFECYCLE op (like demo-start/demo-stop), NOT routed through     │
│ the pure, memoryless executeOp() in stateless-ops.ts                │
│                                                                       │
│  DebugPanel.vue                                                     │
│    debugRequest('debug:logs', {}) ──► postMessage (server_request)   │
│         │                                                             │
│         ▼                                                             │
│  bridge.ts: WireOp 'debug:logs' → translateOp → { type:'debugLogs' } │
│         │                                                             │
│         ▼                                                             │
│  SnapshotSessionHost.handleOp() — handled directly (like demoStart), │
│  reads from log-capture ring buffer module, returns entries          │
│         │                                                             │
│         ▼                                                             │
│  bridge.ts shapeResult('debug:logs', ...) → { success, entries }      │
│         │                                                             │
│         ▼                                                             │
│  postServerResponse → DebugPanel.vue renders entries                  │
└─────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
src/
├── session/
│   ├── pick-handler.ts          # ERR-01: add warnings[] to choice/element building
│   ├── types.ts                 # ERR-01: add WarningEntry, warnings? field to PickChoicesResponse/PickMetadata's ChoiceWithRefs/ValidElement
│   ├── game-session.ts          # ERR-03: onPersistenceError hook, lastPersistenceError getter, wrap 3 save sites
│   ├── snapshot-session-host.ts # ERR-03: same hook shape, wrap persist?.() call; ERR-04: handle 'debugLogs' op directly
│   └── stateless-ops.ts         # ERR-02: OpResult.errorCode field, thread through errorResult() + handleAction/handleSelectionStep/handleResolveChoices
├── runtime/
│   └── runner.ts                # ERR-02: new errorCode values on continueFlow-catch and actionError branches
├── types/
│   └── protocol.ts              # ERR-02: add ENGINE_ERROR, ACTION_EXECUTION_ERROR to ErrorCode enum
├── cli/dev-host/
│   ├── log-capture.ts           # NEW: ring buffer module (ERR-04) — capture(severity, message, source) + getEntries()
│   ├── bridge.ts                # ERR-04: WireOp 'debug:logs', translateOp/shapeResult cases
│   └── multiplayer-host.ts      # ERR-04: wire log-capture into the dev-host process (persistence errors, uncaught session errors)
└── ui/components/
    └── DebugPanel.vue           # ERR-04: fetchLogs() following fetchFlowState()'s exact pattern; new Logs tab
```

### Pattern 1: Soft-fail warnings additive to existing success responses

**What:** Add an optional `warnings?: WarningEntry[]` array to response types. Never flip `success: true` to `false` because of a warning — warnings describe degraded-but-functional behavior (a choice is still selectable even if its `display()` fell back to a default label).

**When to use:** ERR-01's three per-choice/per-element sites (`boardRefs`, `display`, `boardRef`) where the CURRENT behavior already degrades gracefully (falls back to a default) — the only gap is visibility, not correctness.

**Example (illustrative, mirrors existing `pick-handler.ts:230-236` structure):**
```typescript
// Source: this repo, src/session/pick-handler.ts:227-237 (current code, annotated)
const choice: any = { value, display };

if (choiceSel.boardRefs) {
  try {
    const result = choiceSel.boardRefs(rawValue, ctx);
    choice.refs = result.refs;
  } catch (e) {
    // CURRENT: console.error('boardRefs() error (ignored):', e) — silent to caller
    // NEW: also push a structured warning the caller can inspect
    warnings.push({
      code: 'BOARD_REFS_ERROR',
      message: e instanceof Error ? e.message : String(e),
      source: `boardRefs(${JSON.stringify(rawValue)})`,
    });
    console.error('boardRefs() error (ignored):', e); // keep as dev-side echo (locked decision)
  }
}
```

### Pattern 2: errorCode threaded end-to-end, never re-inferred

**What:** `ErrorCode` is set exactly once, at the point the error is detected (existing convention documented in `protocol.ts`'s own JSDoc: "The error originates where it is detected and carries its own `ErrorCode` outward — never re-inferred from prose"). This phase's job is closing the TWO gaps where that promise is currently broken.

**When to use:** ERR-02's `runner.ts` `continueFlow()` catch and `flowState.actionError` branch, and `stateless-ops.ts`'s `errorResult()` calls that currently drop an already-computed `errorCode`.

**Example:**
```typescript
// Source: this repo, src/runtime/runner.ts:194-212 (current code, gap marked)
let flowState: FlowState;
try {
  flowState = this.game.continueFlow(actionName, args, playerIndex);
} catch (error) {
  return {
    success: false,
    error: error instanceof Error ? error.message : String(error),
    // GAP: no errorCode — caller cannot branch. Add errorCode: ErrorCode.ENGINE_ERROR
  };
}

if (flowState.actionError) {
  return {
    success: false,
    error: flowState.actionError,
    flowState,
    // GAP: no errorCode. Add errorCode: ErrorCode.ACTION_EXECUTION_ERROR
  };
}
```

```typescript
// Source: this repo, src/session/stateless-ops.ts:242-254 (current errorResult, gap marked)
function errorResult(error: unknown, category: OpResult['category'] = 'bundle'): OpResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    success: false,
    error: message,
    category,
    // GAP: no errorCode param/field — handleAction's
    //   `errorResult(actionResult.error ?? 'Action failed')` silently drops
    //   `actionResult.errorCode` that GameRunner.performAction already computed.
    snapshot: null,
    pendingState: null,
    flowState: null,
    playerViews: [],
    isComplete: false,
    winners: [],
  };
}
```

### Pattern 3: Shared persistence-error hook across both session hosts

**What:** A single small helper (e.g. `wrapPersist(fn, onError)` or a mixin-style private method duplicated in both classes — this codebase does not use mixins/shared base classes for `GameSession`/`SnapshotSessionHost`, so duplicate-but-identical private helpers is consistent with existing style, e.g. `serializeFlowDebugInfo` is a shared *function* imported by both, not a shared base class) that wraps a storage/persist call, catches, classifies as unhealthy after N consecutive failures, and calls an injectable `onPersistenceError` callback plus updates a `lastPersistenceError` field.

**When to use:** ERR-03 — apply identically to `GameSession`'s 3 save call sites and `SnapshotSessionHost.apply()`'s 1 persist call site.

**Example (illustrative shape, following the existing `#aiConsecutiveFailures` circuit-breaker pattern at `game-session.ts:2109`):**
```typescript
// Illustrative — follows the existing #aiConsecutiveFailures pattern in this file
#persistenceConsecutiveFailures = 0;
lastPersistenceError: { message: string; timestamp: number } | null = null;

async #persistSafely(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    this.#persistenceConsecutiveFailures = 0;
  } catch (error) {
    this.#persistenceConsecutiveFailures++;
    this.lastPersistenceError = {
      message: error instanceof Error ? error.message : String(error),
      timestamp: Date.now(),
    };
    this.#onPersistenceError?.(this.lastPersistenceError, this.#persistenceConsecutiveFailures);
    // never rethrow — persistence failures must not crash gameplay (locked decision:
    // "Saves stay async (no gameplay latency)")
  }
}
```

### Pattern 4: Host-lifecycle op for `debug:logs` (NOT routed through pure `executeOp`)

**What:** `executeOp` in `stateless-ops.ts` is explicitly documented as pure with "no module-level mutable state, no memory between calls." A ring buffer is memory between calls — it CANNOT live there. `debug:logs` must follow the `demoStart`/`demoStop` precedent: handled directly inside `SnapshotSessionHost.handleOp()` (or even more directly in `bridge.ts`/`multiplayer-host.ts`, since it needs no snapshot/game state at all — it is orthogonal to game state).

**When to use:** ERR-04's implementation — this is the single most important architectural decision for this phase; getting it wrong (e.g. adding `'debugLogs'` to the `Op` union routed through `executeOp`) would either fail to compile (no way to persist entries across pure calls) or silently reset the log buffer on every call.

```typescript
// Illustrative — mirrors bridge.ts's WireOp union + translateOp + shapeResult pattern
// for debug:flow-state (lines 47, 181-185, 261-267), but 'debug:logs' takes no
// snapshot/game-state round trip at all.
export type WireOp =
  | /* ...existing... */
  | 'debug:logs';

// translateOp: debug:logs needs NO Op entry at all if handled directly in
// SnapshotSessionHost/multiplayer-host — OR add a lightweight
// { type: 'debugLogs' } to Op that SnapshotSessionHost.handleOp intercepts
// BEFORE delegating to executeOp (same interception pattern used for
// demoStart/demoStop at snapshot-session-host.ts's handleOp entry).
```

### Anti-Patterns to Avoid

- **Monkey-patching global `console`**: Do NOT override `console.error`/`console.warn` globally to feed the ring buffer — this is explicitly warned against in the phase brief ("without patching global console (prefer explicit capture hooks)") and would break test isolation, silently affect unrelated console output, and violate the "explicit is better" pit-of-success principle. Use an explicit `logCapture.record(severity, message, source)` call at each site instead.
- **Flipping `success: false` for a soft-fail warning**: `boardRefs()`/`display()` failures already degrade gracefully (fallback ID/name shown). Turning these into `success: false` op failures would be a regression — the LOCKED decision is explicit: "gameplay still degrades gracefully but the degradation is VISIBLE."
- **Re-inferring errorCode from message strings**: `performAction`'s existing string-matching fallback (`game-session.ts:1270-1279`, `result.error?.includes('not available')`) is legacy debt already flagged in that method's own comment ("Only fall back to inferring from the message for errors that originate deeper in the engine's flow"). Do not extend this pattern for the NEW errorCode values this phase adds — set them at the source (`runner.ts`), not by string-matching downstream.
- **Persistence errors crashing the request**: `#save()`'s current lack of a catch means a storage failure throws out of `performAction`, an async method — if the caller doesn't await/catch it, this becomes an unhandled rejection that can crash a Node process. The locked decision requires persistence to stay non-blocking and non-crashing.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Ring buffer capacity management | A custom circular-buffer class with wraparound index math | A plain array with `push()` + `shift()` when `length > MAX` | The log volume here is tiny (dev-only, single process, human-readable entries) — a `push`/`shift` array is O(1) amortized and trivially testable; a circular buffer adds complexity with zero benefit at this scale |
| errorCode enum management | A second/parallel error-code type for "structured" runner errors | Extend the EXISTING `ErrorCode` enum in `protocol.ts` | The enum's own doc comment declares it "the single source of truth for error codes across all layers (runtime, session, server)" — a parallel enum would violate that and break the switch-exhaustiveness pattern shown in its own JSDoc example |
| Warning taxonomy | A generic `{type: string}` bag | A small closed set of stable string literal codes (`BOARD_REFS_ERROR`, `DISPLAY_ERROR`, `CHOICES_ERROR`, `PERSISTENCE_ERROR` — as already named in CONTEXT.md) | Stable, greppable codes are what makes warnings "inspectable" for agents; a loose bag defeats the purpose |

**Key insight:** This phase's job is almost entirely "plumb an existing signal through to where it's currently dropped" rather than building new subsystems. The one genuinely new piece of infrastructure is the dev-host log-capture ring buffer, and even that should stay as small as possible (an array + a capture function), matching the existing `debug:*` op family's minimalism.

## Common Pitfalls

### Pitfall 1: `errorCode` silently dropped at `errorResult()` call sites

**What goes wrong:** Even after adding `errorCode` to `OpResult`, if `handleAction`/`handleSelectionStep` keep calling `errorResult(actionResult.error ?? '...')` (1-arg form) without also passing `actionResult.errorCode`, the field will be `undefined` on every op result — the fix looks complete (type exists) but is functionally a no-op.
**Why it happens:** `errorResult()`'s signature takes `(error, category)` — adding a 3rd optional param is easy to forget to actually pass at each of the ~10+ call sites.
**How to avoid:** Grep every `errorResult(` call site after the change and verify any that wrap an `ActionExecutionResult`/`PickStepResult`/`PickChoicesResponse` with an existing `.errorCode` field pass it through explicitly.
**Warning signs:** A test asserts `result.errorCode === ErrorCode.NOT_YOUR_TURN` for a stateless op but it comes back `undefined`.

### Pitfall 2: Persistence errors misclassified as AI failures

**What goes wrong:** `#checkAITurn`'s try/catch (`game-session.ts:2073-2121`) wraps the call to `#save()` (line 2092) inside the AI-move callback. A storage outage during an AI turn increments `#aiConsecutiveFailures` and, after 3 failures, logs "`[AI] Giving up after 3 consecutive failures...`" — a misleading diagnosis that sends whoever reads the log hunting for an AI/MCTS bug that doesn't exist.
**Why it happens:** The AI failure circuit-breaker's try/catch is broader than "AI-only" failures — it also covers everything inside its callback, including the save.
**How to avoid:** Move `#save()` OUT of the AI-move callback's try/catch scope (or wrap it separately with the new `#persistSafely` helper BEFORE it can be caught by the AI-specific catch), so a persistence failure increments `#persistenceConsecutiveFailures` and calls `onPersistenceError`, not `#aiConsecutiveFailures`.
**Warning signs:** AI "giving up" log messages appear correlated with storage/disk issues rather than actual MCTS clone failures.

### Pitfall 3: `debug:logs` routed through the pure `executeOp`, silently losing state

**What goes wrong:** If a plan naively follows the `debug:flow-state` template literally (adding a `debugLogs` case inside `executeOp`'s switch in `stateless-ops.ts`), the ring buffer either can't be stored there (no module-level state allowed by design) or, if added anyway, breaks the documented purity contract other callers (e.g. `boardsmith simulate`, replay) rely on.
**Why it happens:** `debug:flow-state` is the given template, but it is a poor fit for `debug:logs` specifically because flow-state IS derivable from the snapshot (pure), while logs are NOT part of game state at all.
**How to avoid:** Treat `debug:logs` like `demoStart`/`demoStop` — a host-lifecycle op intercepted in `SnapshotSessionHost.handleOp()` before it would reach `executeOp`, or handled even earlier in `bridge.ts`/`multiplayer-host.ts` directly (it needs no game snapshot at all, unlike demo ops which do read/write host state).
**Warning signs:** `executeOp`'s own module-level "no memory between calls" doc comment becomes false; `boardsmith simulate` (which calls `executeOp` directly per Phase 125's research) unexpectedly accumulates or references log state.

### Pitfall 4: Warnings don't survive the postMessage/iframe bridge

**What goes wrong:** `bridge.ts`'s `shapeResult()` explicitly whitelists which `OpResult` fields get forwarded per wire op (e.g. `case 'action': return { success, error, followUp }` — NOT a full passthrough). If `warnings` is added to `OpResult`/`PickChoicesResponse` but `shapeResult`'s `'action'` case isn't updated to include it, the ActionPanel/GameShell will never see boardRefs/display warnings surfaced from an `action` op (only from `resolve_choices`, which does `return result as unknown as Record<string, unknown>` — a full passthrough).
**Why it happens:** `shapeResult` is a manual per-op allowlist, not a generic passthrough — this is a deliberate wire-shape discipline (see its own doc comment about mirroring the production DO), so any NEW result field must be explicitly added to every relevant `case`.
**How to avoid:** After adding `warnings` to `OpResult`, audit every `shapeResult()` case that can plausibly carry pick/action warnings (`'action'`, `'selection_step'`, `'resolve_choices'` at minimum) and add `warnings: result.warnings` to each.
**Warning signs:** A browser test shows `console.error` firing (dev-side echo works) but `ActionPanel` never renders a warning badge, even though `resolve_choices` warnings DO show up — the asymmetry is the tell.

### Pitfall 5: Production `GameSession` growing dev-host-only code

**What goes wrong:** It is tempting to have `GameSession.onPersistenceError` directly call into the dev-host log-capture ring buffer for convenience. This would import dev-host-only code (`src/cli/dev-host/log-capture.ts`) into the production session layer (`src/session/game-session.ts`), which ships to every game/production host, not just `boardsmith dev`.
**Why it happens:** `onPersistenceError` and the log-capture ring buffer are closely related conceptually, making direct coupling tempting.
**How to avoid:** `GameSession`/`SnapshotSessionHost` expose the `onPersistenceError` callback as an INJECTABLE hook (constructor option), with NO import of `src/cli/dev-host/*`. The dev host (`multiplayer-host.ts`/`bridge.ts`) is the one that SUPPLIES a callback which calls into its own local log-capture module — dependency direction stays dev-host → session, never the reverse.
**Warning signs:** `grep -rn "cli/dev-host" src/session/` returns any hit.

## Code Examples

### Existing `debug:flow-state` template (the exact chain to mirror structurally, not literally, for `debug:logs`)

```typescript
// Source: this repo, src/session/stateless-ops.ts:33-97 (Op union + READ_ONLY_OP_TYPES)
export type Op =
  | /* ... */
  | { type: 'debugFlowState'; player: number };

export const READ_ONLY_OP_TYPES: ReadonlySet<Op['type']> = new Set([
  /* ... */
  'debugFlowState',
]);
```

```typescript
// Source: this repo, src/cli/dev-host/bridge.ts:47, 181-185, 261-267 (WireOp + translateOp + shapeResult)
export type WireOp = /* ... */ | 'debug:flow-state';

// translateOp:
case 'debug:flow-state':
  return { type: 'debugFlowState', player: seat };

// shapeResult:
case 'debug:flow-state':
  return {
    success: result.success,
    error: result.error,
    flowDebugInfo: result.flowDebugInfo,
    pendingAction: result.pendingAction,
  };
```

```typescript
// Source: this repo, src/ui/components/DebugPanel.vue:1066-1077 (client fetch pattern)
async function fetchFlowState() {
  try {
    const data = await debugRequest('debug:flow-state', { player: props.playerSeat });
    if (!data.success) {
      flowStateInfo.value = null;
      return;
    }
    flowStateInfo.value = (data.flowDebugInfo as FlowStateInfo) ?? null;
  } catch {
    flowStateInfo.value = null;
  }
}
```

### Existing `SnapshotSessionHost` host-lifecycle op interception (the pattern `debug:logs` should follow, not `debug:flow-state`)

```typescript
// Source: this repo, src/session/snapshot-session-host.ts:208-220 (handleOp intercepting demoStart
// BEFORE any delegation to executeOp — the precedent for debug:logs)
async handleOp(seat: number, op: Op): Promise<OpResult> {
  if (op.type === 'demoStart') {
    if (this.adapters.teachingDisabled) {
      throw new Error('Teaching features are disabled for this session.');
    }
    if (!this.demoRunning) {
      // ... handled directly, never reaches executeOp
    }
  }
  // ... (debugLogs would be intercepted here identically, reading from a
  // ring buffer field on the host or an injected adapter, never touching
  // `snapshot`/`executeOp` at all)
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `console.error`-only signal for boardRefs/display/storage failures | Structured `warnings[]` / `errorCode` / `onPersistenceError` hook | This phase (126) | Agents and the ActionPanel can branch on failures programmatically instead of requiring a human to watch the terminal |
| Node terminal is the only place dev-host server errors are visible | `debug:logs` ring buffer pollable over WS | This phase (126) | Closes the last "must watch the terminal" gap identified by the 2026-07-01 agent-ergonomics audit |

**Deprecated/outdated:** None — this phase is purely additive (new optional fields, new op), consistent with the "no deprecation cycles" project rule but with nothing here that removes an existing API.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The dev host (`boardsmith dev` / `SnapshotSessionHost`) currently has ZERO active storage persistence wired (the `persist` adapter is unused) — based on a repo-wide grep for `persist:`/`storage`/`Storage` across `src/cli/dev-host/` returning no hits outside the type definition | Summary point 3, Architecture Patterns | If a persist adapter IS wired somewhere not found by grep (e.g. dynamically constructed), ERR-03's "both hosts" scope could be larger than described — planner should re-grep before finalizing task list |
| A2 | No test currently exercises the AI-turn-persistence-failure misclassification described in Pitfall 2 — this was traced by reading code, not by running a failing test | Common Pitfalls | If a hidden safeguard elsewhere already prevents this (e.g. a wrapper not found), the "fix" task may be redundant — verify by writing the reproducing test FIRST per project testing rules |

**If this table is empty:** N/A — see above.

## Open Questions (RESOLVED)

> Both open questions were resolved during planning:
> - Q1 (warnings shape): flat top-level `warnings` array on the response / OpResult, with `WarningEntry.source` disambiguating which choice/element (NOT nested per-choice) → implemented in Plan 126-03.
> - Q2 (ring buffer size): `MAX_LOG_ENTRIES = 300` with FIFO push/shift eviction → implemented in Plan 126-04.

1. **Should `warnings` be attached per-choice (nested in each `ChoiceWithRefs`/`ValidElement`) or as a single flat array on the response?** **[RESOLVED → 126-03: flat top-level array with `source` disambiguation]**
   - What we know: CONTEXT.md's locked decision says "warnings attached where they occur (per-choice/selection where relevant)" — implying per-choice attachment for `boardRefs`/`display`, but a flat top-level array is simpler for `getChoices()`-level and persistence-level warnings.
   - What's unclear: Whether ActionPanel/agent consumers need per-choice granularity or just "something is degraded, check the top-level array."
   - Recommendation: Use BOTH — a top-level `warnings: WarningEntry[]` array on `PickChoicesResponse`/`OpResult` (aggregated) for the simple "is anything degraded" check, with each `WarningEntry.source` identifying which choice/element it came from (e.g. `source: "boardRefs(choice #3)"`) rather than nesting warnings inside each choice object — this avoids widening `ChoiceWithRefs`/`ValidElement` (which are also consumed by the UI's choice-rendering code, unrelated to warnings) and keeps one place to look.

2. **What is the ring buffer's eviction/size policy?** **[RESOLVED → 126-04: MAX_LOG_ENTRIES = 300, FIFO]**
   - What we know: CONTEXT.md defers "ring buffer size" to Claude's discretion.
   - What's unclear: No existing precedent in this codebase for a capped in-memory log (checked: no `MAX_LOG_ENTRIES`-style constant exists anywhere in `src/`).
   - Recommendation: A fixed cap of 200-500 entries (dev-only, single session, human-scrollable) with FIFO eviction (`push` + `shift` when over cap) — small enough to never matter for memory, large enough to survive a normal debugging session. Plan should pick one number and document it as a named constant (mirroring `MAX_AI_MOVES = 500` and `MAX_DEMO_MOVES = 200` conventions already in `snapshot-session-host.ts`).

## Environment Availability

Skipped — this phase has no external tool/service dependencies. All work is internal `src/` TypeScript; verification runs `npm test` (vitest, already configured) and the existing `boardsmith dev` CLI (already built by this repo, not an external dependency).

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (`vitest run`) |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run src/session/pick-handler.test.ts src/session/stateless-ops.test.ts src/runtime/runner.test.ts` (adjust to actual touched test files) |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ERR-01 | `boardRefs()` throwing produces a `warnings` entry, choice still returned/selectable | unit | `npx vitest run -t "boardRefs"` | ❌ Wave 0 — no existing test for `pick-handler.ts`'s `boardRefs` catch; check `pick-handler.test.ts` if it exists |
| ERR-01 | `display()` throwing produces a `warnings` entry, falls back to default display | unit | `npx vitest run -t "display"` | ❌ Wave 0 |
| ERR-01 | `getChoices()` throwing still returns `success:false` with existing `errorCode` (regression guard — behavior unchanged) | unit | `npx vitest run -t "getChoices"` | Check existing coverage first |
| ERR-02 | `continueFlow()` throw returns `errorCode: ENGINE_ERROR` | unit | `npx vitest run src/runtime/runner.test.ts -t "continueFlow"` | Check `src/runtime/runner.test.ts` exists |
| ERR-02 | `flowState.actionError` returns `errorCode: ACTION_EXECUTION_ERROR` | unit | `npx vitest run src/runtime/runner.test.ts` | Check existing coverage |
| ERR-02 | `OpResult.errorCode` is populated for action/selectionStep/resolveChoices failures | unit | `npx vitest run src/session/stateless-ops.test.ts` | ✅ `src/session/stateless-ops.test.ts` exists |
| ERR-03 | Storage save failure calls `onPersistenceError` and sets `lastPersistenceError`, does not throw/crash | unit | `npx vitest run src/session/game-session.test.ts -t "persist"` | ❌ Wave 0 — no persistence-failure test found in a scan of `game-session.ts` test coverage |
| ERR-03 | AI-turn persistence failure does NOT increment `#aiConsecutiveFailures` (Pitfall 2 regression guard) | unit | `npx vitest run src/session/ai-circuit-breaker.test.ts` | Existing file `ai-circuit-breaker.test.ts` found — extend it, don't duplicate |
| ERR-03 | `SnapshotSessionHost.apply()` persist failure calls `onPersistenceError`, does not throw | unit | `npx vitest run src/session/snapshot-session-host.test.ts` | ✅ `src/session/snapshot-session-host.test.ts` exists |
| ERR-04 | `debug:logs` op returns captured entries with timestamp+severity | unit | `npx vitest run src/cli/dev-host/multiplayer-host.test.ts -t "debug:logs"` | ❌ Wave 0 — new op, no test yet |
| ERR-04 | `debug:logs` end-to-end via `bridge.ts` (`translateOp`/`shapeResult`) | unit | `npx vitest run src/cli/dev-host/bridge.test.ts` (create if absent) | Check whether `bridge.test.ts` exists |

### Sampling Rate

- **Per task commit:** targeted `npx vitest run <touched test files>`
- **Per wave merge:** `npm test` (full suite — 1873+ tests as of Phase 125)
- **Phase gate:** Full suite green before `/gsd:verify-work`, plus a manual `boardsmith dev` browser check of the new Logs tab in DebugPanel (kill the dev server before returning, per CLAUDE.md).

### Wave 0 Gaps

- [ ] `src/session/pick-handler.test.ts` — verify this file exists; if not, create it to cover boardRefs/display/getChoices warning behavior (currently these paths appear to have NO dedicated unit test file — confirm via `find src/session -iname "pick-handler.test.ts"` before planning tasks)
- [ ] A persistence-failure test fixture (fake `StorageAdapter`/`persist` adapter that rejects) — needed for both `game-session.test.ts` and `snapshot-session-host.test.ts` to exercise ERR-03 without real I/O
- [ ] `src/cli/dev-host/bridge.test.ts` — confirm existence; `debug:logs`'s `translateOp`/`shapeResult` cases need direct coverage the way `debug:flow-state` presumably already has (check `bridge.ts`'s existing test file before assuming a gap)

*(Run `find src -iname "pick-handler.test.ts" -o -iname "bridge.test.ts"` at plan time to convert these from suspected gaps to confirmed gaps — this research did not exhaustively enumerate every existing `.test.ts` file, only the storage/persistence ones explicitly grepped above.)*

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Not touched by this phase |
| V3 Session Management | No | Not touched by this phase |
| V4 Access Control | No | Warnings/errorCode/logs do not change who can act; `debug:logs` is dev-only (never shipped to production hosts) |
| V5 Input Validation | No | No new user input surfaces are added |
| V6 Cryptography | No | Not applicable |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Error/warning messages leaking internal paths or stack traces to players | Information Disclosure | Follow the EXISTING `errorResult()` pattern: `error instanceof Error ? error.message : String(error)` only — never attach `.stack`. Apply the same rule to the NEW `WarningEntry.message` field. |
| `debug:logs` accidentally shipping to a production/multiplayer host (not just `boardsmith dev`) | Information Disclosure | Keep the log-capture module and the `debug:logs` WireOp case confined to `src/cli/dev-host/` — never import it from `src/session/game-session.ts` (production path). This is Pitfall 5 above, re-framed as a security boundary, not just an architecture-cleanliness concern: dev-host logs could contain seat-specific hidden-info context (e.g. an engine error message referencing a hidden card's value) that must never reach a production client. |
| A seat's `debug:logs` request leaking ANOTHER seat's persistence/engine-error details containing hidden info | Information Disclosure | `debug:logs` is dev-only and single-process (no per-seat authorization model exists in `boardsmith dev` beyond `debug:flow-state`'s existing seat-scoping precedent for pendingAction) — but if any captured log message could embed hidden game state (e.g. an engine error including element values), the log entry itself is still visible to whichever seat requests it. Given the LOCKED scope is "dev host only," and the existing `debug:*` family (history, state-at, action-traces) already exposes full game internals to any connected dev-host seat without per-seat filtering, this is consistent with existing precedent — not a new hole. Document this as an explicit accepted-precedent note, not a new mitigation, so the planner doesn't over-engineer per-seat log filtering the rest of `debug:*` doesn't have either. |

## Sources

### Primary (HIGH confidence — direct code inspection, this repo)
- `src/session/pick-handler.ts` — full file read, silent-catch sites at lines 234-236, 358-361, 379
- `src/runtime/runner.ts` — full file read, `performAction` gaps at lines 196-212
- `src/types/protocol.ts` — full file read, `ErrorCode` enum lines 44-77
- `src/session/game-session.ts` — targeted reads, save/persist sites at lines 690-715, 1955-2043, 2063-2135
- `src/session/snapshot-session-host.ts` — lines 1-220, `persist` adapter definition (line 21) and `apply()` call site (line 197)
- `src/session/stateless-ops.ts` — full structural read, `Op`/`OpResult`/`errorResult`/`executeOp` (lines 1-260, 890-1120)
- `src/cli/dev-host/bridge.ts` — full file read, `WireOp`/`translateOp`/`shapeResult`/`createDevSession`
- `src/cli/dev-host/multiplayer-host.ts` — grepped for storage/persist (zero hits confirmed)
- `src/ui/components/DebugPanel.vue` — `fetchFlowState`/`fetchHistory`/`debugRequest` pattern (lines 1055-1130)
- `.planning/phases/126-structured-error-surfacing/126-CONTEXT.md`, `.planning/REQUIREMENTS.md`, `.planning/STATE.md`, `.planning/ROADMAP.md`

### Secondary (MEDIUM confidence)
- None — no external documentation was needed for this phase; all findings are direct repo inspection.

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: N/A — no external stack for this phase
- Architecture: HIGH — every claimed gap/site was located and read directly, not inferred
- Pitfalls: HIGH — Pitfall 2 (AI/persistence misclassification) and Pitfall 3 (executeOp purity) are structural facts confirmed by reading the actual try/catch scopes and the module's own doc comments, not speculation

**Research date:** 2026-07-02
**Valid until:** 30 days (stable internal codebase, no fast-moving external dependency)
