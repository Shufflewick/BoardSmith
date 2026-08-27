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
        return playerPieces.length >= 2;
      },
      weight: 0.3,
    },

    // Negative weight = bad for the player
    exposedKing: {
      checker: (g, p) => {
        const king = g.players.get(p)!.king;
        return king.isExposed();
      },
      weight: -0.5,
    },

    // Material advantage
    materialAdvantage: {
      checker: (g, p) => {
        const myPieces = g.pieces.filter(pc => pc.player?.seat === p);
        const oppPieces = g.pieces.filter(pc => pc.player?.seat !== p);
        return myPieces.length > oppPieces.length;
      },
      weight: 0.4,
    },
  }),
};

// Use with createBot
const bot = createBot(game, MyGame, 'my-game', 1, [], 'medium', myGameBotStrategy);
```

### Objective Evaluation

During playouts that don't reach a terminal state:
- If total objective score > 0: returns 0.6 (slightly favorable)
- If total objective score < 0: returns 0.4 (slightly unfavorable)
- If total objective score = 0: returns 0.5 (neutral)

Terminal states always use actual win/loss (1.0/0.0).

## Example: Checkers Bot

From Checkers bot.ts:

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
        return myPieces > oppPieces;
      },
      weight: 0.5,
    },

    // Having kings is good
    hasKings: {
      checker: (g, p) => {
        const myKings = countKings(g, p);
        return myKings > 0;
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
        return myPiecesInCenter.length >= 2;
      },
      weight: 0.2,
    },
  }),
};
```

## Integration with GameSession

The `boardsmith/session` package integrates bot automatically:

```typescript
import { GameSession } from 'boardsmith/session';
import { MyGame } from './game.js';
import { myGameBotStrategy } from './bot.js';

const session = GameSession.create({
  GameClass: MyGame,
  gameType: 'my-game',
  playerCount: 2,
  playerNames: ['You', 'Computer'],
  botSeats: { players: [1], level: 'hard' },  // Player 1 is a bot at 'hard' level
  botStrategy: myGameBotStrategy,             // Optional custom objectives
});

// bot will automatically play when it's player 1's turn
```

> `botSeats` declares which seats are bots (`players`) and the difficulty (`level`).
> The game's custom objectives/threat hooks go in `botStrategy`.

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

  /** Number of parallel ensemble searches. Default: 1 */
  parallel?: number;
}
```

## Performance Considerations

1. **Iteration count**: More iterations = better play, but slower. The default presets are tuned for responsiveness.

2. **Playout depth**: Deeper playouts give more accurate evaluations but take longer. 3-5 is usually sufficient.

3. **Timeout**: The timeout ensures the bot always returns within a reasonable time, even if iterations haven't completed.

4. **Branching factor**: Games with many possible moves per turn will have fewer iterations explored per move. The bot samples up to 20 choices per selection to limit combinatorial explosion.

5. **Game complexity**: Simple games (Hex, Checkers) work well. Complex games (Cribbage with many scoring possibilities) may need custom objectives.

## Limitations

- **No learning**: The bot doesn't learn from past games. Each game starts fresh.
- **Text/number inputs**: The bot can't handle actions that require text or number input (it can only choose from discrete options).
- **Determinism**: With a seed, the bot is deterministic. Without a seed, it uses `Math.random()`.

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
- **Legality is per world.** A move one sample makes legal and another does not
  is selected only in the samples that offer it, and its exploration term
  divides by how often it was ON OFFER rather than by parent visits — otherwise
  a move only rare worlds allow is starved forever.
- **The root searches the union.** Root moves accumulate across samples instead
  of being capped to one world's list. A forced `threatResponseMoves` block
  still wins: the game said MUST.
- **The transposition table is off.** It keys on flow position alone, so under a
  sampler the same key covers many different worlds. Caching there would freeze
  the first world's verdict and destroy the averaging.
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
  botStrategy?: BotStrategy
): MCTSBot<G>
```

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
