# Phase 85: Theatre Erasure - Research

**Researched:** 2026-02-07
**Domain:** Code removal -- theatre view, mutation capture, acknowledgment protocol
**Confidence:** HIGH

## Summary

This phase removes the v2.9 theatre view system -- a server-side mechanism where the game maintains a frozen snapshot (`_theatreSnapshot`) of state, captures mutations during `animate()` callbacks, and advances the snapshot per-event as clients send `acknowledgeAnimations` messages. The entire system (engine, session, server, client, UI) participates in this protocol, and all of it must be deleted.

The removal spans 7 modules: engine (core theatre + mutation capture logic), session (acknowledge delegation + theatre view broadcasting), server (WebSocket message handler), client (acknowledge method + type), and UI (currentView composable referencing theatre). Two source files are deleted entirely (`theatre-state.ts`, `mutation-capture.ts`). Two test files are deleted entirely. Significant code is removed from `game.ts` (approximately 400 lines), `game-session.ts`, `server/core.ts`, `client/game-connection.ts`, `client/vue.ts`, and `session/utils.ts`. The `animate()` method itself is ALSO removed (Phase 86 will rebuild a simpler version).

**Primary recommendation:** Work in dependency order: engine first (delete files, strip Game class), then session/server (remove acknowledge protocol), then client/UI (remove acknowledge wiring), then exports, then tests, then BREAKING.md. After each layer, run `tsc --noEmit` to find cascading references.

## Standard Stack

No new libraries needed. This is a deletion phase.

### Core
| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| TypeScript | existing | Compile-time verification of removal | `tsc --noEmit` finds all remaining references after deletion |
| vitest | existing | Test runner | Verify no regressions in non-theatre functionality |

**Installation:** None needed.

## Architecture Patterns

### Recommended Approach: Layer-by-Layer Deletion

The theatre system spans 5 layers. Delete bottom-up:

```
Layer 1: Engine (core)
  - Delete mutation-capture.ts (types + MutationCaptureContext)
  - Delete theatre-state.ts (applicators + tree helpers)
  - Strip Game class of all theatre code

Layer 2: Engine (element hooks)
  - Remove _captureContext checks from game-element.ts create()
  - Remove _captureContext checks from piece.ts putInto()

Layer 3: Session + Server
  - Remove acknowledgeAnimations() from GameSession
  - Remove acknowledgeAnimations handler from server/core.ts
  - Simplify buildPlayerState() to use toJSONForPlayer() directly (no theatre)

Layer 4: Client
  - Remove acknowledgeAnimations() from GameConnection
  - Remove acknowledgeAnimations from useGame return
  - Remove acknowledgeAnimations from client types

Layer 5: UI
  - Remove currentView composable (useCurrentView.ts)
  - Remove CURRENT_VIEW_KEY provide from GameShell
  - Remove acknowledge callback from GameShell animation events wiring

Layer 6: Exports + Tests
  - Clean up engine/element/index.ts, engine/index.ts, ui/index.ts exports
  - Delete theatre-state.test.ts, mutation-capture.test.ts
  - Delete theatre-related sections from animation-events.test.ts (both engine + session)
  - Delete useCurrentView.test.ts

Layer 7: Documentation
  - Create BREAKING.md
```

### Pattern 1: TypeScript-Driven Deletion

**What:** Use `tsc --noEmit` after each deletion to find all remaining references.
**When to use:** After every file or method removal.
**Why:** TypeScript will flag every compile error caused by a missing type, method, or import. This is faster and more reliable than grep.

### Pattern 2: Preserve animate() Signature Temporarily

**What:** Phase 85 removes the ENTIRE `animate()` method from Game. Phase 86 will add back a simpler version. Between phases 85 and 86, `game.animate()` will not exist.
**When to use:** This is the clean break approach specified in the roadmap.
**Why:** The old `animate()` does mutation capture, theatre snapshot init, property diffing, and element attribute diffing. None of this survives into v3.0. Phase 86 builds `game.animate(type, data)` as a pure data event emitter.

**Important implication:** All test files that call `game.animate()` will break after Phase 85. This is expected -- Phase 86 rebuilds the method, and tests will be written then. Phase 85 should delete all tests that depend on `animate()` since they test the old mutation-capture behavior.

