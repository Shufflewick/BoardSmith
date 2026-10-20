# boardsmith/sim

> Policies for the balance simulator: what plays each seat in `boardsmith simulate`.
> The game's own metrics, declared with `defineMetrics` from `boardsmith`, and the
> report `boardsmith simulate` prints are described below.

## When to Use

Import from `boardsmith/sim` in your project's `src/sim/index.ts` to give
`boardsmith simulate --policy <name>` policies of your own. `random` and
`mcts:<level>` need no file: they are always available by name.

Every project `boardsmith init` scaffolds starts as a simulator: a greedy
policy in `src/sim/index.ts`, metrics in `src/rules/metrics.ts`, card data in
`src/rules/data/cards.csv`, and `tests/sim.test.ts`, which plays seeded games
with the greedy policy through `playGame`. `boardsmith init <name> --sim`
writes the project with no UI at all, and `boardsmith add-ui` adds it later
(see [Getting started](../getting-started.md#starting-as-a-simulator-with-no-ui-yet)).

[The balance simulator worked example](../balance-simulator.md) walks through
all of it on one small drafting game, from the first report to a playable game.

## Usage

```typescript
// src/sim/index.ts: greedy comes from 'boardsmith/sim', MyGame from '../rules/game.js'

export const policies = {
  // Play the move that takes the most cards.
  greedy: greedy<MyGame>((game, move, seat) => game.cardsTakenBy(move, seat)),
};
```

```bash
boardsmith simulate --policy greedy             # every seat
boardsmith simulate --policy greedy --policy 2=random
boardsmith simulate --policy mcts:easy --players 2,4
```

`boardsmith simulate` bundles `src/sim/index.ts` with your rules, so a policy
shares the game's engine. Its options are described in
[boardsmith/testing](./testing.md#headless-simulation-sim).

## Exports

- `random()` - Builds one random, valid move from each of the seat's enabled
  actions, step by step from the engine's own choices, and one from its held
  follow-up (`turn.followUp`), and plays one of them (#911).
  The policy `simulateRandomGames` plays every seat with. A follow-up's move
  is built differently from an action's: it comes from move enumeration, so a
  number input its args leave open is listed only with `min`, `max` and
  `integer: true` (an action's needs only `min` and `max`), and
  `onSelectionChoices` never sees its choice steps, so the choice-cardinality
  audit of `boardsmith validate` skips an action reached only as a follow-up.
- `greedy(score)` - Scores every legal move of the seat
  (`enumerateLegalMoves`) with `score(game, move, seat)` and plays the highest,
  breaking a tie with the seat's own seeded generator. `score` must return a
  finite number. A number input is listed only when it has `min`, `max` and
  `integer: true` and at most 10,000 values (#689); greedy reports a seat
  offered any other number input as stuck and names the input. A held
  follow-up whose args already answer the number is played as normal. An
  action with more moves than enumeration lists (it tries at most 10,000
  values for one action, counting each value of each selection under every
  pick before it, #691) is reported as stuck too, naming the
  action: greedy scores every move or none.
- `mcts(level)` - Plays the game's own MCTS bot (`gameDefinition.bot`) at a
  difficulty name or an iteration count. Each search is seeded from the seat's
  generator and runs its full iterations with no time limit, so a seeded run
  plays the same moves every time. It needs the definition's `gameType`.
- `playGame(definition, { playerCount, seed, policies, maxActions })` - Plays
  one seeded game to its end, one policy per seat (seat 1 first), and resolves
  with its result: `completed`, or why not (`error`). It is the loop
  `boardsmith simulate` plays each game with, for a test of your own:

  ```typescript
  const result = await playGame(gameDefinition, {
    playerCount: 2,
    seed: 'one',
    policies: [policies.greedy, policies.greedy],
    maxActions: 1000,
  });
  expect(result.completed).toBe(true);
  ```

- `Policy` - `{ name, choose(turn) }`. `choose` returns a move
  (`{ action, args }`), or `{ noMove: reason }` when its seat has none it can
  play; it may return a promise.
- `PolicyTurn` - What `choose` is handed: the live `game`, the `seat` to move,
  its enabled `actions`, the `followUp` it holds, if any (#1078), its own
  seeded `random` generator and the game `definition`. A held follow-up is
  not among `actions` and may be the seat's only move, with `actions` empty:
  play it as `{ action: followUp.action, args }`, where `args` keeps
  `followUp.args` and adds the picks they leave open.
- `PolicyMove`, `PolicyChoice`, `SimulatedGame`, `PlayGameConfig` - The shapes above.

## Rules a policy plays by

- **Return only moves the action accepts.** The first move the game rejects
  ends that game as stuck, with an error that names the action, the move and
  the policy, followed by the action's own reason. A rejected move is never
  retried: either the action offers a choice its validation refuses, or the
  policy built a move outside the choices it was offered.
- **Read the game, never change it.** A policy is handed the real game. One
  whose work changes it in a way the engine tracks (creates, moves or removes
  an element, draws from `game.random`, or writes through `actionTempState`)
  ends that game as crashed, with an error that names the policy. A write to a
  plain attribute or to `game.settings` is NOT detected: the engine cannot see
  it, so the game plays on from the changed state and the results are silently
  wrong. A policy must only read.
- **It can see hidden cards.** Nothing redacts the game a policy reads, so a
  policy that should play fair must not read what its seat cannot see.
- **Draw only from `turn.random`.** The game, the choice of which due seat
  moves, and each seat's policy draw from separate generators derived from the
  game's seed, so the same seed replays the same game, and changing one seat's
  policy does not change another seat's draws.

## Author metrics

A game declares what the simulator measures with `defineMetrics` from
`boardsmith`, and wires it once as `gameDefinition.metrics`. Nothing else is
needed for `boardsmith simulate` to report it.

```typescript
// src/rules/metrics.ts: defineMetrics comes from 'boardsmith', MyGame from './game.js'

export const metrics = defineMetrics(({ count, ratio, sample, category, segment, finalScore }) => ({
  held: count({ by: 'element' }),
  built: count({ by: 'element' }),
  buildRate: ratio('built', 'held'),
  shortOf: count({ by: 'category' }),
  draftChoice: category(['neither', 'one', 'both']),
  buildsPerRound: sample(),
  leftOver: sample({ atEnd: (game: MyGame, player) => player.resources }),
  startingTool: segment((game: MyGame, player) => player.tool.name),
  score: finalScore((game: MyGame, player) => player.score),
}));

// src/rules/index.ts
export const gameDefinition = { gameClass: MyGame, /* ... */ metrics };

// in the game's constructor, an action's execute, a pick's onSelect or onEach, or a flow step:
metrics.built.add(game, card);              // count by element: keyed by the element's name
metrics.shortOf.add(game, 'wood', 2);       // count by category, adding 2
metrics.draftChoice.record(game, 'both');   // one of the declared values
metrics.buildsPerRound.add(game, built);    // one number
```

The kinds:

- `count()` - `add(game, amount = 1)`. `count({ by: 'element' })` -
  `add(game, element, amount = 1)`, keyed by the element's `name` (an element
  with no name is refused). `count({ by: 'category' })` -
  `add(game, category, amount = 1)`.
- `ratio(numerator, denominator)` - the keys of two counts in the same
  `defineMetrics`, declared with the same `by`. Nothing records it: the report
  divides the numerator's total by the denominator's, over every game.
- `sample()` - `add(game, value)`, a distribution of numbers.
  `sample({ atEnd: (game, player) => number })` is read instead, once per
  player when the game ends, and has no `add`.
- `category([...values])` - `record(game, value)`, one of the declared values.
- `segment((game, player) => label)` - read once per player when the game
  ends; the report gives the win share of each label (a starting tool, a
  faction, a seat's opening).
- `finalScore((game, player) => number)` - read once per player when the game
  ends.

### Where records go

- **Real play records nothing.** Without the simulator, every `add` and
  `record` returns at once and changes neither the game nor its snapshot.
- **Only the game the simulator plays records.** The games an MCTS seat
  searches, and the scratch copies used to list a repeating pick's moves, are
  games of their own and record nothing.
- **Only committed actions count.** An action's records are kept when it
  commits; an action that is refused or rolled back (its `execute` threw)
  leaves none. Records made in the game's constructor (a deal), while the flow
  starts and in flow steps are kept.
- **Record only in code that builds or changes the game**: the game's
  constructor, an action's `execute`, a pick's `onSelect` or `onEach`, or a
  flow step. In a simulation, a record made anywhere else (a `choices` or
  `filter` callback, a condition, a policy), of a metric
  `gameDefinition.metrics` does not declare (or with no `gameDefinition.metrics`
  at all), with a number that is not finite, a category not declared or an
  element with no name, ends the game as crashed with an error naming the
  metric, even if game code caught the throw. So does a `segment` that gives
  an empty label, or a `finalScore` or `sample({ atEnd })` that gives a number
  that is not finite. `simulateRandomGames` has no metrics to check against,
  so there a game records nothing, as in real play.

## Card data from CSV

Keep the numbers a balance run tunes in a spreadsheet, export it as CSV beside
the rules, and read it with `parseCsv` from `boardsmith`. Import the file with
`?raw` so its text is bundled with the rules; build the elements with an
ordinary `create` loop.

```csv
name,cost,rare,tags
Goblin,2,no,monster;green
"Troll, Big",5,yes,monster
```

```typescript
// src/rules/game.ts: parseCsv comes from 'boardsmith', and
// cardsCsv is `import cardsCsv from './data/cards.csv?raw'`

const cards = parseCsv(
  cardsCsv,
  { name: 'string', cost: 'number', rare: 'boolean', tags: 'list' },
  { source: 'src/rules/data/cards.csv' },
);

// in the game's constructor:
for (const card of cards) {
  this.deck.create(Card, card.name, { cost: card.cost, rare: card.rare, tags: card.tags });
}
```

A bad cell stops the game from loading with the file, row and column, such as
`src/rules/data/cards.csv row 3, column "cost": "five" is not a number`. The
rules and the error messages are in [the engine API](./index.md#card-data-from-csv).

## The balance report

`boardsmith simulate` reports each player count once every game has finished
(a run with an unfinished game reports no statistics). Each player count has:

- **games** - how many games were played.
- **Win share by seat** - the share of games each seat won alone, and **Ties**,
  the share won by no seat or by several.
- **Game length** in actions.
- **Win share by each `segment`** - per label, how many player-games had it
  and the share of those won alone.
- **Each `finalScore`** - its distribution over every player of every game,
  and `spread`, the mean gap between the highest and lowest score in a game.
- **Each `count`** not by element - per key, the total per game.
- **Each `sample`** - every value recorded.
- **Each `category`** - each declared value's share of the records.
- **Each `ratio`** not by element - per key, the pooled ratio.
- **Per element** - one row per element name, with a column per count by
  element (its total per game) and per ratio of counts by element (pooled).

A distribution gives `n`, `mean` with its 95% interval (`low`, `high`, from the
standard error), `sd`, `p10`, `p50`, `p90`, `min` and `max`. A share gives
`share` with its 95% Wilson interval (`low`, `high`). A ratio whose
denominator totals 0, or a sample with no values, has nothing to divide by:
`-` in the tables, `null` in JSON and empty in CSV. A count nothing recorded
is still reported, as 0 per game.

The intervals on category shares, sample means, segment win shares and score
means treat every record (or player) as independent. Records from one game are
not (one player's builds in a game depend on each other, and one game's scores
move together), so those intervals are optimistic: read them as a lower bound
on the uncertainty. Win share by seat, ties, game length and counts per game
have one value per game, so their intervals are sound. Games are
combined in game order, so the same seed gives the same report.

- **Tables** (the default) - one table per section and metric.
- **`--json`** - `{ run, games, report }`: `games` lists only the games that
  did not finish, and `report` is an array with one entry per player count
  holding `players`, `games`, `winShare`, `tieRate`, `length`, `segments`,
  `scores`, `counts`, `samples`, `categories`, `ratios` and `elements`, or
  `null` when any game did not finish. A run with `--compare` gives
  `{ run, variants }` instead (see [comparing variants](#comparing-variants)).
- **`--csv`** - one statistic per row:
  `variant,players,section,metric,key,stat,value`. `variant` is the variant's
  label in a run with `--compare`, and empty otherwise. `section` is `games`, `winShare`,
  `ties`, `length`, `segment`, `score`, `count`, `sample`, `category`, `ratio`
  or `element`; `metric` is empty for the built-in sections; `key` is the seat,
  label, category, count key or element name. In an `element` row, `stat` is
  the column's metric name.

```
,2,winShare,,1,share,0.512
,2,score,score,,mean,41.3
,2,element,,Forge,buildRate,0.27
```

## Comparing variants

`--compare <dimension>=<value>,<value>,...` plays the same games under each
value and prints them side by side. The dimension is one of:

- **`policy`** - each value is one more `--policy` flag, such as
  `--compare policy=random,greedy` or `--compare policy=2=random,2=greedy`.
- **A declared game option** - `--compare hand=5,7`, for an option in
  `boardsmith.json`'s `gameOptions`, the one place a game declares them. Each
  value is read as `--game-option` reads it, so an option the game does not
  declare is refused, and every option neither flag sets is played at its
  declared default.
  Give an option in `--compare` or in `--game-option`, not both. A
  designer-only option (`designerOnly: true`), which no player can choose, is
  set here like any other; that is what it is for.
- **A data file the rules import** - `--compare src/rules/data/loot.csv=data/loot-75.csv,data/loot-85.csv`.
  Each value is a file played in that file's place, as if its contents were
  the original's. List the original itself to keep it as one of the variants.
  Paths are relative to the project. A file the rules never import is refused,
  since swapping it would change nothing.

The first value of each dimension is the base. Repeat `--compare` to play
every combination of the values, first flag slowest; a run compares at most 12
variants. Each variant is labelled `dimension=value` for each dimension,
separated by spaces, such as `policy=greedy hand=7`.

```bash
boardsmith simulate --games 1000 --seed tune --compare src/rules/data/loot.csv=data/loot-75.csv,data/loot-85.csv
```

Every variant plays the same games: game `i` at each player count has the seed
`<seed>-<players>-<i>` in every variant, and each seat's policy draws from the
same generator. **The same seed is not the same deal once a variant draws a
different number of random values.** A variant that shuffles a bigger deck, or
whose policy looks at one more random choice, moves every later draw, so its
games part ways with the base from that point on. Compare variants over many
games, not game by game.

- **Tables** - a column per variant, numbered as the list at the top of the
  output numbers them. Each variant after the first shows its difference from
  the first in brackets; a share's difference is in percentage points (`pts`).
- **`--json`** - `{ run, variants }`. `run` holds the `seed`, `gamesPerCount`,
  `players` and `compare` (each dimension with its values). Each variant holds
  its `label`, `policies` (its `--policy` flags), `gameOptions`, `data` (each
  swapped file and the file played in its place), `games` (the games that did
  not finish) and `report`.
- **`--csv`** - every variant's rows under one header, each row's `variant`
  set to the variant's label.

A game that does not finish in any variant fails the run, which then prints no
statistics. Its replay line carries its variant: the `--game-option` and
`--policy` flags it was played with, and each data file it swapped as a
one-value `--compare`, such as
`boardsmith simulate --replay tune-2-14 --players 2 --compare src/rules/data/loot.csv=data/loot-85.csv`.

## Parallel runs

`--jobs <n>` plays the games on `n` worker threads; it defaults to the number
of cores, and `--jobs 1` plays them on one. Each worker loads the same rules
bundle. The games are dealt round-robin, game `i` to worker `i % n`, so a run
over several player counts gives every worker some of each, and the results
are put back in game order, so the output is byte for byte the same whatever
`--jobs` is.

Games are played in production mode, as the published game plays them,
whatever `--jobs` is. Production mode leaves the text of an error the rules
throw out of the game's message, so each game that does not finish is played
again in development mode to report its real message. `--replay` plays in
development mode.

A game that fails in production mode but finishes in development mode is
reported as failing only in production mode, with no replay line, since
`--replay` would finish it. That usually means game code changes state inside
a callback that only describes the game (a `choices`, condition or filter
callback), which production mode caches.
