# Phase 110: Demonstration & Refinement — Research

**Researched:** 2026-06-29
**Domain:** Dev-host teaching wiring (SnapshotSessionHost stateless-ops path) + AI-vs-AI demo loop
**Confidence:** HIGH — all findings are from direct codebase inspection, not from training data.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Scope (2026-06-29): BUILD EVERYTHING including the demo loop.** All five teaching beats (hint, heatmap, demo-start, demo-stop, un-hide Teaching controls) must be demonstrable live in the dev host.
- **Area 1:** Signal AI availability via `hasAIPlayers` flag in `buildPlayerState`/snapshot playerViews; base `showHintProp` on that broadcast signal in platform mode. Production (lobby) path keeps working.
- **Area 2:** Mirror Phase 109 `start-tutorial` three-file pattern (bridge.ts + stateless-ops.ts). Reuse `handleAITurn`'s `createBot` infra. `hint` → `bot.play()`. `heatmap-toggle (visible=true)` → `bot.playWithStats()`. Add `transientTeachingState: Map<seat, {hint?, heatmap?}>` to `SnapshotSessionHost`; merge on EVERY broadcast.
- **Area 3:** `demo-start`/`demo-stop` with narrated loop, reuse `handleAITurn` path. Narrate BEFORE move executes (`onBeforeMove` semantics). Loop must not leave a background timer running. `demo-stop` halts and restores normal play.
- **Area 4:** After wiring lands and suites are green, pause and hand off to user for live browser demonstration. Capture friction.

### Claude's Discretion
- Exact wire-op names and payloads.
- Precise `hasAIPlayers` signal mechanism.
- Where demo coordinator lives (`SnapshotSessionHost` vs `MultiplayerHost`).
- Transient-state Map shape.
- Demo loop cancellation/cleanup approach.
- All at implementation discretion, consistent with Phase 109 op pattern and Phase 107 `GameSession` teaching semantics.

### Deferred Ideas (OUT OF SCOPE)
- Applying tutorial/teaching primitives to cribbage (v2 CRIB milestone).
- Any refinements the user requests during the demo that are larger than quick fixes.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DEMO-01 | The checkers tutorial and all teaching features (TUT/AI/HELP) demonstrated end-to-end in the browser for hands-on review. | Sections 2–5 document the complete wiring path. The demo loop design (Section 5) is the key new deliverable. The demonstration script (Area 4) follows automatically once wiring is green. |
</phase_requirements>

---

## Summary

Phase 110 wires Phase 107's teaching features (hint, heatmap, AI-vs-AI narrated demo) through the `boardsmith dev` host path (`SnapshotSessionHost` + `stateless-ops.ts`) that Phase 107 deliberately deferred. The production path (`GameSession`) uses stateful Maps and an `AIController` loop; the dev path is stateless-per-op. The key design insight is that `SnapshotSessionHost` is the right owner of transient teaching state — it already owns the snapshot, the broadcast adapter, and the AI pump (`runAITurns`) — mirroring exactly how `GameSession` owns `#hint`/`#heatmap`/`#demoMode` privately.

The demo loop is the riskiest deliverable because it is an async timed loop with side-effecting broadcast calls that must be cancellable without leaking timers. The approach: `SnapshotSessionHost` runs the loop as a fire-and-forget async method, using a `demoAbort` boolean flag that `demo-stop` sets to cancel before/after the delay. Each loop iteration: (1) runs `aiSuggest` (new read-only op) to preview the move without executing it, (2) injects narration text into transient state and broadcasts, (3) waits `demoDelay` ms, (4) executes the EXACT previewed move via the existing `action` op (not re-running the bot — this avoids non-determinism). This faithfully replicates `GameSession.startDemo()`'s `onBeforeMove` semantics.

The `hasAIPlayers` signal is injected by `SnapshotSessionHost` during broadcast (when `adapters.aiSeats?.length > 0`), and `GameShell.showHintProp` picks it up as a fallback so the production lobby path is unaffected.

**Primary recommendation:** Keep all new teaching ops in the existing three-file pattern (bridge.ts + stateless-ops.ts + snapshot-session-host.ts). The demo coordinator belongs in `SnapshotSessionHost` (not `MultiplayerHost`) because it needs direct access to the broadcast adapter and the snapshot.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `hint` annotation compute | Stateless executor (stateless-ops.ts) | SnapshotSessionHost (stores result) | MCTS is pure computation on a snapshot; the result (annotation) is transient host-level state |
| `heatmap` entry compute | Stateless executor (stateless-ops.ts) | SnapshotSessionHost (stores result) | Same as hint — pure computation, transient result |
| Demo loop orchestration | SnapshotSessionHost | — | The loop needs the broadcast adapter, snapshot, and a cancellable async lifetime; it cannot live in the stateless executor |
| Transient teaching state merge | SnapshotSessionHost | — | Mirrors `GameSession.broadcast()` — happens after `buildPlayerState()` so that function stays pure |
| `hasAIPlayers` signal injection | SnapshotSessionHost | — | Host knows `adapters.aiSeats`; the stateless executor doesn't |
| `showHintProp` gating (UI) | GameShell.vue | — | Reads `state.value?.state?.hasAIPlayers` (new) OR `lobbyInfo.value?.slots` (existing); no new component needed |
| Teaching group visibility | ControlsMenu.vue | — | `v-if="showHint !== undefined"` — unchanged; show/hide driven by `showHintProp` fix |
| Wire op translation | bridge.ts | — | Three-file pattern (WireOp union + translateOp + shapeResult) |
| Narrator text formatting | SnapshotSessionHost | — | Mirrors `game-session.ts:1142-1149`; default narrator produces "PlayerName: action key=val" |

