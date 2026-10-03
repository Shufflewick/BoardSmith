import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  Game,
  Player,
  Action,
  defineFlow,
  actionStep,
  execute,
  loop,
  eachPlayer,
  sequence,
  setVar,
  NotSimulableError,
  type FlowState,
  type GameOptions,
} from '../engine/index.js';
import { executeOp, type GameDefinitionLike } from '../session/index.js';
import { MCTSBot } from './mcts-bot.js';
import type { DeterminizeSampler } from './types.js';

// ============================================================================
// #421: a search node's seat-to-move is a fact about ONE world.
//
// Under determinization every iteration samples a new world, and the same move
// can hand the turn to a different seat in each: in Go Fish an ask that finds
// cards keeps the asker's turn, and one that does not passes it. The search
// used to remember the flow state of the world a node was created in and keep
// enumerating, and acting for, that seat in every later world. In a world where
// the other seat was to move, the engine refused every such move ("Invalid
// selection for target: 2. Valid choices: [Player 1]"), and because a refused
// `continueFlow` reports the refusal instead of throwing, the search recorded
// each one as an explored move. `boardsmith dev` logs every refusal, so an
// all-bot Go Fish table printed thousands of lines a second.
//
// Hidden Guess is the smallest game with that shape. Each seat holds a hidden
// number. On your turn you name another seat and a number; a hit scores and
// you go again (the target draws a new number), a miss passes the turn.
// ============================================================================

const NUMBERS = [1, 2, 3];
const WINNING_SCORE = 3;

class Guesser extends Player<HiddenGuessGame, Guesser> {
  /** `secret` is withheld from every other seat. */
  static override visibleAttributes = ['score'];
  secret = 1;
  score = 0;
}

class HiddenGuessGame extends Game<HiddenGuessGame, Guesser> {
  static override PlayerClass = Guesser;

  constructor(options: GameOptions) {
    super(options);

    this.registerAction(
      Action.create('ask')
        .chooseFrom('target', {
          choices: (ctx) =>
            this.all(Guesser)
              .filter((p) => p.seat !== ctx.player.seat)
              .map((p) => ({ value: p.seat, display: p.name })),
        })
        .chooseFrom('guess', { choices: () => NUMBERS })
        .execute((args, ctx) => {
          // The engine unwraps a `{ value, display }` choice to its value.
          const target = this.getPlayer(args.target as unknown as number)!;
          const hit = target.secret === args.guess;
          if (hit) {
            (ctx.player as Guesser).score++;
            target.secret = NUMBERS[Math.floor(this.random() * NUMBERS.length)];
          }
          return { success: true, data: { hit } };
        }),
    );

    this.setFlow(defineFlow({
      root: loop({
        while: () => !this.leader(),
        maxIterations: 200,
        do: eachPlayer({
          do: sequence(
            setVar('turnEnded', false),
            loop({
              while: (ctx) => !ctx.get('turnEnded') && !this.leader(),
              maxIterations: 50,
              do: sequence(
                actionStep({ actions: ['ask'], turnScope: 'continue' }),
                execute((ctx) => {
                  if (!ctx.lastActionResult?.data?.hit) ctx.set('turnEnded', true);
                }),
              ),
            }),
          ),
        }),
      }),
      isComplete: () => this.leader() !== undefined,
      getWinners: () => {
        const leader = this.leader();
        return leader ? [leader] : [];
      },
    }));
  }

  leader(): Guesser | undefined {
    return this.all(Guesser).find((p) => p.score >= WINNING_SCORE);
  }
}

/** Every other seat's number is unknown to `seat`; suppose one per world. */
const guessSampler: DeterminizeSampler = (sandbox, seat, rng) => {
  for (const player of (sandbox as HiddenGuessGame).all(Guesser)) {
    if (player.seat === seat || !player.isAttributeRedacted('secret')) continue;
    player.secret = NUMBERS[Math.floor(rng() * NUMBERS.length)];
  }
};

