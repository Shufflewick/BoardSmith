# boardsmith/eslint-plugin

> ESLint rules for game code determinism.

## When to Use

These rules are the single source of truth for the BoardSmith sandbox guardrails (no network, no filesystem, no timers, no non-determinism, no eval). They are run automatically by the CLI:

- `boardsmith lint` and `boardsmith validate` execute this plugin's AST rules across **all** of `src/` (rules, UI `.vue` components, and shared helpers) — not just `src/rules`. `validate` also runs as part of `boardsmith publish`, so a `Math.random()` or `fetch()` anywhere reachable from game state fails the build.
- Scaffolded games get a `lint` script (`npx boardsmith lint`) wired in by default, so no per-game ESLint config is required.

Import from `boardsmith/eslint-plugin` directly only if you want the same rules inside your editor's ESLint integration or your own `eslint.config.js`.

## Usage

```javascript
// eslint.config.js
import boardsmithPlugin from 'boardsmith/eslint-plugin';

export default [
  // Lets ESLint lint TypeScript and Vue files; add your parser here.
  { files: ['src/**/*.ts', 'src/**/*.vue'] },
  ...boardsmithPlugin.configs.recommended,
];
```

This is the same configuration `boardsmith lint` and `boardsmith validate` run, so your editor reports exactly what they do.

## Exports

### Default Export

- `default` - ESLint plugin with rules and configs

### Named Exports

- `rules` - Individual rules object
- `configs` - Configuration presets
- `ruleGroups` - Every rule, grouped by what it guards (`security`, `determinism`, `identity`, `silence`, `ownership`). `configs.recommended` and `boardsmith validate` are built from it

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

### no-engine-field-shadow

Disallows a Game subclass from using the name of a field the engine owns on
every Game: `pile`, `random`, `phase`, `settings`, `messages`,
`commandHistory`, `tutorialProgress`, `tutorialDefinition`, and the internal
`_`-prefixed fields. The full list is `ENGINE_OWNED_GAME_FIELDS` in
`src/engine/element/engine-owned-fields.ts`.

**Why:** The engine sets those fields and rebuilds them on every save, restore,
undo and bot search. A game's own value under one of those names works in a
fresh game and is silently replaced after the first restore.

It reports a field (including `declare`), method or accessor with that name in
a class that extends `Game` (or a same-file subclass of one), and an assignment
`this.<name> = ...` inside it. Reading or mutating an engine field
(`this.settings.variant = 'short'`, `this.pile.all()`) is not reported.

```typescript
// Bad
class MyGame extends Game {
  pile!: Pile; // Error: MyGame uses the name "pile", which the BoardSmith engine already uses ...
}

// Good
class MyGame extends Game {
  discardPile!: Pile;
}
```

The engine checks the same thing at runtime: every engine path builds a game
through `constructGame`, which refuses a game whose class changed one of the
engine fields it can check, with the same message.

## Configuration Presets

### recommended

An array of two flat-config blocks; spread it into your config array:

1. `boardsmith/recommended` registers the plugin and turns every rule on at error level.
2. `boardsmith/recommended-ui` turns the `determinism` group (`no-timers`, `no-nondeterministic`) off for `src/ui/**`. UI code runs in the browser, never in the executor, so timers and randomness there are legitimate.

## Examples

### Full ESLint Configuration

```javascript
// eslint.config.js
import tseslint from 'typescript-eslint';
import boardsmithPlugin from 'boardsmith/eslint-plugin';

export default tseslint.config(
  // Base TypeScript config
  ...tseslint.configs.recommended,

  // Every BoardSmith rule, with the determinism rules off under src/ui/
  ...boardsmithPlugin.configs.recommended,
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
