# Getting Started with BoardSmith

BoardSmith is a TypeScript framework for building turn-based board and card games with built-in multiplayer support, bot opponents, and automatic UI generation.

## The path from an idea to players

BoardSmith is one install and one command away from a game you can play.
Install BoardSmith, then `boardsmith init my-game` scaffolds the project,
`npm install` pulls in the whole engine, `boardsmith dev` hosts real
multiplayer on your own machine with
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

- Node.js 22.13+ or 24+ (BoardSmith runs its own copy of ESLint 10 for `boardsmith lint` and `boardsmith validate`, and ESLint 10 supports only those versions; Node 23 is not supported)
- npm, pnpm, or yarn

## Quick Start

### 1. Create a New Game Project

Install BoardSmith first, or clone it and run `npm link` in the clone. The
new game links to the BoardSmith that ran `init`, so `init` refuses to run from
a one-off download in npm's `_npx` cache, which npm clears.

```bash
boardsmith init my-game
cd my-game
npm install
```

This creates a new game project with the following structure:

```
my-game/
├── boardsmith.json          # Game configuration
├── package.json             # Dependencies
├── tsconfig.json            # TypeScript config
├── vite.config.ts           # Vite and vitest config: defineGameViteConfig() from boardsmith/vite-config
├── index.html               # Entry HTML
├── public/                  # Static assets
├── src/
│   ├── main.ts              # App entry point
│   ├── rules/               # Game logic
│   │   ├── game.ts          # Main Game class
│   │   ├── elements.ts      # Custom element classes
│   │   ├── actions.ts       # Player action definitions
│   │   ├── flow.ts          # Game flow definition
│   │   ├── metrics.ts       # What `boardsmith simulate` measures (defineMetrics)
│   │   ├── data/cards.csv   # Card data, read with parseCsv
│   │   └── index.ts         # Exports gameDefinition
│   ├── sim/
│   │   └── index.ts         # Policies for `boardsmith simulate --policy` (a greedy one)
│   └── ui/                  # Vue UI components
│       ├── App.vue          # Main app component
│       ├── uis.ts           # The game's UIs, and which one ships
│       ├── components/      # Custom components
│       │   └── GameTable.vue
│       └── index.ts         # UI exports
└── tests/
    ├── game.test.ts         # Game tests
    ├── greedy.sim.test.ts   # A sim: plays seeded games with the greedy policy
    ├── a11y.example.test.ts # An axe-core scan of GameTable.vue
    └── browser/smoke.spec.ts # The in-browser smoke test `boardsmith verify` runs
```

Every game starts as a simulator: `boardsmith simulate --policy greedy` plays
seeded games of the scaffold's rules and reports their balance from the
metrics in `src/rules/metrics.ts`. See [boardsmith/sim](./api/sim.md), and
[the balance simulator worked example](./balance-simulator.md) for a game grown
from a simulator to a playable game one stage at a time.

`init` also installs a git `pre-commit` hook that runs the rulebook ingest
synthesis (`boardsmith ingest-gaps`) on every commit. A fresh clone has no hook,
and a BoardSmith upgrade can change it, so `boardsmith doctor` reports a missing
or outdated hook and `boardsmith doctor --fix` writes the current one, along
with the rest of the project layout it checks. A `pre-commit` hook BoardSmith
did not write, or one doctor cannot read, is left alone: doctor prints a note
and its exit code does not change. To use BoardSmith's hook instead, move your
own commands elsewhere, delete `.git/hooks/pre-commit` and run
`boardsmith doctor --fix`, or run `boardsmith ingest-gaps` yourself after
transcription.

#### Starting as a simulator, with no UI yet

To balance the rules before building anything to look at, pass `--sim`:

```bash
boardsmith init my-game --sim
cd my-game
npm install
boardsmith simulate --policy greedy
```

