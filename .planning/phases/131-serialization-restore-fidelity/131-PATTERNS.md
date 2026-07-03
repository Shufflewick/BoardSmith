# Phase 131: Serialization & Restore Fidelity - Pattern Map

**Mapped:** 2026-07-02
**Files analyzed:** 11 modified + 6 new test files
**Analogs found:** 11 / 11 (all modified files have same-file or sibling-field precedent; new test files have exact structural templates)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `src/engine/element/space.ts` (`_zoneVisibility` serialize/restore) | model | CRUD (serialize/deserialize) | `src/engine/element/game-element.ts` (`_visibility` toJSON/fromJSON special-case) | exact — sibling field, same class hierarchy |
| `src/engine/element/game-element.ts` (`visibleAttributes` filtering hook) | model | transform | `src/engine/element/game.ts` `filterElement` closure (existing zone/element hiding branches) | role-match — same filtering pipeline, new branch |
| `src/engine/element/game.ts` (`toJSONForPlayer`/`filterElement` — SEC-02 attribute filter) | model | transform | same file, `filterElement`'s existing 3 branches (count-only, individually-hidden, zone-hidden) | exact — extend existing closure |
| `src/engine/element/game.ts` (`loadSerializedState` — RST-01 handler re-bind) | model | event-driven | same file, existing discard/rebuild loop (lines 2848-2857) | exact — insert capture-before-discard + rebind-after-rebuild around existing loop |
| `src/runtime/runner.ts` (`fromSnapshot`) | service | request-response | no direct change expected — consumes `Game.loadSerializedState`; verify pass-through only | n/a (verification touch, not a pattern-bearing rewrite) |
| `src/session/utils.ts` (`buildPlayerState` — SEC-03 `state.players`) | service | transform | same file, `truthView` derivation two lines above (`playerView.state`) — replace parallel raw pass | exact — collapse two divergent code paths into one |
| `src/session/game-session.ts` (`create`/`restore` — RST-02 persistence; `includeDebugData` sites — SEC-04) | service | CRUD + request-response | same file, `aiConfig` persistence in `create()`/`restore()` (lines 704, 794-796) | exact — sibling field template |
| `src/session/types.ts` (`StoredGameState.teachingDisabled`/`displayName`) | model/config | CRUD | same file, `StoredGameState.aiConfig` field (line 222) | exact — sibling optional field |
| `src/session/pending-action-manager.ts` (`includeDebugData` sites) | service | event-driven | `src/session/game-session.ts` broadcast call site (same option object shape) | exact — identical call signature across files |
| `src/session/state-history.ts` (`includeDebugData` sites) | service | event-driven | `src/session/game-session.ts` broadcast call site | exact — identical call signature |
| `src/runtime/stateless-ops.ts` (`buildSpectatorView` — unify with serialized `_zoneVisibility`) | service | request-response | same file, `buildViews` (already correct re: debug gating; needs zone-visibility special-case removed) | role-match — remove now-redundant workaround |
| `src/engine/element/zone-visibility-restore.test.ts` (new) | test | CRUD round-trip | `src/engine/element/deck-hand-visibility.test.ts` | exact — same suite style, extend to restore paths |
| `src/engine/element/visible-attributes.test.ts` (new) | test | transform | `src/engine/element/deck-hand-visibility.test.ts` | exact — same suite style |
| `src/engine/element/handler-restore.test.ts` (new) | test | event-driven | `src/session/restore-snapshot-authoritative.test.ts` | role-match — restore-fidelity assertion style |
| `src/session/player-state-visibility.test.ts` (new) | test | request-response | `src/session/restore-snapshot-authoritative.test.ts` | exact — session-layer restore/broadcast assertion style |
| `src/session/debug-data-gating.test.ts` (new) | test | event-driven | `src/session/restore-snapshot-authoritative.test.ts` | role-match |
| `src/session/teaching-disabled-persistence.test.ts` (new, or extend `restore-snapshot-authoritative.test.ts`) | test | CRUD round-trip | `src/session/restore-snapshot-authoritative.test.ts` (`F42`/`BL-01` describe blocks) | exact — literally extend this file's pattern |

## Pattern Assignments

### `src/engine/element/space.ts` (model, CRUD serialize/restore) — SEC-01

**Analog:** `src/engine/element/game-element.ts` `_visibility` special-case (toJSON lines 793-796, fromJSON static lines 1025-1028)

