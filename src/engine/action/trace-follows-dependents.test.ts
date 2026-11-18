/**
 * BOARDSMITH #1690: the availability trace walks the same path availability
 * does, so it names the step availability actually dropped the action for, and
 * counts only the choices availability counts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Game, Player, Action, Piece } from '../index.js';
import { _clearShownWarnings } from '../../utils/dev.js';

class Token extends Piece {}

describe('the availability trace follows declared dependents (#1690)', () => {
  let game: Game;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    game = new Game({ playerCount: 1 });
    game.create(Token, 'pawn');
    _clearShownWarnings();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('blames a required dependent step that no first answer satisfies', () => {
    game.registerAction(
      Action.create('move')
        .chooseElement('piece', { elements: () => [...game.all(Token)] })
        .chooseElement('dest', { dependsOn: 'piece', elements: () => [] })
        .execute(() => {}),
    );
    const debug = game.debugActionAvailability('move', game.getPlayer(1)!);

    expect(debug.available).toBe(false);
    expect(debug.details.selections.map((s) => [s.name, s.passed])).toEqual([['piece', true], ['dest', false]]);
    expect(debug.reason).toBe("Selection 'dest' has no valid choices (Depends on 'piece' - no valid combinations found)");
  });

  it('still leaves an undeclared later step unasked', () => {
    game.registerAction(
      Action.create('equip')
        .chooseFrom('slot', { choices: ['head'] })
        .chooseFrom('item', { choices: () => [] as string[] })
        .execute(() => {}),
    );
    const trace = game.getActionExecutor().traceActionAvailability(game.getAction('equip')!, game.getPlayer(1)!);

    expect(trace.available).toBe(true);
    expect(trace.selections[1].notYetAskable).toBe(true);
  });

  it('counts only enabled choices', () => {
    game.registerAction(
      Action.create('pick')
        .chooseFrom('n', { choices: [1, 2, 3], disabled: (n) => (n === 2 ? 'taken' : false) })
        .execute(() => {}),
    );
    const trace = game.getActionExecutor().traceActionAvailability(game.getAction('pick')!, game.getPlayer(1)!);

    expect(trace.selections[0].choiceCount).toBe(2);
  });

  it('marks an optional text step as free input', () => {
    game.registerAction(Action.create('name').enterText('title', { optional: true }).execute(() => {}));
    const trace = game.getActionExecutor().traceActionAvailability(game.getAction('name')!, game.getPlayer(1)!);

    expect(trace.selections[0].choiceCount).toBe(-1);
  });

  it('passes a min-0 list pick with nothing enabled, as availability does', () => {
    game.registerAction(
      Action.create('hire')
        .chooseFrom('picked', { choices: ['A'], disabled: () => 'not allowed', multiSelect: { min: 0, max: 1 } })
        .execute(() => {}),
    );
    const debug = game.debugActionAvailability('hire', game.getPlayer(1)!);

    expect(debug.available).toBe(true);
    expect(debug.details.selections[0].passed).toBe(true);
  });
});
