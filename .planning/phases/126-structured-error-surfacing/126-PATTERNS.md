# Phase 126: Structured Error Surfacing - Pattern Map

**Mapped:** 2026-07-02
**Files analyzed:** 8 (create: 1 new module + extend 7 existing)
**Analogs found:** 8 / 8 (all in-repo, no external analogs needed — this phase is internal plumbing)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|---------------|
| `src/types/protocol.ts` (extend `ErrorCode`) | model/enum | transform | same file, existing enum block | exact (self-extend) |
| `src/runtime/runner.ts` (`performAction`) | service | request-response | same file, existing `errorCode`-carrying branches (INVALID_PLAYER/NOT_AWAITING_INPUT/NOT_YOUR_TURN) | exact |
| `src/session/stateless-ops.ts` (`errorResult`, `OpResult`, `handleAction`/`handleSelectionStep`/`handleResolveChoices`) | service/transform | request-response | same file, `getChoices()` catch sites that already attach `errorCode` (pick-handler.ts) + existing `errorResult` callers | exact |
| `src/session/pick-handler.ts` (`boardRefs`/`display`/`boardRef` catches) | service | transform | same file, sibling `getChoices()` hard-fail catches (lines 202-207, 271-276, 286-291) | role-match (soft-fail sibling of existing hard-fail) |
| `src/session/game-session.ts` (`create()` save, `#save()`, `#checkAITurn`) | service | CRUD/event-driven | same file, `#aiConsecutiveFailures` circuit-breaker (lines 2109-2119) | exact (structural twin) |
| `src/session/snapshot-session-host.ts` (`apply()` persist call) | service | event-driven | same file, `demoStart`/`demoStop` host-lifecycle interception in `handleOp()` (lines 213-243) for the ERR-04 op; game-session.ts's new `#persistSafely` for ERR-03 | exact |
| `src/cli/dev-host/log-capture.ts` (NEW) | utility/store | event-driven | `snapshot-session-host.ts`'s `MAX_AI_MOVES`/`MAX_DEMO_MOVES` capped-loop constant convention | role-match (new file, no direct analog — first ring buffer in repo) |
| `src/cli/dev-host/bridge.ts` (`WireOp`, `translateOp`, `shapeResult` for `debug:logs`) | route/controller | request-response | same file, `debug:flow-state` case (lines 47, 181-185, 261-267) | exact |
| `src/ui/components/DebugPanel.vue` (`fetchLogs`, Logs tab) | component | request-response | same file, `fetchFlowState()` (lines 1066-1077) | exact |

## Pattern Assignments

### `src/types/protocol.ts` (model/enum, transform)

**Analog:** same file, `ErrorCode` enum (lines 44-77)

**Core pattern — flat string enum, grouped by concern, JSDoc example showing switch-on-errorCode usage:**
```typescript
// Source: src/types/protocol.ts:44-77
export enum ErrorCode {
  // Player/Turn errors
  INVALID_PLAYER = 'INVALID_PLAYER',
  NOT_YOUR_TURN = 'NOT_YOUR_TURN',
  // ...
  // Evaluation errors
  CHOICES_EVALUATION_ERROR = 'CHOICES_EVALUATION_ERROR',
  ELEMENTS_EVALUATION_ERROR = 'ELEMENTS_EVALUATION_ERROR',

  // Generic errors
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  REPLAY_FAILED = 'REPLAY_FAILED',
}
```
**Action for this phase:** add a new grouped comment block (e.g. `// Engine/execution errors`) with `ENGINE_ERROR = 'ENGINE_ERROR'` and `ACTION_EXECUTION_ERROR = 'ACTION_EXECUTION_ERROR'` — same flat string-literal style, no new type, single enum stays the "one source of truth across all layers" per its own doc comment (lines 21-23).

---

### `src/runtime/runner.ts` (service, request-response)

**Analog:** same file, `performAction()` (lines 154-220) — 3 of 5 return branches already carry `errorCode`, 2 don't (the gap this phase closes).

