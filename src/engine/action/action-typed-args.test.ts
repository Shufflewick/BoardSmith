import { describe, it, expect, expectTypeOf } from 'vitest';
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

/**
 * #509: a chooseFrom arg is typed as the value its callbacks actually receive.
 *
 * A choice is a bare value `V` or the labelled shape `{ value: V; label?: string }`.
 * Either way every callback after `choices` gets `V`: the engine reads `value`
 * out of the labelled shape where the choices are built, and nowhere else. An
 * object with any other key is a value in its own right and arrives whole.
 * A pick that declares `multiSelect` or `orderedList` arrives as `V[]`.
 *
 * The type lines below are checked by `boardsmith typecheck`; the runtime lines
 * prove the engine delivers what the types promise.
 */
describe('chooseFrom args are typed as the delivered value (#509)', () => {
  it('types a { value, label } choice as its value, in every callback', () => {
    const seen: Record<string, unknown> = {};
    const def = Action.create<TypedGame>('labelled')
      .chooseFrom('pick', {
        choices: [{ value: 'skip', label: 'Skip' }, { value: 'go', label: 'Go' }],
        validate: (value) => {
          expectTypeOf(value).toEqualTypeOf<string>();
          return true;
        },
        onSelect: (value) => {
          expectTypeOf(value).toEqualTypeOf<string>();
        },
        disabled: (choice) => {
          expectTypeOf(choice).toEqualTypeOf<string>();
          return false;
        },
        display: (choice) => {
          expectTypeOf(choice).toEqualTypeOf<string>();
          return choice;
        },
        boardRefs: (choice) => {
          expectTypeOf(choice).toEqualTypeOf<string>();
          return { refs: [] };
        },
      })
      .execute((args) => {
        const s: string = args.pick;
        seen.pick = s;
        return { success: true };
      });
    expect(def.selections).toHaveLength(1);
  });

  it('types a mix of bare and labelled choices as the value', () => {
    Action.create<TypedGame>('mixed')
      .chooseFrom('pick', { choices: ['pass', { value: 'go', label: 'Go' }] })
      .execute((args) => {
        expectTypeOf(args.pick).toEqualTypeOf<string>();
        return { success: true };
      });
  });

  it('keeps an object with any other key whole: it is a value, not a label', () => {
    Action.create<TypedGame>('extra')
      .chooseFrom('pick', { choices: [{ value: 'go', cost: 3 }] })
      .execute((args) => {
        expectTypeOf(args.pick).toEqualTypeOf<{ value: string; cost: number }>();
        return { success: true };
      });
  });

  it('types a multiSelect pick as an array', () => {
    Action.create<TypedGame>('many')
      .chooseFrom('many', { choices: ['x', 'y'], multiSelect: { min: 1 } })
      .chooseFrom('upTo', { choices: [{ value: 1, label: 'One' }], multiSelect: 2 })
      .chooseFrom('dynamic', { choices: ['x'], multiSelect: () => ({ min: 1, max: 1 }) })
      .execute((args) => {
        const arr: string[] = args.many;
        const nums: number[] = args.upTo;
        const dyn: string[] = args.dynamic;
        void arr; void nums; void dyn;
        return { success: true };
      });
  });

  it('types an orderedList pick as an array', () => {
    Action.create<TypedGame>('list')
      .chooseFrom('steps', { choices: ['x', 'y'], orderedList: 2 })
      .execute((args) => {
        const arr: string[] = args.steps;
        void arr;
        return { success: true };
      });
  });

  it('refuses a multiSelect function that can return undefined: the value shape must be knowable', () => {
    Action.create<TypedGame>('maybe')
      // @ts-expect-error - a function-valued multiSelect returns a config; for a
      // single pick it returns { min: 1, max: 1 }, never undefined.
      .chooseFrom('pick', { choices: ['x'], multiSelect: () => undefined });
  });

  it('types playerChoices() as the seat number, so its JSDoc example compiles', () => {
    const game = new TypedGame({ playerCount: 2 });
    Action.create<TypedGame>('attack')
      .chooseFrom('target', {
        choices: (ctx) => game.playerChoices({ excludeSelf: true, currentPlayer: ctx.player }),
      })
      .execute(({ target }) => {
        const targetPlayer = game.getPlayerOrThrow(target);
        void targetPlayer;
        return { success: true };
      });
    expect(game.playerChoices()).toEqual([
      { value: 1, label: game.getPlayer(1)!.name },
      { value: 2, label: game.getPlayer(2)!.name },
    ]);
  });

  it('delivers the value of a labelled choice, the whole object otherwise, and arrays for multiSelect', () => {
    const received: Record<string, unknown> = {};
    const game = new TypedGame({ playerCount: 2 });
    game.registerAction(
      Action.create<TypedGame>('runtime')
        .chooseFrom('labelled', {
          choices: [{ value: 'skip', label: 'Skip' }, { value: 'go', label: 'Go' }],
          disabled: (choice) => { received.disabledSaw ??= choice; return false; },
          validate: (value) => { received.validateSaw = value; return true; },
        })
        .chooseFrom('extra', { choices: [{ value: 'go', cost: 3 }, { value: 'stay', cost: 0 }] })
        .chooseFrom('many', {
          choices: [{ value: 'x', label: 'X' }, 'y', { value: 'z', label: 'Z' }],
          multiSelect: { min: 1 },
        })
        .execute((args) => {
          received.args = { ...args };
          return { success: true };
        }),
    );
    const result = game.getActionExecutor().executeAction(
      game.getAction('runtime')!,
      game.getPlayer(1)!,
      { labelled: 'go', extra: { value: 'go', cost: 3 }, many: ['x', 'z'] },
    );
    expect(result.success, result.error).toBe(true);
    expect(received.args).toEqual({ labelled: 'go', extra: { value: 'go', cost: 3 }, many: ['x', 'z'] });
    expect(received.disabledSaw).toBe('skip');
    expect(received.validateSaw).toBe('go');
  });

  it('reads only the declared shape: a non-string label or a class instance is a value', () => {
    class Offer {
      constructor(public value: string, public label: string) {}
      describe(): string { return `${this.label} (${this.value})`; }
    }
    const offer = new Offer('go', 'Go');
    const received: unknown[] = [];
    const game = new TypedGame({ playerCount: 2 });
    game.registerAction(
      Action.create<TypedGame>('shapes')
        .chooseFrom('numbered', { choices: [{ value: 'go', label: 7 }] })
        .chooseFrom('instance', { choices: [offer] })
        .execute((args) => {
          expectTypeOf(args.numbered).toEqualTypeOf<{ value: string; label: number }>();
          expectTypeOf(args.instance).toEqualTypeOf<Offer>();
          received.push(args.numbered, args.instance);
          return { success: true };
        }),
    );
    const result = game.getActionExecutor().executeAction(
      game.getAction('shapes')!,
      game.getPlayer(1)!,
      { numbered: { value: 'go', label: 7 }, instance: offer },
    );
    expect(result.success, result.error).toBe(true);
    expect(received).toEqual([{ value: 'go', label: 7 }, offer]);
  });

  it('resolves a labelled choice submitted by its label to its value', () => {
    let received: unknown;
    const game = new TypedGame({ playerCount: 2 });
    game.registerAction(
      Action.create<TypedGame>('byLabel')
        .chooseFrom('pick', { choices: [{ value: 3, label: 'Three' }, { value: 4, label: 'Four' }] })
        .execute((args) => { received = args.pick; return { success: true }; }),
    );
    const result = game.getActionExecutor().executeAction(
      game.getAction('byLabel')!,
      game.getPlayer(1)!,
      { pick: 'Three' },
    );
    expect(result.success, result.error).toBe(true);
    expect(received).toBe(3);
  });
});