### Anti-Patterns to Avoid
- **Leaving stubs:** Do not leave empty `acknowledgeAnimationEvents()` methods. Delete completely.
- **Partial export cleanup:** Every import chain (element/index -> engine/index -> ui/index) must be cleaned. Missing one causes confusing re-export errors.
- **Forgetting element hooks:** The `_captureContext` checks in `game-element.ts` `create()` and `piece.ts` `putInto()` are easy to miss because they are in different files from the main theatre code.

## Complete Inventory: All Code to Remove

### Files to DELETE Entirely (4 files)

| File | Lines | Content |
|------|-------|---------|
| `src/engine/element/theatre-state.ts` | 159 | Theatre state applicators, tree helpers, mutation dispatcher |
| `src/engine/element/mutation-capture.ts` | 79 | CapturedMutation types, MutationCaptureContext interface |
| `src/engine/element/theatre-state.test.ts` | 1057 | All theatre state tests (unit + integration) |
| `src/engine/element/mutation-capture.test.ts` | 569 | All mutation capture tests |

### Files to DELETE Entirely (Theatre-Related, Phase 89 Scope)

The following files reference theatre concepts but are scoped to Phase 89 (UI Integration), NOT Phase 85. Phase 85 should NOT delete these -- they will be removed or modified in Phase 89:

| File | Reason to Defer |
|------|----------------|
| `src/ui/composables/useCurrentView.ts` | Phase 89 requirement CLI-11 |
| `src/ui/composables/useCurrentView.test.ts` | Phase 89 requirement CLI-11 |

**However**, these files will not compile after Phase 85 removes the theatre types they reference. The pragmatic approach: Phase 85 removes the word "theatre" from comments in these files but keeps them functionally intact. OR, Phase 85 removes them entirely since they are dead code once the theatre system is gone.

**Recommendation:** Remove `useCurrentView.ts` and `useCurrentView.test.ts` in Phase 85. They are dead code once theatre is gone, and the roadmap's Phase 89 simply won't need to do CLI-11 because it is already done. This avoids leaving broken code between phases.

### `src/engine/element/game.ts` -- Code to Remove

| Section | Lines (approx) | What |
|---------|----------------|------|
| Import of CapturedMutation types | L11 | `import type { CapturedMutation, MutationCaptureContext, SetPropertyMutation, SetAttributeMutation }` |
| Import of applyMutations | L12 | `import { applyMutations } from './theatre-state.js'` |
| `mutations` field on AnimationEvent interface | L163 | `mutations?: CapturedMutation[]` |
| `_theatreSnapshot` property | L339 | Private property declaration |
| `_captureContext` property | L343 | Public property declaration |
| `_safeProperties` entries | L357 | `'_captureContext', '_theatreSnapshot'` |
| `unserializableAttributes` entries | L371-372 | `'_captureContext', '_theatreSnapshot'` |
| `animate()` method (entire) | L2374-2422 | Method with mutation capture, theatre snapshot init, property/attr diffing |
| `_snapshotCustomProperties()` | L2428-2449 | Private method for property diffing |
| `_diffCustomProperties()` | L2455-2476 | Private method for property diffing |
| `_snapshotElementAttributes()` | L2483-2517 | Private method for element attribute snapshot |
| `_diffElementAttributes()` | L2522-2552 | Private method for element attribute diffing |
| `pendingAnimationEvents` getter | L2562-2564 | Getter that returns pending events |
| `theatreState` getter | L2572-2574 | Theatre state getter |
| `theatreStateForPlayer()` method | L2589-2723 | Entire visibility-filtering method for theatre |
| `acknowledgeAnimationEvents()` method | L2744-2765 | Acknowledge method with mutation application |
| `toJSON()` theatre fields | L2781, L2794-2797 | `theatreSnapshot` in return type and serialization |
| `restoreGame()` theatre restoration | L2968-2971 | Theatre snapshot restoration from JSON |

**Also remove from game.ts:**
| Section | What |
|---------|------|
| `_animationEvents` property | L332 -- animation events buffer |
| `_animationEventSeq` property | L335 -- sequence counter |
| `toJSON()` animation event fields | L2789-2793 -- conditional animation event serialization |
| `restoreGame()` animation event restoration | L2962-2966 -- animation event restoration |
| `AnimationEvent` interface | L155-166 -- the type definition |

