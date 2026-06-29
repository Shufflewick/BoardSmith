# Phase 110: Demonstration & Refinement — Pattern Map

**Mapped:** 2026-06-29
**Files analyzed:** 8 (6 BoardSmith, 1 Checkers, plus 2 test files)
**Analogs found:** 8 / 8

---

## File Classification

| New/Modified File | Repo | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|------|-----------|----------------|---------------|
| `src/session/snapshot-session-host.ts` | BoardSmith | service/host | event-driven + broadcast | `src/session/game-session.ts` (broadcast injection, startDemo) | role-match |
| `src/session/stateless-ops.ts` | BoardSmith | service/executor | request-response (pure) | `src/session/stateless-ops.ts:430` (handleAITurn) + `:749` (startTutorial) | exact (self-extension) |
| `src/cli/dev-host/bridge.ts` | BoardSmith | middleware/translator | request-response | `src/cli/dev-host/bridge.ts:27,127,193` (start-tutorial pattern) | exact (self-extension) |
| `src/cli/commands/dev.ts` | BoardSmith | config/wiring | N/A | `src/cli/commands/dev.ts:567` (gameDef.tutorial wiring) | exact (self-extension) |
| `src/ui/components/GameShell.vue` | BoardSmith | component | event-driven | `src/ui/components/GameShell.vue:694` (showHintProp) | exact (self-modification) |
| `src/session/snapshot-session-host.test.ts` | BoardSmith | test | N/A | existing file + `src/cli/dev-host/bridge.test.ts` | exact (self-extension) |
| `src/cli/dev-host/bridge.test.ts` | BoardSmith | test | N/A | existing file | exact (self-extension) |
| `checkers/src/rules/index.ts` | Checkers | config | N/A | `checkers/src/rules/index.ts:17` (gameDefinition.ai) | exact (self-modification) |

---

## Pattern Assignments

### `src/session/snapshot-session-host.ts` (service, event-driven)

**Analog:** `src/session/game-session.ts` — private transient teaching Maps + broadcast injection
**Also analog:** `src/session/snapshot-session-host.ts` — existing `apply()`, `runAITurns()`, `aiPumpRunning` guard

#### Current file structure (lines 1–87) — full context needed:

```typescript
// snapshot-session-host.ts:1-23 — imports + SnapshotSessionAdapters shape
import type { Op, OpResult } from './stateless-ops.js';
import { READ_ONLY_OP_TYPES } from './stateless-ops.js';

export interface SnapshotSessionAdapters {
  playerCount: number;
  executeOp: (snapshot: unknown, pendingState: Record<string, unknown> | null, op: Op) => Promise<OpResult>;
  broadcast: (playerViews: unknown[], meta: { isComplete: boolean; winners: number[] }) => void;
  aiSeats?: Array<{ seat: number; level?: string }>;
  persist?: (state: { snapshot: unknown; pendingStates: Record<string, Record<string, unknown>> }) => void | Promise<void>;
}
```

#### Analog — `apply()` pattern (lines 26–37):
```typescript
private async apply(res: OpResult, seat?: number): Promise<void> {
  this.snapshot = res.snapshot;
  this.flowState = res.flowState;
  this.isComplete = res.isComplete;
  this.winners = res.winners;
  if (seat !== undefined) {
    if (res.pendingState) this.pendingStates.set(seat, res.pendingState);
    else this.pendingStates.delete(seat);
  }
  this.adapters.broadcast(res.playerViews, { isComplete: res.isComplete, winners: res.winners });
  await this.adapters.persist?.({ snapshot: this.snapshot, pendingStates: Object.fromEntries(this.pendingStates) });
}
```
**New `apply()` must:** cache `res.playerViews` into `this.lastPlayerViews` BEFORE broadcasting; call `mergeTransientState(res.playerViews)` and pass the merged result to `broadcast()`.