---

## Standard Stack

No new dependencies. All capabilities use existing modules. [VERIFIED: direct codebase inspection]

### Key Existing Pieces

| Module | Path | Phase 110 Role |
|--------|------|----------------|
| `createBot` / `parseAILevel` | `src/ai/index.ts` | Bot construction in hint/heatmap/demo-suggest ops |
| `MCTSBot.play()` | `src/ai/mcts-bot.ts` | Move suggestion for hint and aiSuggest ops |
| `MCTSBot.playWithStats()` | `src/ai/mcts-bot.ts` | Stats for heatmap entries |
| `buildPlayerState` | `src/session/utils.ts:345` | Called by `buildViews`; does NOT include transient state — injection stays above it |
| `HeatmapEntry` | `src/session/types.ts:389` | Shape of heatmap entries in broadcast state |
| `Annotation` | `src/engine/tutorial/types.js` | Shape of hint annotation (imported via `session/types.ts:11`) |
| `ElementRef` | `src/session/types.ts:247` | Target ref for hint board highlight |
| `canSeatAct` | `src/engine/index.ts` | Already imported in stateless-ops.ts:13; used by hint op to validate seat |
| `AIConfig` | `src/ai/types.ts:129` | Type for `def.ai` in `GameDefinitionLike` (hintTargetFromMove) |

### Installation
No packages to install.

---

## Package Legitimacy Audit

No external packages are added in this phase.

---

## Architecture Patterns

### System Architecture Diagram

```
Client (platformRequest)
  → wire op (hint / heatmap-toggle / demo-start / demo-stop)
  → bridge.ts translateOp → Op union type
  → SnapshotSessionHost.handleOp
      ├── hint / heatmapToggle: call executeOp → get result → store in transientTeachingState → broadcastCurrent()
      ├── demoStart: start runDemoLoop() [fire-and-forget] → return {success:true}
      ├── demoStop: set demoAbort=true → clear demoRunning/narration → broadcastCurrent()
      └── all other ops: existing flow → executeOp → apply() → mergeTransientState() → broadcast
  → bridge.ts shapeResult → server_response → client

Demo loop (async, SnapshotSessionHost):
  executeOp(aiSuggest) → { aiPlayer, suggestedAction, suggestedArgs }
    → build narrationText
    → inject into transientTeachingState as demoNarration
    → broadcastCurrent()  [clients see: isDemoRunning + narration BEFORE move]
    → await delay (setTimeout + demoAbort check)
    → executeOp({type:'action', player, actionName, args})  [EXACT same move as narrated]
    → apply(result)  [broadcasts updated state; clears narration]
    → check game complete / demoAbort → loop or exit
```

### Recommended Project Structure Changes

```
src/session/
  snapshot-session-host.ts      [ADD: transientTeachingState, demo loop, mergeTransientState, broadcastCurrent, lastPlayerViews]
  stateless-ops.ts              [ADD: hint/heatmapToggle/aiSuggest ops to Op union + executeOp switch; extend OpResult with hintAnnotation/heatmapUpdate/suggestedAction/suggestedArgs]

src/cli/dev-host/
  bridge.ts                     [ADD: WireOp entries + translateOp cases + shapeResult cases for hint/heatmap-toggle/demo-start/demo-stop]

src/ui/components/
  GameShell.vue                 [CHANGE: showHintProp — add OR for state.hasAIPlayers]

~/BoardSmithGames/checkers/src/rules/
  index.ts                      [ADD: hintTargetFromMove to gameDefinition.ai — see Pitfall 4]
```

### Pattern 1: Three-File Wire Op Pattern (mirror of start-tutorial in Phase 109)

Source: `src/cli/dev-host/bridge.ts` (Phase 109 template)

```typescript
// bridge.ts — Step 1: WireOp union (line ~27)
export type WireOp =
  | /* existing ops */
  | 'hint'
  | 'heatmap-toggle'
  | 'demo-start'
  | 'demo-stop';

// bridge.ts — Step 2: translateOp (line ~93)
case 'hint':
  return { type: 'hint', seat, seat: payload.seat as number ?? seat };
case 'heatmap-toggle':
  return { type: 'heatmapToggle', seat, visible: payload.visible as boolean };
case 'demo-start':
  return { type: 'demoStart' };
case 'demo-stop':
  return { type: 'demoStop' };

// bridge.ts — Step 3: shapeResult (line ~175)
case 'hint':
case 'heatmap-toggle':
case 'demo-start':
case 'demo-stop':
  return { success: result.success, error: result.error };
```

Source: verified by reading bridge.ts WireOp (line 22), translateOp (line 93), shapeResult (line 175).

### Pattern 2: OpResult Extension for Transient Teaching Annotations

Source: `src/session/stateless-ops.ts` (OpResult interface, line 76) and `src/session/types.ts:457-484`.