**WAIT -- CRITICAL DISTINCTION:** The `AnimationEvent` interface, `_animationEvents` buffer, `_animationEventSeq`, `pendingAnimationEvents` getter, and basic animate/acknowledge behavior are the ANIMATION EVENT SYSTEM, not the theatre system. Phase 86 rebuilds `animate()` and Phase 87/88 handle the event pipeline.

**Revised approach for game.ts:** Remove ONLY theatre-specific code:
- `_theatreSnapshot` property and all references
- `_captureContext` property and all references
- `theatreState` getter
- `theatreStateForPlayer()` method
- `acknowledgeAnimationEvents()` method (the theatre-advancing part)
- `_snapshotCustomProperties()`, `_diffCustomProperties()`, `_snapshotElementAttributes()`, `_diffElementAttributes()` (mutation capture machinery)
- `animate()` method (contains mutation capture machinery)
- Theatre snapshot in `toJSON()` and `restoreGame()`
- Imports from `theatre-state.ts` and `mutation-capture.ts`
- `mutations` field on AnimationEvent interface

**Keep (for Phase 86 to rebuild on top of):**
- `_animationEvents` buffer
- `_animationEventSeq` counter
- `pendingAnimationEvents` getter
- `AnimationEvent` interface (without `mutations` field)
- Animation event serialization in `toJSON()` and `restoreGame()`
- Basic `acknowledgeAnimationEvents()` buffer clearing (without theatre mutation application)

**Actually -- re-reading the roadmap more carefully:**

Phase 86 says: "Animation events appear as entries on the command stack." This is a fundamentally different storage mechanism than the current `_animationEvents` buffer. Phase 86 will likely remove the buffer and replace it with command stack entries.

**Final decision:** Remove `animate()` entirely. Keep `_animationEvents`, `_animationEventSeq`, `pendingAnimationEvents`, `acknowledgeAnimationEvents()` (stripped of theatre logic, keeping only buffer clearing), and `AnimationEvent` interface (without mutations). Phase 86 will then refactor these remaining pieces.

### `src/engine/element/game-element.ts` -- Code to Remove

| Section | Lines | What |
|---------|-------|------|
| CREATE mutation recording in `create()` | L249-272 | `if (this.game._captureContext)` block |

### `src/engine/element/piece.ts` -- Code to Remove

| Section | Lines | What |
|---------|-------|------|
| MOVE mutation recording in `putInto()` | L74-83 | `if (this.game._captureContext)` block |

### `src/session/game-session.ts` -- Code to Remove

| Section | Lines | What |
|---------|-------|------|
| `acknowledgeAnimations()` method | L825-832 | Entire method |

### `src/session/utils.ts` -- Code to Modify

| Section | Lines | What |
|---------|-------|------|
| `buildPlayerState()` theatre view | L354-361 | Replace `theatreStateForPlayer()` with `toJSONForPlayer()`. Remove `currentView` computation. |

### `src/session/types.ts` -- Code to Remove

| Section | Lines | What |
|---------|-------|------|
| `currentView` on PlayerGameState | L415-418 | Remove field and comment |
| `acknowledgeAnimations` from WebSocketMessage type | L534 | Remove from union |
| `upToId` field | L553-554 | Remove field |

### `src/server/core.ts` -- Code to Remove

| Section | Lines | What |
|---------|-------|------|
| `acknowledgeAnimations` case block | L770-788 | Entire case in switch statement |

### `src/client/game-connection.ts` -- Code to Remove

| Section | Lines | What |
|---------|-------|------|
| `acknowledgeAnimations()` method | L163-171 | Entire method |

### `src/client/types.ts` -- Code to Remove

| Section | Lines | What |
|---------|-------|------|
| `currentView` on PlayerGameState | L123-126 | Remove field and comment |
| `acknowledgeAnimations` from message type | L232 | Remove from union |
| `upToId` field | L237 | Remove field |

### `src/client/vue.ts` -- Code to Remove

