---
phase: 131-serialization-restore-fidelity
reviewed: 2026-07-02T00:00:00Z
depth: standard
files_reviewed: 18
files_reviewed_list:
  - docs/common-pitfalls.md
  - src/engine/element/game-element.ts
  - src/engine/element/game.ts
  - src/engine/element/handler-restore.test.ts
  - src/engine/element/space.ts
  - src/engine/element/types.ts
  - src/engine/element/visible-attributes.test.ts
  - src/engine/element/zone-visibility-restore.test.ts
  - src/session/debug-data-gating.test.ts
  - src/session/game-session.ts
  - src/session/pending-action-manager.ts
  - src/session/player-state-visibility.test.ts
  - src/session/restore-snapshot-authoritative.test.ts
  - src/session/state-history.ts
  - src/session/stateless-ops.ts
  - src/session/teaching-disabled-persistence.test.ts
  - src/session/types.ts
  - src/session/utils.ts
findings:
  critical: 2
  warning: 4
  info: 4
  total: 10
status: issues_found
---

# Phase 131: Code Review Report

**Reviewed:** 2026-07-02
**Depth:** standard
**Files Reviewed:** 18
**Status:** issues_found

## Summary

Reviewed the Phase 131 security/fidelity work: zone-visibility serialization (SEC-01/F1/F7), `visibleAttributes` per-viewer filtering (SEC-02/F2), `state.players` redaction (SEC-03/F8), debug-data gating (SEC-04/F15), `teachingDisabled`/`displayName` persistence (RST-02/F16), snapshot-authoritative restore (F42), and onEnter/onExit handler re-binding (RST-01/F10).

The core fixes are sound and well-tested: `state.players` is now correctly a projection of the filtered `truthView` (one chokepoint), debug data defaults to off at every session call site, `teachingDisabled` round-trips through `StoredGameState`, restore is provably `fromSnapshot`-only, and zone visibility byte-identity is asserted across all five restore paths.

However, two Critical issues remain in the reviewed code. First, the new SEC-02 `visibleAttributes` enforcement is **bypassed for any Space that also has zone visibility set** — the zone branches in `toJSONForPlayer` early-return before the whitelist runs, leaking restricted container attributes to non-owners. Second, `Game.toJSON()` embeds **live references** (`settings`, `messages`, `_visibility`, `_zoneVisibility`) into snapshots/checkpoints, so the phase's checkpoint-based undo/rewind/time-travel does not actually roll those fields back, and post-checkpoint mutations retroactively corrupt retained checkpoints. The handler re-binding scheme also has two silent-failure modes its test does not cover.

## Critical Issues

### CR-01: Zone-visibility early returns bypass SEC-02 `visibleAttributes` filtering for the container element itself

**File:** `src/engine/element/game.ts:2746-2829`
**Issue:** In `toJSONForPlayer`'s `filterElement`, the zone-visibility branches (`hidden`/`count-only` at 2747-2771, `owner` at 2772-2796) return early with `{ ...json, children: hiddenChildren, ... }`. The spread carries the container's **full, unfiltered attribute set**. The SEC-02 whitelist enforcement (`ElementClass.visibleAttributes`, lines 2810-2829) is only reached when no zone branch fires. Consequence: a Space subclass that declares `static visibleAttributes` **and** sets zone visibility (the most security-conscious combination — e.g. a player board with `contentsVisibleToOwner()` and a restricted `secretPlan` attribute) leaks every non-whitelisted attribute of the container to all non-owner seats and spectators. This is an information-disclosure gap in the exact control this phase added; `visible-attributes.test.ts` only covers Pieces/Players with no zone visibility, so nothing catches it.
**Fix:** Apply the whitelist to the container's own attributes before (or inside) each zone early-return. E.g. hoist the SEC-02 redaction into a helper and run it on `json` at the top of `filterElement` (after the element-level visibility checks), so all downstream branches operate on the already-redacted `ownJson`:
```typescript
// before the zoneVisibility branch:
const ownJson = applyVisibleAttributesWhitelist(json, element, visibilityPosition);
// then use ownJson (not json) in the hidden/count-only/owner early returns:
return { ...ownJson, children: hiddenChildren.length > 0 ? hiddenChildren : undefined, childCount: ... };
```
Add a regression test: Space subclass with `visibleAttributes = ['publicField']` + `contentsHidden()`, assert `secretField` absent from the opponent view.