**Current state — `_zoneVisibility` is excluded, has zero serialize/restore path** (`space.ts:106-118`):
```typescript
private _eventHandlers: {
  enter: ElementEventHandler<GameElement>[];
  exit: ElementEventHandler<GameElement>[];
} = { enter: [], exit: [] };

/** Visibility mode for contents (not the space itself) */
private _zoneVisibility?: VisibilityState;

static override unserializableAttributes = [
  ...GameElement.unserializableAttributes,
  '_eventHandlers',
  '_zoneVisibility',
];
```

**Pattern to mirror — `GameElement._visibility` toJSON emission** (`game-element.ts:793-796`):
```typescript
// Include visibility if explicitly set
if (this._visibility?.explicit) {
  json.visibility = this._visibility;
}
```

**Pattern to mirror — `GameElement._visibility` fromJSON restoration** (`game-element.ts:1025-1028`, inside static `fromJSON`):
```typescript
// Restore visibility if present
if (json.visibility) {
  element._visibility = json.visibility;
}
```

**Fix shape for `Space`:** `Space` currently has NO `toJSON()`/`fromJSON()` override (inherits base `GameElement` implementation — confirmed via grep, zero matches in space.ts). Add a `Space.toJSON()` override calling `super.toJSON()` then setting `json.zoneVisibility = this._zoneVisibility` when set (mirror the `explicit` guard used for `_visibility`, since `_zoneVisibility` is also only meaningfully set when a designer calls `contentsHidden()`/`setZoneVisibility()`/etc — all of which set `explicit: true` per `visibilityFromMode`, confirmed at `space.ts:133,177,189`). Add a matching restoration step — either a `Space`-specific static hook consulted from `GameElement.fromJSON`, or a post-construction pass keyed on `element instanceof Space` inside the existing `fromJSON` (line ~1013 `new ElementClass(ctx)` construction point). Remove `'_zoneVisibility'` from `unserializableAttributes` at `space.ts:117` only if the new toJSON/fromJSON pair fully owns serialization — otherwise leave it in the exclusion list (it's `_`-prefixed so it's excluded from the generic per-key attribute loop regardless; `_visibility` follows the same "still excluded generically, but explicitly special-cased" precedent) — CONTEXT.md explicitly says "remove it from `Space.unserializableAttributes`" so follow that literally, matching `_visibility`'s field NOT being separately listed in `GameElement.unserializableAttributes` beyond the base entry.

**`ElementJSON` type extension needed:** add `zoneVisibility?: VisibilityState` alongside existing `visibility?: VisibilityState` field (exact location TBD at plan time — same file/interface that declares `visibility` on `ElementJSON`).

---

### `src/engine/element/game.ts` — `filterElement` attribute filtering (model, transform) — SEC-02

**Analog:** same file, the 3 existing redaction branches inside `filterElement` (lines 2682-2789)

**Current unfiltered fallthrough — the insertion point** (`game.ts:2791-2807`):
```typescript
// Filter children normally
const filteredChildren: ElementJSON[] = [];
if (json.children) {
  for (let i = 0; i < json.children.length; i++) {
    const childJson = json.children[i];
    const childElement = element._t.children[i];
    const filtered = filterElement(childJson, childElement);
    if (filtered) {
      filteredChildren.push(filtered);
    }
  }
}

return {
  ...json,
  children: filteredChildren.length > 0 ? filteredChildren : undefined,
  // json.attributes is NEVER filtered by visibleAttributes here — the gap
};
```

**Existing owner-check precedent to mirror for the new branch** (`game.ts:2764`):
```typescript
} else if (zoneVisibility.mode === 'owner' && element.getEffectiveOwner()?.seat !== visibilityPosition) {
```

**`visibleAttributes` declaration (already exists, unread anywhere)** (`game-element.ts:140`):
```typescript
static visibleAttributes: string[] | undefined;
```

**Fix shape:** before the final `return` in `filterElement`, when `(element.constructor as typeof GameElement).visibleAttributes !== undefined` AND the viewer is not the owner, filter `json.attributes` down to the whitelisted keys. Owner check must special-case `Player` (Pitfall 4): `element instanceof Player ? element.seat === visibilityPosition : element.getEffectiveOwner()?.seat === visibilityPosition` — a plain `getEffectiveOwner()` walk returns `undefined` for a top-level `Player`, which would incorrectly hide a player's own restricted attributes from themself.

---

### `src/session/utils.ts` `buildPlayerState` (service, transform) — SEC-03

**Analog:** same file, `truthView` (already computed, already filtered)

