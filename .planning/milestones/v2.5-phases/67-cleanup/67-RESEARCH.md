# Phase 67: Cleanup - Research

**Researched:** 2026-01-25
**Domain:** API deprecation and documentation updates
**Confidence:** HIGH

## Summary

This phase completes the v2.5 Player Colors Refactor by removing or deprecating the legacy `DEFAULT_PLAYER_COLORS` export and updating documentation to reflect the new `player.color` API. The prior phases (64-66) have established the complete new color system:

- Phase 64: Engine provides `DEFAULT_COLOR_PALETTE`, auto-assigns colors to players based on seat
- Phase 65: Session layer validates color changes and prevents conflicts
- Phase 66: UI auto-injects color picker when `colorSelectionEnabled` is true

Games now receive colors automatically. The legacy `DEFAULT_PLAYER_COLORS` export (a 2-element array of red/blue) is obsolete but still used in several places that need cleanup.

**Primary recommendation:** Mark `DEFAULT_PLAYER_COLORS` as deprecated with JSDoc comments pointing to `player.color`, then update documentation to describe the new API with migration examples.

## Standard Stack

This phase involves only internal changes to documentation and type definitions. No new dependencies.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | internal | JSDoc @deprecated annotations | Standard way to mark deprecated APIs |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| None | - | - | - |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Deprecation annotation | Hard removal | Breaking change for games still using it; deprecation is gentler |
| JSDoc @deprecated | Console.warn at runtime | JSDoc is editor-visible, no runtime cost |

## Architecture Patterns

### Pattern 1: Deprecation with Migration Path

**What:** Mark old API as deprecated with clear guidance to replacement
**When to use:** When removing an API that external code may depend on

```typescript
// In src/session/colors.ts
/**
 * @deprecated Use `player.color` instead. Colors are now auto-assigned by the engine.
 *
 * Migration:
 * - Remove imports of DEFAULT_PLAYER_COLORS
 * - Access player colors via `player.color` (already set by engine)
 * - For UI, read from `gameView.players[i].color`
 *
 * See: https://boardsmith.io/docs/core-concepts#player-colors
 */
export const DEFAULT_PLAYER_COLORS = ['#e74c3c', '#3498db'] as const;
```

### Pattern 2: Re-export Deprecation

**What:** Mark re-exports as deprecated in all export locations
**When to use:** When an API is exported from multiple entry points

```typescript
// In src/ui/index.ts
/**
 * @deprecated Use `player.color` instead. Colors are now auto-assigned by the engine.
 */
export {
  DEFAULT_PLAYER_COLORS,
  // ... other non-deprecated exports
} from '../session/index.js';
```

### Pattern 3: Documentation-First Migration

**What:** Update documentation to show the new way prominently, relegating old pattern to "migration" section
**When to use:** When the new API is the recommended path

```markdown
## Player Colors

Players have a `color` property automatically set by the engine:

\`\`\`typescript
// In your UI
const playerColor = player.color;  // e.g., '#e74c3c'

// In game view
const myColor = gameView.players[playerSeat - 1].color;
\`\`\`

### Migration from DEFAULT_PLAYER_COLORS

If upgrading from a previous version, remove uses of `DEFAULT_PLAYER_COLORS`:

\`\`\`typescript
// Before (deprecated)
import { DEFAULT_PLAYER_COLORS } from 'boardsmith/session';
const color = DEFAULT_PLAYER_COLORS[playerSeat - 1];

// After (recommended)
const color = player.color;
\`\`\`
```

### Anti-Patterns to Avoid

- **Don't remove exports without deprecation period**: This breaks existing games without warning
- **Don't leave stale documentation**: Old examples using deprecated API confuse developers
- **Don't deprecate without alternative**: Always show what to use instead

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| API deprecation | Custom console warnings | JSDoc @deprecated | Editor support, no runtime cost |
| Documentation generation | Manual updates everywhere | Single source in docs folder | Consistency, easier maintenance |

**Key insight:** The documentation already shows the new `player.color` API in `core-concepts.md`. The task is primarily removing references to the old API and ensuring consistency.

## Common Pitfalls

### Pitfall 1: Incomplete Deprecation Coverage

**What goes wrong:** API marked deprecated in one file but not re-exports
**Why it happens:** Multiple export paths for the same symbol
**How to avoid:** Search all `export { DEFAULT_PLAYER_COLORS` occurrences
**Warning signs:** Some imports don't show deprecation warnings in editor

**Export locations to update:**
1. `src/session/colors.ts` - primary definition
2. `src/session/index.ts` - package re-export
3. `src/ui/index.ts` - UI package re-export

### Pitfall 2: Documentation Inconsistency

**What goes wrong:** Some docs show old API, others show new API
**Why it happens:** Docs updated incrementally without full audit
**How to avoid:** Search all .md files for `DEFAULT_PLAYER_COLORS`
**Warning signs:** Tutorials and API docs give conflicting advice

**Files to update:**
- `docs/api/session.md` - mentions `DEFAULT_PLAYER_COLORS` in exports list
- `docs/api/ui.md` - mentions `DEFAULT_PLAYER_COLORS` in exports list
- `docs/ui-components.md` - example code uses `DEFAULT_PLAYER_COLORS`
- `docs/core-concepts.md` - already shows new API, needs migration note

### Pitfall 3: Missing Migration Guidance

**What goes wrong:** Deprecation message says "don't use this" but not what to use
**Why it happens:** Focus on removing rather than guiding
**How to avoid:** Every deprecation annotation must include replacement
**Warning signs:** Developers stuck, file issues asking "what do I use instead?"

