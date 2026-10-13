# boardsmith/sim

> Policies for the balance simulator: what plays each seat in `boardsmith simulate`.

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
