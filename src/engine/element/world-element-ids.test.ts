/**
 * #482: A WORLD'S ELEMENT IDS ARE KEYED BY A SECRET ITS HOST KEEPS.
 *
 * #447 made a table game's ids opaque and left a world's sequential, so a world
 * seat could count the elements created where it could not see them from the
 * gaps in the ids it could. A world keeps no constructor options across wakes,
 * so its key cannot be minted per construction the way a table's is: the host
 * mints one when the world is created, stores it, and hands it back on every
 * wake. These cases pin the engine half: a world game takes that key, refuses
 * to exist without one, mints the same ids from it on every construction, and
 * reads stored ids back to counter values wherever it compares them with the
 * allocation stamp or the construction floor.
 */
import { describe, it, expect } from 'vitest';
import { Game, Space, Piece, Player, WORLD_PARTITION_ID_FLOOR, type ElementJSON, type GameOptions } from '../index.js';
import { worldElementIds } from './element-ids.js';

class Room extends Space<KeyedWorld> {}
class Coin extends Piece<KeyedWorld> {}

class KeyedWorld extends Game<KeyedWorld, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Room, Coin]);
  }
}

const KEY = '0f1e2d3c4b5a69788796a5b4';
const OTHER_KEY = 'a5b4c3d2e1f00f1e2d3c4b5a';

/** A world as `createWorld` builds one: construction, then the floor. */
function world(key: string = KEY): KeyedWorld {
  const game = new KeyedWorld({ playerCount: 3, seed: 'keyed', worldMode: true, elementIdKey: key });
  game.reserveConstructionIdSpace();
  return game;
}

/** Five rooms, built where genesis would build them, as stored bytes. */
function storedRooms(key: string = KEY): { rooms: ElementJSON[]; next: number; rootId: number } {
  const game = world(key);
  const rooms = Array.from({ length: 5 }, (_unused, index) => {
    const room = game.create(Room, `room-${index}`);
    game.definePartition(room.id);
    return JSON.parse(JSON.stringify(room.toJSON())) as ElementJSON;
  });
  return { rooms, next: game.worldIdAllocation(), rootId: game.id };
}

describe('#482 -- a world game needs its host\'s element id key', () => {
  it('refuses to construct a world without one, and says where one comes from', () => {
    expect(() => new KeyedWorld({ playerCount: 2, seed: 's', worldMode: true })).toThrow(
      /elementIdKey/,
    );
    expect(() => new KeyedWorld({ playerCount: 2, seed: 's', worldMode: true })).toThrow(
      /mintWorldElementIdKey/,
    );
  });

  it("refuses a table game's 64-bit key: a world's is 96 bits", () => {
    expect(
      () => new KeyedWorld({ playerCount: 2, seed: 's', worldMode: true, elementIdKey: '0123456789abcdef' }),
    ).toThrow(/24 hexadecimal digits/);
  });

  it('keeps the key out of the constructor options, which nothing in a world needs it from', () => {
    const game = world();
    expect(JSON.stringify(game.getConstructorOptions())).not.toContain(KEY);
  });
});

describe('#482 -- what a world\'s ids look like', () => {
  it('are the keyed cipher of the counter, construction and stored ids alike', () => {
    const ids = worldElementIds(KEY);
    const { rooms, rootId } = storedRooms();

    expect(rootId).toBe(ids.mint(0));
    expect(rooms.map((room) => ids.cursorOf(room.id))).toEqual([
      WORLD_PARTITION_ID_FLOOR,
      WORLD_PARTITION_ID_FLOOR + 1,
      WORLD_PARTITION_ID_FLOOR + 2,
      WORLD_PARTITION_ID_FLOOR + 3,
      WORLD_PARTITION_ID_FLOOR + 4,
    ]);
  });

  it('carry no count: neither the floor nor consecutive numbers', () => {
    const { rooms } = storedRooms();
    const roomIds = rooms.map((room) => room.id);
    expect(roomIds).not.toContain(WORLD_PARTITION_ID_FLOOR);
    const steps = roomIds.slice(1).map((id, index) => id - roomIds[index]!);
    expect(steps.every((step) => step === 1)).toBe(false);
  });

  it('are the same on every construction with the same key -- a restart reads them back', () => {
    expect(storedRooms().rooms.map((room) => room.id)).toEqual(storedRooms().rooms.map((room) => room.id));
    expect(world().id).toBe(world().id);
    expect(world().players.map((player) => player.id)).toEqual(world().players.map((player) => player.id));
  });

  it('differ under a different key', () => {
    const one = storedRooms(KEY).rooms.map((room) => room.id);
    const other = storedRooms(OTHER_KEY).rooms.map((room) => room.id);
    expect(one.filter((id) => other.includes(id))).toEqual([]);
    expect(world(KEY).id).not.toBe(world(OTHER_KEY).id);
  });
});

