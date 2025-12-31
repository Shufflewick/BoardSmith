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

## 2. Dependent Selections (Selection B depends on Selection A)

### The Problem

When selection B depends on selection A's value, the filter/elements function for B can't access A during the availability check because A hasn't been selected yet:

```typescript
// WRONG - crashes when merc is undefined during availability check
Action.create('dropEquipment')
  .fromElements('merc', { elements: () => [...game.all(Merc)] })
  .fromElements('equipment', {
    elements: (ctx) => {
      const merc = ctx.args.merc as Merc;  // undefined during availability!
      return [...merc.equipment.all(Equipment)];  // CRASH!
    }
  })
```

### The Solution: Use `dependsOn`

Add `dependsOn` to tell the framework that selection B depends on selection A. The framework will automatically verify the action is available by checking if ANY choice for A leads to valid choices for B:

```typescript
// CORRECT - use dependsOn for automatic handling
Action.create('dropEquipment')
  .fromElements('merc', { elements: () => [...game.all(Merc)] })
  .fromElements('equipment', {
    dependsOn: 'merc',  // Framework handles availability check!
    elements: (ctx) => {
      const merc = ctx.args.merc as Merc;
      return [...merc.equipment.all(Equipment)];
    }
  })
```

**How it works:**
- During availability check, the framework iterates through all mercs
- For each merc, it checks if the equipment selection would have choices
- Action is available if at least one merc has equipment
- No crashes, no manual undefined handling needed!

This works with all selection types:

```typescript
// With chooseElement
.chooseElement('destination', {
  dependsOn: 'piece',
  from: (ctx) => ctx.args.piece as Piece,
  elementClass: Cell,
})

// With chooseFrom
.chooseFrom('item', {
  dependsOn: 'category',
  choices: (ctx) => getItemsForCategory(ctx.args.category as string),
})
```

### Alternative: Manual Undefined Handling

For complex cases where you need custom availability logic, you can still handle `undefined` manually:

```typescript
// Manual approach - handle undefined explicitly
.chooseElement<Sector>('destination', {
  filter: (sector, ctx) => {
    const selectedSquad = ctx.args?.squad as Squad | undefined;

    if (!selectedSquad) {
      // Availability check - return true if valid for ANY squad
      return movableSquads.some(squad =>
        isAdjacent(squad.sectorId, sector.id)
      );
    }

    // Actual selection - filter based on selected squad
    return isAdjacent(selectedSquad.sectorId, sector.id);
  }
})
```

### When to Use Which

