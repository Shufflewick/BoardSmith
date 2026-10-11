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

/**
 * #627: the types say what the engine passes.
 *
 * - A `multiSelect` or `orderedList` pick is checked as a whole: its `validate`
 *   and `onSelect` get the array, as `execute` does. Per-choice callbacks
 *   (`display`, `disabled`, `boardRefs`) still get one value.
 * - An `optional` pick the player skipped is absent: `execute` and every later
 *   pick's `validate` see it as possibly `undefined`, whichever way the skip was
 *   submitted (left out, or sent as `null`).
 */
describe('builder types match what the engine passes (#627)', () => {
  it('types a multiSelect or orderedList validate and onSelect as the whole array', () => {
    Action.create<TypedGame>('many')
      .chooseFrom('m', {
        choices: [1, 2],
        multiSelect: 2,
        validate: (v) => {
          expectTypeOf(v).toEqualTypeOf<number[]>();
          // @ts-expect-error - a multiSelect is validated as the array it submits.
          const n: number = v;
          return n > 0;
        },
        onSelect: (v) => { expectTypeOf(v).toEqualTypeOf<number[]>(); },
        disabled: (choice) => { expectTypeOf(choice).toEqualTypeOf<number>(); return false; },
        display: (choice) => { expectTypeOf(choice).toEqualTypeOf<number>(); return String(choice); },
      })
      .chooseFrom('o', {
        choices: [{ value: 'x', label: 'X' }],
        orderedList: 3,
        validate: (v) => { expectTypeOf(v).toEqualTypeOf<string[]>(); return true; },
        onSelect: (v) => { expectTypeOf(v).toEqualTypeOf<string[]>(); },
      });
  });

  it('types an optional pick as possibly undefined after it, and a required one as present', () => {
    Action.create<TypedGame>('maybe')
      .chooseFrom('n', { choices: [1, 2], optional: true })
      .chooseFrom('labelled', { choices: ['a'], optional: 'No thanks' })
      .chooseFrom('required', { choices: [1], optional: false })
      .chooseFrom('many', { choices: [1], multiSelect: 2, optional: true })
      .chooseElement('coin', { elementClass: Coin, optional: true })
      .chooseElements('coins', { elements: (ctx) => [...ctx.game.all(Coin)], optional: true })
      .enterText('note', { optional: true })
      .enterNumber('count', {
        optional: true,
        validate: (_count, args) => {
          expectTypeOf(args.n).toEqualTypeOf<number | undefined>();
          expectTypeOf(args.coin).toEqualTypeOf<Coin | undefined>();
          return true;
        },
      })
      .execute((args) => {
        expectTypeOf(args.n).toEqualTypeOf<number | undefined>();
        expectTypeOf(args.labelled).toEqualTypeOf<string | undefined>();
        expectTypeOf(args.required).toEqualTypeOf<number>();
        expectTypeOf(args.many).toEqualTypeOf<number[] | undefined>();
        expectTypeOf(args.coin).toEqualTypeOf<Coin | undefined>();
        expectTypeOf(args.coins).toEqualTypeOf<Coin[] | undefined>();
        expectTypeOf(args.note).toEqualTypeOf<string | undefined>();
        expectTypeOf(args.count).toEqualTypeOf<number | undefined>();
        return { success: true };
      });
  });

  it('passes the array to a multiSelect or orderedList validate and onSelect at run time', () => {
    const seen: Record<string, unknown> = {};
    const game = new TypedGame({ playerCount: 2 });
    game.registerAction(
      Action.create<TypedGame>('arrays')
        .chooseFrom('m', {
          choices: [1, 2, 3],
          multiSelect: 2,
          validate: (v) => { seen.mValidate = v; return true; },
          onSelect: (v) => { seen.mOnSelect = v; },
        })
        .chooseFrom('o', {
          choices: ['x', 'y'],
          orderedList: 3,
          validate: (v) => { seen.oValidate = v; return true; },
          onSelect: (v) => { seen.oOnSelect = v; },
        })
        .execute(() => ({ success: true })),
    );
    const result = game.getActionExecutor().executeAction(
      game.getAction('arrays')!,
      game.getPlayer(1)!,
      { m: [1, 3], o: ['y', 'y'] },
    );
    expect(result.success, result.error).toBe(true);
    expect(seen).toEqual({ mValidate: [1, 3], mOnSelect: [1, 3], oValidate: ['y', 'y'], oOnSelect: ['y', 'y'] });
  });

  it.each([
    ['left out', {}],
    ['sent as null', { n: null }],
  ])('leaves a skipped optional pick absent from execute and later validates when it is %s', (_how, skip) => {
    const seen: { validateHad?: boolean; executeHad?: boolean } = {};
    const game = new TypedGame({ playerCount: 2 });
    game.registerAction(
      Action.create<TypedGame>('skip')
        .chooseFrom('n', { choices: [1, 2], optional: true })
        .chooseFrom('m', { choices: [3], validate: (_m, args) => { seen.validateHad = 'n' in args; return true; } })
        .execute((args) => { seen.executeHad = 'n' in args; return { success: true }; }),
    );
    const result = game.getActionExecutor().executeAction(
      game.getAction('skip')!,
      game.getPlayer(1)!,
      { ...skip, m: 3 },
    );
    expect(result.success, result.error).toBe(true);
    expect(seen).toEqual({ validateHad: false, executeHad: false });
  });
});

