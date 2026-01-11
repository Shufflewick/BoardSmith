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

## 6.5. followUp Chains Don't Count Against Loop Iterations

### How It Works

When using `followUp` to chain actions within a `loop`, only the **final action in the chain** counts as a move/iteration. This allows patterns like recursive impact resolution:

```typescript
// Player turn loop - maxIterations: 30 prevents runaway loops
loop({
  maxIterations: 30,
  while: (ctx) => !ctx.game.isFinished(),
  do: actionStep({
    actions: ['explore', 'attack', 'endTurn'],
  }),
})

// Explore action that can trigger long followUp chains
Action.create('explore')
  .execute((args, ctx) => {
    const impacts = detectImpacts();  // Could return 5, 10, 20+ impacts

    if (impacts.length > 0) {
      return {
        success: true,
        followUp: {
          action: 'applyImpact',
          args: { impactIndex: 0, allImpacts: impacts }
        }
      };
    }
    return { success: true };
  });

// Recursive impact resolution - chains to itself
Action.create('applyImpact')
  .execute((args, ctx) => {
    applyImpact(args.allImpacts[args.impactIndex]);

    const nextIndex = args.impactIndex + 1;
    if (nextIndex < args.allImpacts.length) {
      return {
        success: true,
        followUp: {
          action: 'applyImpact',
          args: { impactIndex: nextIndex, allImpacts: args.allImpacts }
        }
      };
    }
    // Chain complete - NOW counts as 1 move
    return { success: true };
  });
```

In this example, if `explore` triggers 20 impact followUps, they all count as **1 loop iteration**, not 20. This is the intended behavior.

### Why This Matters

Without this behavior, recursive `followUp` patterns would quickly exhaust `maxIterations`:
- Player explores → triggers 20 impacts
- Each impact was counting as 1 iteration
- maxIterations: 30 would be reached after 1-2 player turns
- The game would end prematurely or require absurdly high maxIterations

### The Rule

A `loop` iteration is only incremented when an action completes **without returning a followUp**. This means:
- `action → followUp → followUp → done` = 1 iteration
- `action → done` = 1 iteration
- `action → followUp (chain of 100) → done` = 1 iteration

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

## 8.5. Module-Level Caching Doesn't Work (CRITICAL)

### The Problem

You try to cache data in a module-level variable to share between `choices()` and `execute()`, but the data is missing when `execute()` runs:

```typescript
// ❌ WRONG - Module-level caching will NOT work!
const drawnEquipmentCache = new Map<string, Equipment>();

Action.create('armsDealer')
  .chooseFrom('equipment', {
    choices: (ctx) => {
      const equipment = ctx.game.equipmentDeck.draw();
      drawnEquipmentCache.set(`player_${ctx.player.position}`, equipment);  // Set here...
      return [equipment, { value: 'skip', label: 'Skip' }];
    },
  })
  .execute((args, ctx) => {
    const key = `player_${ctx.player.position}`;
    const equipment = drawnEquipmentCache.get(key);  // ...undefined here!
    console.log('Equipment from cache:', equipment);  // "NONE"
  });
```

### Why This Happens

The `choices()` and `execute()` callbacks run in **different contexts**:
- `choices()` runs when building the UI/validating
- `execute()` runs when the player submits their choice
- With network play, these may be completely different server instances

Module-level variables don't survive across these boundaries.

### The Solution: Use `actionTempState()`

```typescript
import { Action, actionTempState } from '@boardsmith/engine';

Action.create('armsDealer')
  .chooseFrom('equipment', {
    choices: (ctx) => {
      const temp = actionTempState(ctx, 'armsDealer');
      const equipment = ctx.game.equipmentDeck.draw();
      temp.set('drawnEquipment', equipment.id);  // Store in game state
      return [equipment, { value: 'skip', label: 'Skip' }];
    },
  })
  .execute((args, ctx) => {
    const temp = actionTempState(ctx, 'armsDealer');
    const equipmentId = temp.get<number>('drawnEquipment');  // ✓ Works!
    const equipment = ctx.game.getElementById(equipmentId) as Equipment;
    temp.clear();  // Always clean up

    if (args.equipment === 'skip') {
      sector.addToStash(equipment);
    } else {
      // Equip to merc...
    }
  });
```

