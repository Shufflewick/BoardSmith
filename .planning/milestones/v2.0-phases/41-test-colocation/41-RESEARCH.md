# Phase 41: Test Colocation - Research

**Researched:** 2026-01-18
**Domain:** Test organization and Vitest configuration
**Confidence:** HIGH

## Summary

This phase involves moving 26 test files from `packages/*/tests/` directories to be colocated as direct siblings of their source files in `src/`. The codebase already uses the `.test.ts` naming convention consistently, so no renaming is needed - just relocation with import path updates.

The tests currently live in `packages/*/tests/*.test.ts` but the source code was moved to `src/*/` in Phase 40. After this phase, tests will live as siblings to the files they test (e.g., `src/engine/flow/engine.test.ts` next to `src/engine/flow/engine.ts`).

**Primary recommendation:** Move each test file to sit directly beside its primary source file, update import paths from `../src/index.js` to `./index.js` (or the specific module), and update vitest.config.ts to match the new `src/**/*.test.ts` pattern.

## Current State Analysis

### Test File Inventory

**26 test files** across 7 packages need relocation:

| Package | Test Files | Tests For |
|---------|------------|-----------|
| engine | 5 | element, action, flow, dev-state, command-undo |
| runtime | 3 | serializer, snapshot, runner |
| ai | 3 | mcts-bot, mcts-cache, cribbage-bot |
| ai-trainer | 2 | evolution, parallel-simulator |
| ui | 2 (+1 helper) | useActionController, useActionController.selections |
| session | 1 | checkpoint-manager |
| games/* | 10 | Various game tests |

### Current Import Patterns

All tests currently import from `../src/index.js`:
```typescript
// Current pattern (packages/engine/tests/element.test.ts)
import { Game, Space, Piece, ... } from '../src/index.js';
```

After colocation, imports become relative siblings:
```typescript
// Colocated pattern (src/engine/element/game-element.test.ts)
import { Game, Space, Piece, ... } from './index.js';
// or direct imports:
import { GameElement } from './game-element.js';
```

### Test Helper Files

One helper file exists:
- `packages/ui/tests/useActionController.helpers.ts` - shared test fixtures

This should move to `src/ui/composables/useActionController.helpers.ts` alongside the test files.

## Architecture Patterns

### Recommended Colocated Structure

```
src/
├── engine/
│   ├── element/
│   │   ├── game-element.ts
│   │   ├── game-element.test.ts  # Tests element functionality
│   │   ├── game.ts
│   │   └── ...
│   ├── action/
│   │   ├── action.ts
│   │   ├── action.test.ts        # Tests action functionality
│   │   └── ...
│   ├── flow/
│   │   ├── engine.ts
│   │   ├── engine.test.ts        # Tests flow engine
│   │   └── ...
│   └── ...
├── runtime/
│   ├── runner.ts
│   ├── runner.test.ts
│   └── ...
├── ui/
│   └── composables/
│       ├── useActionController.ts
│       ├── useActionController.test.ts
│       ├── useActionController.selections.test.ts
│       └── useActionController.helpers.ts  # Test helpers
└── ...
```

### Test-to-Source File Mapping

| Current Test | Target Location | Primary Source |
|--------------|-----------------|----------------|
| `packages/engine/tests/element.test.ts` | `src/engine/element/game-element.test.ts` | `src/engine/element/game-element.ts` |
| `packages/engine/tests/action.test.ts` | `src/engine/action/action.test.ts` | `src/engine/action/action.ts` |
| `packages/engine/tests/flow.test.ts` | `src/engine/flow/engine.test.ts` | `src/engine/flow/engine.ts` |
| `packages/engine/tests/dev-state.test.ts` | `src/engine/utils/dev-state.test.ts` | `src/engine/utils/dev-state.ts` |
| `packages/engine/tests/command-undo.test.ts` | `src/engine/command/executor.test.ts` | `src/engine/command/executor.ts` |
| `packages/runtime/tests/runner.test.ts` | `src/runtime/runner.test.ts` | `src/runtime/runner.ts` |
| `packages/runtime/tests/serializer.test.ts` | `src/engine/utils/serializer.test.ts` | `src/engine/utils/serializer.ts` |
| `packages/runtime/tests/snapshot.test.ts` | `src/engine/utils/snapshot.test.ts` | `src/engine/utils/snapshot.ts` |
| `packages/ai/tests/mcts-bot.test.ts` | `src/ai/mcts-bot.test.ts` | `src/ai/mcts-bot.ts` |
| `packages/ai/tests/mcts-cache.test.ts` | `src/ai/mcts-cache.test.ts` | `src/ai/mcts-cache.ts` (needs discovery) |
| `packages/ai/tests/cribbage-bot.test.ts` | `src/ai/cribbage-bot.test.ts` | Game-specific bot test |
| `packages/ai-trainer/tests/evolution.test.ts` | `src/ai-trainer/evolution.test.ts` | `src/ai-trainer/evolution.ts` |
| `packages/ai-trainer/tests/parallel-simulator.test.ts` | `src/ai-trainer/parallel-simulator.test.ts` | `src/ai-trainer/parallel-simulator.ts` |
| `packages/ui/tests/useActionController.test.ts` | `src/ui/composables/useActionController.test.ts` | `src/ui/composables/useActionController.ts` |
| `packages/ui/tests/useActionController.selections.test.ts` | `src/ui/composables/useActionController.selections.test.ts` | Same module, selection tests |
| `packages/session/tests/checkpoint-manager.test.ts` | `src/session/checkpoint-manager.test.ts` | `src/session/checkpoint-manager.ts` |

### Game Tests

Game tests stay with games (which remain in `packages/games/` until Phase 44):
- `packages/games/*/tests/game.test.ts` -> Stays in place for now
- These will move when games are extracted in Phase 44

**10 game test files** (will NOT move in this phase):
- checkers, go-fish (3 files), floss-bitties, hex, cribbage, polyhedral-potions, demoComplexUiInteractions, demoAnimation

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Import path calculation | Manual path string manipulation | IDE/editor batch rename | Editors handle relative path calculation correctly |
| Test discovery | Custom glob patterns | Vitest's built-in `include` | Standard, maintained, fast |
| Test naming | Custom convention | Keep existing `.test.ts` | Already consistent in codebase |

## Common Pitfalls

### Pitfall 1: Breaking Import Paths
**What goes wrong:** Tests fail to compile after move due to incorrect relative imports
**Why it happens:** Import paths need recalculation after directory change
**How to avoid:** Update imports systematically - from `../src/index.js` to sibling-relative paths
**Warning signs:** TypeScript errors about missing modules

### Pitfall 2: Missing Vitest Config Update
**What goes wrong:** Tests don't run because vitest can't find them
**Why it happens:** vitest.config.ts still has old `packages/**/tests/**/*.test.ts` pattern
**How to avoid:** Update config pattern to `src/**/*.test.ts` immediately
**Warning signs:** "No test files found" error from vitest

### Pitfall 3: Orphaned Helper Files
**What goes wrong:** Test helper files left in old location, tests fail
**Why it happens:** Helper files aren't `.test.ts` so might be missed
**How to avoid:** Move `useActionController.helpers.ts` with the tests
**Warning signs:** "Module not found" for helper imports

### Pitfall 4: Moving Game Tests Too Early
**What goes wrong:** Game tests moved to src/ but games still in packages/
**Why it happens:** Confusion about phase scope
**How to avoid:** Only move library tests (engine, runtime, ai, etc.), NOT game tests
**Warning signs:** Broken imports referencing `@boardsmith/*-rules` packages

## Vitest Configuration

### Current Configuration
```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/tests/**/*.test.ts', 'cli/tests/**/*.test.ts'],
  },
});
```

### Target Configuration
```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'src/**/*.test.ts',                    // Colocated library tests
      'packages/games/**/tests/**/*.test.ts', // Game tests (until Phase 44)
    ],
  },
});
```

## Implementation Strategy

### Phase Execution Order

1. **Update vitest.config.ts FIRST** - Add new pattern, keep old one temporarily
2. **Move library tests** - engine, runtime, ai, ai-trainer, ui, session
3. **Update imports in moved tests** - Fix all relative paths
4. **Move helper files** - useActionController.helpers.ts
5. **Run tests** - Verify all pass
6. **Clean up config** - Remove old packages pattern (keep games pattern)

### Import Update Pattern

For each test file:
```typescript
// Before (in packages/engine/tests/element.test.ts):
import { Game, Space, Piece, ... } from '../src/index.js';