**Current unfiltered second pass — to be replaced** (`utils.ts:211-212`, `236-262`):
```typescript
// Truth view -- always the current game state
const playerView = runner.getPlayerView(playerPosition);
const truthView = playerView.state;
...
// Get the full player data including custom properties (abilities, score, etc.)
// from the game's player objects via their toJSON methods.
const allPlayers = runner.game.players;
const fullPlayerData = allPlayers.map((player: any) => {
  if (typeof player.toJSON === 'function') {
    const json = player.toJSON() as unknown as {
      name: string; className: string; id: number;
      attributes?: Record<string, unknown>; [key: string]: unknown
    };
    const flattened: { name: string; seat: number; [key: string]: unknown } = {
      ...json,
      ...(json.attributes || {}),
      seat: player.seat,
    };
    delete flattened.attributes;
    return flattened;
  }
  return { name: player.name ?? `Player ${player.seat}`, seat: player.seat };
});
```
This bypasses ALL visibility (`isVisibleTo`, `hideFromAll()`, and the new `visibleAttributes` filter) because it reads raw `player.toJSON()` instead of the already-filtered `truthView` tree.

**Fix shape:** derive `fullPlayerData` by walking `truthView.children` (or the equivalent filtered JSON) for Player nodes (`className === 'Player'`) instead of `runner.game.players.map(raw toJSON)`. This makes `state.players` inherit both zone/element visibility (SEC-01/existing) and `visibleAttributes` (SEC-02) for free — one mechanism, per CONTEXT.md's explicit decision. Preserve `Player.toJSON()`'s `_isCurrent` addition (`src/engine/player/player.ts:326-333`) since Player is a normal tree child processed by the same `filterElement` pipeline `truthView` already went through.

---

### `src/session/types.ts` `StoredGameState` (model/config, CRUD) — RST-02

**Analog:** same file, existing `aiConfig` field

**Existing template field** (`types.ts:222`):
```typescript
aiConfig?: AIConfig;
```

**Fix shape:** add two sibling optional fields to the `StoredGameState` interface (block starts `types.ts:195`, existing fields run through `colorSelectionEnabled?: boolean;` at line 239 and beyond):
```typescript
teachingDisabled?: boolean;
displayName?: string;
```
Note: `displayName?: string` already exists on `GameDefinition` (`types.ts:83`) and is a `GameSessionOptions`/constructor param (`game-session.ts:313,326`) — it is NOT currently a `StoredGameState` field; this is the actual RST-02 gap for `displayName`.

---

### `src/session/game-session.ts` `create()`/`restore()` (service, CRUD) — RST-02

**Analog:** same file, `aiConfig` write-then-read-back round trip

**`create()` — write into `storedState`** (`game-session.ts:692-715`, `aiConfig` at line 704):
```typescript
const storedState: StoredGameState = {
  gameType, playerCount, playerNames, playerIds,
  seed: gameSeed,
  actionHistory: [],
  snapshot: runner.getSnapshot(),
  createdAt: Date.now(),
  aiConfig,
  gameOptions: customGameOptions,
  lobbyState, lobbySlots, creatorId,
  playerOptionsDefinitions, gameOptionsDefinitions,
  colorSelectionEnabled, colors, minPlayers, maxPlayers,
};
```
Add `teachingDisabled` and `displayName` (both already in-scope local vars at this point — `teachingDisabled` destructured from options per research; `displayName` likewise) to this object literal.

**`restore()` — read back and pass into constructor** (`game-session.ts:794-796, 813`):
```typescript
const aiController = storedState.aiConfig
  ? new AIController(GameClass, storedState.gameType, storedState.playerCount, storedState.aiConfig, botAIConfig)
  : undefined;
...
const session: GameSession<G> = new GameSession(runner, storedState, GameClass, storage, aiController, undefined, lobbyManager, undefined, undefined, botAIConfig, undefined, onPersistenceError);
```
The 6th positional arg is `displayName`, the 11th is `teachingDisabled` — both hardcoded `undefined` today. Fix: replace with `storedState.displayName` and `storedState.teachingDisabled` respectively (constructor signature confirmed at `game-session.ts:313,318`: `displayName?: string` is param 6, `teachingDisabled?: boolean` is param 11 in the private constructor).

---

### `includeDebugData` opt-in flip (service, event-driven) — SEC-04

**Analog pattern:** identical option-object literal repeated verbatim across 3 files — fix is purely mechanical (flip `true` → `false`/omit, or thread `debugEnabled`)

