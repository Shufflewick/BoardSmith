# Phase 64: Engine Layer - Research

**Researched:** 2026-01-25
**Domain:** Player color management in game engine
**Confidence:** HIGH

## Summary

This phase adds engine-level management of player colors to BoardSmith. Currently, each game manually handles color assignment via `playerConfigs` in constructors, falling back to `DEFAULT_PLAYER_COLORS` from `@boardsmith/session`. This leads to duplicated code across games and inconsistent color handling.

The refactor moves color management into the engine layer where:
1. Games define available colors via a `colors` configuration array in `GameOptions`
2. Players automatically receive colors based on seat index
3. A default palette is provided when games don't specify custom colors
4. Validation ensures `maxPlayers` doesn't exceed available colors

**Primary recommendation:** Extend `GameOptions` with color configuration and modify the `Player` class constructor to auto-assign colors from the game's palette.

## Standard Stack

The phase is entirely internal to `@boardsmith/engine`. No new dependencies required.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @boardsmith/engine | internal | Game engine | This is the package being modified |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @boardsmith/session | internal | Session management | Reference for DEFAULT_PLAYER_COLORS constants (to be deprecated) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Extending GameOptions | Static Game properties | GameOptions is how other config flows; consistency wins |
| Per-player override in options | Always from palette | Players will change colors via session layer in Phase 65 |

**Installation:**
No new packages needed.

## Architecture Patterns

### Recommended Project Structure

The changes affect these files in `packages/engine`:

```
packages/engine/
├── src/
│   ├── element/
│   │   └── game.ts          # Extend GameOptions, add color validation
│   └── player/
│       └── player.ts        # Color assignment from palette
└── dist/                    # Generated types
```

### Pattern 1: GameOptions Extension

**What:** Add color-related properties to `GameOptions` interface
**When to use:** This is the standard way games configure themselves

```typescript
// Current GameOptions
export type GameOptions = {
  playerCount: number;
  playerNames?: string[];
  seed?: string;
};

// Extended GameOptions
export type GameOptions = {
  playerCount: number;
  playerNames?: string[];
  seed?: string;

  // NEW: Color configuration
  colors?: string[];                   // Available color palette (hex strings)
  colorSelectionEnabled?: boolean;     // Whether players can change colors (default: true)
};
```

### Pattern 2: Default Color Palette

**What:** Engine provides a sensible default palette when `colors` is not specified
**When to use:** Always as fallback; games can override with custom palettes

```typescript
// In engine (new constant)
export const DEFAULT_COLOR_PALETTE: readonly string[] = [
  '#e74c3c',  // Red
  '#3498db',  // Blue
  '#27ae60',  // Green
  '#f39c12',  // Yellow/Orange
  '#9b59b6',  // Purple
  '#1abc9c',  // Teal
  '#e67e22',  // Orange
  '#2c3e50',  // Dark Blue/Black
] as const;
```

### Pattern 3: Color Assignment in Player Creation

**What:** Assign color from palette when player is created
**When to use:** During Game constructor player creation

```typescript
// In Game constructor (conceptual flow)
constructor(options: GameOptions) {
  super(options);

  // Resolve color palette
  const colorPalette = options.colors ?? DEFAULT_COLOR_PALETTE;

  // Validate early
  if (options.playerCount > colorPalette.length) {
    throw new Error(
      `Cannot create ${options.playerCount} players: only ${colorPalette.length} colors available. ` +
      `Provide more colors in gameOptions.colors or reduce maxPlayers.`
    );
  }

  // Create players with colors
  for (let i = 0; i < options.playerCount; i++) {
    const player = this.create(PlayerClass, ...);
    player.color = colorPalette[i];  // Seat 1 = index 0, etc.
  }
}
```

### Pattern 4: colorSelectionEnabled Flag

**What:** Boolean flag to indicate whether color selection UI should be shown
**When to use:** Games where color is thematic (e.g., chess: white/black) vs games where it's cosmetic

```typescript
// In GameOptions
colorSelectionEnabled?: boolean;  // default: true

// Passed through to session/UI layers via game state
// NOT used by engine directly, but stored for downstream consumers
```

### Anti-Patterns to Avoid

- **Don't hard-code colors in Player class**: Colors come from game configuration, not Player defaults
- **Don't silently truncate colors**: If maxPlayers > colors.length, throw descriptive error
- **Don't mix 0-indexed and 1-indexed**: Seat is 1-indexed; array access uses `seat - 1`
- **Don't change color semantics**: Color remains `string | undefined` on Player; engine just auto-assigns

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Color uniqueness | Manual deduplication | Palette validation at game creation | Unique by construction |
| Default colors | Array of magic strings | Named constant `DEFAULT_COLOR_PALETTE` | Single source of truth |
| Color format validation | Regex validation | Trust game developer | Hex strings are convention, not enforced |

**Key insight:** The engine doesn't validate color format (e.g., valid hex codes) because games might use CSS color names or other formats. The engine just stores and assigns strings.

## Common Pitfalls

### Pitfall 1: Index Off-By-One Errors

**What goes wrong:** Player seat is 1-indexed but arrays are 0-indexed
**Why it happens:** Inconsistent mental model when accessing `colors[player.seat]`
**How to avoid:** Always use `colors[player.seat - 1]` with explicit comment
**Warning signs:** Player 1 gets undefined color, Player N gets wrong color

### Pitfall 2: Validation Timing

**What goes wrong:** Validation happens too late (after players created)
**Why it happens:** Easy to validate in wrong place
**How to avoid:** Validate `playerCount <= colors.length` BEFORE creating players
**Warning signs:** Partially constructed game with missing player colors

