# Phase 82: Session Integration - Research

**Researched:** 2026-02-07
**Domain:** Session-layer theatre state broadcasting and per-player visibility filtering
**Confidence:** HIGH

## Summary

Phase 82 integrates the theatre state engine (Phase 81) into the session layer so that `buildPlayerState()` sends the theatre view as the primary `view` field, with the current (truth) view available as an opt-in field. The session already broadcasts state via `broadcast()` which iterates over connected sessions and calls `buildPlayerState()` for each, so the integration points are well-defined.

The central challenge is **per-player visibility filtering of the theatre snapshot**. The existing `toJSONForPlayer()` method walks the live element tree and the JSON tree in parallel (matching `json.children[i]` to `element._t.children[i]`), querying `element.isVisibleTo()` and `element.getEffectiveVisibility()` on live objects. The theatre snapshot is plain `ElementJSON` -- it has no live element objects. When animations are pending, the theatre snapshot may have elements in different positions than truth (a card not yet moved in theatre vs. already moved in truth), so the live element tree cannot be walked in parallel with the theatre snapshot.

The solution is to add a `theatreStateForPlayer(playerSeat)` method to the Game class that applies visibility filtering to the theatre snapshot using a JSON-only approach. Since visibility rules (zone visibility modes, per-element visibility, ownership) are set at game setup time and do not change during animate() callbacks, we can snapshot the visibility metadata alongside the element tree or use the live element tree's visibility configuration to build a filter map (element ID to visibility state) that can be applied to any JSON tree including the theatre snapshot.

**Primary recommendation:** Add `Game.theatreStateForPlayer(playerSeat)` that applies visibility filtering to the theatre snapshot. In `buildPlayerState()`, use `game.theatreState` (or `theatreStateForPlayer`) for the primary `view` field, and include `game.toJSONForPlayer()` as a `currentView` opt-in field. The `acknowledgeAnimations()` method already exists in GameSession; extend it to trigger rebroadcast (it already does).

## Standard Stack

No external libraries needed. This is pure session-layer integration using existing infrastructure.

### Core Files to Modify

| File | Purpose | Change Scope |
|------|---------|-------------|
| `src/session/utils.ts` | `buildPlayerState()` -- switch primary `view` to theatre state, add `currentView` field | Major |
| `src/session/types.ts` | `PlayerGameState` -- add `currentView` field | Minor |
| `src/engine/element/game.ts` | Add `theatreStateForPlayer()` method for per-player filtered theatre view | Medium |
| `src/session/game-session.ts` | `acknowledgeAnimations()` -- confirm rebroadcast behavior (already works) | Minor verification |

### Files That May Need Updates

| File | Impact | Reason |
|------|--------|--------|
| `src/engine/utils/snapshot.ts` | Minor | `createPlayerView()` might need to use theatre state for its `state` field |
| `src/engine/index.ts` | Trivial | May need to export `theatreStateForPlayer` if not already visible |
| `src/types/protocol.ts` | Possible | If `PlayerGameState` equivalent is defined here too |
| `src/session/animation-events.test.ts` | Extend | Add tests for theatre view in player state |

### Files That Do NOT Need Changes

| File | Reason |
|------|--------|
| `src/engine/element/theatre-state.ts` | Mutation applicators are complete from Phase 81 |
| `src/ui/composables/useAnimationEvents.ts` | Phase 83 concern -- UI composables |
| `src/runtime/runner.ts` | Runner delegates to game; no theatre awareness needed at runner level |

## Architecture Patterns

### Pattern 1: Theatre View as Primary, Current View as Opt-In

**What:** `PlayerGameState.view` becomes the theatre state (the "narrative" view reflecting only acknowledged events). A new `currentView` field carries the truth state for components that need it (AI decisions, post-game summary, debug).

**When to use:** Always. This is the core requirement (SES-01, SES-02).

**Current code in `buildPlayerState()`:**
```typescript
// Current (line 353, utils.ts):
const view = runner.getPlayerView(playerPosition);
// ...
state.view = view.state;  // This IS the current/truth view
```