| Section | Lines | What |
|---------|-------|------|
| `acknowledgeAnimations` type declaration | L56 | Remove from interface |
| `acknowledgeAnimations` implementation | L213-215 | Remove function |
| `acknowledgeAnimations` return value | L228 | Remove from return object |

### `src/ui/components/GameShell.vue` -- Code to Modify

| Section | Lines | What |
|---------|-------|------|
| `acknowledgeAnimations` destructuring | L162 | Remove from useGame destructure |
| Acknowledge callback in createAnimationEvents | L171 | Remove acknowledge callback (but keep createAnimationEvents -- Phase 89 handles full removal) |
| CURRENT_VIEW_KEY import | L22 | Remove import |
| currentGameView computed | L216-221 | Remove computed |
| provide(CURRENT_VIEW_KEY, ...) | L222 | Remove provide |

**Note on GameShell:** The `createAnimationEvents` call currently passes `acknowledge` callback. After Phase 85, the acknowledge function no longer exists on useGame. The `createAnimationEvents` composable still expects an `acknowledge` option. Phase 85 should provide a no-op: `acknowledge: () => {}` -- or Phase 85 can modify `createAnimationEvents` to make `acknowledge` optional with a no-op default. Phase 89 will do the full removal.

### `src/engine/element/index.ts` -- Export Changes

| Line | Before | After |
|------|--------|-------|
| L26 | `export type { CapturedMutation, CreateMutation, MoveMutation, SetAttributeMutation, SetPropertyMutation, MutationCaptureContext } from './mutation-capture.js'` | DELETE entirely |
| L27 | `export { applyMutation, applyMutations, findElementById, removeElementFromParent } from './theatre-state.js'` | DELETE entirely |

### `src/engine/index.ts` -- Export Changes

| Lines | Before | After |
|-------|--------|-------|
| L44-51 | Re-export of CapturedMutation types | DELETE entirely |
| L53 | Re-export of applyMutation, applyMutations, etc. | DELETE entirely |

### `src/ui/index.ts` -- Export Changes

| Line | Before | After |
|------|--------|-------|
| L117 | `export { useCurrentView, CURRENT_VIEW_KEY }` | DELETE if removing useCurrentView in this phase |

### Test Files to DELETE or Modify

| File | Action | Reason |
|------|--------|--------|
| `src/engine/element/theatre-state.test.ts` | DELETE | Tests deleted production code |
| `src/engine/element/mutation-capture.test.ts` | DELETE | Tests deleted production code |
| `src/engine/element/animation-events.test.ts` | MODIFY | Keep basic animate/acknowledge tests but remove mutation references. Actually, `animate()` is being removed, so most tests break. Keep only `pendingAnimationEvents` and `acknowledgeAnimationEvents` buffer tests (non-theatre). See detailed analysis below. |
| `src/session/animation-events.test.ts` | MODIFY | Remove theatre view tests (second half). Keep basic animation event lifecycle tests (first half). |
| `src/ui/composables/useCurrentView.test.ts` | DELETE | Tests deleted composable |
| `src/ui/composables/useAnimationEvents.test.ts` | MODIFY | Remove acknowledgment tests (acknowledge callback becomes no-op). Actually, keep tests -- they test the composable which still exists. Just need to ensure the acknowledge callback is still accepted (even if it does nothing server-side). Phase 89 handles full removal. |

### `animation-events.test.ts` (engine) -- Detailed Analysis

This file has 4 describe blocks:
1. `animate` (L14-58) -- Tests `game.animate()` which is being removed. **DELETE or rewrite for Phase 86.**
2. `pendingAnimationEvents` (L61-83) -- Tests the buffer getter. Uses `game.animate()`. **DELETE** (Phase 86 rebuilds).
3. `acknowledgeAnimationEvents` (L86-127) -- Tests buffer clearing. Uses `game.animate()`. **Keep concept, rewrite for Phase 86.**
4. `serialization` (L129-198) -- Tests serialize/restore of animation events. Uses `game.animate()`. **DELETE** (Phase 86 rebuilds).

**Recommendation:** Delete the entire file. Phase 86 will create new tests for the rebuilt `animate()` API.

### `animation-events.test.ts` (session) -- Detailed Analysis

