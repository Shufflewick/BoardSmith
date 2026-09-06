# BoardSmith Documentation

This folder contains documentation for the BoardSmith game framework.

## The path from an idea to players

BoardSmith is one install and one command away from a game you can play.
`npx boardsmith init my-game` scaffolds the project, `npm install` pulls in the
whole engine, `boardsmith dev` hosts real multiplayer on your own machine with
no server, database or service to provision, and `boardsmith test` drives the
same rules headlessly. When the game is ready, `boardsmith publish` sends the
bundle to ShufflewickPub, where a single account supplies the networking, the
hosting and the social platform around it. A persistent world takes the same
path: `boardsmith init --world` scaffolds one, and `boardsmith dev` runs it on
your laptop with no network at all -- genesis, commands, per-seat views,
scheduled events and presence, over a durable local store. See
[Persistent worlds](./persistent-worlds.md) for what a world is and how one is
written.

## Documents

| Document | Description |
|----------|-------------|
| [Getting Started](./getting-started.md) | CLI setup, project creation, and basic development |
| [Core Concepts](./core-concepts.md) | Element tree, visibility, actions vs commands |
| [Actions & Flow](./actions-and-flow.md) | Action builder API and declarative flow system |
| [Dice & Scoring](./dice-and-scoring.md) | Dice elements, 3D rendering, abilities, and scoring tracks |
| [UI Components](./ui-components.md) | Vue components and composables |
| [Bot System](./bot-system.md) | MCTS bot and bot integration |
| [Game Examples](./game-examples.md) | Analysis of example games with patterns |
| [Teaching & Tutorials](./teaching-and-tutorials.md) | Tutorial authoring, bot hints, narrated demo, heatmap, action help, and host lockout |
| [Agent Control](./agent-control.md) | Driving a game headlessly: action-space introspection, move enumeration, undo/checkpoint/time-travel, determinism & seeding, scriptable dev host (WS), structured errors |
| [Migration Guide](./migration-guide.md) | Breaking changes by version, with before→after upgrade steps |
| [State Size](./state-size.md) | Why saved state is tree size × action count, the `checkpoints` retention policy, and how to assert your budget in CI |
| [Nomenclature](./nomenclature.md) | Standard terminology reference |

## For LLMs

If you're an AI assistant reading this codebase:

1. **Start with** [`core-concepts.md`](./core-concepts.md), then [`agent-control.md`](./agent-control.md) for driving a game headlessly
2. **Simplest example**: Hex - minimal but complete game
3. **Complex example**: Cribbage - multi-phase, simultaneous actions

## Quick Links

- **CLI**: `boardsmith init`, `boardsmith dev`, `boardsmith test`, `boardsmith simulate`
- **Key packages**: `boardsmith`, `boardsmith/ui`, `boardsmith/bot`, `boardsmith/client`
- **Example games**: Hex, Go Fish, Checkers, Cribbage
