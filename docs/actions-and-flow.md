# Actions & Flow System

This document covers the Action builder API and the declarative Flow system for controlling game structure.

## Actions

Actions define what players can do during the game. They use a fluent builder pattern.

### Basic Action Structure

Pass your concrete game class to `Action.create<MyGame>(...)`. The builder then
**threads full type information through the whole chain**:

- `ctx.game` is typed as `MyGame` in every callback (`condition`, `choices`,
  `filter`, `validate`, and `execute`) — no `ctx.game as MyGame` cast needed.
- Each selection method adds its `{ name: type }` to the args object, so the
  `execute` handler receives a **fully-typed `args`** — no `args.card as Card`
  casts, and a typo'd key (`args.crad`) is a compile error instead of silently
  returning `undefined`.

`ctx.player` is the **base `Player`** type, not your player subclass — reading
your own fields off it needs a cast (`ctx.player as MyPlayer`). Only `ctx.game`
and `args` are threaded.

```typescript
import { Action, type ActionDefinition } from 'boardsmith';

export function createMyAction(game: MyGame): ActionDefinition {
  return Action.create<MyGame>('actionName')
    .prompt('Description shown to player')
    .condition({
      // ctx.game is MyGame here
      'player has enough resources': (ctx) => ctx.player.gold >= 5,
    })
    .chooseElement('card', { elementClass: Card })
    .execute((args, ctx) => {
      // args.card is typed as Card, ctx.game is typed as MyGame — no casts.
      return { success: true };
    });
}
```

### Selection Methods

#### `chooseFrom` - Choose from a list

```typescript
Action.create('selectRank')
  .chooseFrom('rank', {
    prompt: 'Choose a rank to ask for',
    choices: (ctx) => ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'],
  })
```

#### On-Demand Choices

Choices are always evaluated on-demand when the player needs to make a selection. This means the `choices` callback runs at the moment the player is presented with the selection, not when the action metadata is built.

**This enables:**
- Choice computation with side effects (e.g., drawing cards from a deck)
- Choices that depend on the current game state
- Manipulating state (like decks) right before showing choices

> ⚠️ **CRITICAL: Module-Level Variables Don't Work**
>
> The `choices()` and `execute()` callbacks run in **different contexts**. Module-level variables (Maps, arrays, objects outside the action) will NOT persist between them:
>
> ```typescript
> // ❌ WRONG - This will NOT work!
> const drawnCache = new Map<string, Equipment>();
>
> Action.create('armsDealer')
>   .chooseFrom('equipment', {
>     choices: (ctx) => {
>       const equipment = deck.draw();
>       drawnCache.set('drawn', equipment);  // Set in choices...
>       return [equipment];
>     },
>   })
>   .execute((args, ctx) => {
>     const equipment = drawnCache.get('drawn');  // ...empty in execute!
>   });
> ```
>
> **Use `actionTempState()` instead** (see below).

#### Using `actionTempState()` for Temp State

The `actionTempState()` helper provides a clean API for storing state between `choices()` and `execute()`:

```typescript
import { Action, actionTempState } from 'boardsmith';

Action.create('armsDealer')
  .chooseFrom('equipment', {
    choices: (ctx) => {
      const temp = actionTempState(ctx, 'armsDealer');
      const equipment = ctx.game.equipmentDeck.draw();
      temp.set('drawnEquipment', equipment.id);
      return [equipment, { value: 'skip', label: 'Skip (add to stash)' }];
    },
  })
  .execute((args, ctx) => {
    const temp = actionTempState(ctx, 'armsDealer');
    const equipmentId = temp.get<number>('drawnEquipment');
    const equipment = ctx.game.getElementById(equipmentId) as Equipment;
    temp.clear();  // Always clean up!

    if (args.equipment === 'skip') {
      sector.addToStash(equipment);
    } else {
      // Equip to merc...
    }
  });
```

**API:**
- `temp.set(key, value)` - Store a value
- `temp.get<T>(key)` - Retrieve a value (typed)
- `temp.clear()` - Remove all temp state for this action/player

The helper automatically namespaces by action name and player, so multiple players or actions won't conflict.

#### Full On-Demand Choices Example

```typescript
Action.create('hireFirstMerc')
  .prompt('Choose a MERC to hire')
  .condition({
    'player has no team yet': (ctx) => ctx.player.team.length === 0,
  })
  .chooseFrom('merc', {
    choices: (ctx) => {
      const temp = actionTempState(ctx, 'hireFirstMerc');
      const drawn = ctx.game.mercDeck.drawCards(3);
      temp.set('drawnIds', drawn.map(m => m.id));
      return drawn;
    },
    display: (merc) => merc.displayName,
  })
  .execute((args, ctx) => {
    const temp = actionTempState(ctx, 'hireFirstMerc');
    const merc = args.merc;
    ctx.player.team.push(merc);

    // Return unused mercs to deck
    const drawnIds = temp.get<number[]>('drawnIds') ?? [];
    for (const id of drawnIds) {
      if (id !== merc.id) {
        const card = ctx.game.getElementById(id);
        if (card) ctx.game.mercDeck.addToBottom(card);
      }
    }

    temp.clear();
    return { success: true };
  });
```

**How it works:**
1. Player sees "Hire First MERC" button
2. Player clicks button
3. Server evaluates choices callback NOW (draws 3 cards, stores IDs)
4. UI receives choices and shows selection dropdown
5. Player picks one, `execute()` runs with temp state available

> **Important: UI Sync Limitation**
>
> State changes made in `choices()` or `elements()` callbacks happen **server-side only**. The client's `gameView` is NOT updated until the entire action completes (after `execute()` runs).
>
> This means:
> - The UI won't show the drawn cards, updated counts, or state changes immediately
> - Custom game boards must read from `game.settings` to see mid-action state
> - If your UI needs to reflect state changes before selection, consider splitting into two actions in your flow
>
> **Example: Two-Action Pattern for UI Updates**
> ```typescript
> // flow.ts - Split exploration into two actions
> phase('explore', {
>   do: sequence(
>     actionStep({ actions: ['explore'] }),       // Draws equipment, updates state
>     actionStep({ actions: ['collectLoot'] }),   // UI now shows updated state
>   ),
> })
> ```
> This pattern ensures the UI sees the exploration results before the player picks equipment.

