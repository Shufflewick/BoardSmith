# Coding Conventions

**Analysis Date:** 2026-01-08

## Naming Patterns

**Files:**
- kebab-case for all TypeScript files (`game-element.ts`, `action-helpers.ts`)
- *.test.ts for test files (co-located in `tests/` directory)
- index.ts for barrel exports

**Functions:**
- camelCase for all functions (`createTestGame`, `performAction`, `serializeValue`)
- No special prefix for async functions
- `handle*` for HTTP handlers (`handleAction`, `handleCreateGame`)

**Variables:**
- camelCase for variables
- UPPER_SNAKE_CASE for static class constants (`RANKS`, `SUITS`)
- `_` prefix for internal/private properties (`_ctx`, `_t`, `_visibility`)
- `$` prefix for system/rendering properties (`$type`, `$image`, `$images`)

**Types:**
- PascalCase for interfaces, no I prefix (`Player`, not `IPlayer`)
- PascalCase for type aliases (`GameOptions`, `ActionDefinition`)
- PascalCase for classes (`GameElement`, `ActionExecutor`)
- Generic pattern: `Game<TGame extends Game, TPlayer extends Player>`

## Code Style

**Formatting:**
- 2-space indentation
- Single quotes for strings in code
- Semicolons required
- No trailing commas enforced
- No Prettier/ESLint config detected (manual consistency)

**Linting:**
- Custom ESLint plugin for sandbox rules (`packages/eslint-plugin/`)
- Rules enforce: no-network, no-filesystem, no-timers, no-eval, no-nondeterministic
- CLI lint command: `boardsmith lint`

## Import Organization

**Order:**
1. External packages (vue, three, commander)
2. Internal packages (@boardsmith/engine, @boardsmith/runtime)
3. Relative imports (./utils, ../types)
4. Type imports (import type {...})

**Grouping:**
- Blank line between groups
- Type imports can be inline or separate

**Path Extensions:**
- ESM format requires `.js` extensions in imports
- Example: `import { Card } from './card.js'`

**Path Aliases:**
- `@boardsmith/*` for monorepo packages (configured in tsconfig)

## Error Handling

**Patterns:**
- Throw errors with descriptive messages
- Catch at boundaries (handlers, command executors)
- Early return for guard clauses

**Error Types:**
- Standard Error class with message
- No custom error classes detected
- Validation errors thrown before execution

## Logging

**Framework:**
- console.log, console.error (no structured logging)
- chalk for colored CLI output

**Patterns:**
- Log state transitions in CLI commands
- Debug logging in development mode
- No production logging service

## Comments

**When to Comment:**
- Explain why, not what
- Document business logic and game rules
- JSDoc for public APIs

**JSDoc/TSDoc:**
- Required for public API functions in engine
- Include @example blocks with TypeScript syntax
- Use @param, @returns tags

**TODO Comments:**
- Format: `// TODO: description`
- Found in: `packages/ai-trainer/src/code-generator.ts`, `packages/testing/src/assertions.ts`

## Function Design

**Size:**
- Keep functions focused (single responsibility)
- Large files exist but are organized by section

**Parameters:**
- Destructure objects in parameter list
- Use options objects for multiple parameters
- Generic type parameters for game/player types

**Return Values:**
- Explicit return statements
- Return early for guard clauses
- Use result types for action execution

## Module Design

**Exports:**
- Named exports preferred
- Barrel exports from index.ts
- Re-export from packages (engine → runtime → session)

**Barrel Files:**
- index.ts re-exports public API
- Keep internal helpers private
- ~228 exports in engine/src/index.ts

## Game-Specific Patterns

**Element Registration:**
```typescript
this.registerElements([Card, Hand, Deck, Books]);
const card = this.create(Card, 'card-1');
```

**Action Builder:**
```typescript
new Action(game)
  .setName('askForRank')
  .setCondition(() => game.currentPlayer === player)
  .addSelection('target', { type: 'element', ... })
  .setExecute(async (game, selections) => { ... });
```

**Flow Definition:**
```typescript
defineFlow(
  phase('setup', setupPhase()),
  turnLoop(eachPlayer(actionStep('playCard'))),
  phase('scoring', calculateScores())
);
```

**Visibility Control:**
```typescript
hand.contentsVisibleToOwner();    // Only owner sees
deck.contentsHidden();             // No one sees
element.setVisibility({ hidden: [1, 2] });
```

---

*Convention analysis: 2026-01-08*
*Update when patterns change*