**Existing errorCode-carrying pattern to copy exactly (lines 163-189):**
```typescript
// Source: src/runtime/runner.ts:163-189
if (!playerObj) {
  return {
    success: false,
    error: `Player not found`,
    errorCode: ErrorCode.INVALID_PLAYER,
  };
}
// ...
if (!this.game.isAwaitingInput()) {
  return {
    success: false,
    error: 'Game is not awaiting input',
    errorCode: ErrorCode.NOT_AWAITING_INPUT,
  };
}
```

**Gap sites to fix (lines 196-212) — add `errorCode` using the SAME shape:**
```typescript
// Source: src/runtime/runner.ts:196-212 (current — no errorCode)
let flowState: FlowState;
try {
  flowState = this.game.continueFlow(actionName, args, playerIndex);
} catch (error) {
  return {
    success: false,
    error: error instanceof Error ? error.message : String(error),
    // ADD: errorCode: ErrorCode.ENGINE_ERROR,
  };
}

if (flowState.actionError) {
  return {
    success: false,
    error: flowState.actionError,
    flowState,
    // ADD: errorCode: ErrorCode.ACTION_EXECUTION_ERROR,
  };
}
```
`ActionExecutionResult.errorCode?: ErrorCode` field already exists (line 52) — no type change needed here, only the two new return sites.

---

### `src/session/stateless-ops.ts` (service/transform, request-response)

**Analog (errorCode threading):** `pick-handler.ts`'s `getChoices()` catch sites already attach `errorCode` inline — copy that literal-object shape into `errorResult()`'s new optional param.

**Analog (OpResult shape / errorResult signature):**
```typescript
// Source: src/session/stateless-ops.ts:242-255 (current — no errorCode param/field)
function errorResult(error: unknown, category: OpResult['category'] = 'bundle'): OpResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    success: false,
    error: message,
    category,
    snapshot: null,
    pendingState: null,
    flowState: null,
    playerViews: [],
    isComplete: false,
    winners: [],
  };
}
```
**Fix pattern:** add `errorCode?: ErrorCode` 3rd param, add `errorCode` to `OpResult` interface, thread through call sites that wrap a result which ALREADY carries `.errorCode`:
```typescript
// Source: src/session/stateless-ops.ts:302-304 (handleAction — errorCode dropped today)
if (!actionResult.success) {
  return errorResult(actionResult.error ?? 'Action failed');
  // FIX: return errorResult(actionResult.error ?? 'Action failed', 'bundle', actionResult.errorCode);
}
```
Same fix applies at line 358 (`handleSelectionStep`, wraps `step.error`/`step.errorCode`) and line 394 (`handleResolveChoices`, wraps `result.error`/`result.errorCode`) — `step`/`result` here originate from `pick-handler.ts`, which already sets `errorCode: ErrorCode.CHOICES_EVALUATION_ERROR` / `ELEMENTS_EVALUATION_ERROR` (see pick-handler.ts:206, 275, 291) — those values are CURRENTLY dropped at the `stateless-ops.ts` boundary and must be threaded through.

**Op union / READ_ONLY_OP_TYPES convention (for reference, unrelated to errorCode but relevant if `warnings` needs an Op-level touchpoint):**
```typescript
// Source: src/session/stateless-ops.ts:33-97
export type Op =
  | { type: 'action'; actionName: string; player: number; args: Record<string, unknown> }
  | /* ... */
  // demoStart / demoStop are host lifecycle ops handled by SnapshotSessionHost.handleOp
  // directly ... They MUST NOT be added to the executeOp switch.
  | { type: 'demoStart'; delay?: number }
  | { type: 'demoStop' };

export const READ_ONLY_OP_TYPES: ReadonlySet<Op['type']> = new Set([
  'resolveChoices', 'debugHistory', 'debugStateAt', 'debugStateDiff',
  'debugActionTraces', 'debugFlowState', 'aiSuggest',
]);
```
**Critical note for ERR-04:** `debug:logs` must follow the `demoStart`/`demoStop` comment precedent (line 75-79) exactly — it is a host-lifecycle op, NOT a member of `executeOp`'s pure switch, because `executeOp` is documented (file header, lines 1-10) as having "no module-level mutable state, no memory between calls."

---

### `src/session/pick-handler.ts` (service, transform)

