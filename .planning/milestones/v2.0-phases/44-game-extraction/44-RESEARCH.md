# Phase 44: Game Extraction - Research

**Researched:** 2026-01-18
**Domain:** Repository extraction, npm packaging, standalone game projects
**Confidence:** HIGH

## Summary

This phase involves extracting 6 games and 3 demos from the BoardSmith monorepo into standalone git repositories. The extraction is largely a file reorganization task with import rewrites - no new libraries or complex patterns are needed.

Key findings:
1. Games have two structural patterns: **split** (hex, checkers, cribbage, go-fish, polyhedral-potions with rules/, ui/, tests/) and **unified** (demoAnimation, demoComplexUiInteractions, floss-bitties, demoActionPanel with src/ containing rules/ and ui/)
2. All games currently import from `@boardsmith/*` packages - these must be rewritten to `boardsmith` or `boardsmith/*` subpaths
3. The CLI scaffold (via `boardsmith init`) already produces the target structure for unified games - extracted games should match this format
4. Games will depend on the published `boardsmith` npm package (or `file:` link during development)

**Primary recommendation:** Normalize all games to the unified structure (src/rules, src/ui) matching what `boardsmith init` produces, rewrite imports to use `boardsmith` package subpaths, and create minimal standalone package.json files using npm (not pnpm).

## Current Game Inventory

### Games to Extract (GAME-01 through GAME-06)

| Game | Current Structure | Has AI | Has Tests | Complexity |
|------|-------------------|--------|-----------|------------|
| hex | split (rules/, ui/, tests/) | Yes (ai.ts) | Yes | Simple |
| go-fish | split (rules/, ui/, tests/) | Yes (ai.ts) | Yes + E2E | Medium |
| checkers | split (rules/, ui/, tests/) | Yes (ai.ts) | Yes | Medium |
| cribbage | split (rules/, ui/, tests/) | Yes (ai.ts) | Yes | Complex |
| floss-bitties | unified (src/) | No | No | Unknown (not working) |
| polyhedral-potions | split (rules/, ui/, tests/) | Yes (ai.ts) | Yes | Medium |

### Demos to Extract (GAME-07 through GAME-09)

| Demo | Current Structure | Has Tests | Purpose |
|------|-------------------|-----------|---------|
| demoActionPanel | split (rules/, ui/) | No | Action Panel example |
| demoAnimation | unified (src/) | Yes (broken) | Animation showcase |
| demoComplexUiInteractions | unified (src/) | No | Complex UI example |

## Standard Stack

### Core Dependencies (for extracted games)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| boardsmith | ^0.0.1 | Core engine, UI, testing | The framework being depended upon |
| vue | ^3.4.0 | UI framework | Required by boardsmith/ui |

### Dev Dependencies

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| typescript | ^5.7.0 | Type checking | All games |
| vite | ^6.0.0+ | Build tool | All games with UI |
| vitest | ^2.0.0 | Testing | Games with tests |
| @vitejs/plugin-vue | ^5.0.0 | Vue support | All games with UI |

### CLI Dependencies

Games should NOT include `@boardsmith/cli` as a dependency. Instead, users install it globally or use npx:
```bash
npx boardsmith dev
npx boardsmith build
```

## Architecture Patterns

### Target Directory Structure (Unified)

All extracted games should use the unified structure matching `boardsmith init`:

```
game-name/
├── boardsmith.json          # Game configuration
├── package.json             # npm dependencies (NOT pnpm)
├── package-lock.json        # Lock file
├── tsconfig.json            # TypeScript config
├── vite.config.ts           # Vite bundler config
├── index.html               # Entry HTML
├── src/
│   ├── main.ts              # App entry point
│   ├── rules/               # Game logic
│   │   ├── game.ts          # Main Game class
│   │   ├── elements.ts      # Custom element classes
│   │   ├── actions.ts       # Player action definitions
│   │   ├── flow.ts          # Game flow definition
│   │   ├── ai.ts            # AI evaluation (if present)
│   │   └── index.ts         # Exports
│   └── ui/                  # Vue UI components
│       ├── App.vue          # Main app component
│       ├── components/      # Custom components
│       └── index.ts         # UI exports
├── tests/                   # Test files
│   └── game.test.ts
└── .gitignore
```

### Import Pattern Transformation

