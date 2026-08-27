/**
 * Issue #140: every selection builder typed its `prompt` option as `string`,
 * even though `BaseSelection.prompt` is `string | ((ctx) => string)` and
 * `buildPickMetadata` has always evaluated the function form. A dynamic,
 * per-position prompt therefore worked at runtime but was rejected by the
 * compiler, and the path of least resistance was a static prompt (or a cast).
 *
 * The TYPE guarantee below is enforced by `tsc`: every `.prompt: (ctx) => ...`
 * in this file is a compile error until the builder's option type matches the
 * selection type. The RUNTIME assertions prove `buildPickMetadata` really does
 * evaluate each one against live game state.
 */
import { describe, it, expect } from 'vitest';
import { Game, Piece, Space, Player, Action } from '../index.js';
import type { GameOptions } from '../index.js';
import { buildPickMetadata } from '../element/action-metadata.js';
import type { Selection } from './types.js';

class Token extends Piece<PromptGame> {}

class PromptGame extends Game<PromptGame, Player> {
  board!: Space<PromptGame>;
  round = 3;

  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Token]);
    this.board = this.create(Space<PromptGame>, 'board');
    this.board.create(Token, 'token-a');

    this.registerAction(
      Action.create<PromptGame>('dynamic')
        .chooseFrom('flavor', {
          prompt: (ctx) => `Pick a flavor for round ${ctx.game.round}`,
          choices: ['vanilla', 'mint'],
        })
        .chooseElement('token', {
          prompt: (ctx) => `Pick a token for round ${ctx.game.round}`,
          elementClass: Token,
        })
        .chooseElements('tokens', {
          prompt: (ctx) => `Pick tokens for round ${ctx.game.round}`,
          elements: (ctx) => ctx.game.all(Token),
        })
        .enterText('note', {
          prompt: (ctx) => `Name round ${ctx.game.round}`,
        })
        .enterNumber('bid', {
          prompt: (ctx) => `Bid for round ${ctx.game.round}`,
          min: 0,
          max: 10,
        })
        .execute(() => ({ success: true })),
    );
  }
}

function selectionsOf(game: PromptGame): Selection[] {
  const def = game.getAction('dynamic');
  if (!def) throw new Error('action "dynamic" was not registered');
  return def.selections;
}

describe('dynamic selection prompts (#140)', () => {
  it('accepts and evaluates a function prompt on every selection builder', () => {
    const game = new PromptGame({ playerCount: 1, playerNames: ['Solo'] });
    const player = game.getPlayer(1)!;

    const prompts = selectionsOf(game).map(
      (selection) => buildPickMetadata(game, player, selection).prompt,
    );

    expect(prompts).toEqual([
      'Pick a flavor for round 3',
      'Pick a token for round 3',
      'Pick tokens for round 3',
      'Name round 3',
      'Bid for round 3',
    ]);
  });

  it('re-evaluates against current state rather than freezing at build time', () => {
    const game = new PromptGame({ playerCount: 1, playerNames: ['Solo'] });
    const player = game.getPlayer(1)!;
    game.round = 7;

    const first = selectionsOf(game)[0]!;
    expect(buildPickMetadata(game, player, first).prompt).toBe('Pick a flavor for round 7');
  });

  it('still accepts a plain string prompt', () => {
    const game = new PromptGame({ playerCount: 1, playerNames: ['Solo'] });
    const player = game.getPlayer(1)!;

    const staticSelection = Action.create<PromptGame>('static')
      .chooseFrom('flavor', { prompt: 'Pick a flavor', choices: ['vanilla'] })
      .execute(() => ({ success: true })).selections[0]!;

    expect(buildPickMetadata(game, player, staticSelection).prompt).toBe('Pick a flavor');
  });
});
