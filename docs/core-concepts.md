# Core Concepts

This document explains the fundamental concepts and architecture of BoardSmith.

## Overview

BoardSmith uses a hierarchical element tree to represent game state, with a clear separation between:
- **Actions** (what players do) - high-level, game-specific, defined with `Action.create(...)`
- **Element mutation** (how state changes) - direct property/tree mutation inside an action's `execute` callback; there is no generic replayable command layer

## Element Tree

Games are represented as a tree of `GameElement` objects:

```
Game (root)
├── Board/Grid/Deck (Spaces - containers)
│   ├── Piece/Card (game pieces)
│   └── More spaces...
├── Player Hands (Spaces)
└── Pile (removed elements)
```

### Element Types

| Class | Purpose | Example |
|-------|---------|---------|
| `GameElement` | Base class (never instantiate directly) | - |
| `Space` | Container for other elements | Board, pile, zone |
| `Deck` | Stack of cards (shuffleable) | Draw pile, discard |
| `Hand` | Player's private cards | Player's hand |
| `Grid` | Square grid | Chess/checkers board |
| `HexGrid` | Hexagonal grid | Hex game board |
| `Piece` | Physical game piece | Checker, stone |
| `Card` | Playing card | Standard deck card |

### Creating Elements

Elements are created as children of other elements:

```typescript
// In your Game constructor
class MyGame extends Game<MyGame, MyPlayer> {
  constructor(options) {
    super(options);

    // Register element classes (required for serialization)
    this.registerElements([Card, Hand, Deck, Board]);

    // Create elements as children of the game
    this.deck = this.create(Deck, 'deck');
    this.board = this.create(Board, 'board');

    // Create cards inside the deck
    for (const suit of suits) {
      for (const rank of ranks) {
        this.deck.create(Card, `${rank}${suit}`, { suit, rank });
      }
    }
  }
}
```

### Element Operations

```typescript
// Query elements
const card = deck.first(Card);              // First card
const cards = deck.all(Card);               // All cards
const count = deck.count(Card);             // Count cards
const aceOfSpades = deck.first(Card, c => c.rank === 'A' && c.suit === 'S');

// Move elements
card.putInto(hand);                         // Move card to hand
card.putInto(hand, { position: 'first' }); // Put at beginning

// Remove elements
card.remove();                              // Remove from game

// Create elements
const stone = cell.create(Stone, 'stone-1', { player });

// Shuffle (Deck only)
deck.shuffle();

// Element ordering
deck.setOrder('stacking');                  // Last in, first out
```

### Custom Element Classes

Extend base classes to add game-specific properties:

```typescript
// elements.ts
import { Card as BaseCard, Piece as BasePiece } from 'boardsmith';

export class Card extends BaseCard {
  suit!: 'H' | 'D' | 'C' | 'S';
  rank!: string;

  get value(): number {
    const values: Record<string, number> = { 'A': 1, 'J': 11, 'Q': 12, 'K': 13 };
    return values[this.rank] ?? parseInt(this.rank);
  }
}

export class CheckerPiece extends BasePiece {
  player!: CheckersPlayer;
  isKing: boolean = false;

  promote(): void {
    this.isKing = true;
  }
}
```

## Visibility System

Control what each player can see.

### Element Visibility

```typescript
// Make contents visible to everyone
deck.contentsVisible();

// Hide contents from everyone
deck.contentsHidden();

// Only owner can see contents
hand.contentsVisibleToOwner();
```

### Attribute Visibility

`static visibleAttributes` whitelists which attributes of an element are sent
to non-owners (players other than the element's effective owner, and
spectators). When declared, every attribute NOT in the list is redacted from
the game view for everyone except the owner. When left `undefined` (the
default), every attribute stays visible to everyone — this is public-by-default,
so existing custom attributes keep working with zero configuration.