This file has two major sections:
1. `Session Animation Events` (L39-158) -- Tests `buildPlayerState()` animation fields and `acknowledgeAnimations()`. **Modify**: Remove `acknowledgeAnimations` tests, keep basic animation event presence tests.
2. `Theatre view in PlayerGameState` (L207-312) -- Tests theatre view, currentView, acknowledge advancement. **DELETE entirely.**

### Documentation to Reference in BREAKING.md

| Doc File | Lines | What References Theatre |
|----------|-------|------------------------|
| `docs/ui-components.md` | L1096-1177 | Animation Events section -- theatre view, mutation capture, acknowledgeAnimations |
| `docs/nomenclature.md` | L10, L433-493 | Animation Event, Soft Continuation, Theatre View, Current View, Mutation Capture terms |

**Note:** Documentation updates are deferred to Phase 90. Phase 85 only creates BREAKING.md. The docs will be temporarily inaccurate.

### Example Games -- Comments Only

| File | What | Action |
|------|------|--------|
| `~/BoardSmithGames/cribbage/src/rules/game.ts:595` | Comment mentioning "theatre view" | Defer to Phase 90 |
| `~/BoardSmithGames/demo-animation/src/rules/actions.ts:312` | Comment mentioning "theatre view" | Defer to Phase 90 |
| `~/BoardSmithGames/cribbage/src/ui/components/CribbageBoard.vue:286` | Comment mentioning "acknowledgeAnimations" | Defer to Phase 90 |

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Finding all references | Manual grep | `tsc --noEmit` | TypeScript compiler catches every broken reference across the entire codebase |
| Verifying completeness | Code review alone | `vitest run` after each layer | Tests reveal runtime dependencies grep misses |
| Migration documentation | Write from scratch | Reference the inventory above | Every API, method, and type is already catalogued |

**Key insight:** This is a deletion phase. The risk is not "building wrong" but "missing a reference." TypeScript is the primary tool -- it will find everything that breaks when code is deleted.

## Common Pitfalls

### Pitfall 1: animate() Removal Breaks Everything
**What goes wrong:** Removing `animate()` from Game makes virtually every animation-related test fail, including tests that aren't "theatre" tests per se.
**Why it happens:** The current `animate()` is the ONLY way to create animation events. Every test that creates events uses `animate()`.
**How to avoid:** Accept that Phase 85 will remove `animate()` and most animation tests will be deleted. Phase 86 rebuilds both the method and the tests. The key verification is that NON-animation tests still pass.
**Warning signs:** Test count drops significantly (expected -- from 633 to roughly 400-500).

### Pitfall 2: buildPlayerState() Breaks Without theatreStateForPlayer()
**What goes wrong:** `buildPlayerState()` in `session/utils.ts` calls `runner.game.theatreStateForPlayer()`. Removing that method without updating buildPlayerState breaks the entire session layer.
**Why it happens:** The session layer is the primary consumer of theatre state.
**How to avoid:** Update `buildPlayerState()` simultaneously -- replace `theatreStateForPlayer()` with `toJSONForPlayer()` and remove `currentView` computation.
**Warning signs:** Session tests failing, player state not being built.

### Pitfall 3: GameShell Depends on acknowledgeAnimations from useGame
**What goes wrong:** GameShell destructures `acknowledgeAnimations` from `useGame()` and passes it to `createAnimationEvents()`. Removing it from useGame breaks GameShell.
**Why it happens:** The UI layer is tightly coupled to the acknowledge protocol.
**How to avoid:** Remove the acknowledge wiring from GameShell. Pass a no-op to `createAnimationEvents` for the acknowledge callback (since the composable requires it until Phase 89 removes it).
**Warning signs:** GameShell component failing to initialize.

### Pitfall 4: Export Chain Breakage
**What goes wrong:** Removing `mutation-capture.ts` and `theatre-state.ts` breaks `element/index.ts` which breaks `engine/index.ts` which breaks `ui/index.ts`.
**Why it happens:** Three-level export chain: element -> engine -> ui.
**How to avoid:** Clean all three levels in the same commit. Start from the leaf (element/index.ts) and work outward.
**Warning signs:** "Module not found" errors that cascade.

