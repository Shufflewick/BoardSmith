# Phase 46: Documentation - Research

**Researched:** 2026-01-19
**Domain:** Documentation updates for collapsed monorepo (v2.0)
**Confidence:** HIGH

## Summary

This research identifies what documentation needs updating for the BoardSmith v2.0 collapsed monorepo structure. The change is straightforward: all `@boardsmith/*` package imports become `boardsmith` or `boardsmith/*` subpath imports.

Across 16 documentation files, there are approximately 85 import statements using the old `@boardsmith/*` syntax. The mapping is mechanical: `@boardsmith/engine` becomes `boardsmith`, `@boardsmith/ui` becomes `boardsmith/ui`, and so on. Additionally, new API reference pages need to be created (none exist yet), and a migration guide needs to be written for the MERC team.

**Primary recommendation:** Create a find-and-replace mapping table, update all imports systematically, then create the 11 API reference pages and migration guide.

## Standard Stack

This is a documentation-only phase. No libraries needed.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Markdown | N/A | Documentation format | Already used throughout docs/ |

### Tools
The documentation updates are text transformations. No build tools needed.

## Architecture Patterns

### Recommended Documentation Structure

Current:
```
docs/
├── README.md              # Main index
├── getting-started.md     # Entry point for new users
├── core-concepts.md       # Element tree, visibility, actions
├── actions-and-flow.md    # Action builder, flow system
├── ui-components.md       # Vue components, composables
├── ai-system.md           # MCTS bot, AI integration
├── [8 more topic guides]
└── (no api/ folder yet)
```

After this phase:
```
docs/
├── README.md              # Updated index with new imports
├── getting-started.md     # Updated with boardsmith imports
├── migration-guide.md     # NEW: MERC team migration
├── [existing topic guides with updated imports]
└── api/                   # NEW: API reference by subpath
    ├── index.md           # Root (boardsmith)
    ├── ui.md              # boardsmith/ui
    ├── session.md         # boardsmith/session
    ├── testing.md         # boardsmith/testing
    ├── eslint-plugin.md   # boardsmith/eslint-plugin
    ├── ai.md              # boardsmith/ai
    ├── ai-trainer.md      # boardsmith/ai-trainer
    ├── client.md          # boardsmith/client
    ├── server.md          # boardsmith/server
    ├── runtime.md         # boardsmith/runtime
    └── worker.md          # boardsmith/worker
```

### Import Mapping Pattern

Old import path to new import path:

| Old Package | New Subpath | Notes |
|-------------|-------------|-------|
| `@boardsmith/engine` | `boardsmith` | Root export |
| `@boardsmith/ui` | `boardsmith/ui` | Vue components, composables |
| `@boardsmith/session` | `boardsmith/session` | GameSession, adapters |
| `@boardsmith/testing` | `boardsmith/testing` | Test utilities |
| `@boardsmith/eslint-plugin` | `boardsmith/eslint-plugin` | Linting rules |
| `@boardsmith/ai` | `boardsmith/ai` | MCTS bot |
| `@boardsmith/ai-trainer` | `boardsmith/ai-trainer` | Training utilities |
| `@boardsmith/client` | `boardsmith/client` | Browser SDK |
| `@boardsmith/server` | `boardsmith/server` | HTTP/WS handlers |
| `@boardsmith/runtime` | `boardsmith/runtime` | Game runner |
| `@boardsmith/worker` | `boardsmith/worker` | Cloudflare Workers |
| `@boardsmith/ui/animation/drag-drop.css` | `boardsmith/ui/animation/drag-drop.css` | CSS asset |
| `@boardsmith/ui/animation/card-flip.css` | `boardsmith/ui/animation/card-flip.css` | CSS asset |

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Import transformation | Manual editing per file | Find/replace with mapping | Mechanical, error-prone |
| API documentation | Custom doc generator | Manual extraction from index.ts | 11 files, well-structured exports |

## Common Pitfalls

### Pitfall 1: Inconsistent Import Style
**What goes wrong:** Some imports updated, others missed
**Why it happens:** Manual editing across 16 files
**How to avoid:** Process all files systematically, verify with grep afterward
**Warning signs:** `grep "@boardsmith/" docs/` returns results after update

### Pitfall 2: Breaking Code Examples
**What goes wrong:** Updating imports but breaking the example logic
**Why it happens:** Over-editing during import replacement
**How to avoid:** Only change the import line, not surrounding code
**Warning signs:** Code examples that don't make sense syntactically