| Use `dependsOn` when... | Use manual handling when... |
|------------------------|----------------------------|
| Simple dependency (B's choices come from A) | Complex availability logic needed |
| Standard patterns (select container, then contents) | Need to filter A's choices based on B's existence |
| Want automatic framework handling | Need custom "any possible path" logic |

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

## 10. followUp Args Auto-Resolution

### The Problem

When using `followUp` to chain actions with pre-filled args, the server **automatically resolves numeric IDs to elements** before calling your callbacks. Your code may expect an ID but receive an element:

```typescript
// In explore action execute():
return {
  success: true,
  followUp: {
    action: 'collectEquipment',
    args: { mercId: merc.id, sectorId: sector.id }  // Passing numeric IDs
  }
};

// In collectEquipment filter() - WRONG assumption:
filter: (element, ctx) => {
  // ctx.args.sectorId is NOT a number - it's the resolved Sector element!
  const sector = game.getElementById(ctx.args.sectorId);  // FAILS - already an object
  return element.container === sector;
}
```

### The Solution

Use the `resolveElementArg()` helper to handle both cases:

```typescript
import { resolveElementArg } from '@boardsmith/engine';

// In collectEquipment filter():
filter: (element, ctx) => {
  const sector = resolveElementArg<Sector>(game, ctx.args.sectorId);
  if (!sector) return false;
  return element.container === sector;
}
```

Or handle both cases manually:

```typescript
function getSector(ctx: any): Sector | undefined {
  const sectorArg = ctx.args?.sectorId;
  if (typeof sectorArg === 'number') {
    return game.getElementById(sectorArg) as Sector | undefined;
  } else if (sectorArg && typeof sectorArg === 'object' && 'id' in sectorArg) {
    return sectorArg as Sector;
  }
  return undefined;
}
```

### Why This Happens

The server resolves numeric args to elements so that most action callbacks "just work" with element objects. However, if your code explicitly calls `getElementById()` on an already-resolved element, it fails.

---

## 11. Computed Getters Not Serialized

### The Problem

Computed getters on element classes are **not included in serialization**. The UI only receives the raw serialized properties:

```typescript
// Server-side element class
class Sector extends Space {
  get stash(): Equipment[] {
    return [...this.stashZone.all(Equipment)];  // Computed from children
  }
}

// UI code - WRONG:
const stash = getAttr(sectorElement, 'stash', []);  // Returns [] - not serialized!
```

The UI receives the raw element tree, not computed properties.

### The Solution

In UI code, query the element tree directly instead of expecting computed properties:

```typescript
// UI code - CORRECT:
function getStashFromSector(sectorElement: any): Equipment[] {
  // Find the stash zone child
  const stashZone = sectorElement.children?.find((c: any) =>
    c.className === 'Space' && getAttr(c, 'name', '') === 'stash'
  );

  if (!stashZone?.children) return [];

  // Get equipment from the zone
  return stashZone.children
    .filter((e: any) => e.className === 'Equipment')
    .map((e: any) => ({
      id: e.id,
      name: getAttr(e, 'equipmentName', 'Unknown'),
      type: getAttr(e, 'equipmentType', 'item'),
    }));
}
```

### Best Practices

1. **Design for serialization**: Store data as element children or explicit properties, not computed getters
2. **UI mirrors structure**: Write UI code that queries the same element tree structure as the server
3. **Use attributes**: Store frequently-accessed values as actual attributes, not computed

### Example: Exposing Computed Data

If you need a computed value available to the UI, store it as an attribute:

```typescript
// Server-side
class Sector extends Space {
  updateStashCount(): void {
    // Store as explicit attribute for UI access
    this.stashCount = this.stashZone.count(Equipment);
  }

  addToStash(equipment: Equipment): void {
    equipment.putInto(this.stashZone);
    this.updateStashCount();  // Keep attribute in sync
  }
}

// UI can now access directly
const count = getAttr(sectorElement, 'stashCount', 0);
```

---

## 12. Debugging "Why Isn't My Action Available?"

### The Problem

Your action isn't appearing in `availableActions` and you can't figure out why. The game silently excludes it with no explanation.

### The Solution: Use `debugActionAvailability()`

The engine provides a built-in debugging method that explains exactly why an action is or isn't available:

```typescript
// In your game code or browser console:
const debug = game.debugActionAvailability('equipItem', player);
console.log(debug.reason);
// "Selection 'equipment' has no valid choices (Depends on 'actingMerc' - no valid combinations found)"

// For detailed breakdown:
console.log('Condition passed:', debug.details.conditionPassed);
for (const sel of debug.details.selections) {
  const status = sel.passed ? '✓' : '✗';
  console.log(`${status} ${sel.name}: ${sel.choices} choices`);
  if (sel.note) console.log(`    ${sel.note}`);
}
// ✓ actingMerc: 3 choices
//     3 valid choices
// ✗ equipment: 0 choices
//     Depends on 'actingMerc' - no valid combinations found
```

### Common Issues and What to Look For

| `debug.reason` says... | Check this... |
|------------------------|---------------|
| "Condition returned false" | Your action's `condition` function. Use `ConditionTracer` for details. |
| "Selection 'X' has no valid choices" | The `from`, `filter`, or `elements` for that selection. |
| "Depends on 'Y' - no valid combinations" | All choices for Y lead to empty choices for X. Maybe Y has the wrong elements? |
| "Filter eliminated all choices" | Your `filter` function is too restrictive. |
| "Action 'X' does not exist" | Typo in action name or action not registered. |

### Debug All Actions At Once

```typescript
const allDebug = game.debugAllActions(player);
const unavailable = allDebug.filter(d => !d.available);
for (const d of unavailable) {
  console.log(`${d.actionName}: ${d.reason}`);
}
```

### In Tests

```typescript
import { createTestGame } from '@boardsmith/testing';

const testGame = await createTestGame(gameDefinition, { playerCount: 2 });

// Debug why action isn't available
const debug = testGame.game.debugActionAvailability('attack', testGame.game.players[0]);
expect(debug.available).toBe(true);
// If it fails, debug.reason tells you why
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
| **Action debugging** | Guessing why action unavailable | `game.debugActionAvailability(name, player)` |

---

## See Also

- [Core Concepts](./core-concepts.md) - Element tree structure
- [Actions & Flow](./actions-and-flow.md) - Action and flow patterns
- [Common Patterns](./common-patterns.md) - Reusable game patterns