**Current (monorepo with @boardsmith/* packages):**
```typescript
import { Game, Player } from '@boardsmith/engine';
import { GameShell, AutoUI } from '@boardsmith/ui';
import { createTestGame } from '@boardsmith/testing';
import type { Objective } from '@boardsmith/ai';
```

**Target (standalone with boardsmith package):**
```typescript
import { Game, Player } from 'boardsmith';
import { GameShell, AutoUI } from 'boardsmith/ui';
import { createTestGame } from 'boardsmith/testing';
import type { Objective } from 'boardsmith/ai';
```

### Package.json Template

```json
{
  "name": "game-name",
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "npx boardsmith dev",
    "build": "npx boardsmith build",
    "test": "vitest",
    "validate": "npx boardsmith validate"
  },
  "dependencies": {
    "boardsmith": "^0.0.1",
    "vue": "^3.4.0"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "^5.0.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0",
    "vitest": "^2.0.0"
  }
}
```

Note: Uses `npx boardsmith` instead of `boardsmith` directly, as CLI is not a dependency.

### boardsmith.json Template (Modern)

```json
{
  "$schema": "https://boardsmith.io/schemas/game.json",
  "name": "game-name",
  "displayName": "Game Display Name",
  "description": "Game description",
  "playerCount": { "min": 2, "max": 4, "default": 2 },
  "estimatedDuration": "15-30 minutes",
  "complexity": 2,
  "categories": ["strategy"],
  "scoreboard": { "stats": ["score"] }
}
```

Old format (split games like hex) uses different keys that need updating:
```json
// OLD (hex/boardsmith.json)
{
  "name": "hex",
  "minPlayers": 2,
  "maxPlayers": 2,
  "rulesPackage": "@boardsmith/hex-rules",
  "paths": { "rules": "./rules/src", "ui": "./ui" }
}

// NEW (should be)
{
  "$schema": "https://boardsmith.io/schemas/game.json",
  "name": "hex",
  "displayName": "Hex",
  "playerCount": { "min": 2, "max": 2 }
  // No paths needed for unified structure
}
```

## Don't Hand-Roll

Problems with existing solutions that should be reused:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Standalone game scaffolding | Custom templates | `boardsmith init` output as reference | CLI already produces correct structure |
| Import rewriting | Manual find/replace | Systematic pattern: `@boardsmith/X` -> `boardsmith/X` or `boardsmith` | Consistent, automatable |
| Git repo initialization | Complex scripts | `git init && git add . && git commit` | Simple and sufficient |

## Common Pitfalls

### Pitfall 1: Inconsistent Import Paths

**What goes wrong:** Mixing `@boardsmith/*` and `boardsmith/*` imports, or forgetting to update relative imports within rules/ and ui/ folders.

**Why it happens:** Games have many import statements across multiple files, easy to miss some.

**How to avoid:**
1. Grep for all `@boardsmith/` and `from '@boardsmith` patterns
2. Apply systematic transformation
3. Verify with TypeScript compilation

**Warning signs:** TypeScript compilation errors about unresolved modules.

### Pitfall 2: Split Structure Artifacts

**What goes wrong:** Leaving behind split structure artifacts (rules/package.json, ui/package.json, separate tsconfig files) when converting to unified structure.

**Why it happens:** Split games have nested package.json files that served the workspace setup.

**How to avoid:**
1. Delete all nested package.json files
2. Delete nested tsconfig.json files
3. Use single root package.json and tsconfig.json

**Warning signs:** Multiple package-lock.json files, nested node_modules directories.

### Pitfall 3: Internal Cross-References

**What goes wrong:** Split games have imports like `from '@boardsmith/hex-rules'` in tests that must become relative or local.

**Why it happens:** The tests import from the workspace package name.

**How to avoid:** Convert game-internal imports to relative paths:
```typescript
// OLD: import { HexGame } from '@boardsmith/hex-rules';
// NEW: import { HexGame } from '../src/rules/index.js';
```

**Warning signs:** Tests failing to import game classes.

### Pitfall 4: Dev vs Production Dependencies

**What goes wrong:** Including boardsmith as a devDependency instead of dependency.

**Why it happens:** Some games only "need" it at build time for bundling.

**How to avoid:** boardsmith is a runtime dependency (it provides the UI shell, game runner, etc.). Always use `dependencies`, not `devDependencies`.

### Pitfall 5: CLI as Dependency

**What goes wrong:** Including `@boardsmith/cli` or `boardsmith-cli` as a dependency.

**Why it happens:** Current demo package.jsons have CLI as devDependency.

**How to avoid:** Use `npx boardsmith` in scripts. CLI is a global tool, not a project dependency.

## Code Examples

### Import Transformation Script Pattern

```typescript
// Pattern for rewriting imports
const transformImport = (importPath: string): string => {
  // @boardsmith/engine -> boardsmith
  if (importPath === '@boardsmith/engine') {
    return 'boardsmith';
  }
  // @boardsmith/X -> boardsmith/X
  if (importPath.startsWith('@boardsmith/')) {
    const subpath = importPath.replace('@boardsmith/', '');
    return `boardsmith/${subpath}`;
  }
  return importPath;
};
```

### Test Import Pattern

```typescript
// tests/game.test.ts
import { describe, it, expect } from 'vitest';
import { createTestGame } from 'boardsmith/testing';
import { Player } from 'boardsmith';
import { HexGame } from '../src/rules/index.js';
```

### Main Entry Point

```typescript
// src/main.ts
import { createApp } from 'vue';
import { App } from './ui/index.js';

const app = createApp(App);
app.mount('#app');
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| @boardsmith/* scoped packages | boardsmith with subpath exports | Phase 42-43 | Games import from single package |
| pnpm workspaces | npm single package | Phase 39 | Extracted games use npm |
| Split rules/ui structure | Unified src/ structure | CLI update | Simpler project layout |

## File Migration Map

For each game type, here's what needs to happen:

### Split Game (e.g., hex) -> Unified

```
hex/
├── rules/src/*.ts          -> src/rules/*.ts
├── rules/package.json      -> DELETE
├── rules/tsconfig.json     -> DELETE
├── ui/src/*.vue            -> src/ui/*.vue + src/ui/components/*.vue
├── ui/src/main.ts          -> src/main.ts
├── ui/index.html           -> index.html
├── ui/package.json         -> DELETE
├── ui/tsconfig.json        -> DELETE
├── ui/vite.config.ts       -> vite.config.ts
├── tests/*.test.ts         -> tests/*.test.ts
├── tests/package.json      -> DELETE
├── tests/vitest.config.ts  -> vitest.config.ts (merge into root)
├── boardsmith.json         -> boardsmith.json (update format)
└── (new) package.json      -> CREATE from template
```

### Unified Game (e.g., demoAnimation) -> Standalone

Already has correct structure, just needs:
```
demoAnimation/
├── package.json            -> UPDATE dependencies, scripts
├── src/rules/*.ts          -> Rewrite @boardsmith/* imports
├── src/ui/*.vue            -> Rewrite @boardsmith/* imports
├── tests/*.test.ts         -> Rewrite @boardsmith/* imports
└── boardsmith.json         -> Already correct format
```

## Vitest Configuration

Root vitest.config.ts currently includes game tests with aliases:

```typescript
// Current vitest.config.ts includes:
'@boardsmith/checkers-rules': resolve(__dirname, 'packages/games/checkers/rules/src/index.ts'),
'@boardsmith/cribbage-rules': resolve(__dirname, 'packages/games/cribbage/rules/src/index.ts'),
'@boardsmith/go-fish-rules': resolve(__dirname, 'packages/games/go-fish/rules/src/index.ts'),
```

After extraction:
1. These aliases should be removed from the root vitest.config.ts
2. Each extracted game has its own vitest.config.ts
3. Game tests no longer run from the BoardSmith root

## Open Questions

1. **Git history preservation**
   - What we know: Files can be copied or moved, git history is lost either way for extracted repos
   - What's unclear: Whether to use `git filter-branch` or `git subtree` to preserve history
   - Recommendation: Start fresh with clean git repos for simplicity; games are examples, not production code with critical history

2. **Initial npm publish location**
   - What we know: Games will depend on `boardsmith` package
   - What's unclear: Whether boardsmith is published to npm yet or still uses file: links
   - Recommendation: Use `file:` links initially for testing, switch to npm version for final validation

3. **CLI availability for extracted games**
   - What we know: Games use `boardsmith dev` and `boardsmith build` commands
   - What's unclear: How CLI resolves game project when not in monorepo
   - Recommendation: Test with `npx boardsmith dev` in extracted game directory

## Sources

### Primary (HIGH confidence)
- Direct codebase analysis of packages/games/* structure
- CLI project-scaffold.js (packages/cli/dist/lib/project-scaffold.js) for template patterns
- Phase 43 verification report for import status
- Root package.json for current exports configuration

### Secondary (MEDIUM confidence)
- docs/getting-started.md for intended project structure
- vitest.config.ts for current test setup and aliases

## Metadata

**Confidence breakdown:**
- Game structure analysis: HIGH - direct code inspection
- Import patterns: HIGH - verified against Phase 43 work
- Target structure: HIGH - matches CLI scaffold output
- CLI behavior: MEDIUM - not tested outside monorepo yet

**Research date:** 2026-01-18
**Valid until:** Until Phase 44 is complete (structure is stable, no external dependencies to track)
