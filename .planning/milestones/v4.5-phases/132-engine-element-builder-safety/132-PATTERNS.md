# Phase 132: Engine Element & Builder Safety - Pattern Map

**Mapped:** 2026-07-03
**Files analyzed:** 4 source files modified + 4 test files (insertion points, no new files)
**Analogs found:** 4 / 4 (all in-repo, all in the same file/sibling function as the fix — this phase has no cross-module analog gap)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `src/engine/element/piece.ts` (`moveToInternal`) | model / tree-mutation | event-driven (mutation chokepoint) | same file: WR-03 detached-destination ancestor-walk (Phase 131), lines 82-104 | exact — same function, same idiom, sibling guard block |
| `src/engine/action/action.ts` (`resolveArgs` 2nd pass) | service / request-response | request-response (arg normalization) | same file: `resolveArgs` 1st pass `choice` case (isSerializedElement usage), lines 210-217 | exact — same function, same helper, narrower scope |
| `src/engine/flow/engine.ts` (`executeForEach`) | service / flow-state-machine | event-driven (loop step executor) | same file: `executeEachPlayer`'s `eligibleSeats` snapshot, lines 1089-1149 | exact — CONTEXT explicitly mandates mirroring this pattern |
| `src/engine/action/action-builder.ts` (constructor default + `build()`) | builder / config | request-response (definition construction) | same file: existing `undoable?: boolean` flag style on `ActionDefinition` (types.ts:451-454) | role-match — precedent for adding a new optional boolean field to `ActionDefinition` |
| `src/engine/element/game.ts` (`registerAction`) | service / validation gate | request-response (registration-time guard) | same file: `#validateActionReachability` (~game.ts:1616-1655) + PIT-02 element-class check (~game.ts:1660-1697) in `startFlow()` | partial — same file, same "throw actionable error at a validation chokepoint" idiom, but different timing (registration-time vs. flow-start-time); do not literally reuse their call site |
| Red-first tests: `piece.ts`/`game-element.ts` ENG-01 | test | N/A | `src/engine/element/game-element.test.ts` `describe('Piece Movement', ...)` (line 270) | exact — existing describe block for `putInto()` behavior |
| Red-first tests: ENG-05 | test | N/A | `src/engine/action/action.test.ts` `describe('executeAction', ...)` (line 447) | exact — existing describe block exercising `resolveArgs` via `executeAction` |
| Red-first tests: ENG-06 | test | N/A | `src/engine/flow/engine.test.ts` `describe('ForEach Execution', ...)` (line 384) | exact — existing describe block, two non-mutating cases already present |
| Red-first tests: ENG-08 | test | N/A | `src/engine/element/game.test.ts` `describe('PIT-02', ...)` / `describe('PIT-03', ...)` (lines 234, 301) | exact — same file's existing pattern for "constructing a Game subclass with a bad registration throws a named error", e.g. `toThrowError(/registerActions/)` at line 309 |

## Pattern Assignments

### `src/engine/element/piece.ts` — ENG-01 (`moveToInternal` self/descendant throw)

**Analog:** same function, WR-03 block immediately above the insertion point (Phase 131, `piece.ts:81-104`).

**Current imports** (`piece.ts:1-8`):
```typescript
import { GameElement } from './game-element.js';
import { Space } from './space.js';
import type { ElementClass, ElementAttributes, ElementContext } from './types.js';
import type { Player } from '../player/player.js';
import type { Game } from './game.js';
import type { VisibilityMode } from '../command/visibility.js';
import { visibilityFromMode } from '../command/visibility.js';
import { devWarn, isDevMode } from '../../utils/dev.js';
```
No new imports needed — `Error` is a global; the ancestor-walk idiom reuses only `GameElement`'s `_t.parent`, already imported.

**WR-03 idiom to mirror (the ancestor-walk shape), `piece.ts:81-104`:**
```typescript
moveToInternal(destination: GameElement, position?: 'first' | 'last'): void {
  // WR-03 (phase 131), DEV-only: detect a move into a DETACHED tree. ...
  if (isDevMode()) {
    for (let el: GameElement = destination; el._t.parent; el = el._t.parent) {
      if (!el._t.parent._t.children.includes(el)) {
        devWarn(
          `detached-destination:${destination.name ?? destination.constructor.name}`,
          `putInto() destination "${destination.name ?? destination.constructor.name}" is detached ` +
          `from the live element tree — the moved element will NOT appear in the serialized game. ...`
        );
        break;
      }
    }
  }

  const oldParent = this._t.parent;
  // ... mutation begins here (line 106) ...
```

