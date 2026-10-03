# Getting Started with BoardSmith

BoardSmith is a TypeScript framework for building turn-based board and card games with built-in multiplayer support, bot opponents, and automatic UI generation.

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

## Prerequisites

- Node.js 22.5+ (BoardSmith keeps a persistent world's local store in SQLite through Node's own `node:sqlite`, which arrived in 22.5)
- npm, pnpm, or yarn

## Quick Start

### 1. Create a New Game Project

```bash
npx boardsmith init my-game
cd my-game
npm install
```

This creates a new game project with the following structure:

```
my-game/
├── boardsmith.json          # Game configuration
├── package.json             # Dependencies
├── tsconfig.json            # TypeScript config
├── vite.config.ts           # Vite bundler config
├── index.html               # Entry HTML
├── public/                  # Static assets
├── src/
│   ├── main.ts              # App entry point
│   ├── rules/               # Game logic
│   │   ├── game.ts          # Main Game class
│   │   ├── elements.ts      # Custom element classes
│   │   ├── actions.ts       # Player action definitions
│   │   ├── flow.ts          # Game flow definition
│   │   └── index.ts         # Exports
│   └── ui/                  # Vue UI components
│       ├── App.vue          # Main app component
│       ├── components/      # Custom components
│       │   └── GameTable.vue
│       └── index.ts         # UI exports
└── tests/
    └── game.test.ts         # Game tests
```

#### Starting a persistent world instead

A **persistent world** is the other backend: named partitions rather than a
whole resident tree, a checkpoint of what a command dirtied rather than a
snapshot per action, and a clock that acts on its own rather than a turn order.
It is what a game IS, not something a run selects, so it is chosen once, when
the project is created:

```bash
npx boardsmith init my-world --world
cd my-world
npm install
boardsmith test
```

That scaffolds `"backend": "world"` in `boardsmith.json`, a `src/rules/world.ts`
whose contract types are imported from `boardsmith/world` (never hand-copied), a
`world.html` mounting `WorldShell` over your `src/ui/uis.ts` (a world declares
its boards exactly as a table does), and a `tests/world.test.ts` that drives your
world through the same library a host runs — genesis, a command, the clock and
one seat's view, with no host and no network.

`boardsmith dev` runs that world in a browser with no network: genesis once into
a durable local store beside `boardsmith.json`, every command through
`partitions()` then `run()`, a view per attached seat, and your scheduled events
on their due time. The dev bar switches seats, fires due events without making
you wait for them, and wakes the world from parked so the rehydration path is
exercised rather than assumed. `boardsmith dev --reset` deletes the local world
and runs genesis again; nothing else deletes it.
[Persistent worlds](./persistent-worlds.md) is the authoring guide.

### 2. Start Development Server

```bash
boardsmith dev
```

This starts a Vite dev server (default port 5173) that also hosts the game's
WebSocket multiplayer host on the same port, and opens one browser tab. Each
browser tab is a real player — open more tabs to fill more seats (open seats
play as bot until claimed).

By default the server binds to `127.0.0.1` (local-only). Pass `--lan` to let
other devices on your network join.

Saving a file under your rules directory reloads the rules on the host too, not
only in the browser, and the game in progress carries on under them from where
it was. If an edit to your flow means the saved position no longer fits, the
host rebuilds the game by replaying its moves on the new rules. If even that
fails, every page and the terminal say so, and **New game** starts a game on the
edited rules. A rules file that does not load leaves the game running on the
rules it had, and the terminal says why. An edit that changes `gameType`,
`minPlayers` or `maxPlayers` needs `boardsmith dev` restarted.

While an edit is still building, the host holds every move and **New game** you
send, and each page says "Reloading rules…". They run on the edited rules once
those are in place, so a click right after a save always tests what you saved.
If the edit does not load, the held moves are refused with the reason, and the
game stays on the rules it had.
The host's own work waits the same way: a step deadline that runs out, a
bot taking over the seat of a page that closed, the narrated demo's next move,
or the next move of a run of bot moves already under way when you saved, runs
on the edited rules once they are in place, or on the rules the game kept if
the edit does not load. A demo move narrated before the save is chosen again
on the edited rules. A game carried onto edited rules keeps its open step's
deadline, so a save gives nobody extra time.