```typescript
class Card extends BaseCard {
  suit!: Suit;
  rank!: Rank;
  secretValue!: number;  // Redacted from non-owners' game view

  // Non-owners only ever see suit and rank; secretValue is stripped server-side
  static visibleAttributes = ['suit', 'rank'];
}

class MyPlayer extends Player<MyGame, MyPlayer> {
  score = 0;
  secretPlan = '';     // only this seat sees it

  // A player's name, seat, colour and status are sent anyway; list only your own.
  static visibleAttributes = ['score'];
}
```

**A player's identity is never the list's to withhold.** A `Player` always
sends its `name`, `$type`, `seat`, `color`, `colorLabel` and `status` to every
seat, whatever its `visibleAttributes` says, so an opponent's name and colour
stay on the table and a field the engine adds to `Player` later reaches every
seat without each game re-listing it. A player's list names only your game's
fields, and naming one of the identity fields in it is refused with an error
that says which.

On every other element the list governs every attribute it sends, the
engine-defined ones included: leave `player`, `row`, `column` or `$image` out
and other seats are not told the owner, the position or the artwork.

This is attribute-level redaction, not element-level hiding — the element
itself (and its whitelisted attributes) is still present in the view. To hide
an entire element or an entire zone's contents, use the element/zone
visibility controls below instead.

**A hidden ELEMENT withholds everything, not just the non-whitelisted.** An
element the view cannot see (`showOnlyTo` / `hideFrom`, or any child of a
hidden, count-only or owner-only zone) is replaced by a placeholder carrying
its `$type`, its face-down artwork and nothing else. Every game attribute it
would have carried is withheld on restore, the whitelist included: a
whitelisted attribute is one non-owners may see ON A VISIBLE ELEMENT, and it
never rode the wire for a placeholder. What the placeholder does carry stays
known and unforgeable, so a search can still see that a card is in a
particular hand without seeing what it is.

**The game ROOT redacts the same way.** Declare `static visibleAttributes` on
your `Game` subclass and every root field outside the list is withheld from
every seat, on the wire and on restore. Fields the ENGINE owns on the root
(`phase`, `settings`, `tutorialProgress` and the rest) are never swept up by
that list, and naming one in it is refused: their audience is the engine's to
decide, and it narrows the per-seat ones itself.

```typescript
class MyGame extends Game<MyGame, MyPlayer> {
  static visibleAttributes = ['round'];  // every other root field is withheld

  round = 1;
  mapSeed = '';       // reading this in another seat's view throws
}
```

**A withheld attribute holds nothing, and says so.** A redacted view is not
only a wire payload: a bot's MCTS search restores its own seat's view as a
live game and computes moves against it, for every seat the flow is awaiting.
So an attribute the view withheld comes back with no value at all — reading it
throws `RedactedAttributeError` rather than quietly handing back whatever the
class field was initialized to. `0` is a real square, `[]` is a real empty
hand, and a search that reasons from either is confidently describing a world
that does not exist.

Ask before you read anything a rule may have to evaluate for another seat:

```typescript
.chooseFrom('steal', {
  choices: (ctx) => {
    const rival = ctx.game.getPlayer(otherSeat)!;
    if (rival.isAttributeRedacted('pack')) return [];  // nothing to offer
    return rival.pack;
  },
})
```

`element.redactedAttributes` lists everything withheld from this copy. In the
authoritative game nothing is ever redacted, so these read `false` and `[]`
there and the guard costs nothing.

An unguarded read inside move enumeration is not a crash: `RedactedAttributeError`
is a `NotSimulableError`, so the action simply contributes no move for that
seat (with a dev warning naming the action and the attribute) — the honest
answer, rather than a move scored against an invented value. Making the action
searchable again means deriving its `condition`, `choices`, `disabled` and
`validate` from public information, or guarding as above.

### Computed (Per-Seat) Attributes

`static visibleAttributes` is a whitelist over attributes the element **already
stores**. That is the wrong shape for a value whose visibility depends on a
fact that can change: the value has to be stored already-gated, and every write
path that can change the gating fact has to remember to re-derive it. Miss one
path — another character takes the item, an event destroys it — and the stale
gated value is served until that seat happens to issue a command that rewrites
it.

`static seatAttributes` computes the value instead, when the element is
serialized **for a seat**:

