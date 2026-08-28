/**
 * WORLD MODE, step one: partition adoption, eviction and move-touch marking.
 *
 * These cases pin the four things a resident world engine needs from the
 * element tree, and the three hazards that make a naive version silently
 * wrong:
 *
 *  - adoption/eviction graft and detach ONE subtree through the existing
 *    `GameElement.fromJSON` restore path;
 *  - element references must be POSITION-INDEPENDENT, because a partition
 *    that is not resident shifts every later sibling index and a branch path
 *    recorded against the full world resolves against a partial one to a
 *    DIFFERENT element;
 *  - ids arriving from storage must advance the context's id counter, which
 *    is a bare `sequence++` and not a registry;
 *  - `moveToInternal` must mark BOTH endpoints' partitions, because a
 *    cross-partition move dirties a destination this command never read.
 *
 * Snapshot mode (every published board game) must feel none of it, so each
 * area carries a negative control asserting the untouched behaviour.
 */
import { describe, it, expect } from 'vitest';
import {
  Game,
  Space,
  Piece,
  Player,
  type ElementJSON,
  type ElementContext,
  type GameOptions,
  DEFAULT_COLOR_PALETTE,
} from '../index.js';

class WorldGame extends Game<WorldGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    // Registered here so a partition serialized by one game can be adopted by
    // another: `fromJSON` resolves a className through the class registry.
    this.registerElements([Room, Token]);
  }
}

class Token extends Piece<WorldGame> {
  label!: string;
  /** An element reference held in an attribute: the thing branch paths break. */
  link?: Token;
}

/** A Space that registers its own handler in ITS OWN constructor. */
class Room extends Space<WorldGame> {
  entered: string[] = [];

  constructor(ctx: Partial<ElementContext>) {
    super(ctx);
    this.entered = [];
    this.onEnter<Token>((token) => {
      this.entered.push(token.name!);
    }, Token);
  }
}

/** Simulate a cold-storage round-trip (matches production storage adapters). */
function roundTripJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Three rooms side by side under the game, so an eviction/adoption cycle can
 * reorder them and expose a positional reference.
 */
function buildWorld(game: WorldGame) {
  const roomA = game.create(Space, 'roomA');
  const a0 = roomA.create(Token, 'a0', { label: 'a0' });
  const a1 = roomA.create(Token, 'a1', { label: 'a1' });

  const roomB = game.create(Space, 'roomB');
  const b0 = roomB.create(Token, 'b0', { label: 'b0' });
  const b1 = roomB.create(Token, 'b1', { label: 'b1' });
  const b2 = roomB.create(Token, 'b2', { label: 'b2' });

  const roomC = game.create(Space, 'roomC');
  roomC.create(Token, 'c0', { label: 'c0' });

  return { roomA, roomB, roomC, a0, a1, b0, b1, b2 };
}

