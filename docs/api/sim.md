# boardsmith/sim

> Policies for the balance simulator: what plays each seat in `boardsmith simulate`.
> The game's own metrics, declared with `defineMetrics` from `boardsmith`, and the
> report `boardsmith simulate` prints are described below.

## When to Use

Import from `boardsmith/sim` in your project's `src/sim/index.ts` to give
`boardsmith simulate --policy <name>` policies of your own. `random` and
`mcts:<level>` need no file: they are always available by name.

## Usage

```typescript
// src/sim/index.ts
import { greedy } from 'boardsmith/sim';
import type { MyGame } from '../rules/game.js';

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
  actions, step by step from the engine's own choices, and plays one of them.
  The policy `simulateRandomGames` plays every seat with.
- `greedy(score)` - Scores every legal move of the seat
  (`enumerateLegalMoves`) with `score(game, move, seat)` and plays the highest,
  breaking a tie with the seat's own seeded generator. `score` must return a
  finite number. A move that takes a number input cannot be listed (#689), so
  greedy reports a seat offered one as stuck and names the input; a held
  follow-up whose args already answer the number is played as normal.
- `mcts(level)` - Plays the game's own MCTS bot (`gameDefinition.bot`) at a
  difficulty name or an iteration count. Each search is seeded from the seat's
  generator and runs its full iterations with no time limit, so a seeded run
  plays the same moves every time. It needs the definition's `gameType`.
- `Policy` - `{ name, choose(turn) }`. `choose` returns a move
  (`{ action, args }`), or `{ noMove: reason }` when its seat has none it can
  play; it may return a promise.
- `PolicyTurn` - What `choose` is handed: the live `game`, the `seat` to move,
  its enabled `actions`, its own seeded `random` generator and the game
  `definition`.
- `PolicyMove`, `PolicyChoice`, `SimulatedGame` - The shapes above.

## Rules a policy plays by

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
// src/rules/metrics.ts
import { defineMetrics } from 'boardsmith';
import type { MyGame } from './game.js';

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

// in an action's execute, a pick's onSelect or onEach, or a flow step:
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
  leaves none. Records made while the flow starts and in flow steps are kept.
- **Record only in code that changes the game**: an action's `execute`, a
  pick's `onSelect` or `onEach`, or a flow step. In a simulation, a record made
  anywhere else (a `choices` or `filter` callback, a condition, a policy), of a
  metric `gameDefinition.metrics` does not declare, or with a number that is
  not finite or a category not declared, ends the game as crashed with an error
  naming the metric, even if game code caught the throw. A game whose
  definition declares no metrics records nothing, as in real play.

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
`share` with its 95% Wilson interval (`low`, `high`). A value with nothing to
divide by is `-` in the tables, `null` in JSON and empty in CSV. Games are
combined in game order, so the same seed gives the same report.

- **Tables** (the default) - one table per section and metric.
- **`--json`** - `{ run, games, report }`: `games` lists only the games that
  did not finish, and `report` is an array with one entry per player count
  holding `players`, `games`, `winShare`, `tieRate`, `length`, `segments`,
  `scores`, `counts`, `samples`, `categories`, `ratios` and `elements`, or
  `null` when any game did not finish.
- **`--csv`** - one statistic per row:
  `variant,players,section,metric,key,stat,value`. `variant` is empty (a later
  release compares variants in one run). `section` is `games`, `winShare`,
  `ties`, `length`, `segment`, `score`, `count`, `sample`, `category`, `ratio`
  or `element`; `metric` is empty for the built-in sections; `key` is the seat,
  label, category, count key or element name. In an `element` row, `stat` is
  the column's metric name.

```
,2,winShare,,1,share,0.512
,2,score,score,,mean,41.3
,2,element,,Forge,buildRate,0.27
```
