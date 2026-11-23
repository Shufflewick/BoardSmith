/**
 * `confirm: true` asks a fixed-count multiSelect to wait for Done (#1789). On
 * any other count Done is drawn anyway, so it would do nothing: it is refused,
 * naming the pick, rather than silently ignored.
 */
import { describe, it, expect } from 'vitest';
import { Game, Player, Action, actionStep, type GameOptions } from '../index.js';
import type { MultiSelectConfig } from '../action/types.js';
import { buildActionMetadata } from './action-metadata.js';

function metadataFor(multiSelect: MultiSelectConfig) {
  class ConfirmGame extends Game<ConfirmGame, Player> {
    constructor(options: GameOptions) {
      super(options);
      this.registerAction(
        Action.create<ConfirmGame>('discard')
          .chooseFrom('cards', { choices: ['a', 'b', 'c'], multiSelect })
          .execute(() => ({ success: true })),
      );
      this.setFlow({ root: actionStep({ actions: ['discard'], player: (ctx) => ctx.game.getPlayer(1)! }) });
    }
  }
  const game = new ConfirmGame({ playerCount: 2, seed: 'bs1789' });
  game.startFlow();
  return () => buildActionMetadata(game, game.getPlayer(1)!, ['discard']).discard!.selections[0]!.multiSelect;
}

describe('multiSelect confirm (#1789)', () => {
  it('reaches the seat on a fixed count', () => {
    expect(metadataFor({ min: 2, max: 2, confirm: true })()).toEqual({ min: 2, max: 2, confirm: true });
  });

  it.each([
    { min: 1, max: 3, confirm: true },
    { min: 0, max: 0, confirm: true },
    { min: 2, confirm: true },
  ])('is refused on a count that already draws Done: %o', (multiSelect) => {
    expect(metadataFor(multiSelect)).toThrow(/Selection "cards": multiSelect confirm: true only applies to a fixed count above 0/);
  });
});