**Key points:**
- `actionTempState()` stores data in `game.settings` which persists correctly
- Automatically namespaced by action name and player
- Always call `temp.clear()` in `execute()` to clean up

See [Using actionTempState()](./actions-and-flow.md#using-actiontempstate-for-temp-state) for full documentation.

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
const debug = testGame.game.debugActionAvailability('attack', testGame.game.players.get(1)!);
expect(debug.available).toBe(true);
// If it fails, debug.reason tells you why
```

---

## 13. Client-Side vs Server-Side Element Access

### The Problem

On the **server side** (engine), you access elements via methods like `first()`, `all()`, and properties:
```typescript
// Server-side - returns GameElement with ._t.id
const weapon = merc.first(Equipment, e => e.equippedSlot === 'weapon');
console.log(weapon?.id); // 42 (numeric ID from _t.id)
```

On the **client side** (UI), you access elements via the serialized `gameView` tree:
```typescript
// Client-side - gameView has { id, className, attributes, children }
const weapon = merc.children?.find(c =>
  c.className === 'Equipment' && c.attributes?.equippedSlot === 'weapon'
);
console.log(weapon?.id); // 42 (numeric ID at top level)
```

### Common Mistake: Accessing Attributes Instead of Children

```typescript
// WRONG - Accessing an attribute that might store element DATA (not the element)
const slot = merc.attributes.weaponSlot;
// Returns: { equipmentId: "45-caliber...", ... } - plain object, NO id!

// CORRECT - Find in children array
const slot = merc.children?.find(c =>
  c.attributes?.equippedSlot === 'weapon'
);
// Returns: { id: 42, className: 'Equipment', attributes: {...} }
```

### The Symptom

If you see:
- `element.id` is `undefined`
- Object has game-specific attributes like `equipmentId` (string) instead of numeric `id`
- Element has no `className` property

You're likely looking at an **attribute object**, not a proper element from the tree.

### Visibility Can Hide Children

If an element belongs to an opponent, its children may be hidden:
```typescript
// Hidden child elements appear with __hidden flag and may have negative IDs
{
  id: -5001,  // Negative = hidden placeholder
  className: 'Equipment',
  attributes: { __hidden: true }
}
```

Check for `__hidden` when iterating children:
```typescript
const visibleEquipment = merc.children?.filter(c =>
  c.className === 'Equipment' && !c.attributes?.__hidden
);
```

### Debugging Checklist

1. **Server-side**: Use `element._t.children` to see actual children
2. **Client-side**: Use `element.children` from gameView
3. **Check visibility**: Look for `__hidden: true` in attributes
4. **Verify IDs**: Real elements have positive numeric `id`, hidden placeholders have negative `id`

---

## 14. Action Availability = Conditions AND Flow (CRITICAL)

### The Problem

Your action passes all its conditions (shown as available in the debug panel), but it doesn't appear in `availableActions` in the UI. You've verified the condition logic, checked your selections, and everything looks correct - but the action is silently excluded.

```typescript
// Debug panel shows:
// ✓ move - conditionResult: true, selections: [{ name: 'piece', choiceCount: 5 }]
//
// But in your game UI:
// availableActions = ['endTurn']  // Where's 'move'??
```

### The Root Cause

BoardSmith has **two layers** of action availability:

1. **Action conditions** - Does the action's `condition()` pass? Do all selections have valid choices?
2. **Flow restrictions** - Is the action listed in the current `actionStep({ actions: [...] })`?

An action must pass BOTH to appear in `availableActions`. The debug panel's "Actions" tab shows all actions that pass layer 1, but doesn't show layer 2 restrictions.

### The Solution

Check your flow definition - the action must be listed in the `actionStep({ actions: [...] })`:

```typescript
// WRONG - 'move' not in flow's action list
actionStep({
  name: 'player-turn',
  actions: ['endTurn'],  // Only endTurn is allowed!
})

// CORRECT - include all actions you want available
actionStep({
  name: 'player-turn',
  actions: ['move', 'attack', 'useAbility', 'endTurn'],
})
```

### Use the Debug Panel's Flow Context

The debug panel now shows flow context information:

```
⚡ FLOW CONTEXT
Phase: playerTurn
Current player: 0 [Your turn]
Flow allows: endTurn

✓ AVAILABLE (1)
  endTurn

🚫 FLOW-RESTRICTED (3)
  These actions pass their conditions but are not allowed by the current flow step.
  move          [would be available]
  attack        [would be available]
  useAbility    [would be available]
```

The **Flow-Restricted** section shows exactly which actions are being blocked by the flow.

### Common Scenarios

#### 1. Renamed/Consolidated Actions
After refactoring, the flow references old action names:

```typescript
// Old code had separate actions
actions: ['dictatorMove', 'dictatorAttack']

// After consolidation, actions are unified
// But flow still references old names!
game.defineAction('move', ...)  // 'dictatorMove' no longer exists
```

**Fix:** Update flow to use new action names. The engine now warns about unknown actions:
```
[BoardSmith] Flow step 'player-turn' references unknown action 'dictatorMove'.
Did you forget to register it with game.defineAction('dictatorMove', ...)?
```

#### 2. Dynamic Action Lists
Use a function for conditional action lists:

```typescript
actionStep({
  name: 'merc-action',
  actions: (ctx) => {
    const baseActions = ['move', 'attack', 'endTurn'];
    const player = ctx.player as MyPlayer;

    // Only add special actions if player has capabilities
    if (player.hasTactics) baseActions.push('playTactics');
    if (player.canReinforce) baseActions.push('reinforce');

    return baseActions;
  },
})
```

#### 3. Phase-Based Actions
Different phases allow different actions:

```typescript
const combatPhase = phase('combat', {
  do: actionStep({
    actions: ['attack', 'defend', 'retreat'],
  }),
});

const buildPhase = phase('build', {
  do: actionStep({
    actions: ['construct', 'recruit', 'upgrade'],
  }),
});
```

### Why This Design?

The flow-based restriction is intentional - it enforces game structure:

- **Phases**: Only certain actions make sense during specific phases
- **Sequences**: Ensure players complete steps in order (draft → play → score)
- **Turn structure**: Separate "main actions" from "free actions"

Without flow restrictions, any action could be taken at any time, breaking game rules.

### Debugging Checklist

1. **Open debug panel → Actions tab** - Check the Flow Context section
2. **Look at "Flow allows"** - Is your action listed?
3. **Check "Flow-Restricted" section** - Is your action there?
4. **If flow-restricted**: Update your flow's `actionStep({ actions: [...] })` to include it
5. **If not even in conditions-passed**: Use `game.debugActionAvailability()` to find why

---

## 15. Using followUp Args in prompt/filter

### The Problem

When using `followUp` to chain actions, the args passed in `followUp.args` need to be available in `prompt` and `filter` functions. A common pattern is filtering choices based on a context element:

```typescript
Action.create('collectEquipment')
  .chooseElement('equipment', {
    prompt: (ctx) => {
      // You want ctx.args.sectorId to show "Select from Sector X"
      const sector = ctx.game.getElementById(ctx.args?.sectorId);
      return `Select from ${sector?.name}`;
    },
    filter: (element, ctx) => {
      // You want ctx.args.sectorId to filter to only this sector's items
      const sector = ctx.game.getElementById(ctx.args?.sectorId);
      return sector?.stash.contains(element);
    },
  })
  .execute((args, ctx) => {
    // Process the selection...
    if (moreItemsAvailable) {
      return {
        followUp: {
          action: 'collectEquipment',
          args: { sectorId: ctx.args.sectorId }  // Pass element or ID
        }
      };
    }
  });
```

### The Solution

This pattern works correctly in BoardSmith. When you return `followUp.args`:

1. **Elements are automatically resolved everywhere**: Whether you pass an element or an ID, the server resolves it to the actual Element when:
   - Evaluating `prompt` and `filter` functions
   - Calling the `execute` function (in both `args` and `ctx.args`)
2. **Consistent args**: The same resolved `ctx.args` is available in prompt, filter, and execute

### Best Practices for followUp Args

1. **Pass elements directly** - the framework handles serialization automatically:

```typescript
return {
  followUp: {
    action: 'collectEquipment',
    args: { sectorId: sector }  // Element gets serialized/deserialized automatically
  }
};
```

2. **Access directly via ctx.args** - already resolved to Elements:

```typescript
prompt: (ctx) => {
  // ctx.args.sectorId is the resolved Element
  return `Select from ${ctx.args.sectorId?.name}`;
},
filter: (element, ctx) => {
  // Same - ctx.args.sectorId is the Element
  return ctx.args.sectorId?.stash.contains(element);
},
execute: (args, ctx) => {
  // args.sectorId is also the resolved Element (not just in ctx.args)
  const sector = args.sectorId;
  sector.stash.remove(args.equipment);
}
```

### Why This Works

BoardSmith automatically resolves element references throughout the action lifecycle:

1. **Action returns followUp**: Elements in `followUp.args` get JSON-serialized (keeping their `id`)
2. **Client stores and sends back**: Args are sent to server for choices and execution
3. **Server resolves everywhere**:
   - In `getSelectionChoices`: Resolves args before evaluating `prompt`, `filter`, `elements()`
   - In `executeAction`: Resolves ALL args (selection args AND followUp args) before calling `execute`
4. **Consistent element access**: `ctx.args.sectorId` is the same Element in prompt, filter, and execute

---

## 16. Element Count Explosion During followUp Chains

### The Problem

After many followUp iterations (e.g., 20+), your element queries suddenly return far more elements than expected:

```typescript
// Expected: ~200 Equipment elements
// Actual: 15,698 Equipment elements after 20 followUp iterations!
const equipment = [...game.all(Equipment)];
```

### Diagnosis

BoardSmith provides development mode warnings and debug methods:

1. **Automatic warning in development mode**: When element count doubles unexpectedly, you'll see:

```
[BoardSmith] Element count explosion detected for 'equipment'!
  Previous count: 200
  Current count: 15698 (78.5x increase)
  Element class: Equipment
  Total elements in game tree: 15700
  Element sequence counter: 15700
  ...
```

2. **Use `debugElementTree()` for detailed diagnostics**:

```typescript
const treeInfo = game.debugElementTree();
console.log(treeInfo.summary);
// "Total: 15698 elements in tree, 12 in pile, sequence at 15710"

console.log(treeInfo.byClass);
// { Equipment: 15690, Sector: 5, Player: 2, Space: 3 }

if (treeInfo.issues.length > 0) {
  console.log('Issues:', treeInfo.issues);
  // Any circular references or duplicate IDs detected
}
```

### Common Causes

1. **Action execute handler creating elements**:

```typescript
// WRONG - creates elements on every iteration!
.execute((args, ctx) => {
  // This creates a new Equipment every time the action runs
  const newItem = sector.create(Equipment, 'Item', { ... });

  return {
    followUp: { action: 'sameAction', args: { ... } }
  };
})
```

2. **Setup code running on every action** (HMR issue):

```typescript
// WRONG - if this runs on hot reload, it creates duplicates
game.all(Sector).forEach(sector => {
  sector.create(Equipment, 'Loot1');  // Runs again on HMR!
});
```

### The Solution

1. **Check your execute handler** - make sure you're not creating elements unintentionally

2. **Guard against duplicate creation**:

```typescript
// CORRECT - check before creating
if (!sector.first(Equipment, { name: 'Loot1' })) {
  sector.create(Equipment, 'Loot1');
}
```

3. **Use `debugElementTree()` in your game to track element growth**:

```typescript
// Add this to your game for debugging
this.registerDebug('Element Tree', () => this.debugElementTree());
```

4. **Check the sequence counter** - if it's much higher than element count, elements are being created and removed (normal but worth investigating)

### Key Diagnostic Values

| Metric | Meaning |
|--------|---------|
| `totalInTree` | Current elements in game tree (should be stable) |
| `sequenceCounter` | Total elements ever created (always increases) |
| `byClass` | Breakdown by element type (find which class is exploding) |
| `issues` | Circular references or duplicate IDs (tree corruption) |

---

## 17. Loop Exit with Pending Async State

### The Problem

Your flow loop's `while` condition only checks action availability, but doesn't account for async game state (like combat) that needs resolution:

```typescript
// WRONG - Exits when actions are depleted, even if combat is pending
loop({
  while: (ctx) => {
    const player = ctx.player as MercPlayer;
    return player.team.some(m => m.actionsRemaining > 0);
  },
  do: actionStep({ actions: ['move', 'attack', 'endTurn'] })
})
```

**What happens:**
1. Player uses their last action to attack
2. Attack triggers combat that requires target selection
3. Loop's `while` returns `false` (no actions left)
4. Loop exits before combat is resolved
5. Combat state is orphaned or cleared by the next game phase

### The Solution

Use `stateAwareLoop()` to automatically check for pending state before exiting:

```typescript
import { stateAwareLoop } from '@boardsmith/engine';

stateAwareLoop({
  name: 'combat-action-loop',
  actions: ['move', 'attack', 'endTurn'],
  while: (ctx) => {
    const player = ctx.player as MercPlayer;
    return player.team.some(m => m.actionsRemaining > 0);
  },
  pendingStates: (ctx) => [
    (ctx.game as MercGame).activeCombat,    // Keep looping while combat pending
    (ctx.game as MercGame).pendingCombat,   // Keep looping while combat about to start
  ],
})
```

**How it works:**
- `pendingStates` returns an array of values to check
- If ANY are truthy, the loop continues even if `while` returns false
- This ensures async state (combat, animations, etc.) resolves before the loop exits

### Alternative: Manual Check

You can also add checks directly in a regular `loop`:

```typescript
loop({
  while: (ctx) => {
    const game = ctx.game as MercGame;

    // Always stop if game is finished
    if (game.isFinished()) return false;

    // Keep looping while combat needs resolution
    if (game.activeCombat) return true;
    if (game.pendingCombat) return true;

    // Then check normal action availability
    const player = ctx.player as MercPlayer;
    return player.team.some(m => m.actionsRemaining > 0);
  },
  do: actionStep({ actions: ['move', 'attack', 'endTurn'] })
})
```

### The Pattern

Any loop that can trigger async state changes should check for that state:

```typescript
// Template for async-state-aware loops
loop({
  while: (ctx) => {
    // 1. Check game completion
    if (ctx.game.isFinished()) return false;

    // 2. Check for pending async state (combat, animations, etc.)
    if (hasPendingAsyncState(ctx)) return true;

    // 3. Check normal loop condition (action availability, etc.)
    return normalLoopCondition(ctx);
  },
  do: ...
})
```

---

## 18. Passing Choice Objects to fill() Instead of Values

### The Problem

You get choices from `getChoices()` and pass the entire choice object to `fill()`, but the action behaves unexpectedly or fails:

```typescript
// WRONG - passing the choice object
const choices = actionController.getChoices(currentSelection);
const selectedChoice = choices.find(c => c.value === sectorId);
await actionController.fill(selection.name, selectedChoice);  // ❌
// selectedChoice = { value: 142, display: "Wilderness" }
```

### The Solution

Pass `choice.value`, not the choice object:

```typescript
// CORRECT - pass just the value
await actionController.fill(selection.name, selectedChoice.value);  // ✓
// passes 142
```

### Why This Matters

`getChoices()` returns `{ value, display }` objects for UI rendering:
- `value`: What the server expects (element ID, choice value, etc.)
- `display`: Human-readable label for buttons/lists

The `fill()` function expects the raw value, not the wrapper object.

### Pit of Success

As of v0.8, BoardSmith automatically unwraps choice objects passed to `fill()` and shows a dev warning. However, passing `choice.value` directly is clearer and recommended.

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
| **Module-level caching** | `const cache = new Map()` | `actionTempState(ctx, 'action')` |
| **Element storage** | `stash: Equipment[] = []` | `stashZone.all(Equipment)` |
| **Action debugging** | Guessing why action unavailable | `game.debugActionAvailability(name, player)` |
| **Client-side elements** | `element.attributes.slot` | `element.children?.find(...)` |
| **Flow restrictions** | Action passes conditions but not in UI | Check flow's `actionStep({ actions: [...] })` |
| **followUp args in filter** | `ctx.args.sectorId` undefined in filter/prompt | Args are resolved - use `ctx.args.sectorId` |
| **Element count explosion** | Elements mysteriously multiply | `game.debugElementTree()` to diagnose |
| **Loop exit with pending state** | Loop checks only actions remaining | Use `stateAwareLoop()` with `pendingStates` |
| **execute() vs start()** | `execute('retreat', {})` without params | `start('retreat')` for wizard mode |
| **Choice objects in fill()** | `fill(name, choiceObject)` | `fill(name, choiceObject.value)` |

---

## See Also

- [Core Concepts](./core-concepts.md) - Element tree structure
- [Actions & Flow](./actions-and-flow.md) - Action and flow patterns
- [Common Patterns](./common-patterns.md) - Reusable game patterns
