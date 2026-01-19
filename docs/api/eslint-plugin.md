# boardsmith/eslint-plugin

> ESLint rules for game code determinism.

## When to Use

Import from `boardsmith/eslint-plugin` when linting game rule code to ensure determinism. Board games must produce the same results given the same inputs, so this plugin catches common sources of non-determinism.

## Usage

```javascript
// eslint.config.js
import boardsmithPlugin from 'boardsmith/eslint-plugin';

export default [
  {
    files: ['src/games/**/*.ts'],
    plugins: {
      boardsmith: boardsmithPlugin,
    },
    rules: {
      'boardsmith/no-network': 'error',
      'boardsmith/no-filesystem': 'error',
      'boardsmith/no-timers': 'error',
      'boardsmith/no-nondeterministic': 'error',
      'boardsmith/no-eval': 'error',
    },
  },
];
```

## Exports

### Default Export

- `default` - ESLint plugin with rules and configs

### Named Exports

- `rules` - Individual rules object
- `configs` - Configuration presets

## Rules

### no-network

Disallows network access in game code.

**Why:** Network calls are inherently non-deterministic (latency, failures, different responses).

```typescript
// Bad
fetch('/api/data'); // Error: Network access is not allowed
new XMLHttpRequest(); // Error: Network access is not allowed
new WebSocket('ws://...'); // Error: Network access is not allowed

// Good
// Use game state and actions instead
this.draw(1);
```

### no-filesystem

Disallows filesystem access in game code.

**Why:** File contents can change between runs, breaking determinism.

```typescript
// Bad
import fs from 'fs';
fs.readFileSync('data.json'); // Error: Filesystem access is not allowed

// Good
// Define data in code or load at initialization
const CARD_DATA = [
  { rank: 'A', suit: 'hearts' },
  // ...
];
```

### no-timers

Disallows timers and time-based code in game logic.

**Why:** Time varies between runs. Game state should advance through actions, not time.

```typescript
// Bad
setTimeout(() => doThing(), 1000); // Error: Timers are not allowed
Date.now(); // Error: Current time is not allowed
new Date(); // Error: Current time is not allowed

// Good
// Use flow control for timing
sequence(
  actionStep({ name: 'play' }),
  execute(() => this.nextPhase()),
);
```

### no-nondeterministic

Disallows `Math.random()` and similar non-deterministic functions.

**Why:** Random results vary between runs. Use the seeded random provided by BoardSmith.

```typescript
// Bad
Math.random(); // Error: Use game's seeded random instead
crypto.getRandomValues(); // Error: Non-deterministic

// Good
// Use game's random (automatically seeded)
this.deck.shuffle(); // Uses seeded random internally
this.die.roll(); // Uses seeded random internally

// For custom random needs
const value = this.random(); // Returns seeded random 0-1
```

### no-eval

Disallows `eval()` and `Function()` constructor.

**Why:** Dynamic code execution is a security risk and breaks static analysis.

```typescript
// Bad
eval('doSomething()'); // Error: eval is not allowed
new Function('return x + y'); // Error: Function constructor is not allowed

// Good
// Define logic statically
function doSomething() {
  // ...
}
```

## Configuration Presets

### recommended

Enables all rules at error level.

```javascript
// eslint.config.js
import boardsmithPlugin from 'boardsmith/eslint-plugin';

export default [
  {
    files: ['src/games/**/*.ts'],
    ...boardsmithPlugin.configs.recommended,
  },
];
```

Equivalent to:

```javascript
{
  plugins: ['boardsmith'],
  rules: {
    'boardsmith/no-network': 'error',
    'boardsmith/no-filesystem': 'error',
    'boardsmith/no-timers': 'error',
    'boardsmith/no-nondeterministic': 'error',
    'boardsmith/no-eval': 'error',
  },
}
```

## Examples

### Full ESLint Configuration

```javascript
// eslint.config.js
import tseslint from 'typescript-eslint';
import boardsmithPlugin from 'boardsmith/eslint-plugin';

export default tseslint.config(
  // Base TypeScript config
  ...tseslint.configs.recommended,

  // Game code - strict determinism
  {
    files: ['src/games/**/game.ts', 'src/games/**/rules/**/*.ts'],
    plugins: {
      boardsmith: boardsmithPlugin,
    },
    rules: {
      'boardsmith/no-network': 'error',
      'boardsmith/no-filesystem': 'error',
      'boardsmith/no-timers': 'error',
      'boardsmith/no-nondeterministic': 'error',
      'boardsmith/no-eval': 'error',
    },
  },

  // UI code - less strict
  {
    files: ['src/games/**/ui/**/*.ts', 'src/games/**/ui/**/*.vue'],
    plugins: {
      boardsmith: boardsmithPlugin,
    },
    rules: {
      // UI can use timers for animations
      'boardsmith/no-timers': 'off',
      // But still no network/random in UI
      'boardsmith/no-network': 'error',
      'boardsmith/no-nondeterministic': 'error',
    },
  },
);
```

### Disabling Rules

```typescript
// Temporarily disable for a line
// eslint-disable-next-line boardsmith/no-timers
const now = Date.now(); // For logging only, not game logic

// Disable for a block
/* eslint-disable boardsmith/no-network */
// This code runs in UI, not game logic
await fetch('/api/leaderboard');
/* eslint-enable boardsmith/no-network */
```

### Common Patterns

```typescript
// BAD: Non-deterministic shuffle
cards.sort(() => Math.random() - 0.5);

// GOOD: Use deck's shuffle method
this.deck.shuffle();

// BAD: Random player selection
const firstPlayer = Math.floor(Math.random() * playerCount);

// GOOD: Use game's random
const firstPlayer = Math.floor(this.random() * playerCount);

// BAD: Time-based seed
const seed = Date.now().toString();

// GOOD: Use provided seed
// (GameSession provides deterministic seed automatically)

// BAD: Fetch card images
const cardImage = await fetch(`/cards/${card.id}.png`);

// GOOD: Reference static assets
const cardImage = `/cards/${card.id}.png`; // URL only, no fetch
```

## See Also

- [Common Pitfalls](../common-pitfalls.md) - Avoiding determinism issues
- [boardsmith](./index.md) - Core engine with seeded random