```typescript
// stateless-ops.ts — extend OpResult
export interface OpResult {
  // ... existing fields ...

  // Transient teaching annotations — set by hint/heatmapToggle ops.
  // Consumed by SnapshotSessionHost to update transientTeachingState.
  hintAnnotation?: { seat: number; annotation: Annotation };
  heatmapUpdate?: { seat: number; visible: boolean; entries: HeatmapEntry[] };

  // Suggestion from aiSuggest (read-only, no state change).
  // Consumed by the demo loop in SnapshotSessionHost.
  suggestedAction?: string;
  suggestedArgs?: Record<string, unknown>;
}

// stateless-ops.ts — Op union additions
| { type: 'hint'; seat: number }
| { type: 'heatmapToggle'; seat: number; visible: boolean }
| { type: 'aiSuggest'; seats: Array<{ seat: number; level?: string }> }
| { type: 'demoStart' }  // handled in SnapshotSessionHost, NOT in executeOp
| { type: 'demoStop' }   // handled in SnapshotSessionHost, NOT in executeOp

// READ_ONLY_OP_TYPES additions
READ_ONLY_OP_TYPES.add('aiSuggest');
// Note: 'hint' and 'heatmapToggle' are NOT read-only (they cause a broadcast)
// but they DO NOT change game state. Handle separately in SnapshotSessionHost.handleOp.
```

### Pattern 3: hint Op Handler in stateless-ops.ts

Source: mirrors `game-session.ts:951-982` and `handleAITurn` pattern (line 430).

```typescript
// stateless-ops.ts — new handleHint function
async function handleHint(
  def: GameDefinitionLike,
  gameOptions: { playerCount: number; [key: string]: unknown },
  snapshot: GameStateSnapshot,
  op: Extract<Op, { type: 'hint' }>,
): Promise<OpResult> {
  const runner = runnerFromSnapshot(snapshot, def);
  const flowState = runner.getFlowState() as AIFlowState;

  if (!canSeatAct(flowState as FlowState, op.seat)) {
    return errorResult(`Cannot hint: seat ${op.seat} is not awaiting input`, 'protocol');
  }

  const bot = createBot(
    runner.game as Game,
    def.gameClass as GameRunnerOptions<never>['GameClass'],
    def.gameType,
    op.seat,
    runner.actionHistory,
    parseAILevel('medium'),
    def.ai,  // pass through for hintTargetFromMove
  );

  const move = await bot.play();

  // Extract target ref using the same priority chain as GameSession.#extractMoveTarget()
  let target: ElementRef | undefined;
  if (def.ai?.hintTargetFromMove) {
    target = def.ai.hintTargetFromMove(move);
  } else {
    const DEST_ARGS = ['to', 'destination', 'target', 'square', 'cell', 'position'];
    for (const key of DEST_ARGS) {
      const val = move.args[key];
      if (typeof val === 'number') { target = { id: val }; break; }
      if (typeof val === 'string') { target = { notation: val }; break; }
    }
  }

  const annotation: Annotation = {
    text: 'Suggested move',
    ...(target ? { target: { kind: 'element' as const, ref: target } } : {}),
  };

  return {
    success: true,
    ...stateEnvelope(runner, gameOptions.playerCount),  // snapshot unchanged
    hintAnnotation: { seat: op.seat, annotation },
  };
}
```

### Pattern 4: transientTeachingState Merge in SnapshotSessionHost

Source: mirrors `game-session.ts:1919-1934` broadcast injection. All field names match `PlayerGameState` in `src/session/types.ts:401`.

```typescript
// snapshot-session-host.ts — new private state
private transientTeachingState = new Map<number, {
  hint?: { annotation: Annotation };
  heatmap?: { visible: boolean; entries: HeatmapEntry[] };
}>();
private demoRunning = false;
private narrationText: string | null = null;
private lastPlayerViews: unknown[] = [];  // cached from last apply()

// mergeTransientState — called by apply() and broadcastCurrent()
private mergeTransientState(playerViews: unknown[]): unknown[] {
  const hasTransient = this.transientTeachingState.size > 0
    || this.demoRunning
    || this.narrationText !== null
    || (this.adapters.aiSeats?.length ?? 0) > 0;
  if (!hasTransient) return playerViews;

  return (playerViews as Array<{ flowState: unknown; state: Record<string, unknown> }>).map((view, i) => {
    const seat = i + 1;
    const transient = this.transientTeachingState.get(seat);
    const state = { ...view.state };
    if (transient?.hint) state.hint = transient.hint;
    if (transient?.heatmap) state.heatmap = transient.heatmap;
    if (this.narrationText) state.narration = { text: this.narrationText };
    if (this.demoRunning) state.isDemoRunning = true;
    if (this.adapters.aiSeats?.length) state.hasAIPlayers = true;
    return { ...view, state };
  });
}

// Modified apply() — cache views + merge before broadcast
private async apply(res: OpResult, seat?: number): Promise<void> {
  this.snapshot = res.snapshot;
  this.flowState = res.flowState;
  this.isComplete = res.isComplete;
  this.winners = res.winners;
  this.lastPlayerViews = res.playerViews;  // cache for broadcastCurrent()

  if (seat !== undefined) {
    if (res.pendingState) this.pendingStates.set(seat, res.pendingState);
    else this.pendingStates.delete(seat);
  }

  const mergedViews = this.mergeTransientState(res.playerViews);
  this.adapters.broadcast(mergedViews, { isComplete: res.isComplete, winners: res.winners });
  await this.adapters.persist?.({ snapshot: this.snapshot, pendingStates: Object.fromEntries(this.pendingStates) });
}

// broadcastCurrent() — re-broadcast with current transient state (no op execute needed)
private broadcastCurrent(): void {
  const mergedViews = this.mergeTransientState(this.lastPlayerViews);
  this.adapters.broadcast(mergedViews, { isComplete: this.isComplete, winners: this.winners });
}
```