### Pitfall 3: Missing API Reference Pages
**What goes wrong:** Creating pages but forgetting some subpaths
**Why it happens:** 11 subpaths is easy to miscount
**How to avoid:** Create from definitive list in package.json exports
**Warning signs:** Subpath works but has no documentation

### Pitfall 4: Migration Guide Too Generic
**What goes wrong:** Writing for "any user" instead of MERC team
**Why it happens:** Tendency toward completeness
**How to avoid:** Focus on exact commands, copy-paste ready
**Warning signs:** Explanatory paragraphs instead of command sequences

## Code Examples

### Import Update Examples

Before:
```typescript
import { Card as BaseCard, Piece as BasePiece } from '@boardsmith/engine';
import { useBoardInteraction } from '@boardsmith/ui';
import { createBot } from '@boardsmith/ai';
import { createTestGame } from '@boardsmith/testing';
import '@boardsmith/ui/animation/drag-drop.css';
```

After:
```typescript
import { Card as BaseCard, Piece as BasePiece } from 'boardsmith';
import { useBoardInteraction } from 'boardsmith/ui';
import { createBot } from 'boardsmith/ai';
import { createTestGame } from 'boardsmith/testing';
import 'boardsmith/ui/animation/drag-drop.css';
```

### API Reference Page Template

```markdown
# boardsmith/[subpath]

> [One-line description of when to use this subpath]

## When to Use

[2-3 sentences on the use case for this subpath]

## Installation

This subpath is available as part of the `boardsmith` package:

\`\`\`bash
npm install boardsmith
\`\`\`

## Usage

\`\`\`typescript
import { [main exports] } from 'boardsmith/[subpath]';
\`\`\`

## Exports

### Classes
- `ClassName` - [description]

### Functions
- `functionName()` - [description]

### Types
- `TypeName` - [description]

## Examples

[Usage example with complete code]

## See Also

- [Related doc page](./link.md)
```

### Migration Guide Structure (MERC Team)

