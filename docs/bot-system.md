# Bot System

BoardSmith includes a game-agnostic bot system using Monte-Carlo Tree Search (MCTS). The bot works with any game without game-specific tuning.

## Overview

The `boardsmith/bot` package provides:
- **MCTSBot**: MCTS-based bot player
- **Difficulty presets**: easy, medium, hard
- **Custom objectives**: Guide bot behavior for specific games

## How MCTS Works

Monte-Carlo Tree Search builds a game tree by repeatedly:

1. **SELECT**: Walk down the tree using UCT (Upper Confidence Bound for Trees) to balance exploration vs exploitation
2. **EXPAND**: Try one unexplored action from a leaf node
3. **PLAYOUT**: Random moves until game ends (or depth limit)
4. **BACKPROPAGATE**: Update win counts back up the tree

After many iterations, the bot chooses the most-visited child of the root (robust choice).

## Basic Usage

### Using the CLI

The easiest way to add bot players is via the CLI:

```bash
# Player 1 is a bot (medium difficulty)
boardsmith dev --bot 1

# Players 1 and 3 are bots
boardsmith dev --bot 1 3

# Set difficulty level
boardsmith dev --bot 1 --bot-level hard

# Custom iteration count
boardsmith dev --bot 1 --bot-level 50
```

### Difficulty Levels

| Level | Iterations | Playout Depth | Timeout | Parallel |
|-------|-----------|---------------|---------|----------|
| easy | 100 | 2 | 1000ms | - |
| medium | 300 | 3 | 1500ms | - |
| hard | 500 | 4 | 2000ms | 2 |

Seat numbers are 1-indexed everywhere: `--bot 1` makes the first seat a bot, and `--bot 0` is rejected.

### Programmatic Usage

```typescript
import { createBot, parseBotLevel } from 'boardsmith/bot';
import { MyGame } from './game.js';

// Create a bot for player 1
const bot = createBot(
  game,                    // Game instance
  MyGame,                  // Game class constructor
  'my-game',               // Game type identifier
  1,                       // Player position (1-indexed)
  actionHistory,           // History of actions taken so far
  'hard'                   // Difficulty level or iteration count
);

// Get the bot's move
const move = await bot.play();
console.log(`Bot plays: ${move.action}`, move.args);

// Execute the move
game.continueFlow(move.action, move.args, 1);
```

## Custom Objectives

For games where win/loss isn't sufficient guidance, you can define objectives that give the bot partial credit during playouts.

### Defining Objectives

```typescript
import type { BotStrategy } from 'boardsmith/bot';
import type { Game } from 'boardsmith';

const myGameBotStrategy: BotStrategy = {
  objectives: (game: Game, playerIndex: number) => ({
    // Positive weight = good for the player
    controlCenter: {
      checker: (g, p) => {
        const center = g.board.cells.filter(c => c.isCentral);
        const playerPieces = center.filter(c => c.piece?.player?.seat === p);
        return Math.min(playerPieces.length / 2, 1); // partial credit for one piece
      },
      weight: 0.3,
    },

    // Negative weight = bad for the player
    exposedKing: {
      checker: (g, p) => {
        const king = g.players.get(p)!.king;
        return king.isExposed() ? 1 : 0;
      },
      weight: -0.5,
    },

    // Material advantage
    materialAdvantage: {
      checker: (g, p) => {
        const myPieces = g.pieces.filter(pc => pc.player?.seat === p);
        const oppPieces = g.pieces.filter(pc => pc.player?.seat !== p);
        return myPieces.length > oppPieces.length ? 1 : 0;
      },
      weight: 0.4,
    },
  }),
};

// Use with createBot
const bot = createBot(game, MyGame, 'my-game', 1, [], 'medium', myGameBotStrategy);
```

### Objective Evaluation

Each `checker` returns an achievement level from 0 to 1: 0 means not achieved,
1 means fully achieved, and values between give partial credit. Return `1` or
`0` for a yes/no objective.

When a playout stops before the game ends, the bot scores the position as the
sum of `weight x checker` over all objectives. It then scales that sum to the
range 0.1 to 0.9: the lowest possible sum (every negative-weight objective fully
achieved, every positive one not) maps to 0.1, and the highest possible sum maps
to 0.9. The score is 0.5 when there are no objectives, or when every weight is 0.

A playout that reaches the end of the game scores 1 for a win, 0 for a loss and
0.5 when the game declares no winner.

## Example: Checkers Bot

A simplified version of the Checkers game's `bot.ts`:

