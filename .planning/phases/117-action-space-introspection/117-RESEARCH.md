# Phase 117: Action-Space Introspection - Research

**Researched:** 2026-06-30
**Domain:** BoardSmith engine / session / ai — action introspection surface, enumeration extraction, type exports
**Confidence:** HIGH (all claims verified against live `src/` with file:line evidence)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

All API-surface decisions are locked in the approved design doc (`.planning/v4.3-API-DESIGN.md`). Phase 117 implements that contract exactly.

- **INTRO-01**: BUILD `game.getActionSpace(seat): ActionSpaceView` — wraps `availableActionsForSeat()` → `game.getPlayer()` → `buildActionMetadata()` → enrich with `argTemplate`. No `evaluateCondition()` call directly (no parallel validator).
- **INTRO-02**: EXPOSE `buildSingleActionMetadata` (already exported); add `ActionMetadata` type export to session barrel; add thin `game.getActionSchema(actionName, seat)` convenience method on Game.
- **INTRO-03**: BUILD `buildActionArgs(actionName, selectionValues, game, seat, options?)` in new file `src/engine/utils/arg-builder.ts`. Default in-process (element objects); `{ format: 'wire' }` opt-in produces `{ __elementRef }`/`{ __elementId }`.
- **INTRO-04**: EXTRACT enumeration core from `MCTSBot` private methods into `src/engine/utils/enumerate-moves.ts`. Do NOT duplicate. MCTSBot delegates to the extracted functions.
- **INTRO-05**: DOCUMENT existing `createPlayerView()` / `runner.getPlayerView()` / `testGame.getPlayerView()`. No new code.
- **INTRO-F1**: EXPOSE-ONLY — add `ElementDiff` type export to `src/session/index.ts`. (`UndoResult` is already exported.) No new implementation.

### Claude's Discretion

- Test structure and exact assertion wording.
- Internal refactor mechanics when extracting enumeration logic (INTRO-04), as long as the MCTS bot keeps passing and no behavior changes.
- Wave/plan decomposition.

### Deferred Ideas (OUT OF SCOPE)

- Test-ergonomics wrappers (`playUntilComplete`, ActionBuilder) — Phase 118.
- Devtools global / DOM signals / `data-*` selectors — Phase 119.
- `AgentRunner` (INTRO-F2), hidden-info leak assertion (TEST-F1) — per design doc Part 3.
- Game migration onto these APIs — Phase 121.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INTRO-01 | Single method for all legal actions with schemas and arg templates | `availableActionsForSeat` + `buildActionMetadata` primitives confirmed; new `ActionSpaceView`/`ActionSchemaView` interfaces to create |
| INTRO-02 | Single action schema retrieval without execution | `buildSingleActionMetadata` confirmed exported; `ActionMetadata` not in session barrel → must add |
| INTRO-03 | Build validated wire-correct action args from plain values | `serializeValue` confirmed in engine; new `arg-builder.ts` file to create |
| INTRO-04 | Enumerate all concrete legal moves | Bot private methods confirmed; extraction to `enumerate-moves.ts` with bot delegation |
| INTRO-05 | Typed perspective-aware state view | All four entry points confirmed existing; document only |
| INTRO-F1 | Checkpoint/rewind type exports | `UndoResult` already exported; `ElementDiff` not in barrel → add 1 line; `ActionMetadata` needs barrel add for INTRO-02 |
</phase_requirements>

---

## Summary

Phase 117 builds the keystone action-space introspection surface that all subsequent v4.3 phases depend on. Research confirms the design doc's verdicts exactly: four of six deliverables are pure expose/enrich operations over primitives that already exist; two require new files (`arg-builder.ts`, `enumerate-moves.ts`). The scope is narrower than it might appear — there is no new condition evaluation, no new action resolution logic, and no new serializer.

The single most complex task is INTRO-04: extracting the enumeration core from `MCTSBot`'s private methods. This requires care not to break the three AI tests that run in vitest (`mcts-stats`, `mcts-restore`, `mcts-clone-options`). The recommended extraction approach keeps the bot's seeded-RNG sampling logic entirely inside the bot and extracts only the pure combinatorics helpers.

The one discrepancy from the design doc: `UndoResult` is **already** exported from `src/session/index.ts` (line 114). The doc says to add both `UndoResult` and `ElementDiff`, but only `ElementDiff` is actually missing. The planner must emit a single-line `ElementDiff` addition, not two.

**Primary recommendation:** Implement in dependency order — INTRO-05 doc first (zero-risk), then INTRO-01/INTRO-02 type exports + method stubs, then INTRO-03 arg-builder, then INTRO-04 extraction (highest risk, touches MCTSBot), then INTRO-F1 barrel additions.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `getActionSpace` / `getActionSchema` (INTRO-01/02) | Engine (`game.ts`) | Session (metadata builders) | Actions are defined on the Game; session utilities do the metadata work |
| `buildActionArgs` (INTRO-03) | Engine (`utils/arg-builder.ts`) | — | Uses engine-public `serializeValue`; no session dependency needed |
| `enumerateLegalMoves` (INTRO-04) | Engine (`utils/enumerate-moves.ts`) | — | Pure game-engine operation; uses game-public APIs only |
| Perspective-aware state (INTRO-05) | Engine/Runtime | Testing | `createPlayerView` + `runner.getPlayerView` already at correct tier |
| Type exports (INTRO-F1) | Session barrel (`index.ts`) | — | `ElementDiff` defined in `state-history.ts`; barrel add only |

---

## Standard Stack