**Building a persistent world?** `boardsmith dev` plays your project's table
game. The world half of a game definition is run by the hosting platform, not by
this CLI, so read [Persistent worlds](./persistent-worlds.md) first — it says
which half is the engine's and where a world can actually be run.

#### Dev Server Options

```bash
# Specify number of players
boardsmith dev --players 3

# Add bot opponents (player positions are 1-indexed)
boardsmith dev --bot 2              # Player 2 is a bot
boardsmith dev --bot 1 3            # Players 1 and 3 are bots

# Set bot difficulty
boardsmith dev --bot 2 --bot-level hard    # easy, medium, hard, or an iteration count

# Custom port
boardsmith dev --port 3000

# Serve to your whole network so other computers can join
boardsmith dev --lan               # shorthand for --host 0.0.0.0

# Disable teaching aids (bot hint, move heatmap, bot-vs-bot demo, tutorial)
boardsmith dev --lock-teaching

# Don't auto-launch a browser tab (for scripts/CI driving the dev host,
# so an uncontrolled tab doesn't claim seat 1)
boardsmith dev --no-open
```

### 3. Run Tests

```bash
boardsmith test           # Run once
boardsmith test --watch   # Watch mode
```

### 4. Validate Before Publishing

```bash
boardsmith validate
```

This runs:
- Configuration validation (unknown `boardsmith.json` keys are rejected with did-you-mean suggestions)
- TypeScript compilation checks (`vue-tsc --noEmit`)
- Test type coverage: every file `boardsmith test` runs must be in the program
  that type-check just compiled, so a test file excluded from `tsconfig.json`'s
  `include` cannot run in one gate while being invisible to the other
- Security scan for forbidden APIs (network, timers, non-determinism, eval)
- Asset path check: absolute paths break on the publishing platform, and a
  remote image URL the bundle uses must be covered by `imageSources` or it is
  blocked once published
- Bundle size limits, in the units the server measures them in: a table game's
  `rules.js` against the executor's 1 MiB request cap **as JSON-encoded**, not as
  it sits on disk (quotes, backslashes and newlines each cost an extra byte); a
  world's `rules.js` against the upload gate only, since a world loads rules from
  the bundle store rather than a request; and every bundle against the publish
  server's 200 MB compressed-zip gate and its uncompressed ceilings
- Required files check

To detect infinite loops or game-ending bugs, run `boardsmith simulate` (seeded
headless batch simulation).

#### Before you call a change done: `boardsmith verify`

```bash
boardsmith verify                    # every check, recorded for this commit
boardsmith verify --base v1.2        # measure the change from somewhere other than main
boardsmith verify --chunk deal       # measure a bs- chunk's change from where it began
boardsmith verify --check            # has this commit passed? (runs nothing)
boardsmith verify --check --chunk deal   # ...with the chunk's whole change measured?
```

`boardsmith verify` runs the full suite, `boardsmith typecheck`, `boardsmith
build`, `boardsmith validate`, the in-browser smoke test and a mutation check,
in that order, and keeps going after a failure so you see every problem at once.
The mutation check
breaks each line of code under `src/` that changed since the main branch (or
since `--base`), one small change at a time, and runs the whole suite against
each: a change no test notices is reported by file and line, because the tests
would not catch that line going wrong.

On the main branch itself, the merge base with main is the current commit, so
no change would be measured: there the mutation check fails unless you pass
`--base <commit the work started from>`. For a chunk the `bs-` skills build,
`--chunk <slug>` finds that commit itself: the one before the chunk's first
`chunk-<slug>/` commit. A mutant whose code, tests, repository and installed
packages have not changed since an earlier run is not run again, so verifying
again after a commit that only touches the `bs-` skills' design records is quick.
A package installed as a link to a folder outside the repository, such as
`"dep": "file:../dep"`, counts by that folder's content, so editing it runs the
mutants again; if such a folder cannot be read, nothing is reused or kept for
that run.
Those outcomes are kept in the repository's git directory, shared by the main
checkout and every worktree. A merge reuses them only when the merged tree is
the tree the worktree verified: main has not moved since, or the branch merged
main before its last verify. Otherwise every mutant runs again at the merge. So
for a cheap merge, merge main into the branch first and verify there. Older
BoardSmith kept these outcomes in `.boardsmith/verify/mutants.json`; that file
is no longer read and can be deleted.