```typescript
import type { BotStrategy } from 'boardsmith/bot';
import type { Game } from 'boardsmith';

export const checkersBotStrategy: BotStrategy = {
  objectives: (game: Game, playerIndex: number) => ({
    // Having more pieces is good
    morePieces: {
      checker: (g, p) => {
        const myPieces = countPieces(g, p);
        const oppPieces = countPieces(g, 1 - p);
        return myPieces > oppPieces ? 1 : 0;
      },
      weight: 0.5,
    },

    // Having kings is good
    hasKings: {
      checker: (g, p) => {
        const myKings = countKings(g, p);
        return myKings > 0 ? 1 : 0;
      },
      weight: 0.3,
    },

    // Controlling the center is good
    centerControl: {
      checker: (g, p) => {
        const centerCells = getCenterCells(g);
        const myPiecesInCenter = centerCells.filter(
          c => c.piece?.player?.seat === p
        );
        return myPiecesInCenter.length >= 2 ? 1 : 0;
      },
      weight: 0.2,
    },
  }),
};
```

## Integration with the session host

Every host runs bots the same way: the game definition's `bot` field carries
the game's `BotStrategy`, and the host's roster says which seats a bot plays.
`SnapshotSessionHost` takes the roster with `host.setBotSeats(seats)`, and
`createHeadlessSession` takes it as its third argument:

```typescript
import { createHeadlessSession } from 'boardsmith/session';
import { gameDefinition } from './index.js'; // its `bot` field is myGameBotStrategy

const session = createHeadlessSession(
  gameDefinition,
  { playerCount: 2, playerNames: ['You', 'Computer'] },
  [{ seat: 2, level: 'hard' }], // seat 2 is a bot at 'hard' level
);
await session.start();

// After every move the host runs its bot pump, so seat 2 plays whenever it is
// due. start() does not run the pump; when a bot seat moves first, run it once:
await session.host.runBotTurns();
```

> Each roster entry names a seat (seats are 1-indexed) and an optional `level`.
> The game's custom objectives and threat hooks go in the definition's `bot`
> field, which every op that builds a bot reads.