### Pattern 5: Demo Loop in SnapshotSessionHost

Source: mirrors `game-session.ts:1099-1164` (`startDemo`) semantics. Critical: `aiSuggest` + existing `action` op avoids non-determinism from re-running MCTS.

```typescript
// snapshot-session-host.ts
private demoAbort = false;
private readonly MAX_DEMO_MOVES = 200;  // guard vs. infinite games

private async runDemoLoop(
  allSeats: Array<{ seat: number; level?: string }>,
  delay: number,
): Promise<void> {
  this.demoRunning = true;
  this.demoAbort = false;
  this.broadcastCurrent();  // clients see isDemoRunning=true before first move

  let moves = 0;
  try {
    while (!this.demoAbort && !this.isComplete && moves < this.MAX_DEMO_MOVES) {
      moves++;

      // Phase 1: Suggest move (read-only — no state change)
      const suggestRes = await this.adapters.executeOp(this.snapshot, null, {
        type: 'aiSuggest',
        seats: allSeats,
      });
      if (!suggestRes.success || !suggestRes.aiPlayer || !suggestRes.suggestedAction) break;
      if (this.demoAbort) break;

      // Phase 2: Narrate BEFORE executing (mirror onBeforeMove semantics)
      const { aiPlayer, suggestedAction, suggestedArgs = {} } = suggestRes;
      this.narrationText = this.buildNarration(aiPlayer, suggestedAction, suggestedArgs);
      this.broadcastCurrent();  // announcement broadcast

      // Phase 3: Wait delay (cancellable)
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
      if (this.demoAbort) break;

      // Phase 4: Execute the EXACT suggested move via existing 'action' op
      // (Do NOT re-run aiSuggest — that would be a second MCTS call with a
      // potentially different result, making the narration a lie.)
      this.narrationText = null;
      const execRes = await this.adapters.executeOp(this.snapshot, null, {
        type: 'action',
        actionName: suggestedAction,
        player: aiPlayer,
        args: suggestedArgs as Record<string, unknown>,
      });

      if (!execRes.success) break;  // illegal move (shouldn't happen, but fail-clean)

      // Clear hint for the acting seat (mirrors performAction hint.delete(player))
      const seatTransient = this.transientTeachingState.get(aiPlayer);
      if (seatTransient?.hint) {
        const { hint: _h, ...rest } = seatTransient;
        Object.keys(rest).length > 0
          ? this.transientTeachingState.set(aiPlayer, rest)
          : this.transientTeachingState.delete(aiPlayer);
      }

      await this.apply(execRes);  // broadcasts updated state (narration already null)
    }
  } finally {
    // Always clean up — no leaked state regardless of exit reason
    this.demoRunning = false;
    this.demoAbort = false;
    this.narrationText = null;
    this.broadcastCurrent();  // broadcast isDemoRunning=false
  }
}

// Default narrator — mirror game-session.ts:1142-1149
private buildNarration(player: number, action: string, args: Record<string, unknown>): string {
  const argSummary = Object.entries(args)
    .map(([k, v]) => (v !== null && typeof v === 'object' ? `${k}=${JSON.stringify(v)}` : `${k}=${String(v)}`))
    .join(' ');
  return argSummary ? `Player ${player}: ${action} ${argSummary}` : `Player ${player}: ${action}`;
}
```

### Pattern 6: handleOp Additions in SnapshotSessionHost

```typescript
async handleOp(seat: number, op: Op): Promise<OpResult> {
  // Demo lifecycle ops — handled directly in host (not delegated to executeOp)
  if (op.type === 'demoStart') {
    if (!this.demoRunning) {
      const allSeats = this.adapters.aiSeats?.length
        ? Array.from({ length: this.adapters.playerCount }, (_, i) => ({ seat: i + 1, level: this.adapters.aiSeats?.[0]?.level }))
        : Array.from({ length: this.adapters.playerCount }, (_, i) => ({ seat: i + 1 }));
      const delay = typeof (op as any).delay === 'number' ? (op as any).delay : 1200;
      void this.runDemoLoop(allSeats, delay);  // fire-and-forget
    }
    return { success: true, snapshot: this.snapshot, flowState: this.flowState, playerViews: [], isComplete: this.isComplete, winners: this.winners, pendingState: null };
  }
  if (op.type === 'demoStop') {
    this.demoAbort = true;
    return { success: true, snapshot: this.snapshot, flowState: this.flowState, playerViews: [], isComplete: this.isComplete, winners: this.winners, pendingState: null };
  }

  // Teaching ops — compute annotation, store in transient state, re-broadcast
  if (op.type === 'hint' || op.type === 'heatmapToggle') {
    const res = await this.adapters.executeOp(this.snapshot, null, op);
    if (res.success) {
      if (res.hintAnnotation) {
        const existing = this.transientTeachingState.get(res.hintAnnotation.seat) ?? {};
        this.transientTeachingState.set(res.hintAnnotation.seat, { ...existing, hint: { annotation: res.hintAnnotation.annotation } });
      }
      if (res.heatmapUpdate) {
        const existing = this.transientTeachingState.get(res.heatmapUpdate.seat) ?? {};
        this.transientTeachingState.set(res.heatmapUpdate.seat, { ...existing, heatmap: { visible: res.heatmapUpdate.visible, entries: res.heatmapUpdate.entries } });
      }
      this.broadcastCurrent();
    }
    return res;
  }

  // Read-only ops (resolveChoices + debug queries)
  if (READ_ONLY_OP_TYPES.has(op.type)) {
    return this.adapters.executeOp(this.snapshot, this.pendingStates.get(seat) ?? null, op);
  }

  if (op.type === 'action') this.pendingStates.delete(seat);
  const res = await this.adapters.executeOp(this.snapshot, this.pendingStates.get(seat) ?? null, op);
  if (!res.success) return res;

  // Clear hint for acting seat on successful action
  if (op.type === 'action' || (op.type === 'selectionStep' && res.actionComplete)) {
    const seatTransient = this.transientTeachingState.get(seat);
    if (seatTransient?.hint) {
      const { hint: _h, ...rest } = seatTransient;
      Object.keys(rest).length > 0
        ? this.transientTeachingState.set(seat, rest)
        : this.transientTeachingState.delete(seat);
    }
  }

  // Clear ALL transient state on undo/rewind (mirrors game-session.ts:312-313)
  if (op.type === 'undo' || op.type === 'debugRewind') {
    this.transientTeachingState.clear();
    this.narrationText = null;
  }

  await this.apply(res, seat);

  if (!this.isComplete && (op.type === 'action' || (op.type === 'selectionStep' && res.actionComplete))) {
    await this.runAITurns();
  }
  return res;
}
```