No new packages. Phase 117 uses only existing BoardSmith module internals. No `npm install` required.

---

## Package Legitimacy Audit

Not applicable — no external packages are installed in this phase.

---

## Architecture Patterns

### Recommended Project Structure (new files)

```
src/
├── engine/
│   ├── element/
│   │   └── game.ts              # add getActionSpace(), getActionSchema() methods
│   └── utils/
│       ├── arg-builder.ts       # NEW — buildActionArgs()
│       └── enumerate-moves.ts   # NEW — enumerateLegalMoves() + extracted helpers
└── session/
    └── index.ts                 # add ActionMetadata + ElementDiff to export block
```

### System Architecture Diagram

```
caller
  │
  ▼
game.getActionSpace(seat)                  [engine/element/game.ts — new method]
  │
  ├─► availableActionsForSeat(flowState, seat)   [engine/flow/seat-activity.ts:69]
  │         returns string[]
  │
  ├─► game.getPlayer(seat)                        [engine/element/game.ts:1749]
  │         returns Player | undefined
  │
  ├─► buildActionMetadata(game, player, names)    [session/utils.ts:35]
  │         returns Record<string, ActionMetadata>
  │              ↳ iterates selections → buildPickMetadata() → PickMetadata[]
  │              ↳ re-checks condition via evaluateCondition() (internal only)
  │
  └─► enrich each ActionMetadata with argTemplate  [new inline logic on game.ts]
            optional selection → null
            required selection → { __required: true }
            returns ActionSpaceView


enumerateLegalMoves(game, seat, options?)   [engine/utils/enumerate-moves.ts — new]
  │
  ├─► availableActionsForSeat(flowState, seat)
  ├─► game.getPlayer(seat)
  ├─► game.getAction(name)
  └─► enumerateSelectionsCore(game, actionDef, player, maxPerAction?)
            └─► game.getSelectionChoices(actionName, selName, player, args)
            └─► pure combinatorics helpers (no RNG dependency)
            └─► returns element objects (in-process, not serialized)


MCTSBot private methods                    [ai/mcts-bot.ts — modified to delegate]
  ├─► enumerateSelectionsInternal() → calls enumerateSelectionsCore() [shared]
  └─► sampleChoices() [stays in bot — uses this.rng, bot-specific]
```

### Pattern: INTRO-04 Extraction (Critical Path)

**What:** Move the pure enumeration combinatorics out of `MCTSBot` and into a standalone engine utility. The bot keeps its seeded-RNG sampling; the shared utility defaults to full enumeration.

**The three private MCTSBot methods to extract:**

| Bot private method | Lives at | Extract to |
|---|---|---|
| `enumerateSelectionsInternal(game, actionDef, player, noSampling)` | mcts-bot.ts:924 | `enumerateSelectionsCore(game, actionDef, player, options?)` in enumerate-moves.ts |
| `parseMultiSelect(multiSelect)` | mcts-bot.ts:1016 | `parseMultiSelect(multiSelect)` utility in enumerate-moves.ts |
| `generateCombinations(choices, min, max, selection)` | mcts-bot.ts:1028 | `generateCombinations(choices, min, max)` in enumerate-moves.ts |
| `combinationsOfSize(choices, size, current, startIndex, results, selection)` | mcts-bot.ts:1057 | `combinationsOfSize(choices, size, current, startIndex, results)` in enumerate-moves.ts |

**What stays in MCTSBot (bot-specific, do not extract):**

- `getChoicesForSelection` → replace with direct `game.getSelectionChoices()` call + filter
- `sampleChoices(choices, maxCount)` → uses `this.rng.nextInt()` (seeded RNG); stays in bot
- `sampleMovesWithPreserved(...)` → threat-response bot logic; stays in bot
- `serializeArgs(args, selections)` → bot-specific wire format; stays in bot

**Bot delegation pattern:**

```typescript
// BEFORE (bot's private method):
private enumerateSelectionsInternal(game, actionDef, player, noSampling): Record<string, unknown>[] {
  return this.enumerateSelectionsRecursive(game, actionDef, player, 0, {}, noSampling);
}

// AFTER (delegates to shared utility):
private enumerateSelectionsInternal(game, actionDef, player, noSampling): Record<string, unknown>[] {
  // noSampling=true -> full enumeration (shared utility default)
  // noSampling=false -> bot applies its own sampling AFTER the fact
  const moves = enumerateSelectionsCore(game, actionDef, player);
  if (noSampling) return moves;
  // apply bot's rng-based sampling here, or pass sampleFn as option
  return moves.length > 20 ? this.sampleChoices(moves, 20) : moves;
}
```

Source: `[VERIFIED: src/ai/mcts-bot.ts:924-1011]`

**Key invariant: bot args are serialized (IDs), public API args are in-process (objects).**

The bot calls `serializeArgs` at the end of recursion (mcts-bot.ts:951: `return [this.serializeArgs(currentArgs, actionDef.selections)]`). The extracted `enumerateSelectionsCore` must NOT call `serializeArgs` — it returns element objects. The bot's calling code applies `serializeArgs` to the results of `enumerateSelectionsCore`. This is the main structural change from the current recursive implementation.

```typescript
// Source: [VERIFIED: src/ai/mcts-bot.ts:949-951]
if (index >= actionDef.selections.length) {
  // Serialize element objects to IDs only at the end
  return [this.serializeArgs(currentArgs, actionDef.selections)];
}
```

In the extracted function, this terminal case returns `[currentArgs]` (no serialization). The bot wrapper serializes after calling the shared function.