**Resolution:** status: fixed — SEC-02 whitelist filtering hoisted above the zone-visibility branches in `filterElement`; all three zone early-returns (`hidden`/`count-only`/`owner`) now spread the redacted `ownJson`. 4 regression tests added to `visible-attributes.test.ts` (hidden / count-only / owner-as-non-owner / owner-as-self), verified failing pre-fix.

### CR-02: `Game.toJSON()` embeds live references — undo/rewind/time-travel silently fail to roll back `settings` and `messages`, and mutations corrupt retained checkpoints

**File:** `src/engine/element/game.ts:2652-2672` (toJSON), `src/engine/element/game.ts:2875-2879` (loadSerializedState); also `src/engine/element/game-element.ts:793-796` (`json.visibility = this._visibility`), `src/engine/element/space.ts:144-150` (`json.zoneVisibility = this._zoneVisibility`)
**Issue:** `Game.toJSON()` returns `messages: this.messages` and `settings: this.settings` **by reference** (element attributes go through `serializeValue`, which copies; these two top-level fields do not). `createActionCheckpoint`/`createSnapshot` store this result as-is, and the checkpoint restore paths added/relied on this phase (`GameRunner.fromCheckpoint` → `fromSnapshot` → `loadSerializedState`) never JSON-round-trip in the live-session undo path (`StateHistory.undoToTurnStart`/`rewindToAction`/`getStateAtAction` operate on in-memory objects). `loadSerializedState` then assigns `this.settings = json.settings; this.messages = json.messages`. Net effect:
1. Every retained `actionCheckpoints[k]` shares ONE `settings` object and ONE `messages` array with the live game — a checkpoint "frozen" at action k mutates as play continues.
2. Undo/rewind therefore does **not** roll back `game.settings` (which backs documented APIs: `actionTempState()`, `persistentMap()`, `settings.winners`) or `game.messages` — messages logged by undone actions remain, and temp/persistent-map state from undone actions survives, silently corrupting game logic that reads it.
3. The same aliasing applies to `_visibility`/`_zoneVisibility` objects mutated in place by `addVisibleToInternal`/`addZoneVisibleTo`/`hideContentsFrom` (`this._zoneVisibility.addPlayers = ...` mutates the object referenced by every retained checkpoint), so those visibility grants are also not undoable and retroactively alter checkpoints.
The zone-visibility test suite masks this because its cold-restore paths round-trip through `JSON.stringify` (`roundTripJson`, storage adapters), which deep-copies; the live undo test (case b) only exercises a `noop` action that mutates neither field.
**Fix:** Copy at the serialization boundary. In `Game.toJSON()`:
```typescript
messages: this.messages.map(m => ({ ...m })),
settings: this.serializeValue(this.settings, 'settings') as Record<string, unknown>,
```
and emit copies for `visibility`/`zoneVisibility` (`{ ...this._visibility, addPlayers: [...(this._visibility.addPlayers ?? [])] }` or `structuredClone`). Symmetrically, `loadSerializedState` and `_restoreZoneVisibility`/`fromJSON` should adopt copies, not the JSON objects, so a restored game never shares mutable state with the snapshot it was restored from. Add a regression test: perform an action that calls `game.message()` and `actionTempState().set(...)`, `undoToTurnStart`, assert both are rolled back (no JSON round-trip in the test).

**Resolution:** status: fixed — `Game.toJSON()` now emits `serializeValue` deep copies of `messages`/`settings` (plus copied `animationEvents`); new `copyVisibilityState` helper in `visibility.ts` used at all four visibility boundaries (`GameElement.toJSON`/`fromJSON`, `Space.toJSON`/`_restoreZoneVisibility`); `loadSerializedState` de-aliases `messages`/`settings` via the existing `resolveElementReferences` rebuild (documented) and copies restored animation events. New suite `src/engine/element/checkpoint-aliasing.test.ts` (5 tests, no JSON round-trips; 4 fail pre-fix) covers checkpoint immunity, restore de-aliasing, and live `undoToTurnStart` rollback of messages/settings/zone-visibility grants.

## Warnings

### WR-01: SEC-02 ownership check uses `element instanceof Player`, which this file documents as unreliable under bundling

