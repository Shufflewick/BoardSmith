/**
 * A two-seat game with one obviously best move, used to check that the bot's
 * search chooses by evaluation (#315, #316).
 *
 * Each turn the acting seat picks one of `b1`..`b5` or `good`. `good` adds 10
 * to that seat's score and the others add nothing. The game runs far longer
 * than any search looks ahead, so no node in the tree is ever terminal: the
 * only signal the search has is the objective, which rewards the seat's own
 * score. A bot that searches correctly picks `good`.
 */
import {
  Game,
  Player,
  Action,
  loop,
  eachPlayer,
  actionStep,
  type GameOptions,
} from '../engine/index.js';
import { MCTSBot } from './mcts-bot.js';
import type { BotConfig, BotStrategy } from './types.js';

const SCORE_RACE_CHOICES = ['b1', 'b2', 'b3', 'b4', 'b5', 'good'] as const;

class RacePlayer extends Player<ScoreRaceGame, RacePlayer> {
  score = 0;
}

class ScoreRaceGame extends Game<ScoreRaceGame, RacePlayer> {
  static override PlayerClass = RacePlayer;

  constructor(options: GameOptions) {
    super(options);

    this.registerAction(
      Action.create<ScoreRaceGame>('pick')
        .chooseFrom('option', {
          prompt: 'Pick an option',
          choices: [...SCORE_RACE_CHOICES],
        })
        .execute((args, ctx) => {
          if (args.option === 'good') (ctx.player as RacePlayer).score += 10;
          return { success: true };
        }),
    );

    this.setFlow({
      root: loop({
        maxIterations: 100,
        do: eachPlayer({ do: actionStep({ actions: ['pick'] }) }),
      }),
    });
  }
}

/** Rewards the searching seat's own score, saturating at three `good` picks. */
const scoreStrategy: BotStrategy = {
  objectives: (game, seat) => ({
    score: {
      weight: 1,
      checker: (g) => Math.min(1, (g.getPlayer(seat) as RacePlayer).score / 30),
    },
  }),
};

/** A fresh game waiting on seat 1's first pick. */
export function newScoreRace(): ScoreRaceGame {
  const game = new ScoreRaceGame({ playerCount: 2, seed: 'score-race' });
  game.startFlow();
  return game;
}

/**
 * A bot for seat 1 with the default configuration, except that it runs
 * synchronously and is bounded by iterations alone so a seed reproduces.
 */
export function scoreRaceBot(game: ScoreRaceGame, seed: string, config: Partial<BotConfig> = {}) {
  return new MCTSBot(
    game,
    ScoreRaceGame,
    'score-race',
    1,
    [],
    { async: false, timeout: Infinity, seed, ...config },
    scoreStrategy,
  );
}
