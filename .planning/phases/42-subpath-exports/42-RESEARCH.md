# Phase 42: Subpath Exports - Research

**Researched:** 2026-01-18
**Domain:** Node.js package.json exports field, TypeScript types, ESM module resolution
**Confidence:** HIGH

## Summary

This phase configures 11 subpath exports in package.json to enable imports like `boardsmith`, `boardsmith/ui`, `boardsmith/session`, etc. The codebase is ESM-only with `"type": "module"` and uses TypeScript with `moduleResolution: bundler`.

The key challenge is that this library currently points exports to pre-built `packages/engine/dist/` files, but after source collapse (Phase 40), source files now live in `src/*/`. The exports need to point to either:
1. **Source files** (for development/bundler workflows) - simpler, consumers compile
2. **Built dist files** (for production) - requires build step before publish

Given the current state (no root `dist/` directory, existing `packages/engine/dist/`), and that this is an internal library for game development (not npm publishing yet), the pragmatic approach is to point exports to source files in `src/*/index.ts`. This works with bundlers (Vite, webpack, esbuild) and TypeScript with `moduleResolution: bundler`.

**Primary recommendation:** Configure exports to point directly to `src/*/index.ts` files with both `types` and `import` conditions. This enables immediate development workflow while deferring build/publish concerns to later phases.

## Standard Stack

### Core Configuration

| Field | Value | Purpose | Why Standard |
|-------|-------|---------|--------------|
| `type` | `"module"` | ESM package | Already set; required for ESM imports |
| `exports` | Object with subpaths | Define entry points | Node.js 12+ standard for package encapsulation |
| `moduleResolution` | `bundler` | TypeScript config | Already set in tsconfig.json; supports exports |

### Condition Order (Critical)

For each export subpath, conditions must appear in this order:
1. `types` - TypeScript type definitions (MUST be first)
2. `import` - ESM entry point
3. `default` - Fallback (optional if only ESM)

