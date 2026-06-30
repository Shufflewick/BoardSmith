# Phase 43: Import Rewrite - Research

**Researched:** 2026-01-18
**Domain:** TypeScript imports, relative path resolution, codemod patterns
**Confidence:** HIGH

## Summary

Phase 43 replaces all `@boardsmith/*` imports within the `src/` directory with relative paths. After Phase 42 (Subpath Exports), the codebase has package.json exports configured, but internal cross-module imports still use the old workspace package syntax. This phase makes internal imports use relative paths while preserving external-facing documentation examples.

The codebase has 150 total occurrences of `@boardsmith/` across 72 files in `src/`. These break down into:
- **Actual imports to rewrite**: ~55 files with real import statements
- **JSDoc/comment examples**: ~20 occurrences showing external usage (keep as-is)
- **CLI template strings**: Code that generates imports for external projects (keep as-is)

The key insight is that NOT all `@boardsmith/*` references should be rewritten. Documentation examples in JSDoc comments and CLI scaffolding templates should continue using the package import syntax since those represent how external consumers will use the library.

**Primary recommendation:** Use find-and-replace with careful categorization. Rewrite actual imports to relative paths, preserve documentation examples, and remove vitest aliases since relative imports will resolve correctly.

## Standard Stack

### Core Tools

| Tool | Purpose | Why Standard |
|------|---------|--------------|
| TypeScript path resolution | Validate rewrites compile | Already configured in tsconfig |
| Vitest | Test that rewrites work | Already in devDependencies |
| find/sed or jscodeshift | Bulk rewriting | Standard codemod approaches |

### No Additional Dependencies Required

This is a purely mechanical transformation. No new libraries needed.

**File extension note:** The codebase uses `.js` extensions in import specifiers (e.g., `./runner.js` even for `.ts` files). This is correct for ESM with TypeScript's `moduleResolution: bundler`. All rewritten imports must maintain this pattern.

## Architecture Patterns

### Source Directory Layout

```
src/
├── engine/          # Core game logic (foundation - no deps on other src/)
├── runtime/         # Game runner (depends on engine)
├── ai/              # MCTS bot (depends on engine)
├── ai-trainer/      # Training infrastructure (depends on engine, runtime, ai)
├── testing/         # Test utilities (depends on engine, runtime)
├── session/         # Game session (depends on engine, runtime, ai)
├── server/          # Server runtime (depends on session)
├── client/          # Client runtime (standalone)
├── ui/              # Vue components (depends on session, client)
├── worker/          # Cloudflare worker (depends on session, server, engine)
├── eslint-plugin/   # ESLint rules (standalone)
└── cli/             # CLI commands (depends on many, but generates external code)
```

### Import Categories

**Category 1: Real imports to rewrite (55+ files)**
```typescript
// BEFORE (in src/runtime/index.ts)
import { serializeValue } from '@boardsmith/engine';

// AFTER
import { serializeValue } from '../engine/index.js';
```

**Category 2: JSDoc examples to preserve (20+ occurrences)**
```typescript
// KEEP AS-IS - this shows external usage
/**
 * @example
 * import { useAutoFLIP } from '@boardsmith/ui';
 */
```

**Category 3: CLI template strings to preserve (5+ occurrences)**
```typescript
// KEEP AS-IS - this generates code for external projects
return `import { Game, Player } from '@boardsmith/engine';
```

**Category 4: Test imports for external game packages (3 files)**
```typescript
// KEEP AS-IS - these reference game packages still in packages/
import { CheckersGame } from '@boardsmith/checkers-rules';
```

### Dependency Matrix for Cross-Module Imports

| From Module | Imports From | Relative Path |
|-------------|--------------|---------------|
| runtime | engine | `../engine/index.js` |
| ai | engine | `../engine/index.js` |
| ai-trainer | engine | `../engine/index.js` |
| ai-trainer | runtime | `../runtime/index.js` |
| ai-trainer | ai | `../ai/index.js` |
| testing | engine | `../engine/index.js` |
| testing | runtime | `../runtime/index.js` |
| session | engine | `../engine/index.js` |
| session | runtime | `../runtime/index.js` |
| session | ai | `../ai/index.js` |
| server | session | `../session/index.js` |
| ui | session | `../session/index.js` |
| ui | client | `../client/index.js` |
| ui | client/vue | `../client/vue.js` |
| worker | session | `../session/index.js` |
| worker | server | `../server/index.js` |
| worker | engine | `../engine/index.js` |
| cli | server | `../server/index.js` |

### Vitest Config Update

After rewriting imports, the vitest.config.ts aliases become unnecessary for internal modules:

```typescript
// BEFORE - vitest.config.ts
resolve: {
  alias: {
    '@boardsmith/engine': resolve(__dirname, 'src/engine/index.ts'),
    '@boardsmith/runtime': resolve(__dirname, 'src/runtime/index.ts'),
    // ... etc
  }
}