#### Analog — `runAITurns()` loop guard pattern (lines 67–86):
```typescript
async runAITurns(): Promise<void> {
  if (this.aiPumpRunning || !this.adapters.aiSeats?.length) return;
  this.aiPumpRunning = true;
  try {
    let moves = 0;
    while (true) {
      if (moves >= MAX_AI_MOVES) {
        console.error('[SnapshotSessionHost] AI pump hit MAX_AI_MOVES cap (500); stopping to avoid runaway.');
        break;
      }
      const res = await this.adapters.executeOp(this.snapshot, null, { type: 'aiTurn', seats: this.adapters.aiSeats });
      if (!res.success || !res.aiMoved) break;
      moves++;
      await this.apply(res);
      if (this.isComplete) break;
    }
  } finally {
    this.aiPumpRunning = false;
  }
}
```
**`runDemoLoop()` copies this guard shape:** `demoRunning` flag + `finally` cleanup, `MAX_DEMO_MOVES` cap, `demoAbort` checked before AND after the delay.

#### Analog — production broadcast injection (game-session.ts:1925–1934):
```typescript
// Production pattern for transient teaching state injection (AFTER buildPlayerState):
const hint = this.#hint.get(effectivePosition);
if (hint) state.hint = hint;
const heatmap = this.#heatmap.get(effectivePosition);
if (heatmap) state.heatmap = heatmap;
if (this.#narrationText) state.narration = { text: this.#narrationText };
if (this.#demoMode) state.isDemoRunning = true;
```
**`mergeTransientState()` replicates this:** per-seat `hint`/`heatmap` from Map; game-wide `narrationText`/`demoRunning`/`hasAIPlayers` applied to all seats.

#### Analog — production startDemo narration (game-session.ts:1142–1149):
```typescript
// Default narrator: "PlayerName: actionName key=val ..."
const name = playerNames[player - 1] ?? `Player ${player}`;
const argSummary = Object.entries(args)
  .map(([k, v]) => {
    if (v !== null && typeof v === 'object') return `${k}=${JSON.stringify(v)}`;
    return `${k}=${String(v)}`;
  })
  .join(' ');
text = argSummary ? `${name}: ${action} ${argSummary}` : `${name}: ${action}`;
```
**`buildNarration()` copies this verbatim** but uses `Player ${player}` (no player names in the stateless path).

#### Analog — handleOp current shape (lines 47–65):
```typescript
async handleOp(seat: number, op: Op): Promise<OpResult> {
  if (READ_ONLY_OP_TYPES.has(op.type)) {
    return this.adapters.executeOp(this.snapshot, this.pendingStates.get(seat) ?? null, op);
  }
  if (op.type === 'action') this.pendingStates.delete(seat);
  const res = await this.adapters.executeOp(this.snapshot, this.pendingStates.get(seat) ?? null, op);
  if (!res.success) return res;
  await this.apply(res, seat);
  if (!this.isComplete && (op.type === 'action' || (op.type === 'selectionStep' && res.actionComplete))) {
    await this.runAITurns();
  }
  return res;
}
```
**New `handleOp()` must prepend** demoStart/demoStop lifecycle handling, then hint/heatmapToggle transient-store handling, before falling through to this existing block. It must also clear transient state on `undo`/`debugRewind` and clear seat hint on successful `action`/`selectionStep`.

---

### `src/session/stateless-ops.ts` (service/executor, request-response)

**Analog:** `stateless-ops.ts:430–484` (`handleAITurn` — bot construction + `bot.play()`) and `:749–768` (`startTutorial` — guard + runner + `stateEnvelope`)

#### Bot construction pattern (lines 456–463):
```typescript
const bot = createBot(
  runner.game as Game,
  def.gameClass as GameRunnerOptions<never>['GameClass'],
  def.gameType,
  aiPlayer,
  runner.actionHistory,
  parseAILevel(seatLevel ?? 'medium'),
);
const move = await bot.play();
```
**`handleHint` and `handleAISuggest` copy this pattern.** Pass `def.ai` as the 7th arg to `createBot` so `hintTargetFromMove` is honoured.