### Pattern: INTRO-03 `buildActionArgs` Implementation

**Wire format reference** (`src/engine/utils/serializer.ts:9`):
```typescript
// [VERIFIED: src/engine/utils/serializer.ts:9]
export type SerializedReference =
  | { __elementRef: string }   // element by branch path
  | { __elementId: number }    // element by ID
  | { __playerRef: number };   // player by seat
```

**`serializeValue` signature** (`src/engine/utils/serializer.ts:27`):
```typescript
// [VERIFIED: src/engine/utils/serializer.ts:27]
export function serializeValue(
  value: unknown,
  game: Game,
  options: SerializeOptions = {}
): unknown
// options.useBranchPaths: boolean — branch paths vs IDs (default: IDs)
```

**`buildActionArgs` should:**
1. Accept `selectionValues: Record<string, unknown>` (plain JS: element objects, strings, numbers)
2. For `'in-process'` format (default): return values as-is (runner.performAction accepts element objects)
3. For `'wire'` format: call `serializeValue(value, game, { useBranchPaths: false })` on each arg value
4. Validate: error if a selection name in `selectionValues` is not a recognized selection for `actionName`

**`runner.performAction` accepts both Player and seat number:**
```typescript
// [VERIFIED: src/runtime/runner.ts:128-135]
performAction(
  actionName: string,
  player: Player | number,   // accepts either Player object OR seat number
  args: Record<string, unknown>
): ActionExecutionResult
```

This means in-process `buildActionArgs` can return element-object args and pass them directly to `runner.performAction`. No `serializeValue` needed for the in-process path.

### Anti-Patterns to Avoid

- **Calling `evaluateCondition()` directly from introspection code.** `getActionSpace` delegates to `buildActionMetadata` which handles condition evaluation internally. Any PR that calls `evaluateCondition` directly from `getActionSpace` is a red flag.
- **Duplicating enumeration logic.** `enumerateLegalMoves` MUST call the extracted helpers. Any copy-paste of the recursive selection logic is a red flag.
- **Serializing args in the extracted enumeration core.** `enumerateSelectionsCore` returns in-process element objects. The bot serializes separately. Mixing these paths breaks the in-process API.
- **Accessing `game._actions` in `arg-builder.ts`.** `getActionSpace` and `getActionSchema` access `_actions` via the bridge through `buildActionMetadata`. `buildActionArgs` should use `game.getAction(name)` (public) to get `ActionDefinition` for validation.
- **Modifying `anchorAttrs()`.** Not in scope for Phase 117 — that is Phase 119. Do not touch `useBoardInteraction.ts`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Action availability | New condition evaluator | `availableActionsForSeat()` + `buildActionMetadata()` | Already battle-tested; parallel validators cause drift |
| Move enumeration | New recursive enumerator | Extract from `MCTSBot.enumerateSelectionsInternal` | Handles dependsOn, multiSelect, optional, recursive combos — full coverage |
| Element serialization | Custom `toId()` helper | `serializeValue(value, game)` from `src/engine/utils/serializer.ts` | Already handles Player, GameElement, branch paths vs IDs |
| Perspective-aware state | New JSON filter | `createPlayerView(game, seat)` / `runner.getPlayerView(seat)` | Hidden info filtering already correct; raw `game.toJSON()` is a leak |
| Checkpoint/undo | New snapshot system | `GameSession.rewindToAction()` etc. | All five methods public on GameSession; INTRO-F1 only adds type exports |

---

## Research Findings by Target

### Target 1: INTRO-01 Implementation Chain

**`availableActionsForSeat` — confirmed signature:**
```typescript
// [VERIFIED: src/engine/flow/seat-activity.ts:69]
export function availableActionsForSeat(
  flowState: SeatActivityState | undefined | null,
  seat: number,
): string[]
// Exported from engine barrel at src/engine/index.ts:175
```

**`buildActionMetadata` — confirmed signature:**
```typescript
// [VERIFIED: src/session/utils.ts:35]
export function buildActionMetadata(
  game: Game,
  player: Player,
  availableActionNames: string[]
): Record<string, ActionMetadata>
// Exported from session barrel at src/session/index.ts:91
```

`buildActionMetadata` internally calls `evaluateCondition` (session/utils.ts:57) to re-check each action's condition. This is correct. `getActionSpace` must NOT duplicate this check — it delegates entirely to `buildActionMetadata`.

**`game.getPlayer` — confirmed signature:**
```typescript
// [VERIFIED: src/engine/element/game.ts:1749]
getPlayer(seat: number): P | undefined
// Returns the Player at that seat (1-indexed), or undefined if not found
```

**`ActionMetadata` — confirmed location and export gap:**
```typescript
// [VERIFIED: src/session/types.ts:356]
export interface ActionMetadata {
  name: string;
  prompt?: string;
  help?: string;         // "Display-only; never a predicate"
  selections: PickMetadata[];
}
// NOT currently in src/session/index.ts export block — must add
```

**`PickMetadata` — confirmed exported:**
```typescript
// [VERIFIED: src/session/index.ts:76]
// PickMetadata IS in the export type block: line 76
// Includes: name, type, prompt, optional, choices?, validElements?,
//           dependsOn?, choicesByDependentValue?, elementsByDependentValue?,
//           repeat?, multiSelect?, multiSelectByDependentValue?, hasOnSelect?
```

