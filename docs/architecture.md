# BoardSmith Architecture

This document provides an overview of the BoardSmith package architecture and how the components fit together.

## Package Dependency Graph

```
                              ┌─────────────────┐
                              │  eslint-plugin  │  (standalone)
                              └─────────────────┘
                               Sandbox security rules
                               (no-network, no-filesystem,
                                no-timers, no-eval, etc.)

┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  ┌─────────┐                                                                │
│  │ engine  │  Core game framework                                           │
│  └────┬────┘  - Element system (Game, Piece, Card, Deck, etc.)              │
│       │       - Action system (builder pattern, selections)                 │
│       │       - Flow system (phases, turns, loops)                          │
│       │       - Command pattern (event sourcing)                            │
│       │                                                                     │
│       ▼                                                                     │
│  ┌─────────┐                                                                │
│  │ runtime │  Game execution                                                │
│  └────┬────┘  - GameRunner (start, performAction, replay)                   │
│       │       - Action history management                                   │
│       │       - State snapshots                                             │
│       │                                                                     │
│       ├──────────────────┬──────────────────┐                               │
│       ▼                  ▼                  ▼                               │
│  ┌─────────┐        ┌─────────┐        ┌─────────┐                          │
│  │   ai    │        │ session │        │ testing │                          │
│  └────┬────┘        └────┬────┘        └─────────┘                          │
│       │                  │              - Test fixtures                     │
│  MCTS bot                │              - Assertions                        │
│  - createBot()           │              - Random simulation                 │
│  - Difficulty presets    │              - Debug utilities                   │
│       │                  │                                                  │
│       ▼                  │                                                  │
│  ┌────────────┐          │  Game session management                         │
│  │ ai-trainer │          │  - GameSession (create, performAction)           │
│  └────────────┘          │  - Storage adapters                              │
│  - Self-play training    │  - Broadcast adapters                            │
│  - Feature generation    │  - AI controller                                 │
│  - Code generation       │  - Lobby system                                  │
│                          │                                                  │
│                          ├──────────────────┬───────────────────┐           │
│                          ▼                  ▼                   ▼           │
│                     ┌─────────┐        ┌─────────┐         ┌─────────┐      │
│                     │ server  │        │  worker │         │   cli   │      │
│                     └────┬────┘        └────┬────┘         └─────────┘      │
│                          │                  │               - init          │
│                     HTTP/WS core       Cloudflare           - dev           │
│                     - Handlers         Workers              - build         │
│                     - Game stores      - Durable Objects    - test          │
│                     - Matchmaking      - KV storage         - validate      │
│                          │                  │               - build-ai      │
│                          └────────┬─────────┘               - publish       │
│                                   │                                         │
│                                   ▼                                         │
│                              ┌─────────┐                                    │
│                              │ client  │  Browser SDK                       │
│                              └────┬────┘  - MeepleClient (matchmaking)      │
│                                   │       - GameConnection (WebSocket)      │
│                                   │       - Vue composables                 │
│                                   │                                         │
│                                   ▼                                         │
│                              ┌─────────┐                                    │
│                              │   ui    │  Vue 3 components                  │
│                              └─────────┘  - GameShell, ActionPanel          │
│                                           - AutoUI, Die3D                   │
│                                           - 20+ composables                 │
│                                           - Animation system                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Data Flow

### 1. Game Definition → Execution

```
Game Class (rules/game.ts)
    │
    ▼
GameRunner.start()
    │
    ├─► Flow engine executes game flow
    │   - Phases, turns, action steps
    │
    └─► Actions become available
        - Condition checks
        - Selection validation
```

### 2. Action Execution

```
UI Click / Bot Decision
    │
    ▼
actionController.execute(name, args)
    │
    ▼
GameConnection.action()  ──► WebSocket ──► Server/Worker
    │                                           │
    │                                           ▼
    │                                    GameSession.performAction()
    │                                           │
    │                                           ▼
    │                                    GameRunner.performAction()
    │                                           │
    │                                           ▼
    │                                    ActionExecutor.execute()
    │                                           │
    │                                           ▼
    │                                    Commands emitted
    │                                    (MoveCommand, etc.)
    │                                           │
    ◄───────────────────────────────────────────┘
    │                                    State broadcast
    ▼
UI updates via gameView
```

### 3. State Serialization

```
Game Instance (runtime)
    │
    ├─► serialize() ──► GameStateSnapshot (JSON)
    │                        │
    │                        ├─► Storage adapter ──► Database/KV
    │                        │
    │                        └─► Broadcast ──► All connected clients
    │
    └─► playerView(player) ──► PlayerGameState
                                    │
                                    └─► Filtered view for specific player
                                        (hidden cards, fog of war, etc.)
```

## Key Patterns

### Event Sourcing

All game state changes are captured as commands:

```typescript
// Commands are recorded, not state
actionHistory: [
  { action: 'draw', player: 0, args: { count: 3 } },
  { action: 'play', player: 0, args: { card: 42 } },
  // ...
]

// State is reconstructed by replaying commands
GameRunner.replay(actionHistory) → Current State
```

### Visibility Control

Game elements can have visibility restrictions:

```typescript
card.hideFromAll();           // Hidden from everyone
card.showTo(player);          // Visible to specific player
card.showOnlyTo(player);      // Visible ONLY to that player
```

The `playerView()` method filters state based on these visibility rules.

### Platform Adapters

The session package uses adapters for platform-specific concerns:

```
┌─────────────────────────────────────────────────────┐
│                   GameSession                       │
│                                                     │
│  ┌─────────────────┐      ┌─────────────────┐      │
│  │ StorageAdapter  │      │ BroadcastAdapter │      │
│  └────────┬────────┘      └────────┬────────┘      │
└───────────┼─────────────────────────┼───────────────┘
            │                         │
    ┌───────┴───────┐         ┌───────┴───────┐
    │               │         │               │
    ▼               ▼         ▼               ▼
┌────────┐    ┌─────────┐  ┌────────┐   ┌──────────┐
│In-Mem  │    │ SQLite  │  │Express │   │Durable   │
│ Store  │    │ Store   │  │  WS    │   │Object WS │
└────────┘    └─────────┘  └────────┘   └──────────┘
   CLI dev      CLI --persist   CLI dev    Cloudflare
```

## Package Responsibilities

| Package | Responsibility | Key Exports |
|---------|---------------|-------------|
| `engine` | Game rules framework | `Game`, `Action`, `Flow`, elements |
| `runtime` | Game execution | `GameRunner` |
| `session` | Session management | `GameSession`, adapters |
| `server` | HTTP/WS handlers | `GameServerCore`, handlers |
| `worker` | Cloudflare runtime | `createGameWorker`, adapters |
| `client` | Browser SDK | `MeepleClient`, `GameConnection` |
| `ui` | Vue components | `GameShell`, composables |
| `ai` | MCTS bot | `createBot`, `MCTSBot` |
| `ai-trainer` | AI training | `trainAI`, `introspectGame` |
| `cli` | Dev tools | Commands (init, dev, build, etc.) |
| `testing` | Test utilities | `createTestGame`, assertions |
| `eslint-plugin` | Linting rules | Sandbox security rules |

## See Also

- [Getting Started](./getting-started.md) - Quick start guide
- [Core Concepts](./core-concepts.md) - Element system, actions, flow
- [Common Patterns](./common-patterns.md) - Reusable game patterns
