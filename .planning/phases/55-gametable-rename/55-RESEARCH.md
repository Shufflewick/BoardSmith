# Phase 55: GameTable Rename - Research

**Researched:** 2026-01-22
**Domain:** File renaming, import updates, template modification
**Confidence:** HIGH

## Summary

This phase involves renaming `GameBoard.vue` to `GameTable.vue` across the entire BoardSmith codebase. The rename affects four distinct areas: (1) the BoardSmith AutoUI component `AutoGameBoard.vue`, (2) the project scaffold templates, (3) the `/design-game` instruction templates, and (4) four extracted games that use `GameBoard.vue` naming.

The rename is well-scoped with clear boundaries. Five games already use custom naming (`CheckersBoard.vue`, `CribbageBoard.vue`, `GoFishBoard.vue`, `HexBoard.vue`) and one game has no custom board component at all. The AutoUI component `AutoGameBoard.vue` should remain unchanged as it serves a different semantic purpose (auto-generated board rendering, not a custom game table).

**Primary recommendation:** Use `git mv` for all file renames to preserve history, then update imports systematically using search/replace patterns.

## Standard Stack

### Core Tools
| Tool | Purpose | Why Standard |
|------|---------|--------------|
| `git mv` | File renaming | Preserves git history across renames |
| grep/sed | Bulk text replacement | Reliable pattern-based updates |

### Alternative Approaches Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `git mv` | Plain `mv` then `git add` | Loses explicit rename tracking |
| Manual edits | IDE refactoring | Less consistent, error-prone |

## Architecture Patterns

### Files to Rename (4 total)

```
packages/games/demoAnimation/src/ui/components/GameBoard.vue
packages/games/demoComplexUiInteractions/src/ui/components/GameBoard.vue
packages/games/floss-bitties/src/ui/components/GameBoard.vue
packages/games/polyhedral-potions/ui/src/components/GameBoard.vue
```

### Files Already Using Custom Names (DO NOT RENAME)

These games already use game-specific board names:
```
packages/games/checkers/ui/src/components/CheckersBoard.vue
packages/games/cribbage/ui/src/components/CribbageBoard.vue
packages/games/go-fish/ui/src/components/GoFishBoard.vue
packages/games/hex/ui/src/components/HexBoard.vue
```

### Games Without Custom Board Component (NO ACTION NEEDED)
```
packages/games/demoActionPanel/  # Only has App.vue, uses AutoUI
```

### AutoUI Component (KEEP AS-IS)

```
src/ui/components/auto-ui/AutoGameBoard.vue
```

**Rationale:** `AutoGameBoard` is semantically distinct - it's the automatic board renderer, not a custom game table. The "GameBoard" in its name refers to its function (rendering the game's board automatically), not to the new "Table" terminology for custom components.

## Import Patterns to Update

### Pattern 1: Direct Import in App.vue
```typescript
// BEFORE
import GameBoard from './components/GameBoard.vue';

// AFTER
import GameTable from './components/GameTable.vue';
```

Files affected:
- `packages/games/demoAnimation/src/ui/App.vue`
- `packages/games/demoComplexUiInteractions/src/ui/App.vue`
- `packages/games/floss-bitties/src/ui/App.vue`
- `packages/games/polyhedral-potions/ui/src/App.vue`

### Pattern 2: Re-export in index.ts
```typescript
// BEFORE
export { default as GameBoard } from './components/GameBoard.vue';

// AFTER
export { default as GameTable } from './components/GameTable.vue';
```

Files affected:
- `packages/games/demoAnimation/src/ui/index.ts`
- `packages/games/demoComplexUiInteractions/src/ui/index.ts`
- `packages/games/floss-bitties/src/ui/index.ts`

Note: `polyhedral-potions` does NOT have an index.ts with GameBoard export.

### Pattern 3: Template Usage in App.vue
```vue
<!-- BEFORE -->
<GameBoard
  :game-view="gameView"
  ...
/>

<!-- AFTER -->
<GameTable
  :game-view="gameView"
  ...
/>
```

### Pattern 4: Comment References
```vue
<!-- BEFORE -->
<!--
  Demo: Animation Feature Showcase - GameBoard
-->

<!-- AFTER -->
<!--
  Demo: Animation Feature Showcase - GameTable
-->
```

## Template Updates

### Project Scaffold (src/cli/lib/project-scaffold.ts)

Lines to update:
- Line 253: `export { default as GameBoard }` -> `export { default as GameTable }`
- Line 263: `import GameBoard from './components/GameBoard.vue'`
- Line 276: `<GameBoard` -> `<GameTable`
- Line 348: Function `generateGameBoardVue()` -> `generateGameTableVue()`
- Line 383: Placeholder notice text
- Line 479: File path `'src/ui/components/GameBoard.vue'` -> `'src/ui/components/GameTable.vue'`

### Slash Command Instructions (src/cli/slash-command/instructions.md)

All references to `GameBoard.vue` need updating to `GameTable.vue`. Key sections:
- Line 400: Step 6 header
- Line 461: UI component description
- Line 698: Section header "GameBoard.vue Generation"
- Line 702: Description text
- Line 1027: Step 4 header
- Line 1031-1032: Instructions
- Line 1072: Verification step
- Lines 1168, 1435, 1751, 2059: Template headers
- Line 2296: Vue prop errors section

### Aspect Templates

Each aspect template has a "Custom UI Component (GameBoard.vue)" section:
- `src/cli/slash-command/aspects/dice.md` (line 71)
- `src/cli/slash-command/aspects/square-grid.md` (line 146)
- `src/cli/slash-command/aspects/playing-cards.md` (line 122)
- `src/cli/slash-command/aspects/hex-grid.md` (line 107)