**Analog:** sibling hard-fail `getChoices()` catches in the SAME file (lines 202-207, 271-276, 286-291) for the errorCode-attachment shape; the soft-fail sites to fix are the silent catches at lines 234-236 (`boardRefs`), 358-361 (`display`, note: currently `catch {}` with NO logging at all — worse than boardRefs), and 378-380 (`boardRef`).

**Hard-fail sibling pattern (keep unchanged — regression guard, do not touch):**
```typescript
// Source: src/session/pick-handler.ts:202-207
try {
  annotatedChoices = executor.getChoices(selection, player, resolvedArgs) as Array<{ value: unknown; disabled: string | false }>;
} catch (error) {
  const errorMsg = error instanceof Error ? error.message : 'Unknown error';
  return { success: false, error: `Error evaluating choices: ${errorMsg}`, errorCode: ErrorCode.CHOICES_EVALUATION_ERROR };
}
```

**Soft-fail site to fix (boardRefs, lines 230-237) — add a `warnings.push(...)` before/alongside the existing `console.error`:**
```typescript
// Source: src/session/pick-handler.ts:230-237 (current)
if (choiceSel.boardRefs) {
  try {
    const result = choiceSel.boardRefs(rawValue, ctx);
    choice.refs = result.refs;
  } catch (e) {
    console.error('boardRefs() error (ignored):', e);
    // ADD: warnings.push({ code: 'BOARD_REFS_ERROR', message: e instanceof Error ? e.message : String(e), source: `boardRefs(${JSON.stringify(rawValue)})` });
  }
}
```

**Soft-fail site to fix (display, lines 356-362) — currently the WORST offender (no console.error at all):**
```typescript
// Source: src/session/pick-handler.ts:356-362 (current — silent catch, no logging)
if (elemSel.display) {
  try {
    validElem.display = elemSel.display(element, ctx, elements);
  } catch {
    validElem.display = element.name || String(element.id);
    // ADD: warnings.push({ code: 'DISPLAY_ERROR', message: ..., source: `display(element #${element.id})` });
    // ADD: console.error('display() error (ignored):', e); // was missing entirely
  }
}
```

**Soft-fail site to fix (`boardRef`, lines 378-380 — IIFE catch):**
```typescript
// Source: src/session/pick-handler.ts:378-380 (current)
const rawRef = elemSel.boardRef
  ? (() => { try { return elemSel.boardRef!(element, ctx); } catch { return { id: element.id }; } })()
  : { id: element.id, ...(element.notation ? { notation: element.notation } : {}) };
```

**Where `warnings` should be aggregated per Open Question #1 in RESEARCH.md:** top-level `warnings: WarningEntry[]` array on the return object of `getPickChoices()` (the method containing all three switch cases at lines 198-329), NOT nested per-choice/per-element — `source` field disambiguates which choice/element produced the warning.

---

### `src/session/game-session.ts` (service, CRUD/event-driven)

**Analog:** same file's `#aiConsecutiveFailures` circuit-breaker (lines 2109-2119) — the EXACT structural precedent for `#persistenceConsecutiveFailures` / `lastPersistenceError`.

**Circuit-breaker pattern to mirror:**
```typescript
// Source: src/session/game-session.ts:2105-2120 (existing AI circuit breaker — mirror this shape for persistence)
} catch (error) {
  const flowState = this.#runner.getFlowState();
  if (flowState?.awaitingInput && !flowState.complete) {
    this.#aiConsecutiveFailures++;
    if (this.#aiConsecutiveFailures >= 3) {
      console.error(
        `[AI] Giving up after ${this.#aiConsecutiveFailures} consecutive failures. ...`
      );
      return;
    }
    this.#scheduleAICheck();
  }
  return;
}
```

**3 storage call sites to wrap in `#persistSafely` (all currently either fire-and-forget-with-console-error or fully unguarded):**
```typescript
// Source: src/session/game-session.ts:702-707 (create() — fire-and-forget, only console.error today)
if (storage) {
  storage.save(storedState).catch(err => {
    console.error('Failed to save initial game state:', err);
  });
}
```
```typescript
// Source: src/session/game-session.ts:1974-1978 (#save() — NO catch at all today; throws propagate)
async #save(): Promise<void> {
  if (!this.#storage) return;
  this.#storedState.snapshot = this.#runner.getSnapshot();
  await this.#storage.save(this.#storedState);
}
```
```typescript
// Source: src/session/game-session.ts:2092 (#checkAITurn's AI-move callback — Pitfall 2:
// this call is CURRENTLY inside the AI try/catch at lines 2073-2105, so a storage failure
// here is misclassified as an AI failure — must be pulled out or independently guarded)
await this.#save();
```
**Fix pattern:** all three should route through a single `#persistSafely(fn)` helper (never rethrows, always updates `lastPersistenceError` + `#persistenceConsecutiveFailures`, calls injected `#onPersistenceError` hook) — and the line-2092 call specifically must NOT let a persistence failure be caught by the surrounding AI try/catch (Pitfall 2 in RESEARCH.md is the concrete regression this guards).