// After (in src/engine/element/game-element.test.ts):
import { Game, Space, Piece, ... } from '../index.js';
// or use the parent package's index:
import { Game, Space, Piece, ... } from '../../index.js';
```

The exact path depends on test file location relative to the index.ts that exports the needed symbols.

## Code Examples

### Test File Move Pattern

```bash
# Example: engine element test
# From: packages/engine/tests/element.test.ts
# To:   src/engine/element/game-element.test.ts

git mv packages/engine/tests/element.test.ts src/engine/element/game-element.test.ts
```

### Import Path Update

```typescript
// Before
import {
  Game,
  Space,
  Piece,
  GameElement,
  ElementCollection,
  Player,
} from '../src/index.js';

// After (relative to src/engine/element/)
import {
  Game,
  Space,
  Piece,
  GameElement,
  ElementCollection,
  Player,
} from '../index.js';
```

## Files to Move Summary

### Immediate Moves (16 test files + 1 helper)

| From | To |
|------|-----|
| `packages/engine/tests/element.test.ts` | `src/engine/element/game-element.test.ts` |
| `packages/engine/tests/action.test.ts` | `src/engine/action/action.test.ts` |
| `packages/engine/tests/flow.test.ts` | `src/engine/flow/engine.test.ts` |
| `packages/engine/tests/dev-state.test.ts` | `src/engine/utils/dev-state.test.ts` |
| `packages/engine/tests/command-undo.test.ts` | `src/engine/command/executor.test.ts` |
| `packages/runtime/tests/runner.test.ts` | `src/runtime/runner.test.ts` |
| `packages/runtime/tests/serializer.test.ts` | `src/engine/utils/serializer.test.ts` |
| `packages/runtime/tests/snapshot.test.ts` | `src/engine/utils/snapshot.test.ts` |
| `packages/ai/tests/mcts-bot.test.ts` | `src/ai/mcts-bot.test.ts` |
| `packages/ai/tests/mcts-cache.test.ts` | `src/ai/mcts-cache.test.ts` |
| `packages/ai/tests/cribbage-bot.test.ts` | `src/ai/cribbage-bot.test.ts` |
| `packages/ai-trainer/tests/evolution.test.ts` | `src/ai-trainer/evolution.test.ts` |
| `packages/ai-trainer/tests/parallel-simulator.test.ts` | `src/ai-trainer/parallel-simulator.test.ts` |
| `packages/ui/tests/useActionController.test.ts` | `src/ui/composables/useActionController.test.ts` |
| `packages/ui/tests/useActionController.selections.test.ts` | `src/ui/composables/useActionController.selections.test.ts` |
| `packages/ui/tests/useActionController.helpers.ts` | `src/ui/composables/useActionController.helpers.ts` |
| `packages/session/tests/checkpoint-manager.test.ts` | `src/session/checkpoint-manager.test.ts` |

### Deferred (10 game test files)

These remain in `packages/games/*/tests/` until Phase 44:
- packages/games/checkers/tests/game.test.ts
- packages/games/go-fish/tests/game.test.ts
- packages/games/go-fish/tests/complete-game.test.ts
- packages/games/go-fish/tests/e2e-game.test.ts
- packages/games/floss-bitties/tests/game.test.ts
- packages/games/hex/tests/game.test.ts
- packages/games/cribbage/tests/game.test.ts
- packages/games/polyhedral-potions/tests/game.test.ts
- packages/games/demoComplexUiInteractions/tests/game.test.ts
- packages/games/demoAnimation/tests/game.test.ts

## Open Questions

None - all requirements are clear from CONTEXT.md and codebase analysis.

## Sources

### Primary (HIGH confidence)
- Direct codebase analysis of test files and structure
- vitest.config.ts for current test patterns
- CONTEXT.md for user decisions

### Verification
- All test file paths verified via glob
- All source file paths verified via file listing
- Import patterns verified by reading test files

## Metadata

**Confidence breakdown:**
- Test file inventory: HIGH - direct file listing
- Import patterns: HIGH - verified by reading files
- Vitest config: HIGH - read directly from config file
- Target locations: HIGH - based on existing src/ structure from Phase 40

**Research date:** 2026-01-18
**Valid until:** Until phase complete (stable - no external dependencies)