#### Heatmap stats pattern (game-session.ts:1065–1027):
```typescript
const { stats } = await bot.playWithStats();
const entries = this.#buildHeatmapEntries(stats);
// #buildHeatmapEntries deduplicates by cell key, marks isBest on the highest-value entry:
const byCell = new Map<string, HeatmapEntry>();
for (const stat of stats) {
  const ref = this.#extractMoveTarget(stat.move);
  if (!ref) continue;
  const key = ref.id !== undefined ? `id:${ref.id}`
    : ref.notation !== undefined ? `notation:${ref.notation}`
    : `name:${ref.name}`;
  const existing = byCell.get(key);
  if (!existing || stat.value > existing.normalizedValue) {
    byCell.set(key, { cellRef: ref, normalizedValue: stat.value, isBest: false });
  }
}
const entries = [...byCell.values()];
if (entries.length > 0) {
  const best = entries.reduce((a, b) => a.normalizedValue > b.normalizedValue ? a : b);
  best.isBest = true;
}
```
**`handleHeatmapToggle` replicates this dedup logic** inline (no separate class method — stateless-ops is a module not a class).

#### startTutorial guard pattern (lines 749–768):
```typescript
case 'startTutorial': {
  if (!def.tutorial) {
    return errorResult('No tutorial definition on this game.', 'protocol');
  }
  if (op.player < 1 || op.player > gameOptions.playerCount) {
    return errorResult(
      `Invalid player seat ${op.player}: must be between 1 and ${gameOptions.playerCount}.`,
      'protocol',
    );
  }
  validateTutorialDefinition(def.tutorial);
  const runner = runnerFromSnapshot(snap, def);
  // ... mutate + return stateEnvelope
  return { success: true, ...stateEnvelope(runner, gameOptions.playerCount) };
}
```
**`handleHint`/`handleHeatmapToggle`/`handleAISuggest` follow this guard-first pattern** — validate seat, validate ai config available, then construct runner.

#### Op union extension pattern (lines 30–61):
```typescript
// Each new Op variant added to the union:
| { type: 'hint'; seat: number }
| { type: 'heatmapToggle'; seat: number; visible: boolean }
| { type: 'aiSuggest'; seats: Array<{ seat: number; level?: string }> }
// demoStart / demoStop are NOT added here — handled in SnapshotSessionHost.handleOp directly
```

#### GameDefinitionLike extension (lines 117–128):
```typescript
export interface GameDefinitionLike {
  gameClass: new (...args: unknown[]) => unknown;
  gameType: string;
  minPlayers: number;
  maxPlayers: number;
  tutorial?: TutorialDefinition;
  // ADD: ai config for hintTargetFromMove + heatmap target extraction
  ai?: import('../ai/types.js').AIConfig;
}
```

#### OpResult extension (lines 76–111) — add after existing fields:
```typescript
// Transient teaching annotation results — consumed by SnapshotSessionHost transientTeachingState
hintAnnotation?: { seat: number; annotation: Annotation };
heatmapUpdate?: { seat: number; visible: boolean; entries: HeatmapEntry[] };
// aiSuggest result — consumed by demo loop (NOT the full stateEnvelope playerViews)
suggestedAction?: string;
suggestedArgs?: Record<string, unknown>;
// aiPlayer already present in existing OpResult (line 90: aiPlayer?: number)
```

#### READ_ONLY_OP_TYPES set (lines 64–70):
```typescript
export const READ_ONLY_OP_TYPES: ReadonlySet<Op['type']> = new Set([
  'resolveChoices',
  'debugHistory',
  'debugStateAt',
  'debugStateDiff',
  'debugActionTraces',
  // ADD: 'aiSuggest' — read-only, no state mutation
]);
```

---

### `src/cli/dev-host/bridge.ts` (middleware/translator, request-response)

**Analog:** `bridge.ts:22–38` (WireOp union), `:93–168` (translateOp), `:175–216` (shapeResult)

#### WireOp union extension (lines 22–38):
```typescript
export type WireOp =
  | 'action'
  | 'resolve_choices'
  | 'selection_step'
  | 'cancel_action'
  | 'undo'
  | 'start-tutorial'
  // ADD teaching ops:
  | 'hint'
  | 'heatmap-toggle'
  | 'demo-start'
  | 'demo-stop'
  | 'debug:history'
  // ... rest unchanged
```

