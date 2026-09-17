// PER-SEAT DERIVED ATTRIBUTES, COMPUTED AT PROJECTION TIME (#269).
//
// `static visibleAttributes` is a whitelist over STORED attributes, and
// `hideFromAll()` / `showOnlyTo()` hide whole elements. Neither can express "a
// value is present only while the seat holds a thing", so before this hook a
// game had to store the value ALREADY GATED and re-derive it from every write
// path that could change the gating fact. Miss one path -- another character
// takes the item, an event destroys it -- and the stale gated value is served
// for as long as the seat does not happen to issue a command that rewrites it.
//
// `static seatAttributes` removes the bookkeeping: the value is computed when
// the element is serialized FOR A SEAT, from live state, and never stored. It
// cannot be stale because there is nothing to keep in step.
import { describe, it, expect, beforeEach } from 'vitest';
import { Game, Player, Piece, Space } from '../index.js';
import type { ElementJSON } from '../index.js';

class Gps extends Piece<TestGame> {}

/**
 * The issue's case: a character shows their map coordinate only while they
 * carry a GPS unit. The coordinate itself is real state; the GATE is the pack.
 */
class Character extends Space<TestGame> {
  static override seatAttributes = {
    coordinates: (character: Character) =>
      character.first(Gps) ? character.cell : undefined,
  };

  cell = 'AB-2';
}

class SharedBoard extends Space<TestGame> {
  static override seatAttributes = {
    seatEcho: (_board: SharedBoard, seat: number | null) => `seat:${seat ?? 'spectator'}`,
  };
}

class Throwing extends Piece<TestGame> {
  static override seatAttributes = {
    boom: (): unknown => {
      throw new Error('derivation blew up');
    },
  };
}

class Unserializable extends Piece<TestGame> {
  static override seatAttributes = {
    callback: () => ({ nested: () => 'not JSON' }),
  };
}

class Colliding extends Piece<TestGame> {
  static override seatAttributes = {
    stored: () => 'derived',
  };

  stored = 'written to the element';
}

/** A whitelist and a derivation on one class: the derivation is the gate. */
class Whitelisted extends Space<TestGame> {
  static override visibleAttributes = ['shown'];
  static override seatAttributes = { derived: () => 'computed' };
  shown = 'public';
  hidden = 'secret';
}

class Reserved extends Piece<TestGame> {
  static override seatAttributes = { name: () => 'renamed' };
}

class TestGame extends Game<TestGame, Player> {
  constructor(options: ConstructorParameters<typeof Game>[0]) {
    super(options);
    this.registerElements([
      Gps, Character, SharedBoard, Throwing, Unserializable, Colliding, Whitelisted, Reserved,
    ]);
  }
}

function findByName(children: ElementJSON[] | undefined, name: string): ElementJSON {
  const found = children?.find((child) => child.name === name);
  if (!found) throw new Error(`no serialized node named ${name}`);
  return found;
}

describe('static seatAttributes (#269)', () => {
  let game: TestGame;
  let character: Character;

  beforeEach(() => {
    game = new TestGame({ playerCount: 2 });
    character = game.create(Character, 'hero');
    character.player = game.getPlayer(1)!;
    character.create(Gps, 'gps');
  });

  it('computes the attribute for the receiving seat', () => {
    const view = game.toJSONForPlayer(1);
    expect(findByName(view.children, 'hero').attributes.coordinates).toBe('AB-2');
  });

  it('drops the value the moment the gate is removed by an outside path', () => {
    // THE ISSUE'S REPRODUCTION. Nobody rewrites the character: the GPS is taken
    // by something that is not this seat's own command, and the next projection
    // for this seat simply does not derive a coordinate any more.
    expect(findByName(game.toJSONForPlayer(1).children, 'hero').attributes.coordinates).toBe('AB-2');

    game.first(Gps)!.remove();

    expect(findByName(game.toJSONForPlayer(1).children, 'hero').attributes.coordinates).toBeUndefined();
  });

  it('never stores the derived value', () => {
    game.toJSONForPlayer(1);
    expect(Object.prototype.hasOwnProperty.call(character, 'coordinates')).toBe(false);
    expect(findByName(game.toJSON().children, 'hero').attributes.coordinates).toBeUndefined();
  });

  it('answers each seat separately, including inside a batched projection', () => {
    const board = game.create(SharedBoard, 'board');
    expect(board).toBeDefined();
    const [one, two, spectator] = game.toJSONForPlayers([1, 2, null]);
    expect(findByName(one.children, 'board').attributes.seatEcho).toBe('seat:1');
    expect(findByName(two.children, 'board').attributes.seatEcho).toBe('seat:2');
    expect(findByName(spectator.children, 'board').attributes.seatEcho).toBe('seat:spectator');
  });

  it('refuses to claim two seats share a projection when a class derives attributes', () => {
    game.create(SharedBoard, 'board');
    expect(game.projectionSignaturesFor([1, 2])).toBeNull();
  });

  it('derives nothing for an element the seat cannot see', () => {
    character.hideFromAll();
    // A hidden element is a placeholder that carries no name, so it is found
    // by id -- and it must carry no derived attribute either.
    const node = game.toJSONForPlayer(2).children?.find((child) => child.id === character.id);
    expect(node?.attributes.__hidden).toBe(true);
    expect(node?.attributes.coordinates).toBeUndefined();
  });

  it('survives a whitelist that does not name the derived attribute', () => {
    // The derivation IS the gate, and it ran for this exact seat, so a
    // whitelist written for stored attributes has no say over it.
    const element = game.create(Whitelisted, 'w');
    element.player = game.getPlayer(1)!;

    const nonOwner = findByName(game.toJSONForPlayer(2).children, 'w');
    expect(nonOwner.attributes.shown).toBe('public');
    expect(nonOwner.attributes.hidden).toBeUndefined();
    expect(nonOwner.attributes.derived).toBe('computed');
  });

  it('names the class, attribute and seat when a derivation throws', () => {
    game.create(Throwing, 'thrower');
    expect(() => game.toJSONForPlayer(1)).toThrow(
      /Throwing\.seatAttributes\.boom.*seat 1.*derivation blew up/s,
    );
  });

  it('names the class and attribute when a derivation returns something unserializable', () => {
    game.create(Unserializable, 'bad');
    expect(() => game.toJSONForPlayer(1)).toThrow(
      /Unserializable\.seatAttributes\.callback.*callback\.nested.*function/s,
    );
  });

  it('refuses a derived name that the element also stores', () => {
    game.create(Colliding, 'collide');
    expect(() => game.toJSONForPlayer(1)).toThrow(
      /Colliding\.seatAttributes\.stored.*also stored/s,
    );
  });

  it('refuses a derived name the engine owns', () => {
    game.create(Reserved, 'reserved');
    expect(() => game.toJSONForPlayer(1)).toThrow(/Reserved\.seatAttributes\.name/);
  });

  it('does not restore a derived value as stored state', () => {
    // A per-seat view is restorable (the MCTS sandbox restores one). The
    // derived attribute must come back derived, not as an own property that
    // could then go stale inside the sandbox.
    const restored = new TestGame({ playerCount: 2 });
    restored.loadSerializedState(game.toJSONForPlayer(1) as ReturnType<Game['toJSON']>);
    const restoredCharacter = restored.first(Character, 'hero')!;
    expect(Object.prototype.hasOwnProperty.call(restoredCharacter, 'coordinates')).toBe(false);
    expect(findByName(restored.toJSONForPlayer(1).children, 'hero').attributes.coordinates).toBe('AB-2');
  });
});