const definition = {
  gameClass: HiddenGuessGame,
  gameType: 'hidden-guess',
  minPlayers: 2,
  maxPlayers: 4,
  bot: { determinize: guessSampler },
} satisfies GameDefinitionLike;

/** Every `continueFlow` the engine refused while the spy was installed. */
function watchRefusals() {
  const refusals: string[] = [];
  const original = Game.prototype.continueFlow;
  vi.spyOn(Game.prototype, 'continueFlow').mockImplementation(function (
    this: Game,
    ...args: Parameters<Game['continueFlow']>
  ): FlowState {
    const state = original.apply(this, args);
    if (state.actionError) refusals.push(state.actionError);
    return state;
  });
  return refusals;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('#421: an all-bot table of a hidden-hand game', () => {
  it('plays to completion with every seat a bot and no move refused, in the search or at the table', async () => {
    const refusals = watchRefusals();
    const playerCount = 3;
    const gameOptions = { playerCount, seed: 'bs421-table' };
    const seats = [1, 2, 3].map((seat) => ({ seat, level: 'easy' }));

    let res = await executeOp(definition, gameOptions, null, null, { type: 'start' });
    expect(res.success).toBe(true);
    let moves = 0;
    while (!res.isComplete) {
      res = await executeOp(definition, gameOptions, res.snapshot, null, { type: 'botTurn', seats });
      expect(res.error).toBeUndefined();
      expect(res.botStalled).toBeUndefined();
      expect(res.botMoved).toBe(true);
      moves++;
      expect(moves).toBeLessThan(300);
    }

    expect(res.winners?.length).toBe(1);
    expect(refusals).toEqual([]);
    // A whole game of searches: allowed to be slow on a loaded machine, never to hang.
  }, 120_000);
});

// ----------------------------------------------------------------------------
// A move the engine refuses is not a move the search made.
//
// Enumeration offers every move whose choices validate; `execute` can still
// refuse one (a rule it checks only when the move is made). The search used to
// read the refusal as a move that changed nothing and grow a child for it,
// then value the unchanged position as if that move had been played. A move
// that changes the game and THEN is refused (here `NotSimulableError`) is
// worse: the position it leaves is one no move reaches, so nothing from that
// iteration may be scored.
// ----------------------------------------------------------------------------

class PickyGame extends Game<PickyGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerAction(
      Action.create('pick')
        .chooseFrom('n', { choices: () => [1, 2, 3, 4] })
        .execute((args) => {
          if (args.n === 1) return { success: false, error: 'One is never allowed.' };
          if (args.n === 4) {
            this.finish([this.getPlayer(1)!]);
            throw new NotSimulableError('Four needs a card this seat cannot see.');
          }
          this.finish(args.n === 3 ? [this.getPlayer(1)!] : [this.getPlayer(2)!]);
          return { success: true };
        }),
    );
    this.setFlow(defineFlow({
      root: actionStep({ actions: ['pick'], player: (ctx) => ctx.game.getPlayer(1)! }),
      isComplete: () => this.isFinished(),
      getWinners: () => ((this.settings.winners ?? []) as number[]).map((seat) => this.getPlayer(seat)!),
    }));
  }
}

describe('#421: a move refused inside the search', () => {
  it('is never recorded as an explored move, whether or not it changed the game first', async () => {
    const game = new PickyGame({ playerCount: 2, playerNames: ['Bot', 'Other'], seed: 'picky' });
    game.startFlow();
    const bot = new MCTSBot(game, PickyGame, 'picky', 1, [], {
      iterations: 60, playoutDepth: 2, seed: 'picky', async: false, timeout: Infinity,
    });

    const { move, stats } = await bot.playWithStats();

    expect(stats.map((s) => s.move.args.n).sort()).toEqual([2, 3]);
    expect(move?.args.n).toBe(3);
  });
});
