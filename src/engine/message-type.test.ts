/**
 * A game can classify its own log lines (#21).
 *
 * `GameHistory.vue` has always modelled a per-entry `type` and styled one of
 * them distinctly, but nothing a game wrote could reach it: `message()` and
 * `messageTo()` took no type, `MessageEntry` had no field for one, and
 * `createPlayerView` flattened the log to `{ text }`. So the typed branch was
 * dead code from an author's point of view, and "you died" rendered exactly
 * like "you got a bit hungrier".
 *
 * The type is an open string, not a fixed union: the games that need this have
 * their own taxonomies (notice / alert / event / advancement / shout / mail),
 * recorded as rules rather than decoration.
 */
import { describe, it, expect } from 'vitest';
import { Game, Player, createPlayerView, type GameOptions } from './index.js';

class LogGame extends Game<LogGame, Player> {
  constructor(options: GameOptions) {
    super(options);
  }
}

const makeGame = () => new LogGame({ playerCount: 2, playerNames: ['A', 'B'], seed: 'log' });

describe('message() carries a type', () => {
  it('records the type the game gave it', () => {
    const game = makeGame();
    game.message('The day leaves you 4 hungrier.', undefined, { type: 'notice' });
    game.message('You do not get up again.', undefined, { type: 'alert' });

    expect(game.messages.map((m) => m.type)).toEqual(['notice', 'alert']);
  });

  it('leaves the type absent when the game does not classify', () => {
    const game = makeGame();
    game.message('Round 4.');
    expect(game.messages[0].type).toBeUndefined();
  });

  it('still substitutes template data alongside a type', () => {
    const game = makeGame();
    game.message('{{who}} falls.', { who: game.getPlayer(1)! }, { type: 'alert' });
    const [entry] = game.getFormattedMessageEntries(1);
    expect(entry.text).toBe('A falls.');
    expect(entry.type).toBe('alert');
  });
});

describe('messageTo() carries a type too, without weakening its audience', () => {
  it('keeps both the audience and the type', () => {
    const game = makeGame();
    game.messageTo(1, 'Poison burns.', undefined, { type: 'alert' });

    expect(game.getFormattedMessageEntries(1)).toEqual([{ text: 'Poison burns.', type: 'alert' }]);
    // Seat 2 is not the audience — the type does not smuggle it through.
    expect(game.getFormattedMessageEntries(2)).toEqual([]);
    // Nor does the spectator see it.
    expect(game.getFormattedMessageEntries(null)).toEqual([]);
  });

  it('still refuses an empty audience', () => {
    const game = makeGame();
    expect(() => game.messageTo([], 'nobody', undefined, { type: 'alert' })).toThrow(/empty audience/);
  });
});

describe('the type survives the trip to the client', () => {
  it('reaches the player view, which is what GameHistory renders', () => {
    const game = makeGame();
    game.message('Round 4.', undefined, { type: 'notice' });
    game.messageTo(1, 'You do not get up again.', undefined, { type: 'alert' });

    const view = createPlayerView(game, 1);
    expect(view.messages).toEqual([
      { text: 'Round 4.', type: 'notice' },
      { text: 'You do not get up again.', type: 'alert' },
    ]);
  });

  it('omits the field entirely for an unclassified line, rather than inventing one', () => {
    const game = makeGame();
    game.message('Round 4.');
    expect(createPlayerView(game, 1).messages).toEqual([{ text: 'Round 4.' }]);
  });

  it('withholds another seat\'s line from the view whatever its type', () => {
    const game = makeGame();
    game.messageTo(2, 'Only for seat two.', undefined, { type: 'alert' });
    expect(createPlayerView(game, 1).messages).toEqual([]);
  });
});

describe('getFormattedMessages stays the plain-text reading', () => {
  it('still returns strings, so existing callers are unaffected', () => {
    const game = makeGame();
    game.message('Round 4.', undefined, { type: 'notice' });
    expect(game.getFormattedMessages(1)).toEqual(['Round 4.']);
  });
});
