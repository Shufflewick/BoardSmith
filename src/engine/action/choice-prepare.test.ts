/**
 * A selection's per-choice `disabled` rule can share work across one
 * evaluation (#334).
 *
 * `prepare(ctx)` runs once each time the engine evaluates the selection's
 * choices, before any `disabled` call, and its result is handed to every
 * `disabled(choice, ctx, prepared)` call of that evaluation. It is never kept
 * between evaluations, so a rule that reads the board sees the board as it is
 * now, not as it was when an earlier evaluation prepared.
 */
import { describe, it, expect, expectTypeOf } from 'vitest';
import {
  Game,
  Player,
  Piece,
  Space,
  Action,
  defineFlow,
  actionStep,
  enumerateLegalMoves,
  type GameOptions,
} from '../index.js';
import { GameRunner } from '../../runtime/runner.js';

class Marker extends Piece<FieldGame> {}
class Field extends Space<FieldGame> {}

const SPACES = Array.from({ length: 1000 }, (_, i) => `s${i}`);
const OCCUPIED = 'Something already stands there.';

/**
 * One chooseFrom over 1,000 spaces, one chooseElement and one chooseElements
 * over markers, each with a `prepare` that reads the board and a `disabled`
 * that only looks the choice up in what `prepare` built.
 */
class FieldGame extends Game<FieldGame, Player> {
  field!: Field;
  prepareCalls = 0;
  disabledCalls = 0;

  constructor(options: GameOptions) {
    super(options);
    this.field = this.create(Field, 'field');
    for (const name of ['s1', 's2']) this.field.create(Marker, name);

    this.registerAction(
      Action.create<FieldGame>('place')
        .chooseFrom('space', {
          choices: () => SPACES,
          prepare: (ctx) => {
            ctx.game.prepareCalls++;
            return new Set(ctx.game.field.all(Marker).map((m) => m.name));
          },
          disabled: (space, ctx, occupied) => {
            ctx.game.disabledCalls++;
            return occupied.has(space) ? OCCUPIED : false;
          },
        })
        .execute((args, ctx) => {
          ctx.game.field.create(Marker, args.space);
          return { success: true };
        }),
    );

    this.registerAction(
      Action.create<FieldGame>('lift')
        .chooseElement('marker', {
          elementClass: Marker,
          prepare: (ctx) => ctx.game.field.all(Marker).length,
          disabled: (marker, _ctx, count) => (count < 3 && marker.name === 's1' ? 'Keep s1 while the field is small.' : false),
        })
        .chooseElements('others', {
          elements: (ctx) => [...ctx.game.field.all(Marker)],
          prepare: (ctx) => ({ picked: (ctx.args.marker as Marker).name }),
          disabled: (marker, _ctx, { picked }) => (marker.name === picked ? 'Already lifting that one.' : false),
          multiSelect: { min: 1, max: 1 },
        })
        .execute(() => ({ success: true })),
    );

    this.setFlow(
      defineFlow({
        root: actionStep({
          actions: ['place', 'lift'],
          player: (ctx) => ctx.game.getPlayer(1)!,
          repeatUntil: () => false,
          maxMoves: 10,
        }),
      }),
    );
  }
}

function runner() {
  const r = new GameRunner({ GameClass: FieldGame, gameType: 'field', gameOptions: { playerCount: 1, seed: 'bs334' } });
  r.start();
  return r;
}

/** A started game whose prepare/disabled counters start at zero now, not at genesis. */
function countedGame() {
  const r = runner();
  const game = r.game;
  game.prepareCalls = 0;
  game.disabledCalls = 0;
  return { r, game };
}

