import { describe, it, expect, beforeEach } from 'vitest';
import { Game, Player, Piece, type GameOptions } from '../index.js';
import { RedactedAttributeError } from '../errors.js';

// #19, finding 1: a withheld attribute must not restore as its class-field
// default.
//
// `toJSONForPlayer` drops every non-whitelisted attribute of a non-owner, so
// the JSON is right: the key is simply absent. The restore is where it went
// wrong. `loadSerializedState` DISCARDS the constructed tree and rebuilds it
// with `GameElement.fromJSON`, which constructs a fresh instance and assigns
// only the keys the JSON carries. An absent key therefore kept whatever the
// class field was initialized to -- `0`, `[]`, `false` -- and redaction turned
// from "you do not get to know this" into "this is definitely zero".
//
// That clone is not a wire payload. The MCTS bot restores it as a LIVE game
// and computes moves against it (`captureSnapshot` passes `forSeat`), so the
// substituted default is what a bot's rules read.

class SecretPlayer extends Player<TestGame, SecretPlayer> {
  static override visibleAttributes = ['seat', 'name', 'status', 'publicScore'];
  publicScore = 0;
  /** Withheld. `0` is a real sector in the reporting game's map. */
  loc = 0;
  /** Withheld. `[]` is a real (empty) pack. */
  inv: number[] = [];
}

class SecretPiece extends Piece<TestGame> {
  static override visibleAttributes = ['publicField'];
  publicField = 'public';
  charges = 3;
}

class OpenPiece extends Piece<TestGame> {
  // No visibleAttributes: public by default, nothing to withhold.
  tokens = 0;
}

class TestGame extends Game<TestGame, SecretPlayer> {
  static override PlayerClass = SecretPlayer;

  constructor(options: GameOptions) {
    super(options);
    this.registerElements([SecretPiece, OpenPiece]);
  }
}

/** Restore a fresh game from seat `seat`'s redacted view of `game`. */
function restoreForSeat(game: TestGame, seat: number | null): TestGame {
  const restored = new TestGame({ playerCount: 2 });
  restored.loadSerializedState(game.toJSONForPlayer(seat) as ReturnType<Game['toJSON']>);
  return restored;
}

describe('#19 finding 1: a withheld attribute restores as unknown, not as its class default', () => {
  let game: TestGame;

  beforeEach(() => {
    game = new TestGame({ playerCount: 2 });
    game.getPlayer(1)!.loc = 11;
    game.getPlayer(1)!.inv = [7, 2];
    game.getPlayer(2)!.loc = 22;
    game.getPlayer(2)!.inv = [9, 1];
    game.getPlayer(2)!.publicScore = 5;
  });

  it('does not hand back the class default for an opponent\'s withheld attribute', () => {
    const restored = restoreForSeat(game, 1);
    const opponent = restored.getPlayer(2)!;

    expect(opponent.isAttributeRedacted('loc')).toBe(true);
    expect(opponent.isAttributeRedacted('inv')).toBe(true);
    expect(() => opponent.loc).toThrow(RedactedAttributeError);
    expect(() => opponent.inv).toThrow(RedactedAttributeError);
  });

  it('names the attribute, the element and what to do instead', () => {
    const restored = restoreForSeat(game, 1);
    let message = '';
    try {
      void restored.getPlayer(2)!.loc;
    } catch (e) {
      message = (e as Error).message;
    }

    expect(message).toContain('loc');
    expect(message).toContain('SecretPlayer');
    expect(message).toContain('visibleAttributes');
    expect(message).toContain('isAttributeRedacted');
  });

  it('lists the withheld attributes so a game can ask before it reads', () => {
    const restored = restoreForSeat(game, 1);

    expect([...restored.getPlayer(2)!.redactedAttributes].sort()).toEqual(['inv', 'loc']);
    expect(restored.getPlayer(1)!.redactedAttributes).toEqual([]);
  });

  it('leaves the viewing seat\'s own attributes readable and correct', () => {
    const restored = restoreForSeat(game, 1);
    const self = restored.getPlayer(1)!;

    expect(self.loc).toBe(11);
    expect(self.inv).toEqual([7, 2]);
    expect(self.isAttributeRedacted('loc')).toBe(false);
  });

  it('leaves whitelisted attributes of an opponent readable', () => {
    const restored = restoreForSeat(game, 1);
    const opponent = restored.getPlayer(2)!;

    expect(opponent.seat).toBe(2);
    expect(opponent.publicScore).toBe(5);
    expect(opponent.isAttributeRedacted('publicScore')).toBe(false);
  });

  it('applies to any element with visibleAttributes, not just Player', () => {
    const piece = game.create(SecretPiece, 'p1', { charges: 9 });
    piece.player = game.getPlayer(2)!;

    const restored = restoreForSeat(game, 1);
    const restoredPiece = restored.first(SecretPiece, 'p1')!;

    expect(restoredPiece.publicField).toBe('public');
    expect(() => restoredPiece.charges).toThrow(RedactedAttributeError);
  });

  it('gives a spectator the most restrictive view', () => {
    const restored = restoreForSeat(game, null);

    expect(() => restored.getPlayer(1)!.loc).toThrow(RedactedAttributeError);
    expect(() => restored.getPlayer(2)!.loc).toThrow(RedactedAttributeError);
  });

  it('survives re-serialization, which is how an MCTS descendant clone is built', () => {
    // `cloneSearchGame` re-serializes an ALREADY redacted sandbox with plain
    // `toJSON()`. If the redaction did not ride along, the second restore would
    // hand the class default back again one ply into the search.
    const sandbox = restoreForSeat(game, 1);
    const clone = new TestGame({ playerCount: 2 });
    clone.loadSerializedState(sandbox.toJSON());

    expect(clone.getPlayer(2)!.isAttributeRedacted('loc')).toBe(true);
    expect(() => clone.getPlayer(2)!.loc).toThrow(RedactedAttributeError);
    expect(clone.getPlayer(1)!.loc).toBe(11);
  });

  it('never emits a withheld attribute when a redacted game is re-serialized', () => {
    const sandbox = restoreForSeat(game, 1);
    const json = sandbox.toJSON();
    const opponentJson = json.children!.find(
      (c) => c.className === 'SecretPlayer' && c.attributes.seat === 2,
    )!;

    expect(opponentJson.attributes.loc).toBeUndefined();
    expect(opponentJson.attributes.inv).toBeUndefined();
    expect(opponentJson.redacted).toBe(true);
  });

  it('a write makes the attribute known again: the sandbox can move an opponent it learns about', () => {
    const restored = restoreForSeat(game, 1);
    const opponent = restored.getPlayer(2)!;

    opponent.loc = 4;

    expect(opponent.loc).toBe(4);
    expect(opponent.isAttributeRedacted('loc')).toBe(false);
    expect(restored.toJSON().children!.find(
      (c) => c.className === 'SecretPlayer' && c.attributes.seat === 2,
    )!.attributes.loc).toBe(4);
  });

  it('does not redact an element whose class declares no visibleAttributes', () => {
    game.create(OpenPiece, 'open', { tokens: 4 });

    const restored = restoreForSeat(game, 1);

    expect(restored.first(OpenPiece, 'open')!.tokens).toBe(4);
  });
});
