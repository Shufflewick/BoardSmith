# Phase 45: CLI Update - Research

**Researched:** 2026-01-18
**Domain:** CLI command updates for standalone game projects
**Confidence:** HIGH

## Summary

This phase updates all BoardSmith CLI commands to work with the new standalone game project structure established in Phases 39-44. The CLI currently assumes a monorepo context with `@boardsmith/*` packages and `packages/` directory structure. It must be updated to work with extracted games that depend on the single `boardsmith` npm package.

Key findings:
1. The CLI commands (`dev`, `build`, `test`, `pack`, `init`) have hardcoded assumptions about monorepo structure that need updating
2. The `init` command already produces correct scaffolds but uses old `@boardsmith/*` import paths in templates
3. The `dev` command has esbuild and Vite plugins that resolve `@boardsmith/*` imports to monorepo paths - these need to detect and handle standalone game contexts
4. The `pack` command is monorepo-only and needs rethinking for standalone projects
5. All help text references old import paths and structure

**Primary recommendation:** Update CLI commands to auto-detect context (monorepo vs standalone game), update templates to use `boardsmith` imports, and simplify `pack` command for single-package structure.

## Standard Stack

### Core CLI Dependencies (already in use)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| commander | ^12.0.0 | CLI argument parsing | Already used, standard for Node CLIs |
| chalk | ^5.3.0 | Terminal output styling | Already used, well-maintained |
| ora | ^8.0.0 | Loading spinners | Already used for progress indicators |
| esbuild | ^0.24.0 | Fast bundling for dev | Already used for rules bundling |
| vite | ^5.4.0 | Dev server and production builds | Already used |

### No New Dependencies Needed

The CLI updates are primarily refactoring existing code to handle new contexts. No new dependencies are required.

## Architecture Patterns

### Context Detection Pattern

The CLI must detect whether it's running in:
1. **Monorepo context** - Inside the BoardSmith repository (packages/ exists)
2. **Standalone game context** - In a game project that depends on boardsmith

```typescript
// Pattern for context detection
function getProjectContext(cwd: string): 'monorepo' | 'standalone' | 'unknown' {
  // Check for boardsmith.json (indicates game project)
  const hasGameConfig = existsSync(join(cwd, 'boardsmith.json'));

  // Check for packages/ directory with engine (indicates monorepo)
  const hasPackagesDir = existsSync(join(cwd, 'packages', 'engine'));

  // Check for monorepo package.json with workspaces
  const rootPkg = join(cwd, 'package.json');
  if (existsSync(rootPkg)) {
    const pkg = JSON.parse(readFileSync(rootPkg, 'utf-8'));
    if (pkg.workspaces) return 'monorepo';
  }

  if (hasGameConfig && !hasPackagesDir) return 'standalone';
  if (hasPackagesDir) return 'monorepo';
  return 'unknown';
}
```

### Import Resolution Strategy

For standalone games, the CLI's dev server must resolve `boardsmith` imports:

```typescript
// Current approach (monorepo only - WRONG for standalone)
const packageDirs: Record<string, string> = {
  '@boardsmith/engine': 'engine',
  '@boardsmith/ui': 'ui',
  // ...
};

// New approach (works for both contexts)
function resolveBoardsmithImport(source: string, context: 'monorepo' | 'standalone') {
  if (context === 'monorepo') {
    // Use packages/ directory paths
    return resolveFromPackages(source);
  } else {
    // Let normal node_modules resolution handle it
    // The game's node_modules/boardsmith contains the package
    return null; // Don't intercept - use default resolution
  }
}
```

### Template Token Pattern

Templates use placeholder tokens that get replaced:

| Token | Replacement | Used In |
|-------|-------------|---------|
| `{GAME_NAME}` | URL-safe game identifier | package.json name, config |
| `{DISPLAY_NAME}` | Human-readable name | index.html title |

This pattern is already established in Phase 44 templates and should be continued.

## Don't Hand-Roll

Problems with existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Import resolution in dev | Custom resolution logic | Let Node/Vite resolve normally | Standalone games have proper node_modules |
| Context detection | Complex heuristics | Simple file existence checks | boardsmith.json + no packages/ = standalone |
| Template file generation | Inline string templates | Read from template directory | Templates already exist |

## Common Pitfalls

### Pitfall 1: Assuming Monorepo Context

**What goes wrong:** CLI fails to start dev server for standalone games because it can't find `packages/engine/src/index.ts`.