describe('world mode: element references are id-based, not positional', () => {
  it('serializes element attribute refs as __elementId in world mode', () => {
    const game = new WorldGame({ playerCount: 2, seed: 'world-refs' , worldMode: true });
    const { roomB, b1, b2 } = buildWorld(game);
    b2.link = b1;

    const json = roomB.toJSON() as ElementJSON;
    const b2Json = json.children!.find((c) => c.name === 'b2')!;

    expect(b2Json.attributes.link).toEqual({ __elementId: b1.id });
  });

  it('negative control: snapshot mode still serializes refs as __elementRef branch paths', () => {
    const game = new WorldGame({ playerCount: 2, seed: 'snapshot-refs' });
    const { roomB, b1, b2 } = buildWorld(game);
    b2.link = b1;

    const json = roomB.toJSON() as ElementJSON;
    const b2Json = json.children!.find((c) => c.name === 'b2')!;

    expect(b2Json.attributes.link).toEqual({ __elementRef: b1.branch() });
  });

  it('an id-based ref survives a round trip through a PARTIAL, reordered tree', () => {
    const game = new WorldGame({ playerCount: 2, seed: 'world-partial' , worldMode: true });
    const { roomA, roomB, roomC, b1, b2 } = buildWorld(game);
    b2.link = b1;

    const aJson = roundTripJson(roomA.toJSON() as ElementJSON);
    const bJson = roundTripJson(roomB.toJSON() as ElementJSON);
    const cJson = roundTripJson(roomC.toJSON() as ElementJSON);

    game.evictSubtree(roomA.id);
    game.evictSubtree(roomB.id);
    game.evictSubtree(roomC.id);

    // Hydration order differs from construction order, which is exactly what
    // a world does: partitions load when a command names them.
    game.adoptSubtree(game.id, cJson);
    game.adoptSubtree(game.id, aJson);
    const adoptedB = game.adoptSubtree(game.id, bJson);

    const restoredB1 = adoptedB.all(Token).find((t) => t.name === 'b1')!;
    const restoredB2 = adoptedB.all(Token).find((t) => t.name === 'b2')! as Token;

    expect(restoredB2.link).toBe(restoredB1);
    expect(restoredB2.link!.label).toBe('b1');
  });

  it('proves the hazard: a branch-path ref resolves to a DIFFERENT element in the same partial tree', () => {
    // The bytes come from a SNAPSHOT-MODE donor, which is now the only way this
    // hazard can arise at all: world mode is declared at construction, so a
    // game cannot serialize half of itself with branch paths and then start
    // adopting. That is the point of the option -- this case documents what it
    // made unreachable, using a second game to produce the bytes.
    const donor = new WorldGame({ playerCount: 2, seed: 'branch-hazard' });
    const { roomA, roomB, roomC, a1, b1, b2 } = buildWorld(donor);
    b2.link = b1;

    const aJson = roundTripJson(roomA.toJSON() as ElementJSON);
    const bJson = roundTripJson(roomB.toJSON() as ElementJSON);
    const cJson = roundTripJson(roomC.toJSON() as ElementJSON);
    const recordedBranch = (bJson.children!.find((c) => c.name === 'b2')!.attributes
      .link as { __elementRef: string }).__elementRef;
    expect(recordedBranch).toBe(b1.branch());

    const game = new WorldGame({ playerCount: 2, seed: 'branch-hazard', worldMode: true });
    game.adoptSubtree(game.id, cJson);
    const adoptedA = game.adoptSubtree(game.id, aJson);
    const adoptedB = game.adoptSubtree(game.id, bJson);

    const restoredB2 = adoptedB.all(Token).find((t) => t.name === 'b2')! as Token;
    const restoredA1 = adoptedA.all(Token).find((t) => t.name === 'a1')!;

    // The recorded path now indexes into roomA: silently the wrong element.
    expect(restoredB2.link).toBe(restoredA1);
    expect(restoredB2.link!.name).not.toBe('b1');
    expect(a1.name).toBe('a1');
  });

  it('preserves a ref into a NON-RESIDENT partition instead of nulling it', () => {
    const game = new WorldGame({ playerCount: 2, seed: 'dangling-ref' , worldMode: true });
    const { roomA, roomB, roomC, a1, b2 } = buildWorld(game);
    b2.link = a1;
    const aId = a1.id;

    const bJson = roundTripJson(roomB.toJSON() as ElementJSON);
    game.evictSubtree(roomA.id);
    game.evictSubtree(roomB.id);
    game.evictSubtree(roomC.id);

    const adoptedB = game.adoptSubtree(game.id, bJson);
    const restoredB2 = adoptedB.all(Token).find((t) => t.name === 'b2')!;

    // roomA is not resident, so the id cannot resolve. The ref is kept
    // verbatim, so the link is not destroyed by the next checkpoint.
    expect((restoredB2 as unknown as Record<string, unknown>).link).toEqual({
      __elementId: aId,
    });

    const reserialized = adoptedB.toJSON() as ElementJSON;
    const b2Json = reserialized.children!.find((c) => c.name === 'b2')!;
    expect(b2Json.attributes.link).toEqual({ __elementId: aId });
  });
});