**New types to create — `ActionSpaceView` / `ActionSchemaView`:**
These types do not exist anywhere in `src/` yet. Per the design doc, they go on `Game` in `src/engine/element/game.ts` and are exported from the engine barrel (`src/engine/index.ts`). No separate `engine/types.ts` file is needed — the pattern in this codebase is to define and export interfaces from the module they belong to, with barrel re-exports.

**`getActionSpace` implementation constraint (INTRO-01):**
```typescript
// New method on Game<P, B> in src/engine/element/game.ts
getActionSpace(seat: number): ActionSpaceView {
  const flowState = this.getFlowState();
  const actionNames = availableActionsForSeat(flowState, seat);
  const player = this.getPlayer(seat);
  if (!player) return { actions: [] };
  const metadata = buildActionMetadata(this, player, actionNames);
  // enrich: convert each ActionMetadata → ActionSchemaView with argTemplate
  return { actions: Object.values(metadata).map(m => toSchemaView(m)) };
}
```

---

### Target 2: INTRO-02 Export Status

**`buildSingleActionMetadata` — confirmed exported:**
```typescript
// [VERIFIED: src/session/index.ts:134]
export { buildSingleActionMetadata } from './utils.js';
// Signature at src/session/utils.ts:91:
export function buildSingleActionMetadata(
  game: Game,
  player: Player,
  actionName: string,
  knownArgs?: Record<string, unknown>
): ActionMetadata | undefined
// Does NOT check action condition (followUp bypass design)
```

**`ActionMetadata` export gap — exact change needed:**

In `src/session/index.ts`, the `export type { ... }` block starting at line 38 exports from `./types.js`. `ActionMetadata` is defined in `types.ts:356` but not in this block. Add it:

```typescript
// src/session/index.ts — add ActionMetadata to export type block (line 76 area):
export type {
  // ... existing exports ...
  PickMetadata,          // already present
  PickFilter,            // already present
  PickChoicesResponse,   // already present
  PickTrace,             // already present
  ActionMetadata,        // ADD THIS
} from './types.js';
```

**`game.getSelectionChoices` — confirmed signature:**
```typescript
// [VERIFIED: src/engine/element/game.ts:934]
getSelectionChoices(
  actionName: string,
  selectionName: string,
  player: P,
  args: Record<string, unknown> = {}
): AnnotatedChoice<unknown>[]
// AnnotatedChoice<T> = { value: T; display: string; disabled: boolean; ... }
```

The `getActionSchema(actionName, seat)` convenience method on Game resolves `Player` from seat and delegates to `buildSingleActionMetadata`. It requires importing `buildSingleActionMetadata` from `src/session/utils.ts` into `src/engine/element/game.ts`. This is an upward dependency (engine importing session utility). The design doc calls for this thin bridge — verify there is no existing circular dependency concern before implementing.

---

### Target 3: INTRO-03 Wire Format and Arg-Builder

**Wire format definitions:**
```typescript
// [VERIFIED: src/engine/utils/serializer.ts:9]
export type SerializedReference =
  | { __elementRef: string }   // branch path (useBranchPaths: true)
  | { __elementId: number }    // element ID (default)
  | { __playerRef: number };   // player seat index
```

**`runner.performAction` accepts both Player and seat number:**
```typescript
// [VERIFIED: src/runtime/runner.ts:128]
performAction(
  actionName: string,
  player: Player | number,   // overloaded: Player object OR seat number
  args: Record<string, unknown>
): ActionExecutionResult
```

**Important:** For in-process use, pass element objects directly in args — `runner.performAction` handles them correctly without pre-serialization. Wire format is only required for cross-process WebSocket transmission.

**`buildActionArgs` validation scope:**
The function should validate that each key in `selectionValues` corresponds to a known selection name for the action (prevents silent arg typos). Use `game.getAction(actionName)` (public, `game.ts:875`) to retrieve the `ActionDefinition` and check `actionDef.selections.map(s => s.name)`.

**Bot's internal element-ID extraction pattern (for reference, NOT for copying):**
```typescript
// [VERIFIED: src/ai/mcts-bot.ts:1099-1107]
// Bot uses _t.id directly — this is internal API; use serializeValue() instead:
private serializeChoice(choice: unknown, selection: Selection): unknown {
  if (selection.type === 'element') {
    return (choice as { _t: { id: number } })._t.id;   // accesses internal _t
  }
  if (selection.type === 'elements') {
    return (choice as { id: number }).id;               // accesses id directly
  }
  return choice;
}
// buildActionArgs should use serializeValue() from the engine — do not copy this pattern
```

---

### Target 4: INTRO-04 MCTSBot Enumeration Structure

**Confirmed method hierarchy (all private):**

```
MCTSBot.enumerateMoves(game, flowState)          :818 — calls Internal(noSampling=false)
MCTSBot.enumerateAllMoves(game, flowState)        :826 — calls Internal(noSampling=true)
MCTSBot.enumerateMovesInternal(game, fs, ns)      :833 — resolves player, iterates actions
MCTSBot.enumerateSelectionsInternal(game, def, p, ns) :924 — delegates to Recursive
MCTSBot.enumerateSelectionsRecursive(...)         :941 — the actual recursion
MCTSBot.getChoicesForSelection(game, name, sel, p, args) :1082 — calls game.getSelectionChoices()
MCTSBot.parseMultiSelect(multiSelect)             :1016 — pure utility
MCTSBot.generateCombinations(choices, min, max, sel) :1028 — pure utility
MCTSBot.combinationsOfSize(choices, size, ...)    :1057 — pure utility
MCTSBot.sampleChoices(choices, maxCount)          :1141 — uses this.rng (bot-specific)
MCTSBot.serializeArgs(args, selections)           :1115 — converts objects to IDs (bot-specific)
```