**Why it happens:** The `boardsmithResolvePlugin` and `boardsmithVitePlugin` hardcode paths like `join(cliPackagesDir, dirName, 'src', 'index.ts')`.

**How to avoid:**
1. Detect context first
2. Only intercept `@boardsmith/*` imports in monorepo context
3. For standalone games, don't intercept - let normal resolution work

**Warning signs:** "Cannot find module @boardsmith/engine" errors when running `boardsmith dev` in standalone game.

### Pitfall 2: pack Command Assumptions

**What goes wrong:** `pack` command fails in standalone games because it looks for `packages/*` directories.

**Why it happens:** The command was designed for monorepo-to-consumer workflow.

**How to avoid:**
1. For standalone games, `pack` should be either:
   - A no-op with helpful message ("This game is already standalone")
   - Or package the game itself for distribution

**Warning signs:** "No public @boardsmith/* packages found" error in standalone game.

### Pitfall 3: Old Import Paths in Templates

**What goes wrong:** Games created with `boardsmith init` have `@boardsmith/*` imports that don't work.

**Why it happens:** Template generation in `init.ts` and `project-scaffold.ts` still uses old paths.

**How to avoid:**
1. Update all template strings to use `boardsmith` instead of `@boardsmith/engine`
2. Update to use `boardsmith/ui` instead of `@boardsmith/ui`
3. Update to use `boardsmith/testing` instead of `@boardsmith/testing`

**Warning signs:** TypeScript errors about unresolved modules in newly created projects.

### Pitfall 4: Test Runner Assumptions

**What goes wrong:** `boardsmith test` doesn't run tests because it expects vitest to be installed differently.

**Why it happens:** Currently uses `npx vitest run` which works but could fail if game project doesn't have vitest.

**How to avoid:**
1. Verify vitest is in the project's devDependencies
2. Use the project's local vitest, not a global one

**Warning signs:** "vitest: command not found" errors.

### Pitfall 5: Build Output Structure Mismatch

**What goes wrong:** Build output doesn't match what's expected for standalone distribution.

**Why it happens:** Build command assumes monorepo structure with rules in separate package.

**How to avoid:**
1. Update build command to use unified structure (`src/rules/index.ts`)
2. Verify entry points match standalone project layout

**Warning signs:** Build errors about missing entry points.

## Code Examples

### Context-Aware Dev Command

```typescript
// src/cli/commands/dev.ts
export async function devCommand(options: DevOptions): Promise<void> {
  const cwd = process.cwd();
  const context = getProjectContext(cwd);

  // Different plugin configurations based on context
  const plugins = context === 'monorepo'
    ? [boardsmithMonorepoPlugin()]  // Intercept @boardsmith/*
    : [];  // Let normal resolution work

  const vite = await createViteServer({
    root: uiPath,
    plugins: [
      ...plugins,
      injectApiUrlPlugin(workerPort),
    ],
  });
}
```

### Updated Template Imports

```typescript
// Current (WRONG for standalone)
import { Game, Player } from '@boardsmith/engine';
import { GameShell } from '@boardsmith/ui';

// Updated (CORRECT for standalone)
import { Game, Player } from 'boardsmith';
import { GameShell } from 'boardsmith/ui';
```

### Updated project-scaffold.ts Pattern

```typescript
export function generatePackageJson(config: ProjectConfig): string {
  const pkg = {
    name: config.name,
    version: '0.0.1',
    type: 'module',
    scripts: {
      dev: 'npx boardsmith dev',      // Use npx for CLI
      build: 'npx boardsmith build',
      test: 'vitest',                  // Direct vitest call
      validate: 'npx boardsmith validate',
    },
    dependencies: {
      // Use file: link for local dev, npm version for production
      boardsmith: 'file:../../BoardSmith',  // Or '^0.0.1' for npm
      vue: '^3.4.0',
    },
    devDependencies: {
      '@vitejs/plugin-vue': '^5.0.0',
      typescript: '^5.7.0',
      vite: '^6.0.0',
      vitest: '^2.0.0',
    },
  };
  return JSON.stringify(pkg, null, 2);
}
```

## CLI Command Analysis

### CLI-01: `boardsmith create` (init) Update

**Current state:** Uses `@boardsmith/*` imports in generated templates.

**Required changes:**
1. Update `init.ts` template functions to use `boardsmith` imports
2. Update `project-scaffold.ts` to generate correct imports
3. Use `file:` link pattern for local development
4. Remove `@boardsmith/cli` from dependencies (use `npx boardsmith`)