The smoke test is your game's `tests/browser/smoke.spec.ts`, which `boardsmith
init` writes:

```ts
import { defineSmokeTest } from 'boardsmith/testing/browser';

defineSmokeTest({ actions: ['draw', 'play'] });
```

`boardsmith verify` copies the project's files into `.boardsmith/smoke/`, starts
`boardsmith dev` there on a free port (a fresh game, or a world from genesis,
leaving your own dev world alone), and runs the spec in Chromium. A player takes
a seat, takes every action the action panel offers, answering each choice (on
the board when the board shows it), and presses every control on the board once
(from the keyboard when the control is invisible and takes no pointer). At a table it
acts for every seat in turn, and starts a new game when one ends with listed
actions still to take. The check fails on any uncaught page error, any console
error, any failed request to the dev host, any offered action that fails, an
offered action `actions` does not list, and a listed action the walk never takes.
At a table every game is dealt from a seed, `"smoke"` unless the spec's `seed`
names others, so every run walks the same games; an action only some deals offer
is reached by choosing a seed whose deal offers it (see
[Choosing the deal](./browser-testing.md#choosing-the-deal-seed)). A listed
action no walk from a fresh game can reach whatever the deal is also named in
`unreachable`, with a sentence saying why; see
[Browser Testing](./browser-testing.md#actions-no-walk-from-a-fresh-game-can-reach-unreachable).
A game with no actions yet lists none and still has to load and seat a player
without an error.

The smoke test runs only under Playwright. The project's `vitest.config.ts`
leaves `'**/tests/browser/**'` out of vitest runs, at any depth, so a copy of the
spec in a git worktree kept inside the project is left out too. `boardsmith test`
refuses a config without it and says the exact line to change. The run
stops every process it started, and removes its copy, whether it passed, failed
or was interrupted. `boardsmith smoke` runs this check alone, on the files as
they stand, while you work.

The browser is Playwright's own Chromium build, downloaded once per machine with
`boardsmith install-browser`. It is never downloaded during a check: on a machine
without it the smoke check fails and says to run that command. It is never
skipped.

Commit first: a tree with uncommitted changes is refused before any check runs.
The result is written to `.boardsmith/verify/<commit>.json`, tied to that one
commit, to the base it measured from, and to whether the tree stayed clean while
the checks ran. `boardsmith verify --check` exits 0 only when the current commit,
on a clean tree, has a passing result, and otherwise says what to run. With
`--chunk <slug>` it also requires that result to have measured the chunk's whole
change: its base must be where the chunk began or a commit before that, so a
`--base HEAD` run, which mutates nothing, does not count. `boardsmith
chunk-signoff <slug>` asks the same question before it records a chunk as done.

#### Who does the work when the `bs-` skills build a game

The `bs-` skills hand work to roles, never to a named model: `mechanical`
(bulk edits, searches, summaries), `bounded` (implementation where failing tests
say what done is), `judgement` (spec, investigate, red team, fidelity, anything
touching a ruling), `review` (once `boardsmith verify` has passed) and
`second-opinion` (an independent second reading, which `boardsmith validate`
keeps on a different agent from `judgement`).
`boardsmith claude` installs one Claude Code agent per role, `bs-mechanical`,
`bs-bounded`, `bs-judgement`, `bs-review` and `bs-second-opinion`, with a default model and effort. To
use other agents, map roles in `boardsmith.json`; a role left out stays on its
`bs-` agent:

```json
"agents": { "judgement": "senior", "review": "reviewer" }
```

```bash
boardsmith agent judgement              # the agent type to dispatch the role as
boardsmith agent bounded --escalate     # the step failed there twice: the next role up
boardsmith review-gate deal             # may a model review of chunk deal start?
```

`boardsmith review-gate <slug>` refuses unless the current commit passed
`boardsmith verify --chunk <slug>`, and otherwise prints the verify result every
review prompt carries, so no reviewer spends its time re-running the checks. A
step that fails its verify, whose work a check such as `claim-quote-check`
refuses, or whose reviewer asks for changes, is retried once at the same role
with the failure output. A second failure at that role moves it one role up
(`mechanical`, then `bounded`, then `judgement`), and a second failure at
`judgement` comes to you.

### 5. Build for Production

```bash
boardsmith build
```

### 6. Publish

Every publish names its platform. There is no default target — the flag is what
separates a dev deploy from one players will see.

```bash
boardsmith publish --prod    # the live platform
boardsmith publish --dev     # a local platform at http://localhost:3006
```

## Understanding the Generated Code

### Game Configuration (boardsmith.json)

```json
{
  "name": "my-game",
  "backend": "table",
  "displayName": "My Game",
  "description": "A fun game for 2-4 players",
  "audience": "casual",
  "tags": ["card-game"],
  "playtime": { "min": 15, "max": 30 },
  "cooperative": false,
  "complexity": 2,
  "scoreboard": { "stats": ["score"] }
}
```

The scaffold declares no `thumbnail`, because it creates no thumbnail image.
Add the key once there is art behind it — `boardsmith validate` fails on a
declared asset path that resolves to nothing, so a manifest can never name a
file the bundle does not carry:

```json
  "thumbnail": "./public/thumbnail.png"