## Code Examples

### Current State: DEFAULT_PLAYER_COLORS Usages

```typescript
// src/session/colors.ts - Definition (line 62)
export const DEFAULT_PLAYER_COLORS = ['#e74c3c', '#3498db'] as const;

// src/session/index.ts - Re-export (line 103)
export {
  STANDARD_PLAYER_COLORS,
  DEFAULT_PLAYER_COLORS,  // This needs @deprecated
  createColorOption,
} from './colors.js';

// src/ui/index.ts - Re-export (line 312)
export {
  STANDARD_PLAYER_COLORS,
  DEFAULT_PLAYER_COLORS,  // This needs @deprecated
  type ColorChoice,
} from '../session/index.js';
```

### Deprecated Export Pattern

```typescript
// In src/session/colors.ts
/**
 * Default colors for 2-player games (Red vs Blue)
 *
 * @deprecated Use `player.color` instead. Colors are now auto-assigned by the engine
 * based on the game's color palette. Remove this import and access colors via:
 * - In rules: `player.color`
 * - In UI: `gameView.players[seatIndex].color`
 *
 * @example Migration
 * ```typescript
 * // Before
 * import { DEFAULT_PLAYER_COLORS } from 'boardsmith/session';
 * const color = DEFAULT_PLAYER_COLORS[player.seat - 1];
 *
 * // After
 * const color = player.color;
 * ```
 */
export const DEFAULT_PLAYER_COLORS = ['#e74c3c', '#3498db'] as const;
```

### Documentation Example (New API)

```typescript
// In core-concepts.md - Game Definition Metadata section

### Player Colors

Players automatically receive colors from the game's color palette:

```typescript
// Access in rules code
const myColor = player.color;  // '#e74c3c'

// Access in UI via gameView
const players = gameView.players;
const player1Color = players[0].color;  // '#e74c3c' (seat 1)
const player2Color = players[1].color;  // '#3498db' (seat 2)
```

The engine assigns colors from `DEFAULT_COLOR_PALETTE` unless the game provides custom colors:

```typescript
export const gameDefinition = {
  // Custom color palette (optional)
  colors: ['#ff0000', '#0000ff', '#00ff00'],

  // Disable color selection in lobby (optional, default: true)
  colorSelectionEnabled: false,
};
```
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Import DEFAULT_PLAYER_COLORS | Use player.color | Phase 64-66 | Auto-managed colors |
| Manual color assignment in game | Engine auto-assigns | Phase 64 | Less boilerplate |
| Index mismatch (0-indexed array, 1-indexed seat) | Direct player.color access | Phase 64 | No off-by-one errors |

**Deprecated/outdated:**
- `DEFAULT_PLAYER_COLORS` from `boardsmith/session` and `boardsmith/ui`
- Manual `applyPlayerColors()` methods in game constructors
- Direct array index access for player colors

## Scope of Changes

### Files to Modify

**Source Files (deprecation annotations):**
1. `src/session/colors.ts` - Add @deprecated to DEFAULT_PLAYER_COLORS
2. `src/session/index.ts` - Add @deprecated comment to re-export
3. `src/ui/index.ts` - Add @deprecated comment to re-export

**Documentation Files (content updates):**
1. `docs/api/session.md` - Update "Player Colors" section, add deprecation note
2. `docs/api/ui.md` - Update "Player Colors" section, add deprecation note
3. `docs/ui-components.md` - Update "Standard Color Picker" section examples
4. `docs/core-concepts.md` - Already has new API, add migration note if needed

### Files NOT to Modify (Phase 68 scope)

The following files use `DEFAULT_PLAYER_COLORS` but are game implementation files that will be updated in Phase 68:

- `packages/games/hex/rules/src/game.ts` - Phase 68
- `packages/games/hex/rules/src/elements.ts` - Phase 68
- `packages/games/hex/ui/src/App.vue` - Phase 68
- `packages/games/hex/ui/src/components/HexBoard.vue` - Phase 68
- `packages/games/checkers/rules/src/game.ts` - Phase 68

## Open Questions

None - the scope is well-defined and all information is available.

## Sources

### Primary (HIGH confidence)
- `/Users/jtsmith/BoardSmith/src/session/colors.ts` - Current DEFAULT_PLAYER_COLORS definition
- `/Users/jtsmith/BoardSmith/src/session/index.ts` - Export structure
- `/Users/jtsmith/BoardSmith/src/ui/index.ts` - UI re-exports
- `/Users/jtsmith/BoardSmith/.planning/REQUIREMENTS.md` - CLN-01, CLN-02 requirements
- `/Users/jtsmith/BoardSmith/.planning/ROADMAP.md` - Phase 67 success criteria

### Secondary (MEDIUM confidence)
- `/Users/jtsmith/BoardSmith/docs/api/session.md` - Current documentation
- `/Users/jtsmith/BoardSmith/docs/api/ui.md` - Current documentation
- `/Users/jtsmith/BoardSmith/docs/ui-components.md` - Current documentation
- `/Users/jtsmith/BoardSmith/docs/core-concepts.md` - New API documentation

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new dependencies, internal changes only
- Architecture: HIGH - Clear deprecation patterns from TypeScript ecosystem
- Pitfalls: HIGH - Identified from codebase search and documentation audit

**Research date:** 2026-01-25
**Valid until:** 2026-02-25 (stable deprecation, no external dependencies)
