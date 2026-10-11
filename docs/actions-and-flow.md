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
- A selection's `validate(value, args, ctx)` gets `args` typed the same way,
  from the picks declared before it (a repeating pick also sees its own earlier
  picks as an array), so `args.amount` is a `number`, not `unknown`.
- A `chooseElement` given `elementClass: Cell` hands its `filter` a `Cell`, since
  every candidate is one: `filter: (cell) => cell.isEmpty()` needs no cast.

- `ctx.player` is typed as **your** player subclass too. It is derived from the
  game type you already named, so `Action.create<MyGame>(...)` on a
  `class MyGame extends Game<MyGame, MyPlayer>` gives `ctx.player: MyPlayer` with
  nothing extra written and no `ctx.player as MyPlayer` cast.

<!-- typecheck: game src/rules/actions.ts -->
```typescript
import { Action, Card, type ActionDefinition } from 'boardsmith';
import type { MyGame } from './game.js';

export function createMyAction(): ActionDefinition {
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

A choice is a value, or `{ value, label }` to give the value its own label.
Either way every callback (`disabled`, `display`, `boardRefs`, `validate`,
`onSelect`) and `execute` receive the **value**, and the arg is typed as it:

```typescript
.chooseFrom('stance', {
  choices: [{ value: 'attack', label: 'Charge the line' }, { value: 'hold', label: 'Hold position' }],
})
.execute((args) => {
  const stance: 'attack' | 'hold' = args.stance; // the value, never the object
});
```

Only an object whose keys are `value` and an optional string `label` is read
that way. Any other object, such as `{ value: 'go', cost: 3 }`, is a value in
its own right and arrives whole, so data you put on a choice is never lost.
`label` is the one label key: `{ value, display }` is an ordinary object.

#### Many from a list: a SET (`multiSelect`) or a LIST (`orderedList`)

`chooseFrom` resolves to a single value unless you say otherwise. There are two
ways to ask for more than one, and which you want depends on whether the answer
is a set or a sequence:

| | `multiSelect` | `orderedList` |
|---|---|---|
| The answer is | a **set** — "choose 2 of these" | a **sequence** — "do these, in this order" |
| Order | incidental | part of the instruction, preserved end to end |
| A repeated choice | **refused** (`contains duplicate choices`) | accepted — each occurrence is a separate instruction |
| `min`/`max` count | distinct choices | **entries** |
| The Action Panel draws | checkboxes plus Done | Add buttons over a numbered, removable list, plus Done |

Both take a number (`3` means "up to 3"), a `{ min, max }` config, or a function
of the context when the bound is itself a fact about an earlier answer. Declaring
both on one selection is refused by the builder. Either one makes the arg an
array (`T[]`) in every state, so a function always returns a count: return
`{ min: 1, max: 1 }` for a single pick, never `undefined`.

```typescript
// A SET: discard any two cards. Naming one card twice is a mistake.
.chooseFrom('discards', {
  choices: (ctx) => ctx.player.hand.all(Card),
  multiSelect: { min: 2, max: 2 },
})

