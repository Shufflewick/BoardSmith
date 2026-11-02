/**
 * In a simultaneous step where a seat acts several times before it is done,
 * the search lists that seat's moves against the game after its own earlier
 * moves, with only the other seats' picks hidden (#1563). It used to re-capture
 * its hidden-picks baseline before every move while nobody was done, so a seat
 * never saw its own last move and did see the other seats' earlier ones.
 */
import { describe, it, expect } from 'vitest';
import { Game, Player, Action, simultaneousActionStep, followUpForSeat, type GameOptions } from '../engine/index.js';
import { MCTSBot } from './mcts-bot.js';
import type { BotMove, BotStrategy } from './types.js';

/**
 * Each seat explores once, which uses up the rope in its own stash and hands it
 * a follow-up to collect one item from that stash, then ends its turn. A seat
 * may cheer once another seat has explored.
 */
class ExpeditionGame extends Game<ExpeditionGame, Player> {
  explored: number[] = [];
  ended: number[] = [];
  stash: Record<number, string[]> = { 1: ['rope', 'lamp', 'map'], 2: ['rope', 'lamp', 'map'] };

  constructor(options: GameOptions) {
    super(options);
    this.registerActions(
      Action.create<ExpeditionGame>('explore')
        .condition({ 'has not explored': (ctx) => !(ctx.game as ExpeditionGame).explored.includes(ctx.player.seat) })
        .execute((_args, ctx) => {
          const game = ctx.game as ExpeditionGame;
          game.explored.push(ctx.player.seat);
          game.stash[ctx.player.seat] = game.stash[ctx.player.seat].filter((item) => item !== 'rope');
          return { success: true, followUp: { action: 'collect', args: { explorer: ctx.player.seat } } };
        }),
      Action.create<ExpeditionGame>('collect')
        .condition({ 'only as a follow-up': () => false })
        .chooseFrom('item', { choices: (ctx) => (ctx.game as ExpeditionGame).stash[ctx.player.seat] })
        .execute((args, ctx) => {
          const game = ctx.game as ExpeditionGame;
          game.stash[ctx.player.seat] = game.stash[ctx.player.seat].filter((item) => item !== args.item);
        }),
      Action.create<ExpeditionGame>('cheer')
        .condition({ 'another seat explored': (ctx) => (ctx.game as ExpeditionGame).explored.some((seat) => seat !== ctx.player.seat) })
        .execute(() => {}),
      Action.create<ExpeditionGame>('endTurn').execute((_args, ctx) => {
        (ctx.game as ExpeditionGame).ended.push(ctx.player.seat);
      }),
    );
    this.setFlow({
      root: simultaneousActionStep<ExpeditionGame>({
        actions: ['explore', 'cheer', 'endTurn'],
        playerDone: (ctx, player) => (ctx.game as ExpeditionGame).ended.includes(player.seat),
      }),
    });
  }
}

type Listing = { seat: number; heldFollowUp?: string; item: unknown; stash: string[] };

/** Every `collect` move the search listed, with the game it was listed against, and every listing that saw another seat's exploring. */
async function searchExpedition(): Promise<{ collects: Listing[]; leaks: string[] }> {
  const collects: Listing[] = [];
  const leaks: string[] = [];
  const strategy: BotStrategy = {
    candidateMoves: (game, seat, listMoves) => {
      const expedition = game as ExpeditionGame;
      const others = expedition.explored.filter((explorer) => explorer !== seat);
      if (others.length > 0) leaks.push(`seat ${seat} saw seat ${others.join(', ')} explore`);
      const moves = listMoves();
      for (const move of moves.filter((m) => m.action === 'collect')) {
        collects.push({
          seat,
          heldFollowUp: followUpForSeat(expedition.getFlowState()!, seat)?.action,
          item: move.args.item,
          stash: [...expedition.stash[seat]],
        });
      }
      return moves;
    },
  };
  const game = new ExpeditionGame({ playerCount: 2, playerNames: ['A', 'B'], seed: 'expedition' });
  game.startFlow();
  await new MCTSBot(game, ExpeditionGame, 'expedition', 1, { iterations: 200, playoutDepth: 8, seed: 'expedition', timeout: Infinity }, strategy).play();
  return { collects, leaks };
}

/** The bot's private search state this suite drives. */
type SearchInternals = {
  captureSnapshot(): unknown;
  restoreGame(snapshot: unknown): ExpeditionGame;
  searchGame: ExpeditionGame | null;
  makeSearchMove(move: BotMove, seat: number): { outcome: 'made' | 'refused' | 'refusedAfterChanges' };
};

describe('MCTSBot in a simultaneous step a seat acts in several times (#1563)', () => {
  it('lists a seat\'s follow-up against the game after its own move, which holds that follow-up', async () => {
    const { collects } = await searchExpedition();
    expect(collects.length).toBeGreaterThan(0);
    for (const listing of collects) {
      expect(listing.heldFollowUp).toBe('collect');
      expect(listing.item).not.toBe('rope');
      expect(listing.stash).not.toContain('rope');
    }
  });

  it('still hides the other seats\' moves in the step from a seat\'s listing', async () => {
    const { leaks } = await searchExpedition();
    expect(leaks).toEqual([]);
  });

  it('spoils the step when a seat makes a move it could make only after another seat\'s', () => {
    const game = new ExpeditionGame({ playerCount: 2, playerNames: ['A', 'B'], seed: 'expedition' });
    game.startFlow();
    const bot = new MCTSBot(game, ExpeditionGame, 'expedition', 1, { seed: 'expedition' }) as unknown as SearchInternals;
    bot.searchGame = bot.restoreGame(bot.captureSnapshot());

    expect(bot.makeSearchMove({ action: 'explore', args: {} }, 1).outcome).toBe('made');
    // The world offers seat 2 the cheer, but seat 2's own copy has not seen seat 1 explore.
    expect(bot.makeSearchMove({ action: 'cheer', args: {} }, 2).outcome).toBe('refusedAfterChanges');
  });
});
