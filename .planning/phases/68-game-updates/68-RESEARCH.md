# Phase 68: Game Updates - Research

**Researched:** 2026-01-25
**Domain:** Game migration to player.color API
**Confidence:** HIGH

## Summary

This phase migrates all BoardSmithGames to use the new `player.color` API instead of the deprecated `DEFAULT_PLAYER_COLORS` import. After auditing all games, only **two games** require migration: **Hex** and **Checkers**. All other games either don't use player colors (card games like Cribbage, Go Fish), use non-player colors (dice colors in Polyhedral Potions), or are demo applications.

The MERC game referenced in GAME-03 does not exist in the codebase. This requirement should be marked as N/A or removed.

**Primary recommendation:** Create separate plans for Hex and Checkers migrations, completing GAME-01 and GAME-02. Mark GAME-03 as N/A (MERC game doesn't exist) and GAME-04 as N/A (no other games need updates).

## Games Audit

### Games Requiring Migration

| Game | Player Colors Used | Files Needing Changes | Complexity |
|------|-------------------|----------------------|------------|
| **Hex** | Yes - stones colored by player | 4 files | Medium |
| **Checkers** | Yes - pieces colored by player | 3 files | Medium |

### Games NOT Requiring Migration

| Game | Why No Migration Needed |
|------|------------------------|
| **Cribbage** | Card game - uses suit colors (red/black), no player-specific coloring |
| **Go Fish** | Card game - uses suit colors (red/black), no player-specific coloring |
| **Polyhedral Potions** | Solo dice game - uses die-type colors (d4=green, d6=purple), not player colors |
| **Floss Bitties** | Card game - suit-based colors, no player-specific coloring |
| **demo-animation** | Demo app - suit colors only |
| **demo-complex-ui** | Demo app - suit/action colors only |
| **demo-action-panel** | Demo app - minimal, no player colors |

### Missing Games

| Game | Status |
|------|--------|
| **MERC** | Does not exist in codebase - GAME-03 requirement invalid |

## Hex Game Analysis

### Current Color Handling

**Rules layer (`hex/src/rules/`):**

1. `game.ts` (lines 2, 91-103):
   - Imports `DEFAULT_PLAYER_COLORS` from `boardsmith/session`
   - Has `applyPlayerColors()` method that sets `player.color` from config or defaults
   - This is redundant - engine now auto-assigns colors

2. `elements.ts` (lines 2, 198-205):
   - Imports `DEFAULT_PLAYER_COLORS` from `boardsmith/session`
   - `HexPlayer.getColorHex()` method returns `this.color ?? DEFAULT_PLAYER_COLORS[this.seat - 1]`
   - Fallback is unnecessary - `player.color` is always set by engine

**UI layer (`hex/src/ui/`):**

3. `App.vue` (lines 2, 6-11):
   - Imports `DEFAULT_PLAYER_COLORS` from `boardsmith/ui`
   - Has `getPlayerColorHex()` helper with fallback to `DEFAULT_PLAYER_COLORS`
   - Should just use `player.color` directly

4. `HexBoard.vue` (lines 11, 141-160):
   - Imports `DEFAULT_PLAYER_COLORS` from `boardsmith/ui`
   - Complex `getPlayerColors` computed with multiple fallbacks
   - Should trust that `player.color` is always set

### Migration Strategy for Hex

1. **Remove imports**: Delete `DEFAULT_PLAYER_COLORS` from all files
2. **Remove applyPlayerColors()**: Engine now handles this
3. **Simplify HexPlayer.getColorHex()**: Just return `this.color!`
4. **Simplify UI helpers**: Use `player.color` directly, remove fallbacks

## Checkers Game Analysis

### Current Color Handling

**Rules layer (`checkers/src/rules/`):**

1. `game.ts` (lines 2, 8, 91-105):
   - Imports `DEFAULT_PLAYER_COLORS` from `boardsmith/session`
   - Defines `CHECKERS_DEFAULT_COLORS = ['#e74c3c', '#2c3e50']` (red/dark gray)
   - Has `applyPlayerColors()` method using custom colors
   - This is redundant - engine now auto-assigns colors

2. `elements.ts` (line 123):
   - `CheckersPlayer` has `color: string = '#e74c3c'` property
   - This shadows the inherited `player.color` property
   - Should be removed - engine sets `player.color`

**UI layer (`checkers/src/ui/`):**

3. `CheckersBoard.vue` (lines 481-493):
   - Defines `DEFAULT_CHECKERS_COLORS` locally
   - Has `getPlayerColor()` helper with fallback
   - Should trust `player.color` from players prop

### Migration Strategy for Checkers

1. **Remove imports**: Delete `DEFAULT_PLAYER_COLORS` from game.ts
2. **Remove applyPlayerColors()**: Engine now handles this
3. **Remove color property from CheckersPlayer**: Use inherited `player.color`
4. **Simplify UI helper**: Use `player.color` directly
5. **Consider custom palette**: Checkers traditionally uses red/black - game can define `colors: ['#e74c3c', '#2c3e50']` in config to preserve theme

## New API Reference

### How player.color Works

1. **Engine auto-assigns**: When player joins, engine assigns color from palette based on seat index
2. **Always set**: `player.color` is guaranteed to be a hex string (e.g., `'#e74c3c'`)
3. **Customizable**: Game can define custom palette in game config
4. **Player-selectable**: If `colorSelectionEnabled: true`, players can change colors in lobby

### Before (deprecated pattern)

```typescript
// In game.ts
import { DEFAULT_PLAYER_COLORS } from 'boardsmith/session';

private applyPlayerColors(playerConfigs?: PlayerConfig[]): void {
  for (const player of this.all(Player)) {
    const arrayIndex = player.seat - 1;
    const config = playerConfigs?.[arrayIndex];
    player.color = config?.color ?? DEFAULT_PLAYER_COLORS[arrayIndex] ?? DEFAULT_PLAYER_COLORS[0];
  }
}

// In UI
import { DEFAULT_PLAYER_COLORS } from 'boardsmith/ui';

function getPlayerColor(seat: number): string {
  return players[seat - 1]?.color ?? DEFAULT_PLAYER_COLORS[seat - 1] ?? DEFAULT_PLAYER_COLORS[0];
}
```

### After (new pattern)

```typescript
// In game.ts - NO color handling needed, engine does it automatically

// In UI - trust player.color is always set
const playerColor = player.color; // Always a hex string
```

### Custom Color Palette

If a game wants specific colors (like checkers red/black):

```typescript
// In game config (boardsmith.json or game definition)
{
  "colors": ["#e74c3c", "#2c3e50"],  // Red, Dark gray
  "colorSelectionEnabled": false     // Optional: disable player color picking
}
```

## Architecture Patterns

### Pattern: Direct Property Access

**What:** Access `player.color` directly without fallbacks
**When to use:** Always - engine guarantees the property is set
**Example:**
```typescript
// In rules
const stoneColor = this.player!.color;

// In UI (from players prop)
const myColor = players[playerSeat - 1].color;

// In UI (from gameView)
const color = gameView.players[seatIndex].color;
```

### Pattern: Custom Game Palette

**What:** Define game-specific colors instead of using default palette
**When to use:** When the game has a specific color theme (like checkers red/black)
**Example:**
```typescript
// In game definition
export const gameDefinition = {
  colors: ['#e74c3c', '#2c3e50'],  // Red, Dark (for checkers)
  colorSelectionEnabled: false,     // Don't let players change
};
```

### Anti-Patterns to Avoid

- **Fallback chains**: `player.color ?? DEFAULT_PLAYER_COLORS[i] ?? '#ffffff'` - unnecessary, color is always set
- **Manual color assignment**: `this.applyPlayerColors()` - engine handles this
- **Shadowing color property**: `class MyPlayer { color: string = 'red' }` - use inherited property
- **Seat-to-index math**: `DEFAULT_PLAYER_COLORS[seat - 1]` - just use `player.color`

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Player color assignment | Manual applyPlayerColors() | Engine auto-assignment | Consistent, less code |
| Color fallbacks | Fallback chains | Direct player.color access | Always set by engine |
| Color picking UI | Custom color selectors | colorSelectionEnabled flag | Built into lobby |

**Key insight:** The entire color system is now engine-managed. Games should just consume `player.color`, not manage it.

## Common Pitfalls

### Pitfall 1: Over-Engineering Fallbacks

**What goes wrong:** Adding fallback logic for undefined colors
**Why it happens:** Distrust of the new API, cargo-culting old patterns
**How to avoid:** Trust that `player.color` is always a valid hex string
**Warning signs:** Code like `player.color ?? '#ffffff'` or `|| DEFAULT_PLAYER_COLORS[0]`

### Pitfall 2: Forgetting to Remove Imports

**What goes wrong:** Leaving `DEFAULT_PLAYER_COLORS` imports even when unused
**Why it happens:** Search-and-replace misses, dead code
**How to avoid:** After migration, grep for `DEFAULT_PLAYER` to find stragglers
**Warning signs:** IDE shows unused import warnings

### Pitfall 3: Shadowing the Color Property

**What goes wrong:** Custom Player class defines its own `color` property
**Why it happens:** Copy-paste from old code, wanting to set default
**How to avoid:** Use inherited `color` property from Player base class
**Warning signs:** TypeScript might not warn, but color changes won't work

### Pitfall 4: Keeping applyPlayerColors()

**What goes wrong:** Both engine and game try to set colors, causing conflicts
**Why it happens:** Incremental migration, forgetting to remove old code
**How to avoid:** Delete `applyPlayerColors()` method entirely
**Warning signs:** Player colors don't match what was selected in lobby

## Scope of Work

### Files to Modify

**Hex (4 files):**
1. `hex/src/rules/game.ts` - Remove DEFAULT_PLAYER_COLORS import and applyPlayerColors()
2. `hex/src/rules/elements.ts` - Remove DEFAULT_PLAYER_COLORS import, simplify getColorHex()
3. `hex/src/ui/App.vue` - Remove DEFAULT_PLAYER_COLORS import, simplify helper
4. `hex/src/ui/components/HexBoard.vue` - Remove DEFAULT_PLAYER_COLORS import, simplify getPlayerColors

**Checkers (3 files):**
1. `checkers/src/rules/game.ts` - Remove DEFAULT_PLAYER_COLORS import, remove applyPlayerColors(), remove CHECKERS_DEFAULT_COLORS
2. `checkers/src/rules/elements.ts` - Remove color property default from CheckersPlayer
3. `checkers/src/ui/components/CheckersBoard.vue` - Remove DEFAULT_CHECKERS_COLORS, simplify getPlayerColor

**Files to Modify for Custom Palette (optional):**
- `checkers/boardsmith.json` - Add colors array if checkers wants to preserve red/dark theme

### Files NOT to Modify

All other games (cribbage, go-fish, polyhedral-potions, floss-bitties, demos) do not use player colors and need no changes.

## Recommended Plan Structure

Given the limited scope (2 games), suggest **one plan** covering both games:

**68-01-PLAN.md: Migrate Hex and Checkers to player.color**

Tasks:
1. Hex rules: Remove deprecated imports and color management
2. Hex UI: Simplify to use player.color directly
3. Checkers rules: Remove deprecated imports and color management
4. Checkers UI: Simplify to use player.color directly
5. Verification: Test both games work with new API

Alternative structure (if preferred, for parallel work):
- 68-01-PLAN.md: Migrate Hex
- 68-02-PLAN.md: Migrate Checkers

## Open Questions

### Question 1: GAME-03 (MERC Game)

**What we know:** Requirements reference "MERC game" but no such game exists in BoardSmithGames
**What's unclear:** Was this planned but not created? Is it a typo?
**Recommendation:** Mark GAME-03 as N/A in requirements. If MERC is created later, it will use the new API from the start.

### Question 2: Checkers Custom Palette

**What we know:** Checkers traditionally uses red/black (or dark) colors
**What's unclear:** Should checkers preserve its specific palette via game config?
**Recommendation:** Yes, add `colors: ['#e74c3c', '#2c3e50']` to checkers config to preserve theme. This uses the new system correctly.

## Sources

### Primary (HIGH confidence)
- `/Users/jtsmith/BoardSmith/src/engine/player/player.ts` - player.color property definition
- `/Users/jtsmith/BoardSmith/src/session/colors.ts` - STANDARD_PLAYER_COLORS, deprecated DEFAULT_PLAYER_COLORS
- `/Users/jtsmith/BoardSmithGames/hex/src/` - Hex game source code
- `/Users/jtsmith/BoardSmithGames/checkers/src/` - Checkers game source code
- `/Users/jtsmith/BoardSmith/.planning/REQUIREMENTS.md` - GAME-01 through GAME-04 definitions

### Secondary (MEDIUM confidence)
- `/Users/jtsmith/BoardSmith/.planning/phases/67-cleanup/67-RESEARCH.md` - Phase 67 context

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Games audit: HIGH - Direct code inspection of all games
- Migration patterns: HIGH - Based on actual code and new API
- Pitfalls: HIGH - Derived from code patterns observed

**Research date:** 2026-01-25
**Valid until:** 2026-02-25 (stable migration, no external dependencies)
