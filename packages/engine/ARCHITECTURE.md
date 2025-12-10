# BoardSmith Engine Architecture

## Core Concepts

### Actions vs Commands

BoardSmith uses a two-layer architecture for handling player operations:

#### **Actions** (High-Level, Game-Specific)

**Location:** `src/action/`

Actions represent what **players do** in the game from a game design perspective. They are:

- **High-level operations**: "move piece", "draw card", "ask for rank"
- **Game-specific**: Defined by game designers for their particular game
- **Declarative**: Describe *what* players want to do, not *how* to do it
- **User-facing**: Have prompts, selections, and validation for the UI

**Example:**
```typescript
const moveAction = Action.create('move')
  .prompt('Move a piece')
  .chooseElement('from', { prompt: 'Select piece to move' })
  .chooseFrom('to', { prompt: 'Select destination', choices: getValidMoves })
  .execute((args, ctx) => {
    // This execute function generates Commands
    const piece = args.from as Piece;
    const destination = args.to as Space;
    piece.putInto(destination); // ← Generates MoveCommand internally
  });
```

#### **Commands** (Low-Level, Event-Sourced)

**Location:** `src/command/`

Commands represent **low-level state mutations** that modify the game tree. They are:

- **Low-level operations**: `CreateElementCommand`, `MoveCommand`, `SetAttributeCommand`
- **Generic**: Same commands work for any game
- **Imperative**: Direct instructions to modify state
- **Event-sourced**: Tracked, serializable, and replayable
- **Internal**: Not exposed to game designers directly

**Example:**
```typescript
// When piece.putInto(destination) is called, it generates:
{
  type: 'move',
  elementId: piece.id,
  targetId: destination.id,
  position: 'last'
}
```

### Why This Separation?

#### 1. **Separation of Concerns**
- **Actions** handle game logic and player intent
- **Commands** handle state management and persistence

#### 2. **Event Sourcing**
- Commands form an event log that can be:
  - Replayed for debugging
  - Stored for game history
  - Used for undo/redo
  - Validated and sanitized

#### 3. **Flexibility**
- Game designers work with intuitive Actions
- Engine manages state changes via Commands
- UI can be auto-generated from Action metadata

#### 4. **Security**
- Commands are validated before execution
- Players can't directly manipulate state
- All mutations go through the command system

### Flow Diagram

```
┌─────────────────────────────────────────────────────┐
│ Player selects action in UI                        │
└─────────────────┬───────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────┐
│ Action System (High-Level)                          │
│ - Validates selections                              │
│ - Executes game logic                               │
│ - Calls element methods (putInto, create, etc.)    │
└─────────────────┬───────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────┐
│ Command System (Low-Level)                          │
│ - Generates MoveCommand, CreateElementCommand, etc.│
│ - Validates against current state                   │
│ - Executes state mutations                          │
│ - Logs for event sourcing                           │
└─────────────────┬───────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────┐
│ Game State Updated                                  │
└─────────────────────────────────────────────────────┘
```

### Comparison to Other Patterns

#### Redux/Vuex (Frontend State Management)
- **Actions** = Actions (user intent)
- **Commands** = Mutations (state changes)
- Similar pattern, different domain

#### Event Sourcing (Backend Architecture)
- **Actions** = Commands (user intent)
- **Commands** = Events (things that happened)
- BoardSmith uses imperative commands, not past-tense events

#### CQRS (Command Query Responsibility Segregation)
- **Actions** = Application commands
- **Commands** = Domain events
- Similar layering concept

## When to Use Which?

### Game Designers Use: **Actions**

```typescript
// Define what players can do
const askAction = Action.create('ask')
  .choosePlayer('target')
  .chooseFrom('rank', { choices: ['A', '2', '3', ...] })
  .execute((args, ctx) => {
    // Game logic here
  });
```

### Engine Developers Use: **Commands**

```typescript
// Internal state mutations
executeCommand({
  type: 'move',
  elementId: 42,
  targetId: 17,
});
```

### Element Methods Generate: **Commands**

```typescript
// Game designers call this
piece.putInto(destination);

// Which internally generates this command
{
  type: 'move',
  elementId: piece.id,
  targetId: destination.id,
}
```

## Best Practices

### ✅ Do

- Use Actions for game-specific player operations
- Use element methods (`putInto`, `create`) which generate Commands
- Let the command system handle state mutations
- Keep Action execute functions focused on game logic

### ❌ Don't

- Don't manually create Commands in game code
- Don't bypass the Action system for player operations
- Don't directly mutate element properties (use `setAttribute` if needed)
- Don't mix UI concerns into Action execute functions

## Related Documentation

- **[Action API](src/action/README.md)** - Creating player actions
- **[Command Types](src/command/types.ts)** - Available command types
- **[Element System](src/element/README.md)** - Game element tree structure
- **[Flow System](src/flow/README.md)** - Game flow control

---

**Summary:** Actions are what players *do*. Commands are how the engine *does it*.