### Pattern 7: showHintProp Fix in GameShell.vue

Source: `src/ui/components/GameShell.vue:694`.

```typescript
// BEFORE (line 694):
const showHintProp = computed<boolean | undefined>(() =>
  lobbyInfo.value?.slots?.some(s => s.aiLevel != null) ? true : undefined
);

// AFTER:
const showHintProp = computed<boolean | undefined>(() => {
  // Production lobby path — unchanged
  if (lobbyInfo.value?.slots?.some(s => s.aiLevel != null)) return true;
  // Dev-host path: SnapshotSessionHost injects hasAIPlayers into broadcast state
  if ((state.value?.state as any)?.hasAIPlayers) return true;
  return undefined;
});
```

### Pattern 8: checkers hintTargetFromMove (cross-repo change needed)

Source: `~/BoardSmithGames/checkers/src/rules/index.ts` + `~/BoardSmithGames/checkers/src/rules/actions.ts`.

The checkers `destination` arg is an object `{ pieceId, fromNotation, toNotation, ... }`. The default fallback in `#extractMoveTarget` (which checks for a plain string or number) will NOT find the target. Add to checkers' `gameDefinition.ai`:

```typescript
// ~/BoardSmithGames/checkers/src/rules/index.ts
export const gameDefinition = {
  // ... existing ...
  ai: {
    objectives: getCheckersObjectives,
    hintTargetFromMove: (move) => {
      const dest = move.args.destination as { toNotation?: string } | undefined;
      return dest?.toNotation ? { notation: dest.toNotation } : undefined;
    },
  },
  // ...
};
```

Also add `ai?: AIConfig` to `GameDefinitionLike` in `stateless-ops.ts` and pass `gameDefinition.ai` in `dev.ts`'s `gameDef` object (line 567).

### Anti-Patterns to Avoid

- **Re-running MCTS for the execute step**: Calling `aiSuggest` then `aiTurn` (not `action`) for the execute step would run two MCTS searches, and the second search might choose a different move, making the narration describe a move that doesn't happen. Use `action` with the exact args from `aiSuggest`.
- **Storing `playerViews` in the OpResult for hint/heatmap**: These ops don't change game state; returning a full stateEnvelope is fine for consistency, but `SnapshotSessionHost` must use `broadcastCurrent()` (from cached `lastPlayerViews`) rather than `apply()` to avoid redundant snapshot re-stores.
- **Running the demo loop via `runAITurns`**: `runAITurns` has no narration, no delay, no per-move broadcast announcement. The demo loop is a distinct method.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Bot construction | Custom bot factory | `createBot(runner.game, def.gameClass, def.gameType, seat, runner.actionHistory, parseAILevel(level), def.ai)` from `ai/index.ts` | Existing tested factory; handles `botConfig` threading |
| Move suggestion | Custom MCTS | `bot.play()` | Tested, seeded, already used by `handleAITurn` |
| Heatmap stats | Custom eval | `bot.playWithStats()` then `#buildHeatmapEntries` pattern from `game-session.ts:1007-1026` | The dedup + isBest logic is non-trivial |
| Snapshot reconstruction | Manual state rebuild | `runnerFromSnapshot(snapshot, def)` | Already handles tutorial re-threading |
| Narration text | LLM or custom | Default narrator from `game-session.ts:1142-1149` pattern | Deterministic, game-agnostic, human-readable |
| Timer cancellation | OS signals / AbortController | Simple `demoAbort: boolean` flag | Sufficient for this use case; mirrors `aiPumpRunning` guard already on the host |

**Key insight:** The production `GameSession` already solved all the hard problems (bot lifecycle, annotation extraction, narration formatting, transient state injection). Phase 110 is a port of those solutions to the stateless host path — not an invention.

---

## Common Pitfalls