describe('#482 -- adoption reads stored ids back to the counter', () => {
  it('adopts stored rooms into a fresh world holding the stamp, and mints past them', () => {
    const { rooms, next, rootId } = storedRooms();
    const woken = world();
    woken.adoptWorldIdAllocation(next);
    for (const room of rooms) woken.adoptSubtree(rootId, room);

    const fresh = woken.create(Room, 'fresh');
    expect(rooms.map((room) => room.id)).not.toContain(fresh.id);
    expect(worldElementIds(KEY).cursorOf(fresh.id)).toBe(next);
  });

  it('spends no counter value on an adoption, so a wake does not move the stamp', () => {
    const { rooms, next, rootId } = storedRooms();
    const woken = world();
    woken.adoptWorldIdAllocation(next);
    for (const room of rooms) woken.adoptSubtree(rootId, room);
    expect(woken.worldIdAllocation()).toBe(next);
  });

  it('advances an undeclared counter past the highest COUNTER adopted, not the highest id', () => {
    const { rooms, next, rootId } = storedRooms();
    const woken = world();
    // Adopted in an order whose largest id is not the latest-minted room: the
    // counter has to come from the decoded value, or the next mint collides.
    for (const room of rooms) woken.adoptSubtree(rootId, room);
    expect(woken.worldIdAllocation()).toBe(next);
  });

  it('refuses a declared stamp that stands below a stored counter value, by the stamp\'s name', () => {
    const { rooms, rootId } = storedRooms();
    const stale = world();
    stale.adoptWorldIdAllocation(WORLD_PARTITION_ID_FLOOR + 2);
    expect(() => stale.adoptSubtree(rootId, rooms[4]!)).toThrow(/id allocation stamp/);
  });

  it('cannot find the root a stored partition hangs from under another key', () => {
    const { rooms, rootId } = storedRooms(KEY);
    const wrong = world(OTHER_KEY);
    expect(() => wrong.adoptSubtree(rootId, rooms[0]!)).toThrow(/element id key/);
  });
});

describe('#482 -- a hidden zone\'s placeholders under 48-bit ids', () => {
  /** Every id in a projected tree. */
  const idsIn = (node: ElementJSON, into: number[] = []): number[] => {
    into.push(node.id);
    for (const child of node.children ?? []) idsIn(child, into);
    return into;
  };

  it('gives every hidden child its own safe-integer placeholder, and remaps each to its own', () => {
    const game = world();
    const purse = game.create(Room, 'purse', { player: game.players[0] });
    purse.contentsVisibleToOwner();
    const coins = Array.from({ length: 20 }, (_unused, index) => purse.create(Coin, `coin-${index}`));
    const ledger = game.create(Room, 'ledger');
    ledger.contentsCountOnly();
    for (let index = 0; index < 20; index += 1) ledger.create(Coin, `entry-${index}`);
    // The shape the old numbering broke on: a container id past 2^43, where
    // id * 1000 + index is no longer a safe integer and neighbours round to one.
    expect(purse.id).toBeGreaterThan(2 ** 43);

    const idRemap = new Map<number, number>();
    const seen = game.toJSONForPlayer(2, idRemap) as ElementJSON;
    const placeholders = idsIn(seen).filter((id) => id < 0);

    expect(placeholders).toHaveLength(40);
    expect(new Set(placeholders).size).toBe(40);
    for (const id of placeholders) expect(Number.isSafeInteger(id)).toBe(true);
    const remapped = coins.map((coin) => idRemap.get(coin.id));
    expect(new Set(remapped).size).toBe(20);
    for (const id of remapped) expect(placeholders).toContain(id);
  });
});