/**
 * #626: `ctx.args` is typed from the chain, as strictly as `args` is.
 *
 * - In every callback that runs while the action is being filled in (a pick's
 *   `prompt`, `choices`, `filter`, `display`, `disabled`, `condition`, the
 *   action's `disabled`), `ctx.args` holds the picks declared before it, each
 *   possibly absent: the engine also evaluates them with nothing picked yet, to
 *   decide whether the action is offered at all. A repeating pick sees its own
 *   earlier values as an array.
 * - In the action's `validate` and in `execute`, every pick is made, so
 *   `ctx.args` is typed exactly as `args` is.
 * - A key nothing declared is an error. Args a follow-up is started with
 *   (`followUp.args`) are declared with `.followUpArgs<...>()`, where the action
 *   is defined.
 */
describe('ctx.args is typed from the chain (#626)', () => {
  it('types ctx.args in pick callbacks as the earlier picks, each possibly absent', () => {
    Action.create<TypedGame>('ctx')
      .chooseFrom('n', { choices: [1, 2] })
      .chooseElement('coin', {
        elementClass: Coin,
        prompt: (ctx) => {
          expectTypeOf(ctx.args.n).toEqualTypeOf<number | undefined>();
          return 'Pick a coin';
        },
        filter: (_coin, ctx) => {
          expectTypeOf(ctx.args.n).toEqualTypeOf<number | undefined>();
          // @ts-expect-error - 'nn' was never declared.
          void ctx.args.nn;
          // @ts-expect-error - 'coin' is this pick, not an earlier one.
          void ctx.args.coin;
          return true;
        },
      })
      .chooseFrom('runes', {
        choices: (ctx) => {
          // A repeating pick's own earlier values: an array, typed `unknown[]`
          // because this callback is what the pick's type is inferred from.
          expectTypeOf(ctx.args.runes).toEqualTypeOf<unknown[] | undefined>();
          expectTypeOf(ctx.args.coin).toEqualTypeOf<Coin | undefined>();
          return ['ice', 'stop'];
        },
        repeatUntil: 'stop',
      })
      .chooseFrom('m', {
        choices: [1],
        multiSelect: (ctx) => {
          expectTypeOf(ctx.args.runes).toEqualTypeOf<string[] | undefined>();
          return 1;
        },
        disabled: (_m, ctx) => {
          expectTypeOf(ctx.args.n).toEqualTypeOf<number | undefined>();
          return false;
        },
      })
      .condition({
        'reads the picks': (ctx) => {
          expectTypeOf(ctx.args.m).toEqualTypeOf<number[] | undefined>();
          // @ts-expect-error - 'mm' was never declared.
          void ctx.args.mm;
          return true;
        },
      })
      .disabled((ctx) => {
        expectTypeOf(ctx.args.n).toEqualTypeOf<number | undefined>();
        return false;
      });
  });

  it('types ctx.args in validate and execute as every pick, the same as args', () => {
    Action.create<TypedGame>('whole')
      .chooseFrom('n', { choices: [1, 2] })
      .enterText('note', { optional: true })
      .validate((args, ctx) => {
        expectTypeOf(ctx.args).toEqualTypeOf(args);
        expectTypeOf(ctx.args.n).toEqualTypeOf<number>();
        return true;
      })
      .execute((args, ctx) => {
        expectTypeOf(ctx.args).toEqualTypeOf(args);
        expectTypeOf(ctx.args.note).toEqualTypeOf<string | undefined>();
        // @ts-expect-error - 'nn' was never declared.
        void ctx.args.nn;
        return { success: true };
      });
  });

  it('refuses a follow-up arg that is not declared', () => {
    Action.create<TypedGame>('collect')
      .chooseElement('equipment', {
        elementClass: Coin,
        filter: (_e, ctx) => {
          // @ts-expect-error - the action never declared followUpArgs.
          void ctx.args.sectorId;
          return true;
        },
      });
  });

  it('types declared follow-up args in every callback and in execute args', () => {
    Action.create<TypedGame>('collect')
      .followUpArgs<{ sector: Coin; round?: number }>()
      .chooseElement('equipment', {
        elementClass: Coin,
        prompt: (ctx) => `Select from ${ctx.args.sector?.name}`,
        filter: (_e, ctx) => {
          expectTypeOf(ctx.args.sector).toEqualTypeOf<Coin | undefined>();
          expectTypeOf(ctx.args.round).toEqualTypeOf<number | undefined>();
          // @ts-expect-error - 'sectorId' is not what the action declared.
          void ctx.args.sectorId;
          return true;
        },
        validate: (_e, args) => {
          expectTypeOf(args.sector).toEqualTypeOf<Coin>();
          return true;
        },
      })
      .execute((args, ctx) => {
        expectTypeOf(args.sector).toEqualTypeOf<Coin>();
        expectTypeOf(ctx.args.sector).toEqualTypeOf<Coin>();
        expectTypeOf(args.equipment).toEqualTypeOf<Coin>();
        return { success: true };
      });
  });

  it('refuses followUpArgs after a pick, or a second time: it is declared first, once', () => {
    const picked = Action.create<TypedGame>('late').chooseFrom('n', { choices: [1] });
    // @ts-expect-error - follow-up args are declared before any pick.
    picked.followUpArgs<{ sector: Coin }>();
    const declared = Action.create<TypedGame>('twice').followUpArgs<{ sector: Coin }>();
    // @ts-expect-error - one declaration says what the follow-up carries.
    declared.followUpArgs<{ round: number }>();
  });

  it('passes the follow-up args to the picks and to execute at run time', () => {
    const seen: { filterSector?: unknown; executeSector?: unknown } = {};
    const game = new TypedGame({ playerCount: 2 });
    const sector = game.create(Coin, 'sector', { faceValue: 1 });
    const loot = game.create(Coin, 'loot', { faceValue: 2 });
    game.registerAction(
      Action.create<TypedGame>('collectRun')
        .followUpArgs<{ sector: Coin }>()
        .chooseElement('equipment', {
          elementClass: Coin,
          filter: (coin, ctx) => {
            seen.filterSector = ctx.args.sector;
            return coin !== ctx.args.sector;
          },
        })
        .execute((args) => {
          seen.executeSector = args.sector;
          return { success: true };
        }),
    );
    const result = game.getActionExecutor().executeAction(
      game.getAction('collectRun')!,
      game.getPlayer(1)!,
      { equipment: loot },
      { followUp: { action: 'collectRun', args: { sector } } },
    );
    expect(result.success, result.error).toBe(true);
    expect(seen).toEqual({ filterSector: sector, executeSector: sector });
  });
});

