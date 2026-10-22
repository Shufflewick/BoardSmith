/**
 * A game narrows the moves its bot searches wherever the search lists them,
 * through `candidateMoves` (#1387): the root, every tree node (including the
 * per-world refresh under a sampler) and every playout. The other hooks each
 * reach only part of the search, so a move a game never wants searched kept
 * coming back below the root.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Game, Player, Action, loop, eachPlayer, actionStep, type GameOptions } from '../engine/index.js';
import { MCTSBot } from './mcts-bot.js';
import type { BotMove, BotStrategy } from './types.js';

/** Every move the search copies made, by action and pick. */
let made: string[] = [];

class JunkGame extends Game<JunkGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerAction(
      Action.create('pick')
        .chooseFrom('option', { prompt: 'Pick', choices: ['a', 'b', 'c'] })
        .execute((args) => {
          made.push(`pick:${String(args.option)}`);
        }),
    );
    // Always legal and changes nothing: a move no search should spend time on.
    this.registerAction(
      Action.create('junk').execute(() => {
        made.push('junk');
      }),
    );
    this.setFlow({
      root: loop({ maxIterations: 20, do: eachPlayer({ do: actionStep({ actions: ['pick', 'junk'] }) }) }),
    });
  }
}

const sampler = { determinize: () => {} } satisfies BotStrategy;
const withoutJunk: BotStrategy['candidateMoves'] = (_game, _seat, listMoves) =>
  listMoves().filter((move) => move.action !== 'junk');

async function search(strategy: BotStrategy): Promise<BotMove | null> {
  const game = new JunkGame({ playerCount: 2, playerNames: ['A', 'B'], seed: 'junk' });
  game.startFlow();
  const bot = new MCTSBot(game, JunkGame, 'junk', 1, { iterations: 60, seed: 's', timeout: Infinity }, strategy);
  made = [];
  return bot.play();
}

describe('candidateMoves narrows every listing the search makes (#1387)', () => {
  beforeEach(() => {
    made = [];
  });

  it.each([
    ['without a sampler', {}],
    ['under a sampler', sampler],
  ])('a move the game leaves out is searched without the hook, %s', async (_label, strategy) => {
    await search(strategy);
    expect(made).toContain('junk');
  });

  it.each([
    ['without a sampler', {}],
    ['under a sampler', sampler],
  ])('a move the game leaves out is never made at the root, in the tree or in playouts, %s', async (_label, strategy) => {
    const move = await search({ ...strategy, candidateMoves: withoutJunk });
    expect(made.length).toBeGreaterThan(0);
    expect(made).not.toContain('junk');
    expect(move?.action).toBe('pick');
  });

  it("searches the game's own list, for every seat, without listing the rest", async () => {
    const seats = new Set<number>();
    const ownList: BotStrategy['candidateMoves'] = (_game, seat) => {
      seats.add(seat);
      return [
        { action: 'pick', args: { option: 'a' } },
        { action: 'pick', args: { option: 'b' } },
      ];
    };
    await search({ ...sampler, candidateMoves: ownList });
    expect(new Set(made)).toEqual(new Set(['pick:a', 'pick:b']));
    expect(seats).toEqual(new Set([1, 2]));
  });

  it('refuses an empty list for a seat that has moves, and says how to fix it', async () => {
    await expect(search({ candidateMoves: () => [] })).rejects.toThrow(
      /candidateMoves returned no moves for seat 1, which has 4 moves/,
    );
  });
});