**Insertion point for the new ENG-01 throw:** immediately BEFORE the `if (isDevMode())` block (i.e., as the very first statement of `moveToInternal`, before line 82), so it fails before doing the more expensive dev-only diagnostic walk, and runs in ALL modes (not gated by `isDevMode()`), per CONTEXT/RESEARCH decision. Do NOT merge it into the WR-03 `if (isDevMode())` block — that block only `devWarn`s and only runs in dev; this new check must `throw` unconditionally.

**Ancestor-walk idiom to adapt (RESEARCH-provided, walk direction reversed vs. WR-03 — walk `destination` up checking against `this`, not checking each ancestor's own detachment):**
```typescript
for (let el: GameElement = destination; el._t.parent; el = el._t.parent) {
  if (el === this || destination === this) {
    throw new Error(`Cannot move ${this.name ?? this.constructor.name} into its own descendant ${destination.name ?? destination.constructor.name}`);
  }
}
```
Note: this loop as written won't check the case where `destination` itself (with no parent, i.e. root) equals `this` unless checked before/outside the loop — verify the loop entry also covers `destination === this` before the first iteration (RESEARCH's snippet OR's it inside the loop body but the loop condition `el._t.parent` requires `destination` to have a parent to enter at all; add an explicit `destination === this` pre-check to be safe for root-destination edge case).

**Error handling pattern reference:** `console.error('[BoardSmith] 🚨 TREE CORRUPTION ...')` at `piece.ts:116-122` shows the project's actionable-message style (names the element, names the id, describes consequence) — use as tone/wording reference even though that one only logs (doesn't throw); ENG-01's message must both name both elements AND state the fix, per CONTEXT.

---

### `src/engine/action/action.ts` — ENG-05 (`resolveArgs` second-pass tightening)

**Analog:** same function's `choice` case in the first pass (`action.ts:210-217`), which already uses the stricter `isSerializedElement` helper — the exact helper the second pass must switch to.

**Imports** — no changes; `isSerializedElement` (private method, `action.ts:278-282`) and `looksLikeSerializedElement` (private method, `action.ts:269-273`) are both already defined in this class; no new imports.

**Current second pass to narrow (`action.ts:239-259`):**
```typescript
// Second pass: resolve non-selection args that look like element references
// This handles followUp args like { sectorId: { id: 145, name: 'Silver Industry' } }
for (const [key, value] of Object.entries(args)) {
  if (selectionNames.has(key)) continue; // Already processed above
  if (value === undefined) continue;

  // Resolve numeric IDs
  if (typeof value === 'number') {
    const element = this.game.getElementById(value);
    if (element) {
      resolved[key] = element;
    }
  }
  // Resolve serialized element objects (from followUp args)
  else if (this.looksLikeSerializedElement(value)) {
    const element = this.game.getElementById((value as { id: number }).id);
    if (element) {
      resolved[key] = element;
    }
  }
}
```

**Target shape (delete bare-number branch, swap helper):**
```typescript
for (const [key, value] of Object.entries(args)) {
  if (selectionNames.has(key)) continue; // Already processed above
  if (value === undefined) continue;

  // Resolve serialized element objects (from followUp args) — bare numbers are
  // NEVER coerced here; only {id, className}-shaped objects are unambiguous.
  if (this.isSerializedElement(value)) {
    const element = this.game.getElementById((value as { id: number }).id);
    if (element) {
      resolved[key] = element;
    }
  }
}
```

**Helper analog already present, do not duplicate (`action.ts:275-282`):**
```typescript
private isSerializedElement(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.id === 'number' && typeof obj.className === 'string';
}
```

**Pitfall guard:** do NOT touch the first pass (`action.ts:161-237`, `element`/`elements`/`choice` selection cases) — those intentionally keep the looser `looksLikeSerializedElement`/bare-number resolution. Scope the diff to lines 239-259 only.

---

### `src/engine/flow/engine.ts` — ENG-06 (`executeForEach` snapshot-on-entry)