**Critical recursive structure detail:**

```typescript
// [VERIFIED: src/ai/mcts-bot.ts:949-951]
// Terminal case: index >= selections.length
return [this.serializeArgs(currentArgs, actionDef.selections)];
// The bot serializes at the terminal case — extracted function must NOT do this
```

The extracted `enumerateSelectionsCore` changes the terminal case to `return [{ ...currentArgs }]` (plain copy, no serialization). MCTSBot then applies `serializeArgs` to the results after calling the shared function.

**`getChoicesForSelection` → direct `game.getSelectionChoices()` call:**
```typescript
// [VERIFIED: src/ai/mcts-bot.ts:1082-1093]
private getChoicesForSelection(game, actionName, selection, player, currentArgs): unknown[] {
  const annotated = game.getSelectionChoices(actionName, selection.name, player as any, currentArgs);
  return annotated.filter(c => c.disabled === false).map(c => c.value);
}
```
This is a thin wrapper. The extracted utility inlines this logic or calls `game.getSelectionChoices()` directly. No reason to keep `getChoicesForSelection` as a separate method in the extracted utility.

**AI tests that ARE in vitest (must stay green after extraction):**

| Test file | What it covers |
|---|---|
| `src/ai/mcts-stats.test.ts` | MCTS search quality/statistics |
| `src/ai/mcts-restore.test.ts` | Bot restore/clone from snapshot |
| `src/ai/mcts-clone-options.test.ts` | Bot clone with 3+ choices (memory note) |

**AI tests EXCLUDED from vitest** (cannot run in vitest, no concern):
- `src/ai/mcts-bot.test.ts`, `mcts-cache.test.ts`, `mcts-stats-checkers.test.ts`, `cribbage-bot.test.ts`

**Memory note:** `src/ai/mcts-bot.test.ts` is excluded from vitest per MEMORY.md. New AI-related tests go in separate files (like `mcts-restore.test.ts`).

**Extraction safety rule:** The three in-vitest AI tests above test bot behavior end-to-end. After extraction, if they still pass, the bot behavior is preserved. Run `npx vitest run src/ai/` after the extraction to verify.

---

### Target 5: INTRO-05 Hidden-Info Mechanism

**All four entry points confirmed (no code changes needed):**

```typescript
// [VERIFIED: src/engine/utils/snapshot.ts:194]
export function createPlayerView(game: Game, playerPosition: number): PlayerStateView

// [VERIFIED: src/runtime/runner.ts:281]
getPlayerView(playerPosition: number): PlayerStateView
// delegates to createPlayerView(this.game, playerPosition)

// [VERIFIED: src/runtime/runner.ts:288]
getAllPlayerViews(): PlayerStateView[]

// [VERIFIED: src/testing/test-game.ts:243]
getPlayerView(seat: number): PlayerStateView
// delegates to runner.getPlayerView(seat)
```

**Hidden-info exclusion mechanism:**
`createPlayerView` calls `game.toJSONForPlayer(playerPosition)` (`game.ts:2375`) which traverses the element tree and applies per-element visibility rules (set via `SetVisibilityCommand`). Elements not visible to the player are omitted or obscured in the JSON output. This is the single filtering path — any caller that bypasses `createPlayerView` and uses `game.toJSON()` directly will receive all elements including hidden ones (a data leak).

**Existing leak test:**
```
src/engine/element/image-leak.test.ts    [VERIFIED: file exists]
src/engine/element/deck-hand-visibility.test.ts  [VERIFIED: file exists]
```

**Security requirement:** Any new perspective-aware surface in this phase (e.g., arg introspection that exposes element info) MUST use `createPlayerView` or `runner.getPlayerView` — never raw `game.toJSON()`.

**`PlayerStateView` shape** (for integration test authors):
```typescript
// [VERIFIED: src/engine/utils/snapshot.ts:97]
interface PlayerStateView {
  player: number;
  state: ElementJSON;           // hidden elements filtered via toJSONForPlayer()
  flowState?: { awaitingInput: boolean; isMyTurn: boolean; availableActions?: string[] };
  messages: Array<{ text: string; data?: Record<string, unknown> }>;
  phase: string;
  complete: boolean;
  winners?: number[];
  actionMetadata?: Record<string, unknown>;
  tutorial?: TutorialStepView;
  disabledActions?: Record<string, string>;
}
```

---

### Target 6: INTRO-F1 Export Status

**`UndoResult` — already in session barrel (no action needed):**
```typescript
// [VERIFIED: src/session/index.ts:112-115]
export {
  GameSession,
  type GameSessionOptions,
  type ActionResult,
  type UndoResult,          // ALREADY EXPORTED
} from './game-session.js';
```

**`ElementDiff` — NOT in session barrel (must add):**
```typescript
// [VERIFIED: src/session/state-history.ts:43]
export interface ElementDiff {
  added: number[];
  removed: number[];
  changed: number[];
  fromIndex: number;
  toIndex: number;
}
// game-session.ts re-exports it at line 142:
// export type { UndoResult, ElementDiff } from './state-history.js';
// But session/index.ts does NOT pick it up — ElementDiff missing from barrel
```

**Exact change to `src/session/index.ts`:**
```typescript
// Add alongside UndoResult at line 112-115:
export {
  GameSession,
  type GameSessionOptions,
  type ActionResult,
  type UndoResult,
  type ElementDiff,          // ADD THIS LINE
} from './game-session.js';
```

**Five `GameSession` methods confirmed public (no code changes needed):**

