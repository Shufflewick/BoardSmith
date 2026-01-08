# Architecture

**Analysis Date:** 2026-01-08

## Pattern Overview

**Overall:** Layered Monorepo with Platform-Agnostic Core

**Key Characteristics:**
- Game rules isolated from platform/networking details
- Event sourcing via Command pattern for state changes
- Adapter pattern for cross-platform deployment
- Builder pattern for fluent action/flow definition

## Layers

**Game Rules Layer:**
- Purpose: Define game mechanics, elements, actions, flow
- Contains: Custom Game classes extending `Game` from engine
- Location: `packages/games/*/rules/src/`
- Depends on: `@boardsmith/engine` only
- Used by: Runtime layer

**Engine Layer:**
- Purpose: Core game primitives and abstractions
- Contains: GameElement, Action, Flow, Command, Player systems
- Location: `packages/engine/src/`
- Depends on: Nothing external
- Used by: All other layers

**Runtime Layer:**
- Purpose: Game execution and state management
- Contains: GameRunner, action history, snapshots, replay
- Location: `packages/runtime/src/`
- Depends on: Engine
- Used by: Session layer

**Session Layer:**
- Purpose: Unified game session API across platforms
- Contains: GameSession, storage/broadcast adapters, AI controller
- Location: `packages/session/src/`
- Depends on: Runtime
- Used by: Server, CLI

**Server Layer:**
- Purpose: Platform-agnostic HTTP/WebSocket routing
- Contains: GameServerCore, handlers, game stores
- Location: `packages/server/src/`
- Depends on: Session
- Used by: CLI (Express), Worker (Cloudflare)

**Client Layer:**
- Purpose: Browser SDK for game connections
- Contains: MeepleClient, GameConnection
- Location: `packages/client/src/`
- Depends on: None (HTTP/WS only)
- Used by: UI components

**UI Layer:**
- Purpose: Vue 3 components for game rendering
- Contains: GameShell, ActionPanel, AutoUI, composables
- Location: `packages/ui/src/`
- Depends on: Client, Vue 3
- Used by: Game UIs

## Data Flow

**Game Definition → Execution:**

1. Game class instantiated with players
2. Constructor registers elements, creates board state
3. `GameRunner.start()` called
4. Flow engine executes game flow
5. Actions become available based on conditions
6. State changes emit Commands (event sourcing)

**Action Execution:**

1. Player clicks action in UI
2. `GameConnection.action('actionName', args)` called
3. WebSocket → Server → `handleAction()`
4. `GameSession.performAction()` validates and executes
5. Action emits Commands to update state
6. New state snapshot broadcast to all players
7. UI re-renders via Vue reactivity

**State Management:**
- Game state serialized to JSON snapshots
- Commands are append-only (event sourcing)
- Player views filtered by visibility rules
- Full replay possible from action history

## Key Abstractions

**GameElement:**
- Purpose: Base class for all game objects (cards, pieces, spaces)
- Examples: Card, Deck, Hand, Piece, Space, Grid
- Location: `packages/engine/src/element/`
- Pattern: Composite (tree structure)

**Action:**
- Purpose: Define player decisions with selections and validation
- Examples: `askForRank`, `playCard`, `moveKing`
- Location: `packages/engine/src/action/`
- Pattern: Builder (fluent API)

**Command:**
- Purpose: Immutable state change records
- Examples: MoveCommand, SetAttributeCommand, ShuffleCommand
- Location: `packages/engine/src/command/`
- Pattern: Command (event sourcing)

**Flow:**
- Purpose: Declarative turn/phase sequencing
- Examples: `turnLoop`, `eachPlayer`, `actionStep`, `ifThen`
- Location: `packages/engine/src/flow/`
- Pattern: Interpreter (DSL for game flow)

**GameSession:**
- Purpose: Unified session management across platforms
- Location: `packages/session/src/game-session.ts`
- Pattern: Facade

## Entry Points

**CLI Entry:**
- Location: `packages/cli/src/cli.ts`
- Triggers: `boardsmith` command (init, dev, build, test, validate, etc.)
- Responsibilities: Parse args, route to command handlers

**Server Core:**
- Location: `packages/server/src/core.ts`
- Triggers: HTTP requests via Express or Cloudflare Workers
- Responsibilities: Route requests, manage game stores

**Client Entry:**
- Location: `packages/client/src/index.ts`
- Triggers: Browser import
- Responsibilities: Export MeepleClient, GameConnection

**Game Entry:**
- Location: `packages/games/*/rules/src/index.ts`
- Triggers: Server loads game type
- Responsibilities: Export GameClass

## Error Handling

**Strategy:** Throw errors, catch at boundaries

**Patterns:**
- Engine throws descriptive errors for invalid operations
- Commands are validated before execution
- Session layer catches and returns structured error responses
- UI shows user-friendly error messages

## Cross-Cutting Concerns

**Logging:**
- Console-based (console.log, console.error)
- Structured logging not implemented

**Validation:**
- Action conditions checked before execution
- Selection validation in action builder
- Type checking via TypeScript strict mode

**Visibility:**
- Per-element visibility state
- Player views computed at query time
- Hidden information filtered before broadcast

**Serialization:**
- Custom serialization with element references
- Snapshots include full game state
- Replay files store action history

---

*Architecture analysis: 2026-01-08*
*Update when major patterns change*
