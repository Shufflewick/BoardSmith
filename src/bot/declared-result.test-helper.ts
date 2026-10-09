/**
 * A two-seat game that declares its end and its winner ONLY by overriding
 * `Game.isFinished()` and `Game.getWinners()` (#503). It never calls
 * `finish()`, so nothing but those overrides says who won.
 *
 * Seat 1 moves once, picking `win` or one of `b1`..`b3`. `win` makes seat 1
 * the winner; any other pick makes seat 2 the winner. Either way the game is
 * over after that one move.
 */
import {
  Game,
  Player,
  Action,
  eachPlayer,
  actionStep,
  type GameOptions,
} from '../engine/index.js';
import { MCTSBot } from './mcts-bot.js';
import type { BotConfig } from './types.js';

const PICKS = ['b1', 'b2', 'b3', 'win'] as const;

export class DeclaredResultGame extends Game<DeclaredResultGame, Player> {
  pick: string | null = null;

  constructor(options: GameOptions) {
    super(options);

    this.registerAction(
      Action.create<DeclaredResultGame>('pick')
        .chooseFrom('option', { prompt: 'Pick an option', choices: [...PICKS] })
        .execute((args, ctx) => {
          (ctx.game as DeclaredResultGame).pick = String(args.option);
          return { success: true };
        }),
    );

    this.setFlow({
      root: eachPlayer({ do: actionStep({ actions: ['pick'] }) }),
    });
  }

  override isFinished(): boolean {
    return this.pick !== null;
  }

  override getWinners(): Player[] {
    if (this.pick === null) return [];
    return [this.getPlayer(this.pick === 'win' ? 1 : 2)!];
  }
}

/** A fresh game waiting on seat 1's only move. */
export function newDeclaredResultGame(): DeclaredResultGame {
  const game = new DeclaredResultGame({ playerCount: 2, seed: 'declared-result' });
  game.startFlow();
  return game;
}

/** A bot for seat 1, synchronous and bounded by iterations alone so a seed reproduces. */
export function declaredResultBot(game: DeclaredResultGame, seed: string, config: Partial<BotConfig> = {}) {
  return new MCTSBot(
    game,
    DeclaredResultGame,
    'declared-result',
    1,
    [],
    { async: false, timeout: Infinity, seed, ...config },
  );
}