**New pattern:**
```typescript
// Theatre view as default
const theatreView = runner.game.theatreStateForPlayer(playerPosition);

// Current view (truth) for opt-in consumers
const currentView = runner.getPlayerView(playerPosition);

const state: PlayerGameState = {
  // ... existing fields ...
  view: theatreView,           // Theatre state (default for rendering)
  currentView: currentView.state,  // Truth (opt-in for AI, scoring, debug)
};
```

**Key consideration:** When no animations are pending, `game.theatreState` falls through to `game.toJSON()` (Phase 81 behavior), so `theatreView` and `currentView` will be identical. The two fields only diverge when animations are in flight.

### Pattern 2: Per-Player Visibility Filtering on Theatre Snapshot

**What:** Apply per-player visibility rules to the theatre JSON snapshot without needing live element objects.

**Why this is hard:** `toJSONForPlayer()` walks `json.children[i]` and `element._t.children[i]` in parallel (game.ts line 2801-2804). It calls `element.isVisibleTo()`, `element.getEffectiveVisibility()`, `(element as any).getZoneVisibility?.()`, and `element.player?.seat`. These all require live `GameElement` instances. The theatre snapshot is plain JSON with no live objects.

**Why parallel traversal breaks:** When animations are pending, the theatre snapshot has elements in their pre-mutation positions. Truth (live game) has elements in post-mutation positions. Example: card C was in Deck A (theatre) but was moved to Deck B (truth). Walking `json.children[i]` / `element._t.children[i]` in parallel would mismatch children.

**Solution approach -- visibility map from live elements:**

Since visibility rules are set during `registerElements()` (game setup) and don't change during `animate()` callbacks, we can build a map of `elementId -> visibilityInfo` from the live element tree, then use that map to filter the theatre JSON.

```typescript
// On Game class:
theatreStateForPlayer(player: number | null): ElementJSON {
  const theatreJson = this.theatreState;

  // If no theatre snapshot exists, delegate to existing toJSONForPlayer
  if (!this._theatreSnapshot) {
    return this.toJSONForPlayer(player);
  }

  // Build visibility map from live elements
  const visMap = this._buildVisibilityMap(player);

  // Apply visibility filtering to theatre JSON using the map
  return this._filterJsonWithVisibilityMap(theatreJson, visMap, player);
}
```

The visibility map captures:
- Per-element: `{ visible: boolean, mode: 'hidden'|'count-only'|'visible'|'owner', ownerSeat?: number }`
- Per-zone (Space): zone visibility config for children
- Element class names and IDs for cross-referencing

**Alternative approach -- apply `toJSONForPlayer` to truth, then use theatre element positions:**

This is more complex and requires reconciling tree differences. The visibility map approach is simpler.

**Alternative approach -- filter theatre snapshot using live element lookup by ID:**

Since element IDs are stable (same ID in theatre and truth), we can filter the theatre JSON by looking up each element's visibility from the live tree by ID:

```typescript
function filterTheatreForPlayer(
  theatreJson: ElementJSON,
  game: Game,
  playerSeat: number | null
): ElementJSON {
  const visibilityPosition = playerSeat ?? -1;

  function filterNode(json: ElementJSON): ElementJSON | null {
    // Find the LIVE element with this ID to check its visibility
    const liveElement = game.atId(json.id);
    if (!liveElement) {
      // Element exists in theatre but not in truth (e.g., was created then removed)
      // Show it as-is since we can't determine visibility
      return json;
    }

    // Check visibility using live element's rules
    if (!liveElement.isVisibleTo(visibilityPosition)) {
      // Return hidden placeholder (same pattern as toJSONForPlayer)
      return {
        className: json.className,
        id: json.id,
        attributes: { __hidden: true },
      };
    }

    // Handle zone visibility for children
    const zoneVisibility = (liveElement as any).getZoneVisibility?.();
    if (zoneVisibility && /* zone filtering logic */) {
      // ... same as toJSONForPlayer but operating on theatre JSON children
    }

    // Filter children recursively
    const filteredChildren = json.children?.map(c => filterNode(c)).filter(Boolean);
    return {
      ...json,
      children: filteredChildren?.length ? filteredChildren : undefined,
    };
  }

  let filtered = filterNode(theatreJson) ?? theatreJson;

  // Apply static playerView transformation if defined
  const GameClass = game.constructor as typeof Game;
  if (GameClass.playerView) {
    filtered = GameClass.playerView(filtered, playerSeat, game);
  }

  return filtered;
}
```