// AFTER - only keep aliases for external game packages
resolve: {
  alias: {
    // Only game rules packages (still in packages/)
    '@boardsmith/checkers-rules': resolve(__dirname, 'packages/games/checkers/rules/src/index.ts'),
    '@boardsmith/cribbage-rules': resolve(__dirname, 'packages/games/cribbage/rules/src/index.ts'),
    '@boardsmith/go-fish-rules': resolve(__dirname, 'packages/games/go-fish/rules/src/index.ts'),
  }
}
```

### Anti-Patterns to Avoid

- **Rewriting documentation examples:** JSDoc `@example` blocks should keep `@boardsmith/*` syntax
- **Rewriting CLI scaffold templates:** Template strings that generate external code stay as-is
- **Missing `.js` extension:** All imports must end in `.js` for ESM compatibility
- **Deep imports without index:** Don't create paths like `../engine/utils/snapshot.js` - use the public API from index files
- **Forgetting type imports:** `import type { X }` must also be rewritten

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Bulk find-replace | Manual editing | grep + sed or IDE refactor | 150 occurrences need consistency |
| Path calculation | Manual path counting | Predetermined mapping table | `../` depth varies by source location |
| Validation | Manual review | `npx tsc --noEmit` | TypeScript catches all import errors |

**Key insight:** This is mechanical transformation. The dependency graph is fixed and small (11 modules). A lookup table of rewrites is simpler and safer than dynamic path calculation.

## Common Pitfalls

### Pitfall 1: Rewriting Documentation Examples
**What goes wrong:** External users see `../engine/` imports in docs that don't work for them
**Why it happens:** Treating all `@boardsmith/*` strings as imports
**How to avoid:** Categorize occurrences first; only rewrite actual import statements
**Warning signs:** JSDoc examples show relative paths

### Pitfall 2: Missing .js Extension
**What goes wrong:** Runtime module resolution fails
**Why it happens:** TypeScript allows extensionless imports during compilation
**How to avoid:** All relative imports must end in `.js`
**Warning signs:** `ERR_MODULE_NOT_FOUND` at runtime

### Pitfall 3: Incorrect Relative Path Depth
**What goes wrong:** `Cannot find module '../engine/index.js'`
**Why it happens:** Files at different depths need different `../` counts
**How to avoid:** Use predetermined path mapping, not dynamic calculation
**Warning signs:** TypeScript compile errors after rewrite

### Pitfall 4: Circular Import Introduction
**What goes wrong:** Runtime errors or incomplete exports
**Why it happens:** Relative paths may expose circular dependencies hidden by package boundaries
**How to avoid:** The existing dependency graph is already acyclic; maintain it
**Warning signs:** `undefined` exports, runtime initialization errors

### Pitfall 5: Breaking Test File Imports
**What goes wrong:** Tests reference game packages that aren't being rewritten
**Why it happens:** `@boardsmith/checkers-rules` etc. are external packages
**How to avoid:** Keep vitest aliases for game packages; only rewrite library imports
**Warning signs:** Test failures for game-specific imports

### Pitfall 6: Forgetting Re-export Chains
**What goes wrong:** Module A re-exports from B, B imports from C - partial rewrite
**Why it happens:** Not following re-export chains
**How to avoid:** Rewrite all import statements, including re-exports
**Warning signs:** TypeScript shows some resolved, some not

## Code Examples

### Pattern 1: Simple Type Import Rewrite

```typescript
// BEFORE (src/session/types.ts)
import type { FlowState, SerializedAction, Game } from '@boardsmith/engine';

// AFTER
import type { FlowState, SerializedAction, Game } from '../engine/index.js';
```

### Pattern 2: Mixed Type and Value Import

```typescript
// BEFORE (src/session/game-session.ts)
import type { FlowState, Game } from '@boardsmith/engine';
import { captureDevState, restoreDevState } from '@boardsmith/engine';
import { GameRunner } from '@boardsmith/runtime';

// AFTER
import type { FlowState, Game } from '../engine/index.js';
import { captureDevState, restoreDevState } from '../engine/index.js';
import { GameRunner } from '../runtime/index.js';
```

### Pattern 3: Re-export Statement

```typescript
// BEFORE (src/runtime/index.ts)
export {
  serializeValue,
  deserializeValue,
} from '@boardsmith/engine';

// AFTER
export {
  serializeValue,
  deserializeValue,
} from '../engine/index.js';
```

### Pattern 4: UI importing from Session (re-export colors)

```typescript
// BEFORE (src/ui/index.ts)
export {
  STANDARD_PLAYER_COLORS,
  DEFAULT_PLAYER_COLORS,
  type ColorChoice,
} from '@boardsmith/session';

// AFTER
export {
  STANDARD_PLAYER_COLORS,
  DEFAULT_PLAYER_COLORS,
  type ColorChoice,
} from '../session/index.js';
```

### Pattern 5: Subpath Import (ui imports client/vue)

```typescript
// BEFORE (src/ui/components/GameShell.vue)
import { MeepleClient, GameConnection } from '@boardsmith/client';
import { useGame } from '@boardsmith/client/vue';

// AFTER
import { MeepleClient, GameConnection } from '../../client/index.js';
import { useGame } from '../../client/vue.js';
```

### Pattern 6: Preserve JSDoc Example (DO NOT REWRITE)

```typescript
// KEEP AS-IS - external usage example
/**
 * @example
 * ```typescript
 * import { useAutoFLIP } from '@boardsmith/ui';
 * const { containerRef } = useAutoFLIP();
 * ```
 */
