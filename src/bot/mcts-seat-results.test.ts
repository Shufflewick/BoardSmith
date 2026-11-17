/**
 * The search scores each seat from that seat's own result (#1679): 1 if it
 * won, 0.5 for a declared draw, 0 otherwise. A finish nobody wins is a loss
 * for every seat (#1625), so no seat is assumed to steer toward it, and a seat
 * is assumed to take an ending only when it wins there.
 */
import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Action,
  loop,
  sequence,
  eachPlayer,
  actionStep,
  type GameOptions,
} from '../engine/index.js';
import { MCTSBot } from './mcts-bot.js';
import type { BotConfig, BotStrategy } from './types.js';

const SEEDS = Array.from({ length: 10 }, (_, i) => `seat-result-${i}`);

/**
 * A game where seat 1 opens with `doom` (play goes on, scored low) or `trust`.
 * After `trust`, seat 2 picks one of `replies`, which ends the game with the
 * seats it lists as the winners (none listed: nobody wins).
 */
function replyGame(replies: Record<string, number[]>) {
  return class ReplyGame extends Game<ReplyGame, Player> {
    trusted = false;

    constructor(options: GameOptions) {
      super(options);
      this.registerActions(
        Action.create<ReplyGame>('open')
          .chooseFrom('option', { choices: ['doom', 'trust'] })
          .execute((args) => {
            this.trusted = args.option === 'trust';
            return { success: true };
          }),
        Action.create<ReplyGame>('reply')
          .chooseFrom('option', { choices: Object.keys(replies) })
          .execute((args) => {
            this.finish(replies[String(args.option)].map((seat) => this.getPlayer(seat)!));
            return { success: true };
          }),
        Action.create<ReplyGame>('pass')
          .chooseFrom('option', { choices: ['a', 'b'] })
          .execute(() => ({ success: true })),
      );
      this.setFlow({
        root: sequence(
          actionStep({ actions: ['open'], player: (ctx) => ctx.game.getPlayer(1)! }),
          actionStep({
            actions: ['reply'],
            player: (ctx) => ctx.game.getPlayer(2)!,
            skipIf: (ctx) => !(ctx.game as ReplyGame).trusted,
          }),
          loop({ maxIterations: 100, do: eachPlayer({ do: actionStep({ actions: ['pass'], turnScope: 'restart' }) }) }),
        ),
      });
    }
  };
}

/** Scores every unfinished position at the bottom of the range. */
const lowStrategy: BotStrategy = {
  objectives: () => ({ nothing: { weight: 1, checker: () => 0 } }),
};

/** Seat 1's opening for each seed. */
async function openings(
  replies: Record<string, number[]>,
  playerCount: number,
  config: Partial<BotConfig>,
): Promise<string[]> {
  const GameClass = replyGame(replies);
  const out: string[] = [];
  for (const seed of SEEDS) {
    const game = new GameClass({ playerCount, seed });
    game.startFlow();
    const bot = new MCTSBot(game, GameClass, 'reply', 1, { async: false, timeout: Infinity, seed, ...config }, lowStrategy);
    out.push(String((await bot.play())!.args.option));
  }
  return out;
}

const CONFIGS: Array<[string, Partial<BotConfig>]> = [
  ['with proof search', {}],
  ['without proof search', { usePNS: false }],
];

describe.each(CONFIGS)('each seat is scored by its own result, %s', (_name, config) => {
  it('expects a teammate to take the shared win, not the shared loss', async () => {
    expect(await openings({ together: [1, 2], apart: [] }, 2, config)).toEqual(SEEDS.map(() => 'trust'));
  });

  it('expects an opponent to take a win it shares over a finish nobody wins', async () => {
    expect(await openings({ share: [1, 2], spite: [] }, 2, config)).toEqual(SEEDS.map(() => 'trust'));
  });

  it('does not count a finish nobody wins as a forced loss, so it takes the line it can win', async () => {
    expect(await openings({ spite: [], yield: [1] }, 2, config)).toEqual(SEEDS.map(() => 'trust'));
  });

  it('expects a seat to take a win it shares over a win for a third seat', async () => {
    expect(await openings({ share: [1, 2], third: [3] }, 3, config)).toEqual(SEEDS.map(() => 'trust'));
  });

  it('still expects a two-player opponent to take its own win', async () => {
    expect(await openings({ punish: [2], ignore: [1] }, 2, config)).toEqual(SEEDS.map(() => 'doom'));
  });
});

