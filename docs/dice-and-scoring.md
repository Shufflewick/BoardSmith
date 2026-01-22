# Dice & Scoring Systems

BoardSmith provides comprehensive support for dice games and roll-and-write style scoring. This document covers the engine's dice elements, 3D dice rendering, ability management, and scoring track systems.

## Dice Elements

### Die

The base `Die` class extends `Piece` with dice-specific properties:

```typescript
import { Die } from 'boardsmith';

class MyDie extends Die<MyGame, MyPlayer> {
  // Inherited properties:
  // sides: number - Number of faces (4, 6, 8, 10, 12, 20)
  // value: number - Current face value

  // Add custom properties
  color?: 'red' | 'blue' | 'green';
}
```

#### Die Sides

The engine supports standard polyhedral dice:

| Type | Geometry | Values |
|------|----------|--------|
| D4 | Tetrahedron | 1-4 |
| D6 | Cube | 1-6 |
| D8 | Octahedron | 1-8 |
| D10 | Trapezohedron | 0-9 or 1-10 |
| D12 | Dodecahedron | 1-12 |
| D20 | Icosahedron | 1-20 |

### DicePool

A `DicePool` is a `Space` designed to hold multiple dice:

```typescript
import { DicePool, Die } from 'boardsmith';

class MyGame extends Game<MyGame, MyPlayer> {
  shelf!: DicePool;

  constructor(options: GameOptions) {
    super(options);

    this.registerElements([DicePool, MyDie]);

    // Create the dice pool
    this.shelf = this.create(DicePool, 'shelf');

    // Create dice inside the pool
    this.shelf.create(MyDie, 'd6-1', { sides: 6 });
    this.shelf.create(MyDie, 'd6-2', { sides: 6 });
    this.shelf.create(MyDie, 'd8-1', { sides: 8 });
  }
}
```

### Rolling Dice

Use the `roll()` method to roll dice. It:
- Uses `game.random()` internally (seeded, reproducible)
- Increments `rollCount` to trigger UI animations
- Returns the rolled value

```typescript
const rollAction = Action.create('roll')
  .prompt('Roll all dice')
  .execute((args, ctx) => {
    const dice = ctx.game.shelf.all(MyDie);
    let total = 0;
    for (const die of dice) {
      const rolled = die.roll();  // Returns value, triggers animation
      total += rolled;
    }
    ctx.game.message(`Rolled ${total}!`);
    return { success: true };
  });
```

For a single die:
```typescript
const die = ctx.game.shelf.first(Die);
const rolled = die.roll();  // Returns 1-6 for d6
ctx.game.message(`You rolled a ${rolled}!`);
```

### Common Mistakes

#### Mistake 1: Calling roll() but ignoring the return value

```typescript
// WRONG - value is lost, you can't know what was rolled
die.roll();
game.message(`Rolled... something?`);

// CORRECT - capture the returned value
const rolled = die.roll();
game.message(`Rolled ${rolled}!`);
```

#### Mistake 2: Using Math.random() instead of roll()

```typescript
// WRONG - not seeded, breaks replay and determinism
const value = Math.floor(Math.random() * 6) + 1;
die.setValue(value);

// CORRECT - roll() is seeded and returns the value
const value = die.roll();
```

#### Mistake 3: Calling both roll() and setValue()

```typescript
// WRONG - roll() already set a value, then you overwrite it
// This causes the die to briefly show one value, then change
die.roll();
die.setValue(someOtherValue);

// CORRECT - use one or the other based on intent
const rolled = die.roll();  // For normal random rolling

// OR for abilities that set specific values:
die.setValue(6);  // "Set die to maximum"
die.setValue(die.getOpposite());  // "Flip to opposite face"
```

#### Die Methods

| Method | Description |
|--------|-------------|
| `roll()` | Roll and return value (uses seeded random, triggers animation) |
| `setValue(n)` | Set to specific value (for abilities like "flip to opposite") |
| `getOpposite()` | Get the opposite face value |

#### Important: Never use Math.random()

```typescript
// WRONG - breaks determinism and replay!
die.value = Math.floor(Math.random() * die.sides) + 1;

// CORRECT - use the roll() method
const rolled = die.roll();
```

For other randomness needs (not dice), use `game.random()`:
```typescript
// Seeded random 0-1 (like Math.random but reproducible)
const randomIndex = Math.floor(game.random() * array.length);
```

## 3D Dice UI