**Recommended approach:** The `game.atId(json.id)` lookup approach is the simplest and most correct. Element IDs are stable across theatre/truth. The live element's visibility state accurately reflects visibility rules. The only concern is elements that exist in theatre but not in truth (created and immediately removed) -- these should be shown as-is since they're transient.

### Pattern 3: Broadcast Already Handles Per-Session State

**What:** The existing `broadcast()` method (game-session.ts line 1449-1473) already iterates sessions and builds per-player state. No structural change needed.

```typescript
// Existing broadcast() -- already correct structure
broadcast(): void {
  if (!this.#broadcaster) return;
  const flowState = this.#runner.getFlowState();
  const sessions = this.#broadcaster.getSessions();

  for (const session of sessions) {
    const effectivePosition = session.isSpectator ? 0 : session.playerSeat;
    const state = buildPlayerState(this.#runner, this.#storedState.playerNames, effectivePosition, ...);
    // ... send to session ...
  }
}
```

**Impact:** `buildPlayerState()` is the single point of change. When it starts using theatre state for `view`, ALL broadcast recipients automatically get the theatre view. SES-04 (multiplayer sync) is satisfied automatically.

### Pattern 4: acknowledgeAnimations Triggers Rebroadcast

**What:** `GameSession.acknowledgeAnimations()` already calls `this.broadcast()` after acknowledging events (game-session.ts line 830). When acknowledged events advance the theatre state, the rebroadcast sends the updated theatre view to all clients.

```typescript
// Existing -- already correct (game-session.ts line 825-832)
acknowledgeAnimations(playerSeat: number, upToId: number): void {
  this.#runner.game.acknowledgeAnimationEvents(upToId);
  this.broadcast();  // This already triggers rebroadcast
}
```

**Impact:** SES-03 is already satisfied at the session level. The engine-level `acknowledgeAnimationEvents()` (Phase 81) advances the theatre snapshot. The session-level broadcast sends the updated view.

### Recommended Project Structure

```
src/
  engine/
    element/
      game.ts              # Add theatreStateForPlayer() method
  session/
    types.ts               # Add currentView to PlayerGameState
    utils.ts               # buildPlayerState() uses theatre state for view
    game-session.ts        # acknowledgeAnimations() already correct
```

### Anti-Patterns to Avoid

- **Separate theatre filtering at session layer:** Do NOT implement visibility filtering in the session layer (utils.ts). Keep visibility logic in the engine (game.ts). The session layer should call `game.theatreStateForPlayer()`, not implement its own JSON filtering.

- **Building two full views per player per broadcast:** Avoid calling both `toJSONForPlayer()` AND `theatreStateForPlayer()` when they would return the same thing. When no animations are pending, `theatreState` falls through to `toJSON()`, so both would produce identical output. Optimize: only compute `currentView` when theatre state diverges from truth (i.e., when `_theatreSnapshot` exists). When `_theatreSnapshot === null`, `view` and `currentView` are identical -- just set `currentView = undefined` or use the same object.

- **Breaking the existing `view` field semantics abruptly:** Currently `view` is always the truth. Changing it to theatre state could break games that depend on `view` being truth. However, per the requirements, theatre view IS the new default. Games that need truth should use the new `currentView` field. This is an intentional semantic change.

- **Per-client acknowledgment state:** The current design uses a single global animation buffer. All clients see the same events and the same theatre state. Do NOT implement per-client theatre state tracking -- that's a future concern. When ANY client acknowledges, it advances the global theatre state for everyone.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Visibility filtering | Custom JSON filter in session layer | `game.theatreStateForPlayer()` (new, in engine) | Engine owns visibility logic; session shouldn't duplicate it |
| Theatre snapshot management | Session-level snapshot tracking | `game.theatreState` getter (Phase 81) | Engine already manages the snapshot lifecycle |
| Element ID lookup in JSON | Manual tree walking | `game.atId(id)` for live element lookup | Existing method, fast (uses internal ID map) |
| Rebroadcast triggering | Custom rebroadcast logic | `this.broadcast()` (existing, already called) | `acknowledgeAnimations()` already calls broadcast |