Source: [Node.js Packages Documentation](https://nodejs.org/api/packages.html), [Hiroki Osame Guide](https://hirok.io/posts/package-json-exports)

### No Additional Dependencies

No new dependencies required. The exports field is a native Node.js/npm feature.

## Architecture Patterns

### Recommended Exports Structure

```json
{
  "name": "boardsmith",
  "type": "module",
  "exports": {
    ".": {
      "types": "./src/engine/index.ts",
      "import": "./src/engine/index.ts"
    },
    "./ui": {
      "types": "./src/ui/index.ts",
      "import": "./src/ui/index.ts"
    },
    "./session": {
      "types": "./src/session/index.ts",
      "import": "./src/session/index.ts"
    },
    "./testing": {
      "types": "./src/testing/index.ts",
      "import": "./src/testing/index.ts"
    },
    "./eslint-plugin": {
      "types": "./src/eslint-plugin/index.ts",
      "import": "./src/eslint-plugin/index.ts"
    },
    "./ai": {
      "types": "./src/ai/index.ts",
      "import": "./src/ai/index.ts"
    },
    "./ai-trainer": {
      "types": "./src/ai-trainer/index.ts",
      "import": "./src/ai-trainer/index.ts"
    },
    "./client": {
      "types": "./src/client/index.ts",
      "import": "./src/client/index.ts"
    },
    "./server": {
      "types": "./src/server/index.ts",
      "import": "./src/server/index.ts"
    },
    "./runtime": {
      "types": "./src/runtime/index.ts",
      "import": "./src/runtime/index.ts"
    },
    "./worker": {
      "types": "./src/worker/index.ts",
      "import": "./src/worker/index.ts"
    }
  }
}
```

### All 11 Subpath Exports

| Subpath | Source | PKG Requirement |
|---------|--------|-----------------|
| `boardsmith` (.) | `src/engine/index.ts` | PKG-02 |
| `boardsmith/ui` | `src/ui/index.ts` | PKG-03 |
| `boardsmith/session` | `src/session/index.ts` | PKG-04 |
| `boardsmith/testing` | `src/testing/index.ts` | PKG-05 |
| `boardsmith/eslint-plugin` | `src/eslint-plugin/index.ts` | PKG-06 |
| `boardsmith/ai` | `src/ai/index.ts` | PKG-07 |
| `boardsmith/ai-trainer` | `src/ai-trainer/index.ts` | PKG-08 |
| `boardsmith/client` | `src/client/index.ts` | PKG-09 |
| `boardsmith/server` | `src/server/index.ts` | PKG-10 |
| `boardsmith/runtime` | `src/runtime/index.ts` | PKG-11 |
| `boardsmith/worker` | `src/worker/index.ts` | PKG-12 |

### Source vs Dist Exports Decision

**Option A: Source exports (Recommended for now)**
```json
"./ui": {
  "types": "./src/ui/index.ts",
  "import": "./src/ui/index.ts"
}
```
- Works immediately with bundlers
- No build step required for development
- Types are the source files themselves
- Consumers compile along with their own code

**Option B: Dist exports (Future, for npm publish)**
```json
"./ui": {
  "types": "./dist/ui/index.d.ts",
  "import": "./dist/ui/index.js"
}
```
- Requires build step before each test
- Pre-compiled for faster consumer builds
- Necessary for npm publishing

**Recommendation:** Use Option A now. A future "build" phase will add Option B for npm publishing.

### Vitest Alias Updates

The current `vitest.config.ts` has aliases for `@boardsmith/*` packages. After exports are configured, these aliases enable tests to use the new import paths:

```typescript
// vitest.config.ts - current aliases work with source exports
resolve: {
  alias: {
    '@boardsmith/engine': resolve(__dirname, 'src/engine/index.ts'),
    '@boardsmith/ui': resolve(__dirname, 'src/ui/index.ts'),
    // ... etc
  }
}
```

These aliases will be replaced with actual package imports in Phase 43.

### Anti-Patterns to Avoid

- **Wrong condition order:** Never put `default` or `import` before `types`
- **Missing `.` export:** The main entry point must be `.`, not just subpaths
- **Extensioned subpaths:** Use `./ui` not `./ui.js` for cleaner imports
- **Exposing internals:** Don't add `./src/*` pattern - only expose index files

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Types resolution | Duplicate `.d.ts` files | Point `types` to `.ts` source | TypeScript handles source types in bundler mode |
| Package validation | Manual import checks | External test project | Real-world verification |
| Build output | Custom build scripts | tsc or tsup (future) | Standard, maintained tools |

**Key insight:** For a source-exports approach with bundler consumers, no build step is needed. The `types` condition can point directly to `.ts` files.

## Common Pitfalls

### Pitfall 1: Types After Import
**What goes wrong:** TypeScript ignores type definitions, shows any/unknown types
**Why it happens:** `import` condition matched before `types` condition
**How to avoid:** Always put `types` first in each export condition object
**Warning signs:** IDE shows no type hints for imports

### Pitfall 2: Relative Path Errors
**What goes wrong:** Module not found errors
**Why it happens:** Exports paths must start with `./` and be relative to package.json
**How to avoid:** All paths start with `./src/` or `./dist/`
**Warning signs:** `ERR_PACKAGE_PATH_NOT_EXPORTED` error

### Pitfall 3: Missing Main Export
**What goes wrong:** `import {} from 'boardsmith'` fails
**Why it happens:** Only subpaths defined, not the `.` main entry
**How to avoid:** Always include `.` export pointing to engine
**Warning signs:** `ERR_PACKAGE_PATH_NOT_EXPORTED` for main package

### Pitfall 4: Internal Import Breakage
**What goes wrong:** Internal imports between packages break
**Why it happens:** Adding exports encapsulates the package
**How to avoid:** This is expected - Phase 43 rewrites internal imports
**Warning signs:** TypeScript errors for `@boardsmith/*` imports (expected)

### Pitfall 5: Vue SFC Export Issues
**What goes wrong:** Vue components can't be imported
**Why it happens:** `.vue` files require bundler compilation
**How to avoid:** Export the compiled module via index.ts, not raw .vue files
**Warning signs:** Errors about unknown file type

## Code Examples

### Complete package.json Exports Section

```json
{
  "name": "boardsmith",
  "version": "0.0.1",
  "type": "module",
  "description": "Library for designing digital board games",
  "exports": {
    ".": {
      "types": "./src/engine/index.ts",
      "import": "./src/engine/index.ts"
    },
    "./ui": {
      "types": "./src/ui/index.ts",
      "import": "./src/ui/index.ts"
    },
    "./session": {
      "types": "./src/session/index.ts",
      "import": "./src/session/index.ts"
    },
    "./testing": {
      "types": "./src/testing/index.ts",
      "import": "./src/testing/index.ts"
    },
    "./eslint-plugin": {
      "types": "./src/eslint-plugin/index.ts",
      "import": "./src/eslint-plugin/index.ts"
    },
    "./ai": {
      "types": "./src/ai/index.ts",
      "import": "./src/ai/index.ts"
    },
    "./ai-trainer": {
      "types": "./src/ai-trainer/index.ts",
      "import": "./src/ai-trainer/index.ts"
    },
    "./client": {
      "types": "./src/client/index.ts",
      "import": "./src/client/index.ts"
    },
    "./server": {
      "types": "./src/server/index.ts",
      "import": "./src/server/index.ts"
    },
    "./runtime": {
      "types": "./src/runtime/index.ts",
      "import": "./src/runtime/index.ts"
    },
    "./worker": {
      "types": "./src/worker/index.ts",
      "import": "./src/worker/index.ts"
    }
  }
}
```

### External Test Project Verification

Create a test project to verify exports work:

```bash
# In a separate directory
mkdir boardsmith-test && cd boardsmith-test
npm init -y
npm install ../path/to/BoardSmith
```

```typescript
// test-imports.ts
import { Game, Action, Flow } from 'boardsmith';
import { GameShell, useBoardInteraction } from 'boardsmith/ui';
import { GameSession } from 'boardsmith/session';
import { createTestGame } from 'boardsmith/testing';
import { createBot } from 'boardsmith/ai';
import { GameRunner } from 'boardsmith/runtime';

// If this compiles without errors, exports are correct
console.log('All imports resolved successfully');
```

### tsconfig.json for External Consumer

External projects need `moduleResolution: bundler` to use the exports:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `main` field only | `exports` field | Node.js 12 (2019) | Package encapsulation |
| Separate `.d.ts` files | `types` condition in exports | TypeScript 4.7 (2022) | Unified type resolution |
| `node16` moduleResolution | `bundler` moduleResolution | TypeScript 5.0 (2023) | Better bundler support |

**Deprecated/outdated:**
- `typings` field: Use `types` in exports instead
- `browser` field: Use conditional exports instead
- Bare `main` without `exports`: Use `exports` for modern packages

## Verification Strategy

### Success Criteria from Roadmap

1. `import { Game } from 'boardsmith'` resolves to src/engine/
2. `import { BoardView } from 'boardsmith/ui'` resolves to src/ui/
3. All 11 subpath exports resolve correctly
4. TypeScript understands exports (no red squiggles in IDE)
5. External test project can import from all subpaths

### Test Commands

```bash
# After exports configured, in external test project:
npx tsc --noEmit test-imports.ts

# Should produce no errors

# Or with vitest in the main repo:
npm test
```

## Cross-Package Dependencies

Some packages import from others. This is currently handled by vitest aliases but will break for external consumers until Phase 43 rewrites imports.

Current internal dependencies (from index.ts files):
- `src/ui/index.ts` imports from `@boardsmith/session` (colors)
- `src/runtime/index.ts` imports from `@boardsmith/engine`
- `src/ai/index.ts` imports from `@boardsmith/engine`
- `src/session/index.ts` imports from `@boardsmith/engine` (types)
- `src/worker/index.ts` imports from `@boardsmith/session`, `@boardsmith/engine`, `@boardsmith/server`

These `@boardsmith/*` imports will fail for external consumers. This is expected and will be fixed in Phase 43 (Import Rewrite).

## Open Questions

1. **Build step for npm publish?**
   - Not needed for this phase (source exports work for bundler consumers)
   - Will be addressed in a future phase before npm publish

2. **CLI package export?**
   - The `cli` directory is not included in exports
   - CLI is a separate concern (installed globally or via npx)
   - May need `boardsmith/cli` export in Phase 45

## Sources

### Primary (HIGH confidence)
- [Node.js Packages Documentation](https://nodejs.org/api/packages.html) - Official exports field specification
- [TypeScript Modules Reference](https://www.typescriptlang.org/docs/handbook/modules/reference.html) - TypeScript exports resolution
- [Guide to package.json exports](https://hirok.io/posts/package-json-exports) - Practical guide with examples

### Secondary (MEDIUM confidence)
- [TypeScript moduleResolution: bundler](https://www.typescriptlang.org/tsconfig/moduleResolution.html) - TSConfig options
- [Building TypeScript Libraries](https://arrangeactassert.com/posts/building-typescript-libraries/) - Library best practices

### Codebase (HIGH confidence)
- `package.json` - Current exports configuration
- `src/*/index.ts` - All 11 package entry points verified
- `vitest.config.ts` - Current alias configuration
- `tsconfig.json` - moduleResolution: bundler confirmed

## Metadata

**Confidence breakdown:**
- Exports syntax: HIGH - official Node.js documentation
- Condition ordering: HIGH - TypeScript documentation explicit
- Source-based exports: MEDIUM - works for bundlers, not validated for Node.js direct
- Cross-package deps: HIGH - verified by reading index.ts files

**Research date:** 2026-01-18
**Valid until:** Phase completion (stable - standard Node.js feature)
