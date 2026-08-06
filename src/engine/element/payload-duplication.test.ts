/**
 * SEC-04: nothing `Game.toJSON()` hoists to the top level may ALSO ride in the
 * generic attribute bag.
 *
 * `GameElement.toJSON()` builds `attributes` from every own enumerable property
 * not listed in `unserializableAttributes`. `Game` then hoists `phase`,
 * `messages` and `settings` to the top level — so without a deliberate strip,
 * each shipped TWICE, and only the top-level copy is ever redacted.
 *
 * For `messages` that was a total defeat of `messageTo`: `toJSONForPlayer`
 * rebuilt the top-level array for the addressed seat while `attributes.messages`
 * carried the full log — every private line, tagged with the audience it was
 * withheld from — to every seat and to the spectator.
 *
 * The lesson that shapes this file: the bug shipped green under a suite that
 * asserted on the `messages` FIELD. Both documented read paths
 * (`toJSONForPlayer().messages`, `getFormattedMessages(seat)`) were correct.
 * Only an assertion over the WHOLE serialized payload catches a second copy
 * somewhere else in the object. So these tests stringify the payload and search
 * it, and the structural test below asserts the invariant rather than the
 * instance — it fails for the NEXT field hoisted to the top level, without
 * anyone remembering to come back here.
 */
import { describe, it, expect } from 'vitest';
import { Game, Player, Space } from '../index.js';
import { GAME_TOP_LEVEL_FIELDS } from './game.js';

class LeakGame extends Game<LeakGame, Player> {
  board!: Space<LeakGame>;
  setupBoard(): void {
    this.board = this.create(Space<LeakGame>, 'board');
  }
}

function newGame(playerCount = 3): LeakGame {
  const game = new LeakGame({ playerCount, seed: 'payload-duplication' });
  game.setupBoard();
  return game;
}

describe('SEC-04: no top-level game field is duplicated into `attributes`', () => {
  it('holds for the game root — the structural invariant, not a field list', () => {
    const game = newGame();
    game.message('public line');
    game.messageTo(1, 'private line');
    game.settings.somethingAuthorish = { nested: true };

    const json = game.toJSON() as unknown as Record<string, unknown> & {
      attributes: Record<string, unknown>;
    };

    const duplicated = Object.keys(json).filter(
      (key) => key !== 'attributes' && key in json.attributes,
    );

    // If this fails, a field was hoisted to the top level of `Game.toJSON()`
    // without being added to GAME_TOP_LEVEL_FIELDS. It is now shipping twice,
    // and the second copy bypasses every redaction pass. Add it to that
    // constant rather than deleting it here.
    expect(duplicated).toEqual([]);
  });

  it('keeps each hoisted field present exactly once, at the top level', () => {
    const game = newGame();
    game.message('public line');

    const json = game.toJSON() as unknown as Record<string, unknown> & {
      attributes: Record<string, unknown>;
    };

    for (const field of GAME_TOP_LEVEL_FIELDS) {
      expect(json[field], `${field} must be hoisted to the top level`).toBeDefined();
      expect(json.attributes[field], `${field} must not also be in attributes`).toBeUndefined();
    }
  });
});

describe('SEC-04: whole-payload leak assertions for messageTo', () => {
  it('withholds a private line from the WHOLE payload of an unaddressed seat', () => {
    const game = newGame();
    game.messageTo(1, 'SECRET-FOR-SEAT-1');
    game.messageTo(2, 'SECRET-FOR-SEAT-2');
    game.message('PUBLIC-LINE');

    // Stringify-and-search, deliberately: a field-level assertion passed
    // throughout the lifetime of the bug this test exists for.
    const seat2 = JSON.stringify(game.toJSONForPlayer(2));

    expect(seat2).not.toContain('SECRET-FOR-SEAT-1');
    expect(seat2).toContain('SECRET-FOR-SEAT-2');
    expect(seat2).toContain('PUBLIC-LINE');
  });

  it('withholds every private line from the WHOLE spectator payload', () => {
    const game = newGame();
    game.messageTo(1, 'SECRET-FOR-SEAT-1');
    game.messageTo(2, 'SECRET-FOR-SEAT-2');
    game.message('PUBLIC-LINE');

    const spectator = JSON.stringify(game.toJSONForPlayer(null));

    expect(spectator).not.toContain('SECRET-FOR-SEAT-1');
    expect(spectator).not.toContain('SECRET-FOR-SEAT-2');
    expect(spectator).toContain('PUBLIC-LINE');
  });

  it('does not leak the AUDIENCE either — an unaddressed seat learns of no withheld line', () => {
    const game = newGame();
    game.messageTo(1, 'SECRET-FOR-SEAT-1');
    game.message('PUBLIC-LINE');

    const seat2 = JSON.parse(JSON.stringify(game.toJSONForPlayer(2))) as {
      messages: Array<{ text: string }>;
    };

    // The leaked copy carried `to: [1]` alongside the text, so a reader learned
    // both the secret AND that it was meant for someone else. Seat 2 should see
    // exactly one line and have no evidence a second one exists.
    expect(seat2.messages.map((m) => m.text)).toEqual(['PUBLIC-LINE']);
  });
});