The `boardsmith/ui` package includes a WebGL-based 3D dice renderer that displays accurate polyhedral geometry with smooth roll animations.

### Die3D Component

```vue
<script setup lang="ts">
import { Die3D } from 'boardsmith/ui';

const props = defineProps<{
  die: {
    id: string;
    sides: number;
    value: number;
  };
}>();
</script>

<template>
  <Die3D
    :die-id="die.id"
    :sides="die.sides"
    :value="die.value"
    :size="80"
    style="--die-color: #2196F3"
  />
</template>
```

#### Props

| Prop | Type | Description |
|------|------|-------------|
| `dieId` | `string` | Unique identifier for the die |
| `sides` | `4 \| 6 \| 8 \| 10 \| 12 \| 20` | Number of faces |
| `value` | `number` | Current face value to display |
| `size` | `number` | Size in pixels (default: 60) |

#### CSS Custom Properties

Style dice using CSS variables:

```css
.my-die {
  --die-color: #FF5722;           /* Face color */
  --die-pip-color: #FFFFFF;       /* Number/pip color */
  --die-edge-color: #333333;      /* Edge color */
}
```

### Roll Animations

The Die3D component animates when `rollCount` changes. The `roll()` method automatically increments this, so animations happen automatically when you call `die.roll()`.

Pass `rollCount` to the Die3D component:

```vue
<Die3D
  :die-id="die.id"
  :sides="die.attributes.sides"
  :value="die.attributes.value"
  :roll-count="die.attributes.rollCount"
  :size="80"
/>
```

The animation is triggered by changes to `rollCount`, not `value`. This ensures:
- Rolling to the same value still animates
- Setting a value directly (like for abilities) doesn't animate

### Zoom Preview

Enable Alt+hover zoom by adding `data-die-preview` attribute:

```vue
<template>
  <div
    class="die-slot"
    :data-die-preview="JSON.stringify({ sides: die.sides, value: die.value })"
  >
    <Die3D :die-id="die.id" :sides="die.sides" :value="die.value" />
  </div>
</template>
```

The zoom preview provides a larger, centered view of the die for accessibility.

## Ability System

The `AbilityManager` provides a reusable system for games where players earn and use special abilities/powers. Common in dice games with unlockable abilities.

### Basic Usage

```typescript
import { AbilityManager, Player } from 'boardsmith';

// Define your ability types
type MyAbility = 'reroll' | 'flip' | 'bonus' | 'skip';

class MyPlayer extends Player<MyGame, MyPlayer> {
  abilities = new AbilityManager<MyAbility>();

  constructor(seat: number, name: string) {
    super(seat, name);
    // Give each player a starting ability
    this.abilities.add('reroll', 'starting');
  }

  // Override needed for AbilityManager because it has its own toJSON() method
  override toJSON() {
    const json = super.toJSON();
    json.attributes.abilities = this.abilities.toJSON();
    return json;
  }
}
```

### AbilityManager API

```typescript
const abilities = new AbilityManager<MyAbility>();

// Adding abilities
abilities.add('reroll');                    // Add an ability
abilities.add('reroll', 'from-track');      // With source description

// Checking abilities
abilities.hasUnused('reroll');              // Has unused ability?
abilities.has('reroll');                    // Has any (used or unused)?
abilities.countUnused('reroll');            // Count unused of type
abilities.countAllUnused();                 // Total unused count

// Using abilities
if (abilities.hasUnused('reroll')) {
  abilities.use('reroll');                  // Marks one as used
}

// Querying
abilities.getAll();                         // All abilities
abilities.getUnused();                      // Only unused
abilities.getUsed();                        // Only used
abilities.getTypes();                       // Unique types ['reroll', 'flip']
abilities.getGrouped();                     // [{ type, total, unused }]

// Management
abilities.resetAll();                       // Reset all to unused
abilities.clear();                          // Remove all

// Serialization
const data = abilities.toJSON();
abilities.fromJSON(data);
AbilityManager.fromJSON(data);              // Static factory
```

## Scoring Tracks

BoardSmith provides abstract track classes for dice/roll-and-write games where players record values on scoring sheets.

### Track Types

| Class | Use Case | Example |
|-------|----------|---------|
| `Track` | Base class | - |
| `MonotonicTrack` | Increasing or decreasing sequences | Distillation, Fulminate |
| `UniqueTrack` | No duplicate values allowed | Yahtzee upper section |
| `CounterTrack` | Simple count/tally | Poison skulls, bonus boxes |