describe('Game.adoptSubtree', () => {
  it('grafts a serialized subtree under the named parent', () => {
    const game = new WorldGame({ playerCount: 2, seed: 'adopt-basic' , worldMode: true });
    const { roomB } = buildWorld(game);
    const bJson = roundTripJson(roomB.toJSON() as ElementJSON);
    game.evictSubtree(roomB.id);

    const hall = game.create(Space, 'hall');
    const adopted = game.adoptSubtree(hall.id, bJson);

    expect(adopted.parent).toBe(hall);
    expect(adopted.name).toBe('roomB');
    expect(adopted.all(Token).map((t) => t.name)).toEqual(['b0', 'b1', 'b2']);
    expect(game.getElementById(adopted.id)).toBe(adopted);
  });

  it('raises the id counter so a later create() cannot collide with an adopted id', () => {
    const donor = new WorldGame({ playerCount: 2, seed: 'donor' , worldMode: true });
    for (let i = 0; i < 40; i++) donor.create(Space, `filler-${i}`);
    const highRoom = donor.create(Space, 'high-room');
    const highToken = highRoom.create(Token, 'high-token', { label: 'high' });
    const highJson = roundTripJson(highRoom.toJSON() as ElementJSON);

    // A fresh game whose counter is far BELOW the adopted ids.
    const game = new WorldGame({ playerCount: 2, seed: 'collide' , worldMode: true });
    expect(highToken.id).toBeGreaterThan(20);

    const adopted = game.adoptSubtree(game.id, highJson);
    const adoptedIds = new Set([adopted.id, ...adopted.all(Token).map((t) => t.id)]);

    const fresh = game.create(Space, 'fresh');
    expect(adoptedIds.has(fresh.id)).toBe(false);
    expect(fresh.id).toBeGreaterThan(Math.max(...adoptedIds));
    expect(game.getElementById(fresh.id)).toBe(fresh);
  });

  it('refuses an adoption whose ids are already resident', () => {
    const game = new WorldGame({ playerCount: 2, seed: 'dupe-ids' , worldMode: true });
    const { roomB } = buildWorld(game);
    const bJson = roundTripJson(roomB.toJSON() as ElementJSON);

    expect(() => game.adoptSubtree(game.id, bJson)).toThrow(/already resident/i);
    expect(() => game.adoptSubtree(game.id, bJson)).toThrow(new RegExp(String(roomB.id)));
  });

  it('names the missing parent when parentId is not resident', () => {
    const game = new WorldGame({ playerCount: 2, seed: 'missing-parent' , worldMode: true });
    const { roomB } = buildWorld(game);
    const bJson = roundTripJson(roomB.toJSON() as ElementJSON);
    game.evictSubtree(roomB.id);

    expect(() => game.adoptSubtree(99999, bJson)).toThrow(/99999/);
    expect(() => game.adoptSubtree(99999, bJson)).toThrow(/not resident|hydrate/i);
  });

  it('refuses to adopt outside world mode, because branch refs would be grafted', () => {
    const game = new WorldGame({ playerCount: 2, seed: 'no-world-mode' });
    const { roomB } = buildWorld(game);
    const bJson = roundTripJson(roomB.toJSON() as ElementJSON);

    expect(() => game.adoptSubtree(game.id, bJson)).toThrow(/worldMode: true/);
  });

  it('keeps a Space handler registered in its own class constructor', () => {
    const game = new WorldGame({ playerCount: 2, seed: 'handlers' , worldMode: true });
    const room = game.create(Room, 'kitchen');
    const outside = game.create(Space, 'outside');
    const token = outside.create(Token, 'spoon', { label: 'spoon' });

    const roomJson = roundTripJson(room.toJSON() as ElementJSON);
    game.evictSubtree(room.id);
    const adopted = game.adoptSubtree(game.id, roomJson) as Room;

    token.putInto(adopted);
    expect(adopted.entered).toEqual(['spoon']);
  });
});

