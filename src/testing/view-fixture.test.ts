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
 * `assertViewFixtureShape` refuses the short form loudly. It is internal:
 * `diffPlayerViews` runs it on every view it is handed.
 */
import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Piece,
  Action,
  actionStep,
  type GameOptions,
  type ElementJSON,
} from '../engine/index.js';
import { assertViewFixtureShape } from './view-fixture.js';
import { diffPlayerViews } from './view-diff.js';
import { TestGame } from './test-game.js';

class Token extends Piece<RefGame> {}

class RefGame extends Game<RefGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    const token = this.create(Token, 'token');
    token.player = this.players[0];
  }
}

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

  it('accepts the shape the engine serializes', () => {
    const game = new RefGame({ playerCount: 2, seed: 'view-fixture' });
    const serialized = game.toJSON() as ElementJSON;
    const serializedToken = serialized.children!.find((c) => c.name === 'token')!;
    expect(serializedToken.attributes!.player).toHaveProperty('__playerRef');
    expect(() => assertViewFixtureShape(serializedToken)).not.toThrow();
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
  it('throws when either view carries the short form, and says to capture a real view', () => {
    const good: ElementJSON = {
      id: 1,
      className: 'Table',
      attributes: { player: { __playerRef: 1, seat: 1, color: undefined, name: undefined } },
    } as unknown as ElementJSON;
    const bad: ElementJSON = {
      id: 1,
      className: 'Table',
      attributes: { player: { seat: 2 } },
    } as unknown as ElementJSON;

    expect(() =>
      diffPlayerViews({ player: 1, state: good }, { player: 2, state: bad })
    ).toThrowError(/__playerRef[\s\S]*getPlayerView\(seat\) or renderAsSeat\(\)/);
  });
});

class Seating extends Piece<SeatingGame> {
  host!: { seat: number; name: string };
}

/** A game attribute shaped like a player reference, but a plain record the game owns (#1181). */
class SeatingGame extends Game<SeatingGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.create(Seating, 'seating', { host: { seat: 1, name: 'Alice' } });
    this.registerAction(Action.create<SeatingGame>('pass').execute(() => ({ success: true })));
    this.setFlow({ root: actionStep({ actions: ['pass'] }) });
  }
}

describe('a view the engine made is trusted, a copy of one is not (#1181)', () => {
  const makeGame = () => TestGame.create(SeatingGame, { playerCount: 2, seed: 'view-fixture-1181' });

  it('passes a captured view whose game attribute is shaped { seat, name }', () => {
    const testGame = makeGame();
    expect(() => diffPlayerViews(testGame.getPlayerView(1), testGame.getPlayerView(2))).not.toThrow();
  });

  it('keeps trusting the tree when only the wrapper around it is rebuilt', () => {
    const testGame = makeGame();
    const a = testGame.getPlayerView(1);
    const b = testGame.getPlayerView(2);
    expect(() =>
      diffPlayerViews({ ...a }, { player: b.player, state: b.state })
    ).not.toThrow();
  });

  it('refuses a hand-built copy of a captured view holding the same attribute', () => {
    const testGame = makeGame();
    const real = testGame.getPlayerView(1);
    const handBuilt = { player: 2, state: JSON.parse(JSON.stringify(real.state)) as ElementJSON };
    expect(() => diffPlayerViews(real, handBuilt)).toThrowError(/seat 2 view.*host.*__playerRef/s);
  });
});
