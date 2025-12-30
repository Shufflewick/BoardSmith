# Common Pitfalls in BoardSmith

This guide documents common mistakes that cause hard-to-debug issues. Read this before starting your game implementation.

---

## 1. Object Reference Comparison (CRITICAL)

### The Problem

BoardSmith's `chooseElement` and element queries return **new object instances** each time. This means JavaScript's default equality checks will fail:

```typescript
// WRONG - This will ALWAYS be false!
const myCards = player.hand.all(Card);
const selectedCard = args.card as Card;
if (myCards.includes(selectedCard)) {
  // This code will NEVER run
}

// WRONG - Same problem
if (myCards.indexOf(selectedCard) !== -1) { ... }

// WRONG - Direct comparison fails too
if (card1 === card2) { ... }
```

### The Solution

Always compare elements by their `id` property:

```typescript
// CORRECT - Compare by ID
const myCards = player.hand.all(Card);
const selectedCard = args.card as Card;
if (myCards.some(c => c.id === selectedCard.id)) {
  // This works!
}

// CORRECT - Use the equals() helper
if (card1.equals(card2)) { ... }

// CORRECT - Use contains() on collections
if (myCards.contains(selectedCard)) { ... }

// CORRECT - Find by ID
const found = myCards.find(c => c.id === selectedCard.id);
```

### Why This Happens

BoardSmith serializes and deserializes game state for:
- Network synchronization between players
- Action replay and undo
- AI decision making
- State snapshots

Each deserialization creates new object instances with the same data but different memory addresses.

---

## 2. Multi-Step Selection Filters

### The Problem

When an action has multiple selections, BoardSmith evaluates **all filters during the availability check**, even for selections the player hasn't made yet. The previous selection will be `undefined`:

```typescript
// WRONG - crashes when squad is undefined during availability check
Action.create('move')
  .chooseElement<Squad>('squad', { ... })
  .chooseElement<Sector>('destination', {
    filter: (sector, ctx) => {
      const squad = ctx.args.squad as Squad;  // undefined during availability!
      return isAdjacent(squad.sectorId, sector.id);  // CRASH: Cannot read 'sectorId' of undefined
    }
  })
```

### The Solution

Always handle the `undefined` case. During availability check, return `true` if the element would be valid for **any** possible previous selection:

```typescript
// CORRECT - Handle both availability check and actual selection
Action.create('move')
  .chooseElement<Squad>('squad', { ... })
  .chooseElement<Sector>('destination', {
    filter: (sector, ctx) => {
      const selectedSquad = ctx.args?.squad as Squad | undefined;

      if (!selectedSquad) {
        // Availability check - squad not yet selected
        // Return true if this sector would be valid for ANY movable squad
        return movableSquads.some(squad =>
          isAdjacent(squad.sectorId, sector.id)
        );
      }

      // Actual selection - filter based on selected squad
      return isAdjacent(selectedSquad.sectorId, sector.id);
    }
  })
```

### When This Matters

This pattern is needed whenever:
- Selection B depends on Selection A's value
- The filter uses properties of a previous selection
- You're building multi-step actions (select piece, then select destination)

---

## 3. Dead/Removed Elements in Collections

### The Problem

Element queries like `all()`, `first()`, etc. return **all matching elements**, including those that are logically "dead" or removed from play:

```typescript
// WRONG - includes dead pieces
const pieces = player.board.all(Piece);
const canMove = pieces.every(p => p.canMove);  // False if any dead piece exists

// WRONG - dead element with 0 actions breaks the check
const mercs = squad.all(Merc);
const allHaveActions = mercs.every(m => m.actionsRemaining >= 1);  // Always false!
```

### The Solution

Filter out dead/inactive elements explicitly:

```typescript
// CORRECT - filter to living pieces
const livingPieces = player.board.all(Piece).filter(p => !p.isDead);
const canMove = livingPieces.every(p => p.canMove);

// CORRECT - create a helper method
class Squad extends Space {
  getLivingMercs(): MercCard[] {
    return this.all(MercCard).filter(m => !m.isDead);
  }
}

// Then use it consistently
const mercs = squad.getLivingMercs();
const allHaveActions = mercs.every(m => m.actionsRemaining >= 1);
```

### Best Practice

