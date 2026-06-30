# Phase 66: UI Layer - Research

**Researched:** 2026-01-25
**Domain:** Vue 3 UI components for player color selection
**Confidence:** HIGH

## Summary

Phase 66 adds color picker UI to the Lobby (WaitingRoom) and color indicator to the PlayersPanel. The infrastructure from Phase 64-65 is complete:
- `Player.color` property exists
- `colorSelectionEnabled` and `colors` array in game settings
- Color conflict validation in session layer
- `updatePlayerOptions({ color })` API ready

The UI work is straightforward because the WaitingRoom already has a color picker implementation for `type: 'color'` player options. The PlayersPanel already displays `player.color` when present. The gap is **conditional visibility** based on `colorSelectionEnabled`.

**Primary recommendation:** Extend LobbyInfo to include `colorSelectionEnabled` and `colors` from game settings, then use these in WaitingRoom and PlayersPanel for conditional rendering.

## Standard Stack

The existing stack is sufficient - no new dependencies needed.

### Core
| Component | Location | Purpose | Why Standard |
|-----------|----------|---------|--------------|
| WaitingRoom.vue | `src/ui/components/WaitingRoom.vue` | Lobby configuration UI | Already has color picker for `type: 'color'` options |
| PlayersPanel.vue | `src/ui/components/PlayersPanel.vue` | Player list with stats | Already has `.player-color` swatch when `player.color` exists |
| GameShell.vue | `src/ui/components/GameShell.vue` | Main game wrapper | Provides `players` to PlayersPanel |

### Supporting
| Library | Purpose | When Used |
|---------|---------|-----------|
| Vue 3 refs/computed | Reactive state | Conditional rendering |
| CSS classes | Visual styling | Color swatches, selected states |

### No New Dependencies
The existing color picker in WaitingRoom (lines 707-721) handles:
- Color swatches with CSS styling
- Selected/taken state classes
- Click handlers for color selection

## Architecture Patterns

### Data Flow for Color Selection

```
Game Definition
    |
    v
LobbyInfo (needs: colorSelectionEnabled, colors)
    |
    v
WaitingRoom.vue
    |-- colorSelectionEnabled: show/hide color picker
    |-- colors: available palette
    |-- slot.playerOptions.color: occupied colors
    |
    v
updatePlayerOptions({ color: '#hex' })
    |
    v
Session Layer validates conflicts
    |
    v
LobbyInfo broadcast to all clients
```

### Pattern 1: LobbyInfo Extension
**What:** Add `colorSelectionEnabled` and `colors` to LobbyInfo
**When to use:** Always for Phase 66
**Implementation:**

```typescript
// In src/session/types.ts - LobbyInfo interface
export interface LobbyInfo {
  // ... existing fields ...

  /** Whether players can select colors in lobby */
  colorSelectionEnabled?: boolean;
  /** Available color palette (hex strings) */
  colors?: string[];
}

// In src/session/lobby-manager.ts - getLobbyInfo()
return {
  // ... existing fields ...
  colorSelectionEnabled: this.#storedState.colorSelectionEnabled,
  colors: this.#storedState.colors,
};
```

### Pattern 2: Conditional Color Picker in WaitingRoom
**What:** Only show color picker when colorSelectionEnabled is true
**When to use:** In "Your Settings" section of WaitingRoom

```vue
<!-- Existing pattern in WaitingRoom.vue lines 707-721 -->
<div v-if="opt.type === 'color'" class="color-picker">
  <button
    v-for="color in getPlayerOptionChoices(opt)"
    :key="color.value"
    class="color-swatch"
    :class="{
      selected: getMyOptionValue(String(key), opt) === color.value,
      taken: isChoiceTaken(mySlot?.seat ?? -1, String(key), color.value)
    }"
    :style="{ backgroundColor: color.value }"
    ...
  />
</div>
```

The existing color picker is shown when `playerOptions` includes a `type: 'color'` option. Phase 66 needs to ensure:
1. The color option is only present when `colorSelectionEnabled` is true
2. The colors come from the game's `colors` array

### Pattern 3: Conditional Color Indicator in PlayersPanel
**What:** Only show color swatch when colorSelectionEnabled is true
**When to use:** In player name row

```vue
<!-- Existing in PlayersPanel.vue line 40 -->
<span v-if="player.color" class="player-color" :style="{ backgroundColor: player.color }"></span>

<!-- Needs to change to -->
<span
  v-if="colorSelectionEnabled && player.color"
  class="player-color"
  :style="{ backgroundColor: player.color }"
></span>
```

### Anti-Patterns to Avoid
- **Hardcoding color visibility:** Don't show colors unconditionally - use `colorSelectionEnabled`
- **Client-side color validation:** Don't validate conflicts in UI - session layer handles this
- **Mixing selection modes:** Don't show color picker when `colorSelectionEnabled: false`

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Color picker UI | Custom color input | Existing swatch grid in WaitingRoom | Already styled, handles taken state |
| Color conflict detection | Client-side validation | Session layer `COLOR_ALREADY_TAKEN` | Server is source of truth |
| Color swatch styling | Custom CSS | Existing `.color-swatch` classes | Consistent styling |
| Occupied color indication | Custom overlay | Existing `.taken` class with X mark | Lines 1465-1484 |

