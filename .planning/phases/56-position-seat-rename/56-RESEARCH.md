# Phase 56: Position to Seat Rename - Research

**Researched:** 2026-01-22
**Domain:** API naming, property renaming, terminology standardization
**Confidence:** HIGH

## Summary

This phase involves renaming the `position` property on the Player class to `seat` throughout the BoardSmith API. The rename affects the core Player class, all internal references to player position, documentation, and extracted games. The nomenclature.md (Phase 54) establishes "Seat" as the preferred user-facing term for a player's numbered place at the table.

**Critical distinction:** There are many uses of "position" in the codebase that should NOT change:
- `FlowPosition` - flow engine state position (completely unrelated)
- `putInto({ position: 'first'|'last' })` - piece insertion position in a space
- CSS `position: absolute/relative/fixed/etc.` - styling
- Queue/matchmaking position - position in a waiting queue
- Lobby slot position - slot numbering (may need separate consideration)

The scope is specifically: `player.position` property on the Player class and all code that references it in the context of "which player number is this."

**Primary recommendation:** Rename `Player.position` to `Player.seat` in the core class, then update all 200+ references throughout the codebase. This is a breaking API change that affects games using `player.position`.

## Scope Analysis

### MUST Change (Player Seat Context)

These are all references to the player's "seat number" concept:

#### Core Engine (src/engine/player/player.ts)
- Line 104: `position!: number;` - **THE** property to rename
- Line 88: JSDoc comment "Seat position (1-indexed..."
- Line 91: JSDoc "Use position as a stable identifier..."
- Line 101: Example `current.position % playerCount`
- Line 115: Example `player.position - 1`
- Line 132: JSDoc "first player (position 1)"
- Line 145: `return this.position === 1;`

#### Game Class (src/engine/element/game.ts)
- Line 1683: `typeof (el as any).position === 'number'` - currentPlayer getter
- Line 1705: JSDoc "@see getPlayer - Get player by position"
- Line 1713-1740: getPlayer method JSDoc and implementation
- Line 1733: JSDoc "@see Player.position"
- Line 1753: getPlayerOrThrow JSDoc
- Line 1774: Error message "No player at position"
- Line 1787: setCurrentPlayer JSDoc
- Line 1858, 1894, 1933, 1965, 2004, 2064, 2072, 2073: Player position comparisons

#### Session Types (src/session/types.ts)
- Line 52: `POSITION_ALREADY_CLAIMED` error code
- Line 53: `INVALID_POSITION` error code
- Line 184-186: ExclusivePlayerOption default position docs
- Line 393: `position: number` in PlayerGameState.players
- Line 428-429: LobbySlot.position (lobby context - may keep)
- Line 483: SessionInfo.playerPosition
- Line 494: StateUpdate.playerPosition
- Line 569-571: WebSocketMessage.position (lobby context)
- Line 592-594: ClaimPositionRequest (lobby context - may keep)

#### Client Types (src/client/types.ts)
- Line 45-52: MatchmakingResult.playerPosition and position
- Line 74-75: MatchmakingStatus.playerPosition
- Line 106: PlayerState.players[].position
- Line 108-109: currentPlayer position docs
- Line 128-129: GameState.playerPosition
- Line 153-154: GameConnectionConfig.playerPosition
- Line 305-306: LobbySlot.position (lobby context)

#### Action Helpers (src/engine/action/helpers.ts)
- Line 160: `playerPosition = ctx.player.position`
- Line 165: `playerPosition = actionNameOrPlayer.position`

#### Serializer (src/engine/utils/serializer.ts)
- Line 39: `{ __playerRef: player.position }`
- Line 131: `player: player.position`

#### Snapshot (src/engine/utils/snapshot.ts)
- Line 113: `winners.map(p => p.position)`
- Line 121: `p.position` in createPlayerView

#### Turn Order (src/engine/flow/turn-order.ts)
- Line 108: `positions.includes(player.position)`
- Line 127: Example `ctx.game.players.nextAfter(dealer).position`

#### Flow Engine (src/engine/flow/engine.ts)
- Line 404: `currentPlayer: this.currentPlayer?.position`
- Line 685: `playerIndex: this.currentPlayer?.position`
- Line 1108: `playerIndex: player.position`

### MUST NOT Change

#### FlowPosition (completely unrelated concept)
- `src/engine/flow/types.ts` - FlowPosition interface
- `src/engine/flow/engine.ts` - state.position, position.path, position.variables
- `src/engine/utils/dev-state.ts` - flowPosition throughout
- All references to `state.position` in flow context

