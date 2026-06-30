# Phase 39: Foundation - Research

**Researched:** 2026-01-18
**Domain:** npm package structure, pnpm monorepo migration
**Confidence:** HIGH

## Summary

Phase 39 establishes the foundation for collapsing the BoardSmith pnpm monorepo into a single npm package. The current repository contains 12 publishable `@boardsmith/*` packages plus 10+ game packages, all managed via pnpm workspaces with `workspace:*` protocol references.

The migration to npm requires: removing pnpm-specific files (`pnpm-workspace.yaml`, `pnpm-lock.yaml`), updating the root `package.json` to remove workspace configuration and add a basic exports field, and generating a valid `package-lock.json`. This phase focuses only on npm tooling - source consolidation happens in Phase 40.

**Primary recommendation:** Delete pnpm files, remove `workspaces` field from root package.json, configure a minimal `exports` field pointing to existing dist, and run `npm install` to generate `package-lock.json`.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| npm | 10.x (bundled with Node 20+) | Package management | Target package manager per PKG-13 |
| Node.js | >=20 | Runtime | Already required in existing package.json |
| TypeScript | ^5.7.0 | Type checking/compilation | Already in use |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | ^2.1.0 | Test runner | Already in use at root |
| eslint | ^9.39.2 | Linting | Already in use at root |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| npm | pnpm | Faster, but requirement explicitly specifies npm |
| npm | yarn | Similar to npm, but npm is the requirement |

**Installation:**
```bash
# No new packages needed for Phase 39
# Just switch from pnpm to npm
npm install
```

## Architecture Patterns

### Current Structure (pnpm monorepo)
```
BoardSmith/
├── package.json           # Root with workspaces config
├── pnpm-workspace.yaml    # Workspace definitions
├── pnpm-lock.yaml         # Lock file
├── packages/
│   ├── engine/           # @boardsmith/engine
│   ├── ui/               # @boardsmith/ui
│   ├── cli/              # @boardsmith/cli
│   ├── client/           # @boardsmith/client
│   ├── runtime/          # @boardsmith/runtime
│   ├── server/           # @boardsmith/server
│   ├── session/          # @boardsmith/session
│   ├── ai/               # @boardsmith/ai
│   ├── ai-trainer/       # @boardsmith/ai-trainer
│   ├── testing/          # @boardsmith/testing
│   ├── eslint-plugin/    # eslint-plugin-boardsmith
│   ├── worker/           # @boardsmith/worker
│   └── games/            # Game packages (to be extracted later)
└── tsconfig.json         # Root TypeScript config
```

### Target Structure (Phase 39 - Foundation only)
```
BoardSmith/
├── package.json           # name: "boardsmith", exports field, no workspaces
├── package-lock.json      # npm lock file
├── packages/              # Still exists (source moves in Phase 40)
│   └── ... (unchanged)
└── tsconfig.json         # Unchanged
```

### Pattern 1: npm exports field (minimal)
**What:** Basic exports field to prepare for subpath exports (Phase 42)
**When to use:** Phase 39 foundation setup
**Example:**
```json
// Source: https://nodejs.org/api/packages.html
{
  "name": "boardsmith",
  "exports": {
    ".": {
      "types": "./packages/engine/dist/index.d.ts",
      "import": "./packages/engine/dist/index.js"
    }
  }
}
```

### Pattern 2: Removing pnpm workspace configuration
**What:** Remove workspace-specific fields from package.json
**When to use:** Migrating from pnpm monorepo to single package
**Example:**
```json
// REMOVE these fields:
{
  "pnpm": { ... },        // pnpm-specific config
  "workspaces": [ ... ]   // npm workspaces (not needed for single package)
}
```

### Anti-Patterns to Avoid
- **Keeping workspace:* references:** These will cause npm install to fail. But in Phase 39, we do NOT modify package sources - those references will be addressed in Phase 43 (Import Rewrite).
- **Running npm install on unmodified monorepo:** Must remove workspace config first or npm will try to link workspaces.
- **Deleting packages/ directory prematurely:** Source consolidation is Phase 40, not Phase 39.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Lock file generation | Manual lock file editing | `npm install` | Generates correct lock file format |
| Package validation | Custom validation scripts | `npm pack --dry-run` | Shows what would be published |