describe('Game.evictSubtree', () => {
  it('detaches the subtree so it costs nothing to traverse', () => {
    const game = new WorldGame({ playerCount: 2, seed: 'evict' , worldMode: true });
    const { roomB, b1 } = buildWorld(game);
    const bId = roomB.id;

    game.evictSubtree(bId);

    expect(game.getElementById(bId)).toBeUndefined();
    expect(game.getElementById(b1.id)).toBeUndefined();
    expect(game.all(Token).map((t) => t.name)).toEqual(['a0', 'a1', 'c0']);
  });

  it('refuses to evict the game root', () => {
    const game = new WorldGame({ playerCount: 2, seed: 'evict-root' , worldMode: true });
    expect(() => game.evictSubtree(game.id)).toThrow(/game root/i);
  });

  it('names an id that is not resident', () => {
    const game = new WorldGame({ playerCount: 2, seed: 'evict-missing' , worldMode: true });
    expect(() => game.evictSubtree(4242)).toThrow(/4242/);
  });
});

describe('moveToInternal partition marking', () => {
  function worldWithPartitions(seed: string) {
    const game = new WorldGame({ playerCount: 2, seed , worldMode: true });
    const built = buildWorld(game);
    game.definePartition(built.roomA.id);
    game.definePartition(built.roomB.id);
    game.definePartition(built.roomC.id);
    game.clearTouchedPartitions();
    return { game, ...built };
  }

  it('marks BOTH endpoints of a cross-partition move', () => {
    const { game, roomA, roomB, b0 } = worldWithPartitions('cross-move');

    b0.putInto(roomA);

    expect([...game.touchedPartitions].sort()).toEqual([roomA.id, roomB.id].sort());
  });

  it('marks one partition for a move that stays inside it', () => {
    const { game, roomB, b0 } = worldWithPartitions('inside-move');

    b0.putInto(roomB, { position: 'last' });

    expect([...game.touchedPartitions]).toEqual([roomB.id]);
  });

  it('marks the moved partition root itself when a whole partition re-parents', () => {
    const { game, roomA, roomC } = worldWithPartitions('root-move');

    roomC.reparent(roomA);

    expect([...game.touchedPartitions].sort()).toEqual([roomA.id, roomC.id].sort());
  });

  it('marks nothing for a REJECTED move', () => {
    const { game, roomA, roomB, b0 } = worldWithPartitions('rejected-move');
    roomB.sealed = true;

    expect(() => b0.putInto(roomA)).toThrow(/sealed/i);
    expect(() => b0.putInto(b0)).toThrow(/into itself/i);
    expect(() => roomA.reparent(roomA.first(Token)!)).toThrow(/descendant|itself/i);

    expect([...game.touchedPartitions]).toEqual([]);
  });

  it('records nothing for an element outside every partition', () => {
    const { game, roomA } = worldWithPartitions('outside-partitions');
    const loose = game.create(Space, 'loose');
    const drifter = loose.create(Token, 'drifter', { label: 'drifter' });
    game.clearTouchedPartitions();

    drifter.putInto(roomA);

    expect([...game.touchedPartitions]).toEqual([roomA.id]);
  });

  it('clearTouchedPartitions empties the set without disturbing residency', () => {
    const { game, roomA, b0 } = worldWithPartitions('clear-touched');
    b0.putInto(roomA);
    expect(game.touchedPartitions.size).toBe(2);

    game.clearTouchedPartitions();

    expect(game.touchedPartitions.size).toBe(0);
    expect(game.getElementById(b0.id)).toBe(b0);
  });

  it('adoption itself does not add to the move-touched set', () => {
    const game = new WorldGame({ playerCount: 2, seed: 'adopt-not-touched' , worldMode: true });
    const { roomB } = buildWorld(game);
    const bJson = roundTripJson(roomB.toJSON() as ElementJSON);
    game.evictSubtree(roomB.id);
    game.clearTouchedPartitions();

    game.adoptSubtree(game.id, bJson);

    // The platform already knows what it hydrated; the engine owes it only
    // the move-touched half.
    expect([...game.touchedPartitions]).toEqual([]);
  });

  it('negative control: snapshot mode records no partitions at all', () => {
    const game = new WorldGame({ playerCount: 2, seed: 'snapshot-moves' });
    const { roomA, b0 } = buildWorld(game);

    b0.putInto(roomA);

    expect(game.touchedPartitions.size).toBe(0);
  });
});

