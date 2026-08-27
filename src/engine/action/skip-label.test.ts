/**
 * Issue #152: every selection builder typed its `optional` option as `boolean`,
 * even though `BaseSelection.optional` is `boolean | string`, where the string is
 * the label the Skip button carries and `ActionPanel.vue` renders. A custom Skip
 * label therefore worked at runtime but was rejected by the compiler, and the path
 * of least resistance was `optional: true` (or a cast) with a generic "Skip".
 *
 * This is the same defect class as #140 (dynamic-prompt.test.ts), and the same
 * shape of guarantee: the TYPE guarantee below is enforced by `tsc` because every
 * `optional: '<label>'` in this file is a compile error until the builder's option
 * type matches the selection type. The RUNTIME assertions prove the label survives
 * into the pick metadata the panel reads.
 */
import { describe, it, expect } from 'vitest';
import { Game, Piece, Space, Player, Action } from '../index.js';
import type { GameOptions } from '../index.js';
import { buildPickMetadata } from '../element/action-metadata.js';
import type { Selection } from './types.js';

class Token extends Piece<LabelGame> {}

class LabelGame extends Game<LabelGame, Player> {
  board!: Space<LabelGame>;

  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Token]);
    this.board = this.create(Space<LabelGame>, 'board');
    this.board.create(Token, 'token-a');

    this.registerAction(
      Action.create<LabelGame>('labelled')
        .chooseFrom('flavor', {
          prompt: 'Pick a flavor',
          choices: ['vanilla', 'mint'],
          optional: 'No flavor thanks',
        })
        .chooseElement('token', {
          prompt: 'Pick a token',
          elementClass: Token,
          optional: 'Leave it on the board',
        })
        .chooseElements('tokens', {
          prompt: 'Pick tokens',
          elements: (ctx) => ctx.game.all(Token),
          optional: 'Keep them all',
        })
        .enterText('note', {
          prompt: 'Name it',
          optional: 'Leave it unnamed',
        })
        .enterNumber('bid', {
          prompt: 'Bid',
          min: 0,
          max: 10,
          optional: 'Pass the bid',
        })
        .execute(() => ({ success: true })),
    );
  }
}

function selectionsOf(game: LabelGame): Selection[] {
  const def = game.getAction('labelled');
  if (!def) throw new Error('action "labelled" was not registered');
  return def.selections;
}

describe('custom Skip labels on selection builders (#152)', () => {
  it('carries the label through every selection builder into the pick metadata', () => {
    const game = new LabelGame({ playerCount: 1, playerNames: ['Solo'] });
    const player = game.getPlayer(1)!;

    const labels = selectionsOf(game).map(
      (selection) => buildPickMetadata(game, player, selection).optional,
    );

    expect(labels).toEqual([
      'No flavor thanks',
      'Leave it on the board',
      'Keep them all',
      'Leave it unnamed',
      'Pass the bid',
    ]);
  });

  it('still accepts the plain boolean form', () => {
    const game = new LabelGame({ playerCount: 1, playerNames: ['Solo'] });
    const player = game.getPlayer(1)!;

    const plain = Action.create<LabelGame>('plain')
      .chooseFrom('flavor', { prompt: 'Pick a flavor', choices: ['vanilla'], optional: true })
      .execute(() => ({ success: true })).selections[0]!;

    expect(buildPickMetadata(game, player, plain).optional).toBe(true);
  });
});