#### Piece Position (insertion location)
- `src/engine/element/piece.ts` - `position?: 'first' | 'last'`
- `src/engine/command/executor.ts` - `command.position`
- All `putInto({ position: ... })` usages

#### CSS Position (styling)
- All `position: absolute`, `position: relative`, etc. in Vue components
- All `style.position` assignments

#### Grid/Board Position (spatial coordinates)
- Any reference to cell position, board position, grid coordinates
- `piece.position` when referring to location on board (if any exist)

#### Lobby Slot Position (DECISION NEEDED)
- `LobbySlot.position` - This refers to the same concept (seat at table)
- `ClaimPositionRequest.position` - Same concept
- Consider: Should these also become `seat`?

### Extracted Games Analysis

All 9 extracted games reference `player.position`:

| Game | Files | Usage Count | Key Patterns |
|------|-------|-------------|--------------|
| checkers | 3 files | 15 refs | `player.position === 1`, `piece.attributes?.player?.position` |
| cribbage | 4 files | 12 refs | `player.position`, `playerPosition` prop |
| demoAnimation | 2 files | 5 refs | `p.position`, `data-player-position` |
| demoComplexUiInteractions | 2 files | 10 refs | `player.position`, `opponent.position` |
| floss-bitties | 1 file | 3 refs | `player.position`, `lastDiscardedByPosition` |
| go-fish | 5 files | 18 refs | `player.position`, `.position` comparisons |
| hex | 5 files | 20 refs | `player.position === 1`, `myPlayer.position` |
| polyhedral-potions | 4 files | 8 refs | `p.position`, `player.position` |

**Note:** `demoActionPanel` has no player.position references.

## Standard Stack

### Approach
| Method | Purpose | Why Standard |
|--------|---------|--------------|
| Property rename | Change `position` to `seat` on Player class | Single source of truth |
| TypeScript compiler | Catch all type errors after rename | Finds broken references |
| grep + manual review | Find string references (JSDoc, comments, templates) | Catches non-compiled references |

### Not Applicable
This is a pure renaming task - no libraries or tools needed beyond the standard TypeScript toolchain.

## Architecture Patterns

### Player Class Change

```typescript
// BEFORE (src/engine/player/player.ts)
export class Player<G extends Game = any, P extends Player = any> extends GameElement<G, P> {
  position!: number;

  get isFirstPlayer(): boolean {
    return this.position === 1;
  }
}

// AFTER
export class Player<G extends Game = any, P extends Player = any> extends GameElement<G, P> {
  seat!: number;

  get isFirstPlayer(): boolean {
    return this.seat === 1;
  }
}
```

### Game Class Change

```typescript
// BEFORE (src/engine/element/game.ts)
getPlayer(position: number): P | undefined {
  return this._t.children.find(
    el => typeof (el as any).position === 'number' && (el as any).position === position
  ) as P | undefined;
}

// AFTER
getPlayer(seat: number): P | undefined {
  return this._t.children.find(
    el => typeof (el as any).seat === 'number' && (el as any).seat === seat
  ) as P | undefined;
}
```

### API Surface Changes

| Old API | New API | Notes |
|---------|---------|-------|
| `player.position` | `player.seat` | Core property |
| `getPlayer(position)` | `getPlayer(seat)` | Parameter name change |
| `getPlayerOrThrow(position)` | `getPlayerOrThrow(seat)` | Parameter name change |
| `playerPosition` (props/params) | `playerSeat` | Throughout UI/session code |
| `INVALID_POSITION` | `INVALID_SEAT` | Error code |
| `POSITION_ALREADY_CLAIMED` | `SEAT_ALREADY_CLAIMED` | Error code |

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Finding all refs | Manual grep | TypeScript compiler errors | More reliable, catches type issues |
| Renaming property | Find/replace all | IDE refactoring then manual cleanup | Handles type system properly |

## Common Pitfalls

### Pitfall 1: Renaming FlowPosition
**What goes wrong:** Accidentally renaming `state.position` in flow engine
**Why it happens:** Grep for "position" catches both
**How to avoid:** FlowPosition is about flow state path, NOT player seats. Never touch files in flow/ for this rename.
**Warning signs:** Flow engine tests break, serialization fails

