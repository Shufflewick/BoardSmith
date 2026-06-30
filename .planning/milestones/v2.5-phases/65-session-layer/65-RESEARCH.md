# Phase 65: Session Layer - Research

**Researched:** 2026-01-25
**Domain:** Session-layer color change API and conflict handling
**Confidence:** HIGH

## Summary

This phase implements the session-layer color change API that builds on Phase 64's engine-level color infrastructure. The existing `LobbyManager.updatePlayerOptions()` method provides the foundation but lacks color-specific conflict validation. When a player requests a color change, the session layer must verify the target color is unoccupied before allowing the change.

The implementation pattern is straightforward: extend `updatePlayerOptions` to detect color option changes and reject them if the target color is already held by another player. All existing infrastructure for persistence, broadcasting, and reconnection is already in place through the `LobbyManager` class.

**Primary recommendation:** Add conflict validation to `updatePlayerOptions` in `LobbyManager`, creating a dedicated `changeColor()` method or integrating validation directly into the existing method.

## Standard Stack

This phase is entirely internal to `@boardsmith/session`. No new dependencies required.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @boardsmith/session | internal | Session management | This is the package being modified |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @boardsmith/engine | internal | Color palette access | Reference game.settings.colors for validation |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Validating in session layer | Validating in UI only | UI validation insufficient - server must be authoritative |
| Generic updatePlayerOptions validation | Color-specific method | Generic is more flexible but less explicit; color method is clearer |

**Installation:**
No new packages needed.

## Architecture Patterns

### Recommended Changes

```
packages/session/
├── src/
│   ├── lobby-manager.ts    # Add color conflict validation to updatePlayerOptions
│   ├── types.ts            # Add ErrorCode.COLOR_ALREADY_TAKEN if needed
│   └── game-session.ts     # (No changes needed - delegates to LobbyManager)
```

### Pattern 1: Extend updatePlayerOptions with Color Validation

**What:** Add color-specific validation inside existing `updatePlayerOptions` method
**When to use:** When player requests any option update containing `color`

```typescript
// In lobby-manager.ts
async updatePlayerOptions(
  playerId: string,
  options: Record<string, unknown>
): Promise<{ success: boolean; error?: string; lobby?: LobbyInfo }> {
  // ... existing validation (lobby exists, state is waiting, player found) ...

  // NEW: Color conflict validation
  if (options.color !== undefined) {
    const colorValidation = this.#validateColorChange(playerId, options.color as string);
    if (!colorValidation.success) {
      return { success: false, error: colorValidation.error };
    }
  }

  // Merge new options with existing
  slot.playerOptions = {
    ...slot.playerOptions,
    ...options,
  };

  // ... persist and broadcast ...
}

#validateColorChange(playerId: string, targetColor: string): { success: boolean; error?: string } {
  const slots = this.#storedState.lobbySlots!;
  const requestingSlot = slots.find(s => s.playerId === playerId);

  // Check if target color is already held by another player
  const conflictingSlot = slots.find(
    s => s.playerId !== playerId && s.playerOptions?.color === targetColor
  );

  if (conflictingSlot) {
    return {
      success: false,
      error: `Color ${targetColor} is already taken by ${conflictingSlot.name}`
    };
  }

  return { success: true };
}
```

### Pattern 2: Dedicated Color Change Method (Alternative)

**What:** Create explicit `changeColor(playerId, targetColor)` method
**When to use:** If we want stronger typing and clearer API

```typescript
// In lobby-manager.ts
async changeColor(
  playerId: string,
  targetColor: string
): Promise<{ success: boolean; error?: string; lobby?: LobbyInfo }> {
  // Validation and conflict checking
  // ...

  // Delegate to updatePlayerOptions
  return this.updatePlayerOptions(playerId, { color: targetColor });
}
```

**Recommendation:** Pattern 1 (validation in updatePlayerOptions) is simpler and maintains a single entry point. Pattern 2 adds type safety but also complexity.

### Pattern 3: WebSocket Message Handling

**What:** The existing WebSocket message type 'updatePlayerOptions' already exists
**When to use:** Color changes flow through the same path as other player options

```typescript
// In server/core.ts - ALREADY EXISTS
case 'updatePlayerOptions':
  const updateOptionsResult = await gameSession.updatePlayerOptions(
    session.playerId!,
    message.playerOptions!
  );
  // ...

// Client sends:
{ type: 'updatePlayerOptions', playerOptions: { color: '#e74c3c' } }
```

