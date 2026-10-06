import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Action,
  defineFlow,
  simultaneousActionStep,
  type GameOptions,
} from '../engine/index.js';
import { MCTSBot } from './mcts-bot.js';
import type { MCTSNode } from './types.js';

// ============================================================================
// The seat a search move is made for is the seat its moves were listed for
// (#522).
//
// The search used to answer "which seat is moving?" three ways: the root
// listed the bot's own moves, the simulation listed the first not-completed
// awaiting seat's moves, and every move was submitted as the first awaiting
// seat that had actions listed. In a simultaneous step those disagree: at the
// root whenever the bot is not the first awaiting seat, and below it whenever
// a seat holds a follow-up (the engine leaves such a seat `completed: false`
// with no actions).
// ============================================================================

/**
 * Three seats scout at once (one of two routes); scouting hands the scout a
 * follow-up into `loot`, which the step does not list. `loot` throws when it is
 * carried by a seat other than the one taking it, as the follow-up-hold suite's
 * game does.
 */
class RaidGame extends Game<RaidGame, Player> {
  scouted: number[] = [];
  looted: Array<{ seat: number; where: string }> = [];

  constructor(options: GameOptions) {
    super(options);
    this.registerActions(
      Action.create<RaidGame>('scout')
        .condition({ 'has not scouted': (ctx) => !(ctx.game as RaidGame).scouted.includes(ctx.player.seat) })
        .chooseFrom('route', { choices: ['ridge', 'river'] })
        .execute((_a, ctx) => {
          (ctx.game as RaidGame).scouted.push(ctx.player.seat);
          return { success: true, followUp: { action: 'loot', args: { by: ctx.player.seat } } };
        }),
      Action.create<RaidGame>('loot')
        .condition({ 'only as a follow-up': () => false })
        .chooseFrom('where', { choices: ['north', 'south'] })
        .execute((args, ctx) => {
          const by = (args as Record<string, unknown>).by;
          if (by !== ctx.player.seat) throw new Error(`loot carried by ${String(by)}`);
          (ctx.game as RaidGame).looted.push({ seat: ctx.player.seat, where: args.where as string });
        }),
    );
    this.setFlow(
      defineFlow({
        root: simultaneousActionStep({
          actions: ['scout'],
          playerDone: (ctx, player) => (ctx.game as RaidGame).scouted.includes(player.seat),
        }),
        isComplete: (ctx) => (ctx.game as RaidGame).looted.length === 3,
        getWinners: (ctx) => {
          const game = ctx.game as RaidGame;
          return game.looted.filter((l) => l.where === 'north').map((l) => game.getPlayer(l.seat)!);
        },
      }),
    );
  }
}

/** The bot's private search state, which is what this suite inspects. */
type SearchInternals = {
  runSearch(): Promise<{ root: MCTSNode }>;
  captureSnapshot(): unknown;
  restoreGame(snapshot: unknown): RaidGame;
  rootSnapshot: unknown;
  searchGame: RaidGame | null;
  applyMoveToSearchGame(node: MCTSNode): 'made' | 'refused' | 'refusedAfterChanges';
};

function botFor(game: RaidGame, seat: number): SearchInternals {
  return new MCTSBot(game, RaidGame, 'raid', seat, [], {
    iterations: 200,
    playoutDepth: 6,
    seed: `raid-${seat}`,
    timeout: Infinity,
    async: false,
  }) as unknown as SearchInternals;
}

function newRaid(): RaidGame {
  const game = new RaidGame({ playerCount: 3, playerNames: ['A', 'B', 'C'], seed: 'raid' });
  game.startFlow();
  return game;
}

function everyNode(root: MCTSNode): MCTSNode[] {
  const out: MCTSNode[] = [];
  const walk = (node: MCTSNode) => {
    out.push(node);
    node.children.forEach(walk);
  };
  walk(root);
  return out;
}

describe('MCTSBot: one seat per search node (#522)', () => {
  it('makes every root move for the bot\'s own seat, not the first awaiting seat', async () => {
    const game = newRaid();
    const bot = botFor(game, 3);

    const { root } = await bot.runSearch();
    expect(root.currentPlayer).toBe(3);
    expect(root.children.length).toBe(2);

    for (const child of root.children) {
      bot.rootSnapshot = bot.captureSnapshot();
      bot.searchGame = bot.restoreGame(bot.rootSnapshot);
      expect(bot.applyMoveToSearchGame(child)).toBe('made');
      expect(bot.searchGame.scouted).toEqual([3]);
    }
  });

  it('lists and makes a held follow-up for the seat that holds it', async () => {
    const game = newRaid();
    game.continueFlow('scout', { route: 'ridge' }, 1);
    // Seat 1 holds its loot follow-up: not completed, no actions listed.
    expect(game.getFlowState()!.awaitingPlayers!.find((p) => p.playerIndex === 1))
      .toMatchObject({ completed: false, availableActions: [] });

    const bot = botFor(game, 2);
    const { root } = await bot.runSearch();
    const nodes = everyNode(root);

    // Nothing the search listed was refused when it was made.
    for (const node of nodes) expect([...node.refusedMoveKeys]).toEqual([]);

    // Every move below a node belongs to the seat the node says is moving.
    const lootChildren = nodes.flatMap((node) =>
      node.children
        .filter((child) => child.parentMove!.action === 'loot')
        .map((child) => ({ by: child.parentMove!.args.by, seat: node.currentPlayer })),
    );
    expect(lootChildren.length).toBeGreaterThan(0);
    for (const { by, seat } of lootChildren) expect(by).toBe(seat);
  });
});
