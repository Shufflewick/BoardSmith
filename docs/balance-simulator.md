# Balance simulator: a worked example

This page builds **Bazaar**, a tiny card-drafting game for 2 to 6 players, as a
balance simulator first and a playable game last. Each stage ends with one
`boardsmith simulate` command and a report you read to make the next design
decision. The same rules code is used all the way through: nothing is thrown
away when the UI arrives.

The game: three rounds. Each round every player is dealt a hand; everyone keeps
one card and passes the rest to the next player, until the hands are empty. A
card scores its points, and each set of one red, one gold and one green card
scores 5 more.

The reference for everything used here is [boardsmith/sim](./api/sim.md).

## 1. A simulator with no abilities

Start a project with no UI:

```bash
npx boardsmith init bazaar --sim
cd bazaar
npm install
```

The scaffold's sample game is replaced below. Delete its test, which tests the
sample:

<!-- doc-test: run -->
```bash
rm tests/game.test.ts
```

### Card data

The cards live in a spreadsheet, exported as CSV. The Merchant and the Caravan
have abilities, which the rules ignore for now: a balance model can skip
abilities at first and add them one at a time later (stage 3).

<!-- doc-test: file src/rules/data/cards.csv -->
```csv
name,color,points,copies,ability
Saffron,red,3,12,
Pepper,red,1,20,
Vanilla,gold,4,8,
Cinnamon,gold,2,16,
Mint,green,1,20,
Sage,green,2,16,
Merchant,none,0,10,merchant
Caravan,none,1,10,caravan
```

### Elements, scoring and the game

<!-- doc-test: file src/rules/elements.ts -->
```typescript
import { Card as BaseCard, Deck as BaseDeck, Hand as BaseHand, Space } from 'boardsmith';

export class Card extends BaseCard {
  color!: string;
  points!: number;
  ability!: string;
}

export class Deck extends BaseDeck {}
export class Hand extends BaseHand {}
/** The cards a player has drafted. */
export class Tableau extends Space {}
```

Scoring is a plain function of a list of cards, so the greedy policy below can
ask "what would I score with this card?" without touching the game.

<!-- doc-test: file src/rules/scoring.ts -->
```typescript
import { Card } from './elements.js';
import type { BazaarPlayer } from './game.js';

/** Card points, plus 5 for each set of one red, one gold and one green card. */
export function scoreCards(cards: Card[]): number {
  const count = (color: string) => cards.filter((card) => card.color === color).length;
  const points = cards.reduce((sum, card) => sum + card.points, 0);
  return points + 5 * Math.min(count('red'), count('gold'), count('green'));
}

export const scoreOf = (player: BazaarPlayer) => scoreCards([...player.tableau.all(Card)]);
```

The deck is built from the CSV with `parseCsv`; `?raw` bundles the file's text
with the rules. `handSize` is a game option, so a run can vary it.

<!-- doc-test: file src/rules/game.ts -->
```typescript
import { Game, Player, parseCsv, type GameOptions } from 'boardsmith';
import { Card, Deck, Hand, Tableau } from './elements.js';
import { createPickAction } from './actions.js';
import { createGameFlow } from './flow.js';
import { scoreOf } from './scoring.js';
import cardsCsv from './data/cards.csv?raw';

const cards = parseCsv(
  cardsCsv,
  { name: 'string', color: 'string', points: 'number', copies: 'number', ability: 'string' },
  { source: 'src/rules/data/cards.csv' },
);

export interface BazaarOptions extends GameOptions {
  handSize?: number;
}

export class BazaarPlayer extends Player<BazaarGame, BazaarPlayer> {
  hand!: Hand;
  tableau!: Tableau;
  /** Shown beside the player's name; the pick action keeps it up to date. */
  score = 0;
}

export class BazaarGame extends Game<BazaarGame, BazaarPlayer> {
  static PlayerClass = BazaarPlayer;
  deck!: Deck;
  handSize: number;

  constructor(options: BazaarOptions) {
    super(options);
    this.handSize = options.handSize ?? 5;
    this.registerElements([Card, Deck, Hand, Tableau]);
    this.deck = this.create(Deck, 'deck');
    for (const { name, copies, ...card } of cards) {
      for (let i = 0; i < copies; i++) this.deck.create(Card, name, card);
    }
    this.deck.shuffle();
    for (const player of this.players) {
      player.hand = this.create(Hand, `hand-${player.seat}`, { player });
      player.hand.contentsVisibleToOwner();
      player.tableau = this.create(Tableau, `tableau-${player.seat}`, { player });
    }
    this.registerAction(createPickAction());
    this.setFlow(createGameFlow());
  }

  /** Deals every player a new hand. */
  deal(): void {
    for (const player of this.players) {
      for (const card of this.deck.firstN(this.handSize, Card)) card.putInto(player.hand);
    }
  }

  /** Passes every hand to the next player. */
  passHands(): void {
    const hands = [...this.players].map((player) => [...player.hand.all(Card)]);
    hands.forEach((hand, at) => {
      const next = this.players[(at + 1) % hands.length];
      for (const card of hand) card.putInto(next.hand);
    });
  }

  /** The players with the highest score. */
  leaders(): BazaarPlayer[] {
    const best = Math.max(...[...this.players].map(scoreOf));
    return [...this.players].filter((player) => scoreOf(player) === best);
  }
}
```