**File:** `src/engine/element/game.ts:2813`
**Issue:** The new `visibleAttributes` branch decides Player self-ownership via `element instanceof Player`. The same file deliberately avoids `instanceof` for Players elsewhere — `currentPlayer` (line 1998: "avoids issues when code is bundled (esbuild creates separate class copies)"), `getPlayer` (line 2054), and `serializeValue` (line 836, duck-types on `seat`). In a bundled game where the Player class identity is duplicated, `instanceof` returns false, the code falls through to `getEffectiveOwner()` (which resolves nothing for a top-level Player), and a player is redacted out of **their own** restricted attributes — exactly the Pitfall-4 failure the special case exists to prevent, now dependent on bundler behavior.
**Fix:** Use the same duck-typing as `serializeValue`:
```typescript
const isPlayerNode = 'seat' in element && typeof (element as unknown as Player).seat === 'number';
const isOwner = isPlayerNode
  ? (element as unknown as Player).seat === visibilityPosition
  : element.getEffectiveOwner()?.seat === visibilityPosition;
```

**Resolution:** status: fixed — replaced `instanceof Player` with the same seat duck-typing used by `serializeValue`/`currentPlayer`/`getPlayer`, exactly as suggested. Covered by the existing Pitfall-4 owner/non-owner tests in `visible-attributes.test.ts` (behavioral parity; the bundler dual-class scenario itself is not reproducible in-process).

### WR-02: Handler re-binding key (class name + branch path) can silently cross-wire handlers between same-class Spaces when sibling indices shift

**File:** `src/engine/element/game.ts:2896-2943`, `src/engine/element/space.ts:285-302`
**Issue:** `loadSerializedState` captures handlers from the pre-restore tree (a fresh constructor tree in the `fromSnapshot` path) keyed by `${className}:${branch()}`, and re-attaches by matching keys in the restored tree. `branch()` is the index path among **all** siblings, including Pieces. If sibling composition changed during play (a Piece moved out of / into a container that also holds handler-bearing Spaces), every subsequent Space's branch shifts. With two same-class sibling Spaces A@`Cls:1`, B@`Cls:2` (constructor tree, a piece at index 0) and a snapshot where the piece has moved (A@`Cls:0`, B@`Cls:1`): B's restored key `Cls:1` matches **A's** captured handlers — B silently receives A's handlers while A gets none. Only one `devWarn` fires (for the orphaned `Cls:2` key), and it describes handler *loss*, not mis-binding. Mis-bound onEnter/onExit is silent wrong game logic (e.g. seat 1's scoring trigger firing on seat 2's zone).
**Fix:** Make the key immune to sibling reordering. Options: (a) key by class name + element **name** + owning player seat (names are stable and constructor-assigned); (b) key by the Space's *space-only* path (indices computed over Space children only); (c) match positionally against the fresh constructor tree's `all(Space)` order (both trees run the same constructor). Also strengthen the devWarn to state that a same-keyed sibling may have absorbed the handlers.

**Resolution:** status: fixed — key changed to `${className}:${name}:${spaceOnlyIndexPath}` (options (a)+(b) combined): the index path counts Space siblings only (immune to piece movement) and the constructor-assigned name disambiguates further. devWarn now also warns that a same-keyed sibling may have absorbed the handlers. Regression test added to `handler-restore.test.ts` (piece-before-two-same-class-buckets cross-wire scenario), verified failing pre-fix.

### WR-03: Re-bound handler closures can act on the discarded pre-restore tree (stale captured element references)

**File:** `src/engine/element/game.ts:2896-2903`, `src/engine/element/space.ts:285-302`
**Issue:** The captured `onEnter`/`onExit` callbacks are closures created in the game constructor. Re-attaching them to the rebuilt tree preserves *firing*, but any element captured lexically inside the closure still points at the **discarded** tree. Example:
```typescript
const scorePile = this.create(Space, 'score');       // local, not a game attribute
this.discard.onEnter(card => card.putInto(scorePile)); // scorePile is stale after restore
```
After restore, the handler fires on the new tree but moves the card into an orphaned parent — the card vanishes from the serialized tree with no error. Handlers that go through re-resolved game attributes (`this.scorePile`) or `ctx`/`element.game` queries are safe, which is why `handler-restore.test.ts` (whose handlers only touch `this.enterCount`) passes. This constraint is not documented anywhere (not in `docs/common-pitfalls.md`, not on `onEnter`/`onExit` JSDoc).
**Fix:** Document the constraint on `Space.onEnter`/`onExit` and in `docs/common-pitfalls.md` ("handlers must reach elements via `element.game` / game attributes, never via captured locals"), and/or detect it: in dev mode, after re-binding, a `putInto` targeting a parent whose root is not the current game could `devWarn` ("element moved into a detached tree — a restored onEnter/onExit handler is probably holding a stale reference").