That writes the same project without its UI: no `index.html`, `src/main.ts`,
`src/ui/`, `tests/a11y.example.test.ts` or `tests/browser/smoke.spec.ts`.
`boardsmith test`, `lint`, `typecheck`, `validate` and `simulate` work as
usual (validate's Required Files check asks only for the rules). `dev`, `build`,
`smoke` and `publish` stop with "This project has no UI yet. Run
`boardsmith add-ui`." `boardsmith verify` runs test, typecheck, validate and
verbs, and records build and smoke as skipped for that reason; its closing
line and `verify --check` name the skipped checks. A table that loses
`index.html` but keeps any other UI file is broken, not a simulator: those
commands stop and name the files, and `verify` fails build and smoke. `--sim`
cannot be combined with `--world`.

When you want to play it, run `boardsmith add-ui` in the project. It writes
the UI files the table scaffold has, with the smoke spec listing the actions
your rules register at that moment, and refuses, naming them, if any of those
files already exists. `package.json` already has every dependency the UI
needs, so there is nothing to install.

#### Starting a persistent world instead

A **persistent world** is the other backend: named partitions rather than a
whole resident tree, a checkpoint of what a command dirtied rather than a
snapshot per action, and a clock that acts on its own rather than a turn order.
It is what a game IS, not something a run selects, so it is chosen once, when
the project is created:

```bash
boardsmith init my-world --world
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

# Keep the Debug panel on with several people seated. Without it, debugging is
# on only while one browser holds every human seat (solo or hot-seat play).
# With it, every seated person's Decks tab shows every face-down card and
# every other player's hand, so use it only at a table you trust.
boardsmith dev --debug

# Don't auto-launch a browser tab (for scripts/CI driving the dev host,
# so an uncontrolled tab doesn't claim seat 1)
boardsmith dev --no-open
```

### 3. Run Tests

```bash
boardsmith test           # Run once
boardsmith test --watch   # Watch mode
boardsmith test --sims    # Run only the sims
```

A test file's name sets its class, and the class sets where it runs:

| Class | File name | Merge (`agent-policy merge`) | `boardsmith verify` | Publish | On request |
|---|---|---|---|---|---|
| Unit | `*.test.ts` | Yes: the tests the change touches, then a slice of the suite | Yes | Yes (publish needs a passing verify) | `boardsmith test` |
| Sim | `*.sim.test.ts` | No | No | No | `boardsmith test --sims` |
| Browser | `tests/browser/*.spec.ts` | No | Yes, as the smoke test | Yes (publish needs a passing verify) | `boardsmith smoke` |

A sim is any test that plays whole games: random-game sims, whole matches, bot
games, and pace or budget runs. Sims never run automatically. The game's
`vite.config.ts` (`defineGameViteConfig`) leaves them out of every plain vitest
run, so `boardsmith test`, `boardsmith verify` and a merge skip them, and
`boardsmith test --sims` runs only them. A test file whose name does not end in
`.sim.test.ts` and imports a tool that plays whole games (`simulateRandomGames`
or `replayRandomGame` from `boardsmith/testing`, `playGame` from
`boardsmith/sim`, `createBot` or `MCTSBot` from `boardsmith/bot`, or
`benchmarkBot` or `WeightEvolver` from `boardsmith/bot-trainer`) fails when it
loads, with a message telling you to rename it to `.sim.test.ts`.

#### Showing the tests of a change can fail: `boardsmith mutate`

```bash
boardsmith mutate --base main    # 3 small breaks of the code changed since main
```

A test that cannot fail proves nothing. `boardsmith mutate` makes small changes
(mutants) to the code lines under `src/` changed since the merge base of HEAD
with `--base` (committed, staged, unstaged and untracked): it flips a
comparison, negates a condition, drops a statement or returns `undefined`. It
tries a sample of 3, picked with the current commit as the seed, so running it
again on the same commit tries the same ones. The changed files take turns, so
up to 3 files each get one. It is meant to run at every merge, on the ticket's
own change, so it stays small and fast.

It runs only unit tests, and only the test files that import a sampled mutant's
file, directly or through other files (`vitest related`); a sim never runs. It
runs those test files once unchanged first, recording which files each one
loads, and they must pass; then it runs them against each mutant, all 3 at
once, stopping a run at the first failing test. A mutant no test notices fails
the run, named by file and line, and so does one in a file none of those tests
loads. A mutant that makes its run go past the time limit (an infinite loop,
or a busy machine) counts as timed out, not as a survivor, and not as caught:
when the mutants only time out and none is killed, the run fails, since no test
was shown to notice a change. When `--base` measures no change (its
merge base is the current commit on a clean tree), `boardsmith mutate` refuses
rather than pass on nothing.

```
FAIL  1 of 3 mutants of the lines changed since main (4f2a9c1e0b3d) survived: every test that loads its file still passed with the code changed.
        src/rules/trade.ts:42 > -> >=: no test failed
```

Because only the test files that import the changed files run, a test that
passes only after another test file has run (shared state under `isolate:
false`, or the order files run in) fails the unchanged run, and the message
says so: make each test file set up what it needs itself. Vitest picks those
test files by their own imports, so a file that a test reaches only through a
setup file or a global setup, not an import, has no test files of its own and
counts as imported by no test: add a test that imports it. (When a game has a
global setup, every test file that does run counts as loading every file,
since what the global setup hands the tests cannot be traced.)

A game with Vitest projects (`test.projects` in its config, or a workspace:
`test.workspace`, or `vitest.workspace.ts` beside its config) gets each mutant
in every project defined inline, such as
`{ extends: './vitest.browser.config.ts' }`. A project named only by a path or
glob builds its own config, which `boardsmith mutate` cannot change, so it
refuses to run, names the project, and says how to write it inline.

By default all 3 mutants run at once and each Vitest run picks its own number
of workers. To hold them to a budget, set one in `boardsmith.json`:

```json
"mutation": { "trials": 2, "workers": 8 }
```

Then `trials` mutants run at once, each with `workers / trials` test workers
(rounded down), and the unchanged run gets all `workers`. With a budget, a
Vitest config that would run workers outside it (`poolOptions` worker counts,
`poolMatchGlobs`, typecheck or browser mode, a different pool per project, a
custom pool, or under Vitest 4 a `maxWorkers` over the share) is refused,
naming the setting. Stopping `boardsmith mutate` with Ctrl+C stops every Vitest
it started before removing its temporary files.

`boardsmith lint` runs BoardSmith's pitfall checks, plus ESLint and Stylelint
when the project has a config for them. It finds a config wherever the linter
would: in the project folder, any parent folder, and the folders under `src/`
the linter reads (any folder but `node_modules` for ESLint, hidden ones
included; a folder holding a `.vue` file for Stylelint). ESLint is asked directly. Stylelint cannot be asked, so lint
copies Stylelint 17's search, and stops on any other installed Stylelint major
with the command to install 17 (`npm install -D stylelint@17`).

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
boardsmith verify --base v1.2        # say which failing tests are in files changed since v1.2, not main
boardsmith verify --chunk deal       # a bs- chunk's fast checks: its own tests and typecheck
boardsmith verify --check            # has this commit passed the full verify? (runs nothing)
boardsmith verify --check --chunk deal   # ...or chunk deal's fast checks?
```

`boardsmith verify` runs the full suite, `boardsmith typecheck`, `boardsmith
build`, `boardsmith validate`, the in-browser smoke test and a verbs check side
by side, and keeps going after a failure so you see every problem at once.
Validate starts once build is done, since it measures the bundle build wrote in
`dist/`. The result lists the checks in that order, whichever finished first.
The verbs check asks that every verb the game defines
(`Action.create('<verb>')`, `worldAction('<verb>')` or a wrapper of the
project's own) is dispatched through the engine by some test file, such as
`testGame.doAction(seat, '<verb>')`; a test that calls the rules function
directly does not count. A failing test is named as in a file the change
touched since the main branch (or since `--base`), or in one it did not.

The smoke test is your game's `tests/browser/smoke.spec.ts`, which `boardsmith
init` writes:

<!-- typecheck: game tests/browser/smoke.spec.ts -->
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

The smoke test runs only under Playwright. The project's `vite.config.ts` builds
its config with `defineGameViteConfig` from `boardsmith/vite-config`, which
leaves `'**/tests/browser/**'` out of vitest runs, at any depth, so a copy of the
spec in a git worktree kept inside the project is left out too. `boardsmith test`
refuses a config not built with it, and `boardsmith doctor --fix` rewrites one. The run
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
the checks ran, with a fingerprint of the bundle build wrote in `dist/`, which
is what `boardsmith publish` uploads. The BoardSmith commit it names is the one the run started with.
What the tests run with must also hold still for the whole run: the BoardSmith
the command runs and the game loads (its commit and uncommitted changes), the
installed packages, and the packages linked from outside the repository. If any
of these changes, for example a linked BoardSmith checkout moves to a new
commit, the run ends with an error naming what changed. It records no result,
since checks after the change ran against different code. Run it again in a checkout nothing else
edits while it runs, such as a separate BoardSmith worktree.
`boardsmith verify --check` exits 0 only when the current commit,
on a clean tree, has a passing full result, and otherwise says what to run.

For a chunk the `bs-` skills build, `boardsmith verify --chunk <slug>` runs only
the fast checks the chunk's gates need: the test files the chunk added or changed
since the commit before its first `chunk-<slug>/` commit, and typecheck. A chunk
that added or changed no test file fails it. The full checks above run once,
before the game is published, not per chunk. `boardsmith verify --check --chunk
<slug>`, `boardsmith review-gate <slug>` and `boardsmith chunk-signoff <slug>`
accept only that chunk's passing fast checks, and every other question accepts
only the full verify, so neither stands in for the other.

#### Who does the work when the `bs-` skills build a game

The `bs-` skills hand work to roles, never to a named model: `mechanical`
(bulk edits, searches, summaries), `bounded` (implementation where failing tests
say what done is), `judgement` (spec, investigate, red team, fidelity, anything
touching a ruling), `review` (once `boardsmith verify --chunk` has passed) and
`second-opinion` (an independent second reading, which `boardsmith validate`
keeps on a different agent from `judgement`).
`boardsmith claude` installs one Claude Code agent per role, `bs-mechanical`,
`bs-bounded`, `bs-judgement`, `bs-review` and `bs-second-opinion`, with a default model and effort. Run
from a clone of BoardSmith, it also runs `npm link` there so `boardsmith` works
anywhere; run from an installed copy, it skips that step and says so, since
linking would point the global command into one game's `node_modules`. To
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
review prompt carries: that only the chunk's tests and typecheck ran, and that
the full suite, build, validate, the smoke test and the verbs check run at
publish, so no reviewer spends its time running checks. It reads what is under
review from the chunk's run log: the change since the last review round, sized
as mechanical only when every dispatch logged since was. That round's commit must
have a passing `verify --chunk <slug>` result in this checkout (`chunk-merge`
copies a chunk's results out of its worktree); in a fresh clone, check out that
commit and run `boardsmith verify --chunk <slug>` on it. A
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

Publish refuses unless a full `boardsmith verify` passed for the exact commit
being published, on a clean tree. There is no flag to skip it. The result must
not be a chunk's fast checks and must not skip a check. Publish then uploads the
bundle that verify built in `dist/`, so it does not validate, type-check or
build again. If `dist/` is missing, or is no longer exactly what verify built
(a later `boardsmith build` or an edit changed it), publish refuses and says to
run `boardsmith verify` again.

The first publish to a platform needs `--publisher <slug>`, naming the publisher
that owns the game there. Afterwards `boardsmith publish` saves the ids that
platform gave the game under its own block in `boardsmith.json`, and later
publishes to the same platform reuse them:

```json
  "platforms": {
    "dev": { "gameId": "...", "publisherId": "..." },
    "prod": { "gameId": "...", "publisherId": "..." }
  }
```

Dev and prod are separate deployments, so a publish reads and writes only its
own platform's block. If a platform is reset, delete that platform's block and
publish to it again with `--publisher <slug>`; the other block is untouched.

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
  "complexity": 2
}
```

The scaffold declares no `thumbnail`, because it creates no thumbnail image.
Add the key once there is art behind it — `boardsmith validate` fails on a
declared asset path that resolves to nothing, so a manifest can never name a
file the bundle does not carry:

```json
  "thumbnail": "./public/thumbnail.png"
```

#### Game options

A game's options live here too, and only here: a `gameOptions` list, each entry
with an `id` and a `default`. The game reads `options.<id>` in its constructor,
and every host (the lobby, the dev host, `boardsmith simulate`, `createTestGame`)
starts it with every option at its default unless someone chose another value,
so the default is never repeated in code. See "Game Options" in
[core-concepts.md](core-concepts.md).

```json
  "gameOptions": [
    { "id": "rounds", "type": "number", "label": "Rounds", "min": 1, "max": 5, "default": 3 }
  ]
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

<!-- typecheck: game src/rules/game.ts -->
```typescript
import { Game, Player, type GameOptions } from 'boardsmith';
import { Card, Hand, Deck } from './elements.js';
import { createDrawAction, createPlayAction } from './actions.js';
import { createGameFlow } from './flow.js';

// Declared before MyGame so its static PlayerClass can name it.
export class MyPlayer extends Player<MyGame, MyPlayer> {
  hand!: Hand;
  score = 0;
}

export class MyGame extends Game<MyGame, MyPlayer> {
  // Tells the engine to construct each player as a MyPlayer
  static PlayerClass = MyPlayer;

  deck!: Deck;

  constructor(options: GameOptions) {
    super(options);

    // Register element classes (required for serialization)
    this.registerElements([Card, Hand, Deck]);

    // Create game elements: a deck, and a hand only its owner can see
    this.deck = this.create(Deck, 'deck');
    for (const suit of ['H', 'D', 'C', 'S'] as const) {
      for (const rank of ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const) {
        this.deck.create(Card, `${rank}${suit}`, { suit, rank });
      }
    }
    for (const player of this.players) {
      player.hand = this.create(Hand, `hand-${player.seat}`);
      player.hand.player = player;
      player.hand.contentsVisibleToOwner();
    }

    // Set up initial state
    this.deck.shuffle();
    for (const player of this.players) {
      for (let i = 0; i < 5; i++) {
        this.deck.first(Card)?.putInto(player.hand);
      }
    }

    // Register player actions
    this.registerAction(createDrawAction());
    this.registerAction(createPlayAction());

    // Set up game flow
    this.setFlow(createGameFlow());
  }

  // The one place the game's end is declared: the flow stops as soon as
  // this is true, and getWinners() names who won.
  override isFinished(): boolean {
    return this.deck.count(Card) === 0;
  }

  override getWinners(): MyPlayer[] {
    if (!this.isFinished()) return [];
    const best = Math.max(...this.players.map((player) => player.score));
    return this.players.filter((player) => player.score === best);
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

<!-- typecheck: game src/rules/elements.ts -->
```typescript
import { Card as BaseCard, Hand as BaseHand, Deck as BaseDeck } from 'boardsmith';

export type Suit = 'H' | 'D' | 'C' | 'S';
export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';

export class Card extends BaseCard {
  suit!: Suit;
  rank!: Rank;
}

export class Hand extends BaseHand {}
export class Deck extends BaseDeck {}
```

### Actions (src/rules/actions.ts)

Actions define what players can do. Use the fluent builder API:

<!-- typecheck: game src/rules/actions.ts -->
```typescript
import { Action, type ActionDefinition } from 'boardsmith';
import type { MyGame } from './game.js';
import { Card } from './elements.js';

export function createDrawAction(): ActionDefinition {
  return Action.create<MyGame>('draw')
    .prompt('Draw a card')
    .execute((args, ctx) => {
      ctx.game.deck.first(Card)?.putInto(ctx.player.hand);
      return { success: true };
    });
}

export function createPlayAction(): ActionDefinition {
  return Action.create<MyGame>('play')
    .prompt('Play a card from your hand')
    .chooseFrom('card', {
      prompt: 'Select a card to play',
      choices: (ctx) => [...ctx.player.hand.all(Card)],
    })
    .execute(({ card }, ctx) => {
      card.remove();
      ctx.player.score += 1;
      return { success: true };
    });
}
```

### Flow (src/rules/flow.ts)

The flow defines turn structure and game phases:

<!-- typecheck: game src/rules/flow.ts -->
```typescript
import { loop, eachPlayer, actionStep, sequence, type FlowDefinition } from 'boardsmith';

export function createGameFlow(): FlowDefinition {
  return {
    root: loop({
      name: 'game-loop',
      // A safety tripwire: the loop throws at 100 rounds. The game ends first,
      // when MyGame.isFinished() is true.
      maxIterations: 100,
      do: eachPlayer({
        name: 'player-turns',
        do: sequence(
          actionStep({ actions: ['draw'] }),
          actionStep({ actions: ['play'] }),
        ),
      }),
    }),
  };
}
```

### UI (src/ui/App.vue)

The UI uses Vue 3 and the `boardsmith/ui` package. `src/ui/uis.ts` lists the
game's boards, and `App.vue` hands that registry to `GameShell`:

```ts
// src/ui/uis.ts, which imports defineGameUIs and defaultUI from 'boardsmith/ui',
// and GameTable from './components/GameTable.vue'
export default defineGameUIs({ GameTable: defaultUI(GameTable) });
```

```vue
<!-- src/ui/App.vue, whose <script setup> imports GameShell from 'boardsmith/ui' and uis from './uis.js' -->
<template>
  <GameShell :uis="uis" />
</template>
```

`GameShell` mounts `GameTable` and passes it `TableBoardProps` (declare them
with `defineProps<TableBoardProps>()`, importing the type from `boardsmith/ui`;
see [Board props](./ui-components.md#board-props)). The `actionController` is the recommended way to handle actions from custom UIs. See [UI Components](./ui-components.md#action-controller-api) for the full API.

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