describe('prepare: per-evaluation shared work for a per-choice disabled rule (#334)', () => {
  it('runs prepare once per evaluation, never once per choice', () => {
    const { game } = countedGame();
    const executor = game.getActionExecutor();
    const selection = game.getAction('place')!.selections[0];

    const choices = executor.getChoices(selection, game.getPlayer(1)!, {});

    expect(game.prepareCalls).toBe(1);
    expect(game.disabledCalls).toBe(SPACES.length);
    expect(choices.filter((c) => c.disabled !== false).map((c) => c.value)).toEqual(['s1', 's2']);
    expect(choices.find((c) => c.value === 's1')!.disabled).toBe(OCCUPIED);
  });

  it('is never cached across a change of state: the next evaluation sees the new board', () => {
    const r = runner();
    expect(r.performAction('place', 1, { space: 's500' }).error).toBeUndefined();

    const refused = r.performAction('place', 1, { space: 's500' });
    expect(refused.success).toBe(false);
    expect(refused.error).toContain(OCCUPIED);

    const offered = enumerateLegalMoves(r.game, 1).filter((m) => m.action === 'place').map((m) => m.args.space);
    expect(offered).toHaveLength(SPACES.length - 3);
    expect(offered).not.toContain('s500');
  });

  it('chooseElement and chooseElements hand their own prepared value to disabled, with the earlier picks in ctx', () => {
    const r = runner();
    const game = r.game;
    const s1 = game.field.first(Marker, 's1')!;
    const s2 = game.field.first(Marker, 's2')!;

    const lifted = r.performAction('lift', 1, { marker: s1.id, others: [s2.id] });
    expect(lifted.success).toBe(false);
    expect(lifted.error).toContain('Keep s1 while the field is small.');

    const same = r.performAction('lift', 1, { marker: s2.id, others: [s2.id] });
    expect(same.success).toBe(false);
    expect(same.error).toContain('Already lifting that one.');

    expect(r.performAction('lift', 1, { marker: s2.id, others: [s1.id] }).error).toBeUndefined();
  });

  it('types disabled\'s third argument as what prepare returns', () => {
    Action.create('typed')
      .chooseFrom('space', {
        choices: ['a', 'b'],
        prepare: () => new Map<string, number>(),
        disabled: (space, _ctx, costs) => {
          expectTypeOf(space).toEqualTypeOf<string>();
          expectTypeOf(costs).toEqualTypeOf<Map<string, number>>();
          return false;
        },
      })
      .chooseElement('marker', {
        elementClass: Marker,
        prepare: () => 3,
        disabled: (marker, _ctx, limit) => {
          expectTypeOf(marker).toEqualTypeOf<Marker>();
          expectTypeOf(limit).toEqualTypeOf<number>();
          return false;
        },
      })
      .chooseElements('markers', {
        elements: [] as Marker[],
        prepare: () => 'x' as const,
        disabled: (_marker, _ctx, tag) => {
          expectTypeOf(tag).toEqualTypeOf<'x'>();
          return false;
        },
      });
  });

  it('refuses a prepare with no disabled rule to hand it to, where the action is declared', () => {
    expect(() =>
      Action.create('pointless').chooseFrom('space', { choices: ['a'], prepare: () => 1 }),
    ).toThrow(/chooseFrom\('space'\) declares prepare but no disabled rule/);
    expect(() =>
      Action.create('pointless').chooseElement('marker', { elementClass: Marker, prepare: () => 1 }),
    ).toThrow(/chooseElement\('marker'\) declares prepare but no disabled rule/);
    expect(() =>
      Action.create('pointless').chooseElements('markers', { elements: [], prepare: () => 1 }),
    ).toThrow(/chooseElements\('markers'\) declares prepare but no disabled rule/);
  });
});

describe('mapping a submitted value does not judge the candidates (#364)', () => {
  it('resolveArgs and resolveSelectionValue run no disabled rule and no prepare', () => {
    const { game } = countedGame();
    const executor = game.getActionExecutor();
    const action = game.getAction('place')!;
    const player = game.getPlayer(1)!;

    expect(executor.resolveArgs(action, { space: 's7' }, player)).toEqual({ space: 's7' });
    expect(executor.resolveSelectionValue(action.selections[0], 's7', player)).toBe('s7');

    expect({ prepareCalls: game.prepareCalls, disabledCalls: game.disabledCalls }).toEqual({
      prepareCalls: 0,
      disabledCalls: 0,
    });
  });

  it('a whole move judges the candidates only where a verdict is needed', () => {
    const { r, game } = countedGame();
    expect(r.performAction('place', 1, { space: 's500' }).error).toBeUndefined();

    // Validating the submission, the next step's availability, and the
    // player view's disabled actions: three evaluations, each one prepare and
    // one disabled call per choice. Mapping the value adds none.
    expect(game.prepareCalls).toBe(3);
    expect(game.disabledCalls).toBe(3 * SPACES.length);
  });
});