| Method | Line in state-history.ts | Delegated on GameSession at |
|---|---|---|
| `getStateAtAction(actionIndex, playerPosition)` | 110 | game-session.ts:897 |
| `getStateDiff(fromIndex, toIndex, playerPosition)` | 152 | game-session.ts:905 |
| `getActionTraces(playerPosition)` | 202 | game-session.ts:917 |
| `undoToTurnStart(playerPosition)` | 255 | game-session.ts:1712 |
| `rewindToAction(targetActionIndex)` | 337 | game-session.ts:1726 |

---

### Target 7: Circular Dependency Check — Game importing Session

The `getActionSchema(actionName, seat)` convenience method on `Game` requires importing `buildSingleActionMetadata` from `src/session/utils.ts`. The engine barrel currently imports nothing from session. This creates an engine→session import.

However, `src/session/utils.ts` already imports from `src/engine/index.ts` (line 5 of utils.ts: `import { Player, evaluateCondition, canSeatAct, availableActionsForSeat, ... } from '../engine/index.js'`). Adding an engine→session import for `buildSingleActionMetadata` would create a **circular dependency**: engine ↔ session.

**Resolution (design doc calls for the method; this is the correct implementation path):**

Option A (preferred): Do NOT import `buildSingleActionMetadata` into `game.ts`. Instead, implement `getActionSchema` by directly calling `buildActionMetadata` with a single-item actions array, or inline a minimal version that calls `this.getAction(name)` and constructs the metadata from the action definition. This avoids the circular dependency.

Option B: Inject `buildSingleActionMetadata` as a parameter to `getActionSchema` at call time (dependency injection). Too complex for a thin convenience method.

Option C: Move `buildSingleActionMetadata` to the engine layer (extract from session/utils.ts). The function only uses engine types (`Game`, `Player`, `ActionDefinition`, `Selection`). This is the cleanest but requires the planner to decide scope.

**Recommendation for planner:** Use Option A. Inline `getActionSchema` on `Game` to iterate `this.getAction(name).selections` and build `PickMetadata` via the same logic as `buildPickMetadata` in session/utils.ts — or more simply, delegate to `buildActionMetadata(this, player, [actionName])` and extract the single entry. This avoids the circular dependency entirely while satisfying the design doc's intent.

**Mark as Open Question RESOLVED below.**

---

## Common Pitfalls

### Pitfall 1: Creating a Circular Dependency (engine ↔ session)
**What goes wrong:** `game.getActionSchema` imports `buildSingleActionMetadata` from session/utils.ts, while session/utils.ts already imports from engine.
**Why it happens:** The design doc says "thin bridge" without noting the circular dependency risk.
**How to avoid:** Implement `getActionSchema` using `buildActionMetadata(this, player, [actionName])` (already accessible) and extract the single result, OR inline the logic using `this.getAction(name)` + a local `buildPickMetadata`. Do not import from session into engine.
**Warning signs:** TypeScript compilation error about circular imports, or `vite` bundler warning about cycles.

### Pitfall 2: Serializing Args Inside `enumerateSelectionsCore`
**What goes wrong:** The extracted function calls `serializeArgs` (converting element objects to IDs) before returning, matching the bot's current behavior.
**Why it happens:** The current bot code serializes at the recursive terminal case (`return [this.serializeArgs(...)]`). A naive copy-paste extraction preserves this.
**How to avoid:** The extracted function returns raw element objects. The bot's calling wrapper applies `serializeArgs` after calling the shared function.
**Warning signs:** `enumerateLegalMoves` returns `{ element_selection: 42 }` (a number ID) instead of `{ element_selection: <GameElement object> }`.

### Pitfall 3: `UndoResult` Already Exported — Don't Double-Export
**What goes wrong:** The planner adds `UndoResult` to session/index.ts again, causing a TypeScript re-export error.
**Why it happens:** The design doc says "add `UndoResult` and `ElementDiff`" but `UndoResult` is already there.
**How to avoid:** Research confirms `UndoResult` is at session/index.ts:114 — only `ElementDiff` is missing.
**Warning signs:** TypeScript error "Identifier 'UndoResult' has already been declared."

### Pitfall 4: Bot Sampling Uses Seeded RNG — Don't Replicate It
**What goes wrong:** The extracted `enumerateLegalMoves` tries to replicate the bot's `sampleChoices(choices, 20)` behavior using `Math.random()`, producing different results than the bot for the same game state.
**Why it happens:** The bot samples to limit branching. The public API default is full enumeration.
**How to avoid:** `enumerateLegalMoves` defaults to full enumeration (no sampling). Only apply `maxPerAction` truncation when the caller opts in. The bot continues to apply its own seeded RNG sampling on the results it gets from the shared utility.

---

## Existing Test Coverage

| Area | Test File | What's Covered |
|---|---|---|
| `availableActionsForSeat` | `src/session/seat-activity-canonical.test.ts` | Sequential and simultaneous step seat activity |
| `buildActionMetadata` | `src/session/action-help-propagation.test.ts` | Action metadata building |
| `createPlayerView` / `PlayerStateView` | `src/engine/utils/snapshot.test.ts` | Snapshot and player view creation |
| Hidden-info filtering | `src/engine/element/image-leak.test.ts` | `$images.face` visibility leak |
| Hidden-info visibility | `src/engine/element/deck-hand-visibility.test.ts` | Card hand visibility rules |
| Build player state | `src/session/build-player-state.test.ts` | `PlayerStateView` construction |
| `getStateDiff` / `ElementDiff` | `src/session/compute-element-diff.test.ts` | Element diff between states |
| `rewindToAction` / `getStateAtAction` | `src/session/testing/stateful-timetravel-authoritative.test.ts` | Time travel |
| `undoToTurnStart` | `src/session/testing/stateful-undo-authoritative.test.ts` | Undo |
| MCTS bot (in vitest) | `src/ai/mcts-stats.test.ts`, `mcts-restore.test.ts`, `mcts-clone-options.test.ts` | Bot behavior — must stay green |
| Runner API | `src/runtime/runner.test.ts` | `performAction`, `getPlayerView` |