**Key insight:** The WaitingRoom already has a complete color picker implementation. Phase 66 just needs to:
1. Expose `colorSelectionEnabled` and `colors` from session layer
2. Conditionally render based on `colorSelectionEnabled`

## Common Pitfalls

### Pitfall 1: Missing colorSelectionEnabled in LobbyInfo
**What goes wrong:** WaitingRoom shows color picker unconditionally or not at all
**Why it happens:** LobbyInfo doesn't include the flag from game settings
**How to avoid:** Add `colorSelectionEnabled` to LobbyInfo interface and populate in `getLobbyInfo()`
**Warning signs:** Color picker visible in games that don't want it, or invisible when it should show

### Pitfall 2: Using wrong color source
**What goes wrong:** WaitingRoom shows default palette instead of game-specific colors
**Why it happens:** Using STANDARD_PLAYER_COLORS instead of game's `colors` array
**How to avoid:** LobbyInfo should include `colors` array from game settings
**Warning signs:** Colors don't match game theme, too many/few colors

### Pitfall 3: PlayersPanel not receiving colorSelectionEnabled
**What goes wrong:** Player colors always show or never show
**Why it happens:** PlayersPanel doesn't have access to the flag
**How to avoid:** Pass as prop or include in slot context
**Warning signs:** Colors visible in games without color selection enabled

### Pitfall 4: Race condition on color display
**What goes wrong:** Color indicator shows before player has selected
**Why it happens:** Checking `player.color` without checking if game uses colors
**How to avoid:** Always check `colorSelectionEnabled && player.color`
**Warning signs:** Auto-assigned colors visible when game doesn't use color selection

## Code Examples

### WaitingRoom Color Picker (Already Exists)
```vue
<!-- Source: src/ui/components/WaitingRoom.vue lines 707-721 -->
<div v-else-if="opt.type === 'color'" class="color-picker">
  <button
    v-for="color in getPlayerOptionChoices(opt)"
    :key="color.value"
    class="color-swatch"
    :class="{
      selected: getMyOptionValue(String(key), opt) === color.value,
      taken: isChoiceTaken(mySlot?.seat ?? -1, String(key), color.value)
    }"
    :style="{ backgroundColor: color.value }"
    :title="isChoiceTaken(mySlot?.seat ?? -1, String(key), color.value)
      ? `${color.label} (taken)` : color.label"
    :disabled="isChoiceTaken(mySlot?.seat ?? -1, String(key), color.value)"
    @click="!isChoiceTaken(mySlot?.seat ?? -1, String(key), color.value)
      && handleUpdateOption(String(key), color.value)"
  />
</div>
```

### PlayersPanel Color Indicator (Already Exists)
```vue
<!-- Source: src/ui/components/PlayersPanel.vue lines 37-41 -->
<div class="player-name-row">
  <span v-if="player.seat === currentPlayerSeat" class="turn-indicator-dot"></span>
  <span class="player-name">{{ player.name }}</span>
  <span v-if="player.color" class="player-color"
        :style="{ backgroundColor: player.color }"></span>
  <span v-if="player.seat === playerSeat" class="you-badge">(You)</span>
</div>
```

### Color Swatch CSS (Already Exists)
```css
/* Source: src/ui/components/WaitingRoom.vue lines 1439-1484 */
.color-swatch {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 3px solid transparent;
  cursor: pointer;
  transition: all 0.2s;
}

.color-swatch.selected {
  border-color: #fff;
  box-shadow: 0 0 12px rgba(255, 255, 255, 0.5);
}

.color-swatch.taken::before,
.color-swatch.taken::after {
  content: '';
  position: absolute;
  /* X mark overlay */
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hardcoded colors | Game-configurable `colors` array | Phase 64 | Games can customize palette |
| Always show color picker | Conditional via `colorSelectionEnabled` | Phase 64 | Games opt-in to color selection |
| No color conflicts | Session layer validation | Phase 65 | Two players can't have same color |

## Open Questions

1. **How does PlayersPanel get colorSelectionEnabled?**
   - What we know: PlayersPanel receives `players` array via props
   - What's unclear: Should it come via prop or inject?
   - Recommendation: Add optional `colorSelectionEnabled` prop to PlayersPanel, let GameShell pass it from game settings or player state

2. **Should WaitingRoom auto-show color picker?**
   - What we know: WaitingRoom shows color picker when `playerOptions` has `type: 'color'`
   - What's unclear: Should color option be auto-injected when `colorSelectionEnabled` is true?
   - Recommendation: Let game definitions explicitly include color in playerOptions when they want it; `colorSelectionEnabled` controls whether the UI respects it

## Sources

### Primary (HIGH confidence)
- `src/ui/components/WaitingRoom.vue` - Existing color picker implementation (lines 707-721, 1439-1484)
- `src/ui/components/PlayersPanel.vue` - Existing color indicator (lines 37-41, 77-83)
- `src/session/types.ts` - LobbyInfo interface definition
- `src/session/lobby-manager.ts` - getLobbyInfo() method

### Secondary (MEDIUM confidence)
- `src/engine/element/game.ts` - colorSelectionEnabled and colors in GameSettings (lines 138-140, 457-459)
- Phase 65 PLAN - Color conflict validation implementation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Existing components fully analyzed
- Architecture: HIGH - Data flow is clear from session to UI
- Pitfalls: HIGH - Based on existing code patterns

**Research date:** 2026-01-25
**Valid until:** 60 days (stable Vue patterns, no external dependencies)