**Confirmed exact call sites (verified 2026-07-02, matches RESEARCH.md):**
```
src/session/game-session.ts:890   { includeActionMetadata: options?.includeActionMetadata ?? true, includeDebugData: options?.includeDebugData ?? true }
src/session/game-session.ts:903   same pattern (public buildPlayerState method)
src/session/game-session.ts:1386  { includeActionMetadata: true, includeDebugData: true }
src/session/game-session.ts:2120  { includeActionMetadata: true, includeDebugData: true }  (broadcast())
src/session/pending-action-manager.ts:226  { includeActionMetadata: true, includeDebugData: true }
src/session/pending-action-manager.ts:250  same
src/session/pending-action-manager.ts:355  same
src/session/pending-action-manager.ts:357  same
src/session/state-history.ts:321  { includeActionMetadata: true, includeDebugData: true }
src/session/state-history.ts:393  same pattern
```
The gating check itself lives once, in `utils.ts:287`:
```typescript
if (options?.includeDebugData) {
  const customDebug = runner.game.getCustomDebugData();
  if (Object.keys(customDebug).length > 0) {
    state.customDebug = customDebug;
  }
}
```
**`stateless-ops.ts` requires NO change for this finding** — confirmed it never passes `includeDebugData` at all (omission → falsy → already gated correctly). Do not touch this file for SEC-04; the CONTEXT.md-decision to remove the *zone-visibility* special-case in `buildSpectatorView` (SEC-01 unification) is a separate, real change to that same file.