**Key insight:** Phase 82 is primarily a "wiring" phase. The hard work (theatre state engine) was done in Phase 81. The session integration is connecting the engine's `theatreState`/`theatreStateForPlayer()` to the session's `buildPlayerState()` and verifying the broadcast flow.

## Common Pitfalls

### Pitfall 1: Theatre Snapshot Visibility vs. Truth Visibility

**What goes wrong:** Attempting to walk the theatre JSON tree in parallel with the live element tree for visibility filtering. The trees have different element positions when animations are pending.
**Why it happens:** `toJSONForPlayer()` uses parallel tree traversal (`json.children[i]` / `element._t.children[i]`). This pattern breaks when the JSON is the theatre snapshot instead of truth.
**How to avoid:** Use element ID-based lookup (`game.atId(json.id)`) instead of parallel traversal. Element IDs are stable across theatre/truth.
**Warning signs:** `children[i]` accessing wrong element, undefined elements during filtering, wrong visibility for elements that moved.

### Pitfall 2: Duplicate Serialization When No Animations Pending

**What goes wrong:** Computing both theatre view and current view when `_theatreSnapshot` is null, resulting in two identical `toJSON()` serializations per player per broadcast.
**Why it happens:** Naive implementation always computes both views.
**How to avoid:** Check if theatre snapshot exists. When `_theatreSnapshot === null`, the theatre view IS the current view. Only compute `currentView` separately when they diverge. Use a flag or `game.hasTheatreSnapshot` check.
**Warning signs:** Performance regression in games without animations (doubling serialization cost per broadcast).

### Pitfall 3: AI Gets Theatre View Instead of Truth

**What goes wrong:** AI controller receives theatre state for decision-making, which may be behind truth. AI makes decisions based on stale board state.
**Why it happens:** AI uses `session.buildPlayerState()` or `runner.game` for state evaluation. If `buildPlayerState().view` is theatre state, anything consuming it for logic (not rendering) gets stale data.
**How to avoid:** AI already accesses `runner.game` directly for MCTS clone, NOT through `buildPlayerState()`. The AI controller (ai-controller.ts) calls `bot.play()` which internally clones `runner.game` and evaluates that clone. This bypasses `buildPlayerState()` entirely. No change needed for AI -- but verify this holds.
**Warning signs:** AI making moves based on old positions, AI errors during animation sequences.

### Pitfall 4: Player Data from Theatre vs. Truth

**What goes wrong:** `buildPlayerState()` builds `players` array from `runner.game.players` (live element tree). But `view` now shows theatre state. Player scores in `players` array could be ahead of scores visible in `view`.
**Why it happens:** `players` data comes from live truth, `view` comes from theatre snapshot. During animation sequences, these diverge.
**How to avoid:** This is actually correct behavior for most cases -- the `players` array is metadata (names, seats, custom properties) used for UI chrome, while `view` is the board state. However, if player properties like `score` are modified inside `animate()` callbacks, the `players` array shows the new score while the theatre view shows the old one. This is a known tradeoff. Options:
  - Accept the inconsistency (players array is always truth)
  - Extract player data from theatre snapshot instead of live objects
  - Document that `players` reflects truth and `view` reflects theatre

**Recommendation:** Accept the inconsistency for now. The `players` array has always been truth. UI components that care about animation-consistent scores should read from `view` (theatre), not `players`. Document this.

### Pitfall 5: currentView Missing When Not Needed

