# boardsmith

> Core game engine - elements, actions, flow, and commands.

## When to Use

Import from `boardsmith` when building game logic. This is the root export containing all element classes (Game, Card, Piece, etc.), action definitions, flow control, and the command system for event sourcing.

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
- `ElementCollection` - Queryable collection of elements
- `PersistentMap` - Map that survives serialization

### Player System

- `Player` - Base class for player state
- `AbilityManager` - Manages player abilities and resources

### Scoring System

- `Track` - Base scoring track
- `MonotonicTrack` - Track that only increases/decreases
- `UniqueTrack` - Track with unique values
- `CounterTrack` - Simple numeric counter

### Command System

- `executeCommand()` - Execute a game command
- `undoCommand()` - Undo a command
- `createInverseCommand()` - Create inverse for undo
- `canPlayerSee()` - Check visibility for player
- `visibilityFromMode()` - Convert mode to visibility state
- `resolveVisibility()` - Resolve visibility configuration
- `DEFAULT_VISIBILITY` - Default visibility settings

### Action System

- `Action` - Define player actions with selections
- `ActionExecutor` - Execute actions with validation
- `evaluateCondition()` - Evaluate action conditions

### Filter Helpers

- `dependentFilter()` - Filter based on previous selections
- `adjacentToSelection()` - Filter to adjacent elements
- `excludeAlreadySelected()` - Exclude previously selected
- `allOf()` - Combine filters with AND
- `anyOf()` - Combine filters with OR
- `not()` - Negate a filter

### Action State

- `actionTempState()` - Persist state between choices and execute

### Flow System

- `FlowEngine` - Run game flow definitions
- `sequence()` - Execute steps in sequence
- `namedSequence()` - Named sequence for debugging
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
- `defineFlow()` - Define reusable flow
- `noop()` - No operation
- `execute()` - Execute function
- `setVar()` - Set flow variable
- `turnLoop()` - Standard turn-based loop
- `TurnOrder` - Turn order utilities

### Utilities

- `serializeValue()` - Serialize game values
- `deserializeValue()` - Deserialize game values
- `serializeAction()` - Serialize an action
- `deserializeAction()` - Deserialize an action
- `isSerializedReference()` - Check if value is reference
- `createSnapshot()` - Create game state snapshot
- `createPlayerView()` - Create player-specific view
- `createAllPlayerViews()` - Create all player views
- `createReplayFile()` - Create replay file format
- `validateReplayFile()` - Validate replay file
- `parseReplayFile()` - Parse replay file
- `resolveElementArg()` - Resolve element argument
- `isResolvedElement()` - Check if element is resolved
- `captureDevState()` - Capture state for HMR
- `restoreDevState()` - Restore state after HMR
- `validateDevSnapshot()` - Validate dev snapshot
- `formatValidationErrors()` - Format validation errors
- `validateFlowPosition()` - Validate flow position
- `formatFlowRecovery()` - Format flow recovery info
- `getSnapshotElementCount()` - Count elements in snapshot
- `createTrackedRandom()` - Create deterministic random
- `getRandomCallCount()` - Get random call count
- `resetRandomCallCounter()` - Reset random counter
- `createCheckpoint()` - Create HMR checkpoint
- `restoreFromCheckpoint()` - Restore from checkpoint

### Sandbox

- `ExecutionContext` - Execution context with limits
- `ExecutionLimitError` - Error for exceeded limits
- `withLimits()` - Run with execution limits
- `withLimitsAsync()` - Run async with limits
- `guard()` - Guard execution
- `validateCode()` - Validate code safety
- `DEFAULT_LIMITS` - Default execution limits

### Types

- `ElementClass` - Element class constructor
- `ElementContext` - Element context data
- `ElementTree` - Element tree structure
- `ElementJSON` - Serialized element
- `ElementFinder` - Element query function
- `ElementAttributes` - Element attributes
- `Sorter` - Sort comparison function
- `GameOptions` - Game constructor options
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
- `GameCommand` - Command type union
- `CommandResult` - Command execution result
- `SelectionType` - Selection type enum
- `Selection` - Selection definition
- `ActionContext` - Action execution context
- `ActionDefinition` - Action definition
- `ActionResult` - Action execution result
- `FlowNodeType` - Flow node type enum
- `FlowStepResult` - Flow step result
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

  defineElements() {
    this.board = this.create(Space, 'board');

    for (let i = 0; i < 4; i++) {
      this.board.create(Piece, 'token', { color: i });
    }
  }

  defineActions() {
    this.defineAction('move', {
      prompt: 'Select a token to move',
      select: {
        type: 'element',
        from: this.board.all(Piece),
      },
      execute: ({ selected }) => {
        // Move logic
      },
    });
  }
}
```

### Using Flow Control

```typescript
import { sequence, eachPlayer, actionStep, loop } from 'boardsmith';

const gameFlow = sequence(
  // Setup phase
  execute(() => game.deal()),

  // Main game loop
  loop(
    eachPlayer({
      do: actionStep({ name: 'play' }),
    }),
    // Continue until game ends
    () => !game.isOver(),
  ),
);
```

## See Also

- [Getting Started](../getting-started.md)
- [Core Concepts](../core-concepts.md)
- [Actions and Flow](../actions-and-flow.md)