### The draft: one action and the flow

The action records two metrics as it runs: every card a player was offered,
and the card they kept. It also updates the player's `score`, which the
player panel shows once the game has a UI.

<!-- doc-test: file src/rules/actions.ts -->
```typescript
import { Action, type ActionDefinition } from 'boardsmith';
import { Card } from './elements.js';
import type { BazaarGame } from './game.js';
import { metrics } from './metrics.js';
import { scoreOf } from './scoring.js';

export function createPickAction(): ActionDefinition {
  return Action.create<BazaarGame>('pick')
    .prompt('Keep a card from your hand')
    .chooseFrom('card', { choices: (ctx) => [...ctx.player.hand.all(Card)] })
    .execute(({ card }, ctx) => {
      for (const offered of ctx.player.hand.all(Card)) metrics.offered.add(ctx.game, offered);
      metrics.picked.add(ctx.game, card);
      card.putInto(ctx.player.tableau);
      ctx.player.score = scoreOf(ctx.player);
    });
}
```

<!-- doc-test: file src/rules/flow.ts -->
```typescript
import { actionStep, eachPlayer, execute, loop, repeat, sequence, type FlowDefinition } from 'boardsmith';
import { Card } from './elements.js';
import type { BazaarGame } from './game.js';

// Three rounds. Each round deals a hand to everyone; players keep one card
// and pass the rest on until the hands are empty.
export function createGameFlow(): FlowDefinition<BazaarGame> {
  return {
    root: sequence(
      repeat(3, sequence(
        execute((ctx) => ctx.game.deal()),
        loop({
          maxIterations: 20,
          while: (ctx) => ctx.game.players[0].hand.count(Card) > 0,
          do: sequence(
            eachPlayer({ do: actionStep({ actions: ['pick'] }) }),
            execute((ctx) => ctx.game.passHands()),
          ),
        }),
      )),
      execute((ctx) => ctx.game.finish(ctx.game.leaders())),
    ),
  };
}
```

### Metrics

What the report measures is declared once. `pickRate` is a ratio of the two
counts, so nothing records it: the report divides them.

<!-- doc-test: file src/rules/metrics.ts -->
```typescript
import { defineMetrics } from 'boardsmith';
import type { BazaarGame } from './game.js';
import { scoreOf } from './scoring.js';

export const metrics = defineMetrics(({ count, ratio, finalScore }) => ({
  offered: count({ by: 'element' }),
  picked: count({ by: 'element' }),
  pickRate: ratio('picked', 'offered'),
  score: finalScore((_game: BazaarGame, player) => scoreOf(player)),
}));
```

<!-- doc-test: file src/rules/index.ts -->
```typescript
import { BazaarGame } from './game.js';
import { metrics } from './metrics.js';

export const gameDefinition = {
  gameClass: BazaarGame,
  gameType: 'bazaar',
  displayName: 'Bazaar',
  minPlayers: 2,
  maxPlayers: 6,
  gameOptions: { handSize: { type: 'number', label: 'Hand size', min: 3, max: 5 } },
  metrics,
} as const;
```

### A greedy policy

A policy decides a seat's moves. This one keeps the card that leaves its
tableau scoring the most. It reuses the game's own scoring, so it will value
the Merchant correctly once stage 3 changes the scoring.

<!-- doc-test: file src/sim/index.ts -->
```typescript
import { greedy } from 'boardsmith/sim';
import { Card } from '../rules/elements.js';
import type { BazaarGame } from '../rules/game.js';
import { scoreCards } from '../rules/scoring.js';

export const policies = {
  // Keep the card that leaves my tableau scoring the most.
  greedy: greedy<BazaarGame>((game, move, seat) => {
    const kept = [...game.getPlayer(seat)!.tableau.all(Card)];
    return scoreCards([...kept, move.args.card as Card]);
  }),
};
```

