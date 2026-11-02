/**
 * A RAVE entry describes one seat's move, from that seat's point of view
 * (#1554). Two seats that can make the same move keep separate entries, and
 * selection reads an entry from the side of the seat choosing, as it reads the
 * child's own mean.
 */
import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Action,
  loop,
  sequence,
  actionStep,
  type GameOptions,
} from '../engine/index.js';
import { MCTSBot } from './mcts-bot.js';
import type { BotConfig, BotMove, BotStrategy } from './types.js';

const SEEDS = Array.from({ length: 10 }, (_, i) => `rave-seat-${i}`);

/** Seat 1 works (scored up) or ends its turn; seat 2 can only end its turn, with the same args. */
class EndTurnGame extends Game<EndTurnGame, Player> {
  worked = 0;

  constructor(options: GameOptions) {
    super(options);
    this.registerActions(
      Action.create<EndTurnGame>('work').execute(() => {
        this.worked++;
        return { success: true };
      }),
      Action.create<EndTurnGame>('endTurn')
        .chooseFrom('confirm', { choices: ['Yes, end turn'] })
        .execute(() => ({ success: true })),
    );
    this.setFlow({
      root: loop({
        maxIterations: 100,
        do: sequence(
          actionStep({ actions: ['work', 'endTurn'], player: (ctx) => ctx.game.getPlayer(1)! }),
          actionStep({ actions: ['endTurn'], player: (ctx) => ctx.game.getPlayer(2)! }),
        ),
      }),
    });
  }
}

/** Every work seat 1 has done scores it up, from low in the range. */
const workStrategy: BotStrategy = {
  objectives: () => ({ work: { weight: 1, checker: (game) => Math.min((game as EndTurnGame).worked / 10, 1) } }),
};

/** Seat 1 plays `safe` (a draw) or `risky`; seat 2 answers `risky` with `punish` (seat 2 wins) or `ignore` (seat 1 wins). */
class PunishGame extends Game<PunishGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerActions(
      Action.create<PunishGame>('pick')
        .chooseFrom('option', { choices: ['safe', 'risky'] })
        .execute((args) => {
          if (args.option === 'safe') this.finish();
          return { success: true };
        }),
      Action.create<PunishGame>('reply')
        .chooseFrom('option', { choices: ['punish', 'ignore'] })
        .execute((args) => {
          this.finish([this.getPlayer(args.option === 'punish' ? 2 : 1)!]);
          return { success: true };
        }),
    );
    this.setFlow({
      root: sequence(
        actionStep({ actions: ['pick'], player: (ctx) => ctx.game.getPlayer(1)! }),
        actionStep({ actions: ['reply'], player: (ctx) => ctx.game.getPlayer(2)! }),
      ),
    });
  }
}

/** The move seat 1's bot makes from the start, for each seed. */
async function picks<G extends Game>(
  GameClass: new (options: GameOptions) => G,
  config: Partial<BotConfig>,
  strategy?: BotStrategy,
): Promise<BotMove[]> {
  const out: BotMove[] = [];
  for (const seed of SEEDS) {
    const game = new GameClass({ playerCount: 2, seed });
    game.startFlow();
    out.push((await new MCTSBot(game, GameClass, GameClass.name, 1, { async: false, timeout: Infinity, seed, ...config }, strategy).play())!);
  }
  return out;
}

describe('RAVE keeps each seat to its own moves', () => {
  it('does not end its turn on the opponent\'s results for ending theirs', async () => {
    const moves = await picks(EndTurnGame, { iterations: 100, playoutDepth: 4, usePNS: false }, workStrategy);
    expect(moves.map((move) => move.action)).toEqual(SEEDS.map(() => 'work'));
  });

  it('reads an opponent\'s entry from the opponent\'s side, so it expects to be punished', async () => {
    const moves = await picks(PunishGame, { iterations: 100, usePNS: false });
    expect(moves.map((move) => move.args.option)).toEqual(SEEDS.map(() => 'safe'));
  });
});