### Pitfall 5: Element Hooks Left Behind
**What goes wrong:** The `_captureContext` checks in `game-element.ts` `create()` and `piece.ts` `putInto()` reference `game._captureContext` which no longer exists on Game.
**Why it happens:** These hooks are in different files from the main theatre code and easy to miss in a grep for "theatre".
**How to avoid:** Search for `_captureContext` across the entire codebase. There are exactly 3 files: `game.ts`, `game-element.ts`, `piece.ts`.
**Warning signs:** TypeScript errors about `_captureContext` not existing on Game.

### Pitfall 6: Keeping Dead Animation Event Infrastructure
**What goes wrong:** Keeping `_animationEvents`, `pendingAnimationEvents`, `acknowledgeAnimationEvents()`, and `AnimationEvent` interface after removing `animate()` leaves dead code that nothing can populate.
**Why it happens:** The instinct is to keep infrastructure that Phase 86 will "build on."
**How to avoid:** Keep the buffer infrastructure (`_animationEvents`, `_animationEventSeq`, `pendingAnimationEvents`, `AnimationEvent` type without mutations). Strip `acknowledgeAnimationEvents()` to just buffer clearing (no theatre mutation application). Phase 86 will add the new `animate()` method that populates the buffer.
**Warning signs:** Dead code that can't be tested.

## Code Examples

### buildPlayerState() After Removal

```typescript
// Before (session/utils.ts):
const theatreView = runner.game.theatreStateForPlayer(playerPosition);
const hasPendingAnimations = runner.game.pendingAnimationEvents.length > 0;
const currentView = hasPendingAnimations
  ? runner.getPlayerView(playerPosition).state
  : undefined;

// ...
const state: PlayerGameState = {
  // ...
  view: theatreView,
  ...(currentView !== undefined && { currentView }),
};

// After:
const view = runner.getPlayerView(playerPosition).state;

// ...
const state: PlayerGameState = {
  // ...
  view,
  // currentView removed entirely
};
```

### acknowledgeAnimationEvents() After Removal

```typescript
// Before (game.ts):
acknowledgeAnimationEvents(upToId: number): void {
  if (this._theatreSnapshot) {
    const eventsToAck = this._animationEvents
      .filter(e => e.id <= upToId)
      .sort((a, b) => a.id - b.id);
    for (const event of eventsToAck) {
      if (event.mutations) {
        applyMutations(this._theatreSnapshot, event.mutations);
      }
    }
  }
  this._animationEvents = this._animationEvents.filter(e => e.id > upToId);
  if (this._animationEvents.length === 0) {
    this._theatreSnapshot = null;
  }
}

// After (simplified -- just buffer clearing):
acknowledgeAnimationEvents(upToId: number): void {
  this._animationEvents = this._animationEvents.filter(e => e.id > upToId);
}
```

### AnimationEvent Interface After Removal

```typescript
// Before:
export interface AnimationEvent {
  id: number;
  type: string;
  data: Record<string, unknown>;
  timestamp: number;
  group?: string;
  mutations?: CapturedMutation[];
}

// After (mutations field removed):
export interface AnimationEvent {
  id: number;
  type: string;
  data: Record<string, unknown>;
  timestamp: number;
  group?: string;
}
```

### Game Class Property Cleanup

```typescript
// Remove these properties:
private _theatreSnapshot: ReturnType<Game['toJSON']> | null = null;
_captureContext: MutationCaptureContext | null = null;

// Remove from _safeProperties:
'_captureContext', '_theatreSnapshot',

// Remove from unserializableAttributes:
'_captureContext', '_theatreSnapshot',
```

### toJSON() After Removal

```typescript
// Before:
return {
  ...super.toJSON(),
  phase: this.phase,
  // ...
  ...(this._animationEvents.length > 0 && {
    animationEvents: this._animationEvents,
    animationEventSeq: this._animationEventSeq,
  }),
  ...(this._theatreSnapshot && {
    theatreSnapshot: this._theatreSnapshot,
  }),
};

// After:
return {
  ...super.toJSON(),
  phase: this.phase,
  // ...
  ...(this._animationEvents.length > 0 && {
    animationEvents: this._animationEvents,
    animationEventSeq: this._animationEventSeq,
  }),
  // theatreSnapshot removed entirely
};
```

### BREAKING.md Template