```typescript
class Character extends Space<MyGame> {
  cell = 'AB-2';          // real state, always stored

  static seatAttributes = {
    // Present only while this character is carrying a GPS unit.
    coordinates: (character: Character) =>
      character.first(Gps) ? character.cell : undefined,

    // The receiving seat is the second argument (null for a spectator).
    ownReading: (character: Character, seat: number | null) =>
      character.player?.seat === seat ? character.reading : undefined,
  };
}
```

What the hook guarantees:

- **Evaluated at projection time, per receiving seat.** Every per-seat view
  goes through one serializer (`Game.toJSONForPlayer`, and the batched
  `toJSONForPlayers` under it), so a derivation runs for every view a seat can
  receive — a table's player view, a snapshot taken `forSeat`, a bot's redacted
  clone, and a world's `viewFor`.
- **Never stored.** `toJSON()` (checkpoints, storage, a world's partitions)
  carries no derived attribute, and a restore of a per-seat view does not turn
  one back into a stored field. There is nothing to keep in step, so there is
  nothing to go stale.
- **`undefined` means absent.** That is how a gate closes: the attribute is
  simply not in that seat's view.
- **The derivation is the gate, so `visibleAttributes` does not filter it.** It
  already knew the seat; running it through a whitelist written for stored
  attributes would only make you declare the same name twice.
- **Nothing derives for an element the seat cannot see.** A hidden element is a
  placeholder, and a placeholder carries no derived attributes.

And what it refuses, loudly, at projection time:

- a derived name the element also stores, or one the engine owns (`name`,
  `player`, `$image`, …) — two sources for one attribute is the hazard this
  removes;
- a derivation that throws — the error names the class, the attribute and the
  receiving seat;
- a derived value JSON cannot carry (a function, a symbol, a bigint) — the
  error names the path inside the returned value.

A derivation runs while state is being serialized: read state and return a
value, never write.

## Actions and State Mutation

BoardSmith separates player intent (actions) from state mutation (direct
element-tree writes). There is no generic replayable command layer between them.

### Actions (High-Level)

Actions are what players do - game-specific operations with prompts, selections, and validation:

```typescript
const moveAction = Action.create('move')
  .prompt('Move a piece')
  .chooseElement('piece', { filter: p => p.player === ctx.player })
  .chooseElement('destination', { filter: c => c.isEmpty() })
  .execute((args, ctx) => {
    args.piece.putInto(args.destination);  // Mutates the tree directly
  });
```

### State Mutation (Direct, Not Command-Based)

Element methods like `putInto()`, `remove()`, `shuffle()`, and property
assignment (`player.score += 10`) mutate the live element tree directly and
record nothing. There is no per-operation generated-object layer behind them,
and elements have no generic attribute-setter method — assign properties
directly instead (e.g. `card.faceUp = true`).

`Game#commandHistory` exists, but it is populated ONLY through
`Game#execute()`, an internal mechanism the engine uses for its own ANIMATE
event stream (see `game.ts`'s `execute()`/`replayCommands()`). Game rule code
never calls it and should not rely on it — it is not a general-purpose audit
log or replay mechanism for game state.

### How State Actually Travels: Snapshots, Not Replay

BoardSmith is **state-authoritative**: the source of truth is the current
element tree, not a log of operations that produced it.

- **Networking**: Each player receives a filtered JSON view (`createPlayerView`)
  derived from the live tree, not a stream of commands.
- **Persistence / restore**: `runner.fromSnapshot()` restores a game directly
  from a captured snapshot (tree state + flow state + RNG state) — it does
  NOT replay commands or actions to rebuild state. This is deliberate: replaying
  an incomplete or ambiguous history was a real source of bugs in earlier
  designs (mis-positioned flow state on restore).
- **Undo**: Undo/redo, where supported, works from captured snapshots of prior
  states, not by reversing a command log.
- **Security**: Direct manipulation is prevented because players only ever
  call actions (validated, server-side) — never touch element methods
  themselves — not because of a command-layer indirection.

### Best Practices

```typescript
// DO: Mutate elements directly inside action execute functions
.execute((args, ctx) => {
  card.putInto(hand);
  player.score += 10;
});

// DON'T: Bypass actions for player-driven operations
// DON'T: Rely on commandHistory as a game-logic audit trail
```

## Player System

### Custom Player Classes

```typescript
// Declare extra fields with initializers — do NOT define a constructor.
// The engine instantiates players from `playerCount`, so a custom Player
// just adds the per-player state it needs.
export class MyPlayer extends Player<MyGame, MyPlayer> {
  hand!: Hand;                                          // Assigned in the Game constructor
  score: number = 0;                                    // Auto-serialized to gameView
  abilities: Record<string, number> = { reroll: 1 };   // Auto-serialized
}
```

Player-owned elements (like each player's `hand`) are created in the **Game** constructor, which loops over the already-instantiated `this.players`:

```typescript
class MyGame extends Game<MyGame, MyPlayer> {
  constructor(options: GameOptions) {
    super(options);

    for (const player of this.players) {
      player.hand = this.create(Hand, `hand-${player.seat}`);
      player.hand.player = player;
      player.hand.contentsVisibleToOwner();
    }
  }
}
```

> **Auto-serialization**: Public properties (like `score`, `abilities`) are automatically included in the game view sent to the UI. You do NOT need to override `toJSON()` for simple properties. Properties starting with `_` are private and not serialized.

### Player Properties

- `seat`: 1-indexed seat number (Player 1 has seat 1)
- `name`: Display name
- `game`: Reference to the game instance

### Accessing Players

```typescript
// In game class
this.players                    // Array of all players
this.getPlayer(1)               // First player (by seat, 1-indexed)
this.getPlayer(2)               // Second player
this.currentPlayer              // Player whose turn it is

// In action context
ctx.player                      // Current action's player
ctx.game.currentPlayer          // Current player from game
```

### Player Colors

Players automatically receive a `color` property from the engine's color palette:

```typescript
// In rules code
const myColor = player.color;  // '#e74c3c'

// In UI via gameView
const playerColor = gameView.players[playerSeat - 1].color;
```

The engine assigns colors from `DEFAULT_COLOR_PALETTE` based on seat order. It holds 16
entries — the maximum seat count any BoardSmith host supports — so a game never has to
supply its own palette just to reach a higher player count. To customize:

```typescript
export const gameDefinition = {
  // Custom color palette (optional)
  colors: ['#ff0000', '#0000ff', '#00ff00'],

  // Disable color selection in lobby (optional, default: true)
  colorSelectionEnabled: false,
};
```

When `colorSelectionEnabled` is true (the default), players can choose their color in the lobby and the UI automatically shows a color picker.

## Game State Serialization

BoardSmith automatically handles serialization for:
- Network transmission
- State persistence
- Replays

### Registering Elements

All **custom** element classes must be registered:

```typescript
this.registerElements([Card, Hand, Deck, Board, Piece]);
```

Built-in framework classes (`Die`, `Card`, `Piece`, `Hand`, `Deck`, `DicePool`,
`Grid`, `HexGrid`, ...) are auto-registered — you never need to list them
yourself, and polymorphic queries against a built-in base class (e.g.
`dicePool.all(Die)`) work without registration. You only register classes
*you* define, including subclasses of a built-in (e.g. `class IngredientDie
extends Die`). `startFlow()` validates this for you: if your flow queries an
element class that was never registered, it throws with the exact
`registerElements([...])` call to add. See
[Common Pitfalls #7](./common-pitfalls.md#7-element-class-registration).

### State Snapshots

Use utility functions from `boardsmith` for state snapshots:

```typescript
import { createSnapshot, createPlayerView } from 'boardsmith';

// Get complete state snapshot
const snapshot = createSnapshot(game, 'my-game');

// Get player-specific view (with visibility applied)
const playerView = createPlayerView(game, playerSeat);
```

### Player Views

Each player receives a filtered view of the game state:
- Elements inside hidden zones are redacted to a minimal shape (id/className +
  safe layout attributes only); non-owners never see their real attributes
- A declared `static visibleAttributes` whitelist further redacts individual
  attributes on visible elements for non-owners, and on the game root redacts
  the game's own root fields (see Attribute Visibility above)
- A declared `static seatAttributes` adds attributes COMPUTED for the receiving
  seat from live state (see Computed (Per-Seat) Attributes above); they are
  never stored, so they cannot be served stale
- Private zones of other players are hidden via `contentsHidden()` /
  `contentsVisibleToOwner()`
- Server-side information is stripped

### Element Ids Carry No Count

Every element has a numeric `id` that never changes and that every view,
selection, message and animation refers to it by. In a table game the id is
**opaque**: the game's creation counter run through a block cipher under a
64-bit key the engine mints for that game from the platform's cryptographic
random source. Ids are unique whole numbers from 0 to 2^32 - 1. What they are
not is ordered: a seat cannot tell from the ids it sees which element was
created first, or how many elements were created where it could not see them.
Creating elements in a hidden zone is therefore safe (#447).

The key is deliberately NOT derived from the seed. The game root's id is in
every seat's view, so a key a player could guess could be checked against it
offline, and a host's seed may be short: a 32-bit seed is searched in under an
hour. The key is recorded with the game's constructor options
(`GameOptions.elementIdKey`, carried in `snapshot.gameOptions`), so every
restore, undo checkpoint and bot search mints the same ids, and it is never
sent to a seat. Keep it as secret as the snapshot itself.

A host must never accept the key, or the seed, from a player. The engine's own
options (`ENGINE_OWNED_GAME_OPTION_KEYS`: `seed`, `elementIdKey`,
`playerCount`, the palette, ...) are minted by the engine or the host; what a
player chooses is limited to the options the game declared
(`GameDefinition.gameOptions`), and `selectGameOptions` in `boardsmith/session`
is the one way such a choice is admitted: it refuses an undeclared key, a
host-owned key and a value of the wrong type, and returns a
`GameOptionSelection`, which is the only thing `GameSession` and the lobby
will store. The stateless executor refuses `elementIdKey` on a `start` op
outright, since a new game mints its own. A host that assembles a game's
options itself must keep a client's object out of them, or hand it to
`selectGameOptions` first.

Two consequences:

- Never read anything into an id beyond identity: do not sort by it, compare
  it with `<`, or do arithmetic on it. Keep creation order in an attribute of
  your own when a rule needs it.
- The same seed no longer gives the same ids: two games from one seed shuffle
  alike but number their elements differently. A test that needs the same ids
  twice passes the same `elementIdKey` (16 hex digits) to both, and a saved
  state restores only into a game built with the key it was minted under; the
  restore refuses any other.

A world's ids are opaque too (#482), under a key its HOST keeps rather than
one the engine mints: a world outlives every process that runs it and keeps no
snapshot, so the host mints the key once when it creates the world
(`mintWorldElementIdKey` from `boardsmith/world`, 24 hex digits), stores it
with the world, and passes it on every wake (`createWorld`'s `elementIdKey`,
or `GameOptions.elementIdKey` for a world game built directly, which refuses
to construct without one). A world's cipher has a 48-bit block, so its ids run
from 0 to 2^48 - 1. See [persistent worlds](./persistent-worlds.md), "A
world's ids are keyed by a secret its host keeps".

The seed still has to be unguessable for a different reason: it decides every
shuffle and roll, so a host that hands the engine a guessable seed lets a
player predict them. A host should supply at least 128 bits from a
cryptographic random source. (The RNG itself currently keeps only 32 bits of
state whatever the seed, which is its own open problem: #483.)

A **world**'s ids are still its plain creation counter, because they are
durable across wakes and a world host may change the seed on every wake. In a
world, a seat can still count creations it could not see from the gaps in the
ids it does (#482).

### Secret Moves in a Simultaneous Step

In a simultaneous step a seat may act in secret: its move changes only what
that seat may see (an attribute withheld by `visibleAttributes`, a card in its
own hidden hand). Hiding the change is not enough on its own. If every move
sent every seat a fresh state, a seat whose board did not change would still
learn THAT someone moved, and when.

So BoardSmith's hosts never push a seat or a spectator a state identical to
the last one it was sent (#487). `GameSession` compares per connection;
`SnapshotSessionHost`, and so `boardsmith dev`, compares per seat and hands its
adapter only the views that changed. The platform adopts the same behaviour
when it re-vendors this engine. Two parts of the payload are compared
specially:

- A send time stamped on every push does not count as a change. It moves only
  when something else does.
- Animation events count only when the seat has not been sent them. The engine
  empties its animation buffer at the start of every move, so another seat's
  move emptying it is not news. An event sent with `animateTo` reaches only its
  audience; a public `animate()` reaches every seat, and so tells every seat
  that someone moved. If a secret move animates at all, use `animateTo`.

Animation event ids carry no count either: each seat (and the spectator)
numbers only the events it is sent, so another seat's private animations
leave no gap in its ids (#489). So an id means something only beside the seat
it was numbered for, and every state says which seat that is
(`PlayerGameState.viewerSeat`, 0 for a spectator). A page that changes seat
(the dev host's follower, a spectator taking a seat) starts counting again
from the new seat's numbers; GameShell does this for you.

A page that connects or reconnects is always sent the full state.

Two things still reach other seats when a seat acts in secret. Design around
them:

- **Undo turns off when another seat acts after you.** A seat can undo back to
  the start of its turn only while no other seat has acted since. If seat 2
  makes a secret move and then seat 1 makes one, seat 2's Undo control goes
  away, and the state that removes it tells seat 2 that another seat moved.
  Where that matters, let a seat change its secret choice with a game action
  (a "move my placement" action) rather than with undo.
- **The restore count rises when another seat undoes.** Every undo replaces the
  game's state, and every seat is told so through `restoreEpoch`, which the UI
  needs to drop element references from before the undo. So when seat 1
  undoes, every other seat receives a state and can tell that someone undid
  something, though not what.

## Snapshot Mode and World Mode

Everything above describes **snapshot mode**: the whole element tree is
resident in memory, `createSnapshot` writes all of it, and a restore rebuilds
all of it. Every published board game runs this way, and nothing in this
section changes that.

**World mode** (engine contract r17) is the other residency model, for a world
too large to hold at once. The platform keeps only the partitions a command
names resident; every other partition is *absent* from the element tree — not
stubbed, not lazily loaded, absent. `atId`, `all()` and `toJSON` therefore cost
O(resident) rather than O(world), with no change to how traversal or actions
behave.

```typescript
// World mode is declared at CONSTRUCTION, never switched on afterwards.
// A world's element id key is its host's: minted once, stored, passed on
// every wake (#482).
const game = new MyWorld({ playerCount: 200, seed, worldMode: true, elementIdKey: storedKey });

game.definePartition(regionId);  // this subtree loads/checkpoints/evicts as a unit

// hydrate a partition the platform has in storage
const region = game.adoptSubtree(parentId, storedRegionJson);

// after a command runs, ask which partitions it dirtied. ONE call, and it
// consumes: it reports what changed AND re-baselines from the same pass, so a
// command cannot pay for the resident set twice.
const dirty = game.takeTouchedPartitions();

// the pre-command copy to roll a refused command back to, out of the baseline
// the previous take already captured -- nothing is serialized to get it
const point = game.partitionBaseline(regionId);   // { parentId, bytes }

game.evictSubtree(regionId);     // residency change, not a game move: no onExit fires
```

Three things to know before using it:

- **It is a construction option, and there is no switch.** World mode writes
  element references in attributes as `{ __elementId }` instead of a positional
  branch path, because absence shifts every later sibling index. A tree that
  emitted branch refs and then switched would carry both formats, and the branch
  half would resolve against whatever happened to be resident. It cannot be
  turned on afterwards for the reason `GameOptions.randomness` cannot: a
  subclass constructor body runs after `Game`'s and builds the game's furniture,
  which is exactly the half most likely to hold references. World-mode calls
  throw in snapshot mode rather than quietly working.
- **The colour palette cycles rather than capping the seat count.** A table's
  sixteen colours are a legend a person reads side by side; a world of hundreds
  shows no legend, so seats past the end of the palette wrap. Colour is never
  the sole carrier of player identity — every entry also has a `colorLabel` —
  so two players sharing "Red" is a true fact about the world's size. Snapshot
  mode still refuses to overrun its palette, because a table asking for more
  seats than any host will run is a mistake worth failing on.
- **A partition's `Space` handlers belong in its own constructor.** `adoptSubtree`
  runs the grafted class's constructor; it has no earlier incarnation to
  re-capture `onEnter`/`onExit` from. A handler registered in the `Game`
  constructor for a partition that was not resident at construction time
  attaches to nothing and is silently lost.
- **The engine tracks touches, not contents.** It stores no partition names and
  no partition contents — the platform already knows what it hydrated. What the
  platform cannot see is which partitions a *move* dirtied, so that is the one
  half `takeTouchedPartitions()` supplies. Union it with the partitions you
  hydrated to get the checkpoint's dirty set.
- **The dirty-set pass is once per command, and taking it is what re-baselines.**
  Attribute changes have no write chokepoint to instrument, so they are found by
  serializing each resident partition and comparing it against its baseline.
  That is O(resident) and cannot be less, but it must not be a MULTIPLE of it:
  there is deliberately no idempotent "just look" getter, because when there was
  one the platform read it, then called a separate re-baseline that recomputed
  the identical fingerprints, and a command paid for the whole resident world
  twice before its rollback copy paid a third time (ShufflewickPub #316).

**Declaring a world, and what `boardsmith dev` then does.** A project's
`boardsmith.json` declares which BACKEND runs it:

```json
{ "name": "gloamhall", "backend": "world" }
```

There is no `--world` flag. `backend` is required on every project and has no
default, and `"world"` is what makes a game a world, so `boardsmith dev` reads
it and runs the project as a world -- through `createWorld`, the same runner the
hosting platform uses, which constructs the game with `worldMode: true` and the
world's element id key -- rather than as a table. One way to say it rather than
two. What the choice IMPLIES (no undo, no bots, no spectators; always
asynchronous, always joinable in progress) is resolved by `boardsmith build`
into the manifest's `capabilities` object, which is what every reader consults
instead of the backend's name. See [persistent worlds](./persistent-worlds.md)
for the world runner's contract and what a host must persist.

## Game Lifecycle

```
1. Constructor
   - Register elements
   - Create initial state
   - Register actions
   - Set flow

2. setup() - Called after constructor
   - Additional initialization

3. start() - Game begins
   - Flow starts executing
   - Players take actions

4. isFinished() returns true
   - Game ends
   - getWinners() called
```

## Game Definition Metadata

Games export a `gameDefinition` object that describes the game to the framework. This metadata enables:
- Game registration and identification
- bot configuration
- Quick-start presets

Lobby configuration (game options, player options, color palettes) is defined in `boardsmith.json`, not in the game definition. This ensures a single source of truth that both the dev server and the platform read from.

### Basic Structure

```typescript
// index.ts
export const gameDefinition = {
  gameClass: MyGame,
  gameType: 'my-game',
  displayName: 'My Game',
  minPlayers: 2,
  maxPlayers: 4,
  bot: {
    objectives: getMyGameObjectives,  // Optional bot support
  },
  presets: [ /* ... */ ],             // Optional quick-start presets
};
```

### Lobby Options (boardsmith.json)

Game options, player options, and color palettes are defined in `boardsmith.json`. The dev server reads these and injects them into the game definition automatically.

#### Game Options

Game-level configuration options that appear in the lobby. Defined as an array with `id` as the key field.

```json
{
  "gameOptions": [
    {
      "id": "boardSize",
      "type": "number",
      "label": "Board Size",
      "description": "Number of hexes per side",
      "min": 5,
      "max": 19,
      "step": 1,
      "default": 11
    },
    {
      "id": "variant",
      "type": "select",
      "label": "Game Variant",
      "choices": [
        { "value": "standard", "label": "Standard" },
        { "value": "speed", "label": "Speed Mode" }
      ],
      "default": "standard"
    },
    {
      "id": "allowUndo",
      "type": "boolean",
      "label": "Allow Undo",
      "default": true
    }
  ]
}
```

Option types: `number` (with min/max/step), `select` (with choices), `boolean`.

#### Player Options

Per-player settings that appear for each player slot in the lobby.

```json
{
  "playerOptions": [
    {
      "id": "role",
      "type": "select",
      "label": "Role",
      "choices": [
        { "value": "attacker", "label": "Attacker" },
        { "value": "defender", "label": "Defender" }
      ],
      "default": "attacker"
    }
  ]
}
```

#### Color Palette

Custom player colors for the color picker. If omitted, the standard 8-color palette is used.

```json
{
  "colorPalette": [
    { "hex": "#e74c3c", "label": "Red" },
    { "hex": "#3498db", "label": "Blue" },
    { "hex": "#27ae60", "label": "Green" }
  ]
}
```

Each entry needs a `hex` color value and a `label` for display. Plain hex strings are also accepted (e.g., `["#e74c3c", "#3498db"]`).

### Exclusive Player Options

For asymmetric games where exactly one player must have a specific role (e.g., 1 Dictator vs many Rebels), use the `exclusive` type in `playerOptions`:

```json
{
  "playerOptions": [
    {
      "id": "isDictator",
      "type": "exclusive",
      "label": "Dictator",
      "description": "Select which player is the dictator",
      "default": "last"
    }
  ]
}
```

The `default` field accepts `"first"`, `"last"`, or a player index number.

### Presets

Quick-start configurations for common game setups.

```typescript
presets: [
  {
    name: 'Quick Game',
    description: '7x7 board',
    options: { boardSize: 7 },
    players: [
      { color: '#e74c3c' },
      { color: '#3498db' },
    ],
  },
  {
    name: 'vs bot',
    description: 'Play against bot',
    options: { boardSize: 9 },
    players: [
      { isBot: false, color: '#e74c3c' },
      { isBot: true, botLevel: 'medium', color: '#3498db' },
    ],
  },
]
```

### Receiving Options in Game Constructor

Options are passed to your game constructor via `CreateGameRequest`:

```typescript
export interface CreateGameRequest {
  gameType: string;
  playerCount: number;
  playerNames?: string[];
  gameOptions?: Record<string, unknown>;    // From gameOptions
  playerConfigs?: PlayerConfig[];           // From playerOptions
  botPlayers?: number[];
  botLevel?: string;
}

// In your game
class MyGame extends Game<MyGame, MyPlayer> {
  constructor(options: MyGameOptions) {
    super(options);

    // Access game options
    const boardSize = options.boardSize ?? 11;

    // Access player configs (players are 1-indexed)
    for (const player of this.players) {
      const config = options.playerConfigs?.[player.seat - 1];  // configs array is 0-indexed
      if (config?.color) {
        player.color = config.color;
      }
    }
  }
}
```

## Example: Hex Game

A minimal but complete example from Hex:

```typescript
// game.ts
export class HexGame extends Game<HexGame, HexPlayer> {
  board!: Board;
  winner?: HexPlayer;

  constructor(options: HexOptions) {
    super(options);

    this.registerElements([Board, Cell, Stone]);

    // Create hex board
    this.board = this.create(Board, 'board', { boardSize: 7 });
    for (let r = 0; r < 7; r++) {
      for (let q = 0; q < 7; q++) {
        this.board.create(Cell, `cell-${q}-${r}`, { q, r });
      }
    }

    this.registerAction(createPlaceStoneAction(this));
    this.setFlow(createHexFlow(this));
  }

  override isFinished(): boolean {
    return !!this.winner;
  }

  override getWinners(): HexPlayer[] {
    return this.winner ? [this.winner] : [];
  }
}
```

## Related Documentation

- [Actions & Flow](./actions-and-flow.md) - Deep dive on actions and game flow
- [UI Components](./ui-components.md) - Building game UIs
- [Game Examples](./game-examples.md) - Real game implementations
- [Nomenclature](./nomenclature.md) - Standard terminology reference