/**
 * #510: the callbacks inside the chain get the types the builder already knows.
 *
 * - A `chooseElement` given `elementClass: Coin` only ever offers coins, so its
 *   `filter` receives a `Coin`, not the base `GameElement`.
 * - A selection's `validate` receives `args` typed from the picks declared
 *   before it; on a repeating pick, also this pick's earlier values.
 *
 * Each positive assignment compiles only with the fix (without it these are
 * `GameElement`/`unknown`). Each `@ts-expect-error` fails the build as an unused
 * directive if `args` went back to an index signature where any key is
 * `unknown`. The runtime test proves the same values arrive.
 */
describe('builder callbacks are typed from the chain (#510)', () => {
  it('types a filter by its elementClass', () => {
    Action.create<TypedGame>('spend')
      .chooseElement('coin', {
        elementClass: Coin,
        filter: (coin) => {
          const face: number = coin.faceValue;
          return face > 0;
        },
      });
  });

  it('never lets a filter annotation narrow the pick: without elementClass every board element reaches filter', () => {
    Action.create<TypedGame>('loose')
      .chooseElement('c', {
        // @ts-expect-error - filter is handed every board element here, so it
        // cannot claim to receive only coins; T comes from elementClass or elements.
        filter: (c: Coin) => c.faceValue > 0,
      });
  });

  it('types a selection validate by the picks declared before it', () => {
    Action.create<TypedGame>('pair')
      .chooseFrom('n', { choices: [1, 2] })
      .chooseElement('coin', { elementClass: Coin })
      .chooseFrom('m', {
        choices: [1, 2],
        validate: (m, args) => {
          const n: number = args.n;
          const face: number = args.coin.faceValue;
          // @ts-expect-error - 'nn' was never declared.
          void args.nn;
          return m + n + face > 0;
        },
      })
      .enterText('note', { validate: (_text, args) => args.m > 0 })
      .enterNumber('count', { validate: (_count, args) => args.note.length > 0 })
      .chooseElements('coins', {
        elements: (ctx) => [...ctx.game.all(Coin)],
        validate: (_coins, args) => args.count > 0,
      });
  });

  it('types a repeating pick validate with its own earlier values', () => {
    Action.create<TypedGame>('collect')
      .chooseFrom('n', { choices: [1, 2] })
      .chooseFrom('runes', {
        choices: ['ice', 'fire', 'stop'],
        repeatUntil: 'stop',
        validate: (rune, args) => {
          const before: string[] = args.runes;
          const n: number = args.n;
          return !before.includes(rune) || n > 1;
        },
      })
      .chooseElement('coins', {
        elementClass: Coin,
        repeat: { until: () => true },
        validate: (coin, args) => {
          const before: Coin[] = args.coins;
          return !before.includes(coin);
        },
      });
  });

  it('delivers the earlier picks to filter and validate at run time', () => {
    const seen: { filterFaces: number[]; validateN?: number } = { filterFaces: [] };
    const game = new TypedGame({ playerCount: 2 });
    game.create(Coin, 'low', { faceValue: 1 });
    const high = game.create(Coin, 'high', { faceValue: 5 });
    game.registerAction(
      Action.create<TypedGame>('typedRun')
        .chooseFrom('n', { choices: [2, 3] })
        .chooseFrom('m', {
          choices: [1, 2, 3],
          validate: (_m, args) => {
            seen.validateN = args.n;
            return true;
          },
        })
        .chooseElement('coin', {
          elementClass: Coin,
          filter: (coin) => {
            seen.filterFaces.push(coin.faceValue);
            return coin.faceValue > 2;
          },
        })
        .execute(() => ({ success: true })),
    );
    const result = game.getActionExecutor().executeAction(
      game.getAction('typedRun')!,
      game.getPlayer(1)!,
      { n: 3, m: 1, coin: high },
    );
    expect(result.success, result.error).toBe(true);
    expect(seen.validateN).toBe(3);
    expect(new Set(seen.filterFaces)).toEqual(new Set([1, 5]));
  });
});