```markdown
# Migration Guide: v1.x to v2.0

## Overview

BoardSmith 2.0 consolidates all `@boardsmith/*` packages into a single `boardsmith` package with subpath exports.

## Step 1: Update package.json

Remove all `@boardsmith/*` dependencies and add `boardsmith`:

\`\`\`json
{
  "dependencies": {
-   "@boardsmith/engine": "^1.x",
-   "@boardsmith/ui": "^1.x",
-   "@boardsmith/session": "^1.x"
+   "boardsmith": "^2.0.0"
  }
}
\`\`\`

## Step 2: Update Imports

Find and replace these import paths:

| Find | Replace |
|------|---------|
| `from '@boardsmith/engine'` | `from 'boardsmith'` |
| `from '@boardsmith/ui'` | `from 'boardsmith/ui'` |
| [etc.] |

## Step 3: Reinstall

\`\`\`bash
rm -rf node_modules package-lock.json
npm install
\`\`\`

## Step 4: Verify

\`\`\`bash
npm run build
npm test
\`\`\`
```

## Inventory: Files Requiring Updates

### Documentation Files with @boardsmith/* Imports

| File | Import Count | Packages Used |
|------|-------------|---------------|
| `docs/getting-started.md` | 3 | engine, ui |
| `docs/core-concepts.md` | 3 | engine, session |
| `docs/actions-and-flow.md` | 4 | engine |
| `docs/dice-and-scoring.md` | 8 | engine, ui |
| `docs/ui-components.md` | 27 | ui, session |
| `docs/custom-ui-guide.md` | 10 | ui |
| `docs/component-showcase.md` | 7 | ui |
| `docs/ai-system.md` | 5 | ai, session |
| `docs/common-pitfalls.md` | 5 | engine, ui, testing |
| `docs/element-enrichment.md` | 2 | ui |
| `docs/llm-overview.md` | 3 | engine, ai |
| `docs/README.md` | 1 | (text reference, not import) |
| `docs/architecture.md` | 0 | (diagram references, may need update) |

**Total: ~85 import statements across 12 files**

### Files Needing Creation

| File | Purpose |
|------|---------|
| `docs/api/index.md` | Root boardsmith exports |
| `docs/api/ui.md` | boardsmith/ui exports |
| `docs/api/session.md` | boardsmith/session exports |
| `docs/api/testing.md` | boardsmith/testing exports |
| `docs/api/eslint-plugin.md` | boardsmith/eslint-plugin exports |
| `docs/api/ai.md` | boardsmith/ai exports |
| `docs/api/ai-trainer.md` | boardsmith/ai-trainer exports |
| `docs/api/client.md` | boardsmith/client exports |
| `docs/api/server.md` | boardsmith/server exports |
| `docs/api/runtime.md` | boardsmith/runtime exports |
| `docs/api/worker.md` | boardsmith/worker exports |
| `docs/migration-guide.md` | MERC team migration steps |

**Total: 12 new files**

## Subpath Export Inventory

Summary of what each subpath exports (from index.ts files):

### Root (`boardsmith`)
- **Element system:** GameElement, Space, Piece, Card, Hand, Deck, Die, DicePool, Grid, HexGrid, Game, ElementCollection
- **Player system:** Player, AbilityManager
- **Scoring:** Track, MonotonicTrack, UniqueTrack, CounterTrack
- **Command system:** executeCommand, undoCommand, visibility utilities
- **Action system:** Action, ActionExecutor, filter helpers, actionTempState
- **Flow system:** FlowEngine, sequence, loop, eachPlayer, actionStep, etc.
- **Utilities:** serialization, snapshots, replays, dev state

### UI (`boardsmith/ui`)
- **Components:** GameShell, AutoUI, GameLobby, ActionPanel, DebugPanel, Die3D, overlays
- **Composables:** useBoardInteraction, useDragDrop, useAutoAnimations, 20+ others
- **Utilities:** grid helpers, card display, theming

### Session (`boardsmith/session`)
- **Core:** GameSession, AIController, CheckpointManager
- **Types:** GameDefinition, GameConfig, StorageAdapter, BroadcastAdapter
- **Utilities:** generateGameId, player colors

### Testing (`boardsmith/testing`)
- **Core:** TestGame, createTestGame
- **Simulation:** simulateAction, simulateRandomGames
- **Assertions:** assertFlowState, assertPlayerHas, assertActionAvailable
- **Debug:** toDebugString, traceAction, visualizeFlow

### AI (`boardsmith/ai`)
- **Core:** createBot, MCTSBot, parseAILevel
- **Config:** DIFFICULTY_PRESETS, DEFAULT_CONFIG

### AI Trainer (`boardsmith/ai-trainer`)
- **Training:** ParallelTrainer, WeightEvolver
- **Introspection:** introspectGame, estimateComplexity
- **Features:** generateCandidateFeatures, FEATURE_TEMPLATES
- **Simulation:** runSimulations, runParallelSimulations
- **Analysis:** analyzeFeatures, selectTopFeatures
- **Code gen:** generateAICode, updateAIWeights

### Client (`boardsmith/client`)
- **Core:** MeepleClient, GameConnection
- **Audio:** audioService

### Server (`boardsmith/server`)
- **Core:** GameServerCore
- **Stores:** InMemoryGameStore, SqliteGameStore, matchmaking stores
- **Handlers:** game handlers, matchmaking handlers

### Runtime (`boardsmith/runtime`)
- **Core:** GameRunner
- **Re-exports:** serialization, snapshots, replays from engine

### Worker (`boardsmith/worker`)
- **Core:** createGameWorker, createGameStateDurableObject, buildRegistries
- **Types:** Cloudflare-specific types

### ESLint Plugin (`boardsmith/eslint-plugin`)
- **Plugin:** default export with rules and configs
- **Rules:** no-network, no-filesystem, no-timers, no-nondeterministic, no-eval

## Open Questions

None - the scope is well-defined and the transformation is mechanical.

## Sources

### Primary (HIGH confidence)
- `/Users/jtsmith/board_game_service/BoardSmith/package.json` - Definitive list of subpath exports
- `/Users/jtsmith/board_game_service/BoardSmith/src/*/index.ts` - Each subpath's exports
- `/Users/jtsmith/board_game_service/BoardSmith/docs/*.md` - Current documentation state

### Secondary (MEDIUM confidence)
- `.planning/phases/46-documentation/46-CONTEXT.md` - User decisions from discuss phase

## Metadata

**Confidence breakdown:**
- Import mapping: HIGH - directly from package.json exports field
- File inventory: HIGH - grep results are definitive
- Export inventory: HIGH - read directly from index.ts files
- API page structure: MEDIUM - based on common patterns, user has discretion

**Research date:** 2026-01-19
**Valid until:** Until v2.0 ships or exports change