## Documentation Updates

### Files Requiring Updates

| File | Changes Needed |
|------|----------------|
| `docs/getting-started.md` | Lines 41, 266 - file path and component usage |
| `docs/ui-components.md` | Lines 29, 52, 156, 341, 643, 742, 1271 |
| `docs/component-showcase.md` | Line 17 - example usage |
| `docs/api/client.md` | Line 298 - example code |
| `docs/llm-overview.md` | Line 240 - keep AutoGameBoard reference |
| `llms.txt` | Multiple lines - auto-generated from docs |
| `packages/ui/README.md` | Lines 21, 236, 241, 242 |

### Nomenclature Already Updated

The `docs/nomenclature.md` file already defines the new terminology:
- Line 24: "GameTable | Custom game visualization component (replaces GameBoard in v2.3)"
- Line 38: "Table | The visual game area where all components are displayed"

No changes needed to nomenclature.md itself.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| File renames | Manual mv + git add | `git mv` | Preserves history automatically |
| Bulk text replacement | Manual editing | grep + sed or IDE | Consistent, auditable |
| Finding all references | Manual searching | `grep -r "GameBoard"` | Complete coverage |

## Common Pitfalls

### Pitfall 1: Missing the Re-exports
**What goes wrong:** Renaming .vue files but forgetting index.ts exports
**Why it happens:** Index files are not immediately visible
**How to avoid:** Always check for index.ts files that re-export components
**Warning signs:** Build errors about missing exports

### Pitfall 2: Breaking the AutoGameBoard Component
**What goes wrong:** Renaming AutoGameBoard.vue to AutoGameTable.vue
**Why it happens:** Overzealous pattern matching
**How to avoid:** AutoGameBoard is semantically different - it auto-renders boards
**Warning signs:** Public API breakage, breaking changes to boardsmith/ui

### Pitfall 3: Inconsistent Casing
**What goes wrong:** Using "Gameboard", "gameBoard", "gameboard" inconsistently
**Why it happens:** Different files use different casing
**How to avoid:** Use exact patterns: `GameBoard` -> `GameTable`, `GameBoard.vue` -> `GameTable.vue`
**Warning signs:** Import errors, undefined components

### Pitfall 4: Forgetting to Update llms.txt
**What goes wrong:** llms.txt still references old names
**Why it happens:** It's generated but committed
**How to avoid:** Regenerate llms.txt after doc updates or manually update
**Warning signs:** AI assistants using outdated patterns

### Pitfall 5: Missing Comment Updates
**What goes wrong:** File renamed but internal comments still say "GameBoard"
**Why it happens:** Focus on code, not comments
**How to avoid:** Update component comments and file headers too
**Warning signs:** Confusing documentation inside renamed files

## Execution Order

1. **Rename files with git mv** (preserves history)
2. **Update imports in App.vue files** (fixes immediate breaks)
3. **Update exports in index.ts files** (fixes module exports)
4. **Update component usage in templates** (fixes template references)
5. **Update project-scaffold.ts** (fixes new project generation)
6. **Update instructions.md** (fixes /design-game command)
7. **Update aspect templates** (fixes aspect-specific instructions)
8. **Update documentation** (keeps docs accurate)
9. **Regenerate/update llms.txt** (keeps LLM context accurate)
10. **Build and test all 9 games** (validates changes)

## Build Verification

After all changes, verify:
```bash
# Build BoardSmith itself
npm run build

# Build each affected game
cd packages/games/demoAnimation && npm run build
cd packages/games/demoComplexUiInteractions && npm run build
cd packages/games/floss-bitties && npm run build
cd packages/games/polyhedral-potions && npm run build

# Games with custom names (should be unaffected)
cd packages/games/checkers && npm run build
cd packages/games/cribbage && npm run build
cd packages/games/go-fish && npm run build
cd packages/games/hex && npm run build
cd packages/games/demoActionPanel && npm run build
```

## Sources

### Primary (HIGH confidence)
- Direct codebase analysis via grep and file reading
- Existing nomenclature.md (Phase 54 output)
- ROADMAP.md and REQUIREMENTS.md specifications

### Files Analyzed
- `/Users/jtsmith/BoardSmith/src/ui/index.ts` - Public exports
- `/Users/jtsmith/BoardSmith/src/ui/components/auto-ui/index.ts` - AutoUI exports
- `/Users/jtsmith/BoardSmith/src/cli/lib/project-scaffold.ts` - Template generation
- `/Users/jtsmith/BoardSmith/src/cli/slash-command/instructions.md` - Design-game instructions
- All aspect templates in `/src/cli/slash-command/aspects/`
- All extracted games in `/packages/games/`

## Metadata

**Confidence breakdown:**
- File locations: HIGH - direct grep results
- Import patterns: HIGH - verified from source code
- Template updates: HIGH - analyzed scaffold and instructions
- Documentation: HIGH - comprehensive grep coverage

**Research date:** 2026-01-22
**Valid until:** No expiration - this is a one-time rename operation

## Open Questions

1. **Should AutoGameBoard also be renamed to AutoGameTable?**
   - Recommendation: NO - AutoGameBoard renders "the game board" automatically, which is different from the "custom GameTable component" concept. Renaming it would cause a breaking change to the public API.

2. **Should games with custom board names (CheckersBoard, etc.) be renamed?**
   - Recommendation: NO - These already follow a game-specific naming pattern. The convention is `{GameName}Board.vue` for custom implementations.

3. **Is llms.txt manually edited or regenerated?**
   - Unknown from research. Either approach works; if regenerated, ensure source docs are updated first.