/**
 * #652: a repeat's `until` and `onEach` get `ctx.args` typed from the chain.
 *
 * They run after a pick is made, so the picks before the repeating one are
 * present (an optional one may be absent), and so are declared follow-up args.
 * The repeating pick's own values so far are typed as the pick, as its
 * `validate` gets them (#657). The pick's type is still inferred from
 * `choices` or `elements`.
 */
describe('repeat until and onEach get typed ctx.args (#652)', () => {
  it('types until and onEach ctx.args as the earlier picks, the follow-up args and the values so far', () => {
    Action.create<TypedGame>('repeatCtx')
      .followUpArgs<{ sector: Coin }>()
      .chooseFrom('n', { choices: [1, 2] })
      .enterText('note', { optional: true })
      .chooseFrom('runes', {
        choices: ['ice', 'fire', 'stop'],
        repeat: {
          onEach: (ctx, rune) => {
            expectTypeOf(rune).toEqualTypeOf<string>();
            expectTypeOf(ctx.args.n).toEqualTypeOf<number>();
            expectTypeOf(ctx.args.note).toEqualTypeOf<string | undefined>();
            expectTypeOf(ctx.args.sector).toEqualTypeOf<Coin>();
            expectTypeOf(ctx.args.runes).toEqualTypeOf<string[]>();
            expectTypeOf(ctx.game).toEqualTypeOf<TypedGame>();
            // @ts-expect-error - 'nn' was never declared.
            void ctx.args.nn;
          },
          until: (ctx, rune) => {
            expectTypeOf(rune).toEqualTypeOf<string>();
            expectTypeOf(ctx.args.n).toEqualTypeOf<number>();
            // @ts-expect-error - 'rune' is misspelt; the pick is 'runes'.
            void ctx.args.rune;
            return rune === 'stop';
          },
        },
      })
      .chooseElement('coins', {
        elementClass: Coin,
        repeat: {
          until: (ctx, coin) => {
            expectTypeOf(coin).toEqualTypeOf<Coin>();
            expectTypeOf(ctx.args.runes).toEqualTypeOf<string[]>();
            expectTypeOf(ctx.args.coins).toEqualTypeOf<Coin[]>();
            // @ts-expect-error - 'coin' is misspelt; the pick is 'coins'.
            void ctx.args.coin;
            return true;
          },
        },
      })
      .chooseElements('piles', {
        elements: (ctx) => [...ctx.game.all(Coin)],
        repeat: {
          onEach: (ctx, pile) => {
            expectTypeOf(pile).toEqualTypeOf<Coin>();
            expectTypeOf(ctx.args.coins).toEqualTypeOf<Coin[]>();
            expectTypeOf(ctx.args.piles).toEqualTypeOf<Coin[]>();
            // @ts-expect-error - 'pile' is misspelt; the pick is 'piles'.
            void ctx.args.pile;
          },
          until: () => true,
        },
      })
      .execute((args) => {
        expectTypeOf(args.runes).toEqualTypeOf<string[]>();
        expectTypeOf(args.coins).toEqualTypeOf<Coin[]>();
        return { success: true };
      });
  });

  it('still infers the pick type from a choices function alongside until and onEach', () => {
    Action.create<TypedGame>('inferred')
      .chooseFrom('n', { choices: [1, 2] })
      .chooseFrom('amount', {
        choices: (ctx) => [ctx.game.treasury, 0],
        repeat: {
          onEach: (ctx, amount) => { ctx.game.treasury -= amount + (ctx.args.n); },
          until: (_ctx, amount) => amount === 0,
        },
      })
      .execute((args) => {
        expectTypeOf(args.amount).toEqualTypeOf<number[]>();
        return { success: true };
      });
  });

  it('passes the earlier picks and the values so far to until and onEach at run time', () => {
    const seen: { onEach: unknown[]; until: unknown[] } = { onEach: [], until: [] };
    const game = new TypedGame({ playerCount: 2 });
    game.registerAction(
      Action.create<TypedGame>('repeatRun')
        .chooseFrom('n', { choices: [2, 3] })
        .chooseFrom('runes', {
          choices: ['ice', 'stop'],
          repeat: {
            onEach: (ctx) => { seen.onEach.push({ n: ctx.args.n, runes: [...ctx.args.runes] }); },
            until: (ctx, rune) => { seen.until.push({ n: ctx.args.n, runes: [...ctx.args.runes] }); return rune === 'stop'; },
          },
        })
        .execute(() => ({ success: true })),
    );
    const result = game.getActionExecutor().executeAction(
      game.getAction('repeatRun')!,
      game.getPlayer(1)!,
      { n: 3, runes: ['ice', 'stop'] },
    );
    expect(result.success, result.error).toBe(true);
    const expected = [{ n: 3, runes: ['ice'] }, { n: 3, runes: ['ice', 'stop'] }];
    expect(seen).toEqual({ onEach: expected, until: expected });
  });

  // #657: the values so far are what validate and execute get (elements, or
  // the choice values), not the ids the pending repeat stores.
  it('passes a repeating element pick its values so far as elements', () => {
    const game = new TypedGame({ playerCount: 2 });
    const a = game.create(Coin, 'a', { faceValue: 1 });
    const b = game.create(Coin, 'b', { faceValue: 2 });
    const seen: Record<string, unknown[][]> = { coinsEach: [], coinsUntil: [], pilesEach: [], pilesUntil: [] };
    game.registerAction(
      Action.create<TypedGame>('elementRun')
        .chooseElement('coins', {
          elementClass: Coin,
          repeat: {
            onEach: (ctx) => { seen.coinsEach.push([...ctx.args.coins]); },
            until: (ctx, coin) => { seen.coinsUntil.push([...ctx.args.coins]); return coin === b; },
          },
        })
        .chooseElements('piles', {
          elements: (ctx) => [...ctx.game.all(Coin)],
          repeat: {
            onEach: (ctx) => { seen.pilesEach.push([...ctx.args.piles]); },
            until: (ctx, pile) => { seen.pilesUntil.push([...ctx.args.piles]); return pile === a; },
          },
        })
        .execute(() => ({ success: true })),
    );
    const result = game.getActionExecutor().executeAction(
      game.getAction('elementRun')!,
      game.getPlayer(1)!,
      { coins: [a, b], piles: [b, a] },
    );
    expect(result.success, result.error).toBe(true);
    expect(seen).toEqual({
      coinsEach: [[a], [a, b]],
      coinsUntil: [[a], [a, b]],
      pilesEach: [[b], [b, a]],
      pilesUntil: [[b], [b, a]],
    });
  });

  it('passes a repeating chooseFrom of objects its values so far as the objects', () => {
    const game = new TypedGame({ playerCount: 2 });
    const ice = { rune: 'ice' };
    const stop = { rune: 'stop' };
    const seen: { onEach: unknown[][]; until: unknown[][] } = { onEach: [], until: [] };
    game.registerAction(
      Action.create<TypedGame>('objectRun')
        .chooseFrom('runes', {
          choices: [ice, stop],
          repeat: {
            onEach: (ctx) => { seen.onEach.push([...ctx.args.runes]); },
            until: (ctx, rune) => { seen.until.push([...ctx.args.runes]); return rune.rune === 'stop'; },
          },
        })
        .execute(() => ({ success: true })),
    );
    const result = game.getActionExecutor().executeAction(
      game.getAction('objectRun')!,
      game.getPlayer(1)!,
      { runes: [ice, stop] },
    );
    expect(result.success, result.error).toBe(true);
    expect(seen).toEqual({ onEach: [[ice], [ice, stop]], until: [[ice], [ice, stop]] });
  });
});
