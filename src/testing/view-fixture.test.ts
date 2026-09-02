/**
 * Issue #160: a hand-built view fixture can write a player attribute as
 * `{ seat }` and never be caught.
 *
 * The engine serializes a player-valued attribute as
 * `{ __playerRef, seat, color, name }` — `__playerRef` is what makes it
 * deserializable. Boards typically read only `seat`, so the short form renders
 * identically and the fixture drifts from what production actually sends with
 * nothing failing.
 *
 * These are the two ways out: a builder that writes the real shape, and a
 * check that refuses the short form loudly.
 */
import { describe, it, expect } from 'vitest';
import { Game, Player, Piece, type GameOptions, type ElementJSON } from '../engine/index.js';
import { viewPlayerRef, assertViewFixtureShape } from './view-fixture.js';
import { diffPlayerViews } from './view-diff.js';

class Token extends Piece<RefGame> {}

class RefGame extends Game<RefGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    const token = this.create(Token, 'token');
    token.player = this.players[0];
  }
}

describe('viewPlayerRef', () => {
  it('writes exactly the shape the engine serializes', () => {
    const game = new RefGame({ playerCount: 2, seed: 'view-fixture' });
    const token = game.first(Token)!;
    const serialized = (game.toJSON() as ElementJSON);
    const serializedToken = serialized.children!.find((c) => c.name === 'token')!;

    expect(viewPlayerRef(token.player!)).toEqual(serializedToken.attributes!.player);
  });

  it('accepts a bare seat number and names the seat as the reference', () => {
    expect(viewPlayerRef(3)).toEqual({ __playerRef: 3, seat: 3, color: undefined, name: undefined });
  });

  it('carries a color and name when the fixture wants them on screen', () => {
    expect(viewPlayerRef(2, { color: '#ff0000', name: 'Alice' })).toEqual({
      __playerRef: 2,
      seat: 2,
      color: '#ff0000',
      name: 'Alice',
    });
  });
});

describe('assertViewFixtureShape', () => {
  const shortForm: ElementJSON = {
    id: 1,
    className: 'Token',
    name: 'token',
    attributes: { player: { seat: 2 } },
  } as unknown as ElementJSON;

  it('refuses a player attribute written without __playerRef', () => {
    expect(() => assertViewFixtureShape(shortForm)).toThrowError(/__playerRef/);
  });

  it('names the element and the attribute so the fixture is findable', () => {
    expect(() => assertViewFixtureShape(shortForm)).toThrowError(/token.*player|player.*token/s);
  });

  it('accepts the shape the builder writes', () => {
    const good: ElementJSON = {
      id: 1,
      className: 'Token',
      name: 'token',
      attributes: { player: viewPlayerRef(2) },
    } as unknown as ElementJSON;
    expect(() => assertViewFixtureShape(good)).not.toThrow();
  });

  it('leaves an attribute that merely has a seat-like field alone', () => {
    const bench: ElementJSON = {
      id: 1,
      className: 'Bench',
      attributes: { spot: { seat: 2, capacity: 4 } },
    } as unknown as ElementJSON;
    expect(() => assertViewFixtureShape(bench)).not.toThrow();
  });

  it('finds the short form nested in a child, an array and a plain object', () => {
    const nested: ElementJSON = {
      id: 1,
      className: 'Table',
      children: [
        {
          id: 2,
          className: 'Seat',
          name: 'north',
          attributes: { claimants: [{ seat: 1, name: 'Alice' }] },
        },
      ],
    } as unknown as ElementJSON;
    expect(() => assertViewFixtureShape(nested)).toThrowError(/__playerRef/);
  });

  it('accepts a real engine view unchanged', () => {
    const game = new RefGame({ playerCount: 2, seed: 'view-fixture' });
    expect(() => assertViewFixtureShape(game.toJSON() as ElementJSON)).not.toThrow();
  });
});

describe('diffPlayerViews refuses a drifted fixture rather than diffing it', () => {
  it('throws when either view carries the short form', () => {
    const good: ElementJSON = {
      id: 1,
      className: 'Table',
      attributes: { player: viewPlayerRef(1) },
    } as unknown as ElementJSON;
    const bad: ElementJSON = {
      id: 1,
      className: 'Table',
      attributes: { player: { seat: 2 } },
    } as unknown as ElementJSON;

    expect(() =>
      diffPlayerViews({ player: 1, state: good }, { player: 2, state: bad })
    ).toThrowError(/__playerRef/);
  });
});