Create helper methods for common filtered queries in your element classes:
- `getLivingPieces()`
- `getActiveCards()`
- `getAvailableSlots()`

This prevents the filter from being forgotten in different parts of your code.

---

## 4. Action Cost Placement

### The Problem

If you place action cost logic inside a `repeat.onEach` callback, the cost is charged **per item selected**, not once per action:

```typescript
// WRONG - charges 1 action for EACH equipment piece selected
Action.create('equip')
  .chooseElement<Equipment>('equipment', {
    repeat: { max: 3 },
    onEach: (equipment, ctx) => {
      merc.useAction(1);  // Called 3 times if player selects 3 items!
    }
  })
  .execute((args) => { ... });
```

### The Solution

Place action costs in the `execute` block, which runs once:

```typescript
// CORRECT - charges once in execute
Action.create('equip')
  .chooseElement<Equipment>('equipment', {
    repeat: { max: 3 }
  })
  .execute((args, ctx) => {
    // Charge action cost once
    merc.useAction(1);

    // Process all selected equipment
    const items = args.equipment as Equipment[];
    for (const item of items) {
      merc.equip(item);
    }
  });
```

---

## 5. Player Data Serialization

### The Problem

Custom data on Player objects may not serialize correctly, especially complex objects or element references:

```typescript
// PROBLEMATIC - element references on player
class MyPlayer extends Player {
  selectedCard?: Card;  // May not survive serialization
  squadRefs: Squad[] = [];  // Array of element refs is tricky
}
```

### The Solution

Store element references by ID or use game-level storage:

```typescript
// CORRECT - store IDs instead of references
class MyPlayer extends Player {
  selectedCardId?: number;
  squadIds: number[] = [];

  getSelectedCard(): Card | undefined {
    if (!this.selectedCardId) return undefined;
    return this.game.getElementById(this.selectedCardId) as Card;
  }
}

// ALTERNATIVE - use game-level maps
class MyGame extends Game {
  playerSelections: Map<number, number> = new Map();  // playerId -> cardId
}
```

---

## 6. Flow Loop Conditions

### The Problem

Flow loops with stale condition checks can cause infinite loops:

```typescript
// WRONG - condition may never become true
loop({
  while: () => !game.isFinished(),  // If isFinished() never returns true...
  do: actionStep({ actions: ['play'] })
})
```

### The Solution

Ensure your loop conditions will eventually become false:

```typescript
// CORRECT - use maxIterations as safety net
loop({
  while: () => !game.isFinished(),
  maxIterations: 1000,  // Prevents infinite loop
  do: actionStep({ actions: ['play'] })
})

// CORRECT - condition references mutable state
loop({
  while: (ctx) => {
    const player = ctx.player;
    return player.actionsRemaining > 0;  // Will decrease each iteration
  },
  do: actionStep({ actions: ['play'] })
})
```

---

## 7. Element Class Registration

### The Problem

Forgetting to register custom element classes causes deserialization failures:

```typescript
// WRONG - MyCard not registered
class MyGame extends Game {
  constructor() {
    this.deck = this.create(Deck, 'deck');
    this.deck.create(MyCard, 'card', { value: 1 });  // Works initially...
    // But fails on reload/restore!
  }
}
```

### The Solution

Always register custom element classes in your Game constructor:

```typescript
// CORRECT - register all custom classes
class MyGame extends Game {
  constructor() {
    super(options);

    // Register ALL custom element classes
    this.registerElements([MyCard, MyDeck, MyPiece, MyBoard]);

    // Now create elements
    this.deck = this.create(Deck, 'deck');
    // ...
  }
}
```

---

## 8. Side Effects in Choice Callbacks

### The Problem

Choice callbacks in `chooseFrom` are evaluated when building action metadata, **before the player acts**. This causes issues when your choices have side effects:

```typescript
// WRONG - Draws cards every time action metadata is built!
Action.create('hireFirstMerc')
  .chooseFrom('merc', {
    choices: (ctx) => {
      // This runs on EVERY state update, not when player clicks
      const drawn = ctx.game.mercDeck.drawCards(3);  // Side effect!
      return drawn;
    },
  })
```

This causes:
- Cards drawn before player intends to act
- Cards drawn multiple times during the same turn
- Deck state corruption

### The Solution

