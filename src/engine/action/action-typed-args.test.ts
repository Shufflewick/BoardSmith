import { describe, it, expect } from 'vitest';
import { Game, Piece, Player, Action } from '../index.js';
import type { ActionContext } from '../index.js';

/**
 * Regression test for F19 + F25.
 *
 * Before the fix, `execute((args, ctx) => ...)` received `args: Record<string,
 * unknown>` and `ctx.game: Game` (effectively `any`), forcing every game to
 * cast: `args.piece as CheckerPiece`, `ctx.game as MyGame`. A typo'd arg key
 * compiled silently and crashed at runtime.
 *
 * After the fix the builder accumulates a fully-typed args record and threads
 * the concrete game type through `ActionContext<G>`, so the execute handler is
 * type-safe with zero casts.
 *
 * The TYPE guarantees below are enforced by `tsc` (run `npx tsc --noEmit`):
 *  - positive assignments compile ONLY when args/ctx.game are correctly typed
 *    (without the fix they are `unknown`/base `Game` and these lines error).
 *  - the `@ts-expect-error` lines flag a typo'd key as an error; without the
 *    fix the key is `unknown` (no error) and the directive becomes "unused",
 *    which `tsc` reports as a failure.
 *
 * The RUNTIME test proves the same args/game actually flow through execute().
 */

class Coin extends Piece<TypedGame> {
  faceValue = 0;
}

class TypedGame extends Game<TypedGame, Player> {
  treasury = 100;
}

describe('Typed action execute args (F19 + F25)', () => {
  it('threads accumulated arg types and the concrete game type into execute()', () => {
    let observed: { amount: number; faceValue: number; note: string; treasury: number } | undefined;

    const def = Action.create<TypedGame>('mint')
      .chooseFrom('amount', { choices: [1, 2, 3] })
      .chooseElement('coin', { elementClass: Coin })
      .enterText('note', {})
      .execute((args, ctx) => {
        // TYPE assertions (verified by tsc): these compile only because the
        // builder typed each arg and `ctx.game` is `TypedGame`, not `Game`.
        // Without the fix `args.*` is `unknown` and `ctx.game` is the base
        // `Game`, so every line below is a compile error.
        const typedAmount: number = args.amount;
        const typedFace: number = args.coin.faceValue;
        const typedNote: string = args.note;
        const typedTreasury: number = ctx.game.treasury;

        // @ts-expect-error - 'amounttypo' is not a declared selection key, so
        // accessing it is rejected. Without the fix `args` is an index-signature
        // record where every key is `unknown`, this is NOT an error, and the
        // directive becomes "unused" -> tsc fails.
        void args.amounttypo;

        observed = {
          amount: typedAmount,
          faceValue: typedFace,
          note: typedNote,
          treasury: typedTreasury,
        };
        return { success: true, data: { minted: typedAmount } };
      });

    // Runtime: build a concrete game + coin and invoke the stored handler.
    const game = new TypedGame({ playerCount: 2 });
    const coin = game.create(Coin, 'coin', { faceValue: 25 });
    game.treasury = 500;

    const ctx: ActionContext = {
      game,
      player: game.getPlayer(1)!,
      args: {},
    };

    const result = def.execute(
      { amount: 3, coin, note: 'hello' } as Record<string, unknown>,
      ctx
    );

    expect(observed).toEqual({ amount: 3, faceValue: 25, note: 'hello', treasury: 500 });
    expect(result).toEqual({ success: true, data: { minted: 3 } });
  });
});