### Pattern 4: Color Persistence Through Disconnect/Reconnect

**What:** Color is stored in `slot.playerOptions.color` which persists in StoredGameState
**When to use:** Automatic - no new code needed

```typescript
// StoredGameState.lobbySlots persists to storage
// On reconnect, player's slot (found by playerId) still has their color
// GameSession.restore() rebuilds LobbyManager with existing lobbySlots
```

### Anti-Patterns to Avoid

- **Don't validate only on client side**: Server must be authoritative for conflict detection
- **Don't allow color changes after game starts**: Validate `lobbyState === 'waiting'` (already done)
- **Don't clear color on disconnect**: Color stays in slot until player explicitly changes or is kicked
- **Don't duplicate color in multiple places**: Single source of truth is `slot.playerOptions.color`

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Persistence | Custom storage | Existing StorageAdapter | Already handles lobbySlots |
| Broadcasting | Custom notification | Existing broadcastLobby() | Already notifies all players |
| Reconnection | Session tracking | Existing setPlayerConnected() | Already handles reconnect |
| Default colors | Manual assignment | computeDefaultPlayerOptions() | Already picks first available |

**Key insight:** The lobby system already has all the infrastructure. We're only adding validation logic.

## Common Pitfalls

### Pitfall 1: Race Conditions on Simultaneous Color Claims

**What goes wrong:** Two players try to claim the same color at nearly the same time
**Why it happens:** Network latency means both see the color as available
**How to avoid:** Server-side validation is authoritative; second request fails with clear error
**Warning signs:** Players report "color was available but I couldn't select it"

**Resolution:** This is expected behavior. The first request to reach the server wins, the second gets a rejection with a clear message explaining the color was just taken.

### Pitfall 2: Stale UI After Color Change Rejection

**What goes wrong:** Player selects color, it gets rejected, but UI shows the old selection
**Why it happens:** Client optimistically updates before server response
**How to avoid:** UI should only update color after receiving successful lobby update
**Warning signs:** Color picker shows wrong color after failed change

**Resolution:** Client should either:
1. Wait for server response before updating UI (recommended)
2. Revert on failure

### Pitfall 3: Color Validation Bypass via Direct Options Update

**What goes wrong:** Color validation only in changeColor() but not updatePlayerOptions()
**Why it happens:** Multiple code paths to same state
**How to avoid:** Put validation in updatePlayerOptions() since it's the common path
**Warning signs:** Host using updateSlotPlayerOptions() bypasses validation

**Resolution:** Validate in the shared method `updatePlayerOptions()` and also in `updateSlotPlayerOptions()` if host color assignment needs conflict checks.

### Pitfall 4: AI Players and Color Conflicts

**What goes wrong:** AI slot has a color, human tries to take it
**Why it happens:** AI slots also have playerOptions.color
**How to avoid:** Include AI slots in conflict checking
**Warning signs:** Human can't select certain colors with no visible conflict

**Resolution:** The conflict check should look at ALL slots with colors, regardless of status (claimed, ai, open).

## Code Examples

Verified patterns from the existing codebase:

### Existing updatePlayerOptions Method

```typescript
// From src/session/lobby-manager.ts (lines 693-725)
async updatePlayerOptions(
  playerId: string,
  options: Record<string, unknown>
): Promise<{ success: boolean; error?: string; lobby?: LobbyInfo }> {
  if (!this.#storedState.lobbySlots) {
    return { success: false, error: 'Game does not have a lobby' };
  }

  if (this.#storedState.lobbyState !== 'waiting') {
    return { success: false, error: 'Game has already started' };
  }

  const slot = this.#storedState.lobbySlots.find(s => s.playerId === playerId);
  if (!slot) {
    return { success: false, error: 'Player not found in lobby' };
  }

  // NEW: Add color validation here

  // Merge new options with existing
  slot.playerOptions = {
    ...slot.playerOptions,
    ...options,
  };

  // Persist changes
  if (this.#storage) {
    await this.#storage.save(this.#storedState);
  }

  // Broadcast lobby update
  this.broadcastLobby();

  return { success: true, lobby: this.getLobbyInfo() ?? undefined };
}
```

### Existing Color Conflict Detection (for defaults)

```typescript
// From src/session/lobby-manager.ts (lines 906-931)
// This pattern shows how to detect taken colors
const takenValues: Record<string, Set<string>> = {};
for (const slot of lobbySlots) {
  if (slot.seat !== seat && slot.playerOptions) {
    for (const [key, value] of Object.entries(slot.playerOptions)) {
      if (!takenValues[key]) {
        takenValues[key] = new Set();
      }
      takenValues[key].add(String(value));
    }
  }
}
```