Choices are now always evaluated on-demand when the player needs to make the selection. This is the default behavior - no special configuration needed:

```typescript
// CORRECT - Choices evaluated when player clicks
Action.create('hireFirstMerc')
  .chooseFrom('merc', {
    choices: (ctx) => {
      // This runs when player needs to make the selection
      const drawn = ctx.game.mercDeck.drawCards(3);
      return drawn;
    },
  })
```

See [On-Demand Choices](./actions-and-flow.md#on-demand-choices) in the Actions & Flow documentation for full details.

---

## 9. Element Storage: Arrays vs Children (CRITICAL)

### The Problem

Storing game elements in property arrays instead of as element children causes serialization issues. The client receives element references instead of full element data:

```typescript
// WRONG - Elements in array don't serialize properly
class Sector extends Space {
  stash: Equipment[] = [];  // BAD!

  addToStash(equipment: Equipment): void {
    this.stash.push(equipment);  // Just adds a reference
  }
}

// When serialized, the client receives:
// stash: [{ __elementRef: "0/2/1" }, { __elementRef: "0/2/2" }]
// NOT the full equipment data!
```

This causes:
- Broken images in the UI
- Missing attributes (names, stats, descriptions)
- Elements that "disappear" from their original location but don't appear in the stash
- Confusing debugging because server state looks correct

### The Solution

Store elements as **children** in the element tree, not as property arrays:

```typescript
// CORRECT - Elements as children serialize fully
class Sector extends Space {
  // Create a child Space to hold stash items
  stashZone!: Space;

  setupStash(): void {
    this.stashZone = this.create(Space, 'stash');
    this.stashZone.contentsHidden();  // Optional: hide from other players
  }

  addToStash(equipment: Equipment): void {
    equipment.putInto(this.stashZone);  // Moves element in tree
  }

  getStash(): Equipment[] {
    return [...this.stashZone.all(Equipment)];
  }

  get stashCount(): number {
    return this.stashZone.count(Equipment);
  }
}
```

Now equipment serializes with all attributes because it's part of the element tree.

### When to Use Each Pattern

| Pattern | Use For | Example |
|---------|---------|---------|
| **Element children** | Game pieces that need UI display | Cards in hand, pieces on board, equipment in stash |
| **Property arrays** | Simple data, not game elements | List of action names, score history, string IDs |
| **ID arrays** | References you'll look up later | `selectedCardIds: number[]` then use `getElementById()` |

### Migration Example

If you have existing code with array storage:

```typescript
// Before (broken)
class Player extends BasePlayer {
  inventory: Equipment[] = [];

  addItem(item: Equipment): void {
    this.inventory.push(item);
  }
}

// After (correct)
class Player extends BasePlayer {
  inventoryZone!: Space;

  setupInventory(game: Game): void {
    this.inventoryZone = game.create(Space, `inventory-${this.position}`);
    this.inventoryZone.player = this;
    this.inventoryZone.contentsVisibleToOwner();
  }

  addItem(item: Equipment): void {
    item.putInto(this.inventoryZone);
  }

  get inventory(): Equipment[] {
    return [...this.inventoryZone.all(Equipment)];
  }
}
```

---

## Quick Reference

| Pitfall | Wrong | Right |
|---------|-------|-------|
| Element comparison | `array.includes(element)` | `array.some(e => e.id === element.id)` |
| Element equality | `el1 === el2` | `el1.equals(el2)` |
| Multi-step filter | `args.previous.prop` | `args?.previous?.prop` with fallback |
| Dead elements | `squad.all(Merc)` | `squad.getLivingMercs()` |
| Action costs | In `onEach` callback | In `execute` block |
| Element refs on Player | `selectedCard: Card` | `selectedCardId: number` |
| Loop safety | No `maxIterations` | Always set `maxIterations` |
| Class registration | Forget to register | `registerElements([...])` |
| Side effects in choices | N/A (no longer an issue) | Choices always evaluated on-demand |
| **Element storage** | `stash: Equipment[] = []` | `stashZone.all(Equipment)` |

---

## See Also

- [Core Concepts](./core-concepts.md) - Element tree structure
- [Actions & Flow](./actions-and-flow.md) - Action and flow patterns
- [Common Patterns](./common-patterns.md) - Reusable game patterns