**Analog:** `executeEachPlayer` in the same file, immediately above (`engine.ts:1089-1149`), which already implements the exact "snapshot once into `frame.data`, guarded by `frame.data?.X === undefined`, re-derive live object per iteration" pattern CONTEXT mandates mirroring.

**Full analog method (`engine.ts:1089-1149`):**
```typescript
private executeEachPlayer(
  frame: ExecutionFrame,
  config: EachPlayerConfig,
  context: FlowContext
): FlowStepResult {
  // Build eligible seat list once so turn order is deterministic, then re-check
  // filter dynamically each iteration so mid-round state changes are respected.
  if (frame.data?.eligibleSeats === undefined) {
    let players = [...this.game.all(Player as any)] as Player[];

    if (config.filter) {
      players = players.filter((p) => config.filter!(p, context));
    }

    if (config.direction === 'backward') {
      players.reverse();
    }

    let startIndex = 0;
    if (config.startingPlayer) {
      const startPlayer = config.startingPlayer(context);
      const foundIndex = players.findIndex((p) => p.seat === startPlayer.seat);
      startIndex = foundIndex >= 0 ? foundIndex : 0;
    }

    frame.data = {
      ...frame.data,
      eligibleSeats: players.slice(startIndex).map(p => p.seat),
      nextIndex: 0,
    };
  }

  const eligibleSeats = (frame.data.eligibleSeats as number[]) ?? [];
  let nextIndex = (frame.data.nextIndex as number) ?? 0;

  while (nextIndex < eligibleSeats.length) {
    const seat = eligibleSeats[nextIndex];
    nextIndex++;
    const player = this.game.getPlayer(seat);
    if (!player) continue;
    if (config.filter && !config.filter(player, this.createContext())) continue;

    this.currentPlayer = player;
    this.variables[config.name ?? 'currentPlayer'] = this.currentPlayer;

    this.stack.push({ node: config.do, index: 0, completed: false });
    frame.data = { ...frame.data, nextIndex };
    frame.index++;
    return { continue: true, awaitingInput: false };
  }

  frame.completed = true;
  return { continue: true, awaitingInput: false };
}
```

**Current `executeForEach` to replace (`engine.ts:1151-1176`):**
```typescript
private executeForEach(
  frame: ExecutionFrame,
  config: ForEachConfig,
  context: FlowContext
): FlowStepResult {
  // Get items to iterate
  const items = typeof config.collection === 'function'
    ? config.collection(context)
    : config.collection;

  const itemIndex = (frame.data?.itemIndex as number) ?? 0;

  if (itemIndex >= items.length) {
    frame.completed = true;
    return { continue: true, awaitingInput: false };
  }

  // Set current item variable
  this.variables[config.as] = items[itemIndex];

  this.stack.push({ node: config.do, index: 0, completed: false });
  frame.data = { ...frame.data, itemIndex: itemIndex + 1 };
  frame.index++;

  return { continue: true, awaitingInput: false };
}
```

**Fix shape (mirrors `executeEachPlayer` exactly):** guard `frame.data?.itemSnapshot === undefined`, compute `config.collection(context)` once, map each item to `{ id: number }` for `GameElement` instances (mirrors `eligibleSeats: players.map(p => p.seat)`) or the raw value for JSON primitives, store as `frame.data.itemSnapshot`. On each entry, re-resolve: `GameElement` items via `this.game.getElementById(id)` (mirrors `this.game.getPlayer(seat)`), primitives read directly. Non-element/non-primitive items: throw or `devWarn` per RESEARCH's Open Question 1 recommendation (no existing usage to break either way — Claude's discretion, but be loud not silent, consistent with this phase's whole thesis).

**Pitfall guard:** do not store `GameElement` object references directly in `frame.data` (breaks checkpoint serialization — same bug class WR-03 exists to diagnose). Store `id: number` only, like `eligibleSeats` stores `seat: number`, not `Player`.

---

### `src/engine/action/action-builder.ts` + `src/engine/element/game.ts` — ENG-08 (handler-less build + registerAction throw)

**Analog for the flag shape:** `ActionDefinition.undoable?: boolean` (`src/engine/action/types.ts:451-454`) — precedent for adding a plain optional boolean field to this interface rather than inventing a sentinel-function detection scheme.