```markdown
# Breaking Changes

## v3.0 - Animation Timeline

### Removed: Theatre View System

The server-side theatre view system has been removed. Animation playback
is now 100% client-owned.

#### Removed APIs

| API | Module | Replacement |
|-----|--------|-------------|
| `game.theatreState` | engine | Use `game.toJSON()` (truth is the only view) |
| `game.theatreStateForPlayer(seat)` | engine | Use `game.toJSONForPlayer(seat)` |
| `game.acknowledgeAnimationEvents(id)` | engine | No replacement -- client manages playback |
| `game._captureContext` | engine | Removed -- no mutation capture |
| `GameSession.acknowledgeAnimations()` | session | Removed -- server doesn't track playback |
| `acknowledgeAnimations` WebSocket message | server | Removed -- server doesn't accept it |
| `GameConnection.acknowledgeAnimations()` | client | Removed -- client manages playback locally |
| `useCurrentView()` | ui | Removed -- single truth view |
| `CURRENT_VIEW_KEY` | ui | Removed |
| `CapturedMutation` type | engine | Removed |
| `MutationCaptureContext` type | engine | Removed |
| `applyMutation()` | engine | Removed |
| `applyMutations()` | engine | Removed |
| `findElementById()` | engine | Removed (was only for theatre snapshot trees) |
| `removeElementFromParent()` | engine | Removed |

#### Removed: Mutation Capture

The `mutations` field on `AnimationEvent` has been removed. Animation
events are now pure data -- they carry `type` and `data` only.

**Before (v2.9):**
```typescript
game.animate('combat', { damage: 5 }, () => {
  target.health -= damage;  // Captured as SET_ATTRIBUTE mutation
  target.putInto(graveyard); // Captured as MOVE mutation
});
// event.mutations = [{ type: 'SET_ATTRIBUTE', ... }, { type: 'MOVE', ... }]
```

**After (v3.0):**
```typescript
game.animate('combat', { damage: 5 });
// event = { type: 'combat', data: { damage: 5 } }
// Mutations happen via normal game code, not inside animate callback
```

#### Removed: Acknowledgment Protocol

The server no longer tracks animation playback state. The client plays
animations at its own pace.

**Before (v2.9):**
```typescript
// Client sends:
ws.send({ type: 'acknowledgeAnimations', upToId: 5 });
// Server updates theatre snapshot, broadcasts new state
```

**After (v3.0):**
```typescript
// Client manages playback locally -- no server communication needed
// UI shows truth immediately, animations are visual-only
```

#### Removed: currentView / Theatre View Split

`PlayerGameState` no longer has separate `view` (theatre) and
`currentView` (truth) fields. There is only `view`, and it is truth.

**Before (v2.9):**
```typescript
state.view       // Theatre state (frozen during animation)
state.currentView // Truth (only when animations pending)
```

**After (v3.0):**
```typescript
state.view // Truth (always current)
```
```

## State of the Art

| Old Approach | Current Approach (v3.0) | When Changed | Impact |
|--------------|------------------------|--------------|--------|
| Server-side theatre snapshot | Client-side animation timeline | v3.0 | Server never waits on animations |
| Mutation capture in animate() | Pure data events | v3.0 | Simpler API, no diffing overhead |
| acknowledgeAnimations protocol | No server acknowledgment | v3.0 | Reduced wire traffic, simpler protocol |
| Theatre/truth view split | Single truth view | v3.0 | Simpler state model, no currentView |
| Server advances per-event | Client plays at own pace | v3.0 | No chicken-and-egg with component mounting |

## Open Questions

1. **Should useCurrentView.ts be removed in Phase 85 or Phase 89?**
   - What we know: Phase 89 has CLI-11 requirement "Remove useCurrentView composable." But once theatre is gone, the composable is dead code that references nonexistent concepts.
   - What's unclear: Whether Phase 89 expects this file to still exist.
   - Recommendation: Remove it in Phase 85. It is dead code after theatre removal. Phase 89 can skip CLI-11 if already done.

