# Codebase Structure

**Analysis Date:** 2026-01-08

## Directory Layout

```
BoardSmith/
├── packages/               # Monorepo packages
│   ├── engine/            # Core game framework
│   ├── runtime/           # Game execution
│   ├── session/           # Session management
│   ├── server/            # HTTP/WebSocket routing
│   ├── worker/            # Cloudflare Workers adapter
│   ├── client/            # Browser SDK
│   ├── ui/                # Vue 3 components
│   ├── cli/               # Development CLI
│   ├── ai/                # MCTS bot
│   ├── ai-trainer/        # Self-play training
│   ├── testing/           # Test utilities
│   ├── eslint-plugin/     # Sandbox rules
│   └── games/             # Game implementations
├── docs/                  # Documentation
├── .planning/             # Project planning
├── .boardsmith/           # Local dev storage
├── package.json           # Root workspace
├── pnpm-workspace.yaml    # Monorepo config
├── tsconfig.json          # TypeScript config
├── vitest.config.ts       # Test config
└── CLAUDE.md              # Claude Code instructions
```

## Directory Purposes

**packages/engine/**
- Purpose: Core game framework (Game, Element, Action, Flow, Command)
- Contains: TypeScript source with strict typing
- Key files: `src/index.ts` (228 exports), `src/element/game-element.ts` (738 lines)
- Subdirectories: action/, command/, element/, flow/, player/, sandbox/, scoring/, utils/

**packages/runtime/**
- Purpose: Game execution and state management
- Contains: GameRunner, serialization re-exports
- Key files: `src/runner.ts`, `src/index.ts`
- Subdirectories: None (flat structure)

**packages/session/**
- Purpose: Unified session API across platforms
- Contains: GameSession, AI controller, lobby types
- Key files: `src/game-session.ts` (2,585 lines), `src/ai-controller.ts`, `src/types.ts`
- Subdirectories: None

**packages/server/**
- Purpose: Platform-agnostic HTTP/WebSocket routing
- Contains: GameServerCore, handlers, game stores
- Key files: `src/core.ts`, `src/types.ts`
- Subdirectories: handlers/, stores/

**packages/worker/**
- Purpose: Cloudflare Workers deployment adapter
- Contains: Durable Objects, KV bindings
- Key files: `src/index.ts`
- Subdirectories: None

**packages/client/**
- Purpose: Browser SDK for game connections
- Contains: MeepleClient, GameConnection, audio
- Key files: `src/client.ts`, `src/game-connection.ts`, `src/audio.ts`
- Subdirectories: None

**packages/ui/**
- Purpose: Vue 3 component library
- Contains: GameShell, ActionPanel, AutoUI, composables
- Key files: `src/components/GameShell.vue`, `src/composables/useActionController.ts`
- Subdirectories: components/, composables/, animation/, assets/

**packages/cli/**
- Purpose: Development tooling (`boardsmith` command)
- Contains: CLI commands, local server, templates
- Key files: `src/cli.ts`, `src/commands/dev.ts`, `src/local-server.ts`
- Subdirectories: commands/, lib/, utils/, templates/

**packages/ai/**
- Purpose: MCTS bot for AI opponents
- Contains: Monte Carlo Tree Search implementation
- Key files: `src/mcts-bot.ts` (786 lines), `src/types.ts`
- Subdirectories: None

**packages/ai-trainer/**
- Purpose: Self-play training and code generation
- Contains: Trainer, simulator, feature generator
- Key files: `src/trainer.ts`, `src/simulator.ts`, `src/code-generator.ts`
- Subdirectories: None

**packages/testing/**
- Purpose: Test utilities for game developers
- Contains: Fixtures, assertions, debug helpers
- Key files: `src/test-game.ts`, `src/assertions.ts`, `src/debug.ts`
- Subdirectories: None

**packages/games/**
- Purpose: Game implementations (nested workspaces)
- Contains: go-fish, checkers, cribbage, hex, polyhedral-potions, floss-bitties
- Structure per game:
  - `rules/src/` - Game class, elements, actions, flow
  - `ui/src/` - Vue components (App.vue)
  - `tests/` - Game-specific tests
  - `boardsmith.json` - Game metadata

## Key File Locations

**Entry Points:**
- `packages/cli/src/cli.ts` - CLI entry point
- `packages/server/src/index.ts` - Server exports
- `packages/client/src/index.ts` - Browser SDK exports
- `packages/engine/src/index.ts` - Framework exports

**Configuration:**
- `tsconfig.json` - Root TypeScript config (strict mode)
- `vitest.config.ts` - Test runner config
- `pnpm-workspace.yaml` - Monorepo workspace definition
- `packages/games/*/boardsmith.json` - Per-game config

**Core Logic:**
- `packages/engine/src/element/game-element.ts` - Base element class
- `packages/engine/src/action/action.ts` - Action builder (1,845 lines)
- `packages/engine/src/flow/engine.ts` - Flow execution (968 lines)
- `packages/session/src/game-session.ts` - Session management (2,585 lines)

**Testing:**
- `packages/*/tests/*.test.ts` - Per-package tests
- `packages/games/*/tests/*.test.ts` - Game-specific tests
- `packages/testing/src/` - Shared test utilities

**Documentation:**
- `docs/` - User documentation (architecture, core-concepts, patterns)
- `CLAUDE.md` - Claude Code instructions

## Naming Conventions

**Files:**
- kebab-case.ts: TypeScript modules (`game-element.ts`, `action-helpers.ts`)
- kebab-case.vue: Vue components (`GameShell.vue`, `ActionPanel.vue`)
- PascalCase.vue: Component directories use PascalCase internally
- *.test.ts: Test files alongside source

**Directories:**
- Lowercase with hyphens: `ai-trainer/`, `eslint-plugin/`
- Plural for collections: `games/`, `components/`, `composables/`
- Singular for concepts: `engine/`, `runtime/`, `session/`

**Special Patterns:**
- `index.ts` - Barrel exports for package public API
- `types.ts` - TypeScript interfaces and types
- `src/` - Source code directory

## Where to Add New Code

**New Feature (in engine):**
- Primary code: `packages/engine/src/{feature}/`
- Tests: `packages/engine/tests/{feature}.test.ts`
- Export from: `packages/engine/src/index.ts`

**New Game:**
- Implementation: `packages/games/{game-name}/`
- Rules: `packages/games/{game-name}/rules/src/`
- UI: `packages/games/{game-name}/ui/src/`
- Tests: `packages/games/{game-name}/tests/`
- Config: `packages/games/{game-name}/boardsmith.json`

**New UI Component:**
- Implementation: `packages/ui/src/components/{ComponentName}.vue`
- Composable: `packages/ui/src/composables/use{Feature}.ts`
- Export from: `packages/ui/src/index.ts`

**New CLI Command:**
- Implementation: `packages/cli/src/commands/{command-name}.ts`
- Register in: `packages/cli/src/cli.ts`

**Utilities:**
- Engine utilities: `packages/engine/src/utils/`
- CLI utilities: `packages/cli/src/utils/`
- Test utilities: `packages/testing/src/`

## Special Directories

**.boardsmith/**
- Purpose: Local development storage
- Source: Created by `boardsmith dev` command
- Contains: `games.db` (SQLite, when `--persist` flag used)
- Committed: No (gitignored)

**dist/**
- Purpose: Build output
- Source: Generated by `pnpm build`
- Committed: No (gitignored)

**node_modules/**
- Purpose: Dependencies
- Source: pnpm install
- Committed: No (gitignored)

---

*Structure analysis: 2026-01-08*
*Update when directory structure changes*