A bot moves when the game hands it a turn, and a move the game refuses is
reported once on the console, naming the seat and the game's reason. The bot is
not asked again until the game changes, so a refused move never turns into a
retry loop. `boardsmith dev`'s host behaves the same way, and holds back only
the seat whose move was refused: other bot seats keep playing (#421).

## BotConfig Options

```typescript
interface BotConfig {
  /** Number of MCTS iterations (higher = stronger but slower). Default: 300 */
  iterations: number;

  /** Maximum playout depth before evaluating position. Default: 3 */
  playoutDepth: number;

  /** Random seed for reproducible behavior */
  seed?: string;

  /** Run async to yield to event loop (prevents UI freezing). Default: true */
  async?: boolean;

  /** Maximum time in milliseconds before returning best move found. Default: 2000 */
  timeout?: number;

  /** Number of ensemble searches, run one after another and sharing `timeout`. Default: 1 */
  parallel?: number;
}
```

## Performance Considerations

1. **Iteration count**: More iterations = better play, but slower. The default presets are tuned for responsiveness.

2. **Playout depth**: Deeper playouts give more accurate evaluations but take longer. 3-5 is usually sufficient.

3. **Timeout**: The timeout ensures the bot always returns within a reasonable time, even if iterations haven't completed. A parallel bot (`parallel > 1`) runs its searches one after another within that one timeout: each gets an equal share of the time left, so a `hard` move takes at most its 2000 ms, not 2000 ms per search.

4. **Branching factor**: Games with many possible moves per turn will have fewer iterations explored per move. The bot samples up to 20 choices per selection to limit combinatorial explosion.

5. **Game complexity**: Simple games (Hex, Checkers) work well. Complex games (Cribbage with many scoring possibilities) may need custom objectives.

## Measuring bot speed

`scripts/bench-bot/run.mjs` measures how fast the bot searches, and where its
time goes, against the BoardSmith in the checkout it is run from (#630):

```bash
node scripts/bench-bot/run.mjs                   # the catalogue table games, from ~/BoardSmithGames
node scripts/bench-bot/run.mjs chess hex-19      # some of them
node scripts/bench-bot/run.mjs ~/path/to/a-game  # any game project, at its smallest table
node scripts/bench-bot/run.mjs --out docs/bot-speed-baseline.md
```

The catalogue is checkers, chess, cribbage, go-fish (4 players), hex at 11 and
19, and seven (7 players). The games are only read. MERC is not in it: it runs
on its own vendored copy of BoardSmith, so a run here would not measure this
checkout.

For each game it plays one seeded game of random moves, picks an early, a
middle and a late position (a tenth, half and nine tenths of the way in, at a
ply where the seat to move has a choice), and at each one runs:

- **each difficulty preset**, with its timeout, as a game plays it: the search
  steps it finished, the ms it took and the steps per second. Under a timeout
  the step count is the speed measurement, and it moves with the machine's load.
- **a fixed 300-step search** with a seed and no timeout, so its work is the
  same on every run and on every machine, and it must choose the same move each
  time. Its time is split into parts: rebuilding the search game from the root
  snapshot, listing legal moves, applying moves, re-applying moves down the tree
  path, scoring (objectives and end-of-game results) and the determinize hook,
  with the rest as "other". "lookup" is the share spent in element tree walks
  (`ElementCollection._finder`), which happen inside the other parts.

It always measures in production mode, where `isDevMode()` is false, as in a
worker child, whatever `NODE_ENV` the shell has. Development mode makes the bot
up to 1.7 times slower (#628), and the report refuses to print numbers taken in
it. The split is taken by wrapping the bot's methods for the length of the
fixed search only, so the bot has no timers in it otherwise. The wrappers cost
time of their own (about a tenth more in hex 11x11, most of it timing the
lookups), so compare fixed numbers only with fixed numbers.

**For a bot speed ticket:** run the bench on `main` and on your branch, on the
same machine, close together, and put both tables in the ticket. The fixed
search's steps and chosen move must not change unless the ticket means to change
the search; its ms, steps per second and part shares are the gain. Check the
load average the report prints: every timed number moves with the machine's
load. Two back-to-back runs on a shared machine whose load swung between 4 and
20 (the committed baseline's run and the one after it) gave identical fixed
searches, preset step counts within 10% for chess, hex 19x19 and the games that
finish their budget, and up to 21% apart for checkers and hex 11x11, whose fixed
search times also differed by up to 4 times at single positions. So run both
sides more than once when the machine is busy, and trust a gain only when it is
larger than the spread between runs. When a change lands, write a new baseline
with `--out docs/bot-speed-baseline.md` and commit it with the change.

## Limitations

- **No learning**: The bot doesn't learn from past games. Each game starts fresh.
- **Text/number inputs**: The bot can't handle actions that require text or number input (it can only choose from discrete options).
- **Determinism**: The bot has its own random source, separate from the game's. A fixed game seed does not fix it. Pass `createBot`'s `reproducible: { seed }` (or `{ seed, timeout: Infinity }` to `MCTSBot`) for a deterministic search. Without a seed, the bot starts from a fresh random seed every time. A parallel bot (`parallel > 1`, as in `hard`) follows the same rule for each sub-search: seeded, their seeds derive from the bot's seed; unseeded, each gets a fresh random seed.

## Hidden information: enumeration and simulation are not the same thing

A bot searches its OWN seat's information state. `MCTSBot` rebuilds its sandbox
from that seat's redacted view, which is what stops the search from reading
hidden state — and it means the sandbox does not hold what the redaction removed.

Those two halves compose differently:

- **Enumeration** works for the bot's own seat: its view carries its own options,
  so the bot offers exactly its legal moves. For OTHER seats it works only as far
  as public information goes. The search plays every seat the flow is awaiting —
  under a simultaneous step that is the whole table, and one ply into any
  per-turn game — and those seats' withheld attributes have no value in the
  sandbox. An action whose `condition`, `choices`, `disabled` or `validate` reads
  one contributes no move for that seat (a dev warning names the action and the
  attribute); asking `element.isAttributeRedacted(key)` first is how a rule
  answers from what the searcher can actually see. See
  [Attribute Visibility](./core-concepts.md#attribute-visibility).
- **Simulation** often does not. A move's `execute()` frequently resolves against
  state the seat cannot see — a shared map, an opponent's hand — and inside the
  sandbox that state is simply not there.
- **Scoring is not enumeration.** `objectives`, `threatResponseMoves` and
  `uctConstant` are handed the redacted sandbox as well, and an unguarded read
  there is NOT dropped quietly the way a move is: it fails the search, loudly and
  on purpose. An objective that scores a fact the seat was never told is not a
  weaker heuristic, it is a wrong one, and returning a neutral score for it would
  hide that for the whole session. Ask `isAttributeRedacted` and score what the
  seat can see:

```typescript
function nearBooks(hand: Hand): number {
  const counts = new Map<string, number>();
  for (const card of hand.all(Card)) {
    if (card.isAttributeRedacted('rank')) continue;  // an opponent's hand, in the sandbox
    counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1);
  }
  return [...counts.values()].filter((n) => n === 3).length;
}
```

When a move is legal to offer but cannot be resolved, say so:

```typescript
import { NotSimulableError } from 'boardsmith';

Action.create('travel')
  .chooseFrom('direction', { choices: (ctx) => ctx.player.here.exits })
  .execute((args, ctx) => {
    if (ctx.game.mapSeed === undefined) {
      throw new NotSimulableError('travel resolves against the map, which this seat cannot see');
    }
    // ... resolve for real
  });
```

The bot drops that move from its search and moves on. Nothing is logged, and no
hidden value is invented.

The two things to reach for instead are both worse, and the engine will not stop
you doing either:

- **Letting `execute()` throw an ordinary error** logs a stack on every rollout —
  measured at 198 MB in 15 seconds on one game — while the search quietly
  collapses to whatever moves happen not to touch hidden state.
- **Fabricating the missing state** so `execute()` succeeds makes the bot search
  a world that does not exist. It is the same mistake as deriving `choices` from
  state the caller cannot see, one layer later: the answer is no move, not a guess.

A bot that skips its unresolvable moves plays worse than one that could resolve
them. Making it play WELL in a hidden-information game needs determinization,
which is the next section.

## Determinization: searching hidden state instead of skipping it

A skipping bot plays the boring half of its options well and never considers the
rest. Determinization is the other answer: sample a *hypothesis* consistent with
what the seat can actually see, search inside that, and repeat, so the bot
chooses against the distribution of worlds it might be in.

Declare a sampler and the search becomes information-set MCTS:

```typescript
export const botStrategy: BotStrategy = {
  determinize: (sandbox, seat, rng) => {
    for (const rival of sandbox.players) {
      if (rival.seat === seat) continue;
      if (!rival.isAttributeRedacted('carrying')) continue;   // ask first
      // Sample from the worlds this seat's own view still allows.
      const possible = unseenGoods(sandbox, seat);
      rival.carrying = possible[Math.floor(rng() * possible.length)];
    }
  },
};
```

### The one rule

> A sampler may write ONLY attributes the sandbox was never told.

Everything the seat legitimately knows must survive the sample unchanged, and
removing an element the seat can see is the same violation. The engine checks
this on every sample and throws `DeterminizationError`, naming the element and
the attribute, when a sampler breaks it.

That check is the feature, not a guard rail bolted onto it. Fabricating hidden
state is what `NotSimulableError` exists to prevent; determinization is
fabrication done deliberately and with a stated constraint, so a sampler that
quietly rewrites something the seat can see is the original defect back again
with the game's blessing, and it fails as loudly as any other engine invariant.

The sandbox handed to a sampler is the seat's REDACTED clone, never the
authoritative game, so a sampler physically cannot read the truth it is
guessing. Reading a withheld attribute without asking
`element.isAttributeRedacted(key)` first throws, and the throw is reported
against the sampler rather than swallowed.

### What declaring it changes

- **A world per playout, not per move.** The sampler runs once per MCTS
  iteration. Sampling once per move would be a single guess wearing
  determinization's clothes: the tree's statistics would describe that one
  hypothesis rather than the seat's uncertainty.
- **One tree across every sample.** Nodes are keyed by the acting seat's move
  history, not by concrete state, so the tree survives re-sampling. A move's
  value ends up averaged over the worlds it was searched in.
- **Whose turn it is is per world.** The same move can keep the turn in one
  sample and pass it in another (a Go Fish ask that finds the rank, or does
  not). The search reads who is to move from the world it is in, never from
  the world a node was first grown in, and stops descending at a node whose
  seat to move differs, so it never makes or grows a move for a seat that is
  not to move (#421).
- **Legality is per world.** A move one sample makes legal and another does not
  is selected only in the samples that offer it, and its exploration term
  divides by how often it was ON OFFER rather than by parent visits — otherwise
  a move only rare worlds allow is starved forever.
- **The root searches the union.** Root moves accumulate across samples instead
  of being capped to one world's list. A forced `threatResponseMoves` block
  still wins: the game said MUST.
- **Costs nothing when absent.** No sampler means no sampling, no per-world
  refresh, and the classic UCT term unchanged. Games without hidden state pay
  for none of this.

### What a sampler may fill in

Every kind of hidden state the engine marks unknown on restore, which is all
three of them, and `element.isAttributeRedacted(key)` is how a sampler finds
each one:

- **Withheld attributes** on a visible element (`static visibleAttributes`).
- **Hidden ELEMENTS** (`showOnlyTo` / `hideFrom`, or any child of a hidden,
  count-only or owner-only zone). A face-down card is a placeholder holding no
  game attributes at all, so a sampler supposes its rank and suit the same way
  it supposes any other withheld value. What the placeholder genuinely carries
  (its type, its face-down artwork, which hand it sits in) is information the
  seat holds, and the contract still refuses a sampler that rewrites it.
- **Game ROOT fields** withheld by `static visibleAttributes` on the `Game`
  subclass, for the shared secret that belongs to no element: a map seed, a
  hidden objective deck order.

```typescript
determinize: (sandbox, seat, rng) => {
  const game = sandbox as MyGame;
  const unseen = /* every card this seat has not seen, from public counts */;
  for (const player of game.players) {
    if (player.seat === seat) continue;
    for (const card of game.handOf(player).all(Card)) {
      if (!card.isAttributeRedacted('rank')) continue;  // the seat saw this one
      const drawn = unseen.splice(Math.floor(rng() * unseen.length), 1)[0];
      card.rank = drawn.rank;
      card.suit = drawn.suit;
    }
  }
}
```

Go Fish ships one: `goFishDeterminize` in `~/BoardSmithGames/go-fish/src/rules/bot.ts`,
with `tests/determinize.test.ts` beside it. Two things it learned the hard way are
worth knowing before you write your own.

**A concealed container may not arrive at all.** `contentsHidden()` hides a zone's
SIZE as well as its contents, so the pond does not reach the sandbox as a stack of
unknown cards -- it reaches it EMPTY. A search over that world believes the draw
pile is exhausted and never plays the branch that decides most of the game. Go
Fish's sampler puts the pond back, which is a supposition rather than an invention
only because the size is derivable: 52 cards, each in a hand, a book, or the pond.
Check what your hidden zones actually restore as before assuming the placeholders
are there to fill in.

**Fail loudly when no legal world exists.** The sampler throws, by name, on a
half-revealed card and on a deck that does not add up. Both are states where the
only alternative is to guess, and a guessed world is scored as if it were real.

### Testing your sampler

`applyDeterminization` is exported from `boardsmith/bot` so a game can run its own
sampler through the same consistency check the search runs, without standing up an
`MCTSBot`:

```typescript
import { applyDeterminization } from 'boardsmith/bot';

// Refused by name if the sampler writes anything this seat can see.
applyDeterminization(sandboxForSeat(1), 1, myDeterminize, () => 0.5);
```

Build the sandbox the way the bot does -- `new MyGame(options)` followed by
`loadSerializedState(truth.toJSONForPlayer(seat))` -- so the test sees exactly the
redaction the search sees.

### What the check costs

The consistency check walks the element tree twice per sample (once before the
sampler runs, once after) and the sampler runs once per MCTS iteration, so the
cost is linear in tree size and in `iterations`. Measured on this machine, with a
no-op sampler, per sample:

| Elements | Per sample | 300 iterations |
| --- | --- | --- |
| 100 | 0.23 ms | 0.07 s |
| 1,000 | 1.36 ms | 0.41 s |
| 5,000 | 8.66 ms | 2.6 s |
| 20,000 | 35.2 ms | 10.5 s |

About 1.8 microseconds per element per sample. At card-game scale (Go Fish's tree
is ~75 elements) it disappears into the search. Past roughly 2,000 elements it
becomes the dominant cost of the search rather than a tax on it -- at 5,000 the
checking alone exceeds the default 2-second timeout, so the search runs far fewer
iterations than `iterations` asks for. A game with a large tree and a determinize
hook should measure its real iteration count rather than assume it got the budget
it configured.

## API Reference

### createBot()

```typescript
function createBot<G extends Game>(
  game: G,
  GameClass: new (options: GameOptions) => G,
  gameType: string,
  playerIndex: number,
  actionHistory?: SerializedAction[],
  difficulty?: DifficultyLevel | number,
  botStrategy?: BotStrategy,
  reproducible?: { seed: string }
): MCTSBot<G>
```

Pass `reproducible: { seed }` when the same position must always give the same
move (tests, tactical fixtures, benchmarks). It seeds the bot's own random
source and turns off the wall-clock `timeout`, so the search runs exactly the
difficulty's `iterations`.

### MCTSBot.play()

```typescript
async play(): Promise<BotMove>
```

Returns the best move found after running MCTS iterations.

### parseBotLevel()

```typescript
function parseBotLevel(level: string): DifficultyLevel | number
```

Parse a bot level string (e.g., from CLI arguments).

## Related Documentation

- [Core Concepts](./core-concepts.md) - Understanding game state
- [Actions & Flow](./actions-and-flow.md) - How actions work
- [Game Examples](./game-examples.md) - Games with bot implementations