#### `chooseElement` - Choose a single game element

This is the canonical method for any one-element choice (board click or
button list). Say which elements are selectable in one of two ways:

- **Board pattern** — `elementClass` (+ optional `from` / `filter`). The player
  clicks matching elements on the board.
- **Precomputed pattern** — `elements`, a ready-made array (or function). Use
  when you already have the exact candidate list.

Either way the value encoding is identical: wire values are element IDs
(numbers), custom UIs send the ID directly, and `execute()` receives the
resolved Element object.

```typescript
// Board pattern - click a matching element
Action.create('placeStone')
  .chooseElement('cell', {
    prompt: 'Select an empty cell',
    elementClass: Cell,
    filter: (cell, ctx) => cell.isEmpty(),
    display: (cell) => cell.notation,        // Display text
    boardRef: (cell) => ({ id: cell.id }),   // For UI highlighting
  });

// Precomputed pattern - choose from a known list
Action.create('attack')
  .chooseElement('target', {
    prompt: 'Choose a target',
    elements: (ctx) => ctx.game.combat.validTargets,
    display: (unit, ctx, allUnits) => unit.name,  // Optional: custom display
    boardRef: (unit) => ({ id: unit.id }),
  })
  .execute((args, ctx) => {
    // args.target is the resolved Element object (not an ID!)
    const target = args.target as Unit;
    target.takeDamage(10);
    return { success: true };
  });
```

**Why select elements with `chooseElement` instead of `chooseFrom`?**

| Feature | `chooseFrom` | `chooseElement` |
|---------|-------------|----------------|
| Value type | String (manual) | Element ID (automatic) |
| Custom UI sends | `"Militia #1"` (must match exactly) | `42` (element ID) |
| Display names | Manual | Auto-disambiguated |
| Execute receives | Raw value | Resolved Element |

**Custom UI integration:**

```typescript
// In your custom Vue component:
function attackTarget(targetId: number) {
  // Just send the element ID - it works!
  props.action('attack', { target: targetId });
}
```

**Auto-disambiguation:**
When multiple elements share the same name, display names are automatically suffixed:
- "Militia" (if unique)
- "Militia #1", "Militia #2" (if duplicates exist)

#### `chooseElements` - Choose multiple game elements

Use this when the player picks more than one element. It always resolves to an
array of Element objects. Bound the count with `multiSelect` (a number means
"up to N"; `{ min, max }` gives full control); when omitted, the player may
pick one or more.

```typescript
.chooseElements('targets', {
  elements: (ctx) => ctx.game.combat.validTargets,
  multiSelect: { min: 1, max: 3 },  // Select 1-3 targets
})
.execute((args) => {
  // args.targets is an array of Element objects
  const targets = args.targets as Unit[];
  targets.forEach(t => t.takeDamage(5));
});
```

**Optional selections:**

Allow players to skip a selection. Use `optional: true` for a "Skip" button, or provide a string for custom button text:

```typescript
.chooseElement('item', {
  elements: (ctx) => ctx.loot.all(Equipment),
  optional: true,           // Shows "Skip" button
})

.chooseElement('item', {
  elements: (ctx) => ctx.loot.all(Equipment),
  optional: 'Done',         // Shows "Done" button instead of "Skip"
})
```

#### `playerChoices` - Choose a player with chooseFrom

Use the `playerChoices()` helper on your Game class to generate player choices for use with `chooseFrom`:

```typescript
Action.create('askPlayer')
  .chooseFrom('target', {
    prompt: 'Who do you want to ask?',
    choices: (ctx) => game.playerChoices({ excludeSelf: true, currentPlayer: ctx.player }),
  })
  .execute((args, ctx) => {
    // playerChoices returns { value: seat; display: string } objects
    // Seat values are 1-indexed
    const choice = args.target as { value: number; display: string };
    const targetPlayer = game.getPlayer(choice.value)!;
    // ...
  });
```

The `playerChoices()` helper supports:
- `excludeSelf: true` - Filter out the current player
- `currentPlayer` - Required when using excludeSelf
- `filter: (player) => boolean` - Custom filter function

#### `enterNumber` - Enter a number

```typescript
Action.create('bid')
  .enterNumber('amount', {
    prompt: 'Enter your bid',
    min: 1,
    max: (ctx) => ctx.player.coins,
  })
```

#### `enterText` - Enter text

```typescript
Action.create('name')
  .enterText('name', {
    prompt: 'Enter a name',
    maxLength: 20,
  })
```

### Chaining Selections with `dependsOn`

When selection B depends on selection A's value, use the `dependsOn` option:

```typescript
Action.create('dropEquipment')
  .chooseElement('merc', {
    elements: () => [...game.all(Merc)],
  })
  .chooseElement('equipment', {
    dependsOn: 'merc',  // Tells framework B depends on A
    elements: (ctx) => {
      const merc = ctx.args.merc as Merc;
      return [...merc.equipment.all(Equipment)];
    },
  })
```

**What `dependsOn` does:**
- During availability check, the framework automatically iterates through all choices for A
- For each A choice, it checks if B would have valid choices
- Action is available if at least one A choice leads to valid B choices
- No crashes, no manual undefined handling needed!

Works with all selection types:

```typescript
// With chooseElement
Action.create('move')
  .chooseElement('piece', {
    elementClass: Piece,
    filter: (p, ctx) => p.player === ctx.player,
  })
  .chooseElement('destination', {
    dependsOn: 'piece',
    from: (ctx) => ctx.args.piece as Piece,
    elementClass: Cell,
  })

// With chooseFrom
Action.create('selectItem')
  .chooseFrom('category', { choices: ['weapons', 'armor'] })
  .chooseFrom('item', {
    dependsOn: 'category',
    choices: (ctx) => getItemsForCategory(ctx.args.category as string),
  })
```