### Pitfall 1: Leaked Timer After demo-stop
**What goes wrong:** `demo-stop` sets `demoAbort = true` but the loop is mid-`await setTimeout(...)`. The delay resolves, the loop continues, and one more move executes and broadcasts after the stop.
**Why it happens:** `demoAbort` is only checked at the top of the loop iteration, not after the delay.
**How to avoid:** Check `demoAbort` BOTH before and after the delay — at the start of each iteration AND immediately after `await new Promise(setTimeout)`. The `finally` block in `runDemoLoop` is the last line of defense; it always clears `demoRunning` and broadcasts the clean state.
**Warning signs:** Demo keeps running one more move after stop; `isDemoRunning` briefly true on next broadcast after stop.

### Pitfall 2: Demo Loop Not Stopping on Game-Over
**What goes wrong:** Game reaches terminal state (`isComplete === true`) but the loop runs one more iteration because `isComplete` is only checked at the top of the while condition, AFTER `apply` runs.
**Why it happens:** `apply` sets `this.isComplete` from the op result; the while condition `!this.isComplete` needs to be checked after `apply`, not just at the top.
**How to avoid:** After `await this.apply(execRes)`, the while condition `!this.isComplete` IS rechecked at the top of the next iteration — this is correct as written. Additionally, check `this.isComplete` immediately after `apply` and `break` before the next `aiSuggest` call to avoid a wasted MCTS run.

### Pitfall 3: Concurrent Bot Searches (Demo + Hint/Heatmap)
**What goes wrong:** User triggers `hint` while the demo loop is running. Two MCTS searches execute concurrently, competing for CPU and potentially causing race conditions on the `demoAbort` state.
**Why it happens:** No guard between demo loop and teaching ops.
**How to avoid:** In `handleOp`, reject `hint` and `heatmapToggle` ops while `this.demoRunning === true`, returning a clear error: `"Cannot request hint while demo is running — stop the demo first."` The production `game-session.ts` uses `#heatmapUpdating || #aiController?.isThinking()` for a similar guard (line 1050).

### Pitfall 4: Hint Shows Floating Bubble Only (No Board Highlight) in Checkers
**What goes wrong:** The hint annotation shows "Suggested move" as a floating bubble with no element highlight. The checkers destination arg (`destination.toNotation`) is a nested object, not a plain string or number, so the default `DEST_ARGS` fallback in `#extractMoveTarget` returns `undefined`.
**Why it happens:** `GameDefinitionLike.ai.hintTargetFromMove` is undefined for checkers; the fallback checks `move.args.destination` which is an object.
**How to avoid:** Add `hintTargetFromMove` to checkers' `gameDefinition.ai` (Pattern 8 above). This is a cross-repo change in `~/BoardSmithGames/checkers`. Without it, hint still works — it just shows a floating bubble with no board highlight, which is less useful for a moving tutorial.

### Pitfall 5: Breaking Production showHintProp
**What goes wrong:** The `showHintProp` change accidentally makes the condition `state.hasAIPlayers` true in production even when no AI is playing, showing Teaching controls when they shouldn't be shown.
**Why it happens:** `SnapshotSessionHost` injects `hasAIPlayers` when `adapters.aiSeats?.length > 0`. In production, `GameSession` (not `SnapshotSessionHost`) runs — it never sets `hasAIPlayers`. So the flag can only appear from the dev host.
**How to avoid:** The OR condition in `showHintProp` is safe by construction — production doesn't go through `SnapshotSessionHost`, so `state.hasAIPlayers` will never be set in production. Still: add a unit test in `GameShell.test.ts` verifying `showHintProp === undefined` when both `lobbyInfo` and `state.hasAIPlayers` are absent.

### Pitfall 6: Transient State Leaking Across Seats
**What goes wrong:** Seat 1's hint annotation appears in seat 2's broadcast view.
**Why it happens:** `mergeTransientState` maps by `seat = i + 1` but incorrectly applies all transient state to all seats.
**How to avoid:** The seat-specific merge (`transientTeachingState.get(seat)`) is per-seat. `isDemoRunning` and `narrationText` are game-wide (all seats see them) — that is intentional and matches production. `hint` and `heatmap` are seat-specific. Keep the Map keyed by seat number.

