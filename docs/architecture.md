# BoardSmith Architecture

This document provides an overview of the BoardSmith package architecture and how the components fit together.

> **The one architectural fact to know first: BoardSmith is state-authoritative,
> not event-sourced.** The snapshot — the whole element tree, flow position,
> sequence counter and RNG position — is the source of truth. `actionHistory`
> and `commandHistory` exist for undo bookkeeping and diagnostics, and are
> **never replayed to rebuild state**. Undo and time-travel restore a per-action
> checkpoint directly. See [State Authority](#state-authority) below, and
> [state-size.md](./state-size.md) for the cost that follows from it.

## Package Dependency Graph

```
                              ┌─────────────────┐
                              │  eslint-plugin  │  (consumed by cli)
                              └─────────────────┘
                               Sandbox security rules — single source of truth
                               (no-network, no-filesystem, no-timers,
                                no-nondeterministic, no-eval). `boardsmith lint`
                                and `boardsmith validate` run these across all of src/.

┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  ┌─────────┐                                                                │
│  │ engine  │  Core game framework                                           │
│  └────┬────┘  - Element system (Game, Piece, Card, Deck, etc.)              │
│       │       - Action system (builder pattern, selections)                 │
│       │       - Flow system (phases, turns, loops)                          │
│       │       - Snapshots + per-action checkpoints (state-authoritative)    │
│       │                                                                     │
│       ▼                                                                     │
│  ┌─────────┐                                                                │
│  │ runtime │  Game execution                                                │
│  └────┬────┘  - GameRunner (start, performAction, fromSnapshot)             │
│       │       - Action history + checkpoint retention                       │
│       │       - State snapshots (restored whole, never replayed)            │
│       │                                                                     │
│       ├──────────────────┬──────────────────┐                               │
│       ▼                  ▼                  ▼                               │
│  ┌─────────┐        ┌─────────┐        ┌─────────┐                          │
│  │   bot   │        │ session │        │ testing │                          │
│  └────┬────┘        └────┬────┘        └─────────┘                          │
│       │                  │              - Test fixtures                     │
│  MCTS bot                │              - Assertions                        │
│  - createBot()           │              - Random simulation                 │
│  - Difficulty presets    │              - Debug utilities                   │
│       │                  │                                                  │
│       ▼                  │                                                  │
│  ┌────────────┐          │  Game session management                         │
│  │ bot-trainer│          │  - GameSession (create, performAction)           │
│  └────────────┘          │  - Storage adapters                              │
│  - Self-play training    │  - Broadcast adapters                            │
│  - Feature generation    │  - Bot controller                                 │
│  - Code generation       │  - Lobby system                                  │
│                          │                                                  │
│                          ├──────────────────┐                              │
│                          ▼                  ▼                              │
│                     ┌─────────┐        ┌─────────┐                         │
│                     │   cli   │        │ client  │  Browser SDK            │
│                     └─────────┘        └────┬────┘  - MeepleClient         │
│                     - init                  │       - GameConnection (WS)  │
│                     - dev                   │       - Vue composables      │
│                     - build                 │                              │
│                     - test          client connects over WebSocket to a    │
│                     - validate      host PROVIDED BY THE DEPLOYMENT         │
│                     - evolve-bot    PLATFORM — BoardSmith ships no server   │
│                     - publish       or worker module (see Runtime          │
│                                     Isolation below).                       │
│                                             │                              │
│                                             ▼                              │
│                                        ┌─────────┐                         │
│                                        │   ui    │  Vue 3 components       │
│                                        └─────────┘  - GameShell, ActionPanel│
│                                                     - AutoUI, Die3D        │
│                                                     - 20+ composables      │
│                                                     - Animation system     │
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
GameConnection.action()  ──► WebSocket ──► Host (deployment platform)
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
    │                                    Element tree mutated in place
    │                                    (card.putInto(hand), player.score += 1)
    │                                           │
    │                                           ▼
    │                                    Action recorded + checkpoint captured
    │                                           │
    ◄───────────────────────────────────────────┘
    │                                    State broadcast
    ▼
UI updates via gameView
```

The action's `execute` handler mutates the tree directly — there is no
generated command layer in between, and nothing here is what state is later
rebuilt from. What gets persisted is the resulting state (see State Authority
below).

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

### State Authority

**The snapshot is the source of truth. `actionHistory` and `commandHistory`
exist for undo bookkeeping and diagnostics, and are never replayed to rebuild
state.** BoardSmith is state-authoritative, not event-sourced — if you are
designing around an authoritative event log, audit trail, spectator replay, or
incremental reconstruction, the engine does not work that way.

A `GameStateSnapshot` carries the whole state: the serialized element tree, the
flow position, the element-sequence counter, and the RNG's internal position.
`GameRunner.fromSnapshot` loads all of it directly and re-runs nothing.

```typescript
// Restore: state in, state out. No replay, no start(), no re-running actions.
GameRunner.fromSnapshot(snapshot, GameClass) → the game, exactly as it was
```

Replay is not merely unused — it is *unsound* here. Selection-step and pending
mutations (`Piece.putInto` inside a completed pending action) are recorded in
neither the command history nor the action history, so replaying an action
history loses them and mis-positions the flow. That crashed real games, and is
why `fromSnapshot` deliberately does not call `replayCommands`, `start()`, or
re-run `actionHistory`.

Time-travel — undo, rewind, `getStateAtAction` — is likewise restore, not
replay. The runner captures a per-action **checkpoint** (a full tree copy plus
flow position, sequence and RNG state) into `snapshot.actionCheckpoints`, and
those calls restore the checkpoint at the target action count directly.

```typescript
snapshot.actionCheckpoints  // { baseIndex, entries[] } — a RETAINED WINDOW,
                            // not the whole history
```

The cost follows directly from that: a saved game is the tree **plus one tree
copy per retained action**, so it grows on every action even though the tree
does not. Bound it with `checkpoints: { max }` on the game definition; an undo
reaching past the retained window is refused with a message naming the policy.
See **[state-size.md](./state-size.md)** — a reader who assumes replay will not
understand why saved size scales with action count.

`Game#commandHistory` is populated only by the engine's internal `execute()`,
which drives the ANIMATE event stream. Game rule code never calls it and must
not treat it as an audit log (see [core-concepts.md](./core-concepts.md)).

### Visibility Control

Game elements can have visibility restrictions:

```typescript
card.hideFromAll();           // Hidden from everyone
card.showTo(player);          // Visible to specific player
card.showOnlyTo(player);      // Visible ONLY to that player
```

The `playerView()` method filters state based on these visibility rules.

### Platform Adapters

`GameSession` exposes `StorageAdapter` and `BroadcastAdapter` *interfaces*
(`src/session/types.ts`) for platform-specific concerns. BoardSmith ships the
interfaces only — concrete storage/transport implementations are supplied by
the deployment platform that hosts the session (see Runtime Isolation below).

```
┌─────────────────────────────────────────────────────┐
│                   GameSession                       │
│                                                     │
│  ┌─────────────────┐      ┌──────────────────┐      │
│  │ StorageAdapter  │      │ BroadcastAdapter │      │
│  │  (interface)    │      │   (interface)    │      │
│  └────────┬────────┘      └────────┬─────────┘      │
└───────────┼─────────────────────────┼───────────────┘
            │                         │
            ▼                         ▼
   Persistence implementation   Transport implementation
   supplied by the host         supplied by the host
   (e.g. KV, in-memory)         (e.g. WebSocket fan-out)
```

## Package Responsibilities

| Package | Responsibility | Key Exports |
|---------|---------------|-------------|
| `engine` | Game rules framework | `Game`, `Action`, `Flow`, elements |
| `runtime` | Game execution | `GameRunner` |
| `session` | Session management | `GameSession`, adapter interfaces |
| `client` | Browser SDK | `MeepleClient`, `GameConnection` |
| `ui` | Vue components | `GameShell`, composables |
| `bot` | MCTS bot | `createBot`, `MCTSBot` |
| `bot-trainer` | Bot training | `trainBot`, `introspectGame` |
| `cli` | Dev tools | Commands (init, dev, build, etc.) |
| `testing` | Test utilities | `createTestGame`, assertions |
| `eslint-plugin` | Linting rules | Sandbox security rules |

## Runtime Isolation & the "Sandbox"

BoardSmith is a game *engine*, not a hosting runtime. It does not — and is not
meant to — isolate game code from its host process: a game definition is an
ordinary JS module, so anything it can reach in-process, it can call. There is
no in-engine network/CPU/filesystem confinement, and there should not be one
masquerading as a security boundary (a regex code-scan or an in-process
operation counter is trivially bypassable and would give a false sense of
safety).

The two layers that *do* provide safety have distinct, non-overlapping jobs:

- **Runtime isolation is the deployment host's responsibility.** A host that
  runs untrusted, author-uploaded bundles must execute each one in a real
  isolate — e.g. a per-request V8 isolate / dynamic worker with network egress
  disabled, no ambient bindings/secrets, and a CPU-time ceiling. That isolate,
  not the engine, is what contains a malicious or runaway game. (ShufflewickPub's
  `executor` worker is the reference implementation.)
- **The eslint-plugin guardrails are the author-time advisory layer.** The
  `boardsmith` ESLint rules (no-network, no-filesystem, no-timers,
  no-nondeterministic, no-eval), run across all of `src/` by `boardsmith lint`
  and `boardsmith validate`, steer authors away from APIs that the real sandbox
  forbids and that break deterministic replay/undo/MCTS. They are a lint, not an
  enforcement boundary, and are correct as such.

## See Also

- [Getting Started](./getting-started.md) - Quick start guide
- [Core Concepts](./core-concepts.md) - Element system, actions, flow
- [Common Patterns](./common-patterns.md) - Reusable game patterns