```

#### Artwork that lives outside the bundle

A published bundle is served under an image allowlist: its own files and
`data:` URIs, and nothing else. A game whose artwork lives in a separate
repository therefore shows **no pictures at all** unless it says where they come
from, and it says so with `imageSources`:

```json
  "imageSources": ["https://raw.githubusercontent.com/owner/art/abc123/"]
```

Each entry is an `https://` origin, or an origin and a path **prefix ending in a
slash** — which is the one to prefer, because it pins one directory at one
commit rather than opening a whole host. Images only: scripts, styles, fonts,
connections and form targets are unaffected.

`boardsmith validate` scans the built bundle for remote image URLs and fails on
any the declaration does not cover, so a picture that renders on your laptop
cannot be silently blocked once the game is published.

### Game Class (src/rules/game.ts)

The Game class is the heart of your game. It:
- Extends `Game<YourGame, YourPlayer>`
- Registers element classes
- Creates the initial game state (deck, board, etc.)
- Registers actions players can take
- Defines the game flow

```typescript
export class MyGame extends Game<MyGame, MyPlayer> {
  // Tells the engine to construct each player as a MyPlayer
  static PlayerClass = MyPlayer;

  deck!: Deck;

  constructor(options: MyGameOptions) {
    super(options);

    // Register element classes (required for serialization)
    this.registerElements([Card, Hand, Deck]);

    // Create game elements
    this.deck = this.create(Deck, 'deck');

    // Set up initial state
    this.deck.shuffle();
    for (const player of this.players) {
      // Deal cards...
    }

    // Register player actions
    this.registerAction(createDrawAction(this));
    this.registerAction(createPlayAction(this));

    // Set up game flow
    this.setFlow(createGameFlow(this));
  }

  override isFinished(): boolean {
    return this.deck.count(Card) === 0;
  }

  override getWinners(): MyPlayer[] {
    // Return winning player(s)
  }
}
```

### Element Classes (src/rules/elements.ts)

Elements are the building blocks of your game state. BoardSmith provides base classes:

- **Space** - Containers that hold other elements
  - **Deck** - Stackable card pile (can shuffle)
  - **Hand** - Player's private cards
  - **Grid** - Square grid (e.g., chess board)
  - **HexGrid** - Hexagonal grid
- **Piece** - Physical game pieces
- **Card** - Playing cards