**What goes wrong:** Components that need truth always check `state.currentView ?? state.view`, adding boilerplate.
**Why it happens:** If `currentView` is only present when theatre state diverges, consumers need the fallback pattern.
**How to avoid:** Always include `currentView` in `PlayerGameState`. When no theatre state exists, `currentView` equals `view`. This simplifies consumer code: always use `state.view` for rendering, use `state.currentView` for truth. The cost is minimal (same object reference when they're identical).

**Alternative:** Make `currentView` always present but set to `undefined` when identical to `view`, relying on consumers to use `state.currentView ?? state.view`. This saves bandwidth on the wire.

**Recommendation:** Always include `currentView` for simplicity. When no animations are pending, set it to the same value as `view` (same serialization). Wire cost is the deciding factor -- if bandwidth matters, make it undefined when equal.

### Pitfall 6: Missing WebSocket Message Type for Acknowledge

**What goes wrong:** The WebSocket message type union in `types.ts` does not include `'acknowledgeAnimations'`. Currently, animation acknowledgment only works through direct session method calls (local/dev mode), not through the WebSocket protocol.
**Why it happens:** Animation events were added before the WebSocket integration was built out for this message type.
**How to avoid:** This may be out of scope for Phase 82 (session integration). Phase 82 is about the session layer, not the transport layer. However, if multiplayer testing is required, the WebSocket message type needs to support acknowledgment. Check if `handleWebSocketMessage()` in `server/core.ts` needs a new `case 'acknowledgeAnimations'`.
**Warning signs:** Multiplayer clients unable to acknowledge animations; animation events pile up but never get acknowledged; theatre state never advances for multiplayer games.

## Code Examples

### buildPlayerState() with Theatre View

```typescript
// Source: Based on current src/session/utils.ts buildPlayerState()
export function buildPlayerState(
  runner: GameRunner,
  playerNames: string[],
  playerPosition: number,
  options?: { includeActionMetadata?: boolean; includeDebugData?: boolean }
): PlayerGameState {
  const flowState = runner.getFlowState();

  // Theatre view (primary) -- what the player sees during animation playback
  const theatreView = runner.game.theatreStateForPlayer(playerPosition);

  // Current view (truth) -- opt-in for AI, scoring, debug
  // Only compute separately when theatre state differs from truth
  const hasTheatreSnapshot = runner.game.pendingAnimationEvents.length > 0;
  const currentView = hasTheatreSnapshot
    ? runner.getPlayerView(playerPosition).state
    : undefined;  // When no animations, view IS truth

  // ... existing logic for availableActions, isMyTurn, canUndo, etc. ...

  const state: PlayerGameState = {
    phase: runner.game.phase,
    players: fullPlayerData,
    currentPlayer: flowState?.currentPlayer,
    availableActions,
    isMyTurn,
    view: theatreView,                    // Theatre state (default)
    currentView: currentView,             // Truth (opt-in, undefined when same as view)
    canUndo,
    actionsThisTurn: isMyTurn ? actionsThisTurn : 0,
    turnStartActionIndex: isMyTurn ? turnStartActionIndex : undefined,
  };

  // ... existing actionMetadata, customDebug, animationEvents logic ...

  return state;
}
```

### Game.theatreStateForPlayer()

```typescript
// Source: To be added to src/engine/element/game.ts
/**
 * Get the theatre state filtered for a specific player's visibility.
 * Uses the theatre snapshot if animations are pending, falls through to
 * toJSONForPlayer() when in sync.
 */
theatreStateForPlayer(player: P | number | null): ElementJSON {
  // When no theatre snapshot exists, theatre = truth
  if (!this._theatreSnapshot) {
    return this.toJSONForPlayer(player);
  }

  const playerSeat = player === null ? null : (typeof player === 'number' ? player : player.seat);
  const visibilityPosition = playerSeat ?? -1;

  // Deep clone the theatre snapshot so filtering doesn't mutate it
  const theatreJson = structuredClone(this._theatreSnapshot);

  // Apply visibility filtering using live element visibility rules
  const filtered = this._filterJsonByVisibility(theatreJson, visibilityPosition);

  // Apply static playerView transformation if defined
  const GameClass = this.constructor as typeof Game;
  if (GameClass.playerView) {
    return GameClass.playerView(filtered, playerSeat, this);
  }

  return filtered;
}

/**
 * Filter an ElementJSON tree by looking up visibility from live elements.
 * Element IDs are stable across theatre/truth, so we can look up the live
 * element by ID to check its visibility state.
 */
private _filterJsonByVisibility(json: ElementJSON, visibilityPosition: number): ElementJSON {
  // Look up live element by ID
  const liveElement = this.atId(json.id) ?? this;  // Root is the game itself

  // Check element visibility
  if (!liveElement.isVisibleTo(visibilityPosition)) {
    const visibility = liveElement.getEffectiveVisibility();
    if (visibility.mode === 'count-only') {
      // count-only: show structure but not content
      const systemAttrs: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(json.attributes ?? {})) {
        if (key.startsWith('$')) systemAttrs[key] = value;
      }
      return {
        className: json.className,
        id: json.id,
        name: json.name,
        attributes: systemAttrs,
        childCount: json.children?.length ?? 0,
      };
    }
    // hidden: return placeholder
    return {
      className: json.className,
      id: json.id,
      attributes: { __hidden: true },
    };
  }

  // Handle zone visibility for children
  const zoneVisibility = (liveElement as any).getZoneVisibility?.();
  if (zoneVisibility) {
    // ... zone-based child filtering (same logic as toJSONForPlayer) ...
  }

  // Recursively filter children
  const filteredChildren: ElementJSON[] = [];
  if (json.children) {
    for (const child of json.children) {
      const filtered = this._filterJsonByVisibility(child, visibilityPosition);
      if (filtered) filteredChildren.push(filtered);
    }
  }

  return {
    ...json,
    children: filteredChildren.length > 0 ? filteredChildren : undefined,
  };
}
```

### PlayerGameState Type Extension

```typescript
// Source: Based on current src/session/types.ts PlayerGameState
export interface PlayerGameState {
  phase: string;
  players: Array<{ name: string; seat: number; [key: string]: unknown }>;
  currentPlayer?: number;
  availableActions?: string[];
  isMyTurn: boolean;
  view: unknown;                    // Theatre state (default view)
  currentView?: unknown;            // Truth state (opt-in, undefined when same as view)
  actionMetadata?: Record<string, ActionMetadata>;
  canUndo?: boolean;
  actionsThisTurn?: number;
  turnStartActionIndex?: number;
  customDebug?: Record<string, unknown>;
  animationEvents?: AnimationEvent[];
  lastAnimationEventId?: number;
  colorSelectionEnabled?: boolean;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `view` field is always truth (toJSONForPlayer) | `view` is theatre state, `currentView` is truth (opt-in) | Phase 82 (this phase) | Clients render "narrative" view by default |
| `acknowledgeAnimations` just clears buffer | Also advances theatre snapshot and rebroadcasts | Phase 81 engine + Phase 82 session | Acknowledgment drives view advancement |
| All clients always see same truth | All clients see same theatre view (no spoilers) | Phase 82 | Multiplayer fairness during animations |
| No `currentView` field exists | `currentView` available for AI, debug, scoring | Phase 82 | Components can opt into truth when needed |

## Open Questions

### 1. Should `currentView` always be present or only when divergent?

**What we know:** When no animations are pending, `view` and `currentView` are identical. Including both wastes bandwidth on the wire for the common case (no animations).
**What's unclear:** Whether consumers prefer always having `currentView` (simpler code) or checking for its absence (saves bandwidth).
**Recommendation:** Make `currentView` optional -- only include it when theatre state diverges from truth (`_theatreSnapshot !== null`). Consumers use `state.currentView ?? state.view` for truth access. This matches the "opt-in" requirement language and minimizes bandwidth. Confidence: MEDIUM.

### 2. Does `game.atId()` handle elements in the pile?

**What we know:** `piece.remove()` moves elements to `game.pile`. The pile IS part of the live game but NOT in `toJSON()` output. Theatre snapshot (derived from `toJSON()`) won't contain removed elements. But `game.atId()` searches the live element tree which includes the pile.
**What's unclear:** If an element exists in the theatre snapshot (not yet removed in theatre) but has been removed in truth (moved to pile in truth), `game.atId(elementId)` would find it in the pile. The visibility filtering should still work because the pile element's visibility is irrelevant -- it's visible in the theatre snapshot since it hasn't been "removed" there yet.
**Recommendation:** This should work correctly. The live element in the pile is still a valid object with visibility state. If it's hidden in the pile's zone, the filtering will hide it in the theatre view too. But typically, elements in the pile are simply absent from the JSON tree. Test this edge case. Confidence: MEDIUM.

### 3. Should the WebSocket message type include `acknowledgeAnimations`?

**What we know:** The `WebSocketMessage` type union does not include animation acknowledgment. The `handleWebSocketMessage()` handler in `server/core.ts` has no case for it. Currently, animation acknowledgment only works through direct session API calls.
**What's unclear:** Whether multiplayer acknowledgment is in scope for Phase 82 or deferred to a later phase.
**Recommendation:** Add `'acknowledgeAnimations'` to the WebSocket message type and add a handler in the server's `handleWebSocketMessage()`. This is needed for SES-04 (multiplayer sync). Without it, multiplayer clients can't acknowledge animations and the theatre state never advances. Confidence: HIGH that this is needed.

### 4. How does HMR interact with theatre state?

**What we know:** HMR via `reloadWithCurrentRules()` uses dev state transfer or action replay. Both paths go through `toJSON()`/`restoreGame()` which now includes `_theatreSnapshot`. Theatre state should survive HMR.
**What's unclear:** Whether the theatre snapshot from the old game class's `toJSON()` is compatible with the new game class's element IDs. If HMR changes element creation order, IDs might not match.
**Recommendation:** Accept the limitation. HMR + active animations is an edge case. The dev can acknowledge all animations before modifying rules. If the snapshot is incompatible, the `_theatreSnapshot = null` fallthrough behavior means the system degrades gracefully. Confidence: HIGH.

### 5. Elements created during animate() that exist in theatre but not in truth

**What we know:** An element created inside an `animate()` callback would be captured as a `CREATE` mutation. In the theatre snapshot (pre-mutation), the element doesn't exist. In truth (post-mutation), it does. If that element is later removed in another `animate()` callback, the live `game.atId()` lookup would find it in the pile, not as a regular element.
**What's unclear:** How the visibility filter handles elements that exist in the theatre JSON but whose live counterparts are in the pile.
**Recommendation:** If `game.atId()` returns the element (even from the pile), use its visibility rules. If it returns `undefined` (element was destroyed, not just moved to pile), show the element as-is in the theatre view (since we can't determine visibility without a live object). This is a rare edge case. Confidence: MEDIUM.

## Sources

### Primary (HIGH confidence)
- `src/session/game-session.ts` -- GameSession class, broadcast(), acknowledgeAnimations(), performAction(), factory methods
- `src/session/utils.ts` -- buildPlayerState() implementation, view construction, animation events attachment
- `src/session/types.ts` -- PlayerGameState interface, SessionInfo, StateUpdate, BroadcastAdapter
- `src/engine/element/game.ts` -- theatreState getter, toJSONForPlayer(), _theatreSnapshot, acknowledgeAnimationEvents(), toJSON()
- `src/engine/element/theatre-state.ts` -- applyMutations(), findElementById(), mutation applicators
- `src/engine/utils/snapshot.ts` -- createPlayerView(), PlayerStateView
- `src/runtime/runner.ts` -- GameRunner.getPlayerView(), performAction()
- `src/session/ai-controller.ts` -- AI state access pattern (uses runner.game directly)
- `src/session/animation-events.test.ts` -- Existing tests for animation events in session layer
- `src/engine/element/game-element.ts` -- isVisibleTo(), getEffectiveVisibility(), getEffectiveOwner()
- `src/engine/element/theatre-state.test.ts` -- Theatre state engine tests from Phase 81
- `.planning/phases/81-theatre-state-engine/81-RESEARCH.md` -- Phase 81 architecture decisions

### Secondary (MEDIUM confidence)
- `src/server/core.ts` -- WebSocket message handling, handleWebSocketMessage()
- `src/ui/composables/useAnimationEvents.ts` -- Client-side acknowledge flow
- `src/types/protocol.ts` -- Canonical protocol types

### Tertiary (LOW confidence)
- None. All findings are based on direct codebase analysis.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- Pure session/engine integration, all files identified and read
- Architecture (theatre view in buildPlayerState): HIGH -- Clear wiring, single point of change
- Architecture (per-player visibility filtering): MEDIUM -- The atId() lookup approach is sound but needs edge case validation
- Pitfalls: HIGH -- Derived from direct analysis of parallel traversal issue in toJSONForPlayer()
- Code examples: MEDIUM -- Patterns are clear but visibility filtering details need implementation validation
- Multiplayer/broadcast: HIGH -- broadcast() already iterates sessions, single point of change

**Research date:** 2026-02-07
**Valid until:** Indefinite (internal codebase analysis, no external dependencies)