### WR-04: Stateless ops read `teachingDisabled` from `gameOptions`, contradicting the D-01 collision-avoidance decision

**File:** `src/session/stateless-ops.ts:566-568, 633-635, 1080-1083`
**Issue:** `GameSessionOptions.teachingDisabled` is documented as deliberately **separate** from `gameOptions` because "keeping it separate from `gameOptions` prevents collision with a game that names its own option `teachingDisabled` (D-01)" (`game-session.ts:126-132`). The stateless executor gates hint/heatmap/startTutorial on `gameOptions.teachingDisabled` — the exact collision D-01 forbids: a game that defines its own `teachingDisabled` game option would lock out (or unlock) assist features in the stateless path, diverging from `GameSession` behavior for the same game. Additionally, since `gameOptions` is passed into the Game constructor by `handleStart`, the host flag flows into `_constructorOptions` → `snapshot.gameOptions` and persists inside game state, unlike the session path where it lives only in `StoredGameState`.
**Fix:** Thread the lockout as a dedicated `executeOp` parameter (or a field on `GameDefinitionLike`/an options envelope distinct from game options), mirroring how `pendingState` is threaded, and strip it before constructing runners.

## Info

### IN-01: `buildPlayerState`'s `playerNames` parameter is dead

**File:** `src/session/utils.ts:219-224`
**Issue:** The `playerNames: string[]` parameter is never referenced in the function body (names come from the filtered view / `player.name`). Every caller threads it anyway — `stateless-ops.ts` passes `[]` in seven places, `game-session.ts`/`state-history.ts`/`pending-action-manager.ts` pass `this.#storedState.playerNames` in ~10 places — implying it affects output when it does not (misleading API; a lobby rename that only updates `storedState.playerNames` will not change broadcast names, which callers might reasonably expect).
**Fix:** Remove the parameter (No-Backward-Compatibility rule) or actually use it as a name override for the `players` fallback entries.

### IN-02: Anonymized placeholder ID scheme can collide for large zones

**File:** `src/engine/element/game.ts:2760, 2785`
**Issue:** Hidden-zone child placeholders use `id: -(element._t.id * 1000 + i)`. A zone with ≥1000 hidden children overflows into the ID range of element `_t.id + 1`'s zone, producing duplicate negative IDs across containers in a single view — breaking client-side keying/diffing (`computeElementDiff` keys by id). Unlikely for typical games, but a 1000+ card deck is not absurd.
**Fix:** Derive from a wider stride or a per-view counter, e.g. `-(element._t.id * 100000 + i)` with a documented cap, or a monotonically decreasing per-serialization counter.

### IN-03: A restored session can never re-enable `debugEnabled`

**File:** `src/session/game-session.ts:784-841`
**Issue:** `GameSession.restore()` has no `debugEnabled` parameter and passes nothing to the constructor (defaults to `false`). This is the correct secure default, but it means a trusted local dev harness that restores a session loses debug-panel `customDebug` with no way to opt back in (asymmetric with `create()`, and with how `botAIConfig`/`tutorial`/`onPersistenceError` are all re-suppliable on restore).
**Fix:** If intentional, document it on `restore()`'s JSDoc; otherwise add an optional `debugEnabled` parameter (still defaulting to `false`).

### IN-04: 13-positional-parameter private constructor invites silent argument drift

**File:** `src/session/game-session.ts:326-340, 763, 839`
**Issue:** The private constructor takes 13 positional parameters, several optional and same-typed; call sites pass `undefined, undefined` placeholders, and `restore()` already silently omits the trailing `debugEnabled` (see IN-03). Any future insertion in the middle would type-check while shifting semantics (e.g. `teachingDisabled` and `debugEnabled` are both `boolean | undefined`).
**Fix:** Collapse the tail into a single options object (`{ botAIConfig?, teachingDisabled?, debugEnabled?, onPersistenceError? }`).

---

_Reviewed: 2026-07-02_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