The scaffold's `tests/sim.test.ts` still works unchanged: it plays seeded games
with `policies.greedy`, so `boardsmith test` checks the game can finish.

### Run it

<!-- doc-test: run -->
```bash
boardsmith simulate --games 3000 --players 2,4,6 --policy greedy
```

Each player count gets its own report: win share by seat, ties, game length,
the `score` distribution and a row per card. An excerpt for 4 players (your
numbers will differ a little; add `--seed <text>` to repeat a run exactly):

```
4 players: 3000 games
Ties
  share  low    high
  11.6%  10.5%  12.8%

Score: score
  n      mean    low     high    sd     p10  p50  p90  min  max  spread
  12000  39.032  38.944  39.119  4.888  33   39   45   20   53   9.222

Per element
  element   offered  picked  pickRate
  Caravan   20.768   5.308   0.256
  Cinnamon  19.774   8.591   0.434
  Merchant  25.914   5.351   0.207
  Mint      39.345   10.694  0.272
  Pepper    37.726   10.734  0.285
  Saffron   10.693   6.462   0.604
  Sage      20.298   8.571   0.422
  Vanilla   5.483    4.289   0.782
```

Reading it: per element, `offered` and `picked` are totals per game, and
`pickRate` is how often a card is kept when it is in a hand. Vanilla is kept
most of the time it is seen, which says it is underpriced. The Merchant is
rarely kept, which is expected: it does nothing yet. Add `--json` or `--csv`
to feed the numbers to a spreadsheet.

