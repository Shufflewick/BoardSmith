# @boardsmith/cli

Command-line tools for BoardSmith game development. Provides commands for creating, developing, testing, and publishing board games.

## Installation

```bash
npm install -g @boardsmith/cli
# or use via npx
npx boardsmith <command>
```

## Commands

### init

Create a new BoardSmith game project:

```bash
npx boardsmith init my-game
npx boardsmith init my-game --template card-game
```

**Options:**
- `-t, --template <template>` - Template to use (default: card-game)

### dev

Start local development server with hot reload:

```bash
npx boardsmith dev
npx boardsmith dev --players 3
npx boardsmith dev --ai 1 --ai-level hard
```

**Options:**
- `-p, --port <port>` - UI server port (default: 5173)
- `--players <count>` - Number of player tabs to open (default: 2)
- `--worker-port <port>` - API server port (default: 8787)
- `--ai <players...>` - Player positions for AI (e.g., `--ai 1` or `--ai 0 2`)
- `--ai-level <level>` - AI difficulty: easy, medium, hard, or iteration count
- `--lobby` - Open game lobby instead of auto-creating a game
- `--persist [path]` - Persist games to SQLite (default: .boardsmith/games.db)
- `--debug` - Enable verbose logging of actions, flow, and commands

### test

Run game tests with Vitest:

```bash
npx boardsmith test
npx boardsmith test --watch
npx boardsmith test --coverage
```

**Options:**
- `-w, --watch` - Watch mode
- `--coverage` - Generate coverage report

### build

Build game for production:

```bash
npx boardsmith build
npx boardsmith build --out-dir dist
```

**Options:**
- `-o, --out-dir <dir>` - Output directory (default: dist)

### validate

Validate game before publishing:

```bash
npx boardsmith validate
npx boardsmith validate --skip-simulation
```

**Options:**
- `--fix` - Attempt to auto-fix issues
- `--skip-simulation` - Skip random game simulation

### lint

Check for common BoardSmith pitfalls:

```bash
npx boardsmith lint
```

**Options:**
- `--fix` - Attempt to auto-fix issues (coming soon)

### analyze

Analyze game complexity and structure:

```bash
npx boardsmith analyze
npx boardsmith analyze --verbose --json
```

**Options:**
- `--json` - Output as JSON
- `-v, --verbose` - Show detailed information

### build-ai

Train AI through self-play and generate ai.ts:

```bash
npx boardsmith build-ai
npx boardsmith build-ai --games 500 --iterations 10
```

**Options:**
- `-g, --games <count>` - Games per iteration (default: 200)
- `-i, --iterations <count>` - Training iterations (default: 5)
- `-o, --output <path>` - Output path for ai.ts
- `-m, --mcts <iterations>` - MCTS iterations per move (default: 3)
- `--fresh` - Ignore existing ai.ts
- `-v, --verbose` - Show detailed progress

### publish

Publish game to boardsmith.io:

```bash
npx boardsmith publish
npx boardsmith publish --dry-run
```

**Options:**
- `--dry-run` - Preview without uploading

### claude

Claude Code integration for AI-assisted game design:

```bash
# Install the /design-game slash command
npx boardsmith claude install
npx boardsmith claude install --local  # Current project only

# Uninstall
npx boardsmith claude uninstall
```

## Development Workflow

### 1. Create a new game

```bash
npx boardsmith init checkers
cd checkers
```

### 2. Start development

```bash
npx boardsmith dev
```

This opens:
- Player 1 browser tab at http://localhost:5173
- Player 2 browser tab at http://localhost:5173
- API server at http://localhost:8787

### 3. Test with AI

```bash
# Play against AI
npx boardsmith dev --ai 1 --ai-level hard

# Watch two AIs play
npx boardsmith dev --ai 0 1
```

### 4. Write and run tests

```bash
npx boardsmith test --watch
```

### 5. Validate before publishing

```bash
npx boardsmith validate
```

### 6. Train AI (optional)

```bash
npx boardsmith build-ai --verbose
```

### 7. Publish

```bash
npx boardsmith publish
```

## Project Structure

A BoardSmith project has this structure:

```
my-game/
├── rules/
│   ├── game.ts        # Game class definition
│   ├── actions.ts     # Action definitions
│   ├── flow.ts        # Game flow
│   └── ai.ts          # AI objectives (optional)
├── ui/
│   ├── App.vue        # Main UI component
│   └── components/    # Custom components
├── tests/
│   └── game.test.ts   # Game tests
├── package.json
└── boardsmith.config.ts
```

## Configuration

Create `boardsmith.config.ts` for custom settings:

```typescript
import { defineConfig } from '@boardsmith/cli';

export default defineConfig({
  game: {
    name: 'My Game',
    minPlayers: 2,
    maxPlayers: 4,
  },
  dev: {
    port: 3000,
    aiLevel: 'medium',
  },
});
```

## See Also

- [Getting Started Guide](../../docs/getting-started.md)
- [@boardsmith/ai](../ai/README.md) - AI bot
- [@boardsmith/ai-trainer](../ai-trainer/README.md) - AI training