---

## Validation Architecture

### Test Framework

| Property | Value |
|---|---|
| Framework | Vitest |
| Config file | `vitest.config.ts` (project root) |
| Quick run command | `npx vitest run src/engine/ src/session/ src/ai/ --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|---|---|---|---|---|
| INTRO-01 | `getActionSpace(seat)` returns correct action names and arg templates | integration | `npx vitest run src/engine/element/get-action-space.test.ts` | ❌ Wave 0 |
| INTRO-01 | `argTemplate` has `null` for optional, `{ __required: true }` for required | unit | included in above | ❌ Wave 0 |
| INTRO-02 | `getActionSchema(name, seat)` returns `ActionMetadata` with correct selections | integration | `npx vitest run src/engine/element/get-action-space.test.ts` | ❌ Wave 0 |
| INTRO-02 | `ActionMetadata` exported from session barrel (compile check) | type/unit | `npx tsc --noEmit` | ✅ (tsc already runs) |
| INTRO-03 | `buildActionArgs` in-process returns element objects | unit | `npx vitest run src/engine/utils/arg-builder.test.ts` | ❌ Wave 0 |
| INTRO-03 | `buildActionArgs` wire format returns `{ __elementId }` | unit | included in above | ❌ Wave 0 |
| INTRO-04 | `enumerateLegalMoves` returns same moves as MCTSBot for identical game state | parity/integration | `npx vitest run src/engine/utils/enumerate-moves.test.ts` | ❌ Wave 0 |
| INTRO-04 | MCTSBot in-vitest tests still pass after extraction | regression | `npx vitest run src/ai/mcts-stats.test.ts src/ai/mcts-restore.test.ts src/ai/mcts-clone-options.test.ts` | ✅ |
| INTRO-05 | Hidden-info element absent from opponent's `getActionSpace` result | leak regression | `npx vitest run src/engine/element/image-leak.test.ts` (extend) | ✅ (extend) |
| INTRO-F1 | `ElementDiff` importable from session barrel (compile check) | type/unit | `npx tsc --noEmit` | ✅ (tsc already runs) |

### Cross-Layer Boundary Integration Tests (CLAUDE.md requirement)

CLAUDE.md requires at least one integration test per cross-layer boundary a change touches. Phase 117 touches three boundaries:

1. **Engine → Session** (`getActionSpace` calls `buildActionMetadata`): test that a real `Game` instance with registered actions returns a correct `ActionSpaceView` through the full chain. File: `src/engine/element/get-action-space.test.ts`.

2. **Engine → AI** (INTRO-04 extraction: `enumerateLegalMoves` replaces bot private methods): test that `enumerateLegalMoves(game, seat)` returns the identical set of `{ action, args }` pairs as the pre-extraction `MCTSBot.enumerateAllMoves`. Use the same game state and verify result set equality. File: `src/engine/utils/enumerate-moves.test.ts`.

3. **Session barrel → consumers** (INTRO-F1 + INTRO-02 type exports): `import { ElementDiff, ActionMetadata } from 'boardsmith/session'` compiles without error. This is validated by `npx tsc --noEmit`. No new test file needed.

### INTRO-05 Hidden-Info Leak Regression Test (Security-Critical)

The existing `src/engine/element/image-leak.test.ts` covers the primary leak path. For Phase 117, add one new test case to this file (or a companion file):

**Test:** Create a game with a hidden element (e.g., a card in an opponent's hand with visibility restricted). Call `game.getActionSpace(opponentSeat)` from seat 1. Verify that no element ID from the hidden-element's family appears in the `validElements` arrays of the returned `ActionSchemaView.selections`. This guards against `buildActionMetadata` inadvertently leaking hidden element IDs through `PickMetadata.validElements`.

### INTRO-04 Parity Test (Bot Regression)

**Test:** Create a Checkers-like game (or any game with ≥2 moves available — per MEMORY.md, MCTS cloning tests need multiple moves). Start a game. Capture the result of `enumerateLegalMoves(game, seat)` (new function). Capture the result of `MCTSBot.enumerateAllMoves` (after making it temporarily accessible or wrapping for test). Assert the two sets are identical after sorting. This guarantees extraction preserved correctness.

**Alternative (simpler):** Since the in-vitest AI tests run the bot against known game states, their continued passing after extraction provides sufficient parity evidence. The explicit parity test is belt-and-suspenders.

### Sampling Rate

- **Per task commit:** `npx vitest run src/engine/ --reporter=verbose`
- **Per wave merge:** `npx vitest run src/engine/ src/session/ src/ai/ src/runtime/`
- **Phase gate:** `npx vitest run` (full suite green before `/gsd:verify-work`)

### Wave 0 Gaps

- [ ] `src/engine/element/get-action-space.test.ts` — covers INTRO-01 + INTRO-02 (engine layer integration)
- [ ] `src/engine/utils/arg-builder.test.ts` — covers INTRO-03 (in-process + wire format)
- [ ] `src/engine/utils/enumerate-moves.test.ts` — covers INTRO-04 (parity with bot + full enumeration)
- [ ] Extend `src/engine/element/image-leak.test.ts` — new test case for hidden-info in `getActionSpace`

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---|---|---|
| V5 Input Validation | yes | `buildActionArgs` validates selection names against action definition |
| V4 Access Control | yes | `getActionSpace(seat)` only returns actions for that seat; must not leak other seats' actions |

### Known Threat Patterns

| Pattern | Risk | Mitigation |
|---|---|---|
| Hidden-info leak via `getActionSpace` | `PickMetadata.validElements` could expose hidden element IDs | `buildActionMetadata` calls `toJSONForPlayer` filtering; verify the element-pick validation respects visibility |
| Cross-seat action leak | `getActionSpace(seat=1)` must not return actions belonging to seat=2 | `availableActionsForSeat` scopes by seat; `buildActionMetadata` evaluates per-player conditions |
| Wire-format arg injection | `buildActionArgs(format:'wire')` output passed to untrusted consumers | Out of scope for Phase 117 (server-side use only) |

---

## Open Questions (ALL RESOLVED)

### OQ-1: Circular dependency — engine importing session
**What we know:** `game.getActionSchema` needs `buildSingleActionMetadata` from session/utils.ts, but session already imports from engine.
**What was unclear:** Does the design doc expect us to create a circular import?
**RESOLVED:** Do NOT import session into engine. Implement `getActionSchema` using the already-accessible `buildActionMetadata(this, player, [actionName])` (which is called from session context but returns a plain `Record<string, ActionMetadata>`). Since `buildActionMetadata` is imported at the game method call site through the module system, this creates a runtime dependency but can be handled with a lazy import pattern OR by having `getActionSchema` be a standalone exported function in session (not a method on Game). **Recommended:** The planner should verify the import graph at implementation time. If circular, use a free function in session rather than a method on Game, or inline the logic using `this.getAction(name)` and `this.getSelectionChoices`.

### OQ-2: Where to define `ActionSpaceView` / `ActionSchemaView`
**RESOLVED:** Define in `src/engine/element/game.ts` (same file as the method), and export from `src/engine/index.ts` engine barrel. This follows the established pattern for `PlayerStateView` (defined in `snapshot.ts`, exported via engine barrel).

### OQ-3: Bot's `serializeArgs` post-extraction
**RESOLVED:** `enumerateSelectionsCore` returns element objects (no serialization). MCTSBot applies `serializeArgs` to the results before using them for tree search. The bot's `sampleChoices` applies before the serialization step. Bot behavior is preserved.

### OQ-4: `UndoResult` already exported
**RESOLVED:** Confirmed by direct `src/session/index.ts` inspection. `UndoResult` is at line 114. The planner adds only `ElementDiff` (1 line). The design doc description of "add `UndoResult` and `ElementDiff`" was slightly incorrect — only `ElementDiff` is missing.

---

## Environment Availability

Step 2.6: SKIPPED — Phase 117 is pure source code changes. No external services, databases, or CLI tools beyond the existing Node.js/TypeScript/Vitest toolchain.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|---|---|---|
| A1 | `game.getActionSchema` can be implemented without creating engine→session circular dependency using `buildActionMetadata` delegation | Target 2, Pitfall 1 | If circular dependency can't be avoided, the method must be a session-layer free function instead of a method on `Game` — slight API shape change |
| A2 | The three in-vitest AI tests (`mcts-stats`, `mcts-restore`, `mcts-clone-options`) fully exercise the bot's enumeration path | Target 4 Validation | If they don't exercise enumeration, a bot regression could go undetected — add an explicit parity test |

---

## Sources

### Primary (HIGH confidence — all verified against live src/)

- `src/engine/flow/seat-activity.ts:69` — `availableActionsForSeat` signature
- `src/session/utils.ts:35,91` — `buildActionMetadata`, `buildSingleActionMetadata` signatures
- `src/session/types.ts:356,293` — `ActionMetadata`, `PickMetadata` definitions
- `src/session/index.ts:38-143` — full session barrel export inventory
- `src/engine/element/game.ts:1749,934,875,952` — `getPlayer`, `getSelectionChoices`, `getAction`, `performAction`
- `src/engine/index.ts:1-250` — engine barrel export inventory
- `src/engine/utils/serializer.ts:9,27` — wire format types, `serializeValue`
- `src/runtime/runner.ts:128,281,288` — `performAction`, `getPlayerView`, `getAllPlayerViews`
- `src/ai/mcts-bot.ts:779-1156` — full enumeration method hierarchy
- `src/session/state-history.ts:1-55` — `UndoResult`, `ElementDiff` definitions, `StateHistory` class
- `src/engine/element/image-leak.test.ts` — confirmed existence of leak regression test
- `vitest.config.ts` — confirmed which AI tests are excluded

### Secondary (MEDIUM confidence)

- Design doc `.planning/v4.3-API-DESIGN.md` — API contract (approved 2026-06-30); spot-checked citations match live src/

---

## Metadata

**Confidence breakdown:**
- Exact file:line citations: HIGH — all verified by direct reads in this session
- INTRO-04 extraction approach: HIGH — code structure fully read and understood
- Circular dependency concern (A1): MEDIUM — exists by inspection but resolution strategy is sound
- INTRO-F1 export state: HIGH — confirmed `UndoResult` present, `ElementDiff` absent

**Research date:** 2026-06-30
**Valid until:** 2026-07-30