/**
 * WORLD MODE IS A CONSTRUCTOR OPTION, and a world's seat count is not a table's.
 *
 * Both of these are the same mistake found in two places. `enableWorldMode()`
 * was a switch flipped after `new GameClass(...)` returned -- and a subclass
 * constructor body runs before that, creating elements. Those elements were
 * created in snapshot mode, where an element reference serializes as a
 * positional branch path that resolves to the WRONG element once a partition is
 * not resident. The engine caught it at serialize time, but only by refusing;
 * the game author's mistake was three steps earlier and unrecoverable.
 *
 * `GameOptions.randomness` records exactly this argument for exactly this
 * reason: "It arrives through the CONSTRUCTOR rather than a method called
 * afterwards because a subclass constructor body runs after Game's and real
 * games draw there." A world is the same shape of hazard with a worse failure.
 */
describe('world mode is declared at construction', () => {
  it('is on before a subclass constructor body runs', () => {
    // The property `enableWorldMode()` could not have. Anything the subclass
    // built is already world-mode, so its references are id-based.
    class EarlyWorld extends Game<EarlyWorld, Player> {
      readonly builtInWorldMode: boolean;
      constructor(options: GameOptions) {
        super(options);
        this.builtInWorldMode = this.worldMode;
      }
    }

    const game = new EarlyWorld({ playerCount: 2, seed: 'early', worldMode: true });
    expect(game.builtInWorldMode).toBe(true);
  });

  it('is OFF by default, so every published board game feels none of it', () => {
    const game = new WorldGame({ playerCount: 2, seed: 'snapshot' });
    expect(game.worldMode).toBe(false);
  });

  it('SEATS A WORLD PAST THE PALETTE, cycling colours instead of refusing', () => {
    // A table's palette is a UI affordance: sixteen colours a person can tell
    // apart in a legend. A 500-player world renders no legend, and refusing to
    // construct one is the engine declining to run the mode it just added.
    //
    // Colour is never the sole carrier of player identity here -- every entry
    // has a `colorLabel` -- so two players in a large world sharing "Red" is
    // honest rather than lossy, and it is a fact about the world's size.
    const game = new WorldGame({ playerCount: 40, seed: 'crowd', worldMode: true });

    expect(game.players).toHaveLength(40);
    expect(game.players[0]!.color).toBe(DEFAULT_COLOR_PALETTE[0]);
    // Seat 17 wraps to the first colour, and says so with the same label.
    expect(game.players[16]!.color).toBe(DEFAULT_COLOR_PALETTE[0]);
    expect(game.players[16]!.colorLabel).toBe(game.players[0]!.colorLabel);
  });

  it('still REFUSES to overrun the palette in snapshot mode', () => {
    // The negative control. A table asking for more seats than any host will
    // run is a mistake worth failing on, and world mode must not relax it.
    expect(() => new WorldGame({ playerCount: 40, seed: 'table' })).toThrow(
      /the default palette covers/,
    );
  });

  it("a world's own colours are still honoured, and still cycle", () => {
    // A game that supplied a palette meant it. Cycling a two-colour palette
    // over eight seats is what that game asked for -- two teams of four -- and
    // refusing it would make `colors` unusable in the one mode where a short
    // palette is a deliberate statement rather than an oversight.
    const game = new WorldGame({
      playerCount: 8,
      seed: 'teams',
      worldMode: true,
      colors: ['#111111', '#222222'],
    });

    expect(game.players.map((p) => p.color)).toEqual([
      '#111111', '#222222', '#111111', '#222222',
      '#111111', '#222222', '#111111', '#222222',
    ]);
  });
});
