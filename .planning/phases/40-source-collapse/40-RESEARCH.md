# Phase 40: Source Collapse - Research

**Researched:** 2026-01-18
**Domain:** Monorepo consolidation, file system restructuring
**Confidence:** HIGH

## Summary

Phase 40 consolidates all package source files from `packages/*/src/` into a unified `src/` directory structure. This is a straightforward file move operation - no code changes are required in this phase. Import rewrites happen in Phase 43, and test colocation happens in Phase 41.

The current structure has 12 packages with 179 total source files to move. The packages have a clear dependency hierarchy, but since we're only moving files (not updating imports yet), move order doesn't technically matter. However, organizing by dependency order will make Phase 43's import rewrite work more systematically.

**Primary recommendation:** Move all 179 files in a single plan using `git mv` to preserve history. Group moves by package for clarity, but execute as one atomic operation.

## Current State Analysis

### Package Inventory

| Package | Source Files | Target Directory | Notes |
|---------|-------------|------------------|-------|
| engine | 42 | src/engine/ | Core game primitives, largest package |
| runtime | 2 | src/runtime/ | GameRunner, shared runtime |
| ai | 4 | src/ai/ | MCTS bot implementation |
| ai-trainer | 17 | src/ai-trainer/ | Training infrastructure |
| testing | 7 | src/testing/ | Test utilities |
| session | 12 | src/session/ | Game session management |
| eslint-plugin | 6 | src/eslint-plugin/ | ESLint rules |
| client | 6 | src/client/ | Browser client SDK |
| server | 9 | src/server/ | Server core |
| ui | 54 | src/ui/ | Vue components, largest package |
| worker | 1 | src/worker/ | Cloudflare Worker |
| cli | 19 | src/cli/ | CLI commands |

**Total: 179 files across 12 packages**

### Files NOT to Move

The following are explicitly excluded from this phase:

| Location | Contents | Reason |
|----------|----------|--------|
| `packages/*/tests/` | Test files | Phase 41 (Test Colocation) |
| `packages/games/` | Game implementations | Phase 44 (Game Extraction) |
| `packages/*/dist/` | Build output | Regenerated after move |
| `packages/*/package.json` | Package configs | No longer needed after collapse |
| `packages/ai/debug-bot.ts` | Debug script | Development-only, can stay |
| `packages/ai-trainer/scripts/` | Benchmark scripts | Development-only, can stay |
| `packages/ui/vite.config.ts` | Build config | May need update later |

### Special Files to Move

Some packages have non-TypeScript files in `src/`:

| Package | File | Type | Action |
|---------|------|------|--------|
| ui | `src/animation/drag-drop.css` | CSS | Move to src/ui/animation/ |
| ui | `src/animation/card-flip.css` | CSS | Move to src/ui/animation/ |
| ui | `src/assets/turn-notification.mp3` | Audio | Move to src/ui/assets/ |
| ui | `src/assets/audio.d.ts` | Type decl | Move to src/ui/assets/ |
| ui | `src/global.d.ts` | Type decl | Move to src/ui/ |
| cli | `src/slash-command/*.md` | Templates | Move to src/cli/slash-command/ |
| cli | `src/templates/` | Empty dir | Skip (empty) |
| cli | `src/utils/` | Empty dir | Skip (empty) |

## Package Mappings

### Requirements Mapping (SRC-01 through SRC-12)

| Requirement | From | To |
|-------------|------|-----|
| SRC-01 | packages/engine/src/ | src/engine/ |
| SRC-02 | packages/ui/src/ | src/ui/ |
| SRC-03 | packages/session/src/ | src/session/ |
| SRC-04 | packages/cli/src/ | src/cli/ |
| SRC-05 | packages/testing/src/ | src/testing/ |
| SRC-06 | packages/eslint-plugin/src/ | src/eslint-plugin/ |
| SRC-07 | packages/ai/src/ | src/ai/ |
| SRC-08 | packages/ai-trainer/src/ | src/ai-trainer/ |
| SRC-09 | packages/client/src/ | src/client/ |
| SRC-10 | packages/server/src/ | src/server/ |
| SRC-11 | packages/runtime/src/ | src/runtime/ |
| SRC-12 | packages/worker/src/ | src/worker/ |

### Directory Structure After Move