---

### `src/session/snapshot-session-host.ts` (service, event-driven)

**Analog (persist call site to guard):**
```typescript
// Source: src/session/snapshot-session-host.ts:179-198 (apply() — persist call has NO catch today)
private async apply(res: OpResult, seat?: number): Promise<void> {
  this.snapshot = res.snapshot;
  this.flowState = res.flowState;
  // ...
  this.lastPlayerViews = res.playerViews;
  const mergedViews = this.mergeTransientState(res.playerViews);
  this.adapters.broadcast(mergedViews, { isComplete: res.isComplete, winners: res.winners });
  await this.adapters.persist?.({ snapshot: this.snapshot, pendingStates: Object.fromEntries(this.pendingStates) });
  // FIX: wrap the persist?.() call in the same #persistSafely-style guard used in game-session.ts
}
```

**Analog (host-lifecycle op interception — THE template for `debug:logs`, per RESEARCH.md's explicit guidance to use `demoStart`/`demoStop`, NOT `debug:flow-state`):**
```typescript
// Source: src/session/snapshot-session-host.ts:208-243 (handleOp intercepting demoStart
// BEFORE any delegation to executeOp — mirror this exact interception shape for debugLogs)
async handleOp(seat: number, op: Op): Promise<OpResult> {
  // Demo lifecycle ops — handled directly in the host (NOT delegated to executeOp)
  // because they need the broadcast adapter and a cancellable async lifetime.
  if (op.type === 'demoStart') {
    if (this.adapters.teachingDisabled) {
      throw new Error('Teaching features are disabled for this session.');
    }
    if (!this.demoRunning) {
      // ... build state, void this.runDemoLoop(allSeats) fire-and-forget
    }
    return {
      success: true,
      snapshot: this.snapshot,
      flowState: this.flowState,
      playerViews: [], // clients read demo state from game_state broadcasts
      isComplete: this.isComplete,
      winners: this.winners,
      pendingState: null,
    };
  }
  if (op.type === 'demoStop') {
    this.demoAbort = true;
    // ...
  }
  // debugLogs would be intercepted here identically: read from the ring buffer
  // (injected adapter or local field), return entries directly, NEVER call executeOp.
}
```

**Capped-loop constant convention to reuse for the ring-buffer cap (Open Question #2 in RESEARCH.md):**
```typescript
// Source: src/session/snapshot-session-host.ts:9, 74
const MAX_AI_MOVES = 500;
// ...
// MAX_DEMO_MOVES: hard cap to guard against infinite/very long games (STRIDE T-110-06).
private readonly MAX_DEMO_MOVES = 200;
```
**Action:** name the ring-buffer cap similarly, e.g. `MAX_LOG_ENTRIES = 300` (module-level `const`, same style as `MAX_AI_MOVES`), documented with a one-line comment on why (mirrors the `MAX_DEMO_MOVES` STRIDE-reference comment style).

---

### `src/cli/dev-host/log-capture.ts` (NEW — utility/store, event-driven)

**No direct analog** (first ring buffer in the repo) — build per RESEARCH.md's "Don't Hand-Roll" table: a plain array with `push()` + `shift()` when over the cap, NOT a circular-buffer class. Module-level state is fine HERE (dev-host only) — this is the one file in the phase explicitly allowed mutable module state, in contrast to `stateless-ops.ts`'s purity contract.

**Shape to follow (illustrative, matching `MAX_AI_MOVES`/`MAX_DEMO_MOVES` naming + comment style):**
```typescript
// New file: src/cli/dev-host/log-capture.ts
const MAX_LOG_ENTRIES = 300; // dev-only, single process — cap prevents unbounded growth over a long session

export interface LogEntry {
  severity: 'error' | 'warning' | 'info';
  message: string;
  source: string;
  timestamp: number;
}

const entries: LogEntry[] = [];

export function record(severity: LogEntry['severity'], message: string, source: string): void {
  entries.push({ severity, message, source, timestamp: Date.now() });
  if (entries.length > MAX_LOG_ENTRIES) entries.shift();
}

export function getEntries(): readonly LogEntry[] {
  return entries;
}
```
**Dependency direction (Pitfall 5 in RESEARCH.md):** `src/session/game-session.ts` and `src/session/snapshot-session-host.ts` must NEVER import this file. They expose an injectable `onPersistenceError` constructor hook; `multiplayer-host.ts` supplies a callback that calls `record(...)` from THIS module. `grep -rn "cli/dev-host" src/session/` must return zero hits after this phase.

---

### `src/cli/dev-host/bridge.ts` (route/controller, request-response)

**Analog:** `debug:flow-state`'s WireOp + translateOp + shapeResult triple (lines 47, 181-185, 261-267) — the exact chain to mirror STRUCTURALLY for `debug:logs`, but per RESEARCH.md Pitfall 3, `debug:logs` resolves in `SnapshotSessionHost.handleOp()` directly (host-lifecycle), never via `executeOp`.

**WireOp union entry (add alongside the existing `debug:*` block, lines 43-52):**
```typescript
// Source: src/cli/dev-host/bridge.ts:43-52 (existing debug:* WireOp members)
| 'debug:history'
| 'debug:state-at'
| 'debug:state-diff'
| 'debug:action-traces'
| 'debug:flow-state'
| 'debug:rewind'
| 'debug:move-to-top'
| 'debug:reorder-card'
| 'debug:transfer-card'
| 'debug:shuffle-deck';
// ADD: | 'debug:logs';
```

**translateOp case (mirrors `debug:flow-state` at line 181-185):**
```typescript
// Source: src/cli/dev-host/bridge.ts:181-185
case 'debug:flow-state':
  // Always the connection's own seat — pendingAction data is seat-scoped
  // (T-123-10) and there is no legitimate use for a client-supplied
  // override here, unlike the other debug:* ops above (IN-01).
  return { type: 'debugFlowState', player: seat };
// ADD: case 'debug:logs': return { type: 'debugLogs' };
```

**shapeResult case (mirrors `debug:flow-state` at line 261-267 and the plain `{success,error,X}` shape used by every other `debug:*` case):**
```typescript
// Source: src/cli/dev-host/bridge.ts:261-267
case 'debug:flow-state':
  return {
    success: result.success,
    error: result.error,
    flowDebugInfo: result.flowDebugInfo,
    pendingAction: result.pendingAction,
  };
// ADD: case 'debug:logs': return { success: result.success, error: result.error, entries: result.entries };
```

**Also thread `warnings` per RESEARCH.md Pitfall 4 into the `'action'` and `'selection_step'` cases (currently a manual allowlist, NOT a passthrough — `'resolve_choices'` already passes through everything via `return result as unknown as Record<string, unknown>`):**
```typescript
// Source: src/cli/dev-host/bridge.ts:217-229 (current — no warnings field on either case)
case 'action':
  return { success: result.success, error: result.error, followUp: result.followUp };
  // FIX: add `warnings: result.warnings` here
case 'resolve_choices':
  return result as unknown as Record<string, unknown>; // already full passthrough — warnings ride free
case 'selection_step':
  if (!result.success) return { success: false, error: result.error };
  return {
    success: true,
    done: result.done,
    nextChoices: result.nextChoices,
    actionComplete: result.actionComplete,
    followUp: result.followUp,
    // FIX: add `warnings: result.warnings` here
  };
```

---

### `src/ui/components/DebugPanel.vue` (component, request-response)

**Analog:** `fetchFlowState()` (lines 1066-1077) — the exact client-fetch pattern to copy for `fetchLogs()`.

```typescript
// Source: src/ui/components/DebugPanel.vue:1066-1077
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
**Fix pattern:** add a `logEntries = ref<LogEntry[]>([])` and a `fetchLogs()` following the identical try/catch/data.success shape, calling `debugRequest('debug:logs', {})` (no `player` param needed — logs are process-wide, not seat-scoped, per RESEARCH.md's security note that this matches existing `debug:*` precedent of no per-seat filtering). Wire it into the existing polling call sites near lines 1085/1094 (where `fetchFlowState()` is already invoked) and add a new "Logs" tab rendering `logEntries` with severity + timestamp.

---

## Shared Patterns

### ErrorCode enum — single source of truth
**Source:** `src/types/protocol.ts:44-77`
**Apply to:** `runner.ts` (2 new return sites), `stateless-ops.ts` (`errorResult` threading)
Extend the ONE enum with `ENGINE_ERROR` and `ACTION_EXECUTION_ERROR`. Never create a parallel error-code type — the enum's own JSDoc declares it authoritative across runtime/session/server layers (protocol.ts:21-23).

### Never leak stack traces — sanctioned error/warning message shape
**Source:** `src/session/stateless-ops.ts:243` (`errorResult`) and `src/session/pick-handler.ts:205` (getChoices catch)
**Apply to:** every new `WarningEntry.message`, `lastPersistenceError.message`, and log-capture `LogEntry.message`
```typescript
const message = error instanceof Error ? error.message : String(error);
```
Never attach `error.stack`.

### Host-lifecycle op interception (bypass pure executeOp)
**Source:** `src/session/snapshot-session-host.ts:213-243` (`demoStart`/`demoStop` in `handleOp()`)
**Apply to:** `debug:logs` (ERR-04) — resolved directly in `SnapshotSessionHost.handleOp()`, never added to `stateless-ops.ts`'s `executeOp` switch or `Op` union's `READ_ONLY_OP_TYPES` set (that set is for ops that DO route through `executeOp`).

### Circuit-breaker / consecutive-failure counter shape
**Source:** `src/session/game-session.ts:2109-2119` (`#aiConsecutiveFailures`)
**Apply to:** ERR-03's `#persistenceConsecutiveFailures` + `lastPersistenceError` in BOTH `game-session.ts` and `snapshot-session-host.ts` (Phase 123 "wire both hosts" lesson — see CONTEXT.md line 68).

### shapeResult manual allowlist — no generic passthrough (except resolve_choices)
**Source:** `src/cli/dev-host/bridge.ts:215-277`
**Apply to:** any new field added to `OpResult` (e.g. `warnings`, future `errorCode` on the wire) must be explicitly added to every relevant `case` in `shapeResult` — it is NOT a passthrough by default.

### Capped-array constant convention
**Source:** `src/session/snapshot-session-host.ts:9` (`MAX_AI_MOVES = 500`) and `:74` (`MAX_DEMO_MOVES = 200`)
**Apply to:** `log-capture.ts`'s `MAX_LOG_ENTRIES` constant — same naming/comment style.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/cli/dev-host/log-capture.ts` | utility/store | event-driven | First in-memory ring buffer in the repo — no existing module owns mutable dev-host-only state of this shape. Build per RESEARCH.md's "Don't Hand-Roll" guidance (plain array + push/shift), not a custom circular-buffer class. |

## Metadata

**Analog search scope:** `src/types/protocol.ts`, `src/runtime/runner.ts`, `src/session/stateless-ops.ts`, `src/session/pick-handler.ts`, `src/session/game-session.ts`, `src/session/snapshot-session-host.ts`, `src/cli/dev-host/bridge.ts`, `src/ui/components/DebugPanel.vue`
**Files scanned:** 8 (all files this phase touches; every analog was found within the SAME files being modified — this phase is almost entirely "extend an existing pattern already present in the target file," consistent with RESEARCH.md's framing of this phase as plumbing, not new subsystems)
**Pattern extraction date:** 2026-07-02
