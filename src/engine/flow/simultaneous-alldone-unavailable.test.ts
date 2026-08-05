import { describe, it, expect } from 'vitest';
import { Game, Player, Action, FlowEngine, defineFlow, simultaneousActionStep, sequence, execute } from '../index.js';

/**
 * BUG 7 regression (reported from 1-2 Punch): a seat is absent from
 * `awaitingPlayers` when it cannot currently form a LEGAL action -- not only
 * when it is done. `executeSimultaneousActionStep` built the awaiting set by
 * filtering to seats whose listed action is available, then force-completed
 * the frame whenever that set came out empty. A custom `allDone` returning
 * false was consulted first but only its TRUE branch was honored, so a step
 * the game explicitly declared unfinished advanced anyway -- straight into
 * the next node, which then reads the half-built state the step existed to
 * guard (in 1-2 Punch: the Fight phase dereferencing an empty plan slot).
 *
 * The correct behavior is an honest stall: stay awaiting with an empty set so
 * a later game-state change (a refilled hand, a terminator) can resolve it.
 *
 * This is the FRESH-ENTRY path only. `resumeSimultaneousAction`'s
 * force-complete on a stray no-eligible-actor resume is deliberately
 * divergent and is pinned by `simultaneous-alldone-empty.test.ts`.
 */
describe('BUG 7 / simultaneousActionStep: allDone is authoritative on an empty awaiting set', () => {
  class DepletedPlayer extends Player<DepletedGame, DepletedPlayer> {
    handSize = 0;
    committed = false;
  }

  class DepletedGame extends Game<DepletedGame, DepletedPlayer> {
    static PlayerClass = DepletedPlayer;
    advanced = false;
  }

  /**
   * `commit` needs two cards, mirroring 1-2 Punch's two-`chooseElement`
   * `submit-plan`. A seat whose hand is below that cannot form the action at
   * all, so the engine omits it from `awaitingPlayers`.
   */
  function buildGame(handSizes: [number, number]): DepletedGame {
    const game = new DepletedGame({ playerCount: 2, seed: 't' });
    game.players.forEach((player, i) => {
      player.handSize = handSizes[i]!;
    });

    game.registerAction(
      Action.create('commit')
        .condition({
          'has at least two cards in hand': (ctx) => (ctx.player as DepletedPlayer).handSize >= 2,
        })
        .execute((_args, ctx) => {
          const player = ctx.player as DepletedPlayer;
          player.handSize -= 2;
          player.committed = true;
          return { success: true };
        }),
    );

    return game;
  }

  function buildEngine(game: DepletedGame): FlowEngine<DepletedGame> {
    const flow = defineFlow({
      root: sequence(
        simultaneousActionStep({
          name: 'plan',
          actions: ['commit'],
          allDone: () => game.players.every((p) => p.committed),
        }),
        execute(() => {
          game.advanced = true;
        }),
      ),
    });
    return new FlowEngine(game, flow);
  }

  it('stays awaiting when NO seat can act and allDone returns false, instead of force-advancing', () => {
    // Both hands are depleted below what `commit` needs, so neither seat is
    // eligible -- and neither has committed, so allDone is false.
    const game = buildGame([1, 1]);
    const state = buildEngine(game).start();

    expect(state.awaitingInput).toBe(true);
    expect(state.complete).toBe(false);
    // The stall is honest: nobody is awaited, but the step is still open.
    expect(state.awaitingPlayers ?? []).toHaveLength(0);
    // The decisive assertion -- the node AFTER the step must not have run.
    expect(game.advanced).toBe(false);
  });

  it('completes normally once allDone is satisfied, even with an empty awaiting set', () => {
    // Both seats already committed, so allDone is true on entry and no seat
    // can act. The empty awaiting set must still complete here.
    const game = buildGame([1, 1]);
    game.players.forEach((p) => {
      p.committed = true;
    });

    const state = buildEngine(game).start();

    expect(state.awaitingInput).toBe(false);
    expect(state.complete).toBe(true);
    expect(game.advanced).toBe(true);
  });

  it('still auto-completes an empty awaiting set when the step declares no allDone at all', () => {
    // Without a game-supplied completion condition there is nothing to hold
    // the step open, so the original auto-complete remains correct. This pins
    // the fix to allDone-bearing steps only.
    const game = buildGame([1, 1]);
    const flow = defineFlow({
      root: sequence(
        simultaneousActionStep({ name: 'plan', actions: ['commit'] }),
        execute(() => {
          game.advanced = true;
        }),
      ),
    });

    const state = new FlowEngine(game, flow).start();

    expect(state.awaitingInput).toBe(false);
    expect(state.complete).toBe(true);
    expect(game.advanced).toBe(true);
  });

  it('holds the step open for the depleted seat while an eligible seat can still act', () => {
    // The asymmetric case the report says already worked -- pinned so the fix
    // does not regress it. Seat 1 can act, seat 2 cannot.
    const game = buildGame([2, 1]);
    const engine = buildEngine(game);

    const start = engine.start();
    expect(start.awaitingPlayers).toHaveLength(1);
    expect(start.awaitingPlayers?.[0]?.playerIndex).toBe(1);

    // Seat 1 commits; seat 2 still cannot, and allDone stays false.
    const after = engine.resume('commit', {}, 1);
    expect(after.awaitingInput).toBe(true);
    expect(after.complete).toBe(false);
    expect(game.advanced).toBe(false);
  });
});