**Fix shape:** flip every hardcoded `true` above to `false` (or route through a new `debugEnabled` field on the session instance, mirroring `#teachingDisabled`'s constructor-time-only shape per `game-session.ts:305,329`), scoped to `GameSession` consumers only — no `boardsmith dev`/CLI wiring (Pitfall 2: `SnapshotSessionHost`/dev host uses `stateless-ops.ts` exclusively, which is already safe).

---

### `src/engine/element/game.ts` `loadSerializedState` handler re-bind (model, event-driven) — RST-01

**Analog:** same file, the existing discard-then-rebuild loop this must wrap

**Current discard point** (`game.ts:2848-2857`):
```typescript
// Clear existing children and rebuild the tree from JSON
this._t.children = [];
if (json.children) {
  for (const childJson of json.children) {
    const child = GameElement.fromJSON(childJson, this._ctx, this._ctx.classRegistry);
    child._t.parent = this;
    (child as GameElement).game = this;
    this._t.children.push(child);
  }
}
```
**Fix shape:** before `this._t.children = []`, walk `this._t.children` collecting `Space` instances with non-empty `_eventHandlers` (per Pitfall 3, `_eventHandlers` is `private` on `Space` — add a scoped/internal accessor mirroring the `_t` cross-class-internal convention rather than making the field public), keyed by stable identity (class + tree path or name, per CONTEXT.md's discretion grant). After the rebuild loop completes, walk the new tree and re-attach matching handlers by the same key; `devWarn` for unmatched handlers (existing project convention — grep other `devWarn` call sites in `game.ts` for the exact helper signature/import to reuse).

---

### `src/runtime/stateless-ops.ts` `buildSpectatorView` unification — SEC-01

**Analog:** the special-case comment/workaround this phase removes, replaced by nothing (serialization now handles it)

**Action:** once `Space._zoneVisibility` serializes/restores correctly (per the space.ts fix above), remove the existing spectator-view special-case patch in `buildSpectatorView` that manually re-applies zone-hiding logic — the comment there already documents it as a stopgap ("zone visibility is not serialized"). Confirm exact line range with `grep -n "zone" src/runtime/stateless-ops.ts` at implementation time — not independently re-verified in this pattern pass (file lives in `src/runtime/`, not `src/session/`, per the phase's file list; RESEARCH.md's line citation of `stateless-ops.ts` was for the session-layer copy prior to a module move — confirm actual module path during planning).

---

### Test files (new)

**Analog for engine round-trip suites:** `src/engine/element/deck-hand-visibility.test.ts`

**Exact structural template** (`deck-hand-visibility.test.ts:1-27`):
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
...
describe('Deck/Hand secure-by-default visibility (F32)', () => {
  ...
  it('hides a fresh Deck contents from non-owner in per-player snapshot', () => {
    const view = game.toJSONForPlayer(2);
    // ... assert __hidden ...
  });
});
```
Use this shape for `zone-visibility-restore.test.ts` and `visible-attributes.test.ts`, but each `it()` must additionally round-trip through a restore path (`GameRunner.fromSnapshot` at minimum) before asserting `toJSONForPlayer(opponent)`, per SEC-01's byte-identity requirement.

**Analog for session persistence/restore suites:** `src/session/restore-snapshot-authoritative.test.ts`

**Exact structural template** (`restore-snapshot-authoritative.test.ts:147-235`, `299-379`):
```typescript
describe('F42: GameSession.restore is snapshot-authoritative', () => {
  it('persists a snapshot and reconstructs the exact post-multi-step state', async () => { ... });
  it('uses GameRunner.fromSnapshot and never GameRunner.replay', async () => { ... });
  it('supports undo after restore (dead under the old replay restore)', async () => { ... });
  it('supports time-travel (getStateAtAction) after restore', async () => { ... });
  it('fails loud when stored state has no snapshot (no silent replay fallback)', async () => { ... });
});

describe('BL-01: GameSession.restore() re-supplies tutorialDefinition', () => {
  it('gating reason survives snapshot → restore when tutorial param is passed', async () => { ... });
  it('getActiveStep resolves to the running step after restore', async () => { ... });
  it('restore() WITHOUT tutorial param loses gating (documents the pre-fix behavior)', async () => { ... });
});
```
This is the exact template for `teaching-disabled-persistence.test.ts` (mirror the `BL-01` block shape: one describe per finding, one "documents the pre-fix behavior" red-test showing the bug before the fix, plus positive-path tests after). Also use for `player-state-visibility.test.ts` and `debug-data-gating.test.ts` (session-layer, async, `GameSession.create`/`.restore` driven).

**Canonical byte-identity assertion pattern** (`tutorial-serialization.test.ts:120`, referenced in RESEARCH.md):
```typescript
it('survives runner.getSnapshot() → GameRunner.fromSnapshot() byte-identically', () => {
  const snapshotJson = JSON.parse(JSON.stringify(runner.getSnapshot()));
  const restored = GameRunner.fromSnapshot<TutorialGame>(snapshotJson, TutorialGame);
  // ... assert equality ...
});
```
Use `JSON.stringify(game.toJSONForPlayer(opponentSeat))` strict equality before/after each of the 5 restore paths, per CONTEXT.md's explicit assertion style.

## Shared Patterns

### "Sibling field" persistence pattern (RST-02 template)
**Source:** `src/session/types.ts:222` (`aiConfig` field) + `src/session/game-session.ts:704` (write in `create()`) + `src/session/game-session.ts:794-796,813` (read in `restore()`)
**Apply to:** `teachingDisabled`, `displayName` in `StoredGameState`/`create()`/`restore()`
```typescript
// StoredGameState field:
aiConfig?: AIConfig;
// create() write:
aiConfig,
// restore() read + constructor thread-through:
const aiController = storedState.aiConfig ? new AIController(...) : undefined;
```

### Explicit-only special-case serialization (SEC-01 template)
**Source:** `src/engine/element/game-element.ts:793-796` (toJSON) + `:1025-1028` (fromJSON)
**Apply to:** `Space._zoneVisibility` in `space.ts`
```typescript
if (this._visibility?.explicit) { json.visibility = this._visibility; }
// ...
if (json.visibility) { element._visibility = json.visibility; }
```

### Per-viewer redaction chokepoint (SEC-02/SEC-03 template)
**Source:** `src/engine/element/game.ts` `filterElement` closure inside `toJSONForPlayer` (lines 2676-2808), owner-check precedent at line 2764
**Apply to:** new `visibleAttributes` branch (SEC-02) and `buildPlayerState`'s `state.players` derivation (SEC-03) — both must route through this single function, not a parallel filter.

### `includeDebugData` opt-in option object (SEC-04 template)
**Source:** `src/session/utils.ts:287` gating check; repeated call-site shape across `game-session.ts`, `pending-action-manager.ts`, `state-history.ts`
```typescript
if (options?.includeDebugData) {
  const customDebug = runner.game.getCustomDebugData();
  if (Object.keys(customDebug).length > 0) { state.customDebug = customDebug; }
}
```
**Apply to:** all 10 hardcoded-`true` call sites — flip default, do NOT touch `stateless-ops.ts` (already safe by omission).

## No Analog Found

None — every file in scope has a direct same-file or sibling-field precedent already in the codebase (this phase's own research explicitly frames the work as "find the twin that already works, copy its shape").

## Metadata

**Analog search scope:** `src/engine/element/`, `src/engine/player/`, `src/session/`, `src/runtime/`
**Files scanned:** `space.ts`, `game-element.ts`, `game.ts`, `player.ts`, `runner.ts`, `stateless-ops.ts`, `utils.ts`, `game-session.ts`, `types.ts`, `pending-action-manager.ts`, `state-history.ts`, `deck-hand-visibility.test.ts`, `restore-snapshot-authoritative.test.ts`, `tutorial-serialization.test.ts`
**Pattern extraction date:** 2026-07-02
**Note:** All line numbers independently re-verified against current repo state in this session (matches RESEARCH.md's figures almost exactly; no material drift found).
