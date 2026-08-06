/**
 * `game.messageTo()` — a per-seat log channel, enforced on the SERVER.
 *
 * The requirement it exists for: an RPG where a character perceives something
 * the other players must not learn. The shell's log itself is always rendered
 * and cannot be turned off by a game, so the only sound way to keep a fact
 * private is for the unaddressed seat's payload never to contain it.
 *
 * That makes the leak paths the real subject here, not the happy path. A seat's
 * state reaches the client through TWO independent routes, and BOTH carried
 * every message before this existed:
 *
 *   1. `toJSONForPlayer()` — `messages` rides in from `toJSON()` on the game
 *      ROOT, which is visible to every player, so the element-visibility pass
 *      never touched it.
 *   2. `getFormattedMessages()` via `createPlayerView` → `PlayerGameState`.
 *
 * If either regresses, a UI that "hides" the message is hiding data the wrong
 * player's browser already holds — strictly worse than not offering the feature.
 * So these tests assert absence from the payload, never absence from the render.
 */
import { describe, it, expect } from 'vitest';
import { Game, Player, Space } from '../index.js';
import { createPlayerView } from '../utils/snapshot.js';

class LogGame extends Game<LogGame, Player> {
  board!: Space<LogGame>;
  setupBoard(): void {
    this.board = this.create(Space<LogGame>, 'board');
  }
}

function newGame(playerCount = 3): LogGame {
  const game = new LogGame({ playerCount, seed: 'message-audience' });
  game.setupBoard();
  return game;
}

/** Raw message texts in the payload a given seat actually receives. */
const payloadMessages = (game: LogGame, seat: number | null): string[] =>
  ((game.toJSONForPlayer(seat) as { messages?: Array<{ text: string }> }).messages ?? []).map(
    (m) => m.text,
  );

describe('messageTo: what each seat receives', () => {
  it('gives a public message() to every seat and to the spectator', () => {
    const game = newGame();
    game.message('The round begins');

    expect(payloadMessages(game, 0)).toEqual(['The round begins']);
    expect(payloadMessages(game, 1)).toEqual(['The round begins']);
    expect(payloadMessages(game, null)).toEqual(['The round begins']);
  });

  it('withholds a private message from every seat but the addressed one', () => {
    const game = newGame();
    game.message('The round begins');
    game.messageTo(1, 'You hear footsteps to the north.');

    expect(payloadMessages(game, 1)).toEqual([
      'The round begins',
      'You hear footsteps to the north.',
    ]);
    // The unaddressed seats must not merely fail to RENDER it — they must not
    // have it. This is the assertion the whole feature rests on.
    expect(payloadMessages(game, 0)).toEqual(['The round begins']);
    expect(payloadMessages(game, 2)).toEqual(['The round begins']);
  });

  it('withholds private messages from a spectator, who has no seat', () => {
    const game = newGame();
    game.messageTo(0, 'Only seat 0 knows this');
    expect(payloadMessages(game, null)).toEqual([]);
  });

  it('addresses several seats at once, and only those', () => {
    const game = newGame();
    game.messageTo([0, 2], 'A private exchange');

    expect(payloadMessages(game, 0)).toEqual(['A private exchange']);
    expect(payloadMessages(game, 2)).toEqual(['A private exchange']);
    expect(payloadMessages(game, 1)).toEqual([]);
  });

  it('accepts Player objects as the audience, not just seat numbers', () => {
    const game = newGame();
    const players = game.all(Player as never) as Player[];
    game.messageTo(players[1], 'To the second seat');

    expect(payloadMessages(game, players[1].seat)).toEqual(['To the second seat']);
    expect(payloadMessages(game, players[0].seat)).toEqual([]);
  });

  it('substitutes {{placeholders}} in a private message like a public one', () => {
    const game = newGame();
    const players = game.all(Player as never) as Player[];
    game.messageTo(players[0], '{{thief}} lifts your purse', { thief: players[1] });

    expect(game.getFormattedMessages(players[0].seat)).toEqual([
      `${players[1].name ?? `Player ${players[1].seat}`} lifts your purse`,
    ]);
  });
});

describe('messageTo: the second payload path (createPlayerView)', () => {
  // buildPlayerState feeds GameShell's log from here, so a filter applied only
  // in toJSONForPlayer would still ship the secret down this route.
  it('scopes createPlayerView messages to the receiving seat', () => {
    const game = newGame();
    game.message('Public line');
    game.messageTo(2, 'Private line');

    const texts = (seat: number) => createPlayerView(game, seat).messages.map((m) => m.text);
    expect(texts(2)).toEqual(['Public line', 'Private line']);
    expect(texts(0)).toEqual(['Public line']);
  });
});

describe('messageTo: the log itself stays whole', () => {
  it('keeps every message in game.messages, unfiltered', () => {
    // Checkpoints and undo restore from this array. Filtering it would destroy
    // other seats' history on the next restore.
    const game = newGame();
    game.message('Public');
    game.messageTo(1, 'Private');

    expect(game.messages.map((m) => m.text)).toEqual(['Public', 'Private']);
    expect(game.messages[1].to).toEqual([1]);
    expect(game.messages[0].to).toBeUndefined();
  });

  it('survives a toJSON round-trip with its audience intact', () => {
    const game = newGame();
    game.messageTo(1, 'Private');

    const restored = newGame();
    restored.loadSerializedState(JSON.parse(JSON.stringify(game.toJSON())));

    expect(restored.messages[0].to).toEqual([1]);
    expect(payloadMessages(restored as LogGame, 0)).toEqual([]);
    expect(payloadMessages(restored as LogGame, 1)).toEqual(['Private']);
  });
});

describe('messageTo: refuses an audience nobody is in', () => {
  it('throws on an empty audience rather than writing an unreadable message', () => {
    const game = newGame();
    expect(() => game.messageTo([], 'Nobody sees this')).toThrow(/empty audience/i);
    expect(game.messages).toHaveLength(0);
  });

  it('throws on a non-seat value, naming the offending input', () => {
    const game = newGame();
    expect(() => game.messageTo(-1, 'Bad seat')).toThrow(/invalid seat/i);
    expect(() => game.messageTo(1.5, 'Bad seat')).toThrow(/invalid seat/i);
    expect(game.messages).toHaveLength(0);
  });
});
