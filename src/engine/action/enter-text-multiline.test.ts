/**
 * MULTILINE IS A PROPERTY OF A TEXT SELECTION, NOT A SIXTH SELECTION KIND (#229).
 *
 * A game asking for a 1,000 character empire description and a game asking for
 * a 20 character nickname are asking for the SAME THING: one string, bounded by
 * `minLength`/`maxLength`, admitted by `pattern`, checked by `validate`. The
 * only difference is how much room the player needs to write it in. So the
 * declaration carries `multiline` on `enterText` and the wire carries it on the
 * `text` pick, and every rule in the engine stays exactly one rule.
 *
 * A `type: 'longText'` would have forked all of it: a sixth member of the
 * selection union means a sixth branch in the engine's own validation, in
 * `buildPickMetadata`, in the bot's enumeration and in every host that switches
 * on `type` to decide what to draw -- and the rules it would carry are
 * character-for-character the ones `text` already has. That is the fork the
 * ticket says not to make.
 *
 * These tests hold the whole propagation path, because a flag that survives the
 * builder and dies at the wire is indistinguishable from one that was never
 * added: the panel is the only thing that reads it.
 */
import { describe, it, expect } from 'vitest';

import { Action } from './action.js';
import { buildPickMetadata } from '../element/action-metadata.js';
import { Game } from '../element/game.js';
import { Player } from '../player/player.js';
import type { Selection, TextSelection } from './types.js';

class MultilinePlayer extends Player<any, any> {}

class MultilineGame extends Game<any, any> {
  static PlayerClass = MultilinePlayer;
}

function fixture(): { game: MultilineGame; player: MultilinePlayer } {
  const game = new MultilineGame({
    playerCount: 2,
    playerNames: ['Alice', 'Bob'],
    seed: 'enter-text-multiline',
  } as any);
  return { game, player: game.players[0] as MultilinePlayer };
}

/** The sole selection an action declared, read off its finished definition. */
function textSelectionOf(definition: { selections: Selection[] }): TextSelection {
  const selection = definition.selections[0]!;
  expect(selection.type).toBe('text');
  return selection as TextSelection;
}

describe('enterText({ multiline })', () => {
  it('records the request on the text selection', () => {
    const action = Action.create<any>('setDescription')
      .enterText('description', {
        prompt: 'Empire description',
        maxLength: 1000,
        multiline: true,
      })
      .execute(() => ({ success: true }));
    expect(textSelectionOf(action).multiline).toBe(true);
  });

  it('leaves it absent when the game did not ask for it', () => {
    // Absent rather than `false`, so an untouched declaration adds no field to
    // the wire and every existing game's payload stays byte-identical.
    const action = Action.create<any>('setNickname')
      .enterText('nickname', { maxLength: 20 })
      .execute(() => ({ success: true }));
    expect(textSelectionOf(action).multiline).toBeUndefined();
  });

  it('reaches the pick metadata a host serializes', () => {
    const { game, player } = fixture();
    const action = Action.create<any>('setDescription')
      .enterText('description', {
        prompt: 'Empire description',
        minLength: 10,
        maxLength: 1000,
        multiline: true,
      })
      .execute(() => ({ success: true }));
    const pick = buildPickMetadata(game as any, player as any, textSelectionOf(action));
    expect(pick).toMatchObject({
      name: 'description',
      type: 'text',
      prompt: 'Empire description',
      minLength: 10,
      maxLength: 1000,
      multiline: true,
    });
    // JSON is what a host actually ships. A flag that only exists on the object
    // the engine returned would never reach a panel in a browser.
    expect(JSON.parse(JSON.stringify(pick)).multiline).toBe(true);
  });

  it('omits it from the pick metadata of a single-line field', () => {
    const { game, player } = fixture();
    const action = Action.create<any>('setNickname')
      .enterText('nickname', { maxLength: 20 })
      .execute(() => ({ success: true }));
    const pick = buildPickMetadata(game as any, player as any, textSelectionOf(action));
    expect('multiline' in pick).toBe(false);
  });

  it('changes no rule: the same length bounds still apply', () => {
    // The point of the option being an option. A multiline field is bounded by
    // the same `maxLength` the engine has always enforced, and the ticket's own
    // wording -- "enforce the existing length and validation rules" -- is only
    // true if there is nothing here to enforce separately.
    const action = Action.create<any>('setDescription')
      .enterText('description', { minLength: 5, maxLength: 12, multiline: true })
      .execute(() => ({ success: true }));
    const selection = textSelectionOf(action);
    const { game, player } = fixture();
    const executor = game.getActionExecutor();

    const short = executor.validateSelection(selection, 'four', player as any, {});
    expect(short.valid).toBe(false);
    expect(short.errors.join(' ')).toContain('at least 5 characters');

    const long = executor.validateSelection(selection, 'far too long to fit', player as any, {});
    expect(long.valid).toBe(false);
    expect(long.errors.join(' ')).toContain('at most 12 characters');
  });

  it('admits line breaks, which is the whole reason the option exists', () => {
    // A newline is an ordinary character to every rule the engine has: it
    // counts toward the length and it is not stripped. If validation ever
    // started normalising it, a two-paragraph description would arrive as one.
    const action = Action.create<any>('setDescription')
      .enterText('description', { minLength: 1, maxLength: 100, multiline: true })
      .execute(() => ({ success: true }));
    const { game, player } = fixture();
    const value = 'First line.\nSecond line.\n\nFourth line.';
    const result = game
      .getActionExecutor()
      .validateSelection(textSelectionOf(action), value, player as any, {});
    expect(result.valid).toBe(true);
    expect(value).toHaveLength(38);
  });
});
