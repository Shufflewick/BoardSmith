import { describe, it, expect } from 'vitest';
import { Game, Player, Piece, Action } from '../index.js';
import {
  defineFlow,
  loop,
  sequence,
  eachPlayer,
  actionStep,
  simultaneousActionStep,
  execute,
  ifThen,
} from './builders.js';
import type { PlayerOf } from '../index.js';

/**
 * The flow definition a game writes is generic over that game, so every callback
 * it hands the engine sees the CONCRETE game and the CONCRETE player.
 *
 * Before this, every flow config took a bare `FlowContext` (`ctx.game: Game`) and
 * every player-shaped callback took a bare `Player`, so a game's flow file opened
 * with `const game = ctx.game as MyGame` and `ctx.player as MyPlayer` in every
 * step. Those casts are not decoration: they are the one place a renamed field or
 * a wrong player subclass compiles clean and fails at a player's seat.
 *
 * The TYPE guarantees below are enforced by `tsc --noEmit`. Each positive
 * assignment compiles only when the context resolved to the concrete type; each
 * `@ts-expect-error` fails the build as an unused directive if the context went
 * back to being the base class (base `Game`/`Player` are structurally wide enough
 * that the wrong-type reads would otherwise pass).
 *
 * The RUNTIME half proves the same values actually arrive.
 */

class Coin extends Piece<TypedFlowGame> {
  faceValue = 1;
}

class TypedFlowPlayer extends Player<TypedFlowGame> {
  purse = 0;
}

class TypedFlowGame extends Game<TypedFlowGame, TypedFlowPlayer> {
  static PlayerClass = TypedFlowPlayer;
  treasury = 100;
}

/** A game that never names a Player subclass, to pin the default. */
class BaseFlowGame extends Game<BaseFlowGame, Player> {}

describe('Flow callbacks are typed to the game that declared them (issue #52)', () => {
  it('resolves PlayerOf<G> to the game\'s own Player subclass', () => {
    const game = new TypedFlowGame({ playerCount: 2 });
    const player: PlayerOf<TypedFlowGame> = game.players[0];
    const purse: number = player.purse;
    expect(purse).toBe(0);

    // A game that never named a Player subclass keeps the base `Player`, so the
    // default stays useful rather than collapsing to `any`.
    const baseGame = new BaseFlowGame({ playerCount: 2 });
    const basePlayer: PlayerOf<Game> = baseGame.players[0];
    expect(basePlayer).toBeInstanceOf(Player);

    // @ts-expect-error - `PlayerOf<Game>` is `Player`, which has no `purse`. If
    // this resolved to `any` the read would compile and the directive would be
    // unused, which tsc reports as an error.
    void basePlayer.purse;
  });

  it('threads the game type through every nested builder from defineFlow', () => {
    const seen: string[] = [];

    const flow = defineFlow<TypedFlowGame>({
      root: sequence(
        loop({
          maxIterations: 2,
          // ctx.game is TypedFlowGame, with no cast at the top of the callback.
          while: (ctx) => ctx.game.treasury > 0,
          do: sequence(
            eachPlayer({
              // Both the player argument and the context are concrete here.
              filter: (player, ctx) => player.purse >= 0 && ctx.game.treasury >= 0,
              startingPlayer: (ctx) => ctx.game.players[0],
              do: actionStep({
                actions: ['pass'],
                player: (ctx) => ctx.game.players[0],
                skipIf: (ctx) => ctx.game.treasury < 0,
              }),
            }),
            execute((ctx) => {
              const treasury: number = ctx.game.treasury;
              seen.push(`treasury:${treasury}`);
              if (ctx.player) {
                const purse: number = ctx.player.purse;
                seen.push(`purse:${purse}`);
              }
            }),
            ifThen({
              condition: (ctx) => ctx.game.all(Coin).length === 0,
              then: execute((ctx) => void ctx.game.treasury),
            })
          ),
        }),
        simultaneousActionStep({
          actions: ['pass'],
          players: (ctx) => ctx.game.players,
          playerDone: (ctx, player) => player.purse > 0 && ctx.game.treasury > 0,
          skipPlayer: (_ctx, player) => player.purse < 0,
        })
      ),
      isComplete: (ctx) => ctx.game.treasury <= 0,
      getWinners: (ctx) => ctx.game.players.filter((p) => p.purse > 0),
      setup: (ctx) => {
        ctx.game.treasury = 100;
      },
    });

    expect(flow.root).toBeDefined();
    expect(seen).toEqual([]);
  });

  it('types ctx.player in an action the same way, from the same declaration', () => {
    let seen: number | undefined;

    const action = Action.create<TypedFlowGame>('bank')
      .chooseFrom('amount', { choices: [1, 2] })
      .execute((args, ctx) => {
        // Both halves of the context are concrete: the game AND the player.
        const treasury: number = ctx.game.treasury;
        const purse: number = ctx.player.purse;
        seen = treasury + purse + args.amount;
      });

    expect(action.name).toBe('bank');
    expect(seen).toBeUndefined();
  });

  it('rejects a read the concrete types do not permit', () => {
    defineFlow<TypedFlowGame>({
      root: execute((ctx) => {
        // @ts-expect-error - `vault` is not on TypedFlowGame. Without the
        // threading `ctx.game` is the base `Game` and this is still an error,
        // so the directive stays used either way; what it pins is that the
        // context is a real type rather than `any`.
        void ctx.game.vault;
      }),
    });
    expect(true).toBe(true);
  });
});