### Pitfall 2: Breaking Piece Movement
**What goes wrong:** Renaming `position: 'first'|'last'` in putInto
**Why it happens:** Same word, different meaning
**How to avoid:** `putInto({ position })` is about insertion order, not player seats
**Warning signs:** Card movement breaks, deck shuffling fails

### Pitfall 3: Breaking Lobby Position
**What goes wrong:** Inconsistent renaming of lobby slot position
**Why it happens:** `LobbySlot.position` is semantically the same as player seat
**How to avoid:** Make explicit decision: either rename ALL seat concepts or NONE in lobby
**Warning signs:** Lobby joins fail, position claiming breaks

### Pitfall 4: Missing UI Data Attributes
**What goes wrong:** Not updating `data-player-position` attributes
**Why it happens:** String literals don't cause type errors
**How to avoid:** grep for "player-position" and "playerPosition" in templates
**Warning signs:** Player stat animations stop working

### Pitfall 5: Breaking Extracted Games
**What goes wrong:** Games don't build after rename
**Why it happens:** They depend on `player.position`
**How to avoid:** Update ALL 9 extracted games as part of this phase
**Warning signs:** `npm run build` fails in packages/games/*

## Code Examples

### Player Property Access
```typescript
// BEFORE
const seat = player.position;
const isFirst = player.position === 1;
const nextSeat = (current.position % playerCount) + 1;

// AFTER
const seat = player.seat;
const isFirst = player.seat === 1;
const nextSeat = (current.seat % playerCount) + 1;
```

### Finding Player by Seat
```typescript
// BEFORE
const player = game.getPlayer(position);
const player1 = game.first(Player, { position: 1 });

// AFTER
const player = game.getPlayer(seat);
const player1 = game.first(Player, { seat: 1 });
```

### UI Template Patterns
```vue
<!-- BEFORE -->
<span :data-player-position="player.position">...</span>
<div v-if="player.position === playerPosition">...</div>

<!-- AFTER -->
<span :data-player-seat="player.seat">...</span>
<div v-if="player.seat === playerSeat">...</div>
```

## Open Questions

1. **Should lobby position also become seat?**
   - `LobbySlot.position` refers to the same concept
   - `ClaimPositionRequest.position` is claiming a seat
   - Recommendation: YES, for consistency. "Claim seat 2" makes sense.

2. **Should UI props be `playerSeat` or keep `playerPosition`?**
   - Current: `playerPosition` prop throughout UI
   - Option A: Rename to `playerSeat` for consistency
   - Option B: Keep `playerPosition` for backwards compatibility
   - Recommendation: Rename to `playerSeat` for full consistency

3. **Should error codes change?**
   - `INVALID_POSITION` -> `INVALID_SEAT`
   - `POSITION_ALREADY_CLAIMED` -> `SEAT_ALREADY_CLAIMED`
   - Recommendation: YES, aligns with terminology

4. **What about `getPlayer(position)` parameter name?**
   - Could keep `position` parameter name for backwards compat
   - Or rename to `seat` for full consistency
   - Recommendation: Rename to `seat` - this is a breaking change anyway

## Sources

### Primary (HIGH confidence)
- Direct codebase analysis via grep
- `/Users/jtsmith/BoardSmith/src/engine/player/player.ts` - Player class source
- `/Users/jtsmith/BoardSmith/src/engine/element/game.ts` - Game class source
- `/Users/jtsmith/BoardSmith/docs/nomenclature.md` - Terminology definitions

### Files Analyzed
- All src/ files via grep for "position"
- All packages/games/ files via grep for "position"
- All docs/ files via grep for "position"

## Metadata

**Confidence breakdown:**
- Player.position location: HIGH - verified from source
- Scope of changes: HIGH - comprehensive grep analysis
- FlowPosition exclusion: HIGH - completely different concept verified
- Extracted games impact: HIGH - all 9 games analyzed

**Research date:** 2026-01-22
**Valid until:** No expiration - this is a one-time rename operation

## Quantitative Summary

| Area | File Count | Reference Count |
|------|------------|-----------------|
| Core Engine | 8 files | ~50 refs |
| Session/Client | 6 files | ~40 refs |
| UI Components | 12 files | ~60 refs |
| Documentation | 15 files | ~80 refs |
| Extracted Games | 26 files | ~90 refs |
| **Total** | **~67 files** | **~320 refs** |

This is a significant rename with broad impact, but the scope is well-defined and the FlowPosition/piece position exclusions are clear.