**Current constructor default (`action-builder.ts:73-79`):**
```typescript
private constructor(name: string) {
  this.definition = {
    name,
    selections: [],
    execute: () => {},
  };
}
```

**Current `.execute()` terminal method** — starts at `action-builder.ts:625` (`execute(`); read that block before editing to see how it currently sets `this.definition.execute` and returns the definition, so the flag can be cleared there symmetrically to how it's set by the constructor/`build()`.

**Current `.build()` (`action-builder.ts:636-640`):**
```typescript
/**
 * Get the built definition (without execute, for inspection)
 */
build(): ActionDefinition {
  return this.definition;
}
```

**Current `registerAction` — zero validation (`game.ts:918-921`):**
```typescript
registerAction(action: ActionDefinition): void {
  this._actions.set(action.name, action);
}
```

**Analog for "throw actionable error at a validation chokepoint inside this same file" idiom** — `game.ts`'s existing `startFlow()`-time validations (different timing, but same message-shape convention: name the offending item + the fix). Test-visible proof of the convention: `game.test.ts:309`, `toThrowError(/registerActions/)` — confirms this codebase's existing pattern of testing thrown-error messages via regex containing the fix-hint keyword. Use the same testing idiom for the new `registerAction()` throw (assert message contains both the action name and `.execute(`).

**Pitfall guard (per RESEARCH Pitfall 4):** the new throw belongs directly in `registerAction()` (game.ts:920), not merged into `#validateActionReachability` or the PIT-02 element-class check inside `startFlow()` — those run later (flow-start time) and would let unit tests that only call `registerAction()` without `startFlow()` falsely pass.

---

## Shared Patterns

### Actionable-error message convention
**Source:** `piece.ts:116-122` (TREE CORRUPTION console.error), `game.ts` PIT-02/PIT-03 throws (validated via `game.test.ts:309` regex assertion), and CONTEXT's own required wording pattern.
**Apply to:** All four fixes' thrown/logged messages — name the offending element(s)/action by name, and state the concrete fix (e.g., "end the chain with `.execute(fn)`", "Cannot move X into its own descendant Y").
```typescript
// game.test.ts:309 — the project's convention for testing a registration-time throw
expect(() => new MissingActionGame(makeOptions()).startFlow()).toThrowError(/registerActions/);
```

### `devWarn`/`isDevMode` gating (Phase 131 pattern) — apply ONLY where a check is a dev-only diagnostic, NOT to ENG-01/ENG-06/ENG-08 (which must run/throw unconditionally in all environments per CONTEXT)
**Source:** `src/utils/dev.js` via `piece.ts:8` import; usage at `piece.ts:90-104`.
```typescript
import { devWarn, isDevMode } from '../../utils/dev.js';
// ...
if (isDevMode()) {
  devWarn(`some-key:${detail}`, `message describing the problem and the fix`);
}
```
**Do not use this gate for the four ENG fixes' primary throws** — RESEARCH explicitly flags "making the ENG-01 throw dev-mode-only" as Pitfall 1 / an anti-pattern. `devWarn` remains reserved for genuinely dev-only diagnostics (like WR-03), not for the new fail-loud guards this phase adds.

### Snapshot-on-first-entry for frame-persisted flow loops
**Source:** `executeEachPlayer`, `engine.ts:1096-1119` (see full excerpt above under ENG-06).
**Apply to:** `executeForEach` only in this phase (no other `FlowEngine` executor is in scope), but this is the reusable idiom for any future frame-persisted loop over a mutable collection.

---

## No Analog Found

None. All four target files/functions have a same-file or same-class analog with a directly reusable idiom (WR-03's ancestor walk, the `choice` case's `isSerializedElement` usage, `executeEachPlayer`'s snapshot pattern, `undoable?` flag precedent). No file in this phase requires reaching outside `src/engine/` for a pattern.

## Metadata

**Analog search scope:** `src/engine/element/`, `src/engine/action/`, `src/engine/flow/` (all four target files plus their existing test files)
**Files scanned:** `piece.ts`, `action.ts`, `action-builder.ts`, `engine.ts`, `game.ts`, `types.ts` (action), `game-element.test.ts`, `action.test.ts`, `engine.test.ts`, `game.test.ts`, `element-collection.test.ts`
**Pattern extraction date:** 2026-07-03
</content>
