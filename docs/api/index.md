# boardsmith

> Core game engine - elements, actions, flow, and visibility.

## When to Use

Import from `boardsmith` when building game logic. This is the root export containing all element classes (Game, Card, Piece, etc.), action definitions, flow control, and element visibility.

## Usage

```typescript
import {
  Game,
  GameElement,
  Space,
  Piece,
  Card,
  Hand,
  Deck,
  Player,
  Action,
  FlowEngine,
  sequence,
  actionStep,
} from 'boardsmith';
```

## Exports

### Element Classes

- `GameElement` - Base class for all game elements
- `Space` - Container for pieces and cards
- `Piece` - Game piece that can move between spaces
- `Card` - Playing card with visibility rules
- `Hand` - Player's hand of cards
- `Deck` - Stack of cards with shuffle support
- `Die` - Single die with configurable sides
- `DicePool` - Collection of dice for rolling
- `Grid` - Rectangular grid of spaces
- `GridCell` - Individual cell in a Grid
- `HexGrid` - Hexagonal grid layout
- `HexCell` - Individual cell in a HexGrid
- `Game` - Base class for game definitions
  - `game.oncePerState(key, workOut)` - Work out a whole-position fact once per game state, shared by every rule that reads it (see [Actions & Flow](../actions-and-flow.md#a-fact-several-rules-read-is-worked-out-once-per-game-state))
- `ElementCollection` - Queryable collection of elements
- `PersistentMap` - Map that survives serialization

### Player System

- `Player` - Base class for player state
- `addAbility()`, `hasUnusedAbility()`, `spendAbility()`, `countUnusedAbilities()`, `groupAbilities()` - Work with a player's plain `Ability[]` list
- `AbilityManager` - Older class form; not restorable, use the functions above

### Scoring System

- `monotonicTrack()`, `uniqueTrack()`, `counterTrack()` - Make a plain-data scoring track (`TrackState`)
- `canAddToTrack()`, `addToTrack()`, `incrementCounter()`, `isTrackComplete()`, `trackPoints()` - Read and change a track
- `Track`, `MonotonicTrack`, `UniqueTrack`, `CounterTrack` - Older class form; not restorable, use the functions above

### Visibility

- `canPlayerSee()` - Check visibility for player
- `visibilityFromMode()` - Convert mode to visibility state
- `resolveVisibility()` - Resolve visibility configuration
- `DEFAULT_VISIBILITY` - Default visibility settings

### Action System

- `Action` - Define player actions with selections
- `evaluateCondition()` - Evaluate action conditions

### Filter Helpers

- `dependentFilter()` - Filter based on previous selections
- `not()` - Negate a filter

### Action State

- `actionTempState()` - Carry a value from one step to a later one (never written from `choices`)

### Flow System

- `FlowEngine` - Run game flow definitions
- `sequence()` - Execute steps in sequence
- `phase()` - Define a game phase
- `loop()` - Loop until condition
- `repeat()` - Repeat N times
- `eachPlayer()` - Execute for each player
- `forEach()` - Execute for each item
- `actionStep()` - Wait for player action
- `simultaneousActionStep()` - Wait for all players
- `playerActions()` - Define available actions
- `switchOn()` - Branch based on value
- `ifThen()` - Conditional execution
- `noop()` - No operation
- `execute()` - Execute function
- `setVar()` - Set flow variable
- `turnLoop()` - Standard turn-based loop
- `TurnOrder` - Turn order utilities

### Balance Metrics

- `defineMetrics(kinds => ({ ... }))` - Declare what the balance simulator measures, wired once as `gameDefinition.metrics`. Recording does nothing in real play. See [boardsmith/sim](./sim.md#author-metrics)
- `GameMetrics` - The type `gameDefinition.metrics` holds

### Card data from CSV

- `parseCsv(text, columns, { source })` - Reads the text of a CSV file into one typed object per row. Import the file with `?raw` (`import cardsCsv from './data/cards.csv?raw'`) so its text is bundled with the rules; `boardsmith dev`, `build`, `simulate`, `validate` and vitest all load it. `columns` maps each header to `'string'`, `'number'`, `'boolean'` or `'list'`, and the rows are typed from it. `source` is the file's name, used in errors. See [boardsmith/sim](./sim.md#card-data-from-csv) for an example.
  - Quoted fields, `""` for a quote, commas and newlines inside quotes, CRLF, a byte-order mark and blank lines at the end are all read.
  - `number`: a decimal such as `3`, `-2.5` or `1e3`. `boolean`: `true`/`false`, `yes`/`no` or `1`/`0`, in any case. `list`: items separated by `;`, each trimmed; an empty cell is `[]`. Numbers and booleans may have spaces around them; strings are kept as written.
  - Every header must be a declared column and every declared column must be in the header, in any order, so a misspelt header fails instead of reading as missing data.
  - The first problem throws, naming the file, the row (the header is row 1, as in a spreadsheet) and the column: a missing or undeclared column, a bad number, boolean or list item, an unclosed quote, or a row with too few or too many fields. It never returns part of a file.
- `CsvColumnType`, `CsvValue`, `CsvRow` - The column types and the row type `parseCsv` returns

### Serialization and snapshots

`serializeAction()`, `deserializeAction()`, `isSerializedReference()`,
`createSnapshot()`, `createPlayerView()` and `createAllPlayerViews()` are not in
the root entry. Import them from `boardsmith/runtime`; see [Runtime](./runtime.md).

### Types

- `ElementClass` - Element class constructor
- `ElementContext` - Element context data
- `ElementTree` - Element tree structure
- `ElementJSON` - Serialized element
- `ElementFinder` - Element query function
- `ElementAttributes` - Element attributes
- `Sorter` - Sort comparison function
- `GameOptions` - Game constructor options
- `GameClass` - A game's class: constructs a game from `GameOptions` (what the session host, the runner and the bots take)
- `GameRandom` - The type of `game.random`: a seeded generator whose state can be captured and restored
- `GamePhase` - Game phase enum
- `PlayerViewFunction` - Player view function
- `ElementLayout` - Layout configuration
- `HexOrientation` - Hex grid orientation
- `HexCoordSystem` - Hex coordinate system
- `LayoutDirection` - Layout direction
- `LayoutAlignment` - Layout alignment
- `DieSides` - Die sides configuration
- `Ability` - Player ability type
- `TrackEntry` - Track entry type
- `TrackConfig` - Track configuration
- `TrackState` - A plain-data scoring track
- `SelectionType` - Selection type enum
- `Selection` - Selection definition
- `ActionContext` - Action execution context
- `ActionDefinition` - Action definition
- `ActionResult` - What an action's `execute()` returns
- `FollowUpAction` - A follow-up action an `execute()` chains to
- `FollowUpOffer` - A follow-up as a client receives it: the `FollowUpAction` plus its action's metadata
- `FlowNodeType` - Flow node type enum
- `FlowPosition` - Flow position
- `FlowContext` - Flow context
- `FlowNode` - Flow node
- `FlowState` - Flow state
- `FlowDefinition` - Flow definition
- `ExecutionLimits` - Execution limit config

## Examples

### Defining a Game

```typescript
import { Game, Player, Space, Piece, Action } from 'boardsmith';

class MyGame extends Game<MyGame, MyPlayer> {
  board!: Space<MyGame, MyPlayer>;

  constructor(options: GameOptions) {
    super(options);

    // Create elements directly in the constructor -- there is no
    // defineElements()/defineActions() lifecycle hook.
    this.board = this.create(Space, 'board');

    for (let i = 0; i < 4; i++) {
      this.board.create(Piece, 'token', { color: i });
    }

    this.registerActions(
      Action.create('move')
        .prompt('Select a token to move')
        .chooseElement('token', {
          prompt: 'Select a token',
          elementClass: Piece,
        })
        .execute(({ token }) => {
          // Move logic
        }),
    );
  }
}
```

### Using Flow Control

```typescript
import { sequence, eachPlayer, actionStep, loop, execute } from 'boardsmith';

const gameFlow = sequence(
  // Setup phase
  execute((ctx) => ctx.game.deal()),

  // Main game loop
  loop({
    // Continue until game ends
    while: (ctx) => !ctx.game.isFinished(),
    maxIterations: 100,
    do: eachPlayer({
      do: actionStep({ actions: ['play'] }),
    }),
  }),
);
```

## See Also

- [Getting Started](../getting-started.md)
- [Core Concepts](../core-concepts.md)
- [Actions and Flow](../actions-and-flow.md)