**Key insight:** Phase 39 is purely about tooling migration (pnpm -> npm). No source code changes.

## Common Pitfalls

### Pitfall 1: Workspace Protocol References
**What goes wrong:** `workspace:*` references in package dependencies cause npm install failure
**Why it happens:** npm doesn't understand pnpm's `workspace:` protocol
**How to avoid:** In Phase 39, only remove root workspace config. Sub-package dependencies stay untouched until Phase 43.
**Warning signs:** npm install errors about unresolved `workspace:*` versions

### Pitfall 2: Partial pnpm Cleanup
**What goes wrong:** Leaving `pnpm-workspace.yaml` or `pnpm-lock.yaml` causes confusion
**Why it happens:** Both npm and pnpm may try to operate on the repo
**How to avoid:** Delete ALL pnpm-specific files: `pnpm-workspace.yaml`, `pnpm-lock.yaml`
**Warning signs:** `pnpm` commands still working when they shouldn't

### Pitfall 3: Private Package Flag
**What goes wrong:** `"private": true` blocks npm publish
**Why it happens:** Monorepo roots are typically private
**How to avoid:** Change to `"private": false` (or remove) since this will be a public package
**Warning signs:** `npm publish` fails with private package error

### Pitfall 4: Missing exports Field
**What goes wrong:** Without exports, consumers can't import the package
**Why it happens:** Exports field is new-ish, easy to forget
**How to avoid:** Add minimal exports field pointing to engine entry point
**Warning signs:** Consumers get "Package path not exported" errors

### Pitfall 5: node_modules Conflicts
**What goes wrong:** pnpm's node_modules structure differs from npm's
**Why it happens:** pnpm uses symlinks, npm uses flat structure
**How to avoid:** Delete `node_modules/` entirely before running `npm install`
**Warning signs:** Strange module resolution errors, duplicate packages

## Code Examples

Verified patterns from official sources:

### Minimal package.json for Phase 39
```json
// Source: https://nodejs.org/api/packages.html + npm docs
{
  "name": "boardsmith",
  "version": "0.0.1",
  "type": "module",
  "description": "Library for designing digital board games",
  "exports": {
    ".": {
      "types": "./packages/engine/dist/index.d.ts",
      "import": "./packages/engine/dist/index.js"
    }
  },
  "scripts": {
    "build": "npm run build --workspaces --if-present",
    "test": "vitest run",
    "test:watch": "vitest --watch",
    "lint": "eslint packages/"
  },
  "devDependencies": {
    "@playwright/test": "^1.57.0",
    "@types/node": "^22.0.0",
    "@typescript-eslint/eslint-plugin": "^8.52.0",
    "@typescript-eslint/parser": "^8.52.0",
    "eslint": "^9.39.2",
    "playwright": "^1.57.0",
    "puppeteer": "^24.32.1",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  },
  "engines": {
    "node": ">=20"
  }
}
```

### npm exports field with types
```json
// Source: https://nodejs.org/api/packages.html
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  }
}
```

Note: The `"types"` condition should always come first in the object to ensure TypeScript resolves it correctly.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `main` field only | `exports` field | Node 12.7+ (2019) | Encapsulates package, enables subpaths |
| pnpm workspaces | Single package with exports | N/A (project decision) | Simpler consumer experience |
| `@scope/package` | Unscoped with subpaths | Trend since ~2022 | `boardsmith/ui` vs `@boardsmith/ui` |

**Deprecated/outdated:**
- `main` field: Still works but `exports` takes precedence and provides more control
- `module` field: Non-standard, `exports` with conditional import/require is preferred

## Open Questions

Things that couldn't be fully resolved:

1. **Build script behavior after removing workspaces**
   - What we know: Current build uses `npm run build --workspaces --if-present`
   - What's unclear: This won't work after removing workspaces config
   - Recommendation: Phase 39 may need to temporarily disable build script or update it. Full solution in Phase 40.

2. **Test script with workspace packages**
   - What we know: Tests use workspace dependencies for game rules
   - What's unclear: Will tests still work with npm's resolution?
   - Recommendation: May need to skip tests until Phase 43 completes import rewrite

## Inventory of Current State

### Files to DELETE
```
pnpm-workspace.yaml
pnpm-lock.yaml
```

### Files to MODIFY
```
package.json - Remove workspaces, pnpm config; add exports; change private to false
```

### Files to CREATE
```
package-lock.json - Generated by npm install
```

### Current Dependencies (External - to consolidate)

From analyzing all package.json files, external dependencies that need to be in root:

**Production:**
| Dependency | Used By | Version |
|------------|---------|---------|
| better-sqlite3 | cli, server | ^11.0.0 |
| chalk | cli | ^5.3.0 |
| chokidar | cli | ^3.6.0 |
| commander | cli | ^12.0.0 |
| esbuild | cli | ^0.24.0 |
| express | cli | ^4.18.0 |
| open | cli | ^10.0.0 |
| ora | cli | ^8.0.0 |
| prompts | cli | ^2.4.2 |
| three | ui | ^0.160.0 |
| vite | cli, ui | ^5.4.0 / ^5.0.0 |
| vue | ui, client | ^3.4.0 |
| ws | cli | ^8.16.0 |

**Dev:**
| Dependency | Used By | Version |
|------------|---------|---------|
| @cloudflare/workers-types | worker | ^4.20241127.0 |
| @types/better-sqlite3 | cli, server | ^7.6.0 |
| @types/express | cli | ^4.17.21 |
| @types/node | multiple | ^20.0.0 / ^22.0.0 |
| @types/prompts | cli | ^2.4.9 |
| @types/three | ui | ^0.160.0 |
| @types/ws | cli | ^8.5.10 |
| @vitejs/plugin-vue | ui | ^5.0.0 |
| typescript | all | ^5.7.0 (latest) |
| vite-plugin-dts | ui | ^3.0.0 |
| vitest | multiple | ^2.1.0 / ^2.1.9 |
| vue-tsc | ui | ^2.0.0 |

**Note:** Dependency consolidation is Phase 40 scope. Phase 39 only needs npm tooling working.

### Current Workspace Packages (12 publishable)

| Package | Name | Has Dependencies |
|---------|------|------------------|
| engine | @boardsmith/engine | None (pure) |
| runtime | @boardsmith/runtime | engine |
| ai | @boardsmith/ai | engine |
| ai-trainer | @boardsmith/ai-trainer | engine, runtime, ai |
| session | @boardsmith/session | engine, runtime, ai |
| server | @boardsmith/server | session |
| client | @boardsmith/client | None (pure) |
| ui | @boardsmith/ui | client, session |
| worker | @boardsmith/worker | ai, engine, server, session, runtime |
| cli | @boardsmith/cli | ai, ai-trainer, engine, runtime, server, session |
| testing | @boardsmith/testing | engine, runtime |
| eslint-plugin | eslint-plugin-boardsmith | None (pure) |

## Sources

### Primary (HIGH confidence)
- [Node.js Packages Documentation](https://nodejs.org/api/packages.html) - exports field syntax, conditional exports, subpath patterns
- [npm package.json Documentation](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/) - package configuration

### Secondary (MEDIUM confidence)
- [Hiroki Osame's Guide to exports](https://hirok.io/posts/package-json-exports) - Practical examples of exports configuration

### Tertiary (LOW confidence)
- WebSearch results on monorepo migration - General guidance, specific steps may vary

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Using npm and Node.js official documentation
- Architecture: HIGH - Pattern is well-documented in Node.js docs
- Pitfalls: MEDIUM - Based on common migration issues, specific issues may arise

**Research date:** 2026-01-18
**Valid until:** 2026-02-18 (30 days - stable domain, npm hasn't changed rapidly)