### WebSocket Message Flow

```typescript
// Client sends (from src/client/types.ts)
interface UpdatePlayerOptionsRequest {
  playerId: string;
  playerOptions: Record<string, unknown>;  // { color: '#e74c3c' }
}

// Server handles (from src/server/core.ts lines 706-720)
case 'updatePlayerOptions':
  const updateOptionsResult = await gameSession.updatePlayerOptions(
    session.playerId!,
    message.playerOptions!
  );
  session.ws.send({
    type: 'lobbyResult',
    success: updateOptionsResult.success,
    error: updateOptionsResult.error,
    lobby: updateOptionsResult.lobby,
  });
  break;
```

### Reconnection Handling

```typescript
// From src/session/lobby-manager.ts - setPlayerConnected already exists
async setPlayerConnected(playerId: string, connected: boolean): Promise<boolean> {
  // ... finds slot by playerId, updates connected status
  // Color remains in slot.playerOptions.color - persists across disconnect
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No color validation | Color conflict validation | This phase | Players get clear rejection message |
| Colors only at game start | Colors changeable in lobby | Phase 64 + 65 | Better player experience |
| Manual color assignment per game | Engine auto-assigns from palette | Phase 64 | Consistent behavior |

**Deprecated/outdated:**
- Manual `applyPlayerColors` in game constructors: Engine handles this now (Phase 64)

## Data Flow Summary

```
Player UI → "Change color to #3498db"
    ↓
GameConnection.updatePlayerOptions({ color: '#3498db' })
    ↓
WebSocket message: { type: 'updatePlayerOptions', playerOptions: { color: '#3498db' } }
    ↓
GameServerCore.handleWebSocketMessage()
    ↓
GameSession.updatePlayerOptions(playerId, { color: '#3498db' })
    ↓
LobbyManager.updatePlayerOptions(playerId, { color: '#3498db' })
    ├── Validate: lobbyState === 'waiting' ✓
    ├── Validate: player found in slots ✓
    ├── NEW: Validate: color not taken by another player ✓ or ✗
    │   └── If taken: return { success: false, error: 'Color taken by Player Name' }
    ├── Update: slot.playerOptions.color = '#3498db'
    ├── Persist: storage.save(storedState)
    └── Broadcast: broadcastLobby() → all connected clients
    ↓
LobbyUpdate message to all clients
    ↓
UI updates to show new color assignments
```

## Open Questions

Things that couldn't be fully resolved:

1. **Should host be able to force color changes on other players?**
   - What we know: `updateSlotPlayerOptions` allows host to modify any slot
   - What's unclear: Should this also have color conflict validation?
   - Recommendation: Yes, validate there too; host shouldn't be able to give two players same color

2. **Should we add an ErrorCode for color conflicts?**
   - What we know: ErrorCode enum exists in types.ts
   - What's unclear: Whether a specific code is needed vs generic error
   - Recommendation: Add `ErrorCode.COLOR_ALREADY_TAKEN` for programmatic handling

3. **What if available colors are fewer than players?**
   - What we know: Engine validates colors.length >= playerCount at construction
   - What's unclear: What if playerOptionsDefinitions has fewer color choices?
   - Recommendation: This is a game configuration error; fail with clear message

## Sources

### Primary (HIGH confidence)
- `/Users/jtsmith/BoardSmith/src/session/lobby-manager.ts` - LobbyManager implementation
- `/Users/jtsmith/BoardSmith/src/session/game-session.ts` - GameSession delegation
- `/Users/jtsmith/BoardSmith/src/session/types.ts` - Type definitions
- `/Users/jtsmith/BoardSmith/src/server/core.ts` - WebSocket message handling
- `/Users/jtsmith/BoardSmith/.planning/phases/64-engine-layer/64-RESEARCH.md` - Phase 64 context

### Secondary (MEDIUM confidence)
- `/Users/jtsmith/BoardSmith/docs/api/session.md` - Session API documentation
- `/Users/jtsmith/BoardSmith/docs/api/client.md` - Client API documentation

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Internal package modification, no external deps
- Architecture: HIGH - Building on existing updatePlayerOptions pattern
- Pitfalls: HIGH - Identified from existing codebase patterns

**Research date:** 2026-01-25
**Valid until:** 2026-02-25 (stable internal refactor)