### Pitfall 7: demoStart Returns Empty playerViews
**What goes wrong:** The `server_response` for `demo-start` carries `playerViews: []` (the host can't easily build views without running `executeOp`). If any caller reads `playerViews` from the op response, it will be empty.
**Why it happens:** `demoStart` is a lifecycle op handled directly in the host, not in `executeOp`; the host doesn't re-compute views for the response.
**How to avoid:** `shapeResult` for `'demo-start'` returns only `{ success, error }` — the client NEVER reads `playerViews` from the op response, only from `game_state` broadcasts. This matches the `start-tutorial` and `undo` pattern. Verify `shapeResult` case is minimal.

### Pitfall 8: aiSuggest Returns stateEnvelope (Double buildViews Cost)
**What goes wrong:** `handleAISuggest` calls `stateEnvelope(runner, playerCount)` which calls `buildViews` for all seats. This is unused by the demo loop (it ignores the playerViews). It's not wrong, just wasteful.
**Why it happens:** All ops currently return `stateEnvelope`. `aiSuggest` is read-only and its views are discarded.
**How to avoid:** Acceptable for Phase 110. Document as a potential optimization. The demo loop reads only `aiPlayer`, `suggestedAction`, `suggestedArgs` from the suggest result.

---

## Runtime State Inventory

SKIPPED — this is a greenfield wiring phase, not a rename/refactor/migration. No stored data, live service config, OS state, secrets, or build artifacts are renamed.

---

## Open Questions (RESOLVED)

1. **demoStart delay configurability**
   - What we know: `game-session.ts` default delay is 1200ms; `startDemo` accepts `options.delay`
   - What's unclear: Should the `demo-start` wire op accept a `delay` payload field? The CONTEXT says Claude's discretion on payloads.
   - Recommendation: Accept `delay?: number` in the `demo-start` payload and pass it through to `runDemoLoop`. Default to 1200. Tests use `delay: 0`.
   - **RESOLVED:** Accept `delay?: number` in the `demo-start` payload (default 1200ms); tests pass `delay: 0` for determinism. Implemented in the demo-start op + runDemoLoop.

2. **Narrator access to player names**
   - What we know: `game-session.ts:1142` uses `playerNames[player - 1] ?? `Player ${player}`` from `#storedState.playerNames`. `stateless-ops.ts` does not have player names in scope.
   - What's unclear: Should the narration say "Player 1: move..." or the actual player name?
   - Recommendation: Default to `"Player N: action args"` (no player names in the stateless path).
   - **RESOLVED:** Use `"Player N: <action> <args>"` in the dev-host narration (no player-name threading in the stateless path). Named narration is a future extension; not in this phase.

3. **heatmapToggle visible=false in dev host**
   - What we know: `game-session.ts:1041-1043` handles `visible=false` by immediately setting `{ visible: false, entries: [] }` without running the bot.
   - What's unclear: The `heatmapToggle` op in stateless-ops needs this branch.
   - Recommendation: In `handleHeatmapToggle`, if `!op.visible`, return `stateEnvelope + heatmapUpdate({ visible: false, entries: [] })` immediately (no bot call needed).
   - **RESOLVED:** `handleHeatmapToggle` short-circuits on `visible=false` — return `{ visible:false, entries:[] }` with no bot call; only `visible=true` runs `playWithStats()`. Mirrors the production path.

---

## Environment Availability

This phase is purely code changes with no new external services. The dev host (`boardsmith dev`) is already confirmed working for checkers + tutorial (Phase 109). The cross-repo change in `~/BoardSmithGames/checkers` uses the symlinked node_modules path (live HMR via Vite).

| Dependency | Required By | Available | Notes |
|------------|------------|-----------|-------|
| `npx boardsmith dev` | Demo script (Area 4) | ✓ | Confirmed working in Phase 109 |
| `~/BoardSmithGames/checkers` | Cross-repo `hintTargetFromMove` change | ✓ | Symlinked to `node_modules/boardsmith` |
| MCTS bot (`src/ai/mcts-bot.ts`) | hint/heatmap/demo | ✓ | Powers `--ai` mode already |

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest |
| Config file | `/Users/jtsmith/BoardSmith/vitest.config.ts` |
| Quick run command | `npm run test -- --reporter=dot` |
| Full suite command | `npm run test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DEMO-01 (wiring) | hint op → transient annotation → broadcast includes `state.hint` | unit | `npx vitest run src/session/snapshot-session-host.test.ts` | ✅ (file exists, add cases) |
| DEMO-01 (wiring) | heatmapToggle visible=true → broadcast includes `state.heatmap.visible=true` | unit | same | ✅ |
| DEMO-01 (wiring) | heatmapToggle visible=false → clears entries | unit | same | ✅ |
| DEMO-01 (wiring) | demo-start broadcasts `isDemoRunning=true`, demo-stop clears it | unit (fake timers) | `npx vitest run src/session/snapshot-session-host.test.ts` | ✅ add cases |
| DEMO-01 (wiring) | demo loop: narration broadcast before move, move executes after delay | unit (fake timers) | same | ✅ add cases |
| DEMO-01 (wiring) | demo-stop mid-loop: no leaked move after stop | unit (fake timers) | same | ✅ add cases |
| DEMO-01 (wiring) | hint clears on next action by same seat | unit | same | ✅ add cases |
| DEMO-01 (wiring) | undo clears all transient state | unit | same | ✅ add cases |
| DEMO-01 (wiring) | hasAIPlayers in every broadcast when aiSeats present | unit | same | ✅ add cases |
| DEMO-01 (wiring) | bridge.ts: hint/heatmap-toggle/demo-start/demo-stop translate correctly | unit | `npx vitest run src/cli/dev-host/bridge.test.ts` | ✅ add cases |
| DEMO-01 (demo) | End-to-end browser: Teaching group visible in dev host with --ai | manual | `cd ~/BoardSmithGames/checkers && npx boardsmith dev --ai 2` | N/A |
| DEMO-01 (demo) | End-to-end browser: hint shows board highlight | manual | same | N/A |
| DEMO-01 (demo) | End-to-end browser: heatmap shows overlay | manual | same | N/A |
| DEMO-01 (demo) | End-to-end browser: demo runs narrated moves + can stop | manual | same | N/A |
| DEMO-01 (parity) | Teaching controls work in AutoUI switcher | manual | same | N/A |

### Fake Timer Strategy for Demo Loop Tests

Vitest supports `vi.useFakeTimers()` and `vi.runAllTimersAsync()`. For the demo loop:

```typescript
import { vi, describe, it, expect, afterEach } from 'vitest';

afterEach(() => vi.useRealTimers());

it('demo loop: narration broadcast before move executes', async () => {
  vi.useFakeTimers();
  const host = new SnapshotSessionHost(adapters);
  await host.start();

  const demoStartPromise = host.handleOp(1, { type: 'demoStart', delay: 0 });

  // Advance timers to trigger the delay in the first loop iteration
  await vi.runAllTimersAsync();

  await demoStartPromise;  // ensure fire-and-forget loop has progressed
  // Assert broadcast sequence: first broadcast has isDemoRunning + narration,
  // second broadcast has new game state (move executed)
});

it('demo-stop cancels cleanly', async () => {
  vi.useFakeTimers();
  // start demo, then stop before advancing timers
  void host.handleOp(1, { type: 'demoStart', delay: 5000 });
  // stop BEFORE the 5-second delay fires
  await host.handleOp(1, { type: 'demoStop' });
  // no more broadcasts should happen after this
  const countBefore = broadcastLog.length;
  await vi.runAllTimersAsync();
  // Only the demoStop broadcast (isDemoRunning=false) should have fired
  expect(broadcastLog.length).toBe(countBefore + 1);  // +1 for the cleanup broadcast
});
```

**Key:** Pass `delay: 0` for most tests to avoid needing fake timers. Use fake timers only for cancellation tests where the delay is intentionally > 0.

### Wave 0 Gaps
- [ ] Add hint/heatmap/demo tests to `src/session/snapshot-session-host.test.ts` — needs an inline game that has a bot (e.g., with `objectives`). The simple `SimpleGame` has no bot and `createBot` would fail. A `BotGame` inline fixture with a trivial objective is needed.
- [ ] Add `hint`/`heatmap-toggle`/`demo-start`/`demo-stop` translateOp + shapeResult cases to `src/cli/dev-host/bridge.test.ts`.

---

## Security Domain

Teaching ops operate on game state only. They do not involve auth, session tokens, or sensitive user data. All ops go through the same `SnapshotSessionHost.handleOp` path that already validates seat membership. The `hint` op validates that the requesting seat is awaiting input (fail-loud). The demo loop uses ephemeral bots (no persistent AI state). ASVS categories V2/V3/V4/V6 are not applicable.

---

## Sources

### Primary (HIGH confidence — direct codebase inspection)
- `src/session/snapshot-session-host.ts` — full file read; `apply()`, `handleOp()`, `runAITurns()` shape
- `src/session/stateless-ops.ts` — Op union (line 31-61), OpResult (line 76-111), `handleAITurn` (line 430-484), `executeOp` switch (line 708-770), `buildViews` (line 146), `stateEnvelope` (line 167)
- `src/cli/dev-host/bridge.ts` — full file read; WireOp (line 22), `translateOp` (line 93), `shapeResult` (line 175), `createDevSession` (line 226)
- `src/cli/dev-host/multiplayer-host.ts` — `handleServerRequest` (line 307), `aiSeats` management (line 343-390)
- `src/cli/commands/dev.ts` — `gameDef` object (line 567), `executeOp` binding (line 586)
- `src/session/game-session.ts` — `#hint`/`#heatmap` Maps (lines 241-243), `broadcast` injection (lines 1921-1934), `requestHint` (line 951), `setHeatmapVisible` (line 1040), `startDemo` (line 1099), `stopDemo` (line 1171), `#extractMoveTarget` (line 922)
- `src/ui/components/GameShell.vue` — `showHintProp` (line 694), `handleTeachingAction` (line 717-762), `isDemoRunning` (line 687)
- `src/ui/components/ControlsMenu.vue` — Teaching group gate (line 265-266)
- `src/session/types.ts` — `HeatmapEntry` (line 389), `ElementRef` (line 247), `PlayerGameState` hint/heatmap/narration/isDemoRunning fields (lines 457-484), `GameDefinition.ai` (line 85)
- `src/session/utils.ts` — `buildPlayerState` (line 345), `hasTutorial` injection (line 452)
- `src/ai/types.ts` — `AIConfig` (line 129), `hintTargetFromMove` (line 201), `BotMoveStats` (line 55)
- `src/ai/mcts-bot.ts` — `playWithStats()` (line 110)
- `~/BoardSmithGames/checkers/src/rules/index.ts` — `gameDefinition` (no `hintTargetFromMove` present)
- `~/BoardSmithGames/checkers/src/rules/actions.ts` — `createMoveAction` (destination arg shape, line 120)
- `src/session/snapshot-session-host.test.ts` — test pattern (line 1-96), `vi` imported (line 1)
- `.planning/config.json` — `workflow.nyquist_validation` absent → validation architecture enabled

### Secondary (for context)
- `src/ai/index.ts` — `createBot`, `AIConfig`, `parseAILevel` exports
- `src/cli/dev-host/bridge.test.ts` — test fixture pattern (makeSession)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new deps; all pieces confirmed in codebase
- Architecture (transient state): HIGH — direct port from `GameSession.broadcast()` pattern, line numbers verified
- Demo loop design: HIGH — design is clearly constrained by existing patterns; the aiSuggest/action split is the only novel design decision, justified by non-determinism concern
- Pitfalls: HIGH — derived from code reading + production pattern comparison
- UI changes: HIGH — `showHintProp` change is a one-liner verified against GameShell source

**Research date:** 2026-06-29
**Valid until:** Stable — no fast-moving ecosystem dependencies. Valid until the codebase changes.