> **Alternative: Manual Undefined Handling**
>
> For complex cases where you need custom availability logic, you can handle `undefined` manually instead of using `dependsOn`:
>
> ```typescript
> filter: (cell, ctx) => {
>   const piece = ctx.args?.piece as Piece | undefined;
>
>   if (!piece) {
>     // Availability check - no piece selected yet
>     // Return true if this cell would be valid for ANY movable piece
>     return getMovablePieces(ctx.player).some(p => p.canMoveTo(cell));
>   }
>
>   // Actual selection - piece is selected
>   return piece.canMoveTo(cell);
> }
> ```
>
> See [Common Pitfalls](./common-pitfalls.md#2-dependent-selections-selection-b-depends-on-selection-a) for more details.

### Conditions

Control when actions are available using labeled conditions:

```typescript
Action.create('draw')
  .condition({
    'deck has cards': (ctx) => game.deck.count(Card) > 0,
  })
  .execute(...)

// Multiple conditions are AND'd together
Action.create('purchase')
  .condition({
    'player can afford cost': (ctx) => ctx.player.gold >= 10,
    'item is available': (ctx) => game.shop.count(Item) > 0,
  })
  .execute(...)
```

Each key is a human-readable label that appears in debug output when the condition fails. This makes it easy to understand why an action isn't available.

**Labels should describe WHY** the condition exists, not just what it checks:
- Good: `'player can afford cost'`, `'in play phase'`, `'has cards to discard'`
- Bad: `'gold >= 10'`, `'phase === play'`, `'hand.count > 0'`

### Validation

There are three places to refuse something, and they answer different questions.
Picking the wrong one is the usual source of "my rule fires at the wrong time":

| You want to... | Use | Sees |
|---|---|---|
| decide whether the action is **offered at all** | `.condition()` | game + player, **no args** |
| reject **one value** as it is chosen | a selection's `validate` | that value + args so far |
| reject **the whole submission** before it runs | `.validate()` | every arg, fully resolved |

#### `.validate()` — the whole-submission gate

Runs at submit time with every selection resolved, after `.condition()` and after
each selection's own validation. Return `true` to allow, `false` to refuse
generically, or **a string to refuse with that message shown to the player**:

```typescript
Action.create<MyGame>('play')
  .chooseElements('cards', { elements: (ctx) => ctx.game.hand.all(Card) })
  .validate((args, ctx) => {
    // args.cards is Card[] — threaded through the chain, no cast.
    // ctx.player is the base Player type; cast for your own player fields.
    const player = ctx.player as MyPlayer;
    if (args.cards.length < 2) return 'Must play at least 2 cards';
    if (args.cards.length > player.actionPoints) {
      return `That costs ${args.cards.length} AP; you have ${player.actionPoints}.`;
    }
    return true;
  })
  .execute(({ cards }) => { /* ... */ })
```

This is the right home for a rule that spans selections, and the only mechanism
that both sees the complete submission and carries its own message. It applies on
every path into `execute` — a one-shot `sendAction` and a player clicking through
the selections one at a time both pass through it.

It does **not** affect availability: an action gated only by `.validate()` is
still offered, then refused with your message. That is deliberate — "you can't
do that *because*" is more useful than an action that silently disappears.

#### Selection `validate` — one value at a time

Every selection method takes a `validate` option with the **same three returns**
(`true` / `false` / a message string):

```typescript
.enterNumber('bid', {
  min: 1,
  max: 10,
  validate: (value, args, ctx) =>
    value <= (ctx.player as MyPlayer).gold || 'You cannot bid more than you hold',
})
```

It receives `(value, args, context)`, where `args` holds only the selections
collected **before** this one. Two consequences worth knowing: it does not run
when an optional selection is skipped, and an action with no selections has
nowhere to put it. For anything that depends on more than its own value, reach
for the action-level `.validate()` instead — hanging a whole-submission rule on
one field breaks the moment you reorder the selections.

> **There is no `{ valid, message }` return.** Both hooks take `true`, `false`,
> or a string. Returning an object is refused with an explicit message telling
> you so — an object is truthy but is not `true`, so guessing at its meaning
> would silently reject exactly the submissions you meant to allow.

#### `.condition()` is about availability, not arguments

`.condition()` decides whether the action appears. It is evaluated **twice**:
once at availability time with `ctx.args` as an **empty object**, and again at
submit time with the real args. A predicate that reads `ctx.args` must therefore
handle the empty record, or the action becomes permanently available or
permanently hidden:

```typescript
// TRAP: at availability time args is {}, so this is always false —
// the action never appears at all.
.condition({ 'can afford': (ctx) => ctx.player.gold >= (ctx.args.cost as number) })
```

A failing condition also produces the fixed message `Action is not available`;
it cannot explain itself. If you need a reason, use `.validate()`.

#### Why not just refuse inside `execute`?

Returning `{ success: false, error }` from `execute` is too late: the action has
already been dispatched, and any state your handler touched before the check has
already changed. Refuse in `.validate()`, where nothing has happened yet.

### Execute Function

The execute function performs the actual game logic. When the action was created
with `Action.create<MyGame>(...)`, `args` and `ctx.game` are fully typed, so no
casts are required:

```typescript
// Action.create<MyGame>('playCard').chooseElement('card', { elementClass: Card })
.execute((args, ctx) => {
  // args.card is Card, ctx.game is MyGame — typed by the builder chain.
  const card = args.card;

  // Perform game actions (generates commands automatically)
  card.putInto(ctx.game.discardPile);
  ctx.player.score += card.value;

  // Add game message
  ctx.game.message(`${ctx.player.name} played ${card.name}`);

  // Return result
  return {
    success: true,
    message: 'Card played successfully',
    data: { cardId: card.id },
  };
});
```

> **Note:** `ctx.player` is typed as the base `Player`. If your game uses a
> custom player subclass, cast it (`ctx.player as MyPlayer`) — only `ctx.game`
> and `args` are auto-typed by the builder.

> **Important:** When using `chooseElement`, the `args` contain the **full serialized element object**, not just the ID. To find the element by ID:
> ```typescript
> const elementId = typeof args.piece === 'object' ? (args.piece as any).id : args.piece;
> const piece = game.all(Piece).find(p => p.id === elementId);
> ```
> Also, always use `ctx.game` instead of a closure reference to the game variable in execute functions to avoid stale references during hot-reload.

### Single-Choice Auto-Fill

**A selection with exactly one enabled choice is filled for the player, who never
sees it.** If that was the last thing the action needed, the action then executes.
Design your actions knowing this: a compass with seven impassable directions
never appears — the move just happens.

The rules, in full:

- Applies to a **non-optional** selection with exactly **one enabled** choice.
  Optional selections are never auto-filled (skipping is a real decision), and
  disabled choices don't count toward the one.
- Auto-fill cascades: filling one selection may leave the next with a single
  choice, which is filled in turn.
- When everything is filled, auto-execute dispatches the action.
- Both defaults are on, and both are properties of the controller every UI shares
  (`useActionController`), so a custom board and the action panel behave alike.

Two ways to keep the beat:

```typescript
// The player must take the action deliberately, even when it needs no choices
// at all (e.g. drawing a card — the reveal should be theirs to trigger).
Action.create('draw').manual().execute(...)
```

`.manual()` suppresses auto-fill for that action, so the player's own tap is what
dispatches it. Tutorials can suppress auto-fill per step instead, when the point
is for the learner to perform the click — see
[Teaching & Tutorials](./teaching-and-tutorials.md) for `suppressAutoFill`.

Note that auto-fill is a **human-UI** behaviour. An AI seat plays a sole legal
move regardless.

### Action Options

```typescript
Action.create('move')
  .prompt('Move your piece')        // Player-facing prompt
  .help('Moves one space, orthogonally.')  // Help popover text
  .notUndoable()                    // Cannot undo this action
  .manual()                         // Never auto-execute for the player
  .suppressFromActionPanel()        // Hide the redundant Action Panel button (see below)
```

#### `.disabled()` — offer the action, greyed out, and say why

```typescript
Action.create<Settlement>('build')
  .disabled((ctx) => {
    const wood = ctx.player.resources.wood;
    return wood < 3 ? `You need 3 wood to build; you have ${wood}.` : false;
  })
  .execute(...)
```

Return a **reason string** to disable the button, or `false` to leave it
enabled. The reason is not optional, and there is no boolean form: a greyed-out
button that will not say why is the single most reliable way to make a player
think the game is broken. The reason is shown on hover and on focus, and read by
screen readers.

Choose between this and `.condition()` by asking whether the player should be
thinking about the action at all:

| | The player sees | Use when |
|---|---|---|
| `.condition()` | Nothing — the action is gone | The action is **irrelevant** here (playing a card during someone else's turn) |
| `.disabled()` | A greyed button that explains itself | The action is **relevant but blocked**, and its absence would be confusing (Build, while two wood short) |

Three things worth knowing:

- **It is enforced, not decorative.** `performAction` refuses a disabled action
  with the same reason, so a stale tab, a custom UI, or a bot gets the same
  answer the button gave.
- **It runs at availability time, with empty args** — like `.condition()`. A
  rule that needs the resolved selections belongs in `.validate()`, which runs
  at submit time and returns the same `string`-or-not shape.
- **A disabled action stays in `availableActions`** on purpose. That is what
  lets the panel draw it. The reason travels beside it in
  `PlayerGameState.disabledActions`, which is also where tutorial-gate reasons
  arrive — one channel, so a custom UI has one thing to read.

The same `string | false` contract disables individual choices inside an
action — `chooseFrom({ disabled })`, `chooseElement({ disabled })` — so a
reason is mandatory at every level, from the action's button down to a single
card in a hand.

The reason is not a `title` tooltip. It renders in a shared popover on hover, on
focus, and **on tap** — the native `title` this replaced showed nothing at all on
touch, so on a phone the reason did not exist. Custom UIs get the map as a
`disabledActions` slot prop on `#game-board` and bind the same
`v-disabled-reason` directive the panel uses, so board and panel dim, explain,
and go inert identically. See the
[Custom UI Guide](./custom-ui-guide.md#understanding-getchoices-return-values).

To skip a whole step of the flow, use the flow node's `skipIf` — it belongs to
`actionStep`, not to the action:

```typescript
actionStep({
  actions: ['discard'],
  skipIf: (ctx) => ctx.game.deck.count(Card) === 0,
})
```

#### The Action Panel is always on, and it always agrees with the board

This is the rule that governs everything below it, and it is the one designers
most often try to break:

> **The Action Panel is on at all times, and it offers exactly what the board
> offers. A custom board control is *in addition to* the panel, never instead
> of it.**

Both halves matter, in both directions. Every action a player can take right
now must be reachable from the panel, and every control the board draws must
correspond to something the panel is also offering. If your board grows a
compass, a card fan, or a drag-drop affordance, the panel keeps listing the same
choices underneath it — that is correct and intended, not a duplicate to be
removed.

**Why:** the panel is the accessibility surface. It is the keyboard path, the
screen-reader path, and the path that still works when a board control is
off-screen, mid-animation, too small to hit, or simply not built yet. A board
control is a richer way to do the same thing; it is not a replacement, because
it carries none of those guarantees. The moment the two surfaces disagree, the
player who is using the panel is being shown a different game from the player
using the board — and the panel user is the one who loses.

So the following are all the *same* mistake, and none of them is supported:

- Hiding the panel because the custom board "already has" the controls.
- Hiding the mid-action choice list because the board draws those choices.
- CSS-hiding the panel while leaving it in the tab order and the accessibility
  tree — strictly worse than showing it, since the control is still operable but
  now invisible.

If a board control and the panel are showing *different* things, that is a bug
in the game's wiring, not a reason to suppress one of them. Drive both from the
same `useBoardInteraction` / action-controller state and they cannot drift —
see [Custom UI Guide](./custom-ui-guide.md).

The one thing you may remove is a **redundant start button**, below. Note what
that is not: it hides one button while the panel keeps rendering everything
else, including every choice of the action once it is under way. The panel never
goes away, and it never offers less than the board.

`platformActionPanelEscapeHatch` is not an exception a game may reach for — it
is reserved for the host platform, which substitutes its own equivalent surface.

#### `.suppressFromActionPanel()` hides a *redundant* button, never the last one

Use it for an action whose board affordance is inherent — drag-drop,
click-to-select — where a second *start button* in the panel is clutter. The
action stays fully executable from the board or a custom UI; this is a rendering
filter, not a security control.

Its reach is deliberately narrow, and worth stating plainly because it is
routinely mistaken for a way to turn the panel off:

- It hides the **start button only**. Once the action is under way, the panel
  renders that action's prompt and its full choice list exactly as always —
  by design, per the parity rule above. There is no flag that suppresses a live
  choice list, and there will not be one.
- **If every available action is suppressed, they are all shown anyway.** A
  button is only redundant while something else is offered; when nothing is, the
  panel is the player's last control. That guarantee exists because the
  alternative has a dead end in it: an action with **no selections** can never
  start a pick, so if its button were hidden the player would get a prompt,
  nothing to press, and no mid-pick choice list to fall back on either — a state
  with no way out.

Design the board affordance as the primary path, not the only one.

---

## Action Chaining with `followUp`

Action chaining allows one action to automatically trigger another action with pre-filled context. This is essential for multi-phase game interactions where:
- The UI needs to show updated state between phases
- Context (which piece, which location) should flow between phases
- The user experience should feel seamless

### Basic Usage

Return a `followUp` object from your execute function:

```typescript
Action.create('explore')
  .chooseElement('merc', {
    prompt: 'Select MERC to explore',
    elementClass: Merc,
  })
  .execute((args, ctx) => {
    const merc = args.merc as Merc;
    const sector = merc.getCurrentSector();

    // Draw equipment to the sector's stash
    for (let i = 0; i < sector.lootCount; i++) {
      const equipment = ctx.game.drawEquipment();
      if (equipment) equipment.putInto(sector.stashZone);
    }
    sector.explored = true;
    merc.useAction(1);

    ctx.game.message(`${merc.name} explored ${sector.name}`);

    // Chain to collect action - UI will see the drawn equipment
    return {
      success: true,
      followUp: {
        action: 'collectEquipment',
        args: {
          mercId: merc.id,
          sectorId: sector.id,
        },
      },
    };
  });

// The follow-up action receives pre-filled args
Action.create('collectEquipment')
  .chooseElement('equipment', {
    prompt: 'Select equipment to take',
    elements: (ctx) => {
      // UI shows updated state - stash has the drawn equipment
      const sector = ctx.game.getElementById(ctx.args.sectorId) as Sector;
      return [...sector.stashZone.all(Equipment)];
    },
    optional: 'Done taking equipment',
  })
  .execute((args, ctx) => {
    if (args.equipment) {
      const merc = ctx.game.getElementById(ctx.args.mercId) as Merc;
      (args.equipment as Equipment).putInto(merc.inventoryZone);
      ctx.game.message(`Took ${(args.equipment as Equipment).name}`);
    }
    return { success: true };
  });
```

### Conditional Chaining

Only chain to follow-up when a condition is met:

```typescript
.execute((args, ctx) => {
  const sector = performExploration(args, ctx);

  return {
    success: true,
    // Only chain if there's equipment to collect
    followUp: sector.stashZone.count() > 0
      ? { action: 'collectEquipment', args: { sectorId: sector.id } }
      : undefined,
  };
})
```

### How It Works

1. **First action executes** - state changes (drawing equipment, marking explored)
2. **State syncs to client** - UI receives updated gameView with new state
3. **Follow-up auto-starts** - client automatically begins the follow-up action
4. **Args pre-filled** - follow-up action starts with provided args already set
5. **User continues** - from user's perspective, it's one seamless interaction

### When to Use Action Chaining

Use `followUp` when:
- An action modifies state that the next action's choices depend on
- You need the UI to reflect changes before the player makes their next selection
- Context (which piece, which location, etc.) should flow to the next action
- The follow-up is optional or conditional

Don't use `followUp` when:
- Selections don't depend on state changes from previous selections
- A single action with multiple selections is sufficient
- The follow-up is mandatory and unconditional (consider putting both in the same action)

### Displaying followUp Args

When followUp args are displayed in the action panel (as chips showing context), plain IDs like `mercId: 51` display as "51" which isn't user-friendly.

**Option 1: Pass objects with name/display properties**

```typescript
return {
  success: true,
  followUp: {
    action: 'collectEquipment',
    args: {
      // Plain ID - displays as "51" ❌
      // mercId: merc.id,

      // Object with name - displays as "Bronson" ✓
      mercId: { id: merc.id, name: merc.mercName },
      sectorId: { id: sector.id, name: sector.sectorName },
    },
  },
};
```

The UI extracts the `name` (or `display`) property automatically. Your follow-up action's helpers should handle both formats:

```typescript
function getMerc(ctx: ActionContext): Merc {
  const arg = ctx.args.mercId;
  // Handle both plain ID and object format
  const id = typeof arg === 'object' && arg !== null ? (arg as { id: number }).id : arg;
  return ctx.game.first(Merc, m => m.id === id)!;
}
```

**Option 2: Use the display option (recommended)**

For cleaner separation of value and display:

```typescript
return {
  success: true,
  followUp: {
    action: 'collectEquipment',
    args: {
      mercId: merc.id,
      sectorId: sector.id,
    },
    display: {
      mercId: merc.mercName,      // "Bronson"
      sectorId: sector.sectorName, // "Diamond Industry"
    },
  },
};
```

This keeps the args as plain IDs (no helper changes needed) while providing display strings for the UI.

### Example: Attack with Damage Resolution

```typescript
Action.create('attack')
  .chooseElement('attacker', { elementClass: Unit })
  .chooseElement('target', { elementClass: Unit })
  .execute((args, ctx) => {
    const attacker = args.attacker as Unit;
    const target = args.target as Unit;

    const damage = calculateDamage(attacker, target);
    target.takeDamage(damage);

    // If target has a defensive ability, chain to resolution
    return {
      success: true,
      followUp: target.hasDefensiveAbility()
        ? { action: 'resolveDefense', args: { targetId: target.id, damage } }
        : undefined,
    };
  });
```

---

### Example: Go Fish Ask Action

From Go Fish actions.ts:

```typescript
export function createAskAction(game: GoFishGame): ActionDefinition {
  return Action.create('ask')
    .prompt('Ask another player for a card')
    .chooseFrom('target', {
      prompt: 'Who do you want to ask?',
      choices: (ctx) => game.playerChoices({ excludeSelf: true, currentPlayer: ctx.player }),
      boardRefs: (choice: { value: number; display: string }, ctx) => {
        const targetPlayer = game.getPlayer(choice.value) as GoFishPlayer;
        return { targetRef: { id: game.getPlayerHand(targetPlayer).id } };
      },
    })
    .chooseFrom('rank', {
      prompt: 'What rank do you want?',
      choices: (ctx) => game.getPlayerRanks(ctx.player as GoFishPlayer),
      display: (rank) => {
        const names: Record<string, string> = {
          'A': 'Aces', '2': 'Twos', '3': 'Threes', '4': 'Fours',
          '5': 'Fives', '6': 'Sixes', '7': 'Sevens', '8': 'Eights',
          '9': 'Nines', '10': 'Tens', 'J': 'Jacks', 'Q': 'Queens', 'K': 'Kings'
        };
        return names[rank] ?? rank;
      },
    })
    .execute((args, ctx) => {
      const player = ctx.player as GoFishPlayer;
      const targetChoice = args.target as { value: number; display: string };
      const target = game.getPlayer(targetChoice.value) as GoFishPlayer;
      const rank = args.rank as string;

      const matchingCards = game.getCardsOfRank(target, rank);

      if (matchingCards.length > 0) {
        for (const card of matchingCards) {
          card.putInto(game.getPlayerHand(player));
        }
        game.message(`${player.name} got ${matchingCards.length} ${rank}(s) from ${target.name}!`);
        // Player gets another turn when they receive cards
      } else {
        game.message(`${target.name} says "Go Fish!"`);
        // Player draws from pond
      }

      return { success: true };
    });
}
```

## Flow System

The Flow system defines game structure using composable nodes.

### Flow Definition

```typescript
import { loop, eachPlayer, actionStep, sequence, type FlowDefinition } from 'boardsmith';

export function createGameFlow(game: MyGame): FlowDefinition {
  return {
    root: /* flow node */,
    isComplete: (ctx) => game.isFinished(),
    getWinners: (ctx) => game.getWinners(),
  };
}
```

### Flow Nodes

#### `sequence` - Run steps in order

```typescript
sequence(
  actionStep({ actions: ['draw'] }),
  actionStep({ actions: ['play'] }),
)
```

#### `loop` - Repeat while condition is true

```typescript
loop({
  name: 'game-loop',
  while: (ctx) => !game.isFinished(),
  maxIterations: 1000,  // Safety limit
  do: /* flow node */,
})
```

`maxIterations` is required unless you opt into `unbounded: true` (see
below) — `loop()` throws at construction time otherwise. Hitting
`maxIterations` throws a loud "safety cap" error; it is the observable exit
signal telling you the `while` condition never became false. It is a safety
assertion, not a way to intentionally end a loop.

For a game with no natural per-loop iteration bound, use `unbounded: true`
instead of an arbitrary huge cap:

```typescript
loop({
  name: 'resource-drain-loop',
  unbounded: true,
  while: (ctx) => !ctx.game.pool.isEmpty(),
  do: /* flow node */,
})
```

`unbounded: true` makes `maxIterations` optional and removes the per-loop
cap-hit throw — the loop exits only via `while` becoming false. The engine's
own global whole-flow safety tripwire (a fixed cap on total flow-step
executions across the entire flow, independent of any single loop's
iteration count) still applies even when a loop is `unbounded: true`, so a
genuinely stuck unbounded loop still fails loud instead of hanging the
process. See [Common Pitfalls #6](common-pitfalls.md#6-flow-loop-conditions-maxiterations-is-required)
for the full construction-guard error text and more examples.

#### `repeat` - Fixed number of iterations

```typescript
repeat(5, actionStep({ actions: ['deal'] }))
```

#### `eachPlayer` - Iterate over players

Always wraps around the FULL player list starting from `startingPlayer` (or the
`TurnOrder` preset's equivalent) -- every player gets exactly one turn, in seat
order, regardless of which player you start from. There is no truncating or
"stop before wrapping" option.

```typescript
eachPlayer({
  name: 'player-turns',
  ...TurnOrder.DEFAULT,
  filter: (player, ctx) => !player.hasPassed,
  do: /* flow node */,
})
```

#### `forEach` - Iterate over array

The collection is snapshotted once on loop entry -- a body that mutates the
source collection (moves items, adds items) still visits exactly the original
items. Items must be `GameElement` instances or JSON primitives (`string |
number | boolean | null`); a loop body must not permanently delete an element
it iterates over (moving it, including to the pile via `remove()`, is fine).

```typescript
forEach({
  name: 'score-hands',
  collection: (ctx) => ctx.game.players,
  as: 'player',  // Variable name to access current item
  do: execute((ctx) => {
    const player = ctx.get('player');
    game.scoreHand(player);
  }),
})
```

#### `actionStep` - Wait for player action

```typescript
actionStep({
  name: 'move-step',
  actions: ['move', 'jump'],      // Available actions
  skipIf: (ctx) => game.isFinished(),
})
```

#### `simultaneousActionStep` - All players act at once

```typescript
simultaneousActionStep({
  name: 'discard-step',
  actions: ['discard'],
})
```

**The default `allDone` only sees the seats that had a legal move when the step opened.**

On entry, the step builds an *awaiting set*: every seat with at least one available
action. Seats with none are not added — and the default completion rule is "every
**awaiting** seat is done". So a seat whose action happens to be unavailable at that
instant is not waited for, is not errored on, and is simply skipped. The phase ends
early and silently.

That is fine for a discard step, where "no legal discard" genuinely means "nothing to
do". It is wrong for any design where a seat can *temporarily* have no legal move but
must still act before the round ends — a seat waiting on a resource, a character who
has not arrived, an action gated on another seat's choice.

**If seats in your game can temporarily have no legal move, supply an explicit
`allDone`.** Write the condition the round actually ends on, in game terms, rather
than inheriting "whoever could act, acted":

```typescript
simultaneousActionStep({
  name: 'orders',
  actions: ['submitOrder'],
  // Every LIVING seat has an order on the table -- true regardless of who
  // happened to have a legal move when the step opened.
  allDone: (ctx) => ctx.game.all(Player, p => p.isActive)
    .every(p => p.order !== undefined),
})
```

A custom `allDone` is authoritative: the step stays open while it returns `false`,
even when no seat can currently act. The engine warns in dev when that happens,
because the state is indistinguishable from a deadlock.

**Know what an explicit `allDone` does and does not buy you.** The awaiting set is
built once per step *entry* and never grows within it. So:

- It **does** stop the round ending without a seat that was supposed to act.
- It **does not** let that seat act in this entry. A `resume` for a seat outside the
  awaiting set is rejected with `Player N is not awaiting action`.

The honest outcome is therefore a visible stall instead of a silent wrong answer —
which is the right trade, but it is not a fix on its own. To actually get the seat in:

- **Preferred: keep the action available.** Make `submitOrder` legal for every seat
  that must act and enforce "not yet" inside the action (or via `playerDone`), so the
  seat is in the awaiting set from the moment the step opens. This is the pit of
  success — the participant list then matches the round's real membership.
- **Otherwise: re-enter the step.** Wrap it in a `loop`, so the next entry rebuilds
  the participant list around whoever can act by then.

Use `playerDone` for per-seat completion, `skipPlayer` to exclude a seat from the step
entirely, and `allDone` for the round-level condition.

#### `phase` - Named game phase

```typescript
phase('setup', {
  do: sequence(
    execute(() => game.deal()),
    simultaneousActionStep({ actions: ['discard'] }),
  ),
})
```

#### `switchOn` - Conditional branching

```typescript
switchOn({
  on: (ctx) => game.currentPhase,
  cases: {
    'deal': /* flow node */,
    'play': /* flow node */,
    'score': /* flow node */,
  },
  default: /* flow node */,
})
```

#### `ifThen` - If-else logic

```typescript
ifThen({
  condition: (ctx) => ctx.game.deck.count(Card) > 0,
  then: actionStep({ actions: ['draw'] }),
  else: execute((ctx) => ctx.game.endRound()),
})
```

#### `execute` - Run code

```typescript
execute((ctx) => {
  ctx.game.deck.shuffle();
  ctx.game.message('Deck shuffled!');
})
```

#### `setVar` - Set flow variable

Initialize a variable before reading it. Reading a variable that was never set
returns `undefined`, and a `?? default` fallback would silently mask a typo — so
`ctx.get` warns in dev mode when the key was never set.

```typescript
// Initialize once, then increment — no `?? default` needed
sequence(
  setVar('roundNumber', 0),
  loop({
    maxIterations: 100,
    do: setVar('roundNumber', (ctx) => ctx.get<number>('roundNumber')! + 1),
  })
)
```

### Turn Order

Control player order with `TurnOrder` presets. Use the spread operator to apply them:

```typescript
import { TurnOrder } from 'boardsmith';

// Default round-robin from player 1
eachPlayer({
  ...TurnOrder.DEFAULT,
  do: actionStep({ actions: ['play'] }),
})

// Available presets (player seats are 1-indexed):
TurnOrder.DEFAULT           // Standard round-robin from player 1
TurnOrder.REVERSE           // Round-robin backward
TurnOrder.CONTINUE          // Continue from current player
TurnOrder.ACTIVE_ONLY       // Only non-eliminated players
TurnOrder.START_FROM(n)     // Start from seat n (1-indexed)
TurnOrder.ONLY([1, 3])      // Specific players only (seats 1 and 3)
TurnOrder.LEFT_OF_DEALER(fn) // Common for card games (pass a dealer-seat getter)
TurnOrder.SKIP_IF(fn)       // Skip players based on condition
TurnOrder.combine(...)      // Combine multiple configs

// Example with dealer rotation
eachPlayer({
  ...TurnOrder.LEFT_OF_DEALER(ctx => ctx.game.dealerSeat),
  do: actionStep({ actions: ['playCard'] }),
})
```

### Flow Variables

Access and set variables during flow:

```typescript
// Set variable (player seats are 1-indexed)
setVar('dealer', (ctx) => ctx.game.getPlayer(1))

// Access in conditions
loop({
  while: (ctx) => ctx.get('roundNumber') < 10,
  maxIterations: 100, // required — see Common Pitfalls #6
  do: /* flow node */,
})
```

### Example: Cribbage Flow

Complex multi-phase flow from Cribbage:

```typescript
export function createCribbageFlow(game: CribbageGame): FlowDefinition {
  return {
    root: loop({
      name: 'game-loop',
      while: () => !game.isFinished(),
      do: sequence(
        // Deal phase
        phase('deal', {
          do: execute(() => game.dealHands()),
        }),

        // Discard phase - all players discard simultaneously
        phase('discard', {
          do: simultaneousActionStep({
            actions: ['discard'],
            prompt: 'Discard 2 cards to the crib',
          }),
        }),

        // Play phase - alternating card play
        phase('play', {
          do: loop({
            while: () => !game.playPhaseComplete(),
            do: eachPlayer({
              do: actionStep({
                actions: ['playCard', 'sayGo'],
                skipIf: (ctx) => !game.canPlay(ctx.player),
              }),
            }),
          }),
        }),

        // Show phase - score hands
        phase('show', {
          do: forEach({
            collection: () => game.getShowOrder(),
            as: 'player',
            do: execute((ctx) => game.scoreHand(ctx.get('player'))),
          }),
        }),

        // Rotate dealer
        execute(() => game.rotateDealer()),
      ),
    }),
    isComplete: () => game.isFinished(),
    getWinners: () => game.getWinners(),
  };
}
```

### Example: Simple Turn-Based Flow (Hex)

Minimal flow from Hex:

```typescript
export function createHexFlow(game: HexGame): FlowDefinition {
  return {
    root: loop({
      name: 'game-loop',
      while: () => !game.isFinished(),
      maxIterations: 100,
      do: eachPlayer({
        name: 'player-turns',
        filter: (player) => !game.isFinished(),
        do: actionStep({
          name: 'place-stone',
          actions: ['placeStone'],
          skipIf: () => game.isFinished(),
        }),
      }),
    }),
    isComplete: () => game.isFinished(),
    getWinners: () => game.winner ? [game.winner] : [],
  };
}
```

## The Game Log

`game.message()` writes to the log the shell renders in the sidebar. It is a
shared record: every player and every spectator receives it.

```typescript
game.message('{{player}} played {{card}}', { player: ctx.player, card });
```

**The log is always on.** There is no prop, slot, or flag a game can set to
remove it — it is what makes a game reviewable, and the copy/clear controls in
the ⋯ menu depend on it being mounted. The only thing that ever hides it is the
player collapsing their own sidebar, which they can undo. A game that renders
its own narration somewhere on the board is *adding* a surface, not replacing
this one.

### `messageTo()` — for hidden information, and almost nothing else

When the rules make a fact genuinely private, address the message to the seats
allowed to have it:

```typescript
// Only this character perceives it.
game.messageTo(ctx.player, 'You hear footsteps to the north.');

// A private exchange between two seats.
game.messageTo([thief, victim], '{{thief}} lifts your purse', { thief });
```

**Most games should never call this.** It exists for the narrow case where the
game's rules require concealment — an RPG where a character sees what others
cannot, a hidden-role game whose night action must not name its actor. It is not
a decluttering tool. "Not relevant to that player" is not the same as "that
player must not know", and a log that quietly omits public events is one players
cannot trust or review.

The audience is enforced **on the server**. An unaddressed seat never receives
the message in its state payload at all — this is not a UI filter, and there is
no client-side copy to inspect. Spectators, having no seat, see only public
messages.

The log is not part of the element tree, so there is no per-seat copy of it in
the state payload to redact. It is emitted at exactly two boundaries, and both
apply the audience:

- `createPlayerView(game, seat)` → `getFormattedMessages(seat)` — the broadcast
  path, what the shell's log renders.
- `createSnapshot(game, …, { forSeat })` → `serializeMessageLog(forSeat)` — the
  redacted-clone path, used by the MCTS search sandbox so a bot cannot reason
  over lines its seat never saw.

A persisted snapshot (no `forSeat`) carries the **unfiltered** log, and must:
undo restores from it, so a filtered copy would destroy other seats' history on
the next rewind. `game.messages` stays complete for the same reason.

> If you find yourself adding a third emission point, give it the audience gate
> at the same time. The original leak here was a second copy of the log riding
> in an unrelated payload field, correct on both documented paths and wrong in a
> third nobody thought to check.

An empty audience throws rather than writing a message nobody could ever read:
that is always a bug at the call site (a filter that matched nothing, an
undefined player), and silently dropping it would lose game history with no
signal anywhere.

## Registering Actions

Actions must be registered in your Game constructor:

```typescript
constructor(options) {
  super(options);
  // ... element setup ...

  this.registerAction(createMoveAction(this));
  this.registerAction(createDrawAction(this));
  this.registerAction(createPlayAction(this));

  this.setFlow(createGameFlow(this));
}
```

## Custom UI Integration

### Sending Actions from Custom Components

When building a custom game board in Vue, you can send actions using the `action` prop:

```vue
<script setup lang="ts">
const props = defineProps<{
  gameView: GameView;
  action: (name: string, args: Record<string, unknown>) => Promise<{ success: boolean }>;
}>();

function attackTarget(targetId: number) {
  props.action('attack', { target: targetId });
}
</script>
```

### Smart Value Resolution

BoardSmith automatically resolves values in `chooseFrom` selections. When you send an action, these formats are accepted:

1. **Exact choice value** (original behavior)
2. **Element ID** (if choice references an element with that ID)
3. **Display string** (case-insensitive match to choice display)

This means custom UIs can send element IDs even for `chooseFrom` selections:

```typescript
// Action definition using chooseFrom
.chooseFrom('target', {
  choices: (ctx) => game.validTargets,  // Returns element objects
  display: (target) => target.name,
})

// Custom UI can send the element ID directly
props.action('attack', { target: target.id });  // Works!
```

### Detailed Validation Errors

When validation fails, you get helpful error messages:

```typescript
// Error response includes valid choices:
{
  success: false,
  error: 'Invalid selection for "target": "invalid-value". Valid choices: [Militia #1, Militia #2, genesis]'
}
```

### Best Practices

1. **Use `chooseElement` / `chooseElements` for elements** - they're designed for custom UIs
2. **Use element IDs, not string values** - IDs are stable; display strings can change
3. **Check `actionMetadata` for valid choices** - It includes element IDs for reference

```typescript
// actionMetadata structure for chooseElement (single-select):
{
  selections: [{
    name: 'target',
    type: 'element',  // Single-select uses 'element' type
    validElements: [
      { id: 42, display: 'Militia #1', ref: { id: 42 } },
      { id: 43, display: 'Militia #2', ref: { id: 43 } },
    ]
  }]
}

// actionMetadata structure for chooseElements (multi-select):
{
  selections: [{
    name: 'targets',
    type: 'elements',  // Multi-select uses 'elements' type
    multiSelect: { min: 1, max: 3 },
    validElements: [
      { id: 42, display: 'Militia #1', ref: { id: 42 } },
      { id: 43, display: 'Militia #2', ref: { id: 43 } },
    ]
  }]
}
```

## Related Documentation

- [Core Concepts](./core-concepts.md) - Elements and state management
- [UI Components](./ui-components.md) - Displaying actions in the UI
- [Game Examples](./game-examples.md) - Real implementations