```typescript
import { Card as BaseCard, Hand as BaseHand, Deck as BaseDeck } from 'boardsmith';

export type Suit = 'H' | 'D' | 'C' | 'S';
export type Rank = 'A' | '2' | '3' | ... | 'K';

export class Card extends BaseCard {
  suit!: Suit;
  rank!: Rank;
}

export class Hand extends BaseHand {}
export class Deck extends BaseDeck {}
```

### Actions (src/rules/actions.ts)

Actions define what players can do. Use the fluent builder API:

```typescript
import { Action, type ActionDefinition } from 'boardsmith';

export function createPlayAction(game: MyGame): ActionDefinition {
  return Action.create('play')
    .prompt('Play a card from your hand')
    .chooseFrom('card', {
      prompt: 'Select a card to play',
      choices: (ctx) => [...ctx.player.hand.all(Card)],
    })
    .execute((args, ctx) => {
      const card = args.card as Card;
      card.remove();
      ctx.player.score += 1;
      return { success: true };
    });
}
```

### Flow (src/rules/flow.ts)

The flow defines turn structure and game phases:

```typescript
import { loop, eachPlayer, actionStep, sequence, type FlowDefinition } from 'boardsmith';

export function createGameFlow(game: MyGame): FlowDefinition {
  return {
    root: loop({
      name: 'game-loop',
      while: () => !game.isFinished(),
      do: eachPlayer({
        name: 'player-turns',
        do: sequence(
          actionStep({ actions: ['draw'] }),
          actionStep({ actions: ['play'] }),
        ),
      }),
    }),
    isComplete: () => game.isFinished(),
    getWinners: () => game.getWinners(),
  };
}
```

### UI (src/ui/App.vue)

The UI uses Vue 3 and the `boardsmith/ui` package:

```vue
<template>
  <GameShell
    game-type="my-game"
    display-name="My Game"
    :player-count="2"
  >
    <template #game-board="{
      gameView,
      playerSeat,
      isMyTurn,
      availableActions,
      actionArgs,
      actionController,
      setBoardPrompt
    }">
      <GameTable
        :game-view="gameView"
        :player-seat="playerSeat"
        :is-my-turn="isMyTurn"
        :available-actions="availableActions"
        :action-args="actionArgs"
        :action-controller="actionController"
        :set-board-prompt="setBoardPrompt"
      />
    </template>
  </GameShell>
</template>
```

The `actionController` is the recommended way to handle actions from custom UIs. See [UI Components](./ui-components.md#action-controller-api) for the full API.

## Important: Read Before You Start

Before diving into implementation, read [Common Pitfalls](./common-pitfalls.md) to avoid these critical issues:

1. **Object Reference Comparison** - Never use `.includes(element)` or `===` to compare elements. Always use `.some(e => e.id === element.id)` or `element.equals(other)`.

2. **Multi-Step Selection Filters** - When action B depends on selection A, handle `undefined` in your filter for availability checks.

3. **Dead Elements in Collections** - Element queries return all elements including "dead" ones. Filter explicitly with `.filter(e => !e.isDead)`.

These issues cause silent failures that are hard to debug. Five minutes reading the pitfalls guide will save hours of debugging.

## Next Steps

- **Start here**: [Common Pitfalls](./common-pitfalls.md) - Critical issues to avoid
- Read [Core Concepts](./core-concepts.md) to understand elements, actions, and state mutation
- Learn about [Actions & Flow](./actions-and-flow.md) for complex game logic
- Explore [UI Components](./ui-components.md) for building custom UIs
- See [Game Examples](./game-examples.md) for real implementations
- Writing a persistent world? [Persistent worlds](./persistent-worlds.md) says which half is this engine's
- Reference [Nomenclature](./nomenclature.md) for standard terminology

## Example Games

BoardSmith includes several example games:

| Game | Complexity | Key Features |
|------|-----------|--------------|
| **Hex** | Simple | Hex grid, path-finding win condition |
| **Go Fish** | Medium | Cards, hidden information, player interaction |
| **Checkers** | Medium | Square grid, multi-step moves, piece promotion |
| **Cribbage** | Complex | Multi-phase flow, simultaneous actions, scoring |

Study these to learn common patterns and best practices.
