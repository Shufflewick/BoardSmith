# BoardSmith

A TypeScript framework for building turn-based board and card games. It gives you
an element tree for game state, an action system players drive, a declarative
flow for turns and phases, Vue components that render a playable game with no UI
code of your own, and MCTS bots that play it.

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
[Persistent worlds](./docs/persistent-worlds.md) for what a world is and how one is
written.

## Install and run

Requires Node.js 20 or newer.

```bash
npx boardsmith init my-game
cd my-game
npm install
npx boardsmith dev
```

`boardsmith dev` serves the game on http://localhost:5173 and hosts its
multiplayer on the same port. Every browser tab is a real player, so open a
second tab to take the second seat.

## Documentation

[docs/getting-started.md](./docs/getting-started.md) walks through the generated
project and the rest of the CLI: `test`, `simulate`, `validate`, `build` and
`publish`. The full index is [docs/README.md](./docs/README.md).

The pages worth knowing by name:

- [Core concepts](./docs/core-concepts.md) for the element tree, visibility and state authority
- [Actions and flow](./docs/actions-and-flow.md) for the action builder and turn structure
- [UI components](./docs/ui-components.md) for the Vue layer and custom boards
- [Common pitfalls](./docs/common-pitfalls.md) for the mistakes that cost the most time
- [Bot system](./docs/bot-system.md) for MCTS opponents

## License

[Mozilla Public License 2.0](./LICENSE).