describe('solving a node from its children', () => {
  it('leaves a node open while a move it has not tried could still win', () => {
    const GameClass = replyGame({ spite: [], yield: [2] });
    const game = new GameClass({ playerCount: 2, seed: 'untried' });
    game.startFlow();
    game.continueFlow('open', { option: 'trust' }, 1);
    const bot: any = new MCTSBot(game, GameClass, 'reply', 2, { async: false, timeout: Infinity, seed: 'untried' });
    bot.rootSnapshot = bot.captureSnapshot();
    bot.searchGame = bot.restoreGame(bot.rootSnapshot);
    bot.resumeSearchGame();
    const root = bot.createNode(
      bot.searchGame.getFlowState(),
      null,
      null,
      [{ action: 'reply', args: { option: 'spite' } }, { action: 'reply', args: { option: 'yield' } }],
      2,
      false,
    );

    const spite = bot.expandIncremental(root, true);
    expect(spite.solvedWinners).toEqual([]);
    bot.backpropagate(spite, () => 0, [], []);

    expect(root.untriedMoves).toHaveLength(1);
    expect(root.solvedWinners).toBeNull();
  });
});

describe('solving a node whose moves are a sample (#1680)', () => {
  // 50 replies, more than the 20 the search lists below the root: seat 2 wins
  // only with `win`, so a sample without it must not prove the node lost for seat 2.
  const replies = Object.fromEntries([
    ...Array.from({ length: 49 }, (_, i) => [`lose${i}`, [1]]),
    ['win', [2]],
  ]);

  it('never solves a sampled node as lost for its mover', async () => {
    const GameClass = replyGame(replies);
    let withoutWin = 0;
    for (const seed of SEEDS) {
      const game = new GameClass({ playerCount: 2, seed });
      game.startFlow();
      const bot: any = new MCTSBot(game, GameClass, 'reply', 1, { async: false, timeout: Infinity, iterations: 400, seed }, lowStrategy);
      const { root } = await bot.runSearch();
      const trust = root.children.find((child: any) => child.parentMove.args.option === 'trust');
      const tried = trust.children.map((child: any) => child.parentMove.args.option);
      if (tried.length === 20 && !tried.includes('win')) withoutWin++;
      expect(trust.solvedWinners === null || trust.solvedWinners.includes(2), `seed ${seed}`).toBe(true);
    }
    // The fixture has teeth: some seeds try every sampled reply and none of them is `win`.
    expect(withoutWin).toBeGreaterThan(0);
  });

  it("marks a node sampled when a later world's listing of its moves is a sample", () => {
    const GameClass = replyGame(replies);
    const game = new GameClass({ playerCount: 2, seed: 'refresh' });
    game.startFlow();
    game.continueFlow('open', { option: 'trust' }, 1);
    const bot: any = new MCTSBot(game, GameClass, 'reply', 2, { async: false, timeout: Infinity, seed: 'refresh' });
    bot.rootSnapshot = bot.captureSnapshot();
    bot.searchGame = bot.restoreGame(bot.rootSnapshot);
    const node = bot.createNode(bot.searchGame.getFlowState(), null, null, [], 2, false);

    bot.refreshNodeForWorld(node);

    expect(node.allMoves).toHaveLength(20);
    expect(node.sampled).toBe(true);
  });

  it('never solves a sampled root as lost for the bot', async () => {
    const GameClass = replyGame(replies);
    for (const seed of SEEDS) {
      const game = new GameClass({ playerCount: 2, seed });
      game.startFlow();
      game.continueFlow('open', { option: 'trust' }, 1);
      const bot: any = new MCTSBot(game, GameClass, 'reply', 2, { async: false, timeout: Infinity, iterations: 100, seed }, lowStrategy);
      const { root } = await bot.runSearch();
      expect(root.children.length).toBe(20);
      expect(root.solvedWinners === null || root.solvedWinners.includes(2), `seed ${seed}`).toBe(true);
    }
  });
});