```
src/
├── engine/           # 42 files - core game logic
│   ├── action/       # Action system
│   ├── command/      # Event sourcing commands
│   ├── element/      # Game elements (Space, Piece, etc.)
│   ├── flow/         # Flow engine
│   ├── player/       # Player system
│   ├── sandbox/      # Sandboxing
│   ├── scoring/      # Scoring tracks
│   ├── utils/        # Utilities
│   └── index.ts      # Barrel export
├── runtime/          # 2 files - game execution
│   ├── runner.ts
│   └── index.ts
├── ai/               # 4 files - MCTS bot
│   ├── mcts-bot.ts
│   ├── types.ts
│   ├── utils.ts
│   └── index.ts
├── ai-trainer/       # 17 files - training
│   └── [various training files]
├── session/          # 12 files - session management
│   └── [various session files]
├── testing/          # 7 files - test utilities
│   └── [various test helpers]
├── eslint-plugin/    # 6 files - ESLint rules
│   ├── rules/
│   └── index.ts
├── client/           # 6 files - browser SDK
│   └── [client files]
├── server/           # 9 files - server core
│   ├── stores/
│   ├── handlers/
│   └── index.ts
├── ui/               # 54 files - Vue components
│   ├── animation/    # CSS animations
│   ├── assets/       # Audio, type decls
│   ├── components/   # Vue components
│   ├── composables/  # Vue composables
│   └── index.ts
├── worker/           # 1 file - Cloudflare Worker
│   └── index.ts
└── cli/              # 19 files - CLI
    ├── commands/
    ├── lib/
    ├── slash-command/
    ├── cli.ts
    └── local-server.ts
```

## Dependencies

### Inter-Package Dependency Graph

```
                    ┌─────────┐
                    │ engine  │ (leaf - no deps)
                    └────┬────┘
           ┌────────────┼────────────┐
           │            │            │
           v            v            v
      ┌────────┐   ┌────────┐   ┌─────────────┐
      │runtime │   │   ai   │   │eslint-plugin│ (leaf)
      └───┬────┘   └───┬────┘   └─────────────┘
          │            │
    ┌─────┴────┬───────┴────┐
    │          │            │
    v          v            v
┌────────┐ ┌───────┐  ┌───────────┐
│testing │ │session│  │ai-trainer │
└────────┘ └───┬───┘  └───────────┘
               │
         ┌─────┴─────┐
         │           │
         v           v
    ┌────────┐  ┌────────┐
    │ server │  │ client │ (leaf)
    └───┬────┘  └───┬────┘
        │           │
        └─────┬─────┘
              v
         ┌────────┐
         │   ui   │
         └────────┘
              │
              v
         ┌────────┐
         │ worker │
         └────────┘
              │
              v
         ┌────────┐
         │  cli   │
         └────────┘
```

### Move Order Recommendation

Since imports aren't being updated in this phase, the order doesn't matter for correctness. However, for logical organization:

**Wave 1 - Foundation (47 files)**
1. engine (42 files)
2. runtime (2 files)
3. ai (4 files - Note: minus debug-bot.ts which stays)

**Wave 2 - Mid-tier (36 files)**
4. ai-trainer (17 files)
5. testing (7 files)
6. session (12 files)

**Wave 3 - Peripherals (96 files)**
7. eslint-plugin (6 files)
8. client (6 files)
9. server (9 files)
10. ui (54 files)
11. worker (1 file)
12. cli (19 files)

## Special Considerations

### Git History Preservation

Use `git mv` for all moves to preserve file history:
```bash
git mv packages/engine/src/* src/engine/
```

### Index.ts Barrel Exports

Each package has an `index.ts` that re-exports public API. These will need updating in Phase 43 (Import Rewrite), but for now they move as-is with their `@boardsmith/*` imports intact.

### The ui Package

The ui package is the most complex:
- Has Vue SFC files (.vue)
- Has CSS files in src/animation/
- Has MP3 audio in src/assets/
- Has a vite.config.ts at package root (NOT in src/)
- Has `.vue-global-types/` in node_modules (auto-generated, ignore)

The vite.config.ts should probably remain at the package level or be consolidated into root later.

### The cli Package

The cli package has:
- Markdown templates in `src/slash-command/` - these should move
- Empty `src/templates/` and `src/utils/` directories - skip these

### Build Artifacts

After the move, the old `packages/*/dist/` directories are obsolete. They can be deleted, but the root tsconfig.json already has `outDir: "dist"` and `rootDir: "src"` configured (from Phase 39), so building will create a new top-level `dist/`.

### Files That Stay

These files should NOT move:
- `packages/ai/debug-bot.ts` - Development debug script, references games
- `packages/ai-trainer/scripts/*.ts` - Benchmark scripts, references games
- `packages/ui/vite.config.ts` - Build configuration
- All `packages/*/tests/` - Phase 41
- All `packages/games/` - Phase 44

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| File moving | Custom script | `git mv` | Preserves history |
| Directory creation | mkdir -p loops | Git handles via `git mv` | Simpler |
| Bulk operations | Individual moves | Shell globbing or find | Fewer commands |

## Common Pitfalls

### Pitfall 1: Breaking Git History
**What goes wrong:** Using `cp` + `rm` instead of `git mv` loses file history
**Why it happens:** Seems simpler to copy/delete
**How to avoid:** Always use `git mv` for moves
**Warning signs:** Git shows file as deleted + new file instead of renamed

