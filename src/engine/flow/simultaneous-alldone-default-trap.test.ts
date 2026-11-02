import { describe, it, expect } from 'vitest';
import { Game, Player, Action, FlowEngine, simultaneousActionStep } from '../index.js';

/**
 * Pins the `simultaneousActionStep` default-`allDone` trap that
 * `docs/actions-and-flow.md` and the `simultaneousActionStep` JSDoc now
 * document, so the docs and the behaviour cannot drift apart.
 *
 * The awaiting set is built at step ENTRY from the seats that have at least
 * one available action right then, and worked out again only when a seat's
 * action settles (#1551). Consequences, pinned below:
 *
 *  1. The default `allDone` ("every AWAITING seat is done") ends the step as
 *     soon as that subset finishes — a seat that was momentarily unable to act
 *     is skipped in silence.
 *  2. An explicit `allDone` prevents the silent skip, but a seat made able to
 *     act by something OUTSIDE an action is not admitted: it converts a silent
 *     wrong answer into a visible stall, and the seat gets in on the next
 *     entry (or a `refreshAwaitingActions()`).
 *  3. A seat another seat's action made able to act is admitted at once.
 */

class OrderPlayer extends Player<OrderGame, OrderPlayer> {
  /** Set false to make this seat's action unavailable at step entry. */
  ready: boolean = true;
  order?: string;
}

class OrderGame extends Game<OrderGame, OrderPlayer> {
  static PlayerClass = OrderPlayer;
}

const registerOrderAction = (game: OrderGame) => {
  game.registerAction(
    Action.create<OrderGame>('submitOrder')
      .condition({ 'is ready': (ctx) => (ctx.player as OrderPlayer).ready })
      .execute((_args, ctx) => {
        (ctx.player as OrderPlayer).order = 'given';
        return { success: true };
      })
  );
};

const orderStep = (allDone?: (ctx: { game: OrderGame }) => boolean) =>
  simultaneousActionStep({
    name: 'orders',
    actions: ['submitOrder'],
    playerDone: (_ctx, player) => (player as OrderPlayer).order !== undefined,
    ...(allDone ? { allDone: allDone as never } : {}),
  });

describe('simultaneousActionStep default allDone', () => {
  it('silently skips a seat that had no legal move when the step opened', () => {
    const game = new OrderGame({ playerCount: 3, seed: 'trap' });
    registerOrderAction(game);
    // Seat 2 is momentarily unable to act — it is expected back, not out.
    game.getPlayerOrThrow(2).ready = false;

    const engine = new FlowEngine(game, { root: orderStep() });
    engine.start();

    expect(
      engine.getState().awaitingPlayers?.map(p => p.playerIndex),
      'seat 2 was never added to the awaiting set'
    ).toEqual([1, 3]);

    engine.resume('submitOrder', {}, 1);
    const state = engine.resume('submitOrder', {}, 3);

    // The step is over with seat 2 never having acted. No error, no warning
    // about the missing seat — this is the trap, pinned.
    expect(state.awaitingInput).toBe(false);
    expect(game.getPlayerOrThrow(2).order).toBeUndefined();
  });

  it('an explicit allDone turns the silent skip into a visible stall', () => {
    const game = new OrderGame({ playerCount: 3, seed: 'trap' });
    registerOrderAction(game);
    game.getPlayerOrThrow(2).ready = false;

    const engine = new FlowEngine(
      game,
      { root: orderStep(ctx => ctx.game.all(OrderPlayer).every(p => p.order !== undefined)) }
    );
    engine.start();

    engine.resume('submitOrder', {}, 1);
    const afterEligible = engine.resume('submitOrder', {}, 3);

    // allDone is authoritative: the step stays open rather than finishing
    // a round seat 2 never took part in.
    expect(afterEligible.awaitingInput).toBe(true);

    // A change made outside any action admits nobody: even once seat 2 CAN
    // act, this step entry will not accept it — the honest outcome is a stall.
    game.getPlayerOrThrow(2).ready = true;
    const rejected = engine.resume('submitOrder', {}, 2);

    expect(rejected.actionError).toBe('Player 2 is not awaiting action');
    expect(game.getPlayerOrThrow(2).order).toBeUndefined();
  });

  it('a seat another seat unblocks is admitted in the same entry (#1551)', () => {
    const game = new OrderGame({ playerCount: 3, seed: 'trap' });
    // Seat 2 cannot act until seat 1 has ordered: its legal move depends on another seat.
    game.registerAction(
      Action.create<OrderGame>('submitOrder')
        .condition({
          'is unblocked': (ctx) =>
            ctx.player.seat !== 2 || ctx.game.getPlayerOrThrow(1).order !== undefined,
        })
        .execute((_args, ctx) => {
          (ctx.player as OrderPlayer).order = 'given';
          return { success: true };
        })
    );

    const engine = new FlowEngine(game, { root: orderStep() });

    engine.start();
    expect(engine.getState().awaitingPlayers?.map(p => p.playerIndex)).toEqual([1, 3]);

    const afterSeat1 = engine.resume('submitOrder', {}, 1);
    expect(afterSeat1.awaitingPlayers?.map(p => p.playerIndex)).toEqual([1, 3, 2]);

    engine.resume('submitOrder', {}, 3);
    const done = engine.resume('submitOrder', {}, 2);
    expect(game.getPlayerOrThrow(2).order).toBe('given');
    expect(done.awaitingInput).toBe(false);
  });
});