**Files to update:**
- `/Users/jtsmith/board_game_service/BoardSmith/src/cli/commands/init.ts`
- `/Users/jtsmith/board_game_service/BoardSmith/src/cli/lib/project-scaffold.ts`

### CLI-02: `boardsmith dev` Update

**Current state:** Has hardcoded monorepo path resolution plugins.

**Required changes:**
1. Add context detection at start
2. Conditionally apply `boardsmithResolvePlugin` only in monorepo
3. For standalone: let Vite/Node resolve from node_modules
4. Update esbuild plugin similarly for rules bundling

**Files to update:**
- `/Users/jtsmith/board_game_service/BoardSmith/src/cli/commands/dev.ts`

### CLI-03: `boardsmith build` Update

**Current state:** Assumes rules at `src/rules/index.ts`, which is correct.

**Required changes:**
1. Add context detection
2. Update external packages list (no `@boardsmith/engine`, use `boardsmith`)
3. Verify output structure matches standalone expectations

**Files to update:**
- `/Users/jtsmith/board_game_service/BoardSmith/src/cli/commands/build.ts`

### CLI-04: `boardsmith test` Update

**Current state:** Uses `npx vitest run` which should work.

**Required changes:**
1. Add check that vitest is installed
2. Consider running from project's node_modules directly
3. Update any test helper imports in examples

**Files to update:**
- `/Users/jtsmith/board_game_service/BoardSmith/src/cli/commands/test.ts`

### CLI-05: `boardsmith pack` Update

**Current state:** Designed for monorepo - discovers all `@boardsmith/*` packages.

**Required changes:**
1. For monorepo context: Continue current behavior (packing all packages)
2. For standalone context: Either error with message or pack the game itself
3. Update help text to clarify purpose

**Files to update:**
- `/Users/jtsmith/board_game_service/BoardSmith/src/cli/commands/pack.ts`

### CLI-06: Help Text Updates

**Current state:** References `@boardsmith/*` import paths throughout.

**Required changes:**
1. Update all help descriptions to mention `boardsmith` package
2. Update example snippets in CLI output
3. Update any error messages that mention import paths

**Files to update:**
- `/Users/jtsmith/board_game_service/BoardSmith/src/cli/cli.ts` (main command definitions)
- All command files with console output

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `@boardsmith/*` packages | `boardsmith` with subpath exports | Phase 42-43 | CLI must use new paths |
| Monorepo-only CLI | Context-aware CLI | Phase 45 (this phase) | Works for both contexts |
| `@boardsmith/cli` as dep | `npx boardsmith` | Phase 44 | No CLI in dependencies |
| pnpm workspaces | npm single package | Phase 39 | Simpler dependency resolution |

## Verification Approach

For each CLI command update:

1. **Test in monorepo context:**
   - Run command from BoardSmith repo root
   - Verify existing behavior unchanged

2. **Test in standalone game context:**
   - Use extracted game from `/private/tmp/boardsmith-test-target/hex/`
   - Run each command and verify it works
   - Check for correct import resolution

3. **Test fresh project creation:**
   - Run `boardsmith init test-game`
   - Navigate to test-game/
   - Run `npm install`
   - Run `boardsmith dev` and verify it starts
   - Run `boardsmith test` and verify tests run

## Open Questions

1. **pack command for standalone games**
   - What we know: Currently only works in monorepo
   - What's unclear: Should standalone games have their own pack behavior?
   - Recommendation: Make it a clear error in standalone context with message about what to do instead

2. **CLI global vs local installation**
   - What we know: Games use `npx boardsmith` which downloads if not installed
   - What's unclear: Performance impact of npx download on first run
   - Recommendation: Continue with npx approach - it's simple and always works

## Sources

### Primary (HIGH confidence)
- Direct analysis of CLI source files in `/Users/jtsmith/board_game_service/BoardSmith/src/cli/`
- Extracted game structure in `/private/tmp/boardsmith-test-target/`
- Phase 44 EXTRACTION-GUIDE.md for import transformation rules
- Template files in `/private/tmp/boardsmith-test-target/templates/`

### Secondary (MEDIUM confidence)
- docs/getting-started.md for expected CLI behavior
- Phase 44 research for project structure decisions

## Metadata

**Confidence breakdown:**
- CLI command analysis: HIGH - direct code inspection
- Import transformation: HIGH - verified against Phase 43-44
- Context detection: HIGH - simple file existence checks
- pack command behavior: MEDIUM - needs design decision

**Research date:** 2026-01-18
**Valid until:** Until Phase 45 is complete