#### translateOp case pattern (lines 127–128 — start-tutorial template):
```typescript
case 'start-tutorial':
  return { type: 'startTutorial', player: seat };
```
**New cases following the same shape:**
```typescript
case 'hint':
  return { type: 'hint', seat: (payload.seat as number) ?? seat };
case 'heatmap-toggle':
  return { type: 'heatmapToggle', seat: (payload.seat as number) ?? seat, visible: payload.visible as boolean };
case 'demo-start':
  return { type: 'demoStart', delay: payload.delay as number | undefined };
case 'demo-stop':
  return { type: 'demoStop' };
```

#### shapeResult case pattern (lines 192–193 — start-tutorial template):
```typescript
case 'start-tutorial':
  return { success: result.success, error: result.error };
```
**New cases following the same shape:**
```typescript
case 'hint':
case 'heatmap-toggle':
case 'demo-start':
case 'demo-stop':
  return { success: result.success, error: result.error };
```

---

### `src/cli/commands/dev.ts` (config/wiring, N/A)

**Analog:** `dev.ts:567–576` (gameDef object construction — tutorial threading)

#### Current gameDef construction (lines 567–576):
```typescript
const gameDef = {
  gameClass: gameDefinition.gameClass as new (...args: unknown[]) => unknown,
  gameType: gameDefinition.gameType,
  minPlayers,
  maxPlayers,
  tutorial: gameDefinition.tutorial,
};
```
**Add `ai` field** following the same pattern as `tutorial`:
```typescript
const gameDef = {
  gameClass: gameDefinition.gameClass as new (...args: unknown[]) => unknown,
  gameType: gameDefinition.gameType,
  minPlayers,
  maxPlayers,
  tutorial: gameDefinition.tutorial,
  ai: gameDefinition.ai,  // ADD: threads AIConfig (hintTargetFromMove) into stateless executor
};
```

---

### `src/ui/components/GameShell.vue` (component, event-driven)

**Analog:** `GameShell.vue:694` (showHintProp computed), `:687–689` (isDemoRunning computed pattern)

#### Current showHintProp (line 694):
```typescript
const showHintProp = computed<boolean | undefined>(() =>
  lobbyInfo.value?.slots?.some(s => s.aiLevel != null) ? true : undefined
);
```

#### isDemoRunning pattern as a model for state field access (lines 687–689):
```typescript
const isDemoRunning = computed(
  () => (state.value?.state as any)?.isDemoRunning ?? false
);
```

**Modified showHintProp** — add dev-host broadcast signal as OR condition:
```typescript
const showHintProp = computed<boolean | undefined>(() => {
  // Production lobby path — unchanged
  if (lobbyInfo.value?.slots?.some(s => s.aiLevel != null)) return true;
  // Dev-host path: SnapshotSessionHost injects hasAIPlayers into broadcast state
  if ((state.value?.state as any)?.hasAIPlayers) return true;
  return undefined;
});
```
Note: production `GameSession` never sets `hasAIPlayers`, so this OR condition is safe by construction (Pitfall 5 in RESEARCH.md).

---

### `src/session/snapshot-session-host.test.ts` (test, N/A)

**Analog:** `snapshot-session-host.test.ts:1–92` — existing game fixtures + makeAdapters + broadcastLog pattern

#### Fixture pattern to extend (lines 79–92):
```typescript
function makeAdapters(
  def: GameDefinitionLike,
  opts: { playerCount: number; seed?: string },
  extra: Partial<SnapshotSessionAdapters> = {},
): { adapters: SnapshotSessionAdapters; broadcastLog: unknown[][] } {
  const broadcastLog: unknown[][] = [];
  const adapters: SnapshotSessionAdapters = {
    playerCount: opts.playerCount,
    executeOp: (snap, pend, op) => executeOp(def, opts, snap, pend, op),
    broadcast: (views, meta) => broadcastLog.push([views, meta]),
    ...extra,
  };
  return { adapters, broadcastLog };
}
```
**New tests need a `BotGame` fixture** (replacing `SimpleGame` for hint/heatmap/demo tests) — `SimpleGame` has no `objectives` so `createBot` would fail. The `BotGame` fixture needs: an `objectives` function returning a trivial evaluator, at least 2+ legal moves (so MCTS has a choice), and an `ai` config in the `GameDefinitionLike`.