Run `simulate` with the `boardsmith` your game installs (`npx boardsmith` in
the game's directory). It builds its own game loop into your rules' bundle, so
a `boardsmith` from anywhere else (a global install, another checkout) would
put two copies of the engine in one bundle; it refuses that run and names both
installs.

## 2. Compare variants on the same seeds

Try Vanilla at 3 points instead of 4. Put a copy of the card data with that one
change beside the project:

<!-- doc-test: file data/vanilla-3.csv -->
```csv
name,color,points,copies,ability
Saffron,red,3,12,
Pepper,red,1,20,
Vanilla,gold,3,8,
Cinnamon,gold,2,16,
Mint,green,1,20,
Sage,green,2,16,
Merchant,none,0,10,merchant
Caravan,none,1,10,caravan
```

`--compare <file>=<file>,<file>` plays every game once with each file in the
original's place, and prints them side by side, each difference from the
first variant in brackets. Comparing a game option works the same way:

<!-- doc-test: run -->
```bash
boardsmith simulate --games 3000 --players 4 --policy greedy --compare src/rules/data/cards.csv=src/rules/data/cards.csv,data/vanilla-3.csv
boardsmith simulate --games 3000 --players 2,4,6 --policy greedy --compare handSize=5,4
```

`--compare policy=random,greedy` compares policies the same way; repeat
`--compare` to play every combination.

`handSize` is a variant players choose in the lobby. A knob only you should
turn, such as a scale on every loot amount, is declared with
`designerOnly: true` and a `default`: no lobby, preset or platform offers it,
but `--game-option` and `--compare` set it, and so does the dev host's lobby.
The game reads it with the same default, from one constant. See
"Designer-only options" in [core-concepts.md](core-concepts.md).

## 3. Add card abilities, one at a time

**The Merchant** scores 2 for each color you have. That is a change to scoring
only:

<!-- doc-test: file src/rules/scoring.ts -->
```typescript
import { Card } from './elements.js';
import type { BazaarPlayer } from './game.js';

/**
 * Card points, plus 5 for each set of one red, one gold and one green card.
 * Each Merchant scores 2 more for every color you have.
 */
export function scoreCards(cards: Card[]): number {
  const count = (color: string) => cards.filter((card) => card.color === color).length;
  const points = cards.reduce((sum, card) => sum + card.points, 0);
  const colors = ['red', 'gold', 'green'].filter((color) => count(color) > 0).length;
  const merchants = cards.filter((card) => card.ability === 'merchant').length;
  return points + 5 * Math.min(count('red'), count('gold'), count('green')) + 2 * colors * merchants;
}

export const scoreOf = (player: BazaarPlayer) => scoreCards([...player.tableau.all(Card)]);
```

<!-- doc-test: run -->
```bash
boardsmith simulate --games 3000 --players 2,4,6 --policy greedy
```

The Merchant's `pickRate` rises from about 0.21 to about 0.48, since the greedy
policy scores with the same function.

**The Caravan** brings the top card of the deck with it when you keep it. That
is a change to the action, plus a metric for what it brought:

<!-- doc-test: file src/rules/actions.ts -->
```typescript
import { Action, type ActionDefinition } from 'boardsmith';
import { Card } from './elements.js';
import type { BazaarGame } from './game.js';
import { metrics } from './metrics.js';
import { scoreOf } from './scoring.js';

export function createPickAction(): ActionDefinition {
  return Action.create<BazaarGame>('pick')
    .prompt('Keep a card from your hand')
    .chooseFrom('card', { choices: (ctx) => [...ctx.player.hand.all(Card)] })
    .execute(({ card }, ctx) => {
      for (const offered of ctx.player.hand.all(Card)) metrics.offered.add(ctx.game, offered);
      metrics.picked.add(ctx.game, card);
      card.putInto(ctx.player.tableau);
      // A Caravan brings the top card of the deck with it.
      const extra = card.ability === 'caravan' ? ctx.game.deck.first(Card) : undefined;
      if (extra) {
        extra.putInto(ctx.player.tableau);
        metrics.caravanBrought.add(ctx.game, extra);
      }
      ctx.player.score = scoreOf(ctx.player);
    });
}
```

<!-- doc-test: file src/rules/metrics.ts -->
```typescript
import { defineMetrics } from 'boardsmith';
import type { BazaarGame } from './game.js';
import { scoreOf } from './scoring.js';

export const metrics = defineMetrics(({ count, ratio, finalScore }) => ({
  offered: count({ by: 'element' }),
  picked: count({ by: 'element' }),
  pickRate: ratio('picked', 'offered'),
  caravanBrought: count({ by: 'element' }),
  score: finalScore((_game: BazaarGame, player) => scoreOf(player)),
}));
```

<!-- doc-test: run -->
```bash
boardsmith simulate --games 3000 --players 2,4,6 --policy greedy
```

The per-element table gains a `caravanBrought` column. The greedy policy does
not know the Caravan's ability (scoring sees it as a 1-point card), so its
`pickRate` barely moves: a policy only plays as well as you teach it to.

## 4. Make it playable

<!-- doc-test: run -->
```bash
boardsmith add-ui
```

That writes the UI files the table scaffold has (`index.html`, `src/ui/` and
friends), with the smoke test listing the `pick` action. The rules are not
touched. Run `boardsmith dev` to play Bazaar in the browser against other seats
or bots, and `boardsmith simulate` keeps working exactly as before.

## Known limits

- **A policy sees the real game and must only read it.** It is handed the live
  game, not a copy: it can see every hidden card (the greedy policy above only
  reads its own tableau). A policy that moves, creates or removes an element,
  or draws from the game's random generator, stops that game with an error
  naming the policy. A write to a plain attribute or to `game.settings` is
  not detected: the game plays on from the changed state and the results are
  silently wrong.
  See [the rules a policy plays by](./api/sim.md#rules-a-policy-plays-by).
- **The same seeds are not the same deals once a variant draws differently.**
  Every variant plays game `i` from the same seed, but a variant that shuffles
  a different deck, or draws one more card (as the Caravan does), moves every
  later draw. Compare variants over many games, not game by game.
- **Greedy picks a number only from a bounded whole-number range** (#689). A
  number input is listed when it has `min`, `max` and `integer: true` and at
  most 10,000 values. Any other number input cannot be listed, so greedy
  reports that seat as stuck and names the input. Use `random` or a policy of
  your own for such a game.
- **Greedy refuses an action with too many moves to list** (#691). An action's
  moves are the product of its selections, and enumeration tries at most
  10,000 values for one action: each value of each selection, under every pick
  before it, refused ones too, each combination of a `multiSelect` and each
  pick of a repeating selection included (#692). Greedy reports a seat offered
  a larger action as stuck and names the action; `random` and `mcts` still play
  it.

## How fast it is

`boardsmith simulate` plays games on every core, in production mode. The final
Bazaar above, 3,000 games at each of 2, 4 and 6 players, is timed by
`node scripts/bench-sim/run.mjs`; [the speed baseline](./sim-speed-baseline.md)
has the latest measurement.

The code blocks on this page are run, in order, by
`docs/balance-simulator.test.ts`; keep the `<!-- doc-test: ... -->` comment
in front of each one.