### Pitfall 3: Breaking Existing Games

**What goes wrong:** Games that set `player.color` manually get overwritten
**Why it happens:** Engine assigns colors, then game constructor runs
**How to avoid:** Engine assigns in Game constructor before subclass constructor body runs
**Warning signs:** Games with custom color logic behave differently

**Resolution:** Game constructors run AFTER super() call completes, so:
1. Engine assigns default colors during super()
2. Game subclass can override in constructor body if needed

### Pitfall 4: Serialization of colorSelectionEnabled

**What goes wrong:** Flag not available after game restore
**Why it happens:** Flag stored in options but not in game state
**How to avoid:** Store colorSelectionEnabled in `game.settings` for persistence
**Warning signs:** Color picker shown/hidden inconsistently after reload

## Code Examples

Verified patterns from the existing codebase:

### Current Color Assignment (to be replaced)
```typescript
// From packages/games/hex/rules/src/game.ts
private applyPlayerColors(playerConfigs?: PlayerConfig[]): void {
  // playerConfigs and DEFAULT_PLAYER_COLORS are 0-indexed arrays,
  // but player.seat is 1-indexed, so use seat - 1 for array access
  for (const player of this.all(Player)) {
    const arrayIndex = player.seat - 1;
    const config = playerConfigs?.[arrayIndex];
    if (config?.color) {
      player.color = config.color;
    } else {
      player.color = DEFAULT_PLAYER_COLORS[arrayIndex] ?? DEFAULT_PLAYER_COLORS[0];
    }
  }
}
```

### Player.color Property (existing)
```typescript
// From packages/engine/dist/player/player.d.ts
/**
 * Player color for UI display (hex code like '#FF0000' or color name).
 *
 * Set during game setup and used by the UI to distinguish players visually.
 */
color?: string;
```

### GameDefinition with Color Options (existing pattern)
```typescript
// From packages/games/hex/rules/src/index.ts
export const gameDefinition = {
  gameClass: HexGame,
  gameType: 'hex',
  minPlayers: 2,
  maxPlayers: 2,
  // ...
  playerOptions: {
    color: createColorOption(),  // This stays, for lobby UI
  },
};
```

### New Engine Color Configuration (proposed)
```typescript
// In GameOptions (packages/engine)
export type GameOptions = {
  playerCount: number;
  playerNames?: string[];
  seed?: string;

  // Color configuration
  colors?: string[];                   // Available palette
  colorSelectionEnabled?: boolean;     // Show color picker in lobby
};

// In Game constructor
const palette = options.colors ?? DEFAULT_COLOR_PALETTE;

if (options.playerCount > palette.length) {
  throw new Error(
    `Game requires ${options.playerCount} players but only ${palette.length} colors available. ` +
    `Define more colors in game options.`
  );
}

// Assign colors during player creation
const PlayerClassToUse = (this.constructor as typeof Game).PlayerClass ?? Player;
for (let i = 1; i <= options.playerCount; i++) {
  const player = this.create(PlayerClassToUse, `player-${i}`, {
    position: i,
  });
  player.color = palette[i - 1];  // Seat 1 = index 0
}

// Store colorSelectionEnabled for downstream
this.settings.colorSelectionEnabled = options.colorSelectionEnabled ?? true;
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual color assignment in each game | Engine-managed colors | This milestone | Eliminates duplicated code |
| DEFAULT_PLAYER_COLORS from session | DEFAULT_COLOR_PALETTE in engine | This milestone | Engine is self-contained |
| No validation of color count | Validation at game creation | This milestone | Fail-fast on misconfiguration |

**Deprecated/outdated:**
- `DEFAULT_PLAYER_COLORS` from `@boardsmith/session`: Will be deprecated in Phase 67
- Manual `applyPlayerColors` methods: No longer needed, engine handles this

## Open Questions

Things that couldn't be fully resolved:

1. **Where exactly are players created in Game constructor?**
   - What we know: Game constructor creates players via `this.create()`
   - What's unclear: Exact line in source (only .d.ts available)
   - Recommendation: Modify player creation loop to assign color immediately after creation

2. **How does colorSelectionEnabled flow to session layer?**
   - What we know: Session receives `gameOptions` in `CreateGameRequest`
   - What's unclear: Whether session needs to pull from game.settings or options
   - Recommendation: Phase 65 will address session integration; store in game.settings for now

3. **Should colors array be stored on Game instance?**
   - What we know: GameOptions are passed to constructor
   - What's unclear: Whether palette should be accessible later for validation
   - Recommendation: Store `colors` in game.settings for session layer access

## Sources

### Primary (HIGH confidence)
- `/Users/jtsmith/BoardSmith/packages/engine/dist/player/player.d.ts` - Player.color property definition
- `/Users/jtsmith/BoardSmith/packages/engine/dist/element/game.d.ts` - Game class and GameOptions type
- `/Users/jtsmith/BoardSmith/.planning/REQUIREMENTS.md` - ENG-01 through ENG-06 requirements
- `/Users/jtsmith/BoardSmith/.planning/ROADMAP.md` - Phase 64 success criteria

### Secondary (MEDIUM confidence)
- `/Users/jtsmith/BoardSmith/packages/games/hex/rules/src/game.ts` - Current color assignment pattern
- `/Users/jtsmith/BoardSmith/packages/session/dist/colors.d.ts` - DEFAULT_PLAYER_COLORS definition

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Internal package modification, no external deps
- Architecture: HIGH - Patterns derived from existing codebase
- Pitfalls: HIGH - Identified from existing game implementations

**Research date:** 2026-01-25
**Valid until:** 2026-02-25 (stable internal refactor)