#### Fake timer pattern from RESEARCH.md (for demo loop tests):
```typescript
import { vi, describe, it, expect, afterEach } from 'vitest';
afterEach(() => vi.useRealTimers());

it('demo loop: narration broadcast before move executes', async () => {
  vi.useFakeTimers();
  // Pass delay: 0 for most tests — avoids fake timer complexity
  void host.handleOp(1, { type: 'demoStart', delay: 0 });
  await vi.runAllTimersAsync();
  // Assert broadcastLog sequence
});
```

---

### `src/cli/dev-host/bridge.test.ts` (test, N/A)

**Analog:** `bridge.test.ts:51–78` (translateOp test pattern)

#### translateOp test pattern (lines 53–77):
```typescript
it('maps wire ops (snake_case) to the host Op union with the acting seat', () => {
  expect(translateOp('action', 3, { actionName: 'pass', args: { x: 1 } })).toEqual({
    type: 'action', actionName: 'pass', player: 3, args: { x: 1 },
  });
  expect(translateOp('start-tutorial', 1, {})).toEqual({ type: 'startTutorial', player: 1 });
  expect(translateOp('bogus', 1, {})).toBeUndefined();
});
```
**New assertions follow this inline toEqual/toMatchObject style:**
```typescript
expect(translateOp('hint', 2, { seat: 2 })).toEqual({ type: 'hint', seat: 2 });
expect(translateOp('heatmap-toggle', 1, { seat: 1, visible: true })).toEqual({
  type: 'heatmapToggle', seat: 1, visible: true,
});
expect(translateOp('demo-start', 1, { delay: 0 })).toEqual({ type: 'demoStart', delay: 0 });
expect(translateOp('demo-stop', 1, {})).toEqual({ type: 'demoStop' });
```

#### makeSession fixture (lines 39–48):
```typescript
function makeSession() {
  const posted: Posted[] = [];
  const session = createDevSession({
    playerCount: 2,
    executeOp: (snap, pend, op) =>
      executeOp(simpleGameDef, op.type === 'start' ? gameOptions : { playerCount: 2 }, snap, pend, op),
    postGameState: (seat) => posted.push({ kind: 'game_state', seat }),
    postServerResponse: (seat) => posted.push({ kind: 'server_response', seat }),
  });
  return { session, posted };
}
```
**shapeResult tests for new ops check** `{ success: true/false, error: undefined/string }` only (no playerViews — matching shapeResult case for start-tutorial/undo).

---

### `~/BoardSmithGames/checkers/src/rules/index.ts` (config, N/A)

**Repo:** BoardSmithGames/checkers
**Analog:** `checkers/src/rules/index.ts:17–47` (gameDefinition structure), `checkers/src/rules/actions.ts:119–155` (destination arg shape)

#### Current gameDefinition.ai (lines 17–47):
```typescript
export const gameDefinition = {
  gameClass: CheckersGame,
  gameType: 'checkers',
  displayName: 'Checkers',
  minPlayers: 2,
  maxPlayers: 2,
  ai: {
    objectives: getCheckersObjectives,
    // No hintTargetFromMove — hint shows floating bubble but no board highlight
  },
  // ...
};
```

#### destination arg shape from actions.ts (lines 39–41, 128–131):
```typescript
// CheckersMove destination object shape:
{
  pieceId: number;     // id of the piece being moved
  fromNotation: string; // source square notation
  toNotation: string;   // destination square notation — this is the hint target
}
```

**`hintTargetFromMove` addition** — resolves Pitfall 4 from RESEARCH.md:
```typescript
ai: {
  objectives: getCheckersObjectives,
  hintTargetFromMove: (move) => {
    const dest = move.args.destination as { toNotation?: string } | undefined;
    return dest?.toNotation ? { notation: dest.toNotation } : undefined;
  },
},
```
This makes hint highlight the destination square on the board rather than showing a floating bubble with no target.