2. **Should useAnimationEvents acknowledge callback be modified in Phase 85?**
   - What we know: `createAnimationEvents` requires `acknowledge` callback. GameShell passes `acknowledgeAnimations` from useGame. After Phase 85, useGame no longer provides `acknowledgeAnimations`.
   - What's unclear: Whether to modify useAnimationEvents to make acknowledge optional, or pass a no-op in GameShell.
   - Recommendation: Pass a no-op `() => {}` in GameShell for the acknowledge callback. This is minimal change and Phase 89 will do the full cleanup (CLI-10: "Remove acknowledgment callback from createAnimationEvents").

3. **What about the animation-events test files?**
   - What we know: `animation-events.test.ts` (engine) tests `animate()`, `pendingAnimationEvents`, and `acknowledgeAnimationEvents`. All use `game.animate()` which is being removed. `animation-events.test.ts` (session) has both generic animation lifecycle tests and theatre-specific tests.
   - Recommendation: Delete `animation-events.test.ts` (engine) entirely -- Phase 86 will rebuild tests. Modify `animation-events.test.ts` (session) to remove theatre-view tests (second half) and update the first half to not use game.animate() directly (or delete the file if all tests depend on animate).

4. **How many tests should pass after Phase 85?**
   - Current baseline: 633 tests pass.
   - Files to delete: theatre-state.test.ts (~50 tests), mutation-capture.test.ts (~40 tests), animation-events.test.ts engine (~20 tests), useCurrentView.test.ts (~5 tests).
   - Files to modify: animation-events.test.ts session (remove ~10 theatre tests).
   - Expected remaining: ~520-530 tests should pass.
   - Key metric: ALL non-animation tests must pass with zero regressions.

## Sources

### Primary (HIGH confidence)
- `src/engine/element/game.ts` -- Direct source code inspection, all theatre methods and properties
- `src/engine/element/theatre-state.ts` -- Full file read, 159 lines
- `src/engine/element/mutation-capture.ts` -- Full file read, 79 lines
- `src/engine/element/game-element.ts` -- Capture context hooks at L249-272
- `src/engine/element/piece.ts` -- Capture context hooks at L74-83
- `src/engine/element/index.ts` -- Export definitions
- `src/engine/index.ts` -- Re-export definitions
- `src/session/game-session.ts` -- acknowledgeAnimations at L825-832
- `src/session/utils.ts` -- buildPlayerState theatre view at L354-361
- `src/session/types.ts` -- PlayerGameState type, WebSocketMessage type
- `src/server/core.ts` -- acknowledgeAnimations handler at L770-788
- `src/client/game-connection.ts` -- acknowledgeAnimations at L163-171
- `src/client/types.ts` -- PlayerGameState, WebSocketOutgoingMessage
- `src/client/vue.ts` -- useGame acknowledgeAnimations
- `src/ui/components/GameShell.vue` -- Acknowledge wiring at L162-173
- `src/ui/composables/useCurrentView.ts` -- Full file read
- `src/ui/composables/useAnimationEvents.ts` -- Acknowledge callback usage
- `src/ui/index.ts` -- Export definitions
- `src/engine/element/theatre-state.test.ts` -- Full file read, 1057 lines
- `src/engine/element/mutation-capture.test.ts` -- Full file read, 569 lines
- `src/engine/element/animation-events.test.ts` -- Full file read, 199 lines
- `src/session/animation-events.test.ts` -- Full file read, 313 lines
- `src/ui/composables/useCurrentView.test.ts` -- Full file read, 69 lines
- `.planning/milestones/v3.0-ROADMAP.md` -- Phase definitions and dependencies
- `.planning/REQUIREMENTS.md` -- Requirement definitions and phase mapping
- `docs/ui-components.md` -- Theatre references in animation docs
- `docs/nomenclature.md` -- Theatre terminology definitions
- Vitest baseline: 633 tests passing (24 test files)

## Metadata

**Confidence breakdown:**
- Code inventory: HIGH -- exhaustive grep and file reads across all 12 modules
- Dependency order: HIGH -- traced imports and references through all layers
- Test impact: HIGH -- read all test files, counted affected tests
- BREAKING.md scope: HIGH -- every removed API catalogued with before/after
- Edge cases (element hooks): HIGH -- found all 3 files with _captureContext usage

**Research date:** 2026-02-07
**Valid until:** Indefinite (codebase-specific, not library-version-dependent)