export function useAutoFLIP() { ... }
```

### Pattern 7: Preserve CLI Template (DO NOT REWRITE)

```typescript
// KEEP AS-IS - generates code for external projects
function getGameTemplate(): string {
  return `import { Game, Player, type GameOptions } from '@boardsmith/engine';
// ... rest of template
`;
}
```

## Rewrite Mapping Table

Complete mapping of package imports to relative paths by source module:

| Source Directory | @boardsmith/engine | @boardsmith/runtime | @boardsmith/ai | @boardsmith/session | @boardsmith/server | @boardsmith/client |
|------------------|-------------------|--------------------|--------------------|--------------------|--------------------|-------------------|
| src/runtime/ | `../engine/index.js` | N/A | - | - | - | - |
| src/ai/ | `../engine/index.js` | - | N/A | - | - | - |
| src/ai-trainer/ | `../engine/index.js` | `../runtime/index.js` | `../ai/index.js` | - | - | - |
| src/testing/ | `../engine/index.js` | `../runtime/index.js` | - | - | - | - |
| src/session/ | `../engine/index.js` | `../runtime/index.js` | `../ai/index.js` | N/A | - | - |
| src/server/ | - | - | - | `../session/index.js` | N/A | - |
| src/ui/ | - | - | - | `../session/index.js` | - | `../client/index.js` |
| src/worker/ | `../engine/index.js` | - | - | `../session/index.js` | `../server/index.js` | - |
| src/cli/ | - | - | - | - | `../server/index.js` | - |

Note: For files in subdirectories (e.g., `src/ui/components/GameShell.vue`), add additional `../` prefixes.

## Verification Strategy

### Step 1: TypeScript Compilation
```bash
npx tsc --noEmit
# Must complete with 0 errors
```

### Step 2: Test Suite
```bash
npm test
# All tests must pass
```

### Step 3: Grep Verification
```bash
# Should only find game packages and documentation/templates
grep -r "@boardsmith/" src/ | grep -v "\.test\." | grep -v "// " | grep -v " \* "
```

### Step 4: Vitest Aliases Check
```bash
# Verify internal aliases removed, only game packages remain
cat vitest.config.ts
# Should show only @boardsmith/checkers-rules, cribbage-rules, go-fish-rules
```

## Files to Modify

### Import Rewrites (~55 files)

**src/runtime/** (3 imports to rewrite)
- `src/runtime/index.ts` - re-exports from engine
- `src/runtime/runner.ts` - imports from engine

**src/ai/** (3 files)
- `src/ai/index.ts` - imports from engine
- `src/ai/mcts-bot.ts` - imports from engine
- `src/ai/types.ts` - imports from engine

**src/ai-trainer/** (12 files)
- `src/ai-trainer/benchmark.ts` - engine, runtime, ai
- `src/ai-trainer/benchmark-worker.ts` - engine
- `src/ai-trainer/feature-templates.ts` - engine
- `src/ai-trainer/introspector.ts` - engine
- `src/ai-trainer/parallel-simulator.ts` - engine
- `src/ai-trainer/parallel-trainer.ts` - engine
- `src/ai-trainer/simulation-worker.ts` - engine
- `src/ai-trainer/simulator.ts` - engine, runtime, ai
- `src/ai-trainer/types.ts` - engine
- `src/ai-trainer/weight-evolver.ts` - engine

**src/testing/** (6 files)
- `src/testing/assertions.ts` - engine
- `src/testing/debug.ts` - engine
- `src/testing/fixtures.ts` - engine
- `src/testing/random-simulation.ts` - engine
- `src/testing/simulate-action.ts` - engine, runtime
- `src/testing/test-game.ts` - engine, runtime

**src/session/** (10 files)
- `src/session/ai-controller.ts` - engine, runtime, ai
- `src/session/checkpoint-manager.ts` - engine
- `src/session/debug-controller.ts` - engine, runtime
- `src/session/game-session.ts` - engine, runtime, ai
- `src/session/pending-action-manager.ts` - engine, runtime
- `src/session/selection-handler.ts` - engine, runtime
- `src/session/state-history.ts` - engine, runtime
- `src/session/types.ts` - engine, ai
- `src/session/utils.ts` - engine, runtime

**src/server/** (5 files)
- `src/server/core.ts` - session
- `src/server/handlers/games.ts` - session
- `src/server/stores/in-memory-games.ts` - session
- `src/server/stores/sqlite-games.ts` - session
- `src/server/stores/sqlite-storage.ts` - session
- `src/server/types.ts` - session

**src/ui/** (2 files)
- `src/ui/index.ts` - session
- `src/ui/components/GameShell.vue` - client, client/vue

**src/worker/** (1 file)
- `src/worker/index.ts` - session, engine, server

**src/cli/** (1 file)
- `src/cli/local-server.ts` - server

### Files to Preserve (DO NOT REWRITE)

- `src/cli/commands/init.ts` - Template strings for external projects
- `src/cli/lib/project-scaffold.ts` - Template strings for external projects
- `src/cli/slash-command/generate-ai-instructions.md` - Documentation
- `src/ai-trainer/code-generator.ts` - Generates external import statements
- All JSDoc `@example` blocks throughout codebase

### Config File Updates

- `vitest.config.ts` - Remove internal aliases, keep game package aliases

## Open Questions

1. **Should CLI dev.ts aliases be updated?**
   - `src/cli/commands/dev.ts` has esbuild/vite plugins resolving `@boardsmith/*`
   - These are for external game projects during `boardsmith dev`
   - Likely should KEEP as-is since they serve external consumers
   - Decision: Keep CLI alias plugins, they serve development workflow

2. **Should package.json references be updated?**
   - Currently has no internal `@boardsmith/*` dependencies
   - No action needed

## Sources

### Primary (HIGH confidence)
- Codebase analysis via grep - exact counts and locations verified
- `tsconfig.json` - moduleResolution: bundler confirmed
- `vitest.config.ts` - current alias configuration
- `package.json` - exports field already configured

### Codebase (HIGH confidence)
- 150 total `@boardsmith/` occurrences across 72 files in src/
- Dependency graph extracted from actual import statements
- File extension pattern (`.js`) verified from existing code

## Metadata

**Confidence breakdown:**
- Import categorization: HIGH - grep analysis of actual files
- Relative path mapping: HIGH - directory structure is fixed
- Files to preserve: HIGH - pattern matching on JSDoc/templates
- Vitest config update: HIGH - follows from import changes

**Research date:** 2026-01-18
**Valid until:** Phase completion (stable - mechanical transformation)
