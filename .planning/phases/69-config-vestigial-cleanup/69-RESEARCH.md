# Phase 69: Config & Vestigial Cleanup - Research

**Researched:** 2026-02-01
**Domain:** Build configuration cleanup, dead code removal
**Confidence:** HIGH

## Summary

This phase addresses stale configuration paths and a vestigial re-export file. The codebase previously used a `packages/` directory structure that has been refactored to `src/`. Three files contain references to the old structure:

1. **vitest.config.ts** - References `packages/games/**/tests/**/*.test.ts` which no longer exists
2. **eslint.config.mjs** - Uses `packages/**/*.ts` pattern, causing ESLint to not lint any files
3. **src/ai/utils.ts** - Single re-export file that should be removed

All changes are straightforward file edits with clear validation paths. Current tests (504 passing) provide confidence that changes won't break functionality.

**Primary recommendation:** Remove stale paths from config files and update the single consumer of `src/ai/utils.ts` to import from the canonical location.

## Standard Stack

No new libraries required. This phase modifies existing configuration files.

### Tools Involved
| Tool | Version | Purpose | Notes |
|------|---------|---------|-------|
| vitest | ^2.1.0 | Test runner | Config needs path cleanup |
| eslint | ^9.39.2 | Linter | Config needs path fix to enable linting |

## Architecture Patterns

### Current State Analysis

**vitest.config.ts issues:**
```typescript
// Line 10: Path no longer exists
'packages/games/**/tests/**/*.test.ts', // Game tests (until Phase 44)

// Lines 24-37: Aliases for non-existent packages
'@boardsmith/checkers-rules': resolve(__dirname, 'packages/games/checkers/rules/src/index.ts'),
'@boardsmith/cribbage-rules': resolve(__dirname, 'packages/games/cribbage/rules/src/index.ts'),
'@boardsmith/go-fish-rules': resolve(__dirname, 'packages/games/go-fish/rules/src/index.ts'),

// Line 11: Path no longer exists
'cli/tests/**/*.test.ts', // CLI tests
```

**eslint.config.mjs issues:**
```javascript
// Line 17: Wrong path - packages/ doesn't exist, should be src/
files: ['packages/**/*.ts'],
```

**package.json issue (discovered during research):**
```json
// Line 70: References non-existent packages/ directory
"lint": "eslint packages/"
```

**src/ai/utils.ts:**
```typescript
// Entire file - just re-exports from canonical location
export { createSeededRandom, SeededRandom } from '../utils/random.js';
```

**Consumer of src/ai/utils.ts:**
```typescript
// src/ai/mcts-bot.ts line 14
import { SeededRandom } from './utils.js';
```

### Target State

**vitest.config.ts:** Remove stale paths, keep only valid includes
```typescript
include: [
  'src/**/*.test.ts', // Colocated library tests
],
```

**eslint.config.mjs:** Fix file pattern
```javascript
files: ['src/**/*.ts'],
```

**package.json:** Fix lint script
```json
"lint": "eslint src/"
```

**src/ai/mcts-bot.ts:** Update import
```typescript
import { SeededRandom } from '../utils/random.js';
```

**src/ai/utils.ts:** Delete file

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| N/A | N/A | N/A | This phase is config cleanup, no custom solutions needed |

## Common Pitfalls

### Pitfall 1: Breaking Test Discovery
**What goes wrong:** Removing include paths that are still needed causes tests to not run
**Why it happens:** Confusion about which paths are active
**How to avoid:** Run `npm test` before and after changes, compare test counts (should remain 504)
**Warning signs:** Test count drops after config change

### Pitfall 2: Missing Import Update Before File Deletion
**What goes wrong:** Deleting `src/ai/utils.ts` before updating its consumer breaks the build
**Why it happens:** Deletion seems simpler, but leaves dangling imports
**How to avoid:** Always update consumer imports BEFORE deleting the re-export file
**Warning signs:** TypeScript errors on import after deletion

### Pitfall 3: Forgetting package.json lint script
**What goes wrong:** `npm run lint` fails or lints nothing
**Why it happens:** The `lint` script in package.json also references `packages/`
**How to avoid:** Update both eslint.config.mjs AND package.json lint script
**Warning signs:** `npm run lint` shows no files or errors

### Pitfall 4: ESLint file pattern not matching
**What goes wrong:** After fixing the pattern, files still aren't linted
**Why it happens:** ESLint flat config requires careful pattern syntax
**How to avoid:** Test with `npx eslint src/ai/mcts-bot.ts` - should not show "no matching configuration"
**Warning signs:** "File ignored because no matching configuration was supplied" warning

## Code Examples

### Verified: Current vitest.config.ts structure
```typescript
// Source: /Users/jtsmith/BoardSmith/vitest.config.ts
include: [
  'src/**/*.test.ts', // Colocated library tests (KEEP)
  'packages/games/**/tests/**/*.test.ts', // Game tests (REMOVE - path doesn't exist)
  'cli/tests/**/*.test.ts', // CLI tests (REMOVE - path doesn't exist)
],
```

### Verified: Current eslint.config.mjs structure
```javascript
// Source: /Users/jtsmith/BoardSmith/eslint.config.mjs
{
  files: ['packages/**/*.ts'], // CHANGE TO: ['src/**/*.ts']
  // ... rest of config
}
```

### Verified: Consumer to update
```typescript
// Source: /Users/jtsmith/BoardSmith/src/ai/mcts-bot.ts line 14
// CURRENT:
import { SeededRandom } from './utils.js';

// CHANGE TO:
import { SeededRandom } from '../utils/random.js';
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| packages/games/ structure | src/ monolith | Phase 44 (game extraction) | Config paths became stale |
| cli/ at root level | src/cli/ | Prior refactor | vitest path became stale |
| src/ai/utils.ts re-export | Direct import from utils/random.js | Now (v2.7) | Cleaner imports |

## Open Questions

No open questions. All required changes are well-defined:

1. **vitest.config.ts:** Remove 2 stale include paths + 3 stale resolve aliases
2. **eslint.config.mjs:** Change `packages/**/*.ts` to `src/**/*.ts`
3. **package.json:** Change `eslint packages/` to `eslint src/`
4. **src/ai/mcts-bot.ts:** Update import path
5. **src/ai/utils.ts:** Delete file

## Sources

### Primary (HIGH confidence)
- `/Users/jtsmith/BoardSmith/vitest.config.ts` - Direct file read
- `/Users/jtsmith/BoardSmith/eslint.config.mjs` - Direct file read
- `/Users/jtsmith/BoardSmith/src/ai/utils.ts` - Direct file read
- `/Users/jtsmith/BoardSmith/src/ai/mcts-bot.ts` - Direct file read
- `/Users/jtsmith/BoardSmith/package.json` - Direct file read

### Verification (HIGH confidence)
- `npx eslint src/ai/mcts-bot.ts` - Confirmed ESLint not matching files
- `npm test` - Confirmed 504 tests passing
- `glob packages/**/*` - Confirmed no files exist

## Metadata

**Confidence breakdown:**
- Config changes: HIGH - Direct file inspection, clear paths to validate
- File deletion: HIGH - Single consumer identified, no other imports found
- Test impact: HIGH - Full test suite run confirms current state

**Research date:** 2026-02-01
**Valid until:** N/A (this is cleanup work, not evolving APIs)
