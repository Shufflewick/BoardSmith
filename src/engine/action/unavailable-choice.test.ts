/**
 * #393: A CHOICE THAT IS NO LONGER LISTED IS REFUSED IN WORDS FOR THE PLAYER.
 *
 * In a world, choices go stale constantly: someone else took the offer, the
 * auction settled, a second tab acted first. The engine used to refuse the
 * submission with its own text --
 *
 *   Invalid selection for "accept": "yes:33". Valid choices: ["yes:31","no:31"]
 *
 * -- and the host showed that to the player, raw ids and all. A selection's
 * `validate` runs only after the membership check and `disabled` only covers
 * values still listed, so a game had no way to say it better.
 *
 * Now the player reads a plain sentence that says what happened and what to do,
 * a game can write its own with `unavailable`, and the engine's detailed text
 * goes to the dev log, where the author reads it.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Game, Player, Piece, Space, Action } from '../index.js';
import { ActionExecutor } from './action.js';
import type { ActionContext } from '../index.js';
import { withDevLog } from './dev-log.test-helper.js';

const NO_LONGER_AVAILABLE =
  'That choice is no longer available. Things changed while you were choosing, so please choose again.';

class Offer extends Piece<Tavern> {}
class Bar extends Space<Tavern> {}

class Tavern extends Game<Tavern, Player> {
  /** Offer ids still open; a test closes one to make a submission stale. */
  open = ['yes:31', 'no:31'];
  bar!: Bar;
  accepted: unknown[] = [];
  constructor() {
    super({ playerCount: 2 });
    this.bar = this.create(Bar, 'bar');
    this.bar.create(Offer, 'ale');
    this.bar.create(Offer, 'mead');
  }
}

const offerIds = (ctx: ActionContext) => (ctx.game as Tavern).open;

describe('a submitted choice that is no longer listed (#393)', () => {
  let game: Tavern;

  beforeEach(() => {
    game = new Tavern();
  });

  it('tells the player in plain words, and keeps the engine detail in the dev log', () => {
    game.registerAction(Action.create('accept').chooseFrom('accept', { choices: offerIds }).execute(() => {}));

    const { result, log } = withDevLog(() => game.performAction('accept', game.getPlayer(1)!, { accept: 'yes:33' }));

    expect(result.success).toBe(false);
    expect(result.error).toBe(NO_LONGER_AVAILABLE);
    expect(log).toMatch(/"accept".*"yes:33".*yes:31/s);
  });

  it("uses the game's own sentence when the pick declares `unavailable`", () => {
    const seen: unknown[] = [];
    game.registerAction(
      Action.create('accept')
        .chooseFrom('accept', {
          choices: offerIds,
          unavailable: (value, ctx) => {
            seen.push(value, ctx.player.seat);
            return 'Someone else took that offer. The barkeep has others.';
          },
        })
        .execute(() => {}),
    );

    const result = game.performAction('accept', game.getPlayer(1)!, { accept: 'yes:33' });

    expect(result.error).toBe('Someone else took that offer. The barkeep has others.');
    expect(seen).toEqual(['yes:33', 1]);
  });

  it('still gives a listed but disabled choice its disabled reason', () => {
    game.registerAction(
      Action.create('accept')
        .chooseFrom('accept', {
          choices: offerIds,
          disabled: (choice) => (choice === 'no:31' ? 'You cannot refuse the barkeep.' : false),
          unavailable: () => 'unused',
        })
        .execute(() => {}),
    );

    const result = game.performAction('accept', game.getPlayer(1)!, { accept: 'no:31' });
    expect(result.error).toContain('You cannot refuse the barkeep.');
  });

  it('says it once for a multiSelect with several stale values', () => {
    game.registerAction(
      Action.create('accept').chooseFrom('accept', { choices: offerIds, multiSelect: 3 }).execute(() => {}),
    );

    const result = game.performAction('accept', game.getPlayer(1)!, { accept: ['yes:31', 'yes:40', 'yes:41'] });
    expect(result.error).toBe(NO_LONGER_AVAILABLE);
  });

  it.each([
    ['an element no longer offered', 'the element', (mead: Offer) => mead.id, (mead: Offer) => mead],
    ['an element that no longer exists', 'the id sent', () => 99_999, () => 99_999],
  ])('refuses %s, handing `unavailable` %s', (_what, _handed, submit, expected) => {
    const [ale, mead] = game.bar.all(Offer);
    const seen: unknown[] = [];
    game.registerAction(
      Action.create('drink')
        .chooseElement('drink', {
          elements: () => [ale!],
          unavailable: (value) => {
            seen.push(value);
            return 'That drink is gone.';
          },
        })
        .execute(() => {}),
    );

    const result = game.performAction('drink', game.getPlayer(1)!, { drink: submit(mead!) });
    expect(result.error).toBe('That drink is gone.');
    expect(seen).toEqual([expected(mead!)]);
  });

  it('refuses stale elements in a chooseElements in plain words', () => {
    const [ale, mead] = game.bar.all(Offer);
    game.registerAction(
      Action.create('drinks').chooseElements('drinks', { elements: () => [ale!] }).execute(() => {}),
    );

    const { result, log } = withDevLog(() =>
      game.performAction('drinks', game.getPlayer(1)!, { drinks: [mead!.id, 99_999] }),
    );
    expect(result.error).toBe(NO_LONGER_AVAILABLE);
    expect(log).toMatch(/"drinks"/);
  });

  it('refuses the same way on the step-by-step path', () => {
    const action = Action.create('accept').chooseFrom('accept', { choices: offerIds }).execute(() => {});
    game.registerAction(action);
    const executor = new ActionExecutor(game);
    const pending = executor.createPendingActionState('accept', 1);

    const step = executor.processSelectionStep(action, game.getPlayer(1)!, pending, 'accept', 'yes:33');
    expect(step).toEqual({ success: false, error: NO_LONGER_AVAILABLE });
  });

  it('fails loud when `unavailable` returns no sentence', () => {
    game.registerAction(
      Action.create('accept')
        .chooseFrom('accept', { choices: offerIds, unavailable: () => '' })
        .execute(() => {}),
    );

    expect(() => game.performAction('accept', game.getPlayer(1)!, { accept: 'yes:33' })).toThrow(
      /unavailable for selection 'accept' of action 'accept' returned an empty string/,
    );
  });
});