---

## Shared Patterns

### Bot Construction
**Source:** `src/session/stateless-ops.ts:456–463` (`handleAITurn`)
**Apply to:** `handleHint`, `handleHeatmapToggle`, `handleAISuggest` in stateless-ops.ts

```typescript
const bot = createBot(
  runner.game as Game,
  def.gameClass as GameRunnerOptions<never>['GameClass'],
  def.gameType,
  seat,                          // acting seat number
  runner.actionHistory,
  parseAILevel(level ?? 'medium'),
  def.ai,                        // NEW: pass AIConfig for hintTargetFromMove
);
```
Note: `def.ai` is the new 7th argument — not present in `handleAITurn` today. Must be added to `GameDefinitionLike` first.

### Fail-Fast Guard (proto error)
**Source:** `src/session/stateless-ops.ts:749–758` (`startTutorial` guard pattern)
**Apply to:** All new op handlers — validate seat range and AI availability before any expensive work.

```typescript
if (!def.ai?.objectives) {
  return errorResult('No AI configuration on this game — hint is unavailable.', 'protocol');
}
if (op.seat < 1 || op.seat > gameOptions.playerCount) {
  return errorResult(
    `Invalid seat ${op.seat}: must be between 1 and ${gameOptions.playerCount}.`,
    'protocol',
  );
}
```

### canSeatAct Validation
**Source:** `src/session/stateless-ops.ts:13` (import), used in `handleAITurn` flowState check `:446–448`
**Apply to:** `handleHint` — must verify seat is currently awaiting input before running MCTS.

```typescript
import { canSeatAct } from '../engine/index.js'; // already imported

// In handleHint:
if (!canSeatAct(flowState as FlowState, op.seat)) {
  return errorResult(`Cannot hint: seat ${op.seat} is not awaiting input`, 'protocol');
}
```

### stateEnvelope Return
**Source:** `src/session/stateless-ops.ts:167–184` (`stateEnvelope` helper)
**Apply to:** All new state-mutating op handlers — return `{ success: true, ...stateEnvelope(runner, playerCount), extraFields }`.
**Note:** `hint` and `heatmapToggle` DO return `stateEnvelope` (for consistency) even though they don't change game state. The snapshot is unchanged but `stateEnvelope` is cheap to compute and simplifies the OpResult contract.

### Transient State Clear on Undo
**Source:** `src/session/game-session.ts:312–313`
**Apply to:** `SnapshotSessionHost.handleOp` — on `undo`/`debugRewind` success:

```typescript
// Production pattern:
this.#hint.clear();
this.#heatmap.clear();

// SnapshotSessionHost equivalent:
this.transientTeachingState.clear();
this.narrationText = null;
```

### Broadcast-Before-Response Ordering
**Source:** `src/cli/dev-host/bridge.ts:259–264` (handleServerRequest) — broadcast fires inside `host.handleOp` before it resolves, so `game_state` always arrives before `server_response`.
**Apply to:** All new ops — this ordering is preserved automatically by the existing `SnapshotSessionHost.handleOp` → `apply()` → `adapters.broadcast()` chain. No special handling needed for the three-file wire pattern.

---

## No Analog Found

All files have close analogs. No greenfield patterns needed.

---

## Metadata

**Analog search scope:** `src/session/`, `src/cli/dev-host/`, `src/cli/commands/`, `src/ui/components/`, `~/BoardSmithGames/checkers/src/rules/`
**Files scanned:** 10 source files + 2 test files
**Key constraint:** `demoStart`/`demoStop` are NOT added to the stateless `executeOp` switch — they are lifecycle ops handled directly in `SnapshotSessionHost.handleOp` (they need access to the host's async loop and broadcast adapter, which executeOp cannot access). Only `hint`, `heatmapToggle`, and `aiSuggest` go through `executeOp`.
**Pattern extraction date:** 2026-06-29