// A LIST: repair buildings in order, spending what is left after each one — so
// the same damaged building may be repaired twice in one command.
.chooseFrom('buildings', {
  choices: (ctx) => ctx.player.empire.damagedBuildings(),
  orderedList: { min: 0, max: 121 },
})
.execute((args, ctx) => {
  // The entries arrive in the order the player built them, repeats intact.
  for (const building of args.buildings as Building[]) ctx.game.repair(building);
});
```

Every occurrence in an ordered list is validated against the same authoritative
choice set the panel was offered, including its `disabled` reason — a repeat
cannot smuggle in a choice the rules currently refuse. An absent `max` means no
upper bound.

A custom UI builds one through the shared controller draft, so it and the Action
Panel stay in parity: `appendListEntry(name, value)` adds an entry (again for a
repeat), `removeListEntry(name, index)` drops one **by index** — with repeats, a
value does not name an entry — and `confirmMultiSelect()` submits the finished
list. On a board, clicking a choice's element appends. Bots enumerate a list one
entry at a time: with repeats allowed there is no cap that makes "every possible
list" tractable, so every move offered is a real one and a longer sequence is
reached by acting again.

#### One pick at a time, until it ends: a repeating selection (`repeat`)

`multiSelect` and `orderedList` take the whole answer at once. A **repeating**
selection takes it one pick at a time, and each pick can change the game before
the next is offered:

```typescript
.chooseFrom('token', {
  choices: (ctx) => [...ctx.game.stash.all(Token).map((t) => t.name), 'stop'],
  repeat: {
    until: (_ctx, last) => last === 'stop',             // the pick that ends it
    onEach: (ctx, pick) => { /* runs once per pick, before the next is offered */ },
  },
})
.execute((args) => {
  // Every pick, in order, ending with the one that ended it: ['p2', 'p1', 'stop']
  const picks: string[] = args.token;
});
```

(`repeatUntil: value` is shorthand for an `until` that ends on that value.) For
`chooseElement`, `execute` receives the picked elements. Either option types the
argument as an array, so the type says what `execute` receives (#347).

A repeat means the same thing however the move arrives (#325). A player clicking
picks, a whole `action` submission, a bot's move, the random simulator and
`enumerateLegalMoves` all go through the one protocol in
`ActionExecutor.processRepeatingStep`: each pick is checked against the choices
the previous pick's `onEach` left, then against the selection's own `validate`,
then `onEach` runs for it, and `until` is tested.

- **The selection's `validate` judges one pick at a time** (#352). It is called
  with the pick (an element for `chooseElement`), `args` holding the picks made
  before it under the selection's name (elements for `chooseElement`), and the
  context, and it follows the usual contract: `true`, `false`, or a message. A
  refused pick runs no `onEach` and leaves the repeat open, so a player can pick
  again; a whole submission containing it is refused as
  `Pick 2 of "rune": <your message>`; bots, the simulator and
  `enumerateLegalMoves` never offer it. A rule about the finished array belongs
  in the action-level `.validate()`, which sees `args.rune` as the whole array.

  ```typescript
  .chooseFrom('rune', {
    choices: ['ice', 'fire', 'stop'],
    repeatUntil: 'stop',
    validate: (pick, args) =>                          // pick: string
      !(pick === 'fire' && args.rune.includes('ice')) || 'Fire cannot follow ice.',
  })
  ```

- **A whole submission is the picks as an array**, in order, ending with the
  pick that ends the repeat. A single value, an array that never reaches the
  end, or picks after the end are refused with a message saying which. When a
  submission is refused after `onEach` has run for some of its picks, the
  runner rolls the game back, so a refused move changed nothing.
- **Bots and the simulator find repeats by making the picks** on a scratch copy
  of the game, shortest sequences first, up to 500 partial moves (a warning
  names the action when that budget runs out). The game being searched is
  never touched.

`onEach` runs once per pick, so it is the wrong place for a once-per-action cost
(see [common pitfalls](./common-pitfalls.md)). An `onEach` may not create an
element that a later selection of the same action then picks: a whole move
cannot name something that exists only after part of it has run, and
enumeration says so by name. World actions cannot repeat at all.

#### Work a `disabled` rule shares across every choice: `prepare`

A choice's `disabled(choice, ctx)` runs once per choice, every time the engine
evaluates the choices. A rule that reads the board, such as "is this space
covered by a pack already placed", would redo the same board reading for every
one of thousands of candidates. `prepare(ctx)` is where that shared work goes
(#334):

```typescript
.chooseFrom('space', {
  choices: (ctx) => spacesFor(ctx.player.seat),        // 3,720 spaces
  prepare: (ctx) => coveredSpaces(ctx.game.all(Pack)), // once per evaluation
  disabled: (space, ctx, covered) =>                   // covered: what prepare returned
    covered.has(space) ? 'A pack already stands there' : false,
})
```

- **Once per evaluation.** `prepare` runs once each time the engine evaluates
  the choices, before the first `disabled` call, and its return value is
  `disabled`'s third argument for every choice in that evaluation. It is typed:
  `covered` above is whatever `prepare` returns.
- **Never kept between evaluations.** The engine evaluates a pick several times
  per move (to validate the submission, to decide whether the action is still
  available afterwards, to build the player's view), and each of those runs
  `prepare` again. Mapping a submitted id or display string onto a choice
  judges nothing, so it runs neither `prepare` nor `disabled` (#364). So it always sees the game as it is at that moment, and a move that
  changes the board is reflected in the next evaluation. Do not cache its
  result yourself.
- **Only for `disabled`.** It is on `chooseFrom`, `chooseElement` and
  `chooseElements` (and the world facade's versions of them), and a `prepare`
  declared without a `disabled` rule is refused where the action is declared.
- `ctx` is the same one `disabled` receives, so earlier picks are in
  `ctx.args`. Like `choices`, it must not change the game.

Measured on a 3,720-space `chooseFrom` with 300 packs on the board: reading the
packs inside `disabled` cost about 1,600 ms per evaluation; reading them once in
`prepare` and checking a set of covered spaces cost about 7 ms.

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

An optional selection is asked **where it is declared**, with its Skip button
beside it, never saved for the end (#392). The Action Panel and a custom UI walk
the same order: the action's selections, top to bottom, each answered or
skipped before the next. So put an optional pick that narrows an earlier answer
("who exactly?") straight after that answer.

Each pick offers exactly the list your action gives it, in the Action Panel and
on the board alike (#407). Nothing hides a value because an earlier pick of the
same action already took it. If two picks must differ, say so in the later
pick's own list, and every surface follows:

```typescript
.chooseFrom('first', { choices: ['red', 'blue'] })
.chooseFrom('second', { choices: (ctx) => ['red', 'blue'].filter((c) => c !== ctx.args.first) })
```

#### `playerChoices` - Choose a player with chooseFrom

Use the `playerChoices()` helper on your Game class to generate player choices for use with `chooseFrom`:

```typescript
Action.create('askPlayer')
  .chooseFrom('target', {
    prompt: 'Who do you want to ask?',
    choices: (ctx) => ctx.game.playerChoices({ excludeSelf: true, currentPlayer: ctx.player }),
  })
  .execute((args, ctx) => {
    // playerChoices returns { value: seat, label: name } choices, so the arg
    // is the seat number (1-indexed).
    const targetPlayer = ctx.game.getPlayerOrThrow(args.target);
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

Two options shape what the player actually sees in the field:

- `initial` is the value the field **opens on**. It is a starting value, not a
  default for an omitted answer: the player may change or clear it, and an
  optional selection they skip still arrives absent. It is checked against the
  selection's own `min`/`max`/`integer` when the action is declared, so a field
  can never open on a value the same selection would refuse.
- `display` says what the current value **means**, matching the callback the
  choice selections take. It is evaluated once for every value in the range when
  the selection is built and travels with it, which is the only way a label can
  follow a number the player is still typing without a round trip per keystroke.
  That is why it requires an enumerable range - `min`, `max` and `integer: true`
  - of at most 200 values, and says so if the range is not one.

```typescript
Action.create('declareAge')
  .enterNumber('age', {
    prompt: 'How old are you?',
    min: 16,
    max: 65,
    integer: true,
    initial: 35,
    display: (age) =>
      age <= 20 ? 'barely grown' : age <= 30 ? 'young' : age <= 50 ? 'in your prime' : 'seasoned',
  })
```

The Action Panel opens on 35 and shows "in your prime" beside the field, moving
the label as the number changes. A custom UI reads the same starting value off
`useBoardInteraction`'s pick draft and the same labels off the pick, so the two
surfaces cannot disagree about either.

#### `enterText` - Enter text

```typescript
Action.create('name')
  .enterText('name', {
    prompt: 'Enter a name',
    maxLength: 20,
  })
```

`maxLength` always has a value: `enterText` applies
`DEFAULT_TEXT_MAX_LENGTH` (256) when you do not, because player-authored text is
copied into every retained checkpoint and every per-seat view, so an unbounded
field is a state-size hazard. Set your own, lower, bound whenever you know it.

**What no text may contain.** The engine refuses control characters (C0
U+0000-U+001F, DEL U+007F, C1 U+0080-U+009F) and unpaired UTF-16 surrogates in
every text argument, and so does the Action Panel before the player submits:
"<name> contains characters that can't be stored, such as invisible control
characters. Remove them and try again." A `multiline` field admits line feed and
tab; a single-line field refuses them too. There is no opt-out: these
characters are invisible, never typed on purpose, and break logs, rendering and
UTF-8 storage.

**`maxBytes` when the text is sized against a byte budget.** `maxLength` counts
UTF-16 characters, but a world partition is refused on the UTF-8 bytes of its
JSON, and an emoji is two characters and four bytes. With control characters
refused, a character costs at most three bytes, so `maxLength` bounds the bytes
at three times itself. `maxBytes` bounds them exactly, measured the way the
partition store measures (the text's JSON form, without the quotes), and the
panel and engine both refuse text over it.

```typescript
worldAction('gossip')
  .enterText('message', { maxLength: 200, maxBytes: 400 })
```

**A `pattern` says what it wants.** It is `{ regex, message }`, and `message`
is what the player is shown when their text does not match:

```typescript
Action.create('setHandle')
  .enterText('handle', {
    maxLength: 20,
    pattern: { regex: /^[a-z0-9_]+$/, message: 'Use lowercase letters, digits and underscores only.' },
  })
```

**`multiline: true` for prose.** The Action Panel draws a text pick as a
single-line field, which is right for a name and wrong for a description: a
thousand characters shown a hundred and twenty pixels at a time cannot be read
back, let alone written. `multiline` asks for a resizable box instead, with a
character count (which is where a box states its maximum) and an explicit submit
button so Enter inserts a newline.

```typescript
Action.create('setDescription')
  .enterText('description', {
    prompt: 'Empire description',
    maxLength: 1000,
    multiline: true,
  })
```

It is **presentation only**, with one exception. The value is the same string,
and `minLength`, `maxLength`, `maxBytes`, `pattern` and `validate` bind it in
exactly the same way. The exception is that a multiline field admits line feed
and tab, which a single-line field refuses; they count toward the length and
nothing strips them. That is why it is an option on `enterText` rather than a
selection kind of its own: a new `type` would carry a duplicate of every rule
`text` already has, and every host that switches on `type` would draw nothing at
all for a selection whose rules it already knew.

### Chaining Selections

When selection B is narrowed by selection A's value, read A out of `ctx.args`
and answer nothing until it is there:

```typescript
Action.create('equip')
  .chooseFrom('slot', { choices: ['head', 'hand'] })
  .chooseFrom('item', {
    choices: (ctx) => {
      const slot = ctx.args.slot as string | undefined;
      if (slot === undefined) return [];   // nothing to narrow by yet
      return itemsFor(slot);
    },
  })
```

That is the whole pattern. An action is offered on its **first unsatisfied
step** -- the question the player is about to be asked -- so a later step's
empty list means "ask me again once you know", not "this action cannot be
taken" (BoardSmith #270). The panel fetches `item`'s narrowed list the moment
`slot` is answered, and dispatch is validated against that same narrowed list.

**`dependsOn` is opt-in strictness on top of it.** It tells the engine that B is
narrowed by A, and the engine then walks every value of A to prove at least one
leaves B with something to pick -- dropping the action, with a warning that
names it, when none does:

```typescript
Action.create('dropEquipment')
  .chooseElement('merc', {
    elements: (ctx) => [...ctx.game.all(Merc)],
  })
  .chooseElement('equipment', {
    dependsOn: 'merc',  // check every merc for equipment before offering
    elements: (ctx) => {
      const merc = ctx.args.merc as Merc | undefined;
      if (merc === undefined) return [];
      return [...merc.equipment.all(Equipment)];
    },
  })
```

A pick may only depend on (`dependsOn`) or filter by (`filterBy`) a pick
declared **before** it, since picks are asked in declared order. The builder
refuses a forward reference when the action is declared.

**What `dependsOn` does:**
- During the availability check the engine iterates every choice for A
- For each one it re-asks B with that value bound
- The action is available if at least one A leads to a usable B
- When none does, the action is dropped **and says which step and why**

Reach for it when "this verb is pointless right now" is a state worth showing,
and when A's candidates are cheap to walk. A callback it re-asks is still handed
`undefined` on other paths, so keep the guard.

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

> A `filter` is handed the same half-filled `ctx.args` when the engine walks a
> declared dependency, so it takes the same shape:
>
> ```typescript
> filter: (cell, ctx) => {
>   const piece = ctx.args?.piece as Piece | undefined;
>   if (!piece) return false;   // not narrowed yet
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
    'deck has cards': (ctx) => ctx.game.deck.count(Card) > 0,
  })
  .execute(...)

// Multiple conditions are AND'd together
Action.create('purchase')
  .condition({
    'player can afford cost': (ctx) => ctx.player.gold >= 10,
    'item is available': (ctx) => ctx.game.shop.count(Item) > 0,
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
    // args.cards is Card[] and ctx.player is MyPlayer — both threaded through
    // the chain from `Action.create<MyGame>`, no casts.
    const player = ctx.player;
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
    value <= ctx.player.gold || 'You cannot bid more than you hold',
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

#### `unavailable` — a choice that is no longer listed

A submitted value can stop being a choice while the player is choosing: another
player took the offer, the auction settled, a second tab acted first. That value
is refused before `validate` runs, and `disabled` cannot speak to it because it
is no longer listed. By default the player reads:

> That choice is no longer available. Things changed while you were choosing, so please choose again.

and the engine's own detail (the value sent and the current choices) goes to the
dev log. To say it in the game's words, give `chooseFrom`, `chooseElement` or
`chooseElements` an `unavailable` sentence (#393):

```typescript
.chooseFrom('offer', {
  choices: ({ game }) => game.openOffers().map((o) => o.id),
  unavailable: () => 'Someone else took that offer first. Pick another one.',
})
```

It receives `(value, context)`. `value` is what was submitted, so it is typed
`unknown`: for a choice, the value sent; for an element, the element if it still
exists, otherwise the id sent. Return the sentence the player reads, saying what
happened and what to do next. An empty return is refused as an authoring error.

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

**A multi-step action taken pick by pick is gated by its condition too** (#493).
Each pick is checked against the game as it stands, with empty args, as
availability is:

- The first pick is refused when the condition does not hold
  (`'build' is not available to you right now: 'the stone is still in the quarry' does not hold.`).
- A later pick, including the one that completes the action, is refused when
  the condition held right after the seat's own previous pick and does not hold
  now. Nothing of the action ran in between, so another seat's move took it
  away: in a simultaneous step, seat 2 taking the stone refuses seat 1's
  half-picked `build`
  (`'build' is no longer available to you: the game changed since your last choice, and 'the stone is still in the quarry' no longer holds.`).
  Nothing is run or recorded, and the seat's pending action stays open, so it
  can cancel it or finish it if the condition comes back.
- An action whose **own** picks end its condition still completes. A repeat
  whose `onEach` spends the energy its condition counts is not refused for
  having spent it: the condition was checked before those picks ran, and they
  are part of the action. Once its own picks have ended the condition, the
  game as other seats alone would have left it no longer exists, so the
  condition gates the action again only after it holds again following one of
  its picks.
- A held follow-up is offered by its chain, not its condition, so its
  condition is never checked.

`GameRunner.refusalToPick` is the one place this is decided, for the
session-free runner and the stateless `selectionStep` op that every session
host runs alike.
A host that resumes a pending action without its persisted pending state (only
`initialArgs`) is treated as starting it, so the condition must hold then.

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

> **Note:** `ctx.player` is your player subclass, recovered from the game type
> you named on `Action.create<MyGame>`. A game that never declared a subclass
> (`Game<MyGame, Player>`) gets the base `Player`, which is what it has.

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

Note that auto-fill is a **human-UI** behaviour. A bot seat plays a sole legal
move regardless.

### Action Options

```typescript
Action.create('move')
  .prompt('Move your piece')        // Player-facing prompt
  .help('Moves one space, orthogonally.')  // Help popover text
  .notUndoable()                    // Cannot undo this action
  .manual()                         // Never auto-execute for the player
  .suppressFromActionPanel()        // Hide the redundant Action Panel button (see below)
  .destructive()                    // This verb permanently ends something (see below)
  .group('More', 'Empire settings') // Put its start button inside a menu group (see below)
  .order(20)                        // Where its button sits in its level
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
card in a hand. Work every choice's rule needs goes in the selection's
`prepare` (see [`prepare`](#work-a-disabled-rule-shares-across-every-choice-prepare)).

The reason is not a `title` tooltip. It renders in a shared popover on hover, on
focus, and **on tap** — the native `title` this replaced showed nothing at all on
touch, so on a phone the reason did not exist. Custom UIs get the map as a
`disabledActions` prop the board component receives and bind the same
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

#### The panel offers hierarchy, never free text

The panel presents choices as **a hierarchy a person walks with a few buttons**.
It has no search box, no typed coordinate entry, and no filter field, and it is
not getting one.

**Why the free-text door stays shut:** a search box is a *second* enumeration.
It has to decide what matches, and the moment it decides differently from the
engine, the panel is offering a different game from the board and the bots. A
list you scroll can only ever show what the engine enumerated; a box you type
into invites a UI-side rule about what to show. That is the divergence this
whole surface exists to prevent.

**So cardinality is yours to shape, not the panel's to survive.** There are
exactly two authored answers, and both live inside the action system:

1. **Anchor the step on the board.** Give the step a `boardRef` and the board
   draws every candidate in the geometry the choice actually has. Hex's fifty
   empty cells are unreadable as a button list and obvious as a board.
2. **Narrow it with an earlier step.** `dependsOn` turns one flat list of
   hundreds into two or three short ones — build, then category, then building.
   The panel walks that hierarchy one readable screen at a time.

```typescript
// Cardinality shaped by dependency: neither step is ever long.
Action.create('build')
  .chooseFrom('category', { choices: ['military', 'civic', 'wonder'] })
  .chooseElement('building', {
    dependsOn: 'category',
    elements: (ctx) => buildingsInCategory(ctx.args.category as string),
    boardRef: (b) => ({ id: b.id }),
  })
```

**Scoping by selection is authored HERE, never in the UI.** "Only show me things
near this unit" is a first `chooseElement` step with a dependent `filter` — so
the panel, the board, and move enumeration (and therefore bots) all read one
enumeration. A UI-side filter that hides options the engine allows is a
**divergence bug** and is not permitted, whatever it improves about the layout:
the player is then shown fewer moves than they legally have, the bot plays the
ones they were not shown, and nothing in the game can explain the difference.

**What the panel does when a step is still too big.** Above 24 candidates, if
every candidate carries a board ref, the panel stops listing them and offers one
control — "Choose on the board (N)" — that moves keyboard focus onto the board's
first valid target. This is a change of *surface*, not of content: the board
offers the identical enumeration, arrow keys move between candidates and Enter
chooses, so the keyboard path is continuous. It is not a filter and not a hidden
option; nothing is dropped. If even one candidate has no board ref the panel
keeps every button, because deferring would leave that candidate reachable from
neither surface.

This holds for `chooseFrom` as well as element picks. For a `chooseFrom`, a
candidate's board ref is the one `boardRefs` gives it with role `target` (or its
first ref when none is marked target). It counts if it names one element: by
its element `id` (natural for a piece or a card) or by its `notation` (natural
for a space). The board picks by either, and when a ref carries both it matches
by the id. A ref that gives only a `name` does not count, because a name need not
belong to one element. Every candidate needs such a ref, and no two candidates
may name the same element, since the board chooses the first candidate on an
element and the second could never be reached there. The kinds can be mixed:
some candidates by id and others by notation is fine. A multi-select keeps its
count and Done button beside the control, and an ordered list keeps its
numbered entries and their Remove buttons.

`boardsmith validate` reports a step that has neither answer: more than 24
candidates, no board anchor, no dependent narrowing. It finds them by playing a
few seeded random games and reading the engine's own move enumeration, because a
candidate count does not exist until a game is running. It plays them at your
`minPlayers`. If the random simulator cannot play your game through (it crashes
or gets stuck), the check says it could not run and names the `boardsmith
simulate` command that shows the same failure; it never reports an unplayed game
as clean. A game that stops because no seat has an enabled action left, as a
game built chunk by chunk does before the chunk that ends it, has been played:
every choice it offered before stopping was counted, so the check reports on it.
Whether that stop is a planned rest or a deadlock is for your own
`simulateRandomGames` test to say, with `isResting`.

A world has no flow to play, so `boardsmith validate` drives it the way a host
does instead. Three seats (or every seat of a smaller world) arrive through your
`presence.onArrive` verb. Then, for ten rounds, each seat's offers are
enumerated, every enabled offer is answered at random question by question (a
later question re-asked with the earlier answers bound, exactly as the panel
re-asks it), one of them is taken, and whatever the clock has due is fired. The
counts are the candidates those offers and re-asked picks carried. A world
action cannot declare `dependsOn`, so a world finding tells you to anchor the
step on the board or to ask an earlier question whose answer narrows the list.
If no seat is ever offered something it could take, or the world itself refuses
a move (a partition the action never declared, a selection past the host's
candidate cap), the check says it could not run and why.

The one thing you may remove is a **redundant start button**, below. Note what
that is not: it hides one button while the panel keeps rendering everything
else, including every choice of the action once it is under way. The panel never
goes away, and it never offers less than the board.

`platformActionPanelEscapeHatch` is not an exception a game may reach for — it
is reserved for the host platform, which substitutes its own equivalent surface.

#### `.destructive()` marks the verb a player cannot take back

```typescript
Action.create('endSurvivor')
  .prompt('End this survivor, scattering everything you carry')
  .destructive()
  .execute(...)
```

Without it every verb in the bar is drawn in the same accent, so the action that
permanently ends a character looks exactly like the one that looks around the
room -- and because its prompt is usually the longest string, it is often the
widest button on a narrow screen as well. The most dangerous verb ends up the
most prominent one, and prominent in the way that reads as *primary*.

`.destructive()` is the game telling the shell which verb that is. The Action
Panel then draws it apart in four ways, **only one of which is colour**:

- a plate from the dedicated `--bsg-destructive-surface` / `--bsg-destructive-ink`
  token pair instead of the accent;
- an inset ring, which gives the button a different *shape* from every other one
  in the bar, so it still reads as set apart in greyscale;
- a marker glyph beside the label;
- the words "Destructive action." for a screen reader.

Use it for a move that cannot be taken back: eliminating a piece of your own,
conceding, razing something, spending a one-time resource for good. Do not use
it for merely expensive or merely bad moves. A bar where half the buttons are
marked warns about nothing.

**It is emphasis, not a gate.** It confirms nothing on its own, changes nothing
about availability, validation or execution, and is no substitute for a
confirmation step the action needs anyway.

**Do not remap the destructive tokens to a general status colour.** They are a
pair of their own precisely so this emphasis cannot be switched off by accident:
`--bsg-danger` and `--bsg-warn` are remapped freely by game themes (one theme in
the wild points `--bsg-warn` at its accent-hover colour), and emphasis resolved
through either would silently do nothing there. Override the destructive pair
only deliberately, and override **both** -- overriding one alone can strand the
label on a ground it does not contrast with.

A custom board reads the same flag off the same metadata
(`actionMetadata[name].destructive`), so the board and the panel cannot disagree
about which verb is the dangerous one -- the parity rule above applies to
emphasis exactly as it applies to everything else.

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
- **If every available action is suppressed, they are all shown anyway** --
  arranged by whatever `.group()` the game declared for them, not flattened. A
  button is only redundant while something else is offered; when nothing is, the
  panel is the player's last control. That guarantee exists because the
  alternative has a dead end in it: an action with **no selections** can never
  start a pick, so if its button were hidden the player would get a prompt,
  nothing to press, and no mid-pick choice list to fall back on either — a state
  with no way out.

Design the board affordance as the primary path, not the only one.

#### `.group()` and `.order()` arrange the start buttons

A game with many simultaneously available verbs gives a rare administrative one
the same prominence as the one the player takes every turn. `.group()` puts an
action's **start button** inside a named menu group, and `.order()` places
buttons within a level:

```typescript
Action.create('construct').prompt('Construct building').order(10).execute(...)
Action.create('upgrade').prompt('Upgrade building').order(20).execute(...)

Action.create('dumpOre').prompt('Dump ore').group('Dump').order(30).execute(...)
Action.create('dumpWater').prompt('Dump water').group('Dump').order(31).execute(...)

Action.create('skipMission').group('More').order(80).execute(...)
Action.create('renamePlanet').group('More', 'Empire settings').order(90).execute(...)
```

The panel then offers `Construct building`, `Upgrade building`, `Dump` and
`More` at the top level. `Dump` takes one button; its two members appear when
the player opens it, with a `Back` button and the current level's name beside
them. `More` opens onto `Skip mission` and a nested `Empire settings`.

Each argument to `.group()` is one level, outermost first, and intermediate
groups are created by being named. **A segment is the group's label and its
identity at once**, which is why there is nothing to register: two actions in
the same group cannot disagree about what it is called, and there is no id to
leave dangling. `.order()` takes any finite number, lower first; an action that
declares none sorts as `0`, ties keep the order the actions became available in,
and **a group sits where its lowest-ordered member sits** -- so there is no
separate order to declare for a group, and no way for two of its members to
disagree about where it goes.

##### A group is navigation, not a game command

**Opening or closing a group submits no order, consumes no turn, and moves no
persistent state.** The panel derives the menu from the action metadata it
already has and keeps the open path in its own local state. There is no group
callback to write and no group event to handle, because there is nothing for the
rules to be told.

##### What grouping does not change

- **Availability.** Only currently-available actions reach the menu, so a group
  whose members all went away is simply not there, and a group that gains one
  shows it. It never hides an available action: the action is one press further
  away, not gone. If the level a player is standing in empties underneath them
  they are put on the deepest level that survived, and a screen reader is told
  why.
- **Executability.** `.condition()`, `.disabled()` and `.validate()` are
  untouched. A grouped action's disabled reason and its help popover render
  inside a group exactly as at the top level, and the server validates it
  identically.
- **The board.** Grouping arranges the panel's buttons; it does not change what
  the game offers, so a custom board UI is unaffected and the two surfaces still
  show the same state.
- **A game that declares nothing.** With no `.group()` anywhere the panel is the
  flat list it has always been, with no menu chrome at all.

##### How it relates to `.suppressFromActionPanel()`

They are one mechanism with two halves, and they are deliberately not allowed to
disagree: **suppression decides membership** (which actions are drawn) and
**grouping decides arrangement** (where each drawn button sits). So when the
all-suppressed fallback above restores the list, it restores it *as the game's
hierarchy* -- never as a flat list, which would be the fallback overruling the
arrangement the game declared.

##### Keyboard and screen reader

A group's button is an ordinary button in the tab order; its accessible name
says it opens a submenu and how many actions are behind it. `Enter` opens a
level and moves focus to its first action. `Escape` and `Back` each go up
exactly one level and put focus back on the button that opened it. The current
level's name is on screen, and a live region says so when a level moves for a
reason that is not the player's.

##### It is the same metadata in world mode

`.group()` and `.order()` are `WorldAction` verbs too, and a world's offer *is*
action metadata, so the shared panel gets the same hierarchy in a world as at a
table with nothing translated in between. This is the case the feature was asked
for: a resident world offers every verb that is relevant at once.

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

### A Follow-up Holds Its Seat

A follow-up belongs to the seat whose action returned it, and each seat has its
own: in a simultaneous step, another seat's action never replaces it. The flow
publishes the follow-ups the open step holds as `FlowState.followUps`, each with
its `seat`, and only that seat is offered the follow-up or may take it. Another
seat that tries is refused with "'collectEquipment' is not one of your actions
right now."

While a seat holds a follow-up, the step keeps it:

- in an `actionStep`, the turn stays with that seat, even if the step offers it
  nothing else;
- in a `simultaneousActionStep`, the seat is not marked done (whatever
  `playerDone` says), so with the default `allDone` the step waits for it.

There is no separate "decline". The seat drops its follow-up only by taking
another action the step offers it; a refused action leaves it held.

Two things end a hold anyway, by ruling:

- **A custom `allDone` wins.** It is the one exception to the hold inside the
  step: when a game's own `allDone` ends a simultaneous step, the follow-ups the
  step held end with it.
- **Host deadlines always win.** When a host deadline passes, a timed step's
  window or any deadline the host keeps itself on any step (a table's
  hours-long round, say), the host closes each seat still due with an
  `expireSeat` op naming the game's `idleAction`. The step needs no time limit
  for the op: the deadline is the host's. A seat holding a follow-up takes the
  idle action if the step offers it (which drops the follow-up, like any other
  action); if the step does not offer it, the follow-up is dropped and the
  seat's part ends as if it had finished: the turn passes on (`actionStep`), or
  the seat is marked done (`simultaneousActionStep`). No action runs then, so
  the action history
  records a **seat expiry** instead (`{ kind: 'seatExpiry', player, undoable:
  false }`, a `HistoryEntry` beside the `SerializedAction` entries): a replay
  of the history closes the seat again at the same point, and undo counts it
  but never reaches behind it, because a closure the host made is not the
  seat's to take back. See `timeLimitMs` below.

So **an optional follow-up needs a way out**: give the follow-up action a
"done" choice, or list an end action (such as `endTurn`) in the step. A seat
held for a follow-up that has no valid choice cannot move on, and in
development the engine warns about it.

Undo to the turn start reaches back over every action of a chain: the step's
undo boundary counts actions, each link of a chain included, while move limits
(`maxMoves`, `minMoves`) count a whole chain as one move.

A follow-up normally reaches the client in the result of the action that
returned it. The seat's own published state carries it too
(`PlayerGameState.followUp`), and the table starts it from there when no action
is in progress, so a page reloaded mid-chain picks it back up. One the player
cancels is not restarted on its own, so the player can take another offered
action, but it stays one click away: the Action Panel shows a button for it
whenever no action is in progress (`data-bs-follow-up`), and a custom UI calls
the controller's `resumeFollowUp()`, reading `heldFollowUp`.

The follow-up runs with the args it was published with, and its `condition` is
not checked (the chain offers it, not the condition). The seat may take it pick
by pick, as the UI does, or as one whole action: bots do the latter, and
`enumerateLegalMoves` lists a held follow-up's moves for its seat.

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

**Option 1: Pass objects with a `name` or `label` property**

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

A chip reads an object arg by one rule, the same one the server labels a
choice with: its `name`, else its `label`, else the object as JSON. A `display`
field is ordinary data and is not read, and neither is a `value` field, so
`{ value: 3 }` shows as `{"value":3}`. Your follow-up action's helpers should
handle both formats:

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
      boardRefs: (seat, ctx) => {
        const targetPlayer = game.getPlayer(seat) as GoFishPlayer;
        return { refs: [{ ref: { id: game.getPlayerHand(targetPlayer).id }, role: 'target' as const }] };
      },
    })
    .chooseFrom('rank', {
      prompt: 'What rank do you want?',
      choices: (ctx) => game.getPlayerRanks(ctx.player),
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
      const player = ctx.player;
      // playerChoices offers { value: seat, label: name }, so args.target is the seat
      const target = game.getPlayer(args.target) as GoFishPlayer;
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

Name your game once, on the return type, and every callback in the flow is typed
to it: `ctx.game` is `MyGame` and `ctx.player` is `MyPlayer`, with no casts.

<!-- typecheck: game src/rules/flow.ts -->
```typescript
import { loop, eachPlayer, actionStep, type FlowDefinition } from 'boardsmith';
import type { MyGame } from './game.js';

export function createGameFlow(): FlowDefinition<MyGame> {
  return {
    root: loop({
      name: 'game-loop',
      maxIterations: 100,
      do: eachPlayer({
        do: actionStep({ actions: ['actionName'] }),
      }),
    }),
  };
}
```

A flow definition is a plain object. It says how play proceeds, not how it
ends: the end and the winners are declared on your `Game` (see "Ending the
game" below).

**Two things to know about how the type reaches your callbacks.**

`ctx.player` is **optional** in a flow context (`MyPlayer | undefined`) and
required in an action context. That is not an oversight: a `loop` or an
`execute` can sit outside any player-scoped step, and the type says so. Inside an
`eachPlayer` body it is always set, so guard once and carry on:

```typescript
execute((ctx) => {
  if (!ctx.player) throw new Error('Turn setup ran with no active seat.');
  ctx.game.startTurn(ctx.player);
})
```

The game type flows **downward through nesting**, so a builder written directly
inside `root:` (or inside another builder's `do:`) needs no type argument. It
does NOT reach a node you store in an intermediate `const`, because a standalone
`const` has no surrounding type to infer from. Annotate those:

```typescript
// Inferred: nested inside a FlowDefinition<MyGame>, so ctx is concrete.
root: loop({
  maxIterations: 100,
  while: (ctx) => !ctx.game.isFinished(),
  do: eachPlayer({ do: actionStep({ actions: ['play'] }) }),
})

// Annotated: an intermediate const has nothing to infer from.
const playerTurn: FlowNode<MyGame> = sequence(
  execute((ctx) => ctx.game.startTurn(ctx.player!)),
  actionStep({ actions: ['play'] }),
);
```

### Ending the game

A game ends the moment it is finished, wherever the flow is. Any of these
finishes it:

- an action or an `execute()` calls `game.finish([winner])`,
- your game's own `isFinished()` override starts returning true, or
- the flow runs out of nodes.

**The game declares its end and its winners, and only the game.** Call
`finish(winners)`, or override `isFinished()` and `getWinners()` on your `Game`
subclass. Every reader takes the result from there: the host shows players
`game.getWinners()`, and the bot's search and the benchmark score the same
seats. A flow definition has no `isComplete` or `getWinners`: `setFlow()`
refuses a definition that has either, or any key other than `root`, `setup`,
`onEnterPhase` and `onExitPhase`, rather than ignoring it.

```typescript
class MyGame extends Game<MyGame, MyPlayer> {
  override isFinished(): boolean {
    return this.players.some((p) => p.score >= 10);
  }

  override getWinners(): MyPlayer[] {
    return this.isFinished() ? this.players.filter((p) => p.score >= 10) : [];
  }
}
```

The flow engine checks before every node, so once the game is finished no
further node runs and no seat is offered an action, not even a `followUp` the
finishing action asked for. That holds in every construct: `eachPlayer`,
`loop`, `sequence`, `repeat`, `forEach`, `phase`, a `simultaneousActionStep`
with seats still to act, `turnLoop` and `stateAwareLoop` alike. A loop's
`while` therefore only needs the loop's own condition; it does not have to test
`isFinished()`.

Put anything that must happen at the end (final scoring, a closing message)
into the code that finishes the game, before it calls `finish()`. A node placed
after the main loop does not run when an action finished the game.

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
  while: (ctx) => !ctx.game.isFinished(),
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
    ctx.game.scoreHand(player);
  }),
})
```

#### `actionStep` - Wait for player action

```typescript
actionStep({
  name: 'move-step',
  actions: ['move', 'jump'],      // Available actions
  skipIf: (ctx) => ctx.game.isFinished(),
})
```

##### `turnScope` - say whether a re-entry continues the turn

Undo reach is measured per action-step **frame**: `moveCount` lives on the frame,
and `computeUndoInfo` anchors the rewind at `actionHistory.length - moveCount`.
A step that stays open via `repeatUntil` keeps one frame, so the count
accumulates. A step **re-entered** -- from a `loop` iteration, or as the next
step of a `sequence` -- gets a NEW frame, and the count starts again.

That matters whenever the same seat is prompted again straight after its own
action: a multi-jump, an extra turn, the second step of a multi-step turn. The
frame boundary is not a turn boundary there, and without a declaration the seat
cannot take back the action it just took.

The engine cannot infer which was meant, because the two readings have the same
shape. A `sequence` of same-seat action steps is ONE turn in Polyhedral Potions
and THREE separate turns in the library's own solo-undo fixture. So the step
says which:

```typescript
loop({
  name: 'move-loop',
  maxIterations: 20,
  while: (ctx) => !ctx.get('turnComplete'),
  do: actionStep({
    name: 'move-step',
    actions: ['move', 'endTurn'],
    // One continuing turn: undo reaches back over the whole run.
    turnScope: 'continue',
  }),
})

loop({
  name: 'turns',
  maxIterations: 1000,
  while: (ctx) => !ctx.game.isFinished(),
  do: actionStep({
    name: 'take-turn',
    actions: ['play'],
    // Each pass is a new turn: undo does not reach behind it.
    turnScope: 'restart',
  }),
})
```

`turnScope` is consulted **only** on an ambiguous entry -- the same seat, in a
new frame, immediately after its own action. The first action of the game, a
step held open by `repeatUntil`, and any step reached after a DIFFERENT seat
acted all have nothing to carry, so most steps never need it.

Leave it out on an ambiguous step and the engine warns in dev naming the step,
and any undo attempted there is refused with the reason rather than with the
misleading "No actions to undo".

On a `'continue'` step, `minMoves`/`maxMoves` bound the whole run rather than
the single entry -- which is the same thing when the run is one turn.

`turnLoop` and `stateAwareLoop` forward `turnScope` to the action step they
build, and leave it undeclared by default for the same reason.

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

#### `timeLimitMs` - a step that closes on a clock

`actionStep` and `simultaneousActionStep` both accept `timeLimitMs`: how long the
step stays open once it is entered, in milliseconds.

```typescript
simultaneousActionStep({
  name: 'deploy',
  actions: ['placeUnit', 'ready'],
  playerDone: (ctx, player) => player.ready,
  timeLimitMs: 120_000, // two minutes
})

// Or resolved from state when the step is entered:
actionStep({
  name: 'turn',
  actions: ['move', 'pass'],
  timeLimitMs: (ctx) => (ctx.game.round === 1 ? 60_000 : 30_000),
})
```

- It is resolved **once, when the step is entered**, and fixed while the step
  stays open: a seat submitting mid-round does not move it. The next entry (the
  next round of a `loop`, the next seat of an `eachPlayer`) resolves its own.
- It must be a whole number of milliseconds, and at least
  `MIN_STEP_TIME_LIMIT_MS` (10 000, ten seconds). The host needs time to close
  a step, so a shorter window would be over before it could. A bad number is
  refused when the flow is built; a function that answers one is refused when
  the step is entered. Both errors name the step.
- It is a **duration, never an instant**. The engine keeps no clock and never
  closes the step itself. It publishes the value as `FlowState.timeLimitMs` and
  on the host's turn boundary (`meta.turnBoundary.timeLimitMs`), and the host
  closes the step when the window elapses with one `expireSeat` op per
  seat that has not acted, naming your `idleAction`. That op is the host's
  alone: no client message maps to it, so a player cannot close a seat by
  dressing an action up as a timeout. The same op closes a seat at any other
  deadline the host keeps, on a step with no time limit too. Time limits always
  win: a seat holding a follow-up is closed too, by the idle action when the
  step offers it, and otherwise by dropping its follow-up and ending its part,
  which the history records as a seat expiry (see "A Follow-up Holds Its
  Seat").
- So a game with a timed step **must declare `idleAction`** in
  `boardsmith.json`. `boardsmith validate` and `boardsmith build` refuse it
  otherwise, naming the step. A bot is not an alternative: a timed-out seat is
  never handed to a bot.
- `boardsmith build` stamps `capabilities.timedSteps: true` into the manifest
  when any step of the compiled flow declares a limit.
- `boardsmith dev` enforces the window locally, the same way the platform
  does. The dev host starts one timer when the step opens, sends the deadline
  on every `game_state` frame (so `turnDeadline` and the Action Panel count
  down), and when it runs out submits `idleAction` for every human seat still
  due. A bot seat is left to its bot. If the game refuses the idle action, or
  the idle action does not move the round on, the terminal and every browser
  show an error saying so. **End step** in the Dev bar closes the open step
  straight away, so you do not have to wait out a long window. New game, and
  applying lobby options, clear the timer.

See [simultaneous-and-interrupt-semantics.md](./simultaneous-and-interrupt-semantics.md)
section 5 for who enforces what.

#### `phase` - Named game phase

```typescript
phase('setup', {
  do: sequence(
    execute((ctx) => ctx.game.deal()),
    simultaneousActionStep({ actions: ['discard'] }),
  ),
})
```

#### `switchOn` - Conditional branching

```typescript
switchOn({
  on: (ctx) => ctx.game.currentPhase,
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

**Undo crosses an `execute()` by default.** Everything the step touches is game
state, and undo restores state from a checkpoint, so it reproduces the step's
effect exactly. This is the right default for the common case — flow bookkeeping,
derived values, messages:

```typescript
// Bookkeeping. Undo may cross it.
execute((ctx) => ctx.set('turnComplete', true))
```

**Mark a step `{ irreversible: true }` when a restore cannot honestly take it
back**, and the case that matters is *information reaching a human*. Restoring
the tree un-deals a card; it cannot un-see it. That would let a player look at
a hand, undo, and keep what they learned:

```typescript
// The hand is in a player's eyes the instant this completes.
execute((ctx) => ctx.game.deck.deal(ctx.game.players, 7), { irreversible: true })
```

An irreversible step **fences undo and rewind**: no restore may target an action
before it — for the rest of the game, not just the current turn.

Decide with one question: *if the engine restored the snapshot from just before
this step, would anything be wrong?* Not "is this step important". Scoring,
moving pieces, and drawing into a face-down hand are all state, and state
restores. Marking a bookkeeping step needlessly is not a safe default — it
silently disables undo and debug rewind from that point on.

#### Undo and randomness — `undo: { fenceRandomRewind: true }`

Undo restores the seeded generator's position along with the state, so redoing
the **same** action after an undo cannot re-roll. What *can* re-roll is
**reordering**: undo, take some other action that also draws, then take the
drawing action again — it now lands on a different generator position. A player
alone in a private session with unlimited undo can repeat that until the roll
suits them, and nobody observes it.

Declare the fence on any **competitive** game:

```typescript
export const gameDefinition = {
  // ...
  undo: { fenceRandomRewind: true },
};
```

An undo whose span consumed a draw is then refused. Each draw happens exactly
once no matter how the actions around it are ordered: reordering *before* a draw
without observing it carries no advantage (the value depends only on the
generator position, which non-drawing actions never move), and observing a draw
fences the rewind. The player is not offered that undo either: the seat's
`canUndo` is decided by the same rule the server applies, so the Undo button and
the "Undo last action" menu item are off after a draw rather than answering a
click with the refusal.

Leave it off for cooperative and solo games, where a take-back is a feature.
It is off by default for that reason.

The fence has nothing to say about a player who abandons a private session and
starts a new one — a fresh start mints a new seed. A session that must be immune
to *that* has to consume no randomness at all; hosts declare such a session with
`hostOptions.randomness: 'forbidden'`, and every draw in it fails loudly.

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

Complex multi-phase flow, condensed from the Cribbage example game (bodies
marked `// ...` are trimmed; see `src/rules/flow.ts` in the game for the full
version):

```typescript
export function createCribbageFlow(): FlowDefinition {
  // Discard phase - both players discard 2 cards at the same time
  const discardPhase = phase('discarding', {
    do: simultaneousActionStep({
      name: 'simultaneous-discard',
      actions: ['discard'],
      playerDone: (ctx, player) => {
        const game = ctx.game as CribbageGame;
        return game.getPlayerHand(player as CribbagePlayer).count(Card) <= 4;
      },
      allDone: (ctx) => {
        const game = ctx.game as CribbageGame;
        return game.allPlayersDiscarded() || game.isFinished();
      },
    }),
  });

  // Play phase - players alternate playing cards one at a time
  const playPhase = phase('play', {
    do: sequence(
      execute((ctx) => { /* reset the running total; non-dealer leads */ }),

      loop({
        name: 'play-loop',
        while: (ctx) => {
          const game = ctx.game as CribbageGame;
          return !game.allCardsPlayed() && !game.isFinished();
        },
        maxIterations: 100,
        do: sequence(
          // Reset the count once both players are stuck ("Go")
          execute((ctx) => { /* ... */ }),

          // The current player plays one card or says Go
          actionStep({
            name: 'play-or-go-step',
            turnScope: 'continue',
            player: (ctx) => (ctx.game as CribbageGame).getCurrentPlayPlayer(),
            actions: ['playCard', 'sayGo'],
            skipIf: (ctx) => { /* finished, no cards left, or already said Go */ },
          }),

          // Pass the turn unless the other player has said Go
          execute((ctx) => { /* ... */ }),
        ),
      }),

      // Award the "last card" point
      execute((ctx) => { /* ... */ }),
    ),
  });

  // One complete round
  const playRound = sequence(
    // Shuffle and deal. Undo must not reach back past cards players have seen.
    execute((ctx) => (ctx.game as CribbageGame).startNewRound(), { irreversible: true }),
    discardPhase,
    execute((ctx) => (ctx.game as CribbageGame).storeOriginalHands()),
    execute((ctx) => (ctx.game as CribbageGame).cutStarterCard(), { irreversible: true }),
    playPhase,

    // Score hands and crib, then wait for a player to acknowledge
    phase('scoring', {
      do: sequence(
        execute((ctx) => (ctx.game as CribbageGame).scoreRoundAndBuildSummary()),
        simultaneousActionStep({
          name: 'acknowledge-round-summary',
          actions: ['acknowledgeScore'],
          allDone: (ctx) => {
            const game = ctx.game as CribbageGame;
            return game.isFinished() || !game.roundSummary.active;
          },
        }),
      ),
    }),

    // Rotate dealer for the next round
    execute((ctx) => { /* rotateDealer(), hide the crib again */ }),
  );

  return {
    root: sequence(
      execute((ctx) => (ctx.game as CribbageGame).createDeck()),

      loop({
        name: 'game-loop',
        while: (ctx) => !(ctx.game as CribbageGame).isFinished(),
        maxIterations: 100,
        do: playRound,
      }),

      execute((ctx) => { /* announce the winner, skunk or double skunk */ }),
    ),

    onEnterPhase: (phaseName, ctx) => { /* set game.cribbagePhase, announce the phase */ },
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

<!-- typecheck: game src/rules/game.ts -->
```typescript
import { Game, Player, type GameOptions } from 'boardsmith';
import { createMyAction } from './actions.js';
import { createGameFlow } from './flow.js';

export class MyPlayer extends Player<MyGame, MyPlayer> {
  gold = 0;
}

export class MyGame extends Game<MyGame, MyPlayer> {
  static PlayerClass = MyPlayer;

  constructor(options: GameOptions) {
    super(options);
    // ... element setup ...

    this.registerAction(createMyAction());

    this.setFlow(createGameFlow());
  }
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
  choices: (ctx) => ctx.game.validTargets,  // Returns element objects
  display: (target) => target.name,
})

// Custom UI can send the element ID directly
props.action('attack', { target: target.id });  // Works!
```

### Detailed Validation Errors

When a submitted value is not among the current choices, the error the player
reads is plain and says what to do, and the detail for you (the value sent and
the valid choices) is written to the dev log:

```typescript
// Response:
{
  success: false,
  error: 'That choice is no longer available. Things changed while you were choosing, so please choose again.'
}
// Dev log:
// [BoardSmith] Invalid selection for "target": "invalid-value". Valid choices: [Militia #1, Militia #2, genesis] ...
```

A game can replace the player's sentence with the selection's `unavailable`
option; see [`unavailable`](#unavailable--a-choice-that-is-no-longer-listed).

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