### MonotonicTrack

For tracks where values must increase or decrease:

```typescript
import { MonotonicTrack } from 'boardsmith';

// Increasing track (values must go up)
const fulminateTrack = new MonotonicTrack({
  id: 'fulminate',
  name: 'Fulminate',
  direction: 'increasing',
  maxEntries: 10,
  pointsPerEntry: [0, 1, 3, 6, 11, 16, 23, 30, 40, 50],
  completionBonus: 65,
});

// Decreasing track (values must go down)
const distillTrack = new MonotonicTrack({
  id: 'distill-1',
  name: 'Distillation Column 1',
  direction: 'decreasing',
  maxEntries: 5,
  pointsPerEntry: [0, -10, -5, -2, 10],
  completionBonus: 25,
  allowSpecialEntries: true,  // Special entries can equal previous
});
```

#### API

```typescript
// Check if a value can be added
track.canAdd(15);                    // Returns true/false
track.canAdd(15, isSpecial);         // With special entry flag

// Add a value (returns points earned)
const points = track.add(15);

// Query state
track.getEntries();                  // [{ value, points, special }]
track.isEmpty();
track.isComplete();
track.calculatePoints();             // Total including completion bonus

// Serialization
const data = track.toJSON();
track.fromJSON(data);
```

### UniqueTrack

For tracks where each value can only appear once:

```typescript
import { UniqueTrack } from 'boardsmith';

const upperSection = new UniqueTrack({
  id: 'ones',
  name: 'Ones',
  maxEntries: 1,
  pointsPerEntry: (value) => value,  // Function-based points
});

// Will reject if value already used
upperSection.canAdd(3);  // true (first time)
upperSection.add(3);
upperSection.canAdd(3);  // false (already used)
```

### CounterTrack

For simple counting/tallying:

```typescript
import { CounterTrack } from 'boardsmith';

const poisonTrack = new CounterTrack({
  id: 'poison',
  name: 'Poison',
  maxEntries: 6,
  pointsPerCount: 2,       // 2 points per mark
  completionBonus: 10,     // Bonus for filling all 6
});

// Increment the counter
poisonTrack.increment();
poisonTrack.increment();

// Query
poisonTrack.count;         // 2
poisonTrack.isComplete();  // false
poisonTrack.calculatePoints();  // 4 (2 * 2)
```

## Example: Dice Game Player

Here's a complete example combining dice, abilities, and tracks:

```typescript
import {
  Player,
  AbilityManager,
  MonotonicTrack,
  CounterTrack
} from 'boardsmith';

type PowerUp = 'reroll-2' | 'flip' | 'refresh' | 'adjust';

class DiceGamePlayer extends Player<DiceGame, DiceGamePlayer> {
  abilities: AbilityManager<PowerUp>;
  scoreTrack: MonotonicTrack;
  bonusTrack: CounterTrack;

  constructor(seat: number, name: string) {
    super(seat, name);

    // Initialize ability manager
    this.abilities = new AbilityManager<PowerUp>();
    this.abilities.add('reroll-2', 'starting');

    // Initialize scoring tracks
    this.scoreTrack = new MonotonicTrack({
      id: 'score',
      name: 'Score',
      direction: 'increasing',
      maxEntries: 10,
      pointsPerEntry: [1, 2, 3, 5, 8, 13, 21, 34, 55, 89],
    });

    this.bonusTrack = new CounterTrack({
      id: 'bonus',
      name: 'Bonus Stars',
      maxEntries: 5,
      pointsPerCount: 10,
    });
  }

  get totalScore(): number {
    return this.scoreTrack.calculatePoints() + this.bonusTrack.calculatePoints();
  }

  // Override needed for objects with toJSON() methods (AbilityManager, tracks)
  override toJSON() {
    const json = super.toJSON();
    json.attributes.totalScore = this.totalScore;
    json.attributes.abilities = this.abilities.toJSON();
    json.attributes.scoreTrack = this.scoreTrack.toJSON();
    json.attributes.bonusTrack = this.bonusTrack.toJSON();
    return json;
  }
}
```

## Related Documentation

- [Core Concepts](./core-concepts.md) - Element tree and game structure
- [UI Components](./ui-components.md) - Vue components and composables
- [Actions & Flow](./actions-and-flow.md) - Building game actions
- [Game Examples](./game-examples.md) - Complete game implementations