### Pitfall 2: Missing Subdirectories
**What goes wrong:** `git mv packages/engine/src/* src/engine/` fails if src/engine/ doesn't exist
**Why it happens:** Git mv doesn't create parent directories
**How to avoid:** Create target directories first with `mkdir -p`
**Warning signs:** "destination directory does not exist" error

### Pitfall 3: Moving Tests Accidentally
**What goes wrong:** Using `packages/engine/*` instead of `packages/engine/src/*` moves tests
**Why it happens:** Glob is too broad
**How to avoid:** Be explicit: `packages/engine/src/`
**Warning signs:** Tests appear in wrong location

### Pitfall 4: Forgetting Non-TS Files
**What goes wrong:** CSS, MP3, .d.ts files left behind
**Why it happens:** Only thinking about .ts files
**How to avoid:** Move entire `src/` directory contents
**Warning signs:** Missing styles, audio, type declarations

### Pitfall 5: Empty Directories
**What goes wrong:** Trying to move empty directories fails
**Why it happens:** Git doesn't track empty directories
**How to avoid:** Skip empty directories (cli/src/templates/, cli/src/utils/)
**Warning signs:** "pathspec did not match any files" error

## Recommended Plan Structure

Given 179 files across 12 packages, this should be a single plan with multiple tasks:

### Plan Structure

```
40-PLAN-01-source-collapse.md
├── Task 1: Create directory structure
├── Task 2: Move engine (42 files)
├── Task 3: Move runtime (2 files)
├── Task 4: Move ai (4 files)
├── Task 5: Move ai-trainer (17 files)
├── Task 6: Move testing (7 files)
├── Task 7: Move session (12 files)
├── Task 8: Move eslint-plugin (6 files)
├── Task 9: Move client (6 files)
├── Task 10: Move server (9 files)
├── Task 11: Move ui (54 files)
├── Task 12: Move worker (1 file)
├── Task 13: Move cli (19 files)
├── Task 14: Verify structure and commit
```

Each task is a logical unit but they can all be done in sequence without verification between them.

### Verification Strategy

After all moves:
1. `find src -type f | wc -l` should equal 179
2. `ls -la packages/*/src/` should show empty or error (dirs don't exist)
3. `git status` should show all files as renamed (not deleted+new)
4. No test files in `src/` (those stay in `packages/*/tests/`)

## Code Examples

### Creating Directory Structure

```bash
# Create all target directories
mkdir -p src/{engine,runtime,ai,ai-trainer,session,testing,eslint-plugin,client,server,ui,worker,cli}

# Preserve subdirectory structure for packages with nested dirs
mkdir -p src/engine/{action,command,element,flow,player,sandbox,scoring,utils}
mkdir -p src/ui/{animation,assets,components,composables}
mkdir -p src/ui/components/{auto-ui,dice,helpers}
mkdir -p src/server/{stores,handlers}
mkdir -p src/eslint-plugin/rules
mkdir -p src/cli/{commands,lib,slash-command}
```

### Moving Package Contents

```bash
# Move engine package
git mv packages/engine/src/* src/engine/

# Move runtime package
git mv packages/runtime/src/* src/runtime/

# Move ui package (has subdirectories and non-ts files)
git mv packages/ui/src/* src/ui/

# Verify a move
git status | grep "renamed:" | wc -l
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| pnpm workspaces | Single npm package | Phase 39 | Simpler structure |
| @boardsmith/* imports | Relative imports | Phase 43 | Unified codebase |
| Distributed tsconfig | Single root tsconfig | Phase 39 | Easier builds |

## Open Questions

### Resolved During Research

1. **Should debug scripts move?** NO - `packages/ai/debug-bot.ts` and `packages/ai-trainer/scripts/` reference games and are development-only.

2. **What about vite.config.ts?** STAYS - It's not in `src/`, so not part of this phase.

3. **Move order matters?** NO - Since imports aren't updated, order is cosmetic only.

### Questions for Planner

1. **Single commit or multiple?** Recommend single commit for atomicity, but could split by wave if preferred.

2. **Delete old dist directories?** Recommend yes, but could defer to separate cleanup task.

## Sources

### Primary (HIGH confidence)
- Direct file system inspection of `/Users/jtsmith/board_game_service/BoardSmith/packages/`
- Package.json files from each package
- REQUIREMENTS.md for SRC-01 through SRC-12 mappings

### Secondary (MEDIUM confidence)
- Git behavior for `git mv` - standard git functionality

## Metadata

**Confidence breakdown:**
- Package mappings: HIGH - directly from requirements and file inspection
- File counts: HIGH - from `find` commands
- Directory structure: HIGH - from direct inspection
- Move strategy: HIGH - standard git operations

**Research date:** 2026-01-18
**Valid until:** Until Phase 40 completes (this is project-specific, not library research)
